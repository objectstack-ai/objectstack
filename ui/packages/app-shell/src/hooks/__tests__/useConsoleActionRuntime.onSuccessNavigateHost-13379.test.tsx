/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13379 — the console action runtime's navigator hosts an
 * app-relative path under the current app, the way the inbox does.
 *
 * An action declaring `onSuccess: { navigate: '/crm_opportunity/${result.id}' }`
 * succeeded and `ActionRunner.navigateOnSuccess` handed the path to this
 * runtime's `navigateHandler` unchanged. Under the console's `/_console`
 * basename that path matches no route, and the catch-all sent the user to Home
 * instead of the record they had just created.
 *
 * The handler now sorts the path with the inbox's resolver,
 * `resolveNotificationTarget` (objectui#5179), under the app
 * `resolveHostAppSegment` names. Pinned here, through the real hook:
 *
 *   - app-relative (`/object/record/id` and the `/object/id` shorthand) →
 *     hosted under the current app's route segment;
 *   - already `/apps/…` → unchanged;
 *   - external (`https://…`) → a new tab, never the router; `mailto:` → never
 *     hosted;
 *   - a console route outside an app (`/forms/:name`, which the runner's own
 *     `type: 'form'` hands this handler, `/home`, …) → unchanged, read off the
 *     console's route table so a new top-level route cannot be hosted
 *     unnoticed;
 *   - no app current (Home, or before the shell publishes one) → the first
 *     active app, the same answer the inbox gives.
 *
 * objectui#13433 — a caller rendering under an app route passes that route's
 * app (`routeAppSegment`), and only then does a `/forms/:name` hop open in the
 * app, at `/apps/<app>/forms/<name>`. Without it — the console-wide runtime —
 * the form keeps the app-less route above, whatever app the shell published.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateSpy }));

const authFetchSpy = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectLabel: () => ({
    fieldLabel: (_o: any, _n: any, l: any) => l,
    fieldOptionLabel: (_o: any, _f: any, _v: any, l: any) => l,
    actionParamText: (_o: any, _a: any, _p: any, _attr: any, fallback: any) => fallback,
    actionParamOptionLabel: (_o: any, _a: any, _p: any, _v: any, fallback: any) => fallback,
    actionDescription: (_o: any, _a: any, fallback: any) => fallback,
  }),
  useObjectTranslation: () => ({
    t: (key: string, options?: any) => String(options?.defaultValue ?? key),
  }),
}));

// The app the shell publishes (`ConsoleLayout` sets it inside `/apps/:appName/*`).
let currentAppName: string | undefined;
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName }),
}));

// Inert stubs: the modal transport and the dialogs are not exercised here.
vi.mock('../useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(async () => ({ success: true })),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));
vi.mock('../../views/ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('../../views/ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('../../views/ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('../../views/FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('sonner', () => {
  const fn: any = vi.fn();
  fn.error = vi.fn();
  fn.success = vi.fn();
  return { toast: fn };
});

import { useConsoleActionRuntime, ConsoleActionRuntimeProvider } from '../useConsoleActionRuntime';
import { MetadataCtx, useAction } from '@object-ui/react';

// A setup app first in metadata order, then the business app whose route
// segment is its package id (ADR-0048), not its `name`.
const SETUP_APP = { name: 'setup', _packageId: 'com.objectstack.setup' };
const CRM_APP = { name: 'crm', _packageId: 'com.acme.crm' };
let apps: Record<string, unknown>[] = [];

function metadataValue(): any {
  return {
    apps,
    objects: [],
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  };
}

function Metadata({ children }: { children: React.ReactNode }) {
  return <MetadataCtx.Provider value={metadataValue()}>{children}</MetadataCtx.Provider>;
}

/** The handler the runtime hands `<ActionProvider onNavigate>`. */
function navigatorFor(routeAppSegment?: string) {
  const { result } = renderHook(() => useConsoleActionRuntime({ dataSource: {}, objects: [], routeAppSegment }), {
    wrapper: Metadata,
  });
  return result.current.navigateHandler;
}

const openSpy = vi.fn();

beforeEach(() => {
  navigateSpy.mockReset();
  authFetchSpy.mockReset();
  openSpy.mockReset();
  vi.stubGlobal('open', openSpy);
  apps = [SETUP_APP, CRM_APP];
  currentAppName = 'crm';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('navigateHandler — an app-relative path is hosted under the current app (objectui#13379)', () => {
  it('hosts a record path under the current app’s route segment', () => {
    navigatorFor()('/crm_opportunity/record/opp_42', { external: false, newTab: false });

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/crm_opportunity/record/opp_42');
  });

  it('hosts the `/object/id` shorthand too — the app router redirects it to the record', () => {
    navigatorFor()('/crm_opportunity/opp_42', { external: false, newTab: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/crm_opportunity/opp_42');
  });

  it('keeps the query string and hash of a hosted path', () => {
    navigatorFor()('/crm_opportunity/record/opp_42?tab=lines#notes', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/crm_opportunity/record/opp_42?tab=lines#notes');
  });

  it('with no app current (Home, or before the shell publishes one) hosts under the first active app', () => {
    currentAppName = undefined;

    navigatorFor()('/crm_opportunity/record/opp_42', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.objectstack.setup/crm_opportunity/record/opp_42');
  });

  it('does not host under a remembered app that has since been deactivated', () => {
    apps = [{ ...CRM_APP, active: false }, { name: 'hr', _packageId: 'com.acme.hr' }];

    navigatorFor()('/crm_opportunity/record/opp_42', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.hr/crm_opportunity/record/opp_42');
  });
});

describe('navigateHandler — the shapes that already worked stay as they are (objectui#13379)', () => {
  it('passes an app-qualified `/apps/<app>/…` path to the router unchanged', () => {
    navigatorFor()('/apps/acme/crm_opportunity/record/opp_42', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/acme/crm_opportunity/record/opp_42');
  });

  it('opens an external URL in a new tab and never hands it to the router', () => {
    navigatorFor()('https://status.example.com/incident/7', { external: true, newTab: true });

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith('https://status.example.com/incident/7', '_blank', 'noopener,noreferrer');
  });

  it('never hosts a `mailto:` address', () => {
    navigatorFor()('mailto:ops@example.com', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('mailto:ops@example.com');
  });

  it('leaves a `./` path to the router’s own relative resolution', () => {
    navigatorFor()('./record/opp_42', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('./record/opp_42');
  });
});

/**
 * The console routes outside an app, read off the route table itself: every
 * top-level `path="/…"` in `apps/console/src/App.tsx` and in the `/studio`
 * subtree it mounts. A top-level route added there that the handler would host
 * fails here.
 */
function consoleRootSegments(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // packages/app-shell/src/hooks/__tests__  ->  repo root
  const repoRoot = path.resolve(here, '../../../../..');
  const files = ['apps/console/src/App.tsx', 'apps/console/src/components/StudioRoute.tsx'];
  const segments = new Set<string>();
  for (const file of files) {
    const source = readFileSync(path.join(repoRoot, file), 'utf8');
    for (const m of source.matchAll(/path="\/([^/"]*)/g)) segments.add(m[1]);
  }
  return [...segments].sort();
}

describe('navigateHandler — a console route outside an app is never hosted (objectui#13379)', () => {
  const roots = consoleRootSegments();

  it('reads the console route table (control: the routes this pin depends on are in it)', () => {
    expect(roots).toEqual(expect.arrayContaining(['', 'apps', 'forms', 'home', 'studio']));
  });

  it.each(roots)('leaves `/%s/…` exactly as written', (segment) => {
    const to = segment === '' ? '/' : `/${segment}/probe?x=1`;
    navigatorFor()(to, { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe(to);
  });
});

describe('through the real runner (objectui#13379)', () => {
  function Probe({ action }: { action: Record<string, unknown> }) {
    const { execute } = useAction();
    return <button onClick={() => void execute(action as any)}>run</button>;
  }

  function run(action: Record<string, unknown>) {
    render(
      <Metadata>
        <ConsoleActionRuntimeProvider dataSource={{}} objects={[]}>
          <Probe action={action} />
        </ConsoleActionRuntimeProvider>
      </Metadata>,
    );
    fireEvent.click(screen.getByText('run'));
  }

  it('an `onSuccess.navigate` with no app segment opens the created record in the current app', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: 'opp_42' }) });

    run({
      type: 'api',
      name: 'create_opportunity',
      target: '/api/v1/crm/opportunities',
      onSuccess: { navigate: '/crm_opportunity/${result.id}', openIn: 'self' },
    });

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/crm_opportunity/opp_42');
  });

  it('a `type: \'form\'` action still opens the console’s `/forms/:name` route', async () => {
    run({ type: 'form', name: 'log_time', target: 'time_entry_form' });

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(navigateSpy.mock.calls[0][0]).toBe('/forms/time_entry_form');
  });
});

describe('navigateHandler — a form opens in the caller’s app route (objectui#13433)', () => {
  it('with `routeAppSegment`, hosts `/forms/:name` under that app, query string kept', () => {
    navigatorFor('com.acme.crm')('/forms/time_entry_form?recordId=t1&recordObject=task', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/forms/time_entry_form?recordId=t1&recordObject=task');
  });

  it('hosts under the route’s app, not the shell’s published one', () => {
    currentAppName = 'com.objectstack.setup';

    navigatorFor('com.acme.crm')('/forms/time_entry_form', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/forms/time_entry_form');
  });

  it('`routeAppSegment` moves no other console route', () => {
    navigatorFor('com.acme.crm')('/home', { external: false });

    expect(navigateSpy.mock.calls[0][0]).toBe('/home');
  });

  it('through the real runner, a `type: \'form\'` action under an app route opens in that app', async () => {
    function Probe() {
      const { execute } = useAction();
      return <button onClick={() => void execute({ type: 'form', name: 'log_time', target: 'time_entry_form' } as any)}>run</button>;
    }
    render(
      <Metadata>
        <ConsoleActionRuntimeProvider dataSource={{}} objects={[]} routeAppSegment="com.acme.crm">
          <Probe />
        </ConsoleActionRuntimeProvider>
      </Metadata>,
    );
    fireEvent.click(screen.getByText('run'));

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/com.acme.crm/forms/time_entry_form');
  });
});
