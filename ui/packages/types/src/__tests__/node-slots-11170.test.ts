/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The per-type node-slot declaration (objectui#11170): its shape, its walk,
 * and the tie between its `page:*` rows and the `@objectstack/spec` export
 * they are read from.
 *
 * What is NOT here: whether each row matches the renderer. That is a runtime
 * question answered against the live registry by
 * `packages/components/src/renderers/__tests__/node-slot-declaration-11170.test.tsx`
 * and the `nodeSlotDeclaration-11170` suite in each plugin package.
 */

import { describe, expect, it } from 'vitest';
import { pageComponentSlotPositions } from '@objectstack/spec/ui';

import {
  NODE_SLOT_DECLARATIONS,
  nodeSlotPathSegments,
  nodeSlotValues,
  nodeSlotsFor,
} from '../node-slots.js';

const PAGE_FAMILY_PREFIX = 'page:';

describe('the declaration is one row per renderer, keyed by registry spelling (objectui#11170)', () => {
  it('lists every type once, never `children`, and every path parses', () => {
    const seen = new Set<string>();
    for (const row of NODE_SLOT_DECLARATIONS) {
      expect(row.types.length, `a row with no types`).toBeGreaterThan(0);
      expect(row.slots.length, `\`${row.types[0]}\` declares no slot — delete the row`).toBeGreaterThan(0);
      for (const type of row.types) {
        expect(seen.has(type), `\`${type}\` is listed twice`).toBe(false);
        seen.add(type);
      }
      const paths = row.slots.map((s) => s.path);
      expect(new Set(paths).size, `\`${row.types[0]}\` repeats a path`).toBe(paths.length);
      for (const path of paths) {
        expect(path).not.toBe('children');
        expect(nodeSlotPathSegments(path).every((s) => s.key.length > 0)).toBe(true);
      }
    }
    // The population control: a reading over an empty table proves nothing.
    expect(seen.size).toBeGreaterThan(40);
  });

  it('`nodeSlotsFor` answers the row verbatim, and the one frozen empty list otherwise', () => {
    expect(nodeSlotsFor('dialog').map((s) => s.path)).toEqual(['trigger', 'content', 'footer']);
    expect(nodeSlotsFor('ui:dialog')).toBe(nodeSlotsFor('dialog'));
    // Verbatim: a bare `card` and the page family's `page:card` are different renderers.
    expect(nodeSlotsFor('card').map((s) => s.path)).toEqual(['header', 'footer']);
    expect(nodeSlotsFor('page:card').map((s) => s.path)).toEqual(['footer', 'body']);
    const none = nodeSlotsFor('stat-card');
    expect(none).toEqual([]);
    expect(Object.isFrozen(none)).toBe(true);
    expect(nodeSlotsFor('button')).toBe(none);
    // Prototype keys are not rows.
    expect(nodeSlotsFor('constructor')).toBe(none);
    expect(nodeSlotsFor('toString')).toBe(none);
  });

  it('`body` is retired wherever it appears, and appears only on the page family', () => {
    const bodyRows = NODE_SLOT_DECLARATIONS.filter((row) => row.slots.some((s) => s.path === 'body'));
    expect(bodyRows.length).toBeGreaterThan(0);
    for (const row of bodyRows) {
      for (const type of row.types) expect(type.startsWith(PAGE_FAMILY_PREFIX), type).toBe(true);
      expect(row.slots.find((s) => s.path === 'body')?.retired).toBe(true);
    }
    // …and nothing else is retired: `retired` is the tombstone's flag, not a mood.
    for (const row of NODE_SLOT_DECLARATIONS) {
      for (const s of row.slots) if (s.retired) expect(s.path).toBe('body');
    }
  });
});

describe('the path grammar and the walk (objectui#11170)', () => {
  it('splits a path into keys, each marked when `[]` followed it', () => {
    expect(nodeSlotPathSegments('trigger')).toEqual([{ key: 'trigger', each: false }]);
    expect(nodeSlotPathSegments('items[].content')).toEqual([
      { key: 'items', each: true },
      { key: 'content', each: false },
    ]);
    expect(nodeSlotPathSegments('items[]')).toEqual([{ key: 'items', each: true }]);
    expect(nodeSlotPathSegments('report.sections[].content')).toEqual([
      { key: 'report', each: false },
      { key: 'sections', each: true },
      { key: 'content', each: false },
    ]);
    expect(() => nodeSlotPathSegments('[]')).toThrow(/Malformed/);
    expect(() => nodeSlotPathSegments('items..content')).toThrow(/Malformed/);
  });

  const node = (content: string) => ({ type: 'text', content });

  it('a direct slot: one node, or a list expanded to its elements', () => {
    expect(nodeSlotValues({ type: 'dialog', trigger: node('a') }, 'trigger')).toEqual([
      { segments: ['trigger'], value: node('a') },
    ]);
    expect(nodeSlotValues({ type: 'dialog', content: [node('a'), 'plain', node('b')] }, 'content')).toEqual([
      { segments: ['content', 0], value: node('a') },
      { segments: ['content', 1], value: 'plain' },
      { segments: ['content', 2], value: node('b') },
    ]);
    // Absent is absent; `null` and a primitive are returned for the reader to skip.
    expect(nodeSlotValues({ type: 'dialog' }, 'trigger')).toEqual([]);
    expect(nodeSlotValues({ type: 'dialog', trigger: null }, 'trigger')).toEqual([{ segments: ['trigger'], value: null }]);
    expect(nodeSlotValues({ type: 'dialog', trigger: 0 }, 'trigger')).toEqual([{ segments: ['trigger'], value: 0 }]);
  });

  it('a panel list: each element’s slot, with the element index in the path', () => {
    const tabs = {
      type: 'tabs',
      items: [
        { value: 'a', content: node('a') },
        'not-a-panel',
        { value: 'c', content: [node('c1'), node('c2')] },
        { value: 'd' },
      ],
    };
    expect(nodeSlotValues(tabs, 'items[].content')).toEqual([
      { segments: ['items', 0, 'content'], value: node('a') },
      { segments: ['items', 2, 'content', 0], value: node('c1') },
      { segments: ['items', 2, 'content', 1], value: node('c2') },
    ]);
    // A non-array under an `[]` key holds no panels.
    expect(nodeSlotValues({ type: 'tabs', items: { content: node('x') } }, 'items[].content')).toEqual([]);
  });

  it('a trailing `[]`: each element is itself a node or a list (`carousel.items[]`)', () => {
    const carousel = { type: 'carousel', items: [node('a'), [node('b1'), node('b2')]] };
    expect(nodeSlotValues(carousel, 'items[]')).toEqual([
      { segments: ['items', 0], value: node('a') },
      { segments: ['items', 1, 0], value: node('b1') },
      { segments: ['items', 1, 1], value: node('b2') },
    ]);
  });

  it('an object step and two list steps: `report.sections[].content`, `sections[].fields[].render`', () => {
    const viewer = {
      type: 'report-viewer',
      report: { sections: [{ content: node('s0') }, { content: [node('s1a')] }] },
    };
    expect(nodeSlotValues(viewer, 'report.sections[].content')).toEqual([
      { segments: ['report', 'sections', 0, 'content'], value: node('s0') },
      { segments: ['report', 'sections', 1, 'content', 0], value: node('s1a') },
    ]);
    const detail = {
      type: 'detail',
      sections: [{ fields: [{ name: 'a' }, { name: 'b', render: node('b') }] }],
    };
    expect(nodeSlotValues(detail, 'sections[].fields[].render')).toEqual([
      { segments: ['sections', 0, 'fields', 1, 'render'], value: node('b') },
    ]);
  });
});

/**
 * Route (a) for the page family: the rows are the spec's positions, read by
 * reference. `pageComponentSlotPositions()` is derived in `@objectstack/spec`
 * from the `ComponentPropsMap` rows that declare a slot, by SHAPE over the
 * whole family; the rows here place each position on the `page:*` type whose
 * renderer reads it. Held both ways, so a position the spec adds, drops or
 * re-flags is a red here rather than a silent drift.
 */
describe('the `page:*` rows are the spec’s positions, by reference (objectui#11170)', () => {
  const specPositions = pageComponentSlotPositions();
  const asPath = (p: { key: string; panelKey?: string }) => (p.panelKey ? `${p.key}[].${p.panelKey}` : p.key);
  const pageRows = NODE_SLOT_DECLARATIONS.filter((row) => row.types.some((t) => t.startsWith(PAGE_FAMILY_PREFIX)));

  it('every `page:*` row position is one the spec declares, with the spec’s retirement flag', () => {
    expect(pageRows.length).toBeGreaterThan(0);
    const bySpecPath = new Map(specPositions.map((p) => [asPath(p), p]));
    for (const row of pageRows) {
      // A page-family row never mixes in a non-family key: the renderer is the
      // page family's and its positions are the spec's.
      for (const type of row.types) expect(type.startsWith(PAGE_FAMILY_PREFIX), type).toBe(true);
      for (const s of row.slots) {
        const spec = bySpecPath.get(s.path);
        expect(spec, `\`${row.types[0]}\` declares \`${s.path}\`, which the installed spec does not`).toBeDefined();
        expect(s.retired === true, `\`${row.types[0]}.${s.path}\`: retirement disagrees with the spec`).toBe(spec!.retired);
      }
    }
  });

  it('every position the spec declares — `children` aside — is read by at least one `page:*` type', () => {
    const declared = new Set(pageRows.flatMap((row) => row.slots.map((s) => s.path)));
    const unplaced = specPositions.map(asPath).filter((p) => p !== 'children' && !declared.has(p));
    expect(unplaced, 'the spec declares a page slot no `page:*` row places — measure which renderer reads it').toEqual([]);
    // The reading has a population: the spec's list carries the known four.
    expect(specPositions.map(asPath)).toEqual(expect.arrayContaining(['children', 'body', 'footer', 'items[].children']));
  });
});
