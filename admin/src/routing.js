import { hostingConfig } from "./hosting-address.js";

const accountFlowPaths = new Set(["/verify-email", "/reset-password", "/join-workspace"]);

export function isAccountFlowPath(pathname) {
  return accountFlowPaths.has(pathname);
}

export function workspaceMode(features) {
  return features?.multiuser === true ? "account" : "legacy";
}

export function platformAdminAvailable(features) {
  return features?.multiuser === true && Boolean(hostingConfig(features));
}
