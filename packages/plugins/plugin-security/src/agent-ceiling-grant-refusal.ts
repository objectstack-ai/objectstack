// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A person-to-permission-set assignment never names an agent ceiling set: the
 * write-path refusal for a `sys_user_permission_set` row whose
 * `permission_set` is one of the MCP agent ceiling sets.
 *
 * ## The rule
 *
 * [ADR-0090 D10] `mcp_agent_data_read`, `mcp_agent_data_write` and
 * `mcp_agent_restricted` (`MCP_AGENT_PERMISSION_SETS`, `@objectstack/spec/ai`,
 * imported here and never retyped) are an AGENT principal's own grants, and an
 * agent principal receives them one way only: the door that admits it derives
 * the ceiling from the scopes its user consented to
 * (`scopesToAgentPermissionSets`) and the shared assembler puts it on the
 * agent's context as `permissions`, with `principalKind: 'agent'`
 * (`assemble-execution-context.ts` in `@objectstack/core`). No assignment row
 * is read for it. And no `sys_user` row is an agent principal: a user row
 * signs in as a person. So every row of this table is a person's grant, and an
 * agent ceiling is not a person's set — the sentence ADR-0090 D12 (as amended
 * 2026-10-17) states for the organization boundary's denylist, held here for
 * every writer.
 *
 * A non-system insert or update that would STORE an assignment naming one of
 * those sets is refused, for every caller, a platform administrator included.
 *
 * ## Which rows it judges
 *
 * - an INSERT, one row or a batch (the engine dispatches `beforeInsert` once
 *   per row): the row's set, read the way every by-name grant reader reads it
 *   ({@link grantSetNameOf}), so a value a reader would match to the set is
 *   judged as that set;
 * - an UPDATE, by id or by predicate (the engine dispatches `beforeUpdate` once
 *   per matched row, with that row's stored image as `previous`): the set the
 *   row holds AFTER the write — the payload's `permission_set` when it carries
 *   one, the stored one when it does not. So an update that keeps a stored
 *   agent ceiling assignment in force (a new holder, organization, validity
 *   window or reason on it) is refused as well as one that renames a grant to
 *   a ceiling. Such an assignment is not edited; it is removed.
 *
 * A DELETE is never judged here: removing such an assignment is always open
 * to a caller the delegated-administration gate lets remove it.
 *
 * It stands down on:
 *
 * - every `isSystem` write — seed replay and the platform's own grant writers
 *   (the platform-admin promotion, the organization-admin reconcile,
 *   self-registration), none of which names an agent ceiling set: the
 *   stand-down the sibling refusals on this table and the security middleware
 *   take;
 * - a value no by-name reader matches to any set (not a string, or blank):
 *   the engine's `required` and the catalog refusal answer those.
 *
 * ## Where it runs, and why hooks
 *
 * As `beforeInsert` / `beforeUpdate` engine hooks, the shape
 * `grant-holder-membership-refusal.ts` takes for the same reason: every door
 * that writes this table — the data API's create, update, batch and many-row
 * routes, import, an MCP data tool — writes through the engine's `insert` /
 * `update`, and the engine hands an update's hook the stored image of every
 * row it matches, by id and by predicate alike. The hooks run inside the
 * operation, after the security middleware, so a caller who may not write the
 * table at all is refused on authority first (the delegated-administration
 * gate refuses an organization administrator the same sets on its own
 * boundary). Priority 35: after the catalog refusal judges that the name is a
 * set at all (30, `grant-permission-set-name.ts`), before the holder's
 * membership is read (40).
 *
 * ## The envelope
 *
 * `400 VALIDATION_FAILED` (built by `validationFailure`, the constructor both
 * HTTP doors map) with one `fields[]` entry at `field: 'permission_set'`,
 * `code: 'invalid_value'` — the ADR-0114 member for a value refused for a
 * reason no other member names (the set exists, so it is not
 * `reference_not_found`). No new error code (ADR-0112). A validation answer,
 * not `PERMISSION_DENIED`, because no caller may store it — platform
 * administrators included — and a different set is the only way through: the
 * reasoning `objects/reserved-identity-names.ts` gives for its own refusal.
 */

import { MCP_AGENT_PERMISSION_SETS } from '@objectstack/spec/ai';
import type { FieldErrorCode } from '@objectstack/spec/api';
import { isPlainRecord } from '@objectstack/spec/data';
import { validationFailure } from '@objectstack/types';
import { GRANT_OBJECT, GRANT_SET_NAME_FIELD, grantSetNameOf } from './grant-permission-set-name.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';

/** The `packageId` both hooks register under, so they bind (and re-bind) as one. */
export const AGENT_CEILING_GRANT_HOOK_PACKAGE = 'plugin-security:agent-ceiling-grant';

/** See the module note's last paragraph of "Where it runs". */
const HOOK_PRIORITY = 35;

const AGENT_CEILING_SETS: ReadonlySet<string> = new Set<string>(MCP_AGENT_PERMISSION_SETS);

const nameDef = (SysUserPermissionSet as any).fields?.[GRANT_SET_NAME_FIELD] ?? {};
/** The column's declared label — what the refusal names it by. */
const NAME_LABEL: string = typeof nameDef.label === 'string' ? nameDef.label : 'Permission Set';

/** Is `name` one of the [ADR-0090 D10] agent ceiling sets? Exact match: set names are machine names. */
export function isAgentCeilingPermissionSet(name: unknown): boolean {
  return typeof name === 'string' && AGENT_CEILING_SETS.has(name);
}

/** One `fields[]` entry of the refusal, typed to the closed ADR-0114 catalog. */
interface AgentCeilingFieldError {
  field: string;
  code: FieldErrorCode;
  message: string;
  label: string;
  value: string;
  constraint: { principalKind: 'agent' };
}

/** The sentence an administrator reads: the value, why no assignment may hold it, the way through. */
export function agentCeilingGrantMessage(name: string): string {
  return (
    `${NAME_LABEL}: '${name}' is the permission ceiling of an AI assistant connected over MCP, not a ` +
    `permission set for a person. The assistant receives it from the access its user consented to, never from ` +
    `an assignment, so ${GRANT_OBJECT} cannot give it to a user: choose a different permission set. To take it ` +
    `away from a user who already holds it, delete the assignment.`
  );
}

/** The refusal: `VALIDATION_FAILED` (400 at both HTTP doors), `invalid_value` at `permission_set`. */
export function agentCeilingGrantError(name: string): Error {
  const message = agentCeilingGrantMessage(name);
  const entry: AgentCeilingFieldError = {
    field: GRANT_SET_NAME_FIELD,
    code: 'invalid_value',
    message,
    label: NAME_LABEL,
    value: name,
    constraint: { principalKind: 'agent' },
  };
  return validationFailure(message, [entry]);
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Refuse when the set the write would store is an agent ceiling. */
function assertNotAgentCeiling(name: string | undefined): void {
  if (name !== undefined && isAgentCeilingPermissionSet(name)) throw agentCeilingGrantError(name);
}

/** `beforeInsert`: one dispatch per row, handed the caller's row as sent. */
function onInsert(ctx: any): void {
  if (ctx?.object !== GRANT_OBJECT || ctx?.session?.isSystem === true) return;
  const row = ctx?.input?.data;
  if (!isPlainRecord(row)) return;
  assertNotAgentCeiling(grantSetNameOf(row));
}

/** `beforeUpdate`: one dispatch per matched row, `previous` bound on both dispatch paths. */
function onUpdate(ctx: any): void {
  if (ctx?.object !== GRANT_OBJECT || ctx?.session?.isSystem === true) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data)) return;
  assertNotAgentCeiling(hasOwn(data, GRANT_SET_NAME_FIELD) ? grantSetNameOf(data) : grantSetNameOf(ctx?.previous));
}

interface AgentCeilingEngine {
  registerHook?: (
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ) => void;
  unregisterHooksByPackage?: (packageId: string) => number;
}

/**
 * Bind both hooks on the engine — idempotently: a re-run of the plugin's
 * `start()` on the same engine replaces the binding instead of doubling it.
 * Returns `false`, after saying so at `warn`, when the engine exposes no hook
 * registry (a test double): the refusal is then not in force.
 */
export function registerAgentCeilingGrantRefusal(
  engine: AgentCeilingEngine | null | undefined,
  logger?: { warn?: (msg: string, meta?: any) => void },
): boolean {
  if (!engine || typeof engine.registerHook !== 'function') {
    logger?.warn?.(
      `[security] the ObjectQL engine exposes no hook registry — a ${GRANT_OBJECT} write naming an agent ceiling ` +
        `permission set (${[...AGENT_CEILING_SETS].join(', ')}) is NOT refused`,
    );
    return false;
  }
  engine.unregisterHooksByPackage?.(AGENT_CEILING_GRANT_HOOK_PACKAGE);
  engine.registerHook('beforeInsert', onInsert, {
    object: GRANT_OBJECT,
    priority: HOOK_PRIORITY,
    packageId: AGENT_CEILING_GRANT_HOOK_PACKAGE,
  });
  engine.registerHook('beforeUpdate', onUpdate, {
    object: GRANT_OBJECT,
    priority: HOOK_PRIORITY,
    packageId: AGENT_CEILING_GRANT_HOOK_PACKAGE,
  });
  return true;
}
