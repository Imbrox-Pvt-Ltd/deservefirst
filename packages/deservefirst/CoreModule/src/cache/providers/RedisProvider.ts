import { createClient } from 'redis';
import { CacheProvider } from '../Cache';

let client: any;

export const RedisProvider = {
  configure: (config: { url: string }) => {
    client = createClient({ url: config.url });
    client.connect();
  },
  get: async (key: string) => {
    const value = await client.get(key);
    return value ? JSON.parse(value) : null;
  },
  set: async (key: string, value: any, ttl?: number) => {
    if (ttl) {
      await client.setEx(key, ttl, JSON.stringify(value));
    } else {
      await client.set(key, JSON.stringify(value));
    }
  },
};

export { RedisProvider as CacheProvider };
