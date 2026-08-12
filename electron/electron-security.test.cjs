const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { installElectronSecurityHandlers } = require("./electron-security.cjs");

function createDependencies() {
  const app = new EventEmitter();
  const session = {
    permissionCheckHandler: undefined,
    permissionRequestHandler: undefined,
    setPermissionCheckHandler(handler) {
      this.permissionCheckHandler = handler;
    },
    setPermissionRequestHandler(handler) {
      this.permissionRequestHandler = handler;
    },
  };
  return { app, session };
}

test("denies permission checks and requests for every renderer capability", () => {
  const dependencies = createDependencies();
  installElectronSecurityHandlers(dependencies);

  for (const permission of [
    "media",
    "geolocation",
    "notifications",
    "clipboard-read",
    "display-capture",
    "unknown-future-permission",
  ]) {
    assert.equal(
      dependencies.session.permissionCheckHandler(
        null,
        permission,
        "file:///app/index.html",
        {},
      ),
      false,
    );

    const decisions = [];
    dependencies.session.permissionRequestHandler(
      {},
      permission,
      (allowed) => decisions.push(allowed),
      {},
    );
    assert.deepEqual(decisions, [false]);
  }
});

test("prevents webview attachment on every subsequently created webContents", () => {
  const dependencies = createDependencies();
  installElectronSecurityHandlers(dependencies);

  for (let index = 0; index < 2; index += 1) {
    const webContents = new EventEmitter();
    dependencies.app.emit("web-contents-created", {}, webContents);

    let preventionCount = 0;
    webContents.emit("will-attach-webview", {
      preventDefault() {
        preventionCount += 1;
      },
    });
    assert.equal(preventionCount, 1);
  }
});

test("validates injected Electron dependencies before installing handlers", () => {
  assert.throws(
    () => installElectronSecurityHandlers(),
    /security dependencies are required/,
  );
  assert.throws(
    () => installElectronSecurityHandlers({ app: {}, session: {} }),
    /app\.on must be a function/,
  );
  assert.throws(
    () =>
      installElectronSecurityHandlers({
        app: new EventEmitter(),
        session: { setPermissionRequestHandler() {} },
      }),
    /session\.setPermissionCheckHandler must be a function/,
  );
  assert.throws(
    () =>
      installElectronSecurityHandlers({
        app: new EventEmitter(),
        session: { setPermissionCheckHandler() {} },
      }),
    /session\.setPermissionRequestHandler must be a function/,
  );
});

test("rejects malformed permission callbacks and webContents events", () => {
  const dependencies = createDependencies();
  const handlers = installElectronSecurityHandlers(dependencies);

  assert.throws(
    () => handlers.denyPermissionRequest({}, "media", undefined, {}),
    /callback must be a function/,
  );
  assert.throws(
    () => handlers.protectCreatedWebContents({}, {}),
    /webContents\.on must be a function/,
  );
  assert.throws(
    () => handlers.preventWebviewAttachment({}),
    /event must be preventable/,
  );
});
