// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10886 — the face inventory for `saveMetaItem`'s Phase 3a-destructive
 * `409 DESTRUCTIVE_CHANGE`, and the pins that hold its conclusion.
 *
 * ## The duplication that raised the card
 *
 * The refusal renders its own findings into the message
 * (`issues.slice(0, 3).map((i) => i.message).join('; ')` plus a `(+N more)`
 * tail) AND attaches the same array as `err.issues`. A console that renders
 * both channels shows every finding twice — the render-then-attach shape
 * #10524 trimmed on the publish refusals.
 *
 * ## The conclusion: DO NOT TRIM. The message is a SOLE CARRIER.
 *
 * #10524 established the order — **declare a structured channel on every face
 * that quotes the message, and only then trim the message**. This file is the
 * measurement that says the first half is not done here, so the second half
 * must not happen. It is the same verdict, reached the same way, as the
 * sibling `INVALID_METADATA` message one gate down (which was trial-trimmed
 * during #10524 and REVERTED).
 *
 * ## The inventory, and how it was enumerated
 *
 * The 409 is raised in ONE place ({@link ObjectStackProtocolImplementation.saveMetaItem},
 * Phase 3a-destructive). A *face* is therefore any place a caller's catch puts
 * the thrown value's `.message` onto a response. So the enumeration is: every
 * caller of `saveMetaItem` in the repo, then — for each — can it reach the
 * gate at all, and if so what does its catch emit.
 *
 * The gate fires only when ALL of: `!request.force`, the folded type is
 * `object` or `field`, an item already exists under the target name, and the
 * diff is non-empty. That predicate is what eliminates four of the seven.
 *
 * | # | caller | type | `force` | reaches gate | face | `issues` structurally |
 * |:--|:--|:--|:--|:--|:--|:--|
 * | 1 | `@objectstack/rest` `PUT /meta/:type/:name`   | any     | `?force` | **yes** | `handleRouteError` 409 body | **yes** — top-level `issues` |
 * | 2 | `@objectstack/rest` `PUT /meta/:type/:a/:b`   | any     | never    | **yes** | the same `handleRouteError` body | **yes** (same face as #1) |
 * | 3 | `@objectstack/runtime` dispatcher `PUT /meta` | any     | never    | **yes** | `errorFromThrown` → `details.issues` | **yes** |
 * | 4 | `@objectstack/runtime` ADR-0045 visibility flip | `'app'` | no     | no — type | (`unhideError`) | n/a |
 * | 5 | `migrateStoredMetadata` (this file's protocol) | any    | **true** | no — `force` | (`rows[].reason`) | n/a |
 * | 6 | {@link ObjectStackProtocolImplementation.duplicatePackage} | `row.type` incl. `object` | no | **yes** | `failed[].error` on a **200** | ⛔ **NO — sole carrier** |
 * | 7 | `plugin-security` permission-set projection ×4 | `'permission'` | no | no — type | n/a | n/a |
 *
 * Rows 1-3 and 6 are pinned below. Rows 4, 5 and 7 are eliminated by a
 * constant in the call itself (a literal `type`, or `force: true`), which is
 * why they are argued rather than pinned: there is no runtime state that could
 * make them reach the gate.
 *
 * ## Why row 6 is the one that forbids the trim
 *
 * `duplicatePackage` reports a per-item failure as **response DATA on a 200**
 * (`POST /packages/:id/duplicate`), so no HTTP boundary is involved and
 * `details.issues` never exists. And unlike `publishPackageDrafts` — whose
 * `failed[]` #10895 could extend because `PublishPackageDraftsResponseSchema`
 * exists — `duplicatePackage` has **no response schema in `packages/spec` at
 * all**; its `failed[]` is typed inline as
 * `Array<{ type: string; name: string; error: string }>` and the push adds no
 * `issues` key. Declaring a structured channel there is a `packages/spec`
 * change and is deliberately NOT part of this card.
 *
 * ⚠️ Row 6's reachability was MEASURED, not argued, and the obvious first
 * attempt says the wrong thing: a plain duplicate re-namespaces every object
 * (`com.acme.crm` → `com.acme.crm2` maps `crm_task` → `crm2_task`), so the
 * target name usually does not exist yet, `prev` is null, and the gate is
 * skipped — the copy fails the author-time gate instead. The gate is reached
 * on the ordinary *duplicate-again* workflow, where the target namespace
 * already holds the renamed object. That is the case pinned below.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Predicted with the message trimmed to a headline (the trim this card
 * declines): section 3's two prose assertions go RED, because the per-field
 * prose has no other channel on that face; sections 1 and 2 stay GREEN,
 * because the structured channel is untouched by a message trim. Measured:
 * exactly that. See the PR body for the run.
 *
 * The tests import `./protocol.js` — a RELATIVE source specifier — so vitest
 * resolves the subject to `src/protocol.ts` and no `dist/` is on the path;
 * the ablation therefore needs no rebuild, and its RED result is what rules
 * out the stale-artifact false green.
 *
 * ⛔ Never a bare `toThrow()` here. `duplicatePackage` does not throw, it
 * REPORTS, and what the report says IS the defect; and for the throw itself
 * the minimum assertion is `code` + `status` (ADR-0112 envelope), with the
 * message text asserted on top because the message text is the contract this
 * file exists to protect.
 */
import { describe, expect, it } from 'vitest';
// The ONE rule both HTTP doors read (`@objectstack/types`). Asserting against
// the shared resolver rather than re-implementing either door is what makes
// rows 1-3 of the inventory one measurement instead of three guesses.
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from './protocol.js';

// ---------------------------------------------------------------------------
// Harness — the `sys_metadata`-backed kernel the #8333 batch-verb suite uses,
// minus its fault injection (nothing here is about driver text).
// ---------------------------------------------------------------------------

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum: string;
    version?: number;
}

const PKG = 'com.acme.crm';
const TARGET_PKG = 'com.acme.crm2';

const row = (o: Partial<Row> & { type: string; name: string }): Row => ({
    id: `row_${o.type}_${o.name}_${o.state ?? 'active'}`,
    organization_id: null,
    package_id: PKG,
    state: 'active',
    metadata: JSON.stringify({ name: o.name, label: 'seeded' }),
    checksum: 'sha256_10886_fixture',
    version: 1,
    ...o,
});

/** An `object` body with the given fields — the only type the gate can act on. */
const objectRow = (name: string, fields: readonly string[], pkg = PKG): Row => row({
    type: 'object',
    name,
    package_id: pkg,
    metadata: JSON.stringify({
        name,
        label: name,
        fields: Object.fromEntries(fields.map((f) => [f, { name: f, type: 'text' }])),
    }),
});

function makeKernel(opts: { seed?: Row[] } = {}) {
    const rows = new Map<string, Row>();
    for (const r of opts.seed ?? []) rows.set(r.id, r);

    const match = (r: Row, where: Record<string, unknown>): boolean =>
        Object.entries(where ?? {}).every(([k, v]) => {
            if (k === '$or') return (v as Array<Record<string, unknown>>).some((c) => match(r, c));
            return v === null || v === undefined
                ? (r as any)[k] === null || (r as any)[k] === undefined
                : (r as any)[k] === v;
        });

    const engine: any = {
        async find(table: string, o?: { where?: Record<string, unknown> }) {
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values()).filter((r) => match(r, o?.where ?? {}));
        },
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            if (table !== 'sys_metadata') return null;
            for (const r of rows.values()) if (match(r, o?.where ?? {})) return r;
            return null;
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata') {
                const r = { ...(data as any) } as Row;
                r.id = String(data.id ?? `r_${rows.size}`);
                rows.set(r.id, r);
            }
            return { id: String(data.id ?? 'r_new') };
        },
        // ⚠️ NO `update` / `delete` on this double, deliberately. Every case in
        // this file drives a REFUSAL — the save is rejected at the Phase
        // 3a-destructive gate before anything is persisted — so the write
        // verbs are never called, and a double that implements a verb its
        // subject never reaches is dead code that also has to be pinned.
        // ⛔ Adding a case here that actually PERSISTS means adding those two
        // verbs back, and they must then route through
        // `assertEngineUpdateDispatch` / `assertEngineDeleteDispatch`
        // (`@objectstack/metadata-core`, #5480 / #4550) so this double cannot
        // accept a call `ObjectQL` itself refuses. Never hand-mirror those
        // checks — `check:engine-double-contract` exists for exactly that.
        registry: {
            registerItem: () => {}, registerObject: () => {}, listItems: () => [],
            getItem: () => undefined, getArtifactItem: () => undefined,
            removeRuntimeShadow: () => false, removeOverlayEntry: () => {}, uninstallPackage: () => {},
        },
    };

    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, engine, rows };
}

/** The refusal this whole file is about, raised by the real producer. */
async function destructiveRefusal(): Promise<any> {
    const { protocol } = makeKernel({
        seed: [objectRow('crm_task', ['a', 'b', 'c', 'd'])],
    });
    try {
        await protocol.saveMetaItem({
            type: 'object',
            name: 'crm_task',
            item: { name: 'crm_task', label: 'crm_task', fields: { a: { name: 'a', type: 'text' } } },
        });
    } catch (e: any) {
        return e;
    }
    throw new Error('expected saveMetaItem to refuse the destructive change');
}

/** The remedy sentence that must survive ANY future trim (#10886 non-effect). */
const REMEDY = 're-submit with ?force=true to proceed.';
/** One finding's prose, as `detectDestructiveObjectChanges` words it. */
const FINDING_PROSE = "Field 'b' removed — existing data in this column will become inaccessible.";

// ═══════════════════════════════════════════════════════════════════════════
// 1. The duplication is real — both channels carry the same findings
// ═══════════════════════════════════════════════════════════════════════════

describe('[#10886] the 409 renders its findings into the message AND attaches them', () => {
    it('declares the ADR-0112 envelope and attaches the structured findings', async () => {
        const err = await destructiveRefusal();

        // Minimum assertion set for a refusal: code + status, never a bare throw.
        expect(err.code).toBe('DESTRUCTIVE_CHANGE');
        expect(err.status).toBe(409);
        expect(err.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'field_removed', field: 'b', message: FINDING_PROSE }),
        ]));
    });

    it('the message restates the SAME prose the `issues` array carries', async () => {
        const err = await destructiveRefusal();

        // This is the duplication itself. A console rendering both channels
        // shows this sentence twice.
        expect(err.message).toContain(FINDING_PROSE);
        expect(err.issues.map((i: { message: string }) => i.message)).toContain(FINDING_PROSE);
    });

    it('[GUARD] the message ends with the actionable remedy — no structural channel carries it', async () => {
        const err = await destructiveRefusal();

        // ⭐ The expected NON-effect of any future trim. Unlike a validation
        // refusal, this is a risk-ACKNOWLEDGEMENT flow: the remedy is the
        // whole point, it is not one of the `issues`, and nothing else on any
        // face carries it.
        expect(err.message).toContain(REMEDY);
        const wire = JSON.stringify(err.issues);
        expect(wire).not.toContain('force=true');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Inventory rows 1-3 — the HTTP faces DO carry `issues` structurally
// ═══════════════════════════════════════════════════════════════════════════

describe('[#10886] the HTTP doors are not sole carriers — `issues` reaches them structurally', () => {
    it('the shared boundary resolver threads `issues` into `details`', async () => {
        const err = await destructiveRefusal();

        // Rows 1-3 of the inventory all resolve through this one function:
        // `@objectstack/rest`'s `handleRouteError` reads `error.issues` onto a
        // top-level `issues`, and the dispatcher's `errorFromThrown` puts
        // `thrown.details` on the envelope. Either way the findings survive a
        // message trim — which is exactly why those faces do NOT block one.
        const thrown = resolveThrownHttpError(err, 400);

        expect(thrown.status).toBe(409);
        expect(thrown.code).toBe('DESTRUCTIVE_CHANGE');
        expect(thrown.details?.issues).toEqual(err.issues);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. [GUARD] Inventory row 6 — the SOLE CARRIER. ⛔ This is what forbids the trim.
// ═══════════════════════════════════════════════════════════════════════════

describe('[#10886] [GUARD] `duplicatePackage`’s `failed[].error` is the SOLE carrier of the destructive prescription', () => {
    /**
     * The reachability case. Source package `com.acme.crm` (namespace `crm`)
     * holds `crm_task` with one field; the target namespace `crm2` ALREADY
     * holds `crm2_task` with four — the state left by an earlier duplicate.
     * The copy would drop three columns, so the gate fires on the copy.
     */
    const duplicateIntoOccupiedNamespace = () => makeKernel({
        seed: [
            objectRow('crm_task', ['a']),
            objectRow('crm2_task', ['a', 'b', 'c', 'd'], TARGET_PKG),
        ],
    });

    it('reaches the gate at all — the copy is refused with the destructive change', async () => {
        const { protocol } = duplicateIntoOccupiedNamespace();

        const r = await protocol.duplicatePackage({
            sourcePackageId: PKG, targetPackageId: TARGET_PKG,
        });

        expect(r.failedCount).toBe(1);
        expect(r.failed[0]).toMatchObject({ type: 'object', name: 'crm_task' });
        expect(r.failed[0].error).toContain('[destructive_change]');
    });

    it('⛔ carries the per-field prose with NO structured channel beside it', async () => {
        const { protocol } = duplicateIntoOccupiedNamespace();

        const r = await protocol.duplicatePackage({
            sourcePackageId: PKG, targetPackageId: TARGET_PKG,
        });
        const entry = r.failed[0];

        // The prose reaches the caller ONLY through this string …
        expect(entry.error).toContain(FINDING_PROSE);
        // … and there is no `issues` beside it. Not "an empty array" — the key
        // is absent, and the array's own type has no slot for it. Trimming the
        // message would delete these findings from the wire outright.
        expect('issues' in entry).toBe(false);
        expect(entry.issues).toBeUndefined();
    });

    it('⛔ carries the `?force=true` remedy, on a response with no other channel for it', async () => {
        const { protocol } = duplicateIntoOccupiedNamespace();

        const r = await protocol.duplicatePackage({
            sourcePackageId: PKG, targetPackageId: TARGET_PKG,
        });

        expect(r.failed[0].error).toContain(REMEDY);
        // The whole response, not just the entry: nothing anywhere else on it
        // states the remedy or the findings.
        const wire = JSON.stringify({ ...r, failed: r.failed.map((f: any) => ({ ...f, error: '' })) });
        expect(wire).not.toContain('force=true');
        expect(wire).not.toContain('inaccessible');
    });
});
