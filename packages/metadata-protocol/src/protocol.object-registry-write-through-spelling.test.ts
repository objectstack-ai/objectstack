// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8862] Every `applyRegistryWriteThrough` route registers an object under the
// CANONICAL SINGULAR key — and the `'objects'` limb below it is now REMOVED.
//
// This file was written in two halves, and reads as one only if you know that.
// The MEASUREMENT half proved the limb dormant (below). The REMOVAL half then
// deleted it and added section 4, which keeps it deleted. Everything the
// measurement half says about the limb is therefore in the PAST TENSE — the
// code it quotes no longer exists, and is quoted because it is what the
// verdict was about.
//
// ---------------------------------------------------------------------------
// The question this file answers, and why it had to be measured
// ---------------------------------------------------------------------------
// `applyObjectRegistryMutation` did not merely ADMIT a plural type key, it
// consumed one — this is the code as it stood before the removal:
//
//     if (request.type !== 'object' && request.type !== 'objects') return;
//     this.engine.registry.registerItem(request.type, request.item, 'name');
//
// The spelling that came in was the spelling the registry entry got minted
// under. `canonicalMetaType`'s header names that exact shape as having already
// cost the repo a real bug: one plural-spelled read minted a plural registry
// entry, `listItems('actions')` stopped being empty, and the singular fallback
// that had been supplying the code-authored items never ran again — so one
// overlay row shadowed an entire code-authored listing and survived the DELETE
// meant to lift it.
//
// So the limb was either a live registry-shadowing defect or dead tolerance,
// and which one it was depended entirely on whether any caller could deliver
// `'objects'`. #8862 was filed WITHOUT that measurement, deliberately: it came
// out of #8820, the card where an unmeasured reachability claim was the whole
// defect. This file is that measurement — and, in section 4, the guard that
// the removal it licensed stays done.
//
// ---------------------------------------------------------------------------
// The trace, measured on `origin/main` — all four routes fold at the producer
// ---------------------------------------------------------------------------
// `applyObjectRegistryMutation` has exactly ONE caller
// (`applyRegistryWriteThrough`), which has exactly FOUR:
//
//   1. `saveMetaItem`            passes `singularTypeForRepo`, and the method
//                                already ran `canonicalizeMetaRequestType`.
//   2. `runPublishSideEffects`   passes `args.singularType`, produced by
//                                `promoteDraftForPublish`, which folds
//                                `request.type` through `PLURAL_TO_SINGULAR`.
//                                Both of its callers therefore fold —
//                                including `publishPackageDrafts`, which feeds
//                                it the draft row's STORED type unfolded.
//   3. `revertCommit`            folds at the call site:
//                                `PLURAL_TO_SINGULAR[it.type] ?? it.type`,
//                                over a value read from the stored row.
//   4. `rollbackMetaItem`        binds `singularType = request.type` AFTER
//                                `canonicalizeMetaRequestType` (#8819).
//
// Both fold maps resolve the plural — `PLURAL_TO_SINGULAR.objects === 'object'`
// and `canonicalMetaUrlType('objects') === 'object'` — so no route can deliver
// it. Verdict: DORMANT. The cases below drive each route with a plural at the
// only place that route accepts one and observe what actually reaches
// `registerItem`, so the verdict is a measurement rather than a reading of the
// call graph.
//
// ---------------------------------------------------------------------------
// What this file is FOR, now that the limb is gone
// ---------------------------------------------------------------------------
// Removal is not self-enforcing either. Nothing in the type system says a
// fifth caller must fold — the parameter is a bare `type: string`, exactly
// the shape that let #8820's hazard sit unnoticed. Three guards close that
// (the third added by the removal half):
//
//   • the per-route cases pin the SPELLING that reaches the registry, so a
//     route that stops folding mints `'objects'` here and fails loudly rather
//     than silently shadowing a code-authored listing;
//   • `applyRegistryWriteThrough` call-site COUNT is pinned, so a fifth caller
//     cannot be added without a human re-reading the trace above;
//   • [removal half] section 4 pins that no tolerance limb comes BACK — the
//     guard the count pin cannot give, since a fifth caller and a re-widened
//     predicate are different regressions.
//
// The fold maps are pinned too: they are an external dependency of this
// verdict, living in `@objectstack/spec`, and the removal's safety dies the
// day either stops resolving `objects`.
//
// ⚠️ One thing removal did NOT buy, recorded because the obvious reading
// overstates it: a hypothetical fifth, unfolded caller no longer registers an
// OBJECT (so `assertObjectRegistered` fails CLOSED — a loud error replacing a
// silent one), but on an unscoped kernel the value still falls through to
// `hydrateOverlayIntoRegistry`, which registers under the raw type like every
// other overlay kind. Removal took the plural OUT of the object-specific
// shadowing path; it did not add a second line of defence, and folding at the
// producer remains the only thing that actually prevents a plural key.
//
// ---------------------------------------------------------------------------
// Ablation directions, predicted BEFORE running (results in the PR bodies)
// ---------------------------------------------------------------------------
// Measurement half (#9008), against the tree that still HAD the limb:
//   1. Ship state                                              -> GREEN
//   2. `'objects'` limb deleted from BOTH
//      `applyRegistryWriteThrough` and
//      `applyObjectRegistryMutation`                           -> GREEN
//      (the limb is dead once the producers fold — this is the
//       evidence that licensed its removal as dead tolerance)
//   3. `applyObjectRegistryMutation`'s guard inverted to accept
//      ONLY `'objects'`                                        -> RED
//      (non-vacuity control: proves the cases really observe
//       this seam registering, rather than passing for want of
//       an assertion)
//
// Removal half (#8862), against the tree with the limb GONE. ⚠️ Direction 2
// above is why the per-route cases alone could NOT have caught a bad removal —
// they are green either way. Section 4 is what carries this half:
//   4. Ship state (limb removed)                               -> GREEN
//   5. Any one tolerance limb restored                         -> RED in §4
//      (the regression this half exists to prevent)
//   6. Comment stripper neutered to return '' -> RED in §4
//      (non-vacuity: the expected count is ONE, not zero)

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLURAL_TO_SINGULAR, canonicalMetaUrlType } from '@objectstack/spec/shared';
// [#5619] The producer's OWN write-verb dispatch decisions, imported from
// `@objectstack/metadata-core` and NOT from `@objectstack/objectql`: objectql
// depends on this package, so that import would close a dependency cycle turbo
// rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

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
    /**
     * THE observation channel this file is about: the `type` key every
     * `registerItem` call is made under, in call order. `registerObject` is
     * recorded alongside it because `applyObjectRegistryMutation` writes both
     * halves and only the first one carries a spelling.
     */
    const registeredItems: Array<{ type: string; name: unknown }> = [];
    const registeredObjects: string[] = [];
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
            if (table === 'sys_metadata_commit') return commit;
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.filter((h) => matchesHistory(h, opts?.where ?? {}));
            }
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {}));
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
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
        },
    };
    return {
        engine,
        rows,
        registeredItems,
        registeredObjects,
        serveCommit: (c: unknown) => { commit = c; },
    };
}

function makeProtocol() {
    const h = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(h.engine, () => new Map(), 'env_prod') as any;
    return { protocol, ...h };
}

const PKG = 'app.demo';

/**
 * An object body that clears the authoring gates the write paths run before
 * they reach the registry write-through — [#8308] authored OWD, and at least
 * one field.
 */
const objectBody = (name: string, label = 'Ticket') => ({
    name,
    label,
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
});

/** Only the `object` registrations — other types take the overlay-hydration limb. */
const objectKeys = (registered: Array<{ type: string; name: unknown }>) =>
    registered.map((r) => r.type);

/**
 * Write a row through the REPOSITORY, which stamps `type` exactly as given —
 * the only way to produce a row whose STORED spelling is plural, since every
 * `/meta` entry point folds before it persists. This is what a row written
 * before the #4432 boundary fold looks like at rest, and nothing rewrites it
 * on upgrade (`canonicalMetaType`'s header says so explicitly).
 */
async function seedRowVerbatim(
    protocol: any,
    args: { type: string; name: string; body: unknown; state: 'draft' | 'active'; packageId?: string },
): Promise<void> {
    await protocol.ensureOverlayIndex();
    const repo = protocol.getOverlayRepo(null);
    const ref = { type: args.type, name: args.name, org: 'env' };
    // Successive writes to one identity build the history lineage a revert
    // restores from, so each must present the CURRENT head as its parent —
    // `null` only for the first.
    // `MetadataItem.hash` is the content checksum `put` compares against.
    const existing = await repo.get(ref, { state: args.state });
    await repo.put(
        ref,
        args.body,
        {
            parentVersion: existing?.hash ?? null,
            actor: null,
            source: 'test.at-rest-residue',
            intent: 'runtime-only',
            state: args.state,
            ...(args.packageId ? { packageId: args.packageId } : {}),
        },
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The four routes, each driven with a plural where it accepts one
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8862] every object registry write-through registers under the singular key', () => {
    // ── route 1: saveMetaItem, plural URL spelling ──────────────────────────
    it('saveMetaItem addressed `objects` registers `object`', async () => {
        const { protocol, registeredItems } = makeProtocol();

        const res = await protocol.saveMetaItem({
            type: 'objects', name: 'ticket', item: objectBody('ticket'),
            packageId: PKG, mode: 'publish',
        });

        expect(res.success).toBe(true);
        // Non-empty is half the assertion — a skipped registration would leave
        // this empty and the equality below would fail on length.
        expect(objectKeys(registeredItems)).toEqual(['object']);
        expect(registeredItems).not.toContainEqual(
            expect.objectContaining({ type: 'objects' }),
        );
    });

    // ── route 2a: publishMetaItem -> runPublishSideEffects, plural spelling ──
    it('publishMetaItem addressed `objects` registers `object`', async () => {
        const { protocol, registeredItems } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'),
            packageId: PKG, mode: 'draft',
        });
        registeredItems.length = 0; // the draft wrote nothing; start clean anyway

        const res = await protocol.publishMetaItem({ type: 'objects', name: 'ticket' });

        expect(res.success).toBe(true);
        expect(objectKeys(registeredItems)).toEqual(['object']);
    });

    // ── route 2b: publishPackageDrafts -> runPublishSideEffects ─────────────
    //
    // The batch caller is the one that feeds `runPublishSideEffects` a type it
    // did NOT fold at a `/meta` boundary — it hands `promoteDraftForPublish`
    // the draft row's stored `type` (`listDrafts` applies no fold). The fold
    // that saves it lives inside `promoteDraftForPublish`.
    it('publishPackageDrafts registers each promoted object under `object`', async () => {
        const { protocol, registeredItems } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'),
            packageId: PKG, mode: 'draft',
        });
        await protocol.saveMetaItem({
            type: 'object', name: 'invoice', item: objectBody('invoice', 'Invoice'),
            packageId: PKG, mode: 'draft',
        });

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.success).toBe(true);
        expect(res.publishedCount).toBe(2);
        expect(objectKeys(registeredItems)).toEqual(['object', 'object']);
    });

    // ── route 3: revertCommit, over a row whose STORED type is plural ───────
    //
    // The sharpest of the four: `it.type` is read from the commit's item list,
    // which mirrors the stored row, so a legacy plural row genuinely arrives
    // here. The fold is applied at the call site.
    it('revertCommit folds a stored PLURAL type before the write-through', async () => {
        const { protocol, registeredItems, serveCommit } = makeProtocol();
        // v1 and v2 at rest under the plural spelling, so a revert to v1 has
        // history to restore from.
        await seedRowVerbatim(protocol, {
            type: 'objects', name: 'legacy_ticket', body: objectBody('legacy_ticket'), state: 'active',
        });
        await seedRowVerbatim(protocol, {
            type: 'objects', name: 'legacy_ticket', body: objectBody('legacy_ticket', 'Renamed'), state: 'active',
        });
        registeredItems.length = 0;
        serveCommit(commitRow([
            { type: 'objects', name: 'legacy_ticket', existedBefore: true, prevVersion: 1 },
        ]));

        const res = await protocol.revertCommit({ commitId: 'c1' });

        expect(res.revertedCount).toBe(1);
        // The registry key is the SINGULAR — while the repo-facing reads keep
        // the stored plural. Two different keys, on purpose.
        expect(objectKeys(registeredItems)).toEqual(['object']);
    });

    // ── route 4: rollbackMetaItem, plural URL spelling ──────────────────────
    it('rollbackMetaItem addressed `objects` registers `object`', async () => {
        const { protocol, registeredItems } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG,
        });
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket', 'Renamed'), packageId: PKG,
        });
        registeredItems.length = 0;

        const res = await protocol.rollbackMetaItem({ type: 'objects', name: 'ticket', toVersion: 1 });

        expect(res.success).toBe(true);
        expect(objectKeys(registeredItems)).toEqual(['object']);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The external dependency the verdict rests on
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8862] the fold maps that make the plural unreachable', () => {
    it('both maps resolve `objects` to `object`', () => {
        // `PLURAL_TO_SINGULAR` is what routes 1-3 fold through; the URL map is
        // what `canonicalizeMetaRequestType` folds through for routes 1 and 4.
        expect(PLURAL_TO_SINGULAR.objects).toBe('object');
        expect(canonicalMetaUrlType('objects')).toBe('object');
        // Already canonical stays canonical — the fold is idempotent, which is
        // why routes that fold twice are harmless.
        expect(canonicalMetaUrlType('object')).toBe('object');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The structural guard — a fifth caller must re-open the trace
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8862] the `applyRegistryWriteThrough` caller set stays closed', () => {
    const source = readFileSync(
        fileURLToPath(new URL('./protocol.ts', import.meta.url)),
        'utf8',
    );

    it('has exactly four call sites, all traced in this file’s header', () => {
        const callSites = source.match(/this\.applyRegistryWriteThrough\(/g) ?? [];
        expect(callSites).toHaveLength(4);
    });

    it('`applyObjectRegistryMutation` is reached only through the write-through', () => {
        const callSites = source.match(/this\.applyObjectRegistryMutation\(/g) ?? [];
        expect(callSites).toHaveLength(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. [#8862 removal half] The tolerance stays removed
// ═══════════════════════════════════════════════════════════════════════════
//
// The four `'objects'` tolerance limbs were deleted once the dormancy above
// was proven. This block keeps them deleted.
//
// It scans EXECUTABLE text — comments stripped — for a reason that is not
// cosmetic: the removal commit deliberately kept the deleted limbs QUOTED in
// the surrounding comments (a reader needs to see what was removed and why),
// so a scan of the raw file would match its own documentation and could never
// go red. Stripping is what makes this pin capable of failing.
//
// ⭐ NON-VACUITY IS STRUCTURAL, not a separate control case. The expected count
// is ONE, not zero — the surviving occurrence is `listCollection('object',
// 'objects')`, a genuine singular/plural COLLECTION PAIR and a different
// construct entirely (it names two registry collections; it does not tolerate
// a spelling). So a stripper that silently blanked the file would report zero
// and fail, and a returning tolerance limb reports two and fails. Measured
// both directions on the removal commit: `origin/main` before it scored FIVE
// (the pair + the four limbs), the tree after it scores ONE.
//
// ⛔ Do not "fix" a failure here by relaxing the count. If a plural spelling
// genuinely has to reach one of these seams again, the answer is the same one
// #8820 and #8862 both landed on: fold at the PRODUCER. A tolerant predicate
// one layer below a folding boundary is the shape `canonicalMetaType`'s header
// rejects, and the shape that already cost this repo one registry-shadowing
// bug.

/**
 * Remove comments while preserving string literals, so a scan can tell code
 * from prose ABOUT that code. Handles `//`, block comments, and the three
 * quote forms with escapes.
 */
function executableTextOf(src: string): string {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (c === '/' && d === '/') {
            while (i < n && src[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && d === '*') {
            i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') {
            const quote = c;
            out += c;
            i++;
            while (i < n) {
                if (src[i] === '\\') {
                    out += src[i] + (src[i + 1] ?? '');
                    i += 2;
                    continue;
                }
                out += src[i];
                if (src[i] === quote) { i++; break; }
                i++;
            }
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

describe('[#8862] the `objects` tolerance stays removed', () => {
    const code = executableTextOf(readFileSync(
        fileURLToPath(new URL('./protocol.ts', import.meta.url)),
        'utf8',
    ));

    it('has exactly one executable `objects` literal — the collection pair, not a tolerance', () => {
        const occurrences = code.match(/'objects'/g) ?? [];
        // ONE, not zero: see the non-vacuity note above. Zero means the
        // stripper broke; two or more means a tolerance limb came back.
        expect(occurrences).toHaveLength(1);
        const lines = code.split('\n').filter((l) => l.includes("'objects'"));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("listCollection('object', 'objects')");
    });

    it('none of the four seams admits a plural any more', () => {
        // The narrowed forms, pinned positively so a reformat that defeats the
        // count above still has to keep these honest.
        expect(code.match(/request\.type !== 'object'\) return;/g) ?? []).toHaveLength(1);
        expect(code.match(/request\.type === 'object'\) \{/g) ?? []).toHaveLength(1);
        // `ensureObjectStorage` + `dropObjectStorage`.
        expect(code.match(/\n\s*if \(type !== 'object'\) return;/g) ?? []).toHaveLength(2);
    });
});
