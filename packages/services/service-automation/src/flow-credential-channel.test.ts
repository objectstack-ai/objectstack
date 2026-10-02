// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20790] The write-only flow credential channel, on a real ObjectQL engine
 * over SQLite — the #7799 seam it reuses (a `secret`-typed field the engine
 * encrypts, masks and dereferences) is the engine's, so nothing about it is
 * stubbed here.
 *
 * Pinned: a channel write and its masked reads; the per-position write rule
 * (absent keeps, an explicit value rotates, `''` clears, a vanished position
 * is dropped); a draft never touches the live credential until it is
 * promoted; a restore strip writes nothing; and with no crypto provider a
 * save carrying a credential is refused before anything is written.
 *
 * Every value is a probe sentinel, not a credential.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import { SECRET_MASK } from '@objectstack/spec/data';
import type { CryptoContext, CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';

import {
    FLOW_CREDENTIAL_OBJECT,
    FLOW_CREDENTIAL_UNAVAILABLE_CODE,
    FLOW_CREDENTIAL_UNAVAILABLE_STATUS,
    FlowCredentialChannel,
    FlowCredentialChannelRefusal,
    FlowCredentialUnresolvableError,
} from './flow-credential-channel.js';
import { AutomationEngine } from './engine.js';
import type { FlowTriggerBinding } from './engine.js';
import { redactFlowCredentials } from './flow-credential-projection.js';
import { SysFlowCredential } from './sys-flow-credential.object.js';

const HOOK = 'pin-channel-hook-7a1c';
const SIGN = 'pin-channel-sign-3e9b';
const NESTED = 'pin-channel-nested-5d20';
const ROTATED = 'pin-channel-rotated-c4f1';
const DRAFTED = 'pin-channel-drafted-08aa';
const PACKAGED = 'pin-channel-packaged-literal-e2b6';
const ALL = [HOOK, SIGN, NESTED, ROTATED, DRAFTED];
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

const engines: ObjectQL[] = [];
afterEach(async () => {
    for (const e of engines.splice(0)) {
        try { await (e as any).destroy?.(); } catch { /* noop */ }
    }
});

async function boot(withCrypto = true): Promise<ObjectQL> {
    const ql = new ObjectQL();
    engines.push(ql);
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    await ql.init();
    (ql as any).registry.registerObject(SysSecret as never, 'test');
    (ql as any).registry.registerObject(SysFlowCredential as never, 'test');
    await ql.syncSchemas();
    if (withCrypto) ql.setCryptoProvider(fakeCrypto());
    return ql;
}

/** An inbound flow whose `http` node signs — one more inside a loop body. */
function inbound(secrets: { hook?: string; sign?: string; nested?: string } = {}) {
    const startConfig: Record<string, unknown> = { triggerType: 'api', hookId: 'h1' };
    if (secrets.hook !== undefined) startConfig.secret = secrets.hook;
    const signConfig: Record<string, unknown> = { url: 'https://example.invalid/out', method: 'POST' };
    if (secrets.sign !== undefined) signConfig.signingSecret = secrets.sign;
    const nestedConfig: Record<string, unknown> = { url: 'https://example.invalid/each', method: 'POST' };
    if (secrets.nested !== undefined) nestedConfig.signingSecret = secrets.nested;
    return {
        name: 'pin_inbound',
        label: 'Pin inbound',
        type: 'api',
        nodes: [
            { id: 'begin', type: 'start', label: 'Start', config: startConfig },
            { id: 'callout', type: 'http', label: 'Callout', config: signConfig },
            {
                id: 'each',
                type: 'loop',
                label: 'Each',
                config: {
                    collection: '{items}',
                    body: { nodes: [{ id: 'inner_call', type: 'http', label: 'Inner', config: nestedConfig }], edges: [] },
                },
            },
            { id: 'finish', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'begin', target: 'callout' },
            { id: 'e2', source: 'callout', target: 'each' },
            { id: 'e3', source: 'each', target: 'finish' },
        ],
    };
}

async function channelRows(ql: ObjectQL): Promise<any[]> {
    return (await ql.find(FLOW_CREDENTIAL_OBJECT, { context: SYSTEM } as never)) as any[];
}

const startNodeOf = (flow: any) => flow.nodes.find((n: any) => n.type === 'start');
const calloutOf = (flow: any) => flow.nodes.find((n: any) => n.id === 'callout');

describe('[#20790] a channel write, and its masked reads', () => {
    it('moves every credential out of the body, at every depth; stores ciphertext; every read returns the mask', async () => {
        const ql = await boot();
        const channel = new FlowCredentialChannel(() => ql as never);
        const body = inbound({ hook: HOOK, sign: SIGN, nested: NESTED });

        const stored = await channel.store({ name: 'pin_inbound', state: 'active', body });

        // The stored body is exactly what a read serves — no credential in it.
        expect(stored).toEqual(redactFlowCredentials(body).item);
        for (const s of ALL) expect(JSON.stringify(stored)).not.toContain(s);
        // …and the caller's body is untouched (copy-on-write).
        expect(startNodeOf(body).config.secret).toBe(HOOK);

        // One row per position; every engine read masks the value.
        const rows = await channelRows(ql);
        expect(rows.map((r) => `${r.node_id}.${r.credential_key}:${r.state}`).sort()).toEqual([
            'begin.secret:active',
            'callout.signingSecret:active',
            'inner_call.signingSecret:active',
        ]);
        for (const row of rows) expect(row.value).toBe(SECRET_MASK);
        for (const s of ALL) expect(JSON.stringify(rows)).not.toContain(s);
        // The ciphertext is not the cleartext either.
        const ciphers = (await ql.find('sys_secret', { context: SYSTEM } as never)) as any[];
        expect(ciphers).toHaveLength(3);
        for (const s of ALL) expect(JSON.stringify(ciphers)).not.toContain(s);

        // Only the privileged dereference gets the value back.
        expect(channel.holds('pin_inbound', 'begin', 'secret')).toBe(true);
        expect(await channel.resolve('pin_inbound', 'begin', 'secret')).toBe(HOOK);
        expect(await channel.resolve('pin_inbound', 'inner_call', 'signingSecret')).toBe(NESTED);
        expect(await channel.resolve('pin_inbound', 'finish', 'secret')).toBeUndefined();
    });

    it('a fresh channel reads which positions are held back from the store (the boot index)', async () => {
        const ql = await boot();
        await new FlowCredentialChannel(() => ql as never).store({ name: 'pin_inbound', state: 'active', body: inbound({ hook: HOOK }) });
        const fresh = new FlowCredentialChannel(() => ql as never);
        expect(fresh.holds('pin_inbound', 'begin', 'secret')).toBe(false);
        expect(await fresh.loadIndex()).toBe(true);
        expect(fresh.holds('pin_inbound', 'begin', 'secret')).toBe(true);
        expect(fresh.held('pin_inbound')).toEqual([{ nodeId: 'begin', key: 'secret' }]);
    });
});

describe('[#20790] the per-position write rule', () => {
    it('absent keeps; an explicit value rotates; `\'\'` clears; a vanished position is dropped', async () => {
        const ql = await boot();
        const channel = new FlowCredentialChannel(() => ql as never);
        await channel.store({ name: 'pin_inbound', state: 'active', body: inbound({ hook: HOOK, sign: SIGN }) });

        // The served (withheld) form round-trips: nothing changes.
        await channel.store({ name: 'pin_inbound', state: 'active', body: inbound() });
        expect(await channel.resolve('pin_inbound', 'begin', 'secret')).toBe(HOOK);
        expect(await channel.resolve('pin_inbound', 'callout', 'signingSecret')).toBe(SIGN);

        // Only an explicit value rotates.
        await channel.store({ name: 'pin_inbound', state: 'active', body: inbound({ hook: ROTATED }) });
        expect(await channel.resolve('pin_inbound', 'begin', 'secret')).toBe(ROTATED);
        expect(await channel.resolve('pin_inbound', 'callout', 'signingSecret')).toBe(SIGN);

        // The cleared form removes the row and is stored as written.
        const cleared = await channel.store({ name: 'pin_inbound', state: 'active', body: inbound({ sign: '' }) });
        expect(calloutOf(cleared).config.signingSecret).toBe('');
        expect(await channel.resolve('pin_inbound', 'callout', 'signingSecret')).toBeUndefined();
        expect(channel.holds('pin_inbound', 'callout', 'signingSecret')).toBe(false);

        // A node whose kind no longer holds the credential loses its row.
        const retyped: any = inbound();
        startNodeOf(retyped).type = 'decision';
        await channel.store({ name: 'pin_inbound', state: 'active', body: retyped });
        expect(await channel.resolve('pin_inbound', 'begin', 'secret')).toBeUndefined();
        expect(await channelRows(ql)).toEqual([]);
    });

    it('the runtime gate is told where a withheld credential is held — never where one is cleared', async () => {
        const ql = await boot();
        const channel = new FlowCredentialChannel(() => ql as never);
        await channel.store({ name: 'pin_inbound', state: 'active', body: inbound({ hook: HOOK, sign: SIGN }) });

        expect(await channel.heldPaths({ name: 'pin_inbound', state: 'active', item: inbound() })).toEqual([
            'nodes.0.config.secret',
            'nodes.1.config.signingSecret',
        ]);
        expect(await channel.heldPaths({ name: 'pin_inbound', state: 'active', item: inbound({ hook: '' }) })).toEqual([
            'nodes.1.config.signingSecret',
        ]);
        expect(await channel.heldPaths({ name: 'other_flow', state: 'active', item: inbound() })).toEqual([]);
    });
});

describe('[#20790] a draft-to-active promotion', () => {
    it('a draft save never touches the live credential; publishing the draft promotes it', async () => {
        const ql = await boot();
        const channel = new FlowCredentialChannel(() => ql as never);
        await channel.store({ name: 'pin_inbound', state: 'active', body: inbound({ hook: HOOK, sign: SIGN }) });

        const draftBody = await channel.store({ name: 'pin_inbound', state: 'draft', body: inbound({ hook: DRAFTED }) });
        expect(JSON.stringify(draftBody)).not.toContain(DRAFTED);
        // The live hook still verifies with the published secret.
        expect(await channel.resolve('pin_inbound', 'begin', 'secret')).toBe(HOOK);
        // The publish gate reads the draft's withheld secret as present.
        expect(await channel.heldPaths({ name: 'pin_inbound', state: 'draft', item: draftBody })).toContain('nodes.0.config.secret');

        const { promoted } = await channel.promote({ name: 'pin_inbound', body: draftBody });
        expect(promoted).toBe(1);
        expect(await channel.resolve('pin_inbound', 'begin', 'secret')).toBe(DRAFTED);
        // A position the draft left withheld keeps its live credential.
        expect(await channel.resolve('pin_inbound', 'callout', 'signingSecret')).toBe(SIGN);
        // The draft's rows are consumed.
        expect((await channelRows(ql)).filter((r) => r.state === 'draft')).toEqual([]);
    });

    it('a draft that clears a credential removes the live one when published', async () => {
        const ql = await boot();
        const channel = new FlowCredentialChannel(() => ql as never);
        await channel.store({ name: 'pin_inbound', state: 'active', body: inbound({ hook: HOOK, sign: SIGN }) });
        const draftBody = await channel.store({ name: 'pin_inbound', state: 'draft', body: inbound({ sign: '' }) });
        // Until published, the live callout still signs.
        expect(await channel.resolve('pin_inbound', 'callout', 'signingSecret')).toBe(SIGN);
        await channel.promote({ name: 'pin_inbound', body: draftBody });
        expect(await channel.resolve('pin_inbound', 'callout', 'signingSecret')).toBeUndefined();
        expect(await channel.resolve('pin_inbound', 'begin', 'secret')).toBe(HOOK);
    });

    it('deleting the stored rows drops the credentials of every state whose row is gone', async () => {
        const ql = await boot();
        const channel = new FlowCredentialChannel(() => ql as never);
        await channel.store({ name: 'pin_inbound', state: 'active', body: inbound({ hook: HOOK }) });
        await channel.store({ name: 'pin_inbound', state: 'draft', body: inbound({ hook: DRAFTED }) });
        // Only the draft was discarded: the live credential stays.
        await channel.prune({ name: 'pin_inbound', liveStates: new Set(['active']) });
        expect((await channelRows(ql)).map((r) => r.state)).toEqual(['active']);
        // The flow is gone: so is its credential, and a later flow of the
        // same name never inherits it.
        await channel.prune({ name: 'pin_inbound', liveStates: new Set() });
        expect(await channelRows(ql)).toEqual([]);
        expect(channel.holds('pin_inbound', 'begin', 'secret')).toBe(false);
    });
});

describe('[#20790] a restore strips and writes nothing (R2)', () => {
    it('the body a rollback stores carries no credential, and the channel keeps its current one', async () => {
        const ql = await boot();
        const channel = new FlowCredentialChannel(() => ql as never);
        await channel.store({ name: 'pin_inbound', state: 'active', body: inbound({ hook: ROTATED }) });
        const before = await channelRows(ql);

        // A version written before the move still holds the old literal.
        const restored = channel.strip(inbound({ hook: HOOK, sign: SIGN }));
        for (const s of [HOOK, SIGN]) expect(JSON.stringify(restored)).not.toContain(s);
        expect(await channelRows(ql)).toEqual(before);
        expect(await channel.resolve('pin_inbound', 'begin', 'secret')).toBe(ROTATED);
    });
});

describe('[#20790] no crypto provider ⇒ the save is refused before anything is written', () => {
    it('refuses with the ADR-0112 pair, names the credential by class, writes no row and no ciphertext', async () => {
        const ql = await boot(false);
        const channel = new FlowCredentialChannel(() => ql as never);

        const refusal = await channel
            .store({ name: 'pin_inbound', state: 'active', body: inbound({ hook: HOOK, sign: SIGN }) })
            .then(() => undefined, (e: unknown) => e);
        expect(refusal).toBeInstanceOf(FlowCredentialChannelRefusal);
        expect((refusal as FlowCredentialChannelRefusal).code).toBe(FLOW_CREDENTIAL_UNAVAILABLE_CODE);
        expect((refusal as FlowCredentialChannelRefusal).status).toBe(FLOW_CREDENTIAL_UNAVAILABLE_STATUS);
        expect((refusal as Error).message).toContain('the inbound hook secret');
        for (const s of ALL) expect((refusal as Error).message).not.toContain(s);

        expect(await channelRows(ql)).toEqual([]);
        expect((await ql.find('sys_secret', { context: SYSTEM } as never)) as any[]).toEqual([]);
        expect(channel.holds('pin_inbound', 'begin', 'secret')).toBe(false);

        // A body that carries no credential still saves: nothing needs the provider.
        await expect(channel.store({ name: 'pin_inbound', state: 'active', body: inbound() })).resolves.toBeTruthy();
    });
});

describe('[#20790] Q3 A at the inbound door: a packaged literal asks the channel only for a held position', () => {
    /** An engine whose `api` trigger records the binding it is handed, with `channel` as its credential source. */
    function engineOn(channel: FlowCredentialChannel): { engine: AutomationEngine; started: FlowTriggerBinding[] } {
        const engine = new AutomationEngine({ debug() {}, info() {}, warn() {}, error() {} } as never);
        const started: FlowTriggerBinding[] = [];
        engine.registerTrigger({ type: 'api', start: (b) => { started.push(b); }, stop: () => {} });
        engine.setFlowCredentialSource(channel);
        return { engine, started };
    }
    const packaged = (secret: string) => ({
        name: 'pin_packaged',
        label: 'Pin packaged',
        type: 'api',
        status: 'active',
        nodes: [
            { id: 'begin', type: 'start', label: 'Start', config: { hookId: 'h1', secret } },
            { id: 'finish', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'begin', target: 'finish' }],
    });

    it('with no reachable store, the literal verifies and the channel is never asked', async () => {
        const channel = new FlowCredentialChannel(() => undefined);
        const { engine, started } = engineOn(channel);
        engine.registerFlow('pin_packaged', packaged(PACKAGED));
        expect(started).toHaveLength(1);
        expect(await started[0]!.resolveSecret!()).toBe(PACKAGED);
    });

    it('the control: a HELD position whose store becomes unreachable rejects, never answers the literal', async () => {
        const ql = await boot();
        let reachable: ObjectQL | undefined = ql;
        const channel = new FlowCredentialChannel(() => reachable as never);
        await channel.store({ name: 'pin_packaged', state: 'active', body: packaged(HOOK) });
        expect(channel.holds('pin_packaged', 'begin', 'secret')).toBe(true);
        const { engine, started } = engineOn(channel);
        engine.registerFlow('pin_packaged', packaged(PACKAGED));
        // Held and readable: the channel row wins over the literal.
        expect(await started[0]!.resolveSecret!()).toBe(HOOK);

        reachable = undefined;
        await expect(started[0]!.resolveSecret!()).rejects.toBeInstanceOf(FlowCredentialUnresolvableError);
    });
});
