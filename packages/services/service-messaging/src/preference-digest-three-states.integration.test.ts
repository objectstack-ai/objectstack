// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ruling 7073270426 on #35123] `sys_notification_preference.digest` is three
 * states in STORAGE, on a real `ObjectQL` / `SqlDriver` (better-sqlite3) file
 * database that an earlier release created:
 *
 *  - an insert that leaves the digest unset stores it empty, even where the
 *    column still carries the old physical DEFAULT 'none' (the temporary
 *    owner-side hook, `preference-digest-unset.ts`, until #36245);
 *  - the legacy `none` nobody chose becomes empty ONCE, across every
 *    organization, recorded in `sys_migration`; a `none` written after that
 *    survives every later boot (`preference-digest-conversion.ts`).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMigration } from '@objectstack/platform-objects/system';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { NotificationPreference } from './objects/notification-preference.object.js';
import { bindPreferenceDigestUnset } from './preference-digest-unset.js';
import { convertLegacyNoneDigestsOnce, PREFERENCE_DIGEST_NONE_CONVERSION_ID } from './preference-digest-conversion.js';

const SYS_ORGANIZATION = { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } };
const SYS_USER = { name: 'sys_user', label: 'User', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' }, email: { type: 'text', label: 'Email' } } };
const silent: any = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };
const PREF = 'sys_notification_preference';
const sys = (organization: string) => ({ context: { isSystem: true, tenantId: organization } as ExecutionContext });

/**
 * The object as an earlier release declared it: `digest` with
 * `defaultValue: 'none'`. Booting it first leaves the physical column
 * DEFAULT 'none' the SQL driver never retrofits.
 */
const LEGACY_PREFERENCE = {
    ...NotificationPreference,
    fields: { ...NotificationPreference.fields, digest: { ...(NotificationPreference.fields as any).digest, defaultValue: 'none' } },
};

let dir: string | undefined;
const open: ObjectQL[] = [];

afterEach(async () => {
    for (const ql of open.splice(0)) {
        try { await ql.destroy(); } catch { /* noop */ }
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
});

function dbFile(): string {
    dir = mkdtempSync(join(tmpdir(), 'os-35123-'));
    return join(dir, 'store.db');
}

async function boot(file: string, preference: unknown, opts: { seed?: boolean; hook?: boolean } = {}): Promise<ObjectQL> {
    const ql = new ObjectQL({ logger: silent });
    ql.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true }), true);
    await ql.init();
    for (const def of [SYS_ORGANIZATION, SYS_USER, SysMigration, preference]) {
        ql.registry.registerObject(def as any, '@objectstack/service-messaging');
    }
    await ql.syncSchemas();
    ql.setTenancyPostureProvider(() => 'isolated');
    if (opts.hook) expect(bindPreferenceDigestUnset(ql as never)).toBe(true);
    if (opts.seed) {
        for (const id of ['org_a', 'org_b']) await ql.insert('sys_organization', { id, name: id }, { context: { isSystem: true } as ExecutionContext });
        for (const id of ['u1', 'u2']) await ql.insert('sys_user', { id, name: id, email: `${id}@example.test` }, { context: { isSystem: true } as ExecutionContext });
    }
    open.push(ql);
    return ql;
}

async function close(ql: ObjectQL): Promise<void> {
    open.splice(open.indexOf(ql), 1);
    await ql.destroy();
}

async function digestOf(ql: ObjectQL, organization: string, id: string): Promise<unknown> {
    const rows = await ql.find(PREF, { where: { id } }, sys(organization));
    expect(rows).toHaveLength(1);
    return rows[0].digest;
}

async function insert(ql: ObjectQL, organization: string, row: Record<string, unknown>): Promise<string> {
    return String((await ql.insert(PREF, row, sys(organization))).id);
}

describe('an upgraded database: the digest column still carries the physical DEFAULT none', () => {
    it('an insert that leaves the digest unset stores it empty, an explicit none stays none', async () => {
        const file = dbFile();
        const legacy = await boot(file, LEGACY_PREFERENCE, { seed: true });
        const before = await insert(legacy, 'org_a', { user_id: 'u1', topic: 'legacy', channel: '*', enabled: true });
        // The premise: the earlier release stored `none` for a digest nobody set.
        expect(await digestOf(legacy, 'org_a', before)).toBe('none');
        await close(legacy);

        const ql = await boot(file, NotificationPreference, { hook: true });
        const unset = await insert(ql, 'org_a', { user_id: 'u1', topic: '*', channel: '*', enabled: true, quiet_hours: { start: '22:00', end: '07:00' } });
        const chosen = await insert(ql, 'org_a', { user_id: 'u1', topic: 'chosen', channel: '*', enabled: true, digest: 'none' });
        expect(await digestOf(ql, 'org_a', unset)).toBeNull();
        expect(await digestOf(ql, 'org_a', chosen)).toBe('none');
    });
});

describe('the one-time conversion of the legacy none', () => {
    it('rewrites every organization’s legacy none to empty, once, and records itself', async () => {
        const file = dbFile();
        const legacy = await boot(file, LEGACY_PREFERENCE, { seed: true });
        const inA = await insert(legacy, 'org_a', { user_id: 'u1', topic: '*', channel: '*', enabled: true });
        const inB = await insert(legacy, 'org_b', { user_id: 'u2', topic: '*', channel: '*', enabled: true });
        const orgDefaultB = await insert(legacy, 'org_b', { topic: '*', channel: '*', enabled: true });
        const daily = await insert(legacy, 'org_a', { topic: '*', channel: '*', enabled: true, digest: 'daily' });
        await close(legacy);

        const ql = await boot(file, NotificationPreference, { hook: true });
        const errors: unknown[] = [];
        const out = await convertLegacyNoneDigestsOnce(ql as never, { ...silent, error: (m: string, _e?: Error, meta?: unknown) => errors.push([m, meta]) });
        expect(errors).toEqual([]);
        expect(out).toEqual({ status: 'converted', converted: 3, failed: [] });
        expect(await digestOf(ql, 'org_a', inA)).toBeNull();
        expect(await digestOf(ql, 'org_b', inB)).toBeNull();
        expect(await digestOf(ql, 'org_b', orgDefaultB)).toBeNull();
        expect(await digestOf(ql, 'org_a', daily)).toBe('daily');
        const ledger = await ql.findOne('sys_migration', { where: { id: PREFERENCE_DIGEST_NONE_CONVERSION_ID } }, { context: { isSystem: true } as ExecutionContext });
        expect(ledger?.id).toBe(PREFERENCE_DIGEST_NONE_CONVERSION_ID);
        expect(JSON.parse(String(ledger?.details))).toEqual({ status: 'converted', converted: 3, failed: [] });
    });

    it('a none written after the conversion is still none after a second boot', async () => {
        const file = dbFile();
        const legacy = await boot(file, LEGACY_PREFERENCE, { seed: true });
        const row = await insert(legacy, 'org_a', { user_id: 'u1', topic: '*', channel: '*', enabled: true });
        await close(legacy);

        const first = await boot(file, NotificationPreference, { hook: true });
        expect((await convertLegacyNoneDigestsOnce(first as never, silent)).status).toBe('converted');
        expect(await digestOf(first, 'org_a', row)).toBeNull();
        // The member now chooses "No digest" for real.
        await first.update(PREF, { digest: 'none' }, { where: { id: row }, ...sys('org_a') } as never);
        const fresh = await insert(first, 'org_a', { user_id: 'u2', topic: '*', channel: '*', enabled: true, digest: 'none' });
        await close(first);

        const second = await boot(file, NotificationPreference, { hook: true });
        expect(await convertLegacyNoneDigestsOnce(second as never, silent)).toEqual({ status: 'already-run', converted: 0, failed: [] });
        expect(await digestOf(second, 'org_a', row)).toBe('none');
        expect(await digestOf(second, 'org_a', fresh)).toBe('none');
    });

    it('without a ledger on the kernel it does not run, so nothing it cannot record is rewritten', async () => {
        const writes: string[] = [];
        const engine = {
            getObject: () => undefined,
            find: async () => [{ id: 'r1' }],
            findOne: async () => null,
            insert: async () => { writes.push('insert'); return {}; },
            update: async () => { writes.push('update'); return {}; },
        };
        const out = await convertLegacyNoneDigestsOnce(engine as never, silent);
        expect(out.status).toBe('ledger-unavailable');
        expect(writes).toEqual([]);
    });
});
