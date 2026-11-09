// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D3] An AI service account is never assigned a permission set that
 * breaches the agent ceiling: the write-path refusal for a
 * `sys_user_permission_set` or `sys_user_position` row whose holder is an
 * account and whose set — or a set its position binds — carries View All,
 * Modify All, the destructive class, a system permission or an admin scope.
 *
 * ## Why a refusal, when the clamp already holds
 *
 * The guarantee is the clamp at evaluation (`agent-ceiling-clamp.ts`): every
 * set an agent principal holds is read under the ceiling, so a set edited
 * after it was assigned still grants nothing above it. This is the loud,
 * early answer ADR-0151 D3 asks for besides: the administrator who assigns
 * such a set learns, by the set's name and the bits that breach, that the
 * account will never receive them — instead of an assignment that silently
 * grants less than it says.
 *
 * ## Which rows it judges
 *
 * - `sys_user_permission_set`: the set the row holds AFTER the write (the
 *   payload's `permission_set`, else the stored one), read the way every
 *   by-name grant reader reads it (`grantSetNameOf`);
 * - `sys_user_position`: every set the position the row holds after the
 *   write binds in its catalog definition.
 *
 * For an INSERT (one dispatch per row) and an UPDATE (one dispatch per
 * matched row, with that row's stored image as `previous`). The holder is the
 * row's `user_id` after the write; only a holder whose `sys_user` row reads
 * `principal_kind = agent` is judged. A person's grant is never judged here,
 * so no existing write is narrowed. A DELETE is never judged.
 *
 * It stands down on every `isSystem` write, the stand-down its sibling
 * refusals on these tables take; on a value the catalog holds no definition
 * for (the catalog refusals answer that); in a composition with no `sys_user`
 * object; and on a holder the caller's own read door does not return. That
 * last one is the membership refusal's discipline: the engine's reference
 * check answers an unreadable holder as one that does not exist, and a
 * refusal naming its kind would tell the caller what it cannot read. The
 * clamp at evaluation still holds for such a row.
 *
 * ## Reads, and what a failed one does
 *
 * First the caller's own read of the holder, projected to its id — the read
 * the membership refusal asks, memoised per write, so a row both judge pays
 * it once (`callerReadsGrantHolder`). Then, for a holder the caller reads,
 * one `sys_user` read by id under the system context in the writer's
 * transaction; a read that throws propagates, as the membership refusal's
 * does. The set and position definitions come from the security
 * catalog bound to the engine (`securityCatalogReaderOf`, the reader every
 * grant refusal asks). A catalog read that throws is reported at `warn` and
 * the write proceeds unjudged: the clamp still holds.
 *
 * ## Where it runs
 *
 * As `beforeInsert` / `beforeUpdate` engine hooks, inside the security
 * middleware, at priority 45: after the agent ceiling set refusal (35) and
 * the holder's membership (40), so a row refused for those is refused for
 * them first.
 *
 * ## The envelope
 *
 * `400 VALIDATION_FAILED` (`validationFailure`) with one `fields[]` entry,
 * `code: 'invalid_value'`, at `permission_set` or `position`. No new error
 * code (ADR-0112).
 */

import { isAgentAccountRow, securityCatalogReaderOf, type SecurityCatalogReader } from '@objectstack/core';
import type { FieldErrorCode } from '@objectstack/spec/api';
import { classifyFilterToken, isPlainRecord } from '@objectstack/spec/data';
import { validationFailure } from '@objectstack/types';
import { agentCeilingBreaches } from './agent-ceiling-clamp.js';
import { callerReadsGrantHolder } from './grant-holder-membership-refusal.js';
import { GRANT_OBJECT, GRANT_SET_NAME_FIELD, grantSetNameOf } from './grant-permission-set-name.js';
import { POSITION_ASSIGNMENT_OBJECT, POSITION_FIELD } from './position-catalog-refusal.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';

/** The `packageId` both hooks register under, so they bind (and re-bind) as one. */
export const AGENT_ACCOUNT_GRANT_HOOK_PACKAGE = 'plugin-security:agent-account-grant';

/** See the module note, "Where it runs". */
const HOOK_PRIORITY = 45;

const HOLDER_FIELD = 'user_id';
const USER_OBJECT = 'sys_user';

/** The grant objects judged, each with the column its refusal is at. */
const JUDGED_OBJECTS: readonly string[] = [GRANT_OBJECT, POSITION_ASSIGNMENT_OBJECT];

function labelOf(schema: unknown, field: string, fallback: string): string {
  const def = (schema as any)?.fields?.[field];
  return typeof def?.label === 'string' ? def.label : fallback;
}

const SET_LABEL = labelOf(SysUserPermissionSet, GRANT_SET_NAME_FIELD, 'Permission Set');
const POSITION_LABEL = labelOf(SysUserPosition, POSITION_FIELD, 'Position');

/** One set that breaches the ceiling, with what in it does. */
export interface AgentAccountBreachingSet {
  name: string;
  breaches: string[];
}

/** One `fields[]` entry of the refusal, typed to the closed ADR-0114 catalog. */
interface AgentAccountFieldError {
  field: string;
  code: FieldErrorCode;
  message: string;
  label: string;
  value: string;
  constraint: { principalKind: 'agent' };
}

const describe = (sets: readonly AgentAccountBreachingSet[]): string =>
  sets.map((s) => `'${s.name}' (${s.breaches.join(', ')})`).join('; ');

/** The sentence an administrator reads for a direct set grant. */
export function agentAccountSetGrantMessage(setName: string, userId: string, breaches: readonly string[]): string {
  return (
    `${SET_LABEL}: '${setName}' cannot be assigned to '${userId}', an AI service account. An AI service account ` +
      `never holds View All, Modify All, transfer, restore or purge, a system permission or an admin scope, ` +
      `whatever its permission sets say, and '${setName}' carries ${breaches.join(', ')}. Choose a permission set ` +
      `without them, or remove them from '${setName}' first.`
  );
}

/** The sentence an administrator reads for a position assignment. */
export function agentAccountPositionGrantMessage(
  position: string,
  userId: string,
  sets: readonly AgentAccountBreachingSet[],
): string {
  return (
    `${POSITION_LABEL}: '${position}' cannot be assigned to '${userId}', an AI service account. An AI service ` +
      `account never holds View All, Modify All, transfer, restore or purge, a system permission or an admin ` +
      `scope, whatever its permission sets say, and position '${position}' grants ${describe(sets)}. Choose a ` +
      `position without them, or assign the account the permission sets it needs directly.`
  );
}

/** The refusal of a direct set grant: `invalid_value` at `permission_set`. */
export function agentAccountSetGrantError(setName: string, userId: string, breaches: readonly string[]): Error {
  const message = agentAccountSetGrantMessage(setName, userId, breaches);
  const entry: AgentAccountFieldError = {
    field: GRANT_SET_NAME_FIELD,
    code: 'invalid_value',
    message,
    label: SET_LABEL,
    value: setName,
    constraint: { principalKind: 'agent' },
  };
  return validationFailure(message, [entry]);
}

/** The refusal of a position assignment: `invalid_value` at `position`. */
export function agentAccountPositionGrantError(
  position: string,
  userId: string,
  sets: readonly AgentAccountBreachingSet[],
): Error {
  const message = agentAccountPositionGrantMessage(position, userId, sets);
  const entry: AgentAccountFieldError = {
    field: POSITION_FIELD,
    code: 'invalid_value',
    message,
    label: POSITION_LABEL,
    value: position,
    constraint: { principalKind: 'agent' },
  };
  return validationFailure(message, [entry]);
}

interface AgentAccountGrantEngine {
  registerHook?: (
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ) => void;
  unregisterHooksByPackage?: (packageId: string) => number;
  find?: (object: string, query: any) => Promise<any[]>;
  getSchema?: (object: string) => unknown;
}

type Logger = { warn?: (msg: string, meta?: any) => void } | undefined;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function idOf(value: unknown): string | undefined {
  let key: string | undefined;
  if (typeof value === 'string') key = value;
  else if (typeof value === 'number' && Number.isFinite(value)) key = String(value);
  if (key === undefined || key.trim() === '') return undefined;
  return key;
}

function nameOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Is `userId` an AI service account? One `sys_user` read by id, in the writer's transaction. Throws when it fails. */
async function isAgentAccount(engine: AgentAccountGrantEngine, userId: string, transaction: unknown): Promise<boolean> {
  if (typeof engine.find !== 'function') return false;
  // A composition with no user object holds no account to judge.
  if (typeof engine.getSchema === 'function' && !engine.getSchema(USER_OBJECT)) return false;
  const context: Record<string, unknown> = { isSystem: true };
  if (transaction !== undefined) context.transaction = transaction;
  // A placeholder-shaped id is compared literally, as the membership refusal compares it.
  const literal = classifyFilterToken(userId) === null ? userId : { $startsWith: userId.charAt(0) };
  const rows = await engine.find(USER_OBJECT, { where: { id: literal }, limit: 2, context });
  return Array.isArray(rows) && rows.some((r: any) => String(r?.id) === userId && isAgentAccountRow(r));
}

/** The ceiling breaches of the set `name`, per its catalog definition; `[]` when the catalog holds none. */
async function setBreaches(catalog: SecurityCatalogReader, name: string): Promise<string[]> {
  const entry = await catalog.resolve('permission', name);
  return entry ? agentCeilingBreaches(entry.definition) : [];
}

/** The sets the position `name` binds that breach the ceiling, per the catalog definitions. */
async function positionBreachingSets(catalog: SecurityCatalogReader, name: string): Promise<AgentAccountBreachingSet[]> {
  const entry = await catalog.resolve('position', name);
  const bound = Array.isArray(entry?.definition?.permissionSets) ? entry!.definition.permissionSets : [];
  const out: AgentAccountBreachingSet[] = [];
  for (const setName of new Set(bound.filter((n): n is string => typeof n === 'string' && n !== ''))) {
    const breaches = await setBreaches(catalog, setName);
    if (breaches.length > 0) out.push({ name: setName, breaches });
  }
  return out;
}

/** Judge one row image: the holder and the value it holds after the write. */
async function judge(
  engine: AgentAccountGrantEngine,
  ctx: any,
  image: Record<string, unknown>,
  logger: Logger,
): Promise<void> {
  const userId = idOf(image[HOLDER_FIELD]);
  if (userId === undefined) return;
  const isGrant = ctx.object === GRANT_OBJECT;
  const value = isGrant ? grantSetNameOf(image) : nameOf(image[POSITION_FIELD]);
  if (value === undefined) return;
  const catalog = securityCatalogReaderOf(engine);
  if (!catalog) return;
  // A holder the caller's own door does not read is never read here: the
  // engine's reference check (or the stored row) answers it, and an answer
  // naming the holder's kind would tell the caller what it cannot read.
  if ((await callerReadsGrantHolder(ctx, image[HOLDER_FIELD], userId)) === false) return;
  if (!(await isAgentAccount(engine, userId, ctx?.transaction))) return;
  let breaching: AgentAccountBreachingSet[];
  try {
    breaching = isGrant
      ? [{ name: value, breaches: await setBreaches(catalog, value) }].filter((s) => s.breaches.length > 0)
      : await positionBreachingSets(catalog, value);
  } catch (e) {
    logger?.warn?.(
      `[security] the security catalog could not be read, so a ${ctx.object} write for an AI service account was ` +
        'NOT checked against the agent ceiling — it proceeds; the ceiling is still held when its sets are evaluated',
      { object: ctx.object, error: (e as Error)?.message ?? String(e) },
    );
    return;
  }
  if (breaching.length === 0) return;
  if (isGrant) throw agentAccountSetGrantError(value, userId, breaching[0]!.breaches);
  throw agentAccountPositionGrantError(value, userId, breaching);
}

/** `beforeInsert`: one dispatch per row, handed the caller's row as sent. */
async function onInsert(engine: AgentAccountGrantEngine, ctx: any, logger: Logger): Promise<void> {
  if (!JUDGED_OBJECTS.includes(ctx?.object) || ctx?.session?.isSystem === true) return;
  const row = ctx?.input?.data;
  if (!isPlainRecord(row)) return;
  await judge(engine, ctx, row as Record<string, unknown>, logger);
}

/** `beforeUpdate`: one dispatch per matched row, `previous` bound on both dispatch paths. */
async function onUpdate(engine: AgentAccountGrantEngine, ctx: any, logger: Logger): Promise<void> {
  if (!JUDGED_OBJECTS.includes(ctx?.object) || ctx?.session?.isSystem === true) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data)) return;
  const previous = isPlainRecord(ctx?.previous) ? (ctx.previous as Record<string, unknown>) : {};
  const valueField = ctx.object === GRANT_OBJECT ? GRANT_SET_NAME_FIELD : POSITION_FIELD;
  const image: Record<string, unknown> = {
    [HOLDER_FIELD]: hasOwn(data, HOLDER_FIELD) ? (data as any)[HOLDER_FIELD] : previous[HOLDER_FIELD],
    [valueField]: hasOwn(data, valueField) ? (data as any)[valueField] : previous[valueField],
  };
  await judge(engine, ctx, image, logger);
}

/**
 * Bind both hooks on the engine — idempotently: a re-run of the plugin's
 * `start()` on the same engine replaces the binding instead of doubling it.
 * Returns `false`, after saying so at `warn`, when the engine exposes no hook
 * registry (a test double): the refusal is then not in force, and the clamp
 * at evaluation still is.
 */
export function registerAgentAccountGrantRefusal(
  engine: AgentAccountGrantEngine | null | undefined,
  logger?: Logger,
): boolean {
  if (!engine || typeof engine.registerHook !== 'function') {
    logger?.warn?.(
      `[security] the ObjectQL engine exposes no hook registry — a ${JUDGED_OBJECTS.join(' / ')} write giving an ` +
        'AI service account a set above the agent ceiling is NOT refused (the ceiling is still held at evaluation)',
    );
    return false;
  }
  engine.unregisterHooksByPackage?.(AGENT_ACCOUNT_GRANT_HOOK_PACKAGE);
  const object = [...JUDGED_OBJECTS];
  engine.registerHook('beforeInsert', (ctx: any) => onInsert(engine, ctx, logger), {
    object,
    priority: HOOK_PRIORITY,
    packageId: AGENT_ACCOUNT_GRANT_HOOK_PACKAGE,
  });
  engine.registerHook('beforeUpdate', (ctx: any) => onUpdate(engine, ctx, logger), {
    object,
    priority: HOOK_PRIORITY,
    packageId: AGENT_ACCOUNT_GRANT_HOOK_PACKAGE,
  });
  return true;
}
