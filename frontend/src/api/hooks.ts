import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query'

import { api } from '../lib/api'
import type {
  Account,
  BalancesResponse,
  Category,
  Membership,
  Paginated,
  PendingItem,
  Reconciliation,
  RecurringRule,
  Settlement,
  Summary,
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
  transactions: (id: UUID, filters: unknown) =>
    ['trackers', id, 'transactions', filters] as const,
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

export function useSummary(trackerId: UUID, period: { year?: number; month?: number }) {
  return useQuery({
    queryKey: keys.summary(trackerId, period),
    queryFn: () => api.get<Summary>(`${trackerBase(trackerId)}/summary`, period),
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

export function useDeleteRecurringRule(trackerId: UUID) {
  const invalidate = useTrackerInvalidation(trackerId)
  return useMutation({
    mutationFn: (id: UUID) => api.delete<void>(`${trackerBase(trackerId)}/recurring-rules/${id}`),
    onSuccess: invalidate,
  })
}
