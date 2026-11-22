import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { Archive, BookOpen, LogOut, Moon, Sun, Users } from 'lucide-react'
import { teacherApi } from '../api'
import { useTheme } from '../context/ThemeContext'

export default function TeacherPanel() {
  const nav = useNavigate()
  const { theme, toggle } = useTheme()
  const [me, setMe] = useState('')
  const token = localStorage.getItem('teacher_token')
  useEffect(() => { if (token) teacherApi.me().then(m => setMe(m.full_name)).catch(() => {}) }, [token])
  if (!token) return <Navigate to="/auth" replace />

  const tabs = [
    ['lessons', 'Уроки', BookOpen],
    ['classes', 'Классы', Users],
    ['archive', 'Архив', Archive],
  ] as const

  return (
    <div className="rise space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold">Панель учителя</h2>
          <p className="text-sm text-[#93a9d1]">{me}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="ghost p-2 rounded-xl" onClick={toggle}>{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button>
          <button className="ghost px-3 py-2 rounded-xl flex items-center gap-2"
            onClick={() => { localStorage.removeItem('teacher_token'); nav('/auth') }}>
            <LogOut size={16} /> Выйти
          </button>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {tabs.map(([k, label, Icon]) => (
          <NavLink key={k} to={`/teacher/${k}`}
            className={({ isActive }) => `ghost px-4 py-2 rounded-xl text-sm flex items-center gap-2 ${isActive ? '!bg-[rgba(79,125,255,.28)] !text-white' : ''}`}>
            <Icon size={15} /> {label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  )
}