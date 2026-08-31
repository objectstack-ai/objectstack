// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13382] Optimistic concurrency compares INSTANTS, not spellings.
 *
 * ## The defect
 *
 * On Postgres — the production default driver — every guarded save answered
 * `409 CONCURRENT_UPDATE`, including on a record nobody had ever touched. The
 * OCC gate read the record's `updated_at` through `String(v)`; on Postgres that
 * value is a JS `Date`, so `String(v)` produced
 * `"Sun Aug 30 2026 18:19:25 GMT+0800 (China Standard Time)"` — milliseconds
 * dropped, process timezone baked in — and compared it, as a string, against
 * the `"2026-08-30T10:19:25.947Z"` the client had echoed back from its own GET.
 * The sharpest evidence is in the error text the card carries: `current` and
 * `expected` are the SAME INSTANT (`18:19:25+08:00` == `10:19:25.947Z`) and the
 * conflict detector called them a conflict.
 *
 * SQLite stores and returns canonical ISO text, so both sides matched by
 * accident and every development environment was green. **That green is the
 * camouflage, which is why these tests drive the `Date` shape explicitly.**
 *
 * ## What is pinned here — the property, not the spelling
 *
 * Not "`normaliseVersionToken` calls `toISOString()`". A future representation
 * change would break such a pin while leaving the contract intact. The
 * invariants are:
 *
 *   1. **Two spellings of one instant never conflict.** Driven from a table of
 *      spelling pairs, each pair naming ONE instant.
 *   2. **The verdict does not depend on `process.env.TZ`** — asserted under
 *      three process zones, with a non-vacuity control proving the zones really
 *      do move the broken spelling (a pass under three identical spellings is a
 *      pass that means nothing).
 *   3. **Different instants still conflict**, down to the millisecond. The
 *      repair must not be a weakening.
 *   4. **The 409's `currentVersion`, echoed straight back as the next token, is
 *      accepted.** The live-deployment corroboration on the card reports that
 *      that echo is what the Console's "Overwrite anyway" sends, and it was the
 *      only token the broken server would take. Fixing only the comparison and
 *      leaving the emission as `String(updated_at)` would convert a false
 *      conflict into an UNRESOLVABLE one, so this is a second limb of the same
 *      defect, not a nicety.
 *   5. **Nothing accepted before is refused now.** The change is strictly
 *      widening — including for a client still holding a pre-fix 409's
 *      `Date.toString()` token across the upgrade.
 *
 * ## What is deliberately NOT claimed here
 *
 * That the driver hands this seam a `Date` on Postgres. That is a fact about
 * `driver-sql`, measured against a live PostgreSQL 16 while fixing this (both
 * before and after, under three process zones), and it cannot be asserted from
 * this package — `@objectstack/metadata-protocol` has no driver dependency and
 * must not grow one. What these tests own is the seam's behaviour GIVEN each
 * input shape a driver can produce; the shapes themselves are enumerated in
 * `canonicalVersionInstant`'s docblock beside the fix.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
// The producer's OWN write-verb dispatch decisions, from
// `@objectstack/metadata-core` and never from `@objectstack/objectql` —
// objectql DEPENDS ON this package, so that import would close a cycle. A
// hand-mirrored dispatch here would be a double looser than the engine it
// stands in for (`check:engine-double-contract`).
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'task',
    fields: {
        title: { name: 'title', type: 'text' },
        updated_at: { name: 'updated_at', type: 'datetime' },
    },
};

/**
 * A fake engine holding ONE row whose `updated_at` is whatever the case under
 * test says a driver returned — a `Date`, ISO text, epoch milliseconds, or an
 * opaque token.
 */
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

/** Attempt a guarded PATCH; report the verdict without letting a throw escape. */
async function guardedPatch(updatedAt: unknown, expectedVersion: string) {
    const { p, update } = makeProtocol(updatedAt);
    try {
        await p.updateData({ object: 'task', id: 'rec_1', data: { title: 'edited' }, expectedVersion });
        return { accepted: true as const, wrote: update.mock.calls.length };
    } catch (e: any) {
        return {
            accepted: false as const,
            wrote: update.mock.calls.length,
            code: e?.code,
            status: e?.status,
            currentVersion: e?.currentVersion,
            message: String(e?.message ?? ''),
        };
    }
}

/** The one instant every spelling below names. */
const INSTANT = Date.UTC(2026, 7, 30, 10, 19, 25, 947); // 2026-08-30T10:19:25.947Z
const ISO = new Date(INSTANT).toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// 1. Two spellings of one instant never conflict
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each row: what the DRIVER put in `updated_at`, and what the CLIENT echoed
 * back — two spellings of {@link INSTANT}. Every row must be accepted.
 *
 * The driver column is the measured input domain of the OCC seam: a `Date` on
 * Postgres / MySQL / MongoDB, canonical ISO text on the SQLite family and the
 * memory driver, epoch milliseconds on a pre-canonical or hand-migrated SQLite
 * column (the driver's legacy-datetime repair is keyed on declared
 * `Field.datetime` columns, and the engine-injected audit columns are not in
 * that set, so such a value reaches this seam unrepaired).
 */
const ONE_INSTANT_TWO_SPELLINGS: ReadonlyArray<{
    why: string;
    driver: unknown;
    client: string;
}> = [
    {
        why: 'Postgres / MySQL / MongoDB: driver returns a Date, client echoes the ISO the GET served',
        driver: new Date(INSTANT),
        client: ISO,
    },
    {
        why: 'the same, with the RFC-7232 quotes an If-Match header carries',
        driver: new Date(INSTANT),
        client: `"${ISO}"`,
    },
    {
        why: 'SQLite / Turso / sqlite-wasm / memory: canonical ISO text on both sides (unchanged)',
        driver: ISO,
        client: ISO,
    },
    {
        why: 'a client that spells the instant with a numeric offset instead of Z',
        driver: new Date(INSTANT),
        client: '2026-08-30T18:19:25.947+08:00',
    },
    {
        why: 'ISO text in the column, offset spelling from the client',
        driver: ISO,
        client: '2026-08-30T18:19:25.947+08:00',
    },
    {
        why: 'a pre-canonical SQLite column holding epoch milliseconds',
        driver: INSTANT,
        client: ISO,
    },
    {
        why: 'a microsecond rendering truncates to the millisecond the record can hold',
        driver: new Date(INSTANT),
        client: '2026-08-30T10:19:25.947123Z',
    },
];

describe('[#13382] two spellings of ONE instant are not a conflict', () => {
    for (const { why, driver, client } of ONE_INSTANT_TWO_SPELLINGS) {
        it(why, async () => {
            const verdict = await guardedPatch(driver, client);
            expect(
                verdict,
                `expected the guarded save to be ACCEPTED; got ${JSON.stringify(verdict)}`,
            ).toMatchObject({ accepted: true });
            expect(verdict.wrote).toBe(1);
        });
    }

    it('the DELETE door agrees with the PATCH door — one seam, one verdict', async () => {
        // `deleteData` runs the same comparison through its own probe
        // (`assertVersionMatch`), so a fix applied to one door only would leave
        // guarded deletes 409-ing on Postgres for ever.
        const { p, del } = makeProtocol(new Date(INSTANT));
        await p.deleteData({ object: 'task', id: 'rec_1', expectedVersion: ISO });
        expect(del).toHaveBeenCalledOnce();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The verdict does not depend on the process timezone
// ─────────────────────────────────────────────────────────────────────────────

describe('[#13382] the verdict is a fact about the instant, not about `TZ`', () => {
    const ORIGINAL_TZ = process.env.TZ;
    afterEach(() => {
        if (ORIGINAL_TZ === undefined) delete process.env.TZ;
        else process.env.TZ = ORIGINAL_TZ;
    });

    // The card's zone, CI's skewed zone, and UTC. Pairwise different by
    // construction, which is what makes the sweep non-vacuous.
    const ZONES = ['Asia/Shanghai', 'America/New_York', 'UTC'] as const;

    it('accepts the same token under three process zones, and the zones really do move the broken spelling', async () => {
        const brokenSpellings = new Set<string>();
        for (const zone of ZONES) {
            process.env.TZ = zone;
            const stamped = new Date(INSTANT);
            // NON-VACUITY CONTROL, in the spirit of the driver matrix's
            // three-way zone skew: `String(Date)` is the spelling the defect
            // compared. If the zones did not move it, three green rows would
            // prove nothing at all about timezone independence.
            brokenSpellings.add(String(stamped));
            const verdict = await guardedPatch(stamped, ISO);
            expect(verdict, `refused under TZ=${zone}: ${JSON.stringify(verdict)}`).toMatchObject({
                accepted: true,
            });
        }
        expect(
            brokenSpellings.size,
            'the three process zones must produce three DIFFERENT `String(Date)` spellings, ' +
                'or this sweep is vacuous',
        ).toBe(ZONES.length);
    });

    it('a 409 names the same instant under every process zone', async () => {
        const published = new Set<string>();
        for (const zone of ZONES) {
            process.env.TZ = zone;
            const verdict = await guardedPatch(new Date(INSTANT), new Date(INSTANT + 1).toISOString());
            expect(verdict).toMatchObject({ accepted: false, code: 'CONCURRENT_UPDATE' });
            published.add(String((verdict as any).currentVersion));
        }
        expect(
            published,
            'the published `currentVersion` drifted with the process timezone',
        ).toEqual(new Set([ISO]));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The repair is not a weakening
// ─────────────────────────────────────────────────────────────────────────────

describe('[#13382] different versions still conflict', () => {
    it('one millisecond apart is a conflict, and nothing is written', async () => {
        const verdict = await guardedPatch(new Date(INSTANT), new Date(INSTANT + 1).toISOString());
        expect(verdict).toMatchObject({ accepted: false, code: 'CONCURRENT_UPDATE', status: 409 });
        expect(verdict.wrote).toBe(0);
    });

    it('a stale token from an earlier version of the row is a conflict', async () => {
        const verdict = await guardedPatch(new Date(INSTANT), new Date(INSTANT - 60_000).toISOString());
        expect(verdict).toMatchObject({ accepted: false, code: 'CONCURRENT_UPDATE', status: 409 });
        expect(verdict.wrote).toBe(0);
    });

    it('an opaque, non-temporal token is compared verbatim — matching accepts, differing conflicts', async () => {
        // A host stamping its own version string into the column keeps exactly
        // the semantics it had: the instant path is not a licence to guess.
        expect(await guardedPatch('rowversion-7', 'rowversion-7')).toMatchObject({ accepted: true });
        expect(await guardedPatch('rowversion-7', 'rowversion-8')).toMatchObject({
            accepted: false,
            code: 'CONCURRENT_UPDATE',
        });
    });

    it('a zone-LESS date-time is NOT reinterpreted through the process timezone', async () => {
        // `Date.parse('2026-08-30 18:19:25.947')` reads LOCAL time, which would
        // make the verdict depend on `TZ` — the one thing the fix must not do.
        // Such a token stays opaque and is compared verbatim, so it matches the
        // identical stored text and nothing else.
        process.env.TZ = 'Asia/Shanghai';
        try {
            expect(await guardedPatch('2026-08-30 18:19:25.947', '2026-08-30 18:19:25.947')).toMatchObject({
                accepted: true,
            });
            expect(await guardedPatch(new Date(INSTANT), '2026-08-30 18:19:25.947')).toMatchObject({
                accepted: false,
                code: 'CONCURRENT_UPDATE',
            });
        } finally {
            delete process.env.TZ;
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The 409's own token closes the loop
// ─────────────────────────────────────────────────────────────────────────────

describe('[#13382] the token a 409 publishes is a token the server accepts', () => {
    it('echoing `currentVersion` straight back is accepted — the "Overwrite anyway" path', async () => {
        const conflict = await guardedPatch(new Date(INSTANT), new Date(INSTANT - 60_000).toISOString());
        expect(conflict).toMatchObject({ accepted: false, code: 'CONCURRENT_UPDATE' });
        const echoed = await guardedPatch(new Date(INSTANT), String((conflict as any).currentVersion));
        expect(
            echoed,
            'the conflict dialog re-keys its retry to `currentVersion`; a token the server ' +
                'will not take turns a resolvable conflict into a dead end',
        ).toMatchObject({ accepted: true });
    });

    it('the published `currentVersion` is the canonical instant, matching the documented wire format', async () => {
        // `content/docs/api/wire-format.mdx` documents this field as an ISO-8601
        // UTC timestamp. On a Date-returning driver it was a `Date.toString()`.
        const conflict = await guardedPatch(new Date(INSTANT), new Date(INSTANT - 1).toISOString());
        expect((conflict as any).currentVersion).toBe(ISO);
        expect((conflict as any).message).toContain(ISO);
    });

    it('an opaque version is published verbatim, not coerced into a timestamp', async () => {
        const conflict = await guardedPatch('rowversion-7', 'rowversion-8');
        expect((conflict as any).currentVersion).toBe('rowversion-7');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Strictly widening: nothing accepted before is refused now
// ─────────────────────────────────────────────────────────────────────────────

describe('[#13382] the change cannot refuse a token that was accepted before', () => {
    it('a client still echoing a PRE-FIX 409 token (`Date.toString()`, milliseconds already lost) is accepted', async () => {
        // The live-deployment report on the card says this string was the ONLY
        // token the broken server would take. A client holding one across the
        // upgrade must not be locked out: when either side is not an instant the
        // comparison falls back to the verbatim tokens, exactly as before.
        process.env.TZ = 'Asia/Shanghai';
        try {
            const stamped = new Date(INSTANT);
            const preFixToken = String(stamped); // what the old code published
            expect(preFixToken).not.toBe(ISO); // control: it really is the other spelling
            expect(await guardedPatch(stamped, preFixToken)).toMatchObject({ accepted: true });
        } finally {
            delete process.env.TZ;
        }
    });

    it('an empty or blank token still opts OUT of the check rather than conflicting', async () => {
        expect(await guardedPatch(new Date(INSTANT), '')).toMatchObject({ accepted: true });
        expect(await guardedPatch(new Date(INSTANT), '   ')).toMatchObject({ accepted: true });
    });

    it('a record with no `updated_at` still skips the check', async () => {
        expect(await guardedPatch(undefined, ISO)).toMatchObject({ accepted: true });
    });
});
