const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const electronDirectory = __dirname;
const bootstrapExceptions = new Set([
  // `main.cjs` starts the Electron lifecycle as soon as it loads. Its startup,
  // IPC registration, and shutdown path are exercised by packaged smoke tests.
  "main.cjs",
  // These execute against mocked Electron bridges in preload-bridges.test.cjs.
  "preload.cjs",
  "overlay-preload.cjs",
]);

test("loads every unit-testable Electron production module into coverage", () => {
  const productionModules = fs
    .readdirSync(electronDirectory)
    .filter((name) => name.endsWith(".cjs") && !name.endsWith(".test.cjs"))
    .sort();

  assert.deepEqual(
    productionModules.filter((name) => bootstrapExceptions.has(name)),
    ["main.cjs", "overlay-preload.cjs", "preload.cjs"],
  );

  for (const name of productionModules) {
    if (bootstrapExceptions.has(name)) continue;
    assert.doesNotThrow(
      () => require(path.join(electronDirectory, name)),
      name,
    );
  }

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(electronDirectory, "..", "package.json"), "utf8"),
  );
  assert.match(
    packageJson.scripts["test:coverage:electron"],
    /--test-coverage-exclude=\\?"electron\/main\.cjs/,
  );
  assert.equal(
    packageJson.scripts["smoke:win:packaged"],
    "node scripts/smoke-packaged-app.cjs",
  );
  assert.match(
    fs.readFileSync(path.join(electronDirectory, "main.cjs"), "utf8"),
    /--timefarm-smoke-test/,
  );
});
