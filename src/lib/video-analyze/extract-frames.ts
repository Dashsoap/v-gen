import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createScopedLogger } from "@/lib/logging";

const execFileAsync = promisify(execFile);
const logger = createScopedLogger({ module: "extract-frames" });

export interface ExtractFramesOptions {
  videoPath: string;       // Local file path or URL
  intervalSec?: number;    // Seconds between frames (default: 5)
  maxFrames?: number;      // Max frames to extract (default: 20)
  width?: number;          // Output frame width (default: 1280)
}

export interface ExtractedFrame {
  path: string;            // Path to extracted frame image
  timestampSec: number;    // Timestamp in seconds
}

/**
 * Extract frames from a video at regular intervals using FFmpeg.
 * Returns paths to extracted frame images.
 */
export async function extractFrames(options: ExtractFramesOptions): Promise<{
  frames: ExtractedFrame[];
  tempDir: string;
  durationSec: number;
}> {
  const { videoPath, intervalSec = 5, maxFrames = 20, width = 1280 } = options;

  // Create temp directory for frames
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vgen-frames-"));

  try {
    // Get video duration
    const durationSec = await getVideoDuration(videoPath);
    logger.info("Video duration", { durationSec, videoPath });

    // Calculate actual interval to stay within maxFrames
    const totalPossibleFrames = Math.floor(durationSec / intervalSec);
    const actualInterval = totalPossibleFrames > maxFrames
      ? Math.ceil(durationSec / maxFrames)
      : intervalSec;

    // Extract frames with FFmpeg
    const outputPattern = path.join(tempDir, "frame_%04d.jpg");
    const args = [
      "-i", videoPath,
      "-vf", `fps=1/${actualInterval},scale=${width}:-1`,
      "-frames:v", String(maxFrames),
      "-q:v", "2",   // High quality JPEG
      outputPattern,
    ];

    await execFileAsync("ffmpeg", args, { timeout: 120_000 });

    // List extracted frames
    const files = await fs.promises.readdir(tempDir);
    const frameFiles = files
      .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
      .sort();

    const frames: ExtractedFrame[] = frameFiles.map((f, i) => ({
      path: path.join(tempDir, f),
      timestampSec: i * actualInterval,
    }));

    logger.info("Frames extracted", { count: frames.length, interval: actualInterval });
    return { frames, tempDir, durationSec };
  } catch (error) {
    // Clean up temp dir on error
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Get video duration in seconds using ffprobe.
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ], { timeout: 30_000 });

  const duration = parseFloat(stdout.trim());
  if (isNaN(duration)) {
    throw new Error(`Could not determine video duration: ${videoPath}`);
  }
  return duration;
}

/**
 * Clean up extracted frames directory.
 */
export async function cleanupFrames(tempDir: string): Promise<void> {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
}
