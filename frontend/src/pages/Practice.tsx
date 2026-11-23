import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import { ArrowLeft, CheckCircle2, Eraser, Loader2, Moon, Play, RotateCcw, Sparkles, Square, Sun, Terminal, XCircle } from 'lucide-react'
import { practiceApi, errText } from '../api'
import { useToast } from '../context/ToastContext'
import { useTheme } from '../context/ThemeContext'

import { usePyodideRunner } from '../pyodide/usePyodideRunner'


type PTask = { title: string; description: string; starter_code: string; ai_criteria: string; done?: boolean; tried?: boolean }
type Line = { kind: 'out' | 'err' | 'sys'; text: string }

export default function Practice() {
  const nav = useNavigate()
  const toast = useToast()
  const { theme, toggle } = useTheme()
  const [grade, setGrade] = useState(7)
  const [level, setLevel] = useState('начинающий')
  const [custom, setCustom] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [count, setCount] = useState(3)
  const [genBusy, setGenBusy] = useState(false)
  const [tasks, setTasks] = useState<PTask[]>([])
  const [sel, setSel] = useState(0)
  const [code, setCode] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [inputPrompt, setInputPrompt] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const consoleRef = useRef<HTMLDivElement | null>(null)

  const runner = usePyodideRunner({
    onOut: s => setLines(l => [...l, { kind: 'out', text: s }]),
    onErr: s => setLines(l => [...l, { kind: 'err', text: s }]),
    onInput: p => { setInputPrompt(p); setInputValue('') },
  })

  const generate = async () => {
    setGenBusy(true); setTasks([]); setSel(0); setVerdict(null); setLines([])
    try {
      const r = await practiceApi.generate({ grade, level, custom, prompt: promptText, count })
      setTasks(r.tasks)
      if (r.tasks[0]) setCode(r.tasks[0].starter_code || '# Пиши решение здесь\n')
      else toast('Нейронка не вернула задач, попробуй ещё раз', 'err')
    } catch (e) { toast(errText(e), 'err') } finally { setGenBusy(false) }
  }

  const pick = (i: number) => { setSel(i); setCode(tasks[i].starter_code || ''); setLines([]); setVerdict(null); setInputPrompt(null) }

  const run = async () => { setBusy(true); setLines([]); setInputPrompt(null); await runner.run(code); setBusy(false) }
  const stop = () => { runner.stop('ExecutionStopped: остановлено'); setBusy(false); setInputPrompt(null) }
  const sendInput = () => {
    setLines(l => [...l, { kind: 'sys', text: (inputPrompt ?? '') + inputValue + '\n' }])
    runner.replyInput(inputValue); setInputPrompt(null); setInputValue('')
  }

  const check = async () => {
    setBusy(true); setVerdict(null)
    const io = await runner.run(code)
    const t = tasks[sel]
    try {
      const r = await practiceApi.check({ description: t.description, criteria: t.ai_criteria, code, stdout: io.stdout, stderr: io.stderr })
      setVerdict({ ok: r.is_correct, text: r.feedback })
      setTasks(prev => prev.map((x, i) => i === sel ? { ...x, done: r.is_correct, tried: true } : x))
      if (r.is_correct) toast('Задача решена: +')
    } catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }

  const plus = tasks.filter(t => t.done).length

  return (
    <div className="rise space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold flex items-center gap-2"><Sparkles size={22} className="text-[#4f7dff]" /> Тренировка</h2>
          <p className="text-sm text-[#93a9d1]">Решай задачи по своему уровню — без урока и оценок</p>
        </div>
                <div className="flex items-center gap-2">
          <button className="ghost p-2 rounded-xl" onClick={toggle} title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}>
            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          </button>
          <button className="ghost px-3 py-2 rounded-xl text-xs flex items-center gap-1" onClick={() => nav('/join')}><ArrowLeft size={12} /> К входу</button>
        </div>
      </div>

      <div className="glass rounded-2xl p-4 space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-[#93a9d1] mb-1 block">Класс (программа)</label>
            <select className="field" value={grade} onChange={e => setGrade(Number(e.target.value))}>
              {Array.from({ length: 11 }, (_, i) => i + 1).map(g => <option key={g} value={g}>{g} класс</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-[#93a9d1] mb-1 block">Уровень</label>
            <select className="field" value={level} onChange={e => setLevel(e.target.value)}>
              <option>начинающий</option><option>средний</option><option>опытный</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[#93a9d1] mb-1 block">Задач</label>
            <select className="field" value={count} onChange={e => setCount(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input type="checkbox" className="w-4 h-4" checked={custom} onChange={e => setCustom(e.target.checked)} />
          Сам задам тему (иначе нейронка подберёт по школьной программе {grade} класса)
        </label>
        {custom && <textarea className="field min-h-[60px]" placeholder="Например: задачи на циклы for со списками" value={promptText} onChange={e => setPromptText(e.target.value)} />}
        <button className="neon w-full py-2.5 rounded-xl flex items-center justify-center gap-2" onClick={generate} disabled={genBusy}>
          {genBusy ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />} Сгенерировать задачи
        </button>
      </div>

      {tasks.length > 0 && (
        <>
          <div className="flex gap-2 flex-wrap items-center">
            {tasks.map((t, i) => (
              <button key={i} onClick={() => pick(i)}
                className={`ghost px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${sel === i ? '!bg-[rgba(79,125,255,.28)] !text-white' : ''}`}>
                #{i + 1}
                <span className={`font-extrabold ${t.done ? 'text-[#a3e635]' : t.tried ? 'text-[#f43f5e]' : 'text-[#5b6c92]'}`}>{t.done ? '+' : t.tried ? '−' : '·'}</span>
              </button>
            ))}
            <span className="ml-auto font-mono text-sm"><span className="text-[#a3e635] font-bold">+{plus}</span> <span className="text-[#93a9d1]">/ {tasks.length}</span></span>
          </div>

          <div className="grid lg:grid-cols-[340px_1fr] gap-4">
            <div className="glass rounded-2xl p-5 space-y-3 h-fit lg:sticky lg:top-20">
              <div className="text-xs font-mono text-[#4f7dff]">ЗАДАЧА {sel + 1} / {tasks.length}</div>
              <h3 className="font-bold">{tasks[sel].title}</h3>
              <p className="text-sm whitespace-pre-wrap">{tasks[sel].description}</p>
              {verdict && (
                <div className={`rounded-xl p-4 border ${verdict.ok ? 'border-[rgba(163,230,53,.4)] bg-[rgba(163,230,53,.08)]' : 'border-[rgba(244,63,94,.4)] bg-[rgba(244,63,94,.08)]'}`}>
                  <div className="flex items-center gap-2 font-bold mb-1">
                    {verdict.ok ? <CheckCircle2 size={18} className="text-[#a3e635]" /> : <XCircle size={18} className="text-[#f43f5e]" />}
                    <span className={`text-2xl font-extrabold ${verdict.ok ? 'text-[#a3e635]' : 'text-[#f43f5e]'}`}>{verdict.ok ? '+' : '−'}</span>
                  </div>
                  <p className="text-sm">{verdict.text}</p>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-4 min-w-0">
              <div className="glass rounded-2xl overflow-hidden flex flex-col" style={{ height: '48vh' }}>
                <div className="flex items-center gap-2 px-3 py-2 bg-[#070b18] border-b border-[#233052] flex-wrap">
                  <span className="font-mono text-xs text-[#93a9d1] flex-1">practice.py</span>
                  <button className="ghost px-2 py-1 rounded text-xs" onClick={() => setCode(tasks[sel].starter_code || '')}><RotateCcw size={12} /></button>
                  <button className="ghost px-2 py-1 rounded text-xs" onClick={() => setLines([])}><Eraser size={12} /></button>
                  {runner.status === 'running' ? (
                    <button className="ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 !text-[#f43f5e]" onClick={stop}><Square size={12} /> Стоп</button>
                  ) : (
                    <button className="ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1" onClick={run} disabled={runner.status === 'loading' || busy}>
                      {runner.status === 'loading' ? <><Loader2 size={12} className="animate-spin" /> Python…</> : <><Play size={12} /> Запустить</>}
                    </button>
                  )}
                  <button className="neon px-3 py-1.5 rounded-lg text-xs" onClick={check} disabled={runner.status !== 'ready' || busy}>
                    {busy ? <Loader2 size={12} className="animate-spin inline" /> : 'Проверить'}
                  </button>
                </div>
                <div className="flex-1">
                  <Editor height="100%" language="python" theme="vs-dark" value={code} onChange={v => setCode(v ?? '')}
                    options={{ minimap: { enabled: false }, fontSize: 14, tabSize: 4, insertSpaces: true, autoIndent: 'full', scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 12 } }} />
                </div>
              </div>
              <div ref={consoleRef} className="glass rounded-2xl p-4 font-mono text-sm h-44 overflow-y-auto bg-[#070b18]">
                <div className="text-[#5b6c92] text-xs uppercase tracking-widest mb-2 flex items-center gap-2"><Terminal size={13} /> Консоль</div>
                {lines.map((l, i) => <pre key={i} className={`whitespace-pre-wrap ${l.kind === 'err' ? 'text-[#f43f5e]' : l.kind === 'sys' ? 'text-[#93a9d1]' : 'text-[#a3e635]'}`}>{l.text}</pre>)}
                {inputPrompt !== null && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[#dbe6ff]">{inputPrompt}</span>
                    <input autoFocus className="flex-1 bg-transparent border-b border-[#4f7dff] outline-none text-[#dbe6ff] font-mono text-sm"
                      value={inputValue} onChange={e => setInputValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendInput()} />
                  </div>
                )}
                {lines.length === 0 && inputPrompt === null && <span className="text-[#5b6c92] italic">Нажми «Запустить»…</span>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}