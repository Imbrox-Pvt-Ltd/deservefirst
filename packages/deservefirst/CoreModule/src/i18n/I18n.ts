export class I18n {
  static init(config: any) {
    I18nProvider.init(config);
  }

  static t(key: string, options?: any) {
    return I18nProvider.t(key, options);
  }
}

export let I18nProvider = {
  init: (config: any) => { throw new Error('I18nProvider not configured'); },
  t: (key: string, options?: any) => { throw new Error('I18nProvider not configured'); },
};
