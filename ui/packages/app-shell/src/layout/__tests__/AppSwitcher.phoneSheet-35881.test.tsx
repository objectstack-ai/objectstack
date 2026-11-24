// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35881 — on a phone the app pill opens the app list as a bottom
 * sheet: 「Current app」 checked, then 「Other apps」 with Setup last, and a
 * search box that narrows both. A pick closes the sheet and switches by the
 * app's one address (`appAddressSegment`, objectstack#29024). The list is
 * `PhoneAppList`, the same one a phone's `/home` draws as a page.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => <span /> }));
vi.mock('@object-ui/i18n', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/i18n');
  return {
    ...actual,
    useObjectTranslation: () => ({
      t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key,
    }),
    useObjectLabel: () => ({
      appLabel: ({ name, label }: { name: string; label?: string }) => label ?? name,
    }),
  };
});
vi.mock('../../utils', async () => {
  const appRoute = await vi.importActual<typeof import('../../utils/appRoute')>('../../utils/appRoute');
  return {
    ...appRoute,
    resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : undefined),
  };
});

let apps: Array<Record<string, unknown>> = [];
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps, loading: false }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
const viewport = vi.hoisted(() => ({ phone: true }));
vi.mock('../../hooks/usePhoneViewport', () => ({ usePhoneViewport: () => viewport.phone }));

import { AppSwitcher } from '../AppSwitcher';

function renderSwitcher(onAppChange = vi.fn(), showNameOnPhone = false) {
  render(
    <MemoryRouter>
      <AppSwitcher activeAppName="crm" onAppChange={onAppChange} showNameOnPhone={showNameOnPhone} />
    </MemoryRouter>,
  );
  return onAppChange;
}

function openSheet() {
  fireEvent.click(screen.getByTestId('app-switcher-trigger'));
  return within(screen.getByTestId('app-switcher-sheet'));
}

beforeEach(() => {
  viewport.phone = true;
  apps = [
    { name: 'setup', label: 'Setup', _packageId: 'com.objectstack.setup' },
    { name: 'crm', label: 'CRM' },
    { name: 'r6_app', label: 'R6 App', _packageId: 'com.qa.r6nav' },
    { name: 'r6_board', label: 'R6 Board', _packageId: 'com.qa.r6nav' },
  ];
});

afterEach(() => cleanup());

describe('the phone app pill opens the app list as a bottom sheet (objectstack#35881)', () => {
  it('current app checked first, then the other apps with Setup last', () => {
    renderSwitcher();
    const sheet = openSheet();
    expect(sheet.getByText('Current app')).toBeInTheDocument();
    expect(sheet.getByTestId('phone-app-row-crm')).toHaveAttribute('aria-current', 'true');
    const rows = sheet.getAllByRole('button').filter((b) => b.dataset.testid?.startsWith('phone-app-row-'));
    expect(rows.map((b) => b.dataset.testid)).toEqual([
      'phone-app-row-crm',
      'phone-app-row-r6_app',
      'phone-app-row-r6_board',
      'phone-app-row-setup',
    ]);
  });

  it('search narrows the list; nothing left says so', () => {
    renderSwitcher();
    const sheet = openSheet();
    fireEvent.change(sheet.getByTestId('phone-app-list-search'), { target: { value: 'board' } });
    expect(sheet.queryByTestId('phone-app-row-crm')).toBeNull();
    expect(sheet.getByTestId('phone-app-row-r6_board')).toBeInTheDocument();
    fireEvent.change(sheet.getByTestId('phone-app-list-search'), { target: { value: 'zzz' } });
    expect(sheet.getByTestId('phone-app-list-empty')).toBeInTheDocument();
  });

  it('a pick switches by the app\'s address and closes the sheet; the current app does not switch', () => {
    const onAppChange = renderSwitcher();
    let sheet = openSheet();
    fireEvent.click(sheet.getByTestId('phone-app-row-crm'));
    expect(onAppChange).not.toHaveBeenCalled();
    sheet = openSheet();
    fireEvent.click(sheet.getByTestId('phone-app-row-r6_board'));
    expect(onAppChange).toHaveBeenCalledWith('r6_board');
    expect(screen.queryByTestId('app-switcher-sheet')).toBeNull();
  });

  it('the pill shows the app name only where asked (the three tab pages)', () => {
    renderSwitcher(vi.fn(), true);
    expect(screen.getByTestId('app-switcher-phone-name')).toHaveTextContent('CRM');
    cleanup();
    renderSwitcher(vi.fn(), false);
    expect(screen.queryByTestId('app-switcher-phone-name')).toBeNull();
  });

  it('CONTROL — above a phone the switcher is the dropdown, with no sheet', () => {
    viewport.phone = false;
    renderSwitcher();
    expect(screen.queryByTestId('app-switcher-sheet')).toBeNull();
    expect(screen.queryByTestId('phone-app-list-sheet')).toBeNull();
  });
});
