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

import { describe, it, expect, beforeAll } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { buildActionEngineFacade, ACTION_ENGINE_FIND_ENVELOPE_PRESCRIPTION } from './action-execution.js';

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

// ---------------------------------------------------------------------------
// The UNTYPED channel, through a REAL engine
// ---------------------------------------------------------------------------

/**
 * Everything above pins the ARGUMENT, against a double. That is the right
 * instrument for "the envelope goes through", and the wrong one for the
 * question this block asks, which is what a caller still on the WITHDRAWN
 * shape actually experiences — because the answer is produced by the engine,
 * and a double is free to be kinder than one.
 *
 * ## Why there is an untyped channel at all
 *
 * `buildActionEngineFacade` returns `any`, so the published declaration binds
 * a caller only where the caller opted into it. Three populations do not:
 * a handler in a JS config (`objectstack.config.js` / `.mjs` are accepted
 * spellings — `packages/cli/src/utils/config.ts`), a handler annotated with a
 * LOCAL copy of the context type (the pattern #15117 measured in this repo's
 * own example), and a `(ctx: any)` handler. ⛔ Metadata `type: 'script'` bodies
 * are NOT in this set: the sandbox `ScriptContext` exposes `api`, never
 * `engine`.
 *
 * ## What the engine does with a bare filter, and why one half was silent
 *
 * `ObjectQL.find` refuses option keys it does not execute (#4371) — but its
 * refusal deliberately EXEMPTS a `null` value, because on an option bag a
 * `null` is a withdrawal carrying no intent a drop could lose. On a FILTER
 * that rule is exactly wrong: `{ deleted_at: null }` is the "rows with no X"
 * idiom, and dropping it silently returns EVERY row — including the ones the
 * author was excluding — to a caller whose next line is often a delete.
 *
 * Before #15124 the facade wrapped its argument, so no filter key ever reached
 * that exemption. Removing the wrap without a refusal here would have opened
 * the silent path, which is why the arm now judges its own parameter against
 * the envelope's key set. The four rows below are that boundary, measured end
 * to end rather than argued.
 */

const PROBE_OBJECT = {
    name: 'probe_task',
    label: 'Probe Task',
    fields: {
        id: { type: 'text', label: 'Id' },
        status: { type: 'text', label: 'Status' },
        deleted_at: { type: 'datetime', label: 'Deleted at' },
    },
} as any;

/**
 * A real `ObjectQL` over a real driver, seeded with three rows.
 *
 * sqlite `:memory:` rather than `@objectstack/driver-memory`: #5704 migrated
 * this project's test backends to it and froze the memory driver's consumer
 * set, which `check:driver-memory-census` holds to a ruled ledger. A new
 * binding there would need a maintainer ruling, and nothing about this pin
 * needs that driver — what has to be REAL here is the ENGINE, because the
 * null-exemption this block is about is the engine's.
 */
async function makeRealEngine() {
    const engine = new ObjectQL();
    engine.registerDriver(new SqliteWasmDriver({ filename: ':memory:' }) as any, true);
    await engine.init();
    engine.registry.registerObject(PROBE_OBJECT, 'test');
    await engine.syncSchemas?.();

    const ctx = { isSystem: true } as any;
    // t3 carries a non-null `deleted_at`, so a filter that is HONOURED returns
    // two rows and a filter that is DROPPED returns three. Without it the
    // silent-drop row would be indistinguishable from a correct answer.
    await engine.insert('probe_task', { id: 't1', status: 'open', deleted_at: null }, { context: ctx });
    await engine.insert('probe_task', { id: 't2', status: 'completed', deleted_at: null }, { context: ctx });
    await engine.insert('probe_task', { id: 't3', status: 'open', deleted_at: '2026-01-01T00:00:00.000Z' }, { context: ctx });

    return engine;
}

/** Drive a call and hand back what it rejected with, or `undefined`. */
async function rejection(run: Promise<unknown>): Promise<unknown> {
    return run.then(() => undefined, (e: unknown) => e);
}

describe('#15124 — the withdrawn shape on the UNTYPED channel, through a real engine', () => {
    let engine: any;
    beforeAll(async () => { engine = await makeRealEngine(); });

    it('control — the envelope selects, through the real engine', async () => {
        const facade = buildActionEngineFacade(deps, engine, { userId: 'u1' });

        const rows = await facade.find('probe_task', { where: { status: 'completed' } });

        expect(rows.map((r: any) => r.id)).toEqual(['t2']);
    });

    it('control — the empty envelope is still the unfiltered read', async () => {
        const facade = buildActionEngineFacade(deps, engine, { userId: 'u1' });

        const rows = await facade.find('probe_task', {});

        expect(rows.map((r: any) => r.id).sort()).toEqual(['t1', 't2', 't3']);
    });

    it('REFUSES the withdrawn bare filter, and the refusal carries the `where` prescription', async () => {
        const facade = buildActionEngineFacade(deps, engine, { userId: 'u1' });

        const err = await rejection(facade.find('probe_task', { status: 'completed' }));

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain(ACTION_ENGINE_FIND_ENVELOPE_PRESCRIPTION);
        // The offending key is NAMED — a prescription with no subject sends the
        // reader back to a diff to find out which key it meant.
        expect((err as Error).message).toContain("'status'");
    });

    it('REFUSES a NULL-VALUED bare filter too — the row the engine\'s null exemption used to swallow', async () => {
        const facade = buildActionEngineFacade(deps, engine, { userId: 'u1' });

        const err = await rejection(facade.find('probe_task', { deleted_at: null }));

        // ⭐ THIS is the row the review failed the first cut on. Without the
        // arm's own refusal the engine's `value == null` exemption lets the key
        // through unexecuted and the call RESOLVES WITH ALL THREE ROWS — `t3`,
        // the one the author was excluding, included. A `toThrow()` with no
        // message assertion would not have caught it either: the shape that
        // must never come back is ROWS.
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain(ACTION_ENGINE_FIND_ENVELOPE_PRESCRIPTION);
        expect((err as Error).message).toContain("'deleted_at'");
        expect(Array.isArray(err)).toBe(false);
    });

    it('the refusal is loud INSTEAD of reading, not as well as — nothing was queried', async () => {
        const facade = buildActionEngineFacade(deps, engine, { userId: 'u1' });
        let reached = 0;
        const counting = new Proxy(engine, {
            get(target, prop, recv) {
                if (prop === 'find') return async (...args: unknown[]) => { reached += 1; return (target as any).find(...args); };
                return Reflect.get(target, prop, recv);
            },
        });
        const countingFacade = buildActionEngineFacade(deps, counting, { userId: 'u1' });

        await rejection(countingFacade.find('probe_task', { deleted_at: null }));

        expect(reached).toBe(0);
        // ...and the control proves the counter can move at all.
        await countingFacade.find('probe_task', { where: { status: 'completed' } });
        expect(reached).toBe(1);
        expect(facade).toBeDefined();
    });
});
