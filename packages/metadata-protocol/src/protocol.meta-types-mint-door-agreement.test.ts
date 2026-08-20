// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8421 — `GET /meta/types` and `PUT /meta/:type/:name` answer the same
 * question the same way.
 *
 * ## The defect this closes, which is NOT the one the card was filed about
 *
 * The card is about minting `type='fieldz'`. Closing it added a THIRD gate at
 * the write door, and a third gate is exactly how two endpoints of one service
 * start contradicting each other: the listing kept synthesising
 * `allowRuntimeCreate: true` for every type with no static registry entry while
 * the new door refused a subset of them. An AI author — the reader this
 * platform is built for — has only the platform's own advertisement to go on,
 * so "advertised writable, 400 on write" is a worse failure than a narrower
 * surface. Maintainer ruling, 2026-08-15, verbatim and untranslated:
 *
 *     暂时不考虑让插件申明新的元数据类型
 *
 * With plugins not declaring metadata types, "no registry entry ⇒ assume a
 * plugin declared it ⇒ writable" is a rule whose premise expired, and the two
 * doors are made to agree at the honest value by reading ONE predicate
 * (`unrecognisedMetaTypeRefusal`) instead of two rules maintained apart.
 *
 * ⚠️ `暂时` is load-bearing: a CURRENT posture, not a permanent architectural
 * closure. The full record, and what a future author reintroducing
 * plugin-declared kinds must revisit first, is in `getMetaTypes()`'s synthesis
 * comment in `protocol.ts`.
 *
 * ## Why the sample spans THREE classes and not just the withdrawn four
 *
 * A suite that only pinned the four withdrawn types would be satisfied by a
 * blanket flip of the synthesis — which would break `PUT /meta/theme/dark`, the
 * operation the plugin path exists to serve, and would be a worse outcome than
 * the defect being closed. So every case here carries its class, and the
 * classes are checked against each other:
 *
 *  1. **statically declared** (`view`, `hook`, `agent`) — the flag comes off
 *     the registry entry, as it always did, in both the `true` and the `false`
 *     direction;
 *  2. **URL-map-only plugin kinds** (`theme`, and its five siblings) — no
 *     registry entry, IN the static spelling contract, still advertised and
 *     still mintable. This is the discriminating control: without it the change
 *     cannot show its narrowing is narrow;
 *  3. **withdrawn** (`policy`, `data`, `package`, `kind`) — live
 *     `SchemaRegistry` keys an ordinary `registerApp` produces, in NEITHER half
 *     of the static contract, advertised `false` and refused.
 *
 * Harness: the real `getMetaTypes()` and the real `saveMetaItem()` on one
 * protocol instance over a stub engine, so agreement is MEASURED across the two
 * code paths rather than asserted about a shared helper. The registry's
 * `getRegisteredTypes()` returns a set shaped like a real `registerApp` — which
 * is where `data`, `kind` and `package` come from in production, and why the
 * listing must have an opinion about them at all.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL itself refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The live type set an ordinary `registerApp` leaves in `SchemaRegistry`,
 * plus the declared types this suite samples. Measured on #8770 against a real
 * `ObjectQL`: `["data","kind","object","package","theme"]`, of which `data`,
 * `kind` and `package` sit outside the static spelling contract.
 */
const LIVE_TYPES = [
    'view', 'hook', 'agent', 'object',
    'theme', 'webhook', 'connector', 'sharing_rule', 'analytics_cube', 'rag_pipeline',
    'policy', 'data', 'package', 'kind',
];

function makeProtocol() {
    const rows = new Map<string, Record<string, unknown>>();
    let nextId = 0;
    const engine: any = {
        async findOne() { return null; },
        async find() { return []; },
        async insert(table: string, data: Record<string, unknown>) {
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            rows.set(`${data.type}|${data.name}`, data);
            return { id: `r_${nextId}` };
        },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 1 };
        },
        async count() { return 0; },
        async transaction(fn: (ctx: unknown) => Promise<unknown>) { return fn(undefined); },
        async execute() { return {}; },
        async getObjectSchema() { return undefined; },
        registry: {
            getRegisteredTypes: () => [...LIVE_TYPES],
            registerItem: () => {},
            registerObject: () => {},
            unregisterItem: () => {},
            listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: () => undefined,
        },
    };
    const protocol = new ObjectStackProtocolImplementation(
        engine,
        () => new Map(),
        undefined,
    ) as any;
    return { protocol, rows };
}

/**
 * One sample per class. `item` is a SPEC-VALID body for its type wherever the
 * type resolves a schema — a 422 from schema resolution would answer a
 * different question than the one this suite asks, and would read as agreement
 * while proving nothing (the trap #8770's own triage names for `webhook`).
 */
const SAMPLE: Array<{
    type: string;
    klass: 'declared' | 'url-map-only' | 'withdrawn';
    creatable: boolean;
    item: Record<string, unknown>;
}> = [
    {
        type: 'view',
        klass: 'declared',
        creatable: true,
        item: {
            name: 'probe_view',
            label: 'Probe',
            object: 'task',
            viewKind: 'list',
            columns: [{ field: 'name', label: 'Name' }],
        },
    },
    {
        type: 'hook',
        klass: 'declared',
        creatable: true,
        item: { name: 'probe_hook', object: 'task', events: ['beforeInsert'] },
    },
    {
        // The `false` direction of class 1, and it must be present: a listing
        // that answered `true` for everything declared would otherwise pass.
        type: 'agent',
        klass: 'declared',
        creatable: false,
        item: { name: 'probe_agent', label: 'Probe' },
    },
    {
        type: 'theme',
        klass: 'url-map-only',
        creatable: true,
        // [#10194] spec-valid body — `theme` resolves a schema through
        // UNREGISTERED_KIND_SCHEMAS now, and the "behaves as advertised" case
        // drives this body through a real write, so a malformed one would
        // 422 and misread the ADVERTISEMENT door this suite measures.
        item: { name: 'probe_theme', label: 'Probe', colors: { primary: '#3b82f6' } },
    },
    { type: 'policy', klass: 'withdrawn', creatable: false, item: { name: 'probe_policy', label: 'Probe' } },
    { type: 'data', klass: 'withdrawn', creatable: false, item: { name: 'probe_data', label: 'Probe' } },
    { type: 'package', klass: 'withdrawn', creatable: false, item: { name: 'probe_package', label: 'Probe' } },
    { type: 'kind', klass: 'withdrawn', creatable: false, item: { name: 'probe_kind', label: 'Probe' } },
];

describe('#8421 — the read door and the mint door agree, across all three classes', () => {
    it.each(SAMPLE)(
        '$klass `$type`: GET /meta/types advertises allowRuntimeCreate=$creatable',
        async ({ type, creatable }) => {
            const { protocol } = makeProtocol();
            const listing = await protocol.getMetaTypes();
            const entry = listing.entries.find((e: any) => e.type === type);

            // The type must be LISTED either way. Withdrawing the advertisement
            // is not withdrawing the type: `GET /meta/data/...` still answers,
            // and a listing that dropped these would trade one declared-≠-served
            // gap for another.
            expect(entry, `${type} must still be listed`).toBeDefined();
            expect(entry.allowRuntimeCreate).toBe(creatable);
        },
    );

    it.each(SAMPLE)(
        '$klass `$type`: PUT /meta/:type/:name behaves as advertised',
        async ({ type, creatable, item }) => {
            const { protocol, rows } = makeProtocol();
            const save = protocol.saveMetaItem({ type, name: item.name, item });

            if (creatable) {
                await expect(save).resolves.toMatchObject({ success: true });
                expect(rows.has(`${type}|${item.name}`), `${type} row must be persisted`).toBe(true);
                return;
            }
            // ADR-0112 — code AND status, never "it threw". A bare `.toThrow()`
            // would stay green on the 422 an unknown type earns from schema
            // resolution, which is not the verdict under test.
            await expect(save).rejects.toMatchObject({
                code: expect.stringMatching(/^(INVALID_REQUEST|NOT_CREATABLE)$/),
                status: expect.any(Number),
            });
            // …and the namespace this card is named for is never minted.
            expect(rows.size, `${type} must persist nothing`).toBe(0);
        },
    );

    it('the two doors are read off ONE fact, not compared by hand', async () => {
        // The assertion that would survive a future refactor of either door:
        // for every sampled type, "advertised creatable" and "the write is
        // honoured" are the same boolean. Written as a cross-product rather
        // than two independent tables so a drift in either direction fails
        // here even if both tables above were updated together and wrongly.
        const { protocol } = makeProtocol();
        const listing = await protocol.getMetaTypes();

        for (const { type, item } of SAMPLE) {
            const advertised = listing.entries.find((e: any) => e.type === type)?.allowRuntimeCreate;
            const fresh = makeProtocol();
            let honoured: boolean;
            try {
                await fresh.protocol.saveMetaItem({ type, name: item.name, item });
                honoured = true;
            } catch {
                honoured = false;
            }
            expect(honoured, `${type}: advertised ${advertised}, write honoured ${honoured}`)
                .toBe(advertised);
        }
    });

    it('the six URL-map-only plugin kinds are ALL still advertised as creatable', async () => {
        // The blanket-flip guard, quantified rather than sampled. `theme` above
        // is the one driven end-to-end through a write; these five have no
        // hand-written spec-valid body here, so they are pinned on the door
        // that this change actually moved — the advertisement. Breaking any of
        // them is the one outcome that would make this change worse than the
        // defect it closes.
        const { protocol } = makeProtocol();
        const listing = await protocol.getMetaTypes();
        for (const kind of [
            'analytics_cube', 'connector', 'rag_pipeline', 'sharing_rule', 'theme', 'webhook',
        ]) {
            const entry = listing.entries.find((e: any) => e.type === kind);
            expect(entry, `${kind} must be listed`).toBeDefined();
            expect(entry.allowRuntimeCreate, `${kind} must stay creatable`).toBe(true);
        }
    });
});
