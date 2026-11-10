// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The router's half of the action's `(package, objectName, name)` key
 * (ADR-0150 D3/D4) — #31673, child E2 of epic #31527.
 *
 * `resolveRouteActionDeclaration` given a caller's package resolves the bare
 * name through R's resolver (`resolveActionByPackage` in
 * `@objectstack/objectql`) and answers the holder's package coordinate;
 * `executeRegisteredAction` given that coordinate runs that package's handler.
 * A caller that names no package resolves and dispatches exactly as before
 * (the #31697 interim, ruling 6728550494 on epic #31527).
 *
 * Real: `ObjectQL` (its `SchemaRegistry` and action engine),
 * `ObjectStackProtocolImplementation`'s execution read. Doubled: the row store
 * under the protocol (empty — every declaration here is a registry item) and
 * `deps.resolveService`.
 *
 * No door passes a caller's package in this change: the qualified address
 * (G1 #31691) and the Console's held package (U #31671) will.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { PackageScopedNameRefusedError } from '@objectstack/core';
import { actionHandlerOwnerRefusal, executeRegisteredAction, resolveRouteActionDeclaration, type ActionExecutionDeps } from './action-execution.js';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const P = 'com.acme.caller';
const OBJECT = 'account';

const manifest = (id: string, deps: string[] = []) => ({
    id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()!,
    ...(deps.length > 0 ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
}) as never;

let engine: ObjectQL;
let deps: ActionExecutionDeps;

const install = (id: string, deps: string[] = []) => engine.registry.installPackage(manifest(id, deps), 'code');
const ship = (packageId: string, objectName = OBJECT) =>
    engine.registry.registerItem('action', {
        name: 'approve', label: packageId.split('.').pop(), type: 'script', objectName, target: 'approve',
        body: { language: 'js', source: 'return 1;', capabilities: [] },
    } as never, 'name' as never, packageId);
const bind = (packageId: string) => engine.registerAction(OBJECT, 'approve', () => `ran ${packageId}`, `app:${packageId}`);

const resolve = (callerPackageId?: string) => resolveRouteActionDeclaration(deps, { request: {} } as any, {
    ql: engine, objectName: OBJECT, actionName: 'approve',
    ...(callerPackageId !== undefined ? { callerPackageId } : {}),
});

beforeEach(() => {
    engine = new ObjectQL();
    engine.registry.logLevel = 'silent';
    const rowStore: any = {
        registry: engine.registry,
        find: async () => [],
        findOne: async (object: string, query: any) => { assertEngineFindOnePredicate(object, query); return null; },
        count: async () => 0, aggregate: async () => [],
    };
    const protocol = new ObjectStackProtocolImplementation(rowStore);
    deps = {
        resolveService: (async (_ctx: unknown, name: string) => (name === 'protocol' ? protocol : undefined)) as any,
        getObjectQL: async () => engine,
    } as ActionExecutionDeps;
});

describe('ADR-0150 D3/D4 — a caller that names its package', () => {
    it('resolves its own package\'s declaration on the object and runs its own handler, while two packages hold both', async () => {
        install(A);
        install(P, [A]);
        ship(A);
        ship(P);
        bind(A);
        bind(P);
        const declaration = await resolve(P);
        expect(declaration).toMatchObject({ action: { name: 'approve', label: 'caller' }, packageId: P });
        expect(declaration.refusal).toBeUndefined();
        const dispatch = await executeRegisteredAction(deps, engine, OBJECT, ['approve'], {}, declaration.packageId);
        expect(dispatch).toEqual({ dispatched: true, result: `ran ${P}` });
    });

    it('resolves the unique holder in its declared closure, and runs that package\'s handler', async () => {
        install(A);
        install(B);
        install(P, [A]);
        ship(A);
        ship(B);
        bind(A);
        bind(B);
        const declaration = await resolve(P);
        expect(declaration).toMatchObject({ action: { label: 'alpha' }, packageId: A });
        expect((await executeRegisteredAction(deps, engine, OBJECT, ['approve'], {}, declaration.packageId)).result).toBe(`ran ${A}`);
    });

    it('refuses when its closure holds the name on the object twice, naming both holders — never a pick', async () => {
        install(A);
        install(B);
        install(P, [A, B]);
        ship(A);
        ship(B);
        const declaration = await resolve(P);
        expect(declaration.action).toBeUndefined();
        expect(declaration.refusal).toMatchObject({
            reason: 'ambiguous-in-closure',
            candidates: [{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }],
        });
    });

    it('refuses when the only holder is a package outside its closure, naming it', async () => {
        install(A);
        install(P);
        ship(A);
        expect((await resolve(P)).refusal).toMatchObject({ reason: 'outside-closure', candidates: [{ kind: 'package', packageId: A }] });
    });

    it('D3 (a) — refuses when the only holder is an environment-authored action, naming the environment', async () => {
        install(P);
        engine.registry.registerItem('action', {
            name: 'approve', type: 'script', objectName: OBJECT, target: 'approve', _provenance: 'org',
            body: { language: 'js', source: 'return 1;', capabilities: [] },
        } as never, 'name' as never);
        expect((await resolve(P)).refusal).toMatchObject({ reason: 'outside-closure', candidates: [{ kind: 'environment' }] });
        // D3 (a) control: the same item, asked with no package, resolves.
        const unqualified = await resolve();
        expect(unqualified.refusal).toBeUndefined();
        expect(unqualified.action).toMatchObject({ name: 'approve' });
    });
});

describe('ADR-0150 D5 — the handler half of a package caller\'s dispatch', () => {
    it('two plugin handlers and none of the package\'s own: the refusal surfaces as 409 RESOURCE_CONFLICT, never as "no handler"', async () => {
        install(A);
        ship(A);
        engine.registerAction(OBJECT, 'approve', () => 'one', 'com.acme.plugin-one');
        engine.registerAction(OBJECT, 'approve', () => 'two', 'com.acme.plugin-two');
        const declaration = await resolve(A);
        expect(declaration.packageId).toBe(A);
        const refusal = await executeRegisteredAction(deps, engine, OBJECT, ['approve'], {}, declaration.packageId)
            .then(() => undefined, (err: any) => err);
        expect(refusal).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
        for (const owner of ['com.acme.plugin-one', 'com.acme.plugin-two']) expect(refusal.message).toContain(owner);
    });

    it('never dispatches the environment\'s handler for a package holder\'s declaration', async () => {
        install(A);
        ship(A);
        engine.registerAction(OBJECT, 'approve', () => 'environment', 'metadata-service');
        const declaration = await resolve(A);
        expect(await executeRegisteredAction(deps, engine, OBJECT, ['approve'], {}, declaration.packageId)).toEqual({ dispatched: false });
    });
});

describe('ADR-0150 D4 — the owner gate judges the handler the package call runs (review 6729902179 F2)', () => {
    /** B's `approve_all` dispatches to B's own `approve` handler and asks a capability the caller lacks. */
    const setUp = () => {
        install(A);
        install(B);
        install(P, [A]);
        ship(P);
        engine.registry.registerItem('action', {
            name: 'approve_all', label: 'Approve all', type: 'script', objectName: OBJECT, target: 'approve', requiredPermissions: ['approve_everything'],
            body: { language: 'js', source: 'return 1;', capabilities: [] },
        } as never, 'name' as never, B);
        bind(P);
        bind(B);
    };
    const gate = async (packageId?: string) => {
        const declaration = await resolve(packageId === undefined ? undefined : P);
        return actionHandlerOwnerRefusal(deps, { request: {} } as any, {
            ql: engine, action: declaration.action, objectName: OBJECT, candidates: ['approve'],
            ec: { isSystem: false, permissions: [], positions: [] },
            ...(packageId !== undefined ? { packageId } : {}),
        });
    };

    it('a package call that runs its own handler is not gated by another package\'s declaration reaching the same key', async () => {
        setUp();
        expect(await gate(P)).toBeUndefined();
    });

    it('control: the unqualified call, which runs the last registration (B\'s), is still gated by B\'s declaration', async () => {
        setUp();
        expect(await gate()).toMatchObject({ status: 403 });
    });
});

describe('[#31697 interim] a caller that names no package', () => {
    it('resolves and dispatches exactly as before: no refusal, no package, the last registered handler runs', async () => {
        install(A);
        install(B);
        ship(A);
        ship(B);
        bind(A);
        bind(B);
        const declaration = await resolve();
        expect(declaration.refusal).toBeUndefined();
        expect(declaration.packageId).toBeUndefined();
        expect(declaration.action).toMatchObject({ name: 'approve' });
        expect((await executeRegisteredAction(deps, engine, OBJECT, ['approve'], {})).result).toBe(`ran ${B}`);
    });
});

/**
 * [#32183] A disabled package holds no name, and the rung's read answers a
 * package-scoped refusal as the declared 409.
 *
 * BASE (main de141e32): a caller whose closure holds the name twice, one
 * package disabled, was refused naming both; a refusal the protocol's
 * execution read threw was swallowed as `degraded`. No door on main makes
 * that read throw one for an `action` (the type is outside the protocol's
 * package-scoped reads), so the second half is pinned by function.
 */
describe('#32183 — the route rung judges the served holders and answers a thrown refusal as 409', () => {
    it('a closure holding the name twice, one package disabled: the enabled holder\'s declaration, and its handler', async () => {
        install(A);
        install(B);
        install(P, [A, B]);
        ship(A);
        ship(B);
        bind(A);
        bind(B);
        expect((await resolve(P)).refusal).toMatchObject({ reason: 'ambiguous-in-closure' });
        engine.registry.disablePackage(B);
        const declaration = await resolve(P);
        expect(declaration.refusal).toBeUndefined();
        expect(declaration).toMatchObject({ action: { label: 'alpha' }, packageId: A });
        expect((await executeRegisteredAction(deps, engine, OBJECT, ['approve'], {}, declaration.packageId)).result).toBe(`ran ${A}`);
    });

    it('a caller outside both closures is refused naming the enabled holder only', async () => {
        install(A);
        install(B);
        install(P);
        ship(A);
        ship(B);
        engine.registry.disablePackage(B);
        const declaration = await resolve(P);
        expect(declaration.refusal).toMatchObject({ reason: 'outside-closure', candidates: [{ kind: 'package', packageId: A }] });
    });

    const readThrowing = (thrown: unknown) => {
        deps = {
            ...deps,
            resolveService: (async (_ctx: unknown, name: string) => (name === 'protocol'
                ? { getMetaItemForExecution: async () => { throw thrown; } }
                : undefined)) as any,
        } as ActionExecutionDeps;
    };

    it('a package-scoped refusal the execution read throws is the declaration\'s refusal (409), never `degraded`', async () => {
        install(A);
        install(P, [A]);
        ship(A);
        const refusal = {
            status: 'refused' as const, reason: 'ambiguous-in-environment' as const, type: 'action' as const, name: 'approve',
            callerPackageId: null, candidates: [{ kind: 'package' as const, packageId: A }, { kind: 'package' as const, packageId: B }],
            message: 'The action "approve" is held by 2 packages',
        };
        readThrowing(new PackageScopedNameRefusedError(refusal));
        const declaration = await resolve(P);
        expect(declaration.degraded).toBeUndefined();
        expect(declaration.action).toBeUndefined();
        expect(declaration.refusal).toEqual(refusal);
    });

    it('CONTROL — any other throw of the read stays `degraded`', async () => {
        install(A);
        install(P, [A]);
        ship(A);
        readThrowing(new Error('loader offline'));
        const declaration = await resolve(P);
        expect(declaration).toMatchObject({ degraded: true, reason: 'loader offline' });
        expect(declaration.refusal).toBeUndefined();
    });
});
