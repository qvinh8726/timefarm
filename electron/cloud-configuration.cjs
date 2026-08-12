const { assertPublicSupabaseClientKey } = require("./supabase-client-key.cjs");

function assertSupabaseOrigin(rawUrl) {
  const value = typeof rawUrl === "string" ? rawUrl.trim() : "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Supabase URL must be a valid origin.");
  }

  const loopback =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (
    (parsed.protocol !== "https:" &&
      !(loopback && parsed.protocol === "http:")) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "Supabase URL must be a credential-free HTTPS origin (loopback HTTP is allowed for development).",
    );
  }
  return parsed.origin;
}

function assertOAuthRedirectUrl(rawUrl = "timefarm://auth/callback") {
  const value = typeof rawUrl === "string" ? rawUrl.trim() : "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Google sign-in must use the TimeFarm callback route.");
  }
  if (
    parsed.protocol !== "timefarm:" ||
    parsed.hostname !== "auth" ||
    parsed.port ||
    parsed.pathname !== "/callback" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Google sign-in must use the TimeFarm callback route.");
  }
  return "timefarm://auth/callback";
}

function assertCloudConfiguration({ url, anonKey, redirectUrl }) {
  return {
    configured: true,
    url: assertSupabaseOrigin(url),
    anonKey: assertPublicSupabaseClientKey(anonKey).key,
    redirectUrl: assertOAuthRedirectUrl(redirectUrl),
  };
}

module.exports = {
  assertCloudConfiguration,
  assertOAuthRedirectUrl,
  assertSupabaseOrigin,
};
