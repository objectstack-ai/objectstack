// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4498 — the flow-skip becomes ONE seam, and `duplicatePackage` stops minting
 * pre-protocol flow rows.
 *
 * `convertStoredItem` returns `flow` bodies untouched, because flow-node
 * conversions carry ADR-0078's open-namespace conflict guard and that needs the
 * automation engine's live executor registry. #4454 built the capability
 * (`AutomationEngine.canonicalizeStoredFlow`) and handed it to
 * `migrateStoredMetadata` as an explicit hook, because the CLI has to boot an
 * engine of its own to hold one.
 *
 * Inside a server there is nothing to thread: the protocol is constructed with
 * an accessor for the kernel's service table. `resolveFlowCanonicalizer` reads
 * the engine from it, which is what these tests pin — and it is what makes the
 * skip fixable at `duplicatePackage`, a WRITE that was contradicting ADR-0087's
 * "new rows are always canonical, so the stored pass is a strictly shrinking
 * concern" on every duplication of a package containing a pre-17 flow.
 */
import { describe, expect, it, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** A flow body that passes `saveMetaItem`'s schema gate. */
const flowBody = (config: Record<string, unknown>) => ({
    name: 'purge_flow',
    label: 'Purge Stale Leads',
    type: 'autolaunched',
    status: 'active',
    nodes: [{ id: 'n1', type: 'delete_record', label: 'Purge', config }],
    edges: [],
});

/**
 * Stands in for `AutomationEngine.canonicalizeStoredFlow` — same contract,
 * including the copy-on-write identity an unchanged body comes back with.
 */
const canonicalizeStoredFlow = (_name: string, body: any) => {
    const node = body?.nodes?.[0];
    if (!node || !('filters' in (node.config ?? {}))) {
        return { storable: body, notices: [], conflicts: [] };
    }
    const { filters, ...rest } = node.config;
    return {
        storable: { ...body, nodes: [{ ...node, config: { ...rest, filter: filters } }] },
        notices: [{
            conversionId: 'flow-node-crud-filter-alias',
            surface: 'flow.node.config.filter',
            from: 'filters',
            to: 'filter',
            path: 'flows[0].nodes[0].config',
            message: 'filters → filter',
        }],
        conflicts: [],
    };
};

function matches(r: Record<string, any>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if ((r[k] ?? null) !== v) return false;
    }
    return true;
}

/**
 * Protocol over a stub engine, with a services table under the caller's
 * control — the whole point is that the protocol reads `automation` out of it
 * rather than being handed a hook.
 */
function makeProtocol(
    rows: Array<Record<string, any>>,
    services: Map<string, any> = new Map(),
) {
    const seeded = rows.map((r, i) => ({
        id: `r_${i + 1}`,
        organization_id: null,
        package_id: null,
        state: 'active',
        checksum: `sha256:seed_${i + 1}`,
        ...r,
        metadata: typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata),
    }));
    const engine: any = {
        find: vi.fn(async (_t: string, opts?: { where?: Record<string, unknown> }) =>
            seeded.filter((r) => matches(r, opts?.where ?? {}))),
        registry: {
            getPackage: vi.fn(() => ({
                manifest: { id: 'app.iojn', name: 'Repair', namespace: 'iojn', version: '1.0.0', type: 'application' },
            })),
            installPackage: vi.fn(),
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => services);
    const saveMetaItem = vi.spyOn(protocol, 'saveMetaItem' as never);
    (saveMetaItem as any).mockResolvedValue({ success: true } as never);
    return { protocol, saveMetaItem, services };
}

describe('migrateStoredMetadata resolves the engine itself (#4498)', () => {
    const legacyFlowRow = {
        type: 'flow',
        name: 'purge_flow',
        metadata: flowBody({ objectName: 'lead', filters: { status: 'stale' } }),
    };

    it('canonicalizes a flow row with NO canonicalizeFlow threaded by the caller', async () => {
        const { protocol, saveMetaItem } = makeProtocol(
            [legacyFlowRow],
            new Map([['automation', { canonicalizeStoredFlow }]]),
        );

        // No hook. This is the whole claim: a caller running next to a live
        // engine — an admin route, a server task — gets flow coverage for free.
        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.rewritten).toBe(1);
        expect(report.skipped).toBe(0);
        const written = (saveMetaItem as any).mock.calls[0][0];
        expect(written.item.nodes[0].config).toEqual({ objectName: 'lead', filter: { status: 'stale' } });
        expect(written.item.nodes[0].config).not.toHaveProperty('filters');
    });

    it('an already-canonical flow row is counted canonical, not rewritten', async () => {
        const { protocol, saveMetaItem } = makeProtocol(
            [{ type: 'flow', name: 'purge_flow', metadata: flowBody({ objectName: 'lead', filter: { status: 'stale' } }) }],
            new Map([['automation', { canonicalizeStoredFlow }]]),
        );
        const report = await protocol.migrateStoredMetadata({ apply: true });
        expect(report.canonical).toBe(1);
        expect(report.rewritten).toBe(0);
        expect(saveMetaItem).not.toHaveBeenCalled();
    });

    it('no automation service → skipped with the reason, never counted done', async () => {
        const { protocol } = makeProtocol([legacyFlowRow], new Map());
        const report = await protocol.migrateStoredMetadata({ apply: true });
        expect(report.skipped).toBe(1);
        expect(report.rewritten).toBe(0);
        expect(report.rows[0]!.reason).toMatch(/no automation service is reachable/);
    });

    it('an automation service without canonicalizeStoredFlow is treated as absent', async () => {
        // An older service in the slot answers the lookup but not the question.
        // Reading that as "flow handled" would report a clean run over rows
        // nothing examined.
        const { protocol } = makeProtocol([legacyFlowRow], new Map([['automation', { registerFlow() {} }]]));
        const report = await protocol.migrateStoredMetadata({ apply: true });
        expect(report.skipped).toBe(1);
        expect(report.rows[0]!.reason).toMatch(/no automation service is reachable/);
    });

    it('an explicit canonicalizeFlow overrides the registry one', async () => {
        const explicit = vi.fn((_n: string, body: any) => ({
            storable: { ...body, label: 'From the explicit hook' },
            notices: [],
            conflicts: [],
        }));
        const registryHook = vi.fn(canonicalizeStoredFlow);
        const { protocol, saveMetaItem } = makeProtocol(
            [legacyFlowRow],
            new Map([['automation', { canonicalizeStoredFlow: registryHook }]]),
        );

        await protocol.migrateStoredMetadata({ apply: true, canonicalizeFlow: explicit });

        expect(explicit).toHaveBeenCalledTimes(1);
        expect(registryHook).not.toHaveBeenCalled();
        expect((saveMetaItem as any).mock.calls[0][0].item.label).toBe('From the explicit hook');
    });

    it('resolution is LAZY — a service registered after construction is still found', async () => {
        // Plugin init order does not guarantee `automation` is in the table when
        // the protocol is assembled (the CLI adds it after ObjectQL by design).
        // Caching `undefined` from a too-early read would disable flow
        // canonicalization for the life of the process.
        const services = new Map<string, any>();
        const { protocol } = makeProtocol([legacyFlowRow], services);
        services.set('automation', { canonicalizeStoredFlow });

        const report = await protocol.migrateStoredMetadata({ apply: true });
        expect(report.rewritten).toBe(1);
    });

    it('the engine is called with the row NAME, not the body', async () => {
        const spy = vi.fn(canonicalizeStoredFlow);
        const { protocol } = makeProtocol(
            [legacyFlowRow],
            new Map([['automation', { canonicalizeStoredFlow: spy }]]),
        );
        await protocol.migrateStoredMetadata({ apply: true });
        expect(spy.mock.calls[0][0]).toBe('purge_flow');
    });
});

describe('duplicatePackage canonicalizes flow rows (#4498)', () => {
    /** The row from the issue: a pre-17 `delete_record` carrying `config.filters`. */
    const legacyFlowRow = {
        type: 'flow',
        name: 'iojn_purge_flow',
        package_id: 'app.iojn',
        metadata: flowBody({ objectName: 'iojn_repair_ticket', filters: { status: 'stale' } }),
    };
    const objectRow = {
        type: 'object',
        name: 'iojn_repair_ticket',
        package_id: 'app.iojn',
        metadata: { name: 'iojn_repair_ticket', label: 'Ticket', fields: { title: { type: 'text' } } },
    };
    const duplicate = (protocol: any) => protocol.duplicatePackage({
        sourcePackageId: 'app.iojn',
        targetPackageId: 'app.iojn2',
        targetNamespace: 'iojn2',
    });

    it('the copy lands CANONICAL — the guarantee the comment always claimed', async () => {
        const { protocol, saveMetaItem } = makeProtocol(
            [legacyFlowRow],
            new Map([['automation', { canonicalizeStoredFlow }]]),
        );

        const res = await duplicate(protocol);

        expect(res).toMatchObject({ success: true, copiedCount: 1, failedCount: 0 });
        const written = (saveMetaItem as any).mock.calls[0][0];
        // Before #4498 this was `{ objectName, filters }` verbatim: a brand-new
        // row in a pre-protocol dialect, minted by the platform itself.
        // (`objectName` is untouched here because this package contains no
        // `object` row to rename — the reference rewrite is covered next.)
        expect(written.item.nodes[0].config).toEqual({
            objectName: 'iojn_repair_ticket',
            filter: { status: 'stale' },
        });
        expect(written.item.nodes[0].config).not.toHaveProperty('filters');
    });

    it('the reference rewrite still runs ON TOP of the canonical body', async () => {
        const { protocol, saveMetaItem } = makeProtocol(
            [legacyFlowRow, objectRow],
            new Map([['automation', { canonicalizeStoredFlow }]]),
        );
        await duplicate(protocol);
        const flow = (saveMetaItem as any).mock.calls
            .map((c: any) => c[0])
            .find((c: any) => c.type === 'flow');
        // Canonicalized (`filter`) AND re-namespaced (`iojn2_`) — the two passes
        // compose; neither one replaces the other.
        expect(flow.item.nodes[0].config.filter).toEqual({ status: 'stale' });
        expect(flow.item.nodes[0].config.objectName).toBe('iojn2_repair_ticket');
    });

    it('a refused rename fails the item and names the token — never a silent legacy copy', async () => {
        const conflicting = () => ({
            storable: {},
            notices: [],
            conflicts: [{
                conversionId: 'flow-node-type-open-namespace',
                token: 'http_request',
                path: 'flows[0].nodes[0].type',
                message: 'a custom executor owns this node type here',
            }],
        });
        const { protocol, saveMetaItem } = makeProtocol(
            [legacyFlowRow],
            new Map([['automation', { canonicalizeStoredFlow: conflicting }]]),
        );

        const res = await duplicate(protocol);

        expect(res.failedCount).toBe(1);
        expect(res.copiedCount).toBe(0);
        expect(res.failed[0].error).toContain('http_request');
        expect(res.failed[0].error).toContain('live name in this environment');
        // The point of failing: copying the un-renamed body would mint exactly
        // the row this fix exists to prevent.
        expect(saveMetaItem).not.toHaveBeenCalled();
    });

    it('a flow that cannot canonicalize fails the item with the reason', async () => {
        const throwing = () => { throw new Error("Unrecognized key: '_uiPosition'"); };
        const { protocol, saveMetaItem } = makeProtocol(
            [legacyFlowRow],
            new Map([['automation', { canonicalizeStoredFlow: throwing }]]),
        );

        const res = await duplicate(protocol);

        expect(res.failedCount).toBe(1);
        expect(res.failed[0].error).toMatch(/does not canonicalize.*_uiPosition/);
        expect(saveMetaItem).not.toHaveBeenCalled();
    });

    it('no engine reachable → the flow is copied as-is, and the duplication still succeeds', async () => {
        // A control-plane / metadata-only host has no automation service. The
        // copy is then no better than the source row already was — but failing
        // a whole duplication over it would be a regression for a deployment
        // that never runs flows at all.
        const { protocol, saveMetaItem } = makeProtocol([legacyFlowRow], new Map());

        const res = await duplicate(protocol);

        expect(res).toMatchObject({ success: true, copiedCount: 1, failedCount: 0 });
        expect((saveMetaItem as any).mock.calls[0][0].item.nodes[0].config).toHaveProperty('filters');
    });

    it('non-flow rows still go through the conversion chain', async () => {
        const spy = vi.fn(canonicalizeStoredFlow);
        const { protocol, saveMetaItem } = makeProtocol(
            [objectRow],
            new Map([['automation', { canonicalizeStoredFlow: spy }]]),
        );
        await duplicate(protocol);
        expect(spy).not.toHaveBeenCalled();
        const written = (saveMetaItem as any).mock.calls[0][0];
        expect(written.type).toBe('object');
        expect(written.name).toBe('iojn2_repair_ticket');
    });

    it('an unparseable body is still reported as such, not as a canonicalization failure', async () => {
        const { protocol } = makeProtocol(
            [{ type: 'flow', name: 'iojn_broken', package_id: 'app.iojn', metadata: '{not json' }],
            new Map([['automation', { canonicalizeStoredFlow }]]),
        );
        const res = await duplicate(protocol);
        expect(res.failed[0].error).toBe('unparseable metadata');
    });
});
