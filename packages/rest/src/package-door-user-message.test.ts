// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12502] The direct-mount package door carries a producer-marked
 * `userMessage` on the wire, instead of dropping the one it was holding.
 *
 * ## The defect
 *
 * `sendThrownError` (`package-routes.ts`) resolves every throw through the
 * shared ADR-0112 rule and then forwarded only what it had been taught to
 * forward. After #12405 that was `{ details, declaredCode }` — still not the
 * second declared channel sitting in the same local:
 *
 * ```ts
 * const thrown = resolveThrownHttpError(error);   // .userMessage populated here
 * const extra = { ...details, ...declaredCode };  // and dropped here
 * ```
 *
 * `resolveThrownHttpError` answers `userMessage` whenever the throw carried a
 * non-empty string one (`declaredUserMessage`, #9934), so an author's
 * deliberate, end-user-addressed refusal text sat in that local and was
 * dropped one line later. Nothing invalid shipped — `code`, `status` and
 * `message` were all correct — which is what made the loss silent: the mark
 * gone, and a consumer told by ADR-0112 to render `userMessage` verbatim
 * finding nothing there and falling back to its generic #3821 substitution.
 *
 * ## ⛔ The idiom here is the INVERSE of its `declaredCode` sibling
 *
 * The two channels landed one commit apart into the same `extra` object and
 * they are NOT the same shape. `declaredCode` must be read through
 * {@link demotedDeclaredCode}, because its raw field carries a SECOND meaning
 * — it is also set when the producer's spelling IS the registered member, so
 * forwarding it raw would put two spellings of one fact on every registered
 * refusal. `userMessage` has no second meaning: `declaredUserMessage` already
 * decided what counts as marked (a non-empty string, or nothing), so presence
 * means only "the producer opted in" and the caller passes
 * `thrown.userMessage` STRAIGHT THROUGH — byte for byte what the dispatcher
 * twin serving this same path does (`errorFromThrown`,
 * `packages/runtime/src/http-dispatcher.ts`).
 *
 * Section 3 is what holds that apart mechanically: it drives ONE throw
 * declaring BOTH channels and asserts each arrives under its own rule, so a
 * later author who "harmonises" the two by wrapping `userMessage` in a
 * demote-style helper goes red rather than quietly re-deriving a rule that
 * does not exist.
 *
 * ## The reachability standard this door is now judged on — say it once, here
 *
 * ⚠️ Measured on `origin/main` while this landed: the IN-TREE producer set at
 * this door is EMPTY, for both channels. The only in-tree writer of
 * `userMessage` onto a throwable is the QuickJS sandbox relay
 * (`runtime/src/sandbox/quickjs-runner.ts`), and it cannot reach these seams —
 * `packageService.publish/get/list/delete` reach the store through raw
 * `objectql.execute`, which dispatches no hook and no sandbox, while
 * `protocol.getMetaItems` and `protocol.deletePackage` re-wrap every
 * `engine.find` failure into a fresh `metadataStoreUnavailableError` (only
 * `code`/`status`/`cause` survive) and absorb per-item and cleanup throws into
 * `failed[]`/`cleanups[]`, which carry no such channel. Same for
 * `declaredCode`: every in-tree throw that escapes these seams spells a
 * REGISTERED code (`TENANT_SCOPE_REQUIRED`, `SERVICE_UNAVAILABLE`) or none.
 *
 * That is not a reason to withhold either channel, and the ruling that says so
 * is the honest cost of this door being **composed rather than closed**:
 * `resolvePackageService()` and `options.protocol` are open composition points,
 * all four handlers forward their throws to `sendThrownError` verbatim with
 * nothing in between, and ADR-0112's federation amendment exists precisely
 * BECAUSE the producer set is not enumerable in-tree. An in-tree-only bar
 * would declare the federated limb dead by construction — a liveness test that
 * can only ever answer "dead" for the federated case is not measuring
 * liveness. So the live population here is the injected/federated limb, and
 * that is exactly the population these tests drive.
 *
 * ⚠️ One seam below is drivable here but NOT production-reachable, and it is
 * named so nobody reads it as evidence of the opposite: the capability-gate
 * resolver. In production it is
 * `RestServer.resolvePackageRouteExecutionContext`, which returns
 * `this.resolveExecCtx(...).catch(() => undefined)` over a `private async`
 * method — so it can never throw synchronously and its rejections are
 * swallowed. It is kept in the seam table because it is the door's fourth
 * catch-reaching seam under a composed host and the sibling suite drives it
 * too; its value is coverage of the CATCH SITE, never a claim about producers.
 *
 * ## What this suite refuses to assert
 *
 * That the body "has one more field", or that `userMessage` is merely
 * "defined". Section 2 asserts the ABSENCE directly on throws that declared
 * nothing and on the three shapes `declaredUserMessage` rejects (`''`,
 * whitespace, a non-string), because a door that stamps whatever it finds on
 * `.userMessage` would pass a presence-only assertion while inventing a marked
 * message for a producer that never wrote one — deleting the #3821 protection
 * this channel exists to preserve.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { RouteHandler } from '@objectstack/spec/contracts';
import {
  resolveThrownHttpError,
  declaredUserMessage,
  INTERNAL_ERROR_MESSAGE,
  looksLikeInternalErrorLeak,
} from '@objectstack/types';
import { registerPackageRoutes } from './package-routes.js';

const PKGS = '/api/v1/packages';
const MANIFEST = { id: 'com.acme.crm', version: '1.0.0' };

/** A marked text with the shape a real one has: addressed, actionable, prose. */
const MARKED = 'Your plan does not include publishing packages. Ask an admin to upgrade the workspace.';

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
 * is one the wire contract accepts, `userMessage` included.
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

/**
 * One catch site, plus the seam that drives a throw INTO it and a witness that
 * the throw really travelled that way. Same four seams as
 * `package-door-declared-code.test.ts` and
 * `package-routes-coded-error-mapping.test.ts`, for the same reason: a case
 * that silently never reached the seam would otherwise "pass" on a body it got
 * for a completely different reason.
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
// 1. The mark reaches the wire, at every seam this door has
// ---------------------------------------------------------------------------

describe('[#12502] a producer-marked `userMessage` rides to the wire', () => {
  /**
   * Both status spellings, because both are produced in this repo
   * (`metadata-protocol` throws `status`, the lifecycle hooks throw
   * `statusCode`), and one throw whose status the resolver has to default.
   * The channel is STATUS-AGNOSTIC by ruling (2026-08-19 on objectui#5210,
   * option 1), so a 4xx, a 5xx and a defaulted status must all carry it — the
   * `code`/`status` pair is asserted on every row rather than the bare fact
   * that something was refused.
   */
  const MARKS: Array<{ name: string; error: unknown; status: number; code: string }> = [
    {
      name: 'a marked 403 (`status`)',
      error: thrown('licence check failed for org_42', { status: 403, code: 'FORBIDDEN', userMessage: MARKED }),
      status: 403,
      code: 'FORBIDDEN',
    },
    {
      name: 'a marked 409 (`statusCode`)',
      error: thrown('version 1.0.0 already published', {
        statusCode: 409, code: 'RESOURCE_CONFLICT', userMessage: 'That version is already published. Bump the version and retry.',
      }),
      status: 409,
      code: 'RESOURCE_CONFLICT',
    },
    {
      name: 'a marked 503 — a 5xx carries it too',
      error: thrown('upstream registry timed out', {
        status: 503, code: 'SERVICE_UNAVAILABLE', userMessage: 'The package registry is briefly unavailable. Try again in a minute.',
      }),
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    },
    {
      name: 'a marked throw that declared no status at all',
      error: thrown('the widget refused the write', { userMessage: 'This workspace is read-only right now.' }),
      status: 500,
      code: 'INTERNAL_ERROR',
    },
  ];

  for (const site of SITES) {
    for (const mark of MARKS) {
      it(`${site.name}: ${mark.name}`, async () => {
        const { captured, reached } = await site.run(mark.error);
        expect(reached()).toBe(true);
        const error = expectDeclaredEnvelope(captured);
        expect(captured.status).toBe(mark.status);
        expect(error.code).toBe(mark.code);
        // The whole point: verbatim, not rewrapped, not truncated here.
        expect(error.userMessage).toBe((mark.error as any).userMessage);
        // …and the resolver really was the source, so this pins the WRITER
        // rather than accidentally re-deriving the rule in the assertion.
        expect(resolveThrownHttpError(mark.error).userMessage).toBe(error.userMessage);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Absence — the door never INVENTS a mark
// ---------------------------------------------------------------------------

describe('[#12502] an unmarked refusal carries no `userMessage`', () => {
  /**
   * The three shapes `declaredUserMessage` rejects, plus the ordinary
   * no-field case. Each is asserted at the door AND at the resolver, so the
   * rule stays where it lives (one predicate, every boundary) instead of being
   * restated in this writer — which is exactly the fork #7525 cost.
   */
  const UNMARKED: Array<{ name: string; carried: Record<string, unknown> }> = [
    { name: 'no `userMessage` at all', carried: { status: 403, code: 'FORBIDDEN' } },
    { name: 'an empty-string `userMessage`', carried: { status: 403, code: 'FORBIDDEN', userMessage: '' } },
    { name: 'a whitespace-only `userMessage`', carried: { status: 403, code: 'FORBIDDEN', userMessage: '   \t  ' } },
    { name: 'a non-string `userMessage`', carried: { status: 403, code: 'FORBIDDEN', userMessage: 42 } },
  ];

  for (const site of SITES) {
    for (const unmarked of UNMARKED) {
      it(`${site.name}: ${unmarked.name}`, async () => {
        const error = thrown('refused', unmarked.carried);
        expect(declaredUserMessage(error)).toBeUndefined();
        const { captured, reached } = await site.run(error);
        expect(reached()).toBe(true);
        const body = expectDeclaredEnvelope(captured);
        expect(body.userMessage).toBeUndefined();
        expect('userMessage' in body).toBe(false);
        // The refusal itself is unaffected — this is an ADDITIVE channel.
        expect(captured.status).toBe(403);
        expect(body.code).toBe('FORBIDDEN');
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 3. The two channels are INDEPENDENT — one object, two rules
// ---------------------------------------------------------------------------

describe('[#12502] `userMessage` and `declaredCode` compose without interacting', () => {
  const SITE = SITES[0];

  it('one throw declaring BOTH carries both, each under its own rule', async () => {
    const { captured, reached } = await SITE.run(thrown('seat count exceeded', {
      status: 403,
      code: 'ACME_PLAN_LIMIT',        // unregistered -> demotes onto declaredCode
      userMessage: MARKED,            // marked       -> rides raw
    }));
    expect(reached()).toBe(true);
    const error = expectDeclaredEnvelope(captured);
    expect(captured.status).toBe(403);
    // Derived from the status, because the producer's spelling was NOT a
    // ledger member — which is exactly why it demoted onto `declaredCode`.
    expect(error.code).toBe('PERMISSION_DENIED');
    expect(error.declaredCode).toBe('ACME_PLAN_LIMIT');
    expect(error.userMessage).toBe(MARKED);
  });

  it('a REGISTERED code plus a mark: `declaredCode` withheld, `userMessage` carried', async () => {
    // The asymmetry in one assertion. `declaredCode` is absent BECAUSE the
    // spelling already sits in `code` (its demote rule), while `userMessage`
    // is present because presence is the producer's opt-in and nothing
    // re-derives it. A helper wrapped around `userMessage` to "match" the
    // sibling would have to invent a condition to drop it here — and this
    // case is what would go red.
    const { captured } = await SITE.run(thrown('already published', {
      status: 409, code: 'RESOURCE_CONFLICT', userMessage: 'That version is already published.',
    }));
    const error = expectDeclaredEnvelope(captured);
    expect(error.code).toBe('RESOURCE_CONFLICT');
    expect(error.declaredCode).toBeUndefined();
    expect(error.userMessage).toBe('That version is already published.');
  });

  it('an unregistered code with NO mark: `declaredCode` carried, `userMessage` absent', async () => {
    const { captured } = await SITE.run(thrown('the widget refused', {
      status: 409, code: 'CLOSE_PERIOD_LOCKED',
    }));
    const error = expectDeclaredEnvelope(captured);
    expect(error.declaredCode).toBe('CLOSE_PERIOD_LOCKED');
    expect(error.userMessage).toBeUndefined();
  });

  it('`details` is untouched by either, and all three ride one envelope', async () => {
    const { captured } = await SITE.run(thrown('validation failed', {
      status: 422,
      code: 'ACME_SHAPE_REJECTED',
      userMessage: 'Two fields need fixing before this can publish.',
      issues: [{ path: 'manifest.version', message: 'must be semver' }],
    }));
    const error = expectDeclaredEnvelope(captured);
    expect(error.declaredCode).toBe('ACME_SHAPE_REJECTED');
    expect(error.userMessage).toBe('Two fields need fixing before this can publish.');
    expect(error.details?.issues).toEqual([{ path: 'manifest.version', message: 'must be semver' }]);
  });
});

// ---------------------------------------------------------------------------
// 4. The 5xx PROSE withhold does not reach the marked channel
// ---------------------------------------------------------------------------

describe('[#12502] the 5xx message withhold leaves `userMessage` alone', () => {
  const SQLITE_NO_TABLE = 'SQLITE_ERROR: no such table: sys_packages';

  /**
   * This is a PREMISE, not a preference, and it is pinned rather than argued
   * because it can rot. `sendThrownError` rewrites a LOCAL `message` const,
   * and `looksLikeInternalErrorLeak` is only ever handed `thrown.message` —
   * so `thrown.userMessage` is never an input to the withhold. If someone
   * later routes the marked text through the same predicate, this goes red
   * and they are made to decide it deliberately, at both doors, rather than
   * by side effect at one.
   *
   * The two channels are answering different questions here, which is why the
   * outcome is not inconsistent: the diagnostic prose leaked the physical
   * table name and is withheld; the marked prose is the producer's own
   * sentence to the end user and discloses nothing it did not choose to.
   */
  it('the diagnostic message IS withheld while the mark rides through', async () => {
    expect(looksLikeInternalErrorLeak(SQLITE_NO_TABLE)).toBe(true);
    const { captured, reached } = await SITES[0].run(thrown(SQLITE_NO_TABLE, {
      status: 500,
      userMessage: 'Publishing is temporarily unavailable. Nothing was changed.',
    }));
    expect(reached()).toBe(true);
    const error = expectDeclaredEnvelope(captured);
    expect(captured.status).toBe(500);
    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(error.userMessage).toBe('Publishing is temporarily unavailable. Nothing was changed.');
    // The withhold still does its job: no physical name anywhere in the body.
    expect(JSON.stringify(captured.body)).not.toContain('no such table');
    expect(JSON.stringify(captured.body)).not.toContain('sys_packages');
  });

  it('a 5xx whose message does NOT look like a leak keeps both', async () => {
    const { captured } = await SITES[0].run(thrown('the registry said no', {
      status: 503, code: 'SERVICE_UNAVAILABLE', userMessage: 'Try again shortly.',
    }));
    const error = expectDeclaredEnvelope(captured);
    expect(error.message).toBe('the registry said no');
    expect(error.userMessage).toBe('Try again shortly.');
  });
});
