// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    interpolate,
    renderNotification,
    NotificationTemplateStore,
} from './template-renderer.js';

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
                    queries.push({ object, where: query?.where });
                    const w = query?.where ?? {};
                    return (
                        rows.find(
                            (r) => r.topic === w.topic && r.channel === w.channel && r.locale === w.locale && r.is_active,
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
        expect(await store.load('t', 'email', 'en')).toBeNull();
    });

    it('loads the exact (topic, channel, locale) active template', async () => {
        const data = fakeData([{ topic: 't', channel: 'email', locale: 'en', is_active: true, subject: 'S', body: 'B' }]);
        const store = new NotificationTemplateStore({ getData: () => data.engine });
        const row = await store.load('t', 'email', 'en');
        expect(row).toMatchObject({ subject: 'S', body: 'B' });
    });

    it('falls back en-US → en → default locale', async () => {
        const data = fakeData([{ topic: 't', channel: 'email', locale: 'en', is_active: true, subject: 'EN' }]);
        const store = new NotificationTemplateStore({ getData: () => data.engine });
        const row = await store.load('t', 'email', 'en-US');
        expect(row).toMatchObject({ subject: 'EN' });
        // First tried en-US, then en.
        expect(data.queries.map((q) => q.where.locale)).toEqual(['en-US', 'en']);
    });

    it('returns null (generic fallback) on a lookup error', async () => {
        const engine = { async findOne() { throw new Error('locked'); } } as any;
        const store = new NotificationTemplateStore({ getData: () => engine });
        expect(await store.load('t', 'email', 'en')).toBeNull();
    });
});
