import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isErrorResponse } from "@/lib/api-auth";
import { encrypt, maskApiKey } from "@/lib/crypto";
import { apiHandler } from "@/lib/api-errors";

export const GET = apiHandler(async () => {
  const auth = await requireAuth();
  if (isErrorResponse(auth)) return auth;

  const pref = await prisma.userPreference.findUnique({
    where: { userId: auth.user.id },
    select: {
      customProviders: true,
      customModels: true,
      defaultLlmModel: true,
      defaultImageModel: true,
      defaultVideoModel: true,
      defaultAudioModel: true,
      ttsVoice: true,
    },
  });

  // Mask API keys in providers
  let providers = [];
  if (pref?.customProviders) {
    try {
      providers = JSON.parse(pref.customProviders).map((p: { apiKey?: string; [key: string]: unknown }) => ({
        ...p,
        apiKey: p.apiKey ? maskApiKey("encrypted") : undefined,
        hasApiKey: !!p.apiKey,
      }));
    } catch { /* empty */ }
  }

  let models = [];
  if (pref?.customModels) {
    try {
      models = JSON.parse(pref.customModels);
    } catch { /* empty */ }
  }

  return NextResponse.json({
    providers,
    models,
    defaults: {
      llm: pref?.defaultLlmModel,
      image: pref?.defaultImageModel,
      video: pref?.defaultVideoModel,
      audio: pref?.defaultAudioModel,
    },
    ttsVoice: pref?.ttsVoice || "alloy",
  });
});

export const PUT = apiHandler(async (req: NextRequest) => {
  const auth = await requireAuth();
  if (isErrorResponse(auth)) return auth;

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.providers) {
    // Encrypt API keys
    const encrypted = body.providers.map((p: { apiKey?: string; [key: string]: unknown }) => ({
      ...p,
      apiKey: p.apiKey && !p.apiKey.startsWith("encrypted") ? encrypt(p.apiKey) : p.apiKey,
    }));
    data.customProviders = JSON.stringify(encrypted);
  }

  if (body.models) {
    data.customModels = JSON.stringify(body.models);
  }

  if (body.defaults) {
    if (body.defaults.llm !== undefined) data.defaultLlmModel = body.defaults.llm;
    if (body.defaults.image !== undefined) data.defaultImageModel = body.defaults.image;
    if (body.defaults.video !== undefined) data.defaultVideoModel = body.defaults.video;
    if (body.defaults.audio !== undefined) data.defaultAudioModel = body.defaults.audio;
  }

  if (body.ttsVoice) data.ttsVoice = body.ttsVoice;

  await prisma.userPreference.upsert({
    where: { userId: auth.user.id },
    create: { userId: auth.user.id, ...data },
    update: data,
  });

  return NextResponse.json({ ok: true });
});
