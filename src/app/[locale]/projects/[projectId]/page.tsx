"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Upload, Wand2, LayoutGrid, Film, Download, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

interface Project {
  id: string;
  title: string;
  status: string;
  sourceVideoUrl?: string;
  analyzedText?: string;
  rewrittenText?: string;
  episodes?: Episode[];
}

interface Episode {
  id: string;
  title: string;
  clips: Clip[];
  composition?: { outputUrl?: string; status: string };
}

interface Clip {
  id: string;
  panels: Panel[];
}

interface Panel {
  id: string;
  sceneDescription?: string;
  imagePrompt?: string;
  imageUrl?: string;
  videoUrl?: string;
  sortOrder: number;
}

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const t = useTranslations();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [taskRunning, setTaskRunning] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const fetchProject = async () => {
    const res = await fetch(`/api/projects/${projectId}`);
    if (res.ok) {
      const data = await res.json();
      setProject(data);
      setText(data.rewrittenText || data.analyzedText || "");
    }
    setLoading(false);
  };

  useEffect(() => { fetchProject(); }, [projectId]);

  // Auto-poll when project is in a working state
  useEffect(() => {
    const workingStates = ["analyzing", "rewriting", "storyboarding", "generating"];
    if (!project || !workingStates.includes(project.status)) return;
    const interval = setInterval(fetchProject, 3000);
    return () => clearInterval(interval);
  }, [project?.status]);

  const uploadVideo = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/projects/upload", { method: "POST", body: formData });
    if (!res.ok) { toast.error("Upload failed"); return; }
    const { url } = await res.json();

    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceVideoUrl: url }),
    });
    await fetchProject();
    toast.success("Video uploaded!");
  };

  const triggerTask = async (endpoint: string, body?: object) => {
    setTaskRunning(true);
    setLastError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      if (res.ok) {
        const data = await res.json();
        const taskId = data.taskId;
        toast.success("Task started");
        await fetchProject();

        // Poll task status for completion/failure
        if (taskId) {
          const checkInterval = setInterval(async () => {
            try {
              const taskRes = await fetch(`/api/tasks/${taskId}`);
              if (!taskRes.ok) return;
              const task = await taskRes.json();
              if (task.status === "completed") {
                clearInterval(checkInterval);
                await fetchProject();
                toast.success("完成!");
              } else if (task.status === "failed") {
                clearInterval(checkInterval);
                await fetchProject();
                const errMsg = task.error || task.errorCode || "未知错误";
                setLastError(errMsg);
                toast.error(`任务失败: ${errMsg}`);
              }
            } catch { /* ignore poll errors */ }
          }, 3000);
          setTimeout(() => clearInterval(checkInterval), 300000);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || "Failed to start task");
      }
    } finally {
      setTaskRunning(false);
    }
  };

  const saveText = async () => {
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rewrittenText: text }),
    });
    toast.success("Saved");
  };

  const allPanels = project?.episodes?.flatMap(ep => ep.clips.flatMap(c => c.panels)) || [];

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[var(--muted)]">Loading...</div>;
  if (!project) return <div className="min-h-screen flex items-center justify-center text-[var(--danger)]">Project not found</div>;

  return (
    <div className="min-h-screen" onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}>
      {/* Header */}
      <header className="border-b border-[var(--border)] px-6 py-3 flex items-center gap-4">
        <button onClick={() => router.push("/")} className="text-[var(--muted)] hover:text-[var(--foreground)]">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-semibold">{project.title}</h1>
        {project.status && project.status !== "draft" && (
          <span className={`ml-auto px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 ${
            ["analyzing", "rewriting", "storyboarding", "generating"].includes(project.status)
              ? "bg-[var(--primary)]/20 text-[var(--primary)]"
              : project.status === "completed"
                ? "bg-[var(--success)]/20 text-[var(--success)]"
                : "bg-[var(--muted)]/20 text-[var(--muted)]"
          }`}>
            {["analyzing", "rewriting", "storyboarding", "generating"].includes(project.status) && (
              <Loader2 size={12} className="animate-spin" />
            )}
            {project.status}
          </span>
        )}
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Step 1: Upload Video */}
        <section className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Upload size={20} className="text-[var(--primary)]" />
            {t("project.step1")}
          </h2>
          {project.sourceVideoUrl ? (
            <div className="space-y-3">
              <video src={project.sourceVideoUrl} controls className="w-full rounded-lg max-h-64 bg-black" />
              {lastError && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 mb-3">
                  <span className="text-red-400 text-lg">✕</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-red-400">任务失败</p>
                    <p className="text-xs text-[var(--muted)]">{lastError}</p>
                  </div>
                  <button onClick={() => setLastError(null)} className="text-[var(--muted)] hover:text-[var(--foreground)] text-sm">关闭</button>
                </div>
              )}
              {project.status === "analyzing" ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/30">
                  <Loader2 size={20} className="animate-spin text-[var(--primary)]" />
                  <div>
                    <p className="text-sm font-medium">正在分析视频...</p>
                    <p className="text-xs text-[var(--muted)]">AI 正在提取关键帧并生成文字描述，请稍候</p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => triggerTask("analyze")}
                    disabled={taskRunning}
                    className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                  >
                    {taskRunning ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    {t("project.analyze")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <label
              className="block border-2 border-dashed border-[var(--border)] rounded-xl p-12 text-center cursor-pointer hover:border-[var(--primary)] transition"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files?.[0];
                if (file && file.type.startsWith("video/")) uploadVideo(file);
                else toast.error("请拖入视频文件");
              }}
            >
              <Upload size={32} className="mx-auto mb-2 text-[var(--muted)]" />
              <p className="text-[var(--muted)]">拖拽视频文件或点击上传</p>
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadVideo(file);
                }}
              />
            </label>
          )}
        </section>

        {/* Step 2: Text Edit */}
        {(project.analyzedText || project.rewrittenText) && (
          <section className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Wand2 size={20} className="text-[var(--primary)]" />
              {t("project.step2")}
            </h2>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              className="w-full px-4 py-3 rounded-lg bg-[var(--background)] border border-[var(--border)] focus:border-[var(--primary)] focus:outline-none resize-y font-mono text-sm"
            />
            <div className="flex gap-2 mt-3">
              <button onClick={saveText} className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--card-hover)]">
                保存
              </button>
              <button
                onClick={() => triggerTask("rewrite")}
                disabled={taskRunning}
                className="px-4 py-2 rounded-lg bg-[var(--secondary)] text-white text-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
              >
                {taskRunning ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                {t("project.rewrite")}
              </button>
            </div>
          </section>
        )}

        {/* Step 3: Storyboard */}
        {(project.rewrittenText || project.analyzedText) && (
          <section className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <LayoutGrid size={20} className="text-[var(--primary)]" />
              {t("project.step3")}
            </h2>

            {allPanels.length === 0 ? (
              <div className="text-center py-8">
                <button
                  onClick={() => triggerTask("storyboard")}
                  disabled={taskRunning}
                  className="px-6 py-3 rounded-lg bg-gradient-to-r from-[var(--primary)] to-[var(--secondary)] text-white font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2 mx-auto"
                >
                  {taskRunning ? <Loader2 size={16} className="animate-spin" /> : <LayoutGrid size={16} />}
                  {t("project.storyboard")}
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
                  {allPanels.map((panel) => (
                    <div key={panel.id} className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--background)]">
                      {panel.imageUrl ? (
                        <img src={panel.imageUrl} alt="" className="w-full aspect-video object-cover" />
                      ) : (
                        <div className="w-full aspect-video bg-[var(--card-hover)] flex items-center justify-center text-[var(--muted)] text-xs">
                          No image
                        </div>
                      )}
                      <div className="p-2 text-xs text-[var(--muted)] truncate">
                        {panel.sceneDescription || panel.imagePrompt || `Panel ${panel.sortOrder + 1}`}
                      </div>
                      {panel.videoUrl && (
                        <div className="px-2 pb-2">
                          <span className="text-xs text-[var(--success)]">Video ready</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => triggerTask("generate", { type: "image" })}
                    disabled={taskRunning}
                    className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm hover:opacity-90 disabled:opacity-50"
                  >
                    {t("project.generateImages")}
                  </button>
                  <button
                    onClick={() => triggerTask("generate", { type: "video" })}
                    disabled={taskRunning}
                    className="px-4 py-2 rounded-lg bg-[var(--secondary)] text-white text-sm hover:opacity-90 disabled:opacity-50"
                  >
                    {t("project.generateVideos")}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {/* Step 4: Compose & Download */}
        {allPanels.some(p => p.videoUrl) && (
          <section className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Film size={20} className="text-[var(--primary)]" />
              {t("project.step4")}
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const episodeId = project.episodes?.[0]?.id;
                  if (episodeId) triggerTask("compose", { episodeId });
                }}
                disabled={taskRunning}
                className="px-6 py-3 rounded-lg bg-gradient-to-r from-[var(--primary)] to-[var(--secondary)] text-white font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
              >
                <Film size={16} />
                {t("project.compose")}
              </button>
              {project.episodes?.[0]?.composition?.outputUrl && (
                <a
                  href={project.episodes[0].composition.outputUrl}
                  download
                  className="px-6 py-3 rounded-lg border border-[var(--border)] font-medium hover:bg-[var(--card-hover)] flex items-center gap-2"
                >
                  <Download size={16} />
                  {t("project.download")}
                </a>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
