import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import unzipper from "unzipper";
import { ValidationError, validateArchivePath } from "./validation.js";

const MAX_FILES = 2000;
const MAX_ENTRIES = 4000;
const MAX_TOTAL_UNCOMPRESSED = 100 * 1024 * 1024;
const MAX_FILE_UNCOMPRESSED = 25 * 1024 * 1024;

function isMetadataEntry(relativePath) {
  const segments = relativePath.split("/");
  return (
    segments[0] === "__MACOSX" ||
    segments.some((segment) => segment === ".DS_Store" || segment === "Thumbs.db")
  );
}

function topLevelDirectories(filePaths) {
  const names = new Set();
  for (const filePath of filePaths) {
    const slash = filePath.indexOf("/");
    if (slash > 0) {
      names.add(filePath.slice(0, slash));
    }
  }
  return [...names];
}

function chooseRoot(filePaths, requestedEntry) {
  if (filePaths.has(requestedEntry)) {
    return "";
  }

  const topLevel = topLevelDirectories(filePaths);
  if (topLevel.length === 1) {
    const prefix = `${topLevel[0]}/`;
    if (filePaths.has(`${prefix}${requestedEntry}`)) {
      return prefix;
    }
  }

  throw new ValidationError(
    `Could not find ${requestedEntry}. ZIPs must contain it at the root or inside one top-level folder.`,
    'ENTRY_NOT_FOUND',
  );
}

function guardedStream(state, limit, quotaLimit) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      state.total += chunk.length;
      state.file += chunk.length;
      if (state.file > limit) {
        callback(new ValidationError("A file in the ZIP exceeds the 25 MB uncompressed limit."));
        return;
      }
      if (state.total > MAX_TOTAL_UNCOMPRESSED) {
        callback(new ValidationError("The ZIP exceeds the 100 MB uncompressed limit."));
        return;
      }
      if (quotaLimit !== undefined && state.total > quotaLimit) {
        callback(new ValidationError("The ZIP exceeds available workspace storage.",'ZIP_STORAGE_LIMIT'));
        return;
      }
      callback(null, chunk);
    },
  });
}

// Find a valid end record in the maximum ZIP comment window before unzipper
// allocates an array for every entry. Restrict its search to this same record.
async function preflightDirectory(archivePath) {
  const file=await fs.promises.open(archivePath,'r');
  try {
    const {size}=await file.stat(), length=Math.min(size,65557), tail=Buffer.alloc(length);
    const {bytesRead}=await file.read(tail,0,length,size-length);
    const signature=Buffer.from([0x50,0x4b,0x05,0x06]);let at=tail.lastIndexOf(signature);
    while(at>=0 && (at+22>length || at+22+tail.readUInt16LE(at+20)!==length)) at=at===0 ? -1 : tail.lastIndexOf(signature,at-1);
    if(bytesRead!==length || at<0) throw new ValidationError('Invalid ZIP directory.');
    const disk=tail.readUInt16LE(at+4),startDisk=tail.readUInt16LE(at+6),onDisk=tail.readUInt16LE(at+8),count=tail.readUInt16LE(at+10);
    const dirSize=tail.readUInt32LE(at+12),offset=tail.readUInt32LE(at+16),comment=tail.readUInt16LE(at+20);
    if(disk===0xffff || startDisk===0xffff || onDisk===0xffff || count===0xffff || dirSize===0xffffffff || offset===0xffffffff) throw new ValidationError('ZIP64 archives are not supported.','ZIP_UNSUPPORTED');
    if(disk!==0 || startDisk!==0 || onDisk!==count || at+22+comment!==length || offset+dirSize>size-length+at) throw new ValidationError('Invalid ZIP directory.');
    if(count>MAX_ENTRIES) throw new ValidationError(`ZIP archives may contain at most ${MAX_ENTRIES} entries.`,'ZIP_TOO_MANY_ENTRIES');
    return length-at;
  } finally {await file.close();}
}

export async function inspectZipSite({ archivePath, requestedEntry, validatePath = validateArchivePath }) {
  const tailSize=await preflightDirectory(archivePath);
  const directory = await unzipper.Open.file(archivePath,{tailSize});
  const filePaths = new Set();

  for (const entry of directory.files) {
    const type = String(entry.type || "").toLowerCase();
    if (type && type !== "file" && type !== "directory") {
      throw new ValidationError("ZIP archives may not contain symbolic links or special files.");
    }
    // unzipper determines type from the filename and does not interpret Unix
    // mode bits. Reject links and device-like entries before any extraction.
    const host = (entry.versionMadeBy >>> 8) & 0xff;
    if (host === 3 || host === 19) {
      const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (kind && (kind !== 0o100000 && kind !== 0o040000 || kind === 0o100000 && type === "directory" || kind === 0o040000 && type !== "directory")) {
        throw new ValidationError("ZIP archives may not contain symbolic links or special files.");
      }
    }
    const cleanPath = String(entry.path || "").replace(/^\.\//, "");
    const relativePath = validatePath(type === "directory" ? cleanPath.replace(/\/$/, "") : cleanPath);
    if (type === "directory" || isMetadataEntry(relativePath)) continue;
    if (filePaths.has(relativePath)) throw new ValidationError("ZIP contains duplicate file paths.");
    filePaths.add(relativePath);
  }

  if (filePaths.size === 0) {
    throw new ValidationError("The ZIP archive is empty.");
  }
  if (filePaths.size > MAX_FILES) {
    throw new ValidationError(`ZIP archives may contain at most ${MAX_FILES} files.`);
  }

  const declaredTotal = directory.files.reduce(
    (sum, entry) => sum + Number(entry.uncompressedSize || 0),
    0,
  );
  if (declaredTotal > MAX_TOTAL_UNCOMPRESSED) {
    throw new ValidationError("The ZIP exceeds the 100 MB uncompressed limit.");
  }

  if (requestedEntry === undefined) {
    const paths=[...filePaths], first=paths[0].split('/')[0];
    const prefix=paths.every(p=>p.startsWith(`${first}/`)) ? `${first}/` : '';
    const candidates=paths.map(p=>prefix ? p.slice(prefix.length) : p).filter(p=>/\.html?$/i.test(p)).sort();
    if (!candidates.length) throw new ValidationError('The ZIP contains no HTML entry file.','ENTRY_NOT_FOUND');
    if (candidates.length > 1) {
      if (candidates.length > 200 || candidates.some(p=>p.length>4096) || candidates.reduce((sum,p)=>sum+p.length,0)>65536) throw new ValidationError('Too many HTML entry files; enter an entry path.','ENTRY_TOO_MANY');
      const error=new ValidationError('Choose an HTML entry file.','ENTRY_SELECTION_REQUIRED');error.candidates=candidates;throw error;
    }
    requestedEntry=candidates[0];
  }
  const rootPrefix = chooseRoot(filePaths, requestedEntry);
  return { directory, rootPrefix, entryFile:requestedEntry };
}

export async function extractZipSite({ archivePath, destination, requestedEntry, maxTotalBytes }) {
  if(maxTotalBytes !== undefined && (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes<0 || maxTotalBytes>MAX_TOTAL_UNCOMPRESSED)) throw new TypeError('Invalid ZIP storage limit');
  const { directory, rootPrefix } = await inspectZipSite({ archivePath, requestedEntry });
  const state = { total: 0, file: 0 };
  let extractedFiles = 0;

  for (const entry of directory.files) {
    const type = String(entry.type || "").toLowerCase();
    if (type === "directory") {
      continue;
    }

    const cleanPath = String(entry.path || "").replace(/^\.\//, "");
    if (!cleanPath || isMetadataEntry(cleanPath)) {
      continue;
    }
    const relativePath = validateArchivePath(cleanPath);

    if (rootPrefix && !relativePath.startsWith(rootPrefix)) {
      continue;
    }

    const outputRelative = rootPrefix ? relativePath.slice(rootPrefix.length) : relativePath;
    const outputPath = path.join(destination, ...outputRelative.split("/"));
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    state.file = 0;

    await pipeline(
      entry.stream(),
      guardedStream(state, MAX_FILE_UNCOMPRESSED, maxTotalBytes),
      fs.createWriteStream(outputPath, { flags: "wx" }),
    );
    extractedFiles += 1;
  }

  if (!fs.existsSync(path.join(destination, ...requestedEntry.split("/")))) {
    throw new ValidationError(`The ZIP did not produce the entry file ${requestedEntry}.`);
  }

  return { fileCount: extractedFiles, sizeBytes: state.total };
}

