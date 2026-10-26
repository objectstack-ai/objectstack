/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A no-sections overlay form honours the object's declared `fieldGroups` —
 * objectui#4774.
 *
 * `ObjectForm` (ObjectForm.tsx) and `ModalForm` both upgrade their flat field
 * list into one section per declared group via `deriveFieldGroupSections`.
 * `DrawerForm` never called it — the whole repo had exactly two call sites — so
 * the same object rendered grouped in the modal create dialog and as one
 * ungrouped flat list in the drawer. PR #4775 gave the drawer's runtime fields
 * their `group` key; this table pins the call site that consumes it.
 *
 * Both containers are driven as ONE table, deliberately (same pattern as
 * `flatFieldRules.test.tsx`): the modal rows are the non-regression half, the
 * drawer rows are the fix. A future re-fork of either container's fallback
 * shows up as one container's rows going red while the other's stay green.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';

registerAllFields();

/**
 * A ticket whose four fields opt into two declared groups.
 *
 * NB: none of them is named `owner` / `created_by` etc. — those are dropped as
 * system fields by the auto-layout filters the fallback runs first, so a
 * grouped section naming one would render short of what it declares.
 */
const GROUPED_SCHEMA = {
  name: 'ticket',
  fieldGroups: [
    { key: 'basic', label: 'Basic Info' },
    { key: 'tracking', label: 'Tracking Info' },
  ],
  fields: {
    title: { type: 'text', label: 'Title', group: 'basic' },
    assignee: { type: 'text', label: 'Assignee', group: 'basic' },
    status_note: { type: 'text', label: 'Status Note', group: 'tracking' },
    channel: { type: 'text', label: 'Channel', group: 'tracking' },
  },
};

/** Same object, same declared groups — but no field opts in. */
const UNGROUPED_SCHEMA = {
  ...GROUPED_SCHEMA,
  fields: {
    title: { type: 'text', label: 'Title' },
    assignee: { type: 'text', label: 'Assignee' },
    status_note: { type: 'text', label: 'Status Note' },
    channel: { type: 'text', label: 'Channel' },
  },
};

const makeDS = (objectSchema: any = GROUPED_SCHEMA) =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    create: vi.fn().mockResolvedValue({ id: 't1' }),
    update: vi.fn().mockResolvedValue({ id: 't1' }),
    findOne: vi.fn().mockResolvedValue({ id: 't1' }),
  }) as any;

const inputNamed = (name: string) =>
  document.body.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

const CONTAINERS: Array<[string, React.ComponentType<any>, string]> = [
  ['ModalForm', ModalForm as any, 'modal'],
  ['DrawerForm', DrawerForm as any, 'drawer'],
];

describe.each(CONTAINERS)('%s — fieldGroups fallback (#4774)', (_name, Container, formType) => {
  /** No `sections`, no `customFields` — the group fallback is the only producer. */
  const renderForm = (ds: any, extra: Record<string, unknown> = {}) =>
    render(
      <Container
        schema={{
          type: 'object-form',
          formType,
          objectName: 'ticket',
          mode: 'create',
          open: true,
          ...extra,
        } as any}
        dataSource={ds}
      />,
    );

  it('renders one header per declared group inside a SINGLE form', async () => {
    renderForm(makeDS());

    await waitFor(() => {
      expect(document.body.textContent).toContain('Basic Info');
      expect(document.body.textContent).toContain('Tracking Info');
    });

    // The whole grouped layout must live in ONE form element — one shared
    // react-hook-form instance, one submit target for the footer button.
    // (Rendering a form per group is the #2153/#2959 defect: the footer button,
    // bound by `form={formId}`, reaches only the first one.)
    const forms = document.body.querySelectorAll('form');
    expect(forms.length).toBe(1);
    expect(forms[0].textContent).toContain('Basic Info');
    expect(forms[0].textContent).toContain('Tracking Info');
    expect(forms[0].querySelectorAll('input').length).toBe(4);

    // The flat path's column inference survives the upgrade: 4 fields → a
    // 2-column container grid, not a single-column stack.
    expect(forms[0].querySelector('[class*="@md:grid-cols-2"]')).not.toBeNull();
  });

  it('submits values from EVERY group in one create() payload', async () => {
    const ds = makeDS();
    renderForm(ds);
    await waitFor(() => expect(document.body.textContent).toContain('Tracking Info'));

    fireEvent.change(inputNamed('title')!, { target: { value: 'Broken login' } });
    fireEvent.change(inputNamed('status_note')!, { target: { value: 'escalated' } });

    fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create).toHaveBeenCalledWith(
      'ticket',
      expect.objectContaining({ title: 'Broken login', status_note: 'escalated' }),
    );
  });

  it('falls back to the flat list when no rendered field opts into a group', async () => {
    renderForm(makeDS(UNGROUPED_SCHEMA));

    // Every field still renders — the fallback is skipped, not the form.
    await waitFor(() => expect(inputNamed('title')).not.toBeNull());
    expect(document.body.querySelectorAll('form input').length).toBe(4);
    // …and no group header is invented for fields that never joined a group.
    expect(document.body.textContent).not.toContain('Basic Info');
    expect(document.body.textContent).not.toContain('Tracking Info');
  });

  it('lets explicit curated sections win over the derived groups', async () => {
    renderForm(makeDS(), {
      sections: [{ name: 'curated', label: 'Curated Section', fields: ['title'] }],
    });

    await waitFor(() => expect(document.body.textContent).toContain('Curated Section'));
    expect(document.body.textContent).not.toContain('Basic Info');
    expect(document.body.textContent).not.toContain('Tracking Info');
    // Only the curated field — the fallback did not smuggle the rest back in.
    expect(document.body.querySelectorAll('form input').length).toBe(1);
  });
});

/**
 * Drawer-only: the drawer's section render path already implements collapsible
 * headers, and `deriveFieldGroupSections` already maps ADR-0085's `collapse`
 * enum onto that flag pair — so a derived group carrying it must behave like an
 * authored collapsible section rather than silently ignoring the metadata.
 * (ModalForm's derived branch renders static headers; not a regression this
 * card introduces, and reported as an out-of-scope observation.)
 */
describe('DrawerForm — a derived group honours its declared collapse state (#4774)', () => {
  const COLLAPSED_SCHEMA = {
    ...GROUPED_SCHEMA,
    fieldGroups: [
      { key: 'basic', label: 'Basic Info' },
      { key: 'tracking', label: 'Tracking Info', collapse: 'collapsed' },
    ],
  };

  const renderDrawer = () =>
    render(
      <DrawerForm
        schema={{
          type: 'object-form',
          formType: 'drawer',
          objectName: 'ticket',
          mode: 'create',
          open: true,
        } as any}
        dataSource={makeDS(COLLAPSED_SCHEMA)}
      />,
    );

  it('starts the collapsed group closed and opens it on click', async () => {
    renderDrawer();
    await waitFor(() => expect(document.body.textContent).toContain('Tracking Info'));

    // Header present, body excluded from the DOM.
    const header = await screen.findByRole('button', { expanded: false });
    expect(header.textContent).toContain('Tracking Info');
    expect(inputNamed('status_note')).toBeNull();
    // The expanded group is unaffected.
    expect(inputNamed('title')).not.toBeNull();

    fireEvent.click(header);

    await waitFor(() => expect(inputNamed('status_note')).not.toBeNull());
  });
});
