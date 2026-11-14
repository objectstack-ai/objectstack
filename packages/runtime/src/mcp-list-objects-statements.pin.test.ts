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
 * composition: 26 statements per listed object (2 questions x 13), so an
 * environment owner listing about 170 objects paid thousands of round trips —
 * tens of seconds against a remote database.
 *
 * ## What this pins
 *
 *  1. ⭐ Statements per `list_objects` do not grow with the object count: the
 *     same call, the same callers, before and after the environment gains
 *     140 objects, differ by at most {@link STATEMENT_SLACK}.
 *  2. ⭐ The answers are the ones `origin/main` gave, byte for byte
 *     ({@link GOLDEN}, measured there): every caller, both sizes — the same
 *     objects, the same field counts, the same order, the same `sys_*`
 *     read opt-in verdicts.
 *  3. CONTROL — `describe_object` answers the same, and costs no more.
 *
 * Counted: every statement the SQL driver issues inside the call's own async
 * context (knex's `query` event), as the statements golden counts them.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
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

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** What a reading is compared on: how many objects, and the answer's bytes. */
const fingerprint = (answer: { diagnosed: { objects: unknown[] } }) => ({ objects: answer.diagnosed.objects.length, sha256: digest(answer) });

let callers: Record<'owner' | 'member' | 'ownerAgent' | 'memberAgent', Record<string, any>>;
const readings: Record<string, Record<string, { objects: number; sha256: string; statements: number }>> = {};
const described: Record<string, Record<string, { sha256: string; statements: number }>> = {};

async function read(size: string) {
    readings[size] = {};
    described[size] = {};
    for (const [who, ctx] of Object.entries(callers)) {
        await listObjects(ctx); // warm: the session, the served metadata and the listing caches
        const { answer, statements: n } = await listObjects(ctx);
        readings[size][who] = { ...fingerprint(answer), statements: n };
        const d = await describeObject(ctx, 'pin_lo_000');
        described[size][who] = { sha256: digest(d.answer), statements: d.statements };
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
    await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
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

/**
 * The answers `origin/main` 68972cd2 gave on this composition, before the
 * delegator memo: per caller and size, the listed object count and the
 * sha256 of the whole answer (the diagnosed listing and the `sys_*` read
 * opt-in verdicts) — and, for `describe_object`, of its answer. Measured by
 * this file's own readings at that commit.
 *
 * The statements `origin/main` paid there, for the record (not asserted —
 * {@link STATEMENT_SLACK} is): `ownerAgent` 1540 at 10 objects and 4620 at
 * 150, `memberAgent` 1260 and 3780; `describe_object` 22 and 18; the two
 * session callers 0.
 */
const GOLDEN = {
    list: {
        10: {
            owner: { objects: 68, sha256: '304fb285b8c37106383843881c205155106c18037979f0720a0e3e921e196332' },
            member: { objects: 29, sha256: '1c5b772ff78f4bc882df5692d40800ad5f130e2cab755e4227f027b8590da93d' },
            ownerAgent: { objects: 49, sha256: 'f4e77a4d252e88493df36c4d01369efeb8ad5c431edeaa2bc3ec9c014e1800dc' },
            memberAgent: { objects: 23, sha256: '6e73539aaedd9f3612896c867f621327273103a626633c62b14eb41735af2a1c' },
        },
        150: {
            owner: { objects: 208, sha256: '9edb5243e5bcdf3fa149420ad5799e6360ec8eea1df5349368678058c2c58e0d' },
            member: { objects: 29, sha256: '1c5b772ff78f4bc882df5692d40800ad5f130e2cab755e4227f027b8590da93d' },
            ownerAgent: { objects: 189, sha256: 'd03424429fc1b2502e1c07604d17689b22b6adce7991282935a52e38902e9fd6' },
            memberAgent: { objects: 23, sha256: '6e73539aaedd9f3612896c867f621327273103a626633c62b14eb41735af2a1c' },
        },
    },
    describe: {
        owner: 'f61a6720fe797e325ff07a4fdf61571fe993ed13d1e3cc40743b4ae7712fb705',
        member: '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
        ownerAgent: 'f61a6720fe797e325ff07a4fdf61571fe993ed13d1e3cc40743b4ae7712fb705',
        memberAgent: '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
    },
    /** `describe_object`'s statements on `origin/main` for the two delegated callers. */
    describeStatements: { ownerAgent: 22, memberAgent: 18 },
} as const;

const WHO = ['owner', 'member', 'ownerAgent', 'memberAgent'] as const;

describe('[ADR-0090 D10] MCP list_objects statements do not grow with the object count (real kernel)', () => {
    it('precondition: the environment grew from 10 to 150 objects, and the owner\'s agent is listed every one', () => {
        expect(readings['150'].owner.objects - readings['10'].owner.objects).toBe(140);
        expect(readings['150'].ownerAgent.objects - readings['10'].ownerAgent.objects).toBe(140);
    });

    for (const who of WHO) {
        it(`⭐ ${who}: statements per list_objects at 150 objects are those at 10, within ${STATEMENT_SLACK}`, () => {
            const grown = readings['150'][who].statements - readings['10'][who].statements;
            expect(Math.abs(grown), JSON.stringify({ 10: readings['10'][who], 150: readings['150'][who] })).toBeLessThanOrEqual(STATEMENT_SLACK);
        });
    }

    it('⭐ the delegated callers pay their delegator once, not once per object: at most one describe_object\'s worth', () => {
        for (const who of ['ownerAgent', 'memberAgent'] as const) {
            expect(readings['150'][who].statements, who).toBeLessThanOrEqual(GOLDEN.describeStatements[who]);
        }
    });
});

describe('[ADR-0106 D1/D5, ruling record 6787890900] the answers are origin/main\'s, byte for byte', () => {
    for (const size of ['10', '150'] as const) {
        for (const who of WHO) {
            it(`⭐ ${who} at ${size} objects: list_objects lists what it listed before, in the same order`, () => {
                const { objects, sha256 } = readings[size][who];
                expect({ objects, sha256 }).toEqual(GOLDEN.list[size][who]);
            });
        }
    }
});

describe('CONTROL — describe_object', () => {
    for (const who of WHO) {
        it(`${who}: the same answer at both sizes, the one origin/main gave, for no more statements`, () => {
            expect(described['10'][who].sha256).toBe(GOLDEN.describe[who]);
            expect(described['150'][who].sha256).toBe(GOLDEN.describe[who]);
            expect(described['150'][who].statements).toBe(described['10'][who].statements);
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
