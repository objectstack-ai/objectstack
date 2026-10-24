/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `form.sections[].group` on the record dialog — `ModalForm` rendered
 * DIRECTLY by a host (objectui#11542).
 *
 * ## The path these pins hold
 *
 * The console's More actions › Edit / New dialog and an action-opened modal do
 * not go through `ObjectForm`: `AppContent` and `useActionModal` in
 * `@object-ui/app-shell` mount `ModalForm` themselves and spread the object's
 * default form view into it through `resolveFormViewLayout`, which hands
 * `formView.sections` over exactly as authored (with `contentLayout: 'tabbed'`
 * for a tabbed view). `ObjectForm` resolves `{ group }` sections in
 * `withGroups`, above its routing fork, so its own modal route
 * (`formType: 'modal'`) was covered by objectui#7051 — but a host that skips
 * `ObjectForm` skipped that resolution too. A `{ group }` section reached
 * `ModalForm` with no `fields`, `buildSectionFields` built it an empty body,
 * and the empty-body filter dropped it: no tab, no stacked header, and the
 * group's fields had no editing surface in the dialog.
 *
 * `ModalForm` now resolves its own sections through the one resolver,
 * `resolveSectionGroupReferences`, against the object schema it already loads.
 * No assembly rule lives here or there; both reach `deriveFieldGroupLayout`.
 *
 * ## What discriminates
 *
 * The fixture declares TWO groups and references the SECOND one: a resolver
 * that answered every reference with the first group (the caricature
 * objectui#7051 measured) renders the wrong members, and the exclusivity
 * assertion catches it. The hand-enumerated sections are the control — green
 * before the fix and after it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { MePermissionsProvider } from '@object-ui/permissions';
import { ModalForm } from '../ModalForm';
import { resetSectionGroupReports } from '../sectionGroups';

registerAllFields();

// ─── Fixture: the hotcrm contact shape ────────────────────────────────────

/**
 * `marketing` is declared FIRST and `buying_centre` SECOND, and the form
 * references only the second. Distinct members per group, so a constant
 * resolution cannot satisfy the member assertions.
 */
const CONTACT = {
  name: 'contact',
  fieldGroups: [
    { key: 'marketing', label: 'Marketing' },
    { key: 'buying_centre', label: 'Buying Centre' },
  ],
  fields: {
    first_name: { type: 'text', label: 'First Name' },
    last_name: { type: 'text', label: 'Last Name' },
    email: { type: 'text', label: 'Email' },
    phone: { type: 'text', label: 'Phone' },
    campaign_source: { type: 'text', label: 'Campaign Source', group: 'marketing' },
    buying_role: { type: 'text', label: 'Buying Role', group: 'buying_centre' },
    influence: { type: 'text', label: 'Influence', group: 'buying_centre' },
    budget_owner: { type: 'text', label: 'Budget Owner', group: 'buying_centre' },
  },
};

const RECORD = {
  id: 'c1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
  phone: '555',
  buying_role: 'Economic buyer',
  influence: 'High',
  budget_owner: 'Yes',
};

/** Hand-enumerated sections beside one `{ group }` reference — the authored form view. */
const SECTIONS = [
  { name: 'identity', label: 'Identity', fields: ['first_name', 'last_name'] },
  { name: 'contact_info', label: 'Contact Info', fields: ['email', 'phone'] },
  { group: 'buying_centre', columns: 2 },
];

const makeDS = () => ({
  getObjectSchema: vi.fn().mockResolvedValue(CONTACT),
  findOne: vi.fn().mockResolvedValue({ ...RECORD }),
  find: vi.fn().mockResolvedValue({ data: [] }),
  create: vi.fn().mockResolvedValue({ id: 'c2' }),
  update: vi.fn().mockResolvedValue({ ...RECORD }),
});

type Mode = 'create' | 'edit';

/** The dialog the way `AppContent` mounts it: `ModalForm` itself, no `ObjectForm` above it. */
const modal = (mode: Mode, opts: { sections?: any[]; tabbed?: boolean; ds?: any } = {}) => (
  <ModalForm
    schema={{
      type: 'object-form',
      formType: 'modal',
      objectName: 'contact',
      mode,
      ...(mode === 'edit' ? { recordId: 'c1' } : {}),
      open: true,
      ...(opts.tabbed === false ? {} : { contentLayout: 'tabbed' as const }),
      sections: (opts.sections ?? SECTIONS) as any,
    }}
    dataSource={(opts.ds ?? makeDS()) as any}
  />
);

/** Wait until the form is drawn and, in edit mode, the record is on screen. */
async function formDrawn(mode: Mode): Promise<HTMLFormElement> {
  await waitFor(() => {
    const el = document.body.querySelector('input[name="first_name"]') as HTMLInputElement | null;
    if (!el) throw new Error('form not drawn yet');
    if (mode === 'edit' && el.value !== RECORD.first_name) throw new Error('record not on screen yet');
  });
  const forms = document.body.querySelectorAll('form');
  // ONE form for every section, the group's included (#2153 / #2959).
  expect(forms).toHaveLength(1);
  return forms[0] as HTMLFormElement;
}

/** The tab strip, in order: the key of every tab trigger. */
const tabKeys = () =>
  Array.from(document.body.querySelectorAll('[data-testid^="form-tab:"]')).map((el) =>
    (el.getAttribute('data-testid') as string).slice('form-tab:'.length),
  );

/** The field inputs a tab panel draws, in order. */
const panelInputs = (key: string) => {
  const panel = document.body.querySelector(`[data-testid="form-tab-panel:${key}"]`);
  if (!panel) return null;
  return Array.from(panel.querySelectorAll('input[name]')).map((el) => el.getAttribute('name'));
};

/** Stacked layout, in document order: `H:LABEL` per section header, `F:NAME` per input. */
function stackedOutline(form: HTMLElement): string[] {
  const out: string[] = [];
  form.querySelectorAll('input[name], .col-span-full').forEach((el) => {
    if (el.tagName === 'INPUT') out.push(`F:${el.getAttribute('name')}`);
    else if (el.classList.contains('border-b')) out.push(`H:${(el.textContent ?? '').trim()}`);
  });
  return out;
}

let uiErrors: string[] = [];
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetSectionGroupReports();
  uiErrors = [];
  // Only this repo's own diagnostics: React's act() advice also lands here.
  errSpy = vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    const s = args.map(String).join(' ');
    if (s.includes('[object-ui]')) uiErrors.push(s);
  });
});

afterEach(() => {
  errSpy.mockRestore();
  cleanup();
});

// ─── The tabbed dialog: New and Edit ──────────────────────────────────────

describe.each<Mode>(['create', 'edit'])(
  'objectui#11542 — the tabbed %s dialog (ModalForm mounted directly) draws a `{ group }` section',
  (mode) => {
    it("⭐ draws the group's tab, labelled by the group, holding exactly ITS members", async () => {
      render(modal(mode));
      await formDrawn(mode);

      // The hand-enumerated tabs stay where the author put them, and the
      // `{ group }` section is a tab of its own, in its authored position.
      expect(tabKeys()).toEqual(['identity', 'contact_info', 'buying_centre']);
      expect(screen.getByTestId('form-tab:buying_centre').textContent).toContain('Buying Centre');

      // Exactly the referenced group's members, in declared order — and not
      // the FIRST declared group's (`campaign_source`), which is what a
      // constant resolution would draw.
      expect(panelInputs('buying_centre')).toEqual(['buying_role', 'influence', 'budget_owner']);
      expect(document.body.querySelectorAll('input[name="campaign_source"]')).toHaveLength(0);
      expect(uiErrors).toEqual([]);
    });

    it('control: the hand-enumerated sections draw exactly their own members', async () => {
      render(modal(mode));
      await formDrawn(mode);
      expect(panelInputs('identity')).toEqual(['first_name', 'last_name']);
      expect(panelInputs('contact_info')).toEqual(['email', 'phone']);
    });
  },
);

describe('objectui#11542 — the group tab is a live part of the one form', () => {
  it('edit: the group fields carry the record values', async () => {
    render(modal('edit'));
    await formDrawn('edit');
    const value = (name: string) =>
      (document.body.querySelector(`input[name="${name}"]`) as HTMLInputElement).value;
    expect(value('buying_role')).toBe(RECORD.buying_role);
    expect(value('budget_owner')).toBe(RECORD.budget_owner);
  });

  it('create: a value typed on the group tab reaches the one create() payload', async () => {
    const ds = makeDS();
    render(modal('create', { ds }));
    const form = await formDrawn('create');
    fireEvent.click(screen.getByTestId('form-tab:buying_centre'));
    fireEvent.change(document.body.querySelector('input[name="buying_role"]') as HTMLInputElement, {
      target: { value: 'Champion' },
    });
    fireEvent.change(document.body.querySelector('input[name="first_name"]') as HTMLInputElement, {
      target: { value: 'Grace' },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.create.mock.calls[0][1]).toMatchObject({ first_name: 'Grace', buying_role: 'Champion' });
  });
});

// ─── The stacked arm: resolution is above the layout fork ─────────────────

describe('objectui#11542 — the stacked dialog (no contentLayout) draws the group section too', () => {
  it.each<Mode>(['create', 'edit'])('%s: a header labelled by the group, then exactly its members', async (mode) => {
    render(modal(mode, { tabbed: false }));
    const form = await formDrawn(mode);
    expect(tabKeys()).toEqual([]);
    expect(stackedOutline(form)).toEqual([
      'H:Identity',
      'F:first_name',
      'F:last_name',
      'H:Contact Info',
      'F:email',
      'F:phone',
      'H:Buying Centre',
      'F:buying_role',
      'F:influence',
      'F:budget_owner',
    ]);
  });
});

// ─── Field-level security reaches the fields a group brings in ────────────

/**
 * A group's members come from the object, not from the authored section, so
 * the fix must not open a path around the one field gate (`gateFormFields`).
 * `influence` is read-denied (never drawn); `budget_owner` is write-denied
 * (drawn, locked); `buying_role` is the lit control (drawn, live).
 */
const principal = {
  authenticated: true,
  userId: 'u-1',
  tenantId: null,
  roles: ['sales_rep'],
  permissionSets: ['sales_rep'],
  objects: { contact: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false } },
  fields: {
    'contact.influence': { readable: false, editable: false },
    'contact.budget_owner': { readable: true, editable: false },
  },
};

/** Every drawn field in a container → whether it is locked (kept no enabled control). */
function drawnIn(container: Element): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const item of container.querySelectorAll('[data-field]')) {
    out[item.getAttribute('data-field') as string] =
      item.querySelector('input:not([disabled]), textarea:not([disabled])') === null;
  }
  return out;
}

describe('objectui#11542 — FLS gates the fields a `{ group }` section brings in', () => {
  it.each<Mode>(['create', 'edit'])('%s: read-denied member is not drawn, write-denied member is locked', async (mode) => {
    render(<MePermissionsProvider initialPermissions={principal as any}>{modal(mode)}</MePermissionsProvider>);
    await formDrawn(mode);
    const panel = screen.getByTestId('form-tab-panel:buying_centre');
    expect(drawnIn(panel)).toEqual({ buying_role: false, budget_owner: true });
    expect(document.body.querySelectorAll('input[name="influence"]')).toHaveLength(0);
  });
});

// ─── The resolver's own verdicts reach this surface unchanged ─────────────

describe('objectui#11542 — an unknown group renders nothing and is reported once', () => {
  it('no tab, the siblings intact, one `form-section-group-unknown` report', async () => {
    render(modal('create', { sections: [...SECTIONS.slice(0, 2), { group: 'no_such_group' }] }));
    await formDrawn('create');
    expect(tabKeys()).toEqual(['identity', 'contact_info']);
    // Reported because the object schema the dialog loaded proves the key
    // resolves to nothing — a dialog that resolved with no object definition
    // would stay silent here.
    expect(uiErrors).toHaveLength(1);
    expect(uiErrors[0]).toContain('no_such_group');
    expect(uiErrors[0]).toContain('form-section-group-unknown');
  });
});
