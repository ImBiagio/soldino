// Tipi allineati agli serializer DRF. In fase 2 questo file viene sostituito
// dal client generato da OpenAPI (`npm run api:generate`).

export type UUID = string
export type Money = string // Decimal serializzato: mai un number, mai float.

export type TransactionType = 'expense' | 'income'
export type MemberRole = 'owner' | 'editor' | 'viewer'
export type MemberStatus = 'pending' | 'active' | 'revoked'

export interface User {
  id: UUID
  email: string
  display_name: string
  avatar: string | null
  email_verified_at?: string | null
}

export interface Membership {
  id: UUID
  user: User | null
  invited_email: string
  role: MemberRole
  default_share_pct: Money
  /** Saldo sui conti alla data di partenza: base della riconciliazione. */
  opening_balance: Money
  opening_date: string | null
  status: MemberStatus
  display_name: string
  created_at: string
}

export type TrackerKind = 'household' | 'group'

export interface Tracker {
  id: UUID
  name: string
  currency: string
  owner: User
  archived_at: string | null
  /** Preset di interfaccia (ADR 0010): i calcoli non cambiano, cambia cosa si vede. */
  kind: TrackerKind
  /** Debiti chiusi col minor numero di bonifici; spento = ognuno restituisce a chi ha pagato. */
  simplify_debts: boolean
  members: Membership[]
  my_role: MemberRole | null
  created_at: string
}

export interface Category {
  id: UUID
  name: string
  description: string
  type: TransactionType
  color: string
  icon: string
  archived: boolean
}

export interface Account {
  id: UUID
  name: string
  owner: UUID
  owner_detail: User
  kind: 'bank' | 'card' | 'cash' | 'wallet'
  current_balance: Money
  balance_updated_at: string | null
  include_in_totals: boolean
}

export interface PendingItem {
  id: UUID
  title: string
  amount: Money
  owner: UUID
  owner_detail: User
  expected_date: string | null
  status: 'open' | 'converted' | 'cancelled'
  converted_transaction: UUID | null
  note: string
}

export interface Split {
  id: UUID
  user: UUID
  user_detail: User
  share_pct: Money
  share_amount: Money
}

export interface SplitInput {
  user: UUID
  share_pct?: Money
  share_amount?: Money
}

export interface Transaction {
  id: UUID
  type: TransactionType
  date: string
  title: string
  merchant_normalized: string
  amount: Money
  category: UUID | null
  category_name: string | null
  category_color: string | null
  account: UUID | null
  account_name: string | null
  paid_by: UUID
  paid_by_detail: User
  note: string
  source: string
  fingerprint: string
  splits: Split[]
  possible_duplicates: UUID[]
  created_at: string
}

export interface TransactionPayload {
  type: TransactionType
  date: string
  title: string
  amount: Money
  category?: UUID | null
  account?: UUID | null
  paid_by: UUID
  note?: string
  splits_input?: SplitInput[]
  split_mode?: 'personal' | 'default'
}

export interface Settlement {
  id: UUID
  from_user: UUID
  from_user_detail: User
  to_user: UUID
  to_user_detail: User
  amount: Money
  date: string
  note: string
}

export interface Balance {
  user: { id: UUID; display_name: string; email: string }
  paid: Money
  owed: Money
  settlements_sent: Money
  settlements_received: Money
  net: Money
}

export interface BalancesResponse {
  /** Come sono calcolati i `suggested_transfers`: vale `Tracker.simplify_debts`. */
  simplified: boolean
  balances: Balance[]
  suggested_transfers: {
    from_user: { id: UUID; display_name: string }
    to_user: { id: UUID; display_name: string }
    amount: Money
  }[]
}

/** Filtri di `GET /trackers/{id}/summary`. Con `user_id` i totali sono la sua quota. */
export interface SummaryParams {
  year?: number
  month?: number
  date_from?: string
  date_to?: string
  user_id?: UUID
  category?: UUID | 'none'
}

export interface Summary {
  year: number | null
  month: number | null
  total_expense: Money
  total_income: Money
  net: Money
  transaction_count: number
  by_category: {
    category_id: UUID | null
    category_name: string
    color: string
    icon: string
    type: TransactionType
    total: Money
    count: number
  }[]
  by_user: { user_id: UUID; type: TransactionType; total: Money }[]
  by_month: { month: number; year: number; type: TransactionType; total: Money }[]
}

/**
 * Per cassa (ADR 0007): atteso = saldo iniziale + entrate − uscite ± pareggi;
 * reale = conti + in attesa; delta = reale − atteso.
 */
export interface ReconciliationFigures {
  opening_balance: Money
  income: Money
  expense: Money
  settlements_net: Money
  transactions_balance: Money
  expected_balance: Money
  accounts_balance: Money
  pending_total: Money
  available_balance: Money
  delta: Money
}

export type StatementStatus = 'processing' | 'ready' | 'failed' | 'committed'
export type CategorySource = 'history' | 'ai' | 'manual' | ''

export interface StatementLine {
  id?: UUID
  date: string
  title: string
  amount: Money
  type: TransactionType
  category: UUID | null
  category_source?: CategorySource
  paid_by: UUID
  split_mode: 'personal' | 'default'
  duplicate_of?: UUID | null
  transaction?: UUID | null
}

/** Scan di un estratto conto: righe in bozza finche' non si conferma (ADR 0008). */
export interface StatementImport {
  id: UUID
  /** Lo scan del PDF o la sincronizzazione con la banca (ADR 0013): stessa bozza. */
  source: 'scan' | 'bank'
  filename: string
  account: UUID | null
  account_name: string | null
  default_payer: UUID
  status: StatementStatus
  error: string
  model_name: string
  period_start: string | null
  period_end: string | null
  committed_at: string | null
  uploaded_by_detail: User
  line_count: number
  lines: StatementLine[]
  created_at: string
}

/* ------------------------------------------- open banking (ADR 0013) -- */

export interface BankingApp {
  app_id: UUID
  name: string
  environment: string
  active: boolean
  redirect_urls: string[]
  verified_at: string | null
}

/** `GET /banking/app`: a che punto e' il setup dell'utente. */
export interface BankingStatus {
  configured: boolean
  /** Da incollare nei Redirect URLs dell'applicazione Enable Banking. */
  callback_url: string
  app: BankingApp | null
}

/** Una banca disponibile (ASPSP nel gergo PSD2). */
export interface Aspsp {
  name: string
  country: string
  logo: string
  beta: boolean
  maximum_consent_validity: number | null
}

export interface BankAccountLink {
  id: UUID
  name: string
  iban: string
  currency: string
  account: UUID | null
  account_name: string | null
  auto_commit: boolean
  sync_from: string | null
  last_synced_at: string | null
  synced_until: string | null
  last_error: string
  draft: { id: UUID; line_count: number } | null
}

export type BankConnectionStatus = 'active' | 'expired' | 'replaced'

export interface BankConnection {
  id: UUID
  tracker: UUID
  aspsp_name: string
  aspsp_country: string
  aspsp_logo: string
  valid_until: string | null
  status: BankConnectionStatus
  error: string
  accounts: BankAccountLink[]
  created_at: string
}

export interface BankSyncResult {
  balance?: Money | null
  committed?: number
  drafted?: number
  skipped?: string
}

/** `GET /trackers/{id}/balance-history`: saldo per cassa giorno per giorno. */
export interface BalanceHistory {
  start_balance: Money
  end_balance: Money
  points: { date: string; balance: Money; income: Money; expense: Money }[]
}

export interface Reconciliation extends ReconciliationFigures {
  people: (ReconciliationFigures & { user: User; opening_date: string | null })[]
}

export interface RecurringRule {
  id: UUID
  type: TransactionType
  title: string
  amount: Money
  category: UUID | null
  account: UUID | null
  paid_by: UUID
  frequency: 'weekly' | 'monthly' | 'yearly' | 'custom'
  rrule: string
  next_run: string
  end_date: string | null
  is_subscription: boolean
  auto_commit: boolean
  split_template: SplitInput[]
  active: boolean
  monthly_cost: Money
  yearly_cost: Money
  /** Calcolato dal backend col suo fuso: c'e' un'occorrenza da approvare o saltare. */
  is_due: boolean
}

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}
