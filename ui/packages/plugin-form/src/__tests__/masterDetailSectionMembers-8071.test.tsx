/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-master-detail-form.sections` — the MEMBER shape THIS block reads
 * (objectui#8071, criterion from objectui#8068).
 *
 * The key is registered `{ type: 'array' }` with no `of` and typed `any[]` on
 * `MasterDetailFormSchema`, so every array parses on both declared sides and
 * nothing declared says what a member is. The only prose is the type's own
 * comment, "Parent form sections/fields — passed straight through to
 * ObjectForm", which names the carrier and says nothing about the contract.
 *
 * ## Why it is pinned here and not delegated to the sibling block's pin
 *
 * `MasterDetailForm` builds a `parentSchema` object in its `parentSchema` memo,
 * copies `sections` onto it KEY BY KEY, and renders it through a DIRECTLY
 * imported `<ObjectForm>` — no `SchemaRenderer`, no registry lookup. So the
 * member resolution IS `object-form`'s (pinned next door in
 * `objectFormSectionMembers-8071.test.tsx`), reached through a hand-written
 * copy that can drop a key without any declaration changing — the exact failure
 * that file records twice over for `description` (objectui#9779,
 * objectui#9834).
 *
 * ⛔ What this file therefore does NOT re-assert, because those rows are owned
 * next door and duplicating them would buy nothing: `collapsed` vs
 * `collapsible`, the `name`-alone heading, the untitled trailing bucket, and
 * the `description` blurb. The presentation routing (`simple` / `tabbed`, and
 * the four values this block's `formType` deliberately does not declare) is
 * owned by `masterDetailFormTypeVocabulary.test.tsx`.
 *
 * ## The rows
 *
 *   1. a member is a section OBJECT; its `fields` are drawn in the member's
 *      AUTHORED order — and the block's own `details` are untouched by any of
 *      it, which is the half only this block can state.
 *
 *      ⚠ FLIPPED by objectui#10475, with row 1 of the `object-form` pin next
 *      door: it used to pin the parent OBJECT's field order winning over the
 *      authored member order, the name filter `SimpleObjectForm` resolved a
 *      section with. That arm now builds a section through the shared
 *      `buildSectionFields`, so the order is the member's own, as on every
 *      other `object-form` arm. The `details` half did not move.
 *   2. a member that resolves to NO parent field is dropped WHOLE, heading
 *      included — silently. Measured with a DETAIL column name as the member,
 *      the mistake this composition invites: two field vocabularies on one
 *      node, and only one of them is `sections`'.
 *   3. ⭐ the sharp row. `ObjectForm` builds the parent field pool from
 *      `schema.fields` FIRST and a section resolves its members against that
 *      pool, so authoring both INTERSECTS them: a section member absent from
 *      `fields` does not render, and a section whose every member is absent
 *      disappears heading and all.
 *
 *      ⚠ FLIPPED by objectui#9884, in the direction the sibling rows 4, 6 and
 *      7 next door flipped: it used to pin this as a DIVERGENCE from the
 *      block's own registration, which declared `fields` "Ignored when
 *      `sections` is given — sections carry their own field lists", and to
 *      record the loss as having "no diagnostic". objectui#8071 slice 15 handed
 *      that back as a finding rather than fixing it, because fixing it changes
 *      either the renderer or the declaration and that card wrote pins only.
 *      objectui#9884 ruled it: the DECLARATION was the wrong half. One
 *      `SimpleObjectForm` renders this block's parent half and `object-form`
 *      alike (`MasterDetailForm`'s `parentSchema` memo literally builds a
 *      `{ type: 'object-form', ... }` node), and the three sibling `fields`
 *      registrations — `object-form`, `form`, `embeddable-form` — all declare
 *      the key as the field selection with no such exemption, with
 *      `objectFormFieldsMembers-8071` pinning it as one. Honouring the
 *      exemption would therefore have falsified three declarations to satisfy
 *      one, on a pool that also feeds values, create defaults and the submitted
 *      set. So the sentence was corrected and the SILENCE — the half that was
 *      a defect under either reading — was closed instead: rows 3 and 3b pin
 *      that every loss is now named by `warnSectionMemberExcludedByFields`, 3c
 *      is the firing control, and 3d keeps the warning off row 2's different
 *      silence. ⛔ The rendered outcome did not move: row 3's two DOM
 *      assertions are the ones slice 15 wrote.
 *   4. the non-vacuity control: with no `sections` the same parent fields
 *      render flat and no divider is drawn, so every absence above is about a
 *      form that drew something.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from '../MasterDetailForm';

registerAllFields();

/** Parent object — three text fields, declared in this order. */
const PARENT_OBJECT = {
  name: 'po',
  fields: {
    ref: { type: 'text', label: 'Ref' },
    memo: { type: 'text', label: 'Memo' },
    amount: { type: 'text', label: 'Amount' },
  },
};

const makeDataSource = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(PARENT_OBJECT),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
    batchTransaction: vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] }),
  }) as any;

/** One child collection with an explicit column, so the detail half is observable. */
const DETAILS = [
  {
    childObject: 'po_line',
    relationshipField: 'po',
    columns: [{ key: 'qty', label: 'Qty', type: 'number' }],
  },
];

async function mount(schema: Record<string, unknown>): Promise<HTMLElement> {
  const { container } = render(
    <MasterDetailForm
      schema={{ objectName: 'po', mode: 'create', details: DETAILS, ...schema } as any}
      dataSource={makeDataSource()}
    />,
  );
  await waitFor(() => {
    if (!container.querySelector('form')) throw new Error('parent form not ready');
  });
  return container as HTMLElement;
}

/** The parent field controls actually drawn, in DOM order. */
const drawnFields = (c: HTMLElement): string[] =>
  [...c.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field') as string);

/** The section headings actually drawn, in DOM order. */
const headings = (c: HTMLElement): string[] =>
  [...c.querySelectorAll('.border-b span')].map((el) => el.textContent ?? '');

/** The detail collection is still on screen — the half `sections` must not move. */
const detailIsDrawn = (c: HTMLElement): boolean => (c.textContent ?? '').includes('Qty');

describe('`object-master-detail-form` — the member shape of `sections`', () => {
  it('1. a member’s `fields` are parent field NAMES drawn in the member’s authored order — and the `details` half is untouched (objectui#10475)', async () => {
    // ⚠️ FLIPPED by objectui#10475 — see this file's header, row 1. It used to
    // assert `['ref', 'memo']`, the parent object's order winning.
    const c = await mount({
      sections: [{ name: 'head', label: 'Header', fields: ['memo', 'ref'] }],
    });
    expect(headings(c)).toEqual(['Header']);
    expect(
      drawnFields(c),
      'the section draws its members in the order it lists them (`memo` before `ref`, the ' +
        'reverse of the parent object’s)',
    ).toEqual(['memo', 'ref']);
    expect(
      detailIsDrawn(c),
      '`sections` shapes the PARENT half only — the child collections keep their own columns',
    ).toBe(true);
  });

  it('2. a member that resolves to NO parent field is dropped whole — heading and all', async () => {
    // `qty` is a DETAIL column, not a parent field: the vocabulary mistake this
    // composition invites, since one node declares both halves.
    const c = await mount({
      sections: [
        { label: 'Lines', fields: ['qty'] },
        { label: 'Header', fields: ['ref'] },
      ],
    });
    expect(headings(c), 'a section that resolves no parent field never reaches a divider').toEqual([
      'Header',
    ]);
    expect(drawnFields(c)).toEqual(['ref']);
    expect(detailIsDrawn(c), 'and the detail column it named is still drawn by `details`, not by it').toBe(
      true,
    );
  });

  it('3. `fields` is NOT ignored when `sections` is given — the two INTERSECT, and every loser is NAMED (objectui#9884)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let c: HTMLElement;
    try {
      c = await mount({
        fields: ['ref'],
        sections: [
          { label: 'Header', fields: ['ref', 'memo'] },
          { label: 'Notes', fields: ['memo'] },
        ],
      });
      // The RENDER half is byte-identical to what this row pinned before
      // objectui#9884: the intersection is the behaviour, deliberately kept.
      expect(
        drawnFields(c),
        'the renderer builds the parent pool from `fields` first and the section filters against ' +
          'THAT, so `memo` — a member the section names and the object declares — does not render',
      ).toEqual(['ref']);
      expect(
        headings(c),
        'a section whose every member lost that intersection disappears heading and all',
      ).toEqual(['Header']);

      // The half objectui#9884 added, and the whole reason the row's title
      // changed: the loss is no longer silent. One warning per (section,
      // member) pair, so BOTH losses are reported — the one that cost a
      // control and the one that cost a whole heading.
      const said = warn.mock.calls.map((call) => String(call[0]));
      expect(
        said.filter((m) => m.includes("names 'memo'")).length,
        'both sections named `memo`, and each lost it to the same intersection',
      ).toBe(2);
      expect(said.some((m) => m.includes("section 'Header'"))).toBe(true);
      expect(said.some((m) => m.includes("section 'Notes'"))).toBe(true);
      expect(
        said.every((m) => m.includes('INTERSECT')),
        'the warning has to say WHICH two keys collided, or the author cannot act on it',
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('3b. the last-member case: the section that vanishes heading and all is named too — the ONE loss with no other trace', async () => {
    // Row 3 proves the pair; this row isolates the expensive half on its own
    // fixture, because it is the only loss that leaves NOTHING on the page —
    // no control missing from a section the author can still see, just an
    // absent section. Fresh member/label so the module-scoped dedupe Set in
    // `warnSectionMemberExcludedByFields` cannot answer for row 3's entry.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const c = await mount({
        fields: ['ref'],
        sections: [{ label: 'Money', fields: ['amount'] }],
      });
      expect(headings(c), 'nothing of the section survives').toEqual([]);
      expect(
        drawnFields(c),
        '\u2b50 and it costs MORE than the section: the grouped branch renders ONLY what the ' +
          'sections resolved, so with the form\u2019s only section gone the parent half draws no ' +
          'control at all \u2014 `ref`, which IS in `fields` and named by no section, never appears',
      ).toEqual([]);
      const said = warn.mock.calls.map((call) => String(call[0]));
      expect(said.filter((m) => m.includes("names 'amount'")).length).toBe(1);
      expect(said[0]).toContain("section 'Money'");
      expect(
        said[0],
        'and it has to state the consequence, because the page shows no sign of it',
      ).toContain('disappears with its heading');

      // The counterfactual, on the SAME section: drop `fields` and the member
      // the intersection ate renders under its heading. Without this leg the
      // assertions above would also pass on a form that draws nothing for
      // reasons having nothing to do with this card.
      const without = await mount({ sections: [{ label: 'Money', fields: ['amount'] }] });
      expect(headings(without)).toEqual(['Money']);
      expect(drawnFields(without)).toEqual(['amount']);
    } finally {
      warn.mockRestore();
    }
  });

  it('3c. the firing control: `fields` listing every section member warns about NOTHING', async () => {
    // Without this leg row 3 would still pass on a warning that fired on every
    // render of every sectioned form.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const c = await mount({
        fields: ['ref', 'memo'],
        sections: [{ label: 'Both', fields: ['ref', 'memo'] }],
      });
      expect(drawnFields(c)).toEqual(['ref', 'memo']);
      expect(headings(c)).toEqual(['Both']);
      expect(
        warn.mock.calls.map((call) => String(call[0])).filter((m) => m.includes('INTERSECT')),
        'nothing was lost, so nothing is reported',
      ).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('3d. the OTHER silence is left alone: a member the object never declares still goes unreported here', async () => {
    // Row 2's `qty` resolves to nothing whether or not `fields` is authored, so
    // it is a different defect with a different remedy (and row 2 pins the drop
    // itself). Authoring `fields` alongside it must NOT recruit it into this
    // warning — that would make row 2 and its `object-form` twin fire a
    // diagnostic about a collision that never happened.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const c = await mount({
        fields: ['ref'],
        sections: [
          { label: 'Lines', fields: ['qty'] },
          { label: 'Head', fields: ['ref'] },
        ],
      });
      expect(headings(c)).toEqual(['Head']);
      expect(
        warn.mock.calls.map((call) => String(call[0])).filter((m) => m.includes('INTERSECT')),
      ).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('4. control: with NO `sections` the same parent fields render flat and no divider is drawn', async () => {
    const c = await mount({});
    expect(headings(c)).toEqual([]);
    expect(drawnFields(c)).toEqual(['ref', 'memo', 'amount']);
    expect(detailIsDrawn(c)).toBe(true);
  });
});
