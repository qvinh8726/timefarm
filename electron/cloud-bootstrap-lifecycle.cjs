async function applyCloudBootstrapIfCurrent({
  authUserId,
  expectedGeneration,
  currentGeneration,
  getAuthStatus,
  repository,
  runSerializedMutation,
  applySnapshot,
}) {
  if (currentGeneration() !== expectedGeneration) return { state: "cancelled" };
  const auth = await getAuthStatus();
  if (
    currentGeneration() !== expectedGeneration ||
    !auth?.configured ||
    !auth.authenticated ||
    auth.offline ||
    auth.user?.id !== authUserId
  ) {
    return { state: "cancelled" };
  }
  return runSerializedMutation(() => {
    if (currentGeneration() !== expectedGeneration)
      return { state: "cancelled" };
    if (repository.hasAccount()) return { state: "already_initialized" };
    return applySnapshot();
  });
}

async function applyCloudCacheRebuildIfCurrent({
  authUserId,
  expectedGeneration,
  currentGeneration,
  getAuthStatus,
  repository,
  runSerializedMutation,
  applySnapshot,
}) {
  if (currentGeneration() !== expectedGeneration) return { state: "cancelled" };
  const auth = await getAuthStatus();
  if (
    currentGeneration() !== expectedGeneration ||
    !auth?.configured ||
    !auth.authenticated ||
    auth.offline ||
    auth.user?.id !== authUserId
  ) {
    return { state: "cancelled" };
  }
  return runSerializedMutation(() => {
    if (currentGeneration() !== expectedGeneration)
      return { state: "cancelled" };
    const account = repository.getAccount();
    if (!account || account.authUserId !== authUserId)
      return { state: "cancelled" };
    return applySnapshot();
  });
}

function createCloudActivityGate() {
  let suppressionCount = 0;
  return {
    isSuppressed: () => suppressionCount > 0,
    suppress() {
      suppressionCount += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        suppressionCount -= 1;
      };
    },
  };
}

module.exports = {
  applyCloudBootstrapIfCurrent,
  applyCloudCacheRebuildIfCurrent,
  createCloudActivityGate,
};
