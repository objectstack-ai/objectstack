// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37533] A script action whose write a field validation refused answers
 * with the localized message alone, not `ValidationError: <message>`.
 *
 * Measured on 18.6.0 (zh-CN console, HotCRM Log a Call, Duration 1.5 into a
 * scale-0 number field): the toast read
 * `ValidationError: 时长（分钟）的小数位数不能超过 0 位(当前 1 位)`, where a form
 * save of the same refusal shows the message without the class name. The
 * sandbox flattened the rejection to `<name>: <message>` and dropped only a
 * default `Error: ` from the sentence it hands the door.
 *
 * This drives the real QuickJS runner into the real `/actions` door. The class
 * stays in the log line (`SandboxError.message`) and the code in `error.code`.
 * CONTROLS: a crash keeps its native name (it is told from a refusal by it),
 * and an uncoded error class keeps its name, as before.
 */

import { describe, it, expect, vi } from 'vitest';
// Paid at collection, not inside a case's clock: the dispatcher's reach loads
// it lazily (`check:test-source-alias`).
import '@objectstack/metadata';
import { ValidationError } from '@objectstack/objectql';

import { HttpDispatcher } from '../http-dispatcher.js';
import { QuickJSScriptRunner, SandboxError } from '../sandbox/quickjs-runner.js';
import type { ScriptContext } from '../sandbox/script-runner.js';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000 });

const MESSAGE = '时长（分钟）的小数位数不能超过 0 位(当前 1 位)';
const FIELDS = [{ field: 'duration_minutes', code: 'max_scale' as const, message: MESSAGE }];

/** Run the Log a Call body against an api whose write rejects with `thrown`; answer what the runner threw. */
async function runAction(source: string, thrown: unknown): Promise<SandboxError> {
    const api = { object: () => ({ insert: async () => { throw thrown; } }) } as any;
    const err = await runner
        .run(
            { language: 'js', source, capabilities: ['api.write'] },
            { input: { duration_minutes: 1.5 }, api } as ScriptContext,
            { origin: { kind: 'action', name: 'log_call' } },
        )
        .catch((e) => e);
    expect(err).toBeInstanceOf(SandboxError);
    return err;
}

const WRITE = `await ctx.api.object('crm_call').insert({ duration_minutes: ctx.input.duration_minutes }); return { ok: true };`;

/** The `/actions` door answering for an action whose handler rejected with `thrown`. */
async function invoke(thrown: unknown) {
    const objectDef = {
        name: 'crm_account',
        actions: [{ name: 'log_call', objectName: 'crm_account', type: 'script', body: { language: 'js', source: WRITE, capabilities: ['api.write'] } }],
    };
    const ql: any = {
        executeAction: vi.fn(async () => { throw thrown; }),
        getSchema: (n: string) => (n === objectDef.name ? objectDef : undefined),
        registry: { getObject: (n: string) => (n === objectDef.name ? objectDef : undefined), getItem: () => undefined },
        find: vi.fn(async () => [{ id: 'acc_1' }]),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const kernel: any = {
        context: { getService: (n: string) => (n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : null) },
    };
    const res: any = await new HttpDispatcher(kernel).handleActions(
        '/crm_account/log_call/acc_1',
        'POST',
        {},
        { request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } } as any,
    );
    return res.response;
}

describe('#37533 — a refused action write answers with the message alone', () => {
    it('the toast text is the localized message; the class stays in the log line, the code in error.code', async () => {
        const err = await runAction(WRITE, new ValidationError(FIELDS));

        expect(err.message).toBe(`action 'log_call' threw: ValidationError: ${MESSAGE}`);
        expect(err.innerMessage).toBe(MESSAGE);

        const response = await invoke(err);
        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe(MESSAGE);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(response.body.error.details).toMatchObject({ fields: FIELDS });
    });

    it('a body that catches and re-throws the refusal answers the same', async () => {
        const err = await runAction(`try { ${WRITE} } catch (e) { throw e; }`, new ValidationError(FIELDS));

        expect(err.innerMessage).toBe(MESSAGE);
    });

    it('CONTROL: a crash keeps its native name, and answers the sanitised 500', async () => {
        const err = await runAction(`ctx.input.duration_minutes.trim(); return {};`, new ValidationError(FIELDS));

        expect(err.innerMessage).toMatch(/^TypeError: /);
        expect((await invoke(err)).status).toBe(500);
    });

    it('CONTROL: an uncoded error class keeps its name', async () => {
        const err = await runAction(
            `class QuotaError extends Error { constructor(m) { super(m); this.name = 'QuotaError'; } } throw new QuotaError('No calls left this month');`,
            undefined,
        );

        expect(err.innerMessage).toBe('QuotaError: No calls left this month');
    });

    it('CONTROL: a plain Error\'s message is the sentence, as before', async () => {
        const err = await runAction(`throw new Error('Contact has no phone');`, undefined);

        expect(err.innerMessage).toBe('Contact has no phone');
    });
});
