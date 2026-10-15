// Sul frontend gli importi restano stringhe decimali. I calcoli si fanno in
// centesimi interi: nessun float tocca mai un importo.

/** I campi importo accettano la virgola italiana: per il calcolo serve il punto. */
export function normalizeDecimal(raw: string): string {
  return raw.replace(',', '.').trim()
}

export function toCents(value: string | number): number {
  const normalized = normalizeDecimal(String(value))
  if (!normalized || Number.isNaN(Number(normalized))) return 0
  return Math.round(Number(normalized) * 100)
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * Stesso algoritmo del backend (largest remainder): l'anteprima non mente.
 *
 * Tutto in interi (BigInt): con i float `4/3 - 1` e `1/3` non sono uguali, e a
 * parita' di resto l'ordine cambierebbe rispetto al Decimal del backend. I pesi
 * negativi non esistono per il backend: qui contano zero, cosi' l'anteprima non
 * mostra mai quote che sommano piu' del totale.
 */
export function allocate(totalCents: number, weights: number[]): number[] {
  if (totalCents < 0) return allocate(-totalCents, weights).map((c) => -c)
  const w = weights.map((weight) => BigInt(Math.max(0, Math.round(weight))))
  const sum = w.reduce((a, b) => a + b, 0n)
  if (sum <= 0n) return weights.map(() => 0)

  const total = BigInt(totalCents)
  const floors = w.map((weight) => (total * weight) / sum)
  // Il resto di ciascuno ha lo stesso denominatore (sum): basta il numeratore.
  const remainders = w.map((weight) => (total * weight) % sum)
  let leftover = total - floors.reduce((a, b) => a + b, 0n)
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    )
  for (const { index } of order) {
    if (leftover <= 0n) break
    floors[index] += 1n
    leftover -= 1n
  }
  return floors.map(Number)
}

/**
 * Pesi -> percentuali che sommano esattamente 100,00: la stessa ripartizione a
 * centesimi applicata a 10000 "centesimi di punto". 100/50 diventa 66,67/33,33.
 */
export function normalizePercentages(weights: number[]): string[] {
  return allocate(10000, weights).map(fromCents)
}

export function formatCents(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(cents / 100)
}

export function formatSignedCents(cents: number, currency = 'EUR'): string {
  const formatted = formatCents(Math.abs(cents), currency)
  if (cents > 0) return `+${formatted}`
  if (cents < 0) return `−${formatted}`
  return formatted
}

export function formatMoney(value: string | number, currency = 'EUR'): string {
  return formatCents(toCents(value), currency)
}

export function formatSigned(value: string | number, currency = 'EUR'): string {
  return formatSignedCents(toCents(value), currency)
}
