// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12913 — a host can ask for no app switcher when the viewer is
 * served one app.
 *
 * The rule has two halves, and each is asked through its real owner:
 *   - the REQUEST is the runtime config's `hideSingleAppSwitcher`, read here
 *     through the real loader (`initRuntimeConfig` over a stubbed
 *     `GET /api/v1/runtime/config`), so the key is pinned from the wire in;
 *   - the COUNT is `AppSwitcher`'s own: one active, un-hidden app in the
 *     viewer's list, the same list its menu draws.
 *
 * With both: no pill trigger and no menu, so no 「All apps」; the app's glyph
 * and name stand in the pill's place.
 *
 * CONTROLS: a viewer served two apps keeps the switcher; a viewer served Setup
 * as well keeps it, with its 「Settings」 row; a payload without the key keeps
 * today's pill and its rows.
 *
 * The dropdown primitives pass through, as in `AppSwitcher.homeMenu-12605`, so
 * a drawn menu's rows are in the tree without radix's open machinery.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';

const CLOUD = { name: 'cloud_control', label: 'Cloud', icon: 'cloud' };
const CLOUD_ADMIN = { name: 'platform_admin', label: 'Cloud Admin', icon: 'shield' };
// Reached from the avatar menu, never the switcher: `hidden: true`.
const ACCOUNT = { name: 'account', label: 'Account', icon: 'user', hidden: true };
const RETIRED = { name: 'legacy', label: 'Legacy', icon: 'archive', active: false };
const SETUP = { name: 'setup', label: 'Setup', icon: 'settings', _packageId: 'com.objectstack.setup' };

/** Serve `payload` as `GET /api/v1/runtime/config` and run the real loader over it. */
async function serveRuntimeConfig(payload: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })),
  );
  await initRuntimeConfig();
}

function renderSwitcher(active: string) {
  return render(
    <MemoryRouter>
      <AppSwitcher activeAppName={active} onAppChange={vi.fn()} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  resetRuntimeConfigForTesting();
  vi.unstubAllGlobals();
});

describe('the host asked, and the viewer is served one app (objectui#12913)', () => {
  it('draws no pill, no menu and no 「All apps」; the app\'s glyph and name stand in its place', async () => {
    await serveRuntimeConfig({ hideSingleAppSwitcher: true });
    // One active, un-hidden app: the hidden and the inactive ones do not count.
    apps = [CLOUD, ACCOUNT, RETIRED];
    renderSwitcher('cloud_control');

    expect(screen.queryByTestId('app-switcher-trigger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-switcher-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-switcher-all-apps')).not.toBeInTheDocument();
    expect(screen.queryByText('All apps')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    const identity = screen.getByTestId('app-switcher-single-app');
    expect(identity).toHaveAttribute('title', 'Cloud');
    expect(within(identity).getByText('Cloud')).toBeInTheDocument();
    expect(within(identity).getByTestId('app-mark-tile')).toBeInTheDocument();
    expect(identity.querySelector('svg.lucide-chevron-down')).toBeNull();
  });

  it('below `sm` the glyph is drawn alone and the name is left to assistive technology', async () => {
    await serveRuntimeConfig({ hideSingleAppSwitcher: true });
    apps = [CLOUD];
    renderSwitcher('cloud_control');

    const name = within(screen.getByTestId('app-switcher-single-app')).getByText('Cloud');
    expect(name.className.split(/\s+/)).toEqual(expect.arrayContaining(['max-sm:sr-only', 'truncate']));
    expect(name.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });
});

describe('CONTROLS (objectui#12913)', () => {
  it('a viewer served two apps keeps the switcher and its 「All apps」', async () => {
    await serveRuntimeConfig({ hideSingleAppSwitcher: true });
    apps = [CLOUD, CLOUD_ADMIN, ACCOUNT];
    renderSwitcher('cloud_control');

    expect(screen.queryByTestId('app-switcher-single-app')).not.toBeInTheDocument();
    expect(screen.getByTestId('app-switcher-trigger')).toHaveAttribute('title', 'Cloud');
    const menu = within(screen.getByTestId('app-switcher-menu'));
    expect(menu.getByTestId('app-switcher-row-cloud_control')).toBeInTheDocument();
    expect(menu.getByTestId('app-switcher-row-platform_admin')).toBeInTheDocument();
    expect(menu.getByTestId('app-switcher-all-apps')).toHaveTextContent('All apps');
  });

  it('a viewer served Setup as well keeps the switcher and its 「Settings」 row', async () => {
    await serveRuntimeConfig({ hideSingleAppSwitcher: true });
    apps = [CLOUD, SETUP];
    renderSwitcher('cloud_control');

    expect(screen.queryByTestId('app-switcher-single-app')).not.toBeInTheDocument();
    expect(screen.getByTestId('app-switcher-trigger')).toBeInTheDocument();
    expect(within(screen.getByTestId('app-switcher-menu')).getByTestId('app-switcher-settings')).toBeInTheDocument();
  });

  it('without the key, a viewer served one app keeps today\'s pill and its rows', async () => {
    await serveRuntimeConfig({ singleEnvironment: true });
    apps = [CLOUD, ACCOUNT];
    renderSwitcher('cloud_control');

    expect(screen.queryByTestId('app-switcher-single-app')).not.toBeInTheDocument();
    expect(screen.getByTestId('app-switcher-trigger')).toHaveAttribute('title', 'Cloud');
    const menu = within(screen.getByTestId('app-switcher-menu'));
    expect(menu.getByTestId('app-switcher-row-cloud_control')).toBeInTheDocument();
    expect(menu.getByTestId('app-switcher-home')).toHaveTextContent('Back to home');
    expect(menu.getByTestId('app-switcher-all-apps')).toHaveTextContent('All apps');
  });
});
