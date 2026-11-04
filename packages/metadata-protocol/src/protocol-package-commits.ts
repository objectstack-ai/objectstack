// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Package revert, duplicate, import, orphans, commits,
 * revertCommit, rollback" section of `ObjectStackProtocolImplementation`: the
 * bodies of `revertStoredPackage`, `duplicatePackage`,
 * `importUnmanagedPackage`, `reassignOrphanedMetadata`, `listCommits`,
 * `readRevertableCommit`, `revertCommit`, `rollbackToPackageCommit`,
 * `rollbackMetaItem`, `rollbackMetaItemUnaudited` moved out of `protocol.ts`
 * whole by `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the class method
 * of the same name as `packages/metadata-protocol/scripts/host-split.mjs` moves
 * one (ruling E, item E1): re-indented one level, with `this.<member>` read as
 * `host.<member>` and nothing else changed. Each method stays on the class
 * with its docblock and signature, which the published `.d.ts` prints, and
 * hands its body the host (`protocol-host.ts`); the docblock there is the
 * contract.
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { ImportUnmanagedPackageRequestSchema } from '@objectstack/spec/api';
import type {
    ImportUnmanagedPackageRequest,
    ImportUnmanagedPackageResponse,
    InstallPackageRequest,
} from '@objectstack/spec/api';
import { packageScopedRowWhere } from './sys-metadata-repository.js';
import type { SysMetadataRepository } from './sys-metadata-repository.js';
import { ConflictError, assertProtocolCompat } from '@objectstack/metadata-core';
import { planUnmanagedImport, unmanagedInstallPostureRefusal } from './package-unmanaged-install.js';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import {
    DEFAULT_METADATA_TYPE_REGISTRY,
    ManifestSchema,
    deriveNamespaceFromPackageId,
    manifestIdRefusal,
} from '@objectstack/spec/kernel';
import { REFERENCE_SITES } from './reference-sites.js';
import { extensionFieldSuffixRefusalError, judgeExtensionFieldSuffix } from './protocol-extension-field-suffix.js';
import { customizationPairManifestRefusal } from './protocol-customization-package.js';
import { withRefusalAudit } from './protocol-refusal-audit.js';
import {
    canonicalMetaType,
    canonicalizeMetaRequestType,
    overlaySchemaDeclaredKey,
} from './protocol-meta-type-schema.js';
import { permissionSetOwnerBindingRefusal } from './protocol-authoring-refusals.js';
import { zodIssuesToMetadataIssues } from './protocol-metadata-issues.js';
import {
    bundleMemberDiscriminator,
    memberOption,
    mutationEventMember,
    resolveBundleMemberSelector,
} from './protocol-bundle-members.js';
import { compareAuditInstants, isoFromValidDate } from './protocol-version-tokens.js';
import {
    clientFacingFailureCode,
    clientFacingFailureText,
    declaresClientRefusal,
    metadataIssueHeadline,
} from './protocol-client-failures.js';
import { isNonCanonicalStoredType } from './protocol-stored-overlay-types.js';
import type { RollbackMetaItemRequest } from './protocol-door-requests.js';
import type { ProtocolHost } from './protocol-host.js';

/** The body of `ObjectStackProtocolImplementation#revertStoredPackage`; the method's docblock there is its contract. */
export async function revertStoredPackage(host: Pick<ProtocolHost, 'discardDraftInItsScope' | 'ensureOverlayIndex' | 'findEnvironmentRows' | 'getOverlayRepo' | 'refuseOrganizationScopedWrite' | 'rethrowUnlessMetadataStoreUnprovisioned'>, request: {
        packageId: string;
        actor?: string;
    }): Promise<{
        stored: boolean;
        discarded: Array<{ type: string; name: string }>;
    }> {
    // [ADR-0131 D6] FIRST: an organization-scoped revert is refused.
    host.refuseOrganizationScopedWrite(
        `Package '${request.packageId}'`, request,
    );
    await host.ensureOverlayIndex();
    let drafts: Awaited<ReturnType<SysMetadataRepository['listDrafts']>>;
    let publishedRows: unknown[];
    try {
        drafts = await host.getOverlayRepo().listDrafts({ packageId: request.packageId });
        // [#21911] The explicit system opt-in — see findServedOverlayRow.
        publishedRows = (await host.findEnvironmentRows('sys_metadata', {
            where: packageScopedRowWhere('active', { packageId: request.packageId }),
            limit: 1,
            context: { isSystem: true },
        })) as unknown[];
    } catch (error) {
        host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        return { stored: false, discarded: [] };
    }

    if (drafts.length === 0 && publishedRows.length === 0) return { stored: false, discarded: [] };

    if (publishedRows.length === 0) {
        const err = new Error(
            `Package '${request.packageId}' has never been published, so there is no published version to `
            + 'revert to. Publish the package first, or discard its drafts to drop them.',
        ) as Error & { code?: string; status?: number };
        err.code = 'RESOURCE_CONFLICT';
        err.status = 409;
        throw err;
    }

    const discarded: Array<{ type: string; name: string }> = [];
    for (const d of drafts) {
        await host.discardDraftInItsScope(d, request.actor);
        discarded.push({ type: d.type, name: d.name });
    }
    return { stored: true, discarded };
}

/** The body of `ObjectStackProtocolImplementation#duplicatePackage`; the method's docblock there is its contract. */
export async function duplicatePackage(host: Pick<ProtocolHost, 'convertStoredItem' | 'engine' | 'findEnvironmentRows' | 'installPackage' | 'refuseOrganizationScopedWrite' | 'resolveFlowCanonicalizer' | 'saveMetaItem'>, request: {
        sourcePackageId: string;
        targetPackageId: string;
        targetName?: string;
        targetNamespace?: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        copiedCount: number;
        failedCount: number;
        targetPackageId: string;
        copied: Array<{ type: string; name: string }>;
        failed: Array<{ type: string; name: string; error: string }>;
    }> {
    // [ADR-0131 D6] FIRST: an organization-scoped duplicate is refused.
    host.refuseOrganizationScopedWrite(
        `Package '${request.targetPackageId}'`, request,
    );
    // [#19417] ⭐ THE TARGET ID IS PARSED BEFORE ANYTHING IS MINTED — same
    // declaration, same surfaced sentence, one key over.
    //
    // This door builds `dupManifest` with `id: request.targetPackageId` and
    // writes it through {@link installPackage}, so the gate there already
    // covers the WRITE. It does not cover this method, for two reasons that
    // are both about where the refusal lands:
    //
    //   ① a refusal of the `installPackage` call below is rethrown before
    //     any item is copied, so it would not be lost — but it names
    //     `manifest.id`, the key of a manifest this door builds, never the
    //     `targetPackageId` the caller wrote (the closing paragraph below);
    //   ② the refusal has to precede the MUTATIONS, and the manifest write
    //     is not the first of them. #14451 already established the position
    //     for this door's other precondition: `duplicatePackage` mints the
    //     target package record ahead of its copy loop, so a refusal any
    //     later leaves the empty shell behind.
    //
    // The key named is `targetPackageId`, because that is the authoring
    // path the caller actually wrote — `manifestIdRefusal` takes the key so
    // one declaration can name itself correctly at every door.
    const declaredTargetId = ManifestSchema.shape.id.safeParse(request.targetPackageId);
    if (!declaredTargetId.success) {
        throw Object.assign(
            new Error(manifestIdRefusal('targetPackageId', request.targetPackageId)),
            { statusCode: 400 },
        );
    }

    const registry: any = (host.engine as any).registry;
    const srcPkg = registry?.getPackage?.(request.sourcePackageId);
    // [#19417] ⭐ ONE ASSUMPTION, ONE IMPLEMENTATION. Both namespaces were
    // derived here by a RAW `id.split('.').pop()`, while
    // {@link installPackage} derives the very same default with the spec
    // helper `deriveNamespaceFromPackageId` — which sanitises to the
    // namespace charset, truncates to 20 and answers `null` when nothing
    // valid comes out. The raw copy did none of that, and `targetNs` is not
    // a label: it is spliced into every copied OBJECT name as
    // `${targetNs}_${short}`, and an object name is
    // `/^[a-z_][a-z0-9_]*$/` (`packages/spec/src/data/object.zod.ts`).
    //
    // So the Studio's own default duplicate id — `<sourceId>-copy`, the
    // value both objectui duplicate dialogs prefill — derived the namespace
    // `leave-copy` and minted object names `leave-copy_ticket`, which the
    // object declaration refuses. The helper answers `leave_copy`. The
    // source side is the same rule read backwards: the prefix these rows
    // actually carry is the one `installPackage` stamped, i.e. the helper's,
    // so matching them with the raw split found nothing and the copy landed
    // under the SOURCE's names — the collision the re-namespacing exists to
    // prevent.
    //
    // [#19577] ⭐ AN EXPLICIT `targetNamespace` STILL WINS OVER THE DEFAULT,
    // BUT IT IS PARSED, NOT TAKEN RAW. Whichever branch answered, the value
    // becomes the copy's `manifest.namespace` AND the prefix of every copied
    // object name, so both branches pass ONE parse before anything is
    // minted — `ManifestSchema.shape.namespace`, the declaration itself,
    // never a hand-copied regex. An explicit value was the more reachable
    // hole of the two: it is pure caller input, and `targetNamespace:
    // 'my-ns'` minted `my-ns_ticket`, a name the object declaration refuses.
    //
    // ⛔ A refused explicit value is REFUSED, never sanitised the way the
    // derivation sanitises an id: it is what the caller wrote, and a copy
    // quietly landing under a namespace nobody wrote is the silent rewrite
    // this door exists not to perform.
    //
    // The sentence is the DECLARATION's, surfaced — the discipline the id
    // gate above follows — and this door adds only the key it read and the
    // value that arrived. The throw carries `statusCode: 400` and no `code`,
    // exactly like the id refusal above, so an HTTP boundary answers the
    // status-derived `VALIDATION_ERROR` on both branches (`resolveThrownHttpError`).
    const sourceNs: string =
        (srcPkg?.manifest?.namespace as string) ?? (deriveNamespaceFromPackageId(request.sourcePackageId) ?? '');
    const explicitNs = request.targetNamespace;
    const targetNs: string | null = explicitNs ?? deriveNamespaceFromPackageId(request.targetPackageId);
    // `?? ''` because the declaration is `.optional()`: an ABSENT value
    // passes it, and a derivation that produced nothing must not.
    const declaredTargetNs = ManifestSchema.shape.namespace.safeParse(targetNs ?? '');
    if (targetNs == null || !declaredTargetNs.success) {
        const rule = declaredTargetNs.error?.issues[0]?.message ?? 'See `manifest.namespace`';
        throw Object.assign(
            new Error(
                explicitNs != null
                    ? `Invalid package namespace '${String(explicitNs)}' on \`targetNamespace\`. ${rule}. `
                        + 'It becomes the copy\'s `manifest.namespace` and the prefix of every copied object name.'
                    // Reachable only for an id the pattern admits but the
                    // namespace charset cannot carry (a single-letter final
                    // segment) — never a copy renamed with an empty prefix.
                    : `Cannot derive a package namespace from '${request.targetPackageId}'. `
                        + `Pass \`targetNamespace\` explicitly. ${rule}.`,
            ),
            { statusCode: 400 },
        );
    }

    // [ADR-0146 D3] A copy into a paired customization package id must carry
    // what the pair's ensure door writes — the base's pair namespace and the
    // dependency on the base — judged on the record this verb WOULD install,
    // before a row is read. `installPackage` asks the same predicate of the
    // record it is handed; asking here as well covers a source with no
    // registered manifest, whose copy mints no record for that gate to judge
    // and would otherwise land items under a pair id no package holds.
    const pairRefusal = customizationPairManifestRefusal(
        { id: request.targetPackageId, namespace: targetNs, dependencies: srcPkg?.manifest?.dependencies },
        (id) => registry?.getPackage?.(id),
    );
    if (pairRefusal !== undefined) throw Object.assign(new Error(pairRefusal), { statusCode: 400 });

    // [ADR-0131 D6] The source's ENVIRONMENT rows — the ones every `/meta`
    // read serves. A legacy organization-scoped row is served by none of
    // them and waits for the promotion ceremony (ADR-0131 C7); copying it
    // would write its body environment-wide under the new package, a
    // promotion this verb has no business performing, and — beside the
    // environment row of the same item — land two bodies on one target key.
    const where: Record<string, unknown> = {
        package_id: request.sourcePackageId,
        state: 'active',
    };
    // [#21911] The explicit system opt-in — see findServedOverlayRow.
    const rows = (await host.findEnvironmentRows('sys_metadata', { where, context: { isSystem: true } })) as any[];

    // Rows other than objects and qualified view items (each below) are
    // renamed by the source-prefix swap alone; a name without the prefix
    // keeps it (the docblock re-namespaces OBJECT names).
    const renameName = (name: string): string =>
        sourceNs && typeof name === 'string' && name.startsWith(`${sourceNs}_`)
            ? `${targetNs}_${name.slice(sourceNs.length + 1)}`
            : name;

    // ⭐ EVERY OBJECT GETS A NAME IN THE TARGET NAMESPACE (ADR-0070 D4, read
    // with ADR-0129 D2). An object name IS its table name and its registry
    // key, so a copy that keeps the source's name is a second claim on the
    // source's object: before PR #23510 it stored a target row the registry
    // refused, over the source's table, and after it the copy failed with
    // the ADR-0029 D9.9 ownership prescription, which names no way out for
    // a duplicate. ADR-0129 D2 says what the name is: every object a
    // package defines is `${namespace}_${shortName}`, and the prefix rule's
    // own prescription for a name that lacks the prefix
    // (`validateObjectNamespacePrefix`) is "rename it to
    // `${namespace}_${name}`". The copy is a NEW object, so that rename
    // costs nothing here — while renaming the SOURCE object would move its
    // table. A prefixed name swaps the source prefix for the target's;
    // a name WITHOUT the source prefix (a direct-publish save stored
    // before that door read the prefix rule — #24547 — or a package that
    // had no namespace) takes the target prefix in front of its whole name.
    //
    // ⛔ REFUSED, NEVER RE-INVENTED: when that name is already claimed — by
    // the copy of a prefixed sibling (`ticket` and `iojn_ticket` both name
    // `iojn2_ticket`) or by an object the source package holds — the object
    // is reported in `failed[]` before anything is written for it, at its
    // own name, with the rename that clears it. A second invented name
    // (a numeric suffix, a third prefix) would be a name nobody wrote.
    const objectNames = new Set<string>(
        rows.filter((row) => row?.type === 'object' && typeof row.name === 'string').map((row) => row.name as string),
    );
    const renameMap = new Map<string, string>();
    const prefixed: string[] = [];
    const unprefixed: string[] = [];
    for (const name of objectNames) {
        if (sourceNs && name.startsWith(`${sourceNs}_`)) prefixed.push(name);
        else unprefixed.push(name);
    }
    for (const name of prefixed) {
        const nn = renameName(name);
        if (nn !== name) renameMap.set(name, nn);
    }
    // Every name a prefixed object's copy takes (itself, when the target
    // namespace IS the source's), and every name the source holds.
    const claimedBy = new Map<string, string>(prefixed.map((name) => [renameName(name), name]));
    const refusedObjects = new Map<string, string>();
    for (const name of unprefixed) {
        const nn = `${targetNs}_${name}`;
        const holder = claimedBy.get(nn) ?? (objectNames.has(nn) ? nn : undefined);
        if (holder !== undefined) {
            const lacks = sourceNs
                ? `lacks the '${sourceNs}_' prefix of package '${request.sourcePackageId}' (ADR-0129 D2: `
                    + 'every object a package defines carries its namespace as a name prefix)'
                : `carries no namespace prefix (package '${request.sourcePackageId}' declares no namespace)`;
            const taken = holder === nn
                ? `'${nn}' is an object package '${request.sourcePackageId}' already holds`
                : `'${nn}' is already the copy name of object '${holder}'`;
            refusedObjects.set(
                name,
                `Object '${name}' is not copied: its name ${lacks}, so its copy is named '${nn}' in `
                    + `namespace '${targetNs}', and ${taken}. Rename '${name}' on the source to `
                    + `${sourceNs ? `a '${sourceNs}_' name` : 'a name'} no other object in the package uses, `
                    + 'then duplicate again.',
            );
            continue;
        }
        renameMap.set(name, nn);
        claimedBy.set(nn, name);
    }

    // Longest-first, identifier-boundary rewrite so `iojn_task` never corrupts
    // `iojn_task_log`, and `iojn_x` inside `record.iojn_x`/`iojn_x.view` matches.
    // Prefixed names only: a prefixed name is distinctive enough to find in
    // free text, a bare one is not (below).
    //
    // ⭐ THE BOUNDARY HOLDS ON BOTH SIDES. With the right side alone, a
    // name that merely ENDS in an object's name was rewritten inside it:
    // the field `x_iojn_task` came out `x_iojn2_task` — its `name` and every
    // value naming it — while its `fields` key stayed, so the copy's key
    // and `name` disagreed. `x_iojn_task` is another identifier, never the
    // object: `renameName` swaps the source prefix only at the START of a
    // name, and this rewrite now matches only a whole identifier too.
    //
    // ⭐ A PREFIXED NAME THAT IS ALSO A FIELD KEY IS NOT DISTINCTIVE. When a
    // package object declares a field keyed like a prefixed package object
    // (`fields.iojn_customer` beside the object `iojn_customer`), a free-text
    // value spelled that way may name the field — a list view's `columns`,
    // a form's `sections[].fields` — and the field keeps its key. Renaming
    // it as the object copied a column or form field the copy does not
    // have. Such a name is treated as a bare name is: rewritten only at an
    // object-reference property (below), never in free text.
    const fieldKeys = new Set<string>();
    for (const row of rows) {
        if (row?.type !== 'object') continue;
        let body: any;
        try {
            body = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        } catch {
            continue; // the copy loop reports an unparseable row at its own name
        }
        const fields = body?.fields;
        if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
            for (const key of Object.keys(fields)) fieldKeys.add(key);
        }
    }
    const olds = prefixed
        .filter((name) => renameMap.has(name) && !fieldKeys.has(name))
        .sort((a, b) => b.length - a.length);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = olds.length
        ? new RegExp(`(?<![A-Za-z0-9_])(${olds.map(esc).join('|')})(?![A-Za-z0-9_])`, 'g')
        : null;
    // ⭐ A VIEW ITEM'S NAME FOLLOWS ITS OBJECT. A view row's qualified name
    // is `<object>.<viewKey>` (`ViewItemNameSchema`,
    // `packages/spec/src/ui/view.zod.ts`: "the object can be recovered from
    // the prefix, so the registry key never collides across objects"), so
    // its object part takes exactly the rename its `object` property takes
    // — `renameMap`, whole — and its view key is left as stored:
    // `ticket.board` copies as `iojn2_ticket.board` beside the body's
    // `object: 'iojn2_ticket'`. The source-prefix swap (`renameName`)
    // reached a prefixed object's items only: a bare object's item kept
    // `ticket.board`, a name the source's item still holds, so a by-name
    // read naming no package served the source and the copy was shadowed.
    // The swap also moved an item of an object OUTSIDE the package that
    // carries the source prefix (`iojn_ext.board` → `iojn2_ext.board`)
    // while its `object` stayed `iojn_ext`. An object this copy does not
    // rename keeps its items' names.
    //
    // A value that IS such a name, whole, follows the item: a form action's
    // `target` (`<object>.<viewKey>`) kept `ticket.entry`, so the copy's
    // button opened the SOURCE's form, on the source's object. Whole values
    // only, and only names of the view items this copy renames — a bare
    // object's name is never rewritten inside free text (below).
    const isQualifiedViewRow = (row: any): boolean =>
        (PLURAL_TO_SINGULAR[String(row?.type)] ?? String(row?.type)) === 'view'
        && typeof row?.name === 'string' && row.name.includes('.');
    const viewItemRenames = new Map<string, string>();
    for (const row of rows) {
        if (!isQualifiedViewRow(row)) continue;
        const dot = (row.name as string).indexOf('.');
        const renamed = renameMap.get((row.name as string).slice(0, dot));
        if (renamed !== undefined) viewItemRenames.set(row.name, `${renamed}${(row.name as string).slice(dot)}`);
    }
    // ⭐ AT AN OBJECT-REFERENCE PROPERTY, A NAME IS REWRITTEN WHOLE — the
    // only place a BARE name is rewritten. Measured: putting `ticket` in the
    // free-text rewrite above turns "A support ticket raised by a customer"
    // into "A support iojn2_ticket raised …", and the same match renames the
    // value of a lookup FIELD called `ticket` (`fields.ticket.name`). So a
    // value is rewritten only where it sits under a property that names an
    // object — the derived site index (`REFERENCE_SITES`, target `object`:
    // `reference`, `object`, `objectName`, `objects`, …), read by property
    // wherever it occurs in any item, because flow node configs (`config.
    // objectName`) are declared by node descriptors the index does not
    // walk — and only when it equals a renamed name exactly, in the four
    // shapes a name arrives in there: a string, an array element, a record
    // KEY (`permission.objects` is keyed by object name) or a `.name`. The
    // record key holds for prefixed names too: a copied permission set
    // otherwise kept `objects.<source object>`, a grant on the SOURCE.
    //
    // ⛔ REFUSED, NEVER MERGED: at a reference site, a renamed name can
    // meet a name the item already holds there — the source also names
    // the object the copy is about to be called (`dupdst_customer`, an
    // object outside the package or not yet created) beside its own
    // (`dupsrc_customer`). Two record KEYS that land on one key keep only
    // the last entry: a permission set's `objects` dropped a grant (and
    // the copied object could gain edit and delete its source never gave
    // it), a translation's `objects` dropped a label. Two array ELEMENTS
    // that land on one name bind it twice: a hook's handler ran twice per
    // event on the copied object. So every such meeting is recorded in
    // `collisions` — the path, the name that moved, the name it met — and
    // the call site refuses the item in `failed[]` before anything is
    // written for it. `renameMap` is one-to-one, so a meeting is always a
    // renamed name and a name this copy does not rename; an element the
    // source itself repeats is copied as stored.
    const objectReferenceProperties = new Set(
        (REFERENCE_SITES.byTarget.get('object') ?? []).map((site) => site.property),
    );
    type ReferenceCollision = { at: string; shape: 'key' | 'entry'; moved: string; met: string };
    const deepRewrite = (v: any, collisions: ReferenceCollision[], atReference = false, at = ''): any => {
        if (typeof v === 'string') {
            const whole = atReference ? renameMap.get(v) : undefined;
            if (whole !== undefined) return whole;
            const viewItem = viewItemRenames.get(v);
            if (viewItem !== undefined) return viewItem;
            return re ? v.replace(re, (m) => renameMap.get(m) ?? m) : v;
        }
        if (Array.isArray(v)) {
            const out = v.map((element, i) => deepRewrite(element, collisions, atReference, `${at}[${i}]`));
            if (atReference) {
                const firstAt = new Map<string, number>();
                out.forEach((element, i) => {
                    if (typeof element !== 'string') return;
                    const j = firstAt.get(element);
                    if (j === undefined) {
                        firstAt.set(element, i);
                    } else if (v[j] !== v[i]) {
                        collisions.push({ at, shape: 'entry', moved: v[i] !== element ? v[i] : v[j], met: element });
                    }
                });
            }
            return out;
        }
        if (v && typeof v === 'object') {
            const o: any = {};
            const from = new Map<string, string>();
            for (const [k, val] of Object.entries(v)) {
                const key = atReference ? (renameMap.get(k) ?? k) : k;
                const other = from.get(key);
                if (other !== undefined) {
                    collisions.push({ at, shape: 'key', moved: key === k ? other : k, met: key });
                }
                from.set(key, k);
                const entry = deepRewrite(
                    val, collisions,
                    objectReferenceProperties.has(k) || (atReference && k === 'name'),
                    at ? `${at}.${k}` : k,
                );
                // ⭐ A RECORD ENTRY'S `name` FOLLOWS ITS KEY. An entry that
                // echoes its key in `name` (an object's field: `fields`
                // keyed by field name) is ONE identity spelled twice, so
                // the name takes the key's rename decision. Outside a
                // reference site a key is never renamed, while the
                // free-text rewrite above renamed a `name` equal to a
                // prefixed object's: the field `iojn_customer` was copied
                // as `fields.iojn_customer.name: 'iojn2_customer'`. The
                // data plane addresses the column by the key, the save
                // door's FLS lint reads the `name`, so a copied permission
                // set's rule on that field was refused at the copy.
                if (typeof (val as any)?.name === 'string' && (val as any).name === k
                    && entry && typeof entry === 'object' && !Array.isArray(entry)) {
                    entry.name = key;
                }
                o[key] = entry;
            }
            return o;
        }
        return v;
    };
    const describeCollision = (c: ReferenceCollision): string =>
        `its \`${c.at}\` ${c.shape} '${c.moved}' follows the copied object to '${c.met}', `
        + `${c.shape === 'key' ? 'a key' : 'an entry'} it already holds there, which this copy does not rename. `
        + (c.shape === 'key'
            ? 'A record keeps one entry per key, so the copy would drop one of the two. '
            : `The copy would name '${c.met}' twice. `)
        + `Remove '${c.moved}' or '${c.met}' on the source, then duplicate again.`;
    // ⭐ A COPIED PERMISSION SET'S FIELD RULES FOLLOW THE RENAMED OBJECTS.
    // `PermissionSetSchema.fields` is a record keyed `<entity_name>.<field_name>`
    // (`packages/spec/src/security/permission.zod.ts`), and the security
    // plugin reads a set's rules for an object by the key prefix
    // `<object>.` (`PermissionEvaluator.getFieldPermissions`). Left as
    // stored, the copy's rules govern the SOURCE's object and the
    // duplicate's object gets none: a field the source set hides is
    // readable on the copy for whoever holds the copied set.
    //
    // `deepRewrite` cannot carry it: the derived site index reads
    // `permission.fields` as a site naming `field` items (its property
    // spells that type), never an object, and has no arm for a composite
    // key — and widening the index would also change the "Used by" answer
    // it feeds (`findReferencesToMeta`). So this step is keyed on the
    // declared shape — the `fields` record of a copied `permission` item —
    // never on a property name, which would also catch an object's own
    // `fields` (keyed by field name).
    //
    // The split: object and field names are both `^[a-z_][a-z0-9_]*$`, so
    // a key's object part is everything before its FIRST `.`. It is
    // rewritten only when it equals a renamed object name exactly, and the
    // field part is never read — `dupsrc_customer.dupsrc_customer` becomes
    // `dupdst_customer.dupsrc_customer`. A key naming an object outside the
    // package keeps its name.
    //
    // ⛔ REFUSED, NEVER MERGED: when a renamed key equals a key the set
    // already holds (the source also governs an object, outside the
    // package, named like the copy), keeping either rule would silently
    // drop the other, so the set is reported in `failed[]` with both keys.
    // `Object.fromEntries` defines own properties, so no key can land on
    // the prototype.
    const rewriteFieldRuleKeys = (fields: Record<string, unknown>): { fields: Record<string, unknown> } | { collision: string } => {
        const out = new Map<string, unknown>();
        const from = new Map<string, string>();
        for (const [key, rule] of Object.entries(fields)) {
            const dot = key.indexOf('.');
            const renamed = dot > 0 ? renameMap.get(key.slice(0, dot)) : undefined;
            const next = renamed === undefined ? key : `${renamed}${key.slice(dot)}`;
            const other = from.get(next);
            if (other !== undefined) {
                const moved = next === key ? other : key;
                return {
                    collision: `its field rule '${moved}' follows object '${moved.slice(0, moved.indexOf('.'))}' `
                        + `to '${next}', a key the set already holds for object `
                        + `'${next.slice(0, next.indexOf('.'))}', which this copy does not rename. `
                        + `Remove '${moved}' or '${next}' on the source, then duplicate again.`,
                };
            }
            out.set(next, rule);
            from.set(next, key);
        }
        return { fields: Object.fromEntries(out) };
    };

    // [ADR-0146 D10, #28564] ⭐ THE `__c` RESERVATION, JUDGED AGAINST THE
    // TARGET, before the copy's first mutation (the package record below):
    // every object the copy would write is the target's own object, so a
    // copy of a `.custom` pair's objects into a plain id carries their
    // `__c` fields into a package that may not declare one. Refused whole,
    // with the save door's judge and envelope (`VALIDATION_ERROR` / 400),
    // so no half-copied app is left behind; a copy into a pair id writes
    // the pair's own objects, which are not judged. An unparseable row is
    // left to the copy loop, which reports it. See
    // {@link judgeExtensionFieldSuffix}.
    {
        const copiedObjects: Record<string, unknown> = {};
        for (const row of rows) {
            if (row?.type !== 'object' || typeof row.name !== 'string') continue;
            let body: unknown;
            try {
                body = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            } catch {
                continue;
            }
            if (body && typeof body === 'object' && !Array.isArray(body)) {
                copiedObjects[row.name] = { ...(body as Record<string, unknown>), name: renameMap.get(row.name) ?? row.name };
            }
        }
        const suffixRefusals = judgeExtensionFieldSuffix({ packageId: request.targetPackageId, objects: copiedObjects });
        if (suffixRefusals.length > 0) throw extensionFieldSuffixRefusalError(suffixRefusals);
    }

    if (srcPkg?.manifest && typeof registry?.installPackage === 'function') {
        try {
            // Route through installPackage (not a bare registry write) so the
            // duplicated base ALSO lands in sys_packages — otherwise the copy
            // would vanish from GET /packages on the next restart (#2532).
            // Spread-then-strip: the source may carry `scope` (e.g. 'project'
            // on a code package) — copying it would brand the duplicate as
            // read-only in every writability heuristic, when the whole point
            // of a duplicate is a WRITABLE base. The copy is scope-less.
            const dupManifest: Record<string, unknown> = {
                ...srcPkg.manifest,
                id: request.targetPackageId,
                name: request.targetName ?? `${srcPkg.manifest.name ?? request.sourcePackageId} (copy)`,
                namespace: targetNs,
            };
            delete dupManifest.scope;
            await host.installPackage({ manifest: dupManifest } as InstallPackageRequest);
        } catch (e: any) {
            // [#24041] ⭐ A REFUSED PACKAGE RECORD REFUSES THE DUPLICATE —
            // the refusal itself, rethrown unchanged, before any item is
            // copied (ruling B, claim amendment 6227008947).
            //
            // This catch used to drop it and copy anyway. A refused install
            // leaves no registry record and no `sys_packages` row, so the
            // copy's items were live, bound to an id no package record
            // holds, absent from `GET /packages`. After a namespace conflict
            // they also sat inside a namespace another package owns — the
            // very state ADR-0048 Phase 1's install-time gate in
            // `SchemaRegistry.installPackage` exists to refuse. The sibling
            // verb {@link importUnmanagedPackage} states the rule this door
            // now keeps: "There is no half-copied app."
            //
            // Nothing needs undoing: this call is the duplicate's FIRST
            // mutation (everything above it reads), and a refused install
            // leaves nothing behind — the registry judges before it writes,
            // and a failed persist undoes the registry write before it
            // throws (#21243). So the door answers the refusal's own status:
            // `422 NAMESPACE_CONFLICT` with the registry's remedy (choose
            // another namespace), or the primitive's `500` for a store fault.
            //
            // Logged once, because neither the primitive nor the HTTP door
            // logs it. A store fault's driver text rides only on the error's
            // `cause`, which no answer quotes, so the error itself is handed
            // to the log for that one; a client refusal's sentence is
            // already the whole story.
            console.warn(
                `[protocol.duplicatePackage] refused: the package record for '${request.targetPackageId}' `
                + `(copy of '${request.sourcePackageId}') was not installed, so nothing was copied: `
                + `${typeof e?.code === 'string' ? `${e.code}: ` : ''}${e?.message ?? e}`,
                ...(declaresClientRefusal(e) ? [] : [e]),
            );
            throw e;
        }
    }

    const copied: Array<{ type: string; name: string }> = [];
    const failed: Array<{ type: string; name: string; error: string }> = [];
    // Resolved once for the whole copy: every flow row in this package needs
    // the same engine, and a package with fifty flows should not walk the
    // service table fifty times.
    const canonicalizeFlow = host.resolveFlowCanonicalizer();

    for (const row of rows) {
        const refusal = row?.type === 'object' ? refusedObjects.get(row.name) : undefined;
        if (refusal !== undefined) {
            failed.push({ type: row.type, name: row.name, error: refusal });
            continue;
        }
        const newName = row?.type === 'object'
            ? (renameMap.get(row.name) ?? row.name)
            : isQualifiedViewRow(row)
                ? (viewItemRenames.get(row.name) ?? row.name)
                : renameName(row.name);
        const rawType = String(row.type);
        const singular = PLURAL_TO_SINGULAR[rawType] ?? rawType;
        let body: unknown;
        try {
            body = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata ?? {});
        } catch {
            failed.push({ type: row.type, name: row.name, error: 'unparseable metadata' });
            continue;
        }

        // Canonicalize the source row before re-saving (#3903): the copy is
        // a NEW write and must pass today's schema gate, so a legacy shape
        // the chain owns is lifted rather than failing the copy —
        // duplication never mints new rows in a pre-protocol dialect.
        //
        // For `flow` that guarantee was false until #4498: `convertStoredItem`
        // returns flows untouched, and `FlowNodeSchema.config` is an open
        // `z.record`, so a pre-17 body (`delete_record` with `config.filters`)
        // sailed through `saveMetaItem` and landed verbatim in a brand-new
        // row. ADR-0087 justifies the whole stored-metadata design on new
        // writes being canonical — "a strictly shrinking concern" — and this
        // was the one live producer contradicting it.
        let item: any;
        if (singular === 'flow') {
            if (!canonicalizeFlow) {
                // No engine in this process (control-plane / metadata-only
                // host). Copy the source body as-is — the honest behaviour,
                // and no worse than the source row already is — rather than
                // failing a duplication that has nothing to do with flows.
                // `os migrate meta --stored --apply` is the finish line for
                // both rows, and it reports what it could not canonicalize.
                item = body;
            } else {
                try {
                    const result = canonicalizeFlow(String(row.name ?? ''), body);
                    item = result.storable;
                } catch (e: any) {
                    // `FlowSchema` is strict (#4001) and the region validator
                    // hard-fails: this source row cannot register at all, so
                    // the copy would be broken the same way. Report it.
                    failed.push({
                        type: row.type,
                        name: row.name,
                        error: `the flow does not canonicalize: ${e?.message ?? String(e)}`,
                    });
                    continue;
                }
            }
        } else {
            try {
                item = host.convertStoredItem(rawType, body);
            } catch (e: any) {
                // A tombstoned key throws here (ADR-0087 D2) — a genuine
                // contract violation in the source, not a parse failure.
                failed.push({
                    type: row.type,
                    name: row.name,
                    error: `the source item does not convert: ${e?.message ?? String(e)}`,
                });
                continue;
            }
        }
        const collisions: ReferenceCollision[] = [];
        const rewritten = deepRewrite(item, collisions);
        if (collisions.length > 0) {
            const noun = singular === 'permission'
                ? 'Permission set'
                : `${singular.charAt(0).toUpperCase()}${singular.slice(1)}`;
            const more = collisions.length - 1;
            failed.push({
                type: row.type,
                name: row.name,
                error: `${noun} '${row.name}' is not copied: ${describeCollision(collisions[0]!)}`
                    + (more > 0 ? ` It has ${more} more such collision${more === 1 ? '' : 's'}.` : ''),
            });
            continue;
        }
        if (rewritten && typeof rewritten === 'object' && !Array.isArray(rewritten)) {
            rewritten.name = newName;
            // [ADR-0086 D3] A permission set that declares its SOURCE
            // package as its owner is copied declaring the target, the
            // package the copy is saved into: the save door refuses a
            // `packageId` that disagrees with that binding
            // ({@link permissionSetOwnerBindingRefusal}), and the copy's
            // owner is the target. Any other declared value is left as
            // stored, so a source row that already disagreed with its own
            // binding is reported in `failed[]` with the door's remedy.
            if (singular === 'permission' && rewritten.packageId === request.sourcePackageId) {
                rewritten.packageId = request.targetPackageId;
            }
            if (singular === 'permission' && rewritten.fields
                && typeof rewritten.fields === 'object' && !Array.isArray(rewritten.fields)) {
                const result = rewriteFieldRuleKeys(rewritten.fields);
                if ('collision' in result) {
                    failed.push({
                        type: row.type,
                        name: row.name,
                        error: `Permission set '${row.name}' is not copied: ${result.collision}`,
                    });
                    continue;
                }
                rewritten.fields = result.fields;
            }
        }
        try {
            await host.saveMetaItem({
                type: row.type,
                name: newName,
                item: rewritten,
                mode: 'publish',
                packageId: request.targetPackageId,
                // [commit 82cb6e849] Which door the refusal below will be prescribing
                // a remedy FOR. Stated by the server, never by the caller —
                // `duplicatePackage`'s own request type has no such field,
                // exactly as `source` is server-stated one gate down. The
                // Phase 3a-destructive gate reaches this call on the
                // duplicate-AGAIN workflow, and its `?force=true` default
                // would name a parameter this door does not accept.
                writeFace: 'package-duplicate',
                ...(request.actor ? { actor: request.actor } : {}),
            });
            copied.push({ type: row.type, name: newName });
        } catch (e: any) {
            // [#8333 · P10] `failed[].error` is copy-response DATA.
            // Measured on `origin/main` by failing the `sys_metadata`
            // insert under `saveMetaItem`: the field carried `SQLITE_ERROR:
            // no such table: sys_metadata` verbatim.
            //
            // This `try` wraps exactly one call, and `saveMetaItem`'s
            // authored refusals all declare 4xx — the spec rejection is
            // `422 INVALID_METADATA` (measured: the whole "Unrecognized
            // key(s) on this view container … Wrap it: `defineView({ … })`"
            // prescription comes through unchanged), the author-time gate
            // likewise 422, the org/overridability refusals 403. Nothing an
            // author needs is blanked.
            //
            // ⛔ The two sibling `failed[]` pushes ABOVE this one (`the flow
            // does not canonicalize` / `the source item does not convert`)
            // are deliberately untouched: they interpolate authored
            // schema-validation text, not driver text, and #8333 records
            // them as examined-and-left.
            failed.push({
                type: row.type, name: row.name,
                error: clientFacingFailureText(e, 'copy failed'),
            });
            console.warn(
                `[protocol.duplicatePackage] copy failed for ${row.type}/${row.name} → `
                + `'${request.targetPackageId}': ${e?.message ?? e}`,
            );
        }
    }
    return {
        success: failed.length === 0 && copied.length > 0,
        copiedCount: copied.length,
        failedCount: failed.length,
        targetPackageId: request.targetPackageId,
        copied,
        failed,
    };
}

/** The body of `ObjectStackProtocolImplementation#importUnmanagedPackage`; the method's docblock there is its contract. */
export async function importUnmanagedPackage(host: Pick<ProtocolHost, 'convertStoredItem' | 'engine' | 'installPackage' | 'isRuntimeCreateAllowed' | 'refuseOrganizationScopedWrite' | 'resolveFlowCanonicalizer' | 'rollBackUnmanagedImport' | 'saveMetaItem' | 'unmanagedImportCollisions'>, request: ImportUnmanagedPackageRequest & { actor?: string },): Promise<ImportUnmanagedPackageResponse> {
    const rawSourceId = (request as { manifest?: { id?: unknown } } | undefined)?.manifest?.id;
    const sourceLabel = typeof rawSourceId === 'string' && rawSourceId !== '' ? rawSourceId : '(unnamed)';
    // 1. FIRST, as on every package write verb.
    host.refuseOrganizationScopedWrite(`Package '${sourceLabel}'`, request);

    // 2. The request, through its published declaration. The two keys that
    //    are never a body's — the door's `actor`, and the organization the
    //    refusal above has already judged — are read off before the parse.
    const { actor, organizationId: _scopeJudgedAbove, ...body } =
        (request ?? {}) as ImportUnmanagedPackageRequest & { actor?: string; organizationId?: unknown };
    const declared = ImportUnmanagedPackageRequestSchema.safeParse(body);
    if (!declared.success) {
        const issues = zodIssuesToMetadataIssues(declared.error.issues);
        throw Object.assign(
            new Error(`Invalid unmanaged install request: ${metadataIssueHeadline(issues)}.`),
            { statusCode: 400, issues },
        );
    }

    // 3. The deployment walls organizations: nothing is read or written.
    const walled = unmanagedInstallPostureRefusal(sourceLabel);
    if (walled) throw walled;

    // 4. Everything the body alone can answer.
    const plan = planUnmanagedImport(declared.data.manifest, {
        ...(declared.data.targetPackageId !== undefined ? { targetPackageId: declared.data.targetPackageId } : {}),
        ...(declared.data.targetName !== undefined ? { targetName: declared.data.targetName } : {}),
        // The save door's own predicate — registry-only, the hatch unread.
        isRuntimeCreatable: (type) => host.isRuntimeCreateAllowed(type),
        // The save door's own schema, asked which types declare the
        // `protection` block the copy strips (ADR-0010 Phase 4.3).
        protectionDeclarationOf: (type) => overlaySchemaDeclaredKey(type, 'protection'),
        loadOrderOf: (type) =>
            DEFAULT_METADATA_TYPE_REGISTRY.find((entry) => entry.type === type)?.loadOrder ?? Number.MAX_SAFE_INTEGER,
    });
    const { sourcePackageId, targetPackageId, namespace } = plan;

    // 5. The handshake `installPackage` asks too — asked here so a refusal
    //    precedes the base.
    assertProtocolCompat(declared.data.manifest);

    // 6. A NEW base, under a namespace nobody owns.
    const registry: any = (host.engine as any).registry;
    if (registry?.getPackage?.(targetPackageId) || (host.engine as any).manifests?.has?.(targetPackageId)) {
        throw Object.assign(new Error(
            `Package '${targetPackageId}' already exists. An unmanaged install of '${sourcePackageId}' writes into a `
            + 'NEW base, never into an existing one. Name another `targetPackageId`, or uninstall '
            + `'${targetPackageId}' first.`,
        ), { code: 'RESOURCE_CONFLICT', status: 409, details: { targetPackageId } });
    }
    const owners: unknown = registry?.getNamespaceOwners?.(namespace);
    if (Array.isArray(owners) && owners.length > 0) {
        throw Object.assign(new Error(
            `The namespace '${namespace}' of package '${sourcePackageId}' is already owned by `
            + `${owners.map((o) => `'${String(o)}'`).join(', ')}. The unmanaged copy keeps the source namespace, `
            + 'so it cannot sit beside a package that owns it — a managed install of this same package '
            + 'included. Uninstall that package first, or keep the managed install.',
        ), { code: 'RESOURCE_CONFLICT', status: 409, details: { namespace, owners } });
    }

    // 7. Today's protocol, item by item — the conversion a managed install
    //    applies to an artifact, so an older package imports as it installs.
    const canonicalizeFlow = plan.items.some((i) => i.type === 'flow') ? host.resolveFlowCanonicalizer() : undefined;
    const prepared: Array<{ type: string; name: string; item: unknown }> = [];
    const unconvertible: string[] = [];
    for (const planned of plan.items) {
        try {
            if (planned.type !== 'flow') {
                prepared.push({ type: planned.type, name: planned.name, item: host.convertStoredItem(planned.type, planned.body) });
            } else if (!canonicalizeFlow) {
                // No engine in this process: the body as declared, exactly as
                // `duplicatePackage` copies it; the save door still judges it.
                prepared.push({ type: planned.type, name: planned.name, item: planned.body });
            } else {
                const result = canonicalizeFlow(planned.name, planned.body);
                prepared.push({ type: planned.type, name: planned.name, item: result.storable });
            }
        } catch (e: any) {
            unconvertible.push(`${planned.type} '${planned.name}': ${e?.message ?? String(e)}`);
        }
    }
    if (unconvertible.length > 0) {
        throw Object.assign(new Error(
            `Package '${sourcePackageId}' cannot be installed unmanaged: ${unconvertible.length} item(s) do not convert `
            + `to this runtime's protocol — ${unconvertible.slice(0, 3).join('; ')}`
            + `${unconvertible.length > 3 ? ` (+${unconvertible.length - 3} more)` : ''}. Rebuild the package against `
            + 'this protocol, then install again.',
        ), { code: 'INVALID_METADATA', status: 422 });
    }
    // 8. Every name the copy would take, against the environment and the
    //    managed packages — the save door would refuse or overlay them.
    const collisions = await host.unmanagedImportCollisions(plan.items);
    if (collisions.length > 0) {
        throw Object.assign(new Error(
            `Package '${sourcePackageId}' cannot be installed unmanaged: ${collisions.length} of its names are already `
            + `taken — ${collisions.slice(0, 3).map((c) => `${c.type} '${c.name}' (${c.heldBy})`).join('; ')}`
            + `${collisions.length > 3 ? ` (+${collisions.length - 3} more)` : ''}. The copy keeps every name `
            + 'the package declares, so remove or rename the items that hold them, then install again.',
        ), { code: 'RESOURCE_CONFLICT', status: 409, details: { collisions } });
    }

    // The base. Not best-effort: a refusal here is the import's, and
    // `installPackage` leaves nothing behind when it refuses.
    await host.installPackage({ manifest: plan.baseManifest } as InstallPackageRequest);

    const copied: Array<{ type: string; name: string }> = [];
    for (const item of prepared) {
        try {
            await host.saveMetaItem({
                type: item.type,
                name: item.name,
                item: item.item,
                mode: 'publish',
                packageId: targetPackageId,
                // Server-stated, as on every face: no body reaches this field.
                writeFace: 'package-unmanaged-import',
                ...(actor ? { actor } : {}),
            });
            copied.push({ type: item.type, name: item.name });
        } catch (e: any) {
            throw await host.rollBackUnmanagedImport(e, {
                sourcePackageId, targetPackageId, failed: item, copiedCount: copied.length, actor,
            });
        }
    }

    return {
        sourcePackageId,
        ...(plan.sourceVersion !== undefined ? { sourceVersion: plan.sourceVersion } : {}),
        targetPackageId,
        namespace,
        copiedCount: copied.length,
        copied,
        // Planned before the base existed; every item was written, so every
        // lock listed was dropped from a copy that now exists.
        strippedLocks: plan.strippedLocks,
    };
}

/** The body of `ObjectStackProtocolImplementation#reassignOrphanedMetadata`; the method's docblock there is its contract. */
export async function reassignOrphanedMetadata(host: Pick<ProtocolHost, 'applyRegistryWriteThrough' | 'classifyObjectContribution' | 'engine' | 'findEnvironmentRows' | 'isArtifactBacked' | 'overlayPackageMismatchError' | 'refuseOrganizationScopedWrite' | 'releaseAdoptedObjectOwner' | 'storedOverlayEntries'>, request: {
        targetPackageId: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        reassignedCount: number;
        reassigned: Array<{ type: string; name: string }>;
        targetPackageId: string;
    }> {
    // [ADR-0131 D6] FIRST: an organization-scoped adoption is refused.
    host.refuseOrganizationScopedWrite(
        `Package '${request.targetPackageId}'`, request,
    );
    // The ENVIRONMENT's orphans: ADR-0070 D5 makes the environment the unit
    // ("bulk-assign legacy orphans to a default base named for the
    // environment"), and since ADR-0131 D6 every new orphan is
    // environment-wide (`saveMetaItem` writes `organization_id = NULL`). A
    // legacy organization-scoped row is left as it is stored — rebinding
    // it would be an organization-scoped write; the promotion ceremony
    // (ADR-0131 C7) carries it to the environment layer, where a later
    // adoption sees it.
    const where: Record<string, unknown> = {};
    // [#21911] The explicit system opt-in — see findServedOverlayRow.
    const rows = (await host.findEnvironmentRows('sys_metadata', { where, context: { isSystem: true } })) as any[];
    const orphans = rows.filter(
        (r) => (r?.package_id == null || r.package_id === '' || r.package_id === 'sys_metadata')
            // [#23198] An overlay of an artifact item keeps its binding
            // (ADR-0070); see the header. The type folds as the save's does.
            && !host.isArtifactBacked(PLURAL_TO_SINGULAR[r.type] ?? r.type, String(r.name)),
    );

    // [ADR-0029 D9.9, ADR-0086 D3, #28776] ⭐ THE OWNER JUDGES, in the save
    // door's order (before the `__c` judge below), against the TARGET and
    // before the first update: refused whole, each with its own envelope.
    // The object arm skips the `'sys_metadata'` sentinel owner, the orphan's
    // own registration this adoption hands over; see the header.
    for (const row of orphans) {
        if (row?.state !== 'active' || typeof row.name !== 'string') continue;
        const type = canonicalMetaType(String(row.type));
        if (type === 'object') {
            const layer = host.classifyObjectContribution(row.name, request.targetPackageId);
            if (layer.kind === 'mismatch' && layer.ownerPackageId !== 'sys_metadata') {
                throw host.overlayPackageMismatchError(
                    row.name, request.targetPackageId, layer.ownerPackageId,
                );
            }
        } else if (type === 'permission') {
            let body: unknown;
            try {
                body = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            } catch {
                continue;
            }
            const ownerRefusal = permissionSetOwnerBindingRefusal(
                type, body, row.name, request.targetPackageId, 'save',
            );
            if (ownerRefusal) throw ownerRefusal;
        }
    }

    // [ADR-0146 D10, #28735] ⭐ THE `__c` RESERVATION, JUDGED AGAINST THE
    // TARGET, before the first update below: each active object row this
    // adoption rebinds becomes the target's own object. Refused whole, with
    // the save door's judge and envelope; see the header. An unparseable
    // row is left to the loop, as `duplicatePackage` leaves it.
    {
        const adoptedObjects: Record<string, unknown> = {};
        for (const row of orphans) {
            if (canonicalMetaType(String(row?.type)) !== 'object' || row.state !== 'active') continue;
            if (typeof row.name !== 'string') continue;
            let body: unknown;
            try {
                body = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            } catch {
                continue;
            }
            if (body && typeof body === 'object' && !Array.isArray(body)) {
                adoptedObjects[row.name] = { ...(body as Record<string, unknown>), name: row.name };
            }
        }
        const suffixRefusals = judgeExtensionFieldSuffix({ packageId: request.targetPackageId, objects: adoptedObjects });
        if (suffixRefusals.length > 0) throw extensionFieldSuffixRefusalError(suffixRefusals);
    }

    const reassigned: Array<{ type: string; name: string }> = [];
    // [#12981] The refusal channel this loop used to lack entirely.
    //
    // The catch below is the card's defining shape, and this method is the
    // sharpest instance of it in the file: a refused `update` was dropped
    // whole -- not logged, not rethrown, not carried on the response -- and
    // the return then reported `success: reassigned.length > 0`. So an
    // adoption where 99 of 100 orphans were refused answered
    // `{success: true, reassignedCount: 1}`, byte-identical in shape to a
    // healthy run with one orphan to move, and the 99 stayed orphans with
    // nothing anywhere recording that they had been tried. Nothing retries
    // them and no later boot reconstructs the attempt.
    //
    // A COUNTER plus one report AFTER the loop, deliberately, and not a
    // `console.error` inside the catch: AGENTS.md -> "Degradation log
    // levels" says an operator-facing degradation is stated ONCE, at the
    // first occurrence, not once per failed write -- and a refused
    // `sys_metadata` write is refused for every row, so the per-row
    // spelling would print one line per orphan in the environment. This is
    // the same shape #12923's shared refusal accumulator takes at the other
    // repaired seams of this family.
    let refusedCount = 0;
    let firstRefusal = '';
    for (const row of orphans) {
        try {
            await host.engine.update(
                'sys_metadata',
                { package_id: request.targetPackageId },
                { where: { id: row.id }, context: { isSystem: true } },
            );
            reassigned.push({ type: row.type, name: row.name });
        } catch (e: any) {
            // Control flow is UNCHANGED: a row that cannot be rebound must
            // not abort the adoption of the rows that can. Only the
            // silence changes.
            refusedCount += 1;
            if (firstRefusal === '') firstRefusal = e?.message ?? String(e);
            continue;
        }
        // [#23198] The registry follows the rebound row now, not at the
        // next restart; see the header. [#23646] A view, and an object.
        const type = canonicalMetaType(String(row.type));
        if (type !== 'view' && type !== 'object') continue;
        // [#23646, #23690] Only an ACTIVE row reaches the registry: the
        // boot registers no other ({@link loadMetaFromDb}), and a draft
        // never reaches the runtime. An adopted draft is rebound in
        // storage only.
        if (row.state !== 'active') continue;
        let rebound: { name: string; data: unknown };
        try {
            // The row as the list read hydrates it, at its new binding.
            [rebound] = host.storedOverlayEntries({ type }, [{ ...row, package_id: request.targetPackageId }]);
        } catch (err: any) {
            // Best-effort, as the write-through's own failure is: the row
            // is rebound, and the next list read hydrates it.
            console.warn(`[Protocol] registry write-through failed for ${type}/${row.name}: ${err?.message ?? err}`);
            continue;
        }
        // [#23646] An object's one registry owner moves with its row.
        if (
            type === 'object'
            && !host.releaseAdoptedObjectOwner(rebound.name, rebound.data, request.targetPackageId)
        ) {
            continue;
        }
        await host.applyRegistryWriteThrough({
            type,
            name: rebound.name,
            item: rebound.data,
            packageId: request.targetPackageId,
            organizationId: null,
            reboundFrom: { packageId: row.package_id ?? null },
        });
    }
    if (refusedCount > 0) {
        // `error` and not `warn`, by the one question AGENTS.md turns this
        // on -- after the degradation the system still looks normal from
        // the outside while something it claims to have persisted did not
        // land. It is the same verdict, on the same sink, that
        // `recordPackageCommit` in this file already reaches for the
        // `sys_metadata_commit` write, and the inverse of the one
        // `clientFacingRowFailureText` records for its `console.warn`
        // (there the row reports `success: false` and the counters
        // reconcile, so nothing was silently dropped; here neither holds).
        console.error(
            `[Protocol] reassignOrphanedMetadata: ${refusedCount} of ${orphans.length} orphaned `
            + `metadata row(s) were NOT rebound to package '${request.targetPackageId}' -- the `
            + `update was REFUSED. The call still answers reassignedCount=${reassigned.length}`
            + `${reassigned.length > 0 ? ' with success: true' : ''}, so nothing looks broken, but `
            + 'those rows are STILL orphans: they keep `package_id` null or the `sys_metadata` '
            + 'sentinel, this environment has NOT converged on the package-first model (ADR-0070 '
            + 'D5 completes when an environment has no orphans), and nothing retries them. '
            + `First refusal: ${firstRefusal}. Fix: restore write access to \`sys_metadata\` for `
            + 'the system context and run the adoption again -- it is idempotent, rows already '
            + 'bound to a real package are left untouched.',
        );
    }
    return {
        success: reassigned.length > 0,
        reassignedCount: reassigned.length,
        reassigned,
        targetPackageId: request.targetPackageId,
    };
}

/** The body of `ObjectStackProtocolImplementation#listCommits`; the method's docblock there is its contract. */
export async function listCommits(host: Pick<ProtocolHost, 'findEnvironmentRows' | 'parseCommitItems' | 'rethrowUnlessMetadataStoreUnprovisioned'>, request: {
        packageId: string;
        limit?: number;
    }): Promise<Array<{
        id: string;
        operation: 'apply' | 'revert';
        message?: string;
        actor?: string;
        aiModel?: string;
        parentCommitId?: string;
        itemCount: number;
        /**
         * [#23073] `member` — the bundle member the item is (`'zh-CN'`, the
         * canonical `'en-US'`), as the stored revert plan records it; absent
         * for a type with no members.
         */
        items: Array<{ type: string; name: string; member?: string; existedBefore: boolean; prevVersion: number | null }>;
        createdAt?: string;
    }>> {
    try {
        // [ADR-0131 D6] The environment's timeline, whoever asks. A legacy organization-scoped commit row is
        // refused at boot (the v18 boot refusal, ADR-0131 D10 item 5) and
        // never served — the same rule as the legacy `sys_metadata` rows
        // it recorded, which no read serves either. So the timeline an
        // operator reverts from ({@link rollbackToPackageCommit} filters
        // this list) holds exactly the commits whose changes the reads
        // serve, and no organization's history is shown to another
        // organization's operator.
        const where: Record<string, unknown> = { package_id: request.packageId };
        // [#21908, ADR-0096 D5] The explicit system opt-in: the commit ledger is a
        // platform store the door already authorized. Principal-less, the
        // engine refuses it.
        const rows = (await host.findEnvironmentRows('sys_metadata_commit', {
            where,
            ...(request.limit ? { limit: request.limit } : {}),
            context: { isSystem: true },
        })) as any[];
        const mapped = rows.map((r) => ({
            id: r.id,
            operation: (r.operation ?? 'apply') as 'apply' | 'revert',
            ...(r.message ? { message: r.message } : {}),
            ...(r.actor ? { actor: r.actor } : {}),
            ...(r.ai_model ? { aiModel: r.ai_model } : {}),
            ...(r.parent_commit_id ? { parentCommitId: r.parent_commit_id } : {}),
            itemCount: typeof r.item_count === 'number' ? r.item_count : 0,
            // [#23073] The declared item (`ListPackageCommitsResponseSchema`),
            // with the plan item's stored member — the one `revertCommit`
            // acts on — on every item of a bundled type: absent there means
            // the canonical member, which is spelled out here.
            items: host.parseCommitItems(r.items).map(({ member: stored, ...item }) => {
                const member = bundleMemberDiscriminator(item.type, stored);
                return member === undefined ? item : { ...item, member };
            }),
            // [#14038] Canonicalise the ONE driver materialisation this
            // column is measured to produce (a valid JS `Date`, on
            // Postgres/MySQL); every other shape — including an
            // Invalid `Date` — passes through unchanged. See {@link
            // isoFromValidDate}.
            ...(r.created_at ? { createdAt: isoFromValidDate(r.created_at) as string } : {}),
        }));
        // Newest-first; tolerate drivers that don't order by returning
        // insertion order, then sort by the audit instant.
        //
        // [#13995] The comparison is on INSTANTS, not on the raw column's
        // `String()` spelling.
        // The comment here used to say "sort by the ISO timestamp" - an
        // assumption written down and never verified, and false on the
        // production default driver: Postgres and MySQL materialise this
        // column as a JS `Date`, whose string spelling LEADS WITH THE WEEKDAY
        // NAME, so this timeline was ordered `Fri < Mon < Sat < ...` while
        // claiming newest-first. See {@link compareAuditInstants}.
        mapped.sort((a, b) => compareAuditInstants(b.createdAt, a.createdAt));
        return mapped;
    } catch (error) {
        // [#5980] Benign (the table has not been provisioned) falls through;
        // everything else is a read that did not happen and leaves as a 503.
        host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata_commit');
        return [];
    }
}

/** The body of `ObjectStackProtocolImplementation#readRevertableCommit`; the method's docblock there is its contract. */
export async function readRevertableCommit(host: Pick<ProtocolHost, 'engine' | 'legacyOrganizationRowsOf' | 'organizationScopedWriteRefusal'>, commitId: string, packageId?: string): Promise<any> {
    // [#21908, ADR-0096 D5] The explicit system opt-in: the commit ledger is a
    // platform store the door already authorized; the protocol scopes the
    // `where` by organization itself. Principal-less, the engine refuses it.
    const row = (await host.engine.findOne('sys_metadata_commit', { where: { id: commitId }, context: { isSystem: true } })) as any;
    if (!row) {
        const err: any = new Error(`No commit '${commitId}'.`);
        err.code = 'COMMIT_NOT_FOUND';
        err.status = 404;
        throw err;
    }
    if (packageId !== undefined && String(row.package_id) !== packageId) {
        const err: any = new Error(`No commit '${commitId}' in package '${packageId}'.`);
        err.code = 'COMMIT_NOT_FOUND';
        err.status = 404;
        throw err;
    }
    const legacyCommits = await host.legacyOrganizationRowsOf('sys_metadata_commit');
    const legacy = host.organizationScopedWriteRefusal(
        `Commit '${commitId}'`,
        legacyCommits.get(String(row.id)) ?? null,
        'It records a change to that organization\'s legacy layer, which no write reaches any more.',
    );
    if (legacy) throw legacy;
    return row;
}

/** The body of `ObjectStackProtocolImplementation#revertCommit`; the method's docblock there is its contract. */
export async function revertCommit(host: Pick<ProtocolHost, 'applyRegistryWriteThrough' | 'emitMetadataMutation' | 'ensureOverlayIndex' | 'getOverlayRepo' | 'isArtifactBacked' | 'namedBaseOverlayWriteRefusal' | 'parseCommitItems' | 'readRevertableCommit' | 'recordPackageCommit' | 'refuseOrganizationScopedWrite' | 'restoreArtifactRegistryView' | 'restoreWriteFor' | 'runMutationProjector'>, request: {
        commitId: string;
        /**
         * The package the commit must belong to (ADR-0067): a commit of any
         * other package is refused `COMMIT_NOT_FOUND` (404) and nothing is
         * written. Optional for in-process callers that name no package.
         */
        packageId?: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        revertedCount: number;
        failedCount: number;
        reverted: Array<{ type: string; name: string; action: 'removed' | 'restored' }>;
        failed: Array<{ type: string; name: string; error: string; code?: string }>;
        revertCommitId?: string;
    }> {
    // [ADR-0131 D6] FIRST: an organization-scoped revert is refused.
    host.refuseOrganizationScopedWrite(
        `Commit '${request.commitId}'`, request,
    );
    await host.ensureOverlayIndex();
    const row = await host.readRevertableCommit(request.commitId, request.packageId);
    // [#29414] The package whose rows this commit's plan describes: every
    // item's rows are read, removed and restored under it below.
    const commitPackageId: string = row.package_id;
    const items = host.parseCommitItems(row.items);
    // #4556 — threaded into repo.put/delete → `recorded_by`; NULL when the
    // revert carries no human actor.
    const actor = request.actor ?? null;
    const reverted: Array<{ type: string; name: string; action: 'removed' | 'restored' }> = [];
    const failed: Array<{ type: string; name: string; error: string; code?: string }> = [];
    // [#22877] The members of what `reverted` reports, in its order, for
    // the revert's own plan below; the response keeps its declared keys.
    const revertedMembers: Array<string | undefined> = [];

    // Reverse apply order so artifacts that depend on others (e.g. a view on
    // a new object) are removed before the thing they reference.
    for (const it of [...items].reverse()) {
        // The version this item restores to, or `null` when it does not take
        // the restore limb at all — bound ONCE (#9174), because the pre-flight
        // below and the `else if` further down must never drift apart: a gate
        // that guards a limb it no longer describes is worse than no gate,
        // since it reads as covered.
        //
        // A `const` local rather than a hoisted boolean, deliberately, and this
        // is a compiler fact rather than taste: `it.prevVersion` is a MUTABLE
        // property, so TypeScript does not carry a narrowing on it through an
        // aliased boolean, and `repo.restoreVersion(ref, it.prevVersion, …)`
        // below stops compiling (`TS2345: 'number | null' is not assignable to
        // 'number'`). Measured — the DTS build caught it while all 1651 package
        // tests stayed green, because vitest transpiles without type-checking.
        const restoreToVersion: number | null =
            it.existedBefore && it.prevVersion !== null && it.prevVersion !== undefined
                ? it.prevVersion
                : null;

        // ═══ [#9174] The AT-REST spelling pre-flight, on the RESTORE limb ══
        //
        // The third consumer of an at-rest `type` in this file, and the last
        // one without this gate. `publishPackageDrafts` refuses the class by
        // name (`STORED_TYPE_NOT_CANONICAL`, #8908) and `migrateStoredMetadata`
        // reports it `skipped` with the same reason (#8957); this door gave it
        // a server-side `console.warn` and a receipt that said `restored`.
        //
        // ── What was MEASURED at HEAD, per limb, before choosing a shape ───
        //
        // Driven end to end over the real `SysMetadataRepository` with a
        // `fields/showcase_task.title` row at rest (`protocol.revert-stored-
        // type-canonical.test.ts` carries the harness):
        //
        //   RESTORE limb — `{success: true, revertedCount: 1, failed: []}`,
        //   `reverted[0].action === 'restored'`, `registerItem` called ZERO
        //   times, and the only trace anywhere is
        //   `[Protocol] registry write-through failed for fields/… :
        //    Refusing to register a SchemaRegistry overlay entry …`
        //   (`REGISTRY_TYPE_NOT_CANONICAL`) on the server's stderr. The
        //   receipt claims the pre-commit body is what the platform now
        //   serves. It is not, and for this class it cannot be: #9111's mint
        //   door refuses the entry and boot refuses it too, so the restored
        //   body reaches no reader at all.
        //
        //   SOFT-REMOVE limb — `{success: true, action: 'removed'}`, the row
        //   is GONE from `sys_metadata`, no warning is emitted and no registry
        //   key is touched (`restoreArtifactRegistryView` folds through the
        //   manifest map, a no-op for this class, and addresses only the
        //   phantom namespace). Nothing about that outcome is wrong.
        //
        // ── Which sibling this matches, and why it is REFUSE not DECLINE ───
        //
        // `saveMetaItem`'s: a wire-visible coded refusal, carried on THIS
        // door's existing per-item `failed[]` channel — the same channel every
        // other refusal here already uses (`VERSION_NOT_FOUND`, `ITEM_LOCKED`,
        // `NOT_OVERRIDABLE`). No new receipt surface, no new error code.
        //
        // The test that separates the two siblings is whether the door can do
        // what it promises for this row. `migrateStoredMetadata` DECLINES
        // because rewriting a stored type spelling is an identity move and is
        // out of that pass's reach entirely — nothing is refused, so `skipped`
        // must not poison `storedMigrationClean` for a scan that runs forever.
        // Here the write is squarely IN reach: the restore would succeed at the
        // row and still deliver none of what `restored` promises. That is
        // `saveMetaItem`'s case — a write this door is able to perform and must
        // not — so it is refused, and `success` goes false because the commit
        // the operator asked to undo was not undone. A one-shot operator action
        // has no forever to poison; answering `success: true` over a
        // deliberately untouched item is the #5980 class of lie this file keeps
        // paying for.
        //
        // ⛔ Deliberately NOT on the soft-remove limb, and this is a scope
        // decision rather than a softened gate. That limb performs, exactly and
        // completely, the one action that improves this residue: the row goes
        // away. Refusing it would answer `success: false` for a revert that
        // fully succeeded, and would hand the operator an instruction ("drop
        // the '<plural>' row") naming the very operation it had just declined
        // to perform. #8908's own predicate is scoped the same way for the same
        // reason — it excludes the manifest-PRESENT plurals because those are
        // already fail-closed, since "widening this gate would change a
        // wire-visible `failed[].code` for rows that are NOT this defect".
        //
        // ⛔ NO fold, anywhere. The refusal writes no audit row and no commit
        // record, and `it.type` is carried into `failed[]` verbatim, so #9161's
        // ruling — the caller's spelling reaches the ledger keys unfolded, and
        // #8908's `AUDIT_TYPE_NOT_CANONICAL` fires loudly when it is wrong — is
        // untouched in both directions. The refused item is simply absent from
        // `reverted[]`, so the append-only revert commit built from it below
        // does not claim to have reverted what it did not.
        //
        // ⛔ And NOT an audit row either, unlike the publish pre-flight's.
        // That door audits because every other refusal on that route audits;
        // this one writes no audit row for ANY of its per-item failures, so a
        // row minted only for this class would be a lone entry in a ledger the
        // function otherwise never writes — and it would need the type FOLDED
        // to be readable, which is the one thing the card rules out.
        //
        // The predicate is `isNonCanonicalStoredType`, NOT the complete
        // `canonicalMetaType(t) !== t`: `objects` folds in the manifest map, so
        // the restore limb hands the write-through the canonical key and the
        // registry entry lands correctly (pinned, one file over, in
        // `protocol.object-registry-write-through-spelling.test.ts`). Refusing
        // it would be a wire-visible change for rows that are not this defect.
        if (restoreToVersion !== null && isNonCanonicalStoredType(it.type)) {
            const canonical = canonicalMetaType(it.type);
            failed.push({
                type: it.type,
                name: it.name,
                error: `Commit item '${it.type}/${it.name}' is stored under the non-canonical `
                    + `metadata type '${it.type}'; the canonical type for this item is `
                    + `'${canonical}'. Restoring it would write the pre-commit body back into a `
                    + `second namespace that no registry read and no compliance query on `
                    + `'${canonical}' can see (the '/meta' URL door now folds a type to its canonical `
                    + `spelling before it writes; this row predates that), and the registry refuses to serve it `
                    + `(REGISTRY_TYPE_NOT_CANONICAL), so the restored body would reach no reader. `
                    + `Re-author the item under '${canonical}' (PUT /meta/${canonical}/${it.name}) `
                    + `and drop the '${it.type}' row. Note that POST /meta/_migrate-stored does NOT `
                    + `rewrite a stored type spelling — it canonicalizes bodies, and reports rows `
                    + `of this class as 'skipped' with that same reason.`,
                code: 'STORED_TYPE_NOT_CANONICAL',
            });
            continue;
        }

        // [ADR-0131 D6] Every item reverts environment-wide: the commit row
        // is environment-wide (a legacy organization's was refused above).
        const repo = host.getOverlayRepo();
        const ref = { type: it.type, name: it.name, org: 'env' } as unknown as Parameters<typeof repo.get>[0];
        // [#22877] The plan item's bundle member: every row read, write
        // and heal below addresses it, so reverting a commit that changed
        // one locale of a template leaves the other locale's row alone.
        // Absent (the canonical member) on every other item, as before.
        const member = it.member;
        try {
            // [#29414] The committing package's own row, and no other
            // package's: the plan describes the rows this package's publish
            // promoted into, so every read, removal and restore below names
            // `commitPackageId`. Read package-agnostically, a pair commit
            // beside a row bound to its read-only base addressed whichever
            // row the driver returned first — the base row, refused below
            // or restored in the pair's name.
            const current = await repo.get(ref, { state: 'active', packageId: commitPackageId, ...memberOption(member) });
            if (!it.existedBefore) {
                // Created by this commit → soft-remove (metadata only; table stays).
                //
                // [#6620] The write INTENT is derived per item, exactly as
                // the sibling DELETE caller {@link deleteMetaItem} derives
                // it (and as the sibling revert caller
                // {@link rollbackMetaItem} derives its own) — all three now
                // agree. Stated as the CONSTANT `'override-artifact'` this
                // limb used to carry, `SysMetadataRepository.delete` opened
                // with `assertAllowed(ref.type, opts.intent)` — the same
                // gate `put` uses — which refuses every type that is not
                // `allowEnvironmentOverlay`, `object` among them. So a commit that
                // CREATED an object could not be reverted at all: the
                // first-build undo (publish a brand-new app, then undo it)
                // left every created object behind, answered `success:
                // false` with a populated `failed[]`, and left the package
                // half-reverted — its overlay-allowed items removed, its
                // objects not.
                //
                // Per ITEM, not per call: one first-build commit routinely
                // creates a runtime object beside a packaged-artifact name,
                // so a hoisted intent has to pick one and be wrong about
                // the other. A genuinely artifact-backed item still
                // resolves to `'override-artifact'` and is still refused
                // with `NOT_OVERRIDABLE` — the derivation states the
                // caller's case, it does not widen the repository's gate,
                // which is unchanged and right.
                //
                // Sibling limb: #6563 (PR #6642) did the same for the
                // restore branch below, where the intent was UNSTATED and
                // fell through to `restoreVersion`'s `?? 'override-artifact'`
                // default. The registry half of both limbs is #6621, fixed
                // here and below.
                const intent: 'override-artifact' | 'runtime-only' =
                    host.isArtifactBacked(it.type, it.name) ? 'override-artifact' : 'runtime-only';
                if (current) {
                    await repo.delete(ref, {
                        parentVersion: current.hash,
                        actor,
                        source: 'protocol.revertCommit',
                        intent,
                        state: 'active',
                        packageId: commitPackageId,
                        ...memberOption(member),
                    });
                }
                // [#6621] The registry must stop serving what the revert
                // just removed — the #4521 rule on the DELETE side of it.
                //
                // Measured on `origin/main` before this line existed: a
                // first-build undo of a created `object` answered
                // `success: true`, left `sys_metadata` with zero rows for
                // the name, and `SchemaRegistry` kept serving the body —
                // the same split the restore limb below showed, one limb
                // over. Same for an overlay `view` on a control-plane
                // kernel, where the plain-key entry `saveMetaItem`'s
                // write-through had put there simply stayed.
                //
                // WHICH heal, and why not a bare unregister: this is the
                // #6687 three-tier walk the sibling delete caller
                // {@link deleteMetaItem} runs after its own `repo.delete`,
                // and the tiers are the point. A soft-removed overlay that
                // shadows a packaged artifact must fall BACK to the
                // artifact (tier 1, ADR-0005 reset), not vanish; only when
                // no layer serves the name at all is the plain-key entry
                // retired (tier 3, #5079). A flat `removeOverlayEntry`
                // here would delete names a code package still ships. Both
                // delete/revert callers now run the same walk, exactly as
                // both now derive the same per-item intent.
                //
                // Run for the no-row case too, deliberately: that is the
                // self-heal branch `deleteMetaItem` documents — a stale
                // shadow can outlive the row it came from, and this limb's
                // contract is "this artifact is not here after the revert",
                // not "a row was deleted".
                //
                // [#6602] ORG GATE, and it is asymmetric ON PURPOSE. Only
                // an env-wide revert may mutate the process-wide registry:
                // an org-scoped row never entered it (ADR-0005, the rule
                // {@link hydrateOverlayIntoRegistry} owns), so healing on
                // its behalf would un-shadow or retire an entry that
                // belongs to the env-wide row every other org reads. The
                // write-through's object branch is deliberately NOT
                // org-gated, and that carve-out does not transfer here: it
                // is argued from `assertObjectRegistered` failing CLOSED,
                // which licenses registering broadly and never retiring
                // broadly. Register wide, retire narrow.
                //
                // [#6780] The verdict this comment argues now lives INSIDE
                // {@link restoreArtifactRegistryView} as a REQUIRED
                // parameter, so the organization is handed over rather than
                // tested here: PR #6807's call-site `if (orgId === null)` guarded
                // this ONE caller while the sibling `deleteMetaItem` — the
                // caller this limb was modelled on — had the same hole on
                // all three of its own call sites. The gate moved to the
                // choke point every caller shares; the pin below this
                // comment is unchanged and still covers the batch path.
                // [#7559] The ITEM's resolved scope, not the request's — the
                // #6602 gate this parameter carries asks "is this row
                // env-wide?", and an env-wide row reverted by an org-scoped
                // caller skipped the heal entirely while answering success.
                await host.restoreArtifactRegistryView(it.type, it.name, null, member);
                // [#14179] …and announce it on the ONE choke point,
                // {@link emitMetadataMutation}, exactly as the sibling
                // delete caller {@link deleteMetaItem} does after its own
                // `repo.delete` + heal. GATED ON `current` for the same
                // reason that sibling's row-absent exit is silent: with no
                // row to remove nothing mutated, and a `deleted` signal
                // there would wake every peer to converge on a no-op. The
                // heal above still runs unconditionally — it is a
                // self-heal, not a mutation.
                if (current) {
                    // [ADR-0094] Awaited projection BEFORE the
                    // fire-and-forget emit below — same order
                    // `saveMetaItem`'s comment establishes, and the same
                    // `state: 'deleted'` shape {@link deleteMetaItem}'s
                    // repository branch already sends: the row is gone,
                    // and the projector re-reads the layered state to
                    // decide whether the derived record retires or falls
                    // back to the artifact baseline. No `body` — a
                    // soft-remove has none to hand over, exactly as the
                    // sibling delete call passes none.
                    await host.runMutationProjector({
                        type: PLURAL_TO_SINGULAR[it.type] ?? it.type,
                        name: it.name,
                        state: 'deleted',
                        organizationId: null,
                    });
                    host.emitMetadataMutation({
                        type: PLURAL_TO_SINGULAR[it.type] ?? it.type,
                        name: it.name,
                        state: 'deleted',
                        organizationId: null,
                        ...mutationEventMember(it.type, member),
                    });
                }
                reverted.push({ type: it.type, name: it.name, action: 'removed' });
                revertedMembers.push(member);
            } else if (restoreToVersion !== null) {
                // Edited an existing artifact → restore the pre-commit body.
                //
                // [#6563] The write INTENT is derived per item, exactly as the
                // sibling caller {@link rollbackMetaItem} derives it. Left
                // unstated, `SysMetadataRepository.restoreVersion` defaults to
                // `'override-artifact'` and `put`'s `assertAllowed` refuses every
                // type that is not `allowEnvironmentOverlay` — `object` among them — so
                // each `object` item of a reverted commit came back in `failed[]`
                // as `NOT_OVERRIDABLE` while the same edit reverted fine one
                // artifact at a time through the version-history revert. The
                // repository's default is right for callers that genuinely mean
                // "override a packaged artifact"; the defect was this caller never
                // saying which of the two cases it is.
                //
                // Per ITEM, not per call: `revertCommit` reverts a batch, and a
                // commit routinely mixes a runtime-created object with an overlay
                // on a packaged view. A genuinely artifact-backed item still
                // resolves to `'override-artifact'` and is still refused — the
                // derivation states the case, it does not widen the gate.
                //
                // The soft-remove limb above stated the same intent as a
                // CONSTANT and was fixed the same way (#6620), so both limbs now
                // derive it. The registry half of both is #6621, below.
                //
                // [#29414, ADR-0146 D2] …and a restore into the base's paired
                // `.custom` row is the pair's declared override, judged by the
                // override write gate exactly as {@link rollbackMetaItem}
                // judges it ({@link restoreWriteFor}, one derivation): a
                // version that declares no override — the base row's body a
                // plan recorded before #29414 names as the pair's pre-commit
                // version — is refused into `failed[]`, nothing written.
                const { intent, deriveRestoredBody } = host.restoreWriteFor(
                    PLURAL_TO_SINGULAR[it.type] ?? it.type, it.name, commitPackageId,
                    host.isArtifactBacked(it.type, it.name), 'protocol.revertCommit',
                );
                // [#6621 / #4636] The ownership key the write-through needs,
                // read from the ROW rather than from the request — the sibling
                // revert caller {@link rollbackMetaItem} reads it exactly this
                // way, and for the same reason: `revertCommit` has no
                // `packageId` parameter either, and inventing one would let a
                // caller re-key an artifact it does not own. Left unpassed, a
                // row bound to `app.<slug>` re-registers under the
                // `'sys_metadata'` sentinel and `registerObject` throws
                // `already owned by package "app.<slug>"` into a best-effort
                // `console.warn` — a revert that reports success while the
                // registry keeps the body it was supposed to revert.
                //
                // Read BEFORE the restore, deliberately (#4636 again): the row
                // exists at this point and a read failure still fails this ITEM
                // cleanly into `failed[]`. Read afterwards it would be a
                // fallible query downstream of a write that already succeeded —
                // the shape that ends in a `catch {}` swallowing a real outage
                // (#4867). Per ITEM, because a batch mixes bindings.
                //
                // [#29414, ADR-0048, ADR-0067 D3] The binding is the
                // committing package's, never another package's row's: the
                // restore writes the committing package's own row, in place
                // when it is stored and created again when it was deleted
                // since (`restoreVersion` is handed `commitPackageId` and
                // writes it either way). So this door never writes the
                // package-less row, and the package-less close has nothing
                // here to judge (every commit names its package); the write
                // naming the read-only base itself is closed below.
                const restorePackageId: string = commitPackageId;
                // [#29390, ADR-0146 D1, D11] A restore writes the row this
                // binding names, so a restore into a row bound to the
                // read-only base itself (a commit recorded before #28905
                // closed the write naming the base) is refused exactly as
                // {@link rollbackMetaItem} refuses it, on the same key and
                // with the same sentence ({@link namedBaseOverlayWriteRefusal}),
                // into `failed[]` with nothing written. The commit's other
                // items still revert. The soft-remove limb above stays open:
                // removing a row bound to the base writes nothing.
                const namedBase = host.namedBaseOverlayWriteRefusal(
                    { type: PLURAL_TO_SINGULAR[it.type] ?? it.type, name: it.name, packageId: restorePackageId, ...memberOption(member) },
                    'rollback',
                );
                if (namedBase) throw namedBase;
                const restored = await repo.restoreVersion(ref, restoreToVersion, {
                    actor,
                    source: 'protocol.revertCommit',
                    // [#29414] The row restored is the committing package's.
                    packageId: commitPackageId,
                    message: `revert commit ${request.commitId}`,
                    intent,
                    // [#21470] The divergent `name` refusal, [ADR-0086 D3]
                    // the permission set's owner judge against the binding
                    // read above, [#25278] the save door's refusal family,
                    // then [#20790] R2's credential-channel
                    // strip. A refused version lands
                    // in `failed[]` below, with nothing written. Judged under
                    // the SINGULAR type, the spelling the write-through
                    // registers under. See {@link restoredBodyWriter}.
                    // [ADR-0146 D2] …and, for the pair's row, the override write gate.
                    deriveRestoredBody,
                    ...memberOption(member),
                });
                // [#6621] #4521 — a revert is a live write like any other: the
                // restored body must be the one the runtime dispatches on
                // immediately, not after someone lists the type.
                //
                // Measured on `origin/main` before this call existed, with the
                // real `SysMetadataRepository`: an `object` saved twice and then
                // reverted answered `{ success: true, revertedCount: 1,
                // failed: [] }`, the stored row came back to `["name","amount"]`
                // — and `SchemaRegistry.getObject(...)` still carried
                // `due_date`. `success: true` while CRUD dispatches on the body
                // the operator just reverted away, healing only at the next
                // restart. Type-agnostic: an overlay `view` on a control-plane
                // kernel showed the same split (`stored 'Cases'` vs
                // `registry 'Renamed'`).
                //
                // The registry key is the SINGULAR type — the spelling
                // `saveMetaItem`'s own write-through registered under — while
                // the repo-facing reads above keep `it.type`, which is the
                // spelling the row is stored with. Two different keys, on
                // purpose.
                await host.applyRegistryWriteThrough({
                    type: PLURAL_TO_SINGULAR[it.type] ?? it.type,
                    name: it.name,
                    item: restored.item.body,
                    packageId: restorePackageId,
                    // [#6602] The row's OWN scope, per item. An org-scoped row
                    // is refused by {@link hydrateOverlayIntoRegistry} and never
                    // reaches the registry every org in this process shares —
                    // inherited, not re-decided here.
                    // [#7559] …and now that is what it actually IS. This line
                    // said "the row's OWN scope" while passing the REQUEST's
                    // org; the resolution above is what makes the comment true.
                    organizationId: null,
                });
                // [ADR-0094] Awaited projection BEFORE the
                // fire-and-forget emit below — the order `saveMetaItem`'s
                // comment establishes. This limb restores an existing
                // artifact's pre-commit body, so the derived read-model
                // gets exactly that body, the same one the write-through
                // just registered under the same singular key and scope.
                await host.runMutationProjector({
                    type: PLURAL_TO_SINGULAR[it.type] ?? it.type,
                    name: it.name,
                    state: 'active',
                    organizationId: null,
                    body: restored.item.body,
                });
                // [#14179] The restore limb's half of the same repair: a
                // revert is a live write, so it funnels through the ONE
                // choke point {@link emitMetadataMutation} like every
                // other authoring surface. Same singular key the
                // write-through just registered under, same per-item
                // scope, `state: 'active'` for a restored row.
                host.emitMetadataMutation({
                    type: PLURAL_TO_SINGULAR[it.type] ?? it.type,
                    name: it.name,
                    state: 'active',
                    organizationId: null,
                    ...mutationEventMember(it.type, member),
                });
                reverted.push({ type: it.type, name: it.name, action: 'restored' });
                revertedMembers.push(member);
            }
        } catch (e: any) {
            // [#8333 · P11] `failed[].error` is revert-response DATA.
            // Measured on `origin/main` by failing the
            // `sys_metadata_history` read under `repo.restoreVersion`: the
            // field carried `SQLITE_ERROR: no such table: sys_metadata`.
            //
            // Every authored refusal this `try` can receive declares 4xx —
            // `SysMetadataRepository`'s `VERSION_NOT_FOUND` 404 (measured
            // end to end and still quoted whole), `NO_DRAFT` 404,
            // `VERSION_NOT_RESTORABLE` 409, `ITEM_LOCKED` 403,
            // `WRITABLE_PACKAGE_REQUIRED` 422 — so the self-correcting
            // sentences survive and only the driver line is withheld.
            // [#8441] …and the `code` limb beside it, which #8333 left
            // alone as a different field with a different rule. Measured
            // after that fix landed, this row still answered
            // `{ error: 'revert failed', code: 'SQLITE_ERROR' }`. The rule
            // here is CATALOG MEMBERSHIP, so the repository's declared
            // refusals — `VERSION_NOT_FOUND`, `ITEM_LOCKED`, `NO_DRAFT`,
            // `VERSION_NOT_RESTORABLE` — pass through untouched and only a
            // driver's dialect is replaced. See {@link
            // clientFacingFailureCode}.
            const failureCode = clientFacingFailureCode(e);
            failed.push({
                type: it.type,
                name: it.name,
                error: clientFacingFailureText(e, 'revert failed'),
                ...(failureCode ? { code: failureCode } : {}),
            });
            console.warn(
                `[protocol.revertCommit] revert of ${it.type}/${it.name} failed for commit `
                + `'${request.commitId}': ${e?.message ?? e}`,
            );
        }
    }

    // Record the revert as its own commit (append-only history),
    // environment-wide like the commit it reverts (ADR-0131 D6/D7).
    const revertCommit = await host.recordPackageCommit({
        packageId: row.package_id,
        operation: 'revert',
        message: `Revert: ${row.message ?? request.commitId}`,
        ...(request.actor ? { actor: request.actor } : {}),
        parentCommitId: request.commitId,
        items: reverted.map((r, index) => ({
            type: r.type,
            name: r.name,
            existedBefore: r.action === 'restored',
            prevVersion: null,
            ...(revertedMembers[index] !== undefined ? { member: revertedMembers[index] } : {}),
        })),
    });

    return {
        success: failed.length === 0 && reverted.length > 0,
        revertedCount: reverted.length,
        failedCount: failed.length,
        reverted,
        failed,
        ...(revertCommit ? { revertCommitId: revertCommit.commitId } : {}),
    };
}

/** The body of `ObjectStackProtocolImplementation#rollbackToPackageCommit`; the method's docblock there is its contract. */
export async function rollbackToPackageCommit(host: Pick<ProtocolHost, 'listCommits' | 'readRevertableCommit' | 'refuseOrganizationScopedWrite' | 'revertCommit'>, request: {
        commitId: string;
        /**
         * The package being rolled back (ADR-0067): a target commit of any
         * other package is refused `COMMIT_NOT_FOUND` (404) and nothing is
         * written. Optional for in-process callers that name no package.
         */
        packageId?: string;
        actor?: string;
    }): Promise<{
        success: boolean;
        revertedCommits: string[];
        failed: Array<{ commitId: string; error: string }>;
    }> {
    // [ADR-0131 D6] FIRST: an organization-scoped rollback is refused.
    host.refuseOrganizationScopedWrite(
        `Commit '${request.commitId}'`, request,
    );
    const target = await host.readRevertableCommit(request.commitId, request.packageId);
    const all = await host.listCommits({ packageId: target.package_id });
    // listCommits is newest-first; revert every `apply` commit strictly newer
    // than the target (by created_at). Revert commits are skipped (their
    // effect is already captured by re-reverting the apply they undid).
    //
    // [#13995] "Strictly newer" is an INSTANT comparison. This site both
    // CONSUMES {@link listCommits}' ordering and re-derives the same
    // comparison itself, so neither site could correct the other: with
    // the raw column's `String()` spelling over a `Date`-materialising driver
    // the predicate
    // ranked by weekday NAME, and this rollback then reverted `apply` commits
    // OLDER than the target while skipping the newer ones it exists to undo -
    // a destructive operation planning off a wrong predicate, on every run and
    // in the same way. See {@link compareAuditInstants}.
    const targetCreatedAt = target.created_at;
    const toRevert = all.filter(
        (c) => compareAuditInstants(c.createdAt, targetCreatedAt) > 0 && c.operation === 'apply',
    );
    const revertedCommits: string[] = [];
    const failed: Array<{ commitId: string; error: string }> = [];
    for (const c of toRevert) {
        try {
            const step = await host.revertCommit({
                commitId: c.id,
                ...(request.actor ? { actor: request.actor } : {}),
            });
            revertedCommits.push(c.id);
            // An item the step refused is returned, never thrown; its
            // `error` is already client-facing (P11).
            for (const item of step.failed) {
                failed.push({
                    commitId: c.id,
                    error: `Item '${item.type}/${item.name}' was not reverted: ${item.error}`,
                });
            }
        } catch (e: any) {
            // [#8333 · P12] The derivative of P11 — `failed[].error` on the
            // rollback response. Measured on `origin/main` by failing the
            // `sys_metadata_commit` lookup inside the inner
            // {@link revertCommit}: `SQLITE_ERROR: no such table:
            // sys_metadata` reached the field.
            //
            // This `try` wraps exactly one call, and `revertCommit` throws
            // only refusals it declared — `COMMIT_NOT_FOUND` 404
            // (measured, still quoted whole) and the lock/authorization
            // 4xx above it; its PER-ITEM failures never throw at all, they
            // are collected into its own `failed[]` (P11).
            failed.push({
                commitId: c.id,
                error: clientFacingFailureText(e, 'revert failed'),
            });
            console.warn(
                `[protocol.rollbackToPackageCommit] revert of commit '${c.id}' failed: ${e?.message ?? e}`,
            );
        }
    }
    return { success: failed.length === 0, revertedCommits, failed };
}

/** The body of `ObjectStackProtocolImplementation#rollbackMetaItem`; the method's docblock there is its contract. */
export async function rollbackMetaItem(host: Pick<ProtocolHost, 'recordMetadataAudit' | 'rollbackMetaItemUnaudited'>, request: RollbackMetaItemRequest) {
    // [#28355] A refusal that carries no row of its own leaves its `denied` row here.
    return withRefusalAudit((entry) => host.recordMetadataAudit(entry), {
        operation: 'rollback', type: request.type, name: request.name, actor: request.actor,
        source: 'protocol.rollbackMetaItem',
    }, () => host.rollbackMetaItemUnaudited(request));
}

/** The body of `ObjectStackProtocolImplementation#rollbackMetaItemUnaudited`; the method's docblock there is its contract. */
export async function rollbackMetaItemUnaudited(host: Pick<ProtocolHost, 'applyRegistryWriteThrough' | 'assertLockAllowsWrite' | 'emitMetadataMutation' | 'ensureOverlayIndex' | 'getOverlayRepo' | 'isArtifactBacked' | 'isOverlayAllowed' | 'isRuntimeCreateAllowed' | 'metadataConflictRefusal' | 'namedBaseOverlayWriteRefusal' | 'packagelessOverlayWriteRefusal' | 'receiptVersion' | 'recordMetadataAudit' | 'recordOptimisticConflictAudit' | 'refuseOrganizationScopedWrite' | 'resolveOverlayPackageBinding' | 'restoreWriteFor' | 'runMutationProjector'>, request: RollbackMetaItemRequest): Promise<{
        success: boolean;
        version: string;
        seq: number;
        restoredFromVersion: number;
        message?: string;
    }> {
    // [ADR-0131 D6] FIRST: an organization-scoped rollback is refused.
    // See {@link organizationScopedWriteRefusal}.
    host.refuseOrganizationScopedWrite(
        `Metadata item '${request.type}/${request.name}'`, request,
    );
    if (!Number.isFinite(request.toVersion) || request.toVersion < 1) {
        const err: any = new Error(
            `rollbackMetaItem requires a positive integer 'toVersion' (got ${request.toVersion}).`,
        );
        err.code = 'INVALID_REQUEST';
        err.status = 400;
        throw err;
    }
    // #4432 / #7894 — CANONICAL TYPE KEY. See {@link canonicalMetaType}.
    // `rollbackMetaItem` is the EIGHTH `/meta` entry point on this URL
    // family (`POST /api/v1/meta/:type/:name/rollback`, caller-supplied
    // `:type`) and was the last one still deriving its type key from
    // `PLURAL_TO_SINGULAR` — the MANIFEST-COLLECTION map #7894 moved this
    // boundary off. Placed AFTER the envelope guard above rather than at
    // the very top: that is the position {@link saveMetaItem} documents for
    // this exact pair, calling this method's opening guard its structural
    // twin — a malformed request envelope is refused before its type key is
    // canonicalised, and both refusals are `INVALID_REQUEST`/400 anyway.
    //
    // What the fold reaches here, measured rather than assumed:
    //
    //  • `getEffectiveLock`'s OVERLAY limb, which queries `sys_metadata`
    //    with the raw `type`. Its artifact limb folds; the overlay limb
    //    does not. So an ADR-0010 `_lock` carried by the stored ACTIVE row
    //    was looked up under a `type` no row carries and came back `'none'`
    //    — not a neutral value but the verdict "the author declared no
    //    protection" (#5706) — while the restore below read the folded key
    //    and resolved the protected row perfectly. A lock addressable
    //    around from the wire; the one limb of this verb that was not
    //    fail-closed, and the reason this card exists.
    //  • the revertability tier (`isOverlayAllowed` / `isRuntimeCreateAllowed`)
    //    for the four MANIFEST-ABSENT types (`field`, `seed`,
    //    `external_catalog`, `translation`), which stayed plural through
    //    the manifest map and so took the PERMISSIVE PLUGIN branch — the
    //    #7894 shape, one verb over.
    //  • the `NOT_OVERRIDABLE` refusal, the two ADR-0010 audit rows and
    //    both receipt sentences, which read `request.type` and so reported
    //    the CALLER's spelling for a row written under the canonical one.
    //    `recordMetadataAudit` re-folds through `PLURAL_TO_SINGULAR`
    //    internally, which covers a manifest-present plural and misses the
    //    four manifest-absent ones; folding here is what makes the audit
    //    trail agree with the write for BOTH classes.
    //
    // [#9009] The first bullet is now HISTORY, and the residue this comment
    // used to hold open is closed. It read: "⛔ This does NOT close the class
    // at its producer … Folding there instead is the contract-first shape and
    // is deliberately left open as its own card" — a card that was never
    // filed, so the residue was invisible to the backlog for as long as the
    // sentence claimed it was tracked. {@link getEffectiveLock} now folds its
    // own type key, so this fold no longer carries the lock limb; the other
    // three bullets are still exactly what it reaches. Kept rather than
    // deleted because a reader arriving here still needs to know which of
    // these effects belong to THIS boundary and which moved to the producer.
    request = canonicalizeMetaRequestType(request);
    // [#22877] Ruling 6116165299 (Q2 i): the revert addresses ONE member
    // of a bundled type — the selector's, else the canonical one.
    const member = resolveBundleMemberSelector(request.type, request.member);
    // Canonical by construction from the fold above. NOT a second fold: the
    // `PLURAL_TO_SINGULAR` lookup that used to stand here is exactly what
    // #7894 removed from this boundary. The binding survives under its own
    // name because the row operations below read it as "the key the row is
    // stored under" — the same shape {@link deleteMetaItem} keeps for
    // `singularTypeForRepo`.
    const singularType = request.type;
    if (!host.isOverlayAllowed(singularType)
        && !host.isRuntimeCreateAllowed(singularType)) {
        const err: any = new Error(
            `Metadata type '${request.type}' is not revertable — no overlay/runtime-create permission.`,
        );
        err.code = 'NOT_OVERRIDABLE';
        err.status = 403;
        throw err;
    }
    // ADR-0010 L3 — lock blocks rollback (writes a new active row).
    // `request.type` is the CANONICAL spelling by the time it gets here
    // (fold above), which is what makes this gate read the same row the
    // restore below writes. It was the raw caller spelling until #8819.
    const _rollbackLockErr = await host.assertLockAllowsWrite({
        type: request.type,
        name: request.name,
        operation: 'rollback',
        ...(request.actor ? { actor: request.actor } : {}),
        source: 'protocol.rollbackMetaItem',
    });
    if (_rollbackLockErr) throw _rollbackLockErr;
    await host.ensureOverlayIndex();
    // [ADR-0131 D6] The environment's lineage: an organization-scoped
    // request was refused above.
    const repo = host.getOverlayRepo();
    const artifactBacked = host.isArtifactBacked(singularType, request.name);
    const ref = {
        type: singularType,
        name: request.name,
        org: 'env',
    } as Parameters<typeof repo.restoreVersion>[0];
    // [#4636] The ownership key the write-through below needs, read from
    // the ROW rather than from the request — `rollbackMetaItem` has no
    // `packageId` parameter, and inventing one would let a caller re-key
    // an object it does not own. `restoreVersion` → `put` preserves an
    // existing non-null `package_id` on update, so the binding read here
    // is the binding the restored row still carries.
    //
    // Read BEFORE the restore, deliberately: the row exists at this point
    // and a read failure can still fail the whole rollback cleanly. Reading
    // it afterwards would put a fallible query downstream of a write that
    // already succeeded — the shape that ends in a `catch {}` swallowing a
    // real outage (#4867).
    const rollbackPackageId = await host.resolveOverlayPackageBinding(singularType, request.name, member);
    // [ADR-0146 D11, D1] A rollback writes the row its binding names, so
    // a rollback of a packaged item's package-less row (an overlay type's
    // row the ceremony has not moved, or none stored, whose restore writes
    // the package-unbound row) is the package-less write, closed
    // ({@link packagelessOverlayWriteRefusal}): rollback, like source save
    // and reset, is offered on the writable package — the base's paired
    // `.custom`, where `os migrate packageless-overlays` moves the row.
    //
    // [#28905, ADR-0146 D1, D11] …and so is the rollback of a row bound to
    // the read-only base itself (a save naming the base stored it before
    // that save was closed): the restore writes the base-bound row again,
    // so it is refused as that save is ({@link namedBaseOverlayWriteRefusal}),
    // naming the pair a version's body is saved into. The row stays
    // served; a delete naming the base removes it.
    {
        const closed = await host.packagelessOverlayWriteRefusal(
            { type: singularType, name: request.name, packageId: rollbackPackageId, state: 'active', ...memberOption(member) },
            'rollback',
        );
        if (closed) throw closed;
        const namedBase = host.namedBaseOverlayWriteRefusal(
            { type: singularType, name: request.name, packageId: rollbackPackageId, ...memberOption(member) },
            'rollback',
        );
        if (namedBase) throw namedBase;
    }
    // [ADR-0146 D2] A rollback of the base's paired `.custom` row is the
    // pair's declared override, as its save is: it edits no managed item,
    // so the store is told a runtime-only write — never judged an artifact
    // override from `isArtifactBacked` alone, which seals it on a type with
    // no overlay channel (a page, a flow). The restored body is judged by
    // the override write gate as that save is ({@link overrideWriteVerdict}
    // into the pair): a version that declares no override is refused as
    // the save is, with nothing written.
    // [#29414] The derivation a commit revert's restore limb shares ({@link restoreWriteFor}).
    const { intent, deriveRestoredBody } = host.restoreWriteFor(
        singularType, request.name, rollbackPackageId, artifactBacked, 'protocol.rollbackMetaItem',
    );
    try {
        const result = await repo.restoreVersion(ref, request.toVersion, {
            // #4556 — NULL, not 'system', for an actor-less rollback.
            actor: request.actor ?? null,
            source: 'protocol.rollbackMetaItem',
            ...(request.message ? { message: request.message } : {}),
            intent,
            // [#21470] The divergent `name` refusal, [ADR-0086 D3] the
            // permission set's owner judge against the binding read above
            // and [#25278] the save door's refusal family, each
            // rethrown below with nothing written; then [#20790] R2 — a rollback past the
            // credential move keeps the write-only channel's current
            // credential and stores none. See {@link restoredBodyWriter}.
            // [ADR-0146 D2] …and, for the pair's row, the override write gate.
            deriveRestoredBody,
            // [#22877] The member whose lineage `toVersion` is taken from.
            ...memberOption(member),
        });
        // #4521 — a rollback is a live write like any other: the restored
        // body must be the one the runtime dispatches on immediately, not
        // after someone lists the type.
        // #4636 — …under the SAME ownership key `saveMetaItem` used. Left
        // unpassed, an object row bound to `app.<slug>` re-registered here
        // under the `'sys_metadata'` sentinel and `registerObject` threw
        // `already owned by package "app.<slug>"` into the best-effort
        // `console.warn` — a rollback that reported success while the
        // registry kept serving the body it was supposed to revert.
        await host.applyRegistryWriteThrough({
            type: singularType,
            name: request.name,
            item: result.item.body,
            packageId: rollbackPackageId,
            // [#6602] A rollback restores the row IN ITS OWN SCOPE — an
            // org-scoped restore must not graft the body process-wide.
            organizationId: null,
        });
        // [#7748] ADR-0010 — success audit (best-effort). Same position as
        // `saveMetaItem`'s: persistence committed, registry write-through
        // done, before the receipt. A rollback reached `recordMetadataAudit`
        // only through `assertLockAllowsWrite`'s DENY path before this, so a
        // refused rollback was recorded and a performed one was not.
        await host.recordMetadataAudit({
            type: request.type,
            name: request.name,
            organizationId: null,
            operation: 'rollback',
            outcome: 'allowed',
            code: 'ok',
            ...(request.actor ? { actor: request.actor } : {}),
            source: 'protocol.rollbackMetaItem',
            note: `restored from version ${request.toVersion}`,
        });
        // [ADR-0094] Awaited projection BEFORE the fire-and-forget
        // listener below — the order `saveMetaItem`'s comment
        // establishes. A rollback restores the row and the in-memory
        // registry to the target version; a derived read-model (e.g. the
        // `datasource` projector's) must be just as current
        // when this call returns, not only after the next unrelated
        // write or boot reconciliation (ADR-0094 D4) eventually heals it.
        // `body` is the restored version's own — the same value the
        // write-through above registered.
        await host.runMutationProjector({
            type: singularType,
            name: request.name,
            state: 'active',
            organizationId: null,
            body: result.item.body,
        });
        // [#14179] A rollback is a live write like any other (#4521, the
        // line the write-through above is made under) — so it announces
        // itself on the ONE choke point, {@link emitMetadataMutation}, the
        // way its emitting siblings do. Boot-cached consumers wired to
        // `onMetadataMutation` re-bind on the RESTORED body, and the
        // #13331 cluster leg fans the same signal out to peers; without
        // this line both halves saw a rollback as nothing at all. `state`
        // is `'active'` because the restore leaves an active row, and the
        // scope is the row's own — the same one the write-through got.
        host.emitMetadataMutation({
            type: singularType,
            name: request.name,
            state: 'active',
            organizationId: null,
            ...mutationEventMember(singularType, member),
        });
        return {
            success: true,
            // [#21207] Keyed, never the stored content hash (`receiptVersion`).
            version: await host.receiptVersion(result.version),
            seq: result.seq,
            restoredFromVersion: request.toVersion,
            message: `Reverted to version ${request.toVersion} — type=${request.type}, name=${request.name} [seq=${result.seq}]`,
        };
    } catch (err: any) {
        if (err instanceof ConflictError) {
            // [#21207] Keyed values or none in the text and attributes.
            const conflict = await host.metadataConflictRefusal(
                err,
                `${request.type}/${request.name}`,
                `${request.type}/${request.name} advanced during rollback.`,
            );
            await host.recordOptimisticConflictAudit({
                type: request.type,
                name: request.name,
                operation: 'rollback',
                ...(request.actor ? { actor: request.actor } : {}),
                source: 'protocol.rollbackMetaItem',
                expectedParent: err.expectedParent,
                actualHead: err.actualHead,
            });
            throw conflict;
        }
        throw err;
    }
}
