/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8166, the PAGE-level half — measured on a real record surface.
 *
 * `recordScopeDataRoot-8166.test.ts` pins the bag and the engine verdict.
 * This file renders `RecordFormPage`, which is a record surface in the card's
 * own sense, and asserts the two things a unit test on the builder cannot
 * reach:
 *
 * 1. ⭐ **The form does not CRASH.** This is the hard precondition the ruling
 *    was made under: "make it fault" must not mean "make it throw mid-render",
 *    because a record form that throws is worse than one that silently hides a
 *    field. Every fault channel on this path is fail-soft, and that is a
 *    property of the code, not of a promise — so it is asserted here, against a
 *    page rendering a `data.*`-gated field.
 * 2. **The bag the page PUBLISHES to its descendants carries no `data`.** The
 *    probe sits inside the page's own `ExpressionProvider`, so it reads what
 *    `form.tsx` reads through `usePredicateScope()` — the actual chain the card
 *    draws, not a reconstruction of it.
 *
 * The harness (probe + mocks + fixture shape) is
 * `expressionUser.mountParity.test.tsx`'s, which measures the same provider on
 * the same page for the identity roots.
 *
 * ## Reverse verification (direction predicted BEFORE running)
 *
 * Restore `data` to `buildExpressionScope` (and the `data:` argument at this
 * page's own `createExpressionEvaluator` call):
 *   - `publishes a predicate scope with no data root` goes RED — the key is
 *     back;
 *   - `a data.* gate is REPORTED` goes RED, and in the informative way: the
 *     reported reason reverts from `Unknown variable: data` to
 *     `No such key: status`, i.e. the page keeps warning but about the wrong
 *     thing;
 *   - `does not throw` stays GREEN both ways — it is the precondition, and a
 *     precondition that only holds after the change would not be one.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
// Not on the `@object-ui/react` barrel. The vitest alias maps that barrel to
// `packages/react/src`, so this deep path is the SAME module instance the
// `ExpressionProvider` under test publishes through.
import { usePredicateScope } from '../../../../react/src/hooks/useExpression';
// The reporter's dedupe `Set` is MODULE state shared across this file's tests.
// Without the reset, the first test to render registers every line and every
// later test reads silence — "a green run that checked nothing", in that
// module's own words.
import { __resetVisibilityPredicateWarnings } from '../../../../react/src/utils/visibilityDiagnostic';
import { RecordFormPage } from '../../views/RecordFormPage';

const h = React.createElement;

const { publishedScopes, formSchemas, getAuthConfig, authState } = vi.hoisted(() => ({
  publishedScopes: [] as Record<string, any>[],
  formSchemas: [] as any[],
  getAuthConfig: vi.fn(async () => ({ features: {} as Record<string, unknown> })),
  authState: { user: null as Record<string, unknown> | null },
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
    activeOrganization: null,
  }),
}));

/** The probe — stands in for `ObjectForm`, the page's only child inside its provider. */
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: any) => {
    formSchemas.push(schema);
    publishedScopes.push(usePredicateScope());
    return h('div', { 'data-testid': 'object-form' });
  },
}));

const metadataState = { objects: [] as any[], loading: false };
vi.mock('../MetadataProvider', () => ({ useMetadata: () => metadataState }));
vi.mock('../AdapterProvider', () => ({ useAdapter: () => null }));

/** The served shape: `ExpressionInputSchema` normalises authored strings into this. */
const cel = (source: string) => ({ dialect: 'cel', source });

const CONTACTS = {
  name: 'contacts',
  label: 'Contacts',
  fields: {
    name: { type: 'text' },
    // ⭐ The card's predicate, authored exactly as an author would write it
    // after the lint waved it through at `scope: 'record'`.
    wrong_layer: { type: 'text', visibleWhen: cel("data.status == 'x'") },
    // The positive control (objectui#8155): the root this tier already refuses.
    app_gated: { type: 'text', visibleWhen: cel("app.name == 'crm'") },
    // The regression floor — an identity gate this page DOES bind, and one the
    // signed-in fixture fails, so it must still HIDE.
    admin_only: { type: 'text', visibleWhen: cel('ctx.user.isPlatformAdmin == true') },
  },
};

const CLERK = {
  id: 'u_clerk', name: 'Bo', email: 'bo@example.com', role: 'user',
  positions: ['sales_clerk'],
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

const lastScope = (): Record<string, any> => publishedScopes[publishedScopes.length - 1];
const lastFields = (): string[] => formSchemas[formSchemas.length - 1].fields;

let warnings: string[];

beforeEach(() => {
  metadataState.objects = [CONTACTS];
  metadataState.loading = false;
  authState.user = CLERK;
  getAuthConfig.mockResolvedValue({ features: {} });
  publishedScopes.length = 0;
  formSchemas.length = 0;
  warnings = [];
  __resetVisibilityPredicateWarnings();
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warnings.push(a.join(' ')));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#8166 — the record form page, rendered', () => {
  it('⭐ does not throw while rendering a `data.*`-gated field (the ZONE-2 precondition)', async () => {
    // `render` rethrows anything the tree throws, so a crash fails here rather
    // than surfacing as an unrelated assertion further down.
    expect(() => renderPage()).not.toThrow();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));
    // And it renders the form, rather than an error boundary's fallback.
    expect(document.querySelector('[data-testid="object-form"]')).not.toBeNull();
  });

  it('publishes a predicate scope with no `data` root', async () => {
    renderPage();
    await waitFor(() => expect(publishedScopes.length).toBeGreaterThan(0));

    const scope = lastScope();
    expect(scope).not.toHaveProperty('data');
    // ⛔ and still no `app` (objectui#8155) — the sibling this card mirrors.
    expect(scope).not.toHaveProperty('app');
    // The roots that remain, so this is a fence and not a one-sided deletion.
    expect(scope).toHaveProperty('current_user');
    expect(scope).toHaveProperty('features');
    expect(scope.os.user).toBe(scope.user);
  });

  it('REPORTS the `data.*` gate — the same channel the `app` control uses', async () => {
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    const dataLine = warnings.find((w) => w.includes("data.status == 'x'"));
    const appLine = warnings.find((w) => w.includes("app.name == 'crm'"));

    // The control first: this is what "loud" already looked like on this
    // surface, and it is the shape the `data` line has to match.
    expect(appLine).toBeDefined();
    expect(appLine).toContain('Unknown variable: app');

    expect(dataLine).toBeDefined();
    expect(dataLine).toContain('Unknown variable: data');
    // The author's locator: the predicate SOURCE and the key they wrote.
    expect(dataLine).toContain('visibleWhen');
  });

  it('REGRESSION FLOOR — a correct identity gate still hides, an ungated field still shows', async () => {
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    const fields = lastFields();
    // The floor: the gate that CAN resolve still bites, and a clerk is not a
    // platform admin. If this ever reads `toContain`, the change broke working
    // predicates and the card's whole point with it.
    expect(fields).not.toContain('admin_only');
    // Ungated fields are untouched.
    expect(fields).toContain('name');
    // And the faulting ones fail OPEN, which is this tier's shipped, documented
    // posture (objectui#6443 / #6487) and NOT this card's to flip: the field is
    // on screen and the console says why. Asserted so the behaviour is a stated
    // outcome rather than an accident nobody wrote down.
    expect(fields).toContain('wrong_layer');
    expect(fields).toContain('app_gated');
  });
});
