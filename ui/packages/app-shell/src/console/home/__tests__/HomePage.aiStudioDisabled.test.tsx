// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Home stops offering the metadata-authoring front door on a deployment whose
 * own runtime config says authoring is not offered here (objectui#5521).
 *
 * ## The defect
 *
 * On the composed hosted-SaaS shape (`OS_TENANCY_POSTURE=isolated`), Home led a
 * plain tenant with "Build an app — start from scratch, design objects, forms,
 * automations and interfaces". Behind it: `/api/v1/meta/*` → 403 and a
 * ToolRegistry holding zero authoring handlers. The lockdown criterion for that
 * shape is two-part — UI entry hidden AND API refused — and only the backend
 * half was green.
 *
 * `features.aiStudio` is the server's own answer to "is AI-driven metadata
 * authoring offered by this runtime". It was *wrong* on this shape until
 * cloud#1471 derived it from the same resolution that decides the agent mount;
 * before that it leaked a default `true` and honouring it here would have
 * hidden nothing. It is truthful now, and this page did not read it.
 *
 * ## Why HIDDEN rather than dimmed
 *
 * The flag's declared meaning, on both sides of the wire, is *hide*:
 * `RuntimeFeatures.aiStudio` documents "when false, the SPA hides the AI
 * authoring affordances", and the serving plugin documents "set false to
 * force-hide the authoring UI". The sibling `features.marketplace` means
 * something different — reachability of a route — which is why objectui#5504
 * correctly rendered *it* as a dimmed card plus a visible reason. Two flags,
 * two declared meanings, two presentations.
 *
 * ## Why these cases drive the REAL runtime-config module
 *
 * Verbatim from `HomePage.marketplaceDisabled.test.tsx`: the claim under test is
 * that the gate consumes the SERVER's `features.aiStudio`, so every case boots
 * the genuine `initRuntimeConfig()` over a stubbed `GET /api/v1/runtime/config`
 * rather than mocking an accessor. Mocking the accessor would pass against a
 * page that never asks the server anything.
 *
 * ## Why `t` returns «key»
 *
 * The reason lines must resolve THROUGH i18n. Verbatim from
 * `HomePage.authoringCapabilityGate.test.tsx`, which states the argument in full.
 *
 * ## Guarding the vacuum
 *
 * The acceptance condition is that something does NOT render, which an empty
 * page reproduces perfectly. So every denial case also asserts the furniture it
 * is denying *around* — the app tile the strip renders and the sibling template
 * cover — and the counter-probes drive the SAME fixture through the SAME helper
 * with the flag flipped and find the card. An empty render fails the denials'
 * counter-assertions; a gate stuck open fails the denials; a gate that swept the
 * whole cover fails the sibling assertion. None of the three can pass alone.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
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

/**
 * A `GET /api/v1/runtime/config` answer, as the server sends it.
 *
 * `features` is spread from a caller-supplied partial rather than built from
 * named booleans, so a case can OMIT `aiStudio` entirely — the fail-open case
 * below turns on the difference between "absent" and "false", and a signature
 * taking `aiStudio: boolean` could not express it.
 */
const serverConfig = (features: Record<string, unknown>) => ({
  cloudUrl: 'https://cloud.objectos.ai',
  singleEnvironment: true,
  features: { installLocal: true, marketplace: true, autoPublishAiBuilds: true, ...features },
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

/**
 * An admin who MAY author metadata — so the PRINCIPAL half of the gate is wide
 * open and only the DEPLOYMENT flag can move the verdict. Without
 * `manage_metadata` here, every denial below would pass for the wrong reason.
 */
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

describe('Home on a runtime reporting features.aiStudio: false (objectui#5521)', () => {
  beforeEach(async () => {
    await bootOn(serverConfig({ aiStudio: false }));
  });

  it('withholds the "Build an app" cover entirely — not dimmed, gone', () => {
    renderHome();

    expect(screen.queryByTestId('home-build-app')).toBeNull();
    // Counter-probe against a page that rendered NOTHING: the strip behind the
    // cover is still there with the workspace's app on it.
    expect(screen.getByTestId('app-tile-crm')).toBeInTheDocument();
  });

  it('leaves the sibling template cover standing — this gate is not a cover-wide sweep', () => {
    renderHome();

    // "Start with a template" installs a marketplace package; that is not AI
    // metadata authoring and it answers to its own flags. A gate that swept the
    // whole builder cover would remove it from every runtime that merely
    // switched AI Studio off, and would still pass the assertion above.
    const template = screen.getByTestId('home-start-template');
    expect(template).toBeInTheDocument();
    expect(template).toBeEnabled();
  });

  it('offers no route into the authoring surface it just withheld', () => {
    renderHome();

    // The withheld card's destination. Nothing on the rendered page may reach
    // `/studio` on its own — `StudioRoute` would bounce this principal anyway,
    // and walking them there to be bounced is the defect, not the remedy.
    expect(navigateMock).not.toHaveBeenCalledWith('/studio');
  });

  it('does not borrow the per-principal reason line to explain a deployment fact', () => {
    renderHome();

    // `home.build.noCapability` says the account lacks "Manage Metadata". This
    // admin HOLDS it (see `permissions()`); the surface is absent for everyone.
    // Rendering that line here would be the objectui#5557 misdirection —
    // sending a viewer to ask for a permission that would not help them.
    expect(screen.queryByTestId('home-authoring-gate-reason')).toBeNull();
  });
});

describe('Home on the measured composed hosted-SaaS shape (objectui#5521)', () => {
  it('withholds authoring while keeping objectui#5504’s explained marketplace state', async () => {
    // Both flags false at once — the shape the card measured. The two gates must
    // compose rather than shadow each other.
    await bootOn(serverConfig({ aiStudio: false, marketplace: false, installLocal: false }));
    renderHome();

    expect(screen.queryByTestId('home-build-app')).toBeNull();
    expect(screen.getByTestId('home-start-template')).toBeDisabled();
    expect(screen.getByTestId('home-marketplace-disabled-reason')).toHaveTextContent(
      '«home.template.marketplaceDisabled»',
    );
    expect(screen.queryByTestId('browse-marketplace-btn')).toBeNull();
    expect(screen.getByTestId('app-tile-crm')).toBeInTheDocument();
  });
});

describe('Home on a runtime that DOES offer AI Studio', () => {
  it('keeps the "Build an app" cover exactly as before', async () => {
    // Same fixture, same helper, one flag flipped — so the denials above cannot
    // be passing because the card never renders in this suite at all.
    await bootOn(serverConfig({ aiStudio: true }));
    renderHome();

    const build = screen.getByTestId('home-build-app');
    expect(build).toBeInTheDocument();
    expect(build).toBeEnabled();
  });

  it('fails OPEN when the runtime reports no aiStudio key at all', async () => {
    // A server predating the flag answers a `features` map without it. Absent is
    // not `false`: withholding the product's front door on an unanswered
    // question is the worse direction, and it is the doctrine `!== false`
    // already encodes for `features.marketplace`.
    await bootOn(serverConfig({}));
    renderHome();

    expect(screen.getByTestId('home-build-app')).toBeEnabled();
  });

  it('fails OPEN when the runtime answers no config at all', async () => {
    await bootOnNoConfig();

    renderHome();

    expect(screen.getByTestId('home-build-app')).toBeEnabled();
  });
});
