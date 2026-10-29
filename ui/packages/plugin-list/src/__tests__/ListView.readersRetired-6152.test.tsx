/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6152 round 14 — `ListView` reads each per-kind block by its DECLARED
 * keys only.
 *
 * Rounds 11 and 12 closed the doors: every list-view door refuses the pre-#2231
 * aliases, `calendar.defaultView` and any undeclared key of these blocks, in
 * both nestings. The readers stayed, so a stored row still rendered as written.
 * This round retired them. What each describe pins, on the node `ListView`
 * generates (read through a registry spy, the only place most of these were
 * ever observable):
 *
 *   1. A block key named like a NODE key no longer overrides the node's own
 *      value. The raw spreads (`...restKanban`, `...restCalendar`, the two gantt
 *      spreads, `...treeCfg`, `options.grid`) landed after the node's keys, so a
 *      stored `objectName` replaced the node's (measured on round 13 as K8).
 *      Pinned once, on every branch that had such a spread.
 *   2. The DECLARED keys keep their route. The spreads also carried keys the
 *      spec declares and nothing else read by name: `kanban.summarizeField`,
 *      `calendar.colorField` / `allDayField`, and the whole gantt block. The
 *      gantt arm is driven off the spec's own shape, so it pins the relation
 *      (every declared key arrives) rather than a copy of the list.
 *   3. The retired keys reach nothing, each beside a CONTROL that writes the
 *      spec key in the same position, so no zero below is vacuous.
 *
 * Most fixtures sat in the legacy `options` bag; the arms in describe 4 write
 * the TOP-LEVEL spelling, which `normalizeListViewSchema` (`@object-ui/core`)
 * used to fold onto the spec key before `ListView` read anything. That fold
 * retired in the same round, so both nestings answered the same.
 *
 * objectstack#25923 retired the bag itself: a stored bag is folded onto the
 * top-level blocks by the server before the row is served, and `ListView`
 * reads no `options`. So the bag fixtures moved to the top-level block, the
 * one nesting left, and each "from either nesting" arm now pins that the bag
 * half reaches nothing. (`options.grid` stays a bag fixture: a grid has no
 * per-kind block for it to move to.)
 *
 * The SOURCE describe at the end pins the same retirement on the code: no
 * non-test file in this package reads `options` off a list schema.
 *
 * H2 of the dispatch (removing the flat `imageField` loses nothing, because the
 * nested `coverField` already reaches `ObjectGallery`) is measured at the end:
 * the node this file captures is handed to the REAL `ObjectGallery`.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen, cleanup } from '@testing-library/react';
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import { ListView, resolveTimelineDateBinding } from '../ListView';
import { ObjectGallery } from '../ObjectGallery';

const OBJECT = 'deal';
const HIJACK = 'HIJACK_FROM_THE_BLOCK';

const objectDef = {
  name: OBJECT,
  label: 'Deal',
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    name: { name: 'name', type: 'text', label: 'Name' },
    owner: { name: 'owner', type: 'text', label: 'Owner' },
    stage: {
      name: 'stage',
      type: 'select',
      label: 'Stage',
      options: [
        { label: 'New', value: 'new' },
        { label: 'Won', value: 'won' },
      ],
    },
    amount: { name: 'amount', type: 'number', label: 'Amount' },
    due: { name: 'due', type: 'date', label: 'Due' },
    lane: { name: 'lane', type: 'text', label: 'Swim lane' },
    cover: { name: 'cover', type: 'image', label: 'Cover' },
    parent: { name: 'parent', type: 'lookup', label: 'Parent', reference_to: OBJECT },
  },
};

const rows = [
  { id: 'r1', name: 'Alpha', owner: 'ada', stage: 'new', amount: 3, due: '2099-01-02', lane: 'x', cover: 'https://cdn.example.com/a.png' },
];

const KINDS = ['object-kanban', 'object-calendar', 'object-gantt', 'object-tree', 'object-grid', 'object-gallery'] as const;
let nodes: Record<string, Array<Record<string, any>>> = {};
let findCalls: Array<Record<string, any>> = [];

for (const kind of KINDS) {
  ComponentRegistry.register(
    kind,
    (props: Record<string, any>) => {
      (nodes[kind] ??= []).push(props.schema);
      return <div data-testid={`${kind}-spy`} />;
    },
    { namespace: 'test', label: `${kind} spy`, category: 'view' },
  );
}

const makeDataSource = () =>
  ({
    find: vi.fn(async (_object: string, query: Record<string, any>) => {
      findCalls.push(query ?? {});
      return rows;
    }),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => rows.length),
    getObjectSchema: vi.fn(async () => objectDef),
    getObjects: vi.fn(async () => []),
    onMutation: () => () => {},
  }) as any;

const VIEW_TYPE: Record<(typeof KINDS)[number], string> = {
  'object-kanban': 'kanban',
  'object-calendar': 'calendar',
  'object-gantt': 'gantt',
  'object-tree': 'tree',
  'object-grid': 'grid',
  'object-gallery': 'gallery',
};

/** Mount `ListView` on a stored view and return the last node of `kind` it generated. */
async function generatedNode(kind: (typeof KINDS)[number], view: Record<string, unknown>) {
  // Per mount, so an arm that mounts twice reads its own node, not the first's:
  // the previous mount is unmounted (a late re-render of it cannot push here).
  cleanup();
  nodes[kind] = [];
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      {/* `as never`: the fixtures carry keys the typed face refuses by name;
          a row stored before the doors closed may still carry them, and this
          file pins what the renderer does with them. */}
      <ListView
        schema={{ type: 'list-view', objectName: OBJECT, viewType: VIEW_TYPE[kind], columns: ['name'], ...view } as never}
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(nodes[kind]?.length ?? 0).toBeGreaterThan(0));
  return nodes[kind]![nodes[kind]!.length - 1];
}

beforeEach(() => {
  cleanup();
  nodes = {};
  findCalls = [];
});

describe('1 · a block key named like a node key no longer overrides the node (objectui#6152 round 14)', () => {
  const ARMS: Array<[(typeof KINDS)[number], Record<string, unknown>, (node: Record<string, any>) => void]> = [
    ['object-kanban', { kanban: { groupByField: 'owner', objectName: HIJACK } }, (n) => expect(n.groupBy).toBe('owner')],
    ['object-calendar', { calendar: { startDateField: 'due', objectName: HIJACK } }, (n) => expect(n.calendar?.startDateField).toBe('due')],
    ['object-gantt', { gantt: { startDateField: 'due', endDateField: 'due', objectName: HIJACK } }, (n) => expect(n.gantt?.startDateField).toBe('due')],
    ['object-tree', { tree: { parentField: 'parent', objectName: HIJACK } }, (n) => expect(n.parentField).toBe('parent')],
    ['object-grid', { options: { grid: { objectName: HIJACK } } }, () => {}],
  ];

  for (const [kind, view, blockWasRead] of ARMS) {
    it(`${kind}: the node keeps its own \`objectName\``, async () => {
      const node = await generatedNode(kind, view);
      // LIT CONTROL: the block itself was read (its declared binding arrived),
      // so the absence below is about the stray key, not about an unread block.
      blockWasRead(node);
      expect(node.objectName).toBe(OBJECT);
      expect(JSON.stringify(node)).not.toContain(HIJACK);
    });
  }
});

describe('2 · the declared keys keep their route (objectui#6152 round 14)', () => {
  it('kanban: `summarizeField` reaches the board from the block; a retired bag\'s reaches nothing (objectstack#25923)', async () => {
    expect((await generatedNode('object-kanban', { kanban: { groupByField: 'stage', summarizeField: 'amount' } })).summarizeField).toBe('amount');
    cleanup();
    expect((await generatedNode('object-kanban', { options: { kanban: { groupByField: 'stage', summarizeField: 'amount' } } })).summarizeField).toBeUndefined();
  });

  it('calendar: `colorField` and `allDayField` reach the calendar from the block; a retired bag\'s reach nothing (objectstack#25923)', async () => {
    const top = await generatedNode('object-calendar', { calendar: { startDateField: 'due', colorField: 'stage', allDayField: 'amount' } });
    // objectstack#25923 — the five ride the node's own `calendar` block, never flat.
    expect([top.calendar?.colorField, top.calendar?.allDayField]).toEqual(['stage', 'amount']);
    cleanup();
    const bag = await generatedNode('object-calendar', { options: { calendar: { startDateField: 'due', colorField: 'stage', allDayField: 'amount' } } });
    expect([bag.calendar?.colorField, bag.calendar?.allDayField]).toEqual([undefined, undefined]);
  });

  it('gantt: EVERY key the spec declares on the block reaches the gantt, and a bag beside it adds nothing (objectstack#25923)', async () => {
    // Driven off the spec's own shape, so a key the spec adds is asked for
    // here as well as at `tsc` (the table in `ListView.tsx` is typed total).
    const declared = Object.keys(SpecListViewSchema.shape.gantt.unwrap().shape);
    expect(declared.length).toBeGreaterThan(20);
    const block = Object.fromEntries(declared.map((k) => [k, `BLOCK_${k}`]));
    const bag = Object.fromEntries(declared.map((k) => [k, `BAG_${k}`]));
    const node = await generatedNode('object-gantt', { gantt: block, options: { gantt: { ...bag, onlyInTheBag: 'x' } } });
    // objectstack#25923 — they reach it as the node's own `gantt` block, never flat.
    for (const k of declared) expect(node.gantt?.[k], k).toBe(`BLOCK_${k}`);
    for (const k of declared) expect(k in node, `flat ${k}`).toBe(false);
    expect('onlyInTheBag' in node.gantt).toBe(false);
    expect('onlyInTheBag' in node).toBe(false);
  });
});

describe('3 · the retired keys reach nothing (objectui#6152 round 14)', () => {
  it('kanban: a block `groupField` names no lane; the lane falls to the detector, as with no key', async () => {
    const alias = await generatedNode('object-kanban', { kanban: { groupField: 'owner' } });
    cleanup();
    const none = await generatedNode('object-kanban', { kanban: {} });
    cleanup();
    const control = await generatedNode('object-kanban', { kanban: { groupByField: 'owner' } });
    expect(control.groupBy).toBe('owner');
    expect(alias.groupBy).toBe(none.groupBy);
    expect(alias.groupBy).not.toBe('owner');
  });

  it('kanban: a block `cardFields` shows nothing; `columns` does', async () => {
    const alias = await generatedNode('object-kanban', { kanban: { groupByField: 'stage', cardFields: ['amount'] } });
    cleanup();
    const control = await generatedNode('object-kanban', { kanban: { groupByField: 'stage', columns: ['amount'] } });
    expect(control.cardFields).toEqual(['amount']);
    expect(alias.cardFields).not.toEqual(['amount']);
  });

  it('kanban: `swimlaneField` reaches neither the board nor the query', async () => {
    const node = await generatedNode('object-kanban', { kanban: { groupByField: 'stage', summarizeField: 'amount', swimlaneField: 'lane' } });
    expect('swimlaneField' in node).toBe(false);
    await waitFor(() => expect(findCalls.length).toBeGreaterThan(0));
    const selects = findCalls.map((q) => String(q.$select ?? q.select ?? ''));
    // CONTROL: the declared `summarizeField` in the same block IS fetched.
    expect(selects.some((s) => s.split(',').includes('amount'))).toBe(true);
    expect(selects.some((s) => s.split(',').includes('lane'))).toBe(false);
  });

  it('calendar: `defaultView` is not lifted, from the block or a retired bag, and an undeclared key is not forwarded', async () => {
    const top = await generatedNode('object-calendar', { calendar: { startDateField: 'due', defaultView: 'week', zzzUndeclared: 1 } });
    expect(top.calendar?.startDateField).toBe('due');
    for (const where of [top, top.calendar]) {
      expect('defaultView' in where).toBe(false);
      expect('zzzUndeclared' in where).toBe(false);
    }
    cleanup();
    const bag = await generatedNode('object-calendar', { options: { calendar: { startDateField: 'due', defaultView: 'week' } } });
    expect('defaultView' in bag).toBe(false);
    expect(bag.calendar?.defaultView).toBeUndefined();
  });

  it('gallery: a block `imageField` binds no cover on the node; `coverField` does, nested', async () => {
    const alias = await generatedNode('object-gallery', { gallery: { imageField: 'cover' } });
    expect('imageField' in alias).toBe(false);
    expect(alias.gallery?.coverField).toBeUndefined();
    cleanup();
    const control = await generatedNode('object-gallery', { gallery: { coverField: 'cover' } });
    expect(control.gallery?.coverField).toBe('cover');
  });

  it('timeline: `dateField` is no axis in any of the four sources (the two bag ones are unread since objectstack#25923); `startDateField` is', () => {
    for (const src of [
      { timeline: { dateField: 'due' } },
      { options: { timeline: { dateField: 'due' } } },
      { calendar: { dateField: 'due' } },
      { options: { calendar: { dateField: 'due' } } },
    ]) {
      expect(resolveTimelineDateBinding(src).startDateField, JSON.stringify(src)).toBeUndefined();
    }
    expect(resolveTimelineDateBinding({ timeline: { startDateField: 'due' } }).startDateField).toBe('due');
    expect(resolveTimelineDateBinding({ calendar: { startDateField: 'due' } }).startDateField).toBe('due');
  });

  it('tree: `titleField` labels nothing and is not forwarded; `labelField` labels', async () => {
    const alias = await generatedNode('object-tree', { tree: { parentField: 'parent', titleField: 'owner', zzzUndeclared: 1 } });
    expect(alias.labelField).toBe('name');
    expect('titleField' in alias).toBe(false);
    expect('zzzUndeclared' in alias).toBe(false);
    cleanup();
    const control = await generatedNode('object-tree', { tree: { parentField: 'parent', labelField: 'owner' } });
    expect(control.labelField).toBe('owner');
  });

  it('grid: nothing under `options.grid` reaches the grid', async () => {
    const node = await generatedNode('object-grid', { options: { grid: { zzzUndeclared: 1, wrapHeaders: true } } });
    expect('zzzUndeclared' in node).toBe(false);
    expect('wrapHeaders' in node).toBe(false);
    cleanup();
    // CONTROL: the same key as a top-level key of the view does reach it.
    const control = await generatedNode('object-grid', { wrapHeaders: true });
    expect(control.wrapHeaders).toBe(true);
  });
});

describe('4 · the TOP-LEVEL aliases the core fold used to rewrite reach nothing either (objectui#6152 round 14)', () => {
  it('kanban: `groupField` names no lane and `cardFields` shows nothing', async () => {
    const alias = await generatedNode('object-kanban', { kanban: { groupField: 'owner', cardFields: ['amount'] } });
    const none = await generatedNode('object-kanban', { kanban: {} });
    const control = await generatedNode('object-kanban', { kanban: { groupByField: 'owner', columns: ['amount'] } });
    expect([control.groupBy, control.cardFields]).toEqual(['owner', ['amount']]);
    expect(alias.groupBy).toBe(none.groupBy);
    expect(alias.cardFields).not.toEqual(['amount']);
  });

  it('gallery: `imageField` binds no cover', async () => {
    const alias = await generatedNode('object-gallery', { gallery: { imageField: 'cover' } });
    expect(alias.gallery?.coverField).toBeUndefined();
  });

  it('timeline: `dateField` is no axis', () => {
    expect(resolveTimelineDateBinding({ timeline: { dateField: 'due' } }).startDateField).toBeUndefined();
  });
});

describe('H2 · the nested `coverField` is the gallery cover; the flat `imageField` carried nothing more', () => {
  const visibleCoverImg = (container: HTMLElement): HTMLImageElement | null =>
    Array.from(container.querySelectorAll('img')).find((el) => !el.closest('[hidden]')) ?? null;

  /** Hand the node `ListView` built to the REAL `ObjectGallery`. */
  async function renderRealGallery(node: Record<string, any>) {
    cleanup();
    const dataSource = makeDataSource();
    const { container } = render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGallery schema={node as never} dataSource={dataSource} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    return container;
  }

  it('a top-level `gallery.coverField` draws the cover with no flat `imageField` on the node', async () => {
    const node = await generatedNode('object-gallery', { gallery: { coverField: 'cover' } });
    expect('imageField' in node).toBe(false);
    const container = await renderRealGallery(node);
    await waitFor(() => expect(visibleCoverImg(container)?.getAttribute('src')).toBe('https://cdn.example.com/a.png'));
  });

  it('RETIRED (objectstack#25923): the bag `options.gallery.coverField` draws no cover', async () => {
    const node = await generatedNode('object-gallery', { options: { gallery: { coverField: 'cover' } } });
    const container = await renderRealGallery(node);
    expect(visibleCoverImg(container)).toBeNull();
  });

  it('the retired `imageField` draws no cover (the gallery falls to its own `image` floor)', async () => {
    const node = await generatedNode('object-gallery', { gallery: { imageField: 'cover' } });
    const container = await renderRealGallery(node);
    expect(visibleCoverImg(container)).toBeNull();
  });
});

// ── SOURCE: no `options` bag read left in this package (objectstack#25923) ──

/** Rooted at THIS file, never at `process.cwd()`. */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every non-test `.ts` / `.tsx` file under `dir`. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** `x`, with any wrapping parentheses, `as` casts and `!` taken off. */
function bare(node: ts.Expression): ts.Expression {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)) n = n.expression;
  return n;
}

/**
 * The 1-based lines where a list schema's `KEY` member is read as code:
 * `schema.KEY`, `schema?.KEY`, `(schema as any).KEY`, `props.schema.KEY`,
 * `schema['KEY']`. Comments are trivia, not tokens, so prose is not a read.
 */
function schemaMemberReads(text: string, file: string, key: string): number[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const isSchema = (e: ts.Expression) => {
    const b = bare(e);
    return (ts.isIdentifier(b) && b.text === 'schema') || (ts.isPropertyAccessExpression(b) && b.name.text === 'schema');
  };
  const hits: number[] = [];
  const walk = (node: ts.Node): void => {
    const named =
      (ts.isPropertyAccessExpression(node) && node.name.text === key) ||
      (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === key);
    if (named && isSchema((node as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression)) {
      hits.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return hits;
}

describe('SOURCE: no non-test file in plugin-list reads a list schema\'s `options` (objectstack#25923)', () => {
  const files = sourceFiles(SRC);
  const rel = (f: string) => relative(SRC, f).replace(/\\/g, '/');

  it('POPULATION: the scan covers ListView.tsx and index.tsx, the files that held the reads and the input', () => {
    expect(files.map(rel)).toEqual(expect.arrayContaining(['ListView.tsx', 'index.tsx']));
  });

  it('no `schema.options` read is left', () => {
    // The location string is computed here for the failure message only.
    const hits = files.flatMap((f) =>
      schemaMemberReads(readFileSync(f, 'utf8'), rel(f), 'options').map((line) => `plugin-list/src/${rel(f)} line ${line}`));
    expect(hits, 'a bag read came back; the server folds a stored bag onto the blocks (objectstack#25923)').toEqual([]);
  });

  it('FIRING CONTROL: the same scanner finds `schema.kanban`, the block read in ListView.tsx', () => {
    const file = files.find((f) => rel(f) === 'ListView.tsx')!;
    expect(schemaMemberReads(readFileSync(file, 'utf8'), 'ListView.tsx', 'kanban').length).toBeGreaterThan(0);
  });

  it('FIRING CONTROL: the scanner catches each shape the retired reads took, and skips comments and other objects', () => {
    const probe = [
      '// schema.options?.kanban in a comment is prose',
      'const a = schema.options?.kanban;',
      'const b = (schema as any).options?.gantt;',
      'const c = props.schema.options;',
      "const d = schema['options'];",
      'const e = field.options;',
      'const f = schema?.options;',
    ].join('\n');
    expect(schemaMemberReads(probe, 'probe.ts', 'options'), 'the probe lines, 1-based').toEqual([2, 3, 4, 5, 7]);
  });
});
