// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19939 pass 2] The flow CEL scope binds `current_user` — the maintainer's
 * ruling on the second pass:
 *
 *  - **Q1 A.** `current_user` is the run's `EvalUser` (id from `userId`,
 *    positions, organization from `tenantId`) when the run has a user, and
 *    `null` when it has none — never a pseudo-user (ADR-0118 D1, D4).
 *  - **Q2 A.** It carries only what the run holds: id, positions,
 *    organization, the platform-admin flag. No email, no name.
 *
 * Pinned with a user and without one, through every CEL site a flow has: an
 * `assignment` value envelope, the start node's condition, an edge condition,
 * a `decision` condition, and a screen field's `visibleWhen` on resume. Each
 * reads the run's own context — the one the retired `{$User.Id}` read — so a
 * `runAs: 'system'` run still sees the user that triggered it.
 */

import { describe, expect, it } from 'vitest';

import { AutomationEngine } from './engine.js';
import { installBuiltinNodes } from './builtin/index.js';

function silentLogger(): any {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}

function makeEngine(): AutomationEngine {
    const engine = new AutomationEngine(silentLogger());
    installBuiltinNodes(engine, { logger: silentLogger(), getService() { return undefined; } } as any);
    return engine;
}

/** A start → assignment → end flow whose one assignment is the CEL `source`, surfaced as output `v`. */
function assignFlow(source: string, extra: Record<string, unknown> = {}) {
    return {
        name: 'who', label: 'Who', type: 'autolaunched',
        variables: [{ name: 'v', type: 'text', isOutput: true }],
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'set', type: 'assignment', label: 'Set', config: { assignments: { v: { dialect: 'cel', source } } } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'set' },
            { id: 'e2', source: 'set', target: 'end' },
        ],
        ...extra,
    } as any;
}

const USER = { userId: 'usr_1', positions: ['org_admin', 'sales_rep'], tenantId: 'org_1' };

async function evaluate(source: string, context: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const engine = makeEngine();
    engine.registerFlow('who', assignFlow(source, extra));
    return engine.execute('who', context as any);
}

describe('`current_user` with a user — the run\'s EvalUser, and only what the run holds (Q1 A, Q2 A)', () => {
    it('is the canonical EvalUser: id, positions, organizationId and the derived isPlatformAdmin', async () => {
        const result = await evaluate('current_user', USER);
        expect(result.success, result.error).toBe(true);
        expect((result.output as { v: unknown }).v).toEqual({
            id: 'usr_1',
            positions: ['org_admin', 'sales_rep'],
            isPlatformAdmin: false,
            organizationId: 'org_1',
        });
    });

    it('derives isPlatformAdmin from the positions, as `createEvalUser` does everywhere', async () => {
        const result = await evaluate('current_user.isPlatformAdmin', { userId: 'usr_9', positions: ['platform_admin'] });
        expect((result.output as { v: unknown }).v).toBe(true);
    });

    it('carries no email and no name — no run context holds either', async () => {
        const result = await evaluate("has(current_user.email) || has(current_user.name) ? 'yes' : 'no'", USER);
        expect((result.output as { v: unknown }).v).toBe('no');
    });

    it('leaves organizationId out when the run carries no tenant', async () => {
        const result = await evaluate("has(current_user.organizationId) ? 'yes' : 'no'", { userId: 'usr_1' });
        expect((result.output as { v: unknown }).v).toBe('no');
    });

    it('a `runAs: \'system\'` run still sees the user that triggered it — what `{$User.Id}` read', async () => {
        const result = await evaluate('current_user.id', USER, { runAs: 'system' });
        expect(result.success, result.error).toBe(true);
        expect((result.output as { v: unknown }).v).toBe('usr_1');
    });
});

describe('`current_user` without a user — `null`, never a pseudo-user (Q1 A, ADR-0118 D1)', () => {
    it.each([
        ['no context user at all', {}],
        ['an empty user id', { userId: '' }],
        ['a system run with no triggering user', { runAs: 'system' }],
    ])('%s: the root is `null`', async (_what, context) => {
        const result = await evaluate("current_user == null ? 'none' : 'someone'", context);
        expect(result.success, result.error).toBe(true);
        expect((result.output as { v: unknown }).v).toBe('none');
    });

    it('a bare `current_user.id` fails the run loudly, naming the source — never a silent nothing', async () => {
        const result = await evaluate('current_user.id', {});
        expect(result.success).toBe(false);
        expect(result.error).toContain('current_user.id');
    });

    it('the ruled guard writes `null`', async () => {
        const result = await evaluate('current_user != null ? current_user.id : null', {});
        expect(result.success, result.error).toBe(true);
        expect((result.output as { v: unknown }).v).toBeNull();
    });
});

describe('every CEL site of a flow reads the run\'s user', () => {
    it('the start condition gates on it — a user-less run is skipped, a user\'s runs', async () => {
        const engine = makeEngine();
        const flow = assignFlow('current_user.id');
        flow.nodes[0].config = { condition: 'current_user != null' };
        engine.registerFlow('who', flow);
        const skipped = await engine.execute('who', {} as any);
        expect(skipped.output).toMatchObject({ skipped: true, reason: 'condition_not_met' });
        const ran = await engine.execute('who', USER as any);
        expect((ran.output as { v: unknown }).v).toBe('usr_1');
    });

    function branchFlow(kind: 'edge' | 'decision') {
        const branch = kind === 'edge'
            ? {
                nodes: [] as unknown[],
                edges: [
                    { id: 'e1', source: 'start', target: 'admin', condition: "'org_admin' in current_user.positions" },
                    { id: 'e2', source: 'start', target: 'other', condition: "!('org_admin' in current_user.positions)" },
                ],
            }
            : {
                nodes: [{
                    id: 'route', type: 'decision', label: 'Route',
                    config: { conditions: [{ label: 'admin', expression: "'org_admin' in current_user.positions" }] },
                }],
                edges: [
                    { id: 'e1', source: 'start', target: 'route' },
                    { id: 'e2', source: 'route', target: 'admin', label: 'admin' },
                    { id: 'e3', source: 'route', target: 'other', label: 'default' },
                ],
            };
        return {
            name: 'route', label: 'Route', type: 'autolaunched',
            variables: [{ name: 'path', type: 'text', isOutput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                ...branch.nodes,
                { id: 'admin', type: 'assignment', label: 'Admin', config: { assignments: { path: 'admin' } } },
                { id: 'other', type: 'assignment', label: 'Other', config: { assignments: { path: 'other' } } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                ...branch.edges,
                { id: 'ea', source: 'admin', target: 'end' },
                { id: 'eo', source: 'other', target: 'end' },
            ],
        } as any;
    }

    it.each(['edge', 'decision'] as const)('a %s condition branches on the run user\'s positions', async (kind) => {
        const engine = makeEngine();
        engine.registerFlow('route', branchFlow(kind));
        const admin = await engine.execute('route', USER as any);
        expect(admin.success, admin.error).toBe(true);
        expect((admin.output as { path: unknown }).path).toBe('admin');
        const member = await engine.execute('route', { userId: 'usr_2', positions: ['org_member'] } as any);
        expect((member.output as { path: unknown }).path).toBe('other');
    });

    it('a screen field\'s `visibleWhen` reads the run\'s user on resume', async () => {
        const engine = makeEngine();
        engine.registerFlow('ask', {
            name: 'ask', label: 'Ask', type: 'screen',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'form', type: 'screen', label: 'Form',
                    config: {
                        fields: [{
                            name: 'admin_note', label: 'Admin note', type: 'text', required: true,
                            visibleWhen: "'org_admin' in current_user.positions",
                        }],
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'form' },
                { id: 'e2', source: 'form', target: 'end' },
            ],
        } as any);
        // An admin sees the field, so its `required` holds.
        const asAdmin = await engine.execute('ask', USER as any);
        expect(asAdmin.status).toBe('paused');
        const refused = await engine.resume(asAdmin.runId!, { variables: {} });
        expect(refused.code).toBe('INVALID_SCREEN_INPUT');
        // A member does not, so the empty submission completes.
        const asMember = await engine.execute('ask', { userId: 'usr_2', positions: ['org_member'] } as any);
        const done = await engine.resume(asMember.runId!, { variables: {} });
        expect(done.success, done.error).toBe(true);
    });
});
