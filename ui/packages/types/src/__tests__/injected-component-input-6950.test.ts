/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `binding` is FRAMEWORK-SET, not author-declared (objectui#6950; maintainer
 * ruling of 2026-09-07, director decision batch #69): the one input that
 * carries it is typed by `InjectedComponentInput`, `ComponentInput` has no
 * such member, and the seam that splices it in does so without a cast.
 *
 * ## The card, in one sentence
 *
 * `binding` was published (the manifest serializer forwards it), read
 * (`validateTree` records a binding site), and undeclared on the authoring
 * type — so its one writer, `ELEMENT_DATA_SOURCE_INPUT`, carried a
 * hand-written inline type and reached `ComponentMeta.inputs` through an
 * `as ComponentMeta` cast in `Registry.ts`. Declared narrower than enforced,
 * on a published type. The ruling answered the product question (may an
 * ordinary registration declare a binding input?) with **no**, which fixes
 * the shape: the key stays OFF `ComponentInput`, and the framework's own
 * write gets a type instead of a cast.
 *
 * ## The three limbs, and why the first alone is half a pin
 *
 * A registration that authors `binding` must FAIL type-check; the injected
 * input must still SERIALISE `binding: 'object'` into the manifest; and
 * `validateTree` must still RECORD the binding site. The first limb on its
 * own would be satisfied by deleting the marker altogether. This file holds
 * the type-level half (both directions) plus the source-text pins on the two
 * write sites; `packages/sdui-parser/src/__tests__/injected-component-input-6950.test.ts`
 * holds the runtime half, where the serializer and the validator live and
 * where `@object-ui/core` is an importable devDependency (this package may
 * import neither — `check:phantom-deps`, and it would be a cycle).
 *
 * The `@ts-expect-error` directives are REAL enforcement: this package
 * type-checks its tests through `tsconfig.test.json`, so re-widening a
 * declaration fails the build on the unused directive.
 *
 * ## Why two of the pins read SOURCE TEXT, and what no longer does
 *
 * A cast is invisible to every runtime and every type-level assertion — that
 * is what a cast is for. `as ComponentMeta` returning to the splice would
 * compile, pass every runtime limb, and hide the next drift exactly as it hid
 * this one. So the POSITIVE claims are read off the file, the way
 * `packages/core/src/registry/__tests__/component-meta-derives-from-canonical.test.ts`
 * reads its import line: a source-identity assertion is the only kind that
 * can see a cast.
 *
 * The cast's ABSENCE used to be read here too, as two `not.toMatch` regexes
 * over the spliced function's body. objectui#8316 retired them and moved that
 * claim to `eslint.config.js`, which scopes
 * `@typescript-eslint/consistent-type-assertions` with `assertionStyle:
 * 'never'` to `packages/core/src/registry/Registry.ts`. The two regexes were
 * measured on 4dc80d0fc before they were removed: re-adding `as ComponentMeta`
 * to the return did turn them red, so they were LIVE, not already broken — but
 * re-adding the same assertion as `<ComponentMeta>{…}` left this file green at
 * 9 passed. An AST rule reports both spellings, survives a reflow, and fails
 * loudly rather than asserting an absence, which is also what a pattern that
 * has stopped matching returns.
 *
 * What stays here is the pin's other half: the spliced local is ANNOTATED
 * `InjectedComponentInput`. That is a positive claim about text that must be
 * present, so it cannot go quiet the way an absence pin can, and it is a
 * different claim from "no assertion" — ESLint would not notice its deletion.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ComponentInput, ComponentMeta, InjectedComponentInput } from '../base';

const ROOT = resolve(__dirname, '../../../..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

/* ── type-level: the injected shape ───────────────────────────────────── */

describe('`InjectedComponentInput` is a `ComponentInput` plus the framework-set marker (objectui#6950)', () => {
  it('accepts the shape the framework writes, and is assignable to `ComponentInput`', () => {
    const injected: InjectedComponentInput = {
      name: 'dataSource',
      type: 'object',
      binding: 'object',
      description: 'Per-element data binding',
    };
    // The splice's premise: an injected input is a plain subtype of the array
    // element type, so `[...inputs, injected]` is a `ComponentInput[]` with no cast.
    const asAuthored: ComponentInput = injected;
    expect(asAuthored.name).toBe('dataSource');
    expect(injected.binding).toBe('object');
  });

  it('requires the marker — an input without `binding` is not an injected input', () => {
    // @ts-expect-error `binding` is required on the injected shape (objectui#6950)
    const missing: InjectedComponentInput = { name: 'dataSource', type: 'object' };
    expect(missing.name).toBe('dataSource');
  });

  it("the vocabulary is exactly 'object' — the zero-writer 'field' arm is retired (ADR-0049)", () => {
    const fieldArm: InjectedComponentInput = {
      name: 'dataSource',
      type: 'object',
      // @ts-expect-error `'field'` had zero writers and was retired with the ruling (objectui#6950)
      binding: 'field',
    };
    expect(fieldArm.name).toBe('dataSource');
  });
});

/* ── type-level: the authoring face refuses the key ────────────────────── */

describe('an ordinary registration cannot author `binding` (objectui#6950, ruling: framework-set)', () => {
  it('is an excess-property error on a `ComponentInput` literal', () => {
    const input: ComponentInput = {
      name: 'object',
      type: 'string',
      // @ts-expect-error `binding` is not a `ComponentInput` member — the framework injects it (objectui#6950)
      binding: 'object',
    };
    expect(input.name).toBe('object');
  });

  it('is an excess-property error through the registration door, `ComponentMeta.inputs`', () => {
    const meta: ComponentMeta = {
      inputs: [
        {
          name: 'object',
          type: 'string',
          required: true,
          // @ts-expect-error `binding` is not a `ComponentInput` member — the framework injects it (objectui#6950)
          binding: 'object',
        },
      ],
    };
    expect(meta.inputs).toHaveLength(1);
  });

  it('`ComponentInput` has no `binding` key at all — not even as a tombstone', () => {
    // A `?: never` tombstone would also refuse the write, but it would DECLARE
    // the key, and the ruling's shape is "not a member": the key belongs to
    // the injected type alone. Re-adding it here in any form flips this line.
    type HasBinding = 'binding' extends keyof ComponentInput ? true : false;
    const declared: HasBinding = false;
    expect(declared).toBe(false);
  });
});

/* ── source text: the two write sites carry the type, not a cast ───────── */

describe('the write sites are typed by `InjectedComponentInput` and carry no cast (objectui#6950)', () => {
  it('`ELEMENT_DATA_SOURCE_INPUT` is annotated with the injected type, not an inline literal', () => {
    const src = read('packages/core/src/data-scope/element-data-source.ts');
    expect(src).toContain('export const ELEMENT_DATA_SOURCE_INPUT: InjectedComponentInput = {');
    expect(src).toMatch(/import type \{[^}]*\bInjectedComponentInput\b[^}]*\} from '@object-ui\/types';/);
  });

  it('the splice in `withElementDataSourceInput` annotates the local with the injected type', () => {
    const src = read('packages/core/src/registry/Registry.ts');
    const start = src.indexOf('export function withElementDataSourceInput<');
    const end = src.indexOf('export class Registry<', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain('const injected: InjectedComponentInput = { ...ELEMENT_DATA_SOURCE_INPUT };');
    // The cast's ABSENCE is no longer asserted here — objectui#8316 moved it to
    // the `assertionStyle: 'never'` rule `eslint.config.js` scopes to this file,
    // which sees `<ComponentMeta>{…}` too and cannot go quiet on a reflow.
  });

  it('the declaration extends `ComponentInput` rather than restating its members', () => {
    const src = read('packages/types/src/base.ts');
    expect(src).toContain('export interface InjectedComponentInput extends ComponentInput {');
    // and the parent still has no `binding` member of its own (source-text
    // twin of the `keyof` pin above, so a tombstone cannot slip in as prose).
    const parentStart = src.indexOf('export interface ComponentInput {');
    const parentEnd = src.indexOf('export interface InjectedComponentInput', parentStart);
    expect(parentStart).toBeGreaterThan(-1);
    expect(parentEnd).toBeGreaterThan(parentStart);
    expect(src.slice(parentStart, parentEnd)).not.toMatch(/^\s+binding\??:/m);
  });
});
