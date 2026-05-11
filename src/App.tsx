import { useState } from 'react'
import { tasks, TYPE_LABEL, EFFECT_LABEL, meta, type Task } from './data'

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

function TaskRow({ task, selected, onClick }: { task: Task; selected: boolean; onClick: () => void }) {
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
            <span className="text-xs text-slate-500 uppercase tracking-wide shrink-0">
              {TYPE_LABEL[task.type]}
            </span>
          </div>
          <p className="text-sm text-slate-700 mt-0.5 truncate">{task.taakomschrijving}</p>
          <p className="text-xs text-slate-500 mt-1 truncate">{task.aanleiding}</p>
        </div>
      </div>
    </button>
  )
}

function ComponentBlock({
  title,
  weight,
  score,
  children,
}: {
  title: string
  weight: number
  score: number
  children: React.ReactNode
}) {
  return (
    <section className="border border-slate-200 rounded-md p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h4 className="font-medium text-slate-900">
          {title}
          <span className="ml-2 text-xs text-slate-500 font-normal">weging {fmtNL(weight, 1)}</span>
        </h4>
        <div className="text-right">
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
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <header>
        <p className="text-xs text-slate-500 uppercase tracking-wide">{TYPE_LABEL[task.type]}</p>
        <h2 className="text-xl font-semibold text-slate-900 mt-1">{task.debiteur}</h2>
        <p className="text-slate-700 mt-1">{task.taakomschrijving}</p>
        <p className="text-sm text-slate-500 mt-2">{task.aanleiding}</p>
      </header>

      <div className={`rounded-md ring-1 p-4 ${priorityTone(task.priority)}`}>
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold tabular-nums">{fmtNL(task.priority, 2)}</span>
          <span className="text-sm">priority score (0–5)</span>
        </div>
      </div>

      <ComponentBlock title="Impact" weight={WEIGHTS.impact} score={task.impact.score}>
        {task.impact.bedrag !== undefined && (
          <p>
            <span className="text-slate-500">Bedrag: </span>
            {fmtEUR(task.impact.bedrag)}
            {task.impact.pct_van_ar !== undefined && (
              <> ({fmtNL(task.impact.pct_van_ar, 1)}% van openstaande AR)</>
            )}
          </p>
        )}
        <p>
          <span className="text-slate-500">Effect-type: </span>
          {EFFECT_LABEL[task.impact.effect_type]}
        </p>
        <ScoreRow label="Bedrag-score" score={task.impact.bedrag_score} />
        <ScoreRow label="Effect-score" score={task.impact.effect_score} max={2} />
        <p className="text-slate-600 pt-1">{task.impact.explanation}</p>
        {showSources && (
          <SourceLine>
            factuur.openstaand_bedrag (deze taak), SUM(factuur.openstaand_bedrag) over open AR,
            AI-effect-classificatie op taak.type + factuur-context
          </SourceLine>
        )}
      </ComponentBlock>

      <ComponentBlock title="Urgentie" weight={WEIGHTS.urgentie} score={task.urgentie.score}>
        <p className="text-slate-600">{task.urgentie.reden}</p>
        {showSources && (
          <SourceLine>
            factuur.vervaldatum, dispuut.datum_geopend, krediet_event.datum, taak.deadline
          </SourceLine>
        )}
      </ComponentBlock>

      <ComponentBlock title="Risico" weight={WEIGHTS.risico} score={task.risico.score}>
        <p className="text-slate-500 text-xs uppercase tracking-wide">Categoriescores debiteur</p>
        <ScoreRow
          label="Betaalgedrag"
          score={task.risico.betaalgedrag}
          source="betaling.betaaldatum vs factuur.vervaldatum (DSO), omzet_historie (AI trend/volatiliteit), betalingsregeling (wanbetaler)"
          showSource={showSources}
        />
        <ScoreRow
          label="Huidige stand"
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
            label="Krediet"
            score={task.risico.krediet}
            source="krediet_dekking.gedekt_bedrag, krediet_event, externe_score (genormaliseerd)"
            showSource={showSources}
          />
        )}
        {(task.risico.disputen === null || task.risico.krediet === null) && (
          <p className="text-xs text-slate-400 italic pt-1">
            {task.risico.disputen === null && task.risico.krediet === null
              ? 'Disputen + Krediet niet beschikbaar in brondata — wegingen genormaliseerd over resterende categorieën.'
              : task.risico.disputen === null
                ? 'Disputen niet beschikbaar in brondata.'
                : 'Krediet niet beschikbaar in brondata.'}
          </p>
        )}
        <ScoreRow
          label="Omzetconcentratie"
          score={task.risico.omzetconcentratie}
          source="omzet_historie.omzet (aandeel debiteur in totale AR-scope)"
          showSource={showSources}
        />
      </ComponentBlock>

      <ComponentBlock title="Potentieel" weight={WEIGHTS.potentieel} score={task.potentieel.score}>
        <p>
          <span className="text-slate-500">Werkelijk: </span>
          {task.potentieel.werkelijke_dagen}d
          <span className="text-slate-500"> · afgesproken: </span>
          {task.potentieel.afgesproken_dagen}d
          <span className="text-slate-500"> · verschil: </span>
          {task.potentieel.werkelijke_dagen - task.potentieel.afgesproken_dagen}d
        </p>
        <p className="text-slate-600">{task.potentieel.reden}</p>
        {showSources && (
          <SourceLine>
            standaard_betaaldag (afgeleid uit factuur + betaling) vs debiteur.standaard_betaaltermijn
          </SourceLine>
        )}
      </ComponentBlock>

      <section className="border-t border-slate-200 pt-4">
        <h4 className="font-medium text-slate-900 mb-2">Berekening</h4>
        <div className="font-mono text-sm text-slate-700 leading-relaxed bg-slate-50 rounded p-3 overflow-x-auto">
          <div>
            ({fmtNL(task.impact.score, task.impact.score % 1 === 0 ? 0 : 1)} × {fmtNL(WEIGHTS.impact, 1)}) +{' '}
            ({fmtNL(task.urgentie.score, 0)} × {fmtNL(WEIGHTS.urgentie, 1)}) +{' '}
            ({fmtNL(task.risico.score, task.risico.score % 1 === 0 ? 0 : 1)} × {fmtNL(WEIGHTS.risico, 1)}) +{' '}
            ({fmtNL(task.potentieel.score, 0)} × {fmtNL(WEIGHTS.potentieel, 1)})
          </div>
          <div className="text-slate-500">=</div>
          <div>
            {fmtNL(calc.impact, 2)} + {fmtNL(calc.urgentie, 2)} + {fmtNL(calc.risico, 2)} +{' '}
            {fmtNL(calc.potentieel, 2)}
          </div>
          <div className="text-slate-500">=</div>
          <div className="font-semibold">{fmtNL(total, 2)}</div>
        </div>
      </section>

      <section className="border-t border-slate-100 pt-4 text-slate-400">
        <h4 className="text-xs uppercase tracking-wide font-medium mb-2">
          Nog niet zichtbaar in deze view
        </h4>
        <ul className="text-xs space-y-1 leading-relaxed">
          <li>
            <span className="font-medium">Risico → Betaalgedrag → AI-trend</span> · score, label,
            confidence, explanation (verslechterend / stabiel / verbeterend)
          </li>
          <li>
            <span className="font-medium">Risico → Betaalgedrag → AI-volatiliteit</span> · score,
            label, confidence, explanation (regelmatig / onregelmatig / piek-patroon)
          </li>
          <li>
            <span className="font-medium">Risico → Betaalgedrag → AI-wanbetaler</span> · score,
            voorspelde dagen, type, confidence, explanation
          </li>
          <li>
            <span className="font-medium">Potentieel → Standaard betaaldag</span> · pattern_type
            (wekelijks / maandelijks / interval), pattern_value, confidence_label, data_points_used
          </li>
          <li>
            <span className="font-medium">Impact → Effect-classificatie</span> · confidence bij
            effect_type
          </li>
        </ul>
      </section>
    </div>
  )
}

export default function App() {
  const sorted = [...tasks].sort((a, b) => b.priority - a.priority)
  const [selectedId, setSelectedId] = useState<string>(sorted[0].id)
  const [showSources, setShowSources] = useState(false)
  const selected = sorted.find((t) => t.id === selectedId) ?? sorted[0]

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Mila</h1>
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
              Toon data-bronnen
            </label>
            <p className="text-sm text-slate-500 tabular-nums">
              top {sorted.length} van {meta.total_taken_gegenereerd} taken
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_28rem] gap-6">
          <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
            {sorted.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                selected={task.id === selectedId}
                onClick={() => setSelectedId(task.id)}
              />
            ))}
          </div>

          <aside className="bg-white rounded-md border border-slate-200 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-hidden">
            <Detail task={selected} showSources={showSources} />
          </aside>
        </div>
      </main>
    </div>
  )
}
