// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17619] `ActionEngineFacade.delete`'s PARTIAL-FAILURE shape, pinned against
 * the rejection cause the contract sentence is actually about.
 *
 * ## The sentence under pin
 *
 * `ActionEngineFacade.delete`'s member doc (`packages/spec/src/ui/
 * action-params.zod.ts`, declared by #15117) says of the array form:
 *
 * > There is no transaction around the set: a failure part-way through leaves
 * > the ids before it deleted and the ids after it untouched, and the rejection
 * > a caller sees is the one that stopped it.
 *
 * Three separable promises — earlier ids DELETED, later ids NEVER CALLED, and
 * the stopping rejection delivered AS-IS — and #17619 filed the observation
 * that nothing held the arm to them.
 *
 * ## What the sibling file already covers, and the narrow gap this closes
 *
 * `action-engine-facade-nullish-id.test.ts` (#17620) drives
 * `['case_1', null, 'case_3']` and does reach the sequential await loop: the
 * facade carries NO pre-guard — #17620 REMOVED the `if (id != null)` that used
 * to open the loop — so that rejection is already `ql.delete`'s own, raised by
 * the engine's dispatch predicate on a malformed `where.id`.
 *
 * What is left unpinned is the rejection's CAUSE, and the cause is what a
 * refactor can discriminate on. Every rejection pinned there is
 * `ENGINE_DELETE_REJECT_MESSAGE` — a MALFORMED-ARGUMENT refusal, raised
 * before the driver is asked to do anything. The causes the contract sentence
 * exists for are the opposite kind: a WELL-FORMED by-id delete that the
 * datastore refuses — a permission denial, a row lock, a driver error. An arm
 * that caught rejections, re-threw the dispatch refusal and swallowed the rest
 * would keep every case in that file green while silently continuing past a
 * permission denial to delete rows the caller was told were untouched: the one
 * violation of this contract that is invisible to the caller.
 *
 * So this file pins the same three promises against a WELL-FORMED id that the
 * engine double refuses for a datastore reason, and it pins the "never called"
 * half with an instrument the sibling does not have: the double records every
 * ATTEMPT, not only the deletions that succeeded, so "the ids after it are
 * untouched" is read off the calls the arm actually made rather than inferred
 * from an empty result.
 *
 * ⚠️ The as-is promise is pinned by OBJECT IDENTITY (`toBe`), not by message
 * equality. A wrapper that copied the message across would satisfy a message
 * comparison while destroying the `code`/`status` envelope an action handler
 * catches on — so the envelope is asserted too, on the object that came out.
 *
 * @see packages/runtime/src/action-execution.ts — `buildActionEngineFacade`.
 * @see packages/runtime/src/action-engine-facade-nullish-id.test.ts — the
 *      malformed-id half of the same loop, whose cases this file does not touch.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { buildActionEngineFacade } from './action-execution.js';

const deps: any = { resolveService: () => undefined, getObjectQL: async () => undefined };

/**
 * A datastore-side refusal of a WELL-FORMED by-id delete — the population the
 * contract sentence is about (permission denial, row lock, driver error), and
 * the one thing `ENGINE_DELETE_REJECT_MESSAGE` is NOT. Carries the
 * ADR-0112 envelope so the as-is assertion has something to be about beyond the
 * message text.
 */
class DatastoreRefusal extends Error {
    readonly code = 'PERMISSION_DENIED';
    readonly status = 403;
    constructor(id: string) {
        super(`row ${id} is not deletable by this caller`);
        this.name = 'DatastoreRefusal';
    }
}

interface DeleteAttempt {
    object: string;
    id: unknown;
    context: unknown;
}

interface RecordingEngine {
    attempted: DeleteAttempt[];
    deleted: DeleteAttempt[];
    insert(object: string, data: Record<string, unknown>): Promise<{ id: unknown }>;
    find(object: string, options?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
    count(object: string, options?: Record<string, unknown>): Promise<number>;
    delete(object: string, options?: Record<string, unknown>): Promise<{ ok: boolean }>;
}

/**
 * An engine double bound to the REAL engine's dispatch contract — the call to
 * {@link assertEngineDeleteDispatch} is the producer's own predicate, never a
 * mirrored `if` (`scripts/check-engine-double-contract.mjs`). Every id below is
 * a truthy scalar, so that predicate ACCEPTS all of them: the refusals this
 * double raises come from `refusals`, one layer past dispatch, which is the
 * whole point of the file.
 *
 * `attempted` records every delete that reached the double; `deleted` records
 * only the ones it let through. The pair is what separates "the id after the
 * failure was not deleted" from "the id after the failure was never asked for".
 */
function makeEngine(refusals: Record<string, Error> = {}): RecordingEngine {
    const attempted: DeleteAttempt[] = [];
    const deleted: DeleteAttempt[] = [];
    return {
        attempted,
        deleted,
        async insert(_object: string, data: Record<string, unknown>) {
            return { id: data?.id ?? 'rec_new' };
        },
        async find(_object: string, _options?: Record<string, unknown>) {
            return [];
        },
        async count(_object: string, _options?: Record<string, unknown>) {
            return 0;
        },
        async delete(object: string, options?: Record<string, unknown>) {
            assertEngineDeleteDispatch(options);
            const where = (options as { where?: Record<string, unknown> } | undefined)?.where;
            const id = where?.id;
            const context = (options as { context?: unknown } | undefined)?.context;
            attempted.push({ object, id, context });
            const refusal = typeof id === 'string' ? refusals[id] : undefined;
            if (refusal) throw refusal;
            deleted.push({ object, id, context });
            return { ok: true };
        },
    };
}

/** Drive the arm and hand back whatever it rejected with, or `undefined`. */
async function rejection(run: Promise<unknown>): Promise<unknown> {
    return run.then(
        () => undefined,
        (e: unknown) => e,
    );
}

const ids = (calls: DeleteAttempt[]): unknown[] => calls.map((c) => c.id);

describe('#17619 — a mid-array ql.delete rejection: the declared partial-failure shape', () => {
    it('stops at the refused id — earlier ids deleted, later ids NEVER CALLED, rejection as-is', async () => {
        const refusal = new DatastoreRefusal('case_2');
        const ql = makeEngine({ case_2: refusal });
        const engine = buildActionEngineFacade(deps, ql, { userId: 'u1', tenantId: 'org_acme' });

        const err = await rejection(engine.delete('crm_case', ['case_1', 'case_2', 'case_3']));

        // ③ "the rejection a caller sees is the one that stopped it" — the SAME
        //    object the producer threw: not wrapped, not re-thrown as a copy,
        //    not swallowed. Identity first, then the envelope it carries.
        expect(err).toBe(refusal);
        expect((err as DatastoreRefusal).code).toBe('PERMISSION_DENIED');
        expect((err as DatastoreRefusal).status).toBe(403);

        // ① "leaves the ids before it deleted"
        expect(ids(ql.deleted)).toEqual(['case_1']);

        // ② "and the ids after it untouched" — read off the ATTEMPTS, so an arm
        //    that carried on and was merely refused again could not pass it.
        expect(ids(ql.attempted)).toEqual(['case_1', 'case_2']);
    });

    it('delivers the FIRST rejection — a later refusal is never reached, let alone reported', async () => {
        const first = new DatastoreRefusal('case_2');
        const second = new DatastoreRefusal('case_3');
        const ql = makeEngine({ case_2: first, case_3: second });
        const engine = buildActionEngineFacade(deps, ql, { userId: 'u1' });

        const err = await rejection(engine.delete('crm_case', ['case_1', 'case_2', 'case_3']));

        expect(err).toBe(first);
        expect(err).not.toBe(second);
        expect(ids(ql.attempted)).toEqual(['case_1', 'case_2']);
        expect(ids(ql.deleted)).toEqual(['case_1']);
    });
});
