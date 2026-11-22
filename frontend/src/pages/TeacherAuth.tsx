import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles } from 'lucide-react'
import { teacherApi, errText } from '../api'
import { useToast } from '../context/ToastContext'

export default function TeacherAuth() {
  const nav = useNavigate()
  const toast = useToast()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const res = mode === 'login'
        ? await teacherApi.login({ email, password: pass })
        : await teacherApi.register({ email, password: pass, full_name: name || 'Учитель' })
      localStorage.setItem('teacher_token', res.access_token)
      toast(`Добро пожаловать, ${res.full_name}!`)
      nav('/teacher')
    } catch (err) { toast(errText(err), 'err') } finally { setBusy(false) }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="glass rounded-2xl p-8 w-full max-w-md rise">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={20} className="text-[#4f7dff]" />
          <h1 className="text-3xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-[#4f7dff] to-[#8b5cf6]">EduDown Pro</h1>
        </div>
        <p className="text-[#93a9d1] mt-1 mb-6 text-sm">Уроки Python с живой AI-проверкой решений</p>
        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <input className="field" placeholder="ФИО" value={name} onChange={e => setName(e.target.value)} required />
          )}
          <input className="field" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
          <input className="field" type="password" placeholder="Пароль" value={pass} onChange={e => setPass(e.target.value)} required />
          <button className="neon w-full py-3 rounded-xl" disabled={busy}>
            {busy ? <Loader2 className="animate-spin inline" size={16} /> : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </form>
        <button className="w-full mt-3 text-sm text-[#93a9d1] hover:text-white" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
        </button>
      </div>
    </div>
  )
}