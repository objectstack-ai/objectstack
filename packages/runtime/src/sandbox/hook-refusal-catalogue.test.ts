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

import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import {
    DEFAULT_HOOK_REFUSAL_STATUS,
    declaredRefusalMessage,
    hookRefusalI18nReader,
    resolveHookRefusal,
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
        expect(wire.body.code).toBe('CREDIT_LIMIT');
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
        expect(wire.body.code).toBe('ACCOUNT_ON_HOLD');
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
        expect(mapDataError(err, 'order').body.code).toBe('CREDIT_LIMIT');
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
        expect(wire.body.code).toBe('ANY_CODE');
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
        expect(mapDataError(err, 'order').body.code).toBe('ACCOUNT_ON_HOLD');
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
