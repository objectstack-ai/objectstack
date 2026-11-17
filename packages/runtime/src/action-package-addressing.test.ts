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
// Paid at collection, not inside a case's clock (check:test-source-alias): the
// dispatcher chain this file reaches loads it dynamically.
import '@objectstack/metadata';
import { ObjectQL, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { PackageScopedNameRefusedError, resolvePackageScopedHolders } from '@objectstack/core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
    actionHandlerOwnerRefusal, actionPermissionRefusal, executeRegisteredAction, resolveActionHandlerKeys,
    invokeBusinessAction, readMergedItems, resolveAddressedRouteActionDeclaration, resolveRouteActionDeclaration,
    type ActionExecutionDeps,
} from './action-execution.js';
import { requestContextWiring, runResolvedAction } from './action-dispatch.js';
import { HttpDispatcher } from './http-dispatcher.js';

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
/** The environment store's active `sys_metadata` rows the row store answers (empty unless a case seeds it). */
let storedRows: any[] = [];

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
    storedRows = [];
    const rowStore: any = {
        registry: engine.registry,
        find: async (object: string, query: any) => {
            if (object !== 'sys_metadata') return [];
            const where: Record<string, any> = query?.where ?? {};
            const rows = storedRows.filter((row) => Object.keys(where).every((field) => {
                if (field.startsWith('$')) throw new Error(`row store double: combinator ${field} is not implemented`);
                const want = where[field];
                return Array.isArray(want?.$in) ? want.$in.includes(row[field]) : row[field] === want;
            }));
            return typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
        },
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

describe('removeActionsByPackage hands an emptied key back — the door reaches that entry and its owner gates (Clause-② narrowing)', () => {
    it('reaches host code\'s handed-back entry, where the rotation fell through to `global`, and that entry\'s owner refuses 403', async () => {
        install(A);
        install(B);
        ship(A);
        // B's `approve_all` asks a capability the caller lacks; its rotation is OBJECT:approve_all,
        // OBJECT:approve (its target), then global:approve_all, the one key held under its own name.
        engine.registry.registerItem('action', {
            name: 'approve_all', label: 'Approve all', type: 'script', objectName: OBJECT, target: 'approve', requiredPermissions: ['approve_everything'],
            body: { language: 'js', source: 'return 1;', capabilities: [] },
        } as never, 'name' as never, B);
        engine.registerAction(OBJECT, 'approve', () => 'host');
        bind(A);
        engine.registerAction('global', 'approve_all', () => 'all', `app:${B}`);
        engine.registerAction('global', 'approve', () => 'global');
        engine.removeActionsByPackage(`app:${A}`);
        // Before the hand-back OBJECT:approve was empty: this ran global:approve, and approve_all
        // reached global:approve_all, so it owned nothing the call ran.
        expect((await executeRegisteredAction(deps, engine, OBJECT, ['approve'], {})).result).toBe('host');
        const declaration = await resolve();
        expect(await actionHandlerOwnerRefusal(deps, { request: {} } as any, {
            ql: engine, action: declaration.action, objectName: OBJECT, candidates: ['approve'],
            ec: { isSystem: false, permissions: [], positions: [] },
        })).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
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

    it('CONTROL — the environment\'s own item, a row its store holds bound to no package, answers first beside a package\'s (ADR-0150 D3)', async () => {
        install(A);
        shipObjectLess(A);
        shipObjectLess(undefined);
        storedRows = [{
            id: 'env-digest', type: 'action', name: 'digest', state: 'active', package_id: null,
            metadata: JSON.stringify({ name: 'digest', label: 'env', type: 'script', body: { language: 'js', source: 'return 1;', capabilities: [] } }),
        }];
        expect((await read()).item).toMatchObject({ name: 'digest', label: 'env' });
    });

    it('[#31697 review F3] a package-less item the store does not hold is the platform\'s (host code or a plugin): beside a package it is refused naming both, as on the action doors', async () => {
        install(A);
        shipObjectLess(A);
        shipObjectLess(undefined);
        const refused = await read().then(() => undefined, (e: any) => e);
        expect(refused, 'the read was refused').toBeDefined();
        expect(refused).toMatchObject({ code: 'RESOURCE_CONFLICT' });
        expect(refused.refusal?.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'platform' }]);
        // A store row bound to an OBJECT is not the environment's object-less item (F5's key).
        storedRows = [{ id: 'env-bound', type: 'action', name: 'digest', state: 'active', package_id: null, metadata: { name: 'digest', objectName: OBJECT } }];
        expect(await read().then(() => undefined, (e: any) => e?.code)).toBe('RESOURCE_CONFLICT');
    });

    it('[#31697 review F4] a disabled package holds nothing: the enabled holder answers the bare read, and the bare REST door serves it, never "degraded"', async () => {
        install(A);
        install(B);
        shipObjectLess(A);
        shipObjectLess(B);
        engine.registry.disablePackage(B);
        expect((await read()).item).toMatchObject({ name: 'digest', label: 'alpha' });
        const declaration = await resolveRouteActionDeclaration(deps, { request: {} } as any, { ql: engine, objectName: 'global', actionName: 'digest' });
        expect(declaration.degraded).toBeFalsy();
        expect(declaration.refusal).toBeUndefined();
        expect(declaration.action).toMatchObject({ name: 'digest', label: 'alpha' });
    });

    it('[#31697 contract review G3] the bare REST door judges two holders whenever the merged listing answers, even where the protocol\'s engine reports no `sys_metadata` schema', async () => {
        install(A);
        install(B);
        ship(A);
        ship(B);
        (protocol as any).engine.getSchema = () => undefined;
        const declaration = await resolve();
        expect(declaration.degraded).toBeFalsy();
        expect(declaration.refusal?.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
    });

    it('[#31697 contract review G4] a disabled package\'s handler is no owner at the engine either: the bare call resolves and DISPATCHES the enabled holder\'s handler, though the disabled package bound last', async () => {
        install(A);
        install(B);
        ship(A);
        ship(B);
        bind(A);
        bind(B);
        engine.registry.disablePackage(B);
        const declaration = await resolve();
        expect(declaration.refusal).toBeUndefined();
        expect(declaration.action).toMatchObject({ name: 'approve', label: 'alpha' });
        expect(await executeRegisteredAction(deps, engine, OBJECT, ['approve'], {}, undefined)).toEqual({ dispatched: true, result: `ran ${A}` });
        engine.registry.enablePackage(B);
        await expect(executeRegisteredAction(deps, engine, OBJECT, ['approve'], {}, undefined), 'CONTROL: both enabled, refused naming both')
            .rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
    });
});

describe('[#31697 review F4] the bare REST door reads the by-name read\'s refusal as a refusal', () => {
    it('a refusal the protocol\'s by-name read throws answers the refusal naming its holders — never `degraded`', async () => {
        const refused = resolvePackageScopedHolders(
            { type: 'action', name: 'digest', callerPackageId: null },
            { packageHolders: [A, B], packageItem: (id) => ({ name: 'digest', _packageId: id }), environmentItem: () => undefined },
            () => new Set<string>(),
        );
        if (refused.status !== 'refused') throw new Error('expected a refusal');
        const stub: any = {
            getMetaItems: async () => ({ items: [] }),
            getMetaItemForExecution: async () => { throw new PackageScopedNameRefusedError(refused); },
        };
        const stubDeps = { ...deps, resolveService: (async (_ctx: unknown, name: string) => (name === 'protocol' ? stub : undefined)) as any };
        const declaration = await resolveRouteActionDeclaration(stubDeps, { request: {} } as any, { ql: engine, objectName: 'global', actionName: 'digest' });
        expect(declaration.degraded).toBeFalsy();
        expect(declaration.refusal?.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
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

/**
 * [#32244, ADR-0150 D3] The by-name read naming no package of an action name
 * two packages hold on ANY object key — two objects, or one — is refused
 * naming each package with its object (`409 RESOURCE_CONFLICT`); it served the
 * first registered, one package's action picked over another's. The route
 * (`/actions/:object/:name`) can see the object, so each object's call still
 * reaches its own holder's declaration; the in-process store refuses the same
 * bare read, and the protocol never reads that refusal as a miss.
 *
 * BASE (main 9bff554e): the bare read answered 200 with A's action (the first
 * registered), and the store refusal of the same-object pair was swallowed.
 */
describe('[#32244] the bare read of an action name two packages hold on any object key', () => {
    const read = (packageId?: string) =>
        protocol.getMetaItem({ type: 'action', name: 'approve', ...(packageId ? { packageId } : {}) } as any) as Promise<any>;
    const refusalOfRead = (packageId?: string) => read(packageId).then(() => undefined, (e: any) => e);
    const routeTo = (objectName: string) =>
        resolveRouteActionDeclaration(deps, { request: {} } as any, { ql: engine, objectName, actionName: 'approve' });

    it('two packages, two objects: refused, naming both with their objects — never the first registered', async () => {
        install(A);
        install(B);
        ship(A, 'account');
        ship(B, 'contact');
        const refused = await refusalOfRead();
        expect(refused, 'the read was refused').toBeInstanceOf(PackageScopedNameRefusedError);
        expect([refused.code, refused.status, refused.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
        expect(refused.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
        expect(refused.message).toContain(`package "${A}" binds it to object "account"`);
        expect(refused.message).toContain(`package "${B}" binds it to object "contact"`);
        // `?package=` is unchanged: each package's address reaches its own.
        expect((await read(A)).item).toMatchObject({ name: 'approve', label: 'alpha', objectName: 'account' });
        expect((await read(B)).item).toMatchObject({ name: 'approve', label: 'beta', objectName: 'contact' });
    });

    it('two packages, ONE object: refused naming both, too', async () => {
        install(A);
        install(B);
        ship(A, 'account');
        ship(B, 'account');
        const refused = await refusalOfRead();
        expect(refused).toBeInstanceOf(PackageScopedNameRefusedError);
        expect(refused.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
    });

    it('the route sees the object: `/actions/account/approve` gets A\'s declaration and `/actions/contact/approve` B\'s, never the 409', async () => {
        install(A);
        install(B);
        ship(A, 'account');
        ship(B, 'contact');
        const onAccount = await routeTo('account');
        expect([onAccount.refusal, onAccount.degraded]).toEqual([undefined, undefined]);
        expect(onAccount.action).toMatchObject({ name: 'approve', label: 'alpha', objectName: 'account' });
        const onContact = await routeTo('contact');
        expect([onContact.refusal, onContact.degraded]).toEqual([undefined, undefined]);
        expect(onContact.action).toMatchObject({ name: 'approve', label: 'beta', objectName: 'contact' });
        // An object neither package binds the name to has no declaration, as before.
        expect(await routeTo('lead')).toMatchObject({ action: undefined });
    });

    it('CONTROL — one package holding the name answers the bare read as before', async () => {
        install(A);
        ship(A, 'account');
        expect((await read()).item).toMatchObject({ name: 'approve', label: 'alpha', objectName: 'account' });
    });

    it('CONTROL — one package binding the name to two objects is one holder: the bare read answers as before', async () => {
        install(A);
        ship(A, 'account');
        ship(A, 'contact');
        expect((await read()).item).toMatchObject({ name: 'approve', label: 'alpha' });
    });

    it('CONTROL — a disabled package holds nothing: the enabled holder answers the bare read', async () => {
        install(A);
        install(B);
        ship(A, 'account');
        ship(B, 'contact');
        engine.registry.disablePackage(B);
        expect((await read()).item).toMatchObject({ name: 'approve', label: 'alpha', objectName: 'account' });
    });

    describe('the metadata service\'s refusal is an answer, never a miss', () => {
        /** The protocol over a real `MetadataManager` in the `metadata` slot. */
        const withService = async () => {
            const { MetadataManager } = await import('@objectstack/metadata');
            const manager = new MetadataManager({ formats: ['json'], loaders: [] });
            const services = new Map<string, unknown>([['metadata', manager]]);
            protocol = new ObjectStackProtocolImplementation((protocol as any).engine, () => services as Map<string, any>);
            return manager;
        };
        const item = (packageId: string, objectName: string) => ({
            name: 'approve', label: packageId.split('.').pop(), type: 'script', objectName, target: 'approve', _packageId: packageId,
        });

        it('the service holds two packages\' items the registry does not count (one registered there): refused naming both — never the registry\'s item', async () => {
            const manager = await withService();
            install(A);
            install(B);
            ship(A, 'account');
            manager.registerInMemory('action', 'approve', item(A, 'account'));
            manager.registerInMemory('action', 'approve', item(B, 'contact'));
            const refused = await refusalOfRead();
            expect(refused, 'the store\'s refusal reaches the caller').toBeInstanceOf(PackageScopedNameRefusedError);
            expect(refused.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
            expect(refused.message).toContain(`package "${B}" binds it to object "contact"`);
            const layered = await (protocol as any).getMetaItemLayered({ type: 'action', name: 'approve' }).then(() => undefined, (e: any) => e);
            expect(layered, 'the layered read\'s code layer rethrows it too').toBeInstanceOf(PackageScopedNameRefusedError);
        });

        it('[review 6781770671 S1] the same state: `/actions/account/approve` answers A\'s declaration, never the refusal of B\'s address that names A', async () => {
            const manager = await withService();
            install(A);
            install(B);
            ship(A, 'account');
            manager.registerInMemory('action', 'approve', item(A, 'account'));
            manager.registerInMemory('action', 'approve', item(B, 'contact'));
            // B's own address refuses (the registry holds only A's `approve`).
            expect(await refusalOfRead(B).then((e: any) => e?.refusal?.reason)).toBe('not-held-by-qualifier');
            const onAccount = await routeTo('account');
            expect([onAccount.refusal, onAccount.degraded]).toEqual([undefined, undefined]);
            expect(onAccount.action).toMatchObject({ name: 'approve', label: 'alpha', objectName: 'account' });
        });

        it('CONTROL — the service\'s refusal naming a disabled package is no refusal: the enabled holder answers', async () => {
            const manager = await withService();
            install(A);
            install(B);
            ship(A, 'account');
            manager.registerInMemory('action', 'approve', item(A, 'account'));
            manager.registerInMemory('action', 'approve', item(B, 'contact'));
            engine.registry.disablePackage(B);
            expect((await read()).item).toMatchObject({ name: 'approve', label: 'alpha', objectName: 'account' });
        });
    });

    it('[review 6781770671 S5] two object-less holders and a third package bound to an object: the 409 names all three, and the third\'s own route resolves to it', async () => {
        const C = 'com.acme.gamma';
        install(A);
        install(B);
        install(C);
        for (const packageId of [A, B]) {
            engine.registry.registerItem('action', {
                name: 'approve', label: packageId.split('.').pop(), type: 'script', target: 'approve',
                body: { language: 'js', source: 'return 1;', capabilities: [] },
            } as never, 'name' as never, packageId);
        }
        ship(C, 'account');
        const refused = await refusalOfRead();
        expect(refused).toBeInstanceOf(PackageScopedNameRefusedError);
        expect(refused.refusal.candidates).toEqual([
            { kind: 'package', packageId: A }, { kind: 'package', packageId: B }, { kind: 'package', packageId: C },
        ]);
        expect(refused.message).toContain(`package "${C}" binds it to object "account"`);
        const onAccount = await routeTo('account');
        expect([onAccount.refusal, onAccount.degraded]).toEqual([undefined, undefined]);
        expect(onAccount.action).toMatchObject({ name: 'approve', label: 'gamma', objectName: 'account' });
        // Another object reaches only the two object-less holders: refused naming those two.
        expect((await routeTo('contact')).refusal?.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
    });

    describe('[review 6781770671 N6] each branch of the route\'s recovery from a refused bare read', () => {
        const refusal = (candidates: any[], reason = 'ambiguous-in-environment') => new PackageScopedNameRefusedError({
            status: 'refused', reason, type: 'action', name: 'approve', callerPackageId: null, candidates,
            message: 'refused',
        } as any);
        /** What a candidate's exact address answers when it holds no item of the name. */
        const notHeld = () => refusal([{ kind: 'package', packageId: A }], 'not-held-by-qualifier');
        const declared = (packageId: string, objectName?: string) => ({
            item: { name: 'approve', label: packageId.split('.').pop(), type: 'script', ...(objectName ? { objectName } : {}), _packageId: packageId },
        });
        /** A protocol whose bare read throws `bare`, and whose read at each package answers `at[packageId]` (a thrown value throws). */
        const routeWith = (bare: unknown, at: Record<string, unknown>, objectName = 'account') => {
            const stub: any = {
                getMetaItems: async () => ({ items: [] }),
                getMetaItemForExecution: async (request: { packageId?: string }) => {
                    if (!request.packageId) throw bare;
                    const answer = at[request.packageId];
                    if (answer instanceof Error) throw answer;
                    return answer ?? { item: null };
                },
            };
            const stubDeps = { ...deps, resolveService: (async (_ctx: unknown, name: string) => (name === 'protocol' ? stub : undefined)) as any };
            return resolveRouteActionDeclaration(stubDeps, { request: {} } as any, { ql: engine, objectName, actionName: 'approve' });
        };
        const AB = [{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }];

        it('no candidate bound to the route: the one object-less candidate answers', async () => {
            const answer = await routeWith(refusal(AB), { [A]: declared(A, 'contact'), [B]: declared(B) });
            expect([answer.refusal, answer.degraded]).toEqual([undefined, undefined]);
            expect(answer.action).toMatchObject({ label: 'beta' });
        });

        it('the bound candidate wins over an object-less one', async () => {
            const answer = await routeWith(refusal(AB), { [A]: declared(A, 'account'), [B]: declared(B) });
            expect(answer.action).toMatchObject({ label: 'alpha' });
        });

        it('two candidates on one rung: the refusal stands', async () => {
            const bare = refusal(AB);
            const answer = await routeWith(bare, { [A]: declared(A), [B]: declared(B) });
            expect(answer.action).toBeUndefined();
            expect(answer.refusal).toBe(bare.refusal);
        });

        it('a candidate that is not a package: the refusal stands, and no package is read', async () => {
            const bare = refusal([{ kind: 'package', packageId: A }, { kind: 'platform' }]);
            const answer = await routeWith(bare, { [A]: new Error('must not be read') });
            expect([answer.action, answer.degraded]).toEqual([undefined, undefined]);
            expect(answer.refusal).toBe(bare.refusal);
        });

        it('a candidate its own address says it does not hold owns nothing: the other candidate answers', async () => {
            const answer = await routeWith(refusal(AB), { [A]: declared(A, 'account'), [B]: notHeld() });
            expect([answer.refusal, answer.degraded]).toEqual([undefined, undefined]);
            expect(answer.action).toMatchObject({ label: 'alpha' });
        });

        it('a candidate its own address says it does not hold, and no other owner: the bare read\'s refusal stands', async () => {
            const bare = refusal(AB);
            const answer = await routeWith(bare, { [A]: declared(A, 'contact'), [B]: notHeld() });
            expect(answer.action).toBeUndefined();
            expect(answer.refusal).toBe(bare.refusal);
        });

        it('[epic red-line read 6784464520 R1] a candidate read refused for any reason other than not held: the bare read\'s refusal stands, though another candidate owns the route', async () => {
            for (const reason of ['ambiguous-in-closure', 'ambiguous-in-environment', 'outside-closure']) {
                const bare = refusal(AB);
                const answer = await routeWith(bare, { [A]: declared(A, 'account'), [B]: refusal(AB, reason) });
                expect(answer.action, reason).toBeUndefined();
                expect(answer.refusal, reason).toBe(bare.refusal);
            }
        });

        it('a candidate read that throws anything else is an outage, never a declaration', async () => {
            const answer = await routeWith(refusal(AB), { [A]: declared(A, 'account'), [B]: new Error('store down') });
            expect(answer).toMatchObject({ action: undefined, degraded: true, reason: 'store down' });
        });

        it('no candidate owns the route: no declaration, no refusal', async () => {
            const answer = await routeWith(refusal(AB), { [A]: declared(A, 'contact'), [B]: declared(B, 'lead') });
            expect([answer.action, answer.refusal, answer.degraded]).toEqual([undefined, undefined, undefined]);
        });
    });
});

/**
 * [#32365, ADR-0150 D3/D5] The bare by-name read of an action
 * (`GET /meta/action/NAME`, its `/layers`) judged over EVERY holder, the
 * package-less item included:
 *
 *  1. the environment's own item (a package-less entry its store holds a
 *     package-less row of) answers first beside ONE package, whatever object
 *     each binds the name to — on the plain read and its layers alike; the
 *     platform's item (no row behind it) beside a package is refused naming
 *     both, as #31697 refuses an object-less one;
 *  2. beside TWO packages, the refusal names the environment too;
 *  3. one enabled holder answers, though a disabled package registered first.
 *
 * The route (`/actions/:object/NAME`) sees the object, so it takes the
 * declaration of the holder that owns it, read at that holder's exact
 * address. [#32568] A sealed type's package-less copy is declined there
 * (epic ruling 6817768147), so beside two packages the environment's item is
 * no holder's declaration (case 2); [#32751] a route no holder binds reads
 * the environment's own item itself, never at a holder's address.
 *
 * BASE (main 89d815c5; #32497's head 1483899c measured the same): (1) the
 * layered read answered the package's item, the in-process store the one
 * written last, the platform's item was served; (2) the 409 named the two
 * packages only; (3) the plain read answered no item, the layered read the
 * DISABLED package's body.
 */
describe('[#32365] the bare action read weighs the package-less holder and serves the one enabled holder', () => {
    const shipPackageless = (label: string, objectName?: string) =>
        engine.registry.registerItem('action', {
            name: 'approve', label, type: 'script', ...(objectName ? { objectName } : {}), target: 'approve',
            body: { language: 'js', source: 'return 1;', capabilities: [] },
        } as never, 'name' as never, undefined);
    const storeEnvironmentRow = (objectName?: string) => {
        storedRows = [{
            id: 'env-approve', type: 'action', name: 'approve', state: 'active', package_id: null,
            metadata: JSON.stringify({ name: 'approve', label: 'env', type: 'script', ...(objectName ? { objectName } : {}) }),
        }];
    };
    const read = () => protocol.getMetaItem({ type: 'action', name: 'approve' } as any) as Promise<any>;
    const layered = () => (protocol as any).getMetaItemLayered({ type: 'action', name: 'approve' }) as Promise<any>;
    const refused = (run: () => Promise<unknown>) => run().then(() => undefined, (e: any) => e);
    const routeTo = (objectName: string) =>
        resolveRouteActionDeclaration(deps, { request: {} } as any, { ql: engine, objectName, actionName: 'approve' });

    describe('case 1 — a package-less item beside one package\'s', () => {
        it('the environment\'s own item on `contact` beside A\'s on `account` answers the plain read and its layers, in either registration order', async () => {
            for (const envFirst of [false, true]) {
                engine = new ObjectQL();
                engine.registry.logLevel = 'silent';
                (protocol as any).engine.registry = engine.registry;
                install(A);
                if (envFirst) shipPackageless('env', 'contact');
                ship(A, 'account');
                if (!envFirst) shipPackageless('env', 'contact');
                storeEnvironmentRow('contact');
                expect((await read()).item, `env registered ${envFirst ? 'first' : 'last'}`).toMatchObject({ label: 'env', objectName: 'contact' });
                expect((await layered()).effective, 'the layers answer what the read answers').toMatchObject({ label: 'env' });
            }
        });

        it('the environment\'s own object-less item beside A\'s on `account` answers too', async () => {
            install(A);
            ship(A, 'account');
            shipPackageless('env');
            storeEnvironmentRow();
            expect((await read()).item).toMatchObject({ label: 'env' });
            expect((await layered()).effective).toMatchObject({ label: 'env' });
        });

        it('the platform\'s item (no row behind it) on `contact` beside A\'s on `account`: refused naming A and the platform, on both reads; each route keeps its own declaration', async () => {
            install(A);
            ship(A, 'account');
            shipPackageless('platform', 'contact');
            for (const run of [read, layered]) {
                const err = await refused(run);
                expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
                expect([err.code, err.status]).toEqual(['RESOURCE_CONFLICT', 409]);
                expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'platform' }]);
                expect(err.message).toContain(`"${A}" binds it to object "account"`);
                expect(err.message).toContain('The platform\'s item binds it to object "contact"');
            }
            // Seat ruling B: the execution face (the route's declaration read)
            // keeps main's answer beside a package-less item; its owner seat
            // follows it up separately. Pinned so the two faces' disagreement
            // is a known state, not a drift.
            const onContact = await routeTo('contact');
            expect([onContact.refusal, onContact.action?.label]).toEqual([undefined, 'platform']);
        });
    });

    describe('case 2 — a package-less item beside two packages\'', () => {
        it('the environment\'s item on `lead` beside A\'s on `account` and B\'s on `contact`: refused naming A, B and the environment; each route keeps its own', async () => {
            install(A);
            install(B);
            ship(A, 'account');
            ship(B, 'contact');
            shipPackageless('env', 'lead');
            storeEnvironmentRow('lead');
            for (const run of [read, layered]) {
                const err = await refused(run);
                expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
                expect(err.refusal.candidates).toEqual([
                    { kind: 'package', packageId: A }, { kind: 'package', packageId: B }, { kind: 'environment' },
                ]);
                expect(err.message).toContain('The environment\'s own item binds it to object "lead"');
            }
            // Seat ruling B: the route keeps main's answers (see case 1)…
            expect((await routeTo('contact')).action).toMatchObject({ label: 'beta' });
            // …except on `lead`, whose answer rode the defect #32568 closes:
            // the route reads each refused holder's exact address, and
            // `?package=alpha` served the environment's package-less item
            // there (the first holder's slot, not beta's). A sealed type's
            // package-less copy is declined at a holder's exact address (epic
            // ruling 6817768147), so neither holder owns `lead`. This engine
            // registers no metadata store, so no row says the item is the
            // environment's own: the route answers no declaration, not a
            // refusal and never `degraded`. With the store, the environment's
            // own item answers (#32751, below).
            const onLead = await routeTo('lead');
            expect([onLead.action, onLead.refusal, onLead.degraded]).toEqual([undefined, undefined, undefined]);
        });

        /**
         * [#32751] The route sees the object, and no holder binds `lead`: the
         * environment's own item there is the route's declaration — read from
         * the environment's own row and registry item, never at a holder's
         * exact address (epic red line 2), and served with no package, so the
         * dispatch is unqualified. The engine reads the same store the
         * protocol does (the row store double), as one kernel's engine does.
         *
         * BASE (main a7c97297, after #32741): `lead` answered no declaration
         * in both registration orders, and its handler never ran.
         */
        describe('[#32751] the bare route on an object neither holder binds serves the environment\'s own item there', () => {
            const engineReadsStore = () => {
                (engine as any).find = async (object: string, query: any) => {
                    if (object !== 'sys_metadata') return [];
                    const where: Record<string, any> = query?.where ?? {};
                    return storedRows.filter((row) => Object.keys(where).every((field) => {
                        if (field.startsWith('$')) throw new Error(`engine store double: combinator ${field} is not implemented`);
                        return row[field] === where[field];
                    }));
                };
            };
            const twoHoldersAndEnvironment = (envFirst: boolean, envObject: string | undefined = 'lead') => {
                engine = new ObjectQL();
                engine.registry.logLevel = 'silent';
                (protocol as any).engine.registry = engine.registry;
                engineReadsStore();
                install(A);
                install(B);
                if (envFirst) shipPackageless('env', envObject);
                ship(A, 'account');
                ship(B, 'contact');
                if (!envFirst) shipPackageless('env', envObject);
                storeEnvironmentRow(envObject);
            };

            it('the environment\'s item on `lead` beside A\'s on `account` and B\'s on `contact`: `lead` serves it with no package and runs its handler, in either registration order', async () => {
                for (const envFirst of [false, true]) {
                    twoHoldersAndEnvironment(envFirst);
                    engine.registerAction('lead', 'approve', () => 'ran env');
                    const order = `env registered ${envFirst ? 'first' : 'last'}`;
                    const onLead = await routeTo('lead');
                    expect([onLead.refusal, onLead.degraded, onLead.packageId], order).toEqual([undefined, undefined, undefined]);
                    expect(onLead.action, order).toMatchObject({ name: 'approve', label: 'env', objectName: 'lead' });
                    expect(await executeRegisteredAction(deps, engine, 'lead', ['approve'], {}, undefined), order)
                        .toEqual({ dispatched: true, result: 'ran env' });
                }
            });

            it('CONTROL — each holder\'s own route is unchanged: `account` answers A\'s, `contact` B\'s, in either registration order', async () => {
                for (const envFirst of [false, true]) {
                    twoHoldersAndEnvironment(envFirst);
                    const order = `env registered ${envFirst ? 'first' : 'last'}`;
                    const onAccount = await routeTo('account');
                    const onContact = await routeTo('contact');
                    expect([onAccount.refusal, onAccount.action?.label], order).toEqual([undefined, 'alpha']);
                    expect([onContact.refusal, onContact.action?.label], order).toEqual([undefined, 'beta']);
                }
            });

            it('the environment\'s object-less item answers `lead` too, in either registration order', async () => {
                for (const envFirst of [false, true]) {
                    twoHoldersAndEnvironment(envFirst, undefined);
                    const onLead = await routeTo('lead');
                    expect([onLead.refusal, onLead.packageId, onLead.action?.label]).toEqual([undefined, undefined, 'env']);
                }
            });

            it('a DISABLED package binding `lead` is still a holder there (main\'s own answer): `lead` stays no declaration, never the environment\'s item', async () => {
                const D = 'com.acme.delta';
                for (const envFirst of [false, true]) {
                    twoHoldersAndEnvironment(envFirst);
                    install(D);
                    ship(D, 'lead');
                    engine.registry.disablePackage(D);
                    const onLead = await routeTo('lead');
                    expect([onLead.action, onLead.refusal, onLead.degraded]).toEqual([undefined, undefined, undefined]);
                }
            });

            it('[#32995] a DISABLED package\'s OBJECT-LESS action owns `lead` too: `lead` stays no declaration, never the environment\'s item, in either registration order', async () => {
                const D = 'com.acme.delta';
                for (const envFirst of [false, true]) {
                    twoHoldersAndEnvironment(envFirst);
                    install(D);
                    engine.registry.registerItem('action', {
                        name: 'approve', label: 'delta', type: 'script', target: 'approve',
                        body: { language: 'js', source: 'return 1;', capabilities: [] },
                    } as never, 'name' as never, D);
                    engine.registry.disablePackage(D);
                    const onLead = await routeTo('lead');
                    expect([onLead.action, onLead.refusal, onLead.degraded], `env registered ${envFirst ? 'first' : 'last'}`)
                        .toEqual([undefined, undefined, undefined]);
                }
            });

            it('NEIGHBOUR — an ENABLED third package C bound to `lead`: `lead` answers C\'s own declaration, never the environment\'s item, in either registration order', async () => {
                const C = 'com.acme.gamma';
                for (const envFirst of [false, true]) {
                    twoHoldersAndEnvironment(envFirst);
                    install(C);
                    ship(C, 'lead');
                    const order = `env registered ${envFirst ? 'first' : 'last'}`;
                    const onLead = await routeTo('lead');
                    expect([onLead.refusal, onLead.degraded], order).toEqual([undefined, undefined]);
                    expect(onLead.action, order).toMatchObject({ name: 'approve', label: 'gamma', objectName: 'lead' });
                }
            });

            it('NEIGHBOUR — a candidate whose own address answers `not-held-by-qualifier` may own `lead`: the bare read\'s refusal stands, never the environment\'s item', async () => {
                twoHoldersAndEnvironment(false);
                const AB = [{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }];
                const refusal = (candidates: any[], reason: string) => new PackageScopedNameRefusedError({
                    status: 'refused', reason, type: 'action', name: 'approve', callerPackageId: null, candidates,
                    message: 'refused',
                } as any);
                const bare = refusal(AB, 'ambiguous-in-environment');
                const stub: any = {
                    getMetaItems: async () => ({ items: [] }),
                    getMetaItemForExecution: async (request: { packageId?: string }) => {
                        if (!request.packageId) throw bare;
                        if (request.packageId === A) throw refusal([{ kind: 'package', packageId: A }], 'not-held-by-qualifier');
                        return { item: { name: 'approve', label: 'beta', type: 'script', objectName: 'contact', _packageId: B } };
                    },
                };
                const stubDeps = { ...deps, resolveService: (async (_ctx: unknown, name: string) => (name === 'protocol' ? stub : undefined)) as any };
                const onLead = await resolveRouteActionDeclaration(stubDeps, { request: {} } as any, { ql: engine, objectName: 'lead', actionName: 'approve' });
                expect([onLead.action, onLead.degraded]).toEqual([undefined, undefined]);
                expect(onLead.refusal?.candidates).toEqual(AB);
            });

            it('the platform\'s item on `lead` (a package-less item with no row behind it) is not the environment\'s: `lead` stays no declaration', async () => {
                twoHoldersAndEnvironment(false);
                storedRows = [];
                const onLead = await routeTo('lead');
                expect([onLead.action, onLead.refusal, onLead.degraded]).toEqual([undefined, undefined, undefined]);
            });

            it('a store read that fails is the plane failing to answer: `degraded`, never no declaration (ADR-0110 D3)', async () => {
                twoHoldersAndEnvironment(false);
                (engine as any).find = async () => { throw new Error('store unreachable'); };
                const onLead = await routeTo('lead');
                expect([onLead.action, onLead.degraded, onLead.reason]).toEqual([undefined, true, 'store unreachable']);
            });
        });

        it('all three object-less: refused naming A, B and the environment', async () => {
            install(A);
            install(B);
            for (const id of [A, B]) {
                engine.registry.registerItem('action', {
                    name: 'approve', label: id.split('.').pop(), type: 'script', target: 'approve',
                    body: { language: 'js', source: 'return 1;', capabilities: [] },
                } as never, 'name' as never, id);
            }
            shipPackageless('env');
            storeEnvironmentRow();
            const err = await refused(read);
            expect(err?.refusal?.candidates).toEqual([
                { kind: 'package', packageId: A }, { kind: 'package', packageId: B }, { kind: 'environment' },
            ]);
        });
    });

    describe('case 3 — a disabled package registered before the one enabled holder', () => {
        for (const [shape, bObject, aObject] of [
            ['two objects', 'contact', 'account'], ['one object', 'account', 'account'], ['object-less', undefined, undefined],
        ] as const) {
            it(`${shape}: the plain read and its layers answer the enabled holder, never no item and never the disabled body`, async () => {
                install(B);
                install(A);
                const shipAt = (id: string, objectName: string | undefined) => engine.registry.registerItem('action', {
                    name: 'approve', label: id.split('.').pop(), type: 'script', ...(objectName ? { objectName } : {}), target: 'approve',
                    body: { language: 'js', source: 'return 1;', capabilities: [] },
                } as never, 'name' as never, id);
                shipAt(B, bObject);
                shipAt(A, aObject);
                engine.registry.disablePackage(B);
                expect((await read()).item).toMatchObject({ label: 'alpha' });
                expect((await layered()).effective).toMatchObject({ label: 'alpha' });
                // …and the route of A's object gets A's declaration (BASE: none).
                const onA = await routeTo(aObject ?? 'global');
                expect([onA.refusal, onA.action?.label]).toEqual([undefined, 'alpha']);
            });
        }

        it('CONTROL — the enabled holder registered first answers as before', async () => {
            install(A);
            install(B);
            ship(A, 'account');
            ship(B, 'contact');
            engine.registry.disablePackage(B);
            expect((await read()).item).toMatchObject({ label: 'alpha' });
            expect((await layered()).effective).toMatchObject({ label: 'alpha' });
        });
    });

    it('CONTROL — one package holding the name, nothing package-less: both reads answer it, as before', async () => {
        install(A);
        ship(A, 'account');
        expect((await read()).item).toMatchObject({ label: 'alpha' });
        expect((await layered()).effective).toMatchObject({ label: 'alpha' });
    });

    describe('over a real `MetadataManager` in the `metadata` slot', () => {
        /** [#32560] The service's store loader: the environment's own item is stored there as well as registered. */
        let serviceStore: { save(type: string, name: string, data: unknown): Promise<unknown> };
        const withService = async () => {
            const { MetadataManager, MemoryLoader } = await import('@objectstack/metadata');
            serviceStore = new MemoryLoader();
            const manager = new MetadataManager({ formats: ['json'], loaders: [serviceStore as any] });
            const services = new Map<string, unknown>([['metadata', manager]]);
            protocol = new ObjectStackProtocolImplementation((protocol as any).engine, () => services as Map<string, any>);
            return manager;
        };
        const item = (packageId: string | undefined, label: string, objectName: string) => ({
            name: 'approve', label, type: 'script', objectName, target: 'approve', ...(packageId ? { _packageId: packageId } : {}),
        });
        /** The environment's own item in the service: stored, and registered in memory. */
        const environmentInService = async (manager: { registerInMemory(type: string, name: string, data: unknown): void }, objectName: string) => {
            const env = item(undefined, 'env', objectName);
            await serviceStore.save('action', 'approve', env);
            manager.registerInMemory('action', 'approve', env);
        };

        it('the service\'s environment item beside A\'s answers the read, whichever was written last', async () => {
            const manager = await withService();
            install(A);
            ship(A, 'account');
            await environmentInService(manager, 'contact');
            manager.registerInMemory('action', 'approve', item(A, 'alpha', 'account'));
            expect((await read()).item).toMatchObject({ label: 'env' });
        });

        it('the service\'s refusal naming two enabled packages and the environment reaches the caller', async () => {
            const manager = await withService();
            install(A);
            install(B);
            ship(A, 'account');
            manager.registerInMemory('action', 'approve', item(A, 'alpha', 'account'));
            manager.registerInMemory('action', 'approve', item(B, 'beta', 'contact'));
            await environmentInService(manager, 'lead');
            const err = await refused(read);
            expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
            expect(err.refusal.candidates).toEqual([
                { kind: 'package', packageId: A }, { kind: 'package', packageId: B }, { kind: 'environment' },
            ]);
        });

        /**
         * [#32560, contract review F5] The service holds A's item, a disabled
         * B's and the environment's on `lead`; the registry holds A's only.
         * The service's refusal names one enabled package and is dropped; the
         * package-less item it names is judged as the judge judges one
         * ({@link judgeDroppedServiceRefusal}). BASE: the judge saw one enabled
         * holder in the registry, and A's item answered both reads.
         */
        it('[#32560] the service\'s refusal naming a DISABLED package beside A and the environment\'s item, which the store holds: both reads answer the environment\'s (BASE: A\'s)', async () => {
            const manager = await withService();
            install(A);
            install(B);
            ship(A, 'account');
            manager.registerInMemory('action', 'approve', item(A, 'alpha', 'account'));
            manager.registerInMemory('action', 'approve', item(B, 'beta', 'contact'));
            await environmentInService(manager, 'lead');
            engine.registry.disablePackage(B);
            storeEnvironmentRow('lead');
            expect((await read()).item).toMatchObject({ label: 'env', objectName: 'lead' });
            const layers = await layered();
            expect(layers.code, 'code layer').toMatchObject({ label: 'env', objectName: 'lead' });
            expect(layers.effective).toMatchObject({ label: 'env' });
        });

        it('[#32560] …and with no row of it in the environment\'s store, the package-less item is the platform\'s: both reads refuse naming A and the platform (BASE: A\'s answered)', async () => {
            const manager = await withService();
            install(A);
            install(B);
            ship(A, 'account');
            manager.registerInMemory('action', 'approve', item(A, 'alpha', 'account'));
            manager.registerInMemory('action', 'approve', item(B, 'beta', 'contact'));
            await environmentInService(manager, 'lead');
            engine.registry.disablePackage(B);
            for (const run of [read, layered]) {
                const err = await refused(run);
                expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
                expect([err.code, err.status]).toEqual(['RESOURCE_CONFLICT', 409]);
                expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'platform' }]);
                expect(err.message).toContain('held by 2 holders');
                expect(err.message).toContain('The platform\'s item binds it to object "lead"');
            }
        });

        it('[#32560, item 1] a package-less item the service only registers (the platform\'s) beside A\'s, with no row of it: both reads refuse naming A and the platform (BASE: the service\'s package-less item answered)', async () => {
            const manager = await withService();
            install(A);
            ship(A, 'account');
            manager.registerInMemory('action', 'approve', item(A, 'alpha', 'account'));
            manager.registerInMemory('action', 'approve', item(undefined, 'platform', 'contact'));
            for (const run of [read, layered]) {
                const err = await refused(run);
                expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
                expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'platform' }]);
            }
        });

        it('[#32560] the disabled B\'s customization (a package-less body the service keeps in B\'s slot) and no slot of the enabled A in the service: both reads answer A\'s (BASE: B\'s customization)', async () => {
            const manager = await withService();
            install(B);
            install(A);
            ship(B, 'contact');
            ship(A, 'account');
            engine.registry.disablePackage(B);
            manager.registerInMemory('action', 'approve', item(B, 'beta', 'contact'));
            manager.registerInMemory('action', 'approve', item(undefined, 'beta-custom', 'contact'));
            expect((await read()).item).toMatchObject({ label: 'alpha', objectName: 'account' });
            const layers = await layered();
            expect(layers.code, 'code layer').toMatchObject({ label: 'alpha', objectName: 'account' });
        });

        it('[#32560] CONTROL — the service\'s refusal naming a disabled package and the environment\'s item alone: the environment\'s item answers', async () => {
            const manager = await withService();
            install(B);
            manager.registerInMemory('action', 'approve', item(B, 'beta', 'contact'));
            await environmentInService(manager, 'lead');
            engine.registry.disablePackage(B);
            expect((await read()).item).toMatchObject({ label: 'env', objectName: 'lead' });
        });

        /**
         * [contract review F3] The service is read before the registry and
         * holds its own copies, so its bare answer can be another holder's
         * than the rule's. The plain read and the layered read's code layer
         * serve it only when it is package-less or the judged holder's own;
         * otherwise the judged answer. Code and overlay asserted apart.
         */
        it('[contract review F3] case 1 — the service holds A\'s item only, the registry and the store the environment\'s on `contact`: both reads answer the environment\'s, code layer included', async () => {
            const manager = await withService();
            install(A);
            ship(A, 'account');
            shipPackageless('env', 'contact');
            storeEnvironmentRow('contact');
            manager.registerInMemory('action', 'approve', item(A, 'alpha', 'account'));
            expect((await read()).item).toMatchObject({ label: 'env', objectName: 'contact' });
            const layers = await layered();
            expect(layers.code, 'code layer').toMatchObject({ label: 'env', objectName: 'contact' });
            expect(layers.overlay, 'overlay').toBeNull();
            expect(layers.effective).toMatchObject({ label: 'env' });
        });

        it('[contract review F3] case 3 — the service holds the disabled B\'s item only, registered before A\'s: both reads answer A\'s, code layer included', async () => {
            const manager = await withService();
            install(B);
            install(A);
            ship(B, 'contact');
            ship(A, 'account');
            engine.registry.disablePackage(B);
            manager.registerInMemory('action', 'approve', item(B, 'beta', 'contact'));
            expect((await read()).item).toMatchObject({ label: 'alpha', objectName: 'account' });
            const layers = await layered();
            expect(layers.code, 'code layer').toMatchObject({ label: 'alpha', objectName: 'account' });
            expect(layers.overlay, 'overlay').toBeNull();
            expect(layers.effective).toMatchObject({ label: 'alpha' });
        });

        /**
         * [contract review N1] The service's copy is judged by the package the
         * store reads off it (`storedItemPackageId`: the stored envelope's
         * `packageId`, else the body's stamp, the publish envelope peeled), and
         * a package-less copy beside a package-less judged answer only when it
         * binds the judged item's object: a package-less body the store keeps
         * in a package's slot (that package's customization, on its object) is
         * not the environment's item.
         */
        const enveloped = (packageId: string, label: string, objectName: string) => ({
            name: 'approve', state: 'active', metadata: item(packageId, label, objectName),
        });

        it('[contract review N1] case 1 — the service holds A\'s copy under the publish envelope: both reads answer the environment\'s, code layer included', async () => {
            const manager = await withService();
            install(A);
            ship(A, 'account');
            shipPackageless('env', 'contact');
            storeEnvironmentRow('contact');
            manager.registerInMemory('action', 'approve', enveloped(A, 'alpha', 'account'));
            expect((await read()).item).toMatchObject({ label: 'env', objectName: 'contact' });
            const layers = await layered();
            expect(layers.code, 'code layer').toMatchObject({ label: 'env', objectName: 'contact' });
            expect(layers.overlay, 'overlay').toBeNull();
        });

        it('[contract review N1] case 3 — the service holds the disabled B\'s copy under the publish envelope: both reads answer A\'s, code layer included', async () => {
            const manager = await withService();
            install(B);
            install(A);
            ship(B, 'contact');
            ship(A, 'account');
            engine.registry.disablePackage(B);
            manager.registerInMemory('action', 'approve', enveloped(B, 'beta', 'contact'));
            expect((await read()).item).toMatchObject({ label: 'alpha', objectName: 'account' });
            const layers = await layered();
            expect(layers.code, 'code layer').toMatchObject({ label: 'alpha', objectName: 'account' });
            expect(layers.overlay, 'overlay').toBeNull();
        });

        it('[contract review N1] case 1 — the service holds A\'s customization (a package-less body in A\'s slot, on `account`): both reads answer the environment\'s, code layer included', async () => {
            const manager = await withService();
            install(A);
            ship(A, 'account');
            shipPackageless('env', 'contact');
            storeEnvironmentRow('contact');
            manager.registerInMemory('action', 'approve', item(A, 'alpha', 'account'));
            manager.registerInMemory('action', 'approve', item(undefined, 'alpha-custom', 'account'));
            expect((await read()).item).toMatchObject({ label: 'env', objectName: 'contact' });
            const layers = await layered();
            expect(layers.code, 'code layer').toMatchObject({ label: 'env', objectName: 'contact' });
            expect(layers.overlay, 'overlay').toBeNull();
        });

        it('[contract review N1] CONTROL — the one holder\'s customization in the service (a package-less body in A\'s slot): both reads answer it', async () => {
            const manager = await withService();
            install(A);
            ship(A, 'account');
            manager.registerInMemory('action', 'approve', item(A, 'alpha', 'account'));
            manager.registerInMemory('action', 'approve', item(undefined, 'alpha-custom', 'account'));
            expect((await read()).item).toMatchObject({ label: 'alpha-custom' });
            const layers = await layered();
            expect(layers.code, 'code layer').toMatchObject({ label: 'alpha-custom' });
        });

        it('[contract review F3] case 3 — the service holds both, the disabled B\'s first: both reads answer A\'s', async () => {
            const manager = await withService();
            install(B);
            install(A);
            ship(B, 'contact');
            ship(A, 'account');
            engine.registry.disablePackage(B);
            manager.registerInMemory('action', 'approve', item(B, 'beta', 'contact'));
            manager.registerInMemory('action', 'approve', item(A, 'alpha', 'account'));
            expect((await read()).item).toMatchObject({ label: 'alpha' });
            const layers = await layered();
            expect(layers.code, 'code layer').toMatchObject({ label: 'alpha' });
            expect(layers.overlay, 'overlay').toBeNull();
        });

        /**
         * [epic note 6798747403] After a package-less registry heal is refused
         * (two packages hold the name in the service store), the removed row's
         * entry stays in the registry's bare slot with no composite holder
         * beside it. Ruled: that entry is retired by the heal (carrier: the
         * heal's own PR). Pinned here, within this card: whatever the heal
         * leaves, that stale entry never answers the bare read — the store's
         * refusal naming every holder does.
         */
        it('[epic note 6798747403] a stale package-less registry entry with no composite holder never answers the bare read: the store\'s 409 does', async () => {
            const manager = await withService();
            install(A);
            install(B);
            shipPackageless('removed-row', 'lead');
            manager.registerInMemory('action', 'approve', item(A, 'alpha', 'account'));
            manager.registerInMemory('action', 'approve', item(B, 'beta', 'contact'));
            const err = await refused(read);
            expect(err, 'never the stale entry').toBeInstanceOf(PackageScopedNameRefusedError);
            expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
        });
    });
});

/**
 * [#32996, #32989, #32988] The `/actions` route answers by who holds the name
 * ON THE ROUTE — the items bound to the routed object, else the object-less
 * ones — never by how many holders sit elsewhere or which registered last.
 * The protocol's bare by-name read cannot see the object: beside one package
 * it answered the environment's item wherever that item is bound, beside a
 * disabled package its answer moved with registration order. The route reads
 * the registry's listing of every holder (disabled packages included) and the
 * environment's own store instead. Every cell runs in both registration
 * orders.
 *
 * BASE (main e540baf8) per cell, in its test's title.
 */
describe('[#32996, #32989, #32988] the action route answers by who holds the name on the route', () => {
    const C = 'com.acme.gamma';
    const D = 'com.acme.delta';
    /** A fresh engine whose `find` reads the environment's store, as one kernel's engine does. */
    const freshEngine = () => {
        engine = new ObjectQL();
        engine.registry.logLevel = 'silent';
        (protocol as any).engine.registry = engine.registry;
        storedRows = [];
        (engine as any).find = async (object: string, query: any) => {
            if (object !== 'sys_metadata') return [];
            const where: Record<string, any> = query?.where ?? {};
            return storedRows.filter((row) => Object.keys(where).every((field) => {
                if (field.startsWith('$')) throw new Error(`engine store double: combinator ${field} is not implemented`);
                return row[field] === where[field];
            }));
        };
    };
    const shipAt = (packageId: string | undefined, label: string, objectName?: string) =>
        engine.registry.registerItem('action', {
            name: 'approve', label, type: 'script', ...(objectName ? { objectName } : {}), target: 'approve',
            body: { language: 'js', source: 'return 1;', capabilities: [] },
        } as never, 'name' as never, packageId);
    /** The environment's own item: registered, and its row stored bound to no package. */
    const environmentItem = (objectName?: string) => {
        shipAt(undefined, 'env', objectName);
        storedRows = [{
            id: 'env-approve', type: 'action', name: 'approve', state: 'active', package_id: null,
            metadata: JSON.stringify({ name: 'approve', label: 'env', type: 'script', ...(objectName ? { objectName } : {}) }),
        }];
    };
    const routeTo = (objectName: string) =>
        resolveRouteActionDeclaration(deps, { request: {} } as any, { ql: engine, objectName, actionName: 'approve' });
    const envAddress = (objectName: string) =>
        resolveAddressedRouteActionDeclaration(deps, { request: {} } as any, {
            ql: engine, objectName, actionName: 'approve', qualifier: { environment: true },
        });
    /** One registration order of `steps`, and its reverse. */
    const bothOrders = (steps: Array<() => unknown>): Array<[string, () => void]> => [
        ['registered in order', () => steps.forEach((step) => step())],
        ['registered in reverse', () => [...steps].reverse().forEach((step) => step())],
    ];
    const answerOf = (answer: { action?: any; refusal?: unknown; degraded?: unknown; packageId?: unknown }) =>
        [answer.refusal, answer.degraded, answer.packageId, answer.action?.label];

    describe('#32996 — a disabled package on `lead` beside the environment\'s item there', () => {
        for (const [shape, dObject] of [['bound to `lead`', 'lead'], ['object-less', undefined]] as const) {
            for (const elsewhere of [0, 1, 2]) {
                it(`disabled D ${shape}, ${elsewhere} enabled holder(s) elsewhere: \`lead\` answers no declaration, never the environment's item (BASE with one: the environment's item)`, async () => {
                    for (const [order, register] of bothOrders([
                        () => environmentItem('lead'),
                        () => shipAt(D, 'delta', dObject),
                        ...(elsewhere >= 1 ? [() => shipAt(A, 'alpha', 'account')] : []),
                        ...(elsewhere >= 2 ? [() => shipAt(B, 'beta', 'contact')] : []),
                    ])) {
                        freshEngine();
                        [A, B, D].forEach((id) => install(id));
                        register();
                        engine.registry.disablePackage(D);
                        expect(answerOf(await routeTo('lead')), order).toEqual([undefined, undefined, undefined, undefined]);
                    }
                });
            }
        }

        it('CONTROL — with no disabled package, the environment\'s item answers `lead` whatever the holders elsewhere', async () => {
            for (const elsewhere of [0, 1, 2]) {
                for (const [order, register] of bothOrders([
                    () => environmentItem('lead'),
                    ...(elsewhere >= 1 ? [() => shipAt(A, 'alpha', 'account')] : []),
                    ...(elsewhere >= 2 ? [() => shipAt(B, 'beta', 'contact')] : []),
                ])) {
                    freshEngine();
                    [A, B].forEach((id) => install(id));
                    register();
                    expect(answerOf(await routeTo('lead')), `${elsewhere} elsewhere, ${order}`).toEqual([undefined, undefined, undefined, 'env']);
                }
            }
        });

        it('CONTROL — an ENABLED package bound to `lead` beside a disabled one: the enabled package\'s own declaration', async () => {
            for (const [order, register] of bothOrders([
                () => shipAt(D, 'delta', 'lead'),
                () => shipAt(C, 'gamma', 'lead'),
            ])) {
                freshEngine();
                [C, D].forEach((id) => install(id));
                register();
                engine.registry.disablePackage(D);
                expect(answerOf(await routeTo('lead')), order).toEqual([undefined, undefined, undefined, 'gamma']);
            }
        });
    });

    describe('#32989 — a served holder\'s own route', () => {
        for (const [envShape, envObject] of [['none', null], ['on `lead`', 'lead'], ['object-less', undefined]] as const) {
            for (const [aShape, aObject] of [['on `account`', 'account'], ['on `contact`', 'contact'], ['object-less', undefined], ['absent', null]] as const) {
                it(`B on \`contact\`, disabled A ${aShape}, the environment's item ${envShape}: \`contact\` answers B's own declaration, with no package (BASE with the environment's item: no declaration, or its object-less item)`, async () => {
                    for (const [order, register] of bothOrders([
                        ...(aObject !== null ? [() => shipAt(A, 'alpha', aObject)] : []),
                        () => shipAt(B, 'beta', 'contact'),
                        ...(envObject !== null ? [() => environmentItem(envObject)] : []),
                    ])) {
                        freshEngine();
                        [A, B].forEach((id) => install(id));
                        register();
                        if (aObject !== null) engine.registry.disablePackage(A);
                        const onContact = await routeTo('contact');
                        expect(answerOf(onContact), order).toEqual([undefined, undefined, undefined, 'beta']);
                        expect(onContact.action, order).toMatchObject({ name: 'approve', objectName: 'contact' });
                    }
                });
            }
        }

        it('B on `contact` beside the platform\'s item on `lead` (no row behind it): `contact` answers B\'s own declaration (BASE: no declaration)', async () => {
            for (const [order, register] of bothOrders([() => shipAt(B, 'beta', 'contact'), () => shipAt(undefined, 'platform', 'lead')])) {
                freshEngine();
                install(B);
                register();
                expect(answerOf(await routeTo('contact')), order).toEqual([undefined, undefined, undefined, 'beta']);
                expect((await routeTo('lead')).action?.label, `${order}: the platform's own route keeps its answer`).toBe('platform');
            }
        });

        it('the environment\'s item on `contact` beside B on `contact`: the environment\'s item answers first (ADR-0150 D3), with or without a disabled A (BASE with A registered first: no declaration)', async () => {
            for (const withA of [false, true]) {
                for (const [order, register] of bothOrders([
                    ...(withA ? [() => shipAt(A, 'alpha', 'account')] : []),
                    () => shipAt(B, 'beta', 'contact'),
                    () => environmentItem('contact'),
                ])) {
                    freshEngine();
                    [A, B].forEach((id) => install(id));
                    register();
                    if (withA) engine.registry.disablePackage(A);
                    expect(answerOf(await routeTo('contact')), `${withA ? 'with' : 'without'} A, ${order}`).toEqual([undefined, undefined, undefined, 'env']);
                }
            }
        });

        it('the environment\'s item on `lead` beside B on `contact` and a disabled A: `lead` answers the environment\'s item when A binds another object, no declaration when A is object-less (BASE: moved with registration order)', async () => {
            for (const [aObject, want] of [['account', 'env'], [undefined, undefined]] as const) {
                for (const [order, register] of bothOrders([
                    () => shipAt(A, 'alpha', aObject),
                    () => shipAt(B, 'beta', 'contact'),
                    () => environmentItem('lead'),
                ])) {
                    freshEngine();
                    [A, B].forEach((id) => install(id));
                    register();
                    engine.registry.disablePackage(A);
                    expect(answerOf(await routeTo('lead')), `A ${aObject ?? 'object-less'}, ${order}`).toEqual([undefined, undefined, undefined, want]);
                }
            }
        });

        it('a store read that fails is the plane failing to answer: `degraded`, never a declaration (ADR-0110 D3)', async () => {
            freshEngine();
            install(B);
            shipAt(B, 'beta', 'contact');
            environmentItem('contact');
            (engine as any).find = async () => { throw new Error('store unreachable'); };
            const onContact = await routeTo('contact');
            expect([onContact.action, onContact.degraded, onContact.reason]).toEqual([undefined, true, 'store unreachable']);
        });
    });

    /**
     * [review 6879733874 M1] The route judges the composition on the
     * registry's listing before it reads the environment's store: a name one
     * holder holds never reads the store, so it neither pays the store's scans
     * on every dispatch nor answers `degraded` while the store is down.
     */
    describe('a name one holder holds never reads the environment\'s store', () => {
        const oneHolder: Array<[string, () => void, string]> = [
            ['the environment\'s own item', () => environmentItem('contact'), 'env'],
            ['the platform\'s item', () => shipAt(undefined, 'platform', 'contact'), 'platform'],
            ['one package\'s item', () => { install(B); shipAt(B, 'beta', 'contact'); }, 'beta'],
        ];
        for (const [holder, register, label] of oneHolder) {
            it(`${holder}: a store whose read throws leaves the route answering it, and the call dispatches`, async () => {
                freshEngine();
                register();
                (engine as any).find = async () => { throw new Error('store unreachable'); };
                engine.registerAction('contact', 'approve', () => `ran ${label}`);
                expect(answerOf(await routeTo('contact'))).toEqual([undefined, undefined, undefined, label]);
                expect(await executeRegisteredAction(deps, engine, 'contact', ['approve'], {}, undefined))
                    .toEqual({ dispatched: true, result: `ran ${label}` });
            });

            it(`${holder}: the route reads the store zero times`, async () => {
                freshEngine();
                register();
                const read = (engine as any).find;
                let storeReads = 0;
                (engine as any).find = async (object: string, query: any) => {
                    if (object === 'sys_metadata') storeReads += 1;
                    return read(object, query);
                };
                expect(answerOf(await routeTo('contact'))).toEqual([undefined, undefined, undefined, label]);
                expect(storeReads).toBe(0);
            });
        }
    });

    describe('#32988 — the environment\'s exact address', () => {
        for (const holders of [1, 2]) {
            for (const [envShape, envObject, address] of [['on `lead`', 'lead', 'lead'], ['object-less', undefined, 'lead'], ['object-less', undefined, 'global']] as const) {
                it(`${holders} package holder(s), the environment's item ${envShape}: \`/actions/_env/${address}/approve\` answers the environment's own item, with no package (BASE: 404)`, async () => {
                    for (const [order, register] of bothOrders([
                        () => shipAt(A, 'alpha', 'account'),
                        ...(holders === 2 ? [() => shipAt(B, 'beta', 'contact')] : []),
                        () => environmentItem(envObject),
                    ])) {
                        freshEngine();
                        [A, B].forEach((id) => install(id));
                        register();
                        const answer = await envAddress(address);
                        expect(answerOf(answer), order).toEqual([undefined, undefined, undefined, 'env']);
                        expect(answer.action, order).toMatchObject({ name: 'approve' });
                    }
                });
            }
        }

        it('a disabled package bound to the same object does not change the environment\'s own address', async () => {
            for (const [order, register] of bothOrders([() => shipAt(D, 'delta', 'lead'), () => environmentItem('lead')])) {
                freshEngine();
                install(D);
                register();
                engine.registry.disablePackage(D);
                expect(answerOf(await envAddress('lead')), order).toEqual([undefined, undefined, undefined, 'env']);
            }
        });

        it('CONTROL — the platform\'s item (no row behind it) is never the environment\'s: the address still answers 404', async () => {
            for (const [order, register] of bothOrders([() => shipAt(A, 'alpha', 'account'), () => shipAt(undefined, 'platform', 'lead')])) {
                freshEngine();
                install(A);
                register();
                const err = await envAddress('lead').then(() => undefined, (e: any) => e);
                expect([err?.code, err?.status], order).toEqual(['RESOURCE_NOT_FOUND', 404]);
            }
        });

        it('CONTROL — an object the environment\'s item does not reach still answers 404', async () => {
            freshEngine();
            install(A);
            shipAt(A, 'alpha', 'account');
            environmentItem('lead');
            const err = await envAddress('contact').then(() => undefined, (e: any) => e);
            expect([err?.code, err?.status]).toEqual(['RESOURCE_NOT_FOUND', 404]);
        });
    });
});

/**
 * [#32681; seat ruling A on #32681, ADR-0150 D4] ALPHA binds `approve` to
 * `account`, BETA to `contact`, and the environment saves a package-less
 * `approve` on `account` through `DatabaseLoader`. Keyed per
 * `(object, name)`, that save is ALPHA's customization (ALPHA's `account`
 * row), and ALPHA's first `account` save takes a package-less `account` row
 * over. So, over the stored rows and the boot priming pass,
 * `/actions/account/approve` judges the item ALPHA's slot holds and runs
 * ALPHA's handler, in both save orders. Beside BETA's `contact` binding
 * alone, the package-less save on `account` is stored as the environment's
 * own row, never a row of BETA's.
 *
 * BEFORE (main `9f736f2e`, the metadata fix reverted and rebuilt):
 * A-B-save judged ALPHA's own body (`alpha`) while ALPHA's slot held the
 * customization (`custom`): a declaration of another item than the one ALPHA
 * serves. B-save-A wrote the package-less save into a BETA row bound to
 * `account`, and the `account` route was refused (`ambiguous-in-environment`)
 * while `/actions/contact/approve` judged no declaration. Beside BETA alone the
 * save wrote a BETA row bound to `account`.
 */
describe('[#32681] /actions/account/approve judges and runs one item over the stored rows, in both save orders', () => {
    /** A writable `sys_metadata` engine: what `DatabaseLoader`'s save and read paths call. */
    const writableEngine = () => {
        const rows: Array<Record<string, unknown>> = [];
        const matches = (r: Record<string, unknown>, w: Record<string, unknown>) =>
            Object.entries(w).every(([k, v]) => {
                if (k.startsWith('$') || (v !== null && typeof v === 'object')) throw new Error(`writableEngine: unsupported WHERE on '${k}'`);
                return r[k] === v;
            });
        const rowEngine = {
            async find(table: string, q: any) {
                const hits = table === 'sys_metadata' ? rows.filter((r) => matches(r, q?.where ?? {})) : [];
                const page = typeof q?.limit === 'number' ? hits.slice(0, q.limit) : hits;
                return page.map((r) => ({ ...r }));
            },
            async findOne(table: string, q: any) {
                assertEngineFindOnePredicate(table, q);
                const hit = table === 'sys_metadata' ? rows.find((r) => matches(r, q?.where ?? {})) : undefined;
                return hit ? { ...hit } : null;
            },
            async count(table: string, q: any) {
                return table === 'sys_metadata' ? rows.filter((r) => matches(r, q?.where ?? {})).length : 0;
            },
            async insert(table: string, data: Record<string, unknown>) {
                if (table === 'sys_metadata') rows.push({ ...data });
                return { ...data };
            },
            async update(table: string, data: Record<string, unknown>, options?: any) {
                assertEngineUpdateDispatch(data as any, options);
                const row = table === 'sys_metadata' ? rows.find((r) => r.id === data.id) : undefined;
                if (!row) return null;
                Object.assign(row, data);
                return { ...row };
            },
            async delete(_table: string, options?: any) {
                assertEngineDeleteDispatch(options);
                throw new Error('writableEngine: no case here deletes a row');
            },
            async aggregate() {
                return [];
            },
        };
        return { rowEngine, rows };
    };
    const loaderOver = async (rowEngine: any) => {
        const { DatabaseLoader } = await import('@objectstack/metadata');
        return new DatabaseLoader({ engine: rowEngine, trackHistory: false, cache: { enabled: false } } as any) as any;
    };
    /** A save through the loader: a package's body carries its stamp, the environment's none. */
    const save = async (rowEngine: any, packageId: string | undefined, objectName: string, label: string) => {
        const body = {
            name: 'approve', label, type: 'script', objectName, target: 'approve',
            body: { language: 'js', source: 'return 1;', capabilities: [] },
            ...(packageId ? { _packageId: packageId } : {}),
        };
        await (await loaderOver(rowEngine)).save('action', 'approve', body);
    };
    /** The boot priming pass over the stored rows, the protocol over its manager. */
    const boot = async (rowEngine: any, rows: any[]) => {
        const { MetadataPlugin } = await import('@objectstack/metadata');
        const plugin = new MetadataPlugin({ watch: false, config: { bootstrap: 'eager' } } as any);
        const manager = (plugin as any).manager;
        manager.loaders.clear();
        manager.registerLoader(await loaderOver(rowEngine));
        const quiet = () => {};
        await (plugin as any)._loadFromFileSystem({ logger: { info: quiet, warn: quiet, error: quiet, debug: quiet } });
        const services = new Map<string, unknown>([['metadata', manager]]);
        storedRows = rows;
        protocol = new ObjectStackProtocolImplementation((protocol as any).engine, () => services as Map<string, any>);
        deps = { ...deps, resolveService: (async (_ctx: unknown, name: string) => (name === 'protocol' ? protocol : undefined)) as any };
        return manager;
    };
    const routeTo = (objectName: string) =>
        resolveRouteActionDeclaration(deps, { request: {} } as any, { ql: engine, objectName, actionName: 'approve' });
    /** The label of the declaration a route judges, and the handler the dispatch runs for it. */
    const judgedAndRun = async (objectName: string) => {
        const declaration = await routeTo(objectName);
        let run: unknown;
        try {
            run = (await executeRegisteredAction(deps, engine, objectName, ['approve'], {}, declaration.packageId)).result;
        } catch (e: any) {
            run = [e?.code, e?.status];
        }
        return { judged: declaration.action?.label, refusal: declaration.refusal?.reason, degraded: declaration.degraded, run };
    };
    const storedRowsOf = (rows: Array<Record<string, unknown>>) => rows.map((r) => [r.package_id ?? null, r.bundle_member ?? null]);

    for (const order of ['A, B, then the package-less save', 'B, the package-less save, then A'] as const) {
        it(`${order}: the account route judges A's item and runs A's handler`, async () => {
            const { rowEngine, rows } = writableEngine();
            if (order === 'A, B, then the package-less save') {
                await save(rowEngine, A, 'account', 'alpha');
                await save(rowEngine, B, 'contact', 'beta');
                await save(rowEngine, undefined, 'account', 'custom');
            } else {
                await save(rowEngine, B, 'contact', 'beta');
                await save(rowEngine, undefined, 'account', 'custom');
                await save(rowEngine, A, 'account', 'alpha');
            }
            install(A);
            install(B);
            ship(A, 'account');
            ship(B, 'contact');
            engine.registerAction('account', 'approve', () => `ran ${A}`, `app:${A}`);
            engine.registerAction('contact', 'approve', () => `ran ${B}`, `app:${B}`);
            const manager = await boot(rowEngine, rows);
            // One row per holder's binding: the package-less save is ALPHA's `account` row.
            expect(storedRowsOf(rows).sort()).toEqual([[A, 'account'], [B, 'contact']]);
            // The item ALPHA's slot holds: its customization when that was saved last, else its own body.
            const alphaItem = order === 'A, B, then the package-less save' ? 'custom' : 'alpha';
            expect((await manager.get('action', 'approve', A))?.label).toBe(alphaItem);
            // The route judges that very item and runs ALPHA's handler.
            expect(await judgedAndRun('account')).toEqual({ judged: alphaItem, refusal: undefined, degraded: undefined, run: `ran ${A}` });
            expect(await judgedAndRun('contact')).toEqual({ judged: 'beta', refusal: undefined, degraded: undefined, run: `ran ${B}` });
        });
    }

    it('single holder on another object: beside BETA\'s `contact` binding alone, the package-less save on `account` is stored as the environment\'s own row', async () => {
        const { rowEngine, rows } = writableEngine();
        await save(rowEngine, B, 'contact', 'beta');
        await save(rowEngine, undefined, 'account', 'custom');
        expect(storedRowsOf(rows)).toEqual([[B, 'contact'], [null, 'account']]);
        install(B);
        ship(B, 'contact');
        engine.registerAction('contact', 'approve', () => `ran ${B}`, `app:${B}`);
        await boot(rowEngine, rows);
        const onAccount = await routeTo('account');
        expect([onAccount.action?.label, onAccount.packageId, onAccount.refusal, onAccount.degraded]).toEqual(['custom', undefined, undefined, undefined]);
    });

    /**
     * [#32681, second half] The unscoped plural read the boot pass registers
     * counts an action name's holders per `(object, name)` too: a package-less
     * row bound to an object no package binds the name to is the
     * environment's own entry, registered beside the holder's item. So after
     * the pass the registry holds both, a read naming the holder answers its
     * own item, and the package-less row's route judges that row and runs the
     * environment's handler.
     *
     * BEFORE (main `fc283d6d97`, the metadata fix reverted and rebuilt): the
     * pass registered one of the two rows (the one saved last), so the
     * registry held one key, and with the package-less row saved last a read
     * naming the holder answered it (`custom`).
     *
     * Not pinned here: the holder's own route. Its declaration read (the
     * protocol's execution face, `getMetaItemForExecution`) answers the
     * environment's item on the other object beside one package holder, so
     * that route judges no declaration, before and after this change alike
     * (measured both ways); the execution face is carried separately.
     */
    const SHAPES = [
        { shape: 'mirror shape: A on account, a package-less row on contact', holder: A, held: 'account', label: 'alpha', other: 'contact' },
        { shape: 'single holder: B on contact, a package-less row on account', holder: B, held: 'contact', label: 'beta', other: 'account' },
    ] as const;
    for (const { shape, holder, held, label, other } of SHAPES) {
        for (const order of ['the package-less save last', 'the package-less save first'] as const) {
            it(`${shape} (${order}): after the pass the registry holds both items, a read naming the holder answers its own, and the package-less row's route judges and runs that one item`, async () => {
                const { rowEngine, rows } = writableEngine();
                if (order === 'the package-less save last') {
                    await save(rowEngine, holder, held, label);
                    await save(rowEngine, undefined, other, 'custom');
                } else {
                    await save(rowEngine, undefined, other, 'custom');
                    await save(rowEngine, holder, held, label);
                }
                expect(storedRowsOf(rows).sort()).toEqual([[holder, held], [null, other]].sort());
                install(holder);
                ship(holder, held);
                engine.registerAction(held, 'approve', () => `ran ${holder}`, `app:${holder}`);
                engine.registerAction(other, 'approve', () => 'ran env');
                const manager = await boot(rowEngine, rows);
                const keys = [...manager.registry.get('action').keys()].map((key: string) => key.replace(/\u0000/g, '|').replace(/\u0001/g, '>')).sort();
                expect(keys).toEqual([`${holder}|${held}>approve`, `${other}>approve`].sort());
                expect((await manager.get('action', 'approve', holder))?.label).toBe(label);
                expect(await judgedAndRun(other)).toEqual({ judged: 'custom', refusal: undefined, degraded: undefined, run: 'ran env' });
            });
        }
    }
    /**
     * [#33456, ADR-0150 D4] …and that row's item is served as the
     * environment's: the bare read's artifact envelope names a package only
     * for the item that package holds at its own `(object, name)`, so the
     * holder's `account` artifact lends nothing to the `contact` row (mirror)
     * and BETA's `contact` artifact nothing to the `account` row (cell). On
     * the execution face, the served face, and the declaration the row's
     * route judges; the holder's exact address keeps its own envelope.
     *
     * BASE (main 1e65a389e1, the owner-key rule ablated in
     * `lookupArtifactItem` and rebuilt): each of those three answered the
     * package-less row under the holder's `_packageId` and `_provenance:
     * 'package'`, while the route's `packageId` stayed unset and the
     * environment's handler ran.
     *
     * Still not pinned: the holder's own route, which judges no declaration
     * on this host before and after (the note above). The CONTROL, one
     * package and the package-less row on one object, reads the same before
     * and after: its customization, under the package's envelope.
     */
    const envelopeOf = (item: any) => (item ? [item.label, item.objectName, item._packageId, item._provenance === 'package'] : item);
    const stored = async (holder: string, held: string, other: string, order: 'the package-less save last' | 'the package-less save first') => {
        const { rowEngine, rows } = writableEngine();
        const saves = [() => save(rowEngine, holder, held, holder === A ? 'alpha' : 'beta'), () => save(rowEngine, undefined, other, 'custom')];
        for (const step of order === 'the package-less save last' ? saves : [...saves].reverse()) await step();
        install(holder);
        ship(holder, held);
        engine.registerAction(held, 'approve', () => `ran ${holder}`, `app:${holder}`);
        if (other !== held) engine.registerAction(other, 'approve', () => 'ran env');
        await boot(rowEngine, rows);
    };
    for (const { shape, holder, held, label, other } of SHAPES) {
        for (const order of ['the package-less save last', 'the package-less save first'] as const) {
            it(`[#33456] ${shape} (${order}): the package-less row is served as the environment's on both faces and on its route, never under the holder's envelope`, async () => {
                await stored(holder, held, other, order);
                const environment = ['custom', other, undefined, false];
                expect(envelopeOf((await protocol.getMetaItemForExecution({ type: 'action', name: 'approve' }) as any)?.item)).toEqual(environment);
                expect(envelopeOf((await protocol.getMetaItem({ type: 'action', name: 'approve' }) as any)?.item)).toEqual(environment);
                const route = await routeTo(other);
                expect([...envelopeOf(route.action), route.packageId]).toEqual([...environment, undefined]);
                expect((await judgedAndRun(other)).run).toBe('ran env');
                // CONTROL: the holder's exact address keeps its own item and envelope.
                expect(envelopeOf((await protocol.getMetaItemForExecution({ type: 'action', name: 'approve', packageId: holder }) as any)?.item))
                    .toEqual([label, held, holder, true]);
            });
        }
    }
    for (const order of ['the package-less save last', 'the package-less save first'] as const) {
        it(`[#33456] CONTROL — A and the package-less row both on \`account\` (${order}): its customization, under A's envelope, unchanged`, async () => {
            await stored(A, 'account', 'account', order);
            // One row: the package-less save is A's `account` row; its content is the save made last.
            const label = order === 'the package-less save last' ? 'custom' : 'alpha';
            for (const face of ['getMetaItemForExecution', 'getMetaItem'] as const) {
                expect(envelopeOf(((await (protocol as any)[face]({ type: 'action', name: 'approve' })) as any)?.item), face).toEqual([label, 'account', A, true]);
            }
            expect(await judgedAndRun('account')).toEqual({ judged: label, refusal: undefined, degraded: undefined, run: `ran ${A}` });
        });
    }
});

/**
 * ADR-0150 D4: executing an action resolves the action its own package
 * declared on its owner key, never a same-named action of another object, and
 * the gates run on that resolved declaration. A package-less action on
 * another object is the environment's own item (or the platform's), never the
 * customization of the one package that holds the name.
 *
 * Each pin was ablated once (the owner-key test removed from the registry
 * binding, rebuilt, the pin read red, restored and rebuilt); the readings are
 * in the PR body.
 */
describe('ADR-0150 D4 — the action route resolves the declaration its own package declared on its owner key', () => {
    const shipAt = (packageId: string | undefined, label: string, objectName: string | undefined, requiredPermissions: string[]) =>
        engine.registry.registerItem('action', {
            name: 'approve', label, type: 'script', ...(objectName ? { objectName } : {}), target: 'approve', requiredPermissions,
            body: { language: 'js', source: 'return 1;', capabilities: [] },
        } as never, 'name' as never, packageId);
    const storeEnvironmentRow = (objectName: string) => {
        storedRows = [{
            id: 'env-approve', type: 'action', name: 'approve', state: 'active', package_id: null,
            metadata: JSON.stringify({ name: 'approve', label: 'env', type: 'script', objectName, requiredPermissions: ['env_gate'] }),
        }];
    };
    const routeTo = (objectName: string, callerPackageId?: string) => resolveRouteActionDeclaration(deps, { request: {} } as any, {
        ql: engine, objectName, actionName: 'approve', ...(callerPackageId !== undefined ? { callerPackageId } : {}),
    });
    const answerOf = (d: Awaited<ReturnType<typeof routeTo>>) =>
        [d.refusal?.reason, d.degraded, d.packageId, d.action?.label, d.action?.requiredPermissions];
    /** A on `account`, P depending on A, and a package-less `approve` on `contact` (the environment's, or the platform's). */
    const compose = (whose: 'env' | 'platform', packagelessFirst: boolean) => {
        install(A);
        install(P, [A]);
        const packageless = () => shipAt(undefined, whose, 'contact', [`${whose}_gate`]);
        if (packagelessFirst) packageless();
        shipAt(A, 'alpha', 'account', ['alpha_gate']);
        if (!packagelessFirst) packageless();
        if (whose === 'env') storeEnvironmentRow('contact');
        engine.registerAction('account', 'approve', () => `ran ${A}`, `app:${A}`);
        engine.registerAction('contact', 'approve', () => 'ran package-less', 'metadata-service');
    };
    const COMPOSITIONS = (['env', 'platform'] as const).flatMap((whose) =>
        [false, true].map((packagelessFirst) => ({ whose, packagelessFirst, name: `${whose} on contact, registered ${packagelessFirst ? 'first' : 'last'}` })));

    for (const { whose, packagelessFirst, name } of COMPOSITIONS) {
        it(`${name}: a caller of A, or of a package depending on A, resolves A's own declaration on account under A's coordinate and runs A's handler (BASE: the declaration came back with no package)`, async () => {
            compose(whose, packagelessFirst);
            for (const caller of [A, P]) {
                const declaration = await routeTo('account', caller);
                expect(answerOf(declaration), caller).toEqual([undefined, undefined, A, 'alpha', ['alpha_gate']]);
                expect(await executeRegisteredAction(deps, engine, 'account', ['approve'], {}, declaration.packageId), caller)
                    .toEqual({ dispatched: true, result: `ran ${A}` });
            }
        });

        it(`${name}: a package caller on contact is refused naming the package-less holder, never answered as A's (BASE: no declaration under A's coordinate)`, async () => {
            compose(whose, packagelessFirst);
            for (const caller of [A, P]) {
                const declaration = await routeTo('contact', caller);
                expect(answerOf(declaration), caller).toEqual(['outside-closure', undefined, undefined, undefined, undefined]);
                expect(declaration.refusal?.candidates, caller).toEqual([{ kind: 'environment' }]);
            }
        });

        it(`${name}: CONTROL — a caller naming no package keeps each route's own declaration and its gates`, async () => {
            compose(whose, packagelessFirst);
            expect(answerOf(await routeTo('account'))).toEqual([undefined, undefined, undefined, 'alpha', ['alpha_gate']]);
            expect(answerOf(await routeTo('contact'))).toEqual([undefined, undefined, undefined, whose, [`${whose}_gate`]]);
        });
    }

    it('CONTROL — a package-less action on A\'s own object is A\'s customization for A\'s caller, as before', async () => {
        install(A);
        shipAt(A, 'alpha', 'account', ['alpha_gate']);
        shipAt(undefined, 'env', 'account', ['env_gate']);
        storeEnvironmentRow('account');
        const declaration = await routeTo('account', A);
        expect([declaration.refusal, declaration.packageId]).toEqual([undefined, A]);
    });
});

/**
 * [ADR-0150 D4] An action is identified by `(owner, owning object, name)`, so
 * the platform's package-less `approve` bound to `lead` and the environment's
 * object-less `approve` are two items under two keys. Binding first, then
 * owner: `/actions/lead/approve` serves the platform's `lead`-bound item, the
 * environment's object-less item serves every other route, and the
 * environment changes `lead` by authoring an item bound to `lead` (one key,
 * the environment's item). On every route the declaration the gates judge and
 * the handler the dispatch runs are one item's, in both registration orders,
 * beside no package holder, one, or two elsewhere.
 */
describe('ADR-0150 D4 — a route serves the package-less action on its own key, and runs that item\'s handler', () => {
    /** A fresh engine whose `find` reads the environment's store, as one kernel's engine does. */
    const freshEngine = () => {
        engine = new ObjectQL();
        engine.registry.logLevel = 'silent';
        (protocol as any).engine.registry = engine.registry;
        storedRows = [];
        (engine as any).find = async (object: string, query: any) => {
            if (object !== 'sys_metadata') return [];
            const where: Record<string, any> = query?.where ?? {};
            return storedRows.filter((row) => Object.keys(where).every((field) => {
                if (field.startsWith('$')) throw new Error(`engine store double: combinator ${field} is not implemented`);
                return row[field] === where[field];
            }));
        };
    };
    const body = { language: 'js', source: 'return 1;', capabilities: [] };
    /** The platform's `approve` bound to `lead` (code registering with no package), and its handler there. */
    const platformOnLead = () => {
        engine.registry.registerItem('action', {
            name: 'approve', label: 'platform', type: 'script', objectName: 'lead', target: 'approve',
            requiredPermissions: ['platform_gate'], body,
        } as never, 'name' as never);
        engine.registerAction('lead', 'approve', () => 'ran platform', 'plugin.platform');
    };
    /** The environment's own `approve` (object-less, or bound): registered, its row stored, its handler bound by the resync (the harness's row store answers no single row, so the item carries no stored-row stamp). */
    const environmentItem = (objectName?: string) => {
        const def = { name: 'approve', label: 'env', type: 'script', ...(objectName ? { objectName } : {}), requiredPermissions: ['env_gate'] };
        engine.registry.registerItem('action', { ...def, body } as never, 'name' as never);
        storedRows = [{ id: 'env-approve', type: 'action', name: 'approve', state: 'active', package_id: null, metadata: JSON.stringify(def) }];
        engine.registerAction(objectName ?? 'global', 'approve', () => 'ran env', 'metadata-service');
    };
    /** `count` package holders elsewhere, each with its handler: A on `account`, B on `contact`. */
    const holdersElsewhere = (count: number) => {
        [A, B].forEach((id) => install(id));
        for (const [id, objectName] of [[A, 'account'], [B, 'contact']].slice(0, count)) {
            ship(id, objectName);
            engine.registerAction(objectName, 'approve', () => `ran ${id}`, `app:${id}`);
        }
    };
    const bothOrders = (steps: Array<() => unknown>): Array<[string, () => void]> => [
        ['registered in order', () => steps.forEach((step) => step())],
        ['registered in reverse', () => [...steps].reverse().forEach((step) => step())],
    ];
    const onlyEnvGate = { userId: 'u1', systemPermissions: ['env_gate'] };
    const bothGates = { userId: 'u2', systemPermissions: ['env_gate', 'platform_gate'] };
    /** The route's declaration, the D4 gate and the owner gate on it for `ec`, and the handler its dispatch runs. */
    const call = async (objectName: string, ec: any) => {
        const declaration = await resolveRouteActionDeclaration(deps, { request: {} } as any, { ql: engine, objectName, actionName: 'approve' });
        const action = declaration.action;
        const gate = action ? actionPermissionRefusal(deps, action, ec, objectName) : undefined;
        const ownerGate = action ? await actionHandlerOwnerRefusal(deps, { request: {} } as any, {
            ql: engine, action, objectName, candidates: resolveActionHandlerKeys(action, 'approve'), ec,
        }) : undefined;
        const run = await executeRegisteredAction(deps, engine, objectName, resolveActionHandlerKeys(action ?? {}, 'approve'), {}, declaration.packageId);
        return { label: action?.label, requiredPermissions: action?.requiredPermissions, gate, ownerGate, result: run.result };
    };

    for (const elsewhere of [0, 1]) {
        it(`${elsewhere} package holder(s) elsewhere: \`/actions/lead/approve\` serves the platform's \`lead\`-bound item and runs its handler, in both registration orders`, async () => {
            for (const [order, register] of bothOrders([platformOnLead, () => environmentItem()])) {
                freshEngine();
                holdersElsewhere(elsewhere);
                register();
                const admitted = await call('lead', bothGates);
                expect([admitted.label, admitted.requiredPermissions, admitted.gate, admitted.ownerGate, admitted.result], order)
                    .toEqual(['platform', ['platform_gate'], null, undefined, 'ran platform']);
            }
        });

        it(`${elsewhere} package holder(s) elsewhere: the platform item's \`requiredPermissions\` gate \`/actions/lead/approve\` in both registration orders`, async () => {
            for (const [order, register] of bothOrders([platformOnLead, () => environmentItem()])) {
                freshEngine();
                holdersElsewhere(elsewhere);
                register();
                const refused = await call('lead', onlyEnvGate);
                expect([refused.gate?.code, refused.gate?.status], order).toEqual(['PERMISSION_DENIED', 403]);
                expect(refused.gate?.message, order).toContain('platform_gate');
            }
        });

    }

    for (const elsewhere of [0, 1, 2]) {
        it(`${elsewhere === 0 ? 'CONTROL — ' : ''}${elsewhere} package holder(s) elsewhere: the environment's object-less item serves every other route and runs its own handler, in both registration orders`, async () => {
            for (const [order, register] of bothOrders([platformOnLead, () => environmentItem()])) {
                freshEngine();
                holdersElsewhere(elsewhere);
                register();
                for (const route of ['opportunity', 'global']) {
                    const served = await call(route, onlyEnvGate);
                    expect([served.label, served.requiredPermissions, served.gate, served.ownerGate, served.result], `${order}, ${route}`)
                        .toEqual(['env', ['env_gate'], null, undefined, 'ran env']);
                }
            }
        });
    }

    it('two package holders elsewhere: `/actions/lead/approve` answers what the platform\'s `lead`-bound item alone answers there (no declaration, the bare route\'s answer beside two holders), never the environment\'s object-less item, in both registration orders', async () => {
        for (const [order, register] of bothOrders([platformOnLead, () => environmentItem()])) {
            freshEngine();
            holdersElsewhere(2);
            register();
            const onLead = await resolveRouteActionDeclaration(deps, { request: {} } as any, { ql: engine, objectName: 'lead', actionName: 'approve' });
            expect([onLead.action, onLead.refusal, onLead.degraded], order).toEqual([undefined, undefined, undefined]);
        }
    });

    it('CONTROL — one key keeps one item: the environment\'s item bound to `lead`, registered after the platform\'s there, wins on `lead` and runs its own handler', async () => {
        for (const elsewhere of [0, 1, 2]) {
            freshEngine();
            holdersElsewhere(elsewhere);
            platformOnLead();
            environmentItem('lead');
            const served = await call('lead', onlyEnvGate);
            expect([served.label, served.requiredPermissions, served.gate, served.result], `${elsewhere} elsewhere`)
                .toEqual(['env', ['env_gate'], null, 'ran env']);
        }
    });

    it('CONTROL — the platform\'s `lead`-bound item alone serves `lead` and no other route', async () => {
        for (const elsewhere of [0, 1]) {
            freshEngine();
            holdersElsewhere(elsewhere);
            platformOnLead();
            const lead = await call('lead', bothGates);
            expect([lead.label, lead.result], `${elsewhere} elsewhere`).toEqual(['platform', 'ran platform']);
            expect((await call('opportunity', bothGates)).label, `${elsewhere} elsewhere`).toBeUndefined();
        }
    });

    it('the environment\'s address: `/actions/_env/lead/approve` is the platform item\'s key, `404`, and every other route serves the environment\'s object-less item and runs its handler, in both registration orders', async () => {
        const envAddress = (objectName: string) => resolveAddressedRouteActionDeclaration(deps, { request: {} } as any, {
            ql: engine, objectName, actionName: 'approve', qualifier: { environment: true },
        });
        for (const elsewhere of [0, 1]) {
            for (const [order, register] of bothOrders([platformOnLead, () => environmentItem()])) {
                freshEngine();
                holdersElsewhere(elsewhere);
                register();
                const at = `${elsewhere} elsewhere, ${order}`;
                const err = await envAddress('lead').then(() => undefined, (e: any) => e);
                expect([err?.code, err?.status], at).toEqual(['RESOURCE_NOT_FOUND', 404]);
                const served = await envAddress('opportunity');
                expect(served.action?.label, at).toBe('env');
                expect(await executeRegisteredAction(deps, engine, 'opportunity', ['approve'], {}, served.packageId), at)
                    .toEqual({ dispatched: true, result: 'ran env' });
            }
        }
    });

    it('CONTROL — the environment\'s object-less item alone serves `lead` and every other route', async () => {
        for (const elsewhere of [0, 1]) {
            freshEngine();
            holdersElsewhere(elsewhere);
            environmentItem();
            for (const route of ['lead', 'opportunity']) {
                const served = await call(route, onlyEnvGate);
                expect([served.label, served.gate, served.result], `${elsewhere} elsewhere, ${route}`).toEqual(['env', null, 'ran env']);
            }
        }
    });
});

/**
 * ADR-0150 D4 — the declaration an action route gates on and the handler it
 * runs are ONE item's. The environment's own `approve` bound to `lead` (its
 * stored row, and the handler the authored-action resync binds for it) and the
 * platform's package-less `approve` bound to `lead` (host code, or a plugin)
 * hold one key: the dispatch runs the handler of the item the route serves, or
 * refuses, and never runs the other item's. Also with `lead` registered, where
 * the object serves the environment's item inside its own `actions`, at the
 * bare route, the `_env` address and MCP `run_action`.
 *
 * Real: `ObjectQL` (registry and action engine), the protocol's execution
 * read, the runtime's `HttpDispatcher` `/actions` door and the admitted
 * sequence every door shares. Doubled: the row store under the protocol, the
 * engine's store read (`storedRows` for both), and the caller's execution
 * context.
 */
describe('ADR-0150 D4 — an action route runs the handler of the item whose declaration it gated on', () => {
    const PREFIX = '/api/v1';
    const body = { language: 'js', source: 'return 1;', capabilities: [] };
    /** Which handlers ran, in order. */
    let ran: string[] = [];
    /** The engine's store read fails while set. */
    let storeDown = false;

    const freshEngine = () => {
        engine = new ObjectQL();
        engine.registry.logLevel = 'silent';
        (protocol as any).engine.registry = engine.registry;
        storedRows = [];
        ran = [];
        storeDown = false;
        (engine as any).find = async (object: string, query: any) => {
            if (object !== 'sys_metadata') return [];
            if (storeDown) throw new Error('store unreachable');
            const where: Record<string, any> = query?.where ?? {};
            return storedRows.filter((row) => Object.keys(where).every((field) => {
                if (field.startsWith('$')) throw new Error(`engine store double: combinator ${field} is not implemented`);
                return row[field] === where[field];
            }));
        };
    };
    /** The environment's own `approve` bound to `lead`: its item, its stored row, and the handler the resync binds for it. */
    const environmentOnLead = (extra: Record<string, unknown> = {}, stamp: Record<string, unknown> = {}) => {
        const def = { name: 'approve', label: 'env', type: 'script', objectName: 'lead', requiredPermissions: ['env_gate'], body, ...extra };
        engine.registry.registerItem('action', { ...def, ...stamp } as never, 'name' as never);
        storedRows = [{ id: 'env-approve', type: 'action', name: 'approve', state: 'active', package_id: null, metadata: JSON.stringify(def) }];
        engine.registerAction('lead', 'approve', () => { ran.push('env'); return 'ran env'; }, 'metadata-service');
    };
    /** The platform's package-less `approve` bound to `lead` (host code with no owner, or a plugin), and its handler. */
    const platformItemOnLead = () => {
        engine.registry.registerItem('action', {
            name: 'approve', label: 'platform', type: 'script', objectName: 'lead', target: 'approve',
            requiredPermissions: ['platform_gate'],
        } as never, 'name' as never);
    };
    const platformHandlerOnLead = (owner?: string) => {
        engine.registerAction('lead', 'approve', () => { ran.push('platform'); return 'ran platform'; }, owner);
    };
    const platformOnLead = (owner?: string) => {
        platformItemOnLead();
        platformHandlerOnLead(owner);
    };
    const onlyEnvGate = { userId: 'u_env', isSystem: false, systemPermissions: ['env_gate'] };
    const onlyPlatformGate = { userId: 'u_platform', isSystem: false, systemPermissions: ['platform_gate'] };

    /** `POST /api/v1/<path>` through the runtime's dispatcher, as the caller `ec`. */
    const post = async (path: string, ec: Record<string, unknown>, extraServices: Record<string, unknown> = {}) => {
        const services: Record<string, unknown> = { objectql: engine, data: engine, protocol, ...extraServices };
        const get = (name: string) => services[name] ?? null;
        const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (name: string) => get(name) };
        const dispatcher = new HttpDispatcher(kernel);
        (dispatcher as any).timedResolveExecutionContext = async () => ({ ...ec });
        const request = new Request(`http://localhost${PREFIX}${path}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        });
        const res: any = await dispatcher.dispatch('POST', path, {}, {}, { request } as any, PREFIX);
        return res.response as { status: number; body: any };
    };

    for (const [who, owner] of [['host code', undefined], ['a plugin', 'plugin.platform']] as const) {
        for (const route of ['/actions/lead/approve', '/actions/_env/lead/approve']) {
            it(`${route}: the environment's own action runs its own handler, not the one ${who} holds on its key`, async () => {
                freshEngine();
                environmentOnLead();
                platformOnLead(owner);
                const response = await post(route, onlyEnvGate);
                expect([response.status, response.body?.data], JSON.stringify(response.body)).toEqual([200, 'ran env']);
                expect(ran).toEqual(['env']);
            });
        }

        it(`the environment's own action gates on its own requirements, and a caller it refuses runs no handler (${who} on its key)`, async () => {
            freshEngine();
            environmentOnLead();
            platformOnLead(owner);
            const response = await post('/actions/lead/approve', onlyPlatformGate);
            expect([response.status, response.body?.error?.code], JSON.stringify(response.body)).toEqual([403, 'PERMISSION_DENIED']);
            expect(ran).toEqual([]);
        });
    }

    it('a dispatch whose declared item has no handler of its own left when it runs answers the route\'s routing miss, 404, and runs no other handler', async () => {
        freshEngine();
        environmentOnLead();
        platformOnLead('plugin.platform');
        const declaration = await resolveRouteActionDeclaration(deps, { request: {} } as any, { ql: engine, objectName: 'lead', actionName: 'approve' });
        expect(declaration.action).toMatchObject({ label: 'env' });
        const ctx: any = { request: {}, executionContext: { ...onlyEnvGate } };
        const wiring = {
            ...requestContextWiring(deps, ctx, engine),
            // The subject load is the admission's last step: the environment's handler is withdrawn there.
            callData: async () => {
                engine.removeActionsByPackage('metadata-service');
                return { record: { id: 'lead_1' } };
            },
        };
        const run: any = await runResolvedAction(deps, ctx, {
            posture: 'rest', door: 'rest', objectName: 'lead', actionName: 'approve', declaration,
            body: { recordId: 'lead_1' }, ql: engine, wiring,
        } as any);
        expect(run.outcome, JSON.stringify(run)).toMatchObject({ kind: 'refused', refusal: { status: 404 } });
        expect(ran).toEqual([]);
    });

    it('a store read that fails while the dispatch attributes the handler refuses 503, and runs no handler', async () => {
        freshEngine();
        environmentOnLead();
        platformOnLead('plugin.platform');
        storeDown = true;
        const response = await post('/actions/lead/approve', onlyEnvGate);
        expect([response.status, response.body?.error?.code], JSON.stringify(response.body)).toEqual([503, 'SERVICE_UNAVAILABLE']);
        expect(ran).toEqual([]);
    });

    it('CONTROL — the environment\'s own action registered after the platform\'s runs its own handler', async () => {
        freshEngine();
        platformOnLead('plugin.platform');
        environmentOnLead();
        const response = await post('/actions/lead/approve', onlyEnvGate);
        expect([response.status, response.body?.data], JSON.stringify(response.body)).toEqual([200, 'ran env']);
        expect(ran).toEqual(['env']);
    });

    it('CONTROL — a single holder runs its own handler: the environment\'s action alone, and the platform\'s alone under its own requirements', async () => {
        freshEngine();
        environmentOnLead();
        expect((await post('/actions/lead/approve', onlyEnvGate)).body?.data).toBe('ran env');
        for (const owner of [undefined, 'plugin.platform']) {
            freshEngine();
            platformOnLead(owner);
            expect((await post('/actions/lead/approve', onlyEnvGate)).status).toBe(403);
            const response = await post('/actions/lead/approve', onlyPlatformGate);
            expect([response.status, response.body?.data], JSON.stringify(response.body)).toEqual([200, 'ran platform']);
            expect(ran).toEqual(['platform']);
        }
    });

    describe('with the routed object registered, and the environment\'s action served inside it', () => {
        const registeredLead = () => engine.registry.registerObject({
            name: 'lead', label: 'Lead', fields: { name: { name: 'name', type: 'text', label: 'Name' } },
        } as never, 'com.acme.crm');
        /**
         * The platform's item registers first; the environment's row is hydrated
         * after it (the hydration's `_provenance` stamp) with the handler the
         * resync binds; the platform's handler registers last.
         */
        const setUp = async (owner?: string) => {
            freshEngine();
            registeredLead();
            platformItemOnLead();
            environmentOnLead({ ai: { exposed: true, description: 'Approve a lead.' } }, { _provenance: 'org' });
            platformHandlerOnLead(owner);
            // The composition: the object's served `actions` carry the environment's item.
            expect((engine.getSchema('lead') as any)?.actions?.find((a: any) => a?.name === 'approve')).toMatchObject({ label: 'env' });
        };
        /** MCP `run_action` over the protocol's merged listings, as the bridge wires it. */
        const runViaMcp = (ec: Record<string, unknown>) => invokeBusinessAction(deps, { request: {} } as any, 'approve', { objectName: 'lead' }, {
            driver: engine, ec, getMeta: () => undefined,
            readObjects: () => readMergedItems(protocol, 'object'),
            readActions: () => readMergedItems(protocol, 'action'),
            callData: async () => ({}),
        } as any);

        for (const [who, owner] of [['host code', undefined], ['a plugin', 'plugin.platform']] as const) {
            for (const route of ['/actions/lead/approve', '/actions/_env/lead/approve']) {
                it(`${route}: the environment's own action runs its own handler, not the one ${who} holds on its key`, async () => {
                    await setUp(owner);
                    const response = await post(route, onlyEnvGate);
                    expect([response.status, response.body?.data], JSON.stringify(response.body)).toEqual([200, 'ran env']);
                    expect(ran).toEqual(['env']);
                });
            }

            it(`MCP run_action: the environment's own action runs its own handler, not the one ${who} holds on its key`, async () => {
                await setUp(owner);
                const answer: any = await runViaMcp(onlyEnvGate);
                expect([answer?.ok, answer?.result], JSON.stringify(answer)).toEqual([true, 'ran env']);
                expect(ran).toEqual(['env']);
            });
        }
    });

    describe('the platform\'s action beside a handler whose environment item neither the store nor the metadata service holds any more', () => {
        /** The platform's item and handler, then the environment's (its handler on top), then its row deleted: the slot serves the platform's item. */
        const setUp = (owner?: string) => {
            freshEngine();
            platformOnLead(owner);
            environmentOnLead();
            storedRows = [];
            platformItemOnLead();
        };

        for (const [who, owner] of [['host code', undefined], ['a plugin', 'plugin.platform']] as const) {
            it(`runs the platform's own handler (${who}), gated on its own requirements`, async () => {
                setUp(owner);
                expect((await post('/actions/lead/approve', onlyEnvGate)).status).toBe(403);
                const response = await post('/actions/lead/approve', onlyPlatformGate, { metadata: { loadMany: async () => [] } });
                expect([response.status, response.body?.data], JSON.stringify(response.body)).toEqual([200, 'ran platform']);
                expect(ran).toEqual(['platform']);
            });
        }

        it('a metadata service read that fails while the dispatch attributes the handler refuses 503, and runs no handler', async () => {
            setUp('plugin.platform');
            const response = await post('/actions/lead/approve', onlyPlatformGate, {
                metadata: { loadMany: async () => { throw new Error('metadata service unreachable'); } },
            });
            expect([response.status, response.body?.error?.code], JSON.stringify(response.body)).toEqual([503, 'SERVICE_UNAVAILABLE']);
            expect(ran).toEqual([]);
        });
    });

    it('CONTROL — the platform\'s action, with no stored row of the environment\'s on its key, runs its own handler beside a handler the environment\'s slot still holds', async () => {
        freshEngine();
        environmentOnLead();
        storedRows = [];
        platformOnLead('plugin.platform');
        const response = await post('/actions/lead/approve', onlyPlatformGate);
        expect([response.status, response.body?.data], JSON.stringify(response.body)).toEqual([200, 'ran platform']);
        expect(ran).toEqual(['platform']);
    });
});
