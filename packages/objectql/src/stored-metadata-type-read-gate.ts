// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27884] The engine's stored-row read gate: a caller is served a
 * stored-metadata row of a capability-gated type (`datasource`,
 * `external_catalog`) only when it holds the capability the `/meta` type gate
 * names for that type.
 *
 * ## Why here, and why one middleware
 *
 * A datasource document is a row of the stored-metadata family
 * (`sys_metadata`, and its version snapshots in `sys_metadata_history`). The
 * `/meta` read doors refuse a caller without `manage_platform_settings` before
 * any store read (`metaTypeReadRefusal`, `@objectstack/rest`), but the same row
 * is also reachable as a RECORD: the generic data door's list, get, query,
 * count and export legs, on both transports, and any other reader that runs a
 * caller's context through the engine. A record read is admitted by the
 * object's grants, and a permission set that reads every object (a built-in
 * administrative set below platform administration among them) reads the
 * family's tables like any other. So the same document admitted two sets of
 * callers through two exits.
 *
 * Every one of those reads passes this engine's middleware chain, so the rule
 * is applied once, here, from the one table both exits read
 * (`STORED_METADATA_TYPE_READ_CAPABILITIES`, `@objectstack/metadata-core`):
 * for a caller missing a row's capability, `type NOT IN (those types)` is
 * AND-composed into the read's predicate. ⛔ Never a second copy of the table,
 * and never a per-door restatement of this gate.
 *
 * ## What it answers
 *
 * No row: a list and a count exclude the withheld types, and a get of a
 * withheld row answers as a get of a row that does not exist, so the read is no
 * existence oracle either. The object's own grants, field-level security, the
 * tenant wall and the family's body projection still apply to every row it
 * leaves in. `find`, `findOne`, `count` and `aggregate` are the reads; writes
 * are not judged here (the generic door admits none on these tables, and the
 * metadata protocol writes them under its own admission).
 *
 * A holder of every row's capability is not narrowed at all. A system read
 * (`isSystem`) and a read with no execution context are the platform's own —
 * the metadata loader, the `/meta` doors' store reads, boot — and are not
 * narrowed, the posture every engine read gate takes.
 */

import { isStoredMetadataBodyObject, STORED_METADATA_BODY_OBJECTS, STORED_METADATA_TYPE_COLUMN } from '@objectstack/spec/kernel';
import { storedMetadataTypesWithheldFrom } from '@objectstack/metadata-core';
import type { EngineMiddleware, OperationContext } from './engine.js';

/** The engine reads this gate narrows. */
export const STORED_METADATA_TYPE_READ_GATE_OPS: ReadonlySet<string> = new Set(['find', 'findOne', 'count', 'aggregate']);

/**
 * The predicate this gate AND-composes into a caller's read of a
 * stored-metadata table, or `undefined` when it composes nothing: an object
 * outside the family, a write, a system or context-less read, or a caller that
 * holds every row's capability.
 */
export function storedMetadataTypeReadFilter(
  op: Pick<OperationContext, 'object' | 'operation' | 'context'>,
): Record<string, unknown> | undefined {
  if (!isStoredMetadataBodyObject(op.object)) return undefined;
  if (!STORED_METADATA_TYPE_READ_GATE_OPS.has(op.operation)) return undefined;
  if (!op.context || op.context.isSystem) return undefined;
  const withheld = storedMetadataTypesWithheldFrom(op.context);
  if (withheld.length === 0) return undefined;
  return { [STORED_METADATA_TYPE_COLUMN]: { $nin: withheld } };
}

/** The gate itself: compose the filter into the read's WHERE, then go on. */
export const storedMetadataTypeReadGate: EngineMiddleware = async (ctx, next) => {
  const filter = storedMetadataTypeReadFilter(ctx);
  if (filter) {
    // A read with no AST would have nothing to narrow; fail closed rather than
    // serve it unnarrowed.
    const ast = (ctx.ast ??= { object: ctx.object } as NonNullable<OperationContext['ast']>);
    ast.where = ast.where ? { $and: [ast.where, filter] } : filter;
  }
  return next();
};

/** The tables the gate is registered on — the family, by its one definition. */
export const STORED_METADATA_TYPE_READ_GATE_OBJECTS: readonly string[] = Object.freeze([...STORED_METADATA_BODY_OBJECTS]);
