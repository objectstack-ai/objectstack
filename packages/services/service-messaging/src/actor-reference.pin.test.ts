// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21913] The fan-out writes carry the explicit system opt-in, and the engine
 * skips its referential-integrity check for an `isSystem` write. So the
 * producers keep the refusal an `actor_id` naming no user met before the
 * opt-in (`assertActorReferenceResolves`).
 *
 * The pin is DIFFERENTIAL, over a real engine: the answer each producer gives
 * for an unknown actor is held equal — name, `code`, `status`, message and
 * findings — to the refusal the engine itself gives the context-less write the
 * producer made before the opt-in. A known actor is written, and a write that
 * names no actor is unchanged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysUser } from '@objectstack/platform-objects/identity';
import { SysNotification } from '@objectstack/platform-objects/audit';
import { InboxMessage } from './objects/inbox-message.object.js';
import { NotificationReceipt } from './objects/notification-receipt.object.js';
import { MessagingService } from './messaging-service.js';
import { createInboxChannel } from './inbox-channel.js';

const SYS = { context: { isSystem: true } } as const;
const GHOST = 'usr_ghost_21913';

function silentLogger() {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

/** The refusal's observable envelope — everything but the stack. */
function envelope(e: any) {
    return { name: e?.name, code: e?.code, status: e?.status, message: e?.message, fields: e?.fields };
}

let engine: ObjectQL;
let userId: string;

beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
    await engine.init();
    engine.registry.registerObject(SysUser as any, '@objectstack/platform-objects');
    engine.registry.registerObject(SysNotification as any, '@objectstack/platform-objects');
    engine.registry.registerObject(InboxMessage as any, '@objectstack/service-messaging');
    engine.registry.registerObject(NotificationReceipt as any, '@objectstack/service-messaging');
    await engine.syncSchemas();
    const user = await engine.insert('sys_user', { name: 'Ada', email: 'ada@example.test' }, SYS);
    userId = String((user as any).id);
});

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
});

async function count(object: string): Promise<number> {
    return ((await engine.find(object, {}, SYS)) ?? []).length;
}

describe('[#21913] writeEvent keeps the dangling-actor refusal', () => {
    const service = () => new MessagingService({ logger: silentLogger(), getData: () => engine } as any);
    const event = (actorId?: string) => ({ topic: 'pin.actor', audience: [], channels: ['inbox'], ...(actorId ? { actorId } : {}) });

    it('an unknown actor_id is refused exactly as the engine refused the context-less write, and nothing is written', async () => {
        // The answer before the opt-in: the same insert with no context.
        const before = await engine.insert('sys_notification', {
            topic: 'pin.actor', payload: null, severity: 'info', dedup_key: null, source_object: null,
            source_id: null, actor_id: GHOST, organization_id: null, created_at: new Date().toISOString(),
        }).then(() => null, (e) => e);
        expect(before?.code).toBe('VALIDATION_FAILED');
        expect(await count('sys_notification')).toBe(0);

        const refusal = await service().emit(event(GHOST) as any).then(() => null, (e) => e);
        expect(refusal, 'the emit must refuse').not.toBeNull();
        expect(refusal.code).toBe('VALIDATION_FAILED');
        expect(refusal.status).toBe(before.status);
        expect(refusal.fields?.[0]).toMatchObject({ field: 'actor_id', code: 'reference_not_found', constraint: { target: 'sys_user' } });
        expect(envelope(refusal)).toEqual(envelope(before));
        expect(await count('sys_notification')).toBe(0);
    });

    it('a known actor is written, and an event naming no actor is unchanged', async () => {
        await service().emit(event(userId) as any);
        await service().emit(event() as any);
        const rows = await engine.find('sys_notification', {}, SYS);
        expect(rows.map((r: any) => r.actor_id ?? null).sort()).toEqual([null, userId].sort());
    });
});

describe('[#21913] the inbox send keeps the dangling-actor refusal', () => {
    const delivery = (actorId?: string) => ({
        channel: 'inbox',
        recipient: userId,
        notification: { topic: 'pin.actor', title: 'Pin', body: '', severity: 'info', recipients: [userId], ...(actorId ? { actorId } : {}) },
    });

    it('an unknown actor_id answers the SendResult the engine refusal produced, and no inbox row is written', async () => {
        const before = await engine.insert('sys_inbox_message', {
            user_id: userId, notification_id: null, actor_id: GHOST, topic: 'pin.actor', title: 'Pin', body_md: '',
            severity: 'info', organization_id: null, created_at: new Date().toISOString(),
        }).then(() => null, (e) => e);
        expect(before?.code).toBe('VALIDATION_FAILED');

        const result = await createInboxChannel({ getData: () => engine }).send({ logger: silentLogger() } as any, delivery(GHOST) as any);
        expect(result).toEqual({ ok: false, error: `inbox insert failed: ${before.message}` });
        expect(await count('sys_inbox_message')).toBe(0);
    });

    it('a known actor is written, and a delivery naming no actor is unchanged', async () => {
        const channel = createInboxChannel({ getData: () => engine });
        expect((await channel.send({ logger: silentLogger() } as any, delivery(userId) as any)).ok).toBe(true);
        expect((await channel.send({ logger: silentLogger() } as any, delivery() as any)).ok).toBe(true);
        expect(await count('sys_inbox_message')).toBe(2);
    });
});
