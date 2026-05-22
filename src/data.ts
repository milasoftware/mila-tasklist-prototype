// Data laag — leest uit data.generated.json (gegenereerd door
// scripts/preprocess.mjs uit de dummy export).
//
// Bevat zowel de "flat" Task-shape die de huidige UI gebruikt (pad A),
// als de losse relationele entiteiten Debiteur / Factuur / Betaling
// die nog niet door de UI worden gebruikt maar straks de basis vormen
// voor pad B (factuur-historie in detailpaneel, etc.).

import generated from './data.generated.json'

export type EffectType =
  | 'directe_cash'
  | 'versnelling'
  | 'bescherming'
  | 'monitoring'
  | 'administratief'

export type TaskType =
  | 'bel_actie'
  | 'herinnering'
  | 'dispuut_oplossen'
  | 'kredietactie'
  | 'monitoring'
  | 'administratief'
  | 'escalatie'

export type Task = {
  id: string
  debiteur: string
  debiteurnummer?: string
  type: TaskType
  taakomschrijving: string
  aanleiding: string
  factuurnummer?: string
  bedrag?: number
  gerelateerde_facturen?: string[]
  priority: number
  impact: {
    score: number
    bedrag_score: number
    effect_score: number
    effect_type: EffectType
    bedrag?: number
    pct_van_ar?: number
    bedrag_rank?: number
    bedrag_total_tasks?: number
    explanation: string
  }
  urgentie: {
    score: number
    dagen_vervallen?: number
    reden: string
  }
  risico: {
    score: number
    betaalgedrag: number
    huidige_stand: number
    huidige_stand_pct_vervallen?: number
    huidige_stand_pct_score?: number
    huidige_stand_oudste_dagen?: number
    huidige_stand_oudste_score?: number
    disputen: number | null
    krediet: number | null
    krediet_limiet?: number
    krediet_openstaand?: number
    krediet_onverzekerd_bedrag?: number
    krediet_onverzekerd_pct?: number
    krediet_pct_score?: number | null
    krediet_impact_score?: number | null
    omzetconcentratie: number
    omzetconcentratie_pct?: number
    omzetconcentratie_omzet?: number
    betaalgedrag_breakdown?: BetaalgedragBreakdown
  }
  potentieel: {
    score: number
    werkelijke_dagen: number
    afgesproken_dagen: number
    term_diff_dagen?: number
    beinvloedbare_dagen?: number
    dso_impact_euro_dagen?: number
    haalbaarheidsdrempel_dagen?: number
    reden: string
    pattern?: PatternInfo
  }
}

export type Confidence = 'hoog' | 'middel' | 'geen'

export type BetaalgedragBreakdown = {
  dso: {
    score: number
    median_days_late: number
    invoice_count: number
    from_overdue?: boolean
    oudste_dagen_vervallen?: number
  }
  trend: {
    score: number | null
    label: string
    confidence: Confidence
    tau: number
    p_value: number
    months_observed: number
    explanation: string
    series: { month: string; dso: number }[]
  }
  volatiliteit: {
    score: number | null
    label: string
    confidence: Confidence
    cv: number
    intervals_observed: number
    explanation: string
  }
}

export type PatternInfo = {
  pattern_type: 'maandelijks' | 'einde_maand' | 'wekelijks' | 'interval' | 'geen'
  pattern_value: string | null
  fit_pct: number
  payments_observed: number
  confidence: Confidence
  explanation: string
}

// Relationele entiteiten (nog niet gebruikt door UI — voor pad B)
export type Debiteur = {
  id: string
  naam: string
  plaats?: string
  accountmanager?: string
  klanttype?: string
  // Afgesproken betaaltermijn in dagen (30 of 45). Niet aanwezig in bron —
  // deterministisch toegekend per debiteur in preprocess.
  betaaltermijn: 30 | 45
}

export type Factuur = {
  id: string
  debiteurnummer: string
  factuurdatum: string
  vervaldatum: string
  bedrag: number
  openstaand: number
  status: 'open' | 'betaald' | 'credit_nota'
  // Laatste betaaldatum (max van alle betalingen op deze factuur). Bij
  // deelbetalingen het moment dat alles binnen was. Null als de factuur nog
  // openstaat of geen betalingen heeft.
  betaaldatum: string | null
}

export type Betaling = {
  id: string
  factuurnummer: string
  debiteurnummer: string
  datum: string
  bedrag: number
}

// Losse betaalboekingen — bronrecords met Invoicetype/Documenttype ≠ Factuur
// (Betaling, Terugbetaling of leeg). Niet gekoppeld aan een specifieke factuur.
export type LosseBetaling = {
  id: string
  debiteurnummer: string
  datum: string
  bedrag: number
  documenttype: 'Betaling' | 'Terugbetaling' | ''
}

export type Meta = {
  snapshot_datum: string
  bron: string
  administratie: string
  total_open_ar: number
  jaaromzet_totaal: number
  omzet_scope?: string
  omzet_populatie_debiteuren?: number
  omzet_percentielen?: {
    p20: number
    p40: number
    p60: number
    p80: number
  }
  omzet_buckets?: {
    thresholds: number[]
    counts: number[]
    min: number
    max: number
  }
  krediet_percentielen?: {
    p20: number
    p40: number
    p60: number
    p80: number
  }
  krediet_buckets?: {
    thresholds: number[]
    counts: number[]
    min: number
    max: number
  }
  krediet_populatie_debiteuren?: number
  potentieel_buckets?: {
    thresholds: number[] // [0, P25, P50, P75] op dsoImpact > 0 (euro-dagen)
    counts: number[] // 5 items: score 1..5
    min: number
    max: number
    populatie_debiteuren: number // alleen debiteuren met vervallen debet
    haalbaarheidsdrempel_dagen: number
  }
  total_facturen: number
  total_open_facturen: number
  total_taken_gegenereerd: number
  top_n: number | null
  taken_in_set: number
  debiteuren_in_set: number
  facturen_in_set: number
  betalingen_in_set: number
  uitgesloten_categorieen: string[]
  uitsluitings_reden: string
  bedrag_buckets: {
    thresholds: number[] // [P20, P40, P60, P80]
    counts: number[] // 5 items: aantal taken per score-bucket
    min: number
    max: number
  }
}

export const TYPE_LABEL: Record<TaskType, string> = {
  bel_actie: 'Bellen',
  herinnering: 'Herinnering',
  dispuut_oplossen: 'Dispuut oplossen',
  kredietactie: 'Kredietactie',
  monitoring: 'Monitoring',
  administratief: 'Administratief',
  escalatie: 'Escalatie',
}

export const EFFECT_LABEL: Record<EffectType, string> = {
  directe_cash: 'Directe cash',
  versnelling: 'Versnelling',
  bescherming: 'Bescherming',
  monitoring: 'Monitoring',
  administratief: 'Administratief',
}

export const tasks: Task[] = generated.tasks as Task[]
export const debiteuren: Debiteur[] = generated.debiteuren as Debiteur[]
export const facturen: Factuur[] = generated.facturen as Factuur[]
export const betalingen: Betaling[] = generated.betalingen as Betaling[]
export const losseBetalingen: LosseBetaling[] = (generated as { losseBetalingen?: LosseBetaling[] })
  .losseBetalingen ?? []
export const meta: Meta = generated.meta as Meta

// Lookup-helpers — gebruikt door UI voor het renderen van debiteur-historie
// in het detailpaneel.
const debiteurById = new Map(debiteuren.map((d) => [d.id, d]))
const factuurById = new Map(facturen.map((f) => [f.id, f]))
const facturenByDebiteur = new Map<string, Factuur[]>()
for (const f of facturen) {
  if (!facturenByDebiteur.has(f.debiteurnummer)) facturenByDebiteur.set(f.debiteurnummer, [])
  facturenByDebiteur.get(f.debiteurnummer)!.push(f)
}

const betalingenByDebiteur = new Map<string, Betaling[]>()
for (const b of betalingen) {
  if (!betalingenByDebiteur.has(b.debiteurnummer)) betalingenByDebiteur.set(b.debiteurnummer, [])
  betalingenByDebiteur.get(b.debiteurnummer)!.push(b)
}

const losseBetalingenByDebiteur = new Map<string, LosseBetaling[]>()
for (const b of losseBetalingen) {
  if (!losseBetalingenByDebiteur.has(b.debiteurnummer))
    losseBetalingenByDebiteur.set(b.debiteurnummer, [])
  losseBetalingenByDebiteur.get(b.debiteurnummer)!.push(b)
}

export const getDebiteur = (id: string): Debiteur | undefined => debiteurById.get(id)
export const getFactuur = (id: string): Factuur | undefined => factuurById.get(id)
export const getFacturen = (ids: string[]): Factuur[] =>
  ids.map((id) => factuurById.get(id)).filter((f): f is Factuur => f !== undefined)
export const getFacturenVoorDebiteur = (debiteurnummer: string): Factuur[] =>
  facturenByDebiteur.get(debiteurnummer) ?? []
export const getBetalingenVoorDebiteur = (debiteurnummer: string): Betaling[] =>
  betalingenByDebiteur.get(debiteurnummer) ?? []
export const getLosseBetalingenVoorDebiteur = (debiteurnummer: string): LosseBetaling[] =>
  losseBetalingenByDebiteur.get(debiteurnummer) ?? []
