import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logging";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteContext = { params: Promise<any> };

type ApiHandler = (
  req: NextRequest,
  ctx: RouteContext
) => Promise<NextResponse | Response>;

export function apiHandler(handler: ApiHandler): ApiHandler {
  return async (req: NextRequest, ctx: RouteContext) => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.status }
        );
      }

      logError("Unhandled API error", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function throwBadRequest(message: string): never {
  throw new ApiError("BAD_REQUEST", message, 400);
}

export function throwNotFound(resource = "Resource"): never {
  throw new ApiError("NOT_FOUND", `${resource} not found`, 404);
}

export function throwUnauthorized(message = "Unauthorized"): never {
  throw new ApiError("UNAUTHORIZED", message, 401);
}
