import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load the .env file from the repository root if there is one.
const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and edit it.');
}

const port = Number(process.env.API_PORT ?? 3001);

export const config = {
  databaseUrl,
  port,
  host: process.env.API_HOST ?? '127.0.0.1',
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',').map((s) => s.trim()).filter(Boolean),
  imagesDir: process.env.IMAGES_DIR || null,
  imageBaseUrl: (process.env.IMAGE_BASE_URL ?? `http://localhost:${port}/images`).replace(/\/+$/, ''),
};
