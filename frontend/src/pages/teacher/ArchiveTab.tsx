import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, Eye, Loader2, RotateCcw, X } from 'lucide-react'
import { teacherApi, errText, type Lesson } from '../../api'
import { useToast } from '../../context/ToastContext'

export default function ArchiveTab() {
  const toast = useToast()
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const load = useCallback(async () => { try { setLessons(await teacherApi.archivedLessons()) } catch (e) { toast(errText(e), 'err') } }, [toast])
  useEffect(() => { load() }, [load])

  const republish = async (l: Lesson) => {
    const t = prompt('Новое название (пусто = старое):', l.title)
    if (t === null) return
    try { await teacherApi.republishLesson(l.id, t || undefined); toast('Опубликован заново'); load() }
    catch (e) { toast(errText(e), 'err') }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#93a9d1]">Архив уроков классов ({lessons.length})</p>
      {lessons.length === 0 && <div className="glass rounded-2xl p-10 text-center text-[#93a9d1]">Архив пуст.</div>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {lessons.map(l => (
          <div key={l.id} className="glass card rounded-2xl p-5 flex flex-col gap-3">
            <h3 className="font-bold text-lg">{l.title}</h3>
            <p className="text-sm text-[#93a9d1] line-clamp-2">{l.description}</p>
            <div className="text-xs text-[#93a9d1]"><BookOpen size={13} className="inline" /> {l.task_count} заданий · {l.student_count} учеников</div>
            <div className="flex gap-2 mt-auto">
              <button className="ghost flex-1 py-2 rounded-lg text-sm flex items-center justify-center gap-1" onClick={() => setOpenId(l.id)}><Eye size={14} /> Смотреть</button>
              <button className="neon px-3 py-2 rounded-lg text-sm flex items-center gap-1" onClick={() => republish(l)}><RotateCcw size={14} /> Заново</button>
            </div>
          </div>
        ))}
      </div>
      {openId && <ArchiveViewer id={openId} onClose={() => { setOpenId(null); load() }} />}
    </div>
  )
}

function ArchiveViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast()
  const [l, setL] = useState<Lesson | null>(null)
  useEffect(() => { teacherApi.lesson(id).then(setL).catch(e => toast(errText(e), 'err')) }, [id, toast])
  useEffect(() => {
    const p = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = p }
  }, [])
  const save = async () => {
    if (!l) return
    try { await teacherApi.patchLesson(l.id, { title: l.title, description: l.description }); toast('Название и описание сохранены') }
    catch (e) { toast(errText(e), 'err') }
  }
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="slidein glass h-full w-full max-w-2xl border-y-0 border-r-0 overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        {!l ? <Loader2 className="animate-spin mx-auto mt-20" /> : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-2">
                <label className="text-xs text-[#93a9d1]">Название (можно менять)</label>
                <input className="field font-bold text-lg" value={l.title} onChange={e => setL({ ...l, title: e.target.value })} />
                <label className="text-xs text-[#93a9d1]">Описание (можно менять)</label>
                <textarea className="field text-sm" value={l.description} onChange={e => setL({ ...l, description: e.target.value })} />
                <button className="ghost px-3 py-1.5 rounded-lg text-sm" onClick={save}>Сохранить</button>
              </div>
              <button className="ghost p-2 rounded-lg" onClick={onClose}><X size={16} /></button>
            </div>
            <div className="text-xs text-[#93a9d1] uppercase tracking-widest">Задания (только просмотр)</div>
            {(l.tasks ?? []).length === 0 && <p className="text-sm text-[#93a9d1] glass rounded-xl p-4">Нет заданий.</p>}
            {(l.tasks ?? []).map((t, i) => (
              <div key={t.id} className="glass rounded-xl p-4 space-y-2 opacity-90">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-[#4f7dff]">#{i + 1}</span>
                  <span className="font-semibold flex-1">{t.title}</span>
                </div>
                <p className="text-sm text-[#93a9d1] whitespace-pre-wrap">{t.description}</p>
                {t.starter_code && <pre className="font-mono text-xs bg-[#070b18] p-2 rounded-lg text-[#93a9d1] whitespace-pre-wrap">{t.starter_code}</pre>}
                {t.ai_criteria && <p className="text-xs text-[#fbbf24]">Критерий: {t.ai_criteria}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>, document.body)
}