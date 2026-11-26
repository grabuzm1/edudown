import { Archive, Newspaper, Sparkles, Cpu } from 'lucide-react'

type UpdateItem = {
  date: string
  icon: any
  title: string
  text: string
  badge?: 'new' | 'tech'
}

const ITEMS: UpdateItem[] = [
  {
    date: '26.11.2026',
    icon: Cpu,
    title: 'Улучшение нейросети',
    text: 'Сменили модель российского GigaChat на ChatGPT 6. Проверка и генерация задач стали заметно точнее. Нейросеть теперь лучше понимает контекст заданий и работает строго в рамках выбранного класса.',
    badge: 'tech'
  },
  {
    date: '23.11.2026',
    icon: Archive,
    title: 'Архив и режим тренировок',
    text: 'Архив позволяет учителям восстанавливать старые уроки и привязывать их к новым классам. Режим тренировки дает ученикам возможность решать случайные задачи по программе их класса без привязки к уроку.',
    badge: 'new'
  },
  {
    date: '23.11.2026',
    icon: Sparkles,
    title: 'Релиз сайта EduDown Pro',
    text: 'Официальный запуск платформы. Учителя создают уроки, ученики решают задачи прямо в браузере, а AI проверяет код и выставляет оценки.',
  },
]

export default function Updates() {
  return (
    <div className="rise max-w-3xl mx-auto space-y-6 py-6">
      {/* Заголовок */}
      <div className="border-b border-white/10 pb-6 mb-8">
        <h2 className="text-3xl font-extrabold flex items-center gap-2 text-[#1a1f2e]">
          <Newspaper size={26} className="text-[#ff7a00]" /> Что нового
        </h2>
        <p className="text-sm text-[#6b7a99] mt-1">История обновлений платформы EduDown Pro.</p>
      </div>

      {/* Плашки обновлений */}
      <div className="space-y-5">
        {ITEMS.map((it, i) => (
          <div key={i} className="glass rounded-2xl p-6 transition-all hover:border-[#ff7a00]/50 hover:shadow-lg hover:shadow-[#ff7a00]/5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#ff7a00]/10 border border-[#ff7a00]/20 flex items-center justify-center flex-shrink-0 text-[#ff7a00]">
                  <it.icon size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-[#1a1f2e] leading-tight">{it.title}</h3>
                  <div className="text-xs font-mono text-[#6b7a99] mt-0.5">{it.date}</div>
                </div>
              </div>
              {it.badge && (
                <span className={`text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-md border ${
                  it.badge === 'new' ? 'bg-[#16a34a]/10 text-[#16a34a] border-[#16a34a]/30' :
                  'bg-white/10 text-[#6b7a99] border-white/20'
                }`}>
                  {it.badge === 'new' ? 'New' : 'Tech'}
                </span>
              )}
            </div>
            <p className="text-sm text-[#4a5568] leading-relaxed pl-[52px]">{it.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}