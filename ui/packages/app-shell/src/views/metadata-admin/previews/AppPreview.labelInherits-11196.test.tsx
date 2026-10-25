// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11196 — the app designer's preview list and its design-mode canvas
 * name a label-less nav entry the way the console's sidebar does.
 *
 * Since objectui#9868 the platform writes nav entries with NO `label` (the
 * console's `NavigationSyncEffect` for every page and dashboard): absent ⇒ the
 * entry shows its target's CURRENT label at render time. The preview read the
 * raw label and showed `(unnamed)`; the canvas showed a positional `Item N`.
 * Both now ask the runtime's rule, with the console's own target resolver
 * (`useNavTargetLabel`), under a real `MetadataCtx`:
 *
 *  - a label-less object / dashboard entry shows its target's metadata label,
 *    and a rename of the target shows on the next render;
 *  - a label-less page shows its `pageName`, a label-less group its `id`;
 *  - with no metadata, the target's machine name — never blank, never
 *    `(unnamed)`;
 *  - CONTROL: an authored label renders verbatim;
 *  - the canvas's inline rename shows the inherited text as a PLACEHOLDER: an
 *    untouched entry stays label-less, and typing writes an author label.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';
import { t } from '../i18n';
import { AppPreview } from './AppPreview';

afterEach(cleanup);

const NAVIGATION = [
  // What NavigationSyncEffect writes since objectui#9868, and a label-less object entry.
  { id: 'nav_leads', type: 'object', objectName: 'lead' },
  { id: 'nav_sales', type: 'dashboard', dashboardName: 'sales_overview' },
  { id: 'nav_home', type: 'page', pageName: 'home_page' },
  { id: 'nav_admin', type: 'group', children: [{ id: 'nav_docs', type: 'url', label: 'Docs', url: 'https://docs.example.com' }] },
  // Control: an authored label, on an object the metadata labels differently.
  { id: 'nav_accounts', type: 'object', objectName: 'account', label: 'Customers' },
];

function metadata(leadLabel: string) {
  return {
    apps: [],
    objects: [
      { name: 'lead', label: leadLabel },
      { name: 'account', label: 'Accounts' },
    ],
    dashboards: [{ name: 'sales_overview', label: 'Sales Overview' }],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
}

type Patch = (patch: Record<string, unknown>) => void;

function preview(value: ReturnType<typeof metadata> | null, design?: { onPatch: Patch }) {
  const node = (
    <AppPreview
      type="app"
      name="crm"
      draft={{ name: 'crm', label: 'CRM', navigation: NAVIGATION }}
      locale="en-US"
      {...(design
        ? { editing: true, selection: null, onSelectionChange: () => {}, onPatch: design.onPatch }
        : {})}
    />
  );
  return value ? <MetadataCtx.Provider value={value as never}>{node}</MetadataCtx.Provider> : node;
}

const UNNAMED = t('engine.appPreview.unnamed', 'en-US');

describe('objectui#11196 — the preview list names a label-less entry as the console does', () => {
  it("shows each label-less entry's inherited text, and an authored label verbatim", () => {
    render(preview(metadata('Leads')));

    expect(screen.getByText('Leads')).toBeTruthy();
    expect(screen.getByText('Sales Overview')).toBeTruthy();
    // A page names itself by its pageName, which the row also prints as its target.
    expect(screen.getAllByText('home_page')).toHaveLength(2);
    expect(screen.getByText('nav_admin')).toBeTruthy();
    // CONTROL: the authored label, not the object's metadata label.
    expect(screen.getByText('Customers')).toBeTruthy();
    expect(screen.queryByText('Accounts')).toBeNull();
    // The landing line names the first entry by the same text.
    expect(screen.getByText('→ Leads')).toBeTruthy();
    expect(screen.queryByText(UNNAMED)).toBeNull();
  });

  it("follows a rename of the target on the next render: nothing is stored", () => {
    const utils = render(preview(metadata('Leads')));
    expect(screen.getByText('Leads')).toBeTruthy();
    utils.rerender(preview(metadata('Prospects')));
    expect(screen.getByText('Prospects')).toBeTruthy();
    expect(screen.queryByText('Leads')).toBeNull();
  });

  it("with no metadata, names a target by its machine name — never blank, never (unnamed)", () => {
    render(preview(null));
    // The label and the target column both read `lead`.
    expect(screen.getAllByText('lead')).toHaveLength(2);
    expect(screen.getAllByText('sales_overview')).toHaveLength(2);
    expect(screen.queryByText(UNNAMED)).toBeNull();
  });
});

describe('objectui#11196 — the design-mode canvas names a label-less entry as the console does', () => {
  it("shows the inherited text on the card, and an authored label verbatim", () => {
    render(preview(metadata('Leads'), { onPatch: vi.fn<Patch>() }));

    expect(screen.getByText('Leads')).toBeTruthy();
    expect(screen.getByText('Sales Overview')).toBeTruthy();
    expect(screen.getByText('nav_admin')).toBeTruthy();
    expect(screen.getByText('Customers')).toBeTruthy();
    expect(screen.queryByText(/^Item \d+$/)).toBeNull();
  });

  it('the inline rename shows the inherited text as the placeholder, and leaving it untouched writes nothing', () => {
    const onPatch = vi.fn<Patch>();
    render(preview(metadata('Leads'), { onPatch }));

    fireEvent.doubleClick(screen.getByText('Leads'));
    const input = screen.getByPlaceholderText('Leads') as HTMLInputElement;
    expect(input.value).toBe('');
    fireEvent.blur(input);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('typing into it writes an author label', () => {
    const onPatch = vi.fn<Patch>();
    render(preview(metadata('Leads'), { onPatch }));

    fireEvent.doubleClick(screen.getByText('Leads'));
    const input = screen.getByPlaceholderText('Leads');
    fireEvent.change(input, { target: { value: 'Hot prospects' } });
    fireEvent.blur(input);
    expect(onPatch).toHaveBeenCalledTimes(1);
    const { navigation } = onPatch.mock.calls[0][0] as { navigation: Array<Record<string, unknown>> };
    expect(navigation[0]).toEqual({ id: 'nav_leads', type: 'object', objectName: 'lead', label: 'Hot prospects' });
  });
});
