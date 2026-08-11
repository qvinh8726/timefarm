import { useState } from "react";
import { Check, LoaderCircle, RotateCcw } from "lucide-react";
import type { AppLanguage } from "../domain/types";
import { translate } from "../i18n";
import { useAppStore } from "../lib/state";

function workspaceLabel(
  language: AppLanguage,
  key: "profile" | "settings",
): string {
  return translate(language, "workspace", key);
}

function confirmBrowserLocalReset(language: AppLanguage): boolean {
  if (window.worklyDesktop?.resetLocalData) return true;
  return window.confirm(
    language === "vi"
      ? "Xóa toàn bộ dữ liệu TimeFarm trong trình duyệt này? Hành động này không thể hoàn tác."
      : "Delete all TimeFarm data in this browser? This cannot be undone.",
  );
}

export function ProfilePage() {
  const { state } = useAppStore();
  const app = state!;
  const account = app.account!;
  const language = account.language;
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">
          {language === "vi" ? "TÀI KHOẢN" : "ACCOUNT"}
        </span>
        <h1>{workspaceLabel(language, "profile")}</h1>
        <p>
          {language === "vi"
            ? "Thông tin nhận diện được tách riêng khỏi số liệu công việc."
            : "Account identity is kept separate from your work data."}
        </p>
      </div>
      <section className="profile-layout">
        <article className="panel profile-card">
          <div className="profile-avatar">
            {account.displayName.slice(0, 1).toUpperCase()}
          </div>
          <h2>{account.displayName}</h2>
          <p>
            {language === "vi"
              ? "Tài khoản local-first"
              : "Local-first account"}
          </p>
          <div className="profile-detail">
            <span>{language === "vi" ? "Quốc gia" : "Country"}</span>
            <strong>{account.country}</strong>
          </div>
          <div className="profile-detail">
            <span>{language === "vi" ? "Múi giờ" : "Timezone"}</span>
            <strong>{account.timezone}</strong>
          </div>
          <div className="profile-detail">
            <span>
              {language === "vi" ? "Tiền tệ tài khoản" : "Account currency"}
            </span>
            <strong>{account.currency}</strong>
          </div>
        </article>
        <article className="panel account-security">
          <h3>{language === "vi" ? "Đồng bộ tài khoản" : "Account sync"}</h3>
          <p>
            {language === "vi"
              ? "Bản chạy hiện tại giữ dữ liệu trên thiết bị để timer hoạt động offline. Đăng nhập email/Google và đồng bộ cloud cần endpoint Supabase/Auth được cấu hình bằng biến môi trường; chúng không được giả lập trong app local."
              : "This build retains data locally so the timer works offline. Email/Google sign-in and cloud synchronization require a configured Supabase/Auth endpoint and are not faked in the local app."}
          </p>
          <div className="architecture-note">
            <Check size={18} />
            <span>
              {language === "vi"
                ? "Dữ liệu phiên, dự án và mục tiêu đã sẵn sàng cho lớp sync outbox."
                : "Sessions, projects, and goals are backed by a durable sync outbox."}
            </span>
          </div>
        </article>
      </section>
    </>
  );
}

export function SettingsPage() {
  const { state, updatePreferences, updateLanguage, resetLocalData } =
    useAppStore();
  const app = state!;
  const account = app.account!;
  const language = account.language;
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState("");
  const reset = async () => {
    if (resetBusy || !confirmBrowserLocalReset(language)) return;
    setResetBusy(true);
    setResetError("");
    try {
      const result = await resetLocalData();
      if (!result.ok && !/cancel/i.test(result.message))
        setResetError(result.message);
    } finally {
      setResetBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
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
      </div>
      <section className="settings-layout">
        <article className="panel settings-section">
          <h3>{language === "vi" ? "Giao diện" : "Appearance"}</h3>
          <div className="setting-row">
            <div>
              <strong>{language === "vi" ? "Chủ đề" : "Theme"}</strong>
              <span>
                {language === "vi"
                  ? "Theo hệ thống, sáng hoặc tối"
                  : "System, light, or dark"}
              </span>
            </div>
            <select
              value={app.preferences.theme}
              onChange={(event) =>
                updatePreferences({
                  theme: event.target.value as "system" | "light" | "dark",
                })
              }
            >
              <option value="system">
                {language === "vi" ? "Theo hệ thống" : "System"}
              </option>
              <option value="light">
                {language === "vi" ? "Sáng" : "Light"}
              </option>
              <option value="dark">{language === "vi" ? "Tối" : "Dark"}</option>
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>{language === "vi" ? "Ngôn ngữ" : "Language"}</strong>
              <span>
                {language === "vi"
                  ? "Có thể đổi bất kỳ lúc nào"
                  : "You can change this at any time"}
              </span>
            </div>
            <select
              value={language}
              onChange={(event) =>
                updateLanguage(event.target.value as AppLanguage)
              }
            >
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </div>
        </article>
        <article className="panel settings-section">
          <h3>Mini timer</h3>
          <div className="setting-row">
            <div>
              <strong>
                {language === "vi" ? "Chế độ hiển thị" : "Display mode"}
              </strong>
              <span>
                {language === "vi"
                  ? "Interactive cho phép điều khiển; Chỉ xem hoàn toàn click-through; kéo overlay để lưu vị trí."
                  : "Interactive allows controls; View only is fully click-through; drag the overlay to save its position."}
              </span>
            </div>
            <select
              value={app.preferences.miniTimerMode}
              onChange={(event) =>
                updatePreferences({
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
        </article>
        <article className="panel danger-zone">
          <h3>
            {language === "vi" ? "Vùng dữ liệu local" : "Local data zone"}
          </h3>
          <p>
            {language === "vi"
              ? "Xóa dữ liệu chỉ xóa bản lưu trên máy này. Dữ liệu cloud không bị xóa bởi thao tác này."
              : "This only deletes data saved on this device. Cloud data is not deleted by this action."}
          </p>
          {resetError && (
            <p className="form-error" role="alert">
              {resetError}
            </p>
          )}
          <button
            type="button"
            className="button danger"
            disabled={resetBusy}
            onClick={() => void reset()}
          >
            {resetBusy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <RotateCcw size={17} />
            )}{" "}
            {resetBusy
              ? language === "vi"
                ? "Đang chờ xác nhận…"
                : "Waiting for confirmation…"
              : language === "vi"
                ? "Xóa dữ liệu local"
                : "Clear local data"}
          </button>
        </article>
      </section>
    </>
  );
}
