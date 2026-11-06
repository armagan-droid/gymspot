import { hash, verify } from "@node-rs/argon2";

// Staff passwords: Argon2id (specs/07). @node-rs/argon2 defaults to Argon2id.

export const hashPassword = (password: string) => hash(password);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** Spends comparable time when the user does not exist (no account enumeration by timing). */
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(await dummy, password);
}
