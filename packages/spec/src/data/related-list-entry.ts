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
