import { createHash, hkdfSync, randomBytes } from "node:crypto";
import { publicKeyFromSecret } from "@gymspot/shared";
import { SignJWT, jwtVerify } from "jose";

// Token helpers — specs/07 "Token ayrıntıları".

export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
export const MAGIC_LINK_TTL_MS = 15 * 60_000;
export const PAIRING_CODE_TTL_MS = 10 * 60_000;

export type SubjectKind = "user" | "member" | "device";
export type StaffRole = "owner" | "manager" | "trainer";

export interface AuthContext {
  sub: string;
  tid: string;
  kind: SubjectKind;
  role?: StaffRole;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `<tenantId>.<random>` so lookups can run under the right tenant (RLS). */
export function tenantToken(tenantId: string): string {
  return `${tenantId}.${randomBytes(32).toString("base64url")}`;
}

export function tenantOf(token: string): string | null {
  const [tid, secret] = token.split(".");
  return tid && secret && UUID.test(tid) ? tid.toLowerCase() : null;
}

/** Only digests are stored (specs/07). */
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
export function pairingCode(): string {
  return [...randomBytes(8)].map((b) => PAIRING_ALPHABET[b % PAIRING_ALPHABET.length]).join("");
}

export class AccessTokens {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly now: () => number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(ctx: AuthContext): Promise<string> {
    const iat = Math.floor(this.now() / 1000);
    const claims: Record<string, string> = { tid: ctx.tid, kind: ctx.kind };
    if (ctx.role) claims.role = ctx.role;
    return new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject(ctx.sub).setIssuedAt(iat).setExpirationTime(iat + ACCESS_TTL_S).sign(this.key);
  }

  async verify(token: string): Promise<AuthContext | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"], currentDate: new Date(this.now()) });
      if (typeof payload.sub !== "string" || typeof payload.tid !== "string" || typeof payload.kind !== "string") return null;
      return {
        sub: payload.sub,
        tid: payload.tid,
        kind: payload.kind as SubjectKind,
        ...(typeof payload.role === "string" && { role: payload.role as StaffRole }),
      };
    } catch {
      return null;
    }
  }
}

/** Per-tenant Ed25519 QR signing key derived from the master secret (never stored). */
export class TenantKeys {
  private readonly cache = new Map<string, Promise<{ secretKey: Uint8Array; publicKey: Uint8Array }>>();

  constructor(private readonly masterSecret: string) {}

  get(tenantId: string) {
    let entry = this.cache.get(tenantId);
    if (!entry) {
      const secretKey = new Uint8Array(hkdfSync("sha256", this.masterSecret, "gymspot-qr-v1", tenantId, 32));
      entry = publicKeyFromSecret(secretKey).then((publicKey) => ({ secretKey, publicKey }));
      this.cache.set(tenantId, entry);
    }
    return entry;
  }
}
