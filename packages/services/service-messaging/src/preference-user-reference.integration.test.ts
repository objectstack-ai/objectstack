// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_notification_preference.user_id` is a `sys_user` reference, and the
 * admin-global default is the EMPTY reference (ADR-0118 D1: no sentinel in a
 * user column). Maintainer ruling A, with the seat call's execution parameters
 * (the boot conversion, the runtime NULL-safe index, `cascade`).
 *
 * Pinned on a real `ObjectQL` over `SqlDriver` (better-sqlite3) with the real
 * `sys_user`, and, for the index, the real `kernel:ready` arming in
 * `metadata-protocol`'s `assembleMetadataProtocol`:
 *
 *  1. the write door refuses `'*'` and any id no user holds — `400
 *     VALIDATION_FAILED`, `reference_not_found` on `user_id` — where the text
 *     column stored both to match nobody; a real user and the empty reference
 *     are accepted;
 *  2. the record title names the person (email where the name is blank), the
 *     empty reference reads 'All users', and an id that resolves to nobody
 *     leaves the title null rather than reading as 'All users';
 *  3. deleting a user deletes their rows (`cascade`): the lookup default
 *     `set_null` would turn a person's own mute into the mute for everyone;
 *  4. the boot conversion rewrites every stored `'*'` to the empty reference
 *     across organizations, twice over is a no-op, and a `'*'` row whose key
 *     already has a global default is kept and reported, never discarded;
 *  5. on the SQL driver, once the platform migrations run, a second global
 *     default for one (organization, topic, channel) is refused `409`; before
 *     them the declared index admits it (the control). driver-memory keys the
 *     listed columns and stays NULL-distinct, as for `sys_setting`.
 *  6. the resolver applies a converted default, and ignores an unconverted one.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysUser } from '@objectstack/platform-objects';
import { assembleMetadataProtocol } from '@objectstack/metadata-protocol';
import { mapDataError } from '@objectstack/types';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { NotificationPreference } from './objects/notification-preference.object.js';
import { PreferenceResolver, PREFERENCE_OBJECT } from './preference-resolver.js';
import { convertWildcardPreferenceUsers, LEGACY_WILDCARD_USER } from './preference-user-conversion.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const OTHER_ORG = 'org_yi';
/**
 * A system write names its organization: with two organizations on the
 * install, an organization-less system write is refused (ADR-0131 D9).
 */
const SYS = { context: { isSystem: true, tenantId: DEFAULT_ORGANIZATION_ID } } as any;
/** A system read across every organization. */
const SYS_ALL = { context: { isSystem: true } } as any;
/** An admin at the Setup grid: a principal, not the system. */
const ADMIN = { context: { userId: 'usr_admin', tenantId: DEFAULT_ORGANIZATION_ID } as ExecutionContext };

const silent: any = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };

let engine: ObjectQL | undefined;

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
});

async function boot(): Promise<{ ql: ObjectQL; driver: SqlDriver }> {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    const ql = new ObjectQL({ logger: silent });
    ql.registerDriver(driver, true);
    await ql.init();
    ql.registry.registerObject(SysUser as any, '@objectstack/service-messaging');
    ql.registry.registerObject(NotificationPreference as any, '@objectstack/service-messaging');
    await ql.syncSchemas();
    await installDefaultOrganization(ql as any);
    await driver.create('sys_organization', { id: OTHER_ORG, name: 'Yi' });
    engine = ql;
    return { ql, driver };
}

async function user(ql: ObjectQL, name: string, email: string): Promise<string> {
    return String((await ql.insert('sys_user', { name, email }, SYS)).id);
}

/** The thrown write, and the status the REST data door answers it with. */
async function refusal(write: Promise<unknown>): Promise<{ error: any; status: number }> {
    try {
        await write;
    } catch (error) {
        return { error, status: mapDataError(error).status };
    }
    throw new Error('the write was accepted; a refusal was expected');
}

async function storedRows(ql: ObjectQL): Promise<Array<Record<string, unknown>>> {
    const rows = await ql.find(PREFERENCE_OBJECT, { fields: ['id', 'organization_id', 'user_id', 'topic', 'channel', 'enabled'] }, SYS_ALL);
    return (rows ?? [])
        .map((r: any) => ({ id: r.id, organization_id: r.organization_id, user_id: r.user_id ?? null, topic: r.topic, channel: r.channel, enabled: r.enabled }))
        .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
}

/** A row as the text column left it, written straight through the driver. */
async function storedRow(driver: SqlDriver, id: string, over: Record<string, unknown>): Promise<void> {
    await driver.create(PREFERENCE_OBJECT, {
        id, organization_id: DEFAULT_ORGANIZATION_ID, topic: 'deal.won', channel: 'email', enabled: false, ...over,
    });
}

describe('the declaration', () => {
    it('user_id is an optional sys_user lookup that cascades, with no width of its own', () => {
        const field = (NotificationPreference as any).fields.user_id;
        expect(field.type).toBe('lookup');
        expect(field.reference).toBe('sys_user');
        expect(field.required).toBe(false);
        expect(field.deleteBehavior).toBe('cascade');
        expect(field.maxLength).toBeUndefined();
    });
});

describe('the write door refuses an id no user holds', () => {
    it("'*' and a mistyped id are refused 400 VALIDATION_FAILED, reference_not_found on user_id", async () => {
        const { ql } = await boot();
        for (const value of [LEGACY_WILDCARD_USER, 'usr_nobody']) {
            const { error, status } = await refusal(ql.insert(PREFERENCE_OBJECT, { user_id: value, topic: 'deal.won', channel: 'email' }, ADMIN));
            expect(error.code, value).toBe('VALIDATION_FAILED');
            expect(status, value).toBe(400);
            expect(error.fields, value).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'user_id', code: 'reference_not_found' })]));
        }
        expect(await storedRows(ql)).toEqual([]);
    });

    it("an update moving a row to '*' is refused the same way, and the row is left as stored", async () => {
        const { ql } = await boot();
        const ann = await user(ql, 'Ann', 'ann@example.com');
        const row = await ql.insert(PREFERENCE_OBJECT, { user_id: ann, topic: 'deal.won', channel: 'email' }, ADMIN);
        const { error, status } = await refusal(ql.update(PREFERENCE_OBJECT, { user_id: LEGACY_WILDCARD_USER }, { where: { id: row.id }, ...ADMIN } as any));
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(status).toBe(400);
        expect((await storedRows(ql))[0]!.user_id).toBe(ann);
    });

    it('a real user and the empty reference are accepted', async () => {
        const { ql } = await boot();
        const ann = await user(ql, 'Ann', 'ann@example.com');
        await ql.insert(PREFERENCE_OBJECT, { user_id: ann, topic: 'deal.won', channel: 'email' }, ADMIN);
        await ql.insert(PREFERENCE_OBJECT, { topic: 'deal.won', channel: 'email' }, ADMIN);
        expect((await storedRows(ql)).map((r) => r.user_id).sort()).toEqual([ann, null].sort());
    });
});

describe('the record title names the person', () => {
    it('name; email where the name is blank; All users for the empty reference; null for an id nobody holds', async () => {
        const { ql, driver } = await boot();
        const bea = await user(ql, 'Bea Person', 'bea@example.com');
        const blank = await user(ql, 'Placeholder', 'no-name@example.com');
        await driver.getKnex()('sys_user').where({ id: blank }).update({ name: '  ' });

        const title = async (id: string) => (await ql.findOne(PREFERENCE_OBJECT, { where: { id } }, SYS))!.display_title;
        const person = await ql.insert(PREFERENCE_OBJECT, { user_id: bea, topic: 'deal.won', channel: 'inbox' }, SYS);
        const nameless = await ql.insert(PREFERENCE_OBJECT, { user_id: blank, topic: 'deal.won', channel: 'inbox' }, SYS);
        const everyone = await ql.insert(PREFERENCE_OBJECT, { topic: 'deal.won', channel: 'inbox' }, SYS);
        const defaulted = await ql.insert(PREFERENCE_OBJECT, { channel: 'email' }, SYS);
        // The system may write past the reference check; an id that resolves to
        // nobody must not be titled as the global default.
        const gone = await ql.insert(PREFERENCE_OBJECT, { user_id: 'usr_gone', topic: 'deal.lost', channel: 'inbox' }, SYS);

        expect(person.display_title).toBe('Bea Person · deal.won · inbox');
        expect(await title(person.id)).toBe('Bea Person · deal.won · inbox');
        expect(await title(person.id)).not.toContain(bea);
        expect(await title(nameless.id)).toBe('no-name@example.com · deal.won · inbox');
        expect(await title(everyone.id)).toBe('All users · deal.won · inbox');
        expect(await title(defaulted.id)).toBe('All users · * · email');
        expect(await title(gone.id)).toBeNull();
    });
});

describe('deleting a user deletes their preferences (cascade)', () => {
    it("the person's own mute goes with them and never becomes the default for everyone", async () => {
        const { ql } = await boot();
        const eve = await user(ql, 'Eve', 'eve@example.com');
        await ql.insert(PREFERENCE_OBJECT, { user_id: eve, topic: 'deal.won', channel: 'sms', enabled: false }, SYS);
        await ql.insert(PREFERENCE_OBJECT, { topic: 'deal.lost', channel: 'sms', enabled: true }, SYS);

        await ql.delete('sys_user', { where: { id: eve }, context: { isSystem: true } } as any);

        const rows = await storedRows(ql);
        expect(rows.map((r) => [r.user_id, r.topic])).toEqual([[null, 'deal.lost']]);
        // No global default for the deleted person's topic was created.
        expect(rows.filter((r) => r.topic === 'deal.won')).toEqual([]);
    });
});

describe("the boot conversion: stored '*' → the empty reference", () => {
    it('rewrites every organization\'s rows, leaves real users alone, and a second run changes nothing', async () => {
        const { ql, driver } = await boot();
        const ann = await user(ql, 'Ann', 'ann@example.com');
        await storedRow(driver, 'p_jia', { user_id: LEGACY_WILDCARD_USER });
        await storedRow(driver, 'p_yi', { user_id: LEGACY_WILDCARD_USER, organization_id: OTHER_ORG });
        await storedRow(driver, 'p_ann', { user_id: ann });
        const logger = { info: vi.fn(), error: vi.fn() };

        const first = await convertWildcardPreferenceUsers(ql as any, logger);
        expect(first).toEqual({ status: 'converted', converted: 2, missed: [] });
        const after = await storedRows(ql);
        expect(after.map((r) => [r.id, r.organization_id, r.user_id])).toEqual([
            ['p_ann', DEFAULT_ORGANIZATION_ID, ann],
            ['p_jia', DEFAULT_ORGANIZATION_ID, null],
            ['p_yi', OTHER_ORG, null],
        ]);
        expect(logger.info).toHaveBeenCalledTimes(1);
        expect(logger.error).not.toHaveBeenCalled();

        const second = await convertWildcardPreferenceUsers(ql as any, logger);
        expect(second).toEqual({ status: 'nothing-to-convert', converted: 0, missed: [] });
        expect(await storedRows(ql)).toEqual(after);
        expect(logger.info).toHaveBeenCalledTimes(1);
    });

    it('a database with no such table yet is "absent", silently', async () => {
        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
        const ql = new ObjectQL({ logger: silent });
        ql.registerDriver(driver, true);
        await ql.init();
        ql.registry.registerObject(NotificationPreference as any, '@objectstack/service-messaging');
        engine = ql;
        const logger = { info: vi.fn(), error: vi.fn() };
        expect(await convertWildcardPreferenceUsers(ql as any, logger)).toEqual({ status: 'absent', converted: 0, missed: [] });
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("no engine, or one that cannot read and write rows: 'no-engine'", async () => {
        expect((await convertWildcardPreferenceUsers(undefined)).status).toBe('no-engine');
        expect((await convertWildcardPreferenceUsers({ syncObjectSchema: async () => {} } as any)).status).toBe('no-engine');
    });
});

/** Run the real `kernel:ready` platform migrations `metadata-protocol` arms. */
async function runPlatformMigrations(ql: ObjectQL): Promise<void> {
    const hooks: Array<() => unknown> = [];
    const ctx = {
        logger: silent,
        registerService: () => {},
        getService: () => { throw new Error('not registered'); },
        getServices: () => new Map(),
        hook: (name: string, handler: () => unknown) => {
            if (name === 'kernel:ready') hooks.push(handler);
        },
    } as any;
    assembleMetadataProtocol(ctx, ql as any, undefined, { runPlatformMigrations: true });
    for (const handler of hooks) await handler();
}

describe('one admin-global default per (organization, topic, channel) on the SQL driver', () => {
    it('CONTROL — before the platform migrations, the declared index admits a second global default', async () => {
        const { ql } = await boot();
        await ql.insert(PREFERENCE_OBJECT, { topic: 'deal.won', channel: 'email', enabled: false }, SYS);
        await ql.insert(PREFERENCE_OBJECT, { topic: 'deal.won', channel: 'email', enabled: true }, SYS);
        expect((await storedRows(ql)).filter((r) => r.user_id === null)).toHaveLength(2);
    });

    it('after them, a second global default is refused 409, in the same organization only', async () => {
        const { ql, driver } = await boot();
        await runPlatformMigrations(ql);
        const ddl = await driver.getKnex().raw(
            "SELECT sql FROM sqlite_master WHERE type='index' AND name='uniq_sys_notification_preference_a22d7d27'",
        );
        expect(String(ddl[0]?.sql)).toContain("COALESCE(user_id, '')");

        await ql.insert(PREFERENCE_OBJECT, { topic: 'deal.won', channel: 'email', enabled: false }, SYS);
        const { error, status } = await refusal(ql.insert(PREFERENCE_OBJECT, { topic: 'deal.won', channel: 'email', enabled: true }, SYS));
        expect(error.code).toBe('DUPLICATE_RECORD');
        expect(status).toBe(409);
        // Anti-vacuity: the key is per organization, topic and channel, and a
        // person's own row is a different key.
        const ann = await user(ql, 'Ann', 'ann@example.com');
        await ql.insert(PREFERENCE_OBJECT, { topic: 'deal.won', channel: 'inbox' }, SYS);
        await ql.insert(PREFERENCE_OBJECT, { user_id: ann, topic: 'deal.won', channel: 'email' }, SYS);
        await driver.create(PREFERENCE_OBJECT, { id: 'p_yi', organization_id: OTHER_ORG, topic: 'deal.won', channel: 'email', enabled: false });
        expect(await storedRows(ql)).toHaveLength(4);
    });

    it("a '*' row whose key already has a global default is kept as stored and reported once at error — never discarded", async () => {
        const { ql, driver } = await boot();
        await runPlatformMigrations(ql);
        await ql.insert(PREFERENCE_OBJECT, { topic: 'deal.won', channel: 'email', enabled: true }, SYS);
        await storedRow(driver, 'p_star', { user_id: LEGACY_WILDCARD_USER });
        const logger = { info: vi.fn(), error: vi.fn() };

        const result = await convertWildcardPreferenceUsers(ql as any, logger);

        expect(result.status).toBe('failed');
        expect(result.converted).toBe(0);
        expect(result.missed).toEqual([expect.objectContaining({ id: 'p_star', reason: 'duplicate', topic: 'deal.won', channel: 'email' })]);
        expect((await storedRows(ql)).find((r) => r.id === 'p_star')!.user_id).toBe(LEGACY_WILDCARD_USER);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(String(logger.error.mock.calls[0]![0])).toContain('p_star');
    });
});

describe('the resolver applies a converted default, and ignores an unconverted one', () => {
    it("a stored '*' mute stops nobody until the conversion runs; afterwards it mutes every user", async () => {
        const { ql, driver } = await boot();
        const resolver = new PreferenceResolver({ getData: () => ql as any, logger: silent });
        await storedRow(driver, 'p_star', { user_id: LEGACY_WILDCARD_USER, topic: 'deal.won', channel: 'email', enabled: false });
        const ctx = { topic: 'deal.won', organizationId: DEFAULT_ORGANIZATION_ID };

        expect(await resolver.filter(['u1', 'u2'], ['inbox', 'email'], ctx)).toEqual([
            { recipient: 'u1', channels: ['inbox', 'email'] },
            { recipient: 'u2', channels: ['inbox', 'email'] },
        ]);

        await convertWildcardPreferenceUsers(ql as any);

        expect(await resolver.filter(['u1', 'u2'], ['inbox', 'email'], ctx)).toEqual([
            { recipient: 'u1', channels: ['inbox'] },
            { recipient: 'u2', channels: ['inbox'] },
        ]);
    });
});
