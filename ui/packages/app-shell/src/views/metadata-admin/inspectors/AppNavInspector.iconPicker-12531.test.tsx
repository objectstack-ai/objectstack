// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12531 — Setup's app editor picks a navigation entry's icon from the
 * catalog instead of taking a typed Lucide name.
 *
 * An entry whose spec member declares `icon` (`navEntryOffersField`) gets the
 * console's one icon picker, `IconPickerWidget`, named by the field's label:
 *
 *  - picking `building` writes `icon: 'building'` on the entry, and the entry
 *    still parses as `NavigationItemSchema`;
 *  - clearing writes `icon: ''`, the convention the text field this replaced
 *    had, which the schema takes;
 *  - a stored name that matches no icon shows the picker's inline warning;
 *  - read-only disables the picker;
 *  - CONTROL: a separator, whose member declares no `icon`, still gets no icon
 *    field at all.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';
import { NavigationItemSchema } from '@objectstack/spec/ui';

// ONE client for the whole file, as the real hook hands out (see
// `AppNavInspector.labelInherits-11196.test.tsx`).
const client = vi.hoisted(() => ({ list: async () => [] }));

vi.mock('../useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));

import { AppNavInspector } from './AppNavInspector';
import { t } from '../i18n';

afterEach(cleanup);

const METADATA = {
  apps: [],
  objects: [{ name: 'lead', label: 'Leads' }],
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
  getTypeStatus: () => 'ready' as const,
};

type Entry = Record<string, unknown>;
type NavPatch = { navigation: Entry[] };

const OBJECT_ENTRY: Entry = { id: 'nav_leads', type: 'object', objectName: 'lead' };
const SEPARATOR: Entry = { id: 'nav_sep_reports', type: 'separator' };
const ICON_LABEL = t('engine.inspector.appNav.icon', 'en-US');

function inspect(navigation: Entry[], index: number, readOnly = false) {
  const onPatch = vi.fn<(patch: NavPatch) => void>();
  render(
    <MetadataCtx.Provider value={METADATA as never}>
      <AppNavInspector
        type="app"
        name="crm"
        selection={{ kind: 'nav', id: `navigation[${index}]` }}
        draft={{ name: 'crm', navigation }}
        onPatch={onPatch as never}
        onClearSelection={() => {}}
        locale="en-US"
        readOnly={readOnly}
      />
    </MetadataCtx.Provider>,
  );
  return onPatch;
}

/** The issues `NavigationItemSchema` raises on `entry` as saved; `[]` when it parses. */
function issuesOf(entry: Entry): unknown[] {
  const r = NavigationItemSchema.safeParse(JSON.parse(JSON.stringify(entry)));
  return r.success ? [] : r.error.issues;
}

function iconTrigger(): HTMLElement {
  return screen.getByRole('combobox', { name: ICON_LABEL });
}

describe('objectui#12531 — AppNavInspector picks an entry icon from the catalog', () => {
  it('an entry that offers icon renders the picker, named by its label, and no text box', () => {
    inspect([{ ...OBJECT_ENTRY, icon: 'users' }], 0);
    const trigger = iconTrigger();
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveTextContent('users');
    expect(screen.queryByRole('textbox', { name: ICON_LABEL })).toBeNull();
  });

  it('typing "build" lists building, and picking it writes icon: "building" that parses', () => {
    const onPatch = inspect([OBJECT_ENTRY], 0);
    fireEvent.click(iconTrigger());
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(t('engine.form.searchIcons', 'en-US')), {
      target: { value: 'build' },
    });
    const building = within(dialog).getAllByRole('option').find((o) => o.getAttribute('title') === 'building');
    expect(building, 'searching "build" lists building').toBeDefined();
    fireEvent.click(building as HTMLElement);
    expect(onPatch).toHaveBeenCalledTimes(1);
    const written = onPatch.mock.calls[0][0].navigation[0];
    expect(written).toEqual({ ...OBJECT_ENTRY, icon: 'building' });
    expect(issuesOf(written)).toEqual([]);
  });

  it("clearing writes icon: '', as the text field did, and the entry still parses", () => {
    const onPatch = inspect([{ ...OBJECT_ENTRY, icon: 'users' }], 0);
    fireEvent.click(iconTrigger());
    fireEvent.click(within(screen.getByRole('dialog')).getByTitle(t('engine.form.none', 'en-US')));
    expect(onPatch).toHaveBeenCalledTimes(1);
    const written = onPatch.mock.calls[0][0].navigation[0];
    expect(written).toEqual({ ...OBJECT_ENTRY, icon: '' });
    expect(issuesOf(written)).toEqual([]);
  });

  it('a stored name that matches no icon shows the warning; a catalog name does not (CONTROL)', () => {
    inspect([{ ...OBJECT_ENTRY, icon: 'not-an-icon' }], 0);
    expect(screen.getByTestId('icon-picker-unknown-name')).toHaveTextContent('not-an-icon');
    cleanup();
    inspect([{ ...OBJECT_ENTRY, icon: 'building' }], 0);
    expect(screen.queryByTestId('icon-picker-unknown-name')).toBeNull();
  });

  it('read-only disables the picker', () => {
    inspect([{ ...OBJECT_ENTRY, icon: 'users' }], 0, true);
    expect(iconTrigger()).toBeDisabled();
  });

  it('CONTROL: a separator still renders no icon field', () => {
    inspect([OBJECT_ENTRY, SEPARATOR], 1);
    expect(screen.queryByRole('combobox', { name: ICON_LABEL })).toBeNull();
    expect(screen.queryByLabelText(ICON_LABEL)).toBeNull();
    expect(screen.queryByTestId('icon-picker-unknown-name')).toBeNull();
  });
});
