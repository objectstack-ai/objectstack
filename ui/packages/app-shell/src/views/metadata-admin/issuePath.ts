/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Render a (possibly nested) validation issue path into a human-readable trail
 * that names the offending element. A Zod issue on a dashboard widget arrives as
 * a dot-joined path like `widgets.2.layout`; shown as just its head field
 * ("Widgets") the author can't tell WHICH widget or sub-field is at fault. This
 * turns it into "Widgets → priority_split → layout" by resolving each array
 * index to the item's stable identity (id/name/title) from the draft value.
 *
 * @param headLabel resolved human label for the first segment (caller knows the
 *                  form/schema labels).
 * @param path      dot-joined issue path (e.g. `widgets.2.layout`).
 * @param rootValue the draft object the path indexes into (used to resolve an
 *                  array index to the item's identity).
 */
export function describeIssuePath(headLabel: string, path: string, rootValue: unknown): string {
  const segments = path.split('.');
  if (segments.length <= 1) return headLabel;

  const parts: string[] = [headLabel];
  let cursor: unknown = asRecord(rootValue)?.[segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (/^\d+$/.test(seg)) {
      const idx = Number(seg);
      const item = Array.isArray(cursor) ? cursor[idx] : undefined;
      // 1-based index reads naturally for non-developers ("#1" not "#0").
      parts.push(itemIdentity(item) ?? `#${idx + 1}`);
      cursor = item;
    } else {
      parts.push(seg);
      cursor = asRecord(cursor)?.[seg];
    }
  }
  return parts.join(' → ');
}

/** Best-effort stable identity of an array item, resolving an I18nLabel object
 *  ({ key, defaultValue }) to its string. Returns undefined when none usable. */
function itemIdentity(item: unknown): string | undefined {
  const o = asRecord(item);
  if (!o) return undefined;
  for (const k of ['id', 'name', 'key', 'title', 'label']) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
    const nested = asRecord(v);
    if (nested) {
      const s = nested.defaultValue ?? nested.key;
      if (typeof s === 'string' && s.trim()) return s;
    }
  }
  return undefined;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

/**
 * The draft SLICE a refused issue path is held against — the path minus its
 * last segment (`fields.lookup.reference` → `fields.lookup`). An empty string
 * means the whole document (a root-level or unlocated issue).
 *
 * ⭐ The PARENT, never the path itself, and that choice is load-bearing. The
 * commonest refusal class is "X is Required", where the value AT the path is
 * absent BY DEFINITION — that is why the server refused. Keying on it would
 * compare `undefined` against `undefined` on every later render, so the block
 * could never release and Save would be dead-bolted. The parent is the thing
 * the author actually edits: it is present, it changes when they fill the
 * missing key in, and it changes when they delete the offending element
 * outright. Both are real escapes; keying on the path itself has neither.
 */
export function issueSlicePath(path: string): string {
  const segments = path.split('.').filter(Boolean);
  if (segments.length <= 1) return '';
  return segments.slice(0, -1).join('.');
}

/**
 * A stable fingerprint of the value at `slicePath`, or `undefined` when the
 * path does not resolve to a value in `rootValue`.
 *
 * ⛔ `undefined` is the FAIL-OPEN signal and callers must treat it as one: a
 * refusal whose slice cannot be located in the document is not localisable, so
 * nothing may be held against it. Returning a sentinel string here instead
 * would make any two unresolvable paths compare EQUAL — which is precisely the
 * comparison that turns a release condition into a block with no exit.
 *
 * Numeric segments index arrays, matching {@link describeIssuePath} and the
 * dot-joined `{path}` the server's `INVALID_METADATA` issues carry.
 */
export function issueSliceFingerprint(rootValue: unknown, slicePath: string): string | undefined {
  let cursor: unknown = rootValue;
  if (slicePath !== '') {
    for (const seg of slicePath.split('.')) {
      if (Array.isArray(cursor) && /^\d+$/.test(seg)) {
        cursor = cursor[Number(seg)];
      } else if (cursor && typeof cursor === 'object') {
        cursor = (cursor as Record<string, unknown>)[seg];
      } else {
        return undefined;
      }
      if (cursor === undefined) return undefined;
    }
  }
  if (cursor === undefined) return undefined;
  try {
    return JSON.stringify(cursor) ?? undefined;
  } catch {
    // A cyclic or otherwise unserialisable slice cannot be fingerprinted, and
    // an unfingerprintable slice must fail open like an unlocatable one.
    return undefined;
  }
}
