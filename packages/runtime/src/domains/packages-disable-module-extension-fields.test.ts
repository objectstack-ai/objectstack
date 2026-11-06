// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A disabled package's `objectExtensions` fields are withheld the way its
 * objects are: hidden from the served object, refused on the data plane, data
 * kept.
 *
 * ## The shape (HotCRM's suite)
 *
 * An app package owns `qs_account`. A `type: 'module'` package of that app
 * ships its own object (`qs_order`, with a lookup to the account) and extends
 * the app's object with two fields through `objectExtensions`: a stored number
 * (`qs_credit`) and a roll-up summary of its orders (`qs_order_total`). The
 * customer's admin switches the module off through
 * `PATCH /packages/:id/disable`.
 *
 * ## What "withheld" means here, pinned through the real routes
 *
 *  - `GET /meta/object/qs_account` serves the object without the module's
 *    fields, and `GET /data/qs_account[/:id]` returns rows without them;
 *  - a write that names one is answered exactly as a write naming a field the
 *    object does not have (`400 INVALID_FIELD`, `Unknown field '…'`);
 *  - a write through the object's other fields still lands, and leaves the
 *    withheld value alone;
 *  - `GET /packages/:app/customizations` no longer lists the module's fields
 *    among the app's `contributions`, as it already leaves out the module's
 *    flows and navigation items;
 *  - re-enabling brings the fields back with the stored values intact.
 *
 * ## The physical schema follows the full contribution
 *
 * Schema sync reads the object WITH every extension, enabled or not, so a
 * disable never makes the storage layer lose a column. Pinned on a boot that
 * starts with the module already disabled (the environment's state file): the
 * column is created anyway, so an enable needs no re-sync before a write.
 *
 * ## An enabled dependent rule refuses the disable (#30379 ruling A)
 *
 * While a validation rule of any other ENABLED package (declared dependent or
 * not; any severity; an app's `<base>.custom` pair included) reads one of the
 * module's extension fields, the disable door answers `409`
 * `PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE`, its message naming every
 * such rule as package · object · rule, and nothing changes: once withheld,
 * the field could not be read and every write to the object would be refused.
 * A formula over the field does not refuse the disable: it answers `null`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin, SchemaRegistry } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { composeStacks, defineStack } from '@objectstack/spec';
import { resolveThrownHttpError } from '@objectstack/types';
import { AppPlugin } from '../app-plugin.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import { loadDisabledPackageIds, setPackageDisabled } from '../package-state-store.js';

const ENVIRONMENT_ID = 'env_suite_extension_fields';
const ADMIN = {
    userId: 'u_admin', tenantId: 'org_qa', isSystem: false,
    positions: [], permissions: [], systemPermissions: ['manage_metadata', 'studio.access'],
};

const APP = 'com.qa.extsuite';
const MODULE = 'com.qa.extsuite.orders';

const ACCOUNT = 'qx_account';
const ORDER = 'qx_order';
/** The module's stored extension field on the app's object. */
const CREDIT = 'qx_credit';
/** The module's roll-up summary of its own orders, on the app's object. */
const ORDER_TOTAL = 'qx_order_total';
const MODULE_FIELDS = [CREDIT, ORDER_TOTAL] as const;
/** A second, ENABLED module whose formula reads the first module's field. */
const SCORING = 'com.qa.extsuite.scoring';
const CREDIT_BAND = 'qx_credit_band';
/** [#30377] A third module whose roll-up, added to the app's object by extension, sums a child the APP owns. */
const ROLLUP = 'com.qa.extsuite.visits';
const VISIT = 'qx_visit';
const VISIT_TOTAL = 'qx_visit_total';
/**
 * [#30379] A fourth, ENABLED module whose validation rules read the first
 * module's field: on the app's object, at error and warning severity (the
 * warning a `conditional` whose `when` reads it), one switched off, and one
 * on the app's visit reading it one hop through the visit's account lookup.
 */
const RULES = 'com.qa.extsuite.rules';
const RULE_NOT_NEGATIVE = 'qx_credit_not_negative';
const RULE_REVIEW = 'qx_credit_review';
const RULE_SWITCHED_OFF = 'qx_credit_switched_off';
const RULE_VISIT_HOP = 'qx_visit_account_credit';
/** The app's paired customization package, where a tenant-written rule lives. */
const PAIR = `${APP}.custom`;
const RULE_TENANT = 'qx_credit_tenant_cap';
/**
 * [#30379 contract review] A fifth, ENABLED module folded AFTER {@link RULES}
 * (priority 300) that redeclares two of its rules by name: one copy that no
 * longer reads the field, one that still does.
 */
const OVERRIDE = 'com.qa.extsuite.rules-override';
/** A rule a tenant overlay declares itself, reading the module's field. */
const RULE_OVERLAY_OWN = 'qx_credit_overlay_cap';

interface SuiteOptions {
    /** {@link SCORING}: a formula over the module's field. */
    scoring?: boolean;
    /** {@link ROLLUP}: a roll-up over the app's visits. */
    rollup?: boolean;
    /** {@link RULES}: validation rules over the module's field. */
    rules?: boolean;
    /** {@link OVERRIDE}: two of {@link RULES}' rules redeclared by name, folded later. */
    override?: boolean;
}

function suiteArtifact({ scoring = false, rollup = false, rules = false, override = false }: SuiteOptions = {}) {
    const app = defineStack({
        manifest: { id: APP, name: 'QA Ext Suite', namespace: 'qx', version: '1.0.0', type: 'app' },
        objects: [{
            name: ACCOUNT,
            label: 'Account',
            fields: { name: { name: 'name', type: 'text', label: 'Name' } },
        }, ...(rollup || rules ? [{
            name: VISIT,
            label: 'Visit',
            fields: {
                name: { name: 'name', type: 'text', label: 'Name' },
                amount: { name: 'amount', type: 'number', label: 'Amount' },
                account: { name: 'account', type: 'lookup', label: 'Account', reference: ACCOUNT },
            },
        }] : [])],
    } as any);
    const orders = defineStack({
        manifest: {
            id: MODULE, name: 'QA Ext Suite Orders', namespace: 'qx', version: '1.0.0', type: 'module',
            dependencies: { [APP]: '^1.0.0' },
        },
        objects: [{
            name: ORDER,
            label: 'Order',
            fields: {
                name: { name: 'name', type: 'text', label: 'Name' },
                amount: { name: 'amount', type: 'number', label: 'Amount' },
                account: { name: 'account', type: 'lookup', label: 'Account', reference: ACCOUNT },
            },
        }],
        objectExtensions: [{
            extend: ACCOUNT,
            fields: {
                [CREDIT]: { name: CREDIT, type: 'number', label: 'Credit' },
                [ORDER_TOTAL]: {
                    name: ORDER_TOTAL, type: 'summary', label: 'Order total',
                    summaryOperations: { object: ORDER, field: 'amount', function: 'sum' },
                },
            },
        }],
    } as any);
    const scoringModule = defineStack({
        manifest: {
            id: SCORING, name: 'QA Ext Suite Scoring', namespace: 'qx', version: '1.0.0', type: 'module',
            dependencies: { [APP]: '^1.0.0' },
        },
        objectExtensions: [{
            extend: ACCOUNT,
            fields: {
                [CREDIT_BAND]: {
                    name: CREDIT_BAND, type: 'formula', label: 'Credit band', returnType: 'text',
                    expression: `record.${CREDIT} > 100 ? "high" : "low"`,
                },
            },
        }],
    } as any);
    const ruleModule = defineStack({
        manifest: {
            id: RULES, name: 'QA Ext Suite Rules', namespace: 'qx', version: '1.0.0', type: 'module',
            dependencies: { [APP]: '^1.0.0' },
        },
        objectExtensions: [{
            extend: ACCOUNT,
            validations: [{
                name: RULE_NOT_NEGATIVE, type: 'script', severity: 'error', message: 'Credit cannot be negative',
                condition: `record.${CREDIT} < 0`,
            }, {
                name: RULE_REVIEW, type: 'conditional', severity: 'warning', message: 'A large credit needs a capitalised name',
                when: `record.${CREDIT} > 1000`,
                then: { name: 'qx_credit_review_name', type: 'format', field: 'name', regex: '^[A-Z]', message: 'Capitalise the name' },
            }, {
                name: RULE_SWITCHED_OFF, type: 'script', active: false, message: 'Switched off',
                condition: `record.${CREDIT} > 99999999`,
            }],
        }, {
            extend: VISIT,
            validations: [{
                name: RULE_VISIT_HOP, type: 'script', severity: 'info', message: 'The account carries no credit',
                condition: `record.account.${CREDIT} < 0`,
            }],
        }],
    } as any);
    const overrideModule = defineStack({
        manifest: {
            id: OVERRIDE, name: 'QA Ext Suite Rules Override', namespace: 'qx', version: '1.0.0', type: 'module',
            dependencies: { [APP]: '^1.0.0' },
        },
        objectExtensions: [{
            extend: ACCOUNT,
            priority: 300,
            validations: [{
                // Replaces RULES' copy, which reads the field, with one that does not.
                name: RULE_NOT_NEGATIVE, type: 'script', severity: 'error', message: 'The name is blocked',
                condition: "record.name == 'blocked'",
            }, {
                // Replaces RULES' conditional with a script that still reads it.
                name: RULE_REVIEW, type: 'script', severity: 'warning', message: 'A very large credit needs review',
                condition: `record.${CREDIT} > 5000`,
            }],
        }],
    } as any);
    const rollupModule = defineStack({
        manifest: {
            id: ROLLUP, name: 'QA Ext Suite Visits', namespace: 'qx', version: '1.0.0', type: 'module',
            dependencies: { [APP]: '^1.0.0' },
        },
        objectExtensions: [{
            extend: ACCOUNT,
            fields: {
                [VISIT_TOTAL]: {
                    name: VISIT_TOTAL, type: 'summary', label: 'Visit total',
                    summaryOperations: { object: VISIT, field: 'amount', function: 'sum' },
                },
            },
        }],
    } as any);
    return composeStacks([
        orders,
        ...(scoring ? [scoringModule] : []),
        ...(rollup ? [rollupModule] : []),
        ...(rules ? [ruleModule] : []),
        ...(override ? [overrideModule] : []),
        app,
    ], { manifest: 'preserve' });
}

interface Booted {
    kernel: ObjectKernel;
    engine: ObjectQL;
}

async function bootKernel(root: string, options: SuiteOptions = {}, beforeBootstrap?: (kernel: ObjectKernel) => void): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    beforeBootstrap?.(kernel);
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: join(root, 'data.sqlite') },
        useNullAsDefault: true,
    }) as any, true);
    await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    await kernel.use(new AppPlugin(suiteArtifact(options), { environmentId: ENVIRONMENT_ID, organizationId: 'org_qa' }));
    const host: Plugin = {
        name: 'qa.extsuite-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (_ctx: PluginContext) => {},
    };
    await kernel.use(host);
    await kernel.bootstrap();
    await engine.syncSchemas();
    return { kernel, engine };
}

async function shutdown(booted: Booted | undefined): Promise<void> {
    if (booted && booted.kernel.getState() === 'running') await booted.kernel.shutdown();
}

const codeOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.code : body?.code);
const messageOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.message : body?.message ?? body?.error);

async function dispatchAs(kernel: ObjectKernel, method: string, path: string, body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...ADMIN });
    const raw = new Request(`http://localhost/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    try {
        const out: any = await dispatcher.dispatch(method, path, body, query, { request: raw, environmentId: ENVIRONMENT_ID } as any, '/api/v1');
        const answer = out.response?.body;
        return { status: out.response?.status as number | undefined, code: codeOf(answer), message: messageOf(answer), data: answer?.data, details: answer?.error?.details };
    } catch (e) {
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status as number | undefined, code: thrown.code as unknown, message: (e as Error)?.message, data: undefined, details: undefined };
    }
}

/** The field names `GET /meta/object/qx_account` serves. */
async function servedFieldNames(kernel: ObjectKernel): Promise<string[]> {
    const read = await dispatchAs(kernel, 'GET', `/meta/object/${ACCOUNT}`);
    expect(read.status, 'precondition: the object reads').toBe(200);
    const object = read.data?.item ?? read.data;
    return Object.keys(object?.fields ?? {});
}

/** One account row, as `GET /data/qx_account/:id` serves it. */
async function readAccount(kernel: ObjectKernel, id: string): Promise<Record<string, unknown>> {
    const read = await dispatchAs(kernel, 'GET', `/data/${ACCOUNT}/${id}`);
    expect(read.status, 'precondition: the account reads').toBe(200);
    return (read.data?.record ?? read.data) as Record<string, unknown>;
}

/** Every account row, as `GET /data/qx_account` serves the list. */
async function listAccounts(kernel: ObjectKernel): Promise<Array<Record<string, unknown>>> {
    const read = await dispatchAs(kernel, 'GET', `/data/${ACCOUNT}`);
    expect(read.status, 'precondition: the accounts list').toBe(200);
    return (read.data?.records ?? read.data?.data ?? read.data) as Array<Record<string, unknown>>;
}

/** The app's `contributions` of kind `field`, as `GET /packages/:app/customizations` lists them. */
async function contributedFields(kernel: ObjectKernel): Promise<string[]> {
    const read = await dispatchAs(kernel, 'GET', `/packages/${APP}/customizations`);
    expect(read.status, 'precondition: the customizations read answers').toBe(200);
    return ((read.data?.contributions ?? []) as Array<{ kind: string; name: string; packageId: string }>)
        .filter((c) => c.kind === 'field')
        .map((c) => `${c.packageId}:${c.name}`)
        .sort();
}

const idOf = (created: { data?: any }): string => String(created.data?.id ?? created.data?.record?.id ?? created.data?._id);

let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-suite-ext-fields-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

describe('a disabled module\'s objectExtensions fields are withheld from the app\'s object, and kept', () => {
    let root: string;
    let booted: Booted | undefined;
    let accountId: string;

    beforeAll(async () => {
        root = mkdtempSync(join(tmpdir(), 'os-suite-ext-'));
        writeFileSync(join(root, '.keep'), '');
        process.env.OS_HOME = mkdtempSync(join(home, 'live-'));
        booted = await bootKernel(root);
    }, 60_000);
    afterAll(async () => {
        await shutdown(booted);
        rmSync(root, { recursive: true, force: true });
    }, 60_000);

    it('serves the module\'s fields while it is enabled (the control)', async () => {
        const { kernel } = booted!;
        expect(await servedFieldNames(kernel)).toEqual(expect.arrayContaining([...MODULE_FIELDS]));
        const created = await dispatchAs(kernel, 'POST', `/data/${ACCOUNT}`, { name: 'acme', [CREDIT]: 500 });
        expect(created.status, 'precondition: the account is written with the module field').toBe(201);
        accountId = idOf(created);
        const order = await dispatchAs(kernel, 'POST', `/data/${ORDER}`, { name: 'o1', amount: 2000, account: accountId });
        expect(order.status, 'precondition: an order of the module is written').toBe(201);
        expect(await readAccount(kernel, accountId)).toMatchObject({ name: 'acme', [CREDIT]: 500, [ORDER_TOTAL]: 2000 });
        expect(await contributedFields(kernel)).toEqual(MODULE_FIELDS.map((f) => `${MODULE}:${f}`).sort());
    });

    it('withholds them from /meta/object and from /data reads once the module is disabled', async () => {
        const { kernel } = booted!;
        const disabled = await dispatchAs(kernel, 'PATCH', `/packages/${MODULE}/disable`);
        expect(disabled.status).toBe(200);

        const served = await servedFieldNames(kernel);
        expect(served).toContain('name');
        for (const field of MODULE_FIELDS) expect(served).not.toContain(field);

        const row = await readAccount(kernel, accountId);
        expect(row.name).toBe('acme');
        for (const field of MODULE_FIELDS) expect(Object.keys(row)).not.toContain(field);
        for (const listed of await listAccounts(kernel)) {
            for (const field of MODULE_FIELDS) expect(Object.keys(listed)).not.toContain(field);
        }
        // The module's own object is refused, as before.
        const orders = await dispatchAs(kernel, 'GET', `/data/${ORDER}`);
        expect({ status: orders.status, code: orders.code }).toEqual({ status: 404, code: 'OBJECT_PACKAGE_DISABLED' });
    });

    it('answers a write naming a withheld field exactly as a write naming a field the object does not have', async () => {
        const { kernel } = booted!;
        const strip = (a: { status?: number; code?: unknown; message?: unknown }, field: string) =>
            ({ status: a.status, code: a.code, message: String(a.message).split(field).join('<field>') });

        const unknownCreate = await dispatchAs(kernel, 'POST', `/data/${ACCOUNT}`, { name: 'x', qx_no_such_field: 1 });
        const withheldCreate = await dispatchAs(kernel, 'POST', `/data/${ACCOUNT}`, { name: 'x', [CREDIT]: 1 });
        expect(unknownCreate.status).toBe(400);
        expect(strip(withheldCreate, CREDIT)).toEqual(strip(unknownCreate, 'qx_no_such_field'));

        const unknownUpdate = await dispatchAs(kernel, 'PATCH', `/data/${ACCOUNT}/${accountId}`, { qx_no_such_field: 1 });
        const withheldUpdate = await dispatchAs(kernel, 'PATCH', `/data/${ACCOUNT}/${accountId}`, { [CREDIT]: 1 });
        expect(unknownUpdate.status).toBe(400);
        expect(strip(withheldUpdate, CREDIT)).toEqual(strip(unknownUpdate, 'qx_no_such_field'));
    });

    it('lets a write through the object\'s other fields land while the module is disabled', async () => {
        const { kernel } = booted!;
        const updated = await dispatchAs(kernel, 'PATCH', `/data/${ACCOUNT}/${accountId}`, { name: 'acme renamed' });
        expect(updated.status).toBe(200);
        const created = await dispatchAs(kernel, 'POST', `/data/${ACCOUNT}`, { name: 'beta' });
        expect(created.status).toBe(201);
    });

    it('no longer lists the module\'s fields among the app\'s contributions', async () => {
        expect(await contributedFields(booted!.kernel)).toEqual([]);
    });

    it('brings the fields back on enable, with the stored values intact', async () => {
        const { kernel } = booted!;
        const enabled = await dispatchAs(kernel, 'PATCH', `/packages/${MODULE}/enable`);
        expect(enabled.status).toBe(200);
        expect(await servedFieldNames(kernel)).toEqual(expect.arrayContaining([...MODULE_FIELDS]));
        expect(await readAccount(kernel, accountId)).toMatchObject({ name: 'acme renamed', [CREDIT]: 500, [ORDER_TOTAL]: 2000 });
        expect(await contributedFields(kernel)).toEqual(MODULE_FIELDS.map((f) => `${MODULE}:${f}`).sort());
    });
});

describe('a boot that starts with the module disabled still creates the module\'s columns', () => {
    let root: string;

    beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'os-suite-ext-boot-'));
        writeFileSync(join(root, '.keep'), '');
        process.env.OS_HOME = mkdtempSync(join(home, 'boot-'));
        // The environment's state file says "disabled" before the first boot.
        setPackageDisabled(ENVIRONMENT_ID, MODULE, true);
    });
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it('withholds the fields at boot, and an enable with no restart writes and reads them', async () => {
        const booted = await bootKernel(root);
        try {
            const { kernel, engine } = booted;
            expect((engine as any).registry.getPackage(MODULE)?.enabled).toBe(false);
            const served = await servedFieldNames(kernel);
            for (const field of MODULE_FIELDS) expect(served).not.toContain(field);
            const created = await dispatchAs(kernel, 'POST', `/data/${ACCOUNT}`, { name: 'gamma' });
            expect(created.status).toBe(201);
            const id = idOf(created);

            expect((await dispatchAs(kernel, 'PATCH', `/packages/${MODULE}/enable`)).status).toBe(200);
            const written = await dispatchAs(kernel, 'PATCH', `/data/${ACCOUNT}/${id}`, { [CREDIT]: 42 });
            expect(written.status, 'the column exists although the boot synced with the module disabled').toBe(200);
            expect(await readAccount(kernel, id)).toMatchObject({ name: 'gamma', [CREDIT]: 42 });
        } finally {
            await shutdown(booted);
        }
    }, 120_000);
});

describe('an enabled module whose formula reads a field a disabled module contributes (the disable proceeds)', () => {
    let root: string;
    let booted: Booted | undefined;
    let accountId: string;
    const strip = (a: { status?: number; code?: unknown; message?: unknown }, field: string) =>
        ({ status: a.status, code: a.code, message: String(a.message).split(field).join('<field>') });

    beforeAll(async () => {
        root = mkdtempSync(join(tmpdir(), 'os-suite-ext-ref-'));
        writeFileSync(join(root, '.keep'), '');
        process.env.OS_HOME = mkdtempSync(join(home, 'ref-'));
        booted = await bootKernel(root, { scoring: true });
        const created = await dispatchAs(booted.kernel, 'POST', `/data/${ACCOUNT}`, { name: 'acme', [CREDIT]: 500 });
        expect(created.status, 'precondition: the account is written').toBe(201);
        accountId = idOf(created);
        expect(await readAccount(booted.kernel, accountId)).toMatchObject({ [CREDIT]: 500, [CREDIT_BAND]: 'high' });
        // [#30379 ruling A] The CONTROL of the dependent-rule refusal: a formula
        // over the field is not a dependent, so the disable proceeds.
        expect((await dispatchAs(booted.kernel, 'PATCH', `/packages/${MODULE}/disable`)).status).toBe(200);
    }, 60_000);
    afterAll(async () => {
        await shutdown(booted);
        rmSync(root, { recursive: true, force: true });
    }, 60_000);

    it('reads the object (200): the formula over the withheld field answers null, never a 5xx', async () => {
        const row = await readAccount(booted!.kernel, accountId);
        expect(row).toMatchObject({ name: 'acme', [CREDIT_BAND]: null });
        expect(Object.keys(row)).not.toContain(CREDIT);
        expect(await servedFieldNames(booted!.kernel)).toContain(CREDIT_BAND);
    });

    it('answers filter, sort and fields naming the withheld field as it answers a field the object does not have', async () => {
        for (const [key, named, unknown] of [
            ['filter', JSON.stringify({ [CREDIT]: 500 }), JSON.stringify({ qx_no_such_field: 500 })],
            ['sort', CREDIT, 'qx_no_such_field'],
            ['fields', CREDIT, 'qx_no_such_field'],
        ] as const) {
            const withheld = await dispatchAs(booted!.kernel, 'GET', `/data/${ACCOUNT}`, {}, { [key]: named });
            const absent = await dispatchAs(booted!.kernel, 'GET', `/data/${ACCOUNT}`, {}, { [key]: unknown });
            expect(absent.status, `precondition: ${key} on an unknown field is refused`).toBe(400);
            expect(strip(withheld, CREDIT), key).toEqual(strip(absent, 'qx_no_such_field'));
        }
    });

    it('lets a write to the object land while the module is disabled: no rule reads the withheld field', async () => {
        const updated = await dispatchAs(booted!.kernel, 'PATCH', `/data/${ACCOUNT}/${accountId}`, { name: 'acme' });
        expect(updated.status).toBe(200);
    });

    it('serves the formula over the stored value again once the module is re-enabled', async () => {
        expect((await dispatchAs(booted!.kernel, 'PATCH', `/packages/${MODULE}/enable`)).status).toBe(200);
        expect(await readAccount(booted!.kernel, accountId)).toMatchObject({ name: 'acme', [CREDIT]: 500, [CREDIT_BAND]: 'high' });
    });
});

describe('[#30377] a disabled module\'s roll-up over a child the enabled app owns is current again on enable', () => {
    let root: string;
    let booted: Booted | undefined;

    beforeAll(async () => {
        root = mkdtempSync(join(tmpdir(), 'os-suite-ext-rollup-'));
        writeFileSync(join(root, '.keep'), '');
        process.env.OS_HOME = mkdtempSync(join(home, 'rollup-'));
        booted = await bootKernel(root, { rollup: true });
    }, 60_000);
    afterAll(async () => {
        await shutdown(booted);
        rmSync(root, { recursive: true, force: true });
    }, 60_000);

    it('recomputes the summary on enable from the child writes made while it was disabled, with no further child write', async () => {
        const { kernel } = booted!;
        const acme = idOf(await dispatchAs(kernel, 'POST', `/data/${ACCOUNT}`, { name: 'acme' }));
        const first = await dispatchAs(kernel, 'POST', `/data/${VISIT}`, { name: 'v1', amount: 10, account: acme });
        expect(first.status, 'precondition: a visit of the app is written').toBe(201);
        expect(await readAccount(kernel, acme), 'precondition: the roll-up tracks while the module is enabled').toMatchObject({ [VISIT_TOTAL]: 10 });

        expect((await dispatchAs(kernel, 'PATCH', `/packages/${ROLLUP}/disable`)).status).toBe(200);
        expect(Object.keys(await readAccount(kernel, acme))).not.toContain(VISIT_TOTAL);
        // The child belongs to the enabled app: every one of these lands.
        expect((await dispatchAs(kernel, 'POST', `/data/${VISIT}`, { name: 'v2', amount: 5, account: acme })).status).toBe(201);
        expect((await dispatchAs(kernel, 'PATCH', `/data/${VISIT}/${idOf(first)}`, { amount: 20 })).status).toBe(200);
        const beta = idOf(await dispatchAs(kernel, 'POST', `/data/${ACCOUNT}`, { name: 'beta' }));
        expect((await dispatchAs(kernel, 'POST', `/data/${VISIT}`, { name: 'v3', amount: 7, account: beta })).status).toBe(201);

        expect((await dispatchAs(kernel, 'PATCH', `/packages/${ROLLUP}/enable`)).status).toBe(200);
        expect(await readAccount(kernel, acme)).toMatchObject({ name: 'acme', [VISIT_TOTAL]: 25 });
        expect(await readAccount(kernel, beta)).toMatchObject({ name: 'beta', [VISIT_TOTAL]: 7 });
    });
});

describe('[#30379] the disable door refuses while an enabled package\'s validation rule reads a field the package adds', () => {
    let root: string;
    let booted: Booted | undefined;
    let accountId: string;
    // Ledgered under `@objectstack/runtime` by #30724; asserted by value.
    const CODE = 'PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE';
    /** The listing the refusal's message carries, in its order (package, object, rule). */
    const listingOf = (rules: ReadonlyArray<{ packageId: string; object: string; rule: string; fields: string[] }>) =>
        rules.map((d) => `${d.packageId} · ${d.object} · ${d.rule} (reads ${d.fields.join(', ')})`).join('; ');

    beforeAll(async () => {
        root = mkdtempSync(join(tmpdir(), 'os-suite-ext-dep-'));
        writeFileSync(join(root, '.keep'), '');
        process.env.OS_HOME = mkdtempSync(join(home, 'dep-'));
        booted = await bootKernel(root, { scoring: true, rules: true });
        const { kernel } = booted;
        // The app's `.custom` pair, through its one creation door, and a tenant
        // rule saved and published into it as an extension of the app's object.
        const pair = await dispatchAs(kernel, 'POST', `/packages/${APP}/ensure-customization`);
        expect(pair.status, `precondition: the pair is created (${String(pair.message)})`).toBe(201);
        const protocol = kernel.getService<any>('protocol');
        await protocol.saveMetaItem({
            type: 'object_extension', name: ACCOUNT, mode: 'draft', packageId: PAIR,
            item: {
                extend: ACCOUNT,
                validations: [{
                    name: RULE_TENANT, type: 'script', severity: 'error', message: 'Credit is capped',
                    condition: `record.${CREDIT} > 5000000`,
                }],
            },
        });
        await protocol.publishMetaItem({ type: 'object_extension', name: ACCOUNT, packageId: PAIR });
        const rules = ((booted.engine as any).registry.getObject(ACCOUNT)?.validations ?? []).map((v: any) => v?.name);
        expect(rules, 'precondition: the tenant rule is served').toContain(RULE_TENANT);

        const created = await dispatchAs(kernel, 'POST', `/data/${ACCOUNT}`, { name: 'Acme', [CREDIT]: 500 });
        expect(created.status, 'precondition: the account is written').toBe(201);
        accountId = idOf(created);
    }, 120_000);
    afterAll(async () => {
        await shutdown(booted);
        rmSync(root, { recursive: true, force: true });
    }, 60_000);

    it('answers 409 with the code, naming every reading rule as package · object · rule, and changes nothing', async () => {
        const { kernel, engine } = booted!;
        const refused = await dispatchAs(kernel, 'PATCH', `/packages/${MODULE}/disable`);
        expect({ status: refused.status, code: refused.code }).toEqual({ status: 409, code: CODE });
        const dependents = [
            { packageId: PAIR, object: ACCOUNT, rule: RULE_TENANT, fields: [CREDIT] },
            { packageId: RULES, object: ACCOUNT, rule: RULE_NOT_NEGATIVE, fields: [CREDIT] },
            { packageId: RULES, object: ACCOUNT, rule: RULE_REVIEW, fields: [CREDIT] },
            { packageId: RULES, object: VISIT, rule: RULE_VISIT_HOP, fields: [`account.${CREDIT}`] },
        ];
        // The message lists exactly these four, in order; the refusal fixes no
        // `error.details` shape (a machine-readable one is a spec contract first).
        expect(String(refused.message)).toContain(`Package '${MODULE}' cannot be disabled: 4 active validation rules read fields`);
        expect(String(refused.message)).toContain(`— ${listingOf(dependents)}. Switch off or change those rules first`);
        expect(refused.details).toBeUndefined();
        // A rule switched off reads nothing, and a formula is no dependent.
        expect(String(refused.message)).not.toContain(RULE_SWITCHED_OFF);
        expect(String(refused.message)).not.toContain(SCORING);

        // Nothing changed: the row, the served object, the data plane and the state file.
        expect(engine.registry.getPackage(MODULE)?.enabled).not.toBe(false);
        expect(await servedFieldNames(kernel)).toEqual(expect.arrayContaining([...MODULE_FIELDS]));
        const written = await dispatchAs(kernel, 'PATCH', `/data/${ACCOUNT}/${accountId}`, { [CREDIT]: 700 });
        expect(written.status).toBe(200);
        expect(await readAccount(kernel, accountId)).toMatchObject({ [CREDIT]: 700 });
        expect(loadDisabledPackageIds(ENVIRONMENT_ID).has(MODULE)).toBe(false);
    });

    it('names only the rules of packages still enabled, and proceeds once none reads the field', async () => {
        const { kernel } = booted!;
        expect((await dispatchAs(kernel, 'PATCH', `/packages/${RULES}/disable`)).status).toBe(200);
        const narrowed = await dispatchAs(kernel, 'PATCH', `/packages/${MODULE}/disable`);
        expect({ status: narrowed.status, code: narrowed.code }).toEqual({ status: 409, code: CODE });
        expect(String(narrowed.message)).toContain(
            `an active validation rule reads a field it adds through objectExtensions, which the disable would withhold — ${listingOf([{ packageId: PAIR, object: ACCOUNT, rule: RULE_TENANT, fields: [CREDIT] }])}. Switch off or change that rule first`,
        );
        expect(String(narrowed.message)).not.toContain(RULES);

        expect((await dispatchAs(kernel, 'PATCH', `/packages/${PAIR}/disable`)).status).toBe(200);
        const disabled = await dispatchAs(kernel, 'PATCH', `/packages/${MODULE}/disable`);
        expect(disabled.status).toBe(200);
        const served = await servedFieldNames(kernel);
        for (const field of MODULE_FIELDS) expect(served).not.toContain(field);
        // The formula module stays enabled throughout: its formula answers null.
        expect(await readAccount(kernel, accountId)).toMatchObject({ name: 'Acme', [CREDIT_BAND]: null });
        expect((await dispatchAs(kernel, 'PATCH', `/data/${ACCOUNT}/${accountId}`, { name: 'Acme Ltd' })).status).toBe(200);
    });

    it('[#30756] the mirror enable is refused the same way: the reading package stays disabled while the field stays withheld, and writes still land', async () => {
        // Before #30756 this enable answered 200 and every write to the
        // account then answered 400 VALIDATION_FAILED, the rule failing closed
        // on the withheld field. The full enable-door battery is the
        // `[#30756]` describe below.
        const { kernel, engine } = booted!;
        const refused = await dispatchAs(kernel, 'PATCH', `/packages/${RULES}/enable`);
        expect({ status: refused.status, code: refused.code }).toEqual({ status: 409, code: CODE });
        expect(String(refused.message)).toContain(`Package '${RULES}' cannot be enabled: 3 active validation rules`);
        expect(engine.registry.getPackage(RULES)?.enabled).toBe(false);
        const updated = await dispatchAs(kernel, 'PATCH', `/data/${ACCOUNT}/${accountId}`, { name: 'Acme' });
        expect(updated.status, String(updated.message)).toBe(200);
    });
});

/** The listing a dependent-rule refusal's message carries, in its order (package, object, rule). */
const listingOfRules = (rules: ReadonlyArray<{ packageId: string; object: string; rule: string; fields: string[] }>) =>
    rules.map((d) => `${d.packageId} · ${d.object} · ${d.rule} (reads ${d.fields.join(', ')})`).join('; ');

describe('[#30379 contract review] the scan judges the rules the served fold serves', () => {
    let root: string;
    let booted: Booted | undefined;
    let accountId: string;
    const CODE = 'PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE';

    /** The app's object as a tenant saved it from a served read: the module's fields ride along, with the overlay's rules. */
    const accountOverlay = (validations: unknown[]) => ({
        name: ACCOUNT,
        label: 'Account',
        fields: {
            name: { name: 'name', type: 'text', label: 'Name' },
            [CREDIT]: { name: CREDIT, type: 'number', label: 'Credit' },
            [ORDER_TOTAL]: {
                name: ORDER_TOTAL, type: 'summary', label: 'Order total',
                summaryOperations: { object: ORDER, field: 'amount', function: 'sum' },
            },
        },
        validations,
        _provenance: 'org',
    });
    const visitOverlay = (validations: unknown[]) => ({
        name: VISIT,
        label: 'Visit',
        fields: {
            name: { name: 'name', type: 'text', label: 'Name' },
            amount: { name: 'amount', type: 'number', label: 'Amount' },
            account: { name: 'account', type: 'lookup', label: 'Account', reference: ACCOUNT },
        },
        validations,
        _provenance: 'org',
    });
    /** A served predicate's CEL source (the loader may wrap it as `{ dialect, source }`). */
    const sourceOf = (slot: unknown): unknown => (slot && typeof slot === 'object' ? (slot as { source?: unknown }).source : slot);
    /** A tenant copy of a packaged rule: only its sentence and its switch are the tenant's. */
    const switchedOff = (name: string, message: string) => ({ name, type: 'script', message, condition: 'true', active: false });

    beforeAll(async () => {
        root = mkdtempSync(join(tmpdir(), 'os-suite-ext-fold-'));
        writeFileSync(join(root, '.keep'), '');
        process.env.OS_HOME = mkdtempSync(join(home, 'fold-'));
        booted = await bootKernel(root, { rules: true, override: true });
        const created = await dispatchAs(booted.kernel, 'POST', `/data/${ACCOUNT}`, { name: 'Acme', [CREDIT]: 500 });
        expect(created.status, 'precondition: the account is written').toBe(201);
        accountId = idOf(created);
    }, 120_000);
    afterAll(async () => {
        await shutdown(booted);
        rmSync(root, { recursive: true, force: true });
    }, 60_000);

    it('a rule a later layer replaced by name is judged once, from the copy that wins, and named after that layer', async () => {
        const { kernel, engine } = booted!;
        const served = ((engine.registry.getObject(ACCOUNT) as any)?.validations ?? []) as Array<{ name?: string; condition?: unknown }>;
        expect(served.filter((r) => r.name === RULE_REVIEW), 'precondition: one served copy per name').toHaveLength(1);
        expect(sourceOf(served.find((r) => r.name === RULE_NOT_NEGATIVE)?.condition), 'precondition: the override\'s copy wins').toBe("record.name == 'blocked'");

        const refused = await dispatchAs(kernel, 'PATCH', `/packages/${MODULE}/disable`);
        expect({ status: refused.status, code: refused.code }).toEqual({ status: 409, code: CODE });
        // RULES' copy of RULE_NOT_NEGATIVE read the field, but the override's
        // copy is the one served, and it does not. RULE_REVIEW is listed once,
        // from the override's copy, which still reads it.
        expect(String(refused.message)).toContain(`cannot be disabled: 2 active validation rules read fields`);
        expect(String(refused.message)).toContain(`— ${listingOfRules([
            { packageId: RULES, object: VISIT, rule: RULE_VISIT_HOP, fields: [`account.${CREDIT}`] },
            { packageId: OVERRIDE, object: ACCOUNT, rule: RULE_REVIEW, fields: [CREDIT] },
        ])}. Switch off or change those rules first`);
        expect(String(refused.message)).not.toContain(RULE_NOT_NEGATIVE);
    });

    it('a tenant overlay\'s switch is honoured, its own rule is named after the overlay, and the disable proceeds once every served reader is off', async () => {
        const { kernel, engine } = booted!;
        // The tenant switches the packaged rule off through the overlay (the
        // one switch a tenant admin has on a read-only module), and adds a rule
        // of its own that reads the field.
        engine.registry.registerObject(accountOverlay([
            switchedOff(RULE_REVIEW, 'Switched off by the tenant'),
            { name: RULE_OVERLAY_OWN, type: 'script', severity: 'error', message: 'Credit is capped', condition: `record.${CREDIT} > 9000000` },
        ]) as any, APP, undefined, 'overlay');
        const served = ((engine.registry.getObject(ACCOUNT) as any)?.validations ?? []) as Array<{ name?: string; active?: unknown; condition?: unknown }>;
        const review = served.find((r) => r.name === RULE_REVIEW);
        expect({ active: review?.active, condition: sourceOf(review?.condition) }, 'precondition: the packaged copy runs, switched off')
            .toEqual({ active: false, condition: `record.${CREDIT} > 5000` });

        const overlayOwn = await dispatchAs(kernel, 'PATCH', `/packages/${MODULE}/disable`);
        expect({ status: overlayOwn.status, code: overlayOwn.code }).toEqual({ status: 409, code: CODE });
        expect(String(overlayOwn.message)).toContain(`— ${listingOfRules([
            { packageId: RULES, object: VISIT, rule: RULE_VISIT_HOP, fields: [`account.${CREDIT}`] },
            { packageId: `tenant overlay of ${APP}`, object: ACCOUNT, rule: RULE_OVERLAY_OWN, fields: [CREDIT] },
        ])}. Switch off or change those rules first`);
        expect(String(overlayOwn.message)).not.toContain(RULE_REVIEW);
        expect(String(overlayOwn.message)).not.toContain('(no package)');

        // Every served reader switched off through the overlays: the disable proceeds.
        engine.registry.registerObject(accountOverlay([switchedOff(RULE_REVIEW, 'Switched off by the tenant')]) as any, APP, undefined, 'overlay');
        engine.registry.registerObject(visitOverlay([switchedOff(RULE_VISIT_HOP, 'Switched off by the tenant')]) as any, APP, undefined, 'overlay');
        const disabled = await dispatchAs(kernel, 'PATCH', `/packages/${MODULE}/disable`);
        expect(disabled.status, String(disabled.message)).toBe(200);
        const fields = await servedFieldNames(kernel);
        for (const field of MODULE_FIELDS) expect(fields, 'the overlay\'s copies of the module\'s fields are withheld too').not.toContain(field);
        const written = await dispatchAs(kernel, 'PATCH', `/data/${ACCOUNT}/${accountId}`, { name: 'Acme Ltd' });
        expect(written.status, String(written.message)).toBe(200);
    });
});

describe('[#30379 contract review] POST /packages with enableOnInstall: false asks the same scan', () => {
    const OWNER = 'com.qa.inst.owner';
    const EXTENDER = 'com.qa.inst.flags';
    const READER = 'com.qa.inst.reader';
    const THING = 'qz_thing';
    const FLAG = 'qz_flag';
    const RULE = 'qz_flag_required';
    const CODE = 'PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE';
    const manifestOf = (id: string) => ({ id, name: id, namespace: 'qz', version: '1.0.0', type: 'module' });

    let previousHome: string | undefined;
    beforeAll(() => {
        previousHome = process.env.OS_HOME;
        process.env.OS_HOME = mkdtempSync(join(home, 'install-'));
    });
    afterAll(() => {
        process.env.OS_HOME = previousHome;
    });

    /**
     * A registry with the extender's field on the owner's object and (optionally) a rule of another package that
     * reads it; the extender is installed and enabled first unless `installed: false` (a fresh install, then).
     */
    async function door(withReader: boolean, { installed = true }: { installed?: boolean } = {}) {
        const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' } as any);
        (registry as any).logLevel = 'silent';
        const kernel: any = {
            getService: (name: string) => (name === 'objectql' ? Promise.resolve({ registry }) : null),
            context: { getService: () => null },
        };
        const dispatcher = new HttpDispatcher(kernel);
        const install = (body: unknown) => dispatcher.handlePackages('', 'POST', body, {}, {
            request: {},
            executionContext: { userId: 'u_admin', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] },
        } as any);
        if (installed) {
            const first = await install({ manifest: manifestOf(EXTENDER) });
            expect(first.response?.status, 'precondition: the extender installs').toBe(201);
        }
        registry.registerObject({ name: THING, label: 'Thing', fields: { name: { name: 'name', type: 'text', label: 'Name' } } } as any, OWNER);
        registry.registerObject({ name: THING, fields: { [FLAG]: { name: FLAG, type: 'boolean', label: 'Flag' } } } as any, EXTENDER, undefined, 'extend');
        if (withReader) {
            registry.registerObject({
                name: THING,
                validations: [{ name: RULE, type: 'script', severity: 'error', message: 'Flag it', condition: `record.${FLAG} == null` }],
            } as any, READER, undefined, 'extend');
        }
        return { registry, install };
    }

    it('an overwrite that asks to come back disabled is refused while a rule reads its field, and the package stays enabled', async () => {
        const { registry, install } = await door(true);
        const result = await install({ manifest: manifestOf(EXTENDER), overwrite: true, enableOnInstall: false });
        expect({ status: result.response?.status, code: result.response?.body?.error?.code }).toEqual({ status: 409, code: CODE });
        expect(String(result.response?.body?.error?.message)).toContain(
            `Package '${EXTENDER}' was installed and stays enabled: \`enableOnInstall: false\` cannot disable it: an active validation rule reads a field it adds through objectExtensions, which the disable would withhold — ${READER} · ${THING} · ${RULE} (reads ${FLAG})`,
        );
        expect(registry.getPackage(EXTENDER)?.enabled).toBe(true);
        expect(loadDisabledPackageIds(undefined).has(EXTENDER)).toBe(false);
        expect(Object.keys((registry.getObject(THING) as any)?.fields ?? {})).toContain(FLAG);
    });

    it('[delta review, must-fix 3] a FRESH install with enableOnInstall: false lands disabled as asked, though a rule names its field', async () => {
        // No row before the install, so nothing served is withheld: #18877's 「有旗 = 设置」 holds, and the scan is not asked.
        const { registry, install } = await door(true, { installed: false });
        expect(registry.getPackage(EXTENDER), 'precondition: no row before the install').toBeUndefined();
        const result = await install({ manifest: manifestOf(EXTENDER), enableOnInstall: false });
        expect(result.response?.status, String(result.response?.body?.error?.message)).toBe(201);
        expect(registry.getPackage(EXTENDER)?.enabled).toBe(false);
        expect(loadDisabledPackageIds(undefined).has(EXTENDER)).toBe(true);
    });

    it('control: with no rule reading the field the same overwrite installs it disabled', async () => {
        const { registry, install } = await door(false);
        const result = await install({ manifest: manifestOf(EXTENDER), overwrite: true, enableOnInstall: false });
        expect(result.response?.status).toBe(201);
        expect(registry.getPackage(EXTENDER)?.enabled).toBe(false);
        expect(loadDisabledPackageIds(undefined).has(EXTENDER)).toBe(true);
    });
});

describe('[#30756] the enable door refuses while a rule it would serve reads a field a disabled package withholds', () => {
    let root: string;
    let booted: Booted | undefined;
    let accountId: string;
    // The disable door's code (#30724), reused: the refused state is the same one.
    const CODE = 'PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE';
    /** A tenant copy of a packaged rule: only its sentence and its switch are the tenant's. */
    const switchedOff = (name: string) => ({ name, type: 'script', message: 'Switched off by the tenant', condition: 'true', active: false });

    beforeAll(async () => {
        root = mkdtempSync(join(tmpdir(), 'os-suite-ext-enable-'));
        writeFileSync(join(root, '.keep'), '');
        process.env.OS_HOME = mkdtempSync(join(home, 'enable-'));
        booted = await bootKernel(root, { rules: true });
        const created = await dispatchAs(booted.kernel, 'POST', `/data/${ACCOUNT}`, { name: 'Acme', [CREDIT]: 500 });
        expect(created.status, 'precondition: the account is written').toBe(201);
        accountId = idOf(created);
    }, 120_000);
    afterAll(async () => {
        await shutdown(booted);
        rmSync(root, { recursive: true, force: true });
    }, 60_000);

    it('control: with the field\'s package enabled, an enable with no dependent rule proceeds as before', async () => {
        const { kernel, engine } = booted!;
        expect((await dispatchAs(kernel, 'PATCH', `/packages/${RULES}/disable`)).status).toBe(200);
        const enabled = await dispatchAs(kernel, 'PATCH', `/packages/${RULES}/enable`);
        expect(enabled.status, String(enabled.message)).toBe(200);
        expect(engine.registry.getPackage(RULES)?.enabled).not.toBe(false);
        expect(loadDisabledPackageIds(ENVIRONMENT_ID).has(RULES)).toBe(false);
    });

    it('answers 409 with the code, naming every rule as package · object · rule and the package to enable first, and changes nothing', async () => {
        const { kernel, engine } = booted!;
        // The order the disable door allows: the reader off first, then the field's package.
        expect((await dispatchAs(kernel, 'PATCH', `/packages/${RULES}/disable`)).status).toBe(200);
        expect((await dispatchAs(kernel, 'PATCH', `/packages/${MODULE}/disable`)).status).toBe(200);

        const refused = await dispatchAs(kernel, 'PATCH', `/packages/${RULES}/enable`);
        expect({ status: refused.status, code: refused.code }).toEqual({ status: 409, code: CODE });
        expect(String(refused.message)).toBe(
            `Package '${RULES}' cannot be enabled: 3 active validation rules the enable would serve read fields that a disabled package adds through objectExtensions, which stay withheld — ${listingOfRules([
                { packageId: RULES, object: ACCOUNT, rule: RULE_NOT_NEGATIVE, fields: [CREDIT] },
                { packageId: RULES, object: ACCOUNT, rule: RULE_REVIEW, fields: [CREDIT] },
                { packageId: RULES, object: VISIT, rule: RULE_VISIT_HOP, fields: [`account.${CREDIT}`] },
            ])}. Switch off or change those rules first, or enable '${MODULE}' first.`,
        );
        expect(refused.details).toBeUndefined();

        // Nothing changed: the row, the served rules, the data plane and the state file.
        expect(engine.registry.getPackage(RULES)?.enabled).toBe(false);
        const rules = ((engine.registry.getObject(ACCOUNT) as any)?.validations ?? []).map((v: any) => v?.name);
        expect(rules).not.toContain(RULE_NOT_NEGATIVE);
        const written = await dispatchAs(kernel, 'PATCH', `/data/${ACCOUNT}/${accountId}`, { name: 'Acme Ltd' });
        expect(written.status, String(written.message)).toBe(200);
        expect(loadDisabledPackageIds(ENVIRONMENT_ID).has(RULES)).toBe(true);
    });

    it('control: proceeds once every rule it would serve that reads the field is switched off through the tenant overlay', async () => {
        const { kernel, engine } = booted!;
        engine.registry.registerObject({
            name: ACCOUNT, label: 'Account', fields: { name: { name: 'name', type: 'text', label: 'Name' } },
            validations: [switchedOff(RULE_NOT_NEGATIVE), switchedOff(RULE_REVIEW)], _provenance: 'org',
        } as any, APP, undefined, 'overlay');
        engine.registry.registerObject({
            name: VISIT, label: 'Visit',
            fields: {
                name: { name: 'name', type: 'text', label: 'Name' },
                amount: { name: 'amount', type: 'number', label: 'Amount' },
                account: { name: 'account', type: 'lookup', label: 'Account', reference: ACCOUNT },
            },
            validations: [switchedOff(RULE_VISIT_HOP)], _provenance: 'org',
        } as any, APP, undefined, 'overlay');

        const enabled = await dispatchAs(kernel, 'PATCH', `/packages/${RULES}/enable`);
        expect(enabled.status, String(enabled.message)).toBe(200);
        expect(engine.registry.getPackage(RULES)?.enabled).not.toBe(false);
        const served = ((engine.registry.getObject(ACCOUNT) as any)?.validations ?? []) as Array<{ name?: string; active?: unknown }>;
        expect(served.find((r) => r.name === RULE_NOT_NEGATIVE)?.active, 'the packaged rule is served, switched off').toBe(false);
        const written = await dispatchAs(kernel, 'PATCH', `/data/${ACCOUNT}/${accountId}`, { name: 'Acme' });
        expect(written.status, String(written.message)).toBe(200);
        expect(loadDisabledPackageIds(ENVIRONMENT_ID).has(RULES)).toBe(false);
    });
});

describe('[#30756] POST /packages with enableOnInstall: true asks the same scan', () => {
    const OWNER = 'com.qa.inst2.owner';
    const EXTENDER = 'com.qa.inst2.flags';
    const READER = 'com.qa.inst2.reader';
    const THING = 'qy_thing';
    const FLAG = 'qy_flag';
    const RULE = 'qy_flag_required';
    const CODE = 'PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE';
    /** Each package its own namespace: the two install side by side. */
    const manifestOf = (id: string) => ({ id, name: id, namespace: id === READER ? 'qr' : 'qy', version: '1.0.0', type: 'module' });

    let previousHome: string | undefined;
    beforeAll(() => {
        previousHome = process.env.OS_HOME;
        process.env.OS_HOME = mkdtempSync(join(home, 'install-enable-'));
    });
    afterAll(() => {
        process.env.OS_HOME = previousHome;
    });

    /** The extender's field on the owner's object, (optionally) the reader's rule over it, both packages installed and disabled. */
    async function door(withReader: boolean) {
        const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' } as any);
        (registry as any).logLevel = 'silent';
        const kernel: any = {
            getService: (name: string) => (name === 'objectql' ? Promise.resolve({ registry }) : null),
            context: { getService: () => null },
        };
        const dispatcher = new HttpDispatcher(kernel);
        const install = (body: unknown) => dispatcher.handlePackages('', 'POST', body, {}, {
            request: {},
            executionContext: { userId: 'u_admin', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] },
        } as any);
        for (const id of [EXTENDER, READER]) {
            const first = await install({ manifest: manifestOf(id) });
            expect(first.response?.status, `precondition: ${id} installs`).toBe(201);
        }
        registry.registerObject({ name: THING, label: 'Thing', fields: { name: { name: 'name', type: 'text', label: 'Name' } } } as any, OWNER);
        registry.registerObject({ name: THING, fields: { [FLAG]: { name: FLAG, type: 'boolean', label: 'Flag' } } } as any, EXTENDER, undefined, 'extend');
        if (withReader) {
            registry.registerObject({
                name: THING,
                validations: [{ name: RULE, type: 'script', severity: 'error', message: 'Flag it', condition: `record.${FLAG} == null` }],
            } as any, READER, undefined, 'extend');
        }
        registry.disablePackage(READER);
        registry.disablePackage(EXTENDER);
        return { registry, install };
    }

    it('an overwrite of a disabled package that asks to come back enabled is refused while a rule it would serve reads a withheld field, and the package stays disabled', async () => {
        const { registry, install } = await door(true);
        const result = await install({ manifest: manifestOf(READER), overwrite: true, enableOnInstall: true });
        expect({ status: result.response?.status, code: result.response?.body?.error?.code }).toEqual({ status: 409, code: CODE });
        expect(String(result.response?.body?.error?.message)).toBe(
            `Package '${READER}' was installed and stays disabled: \`enableOnInstall: true\` cannot enable it: an active validation rule the enable would serve reads a field that a disabled package adds through objectExtensions, which stays withheld — ${READER} · ${THING} · ${RULE} (reads ${FLAG}). Switch off or change that rule first, or enable '${EXTENDER}' first.`,
        );
        expect(registry.getPackage(READER)?.enabled).toBe(false);
        expect(loadDisabledPackageIds(undefined).has(READER)).toBe(true);
        expect(((registry.getObject(THING) as any)?.validations ?? []).map((v: any) => v?.name)).not.toContain(RULE);
    });

    it('control: with no rule reading the field the same overwrite installs it enabled', async () => {
        const { registry, install } = await door(false);
        const result = await install({ manifest: manifestOf(READER), overwrite: true, enableOnInstall: true });
        expect(result.response?.status, String(result.response?.body?.error?.message)).toBe(201);
        expect(registry.getPackage(READER)?.enabled).toBe(true);
        expect(loadDisabledPackageIds(undefined).has(READER)).toBe(false);
    });
});

describe('[#30756] a boot whose state file leaves an enabled package\'s rule reading a withheld field says so once', () => {
    /** Boot with the kernel logger's `warn` lines captured, and return them beside the kernel. */
    async function bootCapturingWarnings(disableModule: boolean) {
        const root = mkdtempSync(join(tmpdir(), 'os-suite-ext-bootread-'));
        writeFileSync(join(root, '.keep'), '');
        process.env.OS_HOME = mkdtempSync(join(home, 'bootread-'));
        // The state file records the field's package as disabled; the reading
        // package is not listed, so it boots enabled: no door is passed.
        if (disableModule) setPackageDisabled(ENVIRONMENT_ID, MODULE, true);
        const warnings: string[] = [];
        const booted = await bootKernel(root, { rules: true }, (kernel) => {
            const logger = (kernel as any).logger;
            const warn = logger.warn.bind(logger);
            logger.warn = (message: unknown, ...rest: unknown[]) => { warnings.push(String(message)); return warn(message, ...rest); };
        });
        return { root, booted, readerWarnings: () => warnings.filter((w) => w.includes('through objectExtensions')) };
    }

    it('names every rule, the objects whose writes are refused and the package to enable, once; the remedy then lets writes land', async () => {
        const { root, booted, readerWarnings } = await bootCapturingWarnings(true);
        try {
            const { kernel, engine } = booted;
            expect(engine.registry.getPackage(MODULE)?.enabled, 'precondition: the state file disabled the field\'s package').toBe(false);
            expect(engine.registry.getPackage(RULES)?.enabled, 'precondition: the reading package boots enabled').not.toBe(false);
            expect(readerWarnings()).toEqual([
                `[AppPlugin] 3 active validation rules read fields that a disabled package adds through objectExtensions, so every write to ${ACCOUNT}, ${VISIT} is refused (400 VALIDATION_FAILED) until this is resolved — ${listingOfRules([
                    { packageId: RULES, object: ACCOUNT, rule: RULE_NOT_NEGATIVE, fields: [CREDIT] },
                    { packageId: RULES, object: ACCOUNT, rule: RULE_REVIEW, fields: [CREDIT] },
                    { packageId: RULES, object: VISIT, rule: RULE_VISIT_HOP, fields: [`account.${CREDIT}`] },
                ])}. Switch off or change those rules, disable the package that serves them, or enable '${MODULE}'.`,
            ]);
            // What the sentence says: the write is refused while the state stands.
            const refused = await dispatchAs(kernel, 'POST', `/data/${ACCOUNT}`, { name: 'Delta' });
            expect({ status: refused.status, code: refused.code }).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
            // One of the remedies it names: the field's package enabled.
            expect((await dispatchAs(kernel, 'PATCH', `/packages/${MODULE}/enable`)).status).toBe(200);
            const written = await dispatchAs(kernel, 'POST', `/data/${ACCOUNT}`, { name: 'Delta', [CREDIT]: 10 });
            expect(written.status, String(written.message)).toBe(201);
        } finally {
            await shutdown(booted);
            rmSync(root, { recursive: true, force: true });
        }
    }, 120_000);

    it('control: a boot with nothing disabled says nothing', async () => {
        const { root, booted, readerWarnings } = await bootCapturingWarnings(false);
        try {
            expect(booted.engine.registry.getPackage(MODULE)?.enabled).not.toBe(false);
            expect(readerWarnings()).toEqual([]);
        } finally {
            await shutdown(booted);
            rmSync(root, { recursive: true, force: true });
        }
    }, 120_000);
});
