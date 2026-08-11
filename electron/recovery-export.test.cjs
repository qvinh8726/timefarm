const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  exportRecoveryCopy,
  recoverySourceFiles,
} = require("./recovery-export.cjs");

function withTemporaryDirectories(run) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "timefarm-recovery-test-"),
  );
  const userDataPath = path.join(root, "user-data");
  const parentDirectory = path.join(root, "exports");
  fs.mkdirSync(userDataPath);
  fs.mkdirSync(parentDirectory);
  try {
    return run({ root, userDataPath, parentDirectory });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("exports only the SQLite recovery set without credentials or unrelated files", () =>
  withTemporaryDirectories(({ userDataPath, parentDirectory }) => {
    const expected = [
      "workly.db",
      "workly.db-shm",
      "workly.db-wal",
      "workly.db.pre-v2.backup",
    ];
    for (const name of expected)
      fs.writeFileSync(path.join(userDataPath, name), `content:${name}`);
    fs.writeFileSync(path.join(userDataPath, "auth-session.bin"), "secret");
    fs.writeFileSync(path.join(userDataPath, "unrelated.txt"), "unrelated");

    assert.deepEqual(
      recoverySourceFiles(userDataPath).map((file) => path.basename(file)),
      expected,
    );
    const result = exportRecoveryCopy({
      userDataPath,
      parentDirectory,
      now: new Date("2026-08-12T01:02:03.000Z"),
      uniqueSuffix: "test",
    });

    assert.equal(
      path.basename(result.destination),
      "TimeFarm-recovery-2026-08-12T01-02-03-000Z-test",
    );
    assert.deepEqual(result.files, expected);
    assert.deepEqual(
      fs.readdirSync(result.destination).sort(),
      [...expected, "RECOVERY.txt"].sort(),
    );
    assert.equal(
      fs.existsSync(path.join(result.destination, "auth-session.bin")),
      false,
    );
  }));

test("fails closed when there is no recoverable database", () =>
  withTemporaryDirectories(({ userDataPath, parentDirectory }) => {
    assert.throws(
      () => exportRecoveryCopy({ userDataPath, parentDirectory }),
      /No TimeFarm database or migration backup/,
    );
    assert.deepEqual(fs.readdirSync(parentDirectory), []);
  }));
