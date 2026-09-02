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
 *  §4 the three guards the fix is fenced by — a declared 5xx keeps the
 *     passthrough's prose-withholding arm (#5437 / #5582 / #5907), a 5xx ARM
 *     never displaces a declared 4xx, and a sandboxed producer keeps the
 *     unwrap door's sentence (#11588 / #7543);
 *  §5 the drift guard: every `code` literal inside `structuredCodeAnswer` is
 *     covered by a §1 case. Adding an arm without a parity case fails here,
 *     which is the whole point — an exclusion list is what this card is the
 *     bill for, and a coverage list nobody checks is the same defect.
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
import { mapDataError, sendThrownError, handleRouteError } from './error-response.js';

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

    describe('§4 the guards this fix is fenced by', () => {
        it('a producer-declared 5xx still takes the passthrough, prose withheld (#5437/#5582)', () => {
            const err: any = new Error('Cannot delete: dependent records exist');
            err.code = 'DELETE_RESTRICTED';
            err.status = 503;
            err.object = 'account';
            err.dependentObject = 'contact';
            const bulk = bulkDoor(err, 'account');
            expect(bulk.status).toBe(503);
            expect(bulk.body.code).toBe('DELETE_RESTRICTED');
            // The 5xx arm's whole point: the producer's own sentence never
            // reaches the client, and nothing about that is narrowed here.
            expect(bulk.body.error).not.toBe('Cannot delete: dependent records exist');
            expect(bulk.body).not.toHaveProperty('dependentObject');
        });

        it('a 5xx ARM never displaces a status the producer declared', () => {
            const err: any = new Error("Datasource 'warehouse' is declared but not connected");
            err.code = 'ERR_DATASOURCE_UNAVAILABLE';
            err.status = 400;
            err.datasource = 'warehouse';
            const bulk = bulkDoor(err, 'account');
            expect(bulk.status).toBe(400);
            expect(bulk.body.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
        });

        it('a sandboxed producer keeps the unwrap door’s sentence (#11588/#7543)', () => {
            const err: any = new Error("hook 'guard' threw: Error: Opportunity is closed.");
            err.innerMessage = 'Opportunity is closed.';
            err.code = 'DELETE_RESTRICTED';
            err.status = 409;
            err.object = 'account';
            err.dependentObject = 'contact';
            const bulk = bulkDoor(err, 'account');
            expect(bulk.status).toBe(409);
            expect(bulk.body.error).toBe('Opportunity is closed.');
            // ⛔ never the QuickJS debug wrapper.
            expect(String(bulk.body.error)).not.toContain('threw:');
        });

        it('a sandboxed OBJECT_NOT_FOUND keeps its `object` (the surviving #3770 clause)', () => {
            const err: any = new Error("hook 'guard' threw: Error: Object 'nope' not found");
            err.innerMessage = "Object 'nope' not found";
            err.code = 'OBJECT_NOT_FOUND';
            err.status = 404;
            err.object = 'nope';
            const bulk = bulkDoor(err, 'nope');
            expect(bulk.status).toBe(404);
            expect(bulk.body.code).toBe('OBJECT_NOT_FOUND');
            expect(bulk.body).toHaveProperty('object', 'nope');
        });

        it('a producer-marked `userMessage` rides the restored body (#9934)', () => {
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

    describe('§5 drift guard — every arm in the shared classification is covered', () => {
        it('no `code` literal in structuredCodeAnswer is missing a §1 case', () => {
            const source = readFileSync(resolve(HERE, 'error-response.ts'), 'utf8');
            const start = source.indexOf('function structuredCodeAnswer(');
            const end = source.indexOf('function classifyDataError(', start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            const slice = source.slice(start, end);
            const declared = new Set<string>();
            for (const m of slice.matchAll(/error\?\.code === '([A-Z_]+)'/g)) declared.add(m[1]);
            const covered = new Set(CASES.flatMap((c) => c.covers));
            expect(declared.size).toBeGreaterThan(0);
            expect([...declared].filter((code) => !covered.has(code))).toEqual([]);
        });
    });
});
