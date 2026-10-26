/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8908 — `toRenderableSchema` is behaviour-preserving, MEASURED
 * against `SchemaRenderer` rather than asserted by its own docblock.
 *
 * ## The claim being pinned
 *
 * The bridge's header promises "the value a caller forwards renders identically
 * whether or not it passes through here". That is a falsifiable statement about
 * TWO render paths, so this suite renders both of them for every member of the
 * `SchemaNode` union and compares.
 *
 * ## Why an agreement assertion alone would be worthless
 *
 * `expect(bridged).toBe(raw)` passes on any harness where the two could never
 * have disagreed — a fixture set that reaches neither leg, a helper that renders
 * the same path twice. So every case asserts BOTH facts: that the two paths
 * agree, and the concrete text each one produced. The second half is what makes
 * the first half evidence.
 *
 * ## Discriminating power — which rows fail on the pre-fix tree
 *
 * Exactly two, and they are the two the card measured: `0` and `false`. The old
 * single-leg bridge mapped them to the strings `'0'` and `'false'`, which are
 * truthy and therefore render as their own text, while the renderer's own
 * `!evaluatedSchema` leg gives the raw values nothing. The other rows — `42`,
 * `true`, `''`, `'txt'`, an object node, `null`, `undefined` — are live
 * CONTROLS: they agreed before this change and must keep agreeing after it, so
 * a "fix" that made the bridge return nothing for everything would fail here
 * rather than pass.
 *
 * ## Why all six members and not just the broken two
 *
 * So a seventh member cannot be added to `SchemaNode` and quietly skip the
 * guarantee. `MEMBER_CASES` is keyed by a `Record` over `MemberName`, so every
 * name in that union needs an arm, and `_MembersAreExactlyCovered` pins
 * `MemberName` to the declared union itself — widen `SchemaNode` and this file
 * stops compiling until someone decides what the new member renders as.
 *
 * The companion pins: `SchemaRenderer.primitiveSchema.test.tsx` (objectui#4548)
 * owns what the renderer does with a bare primitive and is the oracle this
 * suite measures against; `SchemaRenderer.propsResolution.test.ts` owns the
 * bridge's RETURN TYPE, which is why the falsy leg returns nothing rather than
 * the value itself.
 *
 * Probe component registered at module scope, not in a hook (AGENTS.md
 * §测试纪律): registry work is an unbounded module load and must not be billed
 * to a bounded hook timeout.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import type { BaseSchema, DeclaredNode, SchemaNode } from '@object-ui/types';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { toRenderableSchema } from '../schema-input';

/**
 * This file's registered probe (`PROBE_TYPE`), declared to `@object-ui/types`
 * the way an application declares a type it registers (objectui#11466): a node
 * slot and the `schema` prop take the declared node types only.
 */
declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'test:schema-input-bridge-8908': BaseSchema;
  }
}

/* The `Assert< … >` alias below IS the assertion — it is deliberately never
 * referenced, and a violation is a COMPILE error rather than a use site. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

const PROBE_TYPE = 'test:schema-input-bridge-8908';
ComponentRegistry.register(PROBE_TYPE, () => <span>probe-node</span>);

/** One arm per member of the `SchemaNode` union, by name. */
type MemberName = 'DeclaredNode' | 'string' | 'number' | 'boolean' | 'null' | 'undefined';

/**
 * The completeness pin. `MemberName` above is a hand-written list; this ties it
 * to the DECLARATION, so the list cannot go stale silently.
 */
type _MembersAreExactlyCovered = Assert<
  Equal<SchemaNode, DeclaredNode | string | number | boolean | null | undefined>
>;

/** `renders` is the text `SchemaRenderer` puts in the DOM for this value. */
type Case = { label: string; value: SchemaNode; renders: string };

const MEMBER_CASES: Record<MemberName, Case[]> = {
  DeclaredNode: [{ label: 'an object node', value: { type: PROBE_TYPE }, renders: 'probe-node' }],
  string: [
    { label: "'' (empty)", value: '', renders: '' },
    { label: "'txt'", value: 'txt', renders: 'txt' },
  ],
  number: [
    // The falsy set the renderer's first leg swallows, in full.
    { label: '0', value: 0, renders: '' },
    { label: '-0', value: -0, renders: '' },
    { label: 'NaN', value: NaN, renders: '' },
    { label: '42', value: 42, renders: '42' },
    { label: 'Infinity', value: Infinity, renders: 'Infinity' },
  ],
  boolean: [
    { label: 'false', value: false, renders: '' },
    { label: 'true', value: true, renders: 'true' },
  ],
  null: [{ label: 'null', value: null, renders: '' }],
  undefined: [{ label: 'undefined', value: undefined, renders: '' }],
};

/** The value handed to `SchemaRenderer` directly — the oracle. */
function renderRaw(value: SchemaNode): string {
  const { container, unmount } = render(<SchemaRenderer schema={value as never} />);
  const text = container.textContent ?? '';
  unmount();
  return text;
}

/** The same value, forwarded the way every call site forwards it. */
function renderBridged(value: SchemaNode): string {
  const { container, unmount } = render(<SchemaRenderer schema={toRenderableSchema(value)} />);
  const text = container.textContent ?? '';
  unmount();
  return text;
}

describe('objectui#8908 — the bridge preserves behaviour for every SchemaNode member', () => {
  for (const [member, cases] of Object.entries(MEMBER_CASES) as [MemberName, Case[]][]) {
    describe(`member: ${member}`, () => {
      for (const testCase of cases) {
        it(`${testCase.label} — both paths render ${JSON.stringify(testCase.renders)}`, () => {
          const raw = renderRaw(testCase.value);
          const bridged = renderBridged(testCase.value);
          // The guarantee itself.
          expect(bridged).toBe(raw);
          // …and it is not vacuous: this is what they agreed ON.
          expect(raw).toBe(testCase.renders);
          expect(bridged).toBe(testCase.renders);
        });
      }
    });
  }
});

describe('objectui#8908 — the six-row table from the card, re-measured', () => {
  // The acceptance artifact, spelled exactly as the finding recorded it. `0`
  // and `false` read `same=false` on the pre-fix tree; the other four read
  // `same=true` there and here.
  const TABLE: Case[] = [
    { label: 'value=0', value: 0, renders: '' },
    { label: 'value=false', value: false, renders: '' },
    { label: 'value=42', value: 42, renders: '42' },
    { label: 'value=true', value: true, renders: 'true' },
    { label: "value=''", value: '', renders: '' },
    { label: "value='txt'", value: 'txt', renders: 'txt' },
  ];

  it('raw and bridged agree on every row, on the value the row names', () => {
    const measured = TABLE.map(row => ({
      label: row.label,
      raw: renderRaw(row.value),
      bridged: renderBridged(row.value),
    }));
    expect(measured).toEqual(
      TABLE.map(row => ({ label: row.label, raw: row.renders, bridged: row.renders })),
    );
  });
});

describe('objectui#8908 — the two legs of the mapping, at the bridge itself', () => {
  // The render tests above prove the OUTCOME; these prove the MECHANISM, so a
  // future edit that reaches the same outcome by a different route is visible.
  it('maps a truthy number / boolean onto its text form', () => {
    expect(toRenderableSchema(42)).toBe('42');
    expect(toRenderableSchema(true)).toBe('true');
    expect(toRenderableSchema(Infinity)).toBe('Infinity');
  });

  it('maps a falsy number / boolean onto nothing, never onto its text form', () => {
    for (const value of [0, -0, NaN, false] as const) {
      expect(toRenderableSchema(value)).toBeUndefined();
    }
    // The specific regression: these two strings are truthy, which is why the
    // single-leg mapping printed them.
    expect(toRenderableSchema(0)).not.toBe('0');
    expect(toRenderableSchema(false)).not.toBe('false');
  });

  it('returns every other member by identity — it converts nothing else', () => {
    const node: DeclaredNode = { type: PROBE_TYPE };
    expect(toRenderableSchema(node)).toBe(node);
    expect(toRenderableSchema('txt')).toBe('txt');
    expect(toRenderableSchema('')).toBe('');
    expect(toRenderableSchema(null)).toBeNull();
    expect(toRenderableSchema(undefined)).toBeUndefined();
  });
});
