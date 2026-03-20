export interface SrtEntry {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

function padTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function generateSrt(entries: SrtEntry[]): string {
  return entries
    .map(
      (e) =>
        `${e.index}\n${padTime(e.startMs)} --> ${padTime(e.endMs)}\n${e.text}\n`
    )
    .join("\n");
}

export function parseSrt(srt: string): SrtEntry[] {
  const blocks = srt.trim().split(/\n\n+/);
  return blocks.map((block) => {
    const lines = block.split("\n");
    const index = parseInt(lines[0]);
    const [start, end] = lines[1].split(" --> ").map(parseTimeCode);
    const text = lines.slice(2).join("\n");
    return { index, startMs: start, endMs: end, text };
  });
}

function parseTimeCode(tc: string): number {
  const [time, millis] = tc.split(",");
  const [h, m, s] = time.split(":").map(Number);
  return h * 3600000 + m * 60000 + s * 1000 + parseInt(millis);
}
