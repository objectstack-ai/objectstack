// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13906] REACHABILITY of the two `computeExecCtx` seams that absorb a
 * FAILURE into the same `undefined` an ABSENT wiring produces — and both feed
 * AUTHORIZATION inputs: the tenancy posture and the ADR-0069 auth gate.
 *
 * ## ⛔ This is a MEASUREMENT file. It repairs nothing and proposes nothing.
 *
 * #13906 records a code reading ("no severity asserted and no direction
 * measured") and its dispatch order was explicit: the first deliverable is a
 * READING, not a repair. Every assertion below pins what the tree DOES today,
 * driven through the real supplier — including the permissive answers.
 * ⛔ A pin on a permissive answer is a measurement, not an endorsement:
 * whether any of it should CHANGE is a ruling this file deliberately does not
 * take. If a later ruling repairs a seam, invert the pin IN PLACE and quote
 * the superseded text beside it, as `package-door-execctx-fault-reachability`
 * did for #13279/#13476.
 *
 * ## Why this card is not its siblings, and why the direction matters
 *
 * #13476 / #13904 recorded CONSERVATIVE collapses: an unknown became an extra
 * refusal (403/503). The two seams here point the OTHER way:
 *
 *  1. **Tenancy posture** — `resolveAuthzContext` runs two Layer 0 refusals
 *     ONLY when `input.tenancyPosture` is present (`organization_required` at
 *     admission, `organization_membership_ended` after grants). An absorbed
 *     posture-probe failure therefore SKIPS refusals rather than adding one.
 *  2. **Auth gate** — `authGate === undefined` means both "no gate is active"
 *     and "the gate probe / session re-read FAILED", and `enforceAuth` blocks
 *     only on a present gate.
 *
 * ## Reading discipline (the #13476 bar)
 *
 *  - Every fault is driven beside a POSITIVE CONTROL that is the same wiring
 *    with the one fault removed, so "the refusal was skipped" is
 *    distinguishable from "the refusal did not apply".
 *  - Faults are driven at PRODUCTION seams — a real `ObjectKernel` whose
 *    `tenancy` factory throws (the registry's own "registered and FAILED to
 *    construct" rejection, #13905), a service that was genuinely never
 *    registered (the branded rejection), an auth service whose session
 *    re-read fails — never by throwing hand-made errors into the seam under
 *    measurement.
 *  - The enumeration criterion (§0) is shown to have power on today's tree:
 *    it must flag the two seams this card names (known positives) and must
 *    NOT flag the engine seam #13476 repaired (`wiredEngineOrLoud`, the known
 *    kept-apart site). The historical half of that control — the same
 *    criterion flagging the engine seam at the pre-#13910 merge base — runs
 *    outside vitest (it needs git history) and is recorded on the card.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ObjectKernel,
  hashApiKey,
  resolveAuthzContext,
  isServiceNotRegisteredError,
  ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_STATUS,
} from '@objectstack/core';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { registerPackageRoutes } from './package-routes.js';
import { RestServer } from './rest-server.js';

const PKGS = '/api/v1/packages';
const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'rest-server.ts'), 'utf8');

// ---------------------------------------------------------------------------
// §0 — The enumeration criterion, and its in-file power controls.
//
// The card's premise moved twice after it was written (#13811, #13910, #14120
// all landed on rest-server.ts on 09-01; #14250 repaired the shipped provider
// one layer earlier). So the two seams' liveness is DERIVED from today's
// source here, by symbol, rather than inherited from the card's quotes.
// ---------------------------------------------------------------------------

/** The full `computeExecCtx` method text, sliced by brace counting. */
function computeExecCtxBody(source: string): string {
  const start = source.indexOf('private async computeExecCtx(');
  if (start < 0) throw new Error('computeExecCtx not found — locate by symbol failed');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('computeExecCtx: unbalanced braces');
}

/**
 * The absorb criterion: a seam is ABSORB when its failure resolves to
 * `undefined` instead of rejecting. Mechanically, inside `computeExecCtx`:
 * every `seamOrUndefined(` call site, every `try` whose catch either assigns
 * `undefined` or swallows into a comment-only body, and every `.catch(` that
 * resolves the chain. `wiredEngineOrLoud(` is the KNOWN kept-apart spelling
 * (#13476's repair) and must never be counted as absorb.
 */
function enumerateAbsorbSites(body: string): string[] {
  const sites: string[] = [];
  const lines = body.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('seamOrUndefined(')) sites.push(`L${i}: ${line.trim()}`);
    // `catch` blocks that produce undefined: assignment or comment-only swallow.
    if (/catch\s*(\(|\{)/.test(line)) {
      const tail = lines.slice(i, i + 3).join('\n');
      if (/=\s*undefined/.test(tail) || /catch\s*\{\s*\/\*/.test(tail) || /catch\s*\{\s*$/.test(line)) {
        sites.push(`L${i}: ${line.trim()}`);
      }
    }
    if (/\.catch\(/.test(line)) sites.push(`L${i}: ${line.trim()}`);
  });
  return sites;
}

describe('[#13906] §0 — the two seams are LIVE on today\'s tree, by symbol', () => {
  const body = computeExecCtxBody(SOURCE);
  const sites = enumerateAbsorbSites(body);

  it('KNOWN POSITIVE: the tenancy-posture seam still absorbs to undefined', () => {
    // The card's quoted shape, re-derived: the posture read sits in a try
    // whose catch assigns undefined, and it dereferences the local `kernel`.
    expect(body).toMatch(/tenancyPosture = effectiveTenancyPosture\(await kernel\.getServiceAsync\('tenancy'\)/);
    expect(body).toMatch(/catch\s*\{\s*\n\s*tenancyPosture = undefined;/);
    expect(sites.some((s) => s.includes('tenancyPosture = undefined') || /catch/.test(s))).toBe(true);
  });

  it('KNOWN POSITIVE: the auth-gate seam still absorbs to undefined', () => {
    expect(body).toMatch(/isAuthGateActive === 'function' && authService\.isAuthGateActive\(\)/);
    // The comment-only swallow, verbatim class: gate is best-effort.
    expect(body).toMatch(/catch\s*\{\s*\/\*\s*gate is best-effort/);
  });

  it('KNOWN NEGATIVE: the engine seam #13476 repaired is NOT flagged as absorb', () => {
    // The provider branch resolves through the loud spelling…
    expect(body).toMatch(/wiredEngineOrLoud\(/);
    // …and the criterion never lists a wiredEngineOrLoud line as an absorb site.
    expect(sites.filter((s) => s.includes('wiredEngineOrLoud'))).toEqual([]);
  });

  it('the local `kernel` is assigned ONLY on kernelManager branches — the single-kernel provider path never sets it', () => {
    // Mechanical basis for §3: every assignment to the local `kernel` sits
    // behind `this.kernelManager`. If a new branch ever assigns it elsewhere,
    // this pin goes red and §3's reading must be re-derived.
    const assignments = body.split('\n').filter((l) => /\bkernel = /.test(l));
    expect(assignments.length).toBeGreaterThan(0);
    for (const a of assignments) {
      expect(a).toMatch(/kernelManager\.getOrCreate/);
    }
  });
});

// ---------------------------------------------------------------------------
// Harness — the REAL supplier and the REAL registrar, wired the production
// way (same pattern as package-door-execctx-fault-reachability.test.ts:
// constructor seams only, nothing private replaced).
// ---------------------------------------------------------------------------

interface Wiring {
  kernelManager?: any;
  defaultEnvironmentIdProvider?: any;
  authServiceProvider?: any;
  objectQLProvider?: any;
}

function serverWith(w: Wiring): RestServer {
  return new RestServer(
    { get: () => {}, post: () => {}, put: () => {}, delete: () => {}, patch: () => {}, use: () => {} } as any,
    {} as any,
    {} as any,
    w.kernelManager,
    undefined,
    w.defaultEnvironmentIdProvider,
    w.authServiceProvider,
    w.objectQLProvider,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );
}

interface Captured { status: number; body: any }

function mount(rest: RestServer): Map<string, RouteHandler> {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT:${p}`, h); },
    delete: (p: string, h: RouteHandler) => { routes.set(`DELETE:${p}`, h); },
    patch: () => {}, use: () => {}, listen: async () => {}, close: async () => {},
  } as any;
  registerPackageRoutes(
    server,
    () => ({ list: async () => [], publish: async () => ({}), delete: async () => ({}) }) as any,
    '/api/v1',
    { resolveExecutionContext: (req: any) => rest.resolvePackageRouteExecutionContext(req) } as any,
  );
  return routes;
}

async function drive(
  routes: Map<string, RouteHandler>,
  headers: Record<string, string>,
): Promise<Captured> {
  const handler = routes.get(`GET:${PKGS}`);
  if (!handler) throw new Error(`no handler for GET ${PKGS}`);
  const captured: Captured = { status: 0, body: undefined };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler({ params: {}, query: {}, body: undefined, headers, method: 'GET', path: PKGS } as any, res);
  return captured;
}

// --- Fixtures ---------------------------------------------------------------

const RAW_MEMBER_KEY = 'osk_member_key_fixture';
const RAW_EXMEMBER_KEY = 'osk_exmember_key_fixture';
const RAW_ORGLESS_KEY = 'osk_orgless_key_fixture';

/**
 * A permission store with the SHIPPED aggregation shapes: API keys in
 * `sys_api_key`, memberships in `sys_member`, capabilities through
 * `sys_user_permission_set` → `sys_permission_set`. Filters honour the
 * `where` keys the resolver actually sends, so the two `sys_member` reads
 * (by user, by org) answer differently, as a real engine does.
 */
function qlWith(opts: { memberships: Array<{ user_id: string; organization_id: string }> }) {
  const apiKeys = [
    { key: hashApiKey(RAW_MEMBER_KEY), user_id: 'u_member', active_organization_id: 'org_A', revoked: false },
    { key: hashApiKey(RAW_EXMEMBER_KEY), user_id: 'u_exmember', active_organization_id: 'org_A', revoked: false },
    { key: hashApiKey(RAW_ORGLESS_KEY), user_id: 'u_orgless', revoked: false },
  ];
  return {
    find: async (object: string, q: any = {}) => {
      const where = q?.where ?? {};
      if (object === 'sys_api_key') return apiKeys.filter((r) => r.key === where.key);
      if (object === 'sys_member') {
        if (where.user_id) return opts.memberships.filter((m) => m.user_id === where.user_id);
        if (where.organization_id) return opts.memberships.filter((m) => m.organization_id === where.organization_id);
        return [];
      }
      if (object === 'sys_user') return [{ id: where.id, email: `${where.id}@example.com` }];
      if (object === 'sys_user_permission_set') return [{ permission_set_id: 'ps_pkg' }];
      if (object === 'sys_permission_set') {
        return [{ id: 'ps_pkg', name: 'pkg_admin', system_permissions: ['manage_metadata', 'studio.access'] }];
      }
      return [];
    },
  };
}

/** A real kernel, as `kernelManager.getOrCreate` would hand back. */
function kernelWith(opts: {
  ql: any;
  tenancy?: 'healthy-isolated' | 'factory-throws' | 'unregistered' | { recording: { calls: number } };
}): ObjectKernel {
  // `gracefulShutdown: false` — a fixture kernel must not hook the test
  // runner's process signals (the default registers SIGTERM/SIGINT handlers).
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  kernel.registerService('auth', { api: { getSession: async () => null } });
  kernel.registerService('objectql', opts.ql);
  if (opts.tenancy === 'healthy-isolated') {
    kernel.registerService('tenancy', { posture: 'isolated' });
  } else if (opts.tenancy === 'factory-throws') {
    // The REAL failure class (#13905: "registered and FAILED to construct"):
    // the registry's own unbranded rejection, not a hand-thrown stub error at
    // the seam under measurement.
    kernel.registerServiceFactory('tenancy', () => {
      throw new Error('tenancy backend unavailable');
    });
  } else if (opts.tenancy && typeof opts.tenancy === 'object') {
    const rec = opts.tenancy.recording;
    kernel.registerServiceFactory('tenancy', () => {
      rec.calls++;
      return { posture: 'isolated' };
    });
  }
  // 'unregistered' → nothing: the branded not-registered rejection.
  return kernel;
}

/** kernelManager-path wiring: the multi-tenant shape. */
function viaKernelManager(kernel: ObjectKernel): Wiring {
  return {
    kernelManager: { getOrCreate: async () => kernel },
    defaultEnvironmentIdProvider: () => 'env1',
  };
}

/**
 * Single-kernel provider-path wiring, byte-faithful to `rest-api-plugin.ts`
 * (#14250 shape): the auth provider absorbs, the objectql provider absorbs
 * ONLY the branded not-registered rejection. No kernelManager.
 */
function viaProviders(kernel: ObjectKernel): Wiring {
  return {
    authServiceProvider: async () => {
      try { return kernel.getService('auth'); } catch { return undefined; }
    },
    objectQLProvider: async () => {
      try {
        return await kernel.getServiceAsync('objectql');
      } catch (err) {
        if (isServiceNotRegisteredError(err)) return undefined;
        throw err;
      }
    },
  };
}

const MEMBER_ROWS = [
  { user_id: 'u_member', organization_id: 'org_A' },
  // u_exmember holds NO current membership in org_A — the key outlived it.
  { user_id: 'u_exmember', organization_id: 'org_B' },
];

// ---------------------------------------------------------------------------
// §1 — Instrument controls: the harness can serve and can refuse.
// ---------------------------------------------------------------------------

describe('[#13906] §1 — instrument controls', () => {
  it('CONTROL 200: a CURRENT member\'s org-stamped key is served under a healthy, wall-enforcing tenancy service', async () => {
    const kernel = kernelWith({ ql: qlWith({ memberships: MEMBER_ROWS }), tenancy: 'healthy-isolated' });
    const captured = await drive(mount(serverWith(viaKernelManager(kernel))), { 'x-api-key': RAW_MEMBER_KEY });
    expect(captured.status).toBe(200);
    expect(captured.body?.success).toBe(true);
  });

  it('CONTROL 401: with no credential at all the door refuses on the anonymous floor', async () => {
    const kernel = kernelWith({ ql: qlWith({ memberships: MEMBER_ROWS }), tenancy: 'healthy-isolated' });
    const captured = await drive(mount(serverWith(viaKernelManager(kernel))), {});
    expect(captured.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(captured.body?.error?.code).toBe(ANONYMOUS_DENY_CODE);
  });
});

// ---------------------------------------------------------------------------
// §2 — SEAM 1 (tenancy posture), kernelManager path: is the permissive path
// reachable? The refusal is shown to APPLY (positive control), then the ONE
// changed condition is the tenancy service's health.
// ---------------------------------------------------------------------------

describe('[#13906] §2 — the Layer 0 ex-member refusal, and what a failed posture probe does to it', () => {
  it('POSITIVE CONTROL: healthy `isolated` tenancy → the ex-member key IS refused (401 on the wire)', async () => {
    const kernel = kernelWith({ ql: qlWith({ memberships: MEMBER_ROWS }), tenancy: 'healthy-isolated' });
    const captured = await drive(mount(serverWith(viaKernelManager(kernel))), { 'x-api-key': RAW_EXMEMBER_KEY });
    // The refusal collapses to "no principal" at this transport, so the wire
    // answer is the anonymous floor — the REASON never reaches the wire.
    expect(captured.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(captured.body?.error?.code).toBe(ANONYMOUS_DENY_CODE);
  });

  it('POSITIVE CONTROL (mechanism): the 401 above IS the membership refusal — the resolver names it', async () => {
    // Same fixtures, same real resolver, posture present: the refusal fires
    // and carries its reason. This is what distinguishes "the refusal was
    // skipped" (§ next) from "the refusal never applied to this fixture".
    const headers = new Headers({ 'x-api-key': RAW_EXMEMBER_KEY });
    const authz = await resolveAuthzContext({
      ql: qlWith({ memberships: MEMBER_ROWS }),
      headers,
      getSession: async () => undefined,
      tenancyPosture: 'isolated',
    } as any);
    expect(authz.authRefusal?.reason).toBe('organization_membership_ended');
    expect(authz.userId).toBeUndefined();
  });

  it('⚠️ MEASURED PERMISSIVE: tenancy REGISTERED AND FAILING (factory throws) → the refusal is SKIPPED and the ex-member key is served 200', async () => {
    // ONE condition changed from the positive control: the tenancy service
    // fails to construct — the registry's own unbranded rejection reaches the
    // seam's catch and the posture becomes `undefined`.
    const kernel = kernelWith({ ql: qlWith({ memberships: MEMBER_ROWS }), tenancy: 'factory-throws' });
    const captured = await drive(mount(serverWith(viaKernelManager(kernel))), { 'x-api-key': RAW_EXMEMBER_KEY });
    expect(captured.status).toBe(200);
    expect(captured.body?.success).toBe(true);
  });

  it('⚠️ MEASURED PERMISSIVE (mechanism): with the posture absent the resolver ADMITS the ex-member as a full principal', async () => {
    const headers = new Headers({ 'x-api-key': RAW_EXMEMBER_KEY });
    const authz = await resolveAuthzContext({
      ql: qlWith({ memberships: MEMBER_ROWS }),
      headers,
      getSession: async () => undefined,
      tenancyPosture: undefined,
    } as any);
    expect(authz.authRefusal).toBeUndefined();
    expect(authz.userId).toBe('u_exmember');
    // The membership fact is IN HAND and says "not a member of org_A" — the
    // refusal was gated off by the missing posture, not by missing data.
    expect(authz.accessible_org_ids).not.toContain('org_A');
    expect(authz.tenantId).toBe('org_A');
  });

  it('THE COLLAPSE: "registered and failed" and "never registered" answer byte-identically at the door', async () => {
    const failed = kernelWith({ ql: qlWith({ memberships: MEMBER_ROWS }), tenancy: 'factory-throws' });
    const absent = kernelWith({ ql: qlWith({ memberships: MEMBER_ROWS }), tenancy: 'unregistered' });
    const a = await drive(mount(serverWith(viaKernelManager(failed))), { 'x-api-key': RAW_EXMEMBER_KEY });
    const b = await drive(mount(serverWith(viaKernelManager(absent))), { 'x-api-key': RAW_EXMEMBER_KEY });
    // The `unregistered` half is the SUPPORTED single-tenant shape (no wall
    // exists, an org-stamped key still working is by design). The `failed`
    // half rides the same answer. That equality is the card's subject.
    expect(a).toEqual(b);
    expect(a.status).toBe(200);
  });

  it('SIBLING REFUSAL, same gate: the org-less-key refusal under `isolated` is also skipped when the probe fails', async () => {
    // `resolveApiKeyAdmission` refuses an org-less key under a walled,
    // non-union posture (`organization_required`) — also only when the
    // posture is PRESENT. Note api-key.ts DOCUMENTS absent-posture-admit as a
    // deliberate decision for THIS refusal ("refusing on an unknown posture
    // would break every org-less key on every `single` deployment"). What
    // that comment does not distinguish is "no tenancy service" from "the
    // tenancy service failed": both arrive as the same absent posture.
    const healthy = kernelWith({ ql: qlWith({ memberships: MEMBER_ROWS }), tenancy: 'healthy-isolated' });
    const refused = await drive(mount(serverWith(viaKernelManager(healthy))), { 'x-api-key': RAW_ORGLESS_KEY });
    expect(refused.status).toBe(ANONYMOUS_DENY_STATUS);

    const failing = kernelWith({ ql: qlWith({ memberships: MEMBER_ROWS }), tenancy: 'factory-throws' });
    const admitted = await drive(mount(serverWith(viaKernelManager(failing))), { 'x-api-key': RAW_ORGLESS_KEY });
    expect(admitted.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// §3 — SEAM 1 (tenancy posture), single-kernel provider path: the card's
// sharper claim. `kernel` is a LOCAL that only kernelManager branches assign
// (§0 pins that mechanically), so on the shipped single-kernel wiring the
// posture probe dereferences `undefined` and the posture is ALWAYS absent —
// not an edge case on failure, the NORMAL state of that wiring.
// ---------------------------------------------------------------------------

describe('[#13906] §3 — single-kernel provider path: the posture is never even asked for', () => {
  it('⚠️ MEASURED: the SAME deployment facts answer 401 via kernelManager and 200 via the provider wiring — and the healthy tenancy service is NEVER INVOKED on the provider path', async () => {
    // ONE real kernel: healthy, wall-enforcing tenancy (a RECORDING factory),
    // same engine fixture, same ex-member key. The only variable is which of
    // the two shipped wiring shapes the host used.
    const recA = { calls: 0 };
    const viaManager = kernelWith({ ql: qlWith({ memberships: MEMBER_ROWS }), tenancy: { recording: recA } });
    const refused = await drive(mount(serverWith(viaKernelManager(viaManager))), { 'x-api-key': RAW_EXMEMBER_KEY });
    expect(refused.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(recA.calls).toBeGreaterThan(0); // the wall consulted the posture

    const recB = { calls: 0 };
    const viaProvider = kernelWith({ ql: qlWith({ memberships: MEMBER_ROWS }), tenancy: { recording: recB } });
    const served = await drive(mount(serverWith(viaProviders(viaProvider))), { 'x-api-key': RAW_EXMEMBER_KEY });
    expect(served.status).toBe(200);
    // The tenancy service is healthy and registered — and was never asked.
    // "Failed" is not even required on this path: the posture is undefined
    // BEFORE any failure can occur, which is why the card calls it the
    // normal state rather than a failure edge case.
    expect(recB.calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §4 — SEAM 2 (ADR-0069 auth gate): are a FAILED probe and an INACTIVE gate
// distinguishable in the wire answer? Driven at the producer
// (`computeExecCtx`, via its public entry) and read at the real consumer
// (`enforceAuth`) — the same composition the data routes run.
// ---------------------------------------------------------------------------

describe('[#13906] §4 — auth gate: failed probe vs inactive gate', () => {
  const GATED_USER = {
    id: 'u_gated',
    authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' },
  };

  function gateWiring(authService: any): RestServer {
    return serverWith({
      authServiceProvider: async () => authService,
      objectQLProvider: async () => qlWith({ memberships: [] }),
    });
  }

  /** Resolve the context through the public entry, then run the REAL consumer. */
  async function driveGate(rest: RestServer) {
    const req = { params: {}, query: {}, headers: { cookie: 'session=s1' }, method: 'GET', path: '/api/v1/data/sys_user' };
    const ctx = await rest.resolvePackageRouteExecutionContext(req);
    const state: any = { status: 0, body: undefined };
    const res: any = {
      status: (c: number) => { state.status = c; return res; },
      json: (b: any) => { state.body = b; },
      header: () => res, send: () => {},
    };
    const blocked = (rest as any).enforceAuth(req, res, ctx);
    return { ctx, blocked, state };
  }

  it('POSITIVE CONTROL: an ACTIVE gate with a healthy re-read BLOCKS the gated user — 403, gate code + message', async () => {
    const auth = {
      isAuthGateActive: () => true,
      api: { getSession: async () => ({ user: GATED_USER }) },
    };
    const r = await driveGate(gateWiring(auth));
    expect(r.ctx?.userId).toBe('u_gated');
    expect(r.ctx?.authGate).toEqual({ code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' });
    expect(r.blocked).toBe(true);
    expect(r.state.status).toBe(403);
    expect(r.state.body?.error?.code).toBe('PASSWORD_EXPIRED');
  });

  it('BASELINE: an INACTIVE gate does not block — the common, correct case', async () => {
    const auth = {
      isAuthGateActive: () => false,
      api: { getSession: async () => ({ user: GATED_USER }) },
    };
    const r = await driveGate(gateWiring(auth));
    expect(r.ctx?.userId).toBe('u_gated');
    expect(r.ctx?.authGate).toBeUndefined();
    expect(r.blocked).toBe(false);
  });

  it('⚠️ MEASURED: a THROWING probe (isAuthGateActive faults) is indistinguishable from the inactive gate — same context field, same consumer verdict, nothing on the wire', async () => {
    const inactive = await driveGate(gateWiring({
      isAuthGateActive: () => false,
      api: { getSession: async () => ({ user: GATED_USER }) },
    }));
    const probeThrows = await driveGate(gateWiring({
      isAuthGateActive: () => { throw new Error('gate config read failed'); },
      api: { getSession: async () => ({ user: GATED_USER }) },
    }));
    expect(probeThrows.ctx?.authGate).toBeUndefined();
    expect(probeThrows.blocked).toBe(false);
    // Byte-level: the observable triple is identical to the inactive gate's.
    expect({ authGate: probeThrows.ctx?.authGate, blocked: probeThrows.blocked, wire: probeThrows.state })
      .toEqual({ authGate: inactive.ctx?.authGate, blocked: inactive.blocked, wire: inactive.state });
  });

  it('⚠️ MEASURED: a FAILED session re-read under an ACTIVE gate is indistinguishable from the inactive gate — the gated user is NOT blocked', async () => {
    // The transient class: identity resolution succeeds (first read), the
    // gate's re-read fails (second read) — a session-backend fault between
    // the two reads of one request.
    let reads = 0;
    const auth = {
      isAuthGateActive: () => true,
      api: {
        getSession: async () => {
          reads++;
          if (reads > 1) throw new Error('session backend unavailable');
          return { user: GATED_USER };
        },
      },
    };
    const inactive = await driveGate(gateWiring({
      isAuthGateActive: () => false,
      api: { getSession: async () => ({ user: GATED_USER }) },
    }));
    const rereadFails = await driveGate(gateWiring(auth));
    expect(reads).toBeGreaterThan(1); // the gate DID probe — and its failure vanished
    expect(rereadFails.ctx?.userId).toBe('u_gated');
    expect(rereadFails.ctx?.authGate).toBeUndefined();
    expect(rereadFails.blocked).toBe(false);
    expect({ authGate: rereadFails.ctx?.authGate, blocked: rereadFails.blocked, wire: rereadFails.state })
      .toEqual({ authGate: inactive.ctx?.authGate, blocked: inactive.blocked, wire: inactive.state });
    // This user's SESSION says the policy gate applies (user.authGate is set,
    // the gate is ACTIVE) — the block was lost to the re-read failure, and
    // the wire carries no trace. The code comment names the design
    // best-effort; whether that stands is a ruling, recorded on #13906, and
    // deliberately not taken here.
  });
});
