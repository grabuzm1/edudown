import { useCallback, useEffect, useState } from 'react'
import { Sparkles, X, Loader2, Wand2, Plus, CheckCircle2, AlertTriangle, RefreshCw, FlaskConical, XCircle } from 'lucide-react'

type Draft = { title: string; description: string; starter_code: string; ai_criteria: string; include: boolean }
type Lesson = { id: string; title: string; access_code: string; task_count: number }
type TaskRow = { id: string; title: string }
type Status = { configured: boolean; ok: boolean; provider: string | null; model: string | null; error: string | null; key_hint: string }
type Verdict = { is_correct: boolean; score: number; feedback: string; reasoning: string }

const token = () => localStorage.getItem('teacher_token') || ''
async function req(path: string, method = 'GET', body?: any) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: body ? JSON.stringify(body) : undefined })
  const d = await r.json().catch(() => ({ detail: r.statusText }))
  if (!r.ok) throw new Error(typeof d?.detail === 'string' ? d.detail : JSON.stringify(d?.detail ?? d))
  return d
}

export default function AiStudio() {
  const [open, setOpen] = useState(false)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [lessonId, setLessonId] = useState('')
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [brief, setBrief] = useState('')
  const [count, setCount] = useState(3)
  const [level, setLevel] = useState('начинающий')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [busy, setBusy] = useState<'gen' | 'add' | 'status' | 'test' | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [testTask, setTestTask] = useState('')
  const [testCode, setTestCode] = useState("print('Привет, мир!')")
  const [test, setTest] = useState<{ stdout: string; stderr: string; verdict: Verdict } | null>(null)

  const loadLessons = useCallback(async () => {
    if (!token()) return
    try { const ls = await req('/api/teacher/lessons'); setLessons(ls); setLessonId(cur => cur || (ls[0]?.id ?? '')) } catch (e: any) { setMsg({ kind: 'err', text: e.message }) }
  }, [])

  const checkStatus = useCallback(async () => {
    if (!token()) return
    setBusy('status')
    try { setStatus(await req('/api/teacher/ai-status')) } catch (e: any) { setMsg({ kind: 'err', text: e.message }) } finally { setBusy(null) }
  }, [])

  useEffect(() => { if (open) { loadLessons(); checkStatus() } }, [open])
  useEffect(() => {
    if (!lessonId || !token()) return
    req(`/api/teacher/lessons/${lessonId}`).then(l => { setTasks(l.tasks ?? []); setTestTask(l.tasks?.[0]?.id ?? '') }).catch(() => setTasks([]))
  }, [lessonId])

  const generate = async () => {
    if (!brief.trim()) { setMsg({ kind: 'err', text: 'Опиши, какие задания нужны' }); return }
    setBusy('gen'); setMsg(null)
    try {
      const d = await req('/api/teacher/ai-preview', 'POST', { brief, count, level })
      setDrafts(d.tasks.map((t: any) => ({ ...t, include: true })))
      setMsg({ kind: 'ok', text: `AI предложил ${d.tasks.length} заданий — отредактируй и добавь в урок` })
    } catch (e: any) { setMsg({ kind: 'err', text: e.message }) } finally { setBusy(null) }
  }

  const addSelected = async () => {
    const sel = drafts.filter(d => d.include)
    if (!lessonId) { setMsg({ kind: 'err', text: 'Выбери урок' }); return }
    if (!sel.length) { setMsg({ kind: 'err', text: 'Отметь хотя бы одно задание' }); return }
    setBusy('add')
    try {
      for (const d of sel) await req(`/api/teacher/lessons/${lessonId}/tasks`, 'POST', { title: d.title, description: d.description, starter_code: d.starter_code, ai_criteria: d.ai_criteria, order_index: 99 })
      setMsg({ kind: 'ok', text: `Добавлено ${sel.length} заданий в урок` }); setDrafts([]); setBrief('')
      const l = await req(`/api/teacher/lessons/${lessonId}`); setTasks(l.tasks ?? []); loadLessons()
    } catch (e: any) { setMsg({ kind: 'err', text: e.message }) } finally { setBusy(null) }
  }

  const runTest = async () => {
    setBusy('test'); setTest(null)
    try { setTest(await req('/api/teacher/ai-selftest', 'POST', { task_id: testTask, code: testCode })) }
    catch (e: any) { setMsg({ kind: 'err', text: e.message }) } finally { setBusy(null) }
  }

  const upd = (i: number, k: keyof Draft, v: any) => setDrafts(ds => ds.map((d, j) => j === i ? { ...d, [k]: v } : d))
  const aiLive = !!status?.ok

  return (
    <>
      <button onClick={() => setOpen(true)} className="fixed bottom-4 right-4 z-40 neon px-4 py-2.5 rounded-xl text-sm flex items-center gap-2">
        <Sparkles size={15} /> AI-конструктор
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-black/60" onClick={() => setOpen(false)}>
          <div className="slidein glass h-full w-full max-w-xl border-y-0 border-r-0 overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2"><Wand2 size={18} className="text-[#8b5cf6]" /> AI-конструктор и проверка</h3>
              <button className="ghost p-2 rounded-lg" onClick={() => setOpen(false)}><X size={15} /></button>
            </div>

            {!token() && <p className="text-sm text-[#fbbf24] glass rounded-xl p-3">Войди как учитель, чтобы пользоваться AI.</p>}

            <div className="glass rounded-xl p-3 flex items-start gap-2 text-xs">
              {busy === 'status' ? <Loader2 size={14} className="animate-spin text-[#4f7dff] mt-0.5" /> : aiLive ? <CheckCircle2 size={14} className="text-[#a3e635] mt-0.5" /> : <AlertTriangle size={14} className="text-[#fbbf24] mt-0.5" />}
              <span className="flex-1 text-[#93a9d1] break-words">
                {aiLive ? `Нейросеть подключена: ${status?.provider} · ключ ${status?.key_hint}` : status?.error ? `Нейросеть НЕ работает, оценки ставит локальный верификатор. Причина: ${status.error}` : status?.configured ? 'Ключ есть, проверяем…' : 'Ключ не задан в backend/.env'}
              </span>
              <button className="ghost px-2 py-1 rounded" onClick={checkStatus}><RefreshCw size={12} /></button>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-[#93a9d1] uppercase tracking-widest">Урок</label>
              <select className="field" value={lessonId} onChange={e => setLessonId(e.target.value)}>
                {lessons.map(l => <option key={l.id} value={l.id}>{l.title} · {l.task_count} задан. · {l.access_code}</option>)}
              </select>
              <label className="text-xs text-[#93a9d1] uppercase tracking-widest">Что дать ученикам (кратко)</label>
              <textarea className="field min-h-[80px]" placeholder="Например: 3 задачи на циклы for — сумма чисел, таблица умножения, чётные числа" value={brief} onChange={e => setBrief(e.target.value)} />
              <div className="flex gap-2">
                <select className="field !w-auto" value={count} onChange={e => setCount(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} задан.</option>)}
                </select>
                <select className="field !w-auto" value={level} onChange={e => setLevel(e.target.value)}>
                  <option value="начинающий">начинающий</option><option value="средний">средний</option><option value="продвинутый">продвинутый</option>
                </select>
                <button className="neon flex-1 py-2 rounded-xl text-sm flex items-center justify-center gap-2" onClick={generate} disabled={busy !== null || !token()}>
                  {busy === 'gen' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Сгенерировать
                </button>
              </div>
            </div>

            {msg && <div className={`rounded-xl p-3 text-sm border break-words ${msg.kind === 'ok' ? 'border-[rgba(163,230,53,.4)] bg-[rgba(163,230,53,.08)] text-[#a3e635]' : 'border-[rgba(244,63,94,.4)] bg-[rgba(244,63,94,.08)] text-[#f43f5e]'}`}>{msg.text}</div>}

            {drafts.map((d, i) => (
              <div key={i} className={`glass rounded-xl p-4 space-y-2 ${d.include ? '' : 'opacity-50'}`}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={d.include} onChange={e => upd(i, 'include', e.target.checked)} className="accent-[#4f7dff] w-4 h-4" />
                  <input className="field !py-1.5 font-semibold" value={d.title} onChange={e => upd(i, 'title', e.target.value)} />
                </div>
                <textarea className="field text-sm min-h-[70px]" value={d.description} onChange={e => upd(i, 'description', e.target.value)} />
                <textarea className="field font-mono text-xs min-h-[50px]" value={d.starter_code} onChange={e => upd(i, 'starter_code', e.target.value)} />
                <textarea className="field text-xs min-h-[44px] !text-[#fbbf24]" value={d.ai_criteria} onChange={e => upd(i, 'ai_criteria', e.target.value)} />
              </div>
            ))}

            {drafts.length > 0 && (
              <button className="neon w-full py-2.5 rounded-xl text-sm flex items-center justify-center gap-2" onClick={addSelected} disabled={busy !== null}>
                {busy === 'add' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Добавить выбранные в урок
              </button>
            )}

            <div className="glass rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-sm"><FlaskConical size={15} className="text-[#4f7dff]" /> Тест оценки: как проверяется решение</div>
              <select className="field !py-1.5 text-sm" value={testTask} onChange={e => setTestTask(e.target.value)}>
                <option value="">Демо-задание «Привет, мир!»</option>
                {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              <textarea className="field font-mono text-xs min-h-[80px]" value={testCode} onChange={e => setTestCode(e.target.value)} />
              <button className="ghost w-full py-2 rounded-xl text-sm flex items-center justify-center gap-2" onClick={runTest} disabled={busy !== null || !token()}>
                {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} Проверить этот код
              </button>
              {test && (
                <div className={`rounded-xl p-3 border text-sm space-y-1 ${test.verdict.is_correct ? 'border-[rgba(163,230,53,.4)] bg-[rgba(163,230,53,.08)]' : 'border-[rgba(244,63,94,.4)] bg-[rgba(244,63,94,.08)]'}`}>
                  <div className="flex items-center gap-2 font-bold">
                    {test.verdict.is_correct ? <CheckCircle2 size={16} className="text-[#a3e635]" /> : <XCircle size={16} className="text-[#f43f5e]" />}
                    {test.verdict.is_correct ? 'Принято' : 'Не принято'} · {test.verdict.score}/100
                  </div>
                  {test.stdout && <pre className="text-[#a3e635] text-xs whitespace-pre-wrap font-mono">{test.stdout}</pre>}
                  {test.stderr && <pre className="text-[#f43f5e] text-xs whitespace-pre-wrap font-mono">{test.stderr}</pre>}
                  <p className="text-[#dbe6ff]">{test.verdict.feedback}</p>
                  <details className="text-xs text-[#93a9d1]"><summary className="cursor-pointer">Обоснование и провайдер</summary><p className="mt-1 break-words">{test.verdict.reasoning}</p></details>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}