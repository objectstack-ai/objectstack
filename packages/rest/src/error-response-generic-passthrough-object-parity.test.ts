// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14725 — the GENERIC declared-status passthrough must answer one refusal
 * with one body, on both REST error doors.
 *
 * ## What was measured, on `origin/main` @ `a12b15e394`
 *
 * #14541 made the two doors agree for every error a BESPOKE arm classifies.
 * They still disagreed for every error that reaches the GENERIC declared-status
 * passthrough, because the two copies of that one passthrough differed by
 * exactly one key: `classifyDataError`'s copy ends `...(object ? { object } :
 * {})`, and `resolveErrorResponse`'s 4xx arm had no such limb. One error
 * object, both doors, before this change:
 *
 *     { code: 'DUPLICATE_RECORD', status: 409 }        // no `name`, so no arm
 *       mapDataError(err, 'duly_note')
 *         409 {"error":"…","code":"DUPLICATE_RECORD","object":"duly_note"}
 *       sendThrownError(res, err, 'duly_note')
 *         409 {"error":"…","code":"DUPLICATE_RECORD"}
 *
 * The card's second residue is the same measurement reached from the other
 * end: `recordNotFoundError` (`@objectstack/core`) declares `code`,
 * `status = 404` AND `object`, so that declared status carries it past the
 * `RECORD_NOT_FOUND` arm into this same generic passthrough — which is why
 * closing residue 1 closes residue 2 with it, and why the fix is one limb
 * rather than a lifted arm.
 *
 * ## What this file pins, and why each one is here rather than described
 *
 *  §1 door agreement for codes that reach the GENERIC passthrough — the pins
 *     are the two doors AGREEING (same status, same body), never the limb
 *     existing, so a future refactor that keeps the limb and moves the
 *     agreement still goes red;
 *  §2 residue 2 — `RECORD_NOT_FOUND` from its real producer shape, in all
 *     three combinations of declared `status` and door-supplied `object`;
 *  §3 the BOUNDARY triage fenced this card with: the message-TEXT sniff
 *     (`/^Record … not found in …/i`) did NOT move above the passthrough. A
 *     boundary nobody pins is a boundary the next refactor crosses — pinned
 *     behaviourally AND positionally, because either one alone can be green
 *     for the wrong reason;
 *  §4 the two bands the limb deliberately does NOT touch: the declared-5xx arm
 *     (whose sibling `declaredServerFaultAnswer` names no object either, so
 *     adding it there would CREATE a disagreement) and `classifiedRefusalAnswer`,
 *     which calls this door with no `object` argument at all;
 *  §5 omission, not `undefined`: a door called with no object — or with the
 *     literal `''` that five `/data/import/jobs/*` routes pass — answers a body
 *     with NO `object` key. `{"object": undefined}` is a different published
 *     body from omitting the key, and `toEqual` alone does not tell them apart.
 *
 * Refusal assertions state `code` AND `status` (ADR-0112) — never
 * `toThrow()` alone, which is green for a curated envelope and for a raw
 * driver error alike.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordNotFoundError } from '@objectstack/core';
import {
    mapDataError,
    sendThrownError,
    handleRouteError,
    classifiedRefusalAnswer,
} from './error-response.js';

const HERE = dirname(fileURLToPath(import.meta.url));

type Wire = { status: number; body: Record<string, unknown> };

/** Drive one of the sending doors and capture what reached the wire. */
function through(send: (res: any, error: any, object?: string) => void) {
    return (error: unknown, object?: string): Wire => {
        let status = 0;
        let body: Record<string, unknown> = {};
        const res = {
            status(s: number) { status = s; return this; },
            json(b: Record<string, unknown>) { body = b; return this; },
        };
        send(res, error, object);
        return { status, body };
    };
}

/** The bulk / metadata / UI door — `resolveErrorResponse` behind it. */
const bulkDoor = through(sendThrownError);
/** The same door a route catch block uses. */
const routeDoor = through(handleRouteError);
/** The single-record `/data` door — `classifyDataError` behind it. */
const singleDoor = (error: unknown, object?: string): Wire => mapDataError(error, object);

/**
 * A producer that declares `code` + `status` and NOTHING a bespoke arm keys
 * on — no `name`, no envelope class — so it reaches the generic passthrough at
 * both doors. That reachability is the whole point of the case, so it is
 * asserted rather than assumed: `structuredCodeAnswer` recognising the code
 * later would make these pins measure the bespoke path instead.
 */
function genericDeclared(code: string, status: number, message: string): any {
    const err: any = new Error(message);
    err.code = code;
    err.status = status;
    return err;
}

describe('#14725 — the generic declared-status passthrough carries `object` on both doors', () => {
    describe('§1 door agreement for a code with no bespoke arm', () => {
        const CASES: ReadonlyArray<{ code: string; status: number; message: string }> = [
            // The card's own measurement. `DUPLICATE_RECORD` HAS a bespoke arm
            // keyed on `DuplicateRecordError`'s class/`name`; a bare property
            // write does not carry it, which is exactly the shape the card
            // measured on the #14541 branch.
            { code: 'DUPLICATE_RECORD', status: 409, message: 'A record with this value already exists' },
            { code: 'RECORD_LOCKED', status: 409, message: 'This record is frozen' },
            // A 4xx from the other end of the band, so the pin is not a
            // 409-shaped coincidence.
            { code: 'FORBIDDEN', status: 403, message: 'You may not modify this record' },
        ];

        for (const c of CASES) {
            it(`${c.code} (${c.status}): both doors answer the same status and the same body`, () => {
                const err = genericDeclared(c.code, c.status, c.message);
                const bulk = bulkDoor(err, 'duly_note');
                const single = singleDoor(err, 'duly_note');
                // ADR-0112: the envelope is `code` AND `status`, both asserted.
                expect(single.status).toBe(c.status);
                expect(bulk.status).toBe(c.status);
                expect(single.body.code).toBe(c.code);
                expect(bulk.body.code).toBe(c.code);
                // The invariant this card exists for — the two doors AGREE.
                expect(bulk.body).toEqual(single.body);
                expect(bulk.body).toHaveProperty('object', 'duly_note');
            });
        }

        it('`handleRouteError` — the door a route catch actually calls — agrees too', () => {
            const err = genericDeclared('DUPLICATE_RECORD', 409, 'A record with this value already exists');
            const route = routeDoor(err, 'duly_note');
            const single = singleDoor(err, 'duly_note');
            expect(route.status).toBe(409);
            expect(route.body.code).toBe('DUPLICATE_RECORD');
            expect(route.body).toEqual(single.body);
        });

        it('the `statusCode` spelling reaches the same agreement (#7525)', () => {
            // `resolveErrorResponse`'s passthrough is deliberately `status`-only,
            // so this shape falls to `mapDataError` at BOTH doors. Pinned
            // because the agreement here comes from the fall-through rather
            // than from the new limb, and a reader must not conclude the limb
            // is what makes it hold.
            const err: any = new Error('This record is frozen');
            err.code = 'RECORD_LOCKED';
            err.statusCode = 409;
            const bulk = bulkDoor(err, 'duly_note');
            const single = singleDoor(err, 'duly_note');
            expect(bulk.status).toBe(409);
            expect(single.status).toBe(409);
            expect(bulk.body.code).toBe('RECORD_LOCKED');
            expect(bulk.body).toEqual(single.body);
            expect(bulk.body).toHaveProperty('object', 'duly_note');
        });
    });

    describe('§2 residue 2 — `RECORD_NOT_FOUND` from its real producer', () => {
        it('the producer declares `code`, `status = 404` and `object` (the chain this card rests on)', () => {
            const err: any = recordNotFoundError('duly_note', 'abc');
            expect(err.code).toBe('RECORD_NOT_FOUND');
            expect(err.status).toBe(404);
            expect(err.object).toBe('duly_note');
        });

        it('declared status + door-supplied object: both doors answer 404 with `object`', () => {
            const err = recordNotFoundError('duly_note', 'abc');
            const bulk = bulkDoor(err, 'duly_note');
            const single = singleDoor(err, 'duly_note');
            expect(bulk.status).toBe(404);
            expect(single.status).toBe(404);
            expect(bulk.body.code).toBe('RECORD_NOT_FOUND');
            expect(single.body.code).toBe('RECORD_NOT_FOUND');
            expect(bulk.body).toEqual(single.body);
            expect(bulk.body).toHaveProperty('object', 'duly_note');
        });

        it('declared CODE but no status still agrees — it reaches the arm from both doors', () => {
            const err: any = new Error('Record abc not found in duly_note');
            err.code = 'RECORD_NOT_FOUND';
            const bulk = bulkDoor(err, 'duly_note');
            const single = singleDoor(err, 'duly_note');
            expect(bulk.status).toBe(404);
            expect(single.status).toBe(404);
            expect(bulk.body.code).toBe('RECORD_NOT_FOUND');
            expect(bulk.body).toEqual(single.body);
        });

        it('declared status, door supplies NO object: both doors omit it, and still agree', () => {
            const err = recordNotFoundError('duly_note', 'abc');
            const bulk = bulkDoor(err);
            const single = singleDoor(err);
            expect(bulk.status).toBe(404);
            expect(single.status).toBe(404);
            expect(bulk.body.code).toBe('RECORD_NOT_FOUND');
            expect(bulk.body).toEqual(single.body);
            // ⛔ The name is read from the door's ARGUMENT, never from
            // `error.object` — the producer sets it, and this pin is what keeps
            // a future edit from quietly promoting the producer's field onto
            // the wire for every route that passes nothing.
            expect(bulk.body).not.toHaveProperty('object');
        });
    });

    describe('§3 BOUNDARY — the message-TEXT sniff did not move above the passthrough', () => {
        it('a sniff-matching message with a DIFFERENT declared code keeps the declared answer on both doors', () => {
            // If `/^Record … not found in …/i` had been lifted into
            // `structuredCodeAnswer`, this would come back 404
            // `RECORD_NOT_FOUND` on both doors instead of the declared 409.
            const err: any = new Error('Record r1 not found in duly_note');
            err.code = 'RECORD_LOCKED';
            err.status = 409;
            const bulk = bulkDoor(err, 'duly_note');
            const single = singleDoor(err, 'duly_note');
            expect(bulk.status).toBe(409);
            expect(single.status).toBe(409);
            expect(bulk.body.code).toBe('RECORD_LOCKED');
            expect(single.body.code).toBe('RECORD_LOCKED');
            expect(bulk.body).toEqual(single.body);
        });

        it('a sniff-only error (no declared code, no declared status) still reaches the arm from both doors', () => {
            const err = new Error('Record abc not found in duly_note');
            const bulk = bulkDoor(err, 'duly_note');
            const single = singleDoor(err, 'duly_note');
            expect(bulk.status).toBe(404);
            expect(single.status).toBe(404);
            expect(bulk.body.code).toBe('RECORD_NOT_FOUND');
            expect(bulk.body).toEqual(single.body);
        });

        it('positionally: the sniff literal lives in `classifyDataError`, never in the shared classification', () => {
            const source = readFileSync(resolve(HERE, 'error-response.ts'), 'utf8');
            const SNIFF = 'Record\\s+\\S+\\s+not found in\\s+\\S+';
            const shared = source.indexOf('function structuredCodeAnswer(');
            const classify = source.indexOf('function classifyDataError(');
            const sender = source.indexOf('\nexport function sendThrownError(');
            expect(shared).toBeGreaterThan(-1);
            expect(classify).toBeGreaterThan(shared);
            expect(sender).toBeGreaterThan(classify);
            const sniffAt = source.indexOf(SNIFF);
            // The literal is still there at all — an assertion that passes
            // because the pattern was renamed is cover, not a boundary.
            expect(sniffAt).toBeGreaterThan(-1);
            expect(source.indexOf(SNIFF, shared) < classify).toBe(false);
            expect(sniffAt).toBeGreaterThan(classify);
            expect(sniffAt).toBeLessThan(sender);
        });
    });

    describe('§4 the bands the limb does NOT touch', () => {
        it('a declared 5xx carries no `object` on either door — the two already agreed there', () => {
            const err: any = new Error('upstream is unreachable');
            err.code = 'SERVICE_UNAVAILABLE';
            err.status = 503;
            const bulk = bulkDoor(err, 'duly_note');
            const single = singleDoor(err, 'duly_note');
            expect(bulk.status).toBe(503);
            expect(single.status).toBe(503);
            expect(bulk.body.code).toBe('SERVICE_UNAVAILABLE');
            expect(bulk.body).toEqual(single.body);
            // #5437 / #5582: a declared server fault says nothing beyond status
            // and code. Adding the limb HERE would create the disagreement the
            // 4xx limb removes.
            expect(bulk.body).not.toHaveProperty('object');
            expect(single.body).not.toHaveProperty('object');
        });

        it('`classifiedRefusalAnswer` is unmoved: it calls this door with no `object` argument', () => {
            const err: any = new Error("Unknown measure 'amout_sum' on object 'invoice'");
            err.code = 'INVALID_FIELD';
            err.status = 400;
            err.field = 'amout_sum';
            err.object = 'invoice';
            const refusal = classifiedRefusalAnswer(err);
            expect(refusal).toBeDefined();
            expect(refusal!.status).toBe(400);
            expect(refusal!.body.code).toBe('INVALID_FIELD');
            // The KEY SET, not just the values — this is the analytics face's
            // published body, and it must not gain a key from this card.
            expect(Object.keys(refusal!.body).sort()).toEqual(['code', 'error', 'field', 'object']);
        });

        it('a GENERIC-passthrough refusal reaching `classifiedRefusalAnswer` gains no `object`', () => {
            // The limb reads the door's argument, and this entry point supplies
            // none — so the analytics / record-share families see byte-identical
            // bodies whatever this card does to the passthrough.
            const err = genericDeclared('RECORD_LOCKED', 409, 'This record is frozen');
            const refusal = classifiedRefusalAnswer(err);
            expect(refusal).toBeDefined();
            expect(refusal!.status).toBe(409);
            expect(refusal!.body.code).toBe('RECORD_LOCKED');
            expect(Object.keys(refusal!.body).sort()).toEqual(['code', 'error']);
        });
    });

    describe('§5 omission, not `undefined`', () => {
        const OMITTED: ReadonlyArray<{ what: string; object?: string }> = [
            { what: 'no argument at all (the 21 metadata / UI / discovery sites)', object: undefined },
            { what: "the literal '' (the five /data/import/jobs/* sites)", object: '' },
        ];

        for (const c of OMITTED) {
            it(`${c.what}: the body has NO \`object\` key`, () => {
                const err = genericDeclared('RECORD_LOCKED', 409, 'This record is frozen');
                const bulk = bulkDoor(err, c.object);
                expect(bulk.status).toBe(409);
                expect(bulk.body.code).toBe('RECORD_LOCKED');
                // ⛔ `toEqual` treats `{ a: 1 }` and `{ a: 1, object: undefined }`
                // as equal, so the key-set assertion is the one that holds the
                // published shape. `"object": undefined` would serialise the key
                // away in JSON but is a different object on every other reader.
                expect(Object.keys(bulk.body)).not.toContain('object');
                expect('object' in bulk.body).toBe(false);
                expect(bulk.body).toEqual(singleDoor(err, c.object).body);
            });
        }
    });
});
