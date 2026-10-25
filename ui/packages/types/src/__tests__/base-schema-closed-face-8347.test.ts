// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `BaseSchema` carries no index signature, so a misspelled key stops
 * type-checking — the compile-fail pin objectui#7927's ruling made
 * non-negotiable, executed by objectui#8347.
 *
 * ## What the ruling asked for
 *
 * objectui#7927 measured the defect with seven planted probes on
 * `plugin-calendar`'s README. Its P5 renamed `titleField` to `titleFieldd`
 * inside an annotated block and came back GREEN, while the type, optionality
 * and payload-member probes went red: `BaseSchema` ended in
 * `[key: string]: any`, so no annotation on any node type could catch a
 * misspelled key. The ruling: remove the signature, and pin it with a fixture
 * whose misspelled key must stop type-checking, in BOTH directions — the
 * correct spelling must still compile.
 *
 * ## Why the rows below are FRESH literals
 *
 * TypeScript runs its excess-property check only on a fresh object literal
 * written straight against its target. P5 as #7927 ran it does not qualify on
 * today's README: that block is a type alias plus two assignments of declared
 * variables, which tsc never excess-checks, so P5 stays green with or without
 * the signature (measured on objectui#8347's census, with a lit control that
 * went red). Every refusal row here is therefore a fresh literal, and the
 * bound is pinned too (section 3), so nobody reads this file as claiming
 * more than it does.
 *
 * ## Who reads it
 *
 * The rows are TYPE-level: `tsc -p tsconfig.test.json`, chained from this
 * package's `type-check` script, is their reader. An `@ts-expect-error` that
 * stops matching an error is itself an error (TS2578), so a signature put back
 * on `BaseSchema` turns every refusal row below red. The vitest leg only keeps
 * the bindings alive.
 */

import { describe, it, expect } from 'vitest';
import type { BaseSchema, ComponentRendererProps } from '../base';
import type { CalendarViewSchema } from '../complex';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/* ── 1. The declarations: no string index on the authoring face ──────────── */

/** `string extends keyof T` is true exactly when `T` carries a string index signature. */
type HasStringIndex<T> = string extends keyof T ? true : false;

export type _BaseSchemaHasNoIndexSignature = Expect<Equal<HasStringIndex<BaseSchema>, false>>;
export type _NodeTypesInheritNone = Expect<Equal<HasStringIndex<CalendarViewSchema>, false>>;
// ⛔ Renderer props are not the authoring face: `ComponentRendererProps` keeps
// its own signature on purpose (objectui#8347's card body), and this row is
// what notices it being removed by momentum.
export type _RendererPropsKeepTheirs = Expect<Equal<HasStringIndex<ComponentRendererProps>, true>>;

/* ── 2. The pin, both directions, on fresh literals ───────────────────────── */

// #7927's P5, turned red: the misspelled key is refused…
export const p5Misspelled: CalendarViewSchema = {
  type: 'calendar-view',
  // @ts-expect-error — `titleFieldd` is no member of `CalendarViewSchema`; the key is `titleField`
  titleFieldd: 'subject',
};
// …and the correct spelling still compiles.
export const p5Correct: CalendarViewSchema = { type: 'calendar-view', titleField: 'subject' };

// The same on the base itself, with a member every node inherits.
export const baseMisspelled: BaseSchema = {
  type: 'text',
  // @ts-expect-error — `classNmae` is no member of `BaseSchema`; the key is `className`
  classNmae: 'font-bold',
};
export const baseCorrect: BaseSchema = { type: 'text', className: 'font-bold' };

// A node nested in a slot is judged as its own node type (objectui#11466),
// and now every node type refuses a key it does not declare.
export const nestedMisspelled: BaseSchema = {
  type: 'card',
  // @ts-expect-error — `labell` is no member of the `button` node; the key is `label` (tsc reports it at the slot)
  children: [{ type: 'button', labell: 'Save' }],
};
export const nestedCorrect: BaseSchema = { type: 'card', children: [{ type: 'button', label: 'Save' }] };

/* ── 3. The bound: a NON-fresh value is not re-checked ───────────────────── */

// No directive on purpose. A value that reached its annotation through a
// variable of a wider type carries its extra key past the check: TypeScript's
// excess-property check is a fresh-literal check, not a structural one. This is
// why `plugin-calendar`'s README assignments cannot carry P5, and why the
// strict zod face (`StrictAnyComponentSchema`, objectui#8345), not this face,
// is the refusal for metadata that arrives as data.
const arrived = { type: 'calendar-view' as const, titleField: 'subject', titleFieldd: 'subject' };
export const widenedIsNotRechecked: CalendarViewSchema = arrived;

describe('`BaseSchema` declares no index signature (objectui#8347, the objectui#7927 pin)', () => {
  it('keeps the type-level rows alive — `tsc -p tsconfig.test.json` is their reader', () => {
    expect([p5Correct.titleField, baseCorrect.className]).toEqual(['subject', 'font-bold']);
    expect([p5Misspelled, baseMisspelled, nestedMisspelled, nestedCorrect, widenedIsNotRechecked])
      .toHaveLength(5);
  });
});
