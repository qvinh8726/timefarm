const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const RECOVERY_FILE_PATTERN =
  /^(?:workly\.db(?:-wal|-shm)?|workly\.db\.pre-v\d+\.backup|workly-state\.json(?:\.(?:migrating|migrated)|(?:\.migrating)?\.skipped-[A-Za-z0-9-]+)?)$/;

function recoverySourceFiles(userDataPath) {
  if (!path.isAbsolute(userDataPath))
    throw new Error("The TimeFarm data directory must be an absolute path.");
  if (!fs.existsSync(userDataPath)) return [];
  return fs
    .readdirSync(userDataPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && RECOVERY_FILE_PATTERN.test(entry.name))
    .map((entry) => path.join(userDataPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function safeTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function exportRecoveryCopy({
  userDataPath,
  parentDirectory,
  now = new Date(),
  uniqueSuffix = process.pid,
  createDatabaseSnapshot = undefined,
}) {
  if (!path.isAbsolute(parentDirectory))
    throw new Error("The recovery destination must be an absolute path.");
  const sources = recoverySourceFiles(userDataPath);
  if (sources.length === 0)
    throw new Error("No recoverable TimeFarm local data was found.");

  const destination = path.join(
    parentDirectory,
    `TimeFarm-recovery-${safeTimestamp(now)}-${uniqueSuffix}`,
  );
  fs.mkdirSync(destination, { recursive: false });
  const useConsistentDatabaseSnapshot =
    typeof createDatabaseSnapshot === "function";
  const sourcesToCopy = useConsistentDatabaseSnapshot
    ? sources.filter(
        (source) => !/^workly\.db(?:-wal|-shm)?$/.test(path.basename(source)),
      )
    : sources;
  if (useConsistentDatabaseSnapshot)
    createDatabaseSnapshot(path.join(destination, "workly.db"));
  for (const source of sourcesToCopy) {
    fs.copyFileSync(
      source,
      path.join(destination, path.basename(source)),
      fs.constants.COPYFILE_EXCL,
    );
  }
  const exportedFiles = [
    ...(useConsistentDatabaseSnapshot ? ["workly.db"] : []),
    ...sourcesToCopy.map((source) => path.basename(source)),
  ].sort((left, right) => left.localeCompare(right));
  const manifest = exportedFiles.map((file) => {
    const exportedFile = path.join(destination, file);
    const bytes = fs.readFileSync(exportedFile);
    return {
      file,
      bytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  });
  fs.writeFileSync(
    path.join(destination, "RECOVERY-MANIFEST.json"),
    `${JSON.stringify({ version: 1, createdAt: now.toISOString(), files: manifest }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  fs.writeFileSync(
    path.join(destination, "RECOVERY.txt"),
    [
      "TimeFarm local-data recovery copy",
      "",
      "Keep every file in this folder together. The .backup file is the consistent pre-migration snapshot when one is present.",
      "This folder can contain plaintext work history and earnings. Store it somewhere private.",
      "Do not replace the live app-data files while TimeFarm is running. Contact the support channel documented in SUPPORT.md before restoring manually.",
      "",
      `Created: ${now.toISOString()}`,
    ].join("\n"),
    { encoding: "utf8", flag: "wx" },
  );
  return {
    destination,
    files: exportedFiles,
  };
}

function exportRepositoryRecoveryCopy({
  repository,
  runSerializedMutation,
  userDataPath,
  parentDirectory,
  now = new Date(),
  uniqueSuffix = process.pid,
}) {
  // Keep the SQLite snapshot and adjacent legacy-file copies behind the same
  // queue as local imports and commands, so the exported set has one boundary.
  return runSerializedMutation(() =>
    exportRecoveryCopy({
      userDataPath,
      parentDirectory,
      now,
      uniqueSuffix,
      createDatabaseSnapshot: (destinationPath) =>
        repository.createRecoverySnapshot(destinationPath),
    }),
  );
}

module.exports = {
  exportRecoveryCopy,
  exportRepositoryRecoveryCopy,
  recoverySourceFiles,
};
