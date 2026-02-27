// Settings repository - handles application settings CRUD operations
import { eq } from 'drizzle-orm';
import { DatabaseConnection } from '../db.js';
import { settings, Setting, NewSetting } from '../schema/index.js';

export interface SettingsRepository {
  get<T>(key: string, defaultValue?: T): Promise<T | undefined>;
  getAll(): Promise<Record<string, unknown>>;
  set<T>(key: string, value: T): Promise<void>;
  setMultiple(values: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
}

export function createSettingsRepository(connection: DatabaseConnection): SettingsRepository {
  const { db } = connection;

  return {
    async get<T>(key: string, defaultValue?: T): Promise<T | undefined> {
      const result = await db.query.settings.findFirst({
        where: eq(settings.key, key),
      });

      if (!result) {
        return defaultValue;
      }

      return result.value as T;
    },

    async getAll(): Promise<Record<string, unknown>> {
      const allSettings = await db.query.settings.findMany();

      return allSettings.reduce(
        (acc, setting) => {
          acc[setting.key] = setting.value;
          return acc;
        },
        {} as Record<string, unknown>
      );
    },

    async set<T>(key: string, value: T): Promise<void> {
      const existing = await db.query.settings.findFirst({
        where: eq(settings.key, key),
      });

      if (existing) {
        await db
          .update(settings)
          .set({ value, updatedAt: new Date() })
          .where(eq(settings.key, key));
      } else {
        await db.insert(settings).values({
          key,
          value,
          updatedAt: new Date(),
        });
      }
    },

    async setMultiple(values: Record<string, unknown>): Promise<void> {
      const now = new Date();

      for (const [key, value] of Object.entries(values)) {
        const existing = await db.query.settings.findFirst({
          where: eq(settings.key, key),
        });

        if (existing) {
          await db
            .update(settings)
            .set({ value, updatedAt: now })
            .where(eq(settings.key, key));
        } else {
          await db.insert(settings).values({
            key,
            value,
            updatedAt: now,
          });
        }
      }
    },

    async delete(key: string): Promise<boolean> {
      const result = await db.delete(settings).where(eq(settings.key, key));
      return result.changes > 0;
    },

    async has(key: string): Promise<boolean> {
      const result = await db.query.settings.findFirst({
        where: eq(settings.key, key),
      });
      return !!result;
    },
  };
}
