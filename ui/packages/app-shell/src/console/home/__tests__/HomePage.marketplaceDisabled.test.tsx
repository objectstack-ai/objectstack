// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Home stops recommending a marketplace this runtime does not have
 * (objectui#5504).
 *
 * ## The defect, and why the ORDERING is the injury
 *
 * `apps/objectos-ee/deploy/.env.example` ships `OS_CLOUD_URL=off` as its factory
 * default. On that stack Home still led with "Start with a template — install a
 * template app from the marketplace" and carried a "Browse App Marketplace"
 * shortcut; both navigate to `/apps/setup/system/marketplace`, which 404s there.
 * The page recommended first and errored afterwards. Withholding the entry is
 * the fix; making the error card politer would not have been.
 *
 * ## Why these cases drive the REAL runtime-config module
 *
 * Same argument as `MarketplacePage.disabledState.test.tsx`: the claim under
 * test is that the gate consumes the SERVER's derived `features.marketplace`
 * (objectstack#8356), so these cases boot the genuine `initRuntimeConfig()`
 * over a stubbed `/api/v1/runtime/config` payload rather than mocking the
 * accessor. The neighbouring HomePage suites mock `../../../runtime-config`
 * precisely because they are about something else.
 *
 * ## Why `t` returns «key»
 *
 * The reason line must resolve THROUGH i18n — a hardcoded English sentence at
 * the point of refusal is half of what this card is about — so `t` echoes the
 * KEY rather than `defaultValue`. Verbatim from
 * `HomePage.authoringCapabilityGate.test.tsx`, which states the argument in
 * full.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const { createElement } = await import('react');
  return {
    useNavigate: () => navigateMock,
    // objectui#12305: each Home app tile is a router `Link`. This harness has
    // no router, so the stand-in renders the anchor `Link` would, minus the
    // basename. The tile's own pins live in `HomeAppsStrip.tilesAreLinks-12305`.
    Link: ({ to, ...rest }: { to: string } & Record<string, unknown>) =>
      createElement('a', { ...rest, href: to }),
  };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string) => `«${key}»`,
    language: 'en',
  }),
  useObjectLabel: () => ({ appLabel: (app: any) => String(app?.label ?? app?.name ?? '') }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Zhang San', email: 'zhangsan@acme-test.com' } }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [{ name: 'builder' }] }),
  isAskAgent: () => false,
  agentHasCapability: () => true,
}));

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [{ name: 'crm', label: 'CRM' }], loading: false }),
}));

vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: undefined }),
}));

// --- surfaces unrelated to this gate ---------------------------------------
vi.mock('../../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../../hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovalsCount: 0,
    // objectui#12602: the approvals preview, and whether each source is
    // the caller's to read — the My-work section draws a column per source.
    pendingApprovals: [],
    pendingApprovalsReadable: true,
    notificationsReadable: true,
    notifications: [],
    unreadTopicCount: 0,
    activity: { value: [], status: 'ready', readable: true },
  }),
}));
vi.mock('../../../hooks/useAiSurface', () => ({ resolveAiApiBase: () => '' }));
vi.mock('../../../views/metadata-admin/useMetadata', () => ({
  useMetadataClient: () => ({ listDrafts: async () => [] }),
}));
vi.mock('../../../preview/usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: async () => ({ ok: true }), publishing: false }),
}));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { HomePage } from '../HomePage';

/** A `GET /api/v1/runtime/config` answer, as the server sends it. */
const serverConfig = (cloudUrl: string, marketplace: boolean) => ({
  cloudUrl,
  singleEnvironment: true,
  features: { installLocal: true, marketplace, aiStudio: true, autoPublishAiBuilds: true },
  branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
});

/* ── The HomePage fetch router (objectui#8033) ────────────────────────────────
 * These cases boot the REAL `initRuntimeConfig()`, so the global `fetch` has to
 * answer `GET /api/v1/runtime/config`. It used to answer with a blanket SINK:
 * one `vi.fn` handing the runtime-config body back for EVERY url. Two things
 * were wrong with that.
 *
 * `HomePage` reaches more than one endpoint. Besides the config read, every
 * render mounts `usePendingDraftsRow`, whose `usePendingDrafts({})` fetches
 * `GET /api/v1/meta/_drafts` with the GLOBAL `fetch` — `usePendingDrafts.ts:48`,
 * no `apiFetch` seam anywhere on the path — from its mount effect
 * (`usePendingDrafts.ts:116` via `refresh` at `:90`). The sink handed THAT reader
 * the runtime-config body; it found no `drafts` key and yielded `[]`, so nothing
 * failed. And nothing could: a sink keeps no record of what it was handed and
 * asserts nothing about what it served, so a future new escape from `HomePage`
 * would be answered silently instead of going red.
 *
 * So the double is a RECORDING ROUTER — the shape objectui#5225 settled on,
 * carried by `packages/plugin-report/src/__tests__/DatasetReportRenderer.test.tsx`
 * and installed by objectui#7307's batches in the four sibling files in this
 * directory; copied from `HomePage.approvalsTarget.test.tsx` (batch 4, #8032).
 * It serves exactly the two routes these renders reach, records every url it is
 * handed, and `afterEach` fails on any url outside that set. This file is NOT on
 * the network-escape burn-down list — that list reached zero and was retired, and
 * no gate covers these two routes here — so that assertion is the file's own
 * evidence rather than a duplicate of one.
 *
 * `_drafts` answers a known-EMPTY ledger in the `{ drafts: [...] }` envelope
 * `fetchPendingDrafts` reads. Empty rather than seeded is load-bearing:
 * `usePendingDraftsRow` renders `null` for both `count === null` (what the sink's
 * unparseable answer produced) and `count === 0`, so no assertion in this file
 * moves. Routes are matched on the PATHNAME because the hook appends a
 * `?packageId=` scope for package-bound callers; the full url is what is recorded.
 * ─────────────────────────────────────────────────────────────────────────── */

const CONFIG_ROUTE = '/api/v1/runtime/config';
const DRAFTS_ROUTE = '/api/v1/meta/_drafts';
const SERVED_ROUTES = [CONFIG_ROUTE, DRAFTS_ROUTE];

/** Every url this file's renders handed the global `fetch`, in request order. */
let fetchCalls: string[] = [];

/** The route key of a recorded url: its pathname, without the scope query. */
const routeOf = (url: string) => url.split('?')[0];

/**
 * What `GET /api/v1/runtime/config` answers for the case now running — set by
 * `bootOn` / `bootOnNoConfig` before `initRuntimeConfig()`. The per-case default
 * is the 404 a runtime predating the endpoint gives, so a case that never boots
 * cannot silently inherit the previous case's payload.
 */
let configAnswer: { ok: boolean; status: number; body: unknown } = { ok: false, status: 404, body: {} };

/** Serve the two routes these renders reach; record every url regardless. */
function installHomeRouter() {
  fetchCalls = [];
  configAnswer = { ok: false, status: 404, body: {} };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      fetchCalls.push(url);
      if (routeOf(url) === CONFIG_ROUTE) {
        return {
          ok: configAnswer.ok,
          status: configAnswer.status,
          json: async () => configAnswer.body,
        };
      }
      if (routeOf(url) === DRAFTS_ROUTE) {
        return { ok: true, status: 200, json: async () => ({ drafts: [] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
}

beforeEach(installHomeRouter);

/** Boot the REAL runtime-config module over a served `/runtime/config` payload. */
async function bootOn(body: Record<string, unknown>) {
  resetRuntimeConfigForTesting();
  configAnswer = { ok: true, status: 200, body };
  await initRuntimeConfig();
}

/** Boot against a runtime whose `/api/v1/runtime/config` answers 404. */
async function bootOnNoConfig() {
  resetRuntimeConfigForTesting();
  configAnswer = { ok: false, status: 404, body: {} };
  await initRuntimeConfig();
}

/** An admin who MAY author metadata — so only the marketplace gate is in play. */
const permissions = (): MePermissionsResponse =>
  ({
    authenticated: true,
    userId: 'u1',
    tenantId: 'acme',
    roles: ['org_owner', 'everyone'],
    permissionSets: ['organization_admin', 'member_default'],
    systemPermissions: ['manage_org_users', 'setup.access', 'setup.write', 'manage_metadata'],
    objects: {},
    fields: {},
  }) as MePermissionsResponse;

function renderHome() {
  return render(
    <MePermissionsProvider initialPermissions={permissions()}>
      <HomePage />
    </MePermissionsProvider>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
});

afterEach(() => {
  // The double is a router, not a sink: an escape to any OTHER endpoint fails
  // here instead of being answered with the runtime-config body. No gate covers
  // this file, so this line is the evidence that the double only served what it
  // meant to serve.
  expect(fetchCalls.filter((url) => !SERVED_ROUTES.includes(routeOf(url)))).toEqual([]);
  // Unmount BEFORE restoring the real `fetch`. Vitest runs `afterEach` hooks in
  // reverse registration order, so this file's teardown runs before the root
  // setup's RTL cleanup: unstubbing first would leave the tree mounted with the
  // real global back in place, and a read that cleanup()'s act-flush triggers
  // would reach a live socket (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('Home on a runtime deployed with OS_CLOUD_URL=off (objectui#5504)', () => {
  beforeEach(async () => {
    await bootOn(serverConfig('', false));
  });

  it('greys out the template cover and says why, in the user’s language', () => {
    renderHome();

    expect(screen.getByTestId('home-start-template')).toBeDisabled();
    expect(screen.getByTestId('home-marketplace-disabled-reason')).toHaveTextContent(
      '«home.template.marketplaceDisabled»',
    );
  });

  it('withholds the "Browse App Marketplace" shortcut — it targets the same 404', () => {
    renderHome();
    expect(screen.queryByTestId('browse-marketplace-btn')).toBeNull();
  });

  it('does not navigate into the dead end when the withheld cover is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByTestId('home-start-template'));

    // The greyed-out cover must be genuinely inert, not merely look it: landing
    // on the red card is the injury this card is about.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('leaves the marketplace-independent builder entry alone', () => {
    // "Build an app" goes to /studio and needs no catalog. A gate that swept it
    // up would remove the product front door from every air-gapped deployment.
    renderHome();
    expect(screen.getByTestId('home-build-app')).toBeEnabled();
  });
});

describe('Home on a runtime that HAS a marketplace', () => {
  it('recommends it exactly as before', async () => {
    await bootOn(serverConfig('https://cloud.objectos.ai', true));
    const user = userEvent.setup();
    renderHome();

    const template = screen.getByTestId('home-start-template');
    expect(template).toBeEnabled();
    expect(screen.getByTestId('browse-marketplace-btn')).toBeInTheDocument();
    // No reason line when there is nothing to explain.
    expect(screen.queryByTestId('home-marketplace-disabled-reason')).toBeNull();

    await user.click(template);
    expect(navigateMock).toHaveBeenCalledWith('/apps/setup/system/marketplace');
  });

  it('fails OPEN when the runtime answers no config at all', async () => {
    await bootOnNoConfig();

    renderHome();

    // A build predating `/api/v1/runtime/config` keeps its defaults. Withholding
    // a working capability on an unanswered question is the worse direction.
    expect(screen.getByTestId('home-start-template')).toBeEnabled();
    expect(screen.getByTestId('browse-marketplace-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('home-marketplace-disabled-reason')).toBeNull();
  });
});
