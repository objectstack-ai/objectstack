// MEASURE (temporary): the cell on main before any change.
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
    (error: any) => ({ code: error?.code, status: error?.status ?? error?.httpStatus, message: String(error?.message ?? '').slice(0, 160) }),
);
const putFr = (b: Booted, name: string, subject: string, query: Record<string, string> = {}) =>
    dispatch(b.kernel, 'PUT', `/meta/email_template/${name}`, query, { name, ...template('fr-FR', subject) });
const saveFr = (b: Booted, name: string, subject: string, extra: Record<string, unknown> = {}) =>
    settle(b.protocol.saveMetaItem({ type: 'email_template', name, item: { name, ...template('fr-FR', subject) }, ...extra }));

describe('MEASURE', () => {
    const dirs: string[] = [];
    let b: Booted;
    beforeAll(async () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-meta-dep-member-db-'));
        dirs.push(dir);
        b = await boot(join(dir, 'meta.sqlite'));
    }, 120_000);
    afterAll(async () => { await b.kernel.shutdown(); dirs.push(b.root); for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
    const out: Record<string, unknown> = {};
    afterAll(() => { console.log('MEASURED ' + JSON.stringify(out, null, 1)); });

    it('measures', async () => {
        const fr = { member: 'fr-FR' };
        // 3-step, REST
        await layCell(b.engine, 'm1', WA, WD);
        out.m1_step1 = await bareRead(b, 'm1', fr);
        const put = await putFr(b, 'm1', 'edited fr');
        out.m1_step2 = [put.status, codeOf(put.body), String(put.body?.error?.message ?? '').slice(0, 200)];
        out.m1_rows = await rowsOf(b.engine, 'm1');
        out.m1_step3 = await bareRead(b, 'm1', fr);
        out.m1_step3_WD = await bareRead(b, 'm1', { ...fr, package: WD });
        out.m1_step3_WA = await bareRead(b, 'm1', { ...fr, package: WA });
        out.m1_en = await bareRead(b, 'm1');
        const reg: any = b.engine.registry;
        out.m1_registry = { holders: reg.packageScopedHoldersOf?.('email_template', 'm1', null, { includeDisabledPackages: true }), env: reg.getEnvironmentScopedItem?.('email_template', 'm1', 'fr-FR') !== undefined };
        // in process bare
        await layCell(b.engine, 'm1p', WA, WD);
        out.m1p_save = await saveFr(b, 'm1p', 'edited fr');
        out.m1p_rows = await rowsOf(b.engine, 'm1p');
        out.m1p_read = await bareRead(b, 'm1p', fr);
        // named WA
        await layCell(b.engine, 'm2', WA, WD);
        out.m2_save_named = await saveFr(b, 'm2', 'base fr', { packageId: WA });
        out.m2_rows = await rowsOf(b.engine, 'm2');
        out.m2_read = await bareRead(b, 'm2', fr);
        out.m2_read_WD = await bareRead(b, 'm2', { ...fr, package: WD });
        await layCell(b.engine, 'm2r', WA, WD);
        const putNamed = await putFr(b, 'm2r', 'base fr', { package: WA });
        out.m2r_put_named = [putNamed.status, codeOf(putNamed.body)];
        out.m2r_rows = await rowsOf(b.engine, 'm2r');
        // draft bare / named
        await layCell(b.engine, 'm3', WA, WD);
        out.m3_draft_bare = await saveFr(b, 'm3', 'drafted fr', { mode: 'draft' });
        out.m3_rows = await rowsOf(b.engine, 'm3');
        const dr = await settle(b.protocol.getMetaItem({ type: 'email_template', name: 'm3', member: 'fr-FR', state: 'draft' }).then((r: any) => ({ success: true, message: `${r?.item?.subject}|${r?.item?._packageId}` })));
        out.m3_draft_read = dr;
        out.m3_publish = await settle(b.protocol.publishMetaItem({ type: 'email_template', name: 'm3', member: 'fr-FR' }));
        out.m3_rows_after_publish = await rowsOf(b.engine, 'm3');
        out.m3_read_after_publish = await bareRead(b, 'm3', fr);
        await layCell(b.engine, 'm3b', WA, WD);
        out.m3b_draft_bare = await saveFr(b, 'm3b', 'drafted fr', { mode: 'draft' });
        out.m3b_discard = await settle(b.protocol.deleteMetaItem({ type: 'email_template', name: 'm3b', member: 'fr-FR', state: 'draft' }));
        out.m3b_rows = await rowsOf(b.engine, 'm3b');
        await layCell(b.engine, 'm4', WA, WD);
        out.m4_draft_named = await saveFr(b, 'm4', 'drafted fr', { mode: 'draft', packageId: WA });
        out.m4_rows = await rowsOf(b.engine, 'm4');
        out.m4_draft_read_named = await settle(b.protocol.getMetaItem({ type: 'email_template', name: 'm4', member: 'fr-FR', state: 'draft', packageId: WA }).then((r: any) => ({ success: true, message: `${r?.item?.subject}|${r?.item?._packageId}` })));
        out.m4_publish_named = await settle(b.protocol.publishMetaItem({ type: 'email_template', name: 'm4', member: 'fr-FR', packageId: WA }));
        out.m4_rows_after_publish = await rowsOf(b.engine, 'm4');
        await layCell(b.engine, 'm4b', WA, WD);
        out.m4b_draft_named = await saveFr(b, 'm4b', 'drafted fr', { mode: 'draft', packageId: WA });
        out.m4b_discard_named = await settle(b.protocol.deleteMetaItem({ type: 'email_template', name: 'm4b', member: 'fr-FR', state: 'draft', packageId: WA }));
        out.m4b_rows = await rowsOf(b.engine, 'm4b');
        // other doors bare at fr-FR
        await layCell(b.engine, 'd1', WA, WD);
        out.d1_delete = await settle(b.protocol.deleteMetaItem({ type: 'email_template', name: 'd1', member: 'fr-FR' }));
        out.d1_rows = await rowsOf(b.engine, 'd1');
        await layCell(b.engine, 'd2', WA, WD);
        await layRow(b.engine, 'email_template', 'd2', WD, template('fr-FR', 'addon fr draft'), 'draft');
        out.d2_discard = await settle(b.protocol.deleteMetaItem({ type: 'email_template', name: 'd2', member: 'fr-FR', state: 'draft' }));
        out.d2_rows = await rowsOf(b.engine, 'd2');
        await layCell(b.engine, 'd3', WA, WD);
        await layRow(b.engine, 'email_template', 'd3', WD, template('fr-FR', 'addon fr draft'), 'draft');
        out.d3_publish = await settle(b.protocol.publishMetaItem({ type: 'email_template', name: 'd3', member: 'fr-FR' }));
        out.d3_rows = await rowsOf(b.engine, 'd3');
        await layCell(b.engine, 'd4', WA, WD);
        expect((await saveFr(b, 'd4', 'addon fr v2', { packageId: WD })).ok).toBe(true);
        const hb = await b.protocol.historyMetaItem({ type: 'email_template', name: 'd4', member: 'fr-FR' }).then((r: any) => ({ events: r?.events?.length, pkg: r?.packageId }), (e: any) => ({ code: e?.code }));
        const hWA = await b.protocol.historyMetaItem({ type: 'email_template', name: 'd4', member: 'fr-FR', packageId: WA }).then((r: any) => ({ events: r?.events?.length }), (e: any) => ({ code: e?.code }));
        const hWD = await b.protocol.historyMetaItem({ type: 'email_template', name: 'd4', member: 'fr-FR', packageId: WD }).then((r: any) => ({ events: r?.events?.length }), (e: any) => ({ code: e?.code }));
        out.d4_history = { bare: hb, WA: hWA, WD: hWD };
        out.d4_diff = await settle(b.protocol.diffMetaItem({ type: 'email_template', name: 'd4', member: 'fr-FR' }));
        out.d4_rollback = await settle(b.protocol.rollbackMetaItem({ type: 'email_template', name: 'd4', member: 'fr-FR', toVersion: 1 }));
        out.d4_rows = await rowsOf(b.engine, 'd4');
        // controls
        await layCell(b.engine, 'c_unrel', WA, WU);
        out.c_unrel_read = await bareRead(b, 'c_unrel', fr);
        out.c_unrel_save = await saveFr(b, 'c_unrel', 'x');
        out.c_unrel_rows = await rowsOf(b.engine, 'c_unrel');
        await layRow(b.engine, 'email_template', 'c_unrel2', WA, template('en-US', 'a en'));
        await layRow(b.engine, 'email_template', 'c_unrel2', WU, template('en-US', 'u en'));
        out.c_unrel2_read = await bareRead(b, 'c_unrel2');
        out.c_unrel2_save = await settle(b.protocol.saveMetaItem({ type: 'email_template', name: 'c_unrel2', item: { name: 'c_unrel2', ...template('en-US', 'x') } }));
        await layRow(b.engine, 'email_template', 'shipmail', D, template('fr-FR', 'addon fr'));
        out.c_ship_read = await bareRead(b, 'shipmail', fr);
        out.c_ship_save = await saveFr(b, 'shipmail', 'edited');
        out.c_ship_rows = await rowsOf(b.engine, 'shipmail');
        await layCell(b.engine, 'c_ro', A, D);
        out.c_ro_read = await bareRead(b, 'c_ro', fr);
        out.c_ro_save = await saveFr(b, 'c_ro', 'edited');
        out.c_ro_save_A = await saveFr(b, 'c_ro', 'edited', { packageId: A });
        out.c_ro_save_D = await saveFr(b, 'c_ro', 'edited', { packageId: D });
        out.c_ro_rows = await rowsOf(b.engine, 'c_ro');
        // canonical member en-US pair (as #35450): bare save writes base
        await layRow(b.engine, 'email_template', 'c_can', WA, template('en-US', 'base en'));
        await layRow(b.engine, 'email_template', 'c_can', WD, template('en-US', 'addon en'));
        await layRow(b.engine, 'email_template', 'c_can', WD, template('fr-FR', 'addon fr'));
        out.c_can_save = await settle(b.protocol.saveMetaItem({ type: 'email_template', name: 'c_can', item: { name: 'c_can', ...template('en-US', 'edited en') } }));
        out.c_can_rows = await rowsOf(b.engine, 'c_can');
        // S1 mirror: dependent's canonical over base of other member
        await layRow(b.engine, 'email_template', 'c_s1', WA, template('fr-FR', 'base fr'));
        await layRow(b.engine, 'email_template', 'c_s1', WD, template('en-US', 'addon en'));
        out.c_s1_read = await bareRead(b, 'c_s1');
        out.c_s1_save = await settle(b.protocol.saveMetaItem({ type: 'email_template', name: 'c_s1', item: { name: 'c_s1', ...template('en-US', 'edited en') } }));
        out.c_s1_rows = await rowsOf(b.engine, 'c_s1');
    }, 120_000);
});

describe('MEASURE reboot', () => {
    it('measures across reboots', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-meta-dep-member-db-'));
        const file = join(dir, 'meta.sqlite');
        const out: Record<string, unknown> = {};
        const fr = { member: 'fr-FR' };
        let b = await boot(file);
        await layCell(b.engine, 'r1', WA, WD);
        out.a_read_before_reboot = await bareRead(b, 'r1', fr);
        await b.kernel.shutdown();
        b = await boot(file);
        out.b_read_after_reboot = await bareRead(b, 'r1', fr);
        const put = await putFr(b, 'r1', 'edited fr');
        out.c_put = [put.status, codeOf(put.body)];
        out.c_rows = await rowsOf(b.engine, 'r1');
        out.d_read_after_put = await bareRead(b, 'r1', fr);
        await b.kernel.shutdown();
        b = await boot(file);
        out.e_read_after_second_reboot = await bareRead(b, 'r1', fr);
        out.e_read_WA = await bareRead(b, 'r1', { ...fr, package: WA });
        await b.kernel.shutdown();
        rmSync(dir, { recursive: true, force: true });
        console.log('MEASURED-REBOOT ' + JSON.stringify(out, null, 1));
    }, 120_000);
});
