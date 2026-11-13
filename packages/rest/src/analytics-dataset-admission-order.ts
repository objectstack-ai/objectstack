// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { PackageScopedNameRefusedError, packageScopedRefusalMessage, type PackageScopedRefusal } from '@objectstack/core';
import { stripReadDecorations } from '@objectstack/spec/kernel';

/**
 * [#32292, ADR-0150 D3 after ADR-0149 D2] The refusal arm of the saved-dataset
 * read on `POST /analytics/dataset/query` (and each query of the batch door):
 * when the by-name read REFUSES a name, the door asks which of the refused
 * holders this caller is admitted to before it answers, as MCP `query_dataset`
 * does (epic ruling 6766102988, point 1: "The REST query door follows the same
 * order where it applies admission"). Once the door judges, a holder the caller
 * may not query does not exist for it, so it is never a candidate and never
 * named (the two arms that do not judge are at the end of this comment):
 *
 *  - ambiguity (`ambiguous-in-environment`, `ambiguous-in-closure`,
 *    `ambiguous-in-namespace`): none admitted answers what a missing name
 *    answers; exactly one runs that one; two or more are refused `409`, naming
 *    only those;
 *  - `outside-closure`, `not-held-by-qualifier`: these are not ambiguity, so
 *    nothing is ever picked; none admitted answers what a missing name
 *    answers, and otherwise the `409` names only the admitted holders;
 *  - a holder whose admission could not be judged may be one the caller can
 *    query: whenever it could change the answer, nothing runs (`503`). That
 *    includes a holder whose own exact-qualifier read refuses: its refusal is
 *    kept inside this arm and never answered.
 *
 * ⛔ Only the refusal arm (seat ruling 6817809380, Q1 = A). A name the read
 * RESOLVES keeps its answer: a caller not admitted to the one holder (or to the
 * caller package's own or closure item, Q2 = A) is still refused by
 * `queryDataset`'s own gates (`403`), never moved to `404`, and never falls
 * through to another package's item of the same name.
 *
 * Each candidate is read at its exact qualifier (`?package=`), so admission is
 * judged on the item that address serves, its bound overlay included: the item
 * that would run. An item that fails the dataset parse is refused for every
 * caller, so it is admitted to none (as `query_dataset` treats it).
 *
 * Two arms do not judge, and answer the original refusal, naming every holder
 * (`rethrow`): a service whose admission is not the plugin-wired set
 * (`hasPluginWiredAdmission`: a hand-built service's admission passes
 * everyone), and a refusal one of whose candidates is the environment or the
 * platform rather than a package.
 */
export type DatasetRefusalAdmission =
    /** Ask nothing: the original refusal is the answer. */
    | { readonly kind: 'rethrow' }
    /** No refused holder is admitted: the answer a missing name gets. */
    | { readonly kind: 'not-found' }
    /** Exactly one holder of an ambiguity is admitted: its read, run as the resolved item. */
    | { readonly kind: 'read'; readonly read: { readonly item: unknown } }
    /** The refusal over the admitted holders only. */
    | { readonly kind: 'refused'; readonly error: PackageScopedNameRefusedError }
    /** Whether a holder is admitted could not be judged, and it could move the answer. */
    | { readonly kind: 'undetermined' };

/** The analytics service's admission face, read structurally (this package carries no analytics code). */
interface DatasetAdmissionService {
    hasPluginWiredAdmission(): boolean;
    admitDatasetCatalogEntry(dataset: unknown, context?: unknown): Promise<{ readonly admitted: boolean; readonly unresolved: boolean }>;
}

function admissionServiceOf(svc: unknown): DatasetAdmissionService | undefined {
    const s = svc as Partial<DatasetAdmissionService> | null | undefined;
    return typeof s?.hasPluginWiredAdmission === 'function'
        && typeof s.admitDatasetCatalogEntry === 'function'
        && s.hasPluginWiredAdmission()
        ? (s as DatasetAdmissionService)
        : undefined;
}

/**
 * A package-scoped refusal by class OR by shape (`code` `RESOURCE_CONFLICT` with
 * a `refusal` whose `status` is `'refused'`), whatever its reason: the door's
 * `isPackageScopedRefusal` predicate, so a refusal from another copy of
 * `@objectstack/core` is caught here too.
 */
function isRefusal(e: unknown): boolean {
    if (e instanceof PackageScopedNameRefusedError) return true;
    const thrown = e as { code?: unknown; refusal?: { status?: unknown } } | null | undefined;
    return thrown?.code === 'RESOURCE_CONFLICT' && thrown.refusal?.status === 'refused';
}

const AMBIGUITY: ReadonlySet<PackageScopedRefusal['reason']> = new Set([
    'ambiguous-in-environment',
    'ambiguous-in-closure',
    'ambiguous-in-namespace',
]);

/**
 * Judge `refusal`'s holders for the caller in `context`. `readHolder` is the
 * door's exact-qualifier read of one holder. A refusal it throws, of any
 * reason and by class or by shape, leaves that holder undetermined; any other
 * throw is a failed read, which the door answers as it answers any (`503`), so
 * it is left to throw.
 */
export async function admitRefusedDatasetHolders(args: {
    readonly refusal: PackageScopedRefusal;
    readonly svc: unknown;
    readonly context: unknown;
    readonly readHolder: (packageId: string) => Promise<{ item?: unknown } | null | undefined>;
}): Promise<DatasetRefusalAdmission> {
    const { refusal, context, readHolder } = args;
    const service = admissionServiceOf(args.svc);
    if (!service) return { kind: 'rethrow' };
    const packageIds: string[] = [];
    for (const candidate of refusal.candidates) {
        // The environment and the platform hold no dataset beside a package
        // holder; a refusal naming one is answered as it is.
        if (candidate.kind !== 'package') return { kind: 'rethrow' };
        packageIds.push(candidate.packageId);
    }

    const { DatasetSchema } = await import('@objectstack/spec/ui');
    const admitted: Array<{ packageId: string; read: { item: unknown } }> = [];
    let unresolved = false;
    for (const packageId of packageIds) {
        let read: { item?: unknown } | null | undefined;
        try {
            read = await readHolder(packageId);
        } catch (readError) {
            // The holder's own read refused its address: which item would run
            // there is not known, so neither is the caller's admission to it.
            // Undetermined, and the read's own refusal (its candidates
            // included) never leaves this arm. Any other throw is a failed
            // read, answered `503` by the door.
            if (isRefusal(readError)) {
                unresolved = true;
                continue;
            }
            throw readError;
        }
        const item = read?.item;
        // The holder's own address serving nothing is no fact about the caller.
        if (item === undefined || item === null) {
            unresolved = true;
            continue;
        }
        const parsed = (DatasetSchema as { safeParse(v: unknown): { success: boolean; data?: unknown } })
            .safeParse(stripReadDecorations(item));
        if (!parsed.success) continue;
        const admission = await service.admitDatasetCatalogEntry(parsed.data, context);
        if (admission.admitted) admitted.push({ packageId, read: { item } });
        else if (admission.unresolved) unresolved = true;
    }

    const ambiguity = AMBIGUITY.has(refusal.reason);
    // An unjudged holder could be admitted: it moves "none" to "one" (or to a
    // refusal), and for an ambiguity "one" to a refusal.
    if (unresolved && (admitted.length === 0 || (ambiguity && admitted.length === 1))) {
        return { kind: 'undetermined' };
    }
    if (admitted.length === 0) return { kind: 'not-found' };
    if (ambiguity && admitted.length === 1) return { kind: 'read', read: admitted[0].read };
    const narrowed = {
        status: 'refused' as const,
        reason: refusal.reason,
        type: refusal.type,
        name: refusal.name,
        callerPackageId: refusal.callerPackageId,
        candidates: refusal.candidates.filter(
            (c) => c.kind === 'package' && admitted.some((a) => a.packageId === c.packageId),
        ),
    };
    return {
        kind: 'refused',
        error: new PackageScopedNameRefusedError({ ...narrowed, message: packageScopedRefusalMessage(narrowed) }),
    };
}

