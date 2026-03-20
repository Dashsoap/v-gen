import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isErrorResponse } from "@/lib/api-auth";
import { apiHandler } from "@/lib/api-errors";

export const GET = apiHandler(async () => {
  const auth = await requireAuth();
  if (isErrorResponse(auth)) return auth;

  const pref = await prisma.userPreference.findUnique({
    where: { userId: auth.user.id },
  });

  return NextResponse.json(pref || {});
});

export const PUT = apiHandler(async (req: NextRequest) => {
  const auth = await requireAuth();
  if (isErrorResponse(auth)) return auth;

  const body = await req.json();

  const pref = await prisma.userPreference.upsert({
    where: { userId: auth.user.id },
    create: { userId: auth.user.id, ...body },
    update: body,
  });

  return NextResponse.json(pref);
});
