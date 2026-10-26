// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ONE description of the form-field authoring contract — objectui#5542.
 *
 * ## The class this pins shut
 *
 * objectui#5040 was not a missing key. It was that **two descriptions of one
 * contract drifted**, and nothing could notice, because each was only ever
 * checked against itself. PR #5537 converged the two app-shell descriptions
 * into `packages/app-shell/src/views/metadata-admin/form-spec.ts`. A **third**
 * survived in this app: `FormPage.tsx` declared its own nine-key
 * `interface FormFieldSpec`, under the same name, in a different package.
 *
 * The measurement that chose the route: the console's copy was a strict subset
 * — 9 of the shared type's 26 keys, every one of them identical, none of them
 * console-only — sitting in a position that describes an **authored document**
 * (`FormSectionSpec.fields`, read straight off `/meta/view/:name`), not a
 * narrower thing this app authors. The narrow, renderer-honoured shape is a
 * separate type that already exists here, `RenderableField`. So the two names
 * were one contract, and the console's copy simply described it wrongly: legal
 * metadata (`visibleWhen`, `dependsOn`, `type`, `options`, `immutable`, the
 * recursive `fields`, …) was undeclared, which is #5040's own symptom — "the
 * type rejects the configuration the runtime accepts".
 *
 * ## What is pinned, and by which tool
 *
 * Two halves that fail in different places, on purpose:
 *
 *   • **`tsc`** — {@link formFieldSpecContractPins}. Type assertions are erased
 *     at runtime, so vitest proves nothing about them; the app's `type-check`
 *     script (`tsc --noEmit`, whose `include` is `["src", "dev"]` and therefore
 *     compiles this file) is what judges them. PIN A is the one that closes the
 *     class: it reads the field-spec type back out of the **exported**
 *     `buildSections` signature, so a re-inlined local copy fails here even if
 *     it agrees on every key on the day it is written. PIN B is its liveness
 *     control — it asserts that `Equal` still returns `false` for a type that
 *     really differs, so PIN A can never pass vacuously.
 *   • **vitest** — the `buildSections` block. It proves the widening is inert
 *     at runtime: a field spec carrying the previously-undeclarable keys builds
 *     the same rows. Whether each key is HONOURED is recorded rather than
 *     assumed — and that is not bookkeeping: `maxLength` was pinned here as
 *     NOT honoured, which is how objectui#5595 found that the merge dropped
 *     the override while the docstring promised it won. That assertion now
 *     names the honoured answer instead.
 */

import { describe, expect, it } from 'vitest';
import type { FormFieldSpec } from '@object-ui/app-shell';
import { buildSections } from './FormPage';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

/**
 * The console's own view of the field-spec type, read back out of the public
 * surface rather than re-stated. `buildSections` is exported and takes the
 * FormView it renders, so this walks spec → sections → fields → the non-string
 * arm. Deriving it this way is the point: nothing in this file names the type
 * the way `FormPage.tsx` names it, so the pin follows whatever that file
 * actually uses in that position.
 */
type ConsoleFormViewSpec = Parameters<typeof buildSections>[0];
type ConsoleSectionSpec = NonNullable<ConsoleFormViewSpec['sections']>[number];
// `fields` is OPTIONAL on the section since objectui#8725 (a `{ group }` section
// carries none), so the element type is read through `NonNullable`.
type ConsoleFieldSpec = Exclude<NonNullable<ConsoleSectionSpec['fields']>[number], string>;

/**
 * These never run. They are the half of this card a runtime test cannot express
 * — "there is only one declaration of this contract" is a statement about `tsc`.
 */
export function formFieldSpecContractPins(): void {
  // ── PIN A — the class. The element type of the console's authored-field array
  // IS the app-shell declaration, not a structural twin of it. Re-inlining a
  // local `interface FormFieldSpec` here turns this line red on the day it is
  // written, which is exactly what did NOT happen to the copy #5542 removed.
  //
  // Spelled as a `const` rather than a bare `type` alias because this app sets
  // `noUnusedLocals`, which reports an unreferenced alias (TS6196) — a pin that
  // has to be deleted to compile is no pin. The assertion is unchanged: the
  // annotation is `Assert<…>`, so a false `Equal` fails the `extends true`
  // constraint (TS2344) here, and the initializer is erased at runtime.
  const oneContract: Assert<Equal<ConsoleFieldSpec, FormFieldSpec>> = true;
  void oneContract;

  // ── PIN B — liveness control for PIN A. `Equal` is a conditional-type trick
  // and a broken one would answer `true` for everything, which would make PIN A
  // a phantom check that no drift could ever fail. Pin the negative answer too:
  // the nine-key shape this file removed is NOT the shared type, and `Equal`
  // must still say so.
  type _removedCopy = {
    field: string;
    label?: string;
    placeholder?: string;
    helpText?: string;
    required?: boolean;
    readonly?: boolean;
    hidden?: boolean;
    colSpan?: 1 | 2 | 3 | 4;
    widget?: string;
  };
  const equalStillDiscriminates: Assert<Equal<Equal<_removedCopy, FormFieldSpec>, false>> = true;
  void equalStillDiscriminates;

  // ── PIN C — the measurement, made executable. Every key below was
  // `TS2353: … does not exist in type 'FormFieldSpec'` in this app before
  // #5542, while the runtime accepted it and metadata-admin authored it. They
  // are the difference the key-by-key comparison found. (`visibleOn` was one of
  // them until objectui#12696 dropped that retired spelling from the type.)
  const wasUndeclarableHere: ConsoleFieldSpec = {
    field: 'stage',
    type: 'select',
    options: [{ label: 'New', value: 'new' }],
    reference: 'showcase_stage',
    dependsOn: 'objectName',
    immutable: true,
    multiple: false,
    minLength: 1,
    maxLength: 40,
    min: 0,
    max: 10,
    precision: 2,
    scale: 1,
    disclosure: 'popover',
    language: 'sql',
    visibleWhen: '${data.kind == "deal"}',
    fields: ['nested', { field: 'deeper' }],
  };
  void wasUndeclarableHere;

  // ── PIN D — negative control on the KEY. PIN C means "these keys are
  // declared", not "this position stopped checking". Excess-property checking
  // is still live, so the import did not smuggle in an index signature or
  // `any` — the failure mode a widening is most likely to reach for.
  const undeclaredKey: ConsoleFieldSpec = {
    field: 'stage',
    // @ts-expect-error objectui#5542 — an undeclared key is still rejected
    thisKeyIsNotPartOfTheAuthoringSurface: true,
  };
  void undeclaredKey;

  // ── PIN E — the renderer's honoured shape is a DIFFERENT type, and stays
  // that way. Collapsing the two is how the removed copy came to describe an
  // authored document with the nine keys this file happens to read.
  type ConsoleRenderableField = ReturnType<typeof buildSections>[number]['fields'][number];
  const notTheSameThing: Assert<Equal<Equal<ConsoleRenderableField, FormFieldSpec>, false>> = true;
  void notTheSameThing;
}

describe('objectui#5542 — the console renders the shared field spec', () => {
  it('builds the same rows from a spec carrying the previously-undeclarable keys', () => {
    // Typed through `buildSections`' own parameter, so this literal is checked
    // against whatever `FormPage.tsx` declares in that position.
    const sections = buildSections(
      {
        sections: [
          {
            label: 'Details',
            columns: 2,
            fields: [
              {
                field: 'stage',
                label: 'Stage',
                colSpan: 2,
                required: true,
                // Legal metadata the console could not declare before #5542.
                type: 'select',
                options: [{ label: 'New', value: 'new' }],
                dependsOn: 'objectName',
                visibleWhen: '${data.kind == "deal"}',
                immutable: true,
                maxLength: 40,
              },
            ],
          },
        ],
      },
      null,
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].columns).toBe(2);
    expect(sections[0].fields).toHaveLength(1);

    const row = sections[0].fields[0];
    expect(row.name).toBe('stage');
    expect(row.label).toBe('Stage');
    expect(row.colSpan).toBe(2);
    expect(row.required).toBe(true);

    // objectui#5595's pre-registered evidence — INVERTED here, not deleted.
    //
    // When #5542 landed this read `toBeUndefined()`, recording rather than
    // assuming that `buildSections` took `maxLength` from the OBJECT schema
    // alone and discarded the field override. Recording it is what made the
    // gap findable: #5595 ruled it a declared≠enforced defect, because the
    // function's own docstring promises overrides win and every sibling key
    // implements that. So the same assertion now names the honoured answer.
    //
    // `objectSchema` is `null` in this call, so there is no object ceiling to
    // inherit — the 40 can ONLY have come from the field override above.
    expect(row.maxLength).toBe(40);
  });

  it('still accepts the bare string arm, which is most of what authors write', () => {
    const sections = buildSections({ sections: [{ fields: ['name', 'amount'] }] }, null);
    expect(sections[0].fields.map((f) => f.name)).toEqual(['name', 'amount']);
  });
});
