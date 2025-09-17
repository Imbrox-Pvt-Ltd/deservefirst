import { registerAs } from '@nestjs/config';

export const DatabaseConfig = registerAs('database', () => ({
  type: process.env.DB_TYPE || 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10) || 3306,
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || 'root',
  name: process.env.DB_NAME || 'deservefirst',
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV === 'development',
  maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS, 10) || 10,
  ssl: process.env.DB_SSL === 'true',
}));
