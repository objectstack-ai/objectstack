// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30797] The dispatcher's `/meta` read gate applies a deployment's
 * `errors.permission_denied` override, as `RestServer`'s does.
 *
 * #30126 row 12 made the gate's `403 PERMISSION_DENIED` (an app, a dashboard
 * or a list view the caller may not open) render the operation catalog's
 * `permission_denied` in the caller's locale. `RestServer` handed the gate the
 * request's i18n lookup, so a deployment's override won there; the
 * dispatcher's `metaItemReadGateSources` handed none, so the same caller read
 * the built-in sentence through `HttpDispatcher` and the override through
 * `RestServer`. The dispatcher now hands the `i18n` service's `t`.
 *
 * Pinned, through `dispatch()`, on all three refusals:
 *  - an override registered for the caller's locale is the message;
 *  - CONTROL: no i18n service gives the built-in catalog sentence;
 *  - an i18n service that cannot be resolved, or whose `t` throws, gives the
 *    built-in sentence and still the 403, never a 500.
 */

import { describe, it, expect, vi } from 'vitest';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { HttpDispatcher } from '../http-dispatcher.js';

const OVERRIDE_ZH = '请向 Acme 管理员申请访问权限。';
const ZH = BUILTIN_OPERATION_MESSAGES['zh-CN'].permission_denied;

const STORE: Record<string, any[]> = {
    app: [{ name: 'com.objectstack.setup', label: 'Setup', requiredPermissions: ['setup.access'], navigation: [] }],
    dashboard: [{ name: 'legal_board', label: 'Legal board', requiredPermissions: ['legal.view'], widgets: [] }],
    view: [{ name: 'contract.legal_queue', object: 'contract', viewKind: 'list', config: { type: 'grid', columns: ['name'], requiredPermissions: ['legal.view'] } }],
};
const REFUSED: Array<[string, string]> = [
    ['app', 'com.objectstack.setup'],
    ['dashboard', 'legal_board'],
    ['view', 'contract.legal_queue'],
];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const singular = (type: unknown): string => String(type ?? '').replace(/s$/, '');

type I18n = 'override' | 'none' | 'unresolvable' | 't-throws';

function boot(i18n: I18n) {
    const protocol = {
        getMetaTypes: vi.fn(async () => ({ types: Object.keys(STORE) })),
        getMetaItems: vi.fn(async ({ type }: any) => clone(STORE[singular(type)] ?? [])),
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const found = (STORE[singular(type)] ?? []).find((i: any) => i.name === name);
            return { type: singular(type), name, item: found ? clone(found) : undefined, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
    };
    const t = vi.fn((key: string, locale: string) => {
        if (i18n === 't-throws') throw new Error('bundle corrupt');
        return key === 'errors.permission_denied' && locale === 'zh-CN' ? OVERRIDE_ZH : key;
    });
    const services: Record<string, unknown> = {
        protocol,
        security: { resolvePermissionSetNames: async () => [], getMetadataReadableFields: async () => [] },
        ...(i18n === 'override' || i18n === 't-throws' ? { i18n: { t, getLocales: () => ['en', 'zh-CN'], getDefaultLocale: () => 'en' } } : {}),
    };
    const get = (n: string) => {
        if (n === 'i18n' && i18n === 'unresolvable') throw new Error('i18n service failed to start');
        return services[n] ?? null;
    };
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () =>
        ({ userId: 'u_member', isSystem: false, systemPermissions: [], locale: 'zh-CN' });
    const read = async (type: string, name: string) => {
        const res = await dispatcher.dispatch('GET', `/meta/${type}/${name}`, undefined, {}, { request: { headers: {} } } as any);
        return { status: res.response?.status ?? 0, body: res.response?.body };
    };
    return { read, t };
}

describe('[#30797] the dispatcher /meta 403 applies the errors.permission_denied override', () => {
    for (const [type, name] of REFUSED) {
        it(`${type}/${name}: the override registered for the caller's locale is the message`, async () => {
            const { read, t } = boot('override');
            const a = await read(type, name);
            expect(a.status).toBe(403);
            expect(a.body?.error?.code).toBe('PERMISSION_DENIED');
            expect(a.body?.error?.message).toBe(OVERRIDE_ZH);
            expect(t).toHaveBeenCalledWith('errors.permission_denied', 'zh-CN', expect.anything());
        });

        it(`${type}/${name}: CONTROL — no i18n service gives the built-in catalog sentence`, async () => {
            const a = await boot('none').read(type, name);
            expect(a.status).toBe(403);
            expect(a.body?.error?.code).toBe('PERMISSION_DENIED');
            expect(a.body?.error?.message).toBe(ZH);
        });

        for (const failure of ['unresolvable', 't-throws'] as const) {
            it(`${type}/${name}: an i18n service that is ${failure} gives the built-in sentence and the 403`, async () => {
                const a = await boot(failure).read(type, name);
                expect(a.status).toBe(403);
                expect(a.body?.error?.code).toBe('PERMISSION_DENIED');
                expect(a.body?.error?.message).toBe(ZH);
            });
        }
    }
});
