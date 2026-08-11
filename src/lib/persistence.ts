import { z } from "zod";
import { createEmptyState, type AppState } from "../domain/types";

const storageKey = "workly-desktop-state-v1";

const CurrencySchema = z.enum(["VND", "USD", "EUR", "JPY", "GBP"]);
const SyncStatusSchema = z.enum(["local", "queued", "synced", "error"]);
const TimestampSchema = z.string().datetime({ offset: true });
const IdentifierSchema = z.string().trim().min(1).max(160);
const MoneySchema = z
  .object({
    amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currency: CurrencySchema,
  })
  .strict();
const AccountSchema = z
  .object({
    id: IdentifierSchema,
    authUserId: IdentifierSchema.optional(),
    displayName: z.string().trim().min(1).max(100),
    country: z.string().regex(/^[A-Z]{2,3}$/),
    language: z.enum(["vi", "en"]),
    currency: CurrencySchema,
    timezone: z.string().trim().min(1).max(120),
    createdAt: TimestampSchema,
  })
  .strict();
const ProjectSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string().trim().min(1).max(160),
    paymentModel: z.enum(["per_session", "on_completion", "progressive"]),
    expectedMoney: MoneySchema.optional(),
    note: z.string().max(5_000).optional(),
    color: z.string().trim().min(1).max(64),
    icon: z.string().trim().min(1).max(32),
    status: z.enum(["active", "paused", "completed"]),
    completedAt: TimestampSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    syncStatus: SyncStatusSchema,
  })
  .strict()
  .superRefine((project, context) => {
    if (project.status === "completed" && !project.completedAt)
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "A completed project requires completedAt.",
      });
  });
const PauseSchema = z
  .object({ startedAt: TimestampSchema, endedAt: TimestampSchema.optional() })
  .strict();
const SessionSchema = z
  .object({
    id: IdentifierSchema,
    projectId: IdentifierSchema.optional(),
    startedAt: TimestampSchema,
    endedAt: TimestampSchema.optional(),
    timezone: z.string().trim().min(1).max(120),
    pauses: z.array(PauseSchema),
    activeDurationMs: z.number().int().nonnegative().optional(),
    status: z.enum(["running", "paused", "completed"]),
    earnings: MoneySchema.optional(),
    note: z.string().max(5_000).optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    syncStatus: SyncStatusSchema,
  })
  .strict()
  .superRefine((session, context) => {
    const complete = session.status === "completed";
    const hasCompletionFields = Boolean(
      session.endedAt &&
        session.activeDurationMs !== undefined &&
        session.earnings,
    );
    const hasAnyCompletionField = Boolean(
      session.endedAt ||
        session.activeDurationMs !== undefined ||
        session.earnings,
    );
    if (
      (complete && !hasCompletionFields) ||
      (!complete && hasAnyCompletionField)
    )
      context.addIssue({
        code: "custom",
        message: "Session completion fields do not match its status.",
      });
  });
const PaymentSchema = z
  .object({
    id: IdentifierSchema,
    projectId: IdentifierSchema,
    money: MoneySchema,
    receivedAt: TimestampSchema,
    kind: z.enum(["completion", "progressive"]),
    note: z.string().max(5_000).optional(),
    createdAt: TimestampSchema,
    syncStatus: SyncStatusSchema,
  })
  .strict();
const GoalSchema = z
  .object({
    id: IdentifierSchema,
    kind: z.enum([
      "hours_daily",
      "hours_weekly",
      "earnings_daily",
      "earnings_weekly",
      "earnings_monthly",
      "projects_completed",
    ]),
    target: z.number().finite().positive(),
    createdAt: TimestampSchema,
    syncStatus: SyncStatusSchema.optional(),
  })
  .strict();
const WidgetSchema = z.enum([
  "timer",
  "goals",
  "earningsTrend",
  "hoursTrend",
  "projectBreakdown",
  "rateTrend",
  "cumulativeEarnings",
  "comparison",
]);
const PreferencesSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]),
    miniTimerMode: z.enum(["interactive", "view_only", "hidden"]),
    dashboardHiddenWidgets: z.array(WidgetSchema).default([]),
    dashboardWidgetOrder: z.array(WidgetSchema).default([]),
    dashboardWidgetSizes: z
      .partialRecord(WidgetSchema, z.enum(["small", "medium", "large"]))
      .default({}),
  })
  .strict();
const AppStateSchema = z
  .object({
    version: z.literal(1),
    account: AccountSchema.nullable(),
    projects: z.array(ProjectSchema),
    sessions: z.array(SessionSchema),
    payments: z.array(PaymentSchema),
    goals: z.array(GoalSchema),
    preferences: PreferencesSchema,
  })
  .strict();

export function parsePersistedState(value: unknown): AppState {
  const parsed = AppStateSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("The local TimeFarm database returned invalid state data.");
  return parsed.data;
}

export function normalizePersistedState(value: unknown): AppState {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  if (!raw || raw.version !== 1) return createEmptyState();
  const empty = createEmptyState();
  return (
    AppStateSchema.safeParse({
      ...raw,
      preferences: {
        ...empty.preferences,
        ...(raw.preferences && typeof raw.preferences === "object"
          ? raw.preferences
          : {}),
      },
    }).data ?? empty
  );
}

export async function loadPersistedState(): Promise<AppState> {
  if (window.worklyDesktop) {
    // A desktop read failure or invalid IPC payload is not an empty account.
    // Keep it visible as a recoverable load error rather than fabricating a
    // writable blank state over the durable SQLite database.
    return parsePersistedState(await window.worklyDesktop.loadState());
  }
  try {
    return normalizePersistedState(
      JSON.parse(window.localStorage.getItem(storageKey) ?? "null"),
    );
  } catch {
    return createEmptyState();
  }
}

export async function persistState(state: AppState): Promise<void> {
  if (window.worklyDesktop) return;
  window.localStorage.setItem(storageKey, JSON.stringify(state));
}
