# Privacy notes

TimeFarm stores account preferences, projects, sessions, payments, and goals in
the current Windows user's local application-data directory. The renderer does
not receive Supabase access or refresh tokens. When optional cloud sync is
configured and the user explicitly links a local workspace, eligible records
are sent to that configured Supabase project under its authenticated user ID.

Clearing local data removes the local SQLite state and legacy import files; it
does not delete hosted cloud records. TimeFarm does not include advertising or
analytics telemetry in this source tree. Exchange-rate refreshes contact the
configured FX endpoint and should be reviewed before production deployment.

This document describes the repository's current behavior, not a substitute
for a jurisdiction-specific privacy notice for a hosted production service.
