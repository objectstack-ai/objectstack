// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21725 — a flow saved through the metadata API is armed on the running
 * engine, on the same signal that already re-binds hooks and actions.
 *
 * The defect: `PUT /api/v1/meta/flow/:name` answered `200 "Saved flow … (env-wide,
 * state=active)"`, `GET /meta/flow/:name` served the row, and the engine held
 * nothing — `GET /api/v1/automation/:name` and its trigger door answered 404
 * and a record-triggered flow never fired, until a restart. The engine armed
 * flows only at boot, at `kernel:ready` and on `metadata:reloaded`, and only
 * the publish doors announce that event. A direct save raises the protocol's
 * post-persistence signal (`onMetadataMutation`); ObjectQL re-binds authored
 * hooks and actions on it, and `service-automation` did not listen.
 *
 * These tests run the REAL write path — ObjectKernel, ObjectQLPlugin's
 * metadata protocol (the producer behind `PUT /meta/flow/:name`, the per-item
 * publish door and `DELETE /meta/flow/:name`), driver-sql on better-sqlite3
 * `:memory:` and the real engine. `saveMetaItem` IS what the REST route calls;
 * the HTTP layer adds nothing on this path. The one stand-in is the
 * record-change trigger: `@objectstack/trigger-record-change` depends on this
 * package, so it binds through the same ObjectQL `registerHook` /
 * `unregisterHooksByPackage` pair the real trigger uses, and a real insert
 * fires it.
 *
 * The signal is fire-and-forget, so a save's answer precedes the arming by one
 * read of the protocol's view: the positive rows wait for it (`vi.waitFor`),
 * and the rows that assert something did NOT happen shut the kernel down
 * first — the plugin's `destroy()` waits for every flow sync already queued.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine, FlowTrigger, FlowTriggerBinding } from './engine.js';

/** The saved surface these tests drive: `ObjectStackProtocolImplementation`'s write doors. */
interface MetadataWriteDoors {
    saveMetaItem(request: { type: string; name: string; item: unknown; mode?: 'draft' | 'publish' }): Promise<unknown>;
    publishMetaItem(request: { type: string; name: string }): Promise<unknown>;
    deleteMetaItem(request: { type: string; name: string }): Promise<unknown>;
}

const TICKET = 'qa_ticket';
const SYS = { isSystem: true } as const;

/** The repro's flow: a minimal start → end, saved active. */
const plainFlow = (name: string, status: 'active' | 'obsolete' = 'active') => ({
    name,
    label: name,
    type: 'autolaunched',
    status,
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/** A flow launched by every insert into `qa_ticket`. */
const ticketCreatedFlow = (name: string, status: 'active' | 'obsolete' = 'active') => ({
    ...plainFlow(name, status),
    nodes: [
        {
            id: 'start',
            type: 'start',
            label: 'Start',
            config: { objectName: TICKET, triggerType: 'record-after-create' },
        },
        { id: 'end', type: 'end', label: 'End' },
    ],
});

/**
 * A `record_change` trigger bound through ObjectQL's own hook registry, the
 * mechanism `RecordChangeTrigger` uses: `start` registers an `afterInsert` hook
 * under a per-flow package id, `stop` drops everything under it.
 */
function objectqlRecordTrigger(ql: ObjectQL) {
    const fired: string[] = [];
    const packageOf = (flowName: string) => `qa-record-trigger:${flowName}`;
    const trigger: FlowTrigger = {
        type: 'record_change',
        start(binding: FlowTriggerBinding, callback: (ctx: AutomationContext) => Promise<void>) {
            ql.unregisterHooksByPackage(packageOf(binding.flowName));
            ql.registerHook(
                'afterInsert',
                async (hook: { result?: unknown }) => {
                    fired.push(binding.flowName);
                    await callback({ record: hook.result, object: binding.object, event: 'afterInsert' } as never);
                },
                { object: binding.object, packageId: packageOf(binding.flowName) },
            );
        },
        stop(flowName: string) {
            ql.unregisterHooksByPackage(packageOf(flowName));
        },
    };
    return { trigger, fired };
}

describe('a flow saved through the metadata API is armed on the running engine (#21725)', () => {
    let kernel: ObjectKernel;
    let ql: ObjectQL;
    let protocol: MetadataWriteDoors;
    let automation: AutomationEngine;
    let fired: string[];

    afterEach(async () => {
        vi.restoreAllMocks();
        if (kernel?.getState() === 'running') await kernel.shutdown();
    });

    async function boot() {
        kernel = new ObjectKernel({ logger: { level: 'fatal' }, gracefulShutdown: false } as never);
        await kernel.use(new ObjectQLPlugin());
        await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
        await kernel.bootstrap();

        ql = kernel.getService<ObjectQL>('objectql');
        automation = kernel.getService<AutomationEngine>('automation');
        protocol = kernel.getService<MetadataWriteDoors>('protocol');

        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
        await driver.connect();
        ql.registerDriver(driver as never, true);
        ql.registry.registerObject(
            { name: TICKET, label: 'Ticket', fields: { title: { name: 'title', label: 'Title', type: 'text' } } } as never,
            'qa-21725',
            'qa-21725',
        );
        await ql.syncSchemas();

        const rec = objectqlRecordTrigger(ql);
        automation.registerTrigger(rec.trigger);
        fired = rec.fired;
    }

    const saveActive = (name: string, item: unknown) => protocol.saveMetaItem({ type: 'flow', name, item });
    const insertTicket = (title: string) => ql.insert(TICKET, { title }, { context: SYS } as never);
    const runtimeState = (name: string) => automation.getFlowRuntimeStates().find((s) => s.name === name);

    /** Every flow sync already queued has run: `destroy()` waits for them. */
    const settleFlowSync = () => kernel.shutdown();

    it('an active save is triggerable without a restart or a publish', async () => {
        await boot();
        const saved = await saveActive('qa_meta_flow', plainFlow('qa_meta_flow'));
        // The card's step 2, as the door answers it.
        expect((saved as { message?: string }).message).toContain("Saved flow 'qa_meta_flow' (env-wide, state=active)");

        await vi.waitFor(async () => {
            expect(await automation.getFlow('qa_meta_flow'), 'GET /automation/:name reads this').not.toBeNull();
        });
        const run = await automation.execute('qa_meta_flow', {} as never);
        expect(run.success, `the trigger door's run: ${JSON.stringify(run)}`).toBe(true);
    });

    it('a record-triggered flow saved that way fires on the next matching write', async () => {
        await boot();
        await saveActive('ticket_created', ticketCreatedFlow('ticket_created'));
        await vi.waitFor(() => {
            expect(runtimeState('ticket_created')?.bound, 'the record trigger is bound').toBe(true);
        });

        await insertTicket('first');
        expect(fired).toEqual(['ticket_created']);
    });

    it("a save that leaves the flow `status: 'obsolete'` disarms it, as the boot registers such a flow", async () => {
        await boot();
        await saveActive('ticket_created', ticketCreatedFlow('ticket_created'));
        await vi.waitFor(() => expect(runtimeState('ticket_created')?.bound).toBe(true));

        await saveActive('ticket_created', ticketCreatedFlow('ticket_created', 'obsolete'));
        await vi.waitFor(() => {
            expect(runtimeState('ticket_created'), 'still registered, disabled and unbound').toMatchObject({
                status: 'obsolete',
                enabled: false,
                bound: false,
            });
        });
        await insertTicket('after deactivation');
        expect(fired, 'a disarmed flow does not fire').toEqual([]);
    });

    it('a delete through the same door unregisters it', async () => {
        await boot();
        await saveActive('ticket_created', ticketCreatedFlow('ticket_created'));
        await vi.waitFor(() => expect(runtimeState('ticket_created')?.bound).toBe(true));

        await protocol.deleteMetaItem({ type: 'flow', name: 'ticket_created' });
        await vi.waitFor(async () => {
            expect(await automation.getFlow('ticket_created'), 'GET /automation/:name answers 404 again').toBeNull();
        });
        await insertTicket('after delete');
        expect(fired, 'an unregistered flow does not fire').toEqual([]);
    });

    it('a draft save arms nothing: the live row is unchanged', async () => {
        await boot();
        const register = vi.spyOn(automation, 'registerFlow');
        await protocol.saveMetaItem({ type: 'flow', name: 'drafted', item: plainFlow('drafted'), mode: 'draft' });
        await settleFlowSync();

        expect(register.mock.calls.filter(([name]) => name === 'drafted')).toEqual([]);
        expect(await automation.getFlow('drafted')).toBeNull();
    });

    it('the per-item publish door (#10219) still arms the published flow exactly once', async () => {
        await boot();
        const register = vi.spyOn(automation, 'registerFlow');
        await protocol.saveMetaItem({ type: 'flow', name: 'ticket_created', item: ticketCreatedFlow('ticket_created'), mode: 'draft' });
        // The door awaits its `metadata:reloaded` announce, which runs behind the
        // mutation sync the same publish raised — both are done when it answers.
        await protocol.publishMetaItem({ type: 'flow', name: 'ticket_created' });

        expect(register.mock.calls.filter(([name]) => name === 'ticket_created')).toHaveLength(1);
        await insertTicket('after publish');
        expect(fired, 'one binding, so one launch per write').toEqual(['ticket_created']);
    });

    it('PUT /automation/:name, which registers before it saves, is not registered a second time', async () => {
        await boot();
        const register = vi.spyOn(automation, 'registerFlow');
        // `registerAndSaveFlow`'s order (runtime `domains/automation.ts`): the
        // engine first, then the metadata door's own save.
        automation.registerFlow('door_flow', plainFlow('door_flow'));
        await saveActive('door_flow', plainFlow('door_flow'));
        await settleFlowSync();

        expect(register.mock.calls.filter(([name]) => name === 'door_flow')).toHaveLength(1);
        expect(await automation.getFlow('door_flow')).not.toBeNull();
    });

    it('a flow is env-wide only: an organization-scoped save is refused and arms nothing', async () => {
        // The tenancy half of the boot's reach. `flow` declares no per-org
        // channel, so the door refuses the write before it lands — no
        // mutation is raised, and a flow write's signal never names an
        // organization the boot's env-wide read would not.
        await boot();
        const register = vi.spyOn(automation, 'registerFlow');
        await expect(
            protocol.saveMetaItem({ type: 'flow', name: 'org_flow', item: plainFlow('org_flow'), organizationId: 'org_a' } as never),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        await settleFlowSync();

        expect(register.mock.calls.filter(([name]) => name === 'org_flow')).toEqual([]);
        expect(await automation.getFlow('org_flow')).toBeNull();
    });
});
