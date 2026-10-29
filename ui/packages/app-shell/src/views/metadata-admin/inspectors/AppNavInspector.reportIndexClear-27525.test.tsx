// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27525 — metadata-admin's nav inspector reaches the report index
 * the way the Studio inspector does: by REMOVING `reportName`, never by
 * writing `''`.
 *
 * A `report` item with no `reportName` opens the app's report index. The
 * target combo offered only reports, so an author could not get back to the
 * index once a report was picked, and the one empty value the console reads
 * as the index (`''`) is a value `defineStack` refuses as an unknown report.
 * The combo now leads with a 「Report index」 row for a `report` item; picking
 * it drops the key.
 *
 *  - picking the index row writes the item with no `reportName` key;
 *  - the trigger names the index while the item has no `reportName`;
 *  - CONTROL: picking a report still writes its name;
 *  - CONTROL: another type's target combo offers no empty row.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MetadataCtx } from '@object-ui/react';

// ONE client for the whole file (see AppNavInspector.labelInherits-11196).
const client = vi.hoisted(() => ({
  list: async (type: string) =>
    type === 'report' ? [{ name: 'pipeline', label: 'Pipeline' }] : type === 'page' ? [{ name: 'home', label: 'Home' }] : [],
}));

vi.mock('../useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));

import { AppNavInspector } from './AppNavInspector';

afterEach(cleanup);

const METADATA = {
  apps: [],
  objects: [],
  dashboards: [],
  reports: [{ name: 'pipeline', label: 'Pipeline' }],
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

function inspect(item: Record<string, unknown>) {
  const onPatch = vi.fn();
  render(
    <MetadataCtx.Provider value={METADATA as never}>
      <AppNavInspector
        type="app"
        name="crm"
        selection={{ kind: 'nav', id: 'navigation[0]' }}
        draft={{ name: 'crm', navigation: [item] }}
        onPatch={onPatch}
        onClearSelection={() => {}}
        locale="en-US"
        readOnly={false}
      />
    </MetadataCtx.Provider>,
  );
  return onPatch;
}

/** The single nav item an `onPatch` call wrote. */
function written(onPatch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(onPatch).toHaveBeenCalledTimes(1);
  return (onPatch.mock.calls[0][0] as { navigation: Array<Record<string, unknown>> }).navigation[0];
}

const NAMED = { id: 'nav_pipeline', type: 'report', label: 'Pipeline', reportName: 'pipeline' };
const INDEX = { id: 'nav_reports', type: 'report', label: 'Reports' };

describe('objectstack#27525 — AppNavInspector clears a report target by removing reportName', () => {
  it("picking the Report index row removes the key, never writes ''", async () => {
    const user = userEvent.setup();
    const onPatch = inspect(NAMED);
    await user.click(screen.getByRole('combobox', { name: 'Report' }));
    await user.click(await screen.findByRole('option', { name: /Report index/ }));
    const item = written(onPatch);
    expect(Object.prototype.hasOwnProperty.call(item, 'reportName')).toBe(false);
    expect(item).toEqual({ id: 'nav_pipeline', type: 'report', label: 'Pipeline' });
  });

  it('the trigger names the index while the item has no reportName', () => {
    inspect(INDEX);
    expect(screen.getByRole('combobox', { name: 'Report' }).textContent).toContain('Report index');
  });

  it('CONTROL: picking a report writes its name', async () => {
    const user = userEvent.setup();
    const onPatch = inspect(INDEX);
    await user.click(screen.getByRole('combobox', { name: 'Report' }));
    await user.click(await screen.findByRole('option', { name: /pipeline/ }));
    expect(written(onPatch).reportName).toBe('pipeline');
  });

  it("CONTROL: a page item's target combo offers no empty row", async () => {
    const user = userEvent.setup();
    inspect({ id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' });
    await user.click(screen.getByRole('combobox', { name: 'Page' }));
    await screen.findByRole('option', { name: /home/ });
    expect(screen.queryByRole('option', { name: /Report index/ })).toBeNull();
  });
});
