// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22588] Every `/actions` invocation route answers a hook's refusal in the
 * hook's own words — enumerated from the route ledger, not hand-listed.
 *
 * ## What was measured broken
 *
 * `POST /api/v1/actions/mz_task/mz_reopen/ID` on a booted stack at `3d0eeefa`:
 * a script action whose `ctx.api` write a sandboxed `beforeUpdate` hook refused
 * answered `400 VALIDATION_ERROR` with
 * `hook 'mz_guard_reopen' threw: Error: A finished task cannot be reopened. …`.
 * The hotclm browser pass saw the same text in a toast. The producer was the
 * sandbox's VM hop, repaired in `sandbox/quickjs-runner.ts`; the door now reads
 * its sentence through `sandboxBusinessMessage`, the read `/data` makes.
 *
 * ## Why the ledger, and what the enumeration buys
 *
 * The rows are read from {@link ROUTE_LEDGER} — the dispatcher's audited list of
 * what it serves — so a new `/actions` row is driven here the day it is
 * ledgered, or fails the completeness case until someone says why it cannot
 * run an action body. `_activation` is the one such row today.
 *
 * Each row is driven through `HttpDispatcher.dispatch()` at a concrete path
 * built from the row itself, and the refusal each one meets is produced by the
 * REAL runner at both levels (a hook body refusing under an action body's
 * `ctx.api` write) — the shape that reached the wire, never a hand-built error.
 * `executeAction` being called is asserted per row, so a row answered by some
 * earlier refusal (a missing declaration, the anonymous floor) cannot pass.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { ROUTE_LEDGER } from '../route-ledger.js';
import { QuickJSScriptRunner } from '../sandbox/quickjs-runner.js';

const REFUSAL = 'A finished task cannot be reopened. Create a follow-up task instead.';
const OBJECT = 'mz_task';
const ACTION = 'mz_reopen';
const RECORD = 't1';

/**
 * `/actions` rows that do not invoke an action, with the reason. Closed: a new
 * row is driven below unless it is named here.
 */
const NOT_AN_INVOCATION: ReadonlyMap<string, string> = new Map([
    ['POST /actions/_activation/:object/:action',
        'ADR-0126 §8 activation door — writes one sys_metadata_activation row and runs no action body, '
        + 'so no hook can refuse inside it'],
]);

const ACTION_ROWS = ROUTE_LEDGER.filter((row) => row.domain === '/actions');
const INVOCATION_ROWS = ACTION_ROWS.filter((row) => !NOT_AN_INVOCATION.has(row.route));

/** `POST /actions/:object/:action/:recordId` → `/actions/mz_task/mz_reopen/t1`; literals stay. */
function concretePath(route: string): string {
    const [, pattern] = route.split(' ');
    return pattern
        .replace(':object', OBJECT)
        .replace(':action', ACTION)
        .replace(':recordId', RECORD);
}

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000, actionTimeoutMs: 10_000 });

/**
 * What an action body's handler throws when its `ctx.api` write is refused by
 * a sandboxed hook — both levels run by the real runner.
 */
async function nestedRefusal(): Promise<unknown> {
    const hookRefusal = () => runner.runScript(
        { language: 'js', source: `throw new Error(${JSON.stringify(REFUSAL)});` },
        { input: {} } as any,
        { origin: { kind: 'hook', name: 'mz_guard_reopen' } },
    ).then(() => { throw new Error('the guard hook resolved'); }, (e: unknown) => e);
    return runner.runScript(
        {
            language: 'js',
            source: `await ctx.api.object('${OBJECT}').update({ id: '${RECORD}', done: false });`,
            capabilities: ['api.write'],
        },
        { input: {}, api: { object: () => ({ update: async () => { throw await hookRefusal(); } }) } } as any,
        { origin: { kind: 'action', name: ACTION } },
    ).then(() => { throw new Error('the action body resolved'); }, (e: unknown) => e);
}

function makeDispatcher() {
    const declared = { name: ACTION, objectName: OBJECT, type: 'script', target: ACTION };
    const objectDef = { name: OBJECT, actions: [declared] };
    const executeAction = vi.fn(async () => { throw await nestedRefusal(); });
    const ql: any = {
        executeAction,
        getSchema: (n: string) => (n === OBJECT ? objectDef : undefined),
        registry: { getObject: (n: string) => (n === OBJECT ? objectDef : undefined), getItem: () => undefined },
        find: vi.fn(async () => [{ id: RECORD, done: true }]),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    // The object-less rows resolve their declaration here: a global action of the same name.
    const global = (type: string, name: string) =>
        type === 'action' ? { name, type: 'script', target: name, objectName: 'global' } : null;
    const metadata: any = {
        load: vi.fn(async (type: string, name: string) => global(type, name)),
        loadDiagnosed: vi.fn(async (type: string, name: string) => ({ data: global(type, name), degraded: false, errors: [] })),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async (n: string) => (n === OBJECT ? objectDef : undefined)),
    };
    // `/actions` answers an anonymous caller 401 before addressing anything.
    const auth: any = { api: { getSession: async () => ({ user: { id: 'u1' } }) } };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : n === 'auth' ? auth : null,
        },
    };
    return { dispatcher: new HttpDispatcher(kernel) as any, executeAction };
}

describe('[#22588] the /actions ledger rows, each driven with a real nested hook refusal', () => {
    it('the ledger has invocation rows to drive, and every exemption names a real row', () => {
        expect(INVOCATION_ROWS.length).toBeGreaterThanOrEqual(4);
        for (const route of NOT_AN_INVOCATION.keys()) {
            expect(ACTION_ROWS.map((r) => r.route), `stale exemption: ${route}`).toContain(route);
        }
    });

    for (const row of INVOCATION_ROWS) {
        it(`${row.route} answers the hook's sentence, not its debug wrapper`, async () => {
            const { dispatcher, executeAction } = makeDispatcher();

            const res = await dispatcher.dispatch('POST', concretePath(row.route), {}, {}, {
                request: { headers: {} },
            });

            // Anti-vacuity: the action body really ran and really refused.
            expect(executeAction).toHaveBeenCalled();
            expect(res.response.status).toBe(400);
            expect(res.response.body.success).toBe(false);
            expect(res.response.body.error.code).toBe('VALIDATION_ERROR');
            // The wording IS the defect here, so the sentence is asserted whole.
            expect(res.response.body.error.message).toBe(REFUSAL);
            expect(JSON.stringify(res.response.body)).not.toMatch(/threw:|hook '/);
        }, 60_000);
    }
});
