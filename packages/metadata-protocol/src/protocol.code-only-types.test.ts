// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5086 — `allowRuntimeCreate: false` is enforced on EVERY kernel.
 *
 * #4509 set `allowRuntimeCreate: false` on `job` and its changeset promised
 * the refusal without qualification — *no "create job" in Studio or via
 * `PUT /meta`*. ADR-0063 §2 says the same for `agent`. The gate that keeps
 * that promise sat behind `environmentId !== undefined`, so it ran on
 * project-scoped (cloud per-env) kernels only. Every kernel assembled
 * WITHOUT an environmentId — which is what the CLI's lightweight assembler
 * builds for a host config (`isHostConfig` → `shouldBootWithLibrary` false →
 * `new ObjectQLPlugin()`), i.e. the flagship showcase and every self-hosted
 * app server shaped like it — accepted the write and answered
 * `200 {"success":true,"message":"Saved customization overlay (env-wide) …"}`
 * for a `job` whose `handler` names no function in any compiled bundle.
 *
 * So these tests run every case against BOTH kernel shapes. The unscoped one
 * is the regression; the scoped one pins the behaviour that already worked so
 * the two topologies can never drift apart again.
 *
 * The flags are DATA (`DEFAULT_METADATA_TYPE_REGISTRY`), so the suite is
 * data-driven: it derives the code-only set from the registry and fails when
 * a newly-flagged type arrives without a probe payload here. Covering the
 * next flagged type costs one entry in {@link PROBES}.
 *
 * Harness: the real write path over a stub engine (same shape as
 * `protocol.runtime-authoring-gate.test.ts`) — a gate INSIDE `saveMetaItem`
 * cannot be tested against a harness that mocks `saveMetaItem`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
}

/**
 * A type is code-only when the registry gives it NO runtime write channel at
 * all. Derived, never hardcoded — Prime Directive #8 ("no parallel
 * whitelists"): if someone flags a third type, this set grows by itself and
 * the coverage guard below turns red until it has a probe.
 */
const CODE_ONLY_TYPES = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => !e.allowRuntimeCreate && !e.allowOrgOverride)
    .map((e) => e.type);

/**
 * Schema-VALID bodies, straight from the issue's repro. This matters: a
 * minimal payload 422s on spec validation first, which is exactly what made
 * the missing gate easy to miss — only a body the schema accepts proves the
 * refusal came from the registry consult.
 */
const PROBES: Record<string, { name: string; item: Record<string, unknown> }> = {
    job: {
        name: 'rc3_runtime_job',
        item: {
            name: 'rc3_runtime_job',
            label: 'J',
            schedule: { type: 'cron', expression: '0 0 * * *' },
            handler: 'nope',
        },
    },
    agent: {
        name: 'rc3_agent_probe',
        item: {
            name: 'rc3_agent_probe',
            label: 'A',
            role: 'assistant',
            instructions: 'be helpful',
        },
    },
};

function makeStubEngine(artifacts: Array<{ type: string; name: string }> = []) {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const artifactKeys = new Set(artifacts.map((a) => `${a.type}|${a.name}`));
    const keyOf = (w: Record<string, unknown>) =>
        `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            for (const row of rows.values()) {
                if (opts.where.type !== undefined && row.type !== opts.where.type) continue;
                if (opts.where.name !== undefined && row.name !== opts.where.name) continue;
                return row;
            }
            return null;
        },
        async find() { return []; },
        async insert(_t: string, data: Record<string, unknown>) {
            if (_t !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update() { return { id: null }; },
        async delete() { return { deleted: 0 }; },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: () => [],
            getItem: () => undefined,
            // `isArtifactBacked` prefers this lookup — a hit here means the
            // name is shipped by a code package (`_packageId` provenance).
            getArtifactItem: (type: string, name: string) =>
                artifactKeys.has(`${type}|${name}`) ? { name, _packageId: 'showcase' } : undefined,
        },
    };
    return { engine, rows };
}

/**
 * The two kernel shapes this issue is about.
 *
 *  • `single-kernel`   — `environmentId` undefined. The CLI lightweight
 *    assembler / showcase topology, where the gate never ran (the bug).
 *  • `project-kernel`  — `environmentId` set. Cloud per-env kernels, where
 *    the gate already ran (the pin).
 */
const KERNELS: Array<{ label: string; environmentId?: string }> = [
    { label: 'single-kernel (no environmentId)' },
    { label: 'project-kernel (environmentId set)', environmentId: 'env_test' },
];

function makeProtocol(environmentId?: string, artifacts?: Array<{ type: string; name: string }>) {
    const { engine, rows } = makeStubEngine(artifacts);
    const protocol = new ObjectStackProtocolImplementation(
        engine,
        () => new Map(),
        environmentId,
    ) as any;
    return { protocol, rows };
}

const metaRows = (rows: Map<string, Row>) => Array.from(rows.values());

describe('code-only metadata types are refused on every kernel (#5086)', () => {
    beforeEach(() => {
        delete process.env.OS_METADATA_WRITABLE;
        // Two memoised readers of the same env var — the protocol's gate and
        // the repository's `assertAllowed`. Both must be reset or the second
        // one answers from a stale parse.
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
    });
    afterEach(() => {
        delete process.env.OS_METADATA_WRITABLE;
        // Two memoised readers of the same env var — the protocol's gate and
        // the repository's `assertAllowed`. Both must be reset or the second
        // one answers from a stale parse.
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
    });

    // ── the flags are data: keep the suite honest about new ones ──────────

    it('covers every code-only type the registry declares', () => {
        // Today: job (#4509) and agent (ADR-0063 §2). When a third type is
        // flagged, this fails until it has a schema-valid probe above —
        // which is the whole cost of covering it.
        expect(CODE_ONLY_TYPES.length).toBeGreaterThan(0);
        expect([...CODE_ONLY_TYPES].sort()).toEqual(['agent', 'job']);
        for (const type of CODE_ONLY_TYPES) {
            expect(PROBES[type], `no probe payload for code-only type '${type}'`).toBeDefined();
        }
    });

    // ── the refusal, per flagged type, on both kernels ────────────────────

    for (const { label, environmentId } of KERNELS) {
        describe(label, () => {
            for (const type of CODE_ONLY_TYPES) {
                const probe = PROBES[type]!;

                it(`refuses a schema-valid ${type} create with the catalogued code`, async () => {
                    const { protocol, rows } = makeProtocol(environmentId);

                    const err = await protocol
                        .saveMetaItem({ type, name: probe.name, item: probe.item })
                        .then(() => null, (e: any) => e);

                    expect(err, 'the write was accepted').not.toBeNull();
                    expect(err.code).toBe('NOT_CREATABLE');
                    expect(err.status).toBe(403);
                    // Names the type and why it is code-only — a refusal the
                    // author can act on without reading the source.
                    expect(err.message).toContain(`'${type}'`);
                    expect(err.message).toContain('allowRuntimeCreate=false');
                    expect(err.message).toContain('code-only');

                    // A gate that refuses AFTER persisting is a log line.
                    expect(metaRows(rows)).toEqual([]);
                });

                it(`refuses an org-scoped ${type} create too`, async () => {
                    const { protocol, rows } = makeProtocol(environmentId);
                    const err = await protocol
                        .saveMetaItem({
                            type,
                            name: probe.name,
                            item: probe.item,
                            organizationId: 'org_alpha',
                        })
                        .then(() => null, (e: any) => e);

                    expect(err?.code).toBe('NOT_CREATABLE');
                    expect(metaRows(rows)).toEqual([]);
                });

                it(`refuses a ${type} DRAFT save (Studio's staging door)`, async () => {
                    // #4509 is explicit that Studio must not offer "create" at
                    // all — staging it as a draft first is the same create.
                    const { protocol, rows } = makeProtocol(environmentId);
                    const err = await protocol
                        .saveMetaItem({ type, name: probe.name, item: probe.item, mode: 'draft' })
                        .then(() => null, (e: any) => e);

                    expect(err?.code).toBe('NOT_CREATABLE');
                    expect(metaRows(rows)).toEqual([]);
                });

                it(`refuses overlaying an artifact-backed ${type} with not_overridable`, async () => {
                    // Same verdict, honest reason: the name IS shipped by a
                    // code package, so "you may not overlay it" beats "you may
                    // not create it".
                    const { protocol, rows } = makeProtocol(environmentId, [
                        { type, name: probe.name },
                    ]);
                    const err = await protocol
                        .saveMetaItem({ type, name: probe.name, item: probe.item })
                        .then(() => null, (e: any) => e);

                    expect(err?.code).toBe('NOT_OVERRIDABLE');
                    expect(err.status).toBe(403);
                    expect(err.message).toContain(`${type}/${probe.name}`);
                    expect(metaRows(rows)).toEqual([]);
                });
            }
        });
    }

    // ── no over-blocking: types WITHOUT the flags still save ──────────────

    describe('types the registry does not declare code-only still save', () => {
        it('view (allowOrgOverride + allowRuntimeCreate) saves on a single kernel', async () => {
            const { protocol, rows } = makeProtocol(undefined);
            const result = await protocol.saveMetaItem({
                type: 'view',
                name: 'rc3_probe_view',
                item: {
                    name: 'rc3_probe_view',
                    label: 'Probe',
                    object: 'task',
                    columns: [{ field: 'name', label: 'Name' }],
                },
            });
            expect(result.success).toBe(true);
            expect(metaRows(rows).length).toBe(1);
        });

        it('hook (allowOrgOverride:false, allowRuntimeCreate:true) still saves on both kernels', async () => {
            // The two-tier model (ADR-0005 PR-10d.7): no artifact at this name
            // means only `allowRuntimeCreate` is required. This is the case the
            // #5086 gate must NOT catch — it is the difference between "code-only"
            // and "packaged items are locked".
            for (const { environmentId } of KERNELS) {
                const { protocol, rows } = makeProtocol(environmentId);
                const result = await protocol.saveMetaItem({
                    type: 'hook',
                    name: 'rc3_probe_hook',
                    item: { name: 'rc3_probe_hook', object: 'task', events: ['beforeUpdate'] },
                    ...(environmentId ? { organizationId: 'org_alpha' } : {}),
                });
                expect(result.success).toBe(true);
                expect(metaRows(rows).length).toBe(1);
            }
        });

        it('a plugin-registered type with no static registry entry still saves', async () => {
            // `getMetaTypes()` synthesises those with allowRuntimeCreate:true;
            // the write gate must keep agreeing with what it advertises.
            const { protocol, rows } = makeProtocol(undefined);
            const result = await protocol.saveMetaItem({
                type: 'theme',
                name: 'rc3_probe_theme',
                item: { name: 'rc3_probe_theme', label: 'Probe', tokens: {} },
            });
            expect(result.success).toBe(true);
            expect(metaRows(rows).length).toBe(1);
        });
    });

    // ── one door, not two: the operator escape hatch still opens ──────────

    describe('OS_METADATA_WRITABLE stays the single escape hatch', () => {
        for (const type of CODE_ONLY_TYPES) {
            it(`unlocks ${type} on a single kernel when the operator sets it`, async () => {
                const probe = PROBES[type]!;
                process.env.OS_METADATA_WRITABLE = type;
                ObjectStackProtocolImplementation.resetEnvWritableCache();
                resetEnvWritableMetadataTypes();

                const { protocol } = makeProtocol(undefined);
                // Only the gate is under test — a later stage may still object
                // to the body, but never with the code-only verdict.
                const err = await protocol
                    .saveMetaItem({ type, name: probe.name, item: probe.item })
                    .then(() => null, (e: any) => e);

                expect(err?.code).not.toBe('NOT_CREATABLE');
                expect(err?.code).not.toBe('NOT_OVERRIDABLE');
            });
        }
    });
});
