import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { BookOpen, GraduationCap, Sparkles } from 'lucide-react'

export default function Layout() {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const isTeacher = pathname.startsWith('/teacher') || pathname === '/auth'
  const isStudent = pathname.startsWith('/join') || pathname.startsWith('/workspace')
  return (
    <div className="min-h-screen">
      <div className="aurora" /><div className="grain" />
      <header className="fixed top-0 inset-x-0 z-40 glass border-x-0 border-t-0">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => nav('/')} className="flex items-center gap-2 font-extrabold tracking-tight text-lg">
            <Sparkles size={18} className="text-[#4f7dff]" />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#4f7dff] to-[#8b5cf6]">EduDown</span>
            <span className="text-[#93a9d1] font-medium text-sm hidden sm:inline">pro</span>
          </button>
          <nav className="flex items-center gap-2">
            <button onClick={() => nav(localStorage.getItem('teacher_token') ? '/teacher' : '/auth')}
              className={`ghost px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${isTeacher ? '!bg-[rgba(79,125,255,.28)] !text-white' : ''}`}>
              <BookOpen size={14} /> Учитель
            </button>
            <button onClick={() => nav(localStorage.getItem('student_token') ? '/workspace' : '/join')}
              className={`ghost px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${isStudent ? '!bg-[rgba(79,125,255,.28)] !text-white' : ''}`}>
              <GraduationCap size={14} /> Ученик
            </button>
          </nav>
        </div>
      </header>
      <main className="pt-20 pb-16 px-4 max-w-7xl mx-auto">
        <Outlet />
      </main>
    </div>
  )
}