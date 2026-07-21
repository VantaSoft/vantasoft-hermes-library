import { UserInputError } from "./config.js";

export interface SafeError {
  error: string;
  statusCode?: number;
  requestId?: string;
  retryable: boolean;
}

function statusFrom(error: Record<string, unknown>): number | undefined {
  const candidates = [
    error.networkStatusCode,
    error.statusCode,
    error.status,
    (error.response as Record<string, unknown> | undefined)?.status,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function sanitizeError(error: unknown): SafeError {
  if (error instanceof UserInputError) {
    return { error: error.message, retryable: false };
  }

  const object =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const statusCode = statusFrom(object);
  let message = "Shopify Admin API request failed";
  if (statusCode === 401) message = "Shopify authorization failed";
  else if (statusCode === 403) message = "Shopify API access was denied";
  else if (statusCode === 429) message = "Shopify API rate limit exceeded";
  else if (statusCode && statusCode >= 500)
    message = "Shopify API is temporarily unavailable";

  const requestIdCandidate =
    object.requestId ??
    (object.headers as Record<string, unknown> | undefined)?.["x-request-id"];
  const requestId =
    typeof requestIdCandidate === "string" &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(requestIdCandidate)
      ? requestIdCandidate
      : undefined;

  return {
    error: message,
    ...(statusCode ? { statusCode } : {}),
    ...(requestId ? { requestId } : {}),
    retryable: statusCode === 429 || Boolean(statusCode && statusCode >= 500),
  };
}
