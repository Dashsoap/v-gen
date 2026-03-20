import type { SrtEntry } from "./subtitle";

export interface TimelineSegment {
  panelId: string;
  videoUrl: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface TimelineAudio {
  voiceLineId: string;
  audioUrl: string;
  startMs: number;
  endMs: number;
  text: string;
  character?: string;
}

export interface Timeline {
  segments: TimelineSegment[];
  audioTracks: TimelineAudio[];
  subtitles: SrtEntry[];
  totalDurationMs: number;
}

/**
 * Build a timeline from panels and voice lines,
 * laying out segments sequentially and aligning audio.
 */
export function buildTimeline(
  panels: Array<{
    id: string;
    videoUrl: string;
    durationMs: number;
    voiceLines: Array<{
      id: string;
      audioUrl: string;
      text: string;
      startMs: number;
      endMs: number;
      characterName?: string;
    }>;
  }>
): Timeline {
  const segments: TimelineSegment[] = [];
  const audioTracks: TimelineAudio[] = [];
  const subtitles: SrtEntry[] = [];

  let currentTime = 0;
  let subtitleIndex = 1;

  for (const panel of panels) {
    const segmentStart = currentTime;
    const segmentEnd = currentTime + panel.durationMs;

    segments.push({
      panelId: panel.id,
      videoUrl: panel.videoUrl,
      startMs: segmentStart,
      endMs: segmentEnd,
      durationMs: panel.durationMs,
    });

    // Map voice lines relative to global timeline
    for (const vl of panel.voiceLines) {
      const audioStart = segmentStart + vl.startMs;
      const audioEnd = segmentStart + vl.endMs;

      audioTracks.push({
        voiceLineId: vl.id,
        audioUrl: vl.audioUrl,
        startMs: audioStart,
        endMs: audioEnd,
        text: vl.text,
        character: vl.characterName,
      });

      subtitles.push({
        index: subtitleIndex++,
        startMs: audioStart,
        endMs: audioEnd,
        text: vl.characterName ? `${vl.characterName}: ${vl.text}` : vl.text,
      });
    }

    currentTime = segmentEnd;
  }

  return {
    segments,
    audioTracks,
    subtitles,
    totalDurationMs: currentTime,
  };
}
