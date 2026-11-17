// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34795 — the package's "who can see which records" overview names
 * each object by its label alone; the machine name is the label's tooltip, so
 * an app builder never reads `crm_account` in the row and can still find it.
 *
 * Drives the REAL panel against a fake metadata client (the shape the
 * panel's own suite uses), in zh-CN.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel';

const OBJECTS: Record<string, Record<string, unknown>> = {
  crm_account: { name: 'crm_account', label: '客户', sharingModel: 'public_read_write' },
  crm_contact: { name: 'crm_contact', label: '联系人', sharingModel: 'private' },
  crm_unlabelled: { name: 'crm_unlabelled', sharingModel: 'public_read' },
};

function makeClient() {
  return {
    list: async (type: string) =>
      type === 'object' ? Object.entries(OBJECTS).map(([name, body]) => ({ name, label: body.label ?? name })) : [],
    listDrafts: async () => [],
    layered: async (_type: string, name: string) => ({ effective: OBJECTS[name] ?? {}, code: null }),
    getDraft: async () => null,
    save: async (_type: string, _name: string, body: Record<string, unknown>) => body,
  } as any;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('PackageOwdOverviewPanel — object column (objectstack#34795)', () => {
  it('shows the label alone and keeps the machine name as its tooltip', async () => {
    render(<PackageOwdOverviewPanel client={makeClient()} packageId="com.example.crm" locale="zh-CN" />);
    const row = await screen.findByTestId('owd-row-crm_account');

    const name = screen.getByTestId('owd-object-name-crm_account');
    expect(name.textContent).toBe('客户');
    expect(name).toHaveAttribute('title', 'crm_account');
    // The row's text carries no machine name; the control is the tooltip above.
    expect(row.textContent).not.toContain('crm_account');
    expect(screen.getByTestId('owd-row-crm_contact').textContent).not.toContain('crm_contact');
  });

  it('an object without a label shows its name once, with no tooltip repeating it', async () => {
    render(<PackageOwdOverviewPanel client={makeClient()} packageId="com.example.crm" locale="zh-CN" />);
    await screen.findByTestId('owd-row-crm_unlabelled');
    const name = screen.getByTestId('owd-object-name-crm_unlabelled');
    expect(name.textContent).toBe('crm_unlabelled');
    expect(name).not.toHaveAttribute('title');
  });
});
