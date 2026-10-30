import test from "node:test";
import assert from "node:assert/strict";
import { signGrant, verifyGrant } from "../server/tokens.js";

const secret = "a-test-secret-that-is-longer-than-32-characters";

test("accepts a valid signed grant", () => {
  const token = signGrant({ pageId: "p1", exp: 2000 }, secret);
  assert.deepEqual(verifyGrant(token, secret, 1000), { pageId: "p1", exp: 2000 });
});

test("rejects tampered, expired, and malformed grants", () => {
  const token = signGrant({ pageId: "p1", exp: 2000 }, secret);
  assert.equal(verifyGrant(`${token}x`, secret, 1000), null);
  assert.equal(verifyGrant(token, secret, 3000), null);
  assert.equal(verifyGrant("not-a-token", secret, 1000), null);
  assert.equal(verifyGrant(token, `${secret}x`, 1000), null);
});

