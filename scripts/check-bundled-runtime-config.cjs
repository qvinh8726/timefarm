const fs = require("node:fs");
const path = require("node:path");
const { assertPublicSupabaseClientKey } = require("./supabase-client-key.cjs");

const configPath = path.join(
  __dirname,
  "..",
  "electron",
  "timefarm.config.json",
);

if (!fs.existsSync(configPath)) {
  console.log("No bundled cloud configuration found; packaging offline build.");
  process.exit(0);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {
  console.error("Bundled TimeFarm cloud configuration is not valid JSON.");
  process.exit(1);
}

try {
  assertPublicSupabaseClientKey(config?.supabaseAnonKey);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid client key.");
  process.exit(1);
}

console.log("Bundled TimeFarm cloud configuration uses a public client key.");
