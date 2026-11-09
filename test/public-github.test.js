import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../server/config.js";

const base = {
  ADMIN_PASSWORD: "test-admin-password",
  APP_SECRET: "0123456789abcdef0123456789abcdef",
};

test("public GitHub source defaults to the project repository", () => {
  const config = loadConfig(base);
  assert.deepEqual(config.publicGithub, {
    url: "https://github.com/Revolves/hostlet",
    label: "Revolves/hostlet",
  });
});

test("public GitHub source accepts a repository and custom label", () => {
  const config = loadConfig({
    ...base,
    PUBLIC_GITHUB_URL: "https://github.com/Revolves/hostlet",
    PUBLIC_GITHUB_LABEL: "Revolves / Hostlet",
  });
  assert.deepEqual(config.publicGithub, {
    url: "https://github.com/Revolves/hostlet",
    label: "Revolves / Hostlet",
  });
  assert.equal(loadConfig({ ...base, PUBLIC_GITHUB_URL: "" }).publicGithub, null);
});

test("public GitHub source rejects unsafe or unsupported URLs", () => {
  for (const value of [
    "http://github.com/Revolves",
    "https://user@github.com/Revolves",
    "https://github.com/Revolves?tab=repositories",
    "https://github.com/Revolves#readme",
    "https://evil.example/Revolves",
    "https://github.com/Revolves/hostlet/extra",
    "https://github.com/Revolves/../hostlet",
  ]) {
    assert.throws(() => loadConfig({ ...base, PUBLIC_GITHUB_URL: value }), /PUBLIC_GITHUB_URL/, value);
  }
  assert.throws(
    () => loadConfig({ ...base, PUBLIC_GITHUB_LABEL: "x".repeat(65) }),
    /PUBLIC_GITHUB_LABEL/,
  );
});
