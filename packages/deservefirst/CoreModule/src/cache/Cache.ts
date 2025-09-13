export class Cache {
  static async get(key: string) {
    return CacheProvider.get(key);
  }

  static async set(key: string, value: any, ttl?: number) {
    return CacheProvider.set(key, value, ttl);
  }
}

export let CacheProvider = {
  configure: (config: any) => { throw new Error('CacheProvider not configured'); },
  get: async (key: string) => { throw new Error('CacheProvider not configured'); },
  set: async (key: string, value: any, ttl?: number) => { throw new Error('CacheProvider not configured'); },
};
