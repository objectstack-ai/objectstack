// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 C8 stage 8b; #24582] `sys_secret` and `sys_flow_credential` are
 * deployment-level: both declare `systemFields: { tenant: false }`, so neither
 * carries an organization column and the engine's walled system-insert rule
 * (`Engine.resolveSystemInsertOrganization`) has no tenant field to stamp or
 * refuse on. Step 4 kept their organization-less inserts landing under a wall
 * through a temporary bridge list; the flips retired it (epic ruling record
 * 6270035914 on #15194, item 2).
 *
 * Pinned here, on a real engine over SQLite: saving a flow that carries a
 * credential writes its `sys_flow_credential` row and, through the engine's
 * secret field, its `sys_secret` ciphertext — both organization-less, both
 * landing under `isolated` and `group`, with no bridge. If either table took a
 * tenant column back, both writes would be refused with
 * `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';

import { FLOW_CREDENTIAL_OBJECT, FlowCredentialChannel } from './flow-credential-channel.js';
import { SysFlowCredential } from './sys-flow-credential.object.js';

const SYSTEM = { isSystem: true } as const;
const HOOK = 'pin-bridge-hook-41d7';

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

const engines: ObjectQL[] = [];
afterEach(async () => {
    for (const e of engines.splice(0)) {
        try { await (e as any).destroy?.(); } catch { /* noop */ }
    }
});

async function boot(posture: 'isolated' | 'group'): Promise<ObjectQL> {
    const ql = new ObjectQL();
    engines.push(ql);
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    await ql.init();
    ql.setTenancyPostureProvider(() => posture);
    (ql as any).registry.registerObject(SysSecret as never, 'test');
    (ql as any).registry.registerObject(SysFlowCredential as never, 'test');
    await ql.syncSchemas();
    ql.setCryptoProvider(fakeCrypto());
    return ql;
}

/** An inbound flow whose start node carries one credential. */
function inbound() {
    return {
        name: 'pin_bridge',
        label: 'Pin bridge',
        type: 'api',
        nodes: [
            { id: 'begin', type: 'start', label: 'Start', config: { triggerType: 'api', hookId: 'h1', secret: HOOK } },
            { id: 'finish', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'begin', target: 'finish' }],
    };
}

describe('[C8 stage 8b] a flow credential saved under a wall', () => {
    it.each(['isolated', 'group'] as const)(
        '%s: the organization-less sys_flow_credential row and its sys_secret ciphertext land',
        async (posture) => {
            const ql = await boot(posture);
            for (const object of [SysSecret, SysFlowCredential] as any[]) expect(object.systemFields?.tenant, object.name).toBe(false);
            await new FlowCredentialChannel(() => ql as never).store({ name: 'pin_bridge', state: 'active', body: inbound() });

            const credentials = (await ql.find(FLOW_CREDENTIAL_OBJECT, { context: SYSTEM } as never)) as any[];
            expect(credentials).toHaveLength(1);
            expect(credentials[0].organization_id ?? null).toBeNull();
            const secrets = (await ql.find('sys_secret', { context: SYSTEM } as never)) as any[];
            expect(secrets.length).toBeGreaterThan(0);
            for (const row of secrets) expect(row.organization_id ?? null).toBeNull();
        },
    );
});
