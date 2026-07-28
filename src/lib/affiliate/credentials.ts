/**
 * Affiliate passwords.
 *
 * Affiliates are outsiders, not staff: they get an account each rather than
 * sharing one secret the way the shop owner's admin does. So unlike
 * `ADMIN_PASSWORD` these are stored, and storing a password means hashing it
 * properly.
 *
 * scrypt with a per-affiliate random salt. It is deliberately slow and
 * memory-hard, so a stolen `affiliates` table cannot be turned into a list of
 * plaintext passwords at any useful rate. The salt is per row, so two
 * affiliates who pick the same password still get different hashes and one
 * cracked hash reveals nothing about the other.
 *
 * Verification is constant-time. Comparing hashes with `===` would leak, byte
 * by byte, how much of a guess was right.
 *
 * This module imports `node:crypto`, so it must never be reached from a client
 * component — see `password-rules.ts`.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

export type PasswordRecord = { hash: string; salt: string };

// The rules live in their own module so the form can import them without
// dragging node:crypto into the browser bundle.
export { MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/affiliate/password-rules";

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return { hash: hash.toString("base64url"), salt };
}

/**
 * True when `candidate` matches the stored record.
 *
 * A missing record is a plain `false`: an affiliate who has never been given a
 * password cannot sign in, and no candidate can change that.
 */
export async function verifyPassword(
  candidate: string,
  record: Partial<PasswordRecord> | undefined | null,
): Promise<boolean> {
  if (!record?.hash || !record.salt) return false;

  const expected = Buffer.from(record.hash, "base64url");
  // A stored hash of the wrong length cannot be a scrypt output of ours;
  // treat it as no match rather than letting timingSafeEqual throw.
  if (expected.length !== KEY_LENGTH) return false;

  const actual = await scrypt(candidate, record.salt, KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}

/** A readable password for demo accounts. Never used for anything real. */
export function suggestPassword(): string {
  return `${randomBytes(9).toString("base64url")}`;
}
