export class Cache {
  static async get(key: string) {
    return CacheProvider.get(key);
  }

  static async set(key: string, value: any, ttl?: number) {
    return CacheProvider.set(key, value, ttl);
  }
}

import { MemoryProvider } from './providers/MemoryProvider';

export let CacheProvider = MemoryProvider;
