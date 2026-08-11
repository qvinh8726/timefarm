import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CircleDollarSign,
  Clock3,
  Globe2,
  History,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  calculateGoalProgress,
  completedSessionOverlapSummary,
  cumulativeSeries,
  durationDistribution,
  goalUnit,
  periodComparison,
  projectBreakdown,
  projectEfficiencyRanking,
  rangeDailySeries,
  rangeSummary,
  resolveRange,
  sessionContribution,
  type AnalyticsRange,
  type AnalyticsRangePreset,
} from "../domain/analytics";
import { formatMoney, groupedMoney } from "../domain/money";
import { formatClockTime, formatDate, formatDuration } from "../domain/time";
import {
  goalLabels,
  type AppLanguage,
  type CurrencyCode,
} from "../domain/types";
import { translate, type TranslationKey } from "../i18n";
import { useCurrentTime } from "../lib/clock";
import { useAppStore } from "../lib/state";
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
} from "../components/CommonVisuals";

function label(
  language: AppLanguage,
  key: TranslationKey<"workspace">,
): string {
  return translate(language, "workspace", key);
}

const analyticsPresets: { id: AnalyticsRangePreset; label: string }[] = [
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "1y", label: "1Y" },
];

function AnalyticsPage() {
  const { state } = useAppStore();
  const app = state!;
  const account = app.account!;
  const language = account.language;
  const [preset, setPreset] = useState<AnalyticsRangePreset>("30d");
  const clock = useCurrentTime(true, 60_000);
  const {
    range,
    summary,
    series,
    cumulative,
    comparison,
    projects,
    efficiency,
    durations,
    foreign,
    dailyRates,
    overlap,
  } = useMemo(() => {
    const nextRange = resolveRange(preset, account.timezone, clock);
    const nextSeries = rangeDailySeries(
      app.sessions,
      account.currency,
      nextRange,
      language,
    );
    const scoped = app.sessions.filter(
      (session) =>
        session.status === "completed" &&
        sessionContribution(session, nextRange).activeMs > 0,
    );
    return {
      range: nextRange,
      summary: rangeSummary(app.sessions, account.currency, nextRange),
      series: nextSeries,
      cumulative: cumulativeSeries(nextSeries),
      comparison: periodComparison(app.sessions, account.currency, nextRange),
      projects: projectBreakdown(
        app.sessions,
        app.projects,
        account.currency,
        nextRange,
      ),
      efficiency: projectEfficiencyRanking(
        app.sessions,
        app.projects,
        account.currency,
        nextRange,
      ),
      durations: durationDistribution(app.sessions, nextRange),
      foreign: groupedMoney(scoped.map((session) => session.earnings)).filter(
        (money) => money.currency !== account.currency,
      ),
      overlap: completedSessionOverlapSummary(app.sessions, nextRange),
      dailyRates: nextSeries.map((point) => ({
        label: point.label,
        value:
          point.earningActiveMs < 60_000
            ? 0
            : Math.round(
                point.earningsMinor / (point.earningActiveMs / 3_600_000),
              ),
      })),
    };
  }, [
    account.currency,
    account.timezone,
    app.projects,
    app.sessions,
    clock,
    language,
    preset,
  ]);
  const rangeLabel = analyticsRangeLabel(preset, language);
  return (
    <>
      <div className="page-heading heading-with-action">
        <div>
          <span className="eyebrow">
            {language === "vi"
              ? "THẤY XU HƯỚNG, KHÔNG ĐOÁN MÒ"
              : "SEE PATTERNS, NOT GUESSWORK"}
          </span>
          <h1>{label(language, "analytics")}</h1>
          <p>
            {language === "vi"
              ? "Số liệu cắt theo đúng phạm vi và múi giờ tài khoản; tiền luôn giữ ở nguyên tệ."
              : "Figures are clipped to the selected range and account timezone; money stays in its original currency."}
          </p>
        </div>
        <div className="range-switch">
          {analyticsPresets.map((item) => (
            <button
              key={item.id}
              onClick={() => setPreset(item.id)}
              className={preset === item.id ? "active" : ""}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <section className="metric-grid analytics-metrics">
        <MetricCard
          icon={<Clock3 />}
          label={language === "vi" ? "Tổng giờ hiệu dụng" : "Active work time"}
          value={formatDuration(summary.activeMs, true, language)}
          hint={rangeLabel}
          tone="blue"
        />
        <MetricCard
          icon={<CircleDollarSign />}
          label={
            language === "vi" ? "Thu nhập nguyên gốc" : "Original earnings"
          }
          value={formatMoney(
            { amountMinor: summary.earningsMinor, currency: account.currency },
            language,
          )}
          hint={`${account.currency} · ${formatMoney({ amountMinor: Math.round(summary.averageEarningsMinorPerDay), currency: account.currency }, language)} / ${language === "vi" ? "ngày" : "day"}`}
          tone="green"
        />
        <MetricCard
          icon={<TrendingUp />}
          label={label(language, "efficiency")}
          value={
            summary.effectiveHourlyMinor === null
              ? "—"
              : formatMoney(
                  {
                    amountMinor: summary.effectiveHourlyMinor,
                    currency: account.currency,
                  },
                  language,
                )
          }
          hint={
            summary.effectiveHourlyMinor === null
              ? language === "vi"
                ? "Cần ít nhất 1 phút làm việc"
                : "Needs at least one minute"
              : `${formatDuration(summary.averageActiveMsPerDay, true, language)} / ${language === "vi" ? "ngày" : "day"}`
          }
          tone="violet"
        />
        <MetricCard
          icon={<History />}
          label={label(language, "sessions")}
          value={String(summary.sessionCount)}
          hint={
            language === "vi"
              ? "Có phần thời gian thuộc phạm vi"
              : "Intersecting completed sessions"
          }
          tone="orange"
        />
      </section>
      {overlap.overlapMs > 0 && (
        <OverlapNotice overlap={overlap} language={language} />
      )}
      {foreign.length > 0 && (
        <FxNotice
          foreign={foreign}
          accountCurrency={account.currency}
          language={language}
        />
      )}
      <section className="analytics-grid">
        <ChartCard
          title={language === "vi" ? "Thu nhập theo ngày" : "Daily earnings"}
          subtitle={`${account.currency} · ${rangeLabel}`}
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
        <ChartCard
          title={language === "vi" ? "Giờ làm theo ngày" : "Daily work hours"}
          subtitle={
            language === "vi"
              ? "Chỉ tính thời gian không tạm dừng"
              : "Paused intervals are excluded"
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
        <ChartCard
          title={
            language === "vi"
              ? "Thu nhập / giờ theo ngày"
              : "Daily effective rate"
          }
          subtitle={
            language === "vi"
              ? `Chỉ dùng thời gian của phiên có thu nhập ${account.currency}`
              : `Uses time only from sessions earned in ${account.currency}`
          }
        >
          <TrendChart
            points={dailyRates}
            money
            currency={account.currency}
            language={language}
          />
        </ChartCard>
        <ChartCard
          title={
            language === "vi" ? "Thu nhập tích luỹ" : "Cumulative earnings"
          }
          subtitle={`${account.currency} · ${rangeLabel}`}
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
        <ChartCard
          title={
            language === "vi" ? "Giờ làm tích luỹ" : "Cumulative work hours"
          }
          subtitle={rangeLabel}
        >
          <TrendChart
            points={cumulative.map((point) => ({
              label: point.label,
              value: point.activeMs / 3_600_000,
            }))}
            language={language}
          />
        </ChartCard>
        <ProjectBreakdownCard
          entries={projects}
          language={language}
          currency={account.currency}
          subtitle={rangeLabel}
        />
        <ProjectBreakdownCard
          entries={projects}
          language={language}
          currency={account.currency}
          mode="earnings"
          title={
            language === "vi" ? "Thu nhập theo dự án" : "Earnings by project"
          }
          subtitle={`${account.currency} · ${rangeLabel}`}
        />
        <PeriodComparisonCard
          comparison={comparison}
          language={language}
          title={
            language === "vi"
              ? "So với kỳ trước: thời gian"
              : "Work time vs previous period"
          }
          metric="time"
        />
        <PeriodComparisonCard
          comparison={comparison}
          language={language}
          currency={account.currency}
          title={
            language === "vi"
              ? "So với kỳ trước: thu nhập"
              : "Earnings vs previous period"
          }
          metric="earnings"
        />
        <DurationDistributionCard entries={durations} language={language} />
        <EfficiencyRankingCard
          entries={efficiency}
          language={language}
          currency={account.currency}
        />
        <GoalProgressAnalyticsCard range={range} />
        <InsightsCard
          entries={projects}
          sessionCount={summary.sessionCount}
          comparison={comparison}
        />
      </section>
    </>
  );
}

function OverlapNotice({
  overlap,
  language,
}: {
  overlap: ReturnType<typeof completedSessionOverlapSummary>;
  language: AppLanguage;
}) {
  return (
    <div className="notice overlap-notice" role="status">
      <AlertTriangle size={17} />
      <span>
        {language === "vi"
          ? `${overlap.affectedSessionCount} phiên hoàn tất có thời gian hoạt động chồng nhau (${formatDuration(overlap.overlapMs, true, language)}). Tổng giờ và mục tiêu chỉ tính thời gian duy nhất; thu nhập và phân bổ theo dự án vẫn giữ từng phiên để không làm mất dữ liệu.`
          : `${overlap.affectedSessionCount} completed sessions overlap (${formatDuration(overlap.overlapMs, true, language)}). Total time and goals count each active instant once; earnings and project allocation retain every session so no historical fact is discarded.`}
      </span>
    </div>
  );
}

function FxNotice({
  foreign,
  accountCurrency,
  language,
}: {
  foreign: { amountMinor: number; currency: CurrencyCode }[];
  accountCurrency: CurrencyCode;
  language: AppLanguage;
}) {
  const [status, setStatus] = useState<FxStatus | null>(null);
  const [conversions, setConversions] = useState<
    Record<string, FxConversionResult>
  >({});
  const [refreshing, setRefreshing] = useState(false);
  const foreignJson = JSON.stringify(foreign);
  useEffect(() => {
    const desktop = window.worklyDesktop;
    if (!desktop) return;
    void desktop
      .getFxStatus()
      .then(setStatus)
      .catch(() =>
        setStatus({
          state: "unavailable",
          baseCurrency: accountCurrency,
          provider: "Frankfurter",
          fetchedAt: null,
          sourceDate: null,
          rates: {},
          error: "FX status is unavailable.",
        }),
      );
  }, [accountCurrency]);
  useEffect(() => {
    const desktop = window.worklyDesktop;
    let active = true;
    if (!desktop || !status || status.state === "unavailable") {
      queueMicrotask(() => {
        if (active) setConversions({});
      });
      return () => {
        active = false;
      };
    }
    const source = JSON.parse(foreignJson) as {
      amountMinor: number;
      currency: string;
    }[];
    void Promise.all(
      source.map(
        async (money) =>
          [
            money.currency,
            await desktop.convertMoney(money, accountCurrency),
          ] as const,
      ),
    ).then((results) => {
      if (active) setConversions(Object.fromEntries(results));
    });
    return () => {
      active = false;
    };
  }, [accountCurrency, foreignJson, status]);
  const refresh = () => {
    const desktop = window.worklyDesktop;
    if (!desktop) return;
    setRefreshing(true);
    void desktop
      .refreshFxRates()
      .then(setStatus)
      .finally(() => setRefreshing(false));
  };
  const converted = Object.values(conversions).filter(
    (
      result,
    ): result is FxConversionResult & {
      money: { amountMinor: number; currency: string };
    } => result.ok && Boolean(result.money),
  );
  const source = foreign
    .map((money) => formatMoney(money, language))
    .join(" · ");
  if (!window.worklyDesktop)
    return (
      <div className="notice">
        <Globe2 size={17} />
        <span>
          {language === "vi"
            ? `Có thu nhập ở tiền tệ khác: ${source}. Bản xem trước không truy cập provider FX.`
            : `Other original currencies: ${source}. The preview cannot access the FX provider.`}
        </span>
      </div>
    );
  const unavailable = !status || status.state === "unavailable";
  const updated = status?.fetchedAt
    ? `${formatDate(status.fetchedAt, language)} ${formatClockTime(status.fetchedAt, language)}`
    : null;
  return (
    <div
      className={`notice fx-notice ${status?.state === "stale" ? "stale" : ""}`}
    >
      <Globe2 size={17} />
      <span>
        {unavailable ? (
          language === "vi" ? (
            `Có thu nhập ở tiền tệ khác: ${source}. Chưa có tỷ giá đã xác minh${status?.error ? ` (${status.error})` : ""}; TimeFarm giữ nguyên tiền gốc.`
          ) : (
            `Other original currencies: ${source}. No verified rate is available${status?.error ? ` (${status.error})` : ""}; TimeFarm keeps the original money.`
          )
        ) : (
          <>
            {language === "vi"
              ? `Quy đổi tham khảo sang ${accountCurrency}: `
              : `Reference conversion to ${accountCurrency}: `}
            {converted.length > 0
              ? converted
                  .map((result) =>
                    formatMoney(
                      result.money as {
                        amountMinor: number;
                        currency: CurrencyCode;
                      },
                      language,
                    ),
                  )
                  .join(" · ")
              : language === "vi"
                ? "đang tải…"
                : "loading…"}
            .{" "}
            {language === "vi"
              ? `Nguồn ${status.provider}, ngày dữ liệu ${status.sourceDate ?? "chưa xác định"}, tải lúc ${updated ?? "chưa xác định"}${status.state === "stale" ? " (cache quá 24 giờ, ngày nguồn quá 7 ngày hoặc dữ liệu chưa đủ)" : ""}.`
              : `Source ${status.provider}, data date ${status.sourceDate ?? "unknown"}, fetched ${updated ?? "unknown"}${status.state === "stale" ? " (cache is over 24 hours old, source is over 7 days old, or coverage is incomplete)" : ""}.`}
          </>
        )}{" "}
      </span>
      <button className="text-button" onClick={refresh} disabled={refreshing}>
        {refreshing
          ? language === "vi"
            ? "Đang cập nhật…"
            : "Updating…"
          : language === "vi"
            ? "Cập nhật tỷ giá"
            : "Refresh rates"}
      </button>
    </div>
  );
}

function analyticsRangeLabel(
  preset: AnalyticsRangePreset,
  language: AppLanguage,
): string {
  const labels =
    language === "vi"
      ? {
          "7d": "7 ngày gần nhất",
          "30d": "30 ngày gần nhất",
          "1m": "tháng hiện tại",
          "3m": "3 tháng lịch",
          "6m": "6 tháng lịch",
          "1y": "12 tháng lịch",
        }
      : {
          "7d": "last 7 days",
          "30d": "last 30 days",
          "1m": "current month",
          "3m": "3 calendar months",
          "6m": "6 calendar months",
          "1y": "12 calendar months",
        };
  return labels[preset];
}

function DurationDistributionCard({
  entries,
  language,
}: {
  entries: ReturnType<typeof durationDistribution>;
  language: AppLanguage;
}) {
  const max = Math.max(...entries.map((entry) => entry.count), 1);
  return (
    <article className="panel distribution-card">
      <div className="panel-heading">
        <div>
          <h3>
            {language === "vi"
              ? "Phân bố thời lượng phiên"
              : "Session duration distribution"}
          </h3>
          <p>
            {language === "vi"
              ? "Mỗi phiên được xếp theo phần thuộc phạm vi"
              : "Sessions are bucketed by in-range active time"}
          </p>
        </div>
        <Clock3 size={18} />
      </div>
      <div className="bar-list">
        {entries.map((entry) => (
          <div key={entry.id}>
            <span>{entry.label}</span>
            <i>
              <b style={{ width: `${(entry.count / max) * 100}%` }} />
            </i>
            <strong>{entry.count}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function EfficiencyRankingCard({
  entries,
  language,
  currency,
}: {
  entries: ReturnType<typeof projectEfficiencyRanking>;
  language: AppLanguage;
  currency: CurrencyCode;
}) {
  const { state } = useAppStore();
  const projects = state!.projects;
  return (
    <article className="panel efficiency-card">
      <div className="panel-heading">
        <div>
          <h3>
            {language === "vi"
              ? "Hiệu suất dự án"
              : "Project efficiency ranking"}
          </h3>
          <p>
            {language === "vi"
              ? "Chỉ so sánh thu nhập cùng nguyên tệ"
              : "Rates use matching original currency only"}
          </p>
        </div>
        <TrendingUp size={18} />
      </div>
      {entries.length === 0 ? (
        <EmptyState
          compact
          icon={<TrendingUp />}
          title={
            language === "vi" ? "Chưa đủ dữ liệu" : "No efficiency data yet"
          }
          description={
            language === "vi"
              ? "Hoàn tất phiên có thu nhập để xem xếp hạng."
              : "Complete a session with earnings to see a ranking."
          }
        />
      ) : (
        <div className="ranking-list">
          {entries.slice(0, 5).map((entry, index) => {
            const project = entry.projectId
              ? projects.find((item) => item.id === entry.projectId)
              : undefined;
            return (
              <div key={entry.projectId ?? "none"}>
                <span className="rank-number">{index + 1}</span>
                <span
                  className="color-dot"
                  style={{ background: entry.color }}
                  aria-hidden="true"
                />
                <strong>
                  <span
                    className="inline-project-glyph"
                    aria-hidden="true"
                    style={{ color: entry.color }}
                  >
                    <ProjectGlyph icon={project?.icon} size={14} />
                  </span>{" "}
                  {entry.name || label(language, "noProject")}
                </strong>
                <small>{formatDuration(entry.activeMs, true, language)}</small>
                <b>
                  {entry.effectiveHourlyMinor === null
                    ? "—"
                    : formatMoney(
                        { amountMinor: entry.effectiveHourlyMinor, currency },
                        language,
                      )}
                </b>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function GoalProgressAnalyticsCard({ range }: { range: AnalyticsRange }) {
  const { state } = useAppStore();
  const app = state!;
  const account = app.account!;
  const language = account.language;
  const now = new Date(range.endMs);
  return (
    <article className="panel analytics-goals">
      <div className="panel-heading">
        <div>
          <h3>{language === "vi" ? "Tiến độ mục tiêu" : "Goal progress"}</h3>
          <p>
            {language === "vi"
              ? "Mục tiêu theo nhịp hiện tại"
              : "Goals against the current pace"}
          </p>
        </div>
        <Target size={18} />
      </div>
      {app.goals.length === 0 ? (
        <EmptyState
          compact
          icon={<Target />}
          title={language === "vi" ? "Chưa có mục tiêu" : "No goals yet"}
          description={
            language === "vi"
              ? "Tạo mục tiêu ở dashboard để theo dõi tiến độ."
              : "Create a goal from the dashboard to track progress."
          }
        />
      ) : (
        <div className="analytics-goal-list">
          {app.goals.slice(0, 4).map((goal) => {
            const progress = calculateGoalProgress(
              goal,
              app.sessions,
              app.projects,
              account.currency,
              now,
              account.timezone,
            );
            return (
              <div key={goal.id}>
                <div>
                  <strong>{goalLabels[goal.kind][language]}</strong>
                  <span className={`goal-status ${progress.status}`}>
                    {goalStatusLabel(progress.status, language)}
                  </span>
                </div>
                <i>
                  <b style={{ width: `${progress.percentage}%` }} />
                </i>
                <small>
                  {formatGoalProgressValue(
                    progress.current,
                    progress.target,
                    goalUnit(goal.kind),
                    account.currency,
                    language,
                  )}{" "}
                  ·{" "}
                  {formatGoalRemaining(
                    progress.remaining,
                    goalUnit(goal.kind),
                    account.currency,
                    language,
                  )}
                </small>
                <GoalPace
                  progress={progress}
                  unit={goalUnit(goal.kind)}
                  currency={account.currency}
                  timezone={account.timezone}
                  language={language}
                />
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function InsightsCard({
  entries,
  sessionCount,
  comparison,
}: {
  entries: ReturnType<typeof projectBreakdown>;
  sessionCount: number;
  comparison: ReturnType<typeof periodComparison>;
}) {
  const { state } = useAppStore();
  const language = state!.account!.language;
  const top = entries[0];
  const change = comparison.activeMsChange;
  return (
    <article className="panel insights-card">
      <div className="panel-heading">
        <div>
          <h3>
            {language === "vi"
              ? "Nhận định từ dữ liệu"
              : "Data-backed observations"}
          </h3>
          <p>
            {language === "vi"
              ? "Không suy diễn khi chưa đủ dữ liệu"
              : "No claims when data is insufficient"}
          </p>
        </div>
        <TrendingUp size={18} />
      </div>
      {sessionCount < 2 ? (
        <EmptyState
          compact
          icon={<BarChart3 />}
          title={language === "vi" ? "Cần thêm dữ liệu" : "Need more data"}
          description={
            language === "vi"
              ? "Hoàn tất ít nhất hai phiên để nhận các nhận định hữu ích."
              : "Complete at least two sessions to surface useful observations."
          }
        />
      ) : (
        <div className="insight">
          <span className="insight-dot" />
          <p>
            {top ? (
              language === "vi" ? (
                <>
                  <strong>{top.name}</strong> đang chiếm nhiều thời gian nhất
                  trong phạm vi này:{" "}
                  <strong>
                    {formatDuration(top.activeMs, true, language)}
                  </strong>
                  {change === null ? (
                    "."
                  ) : (
                    <>
                      ; tổng thời gian {change >= 0 ? "tăng" : "giảm"}{" "}
                      <strong>{Math.abs(change).toFixed(0)}%</strong> so với kỳ
                      trước.
                    </>
                  )}
                </>
              ) : (
                <>
                  <strong>{top.name}</strong> accounts for the most time in this
                  range:{" "}
                  <strong>
                    {formatDuration(top.activeMs, true, language)}
                  </strong>
                  {change === null ? (
                    "."
                  ) : (
                    <>
                      ; total work time is{" "}
                      <strong>{Math.abs(change).toFixed(0)}%</strong>{" "}
                      {change >= 0 ? "higher" : "lower"} than the prior period.
                    </>
                  )}
                </>
              )
            ) : language === "vi" ? (
              "Chưa có phân bổ dự án rõ ràng trong phạm vi này."
            ) : (
              "No project distribution is available for this period."
            )}
          </p>
        </div>
      )}
    </article>
  );
}

export default AnalyticsPage;
