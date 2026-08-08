// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the bulk-write hook dispatch contract (ADR-0058 Addendum II, #6462).
 *
 * These assertions are over the CONTRACT, not over an engine dispatch — spec
 * cannot execute one, and must not depend on objectql to try. The engine-side
 * half of the same table is pinned against a real dispatch by
 * `packages/objectql/src/hook-input-shape-contract.test.ts`; the two meet at
 * the event names and the per-row context keys, which is what "same yardstick
 * as the after side" means in practice.
 *
 * The load-bearing case here is `delivered`. Two entries are false today
 * because the ruling ordered a contract-first split, and a contract that says
 * "not yet" has exactly one way to stay honest: a pin that goes RED the moment
 * the engine catches up, so the flag is flipped in the same PR that earns it
 * rather than years later by someone re-reading this file. That is deliberately
 * the inverse of a normal pin — it is asserting an absence, and it is supposed
 * to fail one day.
 */
import { describe, expect, it } from 'vitest';

import {
    BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE,
    BULK_WRITE_HOOK_DISPATCH_CONTRACT,
    MAX_BULK_PER_ROW_HOOK_ROWS,
    resolveBulkPerRowHookBudget,
} from './bulk-write-hook-conformance';
import { HookEvent } from './hook.zod';

const byEvent = (event: string) => {
    const entry = BULK_WRITE_HOOK_DISPATCH_CONTRACT.find((e) => e.event === event);
    if (!entry) throw new Error(`no contract entry for ${event}`);
    return entry;
};

describe('bulk-write hook dispatch contract — the table', () => {
    it('covers exactly the four write events a predicate write can dispatch', () => {
        // Cross-checked against `HookEvent` rather than hardcoded twice: a new
        // write event added to the vocabulary without a row here would be a
        // silent hole in the contract, which is the #5273 shape (a table and a
        // producer that stopped agreeing) pointed the other way.
        const writeEvents = HookEvent.options.filter(
            (e) => /^(before|after)(Update|Delete)$/.test(e),
        );
        expect([...writeEvents].sort()).toEqual(
            BULK_WRITE_HOOK_DISPATCH_CONTRACT.map((e) => e.event).sort(),
        );
        // Insert is deliberately absent: `insertMany` carries N payloads, so
        // batch insert has dispatched one context per row since #2922 and was
        // never part of the bulk-write question.
        expect(BULK_WRITE_HOOK_DISPATCH_CONTRACT.map((e) => e.event)).not.toContain('beforeInsert');
    });

    it('binds a per-row `previous` on every entry — in BOTH phases (D1/D2)', () => {
        // The whole ruling in one assertion. The measured harm on #5574 was a
        // guard hook reading `previous?.x` on a bulk write, where `previous`
        // was permanently undefined, so the guard passed silently and a
        // readonly field could be nulled across a batch.
        for (const entry of BULK_WRITE_HOOK_DISPATCH_CONTRACT) {
            expect(entry.contextKeys).toContain('previous');
            expect(entry.contextKeys).toContain('id');
            expect(entry.contextKeys).toContain('options');
        }
    });

    it('gives `result` to the after phase only (D2)', () => {
        for (const entry of BULK_WRITE_HOOK_DISPATCH_CONTRACT) {
            expect(entry.contextKeys.includes('result')).toBe(
                entry.phase === 'after' && entry.event === 'afterUpdate',
            );
        }
        // A bulk DELETE has no post-state, so its per-row context sets no
        // `result` and consumers fall back to `previous` — Addendum I's wording,
        // unchanged by Addendum II.
        expect(byEvent('afterDelete').contextKeys).not.toContain('result');
    });

    it('scopes the update payload to the BATCH and gives delete none (D3)', () => {
        expect(byEvent('beforeUpdate').payloadScope).toBe('batch');
        expect(byEvent('afterUpdate').payloadScope).toBe('batch');
        expect(byEvent('beforeDelete').payloadScope).toBe('none');
        expect(byEvent('afterDelete').payloadScope).toBe('none');

        // The merge rule, stated as the absence of a merge: no entry declares a
        // per-row payload, so N post-hook payloads cannot diverge, nothing is
        // reconciled and no predicate write is ever split into N single-row
        // writes. One `updateMany`, one affected count (#4639).
        const scopes = new Set(BULK_WRITE_HOOK_DISPATCH_CONTRACT.map((e) => e.payloadScope));
        expect([...scopes].sort()).toEqual(['batch', 'none']);

        // And the payload key rides exactly the entries that have one.
        for (const entry of BULK_WRITE_HOOK_DISPATCH_CONTRACT) {
            expect(entry.contextKeys.includes('data')).toBe(entry.payloadScope === 'batch');
        }
    });

    it('holds the before and after halves to the same shape (the "same yardstick" test)', () => {
        // Per event kind, the before entry's keys must be the after entry's
        // minus `result` — which is the equivalence D5 declares, expressed over
        // the table instead of over prose.
        for (const kind of ['Update', 'Delete'] as const) {
            const before = byEvent(`before${kind}`);
            const after = byEvent(`after${kind}`);
            expect([...before.contextKeys].sort()).toEqual(
                [...after.contextKeys].filter((k) => k !== 'result').sort(),
            );
            expect(before.payloadScope).toBe(after.payloadScope);
        }
    });
});

describe('bulk-write hook dispatch contract — delivery status', () => {
    it('records the after half as DELIVERED by #5038', () => {
        expect(byEvent('afterUpdate')).toMatchObject({ delivered: true, engineDeliveryIssue: 5038 });
        expect(byEvent('afterDelete')).toMatchObject({ delivered: true, engineDeliveryIssue: 5038 });
    });

    it('records the before half as DELIVERED by #5574\'s engine half', () => {
        // ⚠️ This case was written to go red exactly once, and it did. Until
        // #5574's engine half it read "CONTRACTED but not yet delivered" and
        // asserted `delivered: false` on both `before*` entries — the honest
        // face of a contract-first split. The engine landed per-row `before*`
        // dispatch, so the flags flipped and this expectation flipped with
        // them, in that same PR, alongside `hook.zod.ts`'s
        // `HookContextSchema.input` shape table (which describes the engine as
        // built and is pinned against a real dispatch in objectql).
        expect(byEvent('beforeUpdate')).toMatchObject({ delivered: true, engineDeliveryIssue: 5574 });
        expect(byEvent('beforeDelete')).toMatchObject({ delivered: true, engineDeliveryIssue: 5574 });
    });

    it('has NOTHING undelivered — the contract-first split is closed', () => {
        // The pin that replaces the inverted one above. It is the direction
        // that keeps mattering: a clause added to this table later with
        // `delivered: false` and no engine behind it fails here immediately,
        // instead of standing unnoticed the way #5273's three keys did.
        const undelivered = BULK_WRITE_HOOK_DISPATCH_CONTRACT.filter((e) => !e.delivered);
        expect(undelivered.map((e) => e.event)).toEqual([]);
        expect(BULK_WRITE_HOOK_DISPATCH_CONTRACT.every((e) => e.delivered)).toBe(true);
    });
});

describe('bulk-write per-row hook budget (D6)', () => {
    it('carries the ceiling objectql enforces today', () => {
        // Receipt: `ObjectQL.MAX_BULK_PER_ROW_HOOK_ROWS` (`engine.ts`) is a
        // RE-EXPORT of this constant since #5574's engine half, and
        // `assertBulkPerRowHookBudget` raises what `resolveBulkPerRowHookBudget`
        // decides — so there is one definition and nothing left to keep in
        // step. The number is still pinned because it is a contract an
        // operator reads out of a rejection message, not an implementation
        // detail free to drift.
        expect(MAX_BULK_PER_ROW_HOOK_ROWS).toBe(10_000);
    });

    it('admits a batch AT the ceiling and refuses one over it', () => {
        const at = resolveBulkPerRowHookBudget({
            object: 'task', event: 'beforeUpdate', matched: MAX_BULK_PER_ROW_HOOK_ROWS,
        });
        expect(at.kind).toBe('ok');

        const over = resolveBulkPerRowHookBudget({
            object: 'task', event: 'beforeUpdate', matched: MAX_BULK_PER_ROW_HOOK_ROWS + 1,
        });
        expect(over.kind).toBe('refused');
    });

    it('admits an empty match set — zero rows is zero dispatches, not a refusal (D1)', () => {
        expect(resolveBulkPerRowHookBudget({ object: 'task', event: 'beforeUpdate', matched: 0 }).kind)
            .toBe('ok');
    });

    it('applies the SAME ceiling to both phases (D6)', () => {
        const matched = MAX_BULK_PER_ROW_HOOK_ROWS + 1;
        for (const event of BULK_WRITE_HOOK_DISPATCH_CONTRACT.map((e) => e.event)) {
            const verdict = resolveBulkPerRowHookBudget({ object: 'task', event, matched });
            expect(verdict.kind).toBe('refused');
            if (verdict.kind !== 'refused') throw new Error('unreachable');
            expect(verdict.limit).toBe(MAX_BULK_PER_ROW_HOOK_ROWS);
        }
    });

    it('refuses TOTALLY, and says so — never a downgrade to one dispatch', () => {
        const verdict = resolveBulkPerRowHookBudget({
            object: 'task', event: 'beforeUpdate', matched: 12_345,
        });
        if (verdict.kind !== 'refused') throw new Error('expected a refusal');
        expect(verdict.code).toBe(BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE);
        expect(verdict.object).toBe('task');
        expect(verdict.event).toBe('beforeUpdate');
        expect(verdict.matched).toBe(12_345);
        // The three facts an operator needs, pinned because a message that
        // stops saying "nothing was written" turns a refusal into a mystery.
        expect(verdict.message).toContain('Nothing was written');
        expect(verdict.message).toContain('NOT silently downgraded');
        expect(verdict.message).toContain('12345 rows');
        expect(verdict.message).toContain('10000-row ceiling');
        // Both routes out, named.
        expect(verdict.message).toContain('Narrow the predicate');
        expect(verdict.message).toContain('remove the');
    });

    it('is pure — same input, same verdict, no clock', () => {
        const args = { object: 'task', event: 'afterUpdate', matched: 20_000 } as const;
        expect(resolveBulkPerRowHookBudget(args)).toEqual(resolveBulkPerRowHookBudget(args));
    });

    it('never mints an ADR-0112 wire code', () => {
        // The refusal travels on the thrown error's own property bag. Naming it
        // a `StandardErrorCode` member would put an unregistered code on the
        // REST envelope by side effect — the failure the closed vocabulary
        // exists to prevent.
        expect(BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE).toMatch(/^ERR_/);
    });
});
