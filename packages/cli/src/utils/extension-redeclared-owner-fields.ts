// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os validate`'s half of ADR-0146 D10's display-property whitelist: an
 * `objectExtensions[].fields` entry naming a field the extended object's owner
 * declares replaces that field whole, so it is refused when it changes
 * anything outside the whitelist, when the owner is another package of this
 * composed artifact.
 *
 * ## One judge, not a second rule
 *
 * The verdict is `@objectstack/metadata-protocol`'s `judgeRedeclaredOwnerFields`,
 * the SAME judge the save, publish and restore doors of an `object_extension`
 * item and the marketplace install door ask, so a green validate is an
 * extension those doors admit. What this module owns is the WALK: which
 * package owns each object the artifact declares — every `packages[]` entry
 * under its own id (ADR-0130 D4), or the stack itself as one package under
 * `manifest.id` — and which extensions each package carries. An extension of
 * a package's own object changes its own field and is not judged; a target
 * outside the artifact is judged at install, against the installed owner.
 */

import { judgeRedeclaredOwnerFields, type ObjectOwnerDeclaration } from '@objectstack/metadata-protocol';

import { artifactPackages } from './artifact-packages.js';

/** One refused entry, located. `message` is the doors' sentence, verbatim. */
export interface RedeclaredOwnerFieldRefusalRow {
  /** Where the entry sits in the parsed stack, e.g. `packages[1].manifest.objectExtensions[0].fields.amount`. */
  path: string;
  /** The code the save doors refuse the same entry with. */
  code: 'VALIDATION_ERROR';
  object: string;
  field: string;
  /** The package the extension is declared in. */
  packageId: string | undefined;
  /** The package that declares the object. */
  ownerPackageId: string | undefined;
  /** The keys the entry changes, every one outside the display-property whitelist. */
  changed: string[];
  message: string;
}

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

/** Every extension field of the parsed stack that re-declares an in-artifact owner's field beyond its display properties. */
export function findRedeclaredOwnerFieldRefusals(parsed: Record<string, unknown>): RedeclaredOwnerFieldRefusalRow[] {
  const entries = artifactPackages(parsed);
  const bodies = entries.length > 0
    ? entries.map(({ index, id, body }) => ({ id: id as string | undefined, body, at: `packages[${index}].manifest.` }))
    : [{
      id: isRecord(parsed.manifest) && typeof parsed.manifest.id === 'string' ? parsed.manifest.id : undefined,
      body: parsed,
      at: '',
    }];
  const owners = new Map<string, ObjectOwnerDeclaration>();
  for (const { id, body } of bodies) {
    for (const [name, definition] of declaredObjects(body)) {
      if (!owners.has(name)) owners.set(name, { packageId: id, definition });
    }
  }
  return bodies.flatMap(({ id, body, at }) => judgeRedeclaredOwnerFields({
    packageId: id, objectExtensions: body.objectExtensions, ownerOf: (name) => owners.get(name), at,
  }).map((r) => ({
    path: r.path, code: 'VALIDATION_ERROR' as const, object: r.object, field: r.field,
    packageId: r.packageId, ownerPackageId: r.ownerPackageId, changed: r.changed, message: r.message,
  })));
}
