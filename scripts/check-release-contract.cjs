const fs = require("node:fs");
const path = require("node:path");
const {
  assertCloudConfiguration,
} = require("../electron/cloud-configuration.cjs");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
);
const releaseTag = process.argv[2] || process.env.GITHUB_REF_NAME || "";
const expectedTag = `v${packageJson.version}`;

if (releaseTag !== expectedTag) {
  fail(
    `Release tag ${releaseTag || "(missing)"} does not match package version ${expectedTag}.`,
  );
}

try {
  assertCloudConfiguration({
    url: process.env.TIMEFARM_SUPABASE_URL,
    anonKey: process.env.TIMEFARM_SUPABASE_ANON_KEY,
    redirectUrl:
      process.env.TIMEFARM_OAUTH_REDIRECT_URL || "timefarm://auth/callback",
  });
} catch (error) {
  fail(error instanceof Error ? error.message : "Invalid cloud configuration.");
}

console.log(
  `Release contract passed for ${releaseTag} with public cloud configuration.`,
);
