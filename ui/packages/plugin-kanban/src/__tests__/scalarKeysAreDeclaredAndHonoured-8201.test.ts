/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8201 — the five SCALAR-armed `object-kanban` keys the renderer
 * honours are DECLARED authoring surface on every tag it is published under.
 *
 * ## The defect this pins closed
 *
 * `@objectstack/spec`'s `ComponentPropsMap['object-kanban']` declares thirteen
 * top-level keys. Both registrations published three of them (four after
 * objectui#8186 added `filter`), while `ObjectKanban.tsx` read five more and
 * changed behaviour on every one. Since `sdui-parser`'s `validate.ts` reports
 * `unknown-prop` for every key no `inputs` entry claims, the html tier told an
 * author that spellings that WORK are unknown — objectui#6678's shape, which
 * trains authors (AI authors included) to delete working metadata.
 *
 * The gap was structural rather than considered: the console registers this
 * block with `registerLazy` and `getConfig` is loaded-only, so the block sat
 * outside the console's reverse-parity population until objectui#8176 loaded
 * it. This file is the per-key pin for the five objectui#8201 judged DECLARE.
 *
 * ## The rows, and what makes each a reading
 *
 * 1. THE HTML TIER ACCEPTS IT — the real validator over a manifest built from
 *    the LIVE registry (never a hand-written one that could agree with itself),
 *    per tag and PER KEY. Splitting the rows per key is what makes this a
 *    per-registration pin rather than a per-file one: dropping one entry from
 *    `OBJECT_KANBAN_INPUTS` reddens the two rows that NAME that key, not an
 *    opaque file failure.
 * 2. THE CONTROL, on the same call — a prop the component genuinely does not
 *    declare is still reported. Without it, row 1's empty array would also be
 *    produced by a validator that reported nothing at all.
 * 3. THE DECLARATION, read straight off the registry, with `objectName` as its
 *    non-vacuity control.
 * 4. THE CONTRACT AGREES — the spec accepts each key (asserted as a KEY
 *    verdict: the name is absent from `unrecognized_keys`) with a bogus key on
 *    the same `safeParse` call proving the zero is a verdict and not a vacuous
 *    read. This row is objectui#8172's lesson made mechanical: `limit` is
 *    taught by four faces and refused BY NAME by this same strict map, so
 *    "the spec declares it" is a claim that must be measured, never assumed.
 * 5. ONE SHARED LIST — both tags are the same renderer, so the declared
 *    surfaces must be the same OBJECT, not two lists that happen to agree.
 * 6. HONOURED, at the read site — `bucketCardsIntoColumns` is the exported,
 *    pure sink for `groupBy` and `coverImageField`, so their honour claim is
 *    asserted here rather than only argued.
 *
 * ## What this file does NOT claim, stated so nobody reads it as claimed
 *
 * `cardTitle`, `titleField` and `swimlaneField` carry rows 1-5 but no row 6.
 * Their resolution is inline in `ObjectKanban`'s `effectiveData` /
 * `effectiveSwimlaneField` memos rather than in an exported resolver, so a
 * behaviour row costs a full data-source render. Their honour verdict rests on
 * the read-site measurement recorded in `index.tsx`'s `OBJECT_KANBAN_INPUTS`
 * docblock, not on an assertion in this file.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
// Module scope, not a hook: this import IS the registration (AGENTS.md's
// test-discipline section — an unbounded module load must not be billed to a
// bounded window).
import { bucketCardsIntoColumns } from '../index';
import '../index';

/**
 * The tag this one renderer is published under.
 *
 * ⚠️ It was a LIST OF TWO — `object-kanban` and `view:kanban` — until
 * objectui#8802 retired the bare `kanban` node type key (maintainer ruling
 * 2026-09-09). The `it.each` shape is deliberately KEPT over the one survivor:
 * the rows below are per-(tag, key), and collapsing them to bare `it`s would
 * make re-adding a tag a rewrite rather than a one-line edit.
 */
const KANBAN_TAGS = [
  { label: 'object-kanban', type: 'object-kanban', namespace: 'plugin-kanban' },
] as const;

/**
 * The five keys objectui#8201 declared, each with a value of the arm the spec
 * accepts. All five are `string`-armed on both sides.
 */
const DECLARED_SCALAR_KEYS = [
  { key: 'groupBy', value: 'stage' },
  { key: 'cardTitle', value: 'name' },
  { key: 'titleField', value: 'name' },
  { key: 'swimlaneField', value: 'owner' },
  { key: 'coverImageField', value: 'thumbnail' },
] as const;

/** Every (tag, key) pair, so a red row names both halves. */
const TAG_KEY_ROWS = KANBAN_TAGS.flatMap((tag) =>
  DECLARED_SCALAR_KEYS.map((entry) => ({ ...tag, ...entry })),
);

const declaredInputNames = (type: string, namespace?: string): string[] =>
  ((ComponentRegistry.getConfig(type, namespace) as any)?.inputs ?? []).map((i: any) => i.name);

/**
 * A manifest built the way `gen-manifest.ts` and the JSX-page compiler build
 * theirs — from the live registry — so these verdicts are the ones a real
 * author gets, not the ones a fixture was written to produce.
 */
const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

/** `unknown-prop` messages a one-node document draws for `props`. */
const unknownProps = (type: string, props: Record<string, unknown>): string[] =>
  validateTree({ type, objectName: 'task', ...props } as never, liveManifest())
    .diagnostics.filter((d) => d.code === 'unknown-prop')
    .map((d) => d.message);

const kanbanSpec = () => (ComponentPropsMap as Record<string, any>)['object-kanban'];

/** The key names a strict parse refuses BY NAME on this block. */
const refusedByName = (props: Record<string, unknown>): string[] => {
  const parsed = kanbanSpec().safeParse(props);
  return parsed.success ? [] : parsed.error.issues.flatMap((issue: any) => issue.keys ?? []);
};

describe('objectui#8201 — object-kanban publishes the scalar keys it reads', () => {
  it.each(TAG_KEY_ROWS)('$label — the html tier accepts an authored `$key`', ({ type, key, value }) => {
    expect(
      unknownProps(type, { [key]: value }),
      `<${type}> reports the spec-declared \`${key}\` as unknown while ObjectKanban honours it`,
    ).toEqual([]);
  });

  it.each(KANBAN_TAGS)('$label — control: a genuinely unknown prop is still reported', ({ type }) => {
    expect(unknownProps(type, { bogusProp: 'x' })).toEqual([`<${type}> has no prop "bogusProp"`]);
  });

  it.each(TAG_KEY_ROWS)('$label — the registration declares `$key`', ({ type, namespace, key }) => {
    const declared = declaredInputNames(type, namespace);
    // Non-vacuity: an empty read (wrong type/namespace) fails this line too,
    // rather than silently satisfying the assertion below it.
    expect(declared, `${type} inputs`).toContain('objectName');
    expect(declared, `${type} inputs`).toContain(key);
  });

  it('the spec accepts all five keys together, so this declares rather than widens', () => {
    const authored = Object.fromEntries(DECLARED_SCALAR_KEYS.map(({ key, value }) => [key, value]));
    const refused = refusedByName({ objectName: 'task', ...authored });
    for (const { key } of DECLARED_SCALAR_KEYS) {
      expect(refused, `the spec refuses \`${key}\` by name`).not.toContain(key);
    }
    // The control for that zero, on the same strict schema: a key it never
    // declared IS refused by name. Without this the assertions above would also
    // pass against a schema that refused nothing (objectui#8172's `limit`).
    expect(refusedByName({ objectName: 'task', bogusProp: 'x' })).toContain('bogusProp');
  });

  it('⛔ the RETIRED `view:kanban` tag resolves to nothing, and the survivor still declares the list', () => {
    // ⭐ This was "both tags publish ONE shared list, so a hand-copy cannot
    // drift" (objectui#8201's row 5). Its second operand RETIRED with the bare
    // `kanban` node type key (objectui#8802), so the sharing claim has nothing
    // left to compare — and the honest replacement is the retirement itself,
    // asserted with the surviving list as its firing control.
    const survivor = (ComponentRegistry.getConfig('object-kanban', 'plugin-kanban') as any)?.inputs;
    expect(survivor, 'object-kanban declares no inputs at all').toBeTruthy();
    expect(survivor.map((i: any) => i.name)).toEqual(
      expect.arrayContaining(DECLARED_SCALAR_KEYS.map(({ key }) => key)),
    );
    // The retired tag: gone from the registry under BOTH spellings it had.
    expect(ComponentRegistry.getConfig('kanban', 'view')).toBeFalsy();
    expect(ComponentRegistry.has('kanban')).toBe(false);
  });

  it('honoured — `groupBy` buckets records into the lane its value names', () => {
    const columns = [
      { id: 'todo', title: 'To Do' },
      { id: 'in_progress', title: 'In Progress' },
    ];
    const data = [
      { id: '1', stage: 'todo' },
      { id: '2', stage: 'in_progress' },
    ];
    const bucketed = bucketCardsIntoColumns(columns, data, 'stage', undefined, 'Uncategorized');
    expect(bucketed.find((c) => c.id === 'todo')!.cards.map((c: any) => c.id)).toEqual(['1']);
    expect(bucketed.find((c) => c.id === 'in_progress')!.cards.map((c: any) => c.id)).toEqual(['2']);
    // The control for that read: the SAME rows with no `groupBy` reach no lane,
    // so the split above is the key doing work rather than the fixture.
    const ungrouped = bucketCardsIntoColumns(columns, data, undefined, undefined, 'Uncategorized');
    expect(ungrouped.every((c) => c.cards.length === 0)).toBe(true);
  });

  it('honoured — `coverImageField` becomes the card cover `KanbanImpl` renders', () => {
    const columns = [{ id: 'todo', title: 'To Do' }];
    const data = [
      { id: '1', stage: 'todo', thumbnail: 'https://cdn.example/a.png' },
      // The file-object spelling the mapper also accepts.
      { id: '2', stage: 'todo', thumbnail: { url: 'https://cdn.example/b.png' } },
      // Neither a URL string nor a `{ url }` — must stay uncovered.
      { id: '3', stage: 'todo', thumbnail: 42 },
    ];
    const cards = bucketCardsIntoColumns(columns, data, 'stage', 'thumbnail', 'Uncategorized')[0]
      .cards as any[];
    expect(cards.map((c) => c.coverImage)).toEqual([
      'https://cdn.example/a.png',
      'https://cdn.example/b.png',
      undefined,
    ]);
    // The control: without the key, the same rows carry no cover at all.
    const uncovered = bucketCardsIntoColumns(columns, data, 'stage', undefined, 'Uncategorized')[0]
      .cards as any[];
    expect(uncovered.map((c) => c.coverImage)).toEqual([undefined, undefined, undefined]);
  });
});
