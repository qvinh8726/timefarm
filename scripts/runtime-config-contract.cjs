const fs = require("node:fs");
const path = require("node:path");
const {
  assertCloudConfiguration,
} = require("../electron/cloud-configuration.cjs");

const runtimeConfigPath = path.join(
  __dirname,
  "..",
  "electron",
  "timefarm.config.json",
);

function writeConfiguration(configPath, configuration) {
  fs.writeFileSync(configPath, `${JSON.stringify(configuration, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return configuration;
}

function prepareCloudRuntimeConfig(
  configPath = runtimeConfigPath,
  { url, anonKey, redirectUrl },
) {
  const configuration = assertCloudConfiguration({
    url,
    anonKey,
    redirectUrl,
  });
  return writeConfiguration(configPath, {
    mode: "cloud",
    supabaseUrl: configuration.url,
    supabaseAnonKey: configuration.anonKey,
    oauthRedirectUrl: configuration.redirectUrl,
  });
}

function prepareOfflineRuntimeConfig(configPath = runtimeConfigPath) {
  return writeConfiguration(configPath, { mode: "offline" });
}

function assertRuntimeConfigFile(configPath = runtimeConfigPath, expectedMode) {
  if (!fs.existsSync(configPath))
    throw new Error(`Runtime configuration was not found: ${configPath}`);

  let value;
  try {
    value = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    throw new Error(
      "Bundled TimeFarm runtime configuration is not valid JSON.",
    );
  }

  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Bundled TimeFarm runtime configuration must be an object.",
    );
  if (value.mode !== "cloud" && value.mode !== "offline")
    throw new Error(
      "Bundled TimeFarm runtime configuration must declare cloud or offline mode.",
    );
  if (expectedMode && value.mode !== expectedMode)
    throw new Error(
      `Runtime configuration expected ${expectedMode} mode but received ${value.mode} mode.`,
    );

  if (value.mode === "offline") {
    if (Object.keys(value).some((key) => key !== "mode"))
      throw new Error(
        "Offline runtime configuration must not contain cloud settings.",
      );
    return { mode: "offline" };
  }

  const configuration = assertCloudConfiguration({
    url: value.supabaseUrl,
    anonKey: value.supabaseAnonKey,
    redirectUrl: value.oauthRedirectUrl,
  });
  const allowedKeys = new Set([
    "mode",
    "supabaseUrl",
    "supabaseAnonKey",
    "oauthRedirectUrl",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key)))
    throw new Error("Cloud runtime configuration contains unsupported fields.");
  return {
    mode: "cloud",
    supabaseUrl: configuration.url,
    supabaseAnonKey: configuration.anonKey,
    oauthRedirectUrl: configuration.redirectUrl,
  };
}

module.exports = {
  assertRuntimeConfigFile,
  prepareCloudRuntimeConfig,
  prepareOfflineRuntimeConfig,
  runtimeConfigPath,
};
