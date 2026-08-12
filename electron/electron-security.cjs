function requireMethod(owner, method, label) {
  if (!owner || typeof owner[method] !== "function")
    throw new TypeError(`${label}.${method} must be a function.`);
}

/**
 * Install process-wide renderer permission and webview defenses.
 *
 * TimeFarm does not need privileged browser capabilities. Denying every
 * permission here also keeps newly introduced Chromium permissions closed
 * until the application deliberately opts into one with a reviewed policy.
 */
function installElectronSecurityHandlers(dependencies) {
  if (!dependencies || typeof dependencies !== "object")
    throw new TypeError("Electron security dependencies are required.");

  const { app, session } = dependencies;
  requireMethod(app, "on", "app");
  requireMethod(session, "setPermissionCheckHandler", "session");
  requireMethod(session, "setPermissionRequestHandler", "session");

  const denyPermissionCheck = () => false;
  const denyPermissionRequest = (_webContents, _permission, callback) => {
    if (typeof callback !== "function")
      throw new TypeError("Permission request callback must be a function.");
    callback(false);
  };
  const preventWebviewAttachment = (event) => {
    if (!event || typeof event.preventDefault !== "function")
      throw new TypeError("Webview attachment event must be preventable.");
    event.preventDefault();
  };
  const protectCreatedWebContents = (_event, webContents) => {
    requireMethod(webContents, "on", "webContents");
    webContents.on("will-attach-webview", preventWebviewAttachment);
  };

  session.setPermissionCheckHandler(denyPermissionCheck);
  session.setPermissionRequestHandler(denyPermissionRequest);
  app.on("web-contents-created", protectCreatedWebContents);

  return {
    denyPermissionCheck,
    denyPermissionRequest,
    preventWebviewAttachment,
    protectCreatedWebContents,
  };
}

module.exports = { installElectronSecurityHandlers };
