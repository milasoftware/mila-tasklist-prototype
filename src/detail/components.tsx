import type React from 'react'
import type { Confidence } from '../data'
import { fmtNL } from './format'

export function Bar({ value, max = 5 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100
  return (
    <div className="h-1.5 w-full bg-slate-100 rounded">
      <div className="h-full bg-slate-700 rounded" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function ScoreRow({
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

export function SourceLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-slate-400 font-mono pt-2 mt-2 border-t border-slate-100">
      Bron: {children}
    </p>
  )
}

// Compacte cirkel-indicator voor een score van 0-max. Kleinere broer
// van PriorityRing — schaalbaar via de size prop. Met optionele
// hover-tooltip die de berekening uitlegt.
export function ScoreRing({
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
export function ScoreTooltip({
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
export function MetricCard({
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

export function ConfidencePill({ value }: { value: 'hoog' | 'middel' | 'geen' }) {
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

// Stat-cel met info-icoon dat een tooltip toont bij hover. Gebruikt
// hetzelfde group/group-hover-mechanisme als ScoreRing.
export function StatWithTooltip({
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

export function ComponentBlock({
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
