// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/accept-invitation/:invitationId` renders app-shell's
 * `DefaultAcceptInvitationPage` — objectui#3811.
 *
 * ## What this file exists to prove
 *
 * Two components shipped for this one URL. Console routed its own thin page
 * (`apps/console/src/pages/auth/AcceptInvitationPage.tsx`, deleted with this
 * change) which offered a bare accept/decline pair; app-shell's page was
 * exported as `DefaultAcceptInvitationPage` and routed by nobody, even though
 * it fetches the invitation, shows the organization / role / expiry, and
 * switches the user into that organization on accept. The maintainer ruling on
 * #3811 is option A: console routes the richer page and the thin one — plus its
 * `acceptInvitation.*` namespace, 12 keys in each of ten packs — is deleted.
 *
 * So this file measures three things the swap could get wrong, and it measures
 * them through the SHIPPED export (`@object-ui/app-shell`), not a local copy:
 *
 *   1. **It renders coherently in console's route.** The ruling presumed the
 *      styling was compatible; that presumption is checked here rather than
 *      assumed. Console mounts this route BARE — no `AuthLayout` wrapper, the
 *      same shape `App.tsx` gives it (`App.tsx`, `/accept-invitation/…`) — so
 *      the page has to paint its own full-viewport shell, which is exactly what
 *      the sibling self-shelled auth surfaces do. The real
 *      `@object-ui/components` `Button` and real lucide icons are used, NOT
 *      passthrough stubs: a stubbed primitive can only tell you the component
 *      called it, never that the result is a coherent screen.
 *   2. **The two capabilities the thin page lacked are live** — org / role /
 *      expiry on screen, and `switchOrganization` on accept. These are the
 *      user-visible gains the ruling buys, so they are pinned, not assumed.
 *   3. **The anonymous bounce still produces a router-relative `?redirect=`.**
 *      Console's `?redirect=` contract is a basename-STRIPPED path — `LoginPage`
 *      re-prefixes it with `withConsoleBase()` before a full-page navigation,
 *      and `App.tsx`'s own `LoginRedirect` produces it from `useLocation()`. A
 *      producer reading `window.location.pathname` instead hands over a path
 *      that already carries the mount prefix, and the console then doubles it.
 *      The thin page built the path from the route param and was correct; the
 *      app-shell page read `window.location.pathname`. The `basename` case below
 *      is the one that separates them — it fails on the pre-fix source with
 *      `/console/accept-invitation/inv_1` and passes on the fixed one. Under the
 *      default `/` mount both spellings agree, which is why the plain case alone
 *      would have shipped the regression green.
 *
 * Locale coverage lives with the packs (`packages/i18n/src/__tests__/
 * auth-namespace-3546.test.tsx`); what is asserted here is only that this
 * screen's copy now arrives through `organization.accept.*`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

/**
 * Only `useAuth` is replaced — everything else in `@object-ui/auth` stays real,
 * because app-shell's barrel pulls the module in for its own providers and a
 * whole-module stub would break the import rather than the component.
 */
let authState: Record<string, unknown>;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => authState,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: { success: toastSuccess, error: toastError } };
});

// Imported after the mocks so the barrel picks them up.
const { DefaultAcceptInvitationPage } = await import('@object-ui/app-shell');

const INVITATION = {
  id: 'inv_1',
  organizationId: 'org_1',
  organizationName: 'Acme Corp',
  email: 'ada@example.com',
  role: 'admin',
  status: 'pending',
  expiresAt: '2026-12-24T10:00:00.000Z',
};

/** Records every path the router settles on, so "landed on X" is an assertion. */
const seen: string[] = [];
function Recorder() {
  const location = useLocation();
  seen.push(location.pathname + location.search);
  return null;
}

/**
 * Records the FULL-PAGE navigations the page performs (objectui#7373).
 *
 * The accept path leaves React Router deliberately — see the comment at that
 * call site — so "where did it go" cannot be read off `seen`, which only sees
 * in-router transitions. Assigning `window.location.href` for real would make
 * the environment try to navigate, so the accessor is swapped for the duration
 * of each case and restored exactly as it was found (own property or
 * prototype accessor, whichever it was).
 */
let navigations: string[] = [];
let ownHref: PropertyDescriptor | undefined;

function captureFullPageNavigations() {
  navigations = [];
  ownHref = Object.getOwnPropertyDescriptor(window.location, 'href');
  const inherited = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(window.location),
    'href',
  );
  Object.defineProperty(window.location, 'href', {
    configurable: true,
    get: () => (ownHref?.get ?? inherited?.get)?.call(window.location) ?? '',
    set: (value: string) => {
      navigations.push(String(value));
    },
  });
}

function releaseFullPageNavigations() {
  if (ownHref) Object.defineProperty(window.location, 'href', ownHref);
  else delete (window.location as unknown as Record<string, unknown>).href;
  ownHref = undefined;
}

/**
 * Mount the page exactly as `apps/console/src/App.tsx` does: inside the
 * console's `BrowserRouter`, on the real path, with NO layout wrapper.
 * `basename` mirrors a console served under a `<base href>` mount.
 */
function renderRoute({ basename = '/', lang = 'en' }: { basename?: string; lang?: string } = {}) {
  const mount = basename === '/' ? '' : basename;
  window.history.pushState({}, '', `${mount}/accept-invitation/inv_1`);
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <BrowserRouter basename={basename}>
        <Recorder />
        <Routes>
          <Route path="/accept-invitation/:invitationId" element={<DefaultAcceptInvitationPage />} />
          <Route path="/login" element={<div data-testid="login-sentinel" />} />
          {/* ⛔ Keep this route declared even though nothing should land on it:
              the accept case asserts the sentinel is ABSENT, and a negative
              assertion against a route that does not exist passes for the
              wrong reason (objectui#7373). */}
          <Route path="/home" element={<div data-testid="home-sentinel" />} />
          <Route path="/organizations" element={<div data-testid="orgs-sentinel" />} />
        </Routes>
      </BrowserRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  seen.length = 0;
  captureFullPageNavigations();
  window.localStorage.clear();
  authState = {
    isAuthenticated: true,
    isLoading: false,
    getInvitation: vi.fn().mockResolvedValue(INVITATION),
    acceptInvitation: vi.fn().mockResolvedValue(undefined),
    rejectInvitation: vi.fn().mockResolvedValue(undefined),
    switchOrganization: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  releaseFullPageNavigations();
  window.history.pushState({}, '', '/');
});

describe('objectui#3811 — console routes DefaultAcceptInvitationPage', () => {
  describe('renders coherently in console\'s route, with no AuthLayout around it', () => {
    it('paints its own full-viewport shell and a real card', async () => {
      renderRoute();
      const card = await screen.findByTestId('accept-invitation-page');

      // The card chrome the page declares — present means the Tailwind classes
      // survived the trip through the published build entry, not just that a
      // <div> exists.
      for (const cls of ['rounded-xl', 'border', 'bg-card', 'p-8', 'shadow-sm']) {
        expect(card.className, `card lost ${cls}`).toContain(cls);
      }

      // …and it centres itself in a full-viewport shell. This is what makes the
      // bare route (no AuthLayout) render as a page rather than as a stray card
      // pinned to the top-left, and it is the styling claim the ruling assumed.
      const shell = card.parentElement as HTMLElement;
      expect(shell).not.toBeNull();
      for (const cls of ['min-h-svh', 'items-center', 'justify-center']) {
        expect(shell.className, `shell lost ${cls}`).toContain(cls);
      }
    });

    it('resolves the real Shadcn primitives — two working buttons, a real heading', async () => {
      renderRoute();
      await screen.findByTestId('accept-invitation-page');

      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(2);
      // cva-generated Shadcn classes: proof the real `Button` answered rather
      // than a stub that would have rendered a bare, unstyled element.
      for (const b of buttons) {
        expect(b.className).toContain('inline-flex');
        expect(b).toBeEnabled();
      }
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('You have been invited');
    });
  });

  describe('the two capabilities the thin console page did not have', () => {
    it('shows which organization, which role and when the invitation expires', async () => {
      renderRoute();
      await screen.findByTestId('accept-invitation-page');

      expect(authState.getInvitation).toHaveBeenCalledWith('inv_1');
      // Organization — twice: in the sentence and in the detail row.
      expect(screen.getAllByText(/Acme Corp/).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Organization')).toBeInTheDocument();
      expect(screen.getByText('Role')).toBeInTheDocument();
      // The DISPLAY name, not the raw `sys_member.role` identifier: since
      // objectui#4474 the role row resolves through the shared role-label map,
      // so `admin` renders as `Admin` here and as 管理员 in a zh session. The
      // capability this case pins — "shows which role" — is unchanged.
      expect(screen.getByText('Admin')).toBeInTheDocument();
      expect(screen.getByText('Expires')).toBeInTheDocument();
      expect(
        screen.getByText(new Date(INVITATION.expiresAt).toLocaleDateString()),
      ).toBeInTheDocument();
    });

    it('accept switches the user into the invited organization, then reloads onto the console ROOT', async () => {
      // objectui#7373 moved this landing. It used to be an in-router
      // `navigate('/home')` — the environment launcher, reached without leaving
      // the SPA, which is exactly why it could not honour the declaration: the
      // app list in memory at that instant is the org the user just LEFT
      // (`MetadataProvider` drops its cache on an org change, objectui#4486,
      // and refetches after this line has already run). Landing on the root
      // lets `RootLandingRedirect` resolve `app.isDefault` for the org the user
      // just JOINED, which is the shape `WorkspaceSwitcher.handleSwitch` and
      // `OrganizationsPage.handleSelect` already take for the same transition.
      const user = userEvent.setup();
      renderRoute();
      await screen.findByTestId('accept-invitation-page');

      await user.click(screen.getByRole('button', { name: /Accept invitation/ }));

      await waitFor(() => expect(authState.switchOrganization).toHaveBeenCalledWith('org_1'));
      expect(authState.acceptInvitation).toHaveBeenCalledWith('inv_1');
      // Order matters: the membership must exist before the switch is attempted.
      expect((authState.acceptInvitation as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
        (authState.switchOrganization as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
      );

      // A full page load, not a router transition — the whole point is that
      // every data scope is re-seated on the new organization before anything
      // reads the app list.
      await waitFor(() => expect(navigations).toHaveLength(1));
      // Asked of the RESOLVED target, the way the browser resolves it, rather
      // than by string equality with the call — the shipped embeddable build's
      // correct answer is a relative `'./'` (`utils/consoleBase.test.ts`), and
      // a pin on the literal would forbid it while proving nothing.
      const landed = new URL(navigations[0], document.baseURI);
      expect(landed.pathname, 'accept must land on the console root').toBe('/');
      // …and specifically NOT on the launcher this replaced. Stated separately
      // because that is the regression with a name: a root that is `/home` is
      // the defect objectui#7373 was filed about, wearing a page load.
      expect(landed.pathname).not.toBe('/home');
      expect(navigations[0]).not.toContain('/home');

      // The router must NOT have handled it. `seen` records every in-router
      // transition, so a `navigate()` regression shows up here even if a page
      // load were also performed.
      expect(screen.queryByTestId('home-sentinel')).not.toBeInTheDocument();
      expect(seen).not.toContain('/home');

      expect(toastSuccess).toHaveBeenCalledWith('Invitation accepted');
    });

    it('decline rejects the invitation and lands on /organizations', async () => {
      const user = userEvent.setup();
      renderRoute();
      await screen.findByTestId('accept-invitation-page');

      await user.click(screen.getByRole('button', { name: /Decline/ }));

      await waitFor(() => expect(authState.rejectInvitation).toHaveBeenCalledWith('inv_1'));
      expect(authState.switchOrganization).not.toHaveBeenCalled();
      await screen.findByTestId('orgs-sentinel');
    });
  });

  describe('anonymous visitors still bounce to /login with a return path', () => {
    it('emits a router-relative ?redirect= at the default mount', async () => {
      authState.isAuthenticated = false;
      renderRoute();

      await screen.findByTestId('login-sentinel');
      expect(seen).toContain(`/login?redirect=${encodeURIComponent('/accept-invitation/inv_1')}`);
      // Nothing was fetched for an anonymous visitor.
      expect(authState.getInvitation).not.toHaveBeenCalled();
    });

    it('does NOT carry the console mount prefix when served under a basename', async () => {
      authState.isAuthenticated = false;
      renderRoute({ basename: '/console' });

      await screen.findByTestId('login-sentinel');
      const redirects = seen.filter((p) => p.startsWith('/login'));
      expect(redirects).not.toHaveLength(0);
      // `LoginPage.withConsoleBase()` re-prefixes the mount, so a `?redirect=`
      // that already contains `/console` produces `/console/console/…`. The
      // pre-fix source read `window.location.pathname` and failed exactly here.
      for (const r of redirects) {
        expect(decodeURIComponent(r), 'redirect carries the mount prefix').not.toContain(
          '/console/accept-invitation',
        );
        expect(decodeURIComponent(r)).toContain('/accept-invitation/inv_1');
      }
    });
  });

  it('takes its copy from `organization.accept.*` — the surviving namespace', async () => {
    // The deleted thin page read `acceptInvitation.*`. Rendering in zh proves
    // the pack is what answers (an inline English `defaultValue` could not),
    // and that the answer comes from the namespace that stayed.
    renderRoute({ lang: 'zh' });
    await screen.findByTestId('accept-invitation-page');

    const zh = builtInLocales.zh.organization.accept as Record<string, string>;
    expect(zh.accept).toBe('接受邀请');
    expect(screen.getByRole('button', { name: zh.accept })).toBeInTheDocument();
    expect(screen.getByText(zh.organization)).toBeInTheDocument();
    expect(screen.getByText(zh.expiresAt)).toBeInTheDocument();
    // The pack that used to serve this screen's other half is gone entirely.
    expect((builtInLocales.zh as Record<string, unknown>).acceptInvitation).toBeUndefined();
  });
});
