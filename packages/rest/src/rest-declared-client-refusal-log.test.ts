// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#23932] A PRODUCER-DECLARED client refusal is not logged as
// "[REST] Unhandled error".
//
// Two refusals answered correctly on the wire and still printed an error-level
// line plus a full stack on every request, because the log verdict only knew
// the codes `isExpectedRouteError` names:
//
//  - `service-storage`'s `FileConstraintError` — `code: 'ERR_FILE_CONSTRAINT'`,
//    `status: 400` — on a record write whose file violates the field's declared
//    `accept` / `maxSize` (`POST /api/v1/data/:object`, the `mapDataError` +
//    `logUnexpectedRouteError` door);
//  - `metadata-protocol`'s `saveMetaItem` spec-validation refusal —
//    `code: 'INVALID_METADATA'`, `status: 422`, `issues` — on a metadata save
//    (`PUT /api/v1/meta/:type/:name`, the `handleRouteError` door).
//
// The verdict now reads the producer's DECLARATION (a declared 4xx status AND
// its own registered ADR-0112 code reaching the wire) rather than growing the
// list by two names, so the next declared refusal is not the next card. Both
// errors are built here in the exact shape the real producers throw (measured
// on the real classes through these same routes); `@objectstack/rest` does not
// depend on `service-storage`, so the class is mirrored rather than imported.
//
// The CONTROLS are the half that keeps this from becoming "any 4xx": a handler
// bug, an un-coded 400, a coded 4xx whose code is not registered, a registered
// code on a status the producer did not declare, a registered fault-shaped code
// on a 5xx, and a sandbox crash that declared a 4xx envelope all stay loud.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { RestServer } from './rest-server.js';

// This file observes the REST fault log, so it declares the level it asserts
// against ('info' is the shipped default) instead of the suite's quiet one.
beforeAll(() => { vi.stubEnv('OS_REST_LOG', 'info'); });
afterAll(() => { vi.unstubAllEnvs(); });

const DATA_CREATE = '/api/v1/data/:object';
const META_SAVE = '/api/v1/meta/:type/:name';

/** Mirrors `FileConstraintError` (`service-storage/src/file-reference-lifecycle.ts`) field for field. */
class FileConstraintError extends Error {
    readonly code = 'ERR_FILE_CONSTRAINT';
    readonly status = 400;
    readonly field: string;
    readonly constraint: 'accept' | 'maxSize';
    constructor(field: string, constraint: 'accept' | 'maxSize', message: string) {
        super(message);
        this.field = field;
        this.constraint = constraint;
    }
}

const ACCEPT_MESSAGE =
    "File type 'application/pdf' is not permitted by the accept list declared for 'poster' (image/png, image/jpeg)";

/** The card's step 4: a PDF written into an image field declaring `accept: ['image/png', 'image/jpeg']`. */
const acceptRefusal = () => new FileConstraintError('poster', 'accept', ACCEPT_MESSAGE);

const SPEC_ISSUES = [{
    path: '',
    message: 'Unrecognized key(s) on this translation: `o`.',
    code: 'unrecognized_keys',
}];

/** `saveMetaItem`'s spec-validation throw on the `meta-envelope` face (the card's step 5). */
function specValidationRefusal() {
    const err = new Error('translation/qa_strict_zh failed spec validation: 1 issue — <root> [unrecognized_keys]');
    (err as any).code = 'INVALID_METADATA';
    (err as any).status = 422;
    (err as any).issues = SPEC_ISSUES;
    return err;
}

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

/** A RestServer whose `createData` AND `saveMetaItem` both reject with `thrown`. */
function serverRejecting(thrown: unknown) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([{ name: 'qa_media' }]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
        createData: vi.fn().mockRejectedValue(thrown),
        saveMetaItem: vi.fn().mockRejectedValue(thrown),
    };
    const rest: any = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: false } } as any);
    // The meta save route demands `manage_metadata`; the data route only a session.
    rest.resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    return rest;
}

async function call(rest: any, method: 'POST' | 'PUT', path: string, req: Record<string, unknown>) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    const res = makeRes();
    await route.handler({ method, query: {}, headers: {}, ...req }, res);
    return res;
}

/** `POST /api/v1/data/qa_media` — the `mapDataError` + `logUnexpectedRouteError` door. */
const postRecord = (rest: any) =>
    call(rest, 'POST', DATA_CREATE, { params: { object: 'qa_media' }, body: { name: 'accept-probe', poster: 'file_1' } });

/** `PUT /api/v1/meta/translation/qa_strict_zh` — the `handleRouteError` door. */
const putMeta = (rest: any) =>
    call(rest, 'PUT', META_SAVE, {
        params: { type: 'translation', name: 'qa_strict_zh' },
        body: { name: 'qa_strict_zh', locale: 'zh-CN', objects: { showcase_task: { label: 'x' } }, o: { x: 1 } },
    });

const DOORS = [
    ['POST /api/v1/data/:object', postRecord],
    ['PUT /api/v1/meta/:type/:name', putMeta],
] as const;

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

/** The "[REST] Unhandled error" lines, each carrying the logged error second. */
const unhandledLogs = () => errorSpy.mock.calls.filter((c: unknown[]) => c[0] === '[REST] Unhandled error:');
/** Did ANY console.error call carry this thrown object (a stack under any label)? */
const loggedObject = (thrown: unknown) => errorSpy.mock.calls.some((c: unknown[]) => c.includes(thrown));

describe('[#23932] the two reported refusals answer as before and log nothing', () => {
    it('a refused accept write: 400 ERR_FILE_CONSTRAINT on the wire, no "[REST] Unhandled error", no stack', async () => {
        const thrown = acceptRefusal();
        const res = await postRecord(serverRejecting(thrown));

        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: ACCEPT_MESSAGE, code: 'ERR_FILE_CONSTRAINT', object: 'qa_media' });
        expect(unhandledLogs()).toHaveLength(0);
        expect(loggedObject(thrown)).toBe(false);
    });

    it('a refused metadata save: 422 INVALID_METADATA with its issues on the wire, no "[REST] Unhandled error", no stack', async () => {
        const thrown = specValidationRefusal();
        const res = await putMeta(serverRejecting(thrown));

        expect(res.statusCode).toBe(422);
        expect(res.body).toEqual({
            error: 'translation/qa_strict_zh failed spec validation: 1 issue — <root> [unrecognized_keys]',
            code: 'INVALID_METADATA',
            issues: SPEC_ISSUES,
        });
        expect(unhandledLogs()).toHaveLength(0);
        expect(loggedObject(thrown)).toBe(false);
    });

    it('one verdict at both doors: each refusal is quiet through the other door too', async () => {
        for (const [, door] of DOORS) {
            const file = await door(serverRejecting(acceptRefusal()));
            expect(file.statusCode).toBe(400);
            expect(file.body.code).toBe('ERR_FILE_CONSTRAINT');
            const meta = await door(serverRejecting(specValidationRefusal()));
            expect(meta.statusCode).toBe(422);
            expect(meta.body.code).toBe('INVALID_METADATA');
        }
        expect(unhandledLogs()).toHaveLength(0);
    });

    it('the read is the declaration, not a list: a sibling declared refusal no predicate names is quiet too', async () => {
        // `FileFieldBulkWriteError` (`service-storage`): registered, declared 400,
        // named nowhere in `isExpectedRouteError`. Adding the two reported codes by
        // name would leave this one printing a stack per request.
        const bulk = Object.assign(new Error("Refusing a multi-record update that writes a file id into 'qa_media.poster'"), {
            code: 'FILE_FIELD_BULK_WRITE_REFUSED', status: 400,
        });
        const rateLimited = Object.assign(new Error('Too many saves; retry in 60 seconds'), {
            code: 'RATE_LIMIT_EXCEEDED', statusCode: 429,
        });
        for (const [, door] of DOORS) {
            expect((await door(serverRejecting(bulk))).statusCode).toBe(400);
            expect((await door(serverRejecting(rateLimited))).statusCode).toBe(429);
        }
        expect(unhandledLogs()).toHaveLength(0);
    });
});

describe('[#23932] controls that stay LOUD — the verdict is not "any 4xx"', () => {
    /** Asserts `thrown` reached "[REST] Unhandled error" once per door, by identity, and returns the answers. */
    async function expectLoudAtBothDoors(thrown: unknown) {
        const answers = [];
        for (const [, door] of DOORS) answers.push(await door(serverRejecting(thrown)));
        expect(unhandledLogs()).toHaveLength(DOORS.length);
        for (const line of unhandledLogs()) expect(line[1]).toBe(thrown);
        return answers;
    }

    it('a handler bug (TypeError) is a 500 and logs with its stack', async () => {
        const bug = new TypeError("Cannot read properties of undefined (reading 'name')");
        for (const res of await expectLoudAtBothDoors(bug)) {
            expect(res.statusCode).toBe(500);
            expect(res.body.code).toBe('INTERNAL_ERROR');
        }
    });

    it('an un-coded business-rule 400 (a sandboxed hook refusal) logs', async () => {
        const hookRefusal = Object.assign(new Error("hook 'guard' threw: Error: Opportunity is closed."), {
            innerMessage: 'Opportunity is closed.',
        });
        for (const res of await expectLoudAtBothDoors(hookRefusal)) {
            expect(res.statusCode).toBe(400);
            // [#27597] It carries `HOOK_ABORTED` now; the log verdict is not
            // that card's, so it still logs.
            expect(res.body.code).toBe('HOOK_ABORTED');
        }
    });

    it('a declared 400 with no code (half an envelope) logs', async () => {
        const uncoded = Object.assign(new Error('bad input'), { status: 400 });
        for (const res of await expectLoudAtBothDoors(uncoded)) {
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBeUndefined();
        }
    });

    it('a declared 400 whose code is NOT registered logs (demoted to declaredCode on the wire)', async () => {
        const unregistered = Object.assign(new Error('nope'), { code: 'QA_NOT_A_REGISTERED_CODE', status: 400 });
        for (const res of await expectLoudAtBothDoors(unregistered)) {
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('VALIDATION_ERROR');
            expect(res.body.declaredCode).toBe('QA_NOT_A_REGISTERED_CODE');
        }
    });

    it('a registered code on a status the producer did NOT declare logs (the door defaulted the 400)', async () => {
        const undeclaredStatus = Object.assign(new Error("hook 'guard' threw: Error: bad"), {
            innerMessage: 'bad', code: 'INVALID_METADATA',
        });
        for (const res of await expectLoudAtBothDoors(undeclaredStatus)) {
            expect(res.statusCode).toBe(400);
            expect(res.body.code).toBe('INVALID_METADATA');
        }
    });

    it('a registered fault-shaped code on a declared 5xx logs (registration alone is not the test)', async () => {
        const fault = Object.assign(new Error('store exploded'), { code: 'INTERNAL', status: 500 });
        for (const res of await expectLoudAtBothDoors(fault)) {
            expect(res.statusCode).toBe(500);
            expect(res.body.code).toBe('INTERNAL');
        }
    });

    it('a sandboxed body that CRASHED while declaring a 4xx envelope is a 500 and logs', async () => {
        const crash = Object.assign(new Error("hook 'guard' threw: TypeError: x is not a function"), {
            innerMessage: 'TypeError: x is not a function', code: 'ERR_FILE_CONSTRAINT', status: 400,
        });
        for (const res of await expectLoudAtBothDoors(crash)) {
            expect(res.statusCode).toBe(500);
            expect(res.body.code).toBe('INTERNAL_ERROR');
        }
    });
});

describe('[#23932] a control that stays QUIET — the existing expected outcomes', () => {
    it('VALIDATION_FAILED 400 and a structured 404 still print nothing', async () => {
        const validation = Object.assign(new Error('bad'), { code: 'VALIDATION_FAILED', status: 400 });
        const noDraft = Object.assign(new Error('[no_draft] No pending draft exists for app/showcase_app.'), {
            code: 'NO_DRAFT', status: 404,
        });
        for (const [, door] of DOORS) {
            expect((await door(serverRejecting(validation))).statusCode).toBe(400);
            expect((await door(serverRejecting(noDraft))).statusCode).toBe(404);
        }
        expect(unhandledLogs()).toHaveLength(0);
    });
});
