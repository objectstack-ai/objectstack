// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28405 (ADR-0146 D9 item 4) — the pin survives a restart, on the durable
 * store, through the real metadata history.
 *
 * Two process lifetimes over one sqlite file: ObjectKernel, ObjectQLPlugin's
 * metadata protocol (the producer behind `PUT /meta/flow/:name`, which writes
 * `sys_metadata` and `sys_metadata_history`), the automation plugin with its
 * default durable suspended-run store (`sys_automation_run`) and the real
 * engine. The flow is saved, a run parks on its screen, the flow is saved
 * again with that screen renamed, and the process restarts: the new lifetime
 * arms only the second version and holds nothing in memory, so the run can
 * finish on the first one only by reading it back from the history by the
 * checksum its row recorded.
 *
 * It also measures the card's assumption that the identity a run records IS
 * the checksum the history keys the version by: the row's `flow_checksum` is
 * compared with the `sys_metadata_history` row the save wrote, not with a
 * hash this test computes.
 *
 * Unit pins for the rest of the card: `flow-version-pinning.test.ts`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

/** `ObjectStackProtocolImplementation`'s save door — what `PUT /meta/flow/:name` calls. */
interface MetadataWriteDoors {
    saveMetaItem(request: { type: string; name: string; item: unknown }): Promise<unknown>;
}

const SYSTEM = { isSystem: true } as never;
const FLOW = 'expense_review';

/**
 * start → `screenId` (one required field: the run parks) → `markId` → end.
 * The node after the pause names the version, so the terminal row's steps say
 * which body the resume ran.
 */
function reviewFlow(version: number, screenId: string, markId: string) {
    return {
        name: FLOW,
        label: 'Expense review',
        type: 'screen',
        version,
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            {
                id: screenId,
                type: 'screen',
                label: 'Approve',
                config: { fields: [{ name: 'decision', label: 'Decision', type: 'text', required: true }] },
            },
            { id: markId, type: 'assignment', label: 'Mark', config: { assignments: { marker: null } } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: screenId },
            { id: 'e2', source: screenId, target: markId },
            { id: 'e3', source: markId, target: 'end' },
        ],
    };
}

describe('a waiting run keeps its flow version across a restart (durable store, real metadata history)', () => {
    let dir: string | undefined;
    const kernels: ObjectKernel[] = [];

    afterEach(async () => {
        for (const k of kernels.splice(0)) {
            try { await k.shutdown(); } catch { /* noop */ }
        }
        if (dir) { rmSync(dir, { recursive: true, force: true }); dir = undefined; }
    });

    /** One process lifetime; the driver is a `driver.*` service, so the durable store attaches in `start()`. */
    async function boot(file: string) {
        const kernel = new ObjectKernel({ logger: { level: 'fatal' }, gracefulShutdown: false } as never);
        kernels.push(kernel);
        await kernel.use(new ObjectQLPlugin());
        await kernel.use({
            name: 'test.sqlite-file', type: 'standard', version: '1.0.0', dependencies: [],
            async init(ctx: { registerService(name: string, service: unknown): void }) {
                const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
                await driver.connect();
                ctx.registerService('driver.default', driver);
            },
            async start() {},
        } as never);
        await kernel.use(new AutomationServicePlugin());
        await kernel.bootstrap();
        const ql = kernel.getService<ObjectQL>('objectql');
        // A real `single` install's Default Organization: the system writes below
        // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
        await installDefaultOrganization(ql);
        return {
            kernel,
            ql,
            automation: kernel.getService<AutomationEngine>('automation'),
            protocol: kernel.getService<MetadataWriteDoors>('protocol'),
        };
    }

    /** Save `item` active and wait until the engine armed it (the mutation signal is fire-and-forget). */
    async function saveArmed(life: Awaited<ReturnType<typeof boot>>, item: ReturnType<typeof reviewFlow>) {
        await life.protocol.saveMetaItem({ type: 'flow', name: FLOW, item });
        await vi.waitFor(async () => {
            expect((await life.automation.getFlow(FLOW))?.version).toBe(item.version);
        }, { timeout: 3000, interval: 20 });
    }

    async function terminalSteps(ql: ObjectQL, runId: string): Promise<string[]> {
        const row = await vi.waitFor(async () => {
            const r = await ql.findOne('sys_automation_run', { where: { id: `run_${runId}` }, context: SYSTEM });
            if (!r) throw new Error(`no terminal row for '${runId}' yet`);
            return r as Record<string, unknown>;
        }, { timeout: 3000, interval: 20 });
        expect(row.status).toBe('completed');
        return (JSON.parse(String(row.steps_json)) as Array<{ nodeId: string }>).map((s) => s.nodeId);
    }

    it('parked on v1, v2 renames the screen, the process restarts: the run finishes on v1 and a legacy row keeps today\'s reading', async () => {
        dir = mkdtempSync(join(tmpdir(), 'os-flow-pin-'));
        const file = join(dir, 'data.db');

        const first = await boot(file);
        await saveArmed(first, reviewFlow(1, 'approve', 'mark_v1'));
        const pinned = await first.automation.execute(FLOW, {} as never);
        const legacy = await first.automation.execute(FLOW, {} as never);
        expect([pinned.status, legacy.status]).toEqual(['paused', 'paused']);

        // The card's assumption, measured: the identity the run recorded is the
        // checksum the save keyed v1's history row by.
        const history = await first.ql.find('sys_metadata_history', {
            where: { type: 'flow', name: FLOW }, context: SYSTEM,
        }) as Array<Record<string, unknown>>;
        const v1Row = history.find((h) => JSON.parse(String(h.metadata)).version === 1);
        expect(v1Row?.checksum, 'the save wrote a history row for v1').toMatch(/^sha256:/);
        const parkedRow = await first.ql.findOne('sys_automation_run', { where: { id: pinned.runId }, context: SYSTEM });
        expect(parkedRow?.flow_checksum).toBe(v1Row?.checksum);
        expect(parkedRow?.flow_version, 'flow_version stays the display number').toBe(1);

        // A row written before this card: no identity.
        await first.ql.update('sys_automation_run', { flow_checksum: null }, { where: { id: legacy.runId }, context: SYSTEM } as never);

        await saveArmed(first, reviewFlow(2, 'approve_v2', 'mark_v2'));
        await first.kernel.shutdown();
        kernels.splice(kernels.indexOf(first.kernel), 1);

        // ── restart: v2 is armed from the store, nothing of v1 is in memory ──
        const second = await boot(file);
        await vi.waitFor(async () => {
            expect((await second.automation.getFlow(FLOW))?.version).toBe(2);
        }, { timeout: 3000, interval: 20 });

        expect(await second.automation.unresumableSuspensionCause(pinned.runId!)).toBeUndefined();
        const resumed = await second.automation.resume(pinned.runId!, { variables: { decision: 'approve' } } as never);
        expect(resumed.success, JSON.stringify(resumed)).toBe(true);
        const steps = await terminalSteps(second.ql, pinned.runId!);
        expect(steps, 'it continued on the v1 body').toContain('mark_v1');
        expect(steps).not.toContain('mark_v2');

        // The legacy row reads the armed v2, whose screen is not its node.
        const cause = await second.automation.unresumableSuspensionCause(legacy.runId!);
        expect(cause).toBe(`Suspended node 'approve' no longer exists in flow '${FLOW}'`);
        const refused = await second.automation.resume(legacy.runId!, { variables: { decision: 'approve' } } as never);
        expect(refused.code).toBe('RUN_NOT_FOUND');

        // New runs start on the armed v2.
        const fresh = await second.automation.execute(FLOW, {} as never);
        expect(fresh.status).toBe('paused');
        expect((await second.ql.findOne('sys_automation_run', { where: { id: fresh.runId }, context: SYSTEM }))?.node_id).toBe('approve_v2');
    });
});
