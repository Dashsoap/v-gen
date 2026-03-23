"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Upload, Wand2, LayoutGrid, Film, Download, Loader2, Image as ImageIcon, Play } from "lucide-react";
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
  const [panelLoading, setPanelLoading] = useState<Record<string, string>>({});

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
        const taskIds: string[] = data.taskIds || (taskId ? [taskId] : []);
        const count = data.count || taskIds.length || 1;
        toast.success(`已启动 ${count} 个任务`);
        await fetchProject();

        // Poll task status — for batch ops, poll all tasks and refresh periodically
        if (taskIds.length > 0) {
          let completedCount = 0;
          let failedCount = 0;
          const checkInterval = setInterval(async () => {
            try {
              let newCompleted = 0;
              let newFailed = 0;
              for (const tid of taskIds) {
                const taskRes = await fetch(`/api/tasks/${tid}`);
                if (!taskRes.ok) continue;
                const task = await taskRes.json();
                if (task.status === "completed") newCompleted++;
                else if (task.status === "failed") newFailed++;
              }
              // Refresh project data when progress changes
              if (newCompleted !== completedCount || newFailed !== failedCount) {
                completedCount = newCompleted;
                failedCount = newFailed;
                await fetchProject();
              }
              // All done
              if (completedCount + failedCount >= taskIds.length) {
                clearInterval(checkInterval);
                if (failedCount > 0) {
                  setLastError(`${failedCount}/${taskIds.length} 个任务失败`);
                  toast.error(`完成: ${completedCount} 成功, ${failedCount} 失败`);
                } else {
                  toast.success(`全部 ${completedCount} 个任务完成!`);
                }
              }
            } catch { /* ignore poll errors */ }
          }, 5000);
          setTimeout(() => clearInterval(checkInterval), 1800000); // 30min max
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || "Failed to start task");
      }
    } finally {
      setTaskRunning(false);
    }
  };

  const generateForPanel = async (panelId: string, type: "image" | "video") => {
    setPanelLoading((prev) => ({ ...prev, [panelId]: type }));
    try {
      const res = await fetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, panelId }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || `生成失败`);
        return;
      }
      const { taskId } = await res.json();
      toast.success(type === "image" ? "开始生成图片..." : "开始生成视频...");
      // Poll this single task
      const poll = setInterval(async () => {
        try {
          const taskRes = await fetch(`/api/tasks/${taskId}`);
          if (!taskRes.ok) return;
          const task = await taskRes.json();
          if (task.status === "completed") {
            clearInterval(poll);
            setPanelLoading((prev) => { const n = { ...prev }; delete n[panelId]; return n; });
            await fetchProject();
            toast.success("生成完成!");
          } else if (task.status === "failed") {
            clearInterval(poll);
            setPanelLoading((prev) => { const n = { ...prev }; delete n[panelId]; return n; });
            toast.error(`生成失败: ${task.error || task.errorCode || "未知错误"}`);
          }
        } catch { /* ignore */ }
      }, 5000);
      setTimeout(() => {
        clearInterval(poll);
        setPanelLoading((prev) => { const n = { ...prev }; delete n[panelId]; return n; });
      }, 1800000);
    } catch {
      toast.error("请求失败");
    } finally {
      // Don't clear panelLoading here - the polling will do it
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
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                  {allPanels.map((panel, idx) => (
                    <div key={panel.id} className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--background)]">
                      {/* Media preview */}
                      {panel.videoUrl ? (
                        <video
                          src={panel.videoUrl}
                          controls
                          preload="metadata"
                          className="w-full aspect-video object-cover bg-black"
                        />
                      ) : panel.imageUrl ? (
                        <img src={panel.imageUrl} alt="" className="w-full aspect-video object-cover" />
                      ) : (
                        <div className="w-full aspect-video bg-[var(--card-hover)] flex items-center justify-center text-[var(--muted)] text-xs">
                          No image
                        </div>
                      )}
                      {/* Info + actions */}
                      <div className="p-2 space-y-1.5">
                        <div className="text-xs text-[var(--muted)] truncate">
                          {`#${idx + 1} `}{panel.sceneDescription || panel.imagePrompt || ""}
                        </div>
                        <div className="flex gap-1.5">
                          {/* Generate image button */}
                          <button
                            onClick={() => generateForPanel(panel.id, "image")}
                            disabled={!!panelLoading[panel.id]}
                            className="flex-1 px-2 py-1 rounded text-xs border border-[var(--border)] hover:bg-[var(--card-hover)] disabled:opacity-50 flex items-center justify-center gap-1"
                            title="生成图片"
                          >
                            {panelLoading[panel.id] === "image" ? (
                              <Loader2 size={10} className="animate-spin" />
                            ) : (
                              <ImageIcon size={10} />
                            )}
                            {panel.imageUrl ? "重新生成" : "生成图片"}
                          </button>
                          {/* Generate video button */}
                          {panel.imageUrl && (
                            <button
                              onClick={() => generateForPanel(panel.id, "video")}
                              disabled={!!panelLoading[panel.id]}
                              className="flex-1 px-2 py-1 rounded text-xs border border-[var(--border)] hover:bg-[var(--card-hover)] disabled:opacity-50 flex items-center justify-center gap-1"
                              title="生成视频"
                            >
                              {panelLoading[panel.id] === "video" ? (
                                <Loader2 size={10} className="animate-spin" />
                              ) : (
                                <Play size={10} />
                              )}
                              {panel.videoUrl ? "重新生成" : "生成视频"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Stats */}
                <div className="flex gap-4 mb-3 text-xs text-[var(--muted)]">
                  <span>共 {allPanels.length} 个面板</span>
                  <span>图片: {allPanels.filter(p => p.imageUrl).length}/{allPanels.length}</span>
                  <span>视频: {allPanels.filter(p => p.videoUrl).length}/{allPanels.length}</span>
                </div>
                <div className="flex gap-2 items-center">
                  <button
                    onClick={() => triggerTask("generate", { type: "image" })}
                    disabled={taskRunning || allPanels.every(p => p.imageUrl)}
                    className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm hover:opacity-90 disabled:opacity-50"
                  >
                    {t("project.generateImages")}
                  </button>
                  <button
                    onClick={() => {
                      const withImage = allPanels.filter(p => p.imageUrl).length;
                      if (withImage === 0) {
                        toast.error("请先生成图片，再生成视频");
                        return;
                      }
                      triggerTask("generate", { type: "video" });
                    }}
                    disabled={taskRunning || allPanels.filter(p => p.imageUrl && !p.videoUrl).length === 0}
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
