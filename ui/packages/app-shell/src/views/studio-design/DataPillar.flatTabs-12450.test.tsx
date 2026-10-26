// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12450 — the Data pillar's flat tab row. The object header's icon
 * buttons this file also pinned retired with objectui#12511; the header's
 * actions are pinned in `DataPillar.headerActions-12511.test.tsx`.
 *
 * Decision B of epic objectui#12446 (maintainer, 2026-10-15): seven flat tabs
 * — Records, Form, Validations, Hooks, Actions, API, Settings — when the
 * content column is 1000 px or wider; narrower, the last five fold back into
 * "Advanced ▾". The folded form keeps its own pins in
 * `DataPillar.advancedKeepsName-11794.test.tsx`; this file pins the flat form.
 *
 * What a DOM test can and cannot see: happy-dom evaluates no container query,
 * so both forms are in the tree here, exactly as they are in a browser, and
 * which one is DISPLAYED is decided by CSS this environment does not run. The
 * pins therefore read what decides it — the content column is the query
 * container, the five flat tabs carry the class that displays them at the
 * fold width and above, the Advanced trigger carries the class that hides it
 * there, and both classes name `DATA_TABS_FOLD_WIDTH` — and the browser
 * screenshots on the pull request show the two widths rendered.
 *
 * The REAL `DataPillar`; the records grid and two panels are stubbed, because
 * only which panel is open is under test, not what it draws.
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
import {
  DATA_CONTENT_CONTAINER,
  DATA_TAB_FLAT_ONLY,
  DATA_TAB_FOLDED_ONLY,
  DATA_TABS_FOLD_WIDTH,
} from './dataTabsFold';
import { t } from '../metadata-admin/i18n';

const FLAT_KEYS = ['rules', 'hooks', 'actions', 'api', 'settings'] as const;
const ROW_NAMES = ['records', 'form', ...FLAT_KEYS].map((k) => t(`engine.studio.data.tab.${k}`, 'en'));
const ADVANCED = t('engine.studio.data.tab.advanced', 'en');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPillar(props: { readOnly?: boolean } = {}) {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <SurfaceDeepLinkProvider>
        <DataPillar packageId="com.example.showcase" readOnly={props.readOnly} />
      </SurfaceDeepLinkProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('records-panel')).toBeInTheDocument(), { timeout: 8000 });
}

/** The header's tab row: the `nav` the item header draws its tabs into. */
function tabRow(): HTMLElement {
  const nav = screen.getByTestId('data-object-header').querySelector('nav');
  expect(nav, 'the object header draws no tab row').not.toBeNull();
  return nav as HTMLElement;
}

/** Split a class attribute into its tokens. */
function classesOf(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

describe('the Data pillar’s seven flat tabs (objectui#12450)', () => {
  it('both class strings name the fold width, so the rule and its constant cannot drift apart', () => {
    const query = `@min-[${DATA_TABS_FOLD_WIDTH}px]:`;
    expect(DATA_TABS_FOLD_WIDTH).toBe(1000);
    expect(DATA_TAB_FLAT_ONLY.split(' ')).toEqual(['hidden', `${query}inline-flex`]);
    expect(DATA_TAB_FOLDED_ONLY.split(' ')).toEqual([`${query}hidden`]);
  });

  it('the tab row holds the seven tabs in the artboard’s order, then the folded trigger', async () => {
    await renderPillar();
    const row = tabRow();
    const buttons = within(row).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([...ROW_NAMES, ADVANCED]);
    expect(buttons.at(-1)).toBe(screen.getByTestId('data-tabs-advanced'));
  });

  it('the content column is the query container, and it holds the tab row it measures for', async () => {
    await renderPillar();
    const column = screen.getByTestId('data-content-column');
    expect(classesOf(column)).toContain(DATA_CONTENT_CONTAINER);
    expect(column).toContainElement(tabRow());
  });

  it('the five panels’ flat tabs display only at the fold width and above; the trigger only below it', async () => {
    await renderPillar();
    for (const key of FLAT_KEYS) {
      const tab = screen.getByTestId(`data-tab-flat-${key}`);
      for (const cls of DATA_TAB_FLAT_ONLY.split(' ')) expect(classesOf(tab)).toContain(cls);
      // `cn` merges the tab's own `inline-flex` away: an unconditional
      // display class left beside `hidden` would show the tab at every width.
      expect(classesOf(tab)).not.toContain('inline-flex');
    }
    const trigger = screen.getByTestId('data-tabs-advanced');
    expect(classesOf(trigger)).toContain(DATA_TAB_FOLDED_ONLY);
    expect(classesOf(trigger)).not.toContain('hidden');
  });

  it('CONTROL: Records and Form are displayed at every width', async () => {
    await renderPillar();
    const row = tabRow();
    for (const name of ROW_NAMES.slice(0, 2)) {
      const tab = within(row).getByRole('button', { name });
      expect(classesOf(tab)).toContain('inline-flex');
      expect(classesOf(tab)).not.toContain('hidden');
      expect(classesOf(tab).some((c) => c.startsWith('@'))).toBe(false);
    }
  });

  it('a flat tab opens its panel and takes the active underline; the folded trigger mirrors it', async () => {
    await renderPillar();
    const validations = screen.getByTestId('data-tab-flat-rules');
    expect(validations).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(validations);
    await waitFor(() => expect(screen.getByTestId('rules-panel')).toBeInTheDocument());
    expect(validations).toHaveAttribute('aria-pressed', 'true');
    // The two forms say the same thing: at the narrower width the trigger is
    // the one on screen, and it shows a power panel is open.
    expect(screen.getByTestId('data-tabs-advanced')).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByTestId('data-tab-flat-settings'));
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeInTheDocument());
    expect(screen.queryByTestId('rules-panel')).toBeNull();
    expect(validations).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('data-tab-flat-settings')).toHaveAttribute('aria-pressed', 'true');
  });
});
