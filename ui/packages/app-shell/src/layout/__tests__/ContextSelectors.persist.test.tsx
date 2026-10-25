// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `AppContextSelectorSchema.persist` gets all three of its values honoured
 * (objectstack#5994).
 *
 * The spec declares `persist: 'query' | 'session' | 'none'` (default `'query'`)
 * as "Persist selection via URL query, sessionStorage, or not at all" — one
 * medium per value. The shell used to write BOTH stores for every selector and
 * read them back as `URL ?? storage`, so:
 *
 *   - `'none'` persisted anyway (it only skipped the storage → URL re-apply);
 *   - `'session'` and `'query'` were behaviourally identical.
 *
 * Every case below therefore asserts BOTH stores, not just the one the value
 * names — "writes the URL" is only half the claim, "and leaves storage alone"
 * is the half that was broken. The read side is pinned the same way: a value's
 * medium is the ONLY place its pick is read back from.
 *
 * Reverse verification (direction predicted before running): restoring either
 * deleted limb — the unconditional `sessionStorage.setItem` in `setValue`, or
 * the `URL ?? storage` read — turns the `'query'` storage assertions and the
 * `'session'` URL assertions red. It does NOT turn the `'none'` case red on its
 * own, because `'none'`'s in-memory value is produced by new state rather than
 * by a surviving store; that case is red only against the pre-change file as a
 * whole, which is why it asserts the published template var too and not merely
 * two empty stores (an all-empty assertion would pass for a selector that
 * produced nothing at all).
 *
 * ## Settle before you click (objectstack#6979)
 *
 * Every case that mounts a param-less, storage-less URL gets a value it did not
 * ask for first: `SelectorControl` auto-selects `options[0]` (`billing`) as soon
 * as the option list resolves, because a context selector is a *mandatory*
 * scope. So `mount` → `optionsReady()` → `fireEvent.click(other option)` is two
 * writes racing, and `optionsReady` is not a barrier for the first of them —
 * it only waits for the option rows to be in the DOM, which happens one commit
 * BEFORE the auto-select is done reacting to them. On a loaded CI worker the
 * pick therefore landed first and the auto-select second, overwriting it
 * (`expected 'billing' to be 'crm_core'`, twice in CI).
 *
 * Hence the shape below: **wait for the auto-select to land in the selector's
 * own medium, then click.** It costs one `waitFor` and buys two things — the
 * case stops depending on machine load, and it now pins a fact none of these
 * cases pinned before: a user's pick OVERRIDES the auto-selected first option
 * (previously a case could have passed with the pick never applied at all, as
 * long as the auto-selected value happened to be the expected one).
 *
 * Only the param-less mounts need it, and they need it in the medium `persist`
 * names — the auto-select goes through the same one-medium `setValue` as a
 * pick, so it is the URL for `'query'`, `sessionStorage` for `'session'`, and
 * the published value alone for `'none'`. A case that mounts a URL param, or
 * seeds storage for a `'session'` selector, hands the control a concrete value
 * on its very first render: auto-select never fires there and there is nothing
 * to settle. The load-independent counterpart of this race — a pick delivered
 * inside the gap, which no amount of waiting in a test can prevent for a real
 * user — is pinned in `ContextSelectors.autoSelectRace.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

// Radix's Select is not driveable in happy-dom (pointer capture), and the
// choreography is not what is under test — which store the pick lands in is.
// Swap the primitives for a flat list of buttons calling `onValueChange`.
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

// Labels sort so `options[0]` is `billing` — deliberately DIFFERENT from the
// `crm_core` seeded into the stores below. A stored value that happened to equal
// the auto-selected first option would make "restored from storage" and "never
// read storage, auto-selected instead" indistinguishable.
const ROWS = [
  { id: 'billing', name: 'Billing' },
  { id: 'crm_core', name: 'CRM Core' },
];

const STORAGE_KEY = 'objectui-ctx-studio-active_package';
/** Studio's `active_package` is grandfathered onto `?package=` (objectui#3500). */
const URL_KEY = 'package';

/** One selector per `persist` value; module-level so effects key off a stable ref. */
function selectors(persist: ContextSelectorDef['persist']): ContextSelectorDef[] {
  return [{ id: 'active_package', label: 'Package', optionsSource: { endpoint: PACKAGES_ENDPOINT }, persist }];
}
const QUERY_SEL = selectors('query');
const SESSION_SEL = selectors('session');
const NONE_SEL = selectors('none');
/** `persist` omitted — the spec's `.default('query')` must apply. */
const DEFAULT_SEL: ContextSelectorDef[] = [
  { id: 'active_package', label: 'Package', optionsSource: { endpoint: PACKAGES_ENDPOINT } },
];

let snapshot: { contextValues: Record<string, string>; search: string };

function Probe({ list }: { list: ContextSelectorDef[] }) {
  const location = useLocation();
  const { contextValues, element } = useAppContextSelectors('studio', list);
  // Published from an effect, not during render: the hook re-navigates from its
  // own effects, so only a committed render is a meaningful sample.
  React.useEffect(() => {
    snapshot = { contextValues, search: location.search };
  });
  return <>{element}</>;
}

function mount(list: ContextSelectorDef[], url = '/apps/studio') {
  snapshot = { contextValues: {}, search: '' };
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Probe list={list} />
    </MemoryRouter>,
  );
}

/**
 * The option rows have resolved and rendered, once per declared selector — the
 * fixtures share one endpoint, so N selectors render N copies of each option.
 */
async function optionsReady(selectorCount = 1) {
  await waitFor(() => expect(screen.getAllByTestId('opt-crm_core')).toHaveLength(selectorCount));
}

function query() {
  return new URLSearchParams(snapshot.search);
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ROWS })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("persist: 'query' — the URL query string, and nothing else", () => {
  it('writes the pick to the URL and leaves sessionStorage untouched', async () => {
    mount(QUERY_SEL);
    await optionsReady();
    // Settle the auto-selected first option before picking, so this asserts a
    // pick that overrode `billing` — not a pick racing it (objectstack#6979).
    await waitFor(() => expect(query().get(URL_KEY)).toBe('billing'));

    fireEvent.click(screen.getByTestId('opt-crm_core'));

    await waitFor(() => expect(query().get(URL_KEY)).toBe('crm_core'));
    // The half that was broken: storage was written for EVERY selector, which
    // is what made `'query'` and `'session'` the same behaviour.
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(snapshot.contextValues.active_package).toBe('crm_core');
  });

  it('reads the pick back out of the URL', async () => {
    mount(QUERY_SEL, `/apps/studio?${URL_KEY}=crm_core`);
    await optionsReady();

    expect(snapshot.contextValues.active_package).toBe('crm_core');
  });

  it('ignores a stale storage entry instead of restoring it to the URL', async () => {
    // Left behind by a build that mirrored every selector into storage. The
    // deleted storage → URL bridge would have re-applied it as `?package=`;
    // under one-medium-per-value the URL is empty, so the selector
    // auto-selects the first option (`billing`, not the stored `crm_core`).
    sessionStorage.setItem(STORAGE_KEY, 'crm_core');

    mount(QUERY_SEL);
    await optionsReady();

    await waitFor(() => expect(query().get(URL_KEY)).toBe('billing'));
    expect(snapshot.contextValues.active_package).toBe('billing');
    // Not read AND not written: the stale entry is left exactly as it was.
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('crm_core');
  });

  it("applies the spec's `'query'` default when `persist` is omitted", async () => {
    mount(DEFAULT_SEL);
    await optionsReady();
    // Same settle-then-click as the first case: an omitted `persist` resolves to
    // `'query'`, so the auto-select lands in the URL here too.
    await waitFor(() => expect(query().get(URL_KEY)).toBe('billing'));

    fireEvent.click(screen.getByTestId('opt-crm_core'));

    await waitFor(() => expect(query().get(URL_KEY)).toBe('crm_core'));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("persist: 'session' — sessionStorage, and nothing else", () => {
  it('writes the pick to sessionStorage and never to the URL', async () => {
    mount(SESSION_SEL);
    await optionsReady();
    // The auto-select races the pick here too — it just races it in storage,
    // because auto-select and pick share one `setValue` and this selector's
    // medium is storage (objectstack#6979).
    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBe('billing'));

    fireEvent.click(screen.getByTestId('opt-crm_core'));

    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBe('crm_core'));
    // The point of `'session'`: the scope stays out of the address bar, so the
    // link is not a scoped link.
    expect(query().has(URL_KEY)).toBe(false);
    // …and it is still published as the nav template var.
    expect(snapshot.contextValues.active_package).toBe('crm_core');
  });

  it('restores the remembered pick from storage on mount', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'crm_core');

    mount(SESSION_SEL);
    await optionsReady();

    expect(snapshot.contextValues.active_package).toBe('crm_core');
    // Restored into the value, NOT into the query string.
    expect(query().has(URL_KEY)).toBe(false);
  });

  it('is not shadowed by a query parameter of the same key', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'crm_core');

    // A shared link carrying `?package=billing` must not override a selector
    // whose declared medium is storage — that read (`URL ?? storage`) is what
    // made the two values indistinguishable.
    mount(SESSION_SEL, `/apps/studio?${URL_KEY}=billing`);
    await optionsReady();

    expect(snapshot.contextValues.active_package).toBe('crm_core');
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('crm_core');
  });
});

describe("persist: 'none' — not persisted at all", () => {
  it('writes neither the URL nor sessionStorage, and still publishes the pick', async () => {
    mount(NONE_SEL);
    await optionsReady();
    // `'none'` has no store to settle in, so the published value IS the medium
    // to wait on before picking (objectstack#6979).
    await waitFor(() => expect(snapshot.contextValues.active_package).toBe('billing'));

    fireEvent.click(screen.getByTestId('opt-crm_core'));

    // The pick is live for this mount — asserting only the two empty stores
    // would also pass for a selector that produced nothing at all.
    await waitFor(() => expect(snapshot.contextValues.active_package).toBe('crm_core'));
    expect(query().has(URL_KEY)).toBe(false);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does not restore a previous session, and does not read the URL', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'crm_core');

    mount(NONE_SEL, `/apps/studio?${URL_KEY}=crm_core`);
    await optionsReady();

    // Neither store answers the read, so the selector starts from nothing and
    // auto-selects the first option.
    await waitFor(() => expect(snapshot.contextValues.active_package).toBe('billing'));
    // Both stores are left exactly as they were — `'none'` writes nowhere.
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('crm_core');
    expect(query().get(URL_KEY)).toBe('crm_core');
  });

  it('drops the pick when the shell remounts', async () => {
    const first = mount(NONE_SEL);
    await optionsReady();
    await waitFor(() => expect(snapshot.contextValues.active_package).toBe('billing'));
    fireEvent.click(screen.getByTestId('opt-crm_core'));
    await waitFor(() => expect(snapshot.contextValues.active_package).toBe('crm_core'));

    first.unmount();
    mount(NONE_SEL);
    await optionsReady();

    // In-memory only: a new mount has no medium to recover `crm_core` from.
    await waitFor(() => expect(snapshot.contextValues.active_package).toBe('billing'));
  });
});

describe('collision warning follows the URL medium', () => {
  it('does not warn when the id collision is on a non-`query` selector', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `active_package` is grandfathered onto `?package=`, so a selector literally
    // named `package` derives the same key — the one collision the legacy table
    // can still produce. With the second selector on storage, nothing mirrors
    // through the query string, so warning would be a false positive.
    mount([
      { id: 'active_package', label: 'Package', optionsSource: { endpoint: PACKAGES_ENDPOINT }, persist: 'query' },
      { id: 'package', label: 'Package (again)', optionsSource: { endpoint: PACKAGES_ENDPOINT }, persist: 'session' },
    ]);
    await optionsReady(2);

    // No settle needed even though both selectors auto-select: the warning is
    // emitted from the collision effect at mount and keyed off the declared
    // ids, so no value write — pick or auto-select — can add or remove it.
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('both map to the URL scope key'));
    warn.mockRestore();
  });
});
