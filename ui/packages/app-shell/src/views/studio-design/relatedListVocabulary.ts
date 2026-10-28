/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The words Studio may write into an object's `relatedLists` and a field
 * group's `relatedList` (objectstack#27069): the object's INBOUND
 * relationships — every `lookup` / `master_detail` field of a child object
 * whose `reference` is this object.
 *
 * ⛔ No second relationship enumeration lives here. The list is
 * `deriveRelatedLists` — the record page's own derivation — asked with
 * `includeHidden`, so the editor offers exactly the relationships the record
 * page reads, plus the ones a FK hides with `relatedList: false` (an entry may
 * still name those: the spec's `defineStack` check and `packages/lint`
 * `validate-related-list-refs` both count them, and both skip the audit FKs
 * the derivation skips).
 *
 * Entry grammar: every name this module writes is the child object's name or
 * `child.field`, both taken from a real object and field, so it is the
 * snake_case machine-name grammar the spec's entry pattern describes by
 * construction — no second copy of that pattern is kept here.
 */

import React from 'react';
import { useMetadata } from '@object-ui/react';
import {
  deriveRelatedLists,
  relatedListEntryNames,
  type DerivedRelatedList,
} from '../../utils/deriveRelatedLists.js';

type ObjectDoc = Record<string, unknown>;

/**
 * The object catalog the record page derives from, with THIS object's draft in
 * its place (or appended, for an object not yet served), so a self-reference
 * the draft adds is an inbound relationship too.
 */
export function catalogWithDraft(objects: readonly unknown[], name: string, draft: ObjectDoc): ObjectDoc[] {
  const own = { ...draft, name };
  let replaced = false;
  const out: ObjectDoc[] = [];
  for (const o of objects) {
    if (!o || typeof o !== 'object') continue;
    if ((o as ObjectDoc).name === name) {
      out.push(own);
      replaced = true;
    } else {
      out.push(o as ObjectDoc);
    }
  }
  if (!replaced) out.push(own);
  return out;
}

/** Every inbound relationship of `name`, hidden ones included, in the derived order. */
export function inboundRelationships(name: string, catalog: readonly ObjectDoc[]): DerivedRelatedList[] {
  // The derived order is the order with NO declared entries: the stored
  // `relatedLists` must not reorder the vocabulary it is judged against.
  return deriveRelatedLists({ name }, catalog as never[], { includeHidden: true });
}

/**
 * How Studio spells one relationship as an entry: the child object name, or
 * `child.field` when that child points here through more than one FK — the
 * spelling the spec's refusal lists the inbound relationships in.
 */
export function relationshipEntry(list: DerivedRelatedList, all: readonly DerivedRelatedList[]): string {
  const siblings = all.filter((r) => r.childObject === list.childObject).length;
  return siblings > 1 ? `${list.childObject}.${list.referenceField}` : list.childObject;
}

/** The relationships one entry names (empty: the entry names none of them). */
export function relationshipsNamedBy(entry: string, all: readonly DerivedRelatedList[]): DerivedRelatedList[] {
  return all.filter((list) => relatedListEntryNames(entry, list));
}

/**
 * The pre-write check: keep, in order, each entry that names at least one
 * inbound relationship, once. An entry naming none would be refused by the
 * spec at `defineStack` and by the publish door's lint, so it never enters a
 * value Studio writes.
 */
export function acceptRelatedListEntries(
  entries: readonly string[],
  all: readonly DerivedRelatedList[],
): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    if (out.includes(entry)) continue;
    if (relationshipsNamedBy(entry, all).length === 0) continue;
    out.push(entry);
  }
  return out;
}

/** What a related list is called in an editor row: its title, else the child's label. */
export function relationshipLabel(list: DerivedRelatedList): string {
  return list.title || list.childLabel;
}

export interface RelatedListCatalog {
  /** The catalog with this object's draft in place. */
  catalog: ObjectDoc[];
  /** Every inbound relationship, hidden ones included, in the derived order. */
  relationships: DerivedRelatedList[];
  /**
   * The served object list has answered. Until it has, a stored entry naming
   * another object's FK cannot be told from a misspelling, so editors write
   * nothing (a write would drop entries the catalog has not shown yet).
   */
  ready: boolean;
}

/**
 * The inbound-relationship catalog for one object, from the console's metadata
 * store (the whole served object registry: any package's object may point in).
 * Read only while an editor that needs it is mounted.
 */
export function useRelatedListCatalog(name: string, draft: ObjectDoc): RelatedListCatalog {
  const metadata = useMetadata();
  // Read the list first: on the console's store the read is what asks for it.
  const objects = metadata.objects;
  const ready = (metadata.getTypeStatus?.('object') ?? 'ready') === 'ready';
  const list = Array.isArray(objects) ? objects : [];
  return React.useMemo(() => {
    const catalog = catalogWithDraft(list, name, draft);
    return { catalog, relationships: inboundRelationships(name, catalog), ready };
  }, [list, name, draft, ready]);
}
