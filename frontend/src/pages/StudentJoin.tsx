import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, Key, Loader2, Sparkles, UserPlus, Users } from 'lucide-react'
import { studentApi, errText, type LessonsByCode } from '../api'
import { useToast } from '../context/ToastContext'

const DOWN_URL = 'https://imdown.pro'
type Step = 'type' | 'auth' | 'code' | 'lessons' | 'regular'

export default function StudentJoin() {
  const nav = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const [step, setStep] = useState<Step>('type')
  const [lessonType, setLessonType] = useState<'class' | 'regular'>('class')
  const [withAccount, setWithAccount] = useState(false)
  const [busy, setBusy] = useState(false)
  const [studentCode, setStudentCode] = useState('')
  const [byCode, setByCode] = useState<LessonsByCode | null>(null)
  const [accessCode, setAccessCode] = useState('')
  const [surname, setSurname] = useState(''); const [name, setName] = useState('')

  // вернулись с Down ID callback -> сразу к шагу кода/обычного урока
  useEffect(() => {
    if (params.get('account') && localStorage.getItem('student_account')) {
      setWithAccount(true)
      setStep(lessonType === 'class' ? 'code' : 'regular')
    }
  }, [params])

  const finish = (res: { session_token: string; lesson_title: string; student_display_name: string }) => {
    localStorage.setItem('student_token', res.session_token)
    localStorage.setItem('student_name', res.student_display_name)
    localStorage.setItem('student_lesson', res.lesson_title)
    toast(`Привет, ${res.student_display_name}!`)
    nav('/workspace')
  }

    const goDownId = () => {
    window.location.assign('https://imdown.pro/consent?service=edudown')
  }

  const loadByCode = async () => {
    if (!studentCode.trim()) { toast('Введи код ученика', 'err'); return }
    setBusy(true)
    try { setByCode(await studentApi.lessonsByCode(studentCode.trim().toUpperCase())); setStep('lessons') }
    catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }

  const joinLesson = async (code: string) => {
    setBusy(true)
    try { finish(await studentApi.joinClass({ access_code: code, student_code: studentCode.trim().toUpperCase() })) }
    catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }

  const joinRegular = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const acc = withAccount ? JSON.parse(localStorage.getItem('student_account') || 'null') : null
      finish(await studentApi.join({
        access_code: accessCode.trim().toUpperCase(),
        surname: acc?.surname ?? surname, name: acc?.name ?? name,
        account_id: acc?.id ?? null,
      }))
    } catch (err) { toast(errText(err), 'err') } finally { setBusy(false) }
  }

  const Back = ({ to }: { to: Step }) => (
    <button className="ghost w-full py-2 rounded-xl text-xs flex items-center justify-center gap-1" onClick={() => setStep(to)}>
      <ArrowLeft size={12} /> Назад
    </button>
  )

  if (step === 'type') return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="glass rounded-2xl p-8 w-full max-w-md rise space-y-4">
        <h2 className="text-2xl font-extrabold">Вход на урок</h2>
        <p className="text-sm text-[#93a9d1]">Какой у тебя урок?</p>
        <button className="ghost w-full py-4 rounded-xl text-sm flex items-center justify-center gap-2" onClick={() => { setLessonType('class'); setStep('auth') }}>
          <Users size={16} /> Урок от моего класса
        </button>
        <button className="ghost w-full py-4 rounded-xl text-sm flex items-center justify-center gap-2" onClick={() => { setLessonType('regular'); setStep('auth') }}>
          <BookOpen size={16} /> Обычный урок (по коду)
        </button>
        <button className="neon w-full py-3 rounded-xl text-sm flex items-center justify-center gap-2" onClick={() => nav('/practice')}>
          <Sparkles size={16} /> Тренировка (без урока)
        </button>
      </div>
    </div>
  )

  if (step === 'auth') return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="glass rounded-2xl p-8 w-full max-w-md rise space-y-4">
        <h2 className="text-2xl font-extrabold">Как войти?</h2>
        <p className="text-sm text-[#93a9d1]">{lessonType === 'class' ? 'Урок от класса' : 'Обычный урок'}</p>
        <button className="ghost w-full py-4 rounded-xl text-sm flex items-center justify-center gap-2" onClick={goDownId}>
          <UserPlus size={16} /> Через Down ID (imdown.pro)
        </button>
        <button className="neon w-full py-4 rounded-xl text-sm flex items-center justify-center gap-2"
          onClick={() => { setWithAccount(false); setStep(lessonType === 'class' ? 'code' : 'regular') }}>
          <Key size={16} /> Без аккаунта
        </button>
        <Back to="type" />
      </div>
    </div>
  )

  if (step === 'code') return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="glass rounded-2xl p-8 w-full max-w-md rise space-y-4">
        <h2 className="text-2xl font-extrabold">Твой код ученика</h2>
        <p className="text-sm text-[#93a9d1]">Код из 6 символов, который дал учитель</p>
        <input className="field text-center font-mono tracking-[.35em] uppercase text-lg" placeholder="КОД" maxLength={8}
          value={studentCode} onChange={e => setStudentCode(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && loadByCode()} autoFocus />
        <button className="neon w-full py-3 rounded-xl flex items-center justify-center gap-2" onClick={loadByCode} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" size={16} /> : <>Далее <ArrowRight size={16} /></>}
        </button>
        <Back to="auth" />
      </div>
    </div>
  )

  if (step === 'lessons' && byCode) return (
    <div className="rise space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold">Привет, {byCode.student.surname} {byCode.student.name}!</h2>
          <p className="text-sm text-[#93a9d1]">Класс {byCode.class_display} · выбери урок</p>
        </div>
        <button className="ghost px-3 py-2 rounded-xl text-xs flex items-center gap-1" onClick={() => setStep('code')}><ArrowLeft size={12} /> Другой код</button>
      </div>
      {byCode.lessons.length === 0 && <div className="glass rounded-2xl p-10 text-center text-[#93a9d1]">Сейчас нет активных уроков для твоего класса.</div>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {byCode.lessons.map(l => (
          <button key={l.id} onClick={() => joinLesson(l.access_code)} disabled={busy}
            className="glass card rounded-2xl p-5 flex flex-col gap-3 text-left hover:border-[#a3e635] transition">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold text-lg leading-tight">{l.title}</h3>
              <span className="badge badge-live">идёт</span>
            </div>
            <p className="text-sm text-[#93a9d1] line-clamp-2 min-h-[2.5rem]">{l.description || 'Без описания'}</p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#93a9d1]">
              <span className="flex items-center gap-1"><Users size={13} /> {l.class_display}</span>
              <span>👤 {l.teacher_name}</span>
              <span className="flex items-center gap-1"><BookOpen size={13} /> {l.task_count} задан.</span>
            </div>
            <div className="neon rounded-lg py-2 text-sm text-center mt-auto">Присоединиться →</div>
          </button>
        ))}
      </div>
    </div>
  )

  if (step === 'regular') {
    const acc = withAccount ? JSON.parse(localStorage.getItem('student_account') || 'null') : null
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="glass rounded-2xl p-8 w-full max-w-md rise">
          <h2 className="text-2xl font-extrabold mb-1">Обычный урок</h2>
          <p className="text-sm text-[#93a9d1] mb-6">Введи код урока от учителя</p>
          <form onSubmit={joinRegular} className="space-y-3">
            <input className="field text-center font-mono tracking-[.35em] uppercase text-lg" placeholder="КОД УРОКА" maxLength={8}
              value={accessCode} onChange={e => setAccessCode(e.target.value.toUpperCase())} required autoFocus />
            {acc ? (
              <div className="glass rounded-xl p-3 text-sm text-[#93a9d1]">Войдёшь как <span className="font-semibold">{acc.surname} {acc.name}</span></div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <input className="field" placeholder="Фамилия" value={surname} onChange={e => setSurname(e.target.value)} required />
                <input className="field" placeholder="Имя" value={name} onChange={e => setName(e.target.value)} required />
              </div>
            )}
            <button className="neon w-full py-3 rounded-xl" disabled={busy}>{busy ? <Loader2 className="animate-spin inline" size={16} /> : 'Войти на урок'}</button>
            <Back to="auth" />
          </form>
        </div>
      </div>
    )
  }
  return null
}