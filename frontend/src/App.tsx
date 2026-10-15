import { Navigate, Route, Routes } from 'react-router-dom'

import { TrackerLayout } from './components/Layout'
import { Skeleton } from './components/ui'
import {
  AcceptInvitePage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './features/auth/AuthPages'
import { AccountPage } from './features/account/AccountPage'
import { AccountsPage } from './features/accounts/AccountsPage'
import { BankCallbackPage } from './features/banking/BankCallbackPage'
import { BankPage } from './features/banking/BankPage'
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
  if (!ready) return <Skeleton className="m-6 h-24" />
  if (!user) return <Navigate to="/accedi" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/accedi" element={<LoginPage />} />
      <Route path="/registrati" element={<RegisterPage />} />
      <Route path="/verifica-email/:token" element={<VerifyEmailPage />} />
      <Route path="/password-dimenticata" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:uid/:token" element={<ResetPasswordPage />} />
      <Route
        path="/account"
        element={
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        }
      />
      <Route path="/inviti/:token" element={<AcceptInvitePage />} />
      <Route
        path="/banca/callback"
        element={
          <RequireAuth>
            <BankCallbackPage />
          </RequireAuth>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <TrackerListPage />
          </RequireAuth>
        }
      />
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
        <Route path="attese" element={<PendingPage />} />
        <Route path="abbonamenti" element={<SubscriptionsPage />} />
        <Route path="impostazioni" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
