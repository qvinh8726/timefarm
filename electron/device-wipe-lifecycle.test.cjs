const assert = require("node:assert/strict");
const test = require("node:test");

const { wipeDeviceState } = require("./device-wipe-lifecycle.cjs");

test("publishes the empty workspace even when auxiliary cleanup is incomplete", () => {
  const emptyState = { account: null, projects: [] };
  let published = null;
  const result = wipeDeviceState({
    wipeWorkspace: () => ({
      state: emptyState,
      verification: { remainingRows: 0 },
    }),
    cleanupAuxiliaryFiles: () => {
      throw new Error("fx-rates.json is locked");
    },
    publishState: (state) => {
      published = state;
    },
  });

  assert.equal(published, emptyState);
  assert.deepEqual(result, {
    state: emptyState,
    verification: { remainingRows: 0 },
    cleanupWarning:
      "The workspace was removed, but some device-only files could not be deleted: fx-rates.json is locked",
  });
});

test("does not publish an empty state when the workspace wipe itself fails", () => {
  let published = false;
  assert.throws(
    () =>
      wipeDeviceState({
        wipeWorkspace: () => {
          throw new Error("SQLite wipe failed");
        },
        cleanupAuxiliaryFiles: () => {},
        publishState: () => {
          published = true;
        },
      }),
    /SQLite wipe failed/,
  );
  assert.equal(published, false);
});
