// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A pick made the instant the options appear is never overwritten by
 * auto-select-first (objectstack#6979).
 *
 * A context selector is a *mandatory* scope, so `SelectorControl` auto-selects
 * `options[0]` as soon as the option list resolves and nothing concrete is
 * selected. That repair used to run in a passive effect — i.e. in a task AFTER
 * the commit that rendered the options — which left a gap with a rendered,
 * clickable dropdown in it and no selection yet. A pick delivered inside that
 * gap was applied and then immediately navigated away again, because the
 * queued auto-select fired second with a closure captured before the pick
 * (`hasConcrete` still `false`, and the search string it wrote from still the
 * pre-pick one). The user's choice silently became `options[0]`.
 *
 * The gap is not a test artefact: a click on a loaded machine or a slow device
 * lands in whatever task the event loop gives it, and nothing a test does can
 * make a real user wait for React's passive effects. What the tests below add is
 * the ability to *aim* at the gap deterministically, so the regression is pinned
 * by a red assertion instead of by CI's luck.
 *
 * ## Why the raw MutationObserver instead of `waitFor`
 *
 * RTL's async wrapper drains a macrotask after the callback first succeeds, so
 * `await waitFor(optionRowsExist)` usually returns on the far side of the gap —
 * which is exactly why this bug read as flaky rather than broken, and why the
 * sibling `ContextSelectors.persist.test.tsx` cases can settle-then-click and be
 * stable. {@link atOptionsCommit} stops at the commit that adds the option rows,
 * with the post-commit work still outstanding, so the click below lands inside
 * the gap on every machine.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Turning `SelectorControl`'s auto-select back into `React.useEffect` turns both
 * medium cases red *immediately* — not by timeout: the clobber happens inside
 * the click's own `act`, so the control comes back from `fireEvent.click`
 * already showing `billing`, and the synchronous assertion right after the click
 * is the one that fires. (Measured: `expected 'billing' to be 'crm_core'`, the
 * same message as the two CI runs in objectstack#6979.) The third case is the
 * opposite direction — it stays green across that revert, because it pins the
 * behaviour the fix must NOT change: it is the guard against "fix the race by
 * latching auto-select off after the first pick", which would leave the scope
 * blank the next time a nav link drops the param (objectstack#5994 deleted the
 * storage → URL bridge on the strength of that re-selection).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

// Radix's Select is not driveable in happy-dom (pointer capture), and the
// choreography is not what is under test — the ORDER of two writes is. Swap the
// primitives for a flat list of buttons calling `onValueChange`; the outer
// `data-current` is the rendered value, which is how the clobber is observed
// synchronously (no `waitFor` to smear the timing being asserted).
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const R = await import('react');
  const PickCtx = R.createContext<(value: string) => void>(() => {});
  return {
    ...actual,
    getLazyIcon: () => () => null,
    Select: ({ value, onValueChange, children }: any) => (
      <PickCtx.Provider value={onValueChange}>
        <div data-current={value ?? ''}>{children}</div>
      </PickCtx.Provider>
    ),
    SelectTrigger: ({ children, 'aria-label': label }: any) => (
      <div role="combobox" aria-label={label}>{children}</div>
    ),
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ value, children }: any) => {
      const pick = R.useContext(PickCtx);
      return (
        <button type="button" data-testid={`opt-${value}`} onClick={() => pick(value)}>
          {children}
        </button>
      );
    },
    SelectValue: () => null,
  };
});

import { useAppContextSelectors, type ContextSelectorDef } from '../ContextSelectors';

const PACKAGES_ENDPOINT = '/api/v1/packages';

/** Labels sort so `options[0]` is `billing` — the value a clobber lands on. */
const ROWS = [
  { id: 'billing', name: 'Billing' },
  { id: 'crm_core', name: 'CRM Core' },
];

const STORAGE_KEY = 'objectui-ctx-studio-active_package';
/** Studio's `active_package` is grandfathered onto `?package=` (objectui#3500). */
const URL_KEY = 'package';

/** Module-level so effects key off a stable ref. */
const QUERY_SEL: ContextSelectorDef[] = [
  { id: 'active_package', label: 'Package', optionsSource: { endpoint: PACKAGES_ENDPOINT }, persist: 'query' },
];
const SESSION_SEL: ContextSelectorDef[] = [
  { id: 'active_package', label: 'Package', optionsSource: { endpoint: PACKAGES_ENDPOINT }, persist: 'session' },
];

let snapshot: { contextValues: Record<string, string>; search: string };

function Probe({ list }: { list: ContextSelectorDef[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { contextValues, element } = useAppContextSelectors('studio', list);
  // Published from an effect, not during render: the hook re-navigates from its
  // own effects, so only a committed render is a meaningful sample.
  React.useEffect(() => {
    snapshot = { contextValues, search: location.search };
  });
  return (
    <>
      {element}
      {/* A param-less nav link, the way Studio's own nav items drop the scope. */}
      <button type="button" data-testid="drop-scope" onClick={() => navigate('/apps/studio')}>
        drop
      </button>
    </>
  );
}

function mount(list: ContextSelectorDef[], url = '/apps/studio') {
  snapshot = { contextValues: {}, search: '' };
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Probe list={list} />
    </MemoryRouter>,
  );
}

/** The value the control is currently rendering, read straight off the DOM. */
function rendered() {
  return document.querySelector('[data-current]')?.getAttribute('data-current');
}

function query() {
  return new URLSearchParams(snapshot.search);
}

/**
 * Resolves on the commit that first renders the option rows, with React's
 * post-commit work still outstanding — the gap a real click can land in.
 *
 * A `MutationObserver` and not `waitFor`: the latter's wrapper drains a
 * macrotask once its callback succeeds, which hands the pending auto-select a
 * turn and closes the gap before the test can aim at it.
 */
function atOptionsCommit() {
  const seen = () => document.querySelector('[data-testid="opt-crm_core"]');
  return new Promise<void>((resolve) => {
    if (seen()) return resolve();
    const observer = new MutationObserver(() => {
      if (!seen()) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ROWS })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auto-select-first never overwrites a pick made in the same flush', () => {
  it('keeps a `query` pick that lands before the auto-select is done reacting', async () => {
    mount(QUERY_SEL);
    await atOptionsCommit();

    fireEvent.click(screen.getByTestId('opt-crm_core'));

    // Synchronous, deliberately: the clobber used to happen inside this click's
    // own `act`, so `billing` was already rendered by the time control returned.
    expect(rendered()).toBe('crm_core');
    await waitFor(() => expect(query().get(URL_KEY)).toBe('crm_core'));
    // And no late navigation follows it.
    expect(rendered()).toBe('crm_core');
  });

  it('keeps a `session` pick the same way — the gap is not URL-specific', async () => {
    // Auto-select goes through the same one-medium `setValue` as a pick, so the
    // race is the same race in storage. Pinning both media keeps a future fix
    // from closing it for the URL only.
    mount(SESSION_SEL);
    await atOptionsCommit();

    fireEvent.click(screen.getByTestId('opt-crm_core'));

    expect(rendered()).toBe('crm_core');
    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBe('crm_core'));
    expect(rendered()).toBe('crm_core');
    // `'session'` stays out of the address bar (objectstack#5994).
    expect(query().has(URL_KEY)).toBe(false);
  });

  it('still re-selects a first option when a nav link drops the scope param', async () => {
    mount(QUERY_SEL);
    await waitFor(() => expect(query().get(URL_KEY)).toBe('billing'));
    fireEvent.click(screen.getByTestId('opt-crm_core'));
    await waitFor(() => expect(query().get(URL_KEY)).toBe('crm_core'));

    fireEvent.click(screen.getByTestId('drop-scope'));

    // A mandatory scope is never left blank: the param-less URL is repaired back
    // to the first option. This is why the race must NOT be fixed by disabling
    // auto-select once the user has picked.
    await waitFor(() => expect(query().get(URL_KEY)).toBe('billing'));
    expect(snapshot.contextValues.active_package).toBe('billing');
  });
});
