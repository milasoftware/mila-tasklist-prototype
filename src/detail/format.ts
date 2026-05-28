import { meta } from '../data'

const SNAPSHOT = new Date(meta.snapshot_datum)
export const daysOverdue = (vervaldatum: string) =>
  Math.floor((SNAPSHOT.getTime() - new Date(vervaldatum).getTime()) / 86400000)

export const fmtEUR = (n: number) =>
  n.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
export const fmtNL = (n: number, dec = 1) =>
  n.toLocaleString('nl-NL', { minimumFractionDigits: dec, maximumFractionDigits: dec })
export const fmtDM = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function priorityTone(p: number) {
  if (p >= 4) return 'bg-red-50 text-red-900 ring-red-200'
  if (p >= 3) return 'bg-orange-50 text-orange-900 ring-orange-200'
  if (p >= 2) return 'bg-amber-50 text-amber-900 ring-amber-200'
  return 'bg-slate-50 text-slate-700 ring-slate-200'
}
