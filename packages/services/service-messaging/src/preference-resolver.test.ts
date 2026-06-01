// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { PreferenceResolver, quietHoursDeferral } from './preference-resolver.js';

function silentLogger() {
    return { info: () => {}, warn: () => {}, error: () => {} };
}

/**
 * Fake data engine answering `find('sys_notification_preference', { where })`
 * from an in-memory row list, filtered by the query's `topic` (and org).
 */
function fakeData(rows: any[] = [], opts: { throwOnFind?: boolean } = {}) {
    const queries: any[] = [];
    return {
        queries,
        engine: {
            async find(object: string, query: any) {
                queries.push({ object, where: query?.where });
                if (opts.throwOnFind) throw new Error('pref table locked');
                const w = query?.where ?? {};
                return rows.filter(
                    (r) =>
                        r.topic === w.topic &&
                        (w.organization_id == null || r.organization_id === w.organization_id),
                );
            },
            async findOne() { return null; },
            async insert(_o: string, r: any) { return { id: 'x', ...r }; },
            async update() { return {}; },
            async delete() { return {}; },
            async count() { return 0; },
            async aggregate() { return []; },
        } as any,
    };
}

function pref(over: Partial<{ user_id: string; topic: string; channel: string; enabled: boolean; organization_id: string }>) {
    return { user_id: '*', topic: '*', channel: '*', enabled: true, ...over };
}

function resolver(getData: () => any, mandatoryTopics: string[] = []) {
    return new PreferenceResolver({ getData, logger: silentLogger(), mandatoryTopics });
}

describe('PreferenceResolver', () => {
    it('fails open (all channels) when there is no data engine', async () => {
        const r = resolver(() => undefined);
        const out = await r.filter(['u1', 'u2'], ['inbox', 'email'], { topic: 'task.assigned' });
        expect(out).toEqual([
            { recipient: 'u1', channels: ['inbox', 'email'] },
            { recipient: 'u2', channels: ['inbox', 'email'] },
        ]);
    });

    it('returns [] for empty recipients or channels', async () => {
        const r = resolver(() => fakeData().engine);
        expect(await r.filter([], ['inbox'], { topic: 't' })).toEqual([]);
        expect(await r.filter(['u1'], [], { topic: 't' })).toEqual([]);
    });

    it('defaults every (recipient, channel) ON when no rows exist', async () => {
        const r = resolver(() => fakeData([]).engine);
        const out = await r.filter(['u1'], ['inbox', 'email'], { topic: 'task.assigned' });
        expect(out).toEqual([{ recipient: 'u1', channels: ['inbox', 'email'] }]);
    });

    it('drops a single channel a user muted, keeping the others', async () => {
        const rows = [pref({ user_id: 'u1', topic: 'task.assigned', channel: 'email', enabled: false })];
        const r = resolver(() => fakeData(rows).engine);
        const out = await r.filter(['u1'], ['inbox', 'email'], { topic: 'task.assigned' });
        expect(out).toEqual([{ recipient: 'u1', channels: ['inbox'] }]);
    });

    it('drops a recipient entirely when they mute the topic on all channels (channel "*")', async () => {
        const rows = [pref({ user_id: 'u1', topic: 'task.assigned', channel: '*', enabled: false })];
        const r = resolver(() => fakeData(rows).engine);
        const out = await r.filter(['u1', 'u2'], ['inbox', 'email'], { topic: 'task.assigned' });
        expect(out).toEqual([{ recipient: 'u2', channels: ['inbox', 'email'] }]);
    });

    it('lets a per-user row override the admin-global default', async () => {
        const rows = [
            pref({ user_id: '*', topic: 'task.assigned', channel: 'email', enabled: false }), // global: email off
            pref({ user_id: 'u1', topic: 'task.assigned', channel: 'email', enabled: true }),  // u1 opts back in
        ];
        const r = resolver(() => fakeData(rows).engine);
        const out = await r.filter(['u1', 'u2'], ['inbox', 'email'], { topic: 'task.assigned' });
        // u1 re-enabled email; u2 inherits the global mute (email dropped).
        expect(out).toEqual([
            { recipient: 'u1', channels: ['inbox', 'email'] },
            { recipient: 'u2', channels: ['inbox'] },
        ]);
    });

    it('prefers the most specific row (topic+channel beats topic-wildcard)', async () => {
        const rows = [
            pref({ user_id: 'u1', topic: 'task.assigned', channel: '*', enabled: false }),     // mute all channels…
            pref({ user_id: 'u1', topic: 'task.assigned', channel: 'inbox', enabled: true }),  // …except inbox
        ];
        const r = resolver(() => fakeData(rows).engine);
        const out = await r.filter(['u1'], ['inbox', 'email'], { topic: 'task.assigned' });
        expect(out).toEqual([{ recipient: 'u1', channels: ['inbox'] }]);
    });

    it('honours a wildcard-topic preference row', async () => {
        const rows = [pref({ user_id: 'u1', topic: '*', channel: 'email', enabled: false })];
        const r = resolver(() => fakeData(rows).engine);
        const out = await r.filter(['u1'], ['inbox', 'email'], { topic: 'anything.at.all' });
        expect(out).toEqual([{ recipient: 'u1', channels: ['inbox'] }]);
    });

    it('bypasses preferences for a mandatory topic (exact match) even when muted', async () => {
        const rows = [pref({ user_id: 'u1', topic: 'security.breach', channel: '*', enabled: false })];
        const r = resolver(() => fakeData(rows).engine, ['security.breach']);
        const out = await r.filter(['u1'], ['inbox', 'email'], { topic: 'security.breach' });
        expect(out).toEqual([{ recipient: 'u1', channels: ['inbox', 'email'] }]);
    });

    it('bypasses preferences for a mandatory topic prefix', async () => {
        const r = resolver(() => fakeData([pref({ user_id: 'u1', topic: '*', channel: '*', enabled: false })]).engine, ['security.']);
        const out = await r.filter(['u1'], ['inbox'], { topic: 'security.mfa_disabled' });
        expect(out).toEqual([{ recipient: 'u1', channels: ['inbox'] }]);
        expect(r.isMandatory('security.mfa_disabled')).toBe(true);
        expect(r.isMandatory('task.assigned')).toBe(false);
    });

    it('fails open when the preference lookup throws', async () => {
        const r = resolver(() => fakeData([], { throwOnFind: true }).engine);
        const out = await r.filter(['u1'], ['inbox', 'email'], { topic: 'task.assigned' });
        expect(out).toEqual([{ recipient: 'u1', channels: ['inbox', 'email'] }]);
    });

    it('scopes the lookup to the organization when provided', async () => {
        const data = fakeData([
            pref({ user_id: 'u1', topic: 'task.assigned', channel: 'email', enabled: false, organization_id: 'org_1' }),
        ]);
        const r = resolver(() => data.engine);
        await r.filter(['u1'], ['inbox', 'email'], { topic: 'task.assigned', organizationId: 'org_1' });
        expect(data.queries.every((q) => q.where.organization_id === 'org_1')).toBe(true);
    });
});

describe('quietHoursDeferral (P3b)', () => {
    it('defers to the end of a same-day window when now is inside it', () => {
        const now = Date.UTC(2026, 0, 1, 9, 0); // 09:00 UTC
        const out = quietHoursDeferral({ tz: 'UTC', start: '09:00', end: '17:00' }, now);
        expect(out).toBe(Date.UTC(2026, 0, 1, 17, 0));
    });

    it('defers across midnight for an overnight window', () => {
        const now = Date.UTC(2026, 0, 1, 23, 0); // 23:00 UTC, window 22:00–08:00
        const out = quietHoursDeferral({ tz: 'UTC', start: '22:00', end: '08:00' }, now);
        expect(out).toBe(Date.UTC(2026, 0, 2, 8, 0)); // 08:00 next day
    });

    it('returns undefined when now is outside the window', () => {
        const now = Date.UTC(2026, 0, 1, 12, 0);
        expect(quietHoursDeferral({ tz: 'UTC', start: '22:00', end: '08:00' }, now)).toBeUndefined();
        expect(quietHoursDeferral({ tz: 'UTC', start: '09:00', end: '17:00' }, Date.UTC(2026, 0, 1, 18, 0))).toBeUndefined();
    });

    it('returns undefined for a degenerate window or bad input', () => {
        const now = Date.UTC(2026, 0, 1, 12, 0);
        expect(quietHoursDeferral({ tz: 'UTC', start: '09:00', end: '09:00' }, now)).toBeUndefined();
        expect(quietHoursDeferral({ start: 'nonsense' } as any, now)).toBeUndefined();
    });
});

describe('PreferenceResolver — quiet hours', () => {
    it('stamps notBefore on the target when the recipient is inside quiet hours', async () => {
        const now = Date.UTC(2026, 0, 1, 23, 0);
        const rows = [pref({ user_id: 'u1', topic: '*', channel: '*', enabled: true })];
        (rows[0] as any).quiet_hours = { tz: 'UTC', start: '22:00', end: '08:00' };
        const data = fakeData(rows);
        const r = resolver(() => data.engine);
        const out = await r.filter(['u1'], ['inbox', 'email'], { topic: 'task.assigned', now });
        expect(out).toEqual([{ recipient: 'u1', channels: ['inbox', 'email'], notBefore: Date.UTC(2026, 0, 2, 8, 0) }]);
    });

    it('does not defer a critical event (bypasses quiet hours)', async () => {
        const now = Date.UTC(2026, 0, 1, 23, 0);
        const rows = [pref({ user_id: 'u1', topic: '*', channel: '*', enabled: true })];
        (rows[0] as any).quiet_hours = { tz: 'UTC', start: '22:00', end: '08:00' };
        const data = fakeData(rows);
        const r = resolver(() => data.engine);
        const out = await r.filter(['u1'], ['inbox'], { topic: 'task.assigned', now, severity: 'critical' });
        expect(out).toEqual([{ recipient: 'u1', channels: ['inbox'] }]); // no notBefore
    });

    it('accepts a JSON-string quiet_hours value', async () => {
        const now = Date.UTC(2026, 0, 1, 23, 0);
        const rows = [pref({ user_id: 'u1', topic: '*', channel: '*', enabled: true })];
        (rows[0] as any).quiet_hours = JSON.stringify({ tz: 'UTC', start: '22:00', end: '08:00' });
        const data = fakeData(rows);
        const r = resolver(() => data.engine);
        const out = await r.filter(['u1'], ['inbox'], { topic: 'task.assigned', now });
        expect(out[0].notBefore).toBe(Date.UTC(2026, 0, 2, 8, 0));
    });
});
