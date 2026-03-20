import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { sharedSubscriber } from "@/lib/sse/shared-subscriber";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = token.sub;
  const projectId = req.nextUrl.searchParams.get("projectId");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      };

      send("connected", JSON.stringify({ userId }));

      const unsubscribe = await sharedSubscriber.subscribe((message) => {
        try {
          const parsed = JSON.parse(message);
          // Only send events for this user's projects
          if (projectId && parsed.projectId && parsed.projectId !== projectId) {
            return;
          }
          send("task-progress", message);
        } catch {
          // Ignore malformed messages
        }
      });

      // Keep-alive ping every 30s
      const pingTimer = setInterval(() => {
        try {
          send("ping", "{}");
        } catch {
          clearInterval(pingTimer);
        }
      }, 30_000);

      // Cleanup on close
      req.signal.addEventListener("abort", () => {
        clearInterval(pingTimer);
        unsubscribe();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
