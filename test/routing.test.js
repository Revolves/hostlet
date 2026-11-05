import test from "node:test";
import assert from "node:assert/strict";
import {
  isAccountFlowPath,
  platformAdminAvailable,
  workspaceMode,
} from "../admin/src/routing.js";

test("account flow paths are limited to account utility routes", () => {
  assert.equal(isAccountFlowPath("/verify-email"), true);
  assert.equal(isAccountFlowPath("/reset-password"), true);
  assert.equal(isAccountFlowPath("/join-workspace"), true);
  assert.equal(isAccountFlowPath("/workspace"), false);
  assert.equal(isAccountFlowPath("/account"), false);
});

test("workspace mode follows multiuser configuration", () => {
  assert.equal(workspaceMode({ multiuser: true }), "account");
  assert.equal(workspaceMode({ multiuser: false }), "legacy");
  assert.equal(workspaceMode(null), "legacy");
});

test("platform administration requires multiuser mode and a valid hosting address", () => {
  assert.equal(platformAdminAvailable({ multiuser: true, hostingDomain: "apps.example.com" }), true);
  assert.equal(platformAdminAvailable({ multiuser: true, ipHostingOrigin: "https://127.0.0.1:30007" }), true);
  assert.equal(platformAdminAvailable({ multiuser: false, hostingDomain: "apps.example.com" }), false);
  assert.equal(platformAdminAvailable({ multiuser: true, hostingDomain: "" }), false);
  assert.equal(platformAdminAvailable({ multiuser: true, ipHostingOrigin: "http://127.0.0.1:30007" }), false);
});
