import { useCallback, useEffect, useState } from 'react'

// ----- Routing (hash-based, geen library) -----------------------------------

export type Route = { name: 'list' } | { name: 'detail'; taskId: string }

function parseHash(): Route {
  const hash = window.location.hash || '#/'
  const m = hash.match(/^#\/taak\/(.+)$/)
  if (m) return { name: 'detail', taskId: decodeURIComponent(m[1]) }
  return { name: 'list' }
}

export function useHashRoute(): [Route, (r: Route) => void] {
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
