// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `AutomationEngine.dryRun` (#33661) against `IAutomationService.dryRun`'s
 * docblock: each node class the in-app v2-narrow tier offers (create_record,
 * update_record, assignment, decision, approval), the admission refusals, and
 * the "unarmed, unregistered, nothing written, nothing sent" promises.
 *
 * The data engine below records every call it receives, so "writes nothing"
 * is read off the calls it never got, not off the result.
 */
import { describe, it, expect } from 'vitest';
import { AI_ACCOUNT_ELEVATED_START_REFUSAL, createMemoryI18n, requiredPermissionsRefusal } from '@objectstack/core';
import {
    assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch,
    ENGINE_DELETE_REJECT_MESSAGE, ENGINE_UPDATE_REJECT_MESSAGE,
} from '@objectstack/metadata-core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { flowNoticeMessageKey, flowRefusalMessageKey } from '@objectstack/spec/system';
import type { FlowDryRunResult } from '@objectstack/spec/contracts';
import { AutomationEngine, type FlowUserGrants } from './engine.js';
import { registerCrudNodes } from './builtin/crud-nodes.js';
import { registerLogicNodes } from './builtin/logic-nodes.js';
import { registerLoopNode } from './builtin/loop-node.js';
import { registerSaveNoticeNode } from './builtin/save-notice-node.js';
import { i18nServiceReader } from './plugin.js';

function makeLogger(): any {
    const l: any = { info() {}, warn() {}, error() {}, debug() {} };
    l.child = () => l;
    return l;
}

/** A live data engine holding `deal` rows, recording every call. */
function liveData(rows: Record<string, Record<string, unknown>> = { d1: { id: 'd1', stage: 'open', amount: 10 } }) {
    const calls: Array<{ op: string; obj: string; q?: any }> = [];
    // Equality on plain fields only: a combinator or an operator object is
    // refused, never read as a field name.
    const match = (where: any) => Object.values(rows).filter((r) => !where || Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$') || (v !== null && typeof v === 'object')) throw new Error(`liveData: unsupported filter '${k}'`);
        return r[k] === v;
    }));
    const data: any = {
        async find(obj: string, q: any) {
            calls.push({ op: 'find', obj, q });
            const hits = match(q?.where);
            const page = typeof q?.limit === 'number' ? hits.slice(0, q.limit) : hits;
            return page.map((r) => ({ ...r }));
        },
        async findOne(obj: string, q: any) {
            assertEngineFindOnePredicate(obj, q);
            calls.push({ op: 'findOne', obj, q });
            const r = match(q?.where)[0];
            return r ? { ...r } : null;
        },
        async insert(obj: string) { calls.push({ op: 'insert', obj }); throw new Error('a dry run must not insert'); },
        async update(obj: string, payload: any, options?: any) {
            assertEngineUpdateDispatch(payload, options);
            calls.push({ op: 'update', obj });
            throw new Error('a dry run must not update');
        },
        async delete(obj: string, options?: any) {
            assertEngineDeleteDispatch(options);
            calls.push({ op: 'delete', obj });
            throw new Error('a dry run must not delete');
        },
    };
    return { data, calls };
}

interface Harness {
    engine: AutomationEngine;
    calls: Array<{ op: string; obj: string; q?: any }>;
    approvalCalls: number;
    writeChecks: Array<{ object: string; operation: string; context: any }>;
}

function harness(opts: {
    grants?: Partial<FlowUserGrants>;
    canWrite?: (object: string, operation: string) => boolean;
    /** Translation bundles by locale, served through the engine's one i18n source. */
    bundles?: Record<string, Record<string, unknown>>;
    /** The grants read fails (the resolver throws). */
    grantsFail?: boolean;
    /** The grants resolver answers nothing (`null`). */
    grantsNone?: boolean;
    /** No grants resolver is wired at all. */
    noGrantsResolver?: boolean;
    /** The live `deal` rows, when not the one default row. */
    rows?: Record<string, Record<string, unknown>>;
} = {}): Harness {
    const { data, calls } = liveData(opts.rows);
    const writeChecks: Harness['writeChecks'] = [];
    const security = opts.canWrite
        ? {
            async canWriteObject(object: string, operation: string, context: any) {
                writeChecks.push({ object, operation, context });
                return opts.canWrite!(object, operation);
            },
        }
        : undefined;
    const ctx: any = {
        logger: makeLogger(),
        getService: (n: string) => (n === 'data' ? data : n === 'security' ? security : undefined),
    };
    const engine = new AutomationEngine(makeLogger());
    registerLogicNodes(engine, ctx);
    registerCrudNodes(engine, ctx);
    registerLoopNode(engine, ctx);
    registerSaveNoticeNode(engine, ctx);
    if (opts.bundles) {
        const i18n = createMemoryI18n();
        for (const [locale, data] of Object.entries(opts.bundles)) i18n.loadTranslations(locale, data);
        engine.setI18nServiceSource(i18nServiceReader({
            getService: (<T>(name: string) => {
                if (name === 'i18n') return i18n as T;
                throw new Error(`service '${name}' not registered`);
            }) as never,
        }));
    }
    const h: Harness = { engine, calls, approvalCalls: 0, writeChecks };
    // An approval node as the approvals plugin declares it: it pauses, so a
    // dry run must stop at it and never call it (that would create a request).
    engine.registerNodeExecutor({
        type: 'approval',
        descriptor: defineActionDescriptor({
            type: 'approval', version: '1.0.0', name: 'Approval', category: 'logic', source: 'plugin',
            supportsPause: true, resumeAuthority: 'service',
        } as any),
        async execute() { h.approvalCalls++; return { success: true, suspend: true }; },
    });
    if (!opts.noGrantsResolver) engine.setUserGrantsResolver(async () => opts.grantsFail ? Promise.reject(new Error('grants store unreachable')) : opts.grantsNone ? null as never : ({
        positions: [],
        permissions: [],
        accessible_org_ids: ['org_1'],
        systemPermissions: [],
        ...opts.grants,
    }));
    return h;
}

/** A bundle holding `text` at the dotted translation `key`. */
function bundleAt(key: string, text: string): Record<string, unknown> {
    const parts = key.split('.');
    const root: Record<string, unknown> = {};
    let at = root;
    for (const part of parts.slice(0, -1)) at = (at[part] = {}) as Record<string, unknown>;
    at[parts[parts.length - 1]] = text;
    return root;
}

const writes = (h: Harness) => h.calls.filter((c) => c.op === 'insert' || c.op === 'update' || c.op === 'delete');

function flow(nodes: any[], edges: any[], extra: Record<string, unknown> = {}) {
    return { name: 'draft_flow', label: 'Draft flow', type: 'autolaunched', nodes, edges, ...extra };
}
const chain = (...ids: string[]) => ids.slice(1).map((id, i) => ({ id: `e${i}`, source: ids[i], target: id }));

describe('dryRun — create_record and update_record (writes simulated, never made)', () => {
    it('a create reports the values it computed and a placeholder id, writes nothing, and a later read by id sees only the fields the flow set', async () => {
        const h = harness();
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'deal', fields: { amount: { dialect: 'cel', source: 'record.amount * 2' }, stage: 'new' }, outputVariable: 'created' } },
            { id: 'rd', type: 'get_record', label: 'Read', config: { objectName: 'deal', filter: { id: { dialect: 'cel', source: 'created.id' } }, outputVariable: 'back' } },
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'mk', 'rd', 'end')), { userId: 'usr_maker', record: { id: 'd1', amount: 21 } });

        expect(result.status).toBe('completed');
        expect(writes(h)).toEqual([]);
        const create = result.steps.find((s) => s.nodeId === 'mk');
        expect(create).toMatchObject({ kind: 'write', operation: 'create', object: 'deal', values: { amount: 42, stage: 'new' }, permission: 'not_judged' });
        const placeholder = (create as any).recordIds[0];
        expect(typeof placeholder).toBe('string');
        expect(placeholder).not.toBe('d1');
        // The read by id answers the simulated row, never the live engine.
        expect(result.steps.find((s) => s.nodeId === 'rd')).toMatchObject({ kind: 'read', object: 'deal', recordIds: [placeholder] });
        expect(h.calls.filter((c) => c.op === 'findOne' && c.q?.where?.id === placeholder)).toEqual([]);
        expect(result.steps.map((s) => s.kind)).toEqual(['route', 'write', 'read', 'route']);
    });

    it('an update targets the live row in the named user\'s scope, writes nothing, and a later read by id sees the simulated fields laid over it', async () => {
        const h = harness({ canWrite: () => true });
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'up', type: 'update_record', label: 'Update', config: { objectName: 'deal', filter: { id: 'd1' }, fields: { stage: 'won' } } },
            { id: 'rd', type: 'get_record', label: 'Read', config: { objectName: 'deal', filter: { id: 'd1' }, outputVariable: 'back' } },
            { id: 'as', type: 'assignment', label: 'Keep', config: { assignments: { seen: { dialect: 'cel', source: 'back.stage + "/" + string(back.amount)' } } } },
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'up', 'rd', 'as', 'end')), { userId: 'usr_maker' });

        expect(result.status).toBe('completed');
        expect(writes(h)).toEqual([]);
        expect(result.steps.find((s) => s.nodeId === 'up')).toMatchObject({
            kind: 'write', operation: 'update', object: 'deal', recordIds: ['d1'], values: { stage: 'won' }, permission: 'allowed',
        });
        expect(h.writeChecks.map((c) => [c.object, c.operation, c.context?.userId, c.context?.isSystem === true])).toEqual([['deal', 'update', 'usr_maker', false]]);
        expect(result.steps.find((s) => s.nodeId === 'as')).toMatchObject({ kind: 'assignment', values: { seen: 'won/10' } });
    });

    it('a write the object-level check refuses carries PERMISSION_DENIED and ends the run failed, nothing written', async () => {
        const h = harness({ canWrite: () => false });
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'up', type: 'update_record', label: 'Update', config: { objectName: 'deal', filter: { id: 'd1' }, fields: { stage: 'won' } } },
            { id: 'after', type: 'assignment', label: 'After', config: { assignments: { x: 1 } } },
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'up', 'after', 'end')), { userId: 'usr_maker' });

        expect(result.status).toBe('failed');
        expect(writes(h)).toEqual([]);
        const last = result.steps[result.steps.length - 1];
        expect(last).toMatchObject({ nodeId: 'up', kind: 'write', permission: 'refused' });
        expect(last.refusal?.code).toBe('PERMISSION_DENIED');
        expect(result.error).toContain("Node 'up' failed");
    });
});

describe('dryRun — assignment and decision (run as the live run runs them)', () => {
    it('an assignment reports the variables it set with the values it computed', async () => {
        const h = harness();
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'as', type: 'assignment', label: 'Set', config: { assignments: { total: { dialect: 'cel', source: 'record.amount + 5' }, note: 'fixed' } } },
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'as', 'end')), { userId: 'usr_maker', record: { id: 'd1', amount: 10 } });
        expect(result.status).toBe('completed');
        expect(result.steps.find((s) => s.nodeId === 'as')).toEqual({ nodeId: 'as', nodeType: 'assignment', kind: 'assignment', values: { total: 15, note: 'fixed' } });
    });

    it('a decision reports its branch, the expression that held and where the run went', async () => {
        const h = harness();
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'dec', type: 'decision', label: 'Big?', config: { conditions: [
                { label: 'big', expression: 'record.amount > 100' },
                { label: 'small', expression: 'record.amount <= 100' },
            ] } },
            { id: 'bigEnd', type: 'end', label: 'Big' },
            { id: 'smallEnd', type: 'end', label: 'Small' },
        ], [
            { id: 'e0', source: 'start', target: 'dec' },
            { id: 'e1', source: 'dec', target: 'bigEnd', label: 'big' },
            { id: 'e2', source: 'dec', target: 'smallEnd', label: 'small' },
        ]), { userId: 'usr_maker', record: { id: 'd1', amount: 10 } });
        expect(result.status).toBe('completed');
        expect(result.steps.find((s) => s.nodeId === 'dec')).toEqual({
            nodeId: 'dec', nodeType: 'decision', kind: 'decision', branch: 'small', expressions: ['record.amount <= 100'], next: ['smallEnd'],
        });
        expect(result.steps.map((s) => s.nodeId)).toEqual(['start', 'dec', 'smallEnd']);
    });

    it('a gateway decision reports the conditioned out-edge it took, and no branch', async () => {
        const h = harness();
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'dec', type: 'decision', label: 'Gate' },
            { id: 'a', type: 'end', label: 'A' },
            { id: 'b', type: 'end', label: 'B' },
        ], [
            { id: 'e0', source: 'start', target: 'dec' },
            { id: 'e1', source: 'dec', target: 'a', condition: 'record.amount > 100' },
            { id: 'e2', source: 'dec', target: 'b', isDefault: true },
        ]), { userId: 'usr_maker', record: { id: 'd1', amount: 500 } });
        expect(result.steps.find((s) => s.nodeId === 'dec')).toEqual({
            nodeId: 'dec', nodeType: 'decision', kind: 'decision', expressions: ['record.amount > 100'], next: ['a'],
        });
    });
});

describe('dryRun — approval nodes and waits (the run stops)', () => {
    it('stops at an approval node, reports it last, and never calls it', async () => {
        const h = harness();
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'as', type: 'assignment', label: 'Set', config: { assignments: { x: 1 } } },
            { id: 'ok', type: 'approval', label: 'Sign-off', config: { approvers: [{ type: 'user', value: 'u1' }] } },
            { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'deal', fields: { stage: 'approved' } } },
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'as', 'ok', 'mk', 'end')), { userId: 'usr_maker' });
        expect(result.status).toBe('stopped');
        expect(h.approvalCalls).toBe(0);
        expect(result.steps.map((s) => s.nodeId)).toEqual(['start', 'as', 'ok']);
        expect(result.steps[2]).toEqual({ nodeId: 'ok', nodeType: 'approval', kind: 'stop', reason: 'approval' });
        expect(writes(h)).toEqual([]);
    });

    it('a node type outside every named class stops the run as not simulated', async () => {
        const h = harness();
        h.engine.registerNodeExecutor({ type: 'custom_thing', async execute() { throw new Error('must not run'); } });
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'c', type: 'custom_thing', label: 'Custom' },
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'c', 'end')), { userId: 'usr_maker' });
        expect(result.status).toBe('stopped');
        expect(result.steps[result.steps.length - 1]).toEqual({ nodeId: 'c', nodeType: 'custom_thing', kind: 'stop', reason: 'not_simulated' });
    });
});

describe('dryRun — admission (the by-name start rules, ruling B for runAs system)', () => {
    const gated = (extra: Record<string, unknown>) => flow([
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ], chain('start', 'end'), extra);

    it('refuses a named user missing a capability requiredPermissions names, with the by-name message, and runs nothing', async () => {
        const h = harness({ grants: { systemPermissions: ['other_cap'] } });
        const result = await h.engine.dryRun(gated({ type: 'screen', requiredPermissions: ['close_deals'] }), { userId: 'usr_maker' });
        const expected = requiredPermissionsRefusal(['close_deals'], ['close_deals']);
        expect(result).toEqual({ status: 'refused', steps: [], refusal: { code: expected.code, message: expected.message } });
    });

    it('refuses an AI service account a runAs system definition with the account rule\'s message', async () => {
        const h = harness({ grants: { principalKind: 'agent' } });
        const result = await h.engine.dryRun(gated({ type: 'screen', runAs: 'system' }), { userId: 'usr_agent' });
        expect(result.status).toBe('refused');
        expect(result.refusal).toEqual({ code: AI_ACCOUNT_ELEVATED_START_REFUSAL.code, message: AI_ACCOUNT_ELEVATED_START_REFUSAL.message });
    });

    it('refuses an organization the named user is not a member of', async () => {
        const h = harness();
        const result = await h.engine.dryRun(gated({}), { userId: 'usr_maker', tenantId: 'org_other' });
        expect(result.status).toBe('refused');
        expect(result.refusal?.code).toBe('PERMISSION_DENIED');
        expect(result.steps).toEqual([]);
    });

    it.each([
        ['the read fails (the resolver throws)', { grantsFail: true }],
        ['the resolver answers nothing', { grantsNone: true }],
        ['no resolver is wired', { noGrantsResolver: true }],
    ] as const)('refuses a runAs system definition when the named user\'s grants cannot be read: %s (the account rule fails closed)', async (_arm, unread) => {
        const h = harness(unread);
        const result = await h.engine.dryRun(gated({ type: 'schedule', runAs: 'system' }), { userId: 'usr_maker' });
        expect(result.status).toBe('refused');
        expect(result.steps).toEqual([]);
        expect(result.refusal?.code).toBe('PERMISSION_DENIED');
    });

    it('admits a runAs system schedule draft for the named user and never elevates it (ruling B)', async () => {
        const h = harness({ canWrite: () => true });
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'up', type: 'update_record', label: 'Update', config: { objectName: 'deal', filter: { id: 'd1' }, fields: { stage: 'stale' } } },
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'up', 'end'), { type: 'schedule', runAs: 'system' }), { userId: 'usr_maker', tenantId: 'org_1' });
        expect(result.status).toBe('completed');
        const contexts = [...h.calls.map((c) => c.q?.context), ...h.writeChecks.map((c) => c.context)].filter(Boolean);
        expect(contexts.length).toBeGreaterThan(0);
        for (const c of contexts) {
            expect(c.isSystem === true).toBe(false);
            expect(c.userId).toBe('usr_maker');
        }
    });
});

describe('dryRun — unarmed, unregistered, and its own answers', () => {
    it('never registers the definition', async () => {
        const h = harness();
        await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'end')), { userId: 'usr_maker' });
        expect(await h.engine.listFlows()).toEqual([]);
        expect(await h.engine.getFlow('draft_flow')).toBeNull();
    });

    it('throws a TypeError for a missing userId before reading the definition', async () => {
        const h = harness();
        await expect(h.engine.dryRun(null, { userId: '' } as any)).rejects.toThrow(TypeError);
    });

    it('throws what registerFlow throws for a definition it refuses', async () => {
        const h = harness();
        const bad = flow([{ id: 'end', type: 'end', label: 'End' }], []);
        let registerError: unknown;
        try { h.engine.registerFlow('draft_flow', bad); } catch (e) { registerError = e; }
        expect(registerError).toBeInstanceOf(Error);
        await expect(h.engine.dryRun(bad, { userId: 'usr_maker' })).rejects.toThrow((registerError as Error).message);
    });

    it('answers condition_not_met with the condition, and failed with the fault, before any node runs', async () => {
        const h = harness();
        const gatedFlow = (condition: string) => flow([
            { id: 'start', type: 'start', label: 'Start', config: { condition } },
            { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'deal', fields: { stage: 'x' } } },
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'mk', 'end'));
        const notMet: FlowDryRunResult = await h.engine.dryRun(gatedFlow('record.stage == "won"'), { userId: 'usr_maker', record: { id: 'd1', stage: 'open' } });
        expect(notMet).toEqual({ status: 'condition_not_met', steps: [], startCondition: { expression: 'record.stage == "won"', result: false } });
        const faulted = await h.engine.dryRun(gatedFlow('record.missing.deeper == 1'), { userId: 'usr_maker', record: { id: 'd1' } });
        expect(faulted.status).toBe('failed');
        expect(faulted.steps).toEqual([]);
        expect(faulted.startCondition?.expression).toBe('record.missing.deeper == 1');
        expect(faulted.startCondition?.fault).toBe(faulted.error);
    });

    it('a write inside a loop body is simulated too (the region runs the dry run\'s nodes)', async () => {
        const h = harness();
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'lp', type: 'loop', label: 'Each', config: {
                collection: [1, 2], iteratorVariable: 'n',
                body: { nodes: [{ id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'deal', fields: { n: { dialect: 'cel', source: 'n' } } } }], edges: [] },
            } },
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'lp', 'end')), { userId: 'usr_maker' });
        expect(result.status).toBe('completed');
        expect(writes(h)).toEqual([]);
        expect(result.steps.map((s) => s.nodeId)).toEqual(['start', 'lp', 'mk', 'mk', 'end']);
        expect(result.steps.filter((s) => s.kind === 'write').map((s: any) => s.values)).toEqual([{ n: 1 }, { n: 2 }]);
    });

    it('an outbound node reports its payload, sends nothing and binds no output', async () => {
        const h = harness();
        let sent = 0;
        h.engine.registerNodeExecutor({ type: 'http', async execute() { sent++; return { success: true, output: { status: 200 } }; } });
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'call', type: 'http', label: 'Call', config: { url: 'https://example.test/deals/{{ record.id }}', method: 'POST', body: { dialect: 'cel', source: '{"amount": record.amount}' } } },
            { id: 'as', type: 'assignment', label: 'Read', config: { assignments: { got: { dialect: 'cel', source: 'has(vars.call) ? 1 : 0' } } } },
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'call', 'as', 'end')), { userId: 'usr_maker', record: { id: 'd1', amount: 7 } });
        expect(sent).toBe(0);
        expect(result.steps.find((s) => s.nodeId === 'call')).toEqual({
            nodeId: 'call', nodeType: 'http', kind: 'outbound',
            payload: { url: 'https://example.test/deals/d1', method: 'POST', body: { amount: 7 } },
        });
    });
});

describe('dryRun — text slots render as the live executor renders them, in options.locale', () => {
    const NOTICE = 'Sent {{ record.name }} for approval';
    const ZH_NOTICE = '已将 {{ record.name }} 提交审批';
    const noticeDraft = () => ({
        name: 'deal_submit', label: 'Deal submit', type: 'record_change',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { objectName: 'deal', triggerType: 'record-after-update' } },
            { id: 'tell', type: 'save_notice', label: 'Tell', config: { message: NOTICE } },
            { id: 'done', type: 'end', label: 'Done' },
        ],
        edges: chain('start', 'tell', 'done'),
    });
    const record = { id: 'd1', name: 'Acme renewal' };

    it('a save_notice payload carries the zh-CN translation at flows.NAME.notices.NODE.message, and the authored text with no locale', async () => {
        const h = harness({ bundles: { 'zh-CN': bundleAt(flowNoticeMessageKey('deal_submit', 'tell'), ZH_NOTICE) } });

        const zh = await h.engine.dryRun(noticeDraft(), { userId: 'usr_maker', record, locale: 'zh-CN' });
        const plain = await h.engine.dryRun(noticeDraft(), { userId: 'usr_maker', record });

        expect(zh.status).toBe('completed');
        expect(zh.steps.find((s) => s.nodeId === 'tell')).toMatchObject({ kind: 'outbound', payload: { message: '已将 Acme renewal 提交审批' } });
        expect(plain.steps.find((s) => s.nodeId === 'tell')).toMatchObject({ kind: 'outbound', payload: { message: 'Sent Acme renewal for approval' } });
    });

    it('a refusing end node carries the zh-CN translation of its message', async () => {
        const h = harness({ bundles: { 'zh-CN': bundleAt(flowRefusalMessageKey('draft_flow', 'finish'), '{{ record.name }} 不能提交') } });
        const draft = flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'finish', type: 'end', label: 'Finish', config: { outcome: 'refused', message: '{{ record.name }} cannot be submitted' } },
        ], chain('start', 'finish'));

        const zh = await h.engine.dryRun(draft, { userId: 'usr_maker', record, locale: 'zh-CN' });
        const plain = await h.engine.dryRun(draft, { userId: 'usr_maker', record });

        expect(zh.steps.find((s) => s.nodeId === 'finish')).toMatchObject({ refusalMessage: 'Acme renewal 不能提交' });
        expect(plain.steps.find((s) => s.nodeId === 'finish')).toMatchObject({ refusalMessage: 'Acme renewal cannot be submitted' });
    });
});

describe('dryRun — a refused write a fault edge contains', () => {
    it('goes on along the fault edge: the write step carries the refusal and the handler runs after it', async () => {
        const h = harness({ canWrite: () => false });
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'deal', fields: { stage: 'open' } } },
            { id: 'handler', type: 'assignment', label: 'Handle', config: { assignments: { handled: { dialect: 'cel', source: 'true' } } } },
            { id: 'ok', type: 'end', label: 'Ok' },
            { id: 'end', type: 'end', label: 'End' },
        ], [
            { id: 'e0', source: 'start', target: 'mk' },
            { id: 'e1', source: 'mk', target: 'ok' },
            { id: 'e_fault', source: 'mk', target: 'handler', type: 'fault' },
            { id: 'e2', source: 'handler', target: 'end' },
        ]), { userId: 'usr_maker' });

        expect(result.status).not.toBe('failed');
        expect(writes(h)).toEqual([]);
        const ids = result.steps.map((s) => s.nodeId);
        expect(result.steps.find((s) => s.nodeId === 'mk')).toMatchObject({
            kind: 'write', permission: 'refused', refusal: { code: 'PERMISSION_DENIED' },
        });
        expect(ids.indexOf('handler')).toBeGreaterThan(ids.indexOf('mk'));
        expect(ids).not.toContain('ok');
    });
});

describe('dryRun — an object-level write check that throws', () => {
    it('reports the write refused, as a denial, and the run fails there', async () => {
        const h = harness({ canWrite: () => { throw new Error('permission store unreachable'); } });
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'deal', fields: { stage: 'open' } } },
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'mk', 'end')), { userId: 'usr_maker' });

        expect(result.status).toBe('failed');
        expect(writes(h)).toEqual([]);
        expect(result.steps.find((s) => s.nodeId === 'mk')).toMatchObject({
            kind: 'write', permission: 'refused', refusal: { code: 'PERMISSION_DENIED' },
        });
    });
});

describe('dryRun — a predicate write the engine refuses without multi', () => {
    const predicateWrite = (node: Record<string, unknown>) => flow([
        { id: 'start', type: 'start', label: 'Start' },
        node,
        { id: 'end', type: 'end', label: 'End' },
    ], chain('start', String(node.id), 'end'));

    it('an update by predicate with no multi fails with the engine\'s own error, targeting and reading no row', async () => {
        const h = harness({ canWrite: () => true });
        const result = await h.engine.dryRun(predicateWrite(
            { id: 'up', type: 'update_record', label: 'Update', config: { objectName: 'deal', filter: { stage: 'open' }, fields: { stage: 'won' } } },
        ), { userId: 'usr_maker' });

        expect(result.status).toBe('failed');
        expect(writes(h)).toEqual([]);
        expect(h.calls.filter((c) => c.op === 'find' || c.op === 'findOne')).toEqual([]);
        expect(result.steps.find((s) => s.nodeId === 'up')).toMatchObject({ kind: 'write', operation: 'update', recordIds: [] });
        expect(String(result.steps.find((s) => s.nodeId === 'up')?.error)).toContain(ENGINE_UPDATE_REJECT_MESSAGE);
    });

    it('a delete by predicate with no multi fails with the engine\'s own error', async () => {
        const h = harness();
        const result = await h.engine.dryRun(predicateWrite(
            { id: 'rm', type: 'delete_record', label: 'Delete', config: { objectName: 'deal', filter: { stage: 'open' } } },
        ), { userId: 'usr_maker' });

        expect(result.status).toBe('failed');
        expect(writes(h)).toEqual([]);
        expect(result.steps.find((s) => s.nodeId === 'rm')).toMatchObject({ kind: 'write', operation: 'delete', recordIds: [] });
        expect(String(result.steps.find((s) => s.nodeId === 'rm')?.error)).toContain(ENGINE_DELETE_REJECT_MESSAGE);
    });

    it('CONTROL — the same update declaring multi lists every row it matches', async () => {
        const h = harness({ canWrite: () => true });
        const result = await h.engine.dryRun(predicateWrite(
            { id: 'up', type: 'update_record', label: 'Update', config: { objectName: 'deal', filter: { stage: 'open' }, fields: { stage: 'won' }, multi: true } },
        ), { userId: 'usr_maker' });

        expect(result.status).toBe('completed');
        expect(result.steps.find((s) => s.nodeId === 'up')).toMatchObject({ kind: 'write', operation: 'update', recordIds: ['d1'] });
    });
});

describe('dryRun — a write targets exactly the rows the engine dispatch names', () => {
    const rows = () => ({ d1: { id: 'd1', stage: 'open', amount: 10 }, d2: { id: 'd2', stage: 'open', amount: 20 } });
    const readBoth = [
        { id: 'r1', type: 'get_record', label: 'Read d1', config: { objectName: 'deal', filter: { id: 'd1' }, outputVariable: 'one' } },
        { id: 'r2', type: 'get_record', label: 'Read d2', config: { objectName: 'deal', filter: { id: 'd2' }, outputVariable: 'two' } },
        { id: 'as', type: 'assignment', label: 'Keep', config: { assignments: { seen: { dialect: 'cel', source: 'one.stage + "/" + two.stage' } } } },
    ];

    it('an update whose fields name the id, with no filter, targets that one row and lays its values over it alone', async () => {
        const h = harness({ canWrite: () => true, rows: rows() });
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'up', type: 'update_record', label: 'Update', config: { objectName: 'deal', fields: { id: 'd2', stage: 'won' } } },
            ...readBoth,
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'up', 'r1', 'r2', 'as', 'end')), { userId: 'usr_maker' });

        expect(result.status).toBe('completed');
        expect(writes(h)).toEqual([]);
        expect(result.steps.find((s) => s.nodeId === 'up')).toMatchObject({ kind: 'write', operation: 'update', recordIds: ['d2'] });
        expect(result.steps.find((s) => s.nodeId === 'as')).toMatchObject({ kind: 'assignment', values: { seen: 'open/won' } });
    });

    it('CONTROL — the same update declaring multi with no filter targets every row the named user can read', async () => {
        const h = harness({ canWrite: () => true, rows: rows() });
        const result = await h.engine.dryRun(flow([
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'up', type: 'update_record', label: 'Update', config: { objectName: 'deal', fields: { stage: 'won' }, multi: true } },
            ...readBoth,
            { id: 'end', type: 'end', label: 'End' },
        ], chain('start', 'up', 'r1', 'r2', 'as', 'end')), { userId: 'usr_maker' });

        expect(result.status).toBe('completed');
        expect(result.steps.find((s) => s.nodeId === 'up')).toMatchObject({ kind: 'write', operation: 'update', recordIds: ['d1', 'd2'] });
        expect(result.steps.find((s) => s.nodeId === 'as')).toMatchObject({ kind: 'assignment', values: { seen: 'won/won' } });
    });
});
