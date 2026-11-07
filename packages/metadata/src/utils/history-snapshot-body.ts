// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The body a `sys_metadata_history` snapshot stores (ruling 6677709817, step
 * (c)): the body the write persists, WITHOUT every position the type's
 * read-path redactor marks withheld AND not carried forward
 * (`MetadataRedactionResult.notCarriedForwardKeys`, `@objectstack/spec/kernel`).
 *
 * A connector's undeclared `auth` key is the case: no door accepts one, nothing
 * at runtime reads one, and a save of the served form drains it from the live
 * row (`withheld-key-dropped`). A history snapshot is a second copy of the body
 * at rest, so a snapshot that kept the key would keep the cleartext the drain
 * exists to remove — and would hand it back to the live row on a revert to that
 * version. So no snapshot is written holding one, whichever write produced the
 * body (a save, a publish, a revert, a loader write).
 *
 * ONE predicate: which positions are dropped is the redactor's own answer for
 * this body, the same answer the save's carry-forward drains by. Nothing here
 * names a key or a type; a type whose redactor marks no such position (every
 * type but `connector` today, and every type with no redactor) gets the body
 * back BY REFERENCE, so its snapshot is byte-identical to what it was.
 *
 * Only the snapshot body changes. The history row's `checksum` keeps naming
 * the live row's stamp (its documented meaning), and the history read exit
 * (`redactStoredMetadataRow(s)`) is unchanged.
 */

import { getMetadataTypeRedactor } from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The positions the type's redactor names in `notCarriedForwardKeys` for
 * `body` (dotted, as the redactor spells them), or none.
 */
function notCarriedForwardPositionsOf(type: string, body: PlainObject): string[] {
  const redactor = getMetadataTypeRedactor(PLURAL_TO_SINGULAR[type] ?? type);
  if (!redactor) return [];
  return redactor(body).notCarriedForwardKeys ?? [];
}

/**
 * `body` with the key at the dotted `path` removed, copying only the containers
 * on the way down; `undefined` when no reading of `path` reaches a key `body`
 * holds. `redactedKeys` joins on dots, so a key whose own name carries a dot is
 * told apart from a nested path by what the body holds, in the order the
 * save's carry-forward reads it: every dot a separator first, then
 * progressively longer trailing keys, ending with the whole string as one key.
 */
function withoutPosition(body: PlainObject, path: string): PlainObject | undefined {
  const segments = path.split('.');
  for (let cut = segments.length - 1; cut >= 0; cut -= 1) {
    const hops = segments.slice(0, cut);
    const key = segments.slice(cut).join('.');
    const chain: PlainObject[] = [body];
    for (const hop of hops) {
      const next = chain[chain.length - 1][hop];
      if (!isPlainObject(next)) break;
      chain.push(next);
    }
    if (chain.length !== hops.length + 1) continue;
    const container = chain[chain.length - 1];
    if (!Object.prototype.hasOwnProperty.call(container, key)) continue;

    const { [key]: _removed, ...rest } = container;
    let rebuilt: PlainObject = rest;
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      rebuilt = { ...chain[i], [hops[i]]: rebuilt };
    }
    return rebuilt;
  }
  return undefined;
}

/**
 * The snapshot body for a `sys_metadata_history` row of `type`: `body` without
 * the positions its redactor marks not carried forward, or `body` itself (by
 * reference) when there are none.
 *
 * ⛔ Fails the write rather than store a snapshot still holding such a
 * position: a position the redactor names but this cannot remove is a shape
 * it does not understand, and a silent pass is the leak this closes.
 *
 * @param type request-shaped metadata type (plural or singular).
 * @param body the body the write persists to the live row.
 */
export function historySnapshotBody<T>(type: string, body: T): T {
  if (!isPlainObject(body)) return body;
  const positions = notCarriedForwardPositionsOf(type, body);
  if (positions.length === 0) return body;

  let out: PlainObject = body;
  for (const path of positions) out = withoutPosition(out, path) ?? out;

  const left = notCarriedForwardPositionsOf(type, out);
  if (left.length > 0) {
    throw new Error(
      `[Metadata] The ${type} history snapshot still holds ${left.length} position(s) its redactor marks ` +
        `not carried forward (${left.join(', ')}); the snapshot was not written.`,
    );
  }
  return out as T;
}
