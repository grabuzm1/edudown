// frontend/src/pages/teacher/StudentWorkViewer.tsx
import { useEffect, useState } from 'react'
import { Code2, Loader2, Terminal, Trophy } from 'lucide-react'
import { teacherApi, errText, type StudentWork } from '../../api'
import { useToast } from '../../context/ToastContext'
import Modal from '../../components/Modal'

export default function StudentWorkViewer({ sessionId, studentName, onClose }: { sessionId: string; studentName: string; onClose: () => void }) {
  const toast = useToast()
  const [work, setWork] = useState<StudentWork | null>(null)
  const [selected, setSelected] = useState(0)
  const [comment, setComment] = useState('')
  const [gradeVal, setGradeVal] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    teacherApi.studentWork(sessionId).then(w => {
      setWork(w); setComment(w.teacher_comment || ''); setGradeVal(w.teacher_grade ? String(w.teacher_grade) : '')
    }).catch(e => toast(errText(e), 'err'))
  }
  useEffect(load, [sessionId])

  const save = async () => {
    setBusy(true)
    try {
      await teacherApi.grade(sessionId, gradeVal ? Number(gradeVal) : null, comment)
      toast('Оценка сохранена в журнал'); load()
    } catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }

  const item = work?.items[selected]
  return (
    <Modal onClose={onClose} title={`Работы: ${studentName}`} wide>
      {!work ? <Loader2 className="animate-spin mx-auto" /> : (
        <div className="space-y-4">
          <div className="glass rounded-xl p-3 flex flex-wrap items-center gap-4">
            <div className="font-mono text-lg flex items-center gap-2">
              <span className="text-[#a3e635] font-extrabold">+{work.plus}</span>
              <span className="text-[#f43f5e] font-extrabold">−{work.minus}</span>
              <span className="text-[#93a9d1] text-sm">/ {work.total_tasks}</span>
            </div>
            {work.is_completed && <span className="flex items-center gap-1 text-[#a3e635] text-sm font-semibold"><Trophy size={15} /> урок завершён</span>}
            <div className="ml-auto flex items-center gap-2 text-sm">
              <span className="text-[#93a9d1]">В журнал:</span>
              <span className="badge badge-live text-base font-extrabold px-3 py-1">{work.final_grade ?? '—'}</span>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {work.items.map((it, i) => (
              <button key={it.task_id} onClick={() => setSelected(i)}
                className={`ghost px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${selected === i ? '!bg-[rgba(79,125,255,.28)] !text-white' : ''} ${it.submitted ? '' : 'opacity-50'}`}>
                #{i + 1} {it.task_title}
                <span className={`font-extrabold ${it.accepted ? 'text-[#a3e635]' : it.submitted ? 'text-[#f43f5e]' : 'text-[#5b6c92]'}`}>
                  {it.accepted ? '+' : it.submitted ? '−' : '·'}
                </span>
              </button>
            ))}
          </div>

          {item && (
            <div className="space-y-3">
              <div className="glass rounded-xl p-4">
                <div className="text-xs text-[#93a9d1] mb-1">Условие</div>
                <div className="text-sm whitespace-pre-wrap">{item.task_description}</div>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="glass rounded-xl p-4">
                  <div className="text-xs text-[#93a9d1] mb-1 flex items-center gap-1"><Code2 size={12} /> Код ученика</div>
                  <pre className="font-mono text-xs bg-[#070b18] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">{item.code || '(не отправлено)'}</pre>
                </div>
                <div className="space-y-3">
                  <div className="glass rounded-xl p-4">
                    <div className="text-xs text-[#93a9d1] mb-1 flex items-center gap-1"><Terminal size={12} /> stdout</div>
                    <pre className="font-mono text-xs bg-[#070b18] p-3 rounded-lg text-[#a3e635] whitespace-pre-wrap min-h-[60px]">{item.stdout || '(пусто)'}</pre>
                  </div>
                  {item.stderr && (
                    <div className="glass rounded-xl p-4">
                      <div className="text-xs text-[#93a9d1] mb-1">stderr</div>
                      <pre className="font-mono text-xs bg-[#070b18] p-3 rounded-lg text-[#f43f5e] whitespace-pre-wrap">{item.stderr}</pre>
                    </div>
                  )}
                </div>
              </div>
              {item.ai && (
                <div className={`rounded-xl p-4 border ${item.ai.is_correct ? 'border-[rgba(163,230,53,.4)] bg-[rgba(163,230,53,.08)]' : 'border-[rgba(244,63,94,.4)] bg-[rgba(244,63,94,.08)]'}`}>
                  <div className="font-bold mb-1 flex items-center gap-2">
                    <span className={`text-2xl font-extrabold ${item.ai.is_correct ? 'text-[#a3e635]' : 'text-[#f43f5e]'}`}>{item.ai.is_correct ? '+' : '−'}</span>
                    {item.ai.is_correct ? 'AI засчитал' : 'AI отклонил'}
                  </div>
                  <div className="text-sm">{item.ai.feedback}</div>
                  <div className="text-xs text-[#93a9d1] mt-2">{item.ai.reasoning}</div>
                </div>
              )}
            </div>
          )}

          <div className="glass rounded-xl p-4 space-y-3">
            <div className="font-semibold text-sm">Оценка в журнал</div>
            <div className="flex flex-wrap gap-3 items-center">
              <select className="field !w-auto" value={gradeVal} onChange={e => setGradeVal(e.target.value)}>
                <option value="">авто по плюсам ({work.journal_grade ?? '—'})</option>
                <option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option>
              </select>
              <span className="text-xs text-[#93a9d1]">5 ≥ 90% · 4 ≥ 70% · 3 ≥ 50% · иначе 2</span>
            </div>
            <textarea className="field min-h-[60px]" placeholder="Комментарий ученику" value={comment} onChange={e => setComment(e.target.value)} />
            <button className="neon px-4 py-2 rounded-lg text-sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="animate-spin inline" size={14} /> : 'Сохранить в журнал'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}