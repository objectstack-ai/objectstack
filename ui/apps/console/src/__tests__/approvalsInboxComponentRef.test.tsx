// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `approvals:inbox` — the component-registry key for the Approvals Inbox
 * (objectstack#7231).
 *
 * ## What this file is for
 *
 * objectstack#7213 converges the three coexisting "待我审批" entries at the
 * METADATA level: app navigation names a registry key, not a literal URL. This
 * file pins the key's three load-bearing properties, in the order a nav item
 * exercises them:
 *
 *   1. the key is registered at all, by importing the registration module the
 *      way `main.tsx` does — a side effect, next to the developer / studio /
 *      account registrations;
 *   2. `approvals:inbox` addresses `component/approvals/inbox`, so the URL the
 *      sidebar builds and the key the framework's metadata declares cannot
 *      drift apart. The URLs below are BUILT from the ref through the same
 *      helper `AppContent` uses, rather than spelled out, so a change to
 *      either one moves both;
 *   3. the page mounted through that route still sees `:appName` and
 *      `?request=<id>` — the two router inputs `ApprovalsInboxPage` reads
 *      (`useParams().appName` for record and request deep links,
 *      `useSearchParams()` for the notification deep link, which opens the
 *      request on its served page since objectui#12484).
 *
 * Property 3 is the one worth measuring rather than assuming: the standalone
 * `system/approvals` route and the `component/:ns/:name/*` route are different
 * paths and only look interchangeable. They are interchangeable HERE because
 * both are relative routes under `/apps/:appName/*` (`App.tsx`), which is what
 * the last case asserts by driving the same probe down both.
 *
 * What this file deliberately does NOT assert is that `main.tsx` performs that
 * side-effect import — the one remaining way the key could be missing at
 * runtime. `apps/console`'s tsconfig ships no `@types/node`, so reading the
 * source back is not typecheckable here, and reaching for `vite/client` to
 * make it so would widen the app's type surface for a test. The import sits in
 * `main.tsx` beside its three siblings; a reviewer sees it in one line of diff.
 *
 * ## Scope of the stub
 *
 * `ApprovalsInboxPage` itself is stubbed at its module boundary. Its internals
 * (tabs, queue, decision actions) are objectui#2762's subject and are being
 * rebuilt wholesale by objectui#2763; what belongs to THIS change is only what
 * the routing hands the page. The stub is a probe that echoes exactly those two
 * inputs, and it is mocked at the same specifier the registration lazy-imports,
 * so the entry under test is the real registered one — Suspense wrapper
 * included — not a re-creation of it.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
}));

// The probe stands in for the page at the exact specifier
// `registerApprovalsComponents` lazy-imports, so the registry entry exercised
// below is the production one.
vi.mock('../pages/system/ApprovalsInboxPage', async () => {
  const { useParams, useSearchParams } = await import('react-router-dom');
  return {
    ApprovalsInboxPage: () => {
      const { appName } = useParams<{ appName?: string }>();
      const [search] = useSearchParams();
      return (
        <div>
          <span data-testid="probe-app">{appName ?? '(none)'}</span>
          <span data-testid="probe-request">{search.get('request') ?? '(none)'}</span>
        </div>
      );
    },
  };
});

import { getAppComponent, componentRefToUrlSegments } from '@object-ui/app-shell';

// Side-effect import: this is the module under test.
import '../registerApprovalsComponents';

const REF = 'approvals:inbox';

/** The `component/...` path the sidebar builds for a `componentRef` nav item. */
const componentPath = (ref: string) => `component/${componentRefToUrlSegments(ref).join('/')}`;

function renderAt(url: string, routePath: string) {
  const entry = getAppComponent(REF);
  if (!entry) throw new Error(`${REF} is not registered`);
  const Registered = entry.component;
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/apps/:appName/*"
          element={
            <Routes>
              <Route path={routePath} element={<Registered />} />
            </Routes>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('approvals:inbox component ref (objectstack#7231)', () => {
  it('is registered by the module `main.tsx` side-effect-imports', () => {
    expect(getAppComponent(REF)).toBeDefined();
    expect(getAppComponent(REF)?.source).toBe('@object-ui/console');
  });

  it('addresses the `component/approvals/inbox` URL segments', () => {
    expect(componentRefToUrlSegments(REF)).toEqual(['approvals', 'inbox']);
    expect(componentPath(REF)).toBe('component/approvals/inbox');
  });

  it('mounted via the component route, the page reads the app segment and the deep link', async () => {
    renderAt(`/apps/crm/${componentPath(REF)}?request=req_42`, `${componentPath(REF)}/*`);

    expect(await screen.findByTestId('probe-app')).toHaveTextContent('crm');
    expect(screen.getByTestId('probe-request')).toHaveTextContent('req_42');
  });

  it('the standalone system/approvals route keeps handing the page the same inputs', async () => {
    // The component ref is ADDITIVE. Server notifications and email links carry
    // `/system/approvals?request=<id>` and `InboxPopover` app-prefixes them, so
    // this route staying equivalent is a shipping constraint, not a nicety.
    renderAt('/apps/crm/system/approvals?request=req_42', 'system/approvals');

    expect(await screen.findByTestId('probe-app')).toHaveTextContent('crm');
    expect(screen.getByTestId('probe-request')).toHaveTextContent('req_42');
  });
});
