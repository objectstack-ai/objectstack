// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22019 — the object save door gives the build's verdict on a formula field.
 *
 * ## The defect, as measured
 *
 * `content/docs/data-modeling/formulas.mdx` says "the same `validateExpression`
 * validator backs `os build` and metadata registration". At the object save
 * door it did not: `PUT /api/v1/meta/object/fx_sqrt` with a formula field
 * `sqrt(record.amount)` answered 200, and every read of the field answered
 * `null` with nothing logged. `sqrt` is not a registered stdlib function, and
 * `os build` refuses the same expression as an unknown function.
 *
 * The cause was one registry declaration: `validateStackExpressions` — the
 * build's expression rule, whose field-formula pass calls
 * `validateExpression('value', …)` — declared `runtimeTypes` for flows,
 * actions and hooks, never `object`, so `runtimeAuthoringRulesFor('object')`
 * never dispatched it. The fix is in that declaration (`@objectstack/lint`),
 * narrowed to the field-formula pass; this door's code is unchanged.
 *
 * ## What is pinned here, through the REAL `saveMetaItem` / `publishMetaItem`
 *
 *  (a) the door refuses `sqrt(record.amount)` — a 422 carrying the build's
 *      located finding — on an active save AND on a draft's promotion, and
 *      nothing lands;
 *  (b) a registered call (`floor(record.amount)`) still saves;
 *  (d) the door's issue and the build's finding for the same expression are
 *      the same finding: rule, location, message and hint.
 *
 * The read-path half — a row stored before this gate still reads `null`, and
 * the engine now says so once per (object, field) — lives in `@objectstack/objectql`
 * (`engine-formula-fault-log.test.ts`), where the read is.
 *
 * ⚠️ This package's tests reach `@objectstack/lint` through its `exports`, i.e.
 * its built `dist/` (no vitest alias pulls it back to source — the pair is on
 * `KNOWN_UNALIASED_TEST_IMPORTS`). An edit to the rule registry is invisible
 * here until `pnpm --filter @objectstack/lint build` has run.
 */
import { describe, expect, it } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
// The build's own entry — the call `os build` makes (`runAuthoringRules('build', …)`),
// imported so (d) compares against the build's real output, never a restatement.
import { EXPRESSION_INVALID, runAuthoringRules } from '@objectstack/lint';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
}

const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;

/** A faithful-enough store: rows keyed by table, so a journal write never reads back as metadata. */
function makeStubEngine() {
    const tables = new Map<string, Map<string, Row>>();
    const tableOf = (table: string): Map<string, Row> => {
        let t = tables.get(table);
        if (!t) {
            t = new Map();
            tables.set(table, t);
        }
        return t;
    };
    let nextId = 0;
    const findRow = (table: string, w: Record<string, unknown>): { key: string; row: Row } | null => {
        for (const [k, r] of tableOf(table)) {
            if (w.id !== undefined && r.id !== w.id) continue;
            if (w.type !== undefined && r.type !== w.type) continue;
            if (w.name !== undefined && r.name !== w.name) continue;
            if (w.organization_id !== undefined && r.organization_id !== w.organization_id) continue;
            if (w.state !== undefined && r.state !== w.state) continue;
            return { key: k, row: r };
        }
        return null;
    };
    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            return findRow(table, opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown>; limit?: number }) {
            const matched = Array.from(tableOf(table).values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.name && r.name !== opts.where.name) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
            return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            tableOf(table).set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(table, opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            tableOf(table).delete(found.key);
            tableOf(table).set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(table, opts.where);
            if (!found) return { deleted: 0 };
            tableOf(table).delete(found.key);
            return { deleted: 1 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: () => [],
            getItem: () => undefined,
        },
    };
    return { engine, rows: tableOf('sys_metadata') };
}

function makeProtocol() {
    const { engine, rows } = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test');
    return { protocol: protocol as any, rows };
}

/**
 * The card's object. `sharingModel` is authored so `security-owd-unset` does
 * not fire at `error` and the refusal under test is unambiguously the formula's.
 */
const fxSqrt = (expression: string) => ({
    name: 'fx_sqrt',
    label: 'Formula Probe',
    sharingModel: 'private',
    fields: {
        name: { type: 'text', label: 'Name' },
        amount: { type: 'number', label: 'Amount' },
        score: { type: 'formula', label: 'Score', expression },
    },
});

const UNREGISTERED = 'sqrt(record.amount)';
const REGISTERED = 'floor(record.amount)';
/** Where the build locates a formula finding — the KEY the author edits. */
const WHERE = "object 'fx_sqrt' · field 'score' expression";

const objectRows = (rows: Map<string, Row>) =>
    Array.from(rows.values()).filter((r) => r.type === 'object' && r.name === 'fx_sqrt');

/** The build's findings for one object, through the build's own entry. */
const buildFindings = (obj: unknown) => {
    const stack = { objects: [obj] };
    return runAuthoringRules('build', { normalized: stack, parsed: stack })
        .filter((f) => f.rule === EXPRESSION_INVALID && f.where === WHERE);
};

describe('the object save door gives the build\'s formula verdict (#22019)', () => {
    it('(a) REFUSES an active save of `sqrt(record.amount)` with a 422 carrying the build\'s located finding', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await protocol
            .saveMetaItem({ type: 'object', name: 'fx_sqrt', item: fxSqrt(UNREGISTERED) })
            .catch((e: any) => e);

        expect(err, 'the save resolved — the door still accepts an unregistered function').toBeInstanceOf(Error);
        expect(err.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        expect(err.rulesRun).toContain('validateStackExpressions');
        const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe(WHERE);
        expect(issue.where).toBe(WHERE);
        expect(issue.severity).toBe('error');
        // The named subject: the function the author typed, as the build names it.
        expect(issue.message).toContain('`sqrt` is not a callable name here');
        // And nothing landed — a gate that refuses after persisting is a log line.
        expect(objectRows(rows)).toEqual([]);
    });

    it('(a) REFUSES the same body on a draft\'s PROMOTION — the draft door is not a bypass', async () => {
        const { protocol } = makeProtocol();
        // A draft save is never gated (#4463 D1): the author may keep a half-finished object.
        await expect(
            protocol.saveMetaItem({ type: 'object', name: 'fx_sqrt', item: fxSqrt(UNREGISTERED), mode: 'draft' }),
        ).resolves.toMatchObject({ success: true });

        const err = await protocol.publishMetaItem({ type: 'object', name: 'fx_sqrt' }).catch((e: any) => e);

        expect(err?.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        const issue = err.issues.find((i: any) => i.rule === EXPRESSION_INVALID);
        expect(issue, `issues: ${JSON.stringify(err.issues)}`).toBeDefined();
        expect(issue.path).toBe(WHERE);
    });

    it('(b) a registered call — `floor(record.amount)` — still saves, and the row lands', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await protocol.saveMetaItem({ type: 'object', name: 'fx_sqrt', item: fxSqrt(REGISTERED) });

        expect(result.success).toBe(true);
        expect(objectRows(rows).map((r) => r.state)).toEqual(['active']);
    });

    it('(d) the door and `os build` give the SAME finding for the same expression', async () => {
        const { protocol } = makeProtocol();
        const err = await protocol
            .saveMetaItem({ type: 'object', name: 'fx_sqrt', item: fxSqrt(UNREGISTERED) })
            .catch((e: any) => e);
        const atDoor = (err.issues ?? []).filter((i: any) => i.rule === EXPRESSION_INVALID);

        const atBuild = buildFindings(fxSqrt(UNREGISTERED));

        // Non-vacuous on both sides: one finding each, and an error at the build.
        expect(atBuild).toHaveLength(1);
        expect(atBuild[0]!.severity).toBe('error');
        expect(atDoor).toHaveLength(1);
        // Four keys, compared field by field — the door reuses the build's call,
        // so a reworded or relocated door verdict is a second dialect, and red.
        for (const key of ['rule', 'where', 'path', 'message', 'hint'] as const) {
            expect(atDoor[0][key], `door and build disagree on '${key}'`).toBe(atBuild[0]![key]);
        }
        // And the registered call is clean at both doors, not just this one.
        expect(buildFindings(fxSqrt(REGISTERED))).toEqual([]);
    });
});
