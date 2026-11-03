// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29119 — the app → Studio entries read `GET /api/v1/packages`
 * once per session, not once per app page.
 *
 * The app bar's pencil, the sidebar's Design entry and a page's pencil ask
 * `useStudioEntryGate` / `useStudioDesignGate` about the package of every app
 * page a platform admin opens, and the list is the largest response such a
 * page reads. It was read again on every app switch, and twice on one page
 * when a reader mounted after the first read had settled.
 *
 * Counted on the wire: the stubbed `fetch` records every request, and the
 * readers are the real hooks under the real `packages-io` reads. The two
 * principal answers are stand-ins, as in the gate's other tests.
 *
 * Pinned here:
 *   - an admin page's readers, mounted in one commit or after the read has
 *     settled, send one list read;
 *   - an app switch sends none;
 *   - a package write this tab makes (a duplicate, the packages-changed
 *     announcement, an ensured customization pair, a marketplace install or
 *     uninstall) forgets the list, and the next ask reads again;
 *   - a read still on the wire when a write lands is not held;
 *   - an id the held list does not name is read again, once;
 *   - another user or organization reads its own list;
 *   - a non-admin, and an admin the server refuses authoring, send none;
 *   - Studio's own `fetchPackages` still holds nothing.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';

const viewer = vi.hoisted(() => ({
  isAdmin: true,
  canAuthorMetadata: true,
  userId: 'usr_admin',
  orgId: 'org_a',
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: true }),
  useAuth: () => ({ user: { id: viewer.userId }, activeOrganization: { id: viewer.orgId } }),
}));
vi.mock('./useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => viewer.canAuthorMetadata,
}));

import { useStudioDesignGate, useStudioEntryGate } from './useStudioDesignGate';
import {
  duplicatePackage,
  ensureCustomizationPackage,
  fetchPackages,
} from '../views/studio-design/packages-io';
import { installLocal, uninstallLocal } from '../console/marketplace/marketplaceApi';

const CRM = '/studio/com.example.crm';
const HR = '/studio/com.example.hr';
const HOTCRM = '/studio/app.objectstack.hotcrm';
const SETUP = '/studio/com.objectstack.setup';
const NEW_BASE = '/studio/com.example.new_base';

/** One list as `GET /api/v1/packages` serves it. */
function listBody(extra: Array<Record<string, unknown>> = []) {
  return {
    success: true,
    data: {
      packages: [
        { manifest: { id: 'com.objectstack.setup', name: 'Setup', scope: 'system' }, writable: false },
        { manifest: { id: 'app.objectstack.hotcrm', name: 'HotCRM', scope: 'project' }, writable: false },
        { manifest: { id: 'com.example.crm', name: 'CRM' }, writable: true },
        { manifest: { id: 'com.example.hr', name: 'HR' }, writable: true },
        ...extra,
      ],
    },
  };
}

interface Request {
  method: string;
  url: string;
}

let requests: Request[] = [];
let served: () => unknown = () => listBody();
let held: Array<() => void> = [];
let holdListReads = false;

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const listReads = () => requests.filter((r) => r.method === 'GET' && r.url === '/api/v1/packages').length;

beforeEach(() => {
  viewer.isAdmin = true;
  viewer.canAuthorMetadata = true;
  viewer.userId = 'usr_admin';
  viewer.orgId = 'org_a';
  requests = [];
  served = () => listBody();
  held = [];
  holdListReads = false;
  // A fresh transport per test: the hold is per `fetch`, so no test reads another's.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = String(input);
      requests.push({ method, url });
      if (method === 'GET' && url === '/api/v1/packages') {
        const body = served();
        if (holdListReads) {
          return new Promise<Response>((resolve) => held.push(() => resolve(respond(body))));
        }
        return respond(body);
      }
      if (url.endsWith('/duplicate')) {
        return respond({ success: true, data: { success: true, copiedCount: 1, failedCount: 0 } });
      }
      if (url.endsWith('/ensure-customization')) {
        return respond({
          success: true,
          data: {
            basePackageId: 'app.objectstack.hotcrm',
            packageId: 'app.objectstack.hotcrm.custom',
            namespace: 'hotcrm_custom',
            dependencyRange: '^6',
            created: false,
            writable: true,
          },
        });
      }
      if (url.includes('/install-local')) {
        return respond({ success: true, data: { manifestId: 'com.example.installed' } });
      }
      return respond({ success: true, data: [] });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every read the stub answers has settled. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** The app bar's reader: the entry and its posture. */
function AppBar({ path }: { path: string }) {
  const entry = useStudioEntryGate(path);
  return <span data-testid="app-bar">{entry ? entry.posture : 'none'}</span>;
}

/** A sidebar row's or a page pencil's reader: the design half. */
function Design({ path, id }: { path: string; id: string }) {
  const design = useStudioDesignGate(path);
  return <span data-testid={id}>{design ? 'design' : 'none'}</span>;
}

/** One app page: the app bar, two sidebar rows and a page pencil, all asking about `path`. */
function AppPage({ path }: { path: string }) {
  return (
    <>
      <AppBar path={path} />
      <Design path={path} id="row-1" />
      <Design path={path} id="row-2" />
      <Design path={path} id="pencil" />
    </>
  );
}

const postureOf = () => screen.getByTestId('app-bar').textContent;

describe('an admin reads the package list once per session (objectstack#29119)', () => {
  it('one app page sends one list read, readers mounted in one commit or after it settled alike', async () => {
    const { rerender } = render(<AppPage path={CRM} />);
    await settle();
    expect(listReads()).toBe(1);
    expect(postureOf()).toBe('edit');

    // A reader that mounts after the read settled (a page's pencil drawn
    // once its own data arrived) answers from the held list.
    rerender(
      <>
        <AppPage path={CRM} />
        <Design path={CRM} id="late-pencil" />
      </>,
    );
    await settle();
    expect(screen.getByTestId('late-pencil').textContent).toBe('design');
    expect(listReads()).toBe(1);
  });

  it('moving to another app, and back, sends no list read', async () => {
    const { rerender } = render(<AppPage path={CRM} />);
    await settle();
    expect(listReads()).toBe(1);

    for (const path of [HR, HOTCRM, SETUP, CRM, HR]) {
      rerender(<AppPage path={path} />);
      await settle();
    }
    expect(listReads()).toBe(1);

    // The held list still answers each app's own posture.
    rerender(<AppPage path={HOTCRM} />);
    await settle();
    expect(postureOf()).toBe('view');
    rerender(<AppPage path={SETUP} />);
    await settle();
    expect(postureOf()).toBe('none');
    expect(listReads()).toBe(1);
  });

  it('a new page mount in the same session (an app page left and opened again) sends none', async () => {
    render(<AppPage path={CRM} />);
    await settle();
    cleanup();
    render(<AppPage path={HR} />);
    await settle();
    expect(postureOf()).toBe('edit');
    expect(listReads()).toBe(1);
  });
});

describe('a package write forgets the held list, and the next ask reads again (objectstack#29119)', () => {
  const writes: Array<[string, () => Promise<unknown>]> = [
    ['a duplicate', () => duplicatePackage('com.example.crm', 'com.example.crm_copy')],
    ['an ensured customization pair', () => ensureCustomizationPackage('app.objectstack.hotcrm')],
    [
      'the packages-changed announcement (a package created or edited)',
      async () => window.dispatchEvent(new CustomEvent('objectui:packages-changed')),
    ],
    ['a marketplace install', () => installLocal({ packageId: 'com.example.installed' })],
    ['a marketplace uninstall', () => uninstallLocal('com.example.installed')],
  ];

  for (const [name, write] of writes) {
    it(`${name}`, async () => {
      const { rerender } = render(<AppPage path={CRM} />);
      await settle();
      expect(listReads()).toBe(1);

      // The write turns CRM read-only; the next ask must see it.
      served = () => ({
        success: true,
        data: { packages: [{ manifest: { id: 'com.example.crm', name: 'CRM' }, writable: false }] },
      });
      await act(async () => {
        await write();
      });
      rerender(<AppPage path={HR} />);
      rerender(<AppPage path={CRM} />);
      await settle();
      expect(listReads()).toBe(2);
      expect(postureOf()).toBe('view');

      // And the new answer is held in turn.
      rerender(<AppPage path={HR} />);
      await settle();
      expect(listReads()).toBe(2);
    });
  }

  it('a read still on the wire when a write lands answers its callers but is not held', async () => {
    holdListReads = true;
    const { rerender } = render(<AppPage path={CRM} />);
    await settle();
    expect(listReads()).toBe(1);

    await act(async () => {
      await duplicatePackage('com.example.crm', 'com.example.crm_copy');
    });
    held.shift()!();
    await settle();
    expect(postureOf()).toBe('edit');

    holdListReads = false;
    rerender(<AppPage path={HR} />);
    await settle();
    expect(listReads()).toBe(2);
  });
});

describe('what the held list does not name is read again, once (objectstack#29119)', () => {
  it('a package created elsewhere since the list was held gets its entry', async () => {
    const { rerender } = render(<AppPage path={CRM} />);
    await settle();
    expect(listReads()).toBe(1);

    // An agent created a base server-side: nothing in this tab announced it.
    served = () => listBody([{ manifest: { id: 'com.example.new_base', name: 'New' }, writable: true }]);
    rerender(<AppPage path={NEW_BASE} />);
    await settle();
    expect(listReads()).toBe(2);
    expect(postureOf()).toBe('edit');

    rerender(<AppPage path={CRM} />);
    rerender(<AppPage path={NEW_BASE} />);
    await settle();
    expect(listReads()).toBe(2);
  });

  it('an id no list names is read again once, not on every visit', async () => {
    const { rerender } = render(<AppPage path={CRM} />);
    await settle();
    for (let i = 0; i < 3; i++) {
      rerender(<AppPage path="/studio/com.example.gone" />);
      await settle();
      expect(postureOf()).toBe('none');
      rerender(<AppPage path={CRM} />);
      await settle();
    }
    expect(listReads()).toBe(2);
  });
});

describe('the hold is the session\'s (objectstack#29119)', () => {
  it('another organization, or another user, reads its own list', async () => {
    const { rerender } = render(<AppPage path={CRM} />);
    await settle();
    expect(listReads()).toBe(1);

    viewer.orgId = 'org_b';
    served = () => ({
      success: true,
      data: { packages: [{ manifest: { id: 'com.example.crm', name: 'CRM' }, writable: false }] },
    });
    rerender(<AppPage path={CRM} />);
    await settle();
    expect(listReads()).toBe(2);
    expect(postureOf()).toBe('view');

    viewer.userId = 'usr_other_admin';
    rerender(<AppPage path={HR} />);
    await settle();
    expect(listReads()).toBe(3);
  });
});

describe('who sends no list read at all (objectstack#29119)', () => {
  it('a non-admin, on every app page', async () => {
    viewer.isAdmin = false;
    const { rerender } = render(<AppPage path={CRM} />);
    await settle();
    rerender(<AppPage path={HR} />);
    await settle();
    expect(postureOf()).toBe('none');
    expect(listReads()).toBe(0);
  });

  it('an admin the server refuses authoring', async () => {
    viewer.canAuthorMetadata = false;
    render(<AppPage path={CRM} />);
    await settle();
    expect(postureOf()).toBe('none');
    expect(listReads()).toBe(0);
  });
});

describe('Studio\'s own read still holds nothing (objectstack#29119)', () => {
  it('fetchPackages reads the server every time, even with the session\'s list held', async () => {
    render(<AppPage path={CRM} />);
    await settle();
    expect(listReads()).toBe(1);
    await fetchPackages();
    await fetchPackages();
    expect(listReads()).toBe(3);
  });
});
