const childProcess = require("node:child_process");

const builderArguments = ["--win", "nsis", "--x64", "--publish", "never"];
const maxAttempts = 3;
const retryDelayMs = 5_000;
const attemptTimeoutMs = 7 * 60_000;
const terminationGraceMs = 15_000;
const maxCapturedOutputCharacters = 1_000_000;
const transientFailurePatterns = [
  /Response code (?:408|429|5\d{2})\b/i,
  /\b(?:EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETRESET|ENETUNREACH|ENOTFOUND|EHOSTUNREACH|EPIPE|ETIMEDOUT|ESOCKETTIMEDOUT)\b/i,
  /\bsocket hang up\b/i,
  /\b(?:connect|network|request|TLS handshake) timed? ?out\b/i,
  /^electron-builder attempt timed out$/i,
];
const failureLinePattern =
  /Response code|\b(?:EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETRESET|ENETUNREACH|ENOTFOUND|EHOSTUNREACH|EPIPE|ETIMEDOUT|ESOCKETTIMEDOUT)\b|socket hang up|timed? ?out|\b(?:error|failed)\b/i;
const terminationFailureCode = "TIMEFARM_ELECTRON_BUILDER_TERMINATION_FAILED";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function terminalFailureLine(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && failureLinePattern.test(line))
    .at(-1);
}

function isTransientElectronBuilderFailure(output) {
  const failure = terminalFailureLine(output);
  return Boolean(
    failure &&
      transientFailurePatterns.some((pattern) => pattern.test(failure)),
  );
}

function stopProcessTree(child, options = {}) {
  if (!child.pid) return false;
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    const taskkill =
      options.taskkill ??
      ((pid) =>
        childProcess.spawnSync(
          "taskkill.exe",
          ["/pid", String(pid), "/t", "/f"],
          {
            windowsHide: true,
            stdio: "ignore",
            timeout: terminationGraceMs,
          },
        ));
    const result = taskkill(child.pid);
    if (!result.error && result.status === 0) return true;
    return false;
  }
  if (child.exitCode !== null) return true;
  return child.kill("SIGKILL");
}

function runElectronBuilder(arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const electronBuilderCli = require.resolve(
      "electron-builder/out/cli/cli.js",
    );
    const child = childProcess.spawn(
      process.execPath,
      [electronBuilderCli, ...arguments_],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["inherit", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let output = "";
    let timedOut = false;
    let terminationTimer;
    const capture = (chunk, destination) => {
      const text = chunk.toString();
      destination.write(text);
      output = `${output}${text}`.slice(-maxCapturedOutputCharacters);
    };
    const cleanup = () => {
      options.signal?.removeEventListener("abort", abort);
      clearTimeout(terminationTimer);
    };
    const terminationError = (message) =>
      Object.assign(new Error(message), { code: terminationFailureCode });
    const abort = () => {
      timedOut = true;
      if (!stopProcessTree(child)) {
        cleanup();
        reject(
          terminationError(
            "electron-builder process tree could not be stopped.",
          ),
        );
        return;
      }
      terminationTimer = setTimeout(() => {
        cleanup();
        reject(
          terminationError(
            "electron-builder did not exit after forced process-tree termination.",
          ),
        );
      }, terminationGraceMs);
    };

    child.stdout.on("data", (chunk) => capture(chunk, process.stdout));
    child.stderr.on("data", (chunk) => capture(chunk, process.stderr));
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      cleanup();
      resolve({
        exitCode: exitCode ?? 1,
        output: timedOut
          ? `${output}\nelectron-builder attempt timed out`
          : output,
        signal,
      });
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

async function runElectronBuilderWithRetry(options = {}) {
  const run = options.run ?? runElectronBuilder;
  const wait = options.sleep ?? sleep;
  const timeoutMs = options.timeoutMs ?? attemptTimeoutMs;
  const logger = options.logger ?? console;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("electron-builder attempt timeout must be positive.");

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    logger.log(
      `[packaging] electron-builder attempt ${attempt} of ${maxAttempts}.`,
    );
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let result;
    let runError;
    try {
      result = await run(builderArguments, {
        attempt,
        signal: controller.signal,
      });
    } catch (error) {
      runError = error;
      result = {
        exitCode: 1,
        output:
          error instanceof Error ? error.stack || error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
    if (result.exitCode === 0) return result;
    if (
      runError &&
      typeof runError === "object" &&
      runError.code === terminationFailureCode
    )
      throw runError;

    const output = timedOut
      ? `${result.output ?? ""}\nelectron-builder attempt timed out`
      : (result.output ?? "");
    const transient = isTransientElectronBuilderFailure(output);
    if (!transient)
      throw new Error(
        `electron-builder failed with a non-transient error on attempt ${attempt} of ${maxAttempts}.`,
      );
    if (attempt === maxAttempts)
      throw new Error(
        `electron-builder failed after ${maxAttempts} transient attempts.`,
      );

    const delay = retryDelayMs * attempt;
    logger.warn(
      `[packaging] Transient network/CDN failure on attempt ${attempt} of ${maxAttempts}; retrying in ${delay / 1_000}s.`,
    );
    await wait(delay);
  }

  throw new Error("electron-builder retry reached an unreachable state.");
}

if (require.main === module) {
  if (process.argv.slice(2).join("\0") !== builderArguments.join("\0")) {
    console.error("Unsupported electron-builder packaging arguments.");
    process.exitCode = 1;
  } else {
    runElectronBuilderWithRetry().catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  isTransientElectronBuilderFailure,
  runElectronBuilder,
  runElectronBuilderWithRetry,
  stopProcessTree,
};
