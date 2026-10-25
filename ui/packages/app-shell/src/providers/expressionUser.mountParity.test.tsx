/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6515 — the SHAPE pin objectui#6110's contract implies but never got.
 *
 * ## What went wrong, and why nothing caught it
 *
 * objectui#6110 exported `buildExpressionUser` so that "every console surface
 * that mounts the provider publishes the SAME `current_user` shape", and said
 * in as many words that a second mount site re-deriving the shape by hand
 * "would reintroduce exactly the asymmetry #6010's parity pin exists to
 * refuse". `RecordFormPage` was such a site and did exactly that:
 *
 *     { name, email, role, positions }        // the hand-rolled descriptor
 *
 * — no `id`, no `isPlatformAdmin`. Both are named by real gates
 * (`ctx.user.isPlatformAdmin == true` on `sys_environment`'s "Change Plan
 * (admin)"; `record.id == ctx.user.id` throughout `sys_user`). An ABSENT key is
 * not `false`: the predicate FAULTS, and `evaluateVisibility` fails OPEN on a
 * fault, so an admin-only field rendered for every user with nothing on screen
 * to say the gate had not bitten. objectui#6493 fixed which ROOTS were bound on
 * this page; it did not touch the SHAPE of the object bound under them.
 *
 * Every pin that existed asserted the normaliser's own output
 * (`AppContent.expressionUserShape.test.ts`). None asserted what a MOUNT SITE
 * publishes, so a site that never called the normaliser was invisible to all of
 * them.
 *
 * ## What this file asserts, and why "shape" and not "was it called"
 *
 * The probe sits INSIDE the page's own `ExpressionProvider` and reads the
 * predicate scope that provider actually publishes — the same
 * `PredicateScopeContext` `useCondition` / `useExpression` read at every
 * consumer. The assertion is `toStrictEqual(buildExpressionUser(session))` over
 * all four published spellings of the identity. That is a SHAPE comparison
 * against the normaliser's live output, so it fails for a site that hand-rolls
 * a descriptor whatever route it took to build it — including one that calls
 * the normaliser and then spreads extra keys over it, which a spy on the
 * function could not see. `toStrictEqual` (not `toEqual`) so a key written as
 * explicit `undefined` fails too: that is precisely the class of defect
 * objectui#5424 measured on this same object.
 *
 * `mountSites.ratchet.test.ts` is the other half — this file proves the shape
 * at the site it can render, that one refuses a NEW site that stops calling the
 * normaliser at all. Neither is sufficient alone.
 *
 * ## Reverse verification (direction predicted BEFORE running)
 *
 * Restore the hand-rolled descriptor in `RecordFormPage`:
 *   - both parity cases go RED on the missing `id` / `isPlatformAdmin`;
 *   - `hides an isPlatformAdmin-gated field from a non-admin` goes RED as
 *     `toContain` — the fault fails OPEN, so the field is PRESENT;
 *   - the same for the signed-IN `ctx.user.id` case, and for the signed-out
 *     `isPlatformAdmin` case;
 *   - `hides a ctx.user.id-gated field from a signed-out visitor` stays GREEN
 *     both ways — it measures the normaliser's own anonymous branch, which
 *     THIS card does not touch. (It was named `RECORDS: a ctx.user.id gate
 *     STILL fails open for a signed-out visitor` and asserted the opposite
 *     until objectui#6534 fixed that branch; see the case body.)
 *   - `grants ... to a platform admin` stays GREEN — fail-open and a correct
 *     `true` are indistinguishable at the call site, which is the whole reason
 *     the excluded-user cases carry the pin.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
// Not on the `@object-ui/react` barrel. The vitest alias maps that barrel to
// `packages/react/src`, so this deep path is the SAME module instance the
// `ExpressionProvider` under test publishes through (the idiom
// `anonSeedScope-5746.enumeration.test.tsx` uses for the same reason).
import { usePredicateScope } from '../../../react/src/hooks/useExpression';
import { buildExpressionUser } from './expressionUser';
import { RecordFormPage } from '../views/RecordFormPage';

const h = React.createElement;

const { publishedScopes, formSchemas, getAuthConfig, authState } = vi.hoisted(() => ({
  publishedScopes: [] as Record<string, any>[],
  formSchemas: [] as any[],
  getAuthConfig: vi.fn(async () => ({ features: {} as Record<string, unknown> })),
  authState: {
    user: null as Record<string, unknown> | null,
    activeOrganization: null as { name: string } | null,
  },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    get user() { return authState.user; },
    getAuthConfig,
    get activeOrganization() { return authState.activeOrganization; },
  }),
}));

/**
 * The probe. It stands in for `ObjectForm`, which is the page's only child
 * inside its `ExpressionProvider`, so what it reads is what a real descendant
 * of that provider reads — no interception, no spy on the provider.
 */
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: any) => {
    formSchemas.push(schema);
    publishedScopes.push(usePredicateScope());
    return h('div', { 'data-testid': 'object-form' });
  },
}));

const metadataState = { objects: [] as any[], loading: false };
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => metadataState }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => null }));

/** The served shape: `ExpressionInputSchema` normalises authored strings into this. */
const cel = (source: string) => ({ dialect: 'cel', source });

/*
 * ⚠️ FIXTURE SPELLING, objectui#6514. These gates were authored on `visible`,
 * the key the page read when this file was written; `FieldSchema` refuses that
 * spelling and objectui#6514 moved the call site onto the declared
 * `visibleWhen`. Only the carrier key moved — the predicate texts are still the
 * `sys_environment` / `sys_user` gates verbatim in shape, and every assertion
 * below is objectui#6515's and objectui#6534's, unweakened. This file measures
 * the SHAPE of the identity a mount site publishes; which key carries the
 * predicate is not part of that claim.
 */

const CONTACTS = {
  name: 'contacts',
  label: 'Contacts',
  fields: {
    name: { type: 'text' },
    // The `sys_environment` "Change Plan (admin)" gate, verbatim in shape.
    plan: { type: 'text', visibleWhen: cel('ctx.user.isPlatformAdmin == true') },
    // The same gate under the canonical spelling.
    plan_canonical: { type: 'text', visibleWhen: cel('current_user.isPlatformAdmin == true') },
    // `sys_user`'s own gates compare a record id against `ctx.user.id`; this is
    // the reachable half of that shape on a page with no `record` root.
    self_note: { type: 'text', visibleWhen: cel("ctx.user.id == 'u_admin'") },
  },
};

/** A measured protocol-17 session: a plain user, no platform-admin grant. */
const CLERK = {
  id: 'u_clerk', name: 'Bo', email: 'bo@example.com', role: 'user',
  positions: ['sales_clerk'],
};

/** The same face for a permission-set-derived platform admin. */
const ADMIN = {
  id: 'u_admin', name: 'Ada', email: 'ada@example.com', role: 'user',
  positions: ['user', 'platform_admin'], isPlatformAdmin: true,
};

function renderPage() {
  return render(
    h(I18nProvider, {
      config: { defaultLanguage: 'en', detectBrowserLanguage: false },
      children: h(
        MemoryRouter,
        { initialEntries: ['/apps/crm/contacts/new'] },
        h(Routes, null, h(Route, {
          path: '/apps/:appName/:objectName/new',
          element: h(RecordFormPage, { mode: 'create' }),
        })),
      ),
    }),
  );
}

/**
 * The LAST published scope / field list. `features` is fetched, so the first
 * render is always the pre-fetch one; reading anything but the last would
 * assert against a bag that is not the one the page settles on.
 */
const lastScope = (): Record<string, any> => publishedScopes[publishedScopes.length - 1];
const lastFields = (): string[] => formSchemas[formSchemas.length - 1].fields;

beforeEach(() => {
  metadataState.objects = [CONTACTS];
  metadataState.loading = false;
  authState.user = CLERK;
  authState.activeOrganization = null;
  getAuthConfig.mockResolvedValue({ features: {} });
  publishedScopes.length = 0;
  formSchemas.length = 0;
});
afterEach(cleanup);

describe('objectui#6515 — the record form page publishes the normaliser’s `current_user`, not a hand-rolled one', () => {
  it('publishes exactly `buildExpressionUser(session)` under all four identity spellings', async () => {
    authState.user = ADMIN;
    renderPage();
    await waitFor(() => expect(publishedScopes.length).toBeGreaterThan(0));

    const expected = buildExpressionUser(ADMIN);
    const scope = lastScope();

    // The pin. Before the fix this read
    // `{ name, email, role, positions }` — two keys short.
    expect(scope.current_user).toStrictEqual(expected);
    // ADR-0068 D1 binds one object under four names; asserting all four is what
    // stops a site publishing a normalised `current_user` and a private object
    // under an alias.
    expect(scope.user).toStrictEqual(expected);
    expect(scope.ctx.user).toStrictEqual(expected);
    expect(scope.os.user).toStrictEqual(expected);
  });

  it('publishes exactly `buildExpressionUser(null)` on the signed-out branch', async () => {
    // The signed-out branch diverged on its own: it carried no `isPlatformAdmin`
    // key at all, so `ctx.user.isPlatformAdmin == true` faulted for a signed-out
    // visitor rather than answering FALSE.
    authState.user = null;
    renderPage();
    await waitFor(() => expect(publishedScopes.length).toBeGreaterThan(0));

    const expected = buildExpressionUser(null);
    expect(expected.isPlatformAdmin).toBe(false);
    expect(lastScope().current_user).toStrictEqual(expected);
    expect(lastScope().ctx.user).toStrictEqual(expected);
  });

  it('hides an `isPlatformAdmin`-gated field from a non-admin', async () => {
    authState.user = CLERK;
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    // Ungated fields are unaffected — the filter still lets everything else by.
    expect(lastFields()).toContain('name');
    // Both were `toContain` before the fix: the key was absent, the predicate
    // faulted, and `evaluateVisibility` fails OPEN — so the admin-only field
    // was on screen for a sales clerk.
    expect(lastFields()).not.toContain('plan');
    expect(lastFields()).not.toContain('plan_canonical');
  });

  it('hides a `ctx.user.id`-gated field from the user it excludes', async () => {
    authState.user = CLERK;
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    // `id` was the other dropped key. Same fault, same fail-open.
    expect(lastFields()).not.toContain('self_note');
  });

  it('hides the `isPlatformAdmin` gate from a signed-out visitor', async () => {
    authState.user = null;
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    expect(lastFields()).toContain('name');
    // Was `toContain` before the fix: the hand-rolled anonymous descriptor
    // carried no `isPlatformAdmin` key at all, so the gate faulted and failed
    // open for a visitor with no session whatsoever.
    expect(lastFields()).not.toContain('plan');
    expect(lastFields()).not.toContain('plan_canonical');
  });

  it('hides a `ctx.user.id`-gated field from a signed-out visitor', async () => {
    // objectui#6534 — this case is the inverted successor of objectui#6515's
    // `RECORDS: a ctx.user.id gate STILL fails open for a signed-out visitor`.
    //
    // That case recorded the defect as a passing fact: `'id' in
    // buildExpressionUser(null)` was `false` and the excluded field was
    // `toContain`-present. Both assertions are flipped below, and the flip is
    // this card's reverse verification — the pin was GREEN on `origin/main`
    // (measured: 13/13 passing) and went RED the instant `id: null` landed,
    // which is what proves the normaliser's anonymous branch is the thing that
    // moved.
    //
    // ⚠️ The SECOND assertion is the load-bearing one and it is not
    // interchangeable with the first. `'id' in …` only proves the key exists;
    // it says nothing about whether CEL can compare against `null` rather than
    // faulting on it a second way. Only the rendered field list proves the gate
    // actually BITES — that `ctx.user.id == 'u_admin'` resolves to a clean
    // FALSE for an anonymous visitor and the field is filtered out. If `null`
    // merely relocated the fault, the first assertion would still pass and this
    // one would still find the field present.
    //
    // Fenced boundary (objectui#6443 / #6487 / #6445): fail-open on a predicate
    // that DOES fault is deliberate and is untouched. This asserts that this
    // predicate no longer faults, not that a faulting one now fails closed.
    authState.user = null;
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    expect('id' in buildExpressionUser(null)).toBe(true);
    expect(buildExpressionUser(null).id).toBeNull();
    // Ungated fields are untouched — this narrowed exactly one gate, and the
    // filter still lets everything else by. Without this line a change that
    // dropped ALL fields would pass the assertion below.
    expect(lastFields()).toContain('name');
    expect(lastFields()).not.toContain('self_note');
  });

  it('grants the `isPlatformAdmin` gate to a platform admin', async () => {
    // Control. GREEN before and after — a fault and a true both render the
    // field, which is exactly why it cannot stand in for the cases above.
    authState.user = ADMIN;
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    expect(lastFields()).toContain('plan');
    expect(lastFields()).toContain('plan_canonical');
    expect(lastFields()).toContain('self_note');
  });
});
