// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13576] `If-Match: ""` — a valid RFC-7232 entity-tag with an EMPTY opaque
 * value — is refused `400 VALIDATION_FAILED` at ingress, instead of being
 * read as "no token supplied" and silently skipping the OCC guard.
 *
 * ## The defect this closes
 *
 * `normaliseVersionToken` strips RFC-7232 quotes off an `If-Match` value and
 * THEN checks emptiness — so `'""'` (non-empty, 2 chars) passes every
 * upstream truthiness check (the REST layer's `expectedVersion ? … : …`)
 * only to normalise to the empty string `''` one layer down, which every
 * caller's OWN falsiness test (`if (!expected) return`) reads as "the client
 * sent no version" — the OPPOSITE of what `If-Match` requests. It is the one
 * token shape that opts OUT of the guard rather than failing it: a garbage
 * token (`v2`) still normalises to a real, comparable token and fails toward
 * `409 CONCURRENT_UPDATE` — the safe direction for a concurrency primitive.
 *
 * ## The ruling (决裁批 #20 ①, maintainer, 2026-08-31) — option 3, verbatim
 *
 * `If-Match: ""` (header) and `expectedVersion: '""'` (body) are judged a
 * MALFORMED concurrency token AT INGRESS and refused (400-family); the
 * message must name the mechanism ("an empty token can never match any
 * stored version — this is a client defect, not a lost race"), because that
 * diagnostic distinction is the entire reason option 3 (refuse the shape) was
 * chosen over option 2 (fail closed to 409, which would have collapsed "you
 * sent something meaningless" into "you lost a race"). `""` is syntactically
 * LEGAL per RFC-7232 §2.3 (`*etagc` — zero or more — permits an empty opaque
 * tag); this refusal is an explicit platform CONTRACT choice ("an empty tag
 * can never match ⇒ it is necessarily a client defect"), not a syntax
 * verdict. Two things stay explicitly UNCHANGED: no `If-Match` at all is
 * still a legal unguarded write, and a garbage-but-nonempty token (`v2`)
 * still fails toward 409.
 *
 * ## The four-way pin set (Zone 3 of the dispatch order) — one describe each
 *
 * Each catches a DIFFERENT way a naive patch could overreach or underreach:
 *   1. `""` → 400.                         (the fix itself)
 *   2. no `If-Match` at all → unguarded write still succeeds.
 *      (catches a change that rejects EVERY falsy token, not just `""`)
 *   3. `v2` (garbage, nonempty) → 409 still.
 *      (catches a change that also swallows the legitimate-conflict path)
 *   4. a real, matching token → guarded write still succeeds.
 *      (catches a change that rejects even a well-formed token)
 *
 * ## A2.2 — TWO ingress doors, not one (falsified my own assumption)
 *
 * `assertVersionOf` (the PATCH door, called from `updateData` after the
 * existence probe) and `assertVersionMatch` (the DELETE door, called from
 * `deleteData` BEFORE any probe — and which short-circuits BEFORE ever
 * calling `assertVersionOf`) each read `normaliseVersionToken`'s falsy return
 * independently. A fix at one site alone leaves the other exhibiting the
 * exact original defect — the DELETE-door describe block below regresses
 * independently of the PATCH-door one for exactly this reason.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation, MalformedVersionTokenError } from './protocol.js';

const SCHEMA = {
    name: 'task',
    fields: {
        title: { name: 'title', type: 'text' },
        updated_at: { name: 'updated_at', type: 'datetime' },
    },
};

/** A fake engine holding ONE row — mirrors `protocol.occ-version-token-instant.test.ts`'s fixture. */
function makeProtocol(updatedAt: unknown) {
    const row: Record<string, unknown> = { id: 'rec_1', title: 'one', updated_at: updatedAt };
    const findOne = vi.fn(async (_object: string, opts: any) => {
        assertEngineFindOnePredicate(_object, opts);
        return String(opts?.where?.id) === 'rec_1' ? { ...row } : null;
    });
    const update = vi.fn(async (_object: string, data: any, opts?: any) => {
        const dispatch = assertEngineUpdateDispatch(data, opts);
        if (dispatch.kind !== 'by-id') {
            throw new Error(`fixture drives by-id updates only, got '${dispatch.kind}'`);
        }
        const fields = { ...(data as Record<string, unknown>) };
        delete fields.id;
        Object.assign(row, fields);
        return { ...row };
    });
    const del = vi.fn(async (_object: string, opts?: any) => {
        assertEngineDeleteDispatch(opts);
        return String(opts?.where?.id) === 'rec_1';
    });
    const engine = {
        registry: { getObject: (n: string) => (n === 'task' ? SCHEMA : undefined) },
        findOne,
        update,
        delete: del,
    };
    return { p: new ObjectStackProtocolImplementation(engine as any) as any, findOne, update, del };
}

const NOW = new Date('2026-08-30T10:19:25.947Z');
const NOW_ISO = NOW.toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// Pin 1 — `""` ⇒ 400, on BOTH doors, and the exact shipped message
// ─────────────────────────────────────────────────────────────────────────────

describe('[#13576] pin 1 — the quoted-empty entity-tag is refused 400', () => {
    it('PATCH: `expectedVersion: \'""\'` throws MalformedVersionTokenError (400 VALIDATION_FAILED), and writes nothing', async () => {
        const { p, update } = makeProtocol(NOW);
        await expect(
            p.updateData({ object: 'task', id: 'rec_1', data: { title: 'edited' }, expectedVersion: '""' }),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400, name: 'MalformedVersionTokenError' });
        expect(update).not.toHaveBeenCalled();
    });

    it('DELETE: the same shape throws before the probe, and deletes nothing', async () => {
        const { p, del, findOne } = makeProtocol(NOW);
        await expect(
            p.deleteData({ object: 'task', id: 'rec_1', expectedVersion: '""' }),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
        expect(del).not.toHaveBeenCalled();
        expect(findOne).not.toHaveBeenCalled();
    });

    it('the shipped error text names the MECHANISM — "cannot match" / "client defect" — not just a generic validation failure', async () => {
        // Ruling clause ①: 文案不达意即白改 — the diagnostic value (this is a
        // meaningless token, not a lost race) IS the reason option 3 beat
        // option 2, so the message is asserted verbatim-in-substance, not just
        // the code/status envelope.
        const { p } = makeProtocol(NOW);
        try {
            await p.updateData({ object: 'task', id: 'rec_1', data: {}, expectedVersion: '""' });
            expect.unreachable('expected a MalformedVersionTokenError throw');
        } catch (e: any) {
            expect(e).toBeInstanceOf(MalformedVersionTokenError);
            expect(e.message).toMatch(/empty/i);
            expect(e.message).toMatch(/never match/i);
            expect(e.message).toMatch(/client defect/i);
            // Tells the caller what to do instead — both remedies the ruling names.
            expect(e.message).toMatch(/updated_at/);
            expect(e.message).toMatch(/If-Match/);
        }
    });

    it('surrounding whitespace around the quoted-empty tag is still caught (REST forwards the trimmed header verbatim)', async () => {
        const { p } = makeProtocol(NOW);
        await expect(
            p.updateData({ object: 'task', id: 'rec_1', data: {}, expectedVersion: '  ""  ' }),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pin 2 — no `If-Match` at all ⇒ unguarded write still succeeds (Zone 1.2)
// ─────────────────────────────────────────────────────────────────────────────

describe('[#13576] pin 2 — the legitimate no-token path is UNCHANGED', () => {
    it('PATCH with no `expectedVersion` field at all still writes unguarded', async () => {
        const { p, update } = makeProtocol(NOW);
        const result = await p.updateData({ object: 'task', id: 'rec_1', data: { title: 'edited' } });
        expect(result.record.title).toBe('edited');
        expect(update).toHaveBeenCalledOnce();
    });

    it('DELETE with no `expectedVersion` field at all still deletes unguarded', async () => {
        const { p, del } = makeProtocol(NOW);
        await p.deleteData({ object: 'task', id: 'rec_1' });
        expect(del).toHaveBeenCalledOnce();
    });

    it('an unquoted empty string / whitespace-only token is NOT the malformed shape — still opts out (distinct from `\'""\'`)', async () => {
        // These are what the REST layer's own `expectedVersion ? {...} : {}`
        // truthiness gate already filters before a bare '' ever reaches this
        // layer for the external HTTP doors — pinned here anyway because
        // `updateData`/`deleteData` are also reachable directly (import-runner,
        // action-execution), where no such gate runs.
        const { p: p1, update } = makeProtocol(NOW);
        await p1.updateData({ object: 'task', id: 'rec_1', data: { title: 'a' }, expectedVersion: '' });
        expect(update).toHaveBeenCalledOnce();
        const { p: p2, update: update2 } = makeProtocol(NOW);
        await p2.updateData({ object: 'task', id: 'rec_1', data: { title: 'b' }, expectedVersion: '   ' });
        expect(update2).toHaveBeenCalledOnce();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pin 3 — a garbage-but-nonempty token still fails toward 409 (Zone 1.2)
// ─────────────────────────────────────────────────────────────────────────────

describe('[#13576] pin 3 — an opaque non-matching token is UNCHANGED — still 409, never 400', () => {
    it('PATCH: `expectedVersion: \'v2\'` against a real stored version still throws ConcurrentUpdateError (409)', async () => {
        const { p, update } = makeProtocol(NOW);
        await expect(
            p.updateData({ object: 'task', id: 'rec_1', data: { title: 'edited' }, expectedVersion: 'v2' }),
        ).rejects.toMatchObject({ code: 'CONCURRENT_UPDATE', status: 409 });
        expect(update).not.toHaveBeenCalled();
    });

    it('DELETE: the same garbage token still throws ConcurrentUpdateError (409), not the new 400', async () => {
        const { p, del } = makeProtocol(NOW);
        await expect(
            p.deleteData({ object: 'task', id: 'rec_1', expectedVersion: 'v2' }),
        ).rejects.toMatchObject({ code: 'CONCURRENT_UPDATE', status: 409 });
        expect(del).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pin 4 — a real, matching token still guards the write through, successfully
// ─────────────────────────────────────────────────────────────────────────────

describe('[#13576] pin 4 — a real matching token still performs the guarded write', () => {
    it('PATCH succeeds when `expectedVersion` matches the stored `updated_at`', async () => {
        const { p, update } = makeProtocol(NOW);
        const result = await p.updateData({
            object: 'task', id: 'rec_1', data: { title: 'edited' }, expectedVersion: NOW_ISO,
        });
        expect(result.record.title).toBe('edited');
        expect(update).toHaveBeenCalledOnce();
    });

    it('DELETE succeeds when `expectedVersion` matches the stored `updated_at`', async () => {
        const { p, del } = makeProtocol(NOW);
        await p.deleteData({ object: 'task', id: 'rec_1', expectedVersion: NOW_ISO });
        expect(del).toHaveBeenCalledOnce();
    });

    it('the RFC-7232-quoted form of the SAME real token still matches (quotes stripped, not the emptiness path)', async () => {
        const { p, update } = makeProtocol(NOW);
        const result = await p.updateData({
            object: 'task', id: 'rec_1', data: { title: 'edited' }, expectedVersion: `"${NOW_ISO}"`,
        });
        expect(result.record.title).toBe('edited');
        expect(update).toHaveBeenCalledOnce();
    });
});
