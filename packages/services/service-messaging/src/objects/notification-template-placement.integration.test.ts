// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_notification_template` refuses a save whose html or mjml body places a
 * hole the renderer cannot encode for where it lands (#25082, ruling
 * `6335348115` items 2–4). The judge is `template-hole-placement.ts`, pinned
 * class by class in its own test; this file pins the save hooks
 * (`notification-template-placement.ts`) on a real `ObjectQL` over `SqlDriver`
 * (better-sqlite3), through the real `ObjectStackProtocolImplementation`, the
 * REST data door's own error classifier (`mapDataError`) and the import runner
 * (`runImport`):
 *
 *  - NEW ROWS: a create whose html or mjml body places a hole outside element
 *    text and quoted plain-text attribute values is refused `400
 *    VALIDATION_FAILED`, one finding at `body` (`invalid_value`) naming the
 *    hole and its placement; so is a by-id update moving a row's format to
 *    html over such a body, and the failed row of an import commit. A text or
 *    markdown body is not judged, and a row naming no format takes the
 *    declared default (markdown).
 *  - STORED ROWS (written straight through the driver — the shape a row saved
 *    before this rule has): any edit that leaves a refused hole in place is
 *    refused — an edit of another column, a bulk update's row, a predicate
 *    update over a set holding it — and the row is left exactly as stored. It
 *    is still read and deleted, an edit moving the hole or the format is
 *    accepted, and it keeps rendering as it did.
 *  - THE PLUGIN binds the hooks on the kernel's engine at init and unbinds them
 *    at destroy.
 *
 * Bodies carry holes and markup only. ⛔ Nothing here rewrites or deletes a
 * stored row on the rule's behalf: the only deletes are the caller's own.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, runImport, type ExportFieldMeta } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { mapDataError } from '@objectstack/types';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { NotificationTemplate } from './notification-template.object.js';
import { NotificationTemplateStore, renderNotification, TEMPLATE_OBJECT } from '../template-renderer.js';
import { bindTemplateHolePlacement } from '../notification-template-placement.js';
import { HOLE_PLACEMENT_LABELS } from '../template-hole-placement.js';
import { MessagingServicePlugin } from '../messaging-service-plugin.js';

const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };

const ORG = 'org_a';
const TOPIC = 'deal.won';
const CTX = { isSystem: true, tenantId: ORG } as ExecutionContext;
const STORED_ID = 'tpl_stored_misplaced';

/** Every hole where the encoding is right: element text and a quoted plain-text attribute value. */
const PLACED = '<p title="{{ title }}">{{ body }}</p>';
/** One hole in element text, one in a URL attribute. */
const MISPLACED = '<a href="{{ link }}">{{ title }}</a>';
/** The refused hole of {@link MISPLACED}, as the refusal names it. */
const REFUSED_NAMED = `{{ link }} in ${HOLE_PLACEMENT_LABELS['url-attribute']}`;

const silentLogger: any = {
    debug() {}, info() {}, warn() {}, error() {}, fatal() {},
    child() { return silentLogger; },
};

let engine: ObjectQL | undefined;

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
});

async function boot(): Promise<{ ql: ObjectQL; driver: SqlDriver; protocol: ObjectStackProtocolImplementation }> {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    const ql = new ObjectQL({ logger: silentLogger });
    ql.registerDriver(driver, true);
    await ql.init();
    for (const def of [SYS_ORGANIZATION, NotificationTemplate]) {
        ql.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await ql.syncSchemas();
    ql.setTenancyPostureProvider(() => 'single');
    await ql.insert('sys_organization', { id: ORG, name: ORG }, { context: { isSystem: true } as ExecutionContext });
    expect(bindTemplateHolePlacement(ql)).toBe(true);
    engine = ql;
    return { ql, driver, protocol: new ObjectStackProtocolImplementation(ql as any) };
}

/** Boot, plus one html row with a misplaced hole stored straight through the driver. */
async function bootWithStoredMisplacedRow(): Promise<{ ql: ObjectQL; protocol: ObjectStackProtocolImplementation }> {
    const booted = await boot();
    await booted.driver.create(TEMPLATE_OBJECT, { id: STORED_ID, organization_id: ORG, ...row('html', MISPLACED) });
    return booted;
}

function row(format: string | undefined, body: string, channel = 'email'): Record<string, unknown> {
    const r: Record<string, unknown> = { topic: TOPIC, channel, locale: 'en', subject: 'subject', body, is_active: true };
    if (format !== undefined) r.format = format;
    return r;
}

async function storedRows(ql: ObjectQL): Promise<Array<Record<string, unknown>>> {
    const rows = (await ql.find(TEMPLATE_OBJECT, { fields: ['id', 'channel', 'format', 'body', 'is_active'] }, { context: CTX })) ?? [];
    return rows.map((r: Record<string, unknown>) => ({ id: r.id, channel: r.channel, format: r.format, body: r.body, is_active: r.is_active }));
}

async function storedRow(ql: ObjectQL, id: string): Promise<Record<string, unknown> | undefined> {
    return (await storedRows(ql)).find((r) => r.id === id);
}

/** The error a write threw — and a failure when it did not throw at all. */
async function thrownBy(write: Promise<unknown>): Promise<any> {
    try {
        await write;
    } catch (err) {
        return err;
    }
    throw new Error('the write was accepted; a refusal was expected');
}

/**
 * The finding's message: the supported placements, the refused hole and its
 * placement, the way out — and, where the whole message reaches the caller,
 * where a link from a value belongs.
 */
function expectPrescription(message: unknown, named = REFUSED_NAMED, whole = true): void {
    const text = String(message);
    expect(text.startsWith(
        `Body: an html or mjml body encodes a hole's value only for ${HOLE_PLACEMENT_LABELS['element-text']} and `
        + `${HOLE_PLACEMENT_LABELS['quoted-attribute']}, so a hole may sit only there.`,
    )).toBe(true);
    expect(text).toContain(`Refused: ${named}. Move each refused hole there, or set the format to text or markdown.`);
    if (whole) expect(text).toContain('email_template');
}

/**
 * The REST data door's answer to a thrown write (`mapDataError`, as `POST` /
 * `PATCH /data/:object` call it): `400 VALIDATION_FAILED`, one finding at
 * `body`, `invalid_value`, with the prescription.
 */
function expectPlacementRefusal(err: any, named = REFUSED_NAMED): void {
    expect(err?.code).toBe('VALIDATION_FAILED');
    const answer = mapDataError(err, TEMPLATE_OBJECT);
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe('VALIDATION_FAILED');
    const fields = answer.body.fields as Array<Record<string, unknown>>;
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ field: 'body', code: 'invalid_value' });
    expectPrescription(fields[0].message, named);
}

const META_MAP = new Map<string, ExportFieldMeta>(
    Object.entries(NotificationTemplate.fields).map(([name, f]: [string, any]) => [name, { name, type: f.type, label: f.label }]),
);

describe('sys_notification_template.body: a new html or mjml row placing a hole the renderer cannot encode is refused', () => {
    it.each(['html', 'mjml'])('a %s create is refused 400 VALIDATION_FAILED at the REST data door, and nothing is stored', async (format) => {
        const { ql, protocol } = await boot();
        expectPlacementRefusal(await thrownBy(protocol.createData({ object: TEMPLATE_OBJECT, data: row(format, MISPLACED), context: CTX })));
        expect(await storedRows(ql)).toEqual([]);
    });

    it('names every refused hole with its placement, and counts past five', async () => {
        const { protocol } = await boot();
        const body = `<p>{{ a }}</p><style>{{ b }}</style><img src="{{ c }}"><b id={{ d }}>x</b>`
            + '<p onclick="{{ e }}" style="{{ f }}"></p><!-- {{ g }} -->';
        const err = await thrownBy(protocol.createData({ object: TEMPLATE_OBJECT, data: row('html', body), context: CTX }));
        const named = [
            `{{ b }} in ${HOLE_PLACEMENT_LABELS['raw-text-element']}`,
            `{{ c }} in ${HOLE_PLACEMENT_LABELS['url-attribute']}`,
            `{{ d }} in ${HOLE_PLACEMENT_LABELS['unquoted-attribute']}`,
            `{{ e }} in ${HOLE_PLACEMENT_LABELS['event-handler-attribute']}`,
            `{{ f }} in ${HOLE_PLACEMENT_LABELS['style-attribute']}`,
        ].join('; ');
        expectPlacementRefusal(err, `${named}; and 1 more`);
    });

    it.each([
        ['html', PLACED],
        ['mjml', '<mjml><mj-body><mj-text css-class="{{ title }}">{{ body }}</mj-text></mj-body></mjml>'],
    ])('a %s create placing every hole where the encoding is right is stored (the positive twins)', async (format, body) => {
        const { ql, protocol } = await boot();
        const created = await protocol.createData({ object: TEMPLATE_OBJECT, data: row(format, body), context: CTX });
        expect(await storedRow(ql, String(created.id))).toMatchObject({ format, body });
    });

    it.each(['text', 'markdown', undefined])('a body with format %j is not judged: its holes render verbatim', async (format) => {
        const { ql, protocol } = await boot();
        const created = await protocol.createData({ object: TEMPLATE_OBJECT, data: row(format, MISPLACED), context: CTX });
        expect(await storedRow(ql, String(created.id))).toMatchObject({ format: format ?? 'markdown', body: MISPLACED });
    });

    it('a by-id update moving a text row to html over a misplaced hole is refused, and the row keeps text', async () => {
        const { ql, protocol } = await boot();
        const created = await protocol.createData({ object: TEMPLATE_OBJECT, data: row('text', MISPLACED), context: CTX });
        expectPlacementRefusal(await thrownBy(protocol.updateData({ object: TEMPLATE_OBJECT, id: String(created.id), data: { format: 'html' }, context: CTX })));
        expect(await storedRow(ql, String(created.id))).toMatchObject({ format: 'text', body: MISPLACED });
    });

    it('a by-id update moving a hole of an html row into a URL attribute is refused, and the row keeps its body', async () => {
        const { ql, protocol } = await boot();
        const created = await protocol.createData({ object: TEMPLATE_OBJECT, data: row('html', PLACED), context: CTX });
        expectPlacementRefusal(await thrownBy(protocol.updateData({ object: TEMPLATE_OBJECT, id: String(created.id), data: { body: MISPLACED }, context: CTX })));
        expect(await storedRow(ql, String(created.id))).toMatchObject({ format: 'html', body: PLACED });
    });

    it('an import commit stores the placed row and fails the misplaced row at body, with the prescription', async () => {
        const { ql, protocol } = await boot();
        const summary = await runImport({
            p: protocol as any,
            objectName: TEMPLATE_OBJECT,
            context: CTX,
            rows: [row('html', PLACED), row('html', MISPLACED, 'sms')],
            metaMap: META_MAP,
            writeMode: 'insert',
            matchFields: [],
            dryRun: false,
            runAutomations: false,
            trimWhitespace: true,
            createMissingOptions: false,
            skipBlankMatchKey: false,
        });
        expect(summary).toMatchObject({ created: 1, errors: 1 });
        expect(summary.results[0]).toMatchObject({ row: 1, ok: true, action: 'created' });
        expect(summary.results[1]).toMatchObject({ row: 2, ok: false, action: 'failed', field: 'body', code: 'invalid_value' });
        // An import row reports the message's head; the refused hole and the way out are in it.
        expectPrescription(summary.results[1].error, REFUSED_NAMED, false);
        expect((await storedRows(ql)).map((r) => r.body)).toEqual([PLACED]);
    });
});

describe('sys_notification_template.body: a row already stored with a misplaced hole', () => {
    it('is refused on an edit of another column at the REST data door, and is left as stored', async () => {
        const { ql, protocol } = await bootWithStoredMisplacedRow();
        expectPlacementRefusal(await thrownBy(protocol.updateData({ object: TEMPLATE_OBJECT, id: STORED_ID, data: { is_active: false }, context: CTX })));
        expectPlacementRefusal(await thrownBy(protocol.updateData({ object: TEMPLATE_OBJECT, id: STORED_ID, data: { subject: 'edited' }, context: CTX })));
        expect(await storedRow(ql, STORED_ID)).toEqual({ id: STORED_ID, channel: 'email', format: 'html', body: MISPLACED, is_active: true });
    });

    it('is refused on a write that keeps the misplaced hole while moving the others', async () => {
        const { ql, protocol } = await bootWithStoredMisplacedRow();
        expectPlacementRefusal(await thrownBy(protocol.updateData({ object: TEMPLATE_OBJECT, id: STORED_ID, data: { body: `<div>${MISPLACED}</div>` }, context: CTX })));
        expect(await storedRow(ql, STORED_ID)).toMatchObject({ body: MISPLACED });
    });

    it('fails its own row of a bulk update, VALIDATION_FAILED / 400, while the placed row lands', async () => {
        const { ql, protocol } = await bootWithStoredMisplacedRow();
        const placed = await protocol.createData({ object: TEMPLATE_OBJECT, data: row('html', PLACED, 'sms'), context: CTX });
        const answer = await protocol.updateManyData({
            object: TEMPLATE_OBJECT,
            records: [{ id: STORED_ID, data: { is_active: false } }, { id: String(placed.id), data: { is_active: false } }],
            options: { continueOnError: true },
            context: CTX,
        } as any);
        expect(answer).toMatchObject({ success: false, total: 2, succeeded: 1, failed: 1 });
        const [storedResult, placedResult] = answer.results as Array<Record<string, any>>;
        expect(storedResult).toMatchObject({ id: STORED_ID, success: false });
        expect(storedResult.errors).toHaveLength(1);
        expect(storedResult.errors[0]).toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 400 });
        expectPrescription(storedResult.errors[0].message);
        expect(placedResult).toMatchObject({ id: String(placed.id), success: true });
        expect(await storedRow(ql, STORED_ID)).toMatchObject({ is_active: true });
        expect(await storedRow(ql, String(placed.id))).toMatchObject({ is_active: false });
    });

    it('refuses a predicate update over a set holding it, and that update writes no row', async () => {
        const { ql, protocol } = await bootWithStoredMisplacedRow();
        const placed = await protocol.createData({ object: TEMPLATE_OBJECT, data: row('html', PLACED, 'sms'), context: CTX });
        expectPlacementRefusal(await thrownBy(ql.update(TEMPLATE_OBJECT, { is_active: false }, { where: { topic: TOPIC }, multi: true, context: CTX })));
        expect(await storedRow(ql, STORED_ID)).toMatchObject({ is_active: true });
        expect(await storedRow(ql, String(placed.id))).toMatchObject({ is_active: true });
    });

    it.each([
        ['moves the hole into element text', { body: '<a href="#">{{ link }} {{ title }}</a>' }],
        ['moves the format to text', { format: 'text' }],
    ])('is accepted on an edit that %s, and edits normally from then on', async (_label, repair) => {
        const { ql, protocol } = await bootWithStoredMisplacedRow();
        await protocol.updateData({ object: TEMPLATE_OBJECT, id: STORED_ID, data: repair, context: CTX });
        await protocol.updateData({ object: TEMPLATE_OBJECT, id: STORED_ID, data: { is_active: false }, context: CTX });
        expect(await storedRow(ql, STORED_ID)).toMatchObject({ ...repair, is_active: false });
    });

    it('is still read and deleted', async () => {
        const { ql, protocol } = await bootWithStoredMisplacedRow();
        const read = await protocol.getData({ object: TEMPLATE_OBJECT, id: STORED_ID, context: CTX } as any);
        expect(read.record).toMatchObject({ id: STORED_ID, format: 'html', body: MISPLACED });
        await protocol.deleteData({ object: TEMPLATE_OBJECT, id: STORED_ID, context: CTX } as any);
        expect(await storedRows(ql)).toEqual([]);
    });

    it('keeps rendering as it did: nothing runs at send', async () => {
        const { ql } = await bootWithStoredMisplacedRow();
        const store = new NotificationTemplateStore({ getData: () => ql as any });
        const loaded = await store.load(TOPIC, 'email', 'en', ORG);
        expect(loaded).toMatchObject({ format: 'html', body: MISPLACED });
        expect(renderNotification(loaded, { topic: TOPIC, payload: {} })).toEqual({ subject: 'subject', html: '<a href=""></a>' });
    });
});

describe('MessagingServicePlugin binds the save hooks on the kernel\'s engine', () => {
    const openKernels: ObjectKernel[] = [];
    const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];

    afterEach(async () => {
        while (openKernels.length) {
            try { await openKernels.pop()?.shutdown(); } catch { /* already stopped */ }
        }
        while (openDrivers.length) {
            try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
        }
    });

    it('refuses a misplaced hole once the kernel is up, and not after the plugin is destroyed', async () => {
        const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
        openKernels.push(kernel);
        const plugin = new MessagingServicePlugin({ dispatchIntervalMs: 60_000, partitionCount: 1 });
        await kernel.use(new ObjectQLPlugin());
        await kernel.use(plugin);
        await kernel.bootstrap();

        const ql = kernel.getService<ObjectQL>('objectql');
        const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
        await driver.connect();
        ql.registerDriver(driver, true);
        openDrivers.push(driver);
        ql.registry.registerObject(SYS_ORGANIZATION as any, '@objectstack/service-messaging');
        await ql.syncSchemas();
        ql.setTenancyPostureProvider(() => 'single');
        await ql.insert('sys_organization', { id: ORG, name: ORG }, { context: { isSystem: true } as ExecutionContext });

        expectPlacementRefusal(await thrownBy(ql.insert(TEMPLATE_OBJECT, row('html', MISPLACED), { context: CTX })));

        await plugin.destroy();
        await ql.insert(TEMPLATE_OBJECT, row('html', MISPLACED), { context: CTX });
        expect((await storedRows(ql)).map((r) => r.body)).toEqual([MISPLACED]);
    });
});
