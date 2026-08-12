const { assertRuntimeConfigFile } = require("./runtime-config-contract.cjs");

const expectedMode = process.argv[2];
if (expectedMode !== "cloud" && expectedMode !== "offline") {
  console.error("Runtime configuration check requires cloud or offline mode.");
  process.exit(1);
}

try {
  assertRuntimeConfigFile(undefined, expectedMode);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Invalid cloud configuration.",
  );
  process.exit(1);
}

console.log(
  `Bundled TimeFarm runtime configuration is valid ${expectedMode} mode.`,
);
