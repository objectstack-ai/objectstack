// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35054 (route D) — App management saves the app as its author
 * stored it, with only the key its control owns changed.
 *
 * The page lists the served apps, which are translated for the console's
 * locale: in a zh-CN session the app's label and every navigation label are
 * Chinese. Disable, Set default and the bulk toggles spread that served row
 * into the save, and the metadata door stores a body verbatim, so one toggle
 * stored the translations as the app's source text. Measured live: an en
 * reader was then served `翻译测试应用`.
 *
 * Each save now reads the stored app (`adapter.getAuthoredItem`, the
 * untranslated layers) at the scope the save names, and patches that.
 *
 * Direction, written before the run: with the served row spread into the save
 * (the unmodified tree) the first case goes RED on the stored label and
 * navigation labels while the `active` control stays GREEN.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { saveItem, deleteItem, refresh, getAuthoredItem, toastError, apps } = vi.hoisted(() => ({
  saveItem: vi.fn<(type: string, name: string, item: any, options?: unknown) => Promise<unknown>>(async () => ({})),
  deleteItem: vi.fn(async () => ({})),
  refresh: vi.fn(async () => {}),
  getAuthoredItem: vi.fn<(type: string, name: string, options?: unknown) => Promise<Record<string, unknown> | null>>(),
  toastError: vi.fn(),
  apps: { value: [] as any[] },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastError, info: vi.fn() },
}));

// Echo the call site's own `defaultValue` with its holes filled: these cases
// pin the write, and the keying is pinned in the i18n suite.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
  }),
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: apps.value, refresh }),
  useAdapter: () => ({ getClient: () => ({ meta: { saveItem, deleteItem } }), getAuthoredItem }),
}));

const { AppManagementPage } = await import('../AppManagementPage');

/** The app as its author stored it (en source). */
const SOURCE = {
  name: 'qatr_app',
  label: 'QA Translate App',
  active: true,
  navigation: [
    { id: 'nav_my_work', type: 'page', label: 'My Work', pageName: 'qatr_my_work' },
    { id: 'grp_workspace', type: 'group', label: 'Workspace', children: [{ id: 'nav_gallery', type: 'dashboard', label: 'Chart Gallery', dashboardName: 'qatr_chart_gallery' }] },
  ],
};

/** The same app as the zh-CN list serves it. */
const SERVED = {
  ...SOURCE,
  label: '翻译测试应用',
  navigation: [
    { ...SOURCE.navigation[0], label: '我的工作' },
    { ...SOURCE.navigation[1], label: '工作区', children: [{ ...SOURCE.navigation[1].children![0], label: '图表画廊' }] },
  ],
  _packageId: 'com.qa.tr',
};

const navLabels = (nav: any[]): unknown[] => nav.map((n) => (n.children ? [n.label, navLabels(n.children)] : n.label));

function renderPage() {
  return render(
    <MemoryRouter>
      <AppManagementPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apps.value = [SERVED];
  getAuthoredItem.mockReset();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('App management saves the authored app (objectstack#35054)', () => {
  it('a zh-CN Disable stores the source label and navigation labels, and the toggled key changes', async () => {
    getAuthoredItem.mockResolvedValue(SOURCE);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Disable 翻译测试应用'));

    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    // Read at the scope the save names.
    expect(getAuthoredItem).toHaveBeenCalledWith('app', 'qatr_app', { packageId: 'com.qa.tr' });
    const [type, name, body, options] = saveItem.mock.calls[0]!;
    expect([type, name, options]).toEqual(['app', 'qatr_app', { packageId: 'com.qa.tr' }]);
    expect(body.label).toBe('QA Translate App');
    expect(navLabels(body.navigation)).toEqual(['My Work', ['Workspace', ['Chart Gallery']]]);
    // Control: the key this control owns is what changed.
    expect(body.active).toBe(false);
    expect(body).not.toHaveProperty('_packageId');
  });

  it('an app with nothing stored to read is not written from the served copy', async () => {
    getAuthoredItem.mockResolvedValue(null);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Disable 翻译测试应用'));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(saveItem).not.toHaveBeenCalled();
  });
});
