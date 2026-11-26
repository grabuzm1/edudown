import { useCallback, useEffect, useState } from 'react'
import { Crown, Loader2 } from 'lucide-react'
import { subscriptionApi, errText } from '../api'
import { useToast } from '../context/ToastContext'

export default function PlusControl({ mode }: { mode: 'teacher' | 'student' }) {
  const toast = useToast()
  const [plus, setPlus] = useState(false)
  const [until, setUntil] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const accountId = mode === 'student' ? (JSON.parse(localStorage.getItem('student_account') || 'null')?.id ?? null) : null

  const load = useCallback(() => {
    subscriptionApi.me(accountId).then(r => { setPlus(r.plus); setUntil(r.until) }).catch(() => {})
  }, [accountId])
  useEffect(() => { load() }, [load])

  const activate = async () => {
    setBusy(true)
    try { await subscriptionApi.activate({ account_id: accountId }); toast('Плюс активирован на 30 дней'); load() }
    catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }

  if (plus) return (
    <span className="badge badge-live flex items-center gap-1 px-3 py-1.5 text-xs font-bold" title={until ? 'до ' + until.slice(0, 10) : ''}>
      <Crown size={13} /> Плюс
    </span>
  )
  return (
    <button className="ghost px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 !border-[rgba(251,191,36,.5)] !text-[#fbbf24]" onClick={activate} disabled={busy}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Crown size={13} />} Активировать Плюс
    </button>
  )
}