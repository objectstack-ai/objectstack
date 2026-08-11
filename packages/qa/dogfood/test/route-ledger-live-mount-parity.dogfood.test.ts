// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ROUTE-LEDGER ↔ LIVE-MOUNT PARITY GATE (#7526)
//
// ## What this exists to catch, and why nothing else could
//
// Five route ledgers DECLARE the platform's HTTP surface, and every guard
// built on them (#3563 / #3587 / #3636 / #3642) reads the union of those
// declarations as its source of truth for "what is mounted". That is the
// assumption three defects in one build falsified:
//
//   * `GET /meta/objects/:name/state/:field` was IN `route-ledger.ts`, so the
//     SDK URL guard passed the method that calls it — and the route answered
//     Hono's `notFound`, byte-identical to an unmounted-path control.
//   * `GET /meta/:type/:name/published` fell into the compound-name route and
//     answered a stub identical before publish AND for a bogus name.
//   * `GET /meta/types` fell into the `/meta/:type` catch-all and answered
//     `{"type":"types","items":[]}`, shape-identical to `/meta/zzz_not_a_type`.
//
// The ledger is a DECLARATION; those guards read it as an OBSERVATION. So the
// whole audit chain was green on this class by construction and would have
// stayed green for every future instance. This gate supplies the missing
// observation: it boots a real server and reads the mount table off it.
//
// ## The two rules that make it honest
//
//  1. THE MOUNTED SIDE IS NEVER HAND-MAINTAINED. Patterns come from
//     `IHttpServer.getMountedRoutes()` — the adapter's record of what it was
//     actually asked to register, populated on the same call that reaches the
//     router. A second hand-written list of "what we mount" would drift
//     exactly the way the ledgers did, which is the defect, not the fix.
//
//  2. REGISTRATION IS NOT REACHABILITY. On a first-match router a literal
//     route registered after a catch-all sibling is mounted and unreachable —
//     that is defect #3 above, and being in the table would have "passed" it.
//     So every row is PROBED: a concrete path is built from the pattern and
//     `IHttpServer.resolveMountedRoute()` asks the live router which
//     registration would answer it. The row passes only when the router names
//     the row's own pattern back.
//
// ## What a boot can and cannot observe (read before adding a pin)
//
// The mount table records what went through the `IHttpServer` port. Two
// surfaces deliberately do not:
//
//   * `/api/v1/auth/*` — `plugin-auth` mounts one `rawApp.all()` catch-all on
//     Hono directly. It is not unaudited: `auth-route-ledger.conformance.test.ts`
//     checks all ~129 endpoints against better-auth's LIVE `auth.api` table,
//     which is already an observation of the real thing. AUTH_ROUTE_LEDGER is
//     therefore not one of this gate's inputs.
//   * `* /apps/**` — the ADR-0121 declarative-endpoint carve-out is a
//     `setFallbackHandler` seam, structurally not a route (that is the point of
//     it), so it can never appear in a mount table.
//
// Everything else absent from this boot is absent because a plugin was not
// registered, and that is pinned below with a reason — see
// {@link UNEXERCISED_BY_THIS_BOOT}.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';

import { ROUTE_LEDGER } from '../../../runtime/src/route-ledger';
import { REST_ROUTE_LEDGER } from '../../../rest/src/rest-route-ledger';
import { STORAGE_ROUTE_LEDGER } from '../../../services/service-storage/src/storage-route-ledger';
import { I18N_ROUTE_LEDGER } from '../../../services/service-i18n/src/i18n-route-ledger';
import { SETTINGS_ROUTE_LEDGER } from '../../../services/service-settings/src/settings-route-ledger';

/** One ledger row, normalized to a wire pattern this gate can probe. */
interface LedgerRow {
  /** Which ledger it came from — for the diff message. */
  ledger: string;
  /** `GET`, `POST`, … or `*` for a wildcard family row. */
  method: string;
  /** Full wire pattern, e.g. `/api/v1/meta/:type/:name/published`. */
  pattern: string;
  /** The row as written, for error messages. */
  raw: string;
  /** A broader mounted pattern this row is a declared specialization of. */
  servedBy?: string;
}

const DISPATCHER_PREFIX = '/api/v1';

function collectLedgerRows(): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const add = (ledger: string, route: string, prefix: string, servedBy?: string) => {
    const sp = route.indexOf(' ');
    const method = route.slice(0, sp);
    // A trailing `?` marks an OPTIONAL param in the dispatcher's own dialect
    // (`/ui/view/:object/:type?`); the serving mount spells the required form.
    const pattern = (prefix + route.slice(sp + 1)).replace(/\?$/, '');
    rows.push({ ledger, method, pattern, raw: route, ...(servedBy ? { servedBy } : {}) });
  };

  for (const r of ROUTE_LEDGER) {
    add('runtime/route-ledger.ts', r.route, r.absolute ? '' : DISPATCHER_PREFIX, r.servedBy);
  }
  for (const r of REST_ROUTE_LEDGER) add('rest/rest-route-ledger.ts', r.route, '');
  for (const r of STORAGE_ROUTE_LEDGER) add('service-storage/storage-route-ledger.ts', r.route, '');
  for (const r of I18N_ROUTE_LEDGER) add('service-i18n/i18n-route-ledger.ts', r.route, '');
  for (const r of SETTINGS_ROUTE_LEDGER) add('service-settings/settings-route-ledger.ts', r.route, '');
  return rows;
}

/**
 * Rows this boot structurally cannot observe, each with the reason.
 *
 * ⚠️ READ THIS BEFORE ADDING A LINE. A pin is NOT "this route is allowed to be
 * missing" — it is "this boot cannot see it", and the gate asserts BOTH
 * directions of that claim: a pinned row that turns out to be reachable fails
 * too, so the set can only shrink by accident and never grow by accident. The
 * moment a pin starts meaning "we know it is broken", it has become the
 * declaration-instead-of-observation this whole file exists to end. A route
 * that is broken gets fixed or gets an issue, not a line here.
 */
const UNEXERCISED_BY_THIS_BOOT: Record<string, string> = {
  '* /api/v1/auth/**':
    'plugin-auth mounts one rawApp.all() catch-all on Hono directly, so no auth route ever passes through the IHttpServer port. Audited against better-auth\'s live auth.api table by auth-route-ledger.conformance.test.ts instead',
  '* /api/v1/apps/**':
    'the ADR-0121 declarative-endpoint carve-out is a setFallbackHandler seam, not a route — being invisible to a route table is the property that makes it incapable of shadowing one (#5040 §1-C)',
  'POST /api/v1/packages/publish':
    'the marketplace publish registrar mounts only when a `package` service occupies the slot (direct-mount-composition.ts); the showcase registers none. Its presence half is already guarded by rest-route-ledger.conformance.test.ts against a capably-mocked RestServer',
};

/** Segments a probe path uses for `:params` — must match no literal segment. */
function probePath(pattern: string): string {
  let i = 0;
  return pattern
    .split('/')
    .map((seg) => (seg.startsWith(':') ? `__parity_probe_${i++}` : seg))
    .join('/');
}

/** `* /api/v1/ai/**` → `/api/v1/ai`. */
function wildcardPrefix(pattern: string): string {
  return pattern.replace(/\/\*+$/, '');
}

const isWildcardRow = (row: LedgerRow) => row.pattern.includes('*');

interface Mounted { method: string; pattern: string }

describe('route ledger ↔ live mount parity (#7526)', () => {
  let stack: VerifyStack;
  let server: {
    getMountedRoutes?(): ReadonlyArray<Mounted>;
    resolveMountedRoute?(method: string, path: string): Mounted | undefined;
  };
  let mounted: ReadonlyArray<Mounted>;
  let ledgerRows: LedgerRow[];

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {
      // Boot as WIDE as this gate can, so as few rows as possible have to be
      // pinned: every plugin added here converts a pin into a measurement.
      // `StorageServicePlugin` alone converts ten — the whole storage ledger,
      // which the lean default boot leaves entirely unobserved.
      //
      // NOT `automation: true`, and the reason is worth writing down: the
      // dispatcher bridge mounts `/automation/*` UNCONDITIONALLY (mounting is
      // this gate's whole subject; whether a service answers is not), while
      // `automation: true` makes the showcase's declared `rest` connector a
      // hard boot failure without the connector plugins. Turning it on would
      // buy zero routes and cost the gate its ability to boot.
      extraPlugins: [new StorageServicePlugin()],
    });
    server = await (stack.kernel as unknown as {
      getServiceAsync(n: string): Promise<typeof server>;
    }).getServiceAsync('http-server');
    ledgerRows = collectLedgerRows();

    // FAIL, never skip. A parity gate that quietly passes because it could not
    // look is the exact failure mode it was built to end.
    expect(
      typeof server.getMountedRoutes,
      'the booted http-server exposes no getMountedRoutes() — this gate cannot observe anything and must not pass',
    ).toBe('function');
    expect(
      typeof server.resolveMountedRoute,
      'the booted http-server exposes no resolveMountedRoute() — reachability is unprobeable and mounted-but-shadowed routes would pass',
    ).toBe('function');

    mounted = server.getMountedRoutes!();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('observes a non-trivial mount table (a boot that mounted nothing would pass every other assertion)', () => {
    expect(mounted.length).toBeGreaterThan(100);
  });

  // ── Direction 1: every ledgered route is REACHABLY mounted ────────────────
  it('every ledgered route is reachably mounted', () => {
    const failures: string[] = [];

    for (const row of ledgerRows) {
      const pinKey = `${row.method} ${row.pattern}`;
      if (pinKey in UNEXERCISED_BY_THIS_BOOT) continue;

      if (isWildcardRow(row)) {
        // A `**` row claims a PREFIX FAMILY, not a resolvable route, so the
        // strongest honest check is that the prefix has at least one live
        // mount under it.
        const base = wildcardPrefix(row.pattern);
        const under = mounted.filter((m) => m.pattern === base || m.pattern.startsWith(`${base}/`));
        if (under.length === 0) {
          failures.push(`${row.ledger}: ${row.raw} — nothing is mounted under ${base}`);
        }
        continue;
      }

      const expected = row.servedBy ?? row.pattern;
      const resolved = server.resolveMountedRoute!(row.method, probePath(row.pattern));
      if (!resolved) {
        failures.push(
          `${row.ledger}: ${row.raw} — LEDGERED BUT NOT MOUNTED. `
          + `The live router answers nothing for ${row.method} ${probePath(row.pattern)}; `
          + 'this URL 404s at runtime while every ledger-reading guard passes it.',
        );
        continue;
      }
      if (resolved.pattern !== expected) {
        failures.push(
          `${row.ledger}: ${row.raw} — MOUNTED BUT UNREACHABLE. `
          + `${row.method} ${probePath(row.pattern)} is answered by \`${resolved.pattern}\`, not \`${expected}\`. `
          + 'A literal route registered AFTER a catch-all sibling is shadowed by it — '
          + 'register it before, or say which pattern serves it with `servedBy`.',
        );
      }
    }

    expect(failures, `\n${failures.join('\n')}\n`).toEqual([]);
  });

  // ── The pin is a claim about the BOOT, and it is checked too ──────────────
  it('every pinned row is genuinely unobservable — a stale pin fails', () => {
    const stale: string[] = [];

    for (const [key, reason] of Object.entries(UNEXERCISED_BY_THIS_BOOT)) {
      const sp = key.indexOf(' ');
      const method = key.slice(0, sp);
      const pattern = key.slice(sp + 1);
      const row = ledgerRows.find((r) => r.method === method && r.pattern === pattern);
      if (!row) {
        stale.push(`${key} — pinned, but no ledger row says this any more. Delete the pin.`);
        continue;
      }
      const observed = pattern.includes('*')
        ? mounted.some((m) => {
            const base = wildcardPrefix(pattern);
            return m.pattern === base || m.pattern.startsWith(`${base}/`);
          })
        : server.resolveMountedRoute!(method, probePath(pattern))?.pattern === pattern;
      if (observed) {
        stale.push(
          `${key} — pinned as unobservable ("${reason}"), but THIS BOOT mounts it reachably. `
          + 'Delete the pin: the gate can guard it for real now.',
        );
      }
    }

    expect(stale, `\n${stale.join('\n')}\n`).toEqual([]);
  });

  // ── Direction 2: every live mount is ledgered ─────────────────────────────
  it('every mounted route is ledgered', () => {
    const exact = new Set(ledgerRows.filter((r) => !isWildcardRow(r)).map((r) => `${r.method} ${r.pattern}`));
    const wildcardBases = ledgerRows.filter(isWildcardRow).map((r) => ({
      method: r.method,
      base: wildcardPrefix(r.pattern),
    }));

    const unledgered = mounted.filter((m) => {
      if (exact.has(`${m.method} ${m.pattern}`)) return false;
      return !wildcardBases.some(
        (w) => (w.method === '*' || w.method === m.method)
          && (m.pattern === w.base || m.pattern.startsWith(`${w.base}/`)),
      );
    });

    expect(
      unledgered.map((m) => `${m.method} ${m.pattern}`),
      '\nLive mounts no ledger claims — a route surface shipped with no reviewed SDK disposition, '
      + 'which is exactly the pre-#3563 posture. Give each one a ledger row (or delete the mount):\n'
      + `${unledgered.map((m) => `  ${m.method} ${m.pattern}`).join('\n')}\n`,
    ).toEqual([]);
  });

  // ── The reachability check is REAL, not decorative ────────────────────────
  //
  // Everything above passes if `resolveMountedRoute` merely re-implements "is
  // the pattern in the table". This pins the difference on the very family the
  // defect lived in: `/meta/types` and `/meta/:type` are BOTH mounted, and the
  // probe must be able to tell which one answers.
  it('distinguishes reachable from merely-registered on the /meta catch-all family', () => {
    const table = mounted.map((m) => `${m.method} ${m.pattern}`);
    expect(table).toContain('GET /api/v1/meta/types');
    expect(table).toContain('GET /api/v1/meta/:type');

    // Registration order decides, and the literal must be first.
    expect(server.resolveMountedRoute!('GET', '/api/v1/meta/types'))
      .toEqual({ method: 'GET', pattern: '/api/v1/meta/types' });
    // …while a genuinely unknown type still reaches the catch-all.
    expect(server.resolveMountedRoute!('GET', '/api/v1/meta/zzz_not_a_type'))
      .toEqual({ method: 'GET', pattern: '/api/v1/meta/:type' });
  });

  // The other two defects, pinned as live-router facts rather than as prose.
  it('the three #7526 routes resolve to themselves and not to a catch-all sibling', () => {
    expect(server.resolveMountedRoute!('GET', '/api/v1/meta/object/lead/published'))
      .toEqual({ method: 'GET', pattern: '/api/v1/meta/:type/:name/published' });
    expect(server.resolveMountedRoute!('GET', '/api/v1/meta/objects/showcase_task/state/status'))
      .toEqual({ method: 'GET', pattern: '/api/v1/meta/objects/:name/state/:field' });
  });
});
