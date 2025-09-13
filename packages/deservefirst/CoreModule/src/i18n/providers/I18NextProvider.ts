import i18next from 'i18next';
import { I18nProvider } from '../I18n';

export const I18NextProvider = {
  init: (config: any) => {
    i18next.init({
      lng: config.defaultLanguage || 'en',
      resources: config.resources || {},
    });
  },
  t: (key: string, options?: any) => i18next.t(key, options),
};

I18nProvider = I18NextProvider;
