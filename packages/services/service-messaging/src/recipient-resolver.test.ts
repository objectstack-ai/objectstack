// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { MEMBERSHIP_PAGE_SIZE, RecipientResolver } from './recipient-resolver.js';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

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
                assertEngineFindOnePredicate(object, query);
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

    it('treats an @-containing token without a domain dot as a bare id (no email lookup)', async () => {
        const data = fakeData();
        // 'svc@queue' has no domain dot → not email-shaped → passed through verbatim.
        expect(await resolver(data).resolve(['svc@queue'])).toEqual(['svc@queue']);
        expect(data.calls.filter((c) => c.object === 'sys_user')).toHaveLength(0);
    });

    it('does not treat whitespace-bearing tokens as emails (and stays linear on adversarial input)', async () => {
        const data = fakeData();
        // The old regex backtracked polynomially on '!@' + '!.'×N; the linear
        // heuristic returns promptly. No sys_user lookup for a whitespace token.
        const adversarial = `a@${'!.'.repeat(5000)}`;
        const started = Date.now();
        await resolver(data).resolve([adversarial, 'a b@x.com']);
        expect(Date.now() - started).toBeLessThan(1000);
        expect(data.calls.filter((c) => c.object === 'sys_user' && c.query?.where?.email === 'a b@x.com')).toHaveLength(0);
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

/**
 * A membership table read the way a driver reads it: `where` is matched key by
 * key (equality), `orderBy` sorts, `offset` / `limit` page, and `fields`
 * projects. Unlike {@link fakeData} it honors every key of the query, so a
 * pin that the tenant filter or the paging matters can go red.
 */
function membershipTable(rows: Array<Record<string, unknown>>, opts: { throwAtOffset?: number } = {}) {
    const calls: Array<{ object: string; query: any; options: any }> = [];
    const answer = (object: string, query: any) => {
        if (opts.throwAtOffset !== undefined && (query?.offset ?? 0) === opts.throwAtOffset) throw new Error('locked');
        const table = object === 'sys_member' || object === 'sys_team_member'
            ? rows.filter((r) => r.object === object)
            : [];
        let out = table.filter((r) => Object.entries(query?.where ?? {}).every(([k, v]) => r[k] === v));
        for (const { field, order } of [...(query?.orderBy ?? [])].reverse()) {
            out = [...out].sort((a, b) => {
                const x = String(a[field]);
                const y = String(b[field]);
                return (x < y ? -1 : x > y ? 1 : 0) * (order === 'desc' ? -1 : 1);
            });
        }
        out = out.slice(query?.offset ?? 0);
        if (query?.limit !== undefined) out = out.slice(0, query.limit);
        const fields: string[] | undefined = query?.fields;
        return fields ? out.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]]))) : out;
    };
    return {
        calls,
        engine: {
            async find(object: string, query: any, options: any) {
                calls.push({ object, query, options });
                return answer(object, query);
            },
            async findOne() { return null; },
            async insert() { return {}; },
            async update() { return {}; },
            async delete() { return {}; },
            async count() { return 0; },
            async aggregate() { return []; },
        } as any,
    };
}

function recordingLogger() {
    const warns: string[] = [];
    const infos: string[] = [];
    return {
        warns,
        infos,
        logger: { warn: (...a: unknown[]) => warns.push(a.map(String).join(' ')), info: (...a: unknown[]) => infos.push(a.map(String).join(' ')) },
    };
}

/** Organization A: the four built-in roles, a member with NO role, and one with a role outside the four. B: one member. */
const MEMBERS = [
    { object: 'sys_member', id: 'm01', organization_id: 'org_a', user_id: 'u_owner', role: 'owner' },
    { object: 'sys_member', id: 'm02', organization_id: 'org_a', user_id: 'u_admin', role: 'admin' },
    { object: 'sys_member', id: 'm03', organization_id: 'org_a', user_id: 'u_delegated', role: 'delegated_admin' },
    { object: 'sys_member', id: 'm04', organization_id: 'org_a', user_id: 'u_member', role: 'member' },
    { object: 'sys_member', id: 'm05', organization_id: 'org_a', user_id: 'u_no_role', role: null },
    { object: 'sys_member', id: 'm06', organization_id: 'org_a', user_id: 'u_custom', role: 'sales_rep' },
    { object: 'sys_member', id: 'm07', organization_id: 'org_b', user_id: 'u_other_org', role: 'member' },
];
const ORG_A_MEMBERS = ['u_owner', 'u_admin', 'u_delegated', 'u_member', 'u_no_role', 'u_custom'];

describe('[#32445] org:members — every member of the emitting organization', () => {
    it('reaches every member of the emitting organization, a member with no role or a custom role included', async () => {
        const table = membershipTable(MEMBERS);
        const r = new RecipientResolver({ getData: () => table.engine, logger: silentLogger() });
        expect(await r.resolve(['org:members'], { organizationId: 'org_a' })).toEqual(ORG_A_MEMBERS);
    });

    it('never reaches a member of another organization', async () => {
        const table = membershipTable(MEMBERS);
        const r = new RecipientResolver({ getData: () => table.engine, logger: silentLogger() });
        expect(await r.resolve('org:members', { organizationId: 'org_a' })).not.toContain('u_other_org');
        expect(await r.resolve('org:members', { organizationId: 'org_b' })).toEqual(['u_other_org']);
    });

    it('reads sys_member of that organization alone, projected to user_id, under the fan-out system opt-in', async () => {
        const table = membershipTable(MEMBERS);
        const r = new RecipientResolver({ getData: () => table.engine, logger: silentLogger() });
        await r.resolve(['org:members'], { organizationId: 'org_a' });
        expect(table.calls).toHaveLength(1);
        expect(table.calls[0].object).toBe('sys_member');
        expect(table.calls[0].query.where).toEqual({ organization_id: 'org_a' });
        expect(table.calls[0].query.fields).toEqual(['user_id']);
        expect(table.calls[0].options).toEqual({ context: { isSystem: true } });
    });

    it('pages to the end — more members than one page are all reached — and logs the count', async () => {
        const table = membershipTable(MEMBERS);
        const log = recordingLogger();
        const r = new RecipientResolver({ getData: () => table.engine, logger: log.logger, membershipPageSize: 2 });
        expect(await r.resolve(['org:members'], { organizationId: 'org_a' })).toEqual(ORG_A_MEMBERS);
        // 6 members, 2 a page: three full pages, then the short (empty) one that ends the read.
        expect(table.calls.map((c) => [c.query.offset, c.query.limit])).toEqual([[0, 2], [2, 2], [4, 2], [6, 2]]);
        expect(table.calls.every((c) => JSON.stringify(c.query.orderBy) === JSON.stringify([{ field: 'id', order: 'asc' }]))).toBe(true);
        expect(log.infos.some((line) => line.includes("'org:members' resolved 6 member(s) of organization 'org_a'"))).toBe(true);
    });

    it('with no emitting organization: 0 recipients, a warning, and no sys_member read at all', async () => {
        const table = membershipTable(MEMBERS);
        const log = recordingLogger();
        const r = new RecipientResolver({ getData: () => table.engine, logger: log.logger });
        expect(await r.resolve(['org:members'])).toEqual([]);
        expect(await r.resolve(['org:members'], { organizationId: '' })).toEqual([]);
        expect(table.calls).toHaveLength(0);
        expect(log.warns.filter((line) => line.includes('names no organization'))).toHaveLength(2);
    });

    it('refuses every other org: value, an organization named in the string included — 0 recipients, a warning, no read', async () => {
        const table = membershipTable(MEMBERS);
        const log = recordingLogger();
        const r = new RecipientResolver({ getData: () => table.engine, logger: log.logger });
        expect(await r.resolve(['org:member', 'org:org_b', 'org:', 'org:members:org_b'], { organizationId: 'org_a' })).toEqual([]);
        expect(table.calls).toHaveLength(0);
        expect(log.warns.filter((line) => line.includes('unrecognized organization audience'))).toHaveLength(4);
    });

    it('is best-effort: a page that fails resolves the selector to 0 recipients with a warning, not a throw', async () => {
        const table = membershipTable(MEMBERS, { throwAtOffset: 2 });
        const log = recordingLogger();
        const r = new RecipientResolver({ getData: () => table.engine, logger: log.logger, membershipPageSize: 2 });
        expect(await r.resolve(['org:members', 'u_direct'], { organizationId: 'org_a' })).toEqual(['u_direct']);
        expect(log.warns.some((line) => line.includes("'org:members' lookup for organization 'org_a' failed"))).toBe(true);
    });

    it('de-duplicates against the rest of the audience', async () => {
        const table = membershipTable(MEMBERS);
        const r = new RecipientResolver({ getData: () => table.engine, logger: silentLogger() });
        expect(await r.resolve(['u_admin', 'org:members', 'role:owner'], { organizationId: 'org_a' })).toEqual([
            'u_admin', 'u_owner', 'u_delegated', 'u_member', 'u_no_role', 'u_custom',
        ]);
    });
});

describe('[#32445] role: and team: page to the end — no silent cap', () => {
    const many = Array.from({ length: 5 }, (_, i) => i);
    const rows = [
        ...many.map((i) => ({ object: 'sys_member', id: `m${i}`, organization_id: 'org_a', user_id: `u_admin_${i}`, role: 'admin' })),
        ...many.map((i) => ({ object: 'sys_team_member', id: `t${i}`, team_id: 'ops', user_id: `u_ops_${i}` })),
    ];

    it('role: reaches every holder past the first page, in the emitting organization', async () => {
        const table = membershipTable(rows);
        const r = new RecipientResolver({ getData: () => table.engine, logger: silentLogger(), membershipPageSize: 2 });
        expect(await r.resolve(['role:admin'], { organizationId: 'org_a' })).toEqual(many.map((i) => `u_admin_${i}`));
        expect(table.calls.map((c) => c.query.offset)).toEqual([0, 2, 4]);
        expect(table.calls.every((c) => c.query.where.organization_id === 'org_a')).toBe(true);
    });

    it('team: reaches every member past the first page', async () => {
        const table = membershipTable(rows);
        const r = new RecipientResolver({ getData: () => table.engine, logger: silentLogger(), membershipPageSize: 2 });
        expect(await r.resolve(['team:ops'])).toEqual(many.map((i) => `u_ops_${i}`));
        expect(table.calls.map((c) => c.query.offset)).toEqual([0, 2, 4]);
    });

    it('defaults to pages of MEMBERSHIP_PAGE_SIZE rows, and a bad page size falls back to it', async () => {
        for (const membershipPageSize of [undefined, 0, -1, 1.5]) {
            const table = membershipTable(rows);
            const r = new RecipientResolver({ getData: () => table.engine, logger: silentLogger(), membershipPageSize });
            await r.resolve(['team:ops']);
            expect(table.calls.map((c) => c.query.limit)).toEqual([MEMBERSHIP_PAGE_SIZE]);
        }
    });
});
