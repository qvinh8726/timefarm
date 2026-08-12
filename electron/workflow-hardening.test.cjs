const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "..");

test("one-time production baseline workflow is absent after migration history is established", () => {
  assert.equal(
    fs.existsSync(
      path.join(
        repositoryRoot,
        ".github",
        "workflows",
        "baseline-production-database.yml",
      ),
    ),
    false,
  );
});

function readWorkflow(name) {
  return fs.readFileSync(
    path.join(repositoryRoot, ".github", "workflows", name),
    "utf8",
  );
}

function positionOf(source, value, description) {
  const position = source.indexOf(value);
  assert.notEqual(position, -1, `Missing ${description}: ${value}`);
  return position;
}

function assertOrdered(source, entries) {
  let previous = -1;
  for (const [description, value] of entries) {
    const current = positionOf(source, value, description);
    assert.ok(
      current > previous,
      `${description} must appear after the preceding release gate`,
    );
    previous = current;
  }
}

test("release proves the tagged SHA belongs to master before secrets or build code", () => {
  const workflow = readWorkflow("release.yml");
  const lineageGate = positionOf(
    workflow,
    "- name: Require release commit on master",
    "release lineage gate",
  );
  const setupPnpm = positionOf(
    workflow,
    "uses: pnpm/action-setup@",
    "pnpm setup",
  );

  assert.match(
    workflow,
    /uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+fetch-depth:\s*0/,
  );
  const checkoutBlock = workflow.slice(
    positionOf(workflow, "uses: actions/checkout@", "checkout action"),
    lineageGate,
  );
  assert.match(checkoutBlock, /persist-credentials:\s*false/);
  assert.match(
    workflow,
    /git fetch --no-tags origin ["']\+refs\/heads\/master:refs\/remotes\/origin\/master["']/,
  );
  assert.match(
    workflow,
    /git merge-base --is-ancestor \$env:GITHUB_SHA origin\/master/,
  );
  assert.ok(lineageGate < setupPnpm, "Release lineage must precede setup code");

  for (const [description, marker] of [
    ["first release secret", "${{ secrets."],
    ["dependency installation", "pnpm install --frozen-lockfile"],
    ["renderer build", "pnpm build"],
  ]) {
    assert.ok(
      lineageGate < positionOf(workflow, marker, description),
      `Release lineage must be verified before ${description}`,
    );
  }
});

test("manual database deployment validates master and a clean local replay before production access", () => {
  const workflow = readWorkflow("deploy-database.yml");

  assert.match(
    workflow,
    /uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+fetch-depth:\s*0/,
  );
  assert.match(workflow, /GITHUB_REF[^\n]+refs\/heads\/master/);
  assert.match(
    workflow,
    /git fetch --no-tags origin ["']\+refs\/heads\/master:refs\/remotes\/origin\/master["']/,
  );
  assert.match(
    workflow,
    /git merge-base --is-ancestor ["']?\$GITHUB_SHA["']? origin\/master/,
  );
  assert.match(workflow, /supabase db start/);
  assert.match(workflow, /supabase db lint --local --level error/);
  assert.match(workflow, /supabase test db --local/);

  const stopMarker = "- name: Stop local Supabase services";
  const stopPosition = positionOf(workflow, stopMarker, "local cleanup");
  const stopBlock = workflow.slice(
    stopPosition,
    workflow.indexOf("\n      - name:", stopPosition + stopMarker.length),
  );
  assert.match(stopBlock, /if:\s+success\(\) \|\| failure\(\)/);
  assert.doesNotMatch(stopBlock, /\$\{\{ secrets\./);

  assertOrdered(workflow, [
    ["database lineage gate", "- name: Require deployment commit on master"],
    [
      "local migration replay",
      "- name: Start a fresh local database and replay migrations",
    ],
    [
      "local schema checks",
      "- name: Lint and test schema, RLS, and RPC contracts",
    ],
    ["local cleanup", stopMarker],
    [
      "production credential check",
      "- name: Require production migration credentials",
    ],
    ["production link", "- name: Link production project"],
    ["migration preview", "- name: Preview pending migrations"],
    ["migration apply", "- name: Apply pending migrations"],
  ]);

  const firstSecret = positionOf(
    workflow,
    "${{ secrets.",
    "first database deployment secret",
  );
  const localChecks = positionOf(
    workflow,
    "- name: Lint and test schema, RLS, and RPC contracts",
    "local database checks",
  );
  assert.ok(
    firstSecret > localChecks,
    "Production secrets must not be exposed before local migration checks pass",
  );
  assert.ok(
    positionOf(workflow, "uses: supabase/setup-cli@", "Supabase setup") <
      firstSecret,
    "Only immutable setup code may run before production secrets are exposed",
  );
});

test("CI and release audit the full lockfile including packaged build tools", () => {
  for (const name of ["ci.yml", "release.yml"]) {
    const workflow = readWorkflow(name);
    assert.match(workflow, /pnpm audit --audit-level high/);
    assert.doesNotMatch(workflow, /pnpm audit[^\n]*--prod/);
  }
});

test("CI smoke-tests an explicit offline installer instead of a fake cloud login", () => {
  const workflow = readWorkflow("ci.yml");
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );

  assert.match(workflow, /^\s+run:\s*pnpm pack:win:offline\s*$/m);
  assert.doesNotMatch(
    workflow,
    /TIMEFARM_SUPABASE_URL:\s*https:\/\/ci-contract\.invalid/,
  );
  assert.match(
    packageJson.scripts["pack:win:offline"],
    /prepare-offline-runtime-config\.cjs/,
  );
  assert.match(packageJson.scripts["pack:win:offline"], /--win nsis --x64/);
  assert.match(
    packageJson.scripts["pack:win:offline"],
    /check-packaged-runtime-config\.cjs offline/,
  );
  assert.match(
    packageJson.scripts["pack:win:offline"],
    /run-electron-builder-with-retry\.cjs --win nsis --x64 --publish never/,
  );
});

test("CI and release package scripts use the same bounded transient builder retry", () => {
  const ciWorkflow = readWorkflow("ci.yml");
  const releaseWorkflow = readWorkflow("release.yml");
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );

  assert.match(ciWorkflow, /^\s+run:\s*pnpm pack:win:offline\s*$/m);
  assert.match(releaseWorkflow, /^\s+run:\s*pnpm pack:win\s*$/m);
  assert.match(
    packageJson.scripts["pack:win"],
    /run-electron-builder-with-retry\.cjs --win nsis --x64 --publish never/,
  );
  assert.match(
    packageJson.scripts["pack:win:offline"],
    /run-electron-builder-with-retry\.cjs --win nsis --x64 --publish never/,
  );
});

test("release checks, attests, and publishes only the exact package artifact", () => {
  const workflow = readWorkflow("release.yml");

  assert.match(workflow, /^\s+id:\s+release_contract\s*$/m);
  assert.match(
    workflow,
    /installer=release\/TimeFarm-\$packageVersion-Setup\.exe/,
  );
  assert.match(workflow, /sbom=release\/TimeFarm-\$packageVersion\.spdx\.json/);
  assert.doesNotMatch(workflow, /TimeFarm-\*-Setup\.exe/);
  assert.match(
    workflow,
    /subject-path:\s*\$\{\{ steps\.release_contract\.outputs\.installer \}\}/,
  );
  assert.match(
    workflow,
    /^\s+\$\{\{ steps\.release_contract\.outputs\.installer \}\}\s*$/m,
  );
  assert.match(workflow, /^\s+path:\s+release\/win-unpacked\s*$/m);
  assert.doesNotMatch(workflow, /^\s+path:\s+\.\s*$/m);
  assert.match(
    workflow,
    /sbom-path:\s*\$\{\{ steps\.release_contract\.outputs\.sbom \}\}/,
  );
});

test("release passes the tag through GitHub's environment instead of PowerShell interpolation", () => {
  const workflow = readWorkflow("release.yml");
  assert.match(workflow, /^\s+node scripts\/check-release-contract\.cjs\s*$/m);
  assert.doesNotMatch(
    workflow,
    /node scripts\/check-release-contract\.cjs[^\n]*\$\{\{\s*github\.ref_name/,
  );
});

test("release builds only unsigned v0 prereleases after source and cloud gates", () => {
  const workflow = readWorkflow("release.yml");
  const verifySource = positionOf(
    workflow,
    "- name: Verify source",
    "source verification",
  );
  const verifyCloud = positionOf(
    workflow,
    "- name: Verify hosted database contract",
    "hosted database verification",
  );
  const buildUnsignedInstaller = positionOf(
    workflow,
    "- name: Build unsigned installer",
    "unsigned installer build",
  );
  const nextStep = workflow.indexOf(
    "\n      - name:",
    buildUnsignedInstaller + 1,
  );
  const buildBlock = workflow.slice(
    buildUnsignedInstaller,
    nextStep === -1 ? workflow.length : nextStep,
  );

  assert.match(workflow, /^\s*-\s+["']v0\.\*["']\s*$/m);
  assert.doesNotMatch(workflow, /^\s*-\s+["']v\*["']\s*$/m);
  assert.match(workflow, /^\s+environment:\s+production\s*$/m);
  assert.ok(verifySource < verifyCloud);
  assert.ok(verifyCloud < buildUnsignedInstaller);
  assert.doesNotMatch(workflow, /WINDOWS_CSC_(?:LINK|KEY_PASSWORD)/);
  assert.match(buildBlock, /CSC_IDENTITY_AUTO_DISCOVERY:\s*["']false["']/);
  assert.match(buildBlock, /^\s+run:\s*pnpm pack:win\s*$/m);
  assert.match(
    workflow,
    /Smoke-test the unsigned packaged application and installer/,
  );
  assert.match(workflow, /Get-AuthenticodeSignature/);
  assert.match(workflow, /\$signature\.Status -ne ["']NotSigned["']/);
  assert.match(workflow, /Set-Content[^\n]+release\/SHA256SUMS\.txt/);
  assert.match(workflow, /uses: anchore\/sbom-action@/);
  assert.match(workflow, /uses: actions\/attest-sbom@/);
  assert.match(workflow, /uses: actions\/attest-build-provenance@/);
  assert.match(
    workflow,
    /subject-path:\s*\$\{\{ steps\.release_contract\.outputs\.installer \}\}/,
  );
  assert.match(workflow, /^\s+prerelease:\s+true\s*$/m);
});
