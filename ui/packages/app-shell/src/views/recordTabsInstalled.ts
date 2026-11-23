// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * 「Configure tabs」 on an INSTALLED object (objectstack#36499, ADR-0146
 * D10): the record page's tab list the environment arranges, written as the
 * `relatedLists` of the object extension of the base's paired `.custom`
 * package (`saveObjectExtensionArrangement`), as a pure model.
 *
 * ## What the environment may arrange (the spec's `.custom` `relatedLists`)
 *
 * Every tab, whoever brings it: the object's own lists, a list another
 * package brings, and the three built-in tabs (附件, 审批, 动态), each moved to
 * any place. A related tab is hidden by writing it (`{ list, hidden: true }`);
 * a tab the list does not name still shows, after the listed ones. A built-in
 * tab is written only as its bare name and cannot be hidden there: the editor
 * moves it and offers no hide. The attachments tab shows where it shows now;
 * where the base hides it (a declared list that leaves it out), it waits in
 * the 「Hidden」 area, and naming it shows it.
 *
 * ## What is written (the whole list, explicitly)
 *
 * Every shown tab in the editor's order (a built-in by its bare name), then
 * every hidden related tab as `{ list, hidden: true }`. Nothing the editor
 * offers is left to the unlisted rule, so the page shows exactly what the
 * editor showed. An entry of the stored extension naming a list the editor
 * does not offer (a child this reader may not read) is kept as it was. A
 * tab's `label` is the stored one unless the editor renamed it: the shown
 * name is the served one, which the read translates for the reader's
 * language; its `columns` are the stored ones. "Stored" is the extension's
 * entry naming the list, else the owner's (the object's layered read): the
 * extension's list replaces the owner's whole, so an owner's title the
 * extension does not repeat would be lost.
 *
 * ## Where each tab comes from (card item 7)
 *
 * The served read does not carry a tab's source (`_relatedListsArrangement`
 * carries the arrangement's package, its hidden names and its unlisted rule,
 * nothing per tab). It is read from the child object's package as served
 * (`_packageId`) and the relationship field's name: the base's own package,
 * another package, or this environment (no package, a `.custom` package, or a
 * customer `__c` field).
 *
 * @module
 */

import {
  RELATED_LISTS_ARRANGEMENT_DECORATION,
  RECORD_PAGE_BUILTIN_TABS,
  isExtensionFieldName,
  isRecordPageBuiltinTab,
  readRelatedListsArrangement,
  relatedListEntryHidden,
  relatedListEntryName,
  type ObjectExtensionRelatedListEntryObject,
  type RelatedListsArrangement,
} from '@objectstack/spec/data';
import { isCustomizationPackage } from '@objectstack/spec/kernel';
import { deriveRelatedLists, relatedListEntryNames, type DerivedRelatedList } from '../utils/deriveRelatedLists.js';
import { entryDetails, entryWithDetails, relationshipEntry } from './studio-design/relatedListVocabulary.js';
import {
  RECORD_TABS_ATTACHMENTS,
  recordTabId,
  recordTabLabelToWrite,
  type RecordTabId,
  type RecordTabsCatalog,
  type RecordTabsDraft,
} from './recordTabsConfig.js';

type RecordTabsObjectDef = Record<string, unknown> & { name?: string };

/** The `_packageId` the server stamps on a definition bound to no package. */
const NO_PACKAGE = 'sys_metadata';

/** The package an object belongs to, as served (`_packageId`), or `null` for none. */
export function recordTabsPackageOf(objectDef: Readonly<Record<string, unknown>> | null | undefined): string | null {
  const id = objectDef?._packageId;
  return typeof id === 'string' && id && id !== NO_PACKAGE ? id : null;
}

/** Where one tab of an installed object comes from (card item 7). */
export type RecordTabSource =
  | { readonly kind: 'base' }
  | { readonly kind: 'package'; readonly packageId: string }
  | { readonly kind: 'environment' };

/**
 * Where the related tab `list` of `objectDef` comes from: this environment
 * when the child is bound to no package or to a `.custom` package, or the
 * relationship is a customer `__c` field; the base's own package when the
 * child is in the object's package; else the child's package.
 */
export function recordTabSource(
  list: Pick<DerivedRelatedList, 'childObject' | 'referenceField'>,
  objectDef: RecordTabsObjectDef,
  objects: readonly RecordTabsObjectDef[],
): RecordTabSource {
  if (isExtensionFieldName(list.referenceField)) return { kind: 'environment' };
  const child = objects.find((o) => o.name === list.childObject);
  const childPackage = recordTabsPackageOf(child);
  if (childPackage === null || isCustomizationPackage(childPackage)) return { kind: 'environment' };
  if (childPackage === recordTabsPackageOf(objectDef)) return { kind: 'base' };
  return { kind: 'package', packageId: childPackage };
}

/** The built-in tabs the editor draws for `catalog`, in the page's default order. */
export function installedBuiltinTabs(catalog: RecordTabsCatalog): RecordTabId[] {
  return RECORD_PAGE_BUILTIN_TABS.filter((name) => name !== RECORD_TABS_ATTACHMENTS || catalog.files);
}

/** The first entry of `entries` naming the related list `list`, or `undefined`. */
function namingEntry(entries: readonly unknown[] | undefined, list: DerivedRelatedList): unknown {
  return (entries ?? []).find((entry) => {
    const name = relatedListEntryName(entry);
    return name !== undefined && !isRecordPageBuiltinTab(name) && relatedListEntryNames(name, list);
  });
}

/**
 * The tabs `ids` (related ids and built-in names, in the page's built order:
 * related, then attachments, approvals, the stream) in the order the page
 * draws them under the served `entries`, and the ones it does not draw — the
 * synthesized page's own ranking (`arrangeDeclaredTabs` in
 * `@object-ui/plugin-detail`), over ids.
 */
function arrangeTabIds(
  ids: readonly RecordTabId[],
  entries: readonly unknown[],
  unlistedTabs: RelatedListsArrangement['unlisted'] | undefined,
  listOf: (id: RecordTabId) => DerivedRelatedList | undefined,
): { shown: RecordTabId[]; dropped: RecordTabId[] } {
  if (entries.length === 0 && unlistedTabs !== 'hidden') return { shown: [...ids], dropped: [] };
  const names = entries.map((entry) => relatedListEntryName(entry));
  const unlisted = names.length;
  let tail = names.length;
  while (tail > 0 && (names[tail - 1] === 'sys_approval_request' || names[tail - 1] === 'sys_activity')) tail -= 1;
  const unlistedRelated = tail < names.length ? tail - 0.5 : unlisted;
  const rank = (id: RecordTabId): number | null => {
    if (isRecordPageBuiltinTab(id)) {
      const at = names.indexOf(id);
      if (at !== -1) return at;
      if (id === RECORD_TABS_ATTACHMENTS) return unlistedTabs === 'shown' ? unlistedRelated : null;
      return id === 'sys_activity' ? unlisted + 1 : unlisted;
    }
    const list = listOf(id);
    if (!list) return unlistedRelated;
    const at = names.findIndex((name) => name !== undefined && !isRecordPageBuiltinTab(name) && relatedListEntryNames(name, list));
    return at === -1 ? unlistedRelated : at;
  };
  const ranked = ids.map((id, index) => ({ id, index, rank: rank(id) }));
  const shown = ranked
    .filter((entry): entry is { id: RecordTabId; index: number; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.id);
  return { shown, dropped: ranked.filter((entry) => entry.rank === null).map((entry) => entry.id) };
}

/**
 * The draft the editor opens on for an installed object: what the page shows
 * now. The shown related tabs are the page's own derivation of the served
 * object (the environment's arrangement applied); the built-in tabs sit where
 * the page draws them; every other related list of the catalog, and an
 * attachments tab the page does not draw, is hidden. A tab's name is the
 * served `label` of the entry naming it.
 */
export function initialInstalledTabsDraft(
  objectDef: RecordTabsObjectDef,
  objects: readonly RecordTabsObjectDef[],
  catalog: RecordTabsCatalog,
  options: { canRead?: (objectName: string) => boolean } = {},
): RecordTabsDraft {
  const derived = deriveRelatedLists(objectDef as never, objects as never[], {
    ...(options.canRead ? { canRead: options.canRead } : {}),
  });
  const byId = new Map(catalog.candidates.map((c) => [c.id, c] as const));
  const related: RecordTabId[] = [];
  for (const list of derived) {
    if (list.isPrimary && list.keepsTab !== true) continue;
    const id = recordTabId(list);
    if (byId.has(id) && !related.includes(id)) related.push(id);
  }
  const served = Array.isArray(objectDef.relatedLists) ? (objectDef.relatedLists as unknown[]) : [];
  const { shown, dropped } = arrangeTabIds(
    [...related, ...installedBuiltinTabs(catalog)],
    served,
    readRelatedListsArrangement(objectDef)?.unlisted,
    (id) => byId.get(id)?.list,
  );
  const hidden = [...catalog.candidates.map((c) => c.id).filter((id) => !related.includes(id)), ...dropped];
  const labels: Record<RecordTabId, string> = {};
  for (const candidate of catalog.candidates) {
    const { label } = entryDetails(namingEntry(served, candidate.list));
    if (label?.trim()) labels[candidate.id] = label;
  }
  return { order: shown, hidden, attachmentsHidden: false, labels };
}

/** One entry of the `.custom` extension's `relatedLists`: a bare name, or the object form (`hidden` included). */
export type InstalledTabEntry = string | ObjectExtensionRelatedListEntryObject;

/** What a save of an installed object's tabs composes over: both as stored. */
export interface InstalledTabsStored {
  /** The pair's stored extension's `relatedLists`, `undefined` when it declares none. */
  readonly extension: readonly unknown[] | undefined;
  /** The owner's stored `relatedLists` (the object's layered read), `undefined` when it declares none. */
  readonly owner: readonly unknown[] | undefined;
}

/**
 * The `.custom` extension's `relatedLists` the draft makes (see the module
 * header): the shown tabs in order, then the hidden related tabs written
 * hidden, with the stored extension's entries naming no offered list kept.
 */
export function installedTabsEntries(
  draft: RecordTabsDraft,
  catalog: RecordTabsCatalog,
  stored: InstalledTabsStored,
  initial?: RecordTabsDraft,
): InstalledTabEntry[] {
  const byId = new Map(catalog.candidates.map((c) => [c.id, c] as const));
  const storedEntry = (list: DerivedRelatedList) => namingEntry(stored.extension, list) ?? namingEntry(stored.owner, list);
  const shown: InstalledTabEntry[] = [];
  for (const id of draft.order) {
    if (isRecordPageBuiltinTab(id)) {
      if (!shown.includes(id)) shown.push(id);
      continue;
    }
    const candidate = byId.get(id);
    if (!candidate) continue;
    const details = entryDetails(storedEntry(candidate.list));
    const label = recordTabLabelToWrite(id, draft, initial, details.label);
    shown.push(entryWithDetails(relationshipEntry(candidate.list, catalog.relationships), { label, columns: details.columns }));
  }
  const hidden: InstalledTabEntry[] = [];
  for (const id of draft.hidden) {
    const candidate = byId.get(id);
    if (!candidate) continue;
    hidden.push({ list: relationshipEntry(candidate.list, catalog.relationships), hidden: true });
  }
  // A stored entry naming no list the editor offers: kept as it was.
  const kept = (stored.extension ?? []).filter((entry) => {
    const name = relatedListEntryName(entry);
    if (name === undefined || isRecordPageBuiltinTab(name)) return false;
    return !catalog.relationships.some((list) => relatedListEntryNames(name, list));
  }) as InstalledTabEntry[];
  return [
    ...shown,
    ...kept.filter((entry) => !relatedListEntryHidden(entry)),
    ...hidden,
    ...kept.filter((entry) => relatedListEntryHidden(entry)),
  ];
}

/**
 * The object as the page previews it while the editor is open on an installed
 * object: `objectDef` with the draft's shown tabs as its `relatedLists` and
 * the draft's hidden related tabs as the environment arrangement's hidden
 * names, a declared list (`unlisted: 'hidden'`), so the page draws exactly
 * the draft.
 */
export function previewInstalledTabsObject<T extends RecordTabsObjectDef>(
  objectDef: T,
  draft: RecordTabsDraft,
  catalog: RecordTabsCatalog,
): T {
  const { [RELATED_LISTS_ARRANGEMENT_DECORATION]: _arrangement, relatedLists: served, ...rest } = objectDef;
  const servedEntries = Array.isArray(served) ? (served as unknown[]) : [];
  const byId = new Map(catalog.candidates.map((c) => [c.id, c] as const));
  const relatedLists: unknown[] = [];
  for (const id of draft.order) {
    if (isRecordPageBuiltinTab(id)) {
      relatedLists.push(id);
      continue;
    }
    const candidate = byId.get(id);
    if (!candidate) continue;
    const { columns } = entryDetails(namingEntry(servedEntries, candidate.list));
    relatedLists.push(
      entryWithDetails(relationshipEntry(candidate.list, catalog.relationships), { label: draft.labels[id], columns }),
    );
  }
  const hidden = draft.hidden
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map((c) => relationshipEntry(c.list, catalog.relationships));
  const arrangement: RelatedListsArrangement = {
    packageId: readRelatedListsArrangement(objectDef)?.packageId ?? `${recordTabsPackageOf(objectDef) ?? 'object'}.custom`,
    hidden,
    unlisted: 'hidden',
  };
  return { ...rest, relatedLists, [RELATED_LISTS_ARRANGEMENT_DECORATION]: arrangement } as unknown as T;
}
