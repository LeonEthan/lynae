import { defineConfig } from 'drizzle-kit';
import { join } from 'path';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL || join(process.cwd(), 'data.db'),
  },
});
