// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_notification_template.channel` takes only the channels that read a row:
 * `email` and `sms` (the maintainer's ruling D on #24770, card #24924).
 *
 * Those two channels are the object's only readers (the email channel's inline
 * path, the SMS channel, and plugin-auth's phone OTP / invitation SMS); the
 * inbox reads no row on any path. A row naming any other channel used to be
 * stored and then rendered nowhere, silently. The object's
 * `channel_renders_template` rule now refuses such a save, pointing in-app
 * content to the email template a notify step names.
 *
 * Pinned on a real `ObjectQL` over `SqlDriver` (better-sqlite3), through every
 * engine write shape the rule validator guards:
 *
 *  - REFUSAL: an insert, a by-id update and a predicate (`multi`) update that
 *    name another channel are refused with the ADR-0112 validation envelope —
 *    `code` `VALIDATION_FAILED`, served `400` — attributed to `channel`, whose
 *    message names the email template, and nothing is written. An import's
 *    kept option values (`keptOptionValues`) do not admit one either: the rule
 *    is not an option list.
 *  - PRESERVATION: `email` and `sms` rows are accepted (the positive twins, so
 *    no refusal pin passes against a rule that refuses everything).
 *  - STORED ROWS: a row already stored with another channel (written under
 *    the rule's absence, straight through the driver) is read, edited in any
 *    other column and deleted exactly as before, and still renders on no
 *    channel. Only a save that names its channel again is refused.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { resolveThrownHttpError } from '@objectstack/types';
import { NotificationTemplate } from './notification-template.object.js';
import { NotificationTemplateStore, TEMPLATE_OBJECT } from '../template-renderer.js';

const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };

const ORG = 'org_a';
const TOPIC = 'deal.won';
const CTX = { isSystem: true, tenantId: ORG } as ExecutionContext;

/** The first sentence of the refusal — the answer an author acts on. */
const REFUSAL_HEAD = 'Channel must be email or sms';

let engine: ObjectQL | undefined;

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
});

async function boot(): Promise<{ ql: ObjectQL; driver: SqlDriver }> {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    const ql = new ObjectQL();
    ql.registerDriver(driver, true);
    await ql.init();
    for (const def of [SYS_ORGANIZATION, NotificationTemplate]) {
        ql.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await ql.syncSchemas();
    ql.setTenancyPostureProvider(() => 'single');
    await ql.insert('sys_organization', { id: ORG, name: ORG }, { context: { isSystem: true } as ExecutionContext });
    engine = ql;
    return { ql, driver };
}

function row(channel: string, text = channel): Record<string, unknown> {
    return { topic: TOPIC, channel, locale: 'en', subject: `${text} subject`, body: `${text} body`, format: 'text', is_active: true };
}

async function channelsStored(ql: ObjectQL): Promise<string[]> {
    const rows = (await ql.find(TEMPLATE_OBJECT, { fields: ['channel'] }, { context: CTX })) ?? [];
    return rows.map((r: Record<string, unknown>) => String(r.channel)).sort();
}

/** Runs `write`, which must be refused, and returns the thrown error. */
async function refusal(write: () => Promise<unknown>): Promise<any> {
    let thrown: unknown;
    try {
        await write();
    } catch (err) {
        thrown = err;
    }
    expect(thrown, 'the write was accepted').toBeDefined();
    return thrown;
}

/** The refusal's ADR-0112 shape: code + served status, attributed to `channel`, naming the email template. */
function expectChannelRefusal(err: any): void {
    const served = resolveThrownHttpError(err);
    expect(served.code).toBe('VALIDATION_FAILED');
    expect(served.status).toBe(400);
    expect(err.fields).toHaveLength(1);
    expect(err.fields[0]).toMatchObject({ field: 'channel', code: 'invalid_format' });
    expect(String(err.fields[0].message).startsWith(REFUSAL_HEAD)).toBe(true);
    // The prescription: in-app content belongs to an email template, named by
    // a notify step's `template`.
    expect(String(err.fields[0].message)).toContain('email_template');
}

describe('sys_notification_template.channel is the closed set of channels that read a row', () => {
    it('accepts email and sms (the positive twins of every refusal below)', async () => {
        const { ql } = await boot();
        await ql.insert(TEMPLATE_OBJECT, row('email'), { context: CTX });
        await ql.insert(TEMPLATE_OBJECT, row('sms'), { context: CTX });
        expect(await channelsStored(ql)).toEqual(['email', 'sms']);
    });

    it.each(['inbox', 'push', 'webhook', 'Email', ' sms'])('refuses an insert naming %j, and stores nothing', async (channel) => {
        const { ql } = await boot();
        expectChannelRefusal(await refusal(() => ql.insert(TEMPLATE_OBJECT, row(channel), { context: CTX })));
        expect(await channelsStored(ql)).toEqual([]);
    });

    it('refuses an insert naming another channel even when an import kept that value', async () => {
        const { ql } = await boot();
        const importCtx = { ...CTX, keptOptionValues: { channel: ['inbox'] } } as ExecutionContext;
        expectChannelRefusal(await refusal(() => ql.insert(TEMPLATE_OBJECT, row('inbox'), { context: importCtx })));
        expect(await channelsStored(ql)).toEqual([]);
    });

    it('refuses a by-id update that moves a row to another channel, and leaves the row as it was', async () => {
        const { ql } = await boot();
        const created = await ql.insert(TEMPLATE_OBJECT, row('email'), { context: CTX });
        expectChannelRefusal(await refusal(() => ql.update(TEMPLATE_OBJECT, { channel: 'inbox' }, { where: { id: created.id }, context: CTX })));
        expect(await channelsStored(ql)).toEqual(['email']);
    });

    it('refuses a predicate update that moves rows to another channel', async () => {
        const { ql } = await boot();
        await ql.insert(TEMPLATE_OBJECT, row('email'), { context: CTX });
        expectChannelRefusal(await refusal(() => ql.update(TEMPLATE_OBJECT, { channel: 'inbox' }, { where: { topic: TOPIC }, multi: true, context: CTX })));
        expect(await channelsStored(ql)).toEqual(['email']);
    });

    describe('a row already stored with another channel', () => {
        /** Written straight through the driver: the shape a row authored before the rule has. */
        async function bootWithStoredInboxRow(): Promise<{ ql: ObjectQL; id: string }> {
            const booted = await boot();
            const id = 'tpl_stored_inbox';
            await booted.driver.create(TEMPLATE_OBJECT, { id, organization_id: ORG, ...row('inbox', 'stored') });
            return { ql: booted.ql, id };
        }

        it('is read and edited in every other column as before', async () => {
            const { ql, id } = await bootWithStoredInboxRow();
            await ql.update(TEMPLATE_OBJECT, { body: 'edited body', is_active: false }, { where: { id }, context: CTX });
            const [stored] = await ql.find(TEMPLATE_OBJECT, { where: { id } }, { context: CTX });
            expect(stored).toMatchObject({ id, channel: 'inbox', body: 'edited body', is_active: false });
        });

        it('still renders on no channel', async () => {
            const { ql, id } = await bootWithStoredInboxRow();
            // Control: the row is really there for this topic and organization.
            expect((await ql.find(TEMPLATE_OBJECT, { where: { id } }, { context: CTX })).length).toBe(1);
            const store = new NotificationTemplateStore({ getData: () => ql as any });
            expect(await store.load(TOPIC, 'email', 'en', ORG)).toBeNull();
            expect(await store.load(TOPIC, 'sms', 'en', ORG)).toBeNull();
        });

        it('is deleted as before', async () => {
            const { ql, id } = await bootWithStoredInboxRow();
            await ql.delete(TEMPLATE_OBJECT, { where: { id }, context: CTX });
            expect(await channelsStored(ql)).toEqual([]);
        });

        it('refuses a save that names its channel again — a save naming another channel is refused whatever the row held', async () => {
            const { ql, id } = await bootWithStoredInboxRow();
            expectChannelRefusal(await refusal(() => ql.update(TEMPLATE_OBJECT, { channel: 'inbox', body: 'x' }, { where: { id }, context: CTX })));
            const [stored] = await ql.find(TEMPLATE_OBJECT, { where: { id } }, { context: CTX });
            expect(stored).toMatchObject({ channel: 'inbox', body: 'stored body' });
        });
    });
});
