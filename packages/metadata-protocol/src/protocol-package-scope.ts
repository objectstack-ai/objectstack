// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 33] The package-scope answers, from
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole:
 *
 *  - `isWritablePackage` — whether a package id is a writable base;
 *  - `uninstalledNamedBaseRefusal` — the named-base rule: a base an authoring
 *    write names must be an installed package;
 *  - `shouldDropStorage` — whether a delete may drop a physical table;
 *  - `resolveAppPackageIdKey` — the app item read's package-id key.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps each method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link PackageScopeHost} members it reads, plus a `.call`; a body that
 * reads no member is called as a plain function. Fields are handed over as
 * getters, so each read finds the field as it stands at call time; each call
 * to another member is a closure, so it still reaches the class method. Every
 * caller keeps calling the class methods.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

// [#23183] The app item read's package-id key — the one spelling of the arm
// `GetMetaItemRequestSchema.name` declares ({@link resolveAppPackageIdKey}).
import { isAppPackageIdKey } from '@objectstack/spec/api';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
// [#7560] ADR-0070's read-only-package rule, shared with the `/packages`
// lifecycle gate in `@objectstack/runtime` — see `./package-writability.js`.
import { isWritablePackage as isWritablePackageShared } from './package-writability.js';
import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface PackageScopeHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly getMetaItems: ObjectStackProtocolImplementation['getMetaItems'];
    readonly reportedMultiAppPackages: ObjectStackProtocolImplementation['reportedMultiAppPackages'];
    readonly resolveWritePackageScope: ObjectStackProtocolImplementation['resolveWritePackageScope'];
}

/** The body of `ObjectStackProtocolImplementation#resolveAppPackageIdKey`; the method's docblock there is its contract. */
export async function resolveAppPackageIdKey<R extends {
    type: string, name: string, packageId?: string, state?: 'active' | 'draft', previewDrafts?: boolean,
}>(this: Pick<PackageScopeHost, 'getMetaItems' | 'reportedMultiAppPackages'>, request: R): Promise<R> {
    if (!isAppPackageIdKey(request.type, request.name)) return request;
    const packageId = request.name;
    if (request.packageId !== undefined && request.packageId !== packageId) {
        const err: any = new Error(
            `The app read's key '${packageId}' is a package id, and it names a different package `
            + `than packageId '${request.packageId}'. Name the package once: read the app by its `
            + `package id alone, or by its own app name with packageId as its scope.`,
        );
        err.code = 'INVALID_REQUEST';
        err.status = 400;
        throw err;
    }
    const readsDrafts = request.state === 'draft' || request.previewDrafts === true;
    const listed = await this.getMetaItems({
        type: 'app',
        packageId,
        ...(readsDrafts ? { previewDrafts: true } : {}),
    });
    const names = [...new Set(
        ((listed as { items?: unknown[] } | undefined)?.items ?? [])
            .map((app) => (app as { name?: unknown } | null)?.name)
            .filter((name): name is string => typeof name === 'string' && name.length > 0),
    )];
    if (names.length === 1) return { ...request, name: names[0], packageId };
    if (names.length > 1) {
        const key = `${packageId}|${[...names].sort().join(',')}`;
        if (!this.reportedMultiAppPackages.has(key)) {
            this.reportedMultiAppPackages.add(key);
            console.warn(
                `[metadata-protocol] Package '${packageId}' holds ${names.length} apps `
                + `(${[...names].sort().join(', ')}), so reading the app by its package id answers `
                + `"not found": with one app per package the app is the package container `
                + `(ADR-0048 §3.1), and a package may define at most one app (ADR-0019 D3). `
                + `Fold them into one app, or move all but one into packages of their own.`,
            );
        }
    }
    return request;
}

/** The body of `ObjectStackProtocolImplementation#uninstalledNamedBaseRefusal`; the method's docblock there is its contract. */
export function uninstalledNamedBaseRefusal(
    this: Pick<PackageScopeHost, 'resolveWritePackageScope'>,
    request: { type: string; name: string; packageId?: string | null },
    how: { verb?: 'save' | 'publish'; inherited?: boolean } = {},
): Error | null {
    const namedBase = request.packageId;
    if (!namedBase || namedBase === 'sys_metadata') return null;
    if (this.resolveWritePackageScope(namedBase) !== undefined) return null;
    const type = PLURAL_TO_SINGULAR[request.type] ?? request.type;
    // Kept under the REST door's client-message bound (`truncateClientMessage`)
    // for ordinary names, so the last sentence reaches the caller.
    const storedWayOut = `Create a package with that id first, or remove the rows bound to it (a delete naming `
        + `that package; discard-drafts for drafts) and save again, into an installed writable package or with `
        + `no package.`;
    const err = new Error(
        how.verb === 'publish'
            ? `Cannot publish ${type} '${request.name}' into package '${namedBase}': no package with that id `
                + `is installed in this deployment, so the ${type} would go live bound to a package that does `
                + `not exist. ${storedWayOut} Nothing was published.`
            : how.inherited
                ? `Cannot save ${type} '${request.name}' without naming a package: its stored rows are bound to `
                    + `package '${namedBase}', which is not installed in this deployment, and this save would `
                    + `extend that binding. ${storedWayOut} Nothing was written.`
                : `Cannot save ${type} '${request.name}' into package '${namedBase}': no package with that id is `
                    + `installed in this deployment, so the ${type} would be stored bound to a package that does not `
                    + `exist. Name an installed writable package as the ${type}'s base (or create one first), or save `
                    + `the ${type} without naming a package. Nothing was written.`,
    );
    (err as any).code = 'WRITABLE_PACKAGE_REQUIRED';
    (err as any).status = 422;
    (err as any).packageId = namedBase;
    (err as any).docs = 'docs/adr/0070-package-first-authoring.md';
    return err;
}

/** The body of `ObjectStackProtocolImplementation#isWritablePackage`; the method's docblock there is its contract. */
export function isWritablePackage(this: Pick<PackageScopeHost, 'engine'>, packageId: string | null | undefined): boolean {
    return isWritablePackageShared(this.engine, packageId);
}

/** The body of `ObjectStackProtocolImplementation#shouldDropStorage`; the method's docblock there is its contract. */
export function shouldDropStorage(type: string, name: string, dropStorage: boolean | undefined, state: 'active' | 'draft'): boolean {
    if (!dropStorage) return false;
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    if (singular !== 'object') return false;
    if (state !== 'active') return false;
    if (name.startsWith('sys_')) return false;
    return true;
}
