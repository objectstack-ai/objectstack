// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14179] The three RECOVERY doors announce their writes on the mutation
 * choke point.
 *
 * ---------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------
 * `emitMetadataMutation`'s own docblock calls itself "the ONE choke point
 * every authoring surface funnels through", and since #13331 it is also the
 * cluster publish point (`notifyMutationListenersLocal` + then
 * `publishMetadataMutation`). Three write paths mutated live state and told
 * nobody:
 *
 *  1. `rollbackMetaItem` — registry write-through, no emit. A rolled-back
 *     `hook` row left the OLD hook bound in every boot-cached consumer until
 *     restart, while the registry and the stored row already served the
 *     restored body.
 *  2. `revertCommit` — per-item write-through (restore limb) and per-item
 *     `repo.delete` + heal (soft-remove limb), no emit on either.
 *  3. `deleteMetaItem`'s LEGACY raw-engine exit — the `else` side of
 *     `useRepoPath` — really removes the row, may drop the physical storage
 *     and heals the registry view locally, and published nothing. Its
 *     repository-path twin has emitted since #2588.
 *
 * Post-#13331 each miss costs twice: boot-cached consumers wired to
 * `onMetadataMutation` do not re-sync locally, AND peers never hear the
 * recovery write, so a rollback converges the writer and leaves every other
 * replica on the rolled-back-FROM body until an unrelated mutation or a
 * restart.
 *
 * ---------------------------------------------------------------------------
 * What this file measures, and what it deliberately does not
 * ---------------------------------------------------------------------------
 * The LOCAL half is observed directly, through the public `onMetadataMutation`
 * subscription — one event per door, asserted whole
 * (`{ type, name, state, organizationId }`).
 *
 * The CLUSTER half is INHERITED, not re-measured here, and the inheritance is
 * structural rather than hopeful: `emitMetadataMutation` is two lines — the
 * local fan-out and then `publishMetadataMutation` — so a door that reaches
 * the choke point reaches the publisher. §5 pins that every new door calls
 * `this.emitMetadataMutation` (and not the local-only
 * `notifyMutationListenersLocal`, which is the receive path's method), and
 * `protocol.cluster-mutation-fanout.test.ts` proves the choke point end to end
 * over a two-replica pub/sub double — Arm B, "a runtime-authored object
 * registers on the PEER after the writer's save". Building a second cluster
 * harness here would re-measure that file's subject, not this card's.
 *
 * The RECEIVE path staying silent is likewise already pinned next door and is
 * NOT duplicated: `protocol.cluster-mutation-fanout.test.ts` →
 * "the peer's onMetadataMutation listeners receive the remote event, once,
 * after convergence" asserts `writerSeen` has length 1 with the comment "the
 * remote replay stays local to the receiving node (no echo)" — a peer that
 * re-emitted (rather than calling `notifyMutationListenersLocal`) would
 * re-publish, the writer would apply that peer-origin message past its own
 * loopback guard, and that assertion would read 2. Nothing in this change
 * touches `applyRemoteMetadataMutation`; §5 pins that its emit-free shape
 * holds.
 *
 * ---------------------------------------------------------------------------
 * Arms and controls
 * ---------------------------------------------------------------------------
 *  • POSITIVE CONTROL (§1): `saveMetaItem`, a door that already emitted,
 *    delivers under this harness's subscriber. Without it a silent harness
 *    would make every door below pass for want of an instrument.
 *  • NEGATIVE CONTROLS (§4): the row-absent exits stay silent — the
 *    repository path's miss, the legacy path's miss, and `revertCommit`'s
 *    soft-remove limb over an item whose row is already gone. Nothing
 *    mutated, so nothing is announced; a `deleted` signal there would wake
 *    every peer to converge on a no-op.
 *  • REACHABILITY (§3): the legacy branch's exposure, recorded as NOT
 *    MEASURED on this card, is measured here — see that section's header.
 *
 * ---------------------------------------------------------------------------
 * Ablation, direction declared in writing BEFORE the run
 * ---------------------------------------------------------------------------
 * Removing the `rollbackMetaItem` emit (door 1) from `protocol.ts`:
 *   -> §2's "rollbackMetaItem announces the restored body" turns RED
 *   -> every other case in this file stays GREEN — the two `revertCommit`
 *      limbs, the legacy delete, the positive control, all four negative
 *      controls and the reachability section observe other code paths.
 *   -> §5's structural count drops from 7 to 6 and turns RED, which is the
 *      point of counting rather than merely locating.
 * Measured result is recorded in the PR body.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
// [#5619] The producer's OWN write-verb dispatch decisions, imported from
// `@objectstack/metadata-core` and NOT from `@objectstack/objectql`: objectql
// depends on this package, so that import would close a dependency cycle turbo
// rejects outright. Same reasoning, same import, as every sibling harness here.
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import type { MetadataMutationEvent } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
}

interface HistoryRow {
    id: string;
    type: string;
    name: string;
    version: number;
    organization_id: string | null;
    operation_type: string;
    metadata?: string | null;
    recorded_at?: string;
}

/** ADR-0048 overlay key — (type, name, org, state, package_id). */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

/** Top-level eq + `$or` + explicit-NULL, the subset these paths emit. */
function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if ((r as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
}

/** One `sys_metadata_commit` row in the driver's snake_case wire shape. */
const commitRow = (items: unknown[]) => ({
    id: 'c1',
    commit_id: 'c1',
    organization_id: null,
    operation: 'apply',
    message: 'the commit under revert',
    created_at: '2026-01-01T00:00:00Z',
    items: JSON.stringify(items),
});

function makeStubEngine() {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    let nextId = 0;
    /** Registry traffic, so a case can tell "healed" from "announced". */
    const registeredItems: Array<{ type: string; name: unknown }> = [];
    const registeredObjects: string[] = [];
    const removedObjectOverlays: string[] = [];
    const removedEntries: string[] = [];
    /** Served to `getArtifactItem` when a case wants an artifact-backed name. */
    const artifacts = new Map<string, unknown>();
    /** Served to `findOne('sys_metadata_commit', …)` when a test sets it. */
    let commit: unknown = null;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            if (r) return { key: k, row: r };
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const matchesHistory = (h: HistoryRow, w: Record<string, unknown>): boolean => {
        if (w.organization_id !== undefined && h.organization_id !== w.organization_id) return false;
        if (w.type !== undefined && h.type !== w.type) return false;
        if (w.name !== undefined && h.name !== w.name) return false;
        if (w.version !== undefined && h.version !== w.version) return false;
        if (w.operation_type !== undefined && h.operation_type !== w.operation_type) return false;
        return true;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_commit') return commit;
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            if (table !== 'sys_metadata') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            // Hold the caller's bound AFTER the filter, by PRESENCE — the
            // objectql-double-limit contract: a bound the double ignores makes
            // a pagination bug invisible to every test built on it.
            const bound = <T>(all: T[]): T[] =>
                typeof opts?.limit === 'number' ? all.slice(0, opts.limit) : all;
            if (table === 'sys_metadata_history') {
                return bound(historyRows.filter((h) => matchesHistory(h, opts?.where ?? {})));
            }
            if (table !== 'sys_metadata') return [];
            return bound(Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {})));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            if (table === 'sys_metadata_history') {
                nextId += 1;
                const h = { ...(data as unknown as HistoryRow), id: `h_${nextId}` };
                historyRows.push(h);
                return { id: h.id };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            const row = { ...(data as unknown as Row), id: `r_${nextId}` };
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as unknown as Row) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async count() { return 0; },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { return true; },
        async dropObjectSchema() { return true; },
        registry: {
            registerItem: (type: string, item: any) => {
                registeredItems.push({ type, name: item?.name });
            },
            registerObject: (body: any) => { registeredObjects.push(body?.name); },
            unregisterObject: () => true,
            removeObjectOverlay: (name: string) => { removedObjectOverlays.push(name); },
            removeRuntimeShadow: () => false,
            removeOverlayEntry: (type: string, name: string) => {
                removedEntries.push(`${type}|${name}`);
                return true;
            },
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: (type: string, name: string) => artifacts.get(`${type}|${name}`),
        },
    };
    return {
        engine,
        rows,
        registeredItems,
        registeredObjects,
        removedObjectOverlays,
        removedEntries,
        serveCommit: (c: unknown) => { commit = c; },
        serveArtifact: (type: string, name: string, item: unknown) => {
            artifacts.set(`${type}|${name}`, item);
        },
    };
}

/**
 * @param mode `'environment'` is an ordinary environment boot;
 * `'bootstrap'` leaves `environmentId` UNDEFINED — control-plane bootstrap,
 * the topology whose reachability §3 measures.
 *
 * A NAMED mode rather than the `environmentId` itself, deliberately: a default
 * parameter fires on an explicitly passed `undefined`, so a factory taking the
 * id directly would have silently produced an environment boot for the very
 * call meant to ask for bootstrap, and every bootstrap-mode case below would
 * have measured the wrong topology. It did, on the first run — those cases
 * answered 403 from the two-tier gate, which is §3's assertion, not §2's. The
 * `expect` below is the second half of the fix: the harness now proves the
 * topology it claims instead of assuming the constructor received it.
 */
function makeProtocol(mode: 'environment' | 'bootstrap' = 'environment') {
    const h = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(
        h.engine, () => new Map(), mode === 'bootstrap' ? undefined : 'env_prod',
    ) as any;
    expect(protocol.environmentId).toBe(mode === 'bootstrap' ? undefined : 'env_prod');
    // The env-writable escape hatch (`OS_METADATA_WRITABLE`) turns
    // `isOverlayAllowed` true for any type it lists, which would move §3's
    // code-only type onto the REPOSITORY path and quietly change what is being
    // measured. Memoised process-wide, so clear it rather than assume.
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    const seen: MetadataMutationEvent[] = [];
    protocol.onMetadataMutation((e: MetadataMutationEvent) => { seen.push({ ...e }); });
    return { protocol, seen, ...h };
}

const PKG = 'app.demo';

/** Clears the #8308 authoring gates — authored OWD plus at least one field. */
const objectBody = (name: string, label = 'Ticket') => ({
    name,
    label,
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Positive control — the instrument works
// ═══════════════════════════════════════════════════════════════════════════

describe('[#14179] positive control: an already-emitting door reaches this subscriber', () => {
    it('saveMetaItem announces its publish', async () => {
        const { protocol, seen } = makeProtocol();

        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'),
            packageId: PKG, mode: 'publish',
        });

        expect(seen).toEqual([
            { type: 'object', name: 'ticket', state: 'active', organizationId: null },
        ]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The three doors
// ═══════════════════════════════════════════════════════════════════════════

describe('[#14179] door 1 — rollbackMetaItem', () => {
    it('announces the restored body on the mutation choke point', async () => {
        const { protocol, seen } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG,
        });
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket', 'Renamed'), packageId: PKG,
        });
        seen.length = 0;

        const res = await protocol.rollbackMetaItem({ type: 'object', name: 'ticket', toVersion: 1 });

        expect(res.success).toBe(true);
        expect(seen).toEqual([
            { type: 'object', name: 'ticket', state: 'active', organizationId: null },
        ]);
    });

    it('folds a PLURAL request type to the singular the write-through registered under', async () => {
        // The type key on the event is the registry key, not the caller's URL
        // spelling — a consumer that re-reads on `hook` must not be handed
        // `hooks`. `canonicalizeMetaRequestType` at the door is what makes the
        // two agree; this pins that the event inherited it.
        const { protocol, seen } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG,
        });
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket', 'Renamed'), packageId: PKG,
        });
        seen.length = 0;

        await protocol.rollbackMetaItem({ type: 'objects', name: 'ticket', toVersion: 1 });

        expect(seen.map((e) => e.type)).toEqual(['object']);
    });
});

describe('[#14179] door 2 — revertCommit', () => {
    it('RESTORE limb announces the pre-commit body it wrote back', async () => {
        const { protocol, seen, serveCommit } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG,
        });
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket', 'Renamed'), packageId: PKG,
        });
        seen.length = 0;
        serveCommit(commitRow([
            { type: 'object', name: 'ticket', existedBefore: true, prevVersion: 1 },
        ]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        expect(res.revertedCount).toBe(1);
        expect(res.reverted[0].action).toBe('restored');
        expect(seen).toEqual([
            { type: 'object', name: 'ticket', state: 'active', organizationId: null },
        ]);
    });

    it('SOFT-REMOVE limb announces a `deleted`, matching what deleteMetaItem emits', async () => {
        const { protocol, seen, serveCommit } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG,
        });
        seen.length = 0;
        serveCommit(commitRow([
            { type: 'object', name: 'ticket', existedBefore: false },
        ]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        expect(res.revertedCount).toBe(1);
        expect(res.reverted[0].action).toBe('removed');
        expect(seen).toEqual([
            { type: 'object', name: 'ticket', state: 'deleted', organizationId: null },
        ]);
    });

    it('a mixed commit announces one event per reverted item, in revert order', async () => {
        // A batch is the shape this door actually serves; per-item emission is
        // what a consumer re-binding a single name needs. Items are reverted
        // in REVERSE apply order, and the announcements follow.
        const { protocol, seen, serveCommit } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG,
        });
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket', 'Renamed'), packageId: PKG,
        });
        await protocol.saveMetaItem({
            type: 'object', name: 'invoice', item: objectBody('invoice', 'Invoice'), packageId: PKG,
        });
        seen.length = 0;
        serveCommit(commitRow([
            { type: 'object', name: 'ticket', existedBefore: true, prevVersion: 1 },
            { type: 'object', name: 'invoice', existedBefore: false },
        ]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        expect(res.revertedCount).toBe(2);
        expect(seen).toEqual([
            { type: 'object', name: 'invoice', state: 'deleted', organizationId: null },
            { type: 'object', name: 'ticket', state: 'active', organizationId: null },
        ]);
    });
});

describe('[#14179] door 3 — deleteMetaItem’s legacy raw-engine exit', () => {
    /**
     * Seed a row the REPOSITORY refuses to write: a code-only type's
     * `assertAllowed()` 403s every repository write, so the only way this row
     * exists at rest is the way it really does — minted before #5263's
     * code-only refusal shipped, and never rewritten on upgrade.
     */
    const seedCodeOnlyRow = async (engine: any, type: string, name: string) => {
        await engine.insert('sys_metadata', {
            type, name,
            organization_id: null,
            package_id: null,
            state: 'active',
            metadata: JSON.stringify({ name, label: 'Legacy residue' }),
        });
    };

    it('announces the deletion it really performs', async () => {
        // Control-plane bootstrap: `environmentId === undefined` is the mode
        // §3 measures this branch to be confined to.
        const { protocol, seen, engine, rows } = makeProtocol('bootstrap');
        await seedCodeOnlyRow(engine, 'api', 'legacy_endpoint');
        expect(rows.size).toBe(1);

        const res = await protocol.deleteMetaItem({ type: 'api', name: 'legacy_endpoint' });

        expect(res).toMatchObject({ success: true, reset: true });
        // The row really is gone — the emit is announcing a mutation, not
        // narrating a no-op.
        expect(rows.size).toBe(0);
        expect(seen).toEqual([
            { type: 'api', name: 'legacy_endpoint', state: 'deleted', organizationId: null },
        ]);
    });

    it('carries the org scope the delete predicate used', async () => {
        const { protocol, seen, engine } = makeProtocol('bootstrap');
        await engine.insert('sys_metadata', {
            type: 'api', name: 'legacy_endpoint',
            organization_id: 'org_acme',
            package_id: null,
            state: 'active',
            metadata: JSON.stringify({ name: 'legacy_endpoint' }),
        });

        const res = await protocol.deleteMetaItem({
            type: 'api', name: 'legacy_endpoint', organizationId: 'org_acme',
        });

        expect(res.success).toBe(true);
        expect(seen).toEqual([
            { type: 'api', name: 'legacy_endpoint', state: 'deleted', organizationId: 'org_acme' },
        ]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Reachability of the legacy branch — the card's NOT MEASURED item
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The unblock comment recorded, explicitly, that it had NOT verified the
 * legacy branch's own docblock claim ("only reachable in control-plane
 * bootstrap mode where `environmentId` is undefined"), noting that
 * `useRepoPath` does not itself test `environmentId`.
 *
 * Measured here, and the claim HOLDS — by a mechanism the docblock does not
 * name. `useRepoPath` is indeed `environmentId`-blind; what confines the
 * branch is the two-tier authorization block above it, which runs ONLY when
 * `environmentId !== undefined` and refuses both limbs for exactly the types
 * that would reach the legacy path:
 *
 *   • artifact-backed  -> `artifactBacked && !overlayAllowed &&
 *     !legacyOverlayRemoval` -> `NOT_OVERRIDABLE` 403
 *   • not artifact-backed -> `!artifactBacked && !overlayAllowed &&
 *     !runtimeCreateAllowed` -> `NOT_CREATABLE` 403
 *
 * The `legacyOverlayRemoval` carve-out (#6960) is the only way through the
 * first limb, and it cannot apply: it reads `supportsOverlay`, and no type in
 * the registry carries `supportsOverlay: true` alongside the two `false` flags
 * that produce `useRepoPath === false` (pinned below, so a registry edit that
 * opens the door has to come past this file).
 *
 * ⇒ The exposure is NARROWER than the unblock comment feared: on a normal
 * boot the legacy exit is unreachable through the public `deleteMetaItem`, so
 * door 3's repair is pinned under bootstrap mode (§2) — which is where the
 * defect is real, and where the registry every org shares is the one being
 * healed.
 */
describe('[#14179] reachability: the legacy exit is confined to bootstrap mode', () => {
    const codeOnly = DEFAULT_METADATA_TYPE_REGISTRY.filter(
        (e) => !e.allowOrgOverride && !e.allowRuntimeCreate,
    );

    it('the `useRepoPath === false` set is non-empty and none of it merges an overlay at read', () => {
        // Non-empty: the branch is not dead code.
        expect(codeOnly.length).toBeGreaterThan(0);
        expect(codeOnly.map((e) => e.type).sort())
            .toEqual(['agent', 'api', 'capability', 'field', 'job']);
        // …and the #6960 carve-out reaches none of them, which is what makes
        // the 403 below total rather than incidental.
        expect(codeOnly.filter((e) => e.supportsOverlay)).toEqual([]);
    });

    it('a normal boot refuses a code-only delete before the branch — artifact-free limb', async () => {
        const { protocol, seen, engine } = makeProtocol('environment');
        await engine.insert('sys_metadata', {
            type: 'api', name: 'legacy_endpoint',
            organization_id: null, package_id: null, state: 'active',
            metadata: JSON.stringify({ name: 'legacy_endpoint' }),
        });

        await expect(
            protocol.deleteMetaItem({ type: 'api', name: 'legacy_endpoint' }),
        ).rejects.toMatchObject({ code: 'NOT_CREATABLE', status: 403 });
        expect(seen).toEqual([]);
    });

    it('a normal boot refuses a code-only delete before the branch — artifact-backed limb', async () => {
        const { protocol, seen, engine, serveArtifact } = makeProtocol('environment');
        serveArtifact('api', 'shipped_endpoint', { name: 'shipped_endpoint', _packageId: PKG });
        await engine.insert('sys_metadata', {
            type: 'api', name: 'shipped_endpoint',
            organization_id: null, package_id: null, state: 'active',
            metadata: JSON.stringify({ name: 'shipped_endpoint' }),
        });

        await expect(
            protocol.deleteMetaItem({ type: 'api', name: 'shipped_endpoint' }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(seen).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Negative controls — a no-op announces nothing
// ═══════════════════════════════════════════════════════════════════════════

describe('[#14179] the row-absent exits stay silent', () => {
    it('the legacy path’s miss deletes nothing and announces nothing', async () => {
        const { protocol, seen } = makeProtocol('bootstrap');

        const res = await protocol.deleteMetaItem({ type: 'api', name: 'never_existed' });

        expect(res).toMatchObject({ success: true, reset: false });
        expect(seen).toEqual([]);
    });

    it('the repository path’s miss announces nothing (pre-existing, unchanged)', async () => {
        const { protocol, seen } = makeProtocol();

        const res = await protocol.deleteMetaItem({ type: 'object', name: 'never_existed' });

        expect(res).toMatchObject({ success: true, reset: false });
        expect(seen).toEqual([]);
    });

    it('revertCommit’s soft-remove limb over an already-absent row announces nothing', async () => {
        // The limb still runs its self-heal — a stale shadow can outlive the
        // row it came from — but nothing MUTATED, so no signal is sent and no
        // peer is woken to converge on a no-op.
        const { protocol, seen, serveCommit } = makeProtocol();
        serveCommit(commitRow([
            { type: 'object', name: 'ghost', existedBefore: false },
        ]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        expect(res.revertedCount).toBe(1);
        expect(res.reverted[0].action).toBe('removed');
        expect(seen).toEqual([]);
    });

    it('a DRAFT save still announces `draft`, and the publisher — not this door — filters it', async () => {
        // Guards the boundary the other way: this change must not have made
        // any door announce a state it did not before. `publishMetadataMutation`
        // owns the draft filter; the local bus hears everything.
        const { protocol, seen } = makeProtocol();

        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'),
            packageId: PKG, mode: 'draft',
        });

        expect(seen).toEqual([
            { type: 'object', name: 'ticket', state: 'draft', organizationId: null },
        ]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The structural guard — the cluster half is inherited, so COUNT the doors
// ═══════════════════════════════════════════════════════════════════════════

describe('[#14179] every announcing door goes through the choke point', () => {
    const source = readFileSync(
        fileURLToPath(new URL('./protocol.ts', import.meta.url)),
        'utf8',
    );

    it('has exactly seven `emitMetadataMutation` call sites — three original, three doors, four limbs', () => {
        // saveMetaItem · runPublishSideEffects · deleteMetaItem (repository)
        //   + rollbackMetaItem
        //   + revertCommit restore limb + revertCommit soft-remove limb
        //   + deleteMetaItem (legacy raw-engine)
        // A new door that reaches for the LOCAL-only fan-out instead would
        // leave this count untouched and lose the cluster half in silence, so
        // §5's second case counts that method's callers too.
        const callSites = source.match(/this\.emitMetadataMutation\(/g) ?? [];
        expect(callSites).toHaveLength(7);
        // Non-vacuity: the declaration is not one of them.
        expect(source.match(/private emitMetadataMutation\(/g) ?? []).toHaveLength(1);
    });

    it('`notifyMutationListenersLocal` keeps exactly its two declared callers', () => {
        // The local-only fan-out is the RECEIVE path's method (#13331): the
        // choke point calls it, and `applyRemoteMetadataMutation` calls it to
        // replay a peer's event WITHOUT re-publishing. A third caller is
        // either a door that lost its cluster leg or a receive path that grew
        // one, and both are this card's defect in a new place.
        const callers = source.match(/this\.notifyMutationListenersLocal\(/g) ?? [];
        expect(callers).toHaveLength(2);
        expect(source.match(/private notifyMutationListenersLocal\(/g) ?? []).toHaveLength(1);
    });

    it('the receive path still emits nothing — it replays locally only', () => {
        // Scoped to `applyRemoteMetadataMutation`'s body: an emit here would
        // re-broadcast every received event and ping-pong across replicas,
        // which the loopback guard (own-messages only) cannot stop.
        const start = source.indexOf('private async applyRemoteMetadataMutation(');
        expect(start).toBeGreaterThan(-1);
        const body = source.slice(start, source.indexOf('\n    /**', start));
        expect(body).toContain('this.notifyMutationListenersLocal(');
        expect(body).not.toContain('this.emitMetadataMutation(');
    });
});
