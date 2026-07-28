/**
 * Password rules, shared between the browser and the server.
 *
 * Deliberately free of any `node:` import. The form needs the minimum length to
 * set `minLength` and write its own hint, and the server needs the same rule to
 * enforce it — but pulling these out of `credentials.ts` would drag
 * `node:crypto` into the client bundle, where `promisify(scrypt)` throws on load
 * and takes the whole page down with it.
 *
 * The browser copy is a convenience, not a control: `setAffiliatePassword`
 * re-checks on the server, because anything a client validates can be skipped.
 */

/** Short enough not to be a burden, long enough to be worth hashing. */
export const MIN_PASSWORD_LENGTH = 10;

/** Longest password we will spend server time hashing. */
export const MAX_PASSWORD_LENGTH = 200;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    // Bounded because the cost of hashing is paid by the server, and an
    // unbounded password is a free way to make it do work.
    return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  }
  return null;
}
