import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { X } from 'lucide-react'

type Toast = { id: number; text: string; kind: 'ok' | 'err'; action?: { label: string; fn: () => void } }
type ToastFn = (text: string, kind?: 'ok' | 'err', action?: Toast['action']) => void

const ToastContext = createContext<ToastFn>(() => {})
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(0)
  const toast = useCallback<ToastFn>((text, kind = 'ok', action) => {
    const id = ++idRef.current
    setToasts(t => [...t, { id, text, kind, action }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), action ? 8000 : 4000)
  }, [])
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 left-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div key={t.id} className={`toastin glass rounded-xl px-4 py-3 text-sm flex items-center gap-3 border-l-4 ${t.kind === 'ok' ? 'border-l-[#a3e635]' : 'border-l-[#f43f5e]'}`}>
            <span className="flex-1">{t.text}</span>
            {t.action && <button className="ghost px-2 py-1 rounded-md text-xs" onClick={() => { t.action!.fn(); setToasts(x => x.filter(y => y.id !== t.id)) }}>{t.action.label}</button>}
            <button onClick={() => setToasts(x => x.filter(y => y.id !== t.id))}><X size={14} className="text-[#93a9d1]" /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}