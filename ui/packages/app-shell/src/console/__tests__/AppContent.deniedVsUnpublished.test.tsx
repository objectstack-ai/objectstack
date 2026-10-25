// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app the session may not open must SAY so — not report a deploy state
 * (objectui#4252). And nor must any of the other causes that land here
 * (objectui#9262): this screen now says only what the probe measured.
 *
 * ⚠️ The file name is objectui#4252's. That card split ONE cause — `denied` —
 * off this screen; objectui#9262 split the rest, so what is pinned here is the
 * whole verdict set, not the denied/unpublished pair the name suggests. Renaming
 * would cost the history of the defect this file was written for.
 *
 * ## The measured defect
 *
 * The console reads its app list from the generic metadata list route
 * `GET /api/v1/meta/:type` with the singular type segment `app`, and the server
 * filters that list per session in `filterAppForUser`
 * (`packages/rest/src/rest-server.ts`), so an app withheld by
 * `requiredPermissions` and an app that does not exist were byte-identical to
 * the console: both simply absent
 * from the list. `AppContent`'s `requestedAppMissing` branch therefore rendered
 * its only copy for an absent app — "This app is not available yet — it may
 * still be publishing. Try again in a moment." — over a PERMANENT authorization
 * decision, under a Retry button that can never succeed.
 *
 * The cost was measured on a downstream acceptance round and is not cosmetic:
 * one role hit this screen, another opened the same app fine, and because the
 * copy names a transient deployment state the finding was filed as a platform
 * defect and carried through two test batches. The account was missing a
 * permission-set binding; the gate had been working exactly as designed.
 *
 * ## What made the fix possible, and what it must not become
 *
 * The maintainer ruling (2026-08-12) took the contract-first half first:
 * objectstack#8013 (PR #8135) made the BY-NAME route answer an explicit
 * permission denial, while the LIST route stays filtered exactly as before —
 * no `authorized: false` flag, so the enumeration surface is not widened past
 * what a by-name probe already implies. Measured off that merged diff, the
 * envelope this console consumes is:
 *
 *     403  { success: false, error: { code: 'PERMISSION_DENIED', message } }
 *
 * and absence answers either that 404 or — measured on a real server while
 * implementing objectui#9262 — a `200` carrying the declared envelope MINUS its
 * `item`. So the branch here is on the ADR-0112 **code** and on the envelope,
 * never on the status (the objectui#4408 lesson: a status cannot separate two
 * refusals that share it).
 *
 * ## What objectui#9262 changed, and why the old "must not change" cases moved
 *
 * objectui#4252 left every non-denial on one screen whose copy asserted a
 * transient publish — "it may still be publishing" — for seven distinct causes,
 * one of which is a publish. Those cases used to be pinned HERE as
 * "MUST NOT CHANGE", and they were right to be: at the time, guessing in the
 * other direction would have been the same defect mirrored. The ruling
 * (2026-09-13) retired the guess instead of re-aiming it, so each of them now
 * has a screen that states its own measurement — and the sentence itself is
 * gone from all ten packs, which the last case in this file holds.
 *
 * ⭐ The case named THE MEASURED SHAPE below is objectui#9262 cause 8, and it is
 * the reason this rewrite is not a copy edit. On a real server the by-name route
 * answers `granted` for an app the list does not carry, so a `not_found` branch
 * keyed on a 404 alone would have been dead for the commonest absences and they
 * would have kept falling through to the neutral screen — the card filed that
 * shape as "structural, not observed".
 *
 * ## Why the route is stubbed at the TRANSPORT
 *
 * The adapter is a real `ObjectStackAdapter` over a stubbed `fetch`, so these
 * cases exercise the real client, the real error stamping (`error.code` /
 * `httpStatus` off the envelope) and the real probe. Injecting a verdict into
 * component state instead would assert the branch against a fixture of its own
 * conclusion, and could not see the accessor (`body.error.code`) change.
 *
 * NOTE ON SCOPE: like `AppContent.inaccessibleAppStrand.test.tsx`, this file
 * measures WHICH SURFACE renders. `ConsoleLayout` and the lazy pages are
 * stubbed; none of their internals are part of the question.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/i18n/locales';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';

// ---------------------------------------------------------------------------
// Mocks — everything that takes part in the DECISION stays real.
// ---------------------------------------------------------------------------

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page" />,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ activeAppName, children }: { activeAppName?: string; children?: React.ReactNode }) => (
    <div data-testid="console-layout" data-active-app={activeAppName}>
      <header>chrome</header>
      {children}
    </div>
  ),
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('../../views/ObjectView', () => ({ ObjectView: () => <div data-testid="object-view" /> }));

/**
 * `t` resolves out of the REAL locale packs, so what these cases read is the
 * shipped string for the active language rather than the call site's inline
 * default. That is what makes the `zh` case below a rendering fact.
 */
let locale: 'en' | 'zh' = 'en';
vi.mock('@object-ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  // ⚠️ The packs come from `@object-ui/i18n/locales`, NOT from the entry
  // (objectui#7479). The entry re-exports `en` alone now; `actual.zh` is
  // `undefined` there, and an `undefined` pack makes every lookup miss and fall
  // through to the call site's inline default — which is ENGLISH. That renders
  // as "the zh case passes by reading English", the exact failure the comment
  // above says these cases exist to rule out. Imported inside the factory
  // rather than at module scope because `vi.mock` is hoisted above the imports.
  const packs = await import('@object-ui/i18n/locales');
  const lookup = (pack: unknown, key: string): unknown =>
    key.split('.').reduce<any>((node, k) => (node == null ? undefined : node[k]), pack);
  return {
    ...actual,
    useObjectTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        const hit = lookup(locale === 'zh' ? packs.zh : packs.en, key);
        return typeof hit === 'string' ? hit : String(options?.defaultValue ?? key);
      },
    }),
    useObjectLabel: () => ({ objectLabel: ({ label }: { label?: string }) => label }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u_b', name: 'B', email: 'b@example.com', role: 'member' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: { id: 'org_jia', name: '甲' },
  }),
  // Irrelevant to this branch (`requestedAppMissing` returns above the no-app
  // guard), pinned to the least-privileged value so nothing here can be an
  // admin-only result.
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

const actionRunnerStub = { registerHandler: vi.fn(), getContext: () => ({}) };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ({ execute: vi.fn(), runner: actionRunnerStub }),
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

// ---------------------------------------------------------------------------
// The transport. One stubbed `fetch` behind a real adapter + real client.
// ---------------------------------------------------------------------------

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * The two answers `GET /api/v1/meta/app/:name` gives after objectstack#8135,
 * transcribed from that merged diff — `sendEnvelopeError(res, 403,
 * 'PERMISSION_DENIED', …)` and the pre-existing absence body.
 */
const DENIED_BODY = {
  success: false,
  error: {
    code: 'PERMISSION_DENIED',
    message: "You do not have permission to open the 'finance' app.",
  },
};
const ABSENT_BODY = {
  error: { code: 'RESOURCE_NOT_FOUND', message: 'Metadata item not found or access denied.' },
};
/**
 * The 200 a real server gives for a name with nothing behind it — the declared
 * `GetMetaItemResponse` envelope with `item` absent. Transcribed from the live
 * response measured for objectui#9262 (showcase example, `objectstack`
 * 60b9955, API 17.4.0).
 */
const ITEMLESS_ENVELOPE = {
  type: 'app',
  name: 'no_such_app',
  lock: 'none',
  editable: true,
  deletable: true,
  resettable: false,
};
/** The 200 for an app the route DOES serve — cause 8's half of the disagreement. */
const servedApp = (name: string) => ({ type: 'app', name, item: { name, label: name, navigation: [] } });

/** URLs the by-name meta route was asked for, in order. */
let metaItemRequests: string[] = [];
/** How the by-name route answers, per app name. */
let byName: Record<string, () => Response> = {};

function makeAdapter() {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v1/discovery')) {
      return json(200, { success: true, data: { version: 'v0', routes: {}, capabilities: {} } });
    }
    const item = /\/api\/v1\/meta\/app\/([^/?]+)/.exec(url);
    if (item) {
      metaItemRequests.push(url);
      const answer = byName[decodeURIComponent(item[1])];
      return answer ? answer() : json(404, ABSENT_BODY);
    }
    // Nothing else is part of this question; a loud 500 keeps an unexpected
    // call from passing as a silent success.
    return json(500, { error: { code: 'UNEXPECTED_REQUEST', message: url } });
  });
  return new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
}

/** The adapter this render sees — a real one by default. */
let adapter: unknown = null;
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
}));

/**
 * The list as the SERVER hands it to this session: the withheld app is simply
 * ABSENT, exactly as `filterAppForUser` leaves it. The ruling keeps it that way
 * — nothing in this file may depend on a flag in the list.
 */
let metadataApps: unknown[] = [];
const refreshMetadata = vi.fn(async () => {});
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: metadataApps,
    objects: [],
    loading: false,
    ensureType: undefined,
    error: null,
    refresh: refreshMetadata,
  }),
}));

import { AppContent } from '../AppContent';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

/** Drives an in-tree navigation, so the verdict meets a SECOND app name. */
let navTarget = '/apps/no_such_app';
function NavProbe() {
  const navigate = useNavigate();
  return (
    <button data-testid="go-elsewhere" onClick={() => navigate(navTarget)}>
      go
    </button>
  );
}

function renderConsoleAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <LocationProbe />
      <NavProbe />
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent />} />
        <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * The sentence objectui#9262 retired, verbatim as it stood in the `en` pack.
 * Kept as a constant precisely because it must never render again: a pin that
 * only asserts the new copy passes just as well if the old one is still there
 * beside it.
 */
const RETIRED_PUBLISHING_COPY =
  'This app is not available yet — it may still be publishing. Try again in a moment.';

/** The three screens this branch can render, by the verdict that produces each. */
const NOT_FOUND_COPY = "This app can't be opened";
const UNREACHABLE_COPY = "Couldn't reach the server";
const NEUTRAL_COPY = 'App not available';

describe('AppContent — every screen here states what the probe measured (objectui#4252 / objectui#9262)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locale = 'en';
    metadataApps = [{ name: 'crm', label: 'CRM', navigation: [] }];
    metaItemRequests = [];
    byName = {};
    adapter = makeAdapter();
  });

  it('THE DEFECT — a 403 PERMISSION_DENIED renders access denied, never "may still be publishing"', async () => {
    // The card's own repro: a session lacking the app's `requiredPermissions`
    // opens the app URL directly. The list withheld it; the by-name route says
    // WHY.
    byName.finance = () => json(403, DENIED_BODY);

    renderConsoleAt('/apps/finance');

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(screen.getByText("You don't have access to this app")).toBeInTheDocument();
    // Pre-#4252, THIS is what the same session was shown.
    expect(screen.queryByText(RETIRED_PUBLISHING_COPY)).not.toBeInTheDocument();
    // …and not under a Retry button whose promise is false: the decision is
    // permanent, so retrying it forever is the misdirection, one layer down.
    // None of the three retryable screens may appear here either.
    expect(screen.queryByTestId('app-not-available-retry')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-not-found-retry')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-unreachable-retry')).not.toBeInTheDocument();
    // The screen renders above `ConsoleLayout`, so it owns its own way back
    // (objectui#4473's strand, not to be recreated here).
    expect(screen.getByTestId('app-access-denied-home')).toBeInTheDocument();
  });

  it('asks the BY-NAME route for the app it was asked for — the list is never re-read for a flag', async () => {
    byName.finance = () => json(403, DENIED_BODY);

    renderConsoleAt('/apps/finance');
    await screen.findByTestId('app-access-denied');

    expect(metaItemRequests).toHaveLength(1);
    expect(metaItemRequests[0]).toContain('/api/v1/meta/app/finance');
    // The readiness re-check still runs FIRST — the probe is what happens after
    // a refreshed list still cannot find the app, not instead of it.
    expect(refreshMetadata).toHaveBeenCalled();
  });

  it('a 404 absence says the app cannot be opened — and asserts no cause for it', async () => {
    byName.no_such_app = () => json(404, ABSENT_BODY);

    renderConsoleAt('/apps/no_such_app');

    expect(await screen.findByTestId('app-not-found-retry')).toBeInTheDocument();
    expect(screen.getByText(NOT_FOUND_COPY)).toBeInTheDocument();
    // The four absences this one answer covers — never created, a typo, an
    // unpublished draft, an app gated by an absent optional service — are one
    // answer by the 2026-08-12 ruling's design. The screen may not pick one.
    expect(screen.queryByText(RETIRED_PUBLISHING_COPY)).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-unreachable')).not.toBeInTheDocument();
  });

  it('THE MEASURED SHAPE — an item-less 200 is an absence, not a served app', async () => {
    // objectui#9262 cause 8, measured on a real server BEFORE this branch was
    // written. The route answers 200 for a name with nothing behind it, so the
    // old probe ("it did not throw, so the app is there") reported `granted` —
    // and `granted` fell through to the same screen as `unknown`, which is why
    // the defect was invisible. Every typo and every never-created app took
    // this path, so a `not_found` branch keyed on the 404 alone would have been
    // dead for the commonest case this card exists to fix.
    byName.no_such_app = () => json(200, ITEMLESS_ENVELOPE);

    renderConsoleAt('/apps/no_such_app');

    expect(await screen.findByTestId('app-not-found-retry')).toBeInTheDocument();
    expect(screen.getByText(NOT_FOUND_COPY)).toBeInTheDocument();
    expect(screen.queryByText(NEUTRAL_COPY)).not.toBeInTheDocument();
  });

  it('a transport failure says the server could not be reached — and never claims a denial', async () => {
    // The information was always on the wire; folding it into the absence copy
    // was the defect. Saying "this app cannot be opened" here would assert an
    // absence nothing measured.
    byName.finance = () => {
      throw new Error('network down');
    };

    renderConsoleAt('/apps/finance');

    expect(await screen.findByTestId('app-unreachable-retry')).toBeInTheDocument();
    expect(screen.getByText(UNREACHABLE_COPY)).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND_COPY)).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
  });

  it('an adapter that cannot answer the probe asserts nothing at all', async () => {
    // A host may inject a DataSource without this probe (AGENTS #1 — the
    // console is protocol-agnostic). Nothing was asked, so `unknown` keeps the
    // screen that claims neither an absence nor a transport failure.
    adapter = { onConnectionStateChange: () => () => {}, getConnectionState: () => 'connected' };

    renderConsoleAt('/apps/finance');

    expect(await screen.findByTestId('app-not-available-retry')).toBeInTheDocument();
    expect(screen.getByText(NEUTRAL_COPY)).toBeInTheDocument();
    expect(screen.queryByText(RETIRED_PUBLISHING_COPY)).not.toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND_COPY)).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
  });

  it('CAUSE 8 — the route serves the app while the list does not carry it: assert nothing', async () => {
    // The disagreement itself. `granted` reaches this branch only when the
    // by-name route served the app AND the refreshed list still lacks it, so
    // the console has no document to render from and no account of why. The
    // neutral screen is the only one that does not invent an explanation —
    // naming an absence here would contradict the answer just received.
    byName.finance = () => json(200, servedApp('finance'));

    renderConsoleAt('/apps/finance');

    expect(await screen.findByTestId('app-not-available-retry')).toBeInTheDocument();
    expect(screen.getByText(NEUTRAL_COPY)).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND_COPY)).not.toBeInTheDocument();
    expect(screen.queryByText(UNREACHABLE_COPY)).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
  });

  it('MUST NOT CHANGE — an authorized session enters the app, and nothing is probed', async () => {
    metadataApps = [{ name: 'finance', label: 'Finance', navigation: [] }];

    renderConsoleAt('/apps/finance');

    const layout = await screen.findByTestId('console-layout');
    expect(layout).toHaveAttribute('data-active-app', 'finance');
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
    // The probe is a consequence of the app being missing; an app that resolved
    // must not cost a request.
    expect(metaItemRequests).toEqual([]);
  });

  it('renders the denial in the active language — zh, from the shipped pack', async () => {
    locale = 'zh';
    byName.finance = () => json(403, DENIED_BODY);

    renderConsoleAt('/apps/finance');

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(screen.getByText('你没有访问此应用的权限')).toBeInTheDocument();
    expect(screen.queryByText(RETIRED_PUBLISHING_COPY)).not.toBeInTheDocument();
  });

  it('renders the absence in the active language too — zh, from the shipped pack', async () => {
    locale = 'zh';
    byName.no_such_app = () => json(404, ABSENT_BODY);

    renderConsoleAt('/apps/no_such_app');

    expect(await screen.findByTestId('app-not-found-retry')).toBeInTheDocument();
    expect(screen.getByText('无法打开此应用')).toBeInTheDocument();
    // The retired sentence, in the pack that had its own translation of it.
    expect(screen.queryByText('此应用尚不可用 —— 可能仍在发布中。请稍后重试。')).not.toBeInTheDocument();
  });

  it('renders the unreachable screen in the active language too — zh', async () => {
    locale = 'zh';
    byName.finance = () => {
      throw new Error('network down');
    };

    renderConsoleAt('/apps/finance');

    expect(await screen.findByTestId('app-unreachable-retry')).toBeInTheDocument();
    expect(screen.getByText('无法连接到服务器')).toBeInTheDocument();
  });

  it('the verdict belongs to the app it was asked about — a second missing app is judged afresh', async () => {
    // Both apps are missing from the list, so `requestedAppMissing` never goes
    // false between them and no state in this branch is reset by the transition.
    // A verdict held loose from the name it describes would therefore ride into
    // the next URL and answer for an app it never probed — telling a user their
    // typo is a permission problem.
    byName.finance = () => json(403, DENIED_BODY);
    byName.no_such_app = () => json(404, ABSENT_BODY);

    renderConsoleAt('/apps/finance');
    await screen.findByTestId('app-access-denied');

    navTarget = '/apps/no_such_app';
    screen.getByTestId('go-elsewhere').click();

    expect(await screen.findByTestId('app-not-found-retry')).toBeInTheDocument();
    expect(screen.getByText(NOT_FOUND_COPY)).toBeInTheDocument();
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
    // …and each app was asked about itself, once.
    expect(metaItemRequests).toHaveLength(2);
    expect(metaItemRequests[1]).toContain('/api/v1/meta/app/no_such_app');
  });

  it('the retired sentence is gone from all ten packs, not just from the call site', async () => {
    // The call site's inline `defaultValue` is only reached when a pack MISSES
    // the key, so rewriting the component while a pack still carried the old
    // sentence would leave that language telling users about a publish — and
    // every case above would stay green, because they render `en` and `zh`.
    // Asserted against the packs themselves for that reason.
    const packs = await import('@object-ui/i18n/locales');
    const LANGS = ['en', 'zh', 'de', 'es', 'fr', 'pt', 'ru', 'ja', 'ko', 'ar'] as const;
    const stillPublishing: string[] = [];
    for (const lang of LANGS) {
      const pack = (packs as Record<string, any>)[lang];
      // Non-vacuity first: a missing pack would satisfy the scan below while
      // checking nothing (the objectui#7479 trap — the entry re-exports `en`
      // alone, so these must come from `@object-ui/i18n/locales`).
      expect(typeof pack?.empty?.appNotAvailableDescription, `${lang} pack missing`).toBe('string');
      expect(typeof pack?.empty?.appNotFound, `${lang} lacks the not-found title`).toBe('string');
      expect(typeof pack?.empty?.appUnreachable, `${lang} lacks the unreachable title`).toBe('string');
      const values: string[] = [
        pack.empty.appNotAvailableDescription,
        pack.empty.appNotFoundDescription,
        pack.empty.appUnreachableDescription,
      ];
      // The claim, not the English wording: every pack translated "publishing"
      // into its own language, so a string match on `en` would pass ten times
      // over and measure one. `{publish|发布|公開|게시|publica|publiée|…}` is a
      // per-pack stem, listed with the pack it belongs to.
      const PUBLISH_STEM: Record<string, RegExp> = {
        en: /publish/iu, zh: /发布/u, de: /veröffentlich/iu, es: /publica/iu,
        fr: /publi/iu, pt: /publica/iu, ru: /публикац/iu, ja: /公開/u,
        ko: /게시/u, ar: /النشر/u,
      };
      if (values.some((v) => PUBLISH_STEM[lang].test(v))) stillPublishing.push(lang);
    }
    // The matcher must be able to fire, or the empty list above means nothing.
    expect(/publish/iu.test(RETIRED_PUBLISHING_COPY), 'the stem does not match the retired sentence').toBe(true);
    expect(
      stillPublishing,
      'these packs still assert a publish on a screen that never measured one — objectui#9262',
    ).toEqual([]);
  });

  it('the denial screen offers a way back to /home', async () => {
    // Nothing declared in `metadataApps` here (the `beforeEach` list is a plain
    // `crm`), so home IS the launcher — the status quo objectui#7373 kept.
    byName.finance = () => json(403, DENIED_BODY);

    renderConsoleAt('/apps/finance');
    const home = await screen.findByTestId('app-access-denied-home');
    home.click();

    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/home'));
  });

  it('…and that way back follows the DECLARED landing where there is one (objectui#7373)', async () => {
    // The card's own case. On cloud's control plane `cloud_control` declares
    // the landing, so a customer refused an app they may not open must land
    // back on it — not on the environment launcher, whose "Build an app" /
    // "Start from a template" cards act on an environment the control plane
    // does not have and whose "Your apps" tiles are its own internal management
    // apps. The pin fails on the pre-#7373 implementation, which named `/home`
    // literally whatever the deployment declared.
    metadataApps = [
      { name: 'cloud_control', label: 'Cloud', isDefault: true, navigation: [] },
      { name: 'account', label: 'Account', navigation: [] },
    ];
    byName.finance = () => json(403, DENIED_BODY);

    renderConsoleAt('/apps/finance');
    const home = await screen.findByTestId('app-access-denied-home');
    home.click();

    await waitFor(() =>
      expect(screen.getByTestId('pathname').textContent).toBe('/apps/cloud_control'),
    );
  });

  // objectui#13122 — the three retryable verdicts render above `ConsoleLayout`
  // just as the denial does, so Retry alone was a full-screen dead end for a
  // stale bookmark or an uninstalled app's link. Each now offers the denial
  // screen's way home beside Retry: same copy, same navigation.
  const RETRYABLE_VERDICTS: ReadonlyArray<{ testId: string; arrange: () => void }> = [
    { testId: 'app-not-found', arrange: () => { byName.finance = () => json(404, ABSENT_BODY); } },
    {
      testId: 'app-unreachable',
      arrange: () => {
        byName.finance = () => {
          throw new Error('network down');
        };
      },
    },
    {
      testId: 'app-not-available',
      arrange: () => {
        adapter = { onConnectionStateChange: () => () => {}, getConnectionState: () => 'connected' };
      },
    },
  ];

  it.each(RETRYABLE_VERDICTS)('the $testId screen offers the way home beside Retry, and it goes home', async ({ testId, arrange }) => {
    arrange();

    renderConsoleAt('/apps/finance');
    const home = await screen.findByTestId(`${testId}-home`);
    expect(home).toHaveTextContent('Back to home');
    expect(screen.getByTestId(`${testId}-retry`)).toBeInTheDocument();
    home.click();

    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/home'));
    expect(screen.getByTestId('home-launcher')).toBeInTheDocument();
  });

  // Independent of the way home on purpose: dropping that button leaves these
  // green, so a red here is Retry itself, never the button beside it.
  it.each(RETRYABLE_VERDICTS)('CONTROL — Retry on the $testId screen is still drawn and still re-checks', async ({ testId, arrange }) => {
    arrange();

    renderConsoleAt('/apps/finance');
    const retry = await screen.findByTestId(`${testId}-retry`);
    const before = refreshMetadata.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    retry.click();

    await waitFor(() => expect(refreshMetadata.mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByTestId(`${testId}-retry`)).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/apps/finance');
  });
});

/**
 * objectui#12285 — the same verdicts, reached from the URL form ADR-0048 §3.1
 * makes the app's routing key: `/apps/PACKAGE_ID`, the segment the admin's own
 * Setup links use.
 *
 * Nothing in the console changed for this: `AppContent` hands the URL segment
 * to `probeAppAccess` as it stands, and since objectstack-ai/objectstack#23183
 * (published in `@objectstack/*` `18.0.0-next.2`) the by-name app route
 * answers for a package-id key. Before it, `GET /api/v1/meta/app/PACKAGE_ID`
 * answered 404 for a withheld app, so a member saw "This app can't be opened"
 * where "You don't have access to this app" is right. The cases below pin the
 * console's half of that pair, with the bodies a real server gives, so a
 * console change that re-keys the probe (to a resolved name, or to the list)
 * goes red here: a withheld app's row is absent from the member's list, so no
 * name can be resolved for it on this side.
 *
 * The bodies are transcribed from a live `18.0.0-next.2` backend
 * (`e2e/live/ci/start-backend.sh`, member persona `phone.demo@example.com`)
 * read while landing this card; nothing here re-derives them.
 */
describe('AppContent — a package-id URL reaches the same verdicts (objectui#12285)', () => {
  const SETUP_PACKAGE_ID = 'com.objectstack.setup';
  /** The live 403 for a member on Setup's package-id key: it echoes the key, never the name. */
  const PACKAGE_ID_DENIED_BODY = {
    success: false,
    error: {
      code: 'PERMISSION_DENIED',
      message: `You do not have permission to open the '${SETUP_PACKAGE_ID}' app.`,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    locale = 'en';
    // The member's list as the server hands it: Setup is withheld, so absent.
    metadataApps = [{ name: 'showcase_app', _packageId: 'com.example.showcase', label: 'Showcase', navigation: [] }];
    metaItemRequests = [];
    byName = {};
    adapter = makeAdapter();
  });

  it('THE CARD — a member on a withheld app\'s package-id URL sees access denied, not "can\'t be opened"', async () => {
    byName[SETUP_PACKAGE_ID] = () => json(403, PACKAGE_ID_DENIED_BODY);

    renderConsoleAt(`/apps/${SETUP_PACKAGE_ID}`);

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(screen.getByText("You don't have access to this app")).toBeInTheDocument();
    expect(screen.queryByTestId('app-not-found')).not.toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND_COPY)).not.toBeInTheDocument();
    // Asked by the key the URL carries, once — not by a name the console guessed.
    expect(metaItemRequests).toHaveLength(1);
    expect(metaItemRequests[0]).toContain(`/api/v1/meta/app/${SETUP_PACKAGE_ID}`);
  });

  it('CONTROL — an unknown package id still shows not found', async () => {
    // The server answers an unknown package byte-identically to an unknown
    // name, so the console has nothing to tell apart and must not try.
    byName['com.example.no-such-pkg'] = () => json(404, ABSENT_BODY);

    renderConsoleAt('/apps/com.example.no-such-pkg');

    expect(await screen.findByTestId('app-not-found')).toBeInTheDocument();
    expect(screen.getByText(NOT_FOUND_COPY)).toBeInTheDocument();
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
  });

  it('CONTROL — the by-name URL of the same app keeps its denied verdict', async () => {
    byName.setup = () => json(403, {
      success: false,
      error: { code: 'PERMISSION_DENIED', message: "You do not have permission to open the 'setup' app." },
    });

    renderConsoleAt('/apps/setup');

    expect(await screen.findByTestId('app-access-denied')).toBeInTheDocument();
    expect(metaItemRequests.every((u) => u.includes('/api/v1/meta/app/setup'))).toBe(true);
  });

  it('CONTROL — a holder opens the app at its package-id URL, and nothing is probed', async () => {
    // The holder's list carries the app, so the segment resolves through
    // `_packageId` and the by-name route is never asked.
    metadataApps = [{ name: 'setup', _packageId: SETUP_PACKAGE_ID, label: 'Setup', navigation: [] }];

    renderConsoleAt(`/apps/${SETUP_PACKAGE_ID}`);

    const layout = await screen.findByTestId('console-layout');
    expect(layout).toHaveAttribute('data-active-app', 'setup');
    expect(screen.queryByTestId('app-access-denied')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-not-found')).not.toBeInTheDocument();
    expect(metaItemRequests).toEqual([]);
  });
});
