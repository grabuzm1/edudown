import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { teacherApi, errText } from '../../api'
import { useToast } from '../../context/ToastContext'
import Modal from '../../components/Modal'

const LETTERS = ['А','Б','В','Г','Д','Е','Ж','З','И','К','Л','М','Н']
const NUMBERS = Array.from({ length: 11 }, (_, i) => i + 1)

export default function ClassFormModal({ classId, onClose, onDone }: { classId?: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(!!classId)
  const [number, setNumber] = useState(5)
  const [letter, setLetter] = useState('А')
  const [hasCustomName, setHasCustomName] = useState(false)
  const [customName, setCustomName] = useState('')
  const [note, setNote] = useState('')
  const [studentCount, setStudentCount] = useState(1)
  const [students, setStudents] = useState<{ surname: string; name: string }[]>([{ surname: '', name: '' }])
  const [busy, setBusy] = useState(false)
  const surnameRefs = useRef<(HTMLInputElement | null)[]>([])
  const nameRefs = useRef<(HTMLInputElement | null)[]>([])

  // Загружаем ПОЛНЫЕ данные класса (ученики не сбрасываются!)
  useEffect(() => {
    if (!classId) return
    teacherApi.classDetail(classId).then(d => {
      setNumber(d.number); setLetter(d.letter)
      setHasCustomName(!!d.custom_name); setCustomName(d.custom_name || '')
      setNote(d.note || '')
      const list = (d.students ?? []).map(s => ({ surname: s.surname, name: s.name }))
      setStudents(list.length ? list : [{ surname: '', name: '' }])
      setStudentCount(list.length || 1)
    }).catch(e => toast(errText(e), 'err')).finally(() => setLoading(false))
  }, [classId, toast])

  const changeCount = (n: number) => {
    n = Math.max(1, Math.min(40, n))
    setStudentCount(n)
    setStudents(prev => {
      const arr = [...prev]
      while (arr.length < n) arr.push({ surname: '', name: '' })
      while (arr.length > n) arr.pop()
      return arr
    })
  }

  const update = (i: number, field: 'surname' | 'name', value: string) => {
    setStudents(prev => prev.map((s, j) => j === i ? { ...s, [field]: value } : s))
  }

  const handleKeyDown = (e: React.KeyboardEvent, i: number, field: 'surname' | 'name') => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (field === 'surname') nameRefs.current[i]?.focus()
    else surnameRefs.current[i + 1]?.focus()
  }

  const submit = async () => {
    const valid = students.filter(s => s.surname.trim() && s.name.trim())
    if (valid.length === 0) { toast('Добавь хотя бы одного ученика', 'err'); return }
    setBusy(true)
    try {
      const payload = { number, letter, custom_name: hasCustomName ? customName : null, note, students: valid }
      if (classId) await teacherApi.patchClass(classId, payload)
      else await teacherApi.createClass(payload)
      toast(classId ? 'Класс обновлён' : 'Класс создан'); onDone()
    } catch (e) { toast(errText(e), 'err') } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title={classId ? 'Редактировать класс' : 'Новый класс'}>
      {loading ? <Loader2 className="animate-spin mx-auto my-10" /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#93a9d1] mb-1 block">Номер класса</label>
              <select className="field" value={number} onChange={e => setNumber(Number(e.target.value))}>
                {NUMBERS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#93a9d1] mb-1 block">Буква</label>
              <select className="field" value={letter} onChange={e => setLetter(e.target.value)}>
                {LETTERS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={hasCustomName} onChange={e => setHasCustomName(e.target.checked)} className="w-4 h-4" />
              <span className="text-sm">Добавить индивидуальное название</span>
            </label>
            {hasCustomName && <input className="field mt-2" placeholder="Например: физмат" value={customName} onChange={e => setCustomName(e.target.value)} />}
          </div>
          <div>
            <label className="text-xs text-[#93a9d1] mb-1 block">Заметки (видно только тебе)</label>
            <textarea className="field min-h-[60px]" placeholder="Что подтянуть, особенности класса…" value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[#93a9d1] mb-1 block">Количество учеников: {studentCount}</label>
            <input type="number" min={1} max={40} value={studentCount} onChange={e => changeCount(Number(e.target.value))} className="field" />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-[#93a9d1]">Ученики (Enter: фамилия → имя → следующая строка)</label>
            {students.map((s, i) => (
              <div key={i} className="flex gap-2 items-center glass rounded-xl px-3 py-2">
                <span className="text-xs text-[#93a9d1] w-6">{i + 1}.</span>
                <input ref={el => { surnameRefs.current[i] = el }} className="field !py-1.5 flex-1" placeholder="Фамилия"
                  value={s.surname} onChange={e => update(i, 'surname', e.target.value)} onKeyDown={e => handleKeyDown(e, i, 'surname')} />
                <input ref={el => { nameRefs.current[i] = el }} className="field !py-1.5 flex-1" placeholder="Имя"
                  value={s.name} onChange={e => update(i, 'name', e.target.value)} onKeyDown={e => handleKeyDown(e, i, 'name')} />
              </div>
            ))}
          </div>
          {classId && <p className="text-xs text-[#fbbf24]">⚠ Сохранение пересоздаёт список учеников — коды учеников обновятся.</p>}
          <button className="neon w-full py-2.5 rounded-xl" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="animate-spin inline" size={16} /> : classId ? 'Сохранить изменения' : 'Создать класс'}
          </button>
        </div>
      )}
    </Modal>
  )
}