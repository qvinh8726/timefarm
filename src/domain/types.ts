export type AppLanguage = 'vi' | 'en'
export type ThemePreference = 'system' | 'light' | 'dark'
export type CurrencyCode = 'VND' | 'USD' | 'EUR' | 'JPY' | 'GBP'
export type PaymentModel = 'per_session' | 'on_completion' | 'progressive'
export type ProjectStatus = 'active' | 'paused' | 'completed'
export type SessionStatus = 'running' | 'paused' | 'completed'
export type SyncStatus = 'local' | 'queued' | 'synced' | 'error'
export type GoalKind = 'hours_daily' | 'hours_weekly' | 'earnings_daily' | 'earnings_weekly' | 'earnings_monthly' | 'projects_completed'

export interface Money {
  amountMinor: number
  currency: CurrencyCode
}

export interface Account {
  id: string
  authUserId?: string
  displayName: string
  country: string
  language: AppLanguage
  currency: CurrencyCode
  timezone: string
  createdAt: string
}

export interface Project {
  id: string
  name: string
  paymentModel: PaymentModel
  expectedMoney?: Money
  note?: string
  color: string
  icon: string
  status: ProjectStatus
  completedAt?: string
  createdAt: string
  updatedAt: string
  syncStatus: SyncStatus
}

export interface PauseInterval {
  startedAt: string
  endedAt?: string
}

export interface WorkSession {
  id: string
  projectId?: string
  startedAt: string
  endedAt?: string
  timezone: string
  pauses: PauseInterval[]
  activeDurationMs?: number
  status: SessionStatus
  earnings?: Money
  note?: string
  createdAt: string
  updatedAt: string
  syncStatus: SyncStatus
}

export interface Payment {
  id: string
  projectId: string
  money: Money
  receivedAt: string
  kind: 'completion' | 'progressive'
  note?: string
  createdAt: string
  syncStatus: SyncStatus
}

export interface Goal {
  id: string
  kind: GoalKind
  target: number
  createdAt: string
  syncStatus?: SyncStatus
}

export type DashboardWidgetId =
  | 'timer'
  | 'goals'
  | 'earningsTrend'
  | 'hoursTrend'
  | 'projectBreakdown'
  | 'rateTrend'
  | 'cumulativeEarnings'
  | 'comparison'

export type DashboardWidgetSize = 'small' | 'medium' | 'large'

export interface Preferences {
  theme: ThemePreference
  miniTimerMode: 'interactive' | 'view_only' | 'hidden'
  dashboardHiddenWidgets: string[]
  dashboardWidgetOrder: DashboardWidgetId[]
  dashboardWidgetSizes: Partial<Record<DashboardWidgetId, DashboardWidgetSize>>
}

export interface AppState {
  version: 1
  account: Account | null
  projects: Project[]
  sessions: WorkSession[]
  payments: Payment[]
  goals: Goal[]
  preferences: Preferences
}

export const currencyMetadata: Record<CurrencyCode, { decimals: number; label: string }> = {
  VND: { decimals: 0, label: 'Vietnamese đồng' },
  USD: { decimals: 2, label: 'US dollar' },
  EUR: { decimals: 2, label: 'Euro' },
  JPY: { decimals: 0, label: 'Japanese yen' },
  GBP: { decimals: 2, label: 'British pound' },
}

export const paymentModelLabels: Record<PaymentModel, { vi: string; en: string }> = {
  per_session: { vi: 'Theo phiên làm việc', en: 'Per work session' },
  on_completion: { vi: 'Khi hoàn thành dự án', en: 'On project completion' },
  progressive: { vi: 'Theo đợt bàn giao', en: 'Progressive payments' },
}

export const goalLabels: Record<GoalKind, { vi: string; en: string; unit: 'hours' | 'money' | 'count' }> = {
  hours_daily: { vi: 'Giờ làm mỗi ngày', en: 'Work hours per day', unit: 'hours' },
  hours_weekly: { vi: 'Giờ làm mỗi tuần', en: 'Work hours per week', unit: 'hours' },
  earnings_daily: { vi: 'Thu nhập mỗi ngày', en: 'Earnings per day', unit: 'money' },
  earnings_weekly: { vi: 'Thu nhập mỗi tuần', en: 'Earnings per week', unit: 'money' },
  earnings_monthly: { vi: 'Thu nhập mỗi tháng', en: 'Earnings per month', unit: 'money' },
  projects_completed: { vi: 'Dự án hoàn thành tháng này', en: 'Completed projects this month', unit: 'count' },
}

export const createEmptyState = (): AppState => ({
  version: 1,
  account: null,
  projects: [],
  sessions: [],
  payments: [],
  goals: [],
  preferences: {
    theme: 'system',
    miniTimerMode: 'hidden',
    dashboardHiddenWidgets: [],
    dashboardWidgetOrder: [],
    dashboardWidgetSizes: {},
  },
})
