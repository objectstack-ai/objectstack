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
 *    the debug wrapper. Each is pinned at that answer, so a repair flips it red
 *    and moves it to the first map. These are hand-built error arms that relay
 *    `.message`; each family's service writes platform objects (`sys_*`)
 *    through the engine, so a sandboxed hook reaches them only when it is bound
 *    to `*` or to such an object. They are this card's findings, not its
 *    scope: the repair is a per-family envelope decision.
 *  - {@link NO_REFUSAL_REACHES_THE_ANSWER} — not driven, with the reason.
 *
 * The refusal is the shape `runtime/src/sandbox/quickjs-runner.ts` produces
 * (`.message` the wrapper, `.innerMessage` the sentence), reproduced here as
 * `rest-hook-refusal-message-parity.test.ts` does, because this package does
 * not depend on `@objectstack/runtime`.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeRowError } from '@objectstack/core';
import { RestServer } from './rest-server.js';
import { mountAndRecordDirectRoutes } from './direct-mount-composition.js';
import { REST_ROUTE_LEDGER } from './rest-route-ledger.js';

const SENTENCE = 'Locked rows cannot be changed here.';
const WRAPPER = `hook 'mz_guard' threw: Error: ${SENTENCE}`;
const WRAPPER_RE = /threw:|hook '/;
const OBJECT = 'mz_locked';

function sandboxRefusal(): Error {
    const err = new Error(WRAPPER);
    err.name = 'SandboxError';
    return Object.assign(err, { innerMessage: SENTENCE });
}

/** A body that CRASHED: the runner sets `innerMessage` to the native error text. */
function sandboxCrash(): Error {
    const err = new Error("hook 'mz_guard' threw: TypeError: boom");
    err.name = 'SandboxError';
    return Object.assign(err, { innerMessage: 'TypeError: boom' });
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

/** A finished, undoable job whose undo log names one created record. */
const UNDOABLE_JOB = {
    id: 'jobId_1', object_name: OBJECT, status: 'succeeded',
    undo_log: { created: ['r1'], updated: [] },
};

// ─── the three dispositions ─────────────────────────────────────────────────

interface Driver {
    /** The downstream that must have been called (`protocol.createData`, `approvals.decide`, …). */
    called: string;
    body?: unknown;
    /** Protocol methods this row needs answered rather than refused. */
    protocol?: (error: () => Error) => Record<string, Fn>;
    /** Where the answer's sentence lives, when it is not the response body's own. */
    answer?: (res: any, b: Booted) => Promise<unknown> | unknown;
}

const IMPORT_BODY = { format: 'json', rows: [{ name: 'x' }] };
const importRow = (res: any) => res.body?.results?.[0]?.error;
const jobRow = async (_res: any, b: Booted) => (await terminalJobPatch(b)).results?.items?.[0]?.error;

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
    // and the undo's writes run under `skipAutomations`, which the engine reads
    // to skip every metadata-bound hook, and count their failures into `failed`.
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
};

interface WrapperDoor extends Driver {
    /** The status the door answers today. */
    status: number;
}

/**
 * MEASURED, NOT REPAIRED: a refusal from the downstream reaches the caller as
 * the debug wrapper. Pinned at today's answer so a repair goes red here and
 * moves the row to {@link ANSWERS_THE_SENTENCE}.
 */
const ANSWERS_THE_WRAPPER: Record<string, WrapperDoor> = {
    // Sharing rules: the 500 arm of `handleError` relays `.message`.
    'POST /api/v1/sharing/rules': { called: 'sharingRules.defineRule', status: 500, body: {} },
    'DELETE /api/v1/sharing/rules/:idOrName': { called: 'sharingRules.deleteRule', status: 500 },
    'POST /api/v1/sharing/rules/:idOrName/evaluate': { called: 'sharingRules.evaluateRule', status: 500 },
    // Suggested bindings and the overlay discard: the 500 arm relays `.message`.
    'POST /api/v1/security/suggested-bindings/:id/confirm': { called: 'security.confirmAudienceBindingSuggestion', status: 500 },
    'POST /api/v1/security/suggested-bindings/:id/dismiss': { called: 'security.dismissAudienceBindingSuggestion', status: 500 },
    'POST /api/v1/security/permission-sets/:id/discard-overlay': { called: 'security.discardPermissionSetOverlay', status: 500 },
    // Approvals: no `handleApprovalError` prefix matches, so the outer 500 relays `.message`.
    'POST /api/v1/approvals/requests/:id/approve': { called: 'approvals.decide', status: 500, body: {} },
    'POST /api/v1/approvals/requests/:id/reject': { called: 'approvals.decide', status: 500, body: {} },
    'POST /api/v1/approvals/requests/:id/recall': { called: 'approvals.recall', status: 500, body: {} },
    'POST /api/v1/approvals/requests/:id/revise': { called: 'approvals.sendBack', status: 500, body: {} },
    'POST /api/v1/approvals/requests/:id/resubmit': { called: 'approvals.resubmit', status: 500, body: {} },
    'POST /api/v1/approvals/requests/:id/reassign': { called: 'approvals.reassign', status: 500, body: {} },
    'POST /api/v1/approvals/requests/:id/remind': { called: 'approvals.remind', status: 500, body: {} },
    'POST /api/v1/approvals/requests/:id/request-info': { called: 'approvals.requestInfo', status: 500, body: {} },
    'POST /api/v1/approvals/requests/:id/comment': { called: 'approvals.comment', status: 500, body: {} },
    // Package publish: `sendThrownError` withholds only prose that looks like a leak.
    'POST /api/v1/packages/publish': {
        called: 'service:package.publish', status: 500,
        body: { manifest: { id: 'p1', version: '1.0.0' }, metadata: {} },
    },
    // External datasources: the catch arm sends `err.message` at 400.
    'POST /api/v1/datasources/:name/external/tables/:remote/draft': { called: 'service:external-datasource.generateObjectDraft', status: 400, body: {} },
    'POST /api/v1/datasources/:name/external/tables/:remote/import': { called: 'service:external-datasource.importObject', status: 400, body: {} },
    'POST /api/v1/datasources/:name/external/refresh-catalog': { called: 'service:external-datasource.refreshCatalog', status: 400, body: {} },
    'POST /api/v1/datasources/:name/external/validate': { called: 'service:external-datasource.validateDatasource', status: 400, body: {} },
};

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
        expect(ledgered.length).toBeGreaterThanOrEqual(45);
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
        }, 60_000);
    }
});

describe('[#22694] §3 MEASURED, NOT REPAIRED: these doors answer the debug wrapper', () => {
    for (const [route, door] of Object.entries(ANSWERS_THE_WRAPPER)) {
        it(`${route} answers ${door.status} + the wrapper`, async () => {
            const b = boot(sandboxRefusal);
            const res = await drive(b, route, door.body ?? {});

            expect(b.calls, `${door.called} was never called`).toContain(door.called);
            expect(res.statusCode).toBe(door.status);
            expect(sentenceOf(res.body)).toBe(WRAPPER);
        }, 60_000);
    }
});

describe('[#22694] §4 CONTROL: a hook body that CRASHED still answers as a fault on both import doors', () => {
    const crash = sandboxCrash();
    it.each([
        ['POST /api/v1/data/:object/import', importRow, undefined],
        ['POST /api/v1/data/:object/import/jobs', jobRow, IMPORT_JOB_PROTOCOL],
    ] as const)('%s', async (route, answer, protocol) => {
        const b = boot(sandboxCrash, protocol?.(sandboxCrash));
        const res = await drive(b, route, IMPORT_BODY);

        const row = await answer(res, b);
        // The native error text is never presented as the author's sentence;
        // the row is built from `.message` exactly as before this card.
        expect(row).not.toBe('TypeError: boom');
        expect(row).toBe(sanitizeRowError(crash.message));
    }, 60_000);
});
