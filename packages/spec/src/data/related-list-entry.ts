// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35897 · #35899] The words an `ObjectSchema.relatedLists` entry may say,
 * and the one reading of an entry's name.
 *
 * Since #35897 a declared `relatedLists` is the record page's TAB LIST: only
 * the relationships it names are shown as tabs, in its order. Three of its
 * words are not relationships but the record page's three BUILT-IN tabs,
 * named by the platform object each one draws:
 *
 *  - `sys_attachment` — the attachments tab (file rows), drawn only when the
 *    object enables files (`enable.files`);
 *  - `sys_approval_request` — the approvals tab (approval steps), drawn only
 *    when the record has approval requests;
 *  - `sys_activity` — the activity stream tab: ONE stream merging the
 *    activities, the discussion and the field changes (each part still
 *    switched by the object's own `enable` keys and `trackHistory`).
 *
 * A built-in is drawn by its own renderer, never queried as a child table, so
 * it is written only as its bare name: an object entry naming one is refused
 * at parse (it would carry a label or columns no built-in renderer reads).
 *
 * `sys_comment` and `sys_audit_log` are parts of the activity stream, not tabs
 * of their own; an entry naming one draws nothing, so `@objectstack/lint`
 * (`validate-related-list-refs`) warns and prescribes `sys_activity`.
 *
 * Readers: the record page (objectui `deriveRelatedLists` and the synthesized
 * page's tab list), Studio's related-list editor, `defineStack`'s name check
 * and the lint rule, each through these exports, so no second list exists.
 */

import type { MetadataReadDecoration } from '../kernel/metadata-read-decorations';

/** The record page's three built-in tabs, by the platform object each draws, in their default order. */
export const RECORD_PAGE_BUILTIN_TABS = ['sys_attachment', 'sys_approval_request', 'sys_activity'] as const;

/** One of the record page's built-in tab names. */
export type RecordPageBuiltinTab = (typeof RECORD_PAGE_BUILTIN_TABS)[number];

const BUILTIN_TAB_SET: ReadonlySet<string> = new Set(RECORD_PAGE_BUILTIN_TABS);

/** Is `name` one of the record page's built-in tabs (`sys_attachment`, `sys_approval_request`, `sys_activity`)? */
export function isRecordPageBuiltinTab(name: unknown): name is RecordPageBuiltinTab {
  return typeof name === 'string' && BUILTIN_TAB_SET.has(name);
}

/**
 * The platform objects that are PARTS of a built-in tab rather than tabs of
 * their own, each mapped to the built-in that draws it.
 */
export const RELATED_LIST_BUILTIN_PART_OF: Readonly<Record<string, RecordPageBuiltinTab>> = Object.freeze({
  sys_comment: 'sys_activity',
  sys_audit_log: 'sys_activity',
});

/** One `relatedLists` entry in its object form: the relationship named, with its own title and columns. */
export interface RelatedListEntryObject {
  readonly list: string;
  readonly label?: string;
  readonly columns?: readonly string[];
}

/** One `relatedLists` entry: the bare name, or the object form. */
export type RelatedListEntryInput = string | RelatedListEntryObject;

/**
 * [ADR-0146 D10] One entry of the paired `.custom` package's
 * `ObjectExtensionSchema.relatedLists`, in its object form: the object's entry
 * plus `hidden`. Only that arrangement writes `hidden`; an object's own
 * `relatedLists` hides a tab by leaving it out.
 */
export interface ObjectExtensionRelatedListEntryObject extends RelatedListEntryObject {
  readonly hidden?: boolean;
}

/**
 * The name one `relatedLists` entry gives: the bare string itself, or the
 * object form's `list`. `undefined` for anything else (a value the parse
 * refuses; a reader of a stored row places nothing for it).
 */
export function relatedListEntryName(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
    const list = (entry as { list?: unknown }).list;
    if (typeof list === 'string') return list;
  }
  return undefined;
}

/**
 * [ADR-0146 D10] Does one entry of the paired `.custom` package's
 * `relatedLists` hide its list (`{ list, hidden: true }`)? `false` for the
 * bare name and for every other value.
 */
export function relatedListEntryHidden(entry: unknown): boolean {
  return typeof entry === 'object' && entry !== null && !Array.isArray(entry)
    && typeof (entry as { list?: unknown }).list === 'string'
    && (entry as { hidden?: unknown }).hidden === true;
}

/**
 * [ADR-0146 D10] Does the entry name `entry` cover the list `name` whole?
 * The same name, or a bare child, which names every list of that child
 * (`task` covers `task` and `task.account`). One relationship does not cover
 * its child (`task.account` covers neither `task` nor `task.owner`).
 *
 * The ONE reading of "this entry speaks for that list", for the paired
 * `.custom` arrangement: a hidden entry hides the lists it covers, and an
 * entry of the arrangement it replaces is carried over unless an entry
 * covers it.
 */
export function relatedListNameCovers(entry: string, name: string): boolean {
  return entry === name || (!entry.includes('.') && name.startsWith(`${entry}.`));
}

/**
 * [ADR-0146 D10] The key of the read decoration a served `object` carries when
 * the paired `.custom` package arranges its record-page tabs (a member of
 * `METADATA_READ_DECORATIONS`, `@objectstack/spec/kernel`): derived on every
 * read, stripped on every write, never authorable.
 */
export const RELATED_LISTS_ARRANGEMENT_DECORATION = '_relatedListsArrangement' as const satisfies MetadataReadDecoration;

/**
 * [ADR-0146 D10] What the served `relatedLists` cannot say about a tab list
 * the paired `.custom` package declares.
 *
 * The served `relatedLists` keeps the meaning it has on every object: the
 * lists it names are the tabs, in its order. The registry fold writes the
 * `.custom` arrangement into it (the entries it shows, then the entries of
 * the arrangement it replaces that it does not name). Two things are left for
 * the reader, because only the reader knows which lists exist for the user:
 *
 *  - `hidden` — the lists the arrangement hides, as entry names (`task`, or
 *    `task.account`). A list one of them names is not drawn, also a list
 *    another package brings, which a served `relatedLists` never hides by
 *    leaving it out;
 *  - `unlisted` — what happens to a related list no served entry names.
 *    `'shown'`: it follows the listed tabs, and so does the attachments tab
 *    (where the object enables files); set where the arrangement replaced the
 *    AUTOMATIC tab list, in which every list shows. `'hidden'`: the served
 *    list's own rule (a list of the object's own package shows only when
 *    named, another package's shows at the end); set where the arrangement
 *    replaced a DECLARED tab list, whose unnamed entries the fold already
 *    appended. The rule holds for an EMPTY served list too: where the
 *    arrangement hides every tab of a declared list, nothing is left to
 *    serve, and an empty `relatedLists` on its own reads as "none declared,
 *    every list shows". Beside `'hidden'` it is a declared list that names
 *    nothing, so a list the owner hid by leaving it out stays hidden.
 */
export interface RelatedListsArrangement {
  /** The `.custom` package whose object extension declares the tab list. */
  readonly packageId: string;
  /** The lists the arrangement hides, as entry names (a child object, or object.field). */
  readonly hidden: readonly string[];
  /** Whether a related list no served entry names is shown after the listed tabs, or follows the served list's own rule (also where that list is empty). */
  readonly unlisted: 'shown' | 'hidden';
}

/**
 * [ADR-0146 D10] The {@link RelatedListsArrangement} a served object carries,
 * or `undefined` when no `.custom` package arranges its tabs (or the value is
 * not the decoration's shape). The ONE reading of the decoration, for the
 * record page (objectui `deriveRelatedLists` and the synthesized page's tab
 * list): with `undefined`, a reader behaves exactly as it did before the
 * decoration existed.
 */
export function readRelatedListsArrangement(object: unknown): RelatedListsArrangement | undefined {
  if (typeof object !== 'object' || object === null || Array.isArray(object)) return undefined;
  const value = (object as Record<string, unknown>)[RELATED_LISTS_ARRANGEMENT_DECORATION];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { packageId, hidden, unlisted } = value as { packageId?: unknown; hidden?: unknown; unlisted?: unknown };
  if (typeof packageId !== 'string' || packageId === '') return undefined;
  return {
    packageId,
    hidden: Array.isArray(hidden) ? hidden.filter((name): name is string => typeof name === 'string' && name !== '') : [],
    unlisted: unlisted === 'shown' ? 'shown' : 'hidden',
  };
}
