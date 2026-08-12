const { z } = require("zod");
const { goalTargetIssue } = require("./goal-validation.cjs");

// Commands cross the renderer/main-process boundary.  They deliberately model
// user intent rather than a mutable AppState snapshot.  This makes it possible
// for the main process to derive ownership from its durable account and to keep
// invariants in one place.

const CURRENCIES = ["VND", "USD", "EUR", "JPY", "GBP"];
const PAYMENT_MODELS = ["per_session", "on_completion", "progressive"];
const PROJECT_STATUSES = ["active", "paused", "completed"];
const PAYMENT_KINDS = ["completion", "progressive"];
const GOAL_KINDS = [
  "hours_daily",
  "hours_weekly",
  "earnings_daily",
  "earnings_weekly",
  "earnings_monthly",
  "projects_completed",
];
const DASHBOARD_WIDGETS = [
  "timer",
  "goals",
  "earningsTrend",
  "hoursTrend",
  "projectBreakdown",
  "rateTrend",
  "cumulativeEarnings",
  "comparison",
];
const DASHBOARD_WIDGET_SIZES = ["small", "medium", "large"];

function isValidTimeZone(value) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  // eslint-disable-next-line no-control-regex -- IPC identifiers must reject ASCII controls.
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Identifier must not contain control characters.",
  });

const IsoTimestampSchema = z
  .string()
  .trim()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const TimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isValidTimeZone, {
    message: "Timezone must be a valid IANA timezone.",
  });
const CurrencySchema = z.enum(CURRENCIES);
const MoneySchema = z
  .object({
    amountMinor: z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER),
    currency: CurrencySchema,
  })
  .strict();
function boundedText(maximum, { required = true } = {}) {
  let schema = z.string().trim();
  if (required) schema = schema.min(1);
  return schema.refine((value) => Array.from(value).length <= maximum, {
    message: `Text cannot exceed ${maximum} Unicode characters.`,
  });
}
const OptionalTextSchema = boundedText(5000, { required: false });
const ProjectNameSchema = boundedText(160);
const ColorSchema = boundedText(64);
const IconSchema = boundedText(32);
const DisplayNameSchema = boundedText(100);
const CountrySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2,3}$/)
  .transform((value) => value.toUpperCase());
const AuthUserIdSchema = IdentifierSchema;

const WidgetListSchema = z
  .array(z.enum(DASHBOARD_WIDGETS))
  .max(DASHBOARD_WIDGETS.length)
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Widgets must not contain duplicates.",
      });
  });
// `partialRecord` is intentional: a saved layout only needs to carry sizes
// for widgets whose default size was overridden.
const WidgetSizeSchema = z.partialRecord(
  z.enum(DASHBOARD_WIDGETS),
  z.enum(DASHBOARD_WIDGET_SIZES),
);

const ProjectCreatePayloadSchema = z
  .object({
    name: ProjectNameSchema,
    paymentModel: z.enum(PAYMENT_MODELS),
    expectedMoney: MoneySchema.optional(),
    note: OptionalTextSchema.optional(),
    color: ColorSchema,
    icon: IconSchema,
  })
  .strict();

const ProjectUpdatePayloadSchema = z
  .object({
    projectId: IdentifierSchema,
    name: ProjectNameSchema.optional(),
    paymentModel: z.enum(PAYMENT_MODELS).optional(),
    expectedMoney: MoneySchema.nullable().optional(),
    note: OptionalTextSchema.nullable().optional(),
    color: ColorSchema.optional(),
    icon: IconSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value).length === 1)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one project field must be supplied.",
      });
  });

const PreferencesPatchSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]).optional(),
    miniTimerMode: z.enum(["interactive", "view_only", "hidden"]).optional(),
    dashboardHiddenWidgets: WidgetListSchema.optional(),
    dashboardWidgetOrder: WidgetListSchema.optional(),
    dashboardWidgetSizes: WidgetSizeSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one preference field must be supplied.",
      });
  });

const command = (type, payload) =>
  z.object({ type: z.literal(type), payload }).strict();

const CommandSchema = z.discriminatedUnion("type", [
  command(
    "account.initialize",
    z
      .object({
        displayName: DisplayNameSchema,
        country: CountrySchema,
        language: z.enum(["vi", "en"]),
        currency: CurrencySchema,
        timezone: TimeZoneSchema.optional(),
      })
      .strict(),
  ),
  command(
    "account.update-profile",
    z
      .object({
        displayName: DisplayNameSchema.optional(),
        language: z.enum(["vi", "en"]).optional(),
        timezone: TimeZoneSchema.optional(),
      })
      .strict()
      .superRefine((value, context) => {
        if (Object.keys(value).length === 0)
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "At least one profile field must be supplied.",
          });
      }),
  ),
  command("project.create", ProjectCreatePayloadSchema),
  command("project.create-and-start-session", ProjectCreatePayloadSchema),
  command("project.update", ProjectUpdatePayloadSchema),
  command(
    "project.set-status",
    z
      .object({ projectId: IdentifierSchema, status: z.enum(PROJECT_STATUSES) })
      .strict(),
  ),
  command("project.delete", z.object({ projectId: IdentifierSchema }).strict()),
  command(
    "session.start",
    z.object({ projectId: IdentifierSchema.optional() }).strict(),
  ),
  command("session.pause", z.object({}).strict()),
  command("session.resume", z.object({}).strict()),
  command(
    "session.complete",
    z
      .object({
        sessionId: IdentifierSchema,
        money: MoneySchema,
        note: OptionalTextSchema.nullable().optional(),
      })
      .strict(),
  ),
  // Recovery is the only renderer-originated path that may provide a factual
  // terminal timestamp. Normal timer completion always uses the main clock.
  command(
    "session.recover-complete",
    z
      .object({
        sessionId: IdentifierSchema,
        money: MoneySchema,
        note: OptionalTextSchema.nullable().optional(),
        endedAt: IsoTimestampSchema,
      })
      .strict(),
  ),
  command(
    "session.discard",
    z.object({ sessionId: IdentifierSchema }).strict(),
  ),
  command(
    "session.edit-latest",
    z
      .object({
        sessionId: IdentifierSchema,
        money: MoneySchema,
        note: OptionalTextSchema.nullable().optional(),
      })
      .strict(),
  ),
  command(
    "payment.create",
    z
      .object({
        projectId: IdentifierSchema,
        money: MoneySchema,
        kind: z.enum(PAYMENT_KINDS),
        note: OptionalTextSchema.nullable().optional(),
        receivedAt: IsoTimestampSchema.optional(),
      })
      .strict(),
  ),
  command(
    "payment.update",
    z
      .object({
        paymentId: IdentifierSchema,
        projectId: IdentifierSchema.optional(),
        money: MoneySchema.optional(),
        kind: z.enum(PAYMENT_KINDS).optional(),
        note: OptionalTextSchema.nullable().optional(),
        receivedAt: IsoTimestampSchema.optional(),
      })
      .strict()
      .superRefine((value, context) => {
        if (Object.keys(value).length === 1)
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "At least one payment field must be supplied.",
          });
      }),
  ),
  command("payment.delete", z.object({ paymentId: IdentifierSchema }).strict()),
  command(
    "goal.create",
    z
      .object({
        kind: z.enum(GOAL_KINDS),
        target: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .strict()
      .superRefine((value, context) => {
        const issue = goalTargetIssue(value.kind, value.target);
        if (issue)
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["target"],
            message: issue,
          });
      }),
  ),
  command(
    "goal.update",
    z
      .object({
        goalId: IdentifierSchema,
        kind: z.enum(GOAL_KINDS).optional(),
        target: z
          .number()
          .finite()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
      })
      .strict()
      .superRefine((value, context) => {
        if (Object.keys(value).length === 1)
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "At least one goal field must be supplied.",
          });
        if (value.kind !== undefined && value.target !== undefined) {
          const issue = goalTargetIssue(value.kind, value.target);
          if (issue)
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["target"],
              message: issue,
            });
        }
      }),
  ),
  command("goal.delete", z.object({ goalId: IdentifierSchema }).strict()),
  command("preferences.update", PreferencesPatchSchema),
]);

module.exports = {
  AuthUserIdSchema,
  CommandSchema,
  CURRENCIES,
  DASHBOARD_WIDGETS,
  GOAL_KINDS,
  IdentifierSchema,
  IsoTimestampSchema,
  MoneySchema,
  TimeZoneSchema,
};
