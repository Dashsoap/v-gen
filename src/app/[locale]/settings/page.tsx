"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";

export default function SettingsPage() {
  const t = useTranslations();
  const router = useRouter();

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--border)] px-6 py-3 flex items-center gap-4">
        <button onClick={() => router.push("/")} className="text-[var(--muted)] hover:text-[var(--foreground)]">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-semibold">{t("settings.title")}</h1>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8">
        <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-6">
          <h2 className="text-lg font-semibold mb-4">{t("settings.providers")}</h2>
          <p className="text-[var(--muted)] text-sm">
            API provider configuration coming soon. Configure your OpenAI, FAL, Google, and other API keys here.
          </p>
        </div>
      </main>
    </div>
  );
}
