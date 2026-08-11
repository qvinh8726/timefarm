const fs = require("node:fs");
const path = require("node:path");

const RECOVERY_FILE_PATTERN =
  /^(?:workly\.db(?:-wal|-shm)?|workly\.db\.pre-v\d+\.backup)$/;

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
}) {
  if (!path.isAbsolute(parentDirectory))
    throw new Error("The recovery destination must be an absolute path.");
  const sources = recoverySourceFiles(userDataPath);
  if (sources.length === 0)
    throw new Error("No TimeFarm database or migration backup was found.");

  const destination = path.join(
    parentDirectory,
    `TimeFarm-recovery-${safeTimestamp(now)}-${uniqueSuffix}`,
  );
  fs.mkdirSync(destination, { recursive: false });
  for (const source of sources) {
    fs.copyFileSync(
      source,
      path.join(destination, path.basename(source)),
      fs.constants.COPYFILE_EXCL,
    );
  }
  fs.writeFileSync(
    path.join(destination, "RECOVERY.txt"),
    [
      "TimeFarm local-data recovery copy",
      "",
      "Keep every file in this folder together. The .backup file is the consistent pre-migration snapshot when one is present.",
      "Do not replace the live app-data files while TimeFarm is running. Contact the support channel documented in SUPPORT.md before restoring manually.",
      "",
      `Created: ${now.toISOString()}`,
    ].join("\n"),
    { encoding: "utf8", flag: "wx" },
  );
  return {
    destination,
    files: sources.map((source) => path.basename(source)),
  };
}

module.exports = { exportRecoveryCopy, recoverySourceFiles };
