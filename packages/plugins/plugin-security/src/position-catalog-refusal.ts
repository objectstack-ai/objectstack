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
 * Ruled on the card that filed the hole (maintainer-confirmed), verbatim:
 * «⛔ The predicate is exactly "no catalog row carries this name" — never "this
 * assignment cannot take effect": ADR-0049 keeps a deactivated position's
 * assignment while it stops granting». So:
 *
 * - a DEACTIVATED position (`active: false`) is still a catalog row, and an
 *   assignment naming it is accepted — it stops granting, it is not refused;
 * - the catalog is read WITHOUT a tenant scope ({@link SYSTEM_CTX}): a name
 *   that some `sys_position` row carries, in any organization, is accepted.
 *   Under a `single` posture every catalog row is organization-less and the
 *   two readings are the same set. Under a walled posture they differ for a
 *   name only ANOTHER organization's catalog carries — accepted here, and it
 *   resolves nothing in the writer's organization. That narrower reading is a
 *   question for the ruling, not a choice this module makes on its own.
 *
 * ## Which writes it judges
 *
 * - a non-system INSERT, one row or a batch — every row's `position`;
 * - a non-system UPDATE whose payload carries `position`: by id, only when the
 *   value differs from the one the row already stores (a form that echoes an
 *   unchanged value back is not writing a new name); by predicate
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
 * - a value the engine answers itself: not a string, empty, or longer than the
 *   column (`required` / `invalid_type` / `max_length`, one condition, one
 *   code);
 * - an update the engine refuses on its own dispatch predicate.
 *
 * ## Where it runs
 *
 * Registered by `SecurityPlugin` AFTER its security middleware, so it runs
 * INSIDE it: the delegated-admin gate and the object CRUD check have both
 * passed before the catalog is consulted. A caller who may not write this
 * table is refused on authority and never sees the catalog verdict, so the
 * verdict is not an existence probe for them — which matters because the
 * catalog read above is not tenant-scoped.
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
 * own organization can see.
 *
 * ## Fails open
 *
 * A catalog that cannot be read (the object is not registered in this
 * composition, or the read throws) refuses nothing — an integrity check that
 * cannot run must not invent a rejection, the stance the engine's own lookup
 * probe takes. A failed read is reported at `warn`: the write proceeds, and the
 * operator is told the check did not run.
 */

import { resolveEngineUpdateDispatch, type EngineUpdateDispatchData } from '@objectstack/metadata-core';
import type { FieldErrorCode } from '@objectstack/spec/api';
import { validationFailure } from '@objectstack/types';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { rowOrganizationId } from './per-organization-catalog.js';

/** The assignment object this refusal is registered on. */
export const POSITION_ASSIGNMENT_OBJECT = 'sys_user_position';
/** The catalog a `position` value must name a row of. */
export const POSITION_CATALOG_OBJECT = 'sys_position';
/** The column judged, on {@link POSITION_ASSIGNMENT_OBJECT}. */
export const POSITION_FIELD = 'position';

/** Existence is a fact about the database, so the catalog is read elevated and unscoped. */
const SYSTEM_CTX = { isSystem: true } as const;

/** The field-level code the sibling lookup columns already answer with. */
const REFERENCE_NOT_FOUND: FieldErrorCode = 'reference_not_found';

const positionDef = (SysUserPosition as any).fields?.[POSITION_FIELD] ?? {};
/** The column's declared label — what the message names it by. */
const POSITION_LABEL: string = typeof positionDef.label === 'string' ? positionDef.label : 'Position';
/** The column's declared bound; a longer value is the engine's `max_length` to answer. */
const POSITION_MAX_LENGTH: number = typeof positionDef.maxLength === 'number' ? positionDef.maxLength : 100;

export interface PositionCatalogRefusalDeps {
  /** ObjectQL engine handle (system-context catalog and pre-image reads). */
  ql: any;
  logger?: { warn?: (msg: string, meta?: any) => void };
}

/** The organization the WRITER acts in — the one whose catalog an id hint may name. */
function callerOrganizationId(context: any): string | undefined {
  const id = context?.organizationId ?? context?.tenantId;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

function rowsOf(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data];
  return [];
}

/** A value this refusal judges: a non-blank string within the column's bound. */
function isJudgedValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= POSITION_MAX_LENGTH;
}

/**
 * The `position` values this write would STORE as new names, in first-seen
 * order and without repeats. Empty when the write names none this refusal
 * judges (see the module note for which writes those are).
 */
export async function writtenPositionNames(ql: any, opCtx: any): Promise<string[]> {
  const out: string[] = [];
  const add = (value: unknown) => {
    if (isJudgedValue(value) && !out.includes(value)) out.push(value);
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
  if (!isJudgedValue(next)) return out;

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
  if (prev[POSITION_FIELD] === next) return out;
  add(next);
  return out;
}

/**
 * The names among `names` that NO `sys_position` row carries — or `null` when
 * the catalog could not be read and nothing may be concluded.
 *
 * One bounded read per distinct name, never one `$in` read under a row limit:
 * a walled posture seeds the same name once per organization, so a limited
 * `$in` page can fill with copies of one name and report the others missing.
 */
export async function namesWithoutCatalogRow(
  deps: PositionCatalogRefusalDeps,
  names: readonly string[],
): Promise<string[] | null> {
  const { ql, logger } = deps;
  if (names.length === 0) return [];
  if (!ql || typeof ql.find !== 'function') return null;
  // An unregistered catalog is a composition without one — nothing to judge
  // against, the same silent stand-down the engine's own lookup probe takes.
  if (typeof ql.getSchema === 'function' && !ql.getSchema(POSITION_CATALOG_OBJECT)) return null;

  const missing: string[] = [];
  for (const name of names) {
    let rows: unknown;
    try {
      rows = await ql.find(POSITION_CATALOG_OBJECT, { where: { name }, limit: 1, context: SYSTEM_CTX });
    } catch (e) {
      logger?.warn?.(
        `[security] the ${POSITION_CATALOG_OBJECT} catalog could not be read, so a ` +
          `${POSITION_ASSIGNMENT_OBJECT} write was NOT checked for a position name that resolves ` +
          `to no catalog row — it proceeds unchecked`,
        { object: POSITION_ASSIGNMENT_OBJECT, error: (e as Error)?.message ?? String(e) },
      );
      return null;
    }
    if (!Array.isArray(rows) || rows.length === 0) missing.push(name);
  }
  return missing;
}

/**
 * For each missing value that is the record ID of a position the writer's own
 * organization can see, that position's NAME — the exact fix. Scoped to the
 * writer's organization (plus organization-less rows) so the hint never names
 * another organization's position. A read that fails yields no hint.
 */
export async function idSpellingHints(
  deps: PositionCatalogRefusalDeps,
  values: readonly string[],
  organizationId?: string,
): Promise<Map<string, string>> {
  const hints = new Map<string, string>();
  const { ql } = deps;
  if (!ql || typeof ql.find !== 'function') return hints;
  for (const value of values) {
    try {
      const rows = await ql.find(POSITION_CATALOG_OBJECT, { where: { id: value }, limit: 1, context: SYSTEM_CTX });
      const row = Array.isArray(rows) ? rows[0] : null;
      const name = row && typeof row.name === 'string' && row.name !== '' ? row.name : null;
      if (!name) continue;
      const owner = rowOrganizationId(row);
      if (organizationId && owner && owner !== organizationId) continue;
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
  const fields = values.map((value) => ({
    field: POSITION_FIELD,
    code: REFERENCE_NOT_FOUND,
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
  const missing = await namesWithoutCatalogRow(deps, names);
  if (!missing || missing.length === 0) return;
  const hints = await idSpellingHints(deps, missing, callerOrganizationId(opCtx.context));
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
