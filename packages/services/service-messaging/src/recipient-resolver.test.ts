// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { RecipientResolver } from './recipient-resolver.js';

function silentLogger() {
    return { warn: () => {}, info: () => {} };
}

/**
 * Fake data engine. `findOne` answers email→id and owner_of record reads;
 * `find` answers role:/team: membership queries. Both keyed by object name.
 */
function fakeData(opts: {
    users?: Record<string, string>; // email → id
    members?: Record<string, string[]>; // role → user ids
    teams?: Record<string, string[]>; // team id → user ids
    records?: Record<string, Record<string, any>>; // `${object}:${id}` → row
    throwOn?: string; // object name to throw for
} = {}) {
    const calls: Array<{ method: string; object: string; query: any }> = [];
    return {
        calls,
        engine: {
            async find(object: string, query: any) {
                calls.push({ method: 'find', object, query });
                if (object === opts.throwOn) throw new Error('locked');
                if (object === 'sys_member') {
                    const role = query?.where?.role;
                    return (opts.members?.[role] ?? []).map((id) => ({ user_id: id }));
                }
                if (object === 'sys_team_member') {
                    const team = query?.where?.team_id;
                    return (opts.teams?.[team] ?? []).map((id) => ({ user_id: id }));
                }
                return [];
            },
            async findOne(object: string, query: any) {
                calls.push({ method: 'findOne', object, query });
                if (object === opts.throwOn) throw new Error('locked');
                if (object === 'sys_user') {
                    const email = query?.where?.email;
                    const id = opts.users?.[email];
                    return id ? { id } : null;
                }
                const rid = query?.where?.id;
                return opts.records?.[`${object}:${rid}`] ?? null;
            },
            async insert() { return {}; },
            async update() { return {}; },
            async delete() { return {}; },
            async count() { return 0; },
            async aggregate() { return []; },
        } as any,
    };
}

function resolver(data?: ReturnType<typeof fakeData>) {
    return new RecipientResolver({ getData: () => data?.engine, logger: silentLogger() });
}

describe('RecipientResolver', () => {
    it('passes bare user ids through and de-dups while preserving order', async () => {
        const r = resolver(fakeData());
        expect(await r.resolve(['u1', 'u2', 'u1'])).toEqual(['u1', 'u2']);
    });

    it('accepts a single (non-array) spec', async () => {
        expect(await resolver(fakeData()).resolve('u9')).toEqual(['u9']);
    });

    it('strips the user: prefix', async () => {
        expect(await resolver(fakeData()).resolve(['user:u5'])).toEqual(['u5']);
    });

    it('resolves an email to its sys_user id', async () => {
        const data = fakeData({ users: { 'ada@example.com': 'usr_ada' } });
        expect(await resolver(data).resolve(['ada@example.com'])).toEqual(['usr_ada']);
        expect(data.calls[0]).toMatchObject({ method: 'findOne', object: 'sys_user' });
    });

    it('keeps an email verbatim when no user matches', async () => {
        const data = fakeData({ users: {} });
        expect(await resolver(data).resolve(['ghost@example.com'])).toEqual(['ghost@example.com']);
    });

    it('expands role: via sys_member (tenant-scoped) and de-dups', async () => {
        const data = fakeData({ members: { admin: ['a', 'b', 'a'] } });
        const out = await resolver(data).resolve(['role:admin'], { organizationId: 'org_1' });
        expect(out).toEqual(['a', 'b']);
        expect(data.calls[0]).toMatchObject({ method: 'find', object: 'sys_member' });
        expect(data.calls[0].query.where).toEqual({ role: 'admin', organization_id: 'org_1' });
    });

    it('expands team: via sys_team_member', async () => {
        const data = fakeData({ teams: { sales: ['s1', 's2'] } });
        expect(await resolver(data).resolve(['team:sales'])).toEqual(['s1', 's2']);
        expect(data.calls[0].query.where).toEqual({ team_id: 'sales' });
    });

    it('resolves owner_of: (structured form) to the record owner field', async () => {
        const data = fakeData({ records: { 'lead:l1': { id: 'l1', owner_id: 'u_owner' } } });
        expect(await resolver(data).resolve([{ ownerOf: { object: 'lead', id: 'l1' } }])).toEqual(['u_owner']);
    });

    it('resolves owner_of: (string form) and tries assigned_to when owner_id absent', async () => {
        const data = fakeData({ records: { 'task:t1': { id: 't1', assigned_to: 'u_assignee' } } });
        expect(await resolver(data).resolve(['owner_of:task:t1'])).toEqual(['u_assignee']);
    });

    it('mixes specs, expanding and de-duplicating across them', async () => {
        const data = fakeData({
            members: { admin: ['a', 'shared'] },
            teams: { sales: ['shared', 's1'] },
        });
        const out = await resolver(data).resolve(['role:admin', 'team:sales', 'direct']);
        expect(out).toEqual(['a', 'shared', 's1', 'direct']);
    });

    it('yields 0 recipients (no throw) when no data engine is present', async () => {
        const r = resolver(undefined);
        expect(await r.resolve(['role:admin', 'team:x', { ownerOf: { object: 'lead', id: 'l1' } }])).toEqual([]);
    });

    it('is best-effort: a failed membership query resolves to 0, not a throw', async () => {
        const data = fakeData({ throwOn: 'sys_member' });
        expect(await resolver(data).resolve(['role:admin', 'u_keep'])).toEqual(['u_keep']);
    });

    it('skips a malformed owner_of string', async () => {
        expect(await resolver(fakeData()).resolve(['owner_of:noseparator'])).toEqual([]);
    });
});
