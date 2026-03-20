import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface AuthSession {
  user: {
    id: string;
    email?: string | null;
    name?: string | null;
    image?: string | null;
  };
}

export interface ProjectAuthContext {
  session: AuthSession;
  project: {
    id: string;
    userId: string;
    title: string;
  };
}

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function notFound(resource = "Resource") {
  return NextResponse.json({ error: `${resource} not found` }, { status: 404 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function serverError(message = "Internal server error") {
  return NextResponse.json({ error: message }, { status: 500 });
}

export function isErrorResponse(result: unknown): result is NextResponse {
  return result instanceof NextResponse;
}

export async function requireAuth(): Promise<AuthSession | NextResponse> {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return unauthorized();
  }
  return session as AuthSession;
}

export async function requireProjectAuth(
  projectId: string
): Promise<ProjectAuthContext | NextResponse> {
  const authResult = await requireAuth();
  if (isErrorResponse(authResult)) return authResult;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: authResult.user.id },
    select: { id: true, userId: true, title: true },
  });

  if (!project) {
    return notFound("Project");
  }

  return { session: authResult, project };
}
