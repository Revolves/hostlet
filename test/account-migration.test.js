import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.js";
import { createAccounts } from "../server/accounts.js";
import { createWorkspaceService } from "../server/workspaces.js";

test("migrated database registers a user and creates an authorized personal workspace", async () => {
  const db = openDatabase(":memory:");
  let verification;
  const accounts = createAccounts({ db, sender: async (message) => { verification = message.token; } });
  const user = await accounts.register({ email: "test@example.org", password: "a sufficiently long password" });
  assert.equal(accounts.verifyEmail(verification), true);
  const spaces = createWorkspaceService(db).listWorkspaces(user.id);
  assert.equal(spaces.length, 1);
  assert.equal(spaces[0].role, "owner");
  assert.equal(spaces[0].type, "personal");
  db.close();
});
