// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4486 — metadata the provider caches belongs to ONE organization.
 *
 * ## The invariant
 *
 * After an org switch, a `useMetadata().apps` read in the seed window must not
 * return the previous organization's list. That is deliberately stated about
 * the DATA, not about the storage key: a re-keying that still served stale
 * items by some other path would satisfy a key-string assertion and violate the
 * card. So nothing here asserts what the key looks like — the cache is filled
 * by running the provider, and every assertion reads the value a consumer
 * actually gets back.
 *
 * ## Why the seed window is where this bites
 *
 * `MetadataProvider` seeds the app list from `sessionStorage` before the
 * org-scoped fetch returns, and `sessionStorage` survives the full-page
 * navigation `WorkspaceSwitcher.handleSwitch` performs after
 * `switchOrganization` resolves. The seed used to be keyed by metadata TYPE
 * alone (`objectui:metadata:app`), so the first thing the new org's console did
 * was resolve against the old org's apps — which is how a fresh-workspace
 * member got aimed at `/apps/setup` (objectui#4473, patched downstream by
 * PR #4483's bounce; the provider is the mechanism and this is it).
 *
 * `RootLandingRedirect` was merely the consumer that got caught. ~15 surfaces
 * read `useMetadata().apps` (sidebar, app switcher, search, home, inbox…), so
 * the pin belongs at the provider, not at any one of them.
 *
 * ## The two halves, pinned separately
 *
 * 1. Cross-org staleness — the seed is scoped to the active organization, and
 *    the in-memory cache is dropped when the active org changes WITHOUT a
 *    reload (`OrganizationLayout` does exactly that from an effect).
 * 2. Truthy-empty short-circuit — a cached `[]` is truthy, so it used to clear
 *    `initialLoading` too, making "no apps (cached, possibly stale)"
 *    indistinguishable from "no apps (fresh)".
 *
 * The third test is the counter-pin: deleting the cache outright would satisfy
 * (1) and (2) and destroy the optimization, so a same-org remount must still
 * seed instantly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

/**
 * Only `useAuth` is stubbed. `ActiveOrganizationStorage` stays REAL because it
 * is the mechanism under test: the provider derives its cache scope from the
 * same storage `createAuthenticatedFetch` stamps `X-Tenant-ID` from, so the key
 * and the tenant the server filtered for cannot drift apart.
 */
const authState: { activeOrganization: { id: string } | null } = {
  activeOrganization: null,
};
vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/auth')>();
  return { ...actual, useAuth: () => authState };
});

import { ActiveOrganizationStorage } from '@object-ui/auth';
import { MetadataProvider, useMetadata } from '../MetadataProvider';

interface AppItem {
  name: string;
}

/**
 * `apps: 'pending'` returns a promise that never settles — that IS the seed
 * window: the provider has whatever the cache gave it and nothing else.
 */
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

/** Let every pending microtask and the provider's `queueMicrotask` bump settle. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * Fill the session cache the way the product fills it — by running the
 * provider under `orgId` until its fetch lands. Nothing writes `sessionStorage`
 * by hand, so these tests cannot silently agree with a wrong key format.
 */
async function primeCacheFor(orgId: string, apps: AppItem[]): Promise<void> {
  ActiveOrganizationStorage.set(orgId);
  const view = render(
    <MetadataProvider adapter={makeAdapter({ apps })}>
      <AppsProbe />
    </MetadataProvider>,
  );
  // `loading` clears only after the eager loop finished, which is after the
  // app fetch resolved and wrote the cache — a reliable signal even when the
  // list is empty (where the rendered names stay '' throughout).
  await waitFor(() => expect(view.getByTestId('loading').textContent).toBe('false'));
  view.unmount();
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

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  ActiveOrganizationStorage.clear();
  authState.activeOrganization = null;
});

afterEach(() => {
  cleanup();
});

describe('MetadataProvider org-scoped metadata cache (objectui#4486)', () => {
  it('never serves the previous org’s app list in the seed window after a switch', async () => {
    await primeCacheFor('org_a', [{ name: 'setup' }, { name: 'crm' }]);

    // The switch: `switchOrganization` writes the new active org to storage and
    // WorkspaceSwitcher then full-page-navigates to the console root, so the
    // next mount sees the new org id and the SAME sessionStorage.
    ActiveOrganizationStorage.set('org_b');

    const view = render(
      <MetadataProvider adapter={makeAdapter({ apps: 'pending' })}>
        <AppsProbe />
      </MetadataProvider>,
    );
    await settle();

    // The invariant. Before the fix this read 'setup,crm' — org_a's list,
    // driving org_b's landing decision.
    expect(view.getByTestId('apps').textContent).toBe('');
    // And the honest posture while org_b's list is in flight is "still loading",
    // not "this workspace has no apps".
    expect(view.getByTestId('loading').textContent).toBe('true');
  });

  it('still seeds instantly when the org is unchanged (the cache is not just disabled)', async () => {
    await primeCacheFor('org_a', [{ name: 'setup' }, { name: 'crm' }]);

    // Same org, fresh mount, fetch that never lands: everything shown here came
    // from the seed. Deleting the cache to satisfy the test above would fail
    // here.
    const view = render(
      <MetadataProvider adapter={makeAdapter({ apps: 'pending' })}>
        <AppsProbe />
      </MetadataProvider>,
    );

    await waitFor(() => expect(view.getByTestId('apps').textContent).toBe('setup,crm'));
    expect(view.getByTestId('loading').textContent).toBe('false');
  });

  it('treats a cached EMPTY list as a miss for the initialLoading decision', async () => {
    await primeCacheFor('org_a', []);

    // Precondition: an empty list really is in the cache for this org.
    const keys = cachedAppKeys();
    expect(keys).toHaveLength(1);
    expect(sessionStorage.getItem(keys[0])).toBe('[]');

    const view = render(
      <MetadataProvider adapter={makeAdapter({ apps: 'pending' })}>
        <AppsProbe />
      </MetadataProvider>,
    );
    await settle();

    expect(view.getByTestId('apps').textContent).toBe('');
    // The half that is easy to drop: `[]` is truthy, so this used to report
    // `false` and let consumers treat a possibly-stale empty list as settled.
    expect(view.getByTestId('loading').textContent).toBe('true');
  });

  it('drops the pre-fix unscoped entry instead of serving it to whichever org mounts next', async () => {
    // A tab that was already open across the upgrade still holds the org-blind
    // key written by the old code.
    sessionStorage.setItem(
      'objectui:metadata:app',
      JSON.stringify([{ name: 'other_org_app' }]),
    );
    ActiveOrganizationStorage.set('org_b');

    const view = render(
      <MetadataProvider adapter={makeAdapter({ apps: 'pending' })}>
        <AppsProbe />
      </MetadataProvider>,
    );
    await settle();

    expect(view.getByTestId('apps').textContent).toBe('');
    // Inert is not enough — it is another org's app list, so it is deleted the
    // first time the new code looks.
    expect(sessionStorage.getItem('objectui:metadata:app')).toBeNull();
  });

  it('drops the in-memory cache when the active org changes with NO reload', async () => {
    // `OrganizationLayout` calls `switchOrganization` from an effect when the
    // `/organizations/:slug` segment names another org — no navigation, so the
    // storage key alone never comes into play and the live cache is what
    // answers.
    const calls: string[] = [];
    const adapter = makeAdapter({ apps: [{ name: 'crm' }], calls });
    authState.activeOrganization = { id: 'org_a' };
    ActiveOrganizationStorage.set('org_a');

    const view = render(
      <MetadataProvider adapter={adapter}>
        <AppsProbe />
      </MetadataProvider>,
    );
    await waitFor(() => expect(view.getByTestId('apps').textContent).toBe('crm'));
    expect(calls.filter((c) => c === 'app')).toHaveLength(1);

    authState.activeOrganization = { id: 'org_b' };
    ActiveOrganizationStorage.set('org_b');
    view.rerender(
      <MetadataProvider adapter={adapter}>
        <AppsProbe />
      </MetadataProvider>,
    );
    await settle();

    // org_a's list is gone and org_b's has been requested — not left to the
    // 5-minute TTL.
    expect(calls.filter((c) => c === 'app')).toHaveLength(2);
  });

  it('does not clear the cache when the active org merely RESOLVES (null → id)', async () => {
    // AuthProvider resolves the membership list asynchronously, so `null → id`
    // happens on every normal boot. Treating it as a switch would re-request
    // every eager type mid-flight — the objectui#4042 request-budget
    // regression.
    const calls: string[] = [];
    const adapter = makeAdapter({ apps: [{ name: 'crm' }], calls });

    const view = render(
      <MetadataProvider adapter={adapter}>
        <AppsProbe />
      </MetadataProvider>,
    );
    await waitFor(() => expect(view.getByTestId('apps').textContent).toBe('crm'));

    authState.activeOrganization = { id: 'org_a' };
    view.rerender(
      <MetadataProvider adapter={adapter}>
        <AppsProbe />
      </MetadataProvider>,
    );
    await settle();

    expect(calls.filter((c) => c === 'app')).toHaveLength(1);
    expect(view.getByTestId('apps').textContent).toBe('crm');
  });
});
