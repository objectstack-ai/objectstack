// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `PreferenceResolver.filter` reads an organization's preference rows for the
 * event's topic and for `*` to the END, in pages that seek past the last `id`,
 * so a recipient's own row is found however many rows the organization holds.
 * One capped read with no order dropped an undefined subset once a topic held
 * more rows than the cap, and the event was delivered as though the
 * recipient's opt-out did not exist.
 *
 * Two layers:
 *  - a double that applies the query (equality, `$and`, `$gt`, `orderBy`,
 *    `limit`) the way a driver does, to show the page sequence and the loud
 *    refusal of a walk that cannot advance;
 *  - a real `ObjectQL` / `SqlDriver` (better-sqlite3) file database, so the
 *    seek predicate the walk sends is one the shipped driver executes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
    type EngineFindOneQueryInput,
} from '@objectstack/metadata-core';
import { NotificationPreference } from './objects/notification-preference.object.js';
import { PreferenceResolver, PREFERENCE_PAGE_SIZE, setPreferencePageSizeForTests } from './preference-resolver.js';

type Row = Record<string, unknown>;

/**
 * The WHERE shapes the walk sends — equality, `$and`, and `{ $gt }` — and
 * nothing else: any other combinator or operator is REFUSED, never read as a
 * field name.
 */
function matches(row: Row, where: unknown): boolean {
    if (where == null) return true;
    return Object.entries(where as Row).every(([key, cond]) => {
        if (key === '$and') return (cond as unknown[]).every((w) => matches(row, w));
        if (key.startsWith('$')) throw new Error(`pagedData: unsupported combinator ${key}`);
        if (cond !== null && typeof cond === 'object') {
            const ops = Object.keys(cond as Row);
            if (ops.length !== 1 || ops[0] !== '$gt') throw new Error(`pagedData: unsupported operator ${ops.join(',')}`);
            return String(row[key]) > String((cond as Row).$gt);
        }
        return cond === null ? row[key] == null : row[key] === cond;
    });
}

/**
 * A data engine over an in-memory row list that applies `where`, `orderBy`
 * and `limit`. `ignoreSeek` drops the cursor term, the way a reader that does
 * not apply it would: every page is the first page again.
 */
function pagedData(rows: Row[], opts: { ignoreSeek?: boolean } = {}) {
    const queries: Array<{ where: unknown; orderBy: unknown; limit: unknown }> = [];
    return {
        queries,
        engine: {
            async find(_object: string, query: any) {
                queries.push({ where: query?.where, orderBy: query?.orderBy, limit: query?.limit });
                let where = query?.where;
                if (opts.ignoreSeek && where?.$and) where = where.$and[0];
                const hits = rows.filter((r) => matches(r, where));
                if (Array.isArray(query?.orderBy) && query.orderBy[0]?.field === 'id') {
                    hits.sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
                }
                return typeof query?.limit === 'number' ? hits.slice(0, query.limit) : hits;
            },
            async findOne(object: string, query?: EngineFindOneQueryInput) {
                assertEngineFindOnePredicate(object, query);
                return null;
            },
            async insert(_o: string, r: any) { return { id: 'x', ...r }; },
            async update(_o: string, d: any, options?: any) {
                assertEngineUpdateDispatch(d, options);
                return {};
            },
            async delete(_o: string, options?: any) {
                assertEngineDeleteDispatch(options);
                return {};
            },
            async count() { return 0; },
            async aggregate() { return []; },
        } as any,
    };
}

function recordingLogger() {
    const warns: string[] = [];
    return { warns, logger: { info: () => {}, warn: (m: unknown) => warns.push(String(m)), error: () => {} } };
}

/**
 * Five other people's rows for `task.assigned` whose ids sort BEFORE the
 * recipient's own email mute, so with pages of two the mute is on page three.
 */
function crowdedTopic(): Row[] {
    const others = [1, 2, 3, 4, 5].map((n) => ({
        id: `p0${n}`, organization_id: 'org_a', user_id: `other${n}`, topic: 'task.assigned', channel: 'email', enabled: false,
    }));
    return [
        ...others,
        { id: 'p09', organization_id: 'org_a', user_id: 'u1', topic: 'task.assigned', channel: 'email', enabled: false },
    ];
}

describe('PreferenceResolver.filter reads every page of the preference rows', () => {
    it('finds a recipient’s own row past the first page', async () => {
        const rows = crowdedTopic();
        const data = pagedData(rows);
        const log = recordingLogger();
        const r = new PreferenceResolver({ getData: () => data.engine, logger: log.logger });
        setPreferencePageSizeForTests(r, 2);

        const out = await r.filter(['u1'], ['inbox', 'email'], { topic: 'task.assigned', organizationId: 'org_a' });

        expect(out).toEqual([{ recipient: 'u1', channels: ['inbox'] }]);
        expect(log.warns).toEqual([]);
        const topicReads = data.queries.filter((q) => JSON.stringify(q.where).includes('task.assigned'));
        // The premise of the pin: the first page alone does not hold the mute.
        const first = await data.engine.find('sys_notification_preference', {
            where: { organization_id: 'org_a', topic: 'task.assigned' }, orderBy: [{ field: 'id', order: 'asc' }], limit: 2,
        });
        expect(first.map((row: Row) => row.id)).not.toContain('p09');
        // Page by page, seeking past the last id: 2 + 2 + 2 rows, then the
        // short (empty) page ends the walk; the `*` topic is one empty page.
        expect(topicReads.map((q) => q.limit)).toEqual([2, 2, 2, 2]);
        expect(topicReads[1].where).toEqual({ $and: [{ organization_id: 'org_a', topic: 'task.assigned' }, { id: { $gt: 'p02' } }] });
        expect(data.queries.every((q) => JSON.stringify(q.orderBy) === JSON.stringify([{ field: 'id', order: 'asc' }]))).toBe(true);
    });

    it('reads in pages of PREFERENCE_PAGE_SIZE by default, never one capped read', async () => {
        const data = pagedData([]);
        const r = new PreferenceResolver({ getData: () => data.engine, logger: recordingLogger().logger });
        await r.filter(['u1'], ['inbox'], { topic: 'task.assigned', organizationId: 'org_a' });
        expect(data.queries.map((q) => q.limit)).toEqual([PREFERENCE_PAGE_SIZE, PREFERENCE_PAGE_SIZE]);
    });

    it('a walk that cannot advance is refused, and filter fails open loudly instead of filtering on a partial set', async () => {
        const data = pagedData(crowdedTopic(), { ignoreSeek: true });
        const log = recordingLogger();
        const r = new PreferenceResolver({ getData: () => data.engine, logger: log.logger });
        setPreferencePageSizeForTests(r, 2);

        const out = await r.filter(['u1'], ['inbox', 'email'], { topic: 'task.assigned', organizationId: 'org_a' });

        // Fail-open (the resolver's own rule for a failed lookup): every channel kept, and said.
        expect(out).toEqual([{ recipient: 'u1', channels: ['inbox', 'email'] }]);
        expect(log.warns).toHaveLength(1);
        expect(log.warns[0]).toContain("topic 'task.assigned'");
        // The walk stopped on the repeated page rather than spinning.
        expect(data.queries.filter((q) => JSON.stringify(q.where).includes('task.assigned')).length).toBe(2);
    });
});

// ── The real driver ────────────────────────────────────────────────────────

const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };
const SYS_USER = { name: 'sys_user', label: 'User', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' }, email: { type: 'text', label: 'Email' } } };
const silent: any = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };
const PREF = 'sys_notification_preference';
const SYSTEM = { context: { isSystem: true } as ExecutionContext };
const sys = (organization: string) => ({ context: { isSystem: true, tenantId: organization } as ExecutionContext });

let dir: string | undefined;
let ql: ObjectQL | undefined;

afterEach(async () => {
    try { await ql?.destroy(); } catch { /* noop */ }
    ql = undefined;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
});

async function boot(): Promise<ObjectQL> {
    dir = mkdtempSync(join(tmpdir(), 'os-35136-'));
    const engine = new ObjectQL({ logger: silent });
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'store.db') }, useNullAsDefault: true }), true);
    await engine.init();
    for (const def of [SYS_ORGANIZATION, SYS_USER, NotificationPreference]) {
        engine.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await engine.syncSchemas();
    engine.setTenancyPostureProvider(() => 'isolated');
    for (const id of ['org_a', 'org_b']) await engine.insert('sys_organization', { id, name: id }, SYSTEM);
    ql = engine;
    return engine;
}

describe('on a real SqlDriver database', () => {
    it('a recipient’s own mute and the organization default are found across pages; another organization’s row is not read', async () => {
        const engine = await boot();
        const users = ['u1', 'other1', 'other2', 'other3', 'other4', 'other5'];
        for (const id of users) await engine.insert('sys_user', { id, name: id, email: `${id}@example.test` }, SYSTEM);
        for (const row of crowdedTopic()) {
            const { organization_id: organization, ...rest } = row;
            await engine.insert(PREF, rest, sys(String(organization)));
        }
        // The organization's default turns inbox off for every topic; in
        // org_b, u1 turned email back ON — a row this read must never see.
        await engine.insert(PREF, { id: 'p20', topic: '*', channel: 'inbox', enabled: false }, sys('org_a'));
        await engine.insert(PREF, { id: 'p30', user_id: 'u1', topic: 'task.assigned', channel: 'email', enabled: true }, sys('org_b'));

        const log = recordingLogger();
        const r = new PreferenceResolver({ getData: () => engine as any, logger: log.logger });
        setPreferencePageSizeForTests(r, 2);
        const out = await r.filter(['u1'], ['inbox', 'email', 'sms'], { topic: 'task.assigned', organizationId: 'org_a' });

        expect(log.warns).toEqual([]);
        expect(out).toEqual([{ recipient: 'u1', channels: ['sms'] }]);
    });
});
