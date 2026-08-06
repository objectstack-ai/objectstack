// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/core';
import { createAdapterFactory } from 'better-auth/adapters';
import type { CleanedWhere, WhereOperator } from 'better-auth/adapters';
import { SystemObjectName } from '@objectstack/spec/system';
import { resolveAttributedUserId } from './auth-actor-attribution.js';

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
  // Plugin models. `@better-auth/sso` and `@better-auth/scim` both hardcode
  // their model name and accept NO `schema` option (verified vs 1.6.2x — no
  // mergeSchema, runtime never reads options.schema), so the table name is
  // bridged here and `createObjectQLAdapterFactory` (below) auto-maps their
  // camelCase fields to snake_case (oidcConfig→oidc_config, scimToken→
  // scim_token, …) on every CRUD op via resolveProtocolName. Off by default
  // (OS_SSO_ENABLED / OS_SCIM_ENABLED). See ADR-0024 / ADR-0071.
  ssoProvider: 'sys_sso_provider',
  scimProvider: 'sys_scim_provider',
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
 * Every better-auth where operator {@link convertWhere} translates.
 *
 * `satisfies readonly WhereOperator[]` keeps a typo out; the `never` check in
 * `convertWhere`'s `default` arm keeps the SWITCH from falling behind this
 * list; and `auth-where-operator-coverage.test.ts` pins this list against the
 * runtime `whereOperators` export so it cannot fall behind better-auth's
 * vocabulary either. All three are needed: the first two only prove the file is
 * self-consistent, and a vocabulary that grew upstream is exactly the case
 * #5813 was.
 *
 * Ordered as better-auth declares it, so the two lists diff by eye.
 */
export const SUPPORTED_WHERE_OPERATORS = [
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'not_in',
  'contains',
  'starts_with',
  'ends_with',
] as const satisfies readonly WhereOperator[];

/**
 * Convert better-auth where clause to ObjectQL query format.
 *
 * Field names in the incoming {@link CleanedWhere} are expected to already be
 * in snake_case (transformed by `createAdapterFactory`).
 *
 * ## The whole vocabulary, or a loud refusal — never a dropped predicate (#5813)
 *
 * better-auth's operator vocabulary is a closed list of eleven
 * (`whereOperators` in `@better-auth/core/db/adapter`). This function used to
 * translate eight of them and simply *fall off the end* of its `if / else if`
 * chain for `not_in` / `starts_with` / `ends_with`: no key was written into
 * `filter`, no warning was raised, and a `where` carrying only such a condition
 * compiled to `{}`.
 *
 * A dropped predicate does not narrow a result set — it WIDENS it, on the
 * identity tables:
 *
 *   - `findMany` / `count` answered over the whole table (bounded only by
 *     `limit`) — `GET /api/v1/auth/admin/list-users?searchOperator=starts_with`
 *     returned every user instead of the matching ones;
 *   - `update` / `delete` / `consumeOne` / `incrementOne` all resolve their
 *     target with `findOne(filter)` first, so `{}` selected an ARBITRARY row
 *     (in practice the first) and the write landed on the wrong record.
 *
 * So the `default` arm below THROWS rather than skipping. It is the same
 * restore-invariant discipline the #3948 family applied to driver-memory's
 * matcher and to objectql's `having`: an operator a layer cannot honour must be
 * refused by name, because silently answering a DIFFERENT question is the worse
 * of the two failures. It is also the seam a future vocabulary addition lands
 * on — better-auth growing a twelfth operator now fails loudly at the first
 * query instead of quietly widening one.
 *
 * Case semantics: `starts_with` / `ends_with` are case-SENSITIVE on both sides
 * of this translation — better-auth's `Where.mode` defaults to `"sensitive"`,
 * and `$startsWith` / `$endsWith` are case-sensitive at the contract layer per
 * the #5701 Q2=A ruling — so the direct translation opens no contract seam.
 * (`mode: 'insensitive'` is a separate, still-unread field; see #5814. It is
 * NOT an operator and is deliberately not refused here.)
 */
function convertWhere(where: CleanedWhere[]): Record<string, any> {
  const filter: Record<string, any> = {};

  for (const condition of where) {
    const fieldName = condition.field;
    // better-auth declares `Where.operator` optional with `@default eq`, and
    // its factory materialises that default (`operator = "eq"` in
    // `transformWhereClause`) before an adapter ever sees the clause — which is
    // why `CleanedWhere` is `Required<Where>`. The raw `createObjectQLAdapter`
    // below takes a hand-built clause that never passed through the factory, so
    // the producer's own documented default is applied here rather than
    // assumed. This is the declared contract, not a lenient alias: any operator
    // that IS spelled out must be in the vocabulary.
    const operator = condition.operator ?? 'eq';

    switch (operator) {
      case 'eq':
        filter[fieldName] = condition.value;
        break;
      case 'ne':
        filter[fieldName] = { $ne: condition.value };
        break;
      case 'in':
        filter[fieldName] = { $in: condition.value };
        break;
      case 'not_in':
        filter[fieldName] = { $nin: condition.value };
        break;
      case 'gt':
        filter[fieldName] = { $gt: condition.value };
        break;
      case 'gte':
        filter[fieldName] = { $gte: condition.value };
        break;
      case 'lt':
        filter[fieldName] = { $lt: condition.value };
        break;
      case 'lte':
        filter[fieldName] = { $lte: condition.value };
        break;
      case 'starts_with':
        filter[fieldName] = { $startsWith: condition.value };
        break;
      case 'ends_with':
        filter[fieldName] = { $endsWith: condition.value };
        break;
      case 'contains':
        // [#5710] `$contains`, NOT `$regex`. better-auth's `contains` is a
        // LITERAL substring search (`Where.mode` defaults to `"sensitive"`, and
        // the value comes straight from a caller — `/admin/list-users`'
        // `searchValue`), while `$regex` puts that value in a PATTERN position.
        //
        // What the bare `$regex` did, per backend, to one `contains('a.b')`:
        //   - driver-memory: `new RegExp('a.b')` — `.` is a wildcard, so it
        //     matched `axb`; an unbalanced `(` in the value made the pattern
        //     illegal (a throw on the mingo path, a silent no-match on the
        //     reference matcher's).
        //   - driver-sql / -sqlite-wasm / -turso: compiled to a substring
        //     `LIKE '%a.b%'` — metacharacters literal.
        // One operator, two answers, and the divergence only shows up when the
        // app's tests run on the memory double and production runs SQL (#4706).
        //
        // `$contains` is in the spec's `FILTER_OPERATORS` and every backend
        // evaluates it as a literal substring (SQL side escapes `%`/`_`/`\` and
        // emits an explicit `ESCAPE`), which is exactly better-auth's meaning.
        // Case semantics follow the #5701 Q2=A ruling (`$contains` is
        // case-SENSITIVE at the contract layer; the per-driver alignment is
        // #5702's budget), which matches better-auth's own `mode: 'sensitive'`
        // default.
        //
        // This is also the last live producer of `$regex` — it is what
        // `driver-memory/src/filter-refusal.ts` means by "refusing it here would
        // break a live producer", and the reason #5702's loud refusal is ordered
        // after this flip.
        filter[fieldName] = { $contains: condition.value };
        break;
      default: {
        // Unreachable for the vocabulary this adapter is compiled against —
        // `operator` narrows to `never` here, so a twelfth member appearing in
        // better-auth's `whereOperators` with no `case` above is a TYPE error at
        // the assignment below, caught by `pnpm --filter
        // @objectstack/plugin-auth typecheck` long before a query runs. At
        // RUNTIME the value is the real operator string, which is what gets
        // named in the message.
        const unhandled: never = operator;
        throw new Error(
          `[plugin-auth] Unsupported better-auth where operator ` +
            `'${String(unhandled)}' on field '${fieldName}'. ` +
            `Supported operators: ${SUPPORTED_WHERE_OPERATORS.join(', ')}. ` +
            `Translate it to an ObjectQL operator in convertWhere() ` +
            `(packages/plugins/plugin-auth/src/objectql-adapter.ts) — refusing ` +
            `the query rather than dropping the predicate, which would widen ` +
            `the result set instead of narrowing it (#5813).`,
        );
      }
    }
  }

  return filter;
}

// ---------------------------------------------------------------------------
// ObjectQL → better-auth error mapping
// ---------------------------------------------------------------------------

/**
 * ObjectQL's record-validator (packages/objectql/src/validation/record-validator.ts)
 * throws a `ValidationError` — `code: 'VALIDATION_FAILED'`, a human `.message`,
 * and per-field `.fields[]` — when an incoming insert/update payload fails
 * field-level validation (e.g. a non-URL `image` on `POST /api/v1/auth/update-user`).
 *
 * better-auth only maps its OWN `APIError`s to clean HTTP responses; any other
 * error thrown from an adapter method propagates to better-call's router as an
 * unhandled fault → a raw **500 with an empty body**, so the client never learns
 * why the write was rejected.
 *
 * This is the auth-path analogue of the REST data layer's `mapDataError`
 * (packages/rest/src/rest-server.ts): we detect the ObjectQL validation envelope
 * (by `code` / `name`, so plugin-auth needs no hard dependency on
 * `@objectstack/objectql` and cross-realm `instanceof` can't bite) and re-throw
 * it as a better-auth `APIError('BAD_REQUEST', …)`, giving the endpoint a 400
 * that carries the validation message plus per-field detail.
 */
function isObjectQLValidationError(
  err: unknown,
): err is { code?: string; name?: string; message?: string; fields?: unknown } {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; name?: unknown };
  return e.code === 'VALIDATION_FAILED' || e.name === 'ValidationError';
}

/**
 * An engine-level POLICY refusal — a `beforeUpdate`/`beforeInsert` guard that
 * refused the write itself, rather than a payload the validator disliked.
 *
 * Detected by the same duck-typing as above (`code`), and for the same reason:
 * the guards live in this package but throw a plain engine-shaped error so that
 * BOTH transports can map it — `mapDataError` gives the REST data routes a 403,
 * this gives the auth pipeline one. The concrete case is the break-glass
 * last-administrator ban guard (ADR-0024 D5.2, `last-admin-ban-guard.ts`):
 * without this arm, an over-broad SCIM deprovision would be refused correctly
 * and then reported to the IdP as an opaque 500, which is the one thing a guard
 * whose whole product is an explanation must not do.
 */
function isEnginePolicyRefusal(err: unknown): err is { code?: string; message?: string } {
  if (!err || typeof err !== 'object') return false;
  return (err as { code?: unknown }).code === 'PERMISSION_DENIED';
}

/**
 * Re-throw `err` as a better-auth `APIError` when it is an ObjectQL validation
 * failure or an engine policy refusal; otherwise re-throw it verbatim. Always
 * throws — the return type is `never`.
 */
async function rethrowAsBetterAuthError(err: unknown): Promise<never> {
  if (isObjectQLValidationError(err)) {
    const { APIError } = await import('better-auth/api');
    const fields = (err as { fields?: unknown }).fields;
    throw new APIError('BAD_REQUEST', {
      message:
        typeof err.message === 'string' && err.message.trim()
          ? err.message
          : 'Validation failed',
      code: 'VALIDATION_FAILED',
      ...(Array.isArray(fields) ? { fields } : {}),
    });
  }
  if (isEnginePolicyRefusal(err)) {
    const { APIError } = await import('better-auth/api');
    throw new APIError('FORBIDDEN', {
      message:
        typeof err.message === 'string' && err.message.trim()
          ? err.message
          : 'Permission denied',
      code: 'PERMISSION_DENIED',
    });
  }
  throw err;
}

/**
 * Wrap every function-valued method of a better-auth adapter so an ObjectQL
 * `ValidationError` (400) or an engine policy refusal (403) thrown from the
 * underlying engine surfaces as a 4xx `APIError` instead of an opaque 500.
 * Non-function properties pass through untouched, and every error that carries
 * neither signature is re-thrown verbatim.
 */
export function withValidationErrorMapping<A extends Record<string, any>>(adapter: A): A {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(adapter)) {
    out[key] =
      typeof value === 'function'
        ? async (...args: any[]) => {
            try {
              return await value(...args);
            } catch (err) {
              await rethrowAsBetterAuthError(err); // always throws
            }
          }
        : value;
  }
  return out as A;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * Wrap a data engine so its operations run as SYSTEM against the identity
 * tables — injecting `context.isSystem: true` (merged; any caller-supplied
 * context still wins on other keys). better-auth is the identity AUTHORITY: it
 * has already authenticated the session and scopes every query/write by its OWN
 * where-clauses (e.g. member.userId = session.user).
 *
 * READS run as system so a deployment's control-plane org-scope read hook —
 * which keys off the CALLER's user id — doesn't filter these caller-context-less
 * adapter reads of sys_member / sys_organization down to zero (which would make
 * `organization.list()` return no orgs for a real member).
 *
 * WRITES (`update` / `insert` / `delete`) also run as system (#3164). Several
 * identity columns are declared `readonly` on their schema — `sys_user.email`
 * (change-email), `banned` / `ban_reason` / `ban_expires` (admin ban) — and the
 * static-`readonly` UPDATE strip (#2948) runs on any NON-system update. Since
 * the adapter carries no caller context, `!ctx?.isSystem` was TRUE and the strip
 * silently DROPPED better-auth's own writes to those columns (change-email /
 * ban would return success but never persist). Marking the adapter's writes
 * system exempts them — correct, because these ARE the identity authority's own
 * writes; user-context writes to `managedBy: 'better-auth'` tables are already
 * rejected upstream by the identity write guard (ADR-0092 D2), so this path only
 * ever carries better-auth's internal writes.
 *
 * WRITES additionally carry `attributedUserId` when an auth request is in scope
 * (#4586) — the human whose click better-auth is executing. That is the
 * ATTRIBUTION half and nothing more: `isSystem` remains the AUTHORIZATION half,
 * unconditionally, so what a write may touch is byte-for-byte what it could
 * touch before. Reads never carry it — attribution describes a change, and a
 * read changes nothing.
 */
export function withSystemContext(engine: IDataEngine): IDataEngine {
  const e = engine as any;
  const asSystem = (q: any) => ({ ...(q ?? {}), context: { isSystem: true, ...(q?.context ?? {}) } });
  // The attributed human is spread FIRST so an explicit caller-supplied context
  // still wins on every key — the same precedence `isSystem` already had.
  const asAttributedSystem = async (q: any) => {
    const attributedUserId = await resolveAttributedUserId();
    if (!attributedUserId) return asSystem(q);
    return { ...(q ?? {}), context: { attributedUserId, isSystem: true, ...(q?.context ?? {}) } };
  };
  return {
    insert: async (m: string, d: any, o?: any) => e.insert(m, d, await asAttributedSystem(o)),
    update: async (m: string, d: any, o?: any) => e.update(m, d, await asAttributedSystem(o)),
    delete: async (m: string, q?: any) => e.delete(m, await asAttributedSystem(q)),
    find: (m: string, q?: any) => e.find(m, asSystem(q)),
    findOne: (m: string, q?: any) => e.findOne(m, asSystem(q)),
    count: (m: string, q?: any) => e.count(m, asSystem(q)),
  } as unknown as IDataEngine;
}

/**
 * @deprecated Renamed to {@link withSystemContext} (#3164) now that writes are
 * system-scoped too, not only reads. Kept as an alias for one release so
 * external callers / in-flight imports don't break.
 */
export const withSystemReadContext = withSystemContext;

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
  const dataEngine = withSystemContext(rawDataEngine);
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
    adapter: () => withValidationErrorMapping({
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

      // Atomic single-row consume (better-auth 1.7+). ObjectQL has no native
      // `DELETE ... RETURNING`, so we find the single guarded row, delete it,
      // and return the consumed record — a find-then-write mirror of `delete`.
      consumeOne: async <T>(
        { model, where }: { model: string; where: CleanedWhere[] },
      ): Promise<T | null> => {
        const objectName = resolveProtocolName(model);
        const bridged = objectName !== model;
        const filter = convertWhere(bridged ? remapWhere(where) : where);

        const record = await dataEngine.findOne(objectName, { where: filter });
        if (!record) return null;
        await dataEngine.delete(objectName, { where: { id: record.id } });
        const norm = normaliseLegacyDates(model, record);
        return (bridged ? remapKeys(norm, snakeToCamel) : norm) as T;
      },

      // Guarded counter mutation (better-auth 1.7+). ObjectQL has no native
      // `SET n = n + $delta ... RETURNING`, so we read the guarded row, apply
      // `field = field + delta` for each `increment` entry (negative deltas
      // decrement) plus any absolute `set` values, and write it back. `where`
      // is both selector and guard, so a non-matching guard returns null.
      incrementOne: async <T>(
        { model, where, increment, set }: {
          model: string; where: CleanedWhere[];
          increment: Record<string, number>; set?: Record<string, unknown>;
        },
      ): Promise<T | null> => {
        const objectName = resolveProtocolName(model);
        const bridged = objectName !== model;
        const filter = convertWhere(bridged ? remapWhere(where) : where);

        const record = await dataEngine.findOne(objectName, { where: filter });
        if (!record) return null;

        const patch: Record<string, any> = {};
        for (const [field, delta] of Object.entries(increment)) {
          const col = bridged ? camelToSnake(field) : field;
          const current = Number((record as Record<string, any>)[col] ?? 0);
          patch[col] = current + delta;
        }
        if (set) Object.assign(patch, bridged ? remapKeys(set, camelToSnake) : set);

        const result = await dataEngine.update(objectName, { ...patch, id: record.id });
        if (!result) return null;
        const norm = normaliseLegacyDates(model, result);
        return (bridged ? remapKeys(norm, snakeToCamel) : norm) as T;
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
  const dataEngine = withSystemContext(rawDataEngine);
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
