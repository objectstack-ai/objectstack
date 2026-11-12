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
 * The route (`/actions/:object/NAME`) sees the object, so it still takes the
 * declaration that owns it, the package-less one included.
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
            // Seat ruling B: the route keeps main's answers (see case 1).
            expect((await routeTo('contact')).action).toMatchObject({ label: 'beta' });
            expect((await routeTo('lead')).action).toMatchObject({ label: 'env', objectName: 'lead' });
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
