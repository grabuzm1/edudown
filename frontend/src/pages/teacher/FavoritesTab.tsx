import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Plus, Star, Trash2 } from 'lucide-react'
import { teacherApi, errText, type FavoriteItem, type Lesson } from '../../api'
import { useToast } from '../../context/ToastContext'
import Modal from '../../components/Modal'

export default function FavoritesTab() {
  const toast = useToast()
  const [favs, setFavs] = useState<FavoriteItem[]>([])
  const [creating, setCreating] = useState(false)
  const load = useCallback(async () => { try { setFavs(await teacherApi.favorites()) } catch (e) { toast(errText(e), 'err') } }, [toast])
  useEffect(() => { load() }, [load])
  const del = async (f: FavoriteItem) => {
    try { await teacherApi.deleteFavorite(f.id); load(); toast('Удалено') } catch (e) { toast(errText(e), 'err') }
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-[#93a9d1]">{favs.length} шаблонов</p>
        <button className="neon px-4 py-2 rounded-xl flex items-center gap-2" onClick={() => setCreating(true)}><Plus size={16} /> Сохранить шаблон</button>
      </div>
      {favs.length === 0 && <div className="glass rounded-2xl p-10 text-center text-[#93a9d1]">Нет шаблонов. Сохрани урок с хорошими заданиями.</div>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {favs.map(f => (
          <div key={f.id} className="glass card rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <h3 className="font-bold text-lg flex-1">{f.title}</h3>
              <Star size={18} className="text-[#fbbf24] fill-[#fbbf24]" />
            </div>
            <p className="text-sm text-[#93a9d1] line-clamp-2">{f.description || 'Без описания'}</p>
            <div className="text-xs text-[#93a9d1]"><BookOpen size={13} className="inline" /> {f.task_count} заданий</div>
            <button className="ghost px-3 py-2 rounded-lg text-sm !border-[rgba(244,63,94,.4)] !text-[#f43f5e]" onClick={() => del(f)}><Trash2 size={14} className="inline" /> Удалить</button>
          </div>
        ))}
      </div>
      {creating && <SaveFavoriteModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); load() }} />}
    </div>
  )
}

function SaveFavoriteModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { teacherApi.lessons().then(setLessons).catch(() => {}) }, [])

  const save = async () => {
    setBusy(true)
    try {
      const full = await teacherApi.lesson(selectedId)
      await teacherApi.createFavorite({
        title: title.trim() || full.title, description: full.description,
        tasks: (full.tasks ?? []).map(t => ({ title: t.title, description: t.description, starter_code: t.starter_code, ai_criteria: t.ai_criteria })),
      })
      toast('Шаблон сохранён'); onDone()
    } catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }
  return (
    <Modal onClose={onClose} title="Сохранить урок как шаблон">
      <div className="space-y-3">
        <select className="field" value={selectedId} onChange={e => { setSelectedId(e.target.value); const l = lessons.find(x => x.id === e.target.value); if (l) setTitle(l.title) }}>
          <option value="">— выбери урок —</option>
          {lessons.map(l => <option key={l.id} value={l.id}>{l.title} ({l.task_count} заданий)</option>)}
        </select>
        <input className="field" placeholder="Название шаблона" value={title} onChange={e => setTitle(e.target.value)} />
        <button className="neon w-full py-2.5 rounded-xl" onClick={save} disabled={busy || !selectedId}>Сохранить в избранное</button>
      </div>
    </Modal>
  )
}