/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { translateSchemaIssue, useMetadataLocale } from './i18n.js';
import type { SchemaFormIssue } from './SchemaForm.js';

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

/**
 * The top-level key a dot-joined issue path names: its HEAD segment, `''` for
 * a root-level issue. objectstack#35499 — the one key every reader that asks
 * "does the form draw this issue?" compares: the row placement in `SchemaForm`,
 * the inline register it publishes, and the host's banner and refusal line.
 */
export function issuePathHead(path: string): string {
  const dot = path.indexOf('.');
  return dot < 0 ? path : path.slice(0, dot);
}

/** The path below its head (`label.not_a_locale` → `not_a_locale`); `''` when the path IS the head. */
export function issuePathRest(path: string): string {
  const dot = path.indexOf('.');
  return dot < 0 ? '' : path.slice(dot + 1);
}

/**
 * objectstack#35499 — an issue is drawn on the DEEPEST row the form renders
 * for a prefix of its path. A form groups its issues by head; a row whose face
 * is a nested form then calls this to hand down the issues whose next segment
 * names one of the rows that nested form renders (`nestedRows`), the prefix
 * trimmed, and keeps the rest — its own exact issues, and every issue below a
 * face that does not descend (repeater, record map, code widget), which the
 * row draws itself with the path's trail. `nestedRows` undefined: nothing
 * descends.
 */
export function splitRowIssues<T extends { path: string }>(
  rowIssues: readonly T[],
  nestedRows: ReadonlySet<string> | undefined,
): { handDown: T[]; kept: T[] } {
  const handDown: T[] = [];
  const kept: T[] = [];
  for (const issue of rowIssues) {
    const rest = issuePathRest(issue.path);
    if (rest && nestedRows?.has(issuePathHead(rest))) handDown.push({ ...issue, path: rest });
    else kept.push(issue);
  }
  return { handDown, kept };
}

/**
 * objectstack#35628 — whether a row the editor reports drawing (`drawn`, the
 * inline register) draws an issue at `path`: some registered prefix IS the
 * path or a segment-wise prefix of it (`config.columns` draws
 * `config.columns.0`, never `config.columnsX`). A form over the whole draft
 * registers its row keys, one-segment prefixes, so there this is #35499's
 * head test; a form over a slice registers its keys under the slice's path
 * (`config.filter`), so it never claims a sibling key's issue.
 */
export function issuePathDrawnBy(drawn: ReadonlySet<string>, path: string): boolean {
  for (let p = path; p !== ''; p = p.slice(0, Math.max(0, p.lastIndexOf('.')))) {
    if (drawn.has(p)) return true;
  }
  return false;
}

/**
 * The issues under `prefix`, the prefix trimmed (`config.filter.0` →
 * `filter.0` for `config`): what a form mounted over that slice of the draft
 * is handed. The slice's own exact issues are not among them.
 */
export function issuesUnderPrefix<T extends { path: string }>(issues: readonly T[], prefix: string): T[] {
  const lead = `${prefix}.`;
  return issues.filter((i) => i.path.startsWith(lead)).map((i) => ({ ...i, path: i.path.slice(lead.length) }));
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

/**
 * objectstack#35628 — an inline register: each source registers the PATH
 * PREFIX it draws, held while mounted and drawing; `onChange` hears the union
 * (the host's `onInlineIssueFieldsChange`, judged by {@link issuePathDrawnBy}).
 * A `SchemaForm`'s rows register their keys through it; a curated inspector
 * builds one for its own rows and any form it mounts over a slice. The
 * register is held in state, never memoised: rows key their effect on it.
 */
export function useIssuePrefixRegister(
  onChange: ((prefixes: ReadonlySet<string>) => void) | undefined,
): (prefix: string) => () => void {
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  });
  const [counts] = React.useState(() => new Map<string, number>());
  const [register] = React.useState(() => (prefix: string) => {
    const publish = () => onChangeRef.current?.(new Set(counts.keys()));
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    publish();
    return () => {
      const n = (counts.get(prefix) ?? 1) - 1;
      if (n > 0) counts.set(prefix, n);
      else counts.delete(prefix);
      publish();
    };
  });
  return register;
}

/**
 * Registers, under `prefix`, the rows a `SchemaForm` mounted over the draft
 * slice at `prefix` reports (the returned setter is that form's
 * `onInlineIssueFieldsChange`), so the host hears `config.filter`, never
 * `config` — a key the slice form does not render keeps its issue in the
 * host's banner.
 */
export function useSliceFormIssueRows(
  register: (prefix: string) => () => void,
  prefix: string,
): (rows: ReadonlySet<string>) => void {
  const [rows, setRows] = React.useState<ReadonlySet<string>>(() => new Set());
  React.useEffect(() => {
    const offs = [...rows].map((row) => register(`${prefix}.${row}`));
    return () => offs.forEach((off) => off());
  }, [rows, prefix, register]);
  return setRows;
}

/**
 * The issue lines a curated inspector row draws for one path prefix, the way a
 * `SchemaForm` row draws its own: an issue AT `prefix` as its message, a deeper
 * one led by the trail of the rest of its path. The row registers `prefix`
 * while mounted, so the host's banner and refusal line leave those issues out
 * (objectstack#27865). Never deferred: no host hands a curated inspector a
 * create form's show-on-touch deferral, so mounted is drawn.
 */
export function IssuePrefixLines({
  issues,
  prefix,
  label,
  value,
  register,
}: {
  /** The host's issues, paths relative to the draft. */
  issues: readonly SchemaFormIssue[] | undefined;
  /** The dot-joined path this row edits (`label`, `config.columns`). */
  prefix: string;
  /** The row's visible label, the trail's head. */
  label: string;
  /** The draft value AT `prefix`, which a trail's indices resolve against. */
  value: unknown;
  register: (prefix: string) => () => void;
}): React.ReactElement | null {
  const locale = useMetadataLocale();
  React.useEffect(() => register(prefix), [register, prefix]);
  const lead = prefix.slice(prefix.lastIndexOf('.') + 1);
  const lines = (issues ?? [])
    .filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`))
    .map((i) => {
      const message = translateSchemaIssue(i, locale);
      const rest = i.path.slice(prefix.length);
      return rest ? `${describeIssuePath(label, `${lead}${rest}`, { [lead]: value })}: ${message}` : message;
    });
  if (lines.length === 0) return null;
  return React.createElement(
    React.Fragment,
    null,
    lines.map((m, i) =>
      React.createElement('div', { key: i, 'data-testid': 'inspector-row-issue', className: 'text-xs text-destructive' }, m),
    ),
  );
}
