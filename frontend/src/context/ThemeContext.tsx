import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

type Theme = 'light' | 'dark'

const DARK_PATHS = ['/teacher', '/workspace', '/practice']

const ThemeContext = createContext<{ theme: Theme; toggle: () => void; setTheme: (t: Theme) => void }>({
  theme: 'light', toggle: () => {}, setTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'))
  const { pathname } = useLocation()
  const darkAllowed = DARK_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  const effective: Theme = darkAllowed ? theme : 'light'

  useEffect(() => {
    document.documentElement.dataset.theme = effective
  }, [effective])

  useEffect(() => {
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggle = () => setTheme(t => (t === 'light' ? 'dark' : 'light'))

  return <ThemeContext.Provider value={{ theme: effective, toggle, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}