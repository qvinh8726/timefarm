import { useMemo, useSyncExternalStore } from "react";

type ClockStore = {
  now: number;
  listeners: Set<() => void>;
  interval?: number;
};

const clockStores = new Map<number, ClockStore>();
const disabledClockSubscribe = () => () => undefined;

function clockStore(cadenceMs: number) {
  const cadence = Math.max(1_000, cadenceMs);
  let store = clockStores.get(cadence);
  if (!store) {
    store = { now: Date.now(), listeners: new Set() };
    clockStores.set(cadence, store);
  }
  const resolved = store;
  return {
    snapshot: () => resolved.now,
    subscribe: (listener: () => void) => {
      resolved.listeners.add(listener);
      resolved.now = Date.now();
      if (resolved.interval === undefined) {
        resolved.interval = window.setInterval(() => {
          resolved.now = Date.now();
          resolved.listeners.forEach((notify) => notify());
        }, cadence);
      }
      return () => {
        resolved.listeners.delete(listener);
        if (resolved.listeners.size === 0 && resolved.interval !== undefined) {
          window.clearInterval(resolved.interval);
          resolved.interval = undefined;
        }
      };
    },
  };
}

export function useCurrentTime(enabled = true, cadenceMs = 1_000): number {
  const store = useMemo(() => clockStore(cadenceMs), [cadenceMs]);
  return useSyncExternalStore(
    enabled ? store.subscribe : disabledClockSubscribe,
    store.snapshot,
    store.snapshot,
  );
}
