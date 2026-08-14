// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0008 PR-10a — Overlay precedence + hash dry-run fixtures.
 *
 * Pins down two invariants that must survive the PR-10b/c refactor
 * (re-expressing the overlay path as a LayeredRepository):
 *
 *   1. **Whitelist enforcement** — only metadata types whose registry
 *      entry sets `allowOrgOverride: true` may be persisted as
 *      per-organization overlays. Everything else (trigger, hook,
 *      datasource, function, service, …) MUST throw with
 *      `code='NOT_OVERRIDABLE'`, `status=403`. This is the
 *      shared-DB tenancy invariant (ADR-0005 amendment
 *      §"Tenant-customizable type whitelist").
 *
 *      Note: object, field, flow, workflow, agent, permission, role,
 *      and profile all flipped to `allowOrgOverride: true` in commit
 *      ba252da0b (feat: add project mode, metadata forms, and org
 *      overlays). The invariant now pins the execution/wiring-layer
 *      types that MUST stay false. Several of that commit's flips have
 *      since been rolled back for want of an ADR behind them —
 *      object/field (2026-05-29), agent (ADR-0063 §2) and, with #6283,
 *      `flow`: ADR-0005:57 lists automation as ❌ and always did, so the
 *      registry had been contradicting the document it is the
 *      machine-readable form of.
 *
 *   2. **Canonical hash stability** — every overlay row will carry a
 *      content hash once PR-10b lands. The hash must be insensitive
 *      to key order, whitespace, undefined-vs-absent, and otherwise
 *      stable across structurally-equivalent payloads. This is the
 *      dry-run precondition: if these properties hold, we can backfill
 *      `_hash` for existing sys_metadata rows without surprises.
 *
 * No production code is touched by this file — it exists to fail loud
 * if a future PR weakens the contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
import { canonicalize, hashSpec } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';

// ──────────────────────────────────────────────────────────────────────
// Shared test fixtures
// ──────────────────────────────────────────────────────────────────────

const validView = {
    name: 'case_grid',
    label: 'Cases',
    object: 'case',
    viewKind: 'list', // [#7741] the inline arm requires the object binding pair
    columns: [
        { field: 'name', label: 'Name' },
        { field: 'status', label: 'Status' },
    ],
};

const validDashboard = {
    name: 'sales_overview',
    label: 'Sales Overview',
    widgets: [],
};

const validReport = {
    name: 'monthly_revenue',
    label: 'Monthly Revenue',
    // ADR-0021 single-form: a report binds a dataset + selects values by name.
    type: 'summary',
    dataset: 'invoice_metrics',
    rows: ['month'],
    values: ['amount_sum'],
};

function makeProtocol(opts: { environmentId?: string } = {}) {
    const registry = new SchemaRegistry({ multiTenant: false });
    const mockEngine: any = {
        registry,
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue({ id: 'new-uuid' }),
        update: vi.fn().mockResolvedValue({ id: 'existing-uuid' }),
        delete: vi.fn().mockResolvedValue({ deleted: 1 }),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue([]),
    };
    const protocol = new ObjectStackProtocolImplementation(
        mockEngine,
        undefined, // getServicesRegistry
        opts.environmentId,
    );
    return { protocol, mockEngine, registry };
}

// ══════════════════════════════════════════════════════════════════════
// 1. Whitelist enforcement (ADR-0005 amendment §"Tenant-customizable …")
// ══════════════════════════════════════════════════════════════════════

describe('overlay whitelist enforcement (shared-DB invariant)', () => {
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(() => {
        // environmentId must be defined to engage the gate — single-kernel
        // deployments (no environmentId) intentionally bypass it.
        ({ protocol } = makeProtocol({ environmentId: 'env_prod' }));
    });

    afterEach(() => vi.clearAllMocks());

    // ── allowed types: pure render-time, safe per-org override ──
    describe('allowed (allowOrgOverride: true) — must accept', () => {
        it('accepts view', async () => {
            const result = await protocol.saveMetaItem({
                type: 'view',
                name: 'case_grid',
                item: validView,
                organizationId: 'org_alpha',
            });
            expect(result.success).toBe(true);
        });

        it('accepts dashboard', async () => {
            const result = await protocol.saveMetaItem({
                type: 'dashboard',
                name: 'sales_overview',
                item: validDashboard,
                organizationId: 'org_alpha',
            });
            expect(result.success).toBe(true);
        });

        it('accepts report (flipped to allowOrgOverride:true on 2026-05-22)', async () => {
            // This test pins the user-requested change from 8494fe8e —
            // if someone flips report back to false, this fails loud.
            const result = await protocol.saveMetaItem({
                type: 'report',
                name: 'monthly_revenue',
                item: validReport,
                organizationId: 'org_alpha',
            });
            expect(result.success).toBe(true);
        });

        it('accepts email_template', async () => {
            const result = await protocol.saveMetaItem({
                type: 'email_template',
                name: 'welcome',
                item: { name: 'welcome', label: 'Welcome', subject: 'Hi', bodyHtml: '<p>Hello</p>' },
                organizationId: 'org_alpha',
            });
            expect(result.success).toBe(true);
        });

        it('accepts plural form of allowed type (views)', async () => {
            const result = await protocol.saveMetaItem({
                type: 'views',
                name: 'case_grid',
                item: validView,
                organizationId: 'org_alpha',
            });
            expect(result.success).toBe(true);
        });
    });

    // ── denied types (two-tier model, ADR-0005 extension) ──
    //
    // After PR-10d.7 introduced `allowRuntimeCreate`, "denied" now splits
    // into two cohorts:
    //
    //  1. Types with `allowRuntimeCreate: true` (hook/validation) —
    //     blocked only when overlaying an artifact-backed item. Brand-new
    //     (artifact-free) names succeed. Tested separately below.
    //
    //  2. Types with `allowRuntimeCreate: false` — after ADR-0088 retired the
    //     router/function/service placeholder kinds, the members are `agent`
    //     (platform-owned, ADR-0063) and `job` (a code artifact: its `handler`
    //     names a function in the compiled bundle's function table, so a
    //     runtime-created job could never be scheduled — #4509) — blocked for
    //     ANY write in project-kernel mode.
    //
    //     NOTE: `datasource` moved to cohort #1 with the ADR-0015 Addendum
    //     (runtime-UI-creatable datasources). Brand-new runtime datasources
    //     are now allowed; collision with a code-defined (artifact-backed)
    //     datasource is still refused via the artifact provenance check.
    //     The error code surfaces as `not_creatable` when the item has no
    //     artifact (which the empty test-mock registry guarantees) and
    //     `not_overridable` when an artifact exists. Both carry status 403
    //     and the same underlying security guarantee.
    describe('denied — must throw 403 (not_overridable or not_creatable)', () => {
        const deniedTypeWide: Array<{ type: string; reason: string; item: any }> = [
            {
                type: 'agent',
                reason: 'agents are platform-owned (ADR-0063); per-org agent forks are withdrawn',
                item: { name: 'my_agent', label: 'My Agent' },
            },
            {
                type: 'job',
                reason: 'jobs are code artifacts (#4509): `handler` resolves only through the compiled bundle function table, so a runtime-created job could never be scheduled',
                item: { name: 'nightly_sync', label: 'Nightly Sync', schedule: '0 2 * * *', handler: 'syncAll' },
            },
        ];

        for (const { type, reason, item } of deniedTypeWide) {
            it(`rejects ${type} — ${reason}`, async () => {
                await expect(
                    protocol.saveMetaItem({
                        type,
                        name: item.name,
                        item,
                        organizationId: 'org_alpha',
                    }),
                ).rejects.toMatchObject({
                    code: expect.stringMatching(/^(NOT_OVERRIDABLE|NOT_CREATABLE)$/),
                    status: 403,
                });
            });
        }
    });

    // ── runtime-creatable types: brand-new items succeed; overriding an
    //    artifact-backed item still requires allowOrgOverride. The test
    //    registry has no artifacts, so saves all succeed here; provenance-
    //    aware rejection is exercised in `protocol-meta.test.ts`.
    describe('runtime-creatable (allowOrgOverride:false, allowRuntimeCreate:true) — brand-new items succeed', () => {
        const runtimeCreatable: Array<{ type: string; item: any }> = [
            { type: 'trigger', item: { name: 'on_insert', object: 'case', event: 'beforeInsert' } },
            // `validation` left this list with the kind (#4509, ADR-0088): it is
            // no longer registered, so "runtime-creatable" no longer describes
            // it. The reintroduction guard below is what holds the line now.
            { type: 'hook', item: { name: 'before_save', object: 'case', events: ['beforeInsert'] } },
            { type: 'hooks', item: { name: 'before_save', object: 'case', events: ['beforeInsert'] } }, // plural
            // object reverted to allowOrgOverride:false on 2026-05-29 —
            // packaged items locked, brand-new tenant-authored items succeed.
            {
                type: 'object',
                item: {
                    name: 'tenant_widget',
                    label: 'Widget',
                    // [#8310] The runtime object door requires an authored OWD.
                    sharingModel: 'private',
                    fields: { title: { name: 'title', type: 'text', label: 'Title' } },
                },
            },
            // `field` left this list on 2026-08-12 (#7893, maintainer-ruled),
            // the same way `validation` left it with its kind: "runtime-
            // creatable" stopped describing it. Unlike `validation` the KIND
            // survives — reads, `/meta/types` and #7743's overlay refusal all
            // still need it — but its CREATE door is closed
            // (`allowRuntimeCreate: false`), because a standalone `field` write
            // minted a row keyed ('field','<object>.<name>') that nothing ever
            // composed into the parent object: measured 200 `state=active` at
            // the write, and the field absent from `GET /meta/object/...`
            // forever. A field is added by writing its OBJECT — the `object`
            // specimen directly above carries `fields`, which is that route.
            // The line is now held by `protocol.code-only-types.test.ts` (which
            // derives the code-only set from the registry, so `field`
            // auto-enrolled) and by the declaration pin in
            // `packages/spec/src/kernel/metadata-type-field-registration.test.ts`.
            // datasource/datasources became runtime-creatable with the
            // ADR-0015 Addendum (UI "Add Datasource"). Brand-new runtime
            // datasources succeed; code-defined collisions are refused via
            // artifact provenance (exercised in protocol-meta.test.ts).
            {
                type: 'datasource',
                item: { name: 'analytics', driver: 'sql', config: {} },
            },
            {
                type: 'datasources', // plural — maps to `datasource` via PLURAL_TO_SINGULAR
                item: { name: 'analytics2', driver: 'sql', config: {} },
            },
        ];

        for (const { type, item } of runtimeCreatable) {
            it(`accepts brand-new ${type}`, async () => {
                // [#6190] These writes used to pass `organizationId: 'org_alpha'`.
                // The org was scenery: what this loop measures is the two-tier
                // verdict — brand-new items of `allowRuntimeCreate` types are
                // NOT caught by the overlay whitelist. Since the 2026-08-08
                // ruling an org-scoped write of these very types is refused by a
                // different gate, so keeping the org here would have measured
                // that refusal instead of this one. Pinned in metadata-protocol's
                // `protocol.org-scoped-write-refused.test.ts`.
                const result = await protocol.saveMetaItem({
                    type,
                    name: item.name,
                    item,
                });
                expect(result.success).toBe(true);
            });
        }
    });

    // ── single-kernel deployments: overlay gate disengaged ──
    describe('single-kernel mode (no environmentId) — overlay gate bypassed', () => {
        it('allows a hook overlay when environmentId is undefined (gate bypassed)', async () => {
            // No environmentId => not project-kernel mode => legacy "anything goes"
            // path used by control-plane bootstrap. ADR-0005 §"Whitelist".
            //
            // The specimen used to be `agent`, which #5086 moved out from under
            // this bypass: a type declaring BOTH `allowRuntimeCreate: false` and
            // `allowOrgOverride: false` is code-only and is refused on EVERY
            // kernel (see `protocol.code-only-types.test.ts`). What ADR-0005's
            // sentence actually granted single kernels — the *overlay* whitelist
            // staying off — is unchanged, so `hook` (allowOrgOverride:false,
            // allowRuntimeCreate:true) is now the honest specimen for it.
            const { protocol: localProto } = makeProtocol({ environmentId: undefined });
            const result = await localProto.saveMetaItem({
                type: 'hook',
                name: 'my_hook',
                item: { name: 'my_hook', object: 'case', events: ['beforeUpdate'] },
            });
            expect(result.success).toBe(true);
        });

        it('refuses a code-only type even with environmentId undefined (#5086)', async () => {
            const { protocol: localProto } = makeProtocol({ environmentId: undefined });
            await expect(
                localProto.saveMetaItem({
                    type: 'agent',
                    name: 'my_agent',
                    item: { name: 'my_agent', label: 'My Agent', role: 'assistant', instructions: 'Answer questions about test data.' },
                }),
            ).rejects.toMatchObject({ code: 'NOT_CREATABLE', status: 403 });
        });
    });

    // ── registry invariant: whitelist derives from spec, no parallel list ──
    describe('registry-as-source-of-truth (Prime Directive #8)', () => {
        it('every type in OVERLAY_ALLOWED_TYPES has allowOrgOverride:true in the registry', () => {
            // The protocol's whitelist is derived from
            // DEFAULT_METADATA_TYPE_REGISTRY. If anyone introduces a parallel
            // list, this test catches it: every accepted type must trace back
            // to a registry entry that opted in.
            const allowedFromRegistry = new Set<string>();
            for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
                if (entry.allowOrgOverride) allowedFromRegistry.add(entry.type);
            }
            // Render-time types must be in the set; if any of these drop out,
            // the shared-DB contract is broken.
            expect(allowedFromRegistry.has('view')).toBe(true);
            expect(allowedFromRegistry.has('dashboard')).toBe(true);
            expect(allowedFromRegistry.has('report')).toBe(true);
            expect(allowedFromRegistry.has('email_template')).toBe(true);
            // object/field reverted to allowOrgOverride:false on 2026-05-29
            // (packaged-object lock; tenants create new ones via runtime-create).
            expect(allowedFromRegistry.has('object')).toBe(false);
            expect(allowedFromRegistry.has('field')).toBe(false);
            // #6283 — `flow` rolled BACK to allowOrgOverride:false. The `true`
            // this line used to assert came from commit ba252da0b (see the file
            // header) and never had an ADR behind it: ADR-0005's amendment
            // table (`docs/adr/0005-metadata-customization-overlay.md:57`) has
            // always listed automation as ❌ ("Per-org variants are a
            // deployment, not an overlay"), because flows carry execution
            // side-effects. #6155 Q1=B upheld the ADR. Doubles as a
            // reintroduction guard now: re-opening flow requires amending
            // ADR-0005, not editing this line.
            expect(allowedFromRegistry.has('flow')).toBe(false);
            // ADR-0020: `workflow` retired as a metadata type.
            expect(allowedFromRegistry.has('workflow')).toBe(false);
            // ADR-0063 §2: tenant custom agents withdrawn — `agent` is now
            // allowOrgOverride:false (no per-org agent fork). The kernel ships
            // exactly two platform agents; tenants extend via skills + tools.
            expect(allowedFromRegistry.has('agent')).toBe(false);
            // #6483 — `permission`/`position` rolled BACK to
            // allowOrgOverride:false (with page/app/action/dataset/book/
            // tool/skill; the whole nine-type divergence family). ADR-0005's
            // security row has always said ❌: "Authorization correctness;
            // overlays would create silent privilege drift." Reintroduction
            // guard, same as `flow` below: re-opening either requires
            // amending ADR-0005, not editing this line.
            expect(allowedFromRegistry.has('permission')).toBe(false);
            expect(allowedFromRegistry.has('position')).toBe(false);
            // ADR-0090 D2/D3: role/profile kinds retired — reintroduction guards.
            expect(allowedFromRegistry.has('role')).toBe(false);
            expect(allowedFromRegistry.has('profile')).toBe(false);
            // Execution/wiring-layer types must NOT be in the set.
            // Accepting them as overlays would corrupt runtime semantics.
            // (trigger/router/function/service were retired outright by
            // ADR-0088, and `validation` by #4509 under the same ADR — the
            // asserts double as reintroduction guards.)
            expect(allowedFromRegistry.has('trigger')).toBe(false);
            expect(allowedFromRegistry.has('validation')).toBe(false);
            expect(allowedFromRegistry.has('hook')).toBe(false);
            expect(allowedFromRegistry.has('datasource')).toBe(false);
            expect(allowedFromRegistry.has('router')).toBe(false);
            expect(allowedFromRegistry.has('function')).toBe(false);
            expect(allowedFromRegistry.has('service')).toBe(false);
        });
    });
});

// ══════════════════════════════════════════════════════════════════════
// 2. Canonical hash stability (ADR-0008 PR-10b backfill precondition)
// ══════════════════════════════════════════════════════════════════════

describe('canonical hash stability (PR-10b backfill precondition)', () => {
    it('canonicalize: key order does not change output', () => {
        const a = canonicalize({ b: 1, a: 2, c: 3 });
        const b = canonicalize({ c: 3, a: 2, b: 1 });
        expect(a).toBe(b);
    });

    it('canonicalize: nested key order does not change output', () => {
        const a = canonicalize({ outer: { z: 1, a: 2 }, top: true });
        const b = canonicalize({ top: true, outer: { a: 2, z: 1 } });
        expect(a).toBe(b);
    });

    it('hashSpec: returns "sha256:..." prefix with 64-hex digest', () => {
        const h = hashSpec({ name: 'case_grid' });
        expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('hashSpec: stable across key reorder for a view payload', () => {
        const reordered = {
            columns: validView.columns,
            viewKind: validView.viewKind, // [#7741] rides with the binding pair
            object: validView.object,
            label: validView.label,
            name: validView.name,
        };
        expect(hashSpec(validView)).toBe(hashSpec(reordered));
    });

    it('hashSpec: undefined fields collapse to "absent" (typical PUT shape)', () => {
        // Studio PUTs frequently include `undefined` for optional fields the
        // user cleared. Canonicalize must drop these so the hash matches the
        // body as it would be re-read from the DB (where NULL columns vanish).
        const withUndef = { ...validView, description: undefined };
        expect(hashSpec(validView)).toBe(hashSpec(withUndef));
    });

    it('hashSpec: dashboard payload deterministic', () => {
        const h1 = hashSpec(validDashboard);
        const h2 = hashSpec({ ...validDashboard });
        expect(h1).toBe(h2);
    });

    it('hashSpec: report payload deterministic', () => {
        const h1 = hashSpec(validReport);
        const h2 = hashSpec({ ...validReport });
        expect(h1).toBe(h2);
    });

    it('hashSpec: distinct payloads produce distinct hashes', () => {
        expect(hashSpec(validView)).not.toBe(hashSpec(validDashboard));
        expect(hashSpec(validView)).not.toBe(
            hashSpec({ ...validView, label: 'Different' }),
        );
    });

    it('hashSpec: array order IS significant (positional semantics preserved)', () => {
        // Columns in a view are ordered — swapping them is a real change.
        const swapped = {
            ...validView,
            columns: [validView.columns[1], validView.columns[0]],
        };
        expect(hashSpec(validView)).not.toBe(hashSpec(swapped));
    });

    it('hashSpec: handles deeply-nested optional fields without throwing', () => {
        const deep = {
            ...validView,
            filters: {
                where: { status: 'open', priority: undefined },
                sort: [{ field: 'name', dir: 'asc' }],
            },
        };
        expect(() => hashSpec(deep)).not.toThrow();
        // Same value re-evaluated yields same hash.
        expect(hashSpec(deep)).toBe(hashSpec(JSON.parse(JSON.stringify(deep))));
    });
});
