// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15124] `ActionEngineFacade.find` passes the engine's QUERY ENVELOPE
 * through — the double-wrap is gone.
 *
 * ## What this pins, and why the declaration's own pin is not enough
 *
 * The spec half (`packages/spec/src/ui/action-params.test.ts`) pins what the
 * DECLARATION admits and refuses, in the tsc channel. It cannot pin what the
 * runtime does with the value, and the defect this card closes lived exactly
 * there: the arm built the envelope itself, so an author who wrote the
 * engine's own envelope reached `ql.find` as `{ where: { where: … } }` — a
 * filter on a field named `where`, which matches no row and resolves to `[]`
 * with no error at all. A type change alone would have left that arm free to
 * keep wrapping, and the two halves would have disagreed in silence: exactly
 * the shape #14175 found and could not close.
 *
 * So the assertions here are about the ARGUMENT the engine actually received,
 * not about the rows that came back. A pin that only checked "rows came back"
 * is what the original defect passed: the reporting app's own hand-written
 * double read `query.where` and agreed with the mistake all the way down.
 *
 * ## The three clauses
 *
 * 1. **Pass-through, verbatim.** Every envelope key an author writes reaches
 *    `ql.find` under its own name — `where` as `where`, and `fields`,
 *    `orderBy`, `limit` beside it. Under the old arm the whole bag landed
 *    nested under `where` and the projection/paging keys were unreachable from
 *    a handler at all.
 * 2. **No wrap, and no second `where`.** The negative half of clause 1, stated
 *    separately because it is the one an accidental re-wrap would break while
 *    clause 1 stayed green.
 * 3. **`context` is the facade's.** The envelope carries `context` because
 *    every engine option bag does, but this facade is trusted and context-less
 *    by design (#3914, ADR-0096) — the elevated context it builds wins over a
 *    caller-supplied one. That is a security-shaped property of a spread
 *    ORDER, which is one edit away from silently inverting.
 *
 * @see packages/runtime/src/action-execution.ts — `buildActionEngineFacade`.
 * @see packages/spec/src/ui/action-params.zod.ts — the member doc of record.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { buildActionEngineFacade } from './action-execution.js';

const deps: any = { resolveService: () => undefined, getObjectQL: async () => undefined };

/**
 * An engine double that RECORDS the options bag its `find` was handed. Its
 * `delete` is bound to the real engine's dispatch contract through the
 * producer's own predicate rather than a mirrored `if`
 * (`scripts/check-engine-double-contract.mjs`).
 */
function makeEngine(rows: Array<Record<string, unknown>> = []) {
    const found: Array<{ object: string; options: Record<string, unknown> | undefined }> = [];
    const ql: any = {
        found,
        async insert(_object: string, data: Record<string, unknown>) {
            return { id: (data as Record<string, unknown>)?.id ?? 'rec_new' };
        },
        async find(object: string, options?: Record<string, unknown>) {
            found.push({ object, options });
            return rows;
        },
        async count(_object: string, _options?: Record<string, unknown>) {
            return rows.length;
        },
        async delete(object: string, options?: Record<string, unknown>) {
            assertEngineDeleteDispatch(options);
            return { ok: true, object };
        },
    };
    return ql;
}

describe('#15124 — ActionEngineFacade.find passes the engine query envelope through', () => {
    it('hands every envelope key to the engine under its own name', async () => {
        const ql = makeEngine([{ id: 'tsk_1' }]);
        const engine = buildActionEngineFacade(deps, ql, { userId: 'u1' });

        await engine.find('todo_task', {
            where: { status: 'completed' },
            fields: ['id', 'subject'],
            orderBy: [{ field: 'due_date', order: 'asc' }],
            limit: 50,
        });

        const [call] = ql.found;
        expect(call.object).toBe('todo_task');
        expect(call.options.where).toEqual({ status: 'completed' });
        expect(call.options.fields).toEqual(['id', 'subject']);
        expect(call.options.orderBy).toEqual([{ field: 'due_date', order: 'asc' }]);
        expect(call.options.limit).toBe(50);
    });

    it('does NOT wrap — the filter the author wrote under `where` stays one level deep', async () => {
        const ql = makeEngine();
        const engine = buildActionEngineFacade(deps, ql, { userId: 'u1' });

        await engine.find('todo_task', { where: { status: 'completed' } });

        const where = ql.found[0].options.where as Record<string, unknown>;
        // The defect this card closes, stated as an assertion: the old arm
        // produced `{ where: { where: { status: … } } }`, which matched no row.
        expect(where).not.toHaveProperty('where');
        expect(where).toEqual({ status: 'completed' });
    });

    it('the unfiltered read stays unfiltered — `{}` carries no `where` at all', async () => {
        const ql = makeEngine();
        const engine = buildActionEngineFacade(deps, ql, { userId: 'u1' });

        await engine.find('todo_task', {});

        expect(ql.found[0].options).not.toHaveProperty('where');
    });

    it('stamps the facade\'s OWN elevated context, and a caller-supplied `context` does not displace it', async () => {
        const ql = makeEngine();
        const engine = buildActionEngineFacade(deps, ql, { userId: 'u1', tenantId: 'org_acme' });

        await engine.find('todo_task', {
            where: { status: 'open' },
            context: { userId: 'someone_else', isSystem: false },
        } as never);

        const context = ql.found[0].options.context as Record<string, unknown>;
        // The facade is trusted and context-less by design: what a caller put
        // in the envelope reads as authorization and is none.
        expect(context).toBeDefined();
        expect(context.userId).not.toBe('someone_else');
        expect(context.isSystem).toBe(true);
    });
});
