import { randomBytes } from "node:crypto";

export interface AppConfig {
  /** HS256 secret for access tokens (≥ 32 bytes). */
  jwtSecret: string;
  /** Master secret the per-tenant QR signing keys are derived from. */
  qrMasterSecret: string;
  /** Base URL of the web app, used in magic links. */
  appBaseUrl: string;
  /** Clock (epoch ms); injectable for tests. */
  now: () => number;
  /** Delivers a magic link (e-mail/SMS provider; logged in development). */
  sendMagicLink: (to: string, link: string, tenantId: string) => Promise<void>;
  /** Requests per minute per client on auth endpoints (specs/07 rate limit). */
  authRateLimit: number;
  /** AES-256 key (32 bytes) for calibration recordings at rest (specs/07). */
  calibrationKey: Uint8Array;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === "production";
  const secret = (name: string) => {
    const v = env[name];
    if (v) return v;
    if (production) throw new Error(`${name} must be set in production`);
    return randomBytes(32).toString("base64url"); // dev only: tokens die with the process
  };
  return {
    jwtSecret: secret("JWT_SECRET"),
    qrMasterSecret: secret("QR_MASTER_SECRET"),
    appBaseUrl: env.APP_BASE_URL ?? "https://localhost:5173",
    now: () => Date.now(),
    sendMagicLink: async (to, link) => {
      if (production) throw new Error("no magic link provider configured");
      console.info(`[dev] magic link for ${to}: ${link}`);
    },
    authRateLimit: Number(env.AUTH_RATE_LIMIT ?? 30),
    calibrationKey: (() => {
      const key = Buffer.from(secret("CALIBRATION_ENCRYPTION_KEY"), "base64url");
      if (key.length !== 32) throw new Error("CALIBRATION_ENCRYPTION_KEY must be 32 bytes (base64url)");
      return key;
    })(),
  };
}
