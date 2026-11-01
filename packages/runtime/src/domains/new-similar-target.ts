// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28149, ADR-0146 D4] THE TARGET RULE of a "new similar" door — the one
 * judgement of a package a copy is asked to land in, shared by every door that
 * writes a copy of an item into a package (the flow clone door today, the
 * permission-set "new similar" door next). ⛔ No door re-spells it.
 *
 * ADR-0146 D4: "The door takes a target package: given, it must be an
 * installed **writable** package inside whose dependency closure the flow's
 * objects lie". Three refusals follow, each thrown before anything is
 * written (refuse first, then mutate), each an ADR-0112 error carrying its
 * `code` and `status`:
 *
 *  - **Not installed** — `422 WRITABLE_PACKAGE_REQUIRED`, the code the
 *    metadata save door answers for a save naming a package no registry
 *    holds (`uninstalledNamedBaseRefusal`, `@objectstack/metadata-protocol`):
 *    one condition, one code, at both doors.
 *  - **Read-only** — `422 WRITABLE_PACKAGE_REQUIRED`, ADR-0070 D2's one
 *    predicate ({@link isWritablePackage}), the code the save door and the
 *    `/packages` lifecycle routes answer for a write into a code- or
 *    platform-provided package.
 *  - **Outside the closure** — `409 RESOURCE_CONFLICT`: the target is
 *    writable, but its manifest declares no dependency path to the source's
 *    package, so the copy's references — the source's, which resolve inside
 *    the source package's closure — need not resolve from the target. The
 *    packages' declared state rules the target out, as the ensure door's
 *    `409` says of a base whose state rules its pair out.
 *
 * `DUPLICATE_SOURCE_NOT_A_BASE` (`domains/packages.ts`) is the neighbouring
 * family, and deliberately not this code: it says the SOURCE of a duplicate
 * is not a base, while every refusal here is about the TARGET. The shape is
 * that family's — a `[tag]` sentence, `packageId` and the ADR in the details
 * ({@link newSimilarTargetRefusalAnswer}).
 *
 * ## The closure
 *
 * `resolvePackageClosure` (`@objectstack/lint/runtime`), the ONE walk the
 * save door's publish gate (`resolveWritePackageScope`) and Studio's object
 * pickers use, over the same registry. A source with no package (an item
 * authored in the deployment) asks no closure question here: its references
 * are judged by the save into the target, as every save into a package is.
 *
 * Pure over the registry the `objectql` service carries; it writes nothing.
 */

import { isWritablePackage } from '@objectstack/metadata-protocol';
import { resolvePackageClosure } from '@objectstack/lint/runtime';
import type { HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';

/** The ADR the target rule is written in, named by every refusal it throws. */
const NEW_SIMILAR_DOCS = 'docs/adr/0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md';

/** An ADR-0112 refusal of a target package. */
export type NewSimilarTargetRefusal = Error & {
    code: 'WRITABLE_PACKAGE_REQUIRED' | 'RESOURCE_CONFLICT';
    status: number;
    statusCode: number;
    /** The target package refused, as `uninstalledNamedBaseRefusal` carries it. */
    packageId: string;
    docs: string;
};

/** The registry slice the rule reads. */
interface TargetRegistry {
    getPackage?(id: string): { manifest?: unknown } | undefined;
}

function refusal(
    code: NewSimilarTargetRefusal['code'],
    status: number,
    message: string,
    packageId: string,
): NewSimilarTargetRefusal {
    return Object.assign(new Error(message), { code, status, statusCode: status, packageId, docs: NEW_SIMILAR_DOCS });
}

/**
 * A door's answer for a {@link NewSimilarTargetRefusal}: its sentence, status
 * and code, with `packageId` and `docs` in the envelope's `details` — the
 * shape `requireDuplicableSource` and `requireWritablePackage`
 * (`domains/packages.ts`) answer, which `errorFromThrown` would drop.
 */
export function newSimilarTargetRefusalAnswer(
    deps: Pick<DomainHandlerDeps, 'error'>,
    refused: NewSimilarTargetRefusal,
): HttpDispatcherResult {
    return {
        handled: true,
        response: deps.error(refused.message, refused.status, {
            code: refused.code,
            packageId: refused.packageId,
            docs: refused.docs,
        }),
    };
}

/**
 * Why `target` cannot take a copy of `subject`, or `undefined` when it can.
 *
 * - `ql` — the `objectql` service: its `registry` answers which packages are
 *   installed, and with its `manifests` it is what {@link isWritablePackage}
 *   reads.
 * - `subject` — the copied item as the sentences name it (`flow 'x'`).
 * - `sourcePackageId` — the package the source belongs to, when it belongs
 *   to one; absent asks no closure question (see the module header).
 */
export function newSimilarTargetRefusal(
    ql: unknown,
    request: { target: string; subject: string; sourcePackageId?: string },
): NewSimilarTargetRefusal | undefined {
    const { target, subject, sourcePackageId } = request;
    const registry = (ql as { registry?: TargetRegistry } | null | undefined)?.registry;
    const getPackage = typeof registry?.getPackage === 'function'
        ? (id: string) => registry.getPackage!(id)
        : undefined;
    if (!getPackage?.(target)) {
        return refusal('WRITABLE_PACKAGE_REQUIRED', 422,
            `[new_similar_target_not_installed] Cannot land a copy of ${subject} in package '${target}': no package `
            + 'with that id is installed in this deployment. Name an installed writable package, or omit `package` '
            + 'to land the copy in the source\'s paired customization package. Nothing was written.',
            target);
    }
    if (!isWritablePackage(ql, target)) {
        return refusal('WRITABLE_PACKAGE_REQUIRED', 422,
            `[new_similar_target_read_only] Cannot land a copy of ${subject} in package '${target}': it is read-only `
            + '(provided by code or an installed app), and a copy is authored into a writable package. Name a '
            + 'writable package, or omit `package` to land the copy in the source\'s paired customization package '
            + '(ADR-0146 D3). Nothing was written.',
            target);
    }
    if (sourcePackageId !== undefined && sourcePackageId !== target) {
        const closure = resolvePackageClosure(target, (id) => getPackage(id));
        if (!closure?.dependencies.includes(sourcePackageId)) {
            return refusal('RESOURCE_CONFLICT', 409,
                `[new_similar_target_outside_closure] Cannot land a copy of ${subject} in package '${target}': `
                + `'${target}' declares no dependency on '${sourcePackageId}', the package ${subject} belongs to, `
                + 'so the copy\'s references to that package\'s items would not resolve from it. Declare the '
                + `dependency in '${target}'s manifest, name a package that depends on '${sourcePackageId}', or `
                + 'omit `package` to land the copy in the source\'s paired customization package. Nothing was '
                + 'written.',
                target);
        }
    }
    return undefined;
}
