/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A sectioned create/edit form must keep EVERY section's input (#2153, #2959).
 *
 * The explicit-`sections` path used to render one SchemaRenderer — i.e. one
 * react-hook-form instance and one `<form>` element — PER section, all sharing
 * the same `formId`. Two independent failures followed:
 *
 *  1. the footer submit button (`form={formId}`) can only be associated with the
 *     FIRST of those forms, so section 2+ never reached the payload; and
 *  2. in the `tabbed` variant Radix unmounted the inactive panel, destroying
 *     that tab's form state outright — so the reported HotCRM flow (fill tab 1,
 *     submit, server rejects a required field on tab 3, fill tab 3, submit
 *     again) came back with EVERY earlier value missing.
 *
 * These tests pin the contract that fixes both: one `<form>` for all sections,
 * with the tab panels force-mounted so a tab the user left keeps its values AND
 * its validation.
 *
 * `split` is the same defect in a different layout: its two resizable panels
 * each held their own `<form>`, so submitting from one panel's action bar
 * dropped everything typed in the other and no condition could see across the
 * divider. (The split form retired with ADR-0050, and its pins with it.)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from './ModalForm';
import { TabbedForm } from './TabbedForm';

registerAllFields();

const makeDataSource = () => ({
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'case',
    fields: {
      subject: { type: 'text', label: 'Subject' },
      status: { type: 'text', label: 'Status' },
      priority: { type: 'text', label: 'Priority' },
      // The field that made the reported flow destructive: required, and parked
      // on the last tab.
      description: { type: 'text', label: 'Description', required: true },
    },
  }),
  create: vi.fn().mockResolvedValue({ id: 'case-1' }),
  update: vi.fn(),
  findOne: vi.fn(),
});

const SECTIONS = [
  { name: 'basics', label: 'Basics', fields: ['subject'] },
  { name: 'triage', label: 'Triage', fields: ['status', 'priority'] },
  { name: 'detail', label: 'Detail', fields: ['description'] },
];

/** Type into a field by its metadata locator, wherever it is laid out. */
const fill = (name: string, value: string) => {
  const input = document.body.querySelector<HTMLInputElement>(`[data-field="${name}"] input`);
  if (!input) throw new Error(`field not rendered: ${name}`);
  fireEvent.change(input, { target: { value } });
};

const valueOf = (name: string) =>
  document.body.querySelector<HTMLInputElement>(`[data-field="${name}"] input`)?.value;

const tab = (label: string) => screen.getByRole('tab', { name: new RegExp(label) });

const submitForm = () => {
  const form = document.body.querySelector('form');
  if (!form) throw new Error('no <form> rendered');
  // The footer button is associated by `form={formId}`; submitting the form
  // element directly exercises the same handler without depending on the DOM
  // implementation's support for out-of-form submit buttons.
  fireEvent.submit(form);
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ModalForm tabbed sections — per-tab form state (#2959)', () => {
  it('submits every tab’s values after the user moves between tabs', async () => {
    const dataSource = makeDataSource();
    render(
      <ModalForm
        schema={{
          type: 'object-form',
          formType: 'modal',
          objectName: 'case',
          mode: 'create',
          title: 'New Case',
          contentLayout: 'tabbed',
          sections: SECTIONS,
        }}
        dataSource={dataSource as any}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('modal-form-footer')).toBeTruthy());
    // The footer is drawn while the body still waits on a field widget's code
    // (objectui#12559: the dialog owns that wait), so the form is read once
    // the body's placeholder has gone.
    await waitFor(() => expect(screen.queryByTestId('modal-form-body-pending')).toBeNull());

    // ONE form for all three sections — the shared-`formId` duplicate <form>
    // elements are what stranded section 2+ outside the submit (#2153).
    expect(document.body.querySelectorAll('form')).toHaveLength(1);

    // Fill tab 1, walk to the last tab, fill it there.
    fill('subject', 'Printer on fire');
    fireEvent.click(tab('Triage'));
    fill('status', 'open');
    fill('priority', 'high');
    fireEvent.click(tab('Detail'));
    fill('description', 'Smoke coming out of tray 2');

    submitForm();

    await waitFor(() => expect(dataSource.create).toHaveBeenCalledTimes(1));
    expect(dataSource.create.mock.calls[0][1]).toMatchObject({
      subject: 'Printer on fire',
      status: 'open',
      priority: 'high',
      description: 'Smoke coming out of tray 2',
    });
  });

  it('keeps a tab’s input when the user leaves and comes back', async () => {
    render(
      <ModalForm
        schema={{
          type: 'object-form',
          formType: 'modal',
          objectName: 'case',
          mode: 'create',
          contentLayout: 'tabbed',
          sections: SECTIONS,
        }}
        dataSource={makeDataSource() as any}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('modal-form-footer')).toBeTruthy());

    fill('subject', 'Kept across tabs');
    fireEvent.click(tab('Triage'));
    fireEvent.click(tab('Basics'));

    // Radix used to unmount the inactive panel, which reset the field to its
    // defaultValue on the way back.
    expect(valueOf('subject')).toBe('Kept across tabs');
  });

  it('blocks the submit and activates the tab holding a missing required field', async () => {
    const dataSource = makeDataSource();
    render(
      <ModalForm
        schema={{
          type: 'object-form',
          formType: 'modal',
          objectName: 'case',
          mode: 'create',
          contentLayout: 'tabbed',
          sections: SECTIONS,
        }}
        dataSource={dataSource as any}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('modal-form-footer')).toBeTruthy());

    // Only tab 1 is filled; `description` (tab 3) is required and empty. An
    // unmounted field is skipped by react-hook-form, so this used to reach the
    // server and come back as a 400 that named no tab.
    fill('subject', 'Only the first tab');
    submitForm();

    await waitFor(() => expect(tab('Detail')).toHaveAttribute('data-state', 'active'));
    expect(dataSource.create).not.toHaveBeenCalled();
    // The offending tab is marked, so the failure is discoverable from any tab.
    expect(tab('Detail')).toHaveAttribute('data-error', 'true');
    expect(tab('Basics')).not.toHaveAttribute('data-error');
  });
});

describe('ModalForm stacked sections — one form for all sections (#2153)', () => {
  it('submits the 2nd+ section’s values', async () => {
    const dataSource = makeDataSource();
    render(
      <ModalForm
        schema={{
          type: 'object-form',
          formType: 'modal',
          objectName: 'case',
          mode: 'create',
          sections: SECTIONS,
        }}
        dataSource={dataSource as any}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('modal-form-footer')).toBeTruthy());
    expect(document.body.querySelectorAll('form')).toHaveLength(1);

    fill('subject', 'S1');
    fill('status', 'S2-status');
    fill('priority', 'S2-priority');
    fill('description', 'S3');

    submitForm();

    await waitFor(() => expect(dataSource.create).toHaveBeenCalledTimes(1));
    expect(dataSource.create.mock.calls[0][1]).toMatchObject({
      subject: 'S1',
      status: 'S2-status',
      priority: 'S2-priority',
      description: 'S3',
    });
  });

  it('renders each section’s header and description inline', async () => {
    render(
      <ModalForm
        schema={{
          type: 'object-form',
          formType: 'modal',
          objectName: 'case',
          mode: 'create',
          sections: [
            { name: 'basics', label: 'Basics', description: 'Who is asking', fields: ['subject'] },
            { name: 'triage', label: 'Triage', fields: ['status'] },
          ],
        }}
        dataSource={makeDataSource() as any}
      />,
    );

    expect(await screen.findByText('Basics')).toBeTruthy();
    expect(screen.getByText('Triage')).toBeTruthy();
    // A section's authored blurb survives the move to inline headers.
    expect(screen.getByText('Who is asking')).toBeTruthy();
  });
});

describe('TabbedForm — one form for all tabs (#2959)', () => {
  it('submits every tab’s values after the user moves between tabs', async () => {
    const dataSource = makeDataSource();
    render(
      <TabbedForm
        schema={{
          type: 'object-form',
          formType: 'tabbed',
          objectName: 'case',
          mode: 'create',
          sections: SECTIONS,
        }}
        dataSource={dataSource as any}
      />,
    );

    await waitFor(() => expect(document.body.querySelector('form')).toBeTruthy());
    expect(document.body.querySelectorAll('form')).toHaveLength(1);

    fill('subject', 'T1');
    fireEvent.click(tab('Triage'));
    fill('status', 'T2');
    fireEvent.click(tab('Detail'));
    fill('description', 'T3');

    submitForm();

    await waitFor(() => expect(dataSource.create).toHaveBeenCalledTimes(1));
    expect(dataSource.create.mock.calls[0][1]).toMatchObject({
      subject: 'T1',
      status: 'T2',
      description: 'T3',
    });
  });
});
