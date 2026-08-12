import { useId, type ReactNode } from "react";
import {
  BarChart3,
  CircleDashed,
  Diamond,
  FolderKanban,
  Gem,
  Sparkles,
  Sun,
  TrendingUp,
  Triangle,
} from "lucide-react";
import {
  calculateGoalProgress,
  goalUnit,
  periodComparison,
  type projectBreakdown,
} from "../domain/analytics";
import { formatMoney } from "../domain/money";
import { formatClockTime, formatDate, formatDuration } from "../domain/time";
import type { AppLanguage, CurrencyCode } from "../domain/types";
import { translate } from "../i18n";
import { useAppStoreState } from "../lib/state";

export function MetricCard({
  icon,
  label: title,
  value,
  hint,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </article>
  );
}

export function ProjectGlyph({
  icon,
  size = 17,
}: {
  icon?: string;
  size?: number;
}) {
  switch (icon) {
    case "✦":
      return <Sparkles size={size} aria-hidden="true" />;
    case "◈":
      return <Gem size={size} aria-hidden="true" />;
    case "◆":
      return <Diamond size={size} aria-hidden="true" />;
    case "△":
      return <Triangle size={size} aria-hidden="true" />;
    case "☼":
      return <Sun size={size} aria-hidden="true" />;
    default:
      return <CircleDashed size={size} aria-hidden="true" />;
  }
}

export function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <article className="panel chart-card">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className="panel-heading-icon" aria-hidden="true">
          <BarChart3 size={17} />
        </span>
      </div>
      {children}
    </article>
  );
}

export function TrendChart({
  points,
  money,
  currency,
  language,
}: {
  points: { label: string; value: number }[];
  money?: boolean;
  currency?: CurrencyCode;
  language: AppLanguage;
}) {
  const gradientId = useId();
  const hasData = points.some((point) => point.value > 0);
  if (!hasData)
    return (
      <div className="trend-empty">
        <span className="trend-empty-visual">
          <BarChart3 size={23} />
        </span>
        <strong>
          {language === "vi"
            ? "Chưa có dữ liệu trong kỳ"
            : "No data in this period"}
        </strong>
        <small>
          {language === "vi"
            ? "Hoàn tất một phiên để biểu đồ bắt đầu kể câu chuyện."
            : "Complete a session and your trend will appear here."}
        </small>
      </div>
    );
  const max = Math.max(...points.map((point) => point.value), 1);
  const width = 560;
  const height = 160;
  const padding = 14;
  const step =
    points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const pointString = points
    .map(
      (point, index) =>
        `${padding + index * step},${height - padding - (point.value / max) * (height - padding * 2)}`,
    )
    .join(" ");
  const current = points.at(-1)?.value ?? 0;
  const markerStride = Math.max(1, Math.ceil(points.length / 42));
  const labelStride = Math.max(1, Math.ceil(points.length / 8));
  const display =
    money && currency
      ? formatMoney({ amountMinor: current, currency }, language)
      : `${current.toFixed(current >= 10 ? 0 : 1)}h`;
  const chartLabel =
    language === "vi"
      ? `Biểu đồ xu hướng gồm ${points.length} mốc, giá trị mới nhất ${display}`
      : `Trend chart with ${points.length} points, latest value ${display}`;
  return (
    <div className="trend-wrap">
      <div className="chart-current">
        {display}
        <small>{language === "vi" ? "mốc mới nhất" : "latest point"}</small>
      </div>
      <svg
        className="trend-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={chartLabel}
      >
        <title>{chartLabel}</title>
        <desc>
          {language === "vi"
            ? "Đường biểu diễn thay đổi giá trị theo thời gian."
            : "A line showing how the value changes over time."}
        </desc>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1={padding}
          x2={width - padding}
          y1={height - padding}
          y2={height - padding}
          stroke="currentColor"
          opacity=".16"
        />
        <polygon
          points={`${padding},${height - padding} ${pointString} ${width - padding},${height - padding}`}
          fill={`url(#${gradientId})`}
        />
        <polyline
          points={pointString}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map(
          (point, index) =>
            (index % markerStride === 0 || index === points.length - 1) && (
              <circle
                key={`${point.label}-${index}`}
                cx={padding + index * step}
                cy={
                  height -
                  padding -
                  (point.value / max) * (height - padding * 2)
                }
                r="3.5"
                fill="var(--panel)"
                stroke="currentColor"
                strokeWidth="2"
              />
            ),
        )}
      </svg>
      <div className="chart-labels">
        {points.map((point, index) => (
          <span key={`${point.label}-${index}`}>
            {index % labelStride === 0 || index === points.length - 1
              ? point.label
              : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "compact" : ""}`}>
      <span className="empty-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        {action}
      </div>
    </div>
  );
}

export function ProjectBreakdownCard({
  entries,
  language,
  currency,
  title,
  subtitle,
  mode = "time",
}: {
  entries: ReturnType<typeof projectBreakdown>;
  language: AppLanguage;
  currency: CurrencyCode;
  title?: string;
  subtitle?: string;
  mode?: "time" | "earnings";
}) {
  const { state } = useAppStoreState();
  const projects = state!.projects;
  const isEarnings = mode === "earnings";
  const max = Math.max(
    ...entries.map((entry) =>
      isEarnings ? entry.earningsMinor : entry.activeMs,
    ),
    1,
  );
  return (
    <article className="panel project-breakdown">
      <div className="panel-heading">
        <div>
          <h3>
            {title ??
              (language === "vi" ? "Dự án chiếm thời gian" : "Time by project")}
          </h3>
          <p>
            {subtitle ??
              (language === "vi" ? "30 ngày gần nhất" : "Last 30 days")}
          </p>
        </div>
        <FolderKanban size={18} />
      </div>
      {entries.length === 0 ? (
        <EmptyState
          compact
          icon={<FolderKanban />}
          title={
            language === "vi" ? "Chưa có dữ liệu dự án" : "No project data yet"
          }
          description={
            language === "vi"
              ? "Bắt đầu phiên có gắn dự án để theo dõi."
              : "Start a project-linked session to see a breakdown."
          }
        />
      ) : (
        <div className="breakdown-list">
          {entries.slice(0, 5).map((entry) => {
            const primary = isEarnings ? entry.earningsMinor : entry.activeMs;
            const secondary = isEarnings
              ? formatDuration(entry.activeMs, true, language)
              : entry.earningsMinor > 0
                ? formatMoney(
                    { amountMinor: entry.earningsMinor, currency },
                    language,
                  )
                : null;
            const project = entry.projectId
              ? projects.find((item) => item.id === entry.projectId)
              : undefined;
            return (
              <div className="breakdown-row" key={entry.projectId ?? "none"}>
                <div className="breakdown-title">
                  <span
                    className="color-dot"
                    style={{ background: entry.color }}
                    aria-hidden="true"
                  />{" "}
                  <strong>
                    <span
                      className="inline-project-glyph"
                      aria-hidden="true"
                      style={{ color: entry.color }}
                    >
                      <ProjectGlyph icon={project?.icon} size={14} />
                    </span>{" "}
                    {entry.name ||
                      translate(language, "workspace", "noProject")}
                  </strong>
                  <span>
                    {isEarnings
                      ? formatMoney(
                          { amountMinor: primary, currency },
                          language,
                        )
                      : formatDuration(primary, true, language)}
                  </span>
                </div>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${Math.max(4, (primary / max) * 100)}%`,
                      background: entry.color,
                    }}
                  />
                </div>
                {secondary && <small>{secondary}</small>}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

export function formatGoalProgressValue(
  current: number,
  target: number,
  unit: ReturnType<typeof goalUnit>,
  currency: CurrencyCode,
  language: AppLanguage,
): string {
  if (unit === "hours") return `${current.toFixed(1)} / ${target}h`;
  if (unit === "moneyMinor")
    return `${formatMoney({ amountMinor: current, currency }, language)} / ${formatMoney({ amountMinor: target, currency }, language)}`;
  return `${current} / ${target}`;
}

export function formatGoalRemaining(
  value: number,
  unit: ReturnType<typeof goalUnit>,
  currency: CurrencyCode,
  language: AppLanguage,
): string {
  const text = formatGoalUnitValue(value, unit, currency, language);
  return language === "vi" ? `Còn ${text}` : `${text} remaining`;
}

export function formatGoalUnitValue(
  value: number,
  unit: ReturnType<typeof goalUnit>,
  currency: CurrencyCode,
  language: AppLanguage,
): string {
  if (unit === "hours") return `${value.toFixed(1)}h`;
  if (unit === "moneyMinor")
    return formatMoney({ amountMinor: Math.round(value), currency }, language);
  return String(Math.round(value));
}

export function GoalPace({
  progress,
  unit,
  currency,
  timezone,
  language,
}: {
  progress: ReturnType<typeof calculateGoalProgress>;
  unit: ReturnType<typeof goalUnit>;
  currency: CurrencyCode;
  timezone: string;
  language: AppLanguage;
}) {
  if (progress.expectedCurrent === null)
    return (
      <small className="goal-pace">
        {language === "vi" ? "Chưa có nhịp dự kiến" : "No pace estimate yet"}
      </small>
    );
  const expected = formatGoalUnitValue(
    progress.expectedCurrent,
    unit,
    currency,
    language,
  );
  const pace =
    progress.pacePerHour === null
      ? null
      : formatGoalUnitValue(progress.pacePerHour, unit, currency, language);
  const projected = progress.projectedCompletionAt
    ? `${formatDate(progress.projectedCompletionAt, language, timezone)} ${formatClockTime(progress.projectedCompletionAt, language, timezone)}`
    : null;
  return (
    <small className="goal-pace">
      {language === "vi" ? (
        <>
          Mốc kỳ vọng: {expected}
          {pace && <> · Nhịp hiện tại: {pace}/giờ</>}
          {projected && <> · Ước tính hoàn thành: {projected}</>}
        </>
      ) : (
        <>
          Expected by now: {expected}
          {pace && <> · Current pace: {pace}/hour</>}
          {projected && <> · Estimated completion: {projected}</>}
        </>
      )}
    </small>
  );
}

export function goalStatusLabel(
  status: ReturnType<typeof calculateGoalProgress>["status"],
  language: AppLanguage,
): string {
  const labels =
    language === "vi"
      ? {
          complete: "Đã đạt",
          ahead: "Vượt nhịp",
          behind: "Chậm nhịp",
          on_track: "Đúng nhịp",
          insufficient_data: "Chưa đủ dữ liệu",
        }
      : {
          complete: "Complete",
          ahead: "Ahead",
          behind: "Behind",
          on_track: "On track",
          insufficient_data: "Not enough data",
        };
  return labels[status];
}

export function PeriodComparisonCard({
  comparison,
  language,
  currency,
  title,
  metric,
}: {
  comparison: ReturnType<typeof periodComparison>;
  language: AppLanguage;
  currency?: CurrencyCode;
  title: string;
  metric: "time" | "earnings";
}) {
  const current =
    metric === "time"
      ? comparison.current.activeMs
      : comparison.current.earningsMinor;
  const previous =
    metric === "time"
      ? comparison.previous.activeMs
      : comparison.previous.earningsMinor;
  const change =
    metric === "time" ? comparison.activeMsChange : comparison.earningsChange;
  const max = Math.max(current, previous, 1);
  const value = (amount: number) =>
    metric === "time"
      ? formatDuration(amount, true, language)
      : formatMoney({ amountMinor: amount, currency: currency! }, language);
  const changeText =
    change === null
      ? language === "vi"
        ? "Chưa có mốc so sánh"
        : "No prior baseline"
      : `${change >= 0 ? "+" : ""}${change.toFixed(0)}% ${language === "vi" ? "so với kỳ trước" : "vs prior period"}`;
  return (
    <article className="panel comparison-card">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          <p>{changeText}</p>
        </div>
        <TrendingUp size={18} />
      </div>
      <div className="comparison-bars">
        <div>
          <span>{language === "vi" ? "Kỳ này" : "Current"}</span>
          <strong>{value(current)}</strong>
          <i>
            <b style={{ width: `${(current / max) * 100}%` }} />
          </i>
        </div>
        <div>
          <span>{language === "vi" ? "Kỳ trước" : "Previous"}</span>
          <strong>{value(previous)}</strong>
          <i>
            <b style={{ width: `${(previous / max) * 100}%` }} />
          </i>
        </div>
      </div>
    </article>
  );
}
