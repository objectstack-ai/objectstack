// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17432 — WHAT an unscoped `/packages*` reaches under
 * `projectResolution: 'required'`.
 *
 * ## Why this measurement exists, ahead of any repair
 *
 * The card is a doc/code disagreement: `content/docs/api/environment-routing.mdx`
 * says `required` registers ONLY environment-scoped routes for
 * data/meta/AI/automation/package handlers, while `dispatcher-plugin.ts` mounts
 * `/packages*` unscoped unconditionally — deliberately, and recorded at the
 * mount site. Which side is wrong cannot be decided from the prose, because the
 * sentence asserts an ISOLATION property: if the unscoped door lets a caller
 * reach ANOTHER environment's package data, the finding is a tenancy leak and
 * not drift, and the remedy is not a doc edit. So the property is measured
 * here, and the file stays as the pin on the answer.
 *
 * ## The mechanism, stated so the assertions can be read against it
 *
 * The dispatcher owns no environment resolution (ADR-0006 Phase 5). It
 * contributes two parsing HINTS — `routePath` and `urlEnvironmentId` — and the
 * host's `KernelResolver` resolves the environment and returns the kernel the
 * request is served from. `urlEnvironmentId` has exactly two sources
 * (`prepareResolverHints`): an `/environments/:id` segment in the path, and
 * `req.params.environmentId`. The unscoped mount supplies NEITHER, so an
 * unscoped `/packages` request reaches the resolver naming no environment of
 * its own and is bound by the host's documented order 2-6 (hostname /
 * `X-Environment-Id` / session / configured default / sole environment). The
 * scoped URL is order 1 — the STRONGER addressing primitive, not the weaker
 * one.
 *
 * Both mounts call `dispatcher.dispatch()` with the same pre-stripped subpath
 * (`/packages…`), the scoped one carrying `:environmentId` on `req.params`, so
 * the two calls below are the two real mounts rather than lookalikes.
 *
 * ## The observable, and why it is a RESPONSE rather than only a spy
 *
 * "Reached environment E's package data" is mechanically "the door read E's
 * `objectql`": `handlePackagesRequest` resolves its registry through
 * `deps.getObjectQL(_context)`, which reads the REQUEST's kernel and nothing
 * else, BEFORE the capability gate. So the fixture gives the two environments
 * data planes that answer differently — one registry-bearing, one not — and the
 * door's own status then names which environment it was bound to: `503`
 * ("Package service not available", the registry-less host default) versus the
 * `403 PERMISSION_DENIED` capability refusal that only a registry-bearing
 * environment can produce. Spies on `objectql` resolution and on
 * `sys_environment_member` corroborate it.
 *
 * ⚠️ Read the 403s for their CODE, never as "some refusal": three different
 * gates answer 403 on these paths and only one of them is about tenancy.
 * `PROJECT_MEMBERSHIP_REQUIRED` is the tenancy gate; `PERMISSION_DENIED` here
 * is the ADR-0106 D4 capability gate INSIDE the domain, i.e. proof of arrival.
 *
 * ## The positive control
 *
 * ⛔ "No leak" may not be asserted by a probe that could not have seen one. The
 * POSITIVE CONTROL drives the same door, the same assertion and the same
 * observables for a request the host's resolver does bind to `env_beta`: the
 * probe then reports `env_beta`'s data plane, through the identical channel the
 * no-leak legs read as the host default. The membership gate is armed the same
 * way (`sys_environment_member` answers with no row for a non-member), so a
 * path that REACHES it comes back `PROJECT_MEMBERSHIP_REQUIRED` and a path that
 * skips it does not — the two classes separated by the answer itself, which is
 * the `http-dispatcher.membership-skip-boundary` fixture's argument reused.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher, type HttpProtocolContext, type KernelResolver } from './http-dispatcher.js';

const USER_ID = 'user-tenant-alpha';
const TENANT_ORG = 'org-tenant';
const ENV_ALPHA = 'env_alpha';
const ENV_BETA = 'env_beta';

interface FakeKernel {
    label: string;
    kernel: any;
    /** How often this kernel was asked for `objectql` — the binding record. */
    objectqlAsked: () => number;
    /** Every `sys_environment_member` probe this kernel served. */
    memberQueries: () => any[];
    /** Every `registry.getAllPackages()` read — package rows actually served. */
    packageRowsRead: () => number;
}

/**
 * One environment's kernel: its own `objectql` and its own `auth`.
 *
 *  - `memberOf` — the environments whose `sys_environment_member` row this
 *    kernel finds, so "not a member" is a fixture decision rather than an
 *    accident of an unwired service (the gate fails open in many ways).
 *  - `withRegistry` — whether its `objectql` carries a `registry`.
 *    `getObjectQLService` returns null without one, so the packages door
 *    answers 503 instead of reaching its capability gate. That difference is
 *    what makes "which environment answered" readable off the response.
 */
function makeKernel(label: string, opts: { memberOf?: string[]; withRegistry?: boolean } = {}): FakeKernel {
    const memberOf = new Set(opts.memberOf ?? []);
    const memberQueries: any[] = [];
    let objectqlAsked = 0;
    let packageRowsRead = 0;

    const registry = {
        getAllPackages: vi.fn(() => {
            packageRowsRead++;
            return [{ manifest: { id: `pkg.of.${label}` }, status: 'installed', enabled: true }];
        }),
        getPackage: vi.fn(() => undefined),
        getObject: vi.fn(() => null),
        getRegisteredTypes: vi.fn(() => []),
    };

    const objectql: Record<string, unknown> = {
        find: vi.fn(async (object: string, q: any) => {
            if (object === 'sys_environment_member') {
                memberQueries.push(q?.where);
                return memberOf.has(q?.where?.environment_id) ? [{ id: 'row' }] : [];
            }
            return [];
        }),
        getObjects: vi.fn(() => ({})),
    };
    if (opts.withRegistry !== false) objectql.registry = registry;

    const auth = {
        getApi: async () => ({
            getSession: async () => ({
                user: { id: USER_ID },
                session: { userId: USER_ID, activeOrganizationId: TENANT_ORG },
            }),
        }),
    };

    const services: Record<string, any> = { objectql, auth };

    const resolve = (name: string, scopeId?: string) => {
        // A non-shared-kernel host: nothing here is a SCOPED service, so a
        // scoped lookup declines and the dispatcher's `resolveService` chain
        // falls through to the request's own kernel.
        if (scopeId) return null;
        if (name === 'objectql') objectqlAsked++;
        return services[name] ?? null;
    };

    const kernel: any = {
        getState: () => 'running',
        getService: (name: string, scopeId?: string) => resolve(name, scopeId),
        getServiceAsync: async (name: string, scopeId?: string) => resolve(name, scopeId),
        context: { getService: (name: string) => resolve(name) },
    };

    return {
        label,
        kernel,
        objectqlAsked: () => objectqlAsked,
        memberQueries: () => memberQueries,
        packageRowsRead: () => packageRowsRead,
    };
}

/**
 * A multi-environment host: two tenant environments with registry-bearing data
 * planes and a registry-LESS default kernel, plus a resolver implementing the
 * documented order restricted to the two steps the open-source dispatcher can
 * influence — the scoped URL (order 1) and `X-Environment-Id` (order 3). Steps
 * 2/4/5/6 are host strategy and are modelled by their outcome: "no environment
 * resolved", which routes to the default kernel.
 */
function makeHost(opts: { memberOf?: string[] } = {}) {
    const host = makeKernel('host-default', { withRegistry: false });
    const alpha = makeKernel(ENV_ALPHA, { memberOf: opts.memberOf });
    const beta = makeKernel(ENV_BETA, { memberOf: opts.memberOf });
    const byId: Record<string, FakeKernel> = { [ENV_ALPHA]: alpha, [ENV_BETA]: beta };
    const seen: Array<{ routePath?: string; urlEnvironmentId?: string; header?: string; resolved?: string }> = [];

    const resolver: KernelResolver = {
        resolveKernel: (context: HttpProtocolContext, defaultKernel: any) => {
            const headers: any = context.request?.headers;
            const header: string | undefined = typeof headers?.get === 'function'
                ? (headers.get('x-environment-id') ?? undefined)
                : headers?.['x-environment-id'];
            const resolved = context.urlEnvironmentId ?? header;
            seen.push({
                routePath: context.routePath,
                urlEnvironmentId: context.urlEnvironmentId,
                header,
                resolved,
            });
            if (!resolved) return undefined; // unscoped / single-environment
            context.environmentId = resolved;
            return byId[resolved]?.kernel ?? defaultKernel;
        },
    };

    const dispatcher = new HttpDispatcher(host.kernel, undefined, {
        enforceProjectMembership: true,
        kernelResolver: resolver,
    });

    /** The UNSCOPED mount — `registerPackageRoutes(prefix)`, no env anywhere. */
    const unscoped = (headers: Record<string, string> = {}) => dispatcher.dispatch(
        'GET', '/packages', undefined, {},
        { request: { headers, params: {} } } as any,
    );

    /** The SCOPED mount — same handler, `:environmentId` on `req.params`. */
    const scoped = (environmentId: string, headers: Record<string, string> = {}) => dispatcher.dispatch(
        'GET', '/packages', undefined, {},
        { request: { headers, params: { environmentId } } } as any,
    );

    return { host, alpha, beta, seen, unscoped, scoped };
}

/** The tenancy gate's refusal — the ONE 403 on these paths that is about isolation. */
const refusedForTenancy = (r: any) =>
    r?.response?.status === 403 && r?.response?.body?.error?.code === 'PROJECT_MEMBERSHIP_REQUIRED';

/** Arrival INSIDE the packages domain, on a registry-bearing environment. */
const reachedPackagesDoor = (r: any) =>
    r?.response?.status === 403
    && r?.response?.body?.error?.code === 'PERMISSION_DENIED'
    && /Reading packages requires/.test(String(r?.response?.body?.error?.message ?? ''));

/** Arrival on the registry-LESS host default. */
const servedByHostDefault = (r: any) =>
    r?.response?.status === 503
    && /Package service not available/.test(String(r?.response?.body?.error?.message ?? ''));

describe('#17432 — the unscoped /packages door names no environment of its own', () => {
    it('the resolver sees NO environment hint from the unscoped mount, and one from the scoped mount', async () => {
        const h = makeHost({ memberOf: [ENV_BETA] });

        await h.unscoped();
        expect(h.seen.at(-1)).toMatchObject({
            routePath: '/packages', urlEnvironmentId: undefined, resolved: undefined,
        });

        // CONTROL for that `undefined`: the same field is populated the moment
        // the caller does name an environment, so it is a reading rather than
        // an unwired hint.
        await h.scoped(ENV_BETA);
        expect(h.seen.at(-1)).toMatchObject({ urlEnvironmentId: ENV_BETA, resolved: ENV_BETA });
    });

    it('an unscoped request with no environment context is served by the HOST default, not by a tenant environment', async () => {
        const h = makeHost({ memberOf: [ENV_ALPHA, ENV_BETA] });

        const r = await h.unscoped();

        expect(servedByHostDefault(r)).toBe(true);
        expect(h.host.objectqlAsked()).toBeGreaterThan(0);
        expect(h.alpha.objectqlAsked()).toBe(0);
        expect(h.beta.objectqlAsked()).toBe(0);
        expect(h.alpha.packageRowsRead()).toBe(0);
        expect(h.beta.packageRowsRead()).toBe(0);
    });

    it('POSITIVE CONTROL: the same probe DOES report a tenant environment when the host binds the request to one', async () => {
        // Same door, same assertions, same spies — only the host's resolver
        // differs in what it resolves (header, documented order 3). Were the
        // leg above vacuous, this one could not separate the two.
        const h = makeHost({ memberOf: [ENV_ALPHA, ENV_BETA] });

        const r = await h.unscoped({ 'x-environment-id': ENV_BETA });

        expect(reachedPackagesDoor(r)).toBe(true);
        expect(servedByHostDefault(r)).toBe(false);
        expect(h.beta.objectqlAsked()).toBeGreaterThan(0);
        expect(h.seen.at(-1)).toMatchObject({ urlEnvironmentId: undefined, resolved: ENV_BETA });
    });
});

describe('#17432 — the unscoped door runs the SAME isolation gates as the scoped one', () => {
    it('a non-member is refused for TENANCY on both mounts, before the domain, with no package row served', async () => {
        const h = makeHost({ memberOf: [ENV_ALPHA] }); // NOT a member of env_beta

        const viaHeader = await h.unscoped({ 'x-environment-id': ENV_BETA });
        const viaUrl = await h.scoped(ENV_BETA);

        expect(refusedForTenancy(viaHeader)).toBe(true);
        expect(refusedForTenancy(viaUrl)).toBe(true);
        // Refused BEFORE the door: no arrival, no rows.
        expect(reachedPackagesDoor(viaHeader)).toBe(false);
        expect(reachedPackagesDoor(viaUrl)).toBe(false);
        expect(h.beta.packageRowsRead()).toBe(0);
        // …and the control plane really was asked, once per request.
        expect(h.beta.memberQueries()).toEqual([
            { environment_id: ENV_BETA, user_id: USER_ID },
            { environment_id: ENV_BETA, user_id: USER_ID },
        ]);
    });

    it('a member reaches the SAME door through either mount — the two answers are identical', async () => {
        const h = makeHost({ memberOf: [ENV_ALPHA, ENV_BETA] });

        const viaHeader = await h.unscoped({ 'x-environment-id': ENV_BETA });
        const viaUrl = await h.scoped(ENV_BETA);

        expect(reachedPackagesDoor(viaHeader)).toBe(true);
        expect(viaUrl.response.status).toBe(viaHeader.response.status);
        expect(viaUrl.response.body).toEqual(viaHeader.response.body);
    });
});
