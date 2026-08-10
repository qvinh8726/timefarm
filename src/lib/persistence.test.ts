import { describe, expect, it } from 'vitest'
import { loadPersistedState, normalizePersistedState } from './persistence'

describe('normalizePersistedState', () => {
  it('migrates an older renderer snapshot with missing dashboard preferences without losing facts', () => {
    const state = normalizePersistedState({
      version: 1,
      account: { id: 'account-1', displayName: 'Minh', country: 'VN', language: 'vi', currency: 'VND', timezone: 'Asia/Ho_Chi_Minh', createdAt: '2026-08-01T00:00:00.000Z' },
      projects: [{ id: 'project-1' }],
      sessions: [{ id: 'session-1' }],
      payments: [],
      goals: [],
      preferences: { theme: 'dark', miniTimerMode: 'hidden', dashboardHiddenWidgets: ['timer'] },
    })

    expect(state.projects).toEqual([{ id: 'project-1' }])
    expect(state.sessions).toEqual([{ id: 'session-1' }])
    expect(state.preferences).toMatchObject({ theme: 'dark', miniTimerMode: 'hidden', dashboardHiddenWidgets: ['timer'], dashboardWidgetOrder: [], dashboardWidgetSizes: {} })
  })

  it('falls back to a safe empty state for invalid stored data', () => {
    expect(normalizePersistedState({ version: 2 })).toMatchObject({ version: 1, account: null, projects: [], preferences: { dashboardWidgetOrder: [] } })
  })

  it('does not fabricate an empty desktop state when the durable read fails', async () => {
    const target = globalThis as typeof globalThis & { window?: unknown }
    const original = target.window
    target.window = { worklyDesktop: { loadState: async () => { throw new Error('SQLite unavailable') } } } as unknown as typeof window
    await expect(loadPersistedState()).rejects.toThrow('SQLite unavailable')
    target.window = original
  })
})
