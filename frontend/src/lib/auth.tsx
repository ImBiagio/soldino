import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { api, setAccessToken, setUnauthenticatedHandler } from './api'
import type { User } from './types'

interface AuthState {
  user: User | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<string | null>
  verifyEmail: (token: string) => Promise<void>
  /** Nuova password dal link della mail: se va bene si entra direttamente. */
  resetPassword: (uid: string, token: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (user: User) => void
}

const AuthContext = createContext<AuthState | null>(null)

interface AuthPayload {
  access: string
  user: User
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  const apply = useCallback((payload: AuthPayload) => {
    setAccessToken(payload.access)
    setUser(payload.user)
  }, [])

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => undefined)
    setAccessToken(null)
    setUser(null)
  }, [])

  // Al primo caricamento si prova il refresh: se il cookie e' ancora valido la
  // sessione riparte senza passare dal login.
  useEffect(() => {
    let cancelled = false
    setUnauthenticatedHandler(() => {
      setAccessToken(null)
      setUser(null)
    })
    api
      .refresh()
      .then(async (ok) => {
        if (!ok || cancelled) return
        const me = await api.get<User>('/api/me')
        if (!cancelled) setUser(me)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
      setUnauthenticatedHandler(null)
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      setUser,
      login: async (email, password) => {
        apply(await api.post<AuthPayload>('/api/auth/login', { email, password }))
      },
      register: async (email, password, displayName) => {
        const response = await api.post<AuthPayload | { detail: string }>('/api/auth/register', {
          email,
          password,
          display_name: displayName,
        })
        if ('access' in response) {
          apply(response)
          return null
        }
        return response.detail
      },
      verifyEmail: async (token) => {
        apply(await api.post<AuthPayload>(`/api/auth/verify-email/${token}`))
      },
      resetPassword: async (uid, token, password) => {
        apply(
          await api.post<AuthPayload>('/api/auth/password-reset/confirm', {
            uid,
            token,
            new_password: password,
          }),
        )
      },
      logout,
    }),
    [user, ready, apply, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth va usato dentro AuthProvider')
  return context
}
