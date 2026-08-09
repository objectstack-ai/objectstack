// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6483 — the nine ADR-0005 whitelist divergences, rolled back. The WRITE
 * PATH now says what the ADR's amendment table has said since 2026-05-22.
 *
 * `DEFAULT_METADATA_TYPE_REGISTRY` carried `allowOrgOverride: true` on nine
 * rows the ADR-0005 tenant-customizable whitelist
 * (`docs/adr/0005-metadata-customization-overlay.md:53-64`) never granted:
 *
 *   • `page` / `app` / `action` — the table says ❌ outright: "Conservative
 *     default — these bind to routes and side-effects. Promote individually
 *     if a concrete need appears." No promotion ever appeared.
 *   • `permission` — the security row says ❌: "Authorization correctness;
 *     overlays would create silent privilege drift."
 *   • `tool` / `skill` — the ai row says ❌: "Behavioural contracts with
 *     model providers; treat like flows."
 *   • `dataset` / `book` / `position` — absent from the table entirely, and
 *     the amendment's closing rule assigns absentees their default: "The
 *     default for any new metadata type is `allowOrgOverride: false`",
 *     admission requiring (a) an overlay schema `resolveOverlaySchema()`
 *     accepts and (b) a WRITTEN render-only rationale. (a) holds for every
 *     registered type since the schema registry unified
 *     (`getMetadataTypeSchema`), so (b) — the written rationale — is the
 *     discriminating clause, and none of the three carries one.
 *
 * The 2026-08-08 maintainer ruling on #6483 settled all nine: `permission` /
 * `tool` / `skill` roll back unconditionally; the other six roll back unless
 * live org-scoped overlay rows AND a complete admission pair exist. Measured
 * in-repo: zero committed `sys_metadata` overlay rows for any of the nine
 * (no seeds, no dogfood data, no fixtures that survive a suite run), so all
 * nine roll back. Same verdict shape as `flow` (#6283, the file this one is
 * modeled on — `protocol.flow-org-override-closed.test.ts`).
 *
 * `action` deserves one more sentence: its row declares
 * `supportsOverlay: false`, so — exactly like #6283's flow — the `true` flag
 * granted a write permission for an overlay nothing could ever read back
 * (#6190's phantom-write shape). The other eight declare
 * `supportsOverlay: true`; for them the read capability stays, only the
 * per-org WRITE permission closes.
 *
 * ---------------------------------------------------------------------------
 * What the rollback does and does NOT close
 * ---------------------------------------------------------------------------
 *   • OVERRIDING A PACKAGED ITEM of these types — closed. 403
 *     `NOT_OVERRIDABLE` at the moment of the write, on every kernel
 *     (the repository's `assertAllowed` is topology-independent).
 *   • CREATING A BRAND-NEW ITEM (`allowRuntimeCreate`) — still open for all
 *     nine, deliberately: no code-shipped artifact is being shadowed. The
 *     Studio "save a new view of the world" flows keep working.
 *   • The env-var escape hatch (`OS_METADATA_WRITABLE`) — untouched; an
 *     operator can still opt a type back in at runtime, per ADR-0005.
 *
 * Known write-side consumers, verified while landing this:
 *   • `OVERLAY_ALLOWED_TYPES` (protocol.ts) and the repository's
 *     `assertAllowed` allow-list are both DERIVED from the registry (Prime
 *     Directive #8) — no hardcoded copy to align.
 *   • plugin-security's ADR-0094 write-through
 *     (`permission-set-projection.ts`) redirects data-door edits of
 *     permission sets into `saveMetaItem({type:'permission'})`. For
 *     RUNTIME-CREATED sets that write rides `allowRuntimeCreate` and keeps
 *     working. For PACKAGE-OWNED sets it now refuses with 403 — which is
 *     the ADR-0005 security row enforced ("silent privilege drift"), and
 *     the same refusal that write-through already issues on kernels without
 *     an overlay layer. Its own suite stubs `saveMetaItem`, so this file is
 *     where that behaviour is actually pinned against the real gate.
 *   • runtime's ADR-0045 publish visibility flip (`domains/packages.ts`)
 *     writes `saveMetaItem({type:'app'})` against apps MATERIALIZED into
 *     `sys_metadata` by additive builds — DB-only rows, never
 *     artifact-backed, so the two-tier `allowRuntimeCreate` door keeps them
 *     writable. Pinned below ("a DB-only item of every rolled-back type
 *     still saves").
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Restoring `allowOrgOverride: true` on any single rolled-back row (the run
 * recorded below used `skill`) must turn that type's declaration pin, its
 * derived-set pin, and its two refusal cases red, while every other type's
 * cases and the `view`/`dashboard`/`report` controls stay green — the
 * refusal failing as "promise resolved instead of rejecting", the
 * accepted-then-phantom write this rollback exists to forbid. Predicted 4
 * red / rest green; measured exactly that — the skill declaration pin, the
 * derived-set pin, and both skill refusals ("promise resolved
 * { success: true } instead of rejecting"), 36 green — then restored.
 *
 * Harness: the real write path over a stub engine — same shape as
 * `protocol.flow-org-override-closed.test.ts`. The gate runs INSIDE
 * `saveMetaItem` / `SysMetadataRepository.put`; a harness that mocks either
 * cannot see it.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
}

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
                if (opts.where.state !== undefined && row.state !== opts.where.state) continue;
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
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
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
    return { engine, rows };
}

function makeProtocol(
    artifacts?: Array<{ type: string; name: string }>,
    environmentId?: string,
) {
    const { engine, rows } = makeStubEngine(artifacts);
    const protocol = new ObjectStackProtocolImplementation(
        engine,
        () => new Map(),
        environmentId,
    ) as any;
    return { protocol, rows };
}

/**
 * A schema-VALID minimal body per rolled-back type — spec validation runs
 * before the authorization gate, so an invalid body would 422 first and this
 * suite would pass without ever reaching the thing it pins.
 */
const BODIES: Record<string, Record<string, unknown>> = {
    page: { name: 'probe_item', label: 'Probe', type: 'record', regions: [] },
    app: { name: 'probe_item', label: 'Probe' },
    action: { name: 'probe_item', label: 'Probe', type: 'script', body: { language: 'expression', source: '1 + 1' } },
    dataset: { name: 'probe_item', label: 'Probe', object: 'task', dimensions: [], measures: [] },
    book: { name: 'probe_item', label: 'Probe', groups: [] },
    position: { name: 'probe_item', label: 'Probe' },
    permission: { name: 'probe_item', label: 'Probe', objects: {} },
    tool: { name: 'probe_item', label: 'Probe', description: 'p', parameters: {} },
    skill: { name: 'probe_item', label: 'Probe', description: 'p', instructions: 'do it', tools: [] },
};

type RegistryType = (typeof DEFAULT_METADATA_TYPE_REGISTRY)[number]['type'];

const ROLLED_BACK = Object.keys(BODIES) as RegistryType[];

/** The control specimens: the three types ADR-0005 whitelists (✅ row). */
const CONTROLS = ['view', 'dashboard', 'report'] as const satisfies readonly RegistryType[];

const VIEW = {
    name: 'probe_view',
    label: 'Probe',
    object: 'task',
    columns: [{ field: 'name', label: 'Name' }],
};

const entry = (type: string) => DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === type);

describe('#6483 — the nine ADR-0005 divergences: allowOrgOverride rolled back to false', () => {
    // ── the declaration ───────────────────────────────────────────────────

    it.each(ROLLED_BACK)('the registry declares %s non-overridable, runtime-create untouched', (type) => {
        // `allowRuntimeCreate` staying true is as much a part of the verdict
        // as the flag going false: the rollback closes per-org shadowing of
        // PACKAGED items, not runtime authoring of new ones.
        expect(entry(type)).toMatchObject({
            allowOrgOverride: false,
            allowRuntimeCreate: true,
        });
    });

    it('action was the flow shape exactly — supportsOverlay:false made its write permission a phantom grant', () => {
        // Same self-contradiction #6283 rolled back on `flow`: the loader
        // cannot merge an overlay of this type, so per-org write permission
        // authorized writes nothing could ever read back (#6190).
        expect(entry('action')).toMatchObject({ supportsOverlay: false, allowOrgOverride: false });
    });

    it('the ADR-0005 whitelist controls (view/dashboard/report) are untouched', () => {
        for (const type of CONTROLS) {
            expect(entry(type)).toMatchObject({ supportsOverlay: true, allowOrgOverride: true });
        }
    });

    it('no parallel allowlist — the derived overlay set drops all nine with it', () => {
        // Prime Directive #8: `OVERLAY_ALLOWED_TYPES` is DERIVED from this
        // registry in both `protocol.ts` and `sys-metadata-repository.ts`.
        const derived = new Set(
            DEFAULT_METADATA_TYPE_REGISTRY.filter((e) => e.allowOrgOverride).map((e) => e.type),
        );
        for (const type of ROLLED_BACK) expect(derived.has(type), type).toBe(false);
        for (const type of CONTROLS) expect(derived.has(type), type).toBe(true);
    });

    // ── the enforcement (the acceptance criterion) ────────────────────────

    it.each(ROLLED_BACK)('an ORG-scoped overlay of a packaged %s is refused loudly, not accepted', async (type) => {
        const { protocol, rows } = makeProtocol([{ type, name: 'probe_item' }], 'env_prod');

        await expect(
            protocol.saveMetaItem({
                type,
                name: 'probe_item',
                item: BODIES[type],
                organizationId: 'org_alpha',
            }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });

        // Refused, not "refused after writing" — the phantom row IS the bug
        // class (#6190), so its absence is part of the claim.
        expect(rows.size).toBe(0);
    });

    it.each(ROLLED_BACK)('the %s refusal does not depend on deployment topology (no environmentId either)', async (type) => {
        // `SysMetadataRepository.assertAllowed` refuses an `override-artifact`
        // write on ANY kernel — pinned so the rollback bites the flagship
        // showcase too (host configs boot with no environmentId, #5086).
        const { protocol, rows } = makeProtocol([{ type, name: 'probe_item' }]);

        await expect(
            protocol.saveMetaItem({ type, name: 'probe_item', item: BODIES[type] }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(rows.size).toBe(0);
    });

    // ── the half that stays open, deliberately ────────────────────────────

    it.each(ROLLED_BACK)('a BRAND-NEW org %s still saves — allowRuntimeCreate is a different tier', async (type) => {
        // Covers the two production write paths verified above: ADR-0045's
        // publish visibility flip (`app` rows materialized into sys_metadata)
        // and ADR-0094's write-through for runtime-created permission sets.
        const { protocol } = makeProtocol([], 'env_prod');

        const result = await protocol.saveMetaItem({
            type,
            name: 'probe_item',
            item: BODIES[type],
            organizationId: 'org_alpha',
        });

        expect(result.success).toBe(true);
    });

    // ── the control that makes the red half mean something ────────────────

    it('view — still allowOrgOverride:true — is still accepted over a packaged artifact', async () => {
        // Without this, the refusals above would also pass on a harness that
        // could not save ANYTHING over an artifact.
        const { protocol, rows } = makeProtocol([{ type: 'view', name: 'probe_view' }], 'env_prod');

        const result = await protocol.saveMetaItem({
            type: 'view',
            name: 'probe_view',
            item: VIEW,
            organizationId: 'org_alpha',
        });

        expect(result.success).toBe(true);
        expect(rows.size).toBe(1);
    });
});
