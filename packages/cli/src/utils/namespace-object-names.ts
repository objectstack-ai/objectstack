// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D6, child K] `os validate`'s and `os build`'s half of the rule
 * that a namespace never equals an object name, in either direction, and that
 * no package ships an object short-named `custom` (`NS_custom`, the namespace
 * the ADR-0146 paired package of `NS` takes).
 *
 * ## One judge, not a second rule
 *
 * The predicate and its sentences are the spec's
 * (`findNamespaceObjectNameClashes`, `@objectstack/spec/kernel`) — the SAME
 * call the package door (`SchemaRegistry.installPackage`), the Studio publish
 * and save doors and `defineStack` make. What this module owns is the WALK:
 * which namespaces and which objects one artifact holds.
 *
 * ## What one artifact holds
 *
 * Every namespace it declares (each `packages[]` body's, and the stack's own
 * `manifest.namespace`) and every object it ships (each body's `objects`, and
 * the top level's — a stack with no `packages[]` is its own one package, and
 * a `packages[]` stack's top-level objects register under its own manifest).
 * All of it is judged as one incoming catalogue, so a namespace of one body
 * equal to an object of another is refused in either order.
 *
 * ⚠️ Bounds, stated rather than hidden: the packages and objects a deployment
 * already holds are not visible here (that half is the install and publish
 * doors' alone), and a declared dependency carries an id and a range, never a
 * namespace, so a dependency outside this artifact is not judged — its
 * namespace is never guessed from its id.
 */

import { resolveArtifactPackageOrder } from '@objectstack/core';
import {
  findNamespaceObjectNameClashes,
  type NamespaceHolder,
  type NamespaceObjectNameClash,
  type ObjectNameHolder,
} from '@objectstack/spec/kernel';

/**
 * One refused clash: the predicate's own row (`kind`, both spellings, and its
 * sentence, verbatim). No wire code: these commands answer no request; the
 * install and publish doors refuse the same clash `NAMESPACE_CONFLICT` / 422.
 */
export type NamespaceObjectNameRefusalRow = NamespaceObjectNameClash;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const stringOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** The object names a body ships, the way the load path names them (`name`, else the map key). */
function objectNamesOf(body: Record<string, unknown>): string[] {
  const out: string[] = [];
  const collect = (objects: unknown): void => {
    if (Array.isArray(objects)) {
      for (const o of objects) {
        const name = stringOf(asRecord(o)?.name);
        if (name) out.push(name);
      }
    } else if (asRecord(objects)) {
      for (const key of Object.keys(objects as Record<string, unknown>)) if (key !== '') out.push(key);
    }
  };
  collect(body.objects);
  if (Array.isArray(body.plugins)) for (const plugin of body.plugins) collect(asRecord(plugin)?.objects);
  return out;
}

/**
 * Every clash between one artifact's namespaces and its object names, and
 * every object it ships short-named `custom`. `[]` for a stack the doors
 * accept on this axis.
 */
export function findNamespaceObjectNameRefusals(parsed: Record<string, unknown>): NamespaceObjectNameRefusalRow[] {
  const namespaces: NamespaceHolder[] = [];
  const objects: ObjectNameHolder[] = [];
  const seenNamespaces = new Set<string>();
  const seenObjects = new Set<string>();

  const hold = (body: Record<string, unknown>, fallbackNamespace?: string): void => {
    const packageId = stringOf(body.id) ?? stringOf(body.name);
    const namespace = stringOf(body.namespace) ?? fallbackNamespace;
    if (namespace && !seenNamespaces.has(namespace)) {
      seenNamespaces.add(namespace);
      namespaces.push({ namespace, ...(packageId ? { packageId } : {}) });
    }
    for (const name of objectNamesOf(body)) {
      if (seenObjects.has(name)) continue;
      seenObjects.add(name);
      objects.push({ name, ...(namespace ? { namespace } : {}), ...(packageId ? { packageId } : {}) });
    }
  };

  if (parsed.packages !== undefined) {
    for (const body of resolveArtifactPackageOrder(parsed)) {
      const record = asRecord(body);
      if (record) hold(record);
    }
  }
  // The stack's own manifest and its top-level objects: the one package of a
  // stack with no `packages[]`, the residual's owner of a stack with them.
  const manifest = asRecord(parsed.manifest) ?? {};
  hold({ ...manifest, objects: parsed.objects, plugins: undefined }, stringOf(manifest.namespace));

  return findNamespaceObjectNameClashes({ namespaces, objects });
}
