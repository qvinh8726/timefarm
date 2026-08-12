const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");
const { createLocalMutationExecutor } = require("./command-service.cjs");
const {
  exportRecoveryCopy,
  exportRepositoryRecoveryCopy,
  recoverySourceFiles,
} = require("./recovery-export.cjs");
const { emptyState, LocalStateRepository } = require("./state-repository.cjs");

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

test("exports database and legacy recovery sources without credentials or unrelated files", () =>
  withTemporaryDirectories(({ userDataPath, parentDirectory }) => {
    const expected = [
      "workly.db",
      "workly.db-shm",
      "workly.db-wal",
      "workly.db.pre-v2.backup",
      "workly-state.json.migrating",
      "workly-state.json.skipped-2026-08-12T01-02-03-000Z",
    ].sort((left, right) => left.localeCompare(right));
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
      [...expected, "RECOVERY-MANIFEST.json", "RECOVERY.txt"].sort(),
    );
    assert.equal(
      fs.existsSync(path.join(result.destination, "auth-session.bin")),
      false,
    );
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(result.destination, "RECOVERY-MANIFEST.json"),
        "utf8",
      ),
    );
    assert.deepEqual(
      manifest.files.map((file) => file.file),
      expected,
    );
    assert.ok(
      manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)),
    );
  }));

test("fails closed when there is no recoverable database", () =>
  withTemporaryDirectories(({ userDataPath, parentDirectory }) => {
    assert.throws(
      () => exportRecoveryCopy({ userDataPath, parentDirectory }),
      /No recoverable TimeFarm local data/,
    );
    assert.deepEqual(fs.readdirSync(parentDirectory), []);
  }));

test("manifest hashes the exported bytes when a source changes after copying", () =>
  withTemporaryDirectories(({ userDataPath, parentDirectory }) => {
    const source = path.join(userDataPath, "workly.db");
    const copiedBytes = "snapshot-before-mutation";
    fs.writeFileSync(source, copiedBytes);

    const copyFileSync = fs.copyFileSync;
    fs.copyFileSync = (...args) => {
      copyFileSync(...args);
      if (args[0] === source) fs.writeFileSync(source, "mutated-source");
    };
    let result;
    try {
      result = exportRecoveryCopy({
        userDataPath,
        parentDirectory,
        now: new Date("2026-08-12T01:02:03.000Z"),
        uniqueSuffix: "manifest-race",
      });
    } finally {
      fs.copyFileSync = copyFileSync;
    }

    const exportedDatabase = path.join(result.destination, "workly.db");
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(result.destination, "RECOVERY-MANIFEST.json"),
        "utf8",
      ),
    );
    assert.equal(fs.readFileSync(exportedDatabase, "utf8"), copiedBytes);
    assert.deepEqual(manifest.files, [
      {
        file: "workly.db",
        bytes: Buffer.byteLength(copiedBytes),
        sha256: crypto.createHash("sha256").update(copiedBytes).digest("hex"),
      },
    ]);
  }));

test("uses a repository snapshot instead of copying live SQLite journals", () =>
  withTemporaryDirectories(({ userDataPath, parentDirectory }) => {
    fs.writeFileSync(path.join(userDataPath, "workly.db"), "live-db");
    fs.writeFileSync(path.join(userDataPath, "workly.db-wal"), "live-wal");
    fs.writeFileSync(path.join(userDataPath, "workly.db-shm"), "live-shm");
    fs.writeFileSync(
      path.join(userDataPath, "workly.db.pre-v2.backup"),
      "migration-backup",
    );

    const result = exportRecoveryCopy({
      userDataPath,
      parentDirectory,
      now: new Date("2026-08-12T01:02:03.000Z"),
      uniqueSuffix: "repository-snapshot",
      createDatabaseSnapshot(destinationPath) {
        fs.writeFileSync(destinationPath, "consistent-database-snapshot", {
          flag: "wx",
        });
      },
    });

    assert.deepEqual(result.files, ["workly.db", "workly.db.pre-v2.backup"]);
    assert.equal(
      fs.readFileSync(path.join(result.destination, "workly.db"), "utf8"),
      "consistent-database-snapshot",
    );
    assert.equal(
      fs.existsSync(path.join(result.destination, "workly.db-wal")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(result.destination, "workly.db-shm")),
      false,
    );
  }));

test("repository export waits for queued mutations before creating the SQLite snapshot", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "timefarm-repository-export-test-"),
  );
  const userDataPath = path.join(root, "user-data");
  const parentDirectory = path.join(root, "exports");
  fs.mkdirSync(parentDirectory);
  const repository = new LocalStateRepository(
    path.join(userDataPath, "workly.db"),
  );
  const runSerializedMutation = createLocalMutationExecutor();
  const state = emptyState();
  state.account = {
    id: "account-after-queued-mutation",
    displayName: "Recovery Owner",
    country: "VN",
    language: "vi",
    currency: "VND",
    timezone: "Asia/Saigon",
    createdAt: "2026-08-12T01:02:03.000Z",
  };
  try {
    const mutation = runSerializedMutation(() =>
      repository.replaceState(state),
    );
    const result = await exportRepositoryRecoveryCopy({
      repository,
      runSerializedMutation,
      userDataPath,
      parentDirectory,
      now: new Date("2026-08-12T01:02:03.000Z"),
      uniqueSuffix: "queued",
    });
    await mutation;

    assert.deepEqual(result.files, ["workly.db"]);
    const snapshot = new DatabaseSync(
      path.join(result.destination, "workly.db"),
      { readOnly: true },
    );
    try {
      assert.deepEqual(
        snapshot
          .prepare("SELECT id, display_name FROM accounts")
          .all()
          .map((row) => ({ ...row })),
        [
          {
            id: "account-after-queued-mutation",
            display_name: "Recovery Owner",
          },
        ],
      );
    } finally {
      snapshot.close();
    }
  } finally {
    repository.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
