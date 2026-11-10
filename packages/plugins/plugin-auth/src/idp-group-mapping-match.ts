// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Whether an identity-provider group mapping matches a group its source
 * currently pushes (#32121): `sys_idp_group_mapping.match_status`,
 * `matched_group_id` and `match_changed_at`.
 *
 * ## Why it is stored
 *
 * The SCIM projection's matcher (`scim-group-projection.ts`, `roles.map`)
 * compares a mapping's `group_external_id` / `group_display_name` with the
 * pushed group on each membership change and keeps nothing about the result.
 * When the identity provider renames or deletes the group, every member loses
 * the grant at once (fail closed, correct) and the mapping row says nothing.
 * A page cannot work it out either: `sys_scim_group` is hidden by its default
 * row scope, and a list view has no anti-join. So the answer is written onto
 * the mapping row, by the one module that knows how a mapping names a group
 * ({@link mappingMatchesGroup}, the projection's own matcher).
 *
 * ## Who keeps it current, and why engine hooks
 *
 * Either side can move: the group (the vendor's SCIM `POST`, `PUT`, `PATCH`
 * and `DELETE /Groups`, and a connection decommission) or the mapping (the
 * platform-admin door's save). `roles.map` is not enough: the vendor calls it
 * only for a group that has members, so an empty group's rename would never
 * reach it. Every one of those writes goes through the ObjectQL engine (the
 * better-auth adapter's `create` / `update` / `incrementOne` / `delete` all
 * end in an engine call by id), so after-hooks on `sys_scim_group` and on
 * `sys_idp_group_mapping` see each of them, the same seam
 * `membership-ended-session.ts` measured for `sys_member`. A raw driver write
 * below the engine is not seen; the boot sweep ({@link refreshAllMappingMatches})
 * puts every row right again at the next start.
 *
 * Inside a SCIM request the hook's reads and writes join the request's engine
 * transaction (the adapter publishes it into the engine's ambient store), so
 * they read the group as the mutation left it.
 *
 * ## What it never does
 *
 * - It never decides a grant. The projection still matches on every mutation
 *   and grants only what matches; a mapping that matches nothing still grants
 *   nothing. These columns only describe the row.
 * - It never fails the write that triggered it. A SCIM mutation that 500s is
 *   retried by the identity provider forever, and a stale description is not
 *   worth that: a failure is logged at `error`, naming what is stale and how it
 *   heals (the next write to either side, or the next boot).
 * - It never writes a row whose answer did not change, so the mapping's history
 *   shows only real transitions (renamed away, renamed back).
 *
 * An SSO provider sends its groups only as a claim at sign-in and stores no
 * group list, so an SSO mapping reads `not_applicable`.
 */

import type { IDataEngine } from '@objectstack/core';
import { withSystemContext } from './objectql-adapter.js';
import {
  IDP_GROUP_MAPPING_OBJECT,
  SCIM_MAPPING_SOURCE_KIND,
  SSO_MAPPING_SOURCE_KIND,
  mappingMatchesGroup,
  type MappingRow,
} from './scim-group-projection.js';

/** The groups a SCIM connection pushes (`@better-auth/scim` `scimGroup`). */
export const SCIM_GROUP_OBJECT = 'sys_scim_group';

/** What `sys_idp_group_mapping.match_status` can say. */
export type IdpGroupMappingMatchStatus = 'matched' | 'unmatched' | 'not_applicable';

/** The hooks' package id, so a re-bind after a hot reload replaces them. */
export const IDP_GROUP_MAPPING_MATCH_PACKAGE_ID = 'com.objectstack.plugin-auth.idp-group-mapping-match';

/** A group write changes what a mapping matches only through these columns. */
const GROUP_KEY_COLUMNS = ['display_name', 'external_id', 'connection_id'] as const;

/** A mapping write changes what it matches only through these columns. */
const MAPPING_KEY_COLUMNS = ['source_kind', 'source_id', 'group_external_id', 'group_display_name'] as const;

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function registered(engine: IDataEngine, object: string): boolean {
  const getSchema = (engine as unknown as { getSchema?: (name: string) => unknown }).getSchema;
  return typeof getSchema !== 'function' || Boolean(getSchema.call(engine, object));
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

interface StoredMapping extends MappingRow {
  source_kind?: unknown;
  match_status?: unknown;
  matched_group_id?: unknown;
}

interface Answer {
  status: IdpGroupMappingMatchStatus;
  groupId: string | null;
}

/** Write `answer` onto `row` when it differs from what the row says; true when it wrote. */
async function settle(engine: IDataEngine, row: StoredMapping, answer: Answer): Promise<boolean> {
  if (text(row.match_status) === answer.status && (text(row.matched_group_id) || null) === answer.groupId) return false;
  await withSystemContext(engine).update(IDP_GROUP_MAPPING_OBJECT, {
    id: text(row.id),
    match_status: answer.status,
    matched_group_id: answer.groupId,
    match_changed_at: new Date().toISOString(),
  });
  return true;
}

/**
 * Re-judge every mapping of one SCIM connection against the groups it pushes
 * now, and write the answers that changed. Returns how many rows it wrote.
 * Throws on a read or write failure; the hooks catch it.
 */
export async function refreshConnectionMappingMatches(engine: IDataEngine, connectionId: string): Promise<number> {
  if (!connectionId || !registered(engine, IDP_GROUP_MAPPING_OBJECT)) return 0;
  const reader = withSystemContext(engine);
  const mappings = rowsOf(
    await reader.find(IDP_GROUP_MAPPING_OBJECT, {
      where: { source_kind: SCIM_MAPPING_SOURCE_KIND, source_id: connectionId },
      fields: ['id', 'source_kind', 'group_external_id', 'group_display_name', 'match_status', 'matched_group_id'],
    }),
  ) as StoredMapping[];
  if (mappings.length === 0) return 0;
  const groups = registered(engine, SCIM_GROUP_OBJECT)
    ? rowsOf(
        await reader.find(SCIM_GROUP_OBJECT, {
          where: { connection_id: connectionId },
          fields: ['id', 'display_name', 'external_id'],
        }),
      )
    : [];
  let written = 0;
  for (const row of mappings) {
    const group = groups.find((g) =>
      mappingMatchesGroup(row, { externalId: text(g.external_id) || undefined, displayName: text(g.display_name) }),
    );
    const answer: Answer = group ? { status: 'matched', groupId: text(group.id) } : { status: 'unmatched', groupId: null };
    if (await settle(engine, row, answer)) written += 1;
  }
  return written;
}

/** Mark one SSO mapping `not_applicable` (it stores no group list to match against). */
async function settleSsoMapping(engine: IDataEngine, row: StoredMapping): Promise<boolean> {
  return settle(engine, row, { status: 'not_applicable', groupId: null });
}

/**
 * Re-judge every mapping row: each SCIM connection's against its groups, each
 * SSO row as `not_applicable`. Run at boot, so rows saved before these columns
 * existed, or moved by a write below the engine, read right. Returns how many
 * rows it wrote.
 */
export async function refreshAllMappingMatches(engine: IDataEngine): Promise<number> {
  if (!registered(engine, IDP_GROUP_MAPPING_OBJECT)) return 0;
  const rows = rowsOf(
    await withSystemContext(engine).find(IDP_GROUP_MAPPING_OBJECT, {
      fields: ['id', 'source_kind', 'source_id', 'match_status', 'matched_group_id'],
    }),
  ) as StoredMapping[];
  let written = 0;
  const connections = new Set<string>();
  for (const row of rows) {
    if (text(row.source_kind) === SSO_MAPPING_SOURCE_KIND) {
      if (await settleSsoMapping(engine, row)) written += 1;
    } else {
      connections.add(text(row.source_id));
    }
  }
  for (const connectionId of connections) written += await refreshConnectionMappingMatches(engine, connectionId);
  return written;
}

/** The slice of the ObjectQL engine the hooks need. */
export interface IdpGroupMappingMatchEngine extends IDataEngine {
  registerHook(event: string, handler: (ctx: any) => unknown, options?: unknown): void;
  unregisterHooksByPackage?(packageId: string): void;
}

export interface IdpGroupMappingMatchOptions {
  packageId?: string;
  logger?: { info?: (message: string) => void; error: (message: string) => void };
}

/** Does this write's patch touch any of `columns`? An insert or a delete always does. */
function touches(data: unknown, columns: readonly string[]): boolean {
  if (!data || typeof data !== 'object') return false;
  return columns.some((column) => column in (data as Record<string, unknown>));
}

/**
 * Bind the two after-hooks: a write to `sys_scim_group` re-judges its
 * connection's mappings, and a write to `sys_idp_group_mapping` that changes
 * what the row names re-judges that row's source. Idempotent per package.
 */
export function registerIdpGroupMappingMatchTrigger(
  engine: IdpGroupMappingMatchEngine,
  opts: IdpGroupMappingMatchOptions = {},
): void {
  const packageId = opts.packageId ?? IDP_GROUP_MAPPING_MATCH_PACKAGE_ID;
  const logger = opts.logger;

  const refresh = async (connectionIds: Iterable<string>, cause: string): Promise<void> => {
    for (const connectionId of new Set(connectionIds)) {
      if (!connectionId) continue;
      try {
        await refreshConnectionMappingMatches(engine, connectionId);
      } catch (error) {
        logger?.error(
          `[auth] ${cause} for SCIM connection '${connectionId}' SUCCEEDED, but re-judging which of its group mappings `
            + 'match a current group FAILED, so their match_status may be stale (a stale value never changes a grant: '
            + 'the projection matches on every membership change). It heals on the next write to a group or mapping of '
            + `that connection, or at the next boot. Cause: ${(error as Error)?.message ?? String(error)}`,
        );
      }
    }
  };

  const connectionsOf = (ctx: any): string[] => [
    text(ctx?.previous?.connection_id),
    text(ctx?.input?.data?.connection_id),
    text(ctx?.result?.connection_id),
  ];

  const onGroupInsertOrDelete = (cause: string) => async (ctx: any): Promise<void> => {
    if (ctx?.object !== SCIM_GROUP_OBJECT) return;
    await refresh(connectionsOf(ctx), cause);
  };

  const onGroupUpdate = async (ctx: any): Promise<void> => {
    if (ctx?.object !== SCIM_GROUP_OBJECT) return;
    // A membership change bumps `revision` / `updated_at` only; nothing a mapping names moved.
    if (!touches(ctx?.input?.data, GROUP_KEY_COLUMNS)) return;
    await refresh(connectionsOf(ctx), 'A SCIM group update');
  };

  const onMappingWrite = (isInsert: boolean) => async (ctx: any): Promise<void> => {
    if (ctx?.object !== IDP_GROUP_MAPPING_OBJECT) return;
    const data = ctx?.input?.data as Record<string, unknown> | undefined;
    // This module's own writes touch only the match columns, so they stop here.
    if (!isInsert && !touches(data, MAPPING_KEY_COLUMNS)) return;
    const row: StoredMapping = { ...(ctx?.previous ?? {}), ...(ctx?.result ?? {}), ...(data ?? {}) };
    const previousKind = text(ctx?.previous?.source_kind);
    const scimSources = [
      ...(previousKind === SCIM_MAPPING_SOURCE_KIND ? [text(ctx?.previous?.source_id)] : []),
      ...(text(row.source_kind) !== SSO_MAPPING_SOURCE_KIND ? [text(row.source_id)] : []),
    ];
    if (text(row.source_kind) === SSO_MAPPING_SOURCE_KIND) {
      try {
        const id = text(row.id) || text(ctx?.input?.id);
        if (id) await settleSsoMapping(engine, { ...row, id });
      } catch (error) {
        logger?.error(
          `[auth] An IdP group mapping for SSO provider '${text(row.source_id)}' was SAVED, but marking it `
            + '`not_applicable` FAILED, so its match_status may read empty until the next boot (it never changes a '
            + `grant). Cause: ${(error as Error)?.message ?? String(error)}`,
        );
      }
    }
    await refresh(scimSources, 'An IdP group mapping save');
  };

  if (typeof engine.unregisterHooksByPackage === 'function') {
    try {
      engine.unregisterHooksByPackage(packageId);
    } catch {
      /* first bind: nothing registered yet */
    }
  }
  engine.registerHook('afterInsert', onGroupInsertOrDelete('A SCIM group create'), { object: SCIM_GROUP_OBJECT, packageId });
  engine.registerHook('afterUpdate', onGroupUpdate, { object: SCIM_GROUP_OBJECT, packageId });
  engine.registerHook('afterDelete', onGroupInsertOrDelete('A SCIM group delete'), { object: SCIM_GROUP_OBJECT, packageId });
  engine.registerHook('afterInsert', onMappingWrite(true), { object: IDP_GROUP_MAPPING_OBJECT, packageId });
  engine.registerHook('afterUpdate', onMappingWrite(false), { object: IDP_GROUP_MAPPING_OBJECT, packageId });
}
