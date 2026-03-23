export enum TaskType {
  VIDEO_ANALYZE = "VIDEO_ANALYZE",
  REWRITE = "REWRITE",
  GENERATE_STORYBOARD = "GENERATE_STORYBOARD",
  GENERATE_PANEL_IMAGE = "GENERATE_PANEL_IMAGE",
  GENERATE_PANEL_VIDEO = "GENERATE_PANEL_VIDEO",
  GENERATE_VOICE_LINE = "GENERATE_VOICE_LINE",
  COMPOSE_VIDEO = "COMPOSE_VIDEO",
}

export const QUEUE_NAMES = {
  text: "vgen-text",
  image: "vgen-image",
  video: "vgen-video",
  voice: "vgen-voice",
} as const;

export interface TaskPayload {
  taskId: string;
  userId: string;
  projectId?: string;
  type: TaskType;
  data: Record<string, unknown>;
}

export interface TaskProgress {
  taskId: string;
  projectId?: string;
  progress: number;
  totalSteps: number;
  status: "running" | "completed" | "failed";
  message?: string;
  errorCode?: string;
  textChunk?: string;
  accumulatedText?: string;
}
