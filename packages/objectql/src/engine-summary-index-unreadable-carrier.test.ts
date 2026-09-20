// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19082] `buildSummaryIndex()` must not answer an UNREADABLE `reference`
 * carrier with a silent *"this parent declares no roll-up"*.
 *
 * The child→parent foreign key is resolved by scanning the child's
 * `master_detail` / `lookup` fields for one whose `reference` names the parent.
 * The comparison used to read the carrier raw, so a carrier no reader can read
 * — a non-string, where `FieldSchema.reference` declares an optional string —
 * compared false against every name, `fkField` stayed unset, and
 *
 * ```ts
 * if (!fkField) continue; // can't resolve the relationship — skip
 * ```
 *
 * dropped a DECLARED `summary` field out of both indexes with no diagnostic
 * anywhere. `recomputeSummaries()` then found nothing to do after every insert
 * / update / delete of the child, so the parent's stored summary value kept
 * whatever it held while every one of those writes reported success. It is the
 * SECOND way this one function invents "nothing to recompute" — the first, its
 * registry read, is #9154 (`engine-summary-index-registry-read-failure.test.ts`).
 *
 * ## What is pinned here, and why BOTH halves are required
 *
 * ⛔ The remedy is deliberately NOT a looser comparison: that would trade a
 * silent stall for a MIS-MATCHED foreign key, which is more expensive. So the
 * skip itself is unchanged and two pins are needed to tell "fixed" apart from
 * "this path was closed off":
 *
 *  1. an unreadable carrier makes the skip OBSERVABLE (§2 below);
 *  2. a normal `reference` still resolves `fkField` (§1 below) — without this
 *     one, a change that simply stopped resolving anything would pass §2.
 *
 * §3 runs both in ONE index build, which is the shape a real registry has.
 *
 * ## Why the zero counts below are readings and not a dead instrument
 *
 * Every case drives the SAME `RecordingLogger` through the SAME public handle
 * (`getOwnedSummaryDescriptors`, the engine's own parent-side read of the
 * index — #6063 — which reaches `buildSummaryIndex()` with no driver in the
 * path). §2 measures that recorder at **1**, so the **0** in §1, §4 and §5 is
 * this instrument reporting silence rather than this instrument being unable
 * to report at all.
 *
 * ⚠️ Scope, stated so the next reader of the skip branch does not re-file it:
 * PR #18503 recorded this site in its **C2** list and #18550 left it there
 * deliberately. This change does not move that boundary — the RESOLUTION RULE
 * is untouched, and only the SILENCE is closed.
 */

import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import type { Logger } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine.js';

/** The package id every fixture below is registered under. */
const OWNER_PACKAGE = 'test-19082';

/**
 * A `Logger` that keeps what it was told. `error` is a real method, not an
 * optional one: the engine reaches for `error` and falls back to `warn`, and a
 * recorder missing `error` would silently measure the fallback instead of the
 * level this card is about.
 */
class RecordingLogger implements Logger {
    readonly errors: string[] = [];
    readonly warns: string[] = [];
    debug(): void { /* not read by these cases */ }
    info(): void { /* not read by these cases */ }
    warn(message: string): void { this.warns.push(message); }
    error(message: string): void { this.errors.push(message); }
}

/*
 * Fixtures are typed as `ServiceObject` (and registered WITH their
 * `packageId`) rather than left to inference, so this file adds nothing to
 * `@objectstack/objectql`'s TEST_DEBT ledger — a shrink-only ratchet (#5278).
 * The one exception is `badLine`, whose whole point is a `reference` the type
 * forbids; it is cast once, at its declaration, and the cast is the statement
 * that this value never came through a parse.
 */

/** Parent whose roll-up resolves — the control. */
const inv: ServiceObject = {
    name: 'inv',
    label: 'Invoice',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        line_total: {
            name: 'line_total',
            label: 'Line total',
            type: 'summary' as const,
            summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' as const },
        },
    },
};

/** Child with a READABLE carrier. */
const invLine: ServiceObject = {
    name: 'inv_line',
    label: 'Invoice line',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        amount: { name: 'amount', label: 'Amount', type: 'number' as const },
        inv: { name: 'inv', label: 'Invoice', type: 'master_detail' as const, reference: 'inv' },
    },
};

/** Parent whose roll-up cannot resolve — the defect. */
const bad: ServiceObject = {
    name: 'bad',
    label: 'Bad invoice',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        line_total: {
            name: 'line_total',
            label: 'Line total',
            type: 'summary' as const,
            summaryOperations: { object: 'bad_line', field: 'amount', function: 'sum' as const },
        },
    },
};

/**
 * Child whose carrier NO READER CAN READ. `{ object: 'bad' }` is the shape an
 * author reaches for when they think `reference` takes a descriptor;
 * `ObjectSchema.safeParse` refuses it with a located `invalid_type`, so a
 * definition in this shape reached the registry around the parse seam — a raw
 * `registerObject`, or a metadata row stored before that tightening.
 */
const badLine = {
    name: 'bad_line',
    label: 'Bad invoice line',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        amount: { name: 'amount', label: 'Amount', type: 'number' },
        bad: { name: 'bad', label: 'Invoice', type: 'master_detail', reference: { object: 'bad' } },
    },
} as unknown as ServiceObject;

/** Child that names NO target at all — absence, which is legal and silent. */
const absentLine: ServiceObject = {
    name: 'bad_line',
    label: 'Bad invoice line',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        amount: { name: 'amount', label: 'Amount', type: 'number' as const },
        bad: { name: 'bad', label: 'Invoice', type: 'lookup' as const },
    },
};

/**
 * Child carrying BOTH an unreadable carrier and, after it, the readable
 * `master_detail` that really is the foreign key. Key order matters: the
 * unreadable one is declared FIRST, so a scan that let the arbiter's refusal
 * propagate would never reach the field below it.
 */
const mixedLine = {
    name: 'bad_line',
    label: 'Bad invoice line',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        stale_ref: { name: 'stale_ref', label: 'Stale', type: 'lookup', reference: ['bad'] },
        amount: { name: 'amount', label: 'Amount', type: 'number' },
        bad: { name: 'bad', label: 'Invoice', type: 'master_detail', reference: 'bad' },
    },
} as unknown as ServiceObject;

/** A fresh engine with `objects` registered and a recorder on the log sink. */
function makeEngine(objects: ServiceObject[]): { engine: ObjectQL; logger: RecordingLogger } {
    const logger = new RecordingLogger();
    const engine = new ObjectQL({ logger });
    for (const o of objects) engine.registry.registerObject(o, OWNER_PACKAGE);
    return { engine, logger };
}

/** Errors this card's diagnostic is responsible for, isolated from any other. */
const skipDiagnostics = (logger: RecordingLogger): string[] =>
    logger.errors.filter((m) => m.startsWith('[summary-index]'));

describe('[#19082] buildSummaryIndex — an unreadable `reference` carrier skips LOUDLY', () => {
    describe('§1 control — a readable carrier still resolves `fkField`', () => {
        it('indexes the roll-up and says nothing', () => {
            const { engine, logger } = makeEngine([inv, invLine]);

            const owned = engine.getOwnedSummaryDescriptors('inv');

            // Without this half, a change that simply stopped resolving
            // anything would satisfy §2 — "fixed" and "closed this path off"
            // would be indistinguishable.
            expect(owned).toHaveLength(1);
            expect(owned[0].summaryField).toBe('line_total');
            expect(owned[0].childObject).toBe('inv_line');
            expect(owned[0].fkField).toBe('inv');
            expect(skipDiagnostics(logger)).toEqual([]);
            expect(logger.warns.filter((m) => m.startsWith('[summary-index]'))).toEqual([]);
        });
    });

    describe('§2 the defect — an unreadable carrier emits an observable skip signal', () => {
        it('reports the skip once, naming the consequence and the fix', () => {
            const { engine, logger } = makeEngine([bad, badLine]);

            const owned = engine.getOwnedSummaryDescriptors('bad');

            // ⛔ The skip is NOT repaired by guessing the foreign key: a looser
            // comparison would index a MIS-MATCHED FK, which is worse than the
            // stall. The descriptor stays absent; what ends is the silence.
            expect(owned).toEqual([]);

            const reported = skipDiagnostics(logger);
            expect(reported).toHaveLength(1);
            const [msg] = reported;
            // WHO: the declared summary field that is not being maintained.
            expect(msg).toContain('bad.line_total');
            // WHERE: the field whose carrier could not be read.
            expect(msg).toContain('bad_line.bad');
            // THE CONSEQUENCE, concretely — the half a bare "could not resolve"
            // leaves out, and the reason this is an `error` and not a `warn`.
            expect(msg).toContain('will NOT recompute');
            expect(msg).toContain('reports success');
            // THE FIX, both spellings the author can reach for.
            expect(msg).toContain("reference: 'bad'");
            expect(msg).toContain('summaryOperations.relationshipField');
        });

        it('speaks at `error`, not at `warn`', () => {
            const { engine, logger } = makeEngine([bad, badLine]);
            engine.getOwnedSummaryDescriptors('bad');

            // A persisted summary silently stops tracking its children while
            // every write keeps reporting success — the durability class, whose
            // level is `error` by AGENTS.md's own question. A `warn` here is the
            // one level at which an operator is never told.
            expect(skipDiagnostics(logger)).toHaveLength(1);
            expect(logger.warns.filter((m) => m.startsWith('[summary-index]'))).toEqual([]);
        });
    });

    describe('§3 both in ONE build — the control and the defect do not interfere', () => {
        it('the readable roll-up is indexed while the unreadable one is reported', () => {
            const { engine, logger } = makeEngine([inv, invLine, bad, badLine]);

            const good = engine.getOwnedSummaryDescriptors('inv');
            const broken = engine.getOwnedSummaryDescriptors('bad');

            expect(good.map((d) => d.fkField)).toEqual(['inv']);
            expect(broken).toEqual([]);
            expect(skipDiagnostics(logger)).toHaveLength(1);
            expect(skipDiagnostics(logger)[0]).toContain('bad.line_total');
        });
    });

    describe('§4 absence is not unreadability — and stays silent', () => {
        it('a relation field that names no target skips without a diagnostic', () => {
            const { engine, logger } = makeEngine([bad, absentLine]);

            // `FieldSchema.reference` is `.optional()` and `StrictField`
            // declares it nullable: naming no target is a legal thing for a
            // field to say, it was silent before this change, and it is silent
            // after. Only UNREADABILITY is new.
            expect(engine.getOwnedSummaryDescriptors('bad')).toEqual([]);
            expect(skipDiagnostics(logger)).toEqual([]);
        });
    });

    describe('§5 an unreadable SIBLING must not hide the real foreign key', () => {
        it('resolves the readable `master_detail` declared after it, silently', () => {
            const { engine, logger } = makeEngine([bad, mixedLine]);

            // The arbiter THROWS on an unreadable carrier, and the two cascade
            // seams #19080 routed through it let that throw propagate. This
            // scan cannot: it is looking FOR the foreign key across every
            // relation field, so a propagating refusal on `stale_ref` would
            // turn a roll-up that works today into a hard failure of every
            // write to `bad_line`. Nothing is dropped here, so nothing is
            // reported here either.
            const owned = engine.getOwnedSummaryDescriptors('bad');
            expect(owned).toHaveLength(1);
            expect(owned[0].fkField).toBe('bad');
            expect(skipDiagnostics(logger)).toEqual([]);
        });
    });

    describe('§6 said once per index BUILD, never once per read', () => {
        it('repeats only when the registry moves, not on every consult', () => {
            const { engine, logger } = makeEngine([bad, badLine]);

            for (let i = 0; i < 5; i++) engine.getOwnedSummaryDescriptors('bad');

            // `ensureSummaryIndexes()` memoises the built pair against the
            // registry's `objectRevision`, which moves on a metadata MUTATION
            // and never on a data write — so this diagnostic cannot become a
            // per-write log line.
            expect(skipDiagnostics(logger)).toHaveLength(1);

            // A metadata mutation invalidates the stamp, the index rebuilds,
            // and the condition — still present — is reported again. Measured
            // rather than assumed: without this leg, a "1" above could equally
            // mean the diagnostic is emitted exactly once per process.
            engine.registry.registerObject(inv, OWNER_PACKAGE);
            engine.getOwnedSummaryDescriptors('bad');
            expect(skipDiagnostics(logger)).toHaveLength(2);
        });
    });
});
