// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#34681, epic ruling 6781691009, #34348 ruling (b), ADR-0150 D3/D5] A
// bundled type's name no package ships, held as stored rows at one member by a
// base package and a package that declares it (#34441 cell 2): the read naming
// no package serves the base's row, and the five write doors naming no package
// now answer as the same request naming that base does. The bare save (the
// REST door and in process, publish and draft mode), the bare per-item
// publish, the bare history read, the bare delete and the bare draft discard
// each land in, or answer for, the base's row; the dependent's row stays where
// it is, read and written at its own `?package=`. Driven on a booted kernel
// (the real protocol, metadata service, registry and `sys_metadata` store).
//
// FROM (`main` 8596c80eda, measured through these doors before the change):
// with the read serving the base's row (200), the bare save, draft save,
// publish, history, delete and draft discard each refused 409
// RESOURCE_CONFLICT naming both packages.
//
// Measured beside it, unchanged by this change and pinned as they read:
// - after the bare delete removes the base's row, the bare read serves the
//   dependent's row, and the delete's receipt names that row as remaining;
// - a read-only (code) base: the bare save answers what `?package=<base>`
//   answers, 422 WRITABLE_PACKAGE_REQUIRED naming the base, not 409 naming both;
// - the shipped-base neighbour (the base ships the member in code, the
//   dependent stores a row of it): the bare read serves the base's code item
//   and the bare save is refused 403 NOT_OVERRIDABLE toward the base's pair,
//   writing nothing (the package-less write is closed there, ADR-0146 D11);
// - CONTROLS: two holders with no base relation, a package-less row beside the
//   holders (#33210), and a type with no members (#34441 contract review M1)
//   still refuse 409 naming both holders; an explicit `?package=` write still
//   lands where it names.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { HttpDispatcher } from '../http-dispatcher.js';

const CALLER = { userId: 'u_write_follows_base', tenantId: 'org_qa', isSystem: true, positions: [], permissions: [], systemPermissions: ['manage_metadata'] };
// Code packages (read-only bases): A ships `shipmail`, D declares A, U declares nothing.
const A = 'com.qa.writebase';
const D = 'com.qa.writeaddon';
const U = 'com.qa.writeother';
// Authored (writable) packages: WD declares WA.
const WA = 'com.qa.authoredbase';
const WD = 'com.qa.authoredaddon';

interface ManifestDoor { register(artifact: unknown): Promise<void> | void }
interface Booted { kernel: ObjectKernel; engine: ObjectQL; root: string; protocol: any }
interface Answer { status?: number; body: any }

const template = (locale: string, subject: string) => ({ label: subject, locale, subject, bodyHtml: `<p>${subject}</p>` });
const appManifest = (id: string, extra: Record<string, unknown> = {}) => ({
    id, name: id.split('.').pop(), namespace: id.split('.').pop()!.replace(/[^a-z]/g, ''), version: '1.0.0', type: 'app', objects: [], ...extra,
});
const MANIFESTS = [
    appManifest(A, { emailTemplates: [{ name: 'shipmail', ...template('en-US', 'base code en') }] }),
    appManifest(D, { dependencies: { [A]: '*' } }),
    appManifest(U),
];

async function boot(file: string): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const root = mkdtempSync(join(tmpdir(), 'os-meta-write-follows-base-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true }) as any, true);
    await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    const host: Plugin = {
        name: 'qa.write-follows-base-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            for (const manifest of MANIFESTS) await ctx.getService<ManifestDoor>('manifest').register(manifest);
        },
    };
    await kernel.use(host);
    await kernel.bootstrap();
    await engine.syncSchemas();
    engine.registry.installPackage({ id: WA, name: WA, version: '1.0.0', type: 'app' } as any, 'authored');
    engine.registry.installPackage({ id: WD, name: WD, version: '1.0.0', type: 'app', dependencies: { [WA]: '*' } } as any, 'authored');
    return { kernel, engine, root, protocol: kernel.getService('protocol') };
}

// A bundled type's non-canonical member carries its `bundle_member` key column, as the save door writes it.
const layRow = (engine: ObjectQL, type: string, name: string, packageId: string | null, metadata: Record<string, unknown>) => engine.insert('sys_metadata', {
    type, name, namespace: 'default', package_id: packageId, scope: 'platform', strategy: 'merge', state: 'active', version: 1,
    ...(type === 'email_template' && metadata.locale !== 'en-US' ? { bundle_member: metadata.locale } : {}),
    metadata: JSON.stringify({ name, ...metadata }),
}, { context: { isSystem: true } } as any);
const layPair = async (engine: ObjectQL, name: string, base: string, dependent: string) => {
    await layRow(engine, 'email_template', name, base, template('en-US', 'base en'));
    await layRow(engine, 'email_template', name, dependent, template('en-US', 'addon en'));
};

/** Every stored row of the name, `state:binding:subject`. */
const rowsOf = async (engine: ObjectQL, name: string, type = 'email_template') => ((await engine.find('sys_metadata', { where: { type, name }, context: { isSystem: true } } satisfies EngineQueryOptions)) as any[])
    .map((row) => {
        const body = JSON.parse(String(row.metadata));
        return `${row.state}:${row.package_id ?? null}:${body.subject ?? body.label}`;
    }).sort();

const codeOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.code : body?.code);
const unwrap = (body: any) => body?.data ?? body;

async function dispatch(kernel: ObjectKernel, method: 'GET' | 'PUT', path: string, query: Record<string, string> = {}, body?: unknown): Promise<Answer> {
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CALLER });
    const search = new URLSearchParams(query).toString();
    const raw = new Request(`http://localhost/api/v1${path}${search ? `?${search}` : ''}`, body === undefined
        ? { method }
        : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    try {
        const out: any = await dispatcher.dispatch(method, path, body ?? {}, query, { request: raw } as any, '/api/v1');
        return { status: out.response?.status as number | undefined, body: out.response?.body };
    } catch (e) {
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status, body: { error: { code: thrown.code, message: String((e as Error)?.message ?? '') } } };
    }
}
/** The bare read's answer: `[status, subject, packageId]`, or `[status, code]` when refused. */
const bareRead = async (b: Booted, name: string, query: Record<string, string> = {}) => {
    const r = await dispatch(b.kernel, 'GET', `/meta/email_template/${name}`, query);
    return r.status === 200 ? [200, unwrap(r.body)?.item?.subject, unwrap(r.body)?.packageId ?? null] : [r.status, codeOf(r.body)];
};
/** What `call` resolves to, or the `{ code, status, message }` it rejects with. */
const settle = (call: Promise<any>): Promise<any> => call.then(
    (resolved) => ({ resolved }),
    (error: any) => ({ code: error?.code, status: error?.status ?? error?.httpStatus, message: String(error?.message ?? '') }),
);
/** Refused 409 RESOURCE_CONFLICT, the message naming every one of `ids`. */
const expectRefusedNaming = (answer: any, ids: readonly string[], where: string) => {
    expect([where, answer.code, answer.status], JSON.stringify(answer)).toEqual([where, 'RESOURCE_CONFLICT', 409]);
    for (const id of ids) expect(answer.message, where).toContain(id);
};
const saveOf = (b: Booted, name: string, subject: string, extra: Record<string, unknown> = {}) =>
    settle(b.protocol.saveMetaItem({ type: 'email_template', name, item: { name, ...template('en-US', subject) }, ...extra }));

describe('[#34681] the bare write doors follow the row-held base the bare read serves', () => {
    const dirs: string[] = [];
    afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
    const freshFile = () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-meta-write-follows-base-db-'));
        dirs.push(dir);
        return join(dir, 'meta.sqlite');
    };
    const down = async (b: Booted) => {
        if (b.kernel.getState() === 'running') await b.kernel.shutdown();
        dirs.push(b.root);
    };

    it('save (REST door and in process), draft save, publish and history land in and answer for the base\'s row, as ?package=<base> does, before and after a restart', async () => {
        const file = freshFile();
        let b = await boot(file);
        try {
            await layPair(b.engine, 'w_mail', WA, WD);
            expect(await bareRead(b, 'w_mail')).toEqual([200, 'base en', WA]);
            // The REST door: PUT naming no package writes the base's row.
            const put = await dispatch(b.kernel, 'PUT', '/meta/email_template/w_mail', {}, { name: 'w_mail', ...template('en-US', 'edited') });
            expect(put.status, JSON.stringify(put.body)).toBe(200);
            expect(await rowsOf(b.engine, 'w_mail')).toEqual([`active:${WD}:addon en`, `active:${WA}:edited`]);
            expect(await bareRead(b, 'w_mail')).toEqual([200, 'edited', WA]);
            // The draft save writes the base's draft; the publish promotes it into the base's row.
            const drafted = await saveOf(b, 'w_mail', 'drafted', { mode: 'draft' });
            expect(drafted.resolved, JSON.stringify(drafted)).toMatchObject({ success: true, state: 'draft' });
            expect(await rowsOf(b.engine, 'w_mail')).toEqual([`active:${WD}:addon en`, `active:${WA}:edited`, `draft:${WA}:drafted`]);
            const published = await settle(b.protocol.publishMetaItem({ type: 'email_template', name: 'w_mail' }));
            expect(published.resolved, JSON.stringify(published)).toMatchObject({ success: true });
            expect(await rowsOf(b.engine, 'w_mail')).toEqual([`active:${WD}:addon en`, `active:${WA}:drafted`]);
            // The history naming no package is the base's versions, as `?package=` naming it reads them.
            const bare = await settle(b.protocol.historyMetaItem({ type: 'email_template', name: 'w_mail' }));
            const named = await settle(b.protocol.historyMetaItem({ type: 'email_template', name: 'w_mail', packageId: WA }));
            expect(bare.resolved?.events?.length, JSON.stringify(bare)).toBeGreaterThan(0);
            expect(bare).toEqual(named);
            // The dependent's own address still reads and writes its own row.
            expect(await bareRead(b, 'w_mail', { package: WD })).toEqual([200, 'addon en', WD]);
            const own = await saveOf(b, 'w_mail', 'addon edited', { packageId: WD });
            expect(own.resolved, JSON.stringify(own)).toMatchObject({ success: true });
            expect(await rowsOf(b.engine, 'w_mail')).toEqual([`active:${WD}:addon edited`, `active:${WA}:drafted`]);
        } finally {
            await down(b);
        }
        b = await boot(file);
        try {
            expect(await bareRead(b, 'w_mail')).toEqual([200, 'drafted', WA]);
            const saved = await saveOf(b, 'w_mail', 'after restart');
            expect(saved.resolved, JSON.stringify(saved)).toMatchObject({ success: true });
            expect(await rowsOf(b.engine, 'w_mail')).toEqual([`active:${WD}:addon edited`, `active:${WA}:after restart`]);
            expect(await bareRead(b, 'w_mail')).toEqual([200, 'after restart', WA]);
        } finally {
            await down(b);
        }
    }, 120_000);

    describe('one boot', () => {
        let b: Booted;
        beforeAll(async () => { b = await boot(freshFile()); }, 120_000);
        afterAll(async () => { if (b) await down(b); });

        it('the draft discard and the delete remove the base\'s draft and row; the bare read then serves the dependent\'s row, which the receipt names', async () => {
            await layPair(b.engine, 'w_del', WA, WD);
            expect((await saveOf(b, 'w_del', 'drafted', { mode: 'draft' })).resolved).toMatchObject({ success: true });
            const discarded = await settle(b.protocol.deleteMetaItem({ type: 'email_template', name: 'w_del', state: 'draft' }));
            expect(discarded.resolved, JSON.stringify(discarded)).toMatchObject({ success: true, reset: true });
            expect(await rowsOf(b.engine, 'w_del')).toEqual([`active:${WD}:addon en`, `active:${WA}:base en`]);
            const deleted = await settle(b.protocol.deleteMetaItem({ type: 'email_template', name: 'w_del' }));
            expect(deleted.resolved, JSON.stringify(deleted)).toMatchObject({ success: true, reset: true });
            expect(deleted.resolved.message).toContain(WD);
            expect(await rowsOf(b.engine, 'w_del')).toEqual([`active:${WD}:addon en`]);
            // Read after the delete: the dependent's row is the only row of the member left.
            expect(await bareRead(b, 'w_del')).toEqual([200, 'addon en', WD]);
        });

        it('a read-only base: the bare save and draft save answer what ?package=<base> answers, never 409 naming both', async () => {
            await layPair(b.engine, 'ro_mail', A, D);
            expect(await bareRead(b, 'ro_mail')).toEqual([200, 'base en', A]);
            for (const mode of ['publish', 'draft'] as const) {
                const bare = await saveOf(b, 'ro_mail', 'edited', { mode });
                const named = await saveOf(b, 'ro_mail', 'edited', { mode, packageId: A });
                expect([mode, bare.code, bare.status], JSON.stringify(bare)).toEqual([mode, 'WRITABLE_PACKAGE_REQUIRED', 422]);
                expect(bare.message).toContain(A);
                expect(bare.message).not.toContain(D);
                expect([bare.code, bare.status]).toEqual([named.code, named.status]);
            }
            expect(await rowsOf(b.engine, 'ro_mail')).toEqual([`active:${D}:addon en`, `active:${A}:base en`]);
        });

        it('the shipped-base neighbour reads as it did: the bare read serves the base\'s code item and the bare save is refused toward the base\'s pair, writing nothing', async () => {
            await layRow(b.engine, 'email_template', 'shipmail', D, template('en-US', 'addon en'));
            expect(await bareRead(b, 'shipmail')).toEqual([200, 'base code en', A]);
            const saved = await saveOf(b, 'shipmail', 'edited');
            expect([saved.code, saved.status], JSON.stringify(saved)).toEqual(['NOT_OVERRIDABLE', 403]);
            expect(saved.message).toContain(`${A}.custom`);
            expect(await rowsOf(b.engine, 'shipmail')).toEqual([`active:${D}:addon en`]);
            expect(await bareRead(b, 'shipmail')).toEqual([200, 'base code en', A]);
        });

        it('CONTROLS: holders with no base relation, a package-less row beside them and a type with no members still refuse naming both; ?package= still lands where it names', async () => {
            // Two holders, neither declaring the other.
            await layPair(b.engine, 'unrel_mail', A, U);
            expect(await bareRead(b, 'unrel_mail')).toEqual([409, 'RESOURCE_CONFLICT']);
            expectRefusedNaming(await saveOf(b, 'unrel_mail', 'x'), [A, U], 'unrelated: save');
            expectRefusedNaming(await settle(b.protocol.deleteMetaItem({ type: 'email_template', name: 'unrel_mail' })), [A, U], 'unrelated: delete');
            expect(await settle(b.protocol.historyMetaItem({ type: 'email_template', name: 'unrel_mail' }))).toMatchObject({ code: 'RESOURCE_CONFLICT' });
            // A package-less row beside a base and its dependent (#33210).
            await layPair(b.engine, 'loose_mail', WA, WD);
            await layRow(b.engine, 'email_template', 'loose_mail', null, template('en-US', 'loose en'));
            expect(await bareRead(b, 'loose_mail')).toEqual([409, 'RESOURCE_CONFLICT']);
            expectRefusedNaming(await saveOf(b, 'loose_mail', 'x'), [WA, WD], 'package-less row: save');
            // A type with no members: a base and its dependent stay two holders (#34441 contract review M1).
            await layRow(b.engine, 'dashboard', 'follow_dash', WA, { label: 'base row', widgets: [] });
            await layRow(b.engine, 'dashboard', 'follow_dash', WD, { label: 'addon row', widgets: [] });
            expectRefusedNaming(
                await settle(b.protocol.saveMetaItem({ type: 'dashboard', name: 'follow_dash', item: { name: 'follow_dash', label: 'x', widgets: [] } })),
                [WA, WD], 'no members: save',
            );
            expect(await rowsOf(b.engine, 'follow_dash', 'dashboard')).toEqual([`active:${WD}:addon row`, `active:${WA}:base row`]);
            // `?package=` naming the dependent writes the dependent's row, in the cell this change moves.
            await layPair(b.engine, 'named_mail', WA, WD);
            expect((await saveOf(b, 'named_mail', 'addon edited', { packageId: WD })).resolved).toMatchObject({ success: true });
            expect(await rowsOf(b.engine, 'named_mail')).toEqual([`active:${WD}:addon edited`, `active:${WA}:base en`]);
        });
    });
});
