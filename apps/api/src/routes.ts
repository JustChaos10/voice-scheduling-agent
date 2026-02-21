import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { ConversationEngine } from "./conversation.js";

const messageBodySchema = z.object({
  sessionId: z.string().uuid(),
  userMessage: z.string().min(1)
});

const confirmBodySchema = z.object({
  sessionId: z.string().uuid(),
  confirmed: z.boolean()
});

const startBodySchema = z.object({
  timezone: z.string().min(1).optional()
});

function sendValidationError(reply: FastifyReply, message: string) {
  return reply.status(400).send({
    error: "VALIDATION_ERROR",
    message
  });
}

export async function registerRoutes(app: FastifyInstance, engine: ConversationEngine): Promise<void> {
  app.get("/health", async () => ({ ok: true }));

  app.post("/v1/session/start", async (request, reply) => {
    const parsed = startBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues[0]?.message ?? "Invalid request body.");
    }

    const response = engine.startSession(parsed.data.timezone);
    return reply.status(200).send(response);
  });

  app.post("/v1/session/message", async (request, reply) => {
    const parsed = messageBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues[0]?.message ?? "Invalid request body.");
    }

    try {
      const response = await engine.handleMessage(parsed.data.sessionId, parsed.data.userMessage);
      return reply.status(200).send(response);
    } catch (error) {
      request.log.warn({ error }, "Message handling failed");
      return reply.status(404).send({
        error: "SESSION_ERROR",
        message: error instanceof Error ? error.message : "Session error."
      });
    }
  });

  app.post("/v1/session/confirm", async (request, reply) => {
    const parsed = confirmBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues[0]?.message ?? "Invalid request body.");
    }

    try {
      const response = await engine.handleConfirm(parsed.data.sessionId, parsed.data.confirmed);
      return reply.status(200).send(response);
    } catch (error) {
      request.log.warn({ error }, "Confirm handling failed");
      return reply.status(404).send({
        error: "SESSION_ERROR",
        message: error instanceof Error ? error.message : "Session error."
      });
    }
  });
}
