// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14541 — the two REST error doors must answer one refusal with one body.
 *
 * ## What was measured, on `origin/main` @ `9b30cc18d9`
 *
 * `resolveErrorResponse` — the door behind `handleRouteError` /
 * `sendThrownError`, which every bulk and metadata route reports through —
 * took its own declared-status passthrough BEFORE delegating to
 * `mapDataError`, the door the single-record `/data` routes call directly. An
 * engine envelope that DECLARES `status` therefore short-circuited, and every
 * bespoke structured arm behind the delegation was unreachable from those
 * routes. Per producer, measured at the throw site:
 *
 *   engine `DELETE_RESTRICTED`      status 409 → `developerMessage`,
 *       `dependentObject`, `dependentCount`, `object` dropped
 *   `ConcurrentUpdateError`         status 409 → `currentVersion`,
 *       `currentRecord`, `object` dropped
 *   `DuplicateRecordError`          status 409 → `field`, `object`,
 *       `developerMessage` dropped; `code` left as the engine spelling
 *       `DUPLICATE_RECORD` rather than the wire's `UNIQUE_VIOLATION`; the
 *       engine's sentence rather than the curated one
 *   `FEEDS_DISABLED` / `FILES_DISABLED` / `ATTACHMENT_PARENT_ACCESS` /
 *       `ATTACHMENT_DELETE_DENIED` / `RECORD_NOT_ACCESSIBLE`  status 403
 *       → `object` dropped
 *   engine `INVALID_FIELD`          status 400 → `field`, `object` dropped
 *
 * The project had already ruled on this shape for ONE code (#3770,
 * `OBJECT_NOT_FOUND`): "`mapDataError` owns its canonical envelope, and
 * short-circuiting here would ship a second wire code for the same condition
 * depending on which route caught it." The exclusion never grew past that
 * first case, which is what the rows above are.
 *
 * ## What this file pins
 *
 *  §1 door parity: for every producer the shared classification recognises,
 *     `mapDataError` and `sendThrownError` answer the SAME status and the
 *     SAME body — the invariant, stated once per producer;
 *  §2 the restored fields, named per code, so a body that silently loses one
 *     again is a red test rather than a re-measurement;
 *  §3 `handleRouteError` and `sendThrownError` agree with each other (they
 *     share `resolveErrorResponse`; the pin keeps that true);
 *  §4 the guards the fix is fenced by, EVERY case asserting BOTH doors and
 *     labelled CONVERGED or ACCEPTED DIVERGENCE — a declared 5xx keeps the
 *     passthrough's prose-withholding arm (#5437 / #5582 / #5907), a 5xx ARM
 *     never displaces a declared 4xx, a sandboxed producer keeps the unwrap
 *     door's sentence on BOTH doors (#11588 / #7543; the single door's mirror
 *     defect was closed by #14704, which FLIPPED that case's verdict here from
 *     ACCEPTED DIVERGENCE to CONVERGED rather than deleting it), and the one
 *     status this card DOES move
 *     — a sandboxed 5xx carrying `OBJECT_NOT_FOUND` / `INVALID_FIELD` — is
 *     pinned rather than described;
 *  §5 the drift guard, over BOTH halves of `classifyDataError`: every
 *     declared-code arm — inside the shared classification AND below the
 *     consult, the position that produced this card — is either a §1 parity
 *     case or a NAMED single-door arm carrying its reason;
 *  §6 the two families that reach this door through `classifiedRefusalAnswer`
 *     rather than a route catch: the analytics dataset face, whose body
 *     genuinely gains `field` and `object`, pinned at KEY level because its
 *     own envelope tests assert only `code` and a message shape; and the
 *     record-share family, whose key set does not move.
 *
 * §4, §5 and §6 in these shapes are the contract review's conditions 3, 4, 5
 * and 6 on this card (verdict `PASS WITH CONDITIONS`, 2026-09-02).
 *
 * Refusal assertions state `code` AND `status` (ADR-0112) — never
 * `toThrow()` alone, which is green for a curated envelope and for a raw
 * driver error alike.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuplicateRecordError } from '@objectstack/objectql';
import { ConcurrentUpdateError } from '@objectstack/metadata-protocol';
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

const bulkDoor = through(sendThrownError);
const routeDoor = through(handleRouteError);
const singleDoor = (error: unknown, object?: string): Wire => mapDataError(error, object);

/**
 * The producers, each assembled to the shape its THROW SITE builds — the
 * envelope classes where a class is the contract, the same property writes
 * otherwise. Every entry names where the shape comes from, so a producer that
 * changes shape is traceable from here.
 */
interface Case {
    /** The `code` (or `name`, where the class is the gate) the arm keys on. */
    readonly covers: readonly string[];
    readonly what: string;
    readonly error: () => unknown;
    readonly object?: string;
    /** Fields the bulk door dropped before this fix. */
    readonly restored: readonly string[];
    readonly expect: Wire;
}

const DELETE_RESTRICTED_DEV =
    "Cannot delete account (a1): 3 dependent contact record(s) reference it via account_id. "
    + "Delete or reassign them first, or set deleteBehavior:'cascade' on contact.account_id.";

const CASES: readonly Case[] = [
    {
        covers: ['DELETE_RESTRICTED'],
        what: "engine.ts's referential-integrity restrict (`err.code`/`err.status`/`err.object`/"
            + '`err.dependentObject`/`err.dependentCount`/`err.developerMessage`)',
        error: () => {
            const err: any = new Error('Cannot delete this 客户 because 3 联系人 still reference it.');
            err.developerMessage = DELETE_RESTRICTED_DEV;
            err.code = 'DELETE_RESTRICTED';
            err.status = 409;
            err.object = 'account';
            err.dependentObject = 'contact';
            err.dependentCount = 3;
            return err;
        },
        // The `DELETE_RESTRICTED` arm names the object from the door's
        // `object` ARGUMENT (not `error.object`), which every affected route
        // supplies as `req.params?.object` — so the case supplies it too.
        object: 'account',
        restored: ['developerMessage', 'dependentObject', 'dependentCount', 'object'],
        expect: {
            status: 409,
            body: {
                error: 'Cannot delete this 客户 because 3 联系人 still reference it.',
                code: 'DELETE_RESTRICTED',
                developerMessage: DELETE_RESTRICTED_DEV,
                dependentObject: 'contact',
                dependentCount: 3,
                object: 'account',
            },
        },
    },
    {
        covers: ['CONCURRENT_UPDATE'],
        what: "metadata-protocol's ConcurrentUpdateError (readonly `status = 409`)",
        error: () => new ConcurrentUpdateError({
            currentVersion: '2026-09-02T10:00:00.000Z',
            currentRecord: { id: 'r1', name: 'after' },
            message: 'Record account/r1 was modified by another user '
                + '(current version 2026-09-02T10:00:00.000Z, expected 2026-09-02T09:00:00.000Z)',
        }),
        object: 'account',
        restored: ['currentVersion', 'currentRecord', 'object'],
        expect: {
            status: 409,
            body: {
                error: 'Record account/r1 was modified by another user '
                    + '(current version 2026-09-02T10:00:00.000Z, expected 2026-09-02T09:00:00.000Z)',
                code: 'CONCURRENT_UPDATE',
                currentVersion: '2026-09-02T10:00:00.000Z',
                currentRecord: { id: 'r1', name: 'after' },
                object: 'account',
            },
        },
    },
    {
        covers: ['DUPLICATE_RECORD'],
        what: "objectql's DuplicateRecordError (#14095/#14389; readonly `status = 409`)",
        error: () => new DuplicateRecordError('duly_note', new Error('SQLITE_CONSTRAINT_UNIQUE'), 'email'),
        restored: ['field', 'object', 'developerMessage'],
        expect: {
            status: 409,
            body: {
                error: 'A record with this email already exists',
                code: 'UNIQUE_VIOLATION',
                developerMessage: "Duplicate record refused on 'duly_note': a unique constraint on "
                    + "'email' already holds this value. No record was written.",
                field: 'email',
                object: 'duly_note',
            },
        },
    },
    {
        covers: ['FEEDS_DISABLED'],
        what: "plugin-audit's enable.feeds gate (`err.status = 403`, `err.object`)",
        error: () => {
            const err: any = new Error("Comments are disabled for object 'account' (enable.feeds: false)");
            err.code = 'FEEDS_DISABLED';
            err.status = 403;
            err.object = 'account';
            return err;
        },
        restored: ['object'],
        expect: {
            status: 403,
            body: {
                error: "Comments are disabled for object 'account' (enable.feeds: false)",
                code: 'FEEDS_DISABLED',
                object: 'account',
            },
        },
    },
    {
        covers: ['FILES_DISABLED'],
        what: "plugin-audit's enable.files gate (`err.status = 403`, `err.object`)",
        error: () => {
            const err: any = new Error("File attachments are not enabled for object 'account'");
            err.code = 'FILES_DISABLED';
            err.status = 403;
            err.object = 'account';
            return err;
        },
        restored: ['object'],
        expect: {
            status: 403,
            body: {
                error: "File attachments are not enabled for object 'account'",
                code: 'FILES_DISABLED',
                object: 'account',
            },
        },
    },
    {
        covers: ['ATTACHMENT_PARENT_ACCESS'],
        what: "service-storage's forbid() (`err.status = 403`, `err.object`)",
        error: () => {
            const err: any = new Error('You cannot attach files to a record you cannot see.');
            err.code = 'ATTACHMENT_PARENT_ACCESS';
            err.status = 403;
            err.object = 'account';
            return err;
        },
        restored: ['object'],
        expect: {
            status: 403,
            body: {
                error: 'You cannot attach files to a record you cannot see.',
                code: 'ATTACHMENT_PARENT_ACCESS',
                object: 'account',
            },
        },
    },
    {
        covers: ['ATTACHMENT_DELETE_DENIED'],
        what: "service-storage's forbid() (`err.status = 403`, `err.object`)",
        error: () => {
            const err: any = new Error('Only the uploader or a parent editor can delete this file.');
            err.code = 'ATTACHMENT_DELETE_DENIED';
            err.status = 403;
            err.object = 'account';
            return err;
        },
        restored: ['object'],
        expect: {
            status: 403,
            body: {
                error: 'Only the uploader or a parent editor can delete this file.',
                code: 'ATTACHMENT_DELETE_DENIED',
                object: 'account',
            },
        },
    },
    {
        covers: ['RECORD_NOT_ACCESSIBLE'],
        what: "plugin-audit's / service-storage's deny (`err.status = 403`, `err.object`)",
        error: () => {
            const err: any = new Error('Record access denied');
            err.code = 'RECORD_NOT_ACCESSIBLE';
            err.status = 403;
            err.object = 'account';
            return err;
        },
        restored: ['object'],
        expect: {
            status: 403,
            body: { error: 'Record access denied', code: 'RECORD_NOT_ACCESSIBLE', object: 'account' },
        },
    },
    {
        covers: ['INVALID_FIELD'],
        what: "engine.ts's unknown-field refusal (`err.status = 400`, `err.field`, `err.object`)",
        error: () => {
            const err: any = new Error("Unknown field 'emial' on object 'account'");
            err.status = 400;
            err.code = 'INVALID_FIELD';
            err.field = 'emial';
            err.fields = ['emial'];
            err.object = 'account';
            return err;
        },
        restored: ['field', 'object'],
        expect: {
            status: 400,
            body: {
                error: "Unknown field 'emial' on object 'account'",
                code: 'INVALID_FIELD',
                field: 'emial',
                object: 'account',
            },
        },
    },
    {
        // The CONTROL, and the ruling this card generalises: this code has had
        // door parity since #3770, by a named exclusion on the passthrough.
        // Its body must be byte-identical before and after.
        covers: ['OBJECT_NOT_FOUND'],
        what: "metadata-protocol's registry gate (`err.status = 404`, `err.object`) — #3770 control",
        error: () => {
            const err: any = new Error("Object 'nope' not found");
            err.code = 'OBJECT_NOT_FOUND';
            err.status = 404;
            err.object = 'nope';
            return err;
        },
        restored: [],
        expect: {
            status: 404,
            body: { error: "Object 'nope' is not registered", code: 'OBJECT_NOT_FOUND', object: 'nope' },
        },
    },
    {
        // A CONTROL of the other kind: measured, this producer declares NO
        // `status`, so the passthrough never fired for it and both doors
        // already agreed. The parity case exists so that stays true if a
        // future producer starts declaring one.
        covers: ['VALIDATION_FAILED'],
        what: '@objectstack/types `validationFailure()` — declares no `status` (control)',
        error: () => {
            const err: any = new Error('email is required');
            err.name = 'ValidationError';
            err.code = 'VALIDATION_FAILED';
            err.fields = [{ field: 'email', code: 'required', message: 'email is required' }];
            return err;
        },
        object: 'account',
        restored: [],
        expect: {
            status: 400,
            body: {
                error: 'email is required',
                code: 'VALIDATION_FAILED',
                fields: [{ field: 'email', code: 'required', message: 'email is required' }],
                object: 'account',
            },
        },
    },
    {
        // The third control: a 5xx ARM. Its producer declares no `status`
        // either, so both doors reach it today; §4 pins that it can never
        // displace a status a producer DID declare.
        covers: ['ERR_DATASOURCE_UNAVAILABLE'],
        what: "objectql's DatasourceUnavailableError — declares no `status` (control)",
        error: () => {
            const err: any = new Error("Datasource 'warehouse' is declared but not connected");
            err.code = 'ERR_DATASOURCE_UNAVAILABLE';
            err.datasource = 'warehouse';
            err.kind = 'blocked';
            return err;
        },
        object: 'account',
        restored: [],
        expect: {
            status: 503,
            body: {
                error: "Datasource 'warehouse' is declared but not connected",
                code: 'ERR_DATASOURCE_UNAVAILABLE',
                datasource: 'warehouse',
                reason: 'blocked',
                object: 'account',
            },
        },
    },
];

describe('#14541 · structured arms are consulted by BOTH doors', () => {
    describe('§1 door parity — one refusal, one body', () => {
        for (const c of CASES) {
            it(`${c.covers.join('/')} — ${c.what}`, () => {
                const single = singleDoor(c.error(), c.object);
                const bulk = bulkDoor(c.error(), c.object);
                expect(bulk.status).toBe(single.status);
                expect(bulk.body).toEqual(single.body);
                // ADR-0112: the refusal is asserted by code AND status, never
                // by "it errored".
                expect(bulk.status).toBe(c.expect.status);
                expect(bulk.body).toEqual(c.expect.body);
            });
        }
    });

    describe('§2 the fields the bulk door used to drop', () => {
        for (const c of CASES.filter((x) => x.restored.length > 0)) {
            it(`${c.covers.join('/')} carries ${c.restored.join(', ')}`, () => {
                const bulk = bulkDoor(c.error(), c.object);
                for (const key of c.restored) {
                    expect(bulk.body).toHaveProperty(key, (c.expect.body as any)[key]);
                }
            });
        }
    });

    describe('§3 the two sending doors agree with each other', () => {
        for (const c of CASES) {
            it(`${c.covers.join('/')}`, () => {
                expect(routeDoor(c.error(), c.object)).toEqual(bulkDoor(c.error(), c.object));
            });
        }
    });

    /**
     * [contract-review condition 4 / 5] Every guard case asserts BOTH doors.
     *
     * The review measured §4 pinning the bulk door alone in two shapes where
     * the doors are known to diverge, which pins the divergence silently — the
     * opposite of what triage guard 3 asks for. So each case below states its
     * verdict as one of two things and never as a single door's answer:
     *
     *   CONVERGED           — both doors answer the same status AND body;
     *   ACCEPTED DIVERGENCE — they differ, on purpose, with the reason and the
     *                         card that owns it named in the case itself.
     */
    describe('§4 the guards this fix is fenced by — both doors, every case', () => {
        it('CONVERGED: a 5xx ARM never displaces a status the producer declared in the 4xx band', () => {
            // Reviewer probe (A). Before the patch round the doors answered
            // 503 (single) and 400 (bulk) for this one error, because the
            // `structured.status < 500` guard existed only in
            // `resolveErrorResponse`. `fiveXxArmDisplacesDeclared4xx` is now
            // asked at both. No producer declares a status on this code, so
            // nothing moves on the wire.
            const err: any = new Error("Datasource 'warehouse' is declared but not connected");
            err.code = 'ERR_DATASOURCE_UNAVAILABLE';
            err.status = 400;
            err.datasource = 'warehouse';
            const bulk = bulkDoor(err, 'account');
            const single = singleDoor(err, 'account');
            expect(bulk.status).toBe(400);
            expect(single.status).toBe(400);
            expect(single.body.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
            expect(bulk.body.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
            // ⚠️ The bodies still differ by ONE key, and it is not this card's
            // defect: `classifyDataError`'s GENERIC declared-status passthrough
            // appends `object` from the door's argument and
            // `resolveErrorResponse`'s does not. Same door-disagreement class,
            // one arm over, untouched here and filed as #14725 — pinned so the
            // residue is visible rather than implied.
            expect(single.body).toHaveProperty('object', 'account');
            expect(bulk.body).not.toHaveProperty('object');
        });

        it('CONVERGED: the arm still answers 503 when the producer declared NO status', () => {
            const err: any = new Error("Datasource 'warehouse' is declared but not connected");
            err.code = 'ERR_DATASOURCE_UNAVAILABLE';
            err.datasource = 'warehouse';
            err.kind = 'blocked';
            const bulk = bulkDoor(err, 'account');
            const single = singleDoor(err, 'account');
            expect(bulk.status).toBe(503);
            expect(bulk.body).toEqual(single.body);
            expect(bulk.body).toHaveProperty('datasource', 'warehouse');
        });

        /**
         * FLIPPED by #14704, deliberately and in that card's PR, from
         * `ACCEPTED DIVERGENCE` to `CONVERGED (sentence)`. ⛔ The case is not
         * DELETED: it is the only thing that would notice the divergence coming
         * back, and what changes is its verdict, not its existence.
         *
         * The divergence it recorded was the SENTENCE: the bulk door read
         * `sandboxBusinessMessage` (#11588) while the single door reached the
         * arm and shipped `error.message` — the QuickJS debug wrapper. #14704
         * gave the code-gated arms the same two-read rule (`armSentence`), so
         * both doors now answer the business sentence for one hook refusal.
         *
         * ⚠️ What remains different is the KEY SET, and it is not this card's:
         * #14541's `isSandboxOrigin` guard declines the shared consult on the
         * bulk door outright, so the arm's structured fields never ride there.
         * That is stated below rather than left implied — a case labelled
         * CONVERGED whose bodies are unequal has to say where and why.
         */
        it('CONVERGED (sentence, #14704): a sandboxed producer — both doors ship the business sentence', () => {
            const err: any = new Error("hook 'guard' threw: Error: Opportunity is closed.");
            err.innerMessage = 'Opportunity is closed.';
            err.code = 'DELETE_RESTRICTED';
            err.status = 409;
            err.object = 'account';
            err.dependentObject = 'contact';
            const bulk = bulkDoor(err, 'account');
            const single = singleDoor(err, 'account');
            expect(bulk.status).toBe(409);
            expect(single.status).toBe(409);
            // The bulk door reads `sandboxBusinessMessage` (#11588) and ships
            // the business sentence; ⛔ never the QuickJS debug wrapper.
            expect(bulk.body.error).toBe('Opportunity is closed.');
            expect(String(bulk.body.error)).not.toContain('threw:');
            // [#14704] The single door now reads the same rule through the
            // arm. This assertion IS the flip — it read
            // `"hook 'guard' threw: Error: Opportunity is closed."` before.
            expect(single.body.error).toBe('Opportunity is closed.');
            expect(String(single.body.error)).not.toContain('threw:');
            // The residue, named: #14541's sandbox guard keeps the arm's
            // structured fields off the bulk door. Owned there, not here.
            expect(single.body).toHaveProperty('dependentObject', 'contact');
            expect(bulk.body).not.toHaveProperty('dependentObject');
        });

        it('ACCEPTED DIVERGENCE (guard 1): a producer-declared 5xx keeps the passthrough on the bulk door', () => {
            const err: any = new Error('Cannot delete: dependent records exist');
            err.code = 'DELETE_RESTRICTED';
            err.status = 503;
            err.object = 'account';
            err.dependentObject = 'contact';
            const bulk = bulkDoor(err, 'account');
            const single = singleDoor(err, 'account');
            // Guard 1: the 5xx half is NOT narrowed — status kept, prose
            // dropped unconditionally (#5437 / #5582 / #5907).
            expect(bulk.status).toBe(503);
            expect(bulk.body.code).toBe('DELETE_RESTRICTED');
            expect(bulk.body.error).not.toBe('Cannot delete: dependent records exist');
            expect(bulk.body).not.toHaveProperty('dependentObject');
            // The single door keeps reaching the arm for this shape, exactly
            // as it did before this card. Converging it would MOVE a status on
            // a published door, which is outside this card's fence — so it is
            // named here rather than silently pinned on one side.
            expect(single.status).toBe(409);
            expect(single.body).toHaveProperty('dependentObject', 'contact');
        });

        it('CONVERGED: a sandboxed OBJECT_NOT_FOUND keeps its `object` (the surviving #3770 clause)', () => {
            const err: any = new Error("hook 'guard' threw: Error: Object 'nope' not found");
            err.innerMessage = "Object 'nope' not found";
            err.code = 'OBJECT_NOT_FOUND';
            err.status = 404;
            err.object = 'nope';
            const bulk = bulkDoor(err, 'nope');
            const single = singleDoor(err, 'nope');
            expect(bulk.status).toBe(404);
            expect(bulk.body).toEqual(single.body);
            expect(bulk.body.code).toBe('OBJECT_NOT_FOUND');
            expect(bulk.body).toHaveProperty('object', 'nope');
        });

        /**
         * [contract-review condition 5] The one status this change DOES move,
         * pinned rather than left as a sentence.
         *
         * On `origin/main` a sandboxed producer declaring a 5xx with code
         * `OBJECT_NOT_FOUND` / `INVALID_FIELD` fell PAST the unwrap door
         * (declared >= 500) into the arm below it and answered 404 / 400. The
         * arms now carry `!isSandboxOrigin`, so the same shape keeps the
         * declared 5xx with the prose withheld — #5582's rule, on both doors.
         * Better, but a status move on the single-record door, and the
         * changeset says so.
         */
        it('MOVED (stated): a sandboxed 5xx + OBJECT_NOT_FOUND keeps the declared 5xx on both doors', () => {
            const err: any = new Error("hook 'guard' threw: Error: Object 'nope' not found");
            err.innerMessage = "Object 'nope' not found";
            err.code = 'OBJECT_NOT_FOUND';
            err.status = 503;
            err.object = 'nope';
            const bulk = bulkDoor(err, 'nope');
            const single = singleDoor(err, 'nope');
            expect(bulk.status).toBe(503);
            expect(single.status).toBe(503);
            expect(bulk.body).toEqual(single.body);
            expect(bulk.body.code).toBe('OBJECT_NOT_FOUND');
            // #5437/#5582: the 5xx band never ships the producer's prose.
            expect(bulk.body.error).not.toContain('nope');
            expect(bulk.body).not.toHaveProperty('object');
        });

        it('MOVED (stated): a sandboxed 5xx + INVALID_FIELD keeps the declared 5xx on both doors', () => {
            const err: any = new Error("hook 'guard' threw: Error: Unknown field 'emial'");
            err.innerMessage = "Unknown field 'emial'";
            err.code = 'INVALID_FIELD';
            err.status = 502;
            err.field = 'emial';
            err.object = 'account';
            const bulk = bulkDoor(err, 'account');
            const single = singleDoor(err, 'account');
            expect(bulk.status).toBe(502);
            expect(single.status).toBe(502);
            expect(bulk.body).toEqual(single.body);
            expect(bulk.body.code).toBe('INVALID_FIELD');
            expect(bulk.body).not.toHaveProperty('field');
        });

        it('CONVERGED: a producer-marked `userMessage` rides the restored body (#9934)', () => {
            const err: any = new Error('Cannot delete: dependent records exist');
            err.code = 'DELETE_RESTRICTED';
            err.status = 409;
            err.object = 'account';
            err.userMessage = '请先处理关联的联系人。';
            const bulk = bulkDoor(err, 'account');
            const single = singleDoor(err, 'account');
            expect(bulk.body).toEqual(single.body);
            expect(bulk.body).toHaveProperty('userMessage', '请先处理关联的联系人。');
        });
    });

    /**
     * [contract-review condition 3] The drift guard has to cover BOTH halves
     * of `classifyDataError`, not just the lifted one.
     *
     * The first version scanned only the `structuredCodeAnswer` slice. A new
     * bespoke arm added to `classifyDataError` BELOW the consult — exactly
     * where `OBJECT_NOT_FOUND` and `INVALID_FIELD` sat before this card —
     * reproduces the card's defect (reachable from one door only) and nothing
     * would have fired. Triage guard 3 asks that "the next code with a
     * structured arm cannot diverge silently again", so the scan now collects
     * every declared-code literal in the whole function and requires each to
     * be either a §1 parity case or a NAMED single-door arm with its reason.
     */
    describe('§5 drift guard — every declared-code arm is covered or explained', () => {
        /**
         * Arms reachable from `mapDataError` only. Two KINDS, deliberately kept
         * apart — an allowlist that cannot tell "by design" from "not fixed
         * yet" is the same defect as no allowlist:
         *
         *   `by-design`  the arm answers one door on purpose, and the entry
         *                says why the shared classification does not want it;
         *   `known-gap`  the arm IS an instance of this card's defect, left
         *                open on purpose, and the entry MUST cite the card
         *                that carries it. Green by disclosure, never by
         *                omission.
         *
         * ⛔ Adding an entry is a decision, not a way to quiet the test.
         */
        const SINGLE_DOOR_ONLY: ReadonlyArray<{
            code: string;
            kind: 'by-design' | 'known-gap';
            card?: number;
            why: string;
        }> = [
            {
                code: 'PERMISSION_DENIED',
                kind: 'by-design',
                why: 'its third limb is gated on message TEXT (`[Security] Access denied`), '
                    + 'and the shared classification is declared-code only — lifting a text '
                    + 'sniff above the passthrough is what `resolveErrorResponse` argues against. '
                    + 'Measured: its producer declares `statusCode`, not `status`, so the '
                    + 'passthrough never fires for it and both doors already agree.',
            },
            {
                code: 'RECORD_NOT_FOUND',
                kind: 'known-gap',
                card: 14725,
                why: 'a REAL instance of this card\'s defect, found by this very guard: '
                    + '`recordNotFoundError` (@objectstack/core) declares code, `status = 404` '
                    + 'and `object`, so the bulk doors take the passthrough and drop `object` '
                    + 'while the single door reaches the arm. Not lifted here because (a) its '
                    + 'second limb is a message-TEXT gate, outside the declared-code boundary, '
                    + 'and (b) this PR\'s wire delta was measured and contract-reviewed over a '
                    + 'fixed set of codes — an eleventh body change after that verdict would be '
                    + 'an unreviewed delta. #14725 carries it.',
            },
        ];

        function sliceOf(source: string, from: string, to: string): string {
            const a = source.indexOf(from);
            const b = source.indexOf(to, a + 1);
            expect(a).toBeGreaterThan(-1);
            expect(b).toBeGreaterThan(a);
            return source.slice(a, b);
        }

        function codeLiterals(slice: string): Set<string> {
            const out = new Set<string>();
            for (const m of slice.matchAll(/error\?\.code === '([A-Z_]+)'/g)) out.add(m[1]);
            return out;
        }

        const SOURCE = readFileSync(resolve(HERE, 'error-response.ts'), 'utf8');

        it('every arm in the SHARED classification has a §1 parity case', () => {
            const declared = codeLiterals(
                sliceOf(SOURCE, 'function structuredCodeAnswer(', 'function classifyDataError('),
            );
            const covered = new Set(CASES.flatMap((c) => c.covers));
            expect(declared.size).toBeGreaterThan(0);
            expect([...declared].filter((code) => !covered.has(code))).toEqual([]);
        });

        it('every arm BELOW the consult is a §1 case or a named single-door arm', () => {
            // The whole function, so an arm added below the consult — the
            // position that reproduced this card's defect — is seen too.
            const declared = codeLiterals(
                sliceOf(SOURCE, 'function classifyDataError(', '\nexport function sendThrownError('),
            );
            const covered = new Set(CASES.flatMap((c) => c.covers));
            const excused = new Set(SINGLE_DOOR_ONLY.map((e) => e.code));
            expect(declared.size).toBeGreaterThan(0);
            expect([...declared].filter((code) => !covered.has(code) && !excused.has(code))).toEqual([]);
        });

        it('the allowlist is not a dumping ground: every entry is a live arm, reasoned, and a gap cites its card', () => {
            const whole = sliceOf(SOURCE, 'function classifyDataError(', '\nexport function sendThrownError(');
            for (const entry of SINGLE_DOOR_ONLY) {
                // An entry for an arm that no longer exists is stale cover.
                expect(whole).toContain(`error?.code === '${entry.code}'`);
                expect(entry.why.length).toBeGreaterThan(60);
                // A known gap without a card is exactly the silence this
                // guard exists to break.
                if (entry.kind === 'known-gap') expect(typeof entry.card).toBe('number');
            }
        });
    });

    /**
     * [contract-review condition 6] The two families that reach
     * `resolveErrorResponse` through {@link classifiedRefusalAnswer} rather
     * than through a route's `handleRouteError` catch.
     *
     * `POST /api/v1/analytics/dataset/query` spreads every classified key onto
     * its own envelope (`const { error: refusalText, ...refusalFields } =
     * refusal.body`), so a widened classification widens that body too — and
     * its existing envelope tests assert `code` and a message regex only, so
     * nothing held the KEYS. `service-analytics` throws `INVALID_FIELD` with
     * `status`, `field` and `object` at three sites, which is exactly the arm
     * this card lifted.
     *
     * Pinned against `classifiedRefusalAnswer` itself rather than by booting
     * the route: that function IS what the route spreads, and `rest-server.ts`
     * is held by another branch.
     */
    describe('§6 the classifiedRefusalAnswer families', () => {
        it('the analytics refusal body gains `field` and `object` for an INVALID_FIELD producer', () => {
            const err: any = new Error("Unknown measure 'amout_sum' on object 'invoice'");
            err.code = 'INVALID_FIELD';
            err.status = 400;
            err.field = 'amout_sum';
            err.object = 'invoice';
            err.param = 'measures';
            const refusal = classifiedRefusalAnswer(err);
            expect(refusal).toBeDefined();
            expect(refusal!.status).toBe(400);
            // The KEY SET is the contract here — the existing analytics
            // envelope tests assert only `code` and a message shape.
            expect(Object.keys(refusal!.body).sort()).toEqual(['code', 'error', 'field', 'object']);
            expect(refusal!.body.code).toBe('INVALID_FIELD');
            expect(refusal!.body.field).toBe('amout_sum');
            expect(refusal!.body.object).toBe('invoice');
            // ⛔ `param` is NOT relayed: the arm ships what it declares, and a
            // producer key nobody classified does not reach the wire.
            expect(refusal!.body).not.toHaveProperty('param');
        });

        it('the record-share family keeps its own key set; only the SENTENCE moves', () => {
            // That family re-dresses `code` / `declaredCode` / `userMessage` /
            // `error` into the nested ADR-0112 D5 envelope, so the widened
            // classification cannot add keys there. What it does change is the
            // sentence a DuplicateRecordError produces.
            const err: any = new Error("Duplicate record refused on 'sys_record_share'");
            err.name = 'DuplicateRecordError';
            err.code = 'DUPLICATE_RECORD';
            err.status = 409;
            err.object = 'sys_record_share';
            err.field = 'token';
            const refusal = classifiedRefusalAnswer(err);
            expect(refusal).toBeDefined();
            expect(refusal!.status).toBe(409);
            expect(refusal!.body.code).toBe('UNIQUE_VIOLATION');
            expect(refusal!.body.error).toBe('A record with this token already exists');
        });
    });
});
