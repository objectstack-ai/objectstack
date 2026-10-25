// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13253 — a census of the shell's departures in the four files the
 * card names: every `navigate(` call sits inside a `confirmUnsavedLeave(` call,
 * or is listed below with the reason it is not a departure.
 *
 * The behaviour is pinned through the real components in the sibling suites
 * (`CommandPalette.unsavedEditsLeave-13253.test.tsx`,
 * `InboxPopover.unsavedEditsLeave-13253.test.tsx`,
 * `ConsoleLayout.aiEntryAsksUnsaved-13253.test.tsx`). This file answers the
 * other question: whether a call site was missed, or a new one was added bare.
 * Each run re-reads the sources; no count is written here.
 *
 * Comments are masked with the tree's one comment scanner
 * (`scripts/js-comment-mask.mjs`), so a docblock quoting a bare call is not
 * read as one. The enclosure test matches parentheses over the masked code.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const HERE = dirname(fileURLToPath(import.meta.url));
const SHELL_FILES = {
  'chrome/CommandPalette.tsx': join(HERE, 'CommandPalette.tsx'),
  'layout/InboxPopover.tsx': join(HERE, '..', 'layout', 'InboxPopover.tsx'),
  'layout/ConsoleLayout.tsx': join(HERE, '..', 'layout', 'ConsoleLayout.tsx'),
  'layout/UnifiedSidebar.tsx': join(HERE, '..', 'layout', 'UnifiedSidebar.tsx'),
} as const;

/**
 * A call that is not a departure, by file and the call's own text, with the
 * reason. Empty today: every `navigate(` in the four files leaves the page.
 */
const NOT_A_DEPARTURE: Record<string, Record<string, string>> = {};

/** The offset of the `)` that closes the `(` at `open`, or -1. */
function closingParen(code: string, open: number): number {
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === '(') depth++;
    else if (code[k] === ')' && --depth === 0) return k;
  }
  return -1;
}

/** Every call of `callee` in `code` not inside a `confirmUnsavedLeave(...)` call: its text up to the end of the line. */
function bareCalls(code: string, callee: string): string[] {
  const guards: Array<[number, number]> = [];
  for (const m of code.matchAll(/(?<![\w$.])confirmUnsavedLeave\(/g)) {
    const open = m.index! + m[0].length - 1;
    guards.push([open, closingParen(code, open)]);
  }
  const bare: string[] = [];
  const call = new RegExp(`(?<![\\w$.])${callee}\\(`, 'g');
  for (const m of code.matchAll(call)) {
    const at = m.index!;
    if (guards.some(([open, close]) => open < at && at < close)) continue;
    const end = code.indexOf('\n', at);
    bare.push(code.slice(at, end === -1 ? undefined : end).trim());
  }
  return bare;
}

const code = (file: keyof typeof SHELL_FILES) => mask(readFileSync(SHELL_FILES[file], 'utf8'));

describe('every shell departure in the four files goes through confirmUnsavedLeave (objectui#13253)', () => {
  it.each(Object.keys(SHELL_FILES) as Array<keyof typeof SHELL_FILES>)(
    '%s: no bare navigate( call without a listed reason',
    (file) => {
      const unexplained = bareCalls(code(file), 'navigate').filter((text) => !NOT_A_DEPARTURE[file]?.[text]);
      expect(unexplained).toEqual([]);
    },
  );

  it('CommandPalette: the app switch it hands onAppChange goes through the seam too', () => {
    expect(bareCalls(code('chrome/CommandPalette.tsx'), 'onAppChange')).toEqual([]);
  });

  it('UnifiedSidebar: onAppChange is declared but never read, so it is not a departure', () => {
    // The prop's one appearance is its declaration on the props interface; the
    // component destructures `activeAppName` only. A sidebar that starts
    // reading it must wrap it, and this assertion makes that a visible change.
    const sidebar = code('layout/UnifiedSidebar.tsx');
    expect(sidebar.match(/\bonAppChange\b/g) ?? []).toHaveLength(1);
    expect(sidebar).toMatch(/onAppChange\?: \(name: string\) => void;/);
  });

  it('CONTROL: the census sees a bare call, and does not count a wrapped one or a commented one', () => {
    const sample = mask(
      [
        'const a = () => navigate(`/x/${encodeURIComponent(id)}`);',
        'const b = () => confirmUnsavedLeave(() => navigate(`/y/${encodeURIComponent(id)}`));',
        '// navigate("/z") in prose is not a call',
        'const c = useNavigate();',
        'shellNavigate("/w");',
      ].join('\n'),
    );
    expect(bareCalls(sample, 'navigate')).toEqual(['navigate(`/x/${encodeURIComponent(id)}`);']);
  });
});
