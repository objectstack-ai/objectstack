// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34273] An action's declared refusal catalogue (`ActionSchema.refusals`),
 * answered by the sandboxed ACTION body runner — the hook catalogue's twin
 * (#26170, ruling 6431311681 letter A; #33214, ruling 6879477573).
 *
 * Driven through the real `actionBodyRunnerFactory` and the real QuickJS
 * runner, and read off `mapDataError` (the ADR-0112 table) and the real
 * `/actions` door (`HttpDispatcher.handleActions`), so what is asserted is the
 * status, code and sentence the caller is answered with — never a hand-built
 * `SandboxError`.
 */

import { describe, it, expect, vi } from 'vitest';
// Paid at collection, not inside a case's clocked window: the dispatcher's
// reach loads `@objectstack/metadata` lazily (`check:test-source-alias`).
import '@objectstack/metadata';
import { mapDataError } from '@objectstack/types';

import { actionBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import { DEFAULT_HOOK_REFUSAL_STATUS, resolveActionRefusal, type HookRefusalI18nService } from './hook-refusal-catalogue.js';
import { HttpDispatcher } from '../http-dispatcher.js';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000, actionTimeoutMs: 10_000 });

const REFUSALS = {
    SIGN_IN_REQUIRED: { message: 'Sign in to rate this article.', status: 401 },
    STAGE_LOCKED: {
        message: 'This stage change is not allowed.',
        params: ['stage'],
        reasons: { closed: { message: 'A {{ stage }} opportunity can no longer change stage.' } },
    },
    NOT_DRAFT: { message: 'Only a draft invoice can be signed off.', status: 409 },
};

/** An i18n service holding zh-CN translations; echoes the key on a miss, as `II18nService` does. */
function i18nService(bundle: Record<string, string>): HookRefusalI18nService {
    const locales: Record<string, Record<string, string>> = { 'zh-CN': bundle };
    return {
        t: (key, locale) => locales[locale]?.[key] ?? key,
        getLocales: () => ['en', 'zh-CN'],
    };
}

const BOUND_KEY = 'objects.crm_invoice._actions.submit_signoff.refusals.NOT_DRAFT.message';
const GLOBAL_KEY = 'globalActions.submit_signoff.refusals.NOT_DRAFT.message';
const ZH_BOUND = '只有草稿发票可以签核。';
const ZH_GLOBAL = '（全局）只有草稿发票可以签核。';

/** A `script` action with a `js` body and the catalogue, bound through the real factory. */
function boundAction(
    source: string,
    opts: { refusals?: object; objectName?: string | null; i18n?: () => HookRefusalI18nService | undefined } = {},
) {
    const objectName = opts.objectName === undefined ? 'crm_invoice' : opts.objectName ?? undefined;
    const fn = actionBodyRunnerFactory(runner, { ql: {}, appId: 'crm', i18n: opts.i18n })({
        name: 'submit_signoff',
        type: 'script',
        ...(objectName !== undefined ? { objectName, object: objectName } : {}),
        body: { language: 'js', source, capabilities: [] },
        refusals: 'refusals' in opts ? opts.refusals : REFUSALS,
    } as any);
    expect(fn, 'the action body must bind').toBeTypeOf('function');
    return fn!;
}

/** The context the action dispatch hands a handler — the caller's negotiated locale on `executionContext`. */
const actionCtx = (locale?: string) => ({
    input: {},
    executionContext: locale ? { userId: 'u1', locale } : { userId: 'u1' },
});

async function rejectionOf(p: Promise<unknown>): Promise<any> {
    const err = await p.then(() => null, (e) => e);
    expect(err, 'expected the body to reject').not.toBeNull();
    return err;
}

const throwing = (code: string) => `throw Object.assign(new Error('internal detail'), { code: '${code}' });`;

describe('[#34273] a declared code is answered with the action\'s catalogue entry', () => {
    it('the declared message, the entry\'s status and the declared code; the body\'s own text is not served', async () => {
        const err = await rejectionOf(boundAction(throwing('NOT_DRAFT'))(actionCtx()));
        expect(err).toBeInstanceOf(SandboxError);
        const wire = mapDataError(err, 'crm_invoice');
        expect(wire.status).toBe(409);
        expect(wire.body.declaredCode).toBe('NOT_DRAFT');
        expect(wire.body.userMessage).toBe(REFUSALS.NOT_DRAFT.message);
        expect(JSON.stringify(wire.body)).not.toContain('internal detail');
    });

    it('400 when the entry names no status, and a status the body sets is not read', async () => {
        const err = await rejectionOf(boundAction(
            "throw Object.assign(new Error('x'), { code: 'STAGE_LOCKED', status: 422 });",
        )(actionCtx()));
        const wire = mapDataError(err, 'crm_invoice');
        expect(wire.status).toBe(DEFAULT_HOOK_REFUSAL_STATUS);
        expect(wire.body.declaredCode).toBe('STAGE_LOCKED');
        expect(wire.body.userMessage).toBe('This stage change is not allowed.');
    });

    it('translated in the caller\'s locale (`executionContext.locale`) at `objects.<object>._actions.<action>.refusals.<CODE>.message`', async () => {
        const i18n = () => i18nService({ [BOUND_KEY]: ZH_BOUND, [GLOBAL_KEY]: ZH_GLOBAL });
        const err = await rejectionOf(boundAction(throwing('NOT_DRAFT'), { i18n })(actionCtx('zh-CN')));
        const wire = mapDataError(err, 'crm_invoice');
        expect(wire.status).toBe(409);
        expect(wire.body.declaredCode).toBe('NOT_DRAFT');
        // The bound action reads its object's group, never `globalActions`.
        expect(wire.body.userMessage).toBe(ZH_BOUND);
    });

    it('negotiated against the locales the service holds — `zh` picks `zh-CN`', async () => {
        const i18n = () => i18nService({ [BOUND_KEY]: ZH_BOUND });
        const err = await rejectionOf(boundAction(throwing('NOT_DRAFT'), { i18n })(actionCtx('zh')));
        expect(mapDataError(err, 'crm_invoice').body.userMessage).toBe(ZH_BOUND);
    });

    it('an object-less action reads `globalActions.<action>.refusals.<CODE>.message`', async () => {
        const i18n = () => i18nService({ [BOUND_KEY]: ZH_BOUND, [GLOBAL_KEY]: ZH_GLOBAL });
        const err = await rejectionOf(boundAction(throwing('NOT_DRAFT'), { i18n, objectName: null })(actionCtx('zh-CN')));
        expect(mapDataError(err, 'crm_invoice').body.userMessage).toBe(ZH_GLOBAL);
    });

    it('CONTROL: the declared message when the locale has no translation, no locale was asked, or no service is registered', async () => {
        const withBundle = () => i18nService({ [BOUND_KEY]: ZH_BOUND });
        for (const [i18n, ctx] of [
            [withBundle, actionCtx('fr-FR')],
            [withBundle, actionCtx()],
            [() => undefined, actionCtx('zh-CN')],
        ] as const) {
            const err = await rejectionOf(boundAction(throwing('NOT_DRAFT'), { i18n })(ctx));
            expect(mapDataError(err, 'crm_invoice').body.userMessage).toBe(REFUSALS.NOT_DRAFT.message);
        }
    });
});

describe('[#34273] a declared reason and declared params — the action body path', () => {
    it('answers with the reason\'s sentence, its holes filled from the throw\'s params, under the code\'s status', async () => {
        const err = await rejectionOf(boundAction(
            "throw { code: 'STAGE_LOCKED', reason: 'closed', params: { stage: 'Closed Won' }, message: 'internal' };",
        )(actionCtx()));
        const wire = mapDataError(err, 'crm_invoice');
        expect(wire.status).toBe(400);
        expect(wire.body.declaredCode).toBe('STAGE_LOCKED');
        expect(wire.body.userMessage).toBe('A Closed Won opportunity can no longer change stage.');
        expect(JSON.stringify(wire.body)).not.toContain('internal');
    });

    it('the reason\'s translation is read at `….refusals.<CODE>.reasons.<REASON>.message`, filled after', async () => {
        const i18n = () => i18nService({
            'objects.crm_invoice._actions.submit_signoff.refusals.STAGE_LOCKED.reasons.closed.message':
                '{{ stage }} 的商机不能再改阶段。',
        });
        const err = await rejectionOf(boundAction(
            "throw { code: 'STAGE_LOCKED', reason: 'closed', params: { stage: '赢单' } };",
            { i18n },
        )(actionCtx('zh-CN')));
        expect(mapDataError(err, 'crm_invoice').body.userMessage).toBe('赢单 的商机不能再改阶段。');
    });

    it('a reason the code does not declare is a 500 fault naming the action, the code and the reason', async () => {
        const err = await rejectionOf(boundAction(
            "const r = 'clos' + 'd'; throw { code: 'STAGE_LOCKED', reason: r };",
        )(actionCtx()));
        expect(err).toBeInstanceOf(SandboxError);
        expect(err.innerMessage).toBeUndefined();
        expect(err.message).toContain("action 'submit_signoff' threw code 'STAGE_LOCKED' with reason 'closd'");
        expect(mapDataError(err, 'crm_invoice').status).toBe(500);
    });
});

describe('[#34273] what the catalogue cannot answer is refused loudly at run time', () => {
    it('a code the catalogue does not declare is a 500 fault naming the action and the code', async () => {
        const err = await rejectionOf(boundAction(
            "const c = 'NOT_' + 'DRAFTT'; throw Object.assign(new Error('x'), { code: c });",
        )(actionCtx()));
        expect(err).toBeInstanceOf(SandboxError);
        expect(err.innerMessage).toBeUndefined();
        expect(err.message).toContain("action 'submit_signoff' threw code 'NOT_DRAFTT'");
        expect(err.message).toContain('declares no such code');
        expect(mapDataError(err, 'crm_invoice').status).toBe(500);
    });

    it('a throw with no code is the same fault', async () => {
        const err = await rejectionOf(boundAction("throw new Error('no code');")(actionCtx()));
        expect(err.message).toContain("action 'submit_signoff'");
        expect(err.message).toContain('threw no `code`');
        expect(mapDataError(err, 'crm_invoice').status).toBe(500);
    });
});

describe('[#34273] what the catalogue does not own passes through untouched', () => {
    it('CONTROL: an action without `refusals` is answered as before', async () => {
        const err = await rejectionOf(boundAction(
            "throw Object.assign(new Error('Refused.'), { code: 'ANY_CODE', status: 422 });",
            { refusals: undefined },
        )(actionCtx('zh-CN')));
        const wire = mapDataError(err, 'crm_invoice');
        expect(wire.status).toBe(422);
        expect(wire.body.declaredCode).toBe('ANY_CODE');
        expect(wire.body.userMessage).toBeUndefined();
    });

    it('a crash stays a crash', async () => {
        const err = await rejectionOf(boundAction('const v = null; return v.x;')(actionCtx()));
        expect(err.message).not.toContain('declares no such code');
        expect(mapDataError(err, 'crm_invoice').status).toBe(500);
    });

    it('resolveActionRefusal leaves an error the body did not make as it is', () => {
        const hostRefusal = Object.assign(new Error('Field `amount` is required.'), { code: 'VALIDATION_FAILED', status: 400 });
        const action = { name: 'submit_signoff', objectName: 'crm_invoice', refusals: REFUSALS };
        expect(resolveActionRefusal(action, hostRefusal, actionCtx('zh-CN'))).toBe(hostRefusal);
    });
});

/** The real `/actions` door, answering whatever the action dispatch threw. */
async function throughActionsDoor(thrown: unknown) {
    const action = {
        name: 'submit_signoff',
        objectName: 'crm_invoice',
        type: 'script',
        body: { language: 'js', source: throwing('NOT_DRAFT'), capabilities: [] },
        refusals: REFUSALS,
    };
    const objectDef = { name: 'crm_invoice', actions: [action] };
    const ql: any = {
        executeAction: vi.fn(async () => { throw thrown; }),
        getSchema: (n: string) => (n === objectDef.name ? objectDef : undefined),
        registry: { getObject: (n: string) => (n === objectDef.name ? objectDef : undefined), getItem: () => undefined },
        find: vi.fn(async () => [{ id: 'inv_1', status: 'sent' }]),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : null,
        },
    };
    const res: any = await new HttpDispatcher(kernel).handleActions(
        '/crm_invoice/submit_signoff/inv_1',
        'POST',
        {},
        { request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } } as any,
    );
    return res.response;
}

describe('[#34273] the `/actions` door answers the declared refusal in the caller\'s language', () => {
    it('the entry\'s status and code, and the translated sentence on `userMessage`', async () => {
        const i18n = () => i18nService({ [BOUND_KEY]: ZH_BOUND });
        const err = await rejectionOf(boundAction(throwing('NOT_DRAFT'), { i18n })(actionCtx('zh-CN')));
        const response = await throughActionsDoor(err);
        expect(response.status).toBe(409);
        expect(response.body.error.userMessage).toBe(ZH_BOUND);
        expect(JSON.stringify(response.body)).toContain('NOT_DRAFT');
        expect(JSON.stringify(response.body)).not.toContain('internal detail');
    });

    it('CONTROL: an action without `refusals` keeps the body\'s own 400 and no `userMessage`', async () => {
        const err = await rejectionOf(boundAction(throwing('NOT_DRAFT'), { refusals: undefined })(actionCtx('zh-CN')));
        const response = await throughActionsDoor(err);
        expect(response.status).toBe(400);
        expect(response.body.error.userMessage).toBeUndefined();
    });
});
