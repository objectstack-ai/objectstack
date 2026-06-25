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
  // @better-auth/sso has NO `schema` option (verified vs 1.6.20 — no
  // mergeSchema, runtime never reads options.schema), so it cannot declare
  // its modelName/fields. Bridge the table name here. NOTE: the ACTIVE
  // factory adapter (createObjectQLAdapterFactory) passes the raw `model`
  // to dataEngine and does NOT yet consult resolveProtocolName for plugin
  // models — nor map sso's camelCase fields (oidcConfig→oidc_config …).
  // Finishing the @better-auth/sso integration needs that adapter work +
  // E2E (see ADR-0024 / sys_sso_provider). Off by default (OS_SSO_ENABLED).
  ssoProvider: 'sys_sso_provider',
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
 * Wrap a data engine so its READ operations (find / findOne / count) run as
 * SYSTEM reads — injecting `context.isSystem: true` (merged; any caller-supplied
 * context still wins on other keys). better-auth has already authenticated the
 * session and scopes every query by its OWN where-clauses (e.g. member.userId =
 * session.user). A deployment's control-plane org-scope read hook, however, keys
 * off the CALLER's user id, and these adapter reads carry no caller context — so
 * without isSystem that hook filters sys_member / sys_organization reads down to
 * zero and `organization.list()` returns no orgs for a real member. Writes pass
 * through untouched (org-scope is a read-only hook).
 */
export function withSystemReadContext(engine: IDataEngine): IDataEngine {
  const e = engine as any;
  const asSystem = (q: any) => ({ ...(q ?? {}), context: { isSystem: true, ...(q?.context ?? {}) } });
  return {
    insert: (m: string, d: any) => e.insert(m, d),
    update: (m: string, d: any) => e.update(m, d),
    delete: (m: string, q?: any) => e.delete(m, q),
    find: (m: string, q?: any) => e.find(m, asSystem(q)),
    findOne: (m: string, q?: any) => e.findOne(m, asSystem(q)),
    count: (m: string, q?: any) => e.count(m, asSystem(q)),
  } as unknown as IDataEngine;
}

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
export function createObjectQLAdapterFactory(rawDataEngine: IDataEngine) {
  const dataEngine = withSystemReadContext(rawDataEngine);
  // Field-name bridging for better-auth plugins that expose NO `schema` option
  // (e.g. @better-auth/sso): when a model is remapped via AUTH_MODEL_TO_PROTOCOL,
  // its camelCase model fields are also converted to snake_case columns on the
  // way in and back to camelCase on the way out. SCOPED by `objectName !== model`
  // so core / schema-declared models are byte-for-byte untouched.
  const camelToSnake = (s: string): string => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
  const snakeToCamel = (s: string): string => s.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
  const remapKeys = (obj: Record<string, any>, fn: (k: string) => string): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const k of Object.keys(obj)) out[fn(k)] = obj[k];
    return out;
  };
  const remapWhere = (where: CleanedWhere[]): CleanedWhere[] =>
    where.map((c) => ({ ...c, field: camelToSnake(c.field) }));

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
        const objectName = resolveProtocolName(model);
        const bridged = objectName !== model;
        const result = await dataEngine.insert(objectName, bridged ? remapKeys(data, camelToSnake) : data);
        const norm = normaliseLegacyDates(model, result);
        return (bridged ? remapKeys(norm, snakeToCamel) : norm) as T;
      },

      findOne: async <T>(
        { model, where, select, join: _join }: { model: string; where: CleanedWhere[]; select?: string[]; join?: any },
      ): Promise<T | null> => {
        const objectName = resolveProtocolName(model);
        const bridged = objectName !== model;
        const filter = convertWhere(bridged ? remapWhere(where) : where);
        const fields = bridged && select ? select.map(camelToSnake) : select;

        const result = await dataEngine.findOne(objectName, { where: filter, fields });
        if (!result) return null;
        const norm = normaliseLegacyDates(model, result);
        return (bridged ? remapKeys(norm, snakeToCamel) : norm) as T;
      },

      findMany: async <T>(
        { model, where, limit, offset, sortBy, join: _join }: {
          model: string; where?: CleanedWhere[]; limit: number;
          offset?: number; sortBy?: { field: string; direction: 'asc' | 'desc' }; join?: any;
        },
      ): Promise<T[]> => {
        const objectName = resolveProtocolName(model);
        const bridged = objectName !== model;
        const filter = where ? convertWhere(bridged ? remapWhere(where) : where) : {};

        const orderBy = sortBy
          ? [{ field: bridged ? camelToSnake(sortBy.field) : sortBy.field, order: sortBy.direction as 'asc' | 'desc' }]
          : undefined;

        const results = await dataEngine.find(objectName, {
          where: filter,
          limit: limit || 100,
          offset,
          orderBy,
        });

        return results.map((r) => {
          const norm = normaliseLegacyDates(model, r as Record<string, any>);
          return bridged ? remapKeys(norm, snakeToCamel) : norm;
        }) as T[];
      },

      count: async (
        { model, where }: { model: string; where?: CleanedWhere[] },
      ): Promise<number> => {
        const objectName = resolveProtocolName(model);
        const bridged = objectName !== model;
        const filter = where ? convertWhere(bridged ? remapWhere(where) : where) : {};
        return await dataEngine.count(objectName, { where: filter });
      },

      update: async <T>(
        { model, where, update }: { model: string; where: CleanedWhere[]; update: T },
      ): Promise<T | null> => {
        const objectName = resolveProtocolName(model);
        const bridged = objectName !== model;
        const filter = convertWhere(bridged ? remapWhere(where) : where);

        // ObjectQL requires an ID for updates – find the record first
        const record = await dataEngine.findOne(objectName, { where: filter });
        if (!record) return null;

        const patch = bridged ? remapKeys(update as any, camelToSnake) : (update as any);
        const result = await dataEngine.update(objectName, { ...patch, id: record.id });
        if (!result) return null;
        const norm = normaliseLegacyDates(model, result);
        return (bridged ? remapKeys(norm, snakeToCamel) : norm) as T;
      },

      updateMany: async (
        { model, where, update }: { model: string; where: CleanedWhere[]; update: Record<string, any> },
      ): Promise<number> => {
        const objectName = resolveProtocolName(model);
        const bridged = objectName !== model;
        const filter = convertWhere(bridged ? remapWhere(where) : where);

        // Sequential updates: ObjectQL requires an ID per update
        const records = await dataEngine.find(objectName, { where: filter });
        const patch = bridged ? remapKeys(update, camelToSnake) : update;
        for (const record of records) {
          await dataEngine.update(objectName, { ...patch, id: record.id });
        }
        return records.length;
      },

      delete: async (
        { model, where }: { model: string; where: CleanedWhere[] },
      ): Promise<void> => {
        const objectName = resolveProtocolName(model);
        const bridged = objectName !== model;
        const filter = convertWhere(bridged ? remapWhere(where) : where);

        const record = await dataEngine.findOne(objectName, { where: filter });
        if (!record) return;

        await dataEngine.delete(objectName, { where: { id: record.id } });
      },

      deleteMany: async (
        { model, where }: { model: string; where: CleanedWhere[] },
      ): Promise<number> => {
        const objectName = resolveProtocolName(model);
        const bridged = objectName !== model;
        const filter = convertWhere(bridged ? remapWhere(where) : where);

        const records = await dataEngine.find(objectName, { where: filter });
        for (const record of records) {
          await dataEngine.delete(objectName, { where: { id: record.id } });
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
export function createObjectQLAdapter(rawDataEngine: IDataEngine) {
  const dataEngine = withSystemReadContext(rawDataEngine);
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
