/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8847 — MEASURES, rather than assumes, whether route 1's warning
 * (objectui#8738, `warnUnresolvedTopLevelField` in `sectionFields.ts`) reaches
 * the two surfaces #8847 named beyond `object-form` itself:
 *
 *   1. `form` / `view:form` — registered on the exact same `ObjectFormRenderer`
 *      component as `object-form` (`index.tsx`), so it is the SAME code path
 *      by construction, not merely a similar one. No render test needed to
 *      "prove" a React component warns differently depending on the string
 *      key it happens to be registered under — it cannot.
 *   2. `object-master-detail-form`'s parent `fields` — routed differently
 *      (`MasterDetailForm` builds a `parentSchema` and renders it through
 *      `<ObjectForm>`, `MasterDetailForm.tsx`), so THIS one is measured here.
 *
 * Result: route 1 covers both for free. `MasterDetailForm`'s `parentSchema`
 * carries `fields: schema.fields` straight through, and with no `sections`
 * authored (the case these rows mount) `ObjectForm`'s formType routing
 * (`ObjectForm.tsx`, the `schema.sections?.length` guards on every sectioned
 * branch) falls through to `SimpleObjectForm` — the exact read site route 1
 * patches — regardless of the master-detail `formType` ('simple' | 'tabbed').
 * ⇒ #8847's remaining work for both surfaces is documentation only (see the
 * `description` added in `index.tsx`).
 *
 * ⚠️ This paragraph used to give a reason in brackets: that `fields` is
 * documented as ignored once `sections` is given. objectui#9884 corrected that
 * declaration. The two keys INTERSECT, and the registration now says so. The
 * intersection is pinned by `masterDetailSectionMembers-8071.test.tsx`, so this
 * file does not re-pin it.
 *
 * ## Promoted to the member pin for `object-master-detail-form.fields`
 *
 * ⭐ objectui#8071 slice 18 registered this file as the key's member pin. It was
 * read end to end first. Its two rows already pin the sharpest member fact:
 * the spec `FormFieldSchema` object, which is legal in `sections[].fields`,
 * resolves to no name here, draws a named warning and does not render. What
 * they never stated is what a legal member IS, so the file was GROWN by the
 * rows in the `MEMBER-PIN rows` block below:
 *
 *   - a member is a bare PARENT field name, drawn in AUTHORED order. The
 *     control is the no-`fields` form, whose order is the object's;
 *   - a name the parent object does not declare is dropped, not drawn as an
 *     untyped stub. A DETAIL column name is the case this composition invites,
 *     because one node declares two field vocabularies. It renders nothing in
 *     the parent, while the line grid keeps that column;
 *   - a STORED `{ name }` member still draws as its bare name. It is not an
 *     authoring shape: objectui#11550 retired it from every authoring face, and
 *     `objectFormFieldsMembers-8071.test.tsx` row 6 pins the declared refusal.
 *     This row pins only that the hand-off keeps the stored read;
 *   - ⚠️ the key bounds what is DRAWN, not what the PARENT leg of the atomic
 *     batch WRITES: a seeded parent field it does not list is still written.
 *     That is the ruled behaviour (objectui#11114), not a defect: the
 *     registration's `fields` description says that, on a create, the submitted
 *     set is the drawn fields plus any seeded `initialValues`, and this row is
 *     what keeps that sentence true.
 *
 * `MasterDetailForm` reads none of this itself. The `parentSchema` memo copies
 * `fields` onto an `object-form`-shaped node rendered through a DIRECTLY
 * imported `<ObjectForm>`. That hand-written carrier is why the pin is taken at
 * THIS block and not left to `object-form.fields`: dropping `fields:` from the
 * memo leaves the sibling's pin green. The spec row is `z.array(z.unknown())`
 * and the registration declares no `of`, so the read site is the whole member
 * contract.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from '../MasterDetailForm';

registerAllFields();

const PARENT_SCHEMA = {
  name: 'invoice',
  fields: {
    status: { type: 'text', label: 'Status' },
    note: { type: 'text', label: 'Note' },
  },
};

function makeDataSource() {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(PARENT_SCHEMA),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
  } as any;
}

describe('object-master-detail-form parent `fields` inherits route 1 for free (objectui#8847)', () => {
  it('warns when a parent-fields member resolves to no name — the spec FormFieldSchema object', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { container } = render(
        <MasterDetailForm
          schema={
            {
              objectName: 'invoice',
              mode: 'create',
              fields: [{ field: 'note' }], // the #8738 trap shape — legal in sections[].fields, not here
              details: [
                {
                  childObject: 'invoice_line',
                  relationshipField: 'invoice',
                  columns: [{ key: 'qty', label: 'Qty', type: 'number' } as any],
                },
              ],
            } as any
          }
          dataSource={makeDataSource()}
        />,
      );
      await waitFor(() => expect(container.querySelector('form')).toBeTruthy());
      // Filtered rather than an exact call count: this render also fires an
      // unrelated `react-i18next` "no i18next instance" warning in this test
      // harness (no I18nextProvider is mounted), which is not this pin's
      // concern.
      const said = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes('top-level `fields`'));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain("{ field: 'note' }");
      expect(said[0]).toContain('sections[].fields');
      // The trapped field never rendered — route 1 warns, it does not resolve.
      expect(container.querySelector('label')?.textContent ?? '').not.toContain('Note');
    } finally {
      warn.mockRestore();
    }
  });

  it('does NOT warn for a legal bare parent field name — the firing control', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { container } = render(
        <MasterDetailForm
          schema={
            {
              objectName: 'invoice',
              mode: 'create',
              fields: ['status'],
              details: [
                {
                  childObject: 'invoice_line',
                  relationshipField: 'invoice',
                  columns: [{ key: 'qty', label: 'Qty', type: 'number' } as any],
                },
              ],
            } as any
          }
          dataSource={makeDataSource()}
        />,
      );
      await waitFor(() => {
        const el = container.querySelector('input[name="status"], label');
        expect(el).toBeTruthy();
      });
      // Filtered for the same reason as the row above (unrelated i18next
      // warning fires regardless of the `fields` shape under test).
      const said = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes('top-level `fields`'));
      expect(said).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});

// ── the MEMBER-PIN rows (objectui#8071 slice 18) ───────────────────────────
//
// See the docblock. Every row mounts the same parent object with a third
// field, so an order and a subset are both observable.

const MEMBER_PARENT = {
  name: 'invoice',
  fields: {
    status: { type: 'text', label: 'Status' },
    note: { type: 'text', label: 'Note' },
    memo: { type: 'text', label: 'Memo' },
  },
};

const MEMBER_DETAILS = [
  {
    childObject: 'invoice_line',
    relationshipField: 'invoice',
    title: 'Lines',
    columns: [{ name: 'qty', label: 'Qty', type: 'number' }],
  },
];

function makeMemberDataSource() {
  return {
    getObjectSchema: vi.fn(async (name: string) =>
      name === 'invoice'
        ? MEMBER_PARENT
        : { name, fields: { invoice: { type: 'master_detail', reference: 'invoice' }, qty: { type: 'number' } } },
    ),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
    batchTransaction: vi.fn().mockResolvedValue({ results: [{ id: 'inv1' }] }),
  } as any;
}

async function mountMembers(schema: Record<string, unknown>, dataSource = makeMemberDataSource()) {
  const view = render(
    <MasterDetailForm
      schema={{ objectName: 'invoice', mode: 'create', details: MEMBER_DETAILS, ...schema } as any}
      dataSource={dataSource}
    />,
  );
  // Every row keeps at least one legal parent member, so a drawn control is
  // the ready signal.
  await waitFor(() => {
    if (!view.container.querySelector('form [data-field]')) throw new Error('parent form not ready');
  });
  return { ...view, dataSource };
}

/** The PARENT controls, in the order the form draws them. */
const parentFields = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('form [data-field]')).map((el) => el.getAttribute('data-field'));

describe('object-master-detail-form `fields` — the member shape (objectui#8071 slice 18)', () => {
  it('a member is a bare PARENT field name, drawn in AUTHORED order', async () => {
    const { container } = await mountMembers({ fields: ['memo', 'status'] });
    expect(parentFields(container)).toEqual(['memo', 'status']);
  });

  it('control: with no `fields` the parent draws every field, in the OBJECT’s order', async () => {
    const { container } = await mountMembers({});
    expect(parentFields(container)).toEqual(['status', 'note', 'memo']);
  });

  it('a name the parent does not declare is dropped — a DETAIL column name included — while the line grid keeps its column', async () => {
    const { container } = await mountMembers({ fields: ['qty', 'status', 'nowhere'] });
    expect(parentFields(container), 'no untyped stub for either name').toEqual(['status']);
    expect(
      screen.getAllByLabelText('Qty').length,
      'the detail vocabulary is untouched by the parent key',
    ).toBeGreaterThan(0);
  });

  it('a STORED `{ name }` member still draws as its bare name — read only, not authoring (objectui#11550)', async () => {
    const { container } = await mountMembers({ fields: [{ name: 'note' }, 'status'] });
    expect(parentFields(container)).toEqual(['note', 'status']);
  });

  it('the key bounds what is DRAWN, not what the parent leg WRITES: a seeded field it does not list is still written', async () => {
    const { container, dataSource } = await mountMembers({
      fields: ['status'],
      // `memo` is a real parent field, seeded but NOT listed in `fields`.
      initialValues: { status: 'draft', memo: 'seeded' },
    });
    expect(parentFields(container), 'the unlisted field is not drawn').toEqual(['status']);
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(dataSource.batchTransaction).toHaveBeenCalledTimes(1));
    const ops = dataSource.batchTransaction.mock.calls[0][0] as Array<Record<string, any>>;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ object: 'invoice', action: 'create' });
    // The ruled behaviour, not an accident (objectui#11114): the registration's
    // `fields` description says that, on a create, the submitted set is the
    // drawn fields plus any seeded `initialValues`, so a seeded field outside
    // `fields` is written all the same. Hiding a field with `fields` does not
    // stop its seed being saved.
    expect(ops[0].data).toEqual({ status: 'draft', memo: 'seeded' });
  });
});
