import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive, Loader2, RotateCcw, Trash2, Users } from 'lucide-react'
import { teacherApi, errText, type ClassItem, type Lesson } from '../../api'
import { useToast } from '../../context/ToastContext'

export default function ArchiveTab() {
  const toast = useToast()
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [classes, setClasses] = useState<ClassItem[]>([])
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<Lesson | null>(null)
  const [title, setTitle] = useState('')
  const [classId, setClassId] = useState('')

  const load = useCallback(() => {
    Promise.all([teacherApi.archivedLessons(), teacherApi.classes()])
      .then(([l, c]) => { setLessons(l); setClasses(c) })
      .catch(e => toast(errText(e), 'err'))
  }, [])
  useEffect(() => { load() }, [load])

  const className = (id?: string | null) => classes.find(c => c.id === id)?.display_name || 'без класса'

  const openRepublish = (l: Lesson) => {
    setModal(l); setTitle(l.title); setClassId('')
  }

  const republish = async () => {
    if (!modal) return
    setBusy(true)
    try {
      await teacherApi.republishLesson(modal.id, { new_title: title.trim() || modal.title, class_id: classId || null })
      toast('Урок опубликован заново')
      setModal(null)
      load()
    } catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }

  const remove = async (l: Lesson) => {
    if (!confirm(`Удалить архивный урок «${l.title}» безвозвратно?`)) return
    setBusy(true)
    try { await teacherApi.deleteLesson(l.id); toast('Удалено'); load() }
    catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2"><Archive size={18} /> Архив уроков</h3>
        <p className="text-sm text-[#93a9d1]">Архивные уроки класса. «Достать» = опубликовать копию со всеми заданиями и привязать к нужному классу.</p>
      </div>

      {lessons.length === 0 && <div className="glass rounded-2xl p-10 text-center text-[#93a9d1]">Архив пуст.</div>}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {lessons.map(l => (
          <div key={l.id} className="glass rounded-2xl p-5 flex flex-col gap-3">
            <h4 className="font-bold leading-tight">{l.title}</h4>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#93a9d1]">
              <span className="flex items-center gap-1"><Users size={13} /> {className(l.class_id)}</span>
              <span>{l.task_count} задан.</span>
              <span>{l.student_count} учен.</span>
            </div>
            <div className="flex gap-2 mt-auto">
              <button className="neon flex-1 py-2 rounded-lg text-sm flex items-center justify-center gap-1" onClick={() => openRepublish(l)}>
                <RotateCcw size={14} /> Достать
              </button>
              <button className="ghost px-3 py-2 rounded-lg !text-[#f43f5e]" onClick={() => remove(l)} disabled={busy}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      {modal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setModal(null)}>
          <div className="glass pop rounded-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h4 className="text-lg font-bold">Опубликовать заново</h4>
            <p className="text-sm text-[#93a9d1]">
              Создастся копия урока со всеми заданиями. Заданий: {modal.task_count}. Старый класс: {className(modal.class_id)}.
            </p>
            <div>
              <label className="text-xs text-[#93a9d1] mb-1 block">Название</label>
              <input className="field" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[#93a9d1] mb-1 block">Привязать к классу</label>
              <select className="field" value={classId} onChange={e => setClassId(e.target.value)}>
                <option value="">— не привязывать (обычный урок по коду) —</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button className="ghost flex-1 py-2.5 rounded-xl" onClick={() => setModal(null)}>Отмена</button>
              <button className="neon flex-1 py-2.5 rounded-xl flex items-center justify-center gap-2" onClick={republish} disabled={busy}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Опубликовать
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}