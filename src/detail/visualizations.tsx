import { useState } from 'react'
import { betalingen, meta, type Confidence } from '../data'
import { fmtEUR } from './format'

// Visuele weergave van de 5 bedrag-buckets met markering waar deze
// taak in valt. Toont per segment de bedragrange + aantal taken.
export function PercentilesBar({
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
export function DsoThermometer({ days, score }: { days: number; score: number }) {
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
export function TrendSparkline({
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
export function VolatilityDotStrip({ debiteurnummer }: { debiteurnummer: string }) {
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
export function UrgentieThermometer({ days, score }: { days: number; score: number }) {
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
export function PotentieelImpactBar({
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
export function HuidigeStandBar({
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
export function OmzetPercentilesBar({
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
export function KredietDekkingBar({
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
export function KredietImpactBar({
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
