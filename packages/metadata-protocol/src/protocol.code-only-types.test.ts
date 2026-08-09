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
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright — which is why all 26
// of this package's (file, verb) pairs sat in the gate's DEBT ledger until
// #5619 sank the two predicates into a package both sides already depend on.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
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
    // [#5961] The third flagged type. ADR-0066 D1: packages DEFINE
    // capabilities — an administrator minting one at runtime has no place in
    // the capability / assignment / requirement separation, so the kind is
    // code-only for the same reason `job` and `agent` are. This probe is
    // schema-valid on purpose (see the note above): only a body the schema
    // ACCEPTS proves the refusal came from the registry consult rather than
    // from the 422 that #5961 also gave this type.
    capability: {
        name: 'rc3_capability_probe',
        item: {
            name: 'rc3_capability_probe',
            label: 'C',
            description: 'Probe capability.',
            scope: 'org',
            packageId: 'com.example.probe',
        },
    },
    // [#5488] The fourth flagged type. `api` declared `allowRuntimeCreate:
    // true` and the runtime never honoured it: `matchEndpoint` reads
    // `MetadataManager.listForIndex('api')` (the manager's registry plus its
    // filesystem/memory loaders), while a runtime write lands in
    // `sys_metadata` — so `PUT /api/v1/meta/api/:name` answered 200 "Saved"
    // and the declared route 404'd forever. ADR-0049 enforce-or-remove, ruled
    // REMOVE on 2026-08-07. Endpoints are authored as stack artifacts
    // (`**/*.api.ts`) and shipped through `publishPackage`, which is untouched.
    //
    // Schema-valid on purpose, like the three above — and here it carries
    // extra weight: `api` gained `ApiEndpointSchema` in #5271, so a minimal
    // body would 422 before the registry consult and the probe would prove
    // nothing about the code-only gate.
    api: {
        name: 'rc3_api_probe',
        item: {
            name: 'rc3_api_probe',
            path: '/api/v1/apps/example_namespace/probe',
            method: 'GET',
            type: 'object_operation',
            target: 'example_object',
            objectParams: { object: 'example_object', operation: 'find' },
        },
    },
};

function makeStubEngine(artifacts: Array<{ type: string; name: string }> = []) {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const artifactKeys = new Set(artifacts.map((a) => `${a.type}|${a.name}`));
    const keyOf = (w: Record<string, unknown>) =>
        `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;
    // #5264 — every write the engine is asked for, in order. `rows` alone
    // cannot tell the two persistence routes apart (both end at
    // `insert('sys_metadata', …)`); the tell is whether a
    // `sys_metadata_history` append came with it. See the #5264 block below.
    const writes: Array<{ op: 'insert' | 'update' | 'delete'; table: string }> = [];
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
            writes.push({ op: 'insert', table: _t });
            if (_t !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            writes.push({ op: 'update', table: _t });
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            writes.push({ op: 'delete', table: _t });
            return { deleted: 0 };
        },
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
    return { engine, rows, writes };
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
    const { engine, rows, writes } = makeStubEngine(artifacts);
    const protocol = new ObjectStackProtocolImplementation(
        engine,
        () => new Map(),
        environmentId,
    ) as any;
    return { protocol, rows, writes };
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
        // Today: job (#4509), agent (ADR-0063 §2), capability (#5961,
        // ADR-0066 D1) and api (#5488, ADR-0049 remove side — the maintainer
        // ruling of 2026-08-07 withdrew a runtime create door the endpoint
        // matcher could never read). When a fifth type is flagged, this fails
        // until it has a schema-valid probe above — which is the whole cost of
        // covering it, and is exactly what happened when `capability` joined
        // and again when `api` did: this assertion and the generated cases
        // went red on the spec-side registry edit alone, before a line of this
        // file was touched. That auto-enrolment is the point of deriving the
        // set instead of listing it (Prime Directive #8).
        expect(CODE_ONLY_TYPES.length).toBeGreaterThan(0);
        expect([...CODE_ONLY_TYPES].sort()).toEqual(['agent', 'api', 'capability', 'job']);
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

    // ── #5264 — one persistence route, and the proof it is the only one ───
    //
    // `saveMetaItem` used to end in a legacy raw-engine branch: `engine.insert`
    // / `engine.update` straight into `sys_metadata`, no `sys_metadata_history`
    // append, no watch event, no `seq`. It ran exactly when
    // `isOverlayAllowed(type) || isRuntimeCreateAllowed(type)` was false —
    // which is the predicate the #5086 gate above throws on, unconditionally,
    // over the same canonicalized type key. #5264 removed the branch.
    //
    // These pins are about the RECEIPT, not the verdict, because the receipt is
    // the only thing that told the two routes apart from outside: the legacy
    // one answered `200 {"success":true,"message":"Saved customization overlay
    // (env-wide) — type=…"}` with no `state=`, no `[seq=…]`, and no history
    // row. That is precisely the answer #5086 caught the showcase giving for a
    // `job`. (#5265 later split the surviving repository sentence in two: the
    // overlay noun is now conditional on `isArtifactBacked`, so a runtime-only
    // save reads `Saved <type> '<name>' (env-wide, state=…) [seq=…]`. The
    // discriminators these pins assert on — `state=` and `[seq=…]` — are on
    // BOTH branches, which is why they are matched here and the noun is not.)
    // They are green before the removal too — a branch nothing reaches
    // is what "dead" means — so they are not a regression test for the
    // deletion; they are the guard that stops a second historyless write path
    // from being introduced, and they fail loudly if the #5086 gate is ever
    // narrowed back to `environmentId !== undefined`.
    describe('#5264 — saveMetaItem persists through the repository or not at all', () => {
        for (const type of CODE_ONLY_TYPES) {
            it(`asks the engine for NOTHING when refusing ${type} on a control-plane kernel`, async () => {
                // The exact condition the deleted branch claimed for itself:
                // "control-plane bootstrap (environmentId === undefined) for
                // non-overlay-allowed types". Driven here on purpose — the
                // refusal lands first, so the write never becomes a write.
                const probe = PROBES[type]!;
                const { protocol, rows, writes } = makeProtocol(undefined);

                const err = await protocol
                    .saveMetaItem({ type, name: probe.name, item: probe.item })
                    .then(() => null, (e: any) => e);

                expect(err?.status).toBe(403);
                expect(metaRows(rows)).toEqual([]);
                // Stronger than "no row landed": no write was even attempted,
                // so there is nothing for a raw-engine path to have done.
                expect(writes).toEqual([]);
            });
        }

        // One savable type per shape the two-tier model distinguishes.
        const ACCEPTED: Array<{ type: string; item: Record<string, unknown> }> = [
            {
                type: 'view', // allowOrgOverride + allowRuntimeCreate
                item: {
                    name: 'rc3_receipt_view',
                    label: 'Receipt',
                    object: 'task',
                    columns: [{ field: 'name', label: 'Name' }],
                },
            },
            {
                type: 'hook', // allowRuntimeCreate only
                item: { name: 'rc3_receipt_view', object: 'task', events: ['beforeUpdate'] },
            },
            {
                type: 'theme', // no static registry entry (plugin-registered)
                item: { name: 'rc3_receipt_view', label: 'Receipt', tokens: {} },
            },
        ];

        for (const { label, environmentId } of KERNELS) {
            for (const { type, item } of ACCEPTED) {
                it(`answers a ${type} save with a repository receipt on a ${label}`, async () => {
                    const { protocol, writes } = makeProtocol(environmentId);

                    const result = await protocol.saveMetaItem({
                        type,
                        name: 'rc3_receipt_view',
                        item,
                        ...(environmentId ? { organizationId: 'org_alpha' } : {}),
                    });

                    expect(result.success).toBe(true);
                    // `seq` and `state` exist only on the repository receipt.
                    expect(typeof result.seq).toBe('number');
                    expect(result.state).toBe('active');
                    expect(result.message).toContain('[seq=');
                    // And the change log really was appended — the legacy
                    // branch's defining omission.
                    expect(writes.some((w) => w.table === 'sys_metadata_history')).toBe(true);
                });
            }
        }

        for (const type of CODE_ONLY_TYPES) {
            it(`routes ${type} back through the repository once OS_METADATA_WRITABLE unlocks it`, async () => {
                // The last leg of the unreachability argument: the escape hatch
                // does not open a second door. Unlocking a type makes
                // `isOverlayAllowed` true, which is the same predicate the
                // repository path is chosen by — so an unlocked save is a
                // repository save, receipt and history row included.
                const probe = PROBES[type]!;
                process.env.OS_METADATA_WRITABLE = type;
                ObjectStackProtocolImplementation.resetEnvWritableCache();
                resetEnvWritableMetadataTypes();

                const { protocol, writes } = makeProtocol(undefined);
                const result = await protocol.saveMetaItem({
                    type,
                    name: probe.name,
                    item: probe.item,
                });

                expect(result.success).toBe(true);
                expect(typeof result.seq).toBe('number');
                expect(result.message).toContain('[seq=');
                expect(writes.some((w) => w.table === 'sys_metadata_history')).toBe(true);
            });
        }
    });
});
