const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const timeoutMs = 90_000;
const cleanupAttempts = 30;
const cleanupRetryDelayMs = 500;

function newestInstaller(releaseDirectory) {
  return fs
    .readdirSync(releaseDirectory, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && /^TimeFarm-.+-Setup\.exe$/i.test(entry.name),
    )
    .map((entry) => {
      const filePath = path.join(releaseDirectory, entry.name);
      return { filePath, modifiedAt: fs.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.filePath;
}

function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  childProcess.spawnSync(
    "taskkill.exe",
    ["/pid", String(child.pid), "/t", "/f"],
    { windowsHide: true, stdio: "ignore" },
  );
}

function runProcess(executable, args, label) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(executable, args, {
      windowsHide: true,
      stdio: "inherit",
    });
    const timeout = setTimeout(() => {
      stopProcessTree(child);
      reject(new Error(`${label} did not finish within ${timeoutMs}ms.`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0 || signal) {
        reject(
          new Error(
            `${label} failed (code=${code}, signal=${signal ?? "none"}).`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

async function removeInstallDirectory(directory) {
  for (let attempt = 1; attempt <= cleanupAttempts; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      const retryable =
        error &&
        typeof error === "object" &&
        ["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code);
      if (!retryable || attempt === cleanupAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, cleanupRetryDelayMs));
    }
  }
}

async function run() {
  if (process.platform !== "win32")
    throw new Error("The NSIS installer smoke test must run on Windows.");

  const releaseDirectory = path.resolve("release");
  const installer = process.argv[2]
    ? path.resolve(process.argv[2])
    : newestInstaller(releaseDirectory);
  if (!installer || !fs.existsSync(installer))
    throw new Error("A TimeFarm NSIS installer was not found in release/.");

  const temporaryRoot = path.resolve(os.tmpdir());
  const installDirectory = fs.mkdtempSync(
    path.join(temporaryRoot, "timefarm-installer-smoke-"),
  );
  if (!installDirectory.startsWith(`${temporaryRoot}${path.sep}`))
    throw new Error("Refusing to install outside the OS temp root.");

  const executable = path.join(installDirectory, "TimeFarm.exe");
  const uninstaller = path.join(installDirectory, "Uninstall TimeFarm.exe");
  let installed = false;
  let smokeError;
  try {
    await runProcess(
      installer,
      ["/S", `/D=${installDirectory}`],
      "TimeFarm installer",
    );
    installed = true;
    if (!fs.existsSync(executable))
      throw new Error(`The installer did not create ${executable}.`);

    await runProcess(
      process.execPath,
      [path.join(__dirname, "smoke-packaged-app.cjs"), executable],
      "Installed application smoke test",
    );
  } catch (error) {
    smokeError = error;
  }

  let cleanupError;
  if (installed && fs.existsSync(uninstaller)) {
    try {
      await runProcess(uninstaller, ["/S"], "TimeFarm uninstaller");
    } catch (error) {
      cleanupError = error;
    }
  }
  const resolvedInstallDirectory = path.resolve(installDirectory);
  if (resolvedInstallDirectory.startsWith(`${temporaryRoot}${path.sep}`)) {
    try {
      await removeInstallDirectory(resolvedInstallDirectory);
    } catch (error) {
      cleanupError ??= error;
    }
  }
  if (smokeError && cleanupError)
    throw new AggregateError(
      [smokeError, cleanupError],
      "Installed application smoke and cleanup both failed.",
    );
  if (smokeError) throw smokeError;
  if (cleanupError) throw cleanupError;
  console.log(
    `Windows installer smoke passed: ${path.basename(installer)} installed, rendered, uninstalled, and cleaned up.`,
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
