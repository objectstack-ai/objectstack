/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9040 — `RecordDetailsComponentProps`'s TOP LEVEL against the
 * contract, in both directions. objectui#8583 reconciled `sections[]`
 * member-for-member and objectui#8604 fixed the top-level `columns` type; the
 * top-level KEY SET had never been reconciled, and it diverged both ways.
 *
 * Direction 1 — OMISSIONS (fixed here). `hideFields`, `inlineEdit` and
 * `showHeader` are declared by `@objectstack/spec`, read by
 * `RecordDetailsRenderer`, and published as inputs by
 * `@object-ui/plugin-detail`'s registry manifest (objectui#3808 for
 * `hideFields`, objectui#4668 for the other two). Every layer declared them
 * except this published TypeScript face, so a spec-valid, renderer-honoured,
 * registry-published document was refused by `tsc` with `TS2353`.
 *
 * Direction 2 — the RETIRED `layout` (DONE, item 1 of the same card). The
 * contract refuses it by name; this face offered a third spelling of it. The
 * key is now GONE from this interface, which is a published-surface
 * retirement — `.changeset/9040-retire-record-details-layout.md` carries its
 * FROM/TO. The legs below no longer ledger an open divergence; they assert the
 * removal and go red if the member is re-added.
 *
 * ⚠️ The consumer survey that removal needed is the reason this file gained a
 * SOURCE-TEXT leg. `tsc` named two consumer files; it is structurally blind to
 * the third (`record-highlights-layout-9187.test.ts` read this declaration as
 * TEXT), and vitest is blind to the two. Neither instrument alone enumerates
 * the consumers of a published type — that reading is recorded here so the
 * next retirement on this interface does not re-learn it from CI.
 *
 * ── Three instruments, and no one of them sees the whole change ─────────────
 *   - `tsc` sees the `@ts-expect-error` legs and the `Equal` assertions. That
 *     is the ONLY half that discriminates direction 1's fix from its defect,
 *     because that defect was a TypeScript-only refusal. It means nothing
 *     unless `type-check` runs — vitest strips types.
 *   - vitest runs the `safeParse` legs against the INSTALLED published spec
 *     artifact (the version `check:installed-pin-claims` re-derives), each with
 *     a control that would have fired. ⚠️ Those legs read the SPEC ONLY: they
 *     were green before this card and are green after, so they are the PREMISE,
 *     never the evidence. They are labelled PREMISE below so nobody counts them
 *     as the fix.
 *   - vitest ALSO reads this package's own declaration as TEXT, so a
 *     re-introduced `layout` is caught by a run that never type-checks. Its
 *     control is the sibling interface, whose `layout` the contract DOES
 *     declare: the same matcher finds that one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { z } from 'zod';
import { RecordDetailsProps } from '@objectstack/spec/ui';
import type { RecordDetailsComponentProps } from '../record-components';
import type { IsRetiredKeyType } from './retired-key-type';

/** Rooted at THIS file, never at `process.cwd()` — the two differ per invocation. */
const HERE = dirname(fileURLToPath(import.meta.url));
const DECLARATION_PATH = join(HERE, '..', 'record-components.ts');

/** What an author writes for the spec's `record:details` props bag. */
type SpecProps = z.input<typeof RecordDetailsProps>;

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The only assertion form used here — its constraint is what refuses `false`. */
type Expect<T extends true> = T;

/* ── Direction proofs: a broken instrument makes THIS file red ─────────────── */

// @ts-expect-error objectui#9040 — `Expect` must refuse `false`. Widen its constraint and this directive goes unused (TS2578).
type _ExpectRefusesFalse = Expect<false>;

// @ts-expect-error objectui#9040 — `never` must NOT read as equal to `true`. An `extends`-shaped comparison would let it through.
type _EqualRefusesNever = Expect<Equal<never, true>>;

// @ts-expect-error objectui#9040 — `any` must NOT read as equal to `true`, for the same reason.
type _EqualRefusesAny = Expect<Equal<any, true>>;

/* ── Direction 1: the three omitted keys carry the contract's own types ────── */

/** RED before objectui#9040 (the key did not exist here), green after. */
type _HideFields = Expect<
  Equal<RecordDetailsComponentProps['hideFields'], SpecProps['hideFields']>
>;
type _InlineEdit = Expect<
  Equal<RecordDetailsComponentProps['inlineEdit'], SpecProps['inlineEdit']>
>;
type _ShowHeader = Expect<
  Equal<RecordDetailsComponentProps['showHeader'], SpecProps['showHeader']>
>;

/**
 * Spelled out as well as derived. `Equal` against `SpecProps` would also be
 * satisfied if BOTH faces drifted to the same wrong type; these say what the
 * type actually is, so a spec that widened `hideFields` to accept the `{name}`
 * dialect the renderer tolerates cannot pull this declaration along silently.
 */
type _HideFieldsIsBareNames = Expect<
  Equal<RecordDetailsComponentProps['hideFields'], string[] | undefined>
>;
type _InlineEditIsBoolean = Expect<
  Equal<RecordDetailsComponentProps['inlineEdit'], boolean | undefined>
>;
type _ShowHeaderIsBoolean = Expect<
  Equal<RecordDetailsComponentProps['showHeader'], boolean | undefined>
>;

/**
 * The card's repro, as a literal. Every key here is spec-valid and honoured by
 * `RecordDetailsRenderer`; before objectui#9040 this object did not compile
 * (`TS2353`, three times over) while the contract accepted the document.
 */
const omittedKeysAccepted: RecordDetailsComponentProps = {
  hideFields: ['name'],
  inlineEdit: false,
  showHeader: true,
};

/**
 * The value fences, in the direction the contract holds.
 *
 * ⚠️ NOT evidence for direction 1: an unknown key is `TS2353` too, so these
 * directives were "used" before the fix as well and cannot tell the two worlds
 * apart. The `Equal` assertions above are what do that. These exist so the new
 * keys cannot later be loosened to `any` / `unknown` without a red line.
 */
const hideFieldsRefusesTheTolerantDialect: RecordDetailsComponentProps = {
  // @ts-expect-error objectui#9040 — `hideFields` is `z.array(z.string())`: bare field names, never the `{name}` objects the renderer tolerates at its read site.
  hideFields: [{ name: 'amount' }],
};

const inlineEditRefusesStrings: RecordDetailsComponentProps = {
  // @ts-expect-error objectui#9040 — `inlineEdit` is a boolean on both faces; the string is refused here and with `invalid_type` at publish.
  inlineEdit: 'yes',
};

/* ── Direction 2: the retired `layout`, REMOVED from this face ───────────── */

/**
 * The key is GONE. The two faces used to DISAGREE: the contract's tombstone
 * accepts nothing there (`z.never()` under its optional wrapper, so the
 * authoring type admits only absence) while this one offered
 * `stacked` | `inline` | `compact` — a third spelling, no value of which ever
 * parsed. They now agree by removal.
 *
 * Written as a `keyof` absence rather than as an index, because indexing a key
 * that no longer exists is itself a compile error: this form stays readable AND
 * turns red the moment the member is re-added.
 */
type _LayoutIsNoLongerDeclared = Expect<
  Equal<'layout' extends keyof RecordDetailsComponentProps ? true : false, false>
>;

/**
 * THE CONTROL for the line above, on the same instrument: a key that IS
 * declared reads `true` through the identical form. Without it,
 * `_LayoutIsNoLongerDeclared` would also be satisfied by a `keyof` that had
 * stopped resolving anything at all — an interface emptied by a bad revert
 * would read as a successful retirement.
 */
type _KeyofStillResolvesOnThisInterface = Expect<
  Equal<'columns' extends keyof RecordDetailsComponentProps ? true : false, true>
>;

/**
 * The contract's face, untouched by this removal: the tombstone accepts nothing.
 * Its type is the spec's retired-key type — the branded `[REMOVED]` mark at the
 * pinned 18.1.0 and on objectstack `main`,
 * bare `undefined` through 17.5.0 — and the helper accepts
 * exactly those two spellings (objectui#11330).
 */
type _LayoutOnTheContractFace = Expect<IsRetiredKeyType<SpecProps['layout']>>;

/** THE CONTROL for the line above, through the same helper: a live contract key is not retired. */
type _ColumnsOnTheContractFaceIsLive = Expect<Equal<IsRetiredKeyType<SpecProps['columns']>, false>>;

/**
 * The retirement, as a literal: authoring `layout` is `TS2353` here now, so
 * `tsc` and the contract finally refuse the same document. The live `columns`
 * beside it is what makes the directive specific — a literal whose ONLY member
 * were the retired key would also error if the whole interface disappeared.
 */
const layoutIsRefusedByTsc: RecordDetailsComponentProps = {
  columns: '2',
  // @ts-expect-error objectui#9040 — `layout` is RETIRED from this face. `@objectstack/spec` removed it in 17.0.0 (ADR-0087 D2) and refuses it by name; there is no replacement key.
  layout: 'stacked',
};

describe('objectui#9040 — record:details top level, against the installed spec', () => {
  it('PREMISE (spec-only): the three keys are live members that judge their values', () => {
    // Spec-only: green before and after objectui#9040. It is here so a spec
    // that retires one of the three fails HERE, naming the key, instead of
    // leaving the declarations above asserting a shape the contract dropped.
    for (const [payload, expected] of [
      [{ hideFields: ['secret'] }, { hideFields: ['secret'] }],
      [{ inlineEdit: true }, { inlineEdit: true }],
      [{ inlineEdit: false }, { inlineEdit: false }],
      [{ showHeader: true }, { showHeader: true }],
    ] as const) {
      const parsed = RecordDetailsProps.safeParse(payload);
      // A FULL green parse, not merely "no unrecognized_keys": these legs are
      // about the key being real AND its value being judged.
      expect(parsed.success, `the contract refused ${JSON.stringify(payload)}`).toBe(true);
      expect(parsed.data).toMatchObject(expected);
    }

    // The other half: each key judges VALUES, so "accepted" above is not the
    // same reading an open bag would produce.
    for (const [key, bad] of [
      ['hideFields', 'notAnArray'],
      ['inlineEdit', 'yes'],
      ['showHeader', 'yes'],
    ] as const) {
      const refused = RecordDetailsProps.safeParse({ [key]: bad });
      expect(refused.success, `${key} accepted a wrongly-typed value`).toBe(false);
      const issue = refused.error?.issues.find((i) => i.path.join('.') === key);
      expect(issue?.code, `${key} was refused, but not at its own path`).toBe('invalid_type');
    }

    // THE CONTROL, on the same instrument: an undeclared key is refused with a
    // DIFFERENT code, so the greens above are about these three keys and not
    // about a schema that accepts anything.
    const nonsense = RecordDetailsProps.safeParse({ zzzNonsenseKey: 'whatever' });
    expect(nonsense.success).toBe(false);
    expect(nonsense.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('PREMISE (spec-only): `layout` is refused BY NAME, not swept up as an unknown key', () => {
    // The distinction this leg exists for: a tombstone is still a declared
    // member typed `never`, so it fails with `invalid_type` at its own path
    // and carries the removal prescription. An undeclared key fails with
    // `unrecognized_keys` at the root. Reading them as the same failure is how
    // a retired key gets mistaken for a typo.
    for (const value of ['stacked', 'inline', 'compact', 'auto', 'custom']) {
      const refused = RecordDetailsProps.safeParse({ layout: value });
      expect(refused.success, `the contract accepted layout: ${value}`).toBe(false);
      const issue = refused.error?.issues.find((i) => i.path.join('.') === 'layout');
      expect(issue?.code).toBe('invalid_type');
      expect(issue?.message).toContain('was removed in @objectstack/spec 17.0.0');
    }

    // CONTROL A — a near-miss typo of the same key gets the OTHER code, which
    // is what makes "by name" a reading rather than a claim.
    const typo = RecordDetailsProps.safeParse({ layoutt: 'compact' });
    expect(typo.success).toBe(false);
    expect(typo.error?.issues[0]?.code).toBe('unrecognized_keys');

    // CONTROL B — a live key on the same instrument parses green, so the
    // refusals above are not a schema refusing everything.
    expect(RecordDetailsProps.safeParse({ columns: '2' }).success).toBe(true);
  });

  it('CONTROL: the keys that were ALREADY correct stay correct on both faces', () => {
    // The live control for the ablation of this change: `columns`, `fields`,
    // `sections` and `aria` are green whether or not objectui#9040 is applied.
    // A leg that cannot tell the two worlds apart is named as such and is not
    // counted as evidence — this one exists to catch an over-broad revert that
    // takes the whole interface with it.
    const alreadyCorrect: RecordDetailsComponentProps = {
      columns: '2',
      fields: ['name'],
      sections: [{ label: 'Info', fields: ['name'] }],
      aria: { ariaLabel: 'Account Details' },
    };
    expect(alreadyCorrect.columns).toBe('2');

    const parsed = RecordDetailsProps.safeParse({
      columns: '2',
      fields: ['name'],
      sections: [{ label: 'Info', fields: ['name'] }],
      aria: { ariaLabel: 'Account Details' },
    });
    expect(parsed.success).toBe(true);
  });

  it('the literals above are real values, not type-only decoration', () => {
    // vitest strips types, so these expectations are NOT the assertion — the
    // annotations are. They exist so the file also fails visibly if the
    // literals are ever silently emptied out.
    expect(omittedKeysAccepted.hideFields).toEqual(['name']);
    expect(omittedKeysAccepted.inlineEdit).toBe(false);
    expect(omittedKeysAccepted.showHeader).toBe(true);
    expect(hideFieldsRefusesTheTolerantDialect.hideFields as unknown).toEqual([{ name: 'amount' }]);
    expect(inlineEditRefusesStrings.inlineEdit as unknown).toBe('yes');
    // `layout` is no longer a member, so this reads the literal's runtime keys
    // rather than the property: the point is that the `@ts-expect-error` above
    // guards a shape an author really writes, not an emptied-out object.
    expect(Object.keys(layoutIsRefusedByTsc)).toContain('layout');
    expect(layoutIsRefusedByTsc.columns).toBe('2');
  });

  it('the DECLARATION no longer carries `layout` (objectui#9040 item 1)', () => {
    // The instrument `tsc` cannot be: a source-text read, so a re-introduced
    // member is caught even by a run that never type-checks. It is also the
    // instrument that FOUND the third consumer of this key during the
    // retirement survey — `record-highlights-layout-9187.test.ts` read this
    // same declaration as text, and no type checker could see that.
    const source = readFileSync(DECLARATION_PATH, 'utf8');

    // Anchored on the interface AND bounded by the next one, so the read cannot
    // wander onto the `layout` that legitimately lives on the sibling below.
    const start = source.indexOf('interface RecordDetailsComponentProps');
    const end = source.indexOf('interface RecordHighlightsComponentProps');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);

    expect(/^\s*layout\?:/m.test(block)).toBe(false);

    // ⭐ THE LIT CONTROL for this instrument: the SAME matcher, run over the
    // sibling block, FINDS a `layout?:` there. That one is a different key on a
    // different face — `@objectstack/spec` declares
    // `RecordHighlightsProps.layout` and this retirement does not touch it
    // (objectui#9187 pins its two values). So the absence above is a reading,
    // not a matcher that can never match.
    expect(/^\s*layout\?:/m.test(source.slice(end))).toBe(true);

    // CONTROL B — the block is the real one and still carries its live members,
    // so the absence is not an empty slice satisfying every negative.
    expect(block).toContain("columns?: '1' | '2' | '3' | '4';");
    expect(block).toContain('hideFields?: string[];');
  });

  it('the whole document the three keys make possible is accepted by the contract', () => {
    // End to end, in the shape a page actually authors: the omitted-keys fix is
    // only worth anything if the keys compose with the ones already declared.
    const authored: RecordDetailsComponentProps = {
      columns: '2',
      fields: ['name', 'amount', 'stage'],
      hideFields: ['name'],
      inlineEdit: false,
      showHeader: true,
      sections: [{ name: 'info', label: 'Info', fields: ['amount'], columns: 2 }],
      aria: { ariaLabel: 'Opportunity Details' },
    };

    const parsed = RecordDetailsProps.safeParse(authored);
    expect(
      parsed.success,
      `the contract refused a document this type now accepts: ${JSON.stringify(
        parsed.success ? [] : parsed.error.issues,
      )}`,
    ).toBe(true);
  });
});
