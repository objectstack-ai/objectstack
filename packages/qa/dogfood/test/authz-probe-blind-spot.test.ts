// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The reach of `authz-conformance.test.ts`'s `discover()`, DERIVED from the
// route ledgers — never transcribed.
//
// ⛔ This is NOT a second authorization gate and it classifies nothing. The
// gate is `discover()`: a ledger family or dispatcher domain no matrix row
// covers is UNCLASSIFIED, a covered key nobody mints is STALE, and either is
// red there. What this file holds is the one property that verdict rests on:
// EVERY ledger row is reachable by a key the ledger probes can mint. A row the
// probes cannot read — its `family` / `domain` spelled through a constant, a
// spread, a template, or missing — would be a route `discover()` can never
// name, and that is the only shape that reds here.
//
// ⭐ Population and reach are both read from the ledgers themselves: the
// imported table is the population, the probe's own scoped text reading is
// the reach, and the test asserts they are the same set. No count is written
// down, so a route that arrives with a ledger row inside an existing family
// or domain moves nothing here — and a route that arrives with a NEW family
// or domain is `discover()`'s UNCLASSIFIED to classify, not this file's.
//
// ⛔ What this replaced, and why (ruling 6433001130 on the card, letter C):
// a hand-written census (`authz-probe-blind-spot.census.ts`, 1,691 lines)
// that pinned per-file registration-site counts, positive-control counts and
// two blind-spot totals, and that had to be re-measured by hand on every
// route added anywhere in `@objectstack/rest`. It went red on `main` after
// three green merges in ten days, every time for a count moving and never
// for an unclassified route. Its measured record — the three probe kinds, the
// `rest-server.ts` static vs runtime readings, and the 2026-08-31 decision to
// source the population from the ledgers — is kept in history at commit
// 67461403; the kinds now live as data on each `PROBES` entry.
//
// The route-level bound is unchanged and stated where the claim is made: a
// route added inside an existing family or domain mints no key of its own
// (`authz-conformance.matrix.ts` header). The ledgers' own conformance tests
// (`rest-route-ledger.conformance.test.ts`, `route-ledger.conformance.test.ts`)
// are what put every mounted route into a ledger row in the first place.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REST_ROUTE_LEDGER } from '../../../rest/src/rest-route-ledger.js';
import { ROUTE_LEDGER } from '../../../runtime/src/route-ledger.js';
import {
  REST_SERVER_REGISTRAR_DIR,
  REST_SERVER_REGISTRAR_FILES,
} from '../../../rest/src/rest-server-registrar-files.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/qa/dogfood/test → repo root.
const REPO_ROOT = join(HERE, '../../../..');

interface LedgerReach {
  /** Repo-relative ledger path, exactly as the `PROBES` table spells it. */
  file: string;
  /** The exported table the ledger probe scopes its read to (`within`). */
  within: string;
  /** The grouping field whose value the probe mints a key from. */
  field: 'family' | 'domain';
  /** The imported table — the population, as the ledger itself holds it. */
  rows: ReadonlyArray<{ route: string; family?: string; domain?: string }>;
}

const LEDGERS: readonly LedgerReach[] = [
  { file: 'packages/rest/src/rest-route-ledger.ts', within: 'REST_ROUTE_LEDGER', field: 'family', rows: REST_ROUTE_LEDGER },
  { file: 'packages/runtime/src/route-ledger.ts', within: 'ROUTE_LEDGER', field: 'domain', rows: ROUTE_LEDGER },
];

/**
 * The body of ONE exported array literal — `export const <within>` up to the
 * closing `\n];` — the scope the ledger probes in `authz-conformance.test.ts`
 * read. ⛔ An export that is not there reads EMPTY, never the whole file: a
 * silently wider scope would still produce plausible keys.
 */
function scopedSource(src: string, within: string): string {
  const from = src.indexOf(`export const ${within}`);
  if (from < 0) return '';
  const to = src.indexOf('\n];', from);
  return to < 0 ? '' : src.slice(from, to);
}

/** What the ledger probe reads: one `route:` and one grouping value per row, in order. */
function probeReading(ledger: LedgerReach): { routes: string[]; values: string[] } {
  const body = scopedSource(readFileSync(join(REPO_ROOT, ledger.file), 'utf8'), ledger.within);
  return {
    routes: [...body.matchAll(/route: '([^']+)'/g)].map((m) => m[1]!),
    values: [...body.matchAll(new RegExp(`${ledger.field}: '([^']+)'`, 'g'))].map((m) => m[1]!),
  };
}

describe('authz probe reach — derived from the route ledgers', () => {
  it.each(LEDGERS.map((l) => [l.file, l] as const))(
    '%s — CONTROL: the table imports and the scoped read sees it',
    (_file, ledger) => {
      // Non-vacuity, without a count: an empty import or an empty scope would
      // make every equality below hold over nothing.
      expect(ledger.rows.length, `${ledger.file} imported no rows`).toBeGreaterThan(0);
      expect(probeReading(ledger).routes.length, `${ledger.file}: the scoped read found no rows`).toBeGreaterThan(0);
    },
  );

  it.each(LEDGERS.map((l) => [l.file, l] as const))(
    '%s — every row carries a %s value the probe can mint a key from',
    (_file, ledger) => {
      const unreachable = ledger.rows
        .filter((r) => typeof r[ledger.field] !== 'string' || r[ledger.field] === '')
        .map((r) => r.route);
      expect(unreachable, `rows no ${ledger.field} key can name`).toEqual([]);
    },
  );

  it.each(LEDGERS.map((l) => [l.file, l] as const))(
    '%s — the probe reads EVERY row, and reads each one as the table holds it',
    (_file, ledger) => {
      // The population (the imported table) and the reach (the probe's text
      // reading) are compared row by row, in order. A row whose grouping value
      // is not a literal the probe pattern matches drops out of `values`, so
      // the two lists stop lining up and this names the first route it lost.
      const { routes, values } = probeReading(ledger);
      expect(routes).toEqual(ledger.rows.map((r) => r.route));
      expect(values).toEqual(ledger.rows.map((r) => r[ledger.field]));
    },
  );

  it('every TRIPWIRE file still holds its positive control — a zero there is a reading, not a moved file', () => {
    // A tripwire mints nothing by design, so its zero cannot tell "nothing
    // wired" from "the file this probe reads no longer holds the code". Each
    // file a TRIPWIRE reads names one term known present in THAT file, and the
    // term must be there. Presence only, never a count: an edit that leaves
    // the file's role intact moves nothing here.
    const tripwireFiles = new Set(
      [...probeTableBlock().matchAll(/kind: 'TRIPWIRE',\s*\n\s*file: '([^']+)'/g)].map((m) => m[1]!),
    );
    expect([...tripwireFiles].sort(), 'a TRIPWIRE file has no positive control below').toEqual(
      Object.keys(TRIPWIRE_CONTROLS).sort(),
    );
    const missing: string[] = [];
    for (const [file, control] of Object.entries(TRIPWIRE_CONTROLS)) {
      if (!control.test(readFileSync(join(REPO_ROOT, file), 'utf8'))) missing.push(`${file}: ${control}`);
    }
    expect(missing).toEqual([]);
  });

  it('every module on the RestServer registrar list still registers routes — the rest-server.ts tripwires read them all', () => {
    // The two `rest-server.ts` tripwires read every file on this list with it
    // (`alsoReads`). A module that stopped registering anything would leave
    // them reading a file that no longer holds registrar code.
    const empty = REST_SERVER_REGISTRAR_FILES.filter(
      (file) =>
        !/this\.routeManager\.register\(|registerPerItemRoute\(/.test(
          readFileSync(join(REPO_ROOT, REST_SERVER_REGISTRAR_DIR, file), 'utf8'),
        ),
    );
    expect(REST_SERVER_REGISTRAR_FILES.length).toBeGreaterThan(0);
    expect(empty, 'registrar-list modules with no registration site').toEqual([]);
  });

  it('the matrix header states the PROBES table it describes — both sides read, neither typed here', () => {
    const matrix = readFileSync(join(HERE, 'authz-conformance.matrix.ts'), 'utf8');
    const m = /`discover\(\)`: (\d+) probes over (\d+) named source files/.exec(matrix);
    expect(m, 'the matrix header no longer states a probe count in the pinned shape').not.toBeNull();
    const probes = probeTableFiles();
    expect(Number(m![1])).toBe(probes.length);
    expect(Number(m![2])).toBe(new Set(probes).size);
  });

  it('every PROBES entry declares its instrument kind, and all three kinds are still in use', () => {
    // Every entry spells `kind` immediately before `file`, so the two token
    // streams pair in document order. An entry missing its `kind` makes them
    // disagree, which is what this catches.
    const block = probeTableBlock();
    const tokens = [...block.matchAll(/^\s*(kind|file): '([^']+)'/gm)].map((t) => t[1]);
    expect(tokens, 'an entry is missing its `kind`, or spells it after its `file`').toEqual(
      probeTableFiles().flatMap(() => ['kind', 'file']),
    );
    const kinds = new Set([...block.matchAll(/^\s*kind: '([^']+)'/gm)].map((t) => t[1]));
    // A table that had lost one instrument would make that instrument's
    // integrity checks in `authz-conformance.test.ts` vacuous.
    expect([...kinds].sort()).toEqual(['GATE_PIN', 'ROUTE_ENUMERATION', 'TRIPWIRE']);
  });
});

/**
 * One in-file positive control per file a TRIPWIRE probe names: a term known
 * present in THAT file (never borrowed from another), so the tripwire's zero
 * is a reading of the file and not of its absence.
 */
const TRIPWIRE_CONTROLS: Readonly<Record<string, RegExp>> = {
  'packages/plugins/plugin-hono-server/src/hono-plugin.ts': /rawApp\./,
  'packages/services/service-realtime/src/in-memory-realtime-adapter.ts': /subscriptions/,
  'packages/services/service-realtime/src/realtime-service-plugin.ts': /RealtimeService/,
  'packages/runtime/src/http-dispatcher.ts': /HttpDispatcherResult/,
  'packages/client/src/realtime-api.ts': /subscriptions/,
  'packages/rest/src/rest-server.ts': /this\.routeManager\.register\(/,
};

/** The `PROBES` array literal in the companion test's own source. */
function probeTableBlock(): string {
  const src = readFileSync(join(HERE, 'authz-conformance.test.ts'), 'utf8');
  const from = src.indexOf('const PROBES');
  const to = from < 0 ? -1 : src.indexOf('\n];', from);
  return from < 0 || to < 0 ? '' : src.slice(from, to);
}

/** One entry per `PROBES` entry: the file it names. */
function probeTableFiles(): string[] {
  return [...probeTableBlock().matchAll(/^\s*file: '([^']+)'/gm)].map((m) => m[1]!);
}
