import i18next from 'i18next';
import { I18nProvider } from '../I18n';

export const I18NextProvider = {
  configure: (config: any) => {
    // Configuration method for compatibility
  },
  init: (config: any) => {
    i18next.init({
      lng: config.defaultLanguage || 'en',
      resources: config.resources || {},
    });
  },
  t: (key: string, options?: any) => i18next.t(key, options),
};

export { I18NextProvider as I18nProvider };
