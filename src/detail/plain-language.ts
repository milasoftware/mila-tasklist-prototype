import type { PatternInfo } from '../data'

// Plain-language uitleg voor de priority-score (0-5).
export function priorityHint(p: number): string {
  if (p >= 4) return 'Hoog — pak vandaag op'
  if (p >= 3) return 'Middel — deze week oppakken'
  if (p >= 2) return 'Laag — komende weken'
  return 'Routine — geen haast'
}

// Plain-language voor de trend-uitkomst (drift vs. baseline + momentum/slope
// als context). Toont alleen de technische delta's wanneer "showSources"
// aanstaat.
export function trendPlain(
  trend: {
    score: number | null
    label: string
    confidence: 'hoog' | 'middel' | 'geen'
    drift_dagen: number | null
    baseline_dagen: number | null
    current_dagen: number | null
    momentum_delta_dagen: number | null
    slope_dagen_per_maand: number
    story:
      | 'hersteld na piek'
      | 'herstellend, nog niet op niveau'
      | 'structureel verbeterend'
      | 'structureel verslechterend'
      | 'structureel verhoogd'
      | 'recent kantelpunt'
      | null
    months_observed: number
    explanation: string
  },
  showTech: boolean,
): string {
  if (trend.score == null || trend.drift_dagen === null) {
    return `Te weinig maanden met betaalactiviteit (${trend.months_observed}) om dit te bepalen — minimaal 5 maanden nodig.`
  }
  const base = trend.baseline_dagen ?? 0
  const cur = trend.current_dagen ?? 0
  // Story-label krijgt voorrang — vertelt het nuance-verhaal.
  // Anders een tekst die expliciet "van X naar Y" benoemt, zodat de
  // gebruiker direct ziet waarom de score zo is.
  const storyZin: Record<NonNullable<typeof trend.story>, string> = {
    'hersteld na piek': `Was eerder verslechterd, nu weer rond het oude niveau (~${cur}d).`,
    'herstellend, nog niet op niveau': `Recent aan het verbeteren, maar nog niet terug bij het uitgangspunt (begon op ${base}d, nu rond ${cur}d).`,
    'structureel verbeterend': `Betaalt structureel sneller — van ~${base}d naar ~${cur}d.`,
    'structureel verslechterend': `Betaalt structureel later én verslechtert door — van ~${base}d naar ~${cur}d.`,
    'structureel verhoogd': `Hoger niveau dan een paar maanden geleden — van ~${base}d naar ~${cur}d.`,
    'recent kantelpunt': `Recent omgeslagen — eerder stabiel, nu duidelijk later.`,
  }
  const labelZin: Record<string, string> = {
    stabiel: `Betaalt al ${trend.months_observed} maanden ongeveer hetzelfde (~${cur}d).`,
    verbeterend: `Betaalt sneller dan ${trend.months_observed} maanden geleden — van ~${base}d naar ~${cur}d.`,
    'lichte verslechtering': `Iets later dan eerder — van ~${base}d naar ~${cur}d.`,
    'duidelijke verslechtering': `Duidelijk later dan eerder — van ~${base}d naar ~${cur}d.`,
    'sterke verslechtering': `Veel later dan eerder — van ~${base}d naar ~${cur}d.`,
    'acute verslechtering': `Acute verslechtering — van ~${base}d naar ~${cur}d.`,
  }
  const txt = trend.story ? storyZin[trend.story] : (labelZin[trend.label] ?? trend.explanation)
  if (!showTech) return txt
  const drift = trend.drift_dagen
  const mom = trend.momentum_delta_dagen
  const slope = trend.slope_dagen_per_maand
  return (
    `${txt} (drift ${drift >= 0 ? '+' : ''}${Math.round(drift)}d, ` +
    `momentum ${mom === null ? '—' : (mom >= 0 ? '+' : '') + Math.round(mom) + 'd'}, ` +
    `slope ${slope >= 0 ? '+' : ''}${slope.toFixed(1)}d/mnd)`
  )
}

// Plain-language voor de coefficient of variation uitkomst.
export function volatiliteitPlain(
  vol: {
    label: string
    confidence: 'hoog' | 'middel' | 'geen'
    cv: number
    intervals_observed: number
    explanation: string
  },
  showTech: boolean,
): string {
  if (vol.confidence === 'geen') {
    return `Te weinig betalingen (${vol.intervals_observed} intervallen) in de afgelopen 12 maanden om de regelmaat te bepalen.`
  }
  const base =
    vol.label === 'zeer regelmatig'
      ? `Betaalt heel constant in zijn timing.`
      : vol.label === 'regelmatig'
        ? `Betaalt redelijk constant in zijn timing.`
        : vol.label === 'wisselend'
          ? `Wisselend in timing — niet altijd op hetzelfde moment.`
          : vol.label === 'onregelmatig'
            ? `Onvoorspelbaar — soms lang niets, dan ineens veel.`
            : vol.label === 'zeer grillig'
              ? `Heel grillig — komt soms geclusterd in pieken.`
              : vol.explanation
  return showTech
    ? `${base} (CV=${vol.cv} over ${vol.intervals_observed} betaalintervallen)`
    : base
}

// Korte label voor het standaard-betaaldag patroon. Toont één concrete
// dag (bv. "elke vrijdag" of "rond de 28e") of "geen standaard betaaldag".
export function standaardBetaaldagLabel(p: PatternInfo): string {
  if (p.pattern_type === 'geen' || !p.pattern_value) return 'geen standaard betaaldag'
  return p.pattern_value
}
