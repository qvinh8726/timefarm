import { currencyMetadata, type CurrencyCode, type Money } from "./types";

export function moneyFromInput(
  value: string | number,
  currency: CurrencyCode,
): Money {
  const numeric =
    typeof value === "number" ? value : Number(value.replace(",", "."));
  const factor = 10 ** currencyMetadata[currency].decimals;
  return {
    amountMinor: Math.max(
      0,
      Math.round((Number.isFinite(numeric) ? numeric : 0) * factor),
    ),
    currency,
  };
}

export function moneyToInput(money?: Money): string {
  if (!money) return "";
  return String(
    money.amountMinor / 10 ** currencyMetadata[money.currency].decimals,
  );
}

export function formatMoney(
  money: Money | undefined,
  language: "vi" | "en",
  fallback = "—",
): string {
  if (!money) return fallback;
  const locale = language === "vi" ? "vi-VN" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
    maximumFractionDigits: currencyMetadata[money.currency].decimals,
  }).format(
    money.amountMinor / 10 ** currencyMetadata[money.currency].decimals,
  );
}

export function sumMoney(
  items: (Money | undefined)[],
  currency: CurrencyCode,
): Money {
  return {
    currency,
    amountMinor: items.reduce(
      (total, item) =>
        total + (item?.currency === currency ? item.amountMinor : 0),
      0,
    ),
  };
}

export function groupedMoney(items: (Money | undefined)[]): Money[] {
  const totals = new Map<CurrencyCode, number>();
  for (const item of items) {
    if (!item) continue;
    totals.set(
      item.currency,
      (totals.get(item.currency) ?? 0) + item.amountMinor,
    );
  }
  return [...totals.entries()].map(([currency, amountMinor]) => ({
    currency,
    amountMinor,
  }));
}
