/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13130 — the record Create/Edit dialog opens with focus on its first
 * editable field, not on its Close button.
 *
 * THE PRODUCER. Radix's focus scope puts focus on the first tabbable element
 * of the dialog the moment the content MOUNTS. `MobileDialogContent` draws its
 * Close button AFTER its children, so DOM order is not why Close won: at mount
 * `ModalForm`'s body is still its loading skeleton (the object schema, and on
 * edit the record, are read after the dialog opens; the field widgets are
 * `React.lazy` on top of that), and the footer is not drawn until the load
 * ends. Close was the only tabbable element in the dialog, so it took focus,
 * and kept it once the fields arrived.
 *
 * THE FIX lives in `ModalForm` (the host of `MobileDialogContent`, through its
 * `onOpenAutoFocus`), not in the `ui/` primitive: the dialog takes focus
 * itself while its body loads, and moves it to the first editable field when
 * that field lands, unless the user has moved focus in the meantime.
 *
 * Driven through `ObjectForm` (the `object-form` renderer) the way the other
 * modal pins are, with the real field widgets.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { ObjectForm } from '../ObjectForm';
import { findFirstEditableField } from '../initialFieldFocus';

registerAllFields();
afterEach(() => cleanup());

const LEAD = {
  name: 'lead',
  fields: {
    first_name: { type: 'text', label: 'First Name' },
    company: { type: 'text', label: 'Company' },
  },
};

type ObjectFormNode = React.ComponentProps<typeof ObjectForm>['schema'];

function dataSource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(LEAD),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn().mockResolvedValue({ id: 'L1', first_name: 'Ada', company: 'Acme' }),
    create: vi.fn(),
    update: vi.fn(),
    ...overrides,
  } as unknown as DataSource;
}

function renderModal(extra: Record<string, unknown>, ds: DataSource = dataSource()) {
  return render(
    <ObjectForm
      schema={{
        type: 'object-form',
        objectName: 'lead',
        mode: 'create',
        formType: 'modal',
        title: 'New lead',
        ...extra,
      } as unknown as ObjectFormNode}
      dataSource={ds}
    />,
  );
}

const closeButton = () => screen.getByRole('button', { name: /close/i });

describe('the record dialog opens on its first editable field, not on Close (objectui#13130)', () => {
  it('create: focus lands on the first field once the body has loaded', async () => {
    renderModal({});
    const first = await screen.findByLabelText('First Name');
    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(document.activeElement).not.toBe(closeButton());
  });

  it('edit: focus lands on the first field once the record has loaded', async () => {
    renderModal({ mode: 'edit', recordId: 'L1', title: 'Edit lead' });
    const first = await screen.findByLabelText('First Name');
    await waitFor(() => expect((first as HTMLInputElement).value).toBe('Ada'));
    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(document.activeElement).not.toBe(closeButton());
  });

  it('while the body loads, the dialog itself holds focus (named by its title), not Close', async () => {
    let releaseSchema: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => { releaseSchema = resolve; });
    renderModal({}, dataSource({ getObjectSchema: vi.fn().mockReturnValue(pending) }));
    const dialog = await screen.findByRole('dialog');
    expect(screen.getByTestId('modal-form-skeleton')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(document.activeElement).not.toBe(closeButton());
    // Then the body lands, and focus moves in.
    await act(async () => { releaseSchema(LEAD); });
    const first = await screen.findByLabelText('First Name');
    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it('does not take focus back from the user: a control focused while the body loads keeps it', async () => {
    let releaseSchema: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => { releaseSchema = resolve; });
    renderModal({}, dataSource({ getObjectSchema: vi.fn().mockReturnValue(pending) }));
    await screen.findByRole('dialog');
    // The user tabs to Close before the fields arrive.
    act(() => closeButton().focus());
    expect(document.activeElement).toBe(closeButton());
    await act(async () => { releaseSchema(LEAD); });
    await screen.findByLabelText('First Name');
    // Let any late observer callback run before reading focus.
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(document.activeElement).toBe(closeButton());
  });

  it('skips a field the user cannot edit: a read-only first field leaves focus to the next one', async () => {
    const ds = dataSource({
      getObjectSchema: vi.fn().mockResolvedValue({
        name: 'lead',
        fields: {
          first_name: { type: 'text', label: 'First Name', readonly: true },
          company: { type: 'text', label: 'Company' },
        },
      }),
    });
    renderModal({}, ds);
    const company = await screen.findByLabelText('Company');
    await waitFor(() => expect(document.activeElement).toBe(company));
  });

  it('the subforms (master-detail) arm opens on its first header field too', async () => {
    // The child object answers with its own schema, so the line-items grid
    // draws no input a "First Name" query could also match.
    const LINE = { name: 'lead_line', fields: { qty: { type: 'number', label: 'Qty' } } };
    const ds = dataSource({
      getObjectSchema: vi.fn((name: string) => Promise.resolve(name === 'lead_line' ? LINE : LEAD)),
    });
    renderModal({ subforms: [{ childObject: 'lead_line', relationshipField: 'lead' }] }, ds);
    const first = await screen.findByLabelText('First Name');
    expect(first.closest('[data-field]')?.getAttribute('data-field')).toBe('first_name');
    await waitFor(() => expect(document.activeElement).toBe(first));
  });
});

describe('findFirstEditableField (objectui#13130)', () => {
  function root(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }
  afterEach(() => { document.body.innerHTML = ''; });

  it('answers null while no field row is drawn (the body is loading)', () => {
    expect(findFirstEditableField(root('<div data-testid="modal-form-skeleton"></div><button>Close</button>'))).toBeNull();
  });

  it('reads field rows only: a control outside a row (Close, a tab trigger) is never the answer', () => {
    const r = root('<button id="close">Close</button><div data-field="a"><input id="a" /></div>');
    expect(findFirstEditableField(r)?.id).toBe('a');
  });

  it('skips disabled, read-only and aria-read-only controls', () => {
    const r = root(
      '<div data-field="a"><input id="a" disabled /></div>' +
      '<div data-field="b"><textarea id="b" readonly></textarea></div>' +
      '<div data-field="c"><button id="c" role="combobox" aria-readonly="true">x</button></div>' +
      '<div data-field="d"><button id="d" role="combobox">pick</button></div>',
    );
    expect(findFirstEditableField(r)?.id).toBe('d');
  });

  it('skips a field on an inactive tab panel (kept mounted, hidden by class)', () => {
    const r = root(
      '<div role="tabpanel" data-state="inactive"><div data-field="a"><input id="a" /></div></div>' +
      '<div role="tabpanel" data-state="active"><div data-field="b"><input id="b" /></div></div>',
    );
    expect(findFirstEditableField(r)?.id).toBe('b');
  });

  it('answers null when no field is editable (a view-mode form)', () => {
    expect(findFirstEditableField(root('<div data-field="a"><span>Ada</span></div>'))).toBeNull();
  });
});
