function wipeDeviceState({
  wipeWorkspace,
  cleanupAuxiliaryFiles,
  publishState,
}) {
  const wiped = wipeWorkspace();
  let cleanupWarning;
  try {
    cleanupAuxiliaryFiles();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    cleanupWarning = `The workspace was removed, but some device-only files could not be deleted: ${message}`;
  }
  publishState(wiped.state);
  return { ...wiped, ...(cleanupWarning ? { cleanupWarning } : {}) };
}

module.exports = { wipeDeviceState };
