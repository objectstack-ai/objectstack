// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5243 — the seed entry a FIRST-BOOT browser writes must be readable
 * by the boot that follows it.
 *
 * ## The window
 *
 * `activeOrgScope()` reads `ActiveOrganizationStorage`, which `AuthProvider`
 * only stamps after `getSession` → `listOrganizations` → `getActiveOrganization`
 * resolve. The eager `app` fetch starts at mount and lands first, so on a
 * browser that has never signed in the entry is written under `@none` while
 * every LATER boot computes the real org id — the seed misses forever after,
 * and the `@none` entry is orphaned in `sessionStorage` until the tab closes.
 *
 * ## Why the #4486 pins never saw it
 *
 * `primeCacheFor` in `MetadataProvider.orgScopedCache.test.tsx` stamps the org
 * id BEFORE the first render, which models a RETURNING browser — correctly, for
 * what those pins are about. The window here only exists when storage is empty
 * AT MOUNT and the org arrives afterwards, so the modelling below is the whole
 * point: `firstBoot()` renders with both storages empty and stamps the org only
 * after the app fetch has already landed.
 *
 * ## Why re-keying is sound here (the objectui#5243 tenant-header check)
 *
 * That first fetch goes out with NO `X-Tenant-ID`, because
 * `createAuthenticatedFetch` reads the same empty storage. It does not matter:
 * the server never reads that header for tenant scoping. `resolveAuthzContext`
 * takes `tenantId` from `session.activeOrganizationId` and nothing else
 * (framework `packages/core/src/security/resolve-authz-context.ts`, pinned by
 * `packages/verify/src/harness.org-context.test.ts`: "`session.activeOrganizationId`
 * is the ONE field `resolveAuthzContext` reads into `tenantId`"), and the
 * environment chain reads only the hostname and `X-Environment-Id`. So the
 * response cached under `@none` was computed for exactly the organization
 * `AuthProvider` is about to stamp — the entry is correctly SCOPED and merely
 * mislabelled, which is what makes moving the label the right repair rather
 * than a relabelling of someone else's answer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

/**
 * Same stubbing posture as the #4486 pins: only `useAuth` is faked, because
 * `ActiveOrganizationStorage` IS the mechanism under test.
 */
const authState: { activeOrganization: { id: string } | null } = {
  activeOrganization: null,
};
vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/auth')>();
  return { ...actual, useAuth: () => authState };
});

import { ActiveOrganizationStorage, TokenStorage } from '@object-ui/auth';
import { MetadataProvider, useMetadata } from '../MetadataProvider';

const ORG = 'org_first_login';

interface AppItem {
  name: string;
}

function makeAdapter(opts: { apps: AppItem[] | 'pending'; calls?: string[] }) {
  return {
    clearCache: vi.fn(),
    // objectui#13044 — the real MetadataProvider reads an object by name through
    // the adapter's `getObjectSchema`; this double answers it from its own by-name door.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string) => {
          opts.calls?.push(type);
          if (type !== 'app') return Promise.resolve({ type, items: [] });
          if (opts.apps === 'pending') return new Promise<never>(() => {});
          return Promise.resolve({ type, items: opts.apps });
        },
        getItem: () => Promise.resolve({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

function AppsProbe() {
  const { apps, loading } = useMetadata();
  return (
    <div>
      <span data-testid="apps">{apps.map((a: AppItem) => a.name).join(',')}</span>
      <span data-testid="loading">{String(loading)}</span>
    </div>
  );
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

/** Every `objectui:metadata:app…` entry currently in sessionStorage. */
function cachedAppKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const key = sessionStorage.key(i);
    if (key?.startsWith('objectui:metadata:app')) keys.push(key);
  }
  return keys;
}

/**
 * A browser that has NEVER signed in before, driven through one whole boot.
 *
 * The ordering is the defect: the app fetch is allowed to land while
 * `ActiveOrganizationStorage` is still empty (asserted, not assumed — an
 * accidental pre-stamp would turn this into another returning-browser pin and
 * it would pass against the bug), and only then does the AuthProvider chain
 * resolve and stamp the org.
 */
async function firstBoot(apps: AppItem[], calls?: string[]): Promise<void> {
  // Signed in, but the org is not known to the CLIENT yet: the token lands
  // synchronously at sign-in while the active org costs three more round trips.
  TokenStorage.set('tok_first_login');
  // PRECONDITION — this is what makes the test model a first boot at all.
  expect(ActiveOrganizationStorage.get()).toBeNull();
  authState.activeOrganization = null;

  const adapter = makeAdapter({ apps, calls });
  const view = render(
    <MetadataProvider adapter={adapter}>
      <AppsProbe />
    </MetadataProvider>,
  );
  // The eager `app` fetch resolves here — still with an empty org storage, so
  // the request carried no `X-Tenant-ID` and the write happens in the window.
  await waitFor(() => expect(view.getByTestId('loading').textContent).toBe('false'));
  expect(ActiveOrganizationStorage.get()).toBeNull();

  // Only NOW does `refreshOrganizations` finish and stamp the real org.
  ActiveOrganizationStorage.set(ORG);
  authState.activeOrganization = { id: ORG };
  view.rerender(
    <MetadataProvider adapter={adapter}>
      <AppsProbe />
    </MetadataProvider>,
  );
  await settle();
  view.unmount();
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  ActiveOrganizationStorage.clear();
  authState.activeOrganization = null;
});

afterEach(() => {
  cleanup();
});

describe('MetadataProvider first-boot seed scope (objectui#5243)', () => {
  it('seeds the boot AFTER a first login, instead of missing its own entry', async () => {
    await firstBoot([{ name: 'setup' }, { name: 'crm' }]);

    // Boot 2. `ActiveOrganizationStorage` persists in localStorage, so the org
    // is known at mount now — this is the returning browser the seed exists
    // for. The fetch never lands, so anything rendered came from the seed.
    authState.activeOrganization = { id: ORG };
    expect(ActiveOrganizationStorage.get()).toBe(ORG);

    const view = render(
      <MetadataProvider adapter={makeAdapter({ apps: 'pending' })}>
        <AppsProbe />
      </MetadataProvider>,
    );

    await waitFor(() => expect(view.getByTestId('apps').textContent).toBe('setup,crm'));
    expect(view.getByTestId('loading').textContent).toBe('false');
  });

  it('leaves no orphaned no-org entry behind after the org resolves', async () => {
    await firstBoot([{ name: 'setup' }, { name: 'crm' }]);

    // The whole first boot produced exactly ONE app entry, and it is the one
    // the next boot will look for. An `@none` entry surviving here is the
    // orphan the card reports — it is never read again and sits in
    // `sessionStorage` until the tab closes.
    const keys = cachedAppKeys();
    expect(keys.filter((k) => k.includes(':@none:'))).toEqual([]);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain(`:${ORG}:`);
  });

  it('does not re-request the app list to repair the scope', async () => {
    // The repair must cost a storage move, not a round trip: re-fetching would
    // trade this card's miss for the objectui#4042 request-budget regression.
    const calls: string[] = [];
    await firstBoot([{ name: 'setup' }, { name: 'crm' }], calls);

    expect(calls.filter((c) => c === 'app')).toHaveLength(1);
  });

  it('still refuses to adopt a no-org entry into a DIFFERENT org (objectui#4486 holds)', async () => {
    // The counter-pin. Adopting on first resolution must not become "any org
    // may claim any unlabelled entry": an entry written under a real org id is
    // that org's, and a later boot resolving a different org must still miss.
    await firstBoot([{ name: 'setup' }, { name: 'crm' }]);

    ActiveOrganizationStorage.set('org_other');
    authState.activeOrganization = { id: 'org_other' };

    const view = render(
      <MetadataProvider adapter={makeAdapter({ apps: 'pending' })}>
        <AppsProbe />
      </MetadataProvider>,
    );
    await settle();

    expect(view.getByTestId('apps').textContent).toBe('');
    expect(view.getByTestId('loading').textContent).toBe('true');
  });
});
