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

// `.js` on the relative source imports: without it `moduleResolution: nodenext`
// does not resolve them. These are compiled as relative SOURCE files (never as
// package entry points) because each ledger is package-internal — the guard's
// data, not public API — which is the same access the sibling ledger guards
// take.
import { ROUTE_LEDGER } from '../../../runtime/src/route-ledger.js';
import { REST_ROUTE_LEDGER } from '../../../rest/src/rest-route-ledger.js';
import { STORAGE_ROUTE_LEDGER } from '../../../services/service-storage/src/storage-route-ledger.js';
import { I18N_ROUTE_LEDGER } from '../../../services/service-i18n/src/i18n-route-ledger.js';
import { SETTINGS_ROUTE_LEDGER } from '../../../services/service-settings/src/settings-route-ledger.js';

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
 * missing" — it is "NOTHING answers this path on this boot", and the gate
 * asserts BOTH halves of that claim: a pinned row that turns out to be
 * reachable fails, and (since #7563) so does one whose path is answered by a
 * DIFFERENT pattern. So the set can only shrink by accident and never grow by
 * accident. The moment a pin starts meaning "we know it is broken", it has
 * become the declaration-instead-of-observation this whole file exists to end.
 * A route that is broken gets fixed or gets an issue, not a line here.
 *
 * ## What #7563 taught this list
 *
 * `POST /api/v1/packages/publish` used to be pinned here, reasoned as "the
 * registrar is service-gated and this boot composes no `package` service".
 * That reason was true and the conclusion was wrong: an unmounted route is not
 * automatically an UNANSWERED one. With nobody owning the path, the
 * dispatcher's `/packages/:id` matched it (`id = "publish"`) and the router
 * answered 405 with THAT route's `Allow` set — the "LEDGERED BUT NOT MOUNTED,
 * and DISGUISED" failure this gate spells out for every unpinned row, invisible
 * for the one class that had been excused from the check. A conditional mount
 * was therefore the one shape the gate could not model, so the pin's second
 * half below is now checked as strictly as the first. The route itself mounts
 * unconditionally as of #7563 and needs no pin at all.
 */
const UNEXERCISED_BY_THIS_BOOT: Record<string, string> = {
  '* /api/v1/auth/**':
    'plugin-auth mounts one rawApp.all() catch-all on Hono directly, so no auth route ever passes through the IHttpServer port. Audited against better-auth\'s live auth.api table by auth-route-ledger.conformance.test.ts instead',
  '* /api/v1/apps/**':
    'the ADR-0121 declarative-endpoint carve-out is a setFallbackHandler seam, not a route — being invisible to a route table is the property that makes it incapable of shadowing one (#5040 §1-C)',
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
        // Two different diseases with the same symptom, and naming which one
        // it is saves the reader the trip: either nobody registered the
        // pattern and a broader sibling is answering in its place, or someone
        // registered it too late and the sibling wins on order. The fix
        // differs (write the registration / move it up), so the message must.
        const registered = mounted.some((m) => m.method === row.method && m.pattern === expected);
        failures.push(
          registered
            ? `${row.ledger}: ${row.raw} — MOUNTED BUT UNREACHABLE. `
              + `\`${expected}\` IS registered, but ${row.method} ${probePath(row.pattern)} is answered by `
              + `\`${resolved.pattern}\` — a first-match router gives the path to whichever registration came `
              + 'first. Move it ahead of that sibling.'
            : `${row.ledger}: ${row.raw} — LEDGERED BUT NOT MOUNTED, and DISGUISED. `
              + `Nothing registers \`${expected}\`; ${row.method} ${probePath(row.pattern)} is swallowed by `
              + `\`${resolved.pattern}\`, so the caller gets that route's answer — a plausible response rather `
              + 'than a 404. Register it ahead of that sibling, or say which pattern serves it with `servedBy`.',
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

  // ── …and a pin means NOTHING answers, not "something else answers" (#7563) ─
  //
  // The half the pin list was missing. "This boot does not mount it" and "this
  // boot does not ANSWER it" are different claims, and only the second one
  // makes a pin safe: a pinned path some other registration matches hands the
  // caller that route's answer, which is strictly more misleading than the 404
  // the pin implies. `POST /api/v1/packages/publish` was pinned here and
  // absorbed by `/packages/:id` for exactly that reason (#7563).
  //
  // ⚠️ THE PROBE IS ACROSS ALL VERBS, and that is the whole subject. The way
  // this class actually surfaced was NOT a same-method disguise: nothing
  // registers POST on `/packages/:id`, so `resolveMountedRoute('POST', …)`
  // answers `undefined` and a method-scoped check sees a clean absence. The
  // adapter's 405 seam does not work that way — `allowedMethodsForPath()`
  // matches the concrete PATH against every registered pattern IGNORING the
  // request's method, and answers 405 with whatever verbs that turns up. So a
  // pinned path is only genuinely unanswered when NO verb matches it; one that
  // matches under some other verb answers 405 + `Allow`, naming another route's
  // methods, which is the defect this file's pin list shipped.
  //
  // A row genuinely served by a broader pattern is not this: the ledger says so
  // with `servedBy`, and direction 1 checks it there.
  const PROBED_VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

  it('no pinned path is matched by any OTHER pattern, under any verb (#7563)', () => {
    const disguised: string[] = [];

    for (const [key, reason] of Object.entries(UNEXERCISED_BY_THIS_BOOT)) {
      const sp = key.indexOf(' ');
      const pattern = key.slice(sp + 1);
      // A `**` row names a prefix family rather than one resolvable path, so
      // there is no concrete probe to build; the check above already asserts
      // nothing is mounted under the prefix.
      if (pattern.includes('*')) continue;

      const path = probePath(pattern);
      for (const verb of PROBED_VERBS) {
        const resolved = server.resolveMountedRoute!(verb, path);
        if (!resolved || resolved.pattern === pattern) continue;
        disguised.push(
          `${key} — pinned as unobservable ("${reason}"), but \`${resolved.pattern}\` matches ${path} under `
          + `${verb}. The pin claims a caller gets nothing here; a caller actually gets that route's answer — `
          + `its 405 + \`Allow\` when the verbs differ, its body when they do not. Mount an owner for this path `
          + '(so it can 404 for itself), or declare `servedBy` if that pattern legitimately serves it.',
        );
      }
    }

    expect(disguised, `\n${disguised.join('\n')}\n`).toEqual([]);
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

  // The publish path, pinned in both the currencies that matter: which
  // registration the router hands it to, and what a caller actually receives.
  it('POST /packages/publish is owned by the publish route, not absorbed by /packages/:id (#7563)', async () => {
    // `/packages/:id` is mounted (by the dispatcher) and would match this path
    // under GET/DELETE/PATCH — which is the whole reason the 405 was built from
    // its method set. The publish registration has to win the POST.
    expect(mounted.map((m) => `${m.method} ${m.pattern}`)).toContain('GET /api/v1/packages/:id');
    expect(server.resolveMountedRoute!('POST', '/api/v1/packages/publish'))
      .toEqual({ method: 'POST', pattern: '/api/v1/packages/publish' });

    // …and on the wire. This boot composes no `package` service, so the honest
    // answer is the publish route's own 404 naming the surface — never a 405
    // advertising `DELETE, GET, HEAD, PATCH`, which are `/packages/:id`'s verbs
    // over a package whose id is the literal string `publish`.
    const token = await stack.signIn();
    const res = await stack.apiAs(token, 'POST', '/packages/publish', {});
    expect(res.status).toBe(404);
    expect(res.headers.get('Allow')).toBeNull();
    expect((await res.json())?.error?.message).toContain('marketplace publish surface');
  }, 60_000);

  // The other two defects, pinned as live-router facts rather than as prose.
  it('the three #7526 routes resolve to themselves and not to a catch-all sibling', () => {
    expect(server.resolveMountedRoute!('GET', '/api/v1/meta/object/lead/published'))
      .toEqual({ method: 'GET', pattern: '/api/v1/meta/:type/:name/published' });
    expect(server.resolveMountedRoute!('GET', '/api/v1/meta/object/showcase_task/state/status'))
      .toEqual({ method: 'GET', pattern: '/api/v1/meta/object/:name/state/:field' });
    // #9180 step 2 retired the plural twin: the live router resolves it to
    // NOTHING now, which is the fact the ledger's deleted row claims.
    expect(server.resolveMountedRoute!('GET', '/api/v1/meta/objects/showcase_task/state/status'))
      .toBeUndefined();
  });
});
