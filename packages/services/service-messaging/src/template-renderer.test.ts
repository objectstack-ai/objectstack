// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    interpolate,
    renderNotification,
    NotificationTemplateStore,
    BuiltinNotificationTemplates,
    TEMPLATE_BUILTINS,
    type NotificationTemplateStoreWiring,
} from './template-renderer.js';
import { MessagingService } from './messaging-service.js';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

describe('interpolate', () => {
    it('substitutes {{ path.to.value }} from the context, linearly', () => {
        const out = interpolate('Hi {{ payload.name }} — {{ topic }}', {
            payload: { name: 'Ada' },
            topic: 'deal.won',
        });
        expect(out).toBe('Hi Ada — deal.won');
    });

    it('renders an unknown path to empty string (no throw)', () => {
        expect(interpolate('x={{ a.b.c }}', {})).toBe('x=');
    });

    it('does not evaluate logic — single braces and malformed tokens pass through literally', () => {
        // `{{also bad path}}` has spaces inside, so it is not a valid token and
        // is left untouched (no evaluation); a well-formed unknown token renders
        // empty (covered above).
        expect(interpolate('{ not a token } {{also bad path}}', {})).toBe('{ not a token } {{also bad path}}');
    });
});

describe('renderNotification', () => {
    const input = { topic: 'deal.won', payload: { title: 'Deal closed', body: 'Acme signed', amount: 42 } };

    it('renders an HTML template into { subject, html }', () => {
        const r = renderNotification(
            { subject: '{{ payload.title }}', body: '<b>{{ payload.amount }}</b>', format: 'html' },
            input,
        );
        expect(r).toEqual({ subject: 'Deal closed', html: '<b>42</b>' });
    });

    it('renders a markdown/text template into { subject, text }', () => {
        const r = renderNotification(
            { subject: 'Won: {{ payload.title }}', body: 'Amount {{ payload.amount }}', format: 'markdown' },
            input,
        );
        expect(r).toEqual({ subject: 'Won: Deal closed', text: 'Amount 42' });
    });

    it('falls back to title/body when there is no template', () => {
        expect(renderNotification(null, input)).toEqual({ subject: 'Deal closed', text: 'Acme signed' });
    });

    it('falls back to the topic when no title is available', () => {
        const r = renderNotification(null, { topic: 'sys.alert', payload: {} });
        expect(r).toEqual({ subject: 'sys.alert', text: '' });
    });

    it('uses the explicit title/body over payload when provided', () => {
        const r = renderNotification(null, { topic: 't', payload: { title: 'p', body: 'pb' }, title: 'T', body: 'B' });
        expect(r).toEqual({ subject: 'T', text: 'B' });
    });
});

describe('NotificationTemplateStore', () => {
    function fakeData(rows: any[] = []) {
        const queries: any[] = [];
        return {
            queries,
            engine: {
                async findOne(object: string, query: any) {
                    assertEngineFindOnePredicate(object, query);
                    queries.push({ object, where: query?.where });
                    const w = query?.where ?? {};
                    return (
                        rows.find(
                            (r) =>
                                r.organization_id === w.organization_id &&
                                r.topic === w.topic && r.channel === w.channel && r.locale === w.locale && r.is_active,
                        ) ?? null
                    );
                },
                async find() { return []; },
                async insert(_o: string, r: any) { return { id: 'x', ...r }; },
                async update() { return {}; },
                async delete() { return {}; },
                async count() { return 0; },
                async aggregate() { return []; },
            } as any,
        };
    }

    it('returns null when there is no data engine', async () => {
        const store = new NotificationTemplateStore({ getData: () => undefined });
        expect(await store.load('t', 'email', 'en', 'org_1')).toBeNull();
    });

    it('loads the exact (topic, channel, locale) active template', async () => {
        const data = fakeData([{ organization_id: 'org_1', topic: 't', channel: 'email', locale: 'en', is_active: true, subject: 'S', body: 'B' }]);
        const store = new NotificationTemplateStore({ getData: () => data.engine });
        const row = await store.load('t', 'email', 'en', 'org_1');
        expect(row).toMatchObject({ subject: 'S', body: 'B' });
    });

    it('falls back en-US → en → default locale', async () => {
        const data = fakeData([{ organization_id: 'org_1', topic: 't', channel: 'email', locale: 'en', is_active: true, subject: 'EN' }]);
        const store = new NotificationTemplateStore({ getData: () => data.engine });
        const row = await store.load('t', 'email', 'en-US', 'org_1');
        expect(row).toMatchObject({ subject: 'EN' });
        // First tried en-US, then en.
        expect(data.queries.map((q) => q.where.locale)).toEqual(['en-US', 'en']);
    });

    it('returns null (generic fallback) on a lookup error', async () => {
        const engine = { async findOne() { throw new Error('locked'); } } as any;
        const store = new NotificationTemplateStore({ getData: () => engine });
        expect(await store.load('t', 'email', 'en', 'org_1')).toBeNull();
    });

    // ADR-0131: the table is organization-owned, so a template is resolved in
    // the recipient's organization. The two-organization reading on a real
    // engine is `template-organization.integration.test.ts`; these pin the
    // read's own shape.
    describe("a template is resolved in the recipient's organization", () => {
        it('keys every locale rung of the read by the organization it was handed', async () => {
            const data = fakeData([]);
            const store = new NotificationTemplateStore({ getData: () => data.engine });
            expect(await store.load('t', 'email', 'en-US', 'org_1')).toBeNull();
            expect(data.queries.map((q) => q.where)).toEqual([
                { organization_id: 'org_1', topic: 't', channel: 'email', locale: 'en-US', is_active: true },
                { organization_id: 'org_1', topic: 't', channel: 'email', locale: 'en', is_active: true },
            ]);
        });

        it('a call that names no organization reads no row and answers the generic fallback', async () => {
            const data = fakeData([{ organization_id: 'org_1', topic: 't', channel: 'email', locale: 'en', is_active: true, subject: 'S' }]);
            const store = new NotificationTemplateStore({ getData: () => data.engine });
            expect(await store.load('t', 'email', 'en')).toBeNull();
            expect(await store.load('t', 'email', 'en', '')).toBeNull();
            expect(data.queries).toEqual([]);
        });
    });
});

/**
 * [#30509] The code-declared tier: templates a producer registers through
 * `MessagingService.registerBuiltinTemplates`, read beneath the organization's
 * own rows and never stored (ADR-0131 §1.4).
 */
describe('NotificationTemplateStore — the code-declared tier (#30509)', () => {
    function fakeData(rows: any[] = []) {
        const locales: string[] = [];
        return {
            locales,
            engine: {
                async findOne(object: string, query: any) {
                    assertEngineFindOnePredicate(object, query);
                    const w = query?.where ?? {};
                    locales.push(w.locale);
                    return (
                        rows.find(
                            (r) =>
                                r.organization_id === w.organization_id &&
                                r.topic === w.topic && r.channel === w.channel && r.locale === w.locale && r.is_active,
                        ) ?? null
                    );
                },
            } as any,
        };
    }
    const row = (locale: string, subject: string) =>
        ({ organization_id: 'org_1', topic: 't', channel: 'email', locale, is_active: true, subject });
    function store(engine: any, templates: Array<{ locale: string; subject: string; topic?: string; channel?: string }>) {
        const builtins = new BuiltinNotificationTemplates();
        builtins.register(templates.map((t) => ({ topic: t.topic ?? 't', channel: t.channel ?? 'email', locale: t.locale, subject: t.subject, body: 'B', format: 'text' as const })));
        const wiring: NotificationTemplateStoreWiring = { getData: () => engine, [TEMPLATE_BUILTINS]: builtins };
        return new NotificationTemplateStore(wiring);
    }

    it("answers the built-in when the organization has no row at any rung", async () => {
        const data = fakeData([]);
        const got = await store(data.engine, [{ locale: 'en', subject: 'builtin en' }]).load('t', 'email', 'en-US', 'org_1');
        expect(got).toEqual({ subject: 'builtin en', body: 'B', format: 'text' });
        expect(data.locales).toEqual(['en-US', 'en']);
    });

    it("the organization's row at a rung overrides the built-in at that rung", async () => {
        const data = fakeData([row('en', 'org en')]);
        const got = await store(data.engine, [{ locale: 'en', subject: 'builtin en' }]).load('t', 'email', 'en', 'org_1');
        expect(got).toMatchObject({ subject: 'org en' });
    });

    it('a built-in at a nearer rung beats a row at a farther rung, as two rows would', async () => {
        const data = fakeData([row('en', 'org en')]);
        const got = await store(data.engine, [{ locale: 'zh-CN', subject: 'builtin zh-CN' }]).load('t', 'email', 'zh-CN', 'org_1');
        expect(got).toMatchObject({ subject: 'builtin zh-CN' });
        expect(data.locales).toEqual(['zh-CN']);
    });

    it('is keyed by topic and channel as well as locale', async () => {
        const data = fakeData([]);
        const s = store(data.engine, [{ locale: 'en', subject: 'email t' }]);
        expect(await s.load('other', 'email', 'en', 'org_1')).toBeNull();
        expect(await s.load('t', 'sms', 'en', 'org_1')).toBeNull();
    });

    it('a delivery with no organization, or a store with no engine, still reads the built-in and no row', async () => {
        const data = fakeData([row('en', 'org en')]);
        expect(await store(data.engine, [{ locale: 'en', subject: 'builtin en' }]).load('t', 'email', 'en')).toMatchObject({ subject: 'builtin en' });
        expect(data.locales).toEqual([]);
        expect(await store(undefined, [{ locale: 'en', subject: 'builtin en' }]).load('t', 'email', 'en', 'org_1')).toMatchObject({ subject: 'builtin en' });
    });

    it('a failed row read answers null, never a built-in in place of a row it could not see', async () => {
        const engine = { async findOne() { throw new Error('locked'); } } as any;
        expect(await store(engine, [{ locale: 'en', subject: 'builtin en' }]).load('t', 'email', 'en', 'org_1')).toBeNull();
    });

    describe('registration refuses what it cannot render, and keeps nothing from a refused call', () => {
        const ok = { topic: 't', channel: 'email', locale: 'en', subject: 'S' };
        for (const [label, bad] of [
            ['no topic', { ...ok, topic: ' ' }],
            ['no channel', { ...ok, channel: '' }],
            ['no locale', { ...ok, locale: undefined }],
            ['neither subject nor body', { topic: 't', channel: 'email', locale: 'en' }],
            ['a body that is not a string', { ...ok, body: 42 }],
            ['an unknown format', { ...ok, format: 'pdf' }],
        ] as Array<[string, any]>) {
            it(label, () => {
                const builtins = new BuiltinNotificationTemplates();
                expect(() => builtins.register([{ ...ok, locale: 'zh-CN' }, bad])).toThrow(TypeError);
                expect(builtins.get('t', 'email', 'zh-CN')).toBeNull();
            });
        }

        it('a (topic, channel, locale) already declared — in an earlier call or the same one', () => {
            const builtins = new BuiltinNotificationTemplates();
            builtins.register([ok]);
            expect(() => builtins.register([{ ...ok, subject: 'second' }])).toThrow(/already declared/);
            expect(() => builtins.register([{ ...ok, locale: 'ja-JP' }, { ...ok, locale: 'ja-JP' }])).toThrow(/already declared/);
            expect(builtins.get('t', 'email', 'en')).toEqual({ subject: 'S' });
            expect(builtins.get('t', 'email', 'ja-JP')).toBeNull();
        });
    });

    it("MessagingService.registerBuiltinTemplates fills the service's own tier", () => {
        const service = new MessagingService({ logger: { info() {}, warn() {}, error() {} } as any });
        service.registerBuiltinTemplates([{ topic: 't', channel: 'email', locale: 'en', subject: '{{ title }}', body: '{{ body }}' }]);
        expect(service.builtinTemplates.get('t', 'email', 'en')).toEqual({ subject: '{{ title }}', body: '{{ body }}' });
    });
});
