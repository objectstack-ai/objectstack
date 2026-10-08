// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A user-bound grant row scoped to an organization may name only a user who is
 * a MEMBER of that organization: the write-path refusal for a grant whose
 * holder holds no `sys_member` row in the row's `organization_id`.
 *
 * ## The hole
 *
 * Two grant tables bind a user to a capability inside one organization:
 * `sys_user_position` (a position) and `sys_user_permission_set` (a permission
 * set). The engine checks their `user_id` for EXISTENCE only (the lookup probe,
 * `reference_not_found`), and the organization wall checks only an explicit
 * foreign `organization_id`. So a row naming a user who belongs to a different
 * organization was stored and answered `201`. The grant resolver applies an
 * organization-scoped row only while that organization is the ACTIVE tenant
 * (`grantAppliesInTenant` in `@objectstack/core`), and a walled posture admits
 * an active tenant only through a membership — so the row did nothing at
 * first, and took effect the moment the user was later admitted to the
 * organization, with no further grant: a dormant grant staged across the
 * organization boundary.
 *
 * ## The rule — ruled, executed here as written
 *
 * The maintainer's ruling A on the cloud card that measured the hole (cloud
 * #1765), carried by objectstack #22226: a non-system insert or update of
 * `sys_user_position` whose `user_id` has no `sys_member` row in the row's
 * `organization_id` is refused, for every caller, a platform administrator
 * included; the envelope is the row's existing `400 VALIDATION_FAILED` with
 * `fields[].code: reference_not_found`, no new error code; system writes stand
 * down. "Assign first, invite later" is not a supported order — no producer or
 * reader of it exists. Not taken: narrowing only the picker (it leaves the HTTP
 * door open) and accepting the row.
 *
 * `sys_user_permission_set` is the same class — `user_id` × `organization_id`,
 * the same resolver rule, the same dormant activation — and was measured open
 * on the same door, so the same predicate applies to it. Every platform writer
 * of an organization-scoped permission-set grant (the organization-admin
 * reconcile, self-registration, the platform-admin promotion) writes as the
 * system and stands down; no non-system producer of a grant-before-membership
 * exists in this repository.
 *
 * ## Which rows it judges
 *
 * - an INSERT, one row or a batch: every row whose STORED organization is set.
 *   That is the row's own non-empty `organization_id`, or — when the row names
 *   none — the caller's active organization, which the engine hands the driver
 *   and the driver writes into the empty slot AFTER the hooks run
 *   ({@link organizationTheInsertStores} mirrors that stamp exactly). A row
 *   that will be stored with no organization is a GLOBAL grant: it applies in
 *   every organization context and names no organization to be a member of, so
 *   it is outside the predicate;
 * - an UPDATE, by id or by predicate (the engine dispatches the hook once per
 *   matched row, with that row's stored image as `previous`): the post-image
 *   pair — the payload's `user_id` / `organization_id` where it carries them,
 *   the stored ones where it does not — and only when that pair differs from
 *   the stored one. An edit that leaves both alone (end-dating, a reason, an
 *   echo of the stored values) is not judged, so the row of a holder who has
 *   since left the organization stays editable and revocable.
 *
 * It stands down on:
 *
 * - every `isSystem` write — the stand-down the sibling catalog refusal, the
 *   engine's own lookup probe and this plugin's security middleware take: seed
 *   replay, invitation acceptance (which writes the membership and the placement
 *   together), the organization-admin reconcile and the platform bootstraps;
 * - a `user_id` that is not an id — empty (the engine's `required`), or neither
 *   a string nor a finite number. Nothing the grant resolver reads matches such
 *   a value to a user, so it confers nothing;
 * - a composition that registers no `sys_member` object: there is no membership
 *   to be a member through.
 *
 * ## Where it runs, and why hooks
 *
 * As `beforeInsert` / `beforeUpdate` engine hooks, which run inside the engine
 * operation and so after every engine middleware: the security middleware's
 * authorization (the CRUD check, the delegated-admin gate) and the
 * organization wall have both admitted the write before membership is read. A
 * caller who may not write the table is refused on authority, identically
 * whatever the user's memberships, and an `organization_id` outside the
 * caller's scope is refused by the wall before it is judged here. Hooks rather
 * than a middleware because the engine hands an update's hook the stored image
 * of every row it matches — by id and by predicate alike — and the post-image
 * pair is built from that image.
 *
 * ## The membership read
 *
 * One bounded read per distinct pair, `sys_member` WHERE `user_id` and
 * `organization_id`, under `{ isSystem: true, tenantId: <the row's
 * organization> }`: elevated, because whether a user belongs to an organization
 * is a fact about the database and not about the writer's row-level reach; and
 * scoped to the row's own organization, never another one. It joins the
 * writer's transaction, so a membership written earlier in the same
 * transaction counts. An identifier the query layer would resolve as a filter
 * placeholder (`{…}`) is compared literally instead.
 *
 * A read that THROWS is not "not a member": it propagates and the write is
 * refused — a security refusal that cannot read its input does not admit the
 * write it exists to judge.
 *
 * ## The envelope
 *
 * `400 VALIDATION_FAILED` with one `fields[]` entry — the first row the write
 * would store with a non-member — at `field: 'user_id'`,
 * `code: 'reference_not_found'` — the envelope the engine
 * already answers for a `user_id` naming no user, so an author meets one
 * dialect for "this user cannot hold a grant here". No new error code: the
 * top-level code is the registered ADR-0112 `VALIDATION_FAILED` (built by
 * `validationFailure`, the constructor both HTTP doors map to 400) and the
 * field code is a member of the closed ADR-0114 catalog. A user that exists
 * nowhere and a user that belongs only to another organization receive the
 * same answer.
 */

import type { FieldErrorCode } from '@objectstack/spec/api';
import { classifyFilterToken, isPlainRecord, isTenancyDisabled } from '@objectstack/spec/data';
import { validationFailure } from '@objectstack/types';
import { isFederatedObject } from './federated-phantom-anchors.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';

/** The membership object a holder must hold a row of. */
export const MEMBERSHIP_OBJECT = 'sys_member';
/** The holder column, on every judged grant object. */
export const HOLDER_FIELD = 'user_id';
/** The organization column, on every judged grant object and on {@link MEMBERSHIP_OBJECT}. */
export const ORGANIZATION_FIELD = 'organization_id';

/** The grant objects judged, each with the noun its refusal names. */
const GRANT_OBJECTS: Readonly<Record<string, { noun: string; schema: unknown }>> = {
  sys_user_position: { noun: 'position assignment', schema: SysUserPosition },
  sys_user_permission_set: { noun: 'permission set grant', schema: SysUserPermissionSet },
};

/** The grant objects this refusal is registered on. */
export const MEMBERSHIP_JUDGED_GRANT_OBJECTS: readonly string[] = Object.keys(GRANT_OBJECTS);

/** The `packageId` both hooks register under, so they bind (and re-bind) as one. */
export const GRANT_HOLDER_MEMBERSHIP_HOOK_PACKAGE = 'plugin-security:grant-holder-membership';

/**
 * After the guards that refuse a write on authority or standing (10, 20) and
 * after the grant-name derivation (30), before the default-priority hooks
 * (100). So on both tables the value a row names is judged before its holder:
 * `sys_user_position.position` by the catalog refusal (a middleware, ahead of
 * every hook), `sys_user_permission_set.permission_set` by the derivation.
 */
const HOOK_PRIORITY = 40;

/** One `fields[]` entry of the refusal, typed to the closed ADR-0114 catalog. */
interface HolderFieldError {
  field: string;
  code: FieldErrorCode;
  message: string;
  label: string;
  value: string;
  constraint: { target: string; targetField: string; organization: string };
}

function holderLabel(object: string): string {
  const def = (GRANT_OBJECTS[object]?.schema as any)?.fields?.[HOLDER_FIELD];
  return typeof def?.label === 'string' ? def.label : 'User';
}

/** The sentence an author reads: the value, the column's contract, the fix. */
export function holderNotMemberMessage(object: string, userId: string, organizationId: string): string {
  const noun = GRANT_OBJECTS[object]?.noun ?? 'grant';
  return (
    `${holderLabel(object)}: '${userId}' is not a member of the organization '${organizationId}' this ` +
    `${noun} applies in. ${object}.${HOLDER_FIELD} must name a user who holds a ${MEMBERSHIP_OBJECT} row in ` +
    `the row's ${ORGANIZATION_FIELD}: add the user to that organization first, then grant it.`
  );
}

/** The refusal: `VALIDATION_FAILED` (400 at both HTTP doors), `reference_not_found` at `user_id`. */
export function holderNotMemberError(
  object: string,
  pairs: readonly { userId: string; organizationId: string }[],
): Error {
  const label = holderLabel(object);
  const fields = pairs.map(({ userId, organizationId }): HolderFieldError => ({
    field: HOLDER_FIELD,
    code: 'reference_not_found',
    message: holderNotMemberMessage(object, userId, organizationId),
    label,
    value: userId,
    constraint: { target: MEMBERSHIP_OBJECT, targetField: HOLDER_FIELD, organization: organizationId },
  }));
  return validationFailure(fields.map((f) => f.message).join('; '), fields);
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The id a value reads by, or `undefined` for a value that names no row: only
 * a non-blank string or a finite number does.
 */
function idOf(value: unknown): string | undefined {
  let key: string | undefined;
  if (typeof value === 'string') key = value;
  else if (typeof value === 'number' && Number.isFinite(value)) key = String(value);
  if (key === undefined || key.trim() === '') return undefined;
  return key;
}

/**
 * The organization an INSERT row is stored with, or `undefined` for a row
 * stored with none. The row's own non-empty value wins. Otherwise the driver
 * fills the empty slot from the driver options' `tenantId`, which the engine
 * builds after the hooks: an explicit `tenantId` in the call's options when it
 * carries one, else the caller's active organization — withheld for an object
 * that declares `tenancy.enabled: false` or is federated
 * (`buildDriverOptions` and the driver's `injectTenantOnInsert` in
 * `@objectstack/objectql` / `@objectstack/driver-sql`, read and mirrored).
 */
export function organizationTheInsertStores(
  schema: unknown,
  row: Record<string, unknown>,
  options: unknown,
  sessionOrganization: unknown,
): string | undefined {
  const own = row[ORGANIZATION_FIELD];
  if (own !== undefined && own !== null && own !== '') return String(own);
  const explicit = isPlainRecord(options) ? (options as Record<string, unknown>).tenantId : undefined;
  const tenant =
    explicit !== undefined
      ? explicit
      : sessionOrganization !== undefined && !isTenancyDisabled(schema) && !isFederatedObject(schema)
        ? sessionOrganization
        : undefined;
  if (tenant === undefined || tenant === null || tenant === '') return undefined;
  return String(tenant);
}

interface MembershipEngine {
  registerHook?: (
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ) => void;
  unregisterHooksByPackage?: (packageId: string) => number;
  getSchema?: (name: string) => unknown;
  find?: (object: string, query: any) => Promise<any[]>;
}

/**
 * Does `userId` hold a `sys_member` row in `organizationId`? Read under the
 * system context scoped to that organization, in the writer's transaction.
 * A placeholder-shaped identifier is compared literally (see the module note).
 * Throws when the read fails.
 */
async function holdsMembership(
  engine: MembershipEngine,
  userId: string,
  organizationId: string,
  transaction: unknown,
): Promise<boolean> {
  const context: Record<string, unknown> = { isSystem: true, tenantId: organizationId };
  if (transaction !== undefined) context.transaction = transaction;
  const literal = (value: string) =>
    classifyFilterToken(value) === null ? value : { $startsWith: value.charAt(0) };
  const rows = await engine.find!(MEMBERSHIP_OBJECT, {
    where: { [HOLDER_FIELD]: literal(userId), [ORGANIZATION_FIELD]: literal(organizationId) },
    fields: [HOLDER_FIELD, ORGANIZATION_FIELD],
    context,
  });
  return (
    Array.isArray(rows) &&
    rows.some((r: any) => String(r?.[HOLDER_FIELD]) === userId && String(r?.[ORGANIZATION_FIELD]) === organizationId)
  );
}

/** Per-write memo of membership verdicts, keyed by the dispatch scope every hook of one write shares. */
const memoByWrite = new WeakMap<object, Map<string, boolean>>();

/**
 * Refuse when `userId` is not a member of `organizationId`. A composition with
 * no membership object stands down (see the module note).
 */
async function assertHolderIsMember(
  engine: MembershipEngine,
  ctx: any,
  userId: string,
  organizationId: string,
): Promise<void> {
  if (typeof engine.getSchema === 'function' && !engine.getSchema(MEMBERSHIP_OBJECT)) return;
  if (typeof engine.find !== 'function') return;

  const key = `${userId}\u0000${organizationId}`;
  const scope = ctx?.dispatch?.scope;
  let memo: Map<string, boolean> | undefined;
  if (scope && typeof scope === 'object') {
    memo = memoByWrite.get(scope);
    if (!memo) {
      memo = new Map();
      memoByWrite.set(scope, memo);
    }
  }
  let member = memo?.get(key);
  if (member === undefined) {
    member = await holdsMembership(engine, userId, organizationId, ctx?.transaction);
    memo?.set(key, member);
  }
  if (!member) throw holderNotMemberError(ctx.object, [{ userId, organizationId }]);
}

/** `beforeInsert`: one dispatch per row, handed the row as the engine will store it, before the driver's stamp. */
async function onInsert(engine: MembershipEngine, ctx: any): Promise<void> {
  if (!hasOwn(GRANT_OBJECTS, ctx?.object)) return;
  if (ctx?.session?.isSystem === true) return;
  const row = ctx?.input?.data;
  if (!isPlainRecord(row)) return;
  const userId = idOf(row[HOLDER_FIELD]);
  if (userId === undefined) return;
  const schema = typeof engine.getSchema === 'function' ? engine.getSchema(ctx.object) : undefined;
  const organizationId = organizationTheInsertStores(
    schema ?? GRANT_OBJECTS[ctx.object]!.schema,
    row as Record<string, unknown>,
    ctx?.input?.options,
    ctx?.session?.organizationId,
  );
  if (organizationId === undefined) return;
  await assertHolderIsMember(engine, ctx, userId, organizationId);
}

/** The string form two stored values are compared by (an echo of `123` over `'123'` is unchanged). */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
  return norm(a) === norm(b);
}

/** `beforeUpdate`: one dispatch per matched row, `previous` bound on both dispatch paths. */
async function onUpdate(engine: MembershipEngine, ctx: any): Promise<void> {
  if (!hasOwn(GRANT_OBJECTS, ctx?.object)) return;
  if (ctx?.session?.isSystem === true) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data)) return;
  const movesHolder = hasOwn(data, HOLDER_FIELD);
  const movesOrganization = hasOwn(data, ORGANIZATION_FIELD);
  if (!movesHolder && !movesOrganization) return;
  const previous = ctx?.previous;
  // No stored row is the engine's to answer (not found), never a membership verdict.
  if (!isPlainRecord(previous)) return;
  const nextHolder = movesHolder ? data[HOLDER_FIELD] : previous[HOLDER_FIELD];
  const nextOrganization = movesOrganization ? data[ORGANIZATION_FIELD] : previous[ORGANIZATION_FIELD];
  if (sameValue(nextHolder, previous[HOLDER_FIELD]) && sameValue(nextOrganization, previous[ORGANIZATION_FIELD])) {
    return;
  }
  const userId = idOf(nextHolder);
  if (userId === undefined) return;
  if (nextOrganization === undefined || nextOrganization === null || nextOrganization === '') return;
  await assertHolderIsMember(engine, ctx, userId, String(nextOrganization));
}

/**
 * Bind both hooks on the engine — idempotently: a re-run of the plugin's
 * `start()` on the same engine replaces the binding instead of doubling it.
 * Returns `false`, after saying so at `warn`, when the engine exposes no hook
 * registry (a test double): the refusal is then not in force.
 */
export function registerGrantHolderMembershipRefusal(
  engine: MembershipEngine | null | undefined,
  logger?: { warn?: (msg: string, meta?: any) => void },
): boolean {
  if (!engine || typeof engine.registerHook !== 'function') {
    logger?.warn?.(
      `[security] the ObjectQL engine exposes no hook registry — a ${MEMBERSHIP_JUDGED_GRANT_OBJECTS.join(' / ')} ` +
        `write naming a user with no ${MEMBERSHIP_OBJECT} row in the row's organization is NOT refused`,
    );
    return false;
  }
  engine.unregisterHooksByPackage?.(GRANT_HOLDER_MEMBERSHIP_HOOK_PACKAGE);
  const object = [...MEMBERSHIP_JUDGED_GRANT_OBJECTS];
  engine.registerHook('beforeInsert', (ctx: any) => onInsert(engine, ctx), {
    object,
    priority: HOOK_PRIORITY,
    packageId: GRANT_HOLDER_MEMBERSHIP_HOOK_PACKAGE,
  });
  engine.registerHook('beforeUpdate', (ctx: any) => onUpdate(engine, ctx), {
    object,
    priority: HOOK_PRIORITY,
    packageId: GRANT_HOLDER_MEMBERSHIP_HOOK_PACKAGE,
  });
  return true;
}
