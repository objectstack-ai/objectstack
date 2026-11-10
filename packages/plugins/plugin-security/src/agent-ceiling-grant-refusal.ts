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
 * is read for it. A `sys_user` row can be an agent principal too — an AI
 * service account (ADR-0151, `principal_kind = agent`) — but its grants are
 * ordinary assignments under the agent ceiling, never the OAuth agent's
 * scope-derived sets (ADR-0151 D3: "the agent ceiling sets stay out of the
 * assignment tables"). So no row of this table, a person's or an account's,
 * holds an agent ceiling set — the sentence ADR-0090 D12 (as amended
 * 2026-10-17) states for the organization boundary's denylist, held here for
 * every writer. What an account may be assigned is judged on its own by
 * `agent-account-grant-refusal.ts`.
 *
 * A non-system or seed insert or update that would STORE an assignment naming
 * one of those sets is refused, for every caller, a platform administrator
 * included. These doors refuse with the same refusal this module builds
 * ({@link agentCeilingGrantError}), worded for where the set was named
 * ({@link AgentCeilingCarrier}), and hold exactly what is listed here:
 *
 * - a position definition whose `permissionSets` names one, at the metadata
 *   door — a save (draft or active) and a restore
 *   ({@link registerPositionAgentCeilingGate});
 * - every write of `sys_user_position` naming a position whose definition, as
 *   the security catalog serves it, names one;
 * - a seed write of a `sys_user_permission_set` row naming one;
 * - the deployment's baseline (`SecurityPlugin`'s `fallbackPermissionSet` and
 *   `acceptedDefaultPermissionSets` options), at construction;
 * - and, outside this module, the self-registration set, by the audience
 *   validation in `@objectstack/plugin-auth`.
 *
 * These doors do not judge a position a person holds without an assignment
 * row, or a position definition that reaches the security catalog without
 * passing the metadata door; whether the read side refuses those is a
 * separate decision with the maintainer (the security seat, #32004).
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
 * The `sys_user_position` hooks judge the position the row holds after the
 * write the same way, by its definition in the security catalog. They judge
 * a system write too when it names the position (see `onPositionInsert`).
 *
 * A DELETE is never judged here: removing such an assignment is always open
 * to a caller the delegated-administration gate lets remove it.
 *
 * It stands down on:
 *
 * - every `isSystem` write but a seed: the stand-down the sibling refusals on
 *   this table and the security middleware take. Which system writer can store an
 *   agent ceiling set, writer by writer:
 *   - the platform-admin promotion and the organization-admin reconcile name
 *     their sets in code, and neither is a ceiling;
 *   - the self-registration grant writes the configured
 *     `audience.selfRegistrationPermissionSet`, and the audience validation
 *     that admits that configuration (`assertAudienceConfig`,
 *     `@objectstack/plugin-auth`) refuses an agent ceiling set there;
 *   - an identity-provider group mapping's projection writes the mapped set,
 *     and the organization boundary's by-name denylist keeps every agent
 *     ceiling out of it, asked at the mapping's save and again before each
 *     projected grant (both pinned in `@objectstack/plugin-auth`);
 *   - the development-only demo accounts are given only sets their stack
 *     declares in `permissions` (the stack's own validation), and no stack
 *     declares an agent ceiling's name: this plugin holds those names, and a
 *     second holder is refused at registration;
 *   - seed replay — a stack's `data`, a published `seed` item — writes the
 *     sets it declares. A SEED write (`seedReplay`) is therefore judged like
 *     any other: a seed is a declared fact, and every other validation runs
 *     on it already;
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

import { securityCatalogReaderOf } from '@objectstack/core';
import { MCP_AGENT_PERMISSION_SETS } from '@objectstack/spec/ai';
import type { FieldErrorCode } from '@objectstack/spec/api';
import { isPlainRecord } from '@objectstack/spec/data';
import { validationFailure } from '@objectstack/types';
import { GRANT_OBJECT, GRANT_SET_NAME_FIELD, grantSetNameOf } from './grant-permission-set-name.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { POSITION_ASSIGNMENT_OBJECT, POSITION_FIELD as POSITION_ASSIGNMENT_FIELD } from './position-catalog-refusal.js';

/** The `packageId` both hooks register under, so they bind (and re-bind) as one. */
export const AGENT_CEILING_GRANT_HOOK_PACKAGE = 'plugin-security:agent-ceiling-grant';

/** See the module note's last paragraph of "Where it runs". */
const HOOK_PRIORITY = 35;

const AGENT_CEILING_SETS: ReadonlySet<string> = new Set<string>(MCP_AGENT_PERMISSION_SETS);

const nameDef = (SysUserPermissionSet as any).fields?.[GRANT_SET_NAME_FIELD] ?? {};
/** The column's declared label — what the refusal names it by. */
const NAME_LABEL: string = typeof nameDef.label === 'string' ? nameDef.label : 'Permission Set';

const positionDef = (SysUserPosition as any).fields?.[POSITION_ASSIGNMENT_FIELD] ?? {};
/** The assignment's `position` column label — what the refusal names it by. */
const POSITION_LABEL: string = typeof positionDef.label === 'string' ? positionDef.label : 'Position';

/** The position definition key that binds its permission sets (`PositionSchema.permissionSets`, ADR-0131 D3/D4). */
const POSITION_SETS_KEY = 'permissionSets';

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
  constraint: { principalKind: 'agent'; permissionSet: string };
}

/**
 * Where a refused agent ceiling set was named, which the one refusal below is
 * worded and addressed by: the column or key that names it (`field`, `label`),
 * the thing that would have given it to a person (`carrier`), and, for an
 * assignment of a position, the position that names it (`via`, which is then
 * the refused value). Every door that refuses the rule builds its answer from
 * {@link agentCeilingGrantError} with one of the carriers below — one predicate,
 * one sentence.
 */
export interface AgentCeilingCarrier {
  readonly field: string;
  readonly label: string;
  readonly carrier: string;
  /** What to choose instead: a different `permission set`, or a different `position`. */
  readonly choice: 'permission set' | 'position';
  readonly via?: string;
  readonly wayThrough?: string;
}

/** A `sys_user_permission_set` row: a user's own assignment of the set. */
export const AGENT_CEILING_ASSIGNMENT: AgentCeilingCarrier = Object.freeze({
  field: GRANT_SET_NAME_FIELD,
  label: NAME_LABEL,
  carrier: GRANT_OBJECT,
  choice: 'permission set',
  wayThrough: 'To take it away from a user who already holds it, delete the assignment.',
});

/** A position definition's `permissionSets`: every holder of the position holds each set it names. */
export const AGENT_CEILING_POSITION_DEFINITION: AgentCeilingCarrier = Object.freeze({
  field: POSITION_SETS_KEY,
  label: 'Permission Sets',
  carrier: 'a position',
  choice: 'permission set',
  wayThrough: 'To take it away from the people who hold the position, remove it from the position\'s permission sets.',
});

/** A `sys_user_position` row naming a position whose definition names the set. */
export function agentCeilingPositionAssignment(position: string): AgentCeilingCarrier {
  return {
    field: POSITION_ASSIGNMENT_FIELD,
    label: POSITION_LABEL,
    carrier: POSITION_ASSIGNMENT_OBJECT,
    choice: 'position',
    via: position,
    wayThrough: 'Remove it from the position\'s permission sets, or assign a different position.',
  };
}

/** The sentence an administrator reads: the value, why no assignment may hold it, the way through. */
export function agentCeilingGrantMessage(name: string, at: AgentCeilingCarrier = AGENT_CEILING_ASSIGNMENT): string {
  const head = at.via === undefined ? `${at.label}: '${name}' is` : `${at.label}: '${at.via}' names '${name}', which is`;
  return (
    `${head} the permission ceiling of an AI assistant connected over MCP, not a ` +
    `permission set for a person. The assistant receives it from the access its user consented to, never from ` +
    `an assignment, so ${at.carrier} cannot give it to a user: choose a different ${at.choice}.` +
    (at.wayThrough ? ` ${at.wayThrough}` : '')
  );
}

/** The refusal: `VALIDATION_FAILED` (400 at both HTTP doors), `invalid_value` at the carrier's field. */
export function agentCeilingGrantError(name: string, at: AgentCeilingCarrier = AGENT_CEILING_ASSIGNMENT): Error {
  const message = agentCeilingGrantMessage(name, at);
  const entry: AgentCeilingFieldError = {
    field: at.field,
    code: 'invalid_value',
    message,
    label: at.label,
    value: at.via ?? name,
    constraint: { principalKind: 'agent', permissionSet: name },
  };
  return validationFailure(message, [entry]);
}

/** The first agent ceiling set a position definition names in `permissionSets`, or `undefined`. */
export function agentCeilingSetOfPosition(definition: unknown): string | undefined {
  const sets = isPlainRecord(definition) ? definition[POSITION_SETS_KEY] : undefined;
  if (!Array.isArray(sets)) return undefined;
  return sets.find((name): name is string => isAgentCeilingPermissionSet(name));
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Refuse when the set the write would store is an agent ceiling. */
function assertNotAgentCeiling(name: string | undefined): void {
  if (name !== undefined && isAgentCeilingPermissionSet(name)) throw agentCeilingGrantError(name);
}

/**
 * Does this write meet the rule? Every non-system write, and a SEED write
 * (`seedReplay`, `SEED_WRITE_EXECUTION_CONTEXT`): a seed is the stack's or a
 * package's declared fact, and every other validation already runs on it. Read
 * from the hook's `input.options.context`, the caller's own options bag: the
 * engine copies `isSystem` onto the hook session, never `seedReplay`.
 */
function judges(ctx: any): boolean {
  return ctx?.session?.isSystem !== true || ctx?.input?.options?.context?.seedReplay === true;
}

/** `beforeInsert`: one dispatch per row, handed the caller's row as sent. */
function onInsert(ctx: any): void {
  if (ctx?.object !== GRANT_OBJECT || !judges(ctx)) return;
  const row = ctx?.input?.data;
  if (!isPlainRecord(row)) return;
  assertNotAgentCeiling(grantSetNameOf(row));
}

/** `beforeUpdate`: one dispatch per matched row, `previous` bound on both dispatch paths. */
function onUpdate(ctx: any): void {
  if (ctx?.object !== GRANT_OBJECT || !judges(ctx)) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data)) return;
  assertNotAgentCeiling(hasOwn(data, GRANT_SET_NAME_FIELD) ? grantSetNameOf(data) : grantSetNameOf(ctx?.previous));
}

/**
 * Refuse an assignment of `position` when its definition — read from the
 * security catalog bound to `engine`, the one source the authorization resolver
 * grants a held position through — names an agent ceiling set. A position the
 * catalog does not hold names nothing (the catalog refusal answers it), and an
 * engine with no catalog bound judges nothing.
 */
async function assertPositionGivesNoAgentCeiling(engine: unknown, position: unknown): Promise<void> {
  if (typeof position !== 'string' || position === '') return;
  const catalog = securityCatalogReaderOf(engine);
  if (!catalog) return;
  const entry = await catalog.resolve('position', position);
  const set = agentCeilingSetOfPosition(entry?.definition);
  if (set !== undefined) throw agentCeilingGrantError(set, agentCeilingPositionAssignment(position));
}

/**
 * `beforeInsert` on `sys_user_position`: EVERY write, a system one included.
 * Unlike the grant table, no system writer of this table has a position of its
 * own to assign — invitation acceptance, the development demo accounts and seed
 * replay each write a position someone declared — so the system stand-down
 * would only carry a declared position past the rule.
 */
function onPositionInsert(engine: unknown) {
  return async (ctx: any): Promise<void> => {
    if (ctx?.object !== POSITION_ASSIGNMENT_OBJECT) return;
    const row = ctx?.input?.data;
    if (!isPlainRecord(row)) return;
    await assertPositionGivesNoAgentCeiling(engine, row[POSITION_ASSIGNMENT_FIELD]);
  };
}

/**
 * `beforeUpdate` on `sys_user_position`: an update naming a position is judged
 * on it, for every writer; one that leaves the position as stored is judged on
 * the stored one for the writers {@link judges} reads, as the grant table's is.
 */
function onPositionUpdate(engine: unknown) {
  return async (ctx: any): Promise<void> => {
    if (ctx?.object !== POSITION_ASSIGNMENT_OBJECT) return;
    const data = ctx?.input?.data;
    if (!isPlainRecord(data)) return;
    if (hasOwn(data, POSITION_ASSIGNMENT_FIELD)) {
      await assertPositionGivesNoAgentCeiling(engine, data[POSITION_ASSIGNMENT_FIELD]);
    } else if (judges(ctx) && isPlainRecord(ctx?.previous)) {
      await assertPositionGivesNoAgentCeiling(engine, ctx.previous[POSITION_ASSIGNMENT_FIELD]);
    }
  };
}

/**
 * The metadata door's half: a position whose definition names an agent ceiling
 * set is refused before it is stored — on a draft and an active save, and on a
 * restore: the doors that run the protocol's authoring gate for `position`.
 * Feature-detected, as the sibling gates are: a protocol without the seam keeps
 * its behavior, and the call answers `false`.
 */
export function registerPositionAgentCeilingGate(protocol: any): boolean {
  if (!protocol || typeof protocol.registerAuthoringGate !== 'function') return false;
  protocol.registerAuthoringGate('position', (ctx: { body?: unknown }) => {
    const set = agentCeilingSetOfPosition(ctx?.body);
    if (set !== undefined) throw agentCeilingGrantError(set, AGENT_CEILING_POSITION_DEFINITION);
  });
  return true;
}

/** The deployment's baseline as `SecurityPlugin` options name it: who holds it, and the option. */
function agentCeilingBaselineOption(option: string): AgentCeilingCarrier {
  return {
    field: option,
    label: `The SecurityPlugin option \`${option}\``,
    carrier: 'the baseline every signed-in person holds',
    choice: 'permission set',
  };
}

/**
 * The construction-time half: the deployment's baseline — the
 * `fallbackPermissionSet` every signed-in person holds (whether named directly
 * or as the `isDefault` set of the plugin's `defaultPermissionSets`), and the
 * package defaults a walled host accepts for the `everyone` anchor
 * (`acceptedDefaultPermissionSets`) — never names an agent ceiling set. Thrown
 * from `SecurityPlugin`'s constructor, so such a composition does not boot,
 * as an audience configuration naming one does not.
 */
export function refuseAgentCeilingInBaselineOptions(
  fallbackPermissionSet: string | null | undefined,
  acceptedDefaultPermissionSets: readonly string[] | undefined,
): void {
  const named: Array<[string, unknown]> = [
    ['fallbackPermissionSet', fallbackPermissionSet],
    ...(acceptedDefaultPermissionSets ?? []).map((name): [string, unknown] => ['acceptedDefaultPermissionSets', name]),
  ];
  for (const [option, name] of named) {
    if (isAgentCeilingPermissionSet(name)) {
      throw agentCeilingGrantError(name as string, agentCeilingBaselineOption(option));
    }
  }
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
 * Bind the four hooks on the engine — the grant table's and the position
 * assignment table's, insert and update — idempotently: a re-run of the
 * plugin's `start()` on the same engine replaces the binding instead of
 * doubling it.
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
        `permission set (${[...AGENT_CEILING_SETS].join(', ')}), and a ${POSITION_ASSIGNMENT_OBJECT} write naming a ` +
        'position whose definition names one, are NOT refused',
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
  engine.registerHook('beforeInsert', onPositionInsert(engine), {
    object: POSITION_ASSIGNMENT_OBJECT,
    priority: HOOK_PRIORITY,
    packageId: AGENT_CEILING_GRANT_HOOK_PACKAGE,
  });
  engine.registerHook('beforeUpdate', onPositionUpdate(engine), {
    object: POSITION_ASSIGNMENT_OBJECT,
    priority: HOOK_PRIORITY,
    packageId: AGENT_CEILING_GRANT_HOOK_PACKAGE,
  });
  return true;
}
