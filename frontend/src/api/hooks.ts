import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'

import { api } from '../lib/api'
import type {
  Account,
  BalanceHistory,
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
    mutationFn: (body: { name: string; currency?: string }) =>
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
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: (id: UUID) => api.delete<void>(`${trackerBase(trackerId)}/members/${id}`),
    onSuccess: invalidate,
  })
}

export function useCategories(trackerId: UUID) {
  return useQuery({
    queryKey: keys.categories(trackerId),
    queryFn: () =>
      api.get<Paginated<Category>>(`${trackerBase(trackerId)}/categories`, { page_size: 200 }),
  })
}

export function useSaveCategory(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Category> & { id?: UUID }) =>
      id
        ? api.patch<Category>(`${trackerBase(trackerId)}/categories/${id}`, body)
        : api.post<Category>(`${trackerBase(trackerId)}/categories`, body),
    onSuccess: invalidate,
  })
}

export function useDeleteCategory(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: (id: UUID) => api.delete<void>(`${trackerBase(trackerId)}/categories/${id}`),
    onSuccess: invalidate,
  })
}

export function useAccounts(trackerId: UUID) {
  return useQuery({
    queryKey: keys.accounts(trackerId),
    queryFn: () =>
      api.get<Paginated<Account>>(`${trackerBase(trackerId)}/accounts`, { page_size: 200 }),
  })
}

export function useSaveAccount(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Account> & { id?: UUID }) =>
      id
        ? api.patch<Account>(`${trackerBase(trackerId)}/accounts/${id}`, body)
        : api.post<Account>(`${trackerBase(trackerId)}/accounts`, body),
    onSuccess: invalidate,
  })
}

export function useDeleteAccount(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: (id: UUID) => api.delete<void>(`${trackerBase(trackerId)}/accounts/${id}`),
    onSuccess: invalidate,
  })
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
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<PendingItem> & { id?: UUID }) =>
      id
        ? api.patch<PendingItem>(`${trackerBase(trackerId)}/pending-items/${id}`, body)
        : api.post<PendingItem>(`${trackerBase(trackerId)}/pending-items`, body),
    onSuccess: invalidate,
  })
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
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: (id: UUID) => api.delete<void>(`${trackerBase(trackerId)}/pending-items/${id}`),
    onSuccess: invalidate,
  })
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
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<TransactionPayload> & { id?: UUID }) =>
      id
        ? api.patch<Transaction>(`${trackerBase(trackerId)}/transactions/${id}`, body)
        : api.post<Transaction>(`${trackerBase(trackerId)}/transactions`, body),
    onSuccess: invalidate,
  })
}

export function useDeleteTransaction(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: (id: UUID) => api.delete<void>(`${trackerBase(trackerId)}/transactions/${id}`),
    onSuccess: invalidate,
  })
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

export function useReconciliation(trackerId: UUID) {
  return useQuery({
    queryKey: keys.reconciliation(trackerId),
    queryFn: () => api.get<Reconciliation>(`${trackerBase(trackerId)}/reconciliation`),
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
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<RecurringRule> & { id?: UUID }) =>
      id
        ? api.patch<RecurringRule>(`${trackerBase(trackerId)}/recurring-rules/${id}`, body)
        : api.post<RecurringRule>(`${trackerBase(trackerId)}/recurring-rules`, body),
    onSuccess: invalidate,
  })
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
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: (id: UUID) => api.delete<void>(`${trackerBase(trackerId)}/recurring-rules/${id}`),
    onSuccess: invalidate,
  })
}
