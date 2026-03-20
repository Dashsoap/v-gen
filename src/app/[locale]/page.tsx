"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Video, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

interface Project {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export default function HomePage() {
  const t = useTranslations();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const createProject = async () => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "新项目" }),
    });
    const project = await res.json();
    router.push(`/projects/${project.id}`);
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] flex items-center justify-center font-bold text-white">
            V
          </div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-[var(--primary)] to-[var(--secondary)] bg-clip-text text-transparent">
            {t("app.title")}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/settings")}
            className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition"
          >
            {t("nav.settings")}
          </button>
          <button
            onClick={() => signOut()}
            className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition flex items-center gap-1"
          >
            <LogOut size={14} />
            {t("nav.signOut")}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-semibold">{t("nav.projects")}</h2>
          <button
            onClick={createProject}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[var(--primary)] to-[var(--secondary)] text-white font-medium hover:opacity-90 transition"
          >
            <Plus size={18} />
            {t("project.create")}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-20 text-[var(--muted)]">Loading...</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20">
            <Video size={48} className="mx-auto mb-4 text-[var(--muted)]" />
            <p className="text-[var(--muted)]">还没有项目，点击上方按钮创建</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => router.push(`/projects/${project.id}`)}
                className="text-left p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--card-hover)] transition"
              >
                <h3 className="font-medium mb-2">{project.title}</h3>
                <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    project.status === "completed" ? "bg-[var(--success)]" :
                    project.status === "draft" ? "bg-[var(--muted)]" :
                    "bg-[var(--primary)]"
                  }`} />
                  <span>{project.status}</span>
                  <span>·</span>
                  <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
