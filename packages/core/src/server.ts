import Fastify from "fastify";

import { runnerErrorResponseSchema } from '@cua-sample/contracts';
import { RunnerCoreError, toRunnerErrorResponse } from './errors.js';

type CreateServerOptions = { allowedOrigins?: string[] };

const defaultAllowedOrigins = ["http:", "https:"].flatMap((protocol) =>
  ["localhost", "127.0.0.1", "[::1]"].flatMap((host) =>
    [`${protocol}//${host}:3000`],
  ),
);

export function createServer(options: CreateServerOptions = {}) {
  const app = Fastify({ logger: false });
  const allowedOrigins = new Set([
    ...defaultAllowedOrigins,
    ...(options.allowedOrigins ?? process.env.CUA_ALLOWED_ORIGINS?.split(",") ?? [])
      .map((origin) => origin.trim())
      .filter(Boolean),
  ]);

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin) && origin !== `http://${request.headers.host}`) {
      return reply.code(403).send({
        code: "origin_not_allowed",
        error: "This origin is not allowed to access the gateway.",
        hint: "Use the local operator console or configure CUA_ALLOWED_ORIGINS.",
      });
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("Vary", "Origin");
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Headers", "content-type");
      reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }
    return payload;
  });

  app.options("*", async (_request, reply) => {
    reply.code(204);
    return null;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RunnerCoreError) {
      reply.code(error.statusCode).send(
        runnerErrorResponseSchema.parse(toRunnerErrorResponse(error)),
      );
      return;
    }

    if (error instanceof Error && "issues" in error) {
      reply.code(400).send(
        runnerErrorResponseSchema.parse({
          code: "invalid_request",
          error: error.message,
          hint:
            "Review the request payload against the shared API contracts.",
        }),
      );
      return;
    }

    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 && error.statusCode < 500
    ) {
      reply.code(error.statusCode).send({
        code: "invalid_request",
        error: error.message,
        hint: "Send a valid JSON request matching the shared API contracts.",
      });
      return;
    }

    console.error("Unexpected runner request error:", error);
    reply.code(500).send(
      runnerErrorResponseSchema.parse({
        code: "internal_runner_error",
        error: "Internal runner error",
        hint: "Check the runner logs for the full stack trace.",
      }),
    );
  });

  app.get('/health', async () => ({status:'ok',service:'tokenflow'}));

  return app;
}
