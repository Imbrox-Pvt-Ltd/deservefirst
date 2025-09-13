export const MemoryProvider = {
  cache: new Map<string, { value: any; expires?: number }>(),

  configure: (config: any) => {
    // Memory cache doesn't need configuration
  },

  get: async (key: string) => {
    const item = MemoryProvider.cache.get(key);
    if (!item) return null;
    
    if (item.expires && Date.now() > item.expires) {
      MemoryProvider.cache.delete(key);
      return null;
    }
    
    return item.value;
  },

  set: async (key: string, value: any, ttl?: number) => {
    const expires = ttl ? Date.now() + (ttl * 1000) : undefined;
    MemoryProvider.cache.set(key, { value, expires });
  },
};

export { MemoryProvider as CacheProvider };