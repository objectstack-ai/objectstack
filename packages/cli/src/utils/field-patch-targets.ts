// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os validate`'s half of the field-patch target check (ADR-0146 D10, second
 * rule): an object extension's `fieldPatches` naming a field its target does
 * not have, or an option value the field does not have, is refused when the
 * target is in the composed stack.
 *
 * ## One judge, not a second rule
 *
 * The verdict is `@objectstack/metadata-core`'s `fieldPatchTargetRefusals`, the
 * SAME judge the marketplace install door refuses by and the registry fold
 * names its boot-time misses by. What this module owns is the WALK: which
 * objects the composed stack declares — its own, or every `packages[]` entry's
 * (ADR-0130 D4) — and which extensions each package carries. A target outside
 * the stack is not judged here; the install door judges it against the
 * installed base.
 */

import { fieldPatchTargetRefusals, type FieldPatchTargetRefusal } from '@objectstack/metadata-core';

import { artifactPackages } from './artifact-packages.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** The objects a stack body declares, by name — a list of definitions or a name-keyed map. */
function declaredObjects(body: Record<string, unknown>): Array<[string, unknown]> {
  const objects = body.objects;
  if (Array.isArray(objects)) {
    return objects.flatMap((o) => (isRecord(o) && typeof o.name === 'string' ? [[o.name, o] as [string, unknown]] : []));
  }
  return isRecord(objects) ? Object.entries(objects) : [];
}

/** Every field patch in the parsed stack that names what its in-stack target lacks, located. */
export function findFieldPatchTargetRefusals(parsed: Record<string, unknown>): FieldPatchTargetRefusal[] {
  const entries = artifactPackages(parsed);
  const bodies = entries.length > 0
    ? entries.map(({ index, body }) => ({ body, prefix: `packages[${index}].manifest.` }))
    : [{ body: parsed, prefix: '' }];
  const composed = new Map<string, unknown>();
  for (const { body } of bodies) for (const [name, object] of declaredObjects(body)) composed.set(name, object);
  return bodies.flatMap(({ body, prefix }) =>
    fieldPatchTargetRefusals(body.objectExtensions, (name) => composed.get(name), prefix));
}
