// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15021] MEASUREMENT — does the #13906 fail-closed window also refuse the
 * ALLOW-LISTED remediation routes `isAuthGateAllowlisted` exists to keep
 * reachable?
 *
 * The card that asks this declares itself NOT MEASURED in its own words — "I
 * did not drive this" — and is a reading of where the `AuthzStoreUnavailableError`
 * throw sits relative to the `pathExempt` computation in `enforceAuth`. This
 * file is the drive. It changes nothing: the subject
 * (`RestServer.computeExecCtx`) is not edited here.
 *
 * ⛔ Nothing in this file chooses a repair. Whether the window SHOULD be
 * narrowed to non-exempt paths is runtime authorization behaviour, reserved to
 * the maintainer by the 2026-08-28 negative-boundary ruling. The card offers
 * three options and this file endorses none of them.
 *
 * ## What was measured (all of it driven; the head is on the PR)
 *
 *  - §1 CONTROL A — the window fires at all on this fixture: an active gate
 *    whose session re-read FAILS answers 503 `AuthzStoreUnavailableError`
 *    (`object: 'auth_gate'`) on a PROTECTED path, with the re-read counter
 *    proving the fault was reached.
 *  - §1 CONTROL B — the allow-list is LIVE on this same fixture: the same
 *    active gate with a HEALTHY re-read serves the gated user on every
 *    allow-listed path shape (`blocked === false`) while B′ shows the very
 *    same wiring answering 403 on the protected path. ⇒ a refusal on an
 *    allow-listed path below cannot be "the allow-list never applied here".
 *  - §2 SUBJECT — ⚠️ IT REPRODUCES. Under the fault, every allow-listed path
 *    receives the same 503, `enforceAuth` is never reached (nothing is written
 *    to the wire by the consumer), and the answer is byte-identical to the
 *    protected path's. `pathExempt` is computed strictly downstream of a throw
 *    that never reads the path.
 *  - §3 REACHABILITY — the qualifier the impact claim needs: of this server's
 *    own mounted route patterns, the ONLY allow-listed ones are the discovery
 *    documents, and the discovery handler resolves no execution context (driven:
 *    it answers 200 while the re-read is failing). This server mounts none of
 *    the auth / remediation routes the allow-list names.
 *
 * ## If a repair lands, INVERT THESE PINS IN PLACE
 *
 * §2 pins what the tree DOES, including the answer the card questions. Options
 * 2 and 3 both change it. When one lands, re-aim the assertion here and quote
 * the superseded text beside it — the discipline
 * `execctx-authz-input-seam-reachability.test.ts` follows for the same window —
 * so the change stays legible from this file alone. ⛔ Do not delete the leg.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { isAuthGateAllowlisted } from '@objectstack/core';
import { RestServer } from './rest-server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'rest-server.ts'), 'utf8');

// ---------------------------------------------------------------------------
// Harness — constructor seams only, nothing private replaced. Same shape as
// `execctx-authz-input-seam-reachability.test.ts`, which drives the sibling
// half of this window (§4 there).
// ---------------------------------------------------------------------------

const HTTP_STUB = {
  get: () => {}, post: () => {}, put: () => {}, delete: () => {}, patch: () => {},
  use: () => {}, listen: async () => {}, close: async () => {},
} as any;

function serverWith(authService: any, ql: any): RestServer {
  return new RestServer(
    HTTP_STUB,
    {} as any,
    {} as any,
    undefined,                       // kernelManager
    undefined,                       // envRegistry
    undefined,                       // defaultEnvironmentIdProvider
    async () => authService,         // authServiceProvider — the single-kernel wiring
    async () => ql,                  // objectQLProvider
  );
}

/**
 * The fixture's ONE where-matcher: equality plus `$in`, and it REFUSES every
 * other shape loudly rather than reading an unimplemented operator as a field
 * that happened not to match.
 */
function matchesWhere(row: any, where: any): boolean {
  for (const [field, cond] of Object.entries(where ?? {})) {
    if (field.startsWith('$')) {
      throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
    }
    if (cond !== null && typeof cond === 'object') {
      const ops = Object.keys(cond as object);
      if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((cond as any).$in)) {
        throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
      }
      if (!(cond as any).$in.includes(row[field])) return false;
      continue;
    }
    if (row[field] !== cond) return false;
  }
  return true;
}

/** A permission store with the shipped aggregation shapes; `limit` held by presence. */
function qlFixture() {
  const tables: Record<string, any[]> = {
    sys_api_key: [],
    sys_member: [],
    sys_user: [{ id: 'u_gated', email: 'u_gated@example.com' }],
    sys_user_permission_set: [],
    sys_permission_set: [],
  };
  return {
    find: async (object: string, q: any = {}) => {
      const rows = (tables[object] ?? []).filter((row: any) => matchesWhere(row, q?.where));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
  };
}

const GATED_USER = {
  id: 'u_gated',
  authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' },
};

/** ACTIVE gate; the gate's own re-read (the SECOND getSession of the request) fails. */
function gateActiveRereadFails() {
  const rec = { reads: 0 };
  return {
    rec,
    auth: {
      isAuthGateActive: () => true,
      api: {
        getSession: async () => {
          rec.reads++;
          if (rec.reads > 1) throw new Error('session backend unavailable');
          return { user: GATED_USER };
        },
      },
    },
  };
}

/** ACTIVE gate, healthy re-read — the same fixture with the one fault removed. */
function gateActiveRereadHealthy() {
  const rec = { reads: 0 };
  return {
    rec,
    auth: {
      isAuthGateActive: () => true,
      api: {
        getSession: async () => { rec.reads++; return { user: GATED_USER }; },
      },
    },
  };
}

interface Driven { ctx: any; blocked: boolean; state: { status: number; body: any }; error: any }

/**
 * Resolve the context through the PUBLIC entry to `computeExecCtx`, then run
 * the REAL consumer (`enforceAuth`) on the same request — the composition every
 * data route runs. A rejection is captured, not thrown, so the two legs are
 * comparable side by side.
 */
async function drive(rest: RestServer, path: string, method = 'GET'): Promise<Driven> {
  const req = { params: {}, query: {}, headers: { cookie: 'session=s1' }, method, path };
  const state: any = { status: 0, body: undefined };
  const res: any = {
    status: (c: number) => { state.status = c; return res; },
    json: (b: any) => { state.body = b; },
    header: () => res, send: () => {},
  };
  let ctx: any;
  let error: any;
  try {
    ctx = await rest.resolvePackageRouteExecutionContext(req);
  } catch (err) {
    error = err;
    return { ctx: undefined, blocked: false, state, error };
  }
  const blocked = (rest as any).enforceAuth(req, res, ctx);
  return { ctx, blocked, state, error: undefined };
}

// The allow-list's four reachable path SHAPES, read off `auth-gate.ts` rather
// than invented here: an `ALLOW_PREFIXES` entry, the dispatcher path shape, an
// embedded `/auth/` segment, and an `ALLOW_SUFFIXES` entry.
const ALLOWLISTED_PATHS = [
  '/api/v1/auth/change-password',
  '/auth/two-factor/enable',
  '/api/v1/environments/env1/auth/sign-out',
  '/api/v1/health',
  '/api/v1/me/apps',
];
const PROTECTED_PATH = '/api/v1/data/sys_user';

// ---------------------------------------------------------------------------
// §0 — Instrument sanity: the paths this file calls allow-listed really are,
// and the control path really is not. Without this, every "503 on an
// allow-listed path" below could be a mislabelled protected path.
// ---------------------------------------------------------------------------

describe('[#15021] §0 the fixture paths are what they are called', () => {
  it('every ALLOWLISTED_PATHS entry is allow-listed, and the control path is not', () => {
    for (const p of ALLOWLISTED_PATHS) expect(isAuthGateAllowlisted(p), p).toBe(true);
    expect(isAuthGateAllowlisted(PROTECTED_PATH)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §1 — POSITIVE CONTROLS on the fixture. Both are the SAME wiring as the
// subject with exactly one thing changed, so a "did not reproduce" cannot be
// an instrument that never worked.
// ---------------------------------------------------------------------------

describe('[#15021] §1 positive controls — the instrument fires, and the allow-list is live', () => {
  it('CONTROL A (the window fires): active gate + FAILED re-read on a PROTECTED path → 503 AuthzStoreUnavailableError', async () => {
    const { rec, auth } = gateActiveRereadFails();
    const r = await drive(serverWith(auth, qlFixture()), PROTECTED_PATH);
    expect(r.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503, object: 'auth_gate' });
    // Anti-vacuity: the re-read was actually REACHED.
    expect(rec.reads).toBeGreaterThan(1);
  });

  it('CONTROL B (the allow-list is live): active gate + HEALTHY re-read + gated user on an ALLOW-LISTED path → served, not blocked', async () => {
    for (const path of ALLOWLISTED_PATHS) {
      const { rec, auth } = gateActiveRereadHealthy();
      const r = await drive(serverWith(auth, qlFixture()), path);
      expect(r.error, path).toBeUndefined();
      expect(r.ctx?.userId, path).toBe('u_gated');
      expect(r.ctx?.authGate, path).toEqual(GATED_USER.authGate);
      // The gate IS present on the context and the consumer still lets it
      // through — that is the allow-list doing its job on this exact fixture.
      expect(r.blocked, path).toBe(false);
      expect(rec.reads, path).toBeGreaterThan(1);
    }
  });

  it('CONTROL B′ (the gate is not simply off): the same wiring BLOCKS the same user on the PROTECTED path — 403 with the gate code', async () => {
    const { auth } = gateActiveRereadHealthy();
    const r = await drive(serverWith(auth, qlFixture()), PROTECTED_PATH);
    expect(r.blocked).toBe(true);
    expect(r.state.status).toBe(403);
    expect(r.state.body?.error?.code).toBe('PASSWORD_EXPIRED');
  });
});

// ---------------------------------------------------------------------------
// §2 — THE SUBJECT. Same fixture, same fault, allow-listed path.
// ---------------------------------------------------------------------------

describe('[#15021] §2 the subject — an allow-listed path inside the fail-closed window', () => {
  it('MEASURED: active gate + FAILED re-read on every ALLOW-LISTED path → the same 503, and `enforceAuth` is never reached', async () => {
    for (const path of ALLOWLISTED_PATHS) {
      const { rec, auth } = gateActiveRereadFails();
      const r = await drive(serverWith(auth, qlFixture()), path);
      expect(r.error, path).toMatchObject({
        code: 'SERVICE_UNAVAILABLE', status: 503, object: 'auth_gate',
      });
      expect(rec.reads, path).toBeGreaterThan(1);
      // Nothing was written to the wire by the consumer: the refusal happened
      // upstream of it, so `pathExempt` was never computed for this request.
      expect(r.state.status, path).toBe(0);
    }
  });

  it('MEASURED: the refusal is BYTE-IDENTICAL on an allow-listed and a protected path — the answer carries no path sensitivity at all', async () => {
    const shape = async (path: string) => {
      const { auth } = gateActiveRereadFails();
      const r = await drive(serverWith(auth, qlFixture()), path);
      return {
        code: r.error?.code, status: r.error?.status, object: r.error?.object,
        name: r.error?.name, wire: r.state,
      };
    };
    expect(await shape('/api/v1/auth/change-password')).toEqual(await shape(PROTECTED_PATH));
  });

  it('MEASURED: the throw is upstream of the path — `computeExecCtx` never reads `req.path` for the gate decision', () => {
    // Structural corroboration of the drive above, derived from today's source
    // rather than quoted from the card. `isAuthGateAllowlisted` is imported by
    // this module, but the gate block that raises does not consult it.
    const start = SOURCE.indexOf('if (gateActive) {');
    expect(start).toBeGreaterThan(-1);
    const block = SOURCE.slice(start, SOURCE.indexOf('normalizeAuthGate(gatedSession?.user)', start));
    expect(block).toContain("throw new AuthzStoreUnavailableError('auth_gate', err);");
    expect(block).not.toContain('isAuthGateAllowlisted');
    expect(block).not.toContain('req.path');
  });
});

// ---------------------------------------------------------------------------
// §3 — REACHABILITY on the REST door: is there a MOUNTED route whose concrete
// path is allow-listed AND which resolves an execution context? This is what
// separates "the seam is path-blind" (§2, certain) from "a remediation route a
// gated user needs is answered 503" (production impact).
// ---------------------------------------------------------------------------

type Mounted = { method: string; path: string; handler: any };

/** Minimal `RestProtocol` face — only what the discovery handler reads. */
const PROTOCOL_STUB = {
  getDiscovery: async () => ({ name: 'fixture', version: '0.0.0-fixture', routes: {} }),
} as any;

function census(config: any, authService?: any, ql?: any): { rest: RestServer; mounted: Mounted[] } {
  const mounted: Mounted[] = [];
  const recording = {
    get: (p: string, h: any) => { mounted.push({ method: 'GET', path: p, handler: h }); },
    post: (p: string, h: any) => { mounted.push({ method: 'POST', path: p, handler: h }); },
    put: (p: string, h: any) => { mounted.push({ method: 'PUT', path: p, handler: h }); },
    delete: (p: string, h: any) => { mounted.push({ method: 'DELETE', path: p, handler: h }); },
    patch: (p: string, h: any) => { mounted.push({ method: 'PATCH', path: p, handler: h }); },
    use: () => {}, listen: async () => {}, close: async () => {},
  } as any;
  const rest = new RestServer(
    recording, PROTOCOL_STUB, config,
    undefined, undefined, undefined,
    authService ? async () => authService : undefined,
    ql ? async () => ql : undefined,
  );
  rest.registerRoutes();
  return { rest, mounted };
}

describe('[#15021] §3 reachability — which MOUNTED REST routes carry an allow-listed path', () => {
  it('CENSUS: across both project-scoping configurations, exactly one mounted REST route pattern is allow-listed', () => {
    const configs: Array<[string, any]> = [
      ['default (unscoped)', {}],
      ['scoping optional', { api: { enableProjectScoping: true, projectResolution: 'optional' } }],
      ['scoping required', { api: { enableProjectScoping: true, projectResolution: 'required' } }],
    ];
    const seen = new Map<string, string[]>();
    for (const [name, config] of configs) {
      const { mounted } = census(config);
      expect(mounted.length, name).toBeGreaterThan(0);
      const allow = mounted.filter((r) => isAuthGateAllowlisted(r.path));
      seen.set(name, allow.map((r) => `${r.method} ${r.path}`));
    }
    // eslint-disable-next-line no-console
    console.log('[#15021] allow-listed MOUNTED route patterns by config:\n%s',
      [...seen].map(([k, v]) => `  ${k}: ${v.length ? v.join(', ') : '(none)'}`).join('\n'));
    // Every configuration lands on the SAME surface: the discovery document,
    // at whichever bases that configuration mounts. ⛔ NOT one of the auth /
    // remediation routes the allow-list names — this server mounts none of
    // those, on any configuration.
    for (const [name, v] of seen) {
      expect(v.length, name).toBeGreaterThan(0);
      for (const r of v) expect(r, name).toMatch(/^GET \S+\/discovery$/);
    }
  });

  it('DRIVEN: the one allow-listed mounted route is NOT inside the window — `GET /api/v1/discovery` answers normally while the gate re-read is failing', async () => {
    const { auth } = gateActiveRereadFails();
    const { mounted } = census({}, auth, qlFixture());
    const route = mounted.find((r) => r.method === 'GET' && r.path === '/api/v1/discovery');
    expect(route).toBeDefined();
    const state: any = { status: 200, body: undefined };
    const res: any = {
      status: (c: number) => { state.status = c; return res; },
      json: (b: any) => { state.body = b; },
      header: () => res, send: () => {},
    };
    await route!.handler(
      { params: {}, query: {}, headers: { cookie: 'session=s1' }, method: 'GET', path: '/api/v1/discovery' } as any,
      res,
    );
    // It resolves no execution context, so the fail-closed window cannot reach
    // it: the handler answers the discovery document, never touching the status.
    expect(state.status).toBe(200);
    expect(state.body?.name).toBe('fixture');
    expect(state.body?.error).toBeUndefined();
  });

  it('READING (not a drive): the gate block sits on the shared identity path, so EVERY route that resolves a context inherits the refusal', () => {
    // The census above is about PATTERNS this server mounts. It is not a claim
    // about concrete requests: `/api/v1/data/:object` with `object` = `health`
    // materializes `/api/v1/data/health`, which `isAuthGateAllowlisted` answers
    // `true` for (the `ALLOW_SUFFIXES` rule is a suffix test, not a route test).
    // That over-broad direction is #7898's subject, ⛔ not this card's, and it
    // is recorded here only so the census is not read as "the allow-list never
    // fires on this door".
    expect(isAuthGateAllowlisted('/api/v1/data/health')).toBe(true);
    expect(isAuthGateAllowlisted('/api/v1/data/sys_user')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §4 — GRADING INPUTS. Triage named exactly two conditions that would move the
// grade off `priority:p3`: "if the window is not transient, or if the gate's
// own re-read fails independently of a broader outage." Both are measured
// here; ⛔ neither is re-graded here — that is triage's call.
// ---------------------------------------------------------------------------

describe('[#15021] §4 grading inputs — is the window transient, and can the re-read fail alone?', () => {
  it('TRANSIENT: the refusal is not sticky — the very next request is served once the backend recovers', async () => {
    // One auth service across both requests, so this is recovery, not a fresh
    // fixture. The memo is keyed on the per-request object (a WeakMap), so the
    // question is real rather than rhetorical: a memo keyed any wider would
    // carry the rejection forward.
    let failing = true;
    let reads = 0;
    const auth = {
      isAuthGateActive: () => true,
      api: {
        getSession: async () => {
          reads++;
          if (failing && reads > 1) throw new Error('session backend unavailable');
          return { user: GATED_USER };
        },
      },
    };
    const rest = serverWith(auth, qlFixture());

    const during = await drive(rest, '/api/v1/auth/change-password');
    expect(during.error).toMatchObject({ status: 503, object: 'auth_gate' });

    failing = false;
    const after = await drive(rest, '/api/v1/auth/change-password');
    expect(after.error).toBeUndefined();
    expect(after.ctx?.userId).toBe('u_gated');
    expect(after.blocked).toBe(false);
    // ⇒ the window lasts exactly as long as the fault. Nothing latches.
  });

  it('INDEPENDENT: the seam issues TWO session reads per request and refuses on the SECOND alone — a fault confined to the re-read produces the refusal while identity resolution was healthy', async () => {
    const { rec, auth } = gateActiveRereadFails();
    const r = await drive(serverWith(auth, qlFixture()), '/api/v1/auth/change-password');
    expect(r.error).toMatchObject({ status: 503, object: 'auth_gate' });
    // Exactly two reads: the first RESOLVED (identity was established — the
    // request got as far as the gate), the second THREW.
    expect(rec.reads).toBe(2);
    // ⚠️ What this shows is that the code path ADMITS such a fault, because the
    // two reads are separate calls. ⛔ It is not evidence about how often a
    // real session backend fails on only one of two consecutive reads.
  });
});

// ---------------------------------------------------------------------------
// §5 — The reachability question the pattern census cannot answer on its own.
//
// §3 asks which mounted PATTERNS are allow-listed. That is not the same as
// asking which allow-listed CONCRETE paths this server would answer: a greedy
// CRUD matcher such as `/api/v1/:object/:id` captures `/api/v1/auth/sign-in`
// with `object = 'auth'`, and that concrete path IS allow-listed. If any such
// capture exists AND its handler resolves a context, the window reaches a
// remediation path for real.
// ---------------------------------------------------------------------------

/**
 * The shipped matcher's `:param` / `*` semantics, mirrored rather than
 * imported: `compileRoutePattern` lives in `@objectstack/plugin-hono-server`,
 * which this package does not depend on and must not start depending on for a
 * test. Kept byte-comparable to that source — `:param` is one non-empty
 * segment, `*` is the rest, everything else is a literal.
 */
function matchesPattern(pattern: string, path: string): boolean {
  const norm = (p: string) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);
  const body = norm(pattern).split('/').map((seg) => {
    if (seg.startsWith(':')) return '[^/]+';
    if (seg === '*') return '.*';
    return seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  }).join('/');
  return new RegExp(`^${body}$`).test(norm(path));
}

describe('[#15021] §5 can a mounted route capture a CONCRETE remediation path?', () => {
  it('sanity: the mirrored matcher behaves like the shipped one on the shapes this leg relies on', () => {
    expect(matchesPattern('/api/v1/:object/:id', '/api/v1/auth/sign-in')).toBe(true);
    expect(matchesPattern('/api/v1/data/:object', '/api/v1/data/health')).toBe(true);
    expect(matchesPattern('/api/v1/data/:object', '/api/v1/data/a/b')).toBe(false);
    expect(matchesPattern('/api/v1/auth/*', '/api/v1/auth/two-factor/enable')).toBe(true);
  });

  it('CENSUS: which mounted patterns capture a canonical allow-listed remediation path', () => {
    // Canonical remediation paths, taken from the allow-list's own purpose
    // statement in `auth-gate.ts`: change-password, two-factor enrollment,
    // sign-out, plus the two UI-bootstrap reads.
    const REMEDIATION = [
      '/api/v1/auth/change-password',
      '/api/v1/auth/two-factor/enable',
      '/api/v1/auth/sign-out',
      '/api/v1/auth/me/localization',
      '/api/v1/me/apps',
    ];
    const configs: Array<[string, any]> = [
      ['default (unscoped)', {}],
      ['scoping optional', { api: { enableProjectScoping: true, projectResolution: 'optional' } }],
      ['scoping required', { api: { enableProjectScoping: true, projectResolution: 'required' } }],
    ];
    const hits: string[] = [];
    for (const [name, config] of configs) {
      const { mounted } = census(config);
      for (const path of REMEDIATION) {
        for (const r of mounted) {
          if (matchesPattern(r.path, path)) hits.push(`${name}: ${r.method} ${r.path} <- ${path}`);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log('[#15021] mounted patterns capturing a canonical remediation path: %d\n%s',
      hits.length, hits.length ? hits.map((h) => `  ${h}`).join('\n') : '  (none)');
    // ⭐ MEASURED ZERO, and pinned rather than merely recorded. This is the
    // fact that separates "the seam is path-blind" (§2, certain) from "a gated
    // user cannot remediate" (the card's impact sentence): on today's tree no
    // route this server mounts would answer any of those paths, so the §2
    // refusal reaches none of them HERE. They are served by terminal raw-app
    // mounts (`plugin-auth`'s `/api/v1/auth/*`, `plugin-hono-server`'s
    // `/auth/me/*`) that never enter `computeExecCtx`.
    //
    // ⚠️ If this goes RED, the reachability qualifier on #15021 is gone and the
    // card's impact sentence has become true: a mounted route now answers a
    // remediation path, and §2 says every such answer is 503 for the duration
    // of a session-backend fault. ⛔ Do not relax this to make a new mount
    // pass — take it back to the decision inbox.
    expect(hits).toEqual([]);
  });
});
