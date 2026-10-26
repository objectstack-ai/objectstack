/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-master-detail-form.initialValues` and
 * `object-master-detail-form.initialData` — the MEMBER shape THIS block reads
 * (objectui#8071, criterion from objectui#8068).
 *
 * The two keys are pinned in ONE file because the registry itself declares them
 * a pair: `initialValues` is "Values to prefill on the PARENT record in
 * `create` mode" and `initialData` is declared as its "Alternate spelling …
 * the renderer also reads", with new schemas told to prefer `initialValues`.
 * A pair whose members are pinned apart leaves the one cell an author actually
 * trips on — which spelling WINS when both are authored — stated nowhere.
 *
 * Both are registered `{ type: 'object' }` and typed `Record<string, any>` on
 * `MasterDetailFormSchema`, so every object parses on both declared sides and
 * nothing declared says what a member is, where it lands, or what the pair's
 * precedence is. That is the population objectui#8068 refuses to leave
 * unwatched.
 *
 * ## What this renderer does with them, and why it is not the sibling's pin
 *
 * `MasterDetailForm` does not read either key for itself. It builds a
 * `parentSchema` object in its `parentSchema` memo, copies `initialValues` and
 * `initialData` onto it KEY BY KEY, and renders it through a DIRECTLY imported
 * `<ObjectForm>` — not through `SchemaRenderer`, so no registry entry and no
 * `object-form` declaration is consulted on the way. The precedence is
 * therefore inherited from `ObjectForm`'s two seeding sites, both spelled
 * `setInitialData(resolveInitialRecord(schema))` since objectui#9760, and the
 * member vocabulary is parent FIELD NAMES.
 *
 * Inheriting it is exactly why it is pinned HERE as well as on `object-form`:
 * the carrier is a hand-written key-by-key copy, and a key such a map does not
 * copy is dropped before any renderer can see it — the failure `object-form`'s
 * own `sections` pin records twice over (objectui#9779, objectui#9834). Dropping
 * `initialData:` from that memo leaves `object-form`'s pin green and this
 * block's authors with no diagnostic at all.
 *
 * ## The rows, and which of them no sibling pin can make
 *
 *   1-2. a MEMBER is a parent FIELD NAME and its value is that control's
 *        opening value, on each spelling.
 *   3.   ⭐ FLIPPED by objectui#9760, ⛔ not deleted. With BOTH authored the two
 *        keys are MERGED PER MEMBER — `initialData` wins where it speaks and
 *        `initialValues` supplies every member it says nothing about, which is
 *        what the registry's "alternate spelling the renderer also reads"
 *        states once read as a precedence claim. It used to be a whole-object
 *        `||`: every `initialValues` member was dropped, including the ones
 *        `initialData` said nothing about. objectui#8071 wrote pins only, so it
 *        recorded that and handed the defect back; the maintainer ruling on
 *        objectui#9760 (batch #166 item 3, letter 甲) repaired it. This block
 *        inherits the repair through the same `parentSchema` memo, which is why
 *        the row is kept HERE rather than left to the sibling pin.
 *   4.   ⭐ FLIPPED with it, the same read at its sharp edge: an EMPTY
 *        `initialData` now contributes NOTHING. `||` tested the OBJECT's
 *        truthiness and `{}` is truthy, so the empty object a `?? {}` producer
 *        hands over used to blank a populated `initialValues` completely. This
 *        block is one such producer one layer down (its expanded-row form
 *        authors `initialData: expandedRow ?? {}`), which is the case that made
 *        the defect reachable without anybody authoring an empty object.
 *   5.   ⭐ the row only this block can make: the seed reaches the PARENT LEG of
 *        the atomic batch and NOTHING else. A member naming a detail column
 *        seeds no child row, and the batch this form posts still carries
 *        exactly one operation. "Prefilled the form" and "prefilled the parent
 *        record" are the same sentence here only because this row measures it.
 *   6.   ⭐ the second block-specific row: in `edit` mode with a `recordId` the
 *        fetched parent record REPLACES both keys wholesale — a member the
 *        record omits opens EMPTY rather than falling back to the authored
 *        seed. The registry says "in `create` mode" and this is what that costs
 *        an author who prefills an edit form.
 *   7.   the non-vacuity control: with neither key authored the same controls
 *        open EMPTY, so rows 1-4 cannot be passing on a form that ignores both.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from '../MasterDetailForm';

registerAllFields();

/** Parent object: two plain text fields, so a jsdom submit can validate. */
const PARENT_OBJECT = {
  name: 'po',
  fields: {
    ref: { type: 'text', label: 'Ref' },
    memo: { type: 'text', label: 'Memo' },
  },
};

function makeDataSource(overrides: Record<string, unknown> = {}) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(PARENT_OBJECT),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
    batchTransaction: vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] }),
    ...overrides,
  } as any;
}

const DETAILS = [
  {
    childObject: 'po_line',
    relationshipField: 'po',
    columns: [{ key: 'qty', label: 'Qty', type: 'number' }],
  },
];

/** Mount an `object-master-detail-form` and read both PARENT controls back. */
async function mount(schema: Record<string, unknown>, dataSource = makeDataSource()) {
  const view = render(
    <MasterDetailForm
      schema={{ objectName: 'po', mode: 'create', details: DETAILS, ...schema } as any}
      dataSource={dataSource}
    />,
  );
  await waitFor(() => {
    if (!view.container.querySelector('input[name="ref"]')) throw new Error('parent form not ready');
  });
  return { ...view, dataSource };
}

const readControl = (container: HTMLElement, name: string) =>
  (container.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value ?? null;

async function openingValues(
  schema: Record<string, unknown>,
): Promise<{ ref: string | null; memo: string | null }> {
  const { container } = await mount(schema);
  return { ref: readControl(container, 'ref'), memo: readControl(container, 'memo') };
}

describe('`object-master-detail-form` — the member shape of `initialValues` / `initialData`', () => {
  it('1. an `initialValues` member is a PARENT FIELD NAME, and its value opens that control', async () => {
    expect(await openingValues({ initialValues: { ref: 'PO-9', memo: 'from initialValues' } })).toEqual({
      ref: 'PO-9',
      memo: 'from initialValues',
    });
  });

  it('2. `initialData` carries the same member vocabulary, and a field it omits opens empty', async () => {
    expect(await openingValues({ initialData: { ref: 'PO-8' } })).toEqual({ ref: 'PO-8', memo: '' });
  });

  it('3. with BOTH authored the merge is PER MEMBER — `initialData` wins where it speaks, `initialValues` supplies the rest', async () => {
    expect(
      await openingValues({
        initialData: { ref: 'PO-8' },
        initialValues: { ref: 'PO-9', memo: 'from initialValues' },
      }),
      'a whole-object choice would blank `memo`; the merge carries it through the `parentSchema` memo intact',
    ).toEqual({ ref: 'PO-8', memo: 'from initialValues' });
  });

  it('4. an EMPTY `initialData` contributes NOTHING — it no longer shadows a populated `initialValues`', async () => {
    expect(
      await openingValues({ initialData: {}, initialValues: { ref: 'PO-9', memo: 'from initialValues' } }),
      'the empty object a `?? {}` producer hands over must not blank the parent form beside it',
    ).toEqual({ ref: 'PO-9', memo: 'from initialValues' });
  });

  it('5. the seed lands on the PARENT LEG of the atomic batch, and a member naming a detail column seeds NO child row', async () => {
    const dataSource = makeDataSource();
    const { container } = await mount(
      // `qty` is a DETAIL column, not a parent field — authored here on purpose.
      { initialValues: { ref: 'PO-9', qty: 42 } },
      dataSource,
    );
    expect(readControl(container, 'ref'), 'the parent control opens seeded').toBe('PO-9');

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(dataSource.batchTransaction).toHaveBeenCalledTimes(1));

    const ops = dataSource.batchTransaction.mock.calls[0][0] as Array<Record<string, any>>;
    expect(ops, 'a detail member must not mint a child operation').toHaveLength(1);
    expect(ops[0].object).toBe('po');
    expect(ops[0].action).toBe('create');
    expect(ops[0].data.ref, 'the seed is the parent record’s opening value, not just a painted control').toBe(
      'PO-9',
    );
    expect(ops[0].data.qty, 'a detail column name is not parent vocabulary').toBeUndefined();
  });

  it('6. in `edit` mode the fetched parent record REPLACES both keys — a field it omits opens empty', async () => {
    const findOne = vi.fn().mockResolvedValue({ id: 'po1', ref: 'FROM-RECORD' });
    const dataSource = makeDataSource({ findOne });
    const { container } = await mount(
      {
        mode: 'edit',
        recordId: 'po1',
        initialData: { ref: 'PO-8', memo: 'seeded' },
        initialValues: { ref: 'PO-9', memo: 'seeded' },
      },
      dataSource,
    );
    await waitFor(() => expect(findOne).toHaveBeenCalled());
    await waitFor(() => expect(readControl(container, 'ref')).toBe('FROM-RECORD'));
    expect(
      readControl(container, 'memo'),
      'the record is installed WHOLE; the seed does not fill the gaps it leaves',
    ).toBe('');
  });

  it('7. control: with neither key authored the same controls open EMPTY', async () => {
    expect(await openingValues({})).toEqual({ ref: '', memo: '' });
  });
});
