// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34730 step 2] A `notify` node naming `slack`, at the `/automation` save
 * doors, against the channels a REAL `MessagingServicePlugin` registers:
 *
 *  - a composition without connector-slack's `slack` client service does not
 *    know the channel, so the node is refused `400 VALIDATION_FAILED`, as it
 *    was before the Slack channel existed;
 *  - a composition with it knows the channel, so the same node saves.
 *
 * The door's own judgment (ruling 6810493176, letter B) is pinned against
 * scripted channel lists in `automation-authoring-doors-durable.test.ts`; this
 * file pins what the messaging plugin hands it. The preference doors' side is
 * pinned in `@objectstack/service-messaging` (`slack-channel-composition.test.ts`).
 */

import { describe, it, expect, vi } from 'vitest';
// The dispatcher's reach loads this dependency in a function body; paid here,
// at collection, not inside the first case's clocked window.
import '@objectstack/metadata';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
    type EngineFindOneQueryInput,
} from '@objectstack/metadata-core';
import { SchemaRegistry } from '@objectstack/objectql';
import { MessagingServicePlugin } from '@objectstack/service-messaging';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const AUTHOR = (): HttpProtocolContext => ({
    request: {},
    executionContext: { userId: 'u_admin', systemPermissions: ['manage_metadata'] },
} as HttpProtocolContext);

const notifyFlow = (name: string, channels: string[]) => ({
    name, label: 'Notify', type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'tell_ops', type: 'notify', label: 'Tell ops', config: { recipients: 'team:ops', title: 'Hi', channels } },
    ],
    edges: [],
});

/** The messaging service a real `MessagingServicePlugin` registers, after its `kernel:ready` handlers ran. */
async function messagingOf(opts: { slack: boolean }): Promise<unknown> {
    const engine = {
        async syncObjectSchema() {},
        async find() { return [] as unknown[]; },
        async findOne(object: string, query?: EngineFindOneQueryInput) { assertEngineFindOnePredicate(object, query); return null; },
        async insert() { return {}; },
        async update(_object: string, data: any, options?: any) { assertEngineUpdateDispatch(data, options); return {}; },
        async delete(_object: string, options?: any) { assertEngineDeleteDispatch(options); return {}; },
    };
    const services = new Map<string, unknown>([['data', engine], ['manifest', { register() {} }]]);
    // connector-slack's client service, registered at init as ConnectorSlackPlugin does.
    if (opts.slack) services.set('slack', { client: () => ({ call: async () => ({ ok: true, status: 200, body: { ok: true } }) }) });
    const readyHooks: Array<() => Promise<void> | void> = [];
    const logger: any = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger; } };
    const ctx = {
        logger,
        getService(name: string) {
            if (!services.has(name)) throw new Error(`[Kernel] Service '${name}' not found`);
            return services.get(name);
        },
        registerService(name: string, svc: unknown) { services.set(name, svc); },
        hook(event: string, fn: () => Promise<void> | void) { if (event === 'kernel:ready') readyHooks.push(fn); },
    } as any;
    await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);
    for (const fn of readyHooks) await fn();
    return services.get('messaging');
}

async function boot(opts: { slack: boolean }) {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    const flows = new Map<string, unknown>();
    const registerFlow = vi.fn((name: string, definition: unknown) => { flows.set(name, definition); return definition; });
    const unregisterFlow = vi.fn((name: string) => { flows.delete(name); });
    const protocol = new ObjectStackProtocolImplementation({ registry, findOne: async () => null } as never, () => new Map(), undefined);
    const saveMetaItem = vi.spyOn(protocol, 'saveMetaItem').mockResolvedValue({ success: true } as never);
    const services: Record<string, unknown> = {
        automation: { handlerReady: true, registerFlow, unregisterFlow, getFlow: async (name: string) => flows.get(name) ?? null },
        protocol,
        messaging: await messagingOf(opts),
    };
    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
        hasBootPhaseSettled: (phase: string) => phase === 'kernel:ready',
    };
    return { dispatcher: new HttpDispatcher(kernel as never), saveMetaItem, flows };
}

describe('a notify node naming slack at the /automation save doors (#34730)', () => {
    it('is refused 400 where connector-slack is not composed, and nothing is saved', async () => {
        const h = await boot({ slack: false });
        const { response } = await h.dispatcher.handleAutomation('', 'POST', notifyFlow('tell_slack', ['inbox', 'slack']), AUTHOR(), undefined);
        expect([(response as any)?.status, (response as any)?.body?.error?.code]).toEqual([400, 'VALIDATION_FAILED']);
        expect(String((response as any)?.body?.error?.message)).toContain("names channel 'slack' at nodes.1.config.channels.1");
        expect(h.saveMetaItem).not.toHaveBeenCalled();
        expect(h.flows.has('tell_slack')).toBe(false);

        // The control: the same composition saves a node naming only channels it knows.
        const known = await h.dispatcher.handleAutomation('', 'POST', notifyFlow('tell_inbox', ['inbox', 'email']), AUTHOR(), undefined);
        expect((known.response as any)?.status).toBe(200);
    });

    it('saves where connector-slack is composed', async () => {
        const h = await boot({ slack: true });
        const { response } = await h.dispatcher.handleAutomation('', 'POST', notifyFlow('tell_slack', ['inbox', 'slack']), AUTHOR(), undefined);
        expect((response as any)?.status).toBe(200);
        expect(h.saveMetaItem).toHaveBeenCalledTimes(1);
        expect(h.flows.has('tell_slack')).toBe(true);
    });
});
