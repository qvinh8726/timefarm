# Privacy notes

TimeFarm stores account preferences, projects, sessions, payments, and goals in
the current Windows user's local application-data directory. The renderer does
not receive Supabase access or refresh tokens. When optional cloud sync is
configured and the user explicitly links a local workspace, eligible records
are sent to that configured Supabase project under its authenticated user ID.

**Wipe this device** signs out, clears browser/authentication state, removes
business and sync rows from SQLite, checkpoints/truncates its WAL, vacuums the
database, and removes known legacy/pre-migration files before verifying the
result. It does not claim cryptographic erasure on SSDs, snapshots, backups, or
other storage layers, and it deliberately does not pull cloud data back after
the wipe. **Rebuild cache from cloud** is a separate operation and is available
only when the linked online workspace can be replaced safely.

Neither operation deletes hosted Supabase rows or the Supabase Auth user.
Deleting hosted records currently requires the operator of the configured
Supabase project to fulfill the request; do not describe a local wipe as cloud
account deletion. A production operator must publish a verified request and
retention process before offering hosted TimeFarm accounts to end users.

TimeFarm does not include advertising or analytics telemetry in this source
tree. Exchange-rate refreshes send only requested currency codes to the
configured FX endpoint; no account ID, project, session, payment, or amount is
included. The provider and its production privacy terms should still be
reviewed before deployment.

This document describes the repository's current behavior, not a substitute
for a jurisdiction-specific privacy notice for a hosted production service.
