// Data laag — leest uit data.generated.json (gegenereerd door
// scripts/preprocess.mjs uit de Covebo-export).
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
    explanation: string
  }
  urgentie: {
    score: number
    reden: string
  }
  risico: {
    score: number
    betaalgedrag: number
    huidige_stand: number
    disputen: number | null
    krediet: number | null
    omzetconcentratie: number
  }
  potentieel: {
    score: number
    werkelijke_dagen: number
    afgesproken_dagen: number
    reden: string
  }
}

// Relationele entiteiten (nog niet gebruikt door UI — voor pad B)
export type Debiteur = {
  id: string
  naam: string
  plaats?: string
  accountmanager?: string
  klanttype?: string
}

export type Factuur = {
  id: string
  debiteurnummer: string
  factuurdatum: string
  vervaldatum: string
  bedrag: number
  openstaand: number
  status: 'open' | 'betaald' | 'credit_nota'
}

export type Betaling = {
  id: string
  factuurnummer: string
  debiteurnummer: string
  datum: string
  bedrag: number
}

export type Meta = {
  snapshot_datum: string
  bron: string
  administratie: string
  total_open_ar: number
  total_facturen: number
  total_open_facturen: number
  total_taken_gegenereerd: number
  top_n: number
  debiteuren_in_top_n: number
  facturen_in_top_n_set: number
  betalingen_in_top_n_set: number
  uitgesloten_categorieen: string[]
  uitsluitings_reden: string
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

export const getDebiteur = (id: string): Debiteur | undefined => debiteurById.get(id)
export const getFactuur = (id: string): Factuur | undefined => factuurById.get(id)
export const getFacturen = (ids: string[]): Factuur[] =>
  ids.map((id) => factuurById.get(id)).filter((f): f is Factuur => f !== undefined)
export const getFacturenVoorDebiteur = (debiteurnummer: string): Factuur[] =>
  facturenByDebiteur.get(debiteurnummer) ?? []
