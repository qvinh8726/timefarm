import { createEmptyState, type AppState } from '../domain/types'

const storageKey = 'workly-desktop-state-v1'

function isAppState(value: unknown): value is AppState {
  return Boolean(value) && typeof value === 'object' && (value as { version?: unknown }).version === 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizePersistedState(value: unknown): AppState {
  const empty = createEmptyState()
  if (!isAppState(value)) return empty
  const raw = value as unknown as Record<string, unknown>
  const preferences = isRecord(raw.preferences) ? raw.preferences : {}
  return {
    ...empty,
    ...raw,
    account: raw.account && isRecord(raw.account) ? raw.account as unknown as AppState['account'] : null,
    projects: Array.isArray(raw.projects) ? raw.projects as AppState['projects'] : [],
    sessions: Array.isArray(raw.sessions) ? raw.sessions as AppState['sessions'] : [],
    payments: Array.isArray(raw.payments) ? raw.payments as AppState['payments'] : [],
    goals: Array.isArray(raw.goals) ? raw.goals as AppState['goals'] : [],
    preferences: {
      ...empty.preferences,
      ...preferences,
      dashboardHiddenWidgets: Array.isArray(preferences.dashboardHiddenWidgets) ? preferences.dashboardHiddenWidgets.filter((item): item is string => typeof item === 'string') : [],
      dashboardWidgetOrder: Array.isArray(preferences.dashboardWidgetOrder) ? preferences.dashboardWidgetOrder.filter((item): item is AppState['preferences']['dashboardWidgetOrder'][number] => typeof item === 'string') : [],
      dashboardWidgetSizes: isRecord(preferences.dashboardWidgetSizes) ? preferences.dashboardWidgetSizes as AppState['preferences']['dashboardWidgetSizes'] : {},
    },
  }
}

export async function loadPersistedState(): Promise<AppState> {
  if (window.worklyDesktop) {
    // A desktop read failure is not an empty account. Returning a fabricated
    // empty state here used to let the normal persistence effect overwrite a
    // durable SQLite database/outbox after an IPC or migration failure.
    const raw = await window.worklyDesktop.loadState()
    if (!isAppState(raw)) throw new Error('The local TimeFarm database returned an unsupported state.')
    return normalizePersistedState(raw)
  }
  try {
    return normalizePersistedState(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null'))
  } catch {
    // The browser preview has no durable desktop database or cloud outbox;
    // recovering its invalid preview cache to an empty state is safe.
    return createEmptyState()
  }
}

export async function persistState(state: AppState): Promise<void> {
  // Desktop mutations are committed through typed IPC commands in the main
  // process. The renderer only writes browser-preview state to localStorage.
  if (window.worklyDesktop) return
  window.localStorage.setItem(storageKey, JSON.stringify(state))
}
