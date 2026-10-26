// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8725 — a `{ group }` form section reaching `SchemaForm`.
 *
 * ## What this file pinned before, and why those pins were rewritten
 *
 * This file first landed as a MEASUREMENT (PR #8739): its runtime pins asserted
 * that a spec-legal `{ group }` section, arriving on the untyped `/meta/types`
 * server document, made `SchemaForm` throw `TypeError: s.fields is not
 * iterable` out of the component body — from the pre-flight `for…of` in
 * `SchemaFormBody`, upstream of both `.map` sites the card named — and took every
 * well-formed sibling section with it, on the simple and the tabbed arm alike.
 * Its compile-time pins asserted that `FormSectionSpec` refused the spec-legal
 * shape (a barrier on the TypeScript channel only) and that
 * `RichMetadataTypeEntry.form` admitted it untyped (the channel that did carry
 * it). Those pins were meant to go red when the ruling landed, and they did.
 *
 * ## The ruling they now pin (PM ruling on objectui#8725)
 *
 *  - `FormSectionSpec.fields` is OPTIONAL, matching `@objectstack/spec`.
 *  - Every read of a section's `fields` in `SchemaForm` sees a RESOLVED section:
 *    a `{ group }` section goes through `@object-ui/plugin-form`'s
 *    `resolveSectionGroupReferences`, the one resolver `ObjectForm` and
 *    `apps/console`'s `FormPage` already use, so this renderer gives THEIR answer
 *    — including for a group that names no declared field group.
 *  - ⛔ Not `?? []`. What the old crash pins protected survives the rewrite: a
 *    malformed section is a throw or a report, never a silent drop.
 *  - `RichMetadataTypeEntry.form` is `FormViewSpec`, not an untyped record.
 *
 * ## ⚠️ What "the resolver's answer" is HERE, measured rather than assumed
 *
 * A `group` resolves against the BOUND OBJECT's `fieldGroups`. `SchemaForm`
 * renders metadata-type editors (`data: { provider: 'schema', schemaId }`), the
 * `/meta/types` entry carries a `schema` and a `form` but no field groups, and
 * no host hands this component an object definition. So every `{ group }`
 * section here is one that "names no declared field group", and the resolver's
 * defined answer for that — measured, and identical in `FormPage` for the same
 * section over an object that does not declare the group — is an EMPTY section
 * plus a `console.error` naming the group. The pins below assert exactly that,
 * by calling the resolver with `SchemaForm`'s own inputs rather than by
 * restating its output, so a change to the resolver moves this file with it.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { resolveSectionGroupReferences, sectionEntryName } from '@object-ui/plugin-form';
import { SchemaForm } from './SchemaForm';
import type { FormSectionSpec, FormViewSpec } from './form-spec';
import type { RichMetadataTypeEntry } from './useMetadata';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;

/**
 * Compile-time half. Erased at runtime, so vitest proves nothing about these;
 * `tsc -p packages/app-shell/tsconfig.test.json` (chained from this package's
 * `type-check` script) is what judges them.
 */
export function groupSectionTypePins(): void {
  // ── PIN T1 — the spec-legal `{ group }` section COMPILES as a
  // `FormSectionSpec`. Before objectui#8725 this line was a `@ts-expect-error`:
  // `fields` was re-declared REQUIRED inside a type whose own header says it
  // "describes what an AUTHOR WROTE, so it stays as wide as the document".
  const specLegalGroupSection: FormSectionSpec = { group: 'contact_info' };
  void specLegalGroupSection;
  const fieldsIsOptional: Assert<undefined extends FormSectionSpec['fields'] ? true : false> = true;
  void fieldsIsOptional;

  // Negative control for PIN T1: this program really judges this file, and
  // `group` is a typed key rather than an index signature that admits anything.
  // @ts-expect-error objectui#8725 — `group` is a field-group KEY (a string).
  const groupIsTyped: FormSectionSpec = { group: 42 };
  void groupIsTyped;

  // ── PIN T2 — arm C. The registry entry's `form` is the authoring type, not
  // `Record<string, unknown>` handed on with `as any`. The type now describes the
  // channel that actually carries a form to this renderer.
  const registryFormIsTheViewSpec: Assert<
    Equal<NonNullable<RichMetadataTypeEntry['form']>, FormViewSpec>
  > = true;
  void registryFormIsTheViewSpec;
  // The crash document of the original measurement is a legal value of it...
  const serverFormWithGroupSection: NonNullable<RichMetadataTypeEntry['form']> = {
    type: 'simple',
    sections: [{ group: 'contact_info' }],
  };
  void serverFormWithGroupSection;
  // ...and a key the form contract does not declare is not. Under the old
  // `Record<string, unknown>` this directive was unused (TS2578).
  const refusesAnUndeclaredKey: NonNullable<RichMetadataTypeEntry['form']> = {
    type: 'simple',
    // @ts-expect-error objectui#8725 — not a `FormViewSpec` key.
    notAFormViewKey: true,
  };
  void refusesAnUndeclaredKey;
}

const schema = {
  type: 'object',
  properties: {
    a: { type: 'string', title: 'Field A' },
    b: { type: 'string', title: 'Field B' },
    c: { type: 'string', title: 'Field C' },
  },
};

/** The metadata type the form edits — what the resolver's diagnostic names. */
const SCHEMA_ID = 'demo_type_8725';

/**
 * A form document spelled the way it ARRIVES from `/meta/types`: plain data
 * carrying the `data` binding `defineForm` writes onto every metadata form.
 */
function serverForm(sections: unknown[], type = 'simple'): FormViewSpec {
  return { type, data: { provider: 'schema', schemaId: SCHEMA_ID }, sections } as unknown as FormViewSpec;
}

function renderForm(form: FormViewSpec): { error: Error | undefined; ids: string[] } {
  let error: Error | undefined;
  let ids: string[] = [];
  try {
    const { container } = render(
      <SchemaForm schema={schema} form={form} value={{}} onChange={() => {}} />,
    );
    ids = Array.from(container.querySelectorAll('input[id^="mdf-"]')).map((el) => el.id);
  } catch (err) {
    error = err as Error;
  }
  return { error, ids };
}

/**
 * The field names the shared resolver assigns to each section, given exactly
 * the inputs `SchemaForm` hands it — the answer `FormPage` gives for the same
 * section over an object that does not declare the group.
 *
 * Each entry is named by its OWN arm through `sectionEntryName`, the form
 * package's one spelling of the identity rule (objectui#11615): a bare string
 * is the name, the form view's `{ field }` entry names its field by `field`,
 * and an inline `FormField` by `name`. Reading `.name` off every object entry
 * typed only while the section type claimed every object entry was an inline
 * `FormField`; on a `{ field }` entry it read `undefined`.
 */
function resolverFieldNames(form: FormViewSpec): Array<Array<string | undefined>> {
  const resolved = resolveSectionGroupReferences(
    form.sections as unknown as Parameters<typeof resolveSectionGroupReferences>[0],
    { objectName: SCHEMA_ID, formType: form.type, objectDef: null, resolvable: false },
  ) ?? [];
  return resolved.map((s) => (s.fields ?? []).map(sectionEntryName));
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#8725 — a `{ group }` section in SchemaForm resolves through the shared resolver', () => {
  // ── CONTROL, and the non-regression leg. A section that enumerates `fields`
  // renders them exactly as before. Without it, a renderer that drew nothing at
  // all would satisfy every group leg below.
  it('CONTROL: a section that enumerates `fields` still renders them', () => {
    const form: FormViewSpec = {
      type: 'simple',
      sections: [{ label: 'Basics', fields: [{ field: 'a' }] }],
    };
    render(<SchemaForm schema={schema} form={form} value={{}} onChange={() => {}} />);
    expect(screen.getByText('Field A')).toBeInTheDocument();
    expect(screen.getByText('Basics')).toBeInTheDocument();
  });

  // ── The first read no longer throws, and a well-formed sibling survives. This
  // is the old "the render throws" and "a sibling is destroyed with it" pair,
  // inverted: the field rows on screen are the resolver's, in its order.
  it('renders the resolver\'s fields, in its order, with the well-formed siblings intact', () => {
    const form = serverForm([
      { label: 'Basics', fields: ['a'] },
      { group: 'contact_info_8725_order' },
      { label: 'More', fields: ['c', 'b'] },
    ]);
    const { error, ids } = renderForm(form);

    expect(error).toBeUndefined();
    expect(ids).toEqual(resolverFieldNames(form).flat().map((n) => `mdf-${n}`));
    // Stated literally as well, so the leg above cannot pass by both sides
    // agreeing on nothing.
    expect(ids).toEqual(['mdf-a', 'mdf-c', 'mdf-b']);
  });

  // ── The resolver's defined answer for a group that names no declared field
  // group: the section is EMPTY and the dangling key is REPORTED. The report is
  // what separates this from the fenced `?? []`, which renders the same empty
  // section and says nothing.
  it('a group naming no declared field group renders empty AND is reported, as the resolver defines', () => {
    const form = serverForm([
      { label: 'Basics', fields: ['a'] },
      { group: 'no_such_group_8725' },
    ]);
    const { error, ids } = renderForm(form);
    // Read the diagnostics BEFORE this test calls the resolver itself: that call
    // reports too, and read afterwards it would satisfy the assertions below on
    // its own — measured, by an ablation that silenced SchemaForm's report and
    // left this leg green until the read was moved here.
    const said = consoleError.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');

    expect(error).toBeUndefined();
    expect(resolverFieldNames(form)[1]).toEqual([]);
    expect(ids).toEqual(['mdf-a']);

    expect(said).toContain('no_such_group_8725');
    expect(said).toContain(SCHEMA_ID);
    expect(said).toContain('fieldGroups');
  });

  // ── The tabbed arm, which the measurement showed died at the same upstream
  // read. Recorded so the fix is not scoped to one arm.
  it('the tabbed arm resolves the same way and keeps its other tabs', () => {
    const form = serverForm(
      [
        { label: 'Basics', fields: ['a'] },
        { group: 'contact_info_8725_tabbed' },
        { label: 'More', fields: ['b'] },
      ],
      'tabbed',
    );
    const { error } = renderForm(form);

    expect(error).toBeUndefined();
    expect(screen.getByRole('tab', { name: 'Basics' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'More' })).toBeInTheDocument();
    // The resolved group section has no rows, so it earns no tab.
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });
});

describe('objectui#8725 — a section with NO member source is still refused out loud', () => {
  // ── The rewritten crash pin. `FormSectionSchema` refuses a section carrying
  // neither `fields` nor `group` ("A section must declare its members exactly
  // one way"), and the resolver leaves it untouched because it is not a group
  // reference. It stays a THROW out of the render — not an empty section — and
  // the throw names the section it refuses.
  it('neither `fields` nor `group`: the render throws a TypeError naming the section', () => {
    const { error } = renderForm(
      serverForm([
        { label: 'Basics', fields: ['a'] },
        { label: 'Contact' },
      ]),
    );

    expect(error).toBeInstanceOf(TypeError);
    expect(error?.message).toContain('"Contact"');
    expect(error?.message).toContain('`fields`');
    expect(error?.message).toContain('`group`');
  });

  it('the tabbed arm refuses the same section the same way', () => {
    const { error } = renderForm(
      serverForm(
        [
          { label: 'Basics', fields: ['a'] },
          { label: 'Contact' },
        ],
        'tabbed',
      ),
    );

    expect(error).toBeInstanceOf(TypeError);
    expect(error?.message).toContain('"Contact"');
  });
});
