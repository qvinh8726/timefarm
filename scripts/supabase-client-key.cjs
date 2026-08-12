class SupabaseClientKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = "SupabaseClientKeyError";
  }
}

function invalid(message) {
  throw new SupabaseClientKeyError(message);
}

function decodeJwtObject(segment, label) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment))
    invalid(`The legacy JWT ${label} is malformed.`);
  try {
    const value = JSON.parse(
      Buffer.from(segment, "base64url").toString("utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      invalid(`The legacy JWT ${label} must be a JSON object.`);
    return value;
  } catch (error) {
    if (error instanceof SupabaseClientKeyError) throw error;
    invalid(`The legacy JWT ${label} is malformed.`);
  }
}

function assertPublicSupabaseClientKey(rawKey) {
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!key) invalid("A Supabase client key is required.");

  if (key.startsWith("sb_secret_"))
    invalid("Supabase secret keys must never be bundled into the desktop app.");
  if (key.startsWith("sb_publishable_")) {
    const suffix = key.slice("sb_publishable_".length);
    if (!suffix || !/^[A-Za-z0-9_-]+$/.test(suffix))
      invalid("The Supabase publishable key is malformed.");
    return { key, kind: "publishable" };
  }
  if (key.startsWith("sb_"))
    invalid("Only Supabase publishable keys may be bundled into the app.");

  const segments = key.split(".");
  if (segments.length !== 3 || segments.some((segment) => !segment))
    invalid("The Supabase key is neither publishable nor a valid legacy JWT.");
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (!/^[A-Za-z0-9_-]+$/.test(signatureSegment))
    invalid("The legacy JWT signature is malformed.");
  const header = decodeJwtObject(headerSegment, "header");
  const payload = decodeJwtObject(payloadSegment, "payload");
  if (typeof header.alg !== "string" || !header.alg)
    invalid("The legacy JWT header is missing its algorithm.");
  if (payload.role === "service_role")
    invalid("A service_role JWT must never be bundled into the desktop app.");
  if (payload.role !== "anon")
    invalid("A legacy Supabase client key must have the anon role.");
  return { key, kind: "legacy_anon_jwt" };
}

module.exports = {
  SupabaseClientKeyError,
  assertPublicSupabaseClientKey,
};
