import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

type Push = (message: string) => void
const Ctx = createContext<Push>(() => undefined)

/** Short confirmations ("Link copied") that fade on their own. Announced politely to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; text: string }[]>([])
  const n = useRef(0)
  const push = useCallback<Push>((text) => {
    const id = ++n.current
    setItems((all) => [...all.slice(-2), { id, text }])
    setTimeout(() => setItems((all) => all.filter((t) => t.id !== id)), 3200)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts no-print" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
