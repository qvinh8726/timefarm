const { prepareCloudRuntimeConfig } = require("./runtime-config-contract.cjs");

const url =
  process.env.TIMEFARM_SUPABASE_URL || process.env.WORKLY_SUPABASE_URL || "";
const anonKey =
  process.env.TIMEFARM_SUPABASE_ANON_KEY ||
  process.env.WORKLY_SUPABASE_ANON_KEY ||
  "";
const redirectUrl =
  process.env.TIMEFARM_OAUTH_REDIRECT_URL ||
  process.env.WORKLY_OAUTH_REDIRECT_URL ||
  "timefarm://auth/callback";

if (!url || !anonKey) {
  console.error(
    "Missing TIMEFARM_SUPABASE_URL or TIMEFARM_SUPABASE_ANON_KEY in this terminal.",
  );
  process.exit(1);
}

try {
  prepareCloudRuntimeConfig(undefined, { url, anonKey, redirectUrl });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Invalid cloud configuration.",
  );
  process.exit(1);
}

console.log("Prepared bundled TimeFarm cloud configuration.");
