export class I18n {
  static init(config: any) {
    I18nProvider.init(config);
  }

  static t(key: string, options?: any) {
    return I18nProvider.t(key, options);
  }
}

import { I18NextProvider } from './providers/I18NextProvider';

export let I18nProvider = I18NextProvider;
