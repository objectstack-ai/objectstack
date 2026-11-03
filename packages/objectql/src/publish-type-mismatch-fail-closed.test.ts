// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29904 — the package publish door refuses a validation rule that orders a
 * text field against a number.
 *
 * A validation rule fails closed: a predicate that cannot be evaluated refuses
 * the write (`rule-validator.ts`, "could not be evaluated … write rejected").
 * `record.name > 5` over a text field faults on every value that is not
 * numeric text, so once such a rule published every create and update on the
 * object was refused, while the publish had carried only a `warning` that the
 * expression "silently evaluates to null". The publish now refuses it, as it
 * already refused the nullable-comparison twin (`record.qty > 1000` on a
 * nullable number) at the same slot.
 *
 * What is real: the protocol's `saveMetaItem` (draft) and
 * `publishPackageDrafts`, the runtime authoring gate it runs, and an ObjectQL
 * engine. The driver is the in-memory one the response-conformance suite uses,
 * copied (not shared) for the reason that file records.
 */
// Pays the lint root's first load at collection, never inside a clocked case.
import './__fixtures__/lint-root-preload.testkit.js';
import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        // [#24395] The draft row's per-key provenance, written by every draft save.
        draft_changes: { name: 'draft_changes', label: 'Draft Changes', type: 'textarea' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

/**
 * The same in-memory driver the two single-door gates use. Kept local rather
 * than shared, for the reason `publish-meta-response-conformance.test.ts`
 * records: each gate is a tripwire that must be able to fail independently.
 */
function makeMemoryDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const rowVal = row[k];
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = rowVal === undefined ? null : rowVal;
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, stores };
}

async function makeProtocol() {
    const engine = new ObjectQL();
    const { driver } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) engine.registry.registerObject(o as any, 'test-package');
    // The base every draft here is bound to is INSTALLED: a flow may be saved
    // only into a package the registry holds (#20863). Its manifest declares
    // no namespace, so the ADR-0028 prefix pre-flight is unchanged.
    engine.registry.installPackage({ id: PKG, name: 'Edu', version: '1.0.0' } as never, 'code');
    return new ObjectStackProtocolImplementation(engine);
}

const PKG = 'app.edu';

/** An object whose only defect, if any, is the one validation rule handed in. */
const leadObject = (fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    name: 'edu_lead',
    label: 'Lead',
    sharingModel: 'public_read_write',
    fields,
    ...extra,
});

/** Stage one object draft into PKG and publish the package, as `PUT ?mode=draft` + `POST /publish-drafts`. */
async function publishObject(item: unknown): Promise<any> {
    const p = await makeProtocol();
    await (p as any).saveMetaItem({ type: 'object', name: 'edu_lead', item, mode: 'draft', packageId: PKG });
    return p.publishPackageDrafts({ packageId: PKG });
}

const ruleOn = (condition: string) => ({
    validations: [{ name: 'name_gt', type: 'script', condition, message: 'bad', severity: 'error' }],
});

describe('publish refuses a type mismatch in a fail-closed role (#29904)', () => {
    it('refuses `record.name > 5` on a required text field in validations[].condition', async () => {
        const raw = await publishObject(leadObject(
            { name: { type: 'text', label: 'Name', required: true } },
            ruleOn('record.name > 5'),
        ));

        expect(raw.outcome).toBe('refused');
        expect(raw.publishedCount).toBe(0);
        const causal = raw.failed.find((f: any) => f.code === 'INVALID_METADATA');
        expect(causal).toMatchObject({ type: 'object', name: 'edu_lead' });
        const issue = causal.issues.find((i: any) => i.rule === 'expression-invalid');
        expect(issue, `issues: ${JSON.stringify(causal.issues)}`).toBeDefined();
        expect(issue.severity).toBe('error');
        expect(issue.path).toMatch(/validations\[0\]\.condition$/);
        expect(issue.message).toMatch(/type mismatch `string > int` — `record\.name` holds text/);
        expect(issue.message).toMatch(/is refused, not skipped/);
    });

    it('still publishes the same comparison as a formula field, with the warning advisory', async () => {
        const raw = await publishObject(leadObject({
            name: { type: 'text', label: 'Name', required: true },
            big: { type: 'formula', label: 'Big', expression: 'record.name > 5', returnType: 'boolean' },
        }));

        expect(raw.outcome).toBe('published');
        const el = raw.published.find((e: any) => e.name === 'edu_lead');
        const advisory = el.advisories?.find((a: any) => a.rule === 'expression-invalid');
        expect(advisory, `advisories: ${JSON.stringify(el.advisories)}`).toBeDefined();
        expect(advisory.severity).toBe('warning');
        expect(advisory.message).toMatch(/silently evaluates to null/);
    });

    it('still refuses the nullable-comparison twin exactly as before', async () => {
        const raw = await publishObject(leadObject(
            { name: { type: 'text', label: 'Name', required: true }, qty: { type: 'number', label: 'Qty' } },
            ruleOn('record.qty > 1000'),
        ));

        expect(raw.outcome).toBe('refused');
        const causal = raw.failed.find((f: any) => f.code === 'INVALID_METADATA');
        const issues = causal.issues.filter((i: any) => i.rule === 'expression-invalid');
        expect(issues).toHaveLength(1);
        expect(issues[0].severity).toBe('error');
        expect(issues[0].message).toMatch(/declares as nullable/);
    });
});
