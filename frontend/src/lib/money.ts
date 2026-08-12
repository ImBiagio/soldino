// Sul frontend gli importi restano stringhe decimali. I calcoli si fanno in
// centesimi interi: nessun float tocca mai un importo.

export function toCents(value: string | number): number {
  const normalized = String(value).replace(',', '.').trim()
  if (!normalized || Number.isNaN(Number(normalized))) return 0
  return Math.round(Number(normalized) * 100)
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Stesso algoritmo del backend (largest remainder): l'anteprima non mente. */
export function allocate(totalCents: number, weights: number[]): number[] {
  if (totalCents < 0) return allocate(-totalCents, weights).map((c) => -c)
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) return weights.map(() => 0)

  const floors: number[] = []
  const remainders: number[] = []
  for (const weight of weights) {
    const exact = (totalCents * weight) / sum
    const floor = Math.floor(exact)
    floors.push(floor)
    remainders.push(exact - floor)
  }
  let leftover = totalCents - floors.reduce((a, b) => a + b, 0)
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const { index } of order) {
    if (leftover <= 0) break
    floors[index] += 1
    leftover -= 1
  }
  return floors
}

export function formatMoney(value: string | number, currency = 'EUR'): string {
  const cents = toCents(value)
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(cents / 100)
}

export function formatSigned(value: string | number, currency = 'EUR'): string {
  const cents = toCents(value)
  const formatted = formatMoney(Math.abs(cents) / 100, currency)
  if (cents > 0) return `+${formatted}`
  if (cents < 0) return `−${formatted}`
  return formatted
}
