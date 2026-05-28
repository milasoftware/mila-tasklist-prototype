// @ts-nocheck
export const oneDay = 86400000

export const num = (s) =>
  s === undefined || s === null || s === '' ? 0 : parseFloat(String(s).replace(',', '.'))

export const daysBetween = (later, earlier) =>
  Math.floor((new Date(later) - new Date(earlier)) / oneDay)

export const round = (n, dec = 2) => {
  const f = Math.pow(10, dec)
  return Math.round(n * f) / f
}

export const formatEUR = (n) =>
  '€' + n.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export function percentile(arr, p) {
  if (arr.length === 0) return 0
  const idx = Math.floor((p / 100) * (arr.length - 1))
  return arr[idx]
}

export const median = (vals) => {
  if (!vals.length) return null
  const sorted = [...vals].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function quartile(arr, q) {
  if (arr.length === 0) return 0
  return arr[Math.floor(q * (arr.length - 1))]
}
