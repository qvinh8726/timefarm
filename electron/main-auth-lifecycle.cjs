async function performMainSignOut({
  authService,
  syncService,
  cancelSyncContinuation,
  invalidateCloudLifecycle,
  notifyAuthChanged,
}) {
  syncService.cancelPendingSync?.();
  cancelSyncContinuation();
  invalidateCloudLifecycle();
  const status = await authService.signOut();
  notifyAuthChanged(status);
  return status;
}

module.exports = { performMainSignOut };
