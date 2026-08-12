import { useId, useRef, useState } from "react";
import type { AppLanguage } from "../domain/types";

export function localDataResetPhrase(language: AppLanguage): string {
  return language === "vi" ? "XÓA" : "WIPE";
}

export function LocalDataResetConfirmation({
  language,
  busy,
  onCancel,
  onConfirm,
}: {
  language: AppLanguage;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const confirmationInFlightRef = useRef(false);
  const phrase = localDataResetPhrase(language);
  const confirm = async () => {
    if (confirmationInFlightRef.current) return;
    confirmationInFlightRef.current = true;
    try {
      await onConfirm();
    } finally {
      confirmationInFlightRef.current = false;
    }
  };
  return (
    <div className="account-wipe-confirmation" role="alert">
      <label htmlFor={inputId}>
        {language === "vi"
          ? `Nhập ${phrase} để xác nhận.`
          : `Type ${phrase} to confirm.`}
      </label>
      <div>
        <input
          id={inputId}
          autoFocus
          disabled={busy}
          value={value}
          onChange={(event) =>
            setValue(event.target.value.toLocaleUpperCase(language))
          }
        />
        <button
          type="button"
          className="button ghost"
          disabled={busy}
          onClick={onCancel}
        >
          {language === "vi" ? "Hủy" : "Cancel"}
        </button>
        <button
          type="button"
          className="button danger"
          disabled={busy || value !== phrase}
          onClick={() => void confirm()}
        >
          {language === "vi" ? "Xác nhận xóa" : "Confirm wipe"}
        </button>
      </div>
    </div>
  );
}
