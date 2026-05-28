import { getDebiteur, getFacturen, getFacturenVoorDebiteur, type Task } from '../data'
import { daysOverdue } from './format'

// Centrale lookup van alles wat we voor een taak/debiteur nodig hebben.
// Wordt door meerdere sub-componenten gebruikt — één keer berekend per render.
export function getDebtorData(task: Task) {
  if (!task.debiteurnummer) return null
  const deb = getDebiteur(task.debiteurnummer)
  const all = getFacturenVoorDebiteur(task.debiteurnummer)
  if (all.length === 0) return null

  const open = all.filter((f) => f.status === 'open')
  const openSum = open.reduce((s, f) => s + f.openstaand, 0)
  const overdueOpen = open.filter((f) => daysOverdue(f.vervaldatum) > 0)
  const oudste = overdueOpen.reduce(
    (max, f) => Math.max(max, daysOverdue(f.vervaldatum)),
    0,
  )

  const taakFacturen = task.gerelateerde_facturen
    ? getFacturen(task.gerelateerde_facturen)
    : task.factuurnummer
      ? getFacturen([task.factuurnummer])
      : []
  const taakIds = new Set(taakFacturen.map((f) => f.id))
  return { deb, all, open, openSum, overdueOpen, oudste, taakFacturen, taakIds }
}
