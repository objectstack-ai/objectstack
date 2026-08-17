// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Error-envelope conformance for the runtime dispatcher stack (#3842).
 *
 * #3687 gave `service-storage` and `service-i18n` a suite of this shape and
 * left the dispatcher pinned instead of fixed, because `error.code` there was
 * the HTTP status and moving it needed a consumer sweep. The sweep happened;
 * this is the guard that replaces the pin.
 *
 * Two directions, same as the storage/i18n suites:
 *
 *  1. **Runtime** — every distinct way this stack produces an error code is
 *     DRIVEN through the real dispatcher and the body parsed against
 *     `BaseResponseSchema` / `ApiErrorSchema` **imported from `packages/spec`**,
 *     not a local restatement that could drift from the schema it claims to
 *     check. There are four such ways (derived from status, promoted from
 *     `details.code`, spelled from `DispatcherErrorCode`, lifted off a thrown
 *     error) and one case per parking spot the fix collapsed.
 *
 *  2. **Source scan** — the modules are scanned so a NEW branch cannot quietly
 *     reintroduce a numeric `code`, a `type`-as-code sibling, or a hand-rolled
 *     envelope. Without this the suite would only ever cover the branches that
 *     existed the day it was written — which is exactly how four sites drifted
 *     into three different parking spots in the first place.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    ApiErrorSchema,
    BaseResponseSchema,
    DispatcherErrorCode,
    ErrorCode,
    envelopeViolations,
    standardErrorCodeForHttpStatus,
} from '@objectstack/spec/api';
import { HttpDispatcher } from './http-dispatcher.js';
import { buildApiError, splitSemanticCode } from './error-envelope.js';
import {
    PENDING_AT_DISPATCHER_DOOR,
    PENDING_LEDGER_REGISTRATION,
    SANDBOX_AUTHORED_LIMB,
    UNREGISTERED_CODE_SITES,
} from './dispatcher-error-vocabulary.js';

/** Minimal kernel — these branches fail before any service is reached. */
function makeDispatcher(kernel: any = { context: { getService: () => null } }) {
    return new HttpDispatcher(kernel as any);
}

/**
 * The assertions every dispatcher error body must satisfy, whatever produced
 * it. Spelled once so a new case cannot accidentally check less than the others.
 */
function expectConformantError(response: { status: number; body: any } | undefined) {
    expect(response, 'branch produced no response').toBeTruthy();
    const body = response!.body;

    expect(BaseResponseSchema.safeParse(body).success).toBe(true);
    expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
    expect(body.success).toBe(false);

    const parsed = ApiErrorSchema.safeParse(body.error);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);

    // The bug in one line: `code` is a semantic string, never the status.
    expect(typeof body.error.code).toBe('string');
    expect(body.error.code).not.toBe(String(response!.status));
    expect(body.error.httpStatus).toBe(response!.status);

    // And the parking spots are empty — `details` is genuine context only.
    expect(body.error.type).toBeUndefined();
    expect(body.error.details?.code).toBeUndefined();
    expect(body.error.details?.type).toBeUndefined();

    // [#9106] `declaredCode` means demotion: when present it is a producer
    // spelling the closed vocabulary does NOT contain — never a second copy of
    // `code`, never a registered member. Asserted for every body so a branch
    // that starts emitting it redundantly (two spellings of one fact on every
    // refusal) fails here rather than shipping.
    if (body.error.declaredCode !== undefined) {
        expect(typeof body.error.declaredCode).toBe('string');
        expect(body.error.declaredCode).not.toBe(body.error.code);
        expect(ErrorCode.safeParse(body.error.declaredCode).success).toBe(false);
    }

    return body.error;
}

/**
 * [#5519] `/actions` stands on the platform anonymous-deny baseline now, and it
 * answers ahead of the 400/405 branches below. These cases are about the ERROR
 * ENVELOPE those branches produce, not about who may call them, so they carry a
 * session — otherwise they would silently become a third copy of the 401 test.
 */
const AUTHED: any = { request: {}, executionContext: { userId: 'u_test', systemPermissions: [] } };

describe('#3842 — every dispatcher error exit answers in the declared envelope', () => {
    it('derives a catalogued code when the branch has none of its own (400)', async () => {
        const result = await makeDispatcher().handleActions('', 'POST', {}, AUTHED);

        const error = expectConformantError(result.response);
        expect(error.code).toBe('VALIDATION_ERROR');
        expect(error.message).toBe('Path must be /actions/:object/:action');
    });

    it('derives a catalogued code for a 405 and a 501 too', async () => {
        // The two statuses `StandardErrorCode` had no member for until #3842 —
        // without them a 405 would have derived the generic 4xx bucket and read
        // as a validation failure.
        const notAllowed = await makeDispatcher().handleActions('/task/close', 'GET', {}, AUTHED);
        expect(expectConformantError(notAllowed.response).code).toBe('METHOD_NOT_ALLOWED');

        const notImplemented = await makeDispatcher().handleI18n('/labels/account', 'GET', {}, { request: {} });
        expect(expectConformantError(notImplemented.response).code).toBe('NOT_IMPLEMENTED');
    });

    it('derives a catalogued code for a 503 (the /ready probe)', async () => {
        const kernel: any = { context: { getService: () => null }, getState: () => 'stopping' };
        const result = await makeDispatcher(kernel).dispatch('GET', '/ready', {}, {}, { request: {} });

        const error = expectConformantError(result.response);
        expect(error.code).toBe('SERVICE_UNAVAILABLE');
        // Genuine context survives the split — only the code was lifted out.
        expect(error.details).toEqual({ state: 'stopping' });
    });

    it('spells a route-resolution failure from the spec enum, not a third field', async () => {
        const result = await makeDispatcher().dispatch('POST', '', {}, {}, { request: {} });

        const error = expectConformantError(result.response);
        expect(error.code).toBe(DispatcherErrorCode.enum.ROUTE_NOT_FOUND);
        // `route` / `hint` stay siblings — `DispatcherErrorResponseSchema`
        // declares them as part of this error, not as `details` context.
        expect(typeof error.hint).toBe('string');
    });

    it('promotes a gate code out of `details` into the declared field', async () => {
        // The `PROJECT_MEMBERSHIP_REQUIRED` gate — the one site that used
        // `details.type`, the third of the three parking spots.
        const ql = { find: vi.fn().mockResolvedValue([]) };
        const kernel: any = {
            context: {
                getService: (name: string) => {
                    if (name === 'auth') {
                        return { api: { getSession: async () => ({ user: { id: 'user-1' } }) } };
                    }
                    if (name === 'objectql') return ql;
                    return null;
                },
            },
        };
        const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: true });
        const response = await (dispatcher as any).enforceProjectMembership(
            { request: { headers: {} }, environmentId: 'proj-private' },
            '/api/v1/environments/proj-private/data/task',
        );

        const error = expectConformantError(response);
        expect(error.code).toBe('PROJECT_MEMBERSHIP_REQUIRED');
        expect(error.details).toEqual({ environmentId: 'proj-private', userId: 'user-1' });
    });

    // [#4127 batch 4] The case above mocks auth as `{ api: { getSession } }` —
    // the LEGACY direct-mount shape. `plugin-auth` registers `AuthManager`,
    // which has no `.api` at all and exposes `getApi()` instead. So this gate
    // was green in tests and open in production: the session read yielded
    // undefined, `userId` stayed unset, and the handler returned at its
    // "anonymous — upstream auth will decide" line without ever querying
    // `sys_environment_member`. A signed-in NON-MEMBER passed it, on every
    // deployment with project scoping on. This pins the shipped shape.
    it('denies a non-member when the auth service exposes getApi() rather than .api (the shipped shape)', async () => {
        const ql = { find: vi.fn().mockResolvedValue([]) };   // no membership row
        const kernel: any = {
            context: {
                getService: (name: string) => {
                    // No `.api` member at all — exactly like AuthManager.
                    if (name === 'auth') {
                        return { getApi: async () => ({ getSession: async () => ({ user: { id: 'user-1' } }) }) };
                    }
                    if (name === 'objectql') return ql;
                    return null;
                },
            },
        };
        const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: true });
        const response = await (dispatcher as any).enforceProjectMembership(
            { request: { headers: {} }, environmentId: 'proj-private' },
            '/api/v1/environments/proj-private/data/task',
        );

        const error = expectConformantError(response);
        expect(error.code).toBe('PROJECT_MEMBERSHIP_REQUIRED');
        expect(error.details).toEqual({ environmentId: 'proj-private', userId: 'user-1' });
        expect(ql.find).toHaveBeenCalled();   // the membership query actually ran
    });

    it('lifts a thrown error’s own code into the declared field', async () => {
        const thrown = Object.assign(new Error('publish backend unavailable'), {
            code: 'CONNECTOR_UPSTREAM_UNAVAILABLE',
            status: 502,
        });
        const response = (makeDispatcher() as any).errorFromThrown(thrown);

        const error = expectConformantError(response);
        expect(error.code).toBe('CONNECTOR_UPSTREAM_UNAVAILABLE');
    });

    it('keeps the `Allow` header on the MCP 405 while sharing the body builder', async () => {
        const result = await makeDispatcher().handleMcpSkill('POST', { request: {} } as any);

        expect(result.response?.headers).toEqual({ Allow: 'GET' });
        const error = expectConformantError(result.response);
        expect(error.code).toBe('METHOD_NOT_ALLOWED');
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * [#8087] Direction 3 — the vocabulary, not just the cases this file drives
 *
 * The suite above parses the bodies it DRIVES, which is how three suites came
 * to pin bodies `ApiErrorSchema` rejects without anything noticing: a
 * conformance suite can only ever cover the branches that existed the day it
 * was written. `check:dispatcher-error-vocabulary` derives the whole set of
 * codes this door can emit from source; this block drives every
 * dispatcher-reachable member of that derivation through the REAL builder and
 * parses the result.
 *
 * That is the "parse EVERY body it emits" half of the maintainer ruling
 * (2026-08-12, option B as a gate) — the gate finds the set, and this asserts
 * on it, so a producer added next month is driven here without anyone adding
 * a case for it.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('#8087 — every code the dispatcher door can emit is parsed against ApiErrorSchema', () => {
    /** The real error path: a producer throw, resolved and built exactly as production does. */
    const emitFor = (code: string, status: number) =>
        (makeDispatcher() as any).errorFromThrown(
            Object.assign(new Error('a producer refused'), { code, status }),
            500,
        );

    it('drives a code from the derivation rather than a list written by hand', () => {
        // #8846 registered every code the FIRST derivation reported, which
        // emptied this list; [#9223] widening the scan to see a `code: CONST`
        // in an object literal re-populated it with one member —
        // UNIQUE_SCOPE_CONFIRMATION_REQUIRED, at the marketplace install seam's
        // `plugin-route` door — which is the loop working, not a regression.
        // PENDING_AT_DISPATCHER_DOOR stays empty because that code never passes
        // through this door, so the per-code drives below remain vacuous BY
        // DESIGN; the suite does not go quiet with them, since the seven
        // registered codes are driven POSITIVELY in the '#8846 discharge' case.
        // Spread: both lists are `readonly string[]`, and `arrayContaining`
        // takes a mutable one — passing the frozen list straight in is a tsc
        // error that only the TEST_DEBT ratchet would have caught.
        expect(PENDING_LEDGER_REGISTRATION).toEqual(expect.arrayContaining([...PENDING_AT_DISPATCHER_DOOR]));
    });

    for (const code of PENDING_AT_DISPATCHER_DOOR) {
        it(`'${code}' is DEMOTED off \`error.code\` until its ledger row lands (#9106)`, () => {
            const response = emitFor(code, 500);

            // [#9106] The door narrows now (maintainer ruling 2026-08-16:
            // `error.code` is a closed vocabulary at every door): the
            // unregistered spelling rides the wire's `declaredCode`, and the
            // closed slot takes the status-derived member. So an unswept
            // producer's body PARSES — what it loses is its semantic code,
            // silently absent from `error.code` until registration. That
            // silent demotion is exactly why a pending-registration row is a
            // debt the gate carries to the spec lane, not a curiosity.
            expect(response.body.error.code).toBe(standardErrorCodeForHttpStatus(response.status));
            expect(response.body.error.declaredCode).toBe(code);

            // Fully conformant — right envelope, status mirrored, and the
            // declared schema accepts it (`declaredCode` is a declared
            // `ApiErrorSchema` field, the open author-authored channel).
            const error = expectConformantError(response);
            expect(error.declaredCode).toBe(code);
        });
    }

    it('#8846 discharge: every code the first derivation reported now drives a fully conformant body', () => {
        // The seven codes the gate's first run reported as merely unregistered
        // (#8087 → #8846). Hand-spelled HERE deliberately: registration makes
        // the scan skip them, so no derivation carries them any more — this
        // pin is what notices a regression that unregisters one while its
        // producer lives on, and it keeps the "parse EVERY body it emits" half
        // of the ruling driven for exactly the codes that used to fail it.
        const registeredBy8846 = [
            'ERR_AUTONUMBER_COLLISION',
            'ERR_CROSS_DATASOURCE_TRANSACTION_WRITE',
            'ERR_HOOK_TARGET_REBIND',
            'ERR_TRANSACTION_UNSUPPORTED',
            'FIELD_VISIBILITY_UNRESOLVED',
            'FLOW_FAILED',
            'QUERY_OBJECT_MISMATCH',
        ] as const;
        for (const code of registeredBy8846) {
            expect(ErrorCode.safeParse(code).success, `${code} lost its ledger row`).toBe(true);
            // And through the REAL builder: verbatim carriage plus a body its
            // declared schema accepts — the exact pair that was broken before.
            const error = expectConformantError(emitFor(code, 500));
            expect(error.code).toBe(code);
        }
    });

    it('the same drive with a REGISTERED code is fully conformant — the control', () => {
        // Without this, "ApiErrorSchema rejects it" above would also be
        // satisfied by a builder that emits a broken envelope for everything.
        const error = expectConformantError(emitFor('DATABASE_ERROR', 500));
        expect(error.code).toBe('DATABASE_ERROR');
        // And not merely the status-derived answer — 500 derives INTERNAL_ERROR,
        // so this proves the producer's code was carried, not invented.
        expect(standardErrorCodeForHttpStatus(500)).not.toBe('DATABASE_ERROR');
    });

    it('every pending code is still unregistered — the row comes out when #8846 lands', () => {
        // The ratchet's test-side half. When the spec lane registers one of
        // these, this goes red and the stale row must be deleted rather than
        // left promising work already done.
        for (const code of PENDING_LEDGER_REGISTRATION) {
            expect(ErrorCode.safeParse(code).success, `${code} is registered now — drop its row`).toBe(false);
        }
    });

    it('the status-derived limb cannot produce an unregistered code, by construction', () => {
        // The third limb of `buildApiError`'s precedence needs no ledger row and
        // no gate: `standardErrorCodeForHttpStatus` returns a StandardErrorCode
        // for every input, so a branch that spells no code of its own is always
        // parseable. Asserted rather than assumed, across the bands the
        // dispatcher actually answers with.
        for (const status of [400, 401, 403, 404, 405, 409, 415, 422, 428, 429, 500, 501, 503, 504, 507]) {
            const derived = standardErrorCodeForHttpStatus(status);
            expect(ErrorCode.safeParse(derived).success, `${status} derived an unregistered ${derived}`).toBe(true);
        }
    });

    it('demotes the sandbox limb to `declaredCode` — the door is closed WITHOUT dropping the author code (#9106)', () => {
        // `SandboxError` carries a metadata app's OWN `.code` across the QuickJS
        // boundary on purpose (#7867), and `domains/actions.ts` serves it through
        // `errorFromThrown`. So this door's vocabulary had a limb authored by
        // tenants at runtime, which no ledger can enumerate. The #9106 ruling
        // (maintainer 2026-08-16) closed it by DEMOTION: the author's spelling
        // rides `error.declaredCode` — the open, author-authored channel — and
        // `error.code` takes the closed member the status derives. #7867's
        // capability is preserved: the code still crosses the sandbox and still
        // reaches the wire.
        const witness = SANDBOX_AUTHORED_LIMB.witness;
        expect(ErrorCode.safeParse(witness).success).toBe(false);
        const response = emitFor(witness, 400);
        const error = expectConformantError(response);
        expect(error.code).toBe(standardErrorCodeForHttpStatus(400));
        expect(error.declaredCode).toBe(witness);
        // It stays absent from the registration hand-off (fenced off from
        // #8846): registering one tenant spelling would close nothing, since
        // the next app picks a different string.
        expect(PENDING_LEDGER_REGISTRATION).not.toContain(witness);
    });

    it('classifies every derived site — no verdict is left to a default', () => {
        for (const site of UNREGISTERED_CODE_SITES) {
            expect(site.why.length, `${site.code} at ${site.file} carries no evidence`).toBeGreaterThan(40);
            // A site that reaches a door must be on its way to a ledger row;
            // anything else must say which non-wire vocabulary it belongs to.
            //
            // [#9223] One exception, and it is about what a SOURCE SCAN can
            // know rather than about reachability: a code built by template
            // interpolation reaches the `rest` door and yet has no literal to
            // register, so `runtime-pinned` names the test that enumerates the
            // family at runtime. It stays out of PENDING_LEDGER_REGISTRATION
            // deliberately — a family identity like `APPROVAL_*_FAILED` can
            // never be registered, and parking it in that list would hand
            // #8846 a debt nobody can discharge.
            if (site.door !== 'none') {
                expect(['pending-registration', 'runtime-pinned']).toContain(site.verdict);
            } else {
                expect(site.verdict).not.toBe('pending-registration');
            }
        }
    });

    it('[#9223] every runtime-pinned row names its runtime half, and only a template may', () => {
        // The declaration-side half of the same guard the gate enforces on the
        // scan side. `runtime-pinned` is the one verdict that does not decide
        // reachability, so it is the one that could become an exemption from
        // the registry check — on a literal it would be exactly that.
        for (const site of UNREGISTERED_CODE_SITES.filter((s) => s.verdict === 'runtime-pinned')) {
            expect(site.shape, `${site.code} is runtime-pinned but spells a literal`).toBe('objlittemplate');
            expect(site.pin, `${site.code} is runtime-pinned with no pin`).toBeTruthy();
            expect(site.code, `${site.code} is not a template family identity`).toContain('*');
            expect(PENDING_LEDGER_REGISTRATION).not.toContain(site.code);
        }
    });
});

describe('#3842 — buildApiError precedence', () => {
    it('prefers an explicit code over a promoted one over a derived one', () => {
        expect(buildApiError({ message: 'm', httpStatus: 403, code: 'EXPLICIT' }).code).toBe('EXPLICIT');
        expect(buildApiError({ message: 'm', httpStatus: 403, details: { code: 'PROMOTED' } }).code)
            .toBe('PROMOTED');
        expect(buildApiError({ message: 'm', httpStatus: 403 }).code).toBe('PERMISSION_DENIED');
    });

    it('drops `details` entirely when the code was all it carried', () => {
        // An empty object left behind would read as "there is context here".
        expect(buildApiError({ message: 'm', httpStatus: 403, details: { code: 'X' } }))
            .not.toHaveProperty('details');
    });

    it('leaves a non-string `code` in `details` rather than promoting it', () => {
        // A numeric `code` in a details payload is context (a driver errno, say),
        // not a semantic code — promoting it would put a number straight back
        // into the field this whole change exists to keep a string.
        const error = buildApiError({ message: 'm', httpStatus: 500, details: { code: 42 } });
        expect(error.code).toBe('INTERNAL_ERROR');
        expect(error.details).toEqual({ code: 42 });
    });

    it('passes a non-object `details` through untouched', () => {
        expect(splitSemanticCode('a string')).toEqual({ details: 'a string' });
        expect(splitSemanticCode(undefined)).toEqual({ details: undefined });
    });
});

describe('#3842 — no dispatcher module may reintroduce the drift', () => {
    // Comments stripped first: these modules' own prose quotes the old shape,
    // and a doc comment is not a code path.
    const read = (file: string) =>
        readFileSync(new URL(file, import.meta.url), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');

    /** Every module that can put a body on this wire surface. */
    const MODULES = [
        './http-dispatcher.ts',
        './dispatcher-plugin.ts',
        './domain-handler-registry.ts',
        './domains/ai.ts',
        './domains/mcp.ts',
        // [#4910] The inbound rate limiter writes a 429 body from a MIDDLEWARE
        // rather than a route handler — a fifth way onto this wire surface, and
        // therefore a fifth way to reintroduce a numeric `code`. Listed the day
        // it was written, which is the whole point of the scan: the suite
        // covering only the branches that existed when it was authored is how
        // four sites drifted into three parking spots.
        './security/inbound-rate-limit.ts',
        // [#5090] The declarative-endpoint step writes a body from the
        // `setFallbackHandler` seam — a sixth way onto this wire surface, and
        // the first that answers a request no route matched. Listed the day it
        // was written, for the same reason the line above was.
        './api-endpoint-step.ts',
        // [#5091] The endpoint POLICY keys write the 401 and the 429 that a
        // declared endpoint answers — a seventh way onto this wire surface.
        // Both bodies deliberately restate an existing seam's (the platform
        // anonymous-deny, the server-level limiter's 429), which is exactly the
        // situation where a hand-rolled copy is tempting; the scan is what makes
        // "restate" mean "call the same builder".
        './endpoint-policy.ts',
        // [#5092] The endpoint executor maps a delegated pipeline's failure onto
        // this wire surface — a restatement of `errorFromThrown` outside the
        // dispatcher class, which is exactly the kind of second copy this scan
        // exists to keep honest. Listed the day it was written.
        './endpoint-executor.ts',
        // [#5137] The endpoint MAPPING keys refuse a declaration this runtime
        // cannot serve (`transform`, an unusable path, colliding targets) with a
        // body of their own — an eighth way onto this wire surface, and one
        // whose whole reason for existing is that the alternative was silence.
        // Listed the day it was written.
        './api-mapping.ts',
    ];

    for (const file of MODULES) {
        it(`${file} never writes a numeric \`code\``, () => {
            const hits = [...read(file).matchAll(/\bcode:\s*\d/g)];
            expect(hits, `numeric code literals in ${file}: ${hits.map((m) => m[0]).join(', ')}`)
                .toHaveLength(0);
        });

        it(`${file} never revives \`type\` as an error-code sibling`, () => {
            const hits = [...read(file).matchAll(/\btype:\s*'[A-Z_]{4,}'/g)];
            expect(hits, `type-as-code in ${file}: ${hits.map((m) => m[0]).join(', ')}`)
                .toHaveLength(0);
        });

        it(`${file} builds every error body through the one builder`, () => {
            // Each `success: false` must be the builder's, so the envelope keeps
            // living in exactly one place no matter how many branches appear.
            // The comma form is the object LITERAL; `success: false;` in a type
            // annotation describes the shape rather than emitting one.
            const source = read(file);
            const envelopes = [...source.matchAll(/success:\s*false\s*,/g)].length;
            const built = [...source.matchAll(/\b(buildApiError|apiErrorResponse)\s*\(/g)].length;
            expect(built, `${file} has ${envelopes} error envelope(s) but ${built} builder call(s)`)
                .toBeGreaterThanOrEqual(envelopes);
        });
    }

    it('the builder itself is the only place the envelope shape is written', () => {
        const source = read('./error-envelope.ts');
        expect([...source.matchAll(/success:\s*false\s*,/g)]).toHaveLength(1);
    });
});
