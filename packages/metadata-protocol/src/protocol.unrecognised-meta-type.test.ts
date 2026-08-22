// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8421 — a `/meta` type name that is not a plural of anything no longer mints
 * a namespace.
 *
 * `PUT /api/v1/meta/fieldz/showcase_task.title` answered `200 {"success":true}`
 * and persisted a `sys_metadata` row under `type='fieldz'`: a namespace for a
 * metadata type that does not exist and never will. #7894 closed the sibling
 * case (a plural spelling of a DECLARED type) and left this one open on purpose,
 * because a static predicate could not tell `fieldz` from a plugin kind and the
 * live-registry alternative was measured to be worse than the defect — the live
 * set is ITEM-POPULATED, so it omits every legitimate kind that has no items
 * yet, which is the state each one is in immediately before its first create.
 *
 * Maintainer ruling 2026-08-14 (「同意」), joint with #8586: retiring
 * `MetadataPluginConfig.additionalTypes` removed the last channel by which a
 * plugin could DECLARE a kind, so an unrecognised name can no longer be a
 * declaration the boundary has not heard about. That is what makes the static
 * refusal safe by construction rather than by luck.
 *
 * ## What this suite pins, in both directions
 *
 * A suite that only asserted "`fieldz` is refused" would be satisfied by a
 * boundary that refuses everything, so every refusal case here is paired with
 * the traffic that must keep working:
 *
 *  - a DECLARED type still saves (`view`), and so does a type whose only write
 *    channel is runtime (`hook`);
 *  - a PLUGIN kind with no static registry entry still saves (`webhook`;
 *    `theme` was the specimen until #10485 retired that kind entirely) — the
 *    operation option C would have broken, and the one this change must not;
 *  - READS of an unrecognised type still answer, because the live type set
 *    legitimately holds keys the static contract does not (`data`, `kind` and
 *    `package` all enter `SchemaRegistry` during an ordinary `registerApp`, and
 *    `GET /api/v1/meta/types` lists exactly that set);
 *  - DELETE of a row minted under an unrecognised type before this change still
 *    works, or the accumulation this card was filed about would become
 *    unremovable.
 *
 * The last two describe blocks pin the two exemptions the first cut lacked, each
 * paired with the refusal that must survive it: the COMPOUND arity (whose
 * `:type` segment carries an OBJECT name) and an already-stored namespace (which
 * is not being minted by definition). `protocol.stored-residue-resave.test.ts`
 * carries the production paths that made the second one necessary.
 *
 * Harness: the real `saveMetaItem` write path over a stub engine, the shape
 * `protocol.code-only-types.test.ts` uses. A gate INSIDE `saveMetaItem` cannot
 * be measured against a harness that mocks `saveMetaItem`.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL itself refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    /** A real `checksum` is required or the OCC parent-version check 409s */
    /** before `deleteMetaItem` reaches anything this suite is about. */
    checksum: string;
    metadata: string;
}

function makeProtocol(seedRows: Array<Partial<Row>> = []) {
    const rows = new Map<string, Row>();
    let nextId = 0;
    // Reads the four key fields structurally, so both a stored `Row` and the
    // loose record `insert` hands over key identically (an interface is not
    // assignable to `Record<string, unknown>`, and this package's tsc error
    // count is a shrink-only ratchet — a cast here would spend it).
    const keyOf = (w: { type?: unknown; name?: unknown; organization_id?: unknown; state?: unknown }) =>
        `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;
    for (const seed of seedRows) {
        nextId += 1;
        const row = {
            id: `seed_${nextId}`,
            organization_id: null,
            state: 'active',
            checksum: 'sha256:stored-head',
            metadata: JSON.stringify({ name: seed.name, label: 'Stored' }),
            ...seed,
        } as Row;
        rows.set(keyOf(row), row);
    }
    const deletes: Array<Record<string, unknown> | undefined> = [];
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            for (const row of rows.values()) {
                if (opts.where.type !== undefined && row.type !== opts.where.type) continue;
                if (opts.where.name !== undefined && row.name !== opts.where.name) continue;
                return row;
            }
            return null;
        },
        async find(_t: string, opts?: { where?: Record<string, unknown> }) {
            const where = opts?.where ?? {};
            return [...rows.values()].filter((row) =>
                (where.type === undefined || row.type === where.type)
                && (where.name === undefined || row.name === where.name));
        },
        async insert(_t: string, data: Record<string, unknown>) {
            if (_t !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            deletes.push(opts);
            const id = (opts as any)?.where?.id;
            for (const [key, row] of rows.entries()) if (row.id === id) rows.delete(key);
            return { deleted: 1 };
        },
        async count() { return 0; },
        async transaction(fn: (ctx: unknown) => Promise<unknown>) { return fn(undefined); },
        async execute() { return {}; },
        async getObjectSchema() { return undefined; },
        registry: {
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
    return { protocol, rows, deletes };
}

const metaRows = (rows: Map<string, Row>) => [...rows.values()].filter((r) => r.type !== undefined);

/** The card's own coordinates, plus three more names of the same class. */
const UNRECOGNISED = ['fieldz', 'objectt', 'viewz', 'nonsense_type'];

describe('#8421 — an unrecognised `/meta` type is refused instead of minted', () => {
    it.each(UNRECOGNISED)('refuses PUT /meta/%s/:name with the ADR-0112 envelope', async (type) => {
        const { protocol, rows } = makeProtocol();

        // The envelope, not just the throw (ADR-0112): a bare `.toThrow()`
        // would stay green against an unrelated failure one layer down —
        // notably the 422 an unknown type earns from schema resolution — and
        // would prove nothing about the refusal being tested.
        await expect(
            protocol.saveMetaItem({ type, name: 'showcase_task.title', item: { name: 'x' } }),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });

        // And the point of the card: nothing is persisted. A refusal that threw
        // after the insert would still leave the namespace behind.
        expect(metaRows(rows).length).toBe(0);
    });

    it("[#10485] `theme` is now on the refused side — the retired kind left the spelling contract", async () => {
        // Until #10485, `theme` was a URL-map-only plugin kind and this suite's
        // ACCEPTED specimen. The retirement removed the `themes: 'theme'` fold
        // from `PLURAL_TO_SINGULAR`, so `/meta/theme` now earns the same
        // ADR-0112 refusal as any minted namespace — loud, and nothing stored.
        const { protocol, rows } = makeProtocol();
        await expect(
            protocol.saveMetaItem({ type: 'theme', name: 'dark', item: { name: 'dark', label: 'Dark', colors: { primary: '#3b82f6' } } }),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
        expect(metaRows(rows).length).toBe(0);
    });

    it('names the offending type and why, per the 2026-08-12 refusal ruling', async () => {
        const { protocol } = makeProtocol();
        await expect(
            protocol.saveMetaItem({ type: 'fieldz', name: 'showcase_task.title', item: { name: 'x' } }),
        ).rejects.toThrow(/'fieldz' is not a metadata type/);
    });

    it('does not answer the sibling verdict — this is not a misspelling refusal', async () => {
        // `fieldz` reaches for no declared type, so it must NOT be reported as
        // a misspelling of one. Keeping the two verdicts apart is what lets
        // #7894's message name a replacement spelling and this one stay silent
        // rather than guess.
        const { protocol } = makeProtocol();
        await expect(
            protocol.saveMetaItem({ type: 'fieldz', name: 'showcase_task.title', item: { name: 'x' } }),
        ).rejects.not.toThrow(/recognised spelling of metadata type/);
    });
});

describe('#8421 — the traffic that must keep working', () => {
    const ACCEPTED: Array<{ type: string; item: Record<string, unknown>; why: string }> = [
        {
            type: 'view',
            why: 'declared, allowOrgOverride + allowRuntimeCreate',
            item: {
                name: 'probe_item',
                label: 'Probe',
                object: 'task',
                viewKind: 'list',
                columns: [{ field: 'name', label: 'Name' }],
            },
        },
        {
            type: 'hook',
            why: 'declared, runtime-create only',
            item: { name: 'probe_item', object: 'task', events: ['beforeUpdate'] },
        },
        {
            // `theme` held this slot until #10485 retired the themes surface
            // (ADR-0049) and `theme` left the URL-spelling contract with it.
            type: 'webhook',
            why: 'PLUGIN kind — no static registry entry at all',
            // [#6245] spec-valid body — webhook resolves a schema.
            item: { name: 'probe_item', label: 'Probe', object: 'task', triggers: ['create'], url: 'https://example.com/hook' },
        },
    ];

    for (const { type, item, why } of ACCEPTED) {
        it(`still saves ${type} (${why})`, async () => {
            const { protocol, rows } = makeProtocol();
            const result = await protocol.saveMetaItem({ type, name: 'probe_item', item });
            expect(result.success).toBe(true);
            expect(metaRows(rows).length).toBe(1);
            expect(metaRows(rows)[0]!.type).toBe(type);
        });
    }

    it('POSITIVE CONTROL — the plugin path still serves its first create', async () => {
        // The measurement that disqualified option C, kept as a live control:
        // `webhook` has ZERO items at this moment, which is exactly the state a
        // live-registry check would have refused. The refusal that shipped
        // consults the static contract instead, so the first create of a
        // plugin kind is untouched.
        const { protocol, rows } = makeProtocol();
        // Spec-valid body — this control measures the STATIC-contract door,
        // not the shape check. (`theme` was the specimen until #10485.)
        const result = await protocol.saveMetaItem({
            type: 'webhook',
            name: 'first_hook',
            item: { name: 'first_hook', label: 'First', object: 'task', triggers: ['create'], url: 'https://example.com/hook' },
        });
        expect(result.success).toBe(true);
        expect(metaRows(rows)[0]!.type).toBe('webhook');
    });
});

describe('#8421 — the refusal is scoped to the door that MINTS', () => {
    it('leaves READS of an unrecognised type answering', async () => {
        // Measured reason, not caution: an ordinary `registerApp` puts `data`,
        // `kind` and `package` into `SchemaRegistry`, and `getMetaTypes()`
        // enumerates that live set — so a read-side refusal would answer 400
        // for types this same service advertises. `fieldz` stands in for the
        // whole class here because the stub registry holds no items.
        const { protocol } = makeProtocol();
        await expect(protocol.getMetaItems({ type: 'fieldz' })).resolves.toBeDefined();
        await expect(protocol.getMetaItem({ type: 'fieldz', name: 'showcase_task.title' }))
            .resolves.not.toThrow;
    });

    it('leaves a legacy row under an unrecognised type DELETABLE', async () => {
        // Rows minted before this refusal are real and nothing rewrites them on
        // upgrade. Refusing delete would strand them permanently — turning the
        // accumulation this card was filed about into an accumulation nobody
        // can clear.
        const { protocol, rows } = makeProtocol([
            { type: 'fieldz', name: 'showcase_task.title' },
        ]);
        expect(metaRows(rows).length).toBe(1);
        await expect(
            protocol.deleteMetaItem({ type: 'fieldz', name: 'showcase_task.title' }),
        ).resolves.toBeDefined();
    });

    it('still refuses the same name on a re-mint after the delete', async () => {
        // The pair that proves the scoping is a policy rather than an accident
        // of ordering: the row can leave, and it cannot come back. It is also
        // the negative half of the already-stored exemption below — with the
        // last `fieldz` row gone the namespace no longer exists, so the door
        // closes again on the very name it had just let out.
        const { protocol } = makeProtocol([{ type: 'fieldz', name: 'showcase_task.title' }]);
        await protocol.deleteMetaItem({ type: 'fieldz', name: 'showcase_task.title' });
        await expect(
            protocol.saveMetaItem({ type: 'fieldz', name: 'showcase_task.title', item: { name: 'x' } }),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
    });
});

describe('#8421 — the COMPOUND arity carries an OBJECT name, not a type claim', () => {
    // `/metadata/lead/views/all_leads` → `type='lead'`, `name='views/all_leads'`.
    // One operation, one `saveMetaItem`; the runtime dispatcher's `/meta` branch
    // and `rest`'s `PUBLISHED_COMPOUND` route both document that shape verbatim.
    // `lead` is an OBJECT — runtime data no static contract can enumerate — so
    // a type verdict applied to that segment refuses every object name that is
    // not coincidentally a metadata type. Measured as a regression of the first
    // cut in two packages; the ruling this card implements is about metadata
    // TYPE names like `fieldz`.
    const VIEW_BODY = { name: 'all_leads', label: 'All Leads', columns: ['name'] };

    it('saves a sub-resource under an object name the static contract cannot know', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await protocol.saveMetaItem({
            type: 'lead', name: 'views/all_leads', item: VIEW_BODY,
        });

        expect(result.success).toBe(true);
        // The compound name is ONE key — not split, not truncated to its last
        // segment — which is what makes this the same operation the two
        // transports document rather than a lookalike.
        expect(metaRows(rows)).toHaveLength(1);
        expect(metaRows(rows)[0]).toMatchObject({ type: 'lead', name: 'views/all_leads' });
    });

    it('and the exemption is the ARITY, not the name — `lead` alone is still refused', async () => {
        // ANTI-VACUITY, and the line between the two fixes: at the simple arity
        // the `:type` segment IS a type claim, so the same string that is a
        // legal owner above is an illegal type here. Without this case the
        // exemption above would be indistinguishable from "stop refusing".
        const { protocol, rows } = makeProtocol();

        await expect(
            protocol.saveMetaItem({ type: 'lead', name: 'all_leads', item: VIEW_BODY }),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
        expect(metaRows(rows)).toHaveLength(0);
    });
});

describe('#8421 — a namespace that ALREADY EXISTS is not being minted', () => {
    it('accepts a NEW item under a residue type that has stored rows', async () => {
        // The exemption `duplicatePackage` needs (measured in
        // `protocol.stored-residue-resave.test.ts`): the copy re-saves a stored
        // row's type under a NEW name, so an exemption keyed on the exact item
        // would not reach it. What is exempt is the namespace, and the STORE is
        // what says it exists — never the caller.
        const { protocol, rows } = makeProtocol([{ type: 'fieldz', name: 'showcase_task.title' }]);

        const result = await protocol.saveMetaItem({
            type: 'fieldz', name: 'showcase_task.due_at', item: { name: 'showcase_task.due_at' },
        });

        expect(result.success).toBe(true);
        expect(metaRows(rows)).toHaveLength(2);
    });

    it('POSITIVE CONTROL — a FRESH unrecognised type is still refused in the same store', async () => {
        // The pair is the whole point: residue stays workable, and the door
        // that mints the FIRST row of a namespace nothing serves stays shut.
        // Same protocol instance, so this cannot pass by the store being empty.
        const { protocol, rows } = makeProtocol([{ type: 'fieldz', name: 'showcase_task.title' }]);

        await expect(
            protocol.saveMetaItem({ type: 'objectt', name: 'showcase_task', item: { name: 'x' } }),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
        expect(metaRows(rows)).toHaveLength(1);
    });
});
