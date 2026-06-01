import { getDebiteur, getFacturen, getFacturenVoorDebiteur, type Factuur, type Task } from '../data'
import { daysOverdue } from './format'

// Afgesproken betaaltermijn op één factuur: vervaldatum − factuurdatum (dagen).
function termDagenFactuur(f: Factuur): number | null {
  if (!f.factuurdatum || !f.vervaldatum) return null
  const d = Math.floor(
    (new Date(f.vervaldatum).getTime() - new Date(f.factuurdatum).getTime()) / 86400000,
  )
  if (d < 0 || d > 365) return null
  return d
}

// Laatste post = meest recente factuurdatum (open én gesloten/betaald).
// Creditnota's vallen buiten de termijn-berekening.
function laatstePost(all: Factuur[]): Factuur | null {
  const candidates = all.filter(
    (f) => f.status !== 'credit_nota' && f.factuurdatum && f.vervaldatum,
  )
  if (candidates.length === 0) return null
  return candidates.reduce((best, f) => (f.factuurdatum > best.factuurdatum ? f : best))
}

// Altijd een waarde: eerst termijn van laatste post, anders fallback (debiteur-hash).
export function afgesprokenBetaaltermijnVanLaatstePost(
  all: Factuur[],
  fallbackDagen?: number,
): number {
  const post = laatstePost(all)
  const fromPost = post ? termDagenFactuur(post) : null
  if (fromPost != null) return fromPost
  if (fallbackDagen != null) return fallbackDagen
  return 30
}

// Backwards-compat helper: oudere geüploade datasets (gegenereerd vóór de
// "normaliseer priority weights"-tweak) bevatten geen `priority_weights`.
// Zonder fallback crasht de detail-view daarop hard (wit scherm). We leiden
// in dat geval de gewichten af uit de aanwezigheid van potentieel.score:
//   - score bekend → 30/20/40/10 verdeling
//   - score null   → normaliseer over de overige drie (33,3 / 22,2 / 44,4)
export function derivePriorityWeights(task: Task) {
  if (task.priority_weights) return task.priority_weights
  const potentieelBekend = task.potentieel?.score != null
  return potentieelBekend
    ? { impact: 0.3, urgentie: 0.2, risico: 0.4, potentieel: 0.1, genormaliseerd: false }
    : { impact: 0.3 / 0.9, urgentie: 0.2 / 0.9, risico: 0.4 / 0.9, potentieel: 0, genormaliseerd: true }
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
  const afgesprokenBetaaltermijn = afgesprokenBetaaltermijnVanLaatstePost(all, deb?.betaaltermijn)
  return {
    deb,
    all,
    open,
    openSum,
    overdueOpen,
    oudste,
    afgesprokenBetaaltermijn,
    taakFacturen,
    taakIds,
  }
}
