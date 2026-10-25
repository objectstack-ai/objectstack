// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Home's "Needs your attention" rows follow a notification's deep link INTO an
 * app (objectui#5179).
 *
 * ## The defect
 *
 * `action_url` is **app-relative** by contract. The producer says so in as many
 * words — `service-messaging`'s `actionUrlFor()` synthesizes
 * `/{object}/{id}` "so the materialization is self-sufficient for navigation
 * (ADR-0030 L5)" — and its own pins carry that shape (`/showcase_task/t_42`,
 * `/opportunities/42`). It names a RECORD, not a console route: the app that
 * hosts it is the client's to resolve, exactly as for `sys_inbox_message` and
 * `sys_activity` next door.
 *
 * `onOpenNotification` navigated `n.actionUrl` verbatim, so the app-relative
 * path was handed to the router as if it were absolute. `/showcase_task/t_42`
 * matches no route, the console's catch-all (`apps/console/src/App.tsx`,
 * `<Route path="*" element={<Navigate to="/" replace />} />`) forwards it to
 * `/`, and `RootLandingRedirect` resolves that to `/apps/<default app>` — the
 * app landing page, which is precisely what the card reports.
 *
 * ## Why the existing pin did not catch it
 *
 * `HomePage.inboxLinksTarget.test.tsx`'s CONTROL case seeds
 * `actionUrl: '/apps/acme/invoice/42'` — a path already carrying its `/apps/`
 * segment, i.e. the one shape that survives being navigated verbatim. The
 * producer never emits it. These cases seed the shape the producer actually
 * emits.
 *
 * ## What these cases assert
 *
 * The RESOLVED TARGET — the argument `navigate()` receives — per the card's
 * ruling that a test asserting only "navigation happened" passes against the
 * bug. Nothing about the far end: whether the record renders is the card's
 * second, already-verified control.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', email: 'ada@example.com' } }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [] }),
  isAskAgent: () => false,
  agentHasCapability: () => false,
}));

let appsFixture: any[] = [];
let currentAppNameFixture: string | undefined;

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: appsFixture, loading: false }),
}));

vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: currentAppNameFixture }),
}));

let notificationsFixture: any[] = [];

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
    notifications: notificationsFixture,
    unreadTopicCount: notificationsFixture.length,
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
vi.mock('../../../runtime-config', () => ({
  getRuntimeConfig: () => ({ branding: { productName: 'ObjectStack' } }),
  // objectui#5504 — Home now asks the runtime whether it has a marketplace at
  // all. `true` keeps every case in this file on the pre-existing behaviour;
  // the gate itself is covered by `HomePage.marketplaceDisabled.test.tsx`,
  // which drives the REAL module instead of this stand-in.
  isMarketplaceEnabled: () => true,
  // objectui#5577 — same treatment for the AI-authoring gate, which Home now
  // reads through `isAiStudioEnabled()` rather than inline. An explicit factory
  // replaces the WHOLE module, so an export it does not list is `undefined` at
  // the call site — i.e. omitting this line is a TypeError here, not a default.
  // `true` keeps every case in this file on the pre-existing behaviour; the gate
  // itself is covered by `HomePage.aiStudioDisabled.test.tsx`, which drives the
  // REAL module instead of this stand-in.
  isAiStudioEnabled: () => true,
}));

import { HomePage } from '../HomePage';

/* ── The `_drafts` double (objectui#7307) ─────────────────────────────────────
 * Every render of `HomePage` below mounts `usePendingDraftsRow`, which reads the
 * env-wide pending-draft count through `usePendingDrafts({})`. That hook fetches
 * `GET /api/v1/meta/_drafts` with the GLOBAL `fetch` — `usePendingDrafts.ts:48`,
 * no `apiFetch` seam anywhere on the path — from its mount effect
 * (`usePendingDrafts.ts:116` via `refresh` at `:94`). Under happy-dom that global
 * is a real HTTP client and the document URL defaults to `http://localhost:3000`,
 * so the relative path resolved to a live socket, once per case. The hook's read
 * is best-effort (its `catch` leaves `count` at `null`), which is why these cases
 * stayed green while the request always failed.
 *
 * Answered from a RECORDING double — the shape objectui#5225 settled on, carried
 * by `packages/plugin-report/src/__tests__/DatasetReportRenderer.test.tsx` and by
 * this burn-down's earlier batches. Deliberately NOT a blanket network stub: it
 * records every URL it is handed and `afterEach` fails on any URL outside the set
 * it serves, so an escape to somewhere else reds here instead of vanishing into
 * that `catch`.
 *
 * What it answers, and why that changes no assertion here: a known-EMPTY draft
 * ledger, in the `{ drafts: [...] }` envelope `fetchPendingDrafts` reads (the one
 * `MetadataClient.listDrafts` pins for this endpoint; the bare-array and
 * `{ data: { drafts } }` shapes parse to the same rows). Empty rather than seeded
 * is load-bearing: `usePendingDraftsRow` renders `null` when `(count ?? 0) <= 0`,
 * and the failing request produced `count === null` — so an empty ledger yields
 * byte-identical output to what these cases have always rendered, while a seeded
 * one would add a banner and a `pending-drafts-publish` button to every case's
 * tree. Routes are matched on the PATHNAME because the hook appends a
 * `?packageId=` scope for package-bound callers; the full URL is what gets
 * recorded.
 * ─────────────────────────────────────────────────────────────────────────── */

const DRAFTS_ROUTE = '/api/v1/meta/_drafts';

/** Every URL this file's renders handed the global `fetch`, in request order. */
let draftsCalls: string[] = [];

/** The route key of a recorded URL: its pathname, without the scope query. */
const routeOf = (url: string) => url.split('?')[0];

/** Serve `GET /api/v1/meta/_drafts` as an empty ledger; record everything. */
function installDraftsDouble() {
  draftsCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      draftsCalls.push(url);
      if (routeOf(url) !== DRAFTS_ROUTE) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ drafts: [] }) };
    }),
  );
}

beforeEach(installDraftsDouble);

afterEach(() => {
  // The double is a router, not a sink: an escape to any OTHER endpoint fails
  // here instead of vanishing into the hook's best-effort `catch`.
  expect(draftsCalls.filter((url) => routeOf(url) !== DRAFTS_ROUTE)).toEqual([]);
  // Unmount BEFORE restoring the real `fetch`. Vitest runs `afterEach` hooks in
  // reverse registration order, so this file's teardown runs before the root
  // setup's RTL cleanup: unstubbing first would leave the tree mounted with the
  // real global back in place, and a mount effect settling in that window
  // escapes again (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});


const app = (name: string, extra: Record<string, unknown> = {}) => ({ name, label: name, ...extra });

/** Click the seeded notification row and read the argument `navigate()` got. */
async function clickNotification(): Promise<string> {
  const user = userEvent.setup();
  render(<HomePage />);
  await user.click(screen.getByText('Weekly digest'));
  expect(navigateMock).toHaveBeenCalledTimes(1);
  return navigateMock.mock.calls[0][0] as string;
}

describe('Home notification rows follow the deep link to the record (objectui#5179)', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    appsFixture = [app('setup'), app('crm')];
    currentAppNameFixture = 'crm';
    notificationsFixture = [
      { id: 'n1', title: 'Weekly digest', actionUrl: '/showcase_task/t_42' },
    ];
  });

  it('hosts the app-relative action_url under the app the user last had open', async () => {
    // The exact shape `actionUrlFor()` synthesizes from `source: {object, id}`.
    expect(await clickNotification()).toBe('/apps/crm/showcase_task/t_42');
  });

  it('does NOT navigate the app-relative path verbatim', async () => {
    // The bug, stated as its own case: `/showcase_task/t_42` matches no route,
    // so the console catch-all forwards it to `/` and the landing resolver
    // lands the user on the default app's home — with the notification already
    // marked read, so the pointer to the record is gone.
    const target = await clickNotification();
    expect(target).not.toBe('/showcase_task/t_42');
    expect(target.startsWith('/apps/')).toBe(true);
  });

  it('resolves the host app on a cold landing at /home, where no app is remembered', async () => {
    // Home renders OUTSIDE `/apps/:appName/*`, so there is no route segment to
    // read and `currentAppName` is undefined until the user has opened an app.
    // An unresolved host is what produced the bare path in the first place.
    appsFixture = [app('crm'), app('hr')];
    currentAppNameFixture = undefined;
    expect(await clickNotification()).toBe('/apps/crm/showcase_task/t_42');
  });

  it('does not resurrect a remembered app that is no longer active', async () => {
    // Same re-check `resolveHostAppSegment` already applies to the inbox and
    // activity drills — a link into a deactivated app is not reachable either.
    appsFixture = [app('hr')];
    currentAppNameFixture = 'crm';
    expect(await clickNotification()).toBe('/apps/hr/showcase_task/t_42');
  });

  it('CONTROL: a target that already names its app is followed verbatim', async () => {
    // An explicit `payload.url` wins over the synthesized link at the producer
    // and may already be a full console route. Hosting it twice
    // (`/apps/crm/apps/acme/...`) would break the case that works today.
    notificationsFixture = [
      { id: 'n1', title: 'Weekly digest', actionUrl: '/apps/acme/invoice/42' },
    ];
    expect(await clickNotification()).toBe('/apps/acme/invoice/42');
  });

  it('CONTROL: a notification with no action_url still opens the full inbox', async () => {
    // The objectui#4074 fallback arm — unchanged, and pinned next door in
    // `HomePage.inboxLinksTarget.test.tsx`. Repeated here so a change to the
    // deep-link path cannot quietly swallow the no-link case.
    notificationsFixture = [{ id: 'n1', title: 'Weekly digest' }];
    expect(await clickNotification()).toBe('/apps/crm/sys_inbox_message?view=mine');
  });
});
