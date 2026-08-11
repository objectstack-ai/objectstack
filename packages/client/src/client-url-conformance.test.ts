// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Client-URL conformance — the capstone guard (#3642).
 *
 * WHAT THE SERVER-SIDE GUARDS DO NOT ASK. The dispatcher (#3563), REST (#3587)
 * and service-mount (#3636) ledgers all run server → client: enumerate what a
 * surface mounts, demand a reviewed disposition, and for `sdk` rows demand the
 * named client method exists. *The method exists* is not *the method can be
 * called.* No guard compared the URL the client BUILDS against the patterns
 * any server MOUNTS, so a client method could name a real function, carry a
 * green ledger row, and still 404 everywhere.
 *
 * That gap shipped four times, found one at a time by hand:
 *   - `analytics.explain` called `/explain`; nothing served it (#3584)
 *   - `analytics.meta` called `/meta/:cube`; no server mounted it (#3584)
 *   - `meta.getView` sent `?type=`; REST mounts `/ui/view/:object/:type` (#3611)
 *   - `i18n.getTranslations` / `getFieldLabels` sent `?locale=` against
 *     path-param-only mounts (#3636) — both had carried a green `sdk` row
 *     since tranche 1.
 *
 * This suite closes the direction. It drives every method on a real client
 * with a recording `fetch`, then matches each captured URL against the UNION
 * of all five ledgers — dispatcher, REST, storage, i18n, auth. A union, not an
 * intersection: a route mounted by only one surface is still legitimately
 * reachable.
 *
 * WHY A REAL DRIVE, NOT A DECLARATION. Asserting "method X targets route Y" in
 * a table would be an assertion *about* the code that the code can drift away
 * from — the same failure the audit keeps finding. Running the method and
 * catching what it actually puts on the wire cannot drift.
 *
 * ANTI-ROT. The sweep's own completeness is the part that must not be skipped,
 * so it is itself asserted:
 *   1. Every method reachable on the client is either driven or carries an
 *      explicit skip reason (`NON_HTTP`) — a new method is a failure until
 *      someone classifies it.
 *   2. A driven method that emits ZERO requests fails. That is how a sweep
 *      silently rots: the placeholder args stop satisfying the method, it
 *      throws before fetching, and the guard keeps passing while covering
 *      nothing.
 *   3. A URL containing `undefined`/`[object Object]`/`NaN` fails, so a
 *      placeholder that is accepted but wrong cannot masquerade as coverage.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackClient } from './index';
import { ROUTE_LEDGER } from '../../runtime/src/route-ledger';
import { REST_ROUTE_LEDGER } from '../../rest/src/rest-route-ledger';
import { STORAGE_ROUTE_LEDGER } from '../../services/service-storage/src/storage-route-ledger';
import { I18N_ROUTE_LEDGER } from '../../services/service-i18n/src/i18n-route-ledger';
import { AUTH_ROUTE_LEDGER } from '../../plugins/plugin-auth/src/auth-route-ledger';

const BASE = 'http://localhost:9';

// ---------------------------------------------------------------------------
// 1. The ledger union → matchable patterns
// ---------------------------------------------------------------------------

interface Pattern { verb: string; source: string; route: string; re: RegExp }

/**
 * A `(unmatched)` row would match every URL and make this whole suite vacuous,
 * so it is excluded here and re-asserted absent below ("guard the guard").
 *
 * The one row that ever had this shape — the `__api-endpoint` catch-all for
 * metadata-declared `apis:` — was REMOVED in #4936, because nothing served it:
 * the branch behind it called a `matchEndpoint` no implementation provided.
 * The exclusion stays as a standing rule, not as a description of a live row:
 * the endpoint executor is being built (#5040), and if it ever re-enters the
 * ledger it must arrive as enumerated routes, never as a catch-all.
 */
const UNUSABLE_ROWS = new Set(['* (unmatched)']);

function compile(route: string, prefix: string, source: string): Pattern[] {
  const sp = route.indexOf(' ');
  const verb = route.slice(0, sp);
  const path = route.slice(sp + 1);

  const body = (prefix + path)
    .split('/')
    .map((seg) => {
      if (seg === '**') return '.*';
      if (seg.startsWith(':') && seg.endsWith('?')) return null; // optional — handled below
      if (seg.startsWith(':')) return '[^/]+';
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });

  // A trailing `:param?` makes the whole segment (with its slash) optional.
  const optionalTail = body[body.length - 1] === null;
  const head = (optionalTail ? body.slice(0, -1) : body).join('/');
  const src = `^${head}${optionalTail ? '(?:/[^/]+)?' : ''}$`;

  const pats: Pattern[] = [{ verb, source, route, re: new RegExp(src) }];

  // Every surface additionally mirrors its routes under the environment scope
  // when project scoping is on (rest-server registerRoutes, the dispatcher's
  // scoped automation mounts) — that mirror is a mechanical duplication and is
  // deliberately not re-ledgered, so it is generated here instead.
  if (src.startsWith('^/api/v1')) {
    pats.push({
      verb,
      source: `${source} (env-scoped mirror)`,
      route: route.replace('/api/v1', '/api/v1/environments/:environmentId'),
      re: new RegExp(src.replace('^/api/v1', '^/api/v1/environments/[^/]+')),
    });
  }
  return pats;
}

const PATTERNS: Pattern[] = [
  // `absolute` rows carry their own wire path and must NOT be prefixed —
  // `/.well-known/*` lives at the site root by definition, and prefixing it
  // here would compile a pattern nothing serves, i.e. certify a URL that does
  // not exist (#7526).
  ...ROUTE_LEDGER.filter((r) => !UNUSABLE_ROWS.has(r.route))
    .flatMap((r) => compile(r.route, r.absolute ? '' : '/api/v1', 'dispatcher')),
  ...REST_ROUTE_LEDGER.map((r) => r.route).flatMap((r) => compile(r, '', 'rest')),
  ...STORAGE_ROUTE_LEDGER.map((r) => r.route).flatMap((r) => compile(r, '', 'storage')),
  ...I18N_ROUTE_LEDGER.map((r) => r.route).flatMap((r) => compile(r, '', 'i18n')),
  ...AUTH_ROUTE_LEDGER.map((r) => r.route).flatMap((r) => compile(r, '', 'auth')),
]
  // Exact rows before wildcard families, so a URL that a real route covers is
  // never CREDITED to a `**` prefix claim that happens to sit earlier in the
  // list. Without this, adding the auth ledger would change nothing: every
  // `/api/v1/auth/*` URL would still be absorbed by the dispatcher's
  // `* /auth/**` row and keep counting as weak evidence.
  .sort((a, b) => Number(a.route.includes('**')) - Number(b.route.includes('**')));

function matches(verb: string, path: string): Pattern | undefined {
  return PATTERNS.find((p) => (p.verb === '*' || p.verb === verb) && p.re.test(path));
}

/**
 * The control plane. `/api/v1/cloud/*` is served by the sibling `cloud` repo,
 * not by anything in this one — this repo's dispatcher explicitly REFUSES those
 * paths (`http-dispatcher.ts`: "Guard against matching control-plane routes
 * like /cloud/environments"). No in-repo ledger can vouch for them, so they are
 * exempt here.
 *
 * NO LONGER UNGUARDED — guarded on the OTHER side of the boundary (#3655).
 * `cloud`'s `packages/service-cloud/src/cloud-route-ledger.ts` gives all 90
 * routes its artifact API plugin mounts a reviewed disposition, and
 * `projects-namespace-coverage.test.ts` there drives this very SDK with a
 * recording `fetch` and matches every `projects.*` URL against it. That had to
 * live in `cloud`: it depends on this repo, never the reverse, so the cloud
 * repo is the only place the mounted route set and the SDK are both in scope.
 * The exemption below stays because THIS suite still cannot see those routes —
 * it is a statement about where the coverage lives, not that there is none.
 *
 * That guard immediately found `projects.listTemplates` building
 * `/api/v1/cloud/templates`, which no registrar in either repo mounts — the
 * sixth instance of the class above, and the first one only a cross-repo guard
 * could see. The method has since been deleted (#3702): the route was never
 * mounted anywhere, so there was nothing to reconcile it against.
 *
 * Exempt by PREFIX, and bounded from both ends: the assertions below pin which
 * methods are allowed to use it, so the hole cannot quietly widen into a place
 * to park an unmatched URL.
 */
const CONTROL_PLANE = '/api/v1/cloud/';
const CONTROL_PLANE_NAMESPACE = 'projects.';

/**
 * The AI plane. `/api/v1/ai/*` is served by `service-ai`, a Cloud/EE package in
 * the sibling `cloud` repo; this repo's dispatcher only PROXIES the prefix to
 * whatever `buildAIRoutes()` mounted (or 501s when that package is absent).
 * No in-repo ledger can enumerate that table, so — exactly like the control
 * plane above — the prefix is exempt HERE and guarded THERE.
 *
 * READ THE HISTORY BEFORE WIDENING THIS. `/api/v1/ai/` used to be matched by
 * the dispatcher's `* /ai/**` wildcard row, and that was worse than no match:
 * a wildcard claims the FAMILY, so `ai.nlq` / `ai.suggest` / `ai.insights`
 * counted as matched when not one of their URLs was in the real table at all.
 * Three SDK methods 404ed for years behind a green row (#3718). v17 deleted
 * them; #3718 then expressed the surface that does exist (`ai.chat`,
 * `ai.chatStream`, `ai.complete`, `ai.models`, `ai.conversations.*`, and since
 * the follow-up pass `ai.agents.*` and `ai.pendingActions.*`), which is why an
 * exemption is needed again.
 *
 * It is NOT a wave-through, for the same reason the control plane's is not:
 * `cloud`'s `packages/service-ai/src/ai-route-ledger.conformance.test.ts`
 * drives every `ai.*` method on this very SDK against the tables its route
 * builders really return — so an `ai.*` URL that stops resolving fails a test
 * in the repo that mounts the route. What this exemption says is "the evidence
 * lives on the other side of the boundary", not "no evidence needed".
 *
 * That ledger covered ONE builder when this comment was first written. It now
 * covers all seven plus the family's one out-of-package member, which is what
 * makes `ai.agents.*` and `ai.pendingActions.*` checkable at all: their routes
 * are mounted by `buildAgentRoutes()` and `buildPendingActionRoutes()`, not by
 * `buildAIRoutes()`.
 *
 * Bounded from both ends below: only `ai.*` may use it, and the namespace must
 * still be reaching it.
 */
const AI_PLANE = '/api/v1/ai/';
const AI_PLANE_NAMESPACE = 'ai.';

// ---------------------------------------------------------------------------
// 2. The recorder
// ---------------------------------------------------------------------------

interface Recorded { verb: string; url: string }

/**
 * Response permissive enough that a method reaches its LAST request rather
 * than throwing at its first. Methods needing a sharper body carry an
 * `expect`-shaped override in DRIVE below.
 */
function makeResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([]),
    arrayBuffer: async () => new ArrayBuffer(0),
    clone() { return this as Response; },
  } as unknown as Response;
}

function createRecordingClient(body: unknown) {
  const calls: Recorded[] = [];
  const client = new ObjectStackClient({
    baseUrl: BASE,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ verb: (init?.method ?? 'GET').toUpperCase(), url: String(input) });
      return makeResponse(body);
    },
  });
  return { client, calls };
}

// ---------------------------------------------------------------------------
// 3. The surface sweep
// ---------------------------------------------------------------------------

/** Dotted paths of every callable reachable on a client instance. */
function enumerateMethods(client: object): string[] {
  const found: string[] = [];
  const walk = (obj: Record<string, unknown>, prefix: string, depth: number) => {
    if (depth > 3) return;
    for (const key of Object.keys(obj)) {
      if (key.startsWith('_')) continue;
      let value: unknown;
      try { value = obj[key]; } catch { continue; }
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'function') found.push(path);
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value as Record<string, unknown>, path, depth + 1);
      }
    }
  };
  walk(client as Record<string, unknown>, '', 0);
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(client))) {
    if (key === 'constructor' || key.startsWith('_')) continue;
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(client), key);
    if (d && typeof d.value === 'function') found.push(key);
  }
  return found.sort();
}

/**
 * Methods that legitimately put nothing on the wire. Every entry is a REASON,
 * not a mute: a method parked here is claiming it makes no HTTP request, and
 * assertion 2 below is what stops that claim from being used to hide a broken
 * call — a `NON_HTTP` method that DOES fetch is itself a failure.
 */
const NON_HTTP: Record<string, string> = {
  'fetch': 'the transport itself',
  'getRoute': 'pure route-table lookup',
  'unwrapResponse': 'pure envelope unwrap',
  'isFilterAST': 'pure type predicate',
  'project': 'constructs a ScopedProjectClient; its methods are swept separately',
  'setProjectId': 'local state',
  'getProjectId': 'local state',
  'setLocale': 'local state',
  'getLocale': 'local state',
  'fetchImpl': 'the injected transport',
};

/**
 * Overrides for methods a bare placeholder cannot drive: those building the
 * URL out of a FIELD of an object argument, and the composite flows whose
 * later requests are addressed by the earlier responses.
 *
 * Kept deliberately small. Every entry is a place the generic driver stopped
 * working, and the malformed/silent assertions below are what force one to be
 * written rather than letting the method fall out of coverage.
 */
interface Drive { args?: unknown[]; body?: unknown; browser?: boolean }
const DRIVE: Record<string, Drive> = {
  'auth.verifyEmail': { args: [{ token: 'tok' }] },
  // Guards on `window` and throws in node BEFORE fetching. It is a real HTTP
  // method, so it gets a browser stub rather than a NON_HTTP exemption —
  // parking it there would drop a live call out of coverage, which is the
  // exact rot this suite exists to prevent.
  'auth.signInWithProvider': { args: ['github'], browser: true },
  'storage.completeChunkedUpload': { args: [{ uploadId: 'up1', parts: [] }] },
  // The composite upload: presign → PUT the returned uploadUrl → commit. Hop 2
  // is addressed by hop 1's response, so the body has to carry a real target.
  // Pointed at the local driver's loopback (a ledgered route) rather than an
  // S3 URL, so all three hops stay in scope for the match below.
  'storage.upload': {
    args: [{ name: 'a.png', type: 'image/png', size: 1 }, 'user'],
    body: {
      success: true,
      data: { uploadUrl: `${BASE}/api/v1/storage/_local/raw/tok`, method: 'PUT', headers: {}, fileId: 'f1', expiresIn: 60 },
    },
  },
  // Resume reads progress, re-PUTs the outstanding chunks, then completes.
  'storage.resumeUpload': {
    args: ['up1', new ArrayBuffer(8), 8, 'rtok'],
    body: { success: true, data: { totalChunks: 1, uploadedChunks: 0, eTag: 'e1' } },
  },
};

/** Placeholder positional args — enough for the id-in-path majority. */
function autoArgs(fn: (...a: unknown[]) => unknown): unknown[] {
  return Array.from({ length: fn.length }, (_, i) => `p${i + 1}`);
}

/**
 * Resolve a dotted path to its function AND its owner. Namespace methods are
 * arrow functions that closed over `this`, but the top-level ones live on the
 * prototype and lose `this` when plucked off by name — calling those unbound
 * makes them throw before fetching, which would quietly read as "emits no
 * request" and drop them from the sweep.
 */
function resolve(client: object, path: string): { fn: (...a: unknown[]) => unknown; owner: object } {
  const keys = path.split('.');
  let owner: object = client;
  for (const k of keys.slice(0, -1)) owner = (owner as Record<string, object>)[k];
  return { fn: (owner as Record<string, (...a: unknown[]) => unknown>)[keys[keys.length - 1]], owner };
}

/** Run `body` with a minimal `window` in place, for browser-guarded methods. */
async function withBrowser<T>(enabled: boolean, body: () => Promise<T>): Promise<T> {
  if (!enabled) return body();
  const g = globalThis as Record<string, unknown>;
  const had = 'window' in g;
  const prev = g.window;
  g.window = { location: { href: `${BASE}/app`, origin: BASE } };
  try { return await body(); } finally { if (had) g.window = prev; else delete g.window; }
}

// ---------------------------------------------------------------------------

describe('client URL conformance ↔ the union of all four route ledgers (#3642)', () => {
  const probe = createRecordingClient({ success: true, data: {} });
  const METHODS = enumerateMethods(probe.client).filter((m) => !(m in NON_HTTP));

  it('the ledger union compiles to a usable pattern set', () => {
    expect(PATTERNS.length).toBeGreaterThan(100);
    // Guard the guard: if `(unmatched)` ever slipped in, every URL would match
    // and this suite would pass while asserting nothing.
    expect(PATTERNS.some((p) => p.route.includes('(unmatched)'))).toBe(false);
  });

  it('every client method is classified — driven or explicitly non-HTTP', () => {
    const all = enumerateMethods(probe.client);
    const unclassified = all.filter((m) => !(m in NON_HTTP) && !METHODS.includes(m));
    expect(
      unclassified,
      `client methods neither driven nor declared NON_HTTP: ${unclassified.join(', ')}`,
    ).toEqual([]);
    expect(METHODS.length, 'the sweep should cover the whole SDK surface').toBeGreaterThan(150);
  });

  it('every URL the SDK builds matches a route some surface mounts', async () => {
    const unmatched: string[] = [];
    const silent: string[] = [];
    const malformed: string[] = [];
    const controlPlane: string[] = [];
    const aiPlane: string[] = [];
    const wildcardOnly: string[] = [];

    for (const name of METHODS) {
      const drive = DRIVE[name] ?? {};
      const { client, calls } = createRecordingClient(drive.body ?? { success: true, data: {} });
      const { fn, owner } = resolve(client, name);
      const args = drive.args ?? autoArgs(fn);
      try {
        await withBrowser(drive.browser === true, async () => fn.apply(owner, args));
      } catch {
        // A throw after the request still counts — the URL is already recorded.
      }
      if (calls.length === 0) { silent.push(name); continue; }

      for (const call of calls) {
        if (/undefined|\[object Object\]|NaN/.test(call.url)) {
          malformed.push(`${name} → ${call.url}`);
          continue;
        }
        const path = new URL(call.url, BASE).pathname;
        if (path.startsWith(CONTROL_PLANE)) { controlPlane.push(`${name} → ${call.verb} ${path}`); continue; }
        // Checked BEFORE `matches()` on purpose: the dispatcher's `* /ai/**`
        // row would otherwise absorb these into `wildcardOnly` — the exact
        // false-positive evidence that hid three dead methods (#3718).
        if (path.startsWith(AI_PLANE)) { aiPlane.push(`${name} → ${call.verb} ${path}`); continue; }
        const hit = matches(call.verb, path);
        if (!hit) { unmatched.push(`${name} → ${call.verb} ${path}`); continue; }
        if (hit.route.includes('**')) wildcardOnly.push(`${name} → ${call.verb} ${path} (via ${hit.route})`);
      }
    }

    expect(
      malformed,
      'placeholder args produced a malformed URL — give these an ARGS override so the sweep really covers them:\n' +
        malformed.join('\n'),
    ).toEqual([]);

    expect(
      silent,
      'these methods emitted NO request, so the sweep does not cover them — fix the args ' +
        'via ARGS or declare them NON_HTTP with a reason:\n' + silent.join('\n'),
    ).toEqual([]);

    expect(
      unmatched,
      'SDK methods whose URL matches no route on ANY surface — these are wire-level 404s ' +
        'of the #3584 / #3611 / #3636 class:\n' + unmatched.join('\n'),
    ).toEqual([]);

    // The control-plane hole, bounded from the other end: only `projects.*` may
    // use it. Anything else reaching /api/v1/cloud/ is a method that has wandered
    // off the data plane, and must not inherit this exemption.
    const trespassers = controlPlane.filter((e) => !e.startsWith(CONTROL_PLANE_NAMESPACE));
    expect(
      trespassers,
      `non-projects methods targeting the control plane, which no in-repo ledger can vouch for:\n${trespassers.join('\n')}`,
    ).toEqual([]);
    expect(controlPlane.length, 'the projects namespace should still be reaching the control plane').toBeGreaterThan(0);

    // The AI-plane hole, bounded the same way: only `ai.*` may use it. The
    // count assertion is the half that matters most here — if the namespace
    // stopped issuing requests, the exemption would silently become a hole
    // with nothing behind it, which is how the wildcard row went wrong.
    const aiTrespassers = aiPlane.filter((e) => !e.startsWith(AI_PLANE_NAMESPACE));
    expect(
      aiTrespassers,
      `non-ai methods targeting /api/v1/ai/, which no in-repo ledger can vouch for:\n${aiTrespassers.join('\n')}`,
    ).toEqual([]);
    expect(
      aiPlane.length,
      'the ai namespace should be reaching the AI plane — if it stops, drop the exemption',
    ).toBeGreaterThan(0);


    // HOW STRONG IS THIS GUARD, HONESTLY. A `**` row asserts only that a prefix
    // family is CLAIMED, not that the specific URL resolves. That was this
    // guard's biggest weakness at #3642: 60 of ~196 matched calls rested on
    // nothing better, 54 of them on `* /auth/**`. #3656 enumerated better-auth's
    // real route table, so those now match exact rows and the bound fell 60 → 3.
    // The last 3 were `ai.nlq/suggest/insights` on `* /ai/**`, and enumerating
    // THAT family (#3718, in `cloud`, where service-ai lives) showed the
    // wildcard had not been weak evidence but WRONG evidence: none of the three
    // URLs is in the real table, and nothing in any repo mounts them (#3718).
    // v17 removed that namespace; #3718 then expressed the real one, which is
    // reached through the bounded AI-plane exemption above — NOT through the
    // wildcard row, so the bound below still stands at 0.
    //
    // ZERO IS THE POINT: every remaining matched call rests on an exact route
    // some ledger enumerated. Raising this bound reintroduces the one kind of
    // evidence this audit family has caught being wrong.
    expect(
      wildcardOnly.length,
      'methods matched only by a wildcard `**` family — weaker evidence than an exact ' +
        `route, and demonstrably able to be wrong (#3718). Enumerate the family instead:\n${wildcardOnly.join('\n')}`,
    ).toBe(0);
  });
});
