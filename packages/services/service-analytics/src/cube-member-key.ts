// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31842] The ONE rule for "which declared cube member does this spelling
 * name?", for every reader in this package that resolves one: the door's gates
 * (`declaredMemberEntry`, `analytics-service.ts`), both strategies'
 * `lookupMember`, and the structured-JSON door's measure lookup. So the member
 * a gate judges and the member a strategy compiles are the same key by
 * construction.
 *
 * A spelling names the declared key:
 *
 * 1. **verbatim** — the key itself, a declared dotted key included;
 * 2. **behind the cube's own qualifier** — `CUBE.region` or `OBJECT.region`,
 *    where `CUBE` is the cube's name and `OBJECT` the bare object its `sql`
 *    reads (a compiled dataset is named for the dataset, and both spellings
 *    have always named its base fields);
 * 3. **through its flattened key** — `vendor.region` → a declared
 *    `vendor_region` — ONLY when that key's `sql` is the same relationship
 *    path, i.e. the flat key names the related field. A flat key over a base
 *    column (a dataset dimension `vendor_region` over `region`) names a base
 *    field, and a relationship path must not answer it.
 *
 * Anything else dotted names no declared key: it is a relationship path, which
 * the dimension tier hands to the join machinery and the door's include gate
 * judges. Before this rule, `vendor.region` resolved to a declared `region` by
 * its tail alone, whatever the first segment was, so a filter on a related
 * field silently filtered the base field of the same name.
 */

import type { Cube } from '@objectstack/spec/data';

/** A cube's member bag, read only for its entries' `sql`. */
type MemberBag = Readonly<Record<string, { sql?: unknown } | undefined>> | undefined;

/** Whether `segment` is the cube's own qualifier: its name, or the bare object its `sql` reads. */
function isOwnQualifier(cube: Cube, segment: string): boolean {
  if (segment === cube.name) return true;
  return typeof cube.sql === 'string' && cube.sql.trim() === segment;
}

/** The relationship path an entry's `sql` reads, with the engine's `$` field sigil dropped. */
function pathOf(entry: { sql?: unknown }): string | undefined {
  return typeof entry.sql === 'string' ? entry.sql.trim().replace(/^\$/, '') : undefined;
}

/**
 * The key of `bag` that `member` names under the rule above, or `undefined`
 * when it names none. ⛔ No synthetic tier here: what an undeclared spelling
 * becomes is each caller's business, and only the dimension resolution turns
 * a dotted one into a relationship path.
 */
export function declaredCubeMemberKey(cube: Cube, bag: MemberBag, member: string): string | undefined {
  if (!bag) return undefined;
  if (bag[member]) return member;
  const dot = member.indexOf('.');
  if (dot < 0) return undefined;
  const tail = member.slice(dot + 1);
  if (isOwnQualifier(cube, member.slice(0, dot)) && bag[tail]) return tail;
  const flat = member.replace(/\./g, '_');
  const flatEntry = bag[flat];
  if (flatEntry && pathOf(flatEntry) === member) return flat;
  return undefined;
}
