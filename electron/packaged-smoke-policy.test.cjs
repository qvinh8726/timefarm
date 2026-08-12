const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const {
  createPackagedRendererSmokeScript,
  packagedSmokeExpectation,
} = require("./packaged-smoke-policy.cjs");

async function executeSmokeScript(entry) {
  const clicks = [];
  const headings = [];
  let dialogOpen = false;
  const elements = {
    ".auth-form": {},
    ".google-button": {},
    'input[type="email"]': {},
    'input[type="password"]': {},
    'button[title="Analytics"]': {
      click() {
        clicks.push("analytics");
        headings.push({ textContent: "Analytics" });
      },
    },
    'button[title="Settings"]': {
      click() {
        clicks.push("settings");
        headings.push({ textContent: "Settings" });
      },
    },
    ".sidebar-start": {
      click() {
        clicks.push("start");
        dialogOpen = true;
      },
    },
  };
  const allowedSelectors =
    entry === "authentication"
      ? new Set([
          ".auth-form",
          ".google-button",
          'input[type="email"]',
          'input[type="password"]',
        ])
      : new Set([
          'button[title="Analytics"]',
          'button[title="Settings"]',
          ".sidebar-start",
        ]);
  const document = {
    querySelector(selector) {
      if (selector === "#root") return { children: [{}] };
      if (selector === ".fatal-error") return null;
      if (selector === '.modal[role="dialog"]') return dialogOpen ? {} : null;
      return allowedSelectors.has(selector) ? elements[selector] : null;
    },
    querySelectorAll(selector) {
      return selector === "h1" ? headings : [];
    },
  };
  let now = 0;
  const result = vm.runInNewContext(createPackagedRendererSmokeScript(entry), {
    document,
    Date: { now: () => (now += 1_000) },
    Promise,
    setTimeout(callback) {
      callback();
    },
  });
  return { result: await result, clicks };
}

test("offline packaged smoke seeds a workspace and exercises its lazy routes", async () => {
  assert.deepEqual(packagedSmokeExpectation({ configured: false }), {
    entry: "workspace",
    seedLocalAccount: true,
  });

  assert.deepEqual(await executeSmokeScript("workspace"), {
    result: true,
    clicks: ["analytics", "settings", "start"],
  });
});

test("cloud packaged smoke preserves signed-out state and verifies every sign-in path", async () => {
  assert.deepEqual(packagedSmokeExpectation({ configured: true }), {
    entry: "authentication",
    seedLocalAccount: false,
  });

  assert.deepEqual(await executeSmokeScript("authentication"), {
    result: true,
    clicks: [],
  });
});

test("packaged smoke rejects an unknown entry expectation", () => {
  assert.throws(
    () => createPackagedRendererSmokeScript("unknown"),
    /Unsupported packaged smoke entry/,
  );
});
