/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record-form door for objectui#7611 (ruling B2 on objectstack#22865): an
 * object field `{ type: 'text', widget: 'position-ref' }` rendered by
 * `ObjectForm`, the shape a grant table's name field takes once it declares
 * the widget (`sys_user_position.position`).
 *
 * The spec's `FieldSchema.widget` is looked up as `field:<widget>`, so the
 * declaration reaches the registry-name picker only if `@object-ui/fields`
 * registers it under that key and the form threads the data source to it.
 * Importing `ObjectForm` pulls `@object-ui/fields` in, whose module body
 * registers every `field:*` widget — the ordinary route. The form hands a
 * field widget the data source of `SchemaRendererContext`, so the form is
 * mounted inside the provider, as the console mounts it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, fireEvent, cleanup, screen } from '@testing-library/react';
import React from 'react';
import { SchemaRendererProvider } from '@object-ui/react';

import { ObjectForm } from '../ObjectForm';

const GRANT = (widget?: string) => ({
  name: 'sys_user_position',
  fields: {
    position: {
      type: 'text',
      label: 'Position',
      required: true,
      maxLength: 100,
      ...(widget ? { widget } : {}),
    },
  },
});

function mount(objectSchema: unknown) {
  const ds = {
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    listMetadataItems: vi.fn(async (_type: string) => [
      { name: 'sales_rep', label: 'Sales Representative' },
      { name: 'sales_manager', label: 'Sales Manager' },
    ]),
    create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'g1', ...d })),
    update: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(async () => ({ data: [] })),
  };
  const view = render(
    <SchemaRendererProvider dataSource={ds as any}>
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'sys_user_position', mode: 'create' } as any}
        dataSource={ds as any}
      />
    </SchemaRendererProvider>,
  );
  return { ds, ...view };
}

afterEach(() => cleanup());

describe('ObjectForm — `widget: position-ref` lists the registry and saves a name (objectui#7611)', () => {
  it('lists the position registry and submits the picked NAME', async () => {
    const { ds, container } = mount(GRANT('position-ref'));

    const trigger = await screen.findByRole('combobox');
    await waitFor(() => expect(ds.listMetadataItems).toHaveBeenCalledWith('position'));
    expect(container.querySelector('input[name="position"]')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText('Sales Manager (sales_manager)'));
    await waitFor(() => expect(trigger).toHaveTextContent('Sales Manager (sales_manager)'));

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create.mock.calls[0][0]).toBe('sys_user_position');
    expect(ds.create.mock.calls[0][1]).toMatchObject({ position: 'sales_manager' });
  });

  it('CONTROL: the same field without the hint is the plain text box, and lists nothing', async () => {
    const { ds, container } = mount(GRANT());
    await waitFor(() => expect(container.querySelector('input[name="position"]')).not.toBeNull());
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(ds.listMetadataItems).not.toHaveBeenCalled();
  });
});
