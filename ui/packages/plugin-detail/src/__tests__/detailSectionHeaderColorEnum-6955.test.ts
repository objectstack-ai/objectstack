/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6955 — `detail-section.headerColor` is a CLOSED SIX-TOKEN authoring
 * surface, and it REFUSES everything else.
 *
 * ## The defect this pins closed
 *
 * The registration in `../index.tsx` declared `{ name: 'headerColor', type:
 * 'string' }`, unchanged since before the vocabulary was ruled. objectui#6594
 * had already narrowed the other end — `DetailViewSection.headerColor` and its
 * `@object-ui/types/zod` mirror are a six-member `z.enum`, matching
 * @objectstack/spec's strict `record:details` section schema (maintainer
 * ruling A, 2026-08-26, objectstack#12126). So the two ends disagreed about
 * what an author may write: the registration said "any string", the validator
 * said "one of six", and an author got no completion and no refusal at
 * authoring time — discovery was at parse time, or, for a value that happened
 * to render under some host app's Tailwind build, never.
 *
 * ## The surface this reads, and why it is the live one
 *
 * ⚠️ NOT `sdui.manifest.json`. `detail-section` is absent from
 * `PUBLIC_BLOCKS` (`packages/core/src/registry/public-blocks.ts`) and its
 * registration declares no `tier: 'public'`, so `gen-manifest.ts` — which
 * serialises `getPublicConfigs()` — never writes it into `sdui.manifest.json`
 * or `sdui-intrinsics.d.ts`. Its `inputs` are a live authoring surface all the
 * same, through the other consumer:
 * `packages/components/src/renderers/layout/page.tsx` builds the JSX-page
 * compiler's manifest from `getKnownTypes()` plus these same `inputs`, and
 * `sdui-parser`'s `validateTree` judges an authored page against it. That is
 * exactly the reach `registry-inputs-spec-parity.test.ts` records for
 * `element:record_picker`, which is likewise outside `PUBLIC_BLOCKS`.
 *
 * So `liveManifest()` below is built the way BOTH generators build theirs —
 * from the live registry, never from a hand-written fixture that could agree
 * with itself and prove nothing.
 *
 * ## What makes each row a reading rather than a restatement
 *
 * 1. THE REFUSAL. A seventh value draws an `invalid-enum` ERROR naming the
 *    prop. This is the row the card turns on: a pin asserting merely that the
 *    declaration MENTIONS the six would pass on a declaration that lists them
 *    and still accepts anything else.
 * 2. THE SIX ARE ACCEPTED. Narrowing must not cost a legal write.
 * 3. NO FREE-TEXT ESCAPE HATCH — the trap this card is built around. A
 *    six-option control that ALSO keeps a `'string'` arm would declare the
 *    renderer's verbatim `bg-*` pass-through by accident, which ruling A
 *    refused to declare. Pinned twice over: the declared arms are exactly
 *    `['enum']`, and a `bg-*` value is REFUSED by this surface.
 * 4. THE PASS-THROUGH IS UNCHANGED. The renderer still hands `bg-*` through
 *    verbatim. Asserted beside row 3 so the asymmetry — refused as authoring
 *    surface, honoured as a renderer affordance — cannot drift apart.
 * 5. THE CONTROLS. A genuinely unknown prop is still reported, and a legal
 *    value on a neighbouring key still passes, so rows 1-2's readings are
 *    verdicts and not a validator that reports nothing (or everything).
 * 6. THE VOCABULARY IS THE CONTRACT'S. The published `enum` is compared
 *    against `DetailViewSectionSchema.shape.headerColor`'s own options, read
 *    at runtime. The declaration derives its list from the renderer's resolver
 *    map and this row derives its oracle from the Zod mirror, so the two sides
 *    of this comparison have DIFFERENT sources — a self-confirming read would
 *    be worth nothing here.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { DetailViewSectionSchema } from '@object-ui/types/zod';
import { inputTypeArms, manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import { headerColorClass } from '../headerColor';
// Module scope, not a hook: this import IS the registration (AGENTS.md's
// test-discipline section — an unbounded module load must not be billed to a
// bounded window).
import '../index';

/** The tag an author writes, and the namespaced key the registry stores it under. */
const TAG = 'detail-section';
const NAMESPACE = 'plugin-detail';

/** A value outside the vocabulary that is not `bg-*` shaped. */
const SEVENTH_VALUE = 'blue-100';

/** The shape of value the resolver hands through verbatim, and ruling A refused to declare. */
const PASS_THROUGH_VALUE = 'bg-accent';

/**
 * The mirror's declared options, read from its own shape — never restated.
 * Same accessor as `headerColor.contractPin-6594.test.ts`, which is the file
 * that pins this mirror against the renderer's resolver in both directions.
 */
function contractVocabulary(): string[] {
  const member = DetailViewSectionSchema.shape.headerColor;
  const unwrapped = (member as { unwrap?: () => unknown }).unwrap?.() ?? member;
  const options = (unwrapped as { options?: unknown }).options;
  expect(
    Array.isArray(options),
    'DetailViewSectionSchema.headerColor should be an enum with declared options — a widening back to z.string() lands here',
  ).toBe(true);
  return [...(options as string[])];
}

/** The `headerColor` entry of the registration, read straight off the registry. */
function declaredInput(): { type: unknown; enum?: unknown } {
  const inputs = ((ComponentRegistry.getConfig(TAG, NAMESPACE) as unknown as {
    inputs?: Array<{ name: string; type: unknown; enum?: unknown }>;
  })?.inputs ?? []);
  // Non-vacuity: an empty read (wrong tag/namespace) must fail here rather
  // than silently pass every assertion built on it.
  expect(inputs.map((i) => i.name), `${TAG} inputs`).toContain('fields');
  const input = inputs.find((i) => i.name === 'headerColor');
  expect(input, `${TAG} declares no headerColor input`).toBeDefined();
  return input!;
}

/** The published option values, in either declaration form. */
const declaredEnumValues = (): unknown[] =>
  ((declaredInput().enum ?? []) as Array<string | { value: unknown }>).map((e) =>
    typeof e === 'object' && e !== null ? e.value : e,
  );

/**
 * A manifest built the way `gen-manifest.ts` and the JSX-page compiler build
 * theirs — from the live registry — so these verdicts are the ones a real
 * author gets.
 */
const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

/**
 * Diagnostics a one-node `<detail-section>` document draws. `fields` is always
 * supplied because it is `required: true`, so only `headerColor` decides the
 * verdict.
 */
const diagnose = (props: Record<string, unknown>) =>
  validateTree({ type: TAG, fields: [{ name: 'amount' }], ...props } as never, liveManifest())
    .diagnostics;

const codesFor = (props: Record<string, unknown>, code: string): string[] =>
  diagnose(props).filter((d) => d.code === code).map((d) => d.message);

describe('objectui#6955 — the detail-section headerColor authoring surface refuses', () => {
  it('REFUSES a seventh value, as an error naming the prop and the legal list', () => {
    const refusals = diagnose({ headerColor: SEVENTH_VALUE }).filter(
      (d) => d.code === 'invalid-enum',
    );
    expect(
      refusals.length,
      `<${TAG}> accepted headerColor="${SEVENTH_VALUE}" — the authoring surface is still free text`,
    ).toBe(1);
    expect(refusals[0].severity).toBe('error');
    expect(refusals[0].message).toContain('headerColor');
    expect(refusals[0].message).toContain(SEVENTH_VALUE);
    // The message carries the legal list, so an author is told what to write.
    for (const token of contractVocabulary()) {
      expect(refusals[0].message).toContain(token);
    }
  });

  it('ACCEPTS every token the contract declares, so narrowing costs no legal write', () => {
    for (const token of contractVocabulary()) {
      expect(
        diagnose({ headerColor: token }).filter((d) => d.message.includes('headerColor')),
        `<${TAG} headerColor="${token}"> should be clean`,
      ).toEqual([]);
    }
  });

  it('offers exactly ONE arm — no `string` beside the enum, so there is no free-text escape hatch', () => {
    expect(
      inputTypeArms(declaredInput().type as never),
      'a `string` arm would clear every value again and declare the `bg-*` pass-through by accident',
    ).toEqual(['enum']);
  });

  it('REFUSES the verbatim `bg-*` pass-through, which ruling A declined to declare', () => {
    expect(declaredEnumValues()).not.toContain(PASS_THROUGH_VALUE);
    expect(
      codesFor({ headerColor: PASS_THROUGH_VALUE }, 'invalid-enum').length,
      "declaring the pass-through would promise a class only the host app's Tailwind build can emit",
    ).toBe(1);
  });

  it("leaves the renderer's pass-through behaviour UNCHANGED — the asymmetry is the ruling", () => {
    expect(headerColorClass(PASS_THROUGH_VALUE)).toBe(PASS_THROUGH_VALUE);
    for (const token of contractVocabulary()) {
      expect(headerColorClass(token)).toBeDefined();
    }
  });

  it('control — a genuinely unknown prop is still reported', () => {
    expect(codesFor({ bogusProp: 'x' }, 'unknown-prop')).toEqual([
      `<${TAG}> has no prop "bogusProp"`,
    ]);
  });

  it('control — a neighbouring key still takes free text, so the refusal is about this key', () => {
    expect(diagnose({ title: SEVENTH_VALUE })).toEqual([]);
  });

  it('publishes exactly the contract vocabulary, in order, from a DIFFERENT source', () => {
    const contract = contractVocabulary();
    expect(contract.length, 'the six-member enum should still be six').toBe(6);
    expect(declaredEnumValues()).toEqual(contract);
  });
});
