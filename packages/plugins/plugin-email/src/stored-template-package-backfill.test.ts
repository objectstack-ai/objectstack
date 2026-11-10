// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 row R20; epic #31527 child S3] A legacy `sys_email_template`
 * row gains the package that holds its template, measured on a REAL `ObjectQL`
 * engine over a real SQL driver (better-sqlite3 `:memory:`) and a REAL
 * `SchemaRegistry` asked through the one D3 rule (`resolvePackageScopedName`,
 * no caller).
 *
 * A name only this service's built-in templates hold resolves to them as the
 * overridable baseline (D3 (b)), so the row binds to
 * `com.objectstack.service.email` (seat ruling Q6).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ObjectQL, SchemaRegistry } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysEmailTemplate } from '@objectstack/platform-objects';
import { backfillTemplatePackages, logTemplatePackageBackfill } from './stored-template-package-backfill.js';
import { BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID } from './template-loader.js';

const ORG = 'org_a';
const SYS_ORG = { isSystem: true, tenantId: ORG } as const;
const SYSTEM_CTX = { isSystem: true } as const;

const EMAIL = BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID;
const A = 'com.acme.alpha';
const B = 'com.acme.beta';

const manifest = (id: string) => ({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()! }) as never;

let registry: SchemaRegistry;

beforeEach(() => {
    registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    for (const id of [EMAIL, A, B]) registry.installPackage(manifest(id), 'code');
    const template = (name: string, locale = 'en-US') => ({ name, label: name, subject: name, body: name, locale });
    const ship = (packageId: string, name: string) =>
        registry.registerItem('email_template', { ...template(name), _packageId: packageId }, 'name' as never, packageId);
    ship(EMAIL, 'auth_password_reset'); // the baseline alone
    ship(EMAIL, 'auth_verify_email');
    ship(A, 'auth_verify_email'); // an app's override of a baseline: the app is the primary holder
    ship(A, 'invoice_sent');
    ship(A, 'shared_notice');
    ship(B, 'shared_notice');
    registry.registerItem('email_template', { ...template('my_notice'), _provenance: 'org' }, 'name' as never);
});

const engines: ObjectQL[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    while (engines.length) {
        try { await engines.pop()?.destroy(); } catch { /* noop */ }
    }
});

async function boot(): Promise<ObjectQL> {
    const engine = new ObjectQL();
    engine.registerDriver(
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
        true,
    );
    await engine.init();
    engine.registerApp({
        id: 'com.objectstack.qa.email-template-package',
        name: 'Email template package column',
        version: '1.0.0',
        type: 'plugin',
        scope: 'system',
        objects: [SysEmailTemplate],
    } as any);
    await engine.syncSchemas();
    engines.push(engine);
    return engine;
}

const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id, name, label: name, subject: name, body_html: `<p>${name}</p>`, locale: 'en-US', category: 'custom', active: true,
    organization_id: ORG, ...extra,
});

async function seed(engine: ObjectQL): Promise<void> {
    for (const r of [
        row('t1', 'auth_password_reset'),
        row('t2', 'auth_verify_email'),
        row('t3', 'invoice_sent'),
        row('t4', 'shared_notice'),
        row('t5', 'my_notice'),
        row('t6', 'retired_notice'),
        // Already names a package: never a candidate, never moved.
        row('t7', 'invoice_sent', { locale: 'zh-CN', package_id: 'com.acme.elsewhere' }),
    ]) {
        await engine.insert('sys_email_template', r, { context: SYS_ORG });
    }
}

async function packages(engine: ObjectQL): Promise<Record<string, unknown>> {
    const rows = (await engine.find('sys_email_template', { where: {}, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
    return Object.fromEntries(rows.map((r) => [String(r.id), r.package_id ?? null]));
}

describe('R20 — a legacy email template row gains the package that holds its template', () => {
    it('a baseline-only name binds to the email service; a primary holder wins over the baseline; refusals stay null', async () => {
        const engine = await boot();
        await seed(engine);

        const report = await backfillTemplatePackages(engine, registry);

        expect(await packages(engine)).toEqual({
            t1: EMAIL,
            t2: A,
            t3: A,
            t4: null, t5: null, t6: null,
            t7: 'com.acme.elsewhere',
        });
        expect(report.bound).toEqual([
            { name: 'auth_password_reset', rows: 1, packageId: EMAIL },
            { name: 'auth_verify_email', rows: 1, packageId: A },
            { name: 'invoice_sent', rows: 1, packageId: A },
        ]);
        expect(report.ambiguous).toEqual([
            { name: 'shared_notice', rows: 1, candidates: [`package "${A}"`, `package "${B}"`] },
        ]);
        expect(report.unpackaged).toEqual([{ name: 'my_notice', rows: 1, holder: 'environment' }]);
        expect(report.unheld).toEqual([{ name: 'retired_notice', rows: 1 }]);

        const logger = { info: vi.fn(), warn: vi.fn() };
        logTemplatePackageBackfill(report, logger);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`'shared_notice' (1 row; held by package "${A}"; package "${B}")`), expect.anything());
    });

    it('a second run writes 0 rows and reports the same refusals', async () => {
        const engine = await boot();
        await seed(engine);
        await backfillTemplatePackages(engine, registry);
        const update = vi.spyOn(engine, 'update');

        const again = await backfillTemplatePackages(engine, registry);

        expect(update).not.toHaveBeenCalled();
        expect(again.bound).toEqual([]);
        expect(again.ambiguous.map((a) => a.name)).toEqual(['shared_notice']);
    });

    it('no key moves: the template indexes stay byte for byte, and the column is nullable and read-only', () => {
        expect(JSON.stringify(SysEmailTemplate.indexes)).toBe(JSON.stringify([
            { fields: ['name', 'locale'], unique: 'organization' },
            { fields: ['category'], unique: false },
            { fields: ['active'], unique: false },
        ]));
        expect((SysEmailTemplate.fields as Record<string, any>).package_id).toMatchObject({
            type: 'text', required: false, readonly: true,
        });
    });
});

describe('#32183 — a binding never moves with a reversible disable: the backfill judges every holder', () => {
    it('a name two packages hold stays refused while one of them is disabled, and a disabled sole holder still binds', async () => {
        registry.disablePackage(B);
        registry.registerItem('email_template', { name: 'beta_only', label: 'b', subject: 'b', body: 'b', locale: 'en-US', _packageId: B }, 'name' as never, B);
        const engine = await boot();
        await seed(engine);
        await engine.insert('sys_email_template', row('t8', 'beta_only'), { context: SYS_ORG });

        const report = await backfillTemplatePackages(engine, registry);

        expect(report.ambiguous).toEqual([
            { name: 'shared_notice', rows: 1, candidates: [`package "${A}"`, `package "${B}"`] },
        ]);
        expect(report.bound).toContainEqual({ name: 'beta_only', rows: 1, packageId: B });
        expect((await packages(engine)).t4).toBeNull();
    });
});
