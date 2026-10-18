import type { ErrorRequestHandler } from "express";
import type { Options } from "pino-http";

// Log known route shapes only. Unknown/invalid paths may themselves contain
// credentials or preferences; never echo them into logs.
export function safeRequestUrl(url: string | undefined): string {
  if (!url) return "[REDACTED]";
  let path: string;
  try {
    path = decodeURIComponent(url.split(/[?#]/, 1)[0]);
  } catch {
    return "[REDACTED]";
  }
  if (/^\/api\/(?:healthz|rooms)\/?$/i.test(path)) return path;
  const room = path.match(/^\/api\/rooms\/([a-z0-9]{4})(?:\/(.*))?$/i);
  if (!room) return "[REDACTED]";
  const prefix = `/api/rooms/${room[1]}`;
  const suffix = room[2] ?? "";
  if (/^(?:join|preferences|reset|recommendations\/reroll)\/?$/i.test(suffix)) {
    return `${prefix}/${suffix}`;
  }
  if (/^participants(?:\/|$)/i.test(suffix)) {
    return `${prefix}/participants/[REDACTED]`;
  }
  return `${prefix}/[REDACTED]`;
}

// Error messages, stacks, causes, SQL params and parser bodies can all contain
// private input. Keep an allowlist, rather than attempting to scrub free text.
export function safeError(error: { status?: unknown; statusCode?: unknown }) {
  const status = error?.statusCode ?? error?.status;
  return {
    type: "Error",
    ...(typeof status === "number" && Number.isInteger(status) &&
    status >= 400 && status <= 599 ? { statusCode: status } : {}),
  };
}

export const httpLoggingOptions: Options = {
  serializers: {
    req(req) {
      return { id: req.id, method: req.method, url: safeRequestUrl(req.url) };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
    err: safeError,
  },
};

// Express's default error handler writes raw errors to stderr (even in
// production). Handle them here and let pino-http emit the safe error record.
export const privateErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = safeError(error).statusCode ?? 500;
  res.err = error;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.status(status).json({
    error: status < 500 ? "请求格式不正确，请检查后重试。" : "服务暂时不可用，请稍后重试。",
  });
};
