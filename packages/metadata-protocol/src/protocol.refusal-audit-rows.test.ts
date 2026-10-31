// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28355] `sys_metadata_audit.code` documents `not_overridable`,
// `not_creatable`, `invalid_metadata` and `destructive_change` as `denied`
// values, and the single-item doors refuse with exactly those codes — but no
// audit write stamped any of them. Only the lock gate (`item_locked`) and the
// optimistic-concurrency check (`metadata_conflict`) left a row, so a reader of
// `/audit` concluded that a refused attempt never happened.
//
// One denied row per enforced code, each driven through the real door, plus an
// allowed control and the refusals that must still leave no row.
//
// ⚠️ The fake engine below PERSISTS audit inserts (`audit`) instead of
// short-circuiting them, as most multi-table stubs here do: a harness that
// swallows the insert reports "no audit rows" identically before and after the
// fix. The allowed control is what proves it can see a row at all.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decision, imported from
// `@objectstack/metadata-core` and ⛔ never from `@objectstack/objectql`:
// objectql depends on this package, so that import would close a cycle.
import { assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { REFUSAL_AUDIT_CODES, refusalAuditEntry, withRefusalAudit } from './protocol-refusal-audit.js';
import { resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum: string;
    version?: number;
}

const row = (o: Partial<Row> & { type: string; name: string }): Row => ({
    id: `row_${o.type}_${o.name}`,
    organization_id: null,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify({ name: o.name }),
    checksum: 'sha256_28355_fixture',
    version: 1,
    ...o,
});

const PARENT = 'crm_task';
const FIELD = 'zz_probe';
const DOTTED = `${PARENT}.${FIELD}`;

const objectRow = (name: string, fields: readonly string[]): Row => row({
    type: 'object',
    name,
    metadata: JSON.stringify({
        name,
        label: name,
        fields: Object.fromEntries(fields.map((f) => [f, { name: f, type: 'text' }])),
    }),
});

/** The artifact registry entry that makes `crm_task.zz_probe` a PACKAGED field. */
const PACKAGED_PARENT = {
    [`object|${PARENT}`]: {
        name: PARENT,
        _packageId: 'showcase',
        fields: { [FIELD]: { name: FIELD, type: 'text' } },
    },
};

/** One `where` value as the store reads it: `{ $in: [...] }` or equality. */
const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

function makeKernel(seed: Row[] = [], artifacts: Record<string, unknown> = {}) {
    const rows = new Map<string, Row>();
    for (const r of seed) rows.set(r.id, r);
    /** Every `sys_metadata_audit` insert that landed, in order. */
    const audit: Array<Record<string, unknown>> = [];

    const match = (r: Row, where: Record<string, unknown>): boolean =>
        Object.entries(where ?? {}).every(([k, v]) => {
            if (k === '$or') return (v as Array<Record<string, unknown>>).some((c) => match(r, c));
            return v === null || v === undefined
                ? (r as any)[k] === null || (r as any)[k] === undefined
                : whereValueMatches((r as any)[k], v);
        });

    const engine: any = {
        async find(table: string, o?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const hits = Array.from(rows.values()).filter((r) => match(r, o?.where ?? {}));
            return typeof o?.limit === 'number' ? hits.slice(0, o.limit) : hits;
        },
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table !== 'sys_metadata') return null;
            for (const r of rows.values()) if (match(r, o?.where ?? {})) return r;
            return null;
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') audit.push({ ...data });
            if (table === 'sys_metadata') {
                const r = { ...(data as any) } as Row;
                r.id = String(data.id ?? `r_${rows.size}`);
                rows.set(r.id, r);
            }
            return { id: String(data.id ?? 'r_new') };
        },
        async update(_table: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        registry: {
            registerItem: () => {}, registerObject: () => {}, listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: (t: string, n: string) => artifacts[`${t}|${n}`],
            removeRuntimeShadow: () => false, removeOverlayEntry: () => {}, uninstallPackage: () => {},
        },
    };

    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, rows, audit };
}

/** Drive a door and hand back its refusal; a door that resolves fails the case. */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
    const outcome = await run().then(() => null, (e: unknown) => e);
    expect(outcome, 'the door accepted a write it should refuse').not.toBeNull();
    return outcome;
}

const denied = (audit: ReadonlyArray<Record<string, unknown>>) => audit.filter((a) => a.outcome === 'denied');

beforeEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});
afterEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});

describe('[#28355] CONTROL — an allowed save leaves its allowed row and no denied one', () => {
    it('records `allowed` / `ok` for a valid object create', async () => {
        const { protocol, audit } = makeKernel();
        await protocol.saveMetaItem({
            type: 'object',
            name: PARENT,
            item: { name: PARENT, label: PARENT, sharingModel: 'private', fields: { a: { name: 'a', type: 'text' } } },
            actor: 'usr_author',
        });
        expect(audit).toEqual([
            expect.objectContaining({ type: 'object', name: PARENT, operation: 'save', outcome: 'allowed', code: 'ok' }),
        ]);
        expect(denied(audit)).toEqual([]);
    });
});

describe('[#28355] one denied row per enforced code, at the door that refused', () => {
    it('`not_creatable` — a code-only `field` create on the save door', async () => {
        const { protocol, audit } = makeKernel();
        const err = await refusalOf(() => protocol.saveMetaItem({
            type: 'field', name: DOTTED, item: { label: 'Probe', type: 'text' }, actor: 'usr_author',
        }));
        expect(err.code).toBe('NOT_CREATABLE');
        expect(err.status).toBe(403);
        expect(denied(audit)).toEqual([expect.objectContaining({
            type: 'field', name: DOTTED, operation: 'save', code: 'not_creatable',
            actor: 'usr_author', source: 'protocol.saveMetaItem', note: err.message,
        })]);
    });

    it('`not_overridable` — a `field` under an artifact-backed parent on the save door', async () => {
        const { protocol, audit } = makeKernel([], PACKAGED_PARENT);
        const err = await refusalOf(() => protocol.saveMetaItem({
            type: 'field', name: DOTTED, item: { label: 'Probe', type: 'number' },
        }));
        expect(err.code).toBe('NOT_OVERRIDABLE');
        expect(err.status).toBe(403);
        expect(denied(audit)).toEqual([expect.objectContaining({
            type: 'field', name: DOTTED, operation: 'save', code: 'not_overridable',
            // No caller actor: the writer's own `system`, as for every other row.
            actor: 'system',
        })]);
    });

    it('`destructive_change` — a field-dropping object save', async () => {
        const { protocol, audit } = makeKernel([objectRow(PARENT, ['a', 'b'])]);
        const err = await refusalOf(() => protocol.saveMetaItem({
            type: 'object',
            name: PARENT,
            item: { name: PARENT, label: PARENT, sharingModel: 'private', fields: { a: { name: 'a', type: 'text' } } },
        }));
        expect(err.code).toBe('DESTRUCTIVE_CHANGE');
        expect(err.status).toBe(409);
        expect(denied(audit)).toEqual([expect.objectContaining({
            type: 'object', name: PARENT, operation: 'save', code: 'destructive_change',
        })]);
    });

    it('`invalid_metadata` — a spec-invalid object body', async () => {
        const { protocol, audit } = makeKernel();
        const err = await refusalOf(() => protocol.saveMetaItem({
            type: 'object',
            name: PARENT,
            item: { name: PARENT, label: PARENT, sharingModel: 'private', fields: { a: { name: 'a', type: 'not_a_field_type' } } },
        }));
        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);
        // The spec refusal of the field type, not some other gate's.
        expect(JSON.stringify(err.issues)).toContain('fields.a.type');
        expect(denied(audit)).toEqual([expect.objectContaining({
            type: 'object', name: PARENT, operation: 'save', code: 'invalid_metadata',
        })]);
    });

    it('the plural spelling a refusal can arrive under is filed under the canonical type', async () => {
        const { protocol, audit } = makeKernel();
        await refusalOf(() => protocol.saveMetaItem({
            type: 'objects',
            name: PARENT,
            item: { name: PARENT, label: PARENT, sharingModel: 'private', fields: { a: { name: 'a', type: 'not_a_field_type' } } },
        }));
        expect(denied(audit).map((a) => a.type)).toEqual(['object']);
    });
});

describe('[#28355] every single-item door stamps its own operation', () => {
    // The ADR-0131 D6 organization-scoped refusal is each door's FIRST gate,
    // `NOT_OVERRIDABLE` on all four, so it reaches every door the same way.
    const ORG = { organizationId: 'org_alpha' };

    it('publish', async () => {
        const { protocol, audit } = makeKernel();
        const err = await refusalOf(() => protocol.publishMetaItem({ type: 'object', name: PARENT, ...ORG }));
        expect(err.code).toBe('NOT_OVERRIDABLE');
        expect(denied(audit)).toEqual([expect.objectContaining({
            operation: 'publish', code: 'not_overridable', source: 'protocol.publishMetaItem',
        })]);
    });

    it('rollback', async () => {
        const { protocol, audit } = makeKernel();
        const err = await refusalOf(() => protocol.rollbackMetaItem({ type: 'object', name: PARENT, toVersion: 1, ...ORG }));
        expect(err.code).toBe('NOT_OVERRIDABLE');
        expect(denied(audit)).toEqual([expect.objectContaining({
            operation: 'rollback', code: 'not_overridable', source: 'protocol.rollbackMetaItem',
        })]);
    });

    it('delete', async () => {
        const { protocol, audit } = makeKernel();
        const err = await refusalOf(() => protocol.deleteMetaItem({ type: 'object', name: PARENT, ...ORG }));
        expect(err.code).toBe('NOT_OVERRIDABLE');
        expect(denied(audit)).toEqual([expect.objectContaining({
            operation: 'delete', code: 'not_overridable', source: 'protocol.deleteMetaItem',
        })]);
    });
});

describe('[#28355] what still leaves no row', () => {
    it('a refusal outside the closed map (`INVALID_REQUEST`) writes nothing', async () => {
        const { protocol, audit } = makeKernel();
        const err = await refusalOf(() => protocol.saveMetaItem({ type: 'object', name: PARENT }));
        expect(err.code).toBe('INVALID_REQUEST');
        expect(audit).toEqual([]);
    });

    it('the map holds exactly the four documented values, and mints no other', () => {
        expect(Object.values(REFUSAL_AUDIT_CODES).sort()).toEqual(
            ['destructive_change', 'invalid_metadata', 'not_creatable', 'not_overridable'],
        );
        // Neither gate that already writes its own row is re-stamped.
        expect(Object.keys(REFUSAL_AUDIT_CODES)).not.toContain('ITEM_LOCKED');
        expect(Object.keys(REFUSAL_AUDIT_CODES)).not.toContain('METADATA_CONFLICT');
        // A prototype key is not a code.
        const door = { operation: 'save' as const, type: 'object', name: PARENT, actor: undefined, source: 's' };
        expect(refusalAuditEntry(Object.assign(new Error('x'), { code: 'toString' }), door)).toBeNull();
        // No identity, no row.
        expect(refusalAuditEntry(Object.assign(new Error('x'), { code: 'NOT_CREATABLE' }), { ...door, name: '' })).toBeNull();
    });

    it('a refusal passing through two doors is recorded once', async () => {
        const rows: unknown[] = [];
        const record = async (entry: unknown) => { rows.push(entry); };
        const door = { operation: 'delete' as const, type: 'object', name: PARENT, actor: undefined, source: 's' };
        const refusal = Object.assign(new Error('sealed'), { code: 'NOT_OVERRIDABLE', status: 403 });
        const outer = withRefusalAudit(record, { ...door, operation: 'publish' }, () =>
            withRefusalAudit(record, door, async () => { throw refusal; }));
        await expect(outer).rejects.toBe(refusal);
        expect(rows).toEqual([expect.objectContaining({ operation: 'delete', code: 'not_overridable' })]);
    });
});
