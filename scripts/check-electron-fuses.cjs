const fs = require("node:fs");
const path = require("node:path");
const {
  FuseState,
  FuseV1Options,
  getCurrentFuseWire,
} = require("@electron/fuses");

const executable = path.resolve(
  process.argv[2] ||
    path.join(__dirname, "..", "release", "win-unpacked", "TimeFarm.exe"),
);

const expected = new Map([
  [FuseV1Options.RunAsNode, FuseState.DISABLE],
  [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.ENABLE],
  [FuseV1Options.WasmTrapHandlers, FuseState.ENABLE],
]);

async function main() {
  if (!fs.existsSync(executable))
    throw new Error(`Packaged executable not found: ${executable}`);

  const wire = await getCurrentFuseWire(executable);
  if (wire.version !== "1")
    throw new Error(`Unsupported Electron fuse wire version: ${wire.version}`);

  const fuseIndexes = Object.keys(wire).filter((key) => /^\d+$/.test(key));
  if (fuseIndexes.length !== expected.size)
    throw new Error(
      `Electron exposes ${fuseIndexes.length} fuses but policy defines ${expected.size}; update the explicit fuse policy before packaging.`,
    );

  const failures = [];
  for (const [option, expectedState] of expected) {
    if (wire[option] !== expectedState)
      failures.push(
        `${FuseV1Options[option]} expected ${FuseState[expectedState]}, received ${FuseState[wire[option]] ?? wire[option]}`,
      );
  }
  if (failures.length)
    throw new Error(
      `Packaged Electron fuses are unsafe:\n- ${failures.join("\n- ")}`,
    );

  console.log(
    `Electron fuse check passed for ${executable}: ${expected.size} security-sensitive fuses match policy.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
