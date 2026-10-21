// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24978] A notification whose text is keyed (`EmitInput.keyedText`) reaches
 * each recipient in that recipient's language, rendered at delivery; one whose
 * text is not keyed reaches them exactly as before.
 *
 * ## What was measured
 *
 * `emit()` took the text a recipient reads only as `payload.title` /
 * `payload.body`, literals the producer built before any recipient existed. On
 * HotCRM every approval notification reached a zh-CN approver in English.
 *
 * ## What this pins, on a real `ObjectQL` over `SqlDriver` (better-sqlite3)
 *
 * With the kernel's own in-memory `i18n` service holding the catalog, the real
 * `MessagingService`, the real inbox, email and SMS channels (fake transports),
 * the real SQL outbox and the real dispatcher:
 *
 *  - a zh-CN recipient gets the zh-CN sentence, its object label included
 *    (a keyed param), on the inline fan-out and on every channel of the
 *    durable path — and a bare `zh` reaches the `zh-CN` pack;
 *  - a recipient with no locale gets the deployment default's sentence;
 *  - a key with no entry in the recipient's locale falls back as designed: to
 *    the catalog's declared fallback locale when the deployment declares one,
 *    else to the emitter's literal — and a key no locale holds is the literal;
 *  - a literal-only emit is byte-unchanged: the same inbox row, mail, text and
 *    delivery snapshot as a service with no renderer at all, and no locale read;
 *  - each item of a digest is rendered in its recipient's language;
 *  - the snapshot reserves `keyedText`: a producer payload member of that name
 *    is never rendered, and a malformed `keyedText` is refused before anything
 *    is written.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { SqlDriver } from '@objectstack/driver-sql';
import { createMemoryI18n } from '@objectstack/core';
import { SysNotification } from '@objectstack/platform-objects';
import { MessagingService, NOTIFICATION_EVENT_OBJECT, type EmitInput } from './messaging-service.js';
import { createInboxChannel, INBOX_OBJECT } from './inbox-channel.js';
import { createEmailChannel } from './email-channel.js';
import { createSmsChannel } from './sms-channel.js';
import { NotificationTemplateStore } from './template-renderer.js';
import { SqlNotificationOutbox, DELIVERY_OBJECT } from './sql-outbox.js';
import { MemoryNotificationOutbox } from './memory-outbox.js';
import { NotificationDispatcher } from './dispatcher.js';
import { NotificationTextRenderer } from './notification-text.js';
import type { PreferenceResolver } from './preference-resolver.js';
import {
    InboxMessage,
    NotificationDelivery,
    NotificationPreference,
    NotificationReceipt,
    NotificationTemplate,
} from './objects/index.js';

const SYSTEM = { context: { isSystem: true } as ExecutionContext };
const ORG = 'org_1';

// Declared as the platform declares them (better-auth owns both tables), with
// the columns the channels read off a recipient: address, number, locale.
const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };
const SYS_USER = {
    name: 'sys_user', label: 'User', managedBy: 'better-auth',
    fields: {
        name: { type: 'text', label: 'Name' },
        email: { type: 'text', label: 'Email' },
        phone_number: { type: 'text', label: 'Phone' },
        locale: { type: 'text', label: 'Locale' },
    },
};

const USERS = [
    { id: 'u_zh', name: 'Zhang', email: 'zhang@example.com', phone_number: '+8613800000001', locale: 'zh-CN' },
    { id: 'u_bare_zh', name: 'Zhou', email: 'zhou@example.com', phone_number: '+8613800000002', locale: 'zh' },
    { id: 'u_en', name: 'Ada', email: 'ada@example.com', phone_number: '+15550000001', locale: 'en' },
    { id: 'u_ja', name: 'Sato', email: 'sato@example.com', phone_number: '+81300000001', locale: 'ja-JP' },
    { id: 'u_none', name: 'Nobody', email: 'nobody@example.com', phone_number: '+15550000002' },
];

/** The catalog, as a producer's translation bundle would contribute it. */
const CATALOG: Record<string, Record<string, unknown>> = {
    en: {
        messages: { orderShippedTitle: 'Order shipped', orderShippedBody: 'Your {{object}} {{record}} is on its way.' },
    },
    'zh-CN': {
        messages: { orderShippedTitle: '订单已发货', orderShippedBody: '您的{{object}} {{record}} 已发出。' },
        objects: { crm_order: { label: '订单' } },
    },
    // ja-JP holds an object label and NO message entries — the "no entry in
    // the recipient's locale" leg.
    'ja-JP': {
        objects: { crm_order: { label: '注文' } },
    },
};

const KEYED = {
    titleKey: 'messages.orderShippedTitle',
    bodyKey: 'messages.orderShippedBody',
    params: { object: { key: 'objects.crm_order.label', fallback: 'Order' }, record: 'O_7' },
} as const;

/** The literal the emitter carries — what a recipient reads when nothing can be rendered. */
const LITERAL = { title: 'Order shipped', body: 'Your Order O_7 is on its way.' };
const ZH = { title: '订单已发货', body: '您的订单 O_7 已发出。' };

function recordingLogger() {
    const warnings: string[] = [];
    const logger: any = {
        info: () => {}, error: () => {}, debug: () => {},
        warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); },
    };
    logger.child = () => logger;
    return { logger, warnings };
}

let engine: ObjectQL | undefined;

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
});

/** A real engine on the `single` posture with one organization and the five recipients. */
async function boot(): Promise<ObjectQL> {
    const ql = new ObjectQL();
    ql.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
    await ql.init();
    for (const def of [
        SYS_ORGANIZATION, SYS_USER, SysNotification, InboxMessage, NotificationReceipt,
        NotificationDelivery, NotificationPreference, NotificationTemplate,
    ]) {
        ql.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await ql.syncSchemas();
    ql.setTenancyPostureProvider(() => 'single');
    await ql.insert('sys_organization', { id: ORG, name: ORG }, SYSTEM);
    for (const u of USERS) await ql.insert('sys_user', u, SYSTEM);
    engine = ql;
    return ql;
}

/** The kernel's in-memory i18n service with {@link CATALOG} loaded. */
function catalog(opts: { defaultLocale?: string; fallbackLocale?: string } = {}) {
    const i18n = createMemoryI18n();
    for (const [locale, data] of Object.entries(CATALOG)) i18n.loadTranslations(locale, data);
    if (opts.defaultLocale) i18n.setDefaultLocale(opts.defaultLocale);
    if (opts.fallbackLocale) i18n.setFallbackLocale(opts.fallbackLocale);
    return i18n;
}

/** Counts the `sys_user` locale reads the renderer makes. */
function countingData(ql: ObjectQL) {
    let localeReads = 0;
    const data = new Proxy(ql as any, {
        get(target, prop, receiver) {
            if (prop === 'findOne') {
                return async (...args: Parameters<ObjectQL['findOne']>) => {
                    const [object, query] = args;
                    const fields: unknown = query?.fields;
                    if (object === 'sys_user' && Array.isArray(fields) && fields.length === 1 && fields[0] === 'locale') localeReads += 1;
                    return target.findOne(...args);
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    return { data, localeReads: () => localeReads };
}

interface Composition {
    messaging: MessagingService;
    mail: any[];
    texts: any[];
    warnings: string[];
    localeReads: () => number;
    dispatcher?: NotificationDispatcher;
}

/**
 * The plugin's composition, by hand: ONE renderer handed to the service and to
 * the dispatcher, and the inbox / email / SMS channels on fake transports.
 * `renderer: false` composes no renderer at all — the service as it was before
 * keyed text existed, for the byte-unchanged control.
 */
function compose(
    ql: ObjectQL,
    opts: {
        i18n?: ReturnType<typeof catalog>;
        deploymentDefault?: string;
        renderer?: boolean;
        outbox?: 'sql' | 'memory';
        preferenceResolver?: PreferenceResolver;
    } = {},
): Composition {
    const { logger, warnings } = recordingLogger();
    const { data, localeReads } = countingData(ql);
    const getData = () => data;
    const i18n = opts.i18n ?? catalog();
    const textRenderer = opts.renderer === false ? undefined : new NotificationTextRenderer({
        getData,
        getI18n: () => i18n,
        getDefaultLocale: () => opts.deploymentDefault,
        logger,
    });
    const outbox = opts.outbox === 'sql'
        ? new SqlNotificationOutbox(ql as any, { partitionCount: 1 })
        : opts.outbox === 'memory' ? new MemoryNotificationOutbox(1) : undefined;
    const messaging = new MessagingService({
        logger, getData, textRenderer, outbox,
        ...(opts.preferenceResolver ? { preferenceResolver: opts.preferenceResolver } : {}),
    });
    const mail: any[] = [];
    const texts: any[] = [];
    const store = new NotificationTemplateStore({ getData });
    messaging.registerChannel(createInboxChannel({ getData }));
    messaging.registerChannel(createEmailChannel({
        getEmail: () => ({ async send(input: any) { mail.push(input); return { id: `mail_${mail.length}` }; } }),
        getData, store,
    }));
    messaging.registerChannel(createSmsChannel({
        getSms: () => ({ async send(input: any) { texts.push(input); return { messageId: `sms_${texts.length}` }; } }),
        getData, store,
    }));
    const dispatcher = outbox
        ? new NotificationDispatcher({
            nodeId: 'node-test', outbox, channels: messaging, channelContext: { logger },
            partitionCount: 1, intervalMs: 10_000, textRenderer,
        })
        : undefined;
    return { messaging, mail, texts, warnings, localeReads, dispatcher };
}

async function inboxOf(ql: ObjectQL, userId: string): Promise<Array<{ title: string; body_md: string }>> {
    const rows = (await ql.find(INBOX_OBJECT, { where: { user_id: userId }, fields: ['title', 'body_md'] }, SYSTEM)) ?? [];
    return rows.map((r: any) => ({ title: r.title, body_md: r.body_md }));
}

const emitTo = (audience: string[], over: Partial<EmitInput> = {}): EmitInput => ({
    topic: 'order.shipped', audience, organizationId: ORG, channels: ['inbox'],
    payload: { ...LITERAL }, keyedText: KEYED, ...over,
});

describe('#24978 — keyed notification text, inline fan-out', () => {
    it('a zh-CN recipient gets the zh-CN sentence, object label included; a bare `zh` reaches the zh-CN pack', async () => {
        const ql = await boot();
        const { messaging, localeReads } = compose(ql);

        const result = await messaging.emit(emitTo(['u_zh', 'u_bare_zh', 'u_en']));

        expect(result.delivered).toBe(3);
        expect(await inboxOf(ql, 'u_zh')).toEqual([{ title: ZH.title, body_md: ZH.body }]);
        expect(await inboxOf(ql, 'u_bare_zh')).toEqual([{ title: ZH.title, body_md: ZH.body }]);
        // The control: the same emit reads in English for the English recipient.
        expect(await inboxOf(ql, 'u_en')).toEqual([{ title: LITERAL.title, body_md: LITERAL.body }]);
        // One locale read per recipient, not per channel.
        expect(localeReads()).toBe(3);
    });

    it('a recipient with no locale gets the deployment default', async () => {
        const ql = await boot();
        const { messaging } = compose(ql, { deploymentDefault: 'zh-CN' });

        await messaging.emit(emitTo(['u_none', 'u_en']));

        expect(await inboxOf(ql, 'u_none')).toEqual([{ title: ZH.title, body_md: ZH.body }]);
        // The recipient's own locale outranks the deployment default.
        expect(await inboxOf(ql, 'u_en')).toEqual([{ title: LITERAL.title, body_md: LITERAL.body }]);
    });

    it("a key with no entry in the recipient's locale, and no declared fallback, delivers the literal — said once", async () => {
        const ql = await boot();
        const { messaging, warnings } = compose(ql);

        await messaging.emit(emitTo(['u_ja']));
        await messaging.emit(emitTo(['u_ja'], { dedupKey: 'again' }));

        // The object label HAS a ja-JP entry, but it fills a hole of a sentence
        // that was not rendered: the literal is the producer's whole text.
        expect(await inboxOf(ql, 'u_ja')).toEqual([
            { title: LITERAL.title, body_md: LITERAL.body },
            { title: LITERAL.title, body_md: LITERAL.body },
        ]);
        // Said once per key and locale, however many deliveries miss it.
        expect(warnings.filter((w) => w.includes('messages.orderShippedBody') && w.includes('ja-JP'))).toHaveLength(1);
    });

    it("a key with no entry in the recipient's locale falls to the catalog's declared fallback locale", async () => {
        const ql = await boot();
        // The deployment declares `en` as its fallback: the catalog's own
        // second leg answers, and the ja-JP object label still fills its hole.
        const { messaging } = compose(ql, { i18n: catalog({ fallbackLocale: 'en' }) });

        await messaging.emit(emitTo(['u_ja']));

        expect(await inboxOf(ql, 'u_ja')).toEqual([{ title: 'Order shipped', body_md: 'Your 注文 O_7 is on its way.' }]);
    });

    it('a key no locale holds delivers the literal, member by member', async () => {
        const ql = await boot();
        const { messaging, warnings } = compose(ql, { i18n: catalog({ fallbackLocale: 'en' }) });

        await messaging.emit(emitTo(['u_zh'], {
            keyedText: { titleKey: 'messages.orderShippedTitle', bodyKey: 'messages.noSuchSentence', params: KEYED.params },
        }));

        // The title renders; the body has no entry anywhere and is the literal.
        expect(await inboxOf(ql, 'u_zh')).toEqual([{ title: ZH.title, body_md: LITERAL.body }]);
        expect(warnings.some((w) => w.includes("'messages.noSuchSentence'"))).toBe(true);
    });

    it('a literal-only emit is byte-unchanged on every channel, and reads no locale', async () => {
        const run = async (renderer: boolean) => {
            const ql = await boot();
            const c = compose(ql, { renderer, deploymentDefault: 'zh-CN' });
            await c.messaging.emit({
                topic: 'order.shipped', audience: ['u_zh'], organizationId: ORG,
                channels: ['inbox', 'email', 'sms'], payload: { ...LITERAL },
            });
            const inbox = await ql.find(INBOX_OBJECT, { fields: ['user_id', 'topic', 'title', 'body_md', 'severity', 'action_url'] }, SYSTEM);
            const out = { inbox, mail: c.mail, texts: c.texts, localeReads: c.localeReads() };
            await ql.destroy();
            engine = undefined;
            return out;
        };
        const withRenderer = await run(true);
        const withoutRenderer = await run(false);

        expect(withRenderer).toEqual(withoutRenderer);
        expect(withRenderer.inbox).toEqual([expect.objectContaining({ title: LITERAL.title, body_md: LITERAL.body })]);
        expect(withRenderer.mail).toEqual([expect.objectContaining({ subject: LITERAL.title, text: LITERAL.body })]);
        expect(withRenderer.texts).toEqual([expect.objectContaining({ body: LITERAL.body })]);
        expect(withRenderer.localeReads).toBe(0);
    });
});

describe('#24978 — keyed notification text, durable path (SQL outbox + dispatcher)', () => {
    it('every channel delivers the zh-CN sentence; the stored snapshot carries the keys beside the literal', async () => {
        const ql = await boot();
        const { messaging, dispatcher, mail, texts } = compose(ql, { outbox: 'sql' });

        const result = await messaging.emit(emitTo(['u_zh', 'u_en'], { channels: ['inbox', 'email', 'sms'] }));
        expect(result.enqueued).toBe(6);

        // Stored as the keys and the literal — nothing is rendered at emit.
        const rows = (await ql.find(DELIVERY_OBJECT, { fields: ['recipient_id', 'payload'] }, SYSTEM)) as any[];
        expect(rows).toHaveLength(6);
        for (const row of rows) {
            const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
            expect(payload).toMatchObject({ ...LITERAL, keyedText: KEYED });
        }

        await dispatcher!.tick();

        expect(await inboxOf(ql, 'u_zh')).toEqual([{ title: ZH.title, body_md: ZH.body }]);
        expect(await inboxOf(ql, 'u_en')).toEqual([{ title: LITERAL.title, body_md: LITERAL.body }]);
        const mailTo = (address: string) => mail.filter((m) => m.to === address);
        expect(mailTo('zhang@example.com')).toEqual([expect.objectContaining({ subject: ZH.title, text: ZH.body })]);
        expect(mailTo('ada@example.com')).toEqual([expect.objectContaining({ subject: LITERAL.title, text: LITERAL.body })]);
        const textTo = (phone: string) => texts.filter((t) => t.to === phone);
        expect(textTo('+8613800000001')).toEqual([expect.objectContaining({ body: ZH.body })]);
        expect(textTo('+15550000001')).toEqual([expect.objectContaining({ body: LITERAL.body })]);
    });

    it('a literal-only snapshot carries no keyedText — and a producer payload member of that name is never rendered', async () => {
        const ql = await boot();
        const { messaging, dispatcher } = compose(ql, { outbox: 'sql' });

        await messaging.emit({
            topic: 'order.shipped', audience: ['u_zh'], organizationId: ORG, channels: ['inbox'],
            // A flow author's free-form payload can spell anything; this name
            // is the snapshot's, and the producer's value is dropped there.
            payload: { ...LITERAL, keyedText: KEYED },
        });
        const [row] = (await ql.find(DELIVERY_OBJECT, { fields: ['payload'] }, SYSTEM)) as any[];
        const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        expect(payload).not.toHaveProperty('keyedText');

        await dispatcher!.tick();
        expect(await inboxOf(ql, 'u_zh')).toEqual([{ title: LITERAL.title, body_md: LITERAL.body }]);
    });

    it("each item of a digest is rendered in its recipient's language", async () => {
        const ql = await boot();
        // Every recipient batches this topic into one window.
        const preferenceResolver = {
            async filter(recipients: string[], channels: string[]) {
                return recipients.map((recipient) => ({ recipient, channels, digest: { window: '2026-10-20' } }));
            },
        } as unknown as PreferenceResolver;
        const { messaging, dispatcher } = compose(ql, { outbox: 'memory', preferenceResolver });

        await messaging.emit(emitTo(['u_zh'], { dedupKey: 'a' }));
        await messaging.emit(emitTo(['u_zh'], {
            dedupKey: 'b',
            keyedText: { ...KEYED, params: { ...KEYED.params, record: 'O_8' } },
            payload: { title: LITERAL.title, body: 'Your Order O_8 is on its way.' },
        }));
        await dispatcher!.tick();

        const [digest] = (await ql.find(INBOX_OBJECT, { where: { user_id: 'u_zh' }, fields: ['title', 'body_md'] }, SYSTEM)) as any[];
        // The items are listed by their titles, each rendered in zh-CN.
        expect(digest.body_md).toBe(`• ${ZH.title}\n• ${ZH.title}`);
    });
});

describe('#24978 — the contract is closed', () => {
    it('a malformed keyedText is refused before anything is written', async () => {
        const ql = await boot();
        const { messaging } = compose(ql);
        const bad: unknown[] = [
            { title: 'messages.orderShippedTitle' },                          // undeclared member
            { titleKey: 'orderShippedTitle' },                                 // one segment never names an entry
            { titleKey: 'messages.orderShippedTitle', params: { 'a-b': 'x' } }, // a name no {{hole}} spells
            { titleKey: 'messages.orderShippedTitle', params: { object: { key: 'objects.crm_order.label' } } },
            { params: { record: 'O_7' } },                                     // names no key at all
        ];
        for (const keyedText of bad) {
            await expect(messaging.emit(emitTo(['u_zh'], { keyedText: keyedText as any })), JSON.stringify(keyedText))
                .rejects.toBeInstanceOf(TypeError);
        }
        expect(await ql.find(NOTIFICATION_EVENT_OBJECT, { fields: ['id'] }, SYSTEM)).toEqual([]);
    });
});
