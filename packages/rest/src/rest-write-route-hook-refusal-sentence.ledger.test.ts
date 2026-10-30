// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22694] Every write route in the REST ledger, driven with a sandboxed hook's
 * refusal: enumerated from {@link REST_ROUTE_LEDGER}, not hand-listed.
 *
 * ## What was measured broken
 *
 * On a booted stack at `d8830c2805` (`@objectstack/verify`'s `bootStack`,
 * sqlite-wasm), a `beforeInsert` hook body throwing `new Error('Locked rows
 * cannot be created by import.')`: `POST /data/:object` and `/createMany`
 * answered `400` with that sentence, while `POST /data/:object/import` answered
 * `200` with `results[0].error` = `hook 'mz_lock_insert' threw: Error: Locked
 * rows …` (`IMPORT_ROW_FAILED`), and the async job's stored row read the same.
 * The producer was `toFailedResult` in `@objectstack/core`'s import runner,
 * which now reads the sentence through `sandboxBusinessMessage`. Both import
 * doors are driven below through the real handlers and the real `runImport`.
 *
 * ## The population, and the three dispositions
 *
 * The rows are every `POST` / `PUT` / `PATCH` / `DELETE` row of the ledger, so a
 * write route ledgered later fails {@link describe} §1 until it is given one of:
 *
 *  - {@link ANSWERS_THE_SENTENCE} — driven: the downstream the handler awaits
 *    (the protocol method or the service) rejects with the refusal, and the
 *    answer must be the hook's own sentence with no trace of the wrapper. The
 *    named downstream must really have been called, so a row answered by some
 *    earlier refusal (a validation 400, a capability 403) cannot pass.
 *  - {@link ANSWERS_THE_WRAPPER} — driven the same way and MEASURED to answer
 *    the debug wrapper. [#22719] EMPTY, and §3 holds it empty: its twenty rows
 *    — hand-built error arms that relayed `.message` (sharing rules, suggested
 *    bindings and the overlay discard, approvals, `packages/publish`, external
 *    datasources; the overlay discard has since retired with its route) — each read the hook's sentence through the shared read now
 *    and sit in the first map, pinned at the status and code they answer. A
 *    write door found answering the wrapper is a defect to repair, never a row
 *    to add back here.
 *  - {@link NO_REFUSAL_REACHES_THE_ANSWER} — not driven, with the reason.
 *
 * The refusal is the shape `runtime/src/sandbox/quickjs-runner.ts` produces
 * (`.message` the wrapper, `.innerMessage` the sentence), reproduced here as
 * `rest-hook-refusal-message-parity.test.ts` does, because this package does
 * not depend on `@objectstack/runtime`.
 *
 * ## [#22764] The fault side, over the same population
 *
 * §6 drives every row §2 drives with the two sandbox shapes the doors answer
 * as FAULTS — a body that crashed, and a refusal that declared a 5xx — and
 * holds each to the doors' answer: their status and code, their withheld
 * sentence, and no trace of the native text or the wrapper. §2 stays the
 * control: a refusal keeps its sentence on the same rows.
 *
 * [#22885] …and with the sandbox's OWN fault, one shape per kind the runner
 * raises itself (`isSandboxOwnFault`), held to the same answer. Measured
 * before the repair: twenty-three of these rows relayed the runner's text at
 * their own terminal, while the crash and declared-5xx shapes, the CONTROL,
 * already read the doors' answer on every row and are unchanged by it.
 */

import { describe, it, expect, vi, beforeAll, afterAll, type MockInstance } from 'vitest';
import { RestServer } from './rest-server.js';
import { mountAndRecordDirectRoutes } from './direct-mount-composition.js';
import { REST_ROUTE_LEDGER } from './rest-route-ledger.js';
import { sandboxFaultAnswer } from './error-response.js';
import { isSandboxOwnFault } from '@objectstack/types';

const SENTENCE = 'Locked rows cannot be changed here.';
const WRAPPER = `hook 'mz_guard' threw: Error: ${SENTENCE}`;
const WRAPPER_RE = /threw:|hook '/;
const OBJECT = 'mz_locked';

function sandboxRefusal(): Error {
    const err = new Error(WRAPPER);
    err.name = 'SandboxError';
    return Object.assign(err, { innerMessage: SENTENCE });
}

/**
 * The words a crashed body's native error carries. A long unique marker, never
 * a short word: the leak checks match the WHOLE response body, which also holds
 * generated ids and timestamps in base36, and a short sentinel such as `boom`
 * can be spelled by one of those by chance. `TypeError` stays in the pattern
 * because a lowercase base36 id cannot spell it.
 */
const CRASH_WORDS = '__OS_SANDBOX_FAULT_7f3a9c__';
const CRASH_LEAK = new RegExp(`TypeError|${CRASH_WORDS}`);

/** A body that CRASHED: the runner sets `innerMessage` to the native error text. */
function sandboxCrash(): Error {
    const err = new Error(`hook 'mz_guard' threw: TypeError: ${CRASH_WORDS}`);
    err.name = 'SandboxError';
    return Object.assign(err, { innerMessage: `TypeError: ${CRASH_WORDS}` });
}

const WRITE_ROWS = REST_ROUTE_LEDGER.filter((row) => /^(POST|PUT|PATCH|DELETE) /.test(row.route));

// ─── the harness ────────────────────────────────────────────────────────────

const SCHEMA = { name: OBJECT, label: 'Locked', fields: { name: { name: 'name', type: 'text' } } };
const FORM_VIEW = {
    name: 'mz_form', object: OBJECT, viewKind: 'form', _diagnostics: { valid: true },
    config: {
        data: { object: OBJECT },
        sections: [{ fields: ['name'] }],
        sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/mz-form' },
    },
};

type Fn = (...args: any[]) => any;

/** Reads the harness answers; every other protocol method rejects with the refusal. */
const READS: Record<string, Fn> = {
    getDiscovery: async () => ({ version: 'v0', routes: {} }),
    getMetaTypes: async () => [],
    getMetaItems: async (req: { type?: string }) => (req?.type === 'view' ? [FORM_VIEW] : [SCHEMA]),
    getMetaItem: async () => SCHEMA,
    findData: async () => ({ records: [] }),
    getData: async () => ({ record: { id: 'r1' } }),
};

/** A service (or protocol) whose every method records its call and rejects with `error()`. */
function rejecting(label: string, calls: string[], error: () => Error, own: Record<string, Fn> = {}): any {
    return new Proxy({}, {
        get: (_t, key) => {
            if (key === 'then' || typeof key === 'symbol') return undefined;
            const name = String(key);
            return (...args: unknown[]) => {
                calls.push(`${label}.${name}`);
                return own[name] ? own[name](...args) : Promise.reject(error());
            };
        },
    });
}

interface Booted {
    calls: string[];
    protocolCalls: Array<{ method: string; args: any[] }>;
    handlerOf(route: string): Fn;
}

function boot(error: () => Error, protocol: Record<string, Fn> = {}): Booted {
    const calls: string[] = [];
    const protocolCalls: Array<{ method: string; args: any[] }> = [];
    const own = { ...READS, ...protocol };
    const recorded: Record<string, Fn> = {};
    for (const [name, fn] of Object.entries(own)) {
        recorded[name] = (...args: any[]) => { protocolCalls.push({ method: name, args }); return fn(...args); };
    }
    const direct = new Map<string, Fn>();
    const server: any = { use() {}, async listen() {}, async close() {} };
    for (const verb of ['get', 'post', 'put', 'delete', 'patch']) {
        server[verb] = (path: string, handler: Fn) => direct.set(`${verb.toUpperCase()} ${path}`, handler);
    }
    const service = (label: string) => async () => rejecting(label, calls, error);
    const caller = { userId: 'u1', systemPermissions: ['manage_metadata', 'manage_platform_settings'] };
    const engine = { transaction: async (fn: Fn) => fn({}) };
    const rest = new RestServer(
        server,
        rejecting('protocol', calls, error, recorded),
        { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined,
        async () => engine,                 // objectQLProvider (`POST /batch`)
        service('email'),
        service('sharing'),
        undefined,                          // retired slot
        service('approvals'),
        service('sharingRules'),
        undefined,                          // i18n
        service('analytics'),
        undefined, undefined,               // settings, serviceExists
        service('security'),
    );
    (rest as any).resolveExecCtx = async () => caller;
    rest.registerRoutes();
    mountAndRecordDirectRoutes({
        server,
        recorder: rest,
        ctx: {
            getService: (name: string) => rejecting(`service:${name}`, calls, error),
            logger: { debug() {}, info() {}, warn() {}, error() {} },
        } as any,
        versionedBase: '/api/v1',
        resolveExecutionContext: async () => caller as any,
    });
    const managed = rest.getRoutes();
    return {
        calls,
        protocolCalls,
        handlerOf(route) {
            const [verb, path] = route.split(' ');
            const handler = managed.find((r) => r.method.toUpperCase() === verb && r.path === path)?.handler
                ?? direct.get(route);
            if (!handler) throw new Error(`${route} is ledgered but not mounted by this harness`);
            return handler as Fn;
        },
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: unknown) => { res.body = body; return res; };
    res.send = (body: unknown) => { res.body = body; return res; };
    res.header = () => res;
    res.setHeader = () => {};
    res.write = () => true;
    res.end = () => {};
    return res;
}

/** `:object` → `mz_locked`, `:type` → `object`, any other `:param` → `param_1`. */
function paramsOf(route: string): Record<string, string> {
    const params: Record<string, string> = {};
    for (const [, name] of route.matchAll(/:([A-Za-z]+)/g)) {
        params[name] = name === 'object' ? OBJECT : name === 'type' ? 'object' : name === 'slug' ? 'mz-form' : `${name}_1`;
    }
    return params;
}

/** The caller-facing sentence of a body, in whichever envelope the door answers. */
function sentenceOf(body: any): unknown {
    if (typeof body?.error === 'string') return body.error;
    if (typeof body?.error?.message === 'string') return body.error.message;
    return body?.message;
}

/** The machine-readable code of a body, in whichever envelope the door answers. */
function codeOf(body: any): unknown {
    return typeof body?.error === 'object' && body.error !== null ? body.error.code : body?.code;
}

async function drive(b: Booted, route: string, body: unknown) {
    const res = makeRes();
    await b.handlerOf(route)({ method: route.split(' ')[0], params: paramsOf(route), query: {}, headers: {}, body }, res);
    return res;
}

/** The async import job's terminal row patch (the worker runs after the `201`). */
async function terminalJobPatch(b: Booted): Promise<any> {
    for (let i = 0; i < 400; i++) {
        const done = b.protocolCalls.find((c) => c.method === 'updateData'
            && ['succeeded', 'failed', 'cancelled'].includes(c.args[0]?.data?.status));
        if (done) return done.args[0].data;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('the import job never reached a terminal state');
}

/** What the import job needs to answer: its own `sys_import_job` row writes succeed. */
const IMPORT_JOB_PROTOCOL = (error: () => Error): Record<string, Fn> => ({
    createData: async (req: { object: string }) => {
        if (req.object === 'sys_import_job') return { id: 'job_1' };
        throw error();
    },
    updateData: async () => ({}),
});

// ─── the three dispositions ─────────────────────────────────────────────────

interface Driver {
    /** The downstream that must have been called (`protocol.createData`, `approvals.decide`, …). */
    called: string;
    body?: unknown;
    /** Protocol methods this row needs answered rather than refused. */
    protocol?: (error: () => Error) => Record<string, Fn>;
    /** Where the answer's sentence lives, when it is not the response body's own. */
    answer?: (res: any, b: Booted) => Promise<unknown> | unknown;
    /**
     * [#22719] The status and code the door answers, pinned on the rows that
     * moved here from {@link ANSWERS_THE_WRAPPER} so the move itself is legible:
     * the rows that answered `500` now answer the `400` every conforming door
     * gives an undeclared refusal.
     */
    answers?: { status: number; code: string };
}

const IMPORT_BODY = { format: 'json', rows: [{ name: 'x' }] };
const importRow = (res: any) => res.body?.results?.[0]?.error;
const jobRow = async (_res: any, b: Booted) => (await terminalJobPatch(b)).results?.items?.[0]?.error;

/**
 * [#27597] The same refusal where the family re-dresses the `/data` door's
 * classification whole: a sandboxed hook's undeclared abort answers the
 * ledgered `HOOK_ABORTED` there (the floor's `VALIDATION_ERROR` before).
 */
const HOOK_ABORTED_400 = { status: 400, code: 'HOOK_ABORTED' } as const;

/**
 * Rows that answer a refusal in the hook's own words. ⛔ The two import rows
 * are this card's defect and are driven here, never exempted.
 */
const ANSWERS_THE_SENTENCE: Record<string, Driver> = {
    'POST /api/v1/meta/_migrate-stored': { called: 'protocol.migrateStoredMetadata' },
    'PUT /api/v1/meta/:type/:name': { called: 'protocol.saveMetaItem', body: { name: 'name_1', label: 'X' } },
    'DELETE /api/v1/meta/:type/:name': { called: 'protocol.deleteMetaItem' },
    'POST /api/v1/meta/:type/:name/publish': { called: 'protocol.publishMetaItem' },
    'POST /api/v1/meta/:type/:name/rollback': { called: 'protocol.rollbackMetaItem', body: { toVersion: 1 } },
    'POST /api/v1/data/:object': { called: 'protocol.createData', body: { name: 'x' } },
    // A read on a write verb: a `beforeFind` hook on the object refuses it.
    'POST /api/v1/data/:object/query': {
        called: 'protocol.findData', body: {},
        protocol: (error) => ({ findData: async () => { throw error(); } }),
    },
    'PATCH /api/v1/data/:object/:id': { called: 'protocol.updateData', body: { name: 'x' } },
    'DELETE /api/v1/data/:object/:id': { called: 'protocol.deleteData' },
    'POST /api/v1/data/:object/:id/clone': { called: 'protocol.cloneData', body: {} },
    'POST /api/v1/data/:object/import': { called: 'protocol.insertManyData', body: IMPORT_BODY, answer: importRow },
    'POST /api/v1/data/:object/import/jobs': {
        called: 'protocol.insertManyData', body: IMPORT_BODY, protocol: IMPORT_JOB_PROTOCOL, answer: jobRow,
    },
    // The job lookup is what reaches these two answers: the cancel's own status
    // write swallows its failure (the in-memory flag still stops the worker),
    // and a refusal of one of the undo's reversal writes is that row's entry in
    // the answer's `failures`, in the hook's own sentence, never the route's
    // answer (`import-undo-controls.test.ts` pins it per row).
    'POST /api/v1/data/import/jobs/:jobId/cancel': {
        called: 'protocol.findData',
        protocol: (error) => ({ findData: async () => { throw error(); } }),
    },
    'POST /api/v1/data/import/jobs/:jobId/undo': {
        called: 'protocol.findData',
        protocol: (error) => ({ findData: async () => { throw error(); } }),
    },
    'POST /api/v1/forms/:slug/submit': { called: 'protocol.createData', body: { name: 'x' } },
    'POST /api/v1/analytics/dataset/query': {
        called: 'analytics.queryDataset',
        body: {
            dataset: {
                name: 'pipeline', label: 'Pipeline', object: OBJECT,
                dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
                measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
            },
            selection: { dimensions: ['stage'], measures: ['revenue'] },
        },
    },
    'POST /api/v1/security/explain': { called: 'security.explain', body: { object: OBJECT, operation: 'read' } },
    'POST /api/v1/data/:object/:id/shares': { called: 'sharing.grant', body: {} },
    'DELETE /api/v1/data/:object/:id/shares/:shareId': { called: 'sharing.revoke' },
    'POST /api/v1/batch': {
        called: 'protocol.createData',
        body: { operations: [{ action: 'create', object: OBJECT, data: { name: 'x' } }] },
    },
    'POST /api/v1/data/:object/batch': { called: 'protocol.batchData', body: { operation: 'create', records: [{ data: { name: 'x' } }] } },
    'POST /api/v1/data/:object/createMany': { called: 'protocol.createManyData', body: [{ name: 'x' }] },
    'POST /api/v1/data/:object/updateMany': { called: 'protocol.updateManyData', body: { records: [{ id: 'r1', data: { name: 'x' } }] } },
    'POST /api/v1/data/:object/deleteMany': { called: 'protocol.deleteManyData', body: { ids: ['r1'] } },

    // ── [#22719] Moved from ANSWERS_THE_WRAPPER ─────────────────────────────
    // Sharing rules, suggested bindings, approvals: each
    // family asks `classifiedRefusalAnswer` before its 500 arm relays
    // `.message`, and emits the answer in the nested envelope. Was `500` with
    // the family's own code (`RULE_*_FAILED`, `SUGGESTION_*_FAILED` /
    // `INTERNAL`, `APPROVAL_*_FAILED`).
    'POST /api/v1/sharing/rules': { called: 'sharingRules.defineRule', body: {}, answers: HOOK_ABORTED_400 },
    'DELETE /api/v1/sharing/rules/:idOrName': { called: 'sharingRules.deleteRule', answers: HOOK_ABORTED_400 },
    'POST /api/v1/sharing/rules/:idOrName/evaluate': { called: 'sharingRules.evaluateRule', answers: HOOK_ABORTED_400 },
    'POST /api/v1/security/suggested-bindings/:id/confirm': { called: 'security.confirmAudienceBindingSuggestion', answers: HOOK_ABORTED_400 },
    'POST /api/v1/security/suggested-bindings/:id/dismiss': { called: 'security.dismissAudienceBindingSuggestion', answers: HOOK_ABORTED_400 },
    'POST /api/v1/security/suggested-bindings/:id/reopen': { called: 'security.reopenAudienceBindingSuggestion', answers: HOOK_ABORTED_400 },
    'POST /api/v1/approvals/requests/:id/approve': { called: 'approvals.decide', body: {}, answers: HOOK_ABORTED_400 },
    'POST /api/v1/approvals/requests/:id/reject': { called: 'approvals.decide', body: {}, answers: HOOK_ABORTED_400 },
    'POST /api/v1/approvals/requests/:id/recall': { called: 'approvals.recall', body: {}, answers: HOOK_ABORTED_400 },
    'POST /api/v1/approvals/requests/:id/revise': { called: 'approvals.sendBack', body: {}, answers: HOOK_ABORTED_400 },
    'POST /api/v1/approvals/requests/:id/resubmit': { called: 'approvals.resubmit', body: {}, answers: HOOK_ABORTED_400 },
    'POST /api/v1/approvals/requests/:id/reassign': { called: 'approvals.reassign', body: {}, answers: HOOK_ABORTED_400 },
    'POST /api/v1/approvals/requests/:id/remind': { called: 'approvals.remind', body: {}, answers: HOOK_ABORTED_400 },
    'POST /api/v1/approvals/requests/:id/request-info': { called: 'approvals.requestInfo', body: {}, answers: HOOK_ABORTED_400 },
    'POST /api/v1/approvals/requests/:id/comment': { called: 'approvals.comment', body: {}, answers: HOOK_ABORTED_400 },
    // Package publish: the classification decides the status the door falls
    // back to, the shared read the sentence. Was `500 INTERNAL_ERROR`.
    // [#27672] FLIPPED on purpose from `400 VALIDATION_ERROR`: the door's code
    // is `resolveThrownHttpError`'s, which now answers an undeclared hook abort
    // `HOOK_ABORTED`, the code `/data` answers.
    'POST /api/v1/packages/publish': {
        called: 'service:package.publish', answers: HOOK_ABORTED_400,
        body: { manifest: { id: 'p1', version: '1.0.0' }, metadata: {} },
    },
    // External datasources: the shared read only, so status and code are this
    // family's own and unmoved.
    'POST /api/v1/datasources/:name/external/tables/:remote/draft': {
        called: 'service:external-datasource.generateObjectDraft', body: {},
        answers: { status: 400, code: 'EXTERNAL_DATASOURCE_ERROR' },
    },
    'POST /api/v1/datasources/:name/external/tables/:remote/import': {
        called: 'service:external-datasource.importObject', body: {},
        answers: { status: 400, code: 'EXTERNAL_IMPORT_ERROR' },
    },
    'POST /api/v1/datasources/:name/external/refresh-catalog': {
        called: 'service:external-datasource.refreshCatalog', body: {},
        answers: { status: 400, code: 'EXTERNAL_DATASOURCE_ERROR' },
    },
    'POST /api/v1/datasources/:name/external/validate': {
        called: 'service:external-datasource.validateDatasource', body: {},
        answers: { status: 400, code: 'EXTERNAL_DATASOURCE_ERROR' },
    },
};

/**
 * [#22719] EMPTY. It held the twenty rows a sandboxed refusal reached as the
 * debug wrapper; each now reads the hook's sentence and sits in
 * {@link ANSWERS_THE_SENTENCE}. §3 holds it empty — the disposition stays
 * declared so §1 still names three, and a door found answering the wrapper is
 * repaired rather than ledgered here.
 */
const ANSWERS_THE_WRAPPER: Record<string, Driver> = {};

/** Write rows no hook refusal can reach the answer of, with the reason. Closed. */
const NO_REFUSAL_REACHES_THE_ANSWER: ReadonlyMap<string, string> = new Map([
    ['POST /api/v1/email/send',
        "every engine write on `EmailService.send`'s path (the `sys_email` persist and its status updates) is "
        + 'non-fatal by design and logs and continues, so no hook can refuse the send. (Its 500 arm does relay '
        + '`.message`, so a producer added there later would ship the wrapper.)'],
]);

// ─── the pins ───────────────────────────────────────────────────────────────

describe('[#22694] §1 the REST ledger\'s write rows, each with exactly one disposition', () => {
    it('every write row is driven, pinned or exempted, and every map names a real row', () => {
        const maps = [Object.keys(ANSWERS_THE_SENTENCE), Object.keys(ANSWERS_THE_WRAPPER), [...NO_REFUSAL_REACHES_THE_ANSWER.keys()]];
        const named = maps.flat();
        const ledgered = WRITE_ROWS.map((row) => row.route);
        expect(ledgered.length).toBeGreaterThanOrEqual(44);
        for (const route of ledgered) {
            expect(named.filter((r) => r === route), `no single disposition for ${route}`).toHaveLength(1);
        }
        for (const route of named) expect(ledgered, `stale row: ${route}`).toContain(route);
    });
});

describe('[#22694] §2 a refusal reaches the caller in the hook\'s words', () => {
    for (const [route, driver] of Object.entries(ANSWERS_THE_SENTENCE)) {
        it(route, async () => {
            const b = boot(sandboxRefusal, driver.protocol?.(sandboxRefusal));
            const res = await drive(b, route, driver.body ?? {});
            // Read first: the async job's worker writes after the `201`.
            const answer = driver.answer ? await driver.answer(res, b) : sentenceOf(res.body);

            expect(b.calls, `${driver.called} was never called`).toContain(driver.called);
            expect(answer).toBe(SENTENCE);
            expect(JSON.stringify(res.body ?? null)).not.toMatch(WRAPPER_RE);
            if (driver.answers) {
                expect(res.statusCode).toBe(driver.answers.status);
                expect(codeOf(res.body)).toBe(driver.answers.code);
            }
        }, 60_000);
    }
});

describe('[#22719] §3 CLOSED: no write door answers the debug wrapper', () => {
    it('the disposition that held the wrapper rows is empty', () => {
        expect(Object.keys(ANSWERS_THE_WRAPPER)).toEqual([]);
    });
});

/** A refusal that DECLARED a server-band status: the doors keep the status and withhold the prose. */
function sandboxDeclared5xx(): Error {
    const err = new Error("hook 'mz_guard' threw: Error: The ledger service is down.");
    err.name = 'SandboxError';
    return Object.assign(err, { innerMessage: 'The ledger service is down.', status: 503, code: 'SERVICE_UNAVAILABLE' });
}

/**
 * [#22718] A body that CRASHED and a refusal that declared a 5xx are answered
 * as faults by the data doors, with their text withheld. Both import rows are
 * held to that answer. §2 is the control: a refusal row keeps the hook's
 * sentence on both import doors.
 */
describe('[#22718] §4 a sandboxed body the doors answer as a fault reads as that fault on both import doors', () => {
    it.each([
        ['a body that CRASHED', sandboxCrash, CRASH_LEAK],
        ['a refusal that declared a 5xx', sandboxDeclared5xx, /ledger/],
    ] as const)('%s', async (_label, error, leak) => {
        const doors: unknown[] = [];
        for (const [route, body] of [['POST /api/v1/data/:object', { name: 'x' }], ['POST /api/v1/data/:object/createMany', [{ name: 'x' }]]] as const) {
            const res = await drive(boot(error), route, body);
            expect(res.statusCode, route).toBeGreaterThanOrEqual(500);
            doors.push(sentenceOf(res.body));
        }
        expect(doors[1]).toBe(doors[0]);
        expect(String(doors[0])).not.toMatch(leak);

        for (const [route, answer, protocol] of [
            ['POST /api/v1/data/:object/import', importRow, undefined],
            ['POST /api/v1/data/:object/import/jobs', jobRow, IMPORT_JOB_PROTOCOL],
        ] as const) {
            const b = boot(error, protocol?.(error));
            const row = await answer(await drive(b, route, IMPORT_BODY), b);

            expect(b.calls, route).toContain('protocol.insertManyData');
            expect(row, route).toBe(doors[0]);
            expect(String(row), route).not.toMatch(WRAPPER_RE);
        }
    }, 60_000);
});

// ─── [#22719] what else the repair moved, and what it did not ───────────────

/**
 * The fault terminal each repaired row keeps: the code its own arm answers a
 * throw that is NOT a refusal. External datasources answer such a throw at
 * `400` with their own code and are listed with that answer. [#22764] A
 * sandboxed body the doors answer as a fault is not such a throw: §6 holds
 * every row to the doors' answer for it.
 */
const OWN_TERMINAL: Record<string, { status: number; code: string }> = {
    'POST /api/v1/sharing/rules': { status: 500, code: 'RULE_DEFINE_FAILED' },
    'DELETE /api/v1/sharing/rules/:idOrName': { status: 500, code: 'RULE_DELETE_FAILED' },
    'POST /api/v1/sharing/rules/:idOrName/evaluate': { status: 500, code: 'RULE_EVALUATE_FAILED' },
    'POST /api/v1/security/suggested-bindings/:id/confirm': { status: 500, code: 'SUGGESTION_CONFIRM_FAILED' },
    'POST /api/v1/security/suggested-bindings/:id/dismiss': { status: 500, code: 'SUGGESTION_DISMISS_FAILED' },
    'POST /api/v1/approvals/requests/:id/approve': { status: 500, code: 'APPROVAL_APPROVE_FAILED' },
    'POST /api/v1/approvals/requests/:id/reject': { status: 500, code: 'APPROVAL_REJECT_FAILED' },
    'POST /api/v1/approvals/requests/:id/recall': { status: 500, code: 'APPROVAL_RECALL_FAILED' },
    'POST /api/v1/approvals/requests/:id/revise': { status: 500, code: 'APPROVAL_REVISE_FAILED' },
    'POST /api/v1/approvals/requests/:id/resubmit': { status: 500, code: 'APPROVAL_RESUBMIT_FAILED' },
    'POST /api/v1/approvals/requests/:id/reassign': { status: 500, code: 'APPROVAL_REASSIGN_FAILED' },
    'POST /api/v1/approvals/requests/:id/remind': { status: 500, code: 'APPROVAL_REMIND_FAILED' },
    'POST /api/v1/approvals/requests/:id/request-info': { status: 500, code: 'APPROVAL_REQUEST_INFO_FAILED' },
    'POST /api/v1/approvals/requests/:id/comment': { status: 500, code: 'APPROVAL_COMMENT_FAILED' },
    'POST /api/v1/packages/publish': { status: 500, code: 'INTERNAL_ERROR' },
    'POST /api/v1/datasources/:name/external/tables/:remote/draft': { status: 400, code: 'EXTERNAL_DATASOURCE_ERROR' },
    'POST /api/v1/datasources/:name/external/tables/:remote/import': { status: 400, code: 'EXTERNAL_IMPORT_ERROR' },
    'POST /api/v1/datasources/:name/external/refresh-catalog': { status: 400, code: 'EXTERNAL_DATASOURCE_ERROR' },
    'POST /api/v1/datasources/:name/external/validate': { status: 400, code: 'EXTERNAL_DATASOURCE_ERROR' },
};

const EXTERNAL = /\/external\//;

/** A plain fault: no sandbox, no declaration. */
const plainFault = () => new Error('The connection pool is exhausted.');

/** A refusal that declared its own ADR-0112 envelope, outside any sandbox. */
const declaredConflict = () => Object.assign(new Error('The rule is being evaluated.'), { status: 409, code: 'RESOURCE_CONFLICT' });

/** A sandboxed refusal carrying an unregistered code and a marked user sentence. */
const markedSandboxRefusal = () => Object.assign(sandboxRefusal(), { code: 'MZ_LOCKED', userMessage: 'Ask an administrator to unlock it.' });

describe('[#22719] §5 the repaired rows: a fault keeps its own terminal, a refusal its own status', () => {
    it('names exactly the nineteen repaired rows', () => {
        // Twenty when repaired; the overlay-discard row retired with its route.
        expect(Object.keys(OWN_TERMINAL)).toHaveLength(19);
        for (const route of Object.keys(OWN_TERMINAL)) expect(ANSWERS_THE_SENTENCE[route]?.answers, route).toBeDefined();
    });

    for (const [route, terminal] of Object.entries(OWN_TERMINAL)) {
        const driver = ANSWERS_THE_SENTENCE[route]!;

        it(`${route}: a plain fault keeps ${terminal.status} ${terminal.code} and its own words`, async () => {
            const b = boot(plainFault);
            const res = await drive(b, route, driver.body ?? {});

            expect(b.calls, `${driver.called} was never called`).toContain(driver.called);
            expect(res.statusCode).toBe(terminal.status);
            expect(codeOf(res.body)).toBe(terminal.code);
            expect(sentenceOf(res.body)).toBe('The connection pool is exhausted.');
        }, 60_000);

        // The classification answers a declared envelope at its own status —
        // the ride-along on the rows whose 500 arm used to answer it. External
        // datasources do not ask it: their status and code are their own.
        const declared = EXTERNAL.test(route) ? terminal : { status: 409, code: 'RESOURCE_CONFLICT' };
        it(`${route}: a declared 409 refusal answers ${declared.status} ${declared.code}`, async () => {
            const b = boot(declaredConflict);
            const res = await drive(b, route, driver.body ?? {});

            expect(b.calls, `${driver.called} was never called`).toContain(driver.called);
            expect(res.statusCode).toBe(declared.status);
            expect(codeOf(res.body)).toBe(declared.code);
            expect(sentenceOf(res.body)).toBe('The rule is being evaluated.');
        }, 60_000);

        if (EXTERNAL.test(route)) continue;
        it(`${route}: a sandboxed refusal's declared channels ride the nested envelope`, async () => {
            const b = boot(markedSandboxRefusal);
            const res = await drive(b, route, driver.body ?? {});

            expect(res.statusCode).toBe(400);
            expect(res.body?.error).toMatchObject({
                code: 'VALIDATION_ERROR',
                message: SENTENCE,
                declaredCode: 'MZ_LOCKED',
                userMessage: 'Ask an administrator to unlock it.',
            });
        }, 60_000);
    }
});

// ─── [#22764] the fault side: every driven row answers as the doors do ──────

/**
 * [#22885] The sandbox's OWN fault: a `SandboxError` the runner raised itself,
 * not one a body threw. Its producer (`runtime/src/sandbox/quickjs-runner.ts`)
 * names the class `'SandboxError'` and leaves `innerMessage` unset for "the
 * sandbox's own internal errors (capability denials, timeouts, marshalling
 * failures)", so `isSandboxOwnFault` (`@objectstack/types`) answers `true` and
 * the doors answer it as a fault (#22868).
 *
 * Built from that constructor, as {@link sandboxRefusal} is, because this
 * package does not depend on `@objectstack/runtime` and no factory exports the
 * runner's raise sites: their census lives inside `@objectstack/core`'s
 * `import-runner-sandbox-fault-row.test.ts`. One shape per kind that census
 * names, each message rendered from its raise site's template.
 */
function sandboxOwnFault(message: string): () => Error {
    return () => {
        const err = new Error(message);
        err.name = 'SandboxError';
        return err;
    };
}

const OWN_FAULT = { status: 500, code: 'INTERNAL_ERROR' } as const;

/**
 * The sandbox shapes the doors answer as FAULTS, the status and code they
 * answer each with, and the text that must not reach the caller: the native
 * error a crash carries, and the prose a declared 5xx withholds. [#22885] The
 * CONTROL for {@link SANDBOX_OWN_FAULTS}: unchanged by that card.
 */
const SANDBOX_FAULT_CONTROLS = [
    ['a body that CRASHED', sandboxCrash, { status: 500, code: 'INTERNAL_ERROR' }, CRASH_LEAK],
    ['a refusal that declared a 5xx', sandboxDeclared5xx, { status: 503, code: 'SERVICE_UNAVAILABLE' }, /ledger/],
] as const;

/** [#22885] The runner's own faults, one per kind, and the diagnostic text each must not relay. */
const SANDBOX_OWN_FAULTS = [
    ['the sandbox\'s own fault: CPU budget',
        sandboxOwnFault("hook 'mz_guard' exceeded CPU budget of 50ms (after 3 pump iterations)"), OWN_FAULT, /budget/],
    ['the sandbox\'s own fault: wall-clock ceiling',
        sandboxOwnFault("hook 'mz_guard' exceeded wall-clock ceiling of 30000ms while awaiting host calls (after 3 pump iterations)"),
        OWN_FAULT, /ceiling/],
    ['the sandbox\'s own fault: a capability denial naming the object',
        sandboxOwnFault(`capability 'api.read' not granted to hook 'mz_guard' (called ctx.api.object('${OBJECT}').find)`),
        OWN_FAULT, /capability|granted/],
    ['the sandbox\'s own fault: ctx.api unavailable',
        sandboxOwnFault("ctx.api unavailable in hook 'mz_guard'"), OWN_FAULT, /unavailable/],
    ['the sandbox\'s own fault: an install failure',
        sandboxOwnFault('failed to install ctx.api.transaction: SyntaxError: unexpected token'), OWN_FAULT, /install|SyntaxError/],
    ['the sandbox\'s own fault: a marshal failure',
        sandboxOwnFault('failed to marshal host value: SyntaxError: unexpected token'), OWN_FAULT, /marshal|SyntaxError/],
    ['the sandbox\'s own fault: a nested transaction refusal',
        sandboxOwnFault('nested ctx.api.transaction is not supported'), OWN_FAULT, /transaction|supported/],
    ['the sandbox\'s own fault: a missing ctx.api method naming the object',
        sandboxOwnFault(`ctx.api.object('${OBJECT}').find not implemented`), OWN_FAULT, /implemented|ctx\.api/],
    ['the sandbox\'s own fault: a nested body\'s crash relayed one VM hop up',
        sandboxOwnFault(`hook 'mz_inner' threw: TypeError: ${CRASH_WORDS}`), OWN_FAULT, CRASH_LEAK],
] as const;

const SANDBOX_FAULTS = [...SANDBOX_FAULT_CONTROLS, ...SANDBOX_OWN_FAULTS] as const;
const OWN_FAULT_SHAPES: ReadonlySet<unknown> = new Set(SANDBOX_OWN_FAULTS);

/**
 * Driven rows that answer a sandboxed fault at their OWN terminal rather than
 * the doors' status and code, with the reason. Closed. The words are withheld
 * on both all the same, and §6 still holds them to the doors' sentence.
 * [#22885] The own-fault shapes take the same exception: the family's sentence
 * is `sandboxFaultAnswer`'s, its status and code its own, as for a crash.
 */
const OWN_FAULT_TERMINAL: ReadonlyMap<string, { status: number; code: string; reason: string }> = new Map([
    ['POST /api/v1/data/:object/:id/shares', {
        status: 500, code: 'SHARE_GRANT_FAILED',
        reason: "the record-share family withholds a sandbox's words at its own 500 (`sharingFaultMessage`, which "
            + "reads `sandboxFaultAnswer`'s sentence) and folds a declared 5xx into that terminal by a recorded "
            + 'choice (#11683, #12693); neither is a leak, and its status and code are a decision this card does not take',
    }],
    ['DELETE /api/v1/data/:object/:id/shares/:shareId', {
        status: 500, code: 'SHARE_REVOKE_FAILED',
        reason: 'the record-share family, as its grant row',
    }],
]);

describe('[#22764] §6 every driven write row answers a sandboxed fault as the doors do, its words withheld', () => {
    // [#22885] §6 observes the REST fault log: a withheld own fault's words must
    // still reach the operator. 'info' is the SHIPPED default, declared here
    // as `scripts/check-rest-log-spy-declared.mjs` requires; the spy swallows
    // the output.
    let faultLog: MockInstance<typeof console.error>;
    beforeAll(() => {
        vi.stubEnv('OS_REST_LOG', 'info');
        faultLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterAll(() => {
        faultLog.mockRestore();
        vi.unstubAllEnvs();
    });

    it('the reference: the `/data` door answers each shape at the pinned status and code', async () => {
        for (const [label, error, doors, leak] of SANDBOX_FAULTS) {
            const res = await drive(boot(error), 'POST /api/v1/data/:object', { name: 'x' });
            expect(res.statusCode, label).toBe(doors.status);
            expect(codeOf(res.body), label).toBe(doors.code);
            expect(JSON.stringify(res.body), label).not.toMatch(leak);
        }
    }, 60_000);

    it('[#22885] the own-fault shapes are the shared predicate\'s, read off the producer and never its words', () => {
        for (const [label, error] of SANDBOX_OWN_FAULTS) {
            expect(isSandboxOwnFault(error()), label).toBe(true);
            // CONTROL: the same words thrown by anything else are not the answer's.
            expect(sandboxFaultAnswer(new Error(error().message)), label).toBeUndefined();
        }
        for (const [label, error] of SANDBOX_FAULT_CONTROLS) expect(isSandboxOwnFault(error()), label).toBe(false);
    });

    it('every row naming its own terminal is a driven row', () => {
        for (const route of OWN_FAULT_TERMINAL.keys()) expect(Object.keys(ANSWERS_THE_SENTENCE), route).toContain(route);
    });

    for (const [route, driver] of Object.entries(ANSWERS_THE_SENTENCE)) {
        for (const shape of SANDBOX_FAULTS) {
            const [label, error, doors, leak] = shape;
            it(`${route}: ${label}`, async () => {
                const door = await drive(boot(error), 'POST /api/v1/data/:object', { name: 'x' });
                const b = boot(error, driver.protocol?.(error));
                faultLog.mockClear();
                const res = await drive(b, route, driver.body ?? {});
                // Read first: the async job's worker writes after the `201`.
                const answer = driver.answer ? await driver.answer(res, b) : sentenceOf(res.body);

                expect(b.calls, `${driver.called} was never called`).toContain(driver.called);
                expect(answer).toBe(sentenceOf(door.body));
                for (const text of [JSON.stringify(res.body ?? null), String(answer)]) {
                    expect(text).not.toMatch(leak);
                    expect(text).not.toMatch(WRAPPER_RE);
                }
                // The import rows answer per row, inside a `200` / `201`.
                if (driver.answer) return;
                const expected = OWN_FAULT_TERMINAL.get(route) ?? doors;
                expect(res.statusCode).toBe(expected.status);
                expect(codeOf(res.body)).toBe(expected.code);
                if (!OWN_FAULT_SHAPES.has(shape)) return;
                // [#22885] The whole error, not a summary of it, reaches the log.
                const runnerText = error().message;
                const logged = faultLog.mock.calls.some((args) => args.some((arg) =>
                    arg instanceof Error && arg.name === 'SandboxError' && arg.message === runnerText));
                expect(logged, 'the runner\'s error reaches the server log').toBe(true);
            }, 60_000);
        }
    }
});
