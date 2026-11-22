import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, XCircle } from 'lucide-react'
import { studentAuthApi, errText } from '../api'
import { useToast } from '../context/ToastContext'

export default function AuthCallback() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const toast = useToast()
  const [err, setErr] = useState('')
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true
    const token = params.get('token') || params.get('access_token') || ''
    if (!token) { setErr('Токен не получен от Down ID'); return }
    studentAuthApi.downToken(token)
      .then(res => {
        localStorage.setItem('student_account', JSON.stringify(res))
        toast(`Привет, ${res.surname || res.login}!`)
        nav('/join?account=1', { replace: true })
      })
      .catch(e => setErr(errText(e)))
  }, [params, nav, toast])

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="glass rounded-2xl p-8 max-w-md text-center space-y-4 rise">
        {err ? (
          <>
            <XCircle className="mx-auto text-[#f43f5e]" size={36} />
            <p className="text-[#93a9d1]">{err}</p>
            <button className="neon px-4 py-2 rounded-xl" onClick={() => nav('/join')}>К входу</button>
          </>
        ) : (
          <>
            <Loader2 className="animate-spin mx-auto text-[#4f7dff]" size={32} />
            <p className="text-[#93a9d1]">Подтверждаем Down ID…</p>
          </>
        )}
      </div>
    </div>
  )
}