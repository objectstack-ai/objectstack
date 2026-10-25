/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9280 — `RecordHighlightsComponentProps.fields[]`'s object arm
 * declared a FIFTH key, `icon`, where the contract's arm is `$strict` over
 * four.
 *
 * The defect: this package declared
 * `{ name; label?; icon?; type?; readonly? }` while `@objectstack/spec`
 * `RecordHighlightsProps.fields[]`'s object arm declares
 * `name`/`label`/`type`/`readonly` behind a `never` catchall. `$strict` is the
 * load-bearing half: an unlisted key is REFUSED, not stripped, and the refusal
 * takes the whole document with it. So `{ name: 'amount', icon: 'dollar-sign' }`
 * type-checked here and was refused at publish with `invalid_union` — a green
 * local build and a rejection at the only layer that matters. Direction is
 * contract-first (Commandment #0.1, and triage's ruling on the card): the
 * declaration moves to the contract, the contract is not widened.
 *
 * ── Three instruments, and they do NOT see the same thing ──────────────────
 *
 *   - `tsc` sees the `@ts-expect-error` leg and the `Equal` assertions. That
 *     is the half that reaches a TypeScript author, and it means nothing
 *     unless `type-check` runs — vitest strips types.
 *   - vitest runs the `safeParse` legs against the INSTALLED published spec
 *     artifact, each with a control that would have fired. ⚠️ Those legs read
 *     the SPEC ONLY: they were green before this change and are green after,
 *     so they are the PREMISE, never the evidence. They are labelled PREMISE
 *     below so nobody counts them as the fix.
 *   - vitest ALSO reads this package's own declaration as TEXT, so the
 *     reintroduction of the key is caught even by a run that never
 *     type-checks. Its control is `sections[].icon` on the sibling interface
 *     one screen up: the same matcher finds THAT `icon` member, so an empty
 *     result on the highlights arm is a reading rather than a regex that
 *     cannot match anything.
 *
 * ⛔ `sections[].icon` (`RecordDetailsComponentProps`) is NOT this card's to
 * retire and this file must not grow into a pin that demands it: the contract
 * declares it, `DetailSection` genuinely draws it, and it is a different
 * member on a different face that merely shares the word. It appears here
 * only as a firing control.
 *
 * ⚠️ This file does not decide whether a highlight chip SHOULD carry an icon.
 * That route is an upstream `@objectstack/spec` widening on its own card.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RecordHighlightsProps } from '@objectstack/spec/ui';
import type { RecordHighlightsComponentProps } from '../record-components';

/** Rooted at THIS file, never at `process.cwd()` — the two differ per invocation. */
const HERE = dirname(fileURLToPath(import.meta.url));
const DECLARATION_PATH = join(HERE, '..', 'record-components.ts');

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The only assertion form used here — its constraint is what refuses `false`. */
type Expect<T extends true> = T;

/* ── Direction proofs: a broken instrument makes THIS file red ─────────────── */

// @ts-expect-error objectui#9280 — `Expect` must refuse `false`. Widen its constraint and this directive goes unused (TS2578).
type _ExpectRefusesFalse = Expect<false>;

// @ts-expect-error objectui#9280 — `never` must NOT read as equal to `true`. An `extends`-shaped comparison would let it through.
type _EqualRefusesNever = Expect<Equal<never, true>>;

// @ts-expect-error objectui#9280 — `any` must NOT read as equal to `true`, for the same reason.
type _EqualRefusesAny = Expect<Equal<any, true>>;

/* ── The object arm, member for member against the contract ───────────────── */

/** The object arm of the declared `fields[]` element union. */
type DeclaredEntry = Exclude<RecordHighlightsComponentProps['fields'][number], string>;

/**
 * RED before objectui#9280 (five keys against the contract's four), green
 * after. `Equal` is invariant, so this fails in EITHER direction: adding
 * `icon` back fails, and so would dropping `readonly`.
 */
type _EntryKeysMatchContract = Expect<
  Equal<keyof DeclaredEntry, 'name' | 'label' | 'type' | 'readonly'>
>;

/** The bare-string arm is untouched by the narrowing — only the object arm moved. */
type _StringArmSurvives = Expect<
  Equal<Extract<RecordHighlightsComponentProps['fields'][number], string>, string>
>;

/* ── Literals: what a TypeScript author can and cannot write ───────────────── */

/**
 * ⭐ THE LIT CONTROL for the `tsc` instrument: an entry the spec DOES accept,
 * on the same interface, in the same position. It compiles. Without it, the
 * refusal below is indistinguishable from an arm that refuses everything (or
 * from a `fields` key that stopped taking objects at all).
 */
const nameLabelAccepted: RecordHighlightsComponentProps = {
  fields: [{ name: 'amount', label: 'Amount' }],
};

/** The other two declared keys, so "closed set of four" is not read as "two". */
const typeReadonlyAccepted: RecordHighlightsComponentProps = {
  fields: [{ name: 'supply_share', type: 'number', readonly: true }],
};

/** The bare-string arm, the other half of the union, still compiles. */
const bareStringAccepted: RecordHighlightsComponentProps = {
  fields: ['amount'],
};

/**
 * The card's repro. `icon` compiled before objectui#9280 and was refused at
 * publish, taking the whole document with it; now `tsc` refuses it here, which
 * is the whole point of the change. Reintroduce the key on the arm and this
 * directive goes unused (TS2578) — that is the ablation leg.
 */
const iconRefused: RecordHighlightsComponentProps = {
  // @ts-expect-error objectui#9280 — the contract's arm is `$strict` over `name`/`label`/`type`/`readonly`; `icon` is refused at publish with `invalid_union`, whole-document.
  fields: [{ name: 'amount', icon: 'dollar-sign' }],
};

/** Any other undeclared key is refused the same way, by the same mechanism. */
const arbitraryKeyRefused: RecordHighlightsComponentProps = {
  // @ts-expect-error objectui#9280 — outside the contract's closed arm, exactly as `icon` now is.
  fields: [{ name: 'amount', zzzNonsense: 1 }],
};

/**
 * Read the object arm off the live schema rather than transcribing it.
 *
 * Reached through `RecordHighlightsProps.fields` — the path that actually
 * governs an authored entry — rather than through the exported
 * `RecordHighlightsField` alias, so the arm measured here is the arm a
 * document is parsed against. Walks both the zod v4 (`def`) and v3 (`_def`)
 * internal spellings, which is why the hops are typed structurally.
 */
type ZodInternals = {
  def?: Record<string, unknown>;
  _def?: Record<string, unknown>;
};
const internals = (node: unknown): Record<string, unknown> => {
  const n = (node ?? {}) as ZodInternals;
  return { ...(n._def ?? {}), ...(n.def ?? {}) };
};

function specEntryArm(): { keys: string[]; strict: boolean } {
  const shapeOfProps = internals(RecordHighlightsProps).shape as
    | Record<string, unknown>
    | undefined;
  const fields = shapeOfProps?.fields;
  const fieldsDef = internals(fields);
  const element = fieldsDef.element ?? fieldsDef.type;
  const arms = (internals(element).options ?? []) as unknown[];

  for (const arm of arms) {
    const armDef = internals(arm);
    const rawShape = armDef.shape;
    const resolved = (
      typeof rawShape === 'function' ? (rawShape as () => unknown)() : rawShape
    ) as Record<string, unknown> | undefined;
    if (resolved && typeof resolved === 'object') {
      const catchall = internals(armDef.catchall);
      return {
        keys: Object.keys(resolved).sort(),
        strict: (catchall.type ?? catchall.typeName) === 'never',
      };
    }
  }
  return { keys: [], strict: false };
}

describe('objectui#9280 — record:highlights `fields[]` entry against the installed spec', () => {
  it('PREMISE: the contract declares exactly four entry keys and refuses a fifth', () => {
    // Read off the schema object rather than transcribed, so a spec that adds
    // or drops a key fails HERE first — before the pins above start asserting
    // a shape the contract no longer has. ⭐ If this ever reports `icon` among
    // the keys, the contract WIDENED and this whole retirement is reversed by
    // a new card, not by loosening the assertions below.
    const arm = specEntryArm();
    expect(arm.keys).toEqual(['label', 'name', 'readonly', 'type']);

    // The load-bearing half. A non-strict arm would STRIP `icon` silently
    // instead of refusing, which is a different defect with a different repair.
    expect(arm.strict).toBe(true);
  });

  it("PREMISE: an entry carrying `icon` is refused with `invalid_union` at `fields.0` — the card's repro", () => {
    const refused = RecordHighlightsProps.safeParse({ fields: [{ name: 'x', icon: 'star' }] });
    expect(refused.success).toBe(false);
    const issue = refused.error?.issues.find((i) => i.path.join('.') === 'fields.0');
    expect(issue?.code).toBe('invalid_union');

    // CONTROL A — an arbitrary key is refused with the SAME code, so `icon`
    // is not special-cased by some bespoke branch.
    const arbitrary = RecordHighlightsProps.safeParse({
      fields: [{ name: 'x', zzzNonsense: 1 }],
    });
    expect(arbitrary.success).toBe(false);
    expect(arbitrary.error?.issues.find((i) => i.path.join('.') === 'fields.0')?.code).toBe(
      'invalid_union',
    );

    // CONTROL B — a declared key parses green and survives, so the arm is not
    // refusing everything. A refusal with no control that would have fired is
    // not a measurement.
    const accepted = RecordHighlightsProps.safeParse({ fields: [{ name: 'x', label: 'L' }] });
    expect(accepted.success).toBe(true);
    expect(accepted.data?.fields[0]).toMatchObject({ name: 'x', label: 'L' });

    // CONTROL C — the bare-string arm is unaffected, so the refusal above is
    // scoped to the object arm rather than to `fields` as a whole.
    const bare = RecordHighlightsProps.safeParse({ fields: ['x'] });
    expect(bare.success).toBe(true);
  });

  it('the DECLARATION carries the contract’s four keys and no fifth', () => {
    const source = readFileSync(DECLARATION_PATH, 'utf8');

    // Anchor on the interface so the match cannot drift onto another `icon`.
    const block = source.slice(source.indexOf('interface RecordHighlightsComponentProps'));
    expect(block).not.toBe('');
    const arm = /fields: Array<([\s\S]*?)>;/.exec(block)?.[1] ?? '';
    expect(arm).not.toBe('');
    expect(arm).not.toContain('icon');

    // Derived, not transcribed: the arm's members ARE the contract's members.
    const declaredKeys = Array.from(arm.matchAll(/(\w+)\??:/g))
      .map((m) => m[1])
      .sort();
    expect(declaredKeys).toEqual(specEntryArm().keys);

    // ⭐ THE LIT CONTROL for this instrument: the SAME `icon` matcher, run
    // against the sibling interface one screen up, FINDS the `sections[].icon`
    // member there (a different key on a different face — the contract
    // declares it and `DetailSection` draws it, ⛔ not this card's to retire).
    // So `not.toContain('icon')` above is a reading, not a matcher that can
    // never see the word. If that member ever moves, this control moves with
    // it — it must never be deleted outright.
    const siblingBlock = source.slice(
      source.indexOf('interface RecordDetailsComponentProps'),
      source.indexOf('interface RecordHighlightsComponentProps'),
    );
    expect(siblingBlock).toContain('icon?: string;');
  });

  it('the literals above are real values, not type-only decoration', () => {
    // vitest strips types, so these expectations are NOT the assertion — the
    // annotations are. They exist so the file also fails visibly if the
    // literals are ever silently emptied out.
    expect(nameLabelAccepted.fields[0]).toMatchObject({ name: 'amount', label: 'Amount' });
    expect(typeReadonlyAccepted.fields[0]).toMatchObject({ readonly: true });
    expect(bareStringAccepted.fields[0]).toBe('amount');
    expect(iconRefused.fields[0] as unknown).toMatchObject({ icon: 'dollar-sign' });
    expect(arbitraryKeyRefused.fields[0] as unknown).toMatchObject({ zzzNonsense: 1 });
  });
});
