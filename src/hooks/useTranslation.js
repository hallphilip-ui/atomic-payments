import { translations } from '../locales';
export const useTranslation = () => {
  const lang = (navigator.language || 'en').split('-')[0];
  const dict = translations[lang] || translations.en;
  return (key) => dict[key] || key;
};
