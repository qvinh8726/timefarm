const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const timeoutMs = 25_000;

function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  childProcess.spawnSync(
    "taskkill.exe",
    ["/pid", String(child.pid), "/t", "/f"],
    { windowsHide: true, stdio: "ignore" },
  );
}

async function run() {
  if (process.platform !== "win32")
    throw new Error("The packaged Windows smoke test must run on Windows.");

  const executable = path.resolve(
    process.argv[2] || path.join("release", "win-unpacked", "TimeFarm.exe"),
  );
  if (!fs.existsSync(executable))
    throw new Error(`Packaged executable not found: ${executable}`);

  const temporaryRoot = path.resolve(os.tmpdir());
  const userDataPath = fs.mkdtempSync(
    path.join(temporaryRoot, "timefarm-package-smoke-"),
  );
  if (!userDataPath.startsWith(`${temporaryRoot}${path.sep}`))
    throw new Error(
      "Refusing to use a smoke profile outside the OS temp root.",
    );

  let child;
  try {
    child = childProcess.spawn(
      executable,
      [
        `--user-data-dir=${userDataPath}`,
        "--timefarm-smoke-test",
        "--disable-gpu",
      ],
      { windowsHide: true, stdio: "ignore" },
    );

    const outcome = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        stopProcessTree(child);
        reject(
          new Error(
            `Packaged application did not finish within ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });

    if (outcome.code !== 0 || outcome.signal)
      throw new Error(
        `Packaged application smoke failed (code=${outcome.code}, signal=${outcome.signal ?? "none"}).`,
      );

    console.log(
      `Packaged application smoke passed: ${path.basename(executable)} loaded its configured runtime entry flow, then exited cleanly.`,
    );
  } finally {
    if (child) stopProcessTree(child);
    fs.rmSync(userDataPath, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
