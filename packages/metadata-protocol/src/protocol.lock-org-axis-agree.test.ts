// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21716, ADR-0010 §3.3 / §5, ADR-0005] One fact — "is this item locked?" —
 * reported by the read and enforced by the write doors. This file closes the
 * family where the two disagree:
 *
 *  1. #21670 — the read's envelope ignored the package door's verdict (PR #21693);
 *  2. #21694 — the topology axis: the `_lock` gate never refused on a kernel
 *     with no `environmentId` (PR #21715);
 *  3. #21716 — the organization axis: the reads resolve the org-scoped row,
 *     else the env-wide row, while the gate's overlay limb asked for
 *     `organization_id = <the request's organization>` only. An env-wide row
 *     declaring `_lock: 'full'` read locked for an organization with no row of
 *     its own, and that organization's save and delete were admitted.
 *
 * Pins, each against the real doors and the real reads, both sides on ONE
 * protocol instance per row (a pin on one side only proves nothing here):
 *
 *  1. The family's enumeration pin. One table drives the read and the door
 *     over topology × row scope × request scope × every `MetadataLockSchema`
 *     level × operation. For every row the door admits exactly when the
 *     envelope says `editable` (save) / `deletable` (delete). A new axis value
 *     or limb that splits them turns its own row red, by name.
 *  2. The measured defect, named: an env-wide `_lock: 'full'` row, an
 *     org-scoped read, save, delete, publish and rollback.
 *  3. Precedence: with both rows present the read serves the org-scoped row,
 *     and the door binds THAT row's `_lock`, whatever the env-wide row says.
 *  4. The organization gate: on a type with no per-org channel the reads
 *     never serve an org-scoped row, and neither does the door.
 *
 * It sits above PR #21693's and PR #21715's per-case pins and replaces neither.
 *
 * Every row here is stored under the canonical type spelling — every row a
 * live write can mint. The reads' at-rest tolerance for the other spelling is
 * the one declared difference from the gate (`findServedOverlayRow`'s
 * `otherSpelling`), so it is outside this table on purpose.
 *
 * `@objectstack/objectql` cannot be imported here: it depends on this package.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetadataLockSchema } from '@objectstack/spec/kernel';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const ENV_ID = 'env_1';
const ORG = 'org_a';
type Lock = (typeof MetadataLockSchema.options)[number];

interface StoredRow {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

/** A tenant-authored row (a `view` unless named), as an author's save of a body declaring `_lock` leaves it at rest. */
function viewRow(name: string, organizationId: string | null, lock: Lock, type = 'view'): StoredRow {
    return {
        id: `r_${name}_${organizationId ?? 'env'}`,
        type,
        name,
        organization_id: organizationId,
        package_id: null,
        state: 'active',
        metadata: JSON.stringify({
            name,
            // Which row was served, readable off the document.
            label: organizationId === null ? 'env-wide row' : 'org row',
            object: 'account',
            _provenance: 'org',
            ...(lock === 'none' ? {} : { _lock: lock }),
        }),
    };
}

/**
 * The engine double: `find` / `findOne` over `sys_metadata` rows, an empty
 * registry (no packaged artifact, so the `_lock` gate's overlay limb is the
 * one deciding), and an `insert` that records what it was handed (the gate
 * writes its denial row through it) and keeps nothing.
 */
function harness(environmentId: string | undefined, rows: StoredRow[]) {
    const registry = {
        getArtifactItem: () => undefined,
        getItem: () => undefined,
        listItems: () => [],
        getObject: () => undefined,
        registerObject: () => undefined,
        getPackage: () => undefined,
        isPackageDisabled: () => false,
        applyNavContributions: (app: unknown) => app,
    };
    const matching = (where: Record<string, unknown>) => {
        for (const k of Object.keys(where)) {
            if (k.startsWith('$')) throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
        }
        return rows.filter((r) =>
            Object.entries(where).every(([k, v]) => v === undefined || (r as unknown as Record<string, unknown>)[k] === v),
        );
    };
    const inserted: Array<{ table: string; values: Record<string, unknown> }> = [];
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
        async insert(table: string, values: Record<string, unknown>) {
            inserted.push({ table, values });
            return {};
        },
        registry,
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), environmentId);
    return { protocol, inserted };
}

const settle = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

type Verdict = { refused: { code: unknown; status: unknown } } | 'admitted';
const ITEM_LOCKED: Verdict = { refused: { code: 'ITEM_LOCKED', status: 403 } };

/**
 * The door, end to end. Refused ⇔ the ADR-0112 `ITEM_LOCKED` / 403 envelope
 * came back. Admitted ⇔ the ADR-0010 `_lock` gate was reached and answered no
 * refusal; whatever the write does after that (validation, a double that
 * persists nothing) is not a lock verdict and is not read as one.
 */
async function door(
    protocol: ObjectStackProtocolImplementation, name: string, operation: 'save' | 'delete', organizationId?: string,
    type = 'view',
): Promise<Verdict> {
    const gate = vi.spyOn(protocol as any, operation === 'save' ? 'assertLockAllowsWrite' : 'assertLockAllowsDelete');
    try {
        const scope = organizationId ? { organizationId } : {};
        const outcome: any = await settle(operation === 'save'
            ? protocol.saveMetaItem({ type, name, item: { name, label: name, object: 'account' }, ...scope })
            : protocol.deleteMetaItem({ type, name, ...scope }));
        if (outcome instanceof Error && (outcome as any).code === 'ITEM_LOCKED') {
            return { refused: { code: (outcome as any).code, status: (outcome as any).status } };
        }
        expect(gate, `${type}/${name} ${operation}: not refused, yet the _lock gate was never reached`).toHaveBeenCalledTimes(1);
        expect(await gate.mock.results[0]?.value).toBeNull();
        return 'admitted';
    } finally {
        gate.mockRestore();
    }
}

/** Both reads' envelopes for the same request; they must agree with each other first. */
async function envelope(protocol: ObjectStackProtocolImplementation, name: string, organizationId?: string, type = 'view') {
    const scope = organizationId ? { organizationId } : {};
    const byName: any = await protocol.getMetaItem({ type, name, ...scope });
    const layered: any = await protocol.getMetaItemLayered({ type, name, ...scope });
    const pick = (r: any) => ({ lock: r.lock, editable: r.editable, deletable: r.deletable });
    expect(pick(layered), `${type}/${name}: the two reads disagree`).toEqual(pick(byName));
    return { ...pick(byName), served: byName.item?.label as string | undefined, overlayScope: layered.overlayScope };
}

afterEach(() => vi.restoreAllMocks());

const TOPOLOGIES = [
    { kernel: 'environment', environmentId: ENV_ID },
    { kernel: 'host-config', environmentId: undefined },
] as const;
const ROW_SCOPES = [
    { rowScope: 'env-wide row', organizationId: null },
    { rowScope: 'org-scoped row', organizationId: ORG },
] as const;
const REQUEST_SCOPES = [
    { requestScope: 'no organization', organizationId: undefined },
    { requestScope: `organization ${ORG}`, organizationId: ORG },
] as const;
const OPERATIONS = ['save', 'delete'] as const;

describe('[#21716] pin 1 — the family enumeration: the door admits exactly when the read envelope says it may', () => {
    const table = TOPOLOGIES.flatMap((t) => ROW_SCOPES.flatMap((r) => REQUEST_SCOPES.flatMap((q) =>
        MetadataLockSchema.options.flatMap((lock) => OPERATIONS.map((operation) => ({ ...t, ...r, ...q, lock, operation,
            rowOrganizationId: r.organizationId, requestOrganizationId: q.organizationId }))))));

    it('the table spans every axis value, and every lock level (read off MetadataLockSchema itself)', () => {
        expect(MetadataLockSchema.options).toEqual(['none', 'no-overlay', 'no-delete', 'full']);
        expect(table).toHaveLength(TOPOLOGIES.length * ROW_SCOPES.length * REQUEST_SCOPES.length
            * MetadataLockSchema.options.length * OPERATIONS.length);
    });

    for (const row of table) {
        const title = `${row.kernel} kernel · ${row.rowScope} · request: ${row.requestScope} · _lock=${row.lock} · ${row.operation}`;
        it(title, async () => {
            const name = 'v_enum';
            const { protocol } = harness(row.environmentId, [viewRow(name, row.rowOrganizationId, row.lock)]);
            const read = await envelope(protocol, name, row.requestOrganizationId);
            const verdict = await door(protocol, name, row.operation, row.requestOrganizationId);
            const allowed = row.operation === 'save' ? read.editable : read.deletable;
            expect(verdict, `${title}: the door and the read envelope (${JSON.stringify(read)}) disagree`)
                .toEqual(allowed ? 'admitted' : ITEM_LOCKED);
        });
    }

    it('lit control: the table holds refusals and admissions on both verbs, and the org axis reaches the env-wide row', async () => {
        // An org-scoped request over an env-wide `full` row is the cell this card
        // was filed on: the read serves the env-wide row, so it must read locked.
        const { protocol } = harness(undefined, [viewRow('v_lit', null, 'full')]);
        expect(await envelope(protocol, 'v_lit', ORG)).toMatchObject({
            lock: 'full', editable: false, deletable: false, served: 'env-wide row', overlayScope: 'env',
        });
        // …and an org-scoped row is never served to a request naming no organization.
        const { protocol: other } = harness(undefined, [viewRow('v_lit', ORG, 'full')]);
        expect(await envelope(other, 'v_lit')).toMatchObject({ lock: 'none', editable: true, deletable: true, overlayScope: null });
        expect(await door(other, 'v_lit', 'save')).toBe('admitted');
        expect(await door(other, 'v_lit', 'delete')).toBe('admitted');
    });
});

describe('[#21716] pin 2 — an env-wide _lock: full row binds an organization with no row of its own', () => {
    for (const { kernel, environmentId } of TOPOLOGIES) {
        it(`${kernel} kernel: the org-scoped read says locked, and save / delete are refused ITEM_LOCKED (403)`, async () => {
            const { protocol, inserted } = harness(environmentId, [viewRow('v_env_full', null, 'full')]);
            expect(await envelope(protocol, 'v_env_full', ORG)).toMatchObject({
                lock: 'full', editable: false, deletable: false, served: 'env-wide row',
            });
            for (const operation of OPERATIONS) {
                const err: any = await settle(operation === 'save'
                    ? protocol.saveMetaItem({ type: 'view', name: 'v_env_full', item: { name: 'v_env_full', label: 'x', object: 'account' }, organizationId: ORG })
                    : protocol.deleteMetaItem({ type: 'view', name: 'v_env_full', organizationId: ORG }));
                expect(err, operation).toBeInstanceOf(Error);
                expect({ code: err.code, status: err.status, lock: err.lock }, operation)
                    .toEqual({ code: 'ITEM_LOCKED', status: 403, lock: 'full' });
            }
            // The denial is recorded against the organization that asked, as the
            // ADR-0010 §3.6 trail records every refused write.
            const denials = inserted.filter((r) => r.table === 'sys_metadata_audit').map((r) => r.values);
            expect(denials.map((d) => ({ operation: d.operation, outcome: d.outcome, organization_id: d.organization_id, lock_state: d.lock_state })))
                .toEqual([
                    { operation: 'save', outcome: 'denied', organization_id: ORG, lock_state: 'full' },
                    { operation: 'delete', outcome: 'denied', organization_id: ORG, lock_state: 'full' },
                ]);
        });

        it(`${kernel} kernel: an org-scoped publish and rollback are refused the same way (the shared write gate)`, async () => {
            const { protocol } = harness(environmentId, [viewRow('v_env_full', null, 'full')]);
            const published: any = await settle(protocol.publishMetaItem({ type: 'view', name: 'v_env_full', organizationId: ORG }));
            expect({ code: published?.code, status: published?.status }).toEqual({ code: 'ITEM_LOCKED', status: 403 });
            const rolledBack: any = await settle(protocol.rollbackMetaItem({ type: 'view', name: 'v_env_full', toVersion: 1, organizationId: ORG }));
            expect({ code: rolledBack?.code, status: rolledBack?.status }).toEqual({ code: 'ITEM_LOCKED', status: 403 });
        });
    }
});

describe('[#21716] pin 3 — both rows present: the door binds the lock of the row the read serves', () => {
    const cases: Array<{ env: Lock; org: Lock }> = [
        { env: 'full', org: 'none' },
        { env: 'none', org: 'full' },
        { env: 'no-delete', org: 'no-overlay' },
    ];
    for (const { kernel, environmentId } of TOPOLOGIES) {
        for (const c of cases) {
            for (const q of REQUEST_SCOPES) {
                it(`${kernel} kernel · env-wide _lock=${c.env}, org _lock=${c.org} · request: ${q.requestScope}`, async () => {
                    const rows = [viewRow('v_both', null, c.env), viewRow('v_both', ORG, c.org)];
                    const { protocol } = harness(environmentId, rows);
                    const read = await envelope(protocol, 'v_both', q.organizationId);
                    // The read serves the org-scoped row to its organization, the
                    // env-wide row otherwise (ADR-0005 precedence, never a merge)…
                    const servedLock = q.organizationId ? c.org : c.env;
                    expect(read).toMatchObject({
                        lock: servedLock,
                        served: q.organizationId ? 'org row' : 'env-wide row',
                        overlayScope: q.organizationId ? 'org' : 'env',
                    });
                    // …and that row's lock is the one the doors enforce.
                    expect(await door(protocol, 'v_both', 'save', q.organizationId))
                        .toEqual(read.editable ? 'admitted' : ITEM_LOCKED);
                    expect(await door(protocol, 'v_both', 'delete', q.organizationId))
                        .toEqual(read.deletable ? 'admitted' : ITEM_LOCKED);
                });
            }
        }
    }
});

describe('[#21716] pin 4 — a type with no per-org channel: neither the read nor the door serves an org-scoped row', () => {
    // `page` declares `allowOrgOverride: false`, so an org-scoped row of it is
    // pre-#6190 residue boot hydration walks past. The reads gate the
    // organization away (`organizationIdForMetaRead`) and serve the env-wide
    // row; the door asks the same gate, so it binds that row's `_lock` too. A
    // save is refused earlier, by the org-scope door (`NOT_OVERRIDABLE`), so
    // the removal is the verb that reaches the `_lock` gate with an organization.
    const cases: Array<{ env: Lock; org: Lock }> = [
        { env: 'full', org: 'none' },
        { env: 'none', org: 'full' },
    ];
    for (const { kernel, environmentId } of TOPOLOGIES) {
        for (const c of cases) {
            it(`${kernel} kernel · page: env-wide _lock=${c.env}, org-scoped residue _lock=${c.org} · delete for ${ORG}`, async () => {
                const rows = [viewRow('p_both', null, c.env, 'page'), viewRow('p_both', ORG, c.org, 'page')];
                const { protocol } = harness(environmentId, rows);
                const read = await envelope(protocol, 'p_both', ORG, 'page');
                expect(read).toMatchObject({ lock: c.env, served: 'env-wide row', overlayScope: 'env' });
                expect(await door(protocol, 'p_both', 'delete', ORG, 'page'))
                    .toEqual(read.deletable ? 'admitted' : ITEM_LOCKED);
            });
        }
    }
});
