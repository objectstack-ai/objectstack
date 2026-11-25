// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12450, objectstack#36904 — the object designer's tab row.
 *
 * #36513 section 一 (kept by epic objectstack#36890), verbatim: 「记录、字段布局
 * （或表单）、验证、操作、设置、钩子、API」; narrow widths fold 钩子 and API
 * first. The item tools follow as tabs (epic decision 8): References,
 * History, Source. The open tab is in the address (`?tab=`).
 *
 * What a DOM test can and cannot see: happy-dom evaluates no container query,
 * so every form is in the tree here, exactly as in a browser, and which one is
 * DISPLAYED is decided by CSS this environment does not run. The pins read
 * what decides it — the content column is the query container, each flat tab
 * and each "Advanced ▾" trigger carries the class for its width band, and the
 * classes name the two widths.
 *
 * The REAL `DataPillar`; the records grid and two panels are stubbed, because
 * only which panel is open is under test, not what it draws.
 */

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/lint';
import '@object-ui/plugin-detail';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

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
  DATA_TAB_FLAT_WIDE_ONLY,
  DATA_TAB_FOLDED_FIRST_ONLY,
  DATA_TAB_FOLDED_ONLY,
  DATA_TABS_FOLD_FIRST_WIDTH,
  DATA_TABS_FOLD_WIDTH,
} from './dataTabsFold';
import { t } from '../metadata-admin/i18n';

const FLAT_KEYS = ['rules', 'actions', 'settings'] as const;
const FOLD_FIRST_KEYS = ['hooks', 'api'] as const;
// #36513's order: records, field layout, validations, actions, settings, hooks, API.
const ROW_NAMES = ['records', 'form', 'rules', 'actions', 'settings', 'hooks', 'api'].map((k) =>
  t(`engine.studio.data.tab.${k}`, 'en'),
);
const TOOL_NAMES = ['references', 'history', 'source'].map((k) => t(`engine.studio.itemTabs.${k}`, 'en'));
const ADVANCED = t('engine.studio.data.tab.advanced', 'en');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The router's query: the address the designer writes its tab into. */
function Where() {
  return <span data-testid="where">{useLocation().search}</span>;
}
const tabInAddress = () => new URLSearchParams(screen.getByTestId('where').textContent ?? '').get('tab');

async function renderPillar(props: { readOnly?: boolean } = {}) {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/metadata/object/showcase_account']}>
      <SurfaceDeepLinkProvider>
        <DataPillar packageId="com.example.showcase" objectName="showcase_account" readOnly={props.readOnly} />
        <Where />
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

describe('the object designer’s tab row (objectui#12450, objectstack#36904)', () => {
  it('the class strings name the two widths, so the rule and its constants cannot drift apart', () => {
    const fold = `@min-[${DATA_TABS_FOLD_WIDTH}px]:`;
    const first = `@min-[${DATA_TABS_FOLD_FIRST_WIDTH}px]:`;
    expect([DATA_TABS_FOLD_WIDTH, DATA_TABS_FOLD_FIRST_WIDTH]).toEqual([1000, 1200]);
    expect(DATA_TAB_FLAT_ONLY.split(' ')).toEqual(['hidden', `${fold}inline-flex`]);
    expect(DATA_TAB_FLAT_WIDE_ONLY.split(' ')).toEqual(['hidden', `${first}inline-flex`]);
    expect(DATA_TAB_FOLDED_ONLY.split(' ')).toEqual([`${fold}hidden`]);
    expect(DATA_TAB_FOLDED_FIRST_ONLY.split(' ')).toEqual(['hidden', `${fold}inline-flex`, `${first}hidden`]);
  });

  it('the row holds the seven views in #36513’s order, the two folded triggers, then the item tools', async () => {
    await renderPillar();
    const buttons = within(tabRow()).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([...ROW_NAMES, ADVANCED, ADVANCED, ...TOOL_NAMES]);
    expect(buttons[7]).toBe(screen.getByTestId('data-tabs-advanced-first'));
    expect(buttons[8]).toBe(screen.getByTestId('data-tabs-advanced'));
  });

  it('the content column is the query container, and it holds the tab row it measures for', async () => {
    await renderPillar();
    const column = screen.getByTestId('data-content-column');
    expect(classesOf(column)).toContain(DATA_CONTENT_CONTAINER);
    expect(column).toContainElement(tabRow());
  });

  it('Hooks and API fold first; Validations, Actions and Settings fold below the fold width', async () => {
    await renderPillar();
    for (const [keys, cls] of [
      [FLAT_KEYS, DATA_TAB_FLAT_ONLY],
      [FOLD_FIRST_KEYS, DATA_TAB_FLAT_WIDE_ONLY],
    ] as const) {
      for (const key of keys) {
        const tab = screen.getByTestId(`data-tab-flat-${key}`);
        for (const c of cls.split(' ')) expect(classesOf(tab), key).toContain(c);
        // `cn` merges the tab's own `inline-flex` away: an unconditional
        // display class left beside `hidden` would show the tab at every width.
        expect(classesOf(tab), key).not.toContain('inline-flex');
      }
    }
    for (const c of DATA_TAB_FOLDED_FIRST_ONLY.split(' ')) {
      expect(classesOf(screen.getByTestId('data-tabs-advanced-first'))).toContain(c);
    }
    expect(classesOf(screen.getByTestId('data-tabs-advanced'))).toContain(DATA_TAB_FOLDED_ONLY);
    expect(classesOf(screen.getByTestId('data-tabs-advanced'))).not.toContain('hidden');
  });

  it('CONTROL: Records, Field layout and the item tools are displayed at every width', async () => {
    await renderPillar();
    const row = tabRow();
    for (const name of [...ROW_NAMES.slice(0, 2), ...TOOL_NAMES]) {
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
    expect(screen.getByTestId('data-tabs-advanced')).toHaveAttribute('aria-pressed', 'true');
    // Validations is not one of the two the middle band folds.
    expect(screen.getByTestId('data-tabs-advanced-first')).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(tabInAddress()).toBe('validations'));

    await userEvent.click(screen.getByTestId('data-tab-flat-settings'));
    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeInTheDocument());
    expect(screen.queryByTestId('rules-panel')).toBeNull();
    expect(validations).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('data-tab-flat-settings')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(tabInAddress()).toBe('settings'));
  });
});
