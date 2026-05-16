// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/core';
import { createAdapterFactory } from 'better-auth/adapters';
import type { CleanedWhere } from 'better-auth/adapters';
import { SystemObjectName } from '@objectstack/spec/system';

/**
 * Mapping from better-auth model names to ObjectStack protocol object names.
 *
 * better-auth uses hardcoded model names ('user', 'session', 'account', 'verification')
 * while ObjectStack's protocol layer uses `sys_` prefixed names. This map bridges the two.
 */
export const AUTH_MODEL_TO_PROTOCOL: Record<string, string> = {
  user: SystemObjectName.USER,
  session: SystemObjectName.SESSION,
  account: SystemObjectName.ACCOUNT,
  verification: SystemObjectName.VERIFICATION,
};

/**
 * Resolve a better-auth model name to the ObjectStack protocol object name.
 * Falls back to the original model name for custom / non-core models.
 */
export function resolveProtocolName(model: string): string {
  return AUTH_MODEL_TO_PROTOCOL[model] ?? model;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * better-auth datetime columns (snake_case) per model.
 *
 * When the underlying driver stored these as JavaScript `Date` objects
 * (legacy behaviour), the libsql HTTP transport coerces the value to a REAL
 * column and round-trips it as a string like `"1779497911249.0"`. That
 * string is not a valid Date string (it has a trailing `.0`), so
 * `new Date(...)` produces `Invalid Date` and better-auth's client treats
 * the session as expired — causing a login/redirect loop.
 *
 * We normalise these legacy values back to ISO strings on **read** so the
 * factory's `supportsDates: false` parser can turn them into real Date
 * objects. New writes always go through better-auth's own
 * `Date → ISO string` conversion (because we declare `supportsDates: false`
 * below), so no further `.0`-suffixed values will ever be created.
 */
const LEGACY_DATETIME_FIELDS_BY_MODEL: Record<string, string[]> = {
  user: ['created_at', 'updated_at'],
  session: ['expires_at', 'created_at', 'updated_at'],
  account: [
    'access_token_expires_at',
    'refresh_token_expires_at',
    'created_at',
    'updated_at',
  ],
  verification: ['expires_at', 'created_at', 'updated_at'],
};

const NUMERIC_STRING_RE = /^-?\d+(\.\d+)?$/;

/**
 * If `value` looks like a stringified epoch-ms (optionally with `.0`),
 * convert it to an ISO 8601 string. Otherwise return it unchanged.
 */
function normaliseLegacyDate(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!NUMERIC_STRING_RE.test(value)) return value;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return value;
  // Heuristic: epoch milliseconds are at least 10 digits (year 2001+).
  if (Math.abs(n) < 1e10) return value;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString();
}

/**
 * Walk a record and rewrite any legacy `.0`-suffixed datetime values
 * into ISO strings. Mutates and returns the record.
 */
function normaliseLegacyDates<T extends Record<string, any> | null | undefined>(
  model: string,
  record: T,
): T {
  if (!record) return record;
  const cols = LEGACY_DATETIME_FIELDS_BY_MODEL[model];
  if (!cols) return record;
  for (const col of cols) {
    if (col in record) {
      (record as Record<string, unknown>)[col] = normaliseLegacyDate(
        (record as Record<string, unknown>)[col],
      );
    }
  }
  return record;
}

/**
 * Convert better-auth where clause to ObjectQL query format.
 *
 * Field names in the incoming {@link CleanedWhere} are expected to already be
 * in snake_case (transformed by `createAdapterFactory`).
 */
function convertWhere(where: CleanedWhere[]): Record<string, any> {
  const filter: Record<string, any> = {};

  for (const condition of where) {
    const fieldName = condition.field;

    if (condition.operator === 'eq') {
      filter[fieldName] = condition.value;
    } else if (condition.operator === 'ne') {
      filter[fieldName] = { $ne: condition.value };
    } else if (condition.operator === 'in') {
      filter[fieldName] = { $in: condition.value };
    } else if (condition.operator === 'gt') {
      filter[fieldName] = { $gt: condition.value };
    } else if (condition.operator === 'gte') {
      filter[fieldName] = { $gte: condition.value };
    } else if (condition.operator === 'lt') {
      filter[fieldName] = { $lt: condition.value };
    } else if (condition.operator === 'lte') {
      filter[fieldName] = { $lte: condition.value };
    } else if (condition.operator === 'contains') {
      filter[fieldName] = { $regex: condition.value };
    }
  }

  return filter;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * Create an ObjectQL adapter **factory** for better-auth.
 *
 * Uses better-auth's official `createAdapterFactory` so that model-name and
 * field-name transformations (declared via `modelName` / `fields` in the
 * betterAuth config) are applied **automatically** before any data reaches
 * ObjectQL. This eliminates the need for manual camelCase ↔ snake_case
 * conversion inside the adapter.
 *
 * The returned value is an `AdapterFactory` – a function of type
 * `(options: BetterAuthOptions) => DBAdapter` – which is the shape expected
 * by `betterAuth({ database: … })`.
 *
 * @param dataEngine - ObjectQL data engine instance
 * @returns better-auth AdapterFactory
 */
export function createObjectQLAdapterFactory(dataEngine: IDataEngine) {
  return createAdapterFactory({
    config: {
      adapterId: 'objectql',
      // We let better-auth handle Date↔string and boolean↔0/1 conversion so
      // that values land in the underlying SQL driver as primitive strings
      // and integers. Some drivers (e.g. libsql over the HTTP transport)
      // otherwise mangle `Date` objects into `"<epoch>.0"` strings that
      // break the client-side session parser.
      supportsBooleans: false,
      supportsDates: false,
      supportsJSON: true,
    },
    adapter: () => ({
      create: async <T extends Record<string, any>>(
        { model, data, select: _select }: { model: string; data: T; select?: string[] },
      ): Promise<T> => {
        const result = await dataEngine.insert(model, data);
        return normaliseLegacyDates(model, result) as T;
      },

      findOne: async <T>(
        { model, where, select, join: _join }: { model: string; where: CleanedWhere[]; select?: string[]; join?: any },
      ): Promise<T | null> => {
        const filter = convertWhere(where);

        const result = await dataEngine.findOne(model, { where: filter, fields: select });

        return result ? (normaliseLegacyDates(model, result) as T) : null;
      },

      findMany: async <T>(
        { model, where, limit, offset, sortBy, join: _join }: {
          model: string; where?: CleanedWhere[]; limit: number;
          offset?: number; sortBy?: { field: string; direction: 'asc' | 'desc' }; join?: any;
        },
      ): Promise<T[]> => {
        const filter = where ? convertWhere(where) : {};

        const orderBy = sortBy
          ? [{ field: sortBy.field, order: sortBy.direction as 'asc' | 'desc' }]
          : undefined;

        const results = await dataEngine.find(model, {
          where: filter,
          limit: limit || 100,
          offset,
          orderBy,
        });

        return results.map((r) => normaliseLegacyDates(model, r as Record<string, any>)) as T[];
      },

      count: async (
        { model, where }: { model: string; where?: CleanedWhere[] },
      ): Promise<number> => {
        const filter = where ? convertWhere(where) : {};
        return await dataEngine.count(model, { where: filter });
      },

      update: async <T>(
        { model, where, update }: { model: string; where: CleanedWhere[]; update: T },
      ): Promise<T | null> => {
        const filter = convertWhere(where);

        // ObjectQL requires an ID for updates – find the record first
        const record = await dataEngine.findOne(model, { where: filter });
        if (!record) return null;

        const result = await dataEngine.update(model, { ...(update as any), id: record.id });
        return result ? (normaliseLegacyDates(model, result) as T) : null;
      },

      updateMany: async (
        { model, where, update }: { model: string; where: CleanedWhere[]; update: Record<string, any> },
      ): Promise<number> => {
        const filter = convertWhere(where);

        // Sequential updates: ObjectQL requires an ID per update
        const records = await dataEngine.find(model, { where: filter });
        for (const record of records) {
          await dataEngine.update(model, { ...update, id: record.id });
        }
        return records.length;
      },

      delete: async (
        { model, where }: { model: string; where: CleanedWhere[] },
      ): Promise<void> => {
        const filter = convertWhere(where);

        const record = await dataEngine.findOne(model, { where: filter });
        if (!record) return;

        await dataEngine.delete(model, { where: { id: record.id } });
      },

      deleteMany: async (
        { model, where }: { model: string; where: CleanedWhere[] },
      ): Promise<number> => {
        const filter = convertWhere(where);

        const records = await dataEngine.find(model, { where: filter });
        for (const record of records) {
          await dataEngine.delete(model, { where: { id: record.id } });
        }
        return records.length;
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Legacy adapter (kept for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Create a raw ObjectQL adapter for better-auth (without factory wrapping).
 *
 * > **Prefer {@link createObjectQLAdapterFactory}** for production use.
 * > The factory version leverages `createAdapterFactory` and automatically
 * > handles model-name + field-name transformations declared in the
 * > better-auth config.
 *
 * This function is retained for direct / low-level usage where callers
 * manage field-name conversion themselves.
 *
 * @param dataEngine - ObjectQL data engine instance
 * @returns better-auth CustomAdapter (raw, without factory wrapping)
 */
export function createObjectQLAdapter(dataEngine: IDataEngine) {
  return {
    create: async <T extends Record<string, any>>({ model, data, select: _select }: { model: string; data: T; select?: string[] }): Promise<T> => {
      const objectName = resolveProtocolName(model);
      const result = await dataEngine.insert(objectName, data);
      return result as T;
    },

    findOne: async <T>({ model, where, select, join: _join }: { model: string; where: CleanedWhere[]; select?: string[]; join?: any }): Promise<T | null> => {
      const objectName = resolveProtocolName(model);
      const filter = convertWhere(where);
      const result = await dataEngine.findOne(objectName, { where: filter, fields: select });
      return result ? result as T : null;
    },

    findMany: async <T>({ model, where, limit, offset, sortBy, join: _join }: { model: string; where?: CleanedWhere[]; limit: number; offset?: number; sortBy?: { field: string; direction: 'asc' | 'desc' }; join?: any }): Promise<T[]> => {
      const objectName = resolveProtocolName(model);
      const filter = where ? convertWhere(where) : {};
      const orderBy = sortBy ? [{ field: sortBy.field, order: sortBy.direction as 'asc' | 'desc' }] : undefined;
      const results = await dataEngine.find(objectName, { where: filter, limit: limit || 100, offset, orderBy });
      return results as T[];
    },

    count: async ({ model, where }: { model: string; where?: CleanedWhere[] }): Promise<number> => {
      const objectName = resolveProtocolName(model);
      const filter = where ? convertWhere(where) : {};
      return await dataEngine.count(objectName, { where: filter });
    },

    update: async <T>({ model, where, update }: { model: string; where: CleanedWhere[]; update: Record<string, any> }): Promise<T | null> => {
      const objectName = resolveProtocolName(model);
      const filter = convertWhere(where);
      const record = await dataEngine.findOne(objectName, { where: filter });
      if (!record) return null;
      const result = await dataEngine.update(objectName, { ...update, id: record.id });
      return result ? result as T : null;
    },

    updateMany: async ({ model, where, update }: { model: string; where: CleanedWhere[]; update: Record<string, any> }): Promise<number> => {
      const objectName = resolveProtocolName(model);
      const filter = convertWhere(where);
      const records = await dataEngine.find(objectName, { where: filter });
      for (const record of records) {
        await dataEngine.update(objectName, { ...update, id: record.id });
      }
      return records.length;
    },

    delete: async ({ model, where }: { model: string; where: CleanedWhere[] }): Promise<void> => {
      const objectName = resolveProtocolName(model);
      const filter = convertWhere(where);
      const record = await dataEngine.findOne(objectName, { where: filter });
      if (!record) return;
      await dataEngine.delete(objectName, { where: { id: record.id } });
    },

    deleteMany: async ({ model, where }: { model: string; where: CleanedWhere[] }): Promise<number> => {
      const objectName = resolveProtocolName(model);
      const filter = convertWhere(where);
      const records = await dataEngine.find(objectName, { where: filter });
      for (const record of records) {
        await dataEngine.delete(objectName, { where: { id: record.id } });
      }
      return records.length;
    },
  };
}
