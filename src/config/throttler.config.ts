import { registerAs } from '@nestjs/config';

export const ThrottlerConfig = registerAs('throttler', () => ({
  throttlers: [
    {
      ttl: parseInt(process.env.THROTTLE_TTL, 10) || 60000, // 1 minute
      limit: parseInt(process.env.THROTTLE_LIMIT, 10) || 100, // 100 requests per minute
    },
  ],
}));
