export const ERROR_CATEGORY = {
  AUTH: "AUTH",
  CONTENT: "CONTENT",
  PROVIDER: "PROVIDER",
  SYSTEM: "SYSTEM",
  VALIDATION: "VALIDATION",
} as const;

export type ErrorCategory = (typeof ERROR_CATEGORY)[keyof typeof ERROR_CATEGORY];

export const ERROR_CATALOG = {
  UNAUTHORIZED: {
    httpStatus: 401,
    retryable: false,
    category: ERROR_CATEGORY.AUTH,
    defaultMessage: "Unauthorized",
  },
  FORBIDDEN: {
    httpStatus: 403,
    retryable: false,
    category: ERROR_CATEGORY.AUTH,
    defaultMessage: "Forbidden",
  },
  NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    defaultMessage: "Resource not found",
  },
  INVALID_PARAMS: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    defaultMessage: "Invalid parameters",
  },
  MISSING_CONFIG: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    defaultMessage: "Missing required configuration",
  },
  CONFLICT: {
    httpStatus: 409,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    defaultMessage: "Conflict",
  },
  RATE_LIMIT: {
    httpStatus: 429,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    defaultMessage: "Rate limit exceeded",
  },
  QUOTA_EXCEEDED: {
    httpStatus: 429,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    defaultMessage: "Quota exceeded",
  },
  EXTERNAL_ERROR: {
    httpStatus: 502,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    defaultMessage: "External service failed",
  },
  NETWORK_ERROR: {
    httpStatus: 502,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    defaultMessage: "Network request failed",
  },
  SENSITIVE_CONTENT: {
    httpStatus: 422,
    retryable: false,
    category: ERROR_CATEGORY.CONTENT,
    defaultMessage: "Sensitive content detected",
  },
  GENERATION_TIMEOUT: {
    httpStatus: 504,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    defaultMessage: "Generation timed out",
  },
  GENERATION_FAILED: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    defaultMessage: "Generation failed",
  },
  WATCHDOG_TIMEOUT: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.SYSTEM,
    defaultMessage: "Task heartbeat timeout",
  },
  WORKER_EXECUTION_ERROR: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.SYSTEM,
    defaultMessage: "Worker execution failed",
  },
  TASK_CANCELLED: {
    httpStatus: 499,
    retryable: false,
    category: ERROR_CATEGORY.SYSTEM,
    defaultMessage: "Task cancelled by user",
  },
  INTERNAL_ERROR: {
    httpStatus: 500,
    retryable: false,
    category: ERROR_CATEGORY.SYSTEM,
    defaultMessage: "Internal server error",
  },
} as const;

export type UnifiedErrorCode = keyof typeof ERROR_CATALOG;

export const DEFAULT_ERROR_CODE: UnifiedErrorCode = "INTERNAL_ERROR";

export function isKnownErrorCode(code: unknown): code is UnifiedErrorCode {
  return typeof code === "string" && code in ERROR_CATALOG;
}

export function resolveUnifiedErrorCode(code: unknown): UnifiedErrorCode | null {
  if (isKnownErrorCode(code)) return code;
  return null;
}

export function getErrorSpec(code: UnifiedErrorCode) {
  return ERROR_CATALOG[code];
}
