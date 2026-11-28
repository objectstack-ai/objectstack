// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { relatedListEntryHidden, relatedListEntryName, relatedListNameCovers } from '@objectstack/spec/data';

import type { VisibleObjectExtension } from './object-graph.js';

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * [#37622] The record-page tab titles of one object, as the registry serves
 * them: which `_relatedLists.LIST.label` keys a translation can address.
 *
 * - `labels`: each list that is served with a `label`, the label it is served
 *   with, and the layer that wrote it — the owner's `relatedLists`, a code
 *   extender's `place` entry, or the paired `.custom` arrangement
 *   (`objectExtensions[].relatedLists`, ADR-0146 D10).
 * - `names`: every list any layer names, labelled or not.
 * - `hidden`: the lists an arrangement hides (`{ list, hidden: true }`).
 * - `stripped`: the lists whose label (the owner's or a placement's) an
 *   arrangement entry replaced with none.
 *
 * Built by {@link addOwnerRelatedLists} and then
 * {@link foldRelatedListExtensions}: the ONE fold both readers of a
 * `_relatedLists` key use, so the key `os i18n extract` / `os i18n check`
 * expect is the key `os validate` accepts (`i18n-walk.ts`,
 * `validate-translation-references.ts`). It lives in its own module, beside
 * `object-graph.ts` rather than in it: that file's receivers are tabled by
 * the security-posture rule's key-read meta-test, which this fold is no part of.
 */
export interface RelatedListTitles {
  labels: Map<string, { label: string; layer: 'owner' | 'place' | 'arrangement' }>;
  names: Set<string>;
  hidden: Set<string>;
  stripped: Set<string>;
}

/** An empty {@link RelatedListTitles}. */
export function emptyRelatedListTitles(): RelatedListTitles {
  return { labels: new Map(), names: new Set(), hidden: new Set(), stripped: new Set() };
}

/** A non-empty `label` string of a record entry, or `undefined`. */
function entryLabel(entry: unknown): string | undefined {
  if (!isRec(entry)) return undefined;
  return typeof entry.label === 'string' && entry.label.length > 0 ? entry.label : undefined;
}

/**
 * Fold an owner declaration's `relatedLists` into `titles`: every list it
 * names (a bare string, an object entry, a built-in tab), and the label of
 * each object-form entry that authors one — the only entries
 * `translateObject` overlays a `_relatedLists` key onto. A later declaration
 * of the same list replaces an earlier one's label.
 */
export function addOwnerRelatedLists(titles: RelatedListTitles, entries: unknown): void {
  for (const entry of Array.isArray(entries) ? entries : []) {
    const list = typeof entry === 'string' ? entry : isRec(entry) ? strName(entry.list) : undefined;
    if (!list) continue;
    titles.names.add(list);
    const label = entryLabel(entry);
    if (label !== undefined) titles.labels.set(list, { label, layer: 'owner' });
  }
}

/**
 * Fold the extensions of one target ({@link objectExtensionsByTarget}, in fold
 * order) into `titles`, after its owner's lists, as the registry folds them.
 *
 * 1. Every extension's list placements (`place` entries naming a `list`), in
 *    fold order; a list already labelled keeps that label. A placement on a
 *    target that declares no `relatedLists`, or on a list the owner already
 *    names, is not applied by the registry; this fold takes its label all the
 *    same, the accepting direction (`layer: 'place'` marks it for a reader
 *    that must not ask for it).
 * 2. Then every extension's `.custom` arrangement (`registry-custom-arrangement.ts`
 *    in `@objectstack/objectql`): each entry REPLACES every entry it covers
 *    (`relatedListNameCovers`: the same list, or a bare child for each list of
 *    that child). A labelled entry titles the tab; a bare name or an unlabelled
 *    entry leaves it the child FK's `relatedListTitle`; `{ list, hidden: true }`
 *    leaves no tab. Two passes per arrangement, as the registry reads one: its
 *    entries first drop what they cover, then add their own labels and hidden
 *    lists, so one entry never strips what a sibling entry of the SAME
 *    arrangement wrote, in either order.
 */
export function foldRelatedListExtensions(
  titles: RelatedListTitles,
  extensions: readonly VisibleObjectExtension[],
): void {
  for (const extension of extensions) {
    const arranged = new Set<unknown>(extension.relatedListArrangement ?? []);
    for (const entry of extension.relatedListEntries) {
      if (arranged.has(entry)) continue;
      const list = strName(entry.list);
      if (!list) continue;
      titles.names.add(list);
      const label = entryLabel(entry);
      // The registry splices a placement in only where the list is not there
      // yet, so a label the owner (or an earlier placement) gives is kept.
      if (label !== undefined && !titles.labels.has(list)) titles.labels.set(list, { label, layer: 'place' });
    }
  }
  for (const extension of extensions) {
    const arrangement = (extension.relatedListArrangement ?? [])
      .map((entry) => ({ entry, list: relatedListEntryName(entry) }))
      .filter((e): e is { entry: unknown; list: string } => typeof e.list === 'string' && e.list !== '');
    for (const { list } of arrangement) {
      titles.names.add(list);
      for (const labelled of [...titles.labels.keys()]) {
        if (!relatedListNameCovers(list, labelled)) continue;
        titles.labels.delete(labelled);
        titles.stripped.add(labelled);
      }
      for (const hidden of [...titles.hidden]) {
        if (relatedListNameCovers(list, hidden)) titles.hidden.delete(hidden);
      }
    }
    for (const { entry, list } of arrangement) {
      if (relatedListEntryHidden(entry)) {
        titles.hidden.add(list);
        continue;
      }
      const label = entryLabel(entry);
      if (label === undefined) continue;
      titles.labels.set(list, { label, layer: 'arrangement' });
      titles.stripped.delete(list);
    }
  }
}
