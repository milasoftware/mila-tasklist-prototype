import { getDebiteur, getFacturen, getFacturenVoorDebiteur, type Task } from '../data'
import { daysOverdue } from './format'

// Backwards-compat helper: oudere geüploade datasets (gegenereerd vóór de
// "normaliseer priority weights"-tweak) bevatten geen `priority_weights`.
// Zonder fallback crasht de detail-view daarop hard (wit scherm). We leiden
// in dat geval de gewichten af uit de aanwezigheid van potentieel.score:
//   - score bekend → originele 40/30/20/10 verdeling
//   - score null   → normaliseer over de overige drie (44,4 / 33,3 / 22,2)
export function derivePriorityWeights(task: Task) {
  if (task.priority_weights) return task.priority_weights
  const potentieelBekend = task.potentieel?.score != null
  return potentieelBekend
    ? { impact: 0.4, urgentie: 0.3, risico: 0.2, potentieel: 0.1, genormaliseerd: false }
    : { impact: 0.4 / 0.9, urgentie: 0.3 / 0.9, risico: 0.2 / 0.9, potentieel: 0, genormaliseerd: true }
}

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
