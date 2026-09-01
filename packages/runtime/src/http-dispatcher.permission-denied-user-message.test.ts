// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13623] The DENIAL door carries the producer's `userMessage` — the second
 * door that dropped it, and the one whose refusals users most need to read.
 *
 * ## Why this is a second door and not the one #13241 repaired
 *
 * `HttpDispatcher.dispatch`'s foot catch is **not a pure rethrow**. It
 * recognises `isPermissionDeniedError` — `name === 'PermissionDeniedError'`
 * **or** `code === 'PERMISSION_DENIED'` **or** a message starting
 * `[Security] Access denied` — and answers it itself, from
 * `packages/runtime/src/http-dispatcher.ts`. Such a throw therefore never
 * reaches `dispatcher-plugin`'s `errorResponseBase`, which is the exit #13241
 * taught to carry the mark. Same field, same contract, different door.
 *
 * `ApiErrorSchema.userMessage` has declared the slot all along, and
 * `contract.zod.ts` states the invariant one line up — *"`userMessage` on the
 * thrown error; the boundaries carry it to the wire"*. So this is
 * `declared ≠ enforced` at one more boundary, not a new field.
 *
 * ## Why THIS door matters more than its size suggests
 *
 * #9934 made the mark **status-agnostic** precisely so a 403 could carry it,
 * and a 403 is the refusal class most likely to carry deliberately-authored
 * text: *"You do not have access to this report; ask an admin for the Reporting
 * role"* is exactly the sentence a producer marks. The one door that swallowed
 * the mark was the one answering those refusals.
 *
 * ## ⛔ What this does NOT change — #7450's disclosure withhold
 *
 * The 2026-08-11 ruling on #7450 is about `error.details`: `plugin-security`
 * attaches `{ operation, object, positions, permissionSets }` to every
 * `PermissionDeniedError`, and none of it goes on the wire — the response's
 * `object` is derived from the ROUTE, never from `details.object` (which, on a
 * cascade delete, names a CHILD the caller never addressed). `§3` drives that
 * exact fixture **with a mark present**, so the repair cannot be read as
 * loosening the withhold: the marked channel is authored end-user text,
 * carried as a declared top-level sibling of `code`/`message`, and platform and
 * driver code never set it.
 *
 * That same ruling is also why the change is owed: it makes REST's shape the
 * contract for BOTH transports, and REST's shape has carried the mark on this
 * identical denial since #9934 (`mapDataError` = `withDeclaredUserMessage` over
 * `classifyDataError`, pinned in
 * `packages/rest/src/rest-user-facing-refusal-marking.test.ts`). The
 * dispatcher's 403 was the one that differed. `§6` pins the parity.
 *
 * ## ⛔ Absence is asserted twice, because one limb is blind
 *
 * `JSON.stringify` silently drops a key whose value is `undefined`, so a byte
 * assertion alone cannot tell "omitted" from "emitted as `undefined`" — and the
 * second is a real defect, since a consumer's `in` / `hasOwn` probe answers
 * `true` for it and loses the generic substitution absence is supposed to keep
 * (#3821). Every omission case below therefore asserts on `Object.keys(error)`
 * **and** on the serialized bytes. The same discipline as the sibling door's
 * suite, restated here rather than imported: these two files pin two doors, and
 * a shared helper would make one file's green depend on the other's.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import { PermissionDeniedError } from '@objectstack/plugin-security';

/** The end-user sentence an author marks — no API names, no diagnostics. */
const MARK = 'You do not have access to this report. Ask an admin for the Reporting role.';

/** The developer-facing half, which must keep its own wording. */
const PROSE = "[Security] Access denied: operation 'update' on object 'app_parent_object' is not permitted";

/**
 * REST's answer to the SAME marked denial, transcribed rather than imported.
 *
 * `@objectstack/rest`'s public entry does not re-export `mapDataError`, and
 * reaching into its source from here drags eleven of that package's modules
 * outside this package's `rootDir` (TS6059) — the reasoning
 * `./domains/data-permission-denied-envelope.test.ts` already recorded for the
 * unmarked fixture, and a repair must not widen the reference package's API
 * surface to buy itself a test. So parity is pinned by TWO tests over ONE
 * shape: `packages/rest/src/rest-user-facing-refusal-marking.test.ts` asserts
 * REST's `PERMISSION_DENIED` 403 carries `userMessage` (*"rides the
 * structured-code branches too — a hook throwing the catalog
 * PERMISSION_DENIED"*), and this file asserts the dispatcher agrees. Change
 * either side and the other side's pin fails.
 */
const REST_MARKED_DENIAL = {
    error: PROSE,
    code: 'PERMISSION_DENIED',
    object: 'app_parent_object',
    userMessage: MARK,
} as const;

/**
 * A denial raised while cascading a delete into a child: the gate's own
 * `object` is the CHILD, which the caller never named. Fully populated on
 * purpose — a fixture with an empty `details` would pass against a dispatcher
 * that spread the payload onto the wire and would prove nothing about §3.
 */
const cascadeChildDenial = (props: Record<string, unknown> = {}) =>
    Object.assign(
        new PermissionDeniedError(
            PROSE,
            {
                operation: 'delete',
                object: 'app_child_object',
                positions: ['org_member', 'everyone'],
                permissionSets: ['app_reader'],
            },
            "[Security] Access denied: operation 'delete' on object 'app_child_object' " +
                'is not permitted for positions [org_member, everyone]',
        ),
        props,
    );

const CALLER = () =>
    ({
        request: {},
        executionContext: {
            userId: 'u_test',
            isSystem: false,
            positions: ['org_member', 'everyone'],
            permissions: ['app_reader'],
            systemPermissions: [],
        },
    }) as any;

/**
 * The two-limbed absence assertion. ⛔ Never use one limb alone — see the module
 * docblock.
 */
function expectNoMarkAnywhere(response: any) {
    const error = response?.body?.error;
    expect(Object.keys(error)).not.toContain('userMessage');
    expect(Object.prototype.hasOwnProperty.call(error, 'userMessage')).toBe(false);
    expect(JSON.stringify(response?.body)).not.toContain('userMessage');
}

describe('[#13623] the dispatcher denial door carries `userMessage`', () => {
    let dispatcher: HttpDispatcher;
    let mockObjectQL: any;
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockObjectQL = {
            insert: vi.fn(),
            // The protocol-less `/data` fallback reads the row before writing
            // it, so the pre-read has to succeed for the WRITE's denial to be
            // the error under test.
            find: vi.fn().mockResolvedValue([{ id: '1' }]),
            update: vi.fn(),
            delete: vi.fn(),
            getObjects: vi.fn().mockReturnValue({}),
            registry: { getObject: vi.fn().mockReturnValue({ name: 'app_parent_object' }) },
        };
        const kernel = {
            context: {
                getService: (name: string) => (name === 'objectql' ? mockObjectQL : null),
            },
        } as any;
        dispatcher = new HttpDispatcher(kernel);
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warn.mockRestore();
    });

    const dispatch = (method: string, path: string, body?: any) =>
        dispatcher.dispatch(method, path, body, {}, CALLER());

    /** Drive the real `/data` write route with `thrown` refused by the engine. */
    const denyUpdateWith = async (thrown: unknown) => {
        mockObjectQL.update.mockRejectedValue(thrown);
        return dispatch('PATCH', '/data/app_parent_object/1', { name: 'x' });
    };

    describe('§1 all three recognition limbs — the mark rides out of the foot catch', () => {
        /**
         * `isPermissionDeniedError` is a THREE-limbed duck-typed matcher, and
         * the door answers on any of them. A repair pinned on one limb only
         * would leave two silent holes, so each is driven separately with a
         * fixture that reaches the catch through that limb alone.
         */
        const LIMBS: Array<{ limb: string; thrown: () => unknown }> = [
            {
                limb: "`name === 'PermissionDeniedError'` — the real error class",
                thrown: () =>
                    Object.assign(
                        new PermissionDeniedError(PROSE, { operation: 'update', object: 'app_parent_object' }),
                        { userMessage: MARK },
                    ),
            },
            {
                limb: "`code === 'PERMISSION_DENIED'` — a plain throw spelling the catalog code",
                thrown: () => Object.assign(new Error(PROSE), { code: 'PERMISSION_DENIED', userMessage: MARK }),
            },
            {
                limb: '`[Security] Access denied` message prefix — neither name nor code',
                thrown: () => Object.assign(new Error(PROSE), { userMessage: MARK }),
            },
        ];

        for (const c of LIMBS) {
            it(`${c.limb} → the mark reaches the wire verbatim`, async () => {
                const r = await denyUpdateWith(c.thrown());

                // Positive identity first: the absence/presence assertions
                // below only mean something on a body that really is the
                // denial this door answers.
                expect(r.response?.status).toBe(403);
                expect(r.response?.body?.error?.code).toBe('PERMISSION_DENIED');

                expect(r.response?.body?.error?.userMessage).toBe(MARK);
                // Verbatim: not truncated, not re-wrapped, not merged into
                // `message` — the diagnostic channel keeps its own wording.
                expect(JSON.stringify(r.response?.body)).toContain(MARK);
                expect(r.response?.body?.error?.message).toBe(PROSE);
            });
        }

        it('the mark is a declared SIBLING of `code`/`message`, ⛔ never `details` context', async () => {
            // Where the string lands is the envelope decision (#9232 keeps
            // vocabulary and position apart). `ApiErrorSchema.userMessage` is a
            // top-level optional; a repair that parked it in `details` would
            // satisfy a naive byte assertion and put authored text inside the
            // very bag #7450 rules on.
            const r = await denyUpdateWith(
                Object.assign(new Error(PROSE), { code: 'PERMISSION_DENIED', userMessage: MARK }),
            );

            expect(r.response?.body?.error?.userMessage).toBe(MARK);
            expect((r.response?.body?.error?.details as any)?.userMessage).toBeUndefined();
            // The route-derived object is still the only `details` member.
            expect(r.response?.body?.error?.details).toEqual({ object: 'app_parent_object' });
        });
    });

    describe('§2 positive controls — presence is a measured difference, not a constant', () => {
        it('the SAME route and the SAME denial WITHOUT a mark omits the key entirely', async () => {
            const marked = await denyUpdateWith(
                Object.assign(new Error(PROSE), { code: 'PERMISSION_DENIED', userMessage: MARK }),
            );
            const unmarked = await denyUpdateWith(
                Object.assign(new Error(PROSE), { code: 'PERMISSION_DENIED' }),
            );

            expect(marked.response?.body?.error?.userMessage).toBe(MARK);
            expectNoMarkAnywhere(unmarked.response);
            // The ONLY difference is the mark: same status, same code.
            expect(marked.response?.status).toBe(unmarked.response?.status);
            expect(marked.response?.body?.error?.code).toBe(unmarked.response?.body?.error?.code);
        });

        it('an unmarked denial is byte-identical to before — the key set is unchanged', async () => {
            // The regression guard on the whole change: if the field were
            // synthesised from `message` rather than read from the throw, every
            // denial would start shipping platform prose in the marked channel,
            // which is the #3821 leak the field exists to prevent.
            const r = await denyUpdateWith(cascadeChildDenial());

            expect(Object.keys(r.response?.body?.error ?? {}).sort()).toEqual([
                'code', 'details', 'httpStatus', 'message',
            ]);
            expectNoMarkAnywhere(r.response);
        });

        it('a marked denial adds EXACTLY one key and smuggles nothing else', async () => {
            const r = await denyUpdateWith(cascadeChildDenial({ userMessage: MARK }));

            expect(Object.keys(r.response?.body?.error ?? {}).sort()).toEqual([
                'code', 'details', 'httpStatus', 'message', 'userMessage',
            ]);
        });
    });

    describe('§3 ⛔ #7450 is untouched — the withheld diagnostics stay withheld WITH a mark present', () => {
        it('never serialises positions, permissionSets, or a cascade child the caller never named', async () => {
            const r = await denyUpdateWith(cascadeChildDenial({ userMessage: MARK }));

            expect(r.response?.status).toBe(403);
            expect(r.response?.body?.error?.userMessage).toBe(MARK);

            const wire = JSON.stringify(r.response?.body);
            expect(wire).not.toContain('positions');
            expect(wire).not.toContain('permissionSets');
            expect(wire).not.toContain('org_member');
            expect(wire).not.toContain('app_reader');
            expect(wire).not.toContain('app_child_object');
            expect(wire).not.toContain('developerMessage');
            // The route names the object, so THAT one still rides — the caller
            // named it themselves.
            expect(r.response?.body?.error?.details).toEqual({ object: 'app_parent_object' });
        });

        it('still logs the withheld diagnostics server-side, exactly once', async () => {
            await denyUpdateWith(cascadeChildDenial({ userMessage: MARK }));

            const lines = warn.mock.calls
                .map((c: unknown[]) => String(c[0]))
                .filter((l: string) => l.includes('PERMISSION_DENIED'));
            expect(lines).toHaveLength(1);
            const line = lines[0]!;
            expect(line).toContain('PATCH /data/app_parent_object/1');
            expect(line).toContain('object=app_child_object');
            expect(line).toContain('positions=[org_member, everyone]');
            expect(line).toContain('permissionSets=[app_reader]');
        });
    });

    describe('§4 omission is real absence, ⛔ never an `undefined` value', () => {
        /**
         * Each row is a shape `declaredUserMessage` (`@objectstack/types`)
         * answers `undefined` for. The rule is deliberately NOT re-implemented
         * here — these drive the real door and read the wire, so a door that
         * grew its own inline `typeof` probe fails them.
         */
        const NOT_A_DECLARATION: Array<{ name: string; userMessage: unknown }> = [
            { name: 'empty string', userMessage: '' },
            { name: 'whitespace only', userMessage: '   \t\n ' },
            { name: 'a number, not a string', userMessage: 42 },
            { name: 'null', userMessage: null },
            { name: 'an object', userMessage: { text: 'nope' } },
        ];

        for (const c of NOT_A_DECLARATION) {
            it(`${c.name} → the key is absent, not present-and-undefined`, async () => {
                const r = await denyUpdateWith(
                    Object.assign(new Error(PROSE), { code: 'PERMISSION_DENIED', userMessage: c.userMessage }),
                );

                expect(r.response?.status).toBe(403);
                expectNoMarkAnywhere(r.response);
            });
        }

        it('⛔ the guard itself is falsifiable — it REJECTS a present-but-undefined key', () => {
            // The omission assertion is load-bearing and its own failure mode is
            // silence. `JSON.stringify` drops the key, so the byte limb alone
            // reports this envelope as clean — which is why the guard does not
            // rely on it.
            const leaked = { body: { error: { code: 'X', message: 'y', httpStatus: 403, userMessage: undefined } } };
            expect(JSON.stringify(leaked.body)).not.toContain('userMessage'); // the blind limb, demonstrated blind
            expect(() => expectNoMarkAnywhere(leaked)).toThrow();             // the guard still catches it
        });
    });

    describe('§5 the mark never MOVES the answer (#9934 third constraint)', () => {
        it('a marked denial is still the same 403 PERMISSION_DENIED', async () => {
            const r = await denyUpdateWith(
                Object.assign(new Error(PROSE), { code: 'PERMISSION_DENIED', userMessage: MARK, status: 200 }),
            );

            // `status: 200` on the throw is deliberate: the denial door does not
            // read the throw's status at all, and a repair that started routing
            // this class through the status-reading sibling would surface here.
            expect(r.response?.status).toBe(403);
            expect(r.response?.body?.error?.httpStatus).toBe(403);
            expect(r.response?.body?.error?.code).toBe('PERMISSION_DENIED');
        });
    });

    describe('§6 transport parity — the two doors answer the same denial the same way', () => {
        it('discloses exactly what @objectstack/rest discloses, mark included', async () => {
            const r = await denyUpdateWith(
                Object.assign(new PermissionDeniedError(PROSE, { operation: 'update', object: 'app_parent_object' }), {
                    userMessage: MARK,
                }),
            );
            const error = r.response?.body?.error;

            expect(r.response?.status).toBe(403);
            // The two envelopes NEST differently (REST is flat, the dispatcher
            // wraps in `success`/`error`) and this card does not change that.
            // What has to agree is the semantic content.
            expect({
                error: error?.message,
                code: error?.code,
                object: (error?.details as { object?: string } | undefined)?.object,
                userMessage: error?.userMessage,
            }).toEqual({ ...REST_MARKED_DENIAL });
        });
    });
});
