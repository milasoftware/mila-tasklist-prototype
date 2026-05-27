import { Fragment, useCallback, useEffect, useState } from 'react'
import {
  tasks,
  meta,
  betalingen,
  getDebiteur,
  getFacturen,
  getFacturenVoorDebiteur,
  getLosseBetalingenVoorDebiteur,
  getAuditVoorDebiteur,
  type Task,
  type Factuur,
  type LosseBetaling,
  type Confidence,
  type PatternInfo,
  type AuditEntry,
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

const fmtEUR = (n: number) =>
  n.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const fmtNL = (n: number, dec = 1) =>
  n.toLocaleString('nl-NL', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const fmtDM = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

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
        Alle {meta.total_taken_gegenereerd} taken in vijf even grote groepen op basis van
        totaalbedrag — deze taak ({fmtEUR(taakBedrag)}) zit in groep {activeScore}.
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

// ----- visualisaties voor de Betaalgedrag-sub-rijen ------------------------

// Thermometer voor "gemiddelde dagen te laat". Marker positioneert
// op een 0–60d schaal; kleur volgt de score-tone.
function DsoThermometer({ days, score }: { days: number; score: number }) {
  const max = 60
  const pct = Math.max(0, Math.min(100, (days / max) * 100))
  const tone =
    score >= 4
      ? 'bg-red-500'
      : score >= 3
        ? 'bg-orange-500'
        : score >= 2
          ? 'bg-amber-400'
          : 'bg-emerald-500'
  return (
    <div className="mt-1.5">
      <div className="relative h-1.5 bg-slate-100 rounded-full">
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-[1.5px] border-white shadow ${tone}`}
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
        <span>0d (op tijd)</span>
        <span>60d+ (zeer laat)</span>
      </div>
    </div>
  )
}

// Sparkline voor maandelijkse DSO-reeks. Kleur volgt richting + confidence:
// rood = stijgend (verslechterend), groen = dalend (verbeterend),
// grijs = geen confidence.
function TrendSparkline({
  series,
  confidence,
}: {
  series: { month: string; dso: number }[]
  confidence: Confidence
}) {
  if (series.length < 2) return null
  const width = 220
  const height = 36
  const padX = 3
  const padY = 4
  const values = series.map((s) => s.dso)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const range = maxV - minV || 1
  const points = series.map((s, i) => {
    const x = padX + (i / (series.length - 1)) * (width - padX * 2)
    const y = height - padY - ((s.dso - minV) / range) * (height - padY * 2)
    return { x, y }
  })
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')
  const first = series[0].dso
  const last = series[series.length - 1].dso
  const isUp = last > first
  const colorClass =
    confidence === 'geen'
      ? 'text-slate-400'
      : isUp
        ? 'text-red-500'
        : 'text-emerald-500'
  const arrow = confidence === 'geen' ? '·' : isUp ? '↗' : '↘'

  const [hover, setHover] = useState<number | null>(null)
  const months = [
    'jan',
    'feb',
    'mrt',
    'apr',
    'mei',
    'jun',
    'jul',
    'aug',
    'sep',
    'okt',
    'nov',
    'dec',
  ]
  const formatMonth = (m: string) => {
    const [yr, mo] = m.split('-')
    const idx = parseInt(mo, 10) - 1
    return `${months[idx] ?? mo} ${yr}`
  }
  const formatDso = (n: number) => {
    if (n > 0) return `${n} dagen na vervaldatum`
    if (n < 0) return `${Math.abs(n)} dagen vóór vervaldatum`
    return 'op vervaldatum'
  }
  const active = hover != null ? points[hover] : null
  const activeSerie = hover != null ? series[hover] : null
  // Tooltip positioneren: links/rechts van punt afhankelijk van locatie
  const tipLeft = active ? (active.x / width) * 100 : 0
  const flipLeft = tipLeft > 65
  return (
    <div className="mt-1.5 relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={`w-full ${colorClass}`}
        style={{ height: `${height}px` }}
        onMouseLeave={() => setHover(null)}
      >
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hover === i ? 3 : 1.5}
              fill="currentColor"
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={8}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              style={{ cursor: 'pointer' }}
            >
              <title>{`${formatMonth(series[i].month)} — ${formatDso(series[i].dso)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      {active && activeSerie && (
        <div
          className="pointer-events-none absolute z-10 -translate-y-full -translate-x-1/2 mb-1 px-2 py-1 rounded bg-slate-900 text-white text-[10px] whitespace-nowrap shadow-lg"
          style={{
            left: `${flipLeft ? tipLeft - 8 : tipLeft + 4}%`,
            top: `${(active.y / height) * 100}%`,
            transform: `translate(${flipLeft ? '-100%' : '0'}, -100%)`,
          }}
        >
          <div className="font-medium">{formatMonth(activeSerie.month)}</div>
          <div className="text-white/80">{formatDso(activeSerie.dso)}</div>
        </div>
      )}
      <p className="text-[10px] text-slate-400">
        {series.length} maanden · van {first}d naar {last}d{' '}
        <span className={colorClass}>{arrow}</span>
      </p>
    </div>
  )
}

// Dot-strip voor "hoe voorspelbaar". Plot unieke betaaldata van de
// afgelopen 12 maanden als verticale streepjes op een tijdlijn.
// Gelijkmatige spreiding = regelmatig, clusters/gaten = grillig.
function VolatilityDotStrip({ debiteurnummer }: { debiteurnummer: string }) {
  const snapshotMs = new Date(meta.snapshot_datum).getTime()
  const yearAgoMs = snapshotMs - 365 * 86400000
  const uniqDates = [
    ...new Set(
      betalingen
        .filter((b) => b.debiteurnummer === debiteurnummer)
        .map((b) => b.datum),
    ),
  ]
    .filter((d) => {
      const ms = new Date(d).getTime()
      return ms >= yearAgoMs && ms <= snapshotMs
    })
    .sort()

  if (uniqDates.length < 2) return null

  const range = snapshotMs - yearAgoMs
  return (
    <div className="mt-1.5">
      <div className="relative h-4 bg-slate-50 rounded ring-1 ring-slate-100">
        {uniqDates.map((d, i) => {
          const pct = ((new Date(d).getTime() - yearAgoMs) / range) * 100
          return (
            <span
              key={`${d}-${i}`}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-2.5 bg-slate-500 rounded-full"
              style={{ left: `${pct}%` }}
            />
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
        <span>12 mnd geleden</span>
        <span>{uniqDates.length} unieke betaalmomenten</span>
        <span>nu</span>
      </div>
    </div>
  )
}

// Urgentie-thermometer: marker op de schaal 0d (vandaag) → 60d+ (escalatie).
// Kleur volgt de urgentie-score-zones, in lijn met de drempels uit preprocess.
function UrgentieThermometer({ days, score }: { days: number; score: number }) {
  const max = 60
  const pct = Math.max(0, Math.min(100, (days / max) * 100))
  const tone =
    score >= 5
      ? 'bg-red-500'
      : score >= 4
        ? 'bg-orange-500'
        : score >= 3
          ? 'bg-amber-400'
          : score >= 2
            ? 'bg-amber-300'
            : 'bg-slate-300'
  return (
    <div className="mt-1.5">
      <div className="relative h-1.5 bg-slate-100 rounded-full">
        {/* Drempel-tickjes voor de 4 grenzen (14d, 30d, 60d). 0d en 60+ zijn de uiteindes. */}
        {[14, 30].map((d) => (
          <span
            key={d}
            className="absolute top-1/2 -translate-y-1/2 w-px h-2 bg-slate-300"
            style={{ left: `${(d / max) * 100}%` }}
          />
        ))}
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-[1.5px] border-white shadow ${tone}`}
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
        <span>0d (vandaag)</span>
        <span>60d+ (escalatie)</span>
      </div>
    </div>
  )
}

// Kwartielen-balk voor "Hoeveel sneller kan deze klant betalen". Werkt
// hetzelfde als PercentilesBar voor impact, maar dan met 5 buckets waarbij
// score 1 = "binnen marge, geen DSO-winst" (impact 0) en 2-5 kwartielen
// op euro-dagen.
function PotentieelImpactBar({
  activeScore,
  dsoImpact,
}: {
  activeScore: number
  dsoImpact: number
}) {
  const pb = meta.potentieel_buckets
  if (!pb) return null
  const respijt = pb.haalbaarheidsdrempel_dagen
  const fmtED = (n: number) => Math.round(n).toLocaleString('nl-NL')
  const ranges = [
    `binnen ${respijt}d marge`,
    `< ${fmtED(pb.thresholds[1])}`,
    `${fmtED(pb.thresholds[1])} – ${fmtED(pb.thresholds[2])}`,
    `${fmtED(pb.thresholds[2])} – ${fmtED(pb.thresholds[3])}`,
    `≥ ${fmtED(pb.thresholds[3])}`,
  ]
  return (
    <div className="mt-3 mb-1">
      <p className="text-[11px] text-slate-500 mb-1.5">
        Alle {pb.populatie_debiteuren} debiteuren met vervallen saldo verdeeld in vijf groepen
        op basis van DSO-winst (euro-dagen) — deze klant levert{' '}
        {Math.round(dsoImpact).toLocaleString('nl-NL')} euro-dagen op en zit in groep{' '}
        {activeScore}.
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
                {pb.counts[seg - 1]} debiteuren
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Stacked bar voor "Hoe staan we er nu voor". Rood deel = vervallen,
// groene rest = niet vervallen, plus oudste-post als label.
function HuidigeStandBar({
  pctVervallen,
  oudsteDagen,
}: {
  pctVervallen: number
  oudsteDagen: number
}) {
  const pct = Math.max(0, Math.min(100, pctVervallen))
  return (
    <div className="mt-1.5">
      <div className="relative h-2 bg-emerald-100 rounded-full overflow-hidden ring-1 ring-emerald-200">
        <div className="absolute inset-y-0 left-0 bg-red-400" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] mt-0.5">
        <span className="text-red-600">{Math.round(pct)}% vervallen</span>
        <span className="text-emerald-600">{Math.round(100 - pct)}% niet vervallen</span>
        {oudsteDagen > 0 && <span className="text-slate-400">oudste {oudsteDagen}d</span>}
      </div>
    </div>
  )
}

// Quintiel-weergave voor "Hoe belangrijk is deze klant voor ons" —
// identiek aan PercentilesBar, maar over debiteur-omzet (€ netto) in
// plaats van taak-bedrag. Toont voor elk van de 5 groepen het bereik en
// het aantal debiteuren, en markeert in welke groep deze klant valt.
function OmzetPercentilesBar({
  activeScore,
  debiteurOmzet,
  buckets,
}: {
  activeScore: number
  debiteurOmzet: number
  buckets: { thresholds: number[]; counts: number[]; min: number; max: number }
}) {
  const ranges = [
    `< ${fmtEUR(buckets.thresholds[0])}`,
    `${fmtEUR(buckets.thresholds[0])} – ${fmtEUR(buckets.thresholds[1])}`,
    `${fmtEUR(buckets.thresholds[1])} – ${fmtEUR(buckets.thresholds[2])}`,
    `${fmtEUR(buckets.thresholds[2])} – ${fmtEUR(buckets.thresholds[3])}`,
    `≥ ${fmtEUR(buckets.thresholds[3])}`,
  ]
  const totaalDebiteuren = buckets.counts.reduce((a, b) => a + b, 0)
  return (
    <div className="mt-3 mb-1">
      <p className="text-[11px] text-slate-500 mb-1.5">
        Alle {totaalDebiteuren} debiteuren in vijf even grote groepen op basis van netto omzet —
        deze klant ({fmtEUR(debiteurOmzet)} netto) zit in groep {activeScore}.
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
              <div className={`mt-1 tabular-nums ${active ? 'text-white/80' : 'text-slate-400'}`}>
                {buckets.counts[seg - 1]} debiteuren
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Stacked bar voor het kredietrisico. Rood deel = onverzekerd (deel dat
// boven de kredietlimiet uitkomt), grijs = gedekt door de limiet.
function KredietDekkingBar({
  onverzekerdPct,
}: {
  onverzekerdPct: number
}) {
  const pct = Math.max(0, Math.min(100, onverzekerdPct))
  return (
    <div className="mt-1.5">
      <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden ring-1 ring-slate-300">
        <div className="absolute inset-y-0 left-0 bg-red-400" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] mt-0.5">
        <span className="text-red-600">{Math.round(pct)}% onverzekerd</span>
        <span className="text-slate-500">{Math.round(100 - pct)}% binnen limiet</span>
      </div>
    </div>
  )
}

// Quintiel-weergave voor "Impact bij wanbetaling" — toont het onverzekerd
// bedrag van deze klant binnen de verdeling van alle debiteuren met
// onverzekerd > 0. Zelfde stijl als OmzetPercentilesBar.
function KredietImpactBar({
  activeScore,
  onverzekerdBedrag,
  buckets,
}: {
  activeScore: number
  onverzekerdBedrag: number
  buckets: { thresholds: number[]; counts: number[]; min: number; max: number }
}) {
  const ranges = [
    `< ${fmtEUR(buckets.thresholds[0])}`,
    `${fmtEUR(buckets.thresholds[0])} – ${fmtEUR(buckets.thresholds[1])}`,
    `${fmtEUR(buckets.thresholds[1])} – ${fmtEUR(buckets.thresholds[2])}`,
    `${fmtEUR(buckets.thresholds[2])} – ${fmtEUR(buckets.thresholds[3])}`,
    `≥ ${fmtEUR(buckets.thresholds[3])}`,
  ]
  const totaalDebiteuren = buckets.counts.reduce((a, b) => a + b, 0)
  return (
    <div className="mt-3 mb-1">
      <p className="text-[11px] text-slate-500 mb-1.5">
        Alle {totaalDebiteuren} debiteuren met onverzekerd bedrag in vijf even grote groepen — deze
        klant ({fmtEUR(onverzekerdBedrag)} onverzekerd) zit in groep {activeScore}.
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
              <div className={`mt-1 tabular-nums ${active ? 'text-white/80' : 'text-slate-400'}`}>
                {buckets.counts[seg - 1]} debiteuren
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Compacte cirkel-indicator voor een score van 0-max. Kleinere broer
// van PriorityRing — schaalbaar via de size prop. Met optionele
// hover-tooltip die de berekening uitlegt.
function ScoreRing({
  score,
  size = 48,
  max = 5,
  tooltip,
}: {
  score: number | null
  size?: number
  max?: number
  tooltip?: React.ReactNode
}) {
  const stroke = Math.max(4, Math.round(size / 10))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const fraction = score == null ? 0 : Math.max(0, Math.min(1, score / max))
  const offset = circumference * (1 - fraction)

  // Kleur volgt het priorityTone-schema voor visuele consistentie.
  const strokeColorClass =
    score == null
      ? 'text-slate-200'
      : score >= 4
        ? 'text-red-500'
        : score >= 3
          ? 'text-orange-500'
          : score >= 2
            ? 'text-amber-400'
            : 'text-slate-400'

  const fontSizeClass = size >= 56 ? 'text-lg' : size >= 44 ? 'text-sm' : 'text-xs'

  const ring = (
    <div
      className={`relative shrink-0 ${tooltip ? 'cursor-help' : ''}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(241 245 249)"
          strokeWidth={stroke}
        />
        {score != null && (
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
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`${fontSizeClass} font-semibold text-slate-900 tabular-nums leading-none`}>
          {score == null ? '—' : fmtNL(score, score % 1 === 0 ? 0 : 1)}
        </span>
      </div>
    </div>
  )

  if (!tooltip) return ring

  return (
    <div className="group relative shrink-0">
      {ring}
      <div
        className="absolute right-0 top-full mt-2 hidden group-hover:block z-20 bg-slate-900 text-white rounded-md p-3 shadow-xl pointer-events-none"
        style={{ width: 280 }}
      >
        {tooltip}
      </div>
    </div>
  )
}

// Generieke tooltip-content voor een score-cirkel. Toont titel, korte
// beschrijving van wat er gemeten wordt, een schaal-tabel met de
// drempels (actieve score uitgelicht), en optioneel een huidige meting.
function ScoreTooltip({
  title,
  description,
  thresholds,
  current,
  activeScore,
  composition,
}: {
  title: string
  description?: React.ReactNode
  thresholds?: { score: number | null; label: string }[]
  current?: React.ReactNode
  activeScore?: number | null
  composition?: React.ReactNode
}) {
  return (
    <div className="text-xs">
      <p className="font-medium text-white text-[12px] mb-1">{title}</p>
      {description && (
        <p className="text-white/70 text-[11px] leading-snug mb-2">{description}</p>
      )}
      {composition}
      {thresholds && (
        <div className="mt-1">
          <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">Schaal</p>
          <table className="w-full text-[11px]">
            <tbody>
              {thresholds.map((t, i) => {
                const active = t.score != null && t.score === activeScore
                return (
                  <tr key={i} className={active ? 'text-white' : 'text-white/60'}>
                    <td className="pr-2 py-0.5 w-5 tabular-nums">
                      {t.score == null ? '—' : t.score}
                    </td>
                    <td className={`py-0.5 ${active ? 'font-medium' : ''}`}>{t.label}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {current && (
        <p className="text-white/80 text-[11px] leading-snug pt-2 mt-2 border-t border-white/20">
          {current}
        </p>
      )}
    </div>
  )
}

// Uniforme kaart voor één metric in de risico-sectie. Titel + score
// linkboven, optionele confidence-pill ernaast, caption eronder, viz
// onderaan. Vult de breedte van zijn grid-cel.
function MetricCard({
  title,
  score,
  confidence,
  caption,
  viz,
  tooltip,
}: {
  title: string
  score: number | null
  confidence?: Confidence
  caption?: React.ReactNode
  viz?: React.ReactNode
  tooltip?: React.ReactNode
}) {
  return (
    <div className="border border-slate-200 rounded-md p-4 flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-sm font-medium text-slate-800 leading-snug">{title}</span>
          {confidence && <ConfidencePill value={confidence} />}
        </div>
        <ScoreRing score={score} size={40} tooltip={tooltip} />
      </div>
      {caption && <p className="text-xs text-slate-500 leading-snug mb-2">{caption}</p>}
      {viz && <div className="mt-auto">{viz}</div>}
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

// Plain-language voor de trend-uitkomst (drift vs. baseline + momentum/slope
// als context). Toont alleen de technische delta's wanneer "showSources"
// aanstaat.
function trendPlain(
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

// ----- tooltip-builders per score-type --------------------------------------
//
// Eén helper per ScoreRing op de detail-pagina. Drempels komen 1-op-1
// uit scripts/preprocess.mjs zodat de tooltips altijd de échte
// rekenregels weergeven.

function tooltipImpact(score: number, bedrag: number | undefined): React.ReactNode {
  const t = meta.bedrag_buckets.thresholds
  return (
    <ScoreTooltip
      title="Hoeveel levert dit op"
      description={`Score op basis van het openstaande bedrag, vergeleken met alle ${meta.total_taken_gegenereerd} taken in vijf even grote groepen (kwintielen).`}
      thresholds={[
        { score: 1, label: `< ${fmtEUR(t[0])}` },
        { score: 2, label: `${fmtEUR(t[0])} – ${fmtEUR(t[1])}` },
        { score: 3, label: `${fmtEUR(t[1])} – ${fmtEUR(t[2])}` },
        { score: 4, label: `${fmtEUR(t[2])} – ${fmtEUR(t[3])}` },
        { score: 5, label: `≥ ${fmtEUR(t[3])}` },
      ]}
      activeScore={score}
      current={bedrag !== undefined ? `Deze taak: ${fmtEUR(bedrag)} → score ${score}` : undefined}
    />
  )
}

function tooltipUrgentie(score: number, dagenVervallen: number | undefined): React.ReactNode {
  return (
    <ScoreTooltip
      title="Hoe dringend"
      description="Score op basis van het aantal dagen dat de oudste factuur in deze taak vervallen is."
      thresholds={[
        { score: 1, label: 'vandaag of nog niet vervallen' },
        { score: 2, label: '1 – 13 dagen vervallen' },
        { score: 3, label: '14 – 29 dagen vervallen' },
        { score: 4, label: '30 – 59 dagen vervallen' },
        { score: 5, label: '60+ dagen vervallen' },
      ]}
      activeScore={score}
      current={
        dagenVervallen !== undefined
          ? `Oudste factuur ${dagenVervallen}d vervallen → score ${score}`
          : undefined
      }
    />
  )
}

function tooltipPotentieel(
  score: number | null,
  dsoImpact: number | null | undefined,
  beinvloedbareDagen: number | null | undefined,
  totalOpen: number | undefined,
): React.ReactNode {
  const pb = meta.potentieel_buckets
  const respijt = pb?.haalbaarheidsdrempel_dagen ?? 7
  const popN = pb?.populatie_debiteuren ?? 0
  const t = pb?.thresholds ?? [0, 0, 0, 0]
  const fmtED = (n: number) =>
    `${Math.round(n).toLocaleString('nl-NL')} euro-dagen`
  const currentTxt =
    score === null
      ? 'Geen betaalhistorie — werkelijke termijn niet te bepalen, score is onbekend.'
      : dsoImpact != null && beinvloedbareDagen != null && totalOpen !== undefined
        ? `${beinvloedbareDagen}d beïnvloedbaar × ${fmtEUR(totalOpen)} = ${fmtED(dsoImpact)} → score ${score}`
        : undefined
  return (
    <ScoreTooltip
      title="Hoeveel sneller kan deze klant betalen"
      description={`DSO-winst die vrijspeelt als deze klant op afspraak gaat betalen: beïnvloedbare termijn (mediaan vertraging boven ${respijt} dagen respijt) × openstaand bedrag. Vergeleken met alle ${popN} debiteuren met vervallen saldo, verdeeld in vier kwartielen op DSO-impact > 0.`}
      thresholds={[
        { score: 1, label: `0 euro-dagen (binnen ${respijt}d marge — geen DSO-winst)` },
        { score: 2, label: `< ${fmtED(t[1])}` },
        { score: 3, label: `${fmtED(t[1])} – ${fmtED(t[2])}` },
        { score: 4, label: `${fmtED(t[2])} – ${fmtED(t[3])}` },
        { score: 5, label: `≥ ${fmtED(t[3])}` },
      ]}
      activeScore={score}
      current={currentTxt}
    />
  )
}

function risicoBullets(task: Task): string[] {
  const r = task.risico
  const bullets: string[] = []

  if (r.betaalgedrag_breakdown) {
    const dsoBlock = r.betaalgedrag_breakdown.dso
    if (dsoBlock.from_overdue) {
      const ou = dsoBlock.oudste_dagen_vervallen ?? 0
      bullets.push(`Geen betaalhistorie — oudste vervallen post is ${ou} dagen oud.`)
    } else {
      const dso = dsoBlock.median_days_late
      if (dso < 0) bullets.push(`Betaalt gemiddeld ${Math.abs(dso)} dagen vóór de vervaldatum.`)
      else if (dso === 0) bullets.push('Betaalt gemiddeld op de vervaldatum.')
      else bullets.push(`Betaalt gemiddeld ${dso} dagen na de vervaldatum.`)
    }

    const trend = r.betaalgedrag_breakdown.trend
    if (trend.score != null) {
      if (trend.story === 'hersteld na piek') {
        bullets.push('Betaalgedrag is hersteld — terug op het oude niveau na een eerdere piek.')
      } else if (
        trend.story === 'structureel verslechterend' ||
        trend.story === 'structureel verhoogd' ||
        trend.score >= 4
      ) {
        bullets.push('Betaalgedrag verslechtert — betaalt structureel later dan eerder.')
      } else if (trend.story === 'herstellend, nog niet op niveau') {
        bullets.push('Betaalgedrag herstelt — recent verbetering, maar nog niet terug bij uitgangspunt.')
      } else if (trend.story === 'structureel verbeterend') {
        bullets.push('Betaalgedrag verbetert — betaalt structureel sneller dan eerder.')
      } else if (trend.story === 'recent kantelpunt') {
        bullets.push('Betaalgedrag is recent omgeslagen — eerder stabiel, nu duidelijk later.')
      }
    }

    const vol = r.betaalgedrag_breakdown.volatiliteit
    if (vol.confidence !== 'geen' && vol.score != null && vol.score >= 4) {
      bullets.push('Betaalt grillig — moeilijk te voorspellen wanneer betaald wordt.')
    }
  }

  if (r.huidige_stand_pct_vervallen !== undefined && r.huidige_stand_pct_vervallen > 0) {
    const pct = Math.round(r.huidige_stand_pct_vervallen)
    const oudste = r.huidige_stand_oudste_dagen
    bullets.push(
      `${pct}% van openstaand bedrag is vervallen${oudste ? ` (oudste post ${oudste} dagen)` : ''}.`,
    )
  }

  if (r.krediet != null) {
    const pct = Math.round(r.krediet_onverzekerd_pct ?? 0)
    const bedrag = r.krediet_onverzekerd_bedrag ?? 0
    if (r.krediet >= 4) {
      bullets.push(`Kredietrisico hoog — ${pct}% onverzekerd (${fmtEUR(bedrag)}).`)
    } else if (r.krediet >= 3) {
      bullets.push(`Kredietrisico gemiddeld — ${pct}% onverzekerd.`)
    } else if (r.krediet >= 2) {
      bullets.push(`Kredietrisico beperkt — ${pct}% onverzekerd.`)
    } else {
      bullets.push('Kredietrisico laag — openstaand bedrag binnen de limiet.')
    }
  }

  if (r.omzetconcentratie != null) {
    const pct = r.omzetconcentratie_pct
    const pctTxt = pct != null ? ` (${pct.toFixed(1)}% van jaaromzet)` : ''
    if (r.omzetconcentratie >= 5) bullets.push(`Zeer belangrijke klant — top 20% in netto-omzet${pctTxt}.`)
    else if (r.omzetconcentratie >= 4) bullets.push(`Belangrijke klant qua omzet${pctTxt}.`)
    else if (r.omzetconcentratie <= 2) bullets.push(`Beperkte omzetbijdrage${pctTxt}.`)
  }

  return bullets
}

function tooltipRisico(task: Task): React.ReactNode {
  const bg = task.risico.betaalgedrag
  const hs = task.risico.huidige_stand
  const kr = task.risico.krediet
  const oc = task.risico.omzetconcentratie
  const hasKrediet = kr != null
  const noemer = 30 + 25 + (hasKrediet ? 25 : 0) + 10
  const bullets = risicoBullets(task)
  return (
    <ScoreTooltip
      title="Hoe risicovol"
      description={`Gewogen gemiddelde van ${hasKrediet ? 'vier' : 'drie'} deelscores. Disputen ontbreekt in de dummy data en telt niet mee — de score is genormaliseerd over de wél beschikbare metrics.`}
      composition={
        <div className="space-y-3 mb-2">
          {bullets.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">
                Samenvatting
              </p>
              <ul className="space-y-0.5 text-[11px] text-white/85">
                {bullets.map((b, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-white/40">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">
              Opbouw score
            </p>
            <table className="w-full text-[11px] tabular-nums">
              <tbody className="text-white/80">
                <tr>
                  <td className="pr-2 py-0.5">Betaalgedrag</td>
                  <td className="text-right pr-1">{fmtNL(bg, 1)}</td>
                  <td className="text-white/50 pl-1">× 30/{noemer}</td>
                </tr>
                <tr>
                  <td className="pr-2 py-0.5">Huidige stand</td>
                  <td className="text-right pr-1">{fmtNL(hs, 1)}</td>
                  <td className="text-white/50 pl-1">× 25/{noemer}</td>
                </tr>
                {hasKrediet && (
                  <tr>
                    <td className="pr-2 py-0.5">Kredietrisico</td>
                    <td className="text-right pr-1">{fmtNL(kr, 1)}</td>
                    <td className="text-white/50 pl-1">× 25/{noemer}</td>
                  </tr>
                )}
                <tr>
                  <td className="pr-2 py-0.5">Omzetconcentratie</td>
                  <td className="text-right pr-1">{fmtNL(oc, 0)}</td>
                  <td className="text-white/50 pl-1">× 10/{noemer}</td>
                </tr>
                <tr className="border-t border-white/20">
                  <td className="font-medium pt-1">Risico-score</td>
                  <td className="text-right font-semibold pt-1 pr-1">
                    {fmtNL(task.risico.score, 2)}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      }
    />
  )
}

function tooltipDso(
  score: number,
  days: number,
  count: number,
  fromOverdue?: boolean,
  oudsteVervallen?: number,
): React.ReactNode {
  const ouLabel = oudsteVervallen ?? 0
  const fallbackThresholds = [
    { score: 2, label: '1 – 5 dagen vervallen (grace period)' },
    { score: 5, label: '> 5 dagen vervallen (rood vlaggetje)' },
  ]
  const normalThresholds = [
    { score: 1, label: 'op tijd of eerder' },
    { score: 2, label: '1 – 7 dagen te laat' },
    { score: 3, label: '8 – 21 dagen te laat' },
    { score: 4, label: '22 – 45 dagen te laat' },
    { score: 5, label: '45+ dagen te laat' },
  ]
  return (
    <ScoreTooltip
      title="Hoeveel dagen meestal te laat"
      description={
        fromOverdue
          ? 'Deze klant heeft geen betalingen gedaan in de afgelopen 12 maanden. We vallen daarom terug op de leeftijd van de oudste vervallen post — een grace period van 5 dagen, daarna direct rood.'
          : 'Mediaan van het aantal dagen dat over de vervaldatum heen wordt gegaan op facturen die in de afgelopen 12 maanden volledig zijn betaald (DSO na vervaldatum). Mediaan i.p.v. gemiddelde — robuuster tegen uitschieters.'
      }
      thresholds={fromOverdue ? fallbackThresholds : normalThresholds}
      activeScore={score}
      current={
        fromOverdue
          ? `Geen betaalhistorie — oudste vervallen post ${ouLabel}d → score ${score}`
          : `Mediaan ${days}d te laat over ${count} facturen betaald in de afgelopen 12 maanden → score ${score}`
      }
    />
  )
}

function tooltipTrend(
  score: number | null,
  driftDagen: number | null,
  baselineDagen: number | null,
  currentDagen: number | null,
  momentumDelta: number | null,
  slope: number,
  story:
    | 'hersteld na piek'
    | 'herstellend, nog niet op niveau'
    | 'structureel verbeterend'
    | 'structureel verslechterend'
    | 'structureel verhoogd'
    | 'recent kantelpunt'
    | null,
  monthsObserved: number,
): React.ReactNode {
  const fmtDelta = (d: number) => `${d >= 0 ? '+' : ''}${Math.round(d)}d`
  const fmtSlope = (s: number) => `${s >= 0 ? '+' : ''}${s.toFixed(1)}d/mnd`
  return (
    <ScoreTooltip
      title="Gaat het beter of slechter"
      description="Drift = huidige stand (mediaan laatste 2 mnd) minus uitgangspunt (mediaan eerste 3 mnd) op de maandelijkse mediaan-DSO. Vangt structurele verslechtering: een klant die van 6d naar 18d is gegroeid telt zwaar, ook als de laatste paar maanden lokaal stabiel zijn. Momentum (laatste 3 vs voorgaande 3) en Theil-Sen slope dienen als context voor het story-label. Asymmetrisch — alleen verslechtering verhoogt het risico."
      thresholds={[
        { score: 1, label: 'drift < +3d (stabiel of verbeterend)' },
        { score: 2, label: '+3 t/m +6d (lichte verslechtering)' },
        { score: 3, label: '+7 t/m +9d (duidelijke verslechtering)' },
        { score: 4, label: '+10 t/m +19d (sterke verslechtering)' },
        { score: 5, label: '≥ +20d (acute verslechtering)' },
      ]}
      activeScore={score}
      current={
        driftDagen === null
          ? `Te weinig data (${monthsObserved} maanden, minimaal 5 nodig) → geen score`
          : `van ${baselineDagen}d → ${currentDagen}d (drift ${fmtDelta(driftDagen)}), ` +
            `momentum ${momentumDelta === null ? '—' : fmtDelta(momentumDelta)}, ` +
            `slope ${fmtSlope(slope)} over ${monthsObserved} mnd → score ${score}` +
            (story ? ` (${story})` : '')
      }
    />
  )
}

function tooltipVolatiliteit(
  score: number | null,
  cv: number,
  intervalsObserved: number,
  confidence: Confidence,
): React.ReactNode {
  return (
    <ScoreTooltip
      title="Hoe voorspelbaar"
      description="Coefficient of variation (CV) op de tijd tussen opeenvolgende betalingen in de afgelopen 12 maanden. Lage CV = regelmatig, hoge CV = grillig."
      thresholds={[
        { score: 1, label: 'CV < 0,3 (zeer regelmatig)' },
        { score: 2, label: '0,3 ≤ CV < 0,6 (regelmatig)' },
        { score: 3, label: '0,6 ≤ CV < 1,0 (wisselend)' },
        { score: 4, label: '1,0 ≤ CV < 1,5 (onregelmatig)' },
        { score: 5, label: 'CV ≥ 1,5 (zeer grillig)' },
      ]}
      activeScore={score}
      current={
        confidence === 'geen'
          ? `Te weinig data (${intervalsObserved} betaalintervallen) → geen score`
          : `CV=${cv} over ${intervalsObserved} betaalintervallen → score ${score}`
      }
    />
  )
}

function tooltipHuidigeStand(
  score: number,
  pctVervallen: number | undefined,
  oudsteDagen: number | undefined,
  pctScore: number | undefined,
  oudsteScore: number | undefined,
): React.ReactNode {
  const pctSchaal = [
    { score: 1, label: '0 – 10%' },
    { score: 2, label: '11 – 25%' },
    { score: 3, label: '26 – 50%' },
    { score: 4, label: '51 – 75%' },
    { score: 5, label: '> 75%' },
  ]
  const oudsteSchaal = [
    { score: 1, label: '0 – 15 dagen' },
    { score: 2, label: '16 – 30 dagen' },
    { score: 3, label: '31 – 60 dagen' },
    { score: 4, label: '61 – 90 dagen' },
    { score: 5, label: '> 90 dagen' },
  ]
  return (
    <ScoreTooltip
      title="Hoe staan we er nu voor"
      description="Gemiddelde van twee parameters: % vervallen (hoe groot het probleem nu is) + leeftijd oudste post (hoe lang het al sleept)."
      composition={
        <div className="space-y-3 mb-2">
          <table className="w-full text-[11px] tabular-nums">
            <tbody className="text-white/80">
              <tr>
                <td className="pr-2 py-0.5">% vervallen</td>
                <td className="text-right pr-1">
                  {pctVervallen !== undefined ? `${Math.round(pctVervallen)}%` : '—'}
                </td>
                <td className="text-white/50 pl-2 text-right">
                  → score {pctScore ?? '—'}
                </td>
              </tr>
              <tr>
                <td className="pr-2 py-0.5">Oudste post</td>
                <td className="text-right pr-1">
                  {oudsteDagen !== undefined ? `${oudsteDagen}d` : '—'}
                </td>
                <td className="text-white/50 pl-2 text-right">
                  → score {oudsteScore ?? '—'}
                </td>
              </tr>
              <tr className="border-t border-white/20">
                <td className="font-medium pt-1">Huidige stand</td>
                <td className="text-right font-semibold pt-1 pr-1">{fmtNL(score, 1)}</td>
                <td className="text-white/50 pl-2 text-right pt-1">(gemiddelde)</td>
              </tr>
            </tbody>
          </table>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">
              Schaal % vervallen
            </p>
            <table className="w-full text-[11px]">
              <tbody>
                {pctSchaal.map((t) => {
                  const active = t.score === pctScore
                  return (
                    <tr key={t.score} className={active ? 'text-white' : 'text-white/60'}>
                      <td className="pr-2 py-0.5 w-5 tabular-nums">{t.score}</td>
                      <td className={`py-0.5 ${active ? 'font-medium' : ''}`}>{t.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">
              Schaal leeftijd oudste post
            </p>
            <table className="w-full text-[11px]">
              <tbody>
                {oudsteSchaal.map((t) => {
                  const active = t.score === oudsteScore
                  return (
                    <tr key={t.score} className={active ? 'text-white' : 'text-white/60'}>
                      <td className="pr-2 py-0.5 w-5 tabular-nums">{t.score}</td>
                      <td className={`py-0.5 ${active ? 'font-medium' : ''}`}>{t.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      }
    />
  )
}

function tooltipOmzetconcentratie(
  score: number,
  pctOmzet: number | undefined,
  debiteurOmzet: number | undefined,
): React.ReactNode {
  const p = meta.omzet_percentielen
  const totaal = meta.jaaromzet_totaal
  // Drempel-formattering: percentage van netto jaaromzet voor het label,
  // bedrag (€) als secundair label. Bij ontbreken van percentielen valt de
  // tooltip terug op een leeg overzicht.
  const fmtPct = (eur: number) => (totaal > 0 ? `${((eur / totaal) * 100).toFixed(3)}%` : '—')
  const thresholds = p
    ? [
        { score: 1, label: `< ${fmtPct(p.p20)} (< ${fmtEUR(p.p20)} netto)` },
        { score: 2, label: `${fmtPct(p.p20)} – ${fmtPct(p.p40)} (${fmtEUR(p.p20)} – ${fmtEUR(p.p40)})` },
        { score: 3, label: `${fmtPct(p.p40)} – ${fmtPct(p.p60)} (${fmtEUR(p.p40)} – ${fmtEUR(p.p60)})` },
        { score: 4, label: `${fmtPct(p.p60)} – ${fmtPct(p.p80)} (${fmtEUR(p.p60)} – ${fmtEUR(p.p80)})` },
        { score: 5, label: `≥ ${fmtPct(p.p80)} (≥ ${fmtEUR(p.p80)} netto)` },
      ]
    : []
  const populatieN = meta.omzet_populatie_debiteuren
  const scopeLabel = meta.omzet_scope === 'salesarea' ? 'sales area' : 'administratie'
  const populatieRegel = populatieN
    ? `Top 20% van ${populatieN} debiteuren in deze ${scopeLabel} (op netto omzet, ex BTW).`
    : `Quintielen binnen deze ${scopeLabel} (netto omzet, ex BTW).`
  const currentRegel =
    debiteurOmzet !== undefined && pctOmzet !== undefined
      ? `${fmtEUR(debiteurOmzet)} netto · ${pctOmzet.toFixed(2)}% van netto jaaromzet → score ${score}`
      : pctOmzet !== undefined
        ? `${pctOmzet.toFixed(2)}% van netto jaaromzet → score ${score}`
        : undefined
  return (
    <ScoreTooltip
      title="Hoe belangrijk is deze klant"
      description={`Aandeel van deze klant in onze totale netto jaaromzet (ex BTW). De schaal verdeelt alle debiteuren met omzet in vijf even grote groepen (quintielen). ${populatieRegel}`}
      thresholds={thresholds}
      activeScore={score}
      current={currentRegel}
    />
  )
}

function tooltipKrediet(
  score: number,
  onverzekerdPct: number | undefined,
  onverzekerdBedrag: number | undefined,
  pctScore: number | null | undefined,
  impactScore: number | null | undefined,
): React.ReactNode {
  const pctSchaal = [
    { score: 1, label: '0% (volledig binnen limiet)' },
    { score: 2, label: '1 – 25%' },
    { score: 3, label: '26 – 50%' },
    { score: 4, label: '51 – 75%' },
    { score: 5, label: '> 75% onverzekerd' },
  ]
  const p = meta.krediet_percentielen
  const impactSchaal = p
    ? [
        { score: 1, label: `< ${fmtEUR(p.p20)} onverzekerd` },
        { score: 2, label: `${fmtEUR(p.p20)} – ${fmtEUR(p.p40)}` },
        { score: 3, label: `${fmtEUR(p.p40)} – ${fmtEUR(p.p60)}` },
        { score: 4, label: `${fmtEUR(p.p60)} – ${fmtEUR(p.p80)}` },
        { score: 5, label: `≥ ${fmtEUR(p.p80)} (top 20% blootstelling)` },
      ]
    : []
  const populatieN = meta.krediet_populatie_debiteuren
  return (
    <ScoreTooltip
      title="Hoe is het kredietrisico"
      description="Gemiddelde van twee parameters: % onverzekerd (welk deel van het openstaande bedrag valt boven de kredietlimiet) + impact in euro (hoe groot het onverzekerd bedrag is t.o.v. andere debiteuren)."
      composition={
        <div className="space-y-3 mb-2">
          <table className="w-full text-[11px] tabular-nums">
            <tbody className="text-white/80">
              <tr>
                <td className="pr-2 py-0.5">% onverzekerd</td>
                <td className="text-right pr-1">
                  {onverzekerdPct !== undefined ? `${onverzekerdPct.toFixed(0)}%` : '—'}
                </td>
                <td className="text-white/50 pl-2 text-right">→ score {pctScore ?? '—'}</td>
              </tr>
              <tr>
                <td className="pr-2 py-0.5">Impact (€)</td>
                <td className="text-right pr-1">
                  {onverzekerdBedrag !== undefined ? fmtEUR(onverzekerdBedrag) : '—'}
                </td>
                <td className="text-white/50 pl-2 text-right">→ score {impactScore ?? '—'}</td>
              </tr>
              <tr className="border-t border-white/20">
                <td className="font-medium pt-1">Kredietrisico</td>
                <td className="text-right font-semibold pt-1 pr-1">{fmtNL(score, 1)}</td>
                <td className="text-white/50 pl-2 text-right pt-1">(gemiddelde)</td>
              </tr>
            </tbody>
          </table>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">
              Schaal % onverzekerd
            </p>
            <table className="w-full text-[11px]">
              <tbody>
                {pctSchaal.map((t) => {
                  const active = t.score === pctScore
                  return (
                    <tr key={t.score} className={active ? 'text-white' : 'text-white/60'}>
                      <td className="pr-2 py-0.5 w-5 tabular-nums">{t.score}</td>
                      <td className={`py-0.5 ${active ? 'font-medium' : ''}`}>{t.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">
              Schaal impact (€){populatieN ? ` — quintielen over ${populatieN} debiteuren` : ''}
            </p>
            <table className="w-full text-[11px]">
              <tbody>
                {impactSchaal.map((t) => {
                  const active = t.score === impactScore
                  return (
                    <tr key={t.score} className={active ? 'text-white' : 'text-white/60'}>
                      <td className="pr-2 py-0.5 w-5 tabular-nums">{t.score}</td>
                      <td className={`py-0.5 ${active ? 'font-medium' : ''}`}>{t.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      }
      activeScore={score}
    />
  )
}

function TaskRow({ task, selected, onClick }: { task: Task; selected: boolean; onClick: () => void }) {
  const factuurCount = task.gerelateerde_facturen?.length ?? (task.factuurnummer ? 1 : 0)
  const pattern = task.potentieel?.pattern
  const heeftPatroon = pattern && pattern.pattern_type !== 'geen' && pattern.pattern_value
  const betaaldagLabel = pattern ? standaardBetaaldagLabel(pattern) : 'geen standaard betaaldag'
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
            <h3 className="font-medium text-slate-900 truncate">
              {task.debiteurnummer && (
                <>
                  <span className="tabular-nums">{task.debiteurnummer}</span>
                  <span className="text-slate-300 mx-2">|</span>
                </>
              )}
              {task.debiteur}
            </h3>
            {factuurCount > 1 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 tabular-nums shrink-0">
                {factuurCount} facturen
              </span>
            )}
          </div>
          <p className="text-sm text-slate-700 mt-0.5 truncate">{task.taakomschrijving}</p>
          <p className="text-xs text-slate-500 mt-1 truncate">{task.aanleiding}</p>
          {task.priority_gedempt && task.voorspelling && (
            <p
              className="text-[11px] mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 ring-1 ring-sky-200"
              title={`Verwacht op ${task.voorspelling.pattern_value}. Originele priority was ${fmtNL(
                task.priority_origineel,
                2,
              )}.`}
            >
              <span aria-hidden>⏳</span>
              Wacht op betaling ~{fmtDM(task.voorspelling.betaaldatum)}
            </p>
          )}
        </div>
        <div className="shrink-0 hidden md:flex items-center gap-10 pl-4">
          <div
            className={`shrink-0 w-14 h-14 rounded-md ring-1 flex flex-col items-center justify-center ${priorityTone(
              task.risico.score,
            )}`}
          >
            <span className="text-lg font-semibold tabular-nums leading-none">
              {fmtNL(task.risico.score, 1)}
            </span>
            <span className="text-[10px] uppercase tracking-wide opacity-70 mt-1">risico</span>
          </div>
          <div className="shrink-0 w-40 text-right">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 leading-none">
              Betaaldag
            </div>
            <div
              className={`text-sm leading-tight mt-1 truncate ${
                heeftPatroon ? 'text-slate-700' : 'text-slate-400 italic'
              }`}
              title={betaaldagLabel}
            >
              {heeftPatroon ? betaaldagLabel : '—'}
              {pattern?.verschuiving && (
                <span
                  className="ml-1 text-amber-600"
                  title={`Patroon recent gewijzigd: was ${pattern.verschuiving.van_waarde}`}
                >
                  ⚠
                </span>
              )}
            </div>
          </div>
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

// Centrale lookup van alles wat we voor een taak/debiteur nodig hebben.
// Wordt door meerdere sub-componenten gebruikt — één keer berekend per render.
function getDebtorData(task: Task) {
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

// Korte label voor het standaard-betaaldag patroon. Toont één concrete
// dag (bv. "elke vrijdag" of "rond de 28e") of "geen standaard betaaldag".
function standaardBetaaldagLabel(p: PatternInfo): string {
  if (p.pattern_type === 'geen' || !p.pattern_value) return 'geen standaard betaaldag'
  return p.pattern_value
}

// Tooltip voor de standaard-betaaldag stat. Toont hoe het patroon is
// bepaald (bron, venster, beslisregel, feestdag-correctie) en bij een
// patroon-verschuiving expliciet welk oud→nieuw is gedetecteerd.
function tooltipStandaardBetaaldag(p: PatternInfo): React.ReactNode {
  const hasPattern = p.pattern_type !== 'geen' && p.pattern_value
  const typeLabel: Record<PatternInfo['pattern_type'], string> = {
    wekelijks: 'vaste weekdag',
    maanddag: 'vaste dag van de maand',
    geen: 'geen',
  }
  return (
    <div className="text-xs">
      <p className="font-medium text-white text-[12px] mb-1">Standaard betaaldag</p>
      <p className="text-white/70 text-[11px] leading-snug mb-2">
        Het ritme waarop deze klant fysiek betaalt. Wordt ook gebruikt door de herinneringsflow:
        valt een herinnering op deze dag, dan schuift hij één dag op (nooit geskipt).
      </p>
      <div className="space-y-1 text-[11px] text-white/80">
        <div className="flex justify-between gap-3">
          <span className="text-white/50">Patroon-type</span>
          <span>{typeLabel[p.pattern_type]}</span>
        </div>
        {hasPattern && (
          <div className="flex justify-between gap-3">
            <span className="text-white/50">Sterkte</span>
            <span>
              {p.hits ?? 0} hits op {p.fit_pct}%
            </span>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <span className="text-white/50">Op basis van</span>
          <span>{p.payments_observed} betaaldagen</span>
        </div>
        {p.venster_maanden !== undefined && (
          <div className="flex justify-between gap-3">
            <span className="text-white/50">Venster</span>
            <span>laatste {p.venster_maanden} mnd</span>
          </div>
        )}
        {p.min_hits !== undefined && p.min_fit_pct !== undefined && (
          <div className="flex justify-between gap-3">
            <span className="text-white/50">Beslisregel</span>
            <span className="text-right">
              {p.high_volume_hits !== undefined && p.high_volume_fit_pct !== undefined ? (
                <>
                  ≥{p.high_volume_hits} hits + ≥{p.high_volume_fit_pct}%
                  <br />
                  óf ≥{p.min_hits} hits + ≥{p.min_fit_pct}%
                  <br />
                  óf {p.perfect_min_hits ?? 3}× 100%
                </>
              ) : (
                <>
                  ≥{p.min_hits} hits + ≥{p.min_fit_pct}% (of {p.perfect_min_hits ?? 3}× 100%)
                </>
              )}
            </span>
          </div>
        )}
        {p.feestdag_correctie && (
          <div className="flex justify-between gap-3">
            <span className="text-white/50">Correctie</span>
            <span>feestdagen NL/BE/TARGET</span>
          </div>
        )}
      </div>
      {p.verschuiving && (
        <div className="mt-2 pt-2 border-t border-white/20 bg-amber-500/10 -mx-3 -mb-3 px-3 pb-3 rounded-b-md">
          <p className="text-amber-200 font-medium text-[11px] mb-1">⚠ Patroon recent gewijzigd</p>
          <p className="text-white/80 text-[11px] leading-snug">
            Was <span className="font-medium">{p.verschuiving.van_waarde}</span> ({p.verschuiving.van_fit_pct}% over {p.verschuiving.van_n} betalingen), is nu <span className="font-medium">{p.verschuiving.naar_waarde}</span> ({p.verschuiving.naar_fit_pct}% over {p.verschuiving.naar_n} betalingen in de laatste {Math.round(p.verschuiving.sinds_dagen / 30)} mnd). Flow stuurt op het nieuwe patroon.
          </p>
        </div>
      )}
      <p className="text-white/80 text-[11px] leading-snug pt-2 mt-2 border-t border-white/20">
        {p.explanation}
      </p>
    </div>
  )
}

// Stat-cel met info-icoon dat een tooltip toont bij hover. Gebruikt
// hetzelfde group/group-hover-mechanisme als ScoreRing.
function StatWithTooltip({
  value,
  tone,
  tooltip,
}: {
  value: React.ReactNode
  tone?: 'normal' | 'muted'
  tooltip: React.ReactNode
}) {
  return (
    <div className="group relative inline-flex items-center gap-1">
      <span className={tone === 'muted' ? 'text-slate-500' : ''}>{value}</span>
      <span
        className="inline-flex w-3.5 h-3.5 items-center justify-center rounded-full bg-slate-200 text-slate-600 text-[9px] font-semibold cursor-help select-none"
        aria-label="meer informatie"
      >
        i
      </span>
      <div
        className="absolute right-0 top-full mt-2 hidden group-hover:block z-20 bg-slate-900 text-white rounded-md p-3 shadow-xl pointer-events-none"
        style={{ width: 320 }}
      >
        {tooltip}
      </div>
    </div>
  )
}

// Audit-log voor één debiteur — toont alle automatische beslissingen die
// het systeem voor deze klant heeft genomen (nu alleen patroon-verschuivingen;
// in productie ook elke verschoven herinnering).
function AutomatischeBeslissingen({ debiteurnummer }: { debiteurnummer: string }) {
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
function DebtorStatsBar({ task, showSources }: { task: Task; showSources: boolean }) {
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
function FactuurCard({
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

function LosseBetalingTable({ betalingen }: { betalingen: LosseBetaling[] }) {
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

function LosseBetalingCard({
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

function ComponentBlock({
  title,
  score,
  lead,
  children,
  tooltip,
}: {
  title: string
  score: number | null
  lead?: React.ReactNode
  children: React.ReactNode
  tooltip?: React.ReactNode
}) {
  return (
    <section className="border border-slate-200 rounded-md p-4">
      <div className="flex items-start justify-between mb-3 gap-3">
        <h4 className="font-medium text-slate-900">{title}</h4>
        <ScoreRing score={score} size={56} tooltip={tooltip} />
      </div>
      {lead && <div className="mb-3 text-sm text-slate-700">{lead}</div>}
      <div className="space-y-2 text-sm text-slate-700">{children}</div>
    </section>
  )
}

// Verklaring van de Risicoscore: weegt de wél beschikbare sub-scores
// (betaalgedrag 30, huidige stand 25, krediet 25, omzetconcentratie 10).
// Disputen ontbreekt in de dummy data en valt uit de noemer. Krediet
// doet alleen mee als de debiteur openstaand bedrag heeft (anders null).
function RisicoBreakdown({ task, showSources }: { task: Task; showSources: boolean }) {
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

function Detail({ task, showSources }: { task: Task; showSources: boolean }) {
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
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = q
    ? sorted.filter((t) => {
        const nr = (t.debiteurnummer ?? '').toLowerCase()
        const naam = (t.debiteur ?? '').toLowerCase()
        return nr.includes(q) || naam.includes(q)
      })
    : sorted
  return (
    <>
      <AppHeader
        showSources={showSources}
        setShowSources={setShowSources}
        rightSlot={
          <p className="text-sm text-slate-500 tabular-nums">
            {q ? `${filtered.length} van ${sorted.length} taken` : `${sorted.length} taken`}
          </p>
        }
      />
      <main className="max-w-5xl mx-auto px-6 py-6">
        <div className="mb-4 relative">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Zoek op debiteurnummer of naam…"
            className="w-full pl-9 pr-9 py-2 text-sm rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-300"
            aria-label="Zoek in takenlijst"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-700"
              aria-label="Zoekopdracht wissen"
            >
              ×
            </button>
          )}
        </div>
        <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 text-center">
              Geen taken gevonden voor &ldquo;{query}&rdquo;.
            </p>
          ) : (
            filtered.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                selected={false}
                onClick={() => onSelectTask(task.id)}
              />
            ))
          )}
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
    const index = sorted.findIndex((t) => t.id === route.taskId)
    const task = index >= 0 ? sorted[index] : undefined
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
          index={index}
          total={sorted.length}
          onPrev={() =>
            index > 0 && navigate({ name: 'detail', taskId: sorted[index - 1].id })
          }
          onNext={() =>
            index < sorted.length - 1 &&
            navigate({ name: 'detail', taskId: sorted[index + 1].id })
          }
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
