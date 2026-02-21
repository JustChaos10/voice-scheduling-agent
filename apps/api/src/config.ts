import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.string().default("info"),
  SESSION_TTL_MINUTES: z.coerce.number().default(30),
  DEFAULT_TIMEZONE: z.string().default("America/New_York"),
  DEFAULT_DURATION_MIN: z.coerce.number().default(30),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  GOOGLE_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  CORS_ORIGIN: z.string().default("*")
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  return envSchema.parse(process.env);
}

