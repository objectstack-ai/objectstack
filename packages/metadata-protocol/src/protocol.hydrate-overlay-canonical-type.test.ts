// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#9111] `hydrateOverlayIntoRegistry` ASSERTS that the type it mints a
// registry entry under is canonical — the last unfolded seam of the `objects`
// tolerance family, closed as an assert rather than a fold.
//
// ---------------------------------------------------------------------------
// The question this file answers
// ---------------------------------------------------------------------------
// The helper is the ONE choke point all registry overlay hydration funnels
// through (boot, the read side, the write-through). Its `type` parameter was a
// bare `string`, and the spelling handed in was the spelling the entry got
// minted under:
//
//     registry.registerItem(type, mergeArtifactProtection(data, artifact), 'name')
//
// So "callers must fold" was load-bearing and lived in no type, no signature
// and no check. That is the same unstated invariant that made #8820, #8862 and
// #9009 necessary; this card is the fourth, and the assert below is the fifth
// rediscovery not happening.
//
// ---------------------------------------------------------------------------
// Phase 1 — the reachability measurement, taken BEFORE the fix
// ---------------------------------------------------------------------------
// The card required every caller measured, and the READ SIDE FIRST, because
// #9157 had just falsified "every `/meta` entry point folds through
// `canonicalizeMetaRequestType`" one function over (`auditMetaItem`,
// `historyMetaItem`, `findReferencesToMeta` never reach the boundary fold).
// That assumption was NOT inherited here. Measured instead — six producer
// routes into the helper:
//
//   1. `getMetaItems`               read-side hydration   `canonicalizeMetaRequestType`
//   2. `saveMetaItem`               → write-through       `canonicalizeMetaRequestType`
//   3. `rollbackMetaItem`           → write-through       `canonicalizeMetaRequestType`
//   4. `promoteDraftForPublish`     → write-through       `PLURAL_TO_SINGULAR`, but BOTH
//      callers are covered: `publishMetaItem` folds at the boundary, and
//      `publishPackageDrafts` is pre-empted by #8908's `STORED_TYPE_NOT_CANONICAL`
//      pre-flight (`isNonCanonicalStoredType`).
//   5. `revertCommit`               → write-through       `PLURAL_TO_SINGULAR[it.type]`
//      over a STORED commit-item type.                    ← UNGUARDED at the time
//      [#9174] Its restore limb now carries a `STORED_TYPE_NOT_CANONICAL`
//      pre-flight of its own, so this producer no longer delivers the class to
//      the assert. The assert stays the contract for a producer that stops
//      folding; the pre-flight is what gives the caller a wire-visible verdict.
//      Measured in `protocol.revert-stored-type-canonical.test.ts`.
//   6. `loadMetaFromDb`             boot hydration        `PLURAL_TO_SINGULAR[record.type]`
//      over a STORED row type.                            ← UNGUARDED
//
// Routes 5 and 6 fold through the MANIFEST-COLLECTION map — TOLERANT AND
// INCOMPLETE, exactly the trap #9161 named one seam over. It resolves the
// plurals that were never the hazard and passes through the spellings whose
// types are not stack collections, for which the fold is a NO-OP and the raw
// spelling reaches `registerItem`. Section 1 pins that hole in the maps
// themselves; sections 2 and 3 drive it.
//
// VERDICT: dormant for live traffic — a Task, not a Bug, and measured rather
// than inherited. The only `sys_metadata` writer that stamps a caller-chosen
// `type` is `saveMetaItem`'s `repo.put`, which folds at the boundary, so no
// live write can mint such a row. The population that reaches routes 5 and 6
// is pre-#7894 AT-REST residue, which is real (`PUT /meta/fields/…` answered
// 200 and persisted before #7894 closed that door) and which nothing rewrites
// on upgrade.
//
// ---------------------------------------------------------------------------
// Why an ASSERT and not a fold — the half that decided the shape
// ---------------------------------------------------------------------------
// The card offered both. Folding here would be the tolerant lookup below a
// folding boundary that `canonicalMetaType`'s header has rejected since #4432
// — and here it would do something strictly worse than dilute a contract. A
// pre-#7894 row exists BECAUSE `PUT /meta/fields/…` slipped past the lock that
// answers `PUT /meta/field/…` with 403 NOT_OVERRIDABLE. Folding it into the
// canonical key at boot would honour, process-wide, precisely the override
// #7894 closed the door on — laundering a row through the hole that created
// it. Refusing leaves the row exactly as unreachable as it already is, and
// says so out loud.
//
// ⚠️ The assert touches NO audit row, NO commit record and NO repository key,
// and changes NO producer's spelling — so #8908's `AUDIT_TYPE_NOT_CANONICAL`
// ruling (the caller's spelling must reach the audit writer unfolded and fail
// loudly at 500) is untouched in both directions.
//
// ---------------------------------------------------------------------------
// Ablation directions, predicted BEFORE running — and what actually happened
// ---------------------------------------------------------------------------
//   1. Ship state                                  predicted GREEN -> GREEN (11/11)
//   2. Assert deleted from
//      `hydrateOverlayIntoRegistry`                predicted RED   -> RED, 6 failed
//      This leg IS the pre-fix measurement, and it printed the defect rather
//      than merely failing: `registerItem` received
//      `[ { type: 'fields' } ]` and `[ 'view', 'translations', 'view' ]`
//      — the raw stored spelling minting a shadow namespace — with boot
//      reporting `errors: 0`.
//   3. Assert weakened to
//      `isNonCanonicalStoredType`                  predicted RED §2 -> RED, 1 failed
//      Exactly the `'objects'` case, and nothing else: the manifest-PRESENT
//      plural (the #8862 residue this card was filed on) stops being refused
//      while the manifest-ABSENT six still are. This is what proves §2 is not
//      a restatement of §3, and why the assert is the COMPLETE contract
//      rather than the narrow at-rest predicate.
//   4. `canonicalMetaUrlType` neutered to the
//      identity, spec REBUILT                      predicted RED §1 -> RED, 7 failed
//      ⚠️ BROADER than predicted, and the prediction was the wrong shape:
//      §1 does go red first (its non-vacuity point stands — the hole is a
//      real disagreement between two real maps), but §2/§3 go red with it,
//      because `canonicalMetaType` DELEGATES to `canonicalMetaUrlType`, so
//      neutering the map disables the assert as well. Recorded as observed
//      rather than trimmed to the prediction.
//      (Tests resolve `@objectstack/spec` from its BUILT `dist/`, so this leg
//      required mutate -> rebuild -> prove-in-artifact; the marker comment was
//      stripped by the bundler, so the artifact proof is behavioural:
//      `canonicalMetaUrlType('objects')` returned `'objects'` from `dist/`
//      under the ablation and `'object'` again after the restore.)

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLURAL_TO_SINGULAR, canonicalMetaUrlType } from '@objectstack/spec/shared';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface StoredRow {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

/**
 * The observation channel this file is about: the `type` key every
 * `registerItem` call is made under, in call order.
 */
function makeUnscopedProtocol(rows: StoredRow[]) {
    const registeredItems: Array<{ type: string; name: unknown }> = [];
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown> }) {
            if (table !== 'sys_metadata') return [];
            const where = opts?.where ?? {};
            return rows.filter((r) => Object.entries(where).every(([k, v]) => {
                if (v === undefined) return true;
                return (r as unknown as Record<string, unknown>)[k] === v;
            }));
        },
        async findOne() { return null; },
        // ⛔ No `update` / `delete` / `insert` on this double, deliberately.
        // Both paths under test are READ-then-register — `loadMetaFromDb`
        // issues `find` only, and the direct helper calls touch nothing but
        // `registry` — so declaring write verbs here would add a fake engine
        // whose dispatch contract (`assertEngineUpdateDispatch` /
        // `assertEngineDeleteDispatch`, `check:engine-double-contract`) nothing
        // in this file exercises. An unexercised double is a pin that cannot
        // fail; if a future case needs one, take the shape from
        // `protocol.object-registry-write-through-spelling.test.ts`, which
        // routes both verbs through the asserts.
        registry: {
            registerItem: (type: string, item: any) => {
                registeredItems.push({ type, name: item?.name });
            },
            registerObject: () => undefined,
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
        },
    };
    // `environmentId` UNDEFINED — the unscoped (control-plane) kernel, the only
    // one on which the overlay-hydration limb runs at all.
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), undefined) as any;
    return { protocol, registeredItems };
}

/**
 * A row whose STORED `type` is whatever is asked for. Written straight into
 * the stub's row set rather than through a `/meta` door, because every such
 * door folds before it persists — this is what a row written before #7894's
 * boundary fold looks like at rest, and nothing rewrites it on upgrade.
 */
const storedRow = (type: string, name: string): StoredRow => ({
    id: `r_${type}_${name}`,
    type,
    name,
    organization_id: null,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify({ name, label: 'Legacy residue' }),
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. The fold-map hole that makes routes 5 and 6 reachable
// ═══════════════════════════════════════════════════════════════════════════
//
// This is an EXTERNAL dependency of the verdict — the two maps live in
// `@objectstack/spec` — so it is pinned here rather than assumed. The assert's
// value dies the day these two maps stop disagreeing.

describe('[#9111] the manifest map is tolerant AND incomplete where the URL map is not', () => {
    it('there is a non-empty class of spellings the manifest fold passes through unchanged', () => {
        // The six are FILTERED against the live map rather than asserted as a
        // fixed list: #8908 measured that a hand-written "four types the
        // manifest map omits" ships with two members missing
        // (`externalCatalogs`, `email_templates`) and no way to notice. The
        // filter cannot drift from the map it reads.
        const blind = ['fields', 'seeds', 'external_catalogs', 'externalCatalogs', 'translations', 'email_templates']
            .filter((s) => (PLURAL_TO_SINGULAR[s] ?? s) === s);
        // Every one of these is a spelling the MANIFEST fold leaves alone…
        expect(blind.length).toBeGreaterThan(0);
        for (const spelling of blind) {
            // …while the URL/registry map says it names a DIFFERENT type. That
            // disagreement is the whole reachability argument for routes 5/6.
            expect(canonicalMetaUrlType(spelling), `${spelling} must fold at the URL map`).not.toBe(spelling);
        }
    });

    it('positive control — the manifest map DOES resolve the plurals that were never the hazard', () => {
        // A zero-hit is not a measurement until a known-present neighbour
        // answers. `objects`/`views` fold in BOTH maps, which is exactly why
        // #8862's measurement could conclude "dormant" and still leave this
        // seam open for the six spellings above.
        expect(PLURAL_TO_SINGULAR['objects']).toBe('object');
        expect(PLURAL_TO_SINGULAR['views']).toBe('view');
        expect(canonicalMetaUrlType('objects')).toBe('object');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The mint door refuses a non-canonical type — ADR-0112 envelope
// ═══════════════════════════════════════════════════════════════════════════

describe('[#9111] `hydrateOverlayIntoRegistry` asserts its type is canonical', () => {
    it('refuses a manifest-BLIND plural with code + status, and mints nothing', () => {
        const { protocol, registeredItems } = makeUnscopedProtocol([]);
        let caught: any;
        try {
            protocol.hydrateOverlayIntoRegistry('fields', { name: 'showcase_task.title' }, {
                packageId: null,
                organizationId: null,
            });
        } catch (e) { caught = e; }
        // The ADR-0112 envelope, not merely "it threw": an unfixed producer
        // throwing a bare Error would keep a `toThrow()`-only assertion green.
        expect(caught?.code).toBe('REGISTRY_TYPE_NOT_CANONICAL');
        expect(caught?.status).toBe(500);
        expect(String(caught?.message)).toContain("canonical: 'field'");
        expect(registeredItems).toHaveLength(0);
    });

    it('refuses a manifest-PRESENT plural too — the #8862 residue this card was filed on', () => {
        // `'objects'` folds in both maps, so no producer delivers it today.
        // The assert is the COMPLETE contract rather than the narrow
        // at-rest predicate, so a future unfolded caller is refused whichever
        // plural it holds. Ablation 3 is what keeps this distinct from §3.
        const { protocol, registeredItems } = makeUnscopedProtocol([]);
        expect(() => protocol.hydrateOverlayIntoRegistry('objects', { name: 'ticket' }, {
            packageId: null,
            organizationId: null,
        })).toThrowError(/registry_type_not_canonical/);
        expect(registeredItems).toHaveLength(0);
    });

    it('is judged on the SPELLING, ahead of every no-op return', () => {
        // An org-scoped row returns `false` without registering. The assert
        // still fires: a caller that stopped folding must not be able to hide
        // behind a body this call happened not to register anyway.
        const { protocol } = makeUnscopedProtocol([]);
        expect(() => protocol.hydrateOverlayIntoRegistry('fields', { name: 'x' }, {
            packageId: null,
            organizationId: 'org_alpha',
        })).toThrowError(/registry_type_not_canonical/);
        // …and a body with no `name` at all.
        expect(() => protocol.hydrateOverlayIntoRegistry('fields', { label: 'no name' }, {
            packageId: null,
            organizationId: null,
        })).toThrowError(/registry_type_not_canonical/);
    });

    it('cannot refuse a canonical type or a plugin-registered kind', () => {
        const { protocol, registeredItems } = makeUnscopedProtocol([]);
        // Canonical — registers, as before.
        expect(protocol.hydrateOverlayIntoRegistry('view', { name: 'grid' }, {
            packageId: null, organizationId: null,
        })).toBe(true);
        // A kind the platform has never heard of: `canonicalMetaType` is the
        // identity for anything the static map does not carry, so this gate is
        // positive-control-by-construction and can never fire on a plugin kind.
        expect(protocol.hydrateOverlayIntoRegistry('acme_widget', { name: 'w' }, {
            packageId: null, organizationId: null,
        })).toBe(true);
        expect(registeredItems.map((r) => r.type)).toEqual(['view', 'acme_widget']);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Route 6 (boot) end to end — the unguarded producer, driven
// ═══════════════════════════════════════════════════════════════════════════

describe('[#9111] boot hydration over pre-#7894 at-rest residue', () => {
    it('positive control — a manifest-present plural still hydrates under the singular', async () => {
        // `loadMetaFromDb`'s own comment promises "DB may store legacy plural
        // forms" are normalized. For `views` the manifest map delivers that.
        const { protocol, registeredItems } = makeUnscopedProtocol([storedRow('views', 'shared_grid')]);
        const result = await protocol.loadMetaFromDb();
        expect(registeredItems.map((x) => x.type)).toEqual(['view']);
        expect(result.errors).toBe(0);
        expect(result.loaded).toBe(1);
    });

    it('a manifest-BLIND stored plural is refused loudly instead of minting a shadow namespace', async () => {
        const { protocol, registeredItems } = makeUnscopedProtocol([storedRow('fields', 'showcase_task.title')]);
        const result = await protocol.loadMetaFromDb();
        // Pre-fix this registered under `'fields'` — a second registry
        // namespace no canonical read, listing or declaration lookup reaches.
        expect(registeredItems).toHaveLength(0);
        // Loud and RECOVERABLE: boot counts it and continues. Refusing the row
        // registers nothing, which was already the honest outcome — a
        // `'fields'` entry serves no reader.
        expect(result.errors).toBe(1);
        expect(result.loaded).toBe(0);
        expect(result.storeUnavailable).toBe(false);
    });

    it('one bad row does not stop the rows around it', async () => {
        const { protocol, registeredItems } = makeUnscopedProtocol([
            storedRow('views', 'good_one'),
            storedRow('translations', 'legacy_bundle'),
            storedRow('view', 'good_two'),
        ]);
        const result = await protocol.loadMetaFromDb();
        expect(registeredItems.map((x) => x.type)).toEqual(['view', 'view']);
        expect(result.errors).toBe(1);
        expect(result.loaded).toBe(2);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The caller set stays closed
// ═══════════════════════════════════════════════════════════════════════════
//
// The assert makes an unfolded caller LOUD; it does not make one correct.
// Folding at the producer stays the rule, so a new caller still owes the trace
// in this file's header a re-read.

describe('[#9111] the `hydrateOverlayIntoRegistry` caller set stays closed', () => {
    const source = readFileSync(
        fileURLToPath(new URL('./protocol.ts', import.meta.url)),
        'utf8',
    );

    it('has exactly three call sites, all traced in this file’s header', () => {
        const callSites = source.match(/this\.hydrateOverlayIntoRegistry\(/g) ?? [];
        expect(callSites).toHaveLength(3);
    });

    it('the assert is present and reads the URL map, not the manifest map', () => {
        // #9161's precedent: `canonicalMetaType` (complete) over
        // `PLURAL_TO_SINGULAR` (tolerant AND incomplete). Pinned positively so
        // a "simplification" to the manifest map fails here rather than
        // silently re-opening the six spellings section 1 measures.
        expect(source).toContain("err.code = 'REGISTRY_TYPE_NOT_CANONICAL';");
        expect(source).toMatch(/const canonicalType = canonicalMetaType\(type\);/);
    });
});
