// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
    type EngineFindOneQueryInput,
} from '@objectstack/metadata-core';
import {
    NotificationTemplateStore,
    TEMPLATE_DECLARED_FALLBACK_LOCALE,
    type NotificationTemplateStoreWiring,
} from './template-renderer.js';
import { MessagingServicePlugin } from './messaging-service-plugin.js';
import type { MessagingService } from './messaging-service.js';
import type { Delivery } from './channel.js';

/**
 * The store's locale ladder reads the stack's DECLARED fallback
 * (`i18n.fallbackLocale`, else `defaultLocale`, through the i18n service's
 * `getFallbackLocale`), as the email template ladder does since #28880: the
 * named tag, its primary subtag, the declared fallback and ITS primary subtag,
 * then `DEFAULT_LOCALE`.
 */

/** A `sys_notification_template` row in `org_1`. */
function row(locale: string, subject = locale) {
    return { organization_id: 'org_1', topic: 't', channel: 'email', locale, is_active: true, subject, body: 'B' };
}

function fakeData(rows: any[]) {
    const locales: string[] = [];
    return {
        locales,
        engine: {
            async findOne(object: string, query: EngineFindOneQueryInput & { where?: any }) {
                assertEngineFindOnePredicate(object, query);
                const w = query?.where ?? {};
                locales.push(w.locale);
                return (
                    rows.find(
                        (r) =>
                            r.organization_id === w.organization_id && r.topic === w.topic &&
                            r.channel === w.channel && r.locale === w.locale && r.is_active,
                    ) ?? null
                );
            },
            async find() { return []; },
            async insert(_o: string, r: any) { return { id: 'x', ...r }; },
            async update(_o: string, data: any, options?: any) { assertEngineUpdateDispatch(data, options); return {}; },
            async delete(_o: string, options?: any) { assertEngineDeleteDispatch(options); return {}; },
            async count() { return 0; },
            async aggregate() { return []; },
        } as any,
    };
}

function store(engine: any, fallback?: () => string | undefined) {
    const wiring: NotificationTemplateStoreWiring = { getData: () => engine };
    if (fallback) wiring[TEMPLATE_DECLARED_FALLBACK_LOCALE] = fallback;
    return new NotificationTemplateStore(wiring);
}

describe('NotificationTemplateStore — the declared fallback locale (#28919)', () => {
    it('picks the declared fallback before en when the recipient locale has no row', async () => {
        const data = fakeData([row('zh-CN'), row('en')]);
        const got = await store(data.engine, () => 'zh-CN').load('t', 'email', 'fr-FR', 'org_1');
        expect(got).toMatchObject({ subject: 'zh-CN' });
        expect(data.locales).toEqual(['fr-FR', 'fr', 'zh-CN']);
    });

    it('folds the declared fallback to its primary subtag before en', async () => {
        const data = fakeData([row('zh'), row('en')]);
        const got = await store(data.engine, () => 'zh-CN').load('t', 'email', 'fr-FR', 'org_1');
        expect(got).toMatchObject({ subject: 'zh' });
        expect(data.locales).toEqual(['fr-FR', 'fr', 'zh-CN', 'zh']);
    });

    it("the recipient's primary subtag still wins over the declared fallback", async () => {
        const data = fakeData([row('fr'), row('zh-CN'), row('en')]);
        const got = await store(data.engine, () => 'zh-CN').load('t', 'email', 'fr-CA', 'org_1');
        expect(got).toMatchObject({ subject: 'fr' });
        expect(data.locales).toEqual(['fr-CA', 'fr']);
    });

    it('lands en when neither the recipient nor the declared fallback has a row', async () => {
        const data = fakeData([row('en')]);
        const got = await store(data.engine, () => 'zh-CN').load('t', 'email', 'fr-FR', 'org_1');
        expect(got).toMatchObject({ subject: 'en' });
        expect(data.locales).toEqual(['fr-FR', 'fr', 'zh-CN', 'zh', 'en']);
    });

    it('reads the declared fallback at each resolve, so a later answer is seen', async () => {
        const data = fakeData([row('ja'), row('zh-CN'), row('en')]);
        let declared: string | undefined;
        const s = store(data.engine, () => declared);
        expect(await s.load('t', 'email', 'fr-FR', 'org_1')).toMatchObject({ subject: 'en' });
        declared = 'zh-CN';
        expect(await s.load('t', 'email', 'fr-FR', 'org_1')).toMatchObject({ subject: 'zh-CN' });
        declared = 'ja-JP';
        expect(await s.load('t', 'email', 'fr-FR', 'org_1')).toMatchObject({ subject: 'ja' });
    });

    describe('a store with no declared fallback answers exactly as before', () => {
        for (const [label, fallback] of [
            ['no fallback reader wired', undefined],
            ['a reader that answers nothing', () => undefined],
            ['a reader that answers an empty tag', () => '  '],
            ['a reader that throws', () => { throw new Error('i18n down'); }],
        ] as Array<[string, (() => string | undefined) | undefined]>) {
            it(label, async () => {
                const data = fakeData([row('zh-CN'), row('en')]);
                const got = await store(data.engine, fallback).load('t', 'email', 'fr-FR', 'org_1');
                expect(got).toMatchObject({ subject: 'en' });
                expect(data.locales).toEqual(['fr-FR', 'fr', 'en']);
            });
        }
    });

    it('a call that names no locale keeps its single en rung', async () => {
        const data = fakeData([row('zh-CN')]);
        expect(await store(data.engine, () => 'zh-CN').load('t', 'email', undefined, 'org_1')).toBeNull();
        expect(data.locales).toEqual(['en']);
    });
});

/**
 * The composition: the plugin hands its store the i18n service's
 * `getFallbackLocale`, resolved at each send (the service may register after
 * `kernel:ready`), and a host with no i18n service renders as before.
 */
describe('MessagingServicePlugin — the email channel reads the declared fallback (#28919)', () => {
    function composed() {
        const data = fakeData([row('zh-CN', 'zh-CN subject'), row('en', 'en subject')]);
        const engine = {
            ...data.engine,
            async syncObjectSchema() {},
            async findOne(object: string, query: any) {
                if (object === 'sys_user') return { email: 'ada@example.com', locale: 'fr-FR' };
                if (object === 'sys_notification_template') return data.engine.findOne(object, query);
                assertEngineFindOnePredicate(object, query);
                return null;
            },
        };
        const services = new Map<string, unknown>([['data', engine], ['manifest', { register() {} }]]);
        const readyHooks: Array<() => Promise<void> | void> = [];
        const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger; } };
        const ctx = {
            logger,
            getService(name: string) {
                if (!services.has(name)) throw new Error(`service '${name}' not found`);
                return services.get(name);
            },
            registerService(name: string, svc: unknown) { services.set(name, svc); },
            hook(event: string, fn: () => Promise<void> | void) { if (event === 'kernel:ready') readyHooks.push(fn); },
        } as any;
        const sent: any[] = [];
        services.set('email', { async send(input: any) { sent.push(input); return { id: 'mail_1' }; } });
        return { ctx, data, sent, fireReady: async () => { for (const fn of readyHooks) await fn(); } };
    }

    const delivery: Delivery = {
        channel: 'email',
        recipient: 'user_1',
        notification: {
            notificationId: 'evt_1',
            topic: 't',
            title: 'T',
            body: 'B',
            severity: 'info',
            recipients: ['user_1'],
            organizationId: 'org_1',
            payload: {},
        } as any,
    };
    const sendCtx = { logger: { info() {}, warn() {}, error() {} } } as any;

    it('renders the declared fallback row for a recipient locale with no row, with i18n registered after kernel:ready', async () => {
        const { ctx, data, sent, fireReady } = composed();
        await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);
        await fireReady();
        ctx.registerService('i18n', { getFallbackLocale: () => 'zh-CN' });

        const messaging = ctx.getService('messaging') as MessagingService;
        const result = await messaging.getChannel('email')!.send(sendCtx, delivery);
        expect(result.ok).toBe(true);
        expect(sent[0]?.subject).toBe('zh-CN subject');
        expect(data.locales).toEqual(['fr-FR', 'fr', 'zh-CN']);
    });

    it('renders the en row on a host with no i18n service', async () => {
        const { ctx, data, sent, fireReady } = composed();
        await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);
        await fireReady();

        const messaging = ctx.getService('messaging') as MessagingService;
        const result = await messaging.getChannel('email')!.send(sendCtx, delivery);
        expect(result.ok).toBe(true);
        expect(sent[0]?.subject).toBe('en subject');
        expect(data.locales).toEqual(['fr-FR', 'fr', 'en']);
    });
});
