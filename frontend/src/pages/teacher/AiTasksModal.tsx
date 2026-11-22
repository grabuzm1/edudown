import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { teacherApi, errText } from '../../api'
import { useToast } from '../../context/ToastContext'
import Modal from '../../components/Modal'

type Draft = { title: string; description: string; starter_code: string; ai_criteria: string; include: boolean }

export default function AiTasksModal({ lessonId, classId, onClose, onSaved }: {
  lessonId: string; classId?: string | null; onClose: () => void; onSaved: () => void
}) {
  const toast = useToast()
  const [brief, setBrief] = useState('')
  const [count, setCount] = useState(3)
  const [level, setLevel] = useState('начинающий')
  const [classNumber, setClassNumber] = useState<number | null>(null)
  const [aiInfo, setAiInfo] = useState<string>('')
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])

  useEffect(() => {
    teacherApi.aiStatus().then(s => {
      setAiInfo(s.ok ? `Нейросеть подключена: ${s.provider}` : `AI недоступен: ${s.error || 'нет ключа'}`)
    }).catch(() => setAiInfo('AI недоступен'))
    if (classId) {
      teacherApi.classes().then(cs => {
        const c = cs.find(x => x.id === classId)
        if (c) setClassNumber(c.number)
      }).catch(() => {})
    }
  }, [classId])

  const preview = async () => {
    if (!brief.trim()) { toast('Опиши, какие задания нужны', 'err'); return }
    setBusy('preview')
    try {
      const r = await teacherApi.aiPreview({ brief, count, level, class_number: classNumber })
      setDrafts(r.tasks.map(t => ({ title: t.title ?? '', description: t.description ?? '', starter_code: t.starter_code ?? '', ai_criteria: t.ai_criteria ?? '', include: true })))
    } catch (e) { toast(errText(e), 'err') } finally { setBusy(null) }
  }

  const save = async () => {
    const chosen = drafts.filter(d => d.include)
    if (chosen.length === 0) { toast('Выбери хотя бы одно задание', 'err'); return }
    setBusy('save')
    try {
      for (const d of chosen) {
        await teacherApi.createTask(lessonId, { title: d.title, description: d.description, starter_code: d.starter_code, ai_criteria: d.ai_criteria, order_index: 99 })
      }
      toast(`Добавлено заданий: ${chosen.length}`); onSaved()
    } catch (e) { toast(errText(e), 'err') } finally { setBusy(null) }
  }

  return (
    <Modal onClose={onClose} title="AI-конструктор заданий" wide>
      <div className="space-y-4">
        <p className="text-xs text-[#93a9d1]">{aiInfo}{classNumber ? ` · учитывается программа ${classNumber} класса` : ''}</p>
        <textarea className="field min-h-[80px]" autoFocus
          placeholder="Опиши, какие задания нужны. Например: «три задачи на цикл for для новичков: чётные числа, сумма, таблица умножения»"
          value={brief} onChange={e => setBrief(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#93a9d1] mb-1 block">Количество</label>
            <select className="field" value={count} onChange={e => setCount(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-[#93a9d1] mb-1 block">Уровень</label>
            <select className="field" value={level} onChange={e => setLevel(e.target.value)}>
              <option>начинающий</option><option>средний</option><option>опытный</option>
            </select>
          </div>
        </div>
        <button className="neon w-full py-2.5 rounded-xl flex items-center justify-center gap-2" onClick={preview} disabled={busy !== null}>
          {busy === 'preview' ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />} Сгенерировать превью
        </button>

        {drafts.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs text-[#93a9d1] uppercase tracking-widest">Превью — сними галочку, чтобы не добавлять</div>
            {drafts.map((d, i) => (
              <div key={i} className={`glass rounded-xl p-4 space-y-2 border transition ${d.include ? 'border-[#4f7dff]' : 'border-transparent opacity-60'}`}>
                <label className="flex items-center gap-2 cursor-pointer font-semibold">
                  <input type="checkbox" className="w-4 h-4" checked={d.include}
                    onChange={e => setDrafts(prev => prev.map((x, j) => j === i ? { ...x, include: e.target.checked } : x))} />
                  #{i + 1} {d.title}
                </label>
                <p className="text-sm text-[#93a9d1] whitespace-pre-wrap">{d.description}</p>
                {d.ai_criteria && <p className="text-xs text-[#fbbf24]">Критерии: {d.ai_criteria}</p>}
                {d.starter_code && <pre className="font-mono text-xs bg-[#070b18] p-2 rounded-lg text-[#93a9d1] whitespace-pre-wrap">{d.starter_code}</pre>}
              </div>
            ))}
            <button className="neon w-full py-2.5 rounded-xl" onClick={save} disabled={busy !== null}>
              {busy === 'save' ? <Loader2 className="animate-spin inline" size={16} /> : `Добавить выбранные (${drafts.filter(d => d.include).length}) в урок`}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}