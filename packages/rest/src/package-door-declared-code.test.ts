// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12405] The direct-mount package door carries a DEMOTED producer spelling
 * on the wire's `declaredCode`, instead of dropping the one it was holding.
 *
 * ## The defect
 *
 * `sendThrownError` (`package-routes.ts`) resolves every throw through the
 * shared ADR-0112 rule and then forwarded `{ details }` and nothing else:
 *
 * ```ts
 * const thrown = resolveThrownHttpError(error);
 * sendError(res, thrown.status, thrown.code, message,
 *           thrown.details ? { details: thrown.details } : undefined);
 * ```
 *
 * `resolveThrownHttpError` answers `declaredCode` whenever the producer spelled
 * a code the ledger does not know, so the demoted spelling sat in that local
 * and was dropped one line later. Nothing invalid shipped — the closed `code`
 * still carried the member the status derives — which is what made the loss
 * silent and one-directional: the author's spelling gone, and a consumer told
 * by ADR-0112 to read `declaredCode` finding nothing there.
 *
 * ## Why this door, and why it is a DISAGREEMENT rather than an omission
 *
 * `/api/v1/packages` has two transports, and the module note in
 * `package-routes.ts` records that this direct-mount registrar registers FIRST
 * — so for the three routes both declare it is the one production serves. The
 * twin, the runtime dispatcher domain (`packages/runtime/src/domains/packages.ts`),
 * answers every catch through `errorFromThrown`
 * (`packages/runtime/src/http-dispatcher.ts`), which has emitted exactly this
 * channel since #9106:
 *
 * ```ts
 * const declaredCode = demotedDeclaredCode(thrown);
 * const extra = { ...(declaredCode !== undefined ? { declaredCode } : {}), … };
 * ```
 *
 * The flat `/data` door does the same through `thrownCodeFields`
 * (`error-response.ts`, #9232). So the repair here ADOPTS a rule two sibling
 * doors already apply; it does not invent one. What is pinned below is that
 * this door reads the SHARED rule rather than growing a third copy of it.
 *
 * ## Reachability, measured rather than assumed
 *
 * Two facts, and they are different claims:
 *
 *  - **The channel is live at this door.** Every producer reaching
 *    `sendThrownError` is injected — the `PackageService` is resolved from the
 *    service registry per request (#7563), the `protocol` slice is duck-typed
 *    into `PackageRoutesOptions`, and `resolveExecutionContext` is handed in by
 *    the composition step. The door forwards whatever they throw, so the
 *    demote fires on any spelling outside `@objectstack/spec`'s ledger.
 *    Section 1 drives all four seams through the real registrar — but
 *    ⚠️ only THREE of the four are production producers; the
 *    `resolveExecutionContext` seam is a TEST-ONLY injection point. See
 *    **Seam census** below, which is the one place that reason is stated.
 *
 *  - **The framework's OWN producers do not populate it, by GATE.**
 *    `pnpm check:dispatcher-error-vocabulary` (`dispatcher-error-vocabulary.ts`)
 *    fails on an unswept platform producer precisely so a platform semantic
 *    code cannot silently demote off the wire. Measured on this checkout: every
 *    status-declaring coded throw reachable at the three PRODUCTION seams
 *    (**Seam census** below) spells a REGISTERED code. That is the point of the gate, not an argument that the
 *    channel is dead — it leaves `declaredCode`'s live population as the limb
 *    no ledger can enumerate: a metadata app's own thrown `.code` across the
 *    QuickJS boundary (#7867) and a downstream repo's codes, which the ledger's
 *    federation ruling (2026-08-03/09) keeps out of this ledger BY DESIGN.
 *
 * ## ⭐ Seam census: THREE production seams, plus ONE test-only injection
 *
 * `SITES` below drives FOUR seams. Three are producers a deployment can
 * actually reach; the fourth is an injection point that exists only in a test.
 * Stated ONCE here and cited from the sites that depend on it, rather than
 * restated at each.
 *
 * Measured on `origin/main` @ `aa5994e17` by reading the composition rather
 * than inferring it:
 *
 *  - `rest-api-plugin.ts:471` is the ONLY production supplier of this option,
 *    repo-wide: `resolveExecutionContext: (req) =>
 *    restServer.resolvePackageRouteExecutionContext(req)`.
 *  - `rest-server.ts:1481` — `resolvePackageRouteExecutionContext` is NOT
 *    `async`. Its whole body is an optional-chained
 *    `req?.params?.environmentId` read, then `return
 *    this.resolveExecCtx(environmentId, req).catch(() => undefined)`.
 *  - `rest-server.ts:1453` — `private async resolveExecCtx(...)`. Being
 *    `async`, calling it cannot throw SYNCHRONOUSLY; it always returns a
 *    promise.
 *  - `package-routes.ts:81` — the consumer then `await`s
 *    `options.resolveExecutionContext(req).catch(() => undefined)`, swallowing
 *    a rejection a SECOND time.
 *
 * ⇒ A production resolver delivers exactly two things: a context, or
 * `undefined`. Its rejections are swallowed twice and land on the
 * anonymous-deny floor as a 401 — they never reach `sendThrownError`. The
 * ONLY route from this seam to `sendThrownError` is a SYNCHRONOUS throw (it
 * happens before `.catch` is attached, so it rejects `refusePackageRequest`
 * itself and the handler's `try` catches it) — and the production wrapper
 * above has no statement that can make one.
 *
 * ⚠️ Nor can an embedder reach it: `registerPackageRoutes` and
 * `PackageRoutesOptions` are NOT exported from `packages/rest/src/index.ts`
 * (the package publishes a single `.` entry, and `direct-mount-composition.ts`
 * is their only importer), so no downstream composition can supply a resolver
 * of its own here either.
 *
 * ⛔ The `resolveExecutionContext` case is KEPT anyway, deliberately. It
 * pins something real — how this door answers when an injected resolver
 * throws synchronously — and `reached()` keeps it from going vacuous. It
 * simply is not evidence about a PRODUCTION path, so nothing in this file may
 * cite it as one. Deleting a test to make a census true would be the census
 * lying in the other direction.
 *
 * ⛔ Whether that double swallow SHOULD exist at all is a different
 * question — it would change what a public door emits — and it is open
 * at #12537, deliberately not answered here. Note for whoever takes it: the
 * swallow is documented at NEITHER site, so "deliberate" is not established by
 * the code as it stands.
 *
 * Section 5 is the second fact stated as a test: a REAL `ObjectQL`, a REAL
 * `ObjectStackProtocolImplementation` and a failing driver, driven through the
 * route a client calls, answer a REGISTERED `SERVICE_UNAVAILABLE` and therefore
 * carry NO `declaredCode`. It is this suite's proof that the instrument can say
 * no on a real path — a suite that only ever asserted presence would be green
 * for an implementation that stamped `declaredCode` on every refusal, which is
 * the exact invariant `ApiErrorSchema.declaredCode` forbids.
 *
 * ## Reverse verification, and the half the prediction got wrong
 *
 * Predicted before running: reverting `sendThrownError` to its pre-#12405
 * forward turns sections 1, 3 and 4 RED (they assert the POSITIVE spelling on
 * the wire) and leaves sections 2 and 5 GREEN, those being the ABSENCE
 * assertions the unrepaired door also satisfies.
 *
 * ⚠️ [#12509] The numbers below record a run against THIS FILE'S PRE-#12509
 * row set (the third `DEMOTED` row and the `SHAPES` table have both moved
 * since), so re-running the ablation today will not reproduce 155.
 *
 * Measured: 30 failed / 125 passed of 155. Sections 1, 3 and 4 went red as
 * predicted — and so did the CONVERGENCE block of section 5, which the
 * prediction had lumped in with its real-producer sibling. It was wrong to:
 * that block compares the wire against `demotedDeclaredCode` for six shapes,
 * four of which demote, so it is a positive assertion for those and red is the
 * correct answer. What stayed green is what actually asserts absence — the
 * whole of section 2, section 3's registered-code case, and section 5's
 * real-producer walk. `package-routes-coded-error-mapping.test.ts` contributed
 * 4 of the 30, which is that file's own new `declaredCode` line at the four
 * seams.
 *
 * Recorded rather than smoothed over, because the wrong half is the useful
 * half: "asserts absence" is the property that predicts green here, not "is
 * numbered 5", and a reader re-running this ablation should expect 30.
 *
 * ## What is deliberately NOT asserted
 *
 * That the body "has one more field", or that `declaredCode` is merely
 * "defined". Both pass for a door that stamps the raw `thrown.declaredCode` —
 * which is the one shape the shared rule exists to prevent, because it puts two
 * spellings of one fact on every REGISTERED refusal. Section 2 asserts the
 * absence directly, on codes that ARE ledger members.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  resolveThrownHttpError,
  demotedDeclaredCode,
  INTERNAL_ERROR_MESSAGE,
} from '@objectstack/types';
import { registerPackageRoutes } from './package-routes.js';

const PKGS = '/api/v1/packages';

interface Captured {
  status: number;
  body: any;
}

/** A caller holding every capability these routes gate on. */
const CLEARS_THE_GATE = async () => ({
  userId: 'u_pkg',
  systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
});

function mount(svc: Record<string, unknown>, options: Record<string, unknown> = {}) {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT:${p}`, h); },
    delete: (p: string, h: RouteHandler) => { routes.set(`DELETE:${p}`, h); },
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  } as any;
  registerPackageRoutes(server, () => svc as any, '/api/v1', {
    resolveExecutionContext: CLEARS_THE_GATE,
    ...options,
  } as any);
  return routes;
}

async function drive(
  routes: Map<string, RouteHandler>,
  method: string,
  path: string,
  req: Record<string, any> = {},
): Promise<Captured> {
  const handler = routes.get(`${method}:${path}`);
  if (!handler) throw new Error(`no handler for ${method} ${path}`);
  const captured: Captured = { status: 0, body: undefined };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler(
    { params: {}, query: {}, body: undefined, headers: {}, method, path, ...req } as any,
    res,
  );
  return captured;
}

/**
 * Every assertion an answer from this door must satisfy, spelled once and
 * IMPORTED from `packages/spec` rather than restated — a body that parses here
 * is one the wire contract accepts, `declaredCode` included.
 */
function expectDeclaredEnvelope(captured: Captured): any {
  expect(BaseResponseSchema.safeParse(captured.body).success).toBe(true);
  expect(envelopeViolations(captured.body)).toEqual([]);
  expect(captured.body?.success).toBe(false);
  const parsed = ApiErrorSchema.safeParse(captured.body?.error);
  expect(parsed.error?.issues ?? []).toEqual([]);
  expect(parsed.success).toBe(true);
  return captured.body.error;
}

/** A thrown error carrying whatever a producer declares on it. */
function thrown(message: string, carried: Record<string, unknown>): Error {
  return Object.assign(new Error(message), carried);
}

const MANIFEST = { id: 'com.acme.crm', version: '1.0.0' };

/**
 * One catch site, plus the seam that drives a throw INTO it and a witness that
 * the throw really travelled that way. Same four seams as
 * `package-routes-coded-error-mapping.test.ts`, for the same reason: a case
 * that silently never reached the seam would otherwise "pass" on a body it got
 * for a completely different reason.
 *
 * ⚠️ Four seams, THREE of them production. The
 * `resolveExecutionContext` entry is the test-only one — see **Seam census**
 * in the module docblock, the single place that reason is stated.
 */
interface Site {
  name: string;
  run: (error: unknown) => Promise<{ captured: Captured; reached: () => boolean }>;
}

const SITES: Site[] = [
  {
    name: 'POST /packages/publish — packageService.publish throws',
    run: async (error: unknown) => {
      const publish = vi.fn(async () => { throw error; });
      const captured = await drive(
        mount({ publish }),
        'POST',
        `${PKGS}/publish`,
        { body: { manifest: MANIFEST, metadata: { author: 'acme' } } },
      );
      return { captured, reached: () => publish.mock.calls.length === 1 };
    },
  },
  {
    // ⚠️ TEST-ONLY INJECTION POINT — NOT a production seam, and ⛔ not to
    // be counted as one. A production resolver cannot throw synchronously and
    // its rejections are swallowed twice before this door sees them; the
    // measurement is in **Seam census** in the module docblock. Kept because
    // it pins real door behaviour (and `reached()` keeps it honest).
    // ⚠️ The `vi.fn` below is deliberately NOT `async`: an `async` one
    // would REJECT, and `package-routes.ts:81` would swallow that into the
    // 401 anonymous-deny floor instead of reaching `sendThrownError`.
    name: 'GET /packages — the capability gate resolver throws',
    run: async (error: unknown) => {
      const resolveExecutionContext = vi.fn(() => { throw error; });
      const captured = await drive(
        mount({ list: async () => [] }, { resolveExecutionContext }),
        'GET',
        PKGS,
      );
      return { captured, reached: () => resolveExecutionContext.mock.calls.length === 1 };
    },
  },
  {
    name: 'GET /packages/:id — packageService.get throws',
    run: async (error: unknown) => {
      const get = vi.fn(async () => { throw error; });
      const captured = await drive(
        mount({ get }),
        'GET',
        `${PKGS}/:id`,
        { params: { id: 'com.acme.crm' } },
      );
      return { captured, reached: () => get.mock.calls.length === 1 };
    },
  },
  {
    name: 'DELETE /packages/:id — packageService.delete throws',
    run: async (error: unknown) => {
      const del = vi.fn(async () => { throw error; });
      const captured = await drive(
        mount({ delete: del }),
        'DELETE',
        `${PKGS}/:id`,
        { params: { id: 'com.acme.crm' } },
      );
      return { captured, reached: () => del.mock.calls.length === 1 };
    },
  },
];

// ---------------------------------------------------------------------------
// 1. The demote reaches the wire, at every seam this suite drives
//    (three production producers + one test-only injection — Seam census)
// ---------------------------------------------------------------------------

describe('[#12405] an UNREGISTERED producer spelling rides `declaredCode`', () => {
  /**
   * Two spellings of the status channel, because both are produced in this
   * repo (`metadata-protocol` throws `status`, runtime action execution and
   * the lifecycle hooks throw `statusCode`), and a declared 5xx — the band
   * where the demote and the 5xx sanitisation regime meet.
   *
   * ⚠️ [#12509] The third row used to be a throw whose status the resolver had
   * to DEFAULT ("names the condition but not the band"). That shape no longer
   * demotes to the wire: the 2026-08-27 ruling withholds a code the
   * fallback-to-500 picked up from an undeclared producer, because a driver
   * errno arrives on exactly that shape and naming the backend is one of the
   * two disclosures the 5xx message withhold exists to prevent. It is replaced
   * by a producer that declares the 5xx it means, which keeps its spelling.
   * ⛔ Do not restore the old row here — the withhold has its own pin, in
   * `package-door-5xx-demoted-code-withhold.test.ts`, and a second copy of the
   * shape in this file would make one ruling readable in two voices.
   */
  const DEMOTED: Array<{ name: string; error: unknown; status: number; code: string; declaredCode: string }> = [
    {
      name: 'an app spelling on a declared 409 (`status`)',
      error: thrown('invoices still open', { status: 409, code: 'CLOSE_PERIOD_LOCKED' }),
      status: 409,
      code: 'RESOURCE_CONFLICT',
      declaredCode: 'CLOSE_PERIOD_LOCKED',
    },
    {
      name: 'an app spelling on a declared 403 (`statusCode`)',
      error: thrown('seat count exceeded', { statusCode: 403, code: 'ORG_LICENCE_INVALID' }),
      status: 403,
      code: 'PERMISSION_DENIED',
      declaredCode: 'ORG_LICENCE_INVALID',
    },
    {
      name: 'an app spelling on a DECLARED 500 — the author channel survives 5xx sanitisation (#12509)',
      error: thrown('the importer gave up', { status: 500, code: 'ACME_IMPORT_ABORTED' }),
      status: 500,
      code: 'INTERNAL_ERROR',
      declaredCode: 'ACME_IMPORT_ABORTED',
    },
  ];

  for (const site of SITES) {
    for (const demoted of DEMOTED) {
      it(`${site.name}: ${demoted.name}`, async () => {
        const { captured, reached } = await site.run(demoted.error);

        // Anti-vacuity: the throw really travelled through the seam under test.
        expect(reached(), 'the throwing seam was never called').toBe(true);

        const error = expectDeclaredEnvelope(captured);
        // ADR-0112, all three channels at once. `code` stays the CLOSED
        // member — the demote must not re-open the vocabulary — and the
        // producer's own string arrives beside it rather than instead of it.
        expect(captured.status).toBe(demoted.status);
        expect(error.code).toBe(demoted.code);
        expect(error.declaredCode).toBe(demoted.declaredCode);
      });
    }
  }

  it('the three shapes above really do produce different answers', () => {
    // Anti-vacuity for the table itself: three rows that collapsed to one
    // answer would agree with any implementation.
    const answers = DEMOTED.map((d) => `${d.status} ${d.code} ${d.declaredCode}`);
    expect(new Set(answers).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 2. Presence MEANS demotion — the half a "field is defined" assertion misses
// ---------------------------------------------------------------------------

describe('[#12405] `declaredCode` is ABSENT unless the demote actually happened', () => {
  /**
   * `ApiErrorSchema.declaredCode`'s documented invariant: a consumer that sees
   * this field knows the producer spelled a code the serving side's ledger does
   * not know. A door that forwarded the raw `thrown.declaredCode` would satisfy
   * every case in section 1 and break this one — the resolver sets that field
   * for a REGISTERED spelling too, because it records what the producer wrote,
   * not what survived. `demotedDeclaredCode` is the read that tells them apart.
   */
  const ABSENT: Array<{ name: string; error: unknown; status: number; code: string }> = [
    {
      name: 'a REGISTERED code is already in `code` — repeating it would be two spellings of one fact',
      error: thrown('uninstalling drops 3 tables', { status: 409, code: 'DESTRUCTIVE_CHANGE' }),
      status: 409,
      code: 'DESTRUCTIVE_CHANGE',
    },
    {
      name: 'a REGISTERED standard-catalog code, same rule',
      error: thrown('package scope is required', { status: 400, code: 'TENANT_SCOPE_REQUIRED' }),
      status: 400,
      code: 'TENANT_SCOPE_REQUIRED',
    },
    {
      name: 'a producer that declared NO code has nothing to declare',
      error: new Error('kaboom'),
      status: 500,
      code: 'INTERNAL_ERROR',
    },
    {
      name: 'a NON-string `code` is context, not a wire spelling (the #3842 drift)',
      error: thrown('driver errno', { status: 500, code: 1234 }),
      status: 500,
      code: 'INTERNAL_ERROR',
    },
  ];

  for (const site of SITES) {
    for (const absent of ABSENT) {
      it(`${site.name}: ${absent.name}`, async () => {
        const { captured, reached } = await site.run(absent.error);

        expect(reached(), 'the throwing seam was never called').toBe(true);

        const error = expectDeclaredEnvelope(captured);
        expect(captured.status).toBe(absent.status);
        expect(error.code).toBe(absent.code);
        // Absent, not `undefined`-valued: a key present with `undefined`
        // survives `JSON.stringify` as an omission here but would not through
        // every transport, and "presence means demotion" is a statement about
        // the KEY.
        //
        // `in` rather than `Object.hasOwn`, and not by taste: this package's
        // test layer compiles against a `lib` older than es2022 (the same
        // ceiling its TEST_DEBT entry records as TS2550 x16 for
        // `Array.prototype.at`), so `Object.hasOwn` is three fresh raw errors
        // in a shrink-only ratchet. Measured, not guessed — it drifted the
        // ledger 155 to 158 before this line was written this way.
        expect('declaredCode' in error).toBe(false);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 3. The channel added did not displace the one already there
// ---------------------------------------------------------------------------

describe('[#12405] `details` and `declaredCode` travel together', () => {
  /**
   * The context channel is the one this helper already forwarded, so these two
   * cases are the regression half: adding a second optional field must not
   * displace the first, and the demote must not start manufacturing context.
   *
   * ⚠️ `details` is DERIVED, not copied: `resolveThrownHttpError` builds it
   * from a throw's `issues[]` / `fields[]` and ignores a hand-hung `details`
   * property (measured — a fixture that hangs one gets `details: undefined`
   * from the resolver, so a case written that way would assert this door drops
   * context it was never handed). The fixtures below therefore spell the real
   * producer shape.
   */
  it('a demoted refusal carrying structured context keeps BOTH', async () => {
    const del = vi.fn(async () => {
      throw thrown('two records still reference this package', {
        status: 409,
        code: 'CLOSE_PERIOD_LOCKED',
        issues: [{ path: 'invoices', message: 'inv_1 is still open' }],
      });
    });
    const captured = await drive(
      mount({ delete: del }),
      'DELETE',
      `${PKGS}/:id`,
      { params: { id: 'com.acme.crm' } },
    );

    expect(del.mock.calls.length, 'the throwing seam was never called').toBe(1);
    const error = expectDeclaredEnvelope(captured);
    expect(captured.status).toBe(409);
    expect(error.code).toBe('RESOURCE_CONFLICT');
    expect(error.declaredCode).toBe('CLOSE_PERIOD_LOCKED');
    expect(error.details).toEqual({
      issues: [{ path: 'invoices', message: 'inv_1 is still open' }],
    });
  });

  it('a refusal with context but a REGISTERED code keeps `details` and gains nothing', async () => {
    const del = vi.fn(async () => {
      throw thrown('uninstalling drops 3 tables', {
        status: 409,
        code: 'DESTRUCTIVE_CHANGE',
        issues: [{ path: 'tables', message: 'crm_account would be dropped' }],
      });
    });
    const captured = await drive(
      mount({ delete: del }),
      'DELETE',
      `${PKGS}/:id`,
      { params: { id: 'com.acme.crm' } },
    );

    expect(del.mock.calls.length, 'the throwing seam was never called').toBe(1);
    const error = expectDeclaredEnvelope(captured);
    expect(error.details).toEqual({
      issues: [{ path: 'tables', message: 'crm_account would be dropped' }],
    });
    expect('declaredCode' in error).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. The 5xx withhold is scoped to the PROSE, and stays that way
// ---------------------------------------------------------------------------

describe('[#12405] the demote is not withheld by the 5xx message sanitiser', () => {
  /**
   * `sendThrownError`'s withhold (#8086) replaces a LEAKY 5xx message with
   * `INTERNAL_ERROR_MESSAGE` and its docblock scopes that deliberately: "Only
   * the PROSE is withheld: `status`, `code` and `details` are untouched."
   * `declaredCode` is a CODE channel, and the dispatcher twin applies no status
   * condition to it either — a condition added here would be a new rule at one
   * door and would re-create the divergence this closes.
   *
   * Pinned as a live case rather than left implicit: it is the one interaction
   * in this change a reader is entitled to see was CHOSEN. If the ruling ever
   * goes the other way, this is where it goes red.
   *
   * ## ⭐ The premise this rests on, and what would falsify it
   *
   * Everything above is the CONSISTENCY argument — one rule, two doors — and
   * it is sound but it is the weaker half. Not withholding here is SAFE, not
   * merely consistent, because of a fact about the producers, and that fact is
   * recorded here because it can rot and is written down nowhere else:
   *
   *   **No producer reaching the three PRODUCTION seams can put a driver
   *   errno in `declaredCode` today, because `PackageService` discriminates on
   *   the STATUS channel and never on `.code`.** (Three, not four — **Seam
   *   census** in the module docblock.)
   *
   * `packages/services/service-package/src/index.ts` is explicit about why:
   * `publish` and `delete` re-throw only what `declaresHttpAnswer(error)`
   * accepts — a declared `status`/`statusCode` — and its own comment states the
   * reason in as many words, that "every SQL driver populates a string `code`
   * on its errors, so reading it would re-throw genuine driver faults as if
   * they were refusals". `get` and `list` re-throw only the branded
   * seam-unreadable refusal (`SERVICE_UNAVAILABLE` / 503). `protocol.deletePackage`
   * escapes only with `TENANT_SCOPE_REQUIRED` or `metadataStoreUnavailableError`.
   * So a bare `SQLITE_ERROR` / `42P01` is swallowed and re-answered long before
   * this door sees it, and the dialect-disclosure shape — a backend's own
   * error class landing in `declaredCode` beside a withheld message — is
   * unreachable rather than tolerated.
   *
   * ⚠️ Which is why the case below spells a PRODUCER-authored code
   * (`WIDGET_STORE_UNREACHABLE`) and not a driver errno: the pinned shape is
   * the one that can actually arrive. Reading this suite as evidence that a
   * driver dialect on the wire is fine would be reading it backwards — nothing
   * here measures that shape, because nothing produces it.
   *
   * ⛔ **The falsifier, stated so the next reader inherits a measurement
   * instead of an argument:** a producer that reaches any of the three
   * PRODUCTION seams carrying a driver errno as its `.code` — a
   * `PackageService` implementation that re-throws on `.code` rather than on
   * status, or a `protocol` slice that lets a raw driver error out of
   * `deletePackage`. On that day the disclosure becomes live, this block's
   * premise is false, and the fork has to be RE-OPENED rather than re-derived
   * from the consistency half above.
   *
   * ⚠️ This list carried a THIRD limb — "or a `resolveExecutionContext`
   * that throws one synchronously" — retired here rather than reworded,
   * because it is unreachable BY CONSTRUCTION and not merely unobserved
   * (**Seam census** in the module docblock). A falsifier that cannot be
   * reached is not a falsifier: it reads as a live way to test this block,
   * and costs the reader who tries it the time to discover it cannot happen.
   * If the swallow at `rest-server.ts:1483` is ever un-done — the half of
   * #12537 still open — this limb becomes real again and belongs back here.
   *
   * Ruled A by the `domain:cli` PM seat on 2026-08-26 on exactly this ground —
   * ⛔ not option B (suppress the demote when the message was withheld), which
   * would invent a third rule at one door and drop the author-authored channel
   * for precisely the metadata-app 5xx refusals ADR-0112 wrote it for. The
   * cross-door question — whether ADR-0112's code channel is in scope for 5xx
   * sanitisation AT ALL, answered once for all three doors — is option C and is
   * a separate card.
   */
  it('a leaky 5xx loses its message and keeps the producer spelling', async () => {
    const publish = vi.fn(async () => {
      throw thrown('SQLITE_ERROR: no such table: sys_packages', {
        status: 500,
        code: 'WIDGET_STORE_UNREACHABLE',
      });
    });
    const captured = await drive(
      mount({ publish }),
      'POST',
      `${PKGS}/publish`,
      { body: { manifest: MANIFEST, metadata: { author: 'acme' } } },
    );

    expect(publish.mock.calls.length, 'the throwing seam was never called').toBe(1);
    const error = expectDeclaredEnvelope(captured);
    expect(captured.status).toBe(500);
    expect(error.code).toBe('INTERNAL_ERROR');
    // The prose is gone…
    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(JSON.stringify(captured.body)).not.toContain('sys_packages');
    // …and the code channel is untouched, exactly as the withhold's own note says.
    expect(error.declaredCode).toBe('WIDGET_STORE_UNREACHABLE');
  });
});

// ---------------------------------------------------------------------------
// 5. The wire answer IS the shared rule, and the instrument can say no
// ---------------------------------------------------------------------------

describe('[#12405] the wire `declaredCode` IS the shared rule, not a second copy', () => {
  /**
   * The literal cases above say what the answers ARE, which is what a reader
   * needs; they do not on their own keep this door with its two siblings. A
   * second demote written here could satisfy every literal above and still
   * diverge on the next throw shape nobody enumerated — which is exactly how
   * the two `/api/v1/packages` doors came to disagree in the first place. So
   * the door is pinned to `demotedDeclaredCode` itself.
   *
   * The dispatcher twin is pinned to the same function from the other side, in
   * `packages/runtime`. The comparison has to be split that way: `rest` cannot
   * import `runtime` (runtime depends on rest), so neither door can see the
   * other. Either one drifting off the shared rule turns one half red.
   */
  const SHAPES: unknown[] = [
    thrown('app spelling, declared 409', { status: 409, code: 'CLOSE_PERIOD_LOCKED' }),
    thrown('app spelling, declared 403 via statusCode', { statusCode: 403, code: 'ORG_LICENCE_INVALID' }),
    // [#12509] Kept — it now exercises the WITHHOLD through the shared rule
    // (the comparison below reads `demotedDeclaredCode`, so it followed the
    // ruling without an edit, which is the property this block is for). The
    // declared 500 beside it is what keeps the anti-vacuity count honest.
    thrown('app spelling, no declared status', { code: 'WIDGET_REFUSED_THE_WRITE' }),
    thrown('app spelling, declared 500', { status: 500, code: 'ACME_IMPORT_ABORTED' }),
    thrown('registered code', { status: 409, code: 'DESTRUCTIVE_CHANGE' }),
    thrown('a record-validation failure', { name: 'ValidationError', code: 'VALIDATION_FAILED', fields: [] }),
    thrown('a bare fault', {}),
  ];

  for (const site of SITES) {
    for (const shape of SHAPES) {
      it(`${site.name}: "${(shape as Error).message}" answers what demotedDeclaredCode says`, async () => {
        const expected = demotedDeclaredCode(resolveThrownHttpError(shape));
        const { captured, reached } = await site.run(shape);

        expect(reached(), 'the throwing seam was never called').toBe(true);
        expect(captured.body?.error?.declaredCode).toBe(expected);
      });
    }
  }

  it('the shapes above do not all answer the same thing', () => {
    // Anti-vacuity for the comparison: if every shape demoted to `undefined`,
    // each case above would compare `undefined` to `undefined` and pass against
    // a door that emits nothing at all.
    const answers = SHAPES.map((s) => demotedDeclaredCode(resolveThrownHttpError(s)));
    expect(answers.filter((a) => a !== undefined).length).toBeGreaterThan(2);
    expect(answers.filter((a) => a === undefined).length).toBeGreaterThan(2);
  });
});

describe('[#12405] a REAL producer walked through this door answers with NO demote', () => {
  /**
   * The instrument's "no", on a real path rather than a fixture — and the
   * reachability measurement's second half stated as a test.
   *
   * A real `ObjectQL`, a real `ObjectStackProtocolImplementation` and a driver
   * that fails every `sys_metadata` access, driven through
   * `DELETE /api/v1/packages/:id` (no `?version=`, which is the branch that
   * routes to `protocol.deletePackage`). The producer answers its own declared
   * `503 SERVICE_UNAVAILABLE` — a REGISTERED code — so nothing is demoted and
   * this door must add nothing.
   *
   * That is the framework-producer population in one case: platform producers
   * reaching here are kept inside the ledger by
   * `pnpm check:dispatcher-error-vocabulary`, which is why `declaredCode`'s
   * live population is the limb no ledger enumerates (a metadata app's own
   * `.code`, #7867; a downstream repo's codes, kept out of this ledger by the
   * federation ruling). A suite that only ever asserted presence would be green
   * for a door that stamped `declaredCode` on this body too.
   */
  function failingDriver(dbError: string) {
    const boom = () => { throw new Error(dbError); };
    const driver: any = {
      name: 'memory-broken', version: '0.0.0', supports: {},
      async connect() {}, async disconnect() {}, async checkHealth() { return true; },
      async execute() { return null; },
      async find() { boom(); }, async findOne() { boom(); },
      async create() { boom(); }, async update() { boom(); }, async delete() { boom(); },
      async upsert() { boom(); }, async count() { boom(); },
      async bulkCreate() { boom(); }, async bulkUpdate() { boom(); }, async bulkDelete() { boom(); },
      async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
      async commit() {}, async rollback() {},
    };
    return driver;
  }

  it('an unreadable metadata store answers 503 SERVICE_UNAVAILABLE with no `declaredCode`', async () => {
    const engine = new ObjectQL();
    engine.registerDriver(failingDriver('SQLITE_ERROR: no such table: sys_metadata'), true);
    await engine.init();
    const protocol = new ObjectStackProtocolImplementation(engine as any);

    const captured = await drive(
      mount({ delete: async () => ({ success: true }) }, { protocol }),
      'DELETE',
      `${PKGS}/:id`,
      { params: { id: 'com.acme.crm' } },
    );

    const error = expectDeclaredEnvelope(captured);
    // The POSITIVE shape first, so the absence below cannot pass vacuously on
    // a request that failed for some entirely different reason.
    expect(captured.status).toBe(503);
    expect(error.code).toBe('SERVICE_UNAVAILABLE');
    expect('declaredCode' in error).toBe(false);
  }, 60_000);
});
