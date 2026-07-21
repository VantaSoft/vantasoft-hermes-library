import { UserInputError } from "./config.js";

export interface SafeError {
  error: string;
  statusCode?: number;
  requestId?: string;
  retryable: boolean;
}

function finiteStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function safeRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

export function sanitizeError(error: unknown): SafeError {
  if (error instanceof UserInputError) {
    return { error: error.message, retryable: false };
  }

  const candidate =
    typeof error === "object" && error !== null
      ? (error as Record<string, any>)
      : {};
  const response =
    typeof candidate.response === "object" && candidate.response !== null
      ? (candidate.response as Record<string, any>)
      : {};
  const headers =
    typeof response.headers === "object" && response.headers !== null
      ? (response.headers as Record<string, unknown>)
      : {};

  const statusCode =
    finiteStatus(candidate.statusCode) ??
    finiteStatus(candidate.status) ??
    finiteStatus(response.statusCode) ??
    finiteStatus(response.status);
  const requestId =
    safeRequestId(candidate.requestId) ??
    safeRequestId(headers["x-amzn-requestid"]) ??
    safeRequestId(headers["x-amz-request-id"]);

  let message = "Amazon SP-API request failed";
  if (statusCode === 401) message = "Amazon SP-API authorization failed";
  else if (statusCode === 403) message = "Amazon SP-API access was denied";
  else if (statusCode === 429) message = "Amazon SP-API rate limit exceeded";
  else if (statusCode && statusCode >= 500) {
    message = "Amazon SP-API is temporarily unavailable";
  }

  return {
    error: message,
    ...(statusCode ? { statusCode } : {}),
    ...(requestId ? { requestId } : {}),
    retryable: statusCode === 429 || Boolean(statusCode && statusCode >= 500),
  };
}
