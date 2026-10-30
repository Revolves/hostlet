import test from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError,
  slugFromFilename,
  validateAccessMode,
  validateRelativeFile,
  validateSlug,
  validateTitle,
} from "../server/validation.js";

test("validates page titles by trimmed length", () => {
  assert.equal(validateTitle("  Product demo  "), "Product demo");
  assert.throws(() => validateTitle("   "), ValidationError);
  assert.throws(() => validateTitle("x".repeat(81)), ValidationError);
});

test("accepts lowercase mount paths and rejects unsafe or reserved paths", () => {
  assert.equal(validateSlug("Product-Demo"), "product-demo");
  assert.equal(validateSlug("demo-2026"), "demo-2026");
  assert.throws(() => validateSlug("../demo"), ValidationError);
  assert.throws(() => validateSlug("admin"), ValidationError);
  assert.throws(() => validateSlug("-demo"), ValidationError);
  assert.throws(() => validateSlug("demo_page"), ValidationError);
});

test("accepts safe relative entry paths only", () => {
  assert.equal(validateRelativeFile("index.html", { htmlOnly: true }), "index.html");
  assert.equal(validateRelativeFile("site/landing.htm", { htmlOnly: true }), "site/landing.htm");
  assert.throws(() => validateRelativeFile("../index.html", { htmlOnly: true }), ValidationError);
  assert.throws(() => validateRelativeFile("/index.html", { htmlOnly: true }), ValidationError);
  assert.throws(() => validateRelativeFile("C:\\index.html", { htmlOnly: true }), ValidationError);
  assert.throws(() => validateRelativeFile("index.js", { htmlOnly: true }), ValidationError);
});

test("normalizes access modes and filename suggestions", () => {
  assert.equal(validateAccessMode("public"), "public");
  assert.throws(() => validateAccessMode("hidden"), ValidationError);
  assert.equal(slugFromFilename("My Product Demo.html"), "my-product-demo");
  assert.equal(slugFromFilename("---.html"), "page");
});

