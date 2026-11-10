// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The router's half of the action's `(package, objectName, name)` key
 * (ADR-0150 D3/D4) — #31673, child E2 of epic #31527.
 *
 * `resolveRouteActionDeclaration` given a caller's package resolves the bare
 * name through R's resolver (`resolveActionByPackage` in
 * `@objectstack/objectql`) and answers the holder's package coordinate;
 * `executeRegisteredAction` given that coordinate runs that package's handler.
 * A caller that names no package, while two packages hold the name on the
 * object, is refused naming both, at the declaration and at the dispatch
 * (#31697, ruling 6729825528 letter A on epic #31527); one holder answers as
 * before.
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
let protocol: ObjectStackProtocolImplementation;

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
    protocol = new ObjectStackProtocolImplementation(rowStore);
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

describe('[#31697] a caller that names no package', () => {
    it('is refused naming both packages when two hold the name on the object — at the declaration (D5) and at the dispatch (409), never the last registered', async () => {
        install(A);
        install(B);
        ship(A);
        ship(B);
        bind(A);
        bind(B);
        const declaration = await resolve();
        expect(declaration.action).toBeUndefined();
        expect(declaration.refusal).toMatchObject({
            reason: 'ambiguous-in-environment',
            candidates: [{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }],
        });
        await expect(executeRegisteredAction(deps, engine, OBJECT, ['approve'], {})).rejects.toMatchObject({
            code: 'RESOURCE_CONFLICT', status: 409, owners: [`app:${A}`, `app:${B}`],
        });
        // Each package's address still reaches its own.
        expect((await executeRegisteredAction(deps, engine, OBJECT, ['approve'], {}, A)).result).toBe(`ran ${A}`);
        expect((await executeRegisteredAction(deps, engine, OBJECT, ['approve'], {}, B)).result).toBe(`ran ${B}`);
    });

    it('CONTROL — one package holding the name answers as before: no refusal, no package, its handler runs', async () => {
        install(A);
        ship(A);
        bind(A);
        const declaration = await resolve();
        expect(declaration.refusal).toBeUndefined();
        expect(declaration.packageId).toBeUndefined();
        expect(declaration.action).toMatchObject({ name: 'approve', label: 'alpha' });
        expect((await executeRegisteredAction(deps, engine, OBJECT, ['approve'], {})).result).toBe(`ran ${A}`);
    });
});

/**
 * [#31697, step-0 ruling Q1 = A] `/meta/action/NAME` (the protocol's by-name
 * read, the Console's ActionNavItem read) with no package: an OBJECT-LESS
 * action two packages hold — two namespaces may, now that its one-holder rule
 * narrowed to the namespace — is refused naming both, `409
 * RESOURCE_CONFLICT`; it served the first registered. A read naming a package
 * reaches that package's. Object-bound same-name reads are not this card's.
 */
describe('[#31697] the by-name read of an object-less action two packages hold', () => {
    const shipObjectLess = (packageId: string | undefined, name = 'digest') =>
        engine.registry.registerItem('action', {
            name, label: packageId?.split('.').pop() ?? 'env', type: 'script',
            body: { language: 'js', source: 'return 1;', capabilities: [] },
        } as never, 'name' as never, packageId);
    const read = (packageId?: string) =>
        protocol.getMetaItem({ type: 'action', name: 'digest', ...(packageId ? { packageId } : {}) } as any) as Promise<any>;

    it('is refused when the read names no package, naming both; a read naming each package reaches its own', async () => {
        install(A);
        install(B);
        shipObjectLess(A);
        shipObjectLess(B);
        const refused = await read().then(() => undefined, (e: any) => e);
        expect(refused, 'the read was refused').toBeDefined();
        expect(refused).toMatchObject({ code: 'RESOURCE_CONFLICT' });
        expect(refused.status ?? refused.httpStatus).toBe(409);
        expect(String(refused.message)).toContain(A);
        expect(String(refused.message)).toContain(B);
        expect((await read(A)).item).toMatchObject({ name: 'digest', label: 'alpha' });
        expect((await read(B)).item).toMatchObject({ name: 'digest', label: 'beta' });
    });

    it('CONTROL — one package\'s object-less action answers the bare read', async () => {
        install(A);
        shipObjectLess(A);
        expect((await read()).item).toMatchObject({ name: 'digest', label: 'alpha' });
    });

    it('CONTROL — the environment\'s own item answers first beside a package\'s (ADR-0150 D3)', async () => {
        install(A);
        shipObjectLess(A);
        shipObjectLess(undefined);
        expect((await read()).item).toMatchObject({ name: 'digest', label: 'env' });
    });

    it('CONTROL — two packages\' actions of one name bound to two objects are not refused (object-bound reads are not this card\'s)', async () => {
        install(A);
        install(B);
        ship(A, 'account');
        ship(B, 'contact');
        const answer: any = await protocol.getMetaItem({ type: 'action', name: 'approve' } as any);
        expect(answer.item).toMatchObject({ name: 'approve' });
    });
});
