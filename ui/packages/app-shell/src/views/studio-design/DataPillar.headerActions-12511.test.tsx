// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12511 — the Data pillar's object header reads the same on every
 * tab. Its right slot holds the saved-at meta and no action of its own:
 *
 * - Object settings retired: the Settings tab one row below is that control;
 * - Add field is a field action, offered where fields are laid out (the Form
 *   toolbar and the Records grid's "+" column, pinned as one action in
 *   `DataPillar.formToolbar-12451.test.tsx`), so the header drops it;
 * - the More menu went with it: its one entry was Add field, and the header
 *   has no object-level action to put in one.
 *
 * The REAL `DataPillar`; the records grid and the Settings panel are stubbed,
 * because only the header is under test.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const servedObject = {
  name: 'showcase_account',
  label: 'Account',
  fields: { name: { type: 'text', label: 'Account Name' } },
};

const mockClient = {
  list: vi.fn(async () => [{ name: 'showcase_account', label: 'Account' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: servedObject, code: servedObject })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({ ok: true })),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, ObjectView: () => <div data-testid="records-panel" /> };
});

vi.mock('./ObjectSettingsPanel', () => ({ ObjectSettingsPanel: () => <div data-testid="settings-panel" /> }));

import { DataPillar } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

const RECORDS = t('engine.studio.data.tab.records', 'en');
const FORM = t('engine.studio.data.tab.form', 'en');
const TOGGLE_RAIL = t('engine.studio.toggleRail', 'en');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPillar(props: { readOnly?: boolean } = {}) {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" readOnly={props.readOnly} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('records-panel')).toBeInTheDocument(), { timeout: 8000 });
}

/**
 * Every control in the header outside its tab row, each as one line naming
 * its element, test id, accessible label and text. The tab row is the
 * header's `nav`, and it marks which tab is active, so it is left out.
 */
function headerControls(): string[] {
  const header = screen.getByTestId('data-object-header');
  const controls = header.querySelectorAll('button, a[href], input, select, [role="button"], [role="menuitem"]');
  return Array.from(controls)
    .filter((el) => !el.closest('nav'))
    .map((el) =>
      [
        el.tagName.toLowerCase(),
        el.getAttribute('data-testid') ?? '',
        el.getAttribute('aria-label') ?? '',
        (el.textContent ?? '').trim(),
      ].join('|'),
    );
}

/** Open each of Records, Form and Settings, and read the header's controls on it. */
async function controlsPerTab(): Promise<Record<string, string[]>> {
  const seen: Record<string, string[]> = {};
  seen.records = headerControls();

  await userEvent.click(screen.getByRole('button', { name: FORM }));
  await screen.findByTestId('form-toolbar');
  seen.form = headerControls();

  await userEvent.click(screen.getByTestId('data-tab-flat-settings'));
  await screen.findByTestId('settings-panel');
  seen.settings = headerControls();

  await userEvent.click(screen.getByRole('button', { name: RECORDS }));
  await screen.findByTestId('records-panel');
  seen.recordsAgain = headerControls();
  return seen;
}

describe('the Data pillar’s object header actions (objectui#12511)', () => {
  it('the header holds the same controls on Records, Form and Settings', async () => {
    await renderPillar();
    const seen = await controlsPerTab();
    expect(seen.form).toEqual(seen.records);
    expect(seen.settings).toEqual(seen.records);
    expect(seen.recordsAgain).toEqual(seen.records);
    // And that set is the mobile rail toggle alone: the header draws no
    // action of its own on any tab.
    expect(seen.records).toEqual([`button||${TOGGLE_RAIL}|`]);
  });

  it('Object settings, More and the header Add field are gone; the Settings tab opens the panel', async () => {
    await renderPillar();
    expect(screen.queryByTestId('data-object-settings')).toBeNull();
    expect(screen.queryByTestId('data-object-more')).toBeNull();
    expect(screen.queryByTestId('data-object-add-field')).toBeNull();

    await userEvent.click(screen.getByTestId('data-tab-flat-settings'));
    expect(await screen.findByTestId('settings-panel')).toBeInTheDocument();
    expect(screen.getByTestId('data-tab-flat-settings')).toHaveAttribute('aria-pressed', 'true');
  });

  it('CONTROL — read-only: the same controls on every tab as well', async () => {
    await renderPillar({ readOnly: true });
    const seen = await controlsPerTab();
    expect(seen.form).toEqual(seen.records);
    expect(seen.settings).toEqual(seen.records);
    // objectui#12453 — plus the read-only link, which is not an object action.
    expect(seen.records).toEqual([
      `button||${TOGGLE_RAIL}|`,
      `a|studio-readonly-link||${t('engine.studio.pkg.readonlyLink', 'en-US')}`,
    ]);
  });
});
