// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { MessagingService } from '@objectstack/service-messaging';
import type { MessagingChannel } from '@objectstack/service-messaging';
import { AutomationEngine } from '../engine.js';
import { registerParallelNode } from './parallel-node.js';
import { registerNotifyNode } from './notify-node.js';
import { registerHttpNodes } from './http-nodes.js';

/**
 * A failed `parallel` run on the REAL engine and the REAL built-in nodes: the
 * run log and the run summary an operator reads after a fan-out whose one
 * branch delivered a notification and whose other branch's HTTP call failed.
 *
 * The graph is the showcase's `showcase_fan_out_notify` fan-out
 * (`examples/app-showcase/src/automation/flows/index.ts`): a `parallel` named
 * `fan_out` whose branch 0 is an inbox `notify` (`notify_owner`) and whose
 * branch 1 is an `http` POST (`slack_post`). On a runner with no Slack egress
 * the POST fails with undici's `fetch failed`, which is what the global
 * `fetch` double below answers — the only stand-in here. The notify node runs
 * against a real inline `MessagingService` with a recording `inbox` channel,
 * so "the notification was delivered" is read off the channel, not assumed.
 *
 * Before the fix this run's log was `[start:success, fan_out:failure]` and its
 * summary `{ selected: 0, acted: 0, failed: 1 }`, while the inbox held the
 * notification: an operator reading `acted: 0` re-runs the flow and the owner
 * is notified twice.
 */

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

/** A channel that records what it was handed, so a real send is observable. */
function recordingChannel(id: string): { channel: MessagingChannel; sent: unknown[] } {
    const sent: unknown[] = [];
    return {
        sent,
        channel: {
            id,
            async send(_ctx, delivery) {
                sent.push(delivery);
                return { ok: true };
            },
        },
    };
}

function boot() {
    const inbox = recordingChannel('inbox');
    const messaging = new MessagingService({ logger: silentLogger() });
    messaging.registerChannel(inbox.channel);
    const pluginCtx = {
        logger: silentLogger(),
        getService: (name: string) => (name === 'messaging' ? messaging : undefined),
    } as any;
    const engine = new AutomationEngine(silentLogger());
    registerParallelNode(engine, pluginCtx);
    registerNotifyNode(engine, pluginCtx);
    registerHttpNodes(engine, pluginCtx);
    return { engine, inbox };
}

const FAN_OUT_FLOW = {
    name: 'fan_out_notify',
    label: 'Fan-out Notify (Parallel)',
    type: 'autolaunched' as const,
    nodes: [
        { id: 'start', type: 'start' as const, label: 'Start' },
        {
            id: 'fan_out',
            type: 'parallel' as const,
            label: 'Notify in parallel',
            config: {
                branches: [
                    {
                        name: 'Notify the owner',
                        nodes: [
                            {
                                id: 'notify_owner',
                                type: 'notify',
                                label: 'Notify Owner',
                                config: { recipients: ['user_1'], title: 'Done: task', channels: ['inbox'] },
                            },
                        ],
                        edges: [],
                    },
                    {
                        name: 'Post to Slack',
                        nodes: [
                            {
                                id: 'slack_post',
                                type: 'http',
                                label: 'Slack Notify',
                                config: {
                                    url: 'https://hooks.slack.com/services/T000/B000/XXXX',
                                    method: 'POST',
                                },
                            },
                        ],
                        edges: [],
                    },
                ],
            },
        },
        { id: 'end', type: 'end' as const, label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'fan_out' },
        { id: 'e2', source: 'fan_out', target: 'end' },
    ],
};

describe('a failed parallel run keeps its branch steps on the real engine', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const runFanOut = async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new TypeError('fetch failed');
        }));
        const { engine, inbox } = boot();
        engine.registerFlow('fan_out_notify', FAN_OUT_FLOW);
        const result = await engine.execute('fan_out_notify');
        const record = (await engine.listRuns('fan_out_notify'))[0];
        return { result, record, inbox };
    };

    it('the step log carries the delivered notify and the failed http, each tagged with its branch', async () => {
        const { result, record, inbox } = await runFanOut();

        // The premise: the run failed, and branch 0 really delivered.
        expect(result.success).toBe(false);
        expect(record?.status).toBe('failed');
        expect(inbox.sent).toHaveLength(1);

        const steps = record?.steps ?? [];
        const branchSteps = steps.filter(s => s.parentNodeId === 'fan_out');
        expect(branchSteps.map(s => ({
            nodeId: s.nodeId,
            status: s.status,
            regionKind: s.regionKind,
            branch: s.branch,
        }))).toEqual([
            { nodeId: 'notify_owner', status: 'success', regionKind: 'parallel-branch', branch: 0 },
            { nodeId: 'slack_post', status: 'failure', regionKind: 'parallel-branch', branch: 1 },
        ]);
        // The failed branch step carries its own error.
        const post = branchSteps.find(s => s.nodeId === 'slack_post');
        expect(post?.error?.code).toBe('NODE_FAILURE');
        expect(post?.error?.message).toContain('fetch failed');
    });

    it('the run summary counts the delivered notification instead of reporting acted 0', async () => {
        const { result, record, inbox } = await runFanOut();

        expect(inbox.sent).toHaveLength(1);
        // Never lower than the deliveries that happened.
        expect(result.summary?.acted).toBeGreaterThanOrEqual(inbox.sent.length);
        // The persisted run row reads the same as the live result.
        expect(record?.summary).toMatchObject({ selected: 1, acted: 1 });
        expect(result.summary).toMatchObject({ selected: 1, acted: 1 });
        // The failed POST is an effect the run cannot count, and says so.
        expect(result.summary?.unmeasured).toBe(1);
        // Two failures, each on its own node: the branch's POST and the block.
        const byId = new Map((result.summary?.nodes ?? []).map(n => [n.nodeId, n]));
        expect(byId.get('notify_owner')).toMatchObject({ runs: 1, failures: 0, acted: 1 });
        expect(byId.get('slack_post')).toMatchObject({ runs: 1, failures: 1 });
        expect(byId.get('fan_out')).toMatchObject({ runs: 1, failures: 1, status: 'failure' });
        expect(result.summary?.failed).toBe(2);
    });
});
