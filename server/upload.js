import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { sourceTypeFromFilename } from "./storage.js";
import { slugFromFilename } from "./validation.js";

export function createUploader({ config, tmpDir }) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: tmpDir,
    filename: (_req, file, callback) => {
      const suffix = path.extname(file.originalname).toLowerCase();
      callback(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: config.maxUploadBytes, files: 1 },
    fileFilter: (_req, file, callback) => {
      try {
        sourceTypeFromFilename(file.originalname);
        callback(null, true);
      } catch (error) {
        callback(error);
      }
    },
  });
}

export function defaultsFromFilename(filename) {
  const extension = path.extname(String(filename || "")).toLowerCase();
  return {
    suggestedTitle: path
      .basename(String(filename || "Untitled page"), extension)
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    suggestedSlug: slugFromFilename(filename),
  };
}

