import { useCallback, useEffect, useState } from 'react'
import {
  tasks,
  meta,
  betalingen,
  getDebiteur,
  getFacturen,
  getFacturenVoorDebiteur,
  getLosseBetalingenVoorDebiteur,
  type Task,
  type Factuur,
  type LosseBetaling,
  type Confidence,
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
  return (
    <div className="mt-1.5">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={`w-full ${colorClass}`}
        style={{ height: `${height}px` }}
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={1.5} fill="currentColor" />
        ))}
      </svg>
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

// Vergelijking van afgesproken vs. werkelijke betaaltermijn op één
// tijdlijn-balk. Groen stipje = afgesproken moment, oranje streepje =
// werkelijk moment. Het stuk tussen beide markers is oranje gearceerd
// zodat de overschrijding meteen opvalt.
function PotentieelComparison({
  afgesproken,
  werkelijk,
}: {
  afgesproken: number
  werkelijk: number
}) {
  // Schaalwaarde: ruim genoeg om beide markers comfortabel te tonen
  const max = Math.max(werkelijk, afgesproken * 1.5, 30)
  const pctA = (afgesproken / max) * 100
  const pctW = (werkelijk / max) * 100
  const diff = werkelijk - afgesproken
  const teLaat = diff > 0

  return (
    <div className="mt-2">
      <div className="relative h-4">
        {/* Track */}
        <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 bg-slate-100 rounded-full" />

        {/* Gearceerd segment tussen afgesproken en werkelijk (alleen als te laat) */}
        {teLaat && (
          <div
            className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-orange-200"
            style={{ left: `${pctA}%`, width: `${pctW - pctA}%` }}
          />
        )}

        {/* Afgesproken: groen stipje */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white shadow-sm"
          style={{ left: `${pctA}%` }}
          title={`Afgesproken: ${afgesproken} dagen`}
        />

        {/* Werkelijk: oranje verticale streep */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1 h-4 bg-orange-500 rounded-sm"
          style={{ left: `${pctW}%` }}
          title={`Werkelijk: ${werkelijk} dagen`}
        />
      </div>

      {/* Legenda met waardes */}
      <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
          Afgesproken{' '}
          <span className="tabular-nums text-slate-700 font-medium">{afgesproken}d</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-0.5 h-2.5 bg-orange-500 inline-block" />
          Werkelijk{' '}
          <span className="tabular-nums text-slate-700 font-medium">{werkelijk}d</span>
        </span>
        {teLaat && <span className="text-orange-600 ml-auto">+{diff}d langer</span>}
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

      {/* Hover tooltip met opbouw van de score (rechts-uitgelijnd zodat
          hij niet overflowt op een full-width container) */}
      <div
        className="absolute right-0 top-full mt-3 hidden group-hover:block z-20 bg-slate-900 text-white rounded-md p-3 text-xs shadow-xl pointer-events-none"
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
      description="Score op basis van het openstaande bedrag, vergeleken met alle 445 taken in vijf even grote groepen (kwintielen)."
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
  score: number,
  werkelijk: number,
  afgesproken: number,
): React.ReactNode {
  const diff = werkelijk - afgesproken
  return (
    <ScoreTooltip
      title="Hoeveel sneller mogelijk"
      description="Score op basis van het verschil tussen wat er afgesproken is en wat er werkelijk gebeurt — gemiddeld over alle betaalde facturen van deze klant."
      thresholds={[
        { score: 0, label: 'binnen afspraak (geen ruimte)' },
        { score: 1, label: '1 – 10 dagen langer' },
        { score: 2, label: '11 – 30 dagen langer' },
        { score: 3, label: '31 – 60 dagen langer' },
        { score: 4, label: '61 – 90 dagen langer' },
        { score: 5, label: '> 90 dagen langer' },
      ]}
      activeScore={score}
      current={`Werkelijk ${werkelijk}d vs. afgesproken ${afgesproken}d = ${diff > 0 ? '+' : ''}${diff}d → score ${score}`}
    />
  )
}

function tooltipRisico(task: Task): React.ReactNode {
  const bg = task.risico.betaalgedrag
  const hs = task.risico.huidige_stand
  const oc = task.risico.omzetconcentratie
  return (
    <ScoreTooltip
      title="Hoe risicovol"
      description="Gewogen gemiddelde van drie deelscores. Disputen en kredietverzekering ontbreken in de Covebo-data en tellen niet mee — de score is genormaliseerd over de drie wél beschikbare metrics."
      composition={
        <table className="w-full text-[11px] tabular-nums mb-2">
          <tbody className="text-white/80">
            <tr>
              <td className="pr-2 py-0.5">Betaalgedrag</td>
              <td className="text-right pr-1">{fmtNL(bg, 1)}</td>
              <td className="text-white/50 pl-1">× 30/65</td>
            </tr>
            <tr>
              <td className="pr-2 py-0.5">Huidige stand</td>
              <td className="text-right pr-1">{fmtNL(hs, 1)}</td>
              <td className="text-white/50 pl-1">× 25/65</td>
            </tr>
            <tr>
              <td className="pr-2 py-0.5">Omzetconcentratie</td>
              <td className="text-right pr-1">{fmtNL(oc, 0)}</td>
              <td className="text-white/50 pl-1">× 10/65</td>
            </tr>
            <tr className="border-t border-white/20">
              <td className="font-medium pt-1">Risico-score</td>
              <td className="text-right font-semibold pt-1 pr-1">{fmtNL(task.risico.score, 2)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      }
    />
  )
}

function tooltipDso(score: number, days: number, count: number): React.ReactNode {
  return (
    <ScoreTooltip
      title="Hoeveel dagen meestal te laat"
      description="Mediaan van het aantal dagen dat over de vervaldatum heen wordt gegaan op facturen die in de afgelopen 12 maanden volledig zijn betaald (DSO na vervaldatum). Mediaan i.p.v. gemiddelde — robuuster tegen uitschieters."
      thresholds={[
        { score: 1, label: 'op tijd of eerder' },
        { score: 2, label: '1 – 7 dagen te laat' },
        { score: 3, label: '8 – 21 dagen te laat' },
        { score: 4, label: '22 – 45 dagen te laat' },
        { score: 5, label: '45+ dagen te laat' },
      ]}
      activeScore={score}
      current={`Mediaan ${days}d te laat over ${count} facturen betaald in de afgelopen 12 maanden → score ${score}`}
    />
  )
}

function tooltipTrend(
  score: number | null,
  tau: number,
  pValue: number,
  monthsObserved: number,
  confidence: Confidence,
): React.ReactNode {
  return (
    <ScoreTooltip
      title="Gaat het beter of slechter"
      description="Mann-Kendall trend-test op de maandelijkse DSO. Detecteert of de klant systematisch later (of juist eerder) is gaan betalen. Positieve τ = stijgende DSO = verslechterend."
      thresholds={[
        { score: 1, label: 'τ ≤ −0,4 (sterk verbeterend)' },
        { score: 2, label: '−0,4 < τ ≤ −0,2 (verbeterend)' },
        { score: 3, label: '−0,2 < τ < 0,2 (stabiel)' },
        { score: 4, label: '0,2 ≤ τ < 0,4 (verslechterend)' },
        { score: 5, label: 'τ ≥ 0,4 (sterk verslechterend)' },
      ]}
      activeScore={score}
      current={
        confidence === 'geen'
          ? `Te weinig data (${monthsObserved} maanden of geen significantie, p=${pValue}) → geen score`
          : `τ=${tau}, p=${pValue} over ${monthsObserved} maanden → score ${score}`
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

  return (
    <section className="border border-slate-200 rounded-md p-4">
      <h4 className="font-medium text-slate-900 mb-3">Debiteur-context</h4>
      <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
  score: number
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

function Detail({ task, showSources }: { task: Task; showSources: boolean }) {
  const calc = {
    impact: task.impact.score * WEIGHTS.impact,
    urgentie: task.urgentie.score * WEIGHTS.urgentie,
    risico: task.risico.score * WEIGHTS.risico,
    potentieel: task.potentieel.score * WEIGHTS.potentieel,
  }
  const total = calc.impact + calc.urgentie + calc.risico + calc.potentieel

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
            task.potentieel.werkelijke_dagen,
            task.potentieel.afgesproken_dagen,
          )}
        >
          <p className="text-slate-600">
            Deze klant betaalt normaal {task.potentieel.werkelijke_dagen} dagen na de factuurdatum.
            Afgesproken is {task.potentieel.afgesproken_dagen} dagen — dus{' '}
            <span className="font-medium text-slate-800">
              {task.potentieel.werkelijke_dagen - task.potentieel.afgesproken_dagen} dagen langer
            </span>{' '}
            dan de afspraak.
          </p>
          <PotentieelComparison
            afgesproken={task.potentieel.afgesproken_dagen}
            werkelijk={task.potentieel.werkelijke_dagen}
          />
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
                )}
                caption={`Mediaan: ${task.risico.betaalgedrag_breakdown.dso.median_days_late} dagen na de vervaldatum, op basis van ${task.risico.betaalgedrag_breakdown.dso.invoice_count} facturen betaald in de afgelopen 12 maanden.`}
                viz={
                  <DsoThermometer
                    days={task.risico.betaalgedrag_breakdown.dso.median_days_late}
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
                  task.risico.betaalgedrag_breakdown.trend.tau,
                  task.risico.betaalgedrag_breakdown.trend.p_value,
                  task.risico.betaalgedrag_breakdown.trend.months_observed,
                  task.risico.betaalgedrag_breakdown.trend.confidence,
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
          {task.risico.krediet !== null && (
            <MetricCard
              title="Kredietverzekering"
              score={task.risico.krediet}
            />
          )}
          {(task.risico.disputen === null || task.risico.krediet === null) && (
            <div className="border border-dashed border-slate-200 rounded-md p-4 text-xs text-slate-400 italic leading-relaxed">
              <p className="font-medium text-slate-500 not-italic mb-1">Niet beschikbaar in data</p>
              {task.risico.disputen === null && task.risico.krediet === null
                ? 'Disputen en kredietverzekering zitten niet in de aangeleverde Covebo-data. Die twee categorieën tellen daarom niet mee — de risico-score is genormaliseerd over de drie wél beschikbare sub-metrics.'
                : task.risico.disputen === null
                  ? 'Disputen zitten niet in de aangeleverde data.'
                  : 'Kredietverzekering zit niet in de aangeleverde data.'}
            </div>
          )}
        </div>
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
