// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#35524, epic ruling 6781691009, #34348 ruling (b), ADR-0150 D3/D5] A
// bundled type's name no package ships, held as stored rows by an authored
// base WA (its `en-US` row) and an authored dependent WD that declares WA (its
// `fr-FR` row, a bundle addition). At the named non-canonical member `fr-FR`
// only WD holds a row, and the read naming no package takes the row-held
// base's address there (#33210 (c), pinned unchanged in
// `meta-disabled-holder-served-stack.test.ts` M1, M2, S2): 404. The write
// naming no package now resolves its address as that read does: the bare
// save (the REST door and in process, publish and draft mode) writes WA's
// row or draft at `fr-FR`, exactly as the save naming WA does, WD's row stays
// byte-unchanged, and the next bare read serves what was saved. The draft
// doors naming no package (the strict draft read, the per-item publish and
// the draft discard) take the same draft address, so the draft a bare draft
// save writes is the one they read, promote and discard; at this cell the
// dependent's own draft is reached at its own `?package=`, as the request
// naming WA answers. Driven on a booted kernel (the real protocol, metadata
// service, registry and `sys_metadata` store).
//
// FROM (`main` a73edb3cd7, measured through these doors): the bare read at
// `fr-FR` answered 404, the bare save answered 200 and rewrote WD's row, and
// the bare read after it answered 404 on a kernel whose registry had hydrated
// both rows at boot, or 409 RESOURCE_CONFLICT (the base's address names WA,
// the registry then named WD the holder) where the rows were stored after
// boot. The bare draft save wrote WD's draft, the bare draft read served it,
// and the bare publish promoted it into WD's row; the bare publish and
// discard of WD's draft promoted or removed it.
//
// Measured beside it, pinned as they read: the canonical member a base and
// its dependent both hold (the #34681 cell) and the canonical member only the
// dependent holds (#33210 contract review S1) keep their writes; two holders
// with no base relation are still refused 409 at a member both hold; a base
// that ships the name in code keeps answering as it does today (the bare read
// 404, the bare save writing the dependent's customization row: not moved by
// this change, see the PR's acceptance notes); a read-only base holding rows
// answers the bare save as `?package=<base>` does.

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

const CALLER = { userId: 'u_dep_member', tenantId: 'org_qa', isSystem: true, positions: [], permissions: [], systemPermissions: ['manage_metadata'] };
const A = 'com.qa.depmemberbase';
const D = 'com.qa.depmemberaddon';
const U = 'com.qa.depmemberother';
const WA = 'com.qa.authoredbase';
const WD = 'com.qa.authoredaddon';
const WU = 'com.qa.authoredother';

interface ManifestDoor { register(artifact: unknown): Promise<void> | void }
interface Booted { kernel: ObjectKernel; engine: ObjectQL; root: string; protocol: any }

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
    const root = mkdtempSync(join(tmpdir(), 'os-meta-dep-member-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true }) as any, true);
    await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    const host: Plugin = {
        name: 'qa.dep-member-host',
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
    engine.registry.installPackage({ id: WU, name: WU, version: '1.0.0', type: 'app' } as any, 'authored');
    return { kernel, engine, root, protocol: kernel.getService('protocol') };
}

const layRow = (engine: ObjectQL, type: string, name: string, packageId: string | null, metadata: Record<string, unknown>, state: 'active' | 'draft' = 'active') => engine.insert('sys_metadata', {
    type, name, namespace: 'default', package_id: packageId, scope: 'platform', strategy: 'merge', state, version: 1,
    ...(type === 'email_template' && metadata.locale !== 'en-US' ? { bundle_member: metadata.locale } : {}),
    metadata: JSON.stringify({ name, ...metadata }),
}, { context: { isSystem: true } } as any);
const layCell = async (engine: ObjectQL, name: string, base: string, dependent: string) => {
    await layRow(engine, 'email_template', name, base, template('en-US', 'base en'));
    await layRow(engine, 'email_template', name, dependent, template('fr-FR', 'addon fr'));
};
const rowsOf = async (engine: ObjectQL, name: string) => ((await engine.find('sys_metadata', { where: { type: 'email_template', name }, context: { isSystem: true } } satisfies EngineQueryOptions)) as any[])
    .map((row) => {
        const body = JSON.parse(String(row.metadata));
        return `${row.state}:${row.package_id ?? null}:${row.bundle_member ?? '-'}:${body.subject ?? body.label}`;
    }).sort();
const codeOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.code : body?.code);
const unwrap = (body: any) => body?.data ?? body;
async function dispatch(kernel: ObjectKernel, method: 'GET' | 'PUT', path: string, query: Record<string, string> = {}, body?: unknown) {
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
const bareRead = async (b: Booted, name: string, query: Record<string, string> = {}) => {
    const r = await dispatch(b.kernel, 'GET', `/meta/email_template/${name}`, query);
    return r.status === 200 ? [200, unwrap(r.body)?.item?.subject, unwrap(r.body)?.packageId ?? null] : [r.status, codeOf(r.body), String(r.body?.error?.message ?? '').slice(0, 400)];
};
const settle = (call: Promise<any>): Promise<any> => call.then(
    (resolved) => ({ ok: resolved?.success ?? true, message: resolved?.message }),
    (error: any) => ({ code: error?.code, status: error?.status ?? error?.httpStatus, message: String(error?.message ?? '') }),
);
const putFr = (b: Booted, name: string, subject: string, query: Record<string, string> = {}) =>
    dispatch(b.kernel, 'PUT', `/meta/email_template/${name}`, query, { name, ...template('fr-FR', subject) });
const saveFr = (b: Booted, name: string, subject: string, extra: Record<string, unknown> = {}) =>
    settle(b.protocol.saveMetaItem({ type: 'email_template', name, item: { name, ...template('fr-FR', subject) }, ...extra }));

const fr = { member: 'fr-FR' };
/** Every stored column of the dependent's `fr-FR` row, for a byte-identity comparison. */
const dependentRow = async (engine: ObjectQL, name: string, dependent = WD) => JSON.stringify(((await engine.find('sys_metadata', { where: { type: 'email_template', name, package_id: dependent }, context: { isSystem: true } } satisfies EngineQueryOptions)) as any[])
    .filter((row) => row.bundle_member === 'fr-FR'));
/** The rows of `name` with the name blanked, to compare two names' writes. */
const shapeOf = async (engine: ObjectQL, name: string) => (await rowsOf(engine, name)).map((row) => row.replace(name, 'NAME'));

describe('[#35524] the bare save at a member only the dependent holds writes the row-held base\'s row the bare read addresses', () => {
    const dirs: string[] = [];
    afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
    const freshFile = () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-meta-dep-member-db-'));
        dirs.push(dir);
        return join(dir, 'meta.sqlite');
    };
    const down = async (b: Booted) => {
        if (b.kernel.getState() === 'running') await b.kernel.shutdown();
        dirs.push(b.root);
    };

    it('the bare save (REST door and in process) writes what ?package=<base> writes, leaves the dependent\'s row byte-unchanged, and the bare read then serves it, before and after a restart', async () => {
        const file = freshFile();
        let b = await boot(file);
        try {
            for (const name of ['dm_rest', 'dm_proc', 'dm_named']) await layCell(b.engine, name, WA, WD);
        } finally {
            await down(b);
        }
        // Booted over the stored rows, so the registry hydrated both packages' rows.
        b = await boot(file);
        try {
            expect(await bareRead(b, 'dm_rest', fr)).toEqual([404, 'RESOURCE_NOT_FOUND', expect.any(String)]);
            const before = await dependentRow(b.engine, 'dm_rest');
            const put = await putFr(b, 'dm_rest', 'edited fr');
            expect(put.status, JSON.stringify(put.body)).toBe(200);
            expect(await dependentRow(b.engine, 'dm_rest')).toBe(before);
            const proc = await saveFr(b, 'dm_proc', 'edited fr');
            expect(proc.message, JSON.stringify(proc)).toContain(`package=${WA}`);
            const named = await saveFr(b, 'dm_named', 'edited fr', { packageId: WA });
            expect(named.ok, JSON.stringify(named)).toBe(true);
            const expected = [`active:${WD}:fr-FR:addon fr`, `active:${WA}:-:base en`, `active:${WA}:fr-FR:edited fr`];
            for (const name of ['dm_rest', 'dm_proc', 'dm_named']) {
                expect([name, ...await rowsOf(b.engine, name)]).toEqual([name, ...expected]);
                expect(await bareRead(b, name, fr)).toEqual([200, 'edited fr', WA]);
                expect(await bareRead(b, name, { ...fr, package: WD })).toEqual([200, 'addon fr', WD]);
            }
            expect(await shapeOf(b.engine, 'dm_rest')).toEqual(await shapeOf(b.engine, 'dm_named'));
        } finally {
            await down(b);
        }
        b = await boot(file);
        try {
            expect(await bareRead(b, 'dm_rest', fr)).toEqual([200, 'edited fr', WA]);
        } finally {
            await down(b);
        }
    }, 120_000);

    describe('one boot', () => {
        let b: Booted;
        beforeAll(async () => { b = await boot(freshFile()); }, 120_000);
        afterAll(async () => { if (b) await down(b); });

        it('rows stored after boot: the bare save writes the base\'s row and the bare read serves it (it answered 409 after the save)', async () => {
            await layCell(b.engine, 'dm_cold', WA, WD);
            expect((await bareRead(b, 'dm_cold', fr))[0]).toBe(404);
            const put = await putFr(b, 'dm_cold', 'edited fr');
            expect(put.status, JSON.stringify(put.body)).toBe(200);
            expect(await rowsOf(b.engine, 'dm_cold')).toEqual([`active:${WD}:fr-FR:addon fr`, `active:${WA}:-:base en`, `active:${WA}:fr-FR:edited fr`]);
            expect(await bareRead(b, 'dm_cold', fr)).toEqual([200, 'edited fr', WA]);
        });

        it('the bare draft save writes the base\'s draft, as ?package=<base> does; the bare draft read, publish and discard act on that draft', async () => {
            await layCell(b.engine, 'dd_bare', WA, WD);
            await layCell(b.engine, 'dd_named', WA, WD);
            const before = await dependentRow(b.engine, 'dd_bare');
            const bare = await saveFr(b, 'dd_bare', 'drafted fr', { mode: 'draft' });
            const named = await saveFr(b, 'dd_named', 'drafted fr', { mode: 'draft', packageId: WA });
            expect(bare.message, JSON.stringify(bare)).toContain(`package=${WA}`);
            expect(named.ok, JSON.stringify(named)).toBe(true);
            expect(await rowsOf(b.engine, 'dd_bare')).toEqual([`active:${WD}:fr-FR:addon fr`, `active:${WA}:-:base en`, `draft:${WA}:fr-FR:drafted fr`]);
            expect(await shapeOf(b.engine, 'dd_bare')).toEqual(await shapeOf(b.engine, 'dd_named'));
            expect(await dependentRow(b.engine, 'dd_bare')).toBe(before);
            const read = await b.protocol.getMetaItem({ type: 'email_template', name: 'dd_bare', member: 'fr-FR', state: 'draft' });
            expect([read?.item?.subject, read?.item?._packageId]).toEqual(['drafted fr', WA]);
            const published = await settle(b.protocol.publishMetaItem({ type: 'email_template', name: 'dd_bare', member: 'fr-FR' }));
            expect(published.ok, JSON.stringify(published)).toBe(true);
            expect(await rowsOf(b.engine, 'dd_bare')).toEqual([`active:${WD}:fr-FR:addon fr`, `active:${WA}:-:base en`, `active:${WA}:fr-FR:drafted fr`]);
            expect(await bareRead(b, 'dd_bare', fr)).toEqual([200, 'drafted fr', WA]);
            // The discard removes the draft the bare draft save wrote.
            await layCell(b.engine, 'dd_discard', WA, WD);
            expect((await saveFr(b, 'dd_discard', 'drafted fr', { mode: 'draft' })).ok).toBe(true);
            const discarded = await settle(b.protocol.deleteMetaItem({ type: 'email_template', name: 'dd_discard', member: 'fr-FR', state: 'draft' }));
            expect(discarded.message, JSON.stringify(discarded)).toContain(`(package=${WA})`);
            expect(await rowsOf(b.engine, 'dd_discard')).toEqual([`active:${WD}:fr-FR:addon fr`, `active:${WA}:-:base en`]);
        });

        it('the dependent\'s own draft at the cell: the bare publish and discard answer what ?package=<base> answers, and ?package=<dependent> reaches it', async () => {
            const outcome = (answer: any) => (answer.code !== undefined ? [answer.code, answer.status] : ['ok', answer.ok]);
            const seen: Record<string, unknown> = {};
            for (const [label, at] of [['bare', {}], ['named', { packageId: WA }]] as const) {
                const name = `dd_own_${label}`;
                await layCell(b.engine, name, WA, WD);
                await layRow(b.engine, 'email_template', name, WD, template('fr-FR', 'addon fr draft'), 'draft');
                const publish = await settle(b.protocol.publishMetaItem({ type: 'email_template', name, member: 'fr-FR', ...at }));
                const discard = await settle(b.protocol.deleteMetaItem({ type: 'email_template', name, member: 'fr-FR', state: 'draft', ...at }));
                seen[label] = { publish: outcome(publish), discard: outcome(discard), rows: await shapeOf(b.engine, name) };
            }
            expect(seen.bare, JSON.stringify(seen)).toEqual(seen.named);
            expect(seen.bare).toMatchObject({ rows: [`active:${WD}:fr-FR:addon fr`, `active:${WA}:-:base en`, `draft:${WD}:fr-FR:addon fr draft`] });
            const own = await settle(b.protocol.publishMetaItem({ type: 'email_template', name: 'dd_own_bare', member: 'fr-FR', packageId: WD }));
            expect(own.ok, JSON.stringify(own)).toBe(true);
            expect(await rowsOf(b.engine, 'dd_own_bare')).toEqual([`active:${WD}:fr-FR:addon fr draft`, `active:${WA}:-:base en`]);
        });

        describe('a package-unbound draft stored at the member (contract review S1): the bare draft doors act on it as on main, never a draft bound to the base', () => {
            // A bare draft save at fr-FR while no package holds that member is
            // the package-unbound draft; the dependent's fr-FR row is stored after it.
            const lay = async (name: string) => {
                await layRow(b.engine, 'email_template', name, WA, template('en-US', 'base en'));
                const drafted = await saveFr(b, name, 'unbound fr', { mode: 'draft' });
                expect(drafted.ok, JSON.stringify(drafted)).toBe(true);
                await layRow(b.engine, 'email_template', name, WD, template('fr-FR', 'addon fr'));
                expect(await rowsOf(b.engine, name)).toEqual([`active:${WD}:fr-FR:addon fr`, `active:${WA}:-:base en`, 'draft:null:fr-FR:unbound fr']);
            };

            it('the bare draft read serves it', async () => {
                await lay('ud_read');
                const read = await b.protocol.getMetaItem({ type: 'email_template', name: 'ud_read', member: 'fr-FR', state: 'draft' });
                expect([read?.item?.subject, read?.item?._packageId ?? null]).toEqual(['unbound fr', null]);
            });

            it('the bare draft save adopts it into the package its active row is bound to: one draft, none bound to the base', async () => {
                await lay('ud_save');
                const saved = await saveFr(b, 'ud_save', 'unbound fr again', { mode: 'draft' });
                expect(saved.ok, JSON.stringify(saved)).toBe(true);
                expect(await rowsOf(b.engine, 'ud_save')).toEqual([`active:${WD}:fr-FR:addon fr`, `active:${WA}:-:base en`, `draft:${WD}:fr-FR:unbound fr again`]);
            });

            it('the bare per-item publish promotes it into the dependent\'s row', async () => {
                await lay('ud_publish');
                const published = await settle(b.protocol.publishMetaItem({ type: 'email_template', name: 'ud_publish', member: 'fr-FR' }));
                expect(published.ok, JSON.stringify(published)).toBe(true);
                expect(await rowsOf(b.engine, 'ud_publish')).toEqual([`active:${WD}:fr-FR:unbound fr`, `active:${WA}:-:base en`]);
            });

            it('the bare draft discard removes it', async () => {
                await lay('ud_discard');
                const discarded = await settle(b.protocol.deleteMetaItem({ type: 'email_template', name: 'ud_discard', member: 'fr-FR', state: 'draft' }));
                expect(discarded.ok, JSON.stringify(discarded)).toBe(true);
                expect(await rowsOf(b.engine, 'ud_discard')).toEqual([`active:${WD}:fr-FR:addon fr`, `active:${WA}:-:base en`]);
            });
        });

        it('a read-only base holding rows: the bare save at the dependent\'s member answers what ?package=<base> answers', async () => {
            await layCell(b.engine, 'ro_cell', A, D);
            const bare = await saveFr(b, 'ro_cell', 'edited');
            const named = await saveFr(b, 'ro_cell', 'edited', { packageId: A });
            expect([bare.code, bare.status], JSON.stringify(bare)).toEqual(['WRITABLE_PACKAGE_REQUIRED', 422]);
            expect([bare.code, bare.status]).toEqual([named.code, named.status]);
            expect(bare.message).toContain(`'${A}'`);
            expect(await rowsOf(b.engine, 'ro_cell')).toEqual([`active:${D}:fr-FR:addon fr`, `active:${A}:-:base en`]);
        });

        it('CONTROLS: the canonical member keeps its writes, unrelated holders are still refused at a shared member, and a shipped base answers as it did', async () => {
            // The #34681 cell: base and dependent both hold the canonical member; the bare save writes the base's row.
            await layRow(b.engine, 'email_template', 'c_shared', WA, template('en-US', 'base en'));
            await layRow(b.engine, 'email_template', 'c_shared', WD, template('en-US', 'addon en'));
            await layRow(b.engine, 'email_template', 'c_shared', WD, template('fr-FR', 'addon fr'));
            const shared = await settle(b.protocol.saveMetaItem({ type: 'email_template', name: 'c_shared', item: { name: 'c_shared', ...template('en-US', 'edited en') } }));
            expect(shared.message, JSON.stringify(shared)).toContain(`package=${WA}`);
            expect(await rowsOf(b.engine, 'c_shared')).toEqual([`active:${WD}:-:addon en`, `active:${WD}:fr-FR:addon fr`, `active:${WA}:-:edited en`]);
            // The S1 mirror: the canonical member only the dependent holds is served and written at the dependent.
            await layRow(b.engine, 'email_template', 'c_s1', WA, template('fr-FR', 'base fr'));
            await layRow(b.engine, 'email_template', 'c_s1', WD, template('en-US', 'addon en'));
            expect(await bareRead(b, 'c_s1')).toEqual([200, 'addon en', WD]);
            const s1 = await settle(b.protocol.saveMetaItem({ type: 'email_template', name: 'c_s1', item: { name: 'c_s1', ...template('en-US', 'edited en') } }));
            expect(s1.message, JSON.stringify(s1)).toContain(`package=${WD}`);
            expect(await rowsOf(b.engine, 'c_s1')).toEqual([`active:${WD}:-:edited en`, `active:${WA}:fr-FR:base fr`]);
            // Two packages, neither declaring the other, at a member both hold: refused 409 naming both.
            await layRow(b.engine, 'email_template', 'c_unrel', WA, template('en-US', 'a en'));
            await layRow(b.engine, 'email_template', 'c_unrel', WU, template('en-US', 'u en'));
            expect((await bareRead(b, 'c_unrel')).slice(0, 2)).toEqual([409, 'RESOURCE_CONFLICT']);
            const unrel = await settle(b.protocol.saveMetaItem({ type: 'email_template', name: 'c_unrel', item: { name: 'c_unrel', ...template('en-US', 'x') } }));
            expect([unrel.code, unrel.status], JSON.stringify(unrel)).toEqual(['RESOURCE_CONFLICT', 409]);
            for (const id of [WA, WU]) expect(unrel.message).toContain(id);
            // …and at a member only one of them holds, that package's row is read and written.
            await layCell(b.engine, 'c_unrel_fr', WA, WU);
            expect(await bareRead(b, 'c_unrel_fr', fr)).toEqual([200, 'addon fr', WU]);
            expect((await saveFr(b, 'c_unrel_fr', 'x')).message).toContain(`package=${WU}`);
            // A base that ships the name in code: answered as today (not moved here).
            await layRow(b.engine, 'email_template', 'shipmail', D, template('fr-FR', 'addon fr'));
            expect((await bareRead(b, 'shipmail', fr))[0]).toBe(404);
            const ship = await saveFr(b, 'shipmail', 'edited');
            expect(ship.message, JSON.stringify(ship)).toContain(`package=${D}`);
            expect(await rowsOf(b.engine, 'shipmail')).toEqual([`active:${D}:fr-FR:edited`]);
        });
    });
});
