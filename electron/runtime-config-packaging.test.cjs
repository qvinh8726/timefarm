const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPackage } = require("@electron/asar");

const {
  assertRuntimeConfigFile,
  prepareCloudRuntimeConfig,
  prepareOfflineRuntimeConfig,
} = require("../scripts/runtime-config-contract.cjs");
const { spawnSync } = require("node:child_process");

const publicConfiguration = {
  url: "https://project.supabase.co",
  anonKey: "sb_publishable_public-client-key_123",
  redirectUrl: "timefarm://auth/callback",
};

function withTemporaryConfig(run) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "timefarm-runtime-config-test-"),
  );
  const configPath = path.join(directory, "timefarm.config.json");
  try {
    return run(configPath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("offline preparation replaces a stale cloud target with an explicit sentinel", () =>
  withTemporaryConfig((configPath) => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mode: "cloud",
        supabaseUrl: "https://stale-project.supabase.co",
        supabaseAnonKey: "sb_publishable_stale-project-key",
        oauthRedirectUrl: "timefarm://auth/callback",
      }),
    );

    prepareOfflineRuntimeConfig(configPath);

    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), {
      mode: "offline",
    });
    assert.equal(
      assertRuntimeConfigFile(configPath, "offline").mode,
      "offline",
    );
    assert.throws(
      () => assertRuntimeConfigFile(configPath, "cloud"),
      /expected cloud.*received offline/i,
    );
  }));

test("cloud preparation normalizes and verifies the exact public configuration", () =>
  withTemporaryConfig((configPath) => {
    prepareCloudRuntimeConfig(configPath, {
      ...publicConfiguration,
      url: ` ${publicConfiguration.url}/ `,
    });

    assert.deepEqual(assertRuntimeConfigFile(configPath, "cloud"), {
      mode: "cloud",
      supabaseUrl: publicConfiguration.url,
      supabaseAnonKey: publicConfiguration.anonKey,
      oauthRedirectUrl: publicConfiguration.redirectUrl,
    });
  }));

test("runtime config verification fails closed for missing or malformed artifacts", () =>
  withTemporaryConfig((configPath) => {
    assert.throws(
      () => assertRuntimeConfigFile(configPath, "offline"),
      /not found/i,
    );

    fs.writeFileSync(configPath, "not-json");
    assert.throws(
      () => assertRuntimeConfigFile(configPath, "offline"),
      /valid JSON/i,
    );
  }));

test("packaged ASAR verification detects stale and wrong-mode configuration", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "timefarm-packaged-config-test-"),
  );
  const sourceDirectory = path.join(directory, "app");
  const configPath = path.join(
    sourceDirectory,
    "electron",
    "timefarm.config.json",
  );
  const archivePath = path.join(directory, "app.asar");

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    prepareCloudRuntimeConfig(configPath, publicConfiguration);
    await createPackage(sourceDirectory, archivePath);

    const result = spawnSync(
      process.execPath,
      [
        path.join(
          __dirname,
          "..",
          "scripts",
          "check-packaged-runtime-config.cjs",
        ),
        "offline",
        archivePath,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}${result.stderr}`,
      /expected offline.*received cloud/i,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
