/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `buttonVariant` ↔ Button vocabulary parity, for BOTH nodes that carry the key
 * (objectui#6496 for `toast`, objectui#6541 for `sonner`).
 *
 * objectui#6496 declared `buttonLabel` / `buttonVariant` on `ToastSchema`, and
 * the shape of the second one was the card's whole judgement call. The sibling
 * it was told to copy disagreed with ITSELF — `SonnerSchema` spelled
 * `buttonVariant` as `z.string()` in the zod mirror and as a six-member union
 * in TS — so "match the sibling" picked nothing. The ground truth is what the
 * value REACHES: `renderers/feedback/toast.tsx:30` passes it straight into
 * `<Button variant={…}>`, so `ButtonProps['variant']` is the authority. (That
 * sibling disagreement is closed by objectui#6541, below.)
 *
 * `@object-ui/types` has zero deps and cannot import the Button, so the
 * declaration there is necessarily a hand-copied list. THIS file is what stops
 * that list being a copy: it lives where both are visible and compares them.
 * Add a seventh variant to `buttonVariants` and the type-level half below goes
 * red naming the gap, instead of the schema quietly refusing a real look.
 *
 * The runtime half measures the thing that makes an open `string` wrong. `cva`
 * contributes NO variant class for an unrecognised key, and falls back to
 * `defaultVariants` only when the value is ABSENT — so a string outside the six
 * does not render "some other style", it renders a button with no background
 * and no text colour. That is the concrete cost the enum buys out, and it is
 * measured here rather than asserted in prose.
 *
 * ## objectui#6541 — `sonner` joins, and its ZOD MIRROR is pinned here too
 *
 * The `sonner` node carries the same two keys and reaches the same `<Button>`
 * (`renderers/feedback/sonner.tsx` passes `variant={schema.buttonVariant}`).
 * Its TS face had declared the six all along; its zod MIRROR was an open
 * `z.string()`, so one key on one component shipped as a closed union to
 * type-checkers and an open string to validators. #6541 narrowed the mirror to
 * the enum — an accept-set NARROWING on a published surface, stated as such.
 *
 * That narrowing is pinned HERE rather than in
 * `types/src/__tests__/zod-mirror-parity.test.ts`, and the reason is the reason
 * the drift survived: that census compares in ONE direction — "the mirror
 * accepts everything the declaration declares". A mirror WIDER than its
 * declaration passes it and earns no ledger entry, so the wider-than-declared
 * class is invisible across all 158 pairs. The block below measures the other
 * direction — everything the mirror ACCEPTS is a value the Button actually
 * draws — and it can only be measured somewhere `Button` is in scope, which
 * `@object-ui/types` (zero deps, no React) by construction is not.
 *
 * ⛔ The one-directionality of that census is its own subject and is NOT
 * touched here.
 */

import { describe, it, expect } from 'vitest';
import type { SonnerSchema, ToastSchema } from '@object-ui/types';
import { SonnerSchema as SonnerMirror } from '@object-ui/types/zod';
import { buttonVariants, type ButtonProps } from '../ui/button';

/** The six as `ToastSchema` and `SonnerSchema` both declare them. */
const DECLARED = ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'] as const;

/** A minimal `sonner` node — every key on it other than `type` is optional. */
const MINIMAL_SONNER = { type: 'sonner' } as const;

/**
 * The values that make the open `z.string()` wrong, each paired with what the
 * Button actually draws for it. Read as a table so the schema-side assertions
 * below cannot drift away from the rendering they claim to justify.
 */
const NOT_A_VARIANT = ['primary', 'danger', 'warning', 'Default', '__not-a-variant__'] as const;

/**
 * What `buttonVariants` emits for a value it does not recognise: the base
 * classes and nothing else. Every "this is not a real variant" assertion below
 * is measured against this string rather than against a hand-written class list.
 */
const NO_VARIANT_CLASSES = buttonVariants({ variant: '__not-a-variant__' as never });

/**
 * The zod mirror's accept-set for `SonnerSchema.buttonVariant`, READ off the
 * schema instead of restated next to it — a restated list is the same artefact
 * the drift keeps producing.
 *
 * `.options` exists only on `ZodEnum`. If this key ever goes back to
 * `z.string()` there is nothing to read, and this throws naming the card rather
 * than comparing an empty list against an empty list and passing.
 */
function mirrorAcceptSet(): readonly string[] {
  type Unwrappable = { unwrap?: () => unknown; def?: { innerType?: unknown } };
  const key: unknown = SonnerMirror.shape.buttonVariant;
  const inner = (key as Unwrappable).unwrap?.() ?? (key as Unwrappable).def?.innerType ?? key;
  const options: unknown = (inner as { options?: unknown }).options;
  if (!Array.isArray(options)) {
    throw new Error(
      "`SonnerSchema.buttonVariant` is not an enum in the zod mirror: it accepts more than " +
        'the Button can draw (objectui#6541).',
    );
  }
  return options as readonly string[];
}

describe('the declared `buttonVariant` vocabulary is the Button’s own', () => {
  it('every declared value is a real Button variant (it contributes a class)', () => {
    const inert = DECLARED.filter((v) => buttonVariants({ variant: v }) === NO_VARIANT_CLASSES);
    expect(inert, 'declared, but the Button draws nothing for them').toEqual([]);
  });

  it('every declared value is DISTINCT — no two collapse to the same look', () => {
    const rendered = DECLARED.map((v) => buttonVariants({ variant: v }));
    expect(new Set(rendered).size).toBe(DECLARED.length);
  });

  it('the declared list matches `ButtonProps["variant"]` in BOTH directions', () => {
    // The exhaustiveness pin, and the one that cannot be satisfied by copying.
    // `NonNullable` strips the `null | undefined` that `VariantProps` adds.
    //   - `declaredIsAccepted` fails if the schema declares a value the Button
    //     does not accept (the schema would invite a look that renders blank);
    //   - `acceptedIsDeclared` fails if the Button accepts a value the schema
    //     does not declare (a real look the schema refuses — what a seventh
    //     variant would cause).
    type Accepted = NonNullable<ButtonProps['variant']>;
    type Declared = NonNullable<ToastSchema['buttonVariant']>;

    const declaredIsAccepted: Accepted = null as unknown as Declared;
    const acceptedIsDeclared: Declared = null as unknown as Accepted;

    expect([declaredIsAccepted, acceptedIsDeclared]).toHaveLength(2);
  });

  it('the runtime list and the declared TYPE are the same six', () => {
    // Guards the array literal above against drifting from the type it claims
    // to enumerate — the array is what the runtime assertions iterate.
    const typed: NonNullable<ToastSchema['buttonVariant']>[] = [...DECLARED];
    expect(typed).toHaveLength(6);
  });
});

describe('why the mirror is an enum and not `z.string()`', () => {
  it('an unrecognised variant renders NO colour — it is not merely unusual', () => {
    // `primary` is the likeliest wrong spelling: the DEFAULT variant's own class
    // is `bg-primary`, so the name reads correct and produces a blank button.
    for (const bogus of ['primary', 'danger', 'warning', 'Default']) {
      expect(buttonVariants({ variant: bogus as never }), bogus).toBe(NO_VARIANT_CLASSES);
    }
    expect(NO_VARIANT_CLASSES).not.toContain('bg-primary');
  });

  it('an EMPTY variant is silently reinterpreted as `default` — cva’s falsy fallback', () => {
    // Measured, and worth its own pin because it is the one wrong value that
    // does NOT look wrong. `cva` resolves
    // `falsyToString(props.variant) || falsyToString(defaultVariants.variant)`,
    // so `''` never reaches the variant table: it takes the default look. Under
    // an open `z.string()` an author could write `buttonVariant: ''`, see a
    // correctly styled button, and never learn the value meant nothing. The
    // enum refuses it instead — pinned on the mirror side in
    // `types/src/__tests__/toast-button-keys.test.ts`.
    expect(buttonVariants({ variant: '' as never })).toBe(buttonVariants({ variant: 'default' }));
    expect(buttonVariants({ variant: '' as never })).not.toBe(NO_VARIANT_CLASSES);
  });

  it('an ABSENT variant still gets the default look — so optional stays safe', () => {
    // This is why both keys are declared OPTIONAL rather than defaulted in the
    // schema: omission already has a defined, styled outcome downstream.
    expect(buttonVariants({ variant: undefined })).toBe(buttonVariants({ variant: 'default' }));
    expect(buttonVariants({ variant: undefined })).not.toBe(NO_VARIANT_CLASSES);
  });
});

describe('`sonner` declares the same vocabulary on BOTH of its published faces', () => {
  it('the TS face matches `ButtonProps["variant"]` in BOTH directions', () => {
    // Same construction as the `toast` pin above, against the same ground
    // truth. This half was already true before objectui#6541 — the TS face was
    // never the problem — but it is what the mirror is now pinned equal to, so
    // it belongs in the same file rather than being assumed.
    type Accepted = NonNullable<ButtonProps['variant']>;
    type Declared = NonNullable<SonnerSchema['buttonVariant']>;

    const declaredIsAccepted: Accepted = null as unknown as Declared;
    const acceptedIsDeclared: Declared = null as unknown as Accepted;

    expect([declaredIsAccepted, acceptedIsDeclared]).toHaveLength(2);
  });

  it('the ZOD MIRROR accepts exactly the six — the direction the census cannot see', () => {
    // Set equality, read off the schema rather than restated. Under the old
    // `z.string()` there is no `.options` to read at all, so `mirrorAcceptSet`
    // throws naming the card instead of quietly comparing nothing.
    expect([...mirrorAcceptSet()].sort()).toEqual([...DECLARED].sort());
  });

  it('the mirror accepts every value the Button actually draws', () => {
    // The direction `zod-mirror-parity.test.ts` does cover, kept here so the
    // pair is symmetric: a later narrowing that dropped a real look would fail
    // BOTH the census and this line.
    for (const value of DECLARED) {
      const result = SonnerMirror.safeParse({ ...MINIMAL_SONNER, buttonVariant: value });
      expect(result.success, `mirror refused real Button variant '${value}'`).toBe(true);
    }
  });

  it('the mirror refuses the values that render colourless — measured, not assumed', () => {
    // Each rejection is paired with the rendering that justifies it, in the
    // same iteration: the schema refuses the value AND the Button draws no
    // variant class for it. Neither half is load-bearing alone — the first
    // without the second is taste, the second without the first is the bug.
    for (const value of NOT_A_VARIANT) {
      expect(buttonVariants({ variant: value as never }), value).toBe(NO_VARIANT_CLASSES);
      const result = SonnerMirror.safeParse({ ...MINIMAL_SONNER, buttonVariant: value });
      expect(result.success, `mirror accepted non-variant '${value}'`).toBe(false);
    }
  });

  it('the mirror refuses `""` — the one wrong value that does not look wrong', () => {
    // Its own pin because its rendering is the opposite of the block above:
    // `cva`'s falsy fallback resolves `''` to `default`, so under the old
    // `z.string()` an author could write `buttonVariant: ''`, see a correctly
    // styled button, and never learn the value meant nothing.
    expect(buttonVariants({ variant: '' as never })).toBe(buttonVariants({ variant: 'default' }));
    expect(SonnerMirror.safeParse({ ...MINIMAL_SONNER, buttonVariant: '' }).success).toBe(false);
  });

  it('the key stays OPTIONAL — a bare `{ type: "sonner" }` still parses', () => {
    // The narrowing is on the accept-set of the VALUE, not on requiredness.
    // Every published `sonner` node that omits the key keeps parsing, and the
    // two catalog fixtures that set it (`destructive`, `outline`) are inside
    // the six — this is what bounds the blast radius of the narrowing.
    const result = SonnerMirror.safeParse(MINIMAL_SONNER);
    expect(result.success ? null : result.error.issues).toBe(null);
  });
});
