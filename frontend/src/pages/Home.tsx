import { useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, CheckCircle2, GraduationCap, Sparkles, Star, Terminal, Users } from 'lucide-react'

export default function Home() {
  const nav = useNavigate()
  const features = [
    { icon: Sparkles, title: 'AI-проверка решений', text: 'Нейросеть оценивает код ученика по критериям, даёт обратную связь и баллы. Недоступна — учитель проверит вручную.' },
    { icon: Users, title: 'Классы и коды учеников', text: 'Создай класс, добавь учеников — каждый получит личный код. Ученик входит по коду и сразу видит свои активные уроки.' },
    { icon: Terminal, title: 'Живая песочница Python', text: 'Редактор как в IDE, запуск кода прямо в браузере урока, консоль с выводом и ошибками.' },
    { icon: Star, title: 'Архив и шаблоны', text: 'Сохраняй удачные уроки в избранное и переиспользуй задания. Архив уроков класса — опубликуй заново в один клик.' },
  ]
  const steps = [
    ['1', 'Создай урок', 'Вручную или сгенерируй задания через AI-конструктор'],
    ['2', 'Ученики входят', 'По коду урока или личному коду ученика из класса'],
    ['3', 'AI проверяет', 'Мгновенный вердикт, баллы и подсказки ученику'],
    ['4', 'Ты оцениваешь', 'Смотришь код и вывод, ставишь свою оценку: ++ / + / ± / − / −−'],
  ]
  return (
    <div className="rise space-y-16 py-6">
            <div className="max-w-3xl mx-auto glass rounded-2xl p-4 flex items-start gap-3" style={{ borderLeft: '4px solid #fbbf24' }}>
        <span className="text-xl leading-none">🛠️</span>
        <div className="text-sm">
          <div className="font-bold">Плановые работы на сервере</div>
          <p className="text-[#93a9d1] mt-1">
            25 ноября с 12:00 МСК (09:00 UTC) проводим плановые работы на стороне сервера — меняют оборудование на подстанции.
            Сайт и уроки могут быть временно недоступны (ориентировочно 5-20 минут). Все данные и работы учеников сохранятся.
          </p>
        </div>
      </div>
      {/* HERO */}
      <section className="text-center space-y-6 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 text-xs text-[#93a9d1]">
          <Sparkles size={13} className="text-[#4f7dff] hero-float" /> AI-платформа для уроков информатики
        </div>
        <h1 className="text-5xl sm:text-6xl font-extrabold leading-tight">
          Уроки Python,{' '}
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#4f7dff] via-[#8b5cf6] to-[#a3e635]">которые проверяют себя сами</span>
        </h1>
        <p className="text-lg text-[#93a9d1] max-w-xl mx-auto">
          Создавай задания за минуту, выдавай классу коды доступа и получай проверенные работы учеников — без ручной рутины.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <button className="neon px-6 py-3 rounded-xl font-semibold flex items-center gap-2"
            onClick={() => nav(localStorage.getItem('teacher_token') ? '/teacher' : '/auth')}>
            <BookOpen size={17} /> Начать как учитель <ArrowRight size={16} />
          </button>
          <button className="ghost px-6 py-3 rounded-xl font-semibold flex items-center gap-2"
            onClick={() => nav(localStorage.getItem('student_token') ? '/workspace' : '/join')}>
            <GraduationCap size={17} /> Я ученик — войти на урок
          </button>
        </div>
      </section>

      {/* FEATURES */}
      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {features.map(f => (
          <div key={f.title} className="glass feature-card rounded-2xl p-5 space-y-3">
            <f.icon size={26} className="text-[#4f7dff]" />
            <h3 className="font-bold">{f.title}</h3>
            <p className="text-sm text-[#93a9d1] leading-relaxed">{f.text}</p>
          </div>
        ))}
      </section>

      {/* HOW IT WORKS */}
      <section className="space-y-6">
        <h2 className="text-3xl font-extrabold text-center">Как это работает</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map(([n, title, text]) => (
            <div key={n} className="glass rounded-2xl p-5 space-y-2 relative overflow-hidden">
              <span className="absolute -top-3 -right-1 text-7xl font-extrabold opacity-10 select-none">{n}</span>
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#4f7dff] to-[#8b5cf6] text-white flex items-center justify-center font-bold text-sm">{n}</div>
              <h3 className="font-bold">{title}</h3>
              <p className="text-sm text-[#93a9d1]">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="glass rounded-3xl p-10 text-center space-y-4">
        <CheckCircle2 size={32} className="mx-auto text-[#a3e635]" />
        <h2 className="text-2xl font-extrabold">Готов провести первый урок?</h2>
        <p className="text-[#93a9d1] text-sm">Создай класс, сгенерируй задания через AI и раздай коды — всё за 5 минут.</p>
        <button className="neon px-8 py-3 rounded-xl font-semibold" onClick={() => nav('/auth')}>Создать аккаунт учителя</button>
      </section>

      <footer className="text-center text-xs text-[#5b6c92] pb-4">EduDown Pro · edu.imdown.pro</footer>
    </div>
  )
}