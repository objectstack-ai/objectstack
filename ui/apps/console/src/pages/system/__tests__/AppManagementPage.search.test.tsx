// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4343 — the Applications page's SEARCH filter reads the same fields
 * the rows render, and must read them the same way.
 *
 * Filed out of #4307 (PR #4344), which keyed this page's chrome and introduced
 * the `appTitle` helper the rows name an app by. The filter one screen above it
 * was left on a raw read:
 *
 *     (app.label || '').toLowerCase().includes(q)
 *
 * `label` and `description` are `I18nLabel` in `AppSchema` — `string |
 * Record<string, string>` in `@objectstack/spec` 17.0.0-rc.6 — so a non-string
 * label is spec-legal metadata. An object is TRUTHY, so `|| ''` never fired for
 * one and `.toLowerCase()` got the object:
 *
 *     TypeError: (l || "").toLowerCase is not a function
 *
 * thrown inside `filter` during render, which takes the page out instead of
 * degrading search — and only once someone types, because `if (!searchQuery)
 * return true` short-circuits the empty case.
 *
 * ## What these cases pin, and why the mock answers in a real language
 *
 * The sister i18n file mocks `t` to answer in no natural language at all, which
 * is right for proving the chrome asks the pack. It cannot ask THIS file's
 * question, though: search is judged by what an operator can SEE, so the pack
 * here answers with real words that deliberately share no substring with the
 * call site's own `defaultValue` (`app.crm.label` -> `Vertrieb`, never `CRM`).
 * That makes every keyed case two-sided — the resolved text matches, and the
 * authoring `defaultValue` does NOT — which is what pins the `t` argument
 * rather than merely pinning that some resolver was called.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Restoring the two raw reads turns the keyed and map cases RED **by the
 * TypeError above**, thrown on the first keystroke, and leaves the plain-string
 * control GREEN — that asymmetry is the whole claim, and it is why the control
 * case is here at all. It is also why `toThrow`-style coverage would be
 * worthless: the defect is not "something throws", it is that one truthy shape
 * reaches a string method.
 *
 * ⚠️ The prediction was wrong the first time, and the reason is worth keeping.
 * Four cases were expected red; three came back red. The filter is a chain of
 * `||`, so **a query the NAME already satisfies short-circuits before the label
 * is read** — the map case searched `mapped` against `mapped_app` and passed on
 * the UNFIXED page, having never reached the throwing term. Every red-first
 * case in this file therefore hands the filter a query no earlier term can
 * answer (`vertr`, `crm`, `kunden` against `sales_app`; `zzz` against
 * everything). A case that matches on the name is testing the name.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { refresh, apps } = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  apps: { value: [] as any[] },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: apps.value, refresh }),
  useAdapter: () => ({ getClient: () => ({ meta: { saveItem: vi.fn(), deleteItem: vi.fn() } }) }),
}));

/**
 * A pack that answers these two keys in another language, and echoes the call
 * site's `defaultValue` for everything else.
 *
 * The echo keeps the page's own chrome in English so the search box is still
 * addressable by its testid and the rows still read naturally; the two real
 * answers are what make "matched the pack, not the `defaultValue`" a
 * distinguishable outcome. Neither answer contains `crm` — the substring the
 * authoring `defaultValue` would have offered.
 */
const PACK: Record<string, string> = {
  'app.crm.label': 'Vertrieb',
  'app.crm.description': 'Kundenverwaltung',
};

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  // Partial, via `importOriginal`: `@object-ui/components` builds its own
  // `createSafeTranslation` probes at module scope.
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      // i18next returns the empty string for a null/undefined key
      // (`translate()`: `if (keys == null) return '';`, i18next 26.3.6). That
      // is not a detail worth inventing a behaviour for — it is exactly the
      // call `resolveKeyedI18nLabel` makes when handed an object with no `key`,
      // which is the INLINE LOCALE MAP case below. Reproducing it is what lets
      // that case describe the real page instead of this mock.
      if (key == null) return '';
      return (
        PACK[key] ??
        String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
          String(options?.[name] ?? ''),
        )
      );
    },
  }),
}));

const { AppManagementPage } = await import('../AppManagementPage');

/**
 * Plain-string labels — the shape every first-party app ships today (`crm`,
 * `showcase`, `todo`, `setup`, `account`, `studio` are all strings). `WEB`'s
 * label and description are deliberately unreachable from its `name`, so the
 * control below can exercise the two terms this card changed in isolation.
 */
const OPS = { name: 'ops_app', label: 'Ops', description: 'Billing and invoices', active: true };
const WEB = { name: 'web_app', label: 'Marketing Site', description: 'Public brochure', active: true };

/**
 * objectui's KEYED form. `name` deliberately carries no `crm`, so a match on
 * the authoring `defaultValue` cannot be smuggled in through the name term.
 */
const KEYED = {
  name: 'sales_app',
  label: { key: 'app.crm.label', defaultValue: 'CRM' },
  active: true,
};

/**
 * The spec's INLINE LOCALE MAP form — `string | Record<string, string>` is what
 * `AppSchema.label` accepts today, so this object is what a partner authoring
 * `defineApp` can put on the wire with a green parse. It is the shape that
 * makes this bug reachable rather than hypothetical.
 */
const MAPPED = {
  name: 'mapped_app',
  label: { en: 'Storefront', 'zh-CN': '店面' },
  active: true,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <AppManagementPage />
    </MemoryRouter>,
  );
}

/** Type into the search box — the keystroke the page used to die on. */
async function search(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByTestId('app-search-input'), text);
}

beforeEach(() => {
  vi.clearAllMocks();
  apps.value = [];
});

describe('a non-string label survives the first keystroke', () => {
  it('filters a KEYED label on the text the pack returned', async () => {
    apps.value = [KEYED, OPS];
    renderPage();

    // Before this card: `TypeError: (l || "").toLowerCase is not a function`,
    // thrown out of `filter` during the re-render this keystroke causes.
    await search('vertr');

    expect(screen.getByTestId('app-card-sales_app')).toBeInTheDocument();
    expect(screen.queryByTestId('app-card-ops_app')).toBeNull();
  });

  it('matches the RESOLVED label, not the authoring `defaultValue`', async () => {
    // The other side of the same claim: `t` must actually be handed to the
    // resolver. Drop the second argument and the label resolves to its
    // authoring `CRM` instead of the pack's `Vertrieb`, which is a string —
    // so the page would NOT crash, and only this case would notice.
    apps.value = [KEYED, OPS];
    renderPage();

    await search('crm');

    expect(screen.queryByTestId('app-card-sales_app')).toBeNull();
    expect(screen.queryByTestId('app-card-ops_app')).toBeNull();
    expect(screen.getByTestId('no-apps-message')).toBeInTheDocument();
  });

  it('filters a KEYED description the same way — the line below the defect', async () => {
    apps.value = [
      { name: 'sales_app', label: 'Sales', description: { key: 'app.crm.description' }, active: true },
      OPS,
    ];
    renderPage();

    await search('kunden');

    expect(screen.getByTestId('app-card-sales_app')).toBeInTheDocument();
    expect(screen.queryByTestId('app-card-ops_app')).toBeNull();
  });

  it('survives the spec-legal INLINE LOCALE MAP form on a query that MISSES', async () => {
    apps.value = [MAPPED, OPS];
    const { unmount } = renderPage();

    // The row heading falls back to the app's `name`, because
    // `resolveKeyedI18nLabel` speaks the keyed form and not the map form
    // (objectui#4163 is the audit that widens it). That limitation belongs to
    // the DISPLAY path; what this case pins is that search now shares it
    // exactly instead of crashing on the same input.
    expect(screen.getByText('mapped_app')).toBeInTheDocument();

    // ⚠️ The query must MISS every app, and that is load-bearing rather than
    // incidental: the filter is a chain of `||`, so a query the NAME satisfies
    // short-circuits before the label is ever read. Searching `mapped` here
    // passes even on the unfixed page — `'mapped_app'.includes('mapped')` is
    // true and the throwing term never runs. A red-first case for this filter
    // has to hand it a query no earlier term can answer.
    await search('zzz');

    expect(screen.getByTestId('no-apps-message')).toBeInTheDocument();
    unmount();

    // …and the parity half, on a query that DOES hit: what the heading shows
    // is what the filter matches. When #4163 teaches the resolver the map
    // form, both halves move together instead of drifting apart again.
    renderPage();
    await search('mapped');
    expect(screen.getByTestId('app-card-mapped_app')).toBeInTheDocument();
    expect(screen.queryByTestId('app-card-ops_app')).toBeNull();
  });

  it('loads every app fine with an EMPTY query — which is why this hid until a keystroke', () => {
    // Green before this card too, and deliberately so: `if (!searchQuery)
    // return true` returns before either read, so the page mounted perfectly
    // with the very metadata that killed it one character later. Pinning the
    // short-circuit keeps that asymmetry from being "fixed" away.
    apps.value = [OPS, KEYED, MAPPED];
    renderPage();

    expect(screen.getByTestId('app-card-ops_app')).toBeInTheDocument();
    expect(screen.getByTestId('app-card-sales_app')).toBeInTheDocument();
    expect(screen.getByTestId('app-card-mapped_app')).toBeInTheDocument();
  });
});

describe('plain-string labels filter exactly as before', () => {
  // The control, and it holds NO non-string label on purpose: one keyed app
  // anywhere in `apps` would take the whole filter down pre-change and this
  // describe would go red with the others, which is exactly the asymmetry it
  // exists to demonstrate. Every case here is GREEN before and after.
  it('still matches on name, on label alone, and on description alone', async () => {
    apps.value = [OPS, WEB];

    const { unmount } = renderPage();
    await search('ops');
    expect(screen.getByTestId('app-card-ops_app')).toBeInTheDocument();
    expect(screen.queryByTestId('app-card-web_app')).toBeNull();
    unmount();

    // The LABEL term on its own — `Marketing Site` is reachable from neither
    // `web_app` nor `Public brochure`, so this is the line the card rewrote.
    const second = renderPage();
    await search('marketing');
    expect(screen.getByTestId('app-card-web_app')).toBeInTheDocument();
    expect(screen.queryByTestId('app-card-ops_app')).toBeNull();
    second.unmount();

    // The DESCRIPTION term on its own — the other rewritten line.
    const third = renderPage();
    await search('invoic');
    expect(screen.getByTestId('app-card-ops_app')).toBeInTheDocument();
    expect(screen.queryByTestId('app-card-web_app')).toBeNull();
    third.unmount();

    renderPage();
    await search('zzz');
    expect(screen.getByTestId('no-apps-message')).toBeInTheDocument();
  });

  it('is case-insensitive, as it always was', async () => {
    apps.value = [OPS, WEB];
    renderPage();

    await search('MARKETING');

    expect(screen.getByTestId('app-card-web_app')).toBeInTheDocument();
    expect(screen.queryByTestId('app-card-ops_app')).toBeNull();
  });
});
