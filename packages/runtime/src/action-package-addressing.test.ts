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
});
