import { useState } from 'react'
import { teacherApi, errText, type Task } from '../../api'
import { useToast } from '../../context/ToastContext'
import Modal from '../../components/Modal'

export default function TaskModal({ lessonId, task, onClose, onSaved }: { lessonId: string; task: Task | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ title: task?.title ?? '', description: task?.description ?? '', starter_code: task?.starter_code ?? '', ai_criteria: task?.ai_criteria ?? '' })
  const save = async () => {
    if (!f.title.trim()) { toast('Нужно название', 'err'); return }
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
        <textarea className="field min-h-[80px]" placeholder="Текст задания" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
        <textarea className="field font-mono text-sm min-h-[70px]" placeholder="Стартовый код" value={f.starter_code} onChange={e => setF({ ...f, starter_code: e.target.value })} />
        <textarea className="field min-h-[60px]" placeholder="Критерии (например: 7; print)" value={f.ai_criteria} onChange={e => setF({ ...f, ai_criteria: e.target.value })} />
        <button className="neon w-full py-2.5 rounded-xl" onClick={save}>Сохранить</button>
      </div>
    </Modal>
  )
}