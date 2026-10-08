// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `sys_position` data-door write-through under `single` (ADR-0131 D3, C2
 * stage S7).
 *
 * ## What it does
 *
 * ADR-0131 D3 gives the security catalog one home, the environment registry,
 * and says of the `single` posture: "an admin who creates or edits a position
 * ... in Setup performs an environment metadata write". Before this module a
 * Setup create or edit of a position wrote a `sys_position` row and nothing
 * else, so the position had no registry home and the catalog read
 * (`createSecurityCatalogReader`, `@objectstack/core`) did not resolve it. Every
 * non-system data-door write on `sys_position` under `single` now also writes
 * the position's DEFINITION through the metadata door, at environment scope:
 *
 * - **the row first.** The engine executes the row write as before, with every
 *   check it already makes (the required label, the reserved built-in names,
 *   one name per organization, the junction's `DELETE_RESTRICTED`). Only a row
 *   the engine accepted gets a definition. Writing the definition first would,
 *   for a duplicate name, overwrite the existing definition before the unique
 *   index refused the row;
 * - **then the definition** `{ name, label, description, delegatable }`, read
 *   back from the written row, so the row and the definition agree by
 *   construction. `active` and `is_default` are row state (no `PositionSchema`
 *   key carries them; the standing ruling keeps `active` on the row), so a
 *   patch touching only them is a row write and nothing else;
 * - **a refusal undoes the row.** When the metadata door refuses a create, or
 *   an update that renames a position, the row write is undone and the door's
 *   own refusal is the answer: nothing is kept. That is the refusal for a name
 *   the door does not accept (its item-name grammar, `PositionSchema.name`):
 *   the data door accepted such names before this stage, and a position named
 *   that way could never have a registry home (seat re-rule on the C2 card,
 *   Q1 = A);
 * - **rename** saves the new name's definition and deletes the old name's;
 * - **delete** deletes the row, then the definition. A definition delete that
 *   fails is reported at `error`: the declared-position seeder recreates a row
 *   for every definition the catalog lists at the next boot, so the deleted
 *   position would come back.
 *
 * ## Where it stands down — the write proceeds exactly as before
 *
 * - **a system write** (`isSystem`): the seeders and the package door write
 *   rows for definitions that already have their home;
 * - **a walled posture**: under a wall a definition is the operator's
 *   (ADR-0131 D3), and an organization's row has no environment home to write
 *   (the walled half is a later stage's);
 * - **a kernel whose metadata protocol cannot save and delete**: the legacy
 *   direct write, as the permission-set write-through does;
 * - **a name a package or a built-in holds**: its definition is the package's
 *   (or the platform's), and the metadata door refuses an environment save over
 *   it (`403 NOT_OVERRIDABLE`, `allowOrgOverride: false`). The question is read
 *   from the engine registry's artifact provenance
 *   (`SchemaRegistry.getArtifactItem`), the same source the door decides
 *   `NOT_OVERRIDABLE` from (seat re-rule, Q2 = A);
 * - **an edit of a row whose name the metadata door does not accept**, with the
 *   name unchanged: such a row predates this stage, has no definition and can
 *   have none, so the edit stays a row write (Q1 = A's control). The predicate
 *   ({@link metadataDoorAcceptsPositionName}) is read off the spec's own item
 *   name pattern and `PositionSchema.name`, never transcribed.
 *
 * ## Where it runs
 *
 * `SecurityPlugin` registers it on `sys_position` AFTER its security
 * middleware, so it runs INSIDE it: `assertSystemRowWriteGate`, the
 * engine-owned write guard and the CRUD/FLS checks have all passed before a
 * write is translated. Unlike the permission-set write-through, the driver
 * write is never skipped: every row reader keeps answering exactly as before,
 * because the row is still the row the data door wrote.
 */

import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import { METADATA_ITEM_NAME_PATTERN } from '@objectstack/spec/shared';
import { PositionSchema } from '@objectstack/spec/identity';

/** The catalog object this module is registered on. */
export const POSITION_OBJECT = 'sys_position';
/** The metadata type a position definition is saved as. */
export const POSITION_METADATA_TYPE = 'position';

const SYSTEM_CTX = { isSystem: true } as const;

/**
 * The row columns that are row STATE, never part of a definition — the
 * standing ruling keeps `active` on the row, and `is_default` has no key on
 * `PositionSchema` either. Identity (`id`) and the readonly provenance and
 * timestamp columns are not definition edits either.
 */
const ROW_ONLY_COLUMNS: ReadonlySet<string> = new Set([
  'id', 'active', 'is_default', 'managed_by', 'created_at', 'updated_at', 'organization_id',
]);

/** The kernel logger, as this module uses it. */
export interface PositionWriteThroughLogger {
  info?: (message: string, meta?: Record<string, any>) => void;
  warn: (message: string, meta?: Record<string, any>) => void;
  /** The kernel logger's shape: message, cause, meta. */
  error?: (message: string, cause?: Error, meta?: Record<string, any>) => void;
}

/** The metadata door, as this module uses it. */
export interface PositionMetadataDoor {
  saveMetaItem(request: { type: string; name: string; item: Record<string, unknown>; actor?: string }): Promise<unknown>;
  deleteMetaItem(request: { type: string; name: string; actor?: string }): Promise<unknown>;
}

export interface PositionWriteThroughDeps {
  /** ObjectQL engine handle (row reads, the undo writes, the registry). */
  ql: any;
  /** Lazy protocol handle — the protocol service may register after start(). */
  getProtocol: () => unknown;
  /** The tenancy posture in force — read per write. */
  getPosture: () => TenancyPosture;
  logger?: PositionWriteThroughLogger;
}

/**
 * Is `protocol` a metadata door this module can write through? Both verbs are
 * required: a door that can save but not delete would leave a renamed or
 * deleted position's definition behind.
 */
export function isPositionMetadataDoor(protocol: unknown): protocol is PositionMetadataDoor {
  const p = protocol as Partial<PositionMetadataDoor> | null | undefined;
  return !!p && typeof p.saveMetaItem === 'function' && typeof p.deleteMetaItem === 'function';
}

/**
 * Does a package or a built-in hold this position name? Read from the engine
 * registry's artifact provenance — `getArtifactItem` answers only an item a
 * code package registered (an environment definition hydrated from
 * `sys_metadata` carries no package), which is the lookup the metadata door
 * arms `NOT_OVERRIDABLE` from. A registry without that read falls back to the
 * by-name read with the same provenance filter the door applies to one.
 */
export function packageHoldsPosition(ql: any, name: string): boolean {
  const registry = ql?.registry;
  if (!registry) return false;
  try {
    if (typeof registry.getArtifactItem === 'function') {
      return registry.getArtifactItem(POSITION_METADATA_TYPE, name) !== undefined;
    }
    if (typeof registry.getItem === 'function') {
      const item = registry.getItem(POSITION_METADATA_TYPE, name);
      const pkg = (item as { _packageId?: unknown } | null | undefined)?._packageId;
      return typeof pkg === 'string' && pkg !== '' && pkg !== 'sys_metadata';
    }
  } catch {
    // An unreadable registry holds nothing we can see; the metadata door
    // still refuses a save over a packaged name itself.
  }
  return false;
}

let cachedPositionNameSchema: { safeParse(v: unknown): { success: boolean } } | null = null;

/**
 * Would the metadata door accept `name` as a position name? Both of the door's
 * name checks, each read from its own declaration: the item-name grammar
 * (`METADATA_ITEM_NAME_PATTERN`, enforced at `saveMetaItem`) and
 * `PositionSchema.name` (the spec validation that runs inside it). Derived,
 * never transcribed, so a grammar change in the spec moves this answer with
 * it. Resolved on first use: `PositionSchema` is a lazy schema.
 */
export function metadataDoorAcceptsPositionName(name: unknown): boolean {
  if (typeof name !== 'string' || !METADATA_ITEM_NAME_PATTERN.test(name)) return false;
  cachedPositionNameSchema ??= ((PositionSchema as unknown as { shape?: Record<string, any> }).shape?.name ?? null);
  return cachedPositionNameSchema ? cachedPositionNameSchema.safeParse(name).success : true;
}

/**
 * The position DEFINITION a row carries: the four `PositionSchema` keys the
 * row has columns for. `active` and `is_default` are row state and never
 * travel; a `null` or blank description is absent, never `null` (the schema
 * declares it optional, not nullable).
 */
export function positionBodyFromRow(row: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: row.name,
    label: typeof row.label === 'string' && row.label !== '' ? row.label : row.name,
  };
  if (typeof row.description === 'string' && row.description !== '') body.description = row.description;
  body.delegatable = row.delegatable === true || row.delegatable === 1 || row.delegatable === '1' || row.delegatable === 'true';
  return body;
}

/** Does this update payload touch the definition at all? */
function touchesDefinition(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).some((key) => !ROW_ONLY_COLUMNS.has(key));
}

const scalarId = (v: unknown): v is string | number =>
  (typeof v === 'string' && v !== '') || (typeof v === 'number' && Number.isFinite(v));

/** The rows a data-door update or delete targets, read before the write (by id, or by the write's filter). */
async function readTargetRows(ql: any, opCtx: any): Promise<Record<string, unknown>[]> {
  const data = opCtx?.data;
  const where = opCtx?.options?.where;
  let filter: unknown;
  if (data && typeof data === 'object' && !Array.isArray(data) && scalarId((data as any).id)) filter = { id: (data as any).id };
  else if (where && typeof where === 'object' && scalarId((where as any).id)) filter = { id: (where as any).id };
  else if (where && typeof where === 'object') filter = where;
  else return [];
  const rows = await ql.find(POSITION_OBJECT, { where: filter, limit: 1000, context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : [];
}

async function readRowById(ql: any, id: unknown): Promise<Record<string, unknown> | null> {
  const rows = await ql.find(POSITION_OBJECT, { where: { id }, limit: 1, context: SYSTEM_CTX });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/** Does any row still carry `name` (another organization's, or a declared one)? */
async function nameStillCarried(ql: any, name: string): Promise<boolean> {
  const rows = await ql.find(POSITION_OBJECT, { where: { name }, limit: 1, context: SYSTEM_CTX });
  return Array.isArray(rows) && rows.length > 0;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function logError(logger: PositionWriteThroughLogger | undefined, message: string, cause: unknown, meta: Record<string, unknown>): void {
  if (logger?.error) logger.error(message, cause instanceof Error ? cause : undefined, meta);
  else logger?.warn?.(message, { ...meta, error: errorText(cause) });
}

/**
 * Engine middleware: under `single`, write every non-system data-door create,
 * edit, rename and delete of a position through to its environment definition.
 * See the module note for the order, the undo and where it stands down.
 */
export function createPositionWriteThrough(
  deps: PositionWriteThroughDeps,
): (opCtx: any, next: () => Promise<void>) => Promise<void> {
  const { ql, logger } = deps;

  /** Which of a name's possible definitions this module may write: neither a package's nor the platform's. */
  const environmentOwns = (name: unknown): name is string =>
    typeof name === 'string' && name !== '' && !packageHoldsPosition(ql, name);

  const saveDefinition = (door: PositionMetadataDoor, row: Record<string, unknown>, actor?: string) =>
    door.saveMetaItem({
      type: POSITION_METADATA_TYPE,
      name: String(row.name),
      item: positionBodyFromRow(row),
      ...(actor ? { actor } : {}),
    });

  /**
   * Delete `name`'s environment definition once no row carries the name any
   * more. A definition the delete leaves behind is reported at `error`: the
   * row is already gone and its caller was told so, and the next boot's
   * declared-position seeder recreates a row from the definition.
   */
  const deleteDefinitionOf = async (door: PositionMetadataDoor, name: string, actor?: string): Promise<void> => {
    if (!environmentOwns(name) || !metadataDoorAcceptsPositionName(name)) return;
    try {
      if (await nameStillCarried(ql, name)) return;
      await door.deleteMetaItem({ type: POSITION_METADATA_TYPE, name, ...(actor ? { actor } : {}) });
    } catch (e) {
      logError(
        logger,
        `[security] the position '${name}' was removed from ${POSITION_OBJECT}, but its environment definition was ` +
          'NOT deleted (ADR-0131 D3). Nothing looks wrong now: the row is gone and the write answered success. At the ' +
          'next boot the declared-position seeder recreates a row for every definition the catalog lists, so the ' +
          'position comes back and every assignment naming it grants again. Fix: delete the definition through the ' +
          `metadata door (DELETE /api/v1/meta/position/${name}) before the next restart.`,
        e,
        { name },
      );
    }
  };

  /** Undo an insert: the rows this write created go again, under the system context. */
  const undoInsert = async (rows: Record<string, unknown>[]): Promise<void> => {
    for (const row of rows) {
      try {
        await ql.delete(POSITION_OBJECT, { where: { id: row.id }, context: SYSTEM_CTX });
      } catch (e) {
        logError(
          logger,
          `[security] a ${POSITION_OBJECT} create was refused by the metadata door, and undoing its row FAILED: the ` +
            `position '${String(row.name)}' exists as a row with no environment definition while the caller was told ` +
            'the create was refused. Fix: delete the row by hand, then create the position again under a name the ' +
            'metadata door accepts (lowercase snake_case).',
          e,
          { id: row.id, name: row.name },
        );
      }
    }
  };

  /** Undo an update: every target row gets back the columns the patch wrote. */
  const undoUpdate = async (targets: Record<string, unknown>[], patch: Record<string, unknown>): Promise<void> => {
    for (const pre of targets) {
      const restore: Record<string, unknown> = { id: pre.id };
      for (const key of Object.keys(patch)) {
        if (key !== 'id' && key in pre) restore[key] = pre[key];
      }
      try {
        await ql.update(POSITION_OBJECT, restore, { context: SYSTEM_CTX });
      } catch (e) {
        logError(
          logger,
          `[security] a ${POSITION_OBJECT} edit was refused by the metadata door, and restoring the row FAILED: the ` +
            `row '${String(pre.name)}' keeps the refused edit while the caller was told it was refused, and the row ` +
            'and its environment definition now disagree. Fix: re-apply the previous values to the row by hand.',
          e,
          { id: pre.id, name: pre.name },
        );
      }
    }
  };

  return async (opCtx: any, next: () => Promise<void>): Promise<void> => {
    if (opCtx?.object !== POSITION_OBJECT) return next();
    if (opCtx?.context?.isSystem) return next();
    const op = opCtx?.operation;
    if (op !== 'insert' && op !== 'update' && op !== 'delete') return next();
    if (postureEnforcesWall(deps.getPosture())) return next();
    const door = deps.getProtocol();
    if (!isPositionMetadataDoor(door)) return next();
    const actor = opCtx?.context?.userId ? String(opCtx.context.userId) : undefined;

    if (op === 'insert') {
      await next();
      const result = opCtx.result;
      const written = (Array.isArray(result) ? result : [result])
        .filter((r: unknown): r is Record<string, unknown> => !!r && typeof r === 'object' && scalarId((r as any).id));
      const saved: Record<string, unknown>[] = [];
      for (const created of written) {
        const row = (await readRowById(ql, created.id)) ?? created;
        if (!environmentOwns(row.name)) continue;
        try {
          await saveDefinition(door, row, actor);
          saved.push(row);
        } catch (e) {
          // The definitions this write already saved go with their rows.
          for (const done of saved) await deleteDefinitionOfInsert(door, done, actor);
          await undoInsert(written);
          throw e;
        }
      }
      return;
    }

    // An update or a delete: the targets are read before the write.
    const targets = await readTargetRows(ql, opCtx);
    await next();
    if (targets.length === 0) return;

    if (op === 'delete') {
      for (const pre of targets) {
        if (await readRowById(ql, pre.id)) continue; // the row survived: nothing was deleted
        await deleteDefinitionOf(door, String(pre.name), actor);
      }
      return;
    }

    const patch = opCtx.data && typeof opCtx.data === 'object' && !Array.isArray(opCtx.data) ? opCtx.data : null;
    if (!patch || !touchesDefinition(patch)) return;
    const posts: Array<{ pre: Record<string, unknown>; post: Record<string, unknown> }> = [];
    for (const pre of targets) {
      const post = await readRowById(ql, pre.id);
      if (post) posts.push({ pre, post });
    }

    // Every new definition first; the old names' definitions go only once all landed.
    const saved: Array<{ pre: Record<string, unknown>; post: Record<string, unknown> }> = [];
    for (const pair of posts) {
      const { pre, post } = pair;
      const renamed = pre.name !== post.name;
      if (!environmentOwns(post.name)) continue;
      // An unchanged name the door does not accept: a row that predates this
      // stage and can have no definition — the edit stays a row write.
      if (!renamed && !metadataDoorAcceptsPositionName(post.name)) continue;
      try {
        await saveDefinition(door, post, actor);
        saved.push(pair);
      } catch (e) {
        await undoUpdate(targets, patch);
        // The definitions saved before this one return to their pre-image.
        for (const done of saved) await restoreDefinitionAfterUndo(door, done, actor);
        throw e;
      }
    }
    for (const { pre, post } of posts) {
      if (pre.name !== post.name) await deleteDefinitionOf(door, String(pre.name), actor);
    }
  };

  /** Undo of an insert's saved definition: the row is about to go, so its definition goes too. */
  async function deleteDefinitionOfInsert(door: PositionMetadataDoor, row: Record<string, unknown>, actor?: string): Promise<void> {
    try {
      await door.deleteMetaItem({ type: POSITION_METADATA_TYPE, name: String(row.name), ...(actor ? { actor } : {}) });
    } catch (e) {
      logError(
        logger,
        `[security] a ${POSITION_OBJECT} create was refused, and undoing the environment definition already saved for ` +
          `'${String(row.name)}' FAILED: the definition stays with no row, and the next boot's declared-position ` +
          `seeder creates a row for it. Fix: DELETE /api/v1/meta/position/${String(row.name)}.`,
        e,
        { name: row.name },
      );
    }
  }

  /** Undo of an update's saved definition: back to the pre-image, and a renamed one's new name goes. */
  async function restoreDefinitionAfterUndo(
    door: PositionMetadataDoor,
    pair: { pre: Record<string, unknown>; post: Record<string, unknown> },
    actor?: string,
  ): Promise<void> {
    const { pre, post } = pair;
    try {
      if (pre.name !== post.name) {
        await door.deleteMetaItem({ type: POSITION_METADATA_TYPE, name: String(post.name), ...(actor ? { actor } : {}) });
      } else {
        await saveDefinition(door, pre, actor);
      }
    } catch (e) {
      logError(
        logger,
        `[security] a ${POSITION_OBJECT} edit was refused, and returning the environment definition of ` +
          `'${String(post.name)}' to its previous state FAILED: the row is back as it was and the definition is not. ` +
          'Fix: re-save the position in Setup.',
        e,
        { name: post.name },
      );
    }
  }
}
