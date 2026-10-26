// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12605 — the app pill's menu: the apps to switch between, then the
 * ways out.
 *
 * - The 「Switch Application」 group lists the installed apps with the current
 *   one checked; the Setup app is not in it.
 * - After a divider: 「Back to home」 with the `⌘⇧H` keycaps, 「All apps」 and
 *   「Settings」 (the Setup app), in that order.
 * - For a viewer the top bar offers its Studio button to, 「Edit APP in
 *   Studio」 follows a second divider.
 * - Below `sm` the pill is the app's glyph alone, named in its tooltip.
 *
 * CONTROL: a viewer whose app list carries no Setup app (the server withholds
 * it without `setup.access`) is offered no 「Settings」 row, and every app is
 * in the switch group.
 *
 * Real subjects: `AppSwitcher`, `AppMark`, the real route matching and the
 * real `useHomePath`. The dropdown primitives pass through so the menu CONTENT
 * renders without radix's open/close machinery — the idiom of
 * `AppSwitcher.appIdentity-12201.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

type MockProps = Record<string, unknown> & { children?: ReactNode; onClick?: () => void; className?: string };

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DropdownMenu: (p: MockProps) => <div>{p.children}</div>,
  DropdownMenuTrigger: (p: MockProps) => <div data-testid="app-switcher-trigger-slot">{p.children}</div>,
  DropdownMenuContent: (p: MockProps) => <div data-testid="app-switcher-menu">{p.children}</div>,
  DropdownMenuItem: ({ onClick, children, asChild: _asChild, className: _c, ...rest }: MockProps) => (
    <div data-menu-row="" onClick={onClick} {...rest}>{children}</div>
  ),
  DropdownMenuLabel: (p: MockProps) => <div data-menu-label="" {...p} />,
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock('../../utils/getIcon', () => ({
  getIcon: (name?: string) => (p: MockProps) => <svg data-icon={name ?? '(none)'} className={p.className} />,
}));

vi.mock('@object-ui/i18n', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/i18n');
  return {
    ...actual,
    useObjectTranslation: () => ({
      t: (key: string, o?: { defaultValue?: string; app?: string }) =>
        (o?.defaultValue ?? key).replace('{{app}}', o?.app ?? ''),
    }),
    useObjectLabel: () => ({
      appLabel: ({ name, label }: { name: string; label?: string }) => label ?? name,
    }),
  };
});

let apps: Array<Record<string, unknown>> = [];
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps }),
}));

import { AppSwitcher } from '../AppSwitcher';

const HOTCRM = { name: 'hotcrm', label: 'HotCRM', icon: 'flame', _packageId: 'com.acme.hotcrm' };
const SERVICE = { name: 'hotcrm_service', label: 'HotCRM Service', icon: 'headset' };
const SETUP = { name: 'setup', label: 'Setup', icon: 'settings', _packageId: 'com.objectstack.setup' };

function renderSwitcher(active: string, designInStudioPath?: string | null) {
  return render(
    <MemoryRouter>
      <AppSwitcher activeAppName={active} onAppChange={vi.fn()} designInStudioPath={designInStudioPath} />
    </MemoryRouter>,
  );
}

const menuEl = () => screen.getByTestId('app-switcher-menu');
const menu = () => within(menuEl());
/** The menu's children in order, each read as a row's test id, `label` or `divider`. */
function menuOutline(): string[] {
  return [...menuEl().children].map((el) => {
    if (el.tagName === 'HR') return 'divider';
    if (el.hasAttribute('data-menu-label')) return 'label';
    return el.getAttribute('data-testid') ?? el.querySelector('[data-testid]')?.getAttribute('data-testid') ?? '?';
  });
}

beforeEach(() => {
  apps = [HOTCRM, SERVICE, SETUP];
});

describe('the app pill\'s menu (objectui#12605)', () => {
  it('the switch group, then Back to home → All apps → Settings, then the Studio row after a second divider', () => {
    renderSwitcher('hotcrm', '/studio/com.acme.hotcrm/data');
    expect(menuOutline()).toEqual([
      'label',
      'divider',
      'app-switcher-row-hotcrm',
      'app-switcher-row-hotcrm_service',
      'divider',
      'app-switcher-home',
      'app-switcher-all-apps',
      'app-switcher-settings',
      'divider',
      'app-switcher-edit-in-studio',
    ]);
    expect(menu().getByTestId('app-switcher-home')).toHaveTextContent('Back to home');
    expect(menu().getByTestId('app-switcher-all-apps')).toHaveTextContent('All apps');
    expect(menu().getByTestId('app-switcher-settings')).toHaveTextContent('Settings');
  });

  it('Setup is not in the switch group; the current app is checked', () => {
    renderSwitcher('hotcrm');
    expect(menu().queryByTestId('app-switcher-row-setup')).not.toBeInTheDocument();
    const current = menu().getByTestId('app-switcher-row-hotcrm');
    expect(current.querySelector('.text-primary')).not.toBeNull();
    expect(menu().getByTestId('app-switcher-row-hotcrm_service').querySelector('.text-primary')).toBeNull();
  });

  it('「Back to home」 links to home and shows the ⌘⇧H keycaps', () => {
    renderSwitcher('hotcrm');
    const home = menu().getByTestId('app-switcher-home');
    expect(home).toHaveAttribute('href', '/home');
    expect(home.querySelector('kbd')).toHaveTextContent('⌘⇧H');
  });

  it('「Settings」 opens the Setup app at its canonical address', () => {
    renderSwitcher('hotcrm');
    expect(menu().getByTestId('app-switcher-settings')).toHaveAttribute('href', '/apps/com.objectstack.setup');
  });

  it('inside Setup, 「Settings」 is the checked row', () => {
    renderSwitcher('com.objectstack.setup');
    expect(menu().getByTestId('app-switcher-settings').querySelector('.text-primary')).not.toBeNull();
    expect(menu().queryByTestId('app-switcher-row-setup')).not.toBeInTheDocument();
  });

  it('CONTROL — a list without Setup offers no 「Settings」 row and keeps every app', () => {
    apps = [HOTCRM, SERVICE];
    renderSwitcher('hotcrm');
    expect(menu().queryByTestId('app-switcher-settings')).not.toBeInTheDocument();
    expect(menu().getByTestId('app-switcher-row-hotcrm')).toBeInTheDocument();
    expect(menu().getByTestId('app-switcher-row-hotcrm_service')).toBeInTheDocument();
  });
});

describe('below `sm` the pill is the glyph alone, named in its tooltip (objectui#12605)', () => {
  it('the name and the chevron are `sm` and up; the title names the app at every width', () => {
    renderSwitcher('hotcrm');
    const pill = screen.getByTestId('app-switcher-trigger');
    expect(pill).toHaveAttribute('title', 'HotCRM');
    expect(screen.getByRole('button', { name: 'HotCRM' })).toBe(pill);
    const name = within(pill).getByText('HotCRM');
    expect(name.className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'sm:inline']));
    const chevron = pill.querySelector('svg.lucide-chevron-down')!;
    expect(chevron.getAttribute('class')!.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'sm:block']));
    expect(within(pill).getByTestId('app-mark-tile').className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });
});
