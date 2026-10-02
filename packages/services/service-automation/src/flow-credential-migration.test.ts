// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20790] The one-time move of stored flow credentials into the write-only
 * channel — its decisions, against a recording protocol and engine:
 *
 *  - only a stored row that still carries an explicit credential is re-saved,
 *    through the protocol's own save door, at its own state and package, as
 *    the server-stated `migrate-stored` rewrite;
 *  - each moved row gets the loud rotation notice (Q1 B), naming the flow and
 *    the credential's class, never the value;
 *  - with no crypto provider the first refusal defers the whole run with
 *    nothing written and no receipt;
 *  - an applied run leaves its receipt in `sys_migration` with
 *    `verified_at: null` and `blocking: 0`, naming flows, never values.
 *
 * The end-to-end half — the real door, the real channel, history kept
 * append-only — is the dogfood pin `flow-credential-channel.dogfood.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

import {
    FLOW_CREDENTIAL_MIGRATION_ID,
    flowCredentialRotationNotice,
    migrateFlowCredentialsIntoChannel,
} from './flow-credential-migration.js';

const HOOK = 'pin-migrate-hook-0d4f';
const SIGN = 'pin-migrate-sign-8a21';

const body = (name: string, hook?: string, sign?: string) => ({
    name,
    label: name,
    type: 'api',
    nodes: [
        { id: 'begin', type: 'start', label: 'Start', config: { hookId: 'h', ...(hook !== undefined ? { secret: hook } : {}) } },
        { id: 'call', type: 'http', label: 'Call', config: { url: 'https://example.invalid', ...(sign !== undefined ? { signingSecret: sign } : {}) } },
    ],
    edges: [],
});

function fakes(rows: Array<Record<string, unknown>>, refuse?: (name: string) => unknown) {
    const saves: Array<Record<string, unknown>> = [];
    const receipts: Array<Record<string, unknown>> = [];
    const logs: Array<{ level: string; msg: string }> = [];
    const engine = {
        async find(object: string) {
            return object === 'sys_metadata' ? rows : [];
        },
        async findOne(object: string, query?: Record<string, unknown>) {
            assertEngineFindOnePredicate(object, query as never);
            return receipts[0] ?? null;
        },
        async insert(_o: string, data: Record<string, unknown>) {
            receipts.push(data);
            return data;
        },
        async update(_o: string, data: Record<string, unknown>, options?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, options as never);
            receipts[0] = { ...receipts[0], ...data };
            return data;
        },
        getObject: () => ({}),
    };
    const protocol = {
        async saveMetaItem(request: Record<string, unknown>) {
            const refusal = refuse?.(request.name as string);
            if (refusal) throw refusal;
            saves.push(request);
            return { success: true };
        },
    };
    const logger = {
        info: (msg: string) => logs.push({ level: 'info', msg }),
        warn: (msg: string) => logs.push({ level: 'warn', msg }),
        error: (msg: string) => logs.push({ level: 'error', msg }),
    };
    return { engine, protocol, logger, saves, receipts, logs };
}

describe('[#20790] the stored flow credential move', () => {
    it('re-saves only rows that carry a credential, through the door, at their own state and package', async () => {
        const f = fakes([
            { name: 'legacy_active', state: 'active', package_id: 'app.crm', metadata: JSON.stringify(body('legacy_active', HOOK, SIGN)) },
            { name: 'legacy_draft', state: 'draft', package_id: null, metadata: body('legacy_draft', HOOK) },
            { name: 'already_moved', state: 'active', package_id: null, metadata: JSON.stringify(body('already_moved')) },
            { name: 'cleared', state: 'active', package_id: null, metadata: JSON.stringify(body('cleared', undefined, '')) },
        ]);
        const result = await migrateFlowCredentialsIntoChannel(f);

        expect(result.status).toBe('applied');
        expect(result.found).toBe(2);
        expect(result.migrated).toEqual(['legacy_active (active)', 'legacy_draft (draft)']);
        expect(f.saves.map((s) => [s.name, s.mode, s.packageId, s.source, s.type])).toEqual([
            ['legacy_active', 'publish', 'app.crm', 'migrate-stored', 'flow'],
            ['legacy_draft', 'draft', null, 'migrate-stored', 'flow'],
        ]);
        // The body handed to the door is the stored one: the door moves the value.
        expect(JSON.stringify(f.saves[0]!.item)).toContain(HOOK);

        // One loud rotation notice per moved row, by class, never the value.
        const notices = f.logs.filter((l) => l.level === 'warn' && l.msg.includes('ROTATE:'));
        expect(notices.map((n) => n.msg)).toEqual([
            flowCredentialRotationNotice('legacy_active', 'active', ['secret', 'signingSecret']),
            flowCredentialRotationNotice('legacy_draft', 'draft', ['secret']),
        ]);
        expect(notices[0]!.msg).toContain('an outbound signing secret and the inbound hook secret');
        for (const log of f.logs) for (const s of [HOOK, SIGN]) expect(log.msg).not.toContain(s);

        // The receipt: one row, gating nothing, naming flows and never values.
        expect(f.receipts).toHaveLength(1);
        const receipt = f.receipts[0]!;
        expect(receipt.id).toBe(FLOW_CREDENTIAL_MIGRATION_ID);
        expect(receipt.verified_at).toBeNull();
        expect(receipt.blocking).toBe(0);
        expect(JSON.parse(receipt.details as string).migrated).toEqual(result.migrated);
        for (const s of [HOOK, SIGN]) expect(JSON.stringify(receipt)).not.toContain(s);
    });

    it('defers the whole run, writing nothing, when the first save finds no crypto provider', async () => {
        const noProvider = Object.assign(new Error('no crypto provider'), { code: 'SERVICE_UNAVAILABLE', status: 503 });
        const f = fakes(
            [
                { name: 'a', state: 'active', metadata: JSON.stringify(body('a', HOOK)) },
                { name: 'b', state: 'active', metadata: JSON.stringify(body('b', HOOK)) },
            ],
            () => noProvider,
        );
        const result = await migrateFlowCredentialsIntoChannel(f);
        expect(result.status).toBe('deferred');
        expect(f.saves).toEqual([]);
        expect(f.receipts).toEqual([]);
        expect(f.logs.some((l) => l.msg.includes('ROTATE:'))).toBe(false);
    });

    it('a row the door refuses for another reason is reported by flow and code, and the rest still move', async () => {
        const locked = Object.assign(new Error('locked'), { code: 'ITEM_LOCKED', status: 403 });
        const f = fakes(
            [
                { name: 'locked_one', state: 'active', metadata: JSON.stringify(body('locked_one', HOOK)) },
                { name: 'free_one', state: 'active', metadata: JSON.stringify(body('free_one', HOOK)) },
            ],
            (name) => (name === 'locked_one' ? locked : undefined),
        );
        const result = await migrateFlowCredentialsIntoChannel(f);
        expect(result.status).toBe('applied');
        expect(result.failed).toEqual([{ flow: 'locked_one', state: 'active', code: 'ITEM_LOCKED' }]);
        expect(result.migrated).toEqual(['free_one (active)']);
        expect(JSON.parse(f.receipts[0]!.details as string).failed).toEqual(result.failed);
        expect(f.receipts[0]!.advisory).toBe(1);
    });

    it('finds nothing to move on a store with no credential left — and writes no receipt', async () => {
        const f = fakes([{ name: 'clean', state: 'active', metadata: JSON.stringify(body('clean')) }]);
        const result = await migrateFlowCredentialsIntoChannel(f);
        expect(result).toEqual({ status: 'nothing-to-move', found: 0, migrated: [], failed: [] });
        expect(f.saves).toEqual([]);
        expect(f.receipts).toEqual([]);
    });
});
