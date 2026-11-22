import { useEffect, useState } from 'react'
import { Copy, Loader2, Pencil } from 'lucide-react'
import { teacherApi, errText, type ClassItem } from '../../api'
import { useToast } from '../../context/ToastContext'
import Modal from '../../components/Modal'

export default function ClassViewer({ classId, onClose, onEdit }: { classId: string; onClose: () => void; onEdit: () => void }) {
  const toast = useToast()
  const [detail, setDetail] = useState<ClassItem | null>(null)
  useEffect(() => { teacherApi.classDetail(classId).then(setDetail).catch(e => toast(errText(e), 'err')) }, [classId, toast])
  const copyCode = async (code: string) => { try { await navigator.clipboard.writeText(code); toast('Код скопирован') } catch { toast(code) } }

  return (
    <Modal onClose={onClose} title={detail ? `Класс ${detail.display_name}` : 'Класс'}>
      {!detail ? <Loader2 className="animate-spin mx-auto my-10" /> : (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-[#93a9d1]">{detail.students?.length ?? 0} учеников</span>
            <button className="ghost px-3 py-1.5 rounded-lg text-sm flex items-center gap-1" onClick={onEdit}><Pencil size={14} /> Редактировать</button>
          </div>
          {detail.note && <div className="glass rounded-xl p-3 text-sm"><span className="text-xs text-[#93a9d1]">Заметки: </span>{detail.note}</div>}
          <div className="space-y-2">
            {(detail.students ?? []).map((s, i) => (
              <div key={s.id} className="glass rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-[#93a9d1] w-6">{i + 1}.</span>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{s.surname} {s.name}</div>
                    <div className="text-xs text-[#93a9d1]">{s.has_account ? '✓ есть аккаунт' : '✗ нет аккаунта'}</div>
                  </div>
                </div>
                <button onClick={() => copyCode(s.student_code)} className="font-mono text-sm bg-[#070b18] border border-[#233052] rounded-lg px-3 py-1.5 hover:border-[#4f7dff] transition flex items-center gap-2 shrink-0">
                  <span className="tracking-[.2em] text-[#a3e635]">{s.student_code}</span><Copy size={12} className="text-[#93a9d1]" />
                </button>
              </div>
            ))}
            {(detail.students ?? []).length === 0 && <p className="text-sm text-[#93a9d1] glass rounded-xl p-4">Нет учеников.</p>}
          </div>
        </div>
      )}
    </Modal>
  )
}