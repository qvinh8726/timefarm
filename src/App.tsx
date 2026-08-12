import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  FolderOpen,
  FolderKanban,
  Globe2,
  History,
  LayoutDashboard,
  LoaderCircle,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Square,
  Sun,
  Target,
  Trash2,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";
import {
  calculateGoalProgress,
  completedSessionOverlapSummary,
  cumulativeSeries,
  currentDayRange,
  goalUnit,
  liveRangeSummary,
  periodComparison,
  projectBreakdown,
  rangeDailySeries,
  resolveRange,
} from "./domain/analytics";
import { formatMoney, groupedMoney } from "./domain/money";
import {
  activeDurationMs,
  formatClockTime,
  formatDate,
  formatDuration,
} from "./domain/time";
import {
  currencyMetadata,
  goalLabels,
  paymentModelLabels,
  type AppLanguage,
  type CurrencyCode,
  type DashboardWidgetId,
  type DashboardWidgetSize,
  type Goal,
  type Payment,
  type Preferences,
  type Project,
  type ProjectStatus,
  type WorkSession,
} from "./domain/types";
import { translate, type TranslationKey } from "./i18n";
import {
  getActiveSession,
  themeClass,
  useAppStore,
  useAppStoreActions,
  useAppStoreState,
  type ActionResult,
} from "./lib/state";
import { useAuth, type SafeAuthUser } from "./lib/auth";
import { useCurrentTime } from "./lib/clock";
import {
  ChartCard,
  EmptyState,
  GoalPace,
  MetricCard,
  PeriodComparisonCard,
  ProjectBreakdownCard,
  ProjectGlyph,
  TrendChart,
  formatGoalProgressValue,
  formatGoalRemaining,
  goalStatusLabel,
} from "./components/CommonVisuals";
import { Field, Modal } from "./components/Modal";
import { LocalDataResetConfirmation } from "./components/LocalDataResetConfirmation";
import "./load-failure.css";

export { Modal } from "./components/Modal";

type Page =
  | "dashboard"
  | "projects"
  | "history"
  | "analytics"
  | "profile"
  | "settings";
type Dialog =
  | { kind: "start" }
  | { kind: "complete"; session: WorkSession; endedAt?: string }
  | { kind: "project"; project?: Project }
  | { kind: "payment"; project: Project; payment?: Payment }
  | { kind: "goal"; goal?: Goal }
  | { kind: "dashboard-customize" }
  | { kind: "sync-conflicts" }
  | { kind: "edit-session"; session: WorkSession }
  | null;

type CloudBootstrapView = CloudBootstrapResult | { state: "idle" | "checking" };

const ProfilePage = lazy(() =>
  import("./pages/AccountPages").then((module) => ({
    default: module.ProfilePage,
  })),
);
const SettingsPage = lazy(() =>
  import("./pages/AccountPages").then((module) => ({
    default: module.SettingsPage,
  })),
);
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const StartSessionDialog = lazy(() =>
  import("./components/WorkspaceDialogs").then((module) => ({
    default: module.StartSessionDialog,
  })),
);
const CompleteSessionDialog = lazy(() =>
  import("./components/WorkspaceDialogs").then((module) => ({
    default: module.CompleteSessionDialog,
  })),
);
const ProjectDialog = lazy(() =>
  import("./components/WorkspaceDialogs").then((module) => ({
    default: module.ProjectDialog,
  })),
);
const PaymentDialog = lazy(() =>
  import("./components/WorkspaceDialogs").then((module) => ({
    default: module.PaymentDialog,
  })),
);
const GoalDialog = lazy(() =>
  import("./components/WorkspaceDialogs").then((module) => ({
    default: module.GoalDialog,
  })),
);
const EditSessionDialog = lazy(() =>
  import("./components/WorkspaceDialogs").then((module) => ({
    default: module.EditSessionDialog,
  })),
);
const RecoveryDialog = lazy(() =>
  import("./components/WorkspaceDialogs").then((module) => ({
    default: module.RecoveryDialog,
  })),
);

function label(
  language: AppLanguage,
  key: TranslationKey<"workspace">,
): string {
  return translate(language, "workspace", key);
}

function TimeFarmBrand({ large = false }: { large?: boolean }) {
  return (
    <div className={`brand ${large ? "brand-large" : ""}`.trim()}>
      <span className="brand-mark" aria-hidden="true">
        <Clock3 size={large ? 19 : 15} strokeWidth={2} />
      </span>
      <span>TimeFarm</span>
    </div>
  );
}

function formatTimerClock(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function defaultLanguage(): AppLanguage {
  return typeof navigator !== "undefined" &&
    navigator.language.toLowerCase().startsWith("vi")
    ? "vi"
    : "en";
}

function isActiveWorkSession(value: unknown): value is WorkSession {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    ((value as { status?: unknown }).status === "running" ||
      (value as { status?: unknown }).status === "paused")
  );
}

export function App() {
  const { state, isLoading, loadError, reload } = useAppStore();
  const {
    status: auth,
    isLoading: authLoading,
    refresh: refreshAuth,
  } = useAuth();
  const [cloudBootstrap, setCloudBootstrap] = useState<CloudBootstrapView>({
    state: "idle",
  });
  const [cloudBootstrapAttempt, setCloudBootstrapAttempt] = useState(0);
  const [legacyImport, setLegacyImport] = useState<LegacyImportStatus | null>(
    () =>
      window.worklyDesktop?.getLegacyImportStatus
        ? null
        : { status: "not_found" },
  );
  const [shellLanguage, setShellLanguage] = useState(defaultLanguage);
  const legacyRecoveryRequired = Boolean(
    legacyImport &&
      ["invalid_data", "filesystem_error", "unsupported_version"].includes(
        legacyImport.status,
      ),
  );

  useEffect(() => {
    let cancelled = false;
    const getStatus = window.worklyDesktop?.getLegacyImportStatus;
    if (!getStatus) return undefined;
    void getStatus()
      .then((result) => {
        if (!cancelled) setLegacyImport(result);
      })
      .catch(() => {
        if (!cancelled)
          setLegacyImport({
            status: "filesystem_error",
            errorCode: "STATUS_UNAVAILABLE",
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const theme = state?.account ? state.preferences.theme : "light";
  const documentLanguage = state?.account?.language ?? shellLanguage;
  useEffect(() => {
    document.documentElement.lang = documentLanguage;
    document.title =
      documentLanguage === "vi"
        ? "TimeFarm — Tập trung làm việc, rõ ràng thu nhập"
        : "TimeFarm — Focused work, clear earnings";
  }, [documentLanguage]);

  useEffect(() => {
    const applyTheme = () => {
      document.documentElement.className = themeClass(theme);
    };
    applyTheme();
    if (theme !== "system" || !window.matchMedia) return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    const desktop = window.worklyDesktop;
    const needsBootstrap = Boolean(
      desktop?.bootstrapAuthenticatedAccount &&
        legacyImport !== null &&
        !legacyRecoveryRequired &&
        auth.configured &&
        auth.authenticated &&
        !state?.account,
    );
    if (!needsBootstrap) {
      return () => {
        cancelled = true;
      };
    }
    if (auth.offline) {
      const offlineNotice = window.setTimeout(() => {
        if (!cancelled) setCloudBootstrap({ state: "offline" });
      }, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(offlineNotice);
      };
    }
    const bootstrap = window.setTimeout(() => {
      setCloudBootstrap({ state: "checking" });
      void desktop!
        .bootstrapAuthenticatedAccount()
        .then((result) => {
          if (cancelled) return;
          setCloudBootstrap(result);
          if (
            result.state === "restored" ||
            result.state === "already_initialized"
          )
            void reload();
        })
        .catch((error) => {
          if (!cancelled)
            setCloudBootstrap({
              state: "failed",
              error:
                error instanceof Error
                  ? error.message
                  : "Cloud bootstrap failed.",
            });
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(bootstrap);
    };
  }, [
    auth.authenticated,
    auth.configured,
    auth.offline,
    cloudBootstrapAttempt,
    legacyImport,
    legacyRecoveryRequired,
    reload,
    state?.account,
  ]);

  if (loadError)
    return (
      <DataLoadFailure
        language={state?.account?.language ?? "vi"}
        message={loadError}
        onRetry={() => {
          void reload();
        }}
      />
    );
  if (isLoading || authLoading || !state || legacyImport === null) {
    return (
      <div className="splash">
        <LoaderCircle size={28} className="spin" />
        <span>{translate(shellLanguage, "shell", "opening")}</span>
      </div>
    );
  }
  if (legacyRecoveryRequired)
    return (
      <LegacyImportRecoveryScreen
        language={shellLanguage}
        status={legacyImport!}
        onStatusChange={(result) => {
          setLegacyImport(result);
          if (
            result.status === "success" ||
            result.status === "already_initialized"
          )
            void reload();
        }}
      />
    );
  if (auth.statusUnavailable)
    return (
      <AuthStatusUnavailableScreen
        language={shellLanguage}
        message={auth.error}
        onRetry={() => void refreshAuth().catch(() => {})}
      />
    );
  if (auth.configured && !auth.authenticated)
    return <AuthenticationScreen language={shellLanguage} />;
  const needsCloudBootstrap = Boolean(
    window.worklyDesktop?.bootstrapAuthenticatedAccount &&
      auth.configured &&
      auth.authenticated &&
      !state.account,
  );
  if (
    needsCloudBootstrap &&
    (cloudBootstrap.state === "idle" ||
      cloudBootstrap.state === "checking" ||
      cloudBootstrap.state === "restored" ||
      cloudBootstrap.state === "already_initialized")
  ) {
    return (
      <div className="splash">
        <LoaderCircle size={28} className="spin" />
        <span>
          {translate(shellLanguage, "shell", "checkingCloudWorkspace")}
        </span>
      </div>
    );
  }
  if (needsCloudBootstrap && cloudBootstrap.state !== "not_found") {
    return (
      <CloudBootstrapUnavailableScreen
        language={shellLanguage}
        message={"error" in cloudBootstrap ? cloudBootstrap.error : undefined}
        onRetry={() => {
          setCloudBootstrapAttempt((attempt) => attempt + 1);
          void refreshAuth();
        }}
      />
    );
  }
  if (!state.account)
    return (
      <Onboarding
        authUser={auth.user}
        offlineMode={!auth.configured}
        initialLanguage={shellLanguage}
        onLanguageChange={setShellLanguage}
      />
    );
  if (
    auth.authenticated &&
    auth.user &&
    state.account.authUserId &&
    state.account.authUserId !== auth.user.id
  )
    return <AccountMismatchScreen />;
  if (auth.authenticated && auth.user && !state.account.authUserId)
    return <ClaimLocalAccountScreen />;
  return <Workspace />;
}

function AuthStatusUnavailableScreen({
  language,
  message,
  onRetry,
}: {
  language: AppLanguage;
  message?: string;
  onRetry: () => void;
}) {
  return (
    <main className="ownership-shell">
      <section className="ownership-card load-failure-card">
        <TimeFarmBrand />
        <span className="eyebrow">
          {language === "vi" ? "XÁC THỰC" : "AUTHENTICATION"}
        </span>
        <h1>
          {language === "vi"
            ? "Không thể đọc trạng thái đăng nhập"
            : "Sign-in status is unavailable"}
        </h1>
        <p>
          {language === "vi"
            ? "TimeFarm đã dừng trước khi mở workspace để không vô tình bỏ qua đăng nhập hoặc liên kết dữ liệu cloud."
            : "TimeFarm stopped before opening the workspace so it cannot accidentally bypass sign-in or cloud ownership checks."}
        </p>
        {message && (
          <div className="load-error-detail" role="alert">
            {message}
          </div>
        )}
        <button className="button primary full" onClick={onRetry}>
          <RotateCcw size={17} />
          {language === "vi" ? "Thử lại" : "Try again"}
        </button>
      </section>
    </main>
  );
}

function LegacyImportRecoveryScreen({
  language,
  status,
  onStatusChange,
}: {
  language: AppLanguage;
  status: LegacyImportStatus;
  onStatusChange: (status: LegacyImportStatus) => void;
}) {
  const [busy, setBusy] = useState<
    "retry" | "open_data_folder" | "export_recovery" | "skip" | null
  >(null);
  const [message, setMessage] = useState("");
  const run = async (
    action: "retry" | "open_data_folder" | "export_recovery" | "skip",
  ) => {
    if (busy || !window.worklyDesktop?.legacyImportAction) return;
    setBusy(action);
    setMessage("");
    try {
      onStatusChange(await window.worklyDesktop.legacyImportAction(action));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : language === "vi"
            ? "Không thể hoàn tất thao tác khôi phục."
            : "The recovery action could not be completed.",
      );
    } finally {
      setBusy(null);
    }
  };
  const detail =
    status.status === "unsupported_version"
      ? language === "vi"
        ? `Dữ liệu được tạo bởi phiên bản chưa được hỗ trợ${status.version === undefined ? "." : ` (version ${String(status.version)}).`}`
        : `The data was created by an unsupported version${status.version === undefined ? "." : ` (version ${String(status.version)}).`}`
      : status.status === "invalid_data"
        ? language === "vi"
          ? "Tệp dữ liệu cũ không vượt qua kiểm tra tính toàn vẹn."
          : "The older data file did not pass integrity validation."
        : language === "vi"
          ? "TimeFarm không thể đọc hoặc di chuyển tệp dữ liệu cũ."
          : "TimeFarm could not read or move the older data file.";

  return (
    <main className="ownership-shell">
      <section className="ownership-card load-failure-card">
        <TimeFarmBrand />
        <span className="eyebrow">
          {language === "vi" ? "Khôi phục dữ liệu" : "Data recovery"}
        </span>
        <h1>
          {language === "vi"
            ? "Dữ liệu cũ cần được xử lý"
            : "Older data needs attention"}
        </h1>
        <p>
          {language === "vi"
            ? "TimeFarm đã dừng trước khi tạo workspace mới để không làm mất đường khôi phục dữ liệu của bạn."
            : "TimeFarm stopped before creating a new workspace so your recovery path stays intact."}
        </p>
        <div className="load-error-detail" role="alert">
          <AlertTriangle size={17} /> {detail}
        </div>
        {message && (
          <div className="form-error" role="alert" aria-live="assertive">
            {message}
          </div>
        )}
        <div className="ownership-actions">
          <button
            className="button primary full"
            disabled={Boolean(busy)}
            onClick={() => void run("retry")}
          >
            {busy === "retry" ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <RotateCcw size={17} />
            )}{" "}
            {language === "vi" ? "Thử nhập lại" : "Retry import"}
          </button>
          <button
            className="button ghost full"
            disabled={Boolean(busy)}
            onClick={() => void run("export_recovery")}
          >
            <Download size={17} />
            {language === "vi" ? "Xuất bản khôi phục" : "Export recovery copy"}
          </button>
          <button
            className="button ghost full"
            disabled={Boolean(busy)}
            onClick={() => void run("open_data_folder")}
          >
            <FolderOpen size={17} />
            {language === "vi" ? "Mở thư mục dữ liệu" : "Open data folder"}
          </button>
          <button
            className="button danger-quiet full"
            disabled={Boolean(busy)}
            onClick={() => void run("skip")}
          >
            {language === "vi"
              ? "Bỏ qua có xác nhận"
              : "Explicitly skip import"}
          </button>
        </div>
      </section>
    </main>
  );
}

function CloudBootstrapUnavailableScreen({
  language,
  message,
  onRetry,
}: {
  language: AppLanguage;
  message?: string;
  onRetry: () => void;
}) {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const leaveAccount = async () => {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      await signOut();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to sign out.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="ownership-shell">
      <section className="ownership-card load-failure-card">
        <TimeFarmBrand />
        <span className="eyebrow">
          {translate(language, "cloudBootstrap", "eyebrow")}
        </span>
        <h1>{translate(language, "cloudBootstrap", "heading")}</h1>
        <p>{translate(language, "cloudBootstrap", "description")}</p>
        {(actionError || message) && (
          <div className="load-error-detail" role="status">
            {actionError || message}
          </div>
        )}
        <div className="ownership-actions">
          <button
            className="button primary full"
            disabled={busy}
            onClick={onRetry}
          >
            <RotateCcw size={17} />{" "}
            {translate(language, "cloudBootstrap", "retry")}
          </button>
          <button
            className="button ghost full"
            disabled={busy}
            onClick={() => void leaveAccount()}
          >
            {translate(language, "cloudBootstrap", "signOut")}
          </button>
        </div>
      </section>
    </main>
  );
}

function DataLoadFailure({
  language,
  message,
  onRetry,
}: {
  language: AppLanguage;
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="ownership-shell">
      <section className="ownership-card load-failure-card">
        <TimeFarmBrand />
        <span className="eyebrow">
          {translate(language, "dataLoad", "eyebrow")}
        </span>
        <h1>{translate(language, "dataLoad", "heading")}</h1>
        <p>{translate(language, "dataLoad", "description")}</p>
        <div className="load-error-detail" role="status">
          {message}
        </div>
        <button className="button primary full" onClick={onRetry}>
          <RotateCcw size={17} /> {translate(language, "dataLoad", "retry")}
        </button>
      </section>
    </main>
  );
}

function AuthenticationScreen({ language }: { language: AppLanguage }) {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const { state, resetLocalData } = useAppStore();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "sign-in") await signIn({ email, password });
      else {
        const result = await signUp({ email, password, displayName });
        if (result.requiresEmailConfirmation)
          setMessage(
            translate(language, "authentication", "signUpConfirmationRequired"),
          );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : translate(language, "authentication", "unableToAuthenticate"),
      );
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    setMessage("");
    try {
      await signInWithGoogle();
      setMessage(translate(language, "authentication", "googleStarted"));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : translate(language, "authentication", "unableToStartGoogle"),
      );
    } finally {
      setBusy(false);
    }
  };

  const clearLocalData = async () => {
    if (resetBusy) return;
    setResetBusy(true);
    setMessage("");
    try {
      const result = await resetLocalData();
      if (!result.ok && !/cancel/i.test(result.message))
        setMessage(result.message);
    } finally {
      setResetBusy(false);
      setResetConfirmationOpen(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel">
        <TimeFarmBrand large />
        <div className="auth-brand-copy">
          <img
            className="auth-mascot"
            src="./assets/timefarm-avatar.png"
            alt=""
            aria-hidden="true"
          />
          <span className="eyebrow light">
            {translate(language, "authentication", "brandEyebrow")}
          </span>
          <h1>
            {translate(language, "authentication", "brandHeadlineFirst")}
            <br />
            {translate(language, "authentication", "brandHeadlineSecond")}
          </h1>
          <p>{translate(language, "authentication", "brandDescription")}</p>
          <div className="auth-value-list">
            <span>
              <Check size={16} />{" "}
              {translate(language, "authentication", "valueOfflineTimer")}
            </span>
            <span>
              <Check size={16} />{" "}
              {translate(language, "authentication", "valueOriginalEarnings")}
            </span>
            <span>
              <Check size={16} />{" "}
              {translate(language, "authentication", "valueDataControl")}
            </span>
          </div>
        </div>
      </section>
      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-tabs">
            <button
              type="button"
              className={mode === "sign-in" ? "active" : ""}
              aria-pressed={mode === "sign-in"}
              onClick={() => setMode("sign-in")}
            >
              {translate(language, "authentication", "signIn")}
            </button>
            <button
              type="button"
              className={mode === "sign-up" ? "active" : ""}
              aria-pressed={mode === "sign-up"}
              onClick={() => setMode("sign-up")}
            >
              {translate(language, "authentication", "signUp")}
            </button>
          </div>
          <div className="welcome-heading">
            <span className="eyebrow">
              {translate(
                language,
                "authentication",
                mode === "sign-in" ? "signInEyebrow" : "signUpEyebrow",
              )}
            </span>
            <h2>
              {translate(
                language,
                "authentication",
                mode === "sign-in" ? "signInHeading" : "signUpHeading",
              )}
            </h2>
            <p>
              {translate(
                language,
                "authentication",
                mode === "sign-in" ? "signInDescription" : "signUpDescription",
              )}
            </p>
          </div>
          <button
            className="button google-button full"
            type="button"
            onClick={google}
            disabled={busy}
          >
            <span className="google-g">G</span>{" "}
            {translate(language, "authentication", "continueWithGoogle")}
          </button>
          <div className="auth-divider">
            <span />
            {translate(language, "authentication", "or")}
            <span />
          </div>
          {mode === "sign-up" && (
            <Field label={translate(language, "authentication", "displayName")}>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={translate(
                  language,
                  "authentication",
                  "displayNamePlaceholder",
                )}
                autoComplete="name"
              />
            </Field>
          )}
          <Field label={translate(language, "authentication", "email")}>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="minh@example.com"
              type="email"
              autoComplete="email"
              required
            />
          </Field>
          <Field label={translate(language, "authentication", "password")}>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={translate(
                language,
                "authentication",
                "passwordPlaceholder",
              )}
              type="password"
              minLength={8}
              autoComplete={
                mode === "sign-in" ? "current-password" : "new-password"
              }
              required
            />
          </Field>
          {message && (
            <p className="auth-message" role="alert" aria-live="assertive">
              {message}
            </p>
          )}
          <button className="button primary full" disabled={busy} type="submit">
            {busy
              ? translate(language, "authentication", "processing")
              : translate(
                  language,
                  "authentication",
                  mode === "sign-in" ? "signIn" : "signUp",
                )}{" "}
            <ChevronRight size={18} />
          </button>
          <p className="auth-note">
            {translate(language, "authentication", "authNote")}
          </p>
          {state?.account && (
            <div className="auth-local-recovery">
              <p>
                {language === "vi"
                  ? "Bạn vẫn có dữ liệu trên thiết bị này. Có thể xóa dữ liệu máy mà không cần đăng nhập lại."
                  : "This device still has local data. You can clear device data without signing in again."}
              </p>
              <button
                className="button danger-quiet full"
                type="button"
                disabled={busy || resetBusy}
                onClick={() => setResetConfirmationOpen(true)}
              >
                {resetBusy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Trash2 size={16} />
                )}
                {language === "vi"
                  ? "Xóa dữ liệu trên thiết bị"
                  : "Clear device data"}
              </button>
              {resetConfirmationOpen && (
                <LocalDataResetConfirmation
                  language={language}
                  busy={resetBusy}
                  onCancel={() => setResetConfirmationOpen(false)}
                  onConfirm={clearLocalData}
                />
              )}
            </div>
          )}
        </form>
      </section>
    </main>
  );
}

function Onboarding({
  authUser,
  offlineMode,
  initialLanguage,
  onLanguageChange,
}: {
  authUser: SafeAuthUser | null;
  offlineMode: boolean;
  initialLanguage: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
}) {
  const { initializeAccount } = useAppStoreActions();
  const [language, setLanguage] = useState<AppLanguage>(initialLanguage);
  const [name, setName] = useState(authUser?.displayName ?? "");
  const [country, setCountry] = useState("VN");
  const [currency, setCurrency] = useState<CurrencyCode>("VND");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitInFlightRef = useRef(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await initializeAccount({
        displayName: name,
        country,
        language,
        currency,
      });
      if (!result.ok)
        setError(
          language === "vi"
            ? `Không thể tạo workspace. ${result.message}`
            : `The workspace could not be created. ${result.message}`,
        );
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : language === "vi"
            ? "Không thể tạo workspace. Vui lòng thử lại."
            : "The workspace could not be created. Please try again.",
      );
    } finally {
      submitInFlightRef.current = false;
      setBusy(false);
    }
  };

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const accountEmail =
    authUser?.email ?? translate(language, "onboarding", "accountFallback");

  return (
    <main className="onboarding-shell">
      <section className="onboarding-art" aria-hidden="true">
        <TimeFarmBrand large />
        <div className="orb orb-one" />
        <div className="orb orb-two" />
        <div className="onboarding-copy">
          <span className="eyebrow light">
            {translate(language, "onboarding", "artEyebrow")}
          </span>
          <h1>
            {translate(language, "onboarding", "artHeadlineFirst")}
            <br />
            {translate(language, "onboarding", "artHeadlineSecond")}
          </h1>
          <p>{translate(language, "onboarding", "artDescription")}</p>
          <div className="mini-preview">
            <div className="mini-line long" />
            <div className="mini-line short" />
            <div className="mini-chart">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>
      </section>
      <section className="onboarding-form-wrap">
        <form className="onboarding-form" onSubmit={submit}>
          <div
            className="language-toggle"
            role="group"
            aria-label={translate(language, "onboarding", "languageAria")}
          >
            <button
              type="button"
              disabled={busy}
              className={language === "vi" ? "selected" : ""}
              aria-pressed={language === "vi"}
              onClick={() => {
                setLanguage("vi");
                onLanguageChange("vi");
              }}
            >
              {translate(language, "onboarding", "vietnamese")}
            </button>
            <button
              type="button"
              disabled={busy}
              className={language === "en" ? "selected" : ""}
              aria-pressed={language === "en"}
              onClick={() => {
                setLanguage("en");
                onLanguageChange("en");
              }}
            >
              {translate(language, "onboarding", "english")}
            </button>
          </div>
          <div className="welcome-heading">
            <span className="eyebrow">
              {translate(language, "onboarding", "setupEyebrow")}
            </span>
            <h2>{translate(language, "onboarding", "setupHeading")}</h2>
            <p>{translate(language, "onboarding", "setupDescription")}</p>
          </div>
          <Field label={translate(language, "onboarding", "nameLabel")}>
            <input
              autoFocus
              disabled={busy}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={translate(language, "onboarding", "namePlaceholder")}
            />
          </Field>
          <div className="form-grid">
            <Field label={translate(language, "onboarding", "countryLabel")}>
              <select
                value={country}
                disabled={busy}
                onChange={(event) => setCountry(event.target.value)}
              >
                <option value="VN">
                  {translate(language, "onboarding", "countryVietnam")}
                </option>
                <option value="US">
                  {translate(language, "onboarding", "countryUnitedStates")}
                </option>
                <option value="GB">
                  {translate(language, "onboarding", "countryUnitedKingdom")}
                </option>
                <option value="JP">
                  {translate(language, "onboarding", "countryJapan")}
                </option>
                <option value="DE">
                  {translate(language, "onboarding", "countryGermany")}
                </option>
              </select>
            </Field>
            <Field label={translate(language, "onboarding", "currencyLabel")}>
              <select
                value={currency}
                disabled={busy}
                onChange={(event) =>
                  setCurrency(event.target.value as CurrencyCode)
                }
              >
                {Object.keys(currencyMetadata).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="form-hint">
            <Globe2 size={15} />{" "}
            {translate(language, "onboarding", "timezoneHint", { timezone })}
          </p>
          {error && (
            <p className="form-error" role="alert" aria-live="assertive">
              {error}
            </p>
          )}
          <button
            className="button start-action full"
            type="submit"
            disabled={busy}
          >
            {busy && <LoaderCircle size={17} className="spin" />}
            {busy
              ? language === "vi"
                ? "Đang tạo workspace…"
                : "Creating workspace…"
              : translate(language, "onboarding", "enterWorkspace")}{" "}
            <ChevronRight size={18} />
          </button>
          <p className="auth-note">
            {offlineMode
              ? translate(language, "onboarding", "offlineMode")
              : translate(language, "onboarding", "accountMode", {
                  email: accountEmail,
                })}
          </p>
        </form>
      </section>
    </main>
  );
}

function ClaimLocalAccountScreen() {
  const { state, claimLocalAccount, resetLocalData } = useAppStore();
  const { status, signOut } = useAuth();
  const account = state!.account!;
  const user = status.user!;
  const language = account.language;
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"claim" | "sign-out" | "reset" | null>(null);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const claim = async () => {
    if (busy) return;
    setBusy("claim");
    setMessage("");
    try {
      const result = await claimLocalAccount(user.id);
      if (!result.ok) setMessage(result.message);
    } finally {
      setBusy(null);
    }
  };
  const leaveAccount = async () => {
    if (busy) return;
    setBusy("sign-out");
    setMessage("");
    try {
      await signOut();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to sign out.",
      );
    } finally {
      setBusy(null);
    }
  };
  const clearLocalData = async () => {
    if (busy) return;
    setBusy("reset");
    setMessage("");
    try {
      const result = await resetLocalData();
      if (!result.ok && !/cancel/i.test(result.message))
        setMessage(result.message);
    } finally {
      setBusy(null);
      setResetConfirmationOpen(false);
    }
  };
  return (
    <main className="ownership-shell">
      <section className="ownership-card">
        <TimeFarmBrand />
        <span className="eyebrow">
          {translate(language, "ownership", "claimEyebrow")}
        </span>
        <h1>{translate(language, "ownership", "claimHeading")}</h1>
        <p>{translate(language, "ownership", "claimDescription")}</p>
        <div className="ownership-summary">
          <div>
            <span>{translate(language, "ownership", "localProfile")}</span>
            <strong>
              {account.displayName} · {account.country} · {account.currency}
            </strong>
          </div>
          <div>
            <span>{translate(language, "ownership", "signedInAccount")}</span>
            <strong>{user.email ?? user.id}</strong>
          </div>
        </div>
        <label className="consent">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />{" "}
          {translate(language, "ownership", "consent")}
        </label>
        {message && <p className="form-error">{message}</p>}
        <button
          className="button primary full"
          disabled={!accepted || Boolean(busy)}
          onClick={() => {
            void claim();
          }}
        >
          {busy === "claim" && <LoaderCircle size={16} className="spin" />}
          {translate(language, "ownership", "claimAction")}{" "}
          <ChevronRight size={18} />
        </button>
        <div className="ownership-recovery">
          <p>{translate(language, "ownership", "resetDescription")}</p>
          <div className="ownership-actions">
            <button
              className="button ghost full"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void leaveAccount()}
            >
              {translate(language, "ownership", "signOutAction")}
            </button>
            <button
              className="button danger-quiet full"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => setResetConfirmationOpen(true)}
            >
              {busy === "reset" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Trash2 size={16} />
              )}
              {translate(language, "ownership", "resetAction")}
            </button>
          </div>
          {resetConfirmationOpen && (
            <LocalDataResetConfirmation
              language={language}
              busy={busy === "reset"}
              onCancel={() => setResetConfirmationOpen(false)}
              onConfirm={clearLocalData}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function AccountMismatchScreen() {
  const { state, resetLocalData } = useAppStore();
  const { status, signOut } = useAuth();
  const account = state!.account!;
  const language = account.language;
  const [busy, setBusy] = useState<"sign-out" | "reset" | null>(null);
  const [message, setMessage] = useState("");
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const leaveAccount = async () => {
    if (busy) return;
    setBusy("sign-out");
    setMessage("");
    try {
      await signOut();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to sign out.",
      );
    } finally {
      setBusy(null);
    }
  };
  const clearLocalData = async () => {
    if (busy) return;
    setBusy("reset");
    setMessage("");
    try {
      const result = await resetLocalData();
      if (!result.ok && !/cancel/i.test(result.message))
        setMessage(result.message);
    } finally {
      setBusy(null);
      setResetConfirmationOpen(false);
    }
  };
  return (
    <main className="ownership-shell">
      <section className="ownership-card">
        <TimeFarmBrand />
        <span className="eyebrow">
          {translate(language, "ownership", "mismatchEyebrow")}
        </span>
        <h1>{translate(language, "ownership", "mismatchHeading")}</h1>
        <p>{translate(language, "ownership", "mismatchDescription")}</p>
        <div className="ownership-summary">
          <div>
            <span>{translate(language, "ownership", "localData")}</span>
            <strong>{account.authUserId}</strong>
          </div>
          <div>
            <span>{translate(language, "ownership", "signedInAs")}</span>
            <strong>{status.user?.email ?? status.user?.id}</strong>
          </div>
        </div>
        {message && <p className="form-error">{message}</p>}
        <div className="ownership-recovery">
          <p>{translate(language, "ownership", "resetDescription")}</p>
          <div className="ownership-actions">
            <button
              className="button primary full"
              disabled={Boolean(busy)}
              onClick={() => void leaveAccount()}
            >
              {translate(language, "ownership", "signOutAction")}
            </button>
            <button
              className="button danger-quiet full"
              disabled={Boolean(busy)}
              onClick={() => setResetConfirmationOpen(true)}
            >
              {busy === "reset" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Trash2 size={16} />
              )}
              {translate(language, "ownership", "resetAction")}
            </button>
          </div>
          {resetConfirmationOpen && (
            <LocalDataResetConfirmation
              language={language}
              busy={busy === "reset"}
              onCancel={() => setResetConfirmationOpen(false)}
              onConfirm={clearLocalData}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function Workspace() {
  const { state, reload } = useAppStore();
  const account = state!.account!;
  const language = account.language;
  const active = getActiveSession(state!.sessions);
  const [page, setPage] = useState<Page>("dashboard");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileMoreButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileMoreMenuRef = useRef<HTMLElement | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(() => Boolean(active));

  useEffect(() => {
    const desktop = window.worklyDesktop;
    if (!desktop?.onOverlayStopRequested) return undefined;
    return desktop.onOverlayStopRequested((request) => {
      if (
        isActiveWorkSession(request.session) &&
        request.session.id === request.sessionId
      ) {
        setPage("dashboard");
        setDialog({ kind: "complete", session: request.session });
        return;
      }
      // An overlay action may reach the main process before this renderer has
      // received its state-change event. Resolve the canonical SQLite state
      // before deciding that the stop request is stale.
      void reload().then((latest) => {
        const current = latest ? getActiveSession(latest.sessions) : undefined;
        if (current && current.id === request.sessionId) {
          setPage("dashboard");
          setDialog({ kind: "complete", session: current });
        }
      });
    });
  }, [reload]);

  useEffect(() => {
    if (!mobileMoreOpen) return undefined;
    mobileMoreMenuRef.current
      ?.querySelector<HTMLButtonElement>("button:not([disabled])")
      ?.focus();
    const close = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        mobileMoreMenuRef.current?.contains(target) ||
        mobileMoreButtonRef.current?.contains(target)
      )
        return;
      setMobileMoreOpen(false);
      mobileMoreButtonRef.current?.focus();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMobileMoreOpen(false);
      mobileMoreButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", keydown);
    };
  }, [mobileMoreOpen]);

  const nav: { id: Page; icon: ReactNode; label: string }[] = [
    {
      id: "dashboard",
      icon: <LayoutDashboard size={19} />,
      label: label(language, "dashboard"),
    },
    {
      id: "projects",
      icon: <FolderKanban size={19} />,
      label: label(language, "projects"),
    },
    {
      id: "history",
      icon: <History size={19} />,
      label: label(language, "history"),
    },
    {
      id: "analytics",
      icon: <BarChart3 size={19} />,
      label: label(language, "analytics"),
    },
    {
      id: "profile",
      icon: <UserRound size={19} />,
      label: label(language, "profile"),
    },
    {
      id: "settings",
      icon: <Settings size={19} />,
      label: label(language, "settings"),
    },
  ];

  const renderPage = () => {
    switch (page) {
      case "projects":
        return (
          <ProjectsPage
            onNew={() => setDialog({ kind: "project" })}
            onEdit={(project) => setDialog({ kind: "project", project })}
            onRecordPayment={(project) =>
              setDialog({ kind: "payment", project })
            }
          />
        );
      case "history":
        return (
          <HistoryPage
            onEdit={(session) => setDialog({ kind: "edit-session", session })}
          />
        );
      case "analytics":
        return <AnalyticsPage />;
      case "profile":
        return <ProfilePage />;
      case "settings":
        return <SettingsPage />;
      default:
        return (
          <DashboardPage
            onStart={() => setDialog({ kind: "start" })}
            onComplete={(session) => setDialog({ kind: "complete", session })}
            onAddGoal={() => setDialog({ kind: "goal" })}
            onEditGoal={(goal) => setDialog({ kind: "goal", goal })}
            onCustomize={() => setDialog({ kind: "dashboard-customize" })}
          />
        );
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {language === "vi" ? "Bỏ qua điều hướng" : "Skip navigation"}
      </a>
      <aside className="sidebar">
        <TimeFarmBrand />
        <button
          className={`sidebar-start ${active ? "is-active" : ""}`}
          onClick={() =>
            active ? setPage("dashboard") : setDialog({ kind: "start" })
          }
        >
          {active ? (
            <Clock3 size={17} />
          ) : (
            <Play size={16} fill="currentColor" />
          )}{" "}
          {active
            ? language === "vi"
              ? "Xem phiên hiện tại"
              : "View active session"
            : label(language, "start")}
        </button>
        <span className="nav-section-label">
          {language === "vi" ? "KHÔNG GIAN LÀM VIỆC" : "WORKSPACE"}
        </span>
        <nav
          className="primary-nav"
          aria-label={
            language === "vi" ? "Điều hướng chính" : "Primary navigation"
          }
        >
          {nav.slice(0, 4).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              aria-current={page === item.id ? "page" : undefined}
              title={item.label}
              onClick={() => {
                setPage(item.id);
                setMobileMoreOpen(false);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
          <button
            ref={mobileMoreButtonRef}
            className={`nav-item mobile-more-button ${mobileMoreOpen ? "active" : ""}`}
            aria-expanded={mobileMoreOpen}
            aria-controls="mobile-more-menu"
            onClick={() => setMobileMoreOpen((open) => !open)}
          >
            <MoreHorizontal size={19} />
            <span>{language === "vi" ? "Thêm" : "More"}</span>
          </button>
        </nav>
        <span className="nav-section-label nav-section-secondary">
          {language === "vi" ? "CÁ NHÂN" : "PERSONAL"}
        </span>
        <nav
          ref={mobileMoreMenuRef}
          id="mobile-more-menu"
          className={`secondary-nav ${mobileMoreOpen ? "mobile-open" : ""}`}
          aria-hidden={mobileMoreOpen ? undefined : true}
          {...(!mobileMoreOpen ? { inert: true } : {})}
          aria-label={
            language === "vi" ? "Tài khoản và cài đặt" : "Account and settings"
          }
        >
          {nav.slice(4).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              aria-current={page === item.id ? "page" : undefined}
              title={item.label}
              onClick={() => {
                setPage(item.id);
                setMobileMoreOpen(false);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="account-chip">
            <span>{account.displayName.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{account.displayName}</strong>
              <small>
                {account.currency} · {account.timezone}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <main className="main-area" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <div>
            {active ? (
              <ActiveStatus session={active} language={language} />
            ) : (
              <span className="quiet-status">
                <Clock3 size={16} />{" "}
                {language === "vi"
                  ? "Chưa có phiên đang chạy"
                  : "No active session"}
              </span>
            )}
          </div>
          <div className="topbar-actions">
            <SyncPill
              language={language}
              onOpenConflicts={() => setDialog({ kind: "sync-conflicts" })}
            />
            <span className="timezone">
              <Globe2 size={15} /> {account.timezone}
            </span>
            <ThemeIcon />
          </div>
        </header>
        <div className="page-content">
          <Suspense
            fallback={
              <div
                className="panel page-loading"
                role="status"
                aria-live="polite"
              >
                <LoaderCircle size={22} className="spin" />
                <span>
                  {language === "vi" ? "Đang tải trang…" : "Loading page…"}
                </span>
              </div>
            }
          >
            {renderPage()}
          </Suspense>
        </div>
      </main>
      <Suspense
        fallback={
          <div className="modal-backdrop" role="status" aria-live="polite">
            <div className="panel page-loading dialog-loading">
              <LoaderCircle size={22} className="spin" />
              <span>
                {language === "vi" ? "Đang mở biểu mẫu…" : "Opening form…"}
              </span>
            </div>
          </div>
        }
      >
        {dialog?.kind === "start" && (
          <StartSessionDialog
            onClose={() => setDialog(null)}
            onStarted={() => {
              setDialog(null);
              setPage("dashboard");
            }}
          />
        )}
        {dialog?.kind === "complete" && (
          <CompleteSessionDialog
            session={dialog.session}
            requestedEndAt={dialog.endedAt}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === "project" && (
          <ProjectDialog
            project={dialog.project}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === "payment" && (
          <PaymentDialog
            key={`${dialog.project.id}:${dialog.payment?.id ?? "new"}`}
            project={dialog.project}
            payment={dialog.payment}
            onClose={() => setDialog(null)}
            onEditPayment={(payment) =>
              setDialog({ kind: "payment", project: dialog.project, payment })
            }
          />
        )}
        {dialog?.kind === "goal" && (
          <GoalDialog
            key={dialog.goal?.id ?? "new"}
            goal={dialog.goal}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === "dashboard-customize" && (
          <DashboardCustomizeDialog onClose={() => setDialog(null)} />
        )}
        {dialog?.kind === "sync-conflicts" && (
          <SyncConflictsDialog onClose={() => setDialog(null)} />
        )}
        {dialog?.kind === "edit-session" && (
          <EditSessionDialog
            session={dialog.session}
            onClose={() => setDialog(null)}
          />
        )}
        {recoveryOpen && active && (
          <RecoveryDialog
            session={active}
            onContinue={() => setRecoveryOpen(false)}
            onComplete={(endedAt) => {
              setRecoveryOpen(false);
              setDialog({ kind: "complete", session: active, endedAt });
            }}
          />
        )}
      </Suspense>
    </div>
  );
}

function SyncPill({
  language,
  onOpenConflicts,
}: {
  language: AppLanguage;
  onOpenConflicts: () => void;
}) {
  const { status: auth } = useAuth();
  const [summary, setSummary] = useState<{
    queued: number;
    failed: number;
    conflicts: number;
  } | null>(null);
  const [syncPending, setSyncPending] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const refresh = () => {
    const desktop = window.worklyDesktop;
    if (!desktop) return;
    void desktop
      .getSyncSummary()
      .then(setSummary)
      .catch(() => setSummary({ queued: 0, failed: 1, conflicts: 0 }));
  };
  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(interval);
  }, []);
  const retry = () => {
    const desktop = window.worklyDesktop;
    if (!desktop || syncPending) return;
    setSyncPending(true);
    setSyncMessage("");
    void desktop
      .syncNow()
      .catch(() =>
        setSyncMessage(
          language === "vi"
            ? "Không thể đồng bộ lúc này. Dữ liệu vẫn được lưu trên thiết bị."
            : "Sync is unavailable right now. Your data remains saved on this device.",
        ),
      )
      .finally(() => {
        setSyncPending(false);
        refresh();
      });
  };
  const failed = summary?.failed ?? 0;
  const queued = summary?.queued ?? 0;
  const conflicts = summary?.conflicts ?? 0;
  const text = !window.worklyDesktop
    ? language === "vi"
      ? "Lưu trong bản xem trước"
      : "Saved in preview"
    : !auth.configured
      ? language === "vi"
        ? "Lưu offline trên thiết bị"
        : "Saved offline on this device"
      : auth.offline
        ? language === "vi"
          ? "Đang offline · dữ liệu vẫn được lưu trên thiết bị"
          : "Offline · data remains saved on this device"
        : conflicts > 0
          ? language === "vi"
            ? `${conflicts} xung đột cần xem lại`
            : `${conflicts} conflicts need review`
          : failed > 0
            ? language === "vi"
              ? `${failed} mục cần đồng bộ lại`
              : `${failed} items need retry`
            : queued > 0
              ? language === "vi"
                ? `${queued} mục đang chờ đồng bộ`
                : `${queued} items queued to sync`
              : language === "vi"
                ? "Đồng bộ không có thay đổi chờ"
                : "Sync queue clear";
  const click = conflicts > 0 ? onOpenConflicts : retry;
  return (
    <button
      className={`sync-pill ${failed > 0 || conflicts > 0 ? "error" : queued > 0 ? "queued" : ""}`}
      onClick={click}
      disabled={syncPending}
      aria-busy={syncPending}
      aria-describedby={syncMessage ? "sync-pill-message" : undefined}
      title={
        conflicts > 0
          ? language === "vi"
            ? "Xem xung đột đồng bộ"
            : "Review sync conflicts"
          : language === "vi"
            ? "Thử đồng bộ ngay"
            : "Try sync now"
      }
    >
      <span className="sync-dot" />
      {text}
      {syncMessage && (
        <span id="sync-pill-message" className="visually-hidden" role="alert">
          {syncMessage}
        </span>
      )}
    </button>
  );
}

function SyncConflictsDialog({ onClose }: { onClose: () => void }) {
  const { state } = useAppStoreState();
  const account = state!.account!;
  const language = account.language;
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingConflictId, setPendingConflictId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let mounted = true;
    const desktop = window.worklyDesktop;
    if (!desktop) {
      const fallback = window.setTimeout(() => {
        if (mounted) setLoading(false);
      }, 0);
      return () => {
        mounted = false;
        window.clearTimeout(fallback);
      };
    }
    void desktop
      .getSyncConflicts(100)
      .then((items) => {
        if (mounted) setConflicts(items);
      })
      .catch(() => {
        if (mounted)
          setMessage(
            language === "vi"
              ? "Không thể đọc danh sách xung đột."
              : "Could not read sync conflicts.",
          );
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [language, refreshKey]);

  const resolve = async (conflict: SyncConflict) => {
    const desktop = window.worklyDesktop;
    if (!desktop || pendingConflictId) return;
    setPendingConflictId(conflict.id);
    setMessage("");
    try {
      const result = await desktop.resolveSyncConflict(conflict.id);
      if (!result.resolved) {
        setMessage(
          language === "vi"
            ? "Xung đột này đã được xử lý ở nơi khác."
            : "This conflict was already handled elsewhere.",
        );
      }
      setRefreshKey((value) => value + 1);
    } catch {
      setMessage(
        language === "vi"
          ? "Không thể cập nhật trạng thái xung đột."
          : "Could not update the conflict state.",
      );
    } finally {
      setPendingConflictId(null);
    }
  };

  const applyCloudVersion = async (conflict: SyncConflict) => {
    const desktop = window.worklyDesktop;
    if (!desktop || pendingConflictId) return;
    setPendingConflictId(conflict.id);
    setMessage("");
    try {
      const result = await desktop.acceptRemoteSyncConflict(conflict.id);
      if (!result.accepted) {
        setMessage(
          language === "vi"
            ? `Không thể dùng bản cloud an toàn (${result.reason ?? "unknown"}). Bản local vẫn được giữ.`
            : `The cloud version could not be applied safely (${result.reason ?? "unknown"}). The local version was kept.`,
        );
      }
      setRefreshKey((value) => value + 1);
    } catch {
      setMessage(
        language === "vi"
          ? "Không thể áp dụng bản cloud."
          : "Could not apply the cloud version.",
      );
    } finally {
      setPendingConflictId(null);
    }
  };

  const entityName = (entity: SyncConflict["entityType"]) => {
    const labels =
      language === "vi"
        ? {
            account: "hồ sơ",
            project: "dự án",
            work_session: "phiên làm việc",
            payment: "thanh toán",
            goal: "mục tiêu",
            preferences: "bố cục",
          }
        : {
            account: "profile",
            project: "project",
            work_session: "work session",
            payment: "payment",
            goal: "goal",
            preferences: "layout",
          };
    return labels[entity];
  };

  return (
    <Modal
      title={language === "vi" ? "Xung đột đồng bộ" : "Sync conflicts"}
      subtitle={
        language === "vi"
          ? "TimeFarm giữ nguyên bản local đang chờ gửi thay vì tự động ghi đè nó bằng thay đổi từ thiết bị khác."
          : "TimeFarm retained your pending local data rather than automatically overwriting it with a change from another device."
      }
      onClose={onClose}
      closeLabel={language === "vi" ? "Đóng" : "Close"}
    >
      {loading ? (
        <div className="empty-state compact">
          <LoaderCircle size={20} className="spin" />
          <div>
            <strong>
              {language === "vi" ? "Đang kiểm tra…" : "Checking…"}
            </strong>
          </div>
        </div>
      ) : conflicts.length === 0 ? (
        <EmptyState
          compact
          icon={<Check />}
          title={
            language === "vi" ? "Không còn xung đột mở" : "No open conflicts"
          }
          description={
            language === "vi"
              ? "Các thay đổi local và cloud hiện không cần bạn xem lại."
              : "Your local and cloud changes do not need review right now."
          }
        />
      ) : (
        <div className="sync-conflict-list">
          {conflicts.map((conflict) => (
            <article key={conflict.id} className="sync-conflict-row">
              <div>
                <strong>{entityName(conflict.entityType)}</strong>
                <span>
                  {language === "vi"
                    ? `Phát hiện ${formatDate(conflict.detectedAt, language, account.timezone)} · ${conflict.reason}`
                    : `Detected ${formatDate(conflict.detectedAt, language, account.timezone)} · ${conflict.reason}`}
                </span>
                <small>
                  {language === "vi"
                    ? "Chọn giữ bản local để gửi lại, hoặc dùng bản cloud nếu thay đổi đó an toàn."
                    : "Keep the local version to retry it, or use the cloud version when that change is safe."}
                </small>
              </div>
              <div className="sync-conflict-actions">
                <button
                  className="button ghost compact"
                  disabled={Boolean(pendingConflictId)}
                  aria-busy={pendingConflictId === conflict.id}
                  onClick={() => {
                    void resolve(conflict);
                  }}
                >
                  {language === "vi"
                    ? "Giữ local & gửi lại"
                    : "Keep local & retry"}
                </button>
                <button
                  className="button ghost compact"
                  disabled={Boolean(pendingConflictId)}
                  aria-busy={pendingConflictId === conflict.id}
                  onClick={() => {
                    void applyCloudVersion(conflict);
                  }}
                >
                  {language === "vi" ? "Dùng bản cloud" : "Use cloud version"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {message && (
        <p className="form-error" role="alert" aria-live="assertive">
          {message}
        </p>
      )}
      <div className="modal-actions">
        <button className="button primary" onClick={onClose}>
          <Check size={16} /> {language === "vi" ? "Đóng" : "Close"}
        </button>
      </div>
    </Modal>
  );
}

function ThemeIcon() {
  const { state } = useAppStoreState();
  return (
    <span className="theme-indicator" aria-hidden="true">
      {state?.preferences.theme === "dark" ? (
        <Moon size={17} />
      ) : (
        <Sun size={17} />
      )}
    </span>
  );
}

function ActiveStatus({
  session,
  language,
}: {
  session: WorkSession;
  language: AppLanguage;
}) {
  const { state } = useAppStoreState();
  const now = useCurrentTime();
  const project = state?.projects.find((item) => item.id === session.projectId);
  return (
    <span className={`active-status ${session.status}`}>
      <span className="live-dot" />
      {session.status === "paused"
        ? label(language, "paused")
        : label(language, "active")}{" "}
      ·{" "}
      <strong>
        {formatDuration(activeDurationMs(session, now), true, language)}
      </strong>{" "}
      · {project?.name ?? label(language, "noProject")}
    </span>
  );
}

const dashboardWidgetOrder: DashboardWidgetId[] = [
  "timer",
  "goals",
  "earningsTrend",
  "hoursTrend",
  "rateTrend",
  "projectBreakdown",
  "comparison",
  "cumulativeEarnings",
];

const dashboardWidgetLabels: Record<
  DashboardWidgetId,
  { vi: string; en: string }
> = {
  timer: { vi: "Đồng hồ làm việc", en: "Work timer" },
  goals: { vi: "Mục tiêu", en: "Goals" },
  earningsTrend: { vi: "Thu nhập 7 ngày", en: "7-day earnings" },
  hoursTrend: { vi: "Thời gian 7 ngày", en: "7-day work time" },
  projectBreakdown: { vi: "Thời gian theo dự án", en: "Time by project" },
  rateTrend: { vi: "Thu nhập / giờ", en: "Earnings / hour" },
  cumulativeEarnings: { vi: "Thu nhập tích luỹ", en: "Cumulative earnings" },
  comparison: { vi: "So sánh kỳ trước", en: "Previous-period comparison" },
};

const dashboardDefaultSizes: Record<DashboardWidgetId, DashboardWidgetSize> = {
  timer: "large",
  goals: "small",
  earningsTrend: "large",
  hoursTrend: "large",
  projectBreakdown: "medium",
  rateTrend: "small",
  cumulativeEarnings: "large",
  comparison: "medium",
};

function normalizedDashboardOrder(
  order: DashboardWidgetId[],
): DashboardWidgetId[] {
  const known = new Set(dashboardWidgetOrder);
  const selected = order.filter(
    (id, index) => known.has(id) && order.indexOf(id) === index,
  );
  return [
    ...selected,
    ...dashboardWidgetOrder.filter((id) => !selected.includes(id)),
  ];
}

function DashboardPage({
  onStart,
  onComplete,
  onAddGoal,
  onEditGoal,
  onCustomize,
}: {
  onStart: () => void;
  onComplete: (session: WorkSession) => void;
  onAddGoal: () => void;
  onEditGoal: (goal: Goal) => void;
  onCustomize: () => void;
}) {
  const { state, pauseSession, resumeSession } = useAppStore();
  const app = state!;
  const account = app.account!;
  const language = account.language;
  const [timerAction, setTimerAction] = useState<"pause" | "resume" | null>(
    null,
  );
  const [timerError, setTimerError] = useState("");
  const timerActionInFlightRef = useRef(false);
  const now = useCurrentTime(true, 60_000);
  const active = getActiveSession(app.sessions);
  const at = now;
  const todayRange = currentDayRange(account.timezone, at);
  const todaySummary = liveRangeSummary(
    app.sessions,
    account.currency,
    todayRange,
    at,
  );
  const todayDuration = todaySummary.activeMs;
  const todayEarnings = todaySummary.earningsMinor;
  const todayRate = todaySummary.effectiveHourlyMinor;
  const dashboardRange = resolveRange("7d", account.timezone, at);
  const series = rangeDailySeries(
    app.sessions,
    account.currency,
    dashboardRange,
    language,
    at,
  );
  const breakdownRange = resolveRange("30d", account.timezone, at);
  const breakdown = projectBreakdown(
    app.sessions,
    app.projects,
    account.currency,
    breakdownRange,
  );
  const dashboardOverlap = completedSessionOverlapSummary(
    app.sessions,
    breakdownRange,
  );
  const comparison = periodComparison(
    app.sessions,
    account.currency,
    dashboardRange,
    at,
  );
  const rateSeries = series.map((point) => ({
    label: point.label,
    value:
      point.earningActiveMs < 60_000
        ? 0
        : Math.round(point.earningsMinor / (point.earningActiveMs / 3_600_000)),
  }));
  const cumulative = cumulativeSeries(series);
  const order = normalizedDashboardOrder(app.preferences.dashboardWidgetOrder);
  const hidden = new Set(app.preferences.dashboardHiddenWidgets);
  const sizes = {
    ...dashboardDefaultSizes,
    ...app.preferences.dashboardWidgetSizes,
  };
  const todayLabel = new Intl.DateTimeFormat(
    language === "vi" ? "vi-VN" : "en-US",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: account.timezone,
    },
  ).format(new Date(at));
  const mutateTimer = async (action: "pause" | "resume") => {
    if (timerActionInFlightRef.current) return;
    timerActionInFlightRef.current = true;
    setTimerAction(action);
    setTimerError("");
    try {
      const result =
        action === "pause" ? await pauseSession() : await resumeSession();
      if (!result.ok)
        setTimerError(
          language === "vi"
            ? `Không thể ${action === "pause" ? "tạm dừng" : "tiếp tục"} timer. ${result.message}`
            : result.message,
        );
    } catch (actionError) {
      setTimerError(
        actionError instanceof Error
          ? actionError.message
          : language === "vi"
            ? "Không thể cập nhật timer. Vui lòng thử lại."
            : "The timer could not be updated. Please try again.",
      );
    } finally {
      timerActionInFlightRef.current = false;
      setTimerAction(null);
    }
  };
  const widgets: Record<DashboardWidgetId, ReactNode> = {
    timer: (
      <TimerCard
        session={active}
        language={language}
        onStart={onStart}
        onPause={() => mutateTimer("pause")}
        onResume={() => mutateTimer("resume")}
        onComplete={onComplete}
        projects={app.projects}
        pendingAction={timerAction}
        mutationError={timerError}
      />
    ),
    goals: <GoalsCard onAdd={onAddGoal} onEdit={onEditGoal} />,
    earningsTrend: (
      <ChartCard
        title={
          language === "vi" ? "Thu nhập trong 7 ngày" : "Earnings over 7 days"
        }
        subtitle={
          language === "vi"
            ? `Chỉ hiển thị ${account.currency}; không tự quy đổi`
            : `Showing ${account.currency}; no automatic conversion`
        }
      >
        <TrendChart
          points={series.map((point) => ({
            label: point.label,
            value: point.earningsMinor,
          }))}
          money
          currency={account.currency}
          language={language}
        />
      </ChartCard>
    ),
    hoursTrend: (
      <ChartCard
        title={language === "vi" ? "Thời gian làm việc" : "Work time"}
        subtitle={
          language === "vi" ? "Nhịp độ 7 ngày gần nhất" : "Your last 7 days"
        }
      >
        <TrendChart
          points={series.map((point) => ({
            label: point.label,
            value: point.activeMs / 3_600_000,
          }))}
          language={language}
        />
      </ChartCard>
    ),
    projectBreakdown: (
      <ProjectBreakdownCard
        entries={breakdown}
        language={language}
        currency={account.currency}
      />
    ),
    rateTrend: (
      <ChartCard
        title={language === "vi" ? "Thu nhập / giờ" : "Earnings / hour"}
        subtitle={
          language === "vi"
            ? "Theo từng ngày có thời gian làm việc"
            : "Per active day"
        }
      >
        <TrendChart
          points={rateSeries}
          money
          currency={account.currency}
          language={language}
        />
      </ChartCard>
    ),
    cumulativeEarnings: (
      <ChartCard
        title={language === "vi" ? "Thu nhập tích luỹ" : "Cumulative earnings"}
        subtitle={language === "vi" ? "7 ngày gần nhất" : "Last 7 days"}
      >
        <TrendChart
          points={cumulative.map((point) => ({
            label: point.label,
            value: point.earningsMinor,
          }))}
          money
          currency={account.currency}
          language={language}
        />
      </ChartCard>
    ),
    comparison: (
      <PeriodComparisonCard
        comparison={comparison}
        language={language}
        title={
          language === "vi"
            ? "Thời gian so với kỳ trước"
            : "Work time vs prior period"
        }
        metric="time"
      />
    ),
  };

  return (
    <>
      <div className="page-heading heading-with-action">
        <div>
          <span className="eyebrow">
            {language === "vi" ? "TRUNG TÂM HÔM NAY" : "TODAY COMMAND CENTER"}
          </span>
          <h1>{label(language, "dashboard")}</h1>
          <p>
            {language === "vi"
              ? "Tập trung vào phiên hiện tại trước, xem xu hướng sâu hơn khi bạn cần."
              : "Stay focused on the current session, then explore deeper trends when you need them."}
          </p>
        </div>
        <div className="dashboard-heading-actions">
          <span className="today-date">
            <CalendarDays size={15} /> {todayLabel}
          </span>
          <button className="button ghost compact" onClick={onCustomize}>
            <Settings size={16} />{" "}
            {language === "vi" ? "Tuỳ chỉnh" : "Customize"}
          </button>
        </div>
      </div>
      <section className="dashboard-command-grid">
        <div className="dashboard-hero">{widgets.timer}</div>
        <aside className="today-summary">
          <div className="today-summary-heading">
            <div>
              <span className="eyebrow">
                {language === "vi" ? "NHỊP LÀM VIỆC" : "DAILY PULSE"}
              </span>
              <h2>
                {language === "vi" ? "Hôm nay của bạn" : "Your day at a glance"}
              </h2>
            </div>
            <span className="summary-live-dot" aria-hidden="true" />
          </div>
          <div className="today-metric-grid">
            <MetricCard
              icon={<Clock3 />}
              label={label(language, "workTime")}
              value={formatDuration(todayDuration, true, language)}
              hint={label(language, "today")}
              tone="blue"
            />
            <MetricCard
              icon={<CircleDollarSign />}
              label={label(language, "earnings")}
              value={formatMoney(
                { amountMinor: todayEarnings, currency: account.currency },
                language,
              )}
              hint={label(language, "today")}
              tone="green"
            />
            <MetricCard
              icon={<TrendingUp />}
              label={label(language, "efficiency")}
              value={
                todayRate === null
                  ? "—"
                  : formatMoney(
                      { amountMinor: todayRate, currency: account.currency },
                      language,
                    )
              }
              hint={
                todayRate === null
                  ? language === "vi"
                    ? "Chờ phiên đầu tiên"
                    : "Waiting for a session"
                  : language === "vi"
                    ? "Từ phiên đã chốt"
                    : "Completed sessions"
              }
              tone="violet"
            />
            <MetricCard
              icon={<History />}
              label={label(language, "sessions")}
              value={String(todaySummary.sessionCount)}
              hint={language === "vi" ? "Đã hoàn tất" : "Completed today"}
              tone="orange"
            />
          </div>
        </aside>
      </section>
      {dashboardOverlap.overlapMs > 0 && (
        <div className="notice overlap-notice" role="status">
          <AlertTriangle size={17} />
          <span>
            {language === "vi"
              ? `${dashboardOverlap.affectedSessionCount} phiên trong 30 ngày bị chồng thời gian. Tổng giờ chỉ tính mỗi thời điểm một lần; thu nhập và dữ liệu dự án vẫn được giữ nguyên.`
              : `${dashboardOverlap.affectedSessionCount} sessions overlap in the last 30 days. Total time counts each instant once; earnings and project facts remain intact.`}
          </span>
        </div>
      )}
      <div className="dashboard-section-heading">
        <div>
          <span className="eyebrow">
            {language === "vi" ? "BỨC TRANH LỚN" : "THE BIGGER PICTURE"}
          </span>
          <h2>
            {language === "vi" ? "Mục tiêu và xu hướng" : "Goals and trends"}
          </h2>
        </div>
        <p>
          {language === "vi"
            ? "Các tín hiệu quan trọng, không phải một bức tường số liệu."
            : "The signals that matter, without the wall of numbers."}
        </p>
      </div>
      <section className="dashboard-grid dashboard-custom-grid">
        {order
          .filter((id) => id !== "timer" && !hidden.has(id))
          .map((id) => (
            <div
              className={`dashboard-widget widget-${id} size-${sizes[id]}`}
              key={id}
            >
              {widgets[id]}
            </div>
          ))}
      </section>
    </>
  );
}

function TimerCard({
  session,
  language,
  onStart,
  onPause,
  onResume,
  onComplete,
  projects,
  pendingAction,
  mutationError,
}: {
  session?: WorkSession;
  language: AppLanguage;
  onStart: () => void;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onComplete: (session: WorkSession) => void;
  projects: Project[];
  pendingAction: "pause" | "resume" | null;
  mutationError: string;
}) {
  const now = useCurrentTime(Boolean(session));
  const project = projects.find((item) => item.id === session?.projectId);
  if (!session)
    return (
      <article className="timer-card idle">
        <div className="timer-orb">
          <Play size={31} fill="currentColor" />
        </div>
        <div>
          <span className="eyebrow">
            {language === "vi" ? "PHIÊN LÀM VIỆC" : "WORK SESSION"}
          </span>
          <h2>
            {language === "vi"
              ? "Bạn sẵn sàng bắt đầu?"
              : "Ready when you are."}
          </h2>
          <p>
            {language === "vi"
              ? "Chọn một dự án hoặc ghi nhận một phiên độc lập."
              : "Choose a project, or track an independent work period."}
          </p>
          <button className="button primary" onClick={onStart}>
            <Play size={17} fill="currentColor" /> {label(language, "start")}
          </button>
        </div>
      </article>
    );
  const isPaused = session.status === "paused";
  const elapsedMs = activeDurationMs(session, now);
  const scaleProgress = Math.min(100, (elapsedMs / (4 * 3_600_000)) * 100);
  return (
    <article
      className={`timer-card ${isPaused ? "paused" : ""}`}
      aria-busy={pendingAction !== null}
    >
      <div className="timer-summary">
        <span className="eyebrow">
          {isPaused
            ? label(language, "paused")
            : language === "vi"
              ? "ĐANG TÍNH GIỜ"
              : "TRACKING NOW"}
        </span>
        <h2>
          <ProjectGlyph icon={project?.icon} size={25} />
          <span>{project?.name ?? label(language, "noProject")}</span>
        </h2>
        <p>
          {language === "vi"
            ? `Bắt đầu lúc ${formatClockTime(session.startedAt, language, session.timezone)} · ${session.timezone}`
            : `Started ${formatClockTime(session.startedAt, language, session.timezone)} · ${session.timezone}`}
        </p>
      </div>
      <div className="timer-clock">
        <span>{formatTimerClock(elapsedMs)}</span>
        <small>
          {isPaused
            ? language === "vi"
              ? "Đã dừng đếm"
              : "Timer paused"
            : language === "vi"
              ? "Đang ghi nhận thời gian thực"
              : "Tracking active time"}
        </small>
      </div>
      <div className="timer-instrument-scale" aria-hidden="true">
        <div
          className="timer-instrument-fill"
          style={{ width: `${scaleProgress}%` }}
        />
        <span>0h</span>
        <span>1h</span>
        <span>2h</span>
        <span>3h</span>
        <span>4h</span>
      </div>
      <div className="timer-actions">
        {isPaused ? (
          <button
            className="button primary"
            disabled={pendingAction !== null}
            onClick={() => void onResume()}
          >
            {pendingAction === "resume" ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Play size={16} fill="currentColor" />
            )}{" "}
            {label(language, "resume")}
          </button>
        ) : (
          <button
            className="button ghost"
            disabled={pendingAction !== null}
            onClick={() => void onPause()}
          >
            {pendingAction === "pause" ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Pause size={16} fill="currentColor" />
            )}{" "}
            {label(language, "pause")}
          </button>
        )}
        <button
          className="button danger-quiet"
          disabled={pendingAction !== null}
          onClick={() => onComplete(session)}
        >
          <Square size={15} fill="currentColor" /> {label(language, "stop")}
        </button>
      </div>
      {mutationError && (
        <p className="form-error" role="alert" aria-live="assertive">
          {mutationError}
        </p>
      )}
    </article>
  );
}

function GoalsCard({
  onAdd,
  onEdit,
}: {
  onAdd: () => void;
  onEdit: (goal: Goal) => void;
}) {
  const { state, deleteGoal } = useAppStore();
  const app = state!;
  const account = app.account!;
  const language = account.language;
  const [error, setError] = useState("");
  const [pendingGoalId, setPendingGoalId] = useState<string | null>(null);
  const deleteInFlightRef = useRef(false);
  const removeGoal = async (goalId: string) => {
    if (deleteInFlightRef.current) return;
    if (
      !window.confirm(
        language === "vi" ? "Xóa mục tiêu này?" : "Delete this goal?",
      )
    )
      return;
    deleteInFlightRef.current = true;
    setPendingGoalId(goalId);
    setError("");
    try {
      const result = await deleteGoal(goalId);
      if (!result.ok)
        setError(
          language === "vi"
            ? `Không thể xóa mục tiêu. ${result.message}`
            : `The goal could not be deleted. ${result.message}`,
        );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : language === "vi"
            ? "Không thể xóa mục tiêu. Vui lòng thử lại."
            : "The goal could not be deleted. Please try again.",
      );
    } finally {
      deleteInFlightRef.current = false;
      setPendingGoalId(null);
    }
  };
  return (
    <article className="panel goals-card" aria-busy={pendingGoalId !== null}>
      <div className="panel-heading">
        <div>
          <h3>{language === "vi" ? "Mục tiêu" : "Goals"}</h3>
          <p>
            {language === "vi"
              ? "Theo tiến độ thực tế"
              : "Based on actual progress"}
          </p>
        </div>
        <button
          className="icon-button"
          disabled={pendingGoalId !== null}
          onClick={onAdd}
          aria-label="Add goal"
        >
          <Plus size={18} />
        </button>
      </div>
      {app.goals.length === 0 ? (
        <EmptyState
          compact
          icon={<Target />}
          title={language === "vi" ? "Chưa có mục tiêu" : "No goals yet"}
          description={
            language === "vi"
              ? "Đặt một mục tiêu nhỏ để có hướng đi rõ hơn."
              : "Set a small target to make progress visible."
          }
          action={
            <button
              className="text-button"
              disabled={pendingGoalId !== null}
              onClick={onAdd}
            >
              {language === "vi" ? "Tạo mục tiêu" : "Create goal"}
            </button>
          }
        />
      ) : (
        <div className="goals-list">
          {app.goals.map((goal) => (
            <GoalRow
              key={goal.id}
              goal={goal}
              language={language}
              onEdit={() => onEdit(goal)}
              disabled={pendingGoalId !== null}
              deleting={pendingGoalId === goal.id}
              onDelete={() => {
                void removeGoal(goal.id);
              }}
            />
          ))}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert" aria-live="assertive">
          {error}
        </p>
      )}
    </article>
  );
}

function GoalRow({
  goal,
  language,
  onEdit,
  onDelete,
  disabled,
  deleting,
}: {
  goal: Goal;
  language: AppLanguage;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
  deleting: boolean;
}) {
  const { state } = useAppStoreState();
  const app = state!;
  const account = app.account!;
  const progress = calculateGoalProgress(
    goal,
    app.sessions,
    app.projects,
    account.currency,
    new Date(),
    account.timezone,
  );
  const unit = goalUnit(goal.kind);
  const value = formatGoalProgressValue(
    progress.current,
    progress.target,
    unit,
    account.currency,
    language,
  );
  const remaining = formatGoalRemaining(
    progress.remaining,
    unit,
    account.currency,
    language,
  );
  const statusText = goalStatusLabel(progress.status, language);
  return (
    <div className="goal-row">
      <div className="goal-row-head">
        <strong>{goalLabels[goal.kind][language]}</strong>
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={onEdit}
            aria-label={language === "vi" ? "Chỉnh sửa mục tiêu" : "Edit goal"}
          >
            {label(language, "edit")}
          </button>
          <button
            type="button"
            className="mini-remove"
            disabled={disabled}
            onClick={onDelete}
            aria-label="Delete goal"
          >
            {deleting ? (
              <LoaderCircle size={13} className="spin" />
            ) : (
              <X size={13} />
            )}
          </button>
        </span>
      </div>
      <div className="goal-progress">
        <i style={{ width: `${progress.percentage}%` }} />
      </div>
      <small>
        {value} · {Math.round(progress.percentage)}% · {remaining}
      </small>
      <GoalPace
        progress={progress}
        unit={unit}
        currency={account.currency}
        timezone={account.timezone}
        language={language}
      />
      <span className={`goal-status ${progress.status}`}>{statusText}</span>
    </div>
  );
}

export function DashboardCustomizeDialog({ onClose }: { onClose: () => void }) {
  const { state, updatePreferences } = useAppStore();
  const app = state!;
  const language = app.account!.language;
  const mutationInFlightRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const order = normalizedDashboardOrder(app.preferences.dashboardWidgetOrder);
  const movableOrder = order.filter(
    (id): id is Exclude<DashboardWidgetId, "timer"> => id !== "timer",
  );
  const hidden = new Set(
    app.preferences.dashboardHiddenWidgets.filter((id) => id !== "timer"),
  );
  const persist = async (partial: Partial<Preferences>) => {
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setPending(true);
    setError("");
    try {
      const result = await updatePreferences(partial);
      if (!result.ok)
        setError(
          language === "vi"
            ? `Không thể lưu bố cục dashboard. ${result.message}`
            : `The dashboard layout could not be saved. ${result.message}`,
        );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : language === "vi"
            ? "Không thể lưu bố cục dashboard. Vui lòng thử lại."
            : "The dashboard layout could not be saved. Please try again.",
      );
    } finally {
      mutationInFlightRef.current = false;
      setPending(false);
    }
  };
  const move = async (
    id: Exclude<DashboardWidgetId, "timer">,
    direction: -1 | 1,
  ) => {
    const index = movableOrder.indexOf(id);
    const target = index + direction;
    if (target < 0 || target >= movableOrder.length) return;
    const next = [...movableOrder];
    [next[index], next[target]] = [next[target], next[index]];
    await persist({ dashboardWidgetOrder: ["timer", ...next] });
  };
  const toggle = async (id: Exclude<DashboardWidgetId, "timer">) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    await persist({ dashboardHiddenWidgets: [...next] });
  };
  const setSize = async (id: DashboardWidgetId, size: DashboardWidgetSize) => {
    await persist({
      dashboardWidgetSizes: {
        ...app.preferences.dashboardWidgetSizes,
        [id]: size,
      },
    });
  };
  const reset = async () => {
    await persist({
      dashboardHiddenWidgets: [],
      dashboardWidgetOrder: [...dashboardWidgetOrder],
      dashboardWidgetSizes: {},
    });
  };
  return (
    <Modal
      title={language === "vi" ? "Tuỳ chỉnh dashboard" : "Customize dashboard"}
      subtitle={
        language === "vi"
          ? "Timer là vùng ưu tiên cố định. Các widget phân tích có thể đổi thứ tự, kích thước và trạng thái hiển thị."
          : "The timer is a fixed priority area. Analysis widgets can be reordered, resized, and hidden."
      }
      onClose={onClose}
      locked={pending}
      closeLabel={language === "vi" ? "Đóng" : "Close"}
    >
      <div className="dashboard-customize-list" aria-busy={pending}>
        <div className="dashboard-customize-row fixed-widget-row">
          <label>
            <input data-autofocus type="checkbox" disabled checked readOnly />
            <span>{dashboardWidgetLabels.timer[language]}</span>
          </label>
          <small>
            {language === "vi" ? "Vùng ưu tiên cố định" : "Fixed priority area"}
          </small>
        </div>
        {movableOrder.map((id, index) => (
          <div className="dashboard-customize-row" key={id}>
            <label>
              <input
                type="checkbox"
                disabled={pending}
                checked={!hidden.has(id)}
                onChange={() => void toggle(id)}
              />
              <span>{dashboardWidgetLabels[id][language]}</span>
            </label>
            <div className="dashboard-customize-controls">
              <button
                className="icon-button"
                type="button"
                disabled={pending || index === 0}
                onClick={() => void move(id, -1)}
                aria-label={
                  language === "vi" ? "Di chuyển widget lên" : "Move widget up"
                }
              >
                ↑
              </button>
              <button
                className="icon-button"
                type="button"
                disabled={pending || index === movableOrder.length - 1}
                onClick={() => void move(id, 1)}
                aria-label={
                  language === "vi"
                    ? "Di chuyển widget xuống"
                    : "Move widget down"
                }
              >
                ↓
              </button>
              <select
                disabled={pending}
                value={
                  app.preferences.dashboardWidgetSizes[id] ??
                  dashboardDefaultSizes[id]
                }
                onChange={(event) =>
                  void setSize(id, event.target.value as DashboardWidgetSize)
                }
                aria-label={
                  language === "vi" ? "Kích thước widget" : "Widget size"
                }
              >
                <option value="small">
                  {language === "vi" ? "Nhỏ" : "Small"}
                </option>
                <option value="medium">
                  {language === "vi" ? "Vừa" : "Medium"}
                </option>
                <option value="large">
                  {language === "vi" ? "Lớn" : "Large"}
                </option>
              </select>
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert" aria-live="assertive">
          {error}
        </p>
      )}
      {pending && (
        <p className="form-hint" role="status" aria-live="polite">
          <LoaderCircle size={15} className="spin" />{" "}
          {language === "vi"
            ? "Đang lưu bố cục dashboard…"
            : "Saving dashboard layout…"}
        </p>
      )}
      <div className="modal-actions">
        <button
          className="button ghost"
          type="button"
          disabled={pending}
          onClick={() => void reset()}
        >
          <RotateCcw size={16} />{" "}
          {language === "vi" ? "Khôi phục mặc định" : "Reset defaults"}
        </button>
        <button
          className="button primary"
          type="button"
          disabled={pending}
          onClick={onClose}
        >
          <Check size={16} /> {language === "vi" ? "Xong" : "Done"}
        </button>
      </div>
    </Modal>
  );
}

function ProjectsPage({
  onNew,
  onEdit,
  onRecordPayment,
}: {
  onNew: () => void;
  onEdit: (project: Project) => void;
  onRecordPayment: (project: Project) => void;
}) {
  const { state, setProjectStatus, startSession } = useAppStore();
  const app = state!;
  const language = app.account!.language;
  const [filter, setFilter] = useState<"all" | ProjectStatus>("all");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [pendingProjectAction, setPendingProjectAction] = useState<{
    projectId: string;
    action: "start" | "status";
  } | null>(null);
  const [mutationError, setMutationError] = useState("");
  const projectMutationInFlightRef = useRef(false);
  const sessionsByProject = useMemo(() => {
    const grouped = new Map<string, WorkSession[]>();
    for (const session of app.sessions) {
      if (!session.projectId) continue;
      const existing = grouped.get(session.projectId);
      if (existing) existing.push(session);
      else grouped.set(session.projectId, [session]);
    }
    return grouped;
  }, [app.sessions]);
  const paymentsByProject = useMemo(() => {
    const grouped = new Map<string, Payment[]>();
    for (const payment of app.payments) {
      const existing = grouped.get(payment.projectId);
      if (existing) existing.push(payment);
      else grouped.set(payment.projectId, [payment]);
    }
    return grouped;
  }, [app.payments]);
  const projects = app.projects.filter(
    (project) => filter === "all" || project.status === filter,
  );
  const selectedProject = app.projects.find(
    (project) => project.id === selectedProjectId,
  );
  const runProjectMutation = async (
    project: Project,
    action: "start" | "status",
    mutation: () => Promise<ActionResult>,
  ) => {
    if (projectMutationInFlightRef.current) return;
    projectMutationInFlightRef.current = true;
    setPendingProjectAction({ projectId: project.id, action });
    setMutationError("");
    try {
      const result = await mutation();
      if (!result.ok)
        setMutationError(
          language === "vi"
            ? `Không thể cập nhật dự án “${project.name}”. ${result.message}`
            : `Project “${project.name}” could not be updated. ${result.message}`,
        );
    } catch (mutationFailure) {
      setMutationError(
        mutationFailure instanceof Error
          ? mutationFailure.message
          : language === "vi"
            ? `Không thể cập nhật dự án “${project.name}”. Vui lòng thử lại.`
            : `Project “${project.name}” could not be updated. Please try again.`,
      );
    } finally {
      projectMutationInFlightRef.current = false;
      setPendingProjectAction(null);
    }
  };
  const startProject = async (project: Project) => {
    await runProjectMutation(project, "start", () => startSession(project.id));
  };
  const setStatus = async (project: Project, status: ProjectStatus) => {
    await runProjectMutation(project, "status", () =>
      setProjectStatus(project.id, status),
    );
  };
  return (
    <>
      <div className="page-heading heading-with-action">
        <div>
          <span className="eyebrow">
            {language === "vi" ? "TỔ CHỨC CÔNG VIỆC" : "ORGANIZE WORK"}
          </span>
          <h1>{label(language, "projects")}</h1>
          <p>
            {language === "vi"
              ? "Mỗi phiên có thể gắn với một dự án — nhưng không bắt buộc."
              : "Every session can belong to a project — but never has to."}
          </p>
        </div>
        <button
          className="button primary"
          disabled={pendingProjectAction !== null}
          onClick={onNew}
        >
          <Plus size={18} /> {language === "vi" ? "Dự án mới" : "New project"}
        </button>
      </div>
      <div className="filter-row">
        {(["all", "active", "paused", "completed"] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={filter === status ? "filter active" : "filter"}
          >
            {status === "all"
              ? language === "vi"
                ? "Tất cả"
                : "All"
              : label(language, status)}
          </button>
        ))}
      </div>
      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title={language === "vi" ? "Chưa có dự án nào" : "No projects yet"}
          description={
            language === "vi"
              ? "Tạo dự án đầu tiên hoặc bắt đầu một phiên không gắn dự án."
              : "Create your first project or start an unassigned session."
          }
          action={
            <button
              className="button primary"
              disabled={pendingProjectAction !== null}
              onClick={onNew}
            >
              <Plus size={17} />{" "}
              {language === "vi" ? "Tạo dự án" : "Create project"}
            </button>
          }
        />
      ) : (
        <div
          className="project-grid project-ledger"
          aria-busy={pendingProjectAction !== null}
        >
          <div className="project-ledger-head" aria-hidden="true">
            <span>{language === "vi" ? "Dự án" : "Project"}</span>
            <span>{language === "vi" ? "Trạng thái" : "Status"}</span>
            <span>{language === "vi" ? "Phiên" : "Sessions"}</span>
            <span>{language === "vi" ? "Giá trị" : "Value"}</span>
            <span>{language === "vi" ? "Đã nhận" : "Received"}</span>
            <span>{language === "vi" ? "Thao tác" : "Actions"}</span>
          </div>
          {projects.map((project) => {
            const payments = paymentsByProject.get(project.id) ?? [];
            const relatedSessions = sessionsByProject.get(project.id) ?? [];
            const received = groupedMoney(
              payments.map((payment) => payment.money),
            )
              .map((money) => formatMoney(money, language))
              .join(" · ");
            return (
              <article
                className="project-card"
                key={project.id}
                aria-busy={pendingProjectAction?.projectId === project.id}
              >
                <div className="project-ledger-identity">
                  <span
                    className="project-icon"
                    style={{
                      background: `${project.color}1e`,
                      color: project.color,
                    }}
                  >
                    <ProjectGlyph icon={project.icon} />
                  </span>
                  <div>
                    <h3>{project.name}</h3>
                    <p>{paymentModelLabels[project.paymentModel][language]}</p>
                  </div>
                </div>
                <div className="project-card-head">
                  <span className={`status-badge ${project.status}`}>
                    {label(language, project.status)}
                  </span>
                  {pendingProjectAction?.projectId === project.id && (
                    <LoaderCircle size={15} className="spin" />
                  )}
                </div>
                <div className="project-ledger-fact">
                  <strong>{relatedSessions.length}</strong>
                  <span>{language === "vi" ? "phiên" : "sessions"}</span>
                </div>
                <div className="project-ledger-fact">
                  <strong>
                    {project.expectedMoney
                      ? formatMoney(project.expectedMoney, language)
                      : "—"}
                  </strong>
                  <span>{language === "vi" ? "dự kiến" : "expected"}</span>
                </div>
                <div className="project-ledger-fact project-payment-summary">
                  <strong>{received || "—"}</strong>
                  <span>
                    {payments.length === 0
                      ? language === "vi"
                        ? "chưa có thanh toán"
                        : "no payments"
                      : `${payments.length} ${language === "vi" ? "khoản" : "payments"}`}
                  </span>
                </div>
                <div className="project-card-footer">
                  <button
                    className="text-button project-detail-trigger"
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    {language === "vi" ? "Xem chi tiết" : "View details"}
                  </button>
                  <button
                    className="text-button"
                    disabled={pendingProjectAction !== null}
                    onClick={() => onEdit(project)}
                  >
                    {label(language, "edit")}
                  </button>
                  <button
                    className="text-button"
                    disabled={pendingProjectAction !== null}
                    onClick={() => onRecordPayment(project)}
                  >
                    {language === "vi" ? "Ghi nhận tiền" : "Record payment"}
                  </button>
                  {project.status === "completed" ? (
                    <button
                      className="text-button"
                      disabled={pendingProjectAction !== null}
                      onClick={() => void setStatus(project, "active")}
                    >
                      {language === "vi" ? "Mở lại" : "Reopen"}
                    </button>
                  ) : (
                    <>
                      <button
                        className="text-button"
                        disabled={pendingProjectAction !== null}
                        onClick={() =>
                          void setStatus(
                            project,
                            project.status === "active" ? "paused" : "active",
                          )
                        }
                      >
                        {project.status === "active"
                          ? label(language, "pause")
                          : label(language, "resume")}
                      </button>
                      <button
                        className="text-button"
                        disabled={pendingProjectAction !== null}
                        onClick={() => void setStatus(project, "completed")}
                      >
                        {language === "vi" ? "Hoàn tất" : "Complete"}
                      </button>
                      <button
                        className="icon-button colored"
                        disabled={pendingProjectAction !== null}
                        aria-label={
                          language === "vi"
                            ? `Bắt đầu dự án ${project.name}`
                            : `Start ${project.name}`
                        }
                        onClick={() => void startProject(project)}
                      >
                        {pendingProjectAction?.projectId === project.id &&
                        pendingProjectAction.action === "start" ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <Play size={16} fill="currentColor" />
                        )}
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {selectedProject && (
        <ProjectDetailPanel
          project={selectedProject}
          sessions={sessionsByProject.get(selectedProject.id) ?? []}
          payments={paymentsByProject.get(selectedProject.id) ?? []}
          language={language}
          timezone={app.account!.timezone}
          busy={pendingProjectAction !== null}
          onClose={() => setSelectedProjectId(null)}
          onEdit={() => onEdit(selectedProject)}
          onRecordPayment={() => onRecordPayment(selectedProject)}
          onStart={() => void startProject(selectedProject)}
        />
      )}
      {mutationError && (
        <p className="form-error" role="alert" aria-live="assertive">
          {mutationError}
        </p>
      )}
    </>
  );
}

function ProjectDetailPanel({
  project,
  sessions,
  payments,
  language,
  timezone,
  busy,
  onClose,
  onEdit,
  onRecordPayment,
  onStart,
}: {
  project: Project;
  sessions: WorkSession[];
  payments: Payment[];
  language: AppLanguage;
  timezone: string;
  busy: boolean;
  onClose: () => void;
  onEdit: () => void;
  onRecordPayment: () => void;
  onStart: () => void;
}) {
  const recentSessions = [...sessions]
    .sort(
      (left, right) =>
        new Date(right.endedAt ?? right.startedAt).getTime() -
        new Date(left.endedAt ?? left.startedAt).getTime(),
    )
    .slice(0, 5);
  const recentPayments = [...payments]
    .sort(
      (left, right) =>
        new Date(right.receivedAt).getTime() -
        new Date(left.receivedAt).getTime(),
    )
    .slice(0, 5);

  return (
    <section
      className="project-detail-panel"
      aria-labelledby={`project-detail-${project.id}`}
    >
      <header className="project-detail-heading">
        <div className="project-detail-title">
          <span
            className="project-icon"
            style={{
              background: `${project.color}1e`,
              color: project.color,
            }}
          >
            <ProjectGlyph icon={project.icon} />
          </span>
          <div>
            <span className="eyebrow">
              {language === "vi" ? "HỒ SƠ DỰ ÁN" : "PROJECT RECORD"}
            </span>
            <h2 id={`project-detail-${project.id}`}>{project.name}</h2>
            <p>{paymentModelLabels[project.paymentModel][language]}</p>
          </div>
        </div>
        <div className="project-detail-actions">
          {project.status !== "completed" && (
            <button
              className="button start-action compact"
              disabled={busy}
              onClick={onStart}
            >
              <Play size={15} fill="currentColor" />
              {language === "vi" ? "Bắt đầu" : "Start"}
            </button>
          )}
          <button
            className="button ghost compact"
            disabled={busy}
            onClick={onEdit}
          >
            {label(language, "edit")}
          </button>
          <button
            className="icon-button"
            aria-label={
              language === "vi"
                ? "Đóng chi tiết dự án"
                : "Close project details"
            }
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="project-detail-facts">
        <div>
          <span>{language === "vi" ? "Trạng thái" : "Status"}</span>
          <strong className={`status-badge ${project.status}`}>
            {label(language, project.status)}
          </strong>
        </div>
        <div>
          <span>
            {language === "vi" ? "Phiên đã ghi" : "Recorded sessions"}
          </span>
          <strong>{sessions.length}</strong>
        </div>
        <div>
          <span>
            {language === "vi" ? "Giá trị dự kiến" : "Expected value"}
          </span>
          <strong>{formatMoney(project.expectedMoney, language)}</strong>
        </div>
        <div>
          <span>{language === "vi" ? "Thanh toán" : "Payments"}</span>
          <strong>{payments.length}</strong>
        </div>
      </div>

      {project.note && <p className="project-detail-note">{project.note}</p>}

      <div className="project-detail-ledgers">
        <section aria-labelledby={`project-sessions-${project.id}`}>
          <div className="ledger-section-heading">
            <h3 id={`project-sessions-${project.id}`}>
              {language === "vi" ? "Phiên gần đây" : "Recent sessions"}
            </h3>
            <span>{recentSessions.length}</span>
          </div>
          {recentSessions.length === 0 ? (
            <p className="ledger-empty">
              {language === "vi"
                ? "Chưa có thời gian được ghi cho dự án này."
                : "No time has been recorded for this project yet."}
            </p>
          ) : (
            <div className="project-detail-list">
              {recentSessions.map((session) => (
                <div key={session.id}>
                  <span>
                    {formatDate(
                      session.endedAt ?? session.startedAt,
                      language,
                      session.timezone,
                    )}
                  </span>
                  <strong>
                    {formatDuration(activeDurationMs(session), true, language)}
                  </strong>
                  <strong>{formatMoney(session.earnings, language)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby={`project-payments-${project.id}`}>
          <div className="ledger-section-heading">
            <h3 id={`project-payments-${project.id}`}>
              {language === "vi" ? "Sổ thanh toán" : "Payment ledger"}
            </h3>
            <button
              className="text-button"
              disabled={busy}
              onClick={onRecordPayment}
            >
              {language === "vi" ? "Ghi nhận tiền" : "Record payment"}
            </button>
          </div>
          {recentPayments.length === 0 ? (
            <p className="ledger-empty">
              {language === "vi"
                ? "Chưa có khoản thanh toán nào."
                : "No payments have been recorded."}
            </p>
          ) : (
            <div className="project-detail-list">
              {recentPayments.map((payment) => (
                <div key={payment.id}>
                  <span>
                    {formatDate(payment.receivedAt, language, timezone)}
                  </span>
                  <span>
                    {payment.kind === "completion"
                      ? language === "vi"
                        ? "Hoàn tất"
                        : "Completion"
                      : language === "vi"
                        ? "Theo tiến độ"
                        : "Progressive"}
                  </span>
                  <strong>{formatMoney(payment.money, language)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function HistoryPage({ onEdit }: { onEdit: (session: WorkSession) => void }) {
  const { state } = useAppStoreState();
  const app = state!;
  const language = app.account!.language;
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState<"all" | CurrencyCode>(
    "all",
  );
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const sorted = useMemo(
    () =>
      [...app.sessions]
        .filter((session) => session.status === "completed")
        .sort(
          (a, b) =>
            new Date(b.endedAt ?? b.startedAt).getTime() -
            new Date(a.endedAt ?? a.startedAt).getTime(),
        ),
    [app.sessions],
  );
  const latestId = sorted[0]?.id;
  const visible = sorted.filter((session) => {
    const project = app.projects.find((item) => item.id === session.projectId);
    const matchesText = `${project?.name ?? ""} ${session.note ?? ""}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase());
    const matchesProject =
      projectFilter === "all" ||
      (projectFilter === "unassigned"
        ? !session.projectId
        : session.projectId === projectFilter);
    const matchesCurrency =
      currencyFilter === "all" || session.earnings?.currency === currencyFilter;
    return matchesText && matchesProject && matchesCurrency;
  });
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedSessions = visible.slice(
    currentPage * pageSize,
    currentPage * pageSize + pageSize,
  );
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">
          {language === "vi" ? "NHẬT KÝ CÔNG VIỆC" : "WORK LOG"}
        </span>
        <h1>{label(language, "history")}</h1>
        <p>
          {language === "vi"
            ? "Lịch sử đã chốt được bảo vệ để số liệu luôn đáng tin cậy."
            : "Completed history stays protected so your numbers remain trustworthy."}
        </p>
      </div>
      <div className="history-toolbar">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          aria-label={
            language === "vi"
              ? "Tìm dự án hoặc ghi chú"
              : "Search projects or notes"
          }
          placeholder={
            language === "vi"
              ? "Tìm dự án hoặc ghi chú…"
              : "Search projects or notes…"
          }
        />
        <select
          value={projectFilter}
          onChange={(event) => {
            setProjectFilter(event.target.value);
            setPage(0);
          }}
          aria-label={
            language === "vi" ? "Lọc theo dự án" : "Filter by project"
          }
        >
          <option value="all">
            {language === "vi" ? "Tất cả dự án" : "All projects"}
          </option>
          <option value="unassigned">{label(language, "noProject")}</option>
          {app.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <select
          value={currencyFilter}
          onChange={(event) => {
            setCurrencyFilter(event.target.value as "all" | CurrencyCode);
            setPage(0);
          }}
          aria-label={
            language === "vi" ? "Lọc theo tiền tệ" : "Filter by currency"
          }
        >
          <option value="all">
            {language === "vi" ? "Tất cả tiền tệ" : "All currencies"}
          </option>
          {Object.keys(currencyMetadata).map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
        <span>
          {visible.length} {language === "vi" ? "phiên" : "sessions"}
        </span>
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={
            language === "vi"
              ? "Chưa có phiên hoàn tất"
              : "No completed sessions"
          }
          description={
            language === "vi"
              ? "Khi kết thúc phiên, thu nhập và ghi chú sẽ xuất hiện tại đây."
              : "When you finish a session, its earnings and note will appear here."
          }
        />
      ) : (
        <>
          <div className="history-list">
            <div className="history-list-head" aria-hidden="true">
              <span>{language === "vi" ? "Ngày / giờ" : "Date / time"}</span>
              <span>{language === "vi" ? "Dự án" : "Project"}</span>
              <span>{language === "vi" ? "Thời lượng" : "Duration"}</span>
              <span>{language === "vi" ? "Thu nhập" : "Earnings"}</span>
              <span>{language === "vi" ? "Ghi chú" : "Note"}</span>
              <span>{language === "vi" ? "Thao tác" : "Action"}</span>
            </div>
            {pagedSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                canEdit={session.id === latestId}
                onEdit={() => onEdit(session)}
              />
            ))}
          </div>
          {pageCount > 1 && (
            <nav
              className="history-pagination"
              aria-label={
                language === "vi" ? "Phân trang lịch sử" : "History pages"
              }
            >
              <button
                type="button"
                className="button ghost"
                disabled={currentPage === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                <ChevronLeft size={16} />{" "}
                {language === "vi" ? "Trước" : "Previous"}
              </button>
              <span aria-live="polite">
                {language === "vi" ? "Trang" : "Page"} {currentPage + 1} /{" "}
                {pageCount}
              </span>
              <button
                type="button"
                className="button ghost"
                disabled={currentPage === pageCount - 1}
                onClick={() =>
                  setPage((value) => Math.min(pageCount - 1, value + 1))
                }
              >
                {language === "vi" ? "Sau" : "Next"} <ChevronRight size={16} />
              </button>
            </nav>
          )}
        </>
      )}
    </>
  );
}

function SessionRow({
  session,
  canEdit,
  onEdit,
}: {
  session: WorkSession;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { state } = useAppStoreState();
  const app = state!;
  const language = app.account!.language;
  const project = app.projects.find((item) => item.id === session.projectId);
  const statusLabel =
    session.status === "running"
      ? label(language, "active")
      : label(language, session.status);
  return (
    <article className="session-row">
      <div className="session-date">
        <strong>
          {formatDate(
            session.endedAt ?? session.startedAt,
            language,
            session.timezone,
          )}
        </strong>
        <span>
          {formatClockTime(session.startedAt, language, session.timezone)} —{" "}
          {formatClockTime(
            session.endedAt ?? session.startedAt,
            language,
            session.timezone,
          )}
        </span>
        <small className="session-status">{statusLabel}</small>
      </div>
      <div className="session-project">
        <span
          className="color-dot"
          style={{ background: project?.color ?? "#94a3b8" }}
          aria-hidden="true"
        />
        <span
          className="inline-project-glyph"
          aria-hidden="true"
          style={{ color: project?.color ?? "#94a3b8" }}
        >
          <ProjectGlyph icon={project?.icon} size={14} />
        </span>
        {project?.name ?? label(language, "noProject")}
      </div>
      <div className="session-duration">
        <Clock3 size={15} />{" "}
        {formatDuration(activeDurationMs(session), true, language)}
      </div>
      <div className="session-money">
        {formatMoney(session.earnings, language)}
      </div>
      <div className="session-note">{session.note || "—"}</div>
      {canEdit ? (
        <button className="text-button" onClick={onEdit}>
          {label(language, "edit")}
        </button>
      ) : (
        <span className="locked">
          {language === "vi" ? "Đã khóa" : "Locked"}
        </span>
      )}
    </article>
  );
}
