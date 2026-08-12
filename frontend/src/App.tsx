import { Navigate, Route, Routes } from 'react-router-dom'

import { TrackerLayout } from './components/Layout'
import { Spinner } from './components/ui'
import {
  AcceptInvitePage,
  LoginPage,
  RegisterPage,
  VerifyEmailPage,
} from './features/auth/AuthPages'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { PendingPage } from './features/pending/PendingPage'
import { SubscriptionsPage } from './features/recurring/SubscriptionsPage'
import { SettingsPage } from './features/trackers/SettingsPage'
import { TrackerListPage } from './features/trackers/TrackerListPage'
import { TransactionsPage } from './features/transactions/TransactionsPage'
import { useAuth } from './lib/auth'

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, ready } = useAuth()
  if (!ready) return <Spinner />
  if (!user) return <Navigate to="/accedi" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/accedi" element={<LoginPage />} />
      <Route path="/registrati" element={<RegisterPage />} />
      <Route path="/verifica-email/:token" element={<VerifyEmailPage />} />
      <Route path="/inviti/:token" element={<AcceptInvitePage />} />
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
        <Route path="attese" element={<PendingPage />} />
        <Route path="abbonamenti" element={<SubscriptionsPage />} />
        <Route path="impostazioni" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
