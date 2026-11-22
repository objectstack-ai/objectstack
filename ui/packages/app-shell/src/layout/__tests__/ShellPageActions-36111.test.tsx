// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The page's top-right button group (objectstack#36111): comments slot,
 * 「Edit app」, AI, help, placed by the shell.
 *
 * - The shell decides: on in a scope unless the scope turns it off
 *   (objectstack#36112: no top bar carries the buttons any more), never
 *   outside a scope or on a phone.
 * - The console `PageHeader` draws it after the page's own actions, behind a
 *   hairline; turned off, the header is exactly what it was.
 * - 「Edit app」 reads the top bar pencil's gate and opens its target
 *   (`useAppStudioEntry`): words beside an icon that is not the pencil, the
 *   words dropped below `lg`; a read-only package gets the eye; a caller
 *   without `manage_metadata` gets nothing.
 *
 * Real subjects: `ShellPageActionsScope`, `ShellPageActions`, `PageHeader`,
 * under the real `MePermissionsProvider` and a router at a page route; the
 * package list is the stubbed `fetch`, the workspace-admin flag the stubbed
 * axis, as in the objectui#10899 pins.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      String(o?.defaultValue ?? k).replace('{{app}}', String(o?.app ?? '')),
    language: 'en',
  }),
}));

const APP = { name: 'cloud_control', label: 'Cloud', _packageId: 'com.objectstack.cloud' };
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [APP], objects: [], pages: [] }),
}));

import {
  ShellPageActions,
  ShellPageActionsScope,
} from '../ShellPageActions';
import { PageHeader } from '../PageHeader';
import { DesignModeProvider, useDesignModeController } from '../designMode';
import { appStudioRoutePath } from '../../utils/appRoute';

function permissions(systemPermissions: string[]): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 'org_1',
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
    permissionSets: [],
    systemPermissions,
    objects: {},
    fields: {},
  };
}
const AUTHOR = permissions(['manage_metadata', 'studio.access', 'setup.access']);
const MEMBER = permissions([]);

let writable = true;

async function mount(node: React.ReactNode, { who = AUTHOR, route = '/apps/cloud_control/page/welcome' } = {}) {
  const view = render(
    <MePermissionsProvider initialPermissions={who}>
      <MemoryRouter initialEntries={[route]}>{node}</MemoryRouter>
    </MePermissionsProvider>,
  );
  // The package list's verdict settled, so an absent button is a reading.
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  return view;
}

const setWidth = (value: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value });

beforeEach(() => {
  writable = true;
  setWidth(1280);
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith('/api/v1/packages')
          ? { data: { packages: [{ manifest: { id: 'com.objectstack.cloud', name: 'Cloud' }, writable }] } }
          : { data: [] },
    })),
  );
});

afterEach(() => {
  cleanup();
  setWidth(1024);
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('the shell decides whether the group is drawn (objectstack#36111)', () => {
  it('drawn inside a scope unless it is turned off, never outside one or on a phone', async () => {
    await mount(<ShellPageActions />);
    expect(screen.queryByTestId('shell-page-actions')).not.toBeInTheDocument();
    cleanup();

    // objectstack#36112 — on by default.
    await mount(<ShellPageActionsScope><ShellPageActions /></ShellPageActionsScope>);
    expect(screen.getByTestId('shell-page-actions')).toBeInTheDocument();
    cleanup();

    await mount(<ShellPageActionsScope on={false}><ShellPageActions /></ShellPageActionsScope>);
    expect(screen.queryByTestId('shell-page-actions')).not.toBeInTheDocument();
    cleanup();

    setWidth(375);
    await mount(<ShellPageActionsScope on><ShellPageActions /></ShellPageActionsScope>);
    expect(screen.queryByTestId('shell-page-actions')).not.toBeInTheDocument();
  });

  it('in order: the comments slot, Edit app, then help (AI only where the server serves it)', async () => {
    await mount(
      <ShellPageActionsScope on>
        <ShellPageActions comments={<span data-testid="comments-slot" />} />
      </ShellPageActionsScope>,
    );
    const group = screen.getByTestId('shell-page-actions');
    const ids = Array.from(group.children).map((c) => c.getAttribute('data-testid'));
    expect(ids).toEqual(['comments-slot', 'shell-page-actions-edit-app', 'shell-page-actions-help']);
  });
});

describe('the console page header places the group (objectstack#36111)', () => {
  it('after the page\'s own actions, behind a hairline', async () => {
    await mount(
      <ShellPageActionsScope on>
        <PageHeader title="Reports" actions={<button type="button" data-testid="own-action">New</button>} />
      </ShellPageActionsScope>,
    );
    const cluster = screen.getByTestId('page-header-actions');
    const ids = Array.from(cluster.children).map((c) => c.getAttribute('data-testid'));
    expect(ids).toEqual(['own-action', 'page-header-shell-divider', 'shell-page-actions']);
  });

  it('a header with no actions of its own draws the group alone, no hairline', async () => {
    await mount(
      <ShellPageActionsScope on>
        <PageHeader title="Reports" />
      </ShellPageActionsScope>,
    );
    const cluster = screen.getByTestId('page-header-actions');
    expect(Array.from(cluster.children).map((c) => c.getAttribute('data-testid'))).toEqual(['shell-page-actions']);
  });

  it('turned off, the header is what it was: no group, no hairline, and no action cluster when it has no actions', async () => {
    await mount(
      <ShellPageActionsScope on={false}>
        <PageHeader title="Reports" actions={<button type="button" data-testid="own-action">New</button>} />
      </ShellPageActionsScope>,
    );
    expect(screen.queryByTestId('shell-page-actions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('page-header-shell-divider')).not.toBeInTheDocument();
    cleanup();
    await mount(
      <ShellPageActionsScope on={false}>
        <PageHeader title="Reports" />
      </ShellPageActionsScope>,
    );
    expect(screen.queryByTestId('page-header-actions')).not.toBeInTheDocument();
  });
});

describe('「Edit app」 in the group opens what the top bar pencil opens (objectstack#36111)', () => {
  const group = (
    <ShellPageActionsScope on>
      <ShellPageActions />
    </ShellPageActionsScope>
  );

  it('on a page route: the page\'s surface in Studio, the pencil\'s own derivation', async () => {
    await mount(group);
    const link = screen.getByTestId('shell-page-actions-edit-app');
    expect(link.getAttribute('href')).toBe('/studio/com.objectstack.cloud/interfaces?surface=page:welcome');
    expect(link.getAttribute('href')).toBe(appStudioRoutePath(APP, true, { type: 'page', name: 'welcome' }));
  });

  it('on an object route: the package Studio opens for the app, as the pencil does', async () => {
    await mount(group, { route: '/apps/cloud_control/crm_lead' });
    expect(screen.getByTestId('shell-page-actions-edit-app').getAttribute('href')).toBe(
      appStudioRoutePath(APP, true, { type: 'crm_lead', name: undefined }),
    );
  });

  it('its words beside an icon that is not the pencil, the words dropped below `lg` with the tooltip keeping them', async () => {
    await mount(group);
    const link = screen.getByTestId('shell-page-actions-edit-app');
    expect(link).toHaveAccessibleName('Edit app');
    expect(link.getAttribute('title')).toBe('Edit app');
    expect(link.querySelector('svg.lucide-blocks')).not.toBeNull();
    expect(link.querySelector('svg.lucide-pencil')).toBeNull();
    const words = within(link).getByText('Edit app');
    expect(words.className).toContain('hidden');
    expect(words.className).toContain('lg:inline');
  });

  it('a read-only package: the top bar\'s eye and 「Open APP in Studio」, never the edit', async () => {
    writable = false;
    await mount(group);
    expect(screen.queryByTestId('shell-page-actions-edit-app')).not.toBeInTheDocument();
    expect(screen.getByTestId('shell-page-actions-view-app')).toHaveAccessibleName('Open Cloud in Studio');
  });

  it('a caller without `manage_metadata` gets no Studio entry; help stays', async () => {
    await mount(group, { who: MEMBER });
    expect(screen.queryByTestId('shell-page-actions-edit-app')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shell-page-actions-view-app')).not.toBeInTheDocument();
    expect(screen.getByTestId('shell-page-actions-help')).toBeInTheDocument();
  });
});

describe('「Edit app」 turns the shell\'s design mode on instead of opening Studio (objectstack#36362)', () => {
  /** The shell's hold on the mode, as `ConsoleLayout` keeps it, and whether it is on. */
  function Shell({ children }: { children: React.ReactNode }) {
    const mode = useDesignModeController({ appName: 'cloud_control', appBasePath: '/apps/cloud_control', enabled: true });
    return (
      <DesignModeProvider value={mode}>
        <output data-testid="mode">{mode.active ? 'on' : 'off'}</output>
        {children}
      </DesignModeProvider>
    );
  }
  const group = (
    <Shell>
      <ShellPageActionsScope on>
        <ShellPageActions />
      </ShellPageActionsScope>
    </Shell>
  );

  it('a button, not a link: a press turns the mode on in place, and the button is gone while it is on', async () => {
    await mount(group);
    const button = screen.getByTestId('shell-page-actions-edit-app');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('href')).toBeNull();
    expect(button).toHaveAccessibleName('Edit app');
    expect(button.querySelector('svg.lucide-blocks')).not.toBeNull();
    expect(screen.getByTestId('mode')).toHaveTextContent('off');

    await act(async () => button.click());
    expect(screen.getByTestId('mode')).toHaveTextContent('on');
    expect(screen.queryByTestId('shell-page-actions-edit-app')).not.toBeInTheDocument();
    expect(screen.getByTestId('shell-page-actions-help')).toBeInTheDocument();
  });

  it('the gate is unchanged: a caller without `manage_metadata` gets no 「Edit app」', async () => {
    await mount(group, { who: MEMBER });
    expect(screen.queryByTestId('shell-page-actions-edit-app')).not.toBeInTheDocument();
  });

  it('a read-only package keeps the eye into Studio', async () => {
    writable = false;
    await mount(group);
    expect(screen.queryByTestId('shell-page-actions-edit-app')).not.toBeInTheDocument();
    expect(screen.getByTestId('shell-page-actions-view-app')).toHaveAccessibleName('Open Cloud in Studio');
  });
});
