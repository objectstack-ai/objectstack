/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `initialValues` + `initialData` merge PER MEMBER, at BOTH of the two read
 * shapes the presentation arms spell (objectui#9760).
 *
 * Maintainer ruling on objectui#9760 (batch #166 item 3, letter 甲): one helper,
 * `resolveInitialRecord(schema)`, replaces the whole-object
 * `schema.initialData || schema.initialValues` at every site, so `initialData`
 * wins member by member and `initialValues` supplies every member it says
 * nothing about — which is what the registration's "alternate spelling …
 * read FIRST" says once read as the precedence claim it is.
 *
 * ## Why this file exists beside the two flipped `8071` pins
 *
 * Those pins drive `ObjectForm` and `object-master-detail-form`, and both of
 * them reach the helper through the SAME read shape: `setInitialData(…)`, with
 * the authored record installed as form state directly. The ruling was explicit
 * that the OTHER shape had not been verified to behave identically and that the
 * two are to be measured and pinned separately, so this file owns the other
 * one and the difference between them.
 *
 * ## The two shapes, and where each one layers the declared defaults
 *
 *   A. **The create branch of the sectioned/overlay arms** — Modal, Drawer,
 *      Tabbed, Split and the wizard — spells
 *      `seedCreateValues(objectSchema, resolveInitialRecord(schema), ctx)`.
 *      `seedCreateValues` puts the object schema's declared static
 *      `defaultValue`s UNDERNEATH the authored record AT SEED TIME (#4047), so
 *      the defaults are part of the form DATA this arm holds.
 *
 *   B. **The direct-install sites** — `ObjectForm`'s two — spell
 *      `setInitialData(resolveInitialRecord(schema))` with nothing underneath
 *      AT THAT SITE. `ObjectForm` layers the same defaults one composition
 *      later, at render, as `{ ...schemaDefaults, ...initialData }`, where
 *      `schemaDefaults` is `schemaDefaultValues(objectSchema, …)` in create mode.
 *
 * ⚠️ ⛔ It is therefore NOT true that "A layers the object's defaults and B does
 * not", and this file said so before objectui#9778 landed. It read that way only
 * because the inline-`customFields` path used to install a members-only
 * `{ name, fields: {} }` schema and never fetch the object's, so `schemaDefaults`
 * was empty by construction — an artefact of the probe, not a property of the
 * shape. objectui#9778 made that path MERGE over the generated set instead of
 * replacing it, the real metadata is fetched, and the defaults duly appear.
 * Recorded here rather than quietly corrected, because the mistaken reading is
 * the one a reader would re-derive from the two call sites alone.
 *
 * ⇒ What IS measured: both shapes layer the OBJECT's declared defaults under the
 * authored record, at different sites; NEITHER layers an inline member's own
 * `defaultValue`, because `schemaDefaultValues` reads `objectSchema.fields` and
 * nothing else. Row 3 pins the seed-time layer, row 7 pins the render-time one
 * AND the inline member's default going nowhere, in the same call. A future edit
 * that "unifies" the arms by dropping `seedCreateValues` — the tidy-looking move
 * now that both sides call one helper — turns row 3 red instead of silently
 * un-fixing objectui#4047.
 *
 * ## The inputs the two implementations disagree about
 *
 * Every behavioural row is driven on one of the two, because no other input
 * separates `{ ...initialValues, ...initialData }` from
 * `initialData || initialValues`:
 *
 *   - an **EMPTY** `initialData` beside a populated `initialValues` (the `||`
 *     tested the OBJECT's truthiness and `{}` is truthy, so the empty object a
 *     `?? {}` producer hands over blanked the form completely); and
 *   - a **PARTIAL** `initialData` naming one member of several (the `||` chose
 *     whole objects, so every member it said nothing about was dropped).
 *
 * A row driven on a FULL `initialData`, or on either key alone, passes
 * identically before and after the repair and would pin nothing.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { resolveInitialRecord } from '../initialRecord';
import { ObjectForm } from '../ObjectForm';
import { ModalForm } from '../ModalForm';
import { DrawerForm } from '../DrawerForm';
import { TabbedForm } from '../TabbedForm';
import { SplitForm } from '../SplitForm';
import { WizardForm } from '../WizardForm';

registerAllFields();

/**
 * `code` carries a declared static default and NEITHER authored key ever names
 * it — it is the probe for the defaults layer that separates shape A from B.
 */
const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    customer: { type: 'text', label: 'Customer' },
    note: { type: 'text', label: 'Note' },
    code: { type: 'text', label: 'Code', defaultValue: 'INV-DEFAULT' },
  },
};

const FIELD_NAMES = ['customer', 'note', 'code'] as const;
const SECTIONS = [{ name: 'basics', label: 'Basics', fields: [...FIELD_NAMES] }];

const makeDataSource = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    findOne: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'r1' }),
    update: vi.fn().mockResolvedValue({ id: 'r1' }),
  }) as any;

const readControl = (root: ParentNode, name: string) =>
  (root.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value ?? null;

/** Every probed control's opening value, keyed by field name. */
const openingValuesIn = (root: ParentNode) =>
  Object.fromEntries(FIELD_NAMES.map((name) => [name, readControl(root, name)]));

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

// ── shape A: the create branch, `seedCreateValues(…, resolveInitialRecord(schema), …)`
//
// Driven through every arm that spells it, as one table: they share the branch,
// and an arm that quietly stopped sharing it is exactly what a per-arm file
// would stop noticing.

const SEEDING_ARMS: Array<[string, React.ComponentType<any>, string]> = [
  ['ModalForm', ModalForm as any, 'modal'],
  ['DrawerForm', DrawerForm as any, 'drawer'],
  ['TabbedForm', TabbedForm as any, 'tabbed'],
  ['SplitForm', SplitForm as any, 'split'],
  ['WizardForm', WizardForm as any, 'wizard'],
];

describe.each(SEEDING_ARMS)(
  '%s — the create branch merges per member ON TOP of the declared defaults',
  (_name, Container, formType) => {
    const openCreate = async (extra: Record<string, unknown>) => {
      const { container } = render(
        <Container
          schema={
            {
              type: 'object-form',
              formType,
              objectName: 'invoice',
              mode: 'create',
              open: true,
              sections: SECTIONS,
              ...extra,
            } as any
          }
          dataSource={makeDataSource()}
        />,
      );
      // Overlay arms portal their body out of `container`, so the probe is the
      // document — which also keeps the read identical across all five arms.
      await waitFor(() => {
        if (!document.body.querySelector('input[name="customer"]')) throw new Error('form not ready');
      });
      return openingValuesIn(document.body);
    };

    it('1. an EMPTY `initialData` contributes NOTHING and leaves `initialValues` standing', async () => {
      expect(
        await openCreate({
          initialData: {},
          initialValues: { customer: 'Alpha', note: 'from initialValues' },
        }),
        'the whole-object `||` blanked this form: `{}` is truthy, so it won and carried no members',
      ).toEqual({ customer: 'Alpha', note: 'from initialValues', code: 'INV-DEFAULT' });
    });

    it('2. a PARTIAL `initialData` overrides only the members it names', async () => {
      expect(
        await openCreate({
          initialData: { customer: 'Beta' },
          initialValues: { customer: 'Alpha', note: 'from initialValues' },
        }),
        '`note` is the member `initialData` says nothing about; the whole-object choice dropped it',
      ).toEqual({ customer: 'Beta', note: 'from initialValues', code: 'INV-DEFAULT' });
    });

    it('3. ⭐ the DEFAULTS LAYER is still underneath, and an authored member still outranks it', async () => {
      // The row that separates this shape from the direct-install one. `code`
      // is seeded from the object schema although NEITHER key names it, while
      // an authored member wins over a declared default as it always has.
      expect(
        await openCreate({ initialValues: { code: 'FROM-AUTHOR' }, initialData: { customer: 'Beta' } }),
        'dropping `seedCreateValues` now that both shapes call one helper would un-fix objectui#4047',
      ).toEqual({ customer: 'Beta', note: '', code: 'FROM-AUTHOR' });
    });

    it('4. control: with neither key authored the same controls open on the DEFAULTS alone', async () => {
      expect(await openCreate({})).toEqual({ customer: '', note: '', code: 'INV-DEFAULT' });
    });
  },
);

// ── shape B: the direct install, `setInitialData(resolveInitialRecord(schema))`
//
// Reached through `ObjectForm`'s inline-`customFields` effect. Since
// objectui#9778 that path MERGES the authored members over the set generated
// from object metadata rather than replacing it, so the object schema IS
// fetched and its declared defaults DO reach the form — through `ObjectForm`'s
// own render-time compose, not through `seedCreateValues`.

describe('`ObjectForm` inline `customFields` — the direct-install shape', () => {
  // `code` is declared by the OBJECT with a default and restated inline without
  // one; `memo` is the mirror — an APPENDED member (metadata never declares it)
  // carrying a `defaultValue` of its own. The pair is what makes row 7 a
  // two-sided reading rather than a single cell.
  const CUSTOM_FIELDS = [
    { name: 'customer', label: 'Customer', type: 'text' },
    { name: 'note', label: 'Note', type: 'text' },
    { name: 'code', label: 'Code', type: 'text' },
    { name: 'memo', label: 'Memo', type: 'text', defaultValue: 'INLINE-DEFAULT' },
  ];

  const INLINE_NAMES = ['customer', 'note', 'code', 'memo'] as const;

  const openInline = async (extra: Record<string, unknown>) => {
    const dataSource = makeDataSource();
    const { container } = render(
      <ObjectForm
        schema={
          {
            type: 'object-form',
            objectName: 'invoice',
            mode: 'create',
            customFields: CUSTOM_FIELDS,
            ...extra,
          } as any
        }
        dataSource={dataSource}
      />,
    );
    await waitFor(() => {
      if (!container.querySelector('input[name="memo"]')) throw new Error('form not ready');
    });
    const values = Object.fromEntries(
      INLINE_NAMES.map((name) => [name, readControl(container, name)]),
    );
    return { values, dataSource };
  };

  it('5. an EMPTY `initialData` contributes NOTHING here either', async () => {
    const { values } = await openInline({
      initialData: {},
      initialValues: { customer: 'Alpha', note: 'from initialValues' },
    });
    expect(values).toEqual({
      customer: 'Alpha',
      note: 'from initialValues',
      code: 'INV-DEFAULT',
      memo: '',
    });
  });

  it('6. a PARTIAL `initialData` overrides only the members it names', async () => {
    const { values } = await openInline({
      initialData: { customer: 'Beta' },
      initialValues: { customer: 'Alpha', note: 'from initialValues' },
    });
    expect(values).toEqual({
      customer: 'Beta',
      note: 'from initialValues',
      code: 'INV-DEFAULT',
      memo: '',
    });
  });

  it('7. ⭐ the defaults layer on THIS shape is the render-time compose, and it reads the OBJECT only', async () => {
    const { values, dataSource } = await openInline({
      initialValues: { code: 'FROM-AUTHOR' },
      initialData: { customer: 'Beta' },
    });
    // Two cells that only make sense together:
    //   `code`  — declared by the OBJECT with a default, and an authored member
    //             outranks it, exactly as it does on the seeding arms;
    //   `memo`  — an APPENDED member carrying a `defaultValue` of its OWN, which
    //             seeds NOTHING: `schemaDefaultValues` reads `objectSchema.fields`
    //             and an appended member is not in it.
    expect(values).toEqual({
      customer: 'Beta',
      note: '',
      code: 'FROM-AUTHOR',
      memo: '',
    });
    // …and the metadata really was read, so `memo` opening empty cannot be
    // "the schema had not arrived yet" (objectui#9778 made this path fetch).
    expect(
      dataSource.getObjectSchema.mock.calls.length,
      'the members MERGE over the generated set, so the set has to be generated',
    ).toBe(1);
  });

  it('8. control: with neither key authored the same controls open on the OBJECT default alone', async () => {
    const { values } = await openInline({});
    expect(values).toEqual({ customer: '', note: '', code: 'INV-DEFAULT', memo: '' });
  });
});

// ── the helper itself, at the boundaries no rendered form can show

describe('`resolveInitialRecord` — the chokepoint contract', () => {
  it('9. merges per member, `initialData` on top', () => {
    expect(
      resolveInitialRecord({ initialValues: { a: 1, b: 2 }, initialData: { b: 3 } }),
    ).toEqual({ a: 1, b: 3 });
  });

  it('10. a nullish KEY contributes nothing, but a null MEMBER is a value', () => {
    // The distinction `seedCreateValues`' docblock draws: an explicit `null`
    // from a caller is a real "leave this blank", not an absence.
    expect(resolveInitialRecord({ initialValues: { a: 1 }, initialData: null })).toEqual({ a: 1 });
    expect(resolveInitialRecord({ initialValues: { a: 1 }, initialData: { a: null } })).toEqual({ a: null });
    expect(resolveInitialRecord({})).toEqual({});
    expect(resolveInitialRecord(null)).toEqual({});
    expect(resolveInitialRecord(undefined)).toEqual({});
  });

  it('11. returns a FRESH object every time, never either authored one', () => {
    // Callers install the result as form state and then mutate that state. A
    // returned reference would let a form edit the author's schema object,
    // which the whole-object `||` did whenever exactly one key was authored.
    const initialValues = { a: 1 };
    const initialData = { b: 2 };
    const out = resolveInitialRecord({ initialValues, initialData });
    expect(out).not.toBe(initialValues);
    expect(out).not.toBe(initialData);
    expect(resolveInitialRecord({ initialValues })).not.toBe(initialValues);
    expect(resolveInitialRecord({ initialData })).not.toBe(initialData);
  });
});
