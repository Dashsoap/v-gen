import type { TaskProgress } from "./types";

export type PresentationState =
  | "idle"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskPresentation {
  state: PresentationState;
  labelKey: string;
  progress: number;
  totalSteps: number;
  errorMessage?: string;
}

export function resolveTaskPresentationState(
  task: Pick<TaskProgress, "status" | "progress" | "totalSteps" | "message"> & {
    errorCode?: string | null;
  }
): TaskPresentation {
  if (task.errorCode === "TASK_CANCELLED") {
    return {
      state: "cancelled",
      labelKey: "taskStatus.cancelled",
      progress: task.progress,
      totalSteps: task.totalSteps,
    };
  }

  switch (task.status) {
    case "running":
      return {
        state: "running",
        labelKey: "taskStatus.running",
        progress: task.progress,
        totalSteps: task.totalSteps,
      };
    case "completed":
      return {
        state: "completed",
        labelKey: "taskStatus.completed",
        progress: task.totalSteps,
        totalSteps: task.totalSteps,
      };
    case "failed":
      return {
        state: "failed",
        labelKey: "taskStatus.failed",
        progress: task.progress,
        totalSteps: task.totalSteps,
        errorMessage: task.message,
      };
    default:
      return {
        state: "pending",
        labelKey: "taskStatus.pending",
        progress: 0,
        totalSteps: task.totalSteps,
      };
  }
}
