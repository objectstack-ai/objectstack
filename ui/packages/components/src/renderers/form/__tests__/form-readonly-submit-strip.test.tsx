/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An edit form must not submit the fields it rendered read-only — objectui#3484.
 *
 * react-hook-form keeps a value for every registered field, so a form seeded
 * from a full record round-trips the WHOLE record on save. That included the
 * fields the form itself had just drawn as read-only text: the user had no way
 * to change them, the values sent were the ones already stored, and the server
 * dutifully stripped them and answered with `droppedFields` — which the console
 * turned into "some fields were not saved" on a save that lost nothing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module-scope import (not `beforeAll`) — objectui#3010.
import '../../../renderers';

function renderForm(schema: Record<string, unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(<Form schema={{ type: 'form', submitLabel: 'Save', ...schema }} />);
}

const FIELDS = [
  { name: 'title', label: 'Title', type: 'input' },
  { name: 'type', label: 'Type', type: 'input', readonlyWhen: "previous.status != 'draft'" },
  { name: 'source_method', label: 'Source', type: 'input', readonlyWhen: "record.status == 'closed'" },
  { name: 'status', label: 'Status', type: 'input' },
];

const RECORD = {
  title: 'Andon 001',
  type: 'quality_abnormal',
  source_method: 'qc_judgment',
  status: 'closed',
};

describe('form renderer — read-only fields are dropped from the submit payload (#3484)', () => {
  it('sends only the keys the user could actually edit', async () => {
    const onSubmit = vi.fn();
    renderForm({ fields: FIELDS, defaultValues: RECORD, previousValues: RECORD, onSubmit });

    fireEvent.change(screen.getByLabelText(/^Title$/), { target: { value: 'Andon 002' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;

    // Both locked fields are gone — the `previous.*` one and the `record.*` one.
    expect(Object.keys(payload).sort()).toEqual(['status', 'title']);
    expect(payload.title).toBe('Andon 002');
  });

  it('keeps a field whose lock predicate is FALSE for this record', async () => {
    const onSubmit = vi.fn();
    const unlocked = { ...RECORD, status: 'draft' };
    renderForm({ fields: FIELDS, defaultValues: unlocked, previousValues: unlocked, onSubmit });

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['source_method', 'status', 'title', 'type']);
  });

  it('does NOT strip on a create (no previousValues) — objectql exempts INSERT', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        { name: 'title', label: 'Title', type: 'input' },
        { name: 'code', label: 'Code', type: 'input', readonlyWhen: "record.status == 'closed'" },
        { name: 'status', label: 'Status', type: 'input' },
      ],
      defaultValues: { title: 'New', code: 'AUTO-1', status: 'closed' },
      onSubmit,
    });

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // Making the client stricter than the server here would silently lose an
    // authored default on every create.
    expect(onSubmit.mock.calls[0][0]).toHaveProperty('code', 'AUTO-1');
  });

  it('also drops a statically read-only field on an edit', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        { name: 'title', label: 'Title', type: 'input' },
        { name: 'serial', label: 'Serial', type: 'input', readonly: true },
      ],
      defaultValues: { title: 'A', serial: 'S-1' },
      previousValues: { title: 'A', serial: 'S-1' },
      onSubmit,
    });

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('serial');
  });
});
