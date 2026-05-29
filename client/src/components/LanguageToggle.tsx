import { useTranslation } from 'react-i18next';

function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const toggle = () => {
    const next = i18n.language.startsWith('he') ? 'en' : 'he';
    void i18n.changeLanguage(next);
  };
  return (
    <button type="button" className="lang-toggle" onClick={toggle}>
      {t('language.switch')}
    </button>
  );
}

export default LanguageToggle;
