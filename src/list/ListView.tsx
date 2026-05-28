import { useState } from 'react'
import type React from 'react'
import { meta, type Task } from '../data'
import { fmtDM, fmtNL, priorityTone } from '../detail/format'
import { standaardBetaaldagLabel } from '../detail/plain-language'
import { DataUploadButton } from './DataUploadButton'

export function TaskRow({ task, selected, onClick }: { task: Task; selected: boolean; onClick: () => void }) {
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

export function AppHeader({
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

export function ListView({
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
          <>
            <DataUploadButton />
            <p className="text-sm text-slate-500 tabular-nums">
              {q ? `${filtered.length} van ${sorted.length} taken` : `${sorted.length} taken`}
            </p>
          </>
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
