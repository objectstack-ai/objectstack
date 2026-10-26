/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11505 — the `grid` registration and renderer drop the flat
 * per-breakpoint column channel: no `smColumns` / `mdColumns` / `lgColumns` /
 * `xlColumns` input, no read, and a seed in the breakpoint object, the one
 * spelling.
 *
 * ## What was split
 *
 * The registration offered the four keys as inputs and seeded two of them
 * (`columns: 1, mdColumns: 2, lgColumns: 4`); the renderer read each one OVER
 * the breakpoint object and let it switch off the bare count's mobile-first
 * ramp. No face of `GridSchema` declared them. Triage's ruling A retired the
 * channel; the declaration half (both faces refuse the keys by name) is pinned
 * in `types/src/__tests__/grid-flat-columns-retired-11505.test.ts`.
 *
 * ## The pins, through the real `SchemaRenderer`
 *
 * - The registration publishes `columns` as its only column input.
 * - The seed is the breakpoint object, with no flat key, and draws the classes
 *   the flat seed drew. That class list was read off the flat seed on this
 *   card's base, through this file's own `classesOf`; this row is green on the
 *   base and on the change, which is the measurement that the seed moved and
 *   the rendering did not.
 * - Each flat key is read by nothing: a document carrying one draws exactly
 *   what it draws without it.
 * - The migration the zod refusal prescribes draws what the flat document drew
 *   on the base, row by row: a bare `columns: C` beside a flat key becomes the
 *   object's `xs: C`, and with no `columns` the object takes `xs: 2`.
 * - The SDUI manifest built from the live registry answers a flat key the way
 *   it answers any prop the node does not declare, `unknown-prop`; it answered
 *   `smColumns: 13` with `invalid-enum` while the input was registered.
 *
 * Module-scope import of the renderers, not `beforeAll` (AGENTS.md §测试纪律).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '../renderers';
import { SchemaRenderer } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { Diagnostic, SchemaElement } from '@object-ui/sdui-parser';

const FLAT_KEYS = ['smColumns', 'mdColumns', 'lgColumns', 'xlColumns'] as const;

/** The root element's classes for a `grid` document, as rendered. */
function classesOf(doc: Record<string, unknown>): string {
  const { container, unmount } = render(<SchemaRenderer schema={{ type: 'grid', children: [], ...doc } as never} />);
  const className = (container.firstElementChild as HTMLElement | null)?.className ?? '';
  unmount();
  return className;
}

const withoutFlatKeys = (doc: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(doc).filter(([key]) => !(FLAT_KEYS as readonly string[]).includes(key)));

const config = ComponentRegistry.getConfig('grid');

/**
 * The manifest the running app validates against, keyed by every known
 * registry tag, the way `layout-containers-declare-containment.test.tsx`
 * builds it (the app's own builder in `renderers/layout/page.tsx` is
 * module-private).
 */
const diagnose = (schema: Record<string, unknown>): Diagnostic[] => {
  const configs = ComponentRegistry.getKnownTypes().map((t) => {
    const meta = ComponentRegistry.getMeta(t);
    return { type: t, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
  });
  const manifest = manifestFromConfigs(configs as unknown as Parameters<typeof manifestFromConfigs>[0]);
  return validateTree(schema as SchemaElement, manifest).diagnostics;
};

/**
 * The class list the registration's flat seed (`columns: 1`, `mdColumns: 2`,
 * `lgColumns: 4`, `gap: 4`) drew on this card's base, measured through
 * {@link classesOf}.
 */
const SEED_CLASSES = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4';

/**
 * Flat documents, the object document the refusal prescribes for each, and
 * the classes the FLAT document drew on this card's base (read through
 * {@link classesOf} there). Each row is one migration shape.
 */
const MIGRATIONS: ReadonlyArray<readonly [string, Record<string, unknown>, Record<string, unknown>, string]> = [
  [
    'the old seed: a bare count with two flat keys',
    { columns: 1, mdColumns: 2, lgColumns: 4 },
    { columns: { xs: 1, md: 2, lg: 4 } },
    'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4',
  ],
  [
    'a bare count above 1: the flat key switched its ramp off',
    { columns: 4, mdColumns: 2 },
    { columns: { xs: 4, md: 2 } },
    'grid grid-cols-4 md:grid-cols-2 gap-4',
  ],
  [
    'no `columns` at all: the grid drew its default two below the flat key',
    { smColumns: 3 },
    { columns: { xs: 2, sm: 3 } },
    'grid grid-cols-2 sm:grid-cols-3 gap-4',
  ],
  [
    'a breakpoint object: the flat key won at its breakpoint',
    { columns: { xs: 1, md: 3 }, mdColumns: 2, xlColumns: 6 },
    { columns: { xs: 1, md: 2, xl: 6 } },
    'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4',
  ],
  [
    'all four flat keys beside a bare count',
    { columns: 2, smColumns: 1, mdColumns: 2, lgColumns: 3, xlColumns: 4 },
    { columns: { xs: 2, sm: 1, md: 2, lg: 3, xl: 4 } },
    'grid grid-cols-2 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4',
  ],
];

describe('`grid` reads and publishes no flat column key (objectui#11505)', () => {
  it('the registration publishes `columns` as its one column input', () => {
    expect(config, 'the `grid` registration').toBeDefined();
    const names = (config!.inputs ?? []).map((input) => input.name);
    expect(names.filter((name) => /columns$/i.test(name))).toEqual(['columns']);
    // Non-vacuity: the inputs were read, and the live neighbours are there.
    expect(names).toEqual(expect.arrayContaining(['columns', 'gap', 'children']));
  });

  it('the seed is the breakpoint object, with no flat key', () => {
    const seed = (config!.defaultProps ?? {}) as Record<string, unknown>;
    expect(Object.keys(seed).filter((key) => /columns$/i.test(key))).toEqual(['columns']);
    expect(seed.columns).toEqual({ xs: 1, md: 2, lg: 4 });
  });

  it('the seeded grid draws the classes the flat seed drew', () => {
    const seed = (config!.defaultProps ?? {}) as Record<string, unknown>;
    expect(classesOf(seed)).toBe(SEED_CLASSES);
  });

  it.each(MIGRATIONS)('%s — each flat key is read by nothing', (_label, flat) => {
    expect(classesOf(flat)).toBe(classesOf(withoutFlatKeys(flat)));
  });

  it.each(MIGRATIONS)('%s — the prescribed object draws what the flat document drew', (_label, _flat, migrated, drew) => {
    expect(classesOf(migrated)).toBe(drew);
  });

  it.each(FLAT_KEYS)('the SDUI manifest answers `%s` as a prop `grid` does not have', (key) => {
    expect(diagnose({ type: 'grid', [key]: 2 }).map((d) => [d.severity, d.code, d.message])).toEqual([
      ['warning', 'unknown-prop', `<grid> has no prop "${key}"`],
    ]);
  });

  it('the SDUI manifest takes the breakpoint object those keys spelled a second time', () => {
    // Lit control for the row above: the same node, in the one spelling.
    expect(diagnose({ type: 'grid', columns: { xs: 1, sm: 2, md: 2, lg: 4, xl: 6 } })).toEqual([]);
  });

  it('a flat key no longer switches the bare count\'s ramp off', () => {
    // Lit control for the rows above: the ramp is what a bare `4` draws.
    expect(classesOf({ columns: 4 })).toBe('grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4');
    expect(classesOf({ columns: 4, mdColumns: 2 })).toBe('grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4');
  });
});
