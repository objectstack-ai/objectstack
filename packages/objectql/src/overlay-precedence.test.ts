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
 *      `code='not_overridable'`, `status=403`. This is the
 *      shared-DB tenancy invariant (ADR-0005 amendment
 *      §"Tenant-customizable type whitelist").
 *
 *      Note: object, field, flow, workflow, agent, permission, role,
 *      and profile all flipped to `allowOrgOverride: true` in commit
 *      ba252da0b (feat: add project mode, metadata forms, and org
 *      overlays). The invariant now pins the execution/wiring-layer
 *      types that MUST stay false.
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
        undefined, // getFeedService
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
    //  1. Types with `allowRuntimeCreate: true` (hook/trigger/validation) —
    //     blocked only when overlaying an artifact-backed item. Brand-new
    //     (artifact-free) names succeed. Tested separately below.
    //
    //  2. Types with `allowRuntimeCreate: false` (router/function/service) —
    //     blocked for ANY write in project-kernel mode.
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
                type: 'router',
                reason: 'API routing must be deterministic; per-org divergence creates invisible conflicts',
                item: { name: 'case_api', path: '/api/cases' },
            },
            {
                type: 'function',
                reason: 'serverless function definitions must be deployment-only, not per-org',
                item: { name: 'process_payment', handler: 'index.ts' },
            },
            {
                type: 'service',
                reason: 'service definitions must be deployment-only, not per-org',
                item: { name: 'notification_service' },
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
                    code: expect.stringMatching(/^(not_overridable|not_creatable)$/),
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
            {
                type: 'validation',
                item: {
                    name: 'require_name',
                    type: 'script',
                    message: 'Name required',
                    condition: 'record.name == null',
                },
            },
            { type: 'hook', item: { name: 'before_save', object: 'case', events: ['beforeInsert'] } },
            { type: 'hooks', item: { name: 'before_save', object: 'case', events: ['beforeInsert'] } }, // plural
            // object/field reverted to allowOrgOverride:false on 2026-05-29 —
            // packaged items locked, brand-new tenant-authored items succeed.
            {
                type: 'object',
                item: {
                    name: 'tenant_widget',
                    label: 'Widget',
                    fields: { title: { name: 'title', type: 'text', label: 'Title' } },
                },
            },
            {
                type: 'field',
                item: { name: 'tenant_widget_color', type: 'text', label: 'Color' },
            },
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
                const result = await protocol.saveMetaItem({
                    type,
                    name: item.name,
                    item,
                    organizationId: 'org_alpha',
                });
                expect(result.success).toBe(true);
            });
        }
    });

    // ── single-kernel deployments: gate disengaged ──
    describe('single-kernel mode (no environmentId) — gate bypassed', () => {
        it('allows function overlay when environmentId is undefined (gate bypassed)', async () => {
            // No environmentId => not project-kernel mode => legacy "anything goes"
            // path used by control-plane bootstrap. ADR-0005 §"Whitelist".
            // `function` is a definitively-denied type in project-kernel mode,
            // so this case best demonstrates the bypass semantics.
            const { protocol: localProto } = makeProtocol({ environmentId: undefined });
            const result = await localProto.saveMetaItem({
                type: 'function',
                name: 'my_fn',
                item: { name: 'my_fn', handler: 'index.ts' },
            });
            expect(result.success).toBe(true);
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
            expect(allowedFromRegistry.has('flow')).toBe(true);
            // ADR-0020: `workflow` retired as a metadata type.
            expect(allowedFromRegistry.has('workflow')).toBe(false);
            // ADR-0063 §2: tenant custom agents withdrawn — `agent` is now
            // allowOrgOverride:false (no per-org agent fork). The kernel ships
            // exactly two platform agents; tenants extend via skills + tools.
            expect(allowedFromRegistry.has('agent')).toBe(false);
            expect(allowedFromRegistry.has('permission')).toBe(true);
            expect(allowedFromRegistry.has('role')).toBe(true);
            expect(allowedFromRegistry.has('profile')).toBe(true);
            // Execution/wiring-layer types must NOT be in the set.
            // Accepting them as overlays would corrupt runtime semantics.
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
