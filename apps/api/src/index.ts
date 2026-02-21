import "dotenv/config";

import cors from "@fastify/cors";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";

import { loadConfig } from "./config.js";
import { ConversationEngine } from "./conversation.js";
import { registerRoutes } from "./routes.js";
import { SessionStore } from "./session-store.js";

const config = loadConfig();

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL
  },
  genReqId: () => randomUUID()
});

const corsOrigin = config.CORS_ORIGIN === "*" ? true : config.CORS_ORIGIN.split(",").map((origin) => origin.trim());

await app.register(cors, {
  origin: corsOrigin
});

const store = new SessionStore(config.SESSION_TTL_MINUTES);
const engine = new ConversationEngine(config, store, app.log);

await registerRoutes(app, engine);

app.setErrorHandler((error, request, reply) => {
  request.log.error({ error }, "Unhandled error");
  void reply.status(500).send({
    error: "INTERNAL_SERVER_ERROR",
    message: "Unexpected server error."
  });
});

const start = async () => {
  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`API listening on port ${config.PORT}`);
  } catch (error) {
    app.log.error({ error }, "Failed to start API");
    process.exit(1);
  }
};

void start();
