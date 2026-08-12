// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6283 — `flow` is not per-org overridable, and the WRITE PATH says so.
 *
 * The registry row for `flow` carried `allowOrgOverride: true` from commit
 * ba252da0b (recorded, unreviewed, in #6191) while
 * `docs/adr/0005-metadata-customization-overlay.md:57` said — and had always
 * said — the opposite:
 *
 *   | automation | `flow`, `workflow`, `approval` | ❌ | Carry execution
 *   | side-effects (events, jobs, audit). Per-org variants are a deployment,
 *   | not an overlay. |
 *
 * #6155 Q1=B upheld the ADR, so the flag rolled back to `false`. That is a
 * one-word diff in `packages/spec`; this file is the other half of it, and the
 * half the issue named as the acceptance criterion: **declared = enforced**.
 * A flag flipped in a registry nobody reads on the write path would have
 * changed a document, not a behaviour — #6190 measured this family's failure
 * mode exactly ("the write path is more permissive than the read path"), where
 * an org-scoped flow overlay was accepted, persisted, and then lost its
 * binding on the next cold start. The point of the rollback is that the write
 * now fails LOUDLY at the moment it is attempted instead of succeeding into a
 * phantom.
 *
 * ---------------------------------------------------------------------------
 * What the flag does and does NOT close — measured, not assumed
 * ---------------------------------------------------------------------------
 * `allowOrgOverride` governs ONE of the two tiers ADR-0005's extension
 * defines, and this file pins both sides so the boundary is not mistaken for
 * an oversight later:
 *
 *   • OVERRIDING A PACKAGED FLOW (`intent: 'override-artifact'`) — closed by
 *     this change. 403 `NOT_OVERRIDABLE`. This is the overlay ADR-0005 refuses.
 *   • CREATING A BRAND-NEW FLOW (`intent: 'runtime-only'`) — still open, and
 *     deliberately so: `allowRuntimeCreate` stays `true`, no code-shipped
 *     automation is being shadowed, and that write is what the ADR means by
 *     "a deployment". Nothing in #6283 touches it.
 *
 * [#6190, 2026-08-09] One clause of that second bullet has since been
 * narrowed, and this file is where it was written down, so it is corrected
 * here rather than left to contradict the code. The runtime-create tier stays
 * open — a brand-new flow is still authorable — but only ENV-WIDE. An
 * org-scoped brand-new flow is now refused too (`orgScopedWriteRefusal`),
 * because the row it used to write is one `loadMetaFromDb` can never read
 * back: it bound its triggers until the next restart and then stopped firing,
 * silently. That is the defect #6190 was filed about, and the maintainer ruled
 * on 2026-08-08 that the write is refused rather than coerced or logged. The
 * case below that used to pin "a BRAND-NEW ORG flow still saves" now pins the
 * two halves separately: env-wide saves, org-scoped refuses. Its own closing
 * sentence predicted this ("If a later issue decides tenants may not author
 * flows at all, that is a change to `allowRuntimeCreate` and it lands here,
 * loudly") — the later issue decided something narrower than it guessed: not
 * whether tenants may author flows, but what SCOPE such a write may claim.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red, with a deliberately green half — predicted, then measured.
 * Restoring `allowOrgOverride: true` on the `flow` registry row turns the two
 * declaration pins AND the two refusal cases red, and leaves the
 * runtime-create case and the `view` control green, because neither reads that
 * flag. Predicted 4 red / 2 green; measured 4 red / 2 green, and the refusal
 * case failed in the shape that names the bug rather than merely a different
 * error:
 *
 *   AssertionError: promise resolved "{ success: true, …(4) }" instead of
 *   rejecting
 *
 * — the accepted-then-unbindable write #6190 measured, reproduced on demand.
 * The green half is not slack: a "fix" that closed `flow` by making the whole
 * type unwritable would pass the red half and fail here, and a harness that
 * could not produce a successful save at all would pass the red half for the
 * wrong reason — which is what the `view` control exists to exclude.
 *
 * Harness: the real write path over a stub engine, the same shape as
 * `protocol.save-receipt-wording.test.ts` — the gate runs INSIDE
 * `saveMetaItem` / `SysMetadataRepository.put`, so a harness that mocks either
 * cannot see it.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update). Imported from `@objectstack/metadata-core`, never from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright.
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

/** A schema-VALID flow body — a minimal one 422s before the gate is reached. */
const FLOW = {
    name: 'escalate_overdue',
    label: 'Escalate overdue tasks',
    type: 'record_change',
    status: 'active',
    nodes: [
        {
            id: 'start',
            type: 'start',
            label: 'Start',
            config: { objectName: 'task', triggerType: 'record-after-update' },
        },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

/** The control specimen: still `allowOrgOverride: true`, untouched by #6283. */
const VIEW = {
    name: 'overdue_grid',
    label: 'Overdue',
    object: 'task',
    viewKind: 'list', // [#7741] the inline arm requires the object binding pair
    columns: [{ field: 'name', label: 'Name' }],
};

const entry = (type: string) => DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === type);

describe('#6283 — flow: allowOrgOverride rolled back to false', () => {
    // ── the declaration ───────────────────────────────────────────────────

    it('the registry declares flow non-overridable, and the row no longer contradicts itself', () => {
        // Both halves of the ADR-0005 verdict in one assertion. The pairing is
        // the point: `supportsOverlay: false` says the LOADER cannot merge a
        // per-org flow overlay, so `allowOrgOverride: true` had been granting
        // permission for a write nothing could ever read back — the phantom
        // #6190 measured. `allowRuntimeCreate` stays true on purpose; see the
        // two-tier case below.
        expect(entry('flow')).toMatchObject({
            supportsOverlay: false,
            allowOrgOverride: false,
            allowRuntimeCreate: true,
        });
    });

    it('no parallel allowlist — the derived overlay set drops flow with it', () => {
        // Prime Directive #8: `OVERLAY_ALLOWED_TYPES` is DERIVED from this
        // registry, in both `protocol.ts` and `sys-metadata-repository.ts`.
        // If anyone re-adds flow to a hand-written list instead, the refusal
        // cases below go red rather than this one — which is why they, not
        // this, are the acceptance criterion.
        const derived = new Set(
            DEFAULT_METADATA_TYPE_REGISTRY.filter((e) => e.allowOrgOverride).map((e) => e.type),
        );
        expect(derived.has('flow')).toBe(false);
    });

    // ── the enforcement (the acceptance criterion) ────────────────────────

    it('an ORG-scoped overlay of a packaged flow is refused loudly, not accepted', async () => {
        // The exact write #6190 watched succeed and then lose its binding.
        // With the flag off it never reaches the store at all.
        const { protocol, rows } = makeProtocol([{ type: 'flow', name: 'escalate_overdue' }], 'env_prod');

        await expect(
            protocol.saveMetaItem({
                type: 'flow',
                name: 'escalate_overdue',
                item: FLOW,
                organizationId: 'org_alpha',
            }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });

        // Refused, not "refused after writing" — the phantom row is the thing
        // #6190 was about, so its absence is part of the claim.
        expect(rows.size).toBe(0);
    });

    it('the refusal does not depend on deployment topology (no environmentId either)', async () => {
        // ADR-0005's "single kernels keep their existing behaviour" carve-out
        // is keyed on `environmentId` at the PROTOCOL layer, but
        // `SysMetadataRepository.assertAllowed` is not — it refuses an
        // `override-artifact` write on any kernel. Pinned because a rollback
        // that only bit in one topology would leave the flagship showcase (a
        // host config boots with NO environmentId, #5086) still writing
        // phantoms.
        const { protocol, rows } = makeProtocol([{ type: 'flow', name: 'escalate_overdue' }]);

        await expect(
            protocol.saveMetaItem({ type: 'flow', name: 'escalate_overdue', item: FLOW }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(rows.size).toBe(0);
    });

    // ── the half that stays open, deliberately ────────────────────────────

    it('a BRAND-NEW ENV-WIDE flow still saves — allowRuntimeCreate is a different tier', async () => {
        // Not a leak in the rollback: no artifact is being shadowed, so this
        // is ADR-0005's "a deployment", authored through the runtime API.
        // [#6190] Env-wide is the half that survives — see the sibling case.
        const { protocol } = makeProtocol([], 'env_prod');

        const result = await protocol.saveMetaItem({
            type: 'flow',
            name: 'escalate_overdue',
            item: FLOW,
        });

        expect(result.success).toBe(true);
    });

    it('[#6190] …but the ORG-SCOPED brand-new flow is refused — the row would be unreadable after boot', async () => {
        // The other half of the tier, closed by the 2026-08-08 ruling on
        // #6190. `allowRuntimeCreate` says a tenant may AUTHOR a flow; it never
        // said the row may claim an org partition the loader cannot read. This
        // is the write that fired all day and stopped after the restart.
        const { protocol, rows } = makeProtocol([], 'env_prod');

        await expect(
            protocol.saveMetaItem({
                type: 'flow',
                name: 'escalate_overdue',
                item: FLOW,
                organizationId: 'org_alpha',
            }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(rows.size).toBe(0);
    });

    // ── the control that makes the red half mean something ────────────────

    it('view — still allowOrgOverride:true — is still accepted over a packaged artifact', async () => {
        // Without this, the two refusals above would also pass on a harness
        // that could not save ANYTHING. `view` is the type ADR-0005 whitelists
        // and #6283 does not touch.
        const { protocol } = makeProtocol([{ type: 'view', name: 'overdue_grid' }], 'env_prod');

        const result = await protocol.saveMetaItem({
            type: 'view',
            name: 'overdue_grid',
            item: VIEW,
            organizationId: 'org_alpha',
        });

        expect(result.success).toBe(true);
    });
});
