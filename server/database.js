import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrations.js";

export function openDatabase(filename) {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = new DatabaseSync(filename);
  try {
    runMigrations(db);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
