'use client'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { ar } from './translations/ar'
import { en } from './translations/en'

type Lang = 'ar' | 'en'
type Theme = 'light' | 'dark'

const translations: Record<Lang, Record<string, string>> = { ar, en }

interface AppContextType {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string) => string
  dir: 'rtl' | 'ltr'
  theme: Theme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
}

const AppContext = createContext<AppContextType>({
  lang: 'ar',
  setLang: () => {},
  t: (key: string) => key,
  dir: 'rtl',
  theme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ar')
  const [theme, setThemeState] = useState<Theme>('light')

  useEffect(() => {
    const savedLang = localStorage.getItem('lang') as Lang | null
    if (savedLang && (savedLang === 'ar' || savedLang === 'en')) setLangState(savedLang)

    const savedTheme = localStorage.getItem('theme') as Theme | null
    if (savedTheme) {
      setThemeState(savedTheme)
      document.documentElement.classList.toggle('dark', savedTheme === 'dark')
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setThemeState('dark')
      document.documentElement.classList.add('dark')
    }
  }, [])

  function setLang(l: Lang) {
    setLangState(l)
    localStorage.setItem('lang', l)
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = l
  }

  function setTheme(t: Theme) {
    setThemeState(t)
    localStorage.setItem('theme', t)
    document.documentElement.classList.toggle('dark', t === 'dark')
  }

  function toggleTheme() {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }

  function t(key: string): string {
    return translations[lang][key] || key
  }

  return (
    <AppContext.Provider value={{ lang, setLang, t, dir: lang === 'ar' ? 'rtl' : 'ltr', theme, setTheme, toggleTheme }}>
      {children}
    </AppContext.Provider>
  )
}

export function useLanguage() {
  return useContext(AppContext)
}
