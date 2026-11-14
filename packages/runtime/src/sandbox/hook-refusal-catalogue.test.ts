// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26170] A hook's declared refusal catalogue, answered by the sandboxed body
 * runner (maintainer ruling 6431311681, letter A).
 *
 * Driven through the real factory and the real QuickJS runner, and read off
 * `mapDataError` — the ADR-0112 table every HTTP door answers with — so what is
 * asserted is the status, code and sentence the caller is answered with.
 */

import { describe, it, expect } from 'vitest';
import { mapDataError } from '@objectstack/types';

import { hookBodyRunnerFactory, withInProcessHookTitle } from './body-runner.js';
import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import {
    DEFAULT_HOOK_REFUSAL_STATUS,
    declaredRefusalMessage,
    hookRefusalI18nReader,
    inProcessHostSurface,
    isInProcessHostRaised,
    resolveHookRefusal,
    resolveInProcessHookRefusal,
    type HookRefusalI18nService,
} from './hook-refusal-catalogue.js';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000 });

const REFUSALS = {
    CREDIT_LIMIT: { message: 'This order exceeds the customer credit limit.' },
    ACCOUNT_ON_HOLD: { message: 'The account is on hold.', status: 409 },
};

const ZH = '订单超出客户信用额度。';

/** An i18n service holding one zh-CN translation; echoes the key on a miss, as `II18nService` does. */
function i18nService(overrides: Partial<HookRefusalI18nService> = {}): HookRefusalI18nService {
    const bundle: Record<string, Record<string, string>> = {
        'zh-CN': { 'hooks.credit_guard.refusals.CREDIT_LIMIT.message': ZH },
    };
    return {
        t: (key, locale) => bundle[locale]?.[key] ?? key,
        getLocales: () => ['en', 'zh-CN'],
        ...overrides,
    };
}

/** A `beforeInsert` hook with the catalogue, bound through the real factory. */
function boundHook(source: string, opts: { refusals?: object; i18n?: () => HookRefusalI18nService | undefined } = {}) {
    const fn = hookBodyRunnerFactory(runner, { ql: {}, appId: 'crm', i18n: opts.i18n })({
        name: 'credit_guard',
        object: 'order',
        events: ['beforeInsert'],
        body: { language: 'js', source, capabilities: ['api.write'] },
        refusals: 'refusals' in opts ? opts.refusals : REFUSALS,
    } as any);
    expect(fn, 'the hook body must bind').toBeTypeOf('function');
    return fn!;
}

async function rejectionOf(p: Promise<unknown>): Promise<any> {
    const err = await p.then(() => null, (e) => e);
    expect(err, 'expected the body to reject').not.toBeNull();
    return err;
}

const throwing = (code: string) => `throw Object.assign(new Error('internal detail'), { code: '${code}' });`;
const ctx = (locale?: string) => ({ object: 'order', event: 'beforeInsert', input: {}, session: locale ? { userId: 'u1', locale } : { userId: 'u1' } });

describe('[#26170] a declared code is answered with the catalogue entry', () => {
    it('the declared message, the declared code, and 400 when the entry names no status', async () => {
        const err = await rejectionOf(boundHook(throwing('CREDIT_LIMIT'))(ctx()));
        expect(err).toBeInstanceOf(SandboxError);
        const wire = mapDataError(err, 'order');
        expect(wire.status).toBe(DEFAULT_HOOK_REFUSAL_STATUS);
        // An author's code is not an ADR-0112 registered one: the wire `code` is
        // the status's registered code, and the declared one rides beside it.
        expect(wire.body.code).toBe('VALIDATION_ERROR');
        expect(wire.body.declaredCode).toBe('CREDIT_LIMIT');
        expect(wire.body.userMessage).toBe(REFUSALS.CREDIT_LIMIT.message);
        // The body's own sentence is not what the caller reads.
        expect(JSON.stringify(wire.body)).not.toContain('internal detail');
    });

    it('the entry\'s status, and the body\'s own status is not read', async () => {
        const err = await rejectionOf(boundHook(
            "throw Object.assign(new Error('x'), { code: 'ACCOUNT_ON_HOLD', status: 422 });",
        )(ctx()));
        const wire = mapDataError(err, 'order');
        expect(wire.status).toBe(409);
        expect(wire.body.declaredCode).toBe('ACCOUNT_ON_HOLD');
        expect(wire.body.userMessage).toBe('The account is on hold.');
    });

    it('translated in the caller\'s locale through `hooks.<hook>.refusals.<CODE>.message`', async () => {
        const err = await rejectionOf(boundHook(throwing('CREDIT_LIMIT'), { i18n: () => i18nService() })(ctx('zh-CN')));
        expect(mapDataError(err, 'order').body.userMessage).toBe(ZH);
    });

    it('negotiated against the locales the service holds — `zh` picks `zh-CN`', async () => {
        const err = await rejectionOf(boundHook(throwing('CREDIT_LIMIT'), { i18n: () => i18nService() })(ctx('zh')));
        expect(mapDataError(err, 'order').body.userMessage).toBe(ZH);
    });

    it('the declared message when the locale has no translation, or no locale was asked', async () => {
        const i18n = () => i18nService();
        for (const c of [ctx('fr-FR'), ctx()]) {
            const err = await rejectionOf(boundHook(throwing('CREDIT_LIMIT'), { i18n })(c));
            expect(mapDataError(err, 'order').body.userMessage).toBe(REFUSALS.CREDIT_LIMIT.message);
        }
    });

    it('the declared message when no i18n service is registered', async () => {
        const err = await rejectionOf(boundHook(throwing('CREDIT_LIMIT'), { i18n: () => undefined })(ctx('zh-CN')));
        expect(mapDataError(err, 'order').body.userMessage).toBe(REFUSALS.CREDIT_LIMIT.message);
    });

    it('`e.code = …; throw e` is the same refusal', async () => {
        const err = await rejectionOf(boundHook("const e = new Error('x'); e.code = 'CREDIT_LIMIT'; throw e;")(ctx()));
        expect(mapDataError(err, 'order').body.declaredCode).toBe('CREDIT_LIMIT');
    });
});

describe('[#26170] an undeclared code is refused loudly at run time', () => {
    it('a code the catalogue does not declare is a 500 fault naming the hook and the code', async () => {
        const err = await rejectionOf(boundHook(
            "const c = 'CREDIT' + '_LIMT'; throw Object.assign(new Error('x'), { code: c });",
        )(ctx()));
        expect(err).toBeInstanceOf(SandboxError);
        expect(err.innerMessage).toBeUndefined();
        expect(err.message).toContain("hook 'credit_guard' threw code 'CREDIT_LIMT'");
        expect(mapDataError(err, 'order').status).toBe(500);
    });

    it('a throw with no code is the same fault', async () => {
        const err = await rejectionOf(boundHook("throw new Error('no code');")(ctx()));
        expect(err.message).toContain('threw no `code`');
        expect(mapDataError(err, 'order').status).toBe(500);
    });
});

describe('[#26170] what the body did not make passes through untouched', () => {
    it('a hook without `refusals` is answered as before', async () => {
        const err = await rejectionOf(boundHook(
            "throw Object.assign(new Error('Refused.'), { code: 'ANY_CODE', status: 422 });",
            { refusals: undefined },
        )(ctx()));
        const wire = mapDataError(err, 'order');
        expect(wire.status).toBe(422);
        expect(wire.body.declaredCode).toBe('ANY_CODE');
        expect(wire.body.userMessage).toBeUndefined();
    });

    it('a crash stays a crash', async () => {
        const err = await rejectionOf(boundHook('const v = null; return v.x;')(ctx()));
        expect(err.message).not.toContain('declares no such code');
        expect(mapDataError(err, 'order').status).toBe(500);
    });

    it('a host error the body lets leave unchanged is not judged against the catalogue', async () => {
        const hostRefusal = Object.assign(new Error('Field `amount` is required.'), { code: 'VALIDATION_FAILED', status: 400 });
        const fn = hookBodyRunnerFactory(runner, {
            ql: { object: () => ({ insert: async () => { throw hostRefusal; } }) },
            appId: 'crm',
        })({
            name: 'credit_guard',
            object: 'order',
            events: ['beforeInsert'],
            body: { language: 'js', source: "await ctx.api.object('audit').insert({});", capabilities: ['api.write'] },
            refusals: REFUSALS,
        } as any)!;
        const err = await rejectionOf(fn(ctx()));
        expect(String(err.message)).not.toContain('declares no such code');
        expect(err.code).toBe('VALIDATION_FAILED');
    });

    it('a host error the body catches and re-throws with its own declared code is the body\'s refusal', async () => {
        const fn = hookBodyRunnerFactory(runner, {
            ql: { object: () => ({ insert: async () => { throw Object.assign(new Error('dup'), { code: 'X' }); } }) },
            appId: 'crm',
        })({
            name: 'credit_guard',
            object: 'order',
            events: ['beforeInsert'],
            body: {
                language: 'js',
                source: "try { await ctx.api.object('audit').insert({}); } catch (e) { e.code = 'ACCOUNT_ON_HOLD'; throw e; }",
                capabilities: ['api.write'],
            },
            refusals: REFUSALS,
        } as any)!;
        const err = await rejectionOf(fn(ctx()));
        expect(mapDataError(err, 'order').status).toBe(409);
        expect(mapDataError(err, 'order').body.declaredCode).toBe('ACCOUNT_ON_HOLD');
    });
});

describe('declaredRefusalMessage / hookRefusalI18nReader', () => {
    const entry = REFUSALS.CREDIT_LIMIT;

    it('a service that throws picks nothing and is warned about', () => {
        const warned: string[] = [];
        const message = declaredRefusalMessage(
            'credit_guard', 'CREDIT_LIMIT', entry, 'zh-CN',
            () => i18nService({ t: () => { throw new Error('boom'); } }),
            { warn: (m: string) => warned.push(m) },
        );
        expect(message).toBe(entry.message);
        expect(warned[0]).toContain("'hooks.credit_guard.refusals.CREDIT_LIMIT.message'");
    });

    it('a blank translation picks nothing', () => {
        expect(declaredRefusalMessage('credit_guard', 'CREDIT_LIMIT', entry, 'zh-CN', () => i18nService({ t: () => '  ' }))).toBe(entry.message);
    });

    it('the reader answers undefined while no service is registered, and reads at call time', () => {
        let registered: unknown;
        const reader = hookRefusalI18nReader({
            getService: <T,>(name: string): T => {
                if (name !== 'i18n' || !registered) throw new Error('not registered');
                return registered as T;
            },
        });
        expect(reader()).toBeUndefined();
        registered = i18nService();
        expect(reader()).toBe(registered);
        registered = { notT: true };
        expect(reader()).toBeUndefined();
    });

    it('resolveHookRefusal returns a non-sandbox error unchanged', () => {
        const err = new Error('engine');
        expect(resolveHookRefusal({ name: 'h', refusals: REFUSALS } as any, err, ctx())).toBe(err);
    });
});

// ── #33214 (ruling 6879477573: 问一 A, 问二 S1, 问三 是) ──────────────────────

/** A catalogue with a code holding reasons and params. */
const PLAN_REFUSALS = {
    VALIDATION_FAILED: {
        message: 'This plan cannot be submitted.',
        params: ['state'],
        reasons: {
            plan_locked: { message: 'The plan is {{ state }} and can no longer change.' },
            second_primary: { message: 'This plant already has a primary.' },
        },
    },
    CREDIT_LIMIT: { message: 'Over the credit limit.' },
};

const PLAN_ZH = {
    'hooks.plan_gate.refusals.VALIDATION_FAILED.reasons.plan_locked.message': '计划已{{ state }}，不能再修改。',
    'hooks.plan_gate.refusals.CREDIT_LIMIT.message': '超出信用额度。',
};

function planI18n(): HookRefusalI18nService {
    return { t: (key, locale) => (locale === 'zh-CN' ? (PLAN_ZH as Record<string, string>)[key] ?? key : key), getLocales: () => ['en', 'zh-CN'] };
}

/** The plan hook, bound as a sandboxed body. */
function planBody(source: string) {
    return hookBodyRunnerFactory(runner, { ql: {}, appId: 'crm', i18n: () => planI18n() })({
        name: 'plan_gate',
        object: 'plan',
        events: ['beforeUpdate'],
        body: { language: 'js', source, capabilities: [] },
        refusals: PLAN_REFUSALS,
    } as any)!;
}

/** The plan hook, bound as an in-process handler through the seam every in-process handler runs through. */
function planHandler(handler: (ctx: any) => unknown, refusals: object | null = PLAN_REFUSALS) {
    return withInProcessHookTitle(handler, {}, { name: 'plan_gate', refusals } as any, { i18n: () => planI18n() });
}

const planCtx = (locale?: string, api?: unknown) => ({
    object: 'plan', event: 'beforeUpdate', input: {}, session: locale ? { userId: 'u1', locale } : { userId: 'u1' },
    ...(api !== undefined ? { api } : {}),
});

describe('[#33214] a declared reason under a code — the body path', () => {
    it('answers with the reason\'s sentence, the code\'s status and the code on the wire, unchanged', async () => {
        const err = await rejectionOf(planBody(
            "throw { code: 'VALIDATION_FAILED', reason: 'second_primary', message: 'internal' };",
        )(planCtx()));
        const wire = mapDataError(err, 'plan');
        expect(wire.status).toBe(400);
        expect(wire.body.code).toBe('VALIDATION_FAILED');
        expect(wire.body.userMessage).toBe('This plant already has a primary.');
        expect(JSON.stringify(wire.body)).not.toContain('internal');
        expect(JSON.stringify(wire.body)).not.toContain('second_primary');
    });

    it('a code thrown with no reason keeps the entry\'s own sentence', async () => {
        const err = await rejectionOf(planBody("throw { code: 'VALIDATION_FAILED', message: 'x' };")(planCtx()));
        expect(mapDataError(err, 'plan').body.userMessage).toBe('This plan cannot be submitted.');
    });

    it('a reason the code does not declare is a 500 fault naming the hook, the code and the reason', async () => {
        const err = await rejectionOf(planBody(
            "const r = 'plan_' + 'lockd'; throw { code: 'VALIDATION_FAILED', reason: r, message: 'x' };",
        )(planCtx()));
        expect(err).toBeInstanceOf(SandboxError);
        expect(err.innerMessage).toBeUndefined();
        expect(err.message).toContain("hook 'plan_gate' threw code 'VALIDATION_FAILED' with reason 'plan_lockd'");
        expect(mapDataError(err, 'plan').status).toBe(500);
    });

    it('a reason under a code that declares no reasons is the same fault', async () => {
        const err = await rejectionOf(planBody(
            "const r = 'x' + 'y'; throw { code: 'CREDIT_LIMIT', reason: r, message: 'x' };",
        )(planCtx()));
        expect(err.message).toContain("reason 'xy'");
        expect(mapDataError(err, 'plan').status).toBe(500);
    });
});

describe('[#33214] declared params fill the sentence\'s holes — the body path', () => {
    it('fills a declared hole from the throw\'s params', async () => {
        const err = await rejectionOf(planBody(
            "throw { code: 'VALIDATION_FAILED', reason: 'plan_locked', params: { state: 'approved' }, message: 'x' };",
        )(planCtx()));
        const wire = mapDataError(err, 'plan');
        expect(wire.status).toBe(400);
        expect(wire.body.code).toBe('VALIDATION_FAILED');
        expect(wire.body.userMessage).toBe('The plan is approved and can no longer change.');
    });

    it('fills the translated template in the caller\'s locale', async () => {
        const err = await rejectionOf(planBody(
            "throw Object.assign(new Error('x'), { code: 'VALIDATION_FAILED', reason: 'plan_locked', params: { state: '已批准' } });",
        )(planCtx('zh-CN')));
        expect(mapDataError(err, 'plan').body.userMessage).toBe('计划已已批准，不能再修改。');
    });

    it('a declared param the throw did not pass renders nothing; an undeclared one is not read', async () => {
        const err = await rejectionOf(planBody(
            "throw { code: 'VALIDATION_FAILED', reason: 'plan_locked', params: { other: 'leak' }, message: 'x' };",
        )(planCtx()));
        const sentence = mapDataError(err, 'plan').body.userMessage;
        expect(sentence).toBe('The plan is  and can no longer change.');
        expect(sentence).not.toContain('leak');
    });
});

describe('[#33214] a hook that uses none of the new parts answers byte-for-byte as before', () => {
    // Measured on the base commit (e540baf887) with the same fixture: the wire a
    // declared code answers with when the hook declares no reasons and no params.
    const BEFORE = '{"status":400,"body":{"error":"This order exceeds the customer credit limit.","code":"VALIDATION_ERROR","declaredCode":"CREDIT_LIMIT","object":"order","userMessage":"This order exceeds the customer credit limit."}}';

    it('the body path', async () => {
        const err = await rejectionOf(boundHook(throwing('CREDIT_LIMIT'))(ctx()));
        expect(JSON.stringify(mapDataError(err, 'order'))).toBe(BEFORE);
    });
});

describe('[#33214] the in-process seam answers the catalogue with the body path\'s wire', () => {
    it('a declared code: the same envelope the sandboxed body answers with', async () => {
        const viaBody = await rejectionOf(planBody("throw Object.assign(new Error('x'), { code: 'CREDIT_LIMIT' });")(planCtx('zh-CN')));
        const viaHandler = await rejectionOf(planHandler(async () => {
            throw Object.assign(new Error('x'), { code: 'CREDIT_LIMIT' });
        })(planCtx('zh-CN')));
        expect(viaHandler).toBeInstanceOf(SandboxError);
        expect(mapDataError(viaHandler, 'plan')).toEqual(mapDataError(viaBody, 'plan'));
        expect(mapDataError(viaHandler, 'plan').body.userMessage).toBe('超出信用额度。');
    });

    it('a declared reason with params, translated', async () => {
        const err = await rejectionOf(planHandler(async () => {
            throw Object.assign(new Error('x'), { code: 'VALIDATION_FAILED', reason: 'plan_locked', params: { state: '已批准' } });
        })(planCtx('zh-CN')));
        const wire = mapDataError(err, 'plan');
        expect(wire.status).toBe(400);
        expect(wire.body.code).toBe('VALIDATION_FAILED');
        expect(wire.body.userMessage).toBe('计划已已批准，不能再修改。');
    });

    it('a plain thrown object is read like an error', async () => {
        const err = await rejectionOf(planHandler(async () => {
            throw { code: 'VALIDATION_FAILED', reason: 'second_primary' };
        })(planCtx()));
        expect(mapDataError(err, 'plan').body.userMessage).toBe('This plant already has a primary.');
    });

    it('an undeclared code, an undeclared reason and a throw with no code are 500 faults', async () => {
        const cases: Array<[() => never, string]> = [
            [() => { throw Object.assign(new Error('x'), { code: 'NOPE' }); }, "threw code 'NOPE'"],
            [() => { throw Object.assign(new Error('x'), { code: 'VALIDATION_FAILED', reason: 'nope' }); }, "reason 'nope'"],
            [() => { throw new Error('no code'); }, 'threw no `code`'],
        ];
        for (const [thrower, text] of cases) {
            const err = await rejectionOf(planHandler(async () => thrower())(planCtx()));
            expect(err).toBeInstanceOf(SandboxError);
            expect(err.innerMessage).toBeUndefined();
            expect(err.message).toContain(text);
            expect(mapDataError(err, 'plan').status).toBe(500);
        }
    });

    it('a crash passes through untouched', async () => {
        const crash = new TypeError('x is undefined');
        const err = await rejectionOf(planHandler(async () => { throw crash; })(planCtx()));
        expect(err).toBe(crash);
    });

    it('an error a ctx.api call raised passes through unchanged, though its code is undeclared', async () => {
        const hostRefusal = Object.assign(new Error('Field `amount` is required.'), { code: 'VALIDATION_ERROR_X', status: 400 });
        const api = { object: () => ({ insert: async () => { throw hostRefusal; } }) };
        const err = await rejectionOf(planHandler(async (c: any) => {
            await c.api.object('audit').insert({});
        })(planCtx(undefined, api)));
        expect(err).toBe(hostRefusal);
        expect(isInProcessHostRaised(hostRefusal)).toBe(true);
    });

    it('…and so does one a ctx.ql call raised', async () => {
        const hostRefusal = Object.assign(new Error('engine'), { code: 'RECORD_NOT_FOUND' });
        const engineCtx = { ...planCtx(), ql: { getObject: () => { throw hostRefusal; } } };
        const err = await rejectionOf(planHandler(async (c: any) => { c.ql.getObject('x'); })(engineCtx));
        expect(err).toBe(hostRefusal);
    });

    it('the handler\'s own throw inside a transaction callback is its refusal; a host error inside it is not', async () => {
        const hostRefusal = Object.assign(new Error('dup'), { code: 'DUPLICATE_X' });
        const tx = { insert: async () => { throw hostRefusal; } };
        const api = { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
        const own = await rejectionOf(planHandler(async (c: any) => {
            await c.api.transaction(async () => { throw Object.assign(new Error('x'), { code: 'CREDIT_LIMIT' }); });
        })(planCtx(undefined, api)));
        expect(mapDataError(own, 'plan').body.userMessage).toBe('Over the credit limit.');
        const relayed = await rejectionOf(planHandler(async (c: any) => {
            await c.api.transaction(async (t: any) => { await t.insert({}); });
        })(planCtx(undefined, api)));
        expect(relayed).toBe(hostRefusal);
    });

    it('a host surface hands the host its own objects back, never a proxy', () => {
        const repo = { name: 'repo' };
        let received: unknown;
        const api = inProcessHostSurface({ object: () => repo, use: (r: unknown) => { received = r; } });
        const surfaced = api.object();
        expect(surfaced).not.toBe(repo);
        api.use(surfaced);
        expect(received).toBe(repo);
    });

    it('a hook that declares no catalogue is untouched: the same error, the context\'s own api', async () => {
        const thrown = Object.assign(new Error('Refused.'), { code: 'ANY_CODE', status: 422 });
        const api = { object: () => ({}) };
        let seenApi: unknown;
        const err = await rejectionOf(planHandler(async (c: any) => { seenApi = c.api; throw thrown; }, null)(planCtx(undefined, api)));
        expect(err).toBe(thrown);
        expect(seenApi).toBe(api);
        // The pre-#33214 call shape (a hook name) is unchanged too.
        const byName = await rejectionOf(withInProcessHookTitle(async () => { throw thrown; }, {}, 'plan_gate')(planCtx()));
        expect(byName).toBe(thrown);
    });

    it('resolveInProcessHookRefusal returns a SandboxError unchanged — a nested body\'s, or the platform\'s', () => {
        const nested = new SandboxError("hook 'inner' threw: x", 'x', { code: 'ANY' });
        expect(resolveInProcessHookRefusal({ name: 'plan_gate', refusals: PLAN_REFUSALS } as any, nested, planCtx())).toBe(nested);
    });
});
