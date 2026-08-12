const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "..");
const releaseWorkflowPath = path.join(
  repositoryRoot,
  ".github",
  "workflows",
  "release.yml",
);
const releaseContractPath = path.join(
  repositoryRoot,
  "scripts",
  "check-release-contract.cjs",
);
const cloudContractPath = path.join(
  repositoryRoot,
  "scripts",
  "check-cloud-contract.cjs",
);

function runReleaseContract(tag, overrides = {}) {
  return spawnSync(process.execPath, [releaseContractPath, tag], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TIMEFARM_SUPABASE_URL: "https://project.supabase.co",
      TIMEFARM_SUPABASE_ANON_KEY: "sb_publishable_public-client-key_123",
      ...overrides,
    },
  });
}

test("release workflow routes v0 releases through the protected production job", () => {
  const workflow = fs.readFileSync(releaseWorkflowPath, "utf8");

  assert.match(workflow, /^\s*-\s+["']v0\.\*["']\s*$/m);
  assert.match(workflow, /^\s+environment:\s+production\s*$/m);
  assert.match(workflow, /node scripts\/check-release-contract\.cjs/);
});

test("release contract accepts only the package tag with public cloud config", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  const matching = runReleaseContract(`v${packageJson.version}`);
  assert.equal(matching.status, 0, matching.stderr || matching.stdout);
  assert.doesNotMatch(
    `${matching.stdout}${matching.stderr}`,
    /sb_publishable_public-client-key_123/,
  );

  const mismatched = runReleaseContract("v99.99.99");
  assert.notEqual(mismatched.status, 0);
  assert.match(
    `${mismatched.stdout}${mismatched.stderr}`,
    /does not match package version/i,
  );

  const privileged = runReleaseContract(`v${packageJson.version}`, {
    TIMEFARM_SUPABASE_ANON_KEY: "sb_secret_server-only-key",
  });
  assert.notEqual(privileged.status, 0);
  assert.match(
    `${privileged.stdout}${privileged.stderr}`,
    /must never be bundled/i,
  );
});

test("hosted contract probe rejects a privileged key before network access", () => {
  const privilegedKey = "sb_secret_server-only-key";
  const result = spawnSync(process.execPath, [cloudContractPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TIMEFARM_SUPABASE_URL: "https://project.supabase.co",
      TIMEFARM_SUPABASE_ANON_KEY: privilegedKey,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /must never be bundled/i);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    new RegExp(privilegedKey),
  );
});

test("hosted contract probe never presents a publishable key as a bearer token", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "timefarm-cloud-contract-"),
  );
  const preloadPath = path.join(temporaryDirectory, "capture-fetch.cjs");
  const capturePath = path.join(temporaryDirectory, "requests.json");
  const publishableKey = "sb_publishable_public-client-key_123";

  fs.writeFileSync(
    preloadPath,
    `
const fs = require("node:fs");
const capturedHeaders = [];
global.fetch = async (_url, options = {}) => {
  capturedHeaders.push(Object.fromEntries(new Headers(options.headers).entries()));
  fs.writeFileSync(process.env.TIMEFARM_REQUEST_CAPTURE, JSON.stringify(capturedHeaders));
  return {
    ok: false,
    status: 401,
    json: async () => ({ code: "42501", message: "authentication required" }),
  };
};
`,
    "utf8",
  );

  try {
    const result = spawnSync(
      process.execPath,
      ["--require", preloadPath, cloudContractPath],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          TIMEFARM_REQUEST_CAPTURE: capturePath,
          TIMEFARM_SUPABASE_URL: "https://project.supabase.co",
          TIMEFARM_SUPABASE_ANON_KEY: publishableKey,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const requests = JSON.parse(fs.readFileSync(capturePath, "utf8"));
    assert.equal(requests.length, 6);
    for (const headers of requests) {
      assert.equal(headers.apikey, publishableKey);
      assert.equal(Object.hasOwn(headers, "authorization"), false);
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
