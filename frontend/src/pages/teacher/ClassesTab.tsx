import { useCallback, useEffect, useState } from 'react'
import { Eye, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { teacherApi, errText, type ClassItem } from '../../api'
import { useToast } from '../../context/ToastContext'
import ClassFormModal from './ClassFormModal'
import ClassViewer from './ClassViewer'

export default function ClassesTab() {
  const toast = useToast()
  const [classes, setClasses] = useState<ClassItem[]>([])
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<ClassItem | null>(null)
  const [editing, setEditing] = useState<ClassItem | null>(null)

  const load = useCallback(async () => { try { setClasses(await teacherApi.classes()) } catch (e) { toast(errText(e), 'err') } }, [toast])
  useEffect(() => { load() }, [load])

  const del = async (c: ClassItem) => {
    if (!confirm(`Удалить класс ${c.display_name}?`)) return
    try { await teacherApi.deleteClass(c.id); load(); toast('Класс удалён') } catch (e) { toast(errText(e), 'err') }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-[#93a9d1]">{classes.length} классов</p>
        <button className="neon px-4 py-2 rounded-xl flex items-center gap-2" onClick={() => setCreating(true)}><Plus size={16} /> Создать класс</button>
      </div>
      {classes.length === 0 && <div className="glass rounded-2xl p-10 text-center text-[#93a9d1]">Нет классов. Создай первый!</div>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {classes.map(c => (
          <div key={c.id} className="glass card rounded-2xl p-5 flex flex-col gap-3 cursor-pointer hover:border-[#4f7dff] transition" onClick={() => setViewing(c)}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-2xl">{c.display_name}</h3>
                {c.note && <p className="text-xs text-[#93a9d1] mt-1 italic line-clamp-2">{c.note}</p>}
              </div>
              <button className="ghost p-2 rounded-lg" onClick={e => { e.stopPropagation(); setEditing(c) }} title="Редактировать"><Pencil size={16} /></button>
            </div>
            <div className="flex items-center gap-3 text-xs text-[#93a9d1]"><Users size={13} /> {c.student_count} учеников</div>
            <div className="flex gap-2 mt-auto">
              <button className="ghost flex-1 py-2 rounded-lg text-sm flex items-center justify-center gap-1" onClick={e => { e.stopPropagation(); setViewing(c) }}><Eye size={14} /> Открыть</button>
              <button className="ghost px-3 py-2 rounded-lg !border-[rgba(244,63,94,.4)] !text-[#f43f5e]" onClick={e => { e.stopPropagation(); del(c) }}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      {creating && <ClassFormModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); load() }} />}
      {editing && <ClassFormModal classId={editing.id} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} />}
      {viewing && <ClassViewer classId={viewing.id} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null) }} />}
    </div>
  )
}