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
            const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
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

    // [#29926] An advisory rule is skipped on a fault, not refused: the publish
    // still refuses it (the nullable twin does too), but the served message
    // says the write proceeds and the rule never applies.
    it('refuses the comparison in an advisory rule with a message that does not claim a refused write (#29926)', async () => {
        const raw = await publishObject(leadObject(
            { name: { type: 'text', label: 'Name', required: true } },
            { validations: [{ name: 'name_gt', type: 'script', condition: 'record.name > 5', message: 'bad', severity: 'warning' }] },
        ));

        expect(raw.outcome).toBe('refused');
        const causal = raw.failed.find((f: any) => f.code === 'INVALID_METADATA');
        const issue = causal.issues.find((i: any) => i.rule === 'expression-invalid');
        expect(issue, `issues: ${JSON.stringify(causal.issues)}`).toBeDefined();
        expect(issue.severity).toBe('error');
        expect(issue.path).toMatch(/validations\[0\]\.condition$/);
        expect(issue.message).toMatch(/the rule is advisory, so a rule that cannot be evaluated is skipped, not refused: the write proceeds/);
        expect(issue.message).not.toMatch(/is refused, not skipped/);
    });

    // [#29926] A record-triggered flow's condition fails the RUN on a fault;
    // the publish refuses it with that wording, as the nullable twin does.
    it('refuses the comparison in a record-triggered flow condition with the run-fails wording (#29926)', async () => {
        const p = await makeProtocol();
        await (p as any).saveMetaItem({
            type: 'object',
            name: 'edu_lead',
            item: leadObject({ name: { type: 'text', label: 'Name', required: true } }),
            mode: 'draft',
            packageId: PKG,
        });
        await (p as any).saveMetaItem({
            type: 'flow',
            name: 'edu_lead_flow',
            item: {
                name: 'edu_lead_flow',
                label: 'Lead flow',
                type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'Start', config: { objectName: 'edu_lead', triggerType: 'record-after-update', condition: 'name > 5' } },
                    { id: 'end', type: 'end', label: 'End' },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'end' }],
            },
            mode: 'draft',
            packageId: PKG,
        });
        const raw: any = await p.publishPackageDrafts({ packageId: PKG });

        expect(raw.outcome, JSON.stringify(raw)).toBe('refused');
        const causal = raw.failed.find((f: any) => f.code === 'INVALID_METADATA' && f.type === 'flow');
        expect(causal, `failed: ${JSON.stringify(raw.failed)}`).toBeDefined();
        const issue = causal.issues.find((i: any) => i.rule === 'expression-invalid' && /type mismatch/.test(i.message));
        expect(issue, `issues: ${JSON.stringify(causal.issues)}`).toBeDefined();
        expect(issue.severity).toBe('error');
        expect(issue.message).toMatch(/fails the run: the flow stops at this condition, the write that fired it still lands/);
        expect(issue.message).not.toMatch(/evaluates to null/);
    });
});

/**
 * [#29959] Stage the lead object and one flow into PKG and publish the
 * package, through the same real door as the cases above.
 */
async function publishLeadFlow(
    startConfig: Record<string, unknown>,
    nodes: unknown[],
    edges: unknown[],
    flowType = 'autolaunched',
): Promise<any> {
    const p = await makeProtocol();
    await (p as any).saveMetaItem({
        type: 'object',
        name: 'edu_lead',
        item: leadObject({ name: { type: 'text', label: 'Name', required: true } }),
        mode: 'draft',
        packageId: PKG,
    });
    await (p as any).saveMetaItem({
        type: 'flow',
        name: 'edu_lead_flow',
        item: {
            name: 'edu_lead_flow',
            label: 'Lead flow',
            type: flowType,
            nodes: [{ id: 'start', type: 'start', label: 'Start', config: { objectName: 'edu_lead', ...startConfig } }, ...nodes],
            edges,
        },
        mode: 'draft',
        packageId: PKG,
    });
    return p.publishPackageDrafts({ packageId: PKG });
}

const routeTo = (expression: string) => ({
    nodes: [
        { id: 'route', type: 'decision', label: 'Route', config: { conditions: [{ label: 'Long', expression }] } },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'route' },
        { id: 'e2', source: 'route', target: 'end', label: 'Long' },
    ],
});

const flowTypeIssue = (raw: any): any => {
    const causal = raw.failed?.find((f: any) => f.code === 'INVALID_METADATA' && f.type === 'flow');
    return causal?.issues.find((i: any) => i.rule === 'expression-invalid' && /type mismatch/.test(i.message));
};

describe('publish gives every flow condition a type-mismatch verdict that says what the run does (#29959)', () => {
    const RECORD_TRIGGERED = { triggerType: 'record-after-update' };

    it('refuses a `record.name > 5` start condition of a record-triggered flow with the run-fails wording', async () => {
        const raw = await publishLeadFlow(
            { ...RECORD_TRIGGERED, condition: 'record.name > 5' },
            [{ id: 'end', type: 'end', label: 'End' }],
            [{ id: 'e1', source: 'start', target: 'end' }],
        );
        expect(raw.outcome, JSON.stringify(raw)).toBe('refused');
        const issue = flowTypeIssue(raw);
        expect(issue, `failed: ${JSON.stringify(raw.failed)}`).toBeDefined();
        expect(issue.severity).toBe('error');
        expect(issue.message).toMatch(/`record\.name` holds text/);
        expect(issue.message).toMatch(/fails the run: the flow stops at this condition, the write that fired it still lands/);
    });

    it('refuses a `name > 5` decision branch of a record-triggered flow with the run-fails wording', async () => {
        const { nodes, edges } = routeTo('name > 5');
        const raw = await publishLeadFlow(RECORD_TRIGGERED, nodes, edges);
        expect(raw.outcome, JSON.stringify(raw)).toBe('refused');
        const issue = flowTypeIssue(raw);
        expect(issue, `failed: ${JSON.stringify(raw.failed)}`).toBeDefined();
        expect(issue.severity).toBe('error');
        expect(issue.path).toMatch(/nodes\[1\]\.config\.conditions\[0\]\.expression$/);
        expect(issue.message).toMatch(/fails the run: the flow stops at this condition, the write that fired it still lands/);
    });

    it('publishes the same comparison in a flow that is not record-triggered, with a warning that says the run fails', async () => {
        const { nodes, edges } = routeTo('name > 5');
        const raw = await publishLeadFlow({ schedule: '0 * * * *', condition: 'record.name > 5' }, nodes, edges);
        expect(raw.outcome, JSON.stringify(raw)).toBe('published');
        const el = raw.published.find((e: any) => e.name === 'edu_lead_flow');
        const advisories = (el.advisories ?? []).filter((a: any) => a.rule === 'expression-invalid' && /type mismatch/.test(a.message));
        expect(advisories, `advisories: ${JSON.stringify(el.advisories)}`).toHaveLength(2);
        for (const a of advisories) {
            expect(a.severity).toBe('warning');
            expect(a.message).toMatch(/a flow condition that faults when it is evaluated fails the run/);
            expect(a.message).not.toMatch(/evaluates to null|still lands/);
        }
    });

    it('publishes a record-triggered flow whose record read and decision branch are well typed (control)', async () => {
        const { nodes, edges } = routeTo('size(name) > 5');
        const raw = await publishLeadFlow({ ...RECORD_TRIGGERED, condition: 'size(record.name) > 0' }, nodes, edges);
        expect(raw.outcome, JSON.stringify(raw)).toBe('published');
        const el = raw.published.find((e: any) => e.name === 'edu_lead_flow');
        expect((el.advisories ?? []).filter((a: any) => /type mismatch/.test(a.message))).toEqual([]);
    });
});

/**
 * [#30025] Through the same real door: a bare name a screen collects is the
 * collected value downstream of the screen (a resume lands it under its plain
 * name), so it is not typed as the field; a bare name after a node that can
 * bind any name (`script`) is not proven to be the field, so its mismatch is
 * the run-may-fail warning. `record.name` is the field in both, and refused.
 */
describe('publish stands a bare flow-condition name down where a screen or an open binder can hold it (#30025)', () => {
    const RECORD_TRIGGERED = { triggerType: 'record-after-update' };
    const through = (mid: Record<string, unknown>, edgeCondition: string) => ({
        nodes: [mid, { id: 'end', type: 'end', label: 'End' }],
        edges: [
            { id: 'e1', source: 'start', target: 'mid' },
            { id: 'e2', source: 'mid', target: 'end', condition: edgeCondition },
        ],
    });
    const SCREEN = { id: 'mid', type: 'screen', label: 'Ask', config: { fields: [{ name: 'name', type: 'number', label: 'Count' }] } };
    const SCRIPT = { id: 'mid', type: 'script', label: 'Calc', config: { function: 'calc' } };

    it('publishes a bare `name > 5` a screen field holds, with no type verdict', async () => {
        const { nodes, edges } = through(SCREEN, 'name > 5');
        const raw = await publishLeadFlow(RECORD_TRIGGERED, nodes, edges);
        expect(raw.outcome, JSON.stringify(raw)).toBe('published');
        const el = raw.published.find((e: any) => e.name === 'edu_lead_flow');
        expect((el.advisories ?? []).filter((a: any) => /type mismatch/.test(a.message))).toEqual([]);
    });

    it('publishes a bare `name > 5` after a script node with the run-may-fail warning', async () => {
        const { nodes, edges } = through(SCRIPT, 'name > 5');
        const raw = await publishLeadFlow(RECORD_TRIGGERED, nodes, edges);
        expect(raw.outcome, JSON.stringify(raw)).toBe('published');
        const el = raw.published.find((e: any) => e.name === 'edu_lead_flow');
        const advisories = (el.advisories ?? []).filter((a: any) => a.rule === 'expression-invalid' && /type mismatch/.test(a.message));
        expect(advisories, `advisories: ${JSON.stringify(el.advisories)}`).toHaveLength(1);
        expect(advisories[0].severity).toBe('warning');
        expect(advisories[0].message).toMatch(/which this check cannot prove here, so this is a warning, not a refusal/);
    });

    it('still refuses `record.name > 5` after either node', async () => {
        for (const mid of [SCREEN, SCRIPT]) {
            const { nodes, edges } = through(mid, 'record.name > 5');
            const raw = await publishLeadFlow(RECORD_TRIGGERED, nodes, edges);
            expect(raw.outcome, `${mid.type}: ${JSON.stringify(raw)}`).toBe('refused');
            const issue = flowTypeIssue(raw);
            expect(issue, `${mid.type} failed: ${JSON.stringify(raw.failed)}`).toBeDefined();
            expect(issue.severity).toBe('error');
            expect(issue.message).toMatch(/`record\.name` holds text/);
        }
    });
});
