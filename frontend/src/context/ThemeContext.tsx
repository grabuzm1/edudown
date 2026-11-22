import { createContext, useContext, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

type Theme = 'light' | 'dark'
const ThemeContext = createContext<{ theme: Theme; toggle: () => void; canToggle: boolean }>({
  theme: 'light', toggle: () => {}, canToggle: false,
})
export const useTheme = () => useContext(ThemeContext)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  // Тёмная тема разрешена ТОЛЬКО в панели учителя и воркспейсе
  const canToggle = pathname.startsWith('/teacher') || pathname.startsWith('/workspace')
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('edu_theme') as Theme) || 'light')

  useEffect(() => {
    document.documentElement.dataset.theme = canToggle ? theme : 'light'
    localStorage.setItem('edu_theme', theme)
  }, [theme, canToggle])

  const toggle = () => setTheme(t => (t === 'light' ? 'dark' : 'light'))
  return <ThemeContext.Provider value={{ theme, toggle, canToggle }}>{children}</ThemeContext.Provider>
}