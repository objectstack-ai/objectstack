// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Structural drift guard for the package-door slice (objectui#4302).
 *
 * `mergePermissionSlice` takes the facets it carries from a NAMED list
 * ({@link EDITOR_AUTHORED_KEYS}); everything else comes from the freshly-read
 * `base`. That list is only correct while it keeps up with what the Access
 * matrix editor can actually author — and it did not: `rowLevelSecurity`,
 * `tabPermissions` and `adminScope` were authorable for three releases while the
 * slice still carried five keys, so a row-level-security policy authored under a
 * package was reverted on Save with no error anywhere.
 *
 * A silent drop is what made that expensive, so the guard is mechanical: scan
 * the editor sources for the keys their `setDraft(...)` updaters write into the
 * draft, and fail if any of them is not carried by the slice. The next facet
 * added to the editor cannot silently drop on this door — it reds here first.
 *
 * Scope of the scan (and its limits, stated rather than implied): it reads the
 * object literals inside `setDraft(...)` calls in the two files that own the
 * draft. A facet written through a helper defined elsewhere would not be seen —
 * which is why the floor assertion below pins the keys the scan MUST find, so a
 * scanner that goes blind reds instead of passing on an empty set.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EDITOR_AUTHORED_KEYS } from './permission-slice';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The two sources that own the permission-set draft the package door saves. */
const DRAFT_OWNERS = ['PermissionMatrixEditor.tsx', 'PermissionAdvancedFacets.tsx'];

/**
 * Keys the scan must find, so an empty or broken scan cannot read as coverage.
 * Removing a facet from the editor reds this deliberately — update it with the
 * removal, never to make a red go away.
 */
const SCAN_FLOOR = [
  'name',
  'label',
  'systemPermissions',
  'objects',
  'fields',
  'rowLevelSecurity',
  'tabPermissions',
  'adminScope',
];

/* ── A very small source scanner ─────────────────────────────────────────── */

/** Advance past a string/template literal that starts at `i`. */
function skipQuoted(src: string, i: number): number {
  const quote = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === '\\') i += 2;
    else if (src[i] === quote) return i + 1;
    else i++;
  }
  return i;
}

/** Advance past a `//` or block comment that starts at `i` (or return `i`). */
function skipComment(src: string, i: number): number {
  if (src[i] === '/' && src[i + 1] === '/') {
    const nl = src.indexOf('\n', i);
    return nl === -1 ? src.length : nl + 1;
  }
  if (src[i] === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2);
    return end === -1 ? src.length : end + 2;
  }
  return i;
}

/**
 * Text between the bracket at `open` and its match, skipping strings and
 * comments. `open` must index a `(`, `[` or `{`.
 */
function balanced(src: string, open: number): { inner: string; end: number } {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const close = pairs[src[open]];
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    const afterComment = skipComment(src, i);
    if (afterComment !== i) {
      i = afterComment;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i = skipQuoted(src, i);
      continue;
    }
    if (c === src[open]) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return { inner: src.slice(open + 1, i), end: i + 1 };
    }
    i++;
  }
  return { inner: src.slice(open + 1), end: src.length };
}

/** Split `inner` on its TOP-LEVEL commas (nesting, strings and comments aware). */
function topLevelSegments(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    const afterComment = skipComment(inner, i);
    if (afterComment !== i) {
      i = afterComment;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i = skipQuoted(inner, i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  out.push(inner.slice(start));
  return out;
}

/** Strip comments so a `//`-commented key can never be read as authored. */
function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const afterComment = skipComment(text, i);
    if (afterComment !== i) {
      out += ' ';
      i = afterComment;
      continue;
    }
    if (text[i] === '"' || text[i] === "'" || text[i] === '`') {
      const end = skipQuoted(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

/** The statically-known keys an object literal's body declares at its top level. */
function literalKeys(inner: string): string[] {
  const keys: string[] = [];
  for (const rawSegment of topLevelSegments(inner)) {
    const segment = stripComments(rawSegment).trim();
    if (!segment) continue;
    if (segment.startsWith('...')) continue; // spread — carries no named key
    if (segment.startsWith('[')) continue; // computed key — not statically known
    const m = /^(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*))\s*(:|$)/.exec(segment);
    if (m) keys.push(m[1] ?? m[2] ?? m[3]);
  }
  return keys;
}

/**
 * Every key written into the draft by a `setDraft(...)` updater in `src`.
 * Only object literals whose first token is a spread count — those are the
 * `{ ...prev, <facet>: value }` shape a draft update takes; a literal that does
 * not spread the previous draft is a fresh value, not a draft write.
 */
export function scanDraftAuthoredKeys(src: string): Set<string> {
  const keys = new Set<string>();
  const CALL = /\bsetDraft\s*\(/g;
  let call: RegExpExecArray | null;
  while ((call = CALL.exec(src))) {
    const { inner: callArgs } = balanced(src, call.index + call[0].length - 1);
    let i = 0;
    while (i < callArgs.length) {
      const c = callArgs[i];
      const afterComment = skipComment(callArgs, i);
      if (afterComment !== i) {
        i = afterComment;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        i = skipQuoted(callArgs, i);
        continue;
      }
      if (c === '{') {
        const { inner, end } = balanced(callArgs, i);
        if (/^\s*\.\.\./.test(inner)) {
          // An object literal that spreads the previous draft: its top-level
          // keys are the facets this update writes. Skip past it so a NESTED
          // literal's keys are never read as top-level facets.
          for (const k of literalKeys(inner)) keys.add(k);
          i = end;
          continue;
        }
      }
      i++;
    }
  }
  return keys;
}

/* ── The guard ───────────────────────────────────────────────────────────── */

describe('permission slice — carried keys keep up with the editor (objectui#4302)', () => {
  const scanned = new Set<string>();
  for (const file of DRAFT_OWNERS) {
    for (const k of scanDraftAuthoredKeys(readFileSync(path.join(here, file), 'utf8'))) {
      scanned.add(k);
    }
  }

  it('the scanner reads real draft updates (not an empty set)', () => {
    // Anti-empty-green: a scanner that silently matched nothing would make
    // every assertion below pass while guarding nothing at all.
    const fixture = `
      setDraft((p) => ({ ...p, alpha: 1, beta }));
      setDraft((prev) => {
        const objects = { ...(prev.objects ?? {}) };
        return { ...prev, objects };
      });
      setDraft((p) => ({ ...p, nested: { ...asObject(p.nested), inner: 2 } }));
      setOther((prev) => ({ ...prev, notADraftKey: 3 }));
      setDraft((p) => ({ ...p, computed: v, [dynamic]: v }));
    `;
    expect([...scanDraftAuthoredKeys(fixture)].sort()).toEqual([
      'alpha',
      'beta',
      'computed',
      'nested',
      'objects',
    ]);
  });

  it('finds every facet the editor is known to author', () => {
    expect([...scanned].sort()).toEqual(expect.arrayContaining([...SCAN_FLOOR].sort()));
  });

  it('carries every facet the editor can author — no silent drop on the package door', () => {
    const carried = new Set<string>(EDITOR_AUTHORED_KEYS);
    const dropped = [...scanned].filter((k) => !carried.has(k)).sort();
    // A key here is authored in the editor and thrown away by the package
    // door's slice merge: Save succeeds and the author's edit never persists.
    expect(dropped).toEqual([]);
  });
});
