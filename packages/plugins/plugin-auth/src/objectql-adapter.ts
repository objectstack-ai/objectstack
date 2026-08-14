// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/core';
import { createAdapterFactory } from 'better-auth/adapters';
import type { CleanedWhere, WhereOperator } from 'better-auth/adapters';
import { SystemObjectName } from '@objectstack/spec/system';
import { resolveAttributedUserId } from './auth-actor-attribution.js';
import { adoptExistingMembership } from './adopt-membership.js';
import {
  filterRevokedSessionRows,
  hideRevokedSessionRow,
  reconcileSessionDelete,
} from './session-tombstone.js';
import {
  injectClientSecretOnRead,
  liftClientSecretForWrite,
  type SecretResolvingEngine,
} from './sso-client-secret.js';
import {
  reattachInternalFieldsOnRead,
  type InternalFieldResolvingEngine,
} from './internal-field-readback.js';

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

// ---------------------------------------------------------------------------
// Case-insensitive identifiers — the normalised set (#5814)
// ---------------------------------------------------------------------------

/**
 * The identifier fields this adapter stores and compares **normalised**
 * (lower-cased), per the maintainer's 2026-08-09 ruling on #5814.
 *
 * ## Why a declared table and not a name heuristic
 *
 * Membership is a contract with two obligations that must hold **together**:
 *
 *   1. every write through this adapter normalises the field
 *      ({@link normaliseIdentifierWrite}), and
 *   2. a `mode: 'insensitive'` comparand on the field is normalised the same
 *      way ({@link convertWhere}), which is then an EXACT match against (1).
 *
 * Honour (2) without (1) and you get the mirror-image defect of the one #5814
 * was filed on: the query stops matching rows it used to match. So the set is
 * spelled out, keyed by better-auth model name, and both directions are driven
 * from this one declaration — a field cannot be added to one half only. A
 * heuristic (`/email$/`, `endsWith('_email')`) would let a field into the
 * compare half without anyone deciding that its writes are normalised, which is
 * exactly the widening this table exists to prevent.
 *
 * `sys_user.email` is the whole set today because it is the whole demand:
 * `@better-auth/scim` maps SCIM's `userName` onto better-auth's **`email`**
 * field (`SCIMUserFilterAttributeFields = { userName: "email" }`,
 * `@better-auth/scim@1.7.0-rc.1/dist/index.mjs:531`) and marks it
 * `caseExact: false` (`:409-417`, RFC 7643), so the where clause that reaches
 * this adapter is `{ field: 'email', operator: 'eq', mode: 'insensitive' }` on
 * model `user`. Adding a member is a deliberate act: it must ALSO be provable
 * that every producer of that field writes it normalised, and
 * `scim-case-insensitive-identifier.test.ts` pins the set so the addition
 * cannot be quiet.
 *
 * Keyed by better-auth **model** name (`user`), not by the protocol object name
 * (`sys_user`), because that is the name every call site in this file already
 * holds and the name `Where.field` has been transformed against. `user` is not
 * one of the bridged models (see `AUTH_MODEL_TO_PROTOCOL`), so its field names
 * reach `convertWhere` untouched by `remapWhere`, and `email` is spelled
 * identically on both sides (`auth-schema-config.ts` maps only the names that
 * actually differ).
 */
export const NORMALISED_IDENTIFIER_FIELDS: Readonly<Record<string, readonly string[]>> = {
  user: ['email'],
};

/** Is `field` on `model` stored and compared lower-cased? */
function isNormalisedIdentifier(model: string, field: string): boolean {
  return NORMALISED_IDENTIFIER_FIELDS[model]?.includes(field) ?? false;
}

/**
 * Lower-case a comparand, element-wise for the array-valued operators
 * (`in` / `not_in`).
 *
 * Non-strings are returned untouched: better-auth's own `Where.mode` doc says
 * the flag "Only applies to string values", and an identifier column holding a
 * number/boolean/Date has no case to fold.
 */
function normaliseComparand(value: unknown): unknown {
  if (typeof value === 'string') return value.toLowerCase();
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v.toLowerCase() : v));
  return value;
}

/**
 * Normalise the identifier fields of an outgoing write payload (#5814).
 *
 * This is obligation (1) of {@link NORMALISED_IDENTIFIER_FIELDS} — the half
 * that makes the comparand normalisation in {@link convertWhere} an *exact*
 * match rather than a hopeful one.
 *
 * It is deliberately NOT a redundant belt over better-auth's own lower-casing.
 * better-auth's `internalAdapter` does lower-case `user.email` on
 * `createUser` / `createOAuthUser` / `updateUser` / `updateUserByEmail`
 * (`better-auth@1.7.0-rc.2/dist/db/internal-adapter.mjs:120,139,594,607`), but
 * that is an *internal* of a **prerelease** dependency, invisible to any
 * published type, and it does not cover the raw {@link createObjectQLAdapter}
 * path (hand-built calls that never pass through better-auth at all). The
 * invariant the read half depends on has to be owned where it is relied upon.
 *
 * Idempotent by construction, so a payload better-auth already normalised is
 * unchanged — which is why this adds no behaviour to any existing write.
 */
function normaliseIdentifierWrite<T extends Record<string, any>>(model: string, data: T): T {
  const fields = NORMALISED_IDENTIFIER_FIELDS[model];
  if (!fields) return data;
  let out: Record<string, any> | undefined;
  for (const field of fields) {
    const value = data[field];
    if (typeof value !== 'string') continue;
    const lowered = value.toLowerCase();
    if (lowered === value) continue;
    out ??= { ...data };
    out[field] = lowered;
  }
  return (out ?? data) as T;
}

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
 *
 * ## `Where.mode` is read, never dropped (#5814)
 *
 * `mode` is better-auth's fourth `Where` field
 * (`mode?: "sensitive" | "insensitive"`, `@default "sensitive"`); it is NOT an
 * operator, and until #5814 this function did not read it at all. A dropped
 * `mode: 'insensitive'` is the fail-OPEN direction of #5813's fail-closed
 * defect: the query is answered, just case-sensitively, so whether it matches
 * degrades to "however the driver under the auth path happens to compare
 * strings". `@better-auth/scim` is the live producer — SCIM's `userName` is
 * `caseExact: false` per RFC 7643 and maps onto `user.email` — and because
 * SCIM's provisioning path is "look up, create if absent", the symptom of a
 * missed match is a DUPLICATE USER rather than an error.
 *
 * Two arms, per the maintainer's 2026-08-09 ruling:
 *
 *   - **A normalised identifier** ({@link NORMALISED_IDENTIFIER_FIELDS}): the
 *     comparand is lower-cased. The column is stored lower-cased
 *     ({@link normaliseIdentifierWrite}), so this is an EXACT case-insensitive
 *     match with no new query vocabulary — the request is honoured, not
 *     approximated.
 *   - **Any other field**: a loud `console.warn` naming the model, the field
 *     and the operator, and stating that the query is being answered
 *     case-sensitively. It does NOT throw: the ruling's own reasoning is that
 *     fail-closed here would upgrade an occasional duplicate into "userName
 *     queries entirely unavailable", and by AGENTS.md's degradation-level
 *     question this is a functional degradation — the caller gets a narrower
 *     answer than asked for and nothing claims to have persisted — so `warn`,
 *     not `error`. The one thing it may not be is silent.
 *
 * Why no `$ieq`: adding a case-insensitive equality operator was **deferred**
 * for demonstrated pull (#5814 option 1), and it would need an in-memory
 * execution face before it could join `FILTER_OPERATORS` at all — the
 * fail-closed reasoning `packages/spec/src/data/filter.zod.ts` records for
 * `$icontains`. Downgrading `eq + insensitive` to `$icontains` was **rejected**
 * (option 2): containment is not equality.
 */
function convertWhere(model: string, where: CleanedWhere[]): Record<string, any> {
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

    // `mode` gets the same treatment as `operator` above and for the same
    // reason: better-auth's factory materialises the documented default
    // (`mode = "sensitive"` in `transformWhereClause`) before an adapter sees
    // the clause, but the raw `createObjectQLAdapter` below is handed clauses
    // that never passed through it — so the producer's own default is applied
    // here explicitly rather than assumed present.
    const mode = condition.mode ?? 'sensitive';
    const insensitive = mode === 'insensitive';
    const normalisedIdentifier = insensitive && isNormalisedIdentifier(model, fieldName);

    if (insensitive && !normalisedIdentifier) {
      // Loud, and it names all three things an operator needs to act: which
      // query, which field, and what was actually done instead.
      console.warn(
        `[plugin-auth] Case-insensitive match requested on '${model}.${fieldName}' ` +
          `(operator '${operator}', better-auth \`Where.mode: 'insensitive'\`), but ` +
          `'${model}.${fieldName}' is not a normalised identifier field — the query is ` +
          `being answered CASE-SENSITIVELY, so a differently-cased value will not match. ` +
          `ObjectQL has no case-insensitive equality operator (#5814 deferred \`$ieq\` ` +
          `until there is demonstrated pull for it). Normalised identifier fields: ` +
          `${Object.entries(NORMALISED_IDENTIFIER_FIELDS)
            .map(([m, fs]) => fs.map((f) => `${m}.${f}`).join(', '))
            .join(', ')} ` +
          `(packages/plugins/plugin-auth/src/objectql-adapter.ts).`,
      );
    }

    // Honour the caller's DECLARED mode: a `sensitive` (or absent) clause keeps
    // its comparand byte-for-byte, even on a normalised column. Folding case
    // unasked would answer a different question than the one put — the same
    // failure in the opposite direction.
    const value = normalisedIdentifier ? normaliseComparand(condition.value) : condition.value;

    switch (operator) {
      case 'eq':
        filter[fieldName] = value;
        break;
      case 'ne':
        filter[fieldName] = { $ne: value };
        break;
      case 'in':
        filter[fieldName] = { $in: value };
        break;
      case 'not_in':
        filter[fieldName] = { $nin: value };
        break;
      case 'gt':
        filter[fieldName] = { $gt: value };
        break;
      case 'gte':
        filter[fieldName] = { $gte: value };
        break;
      case 'lt':
        filter[fieldName] = { $lt: value };
        break;
      case 'lte':
        filter[fieldName] = { $lte: value };
        break;
      case 'starts_with':
        filter[fieldName] = { $startsWith: value };
        break;
      case 'ends_with':
        filter[fieldName] = { $endsWith: value };
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
        filter[fieldName] = { $contains: value };
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
 * [#7724] A REFERENTIAL refusal — the engine's `cascadeDeleteRelations` found
 * dependent rows it may neither cascade nor null, so it vetoed the delete
 * (`DELETE_RESTRICTED`, 409, ADR-0112).
 *
 * The third shape in this file, and the one that shows why the set had to be
 * widened rather than left at two. The two arms above both map errors raised by
 * code that *knows about better-auth* — the record validator and this package's
 * own policy guards. A referential restrict is raised by the ENGINE, several
 * layers below, and carries neither signature; `rethrowAsBetterAuthError` fell
 * through to `throw err`, better-auth's router saw an unhandled fault, and the
 * admin caller got a **500 with an empty body** for a refusal the engine had
 * explained in full. The client is told nothing at all — not the status, not the
 * dependent object, not the remedy.
 *
 * Mapped HERE, at the adapter, rather than at the REST transport: this is the
 * seam where an engine error crosses into better-auth, so one arm covers every
 * better-auth endpoint that deletes through the adapter. `rest-server.ts`'s
 * `mapDataError` already maps the same code correctly for the generic data
 * routes and is deliberately untouched — the two transports map the one engine
 * error independently, exactly as they already do for the two arms above.
 *
 * The structured half of the envelope rides along unchanged (`developerMessage`
 * / `dependentObject` / `dependentCount`), for the reason #7307 gives at the
 * REST mapping: dropping the remedy at the transport moves the defect rather
 * than fixing it, and the fields disclose nothing the envelope did not carry.
 */
function isReferentialDeleteRestriction(
  err: unknown,
): err is {
  code?: string;
  message?: string;
  developerMessage?: string;
  dependentObject?: string;
  dependentCount?: number;
} {
  if (!err || typeof err !== 'object') return false;
  return (err as { code?: unknown }).code === 'DELETE_RESTRICTED';
}

/**
 * Re-throw `err` as a better-auth `APIError` when it is an ObjectQL validation
 * failure (400), an engine policy refusal (403) or a referential delete
 * restriction (409); otherwise re-throw it verbatim. Always throws — the return
 * type is `never`.
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
  if (isReferentialDeleteRestriction(err)) {
    const { APIError } = await import('better-auth/api');
    throw new APIError('CONFLICT', {
      message:
        typeof err.message === 'string' && err.message.trim()
          ? err.message
          : 'Cannot delete: dependent records exist',
      code: 'DELETE_RESTRICTED',
      ...(typeof err.developerMessage === 'string' && err.developerMessage.length > 0
        ? { developerMessage: err.developerMessage }
        : {}),
      ...(err.dependentObject ? { dependentObject: err.dependentObject } : {}),
      ...(typeof err.dependentCount === 'number' ? { dependentCount: err.dependentCount } : {}),
    });
  }
  throw err;
}

/**
 * Wrap every function-valued method of a better-auth adapter so an ObjectQL
 * `ValidationError` (400), an engine policy refusal (403) or a referential
 * delete restriction (409, #7724) thrown from the underlying engine surfaces as
 * a 4xx `APIError` instead of an opaque 500. Non-function properties pass
 * through untouched, and every error that carries none of those signatures is
 * re-thrown verbatim.
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
  // [#8009] The OIDC `clientSecret` seam needs the engine's PRIVILEGED secret
  // dereference, which `withSystemContext` deliberately does not carry (it
  // exposes the CRUD verbs only). `resolveSecretField` is a separately-named
  // privileged verb for exactly that reason (#7823), so it comes off the raw
  // engine. See `sso-client-secret.ts` for why the seam sits here at all.
  const secretEngine = rawDataEngine as unknown as SecretResolvingEngine;
  // [#7823, #7987] Same access rule for the internal-field readback seam:
  // `resolveInternalField` (#8118) is the privileged batch accessor that
  // recovers `sys_session.token` and `sys_account`'s OAuth token columns after
  // the engine's `internal: true` read strip, so better-auth's lifecycle
  // routes (revoke-other-sessions, sliding-expiry refresh, expired-session
  // cleanup) and its token-exchange routes (/get-access-token, /account-info,
  // /refresh-token) see the row whole while the generic data API does not.
  // See `internal-field-readback.ts`.
  const internalFieldEngine = rawDataEngine as unknown as InternalFieldResolvingEngine;
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
        const payload = normaliseIdentifierWrite(model, data);
        const row = bridged ? remapKeys(payload, camelToSnake) : payload;
        // [#8009] Registration write door #1. Lift the OIDC `clientSecret` out
        // of the cleartext JSON blob into the `secret`-typed column so the
        // ENGINE encrypts it; `oidc_config` keeps everything else.
        liftClientSecretForWrite(objectName, row);
        // [#7725] `sys_member` declares `{organization_id, user_id}` unique, and
        // the platform auto-binds every user at sign-up (ADR-0093 D1/D2), so
        // better-auth's accept-invitation `createMember` collides on a pair that
        // by declaration IS the membership it is trying to create. Adopt that row
        // instead of minting a second one. Returns `null` for every other case —
        // other object, unidentifiable pair, no existing row — and then this is a
        // plain insert, byte for byte as before. See `adopt-membership.ts` for
        // why the seam is here and what adoption does to the role.
        const adopted = await adoptExistingMembership(dataEngine as any, objectName, row);
        const result = adopted ?? (await dataEngine.insert(objectName, row));
        const norm = normaliseLegacyDates(model, result);
        return (bridged ? remapKeys(norm, snakeToCamel) : norm) as T;
      },

      findOne: async <T>(
        { model, where, select, join: _join }: { model: string; where: CleanedWhere[]; select?: string[]; join?: any },
      ): Promise<T | null> => {
        const objectName = resolveProtocolName(model);
        const bridged = objectName !== model;
        const filter = convertWhere(model, bridged ? remapWhere(where) : where);
        let fields = bridged && select ? select.map(camelToSnake) : select;
        // [#7732] A projection that omits `revoked_at` would make every row look
        // live to the tombstone rule. Ask for it, then drop it again below if
        // the caller did not.
        const revokedAtIsBorrowed =
          objectName === SystemObjectName.SESSION &&
          Array.isArray(fields) &&
          fields.length > 0 &&
          !fields.includes('revoked_at');
        if (revokedAtIsBorrowed) fields = [...(fields as string[]), 'revoked_at'];

        const result = await dataEngine.findOne(objectName, { where: filter, fields });
        if (!result) return null;
        // [#7732] A revoked session is not a session — see `session-tombstone.ts`.
        if (await hideRevokedSessionRow(objectName, result)) return null;
        if (revokedAtIsBorrowed) delete (result as Record<string, unknown>).revoked_at;
        // [#8009] Read half — MANDATORY. `/sso/callback` reads the provider back
        // and authenticates to the IdP with the plaintext; encrypt-on-write
        // without this breaks every federated login.
        await injectClientSecretOnRead(secretEngine, objectName, result);
        // [#7823, #7987] Session and account rows come back missing their
        // credential columns off the engine's generic read path
        // (`internal: true`); better-auth reads `session.token` back off this
        // result to re-sign cookies, refresh, sign out and revoke, and reads
        // `account.{accessToken,refreshToken,idToken}` back off it to answer
        // and refresh OAuth tokens. Re-attach them through the privileged
        // accessor. The projection guard uses the CALLER's select, not the
        // tombstone-borrowed one above.
        await reattachInternalFieldsOnRead(
          internalFieldEngine,
          objectName,
          result,
          bridged && select ? select.map(camelToSnake) : select,
        );
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
        const filter = where ? convertWhere(model, bridged ? remapWhere(where) : where) : {};

        const orderBy = sortBy
          ? [{ field: bridged ? camelToSnake(sortBy.field) : sortBy.field, order: sortBy.direction as 'asc' | 'desc' }]
          : undefined;

        const found = await dataEngine.find(objectName, {
          where: filter,
          limit: limit || 100,
          offset,
          orderBy,
        });
        // [#7732] A revoked session is not a session — see `session-tombstone.ts`.
        const results = await filterRevokedSessionRows(objectName, found);
        // [#8009] Same read half, per row — better-auth reaches the provider
        // through findMany as well as findOne.
        for (const r of results) await injectClientSecretOnRead(secretEngine, objectName, r);
        // [#7823, #7987] Same readback, batched over the whole result. This is
        // the read `revoke-other-sessions` filters by `session.token`, where a
        // token-less row set made it answer `200 {status:true}` while revoking
        // nothing (measured) — and it is ALSO the read better-auth's
        // `internalAdapter.findAccounts(userId)` issues, which feeds every
        // OAuth token-exchange route. One privileged read serves the page per
        // column (#8118's batch shape); this verb has no projection, so no
        // guard is needed.
        await reattachInternalFieldsOnRead(internalFieldEngine, objectName, results);

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
        const filter = where ? convertWhere(model, bridged ? remapWhere(where) : where) : {};
        return await dataEngine.count(objectName, { where: filter });
      },

      update: async <T>(
        { model, where, update }: { model: string; where: CleanedWhere[]; update: T },
      ): Promise<T | null> => {
        const objectName = resolveProtocolName(model);
        const bridged = objectName !== model;
        const filter = convertWhere(model, bridged ? remapWhere(where) : where);

        // ObjectQL requires an ID for updates – find the record first
        const record = await dataEngine.findOne(objectName, { where: filter });
        if (!record) return null;

        const normalised = normaliseIdentifierWrite(model, update as any);
        const patch = bridged ? remapKeys(normalised, camelToSnake) : normalised;
        // [#8009] Write door #2 — `/sso/update-provider`. A create-only seam
        // would encrypt at registration and then write cleartext back on the
        // first config edit, leaving a column that only LOOKS protected.
        liftClientSecretForWrite(objectName, patch);
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
        const filter = convertWhere(model, bridged ? remapWhere(where) : where);

        // Sequential updates: ObjectQL requires an ID per update
        const records = await dataEngine.find(objectName, { where: filter });
        const normalised = normaliseIdentifierWrite(model, update);
        const patch = bridged ? remapKeys(normalised, camelToSnake) : normalised;
        // [#8009] Write door #3. Same column, same rule — a bulk edit must not
        // be the one path that writes the secret back in cleartext.
        liftClientSecretForWrite(objectName, patch);
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
        const filter = convertWhere(model, bridged ? remapWhere(where) : where);

        const record = await dataEngine.findOne(objectName, { where: filter });
        if (!record) return;

        // [#7732] An interactive revoke ends the session by stamping it, not by
        // deleting it — see `session-tombstone.ts` for the ledger and the seam.
        if (!(await reconcileSessionDelete(dataEngine, objectName, record))) return;

        await dataEngine.delete(objectName, { where: { id: record.id } });
      },

      deleteMany: async (
        { model, where }: { model: string; where: CleanedWhere[] },
      ): Promise<number> => {
        const objectName = resolveProtocolName(model);
        const bridged = objectName !== model;
        const filter = convertWhere(model, bridged ? remapWhere(where) : where);

        const found = await dataEngine.find(objectName, { where: filter });
        // [#7732] Same rule, per row: a matched session the platform has
        // already tombstoned is left exactly as it is.
        const records = await filterRevokedSessionRows(objectName, found);
        for (const record of records) {
          if (!(await reconcileSessionDelete(dataEngine, objectName, record))) continue;
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
        const filter = convertWhere(model, bridged ? remapWhere(where) : where);

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
        const filter = convertWhere(model, bridged ? remapWhere(where) : where);

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
      const result = await dataEngine.insert(objectName, normaliseIdentifierWrite(model, data));
      return result as T;
    },

    findOne: async <T>({ model, where, select, join: _join }: { model: string; where: CleanedWhere[]; select?: string[]; join?: any }): Promise<T | null> => {
      const objectName = resolveProtocolName(model);
      const filter = convertWhere(model, where);
      const result = await dataEngine.findOne(objectName, { where: filter, fields: select });
      return result ? result as T : null;
    },

    findMany: async <T>({ model, where, limit, offset, sortBy, join: _join }: { model: string; where?: CleanedWhere[]; limit: number; offset?: number; sortBy?: { field: string; direction: 'asc' | 'desc' }; join?: any }): Promise<T[]> => {
      const objectName = resolveProtocolName(model);
      const filter = where ? convertWhere(model, where) : {};
      const orderBy = sortBy ? [{ field: sortBy.field, order: sortBy.direction as 'asc' | 'desc' }] : undefined;
      const results = await dataEngine.find(objectName, { where: filter, limit: limit || 100, offset, orderBy });
      return results as T[];
    },

    count: async ({ model, where }: { model: string; where?: CleanedWhere[] }): Promise<number> => {
      const objectName = resolveProtocolName(model);
      const filter = where ? convertWhere(model, where) : {};
      return await dataEngine.count(objectName, { where: filter });
    },

    update: async <T>({ model, where, update }: { model: string; where: CleanedWhere[]; update: Record<string, any> }): Promise<T | null> => {
      const objectName = resolveProtocolName(model);
      const filter = convertWhere(model, where);
      const record = await dataEngine.findOne(objectName, { where: filter });
      if (!record) return null;
      const result = await dataEngine.update(objectName, {
        ...normaliseIdentifierWrite(model, update),
        id: record.id,
      });
      return result ? result as T : null;
    },

    updateMany: async ({ model, where, update }: { model: string; where: CleanedWhere[]; update: Record<string, any> }): Promise<number> => {
      const objectName = resolveProtocolName(model);
      const filter = convertWhere(model, where);
      const records = await dataEngine.find(objectName, { where: filter });
      const patch = normaliseIdentifierWrite(model, update);
      for (const record of records) {
        await dataEngine.update(objectName, { ...patch, id: record.id });
      }
      return records.length;
    },

    delete: async ({ model, where }: { model: string; where: CleanedWhere[] }): Promise<void> => {
      const objectName = resolveProtocolName(model);
      const filter = convertWhere(model, where);
      const record = await dataEngine.findOne(objectName, { where: filter });
      if (!record) return;
      await dataEngine.delete(objectName, { where: { id: record.id } });
    },

    deleteMany: async ({ model, where }: { model: string; where: CleanedWhere[] }): Promise<number> => {
      const objectName = resolveProtocolName(model);
      const filter = convertWhere(model, where);
      const records = await dataEngine.find(objectName, { where: filter });
      for (const record of records) {
        await dataEngine.delete(objectName, { where: { id: record.id } });
      }
      return records.length;
    },
  };
}
