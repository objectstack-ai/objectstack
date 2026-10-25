// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11794 — the Data pillar's *Advanced* trigger keeps its own name.
 *
 * The defect: with one of the five power panels open, the trigger renamed
 * itself to that panel ("Validations ▾"), so the word that says sibling panels
 * sit behind it was gone. Now the trigger always reads *Advanced*; where the
 * author is shows as the trigger's active pill (`aria-pressed`) and as the
 * checked radio item inside the menu.
 *
 * The REAL `DataPillar` and the REAL Radix menu. The panels themselves are
 * stubbed: only which one is open is under test, not what it draws.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

vi.mock('./ObjectValidationsPanel', () => ({ ObjectValidationsPanel: () => <div data-testid="rules-panel" /> }));
vi.mock('./ObjectSettingsPanel', () => ({ ObjectSettingsPanel: () => <div data-testid="settings-panel" /> }));

import { DataPillar } from './StudioDesignSurface';
import { SurfaceDeepLinkProvider } from './surfaceDeepLinkChannel';
import { t } from '../metadata-admin/i18n';

const ADVANCED = t('engine.studio.data.tab.advanced', 'en');
const PANELS = ['rules', 'hooks', 'actions', 'api', 'settings'].map((k) => t(`engine.studio.data.tab.${k}`, 'en'));
const VALIDATIONS = t('engine.studio.data.tab.rules', 'en');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPillar() {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <SurfaceDeepLinkProvider>
        <DataPillar packageId="com.example.showcase" />
      </SurfaceDeepLinkProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('records-panel')).toBeInTheDocument(), { timeout: 8000 });
  return screen.getByTestId('data-tabs-advanced');
}

/** The open menu's radio items, by their visible name, with their checked state. */
async function menuState(trigger: HTMLElement): Promise<Record<string, string | null>> {
  await userEvent.click(trigger);
  const menu = await screen.findByRole('menu');
  const state: Record<string, string | null> = {};
  for (const item of within(menu).getAllByRole('menuitemradio')) {
    state[item.textContent ?? ''] = item.getAttribute('aria-checked');
  }
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  return state;
}

describe('the Data pillar’s Advanced trigger keeps its own name (objectui#11794)', () => {
  it('control: on Records the trigger reads Advanced, is not pressed, and no panel is checked', async () => {
    const trigger = await renderPillar();
    expect(trigger).toHaveTextContent(ADVANCED);
    expect(trigger).toHaveAttribute('aria-pressed', 'false');
    const state = await menuState(trigger);
    expect(Object.keys(state)).toEqual(PANELS);
    expect(Object.values(state).every((checked) => checked === 'false')).toBe(true);
  });

  it('with Validations open the trigger still reads Advanced (not Validations), takes the active pill, and the menu checks Validations', async () => {
    const trigger = await renderPillar();
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitemradio', { name: VALIDATIONS }));
    await waitFor(() => expect(screen.getByTestId('rules-panel')).toBeInTheDocument());

    // THE PIN: the trigger's own name, and nothing else, whichever panel is open.
    expect(trigger).toHaveTextContent(ADVANCED);
    expect(trigger).not.toHaveTextContent(VALIDATIONS);
    expect(trigger).toHaveAttribute('aria-pressed', 'true');

    const state = await menuState(trigger);
    expect(state[VALIDATIONS]).toBe('true');
    for (const name of PANELS.filter((n) => n !== VALIDATIONS)) expect(state[name]).toBe('false');
  });

  it('picking a sibling from the menu moves the check and the panel; the trigger name stays', async () => {
    const trigger = await renderPillar();
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitemradio', { name: VALIDATIONS }));
    await waitFor(() => expect(screen.getByTestId('rules-panel')).toBeInTheDocument());

    const settings = t('engine.studio.data.tab.settings', 'en');
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitemradio', { name: settings }));
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeInTheDocument());
    expect(screen.queryByTestId('rules-panel')).toBeNull();
    expect(trigger).toHaveTextContent(ADVANCED);

    const state = await menuState(trigger);
    expect(state[settings]).toBe('true');
    expect(state[VALIDATIONS]).toBe('false');
  });
});
