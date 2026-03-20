import { createScopedLogger } from "@/lib/logging";

const logger = createScopedLogger({ module: "retry" });

export interface RetryOptions {
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms (default: 5000) */
  baseDelay?: number;
  /** Max delay cap in ms (default: 120000 = 2 min) */
  maxDelay?: number;
  /** Label for logging */
  label?: string;
}

/**
 * Check if an error is retryable (429, 5xx, network errors).
 */
export function isRetryableError(err: unknown): boolean {
  // HTTP status-based
  if (err && typeof err === "object") {
    const status =
      (err as { status?: number }).status ??
      (err as { statusCode?: number }).statusCode;
    if (status && [429, 500, 502, 503, 504].includes(status)) return true;
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Rate limit keywords
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests")) return true;
    // Server errors
    if (msg.includes("502") || msg.includes("503") || msg.includes("504")) return true;
    if (msg.includes("internal server error") || msg.includes("bad gateway") || msg.includes("service unavailable")) return true;
    // Network errors
    if (msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("socket hang up") || msg.includes("network") || msg.includes("fetch failed")) return true;
  }

  return false;
}

/**
 * Extract Retry-After delay from error (in ms).
 * Returns 0 if not found.
 */
function extractRetryAfter(err: unknown): number {
  if (err && typeof err === "object") {
    const headers = (err as { headers?: Record<string, string> }).headers;
    const retryAfter = headers?.["retry-after"] ?? headers?.["Retry-After"];
    if (retryAfter) {
      const secs = parseInt(retryAfter, 10);
      if (!isNaN(secs) && secs > 0) return secs * 1000;
    }
  }
  return 0;
}

/**
 * Compute delay for a given attempt with jitter.
 * For 429, uses Retry-After if available, otherwise longer backoff.
 */
function computeDelay(attempt: number, err: unknown, opts: Required<RetryOptions>): number {
  // Respect Retry-After header
  const retryAfter = extractRetryAfter(err);
  if (retryAfter > 0) {
    return Math.min(retryAfter + Math.random() * 1000, opts.maxDelay);
  }

  // Check if it's a 429
  const is429 =
    (err && typeof err === "object" && (err as { status?: number }).status === 429) ||
    (err instanceof Error && err.message.includes("429"));

  // 429: longer backoff (10s, 20s, 40s) with jitter
  // Others: standard exponential (5s, 10s, 20s) with jitter
  const base = is429 ? opts.baseDelay * 2 : opts.baseDelay;
  const exponential = base * Math.pow(2, attempt);
  const jitter = Math.random() * opts.baseDelay;
  return Math.min(exponential + jitter, opts.maxDelay);
}

/**
 * Execute a function with retry on transient errors.
 * Handles 429 with longer backoff and Retry-After header support.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const opts = {
    maxRetries: options?.maxRetries ?? 3,
    baseDelay: options?.baseDelay ?? 5000,
    maxDelay: options?.maxDelay ?? 120_000,
    label: options?.label ?? "operation",
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.maxRetries && isRetryableError(err)) {
        const delay = computeDelay(attempt, err, opts);
        logger.warn(`${opts.label} failed (attempt ${attempt + 1}/${opts.maxRetries + 1}), retrying in ${Math.round(delay / 1000)}s`, {
          error: err instanceof Error ? err.message : String(err),
        });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
