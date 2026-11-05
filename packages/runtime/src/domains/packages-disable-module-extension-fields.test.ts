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
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { composeStacks, defineStack } from '@objectstack/spec';
import { resolveThrownHttpError } from '@objectstack/types';
import { AppPlugin } from '../app-plugin.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import { setPackageDisabled } from '../package-state-store.js';

const ENVIRONMENT_ID = 'env_suite_extension_fields';
const ADMIN = {
    userId: 'u_admin', tenantId: 'org_qa', isSystem: false,
    positions: [], permissions: [], systemPermissions: ['manage_metadata'],
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

function suiteArtifact() {
    const app = defineStack({
        manifest: { id: APP, name: 'QA Ext Suite', namespace: 'qx', version: '1.0.0', type: 'app' },
        objects: [{
            name: ACCOUNT,
            label: 'Account',
            fields: { name: { name: 'name', type: 'text', label: 'Name' } },
        }],
    });
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
    return composeStacks([orders, app], { manifest: 'preserve' });
}

interface Booted {
    kernel: ObjectKernel;
    engine: ObjectQL;
}

async function bootKernel(root: string): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: join(root, 'data.sqlite') },
        useNullAsDefault: true,
    }) as any, true);
    await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
    await kernel.use(new ObjectQLPlugin({ ql: engine }));
    await kernel.use(new AppPlugin(suiteArtifact(), { environmentId: ENVIRONMENT_ID, organizationId: 'org_qa' }));
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

async function dispatchAs(kernel: ObjectKernel, method: string, path: string, body: Record<string, unknown> = {}) {
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...ADMIN });
    const raw = new Request(`http://localhost/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
    try {
        const out: any = await dispatcher.dispatch(method, path, body, {}, { request: raw, environmentId: ENVIRONMENT_ID } as any, '/api/v1');
        const answer = out.response?.body;
        return { status: out.response?.status as number | undefined, code: codeOf(answer), message: messageOf(answer), data: answer?.data };
    } catch (e) {
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status as number | undefined, code: thrown.code as unknown, message: (e as Error)?.message, data: undefined };
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
