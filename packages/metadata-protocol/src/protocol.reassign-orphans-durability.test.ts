// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12981 batch 7] A refused orphan rebind in `reassignOrphanedMetadata` must
 * not be silent.
 *
 * ADR-0070 D5's adoption loop walked every package-less `sys_metadata` row and
 * rebound it to a target base. Its `catch` was bare:
 *
 *     } catch {
 *         /* skip a row that fails to update; report only what moved *\/
 *     }
 *
 * and the return line below it reports `success: reassigned.length > 0`. Put
 * together, an adoption in which 99 of 100 orphans were REFUSED answered
 * `{ success: true, reassignedCount: 1 }` — a response byte-identical in shape
 * to a healthy run that had exactly one orphan to move. The 99 stayed orphans,
 * nothing retried them, and no line anywhere recorded that they had been tried.
 * That is the AGENTS.md durability shape exactly: the system keeps looking
 * normal while something it claims to have persisted did not land.
 *
 * ## What this file pins, and what it deliberately does NOT
 *
 * ONLY the silence changes. The loop must still skip the refused row and adopt
 * the rest — aborting the adoption over one unwritable row would strand the
 * rows that CAN move — and the response shape is untouched, because adding a
 * `failedCount` is a contract change this card does not carry. Both halves are
 * asserted below rather than assumed.
 *
 * ## The level, stated so it can be argued with
 *
 * `console.error`, not `console.warn`, and not by default: `console.warn` is
 * this file's overwhelming idiom (51 sites) and `clientFacingRowFailureText`
 * records the discriminator in prose — it chose `warn` "deliberately — nothing
 * claimed to be persisted was silently dropped (the row reports
 * `success: false` and the counters reconcile)". Here NEITHER holds. The
 * matching precedent is in this same file: `recordPackageCommit` already
 * answers `console.error` for a refused `sys_metadata_commit` write under a
 * publish that reports success.
 *
 * ## ONE line, not one per row
 *
 * AGENTS.md → "Degradation log levels" requires the report be stated once, at
 * the first occurrence, not once per failed write — and a `sys_metadata` write
 * that is refused is refused for every row, so the per-row spelling would print
 * one line per orphan in the environment. The count is pinned, not just the
 * presence.
 *
 * ⚠️ Two cases below are CONTROLS, not pins: they assert an ABSENCE against a
 * seam that logged nothing at all before this repair, so they stay green in
 * both directions by construction and are not evidence in an ablation.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decision, so this double
// cannot accept an `update` shape ObjectQL refuses. From
// `@objectstack/metadata-core` and NOT `@objectstack/objectql` — objectql
// depends on THIS package, so that import would close a cycle turbo rejects.
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface MetaRow {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
}

/**
 * Engine double over `sys_metadata` with a per-id refusal injector on `update`.
 *
 * The injection is keyed by ROW ID rather than being a global switch, because
 * the defect's dangerous case is the PARTIAL one: an adoption where some rows
 * move and some do not is the run that answers `success: true` while leaving
 * orphans behind. A double that could only fail everything could not express
 * it.
 */
function makeEngine(rows: MetaRow[]) {
    const store = new Map(rows.map((r) => [r.id, { ...r }]));
    const refuse = new Set<string>();
    let updateAttempts = 0;

    const engine = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            // This double implements NEITHER a `where` combinator NOR a bound,
            // and REFUSES both rather than answering them silently. Every case
            // in this file adopts env-wide orphans, so the producer passes
            // `{ where: {} }` and no `limit`; the org-scoped `$or` branch and
            // paging belong to tests that do not exist yet. A double looser
            // than the engine it stands in for converts a green suite into no
            // suite at all (#4434) — and the reason to refuse rather than
            // approximate is that the approximation is invisible on the day the
            // producer starts using the shape.
            const where = opts?.where ?? {};
            if (Object.keys(where).length > 0) {
                throw new Error(`fake engine: unsupported where ${JSON.stringify(where)}`);
            }
            if (opts?.limit !== undefined) {
                throw new Error('fake engine: unsupported `limit` — this double holds no bound');
            }
            return [...store.values()];
        },
        async update(_table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            updateAttempts += 1;
            const id = String(opts.where.id);
            if (refuse.has(id)) throw new Error(`write refused for ${id}: permission denied on sys_metadata`);
            const row = store.get(id);
            if (!row) return { id: null };
            Object.assign(row, data);
            return { id };
        },
    };

    return {
        engine,
        store,
        refuseIds: (...ids: string[]) => ids.forEach((i) => refuse.add(i)),
        updateAttempts: () => updateAttempts,
    };
}

const orphan = (id: string): MetaRow => ({
    id,
    type: 'object',
    name: `obj_${id}`,
    organization_id: null,
    package_id: null,
});

/** The one sentence fragment an operator greps for. */
const HEADLINE = 'orphaned metadata row(s) were NOT rebound';

afterEach(() => {
    vi.restoreAllMocks();
});

function spyConsole() {
    return {
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    };
}

describe('reassignOrphanedMetadata: a refused rebind is reported (#12981)', () => {
    // ⚠️ CONTROL, not a pin. Before the repair this seam logged nothing at any
    // level, so "a healthy adoption says nothing" was already true — it stays
    // green in BOTH directions and is not ablation evidence. It is here so the
    // pins below cannot pass on a seam that reports unconditionally.
    it('CONTROL: an adoption in which every row rebinds reports nothing', async () => {
        const spy = spyConsole();
        const stub = makeEngine([orphan('a'), orphan('b')]);
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);

        const res = await protocol.reassignOrphanedMetadata({ targetPackageId: 'app.base' });

        expect(res.reassignedCount).toBe(2);
        expect(res.success).toBe(true);
        expect(stub.updateAttempts()).toBe(2);
        expect(spy.error).not.toHaveBeenCalled();
        expect(spy.warn).not.toHaveBeenCalled();
    });

    it('reports a PARTIAL adoption — the run that still answers success: true', async () => {
        const spy = spyConsole();
        const stub = makeEngine([orphan('a'), orphan('b'), orphan('c')]);
        stub.refuseIds('b', 'c');
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);

        const res = await protocol.reassignOrphanedMetadata({ targetPackageId: 'app.base' });

        // Proof the writes were really attempted and really threw — otherwise
        // every assertion below is about an adoption that never reached the seam.
        expect(stub.updateAttempts()).toBe(3);
        expect(stub.store.get('b')!.package_id).toBeNull();
        expect(stub.store.get('c')!.package_id).toBeNull();

        // ⛔ The response is UNCHANGED: this is the shape that reads healthy.
        expect(res.success).toBe(true);
        expect(res.reassignedCount).toBe(1);
        expect(res.reassigned).toEqual([{ type: 'object', name: 'obj_a' }]);

        // …and it is no longer the only thing that happened.
        expect(spy.error).toHaveBeenCalledTimes(1);
        const line = String(spy.error.mock.calls[0][0]);
        expect(line).toContain(HEADLINE);
        expect(line).toContain('2 of 3');
        expect(line).toContain('app.base');
        // The consequence and the fix, which AGENTS.md requires of this level.
        expect(line).toContain('STILL orphans');
        expect(line).toContain('Fix: restore write access');
        // The driver's own sentence, so the operator is not left guessing why.
        expect(line).toContain('permission denied on sys_metadata');
    });

    it('reports a TOTAL refusal, where the response already says success: false', async () => {
        const spy = spyConsole();
        const stub = makeEngine([orphan('a'), orphan('b')]);
        stub.refuseIds('a', 'b');
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);

        const res = await protocol.reassignOrphanedMetadata({ targetPackageId: 'app.base' });

        expect(res.success).toBe(false);
        expect(res.reassignedCount).toBe(0);
        expect(spy.error).toHaveBeenCalledTimes(1);
        expect(String(spy.error.mock.calls[0][0])).toContain('2 of 2');
    });

    it('states the degradation ONCE, not once per refused row', async () => {
        const spy = spyConsole();
        const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
        const stub = makeEngine(ids.map(orphan));
        stub.refuseIds(...ids);
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);

        await protocol.reassignOrphanedMetadata({ targetPackageId: 'app.base' });

        // Six refused writes, ONE operator-facing line — AGENTS.md's "say it
        // once, at the first degradation, not once per failed write".
        expect(stub.updateAttempts()).toBe(6);
        expect(spy.error).toHaveBeenCalledTimes(1);
        expect(String(spy.error.mock.calls[0][0])).toContain('6 of 6');
    });

    // ⚠️ CONTROL, not a pin — an INVARIANCE assertion. The pre-repair code
    // returns exactly this too, so it stays green in both directions. It is
    // here because the repair would be wrong if it changed control flow.
    it('CONTROL: a refused row does not abort the rows that can still move', async () => {
        spyConsole();
        const stub = makeEngine([orphan('a'), orphan('b'), orphan('c')]);
        stub.refuseIds('a');
        const protocol = new ObjectStackProtocolImplementation(stub.engine as never);

        const res = await protocol.reassignOrphanedMetadata({ targetPackageId: 'app.base' });

        expect(res.reassignedCount).toBe(2);
        expect(stub.store.get('b')!.package_id).toBe('app.base');
        expect(stub.store.get('c')!.package_id).toBe('app.base');
        // The response shape is untouched: no `failedCount` was added.
        expect(Object.keys(res).sort()).toEqual(
            ['reassigned', 'reassignedCount', 'success', 'targetPackageId'].sort(),
        );
    });
});
