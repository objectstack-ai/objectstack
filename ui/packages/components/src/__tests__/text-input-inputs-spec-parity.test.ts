/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `element:text_input` — the published authoring surface stays in parity with
 * `@objectstack/spec` `ElementTextInputProps` (objectui#3808).
 *
 * `text-input.test.tsx` next door already proves the RENDERER seeds a bound page
 * variable from `defaultValue`. This file proves the complementary and, until
 * #3808, false half: that an author can find out the key exists.
 *
 * WHY THIS BLOCK NEEDED IT MOST. `element:text_input` is deliberately NOT in
 * `PUBLIC_BLOCKS` ("bare inputs belong to a form, not a page block",
 * `packages/core/src/registry/public-blocks.ts:80`), so it never reaches
 * `sdui.manifest.json` and the usual argument — "the manifest advertises it" —
 * does not apply. Its `inputs` are a live contract anyway:
 * `renderers/layout/page.tsx:462` builds the JSX-page compiler's prop whitelist
 * from `getKnownTypes()` plus these same `inputs`, so while `defaultValue` was
 * undeclared, `sdui-parser/src/validate.ts:74` reported `unknown-prop` for it on
 * every JSX page — a warning against a key the renderer then went on to honour,
 * with no way for the author to discover which of the two was right.
 *
 * Expectations are derived from the spec at runtime, not restated.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { ElementTextInputPropsSchema } from '@objectstack/spec/ui';
// Module scope, not a hook: the cold transform is billed to the import phase,
// which has no test/hook timeout (AGENTS.md §测试纪律, objectui#3010).
import '../renderers';

type ShapeCarrier = { shape?: unknown; _def?: { shape?: unknown } };

/** Resolve the props object's `.shape` through both spellings, lazy or plain. */
function specTopLevelKeys(): string[] {
  const carrier = ElementTextInputPropsSchema as unknown as ShapeCarrier;
  const shape = carrier.shape ?? carrier._def?.shape;
  const resolved = typeof shape === 'function' ? (shape as () => object)() : shape;
  return resolved && typeof resolved === 'object' ? Object.keys(resolved) : [];
}

const config = () => ComponentRegistry.getConfig('element:text_input');
const inputs = () => config()?.inputs ?? [];
const inputNames = () => inputs().map((i) => i.name);
const input = (name: string) => inputs().find((i) => i.name === name);
const defaultValueDescription = () => input('defaultValue')?.description ?? '';

/**
 * Does the installed spec REFUSE an undeclared top-level key, or drop it in
 * silence? (objectui#4910, measured on both pins.)
 *
 * `@objectstack/spec` 17.0.0 GA flipped the `element:*` props schemas from
 * strip mode to strict under objectstack#4001 batch A, so an undeclared prop
 * now raises `unrecognized_keys` with a named message; the pinned
 * `17.0.0-rc.6` still drops it in silence. The VERDICT under test is identical
 * either way — an undeclared key is not an authoring surface, which is the
 * whole reason "the declared key survives the parse" says anything — but the
 * EVIDENCE differs, and asserting the wrong one turns this file red for a
 * reason that has nothing to do with what it guards.
 *
 * Probed behaviourally rather than off a version string: the strictness IS the
 * fact this file cares about, a probe cannot go stale against a pin it never
 * reads, and the probe key is a name no spec would ever declare. Same shape as
 * `recordHighlightsInputs.spec-parity.test.ts`, which took this disposition
 * first (objectui#4648 / PR #4671).
 */
const specRefusesUnknownTopLevelKeys = !ElementTextInputPropsSchema.safeParse({
  __objectui_4910_probe__: true,
} as never).success;

describe('element:text_input — registry inputs vs @objectstack/spec', () => {
  it('is registered with a non-empty `inputs` surface', () => {
    expect(config()).toBeDefined();
    expect(inputNames().length).toBeGreaterThan(0);
  });

  it('resolves a non-empty spec key set', () => {
    // Guards the probe, not the subject: a Zod internals change would return `[]`
    // here and make every assertion below vacuously agreeable.
    expect(specTopLevelKeys().length).toBeGreaterThan(0);
  });

  it('declares no top-level input the spec does not accept', () => {
    const allowed = new Set(specTopLevelKeys());
    expect(inputNames().filter((name) => !allowed.has(name))).toEqual([]);
  });

  it('publishes `defaultValue`, which the renderer has read all along', () => {
    // A KEY-reachability claim, so the criterion is that the key SURVIVES the
    // parse — not that the parse succeeds. Neither refusal mode makes
    // `success === true` proof on its own: under rc.6's strip mode an
    // UNDECLARED key parses green as well, and under GA's strict mode a green
    // parse only reports that no undeclared key was present. Survival is the
    // claim on both pins.
    expect(specTopLevelKeys()).toContain('defaultValue');
    const parsed = ElementTextInputPropsSchema.safeParse({ defaultValue: 'acme' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.defaultValue).toBe('acme');

    // The contrast that makes the criterion meaningful: the SAME payload plus a
    // key the spec does not declare. Two contract spellings, one verdict — the
    // undeclared key never becomes authoring surface (see
    // `specRefusesUnknownTopLevelKeys`). Carrying `defaultValue` alongside is
    // load-bearing rather than tidy: it is what makes either arm attributable
    // to `notASpecKey` instead of to the declared key having gone bad, and the
    // green parse asserted just above is what proves the base is valid.
    const undeclared = ElementTextInputPropsSchema.safeParse({
      defaultValue: 'acme',
      notASpecKey: 1,
    } as never);

    if (specRefusesUnknownTopLevelKeys) {
      // 17.0.0 GA: a loud refusal, and the STRONGER guarantee — the author now
      // gets told. Asserted as an envelope (the code AND the key it names)
      // because a bare "it failed" would be satisfied just as well by a
      // rejection of `defaultValue`, the half that has to stay valid.
      expect(undeclared.success).toBe(false);
      expect(undeclared.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
      const refused = undeclared.error?.issues.flatMap(
        (i) => (i as unknown as { keys?: string[] }).keys ?? [],
      );
      expect(refused).toContain('notASpecKey');
      expect(refused).not.toContain('defaultValue');
    } else {
      // The pinned rc.6: same green parse, key gone, no diagnostic. That is
      // what `defaultValue` looked like to every manifest consumer before it
      // was declared here — and the silent-drop harm objectstack#4001 batch A
      // retired.
      expect(undeclared.success).toBe(true);
      expect(Object.keys(undeclared.data ?? {})).not.toContain('notASpecKey');
      expect(undeclared.data?.defaultValue).toBe('acme');
    }

    expect(inputNames()).toContain('defaultValue');
    expect(defaultValueDescription()).not.toBe('');
  });

  it('DECLARES both arms of the spec union, and only those arms', () => {
    // Replaced rather than re-spelled (objectui#3832). This assertion used to
    // read `input('defaultValue')?.type).toBe('string')` and its comment
    // explained the narrowing that made it true: the spec's type is the union
    // `string | number`, `ComponentInput.type` held one coarse kind, so the
    // declaration picked an arm and named the other in prose while the manifest
    // gate warned `type-mismatch` on `defaultValue={42}` — a value the spec
    // accepts. Re-pointing that assertion at the new value would have pinned the
    // declaration and left the FACT it existed for — the two must be the same
    // two — unmeasured, so both halves are derived from the spec at runtime
    // instead.
    //
    // The arms are compared as a SET against the spec's own verdicts: each arm
    // must be a shape the spec accepts, and each shape the spec accepts must
    // have an arm. That is what makes this red if either side moves — a spec
    // that drops the number arm, or a declaration that adds an arm the spec
    // rejects (the `'object'` inline-translation arm its neighbours carry is the
    // live temptation, and the spec refuses it here).
    const accepts = (value: unknown) =>
      ElementTextInputPropsSchema.safeParse({ defaultValue: value } as never).success;

    expect(accepts('acme')).toBe(true);
    expect(accepts(42)).toBe(true);
    expect(accepts(true)).toBe(false);
    expect(accepts({ en: 'acme', 'zh-CN': '安客' })).toBe(false);

    const declared = input('defaultValue')?.type;
    const arms = Array.isArray(declared) ? declared : [declared];
    expect([...arms].sort()).toEqual(['number', 'string']);

    // The description still names the number arm. It is no longer carrying a
    // narrowing the type could not express, but "string or number" is what an
    // author reads before they read a manifest, and the two must not drift.
    expect(defaultValueDescription()).toMatch(/number/);
  });

  it('the `defaultValue` description says which of the two behaviours an author gets', () => {
    // The seeding path and the uncontrolled-input path do different things, and
    // which one applies depends on something the block does not own: whether a
    // page variable's `source` points at this component's id. A description
    // saying only "initial value" would be true and useless — the author of a
    // form that submits `page.<var>` needs to know the seed happens once, only
    // while the variable is empty, and that the variable's own default wins.
    const description = defaultValueDescription();
    expect(description).toMatch(/source/);
    expect(description).toMatch(/once/i);
    expect(description).toMatch(/empty/i);
  });

  it('declares no default OF ITS OWN for the defaultValue entry — the spec parses none in', () => {
    // A default for the default would seed every text input in the gallery with
    // a value the renderer has no opinion about; the spec declares none. (This
    // used to also assert the registration carried no `ComponentInput.defaultValue`;
    // that key is an ADR-0049 tombstone since objectui#7493, so the spec's parse
    // is the one channel a default could reach an author through.)
    expect(input('defaultValue')).toBeDefined();
    expect(ElementTextInputPropsSchema.safeParse({}).data).not.toHaveProperty('defaultValue');
  });
});

/**
 * The `I18nLabel` trio — `label` / `placeholder` / `description` (objectui#5717).
 *
 * Same discipline as the `defaultValue` case above and for the same reason: the
 * arms are DERIVED from the spec's verdicts, never restated. Restating them
 * would pin the declaration and leave the fact the declaration exists FOR — that
 * the declared arms are the ones the contract accepts — unmeasured.
 *
 * ## Why these three needed a card of their own
 *
 * `element:record_picker.emptyText` (objectui#5590) and that block's `label` /
 * `placeholder` (objectui#5637) each held a single `'string'` arm for exactly as
 * long as their RENDER SITE dropped the map, and gained the object arm in the
 * change that taught the render site to resolve it — the order
 * `ComponentInput.type` prescribes. This block is the inverse: `text-input.tsx`
 * has resolved all three keys through `pickLocalized` since it was written, so
 * the map always reached the screen resolved, and only the declaration stayed
 * narrow. `ComponentInput.type`'s rule is symmetric and condemns that half in
 * its own words — withholding an arm the renderer resolves makes the manifest
 * gate report `type-mismatch` on a legal write.
 *
 * ## What this file can and cannot see
 *
 * It sees the DECLARATION half — declared arms against the contract's own
 * verdicts. It cannot see the defect itself, which is a `type-mismatch`
 * diagnostic emitted by `validateTree` over a manifest; that path is driven in
 * `apps/console/src/__tests__/component-input-union-specimens.test.ts`, where
 * this block gained its pin in the same change. Neither file subsumes the other:
 * this one goes red when the declaration and the contract disagree, that one
 * when the gate and the declaration do.
 */
describe('element:text_input — the I18nLabel trio declares its real union (objectui#5717)', () => {
  /**
   * One representative value per coarse arm, in the vocabulary `checkType`'s
   * `armAccepts` uses (`packages/sdui-parser/src/validate.ts`) — the same probe
   * table `component-input-union-specimens.test.ts` derives with, so the two
   * files cannot disagree about what "the object arm" means.
   *
   * `['Owner']` earns its place: the `'object'` arm accepts a non-null
   * non-array object and nothing else, so an array is the value that tells
   * "declares the object arm" apart from "stopped checking non-primitives".
   */
  const COARSE_ARM_PROBES: ReadonlyArray<readonly [string, unknown]> = [
    ['string', 'Owner'],
    ['object', { en: 'Owner', 'zh-CN': '负责人' }],
    ['number', 42],
    ['boolean', true],
    ['array', ['Owner']],
  ];

  const specAcceptedArms = (key: string): string[] =>
    COARSE_ARM_PROBES.filter(
      ([, value]) => ElementTextInputPropsSchema.safeParse({ [key]: value } as never).success,
    ).map(([arm]) => arm);

  const TRIO = ['label', 'placeholder', 'description'] as const;

  it('the spec accepts exactly the string and inline-map arms on all three keys', () => {
    // Guards the derivation before anything is compared against it: a schema
    // that refused every probe (a renamed key, a new sibling required key)
    // returns `[]` and would make the per-key comparisons below agree
    // vacuously. Measured on the installed 17.1.0 pin.
    for (const key of TRIO) {
      expect(specAcceptedArms(key), key).toEqual(['string', 'object']);
    }
  });

  it.each(TRIO)('`%s` declares the arms the contract accepts, and only those', (key) => {
    // Compared as a SET in both directions: every declared arm is a shape the
    // spec accepts, and every shape the spec accepts has an arm. Either side
    // moving turns this red — a spec release that drops the map arm, or a
    // declaration that grows an arm the spec rejects.
    expect(input(key)).toBeDefined();
    const declared = input(key)?.type;
    const arms = Array.isArray(declared) ? declared : [declared];
    expect([...arms].sort()).toEqual([...specAcceptedArms(key)].sort());
  });

  it.each(TRIO)('`%s` carries a description written from what the renderer does', (key) => {
    // The arms say WHICH shapes are legal; only the description says what the
    // renderer then does with them, and `ComponentInput.type`'s ruling
    // (maintainer, 2026-08-17) makes the description the expression ceiling for
    // everything the coarse arm cannot carry. Each of these three has a
    // different destination in the rendered output, which is exactly the kind of
    // fact an author cannot get from `['string','object']`.
    const description = input(key)?.description ?? '';
    expect(description).not.toBe('');
    // The map arm is only discoverable if the description teaches the shape.
    expect(description).toMatch(/zh-CN/);
    // …and the resolution is locale-aware, not an `en` pick — the property the
    // trio's read site actually has and the half an author plans around.
    expect(description).toMatch(/language/i);
  });

  it('`defaultValue` is NOT part of the trio — the contract is what separates it', () => {
    // The control that keeps the widening per-key rather than blanket, asserted
    // here from the CONTRACT so the separation has a reason and not just a
    // convention. Its console-side twin is the `I18N_MAP` case on
    // `element:text_input.defaultValue` in
    // `component-input-union-specimens.test.ts`, which must keep REPORTING
    // `type-mismatch`.
    expect(specAcceptedArms('defaultValue')).toEqual(['string', 'number']);
    const declared = input('defaultValue')?.type;
    const arms = Array.isArray(declared) ? declared : [declared];
    expect(arms).not.toContain('object');
  });
});
