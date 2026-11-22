import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Copy, Plus, Trash2, Users } from 'lucide-react'
import { teacherApi, errText, type Lesson, type ClassItem } from '../../api'
import { useToast } from '../../context/ToastContext'
import Modal from '../../components/Modal'
import LessonDrawer from './LessonDrawer'

export default function LessonsTab() {
  const toast = useToast()
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [classes, setClasses] = useState<ClassItem[]>([])
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setLessons(await teacherApi.lessons()); setClasses(await teacherApi.classes()) }
    catch (e) { toast(errText(e), 'err') }
  }, [toast])
  useEffect(() => { load() }, [load])

  const togglePublish = async (l: Lesson) => {
    setLessons(x => x.map(y => y.id === l.id ? { ...y, is_published: !l.is_published } : y))
    try { await teacherApi.publish(l.id, !l.is_published); toast(l.is_published ? 'Урок скрыт' : 'Урок опубликован') }
    catch (e) { toast(errText(e), 'err'); load() }
  }
  const remove = async (l: Lesson) => {
    if (!confirm(`Удалить урок «${l.title}»?`)) return
    setLessons(x => x.filter(y => y.id !== l.id))
    try { await teacherApi.deleteLesson(l.id); toast('Урок удалён') } catch (e) { toast(errText(e), 'err'); load() }
  }
  const copy = async (code: string) => { try { await navigator.clipboard.writeText(code); toast('Код скопирован') } catch { toast(code) } }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-[#93a9d1]">{lessons.length} уроков</p>
        <button className="neon px-4 py-2 rounded-xl flex items-center gap-2" onClick={() => setCreating(true)}><Plus size={16} /> Создать урок</button>
      </div>
      {lessons.length === 0 && <div className="glass rounded-2xl p-10 text-center text-[#93a9d1]">Нет уроков. Создай первый!</div>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {lessons.map(l => (
          <div key={l.id} className="glass card rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold text-lg leading-tight">{l.title}</h3>
              <span className={`badge ${l.is_published ? 'badge-live' : 'badge-draft'}`}>{l.is_published ? 'live' : 'draft'}</span>
            </div>
            <p className="text-sm text-[#93a9d1] line-clamp-2 min-h-[2.5rem]">{l.description || 'Без описания'}</p>
            <div className="flex items-center gap-3 text-xs text-[#93a9d1]">
              <span><BookOpen size={13} className="inline" /> {l.task_count} задан.</span>
              <span><Users size={13} className="inline" /> {l.student_count} учеников</span>
            </div>
            <button onClick={() => copy(l.access_code)} className="flex items-center justify-between bg-[#070b18] border border-[#233052] rounded-lg px-3 py-2 font-mono text-sm hover:border-[#4f7dff] transition">
              <span className="tracking-[.25em] text-[#a3e635]">{l.access_code}</span><Copy size={14} className="text-[#93a9d1]" />
            </button>
            <div className="flex gap-2 mt-auto">
              <button className="ghost flex-1 py-2 rounded-lg text-sm" onClick={() => setOpenId(l.id)}>Открыть</button>
              <button className="ghost px-3 py-2 rounded-lg text-sm" onClick={() => togglePublish(l)}>{l.is_published ? 'Скрыть' : 'Публиковать'}</button>
              <button className="ghost px-3 py-2 rounded-lg !border-[rgba(244,63,94,.4)] !text-[#f43f5e]" onClick={() => remove(l)}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>
      {creating && <CreateLessonModal classes={classes} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); load(); setOpenId(id) }} />}
      {openId && <LessonDrawer id={openId} onClose={() => { setOpenId(null); load() }} />}
    </div>
  )
}

function CreateLessonModal({ classes, onClose, onDone }: { classes: ClassItem[]; onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast()
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState('')
  const [classId, setClassId] = useState(''); const [level, setLevel] = useState('начинающий')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    if (!title.trim()) return
    setBusy(true)
    try {
      const l = await teacherApi.createLesson({ title: title.trim(), description: desc, class_id: classId || null, level })
      toast('Урок создан'); onDone(l.id)
    } catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }
  return (
    <Modal onClose={onClose} title="Новый урок">
      <div className="space-y-3">
        <input className="field" placeholder="Название урока" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
        <textarea className="field min-h-[80px]" placeholder="Описание" value={desc} onChange={e => setDesc(e.target.value)} />
        <div>
          <label className="text-xs text-[#93a9d1] mb-1 block">Привязать к классу (необязательно)</label>
          <select className="field" value={classId} onChange={e => setClassId(e.target.value)}>
            <option value="">— Обычный урок (без класса) —</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.display_name} ({c.student_count} учеников)</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[#93a9d1] mb-1 block">Уровень (для AI-генерации)</label>
          <select className="field" value={level} onChange={e => setLevel(e.target.value)}>
            <option>начинающий</option><option>средний</option><option>опытный</option>
          </select>
        </div>
        <button className="neon w-full py-2.5 rounded-xl" onClick={create} disabled={busy}>Создать и открыть</button>
      </div>
    </Modal>
  )
}