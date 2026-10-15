import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api } from '../lib/api'
import type {
  Account,
  Aspsp,
  BankAccountLink,
  BankConnection,
  BankingStatus,
  BankSyncResult,
  BalanceHistory,
  StatementImport,
  StatementLine,
  StatementSource,
  BalancesResponse,
  Category,
  Membership,
  Paginated,
  PendingItem,
  Reconciliation,
  RecurringRule,
  Settlement,
  Summary,
  SummaryParams,
  Tracker,
  TrackerKind,
  Transaction,
  TransactionPayload,
  UUID,
} from '../lib/types'

const trackerBase = (trackerId: UUID) => `/api/trackers/${trackerId}`

export const keys = {
  trackers: ['trackers'] as const,
  tracker: (id: UUID) => ['trackers', id] as const,
  members: (id: UUID) => ['trackers', id, 'members'] as const,
  categories: (id: UUID) => ['trackers', id, 'categories'] as const,
  accounts: (id: UUID) => ['trackers', id, 'accounts'] as const,
  pending: (id: UUID) => ['trackers', id, 'pending'] as const,
  transactions: (id: UUID, filters: unknown) => ['trackers', id, 'transactions', filters] as const,
  settlements: (id: UUID) => ['trackers', id, 'settlements'] as const,
  balances: (id: UUID) => ['trackers', id, 'balances'] as const,
  summary: (id: UUID, period: unknown) => ['trackers', id, 'summary', period] as const,
  reconciliation: (id: UUID) => ['trackers', id, 'reconciliation'] as const,
  recurring: (id: UUID) => ['trackers', id, 'recurring'] as const,
}

/** Ogni scrittura invalida saldi, riepiloghi e riconciliazione: sono derivati. */
function useTrackerInvalidation(trackerId: UUID) {
  const client = useQueryClient()
  return () => {
    client.invalidateQueries({ queryKey: ['trackers', trackerId] })
  }
}

/** PATCH se c'e' l'id, altrimenti POST: la stessa mutation crea e modifica. */
function useSaveResource<T, Body extends object>(trackerId: UUID, resource: string) {
  const invalidate = useTrackerInvalidation(trackerId)
  const base = `${trackerBase(trackerId)}/${resource}`
  return useMutation({
    mutationFn: ({ id, ...body }: Body & { id?: UUID }) =>
      id ? api.patch<T>(`${base}/${id}`, body) : api.post<T>(base, body),
    onSuccess: invalidate,
  })
}

function useDeleteResource(trackerId: UUID, resource: string) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: (id: UUID) => api.delete<void>(`${trackerBase(trackerId)}/${resource}/${id}`),
    onSuccess: invalidate,
  })
}

export function useTrackers() {
  return useQuery({
    queryKey: keys.trackers,
    queryFn: () => api.get<Paginated<Tracker>>('/api/trackers'),
  })
}

export function useTracker(trackerId: UUID | undefined) {
  return useQuery({
    queryKey: keys.tracker(trackerId!),
    queryFn: () => api.get<Tracker>(trackerBase(trackerId!)),
    enabled: Boolean(trackerId),
  })
}

/** Impostazioni del tracker (solo il proprietario): nome, valuta, semplifica debiti. */
export function useUpdateTracker(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Pick<Tracker, 'name' | 'currency' | 'kind' | 'simplify_debts'>>) =>
      api.patch<Tracker>(trackerBase(trackerId), body),
    onSuccess: () => {
      invalidate()
      return client.invalidateQueries({ queryKey: keys.trackers, exact: true })
    },
  })
}

/** Archivia o ripristina: il tracker resta, cambia solo gruppo nella lista. */
export function useArchiveTracker(trackerId: UUID) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (archived: boolean) =>
      api.post<Tracker>(`${trackerBase(trackerId)}/${archived ? 'archive' : 'unarchive'}`),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.trackers }),
  })
}

export function useDeleteTracker(trackerId: UUID) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete<void>(trackerBase(trackerId)),
    onSuccess: () => {
      client.removeQueries({ queryKey: keys.tracker(trackerId) })
      return client.invalidateQueries({ queryKey: keys.trackers, exact: true })
    },
  })
}

export function useCreateTracker() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; currency?: string; kind?: TrackerKind }) =>
      api.post<Tracker>('/api/trackers', body),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.trackers }),
  })
}

export function useMembers(trackerId: UUID) {
  return useQuery({
    queryKey: keys.members(trackerId),
    queryFn: () => api.get<Paginated<Membership>>(`${trackerBase(trackerId)}/members`),
  })
}

export function useInvite(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: (body: { email: string; role: string; default_share_pct: string }) =>
      api.post<Membership & { invite_token?: string }>(`${trackerBase(trackerId)}/invite`, body),
    onSuccess: invalidate,
  })
}

export function useUpdateMember(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: ({ id, ...body }: { id: UUID } & Partial<Membership>) =>
      api.patch<Membership>(`${trackerBase(trackerId)}/members/${id}`, body),
    onSuccess: invalidate,
  })
}

export function useRemoveMember(trackerId: UUID) {
  return useDeleteResource(trackerId, 'members')
}

export function useCategories(trackerId: UUID) {
  return useQuery({
    queryKey: keys.categories(trackerId),
    queryFn: () =>
      api.get<Paginated<Category>>(`${trackerBase(trackerId)}/categories`, { page_size: 200 }),
  })
}

export function useSaveCategory(trackerId: UUID) {
  return useSaveResource<Category, Partial<Category>>(trackerId, 'categories')
}

export function useDeleteCategory(trackerId: UUID) {
  return useDeleteResource(trackerId, 'categories')
}

export function useAccounts(trackerId: UUID) {
  return useQuery({
    queryKey: keys.accounts(trackerId),
    queryFn: () =>
      api.get<Paginated<Account>>(`${trackerBase(trackerId)}/accounts`, { page_size: 200 }),
  })
}

export function useSaveAccount(trackerId: UUID) {
  return useSaveResource<Account, Partial<Account>>(trackerId, 'accounts')
}

export function useDeleteAccount(trackerId: UUID) {
  return useDeleteResource(trackerId, 'accounts')
}

export function usePendingItems(trackerId: UUID, status = 'open') {
  return useQuery({
    queryKey: [...keys.pending(trackerId), status],
    queryFn: () =>
      api.get<Paginated<PendingItem>>(`${trackerBase(trackerId)}/pending-items`, {
        status,
        page_size: 200,
      }),
  })
}

export function useSavePendingItem(trackerId: UUID) {
  return useSaveResource<PendingItem, Partial<PendingItem>>(trackerId, 'pending-items')
}

export function useConvertPendingItem(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: ({ id, ...body }: { id: UUID } & Record<string, unknown>) =>
      api.post<Transaction>(`${trackerBase(trackerId)}/pending-items/${id}/convert`, body),
    onSuccess: invalidate,
  })
}

export function useDeletePendingItem(trackerId: UUID) {
  return useDeleteResource(trackerId, 'pending-items')
}

export type TransactionFilters = Record<string, string | number | undefined>

export function useTransactions(
  trackerId: UUID,
  filters: TransactionFilters,
  options?: Partial<UseQueryOptions<Paginated<Transaction>>>,
) {
  return useQuery({
    queryKey: keys.transactions(trackerId, filters),
    queryFn: () =>
      api.get<Paginated<Transaction>>(`${trackerBase(trackerId)}/transactions`, filters),
    placeholderData: (previous) => previous,
    ...options,
  })
}

export function useSaveTransaction(trackerId: UUID) {
  return useSaveResource<Transaction, Partial<TransactionPayload>>(trackerId, 'transactions')
}

export function useDeleteTransaction(trackerId: UUID) {
  return useDeleteResource(trackerId, 'transactions')
}

export function useBalances(trackerId: UUID) {
  return useQuery({
    queryKey: keys.balances(trackerId),
    queryFn: () => api.get<BalancesResponse>(`${trackerBase(trackerId)}/balances`),
  })
}

export function useSettlements(trackerId: UUID) {
  return useQuery({
    queryKey: keys.settlements(trackerId),
    queryFn: () => api.get<Paginated<Settlement>>(`${trackerBase(trackerId)}/settlements`),
  })
}

export function useCreateSettlement(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: (body: Partial<Settlement>) =>
      api.post<Settlement>(`${trackerBase(trackerId)}/settlements`, body),
    onSuccess: invalidate,
  })
}

export function useSummary(trackerId: UUID, params: SummaryParams) {
  return useQuery({
    queryKey: keys.summary(trackerId, params),
    queryFn: () => api.get<Summary>(`${trackerBase(trackerId)}/summary`, { ...params }),
    placeholderData: (previous) => previous,
  })
}

/* ---------------------------------------------------- scan estratto conto -- */

const statementsBase = (trackerId: UUID) => `${trackerBase(trackerId)}/statements`

export function useStatements(trackerId: UUID) {
  return useQuery({
    queryKey: ['trackers', trackerId, 'statements'] as const,
    queryFn: () => api.get<Paginated<StatementImport>>(statementsBase(trackerId)),
    // Finche' qualcosa e' in lettura la lista si aggiorna da sola.
    refetchInterval: (query) =>
      query.state.data?.results.some((s) => s.status === 'processing') ? 2500 : false,
  })
}

export function useStatement(trackerId: UUID, statementId: UUID | undefined) {
  return useQuery({
    queryKey: ['trackers', trackerId, 'statements', statementId] as const,
    queryFn: () => api.get<StatementImport>(`${statementsBase(trackerId)}/${statementId}`),
    enabled: Boolean(statementId),
    refetchInterval: (query) => (query.state.data?.status === 'processing' ? 2500 : false),
  })
}

export function useUploadStatement(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: ({
      file,
      account,
      source = 'scan',
    }: {
      file: File
      account?: UUID | null
      source?: StatementSource
    }) => {
      const form = new FormData()
      form.append('file', file)
      form.append('source', source)
      if (account) form.append('account', account)
      return api.post<StatementImport>(statementsBase(trackerId), form)
    },
    onSuccess: invalidate,
  })
}

/** La foto dello scontrino come object URL, liberato quando la pagina se ne va. */
export function useStatementFile(trackerId: UUID, statement: StatementImport | undefined) {
  const enabled = Boolean(statement?.has_file && statement.source === 'receipt')
  const query = useQuery({
    queryKey: ['trackers', trackerId, 'statements', statement?.id, 'file'] as const,
    queryFn: () => api.blob(`${statementsBase(trackerId)}/${statement!.id}/file`),
    enabled,
    staleTime: Infinity,
  })
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!query.data) return
    const objectUrl = URL.createObjectURL(query.data)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [query.data])
  return { url: enabled ? url : null, isLoading: query.isLoading && enabled, error: query.error }
}

export function useStatementAction(trackerId: UUID, statementId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  const base = `${statementsBase(trackerId)}/${statementId}`
  return {
    save: useMutation({
      mutationFn: (lines: StatementLine[]) => api.put<StatementImport>(`${base}/lines`, { lines }),
      onSuccess: invalidate,
    }),
    commit: useMutation({
      mutationFn: () => api.post<StatementImport>(`${base}/commit`),
      onSuccess: invalidate,
    }),
    retry: useMutation({
      mutationFn: () => api.post<StatementImport>(`${base}/retry`),
      onSuccess: invalidate,
    }),
    discard: useMutation({
      mutationFn: () => api.delete<void>(base),
      onSuccess: invalidate,
    }),
  }
}

export function useBalanceHistory(
  trackerId: UUID,
  params: { date_from: string; date_to: string; user_id?: UUID },
) {
  return useQuery({
    queryKey: ['trackers', trackerId, 'balance-history', params] as const,
    queryFn: () =>
      api.get<BalanceHistory>(`${trackerBase(trackerId)}/balance-history`, { ...params }),
    placeholderData: (previous) => previous,
  })
}

/** ``enabled`` falso nei tracker "group", dove la riconciliazione non si mostra. */
export function useReconciliation(trackerId: UUID, enabled = true) {
  return useQuery({
    queryKey: keys.reconciliation(trackerId),
    queryFn: () => api.get<Reconciliation>(`${trackerBase(trackerId)}/reconciliation`),
    enabled,
  })
}

export function useRecurringRules(trackerId: UUID) {
  return useQuery({
    queryKey: keys.recurring(trackerId),
    queryFn: () =>
      api.get<Paginated<RecurringRule>>(`${trackerBase(trackerId)}/recurring-rules`, {
        page_size: 200,
      }),
  })
}

export function useSaveRecurringRule(trackerId: UUID) {
  return useSaveResource<RecurringRule, Partial<RecurringRule>>(trackerId, 'recurring-rules')
}

/**
 * Proposte ricorrenti da approvare.
 *
 * Con `auto_commit=false` la regola propone e basta, ma il backend non espone
 * ancora le occorrenze in sospeso. Finché non esiste
 * `GET /trackers/{id}/recurring/pending`, le proposte si derivano dalle regole
 * scadute e non auto-confermate: stessa informazione, calcolata dal client.
 */
export function useRecurringProposals(trackerId: UUID) {
  const query = useRecurringRules(trackerId)
  const proposals = (query.data?.results ?? []).filter((rule) => rule.is_due && !rule.auto_commit)
  return { ...query, proposals }
}

/**
 * Approva o salta l'occorrenza `next_run` di una ricorrenza. Una sola chiamata
 * atomica lato backend; `occurrence` evita che un doppio clic scriva due volte.
 */
export function useRecurringOccurrence(trackerId: UUID, action: 'approve' | 'skip') {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: (rule: Pick<RecurringRule, 'id' | 'next_run'>) =>
      api.post<unknown>(`${trackerBase(trackerId)}/recurring-rules/${rule.id}/${action}`, {
        occurrence: rule.next_run,
      }),
    onSuccess: invalidate,
  })
}

export function useDeleteRecurringRule(trackerId: UUID) {
  return useDeleteResource(trackerId, 'recurring-rules')
}

/* ------------------------------------------------ open banking (ADR 0013) -- */

const bankingKey = ['banking'] as const

export function useBankingStatus() {
  return useQuery({
    queryKey: [...bankingKey, 'app'] as const,
    queryFn: () => api.get<BankingStatus>('/api/banking/app'),
  })
}

export function useSaveBankingApp() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ appId, key }: { appId: string; key: File }) => {
      const form = new FormData()
      form.append('app_id', appId)
      form.append('key', key)
      return api.put<BankingStatus>('/api/banking/app', form)
    },
    onSuccess: (status) => {
      client.setQueryData([...bankingKey, 'app'], status)
      client.invalidateQueries({ queryKey: bankingKey })
    },
  })
}

export function useDeleteBankingApp() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete<void>('/api/banking/app'),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: bankingKey })
      client.invalidateQueries({ queryKey: ['trackers'] })
    },
  })
}

export function useAspsps(country: string, enabled: boolean) {
  return useQuery({
    queryKey: [...bankingKey, 'aspsps', country] as const,
    queryFn: () => api.get<Aspsp[]>('/api/banking/aspsps', { country }),
    enabled,
    staleTime: 60 * 60 * 1000,
  })
}

const connectionsBase = (trackerId: UUID) => `${trackerBase(trackerId)}/bank-connections`

export function useBankConnections(trackerId: UUID, enabled = true) {
  return useQuery({
    queryKey: ['trackers', trackerId, 'bank-connections'] as const,
    queryFn: () => api.get<BankConnection[]>(connectionsBase(trackerId)),
    enabled,
  })
}

/** Apre l'autorizzazione: la risposta ha l'URL della banca dove mandare l'utente. */
export function useStartBankConnection(trackerId: UUID) {
  return useMutation({
    mutationFn: (aspsp: Aspsp) =>
      api.post<{ id: UUID; url: string }>(connectionsBase(trackerId), {
        aspsp_name: aspsp.name,
        country: aspsp.country,
        logo: aspsp.logo,
        max_validity: aspsp.maximum_consent_validity,
      }),
  })
}

export function useCompleteBankConnection() {
  return useMutation({
    mutationFn: (body: { code: string; state: string }) =>
      api.post<BankConnection>('/api/banking/complete', body),
  })
}

export function useDeleteBankConnection(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: (id: UUID) => api.delete<void>(`${connectionsBase(trackerId)}/${id}`),
    onSuccess: invalidate,
  })
}

const bankAccountsBase = (trackerId: UUID) => `${trackerBase(trackerId)}/bank-accounts`

export function useUpdateBankAccount(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<BankAccountLink> & { id: UUID }) =>
      api.patch<BankAccountLink>(`${bankAccountsBase(trackerId)}/${id}`, body),
    onSuccess: invalidate,
  })
}

export function useSyncBankAccount(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: (id: UUID) => api.post<BankSyncResult>(`${bankAccountsBase(trackerId)}/${id}/sync`),
    onSettled: invalidate,
  })
}
