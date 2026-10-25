// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two form CONTAINERS are one declaration each, derived from the spec —
 * objectui#5596.
 *
 * ## The defect this closes
 *
 * objectui#5040 / #5542 are one contract described several times, each
 * description only ever checked against itself. #5542 converged the LEAF
 * (`FormFieldSpec`). The two containers above it — `FormSectionSpec` and
 * `FormViewSpec` — were still hand-declared twice, once here and once in
 * `apps/console`'s `FormPage.tsx`, and unlike the leaf they had ALREADY drifted
 * in both directions, so neither was a subset of the other:
 *
 *   FormSectionSpec  this side had `description` / `visibleWhen` / `visibleOn`,
 *                    the console had none of them; the console's `columns`
 *                    admitted the string arm, this side's did not.
 *   FormViewSpec     the console had `label` / `groups` / `sharing` /
 *                    `submitBehavior`, this side stopped at `type` + `sections`.
 *
 * Two live answers to "what may an author write", one nesting level above a
 * contract that had just been converged.
 *
 * ## What is pinned, and by which tool
 *
 *   • **`tsc`** — {@link formContainerContractPins}. Type assertions are erased
 *     at runtime, so vitest proves nothing about them; this package's
 *     `type-check` script (`tsc -p tsconfig.test.json`, the only project that
 *     compiles this directory's tests) is what judges them. The DERIVATION pins
 *     are the ones that close the class: they compare the non-narrowed half of
 *     each type against `@objectstack/spec`'s own `FormSection` / `FormView`, so
 *     re-hand-writing either declaration fails here the day the spec moves,
 *     rather than years later when someone reads two files side by side. Each
 *     narrowing has a matching negative pin, so "derived" can never quietly
 *     become "widened to whatever the spec says". PIN I extends that promise
 *     down one level, to the LEAF's option element (objectui#6263): its two
 *     narrowings — `visibleWhen` re-pointed, `default` dropped — were the last
 *     ones resting on a comment alone, and `default` is the one a maintainer
 *     actually ruled on.
 *   • **vitest** — the render block. The widening this convergence performs is
 *     asserted INERT and, for `columns`, load-bearing: a section that spells its
 *     column count as the string `'3'` — legal metadata `FormSectionSchema`
 *     accepts and this renderer used to refuse at the type level — lays out
 *     identically to the numeric `3`. A pin that only proved the key
 *     type-checks would go green against a value the renderer mangles.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { SelectOption } from '@objectstack/spec/data';
import type { FormSection, FormView } from '@objectstack/spec/ui';
import { SchemaForm } from './SchemaForm';
import type { FormFieldSpec, FormSectionSpec, FormViewSpec } from './form-spec';

afterEach(cleanup);

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

/**
 * The positions {@link FormSectionSpec} deliberately overrides. `visibleOn` is
 * overridden by ABSENCE (objectui#12696): PIN J pins that it is refused.
 */
type SectionNarrowed = 'fields' | 'label' | 'description' | 'visibleWhen' | 'visibleOn';
/** The positions {@link FormViewSpec} deliberately overrides. */
type ViewNarrowed = 'sections' | 'groups';

/**
 * These never run. They are the half of this card a runtime test cannot express
 * — "there is only one declaration of this contract, and it is the spec's" is a
 * statement about `tsc`.
 */
export function formContainerContractPins(): void {
  // ── PIN A — DERIVATION, section. Every key this layer does not deliberately
  // narrow is the spec's key with the spec's type. A hand-written copy that
  // agrees on the day it is written passes this line and then fails the first
  // time `FormSectionSchema` gains, drops or retypes a key — which is the drift
  // nothing could see before.
  const sectionIsDerived: Assert<
    Equal<Omit<FormSectionSpec, SectionNarrowed>, Omit<FormSection, SectionNarrowed>>
  > = true;
  void sectionIsDerived;

  // ── PIN B — DERIVATION, view. Same, and stricter: `sections`/`groups` are the
  // ONLY overridden positions, so `type`, `data`, `sharing`, `submitBehavior`,
  // `subforms`, `buttons` and every per-variant presentation key are the spec's.
  const viewIsDerived: Assert<
    Equal<Omit<FormViewSpec, ViewNarrowed>, Omit<FormView, ViewNarrowed>>
  > = true;
  void viewIsDerived;

  // ── PIN C — liveness control for A and B. `Equal` is a conditional-type trick
  // and a broken one would answer `true` for everything, which would make both
  // derivation pins phantom checks that no drift could ever fail. Pin the
  // negative answer too: the five-key shape `apps/console` removed in #5596 is
  // NOT this type, and `Equal` must still say so.
  type _removedConsoleCopy = {
    label?: string;
    collapsible?: boolean;
    collapsed?: boolean;
    columns?: 1 | 2 | 3 | 4 | '1' | '2' | '3' | '4';
    fields: Array<string | FormFieldSpec>;
  };
  const equalStillDiscriminates: Assert<
    Equal<Equal<_removedConsoleCopy, FormSectionSpec>, false>
  > = true;
  void equalStillDiscriminates;

  // ── PIN D — the narrowing that keeps #5542 shut. The element type of the
  // authored field array is the converged 26-key leaf, NOT the spec's own field
  // arm (which adds `publicPicker`, `span`, `keyField`). Deriving `fields` too
  // would silently re-open #5542 by swapping the element type out from under the
  // console's landed pin — and the spec's `FormField` type cannot even be named
  // here: `no-restricted-imports` bans it from `@objectstack/spec/ui`, because
  // that name is also the runtime field contract in `@object-ui/types`
  // (objectui#3090). So the arm is reached through `FormSection` instead.
  // `fields` is OPTIONAL since objectui#8725 (the spec-legal `{ group }` section
  // carries none), so the element type is read through `NonNullable`, exactly as
  // the spec arm below already is.
  type SectionFieldArm = Exclude<NonNullable<FormSectionSpec['fields']>[number], string>;
  const fieldsAreTheLeaf: Assert<Equal<SectionFieldArm, FormFieldSpec>> = true;
  void fieldsAreTheLeaf;

  type SpecSectionFieldArm = Exclude<NonNullable<FormSection['fields']>[number], string>;
  const leafIsNotTheSpecArm: Assert<Equal<Equal<FormFieldSpec, SpecSectionFieldArm>, false>> = true;
  void leafIsNotTheSpecArm;
  // ...and the spec arm is a REAL checked type, not `any` — otherwise the line
  // above would pass for the empty reason and PIN A's `Omit` would be hiding a
  // hole rather than naming a narrowing.
  const specArmStillChecks: SpecSectionFieldArm = {
    field: 'amount',
    // @ts-expect-error objectui#5596 — the spec's own field arm rejects unknown keys
    thisKeyIsNotPartOfTheAuthoringSurface: true,
  };
  void specArmStillChecks;

  // ── PIN E — the derived half really did widen. Each of these was a
  // `TS2353: … does not exist in type 'FormSectionSpec'` on ONE of the two
  // sides before #5596, while `FormSectionSchema` accepted all of them.
  const wasUndeclarableOnOneSide: FormSectionSpec = {
    name: 'advanced_options',
    label: 'Advanced',
    description: 'Rarely-used options',
    collapsible: true,
    collapsed: true,
    columns: '3',
    pane: 'secondary',
    visibleWhen: '${data.kind == "deal"}',
    fields: ['name', { field: 'amount', colSpan: 2 }],
  };
  void wasUndeclarableOnOneSide;

  const viewWasUndeclarableHere: FormViewSpec = {
    type: 'tabbed',
    title: 'Contact us',
    description: 'We reply within a day',
    sharing: { allowAnonymous: true },
    submitBehavior: { kind: 'redirect', url: '/thanks', delayMs: 500 },
    groups: [{ fields: ['name'] }],
    sections: [{ fields: ['email'] }],
  };
  void viewWasUndeclarableHere;

  // ── PIN F — negative control on the KEY. PIN E means "these keys are
  // declared", not "these positions stopped checking". Excess-property checking
  // is still live, so the derivation did not smuggle in an index signature or
  // `any` — the failure mode a widening is most likely to reach for.
  const undeclaredSectionKey: FormSectionSpec = {
    fields: [],
    // @ts-expect-error objectui#5596 — an undeclared key is still rejected
    thisKeyIsNotPartOfTheAuthoringSurface: true,
  };
  void undeclaredSectionKey;
  const undeclaredViewKey: FormViewSpec = {
    // @ts-expect-error objectui#5596 — an undeclared key is still rejected
    thisKeyIsNotPartOfTheAuthoringSurface: true,
  };
  void undeclaredViewKey;

  // ── PIN G — negative control on the NARROWINGS. "Derived" must not drift into
  // "whatever the spec says": each of the four narrowed positions still refuses
  // the arm this layer cannot consume. Every `@ts-expect-error` is a two-way pin
  // — the directive is itself an error (TS2578) once the line below it starts
  // compiling, so a LOOSENING turns this file red rather than passing quietly.
  const narrowedLabel: FormSectionSpec = {
    // @ts-expect-error narrowed to `string`: neither renderer resolves the
    // spec's `I18nLabel` inline locale-map arm, and `FormFieldSpec.label` is
    // already `string` (objectui#5542).
    label: { en: 'Advanced', 'zh-CN': 'gao ji' },
    fields: [],
  };
  void narrowedLabel;

  const narrowedDescription: FormSectionSpec = {
    // @ts-expect-error narrowed to `string`, same reason as `label`.
    description: { en: 'Rarely used' },
    fields: [],
  };
  void narrowedDescription;

  const narrowedPredicate: FormSectionSpec = {
    // @ts-expect-error narrowed to `VisibilityPredicate`: `source` is REQUIRED
    // here, because that is what `evalFieldPredicate` / this package's
    // `evaluatePredicate` read. The spec's `ExpressionInput` also admits an
    // `ast`-only envelope, which no evaluator in this repo consumes.
    visibleWhen: { dialect: 'cel' },
    fields: [],
  };
  void narrowedPredicate;

  // ── PIN J — the retired `visibleOn` spelling is REFUSED on both layers
  // (objectui#12696). `SchemaForm` reads `visibleWhen` only, so declaring the
  // old key would let an author write a predicate the designer ignores. The
  // spec's input `FormSection` still carries it, which is why it stays in the
  // section's `Omit` list: dropping it there re-admits the spec's own type and
  // turns the first directive below into TS2578.
  const retiredSectionKey: FormSectionSpec = {
    // @ts-expect-error objectui#12696 — write `visibleWhen`; `visibleOn` is retired
    visibleOn: "data.kind == 'deal'",
    fields: [],
  };
  void retiredSectionKey;

  const retiredFieldKey: FormFieldSpec = {
    field: 'amount',
    // @ts-expect-error objectui#12696 — write `visibleWhen`; `visibleOn` is retired
    visibleOn: "data.kind == 'deal'",
  };
  void retiredFieldKey;

  // ── PIN H — `label` is NOT a form-config key, measured. `FormViewSchema`
  // answers `unrecognized_keys` for it (the form config says `title`), so the
  // console's removed copy was describing view IDENTITY as form configuration.
  // That key now lives on `FormPage.tsx`'s own `FormViewBody`, next to the
  // envelope/overlay it actually arrives on.
  const viewHasNoLabel: FormViewSpec = {
    // @ts-expect-error objectui#5596 — a FormView is titled, not labelled
    label: 'Contact us',
  };
  void viewHasNoLabel;

  // ── PIN I — the OPTION-ELEMENT narrowings, objectui#6263. The leaf's option
  // element is `Omit<SelectOption, 'visibleWhen' | 'default'>` plus a re-pointed
  // predicate (form-spec.ts), and until now NOTHING failed if either name left
  // that `Omit` list: PIN G covers the section/view narrowings, the option
  // element had no negative pin at all. So the one narrowing a maintainer
  // actually ruled on rested on a comment.
  //
  // The ruling (2026-08-28, on objectstack#12868, executed upstream by
  // objectstack PR #13033): the FORM-VIEW option vocabulary does not accept a
  // per-option `default`. The pre-selected choice is declared on the OBJECT
  // definition — the field's `defaultValue`, or the object option's own
  // `default: true`, which the engine honours on the insert path
  // (objectstack#7246, PR #7388, ruled `enforce`). Re-admitting the key here
  // would give this surface a second default contract, which that same ruling
  // says it must not have.
  type OptionElement = NonNullable<FormFieldSpec['options']>[number];

  const optionRefusesDefault: OptionElement = {
    label: 'Open',
    value: 'open',
    // @ts-expect-error objectui#6263 — per-option `default` is not part of the
    // form-view option vocabulary. Declare the pre-selected choice on the
    // object definition instead.
    default: true,
  };
  void optionRefusesDefault;

  const optionNarrowsPredicate: OptionElement = {
    label: 'Open',
    value: 'open',
    // @ts-expect-error narrowed to `VisibilityPredicate`, exactly as PIN G's
    // section-level twin: `source` is REQUIRED here because that is what
    // `evalFieldPredicate` reads, while the spec's `ExpressionInput` also
    // admits a `dialect`-only / `ast`-only envelope no evaluator consumes.
    visibleWhen: { dialect: 'cel' },
  };
  void optionNarrowsPredicate;

  // Positive control for the two refusals above: this position still ACCEPTS
  // every key it does declare. Without it, a collapsed element type (`never`,
  // or an `Omit` that ate the whole shape) would satisfy both `@ts-expect-error`
  // lines and read as a narrowing that is really a hole.
  const optionAcceptsDeclaredKeys: OptionElement = {
    label: 'Open',
    value: 'open',
    color: '#3B82F6',
    visibleWhen: 'record.stage == "won"',
  };
  void optionAcceptsDeclaredKeys;

  // Control that PIN I measures a NARROWING and not an ABSENCE, and the reason
  // it is worth a line: `SelectOption` is shared by two surfaces and only this
  // one drops the key. If the spec ever retired `default` outright — which
  // would revert the ruled, implemented, pinned object-field behaviour — the
  // expect-error above would still fire, for a reason that is not this card's,
  // and PIN I would go on passing while the thing it guards was gone.
  const defaultIsStillASharedSpecOptionKey: Assert<
    'default' extends keyof SelectOption ? true : false
  > = true;
  void defaultIsStillASharedSpecOptionKey;
}

const schema = {
  type: 'object',
  properties: {
    a: { type: 'string', title: 'Field A' },
    b: { type: 'string', title: 'Field B' },
    c: { type: 'string', title: 'Field C' },
  },
};

function gridStyleFor(columns: FormSectionSpec['columns']): string | null {
  const form: FormViewSpec = {
    type: 'simple',
    sections: [{ label: 'Sec', columns, fields: [{ field: 'a' }, { field: 'b' }, { field: 'c' }] }],
  };
  const { container } = render(
    <SchemaForm schema={schema} form={form} value={{ a: '', b: '', c: '' }} onChange={() => {}} />,
  );
  const grid = container.querySelector('div.grid');
  return grid ? (grid as HTMLElement).getAttribute('style') : null;
}

describe('objectui#5596 — the converged containers render what the spec accepts', () => {
  it("lays out columns: '3' exactly as columns: 3 — the string arm was legal metadata this renderer refused", () => {
    const asString = gridStyleFor('3');
    cleanup();
    const asNumber = gridStyleFor(3);

    // Not just "equal to each other" — both must be the THREE-column grid, so
    // this cannot go green on two identically-wrong renders (e.g. if `columns`
    // stopped being read at all and both fell back to 1).
    expect(asNumber).toContain('repeat(3');
    expect(asString).toBe(asNumber);
  });

  it('renders a section carrying the keys only ONE side used to declare', () => {
    const form: FormViewSpec = {
      type: 'simple',
      sections: [
        {
          name: 'advanced_options',
          label: 'Advanced',
          description: 'Rarely-used options',
          pane: 'secondary',
          columns: 2,
          fields: [{ field: 'a' }],
        },
      ],
    };
    render(<SchemaForm schema={schema} form={form} value={{ a: '' }} onChange={() => {}} />);

    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('Field A')).toBeInTheDocument();
    // `name` and `pane` are authored-document keys with no reader in this repo
    // yet — declared because the document carries them, honoured by nobody.
    // Asserted inert so a future reader has to arrive deliberately.
    expect(screen.queryByText('advanced_options')).not.toBeInTheDocument();
    expect(screen.queryByText('secondary')).not.toBeInTheDocument();
  });
});
