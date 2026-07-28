/**
 * Deployment safeguard tests.
 *
 * The case that matters most: a deployment without payment credentials must
 * refuse to take orders rather than telling customers their order is confirmed
 * for money that was never collected.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { isProductionDeployment, onVercel, simulatedPaymentsAllowed } from "@/lib/environment";

const KEYS = ["VERCEL", "VERCEL_ENV", "NODE_ENV", "ALLOW_SIMULATED_PAYMENTS"] as const;
const saved: Record<string, string | undefined> = {};

/**
 * Next types `NODE_ENV` as read-only, which is right for application code but
 * blocks a test from standing up the environments it needs to check.
 */
const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = env[key];
    delete env[key];
  }
});

/** Restores anything the suite changed, so later files are unaffected. */
process.on("exit", () => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
});

describe("recognising a production deployment", () => {
  it("treats a local dev run as not production", () => {
    assert.equal(isProductionDeployment(), false);
    assert.equal(onVercel(), false);
  });

  it("treats VERCEL_ENV=production as production", () => {
    env.VERCEL = "1";
    env.VERCEL_ENV = "production";
    assert.equal(isProductionDeployment(), true);
    assert.equal(onVercel(), true);
  });

  it("does not treat a Vercel preview as production", () => {
    // NODE_ENV is "production" for preview builds too, so relying on it alone
    // would make every preview behave like the live shop.
    env.VERCEL = "1";
    env.VERCEL_ENV = "preview";
    env.NODE_ENV = "production";
    assert.equal(isProductionDeployment(), false, "a preview was mistaken for the live shop");
    assert.equal(onVercel(), true, "a preview is still a deployment");
  });

  it("falls back to NODE_ENV when not on Vercel", () => {
    env.NODE_ENV = "production";
    assert.equal(isProductionDeployment(), true);
  });
});

describe("simulated payments", () => {
  it("are allowed in local development", () => {
    assert.equal(simulatedPaymentsAllowed(), true);
  });

  it("are allowed on a preview deployment", () => {
    env.VERCEL = "1";
    env.VERCEL_ENV = "preview";
    assert.equal(simulatedPaymentsAllowed(), true, "a preview should still be demonstrable");
  });

  it("are refused on a production deployment", () => {
    env.VERCEL = "1";
    env.VERCEL_ENV = "production";
    assert.equal(
      simulatedPaymentsAllowed(),
      false,
      "a live shop would have confirmed orders without taking payment",
    );
  });

  it("can be enabled deliberately on production for a demo", () => {
    env.VERCEL = "1";
    env.VERCEL_ENV = "production";
    env.ALLOW_SIMULATED_PAYMENTS = "1";
    assert.equal(simulatedPaymentsAllowed(), true);
  });

  it("needs the exact opt-in value, not merely a set variable", () => {
    env.VERCEL = "1";
    env.VERCEL_ENV = "production";
    for (const value of ["0", "false", "yes", ""]) {
      env.ALLOW_SIMULATED_PAYMENTS = value;
      assert.equal(simulatedPaymentsAllowed(), false, `"${value}" should not enable simulated payments`);
    }
  });
});
