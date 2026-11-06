import { type SignedDelegation, fromBase64Url, generateKeyPair, publicKeyFromSecret, toBase64Url } from "@gymspot/shared";
import type { GymApi } from "../api/client";

// The phone's own Ed25519 key and its server-signed delegation (specs/07).
// Renewed when less than an hour remains, so check-ins keep working offline.

const KEY = "gymspot.phone.secret";
const DELEGATION = "gymspot.phone.delegation";
export const RENEW_BEFORE_MS = 60 * 60_000;

type Storage = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export async function phoneKeys(storage: Storage): Promise<{ secretKey: Uint8Array; publicKeyB64: string }> {
  const stored = storage.getItem(KEY);
  if (stored) {
    const secretKey = fromBase64Url(stored);
    return { secretKey, publicKeyB64: toBase64Url(await publicKeyFromSecret(secretKey)) };
  }
  const kp = await generateKeyPair();
  storage.setItem(KEY, toBase64Url(kp.secretKey));
  return { secretKey: kp.secretKey, publicKeyB64: kp.publicKeyB64 };
}

/** Cached delegation, renewed online when close to expiry; null if none can be had. */
export async function ensureDelegation(storage: Storage, api: GymApi, publicKeyB64: string, now: number): Promise<SignedDelegation | null> {
  const raw = storage.getItem(DELEGATION);
  const cached = raw ? (JSON.parse(raw) as SignedDelegation) : null;
  const usable = cached && cached.delegation.pk === publicKeyB64 && cached.delegation.exp > now;
  if (usable && cached.delegation.exp - now > RENEW_BEFORE_MS) return cached;
  try {
    const fresh = await api.qrDelegation(publicKeyB64);
    storage.setItem(DELEGATION, JSON.stringify(fresh));
    return fresh;
  } catch {
    return usable ? cached : null; // offline: keep using the still-valid one
  }
}
