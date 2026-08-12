import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  CircleDollarSign,
  Clock3,
  LoaderCircle,
  Play,
  Plus,
  Square,
  Target,
} from "lucide-react";
import { goalTargetIssue } from "../domain/goals";
import { formatMoney, moneyFromInput, moneyToInput } from "../domain/money";
import {
  activeDurationMs,
  formatClockTime,
  formatDate,
  formatDateTimeLocalInput,
  formatDuration,
} from "../domain/time";
import {
  currencyMetadata,
  goalLabels,
  paymentModelLabels,
  type AppLanguage,
  type CurrencyCode,
  type Goal,
  type GoalKind,
  type Payment,
  type PaymentModel,
  type Project,
  type WorkSession,
} from "../domain/types";
import type { CompletedSessionInput, NewProjectInput } from "../lib/state";
import { translate, type TranslationKey } from "../i18n";
import { useCurrentTime } from "../lib/clock";
import { useAppStore } from "../lib/state";
import { ProjectGlyph } from "./CommonVisuals";
import { Field, Modal } from "./Modal";

function label(
  language: AppLanguage,
  key: TranslationKey<"workspace">,
): string {
  return translate(language, "workspace", key);
}

function localizedMutationError(
  language: AppLanguage,
  vietnameseSummary: string,
  englishSummary: string,
  detail?: unknown,
): string {
  const summary = language === "vi" ? vietnameseSummary : englishSummary;
  const detailMessage =
    detail instanceof Error
      ? detail.message
      : typeof detail === "string"
        ? detail
        : "";
  return detailMessage ? `${summary} ${detailMessage}` : summary;
}

function StartSessionDialog({
  onClose,
  onStarted,
}: {
  onClose: () => void;
  onStarted: () => void;
}) {
  const { state, startSession, createProjectAndStartSession } = useAppStore();
  const app = state!;
  const language = app.account!.language;
  const [selected, setSelected] = useState<string | undefined>();
  const [quick, setQuick] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const startInFlightRef = useRef(false);
  const start = async () => {
    if (startInFlightRef.current) return;
    if (quick && !name.trim()) {
      setMessage(
        language === "vi"
          ? "Nhập tên dự án trước."
          : "Enter a project name first.",
      );
      return;
    }
    startInFlightRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = quick
        ? await createProjectAndStartSession({
            name,
            paymentModel: "per_session",
            expectedCurrency: app.account!.currency,
            color: "#0f9889",
            icon: "✦",
          })
        : await startSession(selected);
      if (!result.ok) {
        setMessage(
          localizedMutationError(
            language,
            "Không thể bắt đầu phiên.",
            "The session could not be started.",
            result.message,
          ),
        );
        return;
      }
      onStarted();
    } catch (startError) {
      setMessage(
        localizedMutationError(
          language,
          "Không thể bắt đầu phiên.",
          "The session could not be started.",
          startError,
        ),
      );
    } finally {
      startInFlightRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        language === "vi" ? "Bắt đầu phiên làm việc" : "Start a work session"
      }
      subtitle={
        language === "vi"
          ? "Chọn nơi bạn sẽ dành thời gian. Bạn có thể làm việc không gắn dự án."
          : "Choose where you will spend this time. An unassigned session is always okay."
      }
      onClose={onClose}
      locked={busy}
    >
      <div className="project-picker">
        <button
          disabled={busy}
          className={`project-option ${selected === undefined && !quick ? "selected" : ""}`}
          onClick={() => {
            setSelected(undefined);
            setQuick(false);
          }}
        >
          <span className="project-icon neutral">
            <ProjectGlyph />
          </span>
          <div>
            <strong>{label(language, "noProject")}</strong>
            <span>
              {language === "vi" ? "Phiên độc lập" : "Independent session"}
            </span>
          </div>
          {selected === undefined && !quick && <Check size={18} />}
        </button>
        {app.projects
          .filter((project) => project.status !== "completed")
          .map((project) => (
            <button
              disabled={busy}
              key={project.id}
              className={`project-option ${selected === project.id && !quick ? "selected" : ""}`}
              onClick={() => {
                setSelected(project.id);
                setQuick(false);
              }}
            >
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
                <strong>{project.name}</strong>
                <span>
                  {paymentModelLabels[project.paymentModel][language]}
                </span>
              </div>
              {selected === project.id && !quick && <Check size={18} />}
            </button>
          ))}
      </div>
      {quick ? (
        <div className="quick-project">
          <Field
            label={language === "vi" ? "Tên dự án nhanh" : "Quick project name"}
          >
            <input
              data-autofocus
              disabled={busy}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={
                language === "vi"
                  ? "Ví dụ: Video tháng 8"
                  : "For example: August video"
              }
            />
          </Field>
        </div>
      ) : (
        <button
          disabled={busy}
          className="text-button add-project"
          onClick={() => {
            setQuick(true);
            setSelected(undefined);
          }}
        >
          <Plus size={16} />{" "}
          {language === "vi" ? "Tạo dự án nhanh" : "Create project quickly"}
        </button>
      )}
      {message && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
      <div className="modal-actions">
        <button disabled={busy} className="button ghost" onClick={onClose}>
          {label(language, "cancel")}
        </button>
        <button
          disabled={busy}
          className="button start-action"
          onClick={() => {
            void start();
          }}
        >
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <Play size={17} fill="currentColor" />
          )}{" "}
          {busy
            ? language === "vi"
              ? "Đang bắt đầu…"
              : "Starting…"
            : label(language, "start")}
        </button>
      </div>
    </Modal>
  );
}

function CompleteSessionDialog({
  session,
  requestedEndAt,
  onClose,
}: {
  session: WorkSession;
  requestedEndAt?: string;
  onClose: () => void;
}) {
  const { state, completeSession } = useAppStore();
  const app = state!;
  const language = app.account!.language;
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>(app.account!.currency);
  const [note, setNote] = useState("");
  const now = useCurrentTime();
  const project = app.projects.find((item) => item.id === session.projectId);
  const endAt = requestedEndAt ?? new Date(now).toISOString();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitInFlightRef = useRef(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await completeSession(
        session.id,
        { amount, currency, note },
        requestedEndAt,
      );
      if (!result.ok) {
        setError(
          localizedMutationError(
            language,
            "Không thể hoàn tất phiên.",
            "The session could not be completed.",
            result.message,
          ),
        );
        return;
      }
      onClose();
    } catch (completionError) {
      setError(
        localizedMutationError(
          language,
          "Không thể hoàn tất phiên.",
          "The session could not be completed.",
          completionError,
        ),
      );
    } finally {
      submitInFlightRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        language === "vi" ? "Chốt phiên làm việc" : "Complete work session"
      }
      subtitle={
        language === "vi"
          ? "Ghi lại số tiền thực nhận. Bạn có thể nhập 0."
          : "Record the money you actually earned. Zero is valid."
      }
      onClose={onClose}
      locked={busy}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <div className="completion-summary">
          <span>
            <ProjectGlyph icon={project?.icon} size={18} />
          </span>
          <div>
            <strong>{project?.name ?? label(language, "noProject")}</strong>
            <p>
              {formatClockTime(session.startedAt, language, session.timezone)} —{" "}
              {formatClockTime(endAt, language, session.timezone)} ·{" "}
              {formatDuration(
                activeDurationMs({
                  ...session,
                  endedAt: endAt,
                  status: "completed",
                }),
                true,
                language,
              )}
            </p>
          </div>
        </div>
        {requestedEndAt && (
          <p className="form-hint">
            <Clock3 size={15} />{" "}
            {language === "vi"
              ? "Đang dùng thời điểm kết thúc bạn chọn khi khôi phục phiên."
              : "Using the end time you chose during recovery."}
          </p>
        )}
        {project && (
          <p className="payment-context">
            <CircleDollarSign size={15} />{" "}
            {language === "vi"
              ? `Dự án dùng mô hình: ${paymentModelLabels[project.paymentModel][language]}. Thu nhập phiên này không làm thay đổi lịch sử thanh toán dự án.`
              : `Project model: ${paymentModelLabels[project.paymentModel][language]}. This session earning never changes the project payment history.`}
          </p>
        )}
        <div className="form-grid money-grid">
          <Field
            label={language === "vi" ? "Thu nhập thực nhận" : "Actual earnings"}
          >
            <input
              type="number"
              min="0"
              step="any"
              data-autofocus
              disabled={busy}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
              required
            />
          </Field>
          <Field label={language === "vi" ? "Tiền tệ" : "Currency"}>
            <select
              disabled={busy}
              value={currency}
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
        <Field
          label={
            language === "vi" ? "Ghi chú (không bắt buộc)" : "Note (optional)"
          }
        >
          <textarea
            disabled={busy}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              language === "vi"
                ? "Bạn đã hoàn thành điều gì?"
                : "What did you accomplish?"
            }
            rows={3}
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <p className="form-hint">
          <Check size={15} />{" "}
          {language === "vi"
            ? "Sau khi lưu, phiên sẽ cập nhật dashboard và được đánh dấu chờ đồng bộ."
            : "Once saved, this session updates your dashboard and is marked ready for sync."}
        </p>
        <div className="modal-actions">
          <button
            type="button"
            className="button ghost"
            disabled={busy}
            onClick={onClose}
          >
            {label(language, "back")}
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Check size={17} />
            )}{" "}
            {busy
              ? language === "vi"
                ? "Đang lưu…"
                : "Saving…"
              : language === "vi"
                ? "Lưu phiên"
                : "Save session"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectDialog({
  project,
  onClose,
}: {
  project?: Project;
  onClose: () => void;
}) {
  const { state, createProject, updateProject } = useAppStore();
  const app = state!;
  const language = app.account!.language;
  const [name, setName] = useState(project?.name ?? "");
  const [paymentModel, setPaymentModel] = useState<PaymentModel>(
    project?.paymentModel ?? "per_session",
  );
  const [expectedAmount, setExpectedAmount] = useState(
    moneyToInput(project?.expectedMoney),
  );
  const [currency, setCurrency] = useState<CurrencyCode>(
    project?.expectedMoney?.currency ?? app.account!.currency,
  );
  const [note, setNote] = useState(project?.note ?? "");
  const [color, setColor] = useState(project?.color ?? "#7c3aed");
  const [icon, setIcon] = useState(project?.icon ?? "✦");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitInFlightRef = useRef(false);
  const input = (): NewProjectInput => ({
    name,
    paymentModel,
    expectedAmount,
    expectedCurrency: currency,
    note,
    color,
    icon,
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitInFlightRef.current) return;
    if (!name.trim()) {
      setError(
        language === "vi"
          ? "Tên dự án là bắt buộc."
          : "Project name is required.",
      );
      return;
    }
    submitInFlightRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = project
        ? await updateProject(project.id, input())
        : await createProject(input());
      if (!result.ok) {
        setError(
          localizedMutationError(
            language,
            project ? "Không thể cập nhật dự án." : "Không thể tạo dự án.",
            project
              ? "The project could not be updated."
              : "The project could not be created.",
            result.message,
          ),
        );
        return;
      }
      onClose();
    } catch (projectError) {
      setError(
        localizedMutationError(
          language,
          project ? "Không thể cập nhật dự án." : "Không thể tạo dự án.",
          project
            ? "The project could not be updated."
            : "The project could not be created.",
          projectError,
        ),
      );
    } finally {
      submitInFlightRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        project
          ? language === "vi"
            ? "Chỉnh sửa dự án"
            : "Edit project"
          : language === "vi"
            ? "Tạo dự án"
            : "Create project"
      }
      subtitle={
        language === "vi"
          ? "Thông tin thanh toán không thay thế thu nhập thực tế của từng phiên."
          : "Payment context never replaces the actual earnings recorded per session."
      }
      onClose={onClose}
      locked={busy}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <Field label={language === "vi" ? "Tên dự án" : "Project name"}>
          <input
            data-autofocus
            disabled={busy}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={
              language === "vi"
                ? "Ví dụ: Thiết kế thương hiệu Acme"
                : "For example: Acme brand design"
            }
          />
        </Field>
        <Field
          label={language === "vi" ? "Cách nhận thanh toán" : "Payment model"}
        >
          <select
            disabled={busy}
            value={paymentModel}
            onChange={(event) =>
              setPaymentModel(event.target.value as PaymentModel)
            }
          >
            {Object.entries(paymentModelLabels).map(([value, text]) => (
              <option key={value} value={value}>
                {text[language]}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid money-grid">
          <Field
            label={
              language === "vi"
                ? "Tiền kỳ vọng (tùy chọn)"
                : "Expected money (optional)"
            }
          >
            <input
              disabled={busy}
              type="number"
              min="0"
              step="any"
              value={expectedAmount}
              onChange={(event) => setExpectedAmount(event.target.value)}
            />
          </Field>
          <Field label={language === "vi" ? "Tiền tệ" : "Currency"}>
            <select
              disabled={busy}
              value={currency}
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
        <Field
          label={language === "vi" ? "Ghi chú (tùy chọn)" : "Note (optional)"}
        >
          <textarea
            disabled={busy}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label={language === "vi" ? "Màu nhận diện" : "Project color"}>
            <div className="color-picker">
              {[
                "#7c3aed",
                "#2563eb",
                "#059669",
                "#ea580c",
                "#db2777",
                "#0f766e",
              ].map((value) => (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={value}
                  key={value}
                  className={color === value ? "selected" : ""}
                  style={{ background: value }}
                  onClick={() => setColor(value)}
                >
                  {color === value && <Check size={14} />}
                </button>
              ))}
            </div>
          </Field>
          <Field label={language === "vi" ? "Biểu tượng" : "Icon"}>
            <div className="icon-picker">
              {["✦", "◈", "◌", "◆", "△", "☼"].map((value) => (
                <button
                  type="button"
                  disabled={busy}
                  key={value}
                  className={icon === value ? "selected" : ""}
                  onClick={() => setIcon(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </Field>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button ghost"
            disabled={busy}
            onClick={onClose}
          >
            {label(language, "cancel")}
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Check size={17} />
            )}{" "}
            {busy
              ? language === "vi"
                ? "Đang lưu…"
                : "Saving…"
              : project
                ? label(language, "save")
                : label(language, "create")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentDialog({
  project,
  payment,
  onClose,
  onEditPayment,
}: {
  project: Project;
  payment?: Payment;
  onClose: () => void;
  onEditPayment: (payment: Payment) => void;
}) {
  const { state, recordPayment, updatePayment, deletePayment } = useAppStore();
  const app = state!;
  const language = app.account!.language;
  const [amount, setAmount] = useState(moneyToInput(payment?.money));
  const [currency, setCurrency] = useState<CurrencyCode>(
    payment?.money.currency ??
      project.expectedMoney?.currency ??
      app.account!.currency,
  );
  const [kind, setKind] = useState<"completion" | "progressive">(
    payment?.kind ??
      (project.paymentModel === "on_completion" ? "completion" : "progressive"),
  );
  const [receivedAt, setReceivedAt] = useState(
    payment ? formatDateTimeLocalInput(payment.receivedAt) : "",
  );
  const [note, setNote] = useState(payment?.note ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const payments = app.payments
    .filter((entry) => entry.projectId === project.id)
    .sort(
      (a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const date = receivedAt ? new Date(receivedAt) : null;
    if (date && !Number.isFinite(date.getTime())) {
      setError(
        language === "vi"
          ? "Thời điểm thanh toán không hợp lệ."
          : "Payment date is invalid.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const input = {
        projectId: project.id,
        amount,
        currency,
        kind,
        note,
        ...(date ? { receivedAt: date.toISOString() } : {}),
      };
      const result = payment
        ? await updatePayment(payment.id, input)
        : await recordPayment(input);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const removePayment = async (paymentId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await deletePayment(paymentId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError("");
      setPendingDeleteId(null);
      if (payment?.id === paymentId) onClose();
    } finally {
      setBusy(false);
    }
  };
  const title = payment
    ? language === "vi"
      ? "Chỉnh sửa thanh toán"
      : "Edit payment"
    : language === "vi"
      ? "Ghi nhận thanh toán"
      : "Record payment";
  return (
    <Modal
      title={title}
      subtitle={
        language === "vi"
          ? `${project.name} · Khoản thanh toán dự án luôn tách riêng khỏi thu nhập theo phiên.`
          : `${project.name} · Project payments remain separate from per-session earnings.`
      }
      onClose={onClose}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <div className="form-grid money-grid">
          <Field
            label={language === "vi" ? "Số tiền thực nhận" : "Amount received"}
          >
            <input
              type="number"
              min="0"
              step="any"
              data-autofocus
              disabled={busy}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
              required
            />
          </Field>
          <Field label={language === "vi" ? "Tiền tệ" : "Currency"}>
            <select
              disabled={busy}
              value={currency}
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
        <Field label={language === "vi" ? "Loại thanh toán" : "Payment type"}>
          <select
            disabled={busy}
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as "completion" | "progressive")
            }
          >
            <option value="progressive">
              {language === "vi"
                ? "Thanh toán theo đợt"
                : "Progressive payment"}
            </option>
            <option value="completion">
              {language === "vi"
                ? "Thanh toán khi hoàn thành"
                : "Completion payment"}
            </option>
          </select>
        </Field>
        <Field
          label={
            language === "vi"
              ? "Thời điểm nhận (tùy chọn)"
              : "Received at (optional)"
          }
        >
          <input
            disabled={busy}
            type="datetime-local"
            value={receivedAt}
            onChange={(event) => setReceivedAt(event.target.value)}
          />
        </Field>
        <Field
          label={language === "vi" ? "Ghi chú (tùy chọn)" : "Note (optional)"}
        >
          <textarea
            disabled={busy}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              language === "vi"
                ? "Ví dụ: đợt 2 sau khi bàn giao"
                : "For example: second delivery milestone"
            }
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="payment-history">
          <strong>
            {language === "vi" ? "Lịch sử thanh toán" : "Payment history"}
          </strong>
          {payments.length === 0 ? (
            <p>
              {language === "vi"
                ? "Chưa có khoản thanh toán nào."
                : "No payments have been recorded."}
            </p>
          ) : (
            payments.map((entry) => (
              <div className="payment-history-row" key={entry.id}>
                <span>
                  {formatDate(
                    entry.receivedAt,
                    language,
                    app.account!.timezone,
                  )}
                </span>
                <strong>{formatMoney(entry.money, language)}</strong>
                <small>
                  {entry.kind === "completion"
                    ? language === "vi"
                      ? "Hoàn tất dự án"
                      : "Completion"
                    : language === "vi"
                      ? "Theo đợt"
                      : "Progressive"}
                  {entry.note ? ` · ${entry.note}` : ""}
                </small>
                <span
                  style={{ gridColumn: "1 / -1", display: "flex", gap: 10 }}
                >
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => onEditPayment(entry)}
                  >
                    {label(language, "edit")}
                  </button>
                  {pendingDeleteId === entry.id ? (
                    <>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => setPendingDeleteId(null)}
                      >
                        {label(language, "cancel")}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        style={{ color: "var(--danger)" }}
                        onClick={() => {
                          void removePayment(entry.id);
                        }}
                      >
                        {busy
                          ? language === "vi"
                            ? "Đang xóa…"
                            : "Deleting…"
                          : language === "vi"
                            ? "Xác nhận xóa"
                            : "Confirm delete"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      style={{ color: "var(--danger)" }}
                      onClick={() => setPendingDeleteId(entry.id)}
                    >
                      {language === "vi" ? "Xóa" : "Delete"}
                    </button>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="button ghost"
            disabled={busy}
            onClick={onClose}
          >
            {label(language, "cancel")}
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <CircleDollarSign size={17} />
            )}{" "}
            {busy
              ? language === "vi"
                ? "Đang lưu…"
                : "Saving…"
              : payment
                ? language === "vi"
                  ? "Cập nhật thanh toán"
                  : "Update payment"
                : language === "vi"
                  ? "Lưu khoản thanh toán"
                  : "Save payment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GoalDialog({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const { state, createGoal, updateGoal } = useAppStore();
  const app = state!;
  const language = app.account!.language;
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? "hours_daily");
  const [target, setTarget] = useState(() =>
    goal
      ? goalLabels[goal.kind].unit === "money"
        ? moneyToInput({
            amountMinor: goal.target,
            currency: app.account!.currency,
          })
        : String(goal.target)
      : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitInFlightRef = useRef(false);
  const unit = goalLabels[kind].unit;
  const updateKind = (next: GoalKind) => {
    if (goalLabels[next].unit !== unit) setTarget("");
    setKind(next);
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitInFlightRef.current) return;
    const numeric = Number(target);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError(
        language === "vi"
          ? "Mục tiêu phải lớn hơn 0."
          : "Goal target must be greater than zero.",
      );
      return;
    }
    submitInFlightRef.current = true;
    setBusy(true);
    setError("");
    try {
      const stored =
        unit === "money"
          ? moneyFromInput(target, app.account!.currency).amountMinor
          : numeric;
      const targetIssue = goalTargetIssue(kind, stored);
      if (targetIssue) {
        setError(
          language === "vi"
            ? targetIssue === "project_count_not_integer"
              ? "Mục tiêu dự án phải là một số nguyên."
              : targetIssue === "not_safe_integer"
                ? "Mục tiêu vượt phạm vi số an toàn hoặc không phải đơn vị tiền nguyên."
                : "Mục tiêu phải lớn hơn 0."
            : targetIssue === "project_count_not_integer"
              ? "A project goal must be a whole number."
              : targetIssue === "not_safe_integer"
                ? "The target exceeds the safe numeric range or is not a whole minor-unit amount."
                : "Goal target must be greater than zero.",
        );
        return;
      }
      const result = goal
        ? await updateGoal(goal.id, kind, stored)
        : await createGoal(kind, stored);
      if (!result.ok) {
        setError(
          localizedMutationError(
            language,
            goal ? "Không thể cập nhật mục tiêu." : "Không thể tạo mục tiêu.",
            goal
              ? "The goal could not be updated."
              : "The goal could not be created.",
            result.message,
          ),
        );
        return;
      }
      onClose();
    } catch (goalError) {
      setError(
        localizedMutationError(
          language,
          goal ? "Không thể cập nhật mục tiêu." : "Không thể tạo mục tiêu.",
          goal
            ? "The goal could not be updated."
            : "The goal could not be created.",
          goalError,
        ),
      );
    } finally {
      submitInFlightRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        goal
          ? language === "vi"
            ? "Chỉnh sửa mục tiêu"
            : "Edit goal"
          : language === "vi"
            ? "Tạo mục tiêu"
            : "Create goal"
      }
      subtitle={
        language === "vi"
          ? "Mục tiêu dùng dữ liệu thực tế, không dùng mức lương cố định."
          : "Goals use your actual data, never a fixed wage."
      }
      onClose={onClose}
      locked={busy}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <Field label={language === "vi" ? "Loại mục tiêu" : "Goal type"}>
          <select
            disabled={busy}
            value={kind}
            onChange={(event) => updateKind(event.target.value as GoalKind)}
          >
            {Object.entries(goalLabels).map(([value, text]) => (
              <option key={value} value={value}>
                {text[language]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={
            language === "vi"
              ? `Mục tiêu (${unit === "hours" ? "giờ" : unit === "money" ? app.account!.currency : "dự án"})`
              : `Target (${unit === "hours" ? "hours" : unit === "money" ? app.account!.currency : "projects"})`
          }
        >
          <input
            type="number"
            data-autofocus
            disabled={busy}
            min={unit === "count" ? "1" : "0.01"}
            step={unit === "count" ? "1" : "any"}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder={
              unit === "hours" ? "4" : unit === "money" ? "1000000" : "1"
            }
            required
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button ghost"
            disabled={busy}
            onClick={onClose}
          >
            {label(language, "cancel")}
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Target size={17} />
            )}{" "}
            {busy
              ? language === "vi"
                ? "Đang lưu…"
                : "Saving…"
              : goal
                ? language === "vi"
                  ? "Cập nhật mục tiêu"
                  : "Update goal"
                : language === "vi"
                  ? "Lưu mục tiêu"
                  : "Save goal"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditSessionDialog({
  session,
  onClose,
}: {
  session: WorkSession;
  onClose: () => void;
}) {
  const { state, editLatestSession } = useAppStore();
  const app = state!;
  const language = app.account!.language;
  const [amount, setAmount] = useState(moneyToInput(session.earnings));
  const [currency, setCurrency] = useState<CurrencyCode>(
    session.earnings?.currency ?? app.account!.currency,
  );
  const [note, setNote] = useState(session.note ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await editLatestSession(session.id, {
        amount,
        currency,
        note,
      } satisfies CompletedSessionInput);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        language === "vi" ? "Chỉnh sửa phiên gần nhất" : "Edit latest session"
      }
      subtitle={
        language === "vi"
          ? "Những phiên cũ hơn được khóa để bảo toàn số liệu lịch sử."
          : "Older sessions are locked to preserve historical integrity."
      }
      onClose={onClose}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <div className="form-grid money-grid">
          <Field
            label={language === "vi" ? "Thu nhập thực nhận" : "Actual earnings"}
          >
            <input
              data-autofocus
              disabled={busy}
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </Field>
          <Field label={language === "vi" ? "Tiền tệ" : "Currency"}>
            <select
              disabled={busy}
              value={currency}
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
        <Field label={language === "vi" ? "Ghi chú" : "Note"}>
          <textarea
            disabled={busy}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button ghost"
            disabled={busy}
            onClick={onClose}
          >
            {label(language, "cancel")}
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Check size={17} />
            )}{" "}
            {busy
              ? language === "vi"
                ? "Đang lưu…"
                : "Saving…"
              : label(language, "save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RecoveryDialog({
  session,
  onContinue,
  onComplete,
}: {
  session: WorkSession;
  onContinue: () => void;
  onComplete: (endedAt?: string) => void;
}) {
  const { state, discardSession } = useAppStore();
  const language = state!.account!.language;
  const [endLocal, setEndLocal] = useState("");
  const [error, setError] = useState("");
  const [lease, setLease] = useState<TimerLeaseStatus | null>(null);
  const [busy, setBusy] = useState<"continue" | "discard" | null>(null);
  const mutationInFlightRef = useRef(false);
  const now = useCurrentTime(true, 60_000);
  useEffect(() => {
    const desktop = window.worklyDesktop;
    if (!desktop) return undefined;
    void desktop
      .getTimerLeaseStatus()
      .then(setLease)
      .catch(() => {});
    return desktop.onTimerLeaseChanged?.(setLease);
  }, []);
  const continueSession = async () => {
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setBusy("continue");
    setError("");
    try {
      const desktop = window.worklyDesktop;
      if (desktop?.acquireTimerLease) {
        const outcome = await desktop.acquireTimerLease();
        setLease(outcome);
        if (outcome.state === "held_by_other") {
          setError(
            language === "vi"
              ? "Một thiết bị khác đang giữ quyền timer cho tài khoản này. Hãy kết thúc hoặc chờ phiên đó trước."
              : "Another device currently holds this account’s timer lease. Finish or wait for that session first.",
          );
          return;
        }
      }
      onContinue();
    } catch (continueError) {
      setError(
        continueError instanceof Error
          ? continueError.message
          : language === "vi"
            ? "Không thể tiếp tục phiên. Vui lòng thử lại."
            : "The session could not be continued. Please try again.",
      );
    } finally {
      mutationInFlightRef.current = false;
      setBusy(null);
    }
  };
  const discard = async () => {
    if (mutationInFlightRef.current) return;
    if (
      window.confirm(
        language === "vi"
          ? "Bỏ phiên đang dở? Thao tác này không thể hoàn tác."
          : "Discard this unfinished session? This cannot be undone.",
      )
    ) {
      mutationInFlightRef.current = true;
      setBusy("discard");
      setError("");
      try {
        const result = await discardSession(session.id);
        if (!result.ok) {
          setError(
            language === "vi"
              ? `Không thể bỏ phiên. ${result.message}`
              : `The session could not be discarded. ${result.message}`,
          );
          return;
        }
        onContinue();
      } catch (discardError) {
        setError(
          discardError instanceof Error
            ? discardError.message
            : language === "vi"
              ? "Không thể bỏ phiên. Vui lòng thử lại."
              : "The session could not be discarded. Please try again.",
        );
      } finally {
        mutationInFlightRef.current = false;
        setBusy(null);
      }
    }
  };
  const completeAtChosenTime = () => {
    if (mutationInFlightRef.current) return;
    const endAt = new Date(endLocal);
    if (
      !endLocal ||
      !Number.isFinite(endAt.getTime()) ||
      endAt.getTime() < Date.parse(session.startedAt)
    ) {
      setError(
        language === "vi"
          ? "Chọn thời điểm kết thúc sau lúc bắt đầu phiên."
          : "Choose an end time after the session started.",
      );
      return;
    }
    if (endAt.getTime() > Date.now()) {
      setError(
        language === "vi"
          ? "Thời điểm kết thúc không được nằm trong tương lai."
          : "Choose an end time that is not in the future.",
      );
      return;
    }
    setError("");
    onComplete(endAt.toISOString());
  };
  return (
    <Modal
      title={
        language === "vi"
          ? "Khôi phục phiên đang dở"
          : "Recover unfinished session"
      }
      subtitle={
        language === "vi"
          ? "TimeFarm tìm thấy một phiên chưa được chốt khi ứng dụng mở lại."
          : "TimeFarm found a session that was not completed before the app reopened."
      }
      onClose={onContinue}
      locked
    >
      <div className="recovery-summary">
        <Clock3 size={24} />
        <div>
          <strong>
            {formatDuration(activeDurationMs(session), true, language)}
          </strong>
          <span>
            {language === "vi"
              ? `Bắt đầu ${formatDate(session.startedAt, language, session.timezone)} lúc ${formatClockTime(session.startedAt, language, session.timezone)}`
              : `Started ${formatDate(session.startedAt, language, session.timezone)} at ${formatClockTime(session.startedAt, language, session.timezone)}`}
          </span>
        </div>
      </div>
      <div className="recovery-options" aria-busy={busy !== null}>
        <button
          type="button"
          className="button primary"
          disabled={busy !== null}
          onClick={() => {
            void continueSession();
          }}
        >
          {busy === "continue" ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <Play size={17} fill="currentColor" />
          )}{" "}
          {language === "vi" ? "Tiếp tục phiên" : "Continue session"}
        </button>
        <button
          type="button"
          className="button ghost"
          disabled={busy !== null}
          onClick={() => onComplete()}
        >
          <Square size={15} fill="currentColor" />{" "}
          {language === "vi" ? "Kết thúc ngay" : "End now"}
        </button>
        <div className="recovery-custom-end">
          <label>
            {language === "vi"
              ? "Hoặc kết thúc tại (múi giờ thiết bị)"
              : "Or end at (device timezone)"}
            <input
              type="datetime-local"
              disabled={busy !== null}
              value={endLocal}
              min={formatDateTimeLocalInput(session.startedAt)}
              max={formatDateTimeLocalInput(new Date(now).toISOString())}
              onChange={(event) => {
                setEndLocal(event.target.value);
                setError("");
              }}
            />
          </label>
          <button
            type="button"
            className="button ghost"
            disabled={busy !== null}
            onClick={completeAtChosenTime}
          >
            <Clock3 size={15} />{" "}
            {language === "vi" ? "Dùng thời điểm này" : "Use this time"}
          </button>
        </div>
        {lease?.state === "held_by_other" && (
          <p className="form-error" role="status" aria-live="polite">
            {language === "vi"
              ? "Thiết bị khác đang giữ timer. Bạn vẫn có thể kết thúc hoặc bỏ phiên local này."
              : "Another device holds the timer. You can still end or discard this local session."}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert" aria-live="assertive">
            {error}
          </p>
        )}
        <button
          type="button"
          className="text-button danger-text"
          disabled={busy !== null}
          onClick={() => {
            void discard();
          }}
        >
          {busy === "discard" && <LoaderCircle size={15} className="spin" />}{" "}
          {language === "vi" ? "Bỏ phiên này" : "Discard session"}
        </button>
      </div>
    </Modal>
  );
}

export {
  StartSessionDialog,
  CompleteSessionDialog,
  ProjectDialog,
  PaymentDialog,
  GoalDialog,
  EditSessionDialog,
  RecoveryDialog,
};
