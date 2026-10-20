// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_notification_template.channel` names a channel that reads a row, or the
 * write is WARNED about: the 18.x half of the maintainer's ruling D on #24770
 * (card #24924).
 *
 * Only `email` and `sms` read a row (the email channel's inline path, the SMS
 * channel, and plugin-auth's phone OTP / invitation SMS); the inbox reads none
 * on any path. A row naming any other channel used to be stored and then
 * rendered nowhere, silently. The ruling refuses such rows, but no ADR-0087
 * conversion carries stored DATA rows, so in 18.x the write is ACCEPTED with a
 * warning and the refusal waits for 19.0. ⛔ Nothing here asserts a refusal.
 *
 * The warning is the object's `channel_renders_template` rule at
 * `severity: 'warning'` — objectql's advisory path. One hit is handed to the
 * write's own `onValidationAdvisory` listener (the data protocol answers it as
 * the single-record write answer's `warnings`) and logged once per write.
 *
 * Pinned on a real `ObjectQL` over `SqlDriver` (better-sqlite3), through every
 * engine write shape the rule validator runs on:
 *
 *  - WARNING: an insert, an insert carrying an import's kept option values, a
 *    by-id update and a predicate (`multi`) update that name another channel
 *    are accepted, the row is stored as written, and exactly one advisory names
 *    `channel_renders_template` / `channel` with the message head.
 *  - SILENCE: `email` and `sms` writes produce no advisory (the positive twins,
 *    so no warning pin passes against a rule that warns about everything).
 *  - STORED ROWS: a row already stored with another channel (written under
 *    the rule's absence, straight through the driver) is read, edited in any
 *    other column and deleted with no advisory, and still renders on no
 *    channel. A write that names its channel again is warned about, and
 *    accepted.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { ValidationAdvisoryEvent } from '@objectstack/spec/data';
import { NotificationTemplate } from './notification-template.object.js';
import { NotificationTemplateStore, TEMPLATE_OBJECT } from '../template-renderer.js';

const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };

const ORG = 'org_a';
const TOPIC = 'deal.won';
const CTX = { isSystem: true, tenantId: ORG } as ExecutionContext;

const RULE = 'channel_renders_template';
/** The first sentence of the warning — what the person who saved reads. */
const WARNING_HEAD = 'This channel never uses a notification template';

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

/** A fresh listener for ONE write: the advisories that write reported. */
function advisories(): { events: ValidationAdvisoryEvent[]; onValidationAdvisory: (e: ValidationAdvisoryEvent) => void } {
    const events: ValidationAdvisoryEvent[] = [];
    return { events, onValidationAdvisory: (e) => { events.push(e); } };
}

/** Exactly one advisory, and it is this rule's, on `channel`, with the warning's head and prescription. */
function expectOneChannelWarning(events: readonly ValidationAdvisoryEvent[]): void {
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ rule: RULE, severity: 'warning', field: 'channel', code: 'invalid_format' });
    expect(String(events[0].message).startsWith(WARNING_HEAD)).toBe(true);
    // The prescription: in-app content belongs to an email template, named by
    // a notify step's `template`.
    expect(String(events[0].message)).toContain('email_template');
}

describe('sys_notification_template.channel: a channel that reads no row is accepted with a warning', () => {
    it.each(['email', 'sms'])('an insert naming %j is stored with no advisory (the positive twins)', async (channel) => {
        const { ql } = await boot();
        const seen = advisories();
        await ql.insert(TEMPLATE_OBJECT, row(channel), { context: CTX, onValidationAdvisory: seen.onValidationAdvisory });
        expect(seen.events).toEqual([]);
        expect(await channelsStored(ql)).toEqual([channel]);
    });

    it.each(['inbox', 'push', 'webhook', 'Email', ' sms'])('an insert naming %j is stored, with one channel advisory', async (channel) => {
        const { ql } = await boot();
        const seen = advisories();
        await ql.insert(TEMPLATE_OBJECT, row(channel), { context: CTX, onValidationAdvisory: seen.onValidationAdvisory });
        expectOneChannelWarning(seen.events);
        expect(await channelsStored(ql)).toEqual([channel]);
    });

    it('an insert carrying an import\'s kept option values is stored, with one channel advisory', async () => {
        const { ql } = await boot();
        const seen = advisories();
        const importCtx = { ...CTX, keptOptionValues: { channel: ['inbox'] } } as ExecutionContext;
        await ql.insert(TEMPLATE_OBJECT, row('inbox'), { context: importCtx, onValidationAdvisory: seen.onValidationAdvisory });
        expectOneChannelWarning(seen.events);
        expect(await channelsStored(ql)).toEqual(['inbox']);
    });

    it('a by-id update moving a row to another channel is stored, with one channel advisory', async () => {
        const { ql } = await boot();
        const created = await ql.insert(TEMPLATE_OBJECT, row('email'), { context: CTX });
        const seen = advisories();
        await ql.update(TEMPLATE_OBJECT, { channel: 'inbox' }, { where: { id: created.id }, context: CTX, onValidationAdvisory: seen.onValidationAdvisory });
        expectOneChannelWarning(seen.events);
        expect(await channelsStored(ql)).toEqual(['inbox']);
    });

    it('a predicate update moving a row to another channel is stored, with one channel advisory', async () => {
        const { ql } = await boot();
        await ql.insert(TEMPLATE_OBJECT, row('email'), { context: CTX });
        const seen = advisories();
        await ql.update(TEMPLATE_OBJECT, { channel: 'inbox' }, { where: { topic: TOPIC }, multi: true, context: CTX, onValidationAdvisory: seen.onValidationAdvisory });
        expectOneChannelWarning(seen.events);
        expect(await channelsStored(ql)).toEqual(['inbox']);
    });

    it('an update of an email row that does not move its channel produces no advisory', async () => {
        const { ql } = await boot();
        const created = await ql.insert(TEMPLATE_OBJECT, row('email'), { context: CTX });
        const seen = advisories();
        await ql.update(TEMPLATE_OBJECT, { channel: 'sms', body: 'moved' }, { where: { id: created.id }, context: CTX, onValidationAdvisory: seen.onValidationAdvisory });
        expect(seen.events).toEqual([]);
        expect(await channelsStored(ql)).toEqual(['sms']);
    });

    describe('a row already stored with another channel', () => {
        /** Written straight through the driver: the shape a row authored before the rule has. */
        async function bootWithStoredInboxRow(): Promise<{ ql: ObjectQL; id: string }> {
            const booted = await boot();
            const id = 'tpl_stored_inbox';
            await booted.driver.create(TEMPLATE_OBJECT, { id, organization_id: ORG, ...row('inbox', 'stored') });
            return { ql: booted.ql, id };
        }

        it('is read and edited in every other column as before, with no advisory', async () => {
            const { ql, id } = await bootWithStoredInboxRow();
            const seen = advisories();
            await ql.update(TEMPLATE_OBJECT, { body: 'edited body', is_active: false }, { where: { id }, context: CTX, onValidationAdvisory: seen.onValidationAdvisory });
            expect(seen.events).toEqual([]);
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

        it('a write that names its channel again is stored, with one channel advisory', async () => {
            const { ql, id } = await bootWithStoredInboxRow();
            const seen = advisories();
            await ql.update(TEMPLATE_OBJECT, { channel: 'inbox', body: 'x' }, { where: { id }, context: CTX, onValidationAdvisory: seen.onValidationAdvisory });
            expectOneChannelWarning(seen.events);
            const [stored] = await ql.find(TEMPLATE_OBJECT, { where: { id } }, { context: CTX });
            expect(stored).toMatchObject({ channel: 'inbox', body: 'x' });
        });
    });
});
