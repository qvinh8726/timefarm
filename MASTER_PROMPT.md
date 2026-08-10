# MASTER PROMPT — Build the Personal Work & Earnings Analytics App

You are the lead product engineer, software architect, UX designer, QA engineer, and technical project manager for a new application.

Your task is to design and implement a desktop-first personal work-time and earnings analytics product based strictly on the product requirements below.

IMPORTANT:
- Do not blindly choose a technology stack before evaluating the requirements.
- You may choose the programming language, framework, database, authentication provider, cloud architecture, charting library, desktop framework, and deployment strategy.
- Before implementation, propose the recommended stack and explain the trade-offs briefly.
- Prefer mature, maintainable, well-documented technologies.
- Optimize for a Windows desktop-first application with future web, Android, and iOS clients.
- The architecture must support cloud synchronization from the beginning.
- Do not over-engineer the first release.
- Do not invent product requirements.
- If a technical decision is ambiguous, choose the safest maintainable default and document it.
- Preserve the product requirements even if your chosen architecture differs from what might normally be expected.

## PRODUCT
This is NOT a fixed employee attendance application.

It is a personal work-session tracker for people whose jobs/projects do not have a fixed schedule or fixed hourly wage.

The user starts a session, works for an arbitrary amount of time, pauses/resumes as needed, and ends the session. At the end, the user records the actual amount of money earned during that period.

The product calculates useful derived information such as effective earnings/hour without requiring the user to have an hourly wage.

Example:
- User works 2h 30m.
- User earns $75 during that work period.
- App records $75 as the actual earning.
- App can calculate an effective earning rate of $30/hour.
- This rate is an analysis metric, not the project's payment rule.

## CORE USER LOOP
1. Authenticate.
2. Open Dashboard.
3. Start a session.
4. Choose a project or no project.
5. Work.
6. Pause/resume if necessary.
7. End the session.
8. Enter actual money earned during that period.
9. Optionally add a note.
10. Save.
11. Sync to cloud.
12. Update dashboard/analytics/goals.

## USERS
Phase 1: one personal user.
Future: public multi-user product.

Therefore:
- Build account ownership from day one.
- Every user's data must be isolated.
- One account may be logged in on multiple devices.

Authentication:
- Email/password.
- Google OAuth.
- Google should be visually encouraged.
- Do not require email verification initially.

## FIRST-RUN ACCOUNT SETTINGS
Collect:
- Country.
- Language.
- Currency.

Language can be changed later.
Country and currency are account-level identity settings and are not intended to be changed casually. If a user needs a different country/currency context, a separate account is the intended model.

Initial languages:
- Vietnamese.
- English.

Design localization so more languages can be added through translation resources without changing business logic.

Timezone:
- Support multiple time zones.
- Default from device.
- Store timestamps safely and render them using the relevant timezone.

## PROJECTS
A session can belong to a project but does not have to.

Project required field:
- Name.

Project optional fields:
- Expected money.
- Note.

Required project metadata:
- Payment model.
- Color.
- Icon.
- Status.

Statuses:
- Active.
- Paused.
- Completed.

No project cover images.

Completed projects cannot receive new sessions unless reopened.

## PAYMENT MODELS
Support:
1. Payment per session/work period.
2. Payment after project completion.
3. Progressive/multiple payments.

Do not collapse payment history into a single project amount.

Use a payment model that can represent multiple payments for one project.

Actual session earnings and project payments are separate concepts.

## TIMER RULES
Only one active session may exist per account at any time.

If Project A is running and the user wants to work on Project B:
- They must resolve Project A first.
- Never allow two active timers simultaneously.

Timer:
- Start.
- Pause.
- Resume.
- Stop.

Paused time is excluded from active work duration.

The timer must continue to work correctly offline.

## INTERRUPTED SESSION RECOVERY
If Windows shuts down, the app crashes, or the process is unexpectedly interrupted:
- Detect the incomplete session.
- On next launch, show a recovery UI.
- Let the user:
  1. Continue the session.
  2. End it with an appropriate time.
  3. Discard/cancel it where appropriate.

Only the latest session or interrupted session can be edited/recovered.
Older completed sessions are locked.

Do not silently rewrite historical sessions.

## END SESSION
When ending:
Show:
- Start time.
- End time.
- Active duration.
- Money earned.
- Currency.
- Optional note.
- Relevant project/payment information.

Allow 0 earnings.

After saving:
- Update local data.
- Queue synchronization if needed.
- Update analytics.
- Update goals.
- Update insights.

## CURRENCY
Support multiple currencies.

Always store:
- Numeric amount.
- ISO currency code.

Do not hard-code VND or USD into business logic.

Provide real-time FX conversion through a reliable external API/provider.
Do not use an AI model as the authoritative FX rate source.

FX provider must be replaceable.

Show last updated time for rates.
Handle provider failure gracefully.
Never fabricate an exchange rate.

Historical original amounts must remain intact.

## DASHBOARD
Dashboard is the first screen after login.

Top overview bar:
- Work time today.
- Earnings today.
- Current project/session.
- Timer state.

Below:
- Predefined analytics widgets.

Users can:
- Hide widgets.
- Reorder widgets.
- Resize supported widgets.
- Keep their last layout.

Users CANNOT:
- Create arbitrary chart definitions.
- Define custom formulas.
- Build their own analytics engine.

Provide a useful default dashboard.

## RESPONSIVE LAYOUT
Desktop:
- 3 columns on large screens.
- Adapt when window is smaller.

Future clients must reuse the same conceptual dashboard/widget model.

## MINI TIMER
Optional global timer display.

Modes:
1. Interactive.
2. View-only.
3. Hidden.

View-only must not accept start/pause/stop input.

Provide a click-through/non-interactive mode so it cannot steal mouse input from other applications.

This is important for users who play games or use fullscreen applications.

## NAVIGATION
Sidebar:
- Dashboard
- Projects
- History
- Analytics
- Profile
- Settings

Do not add a command palette or Ctrl+K system.

## ANALYTICS
Analytics is a core feature.

Provide many predefined, visually useful charts.

Initial ranges:
- 7 days.
- 30 days.
- 1 month.
- 3 months.
- 6 months.
- 1 year.

Initial chart/widget set:
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

Core metrics:
- Total active hours.
- Total earnings.
- Average hours/day.
- Average earnings/day.
- Effective earnings/hour.
- Session count.
- Completed projects.
- Earnings by project.
- Hours by project.
- Project efficiency.
- Daily trends.
- Period-over-period comparisons.

Charts must be clear and decision-useful, not decorative.

## INSIGHTS
Generate data-driven insights.

Examples:
- Earnings/hour improved.
- A project consumed most time.
- Earnings increased compared with previous period.

Never invent data.
Never claim causation from simple correlation.
If data is insufficient, state that.

## GOALS
Goals are a core feature.

Support:
- Hours/day.
- Hours/week.
- Earnings/day.
- Earnings/week.
- Earnings/month.
- Projects completed.

Show:
- Target.
- Current.
- Percentage.
- Remaining.
- Expected pace.
- Ahead/behind status.

Projected completion may be calculated from actual current pace, clearly labeled as an estimate.

## HISTORY
History should show:
- Date.
- Project.
- Start.
- End.
- Active duration.
- Earnings.
- Currency.
- Note.
- Session status.

Editing:
- Latest completed session may be edited.
- Interrupted session may be recovered.
- Older sessions are locked.

## CLOUD SYNC
Cloud is the authoritative synchronized source.

Desktop must remain functional offline.

Completed sessions sync when network is available.

Requirements:
- Reliable retry.
- Idempotent operations.
- No duplicate sessions.
- Safe authentication.
- Clear sync status.
- Preserve local work if the server is unavailable.

Do not make the timer depend on an always-on network connection.

## UI
Support:
- Light theme.
- Dark theme.
- System theme.

Keep UI clean, modern, information-dense but readable.

Project colors/icons should appear consistently across dashboard, history, and analytics.

No project cover images.

## TECHNICAL DECISION PROCESS
Before writing the full application:
1. Analyze the requirements.
2. Recommend the stack.
3. Explain desktop framework choice.
4. Explain backend choice.
5. Explain database choice.
6. Explain authentication strategy.
7. Explain cloud hosting strategy.
8. Explain synchronization architecture.
9. Explain charting solution.
10. Explain testing strategy.
11. Explain folder/project structure.

Do not select technologies just because they are popular.
Prefer the simplest stack that can satisfy:
- Windows desktop.
- Offline-first timer.
- Cloud sync.
- Multi-device login.
- Future web/mobile clients.
- Secure user data.
- Rich analytics.

## DATA MODEL
Design entities around:
- User.
- Account settings.
- Project.
- Work session.
- Session pause intervals if required.
- Payment.
- Goal.
- Dashboard widget/layout preference.
- FX rate/cache if needed.
- Sync metadata.

Separate:
- Actual monetary facts.
- Derived analytics.
- Display currency conversion.

Avoid storing redundant calculated metrics unless there is a clear performance reason.

## SECURITY
Implement:
- Secure password hashing.
- Secure token/session management.
- OAuth best practices.
- User-level authorization.
- Server-side ownership checks.
- No secrets in source code.
- Environment-based configuration.
- Safe logging.

Never trust client-provided user IDs for authorization.

## QUALITY
Write tests for:
- Timer duration calculation.
- Pause/resume.
- One-active-session rule.
- Crash recovery.
- Earnings calculation.
- Currency conversion.
- Project status rules.
- Goal calculations.
- Analytics aggregation.
- Authentication/authorization.
- Sync idempotency.
- Duplicate prevention.

Include edge cases:
- Midnight crossing.
- Timezone changes.
- Daylight-saving time where applicable.
- Device clock irregularities.
- Offline operation.
- App crash.
- Windows shutdown.
- Zero earnings.
- Very long sessions.
- Completed project.
- Empty project list.
- No analytics data.
- Multiple currencies.

## IMPLEMENTATION STYLE
Build incrementally.

Recommended sequence:
Phase 0 — Architecture and design.
Phase 1 — Authentication and account onboarding.
Phase 2 — Local database and timer engine.
Phase 3 — Projects and session completion.
Phase 4 — Cloud sync.
Phase 5 — Dashboard.
Phase 6 — Analytics.
Phase 7 — Goals and insights.
Phase 8 — Overlay/mini timer.
Phase 9 — Hardening, testing, packaging.

For each phase:
- Define acceptance criteria.
- Implement.
- Test.
- Explain important decisions.
- Do not silently change product requirements.

## IMPORTANT PRODUCT PRINCIPLE
The product should answer one question exceptionally well:

"Given the time I actually spent working and the money I actually earned, how valuable/productive was my work during this period?"

Do not turn the first release into a generic project-management application.

Keep the core loop fast, trustworthy, and visually useful.
