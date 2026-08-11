class LocalAccountPrincipalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LocalAccountPrincipalError";
    this.code = code;
  }
}

function cloudSyncEligibility(account) {
  if (!account) return { eligible: false, state: "no_local_account" };
  if (!account.authUserId) return { eligible: false, state: "not_claimed" };
  return { eligible: true, state: "eligible" };
}

/**
 * Resolves the durable owner of local data without making an unclaimed local
 * profile cloud-eligible. An auth service may report `offline: true` while it
 * still has a securely stored, locally verifiable session identity; that
 * identity is sufficient for local-first commands but never for sync.
 */
/** @param {{account?: any, authService?: any}} options */
async function resolveLocalAccountPrincipal({ account, authService } = {}) {
  const eligibility = cloudSyncEligibility(account);
  if (!eligibility.eligible) {
    return {
      account: account ?? null,
      linked: false,
      offline: false,
      auth: null,
      state: eligibility.state,
    };
  }
  if (!authService || typeof authService.getStatus !== "function") {
    throw new LocalAccountPrincipalError(
      "AUTH_STATUS_UNAVAILABLE",
      "Authentication status is unavailable for linked local data.",
    );
  }
  const auth = await authService.getStatus();
  if (
    !auth?.authenticated ||
    !auth.user?.id ||
    auth.user.id !== account.authUserId
  ) {
    throw new LocalAccountPrincipalError(
      "LOCAL_ACCOUNT_OWNER_MISMATCH",
      "The signed-in account does not own this local TimeFarm data.",
    );
  }
  return {
    account,
    linked: true,
    offline: Boolean(auth.offline),
    auth,
    state: auth.offline ? "owned_offline" : "owned",
  };
}

module.exports = {
  LocalAccountPrincipalError,
  cloudSyncEligibility,
  resolveLocalAccountPrincipal,
};
