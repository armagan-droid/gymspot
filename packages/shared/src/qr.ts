import * as ed from "@noble/ed25519";
import { z } from "zod";

// Signed check-in / handoff QR tokens — specs/07 "Check-in / devir QR token'ı".
// Shared by the station tablet (offline verification) and the API.

export const QR_TTL_MS = 2 * 60_000;
export const QR_CLOCK_SKEW_MS = 30_000;
export const DELEGATION_TTL_MS = 24 * 60 * 60_000;

// TextEncoder/TextDecoder exist in browsers and Node; the shared package is
// compiled without DOM/Node typings, so declare just what we use.
declare const TextEncoder: { new (): { encode(s: string): Uint8Array } };
declare const TextDecoder: { new (): { decode(b: Uint8Array): string } };

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += B64[n & 63]!;
  }
  return out;
}

export function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error("invalid base64url");
  const bytes: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 255);
    }
  }
  return new Uint8Array(bytes);
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

export const QrDelegationSchema = z.strictObject({
  v: z.literal(1),
  tid: z.uuid(),
  mid: z.uuid(),
  /** Phone's Ed25519 public key, base64url. */
  pk: z.string().min(1),
  /** Camera consent at issue time (AC-7.4). */
  consent: z.boolean(),
  exp: z.number().int(),
});
export type QrDelegation = z.infer<typeof QrDelegationSchema>;

export const QrPayloadSchema = z.strictObject({
  v: z.literal(1),
  tid: z.uuid(),
  mid: z.uuid(),
  sid: z.uuid(),
  bi: z.int().nonnegative(),
  si: z.int().nonnegative(),
  jti: z.string().min(1).max(64),
  exp: z.number().int(),
});
export type QrPayload = z.infer<typeof QrPayloadSchema>;

export interface SignedDelegation {
  delegation: QrDelegation;
  /** base64url(JSON) and base64url(signature) as they appear in the QR. */
  body: string;
  sig: string;
}

export interface KeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyB64: string;
}

export async function publicKeyFromSecret(secretKey: Uint8Array): Promise<Uint8Array> {
  return ed.getPublicKeyAsync(secretKey);
}

export async function generateKeyPair(): Promise<KeyPair> {
  const secretKey = ed.utils.randomSecretKey();
  const publicKey = await ed.getPublicKeyAsync(secretKey);
  return { secretKey, publicKey, publicKeyB64: toBase64Url(publicKey) };
}

async function signPart(value: unknown, secretKey: Uint8Array): Promise<{ body: string; sig: string }> {
  const body = toBase64Url(utf8(JSON.stringify(value)));
  const sig = toBase64Url(await ed.signAsync(utf8(body), secretKey));
  return { body, sig };
}

/** Server side: certify the phone's public key with the tenant key. */
export async function signDelegation(delegation: QrDelegation, tenantSecretKey: Uint8Array): Promise<SignedDelegation> {
  return { delegation, ...(await signPart(QrDelegationSchema.parse(delegation), tenantSecretKey)) };
}

/** Phone side: sign a check-in payload; works offline while the delegation is valid. */
export async function createQr(payload: QrPayload, phoneSecretKey: Uint8Array, d: SignedDelegation): Promise<string> {
  const p = await signPart(QrPayloadSchema.parse(payload), phoneSecretKey);
  return [p.body, p.sig, d.body, d.sig].join(".");
}

export type QrVerification =
  | { ok: true; payload: QrPayload; delegation: QrDelegation }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "delegation_expired" | "mismatch" };

/** Verifies signatures, binding and lifetimes. Single use (jti) is up to the caller. */
export async function verifyQr(qr: string, tenantPublicKey: Uint8Array, now: number): Promise<QrVerification> {
  const parts = qr.split(".");
  if (parts.length !== 4 || parts.some((p) => p.length === 0)) return { ok: false, reason: "malformed" };
  const [pBody, pSig, dBody, dSig] = parts as [string, string, string, string];

  let payload: QrPayload;
  let delegation: QrDelegation;
  let phoneKey: Uint8Array;
  let payloadSig: Uint8Array;
  let delegationSig: Uint8Array;
  try {
    payload = QrPayloadSchema.parse(JSON.parse(fromUtf8(fromBase64Url(pBody))));
    delegation = QrDelegationSchema.parse(JSON.parse(fromUtf8(fromBase64Url(dBody))));
    phoneKey = fromBase64Url(delegation.pk);
    payloadSig = fromBase64Url(pSig);
    delegationSig = fromBase64Url(dSig);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const verify = async (sig: Uint8Array, body: string, key: Uint8Array) => {
    try {
      return await ed.verifyAsync(sig, utf8(body), key);
    } catch {
      return false;
    }
  };
  if (!(await verify(delegationSig, dBody, tenantPublicKey))) return { ok: false, reason: "bad_signature" };
  if (!(await verify(payloadSig, pBody, phoneKey))) return { ok: false, reason: "bad_signature" };
  if (payload.tid !== delegation.tid || payload.mid !== delegation.mid) return { ok: false, reason: "mismatch" };
  if (now > delegation.exp) return { ok: false, reason: "delegation_expired" };
  if (now > payload.exp || payload.exp > now + QR_TTL_MS + QR_CLOCK_SKEW_MS) return { ok: false, reason: "expired" };
  return { ok: true, payload, delegation };
}

/** Offline single-use registry for the tablet (specs/07). */
export class LocalJtiRegistry {
  private used = new Map<string, number>();

  get size(): number {
    return this.used.size;
  }

  /** Returns false if the jti was already used. Entries are pruned after they expire. */
  use(jti: string, exp: number, now: number): boolean {
    for (const [k, e] of this.used) if (e < now) this.used.delete(k);
    if (this.used.has(jti)) return false;
    this.used.set(jti, exp);
    return true;
  }
}
