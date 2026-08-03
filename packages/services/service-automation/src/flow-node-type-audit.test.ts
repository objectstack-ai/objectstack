// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4771 — the ADR-0018 node-type check must run when the vocabulary is COMPLETE.
 *
 * Reported symptom: every `pnpm dev` (showcase) cold boot printed eight
 * assertions that eight ADR-0019 approval flows "will fail at execution time",
 * and all eight were false. `AutomationServicePlugin.start()` pulls the flows
 * from the ObjectQL registry and validated each node type immediately;
 * `ApprovalsServicePlugin.start()` registers the `approval` executor ~0.8s
 * later. The check therefore judged a world that had not finished forming.
 *
 * The damage is not the noise, it is the loss of the signal: a deployment that
 * genuinely lacks the approvals plugin produced the IDENTICAL eight warnings,
 * so nothing about the output distinguished "fine" from "broken". Both
 * populations are pinned here — the fix is only real if the two boots now say
 * different things.
 *
 * The reproduction condition is asserted, not assumed: each test proves from
 * the boot log that the flow was registered BEFORE the executor arrived, which
 * is the window the pre-fix check fired in.
 */

import { describe, it, expect, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

/** The showcase's shape: a flow whose only real node is an ADR-0019 `approval`. */
const approvalFlow = (name: string) => ({
    name,
    label: name,
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'signoff', type: 'approval', label: 'Sign-off', config: { approvers: [{ type: 'user', value: 'u1' }] } },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'signoff' },
        { id: 'e2', source: 'signoff', target: 'end' },
    ],
});

/**
 * Minimal `objectql` stand-in exposing the ONE seam the boot pull reads —
 * `registry.listItems('flow')`. This is the path the showcase takes (inline app
 * flows land in the registry at init), and the reason flows are registered
 * during automation's own `start()`, i.e. before later plugins have started.
 */
function fakeObjectqlPlugin(flows: unknown[]): Plugin {
    return {
        name: 'fake-objectql',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            (ctx as unknown as { registerService(n: string, s: unknown): void }).registerService('objectql', {
                registry: {
                    listItems: (type: string) => (type === 'flow' ? flows : []),
                    getObject: () => undefined,
                },
            });
        },
    };
}

/**
 * Stand-in for `ApprovalsServicePlugin`: contributes the `approval` executor
 * from `start()`, exactly as the real one does
 * (`approvals-plugin.ts` → `registerApprovalNode`). Registered after the
 * automation plugin so it starts after it — the real boot order.
 */
function fakeApprovalsPlugin(): Plugin {
    return {
        name: 'fake-approvals',
        version: '1.0.0',
        async init() { /* the real plugin registers its schemas here */ },
        async start(ctx: PluginContext) {
            const automation = ctx.getService<AutomationEngine>('automation');
            automation.registerNodeExecutor({
                type: 'approval',
                async execute() { return { success: true }; },
            });
        },
    };
}

/** Boot a kernel over the given flows, with or without the approvals-like plugin. */
async function boot(opts: { flows: unknown[]; withApprovals: boolean }) {
    const stdout: string[] = [];
    // `warn`/`info` go to process.stdout (only error/fatal use stderr).
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
    }) as never);
    const kernel = new LiteKernel();
    kernel.use(fakeObjectqlPlugin(opts.flows));
    kernel.use(new AutomationServicePlugin());
    if (opts.withApprovals) kernel.use(fakeApprovalsPlugin());
    try {
        await kernel.bootstrap();
    } finally {
        spy.mockRestore();
    }
    const engine = kernel.getService<AutomationEngine>('automation');
    const log = stdout.join('');
    return {
        kernel,
        engine,
        log,
        /** Node-type warnings emitted anywhere in the boot (the #4771 subject). */
        nodeTypeWarnings: stdout.filter((l) => l.includes('no registered executor or descriptor')),
    };
}

/** The pre-fix false-alarm window: flow registered first, executor second. */
function assertFlowRegisteredBeforeExecutor(log: string, flowName: string) {
    const flowAt = log.indexOf(`Flow registered: ${flowName}`);
    const executorAt = log.indexOf('Node executor registered: approval');
    expect(flowAt, 'the flow must have been registered during boot').toBeGreaterThan(-1);
    expect(executorAt, 'the approval executor must have been registered during boot').toBeGreaterThan(-1);
    expect(
        flowAt,
        'reproduction condition: the flow is registered BEFORE the plugin contributes its node type',
    ).toBeLessThan(executorAt);
}

describe('#4771 — flow node-type validation waits for the plugin-contributed vocabulary', () => {
    it('says NOTHING when the contributing plugin starts after the flow was registered', async () => {
        const { kernel, engine, log, nodeTypeWarnings } = await boot({
            flows: [approvalFlow('showcase_expense_signoff'), approvalFlow('showcase_budget_approval')],
            withApprovals: true,
        });

        // The order that produced the bug really did occur in this boot.
        assertFlowRegisteredBeforeExecutor(log, 'showcase_expense_signoff');

        // Acceptance criterion 1: a deployment WITH the plugin gets zero
        // node-type warnings. Pre-fix this was two (eight in the showcase).
        expect(nodeTypeWarnings).toEqual([]);
        expect(log).not.toMatch(/will fail at execution time/);
        expect(engine.getUnknownNodeTypeAudit()).toEqual([]);

        await kernel.shutdown();
    });

    it('still warns — naming the flow and the type — when NO plugin provides the node', async () => {
        const { kernel, engine, log, nodeTypeWarnings } = await boot({
            flows: [approvalFlow('showcase_expense_signoff'), approvalFlow('showcase_budget_approval')],
            withApprovals: false,
        });

        // Acceptance criterion 2: the real defect is still reported, per flow,
        // and the warning now carries its remedy.
        expect(nodeTypeWarnings).toHaveLength(2);
        expect(nodeTypeWarnings.join('')).toContain('showcase_expense_signoff');
        expect(nodeTypeWarnings.join('')).toContain('showcase_budget_approval');
        expect(nodeTypeWarnings.join('')).toMatch(/approval/);
        expect(log).toMatch(/Install\/enable the plugin/);

        expect(engine.getUnknownNodeTypeAudit()).toEqual([
            expect.objectContaining({ flowName: 'showcase_expense_signoff', unknownTypes: ['approval'] }),
            expect.objectContaining({ flowName: 'showcase_budget_approval', unknownTypes: ['approval'] }),
        ]);

        await kernel.shutdown();
    });

    it('the two deployments are DISTINGUISHABLE — the property the pre-fix warning lacked', async () => {
        const flows = [approvalFlow('showcase_expense_signoff')];
        const installed = await boot({ flows, withApprovals: true });
        const missing = await boot({ flows, withApprovals: false });

        // Before the fix both boots printed the identical warning, so the
        // signal-to-noise ratio of this check was exactly zero: no operator
        // could tell a healthy stack from one missing the approvals plugin.
        expect(installed.nodeTypeWarnings.length).toBe(0);
        expect(missing.nodeTypeWarnings.length).toBe(1);
        expect(installed.nodeTypeWarnings).not.toEqual(missing.nodeTypeWarnings);

        await installed.kernel.shutdown();
        await missing.kernel.shutdown();
    });

    it('warns immediately for a flow published into the RUNNING server (post-seal)', async () => {
        // A Studio publish / dev reload after boot IS registering against a
        // complete vocabulary, so deferral would be wrong there: the check goes
        // back to inline, which is what makes this a timing fix and not a mute.
        const { kernel, engine } = await boot({ flows: [], withApprovals: false });

        const warnings: string[] = [];
        const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
            warnings.push(String(chunk));
            return true;
        }) as never);
        try {
            engine.registerFlow('published_later', approvalFlow('published_later'));
        } finally {
            spy.mockRestore();
        }

        expect(warnings.filter((w) => w.includes('no registered executor or descriptor'))).toHaveLength(1);
        await kernel.shutdown();
    });
});
