import { Fragment, useEffect } from 'react'
import type React from 'react'
import { getAuditVoorDebiteur, getLosseBetalingenVoorDebiteur, meta, type AuditEntry, type Factuur, type LosseBetaling, type Task } from '../data'
import { AppHeader } from '../list/ListView'
import { daysOverdue, fmtDM, fmtEUR, fmtNL } from './format'
import { ComponentBlock, MetricCard, ScoreRow, SourceLine, StatWithTooltip } from './components'
import { getDebtorData } from './data-derivations'
import { priorityHint, standaardBetaaldagLabel, trendPlain, volatiliteitPlain } from './plain-language'
import { tooltipDso, tooltipHuidigeStand, tooltipImpact, tooltipKrediet, tooltipOmzetconcentratie, tooltipPotentieel, tooltipRisico, tooltipStandaardBetaaldag, tooltipTrend, tooltipUrgentie, tooltipVolatiliteit } from './tooltips'
import { DsoThermometer, HuidigeStandBar, KredietDekkingBar, KredietImpactBar, OmzetPercentilesBar, PercentilesBar, PotentieelImpactBar, TrendSparkline, UrgentieThermometer, VolatilityDotStrip } from './visualizations'

// Cirkelvormige priority-indicator met hover-tooltip die de opbouw toont.
export function PriorityRing({ task }: { task: Task }) {
  const score = task.priority
  const max = 5
  const size = 96
  const stroke = 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const fraction = Math.max(0, Math.min(1, score / max))
  const offset = circumference * (1 - fraction)

  // Stroke-kleur in lijn met priorityTone-schema
  const strokeColorClass =
    score >= 4
      ? 'text-red-500'
      : score >= 3
        ? 'text-orange-500'
        : score >= 2
          ? 'text-amber-400'
          : 'text-slate-400'

  // Wanneer potentieel.score = null (geen betaalhistorie) is de priority
  // genormaliseerd: potentieel valt weg en de overige gewichten zijn naar
  // rato opgehoogd. Die werkelijk gebruikte gewichten staan in
  // `task.priority_weights`. Zo tonen we in de breakdown precies wat er
  // gerekend is — geen verzonnen waarde.
  const w = task.priority_weights
  const potentieelScore = task.potentieel.score
  const genormaliseerd = w.genormaliseerd
  const calc = {
    impact: task.impact.score * w.impact,
    urgentie: task.urgentie.score * w.urgentie,
    risico: task.risico.score * w.risico,
    potentieel: (potentieelScore ?? 0) * w.potentieel,
  }

  const rows: {
    label: string
    score: number | null
    weight: number
    bijdrage: number
    nietMeegewogen?: boolean
  }[] = [
    { label: 'Hoeveel levert dit op', score: task.impact.score, weight: w.impact, bijdrage: calc.impact },
    { label: 'Hoe dringend', score: task.urgentie.score, weight: w.urgentie, bijdrage: calc.urgentie },
    { label: 'Hoe risicovol', score: task.risico.score, weight: w.risico, bijdrage: calc.risico },
    {
      label: 'Hoeveel sneller mogelijk',
      score: potentieelScore,
      weight: w.potentieel,
      bijdrage: calc.potentieel,
      nietMeegewogen: genormaliseerd,
    },
  ]

  const formatPct = (weight: number) => {
    const pct = weight * 100
    return pct % 1 === 0 ? `${pct.toFixed(0)}%` : `${fmtNL(pct, 1)}%`
  }

  return (
    <div className="group relative inline-block">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgb(241 245 249)"
            strokeWidth={stroke}
          />
          <circle
            className={strokeColorClass}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-slate-900 tabular-nums leading-none">
            {fmtNL(score, 2)}
          </span>
          <span className="text-[10px] text-slate-400 mt-0.5">van 5</span>
        </div>
      </div>
      <p className="text-[11px] text-slate-500 uppercase tracking-wide text-center mt-1">
        Priority
      </p>

      {/* Hover tooltip met opbouw van de score (rechts-uitgelijnd zodat
          hij niet overflowt op een full-width container) */}
      <div
        className="absolute right-0 top-full mt-3 hidden group-hover:block z-20 bg-slate-900 text-white rounded-md p-3 text-xs shadow-xl pointer-events-none"
        style={{ width: 340 }}
      >
        {task.priority_gedempt && task.voorspelling ? (
          <>
            <p className="font-medium mb-1 text-sky-300">
              Priority gedempt naar 1,0
            </p>
            <p className="text-[11px] text-white/80 mb-2 leading-snug">
              Betaling verwacht op {fmtDM(task.voorspelling.betaaldatum)} (
              {task.voorspelling.pattern_value}). Demping vervalt zodra het
              venster (-{task.voorspelling.venster_voor_betaaldag_werkdagen}{' '}
              t/m +{task.voorspelling.venster_na_betaaldag_werkdagen} werkdagen)
              verstreken is.
            </p>
            <p className="text-[10px] text-white/50 uppercase tracking-wide mb-1">
              Originele opbouw
            </p>
            <table className="w-full tabular-nums opacity-60 line-through">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td className="text-white/80 pr-2 py-0.5">{r.label}</td>
                    <td className="text-white/60 text-right whitespace-nowrap px-2">
                      {r.nietMeegewogen
                        ? 'niet meegewogen'
                        : r.score === null
                          ? `onbekend × ${formatPct(r.weight)}`
                          : `${fmtNL(r.score, r.score % 1 === 0 ? 0 : 1)} × ${formatPct(r.weight)}`}
                    </td>
                    <td className="text-right whitespace-nowrap pl-2">
                      {r.nietMeegewogen ? '—' : fmtNL(r.bijdrage, 2)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-white/20">
                  <td className="font-medium pt-1.5">Origineel</td>
                  <td></td>
                  <td className="font-semibold text-right pt-1.5">
                    {fmtNL(task.priority_origineel, 2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        ) : (
          <>
            <p className="font-medium mb-2 text-white/90">Opbouw van de priority</p>
            <table className="w-full tabular-nums">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td className="text-white/80 pr-2 py-0.5">{r.label}</td>
                    <td className="text-white/60 text-right whitespace-nowrap px-2">
                      {r.nietMeegewogen
                        ? 'niet meegewogen'
                        : r.score === null
                          ? `onbekend × ${formatPct(r.weight)}`
                          : `${fmtNL(r.score, r.score % 1 === 0 ? 0 : 1)} × ${formatPct(r.weight)}`}
                    </td>
                    <td className="text-right whitespace-nowrap pl-2">
                      {r.nietMeegewogen ? '—' : fmtNL(r.bijdrage, 2)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-white/20">
                  <td className="font-medium pt-1.5">Totaal</td>
                  <td></td>
                  <td className="font-semibold text-right pt-1.5">{fmtNL(score, 2)}</td>
                </tr>
              </tbody>
            </table>
            {genormaliseerd && (
              <p className="text-[10px] text-white/60 mt-2 leading-snug">
                Geen betaalhistorie beschikbaar, dus de overige gewichten zijn
                naar rato opgehoogd (40/30/20 → 44,4/33,3/22,2%).
              </p>
            )}
            <p className="text-[10px] text-white/60 mt-2">{priorityHint(score)}</p>
            {task.voorspelling && (
              <p className="text-[10px] text-white/60 mt-2 border-t border-white/10 pt-2">
                Verwachte betaaldatum: {fmtDM(task.voorspelling.betaaldatum)} (
                {task.voorspelling.pattern_value}) — buiten{' '}
                {task.voorspelling.venster_voor_betaaldag_werkdagen}-werkdagen-venster,
                geen demping.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function statusTone(status: Factuur['status']) {
  if (status === 'betaald') return 'bg-emerald-50 text-emerald-700'
  if (status === 'open') return 'bg-amber-50 text-amber-800'
  return 'bg-slate-100 text-slate-600'
}

export function FactuurTable({
  facturen,
  highlightIds,
  showOnlyOpen,
  showFactuurdatum,
  showBetaaldatum,
}: {
  facturen: Factuur[]
  highlightIds?: Set<string>
  showOnlyOpen?: boolean
  showFactuurdatum?: boolean
  showBetaaldatum?: boolean
}) {
  const list = showOnlyOpen ? facturen.filter((f) => f.status === 'open') : facturen
  // Open posten eerst, daarbinnen oudste vervaldatum eerst, betaalde daarna recent eerst
  const sorted = [...list].sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === 'open') return -1
      if (b.status === 'open') return 1
    }
    return a.status === 'open'
      ? a.vervaldatum.localeCompare(b.vervaldatum)
      : b.factuurdatum.localeCompare(a.factuurdatum)
  })
  if (sorted.length === 0) {
    return <p className="text-sm text-slate-500 italic">Geen facturen om te tonen.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="py-1.5 pr-2 font-medium">Factuur</th>
            {showFactuurdatum && (
              <th className="py-1.5 pr-2 font-medium">Datum</th>
            )}
            <th className="py-1.5 pr-2 font-medium">Vervalt</th>
            {showBetaaldatum && (
              <th className="py-1.5 pr-2 font-medium">Betaald</th>
            )}
            <th className="py-1.5 pr-2 font-medium text-right">Bedrag</th>
            <th className="py-1.5 pr-2 font-medium text-right">Open</th>
            <th className="py-1.5 pr-2 font-medium">Status</th>
            <th className="py-1.5 font-medium text-right">Verv.</th>
          </tr>
        </thead>
        <tbody className="text-slate-700">
          {sorted.map((f) => {
            const overdue = f.status === 'open' ? daysOverdue(f.vervaldatum) : null
            const isHighlight = highlightIds?.has(f.id)
            return (
              <tr
                key={f.id}
                className={`border-b border-slate-50 last:border-0 ${isHighlight ? 'bg-amber-50/50' : ''}`}
              >
                <td className="py-1.5 pr-2 font-mono tabular-nums">{f.id}</td>
                {showFactuurdatum && (
                  <td className="py-1.5 pr-2 tabular-nums text-slate-500">{f.factuurdatum}</td>
                )}
                <td className="py-1.5 pr-2 tabular-nums text-slate-500">{f.vervaldatum}</td>
                {showBetaaldatum && (
                  <td className="py-1.5 pr-2 tabular-nums text-slate-500">
                    {f.betaaldatum ?? <span className="text-slate-300">—</span>}
                  </td>
                )}
                <td className="py-1.5 pr-2 tabular-nums text-right">{fmtEUR(f.bedrag)}</td>
                <td className="py-1.5 pr-2 tabular-nums text-right">
                  {f.openstaand === 0 ? <span className="text-slate-300">—</span> : fmtEUR(f.openstaand)}
                </td>
                <td className="py-1.5 pr-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${statusTone(f.status)}`}>
                    {f.status === 'betaald' ? 'betaald' : f.status === 'open' ? 'open' : 'credit'}
                  </span>
                </td>
                <td className="py-1.5 tabular-nums text-right">
                  {overdue !== null && overdue >= 14 ? (
                    <span className="text-red-700 font-medium">+{overdue}d</span>
                  ) : overdue !== null && overdue > 0 ? (
                    <span className="text-amber-700">+{overdue}d</span>
                  ) : overdue !== null && overdue <= 0 ? (
                    <span className="text-slate-400">{overdue}d</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Audit-log voor één debiteur — toont alle automatische beslissingen die
// het systeem voor deze klant heeft genomen (nu alleen patroon-verschuivingen;
// in productie ook elke verschoven herinnering).
export function AutomatischeBeslissingen({ debiteurnummer }: { debiteurnummer: string }) {
  const entries = getAuditVoorDebiteur(debiteurnummer)
  if (entries.length === 0) return null

  const fmtNlDate = (iso: string) =>
    new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })

  const renderEntry = (e: AuditEntry) => {
    if (e.type === 'patroon_verschoven') {
      return (
        <div key={e.id} className="flex items-start gap-3 py-2 border-t border-slate-100 first:border-t-0">
          <span className="text-[10px] uppercase tracking-wide bg-amber-50 text-amber-700 ring-1 ring-amber-200 rounded px-1.5 py-0.5 mt-0.5">
            Patroon gewijzigd
          </span>
          <div className="flex-1 text-sm">
            <p className="text-slate-800">
              Standaard betaaldag van <span className="font-medium">{e.van_patroon.waarde}</span> naar{' '}
              <span className="font-medium">{e.naar_patroon.waarde}</span>
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Was {e.van_patroon.fit_pct}% ({e.van_patroon.hits}/{e.van_patroon.totaal}) over 9 mnd
              · is nu {e.naar_patroon.fit_pct}% ({e.naar_patroon.hits}/{e.naar_patroon.totaal}) over
              laatste {Math.round(e.venster_nieuw_dagen / 30)} mnd · herinneringsflow gebruikt het
              nieuwe patroon
            </p>
          </div>
          <span className="text-xs text-slate-400 whitespace-nowrap tabular-nums">
            {fmtNlDate(e.detectie_datum)}
          </span>
        </div>
      )
    }
    if (e.type === 'herinnering_verschoven') {
      return (
        <div key={e.id} className="flex items-start gap-3 py-2 border-t border-slate-100 first:border-t-0">
          <span className="text-[10px] uppercase tracking-wide bg-sky-50 text-sky-700 ring-1 ring-sky-200 rounded px-1.5 py-0.5 mt-0.5">
            Herinnering verschoven
          </span>
          <div className="flex-1 text-sm">
            <p className="text-slate-800">
              {fmtNlDate(e.originele_datum)} → {fmtNlDate(e.verschoven_naar)}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Viel op standaard betaaldag ({e.pattern_snapshot.waarde}) — herinnering schuift 1 dag
              op
            </p>
          </div>
          <span className="text-xs text-slate-400 whitespace-nowrap tabular-nums">
            {fmtNlDate(e.beslis_datum)}
          </span>
        </div>
      )
    }
    return null
  }

  return (
    <section className="border border-slate-200 rounded-md p-4">
      <h4 className="font-medium text-slate-900 mb-2">Automatische beslissingen</h4>
      <p className="text-xs text-slate-500 mb-2">
        Wijzigingen die het systeem voor deze klant heeft doorgevoerd op basis van geleerd
        betaalgedrag.
      </p>
      <div>{entries.map(renderEntry)}</div>
    </section>
  )
}

// Compacte horizontale stats-bar — verving de gecombineerde DebtorContext.
// Toont kerngegevens zonder de factuur-tabellen.
export function DebtorStatsBar({ task, showSources }: { task: Task; showSources: boolean }) {
  const data = getDebtorData(task)
  if (!data) return null
  const { deb, all, open, openSum, overdueOpen, oudste } = data
  const dso = task.risico.betaalgedrag_breakdown?.dso

  const stats: { label: string; value: React.ReactNode }[] = []
  if (deb?.accountmanager) {
    stats.push({ label: 'Accountmanager', value: deb.accountmanager })
  }
  if (deb?.betaaltermijn) {
    stats.push({
      label: 'Betaaltermijn',
      value: <span className="tabular-nums">{deb.betaaltermijn} dagen</span>,
    })
  }
  stats.push({
    label: 'Open posten',
    value: (
      <span className="tabular-nums">
        {open.length} · {fmtEUR(openSum)}
      </span>
    ),
  })
  stats.push({
    label: 'Waarvan vervallen',
    value: (
      <span className="tabular-nums">
        {overdueOpen.length}
        {oudste > 0 ? <> · oudste {oudste}d</> : null}
      </span>
    ),
  })
  stats.push({
    label: 'Historie',
    value: (
      <span className="tabular-nums">
        {all.length} facturen, {all.filter((f) => f.status === 'betaald').length} betaald
      </span>
    ),
  })
  const pattern = task.potentieel.pattern
  if (pattern) {
    const isGeen = pattern.pattern_type === 'geen'
    const isShift = !!pattern.verschuiving
    stats.push({
      label: 'Standaard betaaldag',
      value: (
        <StatWithTooltip
          tone={isGeen ? 'muted' : 'normal'}
          value={
            <span>
              {standaardBetaaldagLabel(pattern)}
              {isShift && (
                <span className="text-amber-600 text-xs ml-1" title="Patroon recent gewijzigd">
                  ⚠ wijzigt
                </span>
              )}
            </span>
          }
          tooltip={tooltipStandaardBetaaldag(pattern)}
        />
      ),
    })
  }
  if (dso && dso.invoice_count > 0) {
    stats.push({
      label: 'DSO na vervaldatum',
      value: (
        <span className="tabular-nums">
          {dso.median_days_late}d mediaan
          <span className="text-slate-400"> · over {dso.invoice_count} facturen</span>
        </span>
      ),
    })
  }
  const v = task.voorspelling
  if (v) {
    const inVenster = task.priority_gedempt
    const fmtFull = (iso: string) =>
      new Date(iso).toLocaleDateString('nl-NL', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    const dsoTekst =
      v.median_dso_dagen === 0
        ? 'precies op de vervaldatum'
        : v.median_dso_dagen > 0
          ? `~${v.median_dso_dagen} dagen ná de vervaldatum`
          : `~${Math.abs(v.median_dso_dagen)} dagen vóór de vervaldatum`
    const bronTekst = v.median_dso_bron.endsWith('-fallback')
      ? 'over de laatste 12 maanden'
      : 'over de laatste 3 maanden'
    const baselineAfwijkt =
      v.median_dso_baseline_dagen !== v.median_dso_dagen &&
      !v.median_dso_bron.endsWith('-fallback')
    const baselineTekst =
      v.median_dso_baseline_dagen === 0
        ? 'precies op de vervaldatum'
        : v.median_dso_baseline_dagen > 0
          ? `${v.median_dso_baseline_dagen}d ná de vervaldatum`
          : `${Math.abs(v.median_dso_baseline_dagen)}d vóór de vervaldatum`
    stats.push({
      label: 'Verwachte betaaldatum',
      value: (
        <StatWithTooltip
          value={
            <span className="tabular-nums">
              {fmtDM(v.betaaldatum)}
              {inVenster && (
                <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-sky-50 text-sky-700 ring-1 ring-sky-200 font-medium normal-nums">
                  wacht
                </span>
              )}
            </span>
          }
          tooltip={
            <div className="text-xs leading-relaxed">
              <p className="font-medium text-white/90 mb-1.5">
                Verwachte betaaldatum: {fmtFull(v.betaaldatum)}
              </p>
              <p className="text-white/80 mb-2">
                We schatten in wanneer deze klant betaalt door drie dingen te
                combineren:
              </p>
              <ul className="space-y-0.5 mb-2 text-white/80 list-disc pl-4">
                <li>
                  Oudste vervallen factuur is verlopen op{' '}
                  <span className="tabular-nums">
                    {fmtFull(v.oudste_vervaldatum)}
                  </span>
                  .
                </li>
                <li>
                  Deze klant betaalt {bronTekst} {dsoTekst}, dus rond{' '}
                  <span className="tabular-nums">{fmtFull(v.raw_target)}</span>
                  .
                  {baselineAfwijkt && (
                    <span className="block text-white/50 mt-0.5">
                      (12-mnd-baseline is {baselineTekst} — recent gedrag wijkt
                      af, dus we gebruiken het recente cijfer)
                    </span>
                  )}
                </li>
                <li>
                  En doet dat meestal op {v.pattern_value.toLowerCase()}.
                </li>
              </ul>
              <p className="text-white/90 mb-2">
                Eerstvolgende {v.pattern_value.toLowerCase()} op of na{' '}
                <span className="tabular-nums">{fmtFull(v.raw_target)}</span> ={' '}
                <span className="font-medium tabular-nums">
                  {fmtFull(v.betaaldatum)}
                </span>
                .
              </p>
              {inVenster ? (
                <p className="text-sky-300">
                  We verwachten de betaling binnenkort, dus deze taak staat
                  tijdelijk op lage priority (1,0). Komt de betaling niet
                  binnen, dan springt hij {v.venster_na_betaaldag_werkdagen}{' '}
                  werkdag na de betaaldatum terug naar zijn echte prioriteit.
                </p>
              ) : (
                <p className="text-white/60">
                  Valt buiten ons wacht-venster (-
                  {v.venster_voor_betaaldag_werkdagen} t/m +
                  {v.venster_na_betaaldag_werkdagen} werkdagen rond de
                  betaaldatum) — de priority blijft origineel.
                </p>
              )}
            </div>
          }
        />
      ),
    })
  }

  return (
    <section className="border border-slate-200 rounded-md p-4">
      <h4 className="font-medium text-slate-900 mb-3">Debiteur-context</h4>
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-xs text-slate-500 uppercase tracking-wide">{s.label}</dt>
            <dd className="text-sm text-slate-800 mt-0.5">{s.value}</dd>
          </div>
        ))}
      </dl>
      {showSources && (
        <SourceLine>
          debiteur.* (NAW + accountmanager + betaaltermijn), factuur (alle posten), betaling
          (gekoppeld via factuurnummer)
        </SourceLine>
      )}
    </section>
  )
}

// Eén factuur-tabel als losstaande card, voor side-by-side gebruik.
export function FactuurCard({
  title,
  subtitle,
  facturen,
  highlightIds,
  showFactuurdatum,
  showBetaaldatum,
}: {
  title: string
  subtitle?: React.ReactNode
  facturen: Factuur[]
  highlightIds?: Set<string>
  showFactuurdatum?: boolean
  showBetaaldatum?: boolean
}) {
  return (
    <section className="border border-slate-200 rounded-md p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">
        {title} ({facturen.length})
      </p>
      {subtitle && (
        <p className="text-xs text-slate-500 mb-3 leading-relaxed">{subtitle}</p>
      )}
      <FactuurTable
        facturen={facturen}
        highlightIds={highlightIds}
        showFactuurdatum={showFactuurdatum}
        showBetaaldatum={showBetaaldatum}
      />
    </section>
  )
}

export function LosseBetalingTable({ betalingen }: { betalingen: LosseBetaling[] }) {
  const sorted = [...betalingen].sort((a, b) => b.datum.localeCompare(a.datum))
  if (sorted.length === 0) {
    return <p className="text-sm text-slate-500 italic">Geen betalingen om te tonen.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="py-1.5 pr-2 font-medium">ID</th>
            <th className="py-1.5 pr-2 font-medium">Datum</th>
            <th className="py-1.5 font-medium text-right">Bedrag</th>
          </tr>
        </thead>
        <tbody className="text-slate-700">
          {sorted.map((b) => (
            <tr key={b.id} className="border-b border-slate-50 last:border-0">
              <td className="py-1.5 pr-2 font-mono tabular-nums">{b.id}</td>
              <td className="py-1.5 pr-2 tabular-nums text-slate-500">{b.datum}</td>
              <td
                className={`py-1.5 tabular-nums text-right ${b.bedrag < 0 ? 'text-red-700' : ''}`}
              >
                {fmtEUR(b.bedrag)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LosseBetalingCard({
  title,
  subtitle,
  betalingen,
}: {
  title: string
  subtitle?: React.ReactNode
  betalingen: LosseBetaling[]
}) {
  return (
    <section className="border border-slate-200 rounded-md p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">
        {title} ({betalingen.length})
      </p>
      {subtitle && (
        <p className="text-xs text-slate-500 mb-3 leading-relaxed">{subtitle}</p>
      )}
      <LosseBetalingTable betalingen={betalingen} />
    </section>
  )
}

// Verklaring van de Risicoscore: weegt de wél beschikbare sub-scores
// (betaalgedrag 30, huidige stand 25, krediet 25, omzetconcentratie 10).
// Disputen ontbreekt in de dummy data en valt uit de noemer. Krediet
// doet alleen mee als de debiteur openstaand bedrag heeft (anders null).
export function RisicoBreakdown({ task, showSources }: { task: Task; showSources: boolean }) {
  const r = task.risico
  type Sub = { label: string; score: number; decimals: number; weight: number }
  const subs: Sub[] = [
    { label: 'Hoe is het betaalgedrag', score: r.betaalgedrag, decimals: 2, weight: 30 },
    { label: 'Hoe staan we er nu voor', score: r.huidige_stand, decimals: 2, weight: 25 },
  ]
  if (r.krediet != null) {
    subs.push({ label: 'Hoe is het kredietrisico', score: r.krediet, decimals: 2, weight: 25 })
  }
  subs.push({
    label: 'Hoe belangrijk is deze klant voor ons',
    score: r.omzetconcentratie,
    decimals: 0,
    weight: 10,
  })
  const totaalGewicht = subs.reduce((s, x) => s + x.weight, 0)
  const totaal = subs.reduce((s, x) => s + (x.score * x.weight) / totaalGewicht, 0)
  const pct = (w: number) => `${Math.round((w / totaalGewicht) * 100)}%`
  const gewichtSom = subs.map((x) => x.weight).join(' + ')
  const noemerToelichting = r.krediet != null
    ? `Disputen ontbreekt in de data — de score is genormaliseerd over de vier wél beschikbare categorieën (${gewichtSom} = ${totaalGewicht}).`
    : `Disputen en krediet doen niet mee — score genormaliseerd over de drie beschikbare categorieën (${gewichtSom} = ${totaalGewicht}).`
  return (
    <section className="border border-slate-200 rounded-md p-4 mt-4">
      <h4 className="font-medium text-slate-900 mb-1">Zo komt deze risicoscore tot stand</h4>
      <p className="text-sm text-slate-600 mb-3">
        Sub-scores van 1 tot 5, elk met een eigen gewicht. {noemerToelichting}
      </p>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-sm tabular-nums">
        {subs.map((s) => (
          <Fragment key={s.label}>
            <span className="text-slate-600">{s.label}</span>
            <span className="text-slate-500">{fmtNL(s.score, s.decimals)}</span>
            <span className="text-slate-400">× {pct(s.weight)}</span>
            <span className="text-slate-700 text-right">
              {fmtNL((s.score * s.weight) / totaalGewicht, 2)}
            </span>
          </Fragment>
        ))}
        <span className="text-slate-900 font-medium border-t border-slate-200 pt-1.5 mt-1">
          Totaal
        </span>
        <span className="col-span-2 border-t border-slate-200 pt-1.5 mt-1"></span>
        <span className="text-slate-900 font-semibold text-right border-t border-slate-200 pt-1.5 mt-1">
          {fmtNL(totaal, 2)}
        </span>
      </div>
      {showSources && (
        <p className="font-mono text-xs text-slate-400 mt-3">
          ({subs.map((s) => `${fmtNL(s.score, s.decimals)} × ${s.weight}`).join(' + ')}) /{' '}
          {totaalGewicht} = {fmtNL(totaal, 2)}
        </p>
      )}
    </section>
  )
}

export function Detail({ task, showSources }: { task: Task; showSources: boolean }) {
  // Werkelijk gebruikte gewichten — bij potentieel = null is de berekening
  // genormaliseerd (40/30/20 → 44,4/33,3/22,2%) en valt potentieel weg.
  const w = task.priority_weights
  const genormaliseerd = w.genormaliseerd
  const calc = {
    impact: task.impact.score * w.impact,
    urgentie: task.urgentie.score * w.urgentie,
    risico: task.risico.score * w.risico,
    potentieel: (task.potentieel.score ?? 0) * w.potentieel,
  }
  const total = calc.impact + calc.urgentie + calc.risico + calc.potentieel
  const fmtPct = (weight: number) => {
    const pct = weight * 100
    return pct % 1 === 0 ? `${pct.toFixed(0)}%` : `${fmtNL(pct, 1)}%`
  }

  const data = getDebtorData(task)
  const taakFacturen = data?.taakFacturen ?? []
  const taakIds = data?.taakIds
  const allOpen = data?.open ?? []
  const showAlleOpenPosten = allOpen.length > taakFacturen.length
  const alleFacturenDebiteur = data?.all ?? []
  const alleBetalingenDebiteur = task.debiteurnummer
    ? getLosseBetalingenVoorDebiteur(task.debiteurnummer)
    : []

  return (
    <div className="p-6 space-y-5">
      {/* Top header — debiteurnaam + ring */}
      <div className="flex items-start gap-6 bg-white border border-slate-200 rounded-md p-5">
        <header className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold text-slate-900">
            {task.debiteurnummer && (
              <>
                <span className="tabular-nums">{task.debiteurnummer}</span>
                <span className="text-slate-300 mx-2">|</span>
              </>
            )}
            {task.debiteur}
          </h2>
          <p className="text-slate-700 mt-1">{task.taakomschrijving}</p>
          <p className="text-sm text-slate-500 mt-2">{task.aanleiding}</p>
        </header>
        <PriorityRing task={task} />
      </div>

      {/* Compacte stats-bar */}
      <DebtorStatsBar task={task} showSources={showSources} />

      {/* Audit-log: alleen tonen als er beslissingen geregistreerd zijn */}
      <AutomatischeBeslissingen debiteurnummer={task.debiteurnummer ?? ''} />

      {/* Score-grid: 3 kolommen voor Impact, Urgentie, Potentieel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <ComponentBlock
          title="Hoeveel levert dit op?"
          score={task.impact.score}
          tooltip={tooltipImpact(task.impact.score, task.impact.bedrag)}
          lead={
            task.impact.bedrag !== undefined ? (
              <p>
                <span className="text-slate-500">Bedrag dat hiermee binnenkomt: </span>
                {fmtEUR(task.impact.bedrag)}
                {showSources && task.impact.pct_van_ar !== undefined && (
                  <span className="text-slate-400">
                    {' '}
                    ({fmtNL(task.impact.pct_van_ar, 1)}% van totaal openstaand)
                  </span>
                )}
              </p>
            ) : undefined
          }
        >
          {task.impact.bedrag !== undefined && (
            <PercentilesBar
              activeScore={task.impact.bedrag_score}
              taakBedrag={task.impact.bedrag}
              buckets={meta.bedrag_buckets}
            />
          )}
          {showSources && (
            <>
              <ScoreRow label="Score voor bedrag" score={task.impact.bedrag_score} />
              <p className="text-slate-500 text-xs pt-1">{task.impact.explanation}</p>
              <SourceLine>
                factuur.openstaand_bedrag (deze taak), SUM(factuur.openstaand_bedrag) over open AR
              </SourceLine>
            </>
          )}
        </ComponentBlock>

        <ComponentBlock
          title="Hoe dringend is dit?"
          score={task.urgentie.score}
          tooltip={tooltipUrgentie(task.urgentie.score, task.urgentie.dagen_vervallen)}
        >
          <p className="text-slate-600">{task.urgentie.reden}</p>
          {task.urgentie.dagen_vervallen !== undefined && (
            <UrgentieThermometer
              days={task.urgentie.dagen_vervallen}
              score={task.urgentie.score}
            />
          )}
          {showSources && (
            <SourceLine>
              factuur.vervaldatum, dispuut.datum_geopend, krediet_event.datum, taak.deadline
            </SourceLine>
          )}
        </ComponentBlock>

        <ComponentBlock
          title="Hoeveel sneller kan deze klant betalen?"
          score={task.potentieel.score}
          tooltip={tooltipPotentieel(
            task.potentieel.score,
            task.potentieel.dso_impact_euro_dagen,
            task.potentieel.beinvloedbare_dagen,
            task.risico.krediet_openstaand,
          )}
        >
          {(() => {
            const respijt = task.potentieel.haalbaarheidsdrempel_dagen ?? 7
            const td = task.potentieel.term_diff_dagen ?? 0
            const beinvl = task.potentieel.beinvloedbare_dagen ?? 0
            const impact = task.potentieel.dso_impact_euro_dagen ?? 0
            const totalOpen = task.risico.krediet_openstaand
            const heeftHistorie = task.potentieel.werkelijke_dagen !== null
            if (!heeftHistorie) {
              return (
                <p className="text-slate-600">
                  Deze klant heeft nog geen enkele factuur volledig betaald — daarom kunnen we
                  de werkelijke betaaltermijn niet meten. Afgesproken is{' '}
                  <span className="font-medium text-slate-800">
                    {task.potentieel.afgesproken_dagen} dagen
                  </span>
                  . Zodra de eerste betaling binnen is, wordt het potentieel berekend.
                </p>
              )
            }
            return (
              <p className="text-slate-600">
                Deze klant betaalt normaal {task.potentieel.werkelijke_dagen} dagen na de
                factuurdatum, afgesproken is {task.potentieel.afgesproken_dagen} dagen
                {td > 0 ? (
                  <>
                    {' '}— dus{' '}
                    <span className="font-medium text-slate-800">{td} dagen langer</span> dan de
                    afspraak.
                  </>
                ) : (
                  <> — dat past binnen de afspraak.</>
                )}{' '}
                {beinvl > 0 && totalOpen !== undefined ? (
                  <>
                    Boven de {respijt}d marge: <span className="font-medium">{beinvl}d</span>{' '}
                    beïnvloedbaar × {fmtEUR(totalOpen)} openstaand ={' '}
                    <span className="font-medium text-slate-800">
                      {Math.round(impact).toLocaleString('nl-NL')} euro-dagen
                    </span>{' '}
                    DSO-winst.
                  </>
                ) : (
                  <>
                    Binnen de {respijt}d marge — bellen levert structureel geen DSO-winst op
                    (gedrag is mogelijk procesgebonden).
                  </>
                )}
              </p>
            )
          })()}
          {task.potentieel.score !== null && (
            <PotentieelImpactBar
              activeScore={task.potentieel.score}
              dsoImpact={task.potentieel.dso_impact_euro_dagen ?? 0}
            />
          )}
          {showSources && (
            <SourceLine>
              fysieke_betalingen → pattern recognition (zie debiteur-context bovenaan voor
              standaard betaaldag), debiteur.standaard_betaaltermijn
            </SourceLine>
          )}
        </ComponentBlock>
      </div>

      {/* Risico full-width — uniforme kaart-grid met 5 metric-cards op gelijk niveau */}
      <ComponentBlock
        title="Hoe risicovol is deze klant?"
        score={task.risico.score}
        tooltip={tooltipRisico(task)}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {task.risico.betaalgedrag_breakdown && (
            <>
              <MetricCard
                title="Hoeveel dagen meestal te laat"
                score={task.risico.betaalgedrag_breakdown.dso.score}
                tooltip={tooltipDso(
                  task.risico.betaalgedrag_breakdown.dso.score,
                  task.risico.betaalgedrag_breakdown.dso.median_days_late,
                  task.risico.betaalgedrag_breakdown.dso.invoice_count,
                  task.risico.betaalgedrag_breakdown.dso.from_overdue,
                  task.risico.betaalgedrag_breakdown.dso.oudste_dagen_vervallen,
                )}
                caption={
                  task.risico.betaalgedrag_breakdown.dso.from_overdue
                    ? `Geen betaalhistorie in de afgelopen 12 maanden — score op basis van oudste vervallen post (${task.risico.betaalgedrag_breakdown.dso.oudste_dagen_vervallen ?? 0} dagen).`
                    : `Mediaan: ${task.risico.betaalgedrag_breakdown.dso.median_days_late} dagen na de vervaldatum, op basis van ${task.risico.betaalgedrag_breakdown.dso.invoice_count} facturen betaald in de afgelopen 12 maanden.`
                }
                viz={
                  <DsoThermometer
                    days={
                      task.risico.betaalgedrag_breakdown.dso.from_overdue
                        ? task.risico.betaalgedrag_breakdown.dso.oudste_dagen_vervallen ?? 0
                        : task.risico.betaalgedrag_breakdown.dso.median_days_late
                    }
                    score={task.risico.betaalgedrag_breakdown.dso.score}
                  />
                }
              />
              <MetricCard
                title="Gaat het beter of slechter?"
                score={task.risico.betaalgedrag_breakdown.trend.score}
                confidence={task.risico.betaalgedrag_breakdown.trend.confidence}
                tooltip={tooltipTrend(
                  task.risico.betaalgedrag_breakdown.trend.score,
                  task.risico.betaalgedrag_breakdown.trend.drift_dagen,
                  task.risico.betaalgedrag_breakdown.trend.baseline_dagen,
                  task.risico.betaalgedrag_breakdown.trend.current_dagen,
                  task.risico.betaalgedrag_breakdown.trend.momentum_delta_dagen,
                  task.risico.betaalgedrag_breakdown.trend.slope_dagen_per_maand,
                  task.risico.betaalgedrag_breakdown.trend.story,
                  task.risico.betaalgedrag_breakdown.trend.months_observed,
                )}
                caption={trendPlain(task.risico.betaalgedrag_breakdown.trend, showSources)}
                viz={
                  <TrendSparkline
                    series={task.risico.betaalgedrag_breakdown.trend.series}
                    confidence={task.risico.betaalgedrag_breakdown.trend.confidence}
                  />
                }
              />
              <MetricCard
                title="Hoe voorspelbaar betaalt deze klant?"
                score={task.risico.betaalgedrag_breakdown.volatiliteit.score}
                confidence={task.risico.betaalgedrag_breakdown.volatiliteit.confidence}
                tooltip={tooltipVolatiliteit(
                  task.risico.betaalgedrag_breakdown.volatiliteit.score,
                  task.risico.betaalgedrag_breakdown.volatiliteit.cv,
                  task.risico.betaalgedrag_breakdown.volatiliteit.intervals_observed,
                  task.risico.betaalgedrag_breakdown.volatiliteit.confidence,
                )}
                caption={volatiliteitPlain(
                  task.risico.betaalgedrag_breakdown.volatiliteit,
                  showSources,
                )}
                viz={
                  task.debiteurnummer ? (
                    <VolatilityDotStrip debiteurnummer={task.debiteurnummer} />
                  ) : undefined
                }
              />
            </>
          )}
          <MetricCard
            title="Hoe staan we er nu voor"
            score={task.risico.huidige_stand}
            tooltip={tooltipHuidigeStand(
              task.risico.huidige_stand,
              task.risico.huidige_stand_pct_vervallen,
              task.risico.huidige_stand_oudste_dagen,
              task.risico.huidige_stand_pct_score,
              task.risico.huidige_stand_oudste_score,
            )}
            caption={
              task.risico.huidige_stand_pct_vervallen !== undefined
                ? `${Math.round(task.risico.huidige_stand_pct_vervallen)}% van het openstaande bedrag is vervallen${
                    task.risico.huidige_stand_oudste_dagen
                      ? ` — oudste post ${task.risico.huidige_stand_oudste_dagen} dagen.`
                      : '.'
                  }`
                : undefined
            }
            viz={
              task.risico.huidige_stand_pct_vervallen !== undefined ? (
                <HuidigeStandBar
                  pctVervallen={task.risico.huidige_stand_pct_vervallen}
                  oudsteDagen={task.risico.huidige_stand_oudste_dagen ?? 0}
                />
              ) : undefined
            }
          />
          {task.risico.krediet != null && (
            <MetricCard
              title="Hoe is het kredietrisico"
              score={task.risico.krediet}
              tooltip={tooltipKrediet(
                task.risico.krediet,
                task.risico.krediet_onverzekerd_pct,
                task.risico.krediet_onverzekerd_bedrag,
                task.risico.krediet_pct_score,
                task.risico.krediet_impact_score,
              )}
              caption={
                task.risico.krediet_openstaand !== undefined &&
                task.risico.krediet_limiet !== undefined
                  ? (() => {
                      const limiet = task.risico.krediet_limiet
                      const open = task.risico.krediet_openstaand
                      const onverzekerdBedrag = task.risico.krediet_onverzekerd_bedrag ?? 0
                      const onverzekerdPct = task.risico.krediet_onverzekerd_pct ?? 0
                      let detail
                      if (open <= 0) {
                        detail = 'Geen openstaand bedrag — op dit moment geen kredietrisico.'
                      } else if (limiet > 0) {
                        detail = `Openstaand ${fmtEUR(open)} — ${Math.round((open / limiet) * 100)}% van limiet benut. Onverzekerd: ${fmtEUR(onverzekerdBedrag)} (${Math.round(onverzekerdPct)}%).`
                      } else {
                        detail = `${fmtEUR(open)} openstaand telt volledig als onverzekerd (${Math.round(onverzekerdPct)}%).`
                      }
                      return (
                        <>
                          <span className="font-medium text-slate-700">
                            Kredietlimiet: {fmtEUR(limiet)}
                          </span>
                          <br />
                          <span>{detail}</span>
                        </>
                      )
                    })()
                  : undefined
              }
              viz={
                task.risico.krediet_onverzekerd_pct !== undefined &&
                task.risico.krediet_onverzekerd_bedrag !== undefined &&
                task.risico.krediet_impact_score != null &&
                meta.krediet_buckets ? (
                  <div className="space-y-2">
                    <KredietDekkingBar onverzekerdPct={task.risico.krediet_onverzekerd_pct} />
                    <KredietImpactBar
                      activeScore={task.risico.krediet_impact_score}
                      onverzekerdBedrag={task.risico.krediet_onverzekerd_bedrag}
                      buckets={meta.krediet_buckets}
                    />
                  </div>
                ) : undefined
              }
            />
          )}
          <MetricCard
            title="Hoe belangrijk is deze klant voor ons"
            score={task.risico.omzetconcentratie}
            tooltip={tooltipOmzetconcentratie(
              task.risico.omzetconcentratie,
              task.risico.omzetconcentratie_pct,
              task.risico.omzetconcentratie_omzet,
            )}
            caption={
              task.risico.omzetconcentratie_pct !== undefined
                ? `Omzet van deze klant: ${
                    task.risico.omzetconcentratie_omzet !== undefined
                      ? `${fmtEUR(task.risico.omzetconcentratie_omzet)} netto`
                      : '—'
                  }. Goed voor ${task.risico.omzetconcentratie_pct.toFixed(2)}% van onze netto jaaromzet (${fmtEUR(meta.jaaromzet_totaal)} netto).`
                : undefined
            }
            viz={
              task.risico.omzetconcentratie_omzet !== undefined && meta.omzet_buckets ? (
                <OmzetPercentilesBar
                  activeScore={task.risico.omzetconcentratie}
                  debiteurOmzet={task.risico.omzetconcentratie_omzet}
                  buckets={meta.omzet_buckets}
                />
              ) : undefined
            }
          />
          {task.risico.disputen !== null && (
            <MetricCard
              title="Disputen"
              score={task.risico.disputen}
            />
          )}
        </div>
        {task.risico.disputen === null && (
          <div className="border border-dashed border-slate-200 rounded-md p-4 text-xs text-slate-400 italic leading-relaxed">
            <p className="font-medium text-slate-500 not-italic mb-1">Niet beschikbaar in data</p>
            Disputen zitten niet in de aangeleverde dummy data. Die categorie telt daarom niet
            mee — de risico-score is genormaliseerd over de wél beschikbare sub-metrics.
          </div>
        )}
        <RisicoBreakdown task={task} showSources={showSources} />
      </ComponentBlock>

      {/* Factuur-tabellen 2-koloms */}
      {(taakFacturen.length > 0 || showAlleOpenPosten) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {taakFacturen.length > 0 && (
            <FactuurCard
              title="Onderliggende facturen voor deze taak"
              subtitle="Openstaande facturen van dezelfde klant die 14 dagen of meer vervallen zijn worden gegroepeerd in één taak."
              facturen={taakFacturen}
              highlightIds={taakIds}
            />
          )}
          {showAlleOpenPosten && (
            <FactuurCard title="Alle open posten" facturen={allOpen} highlightIds={taakIds} />
          )}
        </div>
      )}

      {/* Onderste rij: Berekening + Wat nog niet meedoet, 2-koloms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="border border-slate-200 rounded-md p-4">
          <h4 className="font-medium text-slate-900 mb-1">Zo komt deze prioriteit tot stand</h4>
          <p className="text-sm text-slate-600 mb-3">
            {genormaliseerd
              ? 'Geen betaalhistorie voor deze klant — "Hoeveel sneller mogelijk" valt weg en de overige gewichten zijn naar rato opgehoogd.'
              : 'Vier scores van 0 tot 5, elk met een eigen gewicht. Optellen geeft de prioriteit.'}
          </p>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-sm tabular-nums">
            <span className="text-slate-600">Hoeveel levert dit op</span>
            <span className="text-slate-500">{fmtNL(task.impact.score, 1)}</span>
            <span className="text-slate-400">× {fmtPct(w.impact)}</span>
            <span className="text-slate-700 text-right">{fmtNL(calc.impact, 2)}</span>
            <span className="text-slate-600">Hoe dringend</span>
            <span className="text-slate-500">{fmtNL(task.urgentie.score, 0)}</span>
            <span className="text-slate-400">× {fmtPct(w.urgentie)}</span>
            <span className="text-slate-700 text-right">{fmtNL(calc.urgentie, 2)}</span>
            <span className="text-slate-600">Hoe risicovol</span>
            <span className="text-slate-500">{fmtNL(task.risico.score, 1)}</span>
            <span className="text-slate-400">× {fmtPct(w.risico)}</span>
            <span className="text-slate-700 text-right">{fmtNL(calc.risico, 2)}</span>
            <span className={genormaliseerd ? 'text-slate-400 italic' : 'text-slate-600'}>
              Hoeveel sneller mogelijk
            </span>
            <span className={genormaliseerd ? 'text-slate-400 italic' : 'text-slate-500'}>
              {genormaliseerd
                ? 'onbekend'
                : fmtNL(task.potentieel.score ?? 0, 0)}
            </span>
            <span className={genormaliseerd ? 'text-slate-400 italic' : 'text-slate-400'}>
              {genormaliseerd ? 'niet meegewogen' : `× ${fmtPct(w.potentieel)}`}
            </span>
            <span className={genormaliseerd ? 'text-slate-400 italic text-right' : 'text-slate-700 text-right'}>
              {genormaliseerd ? '—' : fmtNL(calc.potentieel, 2)}
            </span>
            <span className="text-slate-900 font-medium border-t border-slate-200 pt-1.5 mt-1">
              Totaal
            </span>
            <span className="col-span-2 border-t border-slate-200 pt-1.5 mt-1"></span>
            <span className="text-slate-900 font-semibold text-right border-t border-slate-200 pt-1.5 mt-1">
              {fmtNL(total, 2)}
            </span>
          </div>
          {showSources && (
            <p className="font-mono text-xs text-slate-400 mt-3">
              ({fmtNL(task.impact.score, 1)} × {fmtNL(w.impact, 4)}) + (
              {fmtNL(task.urgentie.score, 0)} × {fmtNL(w.urgentie, 4)}) + (
              {fmtNL(task.risico.score, 1)} × {fmtNL(w.risico, 4)})
              {genormaliseerd
                ? ''
                : ` + (${fmtNL(task.potentieel.score ?? 0, 0)} × ${fmtNL(w.potentieel, 4)})`}{' '}
              = {fmtNL(total, 2)}
            </p>
          )}
        </section>

        <section className="border border-slate-200 rounded-md p-4 text-slate-400">
          <h4 className="text-xs uppercase tracking-wide font-medium text-slate-500 mb-2">
            Wat nog niet meedoet
          </h4>
          <ul className="text-xs space-y-1 leading-relaxed">
            <li>
              <span className="font-medium text-slate-500">
                Voorspellen of een klant wanbetaalt
              </span>{' '}
              · komt in een latere fase (vereist een klein achterliggend rekenmodel).
            </li>
            <li>
              <span className="font-medium text-slate-500">
                Uitgebreidere uitleg per component
              </span>{' '}
              · nu standaardtekst, later met AI verrijkt.
            </li>
            <li>
              <span className="font-medium text-slate-500">
                Slimmere inschatting type opbrengst
              </span>{' '}
              · nu volgens vaste regels op het taaktype.
            </li>
          </ul>
        </section>
      </div>

      {/* Volledige debiteur-historie: alle facturen + alle betalingen */}
      {(alleFacturenDebiteur.length > 0 || alleBetalingenDebiteur.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <FactuurCard
            title="Alle facturen van deze debiteur"
            subtitle="Volledige factuurhistorie (open en betaald). Betaaldatum is de laatste betaling — bij deelbetalingen het moment dat alles binnen was."
            facturen={alleFacturenDebiteur}
            highlightIds={taakIds}
            showFactuurdatum
            showBetaaldatum
          />
          <LosseBetalingCard
            title="Alle betalingen van deze debiteur"
            subtitle="Losse betaalboekingen (documenttype Betaling, Terugbetaling of leeg). Negatieve bedragen zijn terugbetalingen."
            betalingen={alleBetalingenDebiteur}
          />
        </div>
      )}
    </div>
  )
}

export function DetailView({
  task,
  showSources,
  setShowSources,
  onBack,
  index,
  total,
  onPrev,
  onNext,
}: {
  task: Task
  showSources: boolean
  setShowSources: (b: boolean) => void
  onBack: () => void
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
}) {
  const hasPrev = index > 0
  const hasNext = index < total - 1

  // Keyboard-shortcuts ← / → om door taken te bladeren. Negeer wanneer
  // de gebruiker in een input/textarea/contentEditable bezig is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft' && hasPrev) {
        e.preventDefault()
        onPrev()
      } else if (e.key === 'ArrowRight' && hasNext) {
        e.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasPrev, hasNext, onPrev, onNext])

  const navBtn =
    'inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-slate-700 transition-colors'

  return (
    <>
      <AppHeader showSources={showSources} setShowSources={setShowSources} />
      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <button
            onClick={onBack}
            className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1"
          >
            <span aria-hidden>←</span> Terug naar takenlijst
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              disabled={!hasPrev}
              className={navBtn}
              aria-label="Vorige taak"
              title="Vorige taak (←)"
            >
              <span aria-hidden>←</span>
              <span className="hidden sm:inline">Vorige</span>
            </button>
            <span className="text-sm text-slate-500 tabular-nums px-1">
              Taak {index + 1} van {total}
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={!hasNext}
              className={navBtn}
              aria-label="Volgende taak"
              title="Volgende taak (→)"
            >
              <span className="hidden sm:inline">Volgende</span>
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>
        <div className="bg-white rounded-md border border-slate-200">
          <Detail task={task} showSources={showSources} />
        </div>
      </main>
    </>
  )
}
