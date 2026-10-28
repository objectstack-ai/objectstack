// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26838 — the App Switcher's menu offers what Home's tiles offer:
 * the active `/meta/app` list narrowed by the user's `GET /me/apps` answer, so
 * an app a permission set hides (`tabPermissions: hidden`) is not in it. The
 * pill still names that app while the user is in it — it opens from a URL.
 *
 * The menu harness is `AppSwitcher.publishState.test.tsx`'s.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Passthrough dropdown primitives so the menu CONTENT renders without an
// interaction — the same idiom as WorkspaceSwitcher.test.tsx. What is under
// measurement is which apps reach the list, not radix's open/close machinery.
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DropdownMenu: (p: any) => <div>{p.children}</div>,
  DropdownMenuTrigger: (p: any) => <div>{p.children}</div>,
  // Scoped: the trigger renders the ACTIVE app's label too, so an unscoped
  // `getByText` would match twice. Every assertion below reads the LIST.
  DropdownMenuContent: (p: any) => <div data-testid="app-switcher-menu">{p.children}</div>,
  DropdownMenuItem: ({ onClick, children }: any) => <div onClick={onClick}>{children}</div>,
  DropdownMenuLabel: (p: any) => <div {...p} />,
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChevronDown: () => <span />,
  Check: () => <span data-testid="active-check" />,
}));
// `getIcon` wraps lucide's DynamicIcon (a per-icon dynamic import); stub it so
// no unbounded module load races the assertions.
vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => <span /> }));

// Spread the real module rather than replacing it: other modules in this graph
// import further exports from it, and a bare factory would blank them out.
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

// Keep the real route-segment matching (`appRouteSegment` / `matchAppBySegment`);
// only the keyed-i18n resolver is stubbed.
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

import { AppSwitcher } from '../AppSwitcher';
import { LauncherAppsProvider } from '../../hooks/useLauncherApps';

/** A `/me/apps` double: the listed names, or a bare status. */
function meApps(answer: string[] | number) {
  return vi.fn(async (_url: unknown) =>
    typeof answer === 'number'
      ? new Response('{}', { status: answer })
      : new Response(JSON.stringify({ apps: answer.map((name) => ({ name })) }), { status: 200 }),
  );
}

async function renderSwitcher(fetcher: unknown, active = 'crm') {
  render(
    <MemoryRouter>
      <LauncherAppsProvider endpoint="/me-apps-double" fetcher={fetcher as typeof fetch}>
        <AppSwitcher activeAppName={active} onAppChange={vi.fn()} />
      </LauncherAppsProvider>
    </MemoryRouter>,
  );
  // Let the double's answer land and be drawn.
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return within(screen.getByTestId('app-switcher-menu'));
}

beforeEach(() => {
  apps = [
    { name: 'crm', label: 'CRM' },
    { name: 'showcase_app', label: 'Showcase' },
    { name: 'ops', label: 'Ops' },
  ];
});

afterEach(() => {
  cleanup();
});

describe('AppSwitcher offers only the apps /me/apps lists (objectstack#26838)', () => {
  it('an app the member’s set hides is not in the menu', async () => {
    const menu = await renderSwitcher(meApps(['crm', 'ops']));
    expect(menu.getByText('CRM')).toBeInTheDocument();
    expect(menu.getByText('Ops')).toBeInTheDocument();
    expect(menu.queryByText('Showcase')).toBeNull();
  });

  it('CONTROL — a 404 (no security plugin) offers every app, as before', async () => {
    const menu = await renderSwitcher(meApps(404));
    expect(menu.getByText('Showcase')).toBeInTheDocument();
  });

  it('the pill still names a hidden app while the user is in it', async () => {
    const menu = await renderSwitcher(meApps(['crm', 'ops']), 'showcase_app');
    expect(screen.getByTestId('app-switcher-trigger')).toHaveAttribute('title', 'Showcase');
    expect(menu.queryByText('Showcase')).toBeNull();
  });
});
