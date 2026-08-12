const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SupabaseClientKeyError,
  assertPublicSupabaseClientKey,
} = require("./supabase-client-key.cjs");

function legacyJwt(role, overrides = {}) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, ...overrides })}.test-signature`;
}

test("accepts a Supabase publishable key", () => {
  assert.deepEqual(
    assertPublicSupabaseClientKey("sb_publishable_public-client-key_123"),
    {
      key: "sb_publishable_public-client-key_123",
      kind: "publishable",
    },
  );
});

test("accepts only an anon legacy JWT", () => {
  const key = legacyJwt("anon", { ref: "example-project" });
  assert.deepEqual(assertPublicSupabaseClientKey(key), {
    key,
    kind: "legacy_anon_jwt",
  });
});

test("rejects privileged Supabase key formats", () => {
  for (const key of [
    "sb_secret_server-only-key",
    legacyJwt("service_role"),
    legacyJwt("authenticated"),
  ]) {
    assert.throws(
      () => assertPublicSupabaseClientKey(key),
      SupabaseClientKeyError,
    );
  }
});

test("rejects malformed and unexpected keys", () => {
  for (const key of [
    "",
    "sb_publishable_",
    "sb_publishable_contains a space",
    "sb_unknown_value",
    "not-a-jwt",
    "one.two",
    "@@@.e30.signature",
    `${Buffer.from("{}", "utf8").toString("base64url")}.not-json.signature`,
  ]) {
    assert.throws(
      () => assertPublicSupabaseClientKey(key),
      SupabaseClientKeyError,
    );
  }
});
