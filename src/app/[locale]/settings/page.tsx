"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Plus, Trash2, Save, Eye, EyeOff, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

interface Provider {
  id: string;
  name: string;
  type: string; // openai | fal | google | liblib | fish-audio | elevenlabs | custom
  apiKey: string;
  baseUrl: string;
  hasApiKey?: boolean;
}

interface Defaults {
  llm?: string;
  image?: string;
  video?: string;
  audio?: string;
}

const PROVIDER_PRESETS = [
  { type: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { type: "fal", name: "FAL.ai", baseUrl: "https://fal.run" },
  { type: "google", name: "Google AI", baseUrl: "" },
  { type: "liblib", name: "LiblibAI", baseUrl: "https://openapi.liblibai.cloud" },
  { type: "fish-audio", name: "Fish Audio", baseUrl: "https://api.fish.audio" },
  { type: "elevenlabs", name: "ElevenLabs", baseUrl: "https://api.elevenlabs.io" },
  { type: "custom", name: "Custom (OpenAI Compatible)", baseUrl: "" },
];

export default function SettingsPage() {
  const t = useTranslations();
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [defaults, setDefaults] = useState<Defaults>({});
  const [ttsVoice, setTtsVoice] = useState("alloy");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/user/api-config")
      .then((r) => r.json())
      .then((data) => {
        setProviders(data.providers || []);
        setDefaults(data.defaults || {});
        setTtsVoice(data.ttsVoice || "alloy");
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const addProvider = (preset: typeof PROVIDER_PRESETS[number]) => {
    const id = `${preset.type}-${Date.now()}`;
    setProviders([...providers, {
      id,
      name: preset.name,
      type: preset.type,
      apiKey: "",
      baseUrl: preset.baseUrl,
    }]);
  };

  const removeProvider = (id: string) => {
    setProviders(providers.filter((p) => p.id !== id));
  };

  const updateProvider = (id: string, field: keyof Provider, value: string) => {
    setProviders(providers.map((p) => p.id === id ? { ...p, [field]: value } : p));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/user/api-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providers: providers.map((p) => ({
            id: p.id,
            name: p.name,
            type: p.type,
            apiKey: p.apiKey || undefined,
            baseUrl: p.baseUrl || undefined,
          })),
          defaults,
          ttsVoice,
        }),
      });
      if (res.ok) {
        toast.success("Settings saved!");
      } else {
        toast.error("Failed to save settings");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[var(--muted)]">Loading...</div>;

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--border)] px-6 py-3 flex items-center gap-4">
        <button onClick={() => router.push("/")} className="text-[var(--muted)] hover:text-[var(--foreground)]">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-semibold">{t("settings.title")}</h1>
        <button
          onClick={save}
          disabled={saving}
          className="ml-auto px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Providers */}
        <section className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-6">
          <h2 className="text-lg font-semibold mb-4">{t("settings.providers")}</h2>
          <div className="space-y-4">
            {providers.map((provider) => (
              <div key={provider.id} className="p-4 rounded-lg border border-[var(--border)] bg-[var(--background)] space-y-3">
                <div className="flex items-center justify-between">
                  <input
                    value={provider.name}
                    onChange={(e) => updateProvider(provider.id, "name", e.target.value)}
                    className="font-medium bg-transparent border-none focus:outline-none"
                  />
                  <button onClick={() => removeProvider(provider.id)} className="text-[var(--danger)] hover:opacity-70">
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[var(--muted)] mb-1 block">API Key</label>
                    <div className="relative">
                      <input
                        type={showKeys[provider.id] ? "text" : "password"}
                        value={provider.apiKey}
                        onChange={(e) => updateProvider(provider.id, "apiKey", e.target.value)}
                        placeholder={provider.hasApiKey ? "••••••••" : "Enter API key"}
                        className="w-full px-3 py-2 pr-10 rounded-lg bg-[var(--card)] border border-[var(--border)] text-sm focus:border-[var(--primary)] focus:outline-none"
                      />
                      <button
                        onClick={() => setShowKeys({ ...showKeys, [provider.id]: !showKeys[provider.id] })}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)]"
                      >
                        {showKeys[provider.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--muted)] mb-1 block">Base URL</label>
                    <input
                      value={provider.baseUrl}
                      onChange={(e) => updateProvider(provider.id, "baseUrl", e.target.value)}
                      placeholder="https://api.example.com/v1"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--border)] text-sm focus:border-[var(--primary)] focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            ))}

            {/* Add provider buttons */}
            <div className="flex flex-wrap gap-2">
              {PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.type}
                  onClick={() => addProvider(preset)}
                  className="px-3 py-1.5 rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--foreground)] transition flex items-center gap-1"
                >
                  <Plus size={14} />
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Default Models */}
        <section className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-6">
          <h2 className="text-lg font-semibold mb-4">Default Models</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {([
              { key: "llm", label: "LLM (Text)", placeholder: "e.g., gpt-4o" },
              { key: "image", label: "Image Generation", placeholder: "e.g., dall-e-3" },
              { key: "video", label: "Video Generation", placeholder: "e.g., kling-v2-1" },
              { key: "audio", label: "Audio / TTS", placeholder: "e.g., tts-1" },
            ] as const).map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="text-sm text-[var(--muted)] mb-1 block">{label}</label>
                <input
                  value={defaults[key] || ""}
                  onChange={(e) => setDefaults({ ...defaults, [key]: e.target.value || undefined })}
                  placeholder={placeholder}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm focus:border-[var(--primary)] focus:outline-none"
                />
              </div>
            ))}
          </div>
        </section>

        {/* TTS Voice */}
        <section className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-6">
          <h2 className="text-lg font-semibold mb-4">TTS Voice</h2>
          <select
            value={ttsVoice}
            onChange={(e) => setTtsVoice(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm focus:border-[var(--primary)] focus:outline-none"
          >
            {["alloy", "echo", "fable", "onyx", "nova", "shimmer"].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </section>
      </main>
    </div>
  );
}
