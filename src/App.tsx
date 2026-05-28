import { useEffect, useState } from 'react'
import { tasks } from './data'
import { useHashRoute } from './routing'
import { DetailView } from './detail/DetailView'
import { ListView } from './list/ListView'




















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
