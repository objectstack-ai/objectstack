// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0159 D5, D7] The write-side judgements the `form` type adds:
 *
 *  - {@link packagelessListOverFormRefusal} — card ② item 5's refusal: a
 *    package-less `view` write that would store a LIST at a name a read-only
 *    package authors as a `form` item. Kept as long as rule 11's replacement
 *    check is kept.
 *  - {@link formAddressClashRefusal} — ruled question 3 (A): a `form` whose
 *    open public address another form already holds.
 *  - {@link oldShapeFormRowRemovals} — what a `form` save, reset or delete at
 *    `(package, name)` removes of the old-shape row that carries that form at
 *    that address, in the same transaction; and
 *    {@link restoreOldShapeFormRowRemovals}, which puts those rows back when
 *    the write that removed them is undone.
 *
 * Each judges bodies through THE projection ({@link projectViewForms}), never
 * by re-reading `formViews` by hand; the old-shape row removal names a stored
 * row's forms as the `form` read names them ({@link storedViewRowHoldings}).
 */

import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { anonymousFormIntakeSlug, isAggregatedViewContainer, projectViewForms, publicFormSlug } from '@objectstack/spec/ui';
import type { ProtocolHost } from './protocol-host.js';
import { readEffectiveForms, storedViewRowHoldings, type FormReadHost, type StoredHolding } from './protocol-form-reads.js';

/** The error code of the public address clash (ruled question 3): ledgered in `check:error-code-casing`. */
export const FORM_ADDRESS_TAKEN = 'FORM_ADDRESS_TAKEN' as const;

const isPackageless = (packageId: string | null | undefined): boolean =>
    packageId === undefined || packageId === null || packageId === '';

/**
 * The names a `view` body would store a LIST at, as the readers place it: an
 * item's own name when it carries no form, and every list a container's
 * expansion writes (the runtime door's expansion, bound to no package).
 */
function listNamesOf(
    host: Pick<ProtocolHost, 'expandRuntimeViewContainer'>,
    type: string,
    body: Record<string, unknown>,
    saveName: string,
): string[] {
    const stamped = typeof body.name === 'string' && body.name !== '' ? body : { ...body, name: saveName };
    if (isAggregatedViewContainer(stamped)) {
        const names: string[] = [];
        for (const expanded of host.expandRuntimeViewContainer(type, stamped, { packageId: null })) {
            names.push(...projectViewForms(expanded).lists);
        }
        return [...new Set(names)];
    }
    return projectViewForms(stamped).lists;
}

/**
 * [ADR-0159 D5, card ② item 5] Refuse a package-less `view` write that would
 * store a list at a name a READ-ONLY package authors as a `form` item (in
 * `forms:`; a form the projection reads out of a package's old shape does not
 * trigger it). Such a row would be read as written over the form: nothing
 * would be served for the name from the package (the closed reading), and no
 * door of today refuses it where the package's form has left the `view` type.
 *
 * ⛔ Not an extension of ADR-0146 D11's close (`packagelessOverlayWriteRefusal`):
 * it never asks the state of the base's pair or how many packages ship the
 * name. A body that carries a FORM at the name is an old-shape write of the
 * form and saves as before. The callers are the save door (beside the
 * container name-collision refusal), the publish of a draft and the rollback
 * to a version; a delete stores nothing and is not judged.
 *
 * `VALIDATION_ERROR` / `400`, the container name-collision refusal's envelope.
 * The message names the form and the two saves that work whether or not the
 * base has a pair; ⛔ it never prescribes a save under a name another stored
 * row holds.
 */
export function packagelessListOverFormRefusal(
    host: Pick<ProtocolHost, 'expandRuntimeViewContainer' | 'isWritablePackage' | 'shippedArtifactsOf'>,
    type: string,
    item: unknown,
    saveName: string,
    packageId: string | null | undefined,
): (Error & { code: 'VALIDATION_ERROR'; status: 400 }) | undefined {
    if ((PLURAL_TO_SINGULAR[type] ?? type) !== 'view') return undefined;
    if (!isPackageless(packageId)) return undefined;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    for (const name of listNamesOf(host, type, item as Record<string, unknown>, saveName)) {
        for (const artifact of host.shippedArtifactsOf('form', name)) {
            const owner = (artifact as { _packageId?: unknown } | null)?._packageId;
            if (typeof owner !== 'string' || owner === '' || host.isWritablePackage(owner)) continue;
            const err = new Error(
                `Invalid view: it would store a list at '${name}', the name of the form the package '${owner}' `
                + `authors. Give the list another key, or save it into an app of the environment's own. A list and a `
                + `form of one name are two items, and a list stored here, bound to no package, would be read over `
                + `the package's form: nothing would be served for '${name}' from '${owner}'.`,
            ) as Error & { code: 'VALIDATION_ERROR'; status: 400 };
            err.code = 'VALIDATION_ERROR';
            err.status = 400;
            return err;
        }
    }
    return undefined;
}

/** The slug a form body's `sharing.publicLink` names, open or not, or `undefined`. */
export function formHeldSlug(form: unknown): string | undefined {
    const sharing = (form as { sharing?: unknown } | null)?.sharing;
    const link = sharing && typeof sharing === 'object' ? (sharing as { publicLink?: unknown }).publicLink : undefined;
    return typeof link === 'string' && link !== '' ? publicFormSlug(link) : undefined;
}

/**
 * [ADR-0159 ruled question 3 = A] Refuse a `form` write that leaves the form
 * OPEN on a public address another form already holds, naming both forms.
 *
 * A form holds an address while its `sharing.publicLink` names it, switched on
 * or off: a switched-off form that keeps its link still holds it. "Another
 * form" is judged over the effective `form` read, so a projected old-shape
 * form holding the slug counts. A write that leaves the form closed is never
 * refused, so switching off either form of a clashing pair saves. ⛔ A
 * refusal on the new type only: an old-shape `view` write keeps today's
 * first-match behaviour.
 *
 * `409`, code {@link FORM_ADDRESS_TAKEN}.
 */
export async function formAddressClashRefusal(
    host: FormReadHost,
    type: string,
    item: unknown,
    name: string,
    packageId: string | null | undefined,
): Promise<(Error & { code: typeof FORM_ADDRESS_TAKEN; status: 409 }) | undefined> {
    if ((PLURAL_TO_SINGULAR[type] ?? type) !== 'form') return undefined;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const slug = anonymousFormIntakeSlug((item as { sharing?: unknown }).sharing);
    if (slug === null) return undefined;
    const pkg = isPackageless(packageId) ? undefined : packageId as string;
    const forms = await readEffectiveForms(host, { type: 'form' }, 'execution');
    const holder = forms.find((form) => {
        const f = form as { name?: unknown; _packageId?: unknown; overrides?: { package?: unknown } };
        if (formHeldSlug(form) !== slug) return false;
        // The form being written is not "another form": its own address, the
        // base it declares it overrides, and — written bound to no package —
        // every address of its name it stands in for.
        if (f.name === name) {
            const formPkg = typeof f._packageId === 'string' && f._packageId !== '' ? f._packageId : undefined;
            const declared = (item as { overrides?: { package?: unknown } }).overrides?.package;
            if (formPkg === pkg || pkg === undefined || (typeof declared === 'string' && declared === formPkg)) return false;
        }
        return true;
    }) as { name?: unknown; _packageId?: unknown } | undefined;
    if (holder === undefined) return undefined;
    const owner = typeof holder._packageId === 'string' && holder._packageId !== '' ? ` of the package '${holder._packageId}'` : '';
    const err = new Error(
        `The form '${name}' cannot open the public address '/forms/${slug}': the form '${String(holder.name)}'${owner} `
        + `holds it. Give '${name}' another public link, or clear the link of '${String(holder.name)}' first. A form `
        + `holds an address while its public link names it, switched on or off.`,
    ) as Error & { code: typeof FORM_ADDRESS_TAKEN; status: 409 };
    err.code = FORM_ADDRESS_TAKEN;
    err.status = 409;
    return err;
}

/**
 * [ADR-0159 card ② items 5 and 7] The two `form`-type write refusals, asked
 * together by the doors that write a body the save door did not judge at its
 * own moment: the publish of a draft (`promoteDraftForPublish`) and the
 * restore writer (`restoredBodyWriter`). Each asks the save door's own
 * predicate with its own envelope: {@link packagelessListOverFormRefusal}
 * (`400 VALIDATION_ERROR`) and {@link formAddressClashRefusal}
 * (`409 FORM_ADDRESS_TAKEN`), so a draft saved before a holder took the
 * address, and a version restored onto it, leave no two open forms on one
 * address (ruled question 3 = A).
 */
export async function formTypeWriteRefusal(
    host: FormReadHost & Pick<ProtocolHost, 'expandRuntimeViewContainer' | 'isWritablePackage' | 'shippedArtifactsOf'>,
    type: string,
    item: unknown,
    name: string,
    packageId: string | null | undefined,
): Promise<Error | undefined> {
    return packagelessListOverFormRefusal(host, type, item, name, packageId)
        ?? await formAddressClashRefusal(host, type, item, name, packageId);
}

/** One write the `form` door makes to the old-shape row carrying a form at its address. */
export type OldShapeFormRowRemoval =
    | { readonly kind: 'delete'; readonly row: { readonly name: string; readonly packageId: string | null } }
    | { readonly kind: 'resave'; readonly row: { readonly name: string; readonly packageId: string | null }; readonly body: Record<string, unknown> };

/**
 * [ADR-0159 D5] An {@link OldShapeFormRowRemoval} as it was applied: with the
 * history version the row stood at before the write (the stored row's
 * `version`, `null` when the row carried none), so a door that undoes the
 * `form` write puts the row back at that version
 * ({@link restoreOldShapeFormRowRemovals}), and a package commit records it as
 * a row the publish edited (the commit's revert restores it).
 */
export type AppliedOldShapeFormRowRemoval = OldShapeFormRowRemoval & { readonly replacedVersion: number | null };

/**
 * [ADR-0159 D5, card ② item 5] What a `form` save, reset or delete at
 * `(packageId, name)` does to the stored old-shape row that carries that form
 * at the same address (the same `package_id`): an item-shaped `view` row that
 * carries the form is deleted; a stored container that expands it is re-saved
 * without the member (its lists byte-equal). ⛔ Form content only: a `view`
 * row that carries a LIST at the name is left untouched.
 *
 * A form write removes only the old-shape row that carries that same form:
 * which forms a row carries, and under which names, is `holdingsOf`'s answer,
 * the `form` read's own naming ({@link storedViewRowHoldings}); ⛔ never a
 * second naming of the members here. A member of another name is never
 * removed, whatever its key.
 *
 * `rows` are the active stored `view` rows at that address, parsed
 * (`{ name, data, packageId }`, `packageId` as the stored entry binds it).
 */
export function oldShapeFormRowRemovals(
    rows: ReadonlyArray<{ name: string; data: unknown; packageId: string | undefined }>,
    name: string,
    packageId: string | null,
    holdingsOf: (entry: { data: unknown; packageId: string | undefined }) => ReadonlyMap<string, StoredHolding>,
): OldShapeFormRowRemoval[] {
    const out: OldShapeFormRowRemoval[] = [];
    const carries = (data: unknown, rowPackage: string | undefined): boolean =>
        holdingsOf({ data, packageId: rowPackage }).get(name)?.kind === 'form';
    for (const row of rows) {
        const body = row.data;
        if (!body || typeof body !== 'object' || Array.isArray(body)) continue;
        if (!carries(body, row.packageId)) continue;
        if (!isAggregatedViewContainer(body)) {
            out.push({ kind: 'delete', row: { name: row.name, packageId } });
            continue;
        }
        const container = body as Record<string, unknown>;
        const next: Record<string, unknown> = { ...container };
        // Drop exactly the member that carries the form: re-name after each
        // candidate removal, so the read's naming decides which one it is.
        const without = (patch: Record<string, unknown>) => !carries({ ...container, ...patch }, row.packageId);
        let removed = false;
        if (container.formViews && typeof container.formViews === 'object' && !Array.isArray(container.formViews)) {
            for (const key of Object.keys(container.formViews as object)) {
                const { [key]: _gone, ...rest } = container.formViews as Record<string, unknown>;
                if (without({ formViews: rest })) {
                    next.formViews = rest;
                    if (Object.keys(rest).length === 0) delete next.formViews;
                    removed = true;
                    break;
                }
            }
        }
        if (!removed && container.form !== undefined && without({ form: undefined })) {
            delete next.form;
            removed = true;
        }
        if (removed) out.push({ kind: 'resave', row: { name: row.name, packageId }, body: next });
    }
    return out;
}

/**
 * [ADR-0159 D5, card ② item 5] Apply {@link oldShapeFormRowRemovals} at
 * `(packageId, name)`: read the active stored `view` rows bound to exactly
 * that package (`null`: the package-less ones), and delete or re-save the one
 * that carries the form, through the repository the `form` write wrote with.
 * Called INSIDE the `form` write's transaction, so a `form` write that fails
 * leaves both rows as they were (the repository's own `withTxn` joins the
 * ambient one, ADR-0067 D2). Returns the rows it changed, each with the
 * version it replaced, for the registry heal the caller runs once the
 * transaction has committed, and for the undo of that write.
 */
export async function applyOldShapeFormRowRemovals(
    host: Pick<ProtocolHost, 'expandStoredViewContainers' | 'getOverlayRepo' | 'isArtifactBacked' | 'readActiveOverlayRows' | 'storedOverlayEntries'>,
    args: { name: string; packageId: string | null; actor: string | null; source: string },
): Promise<AppliedOldShapeFormRowRemoval[]> {
    const rows = await host.readActiveOverlayRows({ type: 'view' });
    const at: Array<{ name: string; data: unknown; packageId: string | undefined; hash: string | null; version: number | null }> = [];
    for (const row of rows) {
        if (((row?.package_id ?? null) || null) !== (args.packageId || null)) continue;
        const entry = host.storedOverlayEntries({ type: 'view' }, [row])[0];
        if (entry === undefined) continue;
        at.push({
            name: entry.name, data: entry.data, packageId: entry.packageId,
            hash: typeof row?.checksum === 'string' ? row.checksum : null,
            version: typeof row?.version === 'number' ? row.version : null,
        });
    }
    const removals: AppliedOldShapeFormRowRemoval[] = oldShapeFormRowRemovals(at, args.name, args.packageId, (entry) => storedViewRowHoldings(host, entry))
        .map((removal) => ({ ...removal, replacedVersion: at.find((row) => row.name === removal.row.name)?.version ?? null }));
    if (removals.length === 0) return removals;
    const repo = host.getOverlayRepo();
    for (const removal of removals) {
        const stored = at.find((row) => row.name === removal.row.name);
        const ref = { type: 'view', name: removal.row.name, org: 'env' } as Parameters<typeof repo.put>[0];
        const intent = host.isArtifactBacked('view', removal.row.name) ? 'override-artifact' as const : 'runtime-only' as const;
        const options = {
            parentVersion: stored?.hash ?? null,
            actor: args.actor,
            source: args.source,
            intent,
            state: 'active' as const,
            packageId: args.packageId,
        };
        if (removal.kind === 'delete') await repo.delete(ref, options as Parameters<typeof repo.delete>[1]);
        else await repo.put(ref, removal.body, options as Parameters<typeof repo.put>[2]);
    }
    return removals;
}

/**
 * [ADR-0159 D5] The registry heal of each old-shape row a `form` write removed
 * or re-saved ({@link applyOldShapeFormRowRemovals}), run after the commit by
 * every door that removes them: a deleted row's name is restored to what the
 * store still serves, a re-saved container is written through as stored.
 */
export async function healOldShapeFormRowRemovals(
    host: Pick<ProtocolHost, 'applyRegistryWriteThrough' | 'restoreArtifactRegistryView'>,
    removals: readonly OldShapeFormRowRemoval[],
): Promise<void> {
    for (const removal of removals) {
        if (removal.kind === 'delete') {
            await host.restoreArtifactRegistryView('view', removal.row.name, null, removal.row.packageId);
        } else {
            await host.applyRegistryWriteThrough({
                type: 'view', name: removal.row.name, item: removal.body,
                packageId: removal.row.packageId, organizationId: null,
            });
        }
    }
}

/**
 * [ADR-0159 D5, ADR-0067 D2] Put back each old-shape row a `form` write removed
 * or re-saved ({@link applyOldShapeFormRowRemovals}), when that write is undone
 * by hand: a refused package publish on a runtime that cannot roll back
 * (`undoLandedPromotions`). Newest first, each row is restored to the version
 * it stood at before the write, written again when it was deleted, under the
 * package it was bound to, and the registry is healed from what the store then
 * serves. The removal and its undo are one pair: the old-shape row stands
 * again exactly as it stood, whatever it held (a form, or that form switched
 * off), so the undone write leaves the address answering what it answered
 * before.
 *
 * Throws on the first row it cannot put back (no recorded version, or the
 * store's refusal), so the caller reports the item as not undone.
 */
export async function restoreOldShapeFormRowRemovals(
    host: Pick<ProtocolHost, 'isArtifactBacked' | 'restoreArtifactRegistryView'>,
    repo: Pick<ReturnType<ProtocolHost['getOverlayRepo']>, 'restoreVersion'>,
    removals: readonly AppliedOldShapeFormRowRemoval[],
    options: { actor: string | null; source: string; message: string },
): Promise<void> {
    for (const removal of [...removals].reverse()) {
        if (removal.replacedVersion === null) {
            throw new Error(
                `the old-shape view row '${removal.row.name}' the form write ${removal.kind === 'delete' ? 'removed' : 're-saved'} `
                + 'was recorded at no version, so it cannot be put back',
            );
        }
        const ref = { type: 'view', name: removal.row.name, org: 'env' } as Parameters<typeof repo.restoreVersion>[0];
        await repo.restoreVersion(ref, removal.replacedVersion, {
            ...options,
            intent: host.isArtifactBacked('view', removal.row.name) ? 'override-artifact' : 'runtime-only',
            packageId: removal.row.packageId,
        });
        await host.restoreArtifactRegistryView('view', removal.row.name, null, removal.row.packageId);
    }
}
