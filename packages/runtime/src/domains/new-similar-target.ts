// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D3/D6] THE ONE CHECK OF A "NEW SIMILAR" DOOR'S GIVEN TARGET
 * PACKAGE — the permission-set clone door (`./permission-set-clone.ts`) and
 * the flow clone door ask it; ⛔ no door spells its own.
 *
 * A "new similar" copy is a new item of a package the customer can author
 * into. When the caller names that package (`package` in the door's body),
 * the target must be:
 *
 *  1. **installed and writable** — an id the package registry holds, and
 *     writable by ADR-0070 D2's one predicate (`isWritablePackage`,
 *     `@objectstack/metadata-protocol`). Unknown and read-only are one
 *     refusal, `422 WRITABLE_PACKAGE_REQUIRED`, the save door's own code for
 *     both: `isWritablePackage` alone answers "writable" for a bare id no
 *     registry holds (an ADR-0048 authoring workspace), and a copy must land
 *     in a package that exists, so installation is asked first;
 *  2. **able to reach what the copy references** — its dependency closure
 *     (`resolvePackageClosure`, `@objectstack/lint/runtime`: the one walk the
 *     save gate and Studio's pickers use) holds the source's package, and,
 *     when the door names the objects the copy grants on, every one of them
 *     survives the save gate's own closure predicate
 *     (`narrowObjectsToPackageClosure`: a platform/system object, an
 *     unpackaged one, or one owned inside the closure). Otherwise
 *     `409 RESOURCE_CONFLICT`, naming what is out of reach and the remedy (a
 *     declared dependency).
 *
 * Pure over the engine's registry: it writes nothing and resolves no default
 * target — each door decides its own default (the paired `<X>.custom`
 * through N-13's ensure door) and asks this only of a target its caller gave.
 */

import { narrowObjectsToPackageClosure, resolvePackageClosure } from '@objectstack/lint/runtime';
import { isWritablePackage } from '@objectstack/metadata-protocol';

/** The ADR-0146 record the refusals point at. */
const NEW_SIMILAR_TARGET_DOCS = 'docs/adr/0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md';

/** What a door asks about its caller's target. */
export interface NewSimilarTargetRequest {
    /** The package the caller named. */
    readonly target: string;
    /** The package that ships the source, when it has one (an environment-authored source has none). */
    readonly sourcePackageId?: string;
    /** The source, in words, for the sentences: `permission set 'crm_sales_rep'`, `flow 'x'`. */
    readonly subject: string;
    /**
     * The objects the copy grants on or reads, when the door can name them
     * from the item's own declaration; each must be reachable from the target.
     */
    readonly objects?: readonly string[];
}

/** The engine surface this check reads — the ObjectQL engine satisfies it as it stands. */
interface TargetEngine {
    manifests?: { has?(id: string): boolean };
    registry?: {
        getPackage?(id: string): { manifest?: unknown } | undefined;
        getObject?(name: string): unknown;
        getObjectOwner?(name: string): { packageId?: string } | undefined;
    };
}

function refusal(status: number, code: string, message: string, packageId: string): Error {
    return Object.assign(new Error(message), {
        status,
        statusCode: status,
        code,
        details: { code, packageId, docs: NEW_SIMILAR_TARGET_DOCS },
    });
}

/**
 * Why `request.target` cannot take the copy, as an ADR-0112 error (status +
 * code + `packageId` + `docs`), or `undefined` when it can.
 */
export function newSimilarTargetRefusal(engine: unknown, request: NewSimilarTargetRequest): Error | undefined {
    const { target, sourcePackageId, subject } = request;
    const e = engine as TargetEngine | null | undefined;
    const registry = e?.registry;
    const getPackage = (id: string) => registry?.getPackage?.call(registry, id);

    if (!getPackage(target) || !isWritablePackage(engine, target)) {
        const installed = getPackage(target) !== undefined;
        return refusal(
            422,
            'WRITABLE_PACKAGE_REQUIRED',
            `Cannot save the copy of ${subject} in package '${target}': `
            + (installed
                ? 'it is read-only (provided by code or an installed app), and a copy is a new item of a package you can author into. '
                : 'no package with that id is installed. ')
            + 'Name an installed, writable package, or leave `package` out to save the copy in the paired customization '
            + 'package of the package the original came from (ADR-0146 D3).',
            target,
        );
    }

    const closure = resolvePackageClosure(target, (id) => getPackage(id));
    const reachable = new Set<string>(closure ? [closure.packageId, ...closure.dependencies] : [target]);
    const outOfReach: string[] = [];
    if (sourcePackageId !== undefined && !reachable.has(sourcePackageId)) {
        outOfReach.push(`the package '${sourcePackageId}' the original comes from`);
    }
    if (request.objects && request.objects.length > 0) {
        const entries: Array<Record<string, unknown>> = [];
        for (const name of request.objects) {
            const object = registry?.getObject?.call(registry, name) as Record<string, unknown> | undefined;
            // An object no registry holds is the save's to judge, not this check's.
            if (!object) continue;
            entries.push({ name, isSystem: object.isSystem, _packageId: registry?.getObjectOwner?.call(registry, name)?.packageId });
        }
        const kept = new Set(narrowObjectsToPackageClosure(entries, closure));
        const dropped = entries.filter((entry) => !kept.has(entry));
        if (dropped.length > 0) {
            outOfReach.push(dropped.length === 1
                ? `object '${String(dropped[0].name)}' (package '${String(dropped[0]._packageId)}')`
                : `objects ${dropped.map((d) => `'${String(d.name)}' (package '${String(d._packageId)}')`).join(', ')}`);
        }
    }
    if (outOfReach.length === 0) return undefined;
    return refusal(
        409,
        'RESOURCE_CONFLICT',
        `Cannot save the copy of ${subject} in package '${target}': it cannot reach ${outOfReach.join(', and ')}. `
        + `A package references only itself, the packages its manifest declares in \`dependencies\` (and theirs), and `
        + `platform objects. Declare the dependency on '${target}', name a package that already declares it, or leave `
        + '`package` out to save the copy in the paired customization package of the package the original came from '
        + '(ADR-0146 D3).',
        target,
    );
}
