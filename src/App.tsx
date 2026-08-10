import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  BarChart3,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FolderKanban,
  Globe2,
  History,
  LayoutDashboard,
  LoaderCircle,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Square,
  Sun,
  Target,
  TrendingUp,
  UserRound,
  X,
} from 'lucide-react'
import {
  calculateGoalProgress,
  cumulativeSeries,
  currentDayRange,
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
} from './domain/analytics'
import { formatMoney, groupedMoney, moneyFromInput, moneyToInput } from './domain/money'
import { activeDurationMs, formatClockTime, formatDate, formatDateTimeLocalInput, formatDuration } from './domain/time'
import { currencyMetadata, goalLabels, paymentModelLabels, type AppLanguage, type CurrencyCode, type DashboardWidgetId, type DashboardWidgetSize, type Goal, type GoalKind, type Payment, type PaymentModel, type Project, type ProjectStatus, type WorkSession } from './domain/types'
import { translate, type TranslationKey } from './i18n'
import { getActiveSession, themeClass, useAppStore, type CompletedSessionInput, type NewProjectInput } from './lib/state'
import { useAuth, type SafeAuthUser } from './lib/auth'
import './load-failure.css'

type Page = 'dashboard' | 'projects' | 'history' | 'analytics' | 'profile' | 'settings'
type Dialog =
  | { kind: 'start' }
  | { kind: 'complete'; session: WorkSession; endedAt?: string }
  | { kind: 'project'; project?: Project }
  | { kind: 'payment'; project: Project; payment?: Payment }
  | { kind: 'goal'; goal?: Goal }
  | { kind: 'dashboard-customize' }
  | { kind: 'sync-conflicts' }
  | { kind: 'edit-session'; session: WorkSession }
  | null

type CloudBootstrapView = CloudBootstrapResult | { state: 'idle' | 'checking' }

function label(language: AppLanguage, key: TranslationKey<'workspace'>): string {
  return translate(language, 'workspace', key)
}

function defaultLanguage(): AppLanguage {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

function isActiveWorkSession(value: unknown): value is WorkSession {
  return Boolean(value) && typeof value === 'object'
    && typeof (value as { id?: unknown }).id === 'string'
    && ((value as { status?: unknown }).status === 'running' || (value as { status?: unknown }).status === 'paused')
}

function useCurrentTime(enabled = true): number {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!enabled) return undefined
    const kickoff = window.setTimeout(() => setNow(Date.now()), 0)
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => { window.clearTimeout(kickoff); window.clearInterval(interval) }
  }, [enabled])
  return now
}

export function App() {
  const { state, isLoading, loadError, reload } = useAppStore()
  const { status: auth, isLoading: authLoading, refresh: refreshAuth } = useAuth()
  const [cloudBootstrap, setCloudBootstrap] = useState<CloudBootstrapView>({ state: 'idle' })
  const [cloudBootstrapAttempt, setCloudBootstrapAttempt] = useState(0)
  const shellLanguage = defaultLanguage()

  const theme = state?.account ? state.preferences.theme : 'light'
  const documentLanguage = state?.account?.language ?? 'vi'
  useEffect(() => {
    document.documentElement.lang = documentLanguage
  }, [documentLanguage])

  useEffect(() => {
    const applyTheme = () => { document.documentElement.className = themeClass(theme) }
    applyTheme()
    if (theme !== 'system' || !window.matchMedia) return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [theme])

  useEffect(() => {
    let cancelled = false
    const desktop = window.worklyDesktop
    const needsBootstrap = Boolean(desktop?.bootstrapAuthenticatedAccount && auth.configured && auth.authenticated && !state?.account)
    if (!needsBootstrap) {
      return () => { cancelled = true }
    }
    if (auth.offline) {
      const offlineNotice = window.setTimeout(() => {
        if (!cancelled) setCloudBootstrap({ state: 'offline' })
      }, 0)
      return () => { cancelled = true; window.clearTimeout(offlineNotice) }
    }
    const bootstrap = window.setTimeout(() => {
      setCloudBootstrap({ state: 'checking' })
      void desktop!.bootstrapAuthenticatedAccount().then((result) => {
        if (cancelled) return
        setCloudBootstrap(result)
        if (result.state === 'restored' || result.state === 'already_initialized') void reload()
      }).catch((error) => {
        if (!cancelled) setCloudBootstrap({ state: 'failed', error: error instanceof Error ? error.message : 'Cloud bootstrap failed.' })
      })
    }, 0)
    return () => { cancelled = true; window.clearTimeout(bootstrap) }
  }, [auth.authenticated, auth.configured, auth.offline, cloudBootstrapAttempt, reload, state?.account])

  if (loadError) return <DataLoadFailure language={state?.account?.language ?? 'vi'} message={loadError} onRetry={() => { void reload() }} />
  if (isLoading || authLoading || !state) {
    return <div className="splash"><LoaderCircle size={28} className="spin" /><span>{translate(shellLanguage, 'shell', 'opening')}</span></div>
  }
  if (auth.configured && !auth.authenticated) return <AuthenticationScreen language={shellLanguage} />
  const needsCloudBootstrap = Boolean(window.worklyDesktop?.bootstrapAuthenticatedAccount && auth.configured && auth.authenticated && !state.account)
  if (needsCloudBootstrap && (cloudBootstrap.state === 'idle' || cloudBootstrap.state === 'checking' || cloudBootstrap.state === 'restored' || cloudBootstrap.state === 'already_initialized')) {
    return <div className="splash"><LoaderCircle size={28} className="spin" /><span>{translate(shellLanguage, 'shell', 'checkingCloudWorkspace')}</span></div>
  }
  if (needsCloudBootstrap && cloudBootstrap.state !== 'not_found') {
    return <CloudBootstrapUnavailableScreen
      language={shellLanguage}
      message={'error' in cloudBootstrap ? cloudBootstrap.error : undefined}
      onRetry={() => { setCloudBootstrapAttempt((attempt) => attempt + 1); void refreshAuth() }}
    />
  }
  if (!state.account) return <Onboarding authUser={auth.user} offlineMode={!auth.configured} initialLanguage={shellLanguage} />
  if (auth.authenticated && auth.user && state.account.authUserId && state.account.authUserId !== auth.user.id) return <AccountMismatchScreen />
  if (auth.authenticated && auth.user && !state.account.authUserId) return <ClaimLocalAccountScreen />
  return <Workspace />
}

function CloudBootstrapUnavailableScreen({ language, message, onRetry }: { language: AppLanguage; message?: string; onRetry: () => void }) {
  return <main className="ownership-shell"><section className="ownership-card load-failure-card">
    <div className="brand"><span className="brand-mark">T</span><span>TimeFarm</span></div>
    <span className="eyebrow">{translate(language, 'cloudBootstrap', 'eyebrow')}</span>
    <h1>{translate(language, 'cloudBootstrap', 'heading')}</h1>
    <p>{translate(language, 'cloudBootstrap', 'description')}</p>
    {message && <div className="load-error-detail" role="status">{message}</div>}
    <button className="button primary full" onClick={onRetry}><RotateCcw size={17} /> {translate(language, 'cloudBootstrap', 'retry')}</button>
  </section></main>
}

function DataLoadFailure({ language, message, onRetry }: { language: AppLanguage; message: string; onRetry: () => void }) {
  return <main className="ownership-shell"><section className="ownership-card load-failure-card">
    <div className="brand"><span className="brand-mark">T</span><span>TimeFarm</span></div>
    <span className="eyebrow">{translate(language, 'dataLoad', 'eyebrow')}</span>
    <h1>{translate(language, 'dataLoad', 'heading')}</h1>
    <p>{translate(language, 'dataLoad', 'description')}</p>
    <div className="load-error-detail" role="status">{message}</div>
    <button className="button primary full" onClick={onRetry}><RotateCcw size={17} /> {translate(language, 'dataLoad', 'retry')}</button>
  </section></main>
}

function AuthenticationScreen({ language }: { language: AppLanguage }) {
  const { signIn, signUp, signInWithGoogle } = useAuth()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      if (mode === 'sign-in') await signIn({ email, password })
      else {
        const result = await signUp({ email, password, displayName })
        if (result.requiresEmailConfirmation) setMessage(translate(language, 'authentication', 'signUpConfirmationRequired'))
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : translate(language, 'authentication', 'unableToAuthenticate'))
    } finally {
      setBusy(false)
    }
  }

  const google = async () => {
    setBusy(true)
    setMessage('')
    try {
      await signInWithGoogle()
      setMessage(translate(language, 'authentication', 'googleStarted'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : translate(language, 'authentication', 'unableToStartGoogle'))
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-shell">
    <section className="auth-brand-panel">
      <div className="brand brand-large"><span className="brand-mark">T</span><span>TimeFarm</span></div>
      <div className="auth-brand-copy">
        <span className="eyebrow light">{translate(language, 'authentication', 'brandEyebrow')}</span>
        <h1>{translate(language, 'authentication', 'brandHeadlineFirst')}<br />{translate(language, 'authentication', 'brandHeadlineSecond')}</h1>
        <p>{translate(language, 'authentication', 'brandDescription')}</p>
        <div className="auth-value-list">
          <span><Check size={16} /> {translate(language, 'authentication', 'valueOfflineTimer')}</span>
          <span><Check size={16} /> {translate(language, 'authentication', 'valueOriginalEarnings')}</span>
          <span><Check size={16} /> {translate(language, 'authentication', 'valueDataControl')}</span>
        </div>
      </div>
    </section>
    <section className="auth-form-wrap">
      <form className="auth-form" onSubmit={submit}>
        <div className="auth-tabs">
          <button type="button" className={mode === 'sign-in' ? 'active' : ''} onClick={() => setMode('sign-in')}>{translate(language, 'authentication', 'signIn')}</button>
          <button type="button" className={mode === 'sign-up' ? 'active' : ''} onClick={() => setMode('sign-up')}>{translate(language, 'authentication', 'signUp')}</button>
        </div>
        <div className="welcome-heading">
          <span className="eyebrow">{translate(language, 'authentication', mode === 'sign-in' ? 'signInEyebrow' : 'signUpEyebrow')}</span>
          <h2>{translate(language, 'authentication', mode === 'sign-in' ? 'signInHeading' : 'signUpHeading')}</h2>
          <p>{translate(language, 'authentication', mode === 'sign-in' ? 'signInDescription' : 'signUpDescription')}</p>
        </div>
        <button className="button google-button full" type="button" onClick={google} disabled={busy}><span className="google-g">G</span> {translate(language, 'authentication', 'continueWithGoogle')}</button>
        <div className="auth-divider"><span />{translate(language, 'authentication', 'or')}<span /></div>
        {mode === 'sign-up' && <Field label={translate(language, 'authentication', 'displayName')}><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={translate(language, 'authentication', 'displayNamePlaceholder')} autoComplete="name" /></Field>}
        <Field label={translate(language, 'authentication', 'email')}><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="minh@example.com" type="email" autoComplete="email" required /></Field>
        <Field label={translate(language, 'authentication', 'password')}><input value={password} onChange={(event) => setPassword(event.target.value)} placeholder={translate(language, 'authentication', 'passwordPlaceholder')} type="password" minLength={8} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required /></Field>
        {message && <p className="auth-message">{message}</p>}
        <button className="button primary full" disabled={busy} type="submit">{busy ? translate(language, 'authentication', 'processing') : translate(language, 'authentication', mode === 'sign-in' ? 'signIn' : 'signUp')} <ChevronRight size={18} /></button>
        <p className="auth-note">{translate(language, 'authentication', 'authNote')}</p>
      </form>
    </section>
  </main>
}

function Onboarding({ authUser, offlineMode, initialLanguage }: { authUser: SafeAuthUser | null; offlineMode: boolean; initialLanguage: AppLanguage }) {
  const { initializeAccount } = useAppStore()
  const [language, setLanguage] = useState<AppLanguage>(initialLanguage)
  const [name, setName] = useState(authUser?.displayName ?? '')
  const [country, setCountry] = useState('VN')
  const [currency, setCurrency] = useState<CurrencyCode>('VND')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void initializeAccount({ displayName: name, country, language, currency })
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const accountEmail = authUser?.email ?? translate(language, 'onboarding', 'accountFallback')

  return (
    <main className="onboarding-shell">
      <section className="onboarding-art" aria-hidden="true">
        <div className="brand brand-large"><span className="brand-mark">T</span><span>TimeFarm</span></div>
        <div className="orb orb-one" /><div className="orb orb-two" />
        <div className="onboarding-copy">
          <span className="eyebrow light">{translate(language, 'onboarding', 'artEyebrow')}</span>
          <h1>{translate(language, 'onboarding', 'artHeadlineFirst')}<br />{translate(language, 'onboarding', 'artHeadlineSecond')}</h1>
          <p>{translate(language, 'onboarding', 'artDescription')}</p>
          <div className="mini-preview"><div className="mini-line long" /><div className="mini-line short" /><div className="mini-chart"><i /><i /><i /><i /><i /><i /></div></div>
        </div>
      </section>
      <section className="onboarding-form-wrap">
        <form className="onboarding-form" onSubmit={submit}>
          <div className="language-toggle" role="group" aria-label={translate(language, 'onboarding', 'languageAria')}>
            <button type="button" className={language === 'vi' ? 'selected' : ''} onClick={() => setLanguage('vi')}>{translate(language, 'onboarding', 'vietnamese')}</button>
            <button type="button" className={language === 'en' ? 'selected' : ''} onClick={() => setLanguage('en')}>{translate(language, 'onboarding', 'english')}</button>
          </div>
          <div className="welcome-heading">
            <span className="eyebrow">{translate(language, 'onboarding', 'setupEyebrow')}</span>
            <h2>{translate(language, 'onboarding', 'setupHeading')}</h2>
            <p>{translate(language, 'onboarding', 'setupDescription')}</p>
          </div>
          <Field label={translate(language, 'onboarding', 'nameLabel')}>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={translate(language, 'onboarding', 'namePlaceholder')} />
          </Field>
          <div className="form-grid">
            <Field label={translate(language, 'onboarding', 'countryLabel')}>
              <select value={country} onChange={(event) => setCountry(event.target.value)}>
                <option value="VN">{translate(language, 'onboarding', 'countryVietnam')}</option><option value="US">{translate(language, 'onboarding', 'countryUnitedStates')}</option><option value="GB">{translate(language, 'onboarding', 'countryUnitedKingdom')}</option><option value="JP">{translate(language, 'onboarding', 'countryJapan')}</option><option value="DE">{translate(language, 'onboarding', 'countryGermany')}</option>
              </select>
            </Field>
            <Field label={translate(language, 'onboarding', 'currencyLabel')}>
              <select value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}>
                {Object.keys(currencyMetadata).map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </Field>
          </div>
          <p className="form-hint"><Globe2 size={15} /> {translate(language, 'onboarding', 'timezoneHint', { timezone })}</p>
          <button className="button primary full" type="submit">{translate(language, 'onboarding', 'enterWorkspace')} <ChevronRight size={18} /></button>
          <p className="auth-note">{offlineMode ? translate(language, 'onboarding', 'offlineMode') : translate(language, 'onboarding', 'accountMode', { email: accountEmail })}</p>
        </form>
      </section>
    </main>
  )
}

function ClaimLocalAccountScreen() {
  const { state, claimLocalAccount } = useAppStore()
  const { status } = useAuth()
  const account = state!.account!
  const user = status.user!
  const language = account.language
  const [accepted, setAccepted] = useState(false)
  const [message, setMessage] = useState('')
  const claim = async () => {
    const result = await claimLocalAccount(user.id)
    if (!result.ok) setMessage(result.message)
  }
  return <main className="ownership-shell"><section className="ownership-card">
    <div className="brand"><span className="brand-mark">T</span><span>TimeFarm</span></div>
    <span className="eyebrow">{translate(language, 'ownership', 'claimEyebrow')}</span>
    <h1>{translate(language, 'ownership', 'claimHeading')}</h1>
    <p>{translate(language, 'ownership', 'claimDescription')}</p>
    <div className="ownership-summary"><div><span>{translate(language, 'ownership', 'localProfile')}</span><strong>{account.displayName} · {account.country} · {account.currency}</strong></div><div><span>{translate(language, 'ownership', 'signedInAccount')}</span><strong>{user.email ?? user.id}</strong></div></div>
    <label className="consent"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> {translate(language, 'ownership', 'consent')}</label>
    {message && <p className="form-error">{message}</p>}
    <button className="button primary full" disabled={!accepted} onClick={() => { void claim() }}>{translate(language, 'ownership', 'claimAction')} <ChevronRight size={18} /></button>
  </section></main>
}

function AccountMismatchScreen() {
  const { state } = useAppStore()
  const { status, signOut } = useAuth()
  const account = state!.account!
  const language = account.language
  return <main className="ownership-shell"><section className="ownership-card">
    <div className="brand"><span className="brand-mark">T</span><span>TimeFarm</span></div>
    <span className="eyebrow">{translate(language, 'ownership', 'mismatchEyebrow')}</span>
    <h1>{translate(language, 'ownership', 'mismatchHeading')}</h1>
    <p>{translate(language, 'ownership', 'mismatchDescription')}</p>
    <div className="ownership-summary"><div><span>{translate(language, 'ownership', 'localData')}</span><strong>{account.authUserId}</strong></div><div><span>{translate(language, 'ownership', 'signedInAs')}</span><strong>{status.user?.email ?? status.user?.id}</strong></div></div>
    <button className="button primary full" onClick={() => { void signOut() }}>{translate(language, 'ownership', 'signOutAction')}</button>
  </section></main>
}

function Workspace() {
  const { state, reload } = useAppStore()
  const account = state!.account!
  const language = account.language
  const active = getActiveSession(state!.sessions)
  const [page, setPage] = useState<Page>('dashboard')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [recoveryOpen, setRecoveryOpen] = useState(() => Boolean(active))

  useEffect(() => {
    const desktop = window.worklyDesktop
    if (!desktop?.onOverlayStopRequested) return undefined
    return desktop.onOverlayStopRequested((request) => {
      if (isActiveWorkSession(request.session) && request.session.id === request.sessionId) {
        setPage('dashboard')
        setDialog({ kind: 'complete', session: request.session })
        return
      }
      // An overlay action may reach the main process before this renderer has
      // received its state-change event. Resolve the canonical SQLite state
      // before deciding that the stop request is stale.
      void reload().then((latest) => {
        const current = latest ? getActiveSession(latest.sessions) : undefined
        if (current && current.id === request.sessionId) {
          setPage('dashboard')
          setDialog({ kind: 'complete', session: current })
        }
      })
    })
  }, [reload])

  const nav: { id: Page; icon: ReactNode; label: string }[] = [
    { id: 'dashboard', icon: <LayoutDashboard size={19} />, label: label(language, 'dashboard') },
    { id: 'projects', icon: <FolderKanban size={19} />, label: label(language, 'projects') },
    { id: 'history', icon: <History size={19} />, label: label(language, 'history') },
    { id: 'analytics', icon: <BarChart3 size={19} />, label: label(language, 'analytics') },
    { id: 'profile', icon: <UserRound size={19} />, label: label(language, 'profile') },
    { id: 'settings', icon: <Settings size={19} />, label: label(language, 'settings') },
  ]

  const renderPage = () => {
    switch (page) {
      case 'projects': return <ProjectsPage onNew={() => setDialog({ kind: 'project' })} onEdit={(project) => setDialog({ kind: 'project', project })} onRecordPayment={(project) => setDialog({ kind: 'payment', project })} />
      case 'history': return <HistoryPage onEdit={(session) => setDialog({ kind: 'edit-session', session })} />
      case 'analytics': return <AnalyticsPage />
      case 'profile': return <ProfilePage />
      case 'settings': return <SettingsPage />
      default: return <DashboardPage onStart={() => setDialog({ kind: 'start' })} onComplete={(session) => setDialog({ kind: 'complete', session })} onAddGoal={() => setDialog({ kind: 'goal' })} onEditGoal={(goal) => setDialog({ kind: 'goal', goal })} onCustomize={() => setDialog({ kind: 'dashboard-customize' })} />
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">T</span><span>TimeFarm</span></div>
        <button className="sidebar-start" onClick={() => setDialog({ kind: 'start' })}><Play size={16} fill="currentColor" /> {label(language, 'start')}</button>
        <nav>
          {nav.map((item) => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}>{item.icon}<span>{item.label}</span></button>)}
        </nav>
        <div className="sidebar-foot">
          <div className="account-chip"><span>{account.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{account.displayName}</strong><small>{account.currency} · {account.timezone}</small></div></div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div>{active ? <ActiveStatus session={active} language={language} /> : <span className="quiet-status"><Clock3 size={16} /> {language === 'vi' ? 'Chưa có phiên đang chạy' : 'No active session'}</span>}</div>
          <div className="topbar-actions"><SyncPill language={language} onOpenConflicts={() => setDialog({ kind: 'sync-conflicts' })} /><span className="timezone"><Globe2 size={15} /> {account.timezone}</span><ThemeIcon /></div>
        </header>
        <div className="page-content">{renderPage()}</div>
      </main>
      {dialog?.kind === 'start' && <StartSessionDialog onClose={() => setDialog(null)} onStarted={() => { setDialog(null); setPage('dashboard') }} />}
      {dialog?.kind === 'complete' && <CompleteSessionDialog session={dialog.session} requestedEndAt={dialog.endedAt} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'project' && <ProjectDialog project={dialog.project} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'payment' && <PaymentDialog key={`${dialog.project.id}:${dialog.payment?.id ?? 'new'}`} project={dialog.project} payment={dialog.payment} onClose={() => setDialog(null)} onEditPayment={(payment) => setDialog({ kind: 'payment', project: dialog.project, payment })} />}
      {dialog?.kind === 'goal' && <GoalDialog key={dialog.goal?.id ?? 'new'} goal={dialog.goal} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'dashboard-customize' && <DashboardCustomizeDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'sync-conflicts' && <SyncConflictsDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit-session' && <EditSessionDialog session={dialog.session} onClose={() => setDialog(null)} />}
      {recoveryOpen && active && <RecoveryDialog session={active} onContinue={() => setRecoveryOpen(false)} onComplete={(endedAt) => { setRecoveryOpen(false); setDialog({ kind: 'complete', session: active, endedAt }) }} />}
    </div>
  )
}

function SyncPill({ language, onOpenConflicts }: { language: AppLanguage; onOpenConflicts: () => void }) {
  const { status: auth } = useAuth()
  const [summary, setSummary] = useState<{ queued: number; failed: number; conflicts: number } | null>(null)
  const refresh = () => {
    const desktop = window.worklyDesktop
    if (!desktop) return
    void desktop.getSyncSummary().then(setSummary).catch(() => setSummary({ queued: 0, failed: 1, conflicts: 0 }))
  }
  useEffect(() => {
    refresh()
    const interval = window.setInterval(refresh, 15_000)
    return () => window.clearInterval(interval)
  }, [])
  const retry = () => {
    const desktop = window.worklyDesktop
    if (!desktop) return
    void desktop.syncNow().finally(refresh)
  }
  const failed = summary?.failed ?? 0
  const queued = summary?.queued ?? 0
  const conflicts = summary?.conflicts ?? 0
  const text = !window.worklyDesktop
    ? (language === 'vi' ? 'Lưu trong bản xem trước' : 'Saved in preview')
    : !auth.configured
      ? (language === 'vi' ? 'Lưu offline trên thiết bị' : 'Saved offline on this device')
      : auth.offline
        ? (language === 'vi' ? 'Đang offline · dữ liệu vẫn được lưu trên thiết bị' : 'Offline · data remains saved on this device')
      : conflicts > 0
        ? (language === 'vi' ? `${conflicts} xung đột cần xem lại` : `${conflicts} conflicts need review`)
        : failed > 0
        ? (language === 'vi' ? `${failed} mục cần đồng bộ lại` : `${failed} items need retry`)
        : queued > 0
          ? (language === 'vi' ? `${queued} mục đang chờ đồng bộ` : `${queued} items queued to sync`)
          : (language === 'vi' ? 'Đồng bộ không có thay đổi chờ' : 'Sync queue clear')
  const click = conflicts > 0 ? onOpenConflicts : retry
  return <button className={`sync-pill ${failed > 0 || conflicts > 0 ? 'error' : queued > 0 ? 'queued' : ''}`} onClick={click} title={conflicts > 0 ? (language === 'vi' ? 'Xem xung đột đồng bộ' : 'Review sync conflicts') : (language === 'vi' ? 'Thử đồng bộ ngay' : 'Try sync now')}><span className="sync-dot" />{text}</button>
}

function SyncConflictsDialog({ onClose }: { onClose: () => void }) {
  const { state } = useAppStore()
  const account = state!.account!
  const language = account.language
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let mounted = true
    const desktop = window.worklyDesktop
    if (!desktop) {
      const fallback = window.setTimeout(() => { if (mounted) setLoading(false) }, 0)
      return () => { mounted = false; window.clearTimeout(fallback) }
    }
    void desktop.getSyncConflicts(100).then((items) => {
      if (mounted) setConflicts(items)
    }).catch(() => {
      if (mounted) setMessage(language === 'vi' ? 'Không thể đọc danh sách xung đột.' : 'Could not read sync conflicts.')
    }).finally(() => {
      if (mounted) setLoading(false)
    })
    return () => { mounted = false }
  }, [language, refreshKey])

  const resolve = async (conflict: SyncConflict) => {
    const desktop = window.worklyDesktop
    if (!desktop) return
    try {
      const result = await desktop.resolveSyncConflict(conflict.id)
      if (!result.resolved) {
        setMessage(language === 'vi' ? 'Xung đột này đã được xử lý ở nơi khác.' : 'This conflict was already handled elsewhere.')
      }
      setRefreshKey((value) => value + 1)
    } catch {
      setMessage(language === 'vi' ? 'Không thể cập nhật trạng thái xung đột.' : 'Could not update the conflict state.')
    }
  }

  const applyCloudVersion = async (conflict: SyncConflict) => {
    const desktop = window.worklyDesktop
    if (!desktop) return
    try {
      const result = await desktop.acceptRemoteSyncConflict(conflict.id)
      if (!result.accepted) {
        setMessage(language === 'vi'
          ? `Không thể dùng bản cloud an toàn (${result.reason ?? 'unknown'}). Bản local vẫn được giữ.`
          : `The cloud version could not be applied safely (${result.reason ?? 'unknown'}). The local version was kept.`)
      }
      setRefreshKey((value) => value + 1)
    } catch {
      setMessage(language === 'vi' ? 'Không thể áp dụng bản cloud.' : 'Could not apply the cloud version.')
    }
  }

  const entityName = (entity: SyncConflict['entityType']) => {
    const labels = language === 'vi'
      ? { account: 'hồ sơ', project: 'dự án', work_session: 'phiên làm việc', payment: 'thanh toán', goal: 'mục tiêu', preferences: 'bố cục' }
      : { account: 'profile', project: 'project', work_session: 'work session', payment: 'payment', goal: 'goal', preferences: 'layout' }
    return labels[entity]
  }

  return <Modal title={language === 'vi' ? 'Xung đột đồng bộ' : 'Sync conflicts'} subtitle={language === 'vi' ? 'TimeFarm giữ nguyên bản local đang chờ gửi thay vì tự động ghi đè nó bằng thay đổi từ thiết bị khác.' : 'TimeFarm retained your pending local data rather than automatically overwriting it with a change from another device.'} onClose={onClose}>
    {loading ? <div className="empty-state compact"><LoaderCircle size={20} className="spin" /><div><strong>{language === 'vi' ? 'Đang kiểm tra…' : 'Checking…'}</strong></div></div> : conflicts.length === 0 ? <EmptyState compact icon={<Check />} title={language === 'vi' ? 'Không còn xung đột mở' : 'No open conflicts'} description={language === 'vi' ? 'Các thay đổi local và cloud hiện không cần bạn xem lại.' : 'Your local and cloud changes do not need review right now.'} /> : <div className="sync-conflict-list">{conflicts.map((conflict) => <article key={conflict.id} className="sync-conflict-row"><div><strong>{entityName(conflict.entityType)}</strong><span>{language === 'vi' ? `Phát hiện ${formatDate(conflict.detectedAt, language, account.timezone)} · ${conflict.reason}` : `Detected ${formatDate(conflict.detectedAt, language, account.timezone)} · ${conflict.reason}`}</span><small>{language === 'vi' ? 'Chọn giữ bản local để gửi lại, hoặc dùng bản cloud nếu thay đổi đó an toàn.' : 'Keep the local version to retry it, or use the cloud version when that change is safe.'}</small></div><div className="sync-conflict-actions"><button className="button ghost compact" onClick={() => { void resolve(conflict) }}>{language === 'vi' ? 'Giữ local & gửi lại' : 'Keep local & retry'}</button><button className="button ghost compact" onClick={() => { void applyCloudVersion(conflict) }}>{language === 'vi' ? 'Dùng bản cloud' : 'Use cloud version'}</button></div></article>)}</div>}
    {message && <p className="form-error">{message}</p>}
    <div className="modal-actions"><button className="button primary" onClick={onClose}><Check size={16} /> {language === 'vi' ? 'Đóng' : 'Close'}</button></div>
  </Modal>
}

function ThemeIcon() {
  const { state } = useAppStore()
  return state?.preferences.theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />
}

function ActiveStatus({ session, language }: { session: WorkSession; language: AppLanguage }) {
  const { state } = useAppStore()
  const now = useCurrentTime()
  const project = state?.projects.find((item) => item.id === session.projectId)
  return <span className={`active-status ${session.status}`}><span className="live-dot" />{session.status === 'paused' ? label(language, 'paused') : label(language, 'active')} · <strong>{formatDuration(activeDurationMs(session, now), true, language)}</strong> · {project?.name ?? label(language, 'noProject')}</span>
}

const dashboardWidgetOrder: DashboardWidgetId[] = ['timer', 'goals', 'earningsTrend', 'hoursTrend', 'projectBreakdown', 'rateTrend', 'cumulativeEarnings', 'comparison']

const dashboardWidgetLabels: Record<DashboardWidgetId, { vi: string; en: string }> = {
  timer: { vi: 'Đồng hồ làm việc', en: 'Work timer' },
  goals: { vi: 'Mục tiêu', en: 'Goals' },
  earningsTrend: { vi: 'Thu nhập 7 ngày', en: '7-day earnings' },
  hoursTrend: { vi: 'Thời gian 7 ngày', en: '7-day work time' },
  projectBreakdown: { vi: 'Thời gian theo dự án', en: 'Time by project' },
  rateTrend: { vi: 'Thu nhập / giờ', en: 'Earnings / hour' },
  cumulativeEarnings: { vi: 'Thu nhập tích luỹ', en: 'Cumulative earnings' },
  comparison: { vi: 'So sánh kỳ trước', en: 'Previous-period comparison' },
}

const dashboardDefaultSizes: Record<DashboardWidgetId, DashboardWidgetSize> = {
  timer: 'large', goals: 'medium', earningsTrend: 'medium', hoursTrend: 'medium', projectBreakdown: 'medium', rateTrend: 'small', cumulativeEarnings: 'small', comparison: 'medium',
}

function normalizedDashboardOrder(order: DashboardWidgetId[]): DashboardWidgetId[] {
  const known = new Set(dashboardWidgetOrder)
  const selected = order.filter((id, index) => known.has(id) && order.indexOf(id) === index)
  return [...selected, ...dashboardWidgetOrder.filter((id) => !selected.includes(id))]
}

function DashboardPage({ onStart, onComplete, onAddGoal, onEditGoal, onCustomize }: { onStart: () => void; onComplete: (session: WorkSession) => void; onAddGoal: () => void; onEditGoal: (goal: Goal) => void; onCustomize: () => void }) {
  const { state, pauseSession, resumeSession } = useAppStore()
  const app = state!
  const account = app.account!
  const language = account.language
  const now = useCurrentTime()
  const active = getActiveSession(app.sessions)
  const at = now
  const todayRange = currentDayRange(account.timezone, at)
  const completedToday = rangeSummary(app.sessions, account.currency, todayRange)
  const activeToday = active ? sessionContribution(active, todayRange) : { activeMs: 0, earningsMinor: 0 }
  const todayDuration = completedToday.activeMs + activeToday.activeMs
  const todayEarnings = completedToday.earningsMinor
  const todayRate = completedToday.effectiveHourlyMinor
  const dashboardRange = resolveRange('7d', account.timezone, at)
  const series = rangeDailySeries(app.sessions, account.currency, dashboardRange, language)
  const breakdown = projectBreakdown(app.sessions, app.projects, account.currency, resolveRange('30d', account.timezone, at))
  const comparison = periodComparison(app.sessions, account.currency, dashboardRange)
  const rateSeries = series.map((point) => ({ label: point.label, value: point.earningActiveMs < 60_000 ? 0 : Math.round(point.earningsMinor / (point.earningActiveMs / 3_600_000)) }))
  const cumulative = cumulativeSeries(series)
  const order = normalizedDashboardOrder(app.preferences.dashboardWidgetOrder)
  const hidden = new Set(app.preferences.dashboardHiddenWidgets)
  const sizes = { ...dashboardDefaultSizes, ...app.preferences.dashboardWidgetSizes }
  const widgets: Record<DashboardWidgetId, ReactNode> = {
    timer: <TimerCard session={active} language={language} onStart={onStart} onPause={pauseSession} onResume={resumeSession} onComplete={onComplete} projects={app.projects} />,
    goals: <GoalsCard onAdd={onAddGoal} onEdit={onEditGoal} />,
    earningsTrend: <ChartCard title={language === 'vi' ? 'Thu nhập trong 7 ngày' : 'Earnings over 7 days'} subtitle={language === 'vi' ? `Chỉ hiển thị ${account.currency}; không tự quy đổi` : `Showing ${account.currency}; no automatic conversion`}><TrendChart points={series.map((point) => ({ label: point.label, value: point.earningsMinor }))} money currency={account.currency} language={language} /></ChartCard>,
    hoursTrend: <ChartCard title={language === 'vi' ? 'Thời gian làm việc' : 'Work time'} subtitle={language === 'vi' ? 'Nhịp độ 7 ngày gần nhất' : 'Your last 7 days'}><TrendChart points={series.map((point) => ({ label: point.label, value: point.activeMs / 3_600_000 }))} language={language} /></ChartCard>,
    projectBreakdown: <ProjectBreakdownCard entries={breakdown} language={language} currency={account.currency} />,
    rateTrend: <ChartCard title={language === 'vi' ? 'Thu nhập / giờ' : 'Earnings / hour'} subtitle={language === 'vi' ? 'Theo từng ngày có thời gian làm việc' : 'Per active day'}><TrendChart points={rateSeries} money currency={account.currency} language={language} /></ChartCard>,
    cumulativeEarnings: <ChartCard title={language === 'vi' ? 'Thu nhập tích luỹ' : 'Cumulative earnings'} subtitle={language === 'vi' ? '7 ngày gần nhất' : 'Last 7 days'}><TrendChart points={cumulative.map((point) => ({ label: point.label, value: point.earningsMinor }))} money currency={account.currency} language={language} /></ChartCard>,
    comparison: <PeriodComparisonCard comparison={comparison} language={language} title={language === 'vi' ? 'Thời gian so với kỳ trước' : 'Work time vs prior period'} metric="time" />,
  }

  return <>
    <div className="page-heading heading-with-action">
      <div><span className="eyebrow">{language === 'vi' ? 'WORKSPACE' : 'WORKSPACE'}</span><h1>{label(language, 'dashboard')}</h1><p>{language === 'vi' ? 'Một nhịp nhìn gọn gàng cho thời gian, thu nhập và động lực hôm nay.' : 'A calm view of today’s time, earnings, and momentum.'}</p></div>
      <div className="dashboard-heading-actions"><button className="button ghost compact" onClick={onCustomize}><Settings size={16} /> {language === 'vi' ? 'Tuỳ chỉnh' : 'Customize'}</button>{!active && <button className="button primary" onClick={onStart}><Play size={17} fill="currentColor" /> {label(language, 'start')}</button>}</div>
    </div>
    <section className="metric-grid">
      <MetricCard icon={<Clock3 />} label={label(language, 'workTime')} value={formatDuration(todayDuration, true, language)} hint={label(language, 'today')} tone="blue" />
      <MetricCard icon={<CircleDollarSign />} label={label(language, 'earnings')} value={formatMoney({ amountMinor: todayEarnings, currency: account.currency }, language)} hint={label(language, 'today')} tone="green" />
      <MetricCard icon={<TrendingUp />} label={label(language, 'efficiency')} value={todayRate === null ? '—' : formatMoney({ amountMinor: todayRate, currency: account.currency }, language)} hint={todayRate === null ? (language === 'vi' ? 'Cần một phiên hoàn tất' : 'Complete a session to calculate') : language === 'vi' ? 'Từ các phiên đã chốt' : 'From completed sessions'} tone="violet" />
      <MetricCard icon={<History />} label={label(language, 'sessions')} value={String(completedToday.sessionCount)} hint={language === 'vi' ? 'Đã hoàn tất hôm nay' : 'Completed today'} tone="orange" />
    </section>
    <section className="dashboard-grid dashboard-custom-grid">
      {order.filter((id) => !hidden.has(id)).map((id) => <div className={`dashboard-widget size-${sizes[id]}`} key={id}>{widgets[id]}</div>)}
    </section>
  </>
}

function MetricCard({ icon, label: title, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint: string; tone: string }) {
  return <article className={`metric-card ${tone}`}><div className="metric-icon">{icon}</div><div><span>{title}</span><strong>{value}</strong><small>{hint}</small></div></article>
}

function TimerCard({ session, language, onStart, onPause, onResume, onComplete, projects }: { session?: WorkSession; language: AppLanguage; onStart: () => void; onPause: () => void; onResume: () => void; onComplete: (session: WorkSession) => void; projects: Project[] }) {
  const now = useCurrentTime(Boolean(session))
  const project = projects.find((item) => item.id === session?.projectId)
  if (!session) return <article className="timer-card idle"><div className="timer-orb"><Play size={31} fill="currentColor" /></div><div><span className="eyebrow">{language === 'vi' ? 'PHIÊN LÀM VIỆC' : 'WORK SESSION'}</span><h2>{language === 'vi' ? 'Bạn sẵn sàng bắt đầu?' : 'Ready when you are.'}</h2><p>{language === 'vi' ? 'Chọn một dự án hoặc ghi nhận một phiên độc lập.' : 'Choose a project, or track an independent work period.'}</p><button className="button primary" onClick={onStart}><Play size={17} fill="currentColor" /> {label(language, 'start')}</button></div></article>
  const isPaused = session.status === 'paused'
  return <article className={`timer-card ${isPaused ? 'paused' : ''}`}><div className="timer-summary"><span className="eyebrow">{isPaused ? label(language, 'paused') : language === 'vi' ? 'ĐANG TÍNH GIỜ' : 'TRACKING NOW'}</span><h2>{project?.icon ?? '◌'} {project?.name ?? label(language, 'noProject')}</h2><p>{language === 'vi' ? `Bắt đầu lúc ${formatClockTime(session.startedAt, language, session.timezone)} · ${session.timezone}` : `Started ${formatClockTime(session.startedAt, language, session.timezone)} · ${session.timezone}`}</p></div><div className="timer-clock"><span>{formatDuration(activeDurationMs(session, now), true, language)}</span><small>{isPaused ? (language === 'vi' ? 'Đã dừng đếm' : 'Timer paused') : (language === 'vi' ? 'Đang ghi nhận thời gian thực' : 'Tracking active time')}</small></div><div className="timer-actions">{isPaused ? <button className="button primary" onClick={onResume}><Play size={16} fill="currentColor" /> {label(language, 'resume')}</button> : <button className="button ghost" onClick={onPause}><Pause size={16} fill="currentColor" /> {label(language, 'pause')}</button>}<button className="button danger-quiet" onClick={() => onComplete(session)}><Square size={15} fill="currentColor" /> {label(language, 'stop')}</button></div></article>
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <article className="panel chart-card"><div className="panel-heading"><div><h3>{title}</h3><p>{subtitle}</p></div><button className="icon-button" aria-label="Chart options">•••</button></div>{children}</article>
}

function TrendChart({ points, money, currency, language }: { points: { label: string; value: number }[]; money?: boolean; currency?: CurrencyCode; language: AppLanguage }) {
  const max = Math.max(...points.map((point) => point.value), 1)
  const width = 560
  const height = 160
  const padding = 14
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0
  const pointString = points.map((point, index) => `${padding + index * step},${height - padding - ((point.value / max) * (height - padding * 2))}`).join(' ')
  const current = points.at(-1)?.value ?? 0
  const markerStride = Math.max(1, Math.ceil(points.length / 42))
  const labelStride = Math.max(1, Math.ceil(points.length / 8))
  const display = money && currency ? formatMoney({ amountMinor: current, currency }, language) : `${current.toFixed(current >= 10 ? 0 : 1)}h`
  return <div className="trend-wrap"><div className="chart-current">{display}<small>{language === 'vi' ? 'mốc mới nhất' : 'latest point'}</small></div><svg className="trend-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Trend chart"><defs><linearGradient id="area-gradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity="0.22" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs><line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} stroke="currentColor" opacity=".16" /><polygon points={`${padding},${height - padding} ${pointString} ${width - padding},${height - padding}`} fill="url(#area-gradient)" /><polyline points={pointString} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{points.map((point, index) => (index % markerStride === 0 || index === points.length - 1) && <circle key={point.label} cx={padding + index * step} cy={height - padding - ((point.value / max) * (height - padding * 2))} r="3.5" fill="var(--panel)" stroke="currentColor" strokeWidth="2" />)}</svg><div className="chart-labels">{points.map((point, index) => <span key={point.label}>{index % labelStride === 0 || index === points.length - 1 ? point.label : ''}</span>)}</div></div>
}

function ProjectBreakdownCard({
  entries,
  language,
  currency,
  title,
  subtitle,
  mode = 'time',
}: {
  entries: ReturnType<typeof projectBreakdown>
  language: AppLanguage
  currency: CurrencyCode
  title?: string
  subtitle?: string
  mode?: 'time' | 'earnings'
}) {
  const { state } = useAppStore()
  const projects = state!.projects
  const isEarnings = mode === 'earnings'
  const max = Math.max(...entries.map((entry) => isEarnings ? entry.earningsMinor : entry.activeMs), 1)
  return <article className="panel project-breakdown"><div className="panel-heading"><div><h3>{title ?? (language === 'vi' ? 'Dự án chiếm thời gian' : 'Time by project')}</h3><p>{subtitle ?? (language === 'vi' ? '30 ngày gần nhất' : 'Last 30 days')}</p></div><FolderKanban size={18} /></div>{entries.length === 0 ? <EmptyState compact icon={<FolderKanban />} title={language === 'vi' ? 'Chưa có dữ liệu dự án' : 'No project data yet'} description={language === 'vi' ? 'Bắt đầu phiên có gắn dự án để theo dõi.' : 'Start a project-linked session to see a breakdown.'} /> : <div className="breakdown-list">{entries.slice(0, 5).map((entry) => {
    const primary = isEarnings ? entry.earningsMinor : entry.activeMs
    const secondary = isEarnings ? formatDuration(entry.activeMs, true, language) : entry.earningsMinor > 0 ? formatMoney({ amountMinor: entry.earningsMinor, currency }, language) : null
    const project = entry.projectId ? projects.find((item) => item.id === entry.projectId) : undefined
    return <div className="breakdown-row" key={entry.projectId ?? 'none'}><div className="breakdown-title"><span className="color-dot" style={{ background: entry.color }} aria-hidden="true" /> <strong><span aria-hidden="true" style={{ color: entry.color }}>{project?.icon ?? '◌'}</span> {entry.name}</strong><span>{isEarnings ? formatMoney({ amountMinor: primary, currency }, language) : formatDuration(primary, true, language)}</span></div><div className="progress-track"><i style={{ width: `${Math.max(4, (primary / max) * 100)}%`, background: entry.color }} /></div>{secondary && <small>{secondary}</small>}</div>
  })}</div>}</article>
}

function GoalsCard({ onAdd, onEdit }: { onAdd: () => void; onEdit: (goal: Goal) => void }) {
  const { state, deleteGoal } = useAppStore()
  const app = state!
  const account = app.account!
  const language = account.language
  const [error, setError] = useState('')
  const removeGoal = async (goalId: string) => {
    if (!window.confirm(language === 'vi' ? 'Xóa mục tiêu này?' : 'Delete this goal?')) return
    const result = await deleteGoal(goalId)
    setError(result.ok ? '' : result.message)
  }
  return <article className="panel goals-card"><div className="panel-heading"><div><h3>{language === 'vi' ? 'Mục tiêu' : 'Goals'}</h3><p>{language === 'vi' ? 'Theo tiến độ thực tế' : 'Based on actual progress'}</p></div><button className="icon-button" onClick={onAdd} aria-label="Add goal"><Plus size={18} /></button></div>{app.goals.length === 0 ? <EmptyState compact icon={<Target />} title={language === 'vi' ? 'Chưa có mục tiêu' : 'No goals yet'} description={language === 'vi' ? 'Đặt một mục tiêu nhỏ để có hướng đi rõ hơn.' : 'Set a small target to make progress visible.'} action={<button className="text-button" onClick={onAdd}>{language === 'vi' ? 'Tạo mục tiêu' : 'Create goal'}</button>} /> : <div className="goals-list">{app.goals.map((goal) => <GoalRow key={goal.id} goal={goal} language={language} onEdit={() => onEdit(goal)} onDelete={() => { void removeGoal(goal.id) }} />)}</div>}{error && <p className="form-error">{error}</p>}</article>
}

function GoalRow({ goal, language, onEdit, onDelete }: { goal: Goal; language: AppLanguage; onEdit: () => void; onDelete: () => void }) {
  const { state } = useAppStore()
  const app = state!
  const account = app.account!
  const progress = calculateGoalProgress(goal, app.sessions, app.projects, account.currency, new Date(), account.timezone)
  const unit = goalUnit(goal.kind)
  const value = formatGoalProgressValue(progress.current, progress.target, unit, account.currency, language)
  const remaining = formatGoalRemaining(progress.remaining, unit, account.currency, language)
  const statusText = goalStatusLabel(progress.status, language)
  return <div className="goal-row"><div className="goal-row-head"><strong>{goalLabels[goal.kind][language]}</strong><span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><button type="button" className="text-button" onClick={onEdit} aria-label={language === 'vi' ? 'Chỉnh sửa mục tiêu' : 'Edit goal'}>{label(language, 'edit')}</button><button type="button" className="mini-remove" onClick={onDelete} aria-label="Delete goal"><X size={13} /></button></span></div><div className="goal-progress"><i style={{ width: `${progress.percentage}%` }} /></div><small>{value} · {Math.round(progress.percentage)}% · {remaining}</small><GoalPace progress={progress} unit={unit} currency={account.currency} timezone={account.timezone} language={language} /><span className={`goal-status ${progress.status}`}>{statusText}</span></div>
}

function formatGoalProgressValue(current: number, target: number, unit: ReturnType<typeof goalUnit>, currency: CurrencyCode, language: AppLanguage): string {
  if (unit === 'hours') return `${current.toFixed(1)} / ${target}h`
  if (unit === 'moneyMinor') return `${formatMoney({ amountMinor: current, currency }, language)} / ${formatMoney({ amountMinor: target, currency }, language)}`
  return `${current} / ${target}`
}

function formatGoalRemaining(value: number, unit: ReturnType<typeof goalUnit>, currency: CurrencyCode, language: AppLanguage): string {
  const text = formatGoalUnitValue(value, unit, currency, language)
  return language === 'vi' ? `Còn ${text}` : `${text} remaining`
}

function formatGoalUnitValue(value: number, unit: ReturnType<typeof goalUnit>, currency: CurrencyCode, language: AppLanguage): string {
  if (unit === 'hours') return `${value.toFixed(1)}h`
  if (unit === 'moneyMinor') return formatMoney({ amountMinor: Math.round(value), currency }, language)
  return String(Math.round(value))
}

function GoalPace({ progress, unit, currency, timezone, language }: { progress: ReturnType<typeof calculateGoalProgress>; unit: ReturnType<typeof goalUnit>; currency: CurrencyCode; timezone: string; language: AppLanguage }) {
  if (progress.expectedCurrent === null) return <small className="goal-pace">{language === 'vi' ? 'Chưa có nhịp dự kiến' : 'No pace estimate yet'}</small>
  const expected = formatGoalUnitValue(progress.expectedCurrent, unit, currency, language)
  const pace = progress.pacePerHour === null ? null : formatGoalUnitValue(progress.pacePerHour, unit, currency, language)
  const projected = progress.projectedCompletionAt ? `${formatDate(progress.projectedCompletionAt, language, timezone)} ${formatClockTime(progress.projectedCompletionAt, language, timezone)}` : null
  return <small className="goal-pace">{language === 'vi'
    ? <>Mốc kỳ vọng: {expected}{pace && <> · Nhịp hiện tại: {pace}/giờ</>}{projected && <> · Ước tính hoàn thành: {projected}</>}</>
    : <>Expected by now: {expected}{pace && <> · Current pace: {pace}/hour</>}{projected && <> · Estimated completion: {projected}</>}</>}</small>
}

function goalStatusLabel(status: ReturnType<typeof calculateGoalProgress>['status'], language: AppLanguage): string {
  const labels = language === 'vi'
    ? { complete: 'Đã đạt', ahead: 'Vượt nhịp', behind: 'Chậm nhịp', on_track: 'Đúng nhịp', insufficient_data: 'Chưa đủ dữ liệu' }
    : { complete: 'Complete', ahead: 'Ahead', behind: 'Behind', on_track: 'On track', insufficient_data: 'Not enough data' }
  return labels[status]
}

function DashboardCustomizeDialog({ onClose }: { onClose: () => void }) {
  const { state, updatePreferences } = useAppStore()
  const app = state!
  const language = app.account!.language
  const order = normalizedDashboardOrder(app.preferences.dashboardWidgetOrder)
  const hidden = new Set(app.preferences.dashboardHiddenWidgets)
  const move = (id: DashboardWidgetId, direction: -1 | 1) => {
    const index = order.indexOf(id)
    const target = index + direction
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    updatePreferences({ dashboardWidgetOrder: next })
  }
  const toggle = (id: DashboardWidgetId) => {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    updatePreferences({ dashboardHiddenWidgets: [...next] })
  }
  const setSize = (id: DashboardWidgetId, size: DashboardWidgetSize) => updatePreferences({ dashboardWidgetSizes: { ...app.preferences.dashboardWidgetSizes, [id]: size } })
  const reset = () => updatePreferences({ dashboardHiddenWidgets: [], dashboardWidgetOrder, dashboardWidgetSizes: {} })
  return <Modal title={language === 'vi' ? 'Tuỳ chỉnh dashboard' : 'Customize dashboard'} subtitle={language === 'vi' ? 'Chỉ chọn trong các widget được định nghĩa sẵn; thứ tự, kích thước và trạng thái ẩn được lưu theo hồ sơ.' : 'Choose only from predefined widgets. Order, size, and visibility are saved with your profile.'} onClose={onClose}><div className="dashboard-customize-list">{order.map((id, index) => <div className="dashboard-customize-row" key={id}><label><input type="checkbox" checked={!hidden.has(id)} onChange={() => toggle(id)} /><span>{dashboardWidgetLabels[id][language]}</span></label><div className="dashboard-customize-controls"><button className="icon-button" disabled={index === 0} onClick={() => move(id, -1)} aria-label="Move widget up">↑</button><button className="icon-button" disabled={index === order.length - 1} onClick={() => move(id, 1)} aria-label="Move widget down">↓</button><select value={app.preferences.dashboardWidgetSizes[id] ?? dashboardDefaultSizes[id]} onChange={(event) => setSize(id, event.target.value as DashboardWidgetSize)} aria-label="Widget size"><option value="small">{language === 'vi' ? 'Nhỏ' : 'Small'}</option><option value="medium">{language === 'vi' ? 'Vừa' : 'Medium'}</option><option value="large">{language === 'vi' ? 'Lớn' : 'Large'}</option></select></div></div>)}</div><div className="modal-actions"><button className="button ghost" onClick={reset}><RotateCcw size={16} /> {language === 'vi' ? 'Khôi phục mặc định' : 'Reset defaults'}</button><button className="button primary" onClick={onClose}><Check size={16} /> {language === 'vi' ? 'Xong' : 'Done'}</button></div></Modal>
}

function ProjectsPage({ onNew, onEdit, onRecordPayment }: { onNew: () => void; onEdit: (project: Project) => void; onRecordPayment: (project: Project) => void }) {
  const { state, setProjectStatus, startSession } = useAppStore()
  const app = state!
  const language = app.account!.language
  const [filter, setFilter] = useState<'all' | ProjectStatus>('all')
  const projects = app.projects.filter((project) => filter === 'all' || project.status === filter)
  const startProject = async (project: Project) => {
    const result = await startSession(project.id)
    if (!result.ok) window.alert(result.message)
  }
  const setStatus = async (project: Project, status: ProjectStatus) => {
    const result = await setProjectStatus(project.id, status)
    if (!result.ok) window.alert(result.message)
  }
  return <>
    <div className="page-heading heading-with-action"><div><span className="eyebrow">{language === 'vi' ? 'TỔ CHỨC CÔNG VIỆC' : 'ORGANIZE WORK'}</span><h1>{label(language, 'projects')}</h1><p>{language === 'vi' ? 'Mỗi phiên có thể gắn với một dự án — nhưng không bắt buộc.' : 'Every session can belong to a project — but never has to.'}</p></div><button className="button primary" onClick={onNew}><Plus size={18} /> {language === 'vi' ? 'Dự án mới' : 'New project'}</button></div>
    <div className="filter-row">{(['all', 'active', 'paused', 'completed'] as const).map((status) => <button key={status} onClick={() => setFilter(status)} className={filter === status ? 'filter active' : 'filter'}>{status === 'all' ? (language === 'vi' ? 'Tất cả' : 'All') : label(language, status)}</button>)}</div>
    {projects.length === 0 ? <EmptyState icon={<FolderKanban />} title={language === 'vi' ? 'Chưa có dự án nào' : 'No projects yet'} description={language === 'vi' ? 'Tạo dự án đầu tiên hoặc bắt đầu một phiên không gắn dự án.' : 'Create your first project or start an unassigned session.'} action={<button className="button primary" onClick={onNew}><Plus size={17} /> {language === 'vi' ? 'Tạo dự án' : 'Create project'}</button>} /> : <div className="project-grid">{projects.map((project) => {
      const payments = app.payments.filter((payment) => payment.projectId === project.id)
      const received = groupedMoney(payments.map((payment) => payment.money)).map((money) => formatMoney(money, language)).join(' · ')
      return <article className="project-card" key={project.id}><div className="project-card-head"><span className="project-icon" style={{ background: `${project.color}1e`, color: project.color }}>{project.icon}</span><span className={`status-badge ${project.status}`}>{label(language, project.status)}</span></div><h3>{project.name}</h3><p>{paymentModelLabels[project.paymentModel][language]}</p>{project.expectedMoney && <strong className="project-money">{formatMoney(project.expectedMoney, language)}</strong>}<small className="project-payment-summary">{payments.length === 0 ? (language === 'vi' ? 'Chưa ghi nhận thanh toán' : 'No payments recorded') : `${payments.length} ${language === 'vi' ? 'khoản thanh toán' : 'payments'} · ${received}`}</small><div className="project-card-footer"><button className="text-button" onClick={() => onEdit(project)}>{label(language, 'edit')}</button><button className="text-button" onClick={() => onRecordPayment(project)}>{language === 'vi' ? 'Ghi nhận tiền' : 'Record payment'}</button>{project.status === 'completed' ? <button className="text-button" onClick={() => setStatus(project, 'active')}>{language === 'vi' ? 'Mở lại' : 'Reopen'}</button> : <><button className="text-button" onClick={() => setStatus(project, project.status === 'active' ? 'paused' : 'active')}>{project.status === 'active' ? label(language, 'pause') : label(language, 'resume')}</button><button className="text-button" onClick={() => setStatus(project, 'completed')}>{language === 'vi' ? 'Hoàn tất' : 'Complete'}</button><button className="icon-button colored" aria-label="Start on project" onClick={() => startProject(project)}><Play size={16} fill="currentColor" /></button></>}</div></article>
    })}</div>}
  </>
}

function HistoryPage({ onEdit }: { onEdit: (session: WorkSession) => void }) {
  const { state } = useAppStore()
  const app = state!
  const language = app.account!.language
  const [query, setQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [currencyFilter, setCurrencyFilter] = useState<'all' | CurrencyCode>('all')
  const sorted = [...app.sessions].filter((session) => session.status === 'completed').sort((a, b) => new Date(b.endedAt ?? b.startedAt).getTime() - new Date(a.endedAt ?? a.startedAt).getTime())
  const latestId = sorted[0]?.id
  const visible = sorted.filter((session) => {
    const project = app.projects.find((item) => item.id === session.projectId)
    const matchesText = `${project?.name ?? ''} ${session.note ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    const matchesProject = projectFilter === 'all' || (projectFilter === 'unassigned' ? !session.projectId : session.projectId === projectFilter)
    const matchesCurrency = currencyFilter === 'all' || session.earnings?.currency === currencyFilter
    return matchesText && matchesProject && matchesCurrency
  })
  return <>
    <div className="page-heading"><span className="eyebrow">{language === 'vi' ? 'NHẬT KÝ CÔNG VIỆC' : 'WORK LOG'}</span><h1>{label(language, 'history')}</h1><p>{language === 'vi' ? 'Lịch sử đã chốt được bảo vệ để số liệu luôn đáng tin cậy.' : 'Completed history stays protected so your numbers remain trustworthy.'}</p></div>
    <div className="history-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={language === 'vi' ? 'Tìm dự án hoặc ghi chú…' : 'Search projects or notes…'} /><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} aria-label={language === 'vi' ? 'Lọc theo dự án' : 'Filter by project'}><option value="all">{language === 'vi' ? 'Tất cả dự án' : 'All projects'}</option><option value="unassigned">{label(language, 'noProject')}</option>{app.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value as 'all' | CurrencyCode)} aria-label={language === 'vi' ? 'Lọc theo tiền tệ' : 'Filter by currency'}><option value="all">{language === 'vi' ? 'Tất cả tiền tệ' : 'All currencies'}</option>{Object.keys(currencyMetadata).map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select><span>{visible.length} {language === 'vi' ? 'phiên' : 'sessions'}</span></div>
    {visible.length === 0 ? <EmptyState icon={<History />} title={language === 'vi' ? 'Chưa có phiên hoàn tất' : 'No completed sessions'} description={language === 'vi' ? 'Khi kết thúc phiên, thu nhập và ghi chú sẽ xuất hiện tại đây.' : 'When you finish a session, its earnings and note will appear here.'} /> : <div className="history-list">{visible.map((session) => <SessionRow key={session.id} session={session} canEdit={session.id === latestId} onEdit={() => onEdit(session)} />)}</div>}
  </>
}

function SessionRow({ session, canEdit, onEdit }: { session: WorkSession; canEdit: boolean; onEdit: () => void }) {
  const { state } = useAppStore()
  const app = state!
  const language = app.account!.language
  const project = app.projects.find((item) => item.id === session.projectId)
  const statusLabel = session.status === 'running' ? label(language, 'active') : label(language, session.status)
  return <article className="session-row"><div className="session-date"><strong>{formatDate(session.endedAt ?? session.startedAt, language, session.timezone)}</strong><span>{formatClockTime(session.startedAt, language, session.timezone)} — {formatClockTime(session.endedAt ?? session.startedAt, language, session.timezone)}</span><small className="session-status">{statusLabel}</small></div><div className="session-project"><span className="color-dot" style={{ background: project?.color ?? '#94a3b8' }} aria-hidden="true" /><span aria-hidden="true" style={{ color: project?.color ?? '#94a3b8' }}>{project?.icon ?? '◌'}</span>{project?.name ?? label(language, 'noProject')}</div><div className="session-duration"><Clock3 size={15} /> {formatDuration(activeDurationMs(session), true, language)}</div><div className="session-money">{formatMoney(session.earnings, language)}</div><div className="session-note">{session.note || '—'}</div>{canEdit ? <button className="text-button" onClick={onEdit}>{label(language, 'edit')}</button> : <span className="locked">{language === 'vi' ? 'Đã khóa' : 'Locked'}</span>}</article>
}

const analyticsPresets: { id: AnalyticsRangePreset; label: string }[] = [
  { id: '7d', label: '7D' }, { id: '30d', label: '30D' }, { id: '1m', label: '1M' },
  { id: '3m', label: '3M' }, { id: '6m', label: '6M' }, { id: '1y', label: '1Y' },
]

function AnalyticsPage() {
  const { state } = useAppStore()
  const app = state!
  const account = app.account!
  const language = account.language
  const [preset, setPreset] = useState<AnalyticsRangePreset>('30d')
  const clock = useCurrentTime()
  const range = resolveRange(preset, account.timezone, clock)
  const summary = rangeSummary(app.sessions, account.currency, range)
  const series = rangeDailySeries(app.sessions, account.currency, range, language)
  const cumulative = cumulativeSeries(series)
  const comparison = periodComparison(app.sessions, account.currency, range)
  const projects = projectBreakdown(app.sessions, app.projects, account.currency, range)
  const efficiency = projectEfficiencyRanking(app.sessions, app.projects, account.currency, range)
  const durations = durationDistribution(app.sessions, range)
  const scoped = app.sessions.filter((session) => session.status === 'completed' && sessionContribution(session, range).activeMs > 0)
  const foreign = groupedMoney(scoped.map((session) => session.earnings)).filter((money) => money.currency !== account.currency)
  const dailyRates = series.map((point) => ({ label: point.label, value: point.earningActiveMs < 60_000 ? 0 : Math.round(point.earningsMinor / (point.earningActiveMs / 3_600_000)) }))
  const rangeLabel = analyticsRangeLabel(preset, language)
  return <>
    <div className="page-heading heading-with-action"><div><span className="eyebrow">{language === 'vi' ? 'THẤY XU HƯỚNG, KHÔNG ĐOÁN MÒ' : 'SEE PATTERNS, NOT GUESSWORK'}</span><h1>{label(language, 'analytics')}</h1><p>{language === 'vi' ? 'Số liệu cắt theo đúng phạm vi và múi giờ tài khoản; tiền luôn giữ ở nguyên tệ.' : 'Figures are clipped to the selected range and account timezone; money stays in its original currency.'}</p></div><div className="range-switch">{analyticsPresets.map((item) => <button key={item.id} onClick={() => setPreset(item.id)} className={preset === item.id ? 'active' : ''}>{item.label}</button>)}</div></div>
    <section className="metric-grid analytics-metrics"><MetricCard icon={<Clock3 />} label={language === 'vi' ? 'Tổng giờ hiệu dụng' : 'Active work time'} value={formatDuration(summary.activeMs, true, language)} hint={rangeLabel} tone="blue" /><MetricCard icon={<CircleDollarSign />} label={language === 'vi' ? 'Thu nhập nguyên gốc' : 'Original earnings'} value={formatMoney({ amountMinor: summary.earningsMinor, currency: account.currency }, language)} hint={`${account.currency} · ${formatMoney({ amountMinor: Math.round(summary.averageEarningsMinorPerDay), currency: account.currency }, language)} / ${language === 'vi' ? 'ngày' : 'day'}`} tone="green" /><MetricCard icon={<TrendingUp />} label={label(language, 'efficiency')} value={summary.effectiveHourlyMinor === null ? '—' : formatMoney({ amountMinor: summary.effectiveHourlyMinor, currency: account.currency }, language)} hint={summary.effectiveHourlyMinor === null ? (language === 'vi' ? 'Cần ít nhất 1 phút làm việc' : 'Needs at least one minute') : `${formatDuration(summary.averageActiveMsPerDay, true, language)} / ${language === 'vi' ? 'ngày' : 'day'}`} tone="violet" /><MetricCard icon={<History />} label={label(language, 'sessions')} value={String(summary.sessionCount)} hint={language === 'vi' ? 'Có phần thời gian thuộc phạm vi' : 'Intersecting completed sessions'} tone="orange" /></section>
    {foreign.length > 0 && <FxNotice foreign={foreign} accountCurrency={account.currency} language={language} />}
    <section className="analytics-grid">
      <ChartCard title={language === 'vi' ? 'Thu nhập theo ngày' : 'Daily earnings'} subtitle={`${account.currency} · ${rangeLabel}`}><TrendChart points={series.map((point) => ({ label: point.label, value: point.earningsMinor }))} money currency={account.currency} language={language} /></ChartCard>
      <ChartCard title={language === 'vi' ? 'Giờ làm theo ngày' : 'Daily work hours'} subtitle={language === 'vi' ? 'Chỉ tính thời gian không tạm dừng' : 'Paused intervals are excluded'}><TrendChart points={series.map((point) => ({ label: point.label, value: point.activeMs / 3_600_000 }))} language={language} /></ChartCard>
      <ChartCard title={language === 'vi' ? 'Thu nhập / giờ theo ngày' : 'Daily effective rate'} subtitle={language === 'vi' ? `Chỉ dùng thời gian của phiên có thu nhập ${account.currency}` : `Uses time only from sessions earned in ${account.currency}`}><TrendChart points={dailyRates} money currency={account.currency} language={language} /></ChartCard>
      <ChartCard title={language === 'vi' ? 'Thu nhập tích luỹ' : 'Cumulative earnings'} subtitle={`${account.currency} · ${rangeLabel}`}><TrendChart points={cumulative.map((point) => ({ label: point.label, value: point.earningsMinor }))} money currency={account.currency} language={language} /></ChartCard>
      <ChartCard title={language === 'vi' ? 'Giờ làm tích luỹ' : 'Cumulative work hours'} subtitle={rangeLabel}><TrendChart points={cumulative.map((point) => ({ label: point.label, value: point.activeMs / 3_600_000 }))} language={language} /></ChartCard>
      <ProjectBreakdownCard entries={projects} language={language} currency={account.currency} subtitle={rangeLabel} />
      <ProjectBreakdownCard entries={projects} language={language} currency={account.currency} mode="earnings" title={language === 'vi' ? 'Thu nhập theo dự án' : 'Earnings by project'} subtitle={`${account.currency} · ${rangeLabel}`} />
      <PeriodComparisonCard comparison={comparison} language={language} title={language === 'vi' ? 'So với kỳ trước: thời gian' : 'Work time vs previous period'} metric="time" />
      <PeriodComparisonCard comparison={comparison} language={language} currency={account.currency} title={language === 'vi' ? 'So với kỳ trước: thu nhập' : 'Earnings vs previous period'} metric="earnings" />
      <DurationDistributionCard entries={durations} language={language} />
      <EfficiencyRankingCard entries={efficiency} language={language} currency={account.currency} />
      <GoalProgressAnalyticsCard range={range} />
      <InsightsCard entries={projects} sessionCount={summary.sessionCount} comparison={comparison} />
    </section>
  </>
}

function FxNotice({ foreign, accountCurrency, language }: { foreign: { amountMinor: number; currency: CurrencyCode }[]; accountCurrency: CurrencyCode; language: AppLanguage }) {
  const [status, setStatus] = useState<FxStatus | null>(null)
  const [conversions, setConversions] = useState<Record<string, FxConversionResult>>({})
  const [refreshing, setRefreshing] = useState(false)
  const foreignJson = JSON.stringify(foreign)
  useEffect(() => {
    const desktop = window.worklyDesktop
    if (!desktop) return
    void desktop.getFxStatus().then(setStatus).catch(() => setStatus({ state: 'unavailable', baseCurrency: accountCurrency, provider: 'Frankfurter', fetchedAt: null, sourceDate: null, rates: {}, error: 'FX status is unavailable.' }))
  }, [accountCurrency])
  useEffect(() => {
    const desktop = window.worklyDesktop
    let active = true
    if (!desktop || !status || status.state === 'unavailable') {
      queueMicrotask(() => { if (active) setConversions({}) })
      return () => { active = false }
    }
    const source = JSON.parse(foreignJson) as { amountMinor: number; currency: string }[]
    void Promise.all(source.map(async (money) => [money.currency, await desktop.convertMoney(money, accountCurrency)] as const)).then((results) => {
      if (active) setConversions(Object.fromEntries(results))
    })
    return () => { active = false }
  }, [accountCurrency, foreignJson, status])
  const refresh = () => {
    const desktop = window.worklyDesktop
    if (!desktop) return
    setRefreshing(true)
    void desktop.refreshFxRates().then(setStatus).finally(() => setRefreshing(false))
  }
  const converted = Object.values(conversions).filter((result): result is FxConversionResult & { money: { amountMinor: number; currency: string } } => result.ok && Boolean(result.money))
  const source = foreign.map((money) => formatMoney(money, language)).join(' · ')
  if (!window.worklyDesktop) return <div className="notice"><Globe2 size={17} /><span>{language === 'vi' ? `Có thu nhập ở tiền tệ khác: ${source}. Bản xem trước không truy cập provider FX.` : `Other original currencies: ${source}. The preview cannot access the FX provider.`}</span></div>
  const unavailable = !status || status.state === 'unavailable'
  const updated = status?.fetchedAt ? `${formatDate(status.fetchedAt, language)} ${formatClockTime(status.fetchedAt, language)}` : null
  return <div className={`notice fx-notice ${status?.state === 'stale' ? 'stale' : ''}`}><Globe2 size={17} /><span>{unavailable ? (language === 'vi' ? `Có thu nhập ở tiền tệ khác: ${source}. Chưa có tỷ giá đã xác minh${status?.error ? ` (${status.error})` : ''}; TimeFarm giữ nguyên tiền gốc.` : `Other original currencies: ${source}. No verified rate is available${status?.error ? ` (${status.error})` : ''}; TimeFarm keeps the original money.`) : <>{language === 'vi' ? `Quy đổi tham khảo sang ${accountCurrency}: ` : `Reference conversion to ${accountCurrency}: `}{converted.length > 0 ? converted.map((result) => formatMoney(result.money as { amountMinor: number; currency: CurrencyCode }, language)).join(' · ') : (language === 'vi' ? 'đang tải…' : 'loading…')}. {language === 'vi' ? `Nguồn ${status.provider}, cập nhật ${updated ?? 'chưa xác định'}${status.state === 'stale' ? ' (có thể đã cũ)' : ''}.` : `Source ${status.provider}, updated ${updated ?? 'unknown'}${status.state === 'stale' ? ' (may be stale)' : ''}.`}</>} </span><button className="text-button" onClick={refresh} disabled={refreshing}>{refreshing ? (language === 'vi' ? 'Đang cập nhật…' : 'Updating…') : (language === 'vi' ? 'Cập nhật tỷ giá' : 'Refresh rates')}</button></div>
}

function analyticsRangeLabel(preset: AnalyticsRangePreset, language: AppLanguage): string {
  const labels = language === 'vi'
    ? { '7d': '7 ngày gần nhất', '30d': '30 ngày gần nhất', '1m': 'tháng hiện tại', '3m': '3 tháng lịch', '6m': '6 tháng lịch', '1y': '12 tháng lịch' }
    : { '7d': 'last 7 days', '30d': 'last 30 days', '1m': 'current month', '3m': '3 calendar months', '6m': '6 calendar months', '1y': '12 calendar months' }
  return labels[preset]
}

function PeriodComparisonCard({ comparison, language, currency, title, metric }: { comparison: ReturnType<typeof periodComparison>; language: AppLanguage; currency?: CurrencyCode; title: string; metric: 'time' | 'earnings' }) {
  const current = metric === 'time' ? comparison.current.activeMs : comparison.current.earningsMinor
  const previous = metric === 'time' ? comparison.previous.activeMs : comparison.previous.earningsMinor
  const change = metric === 'time' ? comparison.activeMsChange : comparison.earningsChange
  const max = Math.max(current, previous, 1)
  const value = (amount: number) => metric === 'time' ? formatDuration(amount, true, language) : formatMoney({ amountMinor: amount, currency: currency! }, language)
  const changeText = change === null ? (language === 'vi' ? 'Chưa có mốc so sánh' : 'No prior baseline') : `${change >= 0 ? '+' : ''}${change.toFixed(0)}% ${language === 'vi' ? 'so với kỳ trước' : 'vs prior period'}`
  return <article className="panel comparison-card"><div className="panel-heading"><div><h3>{title}</h3><p>{changeText}</p></div><TrendingUp size={18} /></div><div className="comparison-bars"><div><span>{language === 'vi' ? 'Kỳ này' : 'Current'}</span><strong>{value(current)}</strong><i><b style={{ width: `${(current / max) * 100}%` }} /></i></div><div><span>{language === 'vi' ? 'Kỳ trước' : 'Previous'}</span><strong>{value(previous)}</strong><i><b style={{ width: `${(previous / max) * 100}%` }} /></i></div></div></article>
}

function DurationDistributionCard({ entries, language }: { entries: ReturnType<typeof durationDistribution>; language: AppLanguage }) {
  const max = Math.max(...entries.map((entry) => entry.count), 1)
  return <article className="panel distribution-card"><div className="panel-heading"><div><h3>{language === 'vi' ? 'Phân bố thời lượng phiên' : 'Session duration distribution'}</h3><p>{language === 'vi' ? 'Mỗi phiên được xếp theo phần thuộc phạm vi' : 'Sessions are bucketed by in-range active time'}</p></div><Clock3 size={18} /></div><div className="bar-list">{entries.map((entry) => <div key={entry.id}><span>{entry.label}</span><i><b style={{ width: `${(entry.count / max) * 100}%` }} /></i><strong>{entry.count}</strong></div>)}</div></article>
}

function EfficiencyRankingCard({ entries, language, currency }: { entries: ReturnType<typeof projectEfficiencyRanking>; language: AppLanguage; currency: CurrencyCode }) {
  const { state } = useAppStore()
  const projects = state!.projects
  return <article className="panel efficiency-card"><div className="panel-heading"><div><h3>{language === 'vi' ? 'Hiệu suất dự án' : 'Project efficiency ranking'}</h3><p>{language === 'vi' ? 'Chỉ so sánh thu nhập cùng nguyên tệ' : 'Rates use matching original currency only'}</p></div><TrendingUp size={18} /></div>{entries.length === 0 ? <EmptyState compact icon={<TrendingUp />} title={language === 'vi' ? 'Chưa đủ dữ liệu' : 'No efficiency data yet'} description={language === 'vi' ? 'Hoàn tất phiên có thu nhập để xem xếp hạng.' : 'Complete a session with earnings to see a ranking.'} /> : <div className="ranking-list">{entries.slice(0, 5).map((entry, index) => {
    const project = entry.projectId ? projects.find((item) => item.id === entry.projectId) : undefined
    return <div key={entry.projectId ?? 'none'}><span className="rank-number">{index + 1}</span><span className="color-dot" style={{ background: entry.color }} aria-hidden="true" /><strong><span aria-hidden="true" style={{ color: entry.color }}>{project?.icon ?? '◌'}</span> {entry.name}</strong><small>{formatDuration(entry.activeMs, true, language)}</small><b>{entry.effectiveHourlyMinor === null ? '—' : formatMoney({ amountMinor: entry.effectiveHourlyMinor, currency }, language)}</b></div>
  })}</div>}</article>
}

function GoalProgressAnalyticsCard({ range }: { range: AnalyticsRange }) {
  const { state } = useAppStore()
  const app = state!
  const account = app.account!
  const language = account.language
  const now = new Date(range.endMs)
  return <article className="panel analytics-goals"><div className="panel-heading"><div><h3>{language === 'vi' ? 'Tiến độ mục tiêu' : 'Goal progress'}</h3><p>{language === 'vi' ? 'Mục tiêu theo nhịp hiện tại' : 'Goals against the current pace'}</p></div><Target size={18} /></div>{app.goals.length === 0 ? <EmptyState compact icon={<Target />} title={language === 'vi' ? 'Chưa có mục tiêu' : 'No goals yet'} description={language === 'vi' ? 'Tạo mục tiêu ở dashboard để theo dõi tiến độ.' : 'Create a goal from the dashboard to track progress.'} /> : <div className="analytics-goal-list">{app.goals.slice(0, 4).map((goal) => {
    const progress = calculateGoalProgress(goal, app.sessions, app.projects, account.currency, now, account.timezone)
    return <div key={goal.id}><div><strong>{goalLabels[goal.kind][language]}</strong><span className={`goal-status ${progress.status}`}>{goalStatusLabel(progress.status, language)}</span></div><i><b style={{ width: `${progress.percentage}%` }} /></i><small>{formatGoalProgressValue(progress.current, progress.target, goalUnit(goal.kind), account.currency, language)} · {formatGoalRemaining(progress.remaining, goalUnit(goal.kind), account.currency, language)}</small><GoalPace progress={progress} unit={goalUnit(goal.kind)} currency={account.currency} timezone={account.timezone} language={language} /></div>
  })}</div>}</article>
}

function InsightsCard({ entries, sessionCount, comparison }: { entries: ReturnType<typeof projectBreakdown>; sessionCount: number; comparison: ReturnType<typeof periodComparison> }) {
  const { state } = useAppStore()
  const language = state!.account!.language
  const top = entries[0]
  const change = comparison.activeMsChange
  return <article className="panel insights-card"><div className="panel-heading"><div><h3>{language === 'vi' ? 'Nhận định từ dữ liệu' : 'Data-backed observations'}</h3><p>{language === 'vi' ? 'Không suy diễn khi chưa đủ dữ liệu' : 'No claims when data is insufficient'}</p></div><TrendingUp size={18} /></div>{sessionCount < 2 ? <EmptyState compact icon={<BarChart3 />} title={language === 'vi' ? 'Cần thêm dữ liệu' : 'Need more data'} description={language === 'vi' ? 'Hoàn tất ít nhất hai phiên để nhận các nhận định hữu ích.' : 'Complete at least two sessions to surface useful observations.'} /> : <div className="insight"><span className="insight-dot" /><p>{top ? (language === 'vi' ? <><strong>{top.name}</strong> đang chiếm nhiều thời gian nhất trong phạm vi này: <strong>{formatDuration(top.activeMs, true, language)}</strong>{change === null ? '.' : <>; tổng thời gian {change >= 0 ? 'tăng' : 'giảm'} <strong>{Math.abs(change).toFixed(0)}%</strong> so với kỳ trước.</>}</> : <><strong>{top.name}</strong> accounts for the most time in this range: <strong>{formatDuration(top.activeMs, true, language)}</strong>{change === null ? '.' : <>; total work time is <strong>{Math.abs(change).toFixed(0)}%</strong> {change >= 0 ? 'higher' : 'lower'} than the prior period.</>}</>) : (language === 'vi' ? 'Chưa có phân bổ dự án rõ ràng trong phạm vi này.' : 'No project distribution is available for this period.')}</p></div>}</article>
}

function ProfilePage() {
  const { state } = useAppStore()
  const app = state!
  const account = app.account!
  const language = account.language
  return <><div className="page-heading"><span className="eyebrow">{language === 'vi' ? 'TÀI KHOẢN' : 'ACCOUNT'}</span><h1>{label(language, 'profile')}</h1><p>{language === 'vi' ? 'Thông tin nhận diện được tách riêng khỏi số liệu công việc.' : 'Account identity is kept separate from your work data.'}</p></div><section className="profile-layout"><article className="panel profile-card"><div className="profile-avatar">{account.displayName.slice(0, 1).toUpperCase()}</div><h2>{account.displayName}</h2><p>{language === 'vi' ? 'Tài khoản local-first' : 'Local-first account'}</p><div className="profile-detail"><span>{language === 'vi' ? 'Quốc gia' : 'Country'}</span><strong>{account.country}</strong></div><div className="profile-detail"><span>{language === 'vi' ? 'Múi giờ' : 'Timezone'}</span><strong>{account.timezone}</strong></div><div className="profile-detail"><span>{language === 'vi' ? 'Tiền tệ tài khoản' : 'Account currency'}</span><strong>{account.currency}</strong></div></article><article className="panel account-security"><h3>{language === 'vi' ? 'Đồng bộ tài khoản' : 'Account sync'}</h3><p>{language === 'vi' ? 'Bản chạy hiện tại giữ dữ liệu trên thiết bị để timer hoạt động offline. Đăng nhập email/Google và đồng bộ cloud cần endpoint Supabase/Auth được cấu hình bằng biến môi trường; chúng không được giả lập trong app local.' : 'This build retains data locally so the timer works offline. Email/Google sign-in and cloud synchronization require a configured Supabase/Auth endpoint and are not faked in the local app.'}</p><div className="architecture-note"><Check size={18} /><span>{language === 'vi' ? 'Dữ liệu phiên, dự án và mục tiêu đã sẵn sàng cho một lớp sync outbox.' : 'Sessions, projects, and goals are ready for a future sync-outbox layer.'}</span></div></article></section></>
}

function SettingsPage() {
  const { state, updatePreferences, updateLanguage, resetLocalData } = useAppStore()
  const app = state!
  const account = app.account!
  const language = account.language
  const reset = () => {
    const message = language === 'vi' ? 'Xóa toàn bộ dữ liệu local trên thiết bị này? Hành động này không thể hoàn tác.' : 'Delete all local data from this device? This cannot be undone.'
    if (window.confirm(message)) void resetLocalData()
  }
  return <><div className="page-heading"><span className="eyebrow">{language === 'vi' ? 'TÙY CHỈNH TRẢI NGHIỆM' : 'PERSONALIZE YOUR EXPERIENCE'}</span><h1>{label(language, 'settings')}</h1><p>{language === 'vi' ? 'Tùy chọn giao diện không thay đổi dữ liệu lịch sử.' : 'Appearance settings never change historical data.'}</p></div><section className="settings-layout"><article className="panel settings-section"><h3>{language === 'vi' ? 'Giao diện' : 'Appearance'}</h3><div className="setting-row"><div><strong>{language === 'vi' ? 'Chủ đề' : 'Theme'}</strong><span>{language === 'vi' ? 'Theo hệ thống, sáng hoặc tối' : 'System, light, or dark'}</span></div><select value={app.preferences.theme} onChange={(event) => updatePreferences({ theme: event.target.value as 'system' | 'light' | 'dark' })}><option value="system">{language === 'vi' ? 'Theo hệ thống' : 'System'}</option><option value="light">{language === 'vi' ? 'Sáng' : 'Light'}</option><option value="dark">{language === 'vi' ? 'Tối' : 'Dark'}</option></select></div><div className="setting-row"><div><strong>{language === 'vi' ? 'Ngôn ngữ' : 'Language'}</strong><span>{language === 'vi' ? 'Có thể đổi bất kỳ lúc nào' : 'You can change this at any time'}</span></div><select value={language} onChange={(event) => updateLanguage(event.target.value as AppLanguage)}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></div></article><article className="panel settings-section"><h3>{language === 'vi' ? 'Mini timer' : 'Mini timer'}</h3><div className="setting-row"><div><strong>{language === 'vi' ? 'Chế độ hiển thị' : 'Display mode'}</strong><span>{language === 'vi' ? 'Interactive cho phép điều khiển; Chỉ xem hoàn toàn click-through; kéo overlay để lưu vị trí.' : 'Interactive allows controls; View only is fully click-through; drag the overlay to save its position.'}</span></div><select value={app.preferences.miniTimerMode} onChange={(event) => updatePreferences({ miniTimerMode: event.target.value as 'interactive' | 'view_only' | 'hidden' })}><option value="hidden">{language === 'vi' ? 'Ẩn' : 'Hidden'}</option><option value="view_only">{language === 'vi' ? 'Chỉ xem' : 'View only'}</option><option value="interactive">{language === 'vi' ? 'Tương tác' : 'Interactive'}</option></select></div></article><article className="panel danger-zone"><h3>{language === 'vi' ? 'Vùng dữ liệu local' : 'Local data zone'}</h3><p>{language === 'vi' ? 'Xóa dữ liệu chỉ xóa bản lưu trên máy này. Khi cloud sync được bật, quy tắc xóa phải tách biệt và có xác nhận server.' : 'This only deletes the data saved on this device. When cloud sync is enabled, deletion must be separately confirmed server-side.'}</p><button className="button danger" onClick={reset}><RotateCcw size={17} /> {language === 'vi' ? 'Xóa dữ liệu local' : 'Clear local data'}</button></article></section></>
}

function StartSessionDialog({ onClose, onStarted }: { onClose: () => void; onStarted: () => void }) {
  const { state, startSession, createProject } = useAppStore()
  const app = state!
  const language = app.account!.language
  const [selected, setSelected] = useState<string | undefined>()
  const [quick, setQuick] = useState(false)
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const start = async () => {
    let projectId = selected
    if (quick) {
      if (!name.trim()) { setMessage(language === 'vi' ? 'Nhập tên dự án trước.' : 'Enter a project name first.'); return }
      const created = await createProject({ name, paymentModel: 'per_session', expectedCurrency: app.account!.currency, color: '#7c3aed', icon: '✦' })
      if (!created.ok) { setMessage(created.message); return }
      projectId = created.projectId
    }
    const result = await startSession(projectId)
    if (!result.ok) { setMessage(result.message); return }
    onStarted()
  }
  return <Modal title={language === 'vi' ? 'Bắt đầu phiên làm việc' : 'Start a work session'} subtitle={language === 'vi' ? 'Chọn nơi bạn sẽ dành thời gian. Bạn có thể làm việc không gắn dự án.' : 'Choose where you will spend this time. An unassigned session is always okay.'} onClose={onClose}><div className="project-picker"><button className={`project-option ${selected === undefined && !quick ? 'selected' : ''}`} onClick={() => { setSelected(undefined); setQuick(false) }}><span className="project-icon neutral">◌</span><div><strong>{label(language, 'noProject')}</strong><span>{language === 'vi' ? 'Phiên độc lập' : 'Independent session'}</span></div>{selected === undefined && !quick && <Check size={18} />}</button>{app.projects.filter((project) => project.status !== 'completed').map((project) => <button key={project.id} className={`project-option ${selected === project.id && !quick ? 'selected' : ''}`} onClick={() => { setSelected(project.id); setQuick(false) }}><span className="project-icon" style={{ background: `${project.color}1e`, color: project.color }}>{project.icon}</span><div><strong>{project.name}</strong><span>{paymentModelLabels[project.paymentModel][language]}</span></div>{selected === project.id && !quick && <Check size={18} />}</button>)}</div>{quick ? <div className="quick-project"><Field label={language === 'vi' ? 'Tên dự án nhanh' : 'Quick project name'}><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={language === 'vi' ? 'Ví dụ: Video tháng 8' : 'For example: August video'} /></Field></div> : <button className="text-button add-project" onClick={() => { setQuick(true); setSelected(undefined) }}><Plus size={16} /> {language === 'vi' ? 'Tạo dự án nhanh' : 'Create project quickly'}</button>}{message && <p className="form-error">{message}</p>}<div className="modal-actions"><button className="button ghost" onClick={onClose}>{label(language, 'cancel')}</button><button className="button primary" onClick={start}><Play size={17} fill="currentColor" /> {label(language, 'start')}</button></div></Modal>
}

function CompleteSessionDialog({ session, requestedEndAt, onClose }: { session: WorkSession; requestedEndAt?: string; onClose: () => void }) {
  const { state, completeSession } = useAppStore()
  const app = state!
  const language = app.account!.language
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode>(app.account!.currency)
  const [note, setNote] = useState('')
  const now = useCurrentTime()
  const project = app.projects.find((item) => item.id === session.projectId)
  const endAt = requestedEndAt ?? new Date(now).toISOString()
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); const result = await completeSession(session.id, { amount, currency, note }, requestedEndAt); if (!result.ok) { setError(result.message); return } onClose() }
  return <Modal title={language === 'vi' ? 'Chốt phiên làm việc' : 'Complete work session'} subtitle={language === 'vi' ? 'Ghi lại số tiền thực nhận. Bạn có thể nhập 0.' : 'Record the money you actually earned. Zero is valid.'} onClose={onClose}><form onSubmit={submit}><div className="completion-summary"><span>{project?.icon ?? '◌'}</span><div><strong>{project?.name ?? label(language, 'noProject')}</strong><p>{formatClockTime(session.startedAt, language, session.timezone)} — {formatClockTime(endAt, language, session.timezone)} · {formatDuration(activeDurationMs({ ...session, endedAt: endAt, status: 'completed' }), true, language)}</p></div></div>{requestedEndAt && <p className="form-hint"><Clock3 size={15} /> {language === 'vi' ? 'Đang dùng thời điểm kết thúc bạn chọn khi khôi phục phiên.' : 'Using the end time you chose during recovery.'}</p>}{project && <p className="payment-context"><CircleDollarSign size={15} /> {language === 'vi' ? `Dự án dùng mô hình: ${paymentModelLabels[project.paymentModel][language]}. Thu nhập phiên này không làm thay đổi lịch sử thanh toán dự án.` : `Project model: ${paymentModelLabels[project.paymentModel][language]}. This session earning never changes the project payment history.`}</p>}<div className="form-grid money-grid"><Field label={language === 'vi' ? 'Thu nhập thực nhận' : 'Actual earnings'}><input type="number" min="0" step="any" autoFocus value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" required /></Field><Field label={language === 'vi' ? 'Tiền tệ' : 'Currency'}><select value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}>{Object.keys(currencyMetadata).map((code) => <option key={code} value={code}>{code}</option>)}</select></Field></div><Field label={language === 'vi' ? 'Ghi chú (không bắt buộc)' : 'Note (optional)'}><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={language === 'vi' ? 'Bạn đã hoàn thành điều gì?' : 'What did you accomplish?'} rows={3} /></Field>{error && <p className="form-error">{error}</p>}<p className="form-hint"><Check size={15} /> {language === 'vi' ? 'Sau khi lưu, phiên sẽ cập nhật dashboard và được đánh dấu chờ đồng bộ.' : 'Once saved, this session updates your dashboard and is marked ready for sync.'}</p><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>{label(language, 'back')}</button><button className="button primary" type="submit"><Check size={17} /> {language === 'vi' ? 'Lưu phiên' : 'Save session'}</button></div></form></Modal>
}

function ProjectDialog({ project, onClose }: { project?: Project; onClose: () => void }) {
  const { state, createProject, updateProject } = useAppStore()
  const app = state!
  const language = app.account!.language
  const [name, setName] = useState(project?.name ?? '')
  const [paymentModel, setPaymentModel] = useState<PaymentModel>(project?.paymentModel ?? 'per_session')
  const [expectedAmount, setExpectedAmount] = useState(moneyToInput(project?.expectedMoney))
  const [currency, setCurrency] = useState<CurrencyCode>(project?.expectedMoney?.currency ?? app.account!.currency)
  const [note, setNote] = useState(project?.note ?? '')
  const [color, setColor] = useState(project?.color ?? '#7c3aed')
  const [icon, setIcon] = useState(project?.icon ?? '✦')
  const [error, setError] = useState('')
  const input = (): NewProjectInput => ({ name, paymentModel, expectedAmount, expectedCurrency: currency, note, color, icon })
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!name.trim()) { setError(language === 'vi' ? 'Tên dự án là bắt buộc.' : 'Project name is required.'); return } const result = project ? await updateProject(project.id, input()) : await createProject(input()); if (!result.ok) { setError(result.message); return } onClose() }
  return <Modal title={project ? (language === 'vi' ? 'Chỉnh sửa dự án' : 'Edit project') : (language === 'vi' ? 'Tạo dự án' : 'Create project')} subtitle={language === 'vi' ? 'Thông tin thanh toán không thay thế thu nhập thực tế của từng phiên.' : 'Payment context never replaces the actual earnings recorded per session.'} onClose={onClose}><form onSubmit={submit}><Field label={language === 'vi' ? 'Tên dự án' : 'Project name'}><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={language === 'vi' ? 'Ví dụ: Thiết kế thương hiệu Acme' : 'For example: Acme brand design'} /></Field><Field label={language === 'vi' ? 'Cách nhận thanh toán' : 'Payment model'}><select value={paymentModel} onChange={(event) => setPaymentModel(event.target.value as PaymentModel)}>{Object.entries(paymentModelLabels).map(([value, text]) => <option key={value} value={value}>{text[language]}</option>)}</select></Field><div className="form-grid money-grid"><Field label={language === 'vi' ? 'Tiền kỳ vọng (tùy chọn)' : 'Expected money (optional)'}><input type="number" min="0" step="any" value={expectedAmount} onChange={(event) => setExpectedAmount(event.target.value)} /></Field><Field label={language === 'vi' ? 'Tiền tệ' : 'Currency'}><select value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}>{Object.keys(currencyMetadata).map((code) => <option key={code} value={code}>{code}</option>)}</select></Field></div><Field label={language === 'vi' ? 'Ghi chú (tùy chọn)' : 'Note (optional)'}><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></Field><div className="form-grid"><Field label={language === 'vi' ? 'Màu nhận diện' : 'Project color'}><div className="color-picker">{['#7c3aed', '#2563eb', '#059669', '#ea580c', '#db2777', '#0f766e'].map((value) => <button type="button" aria-label={value} key={value} className={color === value ? 'selected' : ''} style={{ background: value }} onClick={() => setColor(value)}>{color === value && <Check size={14} />}</button>)}</div></Field><Field label={language === 'vi' ? 'Biểu tượng' : 'Icon'}><div className="icon-picker">{['✦', '◈', '◌', '◆', '△', '☼'].map((value) => <button type="button" key={value} className={icon === value ? 'selected' : ''} onClick={() => setIcon(value)}>{value}</button>)}</div></Field></div>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>{label(language, 'cancel')}</button><button className="button primary" type="submit"><Check size={17} /> {project ? label(language, 'save') : label(language, 'create')}</button></div></form></Modal>
}

function PaymentDialog({ project, payment, onClose, onEditPayment }: { project: Project; payment?: Payment; onClose: () => void; onEditPayment: (payment: Payment) => void }) {
  const { state, recordPayment, updatePayment, deletePayment } = useAppStore()
  const app = state!
  const language = app.account!.language
  const [amount, setAmount] = useState(moneyToInput(payment?.money))
  const [currency, setCurrency] = useState<CurrencyCode>(payment?.money.currency ?? project.expectedMoney?.currency ?? app.account!.currency)
  const [kind, setKind] = useState<'completion' | 'progressive'>(payment?.kind ?? (project.paymentModel === 'on_completion' ? 'completion' : 'progressive'))
  const [receivedAt, setReceivedAt] = useState(payment ? formatDateTimeLocalInput(payment.receivedAt) : '')
  const [note, setNote] = useState(payment?.note ?? '')
  const [error, setError] = useState('')
  const payments = app.payments.filter((entry) => entry.projectId === project.id).sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const date = receivedAt ? new Date(receivedAt) : null
    if (date && !Number.isFinite(date.getTime())) { setError(language === 'vi' ? 'Thời điểm thanh toán không hợp lệ.' : 'Payment date is invalid.'); return }
    const input = { projectId: project.id, amount, currency, kind, note, ...(date ? { receivedAt: date.toISOString() } : {}) }
    const result = payment ? await updatePayment(payment.id, input) : await recordPayment(input)
    if (!result.ok) { setError(result.message); return }
    onClose()
  }
  const removePayment = async (paymentId: string) => {
    if (!window.confirm(language === 'vi' ? 'Xóa khoản thanh toán này?' : 'Delete this payment?')) return
    const result = await deletePayment(paymentId)
    if (!result.ok) { setError(result.message); return }
    setError('')
    if (payment?.id === paymentId) onClose()
  }
  const title = payment ? (language === 'vi' ? 'Chỉnh sửa thanh toán' : 'Edit payment') : (language === 'vi' ? 'Ghi nhận thanh toán' : 'Record payment')
  return <Modal title={title} subtitle={language === 'vi' ? `${project.name} · Khoản thanh toán dự án luôn tách riêng khỏi thu nhập theo phiên.` : `${project.name} · Project payments remain separate from per-session earnings.`} onClose={onClose}><form onSubmit={submit}><div className="form-grid money-grid"><Field label={language === 'vi' ? 'Số tiền thực nhận' : 'Amount received'}><input type="number" min="0" step="any" autoFocus value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" required /></Field><Field label={language === 'vi' ? 'Tiền tệ' : 'Currency'}><select value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}>{Object.keys(currencyMetadata).map((code) => <option key={code} value={code}>{code}</option>)}</select></Field></div><Field label={language === 'vi' ? 'Loại thanh toán' : 'Payment type'}><select value={kind} onChange={(event) => setKind(event.target.value as 'completion' | 'progressive')}><option value="progressive">{language === 'vi' ? 'Thanh toán theo đợt' : 'Progressive payment'}</option><option value="completion">{language === 'vi' ? 'Thanh toán khi hoàn thành' : 'Completion payment'}</option></select></Field><Field label={language === 'vi' ? 'Thời điểm nhận (tùy chọn)' : 'Received at (optional)'}><input type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></Field><Field label={language === 'vi' ? 'Ghi chú (tùy chọn)' : 'Note (optional)'}><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder={language === 'vi' ? 'Ví dụ: đợt 2 sau khi bàn giao' : 'For example: second delivery milestone'} /></Field>{error && <p className="form-error">{error}</p>}<div className="payment-history"><strong>{language === 'vi' ? 'Lịch sử thanh toán' : 'Payment history'}</strong>{payments.length === 0 ? <p>{language === 'vi' ? 'Chưa có khoản thanh toán nào.' : 'No payments have been recorded.'}</p> : payments.map((entry) => <div className="payment-history-row" key={entry.id}><span>{formatDate(entry.receivedAt, language, app.account!.timezone)}</span><strong>{formatMoney(entry.money, language)}</strong><small>{entry.kind === 'completion' ? (language === 'vi' ? 'Hoàn tất dự án' : 'Completion') : (language === 'vi' ? 'Theo đợt' : 'Progressive')}{entry.note ? ` · ${entry.note}` : ''}</small><span style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}><button type="button" className="text-button" onClick={() => onEditPayment(entry)}>{label(language, 'edit')}</button><button type="button" className="text-button" style={{ color: 'var(--danger)' }} onClick={() => { void removePayment(entry.id) }}>{language === 'vi' ? 'Xóa' : 'Delete'}</button></span></div>)}</div><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>{label(language, 'cancel')}</button><button className="button primary" type="submit"><CircleDollarSign size={17} /> {payment ? (language === 'vi' ? 'Cập nhật thanh toán' : 'Update payment') : (language === 'vi' ? 'Lưu khoản thanh toán' : 'Save payment')}</button></div></form></Modal>
}

function GoalDialog({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const { state, createGoal, updateGoal } = useAppStore()
  const app = state!
  const language = app.account!.language
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? 'hours_daily')
  const [target, setTarget] = useState(() => goal ? (goalLabels[goal.kind].unit === 'money' ? moneyToInput({ amountMinor: goal.target, currency: app.account!.currency }) : String(goal.target)) : '')
  const [error, setError] = useState('')
  const unit = goalLabels[kind].unit
  const updateKind = (next: GoalKind) => {
    if (goalLabels[next].unit !== unit) setTarget('')
    setKind(next)
    setError('')
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const numeric = Number(target)
    if (!Number.isFinite(numeric) || numeric <= 0) { setError(language === 'vi' ? 'Mục tiêu phải lớn hơn 0.' : 'Goal target must be greater than zero.'); return }
    const stored = unit === 'money' ? moneyFromInput(target, app.account!.currency).amountMinor : numeric
    const result = goal ? await updateGoal(goal.id, kind, stored) : await createGoal(kind, stored)
    if (!result.ok) { setError(result.message); return }
    onClose()
  }
  return <Modal title={goal ? (language === 'vi' ? 'Chỉnh sửa mục tiêu' : 'Edit goal') : (language === 'vi' ? 'Tạo mục tiêu' : 'Create goal')} subtitle={language === 'vi' ? 'Mục tiêu dùng dữ liệu thực tế, không dùng mức lương cố định.' : 'Goals use your actual data, never a fixed wage.'} onClose={onClose}><form onSubmit={submit}><Field label={language === 'vi' ? 'Loại mục tiêu' : 'Goal type'}><select value={kind} onChange={(event) => updateKind(event.target.value as GoalKind)}>{Object.entries(goalLabels).map(([value, text]) => <option key={value} value={value}>{text[language]}</option>)}</select></Field><Field label={language === 'vi' ? `Mục tiêu (${unit === 'hours' ? 'giờ' : unit === 'money' ? app.account!.currency : 'dự án'})` : `Target (${unit === 'hours' ? 'hours' : unit === 'money' ? app.account!.currency : 'projects'})`}><input type="number" autoFocus min="0" step="any" value={target} onChange={(event) => setTarget(event.target.value)} placeholder={unit === 'hours' ? '4' : unit === 'money' ? '1000000' : '1'} required /></Field>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>{label(language, 'cancel')}</button><button className="button primary" type="submit"><Target size={17} /> {goal ? (language === 'vi' ? 'Cập nhật mục tiêu' : 'Update goal') : (language === 'vi' ? 'Lưu mục tiêu' : 'Save goal')}</button></div></form></Modal>
}

function EditSessionDialog({ session, onClose }: { session: WorkSession; onClose: () => void }) {
  const { state, editLatestSession } = useAppStore()
  const app = state!
  const language = app.account!.language
  const [amount, setAmount] = useState(moneyToInput(session.earnings))
  const [currency, setCurrency] = useState<CurrencyCode>(session.earnings?.currency ?? app.account!.currency)
  const [note, setNote] = useState(session.note ?? '')
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); const result = await editLatestSession(session.id, { amount, currency, note } satisfies CompletedSessionInput); if (!result.ok) { setError(result.message); return } onClose() }
  return <Modal title={language === 'vi' ? 'Chỉnh sửa phiên gần nhất' : 'Edit latest session'} subtitle={language === 'vi' ? 'Những phiên cũ hơn được khóa để bảo toàn số liệu lịch sử.' : 'Older sessions are locked to preserve historical integrity.'} onClose={onClose}><form onSubmit={submit}><div className="form-grid money-grid"><Field label={language === 'vi' ? 'Thu nhập thực nhận' : 'Actual earnings'}><input type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} required /></Field><Field label={language === 'vi' ? 'Tiền tệ' : 'Currency'}><select value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}>{Object.keys(currencyMetadata).map((code) => <option key={code} value={code}>{code}</option>)}</select></Field></div><Field label={language === 'vi' ? 'Ghi chú' : 'Note'}><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></Field>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>{label(language, 'cancel')}</button><button className="button primary" type="submit"><Check size={17} /> {label(language, 'save')}</button></div></form></Modal>
}

function RecoveryDialog({ session, onContinue, onComplete }: { session: WorkSession; onContinue: () => void; onComplete: (endedAt?: string) => void }) {
  const { state, discardSession } = useAppStore()
  const language = state!.account!.language
  const [endLocal, setEndLocal] = useState('')
  const [error, setError] = useState('')
  const [lease, setLease] = useState<TimerLeaseStatus | null>(null)
  useEffect(() => {
    const desktop = window.worklyDesktop
    if (!desktop) return undefined
    void desktop.getTimerLeaseStatus().then(setLease).catch(() => {})
    return desktop.onTimerLeaseChanged?.(setLease)
  }, [])
  const continueSession = async () => {
    const desktop = window.worklyDesktop
    if (desktop?.acquireTimerLease) {
      const outcome = await desktop.acquireTimerLease()
      setLease(outcome)
      if (outcome.state === 'held_by_other') {
        setError(language === 'vi' ? 'Một thiết bị khác đang giữ quyền timer cho tài khoản này. Hãy kết thúc hoặc chờ phiên đó trước.' : 'Another device currently holds this account’s timer lease. Finish or wait for that session first.')
        return
      }
    }
    onContinue()
  }
  const discard = async () => { if (window.confirm(language === 'vi' ? 'Bỏ phiên đang dở? Thao tác này không thể hoàn tác.' : 'Discard this unfinished session? This cannot be undone.')) { const result = await discardSession(session.id); if (!result.ok) { setError(result.message); return } onContinue() } }
  const completeAtChosenTime = () => {
    const endAt = new Date(endLocal)
    if (!endLocal || !Number.isFinite(endAt.getTime()) || endAt.getTime() < Date.parse(session.startedAt)) {
      setError(language === 'vi' ? 'Chọn thời điểm kết thúc sau lúc bắt đầu phiên.' : 'Choose an end time after the session started.')
      return
    }
    onComplete(endAt.toISOString())
  }
  return <Modal title={language === 'vi' ? 'Khôi phục phiên đang dở' : 'Recover unfinished session'} subtitle={language === 'vi' ? 'TimeFarm tìm thấy một phiên chưa được chốt khi ứng dụng mở lại.' : 'TimeFarm found a session that was not completed before the app reopened.'} onClose={onContinue} locked><div className="recovery-summary"><Clock3 size={24} /><div><strong>{formatDuration(activeDurationMs(session), true, language)}</strong><span>{language === 'vi' ? `Bắt đầu ${formatDate(session.startedAt, language, session.timezone)} lúc ${formatClockTime(session.startedAt, language, session.timezone)}` : `Started ${formatDate(session.startedAt, language, session.timezone)} at ${formatClockTime(session.startedAt, language, session.timezone)}`}</span></div></div><div className="recovery-options"><button className="button primary" onClick={() => { void continueSession() }}><Play size={17} fill="currentColor" /> {language === 'vi' ? 'Tiếp tục phiên' : 'Continue session'}</button><button className="button ghost" onClick={() => onComplete()}><Square size={15} fill="currentColor" /> {language === 'vi' ? 'Kết thúc ngay' : 'End now'}</button><div className="recovery-custom-end"><label>{language === 'vi' ? 'Hoặc kết thúc tại (múi giờ thiết bị)' : 'Or end at (device timezone)'}<input type="datetime-local" value={endLocal} min={formatDateTimeLocalInput(session.startedAt)} onChange={(event) => { setEndLocal(event.target.value); setError('') }} /></label><button className="button ghost" onClick={completeAtChosenTime}><Clock3 size={15} /> {language === 'vi' ? 'Dùng thời điểm này' : 'Use this time'}</button></div>{lease?.state === 'held_by_other' && <p className="form-error">{language === 'vi' ? 'Thiết bị khác đang giữ timer. Bạn vẫn có thể kết thúc hoặc bỏ phiên local này.' : 'Another device holds the timer. You can still end or discard this local session.'}</p>}{error && <p className="form-error">{error}</p>}<button className="text-button danger-text" onClick={() => { void discard() }}>{language === 'vi' ? 'Bỏ phiên này' : 'Discard session'}</button></div></Modal>
}

function Modal({ title, subtitle, children, onClose, locked }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; locked?: boolean }) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true')
    const initialFocus = window.setTimeout(() => (focusable()[0] ?? dialog).focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const targets = focusable()
      if (targets.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = targets[0]
      const last = targets.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(initialFocus)
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus()
    }
  }, [locked, onClose])
  return <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!locked) onClose() }}><section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{!locked && <button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button>}</div>{children}</section></div>
}

function Field({ label: title, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{title}</span>{children}</label>
}

function EmptyState({ icon, title, description, action, compact }: { icon: ReactNode; title: string; description: string; action?: ReactNode; compact?: boolean }) {
  return <div className={`empty-state ${compact ? 'compact' : ''}`}><span className="empty-icon">{icon}</span><div><strong>{title}</strong><p>{description}</p>{action}</div></div>
}
