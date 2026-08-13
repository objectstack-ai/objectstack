// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5265 — the save receipt says only what the write path already knows.
 *
 * `saveMetaItem` had exactly two success sentences and both hardwired the noun
 * "customization overlay":
 *
 *   Saved customization overlay (org=…, state=…) — type=…, name=… [seq=N]
 *   Saved customization overlay (env-wide, state=…) — type=…, name=… [seq=N]
 *
 * Seven `DEFAULT_METADATA_TYPE_REGISTRY` entries declare `supportsOverlay:
 * false` and are still runtime-writable by design (`object`, `field`, `hook`,
 * `seed`, `mapping`, `flow`, `action`). A brand-new one of those overlays
 * nothing — there is no artifact underneath it — and was told, verbatim, that
 * it had "saved a customization overlay". #5086's real showcase boot measured
 * the sentence on a `view` (`supportsOverlay: true`, so the receipt was true
 * there); the same sentence for `object` / `flow` simply was not.
 *
 * The discriminator is NOT `supportsOverlay` and NOT `allowOrgOverride` — the
 * spec's TSDoc keeps those two apart on purpose (loader merge *capability* vs
 * runtime write *permission*), and neither is the fact the sentence claims.
 * The fact the sentence claims is "something was overlaid", and the write path
 * has already computed it: `isArtifactBacked(type, name)`, the same fact
 * `intent: 'override-artifact' | 'runtime-only'` is derived from. So these
 * tests drive the split by artifact backing and treat the `supportsOverlay:
 * false` population as the motivating case it is, not as the rule.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red, with a deliberately green half. Restoring the unconditional
 * template (`message: orgId ? 'Saved customization overlay (org=…' : 'Saved
 * customization overlay (env-wide…'`) turns every `runtime-only` case here red
 * — predicted 9, measured 9 — and leaves all four `override-artifact` cases
 * green, because their sentence is unchanged byte for byte. The green half is
 * the point of the split, not slack: a fix that simply stopped saying
 * "overlay" everywhere would pass the red half and fail here.
 *
 * Harness: the real write path over a stub engine, the same shape as
 * `protocol.code-only-types.test.ts` — the receipt is built INSIDE
 * `saveMetaItem`, so a harness that mocks `saveMetaItem` cannot see it.
 */
import { afterEach, describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update). Imported from `@objectstack/metadata-core`, never from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright.
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

function makeProtocol(artifacts?: Array<{ type: string; name: string }>) {
    const { engine, rows } = makeStubEngine(artifacts);
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, rows };
}

/**
 * Schema-VALID bodies for the `supportsOverlay: false` types the issue names.
 * A minimal payload 422s on spec validation before the receipt is ever built,
 * so only a body the schema accepts proves anything about the sentence.
 */
const OVERLAYLESS_PROBES: Record<string, Record<string, unknown>> = {
    object: {
        name: 'rc5_acct',
        label: 'Account',
        // [#8308] Authored OWD: the publish gate refuses an OWD-less custom
        // object (`security-owd-unset`) once #8310 declares `object` in
        // `runtimeTypes` — and this probe pins the RECEIPT wording, not that
        // refusal.
        sharingModel: 'private',
        fields: { name: { type: 'text', label: 'Name' } },
    },
    hook: { name: 'rc5_acct', object: 'task', events: ['beforeUpdate'] },
    seed: { object: 'task', records: [] },
    action: { name: 'rc5_acct', label: 'Convert', type: 'script', objectName: 'task', target: 'convertHandler' },
    flow: {
        name: 'rc5_acct',
        label: 'Pause project when hours are logged',
        type: 'record_change',
        status: 'active',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { objectName: 'task', triggerType: 'record-after-update' } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    },
};

/** A view body the spec accepts — the type #5086's real boot measured. */
const VIEW = {
    name: 'rc5_probe_view',
    label: 'Probe',
    object: 'task',
    viewKind: 'list', // [#7741] the inline arm requires the object binding pair
    columns: [{ field: 'name', label: 'Name' }],
};

/**
 * The population the issue is about, derived from the registry rather than
 * listed here (Prime Directive #7 — no parallel whitelists). A type that flips
 * `supportsOverlay` leaves this set and the membership pin below turns red.
 */
const OVERLAYLESS_RUNTIME_WRITABLE = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => e.supportsOverlay === false && e.allowRuntimeCreate)
    .map((e) => e.type);

describe('#5265 — a save receipt names what was actually written', () => {
    it('the registry really does declare overlay-less types that are runtime-writable', () => {
        // The premise, pinned. If this ever empties, the whole issue is moot
        // and these tests should be read again rather than repaired.
        expect(OVERLAYLESS_RUNTIME_WRITABLE.length).toBeGreaterThan(0);
        for (const type of Object.keys(OVERLAYLESS_PROBES)) {
            expect(OVERLAYLESS_RUNTIME_WRITABLE, `${type} left the overlay-less set`).toContain(type);
        }
        // #6283 → #6483 — the override-artifact case at the bottom of this
        // file needs a type that is BOTH overlay-less and per-org overridable.
        // `flow` played that part until #6283 rolled its `allowOrgOverride`
        // back to `false` (ADR-0005:57); `action` inherited it until #6483
        // rolled back the remaining nine unratified `true` flags — `action`'s
        // overlay-less-yet-overridable pairing was the #6190 phantom shape
        // exactly, the very thing being closed. The population is now EMPTY
        // by ruling, and pinned empty: a future registry edit that mints a
        // new member re-opens the statically-reachable case below instead of
        // silently landing an untested pairing.
        const overlaylessYetOverridable = DEFAULT_METADATA_TYPE_REGISTRY
            .filter((e) => e.supportsOverlay === false && e.allowOrgOverride)
            .map((e) => e.type);
        expect(overlaylessYetOverridable).toEqual([]);
    });

    // ── runtime-only: nothing was overlaid, so nothing may claim it was ──

    for (const [type, item] of Object.entries(OVERLAYLESS_PROBES)) {
        it(`a brand-new ${type} is not reported as a customization overlay`, async () => {
            const { protocol } = makeProtocol();

            const result = await protocol.saveMetaItem({ type, name: 'rc5_acct', item });

            expect(result.success).toBe(true);
            expect(result.message).not.toContain('customization overlay');
            // Still carries every fact the overlay sentence carried: the type,
            // the name, the org dimension, the state and the change-log cursor.
            expect(result.message).toBe(
                `Saved ${type} 'rc5_acct' (env-wide, state=active) [seq=${result.seq}]`,
            );
        });
    }

    it('an org-scoped runtime-only save names the org, not an overlay', async () => {
        // [#6190, 2026-08-09] Re-spelled from `hook` to `view`. The claim is
        // about the RECEIPT — "(org=…)" rather than the overlay phrasing — and
        // the receipt does not vary by type. What changed is which types can
        // reach this receipt at all: since the #6190 ruling an org-scoped write
        // requires a type that declares `allowOrgOverride`, and the
        // overlay-less-yet-overridable population is empty by ruling (see the
        // population pin above). `view` is runtime-only here for the reason the
        // case below states — no artifact was shipped at this name — so this
        // still measures a RUNTIME-ONLY org-scoped save, not an overlay.
        const { protocol } = makeProtocol();

        const result = await protocol.saveMetaItem({
            type: 'view', name: 'rc5_probe_view', item: VIEW,
            organizationId: 'org_alpha',
        });

        expect(result.message).not.toContain('customization overlay');
        expect(result.message).toBe(
            `Saved view 'rc5_probe_view' (org=org_alpha, state=active) [seq=${result.seq}]`,
        );
    });

    it('a runtime-only draft still reports its lifecycle state', async () => {
        const { protocol } = makeProtocol();

        const result = await protocol.saveMetaItem({
            type: 'flow', name: 'rc5_acct', item: OVERLAYLESS_PROBES.flow, mode: 'draft',
        });

        expect(result.state).toBe('draft');
        expect(result.message).toBe(
            `Saved flow 'rc5_acct' (env-wide, state=draft) [seq=${result.seq}]`,
        );
    });

    it('a type with NO artifact is runtime-only even when it supports overlays', async () => {
        // `view` is `supportsOverlay: true`, but a view nobody shipped is
        // still a first-ever creation. The receipt follows the fact, not the
        // registry flag — this is the case that proves the rule is keyed on
        // artifact backing.
        const { protocol } = makeProtocol();

        const result = await protocol.saveMetaItem({ type: 'view', name: 'rc5_probe_view', item: VIEW });

        expect(result.message).toBe(
            `Saved view 'rc5_probe_view' (env-wide, state=active) [seq=${result.seq}]`,
        );
    });

    it('the phrase spells the canonical singular type, not the plural the caller sent', async () => {
        const { protocol } = makeProtocol();

        const result = await protocol.saveMetaItem({ type: 'views', name: 'rc5_probe_view', item: VIEW });

        expect(result.message).toContain("Saved view 'rc5_probe_view'");
    });

    // ── override-artifact: the sentence is TRUE there, and stays verbatim ──

    it('an env-wide overlay OF a packaged artifact keeps the original sentence', async () => {
        const { protocol } = makeProtocol([{ type: 'view', name: 'rc5_probe_view' }]);

        const result = await protocol.saveMetaItem({ type: 'view', name: 'rc5_probe_view', item: VIEW });

        expect(result.message).toBe(
            `Saved customization overlay (env-wide, state=active) — type=view, name=rc5_probe_view [seq=${result.seq}]`,
        );
    });

    it('an org-scoped overlay OF a packaged artifact keeps the original sentence', async () => {
        const { protocol } = makeProtocol([{ type: 'view', name: 'rc5_probe_view' }]);

        const result = await protocol.saveMetaItem({
            type: 'view', name: 'rc5_probe_view', item: VIEW, organizationId: 'org_alpha',
        });

        expect(result.message).toBe(
            `Saved customization overlay (org=org_alpha, state=active) — type=view, name=rc5_probe_view [seq=${result.seq}]`,
        );
    });

    it('an overlay draft keeps the original sentence too', async () => {
        const { protocol } = makeProtocol([{ type: 'view', name: 'rc5_probe_view' }]);

        const result = await protocol.saveMetaItem({
            type: 'view', name: 'rc5_probe_view', item: VIEW, mode: 'draft',
        });

        expect(result.message).toBe(
            `Saved customization overlay (env-wide, state=draft) — type=view, name=rc5_probe_view [seq=${result.seq}]`,
        );
    });

    it('an overlay of a packaged ACTION — supportsOverlay:false, and still an override', async () => {
        // The mirror of the first block, and the sharpest case in this file:
        // when an overlay-less type IS overridden over a packaged artifact,
        // the overlay sentence is the true one. A receipt decided by
        // `supportsOverlay` would get this exactly backwards; one decided by
        // artifact backing gets it right.
        //
        // (`object` cannot stand in here: it is `allowOrgOverride: false`, so
        // `SysMetadataRepository.assertAllowed` refuses an `override-artifact`
        // write with `[NOT_OVERRIDABLE]` before any receipt is built. Measured,
        // not assumed — this case was written against `object` first.)
        //
        // The specimen was `flow` until #6283 rolled its `allowOrgOverride`
        // back to `false` (ADR-0005:57), then bare `action` until #6483
        // rolled back the remaining nine unratified flags — no statically
        // registered type pairs overlay-less with overridable anymore (the
        // premise pin above holds the population empty). The pairing is
        // still REACHABLE, through the ONE documented door that remains:
        // `OS_METADATA_WRITABLE` (ADR-0005's operator escape hatch), which
        // both `isOverlayAllowed` and the repository's `assertAllowed`
        // consult. So this case runs `action` behind that hatch — the
        // receipt wording it pins is exactly what an operator who unlocked
        // a type would see.
        process.env.OS_METADATA_WRITABLE = 'action';
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();

        const { protocol } = makeProtocol([{ type: 'action', name: 'rc5_acct' }]);

        const result = await protocol.saveMetaItem({
            type: 'action', name: 'rc5_acct', item: OVERLAYLESS_PROBES.action,
        });

        expect(result.message).toBe(
            `Saved customization overlay (env-wide, state=active) — type=action, name=rc5_acct [seq=${result.seq}]`,
        );
    });

    afterEach(() => {
        // The escape-hatch case above must not leak `action` writability into
        // its neighbours — both memoised caches, or the second run lies.
        delete process.env.OS_METADATA_WRITABLE;
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
    });

    // ── the boundary this message crosses (#5423) ─────────────────────────

    it('both sentences stay far below the 500-character response bound', async () => {
        // The receipt is forwarded verbatim by `res.json(result)` on
        // `PUT /meta/:type/:name`, and #5423's truncation bound is 500. Both
        // shapes are an order of magnitude under it, for a realistic name.
        const { protocol: plain } = makeProtocol();
        const { protocol: overlaid } = makeProtocol([{ type: 'view', name: 'rc5_probe_view' }]);

        const runtimeOnly = await plain.saveMetaItem({ type: 'view', name: 'rc5_probe_view', item: VIEW });
        const override = await overlaid.saveMetaItem({
            type: 'view', name: 'rc5_probe_view', item: VIEW, organizationId: 'org_alpha',
        });

        expect(runtimeOnly.message.length).toBeLessThan(200);
        expect(override.message.length).toBeLessThan(200);
    });
});
