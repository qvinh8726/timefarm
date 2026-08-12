import { useRef, useState } from "react";
import { Check, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import type {
  AppLanguage,
  Preferences,
  ThemePreference,
} from "../domain/types";
import { translate } from "../i18n";
import { useAppStore, useAppStoreState } from "../lib/state";
import "./account-pages.css";

function workspaceLabel(
  language: AppLanguage,
  key: "profile" | "settings",
): string {
  return translate(language, "workspace", key);
}

function browserWipeConfirmation(language: AppLanguage): string {
  return language === "vi" ? "XÓA" : "WIPE";
}

export function ProfilePage() {
  const { state } = useAppStoreState();
  const app = state!;
  const account = app.account!;
  const language = account.language;
  const avatarLetter =
    Array.from(account.displayName.trim())[0]?.toLocaleUpperCase(language) ??
    "T";

  return (
    <div className="account-page account-profile-page">
      <header className="page-heading account-page-heading">
        <span className="eyebrow">
          {language === "vi" ? "TÀI KHOẢN" : "ACCOUNT"}
        </span>
        <h1>{workspaceLabel(language, "profile")}</h1>
        <p>
          {language === "vi"
            ? "Thông tin nhận diện được tách riêng khỏi số liệu công việc."
            : "Account identity is kept separate from your work data."}
        </p>
      </header>

      <div className="account-profile-sheet">
        <section
          className="account-identity-section"
          aria-labelledby="profile-identity-heading"
        >
          <div className="account-identity-primary">
            <div className="profile-avatar" aria-hidden="true">
              {avatarLetter}
            </div>
            <div className="account-identity-copy">
              <span>
                {language === "vi"
                  ? "Tài khoản local-first"
                  : "Local-first account"}
              </span>
              <h2 id="profile-identity-heading">{account.displayName}</h2>
            </div>
          </div>
          <dl className="account-profile-facts">
            <div>
              <dt>{language === "vi" ? "Quốc gia" : "Country"}</dt>
              <dd>{account.country}</dd>
            </div>
            <div>
              <dt>{language === "vi" ? "Múi giờ" : "Timezone"}</dt>
              <dd>{account.timezone}</dd>
            </div>
            <div>
              <dt>
                {language === "vi" ? "Tiền tệ tài khoản" : "Account currency"}
              </dt>
              <dd>{account.currency}</dd>
            </div>
          </dl>
        </section>

        <section
          className="account-sync-section"
          aria-labelledby="account-sync-heading"
        >
          <div className="account-sync-heading">
            <span className="account-section-code" aria-hidden="true">
              {language === "vi" ? "01 / ĐỒNG BỘ" : "01 / SYNC"}
            </span>
            <h2 id="account-sync-heading">
              {language === "vi" ? "Đồng bộ tài khoản" : "Account sync"}
            </h2>
          </div>
          <div className="account-sync-copy">
            <p>
              {language === "vi"
                ? "Bản chạy hiện tại giữ dữ liệu trên thiết bị để timer hoạt động offline. Đăng nhập email/Google và đồng bộ cloud cần endpoint Supabase/Auth được cấu hình bằng biến môi trường; chúng không được giả lập trong app local."
                : "This build retains data locally so the timer works offline. Email/Google sign-in and cloud synchronization require a configured Supabase/Auth endpoint and are not faked in the local app."}
            </p>
            <div className="account-sync-note">
              <Check size={18} aria-hidden="true" />
              <span>
                {language === "vi"
                  ? "Dữ liệu phiên, dự án và mục tiêu đã sẵn sàng cho lớp sync outbox."
                  : "Sessions, projects, and goals are backed by a durable sync outbox."}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const {
    state,
    updatePreferences,
    updateLanguage,
    rebuildLocalCache,
    resetLocalData,
  } = useAppStore();
  const app = state!;
  const account = app.account!;
  const language = account.language;
  const [dataAction, setDataAction] = useState<"rebuild" | "wipe" | null>(null);
  const [resetError, setResetError] = useState("");
  const [settingAction, setSettingAction] = useState<
    "theme" | "language" | "mini_timer" | null
  >(null);
  const [settingError, setSettingError] = useState("");
  const [wipeConfirmationOpen, setWipeConfirmationOpen] = useState(false);
  const [wipeConfirmation, setWipeConfirmation] = useState("");
  const mutationInFlightRef = useRef(false);
  const pendingMessage = settingAction
    ? language === "vi"
      ? "Đang lưu cài đặt."
      : "Saving setting."
    : dataAction === "rebuild"
      ? language === "vi"
        ? "Đang dựng lại cache local từ cloud."
        : "Rebuilding the local cache from cloud."
      : dataAction === "wipe"
        ? language === "vi"
          ? "Đang xóa dữ liệu TimeFarm khỏi thiết bị này."
          : "Removing TimeFarm data from this device."
        : "";
  const savePreference = async (
    action: "theme" | "mini_timer",
    partial: Partial<Preferences>,
  ) => {
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setSettingAction(action);
    setSettingError("");
    try {
      const result = await updatePreferences(partial);
      if (!result.ok)
        setSettingError(
          language === "vi"
            ? `Không thể lưu cài đặt. ${result.message}`
            : result.message,
        );
    } finally {
      mutationInFlightRef.current = false;
      setSettingAction(null);
    }
  };
  const saveLanguage = async (nextLanguage: AppLanguage) => {
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setSettingAction("language");
    setSettingError("");
    try {
      const result = await updateLanguage(nextLanguage);
      if (!result.ok)
        setSettingError(
          language === "vi"
            ? `Không thể đổi ngôn ngữ. ${result.message}`
            : result.message,
        );
    } finally {
      mutationInFlightRef.current = false;
      setSettingAction(null);
    }
  };
  const reset = async () => {
    if (
      mutationInFlightRef.current ||
      dataAction ||
      (!window.worklyDesktop?.resetLocalData &&
        wipeConfirmation !== browserWipeConfirmation(language))
    )
      return;
    mutationInFlightRef.current = true;
    setDataAction("wipe");
    setResetError("");
    try {
      const result = await resetLocalData();
      if (!result.ok && !/cancel/i.test(result.message))
        setResetError(result.message);
    } finally {
      mutationInFlightRef.current = false;
      setDataAction(null);
      setWipeConfirmationOpen(false);
      setWipeConfirmation("");
    }
  };
  const rebuild = async () => {
    if (mutationInFlightRef.current || dataAction) return;
    mutationInFlightRef.current = true;
    setDataAction("rebuild");
    setResetError("");
    try {
      const result = await rebuildLocalCache();
      if (!result.ok && !/cancel/i.test(result.message))
        setResetError(result.message);
    } finally {
      mutationInFlightRef.current = false;
      setDataAction(null);
    }
  };
  return (
    <div className="account-page account-settings-page">
      <header className="page-heading account-page-heading">
        <span className="eyebrow">
          {language === "vi"
            ? "TÙY CHỈNH TRẢI NGHIỆM"
            : "PERSONALIZE YOUR EXPERIENCE"}
        </span>
        <h1>{workspaceLabel(language, "settings")}</h1>
        <p>
          {language === "vi"
            ? "Tùy chọn giao diện không thay đổi dữ liệu lịch sử."
            : "Appearance settings never change historical data."}
        </p>
      </header>

      <p
        className="account-live-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {pendingMessage}
      </p>

      <div className="settings-layout account-settings-layout">
        <section
          className="account-settings-section"
          aria-labelledby="appearance-settings-heading"
        >
          <header className="account-settings-section-heading">
            <span className="account-section-code" aria-hidden="true">
              {language === "vi" ? "01 / HIỂN THỊ" : "01 / DISPLAY"}
            </span>
            <h2 id="appearance-settings-heading">
              {language === "vi" ? "Giao diện" : "Appearance"}
            </h2>
          </header>
          <div className="account-settings-rows">
            <div className="account-setting-row">
              <div className="account-setting-label">
                <label htmlFor="settings-theme">
                  {language === "vi" ? "Chủ đề" : "Theme"}
                </label>
                <span id="settings-theme-description">
                  {language === "vi"
                    ? "Theo hệ thống, sáng hoặc tối"
                    : "System, light, or dark"}
                </span>
              </div>
              <div className="account-setting-control">
                {settingAction === "theme" ? (
                  <LoaderCircle size={17} className="spin" aria-hidden="true" />
                ) : null}
                <select
                  id="settings-theme"
                  value={app.preferences.theme}
                  disabled={Boolean(settingAction || dataAction)}
                  aria-describedby="settings-theme-description"
                  aria-busy={settingAction === "theme"}
                  onChange={(event) =>
                    void savePreference("theme", {
                      theme: event.target.value as ThemePreference,
                    })
                  }
                >
                  <option value="system">
                    {language === "vi" ? "Theo hệ thống" : "System"}
                  </option>
                  <option value="light">
                    {language === "vi" ? "Sáng" : "Light"}
                  </option>
                  <option value="dark">
                    {language === "vi" ? "Tối" : "Dark"}
                  </option>
                </select>
              </div>
            </div>
            <div className="account-setting-row">
              <div className="account-setting-label">
                <label htmlFor="settings-language">
                  {language === "vi" ? "Ngôn ngữ" : "Language"}
                </label>
                <span id="settings-language-description">
                  {language === "vi"
                    ? "Có thể đổi bất kỳ lúc nào"
                    : "You can change this at any time"}
                </span>
              </div>
              <div className="account-setting-control">
                {settingAction === "language" ? (
                  <LoaderCircle size={17} className="spin" aria-hidden="true" />
                ) : null}
                <select
                  id="settings-language"
                  value={language}
                  disabled={Boolean(settingAction || dataAction)}
                  aria-describedby="settings-language-description"
                  aria-busy={settingAction === "language"}
                  onChange={(event) =>
                    void saveLanguage(event.target.value as AppLanguage)
                  }
                >
                  <option value="vi">Tiếng Việt</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        <section
          className="account-settings-section"
          aria-labelledby="mini-timer-settings-heading"
        >
          <header className="account-settings-section-heading">
            <span className="account-section-code" aria-hidden="true">
              {language === "vi" ? "02 / MINI TIMER" : "02 / COMPANION"}
            </span>
            <h2 id="mini-timer-settings-heading">Mini timer</h2>
          </header>
          <div className="account-settings-rows">
            <div className="account-setting-row">
              <div className="account-setting-label">
                <label htmlFor="settings-mini-timer">
                  {language === "vi" ? "Chế độ hiển thị" : "Display mode"}
                </label>
                <span id="settings-mini-timer-description">
                  {language === "vi"
                    ? "Interactive cho phép điều khiển; Chỉ xem hoàn toàn click-through; kéo overlay để lưu vị trí."
                    : "Interactive allows controls; View only is fully click-through; drag the overlay to save its position."}
                </span>
              </div>
              <div className="account-setting-control">
                {settingAction === "mini_timer" ? (
                  <LoaderCircle size={17} className="spin" aria-hidden="true" />
                ) : null}
                <select
                  id="settings-mini-timer"
                  value={app.preferences.miniTimerMode}
                  disabled={Boolean(settingAction || dataAction)}
                  aria-describedby="settings-mini-timer-description"
                  aria-busy={settingAction === "mini_timer"}
                  onChange={(event) =>
                    void savePreference("mini_timer", {
                      miniTimerMode: event.target.value as
                        | "interactive"
                        | "view_only"
                        | "hidden",
                    })
                  }
                >
                  <option value="hidden">
                    {language === "vi" ? "Ẩn" : "Hidden"}
                  </option>
                  <option value="view_only">
                    {language === "vi" ? "Chỉ xem" : "View only"}
                  </option>
                  <option value="interactive">
                    {language === "vi" ? "Tương tác" : "Interactive"}
                  </option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {settingError && (
          <p
            className="form-error account-settings-error"
            role="alert"
            aria-live="assertive"
          >
            {settingError}
          </p>
        )}

        <section
          className="account-settings-section account-data-zone"
          aria-labelledby="local-data-heading"
        >
          <header className="account-settings-section-heading">
            <span className="account-section-code" aria-hidden="true">
              {language === "vi" ? "03 / THIẾT BỊ" : "03 / DEVICE"}
            </span>
            <h2 id="local-data-heading">
              {language === "vi" ? "Vùng dữ liệu local" : "Local data zone"}
            </h2>
          </header>
          <div className="account-data-actions">
            <div className="account-data-action">
              <div>
                <h3>
                  {language === "vi"
                    ? "Dựng lại cache từ cloud"
                    : "Rebuild cache from cloud"}
                </h3>
                <p id="rebuild-cache-description">
                  {language === "vi"
                    ? "Chỉ dùng được khi tài khoản đã liên kết đang online, timer đã dừng và mọi thay đổi local đã đồng bộ hoặc được xử lý. TimeFarm xác thực snapshot cloud đầy đủ trước khi thay cache local đã ổn định."
                    : "Available only while the linked account is online, the timer is stopped, and every local change is synced or resolved. TimeFarm validates a complete cloud snapshot before replacing the settled local cache."}
                </p>
              </div>
              <button
                type="button"
                className="button ghost account-data-button"
                disabled={Boolean(dataAction || settingAction)}
                aria-describedby="rebuild-cache-description"
                aria-busy={dataAction === "rebuild"}
                onClick={() => void rebuild()}
              >
                {dataAction === "rebuild" ? (
                  <LoaderCircle size={17} className="spin" aria-hidden="true" />
                ) : (
                  <RotateCcw size={17} aria-hidden="true" />
                )}{" "}
                {language === "vi"
                  ? "Dựng lại cache từ cloud"
                  : "Rebuild cache from cloud"}
              </button>
            </div>

            <div className="account-data-action is-danger">
              <div>
                <h3>
                  {language === "vi" ? "Wipe thiết bị này" : "Wipe this device"}
                </h3>
                <p id="wipe-device-description">
                  {language === "vi"
                    ? "Đăng xuất và xóa workspace, bản khôi phục local cùng dữ liệu ứng dụng trên thiết bị này. Dữ liệu cloud vẫn còn. Phần cứng lưu trữ có thể giữ dấu vết pháp y; đây không phải xóa mật mã."
                    : "Signs out and removes this device's workspace, local recovery backups, and app storage. Cloud data remains. Storage hardware may retain forensic remnants; this is not cryptographic erasure."}
                </p>
              </div>
              <button
                type="button"
                className="button danger account-data-button"
                disabled={Boolean(dataAction || settingAction)}
                aria-describedby="wipe-device-description"
                aria-busy={dataAction === "wipe"}
                onClick={() => {
                  if (window.worklyDesktop?.resetLocalData) void reset();
                  else setWipeConfirmationOpen(true);
                }}
              >
                {dataAction === "wipe" ? (
                  <LoaderCircle size={17} className="spin" aria-hidden="true" />
                ) : (
                  <Trash2 size={17} aria-hidden="true" />
                )}{" "}
                {language === "vi" ? "Wipe thiết bị này" : "Wipe this device"}
              </button>
            </div>
            {wipeConfirmationOpen && (
              <div className="account-wipe-confirmation" role="alert">
                <label htmlFor="wipe-confirmation">
                  {language === "vi"
                    ? `Nhập ${browserWipeConfirmation(language)} để xác nhận.`
                    : `Type ${browserWipeConfirmation(language)} to confirm.`}
                </label>
                <div>
                  <input
                    id="wipe-confirmation"
                    autoFocus
                    value={wipeConfirmation}
                    onChange={(event) =>
                      setWipeConfirmation(
                        event.target.value.toLocaleUpperCase(),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => {
                      setWipeConfirmationOpen(false);
                      setWipeConfirmation("");
                    }}
                  >
                    {language === "vi" ? "Hủy" : "Cancel"}
                  </button>
                  <button
                    type="button"
                    className="button danger"
                    disabled={
                      wipeConfirmation !== browserWipeConfirmation(language)
                    }
                    onClick={() => void reset()}
                  >
                    {language === "vi" ? "Xác nhận wipe" : "Confirm wipe"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {resetError && (
            <p
              className="form-error account-data-error"
              role="alert"
              aria-live="assertive"
            >
              {resetError}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
