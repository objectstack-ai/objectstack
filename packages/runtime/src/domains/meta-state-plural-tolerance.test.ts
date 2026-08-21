// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The legacy dispatcher `/meta` if-chain answers the FSM state read under
 * BOTH spellings — `objects` and `object` — and that is a DELIBERATE,
 * RULED state, not residue nobody has got to yet.
 *
 * ## Why this file exists at all
 *
 * `route-ledger.ts` records this asymmetry in a `note`, and its own
 * conformance test says so in as many words: *"The ledger's per-route rows
 * are documentation; the machine contract here is domain-level"*. Nothing
 * checked that note against the code. A ledger note that quietly stops being
 * true passes every gate in this repo and is then trusted INSTEAD of the
 * source — so the note's load-bearing clause is pinned here as behaviour.
 *
 * ⇒ Delete the plural arm in `domains/meta.ts` and this file fails, pointing
 * at the ruling that has to be reopened first. That is the whole point: the
 * arm is protected by a decision, and the decision is now enforceable.
 *
 * ## The asymmetry, measured on both sides
 *
 * | front door | `/meta/objects/:name/state/:field` | pinned by |
 * |---|---|---|
 * | **REST** (`packages/rest` `RestServer`) | **transport 404** — no registration to match | `meta-published-and-state-routes.dogfood.test.ts`, `route-ledger-live-mount-parity.dogfood.test.ts`, `meta-route-registration-order.test.ts` |
 * | **`dispatch()`** (the `@objectstack/hono` `createHonoApp` catch-all — the documented embed shape) | **200, answered** | THIS FILE |
 *
 * `createMetaDomain` registers prefix `/meta` and hands the remainder to
 * `handleMetadataRequest`, whose FSM branch matches a hard-coded literal
 * PAIR. So the spelling that REST stopped registering in #9180 step ② is
 * still served wherever the dispatcher is the front door.
 *
 * ## Why it stays — the provenance, so nobody has to guess
 *
 * The maintainer's 2026-08-17 re-weigh of the #9180 ruling, item 3, verbatim
 * and untranslated:
 *
 * > 「② 照原样做；只需要修正 objectstack objectui cloud 中错误的写法。」
 *
 * which the re-weigh records as: the boundary's tolerance stays for external
 * callers, **no new refusals beyond what step ① already shipped**, the
 * external break deferred with no scheduled window — reopening it is the
 * maintainer's call. Narrowing this arm would be a new refusal on a SECOND
 * surface, so it is out of every step's scope by construction.
 *
 * ⛔ **This is NOT the `META_URL_TO_SINGULAR` fold** whose retirement was
 * deferred, and conflating the two is the specific error to avoid. The fold
 * is a MAP consulted for `/meta/:type` requests; this is a literal `||` in an
 * if-chain that no request ever routes through the fold to reach. They are
 * separate mechanisms under separate decisions. The cases below make the
 * difference observable rather than asserted: `objectss`, `objectz` and even
 * `OBJECTS` all 404, because a literal pair recognises two spellings and
 * nothing else — a fold would have normalised at least one of them.
 *
 * ⛔ And it is NOT "the plural is supported". It is TOLERATED on one front
 * door and REFUSED on another. Flattening that in either direction is the
 * misreading this pin exists to prevent — hence the ledger-note assertion at
 * the bottom, which requires the row to keep naming both spellings.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';
import { ROUTE_LEDGER } from '../route-ledger.js';

/**
 * One object with one `state_machine` rule. Mirrors the fixture the dogfood
 * pin drives over real HTTP, so the two sides of the table above are
 * comparing the same question.
 */
const SCHEMA = {
    name: 'task',
    label: 'Task',
    fields: { id: { type: 'text' }, status: { type: 'text' } },
    validations: [
        {
            type: 'state_machine',
            name: 'task_status_fsm',
            field: 'status',
            transitions: { todo: ['backlog', 'in_progress'], done: [] },
        },
    ],
};

function boot() {
    const getObject = vi.fn((name: string) => (name === 'task' ? SCHEMA : undefined));
    const objectql = { registry: { getObject } };

    // `dispatch()` re-resolves identity and overwrites any injected
    // `executionContext`, so the session has to come through the real
    // resolver — otherwise the domain's anonymous-deny answers 401 before the
    // route is ever looked at and the pin would measure the wrong refusal.
    const auth = { api: { getSession: async () => ({ user: { id: 'u_session' } }) } };

    const services: Record<string, any> = { objectql, auth };
    const get = (n: string) => services[n] ?? null;
    const kernel = {
        context: { getService: get },
        getService: get,
        getServiceAsync: async (n: string) => get(n),
    } as any;

    return { dispatcher: new HttpDispatcher(kernel), getObject };
}

const CTX = (): any => ({ request: { headers: {} }, environmentId: 'platform' });

/** The one answer both spellings must produce, spelled once. */
const ANSWER = { object: 'task', field: 'status', from: 'todo', next: ['backlog', 'in_progress'] };

describe('dispatcher /meta FSM state read — the deliberate plural tolerance (#10179)', () => {
    it('answers the CANONICAL singular spelling (control)', async () => {
        const { dispatcher } = boot();

        const res = await dispatcher.dispatch(
            'GET', '/meta/object/task/state/status', undefined, { from: 'todo' }, CTX(),
        );

        expect(res.response?.status ?? 200).toBe(200);
        expect(res.response?.body?.data).toEqual(ANSWER);
    });

    it('ALSO answers the plural spelling — the tolerance the 2026-08-17 re-weigh left in place', async () => {
        const { dispatcher } = boot();

        const res = await dispatcher.dispatch(
            'GET', '/meta/objects/task/state/status', undefined, { from: 'todo' }, CTX(),
        );

        // ⛔ Do not "fix" this to a 404 because the REST twin is retired. That
        // is option (a) of #10179 — a new refusal on a second surface — and it
        // needs the maintainer, not a passing thought in a nearby diff.
        expect(res.response?.status ?? 200).toBe(200);
        expect(res.response?.body?.data).toEqual(ANSWER);
    });

    it('both spellings reach the SAME handler, not two lookalike answers', async () => {
        // The two cases above could in principle be served by different code
        // paths that happen to agree. `getObject` being called with the same
        // canonical object name from both is what makes them one branch.
        const singular = boot();
        await singular.dispatcher.dispatch(
            'GET', '/meta/object/task/state/status', undefined, { from: 'todo' }, CTX(),
        );
        const plural = boot();
        await plural.dispatcher.dispatch(
            'GET', '/meta/objects/task/state/status', undefined, { from: 'todo' }, CTX(),
        );

        expect(singular.getObject).toHaveBeenCalledWith('task');
        expect(plural.getObject).toHaveBeenCalledWith('task');
    });

    it.each(['objectss', 'objectz', 'OBJECTS'])(
        'tolerates EXACTLY the two literals — `%s` is not answered',
        async (segment) => {
            // The control that stops this file passing vacuously: if the pin
            // above were green because the harness answers everything, these
            // would be answered too. Measured, not assumed — all three return
            // 404 RESOURCE_NOT_FOUND.
            //
            // It is also the sharpest evidence for the ⛔ in this file's header:
            // a hard-coded literal pair recognises `objects` and NOTHING else,
            // not even its own uppercase. A fold would have normalised at least
            // one of these. This arm never reaches `META_URL_TO_SINGULAR`.
            const { dispatcher } = boot();

            const res = await dispatcher.dispatch(
                'GET', `/meta/${segment}/task/state/status`, undefined, { from: 'todo' }, CTX(),
            );

            expect(res.response?.status).toBe(404);
            expect(res.response?.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
            expect(res.response?.body?.data).toBeUndefined();
        },
    );

    it('the plural is a TOLERANCE, not a second contract — an unknown object still 404s under it', async () => {
        // Keeps the pin honest in the other direction: the plural arm is the
        // same handler with the same refusals, not a laxer door.
        const { dispatcher } = boot();

        const res = await dispatcher.dispatch(
            'GET', '/meta/objects/zzz_not_a_real_object/state/status', undefined, { from: 'todo' }, CTX(),
        );

        expect(res.response?.status).toBe(404);
    });

    it('the ledger row keeps NAMING the asymmetry — the note is checked, not trusted', () => {
        const row = ROUTE_LEDGER.find((e) => e.route === 'GET /meta/object/:name/state/:field');
        expect(row, 'the FSM state row must exist in the dispatcher ledger').toBeDefined();

        // The row lists the CANONICAL spelling of a branch that answers two.
        // A row that stops saying so is a row that has started lying about the
        // surface — the exact failure this file was added to make loud.
        const note = row?.note ?? '';
        expect(note).toContain('objects');
        expect(note).toContain('object');

        // …and it must keep the tolerance's provenance reachable, so the next
        // author finds the ruling instead of re-deriving it from the if-chain.
        expect(note).toContain('2026-08-17');
    });
});
