// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MCP `list_objects` statements per call, pinned on a REAL kernel (the plugin
 * set `default-organization-statements.golden.test.ts` composes), for the
 * caller hosted MCP clients are: an OAuth client acting on behalf of a person
 * (ADR-0090 D10 — `onBehalfOf`, the `mcp_agent_data_read` ceiling, no
 * system permission), whose every object-schema read is the INTERSECTION of
 * the agent's grants and the person's.
 *
 * ## What grew
 *
 * The bridge (`buildMcpBridge`, `domains/mcp.ts`) serves each listed object
 * through the `/meta` object door's masker, which asks the security service
 * two questions per object: `canReadObject` and `getMetadataReadableFields`.
 * For an on-behalf-of caller each of those resolved the delegator afresh —
 * the person's `sys_user` row, memberships, grants and positions, and then the
 * person's permission sets for a context object nobody had seen before, so the
 * per-context set memo never hit. Measured on `origin/main` 68972cd2 with this
 * composition: 22 statements per listed object (2 questions x 11), so an
 * environment owner listing about 170 objects paid thousands of round trips —
 * tens of seconds against a remote database.
 *
 * ## What this pins
 *
 *  1. ⭐ Statements per `list_objects` do not grow with the object count: the
 *     same call, the same callers, before and after the environment gains
 *     140 objects, differ by at most {@link STATEMENT_SLACK}.
 *  2. ⭐ The answers are the ones the per-object resolution gives, in THIS
 *     tree: every caller, both sizes, is read twice — once as shipped and once
 *     with the delegator memo bypassed ({@link bypassingDelegatorMemo}, the
 *     per-object resolution `origin/main` 68972cd2 ran) — and the two answers
 *     are deep-equal: the same objects, the same field counts, the same order,
 *     the same `sys_*` read opt-in verdicts. Compared within one tree, not
 *     against a frozen hash, so a label or object `main` adds later moves
 *     both readings alike.
 *  3. CONTROL — with the memo bypassed the delegated callers' statements DO
 *     grow with the object count, so pin 1 measures the memo and not a rig
 *     that cannot see the growth; `describe_object` answers the same both
 *     ways, at both sizes, and costs no more.
 *
 * Counted: every statement the SQL driver issues inside the call's own async
 * context (knex's `query` event), as the statements golden counts them.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, assembleExecutionContext, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/rest';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { scopesToAgentPermissionSets } from '@objectstack/spec/ai';
import { AppPlugin } from './app-plugin.js';
import { DefaultDatasourcePlugin } from './default-datasource-plugin.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { HttpDispatcher } from './http-dispatcher.js';
// Paid at collection, not inside the boot's clock: the app plugin's reach loads it lazily.
import '@objectstack/metadata';

const BOOT_TIMEOUT = 180_000;
const ORIGIN = 'http://localhost:3000';
const API = '/api/v1';
/** `AuthPlugin`'s dev-admin defaults (`OS_SEED_ADMIN_*` unset): the environment's owner. */
const OWNER = { email: 'admin@objectos.ai', password: 'admin123' };
const MEMBER = { email: 'member@pin.test', password: 'member-pin-password-33179', name: 'Pin member' };
const SCOPES = ['openid', 'offline_access', 'data:read'];
/** The listing reads that do not depend on the object count (the merged listing). */
const STATEMENT_SLACK = 2;

const objectsOf = (prefix: string, from: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
        name: `${prefix}_${String(from + i).padStart(3, '0')}`,
        label: `Object ${from + i}`,
        fields: Object.fromEntries(Array.from({ length: 6 }, (_, f) => [`f_${f}`, { type: 'text', label: `F ${f}` }])),
    }));

const PIN_APP: any = {
    manifest: { id: 'com.pin.listobjects33179', name: 'list_objects statement pins', version: '1.0.0' },
    objects: objectsOf('pin_lo', 0, 10),
};
/** Installed after the first reading: the environment grows from 10 to 150 objects. */
const GROWTH: any = {
    id: 'com.pin.listobjects33179.growth',
    name: 'list_objects statement pins (growth)',
    version: '1.0.0',
    type: 'app',
    objects: objectsOf('pin_lo', 10, 140),
};

const statements = new AsyncLocalStorage<string[]>();
let kernel: any;
let engine: any;
let app: any;
let prevNodeEnv: string | undefined;
let prevMcp: string | undefined;
let security: SecurityPlugin;

/**
 * Runs `fn` with the delegator memo bypassed: every
 * `resolveDelegatorForContext` ask forgets what the context held and resolves
 * afresh, as each object-schema read site did before the memo — the
 * per-object resolution, in this tree, for the answer-identity comparison.
 * Both read sites ask through the plugin instance, so an own-property
 * override on it reaches them; it is removed whatever `fn` does.
 */
async function bypassingDelegatorMemo<T>(fn: () => Promise<T>): Promise<T> {
    const plugin = security as any;
    const shipped = Object.getPrototypeOf(plugin).resolveDelegatorForContext;
    expect(typeof shipped, 'precondition: the memo this bypasses exists').toBe('function');
    plugin.resolveDelegatorForContext = function (this: any, context: any) {
        if (context && typeof context === 'object') this.delegatorMemo.delete(context);
        return shipped.call(this, context);
    };
    try {
        return await fn();
    } finally {
        delete plugin.resolveDelegatorForContext;
    }
}

/** The MCP service: records the bridge and caller the real `/mcp` entry hands it. */
const mcp: any = {
    lastOpts: undefined,
    handleHttpRequest: async (_req: Request, opts: any) => {
        mcp.lastOpts = opts;
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
};

async function signIn(who: { email: string; password: string }): Promise<string> {
    const res = await app.request(`${ORIGIN}${API}/auth/sign-in/email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(who),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { token: string }).token;
}

/** The person's own execution context, as the real `/mcp` entry resolved it for their session. */
async function personContext(token: string): Promise<Record<string, any>> {
    const res = await app.request(`${ORIGIN}${API}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status, 'precondition: the /mcp entry served the session').toBe(200);
    return mcp.lastOpts.caller.executionContext;
}

/**
 * The context an OAuth MCP client holding `data:read` acts under for
 * `person`, assembled by the shared assembler the `/mcp` door calls
 * (`assembleExecutionContext`, ADR-0090 D10): its ceiling, no system
 * permission, `onBehalfOf` the person.
 */
function agentFor(person: Record<string, any>): Record<string, any> {
    const ctx = assembleExecutionContext({
        authz: person as any,
        oauth: {
            userId: person.userId,
            clientId: 'pin_mcp_client',
            scopes: SCOPES,
            scopePermissions: scopesToAgentPermissionSets(SCOPES),
            delegatesActions: false,
        } as any,
        localization: undefined,
        requestLocale: undefined,
        accessToken: undefined,
        authGate: undefined,
    }) as Record<string, any>;
    expect(ctx.onBehalfOf?.userId, 'precondition: an on-behalf-of agent').toBe(person.userId);
    expect(ctx.systemPermissions).toEqual([]);
    return ctx;
}

/** The bridge the real `/mcp` entry builds for `executionContext`. */
async function bridgeFor(executionContext: Record<string, any>): Promise<any> {
    const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    const res = await dispatcher.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
        request: new Request(`${ORIGIN}${API}/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: '{}',
        }),
        response: {},
        environmentId: undefined,
        executionContext: { ...executionContext },
    } as any);
    expect(res.response?.status, 'precondition: the /mcp entry served the caller').toBe(200);
    return mcp.lastOpts.bridge;
}

/**
 * One `list_objects`, as the tool reads the bridge (`registerHttpTools`,
 * `@objectstack/mcp`): the diagnosed listing, then the read opt-in of each
 * listed `sys_*` object. Answered with the statements it issued.
 */
async function listObjects(executionContext: Record<string, any>) {
    const bridge = await bridgeFor(executionContext);
    const sql: string[] = [];
    const answer = await statements.run(sql, async () => {
        const diagnosed = await bridge.listObjectsDiagnosed();
        const aiReadable: string[] = [];
        for (const o of diagnosed.objects) if (/^sys_/.test(o.name) && await bridge.aiReadExposed(o.name)) aiReadable.push(o.name);
        return { diagnosed, aiReadable };
    });
    return { answer, statements: sql.length };
}

async function describeObject(executionContext: Record<string, any>, name: string) {
    const bridge = await bridgeFor(executionContext);
    const sql: string[] = [];
    const answer = await statements.run(sql, () => bridge.describeObject(name));
    return { answer, statements: sql.length };
}

type Who = 'owner' | 'member' | 'ownerAgent' | 'memberAgent';
type Mode = 'memo' | 'bypass';
type Reading = { answer: any; statements: number };

let callers: Record<Who, Record<string, any>>;
/** `list_objects` per size, caller and mode. */
const readings: Record<string, Record<string, Record<Mode, Reading>>> = {};
/** `describe_object pin_lo_000` per size, caller and mode. */
const described: Record<string, Record<string, Record<Mode, Reading>>> = {};

async function readOnce(ctx: Record<string, any>) {
    await listObjects(ctx); // warm: the session, the served metadata and the listing caches
    return { list: await listObjects(ctx), describe: await describeObject(ctx, 'pin_lo_000') };
}

async function read(size: string) {
    readings[size] = {};
    described[size] = {};
    for (const [who, ctx] of Object.entries(callers)) {
        const memo = await readOnce(ctx);
        const bypass = await bypassingDelegatorMemo(() => readOnce(ctx));
        readings[size][who] = { memo: memo.list, bypass: bypass.list };
        described[size][who] = { memo: memo.describe, bypass: bypass.describe };
    }
}

beforeAll(async () => {
    prevNodeEnv = process.env.NODE_ENV;
    prevMcp = process.env.OS_MCP_SERVER_ENABLED;
    process.env.NODE_ENV = 'development'; // the dev-admin seed, as `objectstack dev` arms it
    process.env.OS_MCP_SERVER_ENABLED = 'true';
    kernel = new ObjectKernel();
    const recorder: Plugin = { name: 'pin.mcp-recorder', init: async (ctx: PluginContext) => { ctx.registerService('mcp', mcp); } };
    await kernel.use(recorder);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
    await kernel.use(new HonoServerPlugin({ port: 0 }));
    await kernel.use(new AppPlugin(PIN_APP));
    await kernel.use(new PlatformObjectsPlugin());
    await kernel.use(new AuthPlugin({ secret: 'list-objects-statements-33179-pin-secret' }));
    security = new SecurityPlugin(appSecurityPluginOptions(PIN_APP));
    await kernel.use(security);
    await kernel.use(new SharingServicePlugin());
    await kernel.use(createRestApiPlugin({}));
    await kernel.use(createDispatcherPlugin({}));
    await kernel.bootstrap();
    engine = await kernel.getServiceAsync('objectql');
    app = (await kernel.getServiceAsync('http-server')).getRawApp();
    (engine as any).getDriver('sys_user').knex.on('query', (q: { sql?: unknown }) => {
        statements.getStore()?.push(String(q?.sql ?? ''));
    });
    const owner = await personContext(await signIn(OWNER));
    // The default audience posture is invite_only: the member enters the
    // owner's organization through a pending invitation.
    await engine.insert('sys_invitation', {
        id: 'inv_pin_33179', email: MEMBER.email, status: 'pending', organization_id: owner.tenantId,
        role: 'member', inviter_id: owner.userId, expires_at: new Date(Date.now() + 3_600_000),
    }, { context: { isSystem: true } });
    const signUp = await app.request(`${ORIGIN}${API}/auth/sign-up/email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...MEMBER, invitationId: 'inv_pin_33179' }),
    });
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    const member = await personContext(await signIn(MEMBER));
    callers = { owner, member, ownerAgent: agentFor(owner), memberAgent: agentFor(member) };

    await read('10');
    await kernel.getService('manifest').register(GROWTH, { source: 'marketplace' });
    await engine.syncSchemas();
    await read('150');
}, BOOT_TIMEOUT);

afterAll(async () => {
    try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevMcp === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prevMcp;
}, 60_000);

/*
 * The statements `origin/main` 68972cd2 paid on this composition, for the
 * record (not asserted — the bypassed readings below re-measure them in the
 * tree under test): `ownerAgent` 1540 at 10 objects and 4620 at 150,
 * `memberAgent` 1260 and 3780; `describe_object` 22 and 18; the two session
 * callers 0.
 */

const WHO: readonly Who[] = ['owner', 'member', 'ownerAgent', 'memberAgent'];
const DELEGATED = ['ownerAgent', 'memberAgent'] as const;
const count = (r: Reading) => r.answer.diagnosed.objects.length;
const record = (who: string) => JSON.stringify(Object.fromEntries(['10', '150'].map((s) => [s, {
    memo: { objects: count(readings[s][who].memo), statements: readings[s][who].memo.statements },
    bypass: { objects: count(readings[s][who].bypass), statements: readings[s][who].bypass.statements },
}])));

describe('[ADR-0090 D10] MCP list_objects statements do not grow with the object count (real kernel)', () => {
    it('precondition: the environment grew from 10 to 150 objects, and the owner\'s agent is listed every one', () => {
        expect(count(readings['150'].owner.memo) - count(readings['10'].owner.memo)).toBe(140);
        expect(count(readings['150'].ownerAgent.memo) - count(readings['10'].ownerAgent.memo)).toBe(140);
    });

    for (const who of WHO) {
        it(`⭐ ${who}: statements per list_objects at 150 objects are those at 10, within ${STATEMENT_SLACK}`, () => {
            const grown = readings['150'][who].memo.statements - readings['10'][who].memo.statements;
            expect(Math.abs(grown), record(who)).toBeLessThanOrEqual(STATEMENT_SLACK);
        });
    }

    it('CONTROL: with the memo bypassed, the delegated callers\' statements grow with the object count', () => {
        // The owner's agent is listed 140 more objects, two delegator reads each.
        expect(readings['150'].ownerAgent.bypass.statements - readings['10'].ownerAgent.bypass.statements, record('ownerAgent'))
            .toBeGreaterThanOrEqual(140 * 2);
        // The member's agent is listed no new object, yet is still asked of each.
        expect(readings['150'].memberAgent.bypass.statements, record('memberAgent'))
            .toBeGreaterThan(readings['10'].memberAgent.bypass.statements + STATEMENT_SLACK);
    });

    it('⭐ the delegated callers pay their delegator once, not once per object: at most one bypassed describe_object\'s worth', () => {
        for (const who of DELEGATED) {
            expect(readings['150'][who].memo.statements, record(who)).toBeLessThanOrEqual(described['150'][who].bypass.statements);
        }
    });
});

describe('[ADR-0106 D1/D5, ruling record 6787890900] the answers are the per-object resolution\'s, in this tree', () => {
    for (const size of ['10', '150'] as const) {
        for (const who of WHO) {
            it(`⭐ ${who} at ${size} objects: list_objects lists what the per-object resolution lists, in the same order`, () => {
                const { memo, bypass } = readings[size][who];
                expect(count(memo), 'precondition: the caller is listed objects').toBeGreaterThan(0);
                expect(memo.answer).toEqual(bypass.answer);
            });
        }
    }
});

describe('CONTROL — describe_object', () => {
    for (const who of WHO) {
        it(`${who}: the same answer with and without the memo, at both sizes, for no more statements`, () => {
            for (const size of ['10', '150'] as const) {
                expect(described[size][who].memo.answer, size).toEqual(described[size][who].bypass.answer);
                expect(described[size][who].memo.statements, size).toBeLessThanOrEqual(described[size][who].bypass.statements);
            }
            expect(described['150'][who].memo.answer).toEqual(described['10'][who].memo.answer);
            expect(described['150'][who].memo.statements).toBe(described['10'][who].memo.statements);
        });
    }
});

describe('[ADR-0090 D10] a write retires the delegator resolution inside one request', () => {
    it('⭐ the delegator\'s membership removed between two listings of ONE bridge: the second is narrower', async () => {
        const bridge = await bridgeFor(callers.memberAgent);
        const before: string[] = (await bridge.listObjects()).map((o: any) => o.name);
        expect(before.length, 'precondition: the member\'s agent is listed objects').toBeGreaterThan(0);
        const sys = { isSystem: true };
        const memberships: any[] = await engine.find('sys_member', {
            where: { user_id: callers.member.userId, organization_id: callers.member.tenantId }, context: sys,
        });
        expect(memberships.length, 'precondition: the member belongs to the organization').toBeGreaterThan(0);
        for (const m of memberships) await engine.delete('sys_member', { where: { id: m.id }, context: sys } as any);
        try {
            const after: string[] = (await bridge.listObjects()).map((o: any) => o.name);
            expect(after.length).toBeLessThan(before.length);
            for (const name of after) expect(before).toContain(name);
        } finally {
            for (const m of memberships) await engine.insert('sys_member', m, { context: sys });
        }
    });
});
