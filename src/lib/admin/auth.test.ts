/**
 * Admin authentication tests.
 *
 * The admin area exposes customers' names, phone numbers and home addresses,
 * so the case that matters most is the one asserting it stays shut when the
 * environment is not configured.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  adminConfig,
  issueSession,
  resetThrottleForTests,
  throttle,
  verifyPassword,
  verifySession,
} from "@/lib/admin/auth";

const PASSWORD = "a-sufficiently-long-password";
const SECRET = "test-session-secret-value";

function configure({ password = PASSWORD, secret = SECRET }: { password?: string | null; secret?: string | null } = {}) {
  if (password === null) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = password;
  if (secret === null) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = secret;
}

beforeEach(() => {
  configure();
  resetThrottleForTests();
});

describe("admin is disabled unless fully configured", () => {
  it("is disabled when no password is set", () => {
    configure({ password: null });
    assert.equal(adminConfig().enabled, false);
  });

  it("is disabled when no session secret is set", () => {
    configure({ secret: null });
    assert.equal(adminConfig().enabled, false);
  });

  it("rejects a short password rather than accepting a weak one", () => {
    configure({ password: "short" });
    const config = adminConfig();
    assert.equal(config.enabled, false);
    if (!config.enabled) assert.match(config.reason, /12 characters/);
  });

  it("refuses every password while disabled — an unset password is not an open door", () => {
    configure({ password: null });
    assert.equal(verifyPassword(""), false);
    assert.equal(verifyPassword("anything"), false);
    assert.equal(verifyPassword(PASSWORD), false);
  });

  it("cannot issue a session while disabled", () => {
    configure({ secret: null });
    assert.equal(issueSession(), null);
  });

  it("rejects a previously valid session once admin is disabled", () => {
    const session = issueSession();
    assert.ok(session);
    assert.equal(verifySession(session.value), true);

    configure({ password: null });
    assert.equal(verifySession(session.value), false, "a session survived admin being disabled");
  });
});

describe("passwords", () => {
  it("accepts the configured password", () => {
    assert.equal(verifyPassword(PASSWORD), true);
  });

  it("rejects a wrong password", () => {
    assert.equal(verifyPassword("wrong-password-here"), false);
  });

  it("rejects a prefix of the password", () => {
    assert.equal(verifyPassword(PASSWORD.slice(0, -1)), false);
  });

  it("rejects an empty password", () => {
    assert.equal(verifyPassword(""), false);
  });
});

describe("session tokens", () => {
  it("issues a token that verifies", () => {
    const session = issueSession();
    assert.ok(session);
    assert.equal(verifySession(session.value), true);
  });

  it("rejects a missing token", () => {
    assert.equal(verifySession(undefined), false);
  });

  it("rejects a malformed token", () => {
    assert.equal(verifySession("nonsense"), false);
    assert.equal(verifySession("a.b"), false);
    assert.equal(verifySession("a.b.c.d"), false);
  });

  it("rejects a tampered expiry — the core forgery attempt", () => {
    const session = issueSession();
    assert.ok(session);
    const [, nonce, signature] = session.value.split(".");
    const farFuture = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
    assert.equal(
      verifySession(`${farFuture}.${nonce}.${signature}`),
      false,
      "an attacker extended their own session by editing the expiry",
    );
  });

  it("rejects a tampered signature", () => {
    const session = issueSession();
    assert.ok(session);
    const [expiry, nonce] = session.value.split(".");
    assert.equal(verifySession(`${expiry}.${nonce}.forged`), false);
  });

  it("rejects a token signed with a different secret", () => {
    const session = issueSession();
    assert.ok(session);
    configure({ secret: "a-completely-different-secret" });
    assert.equal(verifySession(session.value), false);
  });

  it("rejects an expired token", () => {
    const past = Date.now() - 9 * 60 * 60 * 1000;
    const session = issueSession(past);
    assert.ok(session);
    assert.equal(verifySession(session.value), false, "an expired session was accepted");
  });

  it("issues distinct tokens for the same instant", () => {
    const now = Date.now();
    assert.notEqual(issueSession(now)?.value, issueSession(now)?.value);
  });
});

describe("login throttling", () => {
  it("allows a handful of attempts then blocks", () => {
    for (let i = 0; i < 8; i++) {
      assert.equal(throttle("1.2.3.4").allowed, true, `attempt ${i + 1} should be allowed`);
    }
    const blocked = throttle("1.2.3.4");
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryInMs > 0);
  });

  it("counts each client separately", () => {
    for (let i = 0; i < 9; i++) throttle("1.1.1.1");
    assert.equal(throttle("2.2.2.2").allowed, true, "one client's attempts blocked another");
  });

  it("lets the window lapse", () => {
    const start = Date.now();
    for (let i = 0; i < 9; i++) throttle("3.3.3.3", start);
    assert.equal(throttle("3.3.3.3", start).allowed, false);
    assert.equal(throttle("3.3.3.3", start + 11 * 60 * 1000).allowed, true);
  });
});
