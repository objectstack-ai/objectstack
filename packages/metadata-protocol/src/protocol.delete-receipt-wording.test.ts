// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5927 — the delete receipt says only what the reset path already knows.
 *
 * `deleteMetaItem` had exactly four success sentences and every one of them
 * narrated the delete as "a customization overlay came off, the artifact
 * default is now in force":
 *
 *   No customization overlay found for <t>/<n> — already at artifact default.
 *   Customization overlay deleted — <t>/<n> reset to artifact default. [seq=N]
 *   No customization overlay found for <t>/<n> — already at artifact default.
 *   Customization overlay deleted — <t>/<n> reset to artifact default.
 *
 * (The first pair on the `SysMetadataRepository` path, the second on the
 * legacy raw-engine path.) For a RUNTIME-ONLY item — an `object` / `flow` /
 * `hook` an admin authored in Studio, with no code package shipping that name
 * — there is no artifact underneath to fall back to. The row IS the item, and
 * once it is deleted the item does not exist in any layer. "Reset to artifact
 * default" points the admin at a baseline that has never existed.
 *
 * This is #5265 / PR #5926's split (save side) applied to the reset path, on
 * the same discriminator: `isArtifactBacked`, the fact `intent:
 * 'override-artifact' | 'runtime-only'` is already derived from inside this
 * very method. No new read path — the receipt now reads a binding that
 * replaced the `intent` expression's own inline call.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red, with a deliberately green half — the same shape #5926
 * recorded. Restoring the unconditional templates (dropping the
 * `artifactBacked ? … : …` on all four) turns every `runtime-only` case in
 * this file red and leaves every `override-artifact` case green, because
 * those sentences are unchanged byte for byte. The green half is the point of
 * the split, not slack: a "fix" that merely stopped saying "overlay"
 * everywhere would pass the red half and fail here.
 *
 * Harness: the real delete path over a stub engine, the same shape as
 * `protocol.save-receipt-wording.test.ts` and
 * `protocol.lock-gate-fail-closed.test.ts`. The receipt is built INSIDE
 * `deleteMetaItem`, so a harness that mocks `deleteMetaItem` cannot see it.
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
    checksum: string;
    metadata: string;
}

/** An overlay row as `deleteMetaItem` will find it: a real `checksum` is */
/** required or the OCC parent-version check 409s before any receipt is built. */
function overlayRow(type: string, name: string, state: 'active' | 'draft' = 'active'): Row {
    return {
        id: `row_${type}_${name}_${state}`,
        type,
        name,
        organization_id: null,
        state,
        checksum: 'sha256:stored-head',
        metadata: JSON.stringify({ name, label: 'Stored' }),
    };
}

function makeStubEngine(opts: {
    rows?: Row[];
    artifacts?: Array<{ type: string; name: string }>;
}) {
    const rows = [...(opts.rows ?? [])];
    const artifactKeys = new Set((opts.artifacts ?? []).map((a) => `${a.type}|${a.name}`));
    /** Match only on the keys the caller actually constrained (`whereFor` */
    /** omits `state` on the legacy path and `package_id` on delete). */
    const matches = (row: Row, where: Record<string, unknown> = {}) =>
        Object.entries(where).every(([k, v]) => (row as any)[k] === v);

    const engine: any = {
        async findOne(table: string, query: { where?: Record<string, unknown> } = {}) {
            if (table !== 'sys_metadata') return null;
            return rows.find((r) => matches(r, query.where)) ?? null;
        },
        // History counters (`nextItemVersion` / `nextEventSeq`) read here.
        async find() { return []; },
        async insert(_table: string, data: Record<string, unknown>) {
            return { id: 'inserted', ...data };
        },
        async update(_table: string, data: Record<string, unknown>, options?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, options);
            return { id: null };
        },
        async delete(_table: string, options?: Record<string, unknown>) {
            assertEngineDeleteDispatch(options);
            const id = (options as any)?.where?.id;
            const at = rows.findIndex((r) => r.id === id);
            if (at >= 0) rows.splice(at, 1);
            return { deleted: at >= 0 ? 1 : 0 };
        },
        async count() { return 0; },
        async transaction(fn: (ctx: unknown) => Promise<unknown>) { return fn(undefined); },
        async execute() { return {}; },
        async getObjectSchema() { return undefined; },
        registry: {
            getObject: () => undefined,
            getItem: () => undefined,
            listItems: () => [],
            registerItem: () => {},
            registerObject: () => {},
            applyNavContributions: (x: unknown) => x,
            isPackageDisabled: () => false,
            getObjectOwner: () => undefined,
            // `isArtifactBacked` prefers this lookup — a hit here means the
            // name is shipped by a code package (`_packageId` provenance).
            getArtifactItem: (type: string, name: string) =>
                artifactKeys.has(`${type}|${name}`) ? { name, _packageId: 'showcase' } : undefined,
        },
    };
    return { engine, rows };
}

/**
 * TENANT scope (`environmentId` set) — the ordinary runtime kernel, where the
 * two-tier delete authorization runs and overlay-allowed types route through
 * `SysMetadataRepository`.
 */
function tenantProtocol(opts: Parameters<typeof makeStubEngine>[0]) {
    const { engine, rows } = makeStubEngine(opts);
    return { protocol: new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_1') as any, rows };
}

/**
 * CONTROL-PLANE scope (`environmentId` undefined) — the only scope from which
 * a code-only type (`allowOrgOverride: false` AND `allowRuntimeCreate: false`)
 * reaches the legacy raw-engine delete path that owns sentences 3 and 4. See
 * the block comment on that path in `protocol.ts` (#5264): it is alive on
 * purpose, and it is the only code that can serve such a delete.
 */
function controlPlaneProtocol(opts: Parameters<typeof makeStubEngine>[0]) {
    const { engine, rows } = makeStubEngine(opts);
    return { protocol: new ObjectStackProtocolImplementation(engine, () => new Map()) as any, rows };
}

/** The registry facts every case below stands on, read rather than restated. */
const entry = (type: string) => DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === type);

describe('#5927 — a delete receipt names what actually happened', () => {
    it('the registry really does declare the two populations these cases need', () => {
        // The premise, pinned. `object` is runtime-writable but NOT
        // org-overridable, so it can only ever be a runtime-only delete;
        // `view` is both, so it can be either; `job` is neither, which is what
        // routes it to the legacy path. If any of this flips, these cases must
        // be re-read rather than repaired.
        expect(entry('object')).toMatchObject({ allowRuntimeCreate: true, allowOrgOverride: false });
        expect(entry('view')).toMatchObject({ allowRuntimeCreate: true, allowOrgOverride: true });
        expect(entry('job')).toMatchObject({ allowRuntimeCreate: false, allowOrgOverride: false });
        // #6283 → #6483 — the overlay-less-yet-overridable specimen the last
        // case in this file needs. It was `flow` until #6283 rolled that
        // flag back to `false` (ADR-0005:57), then `action` until #6483
        // rolled back the remaining nine unratified `true` flags. The
        // population is now EMPTY by ruling and pinned empty; the last case
        // reaches the pairing through `OS_METADATA_WRITABLE` — the one
        // documented door left. A future registry edit minting a new member
        // turns this pin red instead of landing an untested pairing.
        const overlaylessYetOverridable = DEFAULT_METADATA_TYPE_REGISTRY
            .filter((e) => e.supportsOverlay === false && e.allowOrgOverride)
            .map((e) => e.type);
        expect(overlaylessYetOverridable).toEqual([]);
    });

    // ── repository path — sentence 2 (a row was deleted) ──────────────────

    it('deleting a runtime-only object is not reported as a reset to a default', async () => {
        // The issue's own example: an admin deletes an `object` they created.
        // Nothing is shipped under that name, so nothing survives the delete.
        const { protocol } = tenantProtocol({ rows: [overlayRow('object', 'rc9_widget')] });

        const result = await protocol.deleteMetaItem({ type: 'object', name: 'rc9_widget' });

        expect(result.success).toBe(true);
        expect(result.reset).toBe(true);
        expect(result.message).not.toContain('artifact default');
        expect(result.message).not.toContain('Customization overlay');
        expect(result.message).toBe(
            `Deleted object 'rc9_widget' — it no longer exists. [seq=${result.seq}]`,
        );
    });

    it('deleting a runtime-only view — overlay-capable type, still no artifact', async () => {
        // `view` is `supportsOverlay: true`, but a view nobody shipped is
        // still the admin's own creation. The receipt follows the fact, not
        // the registry flag — this is the case that proves the rule is keyed
        // on artifact backing rather than on the type's capabilities.
        const { protocol } = tenantProtocol({ rows: [overlayRow('view', 'rc9_probe_view')] });

        const result = await protocol.deleteMetaItem({ type: 'view', name: 'rc9_probe_view' });

        expect(result.message).toBe(
            `Deleted view 'rc9_probe_view' — it no longer exists. [seq=${result.seq}]`,
        );
    });

    it('deleting an overlay OF a packaged artifact keeps the original sentence', async () => {
        const { protocol } = tenantProtocol({
            rows: [overlayRow('view', 'rc9_probe_view')],
            artifacts: [{ type: 'view', name: 'rc9_probe_view' }],
        });

        const result = await protocol.deleteMetaItem({ type: 'view', name: 'rc9_probe_view' });

        expect(result.reset).toBe(true);
        expect(result.message).toBe(
            `Customization overlay deleted — view/rc9_probe_view reset to artifact default. [seq=${result.seq}]`,
        );
    });

    it('an overlay of a packaged ACTION — supportsOverlay:false, and still a real reset', async () => {
        // The mirror case, and the sharpest one. `action` declares
        // `supportsOverlay: false` yet is `allowOrgOverride: true`, so a
        // packaged action really can be overridden at runtime — and then
        // lifting that overlay really does restore the packaged default. A
        // receipt decided by `supportsOverlay` would get this exactly
        // backwards; one decided by artifact backing gets it right.
        //
        // The specimen was `flow` until #6283 rolled that type's
        // `allowOrgOverride` back to `false` (ADR-0005:57), then bare
        // `action` until #6483 rolled back the remaining nine unratified
        // flags — the premise pin above now holds the population EMPTY. The
        // pairing stays reachable through `OS_METADATA_WRITABLE` (ADR-0005's
        // documented operator escape hatch, consulted by both write gates),
        // and an overlay row minted under the hatch — or under the old flag,
        // pre-rollback — still exists at delete time, so the reset sentence
        // this case pins is still a sentence real deployments will read.
        process.env.OS_METADATA_WRITABLE = 'action';
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();

        const { protocol } = tenantProtocol({
            rows: [overlayRow('action', 'rc9_escalate')],
            artifacts: [{ type: 'action', name: 'rc9_escalate' }],
        });

        const result = await protocol.deleteMetaItem({ type: 'action', name: 'rc9_escalate' });

        expect(result.message).toBe(
            `Customization overlay deleted — action/rc9_escalate reset to artifact default. [seq=${result.seq}]`,
        );
    });

    afterEach(() => {
        // The escape-hatch case must not leak `action` writability into its
        // neighbours — both memoised caches, or the next case lies.
        delete process.env.OS_METADATA_WRITABLE;
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
    });

    // ── repository path — sentence 1 (nothing was there) ──────────────────

    it('a miss on a runtime-only name does not claim an artifact default', async () => {
        // Nothing shipped, nothing stored: the item simply is not there. The
        // old sentence answered a question nobody asked ("you are already at
        // the default") about a default that does not exist.
        const { protocol } = tenantProtocol({});

        const result = await protocol.deleteMetaItem({ type: 'object', name: 'rc9_widget' });

        expect(result.success).toBe(true);
        expect(result.reset).toBe(false);
        expect(result.message).not.toContain('artifact default');
        expect(result.message).toBe(`No object 'rc9_widget' found — nothing to delete.`);
    });

    it('a miss on an artifact-backed name keeps the original sentence', async () => {
        // Here it is TRUE: the packaged artifact exists, no overlay row does,
        // so the caller really is already at the artifact default.
        const { protocol } = tenantProtocol({ artifacts: [{ type: 'view', name: 'rc9_probe_view' }] });

        const result = await protocol.deleteMetaItem({ type: 'view', name: 'rc9_probe_view' });

        expect(result.reset).toBe(false);
        expect(result.message).toBe(
            'No customization overlay found for view/rc9_probe_view — already at artifact default.',
        );
    });

    // ── legacy raw-engine path — sentences 3 and 4 ────────────────────────
    //
    // Reachable only in control-plane bootstrap for a code-only type. It
    // writes no history row and emits no watch event, so its receipts carry
    // no `[seq=…]` — that asymmetry is pre-existing and the split leaves it
    // exactly as it was.

    it('deleting a runtime-only code-only row is not reported as a reset', async () => {
        const { protocol } = controlPlaneProtocol({ rows: [overlayRow('job', 'rc9_nightly')] });

        const result = await protocol.deleteMetaItem({ type: 'job', name: 'rc9_nightly' });

        expect(result.success).toBe(true);
        expect(result.reset).toBe(true);
        expect(result.message).not.toContain('artifact default');
        expect(result.message).toBe(`Deleted job 'rc9_nightly' — it no longer exists.`);
        expect(result.seq).toBeUndefined();
    });

    it('deleting an artifact-backed code-only row keeps the original sentence', async () => {
        const { protocol } = controlPlaneProtocol({
            rows: [overlayRow('job', 'rc9_nightly')],
            artifacts: [{ type: 'job', name: 'rc9_nightly' }],
        });

        const result = await protocol.deleteMetaItem({ type: 'job', name: 'rc9_nightly' });

        expect(result.message).toBe(
            'Customization overlay deleted — job/rc9_nightly reset to artifact default.',
        );
    });

    it('a legacy-path miss on a runtime-only name does not claim an artifact default', async () => {
        const { protocol } = controlPlaneProtocol({});

        const result = await protocol.deleteMetaItem({ type: 'job', name: 'rc9_nightly' });

        expect(result.reset).toBe(false);
        expect(result.message).toBe(`No job 'rc9_nightly' found — nothing to delete.`);
    });

    it('a legacy-path miss on an artifact-backed name keeps the original sentence', async () => {
        const { protocol } = controlPlaneProtocol({ artifacts: [{ type: 'job', name: 'rc9_nightly' }] });

        const result = await protocol.deleteMetaItem({ type: 'job', name: 'rc9_nightly' });

        expect(result.message).toBe(
            'No customization overlay found for job/rc9_nightly — already at artifact default.',
        );
    });

    // ── what the split deliberately does NOT touch ────────────────────────

    it('the draft sentences are unchanged on both sides of the split', async () => {
        // A draft discard claims neither an overlay nor a reset, so it was
        // already telling the truth for both populations and stays verbatim.
        // Pinned so a future "make it symmetric" pass does not invent a
        // distinction the draft path does not have.
        const runtimeOnly = tenantProtocol({ rows: [overlayRow('object', 'rc9_widget', 'draft')] });
        const backed = tenantProtocol({
            rows: [overlayRow('view', 'rc9_probe_view', 'draft')],
            artifacts: [{ type: 'view', name: 'rc9_probe_view' }],
        });

        const a = await runtimeOnly.protocol.deleteMetaItem({ type: 'object', name: 'rc9_widget', state: 'draft' });
        const b = await backed.protocol.deleteMetaItem({ type: 'view', name: 'rc9_probe_view', state: 'draft' });

        expect(a.message).toBe(`Draft discarded — object/rc9_widget. [seq=${a.seq}]`);
        expect(b.message).toBe(`Draft discarded — view/rc9_probe_view. [seq=${b.seq}]`);
    });

    it('a draft miss is unchanged for both populations too', async () => {
        const runtimeOnly = tenantProtocol({});
        const backed = tenantProtocol({ artifacts: [{ type: 'view', name: 'rc9_probe_view' }] });

        const a = await runtimeOnly.protocol.deleteMetaItem({ type: 'object', name: 'rc9_widget', state: 'draft' });
        const b = await backed.protocol.deleteMetaItem({ type: 'view', name: 'rc9_probe_view', state: 'draft' });

        expect(a.message).toBe('No pending draft for object/rc9_widget.');
        expect(b.message).toBe('No pending draft for view/rc9_probe_view.');
    });

    it('the new sentences spell the canonical singular type, not the caller plural', async () => {
        // #4432 — `canonicalizeMetaRequestType` folds the request type at the
        // top of the method, so a plural caller gets the singular noun back.
        const { protocol } = tenantProtocol({ rows: [overlayRow('object', 'rc9_widget')] });

        const result = await protocol.deleteMetaItem({ type: 'objects', name: 'rc9_widget' });

        expect(result.message).toBe(
            `Deleted object 'rc9_widget' — it no longer exists. [seq=${result.seq}]`,
        );
    });

    it('the split changes the sentence and nothing else about the envelope', async () => {
        // `reset` and `seq` are what machine consumers read (HMR cursors and
        // the "did anything change" flag); `message` has no parser. Pinned so
        // a wording change can never be mistaken for a contract change.
        const { protocol } = tenantProtocol({ rows: [overlayRow('object', 'rc9_widget')] });

        const result = await protocol.deleteMetaItem({ type: 'object', name: 'rc9_widget' });

        expect(result).toMatchObject({ success: true, reset: true });
        expect(typeof result.seq).toBe('number');
        // Well under #5423's 500-character client-facing bound, both shapes.
        expect(result.message.length).toBeLessThan(200);
    });
});
