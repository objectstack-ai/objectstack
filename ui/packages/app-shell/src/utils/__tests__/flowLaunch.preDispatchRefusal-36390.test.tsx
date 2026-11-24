/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * A refusal the action door raises BEFORE it hands the click to its target
 * (objectstack#36390) — the caller-scoped load of the subject record answering
 * `404 RECORD_NOT_FOUND` because the record was deleted or became unreadable
 * after the page loaded — reaches the user as the envelope's producer-marked
 * `userMessage`, the translated line, and as its developer `message` only when
 * it carries none. The same rule the handler-throws path follows: every
 * action-failure path, every action type that reaches the door.
 *
 * Each case hands the answer to a real `ActionRunner` (the one the console
 * builds) and reads the toast it speaks, so the pin is what the user reads,
 * not an intermediate field.
 *
 * ⚠️ A `.tsx` on purpose, though it renders nothing: the `dom` project isolates
 * each file, so the `vi.mock('sonner')` below is this file's own (see
 * `flowLaunch.translation-12075.test.tsx`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionRunner, createServerActionHandler } from '@object-ui/core';
import type { ActionDef, ActionResult } from '@object-ui/core';
import { ApiErrorSchema } from '@objectstack/spec/api';
import { launchConsoleFlow } from '../flowLaunch';
import { apiActionRefusalResult, interpretFlowResponse } from '../flowResponse';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const RECORD_ID = 'tsk_0042';
const MESSAGE = `Record ${RECORD_ID} not found in showcase_task`;
const USER_MESSAGE = '该记录不存在，或您无权访问它。';

/** The door's pre-dispatch refusal, proven real by the spec's own schema. */
function recordNotFound(userMessage?: string) {
    const error = {
        code: 'RECORD_NOT_FOUND',
        message: MESSAGE,
        httpStatus: 404,
        ...(userMessage !== undefined ? { userMessage } : {}),
    };
    expect(ApiErrorSchema.safeParse(error).error?.issues).toBeUndefined();
    return { success: false, error };
}

function answering(status: number, body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

/** Run `action` through a real runner whose handler for its type is `handler`; return the error toasts. */
async function toastedBy(action: ActionDef, handler: (a: ActionDef) => Promise<ActionResult>) {
    const toast = vi.fn();
    const runner = new ActionRunner({});
    runner.setToastHandler(toast as never);
    runner.registerHandler(action.type as string, handler as never);
    await runner.execute(action as never);
    return toast.mock.calls.filter(([, opts]) => (opts as { type?: string })?.type === 'error').map(([m]) => m);
}

beforeEach(() => {
    toasts.error.mockClear();
    toasts.success.mockClear();
});

describe('a pre-dispatch refusal on a declared flow action shows its userMessage (objectstack#36390)', () => {
    const ACTION: ActionDef = { name: 'escalate_task', type: 'flow', target: 'task_escalate' } as ActionDef;
    const OBJECTS = [{ name: 'showcase_task', actions: [{ name: 'escalate_task', type: 'flow', target: 'task_escalate' }] }];

    async function launchToast(body: unknown) {
        const fetch = answering(404, body);
        let door: string | undefined;
        const shown = await toastedBy(ACTION, async (action) => {
            const out = await launchConsoleFlow({
                fetch,
                baseUrl: '',
                action,
                objectName: 'showcase_task',
                recordId: RECORD_ID,
                triggerParams: {},
                objects: OBJECTS,
                language: 'zh-CN',
                droppedFields: { t: ((key: string) => key) as never, fieldLabel: (_o, _f, fallback) => fallback, dataSource: null },
            });
            door = out.door;
            return out.judged.result;
        });
        return { shown, door, url: (fetch.mock.calls[0] as unknown[])[0] };
    }

    it('the envelope carries a userMessage: the toast reads it, not the developer message', async () => {
        const { shown, door, url } = await launchToast(recordNotFound(USER_MESSAGE));
        expect(door).toBe('action');
        expect(url).toBe('/api/v1/actions/showcase_task/escalate_task');
        expect(shown).toEqual([USER_MESSAGE]);
    });

    it('the envelope carries none: the toast falls back to its message', async () => {
        const { shown } = await launchToast(recordNotFound());
        expect(shown).toEqual([MESSAGE]);
    });

    it('a blank userMessage is no marking: the toast reads the message', async () => {
        const { shown } = await launchToast({ success: false, error: { code: 'RECORD_NOT_FOUND', message: MESSAGE, httpStatus: 404, userMessage: '   ' } });
        expect(shown).toEqual([MESSAGE]);
    });
});

describe('every other refusal the flow reader meets before a run reads it the same way', () => {
    it.each([
        ['a 404 on resume', { ok: false, status: 404 }, false],
        ['a denied subject (403)', { ok: false, status: 403 }, true],
        ['a locked subject (409)', { ok: false, status: 409 }, true],
        ['an outer success:false under a 200', { ok: true, status: 200 }, true],
    ] as const)('%s', (_name, res, retryable) => {
        const marked = { success: false, error: { code: 'X_REFUSED', message: MESSAGE, userMessage: USER_MESSAGE } };
        const unmarked = { success: false, error: { code: 'X_REFUSED', message: MESSAGE } };
        expect(interpretFlowResponse(res, marked, 'Resume')).toEqual({ kind: 'failed', error: USER_MESSAGE, retryable });
        expect(interpretFlowResponse(res, unmarked, 'Resume')).toEqual({ kind: 'failed', error: MESSAGE, retryable });
    });
});

describe('the api and script types reach the same door and show the same line', () => {
    it("type: 'api' — the host's refusal reader carries the userMessage to the toast", async () => {
        const action = { name: 'reassign_task', type: 'api', target: '/api/v1/showcase/reassign' } as ActionDef;
        const marked = await toastedBy(action, async () => apiActionRefusalResult({ status: 404 }, recordNotFound(USER_MESSAGE), 'HTTP 404', 'zh-CN'));
        const unmarked = await toastedBy(action, async () => apiActionRefusalResult({ status: 404 }, recordNotFound(), 'HTTP 404', 'zh-CN'));
        expect(marked).toEqual([USER_MESSAGE]);
        expect(unmarked).toEqual([MESSAGE]);
    });

    it("type: 'script' — core's dispatcher already carries it (the control)", async () => {
        const action = { name: 'close_task', type: 'script', objectName: 'showcase_task' } as ActionDef;
        const dispatchWith = (body: unknown) => createServerActionHandler({
            fetch: answering(404, body),
            resolveRecordId: () => ({ recordId: RECORD_ID }),
        });
        expect(await toastedBy(action, dispatchWith(recordNotFound(USER_MESSAGE)))).toEqual([USER_MESSAGE]);
        expect(await toastedBy(action, dispatchWith(recordNotFound()))).toEqual([MESSAGE]);
    });
});
