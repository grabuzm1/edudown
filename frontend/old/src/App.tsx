import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import {
  BookOpen, Play, Send, LogOut, Loader2, CheckCircle2, XCircle, Terminal, Plus, Search,
  Copy, Trash2, Pencil, ChevronUp, ChevronDown, Download, X, GraduationCap, Sparkles, RotateCcw, Users,
} from 'lucide-react'
import { teacherApi, studentApi, errText, type Lesson, type Task, type AIReview, type StudentRow } from './api'

type View = 'teacher-login' | 'teacher' | 'student-join' | 'student'
type Toast = { id: number; text: string; kind: 'ok' | 'err'; action?: { label: string; fn: () => void } }

const DEMO = { email: 'demo@edudown.pro', password: 'demo1234' }

export default function App() {
  const [view, setView] = useState<View>((localStorage.getItem('edu_view') as View) || 'teacher-login')
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok', action?: Toast['action']) => {
    const id = ++toastId.current
    setToasts(t => [...t, { id, text, kind, action }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), action ? 8000 : 4000)
  }, [])

  useEffect(() => { localStorage.setItem('edu_view', view) }, [view])

  return (
    <div className="min-h-screen">
      <div className="aurora" /><div className="grain" />
      <header className="fixed top-0 inset-x-0 z-40 glass border-x-0 border-t-0">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => setView(localStorage.getItem('teacher_token') ? 'teacher' : 'teacher-login')}
            className="flex items-center gap-2 font-extrabold tracking-tight text-lg">
            <Sparkles size={18} className="text-[#4f7dff]" />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#4f7dff] to-[#8b5cf6]">EduDown</span>
            <span className="text-[#93a9d1] font-medium text-sm hidden sm:inline">pro</span>
          </button>
          <nav className="flex items-center gap-2">
            <button onClick={() => setView(localStorage.getItem('teacher_token') ? 'teacher' : 'teacher-login')}
              className={`ghost px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${view.startsWith('teacher') ? '!bg-[rgba(79,125,255,.28)] !text-white' : ''}`}>
              <BookOpen size={14} /> Учитель
            </button>
            <button onClick={() => setView(localStorage.getItem('student_token') ? 'student' : 'student-join')}
              className={`ghost px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${view.startsWith('student') ? '!bg-[rgba(79,125,255,.28)] !text-white' : ''}`}>
              <GraduationCap size={14} /> Ученик
            </button>
          </nav>
        </div>
      </header>

      <main className="pt-20 pb-16 px-4 max-w-7xl mx-auto">
        {view === 'teacher-login' && <TeacherLogin onIn={() => setView('teacher')} toast={toast} />}
        {view === 'teacher' && <TeacherDash toast={toast} onOut={() => setView('teacher-login')} />}
        {view === 'student-join' && <StudentJoin onIn={() => setView('student')} toast={toast} />}
        {view === 'student' && <Workspace toast={toast} onExit={() => setView('student-join')} />}
      </main>

      <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div key={t.id} className={`toastin glass rounded-xl px-4 py-3 text-sm flex items-center gap-3 border-l-4 ${t.kind === 'ok' ? 'border-l-[#a3e635]' : 'border-l-[#f43f5e]'}`}>
            <span className="flex-1">{t.text}</span>
            {t.action && <button className="ghost px-2 py-1 rounded-md text-xs" onClick={() => { t.action!.fn(); setToasts(x => x.filter(y => y.id !== t.id)) }}>{t.action.label}</button>}
            <button onClick={() => setToasts(x => x.filter(y => y.id !== t.id))}><X size={14} className="text-[#93a9d1]" /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────── ВХОД УЧИТЕЛЯ ───────────────────────── */
function TeacherLogin({ onIn, toast }: { onIn: () => void; toast: (t: string, k?: 'ok' | 'err') => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState(''); const [pass, setPass] = useState(''); const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const res = mode === 'login'
        ? await teacherApi.login({ email, password: pass })
        : await teacherApi.register({ email, password: pass, full_name: name || 'Учитель' })
      localStorage.setItem('teacher_token', res.access_token)
      toast(`Добро пожаловать, ${res.full_name}!`)
      onIn()
    } catch (err) { toast(errText(err), 'err') } finally { setBusy(false) }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="glass rounded-2xl p-8 w-full max-w-md rise">
        <h1 className="text-3xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-[#4f7dff] to-[#8b5cf6]">EduDown Pro</h1>
        <p className="text-[#93a9d1] mt-1 mb-6 text-sm">Уроки Python с живой AI-проверкой решений</p>
        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && <input className="field" placeholder="ФИО" value={name} onChange={e => setName(e.target.value)} required />}
          <input className="field" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
          <input className="field" type="password" placeholder="Пароль" value={pass} onChange={e => setPass(e.target.value)} required />
          <button className="neon w-full py-3 rounded-xl" disabled={busy}>
            {busy ? <Loader2 className="animate-spin inline" size={16} /> : mode === 'login' ? 'Войти в систему' : 'Создать аккаунт'}
          </button>
        </form>
        <button className="w-full mt-3 text-sm text-[#93a9d1] hover:text-white" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
        </button>
        <button className="w-full mt-4 ghost rounded-xl py-2 text-xs" onClick={() => { setMode('login'); setEmail(DEMO.email); setPass(DEMO.password) }}>
          Демо-доступ: {DEMO.email} / {DEMO.password}
        </button>
      </div>
    </div>
  )
}

/* ───────────────────────── ПАНЕЛЬ УЧИТЕЛЯ ───────────────────────── */
function TeacherDash({ toast, onOut }: { toast: (t: string, k?: 'ok' | 'err', a?: Toast['action']) => void; onOut: () => void }) {
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [q, setQ] = useState(''); const [sort, setSort] = useState<'new' | 'title' | 'students'>('new')
  const [filter, setFilter] = useState<'all' | 'live' | 'draft'>('all')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [me, setMe] = useState('')

  const load = useCallback(async () => {
    try { setLessons(await teacherApi.lessons()) } catch (e) { toast(errText(e), 'err') }
  }, [toast])

  useEffect(() => { load(); teacherApi.me().then(m => setMe(m.full_name)).catch(() => {}) }, [load])

  const visible = lessons
    .filter(l => (filter === 'all' || (filter === 'live' ? l.is_published : !l.is_published)) &&
      (l.title + l.description + l.access_code).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'students' ? b.student_count - a.student_count : (b.created_at || '').localeCompare(a.created_at || ''))

  const create = async () => {
    if (!title.trim()) return
    try {
      const l = await teacherApi.createLesson({ title: title.trim(), description: desc })
      setLessons(x => [l, ...x]); setCreating(false); setTitle(''); setDesc('')
      toast('Урок создан'); setOpenId(l.id)
    } catch (e) { toast(errText(e), 'err') }
  }

  const togglePublish = async (l: Lesson) => {
    setLessons(x => x.map(y => y.id === l.id ? { ...y, is_published: !l.is_published } : y))
    try { await teacherApi.publish(l.id, !l.is_published); toast(l.is_published ? 'Урок скрыт' : 'Урок опубликован') }
    catch (e) { toast(errText(e), 'err'); load() }
  }

  const remove = async (l: Lesson) => {
    const snapshot = await teacherApi.lesson(l.id).catch(() => null)
    setLessons(x => x.filter(y => y.id !== l.id))
    try {
      await teacherApi.deleteLesson(l.id)
      toast(`Урок «${l.title}» удалён`, 'ok', {
        label: 'Вернуть', fn: async () => {
          try {
            const nl = await teacherApi.createLesson({ title: l.title, description: l.description })
            for (const t of snapshot?.tasks ?? []) await teacherApi.createTask(nl.id, { title: t.title, description: t.description, starter_code: t.starter_code, ai_criteria: t.ai_criteria, order_index: t.order_index })
            if (l.is_published) await teacherApi.publish(nl.id, true)
            load(); toast('Урок восстановлен')
          } catch (e) { toast(errText(e), 'err') }
        },
      })
    } catch (e) { toast(errText(e), 'err'); load() }
  }

  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(code); toast('Код скопирован') } catch { toast(code, 'ok') }
  }

  const exportZip = async (l: Lesson) => {
    try {
      const blob = await teacherApi.exportZip(l.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${l.access_code}_solutions.zip`; a.click()
      URL.revokeObjectURL(url); toast('ZIP выгружен')
    } catch (e) { toast(errText(e), 'err') }
  }

  return (
    <div className="space-y-6 rise">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold">Мои уроки</h2>
          <p className="text-sm text-[#93a9d1]">{me && `${me} · `}{lessons.length} уроков · {lessons.reduce((s, l) => s + l.student_count, 0)} учеников</p>
        </div>
        <div className="flex gap-2">
          <button className="neon px-4 py-2 rounded-xl flex items-center gap-2" onClick={() => setCreating(true)}><Plus size={16} /> Создать урок</button>
          <button className="ghost px-3 py-2 rounded-xl" onClick={() => { localStorage.removeItem('teacher_token'); onOut() }}><LogOut size={16} /></button>
        </div>
      </div>

      <div className="glass rounded-xl p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5b6c92]" />
          <input className="field !pl-9" placeholder="Поиск по названию, описанию, коду…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select className="field !w-auto" value={filter} onChange={e => setFilter(e.target.value as any)}>
          <option value="all">Все</option><option value="live">Опубликованные</option><option value="draft">Черновики</option>
        </select>
        <select className="field !w-auto" value={sort} onChange={e => setSort(e.target.value as any)}>
          <option value="new">Сначала новые</option><option value="title">По названию</option><option value="students">По ученикам</option>
        </select>
      </div>

      {visible.length === 0 && <div className="glass rounded-2xl p-10 text-center text-[#93a9d1]">Ничего не найдено. Создай первый урок кнопкой выше.</div>}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visible.map(l => (
          <div key={l.id} className="glass card rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold text-lg leading-tight">{l.title}</h3>
              <span className={`badge ${l.is_published ? 'badge-live' : 'badge-draft'}`}>{l.is_published ? 'live' : 'draft'}</span>
            </div>
            <p className="text-sm text-[#93a9d1] line-clamp-2 min-h-[2.5rem]">{l.description || 'Без описания'}</p>
            <div className="flex items-center gap-3 text-xs text-[#93a9d1]">
              <span className="flex items-center gap-1"><BookOpen size={13} /> {l.task_count} задан.</span>
              <span className="flex items-center gap-1"><Users size={13} /> {l.student_count} учеников</span>
            </div>
            <button onClick={() => copy(l.access_code)} className="flex items-center justify-between bg-[#070b18] border border-[#233052] rounded-lg px-3 py-2 font-mono text-sm hover:border-[#4f7dff] transition">
              <span className="tracking-[.25em] text-[#a3e635]">{l.access_code}</span><Copy size={14} className="text-[#93a9d1]" />
            </button>
            <div className="flex gap-2 mt-auto">
              <button className="ghost flex-1 py-2 rounded-lg text-sm" onClick={() => setOpenId(l.id)}>Открыть</button>
              <button className="ghost px-3 py-2 rounded-lg text-sm" onClick={() => togglePublish(l)}>{l.is_published ? 'Скрыть' : 'Публиковать'}</button>
              <button className="ghost px-3 py-2 rounded-lg" onClick={() => exportZip(l)} title="ZIP решений"><Download size={15} /></button>
              <button className="ghost px-3 py-2 rounded-lg !border-[rgba(244,63,94,.4)] !text-[#f43f5e]" onClick={() => remove(l)}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>

      {creating && (
        <Modal onClose={() => setCreating(false)} title="Новый урок">
          <div className="space-y-3">
            <input className="field" placeholder="Название урока" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
            <textarea className="field min-h-[90px]" placeholder="Описание для учеников" value={desc} onChange={e => setDesc(e.target.value)} />
            <button className="neon w-full py-2.5 rounded-xl" onClick={create}>Создать и открыть</button>
          </div>
        </Modal>
      )}

      {openId && <LessonDrawer id={openId} onClose={() => { setOpenId(null); load() }} toast={toast} />}
    </div>
  )
}

/* ───────────────────────── ДОСКА УРОКА ───────────────────────── */
function LessonDrawer({ id, onClose, toast }: { id: string; onClose: () => void; toast: (t: string, k?: 'ok' | 'err', a?: Toast['action']) => void }) {
  const [l, setL] = useState<Lesson | null>(null)
  const [tab, setTab] = useState<'tasks' | 'students'>('tasks')
  const [editing, setEditing] = useState<Task | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => { try { setL(await teacherApi.lesson(id)) } catch (e) { toast(errText(e), 'err') } }, [id, toast])
  useEffect(() => { load() }, [load])

  const saveLesson = async () => {
    if (!l) return
    try { await teacherApi.patchLesson(l.id, { title: l.title, description: l.description }); toast('Урок сохранён') } catch (e) { toast(errText(e), 'err') }
  }

  const move = async (t: Task, dir: -1 | 1) => {
    if (!l?.tasks) return
    const i = l.tasks.findIndex(x => x.id === t.id); const j = i + dir
    if (j < 0 || j >= l.tasks.length) return
    const other = l.tasks[j]
    try {
      await teacherApi.patchTask(t.id, { order_index: other.order_index })
      await teacherApi.patchTask(other.id, { order_index: t.order_index })
      load()
    } catch (e) { toast(errText(e), 'err') }
  }

  const delTask = async (t: Task) => {
    try {
      await teacherApi.deleteTask(t.id); load()
      toast('Задание удалено', 'ok', { label: 'Вернуть', fn: async () => { await teacherApi.createTask(id, { title: t.title, description: t.description, starter_code: t.starter_code, ai_criteria: t.ai_criteria, order_index: t.order_index }); load() } })
    } catch (e) { toast(errText(e), 'err') }
  }

  const saveGrade = async (s: StudentRow, score: number) => {
    try { await teacherApi.grade(s.session_id, score, s.teacher_comment); toast('Оценка сохранена'); load() } catch (e) { toast(errText(e), 'err') }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="slidein glass h-full w-full max-w-2xl border-y-0 border-r-0 overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        {!l ? <Loader2 className="animate-spin mx-auto mt-20" /> : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-2">
                <input className="field font-bold text-lg" value={l.title} onChange={e => setL({ ...l, title: e.target.value })} />
                <textarea className="field text-sm" value={l.description} onChange={e => setL({ ...l, description: e.target.value })} />
                <div className="flex gap-2 items-center">
                  <button className="ghost px-3 py-1.5 rounded-lg text-sm" onClick={saveLesson}>Сохранить</button>
                  <span className="font-mono text-[#a3e635] tracking-[.2em] text-sm">{l.access_code}</span>
                  <span className={`badge ${l.is_published ? 'badge-live' : 'badge-draft'}`}>{l.is_published ? 'live' : 'draft'}</span>
                </div>
              </div>
              <button className="ghost p-2 rounded-lg" onClick={onClose}><X size={16} /></button>
            </div>

            <div className="flex gap-2">
              <button className={`ghost px-4 py-2 rounded-lg text-sm ${tab === 'tasks' ? '!bg-[rgba(79,125,255,.28)] !text-white' : ''}`} onClick={() => setTab('tasks')}>Задания ({l.tasks?.length ?? 0})</button>
              <button className={`ghost px-4 py-2 rounded-lg text-sm ${tab === 'students' ? '!bg-[rgba(79,125,255,.28)] !text-white' : ''}`} onClick={() => setTab('students')}>Ученики ({l.students?.length ?? 0})</button>
              <div className="flex-1" />
              {tab === 'tasks' && <button className="neon px-3 py-2 rounded-lg text-sm flex items-center gap-1" onClick={() => setAdding(true)}><Plus size={14} /> Задание</button>}
            </div>

            {tab === 'tasks' && (
              <div className="space-y-3">
                {(l.tasks ?? []).length === 0 && <p className="text-[#93a9d1] text-sm glass rounded-xl p-4">Пока нет заданий — добавь первое, иначе ученики увидят пустой урок.</p>}
                {(l.tasks ?? []).map((t, i) => (
                  <div key={t.id} className="glass rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[#4f7dff]">#{i + 1}</span>
                      <span className="font-semibold flex-1">{t.title}</span>
                      <button className="ghost p-1.5 rounded" disabled={i === 0} onClick={() => move(t, -1)}><ChevronUp size={14} /></button>
                      <button className="ghost p-1.5 rounded" disabled={i === (l.tasks!.length - 1)} onClick={() => move(t, 1)}><ChevronDown size={14} /></button>
                      <button className="ghost p-1.5 rounded" onClick={() => setEditing(t)}><Pencil size={14} /></button>
                      <button className="ghost p-1.5 rounded !text-[#f43f5e]" onClick={() => delTask(t)}><Trash2 size={14} /></button>
                    </div>
                    <p className="text-sm text-[#93a9d1] whitespace-pre-wrap">{t.description}</p>
                    {t.ai_criteria && <p className="text-xs text-[#fbbf24]">Критерий AI: {t.ai_criteria}</p>}
                  </div>
                ))}
              </div>
            )}

            {tab === 'students' && (
              <div className="space-y-3">
                {(l.students ?? []).length === 0 && <p className="text-[#93a9d1] text-sm glass rounded-xl p-4">Ещё никто не вошёл. Опубликуй урок и передай код {l.access_code}.</p>}
                {(l.students ?? []).map(s => (
                  <div key={s.session_id} className="glass rounded-xl p-4 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[140px]">
                      <div className="font-semibold">{s.display_name} {s.is_completed && <CheckCircle2 size={14} className="inline text-[#a3e635]" />}</div>
                      <div className="text-xs text-[#93a9d1]">{s.group || 'без группы'} · задание {Math.min(s.current_task_index + 1, l.task_count)} из {l.task_count}</div>
                    </div>
                    <div className="text-xs text-[#93a9d1]">AI: <span className="text-[#4f7dff] font-bold">{s.ai_score ?? '—'}</span></div>
                    <input type="number" min={0} max={100} defaultValue={s.teacher_score ?? s.ai_score ?? 0}
                      className="field !w-20 !py-1.5 text-center" id={`g-${s.session_id}`} />
                    <button className="ghost px-3 py-1.5 rounded-lg text-xs" onClick={() => saveGrade(s, Number((document.getElementById(`g-${s.session_id}`) as HTMLInputElement).value))}>Оценить</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {(adding || editing) && (
          <TaskModal lessonId={id} task={editing} onClose={() => { setAdding(false); setEditing(null) }} onSaved={() => { setAdding(false); setEditing(null); load() }} toast={toast} />
        )}
      </div>
    </div>
  )
}

function TaskModal({ lessonId, task, onClose, onSaved, toast }: { lessonId: string; task: Task | null; onClose: () => void; onSaved: () => void; toast: (t: string, k?: 'ok' | 'err') => void }) {
  const [f, setF] = useState({ title: task?.title ?? '', description: task?.description ?? '', starter_code: task?.starter_code ?? '', ai_criteria: task?.ai_criteria ?? '' })
  const save = async () => {
    if (!f.title.trim()) { toast('Нужно название задания', 'err'); return }
    try {
      if (task) await teacherApi.patchTask(task.id, f)
      else await teacherApi.createTask(lessonId, { ...f, order_index: 99 })
      toast(task ? 'Задание обновлено' : 'Задание добавлено'); onSaved()
    } catch (e) { toast(errText(e), 'err') }
  }
  return (
    <Modal onClose={onClose} title={task ? 'Редактировать задание' : 'Новое задание'}>
      <div className="space-y-3">
        <input className="field" placeholder="Название" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} autoFocus />
        <textarea className="field min-h-[80px]" placeholder="Текст задания для ученика" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
        <textarea className="field font-mono text-sm min-h-[70px]" placeholder="Стартовый код (необязательно)" value={f.starter_code} onChange={e => setF({ ...f, starter_code: e.target.value })} />
        <textarea className="field min-h-[60px]" placeholder="Критерии проверки для AI (что считается верным)" value={f.ai_criteria} onChange={e => setF({ ...f, ai_criteria: e.target.value })} />
        <button className="neon w-full py-2.5 rounded-xl" onClick={save}>Сохранить задание</button>
      </div>
    </Modal>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="pop glass rounded-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">{title}</h3>
          <button className="ghost p-2 rounded-lg" onClick={onClose}><X size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ───────────────────────── ВХОД УЧЕНИКА ───────────────────────── */
function StudentJoin({ onIn, toast }: { onIn: () => void; toast: (t: string, k?: 'ok' | 'err') => void }) {
  const [code, setCode] = useState(''); const [surname, setSurname] = useState(''); const [name, setName] = useState(''); const [group, setGroup] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      const res = await studentApi.join({ access_code: code.trim().toUpperCase(), surname, name, group })
      localStorage.setItem('student_token', res.session_token)
      localStorage.setItem('student_name', res.student_display_name)
      localStorage.setItem('student_lesson', res.lesson_title || 'Урок')
      toast(`Привет, ${res.student_display_name}! Урок: ${res.lesson_title || 'Урок'}`)
      onIn()
    } catch (err) { toast(errText(err), 'err') } finally { setBusy(false) }
  }
  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="glass rounded-2xl p-8 w-full max-w-md rise">
        <h2 className="text-2xl font-extrabold mb-1">Вход на урок</h2>
        <p className="text-sm text-[#93a9d1] mb-6">Введи код, который дал учитель</p>
        <form onSubmit={submit} className="space-y-3">
          <input className="field text-center font-mono tracking-[.35em] uppercase text-lg" placeholder="КОД" maxLength={8} value={code} onChange={e => setCode(e.target.value.toUpperCase())} required />
          <div className="grid grid-cols-2 gap-3">
            <input className="field" placeholder="Фамилия" value={surname} onChange={e => setSurname(e.target.value)} required />
            <input className="field" placeholder="Имя" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <input className="field" placeholder="Класс / группа (необязательно)" value={group} onChange={e => setGroup(e.target.value)} />
          <button className="neon w-full py-3 rounded-xl" disabled={busy}>{busy ? <Loader2 className="animate-spin inline" size={16} /> : 'Начать обучение'}</button>
        </form>
      </div>
    </div>
  )
}

/* ───────────────────────── РАБОЧЕЕ МЕСТО УЧЕНИКА ───────────────────────── */
function Workspace({ toast, onExit }: { toast: (t: string, k?: 'ok' | 'err') => void; onExit: () => void }) {
  const token = localStorage.getItem('student_token') || ''
  const [task, setTask] = useState<Task | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [code, setCode] = useState('')
  const [out, setOut] = useState<{ stdout: string; stderr: string; ms?: number }>({ stdout: '', stderr: '' })
  const [review, setReview] = useState<AIReview | null>(null)
  const [busy, setBusy] = useState<'run' | 'submit' | null>(null)
  const [fontSize, setFontSize] = useState(14)
  const poll = useRef<number | null>(null)
  const advance = useRef<number | null>(null)

  const stopPoll = () => { if (poll.current) { window.clearInterval(poll.current); poll.current = null } }
  const stopAdvance = () => { if (advance.current) { window.clearTimeout(advance.current); advance.current = null } }
  useEffect(() => () => { stopPoll(); stopAdvance() }, [])

  const loadTask = useCallback(async () => {
    if (!token) { onExit(); return }
    setLoadErr(''); stopAdvance()
    try {
      const t = await studentApi.currentTask(token)
      setTask(t); setCode(t.starter_code || '# Пиши решение здесь\n'); setReview(null); setOut({ stdout: '', stderr: '' })
    } catch (e: any) {
      setLoadErr(errText(e))
      if (e?.status === 401) { localStorage.removeItem('student_token'); onExit() }
    }
  }, [token, onExit])

  useEffect(() => { loadTask() }, [loadTask])

  const run = async () => {
    setBusy('run')
    try { const r = await studentApi.execute(code, token); setOut({ stdout: r.stdout, stderr: r.stderr, ms: r.execution_time_ms }) }
    catch (e) { toast(errText(e), 'err') } finally { setBusy(null) }
  }

  const submit = async () => {
    setBusy('submit'); setReview(null); stopPoll(); stopAdvance()
    try {
      const r = await studentApi.submit(code, token)
      let tries = 0
      poll.current = window.setInterval(async () => {
        tries++
        try {
          const s = await studentApi.submission(r.submission_id, token)
          if (s.status === 'completed' && s.review) {
            stopPoll(); setReview(s.review); setBusy(null)
            setOut({ stdout: s.stdout, stderr: s.stderr, ms: s.execution_time_ms })
            if (s.review.is_correct) {
              toast('Задание принято! +' + s.review.score + ' баллов')
              advance.current = window.setTimeout(() => loadTask(), 2600)
            }
          } else if (tries > 20) { stopPoll(); setBusy(null); toast('Проверка затянулась, обнови страницу', 'err') }
        } catch { stopPoll(); setBusy(null) }
      }, 1200)
    } catch (e) { toast(errText(e), 'err'); setBusy(null) }
  }

  if (!token) return null
  if (loadErr) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="glass rounded-2xl p-8 max-w-md text-center space-y-4 rise">
        <XCircle className="mx-auto text-[#f43f5e]" size={36} />
        <p className="text-[#93a9d1]">{loadErr}</p>
        <div className="flex gap-2 justify-center">
          <button className="ghost px-4 py-2 rounded-xl" onClick={loadTask}><RotateCcw size={14} className="inline mr-1" /> Повторить</button>
          <button className="neon px-4 py-2 rounded-xl" onClick={onExit}>К входу</button>
        </div>
      </div>
    </div>
  )
  if (!task) return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="animate-spin text-[#4f7dff]" size={32} /></div>

  const done = !!task.completed
  return (
    <div className="rise space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <div className="text-xs text-[#93a9d1]">{localStorage.getItem('student_lesson')} · {localStorage.getItem('student_name')}</div>
          <h2 className="text-xl font-extrabold">{task.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {Array.from({ length: task.total_tasks ?? 1 }).map((_, i) => (
            <span key={i} className={`dot ${done || i < (task.index ?? 0) ? 'done' : i === (task.index ?? 0) ? 'now' : ''}`} />
          ))}
          <button className="ghost px-3 py-1.5 rounded-lg text-xs ml-2" onClick={() => { localStorage.removeItem('student_token'); onExit() }}>Выйти</button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[340px_1fr] gap-4">
        <div className="glass rounded-2xl p-5 space-y-4 h-fit lg:sticky lg:top-20">
          <div className="text-xs font-mono text-[#4f7dff]">ЗАДАНИЕ {(task.index ?? 0) + 1} / {task.total_tasks}</div>
          <p className="text-sm whitespace-pre-wrap leading-relaxed text-[#dbe6ff]">{task.description}</p>
          {review && !done && (
            <div className={`rounded-xl p-4 border ${review.is_correct ? 'border-[rgba(163,230,53,.4)] bg-[rgba(163,230,53,.08)] pulseglow' : 'border-[rgba(244,63,94,.4)] bg-[rgba(244,63,94,.08)]'}`}>
              <div className="flex items-center gap-2 font-bold mb-1">
                {review.is_correct ? <CheckCircle2 size={18} className="text-[#a3e635]" /> : <XCircle size={18} className="text-[#f43f5e]" />}
                {review.is_correct ? `Принято · ${review.score}/100` : 'Нужно доработать'}
              </div>
              <p className="text-sm text-[#dbe6ff]">{review.feedback}</p>
              {review.is_correct && <button className="neon w-full mt-3 py-2 rounded-lg text-sm" onClick={loadTask}>Следующее задание →</button>}
            </div>
          )}
          {done && (
            <div className="rounded-xl p-4 border border-[rgba(163,230,53,.5)] bg-[rgba(163,230,53,.1)] text-center pulseglow">
              <div className="text-2xl mb-1">🏆</div>
              <div className="font-bold text-[#a3e635]">Урок завершён!</div>
              <p className="text-xs text-[#93a9d1] mt-1">Все задания приняты. Учитель видит твой результат.</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <div className="glass rounded-2xl overflow-hidden flex flex-col" style={{ height: '52vh' }}>
            <div className="flex items-center gap-2 px-3 py-2 bg-[#070b18] border-b border-[#233052]">
              <span className="font-mono text-xs text-[#93a9d1] flex-1">solution.py</span>
              <button className="ghost px-2 py-1 rounded text-xs" onClick={() => setFontSize(f => Math.max(11, f - 1))}>A−</button>
              <span className="text-xs font-mono text-[#93a9d1]">{fontSize}px</span>
              <button className="ghost px-2 py-1 rounded text-xs" onClick={() => setFontSize(f => Math.min(22, f + 1))}>A+</button>
              <button className="ghost px-2 py-1 rounded text-xs" onClick={() => setCode(task.starter_code || '')}><RotateCcw size={12} /></button>
              <button className="ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1" onClick={run} disabled={busy !== null}>
                {busy === 'run' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Запустить
              </button>
              <button className="neon px-3 py-1.5 rounded-lg text-xs flex items-center gap-1" onClick={submit} disabled={busy !== null || done}>
                {busy === 'submit' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} На проверку
              </button>
            </div>
            <div className="flex-1">
              <Editor height="100%" language="python" theme="vs-dark" value={code} onChange={v => setCode(v ?? '')}
                options={{ minimap: { enabled: false }, fontSize, scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 12 }, fontLigatures: true }} />
            </div>
          </div>

          <div className="glass rounded-2xl p-4 font-mono text-sm h-44 overflow-y-auto bg-[#070b18]">
            <div className="flex items-center gap-2 text-[#5b6c92] text-xs uppercase tracking-widest mb-2">
              <Terminal size={13} /> Консоль {out.ms !== undefined && <span className="ml-auto normal-case">{out.ms} мс</span>}
            </div>
            {out.stdout && <pre className="text-[#a3e635] whitespace-pre-wrap">{out.stdout}</pre>}
            {out.stderr && <pre className="text-[#f43f5e] whitespace-pre-wrap">{out.stderr}</pre>}
            {!out.stdout && !out.stderr && <span className="text-[#5b6c92] italic">Нажми «Запустить», чтобы увидеть вывод…</span>}
          </div>
        </div>
      </div>
    </div>
  )
}