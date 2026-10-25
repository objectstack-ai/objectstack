// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11820 — a new hook made from a package object targets that object,
 * and its target picker knows which objects are this package's.
 *
 * End to end through the panel: "New" saves a hook whose `object` is the
 * object the panel is open on (never `*`), and the curated hook editor it opens
 * splits the target list into this package's objects — the package's own list,
 * published and draft, read by the panel — and every other object, other
 * packages' and the platform's `sys_*` alike, under a heading with the reach
 * warning.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

const PACKAGE = 'com.example.invoicing';

const state = vi.hoisted(() => ({ hooks: [] as Array<Record<string, unknown>> }));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string, opts?: { packageId?: string }) => {
    if (type === 'hook') return state.hooks;
    if (type === 'object' && opts?.packageId) {
      // The package's published objects (the server's package filter).
      return [
        { name: 'invoice', label: 'Invoice', _packageId: 'com.example.invoicing' },
        { name: 'invoice_line', label: 'Invoice line', _packageId: 'com.example.invoicing' },
      ];
    }
    // The whole catalog the picker lists.
    return [
      { name: 'invoice', label: 'Invoice' },
      { name: 'invoice_line', label: 'Invoice line' },
      { name: 'hr_employee', label: 'Employee' },
      { name: 'sys_user', label: 'User', isSystem: true },
    ];
  }),
  listDrafts: vi.fn(async (opts?: { type?: string }) =>
    // A draft-only object of this package belongs to it too.
    opts?.type === 'object' ? [{ name: 'invoice_credit', packageId: 'com.example.invoicing' }] : [],
  ),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  withPreviewDrafts() { return this; },
  save: vi.fn(async (_type: string, _name: string, body: Record<string, unknown>) => {
    state.hooks = [...state.hooks, body];
    return {};
  }),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient };
});

import { ObjectHooksPanel } from './ObjectHooksPanel';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';

registerBuiltinInspectors();

afterEach(() => {
  cleanup();
  state.hooks = [];
  vi.clearAllMocks();
});

describe('ObjectHooksPanel — a new hook (objectui#11820)', () => {
  it('targets the object it is created from, never every object', async () => {
    render(<ObjectHooksPanel objectName="invoice" packageId={PACKAGE} />);
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1));
    const [type, , body, opts] = mockClient.save.mock.calls[0] as unknown as [string, string, Record<string, unknown>, Record<string, unknown>];
    expect(type).toBe('hook');
    expect(body.object).toBe('invoice');
    expect(opts).toMatchObject({ mode: 'draft', packageId: PACKAGE });
  });

  it('opens with this package’s objects first and every other object under the reach warning', async () => {
    render(<ObjectHooksPanel objectName="invoice" packageId={PACKAGE} />);
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1));

    // Two reads answer at their own pace (objectui#11978): the panel's read of
    // this package's objects draws the "This package" group, and the editor's
    // own read of the object roster draws the labels and the "Other objects"
    // group. Until the roster answers, the selected object is drawn by its
    // bare name — deliberately, it asserts nothing (objectui#10585) — so the
    // group can be on screen while its checkbox is still named `invoice`.
    // Every read below whose answer the roster draws waits for it.
    const own = await screen.findByRole('group', { name: 'This package' });
    expect(await within(own).findByRole('checkbox', { name: 'Invoice (invoice)' })).toBeChecked();
    expect(await within(own).findByRole('checkbox', { name: 'Invoice line (invoice_line)' })).toBeInTheDocument();

    const outside = await screen.findByRole('group', { name: 'Other objects' });
    expect(within(outside).getByTestId('hook-object-outside-reach')).toBeInTheDocument();
    expect(await within(outside).findByRole('checkbox', { name: 'User (sys_user)' })).not.toBeChecked();
    expect(await within(outside).findByRole('checkbox', { name: 'Employee (hr_employee)' })).toBeInTheDocument();

    // The package's list was read for THIS package, published and draft.
    expect(mockClient.list).toHaveBeenCalledWith('object', { packageId: PACKAGE });
    expect(mockClient.listDrafts).toHaveBeenCalledWith({ packageId: PACKAGE, type: 'object' });
  });
});
