// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28861] A sandboxed body's `ctx.api.object(x)` write that the engine STORED,
 * but whose parent roll-up summary it could not recompute after it, answers
 * the write's own success inside the VM — for a hook, an action and a job body
 * alike, since all three get their API from one place (`buildSandboxApi`).
 *
 * ## The defect, measured on `origin/main` (`2af0ae2a`) before this file
 *
 * objectql's `SummaryRecomputeError` (`ERR_SUMMARY_RECOMPUTE`, "the triggering
 * records WERE written") crossed into the VM as the write's rejection, so the
 * body's next line never ran: a hook refused the write that fired it, an
 * action had no result, a job run failed — each for a write that had landed.
 *
 * ## What is pinned (seat ruling 6570987196)
 *
 * - the write answers in the VM what the repository answers when every
 *   roll-up recomputes, and the body runs on to its own result: the hook's
 *   patch is merged, the action's value returned, the job's outcome read;
 * - every source the sandbox builds its API from is covered: the engine's
 *   hook api, the host's `api` on an action context, and the
 *   `executionContext` + `createContext` fallback a job body takes;
 * - a refusal raised before the write is stored reaches the body exactly as
 *   before (NEGATIVE PIN).
 *
 * The repository is objectql's real `ScopedContext` over an engine double whose
 * writes apply and then throw objectql's own `SummaryRecomputeError`.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ScopedContext, SummaryRecomputeError } from '@objectstack/objectql';

import { actionBodyRunnerFactory, hookBodyRunnerFactory, jobBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000 });
const CHILD = 'stb_line';
const FAILURES = [{ childObject: CHILD, parentObject: 'stb_order', parentId: 'o1', field: 'line_total', error: new Error('sum over text') }];
const WRITE_CAPS = ['api.read', 'api.write'];

/** An engine whose writes apply and then report the stale roll-up, or refuse first on a `refused` payload. */
function makeEngine() {
    const writes: string[] = [];
    const refuse = () => Object.assign(new Error('Field "amount" must be a number'), { code: 'VALIDATION_FAILED', status: 400 });
    const engine: any = {
        insert: vi.fn(async (_object: string, data: any) => {
            if (data?.note === 'refused') throw refuse();
            writes.push(`insert:${data.id}`);
            throw new SummaryRecomputeError(FAILURES as any, { ...data });
        }),
        update: vi.fn(async (_object: string, data: any, options?: any) => {
            assertEngineUpdateDispatch(data, options);
            writes.push(`update:${options?.where?.id}`);
            throw new SummaryRecomputeError(FAILURES as any, { id: options?.where?.id, ...data });
        }),
        delete: vi.fn(async (_object: string, options?: any) => {
            assertEngineDeleteDispatch(options);
            writes.push(`delete:${options?.where?.id}`);
            throw new SummaryRecomputeError(FAILURES as any, { id: options?.where?.id });
        }),
        find: vi.fn(async () => []),
    };
    engine.createContext = (ec: any) => new ScopedContext(ec, engine);
    return { engine, writes };
}

const SYSTEM = { isSystem: true, userId: 'u_member', tenantId: 'org_1' };

let errorLog: ReturnType<typeof vi.spyOn>;
beforeAll(() => { errorLog = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { errorLog.mockRestore(); });

describe('[#28861] a sandboxed body\'s landed write answers its success in the VM', () => {
    it('hook body (the engine\'s hook api): the insert answers the record, the body runs on, its patch is merged', async () => {
        const { engine, writes } = makeEngine();
        const fn = hookBodyRunnerFactory(runner, { ql: engine, appId: 'stb' })({
            name: 'mirror_line', object: 'stb_order', events: ['beforeUpdate'],
            body: {
                language: 'js',
                capabilities: WRITE_CAPS,
                source: `const line = await ctx.api.object('${CHILD}').insert({ id: 'l1', amount: 5 });
                         return { last_line: line.id };`,
            },
        } as any)!;
        const engineCtx: any = { object: 'stb_order', event: 'beforeUpdate', input: { status: 'open' }, api: new ScopedContext(SYSTEM as any, engine) };
        await fn(engineCtx);
        expect(writes).toEqual(['insert:l1']);
        expect(engineCtx.input.last_line).toBe('l1');
    });

    it('action body (the host\'s api): update and delete answer, the body returns its own value', async () => {
        const { engine, writes } = makeEngine();
        const fn = actionBodyRunnerFactory(runner, { ql: engine, appId: 'stb' })({
            name: 'close_lines', object: 'stb_order', type: 'script',
            body: {
                language: 'js',
                capabilities: WRITE_CAPS,
                source: `const updated = await ctx.api.object('${CHILD}').update({ amount: 0 }, { where: { id: 'l1' } });
                         const deleted = await ctx.api.object('${CHILD}').delete({ where: { id: 'l2' } });
                         return { updated, deleted, closed: true };`,
            },
        })!;
        const value = await fn({ params: {}, record: {}, api: new ScopedContext(SYSTEM as any, engine), executionContext: SYSTEM });
        expect(writes).toEqual(['update:l1', 'delete:l2']);
        expect(value).toEqual({ updated: { id: 'l1', amount: 0 }, deleted: { id: 'l2' }, closed: true });
    });

    it('job body (the createContext fallback): the insert answers, the run reports its own outcome', async () => {
        const { engine, writes } = makeEngine();
        const fn = jobBodyRunnerFactory(runner, { ql: engine, appId: 'stb' })({
            name: 'nightly_lines',
            body: {
                language: 'js',
                capabilities: WRITE_CAPS,
                source: `const line = await ctx.api.object('${CHILD}').insert({ id: 'l3', amount: 1 });
                         return { outcome: 'completed', reason: 'wrote ' + line.id };`,
            },
        })!;
        const outcome = await fn({} as any);
        expect(writes).toEqual(['insert:l3']);
        expect(outcome).toEqual({ outcome: 'completed', reason: 'wrote l3' });
    });
});

describe('[#28861] a refusal raised before the write is stored reaches the body exactly as before (NEGATIVE PIN)', () => {
    it('the body is handed the refusal\'s code and status, nothing written', async () => {
        const { engine, writes } = makeEngine();
        const fn = actionBodyRunnerFactory(runner, { ql: engine, appId: 'stb' })({
            name: 'add_line', object: 'stb_order', type: 'script',
            body: {
                language: 'js',
                capabilities: WRITE_CAPS,
                source: `try {
                           await ctx.api.object('${CHILD}').insert({ id: 'l4', note: 'refused' });
                           return { landed: true };
                         } catch (e) {
                           return { refusedWith: e.code, status: e.status };
                         }`,
            },
        })!;
        const value = await fn({ params: {}, record: {}, api: new ScopedContext(SYSTEM as any, engine), executionContext: SYSTEM });
        expect(value).toEqual({ refusedWith: 'VALIDATION_FAILED', status: 400 });
        expect(writes).toEqual([]);
    });
});

describe('[#28861] the stale column is said, at error', () => {
    it('once per field per process', () => {
        const lines = errorLog.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes('could not be recomputed'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('"stb_order.line_total"');
    });
});
