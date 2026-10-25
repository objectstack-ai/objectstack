/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pure display helpers for person (sys_user) records, shared by the
 * search-first PeoplePicker's rich rows, the SelectionTray chips, and the
 * read-only user cell renderer. Kept framework-free so they're trivially
 * unit-testable and reusable by a future org-tree tier.
 */

/** Resolve a possibly-dotted path (e.g. `primary_business_unit_id.name`) against a record. */
export function resolvePath(record: any, path: string): any {
  if (!record || !path) return undefined;
  if (!path.includes('.')) return record[path];
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), record);
}

/**
 * The fields a person's display name is read from, in order: the configured
 * display field, then `name`, `username`, `label`. A caller that gates the name
 * by field-level security filters THIS list and hands the rest to
 * {@link getPersonName} (objectui#10535): a denied rung is skipped, so the name
 * falls through to the next readable one — the row a stripping backend serves
 * reads the same.
 */
export function getPersonNameFields(nameField = 'name'): string[] {
  return [nameField, 'name', 'username', 'label'];
}

/**
 * Best display name for a person record, tolerating expanded / raw shapes: the
 * first field of the name ladder the record holds a value for. `nameField` is
 * the configured display field, whose ladder is {@link getPersonNameFields}, or
 * the ladder itself, already filtered to the fields the viewer may read.
 */
export function getPersonName(record: any, nameField: string | readonly string[] = 'name'): string {
  if (record == null) return '';
  if (typeof record !== 'object') return String(record);
  const ladder = typeof nameField === 'string' ? getPersonNameFields(nameField) : nameField;
  for (const field of ladder) {
    if (record[field] != null) return String(record[field]);
  }
  return '';
}

/**
 * Up-to-2-char initials for the avatar fallback.
 * - "John Doe" → "JD"; "John" → "JO"
 * - CJK single token → trailing 1–2 chars (given name): "张三" → "张三", "王小明" → "小明"
 */
export function getPersonInitials(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  const token = parts[0];
  if (/[㐀-鿿]/.test(token)) {
    return token.length <= 2 ? token : token.slice(-2);
  }
  return token.slice(0, 2).toUpperCase();
}

/** Secondary line: resolve each field path, drop empties, join with " · ". */
export function getPersonSubtitle(record: any, fields?: string[]): string {
  if (!record || !fields || fields.length === 0) return '';
  return fields
    .map(f => resolvePath(record, f))
    .filter(v => v != null && v !== '')
    .map(v => String(v))
    .join(' · ');
}

/**
 * Avatar image URL (defaults to `sys_user.image`); undefined when absent, and
 * when `avatarField` is `null` — no avatar field to read, e.g. one field-level
 * security withholds (objectui#10433).
 */
export function getPersonAvatarUrl(record: any, avatarField: string | null = 'image'): string | undefined {
  const v = record && avatarField ? resolvePath(record, avatarField) : undefined;
  return v ? String(v) : undefined;
}

/** Record id, tolerating `id` / `_id` / a custom id field. */
export function getPersonId(record: any, idField = 'id'): any {
  if (!record || typeof record !== 'object') return record;
  return record[idField] ?? record.id ?? record._id;
}

/**
 * Case-insensitive literal-substring match ranges of `query` in `text`, as
 * `[start, end)` index pairs. Used to highlight the typed term in candidate
 * rows — a strong disambiguation aid for same-named people. Pinyin matches are
 * resolved server-side and won't have client ranges; that's fine, the row still
 * shows, just without a highlight.
 */
export function matchRanges(text: string, query: string): Array<[number, number]> {
  const t = text ?? '';
  const q = (query ?? '').trim().toLowerCase();
  if (!q || !t) return [];
  const lower = t.toLowerCase();
  const ranges: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const idx = lower.indexOf(q, from);
    if (idx === -1) break;
    ranges.push([idx, idx + q.length]);
    from = idx + q.length;
  }
  return ranges;
}
