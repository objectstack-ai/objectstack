// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22944] A request the `kernel-resolver` routed to its OWN kernel is answered
// by that kernel first.
//
// ## The defect these pins hold down
//
// `HttpDispatcher.resolveService` asked `defaultKernel.getServiceAsync(name,
// scopeId)` BEFORE the request's own kernel. On a `kernel-resolver` host (the
// hosted multi-tenant runtime) the host kernel holds SINGLETON `protocol` /
// `metadata` / `objectql`, and a singleton answers that call whatever the
// scope — so every dispatcher door passing `context.environmentId` was handed
// the HOST's data plane. Measured on a hosted-shape rig (objectstack-ai/hotcrm#2065):
// `POST /actions/crm_lead/convert_lead` loaded its subject row through the
// host's protocol, which registers none of the environment's objects
// (`OBJECT_NOT_FOUND`); `loadActionSubjectRecord` swallowed that, and
// `refuseDeniedSubjectLoad` answered `404 RECORD_NOT_FOUND` for a row the
// caller reads with `GET /data/crm_lead/:id` in the same session.
//
// ## POPULATION
//
// Covers: the probe `resolveService` (via `domainDeps.resolveService`, the
// member every domain reads), on REAL kernels, in the three host shapes that
// reach it — a `kernel-resolver` host (request kernel ≠ default kernel), a
// single-environment host (no request kernel), and SharedProjectPlugin (a
// SCOPED factory on the default kernel, no request kernel) — plus the action
// door's subject-record load driven through the real `callData`.
//
// Does NOT cover: `resolveServiceOrLoud` / `classifyService`, whose order this
// card deliberately leaves alone (it decides which kernel's `tenancy` answers
// the identity step — see `./domains/scoped-service-miss-attribution.test.ts`).

import { describe, it, expect } from 'vitest';

import { ObjectKernel, ServiceLifecycle } from '@objectstack/core';
import { recordNotFoundError } from '@objectstack/metadata-protocol';

import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpProtocolContext } from './http-dispatcher.js';
import { callData, loadActionSubjectRecord, refuseDeniedSubjectLoad } from './action-execution.js';

const ENV_ID = 'env-northwind';
const OBJECT = 'crm_lead';
const RECORD_ID = 'GTS2jcGfJc2tHdxh';

/** No graceful-shutdown handlers: one kernel per case would otherwise pile up process listeners. */
const bareKernel = (): ObjectKernel =>
    new ObjectKernel({ gracefulShutdown: false, skipSystemValidation: true });

/**
 * The host kernel's protocol: it registers NONE of the environment's objects,
 * so reading one through it is the `OBJECT_NOT_FOUND` the rig measured.
 */
function hostProtocol() {
    return {
        __tag: 'host',
        async getData(req: { object: string }) {
            throw Object.assign(new Error(`Object '${req.object}' not found`), { code: 'OBJECT_NOT_FOUND', status: 404 });
        },
    };
}

/** The environment kernel's protocol: it serves the environment's row, and refuses an id that names nothing. */
function envProtocol() {
    return {
        __tag: 'env',
        async getData(req: { object: string; id: string }) {
            if (req.object === OBJECT && req.id === RECORD_ID) {
                return { object: OBJECT, id: RECORD_ID, record: { id: RECORD_ID, company: 'Northwind Energy' } };
            }
            throw recordNotFoundError(req.object, req.id);
        },
    };
}

type DomainDeps = {
    resolveService(context: HttpProtocolContext, name: string, environmentId?: string): Promise<any>;
};
/** `domainDeps` is private; this package's dispatcher pins reach it the same way. */
const depsOf = (d: HttpDispatcher): DomainDeps & Record<string, any> => (d as any).domainDeps;

/** The kernel-resolver shape: a host kernel and the environment kernel a request was routed to. */
function kernelResolverHost() {
    const host = bareKernel();
    host.registerService('protocol', hostProtocol());
    host.registerService('host-only', { __tag: 'host-only' });
    const env = bareKernel();
    env.registerService('protocol', envProtocol());
    const dispatcher = new HttpDispatcher(host as never);
    const context = { kernel: env, environmentId: ENV_ID } as unknown as HttpProtocolContext;
    return { dispatcher, context };
}

describe('[#22944] a request routed to its own kernel is answered by that kernel first', () => {
    it('resolves `protocol` on the request\'s environment kernel, not the host kernel\'s singleton', async () => {
        const { dispatcher, context } = kernelResolverHost();
        const protocol = await depsOf(dispatcher).resolveService(context, 'protocol', ENV_ID);
        expect(protocol.__tag).toBe('env');
    });

    it('still falls back to the host kernel for a service the environment kernel does not have', async () => {
        const { dispatcher, context } = kernelResolverHost();
        const svc = await depsOf(dispatcher).resolveService(context, 'host-only', ENV_ID);
        expect(svc?.__tag).toBe('host-only');
    });

    it('the action door\'s subject-record load delivers a row the caller can read (was 404 RECORD_NOT_FOUND)', async () => {
        const { dispatcher, context } = kernelResolverHost();
        const deps = depsOf(dispatcher);
        const subject = await loadActionSubjectRecord(OBJECT, RECORD_ID, () =>
            callData(deps as never, context, 'get', { object: OBJECT, id: RECORD_ID }, undefined, ENV_ID, { userId: 'u1' } as never));

        expect(subject.recordLoadDenied).toBe(false);
        expect(subject.record).toEqual({ id: RECORD_ID, company: 'Northwind Energy' });
        expect(() => refuseDeniedSubjectLoad(OBJECT, RECORD_ID, subject)).not.toThrow();
    });

    it('an id that names nothing is still refused with 404 RECORD_NOT_FOUND (#16854 unchanged)', async () => {
        const { dispatcher, context } = kernelResolverHost();
        const deps = depsOf(dispatcher);
        const subject = await loadActionSubjectRecord(OBJECT, 'doesNotExist0000', () =>
            callData(deps as never, context, 'get', { object: OBJECT, id: 'doesNotExist0000' }, undefined, ENV_ID, { userId: 'u1' } as never));

        expect(subject.recordLoadDenied).toBe(true);
        let thrown: any;
        try { refuseDeniedSubjectLoad(OBJECT, 'doesNotExist0000', subject); } catch (err) { thrown = err; }
        expect(thrown?.code).toBe('RECORD_NOT_FOUND');
        expect(thrown?.status ?? thrown?.statusCode).toBe(404);
    });
});

describe('[#22944] hosts without a request kernel resolve exactly as before', () => {
    it('single-environment host: the default kernel answers', async () => {
        const host = bareKernel();
        host.registerService('protocol', envProtocol());
        const dispatcher = new HttpDispatcher(host as never);
        const context = {} as HttpProtocolContext;

        const protocol = await depsOf(dispatcher).resolveService(context, 'protocol');
        expect(protocol.__tag).toBe('env');
    });

    it('SharedProjectPlugin: the default kernel\'s SCOPED factory answers for the scope it is given', async () => {
        const host = bareKernel();
        const scopesAsked: (string | undefined)[] = [];
        host.registerServiceFactory(
            'protocol',
            (_ctx: unknown, scopeId?: string) => {
                scopesAsked.push(scopeId);
                return { __tag: `scoped:${scopeId}` };
            },
            ServiceLifecycle.SCOPED,
        );
        const dispatcher = new HttpDispatcher(host as never);
        const context = { environmentId: ENV_ID } as unknown as HttpProtocolContext;

        const protocol = await depsOf(dispatcher).resolveService(context, 'protocol', ENV_ID);
        expect(protocol.__tag).toBe(`scoped:${ENV_ID}`);
        expect(scopesAsked).toContain(ENV_ID);
    });

    it('a request whose kernel IS the default kernel keeps the scoped-first order', async () => {
        const host = bareKernel();
        host.registerServiceFactory(
            'protocol',
            (_ctx: unknown, scopeId?: string) => ({ __tag: `scoped:${scopeId}` }),
            ServiceLifecycle.SCOPED,
        );
        const dispatcher = new HttpDispatcher(host as never);
        const context = { kernel: host, environmentId: ENV_ID } as unknown as HttpProtocolContext;

        const protocol = await depsOf(dispatcher).resolveService(context, 'protocol', ENV_ID);
        expect(protocol.__tag).toBe(`scoped:${ENV_ID}`);
    });
});
