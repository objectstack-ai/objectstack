/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-form`'s `modalCloseButton` takes effect (objectui#11061).
 *
 * The key was declared on `ObjectFormSchema` and the `object-form`
 * registration and forwarded by `ObjectForm`'s modal route, but `ModalForm`
 * never read it: `modalCloseButton: false` still drew the dialog's X. Now
 * `ModalForm` passes `modalCloseButton !== false` to `MobileDialogContent`'s
 * `showCloseButton` on both of its dialog arms, the flat form and the
 * `subforms` master-detail form.
 *
 * Driven through `ObjectForm` (the `object-form` renderer), so the forwarding
 * hop is inside the pin. The default rows are the control: the same query
 * finds the button when the key is unset or `true`.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { ObjectForm } from '../ObjectForm';

registerAllFields();
afterEach(() => cleanup());

const DEAL_SCHEMA = { name: 'deal', fields: { name: { type: 'text', label: 'Name' } } };

function dataSource() {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(DEAL_SCHEMA),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  } as unknown as DataSource;
}

type ObjectFormNode = React.ComponentProps<typeof ObjectForm>['schema'];

async function renderModal(extra: Record<string, unknown>) {
  const onOpenChange = vi.fn();
  const onCancel = vi.fn();
  render(
    <ObjectForm
      schema={{
        type: 'object-form',
        objectName: 'deal',
        mode: 'create',
        formType: 'modal',
        title: 'New deal',
        onOpenChange,
        onCancel,
        ...extra,
      } as unknown as ObjectFormNode}
      dataSource={dataSource()}
    />,
  );
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  return { onOpenChange, onCancel };
}

/** The flat arm has finished loading once its field and footer are drawn. */
async function flatFormLoaded() {
  await waitFor(() => expect(screen.getByText('Name')).toBeTruthy());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy());
}

const closeButton = () => screen.queryByRole('button', { name: /close/i });

describe('ModalForm honours modalCloseButton (objectui#11061)', () => {
  it('keeps the close button by default', async () => {
    await renderModal({});
    await flatFormLoaded();
    expect(closeButton()).not.toBeNull();
  });

  it('keeps the close button when modalCloseButton is true', async () => {
    await renderModal({ modalCloseButton: true });
    await flatFormLoaded();
    expect(closeButton()).not.toBeNull();
  });

  it('has no close button when modalCloseButton is false', async () => {
    await renderModal({ modalCloseButton: false });
    await flatFormLoaded();
    expect(closeButton()).toBeNull();
  });

  it('still closes on Escape with the close button hidden', async () => {
    const { onOpenChange } = await renderModal({ modalCloseButton: false });
    await flatFormLoaded();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('still closes on Cancel with the close button hidden', async () => {
    const { onOpenChange, onCancel } = await renderModal({ modalCloseButton: false });
    await flatFormLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  describe('the subforms (master-detail) arm', () => {
    const subforms = [{ childObject: 'deal_line', relationshipField: 'deal' }];

    it('keeps the close button by default', async () => {
      await renderModal({ subforms });
      expect(closeButton()).not.toBeNull();
    });

    it('has no close button when modalCloseButton is false, and still closes on Escape', async () => {
      const { onOpenChange } = await renderModal({ subforms, modalCloseButton: false });
      expect(closeButton()).toBeNull();
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
