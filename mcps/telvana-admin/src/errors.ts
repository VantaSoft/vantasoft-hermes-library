import { UserInputError } from "./config.js";

export class TelvanaApiError extends Error {
  constructor(
    public readonly statusCode?: number,
    public readonly upstreamRequestId?: string,
  ) {
    super("Telvana API request failed");
    this.name = "TelvanaApiError";
  }
}

export interface SafeErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    statusCode?: number;
  };
  meta: {
    environment: string;
    requestId: string;
    upstreamRequestId?: string;
  };
}

export function sanitizeError(
  error: unknown,
  environment: string,
  requestId: string,
): SafeErrorResponse {
  const statusCode =
    error instanceof TelvanaApiError ? error.statusCode : undefined;
  let code = "TELVANA_REQUEST_FAILED";
  let message = "Telvana API request failed";
  let retryable = false;

  if (error instanceof UserInputError) {
    code = "INVALID_INPUT";
    message = error.message;
  } else if (statusCode === 400) {
    code = "INVALID_REQUEST";
    message = "Telvana rejected the request";
  } else if (statusCode === 401) {
    code = "AUTHENTICATION_FAILED";
    message = "Telvana API authentication failed";
  } else if (statusCode === 403) {
    code = "AUTHORIZATION_FAILED";
    message = "Telvana API access was denied";
  } else if (statusCode === 404) {
    code = "RESOURCE_NOT_FOUND";
    message = "The requested Telvana resource was not found";
  } else if (statusCode === 409) {
    code = "CONFLICT";
    message = "Telvana rejected the request because the resource changed";
  } else if (statusCode === 429) {
    code = "RATE_LIMITED";
    message = "Telvana API rate limit exceeded";
    retryable = true;
  } else if (statusCode && statusCode >= 500) {
    code = "TELVANA_UNAVAILABLE";
    message = "Telvana API is temporarily unavailable";
    retryable = true;
  }

  const upstreamRequestId =
    error instanceof TelvanaApiError &&
    error.upstreamRequestId &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(error.upstreamRequestId)
      ? error.upstreamRequestId
      : undefined;

  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(statusCode ? { statusCode } : {}),
    },
    meta: {
      environment,
      requestId,
      ...(upstreamRequestId ? { upstreamRequestId } : {}),
    },
  };
}
