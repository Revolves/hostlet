import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extractZipSite } from "./archive.js";
import { ValidationError, validateRelativeFile } from "./validation.js";

function createReleaseId() {
  return `${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
}

export class FileSiteStorage {
  constructor(root) {
    this.root = path.resolve(root);
  }

  async ensure() {
    await fs.promises.mkdir(path.join(this.root, "sites"), { recursive: true });
    await fs.promises.mkdir(path.join(this.root, "tmp"), { recursive: true });
  }

  async stageSingleHtml({ pageId, sourcePath, entryFile, originalFilename }) {
    const entry = validateRelativeFile(entryFile, { htmlOnly: true });
    return this.#stage(pageId, entry, originalFilename, "html", async (stagingDir) => {
      const outputPath = path.join(stagingDir, ...entry.split("/"));
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.promises.copyFile(sourcePath, outputPath);
      const stat = await fs.promises.stat(outputPath);
      return { fileCount: 1, sizeBytes: stat.size };
    });
  }

  async stageZip({ pageId, sourcePath, entryFile, originalFilename, maxTotalBytes }) {
    const entry = validateRelativeFile(entryFile, { htmlOnly: true });
    return this.#stage(pageId, entry, originalFilename, "zip", async (stagingDir) => {
      const result = await extractZipSite({
        archivePath: sourcePath,
        destination: stagingDir,
        requestedEntry: entry,
        maxTotalBytes,
      });
      return result;
    });
  }

  async #stage(pageId, entryFile, originalFilename, sourceType, write) {
    const releaseId = createReleaseId();
    const pageDir = path.join(this.root, "sites", pageId);
    const stagingDir = path.join(pageDir, `.staging-${releaseId}`);
    const releasesDir = path.join(pageDir, "releases");
    const releaseDir = path.join(releasesDir, releaseId);

    await fs.promises.mkdir(stagingDir, { recursive: true });
    await fs.promises.mkdir(releasesDir, { recursive: true });

    try {
      const result = await write(stagingDir);
      await fs.promises.rename(stagingDir, releaseDir);
      return {
        releaseId,
        releaseDir,
        entryFile,
        sourceType,
        originalFilename,
        sizeBytes: result.sizeBytes,
        fileCount: result.fileCount,
      };
    } catch (error) {
      await fs.promises.rm(stagingDir, { recursive: true, force: true });
      throw error;
    }
  }

  async removeRelease(pageId, releaseDir) {
    const resolved = path.resolve(releaseDir);
    const allowedRoot = path.join(this.root, "sites", pageId);
    if (!resolved.startsWith(`${allowedRoot}${path.sep}`)) {
      throw new Error("Refusing to remove a release outside the page storage root.");
    }
    await fs.promises.rm(resolved, { recursive: true, force: true });
  }

  async removePage(pageId) {
    const resolved = path.resolve(path.join(this.root, "sites", pageId));
    const allowedRoot = path.join(this.root, "sites");
    if (!resolved.startsWith(`${allowedRoot}${path.sep}`)) {
      throw new Error("Refusing to remove a page outside the storage root.");
    }
    await fs.promises.rm(resolved, { recursive: true, force: true });
  }

  async removeTemp(filePath) {
    if (filePath) {
      await fs.promises.rm(filePath, { force: true });
    }
  }
}

export function sourceTypeFromFilename(filename) {
  const extension = path.extname(String(filename || "")).toLowerCase();
  if (extension === ".html" || extension === ".htm") {
    return "html";
  }
  if (extension === ".zip") {
    return "zip";
  }
  throw new ValidationError("Upload a single .html file or a .zip archive.");
}

