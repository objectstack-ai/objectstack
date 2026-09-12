// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17620] `ActionEngineFacade.delete` no longer swallows a NULLISH element.
 *
 * ## What was here, and who could reach it
 *
 * The `delete` arm of {@link buildActionEngineFacade} normalises its argument
 * to a list and issues one `ql.delete` per id. It used to open that loop with
 * `if (id != null)`, so a nullish element was **silently skipped**: nothing
 * refused it, nothing warned, and the call resolved as though the deletion had
 * happened — a silent no-op on a destructive verb, which is the one failure a
 * caller cannot detect.
 *
 * The declared type is `string | string[]` (#15117), so **no typed caller ever
 * reached the guard** — the population is UNTYPED hosts: a JS host, or a
 * `registerAction` handler whose slot is still `(ctx: any)`. That is also why
 * this file is not a correction of #15117 / PR #17608: that card's contract
 * sentence is true, and this arm's declared behaviour is unchanged by the
 * removal.
 *
 * ## Why removing the guard is enough to make it loud
 *
 * Every id now reaches `ql.delete(object, { where: { id }, context })` as
 * written, and the engine's own dispatch predicate answers that call: a
 * `where.id` that is not a TRUTHY SCALAR is neither `by-id` nor (absent
 * `multi`) a bulk intent, so `ObjectQL.delete` throws
 * {@link ENGINE_DELETE_REJECT_MESSAGE}. The refusal is the producer's, not a
 * second copy of it — which is why the double below opens with
 * {@link assertEngineDeleteDispatch} rather than a hand-rolled id check: a
 * double looser than the engine would keep this file green against a facade
 * that still swallowed the value.
 *
 * ⚠️ The pin is the exported MESSAGE CONSTANT, compared exactly. This refusal
 * is a plain `Error` — it carries no ADR-0112 `code`/`status` — so a bare
 * `toThrow()` here would stay green against any unnamed `Error` at all, which
 * is precisely what an unfixed arm would have to produce to be believed.
 *
 * @see packages/runtime/src/action-execution.ts — `buildActionEngineFacade`.
 * @see packages/spec/src/ui/action-params.test.ts — the declaration's own pin,
 *      whose `@ts-expect-error` reads «"delete nothing" is the EMPTY ARRAY,
 *      never a null id».
 */

import { describe, it, expect } from 'vitest';
import { ENGINE_DELETE_REJECT_MESSAGE, assertEngineDeleteDispatch } from '@objectstack/objectql';
import { buildActionEngineFacade } from './action-execution.js';

const deps: any = { resolveService: () => undefined, getObjectQL: async () => undefined };

/**
 * An engine double whose `delete` is bound to the REAL engine's dispatch
 * contract: one call to the producer's own predicate, never a mirrored `if`.
 * Everything it accepts, a running server accepts; everything it refuses, a
 * running server refuses (`scripts/check-engine-double-contract.mjs`).
 */
function makeEngine() {
    const deleted: Array<{ object: string; id: unknown; context: unknown }> = [];
    const ql: any = {
        deleted,
        async insert(_object: string, data: Record<string, unknown>) {
            return { id: (data as Record<string, unknown>)?.id ?? 'rec_new' };
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
            deleted.push({ object, id: where?.id, context: (options as { context?: unknown } | undefined)?.context });
            return { ok: true };
        },
    };
    return ql;
}

/** Drive the arm and hand back whatever it rejected with, or `undefined`. */
async function rejection(run: Promise<unknown>): Promise<unknown> {
    return run.then(() => undefined, (e: unknown) => e);
}

describe('#17620 — ActionEngineFacade.delete refuses a nullish id', () => {
    it('refuses a nullish ELEMENT of the array form instead of skipping it', async () => {
        const ql = makeEngine();
        const engine = buildActionEngineFacade(deps, ql, { userId: 'u1' });

        const err = await rejection(engine.delete('crm_case', [null]));

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe(ENGINE_DELETE_REJECT_MESSAGE);
        // …and it is loud INSTEAD of deleting, not as well as: nothing landed.
        expect(ql.deleted).toEqual([]);
    });

    it('refuses a nullish SINGLE id (the non-array spelling) the same way', async () => {
        const ql = makeEngine();
        const engine = buildActionEngineFacade(deps, ql, { userId: 'u1' });

        for (const nullish of [null, undefined]) {
            const err = await rejection(engine.delete('crm_case', nullish));
            expect(err).toBeInstanceOf(Error);
            expect((err as Error).message).toBe(ENGINE_DELETE_REJECT_MESSAGE);
        }
        expect(ql.deleted).toEqual([]);
    });

    it('stops AT the nullish element — ids before it are deleted, ids after it untouched', async () => {
        const ql = makeEngine();
        const engine = buildActionEngineFacade(deps, ql, { userId: 'u1' });

        const err = await rejection(engine.delete('crm_case', ['case_1', null, 'case_3']));

        expect((err as Error).message).toBe(ENGINE_DELETE_REJECT_MESSAGE);
        // The declared partial-progress shape, unchanged: "a failure part-way
        // through leaves the ids before it deleted and the ids after it
        // untouched" (`ActionEngineFacade.delete`'s member doc).
        expect(ql.deleted.map((d: { id: unknown }) => d.id)).toEqual(['case_1']);
    });
});

describe('#17620 — controls: the declared contract is untouched', () => {
    it('a well-formed single id still deletes', async () => {
        const ql = makeEngine();
        const engine = buildActionEngineFacade(deps, ql, { userId: 'u1', tenantId: 'org_acme' });

        await expect(engine.delete('crm_case', 'case_1')).resolves.toBeUndefined();

        expect(ql.deleted).toHaveLength(1);
        expect(ql.deleted[0]).toMatchObject({ object: 'crm_case', id: 'case_1' });
        // the elevated caller envelope still rides every call (#3914)
        expect(ql.deleted[0].context).toMatchObject({ isSystem: true, userId: 'u1', tenantId: 'org_acme' });
    });

    it('the declared ARRAY form still deletes every id, in order, one call each', async () => {
        const ql = makeEngine();
        const engine = buildActionEngineFacade(deps, ql, { userId: 'u1' });

        await expect(engine.delete('crm_case', ['case_1', 'case_2', 'case_3'])).resolves.toBeUndefined();

        expect(ql.deleted.map((d: { id: unknown }) => d.id)).toEqual(['case_1', 'case_2', 'case_3']);
    });

    it('an empty array still deletes nothing and resolves', async () => {
        const ql = makeEngine();
        const engine = buildActionEngineFacade(deps, ql, { userId: 'u1' });

        await expect(engine.delete('crm_case', [])).resolves.toBeUndefined();

        expect(ql.deleted).toEqual([]);
    });
});
