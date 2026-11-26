// frontend/src/pages/teacher/LessonDrawer.tsx
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive, CheckCircle2, Eye, Loader2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { teacherApi, errText, type Lesson, type Task, type StudentRow } from '../../api'
import { useToast } from '../../context/ToastContext'
import TaskModal from './TaskModal'
import AiTasksModal from './AiTasksModal'
import StudentWorkViewer from './StudentWorkViewer'

function GradeConverter({ s, onSaved }: { s: StudentRow; onSaved: () => void }) {
  const toast = useToast()
  const [val, setVal] = useState<string>(s.teacher_grade ? String(s.teacher_grade) : '')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await teacherApi.grade(s.session_id, val ? Number(val) : null, s.teacher_comment || '')
      toast(val ? `Оценка ${val} сохранена в журнал` : 'Автооценка по плюсам сохранена')
      onSaved()
    } catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }
  return (
    <div className="flex items-center gap-2" title="Конвертер в оценку журнала: 5 при ≥90% плюсов, 4 при ≥70%, 3 при ≥50%, иначе 2">
      <span className="badge badge-live text-sm font-extrabold px-2.5 py-1">{s.final_grade ?? '—'}</span>
      <select className="field !w-auto !py-1.5 text-xs" value={val} onChange={e => setVal(e.target.value)}>
        <option value="">авто ({s.journal_grade ?? '—'})</option>
        <option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option>
      </select>
      <button className="ghost px-3 py-1.5 rounded-lg text-xs" onClick={save} disabled={busy}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : 'В журнал'}
      </button>
    </div>
  )
}

export default function LessonDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast()
  const [l, setL] = useState<Lesson | null>(null)
  const [tab, setTab] = useState<'tasks' | 'students'>('tasks')
  const [addMode, setAddMode] = useState<'manual' | 'ai'>('manual')
  const [editing, setEditing] = useState<Task | null>(null)
  const [adding, setAdding] = useState(false)
  const [viewWork, setViewWork] = useState<{ sessionId: string; name: string } | null>(null)

  const load = useCallback(async () => { try { setL(await teacherApi.lesson(id)) } catch (e) { toast(errText(e), 'err') } }, [id, toast])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const saveLesson = async () => {
    if (!l) return
    try { await teacherApi.patchLesson(l.id, { title: l.title, description: l.description }); toast('Урок сохранён') } catch (e) { toast(errText(e), 'err') }
  }
  const delTask = async (t: Task) => {
    try { await teacherApi.deleteTask(t.id); load(); toast('Задание удалено') } catch (e) { toast(errText(e), 'err') }
  }
  const archive = async () => {
    if (!confirm('Архивировать урок?')) return
    try { await teacherApi.archiveLesson(id); toast('Урок архивирован'); onClose() } catch (e) { toast(errText(e), 'err') }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="slidein glass h-full w-full max-w-2xl border-y-0 border-r-0 overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        {!l ? <Loader2 className="animate-spin mx-auto mt-20" /> : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-2">
                <input className="field font-bold text-lg" value={l.title} onChange={e => setL({ ...l, title: e.target.value })} />
                <textarea className="field text-sm" value={l.description} onChange={e => setL({ ...l, description: e.target.value })} />
                <div className="flex gap-2 items-center flex-wrap">
                  <button className="ghost px-3 py-1.5 rounded-lg text-sm" onClick={saveLesson}>Сохранить</button>
                  <span className="font-mono text-[#a3e635] tracking-[.2em] text-sm">{l.access_code}</span>
                  <span className={`badge ${l.is_published ? 'badge-live' : 'badge-draft'}`}>{l.is_published ? 'live' : 'draft'}</span>
                  <button className="ghost px-3 py-1.5 rounded-lg text-xs !border-[rgba(251,191,36,.4)] !text-[#fbbf24]" onClick={archive}>
                    <Archive size={13} className="inline" /> В архив
                  </button>
                </div>
              </div>
              <button className="ghost p-2 rounded-lg" onClick={onClose}><X size={16} /></button>
            </div>

            <div className="flex gap-2">
              <button className={`ghost px-4 py-2 rounded-lg text-sm ${tab === 'tasks' ? '!bg-[rgba(79,125,255,.28)] !text-white' : ''}`} onClick={() => setTab('tasks')}>
                Задания ({l.tasks?.length ?? 0})
              </button>
              <button className={`ghost px-4 py-2 rounded-lg text-sm ${tab === 'students' ? '!bg-[rgba(79,125,255,.28)] !text-white' : ''}`} onClick={() => setTab('students')}>
                Ученики ({l.students?.length ?? 0})
              </button>
            </div>

            {tab === 'tasks' && (
              <div className="space-y-3">
                <div className="glass rounded-xl p-2 flex gap-2 items-center">
                  <button className={`ghost flex-1 px-3 py-2 rounded-lg text-sm ${addMode === 'manual' ? '!bg-[rgba(79,125,255,.28)] !text-white' : ''}`} onClick={() => setAddMode('manual')}>
                    <Pencil size={13} className="inline mr-1" /> Вручную
                  </button>
                  <button className={`ghost flex-1 px-3 py-2 rounded-lg text-sm ${addMode === 'ai' ? '!bg-[rgba(139,92,246,.3)] !text-white' : ''}`} onClick={() => setAddMode('ai')}>
                    <Sparkles size={13} className="inline mr-1" /> AI-конструктор
                  </button>
                  <button className="neon px-3 py-2 rounded-lg text-sm flex items-center gap-1" onClick={() => setAdding(true)}>
                    <Plus size={14} /> {addMode === 'ai' ? 'Генерировать' : 'Задание'}
                  </button>
                </div>

                {(l.tasks ?? []).length === 0 && (
                  <p className="text-[#93a9d1] text-sm glass rounded-xl p-4">Пока нет заданий. Добавь вручную или сгенерируй через AI.</p>
                )}
                {(l.tasks ?? []).map((t, i) => (
                  <div key={t.id} className="glass rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[#4f7dff]">#{i + 1}</span>
                      <span className="font-semibold flex-1">{t.title}</span>
                      <button className="ghost p-1.5 rounded" onClick={() => setEditing(t)}><Pencil size={14} /></button>
                      <button className="ghost p-1.5 rounded !text-[#f43f5e]" onClick={() => delTask(t)}><Trash2 size={14} /></button>
                    </div>
                    <p className="text-sm text-[#93a9d1] whitespace-pre-wrap">{t.description}</p>
                    {t.ai_criteria && <p className="text-xs text-[#fbbf24]">Критерий: {t.ai_criteria}</p>}
                  </div>
                ))}
              </div>
            )}

            {tab === 'students' && (
              <div className="space-y-3">
                <p className="text-xs text-[#93a9d1]">Итог считается по плюсам: сделал «+», не сделал «−». Оценка в журнал: 5 ≥ 90%, 4 ≥ 70%, 3 ≥ 50%, иначе 2. Можно переопределить вручную.</p>
                {(l.students ?? []).length === 0 && (
                  <p className="text-[#93a9d1] text-sm glass rounded-xl p-4">Ещё никто не вошёл.</p>
                )}
                {(l.students ?? []).map(s => (
                  <div key={s.session_id} className="glass rounded-xl p-4 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[150px]">
                      <div className="font-semibold">
                        {s.display_name} {s.is_completed && <CheckCircle2 size={14} className="inline text-[#a3e635]" />}
                      </div>
                      <div className="text-xs text-[#93a9d1]">задание {Math.min(s.current_task_index + 1, Math.max(l.task_count, 1))} из {l.task_count}</div>
                    </div>
                    <div className="font-mono text-sm flex items-center gap-1.5" title="плюсы / минусы">
                      <span className="text-[#a3e635] font-extrabold">+{s.plus}</span>
                      <span className="text-[#f43f5e] font-extrabold">−{s.minus}</span>
                      <span className="text-[#93a9d1] text-xs">/ {s.total_tasks}</span>
                    </div>
                    <GradeConverter s={s} onSaved={load} />
                    <button className="neon px-3 py-1.5 rounded-lg text-xs flex items-center gap-1" onClick={() => setViewWork({ sessionId: s.session_id, name: s.display_name })}>
                      <Eye size={13} /> Работы
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {editing && (
          <TaskModal lessonId={id} task={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
        )}
        {adding && addMode === 'manual' && (
          <TaskModal lessonId={id} task={null} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />
        )}
        {adding && addMode === 'ai' && (
          <AiTasksModal lessonId={id} classId={l?.class_id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />
        )}
        {viewWork && (
          <StudentWorkViewer sessionId={viewWork.sessionId} studentName={viewWork.name} onClose={() => { setViewWork(null); load() }} />
        )}
      </div>
    </div>,
    document.body
  )
}