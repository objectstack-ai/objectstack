// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14704 — the single-record `/data` door must not ship the QuickJS debug
 * wrapper out of a declared-code structured arm.
 *
 * ## What was measured, on `origin/main` @ `99b4deba49`
 *
 * A `SandboxError` carries the caller-addressed sentence on `.innerMessage`
 * and a `<kind> '<name>' threw: <msg>` DEBUG WRAPPER on `.message`
 * (`runtime/src/sandbox/quickjs-runner.ts`). Every arm in
 * `structuredCodeAnswer` — and the `PERMISSION_DENIED` arm just below the
 * consult — built its sentence from `error?.message`, and those arms are asked
 * BEFORE the sandbox unwrap door in `classifyDataError`. So one hook refusal
 * came back as two different sentences depending on the route:
 *
 *   sendThrownError / handleRouteError  (bulk / metadata / UI)
 *     409 {"error":"Opportunity is closed.","code":"DELETE_RESTRICTED"}
 *   mapDataError                        (single-record /data)
 *     409 {"error":"hook 'guard' threw: Error: Opportunity is closed.", …}
 *
 * The bulk door is right because #11588 taught `resolveErrorResponse`'s
 * declared-status passthrough to read `sandboxBusinessMessage`, and because
 * #14541 excludes a sandbox-origin error from the shared consult entirely. The
 * single door reached the arms and shipped the wrapper — #11588's own defect,
 * one door over, with the direction reversed rather than closed.
 *
 * ## What this file pins
 *
 *  §1 per arm, by NAME: a sandboxed BUSINESS refusal carrying that arm's
 *     declared code answers with `.innerMessage` on the single door, and the
 *     wrapper never reaches the wire — status and `code` asserted with it
 *     (ADR-0112), never `toThrow()` alone;
 *  §2 the arm's structured fields still ride, so the repair is a SENTENCE
 *     change and nothing else;
 *  §3 the non-sandbox control: a plain producer on the same codes keeps
 *     `error.message` byte for byte — the two-read rule is a read of a field
 *     the sandbox populated, never a strip of the wrapper off `.message`;
 *  §4 CONVERGED (#15071, maintainer ruling 2026-09-04 / batch #27, option B):
 *     a sandboxed CRASH carrying a declared code reaches the unwrap door's
 *     sanitised `500 UNCLASSIFIED_FAULT` whatever code it declares — the
 *     terminal moved above the arms (`isSandboxCrash`). This section was the
 *     ACCEPTED DIVERGENCE the follow-up decision card was carried on; the
 *     verdict flipped, the section did not go away. Three legs: the flip per
 *     arm, the surviving positive control (the same crash with NO declared
 *     code), and the negative control the ruling makes mandatory — "only the
 *     crash branch moves", so an ordinary declared refusal is untouched;
 *  §5 the bulk-door control: this change is unreachable from
 *     `resolveErrorResponse`, which declines the consult for a sandbox-origin
 *     error (#14541), so nothing moves on those routes;
 *  §6 the drift guard: every arm in the shared classification that relays a
 *     PRODUCER sentence asks the shared rule, so the next arm cannot
 *     reintroduce the raw relay silently.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapDataError, sendThrownError } from './error-response.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The classification's own source, read once: §4-derivation and §6 both scan it
 * — one re-derives the arm list from the tree (the #15071 ruling's execution
 * constraint), the other guards the sentence rule. Same package, so the read
 * does not escape it (AGENTS.md → cross-package test inputs).
 */
const SOURCE = readFileSync(resolve(HERE, 'error-response.ts'), 'utf8');

/** The business sentence a hook author addressed to the end user. */
const BUSINESS = 'Opportunity is closed.';
/** What QuickJS puts on `.message` for that same throw. */
const WRAPPER = `hook 'guard' threw: Error: ${BUSINESS}`;

/**
 * A `SandboxError`-shaped refusal, assembled exactly as
 * `quickjs-runner.ts` builds it: the wrapper on `.message`, the business
 * sentence on `.innerMessage`, `name` fixed to `SandboxError` (the class sets
 * it unconditionally — which is why the `DUPLICATE_RECORD` arm's
 * `name === 'DuplicateRecordError'` gate excludes a sandbox producer
 * outright).
 */
function sandboxRefusal(extra: Record<string, unknown>): any {
    const e: any = new Error(WRAPPER);
    e.name = 'SandboxError';
    e.innerMessage = BUSINESS;
    return Object.assign(e, extra);
}

/** The same shape for a body that CRASHED — no business sentence exists. */
function sandboxCrash(extra: Record<string, unknown>): any {
    const e: any = new Error("hook 'guard' threw: TypeError: x is not a function");
    e.name = 'SandboxError';
    e.innerMessage = 'TypeError: x is not a function';
    return Object.assign(e, extra);
}

function bulkDoor(error: unknown, object?: string): { status: number; body: Record<string, unknown> } {
    let status = 0;
    let body: Record<string, unknown> = {};
    const res = {
        status(s: number) { status = s; return this; },
        json(b: Record<string, unknown>) { body = b; return this; },
    };
    sendThrownError(res, error, object);
    return { status, body };
}

/**
 * One row per code-gated arm triage named. `declares` is what the PRODUCER
 * writes onto the thrown error; `status` / `code` are what that arm answers.
 */
interface Arm {
    /** The arm, by the name it is known by in `error-response.ts`. */
    readonly arm: string;
    readonly declares: Record<string, unknown>;
    readonly status: number;
    readonly code: string;
    /** Structured fields the arm must still ship (§2). */
    readonly keeps?: Readonly<Record<string, unknown>>;
}

const ARMS: readonly Arm[] = [
    {
        arm: 'DELETE_RESTRICTED',
        declares: { code: 'DELETE_RESTRICTED', status: 409, object: 'account', dependentObject: 'contact', dependentCount: 3 },
        status: 409,
        code: 'DELETE_RESTRICTED',
        keeps: { dependentObject: 'contact', dependentCount: 3, object: 'account' },
    },
    {
        arm: 'CONCURRENT_UPDATE',
        declares: { code: 'CONCURRENT_UPDATE', status: 409, currentVersion: 7 },
        status: 409,
        code: 'CONCURRENT_UPDATE',
        keeps: { currentVersion: 7, object: 'account' },
    },
    {
        arm: 'ERR_DATASOURCE_UNAVAILABLE',
        declares: { code: 'ERR_DATASOURCE_UNAVAILABLE', datasource: 'warehouse', kind: 'blocked' },
        status: 503,
        code: 'ERR_DATASOURCE_UNAVAILABLE',
        keeps: { datasource: 'warehouse', reason: 'blocked', object: 'account' },
    },
    {
        arm: 'VALIDATION_FAILED',
        declares: { code: 'VALIDATION_FAILED', status: 400, fields: [{ name: 'amount', message: 'must be positive' }] },
        status: 400,
        code: 'VALIDATION_FAILED',
        keeps: { fields: [{ name: 'amount', message: 'must be positive' }], object: 'account' },
    },
    {
        arm: 'FEEDS_DISABLED',
        declares: { code: 'FEEDS_DISABLED', status: 403, object: 'account' },
        status: 403,
        code: 'FEEDS_DISABLED',
        keeps: { object: 'account' },
    },
    {
        arm: 'FILES_DISABLED',
        declares: { code: 'FILES_DISABLED', status: 403, object: 'account' },
        status: 403,
        code: 'FILES_DISABLED',
        keeps: { object: 'account' },
    },
    {
        arm: 'ATTACHMENT_PARENT_ACCESS',
        declares: { code: 'ATTACHMENT_PARENT_ACCESS', status: 403, object: 'account' },
        status: 403,
        code: 'ATTACHMENT_PARENT_ACCESS',
        keeps: { object: 'account' },
    },
    {
        arm: 'ATTACHMENT_DELETE_DENIED',
        declares: { code: 'ATTACHMENT_DELETE_DENIED', status: 403, object: 'account' },
        status: 403,
        code: 'ATTACHMENT_DELETE_DENIED',
        keeps: { object: 'account' },
    },
    {
        arm: 'RECORD_NOT_ACCESSIBLE',
        declares: { code: 'RECORD_NOT_ACCESSIBLE', status: 403, object: 'account' },
        status: 403,
        code: 'RECORD_NOT_ACCESSIBLE',
        keeps: { object: 'account' },
    },
    {
        arm: 'PERMISSION_DENIED',
        declares: { code: 'PERMISSION_DENIED', status: 403 },
        status: 403,
        code: 'PERMISSION_DENIED',
        keeps: { object: 'account' },
    },
];

describe('#14704 · the single `/data` door never ships the QuickJS wrapper out of a declared-code arm', () => {
    describe('§1 per arm — a sandboxed BUSINESS refusal answers with `innerMessage`', () => {
        for (const arm of ARMS) {
            it(`${arm.arm} answers ${arm.status} ${arm.code} with the business sentence`, () => {
                const wire = mapDataError(sandboxRefusal(arm.declares), 'account');
                expect(wire.status).toBe(arm.status);
                expect(wire.body.code).toBe(arm.code);
                expect(wire.body.error).toBe(BUSINESS);
                // ⛔ The wrapper is for the server log, never the wire.
                expect(String(wire.body.error)).not.toContain('threw:');
            });
        }
    });

    describe('§2 the structured fields still ride — only the SENTENCE moves', () => {
        for (const arm of ARMS) {
            it(`${arm.arm} keeps ${Object.keys(arm.keeps ?? {}).join(', ')}`, () => {
                const wire = mapDataError(sandboxRefusal(arm.declares), 'account');
                for (const [key, value] of Object.entries(arm.keeps ?? {})) {
                    expect(wire.body[key]).toEqual(value);
                }
            });
        }
    });

    describe('§3 the non-sandbox control — a plain producer keeps `error.message` verbatim', () => {
        for (const arm of ARMS) {
            it(`${arm.arm} is byte-identical for a producer with no innerMessage`, () => {
                const plain: any = Object.assign(new Error('Plain producer sentence'), arm.declares);
                const wire = mapDataError(plain, 'account');
                expect(wire.status).toBe(arm.status);
                expect(wire.body.code).toBe(arm.code);
                expect(wire.body.error).toBe('Plain producer sentence');
            });
        }
    });

    /**
     * FLIPPED by #15071, deliberately and in that card's PR, from
     * `ACCEPTED DIVERGENCE` to `CONVERGED` — the same discipline PR #15065 used
     * on its own §4 one file over. ⛔ The section is not DELETED: it is the only
     * thing that would notice the divergence coming back, and what changes is
     * its verdict, not its existence.
     *
     * ## The reason, quoted beside the flip
     *
     * Maintainer ruling, 2026-09-04, decision batch #27, verbatim 「同意」 on
     * option B: *"A declared code is the author's statement about the failure
     * mode they **handled**. A crash (`isScriptFaultMessage`, #7543) is not that
     * mode, so it is classified as a fault at both doors: `mapDataError`'s
     * code-gated arms … hand a sandboxed crash to the same sanitised terminal
     * `classifyDataError`'s unwrap door already produces — `500`,
     * `UNCLASSIFIED_FAULT`, no wrapper prose on the wire."* ⛔ Not A: *"an
     * internal stack-shaped sentence at a business status is both a leak and a
     * lie to the client about what happened."* ⛔ Not C: *"it adds a mechanism to
     * keep answering a crash with a business status."*
     *
     * ## What the section pins now, in three legs
     *
     *  - **the flip**, per arm and by NAME over {@link ARMS} — the list the
     *    ruling required be RE-DERIVED from the tree rather than copied from
     *    #14704, and `§4-derivation` below is the guard that keeps it derived;
     *  - **the positive control STAYS** and is still a control: the same crash
     *    carrying NO declared code reaches the same sanitised 500, so a green
     *    flip leg cannot be read as "the terminal swallowed everything";
     *  - **the negative control**, which is the condition a plausible-but-wrong
     *    implementation fails. The ruling: *"Ordinary declared refusals (a hook
     *    that throws a business error carrying a code, no crash) are
     *    **untouched** — only the crash branch moves."* An implementation that
     *    degraded anything carrying a code to 500 would turn the flip leg green
     *    while deleting the whole declarative-refusal surface, so the refusal
     *    leg is asserted HERE per arm as well, not merely inherited from §1.
     */
    describe('§4 CONVERGED (#15071) — a sandboxed CRASH reaches the fault terminal whatever code it declares', () => {
        for (const arm of ARMS) {
            it(`${arm.arm}: a crash carrying it answers the sanitised 500, not ${arm.status}`, () => {
                const wire = mapDataError(sandboxCrash(arm.declares), 'account');
                // ADR-0112 envelope: both halves asserted, never a status alone.
                expect(wire.status).toBe(500);
                expect(wire.body.code).toBe('INTERNAL_ERROR');
                // ⛔ The stack-shaped sentence is the leak the ruling names.
                expect(String(wire.body.error)).not.toContain('threw:');
                expect(String(wire.body.error)).not.toContain('TypeError');
                // The arm's declared status is gone with it — a crash is not
                // the failure mode the author declared.
                expect(wire.status).not.toBe(arm.status);
                expect(wire.body.code).not.toBe(arm.code);
                // …and so are the arm's structured fields: the sanitised
                // terminal says status and code and nothing else.
                for (const key of Object.keys(arm.keeps ?? {})) {
                    expect(wire.body, `${arm.arm} leaked ${key}`).not.toHaveProperty(key);
                }
            });
        }

        it('the positive control STAYS: the same crash with no declared code reaches the same terminal', () => {
            const wire = mapDataError(sandboxCrash({}), 'account');
            expect(wire.status).toBe(500);
            expect(wire.body.code).toBe('INTERNAL_ERROR');
            expect(String(wire.body.error)).not.toContain('threw:');
            expect(String(wire.body.error)).not.toContain('TypeError');
        });

        describe('§4-negative — «only the crash branch moves»', () => {
            for (const arm of ARMS) {
                it(`${arm.arm}: a sandboxed BUSINESS refusal is completely unaffected`, () => {
                    const wire = mapDataError(sandboxRefusal(arm.declares), 'account');
                    expect(wire.status).toBe(arm.status);
                    expect(wire.body.code).toBe(arm.code);
                    expect(wire.body.error).toBe(BUSINESS);
                    for (const [key, value] of Object.entries(arm.keeps ?? {})) {
                        expect(wire.body[key]).toEqual(value);
                    }
                });

                it(`${arm.arm}: a NON-sandbox producer on the same code is untouched too`, () => {
                    const plain: any = Object.assign(new Error('Plain producer sentence'), arm.declares);
                    const wire = mapDataError(plain, 'account');
                    expect(wire.status).toBe(arm.status);
                    expect(wire.body.code).toBe(arm.code);
                    expect(wire.body.error).toBe('Plain producer sentence');
                });
            }

            it('a crash-SHAPED sentence a non-sandbox producer wrote is NOT a sandbox crash', () => {
                // `isSandboxCrash` is gated on the sandbox side-channel first.
                // A plain producer whose own message happens to read like a
                // native error name never had an `innerMessage`, so the arm
                // answers it exactly as before — the crash rule reaches only
                // what the sandbox unwrapped.
                const plain: any = Object.assign(new Error('TypeError: x is not a function'), {
                    code: 'DELETE_RESTRICTED', status: 409, object: 'account',
                });
                const wire = mapDataError(plain, 'account');
                expect(wire.status).toBe(409);
                expect(wire.body.code).toBe('DELETE_RESTRICTED');
                expect(wire.body.error).toBe('TypeError: x is not a function');
            });
        });

        /**
         * The ruling's own execution constraint: *"the seat re-derives the arm
         * list from the tree, not from #14704's list."* Re-deriving once is a
         * reading that rots; this leg is the same re-derivation asked
         * mechanically, so the next arm added to the shared classification is
         * either covered above or excused here BY NAME.
         *
         * Measured re-derivation on this tree: thirteen declared-code literals
         * sit above the unwrap door — ten reachable by a sandboxed producer
         * (the {@link ARMS} rows) and three that are not, each for a reason the
         * source states in the arm itself.
         */
        describe('§4-derivation — the arm list is DERIVED from the tree, not copied', () => {
            /** Code literals a sandboxed producer provably cannot reach. */
            const UNREACHABLE_BY_A_SANDBOX_PRODUCER: ReadonlyArray<{ code: string; why: string }> = [
                {
                    code: 'DUPLICATE_RECORD',
                    why: 'gated on the ENVELOPE — `name === \'DuplicateRecordError\'` — and `SandboxError` sets '
                        + '`name` unconditionally, so no sandbox producer, crashed or not, reaches this arm.',
                },
                {
                    code: 'OBJECT_NOT_FOUND',
                    why: 'carries #14541\'s `!isSandboxOrigin` clause, which routes every sandboxed producer '
                        + 'past the arm to the unwrap door — where #15071\'s terminal now sits above it anyway.',
                },
                {
                    code: 'INVALID_FIELD',
                    why: 'the same `!isSandboxOrigin` clause as the arm above, for the same reason.',
                },
            ];

            /** The whole region asked BEFORE the unwrap door: the shared classification plus the arms below the consult. */
            function aboveTheUnwrapDoor(): string {
                const shared = SOURCE.indexOf('function structuredCodeAnswer(');
                const door = SOURCE.indexOf("if (typeof error?.innerMessage === 'string' && error.innerMessage) {", shared);
                expect(shared).toBeGreaterThan(-1);
                expect(door).toBeGreaterThan(shared);
                return SOURCE.slice(shared, door);
            }

            function declaredCodeLiterals(): string[] {
                return [...aboveTheUnwrapDoor().matchAll(/error\?\.code === '([A-Z_]+)'/g)].map((m) => m[1]);
            }

            it('the scan really sees the arms (a zero-match scan is a green that measured nothing)', () => {
                expect(new Set(declaredCodeLiterals()).size).toBeGreaterThanOrEqual(13);
            });

            it('every declared-code arm above the unwrap door is either covered here or named unreachable', () => {
                const covered = new Set(ARMS.map((a) => a.arm));
                const excused = new Set(UNREACHABLE_BY_A_SANDBOX_PRODUCER.map((e) => e.code));
                const uncovered = [...new Set(declaredCodeLiterals())]
                    .filter((code) => !covered.has(code) && !excused.has(code));
                expect(uncovered).toEqual([]);
            });

            it('the excuse list is not a dumping ground: every entry is a live arm with a real reason', () => {
                const region = aboveTheUnwrapDoor();
                for (const entry of UNREACHABLE_BY_A_SANDBOX_PRODUCER) {
                    expect(region).toContain(`error?.code === '${entry.code}'`);
                    expect(entry.why.length).toBeGreaterThan(60);
                }
            });

            it('the crash terminal is asked ONCE, above the arms — not duplicated into them', () => {
                // The move is the change: one `isScriptFaultMessage` gate on
                // this path, and it out-ranks the consult. A second copy inside
                // an arm would be the mechanism option C was refused for.
                const fn = SOURCE.indexOf('function classifyDataError(');
                const consult = SOURCE.indexOf('const structured = structuredCodeAnswer(error, object);', fn);
                expect(consult).toBeGreaterThan(fn);
                expect(SOURCE.slice(fn, consult)).toContain('isSandboxCrash(error)');
                expect(SOURCE.slice(fn, consult)).toContain('UNCLASSIFIED_FAULT()');
                expect(aboveTheUnwrapDoor()).not.toContain('isScriptFaultMessage(');
            });
        });
    });

    describe('§5 the bulk-door control — nothing moves on `resolveErrorResponse`', () => {
        it('DELETE_RESTRICTED: the bulk door already answered the business sentence (#11588)', () => {
            const wire = bulkDoor(sandboxRefusal({ code: 'DELETE_RESTRICTED', status: 409, object: 'account', dependentObject: 'contact' }), 'account');
            expect(wire.status).toBe(409);
            expect(wire.body.code).toBe('DELETE_RESTRICTED');
            expect(wire.body.error).toBe(BUSINESS);
        });

        it('a sandbox-origin error never reaches the shared consult there (#14541)', () => {
            // Proof by the consequence #14541 recorded: the arms' structured
            // fields are absent on this door for a sandbox producer.
            const wire = bulkDoor(sandboxRefusal({ code: 'DELETE_RESTRICTED', status: 409, object: 'account', dependentObject: 'contact' }), 'account');
            expect(wire.body).not.toHaveProperty('dependentObject');
        });
    });

    /**
     * The drift guard triage guard 3 asks for, one card on: an arm added to the
     * shared classification tomorrow that relays a producer sentence must ask
     * the shared rule, or say in this list why it does not.
     */
    describe('§6 drift guard — every producer-sentence relay asks the shared rule', () => {
        const RAW_RELAY_ALLOWED: ReadonlyArray<{ code: string; why: string }> = [
            {
                code: 'DUPLICATE_RECORD',
                why: 'gated on the ENVELOPE (`name === \'DuplicateRecordError\'`) and `SandboxError` sets '
                    + '`name` unconditionally, so a sandbox producer cannot reach this arm at all — the '
                    + 'two-read rule here would be a check that evaluates never. Converging the GATE is a '
                    + 'wire change for two producer populations and reverses #14389 §5; escalated, not taken.',
            },
            {
                code: 'OBJECT_NOT_FOUND',
                why: 'ships a FIXED sentence, never `error.message`, and carries #14541\'s `!isSandboxOrigin` '
                    + 'clause besides — no wrapper can reach the wire through it.',
            },
            {
                code: 'INVALID_FIELD',
                why: 'fenced by #14541\'s explicit `!isSandboxOrigin` clause, which routes a sandboxed '
                    + 'producer to the unwrap door before this arm is reached. Both spellings already '
                    + 'produce the right answer, and triage ruled this arm out of scope.',
            },
        ];

        function sharedClassification(): string {
            const a = SOURCE.indexOf('function structuredCodeAnswer(');
            const b = SOURCE.indexOf('function classifyDataError(', a + 1);
            expect(a).toBeGreaterThan(-1);
            expect(b).toBeGreaterThan(a);
            return SOURCE.slice(a, b);
        }

        /** Split the classification into one chunk per arm, keyed by its first code literal. */
        function arms(slice: string): Array<{ code: string; text: string }> {
            const marks: Array<{ code: string; at: number }> = [];
            for (const m of slice.matchAll(/if \(\s*error\?\.code === '([A-Z_]+)'/g)) {
                marks.push({ code: m[1], at: m.index ?? 0 });
            }
            return marks.map((mark, i) => ({
                code: mark.code,
                text: slice.slice(mark.at, i + 1 < marks.length ? marks[i + 1].at : slice.length),
            }));
        }

        it('the scan really sees the arms (a zero-match scan is a green that measured nothing)', () => {
            expect(arms(sharedClassification()).length).toBeGreaterThanOrEqual(8);
        });

        it('every arm relaying a producer sentence reads `sandboxBusinessMessage` first', () => {
            const excused = new Map(RAW_RELAY_ALLOWED.map((e) => [e.code, e.why]));
            const offenders: string[] = [];
            for (const arm of arms(sharedClassification())) {
                if (!arm.text.includes('error?.message') && !arm.text.includes('error.message')) continue;
                if (arm.text.includes('armSentence(')) continue;
                if (excused.has(arm.code)) continue;
                offenders.push(arm.code);
            }
            expect(offenders).toEqual([]);
        });

        it('the allowlist is not a dumping ground: every entry is a live arm with a real reason', () => {
            const slice = sharedClassification();
            for (const entry of RAW_RELAY_ALLOWED) {
                expect(slice).toContain(`error?.code === '${entry.code}'`);
                expect(entry.why.length).toBeGreaterThan(60);
            }
        });

        it('the `PERMISSION_DENIED` arm below the consult reads the shared rule too', () => {
            const a = SOURCE.indexOf('function classifyDataError(');
            const b = SOURCE.indexOf("if (typeof error?.innerMessage === 'string'", a + 1);
            expect(b).toBeGreaterThan(a);
            const aboveTheUnwrapDoor = SOURCE.slice(a, b);
            expect(aboveTheUnwrapDoor).toContain("error?.code === 'PERMISSION_DENIED'");
            expect(aboveTheUnwrapDoor).toContain('armSentence(');
        });
    });
});
