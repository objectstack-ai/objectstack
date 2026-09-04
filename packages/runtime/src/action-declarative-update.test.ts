// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15079] The DECLARATIVE row-level field write — `operation: 'update'` +
 * `patch` — executed by the platform action route (runtime half of #14092,
 * maintainer ruling 2026-09-01: 行级 action 获得 `bulkActionDefs` 的声明式对应
 * 物 —— 单记录、走数据面、用调用者自己的权限、钩子与校验照常触发、`undoable`
 * 有锚点).
 *
 * ## What is pinned, and which of it is a security property
 *
 * The seven-point executor contract was reviewed on the spec half (PR #15077).
 * Six of its points are behaviour; **point 3 is authorization**, and a wrong
 * implementation of it is a privilege escalation, not a bug — the write has no
 * author body between the caller and the row, so the data plane's own gate is
 * the ONLY gate, and it only exists if the caller's identity is what reaches
 * it. The pins that carry that weight are the ones that read the identity ON
 * THE DRIVER CALL (`isSystem` absent, `userId` the caller's) and the two
 * refusals — a caller who cannot READ and a caller who can read but cannot
 * WRITE.
 *
 * ## The rig is row-scoped and identity-honest, deliberately
 *
 * A double that returned the row to everyone, or accepted every write, would
 * pass with the elevation left in — which is the whole failure this file
 * exists to catch. So `find` honours `options.context.userId` (the row is
 * visible to its OWNER and its READER and to nobody else) and `update` honours
 * it too (only the OWNER may write) — with ONE deliberate extra arm: a context
 * carrying `isSystem: true` bypasses both, exactly as row-level security
 * behaves in production. That arm is what makes the elevation OBSERVABLE: with
 * `buildActionExecutionContext` in the executor's call site, the refusal pins
 * below go green-by-bypass instead of red, which is precisely the ablation leg
 * recorded in the PR body.
 *
 * The tests drive the REAL `callData` — the same protocol-first / ObjectQL
 * fallback the production door uses — so nothing about the refused/absent
 * collapse or the not-found envelope is mocked away.
 */

import { describe, it, expect, vi } from 'vitest';

import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

import { HttpDispatcher } from './http-dispatcher.js';
import {
    callData,
    invokeBusinessAction,
    isDeclarativeUpdateAction,
    isHeadlessInvokableAction,
    headlessActionTypeError,
    summarizeAction,
    declarativeUpdateWrite,
    DECLARATIVE_UPDATE_OPERATION,
} from './action-execution.js';

const OWNER = 'usr_owner';
/** Can READ the row and cannot WRITE it — the second half of contract point 3. */
const READER = 'usr_reader';
/** Can do neither: the caller-scope load never delivers the row. */
const STRANGER = 'usr_stranger';
const RECORD_ID = 'case_1';
const OBJECT = 'crm_case';

/** The subject row as it stands before any action runs. */
function freshRow() {
    return { id: RECORD_ID, status: 'open', priority: 'low', owner_id: OWNER };
}

/** `patch` only — the card's own exemplar shape. */
const CLOSE_CASE = {
    name: 'close_case',
    label: 'Close',
    operation: 'update',
    patch: { status: 'closed' },
    undoable: true,
    visible: 'record.status == "open"',
    ai: { exposed: true, description: 'Close this case.' },
};

/** `patch` UNDER `params` — contract point 4's precedence, both halves present. */
const TRIAGE_CASE = {
    name: 'triage_case',
    label: 'Triage',
    operation: 'update',
    patch: { status: 'triaged', priority: 'low' },
    params: [{ name: 'priority', type: 'text', required: true }],
    ai: { exposed: true, description: 'Triage this case.' },
};

/** The REVERSE pin's subject: a handler-less `type: 'script'` action with NO `operation`. */
const HANDLER_ONLY = {
    name: 'nudge_case',
    label: 'Nudge',
    type: 'script',
    target: 'nudge_case',
    ai: { exposed: true, description: 'Nudge this case.' },
};

const OBJECT_DEF = {
    name: OBJECT,
    fields: {
        status: { type: 'text' },
        priority: { type: 'text' },
        note: { type: 'text' },
    },
    actions: [CLOSE_CASE, TRIAGE_CASE, HANDLER_ONLY],
};

/** The acting principal, as `resolveExecutionContext` builds one. */
function ec(userId: string) {
    return { userId, tenantId: 'org_1', positions: [], permissions: [], systemPermissions: [] };
}

interface Rig {
    ql: any;
    row: Record<string, any>;
    /** Every `ql.update` the engine saw, with the CONTEXT it was handed. */
    updates: Array<{ object: string; data: any; context: any }>;
    /** Every before-update hook invocation — the object's own, as a user edit fires it. */
    hooks: Array<{ data: any; userId?: string; isSystem?: boolean }>;
}

/**
 * A row-scoped engine double. `beforeUpdate` stands in for the object's own
 * before-update hook chain: the fallback `callData('update', …)` reaches
 * `ql.update`, which is where the engine runs hooks and validations for a user
 * edit, so a rejection thrown from there is what one of those looks like on
 * this seam.
 */
function makeRig(opts: {
    standaloneAction?: any;
    beforeUpdate?: (data: any, context: any) => void;
} = {}): Rig {
    const row = freshRow();
    const updates: Rig['updates'] = [];
    const hooks: Rig['hooks'] = [];
    const canRead = (ctx: any) => ctx?.isSystem === true || ctx?.userId === OWNER || ctx?.userId === READER;
    const canWrite = (ctx: any) => ctx?.isSystem === true || ctx?.userId === OWNER;
    const schemaOf = (n: string) => (n === OBJECT_DEF.name ? OBJECT_DEF : undefined);

    const ql: any = {
        // The engine's own registry MISS, spelled exactly as `engine.ts` throws
        // it — `isActionNotRegisteredError` matches on that sentence, so a
        // paraphrase here would make the reverse pin read a rejection (400)
        // where production rotates keys and answers the routing 404.
        executeAction: vi.fn(async (object: string, key: string) => {
            throw new Error(`Action '${key}' on object '${object}' not found`);
        }),
        getSchema: schemaOf,
        registry: {
            getObject: schemaOf,
            getItem: (type: string, name: string) =>
                type === 'action' && opts.standaloneAction?.name === name ? opts.standaloneAction : undefined,
        },
        find: vi.fn(async (object: string, options?: any) => {
            if (object !== OBJECT_DEF.name) return [];
            return canRead(options?.context) ? [{ ...row }] : [];
        }),
        update: vi.fn(async (object: string, data: any, options?: any) => {
            // [#4434 / check:engine-double-contract] The double must not be
            // LOOSER than `ObjectQL.update` about which call shapes address one
            // row — a fake that accepts a shape the real engine rejects is how a
            // dead route once shipped with a green suite. This is also load-bearing
            // for THIS card: the pins below assert "exactly one update of the
            // CURRENT record", and that claim is only as good as the double's
            // agreement with the producer about what "by id" means.
            assertEngineUpdateDispatch(data, options);
            const context = options?.context;
            updates.push({ object, data: { ...data }, context });
            hooks.push({ data: { ...data }, userId: context?.userId, isSystem: context?.isSystem });
            opts.beforeUpdate?.(data, context);
            if (!canWrite(context)) {
                throw Object.assign(
                    new Error(`You do not have permission to update ${object} ${options?.where?.id}`),
                    { code: 'PERMISSION_DENIED', status: 403 },
                );
            }
            Object.assign(row, data);
            return { id: row.id };
        }),
        insert: vi.fn(),
        delete: vi.fn(),
    };
    return { ql, row, updates, hooks };
}

/** REST — `POST /actions/<path>`. Returns the raw dispatcher response. */
async function dispatchRest(userId: string, rig: Rig, path: string, body: any = {}) {
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        listObjects: vi.fn(async () => [OBJECT_DEF]),
        getObject: vi.fn(async (n: string) => (n === OBJECT_DEF.name ? OBJECT_DEF : undefined)),
    };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? rig.ql : n === 'metadata' ? metadata : null,
        },
    };
    const context: any = { request: {}, environmentId: 'platform', executionContext: ec(userId) };
    const res: any = await (new HttpDispatcher(kernel) as any).handleActions(path, 'POST', body, context);
    return res.response;
}

/** MCP — `run_action`, wired to the REAL `callData`. */
async function dispatchMcp(userId: string, rig: Rig, name: string, input: Record<string, unknown>) {
    const deps: any = { resolveService: async () => undefined, getObjectQL: async () => rig.ql };
    const requestContext: any = { request: {}, environmentId: 'platform' };
    const caller = ec(userId);
    return await invokeBusinessAction(deps, requestContext, name, input as any, {
        driver: undefined,
        envId: 'platform',
        ec: caller,
        getMeta: () => ({ listObjects: async () => [OBJECT_DEF] }),
        callData: (action, params, dataDriver, scopeId, execCtx) =>
            callData(deps, requestContext, action, params, dataDriver, scopeId, execCtx),
    });
}

// ───────────────────────────────────────────────────────────────────────────
// Contract point 2 — ONE data-plane update of the CURRENT record, as the caller
// ───────────────────────────────────────────────────────────────────────────

describe('#15079 point 2 — one data-plane update of the current record, AS THE CALLER', () => {
    it('writes the patch to the routed record and answers the declarative result', async () => {
        const rig = makeRig();
        const res = await dispatchRest(OWNER, rig, `/${OBJECT}/close_case/${RECORD_ID}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toMatchObject({
            operation: DECLARATIVE_UPDATE_OPERATION,
            object: OBJECT,
            id: RECORD_ID,
        });
        expect(res.body.data.record).toMatchObject({ id: RECORD_ID, status: 'closed' });
        expect(rig.row.status).toBe('closed');
    });

    it('is EXACTLY one update, of exactly the routed row — never a second write, never a query', async () => {
        const rig = makeRig();
        await dispatchRest(OWNER, rig, `/${OBJECT}/close_case/${RECORD_ID}`);

        expect(rig.updates).toHaveLength(1);
        expect(rig.updates[0].object).toBe(OBJECT);
        expect(rig.ql.update.mock.calls[0][2]?.where).toEqual({ id: RECORD_ID });
        // ⛔ No handler was dispatched: a declarative update has none, and
        // falling through to the registry is the widening this branch prevents.
        expect(rig.ql.executeAction).not.toHaveBeenCalled();
    });

    it('⚠️ THE SECURITY PIN — the driver call carries the CALLER, and `isSystem` is absent', async () => {
        const rig = makeRig();
        await dispatchRest(OWNER, rig, `/${OBJECT}/close_case/${RECORD_ID}`);

        const { context } = rig.updates[0];
        expect(context?.userId).toBe(OWNER);
        // The negative half, asserted directly rather than inferred from the
        // write having succeeded: `buildActionExecutionContext` forces
        // `isSystem: true` for script BODIES, and this path must never touch
        // it. Both spellings, so neither an explicit `false` nor the key's
        // absence can be mistaken for the elevation.
        expect(context?.isSystem).not.toBe(true);
        expect(Boolean(context?.isSystem)).toBe(false);
        expect(context?.tenantId).toBe('org_1');
    });

    it('the MCP `run_action` door performs the SAME write, with the same identity', async () => {
        const rig = makeRig();
        const out: any = await dispatchMcp(OWNER, rig, 'close_case', { recordId: RECORD_ID });

        expect(out.ok).toBe(true);
        expect(out.result).toMatchObject({ operation: DECLARATIVE_UPDATE_OPERATION, object: OBJECT, id: RECORD_ID });
        expect(rig.updates).toHaveLength(1);
        expect(rig.updates[0].context?.userId).toBe(OWNER);
        expect(rig.updates[0].context?.isSystem).not.toBe(true);
        expect(rig.row.status).toBe('closed');
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Contract point 4 — `{ ...patch, ...collectedParams }`
// ───────────────────────────────────────────────────────────────────────────

describe('#15079 point 4 — the write is `{ ...patch, ...params }`, a param of the same name WINS', () => {
    it('merges the static patch UNDER the collected params', async () => {
        const rig = makeRig();
        const res = await dispatchRest(OWNER, rig, `/${OBJECT}/triage_case/${RECORD_ID}`, {
            params: { priority: 'urgent' },
        });

        expect(res.status).toBe(200);
        expect(rig.updates[0].data).toEqual({ status: 'triaged', priority: 'urgent' });
        expect(rig.row).toMatchObject({ status: 'triaged', priority: 'urgent' });
    });

    it('nothing else from the action is merged — the pure function, both directions', () => {
        // The precedence, isolated from every door.
        expect(declarativeUpdateWrite(
            { patch: { a: 1, b: 2 }, target: 'x', bodyExtra: { c: 3 }, label: 'L' },
            { b: 9 },
        )).toEqual({ a: 1, b: 9 });
        // ⛔ `bodyExtra`, `target` and `label` did not appear — asserted by the
        // `toEqual` above, which is exact, not by eye.
        expect(declarativeUpdateWrite({ patch: { a: 1 } }, undefined)).toEqual({ a: 1 });
        expect(declarativeUpdateWrite({}, { a: 1 })).toEqual({ a: 1 });
    });

    it('the wire cannot widen the write bag — an undeclared param is refused by ADR-0104 D2', async () => {
        const rig = makeRig();
        const res = await dispatchRest(OWNER, rig, `/${OBJECT}/triage_case/${RECORD_ID}`, {
            params: { priority: 'urgent', owner_id: STRANGER },
        });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.message).toMatch(/Invalid action params/);
        // The point of the pin: the refusal happened BEFORE any write, so the
        // smuggled key never reached the row.
        expect(rig.updates).toHaveLength(0);
        expect(rig.row.owner_id).toBe(OWNER);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Contract point 3 — permissions, hooks and validations, exactly as a user edit
// ───────────────────────────────────────────────────────────────────────────

describe('#15079 point 3 — the authorization point: a caller who cannot read or write is REFUSED', () => {
    it('a caller who cannot READ the row is refused, located, and NOTHING is written', async () => {
        const rig = makeRig();
        const res = await dispatchRest(STRANGER, rig, `/${OBJECT}/close_case/${RECORD_ID}`);

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('RECORD_NOT_FOUND');
        expect(res.body.error.message).toContain(RECORD_ID);
        expect(res.body.error.message).toContain(OBJECT);
        // ⛔ The #14143 class: a swallowed load must never become an implicit
        // grant. The verdict is CONSUMED — no write was even attempted.
        expect(rig.updates).toHaveLength(0);
        expect(rig.row.status).toBe('open');
    });

    it('a caller who can READ but not WRITE is refused BY THE DATA PLANE, under their own identity', async () => {
        const rig = makeRig();
        const res = await dispatchRest(READER, rig, `/${OBJECT}/close_case/${RECORD_ID}`);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('PERMISSION_DENIED');
        // ⭐ The write WAS attempted — and it was attempted as the reader, which
        // is why it failed. This is the pin an elevated write turns green: with
        // `isSystem: true` the double's bypass arm accepts it and the row
        // changes. Both halves asserted.
        expect(rig.updates).toHaveLength(1);
        expect(rig.updates[0].context?.userId).toBe(READER);
        expect(rig.updates[0].context?.isSystem).not.toBe(true);
        expect(rig.row.status).toBe('open');
    });

    it('the MCP door refuses an unreadable row identically — one executor, two doors', async () => {
        const rig = makeRig();
        await expect(dispatchMcp(STRANGER, rig, 'close_case', { recordId: RECORD_ID }))
            .rejects.toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
        expect(rig.updates).toHaveLength(0);
    });

    it("the object's before-update hook runs, sees the write bag and the CALLER's identity", async () => {
        const rig = makeRig();
        await dispatchRest(OWNER, rig, `/${OBJECT}/close_case/${RECORD_ID}`);

        expect(rig.hooks).toHaveLength(1);
        expect(rig.hooks[0].data).toEqual({ status: 'closed' });
        expect(rig.hooks[0].userId).toBe(OWNER);
        expect(rig.hooks[0].isSystem).not.toBe(true);
    });

    it('a validation / hook rejection SURFACES with its own envelope, not a 500', async () => {
        const rig = makeRig({
            beforeUpdate: (data) => {
                if (data.status === 'closed') {
                    throw Object.assign(new Error('A case with open tasks cannot be closed'), {
                        code: 'VALIDATION_FAILED', status: 400,
                    });
                }
            },
        });
        const res = await dispatchRest(OWNER, rig, `/${OBJECT}/close_case/${RECORD_ID}`);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.message).toBe('A case with open tasks cannot be closed');
        expect(rig.row.status).toBe('open');
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Contract point 6 — `visible` is a UI gate, NOT authorization
// ───────────────────────────────────────────────────────────────────────────

describe('#15079 point 6 — `visible` is never read as a permission check', () => {
    it('a `visible` predicate that is false for the row does NOT stop an authorized caller', async () => {
        // `CLOSE_CASE.visible` is `record.status == "open"`. Move the row out of
        // that state and invoke anyway: the server must still perform the write,
        // because `visible` is a renderer predicate and point 3 is the gate.
        const rig = makeRig();
        rig.row.status = 'triaged';
        const res = await dispatchRest(OWNER, rig, `/${OBJECT}/close_case/${RECORD_ID}`);

        expect(res.status).toBe(200);
        expect(rig.row.status).toBe('closed');
    });

    it('…and it does not GRANT: an unreadable row is still refused for an action whose `visible` is absent', async () => {
        const rig = makeRig();
        const res = await dispatchRest(STRANGER, rig, `/${OBJECT}/triage_case/${RECORD_ID}`, {
            params: { priority: 'urgent' },
        });

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('RECORD_NOT_FOUND');
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Contract point 7 — no current record ⇒ a LOCATED refusal, never a no-op
// ───────────────────────────────────────────────────────────────────────────

describe('#15079 point 7 — no current record is a located refusal, not a silent no-op', () => {
    it('no `recordId` on the route or in the body ⇒ 400, naming the action and the fix', async () => {
        const rig = makeRig();
        const res = await dispatchRest(OWNER, rig, `/${OBJECT}/close_case`);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.message).toContain('close_case');
        expect(res.body.error.message).toContain(OBJECT);
        expect(res.body.error.message).toMatch(/recordId/);
        expect(rig.updates).toHaveLength(0);
    });

    it('a `recordId` in the BODY is a current record — the route shape is not the only one', async () => {
        const rig = makeRig();
        const res = await dispatchRest(OWNER, rig, `/${OBJECT}/close_case`, { recordId: RECORD_ID });

        expect(res.status).toBe(200);
        expect(rig.updates).toHaveLength(1);
        expect(rig.row.status).toBe('closed');
    });

    it('an OBJECT-LESS action key ⇒ 400 naming `objectName`, and no write', async () => {
        const globalUpdate = {
            name: 'global_update',
            label: 'Global',
            operation: 'update',
            patch: { status: 'closed' },
            ai: { exposed: true, description: 'x' },
        };
        const rig = makeRig({ standaloneAction: globalUpdate });
        const res = await dispatchRest(OWNER, rig, `/global_update`, { recordId: RECORD_ID });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.message).toMatch(/objectName/);
        expect(rig.updates).toHaveLength(0);
    });

    it('a STANDALONE action that names its `objectName` works, exactly as an embedded one', async () => {
        const standalone = {
            name: 'escalate_case',
            label: 'Escalate',
            objectName: OBJECT,
            operation: 'update',
            patch: { priority: 'high' },
            ai: { exposed: true, description: 'Escalate this case.' },
        };
        const rig = makeRig({ standaloneAction: standalone });
        const res = await dispatchRest(OWNER, rig, `/${OBJECT}/escalate_case/${RECORD_ID}`);

        expect(res.status).toBe(200);
        expect(rig.updates[0].data).toEqual({ priority: 'high' });
        expect(rig.updates[0].context?.userId).toBe(OWNER);
        expect(rig.row.priority).toBe('high');
    });

    it('an update with nothing to write is refused rather than answering 200 for a no-op', async () => {
        const paramsOnly = {
            name: 'set_note',
            label: 'Note',
            objectName: OBJECT,
            operation: 'update',
            params: [{ name: 'note', type: 'text' }],
            ai: { exposed: true, description: 'Note.' },
        };
        const rig = makeRig({ standaloneAction: paramsOnly });
        const res = await dispatchRest(OWNER, rig, `/${OBJECT}/set_note/${RECORD_ID}`, { params: {} });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.message).toMatch(/nothing to write/);
        expect(rig.updates).toHaveLength(0);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Contract point 5 — `undoable` gets its anchor
// ───────────────────────────────────────────────────────────────────────────

describe('#15079 point 5 — `undoable: true` carries the prior values of EXACTLY the fields written', () => {
    it('the result carries `undo` with the prior value of every written field, and no other', async () => {
        const rig = makeRig();
        const res = await dispatchRest(OWNER, rig, `/${OBJECT}/close_case/${RECORD_ID}`);

        expect(res.body.data.undo).toEqual({
            type: 'update',
            objectName: OBJECT,
            recordId: RECORD_ID,
            undoData: { status: 'open' },      // the row's value BEFORE the write
            redoData: { status: 'closed' },    // what was written
        });
        // EXACTLY the written fields: `priority` and `owner_id` were on the row
        // and are NOT in `undoData`, because they were not written.
        expect(Object.keys(res.body.data.undo.undoData)).toEqual(['status']);
    });

    it('a field the row did not carry restores to `null`, never to an absent key', async () => {
        const setNote = {
            name: 'flag_case',
            label: 'Flag',
            objectName: OBJECT,
            operation: 'update',
            patch: { note: 'flagged' },
            undoable: true,
            ai: { exposed: true, description: 'Flag.' },
        };
        const rig = makeRig({ standaloneAction: setNote });
        const res = await dispatchRest(OWNER, rig, `/${OBJECT}/flag_case/${RECORD_ID}`);

        // `note` is declared on the object and absent from the row. An absent
        // key would leave the field at its new value on restore.
        expect('note' in res.body.data.undo.undoData).toBe(true);
        expect(res.body.data.undo.undoData.note).toBeNull();
        expect(res.body.data.undo.redoData).toEqual({ note: 'flagged' });
    });

    it('an action that does NOT declare `undoable` carries no `undo` at all', async () => {
        const rig = makeRig();
        const res = await dispatchRest(OWNER, rig, `/${OBJECT}/triage_case/${RECORD_ID}`, {
            params: { priority: 'urgent' },
        });

        // ABSENT, not an empty object — the firing positive control for this
        // zero is the `close_case` case above, same rig, same expectation shape.
        expect('undo' in res.body.data).toBe(false);
        expect(res.body.data.undo).toBeUndefined();
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Contract point 1 — `operation` is read BEFORE `type`, at every reader
// ───────────────────────────────────────────────────────────────────────────

describe('#15079 point 1 — the `type`-only predicates learned `operation`', () => {
    const NO_DEPS: any = {};

    it('the discriminator itself is a bare read of the declared key', () => {
        expect(isDeclarativeUpdateAction(CLOSE_CASE)).toBe(true);
        expect(isDeclarativeUpdateAction(HANDLER_ONLY)).toBe(false);
        expect(isDeclarativeUpdateAction(undefined)).toBe(false);
        expect(isDeclarativeUpdateAction({ operation: 'delete' })).toBe(false);
    });

    it('the headless predicate treats it as invokable despite no `target` and no `body`', () => {
        expect(isHeadlessInvokableAction(NO_DEPS, CLOSE_CASE, false)).toBe(true);
        // The control: the same action WITHOUT `operation` is the shape the
        // predicate has always rejected, so this `true` is the new branch and
        // not a rig that says `true` to everything.
        const { operation, ...withoutOperation } = CLOSE_CASE as any;
        expect(operation).toBe('update');
        expect(isHeadlessInvokableAction(NO_DEPS, withoutOperation, false)).toBe(false);
    });

    it('the type-error prescription stays silent for it — including when `type` contradicts `operation`', () => {
        expect(headlessActionTypeError(NO_DEPS, CLOSE_CASE, OBJECT)).toBeNull();
        // Data at rest that never went through `ActionSchema` — `operation`
        // wins, so no `url` prescription is handed to an action that writes.
        expect(headlessActionTypeError(NO_DEPS, { ...CLOSE_CASE, type: 'url', target: '/x' }, OBJECT)).toBeNull();
        // The control: same `type`, no `operation` ⇒ the prescription is back.
        expect(headlessActionTypeError(NO_DEPS, { name: 'go', type: 'url', target: '/x' }, OBJECT))
            .toMatch(/client-side action with no server dispatch/);
    });

    it('the MCP listing summary carries `operation` and always requires a record', () => {
        // ⚠️ `CLOSE_CASE` declares NO `locations` — the key `requiresRecord`
        // was derived from before this card. An agent told `false` would invoke
        // without a `recordId` and collect point 7's refusal.
        expect((CLOSE_CASE as any).locations).toBeUndefined();
        const summary = summarizeAction(NO_DEPS, CLOSE_CASE, OBJECT_DEF, OBJECT);
        expect(summary.operation).toBe(DECLARATIVE_UPDATE_OPERATION);
        expect(summary.type).toBe('script');
        expect(summary.requiresRecord).toBe(true);
        // The control: a locations-less action with no `operation` still says
        // `false`, so the `true` above is this card's branch.
        const plain = summarizeAction(NO_DEPS, HANDLER_ONLY, OBJECT_DEF, OBJECT);
        expect(plain.requiresRecord).toBe(false);
        expect('operation' in plain).toBe(false);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// The REVERSE pin — the script path is not widened
// ───────────────────────────────────────────────────────────────────────────

describe('#15079 reverse pin — a handler-less `type: script` action WITHOUT `operation` is unchanged', () => {
    it("keeps today's not-registered answer, and writes nothing", async () => {
        const rig = makeRig();
        const res = await dispatchRest(OWNER, rig, `/${OBJECT}/nudge_case/${RECORD_ID}`);

        expect(res.status).toBe(404);
        expect(res.body.error.message).toBe(`Action 'nudge_case' on object '${OBJECT}' not found`);
        // It went to the REGISTRY, which is the whole content of "not widened".
        expect(rig.ql.executeAction).toHaveBeenCalled();
        expect(rig.updates).toHaveLength(0);
        expect(rig.row.status).toBe('open');
    });
});
