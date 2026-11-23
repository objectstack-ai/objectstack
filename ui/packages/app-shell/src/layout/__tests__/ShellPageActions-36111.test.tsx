// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The page's top-right button group (objectstack#36111): comments slot,
 * AI, help, placed by the shell.
 *
 * - The shell decides: on in a scope unless the scope turns it off
 *   (objectstack#36112: no top bar carries the buttons any more), never
 *   outside a scope or on a phone.
 * - The console `PageHeader` draws it after the page's own actions, behind a
 *   hairline; turned off, the header is exactly what it was.
 * - objectstack#36485 — it carries nothing that edits the app: no
 *   「Edit app」 and no 「Open {app} in Studio」, for a writable package, a
 *   read-only one, and under a shell that holds the design mode (the
 *   app-name menu is the way in, `SidebarAppMenu-36112.test.tsx`).
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

/** What the session's auth answers beyond the real hook: the deployment's posture, the platform operator flag. */
const authOverride = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@object-ui/auth', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the real module, spread whole
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
    useAuth: () => ({ ...actual.useAuth(), ...authOverride.value }),
  };
});

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

  it('in order: the comments slot, then help (AI only where the server serves it)', async () => {
    await mount(
      <ShellPageActionsScope on>
        <ShellPageActions comments={<span data-testid="comments-slot" />} />
      </ShellPageActionsScope>,
    );
    const group = screen.getByTestId('shell-page-actions');
    const ids = Array.from(group.children).map((c) => c.getAttribute('data-testid'));
    expect(ids).toEqual(['comments-slot', 'shell-page-actions-help']);
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

describe('the group carries no 「Edit app」 and no 「Open APP in Studio」 (objectstack#36485)', () => {
  /** The shell's hold on the mode, as `ConsoleLayout` keeps it, and whether it is on. */
  function Shell({ children }: { children: React.ReactNode }) {
    const mode = useDesignModeController({ appName: 'cloud_control', appBasePath: '/apps/cloud_control', enabled: true });
    return <DesignModeProvider value={mode}>{children}</DesignModeProvider>;
  }
  const bare = (
    <ShellPageActionsScope on>
      <ShellPageActions />
    </ShellPageActionsScope>
  );
  const held = <Shell>{bare}</Shell>;

  /** Neither entry, by test id or by name; help stays. */
  function expectNoAppEntry() {
    const group = screen.getByTestId('shell-page-actions');
    expect(within(group).queryByTestId('shell-page-actions-edit-app')).toBeNull();
    expect(within(group).queryByTestId('shell-page-actions-view-app')).toBeNull();
    expect(within(group).queryByRole('button', { name: 'Edit app' })).toBeNull();
    expect(within(group).queryByRole('link', { name: 'Edit app' })).toBeNull();
    expect(within(group).queryByRole('link', { name: 'Open Cloud in Studio' })).toBeNull();
    expect(within(group).getByTestId('shell-page-actions-help')).toBeInTheDocument();
  }

  it('to an author, on a writable package and on a read-only (installed) one, with and without a shell holding the design mode', async () => {
    for (const isWritable of [true, false]) {
      for (const node of [bare, held]) {
        writable = isWritable;
        await mount(node);
        expectNoAppEntry();
        cleanup();
      }
    }
  });

  it('where the customization door is walled off, a read-only package gets no eye into Studio either', async () => {
    writable = false;
    authOverride.value = { getAuthConfig: async () => ({ features: { tenancyPosture: 'isolated' } }), user: { isPlatformAdmin: false } };
    try {
      await mount(held);
      expectNoAppEntry();
    } finally {
      authOverride.value = {};
    }
  });

  it('control: the group itself is still drawn for a member, with help', async () => {
    await mount(held, { who: MEMBER });
    expectNoAppEntry();
  });
});
