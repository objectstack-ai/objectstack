// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D7 · ruling record 6259141885, Q1 A] `sys_flow_credential` is
 * deployment-level — the 18.x line's EXPAND step, on a real ObjectQL engine
 * over SQLite.
 *
 * The rig runs the `single` posture with one organization, as an 18.0 install
 * does, so the engine's ADR-0131 D9 stamp is live: the control shows it
 * stamping an organization-less system insert into a tenant-column object. The
 * same engine writes the channel's rows — and the `sys_secret` rows their
 * `value` field mints — with no organization, so that absence is the objects'
 * declarations, not a rig that stamps nothing.
 *
 * The dual read: an 18.0 install stamped both rows with the Default
 * Organization. Rows of that shape, written below with the 18.0 columns, are
 * still the channel's: indexed, resolved to their plaintext, and left as they
 * are — re-stamping, clearing or moving them is the upgrade ceremony's.
 *
 * Every value is a probe sentinel, not a credential.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';

import { FLOW_CREDENTIAL_OBJECT, FlowCredentialChannel } from './flow-credential-channel.js';
import { SysFlowCredential } from './sys-flow-credential.object.js';

const DEFAULT_ORG = 'org_default';
const HOOK = 'pin-expand-hook-41d7';
const SIGN = 'pin-expand-sign-9b03';
const LEGACY = 'pin-expand-legacy-c51e';
const SYSTEM = { isSystem: true } as const;

/** Reversible stand-in cipher — the seam's behaviour is the engine's, not the cipher's. */
function fakeCrypto(): ICryptoProvider {
    let n = 0;
    return {
        async encrypt(plain: string, _ctx: CryptoContext): Promise<CryptoHandle> {
            n += 1;
            return { id: `sec_${n}`, kmsKeyId: 'test', alg: 'test-rev', version: 1, ciphertext: [...plain].reverse().join('') };
        },
        async decrypt(handle: CryptoHandle): Promise<string> {
            return [...handle.ciphertext].reverse().join('');
        },
        async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> {
            return { ...handle, version: handle.version + 1 };
        },
        digest: (plain: string) => `d:${plain.length}`,
        keyedDigest: async (plain: string) => `k:${plain.length}`,
    };
}

/** The minimal organization object the engine's D9 probe asks for. */
const ORG_OBJECT = { name: 'sys_organization', fields: { name: { type: 'text' } } } as never;
/** A platform object that keeps its injected organization column: the stamp's control. */
const STAMPED_PROBE = { name: 'sys_probe_ledger', fields: { subject: { type: 'text' } } } as never;

const engines: Array<{ ql: ObjectQL; driver: SqlDriver }> = [];
afterEach(async () => {
    for (const { ql } of engines.splice(0)) {
        try { await (ql as any).destroy?.(); } catch { /* noop */ }
    }
});

/**
 * The two tables as an 18.0 install created them on SQLite — its DDL, verbatim
 * in shape: the injected `organization_id` a 255-wide string beside the audit
 * columns, and the same indexes.
 */
const DDL_18_0 = [
    "CREATE TABLE `sys_secret` (`id` varchar(255), `created_at` datetime default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), "
        + "`updated_at` datetime default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), `organization_id` varchar(255), "
        + '`created_by` varchar(255), `updated_by` varchar(255), `rotated_at` datetime, `namespace` varchar(128), '
        + "`key` varchar(128), `kms_key_id` varchar(256), `alg` text default 'aes-256-gcm', `version` float default '1', "
        + '`ciphertext` text, primary key (`id`))',
    'CREATE INDEX `idx_sys_secret_kms_key_id` on `sys_secret` (`kms_key_id`)',
    'CREATE INDEX `idx_sys_secret_namespace_key` on `sys_secret` (`namespace`, `key`)',
    "CREATE TABLE `sys_flow_credential` (`id` varchar(255), `created_at` datetime default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), "
        + "`updated_at` datetime default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), `organization_id` varchar(255), "
        + '`created_by` varchar(255), `updated_by` varchar(255), `flow_name` varchar(255), `state` varchar(255), '
        + '`node_id` text, `credential_key` text, `position` varchar(64), `value` varchar(255), primary key (`id`))',
    'CREATE UNIQUE INDEX `uniq_sys_flow_credential_flow_name_state_position` on `sys_flow_credential` (`flow_name`, `state`, `position`)',
];

/**
 * The real engine over an in-memory SQLite database. `from18` first creates
 * the two tables with the 18.0 DDL and hands the 18.0 rows to `seed18`, so the
 * engine's schema sync meets an 18.0 database, as an upgrade does.
 */
async function boot(
    opts: { from18?: (knex: any) => Promise<void> } = {},
): Promise<{ ql: ObjectQL; driver: SqlDriver }> {
    const ql = new ObjectQL();
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    engines.push({ ql, driver });
    await driver.connect();
    if (opts.from18) {
        const knex = (driver as any).knex;
        for (const statement of DDL_18_0) await knex.raw(statement);
        await opts.from18(knex);
    }
    ql.registerDriver(driver, true);
    await ql.init();
    for (const o of [SysSecret, SysFlowCredential, ORG_OBJECT, STAMPED_PROBE]) {
        (ql as any).registry.registerObject(o as never, 'test');
    }
    await ql.syncSchemas();
    ql.setCryptoProvider(fakeCrypto());
    ql.setTenancyPostureProvider(() => 'single');
    await (driver as any).knex('sys_organization').insert({ id: DEFAULT_ORG, name: 'Default Organization' });
    return { ql, driver };
}

/** The physical rows, read past the engine — what the database holds. */
async function physical(driver: SqlDriver, table: string): Promise<any[]> {
    return (driver as any).knex(table).select('*');
}

/** An inbound flow whose start node holds a hook secret and whose `http` node signs. */
function inbound() {
    return {
        name: 'pin_expand',
        label: 'Pin expand',
        type: 'api',
        nodes: [
            { id: 'begin', type: 'start', label: 'Start', config: { triggerType: 'api', hookId: 'h1', secret: HOOK } },
            { id: 'callout', type: 'http', label: 'Callout', config: { url: 'https://example.invalid/out', method: 'POST', signingSecret: SIGN } },
            { id: 'finish', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'begin', target: 'callout' },
            { id: 'e2', source: 'callout', target: 'finish' },
        ],
    };
}

describe('[18.x expand · Q1 A] sys_flow_credential: the new write shape, under single with the Default Organization', () => {
    it('control: the rig stamps an organization-less system insert into a tenant-column object', async () => {
        const { ql, driver } = await boot();
        await ql.insert('sys_probe_ledger', { subject: 'probe' }, { context: SYSTEM } as never);
        expect(await physical(driver, 'sys_probe_ledger')).toEqual([expect.objectContaining({ organization_id: DEFAULT_ORG })]);
    });

    it('a channel write stores its rows, and the secrets they mint, with no organization', async () => {
        const { ql, driver } = await boot();
        const channel = new FlowCredentialChannel(() => ql as never);
        await channel.store({ name: 'pin_expand', state: 'active', body: inbound() });

        const rows = await physical(driver, FLOW_CREDENTIAL_OBJECT);
        expect(rows).toHaveLength(2);
        for (const row of rows) expect(row.organization_id).toBeNull();
        const secrets = await physical(driver, 'sys_secret');
        expect(secrets).toHaveLength(2);
        for (const secret of secrets) expect(secret.organization_id).toBeNull();

        // The write shape is still the channel's: both positions resolve.
        await channel.loadIndex();
        expect(await channel.resolve('pin_expand', 'begin', 'secret')).toBe(HOOK);
        expect(await channel.resolve('pin_expand', 'callout', 'signingSecret')).toBe(SIGN);
    });
});

describe('[18.x expand · Q1 A] the dual read, on an 18.0 database', () => {
    /** The 18.0 rows: both stamped with the Default Organization, the credential holding a `secret:` ref. */
    const seed18 = async (knex: any) => {
        await knex('sys_secret').insert({
            id: 'sec_18', organization_id: DEFAULT_ORG, namespace: FLOW_CREDENTIAL_OBJECT, key: 'value',
            kms_key_id: 'test', alg: 'test-rev', version: 1, ciphertext: [...LEGACY].reverse().join(''),
        });
        await knex(FLOW_CREDENTIAL_OBJECT).insert({
            id: 'cred_18', organization_id: DEFAULT_ORG, flow_name: 'pin_legacy', state: 'active', node_id: 'begin',
            credential_key: 'secret', position: 'p'.repeat(64), value: 'secret:sec_18',
        });
    };

    it('the schema sync over the 18.0 tables proposes no drop, and keeps the organization column', async () => {
        const { driver } = await boot({ from18: seed18 });
        for (const table of [FLOW_CREDENTIAL_OBJECT, 'sys_secret']) {
            const columns = Object.keys(await (driver as any).knex(table).columnInfo());
            expect(columns, table).toContain('organization_id');
        }
        const drift = ((await (driver as any).detectManagedDrift()) as any[]).filter(
            (d) => [FLOW_CREDENTIAL_OBJECT, 'sys_secret'].includes(d.table),
        );
        // No entry at all: not the destructive `drop_column` of the column the
        // objects now leave unread, and no type change on it either.
        expect(drift).toEqual([]);
    });

    it('an 18.0 credential and its secret are indexed, resolve, and keep their stamp', async () => {
        const { ql, driver } = await boot({ from18: seed18 });
        const channel = new FlowCredentialChannel(() => ql as never);
        expect(await channel.loadIndex()).toBe(true);
        expect(channel.holds('pin_legacy', 'begin', 'secret')).toBe(true);
        expect(await channel.resolve('pin_legacy', 'begin', 'secret')).toBe(LEGACY);

        // Read, not rewritten: the 18.0 stamps are the ceremony's to drop.
        expect(await physical(driver, FLOW_CREDENTIAL_OBJECT)).toEqual([
            expect.objectContaining({ id: 'cred_18', organization_id: DEFAULT_ORG }),
        ]);
        expect(await physical(driver, 'sys_secret')).toEqual([
            expect.objectContaining({ id: 'sec_18', organization_id: DEFAULT_ORG }),
        ]);
    });

    it('a new credential lands beside the 18.0 one, unstamped, and both resolve', async () => {
        const { ql, driver } = await boot({ from18: seed18 });
        const channel = new FlowCredentialChannel(() => ql as never);
        await channel.store({ name: 'pin_expand', state: 'active', body: inbound() });
        await channel.loadIndex();
        expect(await channel.resolve('pin_legacy', 'begin', 'secret')).toBe(LEGACY);
        expect(await channel.resolve('pin_expand', 'begin', 'secret')).toBe(HOOK);

        const byId = new Map((await physical(driver, FLOW_CREDENTIAL_OBJECT)).map((r) => [r.id, r]));
        expect(byId.get('cred_18')?.organization_id).toBe(DEFAULT_ORG);
        const fresh = [...byId.values()].filter((r) => r.flow_name === 'pin_expand');
        expect(fresh).toHaveLength(2);
        for (const row of fresh) expect(row.organization_id).toBeNull();
    });
});
