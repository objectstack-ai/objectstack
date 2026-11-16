// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, #33906; seat ruling 6884403301, amendments 2, 3 and 8] END
 * TO END: the inbound hook of a flow slot whose package is disabled while the
 * slot is still armed (the disable's re-sync has not withdrawn it: its
 * announce or protocol read failed, or the disable came with no announce).
 *
 * The real `AutomationEngine`, built by the real `AutomationServicePlugin`
 * `init()` (so its flow-name resolver is the plugin's own, over the real
 * `SchemaRegistry`), the real `ApiTriggerPlugin` mounting the self-hosted
 * door and registering the `trigger-api` member, the real `ApiTrigger`
 * verifying and enqueueing, and the real runtime `HttpDispatcher` forwarding
 * the hosted face to that member. A queue delivers each message to the
 * trigger's consumer at once, so a run is observed.
 *
 *  - The qualified address of a disabled co-holder's slot answers the door's
 *    one refusal on both faces, once the body is read: the bytes the address
 *    gets after the disable's re-sync. Nothing is enqueued and nothing runs;
 *    the cause is in the server log only.
 *  - A disabled sole holder's flow: the same, on its qualified and its bare
 *    address.
 *  - The enable serves the address again (202), with no re-arm.
 *  - CONTROL: the served co-holder answers 202 and runs; with nothing
 *    disabled every address answers as before.
 *
 * Every value is a probe sentinel, not a credential.
 */

import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { inboundHookJsonResponse, inboundHookRefusalResponse } from '@objectstack/core';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '@objectstack/runtime';
import { AutomationEngine, AutomationServicePlugin, FlowCredentialChannel } from '@objectstack/service-automation';
import { ApiTriggerPlugin, HOOKS_ADDRESSED_PATH, HOOKS_PATH } from '@objectstack/trigger-api';

const P1 = 'com.acme.alpha';
const P2 = 'com.acme.beta';
const SHARED = 'zz_disabled_hook';
const ALONE = 'zz_disabled_alone';
const S1 = 'pin-disabled-hook-alpha-71c4';
const S2 = 'pin-disabled-hook-beta-e09a';
const S_ALONE = 'pin-disabled-hook-alone-3f58';

type Line = { level: string; message: string; fields?: any };
const lines: Line[] = [];
const logger: any = {};
for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (message: string, fields?: unknown) => { lines.push({ level, message, fields }); };
}
logger.child = () => logger;

const sign = (secret: string, body: string) => {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},v1=` + createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');
};

/** start (api hook `h1`, its secret in the channel) → mark(tag) → end. */
function hooked(name: string, tag: string) {
    return {
        name,
        label: name,
        type: 'api',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { hookId: 'h1' } },
            { id: 'mark', type: 'mark', label: 'Mark', config: { tag } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'mark' },
            { id: 'e2', source: 'mark', target: 'end' },
        ],
    };
}

/** One active hook-secret row per (flow, package), as the channel stores them: read-only, the hook door writes nothing. */
function credentialStore(rows: Array<{ flow: string; packageId: string; value: string }>) {
    const stored = rows.map((r, i) => ({
        id: `cred_${i}`, flow_name: r.flow, flow_package: r.packageId, node_id: 'start', credential_key: 'secret', state: 'active', value: r.value,
    }));
    return {
        async find(_object: string, query?: { where?: Record<string, unknown>; limit?: number }) {
            const where = query?.where ?? {};
            const rows = stored.filter((row) => Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v));
            const page = typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
            return page.map(({ value: _value, ...row }) => row);
        },
        async resolveSecretField(_object: string, id: string) {
            return stored.find((row) => row.id === id)?.value ?? null;
        },
    };
}

/** An answer as its bytes: status, headers and body. */
type Snapshot = { status: number; headers: Array<[string, string]>; body: string };
async function snapshot(res: Response): Promise<Snapshot> {
    return { status: res.status, headers: [...res.headers.entries()], body: await res.text() };
}

let registry: SchemaRegistry;
let engine: AutomationEngine;
let routes: Map<string, (c: any, next: () => Promise<void>) => Promise<unknown>>;
let dispatcher: HttpDispatcher;
let enqueued: string[];
let ran: string[];
let subscribed: string[];

/** The hook's address: `ns` absent is the bare hook. */
type Address = { ns?: string; flowName: string };

/** POST through the self-hosted mount, as Hono hands a handler its decoded parameters and renders `c.json`. */
async function postSelfHosted(address: Address, secret: string): Promise<Snapshot> {
    const body = JSON.stringify({ probe: address });
    const headers: Record<string, string> = { 'x-objectstack-signature': sign(secret, body) };
    const params: Record<string, string> = { flowName: address.flowName, hookId: 'h1', ...(address.ns ? { ns: address.ns } : {}) };
    const c = {
        req: { param: (n: string) => params[n], text: async () => body, header: (n: string) => headers[n.toLowerCase()] },
        json: (b: unknown, status: number) => inboundHookJsonResponse(b, status),
    };
    const route = routes.get(address.ns ? HOOKS_ADDRESSED_PATH : HOOKS_PATH)!;
    return snapshot((await route(c, async () => {})) as Response);
}

/** POST through the runtime dispatcher (the hosted face: a kernel with no http.server). */
async function postHosted(address: Address, secret: string): Promise<Snapshot> {
    const body = JSON.stringify({ probe: address });
    const path = address.ns
        ? `/automation/hooks/${address.ns}/${address.flowName}/h1`
        : `/automation/hooks/${address.flowName}/h1`;
    const request = new Request(`http://tenant.example/api/v1${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-objectstack-signature': sign(secret, body) },
        body,
    });
    const result = await dispatcher.dispatch('POST', path, {}, {}, { request } as never);
    expect(result.response, path).toBeUndefined();
    return snapshot(result.result as Response);
}

const FACES = [['self-hosted', postSelfHosted], ['hosted', postHosted]] as const;

/** The engine's own line for a post it refused because its slot's package is disabled. */
const disabledCauses = () => lines.filter((l) => l.fields?.cause === 'disabled-holder');

beforeEach(async () => {
    routes = new Map();
    lines.length = 0;
    enqueued = [];
    ran = [];
    subscribed = [];
    registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    for (const [id, namespace] of [[P1, 'alpha'], [P2, 'beta']]) {
        registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace } as never, 'code');
    }
    const loaderSets: Record<string, string[]> = {};

    // The queue delivers each message to the trigger's consumer at once.
    const consumers = new Map<string, (message: { data: unknown }) => Promise<void> | void>();
    const queue = {
        async publish(name: string, data: unknown) {
            enqueued.push(name);
            await consumers.get(name)?.({ data });
            return `msg_${enqueued.length}`;
        },
        async subscribe(name: string, handler: (message: { data: unknown }) => Promise<void> | void) {
            subscribed.push(name);
            consumers.set(name, handler);
        },
        async unsubscribe(name: string) { consumers.delete(name); },
    };
    const app = { post: (path: string, handler: any) => { routes.set(path, handler); } };
    const services: Record<string, unknown> = {
        queue,
        'http.server': { getRawApp: () => app },
        objectql: { registry },
    };
    const ctx = {
        logger,
        hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') ready.push(fn); },
        getService: (name: string) => {
            if (name in services) return services[name];
            throw new Error(`no ${name}`);
        },
        registerService: (name: string, service: unknown) => { services[name] = service; },
    };
    const ready: Array<() => Promise<void>> = [];

    // The engine the automation plugin builds, its flow-name resolver the plugin's own.
    await new AutomationServicePlugin({ suspendedRunStore: 'memory' }).init(ctx as never);
    engine = services.automation as AutomationEngine;
    engine.registerNodeExecutor({
        type: 'mark',
        async execute(node: { config?: { tag?: string } }) {
            ran.push(String(node.config?.tag));
            return { success: true };
        },
    } as never);
    engine.setPackagedFlowSource((name, packageId) => {
        const holders = loaderSets[name] ?? [];
        if (packageId !== undefined) return holders.includes(packageId) ? packageId : undefined;
        return holders.length === 1 ? holders[0] : undefined;
    });
    const channel = new FlowCredentialChannel(() => credentialStore([
        { flow: SHARED, packageId: P1, value: S1 },
        { flow: SHARED, packageId: P2, value: S2 },
        { flow: ALONE, packageId: P1, value: S_ALONE },
    ]) as never);
    await channel.loadIndex();
    engine.setFlowCredentialSource(channel);

    await new ApiTriggerPlugin().start(ctx as never);
    for (const fn of ready) await fn();
    expect(services['trigger-api']).toBeDefined();

    // The hosted face: the runtime dispatcher over a kernel with no http.server.
    const { 'http.server': _socket, ...hosted } = services;
    const kernel: any = {
        getState: () => 'running',
        getService: (n: string) => hosted[n] ?? null,
        getServiceAsync: async (n: string) => hosted[n] ?? null,
        context: { getService: (n: string) => hosted[n] ?? null },
    };
    dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    (dispatcher as any).domainDeps.logger = logger;

    const ship = (packageId: string, body: { name: string }) => {
        registry.registerItem('flow', { ...body, _packageId: packageId }, 'name' as never, packageId);
        loaderSets[body.name] = [...new Set([...(loaderSets[body.name] ?? []), packageId])];
        engine.registerFlow(body.name, body, { source: 'package', packageId, holder: packageId });
    };
    ship(P1, hooked(SHARED, 'p1'));
    ship(P2, hooked(SHARED, 'p2'));
    ship(P1, hooked(ALONE, 'alone'));
    // The consumer runs the flow after the publish resolves its subscription.
    await new Promise((r) => setTimeout(r, 0));
});

describe('#33906 the inbound hook of a disabled holder\'s armed slot, both faces', () => {
    it('CONTROL: with nothing disabled, each qualified hook and the sole holder\'s bare hook answer 202 and run', async () => {
        for (const [face, post] of FACES) {
            ran = [];
            expect((await post({ ns: 'alpha', flowName: SHARED }, S1)).status, face).toBe(202);
            expect((await post({ ns: 'beta', flowName: SHARED }, S2)).status, face).toBe(202);
            expect((await post({ ns: 'alpha', flowName: ALONE }, S_ALONE)).status, face).toBe(202);
            expect((await post({ flowName: ALONE }, S_ALONE)).status, face).toBe(202);
            expect(ran, face).toEqual(['p1', 'p2', 'alone', 'alone']);
        }
        expect(disabledCauses()).toEqual([]);
    });

    it('red line: the disabled co-holder\'s qualified address answers the one refusal, the bytes it gets after the re-sync; nothing is enqueued; the cause is logged only', async () => {
        registry.disablePackage(P1);
        const reference = await snapshot(inboundHookRefusalResponse());
        const armed: Record<string, Snapshot> = {};
        for (const [face, post] of FACES) {
            armed[face] = await post({ ns: 'alpha', flowName: SHARED }, S1);
            expect(armed[face], face).toEqual(reference);
            for (const leak of [P1, 'alpha', 'disabled']) expect(armed[face].body, face).not.toContain(leak);
        }
        expect(enqueued).toEqual([]);
        expect(ran).toEqual([]);
        const causes = disabledCauses();
        expect(causes).toHaveLength(2);
        expect(causes[0].fields).toEqual({ cause: 'disabled-holder', flow: SHARED, package: P1, slot: `${P1}/${SHARED}` });

        // The disable's re-sync withdraws the slot: the same address, the same bytes.
        engine.withdrawFlowSlot(P1, SHARED);
        for (const [face, post] of FACES) expect(await post({ ns: 'alpha', flowName: SHARED }, S1), face).toEqual(armed[face]);
        expect(enqueued).toEqual([]);
        expect(ran).toEqual([]);
    });

    it('CONTROL: the served co-holder beside the disabled one answers 202 on both faces and runs its own flow', async () => {
        registry.disablePackage(P1);
        for (const [face, post] of FACES) expect((await post({ ns: 'beta', flowName: SHARED }, S2)).status, face).toBe(202);
        expect(enqueued).toEqual([`flow-api:${P2}/${SHARED}`, `flow-api:${P2}/${SHARED}`]);
        expect(ran).toEqual(['p2', 'p2']);
        expect(disabledCauses()).toEqual([]);
    });

    it('red line: both holders disabled, neither qualified address is served', async () => {
        registry.disablePackage(P1);
        registry.disablePackage(P2);
        const reference = await snapshot(inboundHookRefusalResponse());
        for (const [face, post] of FACES) {
            expect(await post({ ns: 'alpha', flowName: SHARED }, S1), face).toEqual(reference);
            expect(await post({ ns: 'beta', flowName: SHARED }, S2), face).toEqual(reference);
        }
        expect(enqueued).toEqual([]);
        expect(ran).toEqual([]);
        expect(disabledCauses().map((l) => l.fields.package)).toEqual([P1, P2, P1, P2]);
    });

    it('red line: a disabled sole holder\'s flow answers the one refusal on its qualified and its bare address, the bytes they get after the re-sync; nothing is enqueued', async () => {
        registry.disablePackage(P1);
        const reference = await snapshot(inboundHookRefusalResponse());
        const addresses: Address[] = [{ ns: 'alpha', flowName: ALONE }, { flowName: ALONE }];
        const armed = new Map<string, Snapshot>();
        for (const [face, post] of FACES) {
            for (const address of addresses) {
                const answer = await post(address, S_ALONE);
                expect(answer, `${face} ${JSON.stringify(address)}`).toEqual(reference);
                for (const leak of [P1, 'alpha', 'disabled']) expect(answer.body).not.toContain(leak);
                armed.set(`${face} ${JSON.stringify(address)}`, answer);
            }
        }
        expect(enqueued).toEqual([]);
        expect(ran).toEqual([]);
        expect(disabledCauses()).toHaveLength(4);
        expect(disabledCauses()[0].fields).toEqual({ cause: 'disabled-holder', flow: ALONE, package: P1, slot: ALONE });

        engine.withdrawFlowSlot(P1, ALONE);
        for (const [face, post] of FACES) {
            for (const address of addresses) {
                const key = `${face} ${JSON.stringify(address)}`;
                expect(await post(address, S_ALONE), key).toEqual(armed.get(key));
            }
        }
        expect(enqueued).toEqual([]);
        expect(ran).toEqual([]);
    });

    it('the enable serves each address again, 202 and a run, with no re-arm', async () => {
        const bindings = engine.getActiveTriggerBindings().map((b) => b.flowName).sort();
        const subscriptions = [...subscribed];
        registry.disablePackage(P1);
        for (const [face, post] of FACES) {
            expect((await post({ ns: 'alpha', flowName: SHARED }, S1)).status, face).toBe(401);
            expect((await post({ flowName: ALONE }, S_ALONE)).status, face).toBe(401);
        }
        expect(ran).toEqual([]);

        registry.enablePackage(P1);
        for (const [face, post] of FACES) {
            expect((await post({ ns: 'alpha', flowName: SHARED }, S1)).status, face).toBe(202);
            expect((await post({ ns: 'alpha', flowName: ALONE }, S_ALONE)).status, face).toBe(202);
            expect((await post({ flowName: ALONE }, S_ALONE)).status, face).toBe(202);
        }
        expect(ran).toEqual(['p1', 'alone', 'alone', 'p1', 'alone', 'alone']);
        expect(engine.getActiveTriggerBindings().map((b) => b.flowName).sort()).toEqual(bindings);
        expect(subscribed).toEqual(subscriptions);
    });
});
