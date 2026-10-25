/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-form.customFields` — the MEMBER shape this renderer reads
 * (objectui#8071, criterion from objectui#8068), now pinned on the MERGE
 * behaviour ruled in objectui#9778.
 *
 * Declared on both sides without a member shape: the registration is
 * `{ type: 'array' }` with no `of`, and `@objectstack/spec`'s
 * `ComponentPropsMap['object-form'].customFields` is `z.unknown().optional()`
 * — so anything parses and the read site is the whole member contract.
 *
 * ⭐ The registration's own prose is what makes this key worth pinning rather
 * than describing. It reads:
 *
 *     "Field definitions merged over the set generated from object metadata.
 *      With inline definitions and no data source, this becomes the only field
 *      source."
 *
 * ⇒ Both sentences describe a MERGE, and objectui#9778 ruled that the prose is
 * the contract and the renderer was the defect: a non-empty `customFields` used
 * to `setFormFields(schema.customFields.map(normalizeVisibility))` and return
 * above the metadata branch entirely, so it REPLACED the generated set and the
 * object's schema was never even fetched. Rows 1-4 pin the merge that replaced
 * it, one row per direction:
 *
 *   OVERRIDE — a member naming a declared field supplies that field's whole
 *              definition, in the generated set's position (row 2), and the
 *              metadata IS fetched to have a position at all;
 *   KEEP     — a declared field no member names still renders, with the label
 *              the object gave it (row 3);
 *   APPEND   — a member naming a field the metadata never declares is added
 *              after the generated set, in authored order (row 4).
 *
 * ⚠️ Row 2's `getObjectSchema` assertion is the one that inverted: it used to
 * read `toBe(0)` — "the renderer returns before that set is generated at all" —
 * and the ruling made the fetch the precondition of the merge. It is asserted
 * here rather than left implicit because a renderer that skipped the fetch
 * again would still pass every drawn-field row on the no-data-source path.
 *
 * ⛔ Row 5 is the one a plausible "improvement" breaks. The gate reads
 * `.length > 0`, not truthiness, so an EMPTY `customFields: []` is UNAUTHORED:
 * the metadata path runs alone and the object's own fields render. Simplifying
 * that read to `!!schema.customFields` — which is what "has inline fields"
 * reads like — makes a designer's not-configured-yet empty array take the
 * inline path; under the merge that no longer empties the form, but it does
 * suppress the no-adapter panel row 6 pins, so the row stays.
 *
 * Row 6 pins the SECOND read site of the same member count, one layer up:
 * `index.tsx` spells `requiresDataSource={!(schema?.customFields?.length > 0) …}`,
 * so the members are what exempt this block from the gate's no-adapter panel.
 * `ElementDataSourceGate`'s own docblock states the contract in words ("an
 * `object-form` with inline `customFields` needs none"); this is that sentence
 * as behaviour, driven through the REGISTERED block with its control in the
 * same test. It doubles as the control for the registration's second sentence:
 * with no data source there is no generated set to merge over, so the members
 * are the only field source — the shape hosts authored before the ruling.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ObjectForm } from '../ObjectForm';
// Registers `object-form` with the `requiresDataSource` wiring row 5 reads.
import '../index';

registerAllFields();

const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    customer: { type: 'text', label: 'Customer' },
    note: { type: 'text', label: 'Note' },
    amount: { type: 'text', label: 'Amount' },
  },
};

const makeDataSource = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }) as any;

async function mount(schema: Record<string, unknown>, adapter = makeDataSource()) {
  const { container } = render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'invoice', mode: 'create', ...schema } as any}
      dataSource={adapter}
    />,
  );
  await waitFor(() => {
    if (!container.querySelector('form')) throw new Error('form not ready');
  });
  return { container: container as HTMLElement, adapter };
}

const drawnFields = (c: HTMLElement): string[] =>
  [...c.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field') as string);

const labelOf = (c: HTMLElement, name: string): string | null =>
  c.querySelector(`[data-field="${name}"] label`)?.textContent ?? null;

describe('`object-form` — the member shape of `customFields`', () => {
  it('1. members are whole FIELD DEFINITIONS keyed by `name`, MERGED over the generated set', async () => {
    const { container } = await mount({
      customFields: [
        { name: 'zz', label: 'Brand new', type: 'text' },
        { name: 'note', label: 'INLINE NOTE', type: 'text' },
      ],
    });
    expect(
      drawnFields(container),
      'the generated set keeps its own order and its unnamed members; the member naming a ' +
        'declared field lands in that field\'s position, the one naming nothing declared is appended',
    ).toEqual(['customer', 'note', 'amount', 'zz']);
    expect(labelOf(container, 'zz'), 'a member naming a field the object never declares still renders').toBe(
      'Brand new',
    );
    expect(labelOf(container, 'note'), 'and a member naming a declared field is what renders for it').toBe(
      'INLINE NOTE',
    );
  });

  it('2. OVERRIDE — a member replaces the declared field IN PLACE, and the metadata IS fetched', async () => {
    const { container, adapter } = await mount({
      customFields: [{ name: 'note', label: 'INLINE NOTE', type: 'text' }],
    });
    expect(
      adapter.getObjectSchema.mock.calls.length,
      'the registration promises a merge "over the set generated from object metadata"; there is ' +
        'no set to merge over unless the renderer goes and generates it (objectui#9778)',
    ).toBe(1);
    expect(adapter.getObjectSchema).toHaveBeenCalledWith('invoice');
    expect(
      drawnFields(container),
      'one member, three declared fields: the member takes `note`\'s position, it does not become the set',
    ).toEqual(['customer', 'note', 'amount']);
    expect(
      labelOf(container, 'note'),
      'the object declares this field as "Note"; the member supplies the whole definition, inheriting nothing',
    ).toBe('INLINE NOTE');
  });

  it('3. KEEP — a declared field no member names renders with the definition the OBJECT gave it', async () => {
    const { container } = await mount({
      customFields: [{ name: 'note', label: 'INLINE NOTE', type: 'text' }],
    });
    expect(labelOf(container, 'customer'), 'untouched by the members, so the object\'s own label').toBe('Customer');
    expect(labelOf(container, 'amount'), 'same, for a field after the overridden one').toBe('Amount');
  });

  it('4. APPEND — members naming nothing declared come after the generated set, in AUTHORED order', async () => {
    const { container } = await mount({
      customFields: [
        { name: 'zz', label: 'Brand new', type: 'text' },
        { name: 'yy', label: 'Also new', type: 'text' },
      ],
    });
    expect(drawnFields(container)).toEqual(['customer', 'note', 'amount', 'zz', 'yy']);
    expect(labelOf(container, 'yy'), 'the appended member carries its own definition too').toBe('Also new');
  });

  it('5. an EMPTY `customFields` is UNAUTHORED — the read is `.length > 0`, ⛔ not truthiness', async () => {
    const { container, adapter } = await mount({ customFields: [] });
    expect(adapter.getObjectSchema).toHaveBeenCalledWith('invoice');
    expect(
      drawnFields(container),
      'nothing is merged over the generated set, so the object\'s own fields are all of it',
    ).toEqual(['customer', 'note', 'amount']);
  });

  it('6. the same member count is what exempts the block from the no-adapter panel', async () => {
    const withMembers = render(
      <SchemaRendererProvider dataSource={null}>
        <SchemaRenderer
          schema={
            {
              type: 'object-form',
              objectName: 'invoice',
              mode: 'create',
              customFields: [{ name: 'zz', label: 'Inline only', type: 'text' }],
            } as any
          }
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      if (!withMembers.container.querySelector('form')) throw new Error('form not ready');
    });
    expect(withMembers.container.querySelector('[data-testid="object-form-no-data-source"]')).toBeNull();
    expect(
      drawnFields(withMembers.container as HTMLElement),
      'the registration\'s second sentence: with no data source there is no generated set, so the ' +
        'members are the only field source',
    ).toEqual(['zz']);

    const withoutMembers = render(
      <SchemaRendererProvider dataSource={null}>
        <SchemaRenderer schema={{ type: 'object-form', objectName: 'invoice', mode: 'create' } as any} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      if (!withoutMembers.container.querySelector('[data-testid="object-form-no-data-source"]')) {
        throw new Error('panel not ready');
      }
    });
    expect(
      withoutMembers.container.querySelector('form'),
      'control: the identical node without the members reports instead of rendering',
    ).toBeNull();
  });
});
