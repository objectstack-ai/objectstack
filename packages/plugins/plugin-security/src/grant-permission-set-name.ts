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
 * persona, Setup's grant picker). D10 ordered the id column's removal after
 * every grant names its set: the declaration of `permission_set_id` is
 * retired (C7b), and rows written before the name column existed are named by
 * the v18 ceremony's verified rewrite (`os migrate organization-ownership
 * --apply`), which reads the physical column before its column-drops step
 * drops it — never here.
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
 * ## A name two packages hold, and a grant that names its package (ADR-0150 D3/D5, #32164)
 *
 * A permission set is identified by `(package, name)` (ADR-0150 D4), so after
 * the narrowing two packages may each ship a set of one name. Asked with no
 * package, that name is the D3 refusal: the catalog picks neither. That is an
 * answer about the name — two sets, nothing picked — never "no such set", so it
 * is refused as what it is: `409 RESOURCE_CONFLICT`, core's
 * `PackageScopedNameRefusedError`, whose sentence names every candidate.
 * (The data door carries that sentence and not yet the structured candidates:
 * #32250.)
 *
 * An INSERT may name the package beside the name, in the grant's own
 * `permission_set_package` column (ADR-0150 D8 row R1). The grant then holds
 * exactly that package's set:
 *
 * - the package holds the name ⇒ accepted, whatever any other package holds;
 * - it does not ⇒ refused `409 RESOURCE_CONFLICT`, reason
 *   `not-held-by-qualifier`, naming the holders (the D5 sentence the exact
 *   `/meta` qualifier answers) — at any holder count, so a writer is never
 *   moved to another package's set behind its back (epic red line 1; the
 *   stamp seam refuses the same write, `stored-permission-set-package-stamp.ts`);
 * - nothing holds the name at all ⇒ the `400` below, as for a grant naming no
 *   package.
 *
 * An UPDATE is judged by its name alone: the engine strips a non-system
 * caller's value of the `readonly` column after the before-phase, so the
 * package a non-system update sends is never stored and never judged.
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
 * ## The sentence
 *
 * Read by a business administrator, in Create User's dialog and on Setup's
 * grant form, so it is one line they can act on, said here once for every
 * grant path ({@link grantSetNotInCatalogMessage}). The mistake it meets most
 * is a set's LABEL typed where its name belongs — what Setup shows is the
 * label, the grant stores the name (D4) — so on a refusal, and only then, the
 * catalog is listed for a set whose label is the refused value, and the
 * sentence names that set's name as the remedy. The catalog is NOT widened to
 * accept a label: a label is display text, unconstrained and not unique.
 * Agent ceiling sets are never suggested (no person's grant may name one), and
 * a listing that throws leaves the plain sentence, which is still true.
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
 * ## One grant per user, set and organization
 *
 * Not judged here. Since ADR-0150 D4 a set is `(package, name)`, so the
 * declared unique index is (`user_id`, `permission_set`,
 * `permission_set_package`, `organization_id`), `unique: 'global'`: one user
 * may hold both packages' sets of one name in one organization, and a second
 * grant of one package's set is refused, for every writer and every write path.
 * A grant whose package column is empty is held to one per (`user_id`,
 * `permission_set`, `organization_id`) by the runtime-built partial index
 * `uniq_sys_user_permission_set_packageless` (metadata-protocol's
 * `user-permission-set-packageless-index.ts`), because a unique index treats
 * empty values as distinct. A duplicate confers nothing more, but a revoke that
 * deletes one row would leave the other granting. Every key part is a plain
 * column (ADR-0131 D1), so a grant whose organization is empty (a platform-wide
 * grant) is exempt from both indexes, as it was from the key before them.
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

import {
  PackageScopedNameRefusedError,
  packageScopedRefusalMessage,
  resolveCatalogReference,
  securityCatalogReaderOf,
  type PackageScopedHolder,
  type PackageScopedRefusal,
  type SecurityCatalogEntry,
  type SecurityCatalogReader,
} from '@objectstack/core';
import { MCP_AGENT_PERMISSION_SETS } from '@objectstack/spec/ai';
import type { FieldErrorCode } from '@objectstack/spec/api';
import { isPlainRecord } from '@objectstack/spec/data';
import { validationFailure } from '@objectstack/types';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { PERMISSION_SET_PACKAGE_COLUMN } from './stored-permission-set-package-backfill.js';

/** The grant object this module judges. */
export const GRANT_OBJECT = 'sys_user_permission_set';
/** The grant's NAME reference to the permission set (ADR-0131 D4). */
export const GRANT_SET_NAME_FIELD = 'permission_set';
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

/**
 * The one line an administrator reads when a grant names no permission set
 * (module note, "The sentence"). `labelledAs` is the names of the sets whose
 * label is `value`: one names the remedy outright, several are listed to
 * choose from, none says only that no set has that name.
 */
export function grantSetNotInCatalogMessage(value: string, labelledAs: readonly string[] = []): string {
  if (labelledAs.length === 1) {
    const [name] = labelledAs;
    return `'${value}' is the label of the permission set named '${name}': choose it from the list, or enter '${name}'.`;
  }
  if (labelledAs.length > 1) {
    const names = labelledAs.map((n) => `'${n}'`).join(', ');
    return `'${value}' is the label of more than one permission set (${names}): choose the one you mean from the list.`;
  }
  return `There is no permission set named '${value}': choose one from the list.`;
}

/** The refusal: `VALIDATION_FAILED` (400 at both HTTP doors), `reference_not_found` at `permission_set`. */
export function grantSetNotInCatalogError(value: string, labelledAs: readonly string[] = []): Error {
  const message = grantSetNotInCatalogMessage(value, labelledAs);
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
 * grant that names none — `NULL` or blank, a grant written before the column
 * existed that the v18 ceremony's rewrite has not named (its verification
 * blocks the ceremony on every such grant before the id column is dropped).
 *
 * A grant that names nothing grants nothing through a by-name reader: it is
 * never matched to a set, never shown as held, never counted.
 */
export function grantSetNameOf(row: unknown): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const value = (row as Record<string, unknown>)[GRANT_SET_NAME_FIELD];
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name === '' ? undefined : name;
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

/**
 * [ADR-0150 D3/D5, #32164] The catalog's answer for the set a grant names: by
 * its name alone, or — `packageId` given — exactly that package's set (module
 * note, "A name two packages hold").
 *
 * - `resolved`: the set the grant holds.
 * - `not-found`: no holder of the name anywhere.
 * - `refused`: the D3 refusal of the bare name (two holders), or a named
 *   package that does not hold it (`not-held-by-qualifier`, naming the
 *   holders). Every candidate is structured.
 *
 * The named package is matched against the catalog's own per-holder entries
 * (`list`, one per `(package, name)`) — never through the stored-column scope,
 * whose stale-column arm reads a package that does not hold the name as no
 * package and would pick the other holder.
 */
export async function judgeGrantSet(
  catalog: SecurityCatalogReader,
  name: string,
  packageId?: string,
): Promise<
  | { readonly status: 'resolved'; readonly entry: SecurityCatalogEntry }
  | { readonly status: 'not-found' }
  | { readonly status: 'refused'; readonly refusal: PackageScopedRefusal }
> {
  if (packageId === undefined) {
    const answer = await resolveCatalogReference(catalog, PERMISSION_SET_CATALOG_TYPE, name);
    if (answer.status !== 'refused') return answer;
    return {
      status: 'refused',
      refusal: {
        status: 'refused',
        reason: answer.reason as PackageScopedRefusal['reason'],
        type: PERMISSION_SET_CATALOG_TYPE,
        name,
        callerPackageId: null,
        candidates: answer.holders ?? [],
        message: answer.message,
      },
    };
  }
  const holders = (await catalog.list(PERMISSION_SET_CATALOG_TYPE)).filter((e) => e.name === name);
  const exact = holders.find((e) => e.packageId === packageId);
  if (exact) return { status: 'resolved', entry: exact };
  if (holders.length === 0) return { status: 'not-found' };
  const candidates: PackageScopedHolder[] = holders.map((e) =>
    e.packageId !== undefined ? { kind: 'package', packageId: e.packageId } : { kind: 'environment' });
  const base = {
    status: 'refused' as const,
    reason: 'not-held-by-qualifier' as const,
    type: 'permission' as const,
    name,
    callerPackageId: packageId,
    candidates,
  };
  return { status: 'refused', refusal: { ...base, message: packageScopedRefusalMessage(base) } };
}

/**
 * Refuse a grant whose set the bound catalog does not resolve (module note):
 * `400` when nothing holds the name, `409` when the name is refused or the
 * named package does not hold it.
 */
async function assertNameInCatalog(
  engine: GrantNameEngine,
  name: string,
  logger: GrantNameLogger,
  packageId?: string,
): Promise<void> {
  const catalog = securityCatalogReaderOf(engine);
  if (!catalog) return;
  let answer: Awaited<ReturnType<typeof judgeGrantSet>>;
  try {
    answer = await judgeGrantSet(catalog, name, packageId);
  } catch (e) {
    logger?.warn?.(
      `[security] the security catalog could not be read, so a ${GRANT_OBJECT} write was NOT checked for a ` +
        'permission-set name that resolves to no set — it proceeds unchecked',
      { object: GRANT_OBJECT, error: (e as Error)?.message ?? String(e) },
    );
    return;
  }
  if (answer.status === 'resolved') return;
  if (answer.status === 'refused') throw new PackageScopedNameRefusedError(answer.refusal);
  throw grantSetNotInCatalogError(name, await setsLabelled(catalog, name, logger));
}

/** The package an insert names beside the set (`permission_set_package`), trimmed; blank or absent names none. */
function namedPackage(data: Record<string, unknown>): string | undefined {
  const value = data[PERMISSION_SET_PACKAGE_COLUMN];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

const AGENT_CEILING_SETS: ReadonlySet<string> = new Set(MCP_AGENT_PERMISSION_SETS);

/**
 * The names of the permission sets whose label is `value` (trimmed, any case),
 * agent ceiling sets left out — read only on a refusal, to name the remedy
 * (module note, "The sentence"). A listing that throws is reported at `warn`
 * and answers none: the refusal stands, and its sentence then says what is
 * still true, that no set has that name.
 */
async function setsLabelled(
  catalog: SecurityCatalogReader,
  value: string,
  logger: GrantNameLogger,
): Promise<string[]> {
  const wanted = value.trim().toLowerCase();
  let entries: Awaited<ReturnType<SecurityCatalogReader['list']>>;
  try {
    entries = await catalog.list(PERMISSION_SET_CATALOG_TYPE);
  } catch (e) {
    logger?.warn?.(
      `[security] the security catalog could not be listed, so a refused ${GRANT_OBJECT} write names no ` +
        'permission set whose label matches the refused value',
      { object: GRANT_OBJECT, error: (e as Error)?.message ?? String(e) },
    );
    return [];
  }
  return entries
    .filter((e) => !AGENT_CEILING_SETS.has(e.name))
    .filter((e) => {
      const label = e.definition.label;
      return typeof label === 'string' && label.trim().toLowerCase() === wanted;
    })
    .map((e) => e.name)
    .sort();
}

/** `beforeInsert`: one dispatch per row, handed the caller's row as sent. */
async function onInsert(engine: GrantNameEngine, ctx: any, logger: GrantNameLogger): Promise<void> {
  if (ctx?.object !== GRANT_OBJECT || ctx?.session?.isSystem === true) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data)) return;
  const name = judgedName(data[GRANT_SET_NAME_FIELD]);
  if (name !== undefined) await assertNameInCatalog(engine, name, logger, namedPackage(data));
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
