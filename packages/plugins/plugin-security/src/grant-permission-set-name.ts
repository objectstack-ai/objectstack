// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user_permission_set.permission_set` — the grant's permission set BY
 * NAME, written by the platform beside `permission_set_id` ([ADR-0131] D4).
 *
 * ## Why a second column
 *
 * ADR-0131 D4 makes every reference to a catalog item a NAME: a permission set
 * has no row id once the catalog lives only in the registry (D3), so a grant
 * must say which set it holds by the set's machine name. The id column is
 * dropped later, after every grant names its set and the names are verified to
 * resolve (D10). Until then the grant carries both, and this module is what
 * keeps them saying the same thing. Rows written before the column existed are
 * rewritten by the backfill stage, never here. The grant readers of
 * `plugin-security` and `plugin-auth` key on the name ({@link grantSetNameOf},
 * {@link readGrantSetRows}); the authorization resolver in `@objectstack/core`
 * still reads the id until its own stage switches it.
 *
 * ## The invariant: the two columns never disagree
 *
 * The name is DERIVED, never authored: it is the `name` of the
 * `sys_permission_set` row that `permission_set_id` points at. So:
 *
 * - **INSERT**, every row: the set row is read by the row's
 *   `permission_set_id` and its `name` is stamped into `permission_set`. A
 *   supplied value equal to that name is kept; any other value refuses the
 *   write.
 * - **UPDATE carrying `permission_set_id`**: the same, against the NEW id — the
 *   name follows the id it is written with. On a predicate (`multi`) update the
 *   name is a function of the payload alone, so every matched row receives the
 *   same key and the same value (the engine's per-row key-set rule holds).
 * - **UPDATE carrying `permission_set` but not `permission_set_id`**: each
 *   matched row's STORED id decides. The value must equal the name the stored
 *   id resolves to, on every matched row, or the write is refused. A cleared
 *   value (`null`, `''`) is not a clear: the derived name is written back, so a
 *   grant can never be left naming nothing while its id resolves.
 * - **UPDATE writing neither column** leaves the name alone. No backfill rides
 *   an unrelated edit.
 *
 * The stamp is assigned IN PLACE on the hook payload, so the engine records it
 * as a hook write (`hookWrittenKeys`). That is what lets it survive the
 * engine's update-side static `readonly` strip, which drops a non-system
 * caller's value for this column — including a value the caller echoed and
 * the platform wrote back identically. A middleware stamp would not be
 * recorded, and an echoed id change would then land without its new name.
 *
 * ## Who it judges — every writer, system context included
 *
 * The platform's own grant writers (the organization-admin reconcile, the
 * platform-admin promotion, self-registration, the verify RLS persona) write
 * both columns themselves; this hook re-derives the name for them too and
 * refuses a disagreement, so a writer that names the wrong set fails at its
 * first write instead of landing a grant whose two halves disagree. A writer
 * that omits the name — the data door, a seed dataset, any caller outside this
 * repository — gets it stamped.
 *
 * The one place the two contexts part is an id the catalog read cannot
 * resolve (no row, a row outside the writer's organization, a value that is
 * not an id, or no `sys_permission_set` object in this composition):
 *
 * - a **non-system** write that supplies a name is refused — the name cannot
 *   be shown to agree, and the answer is the same refusal whether the id names
 *   nothing or names a set outside the writer's organization. Supplying no name
 *   leaves the row to the engine's own reference check, which refuses a
 *   dangling lookup from a non-system caller (`reference_not_found`);
 * - a **system** write is left as written: seed replay and boot provisioning
 *   may write a grant before the set row it names exists — the ordering the
 *   engine's reference check also stands down for — and the backfill stage
 *   names what such a write left unnamed.
 *
 * ## The catalog read
 *
 * Through `ctx.api.sudo()`: the writer's own context with `isSystem` set — the
 * `sudo()`-shaped elevation the engine's lookup probe uses — never a bare
 * `{ isSystem: true }`. The elevation is about visibility (RBAC, RLS and FLS
 * do not decide which set an id names); the writer's organization still walls
 * the read, so a set in another organization resolves nothing here, and the
 * read joins the writer's transaction. A read that THROWS is not "no such
 * set": it propagates and the write is refused, because a grant landing
 * without its name is the silent half of a dual write. The refusal never
 * echoes the derived name, so it tells a caller nothing about a set it could
 * not otherwise read.
 *
 * ## The envelope
 *
 * `400 VALIDATION_FAILED` (built by `validationFailure`, the constructor both
 * HTTP doors map) with one `fields[]` entry at `field: 'permission_set'`,
 * `code: 'invalid_value'` — a member of the closed ADR-0114 field catalog, so
 * no new error code.
 *
 * ADR anchors: ADR-0131 D4 (references by name), D10 (the id column is
 * dropped after a verified rewrite).
 */

import type { FieldErrorCode } from '@objectstack/spec/api';
import { classifyFilterToken, isPlainRecord } from '@objectstack/spec/data';
import { validationFailure } from '@objectstack/types';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';

/** The grant object this module keeps consistent. */
export const GRANT_OBJECT = 'sys_user_permission_set';
/** The grant's id reference to the catalog row (dropped by ADR-0131 D10). */
export const GRANT_SET_ID_FIELD = 'permission_set_id';
/** The grant's NAME reference to the permission set (ADR-0131 D4). */
export const GRANT_SET_NAME_FIELD = 'permission_set';
/** The catalog the name is derived from. */
export const PERMISSION_SET_CATALOG_OBJECT = 'sys_permission_set';
/** The `packageId` both hooks register under, so they bind and unbind as one. */
export const GRANT_SET_NAME_HOOK_PACKAGE = 'plugin-security:grant-permission-set-name';

/**
 * After the guards that refuse a write on authority or standing (the identity
 * write guard at 10, the last-administrator guard at 20), so a write they
 * refuse costs no catalog read; before default-priority hooks (100), so every
 * later hook sees the settled name.
 */
const HOOK_PRIORITY = 30;

const nameDef = (SysUserPermissionSet as any).fields?.[GRANT_SET_NAME_FIELD] ?? {};
/** The column's declared label — what the refusal names it by. */
const NAME_LABEL: string = typeof nameDef.label === 'string' ? nameDef.label : 'Permission Set Name';

/** One `fields[]` entry of the refusal, typed to the closed ADR-0114 catalog. */
interface GrantNameFieldError {
  field: string;
  code: FieldErrorCode;
  message: string;
  label: string;
  value: unknown;
  constraint: { target: string; targetField: string; derivedFrom: string };
}

/** The sentence an author reads: the value, the column's contract, the fix. */
export function grantSetNameMismatchMessage(value: unknown): string {
  const shown = typeof value === 'string' ? value : safeJson(value);
  return (
    `${NAME_LABEL}: '${shown}' is not the name of the permission set ${GRANT_SET_ID_FIELD} points at. ` +
    `${GRANT_OBJECT}.${GRANT_SET_NAME_FIELD} is written by the platform from ${GRANT_SET_ID_FIELD} — ` +
    `omit it, or send exactly the name of that permission set.`
  );
}

/** The refusal: `VALIDATION_FAILED` (400 at both HTTP doors), `invalid_value` at `permission_set`. */
export function grantSetNameMismatchError(value: unknown): Error {
  const message = grantSetNameMismatchMessage(value);
  const entry: GrantNameFieldError = {
    field: GRANT_SET_NAME_FIELD,
    code: 'invalid_value',
    message,
    label: NAME_LABEL,
    value,
    constraint: {
      target: PERMISSION_SET_CATALOG_OBJECT,
      targetField: 'name',
      derivedFrom: GRANT_SET_ID_FIELD,
    },
  };
  return validationFailure(message, [entry]);
}

function safeJson(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') return json;
  } catch {
    // fall through to String()
  }
  try {
    return String(value);
  } catch {
    return '(unprintable)';
  }
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** `null`, `undefined` and a blank string carry no name: they are not a supplied value. */
function carriesName(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

/**
 * The id a `permission_set_id` value reads by, or `undefined` for a value that
 * is not one: only a non-blank string or a finite number names a row, and a
 * placeholder-shaped string (`{…}`) is never an id — in `where` it would be
 * resolved as a filter token rather than compared.
 */
function idKey(value: unknown): string | undefined {
  let key: string | undefined;
  if (typeof value === 'string') key = value;
  else if (typeof value === 'number' && Number.isFinite(value)) key = String(value);
  if (key === undefined || key.trim() === '') return undefined;
  if (classifyFilterToken(key) !== null) return undefined;
  return key;
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
 * not insert — may still reach such a grant through its id until ADR-0131 C8
 * counts the unnamed grants and drops that column; no reader reaches it
 * through the id to confer anything.
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

/** The engine surface {@link readGrantSetRows} reads through. */
export interface GrantSetRowEngine {
  find(object: string, options: Record<string, unknown>): Promise<unknown>;
}

/**
 * [ADR-0131 D4] The `sys_permission_set` row each of `grants` reads its set
 * from, BY NAME — for a reader that needs the row's own columns (the ADR-0049
 * `active` flag, a delegated-administration scope), not only the name.
 *
 * The catalog is still materialized per organization, so one name can carry
 * several rows. A grant reads the row of its OWN organization, else the
 * organization-less one — the same two rows its id may point at (a set row
 * applies to a grant of its own organization, an organization-less row to
 * every grant). An organization's rows are read with that organization
 * threaded into the context, so the driver's tenant scope decides what is
 * visible; an organization-less grant reads organization-less rows only.
 *
 * A grant that names nothing ({@link grantSetNameOf}) resolves to no row, and
 * so does a name no applicable row carries. A read that fails throws: the
 * caller decides what a failed read means for its own answer.
 */
export async function readGrantSetRows(
  engine: GrantSetRowEngine,
  grants: readonly unknown[],
): Promise<(grant: unknown) => Record<string, unknown> | undefined> {
  const namesByOrganization = new Map<string, Set<string>>();
  const allNames = new Set<string>();
  for (const grant of grants) {
    const name = grantSetNameOf(grant);
    if (!name) continue;
    allNames.add(name);
    const organizationId = grantOrganizationOf(grant);
    if (organizationId === null) continue;
    let names = namesByOrganization.get(organizationId);
    if (!names) {
      names = new Set<string>();
      namesByOrganization.set(organizationId, names);
    }
    names.add(name);
  }
  const rowsOf = (result: unknown): Array<Record<string, unknown> & { name: string }> =>
    (Array.isArray(result) ? result : []).filter(
      (r): r is Record<string, unknown> & { name: string } =>
        !!r && typeof r === 'object' && typeof (r as Record<string, unknown>).name === 'string',
    );
  const organizationLess = new Map<string, Record<string, unknown>>();
  if (allNames.size > 0) {
    const names = [...allNames];
    const rows = rowsOf(await engine.find(PERMISSION_SET_CATALOG_OBJECT, {
      where: { name: { $in: names }, organization_id: null },
      limit: names.length * 2 + 1,
      context: { isSystem: true },
    }));
    for (const row of rows) {
      if (grantOrganizationOf(row) === null && !organizationLess.has(row.name)) organizationLess.set(row.name, row);
    }
  }
  const own = new Map<string, Map<string, Record<string, unknown>>>();
  for (const [organizationId, nameSet] of namesByOrganization) {
    const names = [...nameSet];
    const rows = rowsOf(await engine.find(PERMISSION_SET_CATALOG_OBJECT, {
      where: { name: { $in: names } },
      limit: names.length * 2 + 1,
      context: { isSystem: true, tenantId: organizationId },
    }));
    const byName = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      if (grantOrganizationOf(row) === organizationId && !byName.has(row.name)) byName.set(row.name, row);
    }
    own.set(organizationId, byName);
  }
  return (grant: unknown) => {
    const name = grantSetNameOf(grant);
    if (!name) return undefined;
    const organizationId = grantOrganizationOf(grant);
    return (organizationId !== null ? own.get(organizationId)?.get(name) : undefined) ?? organizationLess.get(name);
  };
}

/** Per-write memo, keyed by the dispatch scope every hook dispatch of one caller write shares. */
const memoByWrite = new WeakMap<object, Map<string, string | undefined>>();

interface GrantNameEngine {
  registerHook?: (
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ) => void;
  unregisterHooksByPackage?: (packageId: string) => number;
  getSchema?: (name: string) => unknown;
}

/**
 * The name of the `sys_permission_set` row `id` points at, as the WRITER's
 * catalog read sees it, or `undefined` when nothing resolves. Throws when the
 * read itself fails — see the module note.
 */
async function catalogNameFor(engine: GrantNameEngine, ctx: any, id: unknown): Promise<string | undefined> {
  const key = idKey(id);
  if (key === undefined) return undefined;
  // A composition without the catalog object has nothing to derive from — the
  // stand-down the engine's own lookup probe and the position refusal take.
  if (typeof engine.getSchema === 'function' && !engine.getSchema(PERMISSION_SET_CATALOG_OBJECT)) return undefined;

  const scope = ctx?.dispatch?.scope;
  let memo: Map<string, string | undefined> | undefined;
  if (scope && typeof scope === 'object') {
    memo = memoByWrite.get(scope);
    if (!memo) {
      memo = new Map();
      memoByWrite.set(scope, memo);
    }
    if (memo.has(key)) return memo.get(key);
  }

  const api = ctx?.api;
  if (!api || typeof api.sudo !== 'function') {
    throw new Error(
      `[security] ${GRANT_OBJECT}.${GRANT_SET_NAME_FIELD} cannot be derived: this hook dispatch carries no ` +
        `elevatable data api to read ${PERMISSION_SET_CATALOG_OBJECT} with, so the write is refused rather ` +
        `than landed with a name nobody checked.`,
    );
  }
  const rows = await api
    .sudo()
    .object(PERMISSION_SET_CATALOG_OBJECT)
    .find({ where: { id: key }, fields: ['id', 'name'], limit: 1 });
  const row = Array.isArray(rows) ? rows[0] : undefined;
  const name = row && typeof row.name === 'string' && row.name !== '' ? row.name : undefined;
  memo?.set(key, name);
  return name;
}

/** What the caller supplied for the name column, or `undefined` when it supplied nothing. */
type Supplied = { value: unknown } | undefined;

/**
 * Settle `permission_set` on one payload: `decidingId` is the id the name must
 * agree with (the payload's own, or the matched row's stored one), `supplied`
 * the caller's own value for the column.
 */
async function settle(
  engine: GrantNameEngine,
  ctx: any,
  data: Record<string, unknown>,
  decidingId: unknown,
  supplied: Supplied,
): Promise<void> {
  const suppliedName = supplied !== undefined && carriesName(supplied.value);
  const derived = await catalogNameFor(engine, ctx, decidingId);
  if (derived !== undefined) {
    if (suppliedName && supplied!.value !== derived) throw grantSetNameMismatchError(supplied!.value);
    data[GRANT_SET_NAME_FIELD] = derived;
    return;
  }
  // Unresolvable: a non-system caller's name cannot be shown to agree.
  if (suppliedName && ctx?.session?.isSystem !== true) throw grantSetNameMismatchError(supplied!.value);
}

/** `beforeInsert`: one dispatch per row, handed the caller's row as sent. */
async function onInsert(engine: GrantNameEngine, ctx: any): Promise<void> {
  if (ctx?.object !== GRANT_OBJECT) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data)) return;
  const supplied: Supplied = hasOwn(data, GRANT_SET_NAME_FIELD) ? { value: data[GRANT_SET_NAME_FIELD] } : undefined;
  await settle(engine, ctx, data, data[GRANT_SET_ID_FIELD], supplied);
}

/**
 * `beforeUpdate`: one dispatch per matched row, `previous` bound on both
 * dispatch paths.
 *
 * The caller's value for this `readonly` column is read from `ctx.submitted`
 * (the submission as sent), never from the payload alone: on a non-system
 * update the engine HIDES a caller's read-only value from the hooks and hands
 * it back after them for its own static strip, which would drop it silently.
 * Judging the submission is what turns that silent drop into this refusal —
 * and a stamp written here is a hook write, so the hand-back leaves it
 * standing.
 */
async function onUpdate(engine: GrantNameEngine, ctx: any): Promise<void> {
  if (ctx?.object !== GRANT_OBJECT) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data)) return;
  const submitted = isPlainRecord(ctx?.submitted) ? ctx.submitted : undefined;
  const supplied: Supplied =
    submitted && hasOwn(submitted, GRANT_SET_NAME_FIELD)
      ? { value: submitted[GRANT_SET_NAME_FIELD] }
      : hasOwn(data, GRANT_SET_NAME_FIELD)
        ? { value: data[GRANT_SET_NAME_FIELD] }
        : undefined;
  if (hasOwn(data, GRANT_SET_ID_FIELD)) {
    await settle(engine, ctx, data, data[GRANT_SET_ID_FIELD], supplied);
    return;
  }
  if (supplied === undefined) return;
  const previous = ctx?.previous;
  // No stored row is the engine's to answer (not found), never a name verdict.
  if (!isPlainRecord(previous)) return;
  // Judged against the stored id on every matched row, an echo included: the
  // stamp is then the same key on every row a predicate write matches, which
  // is what the engine's per-row key-set rule asks of a batch rewrite.
  await settle(engine, ctx, data, previous[GRANT_SET_ID_FIELD], supplied);
}

/**
 * Bind both hooks on the engine. Returns `false` when the engine exposes no
 * hook registry (a test double), so the caller can say so.
 */
export function registerGrantPermissionSetNameHooks(engine: GrantNameEngine | null | undefined): boolean {
  if (!engine || typeof engine.registerHook !== 'function') return false;
  engine.registerHook('beforeInsert', (ctx: any) => onInsert(engine, ctx), {
    object: GRANT_OBJECT,
    priority: HOOK_PRIORITY,
    packageId: GRANT_SET_NAME_HOOK_PACKAGE,
  });
  engine.registerHook('beforeUpdate', (ctx: any) => onUpdate(engine, ctx), {
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
