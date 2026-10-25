// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Home "pending approvals" card — where it actually lands (objectstack#7231).
 *
 * ## The defect
 *
 * `HomePage` hardcoded `navigate('/apps/setup/system/approvals')`. The path is
 * not wrong about the PAGE — `system/approvals` is declared in the host's route
 * fragment and mounted as both `extraRoutes` and `extraRoutesNoApp`, so
 * `/apps/{ANY_APP}/system/approvals` resolves — it is wrong about the APP. A
 * business user who has approvals to act on but no access to the `setup` app
 * follows the one entry point Home offers them straight into the shell's "App
 * not available" guard.
 *
 * `InboxPopover` (the bell in the app chrome) already got this right:
 * `currentAppName ?? params.appName`, falling back to `setup` only when neither
 * names an app. This file pins the same resolution for Home.
 *
 * ## Why Home cannot simply copy the popover
 *
 * Home renders at `/home`, OUTSIDE the `/apps/:appName/*` router, so the second
 * half of the popover's expression (`params.appName`) is structurally
 * unavailable — there is no app segment in the URL to read. `currentAppName` is
 * the only signal, it is published by `ConsoleLayout` on app mount, and it is
 * therefore *stale by construction*: on a cold landing straight at `/home` it is
 * `undefined`, and after visiting an app it survives that app being deactivated.
 * Both of those are cases below, and both are why the resolution re-checks the
 * remembered name against the LIVE active-app list instead of trusting it.
 *
 * ## Scope of the stubs
 *
 * This file measures ONE navigation target. Every hook `HomePage` calls for
 * unrelated surfaces (AI CTAs, drafts banner, recents, favorites) is stubbed at
 * its module boundary; `HomeRail` — which owns the card and its testid — stays
 * real, because "the click reaches the right URL" is not assertable through a
 * stubbed button. `useNavigate` is mocked rather than driven through a
 * `MemoryRouter` so the assertion reads the emitted target directly.
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

// --- the app list + the remembered app: the two inputs under test -----------
let appsFixture: any[] = [];
let currentAppNameFixture: string | undefined;

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: appsFixture, loading: false }),
}));

vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: currentAppNameFixture }),
}));

// --- unrelated surfaces ----------------------------------------------------
vi.mock('../../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../../hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovalsCount: 3,
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

async function clickApprovals() {
  const user = userEvent.setup();
  render(<HomePage />);
  await user.click(screen.getByTestId('home-my-work-approvals-view-all'));
  expect(navigateMock).toHaveBeenCalledTimes(1);
  return navigateMock.mock.calls[0][0] as string;
}

describe('HomePage pending-approvals target (objectstack#7231)', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    appsFixture = [];
    currentAppNameFixture = undefined;
  });

  it('lands in the app the user last had open, not the hardcoded setup app', async () => {
    appsFixture = [app('setup'), app('crm')];
    currentAppNameFixture = 'crm';

    expect(await clickApprovals()).toBe('/apps/crm/system/approvals');
  });

  it('addresses the app by its package segment when it has one', async () => {
    // `appRouteSegment` prefers `_packageId` over `name` — the URL builder the
    // rest of Home already uses, so the approvals link cannot disagree with the
    // app tiles right above it about how the same app is spelled.
    appsFixture = [app('crm', { _packageId: 'acme-crm' })];
    currentAppNameFixture = 'acme-crm';

    expect(await clickApprovals()).toBe('/apps/acme-crm/system/approvals');
  });

  it('falls back to the first available app on a cold landing at /home', async () => {
    // No app was mounted this session, so `currentAppName` is undefined. The
    // old code sent this user to `setup`; a non-admin has no such app.
    appsFixture = [app('crm'), app('hr')];
    currentAppNameFixture = undefined;

    const target = await clickApprovals();
    expect(target).toBe('/apps/crm/system/approvals');
    expect(target).not.toContain('/apps/setup/');
  });

  it('does not resurrect a remembered app that is no longer active', async () => {
    // `currentAppName` outlives the app it names — it is plain React state, not
    // derived from the live list — so a link built from it unchecked can point
    // at an app the metadata no longer serves.
    appsFixture = [app('hr')];
    currentAppNameFixture = 'crm';

    expect(await clickApprovals()).toBe('/apps/hr/system/approvals');
  });

  it('PRECONDITION: a zero-app workspace renders no approvals card at all', async () => {
    // Pins why the `setup` last resort in the resolution is NOT the zero-app
    // branch: `HomePage` returns the welcome empty state before the action
    // center exists. If this ever goes red, the last resort becomes reachable
    // and needs a case of its own rather than the comment it carries today.
    appsFixture = [];
    currentAppNameFixture = undefined;

    render(<HomePage />);
    expect(screen.queryByTestId('home-my-work')).toBeNull();
  });
});
