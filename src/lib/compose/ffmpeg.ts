import { execFile } from "child_process";
import { writeFile, mkdir, unlink, readdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Timeline } from "./timeline";
import { generateSrt } from "./subtitle";

const TMP_DIR = process.env.LOCAL_STORAGE_PATH || "./data";

interface ComposeOptions {
  timeline: Timeline;
  bgmUrl?: string;
  bgmVolume?: number;
  subtitleEnabled?: boolean;
  transition?: "crossfade" | "cut" | "fade";
  outputFileName?: string;
}

export async function composeVideo(options: ComposeOptions): Promise<{
  outputPath: string;
  srtContent: string;
}> {
  const {
    timeline,
    bgmUrl,
    bgmVolume = 0.3,
    subtitleEnabled = true,
    outputFileName,
  } = options;

  const workDir = join(TMP_DIR, "compose", randomUUID());
  await mkdir(workDir, { recursive: true });

  try {
    // 1. Download all video segments to temp files
    const segmentFiles: string[] = [];
    for (let i = 0; i < timeline.segments.length; i++) {
      const seg = timeline.segments[i];
      const filePath = join(workDir, `segment_${i}.mp4`);
      await downloadFile(seg.videoUrl, filePath);
      segmentFiles.push(filePath);
    }

    // 2. Create concat file
    const concatFile = join(workDir, "concat.txt");
    const concatContent = segmentFiles
      .map((f) => `file '${f}'`)
      .join("\n");
    await writeFile(concatFile, concatContent);

    // 3. Generate SRT
    const srtContent = generateSrt(timeline.subtitles);
    const srtFile = join(workDir, "subtitles.srt");
    await writeFile(srtFile, srtContent);

    // 4. Download audio files
    const audioFiles: Array<{ path: string; startMs: number }> = [];
    for (let i = 0; i < timeline.audioTracks.length; i++) {
      const track = timeline.audioTracks[i];
      const filePath = join(workDir, `audio_${i}.mp3`);
      await downloadFile(track.audioUrl, filePath);
      audioFiles.push({ path: filePath, startMs: track.startMs });
    }

    // 5. Download BGM if provided
    let bgmFile: string | undefined;
    if (bgmUrl) {
      bgmFile = join(workDir, "bgm.mp3");
      await downloadFile(bgmUrl, bgmFile);
    }

    // 6. Build FFmpeg command
    const outputPath = join(
      TMP_DIR,
      "output",
      outputFileName || `${randomUUID()}.mp4`
    );
    await mkdir(join(TMP_DIR, "output"), { recursive: true });

    const args = buildFFmpegArgs({
      concatFile,
      audioFiles,
      srtFile: subtitleEnabled ? srtFile : undefined,
      bgmFile,
      bgmVolume,
      outputPath,
    });

    await runFFmpeg(args);

    return { outputPath, srtContent };
  } finally {
    // Cleanup temp files
    try {
      const files = await readdir(workDir);
      for (const f of files) {
        await unlink(join(workDir, f)).catch(() => {});
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

function buildFFmpegArgs(params: {
  concatFile: string;
  audioFiles: Array<{ path: string; startMs: number }>;
  srtFile?: string;
  bgmFile?: string;
  bgmVolume: number;
  outputPath: string;
}): string[] {
  const args: string[] = ["-y"]; // overwrite output

  // Input: concatenated video
  args.push("-f", "concat", "-safe", "0", "-i", params.concatFile);

  // Input: audio files
  for (const audio of params.audioFiles) {
    args.push("-i", audio.path);
  }

  // Input: BGM
  if (params.bgmFile) {
    args.push("-i", params.bgmFile);
  }

  // Build filter complex for audio mixing
  const filterParts: string[] = [];
  const audioInputs = params.audioFiles.length;
  let streamIndex = 1; // 0 is video

  // Delay each audio track to its start time
  for (let i = 0; i < audioInputs; i++) {
    const delayMs = params.audioFiles[i].startMs;
    filterParts.push(
      `[${streamIndex}:a]adelay=${delayMs}|${delayMs}[a${i}]`
    );
    streamIndex++;
  }

  // Mix all audio streams
  if (audioInputs > 0) {
    const audioLabels = Array.from({ length: audioInputs }, (_, i) => `[a${i}]`).join("");
    const mixLabel = "[voice_mix]";
    filterParts.push(`${audioLabels}amix=inputs=${audioInputs}:normalize=0${mixLabel}`);

    if (params.bgmFile) {
      filterParts.push(
        `[${streamIndex}:a]volume=${params.bgmVolume}[bgm]`,
        `[voice_mix][bgm]amix=inputs=2:normalize=0[final_audio]`
      );
    } else {
      filterParts.push(`[voice_mix]acopy[final_audio]`);
    }
  } else if (params.bgmFile) {
    filterParts.push(
      `[${streamIndex}:a]volume=${params.bgmVolume}[final_audio]`
    );
  }

  if (filterParts.length > 0) {
    args.push("-filter_complex", filterParts.join(";"));
    args.push("-map", "0:v");
    args.push("-map", "[final_audio]");
  } else {
    args.push("-map", "0:v");
  }

  // Subtitle burn-in
  if (params.srtFile) {
    args.push("-vf", `subtitles=${params.srtFile}:force_style='FontSize=24,PrimaryColour=&Hffffff&'`);
  }

  // Output settings
  args.push(
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    params.outputPath
  );

  return args;
}

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { maxBuffer: 50 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`FFmpeg failed: ${stderr || error.message}`));
      } else {
        resolve();
      }
    });
  });
}

async function downloadFile(url: string, dest: string): Promise<void> {
  // Handle data URLs (base64)
  if (url.startsWith("data:")) {
    const base64Data = url.split(",")[1];
    await writeFile(dest, Buffer.from(base64Data, "base64"));
    return;
  }

  // Handle local file paths
  if (url.startsWith("/") || url.startsWith("./")) {
    const { copyFile } = await import("fs/promises");
    await copyFile(url, dest);
    return;
  }

  // Handle HTTP URLs
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(dest, buffer);
}
