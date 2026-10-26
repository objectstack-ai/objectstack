/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8313 — the four ARRAY/OBJECT-armed `object-kanban` keys the renderer
 * honours are DECLARED authoring surface on every tag it is published under.
 *
 * ## What this file is, and what it deliberately is not
 *
 * This is the DECLARATION half, and it is the direct sibling of
 * `scalarKeysAreDeclaredAndHonoured-8201.test.ts` next door — same rows, same
 * instruments, one slice later. It asserts that `data`, `cardFields`,
 * `grouping` and `conditionalFormatting` are discoverable: the html tier stops
 * reporting them as `unknown-prop`, both registrations publish them, and the
 * strict `ComponentPropsMap` does not refuse them by name.
 *
 * ⛔ It says NOTHING about what is inside any of the four, and it cannot. Its
 * spec row is a KEY verdict — the name is absent from `unrecognized_keys` —
 * which is the right assertion for a discoverability claim and the wrong one
 * for a member claim. Since objectui#8212, an array/object-armed declaration
 * owes a MEMBER claim as well, and that is a separate file:
 * `ObjectKanban.structuredMembersReachTheirSinks-8313.test.tsx`, registered as
 * the `MEMBER_PINS` entry of all four keys. The split is the same one
 * objectui#8176 drew between `filterIsDeclaredInput-7712.test.ts` and
 * `ObjectKanban.filterMembersReachTheWire-8176.test.tsx`.
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
 *    non-vacuity control, and the declared ARM asserted alongside the name.
 *    The arm is load-bearing here in a way it was not for the scalar slice: it
 *    is what puts the key into the parity gate's `structuredInputs` population
 *    and therefore what makes a `MEMBER_PINS` entry owed at all. A key declared
 *    `string` would publish the same name and quietly owe nothing.
 * 4. THE CONTRACT AGREES — the spec accepts each key (asserted as a KEY
 *    verdict: the name is absent from `unrecognized_keys`) with a bogus key on
 *    the same `safeParse` call proving the zero is a verdict and not a vacuous
 *    read. This row is objectui#8172's lesson made mechanical: `limit` is
 *    taught by four faces and refused BY NAME by this same strict map, so
 *    "the spec declares it" is a claim that must be measured, never assumed.
 * 5. ONE SHARED LIST — both tags are the same renderer, so the declared
 *    surfaces must be the same OBJECT, not two lists that happen to agree.
 *
 * ## What the spec can and cannot supply here, measured
 *
 * Read off `ComponentPropsMap['object-kanban']` on the installed spec: `data`
 * is `z.array(z.unknown()).optional()`, `cardFields` is
 * `z.array(z.string()).optional()` and `conditionalFormatting` is
 * `z.unknown().optional()`. `grouping` is TYPED: the row holds the list view's
 * own `GroupingConfigSchema` by reference (`{ fields: [{ field, order?,
 * collapsed? }] }`, closed, at least one entry), and both faces of
 * `@object-ui/types` judge the key by that same schema since objectui#11216 —
 * re-derived per run by `object-kanban-grouping-typed-11216.test.ts` in that
 * package rather than by this sentence. So the contract fixes the container
 * kind of `data` and `cardFields`, constrains `conditionalFormatting` not at
 * all, and fixes the SHAPE of `grouping` — but for none of the four does it say
 * which member this board reads (`grouping`'s schema is the list view's, whose
 * grid reads every entry; this board reads `fields[0].field` only). That is why
 * row 4 is a key verdict and why the member file exists: what the board does
 * with a member is the read site's alone.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
// Module scope, not a hook: this import IS the registration (AGENTS.md's
// test-discipline section — an unbounded module load must not be billed to a
// bounded window).
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
 * The four keys objectui#8313 declared: the value the spec accepts, and the
 * ARM the registration declares for it.
 *
 * The `arm` column is asserted, not decorative. `structuredInputs` in the
 * console's parity gate is keyed off the DECLARED arm, so it is the arm — not
 * the name — that decides whether a `MEMBER_PINS` entry is owed.
 */
const DECLARED_STRUCTURED_KEYS = [
  { key: 'data', arm: 'array', value: [{ id: 'd1', status: 'open' }] },
  { key: 'cardFields', arm: 'array', value: ['amount', 'owner'] },
  { key: 'grouping', arm: 'object', value: { fields: [{ field: 'owner' }] } },
  {
    key: 'conditionalFormatting',
    arm: 'array',
    // `{ condition, style }`: respelled (objectui#11522) from the retired native
    // `{ field: 'owner', operator: 'equals', value: 'ann', backgroundColor }`.
    value: [{ condition: "record.owner == 'ann'", style: { backgroundColor: '#eef' } }],
  },
] as const;

/** Every (tag, key) pair, so a red row names both halves. */
const TAG_KEY_ROWS = KANBAN_TAGS.flatMap((tag) =>
  DECLARED_STRUCTURED_KEYS.map((entry) => ({ ...tag, ...entry })),
);

const declaredInputEntries = (type: string, namespace?: string): any[] =>
  ((ComponentRegistry.getConfig(type, namespace) as any)?.inputs ?? []) as any[];

const declaredInputNames = (type: string, namespace?: string): string[] =>
  declaredInputEntries(type, namespace).map((i: any) => i.name);

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

describe('objectui#8313 — object-kanban publishes the array/object-armed keys it reads', () => {
  it.each(TAG_KEY_ROWS)('$label — the html tier accepts an authored `$key`', ({ type, key, value }) => {
    expect(
      unknownProps(type, { [key]: value }),
      `<${type}> reports the spec-declared \`${key}\` as unknown while ObjectKanban honours it`,
    ).toEqual([]);
  });

  it.each(KANBAN_TAGS)('$label — control: a genuinely unknown prop is still reported', ({ type }) => {
    expect(unknownProps(type, { bogusProp: 'x' })).toEqual([`<${type}> has no prop "bogusProp"`]);
  });

  it.each(TAG_KEY_ROWS)('$label — the registration declares `$key` as `$arm`', ({ type, namespace, key, arm }) => {
    const declared = declaredInputNames(type, namespace);
    // Non-vacuity: an empty read (wrong type/namespace) fails this line too,
    // rather than silently satisfying the assertions below it.
    expect(declared, `${type} inputs`).toContain('objectName');
    expect(declared, `${type} inputs`).toContain(key);
    // The ARM, because it is what makes the member obligation exist. A key
    // re-declared `string` would keep row 1 and row 3's name assertion green
    // while leaving the parity gate's member population — and so its
    // `MEMBER_PINS` requirement — silently behind.
    const entry = declaredInputEntries(type, namespace).find((i: any) => i.name === key);
    expect(entry?.type, `${type}.${key} declared arm`).toBe(arm);
  });

  it('the spec accepts all four keys together, so this declares rather than widens', () => {
    const authored = Object.fromEntries(
      DECLARED_STRUCTURED_KEYS.map(({ key, value }) => [key, value]),
    );
    const refused = refusedByName({ objectName: 'task', ...authored });
    for (const { key } of DECLARED_STRUCTURED_KEYS) {
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
      expect.arrayContaining(DECLARED_STRUCTURED_KEYS.map(({ key }) => key)),
    );
    // The retired tag: gone from the registry under BOTH spellings it had.
    expect(ComponentRegistry.getConfig('kanban', 'view')).toBeFalsy();
    expect(ComponentRegistry.has('kanban')).toBe(false);
  });

  it('every declared description says what the renderer actually reads', () => {
    // The half a name assertion cannot carry. Three of these four keys are
    // honoured only in PART — `grouping` at one nested position, `cardFields`
    // as names rather than entry objects, `data` as a fetch suppressor as well
    // as a value — and a declaration that recommends a write the renderer
    // cannot honour is this gate's own failure mode one layer in (the
    // `record:reference_rail.entries` note in the console's parity file).
    // So each description must NAME the position it is true about.
    const entries = declaredInputEntries('object-kanban', 'plugin-kanban');
    const describedAs = (key: string): string =>
      String(entries.find((i: any) => i.name === key)?.description ?? '');
    // Non-vacuity for the four reads below: a key with no description at all
    // would otherwise satisfy every `not.toContain` written here.
    for (const { key } of DECLARED_STRUCTURED_KEYS) {
      expect(describedAs(key).length, `${key} has no description`).toBeGreaterThan(60);
    }
    expect(describedAs('grouping')).toContain('grouping.fields[0].field');
    expect(describedAs('grouping')).toContain('inert');
    expect(describedAs('cardFields')).toContain('bare names');
    expect(describedAs('data')).toContain('SUPPRESSES');
    expect(describedAs('conditionalFormatting')).toContain('condition');
  });
});
