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
  isRecordPageBuiltinTab,
  relatedListEntryName,
  RECORD_PAGE_BUILTIN_TABS,
  type RecordPageBuiltinTab,
  type RelatedListEntryInput,
} from '@objectstack/spec/data';
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
  const own: ObjectDoc = { ...draft, name };
  let replaced = false;
  const out: ObjectDoc[] = [];
  for (const o of objects) {
    if (!o || typeof o !== 'object') continue;
    if ((o as ObjectDoc).name === name) {
      // objectstack#35901 — the served object's package rides along, so a
      // child list another package brings is told apart (`fromPackage`).
      const served = (o as ObjectDoc)._packageId;
      out.push(own._packageId === undefined && served !== undefined ? { ...own, _packageId: served } : own);
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
  // objectstack#35901 — the parent's package (as the catalog holds it) tells a
  // child list another package brings, which the editor shows with its source.
  const packageId = catalog.find((o) => o.name === name)?._packageId;
  return deriveRelatedLists({ name, ...(packageId !== undefined ? { _packageId: packageId } : {}) }, catalog as never[], { includeHidden: true });
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

/**
 * [#35897 · #35899] The pre-write check of the object's TAB LIST
 * (`relatedLists`): keep, in order and once per name, each entry that is one
 * of the record page's built-in tabs (`sys_attachment`, `sys_approval_request`,
 * `sys_activity`) or names at least one inbound relationship. A relationship
 * entry keeps its object form (`{ list, label?, columns? }`); a built-in is
 * written as its bare name, the only spelling the spec admits. A field
 * group's `relatedList` takes no built-in, so it keeps
 * {@link acceptRelatedListEntries}.
 */
export function acceptTabListEntries(
  entries: readonly unknown[],
  all: readonly DerivedRelatedList[],
): RelatedListEntryInput[] {
  const out: RelatedListEntryInput[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = relatedListEntryName(entry);
    if (name === undefined || seen.has(name)) continue;
    if (isRecordPageBuiltinTab(name)) {
      seen.add(name);
      out.push(name);
      continue;
    }
    if (relationshipsNamedBy(name, all).length === 0) continue;
    seen.add(name);
    out.push(entry as RelatedListEntryInput);
  }
  return out;
}

/** The record page's built-in tabs, in their default order. */
export const BUILTIN_TABS: readonly RecordPageBuiltinTab[] = RECORD_PAGE_BUILTIN_TABS;

/** The i18n key naming one built-in tab. */
export function builtinTabLabelKey(name: RecordPageBuiltinTab): string {
  return `engine.studio.settings.relatedListsBuiltin.${name}`;
}

/**
 * One entry with its own title and columns: the bare name when it carries
 * neither (the spelling an entry without details is written in), else the
 * object form with only the keys that carry something.
 */
export function entryWithDetails(
  name: string,
  details: { label?: string; columns?: readonly string[] },
): RelatedListEntryInput {
  const label = details.label?.trim() ? details.label : undefined;
  const columns = details.columns && details.columns.length > 0 ? [...details.columns] : undefined;
  if (label === undefined && columns === undefined) return name;
  return { list: name, ...(label !== undefined ? { label } : {}), ...(columns !== undefined ? { columns } : {}) };
}

/** An entry's own title and columns (none for a bare name). */
export function entryDetails(entry: unknown): { label?: string; columns?: string[] } {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return {};
  const { label, columns } = entry as { label?: unknown; columns?: unknown };
  return {
    ...(typeof label === 'string' ? { label } : {}),
    ...(Array.isArray(columns) ? { columns: columns.filter((c): c is string => typeof c === 'string') } : {}),
  };
}

/**
 * The fields of the child objects one entry names, as column choices: name and
 * label, in the child's declared order (one child, or the first child when an
 * entry somehow names two). `undefined` when the catalog does not serve the
 * child's fields, so an editor cannot tell a real column from a misspelling.
 */
export function childColumnChoices(
  named: readonly DerivedRelatedList[],
  catalog: readonly ObjectDoc[],
): Array<{ name: string; label: string }> | undefined {
  const child = named[0]?.childObject;
  if (!child) return undefined;
  const doc = catalog.find((o) => o.name === child);
  const fields = doc?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  return Object.entries(fields as Record<string, unknown>).map(([name, def]) => {
    const label = def && typeof def === 'object' ? (def as { label?: unknown }).label : undefined;
    return { name, label: typeof label === 'string' && label ? label : name };
  });
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
  return React.useMemo(() => {
    const catalog = catalogWithDraft(Array.isArray(objects) ? objects : [], name, draft);
    return { catalog, relationships: inboundRelationships(name, catalog), ready };
  }, [objects, name, draft, ready]);
}
