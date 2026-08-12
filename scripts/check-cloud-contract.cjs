const {
  assertCloudConfiguration,
} = require("../electron/cloud-configuration.cjs");

const urlValue = process.env.TIMEFARM_SUPABASE_URL;
const anonKeyValue = process.env.TIMEFARM_SUPABASE_ANON_KEY;

if (!urlValue?.trim() || !anonKeyValue?.trim()) {
  console.error(
    "Cloud contract check requires TIMEFARM_SUPABASE_URL and TIMEFARM_SUPABASE_ANON_KEY.",
  );
  process.exit(1);
}

let configuration;
try {
  configuration = assertCloudConfiguration({
    url: urlValue,
    anonKey: anonKeyValue,
    redirectUrl: "timefarm://auth/callback",
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

async function run() {
  const probes = [
    {
      name: "workly_claim_workspace",
      body: {
        p_workspace_id: "timefarm-unauthenticated-contract-probe",
        p_profile: {},
      },
    },
    {
      name: "workly_bootstrap_page_v2",
      body: {
        p_after_type: null,
        p_after_id: null,
        p_snapshot_cursor: null,
        p_limit: 1,
      },
    },
    { name: "workly_get_entity_revisions", body: { p_entities: [] } },
    {
      name: "workly_pull_changes",
      body: { p_cursor: 0, p_limit: 1 },
    },
    {
      name: "workly_acquire_timer_lease",
      body: {
        p_device_id: "00000000-0000-4000-8000-000000000001",
        p_seconds: 45,
      },
    },
    {
      name: "workly_apply_sync_operation",
      body: {
        p_operation_id: "00000000-0000-4000-8000-000000000002",
        p_entity_type: "account",
        p_entity_id: "00000000-0000-4000-8000-000000000003",
        p_operation: "upsert",
        p_payload: {},
        p_expected_revision: 0,
      },
    },
  ];

  for (const probe of probes) {
    const response = await fetch(
      `${configuration.url}/rest/v1/rpc/${probe.name}`,
      {
        method: "POST",
        headers: {
          apikey: configuration.anonKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(probe.body),
        signal: AbortSignal.timeout(15_000),
      },
    );

    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.message === "string" ? payload.message : "";
    if (response.ok)
      throw new Error(
        `${probe.name} unexpectedly accepted an unauthenticated request.`,
      );
    const normalizedMessage = message.toLowerCase();
    const safelyRejected =
      payload.code === "42501" ||
      normalizedMessage.includes("authentication required") ||
      normalizedMessage.includes("permission denied for function");
    if (!safelyRejected)
      throw new Error(
        `Cloud RPC ${probe.name} is not ready (${response.status}, ${payload.code ?? "unknown"}): ${message || "unexpected response"}`,
      );
  }

  console.log(
    `Cloud contract passed: ${probes.length} required RPCs exist and reject unauthenticated callers.`,
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
