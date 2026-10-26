/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8583 — `RecordDetailsComponentProps.sections[]` and the
 * `@objectstack/spec` `RecordDetailsProps.sections[]` member set, both
 * directions of the divergence the card measured.
 *
 * - **item 1** — this type declares the six keys the spec declares and it used
 *   to omit: `columns`, `icon`, `description`, `showBorder`,
 *   `defaultCollapsed`, `headerColor`.
 * - **item 2** — this type no longer declares `collapsed`, the one key it
 *   declared that the spec REFUSES by name. Retired outright, no transition
 *   window (director seat, decision batch #101, applying batch #87 — this repo
 *   does not declare a key the spec refuses by name — and the 2026-08-27
 *   retirement-pacing ruling). `defaultCollapsed` is the surviving spelling.
 * - **objectui#12348** — this type declares `hideEmpty`, which the spec
 *   declares and the renderer reads, and the pin now holds the WHOLE member
 *   set to the installed spec in both directions (key set and each member's
 *   type), so the next spec member cannot go missing unnoticed.
 *
 * ## Why this pin is compile-time, and why a runtime pin alone measures nothing
 *
 * The change is a TYPE declaration. Every one of the six was already honoured
 * by the renderer — `RecordDetailsRenderer` spreads each authored section
 * through to `DetailSection`, which reads all six — and accepted by the spec's
 * parser, so nothing at runtime moves; the only layer that said no was `tsc`.
 * `vitest` strips types: the card recorded that
 * `{ sections: [{ group: 'terms', columns: 2 }] }` was GREEN under vitest on
 * the unfixed type and refused only by `type-check`. So the load-bearing half
 * of this file is what the compiler sees, and this package compiles its tests
 * through `tsconfig.test.json` — the THIRD leg of its `type-check` script
 * (`tsc --noEmit && tsc -p tsconfig.examples.json && tsc -p tsconfig.test.json`),
 * the only leg that reads this file.
 *
 * ## How the direction is proved rather than asserted
 *
 * TypeScript reports an UNUSED `@ts-expect-error` as an error (TS2578), so
 * each directive below is a claim that the instrument REFUSES something:
 * `Expect` refuses `false`, `Equal` is invariant (neither `never` nor `any`
 * reads as `true`), a key nothing declares is not a member, and an excess key
 * on a section literal does not compile. Break any of those and this file goes
 * red on the now-unused directive rather than quietly passing. Same shape as
 * `data-table-declared-keys-6882.test.ts` next door.
 *
 * ## The runtime half: the two-control probe on the INSTALLED spec
 *
 * The type is a mirror, and what it mirrors is read out of the installed
 * `@objectstack/spec` at test time, never restated: the six names must be in
 * the section object's shape; a canonical section carrying all six must parse
 * with NO issues (the parser accepts the six); and the same section plus one
 * key nobody declares must draw `unrecognized_keys` naming exactly that key
 * (the parser CAN refuse, so a refusal is about the name). Either leg alone is
 * not a reading.
 */
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { RecordDetailsProps } from '@objectstack/spec/ui';
import { arrayElementSchema, listedShapeKeys, resolvePropsShape } from '@object-ui/test-support';
import type { RecordDetailsComponentProps } from '../record-components';

/** One authored `sections[]` entry, as this package declares it. */
type Section = NonNullable<RecordDetailsComponentProps['sections']>[number];

/**
 * The same entry on the spec's AUTHORING surface. `z.input`, not `z.output`:
 * this type describes what an author writes, and an output type would carry
 * every `.default()` as required.
 */
type SpecSection = NonNullable<z.input<typeof RecordDetailsProps>['sections']>[number];

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/** The only assertion form used here — its constraint is what refuses `false`. */
type Expect<T extends true> = T;

/** Is `K` a DECLARED member of a section entry? */
type IsSectionMember<K extends PropertyKey> = K extends keyof Section ? true : false;

/* ── Direction proofs: a broken instrument makes THIS file red ─────────────── */

// @ts-expect-error objectui#8583 — `Expect` must refuse `false`. Widen its constraint and this directive goes unused (TS2578).
type _ExpectRefusesFalse = Expect<false>;

// @ts-expect-error objectui#8583 — `never` must NOT read as equal to `true`. An `extends`-shaped comparison would let it through.
type _EqualRefusesNever = Expect<Equal<never, true>>;

// @ts-expect-error objectui#8583 — `any` must NOT read as equal to `true`, for the same reason.
type _EqualRefusesAny = Expect<Equal<any, true>>;

// @ts-expect-error objectui#8583 — a key nothing declares must answer `false`. If the section entry ever grew an index signature this would answer `true` and the directive would go unused.
type _UndeclaredKeyIsRefused = Expect<IsSectionMember<'bogusKeyNobodyDeclares8583'>>;

/* ── The six: declared, and each with the spec's own authoring type ────────── */

/** RED before objectui#8583 (`Property 'columns' does not exist on type …`), green after. */
type _Columns = Expect<Equal<Section['columns'], SpecSection['columns']>>;
/** RED before objectui#8583, green after. */
type _Icon = Expect<Equal<Section['icon'], SpecSection['icon']>>;
/** RED before objectui#8583, green after. */
type _Description = Expect<Equal<Section['description'], SpecSection['description']>>;
/** RED before objectui#8583, green after. */
type _ShowBorder = Expect<Equal<Section['showBorder'], SpecSection['showBorder']>>;
/** RED before objectui#8583, green after. */
type _DefaultCollapsed = Expect<Equal<Section['defaultCollapsed'], SpecSection['defaultCollapsed']>>;
/** RED before objectui#8583, green after — the closed six-token vocabulary, not `string`. */
type _HeaderColor = Expect<Equal<Section['headerColor'], SpecSection['headerColor']>>;

/* ── objectui#12348: `hideEmpty`, and the WHOLE member set, both directions ─── */

/**
 * RED before objectui#12348 (`Property 'hideEmpty' does not exist on type …`),
 * green after. Spec 17.3.0+ declares it on the section; `RecordDetailsRenderer`
 * reads it (`s.hideEmpty ?? true`).
 */
type _HideEmpty = Expect<Equal<Section['hideEmpty'], SpecSection['hideEmpty']>>;

/**
 * The drift guard objectui#12348 adds, so a member cannot go missing again one
 * key at a time: the section entry's KEY SET equals the installed spec's, in
 * both directions at once. A member the spec gains and this type omits, or a
 * member this type declares and the spec does not, turns `Equal` false and
 * this line red under `type-check`. The per-key `Equal` pins above say WHICH
 * type each member carries; this line says no member is missing or extra.
 */
type _KeySetMirrorsSpec = Expect<Equal<keyof Section, keyof SpecSection>>;

/**
 * Every member, each with the spec's own authoring type — the mapped form of
 * the per-key pins above, so a member added on both sides later is held to the
 * spec's type without anyone remembering to write its line.
 */
type MemberTypeMirrors = { [K in keyof SpecSection]-?: Equal<Section[K & keyof Section], SpecSection[K]> };
type _EveryMemberTypeMirrorsSpec = Expect<Equal<MemberTypeMirrors[keyof MemberTypeMirrors], true>>;

/**
 * The same member set as a runtime list, for the vitest half (vitest strips
 * types, so the line above is invisible to it). The annotation below ties the
 * list to the TYPE in both directions; the `it` below ties it to the INSTALLED
 * spec's shape in both directions. Together: type == list == spec.
 */
const MIRRORED_SECTION_KEYS = [
  'name', 'label', 'columns', 'group', 'fields', 'hideEmpty', 'collapsible',
  'showBorder', 'defaultCollapsed', 'icon', 'description', 'headerColor', 'count',
] as const;
type _ListIsTheTypesKeySet = Expect<Equal<(typeof MIRRORED_SECTION_KEYS)[number], keyof Section>>;

/* ── Literals: what an author can now write, and what they still cannot ────── */

const SIX = ['columns', 'icon', 'description', 'showBorder', 'defaultCollapsed', 'headerColor'] as const;

/**
 * The card's own repro — a shape the spec accepts and `tsc` refused before
 * objectui#8583 with TS2353 on `columns`. The annotation is the assertion.
 */
const groupReferenceWithLayout: RecordDetailsComponentProps = {
  sections: [{ group: 'terms', columns: 2 }],
};

/** A canonical enumerated section carrying all six, typed against THIS package. */
const canonicalSection: Section = {
  name: 'contact',
  label: 'Contact',
  fields: ['phone', 'email'],
  columns: 2,
  icon: 'user',
  description: 'How to reach them',
  showBorder: true,
  collapsible: true,
  defaultCollapsed: false,
  headerColor: 'muted',
};

/**
 * The compile-time control: excess-property checking on this literal is what
 * makes the declared member set reach a TypeScript author at all. A key nothing
 * declares must not compile — otherwise the six being accepted above would say
 * nothing.
 */
const refusedByTsc: RecordDetailsComponentProps = {
  sections: [
    {
      fields: ['phone'],
      // @ts-expect-error objectui#8583 — a key nothing declares is refused on the section literal.
      __objectui_8583_probe__: true,
    },
  ],
};

/* ── item 2: `collapsed` is RETIRED, `defaultCollapsed` is the spelling ───── */

/**
 * The retired key must NOT be a member. The directive is the assertion: re-add
 * `collapsed?: boolean` to the section entry and `Expect<true>` compiles, the
 * directive goes UNUSED, and TypeScript reports TS2578 here. That is the
 * ablation this pin is built to fail on.
 */
// @ts-expect-error objectui#8583 (item 2) — `collapsed` is retired; it is not a member of the section entry.
type _CollapsedIsRetired = Expect<IsSectionMember<'collapsed'>>;

/**
 * The surviving spelling, asserted with NO directive so it carries the other
 * half: were `defaultCollapsed` ever dropped too, this line goes red on its own
 * terms rather than leaving the pin above to pass over an entry that declares
 * neither collapse key.
 */
type _DefaultCollapsedSurvives = Expect<IsSectionMember<'defaultCollapsed'>>;

/**
 * FROM `collapsed` TO `defaultCollapsed`, at the authoring site an external
 * consumer actually writes. Excess-property checking on the section literal is
 * what turns the retirement into a compile error (TS2353 naming the key) rather
 * than a value that is silently carried and never read.
 */
const retiredSpellingRefusedByTsc: RecordDetailsComponentProps = {
  sections: [
    {
      fields: ['phone'],
      collapsible: true,
      // @ts-expect-error objectui#8583 (item 2) — the retired spelling does not compile; write `defaultCollapsed`.
      collapsed: true,
    },
  ],
};

/** The same literal in the surviving spelling — no directive, so it MUST compile. */
const survivingSpellingAccepted: RecordDetailsComponentProps = {
  sections: [
    {
      fields: ['phone'],
      collapsible: true,
      defaultCollapsed: true,
    },
  ],
};

/** Member keys of one `sections[]` entry, read off the INSTALLED spec. */
const specSectionKeys = (): string[] =>
  listedShapeKeys(arrayElementSchema(resolvePropsShape(RecordDetailsProps)?.sections));

/**
 * The keys an `unrecognized_keys` issue names. Zod's issue union carries `keys`
 * on that one member only, so the read goes through the same widening cast the
 * sibling `recordDetailsInputs.spec-parity.test.ts` uses.
 */
const refusedKeys = (issues: ReadonlyArray<unknown> | undefined): string[] =>
  (issues ?? []).flatMap((i) => (i as { keys?: string[] }).keys ?? []);

describe('record:details `sections[]` mirrors the spec member set, both directions (objectui#8583)', () => {
  it('the installed spec still declares all six on the section object', () => {
    // The premise the compile-time pins rest on: were the spec to drop one, the
    // `Equal` above would go red for the right reason, and this names it first.
    expect(specSectionKeys()).toEqual(expect.arrayContaining([...SIX]));
  });

  it('control A — a canonical section carrying all six parses with no issues', () => {
    const parsed = RecordDetailsProps.safeParse({ sections: [canonicalSection] });
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    // The six SURVIVE the parse — the key-reachability criterion, not a bare
    // success receipt (a stripping schema would hand out that too).
    expect(parsed.data?.sections?.[0]).toMatchObject({
      columns: 2,
      icon: 'user',
      description: 'How to reach them',
      showBorder: true,
      defaultCollapsed: false,
      headerColor: 'muted',
    });
  });

  it('control B — the same section plus a key nobody declares draws `unrecognized_keys` naming exactly that key', () => {
    const parsed = RecordDetailsProps.safeParse({
      sections: [{ ...canonicalSection, __objectui_8583_probe__: true }],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
    // Envelope, not a bare failure: the refusal names the probe and NONE of the
    // six — which is what makes control A's acceptance attributable to the
    // names rather than to a parser that never refuses anything.
    expect(refusedKeys(parsed.error?.issues)).toEqual(['__objectui_8583_probe__']);
  });

  it("the card's repro — `{ group, columns }` — is accepted by the spec and, now, by this type", () => {
    // `columns` is one of the three keys the spec permits BESIDE `group` (it
    // describes how this page lays the section out), so this literal is
    // spec-valid, renderer-honoured, and until objectui#8583 refused by `tsc`
    // alone. The compile is the assertion; the parse pins the premise.
    const parsed = RecordDetailsProps.safeParse(groupReferenceWithLayout);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    expect(groupReferenceWithLayout.sections?.[0]).toEqual({ group: 'terms', columns: 2 });
  });

  it('`headerColor` mirrors a CLOSED vocabulary — an off-vocabulary value is refused on its value', () => {
    // A VALUE verdict on the contract side, so the union declared here is
    // provably no wider than what the spec accepts: `bg-muted` is a string,
    // and the spec refuses it by name of the option set, not by type.
    const parsed = RecordDetailsProps.safeParse({
      sections: [{ ...canonicalSection, headerColor: 'bg-muted' }],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => [i.code, i.path.join('.')])).toContainEqual([
      'invalid_value',
      'sections.0.headerColor',
    ]);
  });

  it('item 2 — the installed spec does not declare `collapsed`, and refuses it BY NAME', () => {
    // The premise batch #87 rests on, measured rather than recalled, and with
    // its own control in the same read: a zero here is a reading only because
    // the surviving spelling is present in the same key list.
    const keys = specSectionKeys();
    expect(keys).toContain('defaultCollapsed');
    expect(keys).not.toContain('collapsed');

    // And the refusal is attributable to the NAME, not to a parser that refuses
    // everything: the same canonical section parsed clean in control A above.
    const parsed = RecordDetailsProps.safeParse({
      sections: [{ ...canonicalSection, collapsed: true }],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
    expect(refusedKeys(parsed.error?.issues)).toEqual(['collapsed']);
  });

  it('objectui#12348 — the section member set equals the installed spec\'s, both directions', () => {
    // Both directions in one equality: a key the spec gains that the list (and,
    // through `_ListIsTheTypesKeySet`, the type) lacks fails it, and so does a
    // key the list keeps after the spec drops it. The 'all six' check above is
    // one-directional (`arrayContaining`); this one is not.
    expect([...specSectionKeys()].sort()).toEqual([...MIRRORED_SECTION_KEYS].sort());
  });

  it('objectui#12348 — `hideEmpty` is accepted by the spec, survives the parse, and is permitted beside `group`', () => {
    const enumerated: Section = { ...canonicalSection, hideEmpty: false };
    const parsed = RecordDetailsProps.safeParse({ sections: [enumerated] });
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.data?.sections?.[0]).toMatchObject({ hideEmpty: false });

    // The card's shape against a group reference: `hideEmpty` is not one of
    // the keys a group declares, so the spec admits it beside `group`.
    const grouped: RecordDetailsComponentProps = { sections: [{ group: 'terms', hideEmpty: false }] };
    const groupedParsed = RecordDetailsProps.safeParse(grouped);
    expect(groupedParsed.error?.issues ?? []).toEqual([]);
    expect(groupedParsed.data?.sections?.[0]).toMatchObject({ group: 'terms', hideEmpty: false });

    // Control: the same position refuses a VALUE of the wrong type, so the
    // acceptance above is about `hideEmpty` being declared as a boolean.
    const wrongValue = RecordDetailsProps.safeParse({ sections: [{ ...canonicalSection, hideEmpty: 'no' }] });
    expect(wrongValue.success).toBe(false);
    expect(wrongValue.error?.issues.map((i) => [i.code, i.path.join('.')])).toContainEqual([
      'invalid_type',
      'sections.0.hideEmpty',
    ]);
  });

  it('keeps the compile-time literals alive at runtime', () => {
    // Runtime shape is unaffected by the type-level assertions above; these
    // exist so the file also fails visibly if a literal is ever emptied.
    expect(canonicalSection.headerColor).toBe('muted');
    expect(refusedByTsc.sections).toHaveLength(1);
    // item 2's pair. `collapsed` is read through `Object.keys` because the type
    // no longer declares it — which is the whole point of the pin above.
    expect(Object.keys(retiredSpellingRefusedByTsc.sections?.[0] ?? {})).toContain('collapsed');
    expect(survivingSpellingAccepted.sections?.[0]?.defaultCollapsed).toBe(true);
  });
});
