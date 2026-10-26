/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10222 — `ListView` reads no timeline `metaFields` list any more.
 *
 * Ruling batch #223 item 5b, letter A (comment 5824012155 on the card): every
 * undeclared `metaFields` read is deleted in both packages. The spec's
 * `TimelineConfigSchema` is a strict object that declares no such member, so
 * the only way the key reached this projection was a stored view's unjudged
 * `options` bag (objectui#10380). `ListView` read it three times:
 *
 *   1. the `expandFields` collector, which put a lookup named there into
 *      `$expand` (and so, through the expand roots, into `$select`);
 *   2. the `$select` collector, which put every field named there into
 *      `$select`;
 *   3. the status / priority auto-projection, which was SKIPPED whenever the
 *      block carried the list.
 *
 * All three are gone. The timeline's chips are now always the built-in
 * status / priority pair (`plugin-timeline`'s
 * `ObjectTimeline.metaFieldsRetired-10222.test.tsx` pins that half), so the
 * projection must always fetch those two for a timeline view. ⛔ `cardFields`
 * is the reserved spelling for authored chip fields; nothing is declared here.
 *
 * ## What each pin discriminates
 *
 * - IDENTICAL: a timeline view with no `metaFields` projects exactly what it
 *   projected before this change. The expected array was measured on the base
 *   tree before any edit and is green there too.
 * - PROJECTION: `metaFields: ['region']` no longer adds `region`, and status /
 *   priority are still projected. On the base tree `region` was added and
 *   status / priority were dropped, so this pin goes red if read 2 or read 3
 *   comes back.
 * - EXPAND: a lookup named only in `metaFields` is neither expanded nor
 *   selected. On the base tree it was both, so this pin goes red if read 1
 *   comes back.
 * - The nested `options.timeline` spelling is the one the bypass actually
 *   delivers, so it is pinned too, with and without a `timeline` block beside
 *   it.
 * - SOURCE: no `metaFields` identifier or string key is left in the non-test
 *   source of this package OR `plugin-timeline`, with firing controls on the
 *   same scanner. `plugin-timeline`'s scan lives here, not in that package,
 *   because only this package's `tsconfig.test.json` names the `node` types a
 *   disk read needs.
 *
 * `region` is deliberately NOT a column here. In
 * `ListView.speculativeFls-7216.test.tsx` it is, which is why that file's
 * PIN 4 could not tell the binding path from the column path.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

const OBJECT = 'duly_task';

const objectDef = {
  name: OBJECT,
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text', label: 'Name' },
    start_date: { name: 'start_date', type: 'date', label: 'Start' },
    region: { name: 'region', type: 'select', label: 'Region' },
    status: { name: 'status', type: 'select', label: 'Status' },
    priority: { name: 'priority', type: 'select', label: 'Priority' },
    account: { name: 'account', type: 'lookup', label: 'Account', reference: 'account' },
  },
};

/**
 * `plugin-list` does not depend on `plugin-timeline`, so nothing else answers
 * `object-timeline` in this file: every `find` recorded below is `ListView`'s
 * own projection, never a second query from a mounted timeline.
 */
ComponentRegistry.register(
  'object-timeline',
  () => <div data-testid="timeline-spy" />,
  { namespace: 'test', label: 'Timeline spy', category: 'view' },
);

const TIMELINE = { startDateField: 'start_date', titleField: 'name' };

/** Mount a timeline list view and return the params of its last `find`. */
async function paramsFor(schemaExtra: Record<string, unknown>) {
  const find = vi.fn(async (..._args: unknown[]) => ({ data: [], total: 0 }));
  // Cast at the prop: a stub, and a schema that carries a key the type refuses.
  const dataSource = {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  } as unknown as React.ComponentProps<typeof ListView>['dataSource'];
  const schema = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'timeline',
    columns: ['name'],
    timeline: TIMELINE,
    ...schemaExtra,
  } as unknown as React.ComponentProps<typeof ListView>['schema'];
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={schema} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(find).toHaveBeenCalled());
  const call = (find.mock.calls.at(-1)?.[1] ?? {}) as { $select?: string[]; $expand?: string[] };
  return {
    select: call.$select ?? [],
    expand: call.$expand ?? [],
  };
}

afterEach(() => cleanup());

describe('ListView — the timeline `metaFields` reads are retired (objectui#10222)', () => {
  it('IDENTICAL: a timeline view with no `metaFields` projects what it projected before the change', async () => {
    const { select } = await paramsFor({});
    expect(
      select,
      'measured on the base tree before any edit; the auto-projection became unconditional, '
        + 'so the view that never carried the key must not move',
    ).toEqual(['id', 'name', 'start_date', 'status', 'priority']);
  });

  it('PROJECTION: `metaFields` adds nothing, and status / priority are still projected', async () => {
    const { select } = await paramsFor({
      timeline: { ...TIMELINE, metaFields: ['region'] },
    });
    expect(select, 'the retired key must not reach `$select`').not.toContain('region');
    expect(
      select,
      'the timeline always renders the built-in status / priority chips now, so their values '
        + 'must be fetched even when the block carries the retired key',
    ).toEqual(expect.arrayContaining(['status', 'priority']));
    expect(select, 'the key changes nothing at all').toEqual(
      ['id', 'name', 'start_date', 'status', 'priority'],
    );
  });

  it('PROJECTION, `options.timeline` beside a `timeline` block: the bypass spelling adds nothing either', async () => {
    const { select } = await paramsFor({
      options: { timeline: { metaFields: ['region'] } },
    });
    expect(select).not.toContain('region');
    expect(select).toEqual(expect.arrayContaining(['status', 'priority']));
  });

  it('PROJECTION, `options.timeline` alone: status / priority are no longer dropped', async () => {
    const { select } = await paramsFor({
      timeline: undefined,
      options: { timeline: { ...TIMELINE, metaFields: ['region'] } },
    });
    expect(select).not.toContain('region');
    expect(
      select,
      'on the base tree this shape fetched no status / priority at all, so its timeline drew '
        + 'no chips once the renderer stopped reading the list',
    ).toEqual(expect.arrayContaining(['status', 'priority']));
  });

  it('EXPAND: a lookup named only in `metaFields` is neither expanded nor selected', async () => {
    const { select, expand } = await paramsFor({
      timeline: { ...TIMELINE, metaFields: ['account'] },
    });
    expect(expand, 'the `expandFields` collector read the retired key').not.toContain('account');
    expect(select, 'the expand roots are unioned into `$select`').not.toContain('account');
  });

  it('EXPAND control: the same lookup named in `columns` IS expanded', async () => {
    const { expand } = await paramsFor({ columns: ['name', 'account'] });
    expect(
      expand,
      'without this the pin above could pass because nothing is ever expanded here',
    ).toContain('account');
  });
});

// ── SOURCE: no `metaFields` read left in either package ───────────────────
//
// Both packages' scans live here because this package's `tsconfig.test.json`
// names the `node` types a disk read needs and `plugin-timeline`'s does not.

/** Rooted at THIS file, never at `process.cwd()`. */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const RETIRED = 'metaFields';

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

/**
 * The 1-based lines where `name` is used as CODE: an identifier (`x.name`,
 * `x?.name`, `{ name }`, `name:`) or a string literal (`x['name']`,
 * `'name' in x`). Comments are trivia, not tokens, so prose naming the retired
 * key is not a read.
 */
function codeUses(text: string, file: string, name: string): number[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: number[] = [];
  const walk = (node: ts.Node): void => {
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === name) {
      hits.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return hits;
}

/**
 * Each package's non-test source, the file that held its read(s), and an
 * identifier read beside the retired one in that file (the firing control).
 */
const PACKAGES = [
  // `visibleFields`, not the `cardFields` this named until objectui#6152 round 14
  // pruned that alias from the collectors: the control must be a key the
  // collectors still read, beside the retired one.
  { pkg: 'plugin-list', holder: 'ListView.tsx', sibling: 'visibleFields' },
  { pkg: 'plugin-timeline', holder: 'ObjectTimeline.tsx', sibling: 'colorField' },
] as const;

describe.each(PACKAGES)('SOURCE: no `metaFields` read remains in $pkg (objectui#10222)', ({ pkg, holder, sibling }) => {
  const src = join(REPO_ROOT, 'packages', pkg, 'src');
  const files = sourceFiles(src);
  const rel = (f: string) => relative(src, f).replace(/\\/g, '/');

  it(`POPULATION: the scan covers ${holder}, the file that held the read`, () => {
    expect(files.map(rel)).toContain(holder);
  });

  it('no non-test source names `metaFields` as code', () => {
    // The location string is computed here for the failure message only.
    const hits = files.flatMap((f) =>
      codeUses(readFileSync(f, 'utf8'), rel(f), RETIRED).map((line) => `${pkg}/src/${rel(f)} line ${line}`));
    expect(hits, 'a `metaFields` read came back; the key is undeclared (objectui#10222)').toEqual([]);
  });

  it(`FIRING CONTROL: the same scanner finds \`${sibling}\`, read beside it in ${holder}`, () => {
    const file = files.find((f) => rel(f) === holder)!;
    expect(codeUses(readFileSync(file, 'utf8'), holder, sibling).length).toBeGreaterThan(0);
  });
});

it('SOURCE FIRING CONTROL: the scanner catches each shape the retired reads took, and skips comments', () => {
  const probe = [
    '// metaFields in a comment is prose',
    'const a = (timelineConfig as any)?.metaFields;',
    'const b = tCfg?.metaFields;',
    "const c = v['metaFields'];",
    'const { metaFields } = v;',
  ].join('\n');
  expect(codeUses(probe, 'probe.ts', RETIRED), 'the probe lines, 1-based').toEqual([2, 3, 4, 5]);
});
