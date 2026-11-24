// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35054 (route D) — the app wizard edits the app as its author
 * stored it, never the app as it is served.
 *
 * The served app list is translated for the console's locale: in a zh-CN
 * session `useMetadata().apps` carries the app's label and every navigation
 * label in Chinese. `EditAppPage` seeded the wizard with it and saved the
 * completed draft as a whole document, which the metadata door stores
 * verbatim, so an edit of any one field stored the translations as the app's
 * source text. Measured live: an en reader was then served `翻译测试应用`.
 *
 * The page now reads the stored app (`adapter.getAuthoredItem`, the
 * untranslated layers) at the package the served app came from, and keeps the
 * served list only to find the app.
 *
 * Direction, written before the run: with the wizard seeded from the served
 * app (the unmodified tree) the first case goes RED on the stored label and
 * navigation labels while the description control stays GREEN.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const saveItem = vi.fn().mockResolvedValue({});
const getAuthoredItem = vi.fn();
const apps: Record<string, unknown>[] = [];

vi.mock('react-router-dom', () => ({
  useParams: () => ({ editAppName: 'qatr_app' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAdapter: () => ({ getClient: () => ({ meta: { saveItem } }), getAuthoredItem }),
    useMetadata: () => ({ apps, objects: [], refresh: () => Promise.resolve() }),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { EditAppPage } from '../pages/EditAppPage';

/** The app as its author stored it (en source). */
const SOURCE = {
  name: 'qatr_app',
  label: 'QA Translate App',
  icon: 'sparkles',
  navigation: [
    { id: 'nav_my_work', type: 'page', label: 'My Work', icon: 'home', pageName: 'qatr_my_work' },
    {
      id: 'grp_workspace',
      type: 'group',
      label: 'Workspace',
      icon: 'briefcase',
      children: [{ id: 'nav_gallery', type: 'dashboard', label: 'Chart Gallery', dashboardName: 'qatr_chart_gallery' }],
    },
  ],
};

/** The same app as the zh-CN list serves it: translated, with the read's decorations. */
const SERVED = {
  ...SOURCE,
  label: '翻译测试应用',
  navigation: [
    { ...SOURCE.navigation[0], label: '我的工作' },
    { ...SOURCE.navigation[1], label: '工作区', children: [{ ...SOURCE.navigation[1].children![0], label: '图表画廊' }] },
  ],
  _packageId: 'com.qa.tr',
};

const navLabels = (nav: any[]): unknown[] =>
  nav.map((n) => (n.children ? [n.label, navLabels(n.children)] : n.label));

const next = () => fireEvent.click(screen.getByTestId('wizard-next'));

beforeEach(() => {
  saveItem.mockClear();
  getAuthoredItem.mockReset();
  apps.length = 0;
  apps.push(SERVED);
});
afterEach(() => cleanup());

describe('EditAppPage edits the authored app (objectstack#35054)', () => {
  it('a zh-CN edit then save stores the source label and navigation labels, and the edited field changes', async () => {
    getAuthoredItem.mockResolvedValue(SOURCE);
    render(<EditAppPage />);
    await screen.findByTestId('edit-app-page');
    expect(getAuthoredItem).toHaveBeenCalledWith('app', 'qatr_app', { packageId: 'com.qa.tr' });
    expect((screen.getByTestId('app-title-input') as HTMLInputElement).value).toBe('QA Translate App');

    fireEvent.change(screen.getByTestId('app-description-input'), { target: { value: 'Edited description' } });
    next(); // → objects
    next(); // → navigation
    next(); // → branding
    fireEvent.click(screen.getByTestId('wizard-complete'));

    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    const [type, name, body] = saveItem.mock.calls[0] as [string, string, any];
    expect([type, name]).toEqual(['app', 'qatr_app']);
    expect(body.label).toBe('QA Translate App');
    expect(navLabels(body.navigation)).toEqual(['My Work', ['Workspace', ['Chart Gallery']]]);
    // Control: the edit itself is what the save carries.
    expect(body.description).toBe('Edited description');
    expect(body).not.toHaveProperty('_packageId');
  });

  it('with nothing authored to read the wizard does not open, and nothing is saved from the served copy', async () => {
    getAuthoredItem.mockRejectedValue(Object.assign(new Error('Layered read refused'), { status: 403 }));
    render(<EditAppPage />);
    const failed = await screen.findByTestId('edit-app-load-failed');
    expect(failed.textContent).toContain('Layered read refused');
    expect(screen.queryByTestId('edit-app-page')).toBeNull();
    expect(saveItem).not.toHaveBeenCalled();
  });
});
