// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { REFERENCE_VALUE_TYPES, referenceTargetOf } from '@objectstack/spec/data';

/** One nested-relation condition a filter holds, with the object it is evaluated on. */
export interface RelationConditionSite {
  /** The reference field of the filtered object — the filter key. */
  field: string;
  /** The related object the field points at, by the spec's one arbiter (`referenceTargetOf`). */
  target: string;
  /** The condition on the related object: the plain record beneath the field. */
  condition: Record<string, unknown>;
}

/**
 * [#22646] The NESTED-RELATION conditions a filter holds — a key naming a
 * reference field of the object (`REFERENCE_VALUE_TYPES`) whose value is a
 * plain record carrying at least one non-`$` key, i.e. a condition on the
 * related object rather than an operator bag — with each site's target object.
 * Logical combinators (and any other `$` key) are walked as conditions, so a
 * site under `$or` / `$not` is found. The engine's own relation lowering
 * (`ObjectQL.lowerRelationConditions`) is the authority on whether a site RUNS;
 * this only finds what a filter would evaluate on the related object.
 *
 * [#22777] The ONE walk for every door that asks each site's target the spec's
 * exposure decision before handing the filter to the engine: the data door
 * (`@objectstack/metadata-protocol`, where it also feeds the internal-field
 * refusal) and the MCP stdio data bridge (`@objectstack/mcp`). It lives here
 * because the two doors share no other package, and a second walk is how two
 * doors come to disagree about which conditions a filter holds.
 *
 * `fields` is the filtered object's declared field map; with none, there is
 * nothing to resolve a target with and no site is found.
 */
export function relationConditionSites(
  fields: Record<string, any> | undefined,
  root: unknown,
): RelationConditionSite[] {
  const sites: RelationConditionSite[] = [];
  if (!fields || typeof fields !== 'object') return sites;
  const seen = new WeakSet<object>();
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === null || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const member of node) pending.push(member);
      continue;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.startsWith('$')) {
        pending.push(value);
        continue;
      }
      const def = fields[key];
      if (def == null || !REFERENCE_VALUE_TYPES.has(def.type) || !isPlainRecord(value)) continue;
      if (!Object.keys(value).some((k) => !k.startsWith('$'))) continue;
      const target = referenceTargetOf(def);
      if (target) sites.push({ field: key, target, condition: value });
    }
  }
  return sites;
}

/** A JSON object — not an array, not `null`. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
