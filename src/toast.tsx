import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

// Lightweight toast-pattern zonder externe dependencies.
//
// Drie redenen voor deze opzet:
// - Geen library nodig → minimale impact op bundle/setup voor een prototype.
// - Eén centrale provider → één z-index, één animatie-stack, geen mounting
//   in willekeurige components.
// - Imperatieve API via `useToast()` → past bij call-sites zoals
//   "ik wil hier een fout tonen" zonder state hoisting.

export type ToastVariant = 'info' | 'success' | 'warning' | 'error'

export type Toast = {
  id: string
  title?: string
  message: string
  variant: ToastVariant
  // Sticky toasts (typisch error) verdwijnen niet vanzelf — alleen via knop.
  sticky?: boolean
  // Optionele actie-knop (bv. "Reset dataset", "Bekijk console").
  action?: { label: string; onClick: () => void }
}

type ShowToastInput = Omit<Toast, 'id' | 'variant'> & { variant?: ToastVariant }

type ToastContextValue = {
  show: (toast: ShowToastInput & { variant: ToastVariant }) => string
  info: (message: string, opts?: Partial<ShowToastInput>) => string
  success: (message: string, opts?: Partial<ShowToastInput>) => string
  warning: (message: string, opts?: Partial<ShowToastInput>) => string
  error: (message: string, opts?: Partial<ShowToastInput>) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

// Standaard auto-dismiss-tijden per variant. Error & warning zijn standaard
// sticky — die wil je niet missen. Sticky kan per call worden overruled.
const DEFAULT_DURATION_MS: Record<ToastVariant, number> = {
  info: 5000,
  success: 4000,
  warning: 0,
  error: 0,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<string, number>())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const handle = timers.current.get(id)
    if (handle !== undefined) {
      window.clearTimeout(handle)
      timers.current.delete(id)
    }
  }, [])

  const show = useCallback<ToastContextValue['show']>(
    (input) => {
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const variant = input.variant
      const sticky = input.sticky ?? DEFAULT_DURATION_MS[variant] === 0
      const toast: Toast = {
        id,
        title: input.title,
        message: input.message,
        variant,
        sticky,
        action: input.action,
      }
      setToasts((prev) => [...prev, toast])
      if (!sticky) {
        const duration = DEFAULT_DURATION_MS[variant]
        const handle = window.setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id))
          timers.current.delete(id)
        }, duration)
        timers.current.set(id, handle)
      }
      return id
    },
    [],
  )

  // Cleanup pending timers bij unmount zodat we geen state-updates doen op
  // unmounted provider.
  useEffect(() => {
    const handles = timers.current
    return () => {
      for (const handle of handles.values()) window.clearTimeout(handle)
      handles.clear()
    }
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      info: (message, opts) => show({ ...opts, message, variant: 'info' }),
      success: (message, opts) => show({ ...opts, message, variant: 'success' }),
      warning: (message, opts) => show({ ...opts, message, variant: 'warning' }),
      error: (message, opts) => show({ ...opts, message, variant: 'error' }),
      dismiss,
    }),
    [show, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast moet binnen <ToastProvider> worden gebruikt.')
  }
  return ctx
}

// Visueel — fixed rechtsonder, max breedte, vertical stack.
function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-full max-w-sm pointer-events-none"
      role="region"
      aria-label="Meldingen"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  )
}

const VARIANT_STYLES: Record<ToastVariant, { container: string; accent: string; icon: string }> = {
  info: {
    container: 'bg-white border-slate-200 text-slate-800',
    accent: 'bg-sky-500',
    icon: 'text-sky-500',
  },
  success: {
    container: 'bg-white border-slate-200 text-slate-800',
    accent: 'bg-emerald-500',
    icon: 'text-emerald-500',
  },
  warning: {
    container: 'bg-white border-amber-200 text-slate-800',
    accent: 'bg-amber-500',
    icon: 'text-amber-500',
  },
  error: {
    container: 'bg-white border-red-200 text-slate-800',
    accent: 'bg-red-500',
    icon: 'text-red-500',
  },
}

const ICONS: Record<ToastVariant, string> = {
  info: 'i',
  success: '✓',
  warning: '!',
  error: '×',
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const styles = VARIANT_STYLES[toast.variant]
  return (
    <div
      role={toast.variant === 'error' || toast.variant === 'warning' ? 'alert' : 'status'}
      className={`pointer-events-auto flex items-start gap-3 overflow-hidden rounded-md border shadow-md ${styles.container}`}
    >
      <span className={`self-stretch w-1 ${styles.accent}`} aria-hidden />
      <span
        className={`flex-none mt-3 ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-50 text-xs font-semibold ${styles.icon}`}
        aria-hidden
      >
        {ICONS[toast.variant]}
      </span>
      <div className="flex-1 min-w-0 py-2.5 pr-2">
        {toast.title && (
          <p className="text-sm font-medium text-slate-900 leading-tight">{toast.title}</p>
        )}
        <p className="text-sm text-slate-600 leading-snug whitespace-pre-line break-words">
          {toast.message}
        </p>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick()
              onDismiss()
            }}
            className="mt-1.5 text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Sluiten"
        className="flex-none mt-1.5 mr-1.5 w-6 h-6 inline-flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <span aria-hidden>×</span>
      </button>
    </div>
  )
}
