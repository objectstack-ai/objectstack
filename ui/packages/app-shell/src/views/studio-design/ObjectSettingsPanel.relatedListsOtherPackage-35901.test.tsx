/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35901 — the object settings panel shows a child list ANOTHER
 * package brings read-only, with its source: it is not one of this object's
 * entries (its package places it), so it stays in the unlisted rows with a
 * "from <package>" badge, and the preview draws it at the end of the tabs,
 * before a trailing activity-stream tab. Control: a child of this object's
 * own package carries no badge and the preview leaves it out.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { ObjectSettingsPanel } from './ObjectSettingsPanel';

afterEach(cleanup);

type Row = Record<string, unknown>;

const account: Row = { name: 'account', label: 'Account', _packageId: 'com.vendor.crm', fields: { name: { type: 'text', label: 'Name' } } };
const child = (name: string, label: string, packageId: string): Row => ({
  name,
  label,
  _packageId: packageId,
  fields: { account_id: { type: 'lookup', reference: 'account', label: 'Account' } },
});

function store(objects: Row[]): MetadataContextValue {
  return {
    apps: [],
    objects,
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };
}

function renderPanel(objects: Row[], draft: Row) {
  const value = store(objects);
  return render(
    <MetadataCtx.Provider value={value}>
      <ObjectSettingsPanel name="account" draft={draft} onPatch={() => {}} locale="en-US" />
    </MetadataCtx.Provider>,
  );
}

describe('objectstack#35901 — a child list another package brings, in the settings panel', () => {
  const draft: Row = { name: 'account', label: 'Account', fields: account.fields, relatedLists: ['contact', 'sys_activity'] };

  it('shows it unlisted with its source, and previews it at the end of the tabs', () => {
    renderPanel([account, child('contact', 'Contact', 'com.vendor.crm'), child('contract', 'Contract', 'com.acme.contracts')], draft);
    const row = screen.getByTestId('related-lists-tail-row-contract.account_id');
    expect(within(row).getByTestId('related-lists-from-package')).toHaveTextContent('from com.acme.contracts');
    expect(screen.getByTestId('related-lists-preview-side')).toHaveTextContent('Contact · Contract · Activity · Approvals');
  });

  it('control: a child of this object\'s own package has no badge and does not show', () => {
    renderPanel([account, child('contact', 'Contact', 'com.vendor.crm'), child('contract', 'Contract', 'com.vendor.crm')], draft);
    const row = screen.getByTestId('related-lists-tail-row-contract.account_id');
    expect(within(row).queryByTestId('related-lists-from-package')).toBeNull();
    expect(screen.getByTestId('related-lists-preview-side')).not.toHaveTextContent('Contract');
  });
});
