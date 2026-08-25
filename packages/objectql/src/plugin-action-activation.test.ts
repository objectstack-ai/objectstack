// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12160] ADR-0126 §8 — how the engine plugin ATTACHES the packaged-action
// activation ledger, and what each failure to attach costs.
//
// The projection and the row contract are pinned in `action-activation.test.ts`.
// What is pinned here is the boot DECISION, which has three distinct outcomes
// that must not collapse into one:
//
//   1. **The ledger object is not part of this composition.** Ordinary: the
//      object is registered by whichever composition consumes it. Nothing is
//      read — deliberately, because `find` against a table that does not exist
//      is a driver fault the ENGINE logs at `error` on its way out, and a boot
//      that never asked for this capability must not print one.
//   2. **Registered, but unreadable.** A real misconfiguration (schema sync did
//      not run). The store is NOT attached, so the write door refuses loudly
//      instead of reporting a durable flip that reverts on restart.
//   3. **Registered and readable.** Attach, hydrate, and say in the boot log
//      which actions this installation will refuse.
//
// And one property that cuts across them: a failed attach is **not a recorded
// verdict**. `metadata:reloaded` re-attempts it, so a ledger object registered
// after `kernel:ready` is picked up rather than written off by a read taken one
// moment too early (AGENTS.md, "Startup registry reads").

import { describe, it, expect, vi } from 'vitest';

import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type AnyRecord = Record<string, any>;

const TABLE = 'sys_metadata_activation';

function makeQl(opts: { registered?: boolean; rows?: AnyRecord[]; findThrows?: boolean } = {}) {
    const setActionActivationStore = vi.fn();
    const find = vi.fn(async () => {
        if (opts.findThrows) throw new Error(`no such table: ${TABLE}`);
        return opts.rows ?? [];
    });
    const ql: AnyRecord = {
        find,
        insert: vi.fn(),
        update: vi.fn(),
        setActionActivationStore,
        // The real engine's projection, reduced to what the plugin drives.
        _disabled: [] as string[],
        async hydrateActionActivations() {
            const rows = await find();
            const off = rows.filter((r: AnyRecord) => r.active === false).map((r: AnyRecord) => r.name);
            (ql._disabled as string[]).push(...off);
            return off;
        },
        registry: {
            getObject: (name: string) => (opts.registered && name === TABLE ? { name } : undefined),
        },
    };
    return { ql, setActionActivationStore, find };
}

const makeCtx = () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getService: vi.fn(() => { throw new Error('no service'); }),
    hook: vi.fn(),
}) as AnyRecord;

const attach = (ql: AnyRecord, ctx: AnyRecord) =>
    (new ObjectQLPlugin({ ql: ql as unknown as ObjectQL }) as AnyRecord).hydrateActionActivations(ctx);

describe('ObjectQLPlugin — attaching the packaged-action activation ledger', () => {
    it('reads NOTHING when the ledger object is not registered here', async () => {
        const { ql, setActionActivationStore, find } = makeQl({ registered: false });
        const ctx = makeCtx();

        await attach(ql, ctx);

        // The load-bearing assertion. A probe here would make the engine log a
        // driver fault at `error` on every boot of every composition that does
        // not use this capability — training operators to skim `error`, which
        // is the over-application AGENTS.md warns about.
        expect(find).not.toHaveBeenCalled();
        expect(setActionActivationStore).not.toHaveBeenCalled();
        expect(ctx.logger.warn).not.toHaveBeenCalled();
        expect(ctx.logger.error).not.toHaveBeenCalled();
        expect(ctx.logger.debug).toHaveBeenCalled();
    });

    it('WARNS and does not attach when the ledger is registered but unreadable', async () => {
        const { ql, setActionActivationStore } = makeQl({ registered: true, findThrows: true });
        const ctx = makeCtx();

        await attach(ql, ctx);

        expect(setActionActivationStore).not.toHaveBeenCalled();
        expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
        const [message] = ctx.logger.warn.mock.calls[0];
        // The consequence, concretely, and the fix — the two things a
        // degradation line owes.
        expect(message).toContain(TABLE);
        expect(message).toContain('UNAVAILABLE');
        expect(message).toContain('schema sync');
        // ⛔ Not `error`: nothing claimed to have persisted, and the write door
        // refuses at the moment a durability claim would be made.
        expect(ctx.logger.error).not.toHaveBeenCalled();
    });

    it('attaches, hydrates and NAMES what the installation will refuse', async () => {
        const { ql, setActionActivationStore } = makeQl({
            registered: true,
            rows: [
                { metadata_type: 'action', name: 'convert_lead', package_id: 'crm', active: false },
                { metadata_type: 'action', name: 'send_quote', package_id: 'crm', active: true },
            ],
        });
        const ctx = makeCtx();

        await attach(ql, ctx);

        expect(setActionActivationStore).toHaveBeenCalledTimes(1);
        const info = ctx.logger.info.mock.calls.map(([m]: [string]) => m).join('\n');
        expect(info).toContain('convert_lead');
        expect(ctx.logger.warn).not.toHaveBeenCalled();
    });

    it('says nothing at all on a stock boot — an empty ledger changes nothing anywhere', async () => {
        const { ql, setActionActivationStore } = makeQl({ registered: true, rows: [] });
        const ctx = makeCtx();

        await attach(ql, ctx);

        expect(setActionActivationStore).toHaveBeenCalledTimes(1);
        expect(ctx.logger.info).not.toHaveBeenCalled();
        expect(ctx.logger.warn).not.toHaveBeenCalled();
    });

    it('a failed attach is NOT a verdict — a later reload picks the ledger up', async () => {
        // One plugin instance across both attempts, which is what a real boot
        // has: `kernel:ready` fires first, `metadata:reloaded` later.
        let registered = false;
        const setActionActivationStore = vi.fn();
        const rows = [{ metadata_type: 'action', name: 'convert_lead', package_id: 'crm', active: false }];
        const ql: AnyRecord = {
            find: vi.fn(async () => rows),
            insert: vi.fn(), update: vi.fn(),
            setActionActivationStore,
            hydrateActionActivations: vi.fn(async () => ['convert_lead']),
            registry: { getObject: (name: string) => (registered && name === TABLE ? { name } : undefined) },
        };
        const plugin = new ObjectQLPlugin({ ql: ql as unknown as ObjectQL }) as AnyRecord;
        const ctx = makeCtx();

        await plugin.hydrateActionActivations(ctx);
        expect(setActionActivationStore).not.toHaveBeenCalled();

        // The composition registers the object later — a reload, a package
        // install, a plugin that starts after `kernel:ready`.
        registered = true;
        await plugin.hydrateActionActivations(ctx);

        expect(setActionActivationStore).toHaveBeenCalledTimes(1);
        expect(ql.hydrateActionActivations).toHaveBeenCalledTimes(1);

        // …and it does not re-attach on every subsequent reload: once the
        // projection IS the ledger, a repeat read would be noise.
        await plugin.hydrateActionActivations(ctx);
        expect(setActionActivationStore).toHaveBeenCalledTimes(1);
        expect(ql.hydrateActionActivations).toHaveBeenCalledTimes(1);
    });
});
