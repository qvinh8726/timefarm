# Decision Log

## Product decisions

- Desktop-first: Windows.
- Cloud synchronization is a product goal, but the app remains useful offline.
- Future web, Android, and iOS clients are possible; no client is implied by the current desktop build.
- Multi-user architecture is required from the beginning, although the initial use case is personal.
- Authentication path: email/password and Google through Supabase Auth when a project is configured.
- Multiple-device login is allowed. A device may not start or resume when a currently valid lease belongs to another device; remote devices never directly control a local active timer.
- One active timer per account on a local device. An offline lease failure is not treated as global exclusivity; later overlap review remains necessary.
- Sessions may be attached to a project or left unassigned.
- Projects have name, payment model, expected money, note, color, icon, and status (`active`, `paused`, `completed`).
- Payment models support per-session, project-completion, and progressive payments; payments are separate facts from a session's actual earnings.
- Only the latest interrupted/completed session can be edited in the UI; older history stays protected.
- Completed sessions require actual earnings input; zero is valid.
- Dashboard has predefined widgets only. User layout preferences may be stored, but arbitrary custom charts are out of scope.
- Mini timer modes are interactive, view-only, and hidden. View-only mode must be click-through.
- Sidebar sections are Dashboard, Projects, History, Analytics, Profile, and Settings. There is no command palette/Ctrl+K.
- Light and dark themes, Vietnamese and English, country/currency identity settings, and device timezone defaults are supported concepts.
- Original money values are immutable. FX data must come from a replaceable real provider and must never be fabricated.
- Goals and data-backed insights are core features; an insight must say that data is insufficient rather than guess.

## Technical decisions already implemented

- **Electron + React + TypeScript.** Electron supplies the Windows shell and native overlay capability; React/Vite keeps the renderer simple and testable.
- **Pinned desktop runtime.** Electron is pinned to `43.3.0` rather than floating `latest`, locking the Node 24 runtime used by the built-in SQLite API.
- **SQLite is the local source of truth.** The main process uses `node:sqlite` with WAL, foreign keys, transactions, and a one-time legacy JSON import. Browser preview storage is explicitly development-only.
- **Typed intents, not renderer snapshots.** The renderer requests a strict command such as `session.complete` or `project.update`; main-process code validates it, derives IDs/times/ownership from durable state, enforces transitions, and writes canonical state. No generic renderer-supplied application snapshot is accepted for normal mutations.
- **Timer data is timestamp-derived.** The clock is not an incrementing counter: started/ended timestamps and pause intervals calculate active duration, supporting restart recovery.
- **Original-currency accounting.** Money uses integer minor units plus currency code. A verified cached rate may be shown as a labelled reference conversion, but original historical values are immutable and remain authoritative. Original-currency hourly rates use only matching-currency active time.
- **Timezone facts are explicit.** Stored IANA timezones determine calendar allocation; recovery datetime inputs are formatted in the zone shown to the user rather than using a sliced UTC string.
- **No token in renderer state; encrypted offline identity.** Supabase session tokens and a sanitized last-verified identity are encrypted through Electron `safeStorage` in the main process. Remote Auth hydration/verification has a 1.5-second deadline per request: a non-definitive offline failure falls back to that identity for local work, while a definitive credential failure clears it. Preload exposes only sanitized identity and explicit actions.
- **Provider-derived account ownership with guarded claim.** A device-local account can be linked only by the authenticated subject obtained in main process. A linked account's ordinary commands and overlay actions accept only the matching provider or cached-offline subject, so a renderer cannot forge ownership fields or silently merge users. Before a claim, an online cloud snapshot must prove the cloud workspace is empty; if it already exists, TimeFarm refuses to attach local data. Cached-offline identity does not authorize cloud work.
- **Bootstrap first; pull before push.** Before onboarding an online-authenticated device with no local account, TimeFarm reads a self-scoped cloud snapshot and atomically imports it without an outbox echo. Local changes and their outbox records are otherwise stored together. Pending operations are coalesced per entity and use a local operation UUID/idempotency key with retry state and exponential backoff. Only an explicitly claimed local account is sync-eligible; established accounts pull pages from their durable cursor before pushing ready work. Pull, push, and bootstrap RPCs have a 10-second local deadline, and a late response is inert.
- **Conservative conflicts with explicit choices.** If a remote change would overwrite divergent pending local data, an active local timer, or protected history, the local version remains intact and a durable conflict is shown. The UI can keep local data queued for retry, or apply the exact recorded cloud payload only after the same local safety checks while atomically cancelling the losing local operation. This is not field-level merge or duplicate-overlap resolution.
- **Lease is a cloud guard, not offline consensus.** One stable device UUID per installation is used to request a short Supabase lease. A confirmed lease is renewed; another holder blocks local start/resume. Acquire/renew RPCs time out after five seconds, and late responses cannot restore a failed local claim. Serialized start/resume mutations run read-only schema/timer preflight before their lease request, so invalid/stale actions cannot reserve one. No configuration, authentication, or network response is ever treated as a successful lease, and local offline timing remains possible.
- **Supabase is a configuration boundary.** The repository includes two unapplied migrations with RLS and ownership-checking RPCs, but no cloud environment or secret is committed. They check payload/entity consistency, protect historical work/project data, validate completed-session pause ordering/bounds/duration server-side, canonicalize profile/preferences payloads, provide a self-scoped bootstrap snapshot, and revoke default public RPC execution. Only `TIMEFARM_SUPABASE_URL` and `TIMEFARM_SUPABASE_ANON_KEY` (with legacy `WORKLY_*` aliases) belong in the desktop process; service-role credentials are forbidden.
- **Hardened Electron renderer boundary.** Main and overlay windows use context isolation, Chromium sandboxing, web security, disabled Node integration and `webview` tags, trusted IPC senders, strict app/overlay navigation rules, denied new windows, and an allowlist for external Supabase URLs. This narrows the desktop attack surface without treating local tests as a substitute for packaged-app review.
- **Accessible dialog baseline.** Shared modals use dialog semantics, focus containment/restoration, keyboard/backdrop controls where allowed, and reduced-motion CSS. Visual and assistive-technology validation remains a release gate.
- **Native mini timer is a separate window.** The overlay is a transparent, context-isolated Electron `BrowserWindow`, not a renderer-layer mock. View-only mode is click-through; Stop hands off to the normal main-window completion form; start/resume share the typed command and lease path.
- **Installer target is NSIS x64.** `electron-builder` produces a local unsigned Windows installer. Code signing, auto-updates, and release publication are deferred.

## Explicit non-decisions / open gates

- The implemented bootstrap/pull/cursor/conflict/lease paths do not by themselves prove multi-device synchronization. Applying both migrations, hosted Supabase integration, bootstrap restore/claim refusal, pull pagination, concurrent edits, conflict outcomes, offline overlap, timer-lease expiry/renewal, and RLS/RPC security require real-environment testing.
- The OAuth callback verifies the exact deep-link route, a TimeFarm-generated nonce, and the pending PKCE flow ID before code exchange. Its encrypted continuation expires after ten minutes and is deleted before the exchange, so it can survive one restart without becoming replayable. Full callback threat modeling, telemetry, secret-storage failure behavior, and real-provider integration remain release requirements.
- Conflict resolution supports retaining local data for retry or safely adopting the recorded cloud version, but whether the product needs field-level merge, duplicate-overlap resolution, or user-visible recovery/export flows is still open.
- The FX cache/reference-conversion path needs production provider-contract, reliability, privacy, and real-service validation. Code signing, auto-update channel, production telemetry, clean-machine installer/upgrade verification, and a deployed Supabase project have not been verified from this repository. The native overlay still needs manual Windows/DPI/fullscreen/accessibility validation.
