// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20790] A flow's credentials live in a WRITE-ONLY channel, not in its
 * stored definition — on the real composition (CRM app, ObjectQL over SQLite,
 * security, REST and the dispatcher, the automation service, the host crypto
 * provider the harness wires exactly as `os serve` does), driven through the
 * real doors.
 *
 * Before this, an inbound flow authored through the metadata save door stored
 * its hook secret — and an `http` node its outbound signing secret — in
 * cleartext in the stored row, every version-history row and the row's
 * content hash, and each read exit had to project them away one door at a
 * time. Pinned here, each against the door that used to leak or must keep
 * working:
 *
 *  1. no read surface returns a credential — the stored row, the history row,
 *     an administrator's engine read (the reader the MCP stdio transport
 *     uses), the generic data door, `/meta`; the channel itself is masked and
 *     closed to the data door;
 *  2. the inbound door verifies with the original secret after the move and
 *     after an edit-and-republish in the withheld form;
 *  3. an explicit rotation replaces it, on the next post;
 *  4. a draft save never rotates the live hook; publishing the draft does;
 *  5. a flow stored before the move is moved once (history stays
 *     append-only, a receipt is written) — and a rollback past the move keeps
 *     the channel's current secret and stores none (R2);
 *  6. the clone door refuses a source holding a credential, channel-held or
 *     literal (C1);
 *  7. with no crypto provider a save carrying a credential is refused before
 *     anything is written;
 *  8. deleting the flow drops its credential — a new flow of the same name
 *     inherits nothing;
 *  9. Q3 A: a packaged literal hook verifies on its literal when the
 *     credential store is unreachable — the channel is asked only for a
 *     position it holds;
 * 10. the control: a HELD hook secret whose store becomes unreachable is
 *     answered 503, never verified against the literal.
 *
 * The inbound door is the real `ApiTrigger` (`@objectstack/trigger-api`),
 * registered on the real engine with an in-memory queue, so `202` means the
 * signature verified and the post was enqueued. Every value is a probe
 * sentinel, not a credential.
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { stripReadDecorations } from '@objectstack/spec/kernel';
import { ApiTrigger } from '@objectstack/trigger-api';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const FLOW = 'zz_channel_hook';
const LEGACY = 'zz_channel_legacy';
const HOOK_V1 = 'pin-dogfood-hook-v1-2c7d';
const HOOK_V2 = 'pin-dogfood-hook-v2-9a41';
const HOOK_DRAFT = 'pin-dogfood-hook-draft-5f08';
const SIGN_V1 = 'pin-dogfood-sign-v1-e613';
const LEGACY_V1 = 'pin-dogfood-legacy-v1-41bb';
const LEGACY_V2 = 'pin-dogfood-legacy-v2-0c95';
const NO_PROVIDER = 'pin-dogfood-noprov-77a3';
const PACKAGED_LITERAL = 'pin-dogfood-packaged-3d6a';
const ALL = [HOOK_V1, HOOK_V2, HOOK_DRAFT, SIGN_V1, LEGACY_V1, LEGACY_V2, NO_PROVIDER, PACKAGED_LITERAL];
const SYSTEM = { isSystem: true } as const;

function inbound(name: string, secrets: { hook?: string; sign?: string } = {}, label = 'Inbound probe') {
    return {
        name,
        label,
        type: 'api',
        status: 'active',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { hookId: 'h1', ...(secrets.hook !== undefined ? { secret: secrets.hook } : {}) } },
            {
                id: 'call',
                type: 'http',
                label: 'Call',
                config: {
                    url: 'https://example.invalid/out',
                    method: 'POST',
                    ...(secrets.sign !== undefined ? { signingSecret: secrets.sign } : {}),
                },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'call' },
            { id: 'e2', source: 'call', target: 'end' },
        ],
    };
}

const sign = (secret: string, body: string) => 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);
const hasAny = (v: unknown, secrets: readonly string[]) => secrets.some((s) => JSON.stringify(v ?? null).includes(s));

describe('[#20790] flow credentials live in the write-only channel, not the stored definition', () => {
    let stack: VerifyStack;
    let token: string;
    let ql: any;
    let protocol: any;
    let automation: any;
    let trigger: ApiTrigger;

    beforeAll(async () => {
        stack = await bootStack(crmStack as never, { automation: true });
        token = await stack.signIn();
        ql = await stack.kernel.getServiceAsync('objectql');
        protocol = await stack.kernel.getServiceAsync('protocol');
        automation = await stack.kernel.getServiceAsync('automation');
        const queue = {
            publish: async () => 'msg',
            subscribe: async () => {},
            unsubscribe: async () => {},
        };
        const quiet = { info() {}, warn() {}, debug() {} };
        trigger = new ApiTrigger(() => queue, quiet);
        automation.registerTrigger(trigger);
    }, 180_000);

    afterAll(async () => {
        await stack?.stop();
    });

    /** Bind the flow from what is STORED — the protocol's execution view, as a reload does. */
    async function arm(name: string): Promise<void> {
        const view = await protocol.getMetaItemsForExecution({ type: 'flow' });
        const list = Array.isArray(view) ? view : view?.items ?? [];
        const doc = list.map((e: any) => (e && typeof e === 'object' && 'item' in e ? e.item : e)).find((d: any) => d?.name === name);
        expect(doc, `${name} is in the stored view`).toBeTruthy();
        automation.registerFlow(name, stripReadDecorations(doc));
    }

    async function post(name: string, secret: string): Promise<number> {
        const body = JSON.stringify({ probe: Math.random() });
        const res = await trigger.handleRequest({ flowName: name, hookId: 'h1', rawBody: body, signatureHeader: sign(secret, body) });
        return res.status;
    }

    async function stored(name: string, object = 'sys_metadata'): Promise<any[]> {
        return rowsOf(await ql.find(object, { where: { name }, context: SYSTEM }));
    }

    async function channelRows(name: string): Promise<any[]> {
        return rowsOf(await ql.find('sys_flow_credential', { where: { flow_name: name }, context: SYSTEM }));
    }

    it('1 — a credential saved through the metadata door is in no read surface; the channel holds it masked', async () => {
        const put = await stack.apiAs(token, 'PUT', `/meta/flow/${FLOW}`, inbound(FLOW, { hook: HOOK_V1, sign: SIGN_V1 }));
        expect(put.status).toBe(200);

        const active = await stored(FLOW);
        expect(active).toHaveLength(1);
        expect(hasAny(active, ALL)).toBe(false);
        const history = await stored(FLOW, 'sys_metadata_history');
        expect(history.length).toBeGreaterThan(0);
        expect(hasAny(history, ALL)).toBe(false);

        // The engine-only reader the MCP stdio transport serves from, as an
        // administrator: the stored body itself no longer holds it.
        const admin = await stack.contextFor(token);
        const adminRead = rowsOf(await ql.find('sys_metadata', { where: { name: FLOW } }, { context: admin }));
        const adminHistory = rowsOf(await ql.find('sys_metadata_history', { where: { name: FLOW } }, { context: admin }));
        expect(adminRead).toHaveLength(1);
        expect(hasAny(adminRead, ALL)).toBe(false);
        expect(hasAny(adminHistory, ALL)).toBe(false);

        // The generic data door and /meta.
        for (const path of [`/data/sys_metadata?filter=${encodeURIComponent(JSON.stringify({ name: FLOW }))}`, `/meta/flow/${FLOW}`]) {
            const res = await stack.apiAs(token, 'GET', path);
            expect(res.status, path).toBe(200);
            expect((await res.text()).includes(HOOK_V1), path).toBe(false);
        }

        // The channel: one row per credential, every read masked, no data door.
        const rows = await channelRows(FLOW);
        expect(rows.map((r) => `${r.node_id}.${r.credential_key}:${r.state}`).sort()).toEqual([
            'call.signingSecret:active',
            'start.secret:active',
        ]);
        expect(hasAny(rows, ALL)).toBe(false);
        const door = await stack.apiAs(token, 'GET', '/data/sys_flow_credential');
        expect(door.status).toBeGreaterThanOrEqual(400);
        expect(hasAny(await door.text(), ALL)).toBe(false);
    });

    it('2 — the inbound door verifies with the original secret after the move, and after an edit-and-republish', async () => {
        await arm(FLOW);
        expect(await post(FLOW, HOOK_V1)).toBe(202);
        expect(await post(FLOW, 'not-the-secret')).toBe(401);

        // The served (withheld) form saved back: the channel keeps the secret.
        const republish = await stack.apiAs(token, 'PUT', `/meta/flow/${FLOW}`, inbound(FLOW, {}, 'Edited'));
        expect(republish.status).toBe(200);
        expect(hasAny(await stored(FLOW), ALL)).toBe(false);
        await arm(FLOW);
        expect(await post(FLOW, HOOK_V1)).toBe(202);
    });

    it('3 — an explicit rotation replaces it, on the next post with no re-arm', async () => {
        const rotate = await stack.apiAs(token, 'PUT', `/meta/flow/${FLOW}`, inbound(FLOW, { hook: HOOK_V2 }, 'Rotated'));
        expect(rotate.status).toBe(200);
        expect(hasAny(await stored(FLOW), ALL)).toBe(false);
        expect(await post(FLOW, HOOK_V2)).toBe(202);
        expect(await post(FLOW, HOOK_V1)).toBe(401);
    });

    it('4 — a draft save never rotates the live hook; publishing the draft promotes it', async () => {
        const draft = await stack.apiAs(token, 'PUT', `/meta/flow/${FLOW}?mode=draft`, inbound(FLOW, { hook: HOOK_DRAFT }, 'Drafted'));
        expect(draft.status).toBe(200);
        expect(hasAny(await stored(FLOW), ALL)).toBe(false);
        // The live hook still verifies with the published secret.
        expect(await post(FLOW, HOOK_V2)).toBe(202);
        expect(await post(FLOW, HOOK_DRAFT)).toBe(401);

        // The publish gate reads the draft's withheld secret as present.
        const publish = await stack.apiAs(token, 'POST', `/meta/flow/${FLOW}/publish`, {});
        expect(publish.status).toBe(200);
        expect(hasAny(await stored(FLOW), ALL)).toBe(false);
        expect(await post(FLOW, HOOK_DRAFT)).toBe(202);
        expect(await post(FLOW, HOOK_V2)).toBe(401);
        expect((await channelRows(FLOW)).filter((r) => r.state === 'draft')).toEqual([]);
    });

    it('5 — a flow stored before the move is moved once; a rollback past the move keeps the channel secret (R2)', async () => {
        // A flow stored the way every flow was BEFORE this release: the
        // protocol with no credential channel registered.
        const channels: Map<string, unknown> = protocol.credentialChannels;
        const flowChannel = channels.get('flow');
        expect(flowChannel, 'the automation plugin registered the flow channel').toBeTruthy();
        channels.delete('flow');
        try {
            const legacy = await stack.apiAs(token, 'PUT', `/meta/flow/${LEGACY}`, inbound(LEGACY, { hook: LEGACY_V1 }));
            expect(legacy.status).toBe(200);
        } finally {
            channels.set('flow', flowChannel);
        }
        expect(hasAny(await stored(LEGACY), [LEGACY_V1])).toBe(true);

        // A crypto-provider registration runs the one-time move.
        ql.setCryptoProvider(ql.cryptoProvider);
        const deadline = Date.now() + 15_000;
        while (hasAny(await stored(LEGACY), [LEGACY_V1]) && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
        }
        expect(hasAny(await stored(LEGACY), [LEGACY_V1])).toBe(false);
        expect((await channelRows(LEGACY)).map((r) => r.state)).toEqual(['active']);
        // Rotate, don't scrub: the version written before the move keeps what it recorded.
        const history = await stored(LEGACY, 'sys_metadata_history');
        expect(history.filter((r) => hasAny(r, [LEGACY_V1]))).toHaveLength(1);
        // The receipt names the flow, never the value.
        const receipt = rowsOf(await ql.find('sys_migration', { where: { id: 'flow-credential-channel' }, context: SYSTEM }));
        expect(receipt).toHaveLength(1);
        expect(String(receipt[0].details)).toContain(LEGACY);
        expect(hasAny(receipt, ALL)).toBe(false);
        await arm(LEGACY);
        expect(await post(LEGACY, LEGACY_V1)).toBe(202);

        // Rotate, then roll back to version 1 — the version that held the old literal.
        const rotate = await stack.apiAs(token, 'PUT', `/meta/flow/${LEGACY}`, inbound(LEGACY, { hook: LEGACY_V2 }, 'Rotated'));
        expect(rotate.status).toBe(200);
        const before = (await stored(LEGACY, 'sys_metadata_history')).length;
        const rollback = await stack.apiAs(token, 'POST', `/meta/flow/${LEGACY}/rollback`, { toVersion: 1 });
        expect(rollback.status).toBe(200);

        const restored = await stored(LEGACY);
        expect(JSON.parse(restored[0].metadata).label).toBe('Inbound probe');
        expect(hasAny(restored, ALL)).toBe(false);
        const after = await stored(LEGACY, 'sys_metadata_history');
        expect(after.length).toBe(before + 1);
        expect(after.filter((r) => hasAny(r, [LEGACY_V1]))).toHaveLength(1);
        await arm(LEGACY);
        expect(await post(LEGACY, LEGACY_V2)).toBe(202);
        expect(await post(LEGACY, LEGACY_V1)).toBe(401);
    });

    it('6 — the clone door refuses a source holding a credential, channel-held or literal (C1)', async () => {
        for (const source of [FLOW, 'zz_channel_literal_src']) {
            if (source !== FLOW) automation.registerFlow(source, inbound(source, { hook: HOOK_V1 }));
            const res = await stack.apiAs(token, 'POST', `/automation/${source}/clone`, { name: `${source}_copy`, label: 'Copy' });
            expect(res.status, source).toBe(409);
            const text = await res.text();
            const body = JSON.parse(text);
            expect(body.error?.code).toBe('RESOURCE_CONFLICT');
            expect(body.error?.message).toContain('the inbound hook secret');
            expect(hasAny(text, ALL)).toBe(false);
            expect(await automation.getFlow(`${source}_copy`)).toBeNull();
        }
        // The control: a flow that holds no credential clones as before.
        automation.registerFlow('zz_channel_plain_src', {
            name: 'zz_channel_plain_src',
            label: 'Plain',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
        });
        const plain = await stack.apiAs(token, 'POST', '/automation/zz_channel_plain_src/clone', { name: 'zz_channel_plain_copy', label: 'Copy' });
        expect(plain.status).toBe(200);
    });

    it('7 — with no crypto provider a save carrying a credential is refused before anything is written', async () => {
        const provider = ql.cryptoProvider;
        ql.cryptoProvider = undefined;
        try {
            const res = await stack.apiAs(token, 'PUT', '/meta/flow/zz_channel_noprov', inbound('zz_channel_noprov', { hook: NO_PROVIDER }));
            expect(res.status).toBe(503);
            const text = await res.text();
            // The metadata door's error body names the code at its top level.
            expect(JSON.parse(text).code).toBe('SERVICE_UNAVAILABLE');
            expect(hasAny(text, ALL)).toBe(false);
        } finally {
            ql.cryptoProvider = provider;
        }
        expect(await stored('zz_channel_noprov')).toEqual([]);
        expect(await stored('zz_channel_noprov', 'sys_metadata_history')).toEqual([]);
        expect(await channelRows('zz_channel_noprov')).toEqual([]);
    });

    it('8 — deleting the flow drops its credential; a new flow of the same name inherits nothing', async () => {
        const del = await stack.apiAs(token, 'DELETE', `/meta/flow/${FLOW}`);
        expect(del.status).toBe(200);
        expect(await channelRows(FLOW)).toEqual([]);
        // Recreated in the withheld form: nothing is held, so the publish gate refuses it.
        const again = await stack.apiAs(token, 'PUT', `/meta/flow/${FLOW}`, inbound(FLOW));
        expect(again.status).toBe(422);
        expect(await channelRows(FLOW)).toEqual([]);
    });

    /**
     * Tests 9 and 10 swap the engine's credential source for a channel of the
     * plugin's own class whose store is unreachable — the composition with no
     * data engine — and restore the live one after.
     */
    async function withSource<T>(source: unknown, run: () => Promise<T>): Promise<T> {
        const live = automation.flowCredentialSource;
        automation.setFlowCredentialSource(source);
        try {
            return await run();
        } finally {
            automation.setFlowCredentialSource(live);
        }
    }
    const channelClass = () => automation.flowCredentialSource.constructor as new (resolveEngine: () => unknown) => any;

    it('9 — Q3 A: a packaged literal hook verifies on its literal when the credential store is unreachable', async () => {
        const unreachable = new (channelClass())(() => undefined);
        await withSource(unreachable, async () => {
            automation.registerFlow('zz_channel_packaged', inbound('zz_channel_packaged', { hook: PACKAGED_LITERAL }));
            expect(await post('zz_channel_packaged', PACKAGED_LITERAL)).toBe(202);
            expect(await post('zz_channel_packaged', HOOK_V1)).toBe(401);
        });
    });

    it('10 — the control: a held hook secret whose store becomes unreachable answers 503, never the literal', async () => {
        let reachable: unknown = ql;
        const channel = new (channelClass())(() => reachable);
        await channel.store({ name: 'zz_channel_heldpack', state: 'active', body: inbound('zz_channel_heldpack', { hook: HOOK_V2 }) });
        expect(channel.holds('zz_channel_heldpack', 'start', 'secret')).toBe(true);
        try {
            await withSource(channel, async () => {
                automation.registerFlow('zz_channel_heldpack', inbound('zz_channel_heldpack', { hook: PACKAGED_LITERAL }));
                expect(await post('zz_channel_heldpack', HOOK_V2)).toBe(202);
                reachable = undefined;
                expect(await post('zz_channel_heldpack', PACKAGED_LITERAL)).toBe(503);
                expect(await post('zz_channel_heldpack', HOOK_V2)).toBe(503);
            });
        } finally {
            reachable = ql;
            await channel.prune({ name: 'zz_channel_heldpack', liveStates: new Set() });
        }
        expect(await channelRows('zz_channel_heldpack')).toEqual([]);
    });
});
