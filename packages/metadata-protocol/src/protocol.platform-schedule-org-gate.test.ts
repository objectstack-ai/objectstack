// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6285 — the publish refusal for an UNSTAMPED platform-level scheduled writer
 * (#6155 Q2=A + Q3=A, maintainer ruling 2026-08-07).
 *
 * ## What is being pinned
 *
 * The refusal combination, all five limbs:
 *
 *   multi-organization posture
 *   && platform-level flow (the write carries no organization)
 *   && schedule trigger
 *   && contains a `create_record`
 *   && that node declares no `fields.organization_id`
 *   ⇒ refused at publish.
 *
 * Every limb's NEGATION is pinned too, because a guardrail that refuses one
 * more shape than the ruling names is a worse defect than one that refuses one
 * fewer: it turns a legitimate publish into a support ticket, on a surface
 * (Studio / MCP author) with no `--force`.
 *
 * ## Two faces, two assertion sets
 *
 * `evaluateRuntimeAuthoringGate` RETURNS the error and its caller throws it, so
 * per the dispatch's test guidance the two faces are asserted differently:
 *
 *  - the pure function ({@link findPlatformScheduleOrgGaps}) is asserted on its
 *    VERDICT STRUCTURE — rule id, path, severity, one issue per offending node;
 *  - the throwing surface (`saveMetaItem` / `publishMetaItem`) is asserted on
 *    the ADR-0112 ENVELOPE — `code` AND `status` together, never a bare
 *    `rejects.toThrow()`. A throw-only assertion carries one bit where this
 *    defect has two, and the unfixed code path here does not throw at all, so
 *    it would report "the promise resolved" and never "the envelope is
 *    missing".
 *
 * ## Posture is an INPUT, not an env read
 *
 * Q3=A puts the deployment-shape reading at the gate's CALLER
 * (`postureEnforcesWall(resolveTenancyPosture())` in
 * `assertRuntimeAuthoringRules`), never inside the pure function — the CLI runs
 * on a build machine whose env says nothing about the serving deployment. The
 * pure-function tests below therefore pass the posture directly; only the
 * end-to-end tests, which drive the real caller, set `OS_TENANCY_POSTURE`.
 *
 * Harness: the real repository write path over a stub engine — the same shape
 * as `protocol.runtime-authoring-gate.test.ts`, because a gate INSIDE
 * `saveMetaItem` cannot be tested against a harness that mocks `saveMetaItem`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The producer's OWN write-verb dispatch decisions (#4550 delete / #5480
// update), so the fake engine below cannot accept a call ObjectQL refuses.
// Imported from `@objectstack/metadata-core` and not from `@objectstack/objectql`:
// objectql DEPENDS ON this package, so that import would close a dependency
// cycle turbo rejects outright (#5619).
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import {
    PLATFORM_SCHEDULE_CREATE_RECORD_ORG_MISSING,
    findPlatformScheduleOrgGaps,
} from './runtime-authoring-gate.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — every one of them Zod-valid, so the refusal under test is the one
// being measured and not a schema failure wearing its clothes. (`saveMetaItem`
// runs `FlowSchema.safeParse` BEFORE this gate; an invalid fixture would 422
// with `failed spec validation` and the test would pass for the wrong reason.)
// ─────────────────────────────────────────────────────────────────────────────

/** The issue's shape: a nightly sweep that creates rows and names no organization. */
const scheduledSweep = () => ({
    name: 'nightly_sweep',
    label: 'Nightly Sweep',
    type: 'schedule',
    status: 'active',
    runAs: 'system',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 1 * * *' } },
        {
            id: 'log',
            type: 'create_record',
            label: 'Write sweep log',
            config: { objectName: 'sweep_log', fields: { note: 'swept' } },
        },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'log' }],
});

/** The same sweep with the organization declared — Q2=A's author-side answer. */
const scheduledSweepWithOrg = () => {
    const flow = scheduledSweep();
    (flow.nodes[1]!.config as Record<string, unknown>).fields = {
        note: 'swept',
        organization_id: 'org_a',
    };
    return flow;
};

/** A record-change flow that creates rows — a different trigger, so a different question. */
const recordChangeCreator = () => ({
    name: 'nightly_sweep',
    label: 'On Create',
    type: 'record_change',
    status: 'active',
    runAs: 'system',
    nodes: [
        {
            id: 'start',
            type: 'start',
            label: 'Start',
            config: { objectName: 'sweep_log', triggerType: 'record-after-create' },
        },
        {
            id: 'log',
            type: 'create_record',
            label: 'Write sweep log',
            config: { objectName: 'sweep_log', fields: { note: 'swept' } },
        },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'log' }],
});

/** A schedule flow that reads and never creates — nothing is born unpartitioned. */
const scheduledReader = () => ({
    name: 'nightly_sweep',
    label: 'Nightly Read',
    type: 'schedule',
    status: 'active',
    runAs: 'system',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 1 * * *' } },
        {
            id: 'read',
            type: 'get_record',
            label: 'Read rows',
            config: { objectName: 'sweep_log', outputVariable: 'rows' },
        },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'read' }],
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The pure function — verdict structure.
// ─────────────────────────────────────────────────────────────────────────────

const judge = (over: Record<string, unknown> = {}) =>
    findPlatformScheduleOrgGaps({
        type: 'flow',
        name: 'nightly_sweep',
        body: scheduledSweep(),
        orgWallEnforced: true,
        ...over,
    } as Parameters<typeof findPlatformScheduleOrgGaps>[0]);

describe('findPlatformScheduleOrgGaps — the refusal combination (#6285)', () => {
    it('reports one error per unstamped create_record when all five limbs hold', () => {
        const issues = judge();

        expect(issues).toHaveLength(1);
        const issue = issues[0]!;
        expect(issue.rule).toBe(PLATFORM_SCHEDULE_CREATE_RECORD_ORG_MISSING);
        expect(issue.severity).toBe('error');
        // The path points at the key the author must WRITE, not at the node —
        // this is the address Studio highlights.
        expect(issue.path).toBe('flows[0].nodes[1].config.fields.organization_id');
        expect(issue.where).toContain('nightly_sweep');
        expect(issue.where).toContain('Write sweep log');
        expect(issue.message).toContain('organization_id');
        expect(issue.message).toContain('sweep_log');
        expect(issue.hint).toContain('config.fields.organization_id');
    });

    // ── Limb negations, one test each ────────────────────────────────────

    it('passes on a SINGLE-organization deployment (no wall to land outside of)', () => {
        expect(judge({ orgWallEnforced: false })).toEqual([]);
    });

    it('passes when the flow is written INTO an organization', () => {
        expect(judge({ organizationId: 'org_a' })).toEqual([]);
    });

    it('passes for a non-schedule trigger — a record-change flow resolves an org', () => {
        expect(judge({ body: recordChangeCreator() })).toEqual([]);
    });

    it('passes for a schedule flow that creates nothing', () => {
        expect(judge({ body: scheduledReader() })).toEqual([]);
    });

    it('passes when the author declares fields.organization_id (#6153 fill-only, author wins)', () => {
        expect(judge({ body: scheduledSweepWithOrg() })).toEqual([]);
    });

    it('passes for a metadata type that is not a flow', () => {
        expect(judge({ type: 'view', body: scheduledSweep() })).toEqual([]);
    });

    // ── The "declared" in declared-organization has to mean something ────

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['an empty string', ''],
        ['whitespace', '   '],
    ])('does NOT accept %s as a declaration', (_label, value) => {
        const flow = scheduledSweep();
        (flow.nodes[1]!.config as Record<string, unknown>).fields = {
            note: 'swept',
            organization_id: value,
        };
        const issues = judge({ body: flow });
        expect(
            issues,
            'writing the key with no value would silence the refusal without answering it — '
                + 'the "declared ≠ enforced" shape this gate exists to close.',
        ).toHaveLength(1);
    });

    it('accepts a template token as a declaration — it resolves at run time', () => {
        const flow = scheduledSweep();
        (flow.nodes[1]!.config as Record<string, unknown>).fields = {
            organization_id: '{record.organization_id}',
        };
        expect(judge({ body: flow })).toEqual([]);
    });

    // ── Region traversal: the shape a sweep actually has ─────────────────

    it('finds a create_record nested in a loop body, with the nested path', () => {
        // A sweep that writes one row per matched record keeps its
        // `create_record` inside a `loop`. A walk over `flow.nodes` alone would
        // be blind to exactly the shape this rule exists for (the #4380
        // defect), so the region walk is load-bearing rather than defensive.
        const flow = {
            name: 'nightly_sweep',
            label: 'Nightly Sweep',
            type: 'schedule',
            status: 'active',
            runAs: 'system',
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 1 * * *' } },
                {
                    id: 'each',
                    type: 'loop',
                    label: 'For each row',
                    config: {
                        collection: '{rows}',
                        body: {
                            nodes: [
                                {
                                    id: 'log',
                                    type: 'create_record',
                                    label: 'Write sweep log',
                                    config: { objectName: 'sweep_log', fields: { note: 'swept' } },
                                },
                            ],
                            edges: [],
                        },
                    },
                },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'each' }],
        };

        const issues = judge({ body: flow });
        expect(issues).toHaveLength(1);
        expect(issues[0]!.path).toBe(
            'flows[0].nodes[1].config.body.nodes[0].config.fields.organization_id',
        );
    });

    it('reports every offending node, not just the first', () => {
        const flow = scheduledSweep();
        flow.nodes.push({
            id: 'log2',
            type: 'create_record',
            label: 'Write audit row',
            config: { objectName: 'sweep_log', fields: { note: 'audited' } },
        } as (typeof flow.nodes)[number]);
        expect(judge({ body: flow }).map((i) => i.path)).toEqual([
            'flows[0].nodes[1].config.fields.organization_id',
            'flows[0].nodes[2].config.fields.organization_id',
        ]);
    });

    // ── Trigger precedence, copied from the engine rather than guessed ───

    it('leaves a time-relative sweep alone even though it also carries a schedule', () => {
        // `AutomationEngine.resolveTriggerBinding` checks `timeRelative` BEFORE
        // `schedule`, so such a flow binds to the time-relative trigger — which
        // launches once per matched RECORD and therefore has an org to resolve.
        // Judging it here would refuse a flow that never reaches ScheduleTrigger.
        const flow = scheduledSweep();
        (flow.nodes[0]!.config as Record<string, unknown>).timeRelative = {
            object: 'sweep_log',
            field: 'due_date',
            offsetDays: -1,
        };
        expect(judge({ body: flow })).toEqual([]);
    });

    it('judges a flow whose START node carries a schedule even when `type` is not `schedule`', () => {
        // The engine's own disjunction: `config.schedule != null || flow.type === 'schedule'`.
        const flow = scheduledSweep();
        flow.type = 'autolaunched';
        expect(judge({ body: flow })).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The throwing surface — the ADR-0112 envelope, end to end.
// ─────────────────────────────────────────────────────────────────────────────

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
            // The live object universe the shared rules resolve names against.
            listItems: (type: string) =>
                type === 'object'
                    ? [{
                        name: 'sweep_log',
                        label: 'Sweep Log',
                        fields: {
                            note: { type: 'text', label: 'Note' },
                            due_date: { type: 'date', label: 'Due' },
                        },
                    }]
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
    protocol.saveMetaItem({ type: 'flow', name: 'nightly_sweep', item, ...extra });

describe('#6285 refusal through saveMetaItem / publishMetaItem', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    const savedPosture = process.env.OS_TENANCY_POSTURE;

    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
        // ADR-0105 D1's canonical knob. `isolated` is the posture formerly
        // spelled `multi`; `postureEnforcesWall` is true for it and for `group`.
        process.env.OS_TENANCY_POSTURE = 'isolated';
    });
    afterEach(() => {
        warn.mockRestore();
        delete process.env.OS_ALLOW_UNLINTED_METADATA_WRITES;
        if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
        else process.env.OS_TENANCY_POSTURE = savedPosture;
    });

    it('refuses the publish with the ADR-0112 envelope, and persists nothing', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await save(protocol, scheduledSweep()).catch((e: any) => e);

        // BOTH halves of the envelope. A bare `rejects.toThrow()` here would be
        // permanently green on a driver that throws a bare `Error`, and would
        // report "the promise resolved" on the unfixed path — neither of which
        // is a statement about the envelope (PR #6142 measured both directions).
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);

        const issue = err.issues.find(
            (i: any) => i.rule === PLATFORM_SCHEDULE_CREATE_RECORD_ORG_MISSING,
        );
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe('flows[0].nodes[1].config.fields.organization_id');

        // The disclosure that lets a caller tell "clean" from "nothing ran".
        expect(err.rulesRun).toContain(PLATFORM_SCHEDULE_CREATE_RECORD_ORG_MISSING);

        // And nothing landed. A gate that rejects AFTER persisting is a log line.
        expect(flowRows(rows)).toEqual([]);
    });

    it('allows the same flow once the author declares fields.organization_id', async () => {
        const { protocol, rows } = makeProtocol();
        const result = await save(protocol, scheduledSweepWithOrg());
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);
    });

    it('allows it on a single-organization deployment', async () => {
        process.env.OS_TENANCY_POSTURE = 'single';
        const { protocol, rows } = makeProtocol();
        const result = await save(protocol, scheduledSweep());
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);
    });

    it('refuses under the `group` posture too, not only `isolated`', async () => {
        // `postureEnforcesWall` is `false` for `single` ONLY. A group-shaped
        // deployment carries the same `(organization_id, …)` index that does
        // not constrain across NULL, so it is walled and the guardrail applies.
        process.env.OS_TENANCY_POSTURE = 'group';
        const { protocol } = makeProtocol();
        const err = await save(protocol, scheduledSweep()).catch((e: any) => e);
        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);
    });

    it('[#6190] an ORG-SCOPED write of the same flow is now refused BEFORE this rule runs', async () => {
        // Replaced wholesale rather than re-spelled, because what changed is
        // this case's REACHABILITY, and a fixture that keeps asserting a
        // verdict nothing can produce is green for an empty reason.
        //
        // It used to pin the limb NEGATION at the caller face: an org-scoped
        // write escaped #6285's 422 because "the row already names its
        // organization". The 2026-08-08 ruling on #6190 refuses an org-scoped
        // write of any non-org-overridable type — `flow` among them — at a gate
        // that runs EARLIER than `assertRuntimeAuthoringRules`. So the negation
        // is no longer reachable through `saveMetaItem`/`publishMetaItem` for
        // `flow`: the write never gets far enough to be judged by this rule.
        //
        // Recorded here, not acted on: whether #6285's org-present limb should
        // survive at all now that nothing can reach it through these two doors
        // is a question for that rule's own owner (#6710 is in flight in that
        // region), and this PR deliberately does not touch it. What this case
        // pins is the honest current fact — which refusal an org-scoped
        // platform-schedule flow actually gets.
        const { protocol, rows } = makeProtocol();
        const err = await save(protocol, scheduledSweep(), { organizationId: 'org_a' }).catch((e: any) => e);
        expect(err.code).toBe('NOT_OVERRIDABLE');
        expect(err.status).toBe(403);
        expect(flowRows(rows)).toEqual([]);
    });

    it('allows a DRAFT of the identical body, and refuses the publish that promotes it', async () => {
        const { protocol, rows } = makeProtocol();

        // D1 — a draft is allowed to be half-finished and cannot execute.
        const draft = await save(protocol, scheduledSweep(), { mode: 'draft' });
        expect(draft.success).toBe(true);
        expect(flowRows(rows).map((r) => r.state)).toContain('draft');

        // …and the promotion is gated, so the draft door is not a bypass.
        const err = await protocol
            .publishMetaItem({ type: 'flow', name: 'nightly_sweep' })
            .catch((e: any) => e);
        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);
        expect(err.issues.map((i: any) => i.rule))
            .toContain(PLATFORM_SCHEDULE_CREATE_RECORD_ORG_MISSING);
    });

    it('OS_ALLOW_UNLINTED_METADATA_WRITES=1 degrades it to a loud log, like every other rule', async () => {
        process.env.OS_ALLOW_UNLINTED_METADATA_WRITES = '1';
        const { protocol, rows } = makeProtocol();

        const result = await save(protocol, scheduledSweep());
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);

        const shouted = (warn.mock.calls as unknown[][])
            .map((c) => String(c[0]))
            .filter((m) => m.includes('OS_ALLOW_UNLINTED_METADATA_WRITES'));
        expect(shouted.length, 'the hatch makes a violation TOLERATED, never invisible').toBe(1);
        expect(shouted[0]).toContain(PLATFORM_SCHEDULE_CREATE_RECORD_ORG_MISSING);
    });

    it('does not gate control-plane (package-author) writes — the pre-existing carve-out', async () => {
        // The dispatch's STOP item. `environmentId === undefined` is the
        // control-plane / package-author channel, and the short-circuit is
        // EXISTING DESIGN (`protocol.runtime-authoring-gate.test.ts` pins it for
        // the other 26 rules). It does not put this guardrail out of reach:
        // every serving path binds an environment id (`env_local` /
        // `proj_local` / a cloud project), which is the case the test above
        // drives.
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
        const result = await protocol.saveMetaItem({
            type: 'flow',
            name: 'nightly_sweep',
            item: scheduledSweep(),
        });
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);
    });

    it('does not gate `os migrate meta --stored`, which rewrites rows that already exist', async () => {
        const { protocol, rows } = makeProtocol();
        const result = await save(protocol, scheduledSweep(), { source: 'migrate-stored' });
        expect(result.success).toBe(true);
        expect(flowRows(rows).length).toBe(1);
    });

    it('survives a deployment whose OS_TENANCY_POSTURE is unparseable, by failing CLOSED', async () => {
        // `resolveTenancyPosture()` THROWS on an unrecognized value rather than
        // falling back to a wall-less posture. That refusal belongs at boot; on
        // a metadata write the gate reads it as WALLED, so the guardrail arms
        // instead of silently disengaging. The write still only fails because
        // every other limb holds.
        process.env.OS_TENANCY_POSTURE = 'not_a_posture';
        const { protocol } = makeProtocol();
        const err = await save(protocol, scheduledSweep()).catch((e: any) => e);
        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);

        // …and a clean body is still publishable, so the fail-closed reading
        // never becomes "refuse everything".
        const { protocol: p2 } = makeProtocol();
        await expect(save(p2, scheduledSweepWithOrg())).resolves.toMatchObject({ success: true });
    });
});
