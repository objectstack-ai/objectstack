// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A node's config VALUES are judged at registration by the contract its
 * executor parses at run time (#21848) — the value half of the key-name check
 * (`config-unknown-keys.test.ts`).
 *
 * Before: registration read a node's config against the descriptor's JSON
 * Schema for key NAMES only, so an approval node with
 * `escalation.timeoutHours: 0.5` (the contract says `>= 1`) registered, loaded
 * `active`, and failed every run at the node with no approval request opened.
 *
 * Pinned here, on the engine and on the plugin's boot path:
 *  - a value the declared contract refuses refuses the flow, naming the flow,
 *    the node and the config path, and nothing is registered;
 *  - the refusal is the same CLASS as the key-name refusal (a plain error with
 *    no `code` / `status` of its own), so every door answers it the same way;
 *  - the judge is the executor's own contract, rules JSON Schema cannot carry
 *    included, and nodes inside an ADR-0031 region are judged too;
 *  - a node type whose executor declares no contract keeps today's behaviour;
 *  - on boot, a flow the boot pull registered before its node's executor
 *    existed, and the `kernel:ready` bind then refused, is withdrawn — it does
 *    not stay registered and bound behind the refusal's warning.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import {
    APPROVAL_NODE_TYPE,
    ApprovalNodeConfigSchema,
    defineActionDescriptor,
    getApprovalNodeConfigJsonSchema,
} from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding, NodeExecutor } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const SUB_HOUR = { enabled: true, timeoutHours: 0.5, action: 'notify' };
const VALID = { enabled: true, timeoutHours: 4, action: 'notify' };

function silentLogger() {
    const warnings: string[] = [];
    const logger: any = {
        info() {}, error() {}, debug() {},
        warn(msg: string, meta?: unknown) { warnings.push(`${msg} ${meta ? JSON.stringify(meta) : ''}`); },
        child() { return logger; },
    };
    return { logger, warnings };
}

/**
 * An `approval` executor registered the way `plugin-approvals` registers its
 * own: the descriptor publishes the JSON Schema (key names), and
 * `configContract` is the schema `execute` parses. `withContract: false` is the
 * shape every executor had before the member existed.
 */
function approvalExecutor(withContract = true): NodeExecutor {
    return {
        type: APPROVAL_NODE_TYPE,
        descriptor: defineActionDescriptor({
            type: APPROVAL_NODE_TYPE,
            version: '1.0.0',
            name: 'Approval',
            category: 'human',
            paradigms: ['flow'],
            source: 'plugin',
            supportsPause: true,
            resumeAuthority: 'service',
            configSchema: getApprovalNodeConfigJsonSchema() as Record<string, unknown>,
        }),
        ...(withContract ? { configContract: ApprovalNodeConfigSchema } : {}),
        async execute() {
            return { success: true, suspend: true };
        },
    };
}

/** An active, record-triggered flow whose approval node carries `escalation`. */
function gatedFlow(name: string, escalation: Record<string, unknown>, extraConfig: Record<string, unknown> = {}) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        status: 'active',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { objectName: 'expense', triggerType: 'record-after-create' } },
            {
                id: 'gate',
                type: APPROVAL_NODE_TYPE,
                label: 'Gate',
                config: { approvers: [{ type: 'position', value: 'manager' }], escalation, ...extraConfig },
            },
            { id: 'approved', type: 'end', label: 'Approved' },
            { id: 'rejected', type: 'end', label: 'Rejected' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'gate' },
            { id: 'e2', source: 'gate', target: 'approved', label: 'approve' },
            { id: 'e3', source: 'gate', target: 'rejected', label: 'reject' },
        ],
    };
}

/** Register and return the thrown error (fails the test if it registers). */
function refusalOf(engine: AutomationEngine, name: string, definition: unknown): Error & { code?: unknown; status?: unknown } {
    try {
        engine.registerFlow(name, definition as never);
    } catch (err) {
        return err as Error & { code?: unknown; status?: unknown };
    }
    throw new Error(`expected '${name}' to be refused at registration, and it registered`);
}

describe('registration judges node config VALUES with the executor-declared contract', () => {
    it('refuses `escalation.timeoutHours: 0.5`, locating the flow, the node and the config path', async () => {
        const engine = new AutomationEngine(silentLogger().logger);
        engine.registerNodeExecutor(approvalExecutor());

        const err = refusalOf(engine, 'sub_hour', gatedFlow('sub_hour', SUB_HOUR));
        expect(err.message).toContain("Flow 'sub_hour' rejected: 1 config value(s) the node's own contract refuses.");
        expect(err.message).toContain("node 'gate' (approval): config.escalation.timeoutHours: ");
        // The contract's own sentence, not a second one.
        const contractSentence = ApprovalNodeConfigSchema.safeParse(gatedFlow('x', SUB_HOUR).nodes[1].config)
            .error?.issues[0]?.message;
        expect(contractSentence).toBeTruthy();
        expect(err.message).toContain(`config.escalation.timeoutHours: ${contractSentence}`);
        // Nothing registered under the name.
        expect(await engine.getFlow('sub_hour')).toBeNull();
    });

    it('is the key-name refusal\'s class: a plain error with no code or status of its own', () => {
        const engine = new AutomationEngine(silentLogger().logger);
        engine.registerNodeExecutor(approvalExecutor());

        const value = refusalOf(engine, 'sub_hour', gatedFlow('sub_hour', SUB_HOUR));
        const key = refusalOf(engine, 'bogus_key', gatedFlow('bogus_key', { ...VALID, bogusKey: 1 }));
        // The key-name refusal still owns an undeclared key (it runs first).
        expect(key.message).toContain('undeclared config key(s)');
        expect(key.message).toContain('at config.escalation.bogusKey');
        // Both reach the doors as the same class, so the `/automation` write
        // doors answer both `400 VALIDATION_FAILED` and the boot skips both.
        for (const err of [value, key]) {
            expect(err).toBeInstanceOf(Error);
            expect(err.code).toBeUndefined();
            expect(err.status).toBeUndefined();
        }
        expect(Object.getPrototypeOf(value)).toBe(Object.getPrototypeOf(key));
    });

    it('registers a valid escalation, and stores it unchanged', async () => {
        const engine = new AutomationEngine(silentLogger().logger);
        engine.registerNodeExecutor(approvalExecutor());

        engine.registerFlow('valid', gatedFlow('valid', VALID) as never);
        const stored = await engine.getFlow('valid');
        expect(stored?.nodes.find((n) => n.id === 'gate')?.config).toMatchObject({ escalation: VALID });
    });

    it('judges with the whole contract: a rule JSON Schema cannot carry refuses too', () => {
        const engine = new AutomationEngine(silentLogger().logger);
        engine.registerNodeExecutor(approvalExecutor());

        // `fallbackApprovers` is read only under `onEmptyApprovers: 'fallback'`
        // — a `superRefine` rule of the contract, absent from its JSON Schema.
        const definition = gatedFlow('ignored_fallback', VALID, {
            onEmptyApprovers: 'fail',
            fallbackApprovers: [{ type: 'user', value: 'u1' }],
        });
        expect(ApprovalNodeConfigSchema.safeParse(definition.nodes[1].config).success).toBe(false);
        const err = refusalOf(engine, 'ignored_fallback', definition);
        expect(err.message).toContain("node 'gate' (approval): config.fallbackApprovers: ");
    });

    it('a node type whose executor declares no contract keeps key-name-only judgement', async () => {
        const engine = new AutomationEngine(silentLogger().logger);
        engine.registerNodeExecutor(approvalExecutor(false));

        engine.registerFlow('unjudged', gatedFlow('unjudged', SUB_HOUR) as never);
        expect(await engine.getFlow('unjudged')).not.toBeNull();
    });

    it('judges a node inside an ADR-0031 region, naming the region', async () => {
        const engine = new AutomationEngine(silentLogger().logger);
        // A test node type whose contract refuses `count` below 1 — structural,
        // like every contract the engine reads.
        engine.registerNodeExecutor({
            type: 'stamp',
            configContract: {
                safeParse(value: unknown) {
                    const count = (value as { count?: unknown }).count;
                    return typeof count === 'number' && count >= 1
                        ? { success: true, data: value }
                        : { success: false, error: { issues: [{ path: ['count'], message: 'must be at least 1' }] } };
                },
            },
            async execute() {
                return { success: true };
            },
        });
        const flow = (count: number) => ({
            name: 'looped',
            label: 'Looped',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'each',
                    type: 'loop',
                    label: 'Each',
                    config: {
                        collection: '{items}',
                        body: {
                            nodes: [{ id: 'inner', type: 'stamp', label: 'Inner', config: { count } }],
                            edges: [],
                        },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'each' },
                { id: 'e2', source: 'each', target: 'end' },
            ],
        });

        const err = refusalOf(engine, 'looped', flow(0));
        expect(err.message).toMatch(/· node 'inner' \(stamp\): config\.count: must be at least 1/);
        expect(err.message).toContain('each');

        engine.registerFlow('looped', flow(2) as never);
        expect(await engine.getFlow('looped')).not.toBeNull();
    });
});

// ── The boot path: the executor registers AFTER the boot pull ──────────────

/** A recording `record_change` trigger (stands in for the real one). */
function recordingRecordChangeTrigger() {
    const bound = new Set<string>();
    const trigger: FlowTrigger = {
        type: 'record_change',
        start(binding: FlowTriggerBinding, _cb: (ctx: AutomationContext) => Promise<void>) {
            bound.add(binding.flowName);
        },
        stop(flowName: string) {
            bound.delete(flowName);
        },
    };
    return { trigger, has: (n: string) => bound.has(n) };
}

/**
 * The two reads a boot binds flows from: the `objectql` registry (the boot
 * pull in `AutomationServicePlugin.start()`) and the protocol's flow view (the
 * `kernel:ready` bind) — both serving the same packaged flows, as a real boot
 * does.
 */
function flowSourcesPlugin(flows: unknown[], rec: ReturnType<typeof recordingRecordChangeTrigger>): Plugin {
    return {
        name: 'test.flow-sources',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            const c = ctx as unknown as {
                registerService(n: string, s: unknown): void;
                getService<T>(n: string): T;
            };
            c.registerService('objectql', {
                registry: {
                    listItems: (type: string) => (type === 'flow' ? flows : []),
                    getObject: () => undefined,
                },
            });
            c.registerService('protocol', {
                async getMetaItemsForExecution(q: { type: string }) {
                    return { items: q.type === 'flow' ? flows : [] };
                },
            });
            c.getService<AutomationEngine>('automation').registerTrigger(rec.trigger);
        },
    };
}

/**
 * A plugin that contributes the `approval` executor from its own `start()` —
 * after `AutomationServicePlugin.start()` pulled and registered the flows,
 * which is where `ApprovalsServicePlugin` registers it.
 */
function lateApprovalPlugin(): Plugin {
    return {
        name: 'test.late-approval',
        version: '1.0.0',
        async init() {},
        async start(ctx: PluginContext) {
            (ctx as unknown as { getService<T>(n: string): T })
                .getService<AutomationEngine>('automation')
                .registerNodeExecutor(approvalExecutor());
        },
    };
}

describe('boot: a flow the kernel:ready bind refuses does not stay registered from the boot pull', () => {
    it('withdraws the refused flow and keeps the valid one bound', async () => {
        const rec = recordingRecordChangeTrigger();
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(new AutomationServicePlugin());
        kernel.use(
            flowSourcesPlugin(
                [{ ...gatedFlow('sub_hour', SUB_HOUR), _packageId: 'app.fixture' }, { ...gatedFlow('valid', VALID), _packageId: 'app.fixture' }],
                rec,
            ),
        );
        kernel.use(lateApprovalPlugin());
        await kernel.bootstrap();
        await flush();

        const engine = kernel.getService<AutomationEngine>('automation');
        expect(await engine.getFlow('sub_hour'), 'refused at load ⇒ not registered').toBeNull();
        expect(rec.has('sub_hour'), 'refused at load ⇒ not bound').toBe(false);
        expect(engine.getActiveTriggerBindings().map((b) => b.flowName)).not.toContain('sub_hour');

        // Only the refused flow: the package's valid flow is registered and bound.
        expect(await engine.getFlow('valid')).not.toBeNull();
        expect(rec.has('valid')).toBe(true);

        await kernel.shutdown();
    });
});
