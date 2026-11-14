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
 *    includes a holder whose own exact-qualifier read refuses in any other
 *    shape than the one below: its refusal is kept inside this arm and never
 *    answered. The `503` carries, on `cause` (the operator's log, never the
 *    body), which holders could not be judged and why.
 *
 * [#32948, ADR-0150 D4] A holder whose own address is CONTENDED is judged, not
 * left undetermined. A row two or more holders of the name could own (a
 * package-less row, or an App pair's row that no module's address declares,
 * epic ruling on #31699 F2) is no one holder's customization, so each such
 * holder's own exact read refuses `ambiguous-in-closure` naming the holders,
 * itself among them ({@link isOwnAddressContention}). Nothing can run at that
 * address, so such a holder is never picked; the caller's admission to it is
 * judged on the holder's own item as the list scoped to it serves it (that
 * list withholds the row), as `query_dataset` judges every holder over the
 * list. Admitted, it is named in the `409`; not admitted, it is not named.
 * Before, every such holder was undetermined, and the door answered `503` for
 * every caller where D4 asks for the refusal naming the holders.
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
    /**
     * Whether a holder is admitted could not be judged, and it could move the
     * answer. `cause` names each holder that could not be judged and why: the
     * operator's text, logged with the `503`, ⛔ never put in its body.
     */
    | { readonly kind: 'undetermined'; readonly cause: string };

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
 * [#32072] A package-scoped resolver's refusal, by class or by shape: `code`
 * `RESOURCE_CONFLICT` with a `refusal` whose `status` is `'refused'`, whatever
 * its reason. The same predicate the `/meta` dispatcher reads
 * (`isPackageScopedRefusal` in `@objectstack/runtime`'s `domains/meta.ts`), so
 * one refusal is a `409` at both doors whichever copy of the class threw it.
 * [#32826] The ONE copy in this package: the door's by-name read and this
 * arm's per-holder reads both ask it.
 */
export function isPackageScopedRefusal(e: unknown): e is { code: 'RESOURCE_CONFLICT'; refusal: PackageScopedRefusal } {
    if (e instanceof PackageScopedNameRefusedError) return true;
    const thrown = e as { code?: unknown; refusal?: { status?: unknown } } | null | undefined;
    return thrown?.code === 'RESOURCE_CONFLICT' && thrown.refusal?.status === 'refused';
}

/**
 * [#32948] Is `e` the refusal of `packageId`'s own exact address over a row
 * two or more holders could own: `ambiguous-in-closure`, read AS that package
 * (`callerPackageId`), naming only packages, that package among them? The
 * exact read throws exactly this for a package-less row, and for an App pair's
 * undeclared row, of a name two or more packages hold
 * (`exactQualifierItem` in `@objectstack/metadata-protocol`). Any other refusal
 * of a holder's own read stays undetermined.
 */
function isOwnAddressContention(e: unknown, packageId: string): boolean {
    if (!isPackageScopedRefusal(e)) return false;
    const { reason, callerPackageId, candidates } = e.refusal;
    return reason === 'ambiguous-in-closure'
        && callerPackageId === packageId
        && candidates.length >= 2
        && candidates.every((c) => c.kind === 'package')
        && candidates.some((c) => c.kind === 'package' && c.packageId === packageId);
}

/**
 * The ambiguity reasons: the core vocabulary's whole ambiguity class, so an
 * ambiguity is never read as a non-ambiguity. [#32826] `ambiguous-in-namespace`
 * cannot reach this door today: only a read that names a namespace
 * (`/meta/:type/:ns/:name`) is refused with it, and the dataset doors name a
 * package or none. It is listed so that a refusal carrying it would be judged
 * as the ambiguity it is, never as `outside-closure` is.
 */
const AMBIGUITY: ReadonlySet<PackageScopedRefusal['reason']> = new Set([
    'ambiguous-in-environment',
    'ambiguous-in-closure',
    'ambiguous-in-namespace',
]);

/**
 * Judge `refusal`'s holders for the caller in `context`. `readHolder` is the
 * door's exact-qualifier read of one holder. A refusal it throws, by class or
 * by shape, leaves that holder undetermined, unless it is that holder's own
 * address contended ({@link isOwnAddressContention}): that holder is then
 * judged on `listHolder`'s answer, the holder's own item as the list scoped to
 * it serves it, and is never picked. Any other throw is a failed read, which
 * the door answers as it answers any (`503`), so it is left to throw.
 */
export async function admitRefusedDatasetHolders(args: {
    readonly refusal: PackageScopedRefusal;
    readonly svc: unknown;
    readonly context: unknown;
    readonly readHolder: (packageId: string) => Promise<{ item?: unknown } | null | undefined>;
    /** The holder's own item of the name in the list scoped to it, `undefined` when it lists none. */
    readonly listHolder?: (packageId: string) => Promise<unknown>;
}): Promise<DatasetRefusalAdmission> {
    const { refusal, context, readHolder, listHolder } = args;
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
    // `read` absent: a contended holder, admitted on its own listed item, which
    // is named but never run.
    const admitted: Array<{ packageId: string; read?: { item: unknown } }> = [];
    // [#32826] Each holder that could not be judged, and why: the `503`'s cause.
    const unjudged: string[] = [];
    /** Judge one holder on `item`; `read` is what runs when it is picked. */
    const judge = async (packageId: string, item: unknown, runnable: boolean): Promise<void> => {
        const parsed = (DatasetSchema as { safeParse(v: unknown): { success: boolean; data?: unknown } })
            .safeParse(stripReadDecorations(item));
        if (!parsed.success) return;
        const admission = await service.admitDatasetCatalogEntry(parsed.data, context);
        if (admission.admitted) admitted.push({ packageId, ...(runnable ? { read: { item } } : {}) });
        else if (admission.unresolved) unjudged.push(`package "${packageId}": its admission could not be resolved`);
    };
    for (const packageId of packageIds) {
        let read: { item?: unknown } | null | undefined;
        try {
            read = await readHolder(packageId);
        } catch (readError) {
            // [#32948] The holder's own address is contended by a row no one
            // holder owns (ADR-0150 D4): nothing runs there, and the holder is
            // judged on its own listed item. The read's refusal never leaves
            // this arm.
            if (isOwnAddressContention(readError, packageId) && listHolder) {
                let listed: unknown;
                try {
                    listed = await listHolder(packageId);
                } catch (listError) {
                    if (!isPackageScopedRefusal(listError)) throw listError;
                    listed = undefined;
                }
                if (listed !== undefined && listed !== null) {
                    await judge(packageId, listed, false);
                    continue;
                }
                unjudged.push(`package "${packageId}": its own address is contended and the list scoped to it serves no item of the name`);
                continue;
            }
            // Any other refusal of the holder's own read: which item would run
            // there is not known, so neither is the caller's admission to it.
            // Undetermined, and the read's own refusal (its candidates
            // included) never leaves this arm. Any other throw is a failed
            // read, answered `503` by the door.
            if (isPackageScopedRefusal(readError)) {
                unjudged.push(`package "${packageId}": its own exact read refused (${readError.refusal.reason})`);
                continue;
            }
            throw readError;
        }
        const item = read?.item;
        // The holder's own address serving nothing is no fact about the caller.
        if (item === undefined || item === null) {
            unjudged.push(`package "${packageId}": its own exact read serves nothing`);
            continue;
        }
        await judge(packageId, item, true);
    }

    const ambiguity = AMBIGUITY.has(refusal.reason);
    const picked = ambiguity && admitted.length === 1 ? admitted[0].read : undefined;
    // An unjudged holder could be admitted: it moves "none" to "one" (or to a
    // refusal), and for an ambiguity a picked "one" to a refusal.
    if (unjudged.length > 0 && (admitted.length === 0 || picked !== undefined)) {
        return {
            kind: 'undetermined',
            cause: `The dataset "${refusal.name}" (${refusal.reason}) has holders whose admission could not be judged: ${unjudged.join('; ')}.`,
        };
    }
    if (admitted.length === 0) return { kind: 'not-found' };
    if (picked !== undefined) return { kind: 'read', read: picked };
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
    // [#32948] An ambiguity narrowed to one holder is that holder's contended
    // address (a runnable one would have been picked above): the vocabulary's
    // ambiguity sentence counts holders and tells the caller to address one,
    // which is no remedy here, so the sentence says what stands in the way.
    const [only] = narrowed.candidates;
    const message = ambiguity && narrowed.candidates.length === 1 && only?.kind === 'package'
        ? `The dataset "${refusal.name}" is held by package "${only.packageId}", and a row of the name that no one `
            + 'package owns stands beside its item, so nothing can be read at its address until that row is saved '
            + 'under one package (ADR-0150 D4).'
        : packageScopedRefusalMessage(narrowed);
    return {
        kind: 'refused',
        error: new PackageScopedNameRefusedError({ ...narrowed, message }),
    };
}
