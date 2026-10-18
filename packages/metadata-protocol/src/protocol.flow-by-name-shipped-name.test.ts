// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20946, #20761 ruling rule 1, ADR-0126 §2 / §3] The by-name read of a flow
 * name the loader's set holds serves the loader's body — the body the list
 * serves for that name — and never a stored row of that name under the
 * package's provenance.
 *
 * `flow` is Regime C: the packaged base is locked, "⛔ Never silent override,
 * never an overlay read path". Since #20913 the flattened view (both faces of
 * `getMetaItems`) applies that by name, with two predicates: the stored-row
 * half ({@link ObjectStackProtocolImplementation.isShippedFlowName}) and the
 * registry half (`isStoredFlowEntryOfShippedName`). `getMetaItem` applied
 * neither: it adopted the environment-wide stored row, then grafted the
 * artifact's protection envelope over it, so the two read doors answered two
 * different bodies for one name. It now calls the same two predicates.
 *
 * The registry double keeps the real `SchemaRegistry`'s key shape
 * (`<package>:<name>` for a loader entry, the bare name for a hydrated row), its
 * `getItem` precedence (the bare slot first) and its artifact lookup
 * (package-scoped code-artifact entries first). `@objectstack/objectql` cannot
 * be imported here: it depends on this package. The cold-boot proof over the
 * real composition is `flow-shipped-name-by-name-read.dogfood.test.ts`.
 *
 * Controls: a flow name no managed package ships keeps its stored row (the
 * tenant's own flow), a shipped name with no stored row is unchanged, a
 * caller naming an organization reads as the environment does, and a type in
 * the overlay regime keeps its overlay.
 */
import { describe, expect, it, vi } from 'vitest';
import { assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import type { FlowRegistration } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

const PACKAGE_ID = 'com.example.pkg';
const SHIPPED = 'pkg_flow';
const CUSTOMER = 'customer_flow';
const ORG_ID = 'org_a';

const flowBody = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
    name,
    label,
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
    ...extra,
});

interface StoredRow {
    id: string;
    type: string;
    name: string;
    package_id: string | null;
    state: string;
    metadata: string;
}

const storedRow = (type: string, name: string, body: unknown, extra: Partial<StoredRow> = {}): StoredRow => ({
    id: `r_${type}_${name}_env`,
    type,
    name,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify(body),
    ...extra,
});

/**
 * A registry double with the real `SchemaRegistry`'s two key shapes, its
 * `getItem` precedence and its artifact lookup. `registerItem` stamps a package
 * entry the way `applyProtection` does and leaves a bare registration's
 * provenance alone.
 */
/** [#24371] One `where` value as the store reads it: `{ $in: [...] }` (the by-name read's both-spellings `type`) or equality. */
const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

function registryDouble() {
    const byType = new Map<string, Map<string, Record<string, unknown>>>();
    const collection = (type: string) => {
        if (!byType.has(type)) byType.set(type, new Map());
        return byType.get(type)!;
    };
    return {
        registerItem(type: string, item: Record<string, unknown>, keyField = 'name', packageId?: string) {
            const name = String(item[keyField]);
            if (packageId) {
                if (item._packageId === undefined) item._packageId = packageId;
                if (item._provenance === undefined) item._provenance = 'package';
                collection(type).set(`${packageId}:${name}`, item);
            } else {
                collection(type).set(name, item);
            }
        },
        listItems(type: string, packageId?: string) {
            const all = [...(byType.get(type)?.values() ?? [])];
            return packageId ? all.filter((it) => it._packageId === packageId) : all;
        },
        /** The real precedence: the bare slot, then prefer-local, then the first composite. */
        getItem(type: string, name: string, packageId?: string) {
            const entries = byType.get(type);
            if (!entries) return undefined;
            const direct = entries.get(name);
            if (direct) return direct;
            if (packageId) {
                const local = entries.get(`${packageId}:${name}`);
                if (local) return local;
            }
            for (const [key, item] of entries) if (key.endsWith(`:${name}`)) return item;
            return undefined;
        },
        getArtifactItem(type: string, name: string, packageId?: string) {
            const entries = [...(byType.get(type)?.entries() ?? [])];
            const scoped = entries.filter(([key, it]) => key.endsWith(`:${name}`) && isCodeArtifactBody(it));
            const local = packageId ? scoped.find(([, it]) => it._packageId === packageId) : undefined;
            if (local) return local[1];
            if (scoped[0]) return scoped[0][1];
            const bare = byType.get(type)?.get(name);
            return bare && isCodeArtifactBody(bare) ? bare : undefined;
        },
        bare(type: string, name: string) {
            return byType.get(type)?.get(name);
        },
        getObject: () => undefined,
        registerObject: () => undefined,
        getPackage: () => undefined,
        isPackageDisabled: () => false,
        applyNavContributions: (app: unknown) => app,
    };
}

/**
 * The engine double: `find` / `findOne` over `sys_metadata` rows, plus the
 * registry. ⛔ No `insert` / `update` / `delete` — the read paths under test
 * issue no write verb.
 */
function harness(rows: StoredRow[], services: Map<string, unknown> = new Map()) {
    const registry = registryDouble();
    // What the loader registered: one packaged flow and one packaged view.
    registry.registerItem('flow', flowBody(SHIPPED, 'LOADER'), 'name', PACKAGE_ID);
    registry.registerItem('view', { name: 'pkg_view', label: 'LOADER VIEW' }, 'name', PACKAGE_ID);
    const matching = (where: Record<string, unknown>) => {
        for (const k of Object.keys(where)) {
            if (k.startsWith('$')) throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
        }
        return rows.filter((r) =>
            Object.entries(where).every(([k, v]) => v === undefined || whereValueMatches((r as unknown as Record<string, unknown>)[k], v)),
        );
    };
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = matching(opts?.where ?? {});
            // `check:objectql-double-limit` — the caller's bound, applied after the filter.
            return opts?.limit === undefined ? matched : matched.slice(0, opts.limit);
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            // `check:engine-double-contract` — refuses what the real engine refuses.
            assertEngineFindOnePredicate(table, opts);
            if (table !== 'sys_metadata') return null;
            return matching(opts?.where ?? {})[0] ?? null;
        },
        registry,
    };
    // [#23316] The kernel's service table — empty unless a case hands one in.
    const protocol = new ObjectStackProtocolImplementation(engine, () => services as Map<string, any>);
    return { protocol, registry };
}

const byName = async (protocol: ObjectStackProtocolImplementation, request: Record<string, unknown>) =>
    ((await protocol.getMetaItem(request as any)) as { item: Record<string, unknown> }).item;
const listed = async (protocol: ObjectStackProtocolImplementation, name: string) =>
    ((await protocol.getMetaItems({ type: 'flow' })) as { items: Array<Record<string, unknown>> }).items
        .filter((it) => it.name === name);

describe('[#20946] the by-name read of a shipped flow name serves the loader\'s body', () => {
    it('a shipped name with an environment-wide stored row answers the loader\'s body, not the row\'s', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);

        const served = await byName(protocol, { type: 'flow', name: SHIPPED });

        expect(served.label).toBe('LOADER');
        expect(served._packageId).toBe(PACKAGE_ID);
    });

    it('it does so after the row was hydrated — the registry\'s bare copy of the row does not stand in either', async () => {
        const { protocol, registry } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);
        await protocol.getMetaItemsForExecution({ type: 'flow' }); // hydrates the row under the bare key
        expect(registry.bare('flow', SHIPPED)?.label).toBe('STORED');

        const served = await byName(protocol, { type: 'flow', name: SHIPPED });

        expect(served.label).toBe('LOADER');
    });

    it('by name and in the list, the shipped name answers the same body', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);

        const list = await listed(protocol, SHIPPED);
        const served = await byName(protocol, { type: 'flow', name: SHIPPED });

        expect(list.map((it) => it.label)).toEqual(['LOADER']);
        expect(served.label).toBe(list[0].label);
        expect(served.nodes).toEqual(list[0].nodes);
    });

    it('the package-scoped read answers the loader\'s body too', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);

        const served = await byName(protocol, { type: 'flow', name: SHIPPED, packageId: PACKAGE_ID });

        expect(served.label).toBe('LOADER');
    });

    it('a row bound to the shipping package, or one whose own body claims its provenance, is judged by name alone', async () => {
        for (const row of [
            storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'), { package_id: PACKAGE_ID }),
            storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED', { _packageId: PACKAGE_ID, _provenance: 'package' })),
        ]) {
            for (const request of [
                { type: 'flow', name: SHIPPED },
                { type: 'flow', name: SHIPPED, packageId: PACKAGE_ID },
            ]) {
                const { protocol } = harness([row]);
                expect((await byName(protocol, request)).label).toBe('LOADER');
            }
        }
    });

    it('the plural spelling of the type is folded first and answers the same', async () => {
        const { protocol } = harness([storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED'))]);

        const served = await byName(protocol, { type: 'flows', name: SHIPPED });

        expect(served.label).toBe('LOADER');
    });

    it('control: a flow name no managed package ships answers its stored row, unchanged', async () => {
        const { protocol } = harness([storedRow('flow', CUSTOMER, flowBody(CUSTOMER, 'CUSTOMER'))]);

        const served = await byName(protocol, { type: 'flow', name: CUSTOMER });

        expect(served.label).toBe('CUSTOMER');
        expect(isCodeArtifactBody(served)).toBe(false);
    });

    it('control: a shipped name with no stored row answers the loader\'s body, unchanged', async () => {
        const { protocol } = harness([]);

        const served = await byName(protocol, { type: 'flow', name: SHIPPED });

        expect(served.label).toBe('LOADER');
    });

    it('control: a caller naming an organization reads as the environment does', async () => {
        const { protocol } = harness([
            storedRow('flow', SHIPPED, flowBody(SHIPPED, 'STORED ROW')),
            storedRow('flow', CUSTOMER, flowBody(CUSTOMER, 'STORED ROW')),
        ]);

        expect((await byName(protocol, { type: 'flow', name: SHIPPED, organizationId: ORG_ID })).label).toBe('LOADER');
        expect((await byName(protocol, { type: 'flow', name: CUSTOMER, organizationId: ORG_ID })).label).toBe('STORED ROW');
    });

    it('control: an overlay of a packaged type in the overlay regime is still served over the artifact', async () => {
        const { protocol } = harness([storedRow('view', 'pkg_view', { name: 'pkg_view', label: 'OVERLAY VIEW' })]);

        const served = await byName(protocol, { type: 'view', name: 'pkg_view' });

        expect(served.label).toBe('OVERLAY VIEW');
        expect(served._packageId).toBe(PACKAGE_ID);
    });
});

/**
 * [#23316] The meta read serves the automation engine's verdict on a stored
 * flow BESIDE the item, read from the kernel's service table by name:
 * `registration`, an envelope sibling of `lock` on the item read, and
 * `registrations`, keyed by name, beside the list's items. Both are the
 * engine's answer (`IAutomationService.getFlowRegistration`) or nothing — the
 * protocol never makes one up — so a host with no automation service, or a
 * type the engine does not judge, reads no field at all, and the stored body,
 * its `status` included, is served as stored.
 *
 * In this file for its engine double (the read paths under test are the ones
 * above). The real composition — ObjectQL's protocol over SQLite and the real
 * engine refusing at the `kernel:ready` bind — is pinned in
 * service-automation's `flow-refused-registration-read.integration.test.ts`.
 */
const REFUSED: FlowRegistration = { state: 'refused', reason: { code: 'SOME_ENGINE_CODE', message: 'the engine said no' } };
const VERDICT_ROWS = [
    storedRow('flow', 'refused_flow', flowBody('refused_flow', 'REFUSED', { status: 'active' })),
    storedRow('flow', CUSTOMER, flowBody(CUSTOMER, 'CUSTOMER', { status: 'active' })),
];

/** The engine's answers, per name; any other name reads `unregistered`. */
function automationDouble(answers: Record<string, FlowRegistration>) {
    return {
        getFlowRegistration: vi.fn((name: string): FlowRegistration => answers[name] ?? { state: 'unregistered' }),
    };
}

describe('[#23316] the item read: `registration` beside `lock`, the engine\'s answer or nothing', () => {
    it('serves what the engine answered for that name, and the stored body unchanged', async () => {
        const automation = automationDouble({ refused_flow: REFUSED });
        const { protocol } = harness(VERDICT_ROWS, new Map([['automation', automation]]));

        const read: any = await protocol.getMetaItem({ type: 'flow', name: 'refused_flow' });

        expect(read.registration).toEqual(REFUSED);
        expect(automation.getFlowRegistration).toHaveBeenCalledWith('refused_flow');
        // Beside the item, never inside it — and the author's `status` as stored.
        expect(read.item.status).toBe('active');
        expect(read.item).not.toHaveProperty('registration');
        expect(read).toHaveProperty('lock');
    });

    it('control: no automation service, or one that declares no verdict member — no field at all', async () => {
        for (const services of [new Map(), new Map([['automation', { getFlow: async () => null }]])]) {
            const { protocol } = harness(VERDICT_ROWS, services as Map<string, unknown>);
            const read: any = await protocol.getMetaItem({ type: 'flow', name: 'refused_flow' });
            expect(read.item.status).toBe('active');
            expect(read).not.toHaveProperty('registration');
        }
    });

    it('a type the automation engine does not judge reads no field, and the engine is never asked', async () => {
        const automation = automationDouble({});
        const { protocol } = harness(
            [storedRow('view', 'pkg_view', { name: 'pkg_view', label: 'OVERLAY VIEW' })],
            new Map([['automation', automation]]),
        );

        const read: any = await protocol.getMetaItem({ type: 'view', name: 'pkg_view' });

        expect(read.item.label).toBe('OVERLAY VIEW');
        expect(read).not.toHaveProperty('registration');
        expect(automation.getFlowRegistration).not.toHaveBeenCalled();
    });

    it('a draft read carries none: the pending body is not what the engine holds', async () => {
        const automation = automationDouble({ refused_flow: REFUSED });
        const { protocol } = harness(
            [...VERDICT_ROWS, storedRow('flow', 'refused_flow', flowBody('refused_flow', 'DRAFT'), { state: 'draft' })],
            new Map([['automation', automation]]),
        );

        const read: any = await protocol.getMetaItem({ type: 'flow', name: 'refused_flow', state: 'draft' });

        expect(read.item.label).toBe('DRAFT');
        expect(read).not.toHaveProperty('registration');
    });
});

describe('[#23316] the list: `registrations` beside the items, keyed by name', () => {
    it('one entry per listed item, the engine\'s answer for each — a loader\'s flow included; the items stay bare', async () => {
        const automation = automationDouble({ refused_flow: REFUSED, [CUSTOMER]: { state: 'registered' } });
        const { protocol } = harness(VERDICT_ROWS, new Map([['automation', automation]]));

        const list: any = await protocol.getMetaItems({ type: 'flow' });

        expect(list.registrations).toEqual({
            refused_flow: REFUSED,
            [CUSTOMER]: { state: 'registered' },
            [SHIPPED]: { state: 'unregistered' },
        });
        for (const item of list.items) expect(item).not.toHaveProperty('registration');
    });

    it('control: no automation service — no `registrations`; and the execution face never carries one', async () => {
        const bare: any = await harness(VERDICT_ROWS).protocol.getMetaItems({ type: 'flow' });
        expect(bare.items.length).toBeGreaterThan(0);
        expect(bare).not.toHaveProperty('registrations');

        const automation = automationDouble({ refused_flow: REFUSED });
        const execution: any = await harness(VERDICT_ROWS, new Map([['automation', automation]]))
            .protocol.getMetaItemsForExecution({ type: 'flow' });
        expect(execution).not.toHaveProperty('registrations');
        expect(automation.getFlowRegistration).not.toHaveBeenCalled();
    });

    it('a pending draft overlaid on the list gets no entry', async () => {
        const automation = automationDouble({ refused_flow: REFUSED });
        const { protocol } = harness(
            [...VERDICT_ROWS, storedRow('flow', 'draft_only', flowBody('draft_only', 'DRAFT'), { state: 'draft' })],
            new Map([['automation', automation]]),
        );

        const list: any = await protocol.getMetaItems({ type: 'flow', previewDrafts: true });

        expect(list.items.map((i: any) => i.name)).toContain('draft_only');
        expect(Object.keys(list.registrations)).not.toContain('draft_only');
        expect(Object.keys(list.registrations)).toContain('refused_flow');
    });
});

describe('[#23316] the cached read — the default door — carries the verdict beside `data`, never in the ETag', () => {
    it('serves the engine\'s answer live beside the document, with an ETag over the document alone', async () => {
        const automation = automationDouble({ refused_flow: REFUSED });
        const services = new Map<string, unknown>([['automation', automation]]);
        const judged: any = await harness(VERDICT_ROWS, services).protocol.getMetaItemCached({ type: 'flow', name: 'refused_flow' });
        const unjudged: any = await harness(VERDICT_ROWS).protocol.getMetaItemCached({ type: 'flow', name: 'refused_flow' });

        expect(judged.registration).toEqual(REFUSED);
        expect(judged.data.status).toBe('active');
        expect(judged.data).not.toHaveProperty('registration');
        // The verdict is in no validator: the same document, the same ETag.
        expect(judged.etag).toEqual(unjudged.etag);
        expect(unjudged).not.toHaveProperty('registration');
    });

    it('a read that carries the verdict is never answered 304; control: one with no engine still is', async () => {
        const services = new Map<string, unknown>([['automation', automationDouble({ refused_flow: REFUSED })]]);
        const first: any = await harness(VERDICT_ROWS, services).protocol.getMetaItemCached({ type: 'flow', name: 'refused_flow' });
        const revalidate = { type: 'flow', name: 'refused_flow', cacheRequest: { ifNoneMatch: `"${first.etag.value}"` } };

        const judged: any = await harness(VERDICT_ROWS, services).protocol.getMetaItemCached(revalidate);
        expect(judged.notModified).toBe(false);
        expect(judged.registration).toEqual(REFUSED);

        const unjudged: any = await harness(VERDICT_ROWS).protocol.getMetaItemCached(revalidate);
        expect(unjudged.notModified).toBe(true);
    });
});
