// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user_position.position` must name a `sys_position` catalog row — the
 * write-path refusal for an assignment that names nothing.
 *
 * ## The hole
 *
 * `position` is declared `Field.text` and references `sys_position.name` by
 * convention only, while every sibling reference column on the same row
 * (`user_id`, `organization_id`, `business_unit_id`, `granted_by`,
 * `delegated_from`) is a `Field.lookup` the engine already refuses when it
 * names no row (`reference_not_found`, `assertReferencesResolve` in
 * `@objectstack/objectql`). So a value naming no catalog row was stored and
 * answered `201`, and then resolved to nothing: the runtime resolver joins
 * `sys_position` BY NAME, so the assignment granted no permission set, reached
 * no sharing rule and put nothing in `current_user.positions` that any reader
 * could act on. The holder signed in to an app that reads nothing, and no layer
 * said why. The measured spelling is the position's record ID written where its
 * NAME belongs — the neighbouring `user_id` is an id, and the analogous
 * `sys_user_permission_set.permission_set_id` is genuinely id-typed, so the id
 * is what an author reaches for by analogy.
 *
 * ## The predicate — exactly "no catalog row carries this name"
 *
 * Ruled on the card that filed the hole (#16712, maintainer-confirmed),
 * verbatim: «⛔ The predicate is exactly "no catalog row carries this name" —
 * never "this assignment cannot take effect": ADR-0049 keeps a deactivated
 * position's assignment while it stops granting». So a DEACTIVATED position
 * (`active: false`) is still a catalog row, and an assignment naming it is
 * accepted — it stops granting, it is not refused.
 *
 * ## Whose catalog — the writer's organization plus organization-less rows
 *
 * The ruling fixes the predicate; #20297 fixes the catalog it reads, by the
 * platform's standing tenancy rule rather than by a new one. Every catalog read
 * here runs under {@link catalogReadContext} — `{ ...context, isSystem: true }`,
 * the `sudo()`-shaped elevation of the engine's own lookup probe
 * (`assertReferencesResolve` in `@objectstack/objectql`, #19808), never a bare
 * `{ isSystem: true }`:
 *
 * - the elevation is about VISIBILITY: existence is a fact about the database,
 *   not about the writer's row-level reach, so RBAC, RLS and FLS are bypassed;
 * - it is never about TENANCY: the writer's context is spread first, so the
 *   engine forwards its `tenantId` to the driver, which reads the writer's
 *   organization plus organization-less rows (`organization_id IS NULL`).
 *
 * So a name only ANOTHER organization's catalog carries is refused exactly like
 * a name no organization carries — the same envelope and the same message —
 * and the accept-or-refuse answer tells an organization admin nothing about any
 * other organization's catalog. The bare spelling read every organization,
 * which accepted such a name (it resolves nothing in the writer's organization)
 * and answered "some other organization has this position" apart from "no one
 * has it": the cross-tenant existence oracle the engine probe (#19808) and the
 * delegated-admin gate's position-name reads (#19819, #19860) were closed
 * against. Under a `single` posture the declared catalog is seeded with no
 * organization, so when the deployment holds one organization every writer
 * reads the whole catalog; a `single` deployment holding several (reported at
 * `error` at boot, #17010) gives each writer its active organization's
 * positions plus the organization-less ones. A writer whose context names no
 * organization reads every organization's rows, as the engine probe does.
 *
 * ## Which writes it judges
 *
 * - a non-system INSERT, one row or a batch — every row's `position`,
 *   whatever its JSON type (see the stand-downs below for the string form it
 *   is judged by);
 * - a non-system UPDATE whose payload carries `position`: by id, only when the
 *   value's string form differs from the string form of the value the row
 *   already stores (a form that echoes an unchanged value back — `123` over a
 *   stored `'123'` included — is not writing a new name); by predicate
 *   (`multi: true`), always, because the value lands on every matched row.
 *
 * It stands down, deliberately, on:
 *
 * - every `isSystem` write — the stand-down the engine's own lookup refusal and
 *   this plugin's whole security middleware take. That covers the seed loader,
 *   which on a fresh `single`-posture boot writes `stack.data` from
 *   `AppPlugin.start()`, BEFORE `kernel:ready` seeds the declared catalog: a
 *   refusal there would turn every authored assignment seed into a failed boot
 *   that succeeds on the second one. It also covers invitation acceptance and
 *   the platform's own bootstraps;
 * - a value the engine answers itself, and only those: `null` or a blank
 *   string (`required`); one whose `String()` form is longer than the column
 *   (`max_length`); and an operator object, a plain object carrying a declared
 *   filter operator as an own key such as `{ $in: [...] }` (`invalid_type`,
 *   #5922, mirrored from the engine's own predicate). The engine's `text`
 *   validation refuses no other number, boolean, object or array, and the
 *   write stores it with `201` (measured over SQLite: `123`, `true`, `{}`,
 *   `{ a: 1 }` and `['x']` all stored). So those are judged by their string
 *   form — a scalar by `String(value)`, an object or array by its JSON text —
 *   and refused like any name no catalog row carries. The stored text is the
 *   driver's, not that string form (SQLite stores `123` as `'123.0'`), so a
 *   non-string whose string form happens to equal a catalog name is accepted
 *   and resolves nothing: the engine's `text` leniency, outside this refusal;
 * - an update the engine refuses on its own dispatch predicate.
 *
 * ## Where it runs
 *
 * Registered by `SecurityPlugin` AFTER its security middleware, so it runs
 * INSIDE it: the delegated-admin gate and the object CRUD check have both
 * passed before the catalog is consulted. A caller who may not write this
 * table is refused `403` on authority, identically whatever the value names,
 * and never sees the catalog verdict. The tenant boundary is the catalog
 * read's own (above), not this placement's.
 *
 * The placement is also what lets the by-id PRE-IMAGE read ({@link SYSTEM_CTX})
 * stay bare: that read happens only after the security middleware has admitted
 * the writer's update of that id. An update naming another organization's row
 * id and one naming an id that exists nowhere are both refused there, `403
 * PERMISSION_DENIED` with one identical answer, before this refusal runs —
 * measured on a two-organization walled posture and pinned beside it.
 *
 * ## The envelope
 *
 * `400 VALIDATION_FAILED` with one `fields[]` entry per offending value, at
 * `field: 'position'`, `code: 'reference_not_found'` — the envelope the sibling
 * lookup columns on this very row already answer with, so an author meets one
 * dialect for "this reference names nothing". No new error code: the top-level
 * code is the registered ADR-0112 `VALIDATION_FAILED` (built by
 * `validationFailure`, the shared constructor both HTTP doors map to 400), and
 * the field-level code is a member of the closed ADR-0114 catalog. The message
 * names the value, says the column takes the catalog NAME, and names the fix —
 * the name itself when the value is the record id of a position the writer's
 * catalog holds (read the same way as the check, so never another
 * organization's).
 *
 * ## Fails open
 *
 * A catalog that cannot be read (the object is not registered in this
 * composition, or the read throws) refuses nothing — an integrity check that
 * cannot run must not invent a rejection, the stance the engine's own lookup
 * probe takes. A failed read is reported at `warn`: the write proceeds, and the
 * operator is told the check did not run. A name the query layer would read as
 * a filter placeholder (`{…}`) is not a failed read: it is compared literally
 * (`catalogCarries`), so its verdict never falls open.
 */

import { resolveEngineUpdateDispatch, type EngineUpdateDispatchData } from '@objectstack/metadata-core';
import type { FieldErrorCode } from '@objectstack/spec/api';
import {
  ALL_OPERATORS,
  RETIRED_FILTER_OPERATORS,
  classifyFilterToken,
  isPlainRecord,
} from '@objectstack/spec/data';
import { validationFailure } from '@objectstack/types';
import { SysUserPosition } from './objects/sys-user-position.object.js';

/** The assignment object this refusal is registered on. */
export const POSITION_ASSIGNMENT_OBJECT = 'sys_user_position';
/** The catalog a `position` value must name a row of. */
export const POSITION_CATALOG_OBJECT = 'sys_position';
/** The column judged, on {@link POSITION_ASSIGNMENT_OBJECT}. */
export const POSITION_FIELD = 'position';

/**
 * The by-id PRE-IMAGE read only (is the stored `position` being changed?) —
 * never a catalog read. Bare, because the security middleware has already
 * refused, identically, every row id the writer cannot update (see "Where it
 * runs"); every catalog read goes through {@link catalogReadContext}.
 */
const SYSTEM_CTX = { isSystem: true } as const;

/**
 * The context every `sys_position` read runs under: the writer's own context
 * with `isSystem` set — the engine lookup probe's `sudo()`-shaped spelling. The
 * spread carries the writer's `tenantId`, so the read sees the writer's
 * organization plus organization-less rows; a context naming no organization
 * reads every organization. ⛔ Never a bare `{ isSystem: true }` here: that
 * spans every organization and makes the refusal a cross-tenant existence
 * oracle (module note, "Whose catalog").
 */
function catalogReadContext(context: unknown): Record<string, unknown> {
  const own = context && typeof context === 'object' ? (context as Record<string, unknown>) : {};
  return { ...own, isSystem: true };
}

/**
 * One `fields[]` entry of the refusal. `code` is typed to the closed ADR-0114
 * field-level catalog, so the literal written below is a member of it by
 * construction — the field-addressed vocabulary, one level below `error.code`.
 */
interface PositionFieldError {
  field: string;
  code: FieldErrorCode;
  message: string;
  label: string;
  value: string;
  constraint: { target: string; targetField: string };
}

const positionDef = (SysUserPosition as any).fields?.[POSITION_FIELD] ?? {};
/** The column's declared label — what the message names it by. */
const POSITION_LABEL: string = typeof positionDef.label === 'string' ? positionDef.label : 'Position';
/** The column's declared bound; a longer value is the engine's `max_length` to answer. */
const POSITION_MAX_LENGTH: number = typeof positionDef.maxLength === 'number' ? positionDef.maxLength : 100;

export interface PositionCatalogRefusalDeps {
  /** ObjectQL engine handle (elevated catalog and pre-image reads). */
  ql: any;
  logger?: { warn?: (msg: string, meta?: any) => void };
}

function rowsOf(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data];
  return [];
}

/**
 * The string form a `position` value is judged by: a string as itself, a
 * number, bigint or boolean as `String(value)`, an object or array as its JSON
 * text (`{}`, `["x"]`) — never `String(['x'])`, which reads `'x'` and would
 * accept an array naming a real position that then resolves nothing. It is not
 * the stored text, which is the driver's (SQLite stores `123` as `'123.0'`).
 * `undefined` only for `null`, `undefined`, a symbol, a function, and an object
 * that can be neither serialised nor stringified; a bigint is `String(value)`.
 */
function stringForm(value: unknown): string | undefined {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'bigint':
    case 'boolean':
      return String(value);
    case 'object': {
      if (value === null) return undefined;
      try {
        const json = JSON.stringify(value);
        if (typeof json === 'string') return json;
      } catch {
        // not JSON-serialisable: fall back to the engine's own reading below
      }
      try {
        return String(value);
      } catch {
        return undefined;
      }
    }
    default:
      return undefined;
  }
}

/**
 * [#5922] The filter-operator keys the engine refuses as a `text` value: the
 * spec's `ALL_OPERATORS` plus the retired ones, the same two inputs as
 * `FILTER_OPERATOR_KEYS` in `@objectstack/objectql`'s `record-validator.ts`.
 */
const FILTER_OPERATOR_KEYS: ReadonlySet<string> = new Set<string>([
  ...ALL_OPERATORS,
  ...Object.keys(RETIRED_FILTER_OPERATORS),
]);

/**
 * [#5922] Is this an operator object — a `where` node pasted into the write —
 * which the engine itself refuses on a `text` field (`invalid_type`)? A narrow
 * mirror of `filterOperatorKeysIn` in `record-validator.ts`, module-private
 * there: the spec's `isPlainRecord` test, no `Date`, and at least one own key in
 * {@link FILTER_OPERATOR_KEYS}. ⛔ Not a `$`-prefix test: `{ $foo: 1 }` carries
 * no declared operator, the engine stores it, and it is judged here.
 */
function isFilterOperatorObject(value: unknown): boolean {
  if (!isPlainRecord(value) || value instanceof Date) return false;
  return Object.keys(value).some((key) => FILTER_OPERATOR_KEYS.has(key));
}

/**
 * The name this refusal judges a `position` value by, or `undefined` for a
 * value the engine answers itself: `null` and a blank string (`required`), a
 * value whose `String()` form is longer than the column (`max_length`, which
 * the engine reads on `String(value)` for every type), and an operator object
 * (`invalid_type`, #5922). Every other value is judged, strings or not (module
 * note, "Which writes it judges").
 */
function judgedName(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  if (isFilterOperatorObject(value)) return undefined;
  let engineForm: string;
  try {
    engineForm = String(value);
  } catch {
    return undefined;
  }
  if (engineForm.length > POSITION_MAX_LENGTH) return undefined;
  return stringForm(value);
}

/**
 * The `position` values this write would STORE as new names, in first-seen
 * order and without repeats. Empty when the write names none this refusal
 * judges (see the module note for which writes those are).
 */
export async function writtenPositionNames(ql: any, opCtx: any): Promise<string[]> {
  const out: string[] = [];
  const add = (value: unknown) => {
    const name = judgedName(value);
    if (name !== undefined && !out.includes(name)) out.push(name);
  };

  if (opCtx?.operation === 'insert') {
    for (const row of rowsOf(opCtx.data)) add(row?.[POSITION_FIELD]);
    return out;
  }
  if (opCtx?.operation !== 'update') return out;

  const data = opCtx.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  if (!Object.prototype.hasOwnProperty.call(data, POSITION_FIELD)) return out;
  const next = (data as Record<string, unknown>)[POSITION_FIELD];
  const nextName = judgedName(next);
  if (nextName === undefined) return out;

  let route: ReturnType<typeof resolveEngineUpdateDispatch>;
  try {
    route = resolveEngineUpdateDispatch(data as EngineUpdateDispatchData, opCtx.options);
  } catch {
    return out; // the engine answers a malformed call itself
  }
  if (route.kind === 'multi') {
    add(next);
    return out;
  }
  if (route.kind !== 'by-id') return out; // the engine refuses it on its own predicate

  // By id: a new name only when it differs from the stored one. A missing row
  // is the engine's to answer (not found), never a catalog verdict.
  let prev: any = null;
  try {
    prev = await ql?.findOne?.(POSITION_ASSIGNMENT_OBJECT, { where: { id: route.id }, context: SYSTEM_CTX });
  } catch {
    prev = null;
  }
  if (!prev) return out;
  // Compared by string form, so `123` echoed over a stored `'123'` is unchanged.
  if (stringForm(prev[POSITION_FIELD]) === nextName) return out;
  add(next);
  return out;
}

/**
 * The names among `names` that no `sys_position` row the WRITER's catalog
 * holds carries — the writer's organization plus organization-less rows, or
 * every organization for a context naming none ({@link catalogReadContext}) —
 * or `null` when the catalog could not be read and nothing may be concluded.
 * `context` is the writer's execution context, required so no caller can
 * silently fall back to an unscoped read.
 *
 * One bounded read per distinct name, never one `$in` read under a row limit:
 * a context naming no organization sees every organization's copy of a name,
 * so a limited `$in` page can fill with copies of one name and report the
 * others missing.
 */
export async function namesWithoutCatalogRow(
  deps: PositionCatalogRefusalDeps,
  names: readonly string[],
  context: unknown,
): Promise<string[] | null> {
  const { ql, logger } = deps;
  if (names.length === 0) return [];
  if (!ql || typeof ql.find !== 'function') return null;
  // An unregistered catalog is a composition without one — nothing to judge
  // against, the same silent stand-down the engine's own lookup probe takes.
  if (typeof ql.getSchema === 'function' && !ql.getSchema(POSITION_CATALOG_OBJECT)) return null;

  const readCtx = catalogReadContext(context);
  const missing: string[] = [];
  for (const name of names) {
    let carried: boolean;
    try {
      carried = await catalogCarries(ql, name, readCtx);
    } catch (e) {
      logger?.warn?.(
        `[security] the ${POSITION_CATALOG_OBJECT} catalog could not be read, so a ` +
          `${POSITION_ASSIGNMENT_OBJECT} write was NOT checked for a position name that resolves ` +
          `to no catalog row — it proceeds unchecked`,
        { object: POSITION_ASSIGNMENT_OBJECT, error: (e as Error)?.message ?? String(e) },
      );
      return null;
    }
    if (!carried) missing.push(name);
  }
  return missing;
}

/**
 * Does the catalog, read under `readCtx`, hold a row whose `name` is exactly
 * `name`? A name the query layer would read as a filter PLACEHOLDER (a
 * fully-wrapped `{…}`, recognised by the spec's `classifyFilterToken`, the
 * predicate `@objectstack/core`'s `resolveFilterTokens` applies to every `where`
 * comparand) cannot go in `where` as itself: an unknown token throws
 * `FILTER_TOKEN_UNKNOWN` and a known one is replaced by its value, so the read
 * would fail open or judge a different name. Such a name is compared here
 * instead, against the catalog names that share its first character.
 */
async function catalogCarries(ql: any, name: string, readCtx: Record<string, unknown>): Promise<boolean> {
  if (classifyFilterToken(name) === null) {
    const rows = await ql.find(POSITION_CATALOG_OBJECT, { where: { name }, limit: 1, context: readCtx });
    return Array.isArray(rows) && rows.length > 0;
  }
  const rows = await ql.find(POSITION_CATALOG_OBJECT, {
    where: { name: { $startsWith: name.charAt(0) } },
    fields: ['name'],
    context: readCtx,
  });
  return Array.isArray(rows) && rows.some((row: any) => row?.name === name);
}

/**
 * For each missing value that is the record ID of a position the writer's
 * catalog holds, that position's NAME — the exact fix. Read under the same
 * {@link catalogReadContext} as the check itself, so the hint can name only a
 * position the check could have accepted, never another organization's. A read
 * that fails yields no hint.
 */
export async function idSpellingHints(
  deps: PositionCatalogRefusalDeps,
  values: readonly string[],
  context: unknown,
): Promise<Map<string, string>> {
  const hints = new Map<string, string>();
  const { ql } = deps;
  if (!ql || typeof ql.find !== 'function') return hints;
  const readCtx = catalogReadContext(context);
  for (const value of values) {
    // A placeholder-shaped value is never a record id, and in `where` it would
    // be resolved as a filter token rather than compared (see catalogCarries).
    if (classifyFilterToken(value) !== null) continue;
    try {
      const rows = await ql.find(POSITION_CATALOG_OBJECT, { where: { id: value }, limit: 1, context: readCtx });
      const row = Array.isArray(rows) ? rows[0] : null;
      const name = row && typeof row.name === 'string' && row.name !== '' ? row.name : null;
      if (!name) continue;
      hints.set(value, name);
    } catch {
      // No hint — the refusal still stands and still names the column's contract.
    }
  }
  return hints;
}

/** The sentence an author reads — names the value, the column's contract and the fix. */
export function positionNotInCatalogMessage(value: string, idOfPosition?: string): string {
  if (idOfPosition) {
    return (
      `${POSITION_LABEL}: no position is named '${value}' — that is the record id of the position ` +
      `'${idOfPosition}'. ${POSITION_ASSIGNMENT_OBJECT}.${POSITION_FIELD} takes the position's machine name ` +
      `(${POSITION_CATALOG_OBJECT}.name), never its id: write '${idOfPosition}'.`
    );
  }
  return (
    `${POSITION_LABEL}: no position is named '${value}'. ${POSITION_ASSIGNMENT_OBJECT}.${POSITION_FIELD} ` +
    `takes the machine name of a position in the catalog (${POSITION_CATALOG_OBJECT}.name), never its record ` +
    `id: write the name of an existing position, or create the position first.`
  );
}

/**
 * The refusal: `VALIDATION_FAILED` (400 at both HTTP doors) with one
 * `reference_not_found` entry per offending value at `field: 'position'`.
 */
export function positionNotInCatalogError(
  values: readonly string[],
  hints: ReadonlyMap<string, string> = new Map(),
): Error {
  const fields = values.map((value): PositionFieldError => ({
    field: POSITION_FIELD,
    code: 'reference_not_found',
    message: positionNotInCatalogMessage(value, hints.get(value)),
    label: POSITION_LABEL,
    value,
    constraint: { target: POSITION_CATALOG_OBJECT, targetField: 'name' },
  }));
  return validationFailure(fields.map((f) => f.message).join('; '), fields);
}

/**
 * Refuse the write when it would store a `position` no catalog row carries.
 * Resolves (does nothing) for every write outside the judged set.
 */
export async function assertPositionNamesCatalogRow(
  deps: PositionCatalogRefusalDeps,
  opCtx: any,
): Promise<void> {
  if (opCtx?.object !== POSITION_ASSIGNMENT_OBJECT) return;
  if (opCtx?.context?.isSystem) return;
  const names = await writtenPositionNames(deps.ql, opCtx);
  if (names.length === 0) return;
  const missing = await namesWithoutCatalogRow(deps, names, opCtx.context);
  if (!missing || missing.length === 0) return;
  const hints = await idSpellingHints(deps, missing, opCtx.context);
  throw positionNotInCatalogError(missing, hints);
}

/**
 * The engine middleware `SecurityPlugin` registers on
 * {@link POSITION_ASSIGNMENT_OBJECT}, after its security middleware.
 */
export function createPositionCatalogRefusal(
  deps: PositionCatalogRefusalDeps,
): (opCtx: any, next: () => Promise<void>) => Promise<void> {
  return async (opCtx, next) => {
    await assertPositionNamesCatalogRow(deps, opCtx);
    await next();
  };
}
