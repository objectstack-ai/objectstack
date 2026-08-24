// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { RenewalsPipelinePage } from '../src/ui/pages/index.js';

/**
 * The two `useAdapter()` contracts a hand-rolled rollup owns, pinned against the
 * react pages this app ships.
 *
 * Both are DROP-SHAPED — nothing throws, nothing warns, and the page renders a
 * plausible number either way, which is why neither `os validate` nor
 * `tsc` nor a smoke test catches them:
 *
 *  1. `QueryParams` (objectui `packages/types/src/data.ts`) declares ONLY
 *     `$`-prefixed keys, and `ObjectStackAdapter.convertQueryParams` (objectui
 *     `packages/data-objectstack/src/index.ts`) builds its outgoing options by
 *     copying exactly those. A bare `top:` / `limit:` reaches no branch and is
 *     dropped. It does not fall back to a default page: the GET list route has
 *     no default page size (`packages/client/src/index.ts`, and pinned in
 *     `packages/client/src/client.test.ts`), so an absent `top` returns the
 *     ENTIRE match set — the cap the author wrote simply never happens.
 *  2. `find()` resolves to a normalized `QueryResult` — rows under `data`,
 *     never the REST envelope's `records`, plus `total`. Reading `.records`
 *     yields `undefined` on every call, so a KPI over it sticks at 0 forever
 *     while the `<ListView>` beside it shows the same rows correctly.
 *
 * `total` is the third half of the same contract: with a `$top` applied the
 * server runs a real count over the same filter
 * (`ObjectStackProtocolImplementation.findData`), so a KPI that counts
 * `data.length` under a cap under-reports silently. Fixing (1) without reading
 * `total` therefore CREATES the capped-count defect it was meant to remove.
 */

// ---------------------------------------------------------------------------
// A contract-faithful `ObjectStackAdapter` double
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/**
 * Mirrors the three behaviours above, and nothing else. Deliberately literal:
 * it reads ONLY `$`-prefixed keys (so an unprefixed one is dropped exactly as
 * the real adapter drops it) and returns the `QueryResult` shape.
 */
function makeAdapterDouble(store: Record<string, Row[]>) {
  const seen: Array<{ resource: string; params: Record<string, unknown> }> = [];

  const matches = (row: Row, filter: unknown): boolean => {
    if (!Array.isArray(filter)) return true;
    const [field, op, value] = filter as [string, string, unknown];
    if (op !== '=') throw new Error(`double does not implement operator '${op}'`);
    return row[field] === value;
  };

  return {
    seen,
    find(resource: string, params: Record<string, unknown> = {}) {
      seen.push({ resource, params });
      const all = (store[resource] ?? []).filter((r) => matches(r, params.$filter));
      // ONLY the `$` spelling is read — this is the drop under test.
      const limit = typeof params.$top === 'number' ? params.$top : undefined;
      const data = limit === undefined ? all : all.slice(0, limit);
      // No limit → the whole match set came back, so its length IS the total.
      // With a limit → the server counts over the same filter.
      const total = limit === undefined ? data.length : all.length;
      return Promise.resolve({
        data,
        total,
        page: 1,
        pageSize: limit,
        hasMore: data.length < total,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Running the page's REAL rollup effect
// ---------------------------------------------------------------------------

/** Slice the balanced `(...)` that starts at `from` (which must be `(`). */
function balancedCall(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  throw new Error('unbalanced call expression');
}

/** Lift the `React.useEffect(...)` rollup out of the page source, verbatim. */
function extractRollupEffect(source: string): string {
  const anchor = 'React.useEffect(';
  const at = source.indexOf(anchor);
  if (at < 0) throw new Error('no React.useEffect in page source');
  return `React.useEffect${balancedCall(source, at + anchor.length - 1)};`;
}

interface Rollup {
  projects: number;
  invoices: number;
  openInvoices: number;
  capped?: boolean;
}

/** Execute the extracted effect with a stub React and the adapter double. */
async function runRollup(
  effectSource: string,
  adapter: ReturnType<typeof makeAdapterDouble>,
  sel: string | null,
): Promise<Rollup> {
  let settle!: (v: Rollup) => void;
  const done = new Promise<Rollup>((res) => { settle = res; });
  const React = { useEffect: (cb: () => unknown) => { cb(); } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const run = new Function('React', 'adapter', 'sel', 'reload', 'setRelated', effectSource) as (
    React: unknown, adapter: unknown, sel: unknown, reload: unknown, setRelated: (v: Rollup) => void,
  ) => void;
  run(React, adapter, sel, 0, settle);
  return done;
}

// ---------------------------------------------------------------------------

describe('renewals-pipeline hand-rolled rollup — the adapter contract, executed', () => {
  const effect = extractRollupEffect(RenewalsPipelinePage.source as string);

  it('lifted the real effect out of the page source (extraction control)', () => {
    // Guards the harness itself: if the anchor ever stops matching, every
    // assertion below would pass over an empty string.
    expect(effect).toContain("adapter.find('showcase_project'");
    expect(effect).toContain("adapter.find('showcase_invoice'");
    expect(effect).toContain('setRelated');
  });

  /** 640 projects and 640 invoices on one account — more than the page's cap. */
  function bigAccount() {
    const projects: Row[] = [];
    const invoices: Row[] = [];
    for (let i = 0; i < 640; i++) {
      projects.push({ id: `p${i}`, account: 'acc_1' });
      // 128 of the 640 invoices are open (every 5th).
      invoices.push({ id: `i${i}`, account: 'acc_1', status: i % 5 === 0 ? 'open' : 'paid' });
    }
    // A second account that must never be counted into the first one's KPIs.
    projects.push({ id: 'p_other', account: 'acc_2' });
    invoices.push({ id: 'i_other', account: 'acc_2', status: 'open' });
    return { showcase_project: projects, showcase_invoice: invoices };
  }

  it('applies a real cap — the $top the author wrote reaches the adapter', async () => {
    const adapter = makeAdapterDouble(bigAccount());
    await runRollup(effect, adapter, 'acc_1');

    expect(adapter.seen).toHaveLength(2);
    for (const call of adapter.seen) {
      // The defect: an unprefixed key is silently ignored, so the read runs
      // unbounded. Every key the page sends must be one the adapter reads.
      expect(Object.keys(call.params).every((k) => k.startsWith('$'))).toBe(true);
      expect(call.params.$top).toBe(500);
    }
  });

  it('reports the account\'s true totals, not the page length under the cap', async () => {
    const adapter = makeAdapterDouble(bigAccount());
    const rollup = await runRollup(effect, adapter, 'acc_1');

    // 640, not 500 (the cap) and not 0 (the `.records` read) and not 641
    // (the other account's row leaking past `$filter`).
    expect(rollup.projects).toBe(640);
    expect(rollup.invoices).toBe(640);
    // Open AR is a per-row verdict over the fetched window, so it IS bounded by
    // the cap — 100 of the first 500, not the 128 that exist. The page must say
    // so rather than presenting it as a total.
    expect(rollup.openInvoices).toBe(100);
    expect(rollup.capped).toBe(true);
  });

  it('is exact, and not capped, for an account inside the window', async () => {
    const store = {
      showcase_project: [
        { id: 'p1', account: 'acc_1' },
        { id: 'p2', account: 'acc_1' },
        { id: 'p3', account: 'acc_2' },
      ],
      showcase_invoice: [
        { id: 'i1', account: 'acc_1', status: 'open' },
        { id: 'i2', account: 'acc_1', status: 'paid' },
        { id: 'i3', account: 'acc_1', status: 'void' },
      ],
    };
    const rollup = await runRollup(effect, makeAdapterDouble(store), 'acc_1');
    expect(rollup).toMatchObject({ projects: 2, invoices: 3, openInvoices: 1, capped: false });
  });

  it('zeroes the strip when no account is selected', async () => {
    const rollup = await runRollup(effect, makeAdapterDouble({}), null);
    expect(rollup).toMatchObject({ projects: 0, invoices: 0, openInvoices: 0 });
  });
});

// ---------------------------------------------------------------------------
// The static sweep of the same two contracts MOVED OUT of this file (#10751)
// ---------------------------------------------------------------------------
//
// `recordsOnlyReads()` and `unprefixedQueryKeys()` now live in
// `scripts/check-react-page-adapter-contract.mjs` (`pnpm check:react-page-adapter-contract`),
// which sweeps this app's page modules AND the react-page samples in
// `content/docs` — the copy a customer starts from, and the population gap
// that let the same `.records` read survive a third time after the two fixes
// this file's harness was written for.
//
// They moved rather than being copied. Two definitions of the same detector
// double the places a future fix has to land, which IS the defect (#10751):
// one wrong read, repaired three separate times. The scanners' positive
// control moved with them, into that gate's `--self-test`.
//
// What stays here is the half a text scan cannot do: the block above EXECUTES
// the real rollup effect against a contract-faithful adapter double, so it
// judges the numbers a page produces rather than the shape of its source.
