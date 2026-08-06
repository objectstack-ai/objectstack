// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4463 — the runtime authoring gate, end to end through `saveMetaItem`.
 *
 * The measured example from the issue, run at the door it was measured at: a
 * tenant saves an approval flow whose `expression` approver is broken CEL
 * (`record.owner ==`). `ApproverSchema.value` is a `z.string()`, so the
 * per-type Zod gate is green; before this change the body landed in
 * `sys_metadata`, `registerFlow` registered it, and the node failed at its
 * entry the first time the flow fired. `os lint` had rejected that exact body
 * since #4409 — and there is no `os lint` for a Studio tenant, because a
 * `sys_metadata` overlay row is not in the CLI's config file at all.
 *
 * These tests pin all four decisions, not just the refusal:
 *   D1 — `active` is gated, `draft` is not, and publishing a draft IS gated.
 *   D3 — the refusal is a 422 in the existing structured-issues envelope.
 *   D4 — `OS_ALLOW_UNLINTED_METADATA_WRITES=1` degrades it to a loud log.
 *   plus: nothing persists on a refusal.
 *
 * Harness: the real repository write path over a stub engine — the same shape
 * as `protocol.save-flow-canonicalization.test.ts`, because a gate INSIDE
 * `saveMetaItem` cannot be tested against a harness that mocks `saveMetaItem`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright — which is why all 26
// of this package's (file, verb) pairs sat in the gate's DEBT ledger until
// #5619 sank the two predicates into a package both sides already depend on.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** The issue's body. Zod-valid: `approvers[].value` is just a string to the schema. */
const brokenApprovalFlow = () => ({
    name: 'leave_approval',
    label: 'Leave Approval',
    type: 'autolaunched',
    status: 'active',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
            id: 'approve',
            type: 'approval',
            label: 'Approve',
            config: { approvers: [{ type: 'expression', value: 'record.owner ==' }] },
        },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'approve' }],
});

/** The same flow with an approver expression that parses and uses a legal root. */
const validApprovalFlow = () => {
    const flow = brokenApprovalFlow();
    flow.nodes[1]!.config = {
        approvers: [{ type: 'expression', value: 'current.owner' }],
        emptyApproverPolicy: 'reject',
    } as any;
    return flow;
};

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
}

const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;

function makeStubEngine() {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of rows) {
            if (w.type !== undefined && r.type !== w.type) continue;
            if (w.name !== undefined && r.name !== w.name) continue;
            if (w.organization_id !== undefined && r.organization_id !== w.organization_id) continue;
            if (w.state !== undefined && r.state !== w.state) continue;
            return { key: k, row: r };
        }
        return null;
    };
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            return findRow(opts.where)?.row ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async insert(_t: string, data: Record<string, unknown>) {
            if (_t === 'sys_metadata_audit') return { id: 'audit_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            rows.set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            // The live object universe the rules resolve names against — the
            // input `os lint` cannot have and this surface can (#4463 D2).
            listItems: (type: string) =>
                type === 'object'
                    ? [{ name: 'leave_request', fields: { owner: { type: 'text' } } }]
                    : [],
            getItem: () => undefined,
        },
    };
    return { engine, rows };
}

/** `environmentId` set: the gate, like every ADR-0005 authorization gate, is tenant-scoped. */
function makeProtocol() {
    const { engine, rows } = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test');
    return { protocol: protocol as any, rows };
}

const flowRows = (rows: Map<string, Row>) =>
    Array.from(rows.values()).filter((r) => r.type === 'flow');

const save = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
    protocol.saveMetaItem({ type: 'flow', name: 'leave_approval', item, ...extra });

describe('runtime authoring gate on saveMetaItem (#4463)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
    });

    // ── D1 + D3: the refusal ─────────────────────────────────────────────

    it('refuses an ACTIVE save of the broken approval flow with a 422', async () => {
        const { protocol, rows } = makeProtocol();

        await expect(save(protocol, brokenApprovalFlow())).rejects.toThrow(/invalid_metadata/);

        const err = await save(protocol, brokenApprovalFlow()).catch((e: any) => e);
        expect(err.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');

        // D3 — the structured envelope Studio already renders for a Zod
        // failure, carrying the four keys an author needs to act.
        const issue = err.issues.find((i: any) => i.rule === 'approval-expression-invalid');
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe('flows[0].nodes[1].config.approvers[0].value');
        expect(issue.where).toContain('leave_approval');
        expect(issue.message).toMatch(/does not parse as CEL/);
        expect(issue.hint.length).toBeGreaterThan(10);

        // Which rules produced the verdict — so "clean" and "nothing ran" are
        // distinguishable from the outside.
        expect(err.rulesRun).toContain('validateApprovalApprovers');

        // And nothing landed. A gate that rejects AFTER persisting is a log line.
        expect(flowRows(rows)).toEqual([]);
    });

    it('allows the same flow once the expression is valid', async () => {
        const { protocol, rows } = makeProtocol();
        const result = await save(protocol, validApprovalFlow());
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);
    });

    // ── D1: drafts are never gated ───────────────────────────────────────

    it('lets the identical body through as a DRAFT', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await save(protocol, brokenApprovalFlow(), { mode: 'draft' });

        expect(
            result.success,
            `a draft is allowed to be half-finished — gating one would destroy the Studio editing loop ` +
                `for no safety gain, because a draft cannot execute (#4463 D1).`,
        ).toBe(true);
        const states = flowRows(rows).map((r) => r.state);
        expect(states).toContain('draft');
        expect(states, 'a draft save must not mint an active row').not.toContain('active');
    });

    it('gates the draft→active PROMOTION, so the draft door is not a bypass', async () => {
        const { protocol } = makeProtocol();
        await save(protocol, brokenApprovalFlow(), { mode: 'draft' });

        const err = await protocol
            .publishMetaItem({ type: 'flow', name: 'leave_approval' })
            .catch((e: any) => e);

        expect(
            err?.status,
            `without this, anyone could save ?mode=draft and POST /publish to walk straight past the ` +
                `gate — which is exactly what Studio's designer does on every edit.`,
        ).toBe(422);
        expect(err.issues.map((i: any) => i.rule)).toContain('approval-expression-invalid');
    });

    it('publishes a draft that is clean', async () => {
        const { protocol } = makeProtocol();
        await save(protocol, validApprovalFlow(), { mode: 'draft' });
        const result = await protocol.publishMetaItem({ type: 'flow', name: 'leave_approval' });
        expect(result.success).toBe(true);
    });

    // ── D4: the escape hatch ─────────────────────────────────────────────

    it('OS_ALLOW_UNLINTED_METADATA_WRITES=1 allows the write and says so loudly', async () => {
        process.env.OS_ALLOW_UNLINTED_METADATA_WRITES = '1';
        const { protocol, rows } = makeProtocol();

        const result = await save(protocol, brokenApprovalFlow());
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);

        const shouted = (warn.mock.calls as unknown[][])
            .map((c) => String(c[0]))
            .filter((m) => m.includes('OS_ALLOW_UNLINTED_METADATA_WRITES'));
        expect(shouted.length, 'the hatch makes a violation TOLERATED, never invisible').toBe(1);
        expect(shouted[0]).toContain('approval-expression-invalid');
        expect(shouted[0]).toContain('leave_approval');
    });

    // ── Scope: what the gate must NOT do ─────────────────────────────────

    it('does not gate control-plane (package-author) writes', async () => {
        // `environmentId === undefined` is the package author's own channel —
        // the same carve-out every ADR-0005 authorization gate above it makes.
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
        const result = await protocol.saveMetaItem({
            type: 'flow',
            name: 'leave_approval',
            item: brokenApprovalFlow(),
        });
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);
    });

    it('does not gate `os migrate meta --stored`, which rewrites rows that already exist', async () => {
        // D4's other half. The migration heals stored bodies into the current
        // dialect; it is not an author publishing anything. Gating it would
        // mean a tenant holding one pre-existing violation could never
        // canonicalize that row — the migration would report `failed` and
        // leave the body in the OLDER dialect, which is worse than the state
        // it was asked to improve. `source` is server-stated (never forwarded
        // from a request), so this cannot be spelled past the gate by a caller.
        const { protocol, rows } = makeProtocol();
        const result = await save(protocol, brokenApprovalFlow(), { source: 'migrate-stored' });
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);
    });

    it('DOES gate an ordinary save that merely looks like one (no source spoofing)', async () => {
        // The carve-out is on one exact server-stated token; anything else —
        // including a caller's guess at it — still meets the gate.
        const { protocol } = makeProtocol();
        for (const source of [undefined, 'protocol.saveMetaItem', 'migrate', 'migrate-stored-ish']) {
            const err = await save(protocol, brokenApprovalFlow(), source ? { source } : {})
                .catch((e: any) => e);
            expect(err?.status, `source=${String(source)} must still be gated`).toBe(422);
        }
    });

    it('does not gate a metadata type no rule declares (P1 wires `flow` only)', async () => {
        // `object` writes are deliberately outside P1 — see the registry's
        // RUNTIME_OBJECT_WRITES_P2 reason. A type nobody declared must pass
        // through untouched rather than be silently half-checked.
        const { protocol } = makeProtocol();
        const result = await protocol.saveMetaItem({
            type: 'object',
            name: 'leave_request',
            item: {
                name: 'leave_request',
                label: 'Leave Request',
                fields: { owner: { type: 'text', label: 'Owner' } },
            },
        });
        expect(result.success).toBe(true);
    });

    it('survives a host whose registry cannot list objects', async () => {
        // Context gathering is best-effort: a metadata-only store still writes,
        // it just gets the rules that need no object universe. It must never be
        // the reason a write fails.
        const { engine, rows } = makeStubEngine();
        engine.registry.listItems = () => { throw new Error('no registry here'); };
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any;

        await expect(
            protocol.saveMetaItem({ type: 'flow', name: 'leave_approval', item: validApprovalFlow() }),
        ).resolves.toMatchObject({ success: true });
        expect(flowRows(rows).length).toBe(1);

        // …and the refusal still happens without that context.
        const err = await protocol
            .saveMetaItem({ type: 'flow', name: 'other_flow', item: { ...brokenApprovalFlow(), name: 'other_flow' } })
            .catch((e: any) => e);
        expect(err.status).toBe(422);
    });
});
