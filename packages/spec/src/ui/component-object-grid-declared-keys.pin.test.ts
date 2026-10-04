// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20694] `object-grid` declares `description`, `emptyState` and
 * `keyboardNavigation` — the keys objectui's `ObjectGrid` reads (the first
 * two) or is being built to read (the third), which the strict row refused.
 *
 * ## The gap this file closes
 *
 * `ComponentPropsMap['object-grid']` is a strict shape derived from the
 * renderer's own read points, and it lagged the renderer: at the
 * `.objectui-sha` pin the grid reads `schema.description` and
 * `schema.emptyState`, while this row refused both by name. A metadata author
 * validating against the row had a key the renderer honours reported as
 * unknown, and objectui's registry could not list it either (its parity test
 * refuses an input the spec does not accept).
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE THREE MEMBERS PARSE, byte-identical: both `I18nLabel` forms of
 *   `description`, a full `emptyState`, and both booleans of
 *   `keyboardNavigation`. An absent member stays absent.
 * - §2 THE ROW IS STILL CLOSED: an unknown top-level key is refused, and so is
 *   a wrong value in each new member. Each is the code AND the path, so a
 *   refusal for the wrong reason reds; the unknown-key control is what proves
 *   the widening did not open the row.
 * - §3 ONE SCHEMA: the grid's `emptyState` and the list view's are
 *   `EmptyStateSchema` itself, and the grid answers exactly what it answers on
 *   every value in the corpus — triage ruled out a second shape, and a later
 *   copy reds the identity half even while it still agrees on today's corpus.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { ComponentPropsMap, ObjectGridPropsSchema } from './component.zod';
import { EmptyStateSchema, ListViewSchema } from './view.zod';

const GRID = () => ComponentPropsMap['object-grid'];
const BASE = { objectName: 'account' } as const;

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}

// ───────────────────────────────────────────────────────────────────────────
// §1 the three members parse
// ───────────────────────────────────────────────────────────────────────────

describe('§1 object-grid accepts description, emptyState and keyboardNavigation', () => {
  const ACCEPTED: ReadonlyArray<readonly [label: string, props: Record<string, unknown>]> = [
    ['description as a string', { description: 'Accounts you own' }],
    ['description as an inline locale map', { description: { en: 'Accounts you own', 'zh-CN': '你负责的客户' } }],
    ['a full emptyState', { emptyState: { title: 'No contacts yet', message: 'Add one to get started', icon: 'users' } }],
    ['an emptyState with one member', { emptyState: { message: 'Nothing here yet' } }],
    ['keyboardNavigation: true', { keyboardNavigation: true }],
    ['keyboardNavigation: false', { keyboardNavigation: false }],
    ['all three together', {
      description: 'Accounts you own',
      emptyState: { title: 'No accounts' },
      keyboardNavigation: true,
      editable: true,
    }],
  ];

  for (const [label, props] of ACCEPTED) {
    it(`parses ${label}, byte-identical`, () => {
      const r = GRID().safeParse({ ...BASE, ...props });
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data).toStrictEqual({ ...BASE, ...props });
    });
  }

  it('an absent member stays absent', () => {
    const r = GRID().safeParse(BASE);
    expect(issues(r)).toEqual([]);
    expect(r.success && Object.keys(r.data)).toEqual(['objectName']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 the row is still closed
// ───────────────────────────────────────────────────────────────────────────

describe('§2 object-grid still refuses what it does not declare', () => {
  it('LIT CONTROL — an unknown top-level key is refused: unrecognized_keys at the row itself', () => {
    const r = GRID().safeParse({ ...BASE, description: 'x', notAGridKey: 1 });
    expect(r.success).toBe(false);
    expect(issues(r)).toEqual([{ code: 'unrecognized_keys', path: '' }]);
    expect(r.success ? [] : (r.error.issues[0] as { keys?: string[] }).keys).toEqual(['notAGridKey']);
  });

  const REFUSED: ReadonlyArray<readonly [label: string, props: Record<string, unknown>, code: string, path: string]> = [
    ['a numeric description', { description: 7 }, 'invalid_union', 'description'],
    ['a string keyboardNavigation', { keyboardNavigation: 'yes' }, 'invalid_type', 'keyboardNavigation'],
    ['a bare-string emptyState', { emptyState: 'Nothing here' }, 'invalid_type', 'emptyState'],
    ['a numeric emptyState title', { emptyState: { title: 42 } }, 'invalid_union', 'emptyState.title'],
    ['an unknown emptyState member', { emptyState: { title: 'None', notAnEmptyStateKey: 1 } }, 'unrecognized_keys', 'emptyState'],
    ['an emptyState call to action', { emptyState: { action: { label: 'Add' } } }, 'unrecognized_keys', 'emptyState'],
  ];

  for (const [label, props, code, path] of REFUSED) {
    it(`refuses ${label} — ${code} at ${path}`, () => {
      const r = GRID().safeParse({ ...BASE, ...props });
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual([{ code, path }]);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// §3 one schema, not a copy of its shape
// ───────────────────────────────────────────────────────────────────────────

describe('§3 the grid and the list view hold EmptyStateSchema itself', () => {
  const HELD = [
    ['object-grid', () => ObjectGridPropsSchema.shape.emptyState],
    ['list-view', () => ListViewSchema.shape.emptyState],
  ] as const;

  for (const [door, member] of HELD) {
    it(`${door}: the emptyState member unwraps to EmptyStateSchema — the same def, by identity`, () => {
      expect(member().unwrap()._zod.def).toBe(EmptyStateSchema._zod.def);
    });
  }

  it('object-grid answers what EmptyStateSchema answers, one level down, on every corpus value', () => {
    const corpus: unknown[] = [
      {},
      { title: 'No contacts yet', message: 'Add one to get started', icon: 'users' },
      { title: { en: 'None', 'zh-CN': '无' } },
      { title: 42 },
      { icon: 5 },
      { description: 'x' },
      { action: {} },
      { notAnEmptyStateKey: 1 },
      'Nothing here',
      null,
    ];
    for (const emptyState of corpus) {
      const direct = issues(EmptyStateSchema.safeParse(emptyState)).map(({ code, path }) => ({
        code,
        path: path ? `emptyState.${path}` : 'emptyState',
      }));
      expect(issues(GRID().safeParse({ ...BASE, emptyState }))).toEqual(direct);
    }
  });
});
