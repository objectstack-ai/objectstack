// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0150 D5, epic #31527 child G1 (#31691), carry-in from E4 (#31728): the
 * catalog activation door (`POST /security/_activation/:type/:name`) answers a
 * declared name the package-scoped rule refuses as `409 RESOURCE_CONFLICT`
 * naming every candidate, and writes nothing.
 *
 * BASE (measured on main f30369003 before this change, this fixture):
 *  - a declared-name reader that refuses (plugin-sharing's
 *    `declaredRuleNamed` / `declaredQueueNamed` throw core's
 *    `PackageScopedNameRefusedError` since E4) answered the read-failure arm,
 *    `503 SERVICE_UNAVAILABLE` "the declared … could not be read";
 *  - an assignment rule two packages declare was looked up first-match in the
 *    registry list, so the door switched off whichever was listed first: 200.
 *
 * The security catalog itself (positions, permission sets) cannot hold two
 * package holders of one name — the registry refuses the second at
 * registration (`SecurityCatalogNameConflictError`), measured on the same base
 * — so no case of it is pinned here.
 */

import { describe, it, expect } from 'vitest';
import { PackageScopedNameRefusedError } from '@objectstack/core';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const LEDGER = 'sys_metadata_activation';
const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const SHARED = 'shared_rule';
const SOLO = 'solo_rule';

type Row = Record<string, unknown>;

/** The refusal plugin-sharing's declared-name readers throw for a name two packages declare. */
const twoHolders = (type: 'sharing_rule' | 'queue', name: string) => new PackageScopedNameRefusedError({
    status: 'refused',
    reason: 'ambiguous-in-environment',
    type,
    name,
    callerPackageId: null,
    candidates: [{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }],
    message: `The ${type} "${name}" is held by 2 packages in this environment and the caller names no package: `
        + `package "${A}"; package "${B}". Nothing picks one of them: address it by its package.`,
});

function boot() {
    const writes: Row[] = [];
    const tables: Record<string, Row[]> = { [LEDGER]: [] };
    const declared = (type: 'sharing_rule' | 'queue') => async (name: string) => {
        if (name === SHARED) throw twoHolders(type, name);
        return name === SOLO ? { name, packageId: A } : null;
    };
    const engine: any = {
        registry: {
            getObject: (name: string) => (name === LEDGER ? { name: LEDGER } : undefined),
            listItems: (type: string) => (type === 'assignment_rule'
                ? [
                    { name: SHARED, _packageId: A },
                    { name: SHARED, _packageId: B },
                    { name: SOLO, _packageId: A },
                ]
                : []),
        },
        async find(object: string, options: any) {
            return (tables[object] ?? []).filter((r) =>
                Object.entries(options?.where ?? {}).every(([k, v]) => (r[k] ?? null) === v));
        },
        async insert(object: string, data: Row) {
            writes.push(data);
            (tables[object] ??= []).push({ id: `act_${writes.length}`, ...data });
            return data;
        },
        async update(_object: string, data: Row) {
            writes.push(data);
            return data;
        },
    };
    const services: Record<string, unknown> = {
        objectql: engine,
        data: engine,
        sharingRules: { declaredRuleNamed: declared('sharing_rule') },
        'ownership-queue': { declaredQueueNamed: declared('queue') },
    };
    const resolveService = (name: string): unknown => services[name] ?? null;
    const kernel = {
        getService: resolveService,
        getServiceAsync: async (name: string) => resolveService(name),
        context: { getService: resolveService },
    };
    return { dispatcher: new HttpDispatcher(kernel as never), writes };
}

const OPERATOR = (): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: {
        userId: 'u_operator',
        positions: ['platform_admin'],
        permissions: ['admin_full_access'],
        systemPermissions: ['manage_metadata'],
        posture: 'PLATFORM_ADMIN',
        organizationId: null,
    },
} as unknown as HttpProtocolContext);

const flip = (h: ReturnType<typeof boot>, type: string, name: string) =>
    h.dispatcher.handleSecurity(`/_activation/${type}/${name}`, 'POST', { enabled: false }, {}, OPERATOR()) as Promise<any>;

describe('the activation door answers a refused declared name 409 with every candidate, writing nothing', () => {
    for (const type of ['sharing_rule', 'queue'] as const) {
        it(`${type}: the reader's refusal is 409 RESOURCE_CONFLICT naming both holders (BASE: 503)`, async () => {
            const h = boot();
            const res = await flip(h, type, SHARED);
            const error = res?.response?.body?.error;
            expect([res?.response?.status, error?.code], JSON.stringify(error)).toEqual([409, 'RESOURCE_CONFLICT']);
            expect(error?.message).toContain(`package "${A}"`);
            expect(error?.message).toContain(`package "${B}"`);
            expect(error?.details?.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
            expect(h.writes).toEqual([]);
        });
    }

    it('assignment_rule: two declaring packages are 409 naming both, never the first listed (BASE: 200)', async () => {
        const h = boot();
        const res = await flip(h, 'assignment_rule', SHARED);
        const error = res?.response?.body?.error;
        expect([res?.response?.status, error?.code], JSON.stringify(error)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect(error?.details?.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
        expect(h.writes).toEqual([]);
    });
});

describe('CONTROL — one holder and no holder answer as before', () => {
    for (const type of ['sharing_rule', 'queue', 'assignment_rule'] as const) {
        it(`${type}: one declaring package flips 200`, async () => {
            const h = boot();
            const res = await flip(h, type, SOLO);
            expect(res?.response?.status, JSON.stringify(res?.response?.body)).toBe(200);
            expect(h.writes).toHaveLength(1);
        });

        it(`${type}: a name nothing declares stays 404`, async () => {
            const h = boot();
            const res = await flip(h, type, 'nobody_declared_this');
            expect(res?.response?.status).toBe(404);
            expect(h.writes).toEqual([]);
        });
    }
});
