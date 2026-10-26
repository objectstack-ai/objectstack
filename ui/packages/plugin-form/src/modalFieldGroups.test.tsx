/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ModalForm — object `fieldGroups` fallback (designer metadata).
 *
 * When the caller passes no explicit sections, the modal create/edit form must
 * honor the object's declared `fieldGroups` (fields opt in via `field.group`),
 * matching ObjectForm's grouped path.
 *
 * CRITICAL STRUCTURAL CONTRACT — one <form>, not one per group. Rendering each
 * group as its own SchemaRenderer creates N <form> elements (each with its own
 * react-hook-form instance) sharing the footer button's `form` id; the button
 * then submits only the FIRST form, silently dropping every later group's
 * values (empirically: a required field in group 2 showed a value in the UI
 * but the POST payload omitted it → VALIDATION_FAILED). These tests pin:
 *   1. group headers render from fieldGroups metadata,
 *   2. exactly ONE <form> element hosts all groups,
 *   3. submit delivers values from EVERY group in a single create() payload.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from './ModalForm';

registerAllFields();

const ds: any = {
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'ticket',
    fieldGroups: [
      { key: 'basic', label: 'Basic Info' },
      { key: 'tracking', label: 'Tracking Info' },
    ],
    fields: {
      title: { type: 'text', label: 'Title', group: 'basic' },
      // NB: not named `owner`/`created_by` etc. — those are filtered as
      // system fields by the create-mode auto-layout.
      assignee: { type: 'text', label: 'Assignee', group: 'basic' },
      status_note: { type: 'text', label: 'Status Note', group: 'tracking' },
      channel: { type: 'text', label: 'Channel', group: 'tracking' },
    },
  }),
  create: vi.fn().mockResolvedValue({ id: '1' }),
  update: vi.fn(),
  findOne: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

const renderModal = () =>
  render(
    <ModalForm
      schema={{
        type: 'object-form',
        formType: 'modal',
        objectName: 'ticket',
        mode: 'create',
        open: true,
      } as any}
      dataSource={ds}
    />,
  );

describe('ModalForm fieldGroups fallback', () => {
  it('renders one section header per declared group, inside a SINGLE <form>', async () => {
    renderModal();

    await waitFor(() => {
      expect(document.body.textContent).toContain('Basic Info');
      expect(document.body.textContent).toContain('Tracking Info');
    });

    // The whole grouped layout must live in ONE form element — one shared
    // react-hook-form instance, one submit target for the footer button.
    const forms = document.querySelectorAll('form');
    expect(forms.length).toBe(1);

    // Both group headers are INSIDE that form (virtual section-divider fields),
    // and all four inputs share it.
    expect(forms[0].textContent).toContain('Basic Info');
    expect(forms[0].textContent).toContain('Tracking Info');
    expect(forms[0].querySelectorAll('input').length).toBe(4);

    // 4 input fields → 2-column auto-layout threaded onto the field container.
    expect(forms[0].querySelector('[class*="@md:grid-cols-2"]')).not.toBeNull();
  });

  it('submits values from EVERY group in a single create() payload', async () => {
    renderModal();
    await waitFor(() => expect(document.body.textContent).toContain('Tracking Info'));

    // Fill one field in group 1 and one in group 2.
    const byName = (name: string) =>
      document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
    fireEvent.change(byName('title'), { target: { value: 'Broken login' } });
    fireEvent.change(byName('status_note'), { target: { value: 'escalated' } });

    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create).toHaveBeenCalledWith(
      'ticket',
      expect.objectContaining({ title: 'Broken login', status_note: 'escalated' }),
    );
  });

  it('explicit curated sections still win over the fieldGroups fallback', async () => {
    render(
      <ModalForm
        schema={{
          type: 'object-form',
          formType: 'modal',
          objectName: 'ticket',
          mode: 'create',
          open: true,
          sections: [{ name: 'curated', label: 'Curated Section', fields: ['title'] }],
        } as any}
        dataSource={ds}
      />,
    );

    await waitFor(() => expect(document.body.textContent).toContain('Curated Section'));
    // The fallback must not add the group headers alongside the curated view.
    expect(document.body.textContent).not.toContain('Basic Info');
    expect(document.body.textContent).not.toContain('Tracking Info');
  });
});
