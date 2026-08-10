# PRD — Personal Work Time & Earnings Analytics App
Version: 1.0
Date: 2026-08-09

## 1. Product vision
A desktop-first application for people whose work has no fixed hourly schedule. The user starts a work session, pauses/resumes it when needed, and ends it when the work period is over. At the end of the session, the user records how much money was earned during that period. The product converts actual work time + actual earnings into useful financial and productivity analytics.

The product is NOT a traditional fixed-hour employee attendance system and does NOT assume an hourly wage.

Core question the product answers:
- How much time did I spend working?
- How much money did I earn?
- What is my effective earnings per hour?
- Which projects consume the most time?
- How productive/valuable was each day, week, month, and year?
- How am I trending compared with previous periods?
- Am I on track toward my goals?

## 2. Target users
Phase 1: a single personal user.
Future: public product for many individual users.

The product must be designed for multi-user accounts from the beginning to avoid rebuilding authentication/data ownership later.

## 3. Platforms
Phase 1:
- Windows desktop application is the primary product.
- Cloud account/data synchronization is included from the beginning.

Future:
- Web application.
- Android application.
- iOS application.

All future clients should use the same account and cloud data model.

## 4. Authentication
Required:
- Email + password registration/login.
- Google login.
- Google login should be visually encouraged/promoted, but must not be mandatory.
- Email verification is not mandatory for initial use.
- One account may be signed in on multiple devices.

Cross-device behavior:
- Other devices may view synchronized data.
- A different device must NOT remotely start, pause, or stop the active timer.
- The device running the active session owns timer controls.
- A completed session is synchronized to the cloud.

## 5. First-run onboarding
On first account setup, collect:
1. Country.
2. Language.
3. Currency.

These are account-level settings.

Rules:
- Language can be changed later.
- Country and account currency are treated as fixed account identity settings.
- If a person needs a different country/currency context, the intended model is a separate account rather than rewriting historical account data.
- The app should still store currency codes explicitly and never hard-code currency formatting.

Localization:
- Multilingual from the beginning.
- Initial languages: Vietnamese and English.
- Architecture must allow additional languages without changing business logic.

Timezone:
- Support multiple time zones.
- Default timezone is taken from the device.
- Account/session timestamps must preserve timezone context correctly.

## 6. Projects
A work session may optionally belong to a project.

Project creation fields:
- Name: required.
- Payment model: required.
- Expected money: optional.
- Note: optional.
- Color: required/defaulted.
- Icon: required/defaulted.
- Status.

Project statuses:
- Active / In progress.
- Paused / Suspended.
- Completed.

Completed projects cannot receive new sessions unless explicitly reopened.

No project cover images.

## 7. Payment models
The system must support different ways a person gets paid.

Required conceptual models:
1. Paid per session / work period.
2. Paid when the project is completed.
3. Paid progressively / in multiple payments as work is delivered.

The payment model must not be confused with the timer itself.

A project can accumulate many sessions.
A project can have payment records independent of individual sessions.

The system must preserve actual monetary records rather than deriving everything from a single hourly rate.

## 8. Work sessions / timer
Only ONE active timer/session per account at a time.

Starting Project B while Project A is running is not allowed. The user must end/pause/resolve Project A before starting another session.

Start flow:
- Click Start.
- Choose a project, or choose "No project".
- Allow quick creation of a project.
- Timer starts immediately after confirmation.

Timer actions:
- Start.
- Pause.
- Resume.
- Stop/end.

Pause time must NOT count as active work time.

## 9. Interrupted sessions
If Windows shuts down, the application closes unexpectedly, crashes, or the process is interrupted:
- The system must detect an interrupted/incomplete session.
- On next launch, show a recovery dialog.
- User can:
  - Continue the interrupted session.
  - End it using an appropriate end time.
  - Cancel/discard the interrupted session where appropriate.

Only the latest session or an interrupted session may be edited/recovered.

Older completed sessions become effectively locked to protect historical analytics integrity.

## 10. Session completion
When the user ends a session, show a completion dialog containing:
- Confirmed start/end/active duration.
- Money earned during that period.
- Optional note.
- Relevant project/payment context.

The user may enter 0 money for a period where no money was earned.

After saving:
- Session becomes part of historical analytics.
- Session is synchronized to cloud when network is available.
- Analytics update automatically.

## 11. Money and currency
The app must support multiple currencies.

Important principle:
- Store the original amount and currency code.
- Do not overwrite historical monetary facts merely because exchange rates change.

Real-time currency conversion:
- Use a reliable external FX API/provider.
- Provider must be replaceable.
- Prefer a free/low-cost provider for the initial implementation.
- Show when the FX rate was last updated.
- Do not use an AI model as the authoritative FX source.
- If live FX is unavailable, clearly communicate stale/unavailable rates instead of inventing values.

Analytics may display:
- Original currency values.
- Converted values where appropriate.
- Effective earnings/hour based on the selected display currency when conversion is requested.

## 12. Dashboard
Dashboard is the first screen after login.

Top overview bar should remain visible and summarize:
- Work time today.
- Earnings today.
- Active project/session status.
- Timer status.

Below it is a customizable widget dashboard.

Dashboard behavior:
- Initial default layout is provided.
- The user's last layout is remembered per account.
- Widgets can be shown/hidden.
- Widgets can be dragged/reordered.
- Widgets can be resized where supported.
- Users cannot create arbitrary custom chart definitions.
- Users only configure the provided widget set.

Desktop layout:
- 3-column dashboard on large screens.
- Responsive behavior may reduce columns on smaller windows.

## 13. Mini timer / overlay
The active timer should be optionally visible across the application.

Modes:
1. Interactive — start/pause/stop controls.
2. View-only — information only, no controls.
3. Hidden.

Important gaming/productivity requirement:
- Provide a click-through / non-interactive mode so the overlay never intercepts mouse input.
- In view-only mode, the user cannot accidentally start/stop/pause the timer.
- Overlay should be optional to avoid obstructing screen content.
- Position and visibility preferences should be configurable.

## 14. Analytics
Analytics is a major product feature.

The app should provide many predefined, highly visual analytics widgets rather than requiring users to build charts themselves.

Users can hide unwanted charts and rearrange widgets, but cannot create arbitrary chart formulas.

Initial analytics time ranges:
- Last 7 days.
- Last 30 days.
- 1 month.
- 3 months.
- 6 months.
- 1 year.
- Custom/period comparisons may be considered where useful.

Key metrics:
- Total active work time.
- Total earnings.
- Average work time per day.
- Average earnings per day.
- Effective earnings per active hour.
- Number of sessions.
- Number of completed projects.
- Earnings by project.
- Work time by project.
- Project efficiency.
- Daily earnings.
- Daily active work time.
- Trend over time.
- Comparison against previous equivalent period.
- Goal progress.
- Productivity/earnings trend.

Potential predefined chart set (initial 12):
1. Earnings by day.
2. Active work hours by day.
3. Effective earnings/hour by day.
4. Cumulative earnings.
5. Cumulative work hours.
6. Earnings by project.
7. Work hours by project.
8. Earnings vs previous period.
9. Work hours vs previous period.
10. Session duration distribution.
11. Project efficiency ranking.
12. Goal progress.

Charts must prioritize clarity over visual novelty.

## 15. Insights
The system may generate data-driven insights such as:
- "Your average effective earnings/hour increased compared with the previous 30 days."
- "Project A consumed the most work time this period."
- "You earned more on days with fewer but longer sessions."

Rules:
- Insights must be based on actual stored data.
- Never fabricate a trend.
- If there is insufficient data, say so.
- Avoid pretending that a correlation proves causation.

## 16. Goals
Goals are a core feature.

Supported goal concepts:
- Work hours/day.
- Work hours/week.
- Earnings/day.
- Earnings/week.
- Earnings/month.
- Projects completed.
- Other clearly defined measurable targets.

Dashboard should show:
- Current progress.
- Target.
- Remaining amount.
- Percentage complete.
- Whether current pace is ahead/behind the expected pace.

The system may estimate projected progress based on current pace, clearly labeling it as an estimate.

## 17. Navigation
Sidebar:
1. Dashboard
2. Projects
3. History
4. Analytics
5. Profile
6. Settings

Keep navigation simple.

Do NOT implement a command palette such as Ctrl+K.

## 18. Theme
Support:
- Light mode.
- Dark mode.
- System/default mode may be used as the initial preference.

## 19. History
History should show sessions chronologically and allow useful filtering.

Each session should expose at least:
- Date.
- Project.
- Start time.
- End time.
- Active duration.
- Earned amount.
- Currency.
- Status/context.
- Note where present.

Editing restrictions:
- Only the most recent session and interrupted/recovery session may be edited/recovered.
- Older historical sessions are locked.

## 20. Cloud synchronization
Cloud is the authoritative synchronized data source.

Principles:
- Desktop should remain usable offline.
- Completed sessions should sync when network is available.
- Local state must survive temporary network loss.
- Sync should be idempotent.
- Avoid duplicate session creation.
- Preserve immutable historical facts after synchronization where possible.
- The architecture must support future web/mobile clients.

## 21. Non-functional requirements
Security:
- User data must be isolated by account.
- Passwords must never be stored in plaintext.
- Authentication tokens must be handled securely.
- Sensitive data must not be logged.

Reliability:
- A crash must not silently destroy a running session.
- Session recovery must be deterministic.
- Cloud sync failures must be visible and retryable.

Performance:
- Dashboard should feel immediate for normal personal datasets.
- Charts should not block the main UI.
- Local timer must remain accurate even if network connectivity disappears.

Privacy:
- Do not collect unnecessary telemetry.
- Clearly separate product analytics from user work/earnings data.

## 22. Future scope
Not required for v1:
- Web client.
- Android/iOS clients.
- Team workspaces.
- Collaboration.
- Export to CSV/PDF/images.
- Advanced recurring reports.
- Public API.
- Integrations with accounting systems.
- AI assistant beyond trustworthy data-driven insights.

The architecture should not prevent these.

## 23. Product principle
Build the simplest reliable version of the core loop:

Start session → Work → Pause/Resume if needed → End session → Enter actual earnings → Sync → Analyze.

Everything else should strengthen that loop rather than distract from it.
