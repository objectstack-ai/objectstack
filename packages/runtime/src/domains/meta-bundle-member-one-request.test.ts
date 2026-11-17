// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#34682] The read naming no bundle member and the read naming the canonical
// member (`?member=en-US`) are one request (`resolveBundleMemberSelector`; the
// spec's selector sentence: "Absent, the canonical member (`en-US` for
// `email_template`) […]; naming the canonical value is the same request"), and
// `/published` reads that same canonical member. Each pair gets one answer, on
// every by-name door (the plain read, `/layers`, the execution read), before
// and after a restart, with a type that has no members as the CONTROL.
//
// FROM (`main` d947a93cf8), a bundle with no canonical member:
// - shipped in `fr-FR` only: the plain read and `/layers` served the `fr-FR`
//   member (200) and the execution read returned it, naming no package and
//   naming the shipping package (`?package=`), while `?member=en-US` and
//   `/published` answered 404;
// - stored in `fr-FR` only (a package-less row): 404 before a restart, then
//   200 with the `fr-FR` row after it (the hydrated bare slot), while
//   `?member=en-US` and `/published` answered 404 on both sides.
// Driven on a booted kernel through `HttpDispatcher.dispatch`.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import { HttpDispatcher } from '../http-dispatcher.js';

const CALLER = { userId: 'u_member_one_request', tenantId: 'org_qa', isSystem: true, positions: [], permissions: [], systemPermissions: ['manage_metadata'] };
const A = 'com.qa.memberbase';
const CANONICAL = 'en-US';

interface ManifestDoor { register(artifact: unknown): Promise<void> | void }
interface Booted { kernel: ObjectKernel; engine: ObjectQL; root: string }
interface Answer { status?: number; body: any }

const template = (locale: string, subject: string) => ({ label: subject, locale, subject, bodyHtml: `<p>${subject}</p>` });
const MANIFEST = {
    id: A, name: 'memberbase', namespace: 'memberbase', version: '1.0.0', type: 'app', objects: [],
    emailTemplates: [
        { name: 'ship_fr_mail', ...template('fr-FR', 'ship fr') },
        { name: 'ship_both_mail', ...template('en-US', 'ship en') },
        { name: 'ship_both_mail', ...template('fr-FR', 'ship fr') },
    ],
    dashboards: [{ name: 'ship_dash', label: 'ship dash', widgets: [] }],
};

// Package-less rows of the environment, as a save of each member stores them:
// a non-canonical member carries its `bundle_member` key column.
const ROWS: readonly [type: string, name: string, member: string | null, body: Record<string, unknown>][] = [
    ['email_template', 'row_fr_mail', 'fr-FR', template('fr-FR', 'row fr')],
    ['email_template', 'row_both_mail', null, template('en-US', 'row en')],
    ['email_template', 'row_both_mail', 'fr-FR', template('fr-FR', 'row fr')],
    ['dashboard', 'row_dash', null, { label: 'row dash', widgets: [] }],
];

async function boot(file: string): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const root = mkdtempSync(join(tmpdir(), 'os-meta-member-one-request-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true }) as any, true);
    await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    const host: Plugin = {
        name: 'qa.member-one-request-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => { await ctx.getService<ManifestDoor>('manifest').register(MANIFEST); },
    };
    await kernel.use(host);
    await kernel.bootstrap();
    await engine.syncSchemas();
    return { kernel, engine, root };
}

async function get(kernel: ObjectKernel, path: string, query: Record<string, string> = {}): Promise<Answer> {
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CALLER });
    const raw = new Request(`http://localhost/api/v1${path}`, { method: 'GET' });
    try {
        const out: any = await dispatcher.dispatch('GET', path, {}, query, { request: raw } as any, '/api/v1');
        return { status: out.response?.status as number | undefined, body: out.response?.body };
    } catch (e) {
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status, body: { error: { code: thrown.code, message: String((e as Error)?.message ?? '') } } };
    }
}

const unwrap = (body: any) => body?.data ?? body;
const codeOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.code : body?.code);
/** A refusal or a miss as `[status, code]`; a served document as `[status, its identity and content]`. */
const shape = (answer: Answer, pick: (served: any) => unknown): unknown[] =>
    answer.status === 200 ? [200, pick(unwrap(answer.body))] : [answer.status, codeOf(answer.body)];
const doc = (d: any) => (d == null ? d : { name: d.name, locale: d.locale, subject: d.subject, label: d.label });

async function doors(b: Booted, type: string, name: string, member?: string, pkg?: string) {
    const query: Record<string, string> = { ...(member === undefined ? {} : { member }), ...(pkg === undefined ? {} : { package: pkg }) };
    const protocol = b.kernel.getService('protocol') as any;
    let executed: unknown;
    try {
        executed = doc((await protocol.getMetaItemForExecution({
            type, name, ...(member === undefined ? {} : { member }), ...(pkg === undefined ? {} : { packageId: pkg }),
        }))?.item ?? null);
    } catch (e) {
        executed = ['threw', (e as { status?: unknown }).status, (e as { code?: unknown }).code];
    }
    const read = await get(b.kernel, `/meta/${type}/${name}`, query);
    const layers = await get(b.kernel, `/meta/${type}/${name}/layers`, query);
    return {
        read: shape(read, (u) => doc(u?.item)),
        // The whole served envelope, so "one request" is pinned on the body and not on a picked field.
        readBody: read.status === 200 ? unwrap(read.body) : undefined,
        layers: shape(layers, (u) => [doc(u?.effective), doc(u?.code), doc(u?.overlay)]),
        executed,
    };
}

describe('[#34682] naming no member and naming the canonical member are one request, and /published reads that member', () => {
    const roots: string[] = [];
    afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); });

    it('each pair answers alike on a bundled type, before and after a restart; a type with no members is the CONTROL', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-meta-member-one-request-db-'));
        roots.push(dir);
        const file = join(dir, 'meta.sqlite');

        const observe = async (b: Booted, leg: string) => {
            for (const [name, served] of [
                // No canonical member, shipped or stored: absent on every door.
                ['ship_fr_mail', undefined],
                ['row_fr_mail', undefined],
                // POSITIVE: the canonical member, shipped or stored, is served on every door.
                ['ship_both_mail', { name: 'ship_both_mail', locale: 'en-US', subject: 'ship en', label: 'ship en' }],
                ['row_both_mail', { name: 'row_both_mail', locale: 'en-US', subject: 'row en', label: 'row en' }],
            ] as const) {
                const bare = await doors(b, 'email_template', name);
                const named = await doors(b, 'email_template', name, CANONICAL);
                // Pair 2: `?member=en-US` is the read naming no member, status and body.
                expect({ leg, name, ...named }, JSON.stringify(named)).toEqual({ leg, name, ...bare });
                if (served === undefined) {
                    expect({ leg, name, read: bare.read, layers: bare.layers, executed: bare.executed }).toEqual({
                        leg, name, read: [404, 'RESOURCE_NOT_FOUND'], layers: [404, 'RESOURCE_NOT_FOUND'], executed: null,
                    });
                } else {
                    expect({ leg, name, read: bare.read, effective: (bare.layers[1] as unknown[] | undefined)?.[0], executed: bare.executed })
                        .toEqual({ leg, name, read: [200, served], effective: served, executed: served });
                }
                // …and at the shipping package's own address (`?package=`), for a shipped bundle.
                if (name.startsWith('ship_')) {
                    const atBase = await doors(b, 'email_template', name, undefined, A);
                    const atBaseNamed = await doors(b, 'email_template', name, CANONICAL, A);
                    expect({ leg, name, ...atBaseNamed }, JSON.stringify(atBaseNamed)).toEqual({ leg, name, ...atBase });
                    expect({ leg, name, read: atBase.read, executed: atBase.executed })
                        .toEqual({ leg, name, read: served === undefined ? [404, 'RESOURCE_NOT_FOUND'] : [200, served], executed: served ?? null });
                }
                // `/published` takes no member selector: it reads the canonical member alone.
                const named400 = await get(b.kernel, `/meta/email_template/${name}/published`, { member: CANONICAL });
                expect([leg, name, named400.status, codeOf(named400.body)]).toEqual([leg, name, 400, 'VALIDATION_ERROR']);
            }

            // Pair 1: `/published` answers what the plain read answers wherever
            // the canonical member is published (a stored row) or nothing is.
            for (const [name, served] of [
                ['ship_fr_mail', undefined],
                ['row_fr_mail', undefined],
                ['row_both_mail', { name: 'row_both_mail', locale: 'en-US', subject: 'row en', label: 'row en' }],
            ] as const) {
                const published = shape(await get(b.kernel, `/meta/email_template/${name}/published`), doc);
                const read = shape(await get(b.kernel, `/meta/email_template/${name}`), (u) => doc(u?.item));
                expect({ leg, name, published, read }).toEqual({
                    leg, name,
                    published: served === undefined ? [404, 'RESOURCE_NOT_FOUND'] : [200, served],
                    read: served === undefined ? [404, 'RESOURCE_NOT_FOUND'] : [200, served],
                });
            }

            // CONTROL, a type with no members: the selector is refused on the
            // plain read, `/layers` and the execution read (located 400), and a
            // stored row is served alike by the plain read and `/published`.
            const control = await doors(b, 'dashboard', 'row_dash', CANONICAL);
            expect({ leg, read: control.read, layers: control.layers, executed: control.executed }).toEqual({
                leg, read: [400, 'VALIDATION_ERROR'], layers: [400, 'VALIDATION_ERROR'], executed: ['threw', 400, 'VALIDATION_ERROR'],
            });
            const rowDash = { name: 'row_dash', locale: undefined, subject: undefined, label: 'row dash' };
            expect({
                leg,
                read: shape(await get(b.kernel, '/meta/dashboard/row_dash'), (u) => doc(u?.item)),
                published: shape(await get(b.kernel, '/meta/dashboard/row_dash/published'), doc),
            }).toEqual({ leg, read: [200, rowDash], published: [200, rowDash] });

            // Not the member selector's: an item only code ships has no published
            // document, bundled or not, so `/published` answers 404 beside the
            // plain read's 200 for the CONTROL type exactly as for a bundle.
            for (const [type, name, label] of [['dashboard', 'ship_dash', 'ship dash'], ['email_template', 'ship_both_mail', 'ship en']] as const) {
                expect({
                    leg, type,
                    read: (shape(await get(b.kernel, `/meta/${type}/${name}`), (u) => u?.item?.label)),
                    published: shape(await get(b.kernel, `/meta/${type}/${name}/published`), (d) => d?.label),
                }).toEqual({ leg, type, read: [200, label], published: [404, 'RESOURCE_NOT_FOUND'] });
            }
        };

        let booted = await boot(file);
        try {
            for (const [type, name, member, body] of ROWS) {
                await booted.engine.insert('sys_metadata', {
                    type, name, namespace: 'default', package_id: null, scope: 'platform', strategy: 'merge', state: 'active', version: 1,
                    ...(member === null ? {} : { bundle_member: member }),
                    metadata: JSON.stringify({ name, ...body }),
                }, { context: { isSystem: true } } as any);
            }
            await observe(booted, 'before a restart');
        } finally {
            await booted.kernel.shutdown();
            roots.push(booted.root);
        }
        booted = await boot(file);
        try {
            await observe(booted, 'after a restart');
        } finally {
            await booted.kernel.shutdown();
            roots.push(booted.root);
        }
    }, 120_000);
});
