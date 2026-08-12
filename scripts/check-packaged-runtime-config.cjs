const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const expectedMode = process.argv[2];
if (expectedMode !== "cloud" && expectedMode !== "offline") {
  console.error(
    "Packaged runtime configuration check requires cloud or offline mode.",
  );
  process.exit(1);
}

const archivePath = path.resolve(
  process.argv[3] ||
    path.join("release", "win-unpacked", "resources", "app.asar"),
);
if (!fs.existsSync(archivePath)) {
  console.error(`Packaged ASAR was not found: ${archivePath}`);
  process.exit(1);
}

let asar;
try {
  asar = require("@electron/asar");
} catch {
  console.error("The Electron ASAR inspection library is unavailable.");
  process.exit(1);
}

let value;
try {
  value = JSON.parse(
    asar
      .extractFile(archivePath, "electron/timefarm.config.json")
      .toString("utf8"),
  );
} catch {
  console.error("Packaged runtime configuration is missing or invalid.");
  process.exit(1);
}

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "timefarm-packaged-config-"),
);
const temporaryConfig = path.join(temporaryDirectory, "timefarm.config.json");
try {
  fs.writeFileSync(temporaryConfig, JSON.stringify(value), "utf8");
  const { assertRuntimeConfigFile } = require("./runtime-config-contract.cjs");
  assertRuntimeConfigFile(temporaryConfig, expectedMode);
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Packaged runtime configuration is invalid.",
  );
  process.exitCode = 1;
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

if (!process.exitCode)
  console.log(
    `Packaged ASAR contains valid ${expectedMode} runtime configuration.`,
  );
