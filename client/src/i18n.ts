import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'
import he from './locales/he.json'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      he: { translation: he },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'he'],
    interpolation: { escapeValue: false },
  })

const applyDirection = (lng: string) => {
  document.documentElement.lang = lng
  document.documentElement.dir = i18n.dir(lng)
}

applyDirection(i18n.resolvedLanguage ?? 'en')
i18n.on('languageChanged', applyDirection)

export default i18n
