import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

/** Template placeholders from .env.example count as "not configured". */
const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (!v || v.startsWith('YOUR_') || v.startsWith('replace-') ? undefined : v));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  AUTH_SESSION_SECRET: z.string().min(32, 'AUTH_SESSION_SECRET must be at least 32 characters'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  PAYPAL_ENVIRONMENT: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_CLIENT_ID: optionalSecret,
  PAYPAL_CLIENT_SECRET: optionalSecret,
  PAYPAL_WEBHOOK_ID: optionalSecret,
  PAYPAL_MCP_ENABLED: bool,
  PAYPAL_MCP_MODE: z.enum(['local', 'remote']).default('local'),
  PAYPAL_MCP_URL: z.string().optional(),
  PAYPAL_MCP_ALLOWED_TOOLS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ENABLE_LIVE_PAYPAL_WRITES: bool,
  LLM_PROVIDER: z.enum(['fixture', 'openai', 'anthropic', 'gemini']).default('fixture'),
  LLM_MODEL: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  OPENAI_API_KEY: optionalSecret,
  GEMINI_API_KEY: optionalSecret,
  ANTHROPIC_API_KEY: optionalSecret,
  /** Presence is reported only; the Channel3 discovery adapter is not integrated yet. */
  CHANNEL3_API_KEY: optionalSecret,
  DEMO_MODE: bool,
  DEMO_AUTH_ENABLED: bool,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  const envFile = join(process.cwd(), '.env');
  if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envFile);
  }
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  assertProductionSafety(parsed.data);
  cached = parsed.data;
  return cached;
}

/** Production must never boot with demo identity, demo data, wildcard origins or a weak secret. */
export function assertProductionSafety(env: Env): void {
  if (env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (env.DEMO_MODE) problems.push('DEMO_MODE must be false in production');
  if (env.DEMO_AUTH_ENABLED) problems.push('DEMO_AUTH_ENABLED must be false in production');
  if (env.AUTH_SESSION_SECRET.length < 48) problems.push('AUTH_SESSION_SECRET is too short');
  if (env.ALLOWED_ORIGINS.some((o) => o === '*' || !o.startsWith('https://'))) {
    problems.push('ALLOWED_ORIGINS must be explicit https origins');
  }
  if (!env.PUBLIC_BASE_URL.startsWith('https://')) problems.push('PUBLIC_BASE_URL must use https');
  if (problems.length > 0) {
    throw new Error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  }
}

export const ENV = Symbol('ENV');
