// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user_permission_set.permission_set` — the grant's permission set BY
 * NAME ([ADR-0131] D4), and the write-path refusal for a grant naming a set
 * the security catalog does not hold.
 *
 * ## The grant names its set; nothing derives the name
 *
 * ADR-0131 D4 makes every reference to a catalog item a NAME: a permission set
 * has no row id once the catalog lives only in the registry (D3), so a grant
 * says which set it holds by the set's machine name, and the set itself is the
 * security catalog's definition of that name. Every grant writer in this
 * repository writes the name and nothing else (the organization-admin
 * reconcile, the platform-admin promotion, self-registration, the verify RLS
 * persona, Setup's grant picker). D10 orders the id column's removal after
 * every grant names its set; this is that first step, so `permission_set_id`
 * is optional, no writer fills it, and no write derives the name from it. The
 * column and its data go with D10's later stage. Rows written before the name
 * column existed are named by the one-time backfill
 * (`grant-permission-set-name-backfill.ts`), never here.
 *
 * ## What is refused — exactly "the catalog holds no set by this name"
 *
 * A non-system write that would STORE a `permission_set` value naming no
 * permission set in the security catalog — read through the reader the
 * security plugin binds to its engine (`securityCatalogReaderOf`), the one
 * source the authorization resolver grants a held set through:
 *
 * - an INSERT, every row (`beforeInsert` dispatches once per row);
 * - an UPDATE whose payload carries `permission_set` with a value other than
 *   the one the matched row already stores (an echo is not a new name).
 *
 * The predicate is the one `position-catalog-refusal.ts` applies to
 * `sys_user_position.position`: a DEACTIVATED set is still a set, so a grant
 * naming it is accepted and stops granting through the activation ledger.
 *
 * It stands down, deliberately, on:
 *
 * - every `isSystem` write — seed replay and boot provisioning may write a
 *   grant before the definition it names is registered, the ordering the
 *   engine's own lookup refusal stands down for; the platform's own writers
 *   name built-in sets;
 * - a value the engine answers itself: `null` or a blank string (`required`),
 *   and a value longer than the column (`max_length`);
 * - a composition with no catalog bound to this engine, and a catalog read
 *   that throws (reported at `warn`): an integrity check that cannot run must
 *   not invent a rejection — the stance the sibling refusal and the engine's
 *   lookup probe take. A grant naming nothing the catalog holds confers
 *   nothing either way.
 *
 * ## The envelope
 *
 * `400 VALIDATION_FAILED` (built by `validationFailure`, the constructor both
 * HTTP doors map) with one `fields[]` entry at `field: 'permission_set'`,
 * `code: 'reference_not_found'` — the envelope the sibling assignment's
 * `position` and every lookup column answer with, so an author meets one
 * dialect for "this reference names nothing". No new error code (ADR-0112,
 * ADR-0114).
 *
 * ## Hooks, not a middleware
 *
 * Registered as engine `beforeInsert` / `beforeUpdate` hooks at priority 30:
 * after the guards that refuse on authority or standing (the identity write
 * guard at 10, the last-administrator guard at 20), so a write they refuse
 * costs no catalog read; before default-priority hooks.
 *
 * ADR anchors: ADR-0131 D3 (the catalog's one home), D4 (references by name),
 * D10 (names first, then the id column goes).
 */

import { securityCatalogReaderOf } from '@objectstack/core';
import type { FieldErrorCode } from '@objectstack/spec/api';
import { isPlainRecord } from '@objectstack/spec/data';
import { validationFailure } from '@objectstack/types';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';

/** The grant object this module judges. */
export const GRANT_OBJECT = 'sys_user_permission_set';
/** The grant's legacy id reference to a catalog row (dropped by ADR-0131 D10; read only by the backfill and the D10 report). */
export const GRANT_SET_ID_FIELD = 'permission_set_id';
/** The grant's NAME reference to the permission set (ADR-0131 D4). */
export const GRANT_SET_NAME_FIELD = 'permission_set';
/** The legacy row table the backfill reads an id's name from. */
export const PERMISSION_SET_CATALOG_OBJECT = 'sys_permission_set';
/** The security catalog type a `permission_set` value must name an item of. */
const PERMISSION_SET_CATALOG_TYPE = 'permission';
/** The `packageId` both hooks register under, so they bind and unbind as one. */
export const GRANT_SET_NAME_HOOK_PACKAGE = 'plugin-security:grant-permission-set-name';

const HOOK_PRIORITY = 30;

const nameDef = (SysUserPermissionSet as any).fields?.[GRANT_SET_NAME_FIELD] ?? {};
/** The column's declared label — what the refusal names it by. */
const NAME_LABEL: string = typeof nameDef.label === 'string' ? nameDef.label : 'Permission Set';
/** The column's declared bound; a longer value is the engine's `max_length` to answer. */
const NAME_MAX_LENGTH: number = typeof nameDef.maxLength === 'number' ? nameDef.maxLength : 100;

/** One `fields[]` entry of the refusal, typed to the closed ADR-0114 catalog. */
interface GrantNameFieldError {
  field: string;
  code: FieldErrorCode;
  message: string;
  label: string;
  value: string;
  constraint: { target: string; targetField: string };
}

/** The sentence an author reads: the value, the column's contract, the fix. */
export function grantSetNotInCatalogMessage(value: string): string {
  return (
    `${NAME_LABEL}: no permission set is named '${value}'. ${GRANT_OBJECT}.${GRANT_SET_NAME_FIELD} takes the ` +
    `machine name of a permission set in the security catalog (a package's set, a built-in, or one saved ` +
    `through the metadata door), never a record id: write the name of an existing permission set, or ` +
    `declare the set first.`
  );
}

/** The refusal: `VALIDATION_FAILED` (400 at both HTTP doors), `reference_not_found` at `permission_set`. */
export function grantSetNotInCatalogError(value: string): Error {
  const message = grantSetNotInCatalogMessage(value);
  const entry: GrantNameFieldError = {
    field: GRANT_SET_NAME_FIELD,
    code: 'reference_not_found',
    message,
    label: NAME_LABEL,
    value,
    constraint: { target: PERMISSION_SET_CATALOG_TYPE, targetField: 'name' },
  };
  return validationFailure(message, [entry]);
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The name a `permission_set` value is judged by, or `undefined` for a value
 * the engine answers itself (`required`, `max_length`). A non-string is judged
 * by its string form — the engine's `text` leniency would store it, and it
 * names no set.
 */
function judgedName(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  let form: string;
  if (typeof value === 'string') form = value;
  else {
    try {
      form = typeof value === 'object' ? (JSON.stringify(value) ?? String(value)) : String(value);
    } catch {
      return undefined;
    }
  }
  if (form.trim() === '' || form.length > NAME_MAX_LENGTH) return undefined;
  return form;
}

/**
 * [ADR-0131 D4] The permission set a STORED grant names, as every by-name
 * grant reader asks it: the grant's `permission_set`, or `undefined` for a
 * grant that names none — `NULL` or blank, which is a grant written before the
 * column existed that the backfill has not named yet, or one it could not name
 * (an id with no set row, or a set row of another organization).
 *
 * A grant that names nothing grants nothing through a by-name reader: it is
 * never matched to a set, never shown as held, never counted. A reader whose
 * job is to RESTRICT — a revocation, a refused promotion, a duplicate it must
 * not insert — may still reach such a legacy grant through its id until
 * ADR-0131 D10 counts the unnamed grants and drops that column; no reader
 * reaches it through the id to confer anything.
 */
export function grantSetNameOf(row: unknown): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const value = (row as Record<string, unknown>)[GRANT_SET_NAME_FIELD];
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name === '' ? undefined : name;
}

/**
 * The organization a stored grant (or catalog row) belongs to, or `null` for
 * one that belongs to none. A blank value is the legacy organization-less
 * spelling, read the way every grant reader already reads it
 * (`!organization_id`).
 */
export function grantOrganizationOf(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const value = r.organization_id ?? r.organizationId;
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

interface GrantNameEngine {
  registerHook?: (
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ) => void;
  unregisterHooksByPackage?: (packageId: string) => number;
}

type GrantNameLogger = { warn?: (msg: string, meta?: any) => void } | undefined;

/** Refuse `name` when the bound catalog holds no permission set by it (module note). */
async function assertNameInCatalog(engine: GrantNameEngine, name: string, logger: GrantNameLogger): Promise<void> {
  const catalog = securityCatalogReaderOf(engine);
  if (!catalog) return;
  let held: boolean;
  try {
    held = (await catalog.resolve(PERMISSION_SET_CATALOG_TYPE, name)) !== undefined;
  } catch (e) {
    logger?.warn?.(
      `[security] the security catalog could not be read, so a ${GRANT_OBJECT} write was NOT checked for a ` +
        'permission-set name that resolves to no set — it proceeds unchecked',
      { object: GRANT_OBJECT, error: (e as Error)?.message ?? String(e) },
    );
    return;
  }
  if (!held) throw grantSetNotInCatalogError(name);
}

/** `beforeInsert`: one dispatch per row, handed the caller's row as sent. */
async function onInsert(engine: GrantNameEngine, ctx: any, logger: GrantNameLogger): Promise<void> {
  if (ctx?.object !== GRANT_OBJECT || ctx?.session?.isSystem === true) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data)) return;
  const name = judgedName(data[GRANT_SET_NAME_FIELD]);
  if (name !== undefined) await assertNameInCatalog(engine, name, logger);
}

/**
 * `beforeUpdate`: one dispatch per matched row, `previous` bound on both
 * dispatch paths. A value equal to the stored one is an echo, not a new name;
 * with no stored row the engine answers (not found).
 */
async function onUpdate(engine: GrantNameEngine, ctx: any, logger: GrantNameLogger): Promise<void> {
  if (ctx?.object !== GRANT_OBJECT || ctx?.session?.isSystem === true) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data) || !hasOwn(data, GRANT_SET_NAME_FIELD)) return;
  const name = judgedName(data[GRANT_SET_NAME_FIELD]);
  if (name === undefined) return;
  const previous = isPlainRecord(ctx?.previous) ? ctx.previous : undefined;
  if (previous && judgedName(previous[GRANT_SET_NAME_FIELD]) === name) return;
  await assertNameInCatalog(engine, name, logger);
}

/**
 * Bind both hooks on the engine. Returns `false` when the engine exposes no
 * hook registry (a test double), so the caller can say so.
 */
export function registerGrantPermissionSetNameHooks(
  engine: GrantNameEngine | null | undefined,
  logger?: GrantNameLogger,
): boolean {
  if (!engine || typeof engine.registerHook !== 'function') return false;
  engine.registerHook('beforeInsert', (ctx: any) => onInsert(engine, ctx, logger), {
    object: GRANT_OBJECT,
    priority: HOOK_PRIORITY,
    packageId: GRANT_SET_NAME_HOOK_PACKAGE,
  });
  engine.registerHook('beforeUpdate', (ctx: any) => onUpdate(engine, ctx, logger), {
    object: GRANT_OBJECT,
    priority: HOOK_PRIORITY,
    packageId: GRANT_SET_NAME_HOOK_PACKAGE,
  });
  return true;
}

/** Unbind both hooks (plugin teardown). */
export function unregisterGrantPermissionSetNameHooks(engine: GrantNameEngine | null | undefined): void {
  if (engine && typeof engine.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(GRANT_SET_NAME_HOOK_PACKAGE);
  }
}
