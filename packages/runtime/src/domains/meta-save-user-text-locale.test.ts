// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32656] The save door's advisories come back in the request's language.
 *
 * Ruling C on #32440 (ruling record 6819749037): the producer of a finding
 * composes its user-facing sentence in the request's locale, else the
 * workspace default, else `en`, and every client renders it as received. The
 * authoring rules emit the names their sentence interpolates; the metadata
 * protocol composes the sentence; and only the DOOR holds the two locales.
 * So each door states them (`SaveMetaItemRequestSchema.userTextLocales`),
 * read off the execution context it resolved: `locale` (the request's own,
 * else the workspace default) and `workspaceLocale` (the workspace default
 * alone).
 *
 * Pinned on both `/meta` save doors, end to end over the real protocol and a
 * real SQLite store: a permission set granting read on a `private` object
 * earns the `security-private-no-readscope` advisory, whose `userMessage` must
 * be in the caller's language, while `rule`, `message` and `hint` stay as
 * they were.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

const PREFIX = '/api/v1';
const META = `${PREFIX}/meta`;
const TEST_PACKAGE_ID = 'objectstack-test';
const RULE = 'security-private-no-readscope';

interface Caller {
    userId: string;
    isSystem: boolean;
    systemPermissions: string[];
    locale?: string;
    workspaceLocale?: string;
}

const caller = (locale?: string, workspaceLocale?: string): Caller => ({
    userId: 'u_admin',
    isSystem: false,
    systemPermissions: ['manage_metadata'],
    ...(locale !== undefined ? { locale } : {}),
    ...(workspaceLocale !== undefined ? { workspaceLocale } : {}),
});

const EXPENSE = {
    name: 'expense',
    label: 'Expense',
    sharingModel: 'private',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

const permissionSet = (name: string) => ({ name, label: 'Finance User', objects: { expense: { allowRead: true } } });

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

async function bootStore() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(EXPENSE as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    // What each save handed the protocol, read where the protocol receives it.
    const stated: unknown[] = [];
    const save = protocol.saveMetaItem.bind(protocol);
    (protocol as any).saveMetaItem = (request: any) => {
        stated.push(request.userTextLocales);
        return save(request);
    };
    return { protocol, stated };
}

interface Saved { status: number; body: any }
interface Door {
    save(who: Caller, name: string): Promise<Saved>;
    stated: unknown[];
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: any) => { res.body = body; return res; };
    res.send = () => res;
    res.end = () => res;
    res.header = (k: string, v: string) => { res.headers[k] = v; return res; };
    res.setHeader = () => {};
    res.write = () => true;
    return res;
}

async function bootDispatcher(): Promise<Door> {
    const { protocol, stated } = await bootStore();
    const get = (n: string) => (n === 'protocol' ? protocol : null);
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    return {
        stated,
        save: async (who, name) => {
            (dispatcher as any).timedResolveExecutionContext = async () => clone(who);
            const body = permissionSet(name);
            const request = new Request(`http://localhost${META}/permission/${name}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
            const res = await dispatcher.dispatch('PUT', `/meta/permission/${name}`, body, {}, { request }, PREFIX);
            const raw = res.response?.body as any;
            return { status: res.response?.status ?? 0, body: raw?.data ?? raw };
        },
    };
}

async function bootRestServer(): Promise<Door> {
    const { protocol, stated } = await bootStore();
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'PUT' && r.path === `${META}/:type/:name`);
    if (!route) throw new Error(`PUT ${META}/:type/:name is not registered`);
    return {
        stated,
        save: async (who, name) => {
            rest.resolveExecCtx = async () => clone(who);
            const res = makeRes();
            await route.handler({
                method: 'PUT', path: `${META}/permission/${name}`, params: { type: 'permission', name },
                headers: {}, query: {}, body: permissionSet(name),
            }, res);
            return { status: res.statusCode, body: res.body };
        },
    };
}

const advisoryOf = (saved: Saved) => {
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const advisory = (saved.body?.advisories ?? []).find((a: any) => a.rule === RULE);
    expect(advisory, 'the private-object advisory rides the 2xx').toBeDefined();
    return advisory;
};

const DOORS: ReadonlyArray<readonly [string, () => Promise<Door>]> = [
    ['the runtime dispatcher', bootDispatcher],
    ['RestServer', bootRestServer],
];

for (const [doorName, boot] of DOORS) {
    describe(`[#32656] ${doorName}: PUT /meta/permission/:name composes advisories in the caller's language`, () => {
        it('states the request locale, then the workspace default, read off the execution context', async () => {
            const door = await boot();
            await door.save(caller('zh-CN', 'de'), 'finance_user');
            await door.save(caller(), 'finance_user');
            expect(door.stated).toEqual([['zh-CN', 'de'], []]);
        }, 60_000);

        it('a zh-CN request reads the advisory in Simplified Chinese; rule, message and hint are unchanged', async () => {
            const door = await boot();
            const zh = advisoryOf(await door.save(caller('zh-CN', 'en'), 'finance_user'));
            expect(zh.userMessage).toContain('权限集“finance_user”');
            const en = advisoryOf(await door.save(caller('en', 'en'), 'finance_user'));
            expect(en.userMessage).toContain('permission set "finance_user"');
            expect({ rule: zh.rule, message: zh.message, hint: zh.hint }).toEqual({ rule: en.rule, message: en.message, hint: en.hint });
        }, 60_000);

        it('a request language the platform has no text in falls back to the workspace default, then to en', async () => {
            const door = await boot();
            const workspace = advisoryOf(await door.save(caller('tlh', 'zh-CN'), 'finance_user'));
            expect(workspace.userMessage).toContain('权限集“finance_user”');
            const floor = advisoryOf(await door.save(caller('tlh', 'tlh'), 'finance_user'));
            expect(floor.userMessage).toContain('permission set "finance_user"');
        }, 60_000);
    });
}
