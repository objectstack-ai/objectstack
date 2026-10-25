// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ONE description of the form CONTAINER contracts, in this app — objectui#5596.
 *
 * ## The class this pins shut
 *
 * `FormPage.fieldSpec.test.ts` next door pins the LEAF: the element type of this
 * app's authored-field array is `@object-ui/app-shell`'s `FormFieldSpec`, not a
 * local twin of it (objectui#5542). The two containers ABOVE that leaf were
 * still hand-declared here — `FormViewSpec` and `FormSectionSpec`, the same
 * names app-shell declares — and unlike the leaf they had already drifted in
 * both directions, so neither copy was a subset of the other:
 *
 *   FormSectionSpec  app-shell declared `description` / `visibleWhen` /
 *                    `visibleOn`; this file declared none of them. This file's
 *                    `columns` admitted the string arm; app-shell's did not.
 *   FormViewSpec     this file declared `label` / `groups` / `sharing` /
 *                    `submitBehavior`; app-shell stopped at `type` + `sections`.
 *
 * Both are now the shared declaration, and the shared declaration is derived
 * from `@objectstack/spec` rather than restated — so the question "what may an
 * author write in a form section?" has one answer, and that answer is the
 * contract's.
 *
 * ## What is pinned, and by which tool
 *
 *   • **`tsc`** — {@link formContainerContractPins}. Type assertions are erased
 *     at runtime, so vitest proves nothing about them; the app's `type-check`
 *     script (`tsc --noEmit`, whose `include` is `["src", "dev"]` and therefore
 *     compiles this file) is what judges them. PIN A and PIN B are the ones that
 *     close the class: they read both container types back out of the
 *     **exported** `buildSections` signature, so a re-inlined local copy fails
 *     here even if it agrees on every key on the day it is written. PIN C is
 *     their liveness control.
 *   • **vitest** — the `buildSections` block. It proves the widening is inert at
 *     runtime: a section carrying the keys this app could not previously declare
 *     builds the same rows, and the string `columns` arm — which this app's type
 *     always admitted and app-shell's always refused — still normalises to the
 *     same number.
 *
 * `RenderableSection`, what `buildSections` EMITS, is deliberately still a
 * different and narrower type: see PIN F. Keeping the incoming-document type
 * wide and the honoured-row type narrow is objectui#5542's distinction, and
 * declaring a key here is not honouring it — objectui#5627 tracks the section
 * predicates this convergence makes declarable but does not evaluate.
 */

import { describe, expect, it } from 'vitest';
import type { FormSectionSpec, FormViewSpec } from '@object-ui/app-shell';
import { buildSections, resolveInternalForm } from './FormPage';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

/**
 * This app's own view of the container types, read back out of the public
 * surface rather than re-stated. `buildSections` is exported and takes the
 * FormView it renders, so this walks spec -> sections -> the element type.
 * Deriving them this way is the point: nothing in this file names either type
 * the way `FormPage.tsx` names it, so the pins follow whatever that file
 * actually uses in those positions.
 */
type ConsoleFormViewSpec = Parameters<typeof buildSections>[0];
type ConsoleSectionSpec = NonNullable<ConsoleFormViewSpec['sections']>[number];

/**
 * These never run. They are the half of this card a runtime test cannot express
 * — "there is only one declaration of this contract" is a statement about `tsc`.
 */
export function formContainerContractPins(): void {
  // ── PIN A — the class, view level. The type this app hands its own renderer
  // IS the app-shell declaration. Re-inlining a local `interface FormViewSpec`
  // here turns this line red on the day it is written, which is exactly what did
  // NOT happen to the copy #5596 removed.
  const viewIsOneContract: Assert<Equal<ConsoleFormViewSpec, FormViewSpec>> = true;
  void viewIsOneContract;

  // ── PIN B — the class, section level.
  const sectionIsOneContract: Assert<Equal<ConsoleSectionSpec, FormSectionSpec>> = true;
  void sectionIsOneContract;

  // ── PIN C — liveness control for A and B. `Equal` is a conditional-type trick
  // and a broken one would answer `true` for everything, which would make both
  // pins phantom checks that no drift could ever fail. Pin the negative answer
  // too: the five-key shape this file removed is NOT the shared type.
  type _removedCopy = {
    label?: string;
    collapsible?: boolean;
    collapsed?: boolean;
    columns?: 1 | 2 | 3 | 4 | '1' | '2' | '3' | '4';
    fields: ConsoleSectionSpec['fields'];
  };
  const equalStillDiscriminates: Assert<Equal<Equal<_removedCopy, FormSectionSpec>, false>> = true;
  void equalStillDiscriminates;

  // ── PIN D — the measurement, made executable. Every key below was
  // `TS2353: … does not exist in type 'FormSectionSpec'` in this app before
  // #5596, while `@objectstack/spec`'s `FormSectionSchema` accepted all of them
  // and app-shell's copy declared three of them. (`visibleOn` was one of them
  // until objectui#12696 dropped that retired spelling from the type.)
  const wasUndeclarableHere: ConsoleSectionSpec = {
    name: 'advanced_options',
    description: 'Rarely-used options',
    pane: 'secondary',
    visibleWhen: '${record.kind == "deal"}',
    columns: '3',
    fields: ['name'],
  };
  void wasUndeclarableHere;

  // Same for the view: `title`, `description`, `data`, `subforms` and the
  // per-variant presentation keys were all undeclarable here.
  const viewWasUndeclarableHere: ConsoleFormViewSpec = {
    type: 'wizard',
    title: 'Contact us',
    description: 'We reply within a day',
    allowSkip: true,
    showStepIndicator: true,
    data: { provider: 'schema', schemaId: 'contact' },
    sections: [{ fields: ['name'] }],
  };
  void viewWasUndeclarableHere;

  // ── PIN E — negative control on the KEY. PIN D means "these keys are
  // declared", not "these positions stopped checking". Excess-property checking
  // is still live, so the shared type did not smuggle in an index signature or
  // `any` — the failure mode a widening is most likely to reach for.
  const undeclaredKey: ConsoleSectionSpec = {
    fields: [],
    // @ts-expect-error objectui#5596 — an undeclared key is still rejected
    thisKeyIsNotPartOfTheAuthoringSurface: true,
  };
  void undeclaredKey;

  // ── PIN F — the renderer's honoured shape is a DIFFERENT type, and stays that
  // way. Collapsing the two is how the removed copy came to describe an authored
  // document with only the four keys this file happens to read.
  type ConsoleRenderableSection = ReturnType<typeof buildSections>[number];
  const notTheSameThing: Assert<Equal<Equal<ConsoleRenderableSection, FormSectionSpec>, false>> = true;
  void notTheSameThing;

  // ── PIN G — `label` did not follow the form contract. It was on this file's
  // removed `FormViewSpec`, and `@objectstack/spec`'s `FormViewSchema` REJECTS
  // it (`unrecognized_keys` — a form config is titled, not labelled). It is view
  // IDENTITY: it arrives on the `ExpandedViewItem` envelope, or beside the
  // config on a flattened runtime overlay. So it lives on `FormPage.tsx`'s own
  // `FormViewBody`, which is what `resolveInternalForm` returns — NOT on the
  // contract shared with `packages/app-shell`.
  type ResolvedBody = ReturnType<typeof resolveInternalForm>['form'];
  const bodyCarriesIdentityLabel: Assert<Equal<ResolvedBody['label'], string | undefined>> = true;
  void bodyCarriesIdentityLabel;
  const formContractDoesNot: Assert<Equal<'label' extends keyof FormViewSpec ? true : false, false>> = true;
  void formContractDoesNot;
}

describe('objectui#5596 — the console renders the shared container specs', () => {
  it('builds the same rows from a section carrying the previously-undeclarable keys', () => {
    // Typed through `buildSections`' own parameter, so this literal is checked
    // against whatever `FormPage.tsx` declares in that position.
    const sections = buildSections(
      {
        type: 'simple',
        sections: [
          {
            name: 'details',
            label: 'Details',
            description: 'The bits that matter',
            pane: 'primary',
            columns: 2,
            visibleWhen: '${record.kind == "deal"}',
            fields: [{ field: 'stage', label: 'Stage', colSpan: 2 }],
          },
        ],
      },
      null,
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe('Details');
    expect(sections[0].columns).toBe(2);
    expect(sections[0].fields.map((f) => f.name)).toEqual(['stage']);
  });

  it("normalises the string columns arm, which app-shell's copy used to refuse", () => {
    const asString = buildSections({ sections: [{ columns: '3', fields: ['a'] }] }, null);
    const asNumber = buildSections({ sections: [{ columns: 3, fields: ['a'] }] }, null);
    // Not just "equal to each other" — pin the THREE, so this cannot go green on
    // two identically-wrong answers (e.g. both falling back to the default 2).
    expect(asNumber[0].columns).toBe(3);
    expect(asString[0].columns).toBe(3);
  });

  it('reads the view label off the body, not off the form config', () => {
    // Envelope branch: identity sits beside `config` (objectui#2208).
    const envelope = resolveInternalForm('contact_form', {
      name: 'contact_form',
      object: 'contact',
      viewKind: 'form',
      label: 'Contact us',
      config: { type: 'simple', sections: [{ fields: ['name'] }] },
    });
    expect(envelope.label).toBe('Contact us');
    expect(envelope.object).toBe('contact');

    // Flattened-overlay branch: no envelope at all, so the identity keys and the
    // form config share one object — the shape `@objectstack/spec` publishes as
    // `VIEW_METADATA_MEMBERS.formOverlay`. This is the branch the removed
    // `FormViewSpec.label` key was really describing.
    const flattened = resolveInternalForm('contact_form', {
      type: 'simple',
      label: 'Contact us',
      data: { provider: 'object', object: 'contact' },
      sections: [{ fields: ['name'] }],
    });
    expect(flattened.label).toBe('Contact us');
    expect(flattened.object).toBe('contact');
  });
});
