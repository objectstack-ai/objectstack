// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_notification_template` refuses every write that leaves a row naming a
 * channel no template path reads (#24983) — the maintainer's ruling D ② on
 * #24770: "② refuses stored or new non-email/sms rows", shipped now in 18.x as
 * a BREAKING minor under the amended standing rule for narrowings.
 *
 * Only `email` and `sms` read a row (`TEMPLATE_CHANNELS`). The refusal is the
 * object's `channel_renders_template` rule: a `cross_field` INVARIANT at
 * `severity: 'error'`, judged over the merged record (the stored row overlaid
 * with the write), so it answers new rows and stored rows alike.
 *
 * Pinned on a real `ObjectQL` over `SqlDriver` (better-sqlite3), through the
 * real `ObjectStackProtocolImplementation`, the REST data door's own error
 * classifier (`mapDataError`, which `POST` / `PATCH /data/:object` answer a
 * thrown write with) and the import runner (`runImport`, the import commit):
 *
 *  - NEW ROWS: a create naming another channel is refused `400
 *    VALIDATION_FAILED`, the finding on `channel` (`rule_violation`) carrying
 *    the prescription; so is a by-id update moving a row there, an insert
 *    carrying an import's kept option values, and the failed row of an import
 *    commit. `email` and `sms` are accepted.
 *  - STORED ROWS (written straight through the driver — the shape a row saved
 *    before this rule has): any edit that leaves the channel out of the set is
 *    refused with the same prescription — an edit of another column, a write
 *    re-naming the channel, a bulk update's row and a predicate update over a
 *    set holding it — and the row is left exactly as stored. It is still read
 *    and deleted, an edit moving it to email or sms is accepted, and delivery
 *    is unchanged: no channel renders it, before or after.
 *
 * ⛔ Nothing here rewrites or deletes a stored row on the rule's behalf: the
 * only deletes are the caller's own.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { runImport, type ExportFieldMeta } from '@objectstack/core';
import { mapDataError } from '@objectstack/types';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { NotificationTemplate, TEMPLATE_CHANNELS } from './notification-template.object.js';
import { NotificationTemplateStore, TEMPLATE_OBJECT } from '../template-renderer.js';

const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };

const ORG = 'org_a';
const TOPIC = 'deal.won';
const CTX = { isSystem: true, tenantId: ORG } as ExecutionContext;

/** The first sentence of the refusal — what the person who saved reads. */
const REFUSAL_HEAD = 'Only the email and sms channels use a notification template, so a template for any other channel is refused';
const STORED_ID = 'tpl_stored_inbox';

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
    engine = ql;
    return { ql, driver, protocol: new ObjectStackProtocolImplementation(ql as any) };
}

/** Boot, plus one row stored with `channel: 'inbox'` straight through the driver. */
async function bootWithStoredInboxRow(): Promise<{ ql: ObjectQL; protocol: ObjectStackProtocolImplementation }> {
    const booted = await boot();
    await booted.driver.create(TEMPLATE_OBJECT, { id: STORED_ID, organization_id: ORG, ...row('inbox', 'stored') });
    return booted;
}

function row(channel: string, text = channel): Record<string, unknown> {
    return { topic: TOPIC, channel, locale: 'en', subject: `${text} subject`, body: `${text} body`, format: 'text', is_active: true };
}

async function storedRows(ql: ObjectQL): Promise<Array<Record<string, unknown>>> {
    const rows = (await ql.find(TEMPLATE_OBJECT, { fields: ['id', 'channel', 'body', 'is_active'] }, { context: CTX })) ?? [];
    return rows.map((r: Record<string, unknown>) => ({ id: r.id, channel: r.channel, body: r.body, is_active: r.is_active }));
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

/** The finding's prescription: its head, and in-app content as an email template. */
function expectPrescription(message: unknown): void {
    expect(String(message).startsWith(REFUSAL_HEAD)).toBe(true);
    expect(String(message)).toContain('email_template');
}

/**
 * The REST data door's answer to a thrown write (`mapDataError`, as `POST` /
 * `PATCH /data/:object` call it): `400 VALIDATION_FAILED`, one finding on
 * `channel` from this rule, with the prescription.
 */
function expectChannelRefusal(err: any): void {
    expect(err?.code).toBe('VALIDATION_FAILED');
    const answer = mapDataError(err, TEMPLATE_OBJECT);
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe('VALIDATION_FAILED');
    const fields = answer.body.fields as Array<Record<string, unknown>>;
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ field: 'channel', code: 'rule_violation' });
    expectPrescription(fields[0].message);
}

const META_MAP = new Map<string, ExportFieldMeta>(
    Object.entries(NotificationTemplate.fields).map(([name, f]: [string, any]) => [name, { name, type: f.type, label: f.label }]),
);

describe('sys_notification_template.channel: a new row for a channel that reads no row is refused', () => {
    it.each(['inbox', 'push', 'webhook', 'Email', ' sms'])('a create naming %j is refused 400 VALIDATION_FAILED at the REST data door, and nothing is stored', async (channel) => {
        const { ql, protocol } = await boot();
        expectChannelRefusal(await thrownBy(protocol.createData({ object: TEMPLATE_OBJECT, data: row(channel), context: CTX })));
        expect(await storedRows(ql)).toEqual([]);
    });

    it.each([...TEMPLATE_CHANNELS])('a create naming %j is stored (the positive twins)', async (channel) => {
        const { ql, protocol } = await boot();
        const created = await protocol.createData({ object: TEMPLATE_OBJECT, data: row(channel), context: CTX });
        expect(created.record).toMatchObject({ channel });
        expect((await storedRows(ql)).map((r) => r.channel)).toEqual([channel]);
    });

    it('an insert carrying an import\'s kept option values is refused all the same', async () => {
        const { ql } = await boot();
        const importCtx = { ...CTX, keptOptionValues: { channel: ['inbox'] } } as ExecutionContext;
        expectChannelRefusal(await thrownBy(ql.insert(TEMPLATE_OBJECT, row('inbox'), { context: importCtx })));
        expect(await storedRows(ql)).toEqual([]);
    });

    it('a by-id update moving an email row to another channel is refused, and the row keeps email', async () => {
        const { ql, protocol } = await boot();
        const created = await protocol.createData({ object: TEMPLATE_OBJECT, data: row('email'), context: CTX });
        expectChannelRefusal(await thrownBy(protocol.updateData({ object: TEMPLATE_OBJECT, id: String(created.id), data: { channel: 'inbox' }, context: CTX })));
        expect(await storedRow(ql, String(created.id))).toMatchObject({ channel: 'email' });
    });

    it('a by-id update between email and sms is accepted', async () => {
        const { ql, protocol } = await boot();
        const created = await protocol.createData({ object: TEMPLATE_OBJECT, data: row('email'), context: CTX });
        await protocol.updateData({ object: TEMPLATE_OBJECT, id: String(created.id), data: { channel: 'sms', body: 'moved' }, context: CTX });
        expect(await storedRow(ql, String(created.id))).toMatchObject({ channel: 'sms', body: 'moved' });
    });

    it('an import commit stores the sms row and fails the inbox row on channel, with the prescription', async () => {
        const { ql, protocol } = await boot();
        const summary = await runImport({
            p: protocol as any,
            objectName: TEMPLATE_OBJECT,
            context: CTX,
            rows: [row('sms'), row('inbox')],
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
        expect(summary.results[1]).toMatchObject({ row: 2, ok: false, action: 'failed', field: 'channel', code: 'rule_violation' });
        expectPrescription(summary.results[1].error);
        expect((await storedRows(ql)).map((r) => r.channel)).toEqual(['sms']);
    });
});

describe('sys_notification_template.channel: a row already stored with another channel', () => {
    it('is refused on an edit of another column at the REST data door, and is left as stored', async () => {
        const { ql, protocol } = await bootWithStoredInboxRow();
        expectChannelRefusal(await thrownBy(protocol.updateData({ object: TEMPLATE_OBJECT, id: STORED_ID, data: { body: 'edited body' }, context: CTX })));
        expectChannelRefusal(await thrownBy(protocol.updateData({ object: TEMPLATE_OBJECT, id: STORED_ID, data: { is_active: false }, context: CTX })));
        expect(await storedRow(ql, STORED_ID)).toEqual({ id: STORED_ID, channel: 'inbox', body: 'stored body', is_active: true });
    });

    it('is refused on a write that names its channel again', async () => {
        const { ql, protocol } = await bootWithStoredInboxRow();
        expectChannelRefusal(await thrownBy(protocol.updateData({ object: TEMPLATE_OBJECT, id: STORED_ID, data: { channel: 'inbox', body: 'x' }, context: CTX })));
        expect(await storedRow(ql, STORED_ID)).toMatchObject({ channel: 'inbox', body: 'stored body' });
    });

    it('fails its own row of a bulk update, VALIDATION_FAILED / 400, while the email row lands', async () => {
        const { ql, protocol } = await bootWithStoredInboxRow();
        const email = await protocol.createData({ object: TEMPLATE_OBJECT, data: row('email'), context: CTX });
        const answer = await protocol.updateManyData({
            object: TEMPLATE_OBJECT,
            records: [{ id: STORED_ID, data: { body: 'bulk' } }, { id: String(email.id), data: { body: 'bulk' } }],
            options: { continueOnError: true },
            context: CTX,
        } as any);
        expect(answer).toMatchObject({ success: false, total: 2, succeeded: 1, failed: 1 });
        const [inboxResult, emailResult] = answer.results as Array<Record<string, any>>;
        expect(inboxResult).toMatchObject({ id: STORED_ID, success: false });
        expect(inboxResult.errors).toHaveLength(1);
        expect(inboxResult.errors[0]).toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 400 });
        expectPrescription(inboxResult.errors[0].message);
        expect(emailResult).toMatchObject({ id: String(email.id), success: true });
        expect(await storedRow(ql, STORED_ID)).toMatchObject({ channel: 'inbox', body: 'stored body' });
        expect(await storedRow(ql, String(email.id))).toMatchObject({ channel: 'email', body: 'bulk' });
    });

    it('refuses a predicate update over a set holding it, and that update writes no row', async () => {
        const { ql, protocol } = await bootWithStoredInboxRow();
        const email = await protocol.createData({ object: TEMPLATE_OBJECT, data: row('email'), context: CTX });
        expectChannelRefusal(await thrownBy(ql.update(TEMPLATE_OBJECT, { is_active: false }, { where: { topic: TOPIC }, multi: true, context: CTX })));
        expect(await storedRow(ql, STORED_ID)).toMatchObject({ is_active: true });
        expect(await storedRow(ql, String(email.id))).toMatchObject({ is_active: true });
    });

    it('is accepted on an edit that moves it to email, and edits normally from then on', async () => {
        const { ql, protocol } = await bootWithStoredInboxRow();
        await protocol.updateData({ object: TEMPLATE_OBJECT, id: STORED_ID, data: { channel: 'email' }, context: CTX });
        await protocol.updateData({ object: TEMPLATE_OBJECT, id: STORED_ID, data: { body: 'repaired body' }, context: CTX });
        expect(await storedRow(ql, STORED_ID)).toMatchObject({ channel: 'email', body: 'repaired body' });
    });

    it('is still read and deleted', async () => {
        const { ql, protocol } = await bootWithStoredInboxRow();
        const read = await protocol.getData({ object: TEMPLATE_OBJECT, id: STORED_ID, context: CTX } as any);
        expect(read.record).toMatchObject({ id: STORED_ID, channel: 'inbox' });
        await protocol.deleteData({ object: TEMPLATE_OBJECT, id: STORED_ID, context: CTX } as any);
        expect(await storedRows(ql)).toEqual([]);
    });

    it('still renders on no channel', async () => {
        const { ql } = await bootWithStoredInboxRow();
        // Control: the row is really there for this topic and organization.
        expect(await storedRow(ql, STORED_ID)).toBeDefined();
        const store = new NotificationTemplateStore({ getData: () => ql as any });
        for (const channel of TEMPLATE_CHANNELS) {
            expect(await store.load(TOPIC, channel, 'en', ORG)).toBeNull();
        }
    });
});
