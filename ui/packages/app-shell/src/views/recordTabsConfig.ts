// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record page's tab configuration (objectstack#36499): what an
 * administrator arranges in place from the record's 「…」 → 「Configure tabs」,
 * as a pure model — which tabs the editor offers, the draft it edits, and the
 * object's `relatedLists` a save writes from it.
 *
 * ## What a tab is here
 *
 * The record page's tabs after the overview are its related lists, then
 * 附件, 审批 and 动态 (`buildDefaultTabs`, `RecordPageColumns`). The editor
 * offers:
 *
 *  - every related list that is, or can be, a tab of the page: a side list,
 *    and a body table a field group makes one (`keepsTab`), each by its
 *    relationship id `child.field` — the id the reader's own arrangement and
 *    the page's `?related=` use. A list whose FK says `relatedList: false`,
 *    a child the API does not serve and a `relatedList: 'primary'` table are
 *    no tab of the page whatever `relatedLists` says, so they are not offered;
 *  - the attachments tab, where the object enables files: shown or hidden;
 *  - 审批 and 动态 are drawn by the page where it has them, last, and an
 *    object's own `relatedLists` cannot hide either (leaving one out never
 *    hides it): the editor shows them fixed.
 *
 * A list another package brings (objectstack#35901) is placed by that package
 * and is not hidden by this object's list, so it is shown fixed, with its
 * source, as the design mode's menu shows another package's entry.
 *
 * ## What is written (ADR-0146 D10 note: an object's own list hides by leaving out)
 *
 * The object's own `relatedLists` is its tab list: the lists it names are the
 * tabs, in its order; a side list of the object's own package it does not
 * name is no tab; the attachments tab shows only when named. So a save writes
 * every shown tab the editor arranges, in its order, and leaves a hidden one
 * out. An entry the editor does not arrange — a built-in 审批 / 动态 name, an
 * entry naming a list the editor does not offer (another package's, a child
 * this reader may not read) — is kept, after the entry it followed
 * ({@link recordTabsEntries}). An entry's own `columns` are kept; its `label`
 * is the tab's name the editor holds.
 *
 * Written over the object as STORED (the layered read), never as served:
 * see `recordTabsConfigSave.ts`.
 *
 * @module
 */

import {
  isRecordPageBuiltinTab,
  relatedListEntryName,
  type RelatedListEntryInput,
} from '@objectstack/spec/data';
import { deriveRelatedLists, relatedListEntryNames, type DerivedRelatedList } from '../utils/deriveRelatedLists.js';
import { entryDetails, entryWithDetails, relationshipEntry } from './studio-design/relatedListVocabulary.js';

/** A related tab's id: its relationship, `child.field`. */
export type RecordTabId = string;

/** The record page's attachments tab, by the built-in name an entry gives it. */
export const RECORD_TABS_ATTACHMENTS = 'sys_attachment';

/** One related tab the editor offers. */
export interface RecordTabCandidate {
  readonly id: RecordTabId;
  readonly list: DerivedRelatedList;
  /** The package that brings this list, when it is another package than the object's: fixed here. */
  readonly fromPackage?: string;
}

/** What the editor offers for one object. */
export interface RecordTabsCatalog {
  /** Every related tab the editor offers, in the derived order (no declared list read). */
  readonly candidates: readonly RecordTabCandidate[];
  /** Every inbound relationship, for an entry's spelling (`relationshipEntry`). */
  readonly relationships: readonly DerivedRelatedList[];
  /** The object enables files: the attachments tab exists. */
  readonly files: boolean;
}

/** The arrangement the editor holds. */
export interface RecordTabsDraft {
  /** The shown related tabs the editor arranges, in order (another package's lists are not among them). */
  readonly order: readonly RecordTabId[];
  /** The hidden related tabs (the 「Hidden」 area), in the order they were hidden. */
  readonly hidden: readonly RecordTabId[];
  /** The attachments tab is hidden (meaningful only where the object enables files). */
  readonly attachmentsHidden: boolean;
  /** A related tab's own name (the entry's `label`), by id. A tab not here takes its derived name. */
  readonly labels: Readonly<Record<RecordTabId, string>>;
}

type ObjectLike = Record<string, unknown> & { name?: string };

/** The id of a derived list. */
export function recordTabId(list: Pick<DerivedRelatedList, 'childObject' | 'referenceField'>): RecordTabId {
  return `${list.childObject}.${list.referenceField}`;
}

/** Can this list be a tab of the record page (see the module header)? */
function canBeTab(list: DerivedRelatedList): boolean {
  return !list.isHidden && (!list.isPrimary || list.keepsTab === true);
}

/**
 * The catalog for `objectDef` (as served) among `objects`. The derivation is
 * the record page's own, asked with `includeHidden` over the object with no
 * declared list, so every list that could be a tab is in it, in the derived
 * order; `canRead` drops what the reader may not read, as the page does.
 */
export function recordTabsCatalog(
  objectDef: ObjectLike,
  objects: readonly ObjectLike[],
  options: { canRead?: (objectName: string) => boolean } = {},
): RecordTabsCatalog {
  // The object with no declared list: every list that could be a tab is
  // derived (its field groups still decide which tables keep a tab).
  const { relatedLists: _declared, _relatedListsArrangement: _arrangement, ...undeclared } = objectDef;
  const relationships = deriveRelatedLists(undeclared as never, objects as never[], {
    includeHidden: true,
    ...(options.canRead ? { canRead: options.canRead } : {}),
  });
  const candidates: RecordTabCandidate[] = [];
  for (const list of relationships) {
    if (!canBeTab(list)) continue;
    candidates.push({ id: recordTabId(list), list, ...(list.fromPackage ? { fromPackage: list.fromPackage } : {}) });
  }
  const enable = (objectDef.enable ?? {}) as { files?: unknown };
  return { candidates, relationships, files: enable.files === true };
}

/** The first declared entry naming `list`, or `undefined`. */
function namingEntry(entries: readonly unknown[], list: DerivedRelatedList): unknown {
  return entries.find((entry) => {
    const name = relatedListEntryName(entry);
    return name !== undefined && !isRecordPageBuiltinTab(name) && relatedListEntryNames(name, list);
  });
}

/**
 * The draft the editor opens on: what the page shows now. The shown related
 * tabs and their order are the page's own derivation of `objectDef`
 * (`deriveRelatedLists`, the record page's); the rest of the catalog is
 * hidden; a tab's name is the `label` of the entry naming it.
 */
export function initialRecordTabsDraft(
  objectDef: ObjectLike,
  objects: readonly ObjectLike[],
  catalog: RecordTabsCatalog,
  options: { canRead?: (objectName: string) => boolean } = {},
): RecordTabsDraft {
  const shown = deriveRelatedLists(objectDef as never, objects as never[], {
    ...(options.canRead ? { canRead: options.canRead } : {}),
  });
  // Another package's list is placed by that package: drawn fixed after the
  // arranged tabs, never in the draft.
  const arranged = catalog.candidates.filter((c) => c.fromPackage === undefined);
  const offered = new Set(arranged.map((c) => c.id));
  const order: RecordTabId[] = [];
  for (const list of shown) {
    const id = recordTabId(list);
    // A body table with no tab now (a declared list leaves it out) is hidden.
    if (list.isPrimary && list.keepsTab !== true) continue;
    if (offered.has(id) && !order.includes(id)) order.push(id);
  }
  const hidden = arranged.map((c) => c.id).filter((id) => !order.includes(id));
  const declared = Array.isArray(objectDef.relatedLists) ? (objectDef.relatedLists as unknown[]) : [];
  const labels: Record<RecordTabId, string> = {};
  for (const candidate of arranged) {
    const { label } = entryDetails(namingEntry(declared, candidate.list));
    if (label?.trim()) labels[candidate.id] = label;
  }
  const attachmentsHidden =
    catalog.files && declared.length > 0 && !declared.some((entry) => relatedListEntryName(entry) === RECORD_TABS_ATTACHMENTS);
  return { order, hidden, attachmentsHidden, labels };
}

/** Whether two drafts hold the same arrangement. */
export function sameRecordTabsDraft(a: RecordTabsDraft, b: RecordTabsDraft): boolean {
  const sameList = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
  const keys = (r: Readonly<Record<string, string>>) => Object.keys(r).sort();
  return (
    sameList(a.order, b.order) &&
    sameList([...a.hidden].sort(), [...b.hidden].sort()) &&
    a.attachmentsHidden === b.attachmentsHidden &&
    sameList(keys(a.labels), keys(b.labels)) &&
    keys(a.labels).every((k) => a.labels[k] === b.labels[k])
  );
}

/** One edit of the draft. */
export type RecordTabsEdit =
  | { kind: 'move'; id: RecordTabId; to: number }
  | { kind: 'hide'; id: RecordTabId }
  | { kind: 'restore'; id: RecordTabId }
  | { kind: 'rename'; id: RecordTabId; label: string | undefined }
  | { kind: 'attachments'; hidden: boolean };

/**
 * The draft after `edit`. A move takes a shown tab to index `to` of the shown
 * order; a hide takes it to the hidden area; a restore puts it back at the end
 * of the shown order; a rename with no (or a blank) label gives the tab its
 * derived name again.
 */
export function editRecordTabsDraft(draft: RecordTabsDraft, edit: RecordTabsEdit): RecordTabsDraft {
  switch (edit.kind) {
    case 'move': {
      const from = draft.order.indexOf(edit.id);
      if (from < 0) return draft;
      const order = draft.order.filter((id) => id !== edit.id);
      order.splice(Math.max(0, Math.min(edit.to, order.length)), 0, edit.id);
      return { ...draft, order };
    }
    case 'hide':
      if (!draft.order.includes(edit.id)) return draft;
      return { ...draft, order: draft.order.filter((id) => id !== edit.id), hidden: [...draft.hidden, edit.id] };
    case 'restore':
      if (!draft.hidden.includes(edit.id)) return draft;
      return { ...draft, order: [...draft.order, edit.id], hidden: draft.hidden.filter((id) => id !== edit.id) };
    case 'rename': {
      const labels = { ...draft.labels };
      const label = edit.label?.trim();
      if (label) labels[edit.id] = label;
      else delete labels[edit.id];
      return { ...draft, labels };
    }
    case 'attachments':
      return { ...draft, attachmentsHidden: edit.hidden };
    default:
      return draft;
  }
}

/**
 * The object's `relatedLists` the draft makes, written over `base` (the
 * object's stored `relatedLists`): `undefined` when nothing is to be declared
 * (no tab arranged, none hidden: the automatic list).
 *
 *  - Each shown related tab the editor arranges, in its order, as Studio
 *    spells an entry (`relationshipEntry`: the child, or `child.field` where
 *    the child points here more than once), with the `columns` of the base
 *    entry that named it and the draft's name for it.
 *  - The attachments tab where the object enables files and it is shown:
 *    at the base entry's place, else after the related tabs.
 *  - Every other base entry: the built-in 审批 / 动态 names, and an entry
 *    naming no list the editor arranges. One that came after every arranged
 *    entry stays at the end; any other is kept after the base entry it
 *    followed. A base entry naming a list the editor arranges (shown or
 *    hidden) is replaced by the above.
 *  - Where that leaves nothing although a tab is hidden, 审批 and 动态 are
 *    named, so the list is a declared one: an empty `relatedLists` reads as
 *    "none declared", every list shown.
 */
export function recordTabsEntries(
  draft: RecordTabsDraft,
  base: readonly unknown[] | undefined,
  catalog: RecordTabsCatalog,
): RelatedListEntryInput[] | undefined {
  const baseEntries = Array.isArray(base) ? base : [];
  const arranged = catalog.candidates.filter((c) => c.fromPackage === undefined);
  const arrangedById = new Map(arranged.map((c) => [c.id, c] as const));
  /** The base entry (index) naming `list` first, or -1. */
  const baseIndexOf = (list: DerivedRelatedList): number =>
    baseEntries.findIndex((entry) => {
      const name = relatedListEntryName(entry);
      return name !== undefined && !isRecordPageBuiltinTab(name) && relatedListEntryNames(name, list);
    });
  /** Does the base entry name a list the editor arranges, or the attachments tab? */
  const handled = (entry: unknown): boolean => {
    const name = relatedListEntryName(entry);
    if (name === undefined) return false;
    if (name === RECORD_TABS_ATTACHMENTS) return catalog.files;
    if (isRecordPageBuiltinTab(name)) return false;
    return arranged.some((c) => relatedListEntryNames(name, c.list));
  };

  const out: Array<{ entry: RelatedListEntryInput; baseIndex: number }> = [];
  for (const id of draft.order) {
    const candidate = arrangedById.get(id);
    if (!candidate) continue;
    const at = baseIndexOf(candidate.list);
    const { columns } = entryDetails(at >= 0 ? baseEntries[at] : undefined);
    const name = relationshipEntry(candidate.list, catalog.relationships);
    out.push({ entry: entryWithDetails(name, { label: draft.labels[id], columns }), baseIndex: at });
  }
  // Each base entry kept: one past the last related entry the editor
  // arranges stays at the end; any other after the entry that followed the
  // base entry before it.
  const attachmentsAt = baseEntries.findIndex((entry) => relatedListEntryName(entry) === RECORD_TABS_ATTACHMENTS);
  const showsAttachments = catalog.files && !draft.attachmentsHidden;
  let lastArranged = -1;
  baseEntries.forEach((entry, index) => {
    if (handled(entry) && index !== attachmentsAt) lastArranged = index;
  });
  baseEntries.forEach((entry, index) => {
    const keep = index === attachmentsAt ? showsAttachments : !handled(entry);
    if (!keep) return;
    const name = relatedListEntryName(entry);
    if (name === undefined) return;
    const kept = { entry: isRecordPageBuiltinTab(name) ? name : (entry as RelatedListEntryInput), baseIndex: index };
    if (index > lastArranged) {
      out.push(kept);
      return;
    }
    let at = 0;
    for (let back = index - 1; back >= 0; back -= 1) {
      let last = -1;
      out.forEach((item, position) => {
        if (item.baseIndex === back) last = position;
      });
      if (last >= 0) {
        at = last + 1;
        break;
      }
    }
    out.splice(at, 0, kept);
  });
  if (showsAttachments && attachmentsAt < 0 && (out.length > 0 || draft.hidden.length > 0)) {
    // After the related tabs, ahead of a trailing 审批 / 动态.
    let at = out.length;
    while (at > 0) {
      const name = relatedListEntryName(out[at - 1].entry);
      if (name !== 'sys_approval_request' && name !== 'sys_activity') break;
      at -= 1;
    }
    out.splice(at, 0, { entry: RECORD_TABS_ATTACHMENTS, baseIndex: -1 });
  }
  const entries = out.map((item) => item.entry);
  if (entries.length > 0) return entries;
  if (draft.hidden.length > 0 || (catalog.files && draft.attachmentsHidden)) return ['sys_approval_request', 'sys_activity'];
  return undefined;
}

/**
 * The object as the page previews it while the editor is open: `objectDef`
 * with the draft's `relatedLists` written over its served one, and no
 * environment arrangement (an object of a writable package has none).
 */
export function previewRecordTabsObject<T extends ObjectLike>(
  objectDef: T,
  draft: RecordTabsDraft,
  catalog: RecordTabsCatalog,
): T {
  const { _relatedListsArrangement: _arrangement, relatedLists: served, ...rest } = objectDef;
  const entries = recordTabsEntries(draft, Array.isArray(served) ? (served as unknown[]) : undefined, catalog);
  return (entries ? { ...rest, relatedLists: entries } : rest) as T;
}
