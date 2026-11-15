import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { PlainLayout, TrackerLayout } from './components/Layout'
import { Skeleton } from './components/ui'
import { AcceptInvitePage, LoginPage } from './features/auth/AuthPages'
import { AccountPage } from './features/account/AccountPage'
import { AccountsPage } from './features/accounts/AccountsPage'
import { BankCallbackPage } from './features/banking/BankCallbackPage'
import { BankPage } from './features/banking/BankPage'
import { InboxPage } from './features/inbox/InboxPage'
import { VoicePage } from './features/voice/VoicePage'
import { ChartsPage } from './features/charts/ChartsPage'
import { ReceiptPage } from './features/scan/ReceiptPage'
import { ScanPage } from './features/scan/ScanPage'
import { ScanReviewPage } from './features/scan/ScanReviewPage'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { PendingPage } from './features/pending/PendingPage'
import { SubscriptionsPage } from './features/recurring/SubscriptionsPage'
import { SettingsPage } from './features/trackers/SettingsPage'
import { TrackerListPage } from './features/trackers/TrackerListPage'
import { TransactionsPage } from './features/transactions/TransactionsPage'
import { useAuth } from './lib/auth'

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <Skeleton className="m-6 h-24" />
  if (!user) {
    // Dopo il login su cornhub si torna dove si voleva andare: un link
    // aperto da sloggato non deve finire sulla lista dei tracker.
    const path = `${location.pathname}${location.search}`
    const next = path === '/' ? '' : `?next=${encodeURIComponent(path)}`
    return <Navigate to={`/accedi${next}`} replace />
  }
  return children
}

export default function App() {
  return (
    <Routes>
      {/* Registrazione, password e conferma email stanno su cornhub (ADR 0021). */}
      <Route path="/accedi" element={<LoginPage />} />
      <Route path="/inviti/:token" element={<AcceptInvitePage />} />
      {/* Fuori dai tracker: stesse pannocchie del rail, senza le sezioni. */}
      <Route
        element={
          <RequireAuth>
            <PlainLayout />
          </RequireAuth>
        }
      >
        <Route path="/account" element={<AccountPage />} />
        <Route path="/banca/callback" element={<BankCallbackPage />} />
        <Route path="/" element={<TrackerListPage />} />
      </Route>
      <Route
        path="/t/:trackerId"
        element={
          <RequireAuth>
            <TrackerLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="movimenti" element={<TransactionsPage />} />
        <Route path="grafici" element={<ChartsPage />} />
        <Route path="conti" element={<AccountsPage />} />
        <Route path="scan" element={<ScanPage />} />
        <Route path="scan/:statementId" element={<ScanReviewPage />} />
        <Route path="scontrino" element={<ReceiptPage />} />
        <Route path="scontrino/:statementId" element={<ScanReviewPage />} />
        <Route path="banca" element={<BankPage />} />
        <Route path="voce" element={<VoicePage />} />
        <Route path="voce/:statementId" element={<ScanReviewPage />} />
        <Route path="da-rivedere" element={<InboxPage />} />
        <Route path="attese" element={<PendingPage />} />
        <Route path="abbonamenti" element={<SubscriptionsPage />} />
        <Route path="impostazioni" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
