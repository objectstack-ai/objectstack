// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, epic #31527 child B (flow), #31696 PR-2] END TO END: the
 * inbound hook of a flow name two packages hold.
 *
 * The real `AutomationEngine` (its slots, its trigger arming, its credential
 * wrapper), the real `ApiTriggerPlugin` mounting the self-hosted door, the real
 * `ApiTrigger` verifying and enqueueing, and the real `FlowCredentialChannel`
 * (#32302) reading each slot's hook secret by its package — over an in-memory
 * data engine holding one secret row per package, and a queue that delivers
 * each message to the trigger's consumer at once, so the run is observed.
 *
 *  - The qualified hook of each namespace runs that package's flow, verified
 *    with that package's secret only.
 *  - The bare hook answers `409 RESOURCE_CONFLICT` naming both qualified
 *    addresses; nothing is enqueued and nothing runs.
 *  - A slot key in the name position reaches no hook.
 *  - CONTROL: a name one package holds is served by its bare hook as before.
 *
 * Every value is a probe sentinel, not a credential.
 */

import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SchemaRegistry, assertEngineDeleteDispatch, assertEngineUpdateDispatch, resolvePackageScopedName } from '@objectstack/objectql';
import { AutomationEngine, FlowCredentialChannel } from '@objectstack/service-automation';
import { ApiTriggerPlugin, HOOKS_ADDRESSED_PATH, HOOKS_PATH } from '@objectstack/trigger-api';

const P1 = 'com.acme.alpha';
const P2 = 'com.acme.beta';
const SHARED = 'zz_slot_hook';
const ALONE = 'zz_slot_alone';
const S1 = 'pin-slot-hook-alpha-5d2e';
const S2 = 'pin-slot-hook-beta-a817';
const S_ALONE = 'pin-slot-hook-alone-0b63';

const quiet: any = { info() {}, warn() {}, error() {}, debug() {} };
quiet.child = () => quiet;

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

/** One active hook-secret row per (flow, package), as the channel stores them. */
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
        async insert() { throw new Error('read-only probe store'); },
        async update(_object: string, data: unknown, options?: unknown) {
            assertEngineUpdateDispatch(data as never, options as never);
            throw new Error('read-only probe store');
        },
        async delete(_object: string, options?: unknown) {
            assertEngineDeleteDispatch(options as never);
            throw new Error('read-only probe store');
        },
        async resolveSecretField(_object: string, id: string) {
            return stored.find((row) => row.id === id)?.value ?? null;
        },
    };
}

type Answer = { status: number; body: any };
let routes: Map<string, (c: any, next: () => Promise<void>) => Promise<unknown>>;
let enqueued: string[];
let ran: string[];

/** POST through the mounted route, as Hono hands a handler its decoded parameters. */
async function post(path: string, params: Record<string, string>, secret: string): Promise<Answer> {
    const body = JSON.stringify({ probe: path });
    const headers: Record<string, string> = { 'x-objectstack-signature': sign(secret, body) };
    const c = {
        req: { param: (n: string) => params[n], text: async () => body, header: (n: string) => headers[n.toLowerCase()] },
        json: (b: unknown, status: number): Answer => ({ status, body: b }),
    };
    return (await routes.get(path)!(c, async () => {})) as Answer;
}

beforeEach(async () => {
    routes = new Map();
    enqueued = [];
    ran = [];
    const registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    for (const [id, namespace] of [[P1, 'alpha'], [P2, 'beta']]) {
        registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace } as never, 'code');
    }
    const loaderSets: Record<string, string[]> = {};

    const engine = new AutomationEngine(quiet);
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
    engine.setFlowNameResolver((name, callerPackageId) => resolvePackageScopedName(registry as never, { type: 'flow', name, callerPackageId }));
    const channel = new FlowCredentialChannel(() => credentialStore([
        { flow: SHARED, packageId: P1, value: S1 },
        { flow: SHARED, packageId: P2, value: S2 },
        { flow: ALONE, packageId: P1, value: S_ALONE },
    ]));
    await channel.loadIndex();
    engine.setFlowCredentialSource(channel);

    // The queue delivers each message to the trigger's consumer at once.
    const consumers = new Map<string, (message: { data: unknown }) => Promise<void> | void>();
    const queue = {
        async publish(name: string, data: unknown) {
            enqueued.push(name);
            await consumers.get(name)?.({ data });
            return `msg_${enqueued.length}`;
        },
        async subscribe(name: string, handler: (message: { data: unknown }) => Promise<void> | void) { consumers.set(name, handler); },
        async unsubscribe(name: string) { consumers.delete(name); },
    };
    const app = { post: (path: string, handler: any) => { routes.set(path, handler); } };
    const services: Record<string, unknown> = {
        automation: engine,
        queue,
        'http.server': { getRawApp: () => app },
        objectql: { registry },
    };
    let ready: (() => Promise<void>) | undefined;
    await new ApiTriggerPlugin().start({
        logger: quiet,
        hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') ready = fn; },
        getService: (name: string) => {
            if (name in services) return services[name];
            throw new Error(`no ${name}`);
        },
        registerService: () => {},
    } as never);
    await ready!();

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

describe('#31696 PR-2 the inbound hook of a flow name two packages hold, end to end', () => {
    it('each namespace\'s qualified hook runs its own package\'s flow, verified with its own package\'s secret only', async () => {
        const alpha = { ns: 'alpha', flowName: SHARED, hookId: 'h1' };
        const beta = { ns: 'beta', flowName: SHARED, hookId: 'h1' };
        expect((await post(HOOKS_ADDRESSED_PATH, alpha, S1)).status).toBe(202);
        expect((await post(HOOKS_ADDRESSED_PATH, beta, S2)).status).toBe(202);
        expect(enqueued).toEqual([`flow-api:${P1}/${SHARED}`, `flow-api:${P2}/${SHARED}`]);
        expect(ran).toEqual(['p1', 'p2']);
        // The other package's secret does not verify.
        expect((await post(HOOKS_ADDRESSED_PATH, alpha, S2)).status).toBe(401);
        expect((await post(HOOKS_ADDRESSED_PATH, beta, S1)).status).toBe(401);
        expect(ran).toEqual(['p1', 'p2']);
    });

    it('red line: the bare hook answers 409 RESOURCE_CONFLICT naming both qualified addresses; nothing is enqueued or run', async () => {
        for (const secret of [S1, S2]) {
            const answer = await post(HOOKS_PATH, { flowName: SHARED, hookId: 'h1' }, secret);
            expect(answer.status).toBe(409);
            expect(answer.body.error.code).toBe('RESOURCE_CONFLICT');
            expect(answer.body.error.details.addresses).toEqual([
                `/api/v1/automation/hooks/alpha/${SHARED}/h1`,
                `/api/v1/automation/hooks/beta/${SHARED}/h1`,
            ]);
        }
        expect(enqueued).toEqual([]);
        expect(ran).toEqual([]);
    });

    it('red line: a slot key in the name position reaches no hook, on either address', async () => {
        const key = `${P1}/${SHARED}`;
        expect((await post(HOOKS_PATH, { flowName: key, hookId: 'h1' }, S1)).status).toBe(401);
        expect((await post(HOOKS_ADDRESSED_PATH, { ns: 'alpha', flowName: key, hookId: 'h1' }, S1)).status).toBe(401);
        expect(enqueued).toEqual([]);
        expect(ran).toEqual([]);
    });

    it('CONTROL: a name one package holds is served by its bare hook, as before', async () => {
        expect((await post(HOOKS_PATH, { flowName: ALONE, hookId: 'h1' }, S_ALONE)).status).toBe(202);
        expect(enqueued).toEqual([`flow-api:${ALONE}`]);
        expect(ran).toEqual(['alone']);
    });
});
