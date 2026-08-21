// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import * as pages from '../src/ui/pages/index.js';
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
// The same two contracts, swept across every react page this app ships
// ---------------------------------------------------------------------------

const DECLARED_QUERY_PARAM_PREFIX = '$';

/** Top-level keys of an object-literal source slice. */
function topLevelKeys(objSrc: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let i = 0;
  let expectKey = true;
  while (i < objSrc.length) {
    const c = objSrc[i];
    if (c === '{' || c === '[' || c === '(') { depth++; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; i++; continue; }
    if (depth === 1) {
      if (c === ',') { expectKey = true; i++; continue; }
      if (c === ':') { expectKey = false; i++; continue; }
      if (expectKey) {
        const m = /^(['"]?)([A-Za-z_$][\w$]*)\1\s*:/.exec(objSrc.slice(i));
        if (m) { keys.push(m[2]); i += m[0].length; expectKey = false; continue; }
      }
    }
    i++;
  }
  return keys;
}

interface QueryFinding { key: string; snippet: string }

/** Every unprefixed key handed to an `adapter.find`/`findOne` in one source. */
function unprefixedQueryKeys(source: string): QueryFinding[] {
  const found: QueryFinding[] = [];
  const call = /\b(?:adapter|dataSource)\s*\.\s*(?:find|findOne)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(source))) {
    // Walk to the params object literal, staying inside this call's parens.
    let i = m.index + m[0].length;
    let depth = 1;
    let objStart = -1;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
      else if (c === '{' && depth === 1) { objStart = i; break; }
      i++;
    }
    if (objStart < 0) continue;
    let braces = 0;
    let objEnd = -1;
    for (let j = objStart; j < source.length; j++) {
      if (source[j] === '{') braces++;
      else if (source[j] === '}') { braces--; if (braces === 0) { objEnd = j; break; } }
    }
    if (objEnd < 0) continue;
    const obj = source.slice(objStart, objEnd + 1);
    for (const k of topLevelKeys(obj)) {
      if (!k.startsWith(DECLARED_QUERY_PARAM_PREFIX)) {
        found.push({ key: k, snippet: obj.replace(/\s+/g, ' ').slice(0, 100) });
      }
    }
  }
  return found;
}

/**
 * A `.records` read with no `.data` beside it, off a find() result.
 *
 * Comment lines are skipped: a page that explains the trap in prose (and
 * `crm-workbench` does, right above the call it once got wrong) is documenting
 * the contract, not violating it. The read itself is what this looks for.
 */
function recordsOnlyReads(source: string): string[] {
  const out: string[] = [];
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (!trimmed.includes('.records')) continue;
    if (trimmed.includes('.data')) continue;
    out.push(trimmed);
  }
  return out;
}

const REACT_PAGES = Object.values(pages as Record<string, unknown>)
  .filter((p): p is { name: string; kind?: string; source?: string } =>
    !!p && typeof p === 'object' && (p as { kind?: string }).kind === 'react')
  .filter((p) => typeof p.source === 'string');

describe('every kind:"react" page in this app honours the useAdapter contracts', () => {
  it('found the react pages to sweep (census control)', () => {
    // A sweep over an empty list is vacuously green — this is what stops that.
    expect(REACT_PAGES.length).toBeGreaterThanOrEqual(2);
    expect(REACT_PAGES.map((p) => p.name)).toContain('showcase_renewals_pipeline');
  });

  it('the scanners fire on a known-bad source (positive control)', () => {
    const bad = `
      const a = await adapter.find('showcase_project', { $filter: ['account', '=', sel], top: 500 });
      const b = await adapter.find('showcase_invoice', { limit: 200 });
      // a comment mentioning .records must NOT count as a read
      const rows = (a && a.records) || [];
    `;
    expect(unprefixedQueryKeys(bad).map((f) => f.key)).toEqual(['top', 'limit']);
    expect(recordsOnlyReads(bad)).toEqual(['const rows = (a && a.records) || [];']);
  });

  it.each(REACT_PAGES.map((p) => [p.name, p.source as string] as const))(
    '%s passes only $-prefixed query options',
    (_name, source) => {
      expect(unprefixedQueryKeys(source)).toEqual([]);
    },
  );

  it.each(REACT_PAGES.map((p) => [p.name, p.source as string] as const))(
    '%s reads rows off QueryResult.data',
    (_name, source) => {
      expect(recordsOnlyReads(source)).toEqual([]);
    },
  );
});
