import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import { CheckCircle2, ChevronLeft, ChevronRight, Eraser, Loader2, Moon, Play, RotateCcw, Send, Square, Sun, Terminal, Trophy, XCircle } from 'lucide-react'
import { studentApi, errText, journalFromRatio, type Task, type AIReview } from '../api'
import { useToast } from '../context/ToastContext'
import { useTheme } from '../context/ThemeContext'
import { usePyodideRunner } from '../pyodide/usePyodideRunner'

type Line = { kind: 'out' | 'err' | 'sys'; text: string }

export default function Workspace() {
  const nav = useNavigate()
  const toast = useToast()
  const { theme, toggle } = useTheme()
  const token = localStorage.getItem('student_token') || ''
  const [task, setTask] = useState<Task | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [code, setCode] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [inputPrompt, setInputPrompt] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [review, setReview] = useState<AIReview | null>(null)
  const [busy, setBusy] = useState<'run' | 'submit' | null>(null)
  const [fontSize, setFontSize] = useState(14)
  const [allTasks, setAllTasks] = useState<Task[]>([])
  const [showAll, setShowAll] = useState(false)
  const poll = useRef<number | null>(null)
  const drafts = useRef<Record<string, string>>({})
  const codeRef = useRef('')
  const taskIdRef = useRef<string | null>(null)
  const celebrated = useRef(false)
  const consoleRef = useRef<HTMLDivElement | null>(null)

  const runner = usePyodideRunner({
    onOut: (s) => setLines(l => [...l, { kind: 'out', text: s }]),
    onErr: (s) => setLines(l => [...l, { kind: 'err', text: s }]),
    onInput: (p) => { setInputPrompt(p); setInputValue('') },
  })

  const draftKey = `edu_drafts_${token}`
  useEffect(() => {
    try { drafts.current = JSON.parse(localStorage.getItem(draftKey) || '{}') } catch { drafts.current = {} }
  }, [draftKey])
  const saveDraft = (id: string | null, v: string) => {
    if (!id) return
    drafts.current[id] = v
    localStorage.setItem(draftKey, JSON.stringify(drafts.current))
  }

  const stopPoll = () => { if (poll.current) { window.clearInterval(poll.current); poll.current = null } }
  useEffect(() => () => stopPoll(), [])
  useEffect(() => { if (!token) nav('/join', { replace: true }) }, [token, nav])
  useEffect(() => { consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight }) }, [lines, inputPrompt])

  const exit = () => { saveDraft(taskIdRef.current, codeRef.current); localStorage.removeItem('student_token'); nav('/join') }

  const applyTask = (t: Task, list?: Task[]) => {
    const src = list ?? allTasks
    const fromList = src.find(x => x.id === t.id)
    const restored = drafts.current[t.id] ?? fromList?.code ?? t.code ?? ''
    const initial = restored !== '' ? restored : (t.starter_code || '# Пиши решение здесь\n')
    setTask(t); setCode(initial); codeRef.current = initial; taskIdRef.current = t.id
    setReview(null); setLines([]); setInputPrompt(null)
  }

  const loadTask = useCallback(async () => {
    if (!token) return
    setLoadErr('')
    try {
      const t = await studentApi.currentTask(token)
      let list: Task[] = []
      try { list = await studentApi.tasks(token) } catch {}
      setAllTasks(list); applyTask(t, list)
    } catch (e: any) {
      setLoadErr(errText(e))
      if (e?.status === 401) { localStorage.removeItem('student_token'); nav('/join') }
    }
  }, [token])
  useEffect(() => { loadTask() }, [loadTask])

  const onCodeChange = (v: string) => { setCode(v); codeRef.current = v; saveDraft(taskIdRef.current, v) }

  const run = async () => {
    setBusy('run'); setLines([]); setInputPrompt(null)
    await runner.run(codeRef.current)
    setBusy(null)
  }

  const stop = () => { runner.stop('ExecutionStopped: остановлено пользователем'); setBusy(null); setInputPrompt(null) }

  const sendInput = () => {
    const text = inputValue
    setLines(l => [...l, { kind: 'sys', text: (inputPrompt ?? '') + text + '\n' }])
    setInputPrompt(null); setInputValue('')
    runner.replyInput(text)
  }

  const submit = async () => {
    setBusy('submit'); setReview(null); stopPoll()
    saveDraft(taskIdRef.current, codeRef.current)
    const io = await runner.run(codeRef.current)   // выполняем в браузере и берём вывод
    try {
      const r = await studentApi.submit(codeRef.current, token, io)
      let tries = 0
      poll.current = window.setInterval(async () => {
        tries++
        try {
          const s = await studentApi.submission(r.submission_id, token)
          if (s.status === 'completed' && s.review) {
            stopPoll(); setReview(s.review); setBusy(null)
            try { setAllTasks(await studentApi.tasks(token)) } catch {}
            if (s.review.is_correct) toast('Задание принято: +')
          } else if (tries > 25) { stopPoll(); setBusy(null); toast('Проверка затянулась', 'err') }
        } catch { stopPoll(); setBusy(null) }
      }, 1200)
    } catch (e) { toast(errText(e), 'err'); setBusy(null) }
  }

  const selectTask = async (index: number) => {
    saveDraft(taskIdRef.current, codeRef.current)
    try {
      const t = await studentApi.selectTask(index, token)
      const list = await studentApi.tasks(token).catch(() => allTasks)
      setAllTasks(list); applyTask(t, list); setShowAll(false)
    } catch (e) { toast(errText(e), 'err') }
  }

  const plus = allTasks.filter(t => t.accepted).length
  const minus = allTasks.filter(t => t.submitted && !t.accepted).length
  const total = allTasks.length
  const done = total > 0 && plus === total
  const predicted = journalFromRatio(plus, total)

  useEffect(() => {
    if (done && !celebrated.current) {
      celebrated.current = true
      toast(`Урок завершён! +${plus} / −${minus} · оценка в журнал: ${predicted ?? '—'}`)
    }
    if (!done) celebrated.current = false
  }, [done, plus, minus, predicted, toast])

  if (!token) return null
  if (loadErr) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="glass rounded-2xl p-8 max-w-md text-center space-y-4 rise">
        <XCircle className="mx-auto text-[#f43f5e]" size={36} />
        <p className="text-[#93a9d1]">{loadErr}</p>
        <div className="flex gap-2 justify-center">
          <button className="ghost px-4 py-2 rounded-xl" onClick={loadTask}><RotateCcw size={14} className="inline mr-1" /> Повторить</button>
          <button className="neon px-4 py-2 rounded-xl" onClick={exit}>К входу</button>
        </div>
      </div>
    </div>
  )
  if (!task) return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="animate-spin text-[#4f7dff]" size={32} /></div>

  const idx = task.index ?? 0
  const current = allTasks.find(t => t.id === task.id)
  const running = runner.status === 'running'

  return (
    <div className="rise space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <div className="text-xs text-[#93a9d1]">{localStorage.getItem('student_lesson')} · <span className="font-semibold">{localStorage.getItem('student_name')}</span></div>
          <h2 className="text-xl font-extrabold">{task.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="glass rounded-lg px-3 py-1.5 text-sm font-mono flex items-center gap-2">
            <span className="text-[#a3e635] font-bold">+{plus}</span>
            <span className="text-[#f43f5e] font-bold">−{minus}</span>
            <span className="text-[#93a9d1] text-xs">/ {total}</span>
          </div>
          <button className="ghost p-2 rounded-lg" onClick={toggle}>{theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}</button>
          <button className="ghost p-2 rounded-lg disabled:opacity-40" disabled={idx <= 0} onClick={() => selectTask(idx - 1)}><ChevronLeft size={16} /></button>
          <button className="ghost px-3 py-1.5 rounded-lg text-xs" onClick={() => setShowAll(!showAll)}>Все задания {idx + 1}/{total}</button>
          <button className="ghost p-2 rounded-lg disabled:opacity-40" disabled={idx >= total - 1} onClick={() => selectTask(idx + 1)}><ChevronRight size={16} /></button>
          <button className="ghost px-3 py-1.5 rounded-lg text-xs ml-1" onClick={exit}>Выйти</button>
        </div>
      </div>

      {done && (
        <div className="glass rounded-2xl p-5 border border-[rgba(163,230,53,.5)] bg-[rgba(163,230,53,.08)] flex flex-wrap items-center gap-4 tasks-panel">
          <Trophy size={30} className="text-[#a3e635]" />
          <div className="flex-1 min-w-[200px]">
            <div className="font-extrabold text-lg text-[#a3e635]">Урок завершён!</div>
            <div className="text-sm text-[#93a9d1]">Все задания приняты: +{plus} / −{minus}. Учитель видит твой результат.</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-[#93a9d1] uppercase tracking-widest">В журнал</div>
            <div className="text-3xl font-extrabold text-[#a3e635]">{predicted ?? '—'}</div>
          </div>
        </div>
      )}

      {showAll && (
        <div className="glass rounded-2xl p-4 tasks-panel">
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
            {allTasks.map((t, i) => (
              <button key={t.id} onClick={() => selectTask(i)} style={{ animationDelay: `${i * 45}ms` }}
                className={`task-tile p-3 rounded-xl text-left text-sm border transition ${t.accepted ? 'border-[#a3e635] bg-[rgba(163,230,53,.08)]' : i === idx ? 'border-[#4f7dff] bg-[rgba(79,125,255,.1)]' : 'border-[#233052] hover:border-[#4f7dff]'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs text-[#93a9d1]">#{i + 1}</span>
                  <span className={`font-extrabold text-base ${t.accepted ? 'text-[#a3e635]' : t.submitted ? 'text-[#f43f5e]' : 'text-[#5b6c92]'}`}>{t.accepted ? '+' : t.submitted ? '−' : '·'}</span>
                </div>
                <div className="font-semibold line-clamp-2">{t.title}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[340px_1fr] gap-4">
        <div className="glass rounded-2xl p-5 space-y-4 h-fit lg:sticky lg:top-20">
          <div className="flex items-center justify-between">
            <div className="text-xs font-mono text-[#4f7dff]">ЗАДАНИЕ {idx + 1} / {total}</div>
            {current && <span className={`font-extrabold text-xl ${current.accepted ? 'text-[#a3e635]' : current.submitted ? 'text-[#f43f5e]' : 'text-[#5b6c92]'}`}>{current.accepted ? '+' : current.submitted ? '−' : '·'}</span>}
          </div>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{task.description}</p>
          {review && (
            <div className={`rounded-xl p-4 border ${review.is_correct ? 'border-[rgba(163,230,53,.4)] bg-[rgba(163,230,53,.08)]' : 'border-[rgba(244,63,94,.4)] bg-[rgba(244,63,94,.08)]'}`}>
              <div className="flex items-center gap-2 font-bold mb-1">
                {review.is_correct ? <CheckCircle2 size={18} className="text-[#a3e635]" /> : <XCircle size={18} className="text-[#f43f5e]" />}
                <span className={`text-2xl font-extrabold ${review.is_correct ? 'text-[#a3e635]' : 'text-[#f43f5e]'}`}>{review.is_correct ? '+' : '−'}</span>
                {review.is_correct ? 'Принято' : 'Нужно доработать'}
              </div>
              <p className="text-sm">{review.feedback}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <div className="glass rounded-2xl overflow-hidden flex flex-col" style={{ height: '52vh' }}>
            <div className="flex items-center gap-2 px-3 py-2 bg-[#070b18] border-b border-[#233052] flex-wrap">
              <span className="font-mono text-xs text-[#93a9d1] flex-1">solution.py</span>
              <button className="ghost px-2 py-1 rounded text-xs" onClick={() => setFontSize(f => Math.max(11, f - 1))}>A−</button>
              <span className="text-xs font-mono text-[#93a9d1]">{fontSize}px</span>
              <button className="ghost px-2 py-1 rounded text-xs" onClick={() => setFontSize(f => Math.min(22, f + 1))}>A+</button>
              <button className="ghost px-2 py-1 rounded text-xs" title="Сбросить код" onClick={() => onCodeChange(task.starter_code || '')}><RotateCcw size={12} /></button>
              <button className="ghost px-2 py-1 rounded text-xs" title="Очистить консоль" onClick={() => setLines([])}><Eraser size={12} /></button>
              {running ? (
                <button className="ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 !border-[rgba(244,63,94,.5)] !text-[#f43f5e]" onClick={stop}>
                  <Square size={12} /> Стоп
                </button>
              ) : (
                <button className="ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1" onClick={run}
                  disabled={runner.status === 'loading' || busy !== null}>
                  {runner.status === 'loading'
                    ? <><Loader2 size={12} className="animate-spin" /> Загрузка среды Python…</>
                    : busy === 'run' ? <><Loader2 size={12} className="animate-spin" /> Выполняется…</>
                    : <><Play size={12} /> Запустить</>}
                </button>
              )}
              <button className="neon px-3 py-1.5 rounded-lg text-xs flex items-center gap-1" onClick={submit}
                disabled={runner.status !== 'ready' || busy !== null}>
                {busy === 'submit' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} На проверку
              </button>
            </div>
            <div className="flex-1">
              <Editor height="100%" language="python" theme="vs-dark" value={code}
                onChange={v => onCodeChange(v ?? '')}
                options={{
                  minimap: { enabled: false }, fontSize, tabSize: 4, insertSpaces: true,
                  autoIndent: 'full', lineNumbers: 'on', scrollBeyondLastLine: false,
                  automaticLayout: true, padding: { top: 12 },
                }} />
            </div>
          </div>

          <div ref={consoleRef} className="glass rounded-2xl p-4 font-mono text-sm h-52 overflow-y-auto bg-[#070b18]">
            <div className="flex items-center gap-2 text-[#5b6c92] text-xs uppercase tracking-widest mb-2">
              <Terminal size={13} /> Консоль
              {runner.status === 'loading' && <span className="ml-auto normal-case text-[#4f7dff]">Загрузка среды Python…</span>}
              {running && <span className="ml-auto normal-case text-[#a3e635]">выполняется…</span>}
            </div>
            {lines.map((l, i) => (
              <pre key={i} className={`whitespace-pre-wrap ${l.kind === 'err' ? 'text-[#f43f5e]' : l.kind === 'sys' ? 'text-[#93a9d1]' : 'text-[#a3e635]'}`}>{l.text}</pre>
            ))}
            {inputPrompt !== null && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[#dbe6ff] whitespace-pre-wrap">{inputPrompt}</span>
                <input autoFocus className="flex-1 bg-transparent border-b border-[#4f7dff] outline-none text-[#dbe6ff] font-mono text-sm"
                  value={inputValue} onChange={e => setInputValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendInput() }} />
                <button className="ghost px-2 py-1 rounded text-xs" onClick={sendInput}>↵</button>
              </div>
            )}
            {lines.length === 0 && inputPrompt === null && runner.status === 'ready' && (
              <span className="text-[#5b6c92] italic">Нажми «Запустить»…</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}