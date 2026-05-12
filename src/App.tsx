import { useCallback, useEffect, useState } from 'react'
import {
  tasks,
  meta,
  getDebiteur,
  getFacturen,
  getFacturenVoorDebiteur,
  type Task,
  type Factuur,
} from './data'

// ----- Routing (hash-based, geen library) -----------------------------------

type Route = { name: 'list' } | { name: 'detail'; taskId: string }

function parseHash(): Route {
  const hash = window.location.hash || '#/'
  const m = hash.match(/^#\/taak\/(.+)$/)
  if (m) return { name: 'detail', taskId: decodeURIComponent(m[1]) }
  return { name: 'list' }
}

function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parseHash)
  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const navigate = useCallback((r: Route) => {
    window.location.hash = r.name === 'list' ? '/' : `/taak/${encodeURIComponent(r.taskId)}`
  }, [])
  return [route, navigate]
}

const SNAPSHOT = new Date(meta.snapshot_datum)
const daysOverdue = (vervaldatum: string) =>
  Math.floor((SNAPSHOT.getTime() - new Date(vervaldatum).getTime()) / 86400000)

const WEIGHTS = { impact: 0.4, urgentie: 0.3, risico: 0.2, potentieel: 0.1 }

const fmtEUR = (n: number) =>
  n.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const fmtNL = (n: number, dec = 1) =>
  n.toLocaleString('nl-NL', { minimumFractionDigits: dec, maximumFractionDigits: dec })

function priorityTone(p: number) {
  if (p >= 4) return 'bg-red-50 text-red-900 ring-red-200'
  if (p >= 3) return 'bg-orange-50 text-orange-900 ring-orange-200'
  if (p >= 2) return 'bg-amber-50 text-amber-900 ring-amber-200'
  return 'bg-slate-50 text-slate-700 ring-slate-200'
}

function Bar({ value, max = 5 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100
  return (
    <div className="h-1.5 w-full bg-slate-100 rounded">
      <div className="h-full bg-slate-700 rounded" style={{ width: `${pct}%` }} />
    </div>
  )
}

function ScoreRow({
  label,
  score,
  max = 5,
  source,
  showSource,
}: {
  label: string
  score: number
  max?: number
  source?: string
  showSource?: boolean
}) {
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-700 w-44 shrink-0">{label}</span>
          <div className="flex-1"><Bar value={score} max={max} /></div>
        </div>
        <span className="text-sm tabular-nums text-slate-900 w-12 text-right">
          {fmtNL(score, score % 1 === 0 ? 0 : 1)} / {max}
        </span>
      </div>
      {showSource && source && (
        <p className="text-[11px] text-slate-400 font-mono pl-44 mt-0.5">Bron: {source}</p>
      )}
    </div>
  )
}

function SourceLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-slate-400 font-mono pt-2 mt-2 border-t border-slate-100">
      Bron: {children}
    </p>
  )
}

// Visuele weergave van de 5 bedrag-buckets met markering waar deze
// taak in valt. Toont per segment de bedragrange + aantal taken.
function PercentilesBar({
  activeScore,
  taakBedrag,
  buckets,
}: {
  activeScore: number
  taakBedrag: number
  buckets: { thresholds: number[]; counts: number[]; min: number; max: number }
}) {
  const ranges = [
    `< ${fmtEUR(buckets.thresholds[0])}`,
    `${fmtEUR(buckets.thresholds[0])} – ${fmtEUR(buckets.thresholds[1])}`,
    `${fmtEUR(buckets.thresholds[1])} – ${fmtEUR(buckets.thresholds[2])}`,
    `${fmtEUR(buckets.thresholds[2])} – ${fmtEUR(buckets.thresholds[3])}`,
    `≥ ${fmtEUR(buckets.thresholds[3])}`,
  ]
  return (
    <div className="mt-3 mb-1">
      <p className="text-[11px] text-slate-500 mb-1.5">
        Alle 445 taken in vijf even grote groepen op basis van totaalbedrag — deze taak (
        {fmtEUR(taakBedrag)}) zit in groep {activeScore}.
      </p>
      <div className="grid grid-cols-5 gap-1">
        {[1, 2, 3, 4, 5].map((seg) => {
          const active = seg === activeScore
          return (
            <div
              key={seg}
              className={`p-2 rounded text-[10px] text-center ring-1 ${
                active
                  ? 'bg-slate-900 text-white ring-slate-900'
                  : 'bg-slate-50 text-slate-500 ring-slate-200'
              }`}
            >
              <div className={`font-medium ${active ? 'text-white' : 'text-slate-700'}`}>
                Groep {seg}
              </div>
              <div className="mt-1 tabular-nums leading-tight">{ranges[seg - 1]}</div>
              <div
                className={`mt-1 tabular-nums ${active ? 'text-white/80' : 'text-slate-400'}`}
              >
                {buckets.counts[seg - 1]} taken
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ConfidencePill({ value }: { value: 'hoog' | 'middel' | 'geen' }) {
  const tone =
    value === 'hoog'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : value === 'middel'
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-slate-100 text-slate-500 ring-slate-200'
  const label =
    value === 'hoog' ? 'zeker' : value === 'middel' ? 'redelijk zeker' : 'te weinig data'
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ring-1 ${tone}`}>{label}</span>
}

// Plain-language uitleg voor de priority-score (0-5).
function priorityHint(p: number): string {
  if (p >= 4) return 'Hoog — pak vandaag op'
  if (p >= 3) return 'Middel — deze week oppakken'
  if (p >= 2) return 'Laag — komende weken'
  return 'Routine — geen haast'
}

// Cirkelvormige priority-indicator met hover-tooltip die de opbouw toont.
function PriorityRing({ task }: { task: Task }) {
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

  const calc = {
    impact: task.impact.score * WEIGHTS.impact,
    urgentie: task.urgentie.score * WEIGHTS.urgentie,
    risico: task.risico.score * WEIGHTS.risico,
    potentieel: task.potentieel.score * WEIGHTS.potentieel,
  }

  const rows: { label: string; score: number; pct: number; bijdrage: number }[] = [
    { label: 'Hoeveel levert dit op', score: task.impact.score, pct: 40, bijdrage: calc.impact },
    { label: 'Hoe dringend', score: task.urgentie.score, pct: 30, bijdrage: calc.urgentie },
    { label: 'Hoe risicovol', score: task.risico.score, pct: 20, bijdrage: calc.risico },
    { label: 'Hoeveel sneller mogelijk', score: task.potentieel.score, pct: 10, bijdrage: calc.potentieel },
  ]

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

      {/* Hover tooltip met opbouw van de score */}
      <div
        className="absolute left-1/2 -translate-x-1/2 top-full mt-3 hidden group-hover:block z-20 bg-slate-900 text-white rounded-md p-3 text-xs shadow-xl pointer-events-none"
        style={{ width: 320 }}
      >
        <p className="font-medium mb-2 text-white/90">Opbouw van de priority</p>
        <table className="w-full tabular-nums">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="text-white/80 pr-2 py-0.5">{r.label}</td>
                <td className="text-white/60 text-right whitespace-nowrap px-2">
                  {fmtNL(r.score, r.score % 1 === 0 ? 0 : 1)} × {r.pct}%
                </td>
                <td className="text-right whitespace-nowrap pl-2">{fmtNL(r.bijdrage, 2)}</td>
              </tr>
            ))}
            <tr className="border-t border-white/20">
              <td className="font-medium pt-1.5">Totaal</td>
              <td></td>
              <td className="font-semibold text-right pt-1.5">{fmtNL(score, 2)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-[10px] text-white/60 mt-2">{priorityHint(score)}</p>
      </div>
    </div>
  )
}

// Plain-language voor de Mann-Kendall trend-uitkomst. Toont alleen de
// statistiek (Kendall τ, p-value) wanneer technische details aan staan.
function trendPlain(
  trend: {
    label: string
    confidence: 'hoog' | 'middel' | 'geen'
    tau: number
    p_value: number
    months_observed: number
    explanation: string
  },
  showTech: boolean,
): string {
  if (trend.confidence === 'geen') {
    return trend.months_observed < 6
      ? `Te weinig maanden met betaalactiviteit (${trend.months_observed}) om dit te bepalen.`
      : `Geen duidelijke richting — betaalgedrag fluctueert.`
  }
  const base =
    trend.label === 'sterk verslechterend'
      ? `Betaalt steeds later — duidelijke verslechtering over ${trend.months_observed} maanden.`
      : trend.label === 'verslechterend'
        ? `Lijkt iets later te zijn gaan betalen over ${trend.months_observed} maanden.`
        : trend.label === 'stabiel'
          ? `Betaalt al ${trend.months_observed} maanden ongeveer hetzelfde.`
          : trend.label === 'verbeterend'
            ? `Lijkt iets sneller te betalen dan een paar maanden terug.`
            : trend.label === 'sterk verbeterend'
              ? `Betaalt duidelijk sneller dan ${trend.months_observed} maanden geleden.`
              : trend.explanation
  return showTech ? `${base} (Kendall τ=${trend.tau}, p=${trend.p_value})` : base
}

// Plain-language voor de coefficient of variation uitkomst.
function volatiliteitPlain(
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
    return `Te weinig betalingen (${vol.intervals_observed} intervallen) om de regelmaat te bepalen.`
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

// Plain-language voor de pattern-detectie uitkomst.
function patternPlain(p: {
  pattern_type: 'maandelijks' | 'einde_maand' | 'wekelijks' | 'interval' | 'geen'
  pattern_value: string | null
  fit_pct: number
  payments_observed: number
  confidence: 'hoog' | 'middel' | 'geen'
}): string {
  if (p.pattern_type === 'geen' || !p.pattern_value) {
    return `Geen duidelijk betaalmoment — komt onregelmatig binnen.`
  }
  const where =
    p.pattern_type === 'wekelijks'
      ? `vooral op ${p.pattern_value}`
      : p.pattern_type === 'einde_maand'
        ? `rond einde of begin van de maand`
        : p.pattern_type === 'maandelijks'
          ? p.pattern_value
          : p.pattern_value
  return `Betaalt meestal ${where} — gebeurde zo bij ${p.fit_pct}% van ${p.payments_observed} betalingen.`
}

function TaskRow({ task, selected, onClick }: { task: Task; selected: boolean; onClick: () => void }) {
  const factuurCount = task.gerelateerde_facturen?.length ?? (task.factuurnummer ? 1 : 0)
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${
        selected ? 'bg-slate-50' : ''
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`shrink-0 w-14 h-14 rounded-md ring-1 flex flex-col items-center justify-center ${priorityTone(
            task.priority,
          )}`}
        >
          <span className="text-lg font-semibold tabular-nums leading-none">
            {fmtNL(task.priority, 1)}
          </span>
          <span className="text-[10px] uppercase tracking-wide opacity-70 mt-1">priority</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="font-medium text-slate-900 truncate">{task.debiteur}</h3>
            {factuurCount > 1 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 tabular-nums shrink-0">
                {factuurCount} facturen
              </span>
            )}
          </div>
          <p className="text-sm text-slate-700 mt-0.5 truncate">{task.taakomschrijving}</p>
          <p className="text-xs text-slate-500 mt-1 truncate">{task.aanleiding}</p>
        </div>
      </div>
    </button>
  )
}

function statusTone(status: Factuur['status']) {
  if (status === 'betaald') return 'bg-emerald-50 text-emerald-700'
  if (status === 'open') return 'bg-amber-50 text-amber-800'
  return 'bg-slate-100 text-slate-600'
}

function FactuurTable({
  facturen,
  highlightIds,
  showOnlyOpen,
}: {
  facturen: Factuur[]
  highlightIds?: Set<string>
  showOnlyOpen?: boolean
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
            <th className="py-1.5 pr-2 font-medium">Vervalt</th>
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
                <td className="py-1.5 pr-2 tabular-nums text-slate-500">{f.vervaldatum}</td>
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

function DebtorContext({ task, showSources }: { task: Task; showSources: boolean }) {
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

  return (
    <section className="border border-slate-200 rounded-md p-4">
      <div className="mb-3">
        <h4 className="font-medium text-slate-900">Debiteur-context</h4>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-4">
        {deb?.accountmanager && (
          <>
            <dt className="text-slate-500">Accountmanager</dt>
            <dd className="text-slate-700">{deb.accountmanager}</dd>
          </>
        )}
        <dt className="text-slate-500">Open posten</dt>
        <dd className="text-slate-700 tabular-nums">
          {open.length} · totaal {fmtEUR(openSum)}
        </dd>
        <dt className="text-slate-500">Waarvan vervallen</dt>
        <dd className="text-slate-700 tabular-nums">
          {overdueOpen.length}
          {oudste > 0 ? <> · oudste {oudste}d</> : null}
        </dd>
        <dt className="text-slate-500">Historie</dt>
        <dd className="text-slate-700 tabular-nums">
          {all.length} facturen, {all.filter((f) => f.status === 'betaald').length} betaald
        </dd>
        {task.risico.betaalgedrag_breakdown &&
          task.risico.betaalgedrag_breakdown.dso.invoice_count > 0 && (
            <>
              <dt className="text-slate-500">DSO na vervaldatum</dt>
              <dd className="text-slate-700 tabular-nums">
                {task.risico.betaalgedrag_breakdown.dso.avg_days_late}d gemiddeld
                <span className="text-slate-400">
                  {' '}
                  · over {task.risico.betaalgedrag_breakdown.dso.invoice_count} betaalde facturen
                </span>
              </dd>
            </>
          )}
      </dl>

      {taakFacturen.length > 0 && (
        <>
          <p className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">
            Onderliggende facturen voor deze taak ({taakFacturen.length})
          </p>
          <FactuurTable facturen={taakFacturen} highlightIds={taakIds} />
        </>
      )}

      {open.length > taakFacturen.length && (
        <>
          <p className="text-xs uppercase tracking-wide text-slate-500 mt-4 mb-1.5">
            Alle open posten ({open.length})
          </p>
          <FactuurTable facturen={open} highlightIds={taakIds} />
        </>
      )}

      {showSources && (
        <SourceLine>
          debiteur.* (NAW + accountmanager), factuur (alle posten), betaling (gekoppeld via factuurnummer)
        </SourceLine>
      )}
    </section>
  )
}

function ComponentBlock({
  title,
  subtitle,
  weight,
  score,
  children,
}: {
  title: string
  subtitle?: string
  weight: number
  score: number
  children: React.ReactNode
}) {
  return (
    <section className="border border-slate-200 rounded-md p-4">
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <div>
          <h4 className="font-medium text-slate-900">
            {title}
            <span className="ml-2 text-xs text-slate-500 font-normal">
              telt voor {Math.round(weight * 100)}%
            </span>
          </h4>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="text-right shrink-0">
          <span className="text-2xl font-semibold tabular-nums text-slate-900">
            {fmtNL(score, score % 1 === 0 ? 0 : 1)}
          </span>
          <span className="text-sm text-slate-500"> / 5</span>
        </div>
      </div>
      <div className="mb-3"><Bar value={score} /></div>
      <div className="space-y-2 text-sm text-slate-700">{children}</div>
    </section>
  )
}

function Detail({ task, showSources }: { task: Task; showSources: boolean }) {
  const calc = {
    impact: task.impact.score * WEIGHTS.impact,
    urgentie: task.urgentie.score * WEIGHTS.urgentie,
    risico: task.risico.score * WEIGHTS.risico,
    potentieel: task.potentieel.score * WEIGHTS.potentieel,
  }
  const total = calc.impact + calc.urgentie + calc.risico + calc.potentieel

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start gap-6">
        <header className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold text-slate-900">{task.debiteur}</h2>
          <p className="text-slate-700 mt-1">{task.taakomschrijving}</p>
          <p className="text-sm text-slate-500 mt-2">{task.aanleiding}</p>
        </header>
        <PriorityRing task={task} />
      </div>

      <DebtorContext task={task} showSources={showSources} />

      <ComponentBlock
        title="Hoeveel levert dit op?"
        subtitle="Hoe groot het bedrag is en wat de actie oplevert."
        weight={WEIGHTS.impact}
        score={task.impact.score}
      >
        {task.impact.bedrag !== undefined && (
          <p>
            <span className="text-slate-500">Bedrag dat hiermee binnenkomt: </span>
            {fmtEUR(task.impact.bedrag)}
            {task.impact.bedrag_rank !== undefined && task.impact.bedrag_total_tasks !== undefined && (
              <span className="text-slate-500">
                {' '}
                — staat op rang {task.impact.bedrag_rank} van {task.impact.bedrag_total_tasks} taken
              </span>
            )}
            {showSources && task.impact.pct_van_ar !== undefined && (
              <span className="text-slate-400">
                {' '}
                ({fmtNL(task.impact.pct_van_ar, 1)}% van totaal openstaand)
              </span>
            )}
          </p>
        )}
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
        subtitle="Hoeveel tijd er al voorbij is sinds de afspraak."
        weight={WEIGHTS.urgentie}
        score={task.urgentie.score}
      >
        <p className="text-slate-600">{task.urgentie.reden}</p>
        {showSources && (
          <SourceLine>
            factuur.vervaldatum, dispuut.datum_geopend, krediet_event.datum, taak.deadline
          </SourceLine>
        )}
      </ComponentBlock>

      <ComponentBlock
        title="Hoe risicovol is deze klant?"
        subtitle="Wat we uit de historie weten over hoe deze klant zich gedraagt."
        weight={WEIGHTS.risico}
        score={task.risico.score}
      >
        <ScoreRow
          label="Hoe betaalt deze klant normaal"
          score={task.risico.betaalgedrag}
          source="betaling.betaaldatum vs factuur.vervaldatum (DSO), monthly-DSO-series (trend), betaalintervallen (volatiliteit)"
          showSource={showSources}
        />
        {task.risico.betaalgedrag_breakdown && (
          <div className="ml-2 pl-3 border-l-2 border-slate-200 space-y-2.5 mt-1 mb-1">
            <div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-700">Hoeveel dagen gemiddeld te laat</span>
                <span className="tabular-nums text-slate-700 shrink-0">
                  {task.risico.betaalgedrag_breakdown.dso.score} / 5
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Betaalt gemiddeld {task.risico.betaalgedrag_breakdown.dso.avg_days_late} dagen na de
                vervaldatum, op basis van {task.risico.betaalgedrag_breakdown.dso.invoice_count}{' '}
                facturen.
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-slate-700">Gaat het beter of slechter?</span>
                  <ConfidencePill value={task.risico.betaalgedrag_breakdown.trend.confidence} />
                </div>
                <span className="tabular-nums text-slate-700 shrink-0">
                  {task.risico.betaalgedrag_breakdown.trend.score ?? '—'} / 5
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {trendPlain(task.risico.betaalgedrag_breakdown.trend, showSources)}
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-slate-700">Hoe voorspelbaar betaalt deze klant?</span>
                  <ConfidencePill
                    value={task.risico.betaalgedrag_breakdown.volatiliteit.confidence}
                  />
                </div>
                <span className="tabular-nums text-slate-700 shrink-0">
                  {task.risico.betaalgedrag_breakdown.volatiliteit.score ?? '—'} / 5
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {volatiliteitPlain(task.risico.betaalgedrag_breakdown.volatiliteit, showSources)}
              </p>
            </div>
            <p className="text-[10px] text-slate-400 italic">
              We kunnen nog niet voorspellen óf deze klant gaat wanbetalen — dat komt in een latere
              versie. De score hierboven is gebaseerd op wat we wél meten.
            </p>
          </div>
        )}
        <ScoreRow
          label="Hoe staan we er nu voor"
          score={task.risico.huidige_stand}
          source="factuur.openstaand_bedrag, factuur.vervaldatum (% vervallen, oudste post)"
          showSource={showSources}
        />
        {task.risico.disputen !== null && (
          <ScoreRow
            label="Disputen"
            score={task.risico.disputen}
            source="dispuut (open + opgelost), factuur (aantal/omzet)"
            showSource={showSources}
          />
        )}
        {task.risico.krediet !== null && (
          <ScoreRow
            label="Kredietverzekering"
            score={task.risico.krediet}
            source="krediet_dekking.gedekt_bedrag, krediet_event, externe_score (genormaliseerd)"
            showSource={showSources}
          />
        )}
        {(task.risico.disputen === null || task.risico.krediet === null) && (
          <p className="text-xs text-slate-400 italic pt-1">
            {task.risico.disputen === null && task.risico.krediet === null
              ? 'Disputen en kredietverzekering zitten niet in de aangeleverde data — die punten tellen daarom niet mee in de score.'
              : task.risico.disputen === null
                ? 'Disputen zitten niet in de aangeleverde data.'
                : 'Kredietverzekering zit niet in de aangeleverde data.'}
          </p>
        )}
        <ScoreRow
          label="Hoe belangrijk is deze klant voor ons"
          score={task.risico.omzetconcentratie}
          source="omzet_historie.omzet (aandeel debiteur in totale AR-scope)"
          showSource={showSources}
        />
      </ComponentBlock>

      <ComponentBlock
        title="Hoeveel sneller kan deze klant betalen?"
        subtitle="Het verschil tussen wat is afgesproken en wat we in de praktijk zien."
        weight={WEIGHTS.potentieel}
        score={task.potentieel.score}
      >
        <p className="text-slate-600">
          Deze klant betaalt normaal {task.potentieel.werkelijke_dagen} dagen na de factuurdatum.
          Afgesproken is {task.potentieel.afgesproken_dagen} dagen — dus{' '}
          <span className="font-medium text-slate-800">
            {task.potentieel.werkelijke_dagen - task.potentieel.afgesproken_dagen} dagen langer
          </span>{' '}
          dan de afspraak.
        </p>
        {task.potentieel.pattern && (
          <div className="pt-2 border-t border-slate-100 mt-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-700">Wanneer betaalt deze klant meestal?</span>
                <ConfidencePill value={task.potentieel.pattern.confidence} />
              </div>
              {showSources && (
                <span className="text-slate-400 font-mono text-[10px]">
                  {task.potentieel.pattern.pattern_type}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {patternPlain(task.potentieel.pattern)}
            </p>
          </div>
        )}
        {showSources && (
          <SourceLine>
            standaard_betaaldag pattern recognition (clustering op factuur+betaling),
            debiteur.standaard_betaaltermijn
          </SourceLine>
        )}
      </ComponentBlock>

      <section className="border-t border-slate-200 pt-4">
        <h4 className="font-medium text-slate-900 mb-1">Zo komt deze prioriteit tot stand</h4>
        <p className="text-sm text-slate-600 mb-3">
          Vier scores van 0 tot 5, elk met een eigen gewicht. Optellen geeft de prioriteit.
        </p>
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-sm tabular-nums">
          <span className="text-slate-600">Hoeveel levert dit op</span>
          <span className="text-slate-500">{fmtNL(task.impact.score, 1)}</span>
          <span className="text-slate-400">× 40%</span>
          <span className="text-slate-700 text-right">{fmtNL(calc.impact, 2)}</span>
          <span className="text-slate-600">Hoe dringend</span>
          <span className="text-slate-500">{fmtNL(task.urgentie.score, 0)}</span>
          <span className="text-slate-400">× 30%</span>
          <span className="text-slate-700 text-right">{fmtNL(calc.urgentie, 2)}</span>
          <span className="text-slate-600">Hoe risicovol</span>
          <span className="text-slate-500">{fmtNL(task.risico.score, 1)}</span>
          <span className="text-slate-400">× 20%</span>
          <span className="text-slate-700 text-right">{fmtNL(calc.risico, 2)}</span>
          <span className="text-slate-600">Hoeveel sneller mogelijk</span>
          <span className="text-slate-500">{fmtNL(task.potentieel.score, 0)}</span>
          <span className="text-slate-400">× 10%</span>
          <span className="text-slate-700 text-right">{fmtNL(calc.potentieel, 2)}</span>
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
            ({fmtNL(task.impact.score, 1)} × 0,4) + ({fmtNL(task.urgentie.score, 0)} × 0,3) + (
            {fmtNL(task.risico.score, 1)} × 0,2) + ({fmtNL(task.potentieel.score, 0)} × 0,1) ={' '}
            {fmtNL(total, 2)}
          </p>
        )}
      </section>

      <section className="border-t border-slate-100 pt-4 text-slate-400">
        <h4 className="text-xs uppercase tracking-wide font-medium mb-2">Wat nog niet meedoet</h4>
        <ul className="text-xs space-y-1 leading-relaxed">
          <li>
            <span className="font-medium text-slate-500">Voorspellen of een klant wanbetaalt</span>{' '}
            · komt in een latere fase (vereist een klein achterliggend rekenmodel).
          </li>
          <li>
            <span className="font-medium text-slate-500">Uitgebreidere uitleg per component</span> ·
            nu standaardtekst, later met AI verrijkt.
          </li>
          <li>
            <span className="font-medium text-slate-500">Slimmere inschatting type opbrengst</span>{' '}
            · nu volgens vaste regels op het taaktype.
          </li>
        </ul>
      </section>
    </div>
  )
}

function AppHeader({
  showSources,
  setShowSources,
  rightSlot,
}: {
  showSources: boolean
  setShowSources: (b: boolean) => void
  rightSlot?: React.ReactNode
}) {
  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-baseline justify-between gap-4">
        <div>
          <a href="#/" className="text-lg font-semibold text-slate-900 hover:text-slate-700">
            Mila
          </a>
          <p className="text-sm text-slate-500">
            Geprioriteerde takenlijst · {meta.administratie} · snapshot {meta.snapshot_datum}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showSources}
              onChange={(e) => setShowSources(e.target.checked)}
              className="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
            Toon technische details
          </label>
          {rightSlot}
        </div>
      </div>
    </header>
  )
}

function ListView({
  sorted,
  showSources,
  setShowSources,
  onSelectTask,
}: {
  sorted: Task[]
  showSources: boolean
  setShowSources: (b: boolean) => void
  onSelectTask: (id: string) => void
}) {
  return (
    <>
      <AppHeader
        showSources={showSources}
        setShowSources={setShowSources}
        rightSlot={
          <p className="text-sm text-slate-500 tabular-nums">{sorted.length} taken</p>
        }
      />
      <main className="max-w-5xl mx-auto px-6 py-6">
        <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
          {sorted.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              selected={false}
              onClick={() => onSelectTask(task.id)}
            />
          ))}
        </div>
      </main>
    </>
  )
}

function DetailView({
  task,
  showSources,
  setShowSources,
  onBack,
}: {
  task: Task
  showSources: boolean
  setShowSources: (b: boolean) => void
  onBack: () => void
}) {
  return (
    <>
      <AppHeader showSources={showSources} setShowSources={setShowSources} />
      <main className="max-w-3xl mx-auto px-6 py-6">
        <button
          onClick={onBack}
          className="text-sm text-slate-600 hover:text-slate-900 mb-4 flex items-center gap-1"
        >
          <span aria-hidden>←</span> Terug naar takenlijst
        </button>
        <div className="bg-white rounded-md border border-slate-200">
          <Detail task={task} showSources={showSources} />
        </div>
      </main>
    </>
  )
}

export default function App() {
  const sorted = [...tasks].sort((a, b) => b.priority - a.priority)
  const [showSources, setShowSources] = useState(false)
  const [route, navigate] = useHashRoute()

  // Scroll naar top bij elke route-wissel
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [route])

  const containerClasses = 'min-h-screen bg-slate-100 text-slate-900'

  if (route.name === 'detail') {
    const task = sorted.find((t) => t.id === route.taskId)
    if (!task) {
      // Onbekende taak-id — terug naar lijst
      navigate({ name: 'list' })
      return null
    }
    return (
      <div className={containerClasses}>
        <DetailView
          task={task}
          showSources={showSources}
          setShowSources={setShowSources}
          onBack={() => navigate({ name: 'list' })}
        />
      </div>
    )
  }

  return (
    <div className={containerClasses}>
      <ListView
        sorted={sorted}
        showSources={showSources}
        setShowSources={setShowSources}
        onSelectTask={(id) => navigate({ name: 'detail', taskId: id })}
      />
    </div>
  )
}
