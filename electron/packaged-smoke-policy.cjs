const PACKAGED_SMOKE_ENTRIES = new Set(["authentication", "workspace"]);

function packagedSmokeExpectation({ configured }) {
  if (typeof configured !== "boolean")
    throw new Error(
      "Packaged smoke configuration must declare whether cloud auth is configured.",
    );
  return configured
    ? { entry: "authentication", seedLocalAccount: false }
    : { entry: "workspace", seedLocalAccount: true };
}

function createPackagedRendererSmokeScript(entry) {
  if (!PACKAGED_SMOKE_ENTRIES.has(entry))
    throw new Error(`Unsupported packaged smoke entry: ${String(entry)}`);

  const entryAssertions =
    entry === "authentication"
      ? `
      await waitFor(() => document.querySelector('.auth-form'), 'the authentication form');
      await waitFor(() => document.querySelector('.google-button'), 'the Google sign-in action');
      await waitFor(() => document.querySelector('input[type="email"]'), 'the email input');
      await waitFor(() => document.querySelector('input[type="password"]'), 'the password input');`
      : `
      await click('button[title="Analytics"]', 'Analytics navigation');
      await waitFor(
        () => [...document.querySelectorAll('h1')].some((node) => node.textContent?.trim() === 'Analytics'),
        'the lazy Analytics page',
      );
      await click('button[title="Settings"]', 'Settings navigation');
      await waitFor(
        () => [...document.querySelectorAll('h1')].some((node) => node.textContent?.trim() === 'Settings'),
        'the lazy Settings page',
      );
      await click('.sidebar-start', 'start-session action');
      await waitFor(
        () => document.querySelector('.modal[role="dialog"]'),
        'the lazy workspace dialog',
      );`;

  return `(() => {
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Timed out waiting for ' + label);
    };
    const click = async (selector, label) => {
      const element = await waitFor(() => document.querySelector(selector), label);
      element.click();
    };
    return (async () => {
      await waitFor(
        () => document.querySelector('#root')?.children.length && !document.querySelector('.fatal-error'),
        'a healthy React root',
      );${entryAssertions}
      if (document.querySelector('.fatal-error')) throw new Error('Fatal renderer boundary appeared.');
      return true;
    })();
  })()`;
}

module.exports = {
  createPackagedRendererSmokeScript,
  packagedSmokeExpectation,
};
