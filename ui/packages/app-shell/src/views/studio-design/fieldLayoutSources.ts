// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36505 (ADR-0146 D3, D10) — where each field of an INSTALLED
 * object comes from, as the Field layout canvas marks it: the original
 * package, another package, or this environment. Pure, so the rule is pinned
 * without a render.
 *
 * The facts it reads, and only those:
 *
 * - another package: the base's one customization read (`contributions`, a
 *   `field` entry stamped with its package), the map `contributedFieldsOf`
 *   builds. The canvas draws that field with the contributed mark, which
 *   names the package, so this answer leaves it out;
 * - this environment: a field the pair's `.custom` extension declares (its
 *   buffer's `fields`, and the ones its published row declared), and any
 *   customer `__c` field, which only a `.custom` package may declare;
 * - the original package: every other field the object carries.
 *
 * Field groups are not marked: the served object carries no per-group source
 * (the registry fold records who placed a group, and no read serves it), so a
 * group's source would be a guess.
 *
 * @module
 */

import { isExtensionFieldName } from '@objectstack/spec/data';
import { readFields } from '../metadata-admin/previews/object-fields-io.js';
import type { FieldLayoutSource } from './ObjectFormDesigner.js';

/** Each field's source, by name; a contributed field is absent (its own mark names it). */
export function fieldLayoutSourcesOf(
  fields: unknown,
  facts: { contributed: ReadonlyMap<string, unknown>; environment: Iterable<string> },
): ReadonlyMap<string, FieldLayoutSource> {
  const environment = new Set(facts.environment);
  const out = new Map<string, FieldLayoutSource>();
  for (const { name } of readFields(fields).entries) {
    if (facts.contributed.has(name)) continue;
    out.set(name, environment.has(name) || isExtensionFieldName(name) ? 'environment' : 'base');
  }
  return out;
}
