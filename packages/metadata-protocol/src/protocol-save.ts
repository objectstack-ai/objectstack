// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Save refusals, saveMetaItem, saveConflict,
 * migrateStoredMetadata" facet of `ObjectStackProtocolImplementation`: the
 * bodies of `metaTypeNamespaceExists`, `viewContainerNameCollisionRefusal`,
 * `saveMetaItemUnaudited`, `migrateStoredMetadata` moved out of `protocol.ts`
 * whole by `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. `ProtocolSaveFacet` is a stateless facet over the host
 * (ruling 6624345766): each static method below is the body of the class
 * member of the same name as `packages/metadata-protocol/scripts/host-split.mjs`
 * moves one (ruling E, item E1), with `this.<member>` read as `host.<member>`
 * and nothing else changed. The facet holds no state: the fields stay on the
 * class, and a body reaches them through the host (`protocol-host.ts`).
 *
 * The class keeps every member as a one-line delegation. A public member
 * keeps its docblock there, which the published `.d.ts` prints; a private
 * member's docblock moved here with its body (docblock ownership).
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { MetadataAuthoringSurfaceSchema } from '@objectstack/spec/api';
import { stampHtmlPageRequires } from './runtime-authoring-gate.js';
import { SysMetadataRepository, packagelessAddressAmbiguityRefusal } from './sys-metadata-repository.js';
import { ConflictError, itemDiscriminator, readLegacyOrganizationRows } from '@objectstack/metadata-core';
import { savedItemNameRefusal } from '@objectstack/metadata/view-container-name';
import { authoringClientOf } from './draft-changes.js';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import { isAggregatedViewContainer } from '@objectstack/spec/ui';
import {
    TRANSLATED_ECHO_NOTICE_ID,
    restoreTranslatedEchoes,
    translatedEchoNotices,
} from './protocol-translated-echo.js';
import { PROTOCOL_VERSION, stripReadDecorations } from '@objectstack/spec/kernel';
import { collectDecisionModeReview } from './stored-migration.js';
import type {
    StoredFlowCanonicalization,
    StoredMigrationNotice,
    StoredMigrationReport,
    StoredMigrationRow,
    StoredMigrationTodo,
} from './stored-migration.js';
import { droppedWithheldKeyNotices } from './protocol-credential-carry-forward.js';
import { overrideWriteRefusalError } from './protocol-packaged-base-refusal.js';
import { objectBodyExtensionFieldSuffixRefusal } from './protocol-extension-field-suffix.js';
import { flowVerdictBody } from './protocol-flow-save-replay.js';
import { withParsedStoredActions } from './protocol-stored-action-parse.js';
import { datasourceCredentialsRefSaveRefusal } from './protocol-datasource-credentials-ref.js';
import { withNullMasterRowCounts } from './protocol-destructive-null-master.js';
import { canonicalMetaType, canonicalizeMetaRequestType, resolveOverlaySchema } from './protocol-meta-type-schema.js';
import {
    permissionSetOwnerBindingRefusal,
    protectionBlockRefusal,
    runtimeHookWithoutBodyRefusal,
    withoutProtectionBlock,
} from './protocol-authoring-refusals.js';
import { zodIssuesToMetadataIssues } from './protocol-metadata-issues.js';
import {
    graftFoldedFormSections,
    graftNormalizedOperators,
    normalizeViewMetadata,
    projectStorableViewBody,
    withDeclaredPageTypeDefault,
} from './protocol-view-normalization.js';
import { isShippedViewItem, stripDerivedProvenance } from './protocol-package-bindings.js';
import { mutationEventMemberOfBody } from './protocol-bundle-members.js';
import { clientFacingFailureText } from './protocol-client-failures.js';
import {
    destructiveChangeRemedy,
    detectDestructiveObjectChanges,
    specValidationFindings,
} from './protocol-write-face.js';
import { isNonCanonicalStoredType } from './protocol-stored-overlay-types.js';
import type { SaveMetaItemRequest } from './protocol-door-requests.js';
import type { ProtocolHost } from './protocol-host.js';
import type { ObjectStackProtocolImplementation } from './protocol.js';

export class ProtocolSaveFacet {
    /**
     * Does `sys_metadata` already carry a row under this type key?
     *
     * Reached ONLY from {@link refuseUnmintableMetaType} after the static
     * verdict has fired, so it costs nothing on the ordinary save path. Not
     * scoped by name, org or state on purpose: the question is whether the
     * NAMESPACE exists, and a residue row is exactly as real in a draft or in
     * another org's overlay as it is here.
     *
     * An UNPROVISIONED store counts as "no" and the refusal stands — a
     * deployment whose `sys_metadata` table does not exist yet has no residue to
     * protect, and is the state in which this card's own defect (minting the
     * first row of a namespace nothing serves) is at its most reachable. Any
     * OTHER read failure propagates as `503 SERVICE_UNAVAILABLE`
     * ({@link rethrowUnlessMetadataStoreUnprovisioned}): inventing "no rows"
     * from an outage would answer `400 '<type>' is not a metadata type` — an
     * existence claim about the store, stated while the store was unreachable —
     * for a write that may be perfectly legal (AGENTS.md "Absence must be loud",
     * #5186).
     */
    static async metaTypeNamespaceExists(host: Pick<ProtocolHost, 'findEnvironmentRow' | 'rethrowUnlessMetadataStoreUnprovisioned'>, type: string): Promise<boolean> {
        try {
            // [#21908, ADR-0096 D5] The explicit system opt-in: an existence
            // probe of the platform store, never a read on a caller's behalf.
            const row = await host.findEnvironmentRow('sys_metadata', { where: { type }, context: { isSystem: true } });
            return row != null;
        } catch (error) {
            host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
            return false;
        }
    }

    /**
     * [#21639] The save door's ONE collision predicate for a view container:
     * a container is refused when its save name, or any name its expansion
     * produces, is a name already served from elsewhere — the family's rule,
     * which replaces its two one-shape checks (#21558's own expansion,
     * #21620's sibling of the same object) and adds the shapes they left open.
     *
     * Both read doors give a name with a stored row of its own that row
     * (#21510's one predicate, {@link namesWithOwnStoredRow}), and fill a
     * row-less name with an expansion, the last one read winning within a
     * package's slot and on a by-name read that names no package
     * ({@link servedViewExpansion}). So a container whose ROW name is
     * served from elsewhere hides that view on both doors and, being no view
     * itself, leaves no read answering a view under the name; a container
     * whose EXPANSION takes such a name replaces that view on both doors with
     * no word to anyone (ADR-0126: no silent override). Neither is ever what
     * the author meant, so both are refused here, at authoring (Prime
     * Directive 12), and the readers keep their one predicate: ⛔ no second
     * own-row test and no precedence rule in the readers.
     *
     * "Elsewhere" is triage's two sources, judged by the readers' own pieces,
     * never a copy of them:
     *  - another stored container's expansion, in the caller's selection,
     *    whatever that container's object: the rows
     *    {@link readActiveOverlayRows} selects (the environment's) with no
     *    package filter, parsed by
     *    {@link storedOverlayEntries} and expanded by
     *    {@link expandStoredViewContainers} with each row's own package
     *    binding. The row stored under the save name is left out: it is the
     *    row this save replaces, so a container's own re-save is never its
     *    own sibling;
     *  - a view item a package ships ({@link lookupArtifactItem}, the
     *    registry's artifact read, which never answers a tenant-authored
     *    row, holding a view item: {@link isShippedViewItem}), except the
     *    views of the shipped container this row overlays
     *    by its own name ({@link overlaidShippedContainerViewNames}): ADR-0005
     *    keys an overlay by its own name, so an overlay of a package's
     *    container stands in for that container and its views.
     * A name the container's OWN expansion produces is a third source for its
     * save name only: as the row of that name it would hide its own view.
     *
     * Every name the container would serve is its expansion as the readers
     * place it, {@link expandRuntimeViewContainer} with the request's package
     * binding (the binding the row is stored under), so every member kind,
     * the expander's de-duplication and #21334's own-name arm on another
     * package's object are judged where the readers put them. The body judged
     * is the one the author sent, with the door's own `name` stamp applied
     * first (a body with no `name` is judged under the save name), BEFORE
     * {@link normalizeViewMetadata}'s identity patch: a `form`-only container
     * under a registered view item's name would otherwise take that item's
     * `viewKind` and reach the schema as a malformed view item.
     *
     * What still saves: a view item (`viewKind` set), which is not a
     * container and under any of these names is that name's sanctioned
     * override; a container under its object's name, or under any name of
     * its own, whose expansion collides with nothing; an overlay of a
     * package's own container; #21334's own-name arm. Rows already stored in a refused shape keep
     * their bytes and are served as before; a new save of one, a re-save
     * included, is refused until its body stops colliding, and the re-savers
     * that write through this door (`migrateStoredMetadata`,
     * `duplicatePackage`) record that refusal as the row's failure.
     *
     * `VALIDATION_ERROR` / 400, the envelope of the name check it sits beside
     * (`savedItemNameRefusal`). The message names the other owner (the stored
     * container, the shipping package, or the container's own expansion) and
     * gives the family's prescription: add the view as a member of the
     * container that owns the name, or save a view item under the name. ⛔ It
     * never prescribes a save under a name another stored row holds: an
     * author (or an AI) following such an arm literally would replace that
     * row and drop the very views this refusal keeps serving. Runtime words
     * carry no tracker number.
     */
    static async viewContainerNameCollisionRefusal(host: Pick<ProtocolHost, 'expandRuntimeViewContainer' | 'expandStoredViewContainers' | 'lookupArtifactItem' | 'overlaidShippedContainerViewNames' | 'readActiveOverlayRows' | 'rethrowUnlessMetadataStoreUnprovisioned' | 'storedOverlayEntries'>, type: string,
            item: unknown,
            saveName: string,
            packageId: string | null | undefined,): Promise<(Error & { code: 'VALIDATION_ERROR'; status: 400 }) | undefined> {
        if ((PLURAL_TO_SINGULAR[type] ?? type) !== 'view') return undefined;
        if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
        const body = item as Record<string, unknown>;
        const stamped = body.name ? body : { ...body, name: saveName };
        if (!isAggregatedViewContainer(stamped)) return undefined;
        const served = host.expandRuntimeViewContainer(type, stamped, { packageId });

        let records: any[] = [];
        try {
            // [ADR-0131 D6] A save lands environment-wide, so its siblings are
            // the environment-wide rows.
            records = await host.readActiveOverlayRows({ type });
        } catch (error) {
            // [#5532] The readers' rule: only an unprovisioned store means "no
            // rows". Any other failure is not answered as "no sibling".
            host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        }
        const siblings = host.expandStoredViewContainers(
            type,
            host.storedOverlayEntries({ type }, records).filter((entry) => entry.name !== saveName),
        );
        const siblingServing = (name: string) => siblings.find(({ item: expanded }) => expanded.name === name);
        const overlaid = host.overlaidShippedContainerViewNames(type, stamped, packageId);
        const shippedServing = (name: string): Record<string, unknown> | undefined => {
            if (overlaid.has(name)) return undefined;
            const artifact = host.lookupArtifactItem(type, name) as Record<string, unknown> | undefined;
            if (!artifact || !isShippedViewItem(artifact)) return undefined;
            return typeof artifact._packageId === 'string' && artifact._packageId !== '' ? artifact : undefined;
        };
        const refusal = (text: string) => {
            const err = new Error(`Invalid view container: ${text}`) as Error & { code: 'VALIDATION_ERROR'; status: 400 };
            err.code = 'VALIDATION_ERROR';
            err.status = 400;
            return err;
        };
        const kindOn = (view: Record<string, unknown>) => `${String(view.viewKind)} view on '${String(view.object)}'`;
        const viewItem = (name: string) => `a view item (name, object, viewKind and config) under '${name}'`;
        const asMemberOf = (container: string) =>
            `Add the view as a member of the container '${container}' (its list, listViews, form or formViews)`;
        const ofItsOwn = 'the container under a name of its own that no package ships and no stored container expands';

        // ⛔ Every message names the owner, then gives the prescription, and
        // only then explains: a 4xx message crosses the REST boundary bounded
        // at 500 characters by truncating its TAIL (`CLIENT_MESSAGE_MAX`), so
        // the explanation is the half an author can lose and still act.
        //
        // The save name: the row this container would be.
        const rowHides = 'this container would be that row, so';
        const sibling = siblingServing(saveName);
        if (sibling) {
            return refusal(
                `it is saved under '${saveName}', which is a name the stored container '${sibling.container.name}' `
                + `expands (its ${kindOn(sibling.item)}). ${asMemberOf(sibling.container.name)}, or save `
                + `${viewItem(saveName)}. An expanded view fills only a name that has no stored row of its own, and `
                + `${rowHides} that view would no longer be served and no read would answer a view under '${saveName}'.`,
            );
        }
        const shipped = shippedServing(saveName);
        if (shipped) {
            return refusal(
                `it is saved under '${saveName}', which is the name of the ${kindOn(shipped)} the package `
                + `'${String(shipped._packageId)}' ships. Save ${viewItem(saveName)} to override the packaged view, or `
                + `save ${ofItsOwn}. A stored row under a packaged view's name takes that view's place, and ${rowHides} `
                + `the packaged view would no longer be served and no read would answer a view under '${saveName}'.`,
            );
        }
        const own = served.find((expanded) => expanded.name === saveName);
        if (own) {
            const object = String(own.object);
            const objectRow = records.find((record) => record?.name === object && record?.name !== saveName);
            const firstArm = objectRow === undefined
                ? `Save the container under its object's name, '${object}'`
                : isAggregatedViewContainer(host.storedOverlayEntries({ type }, [objectRow])[0]?.data)
                    ? asMemberOf(object)
                    : `Save ${ofItsOwn}`;
            return refusal(
                `it is saved under '${saveName}', which is a name its own expansion produces (its ${kindOn(own)}). `
                + `${firstArm}, or save ${viewItem(saveName)}. An expanded view fills only a name that has no stored `
                + `row of its own, and ${rowHides} no read would answer a view under '${saveName}'.`,
            );
        }

        // Every name its expansion produces: the views this container would serve.
        for (const view of served) {
            const name = String(view.name);
            const taken = `its ${kindOn(view)} would be served as '${name}'`;
            const other = siblingServing(name);
            if (other) {
                return refusal(
                    `${taken}, a name the stored container '${other.container.name}' already expands. `
                    + `${asMemberOf(other.container.name)}, or save ${viewItem(name)}. Saved under '${saveName}', this `
                    + `container and that one would both serve '${name}': the one read last would replace the other's `
                    + `view on both doors, and nothing would say why.`,
                );
            }
            const packaged = shippedServing(name);
            if (packaged) {
                return refusal(
                    `${taken}, the name of the ${String(packaged.viewKind)} view the package `
                    + `'${String(packaged._packageId)}' ships. Save ${viewItem(name)} to override the packaged view, or `
                    + `give the member a key of its own that no package ships and no stored container expands. Saved `
                    + `under '${saveName}', this container's view would replace the packaged view on both doors, and `
                    + `nothing would say why.`,
                );
            }
        }
        return undefined;
    }

    /** [#28355] The body of {@link saveMetaItem} before its refusal audit; that method's docblock is the contract. */
    static async saveMetaItemUnaudited(host: Pick<ProtocolHost, 'anonymousElevatedFlowRefusal' | 'applyRegistryWriteThrough' | 'assertLockAllowsWrite' | 'assertRuntimeAuthoringRules' | 'authoredLockFamily' | 'authoringChannel' | 'carryForwardRedactedCredentials' | 'classifyObjectContribution' | 'codeOnlyCreateError' | 'codeOnlyOverrideError' | 'credentialChannelFor' | 'defaultRecordPageSaveRefusal' | 'emitMetadataMutation' | 'engine' | 'ensureObjectStorage' | 'ensureOverlayIndex' | 'envWritableTypes' | 'externalBindingSaveRefusal' | 'flowCanonicalizeFallbackWarned' | 'flowSaveReplaysRetired' | 'getOverlayRepo' | 'isArtifactBacked' | 'isOverlayAllowed' | 'isRuntimeCreateAllowed' | 'isWritablePackage' | 'namedBaseOverlayWriteRefusal' | 'objectExtensionItemRefusal' | 'objectNamespacePrefixViolation' | 'objectRegistrationRefusal' | 'overlayPackageMismatchError' | 'overrideWriteVerdict' | 'packagelessAddress' | 'packagelessDraftAddress' | 'packagelessOverlayWriteRefusal' | 'permissionSetNameCollisionRefusal' | 'readMetaItem' | 'receiptVersion' | 'recordMetadataAudit' | 'refuseOrganizationScopedWrite' | 'refusePackagedBaseOverride' | 'refuseUngrammaticalMetaItemName' | 'refuseUnmintableMetaType' | 'registryAllowsOverlay' | 'resolveFlowCanonicalizer' | 'resolveSduiManifest' | 'restoreInjectedColumnEchoes' | 'restoreTranslatedObjectEchoes' | 'restoredCredentialPathsFor' | 'runAuthoringGate' | 'runMutationProjector' | 'saveConflict' | 'saveWriteBinding' | 'seedExternalIdSaveRefusal' | 'storableViewFallbackWarned' | 'storedParentForToken' | 'stripServedObjectColumns' | 'tenantAuthoredWriteRefusal' | 'uninstalledNamedBaseRefusal' | 'unknownDatasourceSaveRefusal' | 'unknownGrantObjectSaveRefusal' | 'unknownPicklistBindingSaveRefusal' | 'viewContainerNameCollisionRefusal'>, request: SaveMetaItemRequest) {
        // [ADR-0131 D6] FIRST, before every other gate and every read: an
        // organization-scoped write is refused for every type, draft or
        // publish. See {@link organizationScopedWriteRefusal}.
        host.refuseOrganizationScopedWrite(
            `Metadata item '${request.type}/${request.name}'`, request,
        );
        // [commit fd6bdf89f] The ADR-0112 envelope this refusal always owed. Every OTHER
        // refusal in this method declares `code` AND `status`
        // (`NOT_OVERRIDABLE`/403, `NOT_CREATABLE`/403, `ITEM_LOCKED`/403,
        // `OBJECT_OVERLAY_PACKAGE_MISMATCH`/422, the org-scope and
        // destructive-change refusals, the parent-version conflict/409); this
        // one declared neither, and an undeclared throw is withheld by
        // {@link clientFacingFailureText} (a positive list keyed on 4xx
        // `status`) and rendered `500 INTERNAL_ERROR` by `handleRouteError` —
        // a SERVER FAULT for what is purely the caller's mistake, telling the
        // author less than the producer knew and inviting a pointless retry.
        //
        // MEASURED reachable from the wire — this is an AUTHORING refusal, not
        // a programming-error guard. `PUT /api/v1/meta/:type/:name` unwraps the
        // `{ item }` / `{ metadata }` envelope shapes before calling here, so
        // `{"item": null}` and `{"metadata": null}` arrive as `item: null` and
        // land exactly here (measured end to end against a live server: both
        // answered `500 INTERNAL_ERROR` before this change). ⚠️ A missing,
        // empty or literal-`null` BODY does NOT reach this guard: the route
        // folds it to `{}`, which is truthy, and the per-type Zod parse below
        // refuses it with `422 INVALID_METADATA` — so this guard's whole
        // reachable population is the explicitly-null envelope.
        //
        // `INVALID_REQUEST`/400 rather than the `INVALID_METADATA`/422 the
        // sibling refusals use, and NEITHER mints a code: both are already
        // registered to this package in the ADR-0112 ledger (D3). The 422
        // sites all describe a body that EXISTS and failed the per-type parse,
        // and every one carries structured `issues`; here there is no body to
        // validate and no issues to report, so a 422 would misdescribe the
        // failure and break that convention. The structural twin is
        // {@link rollbackMetaItem}'s own opening guard — same class, same
        // position, a malformed REQUEST ENVELOPE rather than an off-spec
        // document — which is `INVALID_REQUEST`/400.
        if (!request.item) {
            const err: any = new Error(
                `saveMetaItem requires an 'item' body for '${request.type}/${request.name}'. `
                + `Send the metadata document as the request body, or wrap it as {"item": {...}} / {"metadata": {...}}. `
                + `An explicitly null item is refused rather than persisted as an empty document.`,
            );
            err.code = 'INVALID_REQUEST';
            err.status = 400;
            throw err;
        }
        // [#24395] The authoring surface the draft save stamps on every key
        // path it changes: a value outside the closed set is refused here,
        // before any read or write, with the request-envelope refusal above —
        // never stamped as `api`, which would record a caller's mistake as
        // a fact about who wrote the draft. The HTTP doors never send
        // `copilot` or `mcp` (`metaSaveRequestOptions`); an in-process tool may.
        if (request.surface !== undefined && !MetadataAuthoringSurfaceSchema.safeParse(request.surface).success) {
            const err: any = new Error(
                `saveMetaItem 'surface' must be one of copilot, mcp, studio or api for '${request.type}/${request.name}'; `
                + `got ${JSON.stringify(request.surface)}. Omit it for a save that is none of the copilot, an MCP client or Studio (recorded as api).`,
            );
            err.code = 'INVALID_REQUEST';
            err.status = 400;
            throw err;
        }
        // [#27176] The OAuth client an `mcp` save names, stated only by the
        // MCP build door: refused beside any other surface (a client is the
        // MCP door's attribution, never a label another caller borrows) and
        // refused malformed, both before anything is read or written.
        if (request.client !== undefined
            && (request.surface !== 'mcp' || authoringClientOf(request.client) === undefined)) {
            const err: any = new Error(
                request.surface !== 'mcp'
                    ? `saveMetaItem 'client' is stated only with surface 'mcp' for '${request.type}/${request.name}'; `
                      + `got surface ${JSON.stringify(request.surface ?? null)}. Only the MCP build door names the OAuth client it verified.`
                    : `saveMetaItem 'client' must be { id, name? } with a non-empty id and, when present, a non-empty name `
                      + `for '${request.type}/${request.name}'.`,
            );
            err.code = 'INVALID_REQUEST';
            err.status = 400;
            throw err;
        }
        // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}.
        request = canonicalizeMetaRequestType(request);
        // [commit 311433f6b] The item-name grammar verdict — static, request-only, so it
        // runs before the store-backed type probe below. Closes the measured
        // slash bypass: a slash-bearing name used to skip the #8421 refusal
        // entirely. See {@link refuseUngrammaticalMetaItemName}.
        host.refuseUngrammaticalMetaItemName(request);
        // [#8421] …and the second verdict, on the door that MINTS. Kept here
        // rather than inside the fold above because it is not answerable from
        // the request alone — see {@link refuseUnmintableMetaType} for the
        // scoping, its exemption, and the measurements behind it.
        await host.refuseUnmintableMetaType(request);
        // What the history row, the audit row and the watch event record as the
        // origin of this write. Defaults to this method — the ordinary Studio /
        // REST / SDK save. The only caller that overrides it is
        // {@link migrateStoredMetadata} (`'migrate-stored'`), so an operator
        // reading a diff can tell a canonicalization pass from an author's edit
        // (#4327). NOT request-derived: the REST layer builds this request field
        // by field and never forwards a client-supplied `source`, so provenance
        // stays something the server states, not something a caller claims.
        const writeSource = request.source ?? 'protocol.saveMetaItem';
        // Drop OUR OWN read decorations before anything reads the body (#4326).
        // The write path persists verbatim by design for every type but `view`
        // (ADR-0005 appendix (c), the "Addendum — 2026-05-16 (c)"), and a view
        // is gated on this same body before it is projected, so
        // the standard Studio round-trip — GET (decorated) → edit → PUT the whole
        // body — would otherwise bake a read-time verdict into the row, its
        // checksum, and every history diff. See {@link stripReadDecorations} for
        // why this is a silent strip and which underscore keys are NOT touched.
        // Placed first so the destructive-change diff, the schema gate, the
        // authoring gate and the persisted body all see the same document.
        request.item = stripReadDecorations(request.item);
        // [#16702] …and the three DERIVED protection keys, for the same reason
        // one beat later. `metadata-read-decorations.ts` deliberately does NOT
        // strip `_provenance` from a SERVED document (a served body must keep
        // its provenance on re-parse), so the very same round-trip echoed
        // `_packageId` / `_packageVersion` / `_provenance: 'package'` straight
        // back into the tenant's own row — and for every non-`object` type the
        // hydrated row's own bytes then decided it was a code artifact, closing
        // the tenant out of their own item with `NOT_OVERRIDABLE` forever. The
        // read side recomputes all three from the artifact on every read
        // ({@link mergeArtifactProtection}), so nothing is lost by not storing
        // them. See {@link DERIVED_PROVENANCE_KEYS} for why `_lock*` is NOT in
        // the set. Placed alongside the decoration strip so the
        // destructive-change diff, the schema gate, the authoring gate and the
        // persisted body all still see one document.
        //
        // [#20761, ADR-0126 §2] …except for a FLOW, which is asked the one
        // authoring rule FIRST, while the body still carries the stamps the
        // caller sent: a flow no managed package loaded, sent with stamps that
        // would classify it as code-shipped, is refused loudly rather than
        // stripped silently, and a flow the loader's set holds is a locked
        // base. [#20863] The base this save names rides along, because the
        // rule refuses one no installed package holds — a binding the
        // platform could never honour. A tenant row's own stamps echoed on a
        // round trip pass and are stripped below as for every type. Every
        // other type is untouched — {@link tenantAuthoredWriteRefusal}
        // answers `null` for it.
        //
        // Asked of AUTHORING writes only. The two server-stated rewrites of
        // rows this store already holds — {@link migrateStoredMetadata}
        // (`source: 'migrate-stored'`, the only caller that states a source)
        // and {@link duplicatePackage} (`writeFace: 'package-duplicate'`) —
        // are no caller's claim about anything: a row stored before the
        // #16702 strip may still carry stale stamps, and rewriting it keeps
        // the silent strip it always had rather than failing the rewrite.
        // [ADR-0146 D2, ruling A on #28390] The override write gate — on every
        // save, whatever its source, and ahead of the flow-only sealed check
        // below, so a declared or same-named item meets its own named
        // refusal rather than a regime sentence: only the base's paired
        // `<base>.custom` declares an override; a dependent's same-named item
        // is refused (rename, or for the pair declare-or-rename); `overrides`
        // on a dependent, on a package outside the closure or on a type with
        // no override channel is refused. An admitted declaration is the
        // pair's own row: the sealed refusal does not apply to it, and the
        // store is told a runtime-only write (both below).
        //
        // A refused DECLARATION throws here. An undeclared same name throws
        // just before the store is asked (below), after every refusal this
        // door already answered for that write, so no existing refusal's code
        // or status changes (a view container's name collision keeps its
        // 400, a lock its ITEM_LOCKED).
        //
        // [ADR-0146 D11] …and AHEAD of it, the package-less write onto a
        // packaged item, closed: an authoring save naming no package, of an
        // item a code package ships, on one of the five overlay types, whose
        // row `os migrate packageless-overlays` would move (#28576 ruling 2:
        // every row it leaves keeps this write), is refused naming the base's
        // paired `.custom` and the ceremony
        // ({@link packagelessOverlayWriteRefusal}). Ahead of the gate so the
        // writer reads that fix, not the gate's "a row bound to no package
        // carries `overrides`… rename" for the body Setup sends as it read
        // it. Every other type's packaged item is sealed further down
        // ({@link refusePackagedBaseOverride}). Registry reads first: the
        // close's one store read (the item's rows) happens only for a name
        // one read-only package ships with an ensurable pair, so #5706's lock
        // gate stays the first store reader of every other name. The
        // server-stated rewrites (`source` set, `package-duplicate`) name the
        // row they rewrite and are not asked.
        //
        // This retires the migration window's allowance (a package-less save
        // landing on a pair row the ceremony moved kept that row's
        // declaration): such a save is this refusal now.
        //
        // [#28905, ADR-0146 D1, D11] …and the save NAMING the read-only base
        // itself (`?package=<base>`, draft or active), of an item of one of the
        // five overlay types it ships: refused with the same fix, the pair
        // ({@link namedBaseOverlayWriteRefusal}; registry reads only). Before
        // it, such a save landed an undeclared row bound to the base, served
        // in place of the base's document and never seen by the ceremony.
        if (request.source === undefined && request.writeFace !== 'package-duplicate') {
            const closed = await host.packagelessOverlayWriteRefusal({
                type: request.type,
                name: request.name,
                packageId: request.packageId,
                state: request.mode === 'draft' ? 'draft' : 'active',
                item: request.item,
            }, 'save');
            if (closed) throw closed;
            const namedBase = host.namedBaseOverlayWriteRefusal({
                type: request.type,
                name: request.name,
                packageId: request.packageId,
                item: request.item,
            }, 'save');
            if (namedBase) throw namedBase;
        }
        const overrideVerdict = host.overrideWriteVerdict(request);
        if (overrideVerdict.verdict === 'refuse' && overrideVerdict.rule !== 'undeclared_same_name') {
            throw overrideWriteRefusalError(overrideVerdict);
        }
        const declaredOverride = overrideVerdict.verdict === 'admit';
        if (request.source === undefined && request.writeFace !== 'package-duplicate') {
            const authored = await host.tenantAuthoredWriteRefusal({
                type: request.type,
                name: request.name,
                item: request.item,
                ...(request.packageId ? { packageId: request.packageId } : {}),
            });
            if (authored) throw authored;
            // [#26708] …and the named-base rule for EVERY type, draft or
            // active: a base the save names must be an installed package. A
            // flow was asked it just above, at its own position; the second
            // ask answers the same. See {@link uninstalledNamedBaseRefusal}.
            const unbound = host.uninstalledNamedBaseRefusal(request);
            if (unbound) throw unbound;
        }
        request.item = stripDerivedProvenance(request.item);
        // [#6562] …and OUR OWN injected system columns, for the same reason and
        // at the same moment. `governServedItem` now serves the EFFECTIVE object
        // schema, so the very same Studio round-trip would otherwise persist
        // `created_at` / `owner_id` / `organization_id` / … into a body whose
        // author declared none of them — turning the platform's own columns into
        // a phantom customization in `sys_metadata`, in the checksum, in every
        // history diff, and in the layered read's `overlay` layer. Placed
        // alongside the decoration strip so the destructive-change diff, the
        // schema gate, the authoring gate and the persisted body all still see
        // one document. See {@link stripServedSystemColumns} for why this is a
        // separate strip from the decoration list and not another entry in it.
        //
        // [#29673] …and, one beat BEFORE that strip, the read's TRANSLATION
        // of an injected column taken back off: a label the `/meta` read served
        // in the caller's language through the built-in table is put back to
        // the platform's own text, so the column is the platform's definition
        // again and comes off with the rest. Pure — no read, so it runs before
        // the refusals. The author's own slots are compared with the stored
        // row later, beside the credential carry-forward that reads the same
        // row. See {@link restoreInjectedColumnEchoes}.
        request.item = host.restoreInjectedColumnEchoes(request);
        request.item = host.stripServedObjectColumns(request.type, request.item);
        // Per-item lifecycle (ADR-0005 §"Drafts"). Default is `'publish'`
        // (legacy semantics — save goes straight live) to keep callers
        // that predate the draft/publish split working. Studio's
        // designer surface opts into staged drafts by sending
        // `?mode=draft`; the `POST /publish` endpoint then promotes it.
        const mode: 'draft' | 'publish' = request.mode === 'draft' ? 'draft' : 'publish';

        // ADR-0005 (extended — two-tier model): project-kernel customization is
        // gated by per-item provenance, not just the type-level flag.
        //
        //  • Item exists as a packaged artifact → require `allowEnvironmentOverlay`
        //    (writing here would overlay code-shipped behaviour; gated for
        //    security on executable types like hook/trigger/validation).
        //  • Item does NOT exist as an artifact → require `allowRuntimeCreate`
        //    OR `allowEnvironmentOverlay`. This lets users author brand-new hooks /
        //    validations / triggers without unlocking the artifact-shadowing
        //    capability. Returns `not_creatable` (vs `not_overridable`) so
        //    the UI can present a tailored message.
        const overlayAllowed = host.isOverlayAllowed(request.type);
        const runtimeCreateAllowed = host.isRuntimeCreateAllowed(request.type);

        // #5086 — CODE-ONLY TYPES ARE REFUSED ON EVERY KERNEL, not only on
        // project-scoped ones. A type whose registry entry sets BOTH
        // `allowRuntimeCreate: false` AND `allowEnvironmentOverlay: false` declares
        // that it has **no runtime write channel at all** — today `job`
        // (#4509: `handler` resolves only through the compiled bundle's
        // function table, so a runtime-created job could never be scheduled)
        // and `agent` (ADR-0063 §2: platform-owned, per-org forks withdrawn).
        //
        // The rest of this block stays behind `environmentId !== undefined`
        // because ADR-0005 §"Whitelist enforcement" deliberately keeps the
        // *overlay* whitelist off single-kernel deployments ("keep their
        // existing behaviour"). That sentence predates `allowRuntimeCreate`
        // and speaks only of the overlay list — it never granted a topology
        // the right to author a type the registry declares code-only. And the
        // premise the carve-out rests on ("this kernel is the package
        // author's own bootstrap channel") is simply not true for the CLI's
        // lightweight assembler: a host config with instantiated plugins
        // (`isHostConfig` → `shouldBootWithLibrary === false`) boots
        // `new ObjectQLPlugin()` with NO environmentId, so the flagship
        // showcase — a self-hosted app server whose `PUT /api/v1/meta/*` is
        // an END-USER surface — ran with this entire gate disengaged. Keying
        // authorization off a row-scoping key is what made a type-level
        // declaration depend on deployment topology; the declaration decides
        // it here instead.
        //
        // [#22220] "The rest of this block" no longer stays behind it either:
        // the package door below now asks on every topology too — see its
        // call site for why that moves no acceptance set.
        //
        // `isOverlayAllowed` still consults `OS_METADATA_WRITABLE`, so the
        // documented operator escape hatch stays the ONE door: unlocking a
        // type there unlocks it here too — [ADR-0131 D6] for a NEW item only.
        // An item a managed package ships is sealed, so for it this refusal
        // reads the registry alone ({@link isSealedManagedItem}'s type half):
        // with the hatch open or shut it is refused here, by the same sentence,
        // instead of being carried past this gate to be refused by the package
        // door in another one. `deleteMetaItem` is deliberately NOT gated the
        // same way — removing a code-only row that predates this refusal is
        // repair, and must stay possible.
        //
        // [#6960] THAT CARVE-OUT NOW NAMES BOTH TIERS, because as written it
        // covered only the CODE-ONLY one (`allowRuntimeCreate: false` AND
        // `allowEnvironmentOverlay: false`, i.e. the `if` immediately below) while
        // the identical argument had grown a second population: an
        // ARTIFACT-BACKED item of a type that kept `allowRuntimeCreate: true`
        // and had its `allowEnvironmentOverlay` ROLLED BACK to `false` (commit
        // ee58392e1 — `permission` / `position` / `page` / `app` / `dataset` /
        // `book`). Its loader still merges the overlay at read time
        // (`supportsOverlay: true`, untouched by the rollback), so a row
        // authored before the rollback keeps shaping the effective body while
        // the ordinary "Reset to package default" answered 403 — repair
        // reachable only through the operator hatch. The maintainer ruled on
        // 2026-08-10 that the delete side moves for that tier too: the
        // removal restores the code-declared state, is strictly narrowing,
        // and cannot widen anything.
        //
        // ⛔ THE ASYMMETRY IS DELIBERATE AND DELETE-ONLY. This gate and the
        // artifact-backed refusal below it are UNCHANGED: create and update
        // on such an item stay refused exactly as today. Do not "restore
        // symmetry" in either direction — symmetrizing towards delete re-opens
        // the write door commit ee58392e1 closed, symmetrizing towards save re-traps the
        // repair. And the relaxation is keyed on `supportsOverlay`, not on
        // `allowEnvironmentOverlay`, so it stops at the tier boundary: `object`
        // (`supportsOverlay: false`, its overlay a contributor LAYER per
        // ADR-0029 D9) keeps refusing both verbs, which is D9.6's declared
        // cost and is pinned. See {@link deleteMetaItem}.
        if (!runtimeCreateAllowed) {
            const shipped = host.isArtifactBacked(request.type, request.name);
            const channel = shipped
                ? host.registryAllowsOverlay(request.type)
                : overlayAllowed;
            if (!channel) {
                throw shipped
                    ? host.codeOnlyOverrideError(request.type, request.name)
                    : host.codeOnlyCreateError(request.type);
            }
        }

        // [#8184] THE PACKAGE DOOR — the refusal of a write onto an item a
        // code package ships, on a type with no per-org overlay channel.
        // The verdict and its full record live in
        // {@link refusePackagedBaseOverride}: [#20679] lifted out of this
        // method UNCHANGED, so a second write door onto the same artifact
        // asks this exact predicate and gets this exact emitter through
        // {@link packagedBaseRefusal}, rather than a copy that agrees with
        // this one only until either of them moves.
        //
        // [#22220] ON EVERY TOPOLOGY, and HERE: ahead of every check below
        // that judges the request's body or the store. It used to sit behind
        // `environmentId !== undefined`, on the ground that a host-config
        // kernel meets the same predicate one layer down, at the repository
        // write (`SysMetadataRepository.assertAllowed`, the first statement
        // of `repo.put`). It does, but `repo.put` is this method's LAST act,
        // so on that kernel every refusal in between answered first. Measured
        // on a host-config boot: a publish of a packaged `object` whose body
        // the runtime authoring gate refuses answered `422 INVALID_METADATA`
        // where an environment kernel answered `403 NOT_OVERRIDABLE` for the
        // same request, and a body the spec-conformance parse refuses did the
        // same in draft and publish mode. The author was told to repair
        // findings that no write through this door could ever land, and was
        // refused for the basic reason only after repairing them. The same
        // window held the ADR-0029 D9.9 package mismatch, the destructive
        // diff, the layered-envelope and save-name refusals, the flow
        // conversion conflict, the stored-hook body refusal and the domain
        // plugins' authoring gates; #21694 had taught the `_lock` gate below
        // to defer to this door by hand. Asked once, here, the door answers
        // before all of them — one request, one refusal, on both kernels —
        // and none of them has to learn to defer to it.
        //
        // ⛔ NO ACCEPTANCE SET MOVES. This predicate is the repository's
        // (the registry's `allowEnvironmentOverlay` — [ADR-0131 D6] never the
        // `OS_METADATA_WRITABLE` hatch for an item a managed package ships —
        // and a named read-only base through the one `isWritablePackage`),
        // and `repo.put` refuses every write it refuses, on every topology —
        // so a request refused here was refused before, and only which
        // refusal its author reads has changed: the same code and status on
        // both kernels, and this door's sentence on both. The repository's
        // check stays the store-level backstop for the doors that reach `put`
        // without passing here (draft promotion, restore, revert). Nor does
        // this retire a single-kernel carve-out: ADR-0005 §"Whitelist
        // enforcement" kept such deployments "any type writable", but the
        // repository has refused these writes on them all along; the door
        // only answers first.
        //
        // [#23577] Every write over a sealed name reads one sentence: the
        // first-write pin (`If-None-Match: *`) declares no create, so the door
        // advises neither a create nor an edit.
        // [ADR-0146 D2] An admitted declared override (see the gate above) is
        // the pair's own row: the sealed refusal judges the base's managed
        // item, so it does not apply to it.
        if (!declaredOverride) host.refusePackagedBaseOverride(request);

        // ADR-0010 L3 — per-item lock. Artifact `_lock` (or persisted
        // overlay `_lock`) blocks save independent of the L1 type-level
        // flag. Records the denial in `sys_metadata_audit` before
        // throwing so refused attempts are visible in compliance reports.
        //
        // [#21694] On EVERY topology — it used to sit inside the package
        // door's `environmentId` block, so a host-config kernel never asked
        // it (see {@link lockWriteRefusal}). Its rank is unchanged and is the
        // same on every kernel: BELOW the package door. #21694 kept that rank
        // on a host-config kernel by asking {@link packagedBaseRefusal} here,
        // because that kernel's door then answered only at the repository
        // write; [#22220] the door above now throws on every kernel whenever
        // it refuses, so that question always answered "no refusal" here and
        // is gone. One request, one refusal code, on both kernels — the
        // `_lock` gate never pre-empts `NOT_OVERRIDABLE` on either topology.
        {
            const lockErr = await host.assertLockAllowsWrite({
                type: request.type,
                name: request.name,
                // [#21761] The save's address carries its package, as the read's does.
                ...(request.packageId ? { packageId: request.packageId } : {}),
                operation: 'save',
                ...(request.actor ? { actor: request.actor } : {}),
                source: writeSource,
            });
            if (lockErr) throw lockErr;
        }

        // [#23165, ADR-0048] THE WRITE ADDRESS of a direct save that names no
        // package: the item's own package when its active rows are bound to
        // exactly one ({@link packagelessAddress}). It used to be the
        // package-unbound row, always, so a save of a package's item minted a
        // second row beside the package's and answered `200` while the item
        // read kept serving the package's row. The draft save already resolved
        // its address this way (#11087, `SysMetadataRepository.resolveWriteHead`).
        //
        // Resolved ONCE, here, and from here on the save IS a save naming that
        // package: every gate below that asks about the row this save writes
        // (the D9.9 object check, the stored lock family, the runtime
        // authoring gate, ADR-0070 D1's writable-base check, the lock parent,
        // the credential carry-forward, `repo.put`, the registry write-through
        // and the receipt) reads the same `packageId`, so no two of them can
        // judge different rows. A package that is read-only answers here what
        // `?package=` naming it answers.
        //
        // Below the authorization refusals on purpose: the code-only refusal,
        // the package door and the `_lock` gate judge the item, not its row,
        // and they answer before this store read, as #22220 ordered.
        //
        // Asked of a publish-mode AUTHORING save whose `packageId` is absent or
        // `null`, the two spellings of "no package" the request contract
        // states. Not asked of: a save that names a package (ADR-0048, its
        // address is its own); a draft save, whose binding the repository
        // resolves (#11087); the server-stated rewrites of a row this store
        // already holds (`source` set: the stored-metadata migration and the
        // stored flow-credential move, which pass `null` for the
        // package-unbound row they read and rewrite; `package-duplicate`,
        // which always names its target), the same two the authoring rules
        // above exempt.
        //
        // Several bindings is a name more than one package holds, and a save
        // naming none of them is refused, not guessed.
        // [#23514] Whether the CALLER named a package, read before the address
        // below may name one for it: the D9.9 refusal's prescription differs.
        const namedNoPackage = request.packageId == null;
        if (
            mode === 'publish'
            && request.packageId == null
            && request.source === undefined
            && request.writeFace !== 'package-duplicate'
        ) {
            const writeType = PLURAL_TO_SINGULAR[request.type] ?? request.type;
            const address = await host.packagelessAddress(
                writeType, request.name, itemDiscriminator(writeType, request.item),
            );
            if (address.candidates.length > 1) {
                throw packagelessAddressAmbiguityRefusal('save', request.type, request.name, address.candidates);
            }
            if (address.packageId !== null) request = { ...request, packageId: address.packageId };
        }

        const singularType = PLURAL_TO_SINGULAR[request.type] ?? request.type;

        // [#23712] The draft a draft save naming no package writes
        // ({@link packagelessDraftAddress}): the repository resolves its
        // binding (#11087), so `packageId` stays empty, but the address is
        // read here for the two gates below that judge the row it lands in.
        // Read once, for the same authoring saves the publish-mode address
        // above is resolved for.
        const draftAddress = mode === 'draft'
            && request.packageId == null
            && request.source === undefined
            && request.writeFace !== 'package-duplicate'
            ? await host.packagelessDraftAddress(
                singularType, request.name, itemDiscriminator(singularType, request.item),
            )
            : undefined;

        // [#26921] THE NAMED-BASE RULE for the binding a save naming no
        // package INHERITS: the package its address gives (the resolved
        // `packageId` above for a publish-mode save; the draft address's
        // package for a draft save) must be installed too. Rows bound to an id
        // no installed package has were stored before the save door refused
        // naming one, and this save kept extending them. Refused, naming the
        // id and the way out, ⛔ never re-homed package-less in silence: that
        // would move the item without a word. Not asked of a save that names a
        // package (asked above as named) nor of the server-stated rewrites,
        // which resolve no address. An ambiguous draft address is left to the
        // repository's `409`, as before. See {@link uninstalledNamedBaseRefusal}.
        if (namedNoPackage && request.source === undefined && request.writeFace !== 'package-duplicate') {
            const inherited = mode === 'draft'
                ? draftAddress && draftAddress.kind !== 'ambiguous' ? draftAddress.into : null
                : request.packageId ?? null;
            const unboundInherited = host.uninstalledNamedBaseRefusal(
                { type: singularType, name: request.name, packageId: inherited },
                { inherited: true },
            );
            if (unboundInherited) throw unboundInherited;
        }

        // [ADR-0029 D9.9 / #6995] The refusal that is about REPRESENTABILITY
        // rather than authorization: an `object` overlay bound to a package
        // that does not own the object. See
        // {@link overlayPackageMismatchError} for why one object name can
        // carry at most one overlay layer while `sys_metadata` can hold two
        // rows for it.
        //
        // AT THE PRODUCER, deliberately. Before D9 this row reached
        // `registerObject`, which threw `already owned by package "…"` into
        // `applyObjectRegistryMutation`'s best-effort `console.warn` — and
        // `saveMetaItem` still returned a SUCCESS RECEIPT for a write the
        // runtime had discarded (#6995, the silent write-side divergence).
        // The receipt and the registry now agree because the write never
        // happens: this precedes `ensureOverlayIndex` and every `put`.
        //
        // [#23514] The same holds for an object its package-less definition
        // owns (the `'sys_metadata'` sentinel): a save naming a package beside
        // it is refused here, with the move-into-a-package prescription
        // ({@link unboundOwnerPackageRefusal}).
        //
        // [#23712] …asked of the package the write lands in. A draft save
        // naming no package keeps `packageId` empty (the repository resolves
        // its binding, #11087), but it writes the draft
        // {@link packagelessDraftAddress} names, which over a row bound to
        // `Q`, or a lone draft bound to `Q`, is `Q`'s: judged with the
        // request's empty package, the sentinel owner read `own` and the save
        // answered `200` for a draft no publish can serve. An ambiguous
        // address is left to the repository's `409`, as before. The address
        // is the one read above, before the named-base rule's inherited arm.
        // [#29673] The object layer the D9.9 block below classified, for the
        // registry's refusal asked after the spec gate.
        let objectRegistrationLayer: ReturnType<ObjectStackProtocolImplementation['classifyObjectContribution']> | undefined;
        if (singularType === 'object') {
            const writtenPackage = draftAddress && draftAddress.kind !== 'ambiguous'
                ? draftAddress.into
                : request.packageId;
            const layer = host.classifyObjectContribution(request.name, writtenPackage);
            if (layer.kind === 'mismatch') {
                // [#23514] For a sentinel owner the way out depends on the
                // state: the mode, whether the caller named a package, and
                // which packages' rows are already stored beside the
                // package-less one (any package, not only the one named).
                const storedPackages = layer.ownerPackageId === 'sys_metadata'
                    ? (await host.packagelessAddress(singularType, request.name)).candidates
                    : [];
                // [#23712] With no package-unbound draft stored, the address
                // is a package's draft once the rows are gone (`409` over
                // two), so each such draft is discarded by its package too.
                const strandedDrafts = draftAddress && draftAddress.kind !== 'ambiguous' && !draftAddress.drafts.unbound
                    ? draftAddress.drafts.candidates
                    : [];
                throw host.overlayPackageMismatchError(
                    request.name, layer.packageId, layer.ownerPackageId,
                    { mode, storedPackages, namedNoPackage, strandedDrafts },
                );
            }
            // [#29673] …and the layer the registry's own refusal of the BODY
            // is asked under, after the spec gate below.
            objectRegistrationLayer = layer;
        }

        // [#24547 · ADR-0129 D2] THE NAMESPACE-PREFIX RULE, on the door that
        // makes an object live directly. Every object a package defines MUST
        // be named `${namespace}_${shortName}`; the publish pre-flight
        // ({@link publishPackageDrafts}) refused an unprefixed object draft
        // with `NAMESPACE_PREFIX`, while this save stored the very same name
        // `active` under the very same package — an object live under a name
        // its own package's drafts could never publish again. The three doors
        // that make an object live under a package — this save, the publish
        // pre-flight and the per-item publish ({@link publishMetaItem}, asked
        // in {@link promoteDraftForPublish}) — ask one judge
        // ({@link objectNamespacePrefixViolation}) and answer its one authored
        // prescription.
        //
        // Judged against the package this save WRITES: the one it names, or
        // the one a package-less publish save resolved to above — the save IS
        // a save naming that package from there on. After the D9.9 refusal on
        // purpose: an object bound to a package that does not own it is told
        // which package does, before it is told how to rename it under the
        // wrong one. Before every gate that reads or reshapes the body, so a
        // refused name costs no parse and writes nothing.
        //
        // Asked of a publish-mode save only. A draft is not live: whichever
        // door promotes it judges it — the publish pre-flight batch-atomically
        // and in one report with every other violation, the per-item publish
        // before its promotion writes. Not asked of the
        // server-stated rewrites of a row this store already holds (`source`
        // set: the stored-metadata migration, the stored flow-credential move)
        // — they define no object, and refusing one would strand a repair of a
        // row stored before this door read the rule. The package copies write
        // new rows under their target and are asked like any author:
        // `package-duplicate` names every copied object in the target's
        // namespace by construction, and `package-unmanaged-import` keeps the
        // source's names under the source's namespace, which its plan states
        // as the condition this rule admits them on.
        //
        // `NAMESPACE_PREFIX` / 422: the code the publish pre-flight already
        // stamps for this exact violation, registered to this package in the
        // ADR-0112 ledger, at the status this method gives every other refusal
        // of a body that exists but may not be stored as authored
        // (`INVALID_METADATA`, `OBJECT_OVERLAY_PACKAGE_MISMATCH`).
        if (singularType === 'object' && mode === 'publish' && request.source === undefined) {
            const prefixViolation = host.objectNamespacePrefixViolation(request.name, request.packageId);
            if (prefixViolation) {
                const err: any = new Error(prefixViolation);
                err.code = 'NAMESPACE_PREFIX';
                err.status = 422;
                throw err;
            }
        }

        // [ADR-0010 §3.5, Phase 4.3] A `protection` block is refused, on every
        // type that declares one: only a code package's loader translates it
        // into a lock, and this door writes environment-authored items, so it
        // was stored verbatim and served as a lock that bound nothing. Asked
        // after the authorization refusals above (a locked item still answers
        // `ITEM_LOCKED`, a sealed one `NOT_OVERRIDABLE`) and before every gate
        // that reads or reshapes the body, so the block is judged as authored
        // and a refused save costs no read. The server-stated rewrites — the
        // same two the flow authoring rule above exempts — strip it instead.
        // See {@link protectionBlockRefusal}.
        //
        // [#23119, ADR-0010 §3.5 and §4.1] …and the lock family, at the same
        // position: an author's write persists the family the row it writes
        // already stores. A body echoing a family a read of this item serves
        // is accepted and ignored; one that would set, change or remove the
        // lock is refused in the block's refusal family. The server-stated
        // rewrites keep the family their body carries, as before. See
        // {@link authoredLockFamily}.
        if (request.source === undefined && request.writeFace !== 'package-duplicate') {
            const protectionRefusal = protectionBlockRefusal(singularType, request.item, request.name);
            if (protectionRefusal) throw protectionRefusal;
            request.item = await host.authoredLockFamily({
                type: singularType,
                name: request.name,
                packageId: request.packageId,
                mode,
                item: request.item,
            });
        } else {
            request.item = withoutProtectionBlock(singularType, request.item);
        }

        // Phase 3a-destructive: for `object` writes, diff against the
        // current schema and 409 if the change would drop data — unless the
        // caller has acknowledged the risk with `force: true`. The admin UI
        // surfaces the structured `issues` payload in a confirmation dialog.
        //
        // [commit 2d8b92ff1] `object` ALONE. This condition used to read
        // `(singularType === 'object' || singularType === 'field')`, and the
        // `field` limb could not produce a finding — two independent reasons,
        // BOTH RE-MEASURED through the real `saveMetaItem` before the trim:
        //
        //  1. A `field` body has no `fields` map to diff.
        //     {@link detectDestructiveObjectChanges} reads `prev.fields` /
        //     `next.fields`; a `field` item's body IS one field definition
        //     (`FieldSchema` — a `strictObject` that declares no `fields`
        //     key), so both sides fold to `{}` and every loop in the detector
        //     iterates zero times. Measured: a `text` → `number` change on a
        //     stored `field` row — the exact edit that raises
        //     `field_type_change` INSIDE an object body — saved with no 409,
        //     while the same-shaped change on an `object` refused in the same
        //     harness.
        //  2. `field` is code-only (`allowRuntimeCreate: false` AND
        //     `allowEnvironmentOverlay: false` in the `packages/spec` kernel
        //     registry), so the #5086 refusal ABOVE this gate answers first —
        //     `NOT_CREATABLE` for a runtime-only parent, `NOT_OVERRIDABLE` for
        //     an artifact-backed one (#7743's `isNestedArtifactField` path) —
        //     before persistence and before this diff. Measured on both.
        //
        // ⚠️ Neither reason is absolute, and the trim is right BECAUSE of
        // where they stop, not in spite of it. Reason 2 stops at the
        // documented operator hatch: `OS_METADATA_WRITABLE=field` does carry a
        // `field` write past that refusal and into this gate — and reason 1
        // then holds it inert on its own. Reason 1 stops at SCHEMA-VALID
        // bodies: the detector is type-agnostic, so a stored `field` row
        // carrying a `fields` map did fire this gate. But such a body is one
        // `FieldSchema` rejects (`unrecognized_keys: ['fields']`) — corruption,
        // not authoring — and the finding it produced was a data-loss refusal
        // naming columns that DO NOT EXIST: a `field` write mints a standalone
        // `sys_metadata` row nothing composes into its parent object (#7893),
        // so no driver ever materialised those names. That double fault was
        // the limb's only reachable behaviour, and it was a false alarm.
        //
        // ⛔ Do not "restore" the limb as missing coverage — that reading is
        // precisely what this card was filed to prevent (commit 809e61221's face
        // inventory had to chase a `field` face population that does not
        // exist). Giving `field` a real destructive diff only becomes
        // meaningful if `field` ever becomes runtime-writable, and returns
        // then as a Feature with that change.
        // `protocol.destructive-gate-reachable-types.test.ts` pins the
        // reachable type set and carries the measurements above.
        if (!request.force && singularType === 'object') {
            try {
                // [#23291, ADR-0048] Judged against the row this save
                // overwrites: the read at the save's own address. A
                // package-less publish save has resolved `packageId` to the
                // item's one package above (#23165); a save naming a package
                // with no row of its own reads that package's address, the
                // package-unbound stand-in it overlays. Before, the read named
                // no package, so with a package-unbound row stored beside the
                // package's it judged a row no package-less save writes, and a
                // save naming a third package was judged against another
                // package's row.
                // [#24097] Read through {@link readMetaItem}, not the API face:
                // this check must still see an object of a disabled package.
                // The API face refuses one, and the `catch` below would read
                // that refusal as "skip the check", so a field drop would land
                // without its 409.
                const existing = await host.readMetaItem({
                    type: request.type,
                    name: request.name,
                    ...(request.packageId ? { packageId: request.packageId } : {}),
                } as any);
                const prev = (existing as any)?.item;
                if (prev) {
                    // [#28665, ADR-0055 §1] The master of a `controlled_by_parent`
                    // detail made required: its finding names how many stored rows
                    // hold no master, since those stop serving everyone. One count
                    // per such finding, none on any other save; see the module.
                    const issues = await withNullMasterRowCounts(
                        detectDestructiveObjectChanges(prev, request.item), request.item, request.name,
                        (field) => host.engine.count(request.name, { where: { [field]: { $null: true } }, context: { isSystem: true } }),
                    );
                    if (issues.length > 0) {
                        // [commit 809e61221] Deliberately NOT trimmed to a headline, and
                        // this is a MEASURED verdict rather than an oversight —
                        // the same one the sibling `INVALID_METADATA` message
                        // below carries, reached the same way (#10524's
                        // declare-then-trim order).
                        //
                        // The message restates what `err.issues` already
                        // carries, so a console rendering both channels shows
                        // every finding twice. The trim is nonetheless refused,
                        // because the face inventory says the message is a SOLE
                        // CARRIER on one of the faces that quote it:
                        // `duplicatePackage`'s `failed[].error`, which reports
                        // per-item failures as DATA on a **200** (`POST
                        // /packages/:id/duplicate`). No HTTP boundary is
                        // involved there, so `details.issues` never exists; the
                        // array is typed inline as `{ type, name, error }` with
                        // no `issues` slot; and unlike `publishPackageDrafts` —
                        // whose `failed[]` commit a79bd3561 could extend because it HAS a
                        // response schema — `duplicatePackage` has none in
                        // `packages/spec` at all. Declaring a channel there is a
                        // spec change, and until it lands a trim would delete
                        // the prescription from that wire.
                        //
                        // ⚠️ Reaching that face is not the obvious case: a
                        // duplicate re-namespaces objects, so the target name
                        // usually does not exist and this gate is skipped
                        // entirely. It fires on the duplicate-AGAIN workflow,
                        // where the target namespace already holds the renamed
                        // object. Measured, not argued —
                        // `protocol.destructive-409-face-inventory.test.ts`
                        // carries the whole inventory and pins this face.
                        //
                        // ⛔ Whatever else a future trim does, the remedy
                        // clause below must survive it: this is a
                        // risk-acknowledgement refusal, not a validation one,
                        // and no structured channel on any face carries the
                        // remedy.
                        //
                        // [commit 82cb6e849] Which remedy that IS depends on the face —
                        // `?force=true` names a query parameter only the
                        // single-segment REST `PUT` reads, and prescribing it
                        // to a caller who has no way to set it sends them in a
                        // circle. See {@link destructiveChangeRemedy}.
                        const summary = issues.slice(0, 3).map((i) => i.message).join('; ');
                        const err = new Error(
                            `${request.type}/${request.name} would drop or transform existing data: ${summary}`
                            + (issues.length > 3 ? ` (+${issues.length - 3} more)` : '')
                            + ` — ${destructiveChangeRemedy(request.writeFace, request.name)}`
                        );
                        (err as any).code = 'DESTRUCTIVE_CHANGE';
                        (err as any).status = 409;
                        (err as any).issues = issues;
                        throw err;
                    }
                }
            } catch (err: any) {
                if (err?.code === 'DESTRUCTIVE_CHANGE') throw err;
                // Other errors during the diff lookup are non-fatal —
                // they just skip the safety check.
            }
        }

        // Defense-in-depth: reject the layered *read* envelope as a write body.
        //
        // `getMetaItemLayered` returns a 3-state diagnostic shape
        // `{ type, name, code, overlay, overlayScope, effective, ... }` for the
        // Studio designer's `?layers=true` GET. That envelope is NOT a metadata
        // body — but a designer surface that lacks a dedicated editor for a
        // given type can accidentally PUT the envelope straight back, which (if
        // the per-type Zod schema below is unavailable — e.g. a type with no
        // registered schema, or a stale `@objectstack/spec` build that predates
        // the type being added to the registry) would persist an all-null stub
        // and surface as a metadata diagnostic error in the admin UI. The
        // simultaneous presence of `code`, `overlay`, `overlayScope`, and
        // `effective` is unique to the layered envelope and never appears in a
        // real metadata body, so we reject it here regardless of type/schema.
        {
            const it = request.item as Record<string, unknown>;
            const looksLikeLayeredEnvelope =
                it && typeof it === 'object' && !Array.isArray(it)
                && 'code' in it && 'overlay' in it && 'overlayScope' in it && 'effective' in it;
            if (looksLikeLayeredEnvelope) {
                const err = new Error(
                    `${request.type}/${request.name}: the request body is a layered read `
                    + `envelope ({ code, overlay, overlayScope, effective }), not a metadata body. `
                    + `Unwrap and send the effective/overlay document instead — the layered shape is read-only `
                    + `(GET ?layers=true) and must never be persisted.`
                );
                (err as any).code = 'INVALID_METADATA';
                (err as any).status = 422;
                throw err;
            }
        }

        // Normalize loose `view` bodies to the canonical record shape BEFORE
        // validation + persistence, so no producer (AI tools, hand-authoring,
        // Studio) can persist a view that validates but the console can't bind
        // or render (missing top-level name/object/viewKind). The registry
        // entry this overlay will shadow supplies the missing identity fields
        // (#2555 — a console personalization PUT sends only the raw config).
        // See {@link normalizeViewMetadata}.
        {
            // [#21412, #21470] FIRST, before the stamp below can keep an
            // authored `name`: a body of ANY type whose own `name` disagrees
            // with the name this door files the row under is refused,
            // `VALIDATION_ERROR` / 400, through the one judge the source
            // registrars call. Accepted, it was stored under the row name and
            // registered under the body's (`hydrateOverlayIntoRegistry` keys by
            // `body.name`), so one row answered under a name nobody saved it
            // under and under none by its own. The key here is the save name,
            // not a view container's derived binding: this door keeps a
            // container saved under a name other than its object (#13407,
            // #21334), and the body it stamps for one must pass when sent back.
            // A body with no `name` passes; a view's is stamped below. What
            // counts as a set `name` per type is the judge's header.
            {
                const nameRefusal = savedItemNameRefusal(singularType, request.item, request.name, 'save');
                if (nameRefusal) throw nameRefusal;
            }
            // [ADR-0086 D3] …and a permission set whose body `packageId`
            // disagrees with the package the row is written into, with the
            // same envelope: the body against its address, the second half.
            // Judged against the binding this save RESOLVES, never the
            // request's spelling — see {@link saveWriteBinding}. Asked of every
            // writer, as the name judge is. See
            // {@link permissionSetOwnerBindingRefusal}.
            {
                const ownerRefusal = permissionSetOwnerBindingRefusal(
                    singularType, request.item, request.name,
                    await host.saveWriteBinding(singularType, request, mode),
                    'save',
                );
                if (ownerRefusal) throw ownerRefusal;
            }
            // [ADR-0146 D10, #28564] …and an object body's fields against the
            // `__c` reservation, on the same binding and with the same
            // envelope: `__c` only in a base's paired `.custom`. Asked of every
            // writer, as the owner judge is. See
            // {@link objectBodyExtensionFieldSuffixRefusal}.
            {
                const suffixRefusal = objectBodyExtensionFieldSuffixRefusal(
                    singularType, request.item, request.name,
                    await host.saveWriteBinding(singularType, request, mode),
                );
                if (suffixRefusal) throw suffixRefusal;
            }
            // [#28574, ADR-0146 D10] …and an `object_extension` body against
            // its address, on the same binding and with the same envelope: a
            // package's item, its row name its target, the target registered
            // and inside the package's closure, the registry's own `extend`
            // refusals and the `__c` reservation. Draft and publish alike. See
            // {@link objectExtensionItemRefusal}.
            {
                const extensionRefusal = host.objectExtensionItemRefusal(
                    singularType, request.item, request.name,
                    await host.saveWriteBinding(singularType, request, mode),
                );
                if (extensionRefusal) throw extensionRefusal;
            }
            // [harden] …and a permission set whose NAME another owner already
            // holds, with `NAMESPACE_CONFLICT` / 422: a set's name is its
            // identity across the deployment, and a grant resolves it by that
            // name alone. See {@link permissionSetNameCollisionRefusal}.
            //
            // Judged against the binding the write LANDS IN — ⛔ not
            // {@link saveWriteBinding}'s answer, which is the owner judge's: it
            // reads the store only when the body carries a `packageId`, so for a
            // body without one it named no package while the write went into
            // one. A save that names a package writes that package's row (for a
            // publish-mode save naming none, the package the #23165 address
            // above resolved, already on `request`); a publish-mode save that
            // names none and resolved none writes the package-unbound row. A
            // draft save that names none writes the draft
            // {@link packagelessDraftAddress} names — the address #23712 read
            // above, read here for the server-stated rewrites it is not read
            // for — whose `into` is the binding the repository stamps (#11087,
            // `SysMetadataRepository.resolveWriteHead`): over package `P`'s
            // active set it is `P`'s draft, the owning package's own edit
            // through the console's plain `?mode=draft` save. An ambiguous
            // address has no row to land in, and is refused with the refusal
            // the repository answers it with.
            if (singularType === 'permission') {
                let landsIn: string | null = null;
                if (typeof request.packageId === 'string' && request.packageId !== '') {
                    landsIn = request.packageId;
                } else if (mode === 'draft' && request.packageId == null) {
                    const address = draftAddress ?? await host.packagelessDraftAddress(
                        singularType, request.name, itemDiscriminator(singularType, request.item),
                    );
                    if (address.kind === 'ambiguous') {
                        throw packagelessAddressAmbiguityRefusal('save', request.type, request.name, address.candidates);
                    }
                    landsIn = address.into;
                }
                const nameCollision = await host.permissionSetNameCollisionRefusal(
                    singularType, request.name, landsIn, 'save',
                );
                if (nameCollision) throw nameCollision;
            }
            // [#21639] …and a view container whose save name, or any name its
            // expansion produces, is a name already served from elsewhere —
            // its own expansion, another stored container's expansion in the
            // caller's selection, or a view item a package ships — with the
            // same envelope. One predicate for the family, judged by the
            // readers' own row selection and expansion, and asked of the body
            // as authored, before the stamp below can take a registry entry's
            // `viewKind` onto it. See {@link viewContainerNameCollisionRefusal}.
            {
                const containerCollision = await host.viewContainerNameCollisionRefusal(
                    singularType, request.item, request.name, request.packageId,
                );
                if (containerCollision) throw containerCollision;
            }
            let baseline: unknown;
            if ((PLURAL_TO_SINGULAR[request.type] ?? request.type) === 'view'
                && typeof host.engine.registry?.getItem === 'function') {
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                baseline = host.engine.registry.getItem(request.type, request.name)
                    ?? (alt ? host.engine.registry.getItem(alt, request.name) : undefined);
            }
            request.item = normalizeViewMetadata(request.type, request.item, request.name, baseline);
        }

        // Canonicalize `flow` bodies BEFORE the schema gate, so an author's
        // save heals a pre-protocol row the way it heals every other type
        // (#4542). The read path serves stored flows verbatim (a flow
        // canonicalizes at the engine — see {@link resolveFlowCanonicalizer}),
        // and `FlowNodeSchema.config` is an
        // open record, so without this pass the gate below accepts the legacy
        // dialect back and the row stays `pending` in `os migrate meta
        // --stored` forever. Persists `storable`, never the parsed shape —
        // schema defaults are deliberately excluded (ADR-0087). Copy-on-write:
        // an already-canonical body comes back reference-identical, so
        // `migrateStoredMetadata` and `duplicatePackage` re-entering here pay
        // nothing.
        //
        // [#21982] The two gates below — the schema gate and the runtime
        // authoring gate — JUDGE a flow in its canonical spelling on every path. When no canonicalizer resolved, or it threw,
        // `flowGateVerdictBody` is the raw body with the spec's ADR-0087 D2
        // conversions applied (`applyConversionsToFlow`) — for the VERDICT
        // only: what is stored stays the raw request body, exactly as before.
        // The flow parse judges an undeclared config key on the builtin node
        // types, so a D2 spelling the canonicalizer rewrites (`filters`,
        // script `functionName`, subflow `flow`, …) would otherwise be refused
        // here and accepted by `registerFlow`, which the canonicalizer is: a
        // verdict that depended on whether this host runs an automation
        // service. So the fallback replays the chain the canonicalizer replays
        // FOR THIS SAVE, minus the same default flip
        // ({@link FLOW_FALLBACK_VERDICT_NOT_REPLAYED}). This converted body is
        // never persisted. A key no conversion rewrites is judged exactly as
        // written.
        //
        // [#23775, ADR-0087 addendum 2026-07-31] Which chain that is, is the
        // ruling's predicate ({@link flowSaveReplaysRetired}). A re-save of a
        // stored row replays the FULL chain, retired entries included — the
        // row is data at rest, and a legacy row stays editable. A flow with no
        // stored row at the save's address is authored input: the
        // canonicalizer and this fallback both run WITHOUT the retired entries,
        // so a spelling retired from the authoring funnel (#23487, #23543) is
        // not lifted here either and meets the parse refusal below, with the
        // prescription `os validate` prints, on both hosts alike.
        //
        // [#23903, ruling B′] So does a re-save whose body NEWLY INTRODUCES a
        // retired spelling — a retired entry firing at a site where no stored
        // row carries it (a node added with an old spelling): authored input,
        // judged whole without the retired entries. A re-save whose retired
        // hits the stored row all carries keeps the full chain, as above.
        let flowGateVerdictBody: unknown;
        // [#4580, #23775] The fallback's warning, said once the gate below has
        // accepted the body it falls back to — never for a save it refuses.
        let flowCanonicalizeFallback: string | undefined;
        if (singularType === 'flow' && request.item) {
            const includeRetired = await host.flowSaveReplaysRetired(request, mode);
            // No automation service reachable (control-plane / metadata-only
            // host): the fallback below judges the body and it is saved as
            // written — a host must not start refusing flow writes it accepted
            // yesterday, save the retired spelling on a new flow (#23775) or one
            // a re-save newly introduces (#23903), which an engine host refuses
            // too.
            const canonicalizeFlow = host.resolveFlowCanonicalizer();
            let canonicalized = false;
            if (canonicalizeFlow) {
                let result: StoredFlowCanonicalization | undefined;
                try {
                    result = canonicalizeFlow(request.name, request.item, { includeRetired });
                } catch (e: any) {
                    // `canonicalizeStoredFlow` is STRICTER than the gate below
                    // (strict parse + cycle detection + control-flow region
                    // validation). A work-in-progress draft with a temporary
                    // cycle must stay saveable, so fall back to the raw body
                    // and let today's gate stay the arbiter — in draft AND
                    // publish mode; `registerFlow` refuses to arm a malformed
                    // flow either way.
                    //
                    // Say so (#4580). The fallback is correct but it is the one
                    // posture here with no signal of its own: a save that
                    // skipped canonicalization is otherwise indistinguishable
                    // from one that healed the row, and a body that is BOTH a
                    // legacy dialect and unparseable re-persists verbatim —
                    // the #4542 symptom, silently, against a boot warning that
                    // told the author re-saving would fix it. Every other link
                    // in the chain is loud (ADR-0087 D2): conversions emit
                    // notices, `convertStoredItem` warns on read,
                    // `migrateStoredMetadata` reports `failed`.
                    //
                    // Deduped per flow per process, like {@link
                    // storedConversionWarned} — Studio autosave writes the same
                    // draft repeatedly and this must not become a spam loop.
                    //
                    // [#23775] Said after the schema gate, not here: on a new
                    // flow the canonicalizer's own throw is often the retired
                    // spelling's refusal, which the gate then answers with a
                    // 422, and "was saved" would be false.
                    flowCanonicalizeFallback = e?.message ?? String(e);
                    result = undefined;
                }
                if (result) {
                    request.item = result.storable;
                    canonicalized = true;
                }
            }
            if (!canonicalized) {
                // [#29557] The seam both publish doors judge a stored draft through.
                flowGateVerdictBody = flowVerdictBody(request.item, { includeRetired });
            }
        }

        // Spec-conformance check: if a Zod schema is registered for this
        // overlay type (see OVERLAY_VALIDATION_SCHEMAS), validate the payload
        // before persisting. We surface invalid payloads as `422
        // invalid_metadata` with structured Zod issues so the Studio form can
        // highlight the offending field. What is then STORED depends on the
        // type (ADR-0005 appendix (c), "Addendum — 2026-05-16 (c): spec
        // validation on overlay save"): a `view` stores the parsed value of
        // every key its body carried and nothing else
        // ({@link projectStorableViewBody}, ADR-0087's `storable` rule); every
        // other type keeps its request body, with the grafts below.
        //
        // [#5364] "so the Studio form can highlight the offending field" was
        // the promise; a top-level `z.union` broke it. Mapping only the issues
        // zod raises at the TOP level sent `[{path: '', message: 'Invalid
        // input', code: 'invalid_union'}]` and nothing else — and since
        // `ViewMetadataSchema` IS a top-level union, that was every failed view
        // save. {@link zodIssuesToMetadataIssues} expands the branches that
        // explain the rejection, which is where the #4001 curated prose and the
        // real key names live.
        {
            const schema = resolveOverlaySchema(request.type, request.item);
            if (schema) {
                // [#21982] A flow on the canonicalizer's fallback is judged in
                // its D2-converted spelling (see `flowGateVerdictBody` above);
                // every other body is judged as stored.
                const parsed = schema.safeParse(flowGateVerdictBody ?? request.item);
                if (!parsed.success) {
                    const issues = zodIssuesToMetadataIssues(parsed.error.issues);
                    // [#10524 → commit d806081dd] The findings clause is rendered PER
                    // FACE — see {@link specValidationFindings}. #10524's
                    // headline is applied on the faces that carry the same
                    // findings structurally beside the message (the `/meta`
                    // HTTP write doors, which declare `'meta-envelope'`), and
                    // the full prose is kept everywhere else, because on those
                    // faces this sentence is the SOLE carrier of the author's
                    // prescription — `duplicatePackage`'s `failed[].error`
                    // above all, whose three #8333 GUARD pins hold
                    // "Unrecognized key(s) …" and the `defineView(` spelling to
                    // it. A blanket trim here was tried during #10524 and
                    // reverted for exactly that reason; the face split is what
                    // lets the duplication go without the prescription going
                    // with it. `err.issues` below is unconditional — the split
                    // decides only what the SENTENCE repeats.
                    const err = new Error(
                        `${request.type}/${request.name} failed spec validation: `
                        + specValidationFindings(request.writeFace, issues)
                    );
                    (err as any).code = 'INVALID_METADATA';
                    (err as any).status = 422;
                    (err as any).issues = issues;
                    throw err;
                }
                // [#29673] The registry's own refusal of the BODY, at the
                // producer for the D9.9 refusal's reason: a body
                // `registerObject` refuses was stored, answered `200`, and
                // logged a `console.warn` at the write-through — and a draft of
                // it published as "published" and never reached the data plane.
                // Asked in both modes (#23712: a draft no publish can serve is a
                // refusal now, not later), and AFTER the spec gate, so a body
                // both refuse keeps the gate's structured `issues[]` (#5364).
                // The body is the one this save stores: the read's injected
                // columns already came off it above. See
                // {@link objectRegistrationRefusal}.
                if (objectRegistrationLayer) {
                    const registration = host.objectRegistrationRefusal(request.item, objectRegistrationLayer);
                    if (registration) throw registration;
                }
                if (singularType === 'view') {
                    // [#20051] A saved view is the parsed body: the parsed
                    // value of every key the request carried, undeclared keys
                    // dropped, schema defaults left to the parse. The two
                    // grafts below are special cases of this projection, so a
                    // view does not run them. See {@link projectStorableViewBody}.
                    const storable = projectStorableViewBody(request.item, parsed.data, (body) => {
                        const again = schema.safeParse(body);
                        return again.success ? { ok: true, data: again.data } : { ok: false };
                    });
                    if (!storable.converged) {
                        // Functional, not durability: the fallback stores the
                        // whole parse output, so nothing the author wrote is
                        // lost; only this row's schema defaults are pinned.
                        const key = `${singularType}|${request.name}`;
                        if (!host.storableViewFallbackWarned.has(key)) {
                            host.storableViewFallbackWarned.add(key);
                            console.warn(
                                `[Protocol] view/${request.name}: the stored body is the whole parse output, schema `
                                + `defaults included, because no body of only the keys the request carried re-parses `
                                + `to the same view. Nothing the author wrote is lost; the defaults in this row no `
                                + `longer follow the schema's. Re-save the view after a platform upgrade to re-derive it.`,
                            );
                        }
                    }
                    request.item = storable.body;
                } else {
                    // Every other type keeps its body verbatim, but not its *legacy spellings*: the
                    // schema just folded them to canonical and the result would
                    // otherwise be discarded, so every save minted new alias rows.
                    // Two normalizations are grafted back, each by its own walk —
                    // filter `operator` values ({@link graftNormalizedOperators},
                    // objectui#2945) and the form `groups` → `sections` key move
                    // ({@link graftFoldedFormSections}, #7134). A key move is not
                    // expressible in the scalar walk, which is why there are two.
                    //
                    // The fold runs FIRST so the operator walk meets `sections`
                    // lined up with the parsed tree rather than a `groups` key the
                    // parsed side no longer has. Form sections carry no `operator`
                    // today (`visibleWhen` is a CEL string), so this ordering is
                    // structural hygiene rather than a measured fix — but it is the
                    // ordering that stays correct if one ever does.
                    request.item = graftNormalizedOperators(
                        graftFoldedFormSections(request.item, parsed.data),
                        parsed.data,
                    );
                    // [#26723] …and an action is stored as its parse, so its
                    // `requiresFeature` / `requiresMembershipReach` is lowered
                    // into `visible`. See {@link withParsedStoredActions}.
                    request.item = withParsedStoredActions(singularType, request.item, parsed.data);
                }
                // [#20101] …and a page's declared `type` default, the one
                // default that a reader of the served body selects on. It is
                // stored so that the served document and the stored row are
                // the same bytes, and a GET → PUT round-trip is a no-op. The
                // read seam fills the same default for rows stored before this
                // fix. See {@link withDeclaredPageTypeDefault}.
                request.item = withDeclaredPageTypeDefault(request.type, request.item);
            }
        }

        // [#4580, #23775] The flow canonicalizer's throw-fallback, said now that
        // the gate it fell back to has accepted the body (see the flow branch
        // above for why it is not said where the throw is caught).
        if (flowCanonicalizeFallback !== undefined) {
            const key = `${singularType}|${request.name}`;
            if (!host.flowCanonicalizeFallbackWarned.has(key)) {
                host.flowCanonicalizeFallbackWarned.add(key);
                console.warn(
                    `[Protocol] flow/${request.name} was saved WITHOUT canonicalization: `
                    + `${flowCanonicalizeFallback} The body was persisted as submitted, so a `
                    + `pre-protocol shape in it stays legacy on disk. Run `
                    + `"os migrate meta --stored" to see the row's status.`,
                );
            }
        }

        // [#21658, #21689] A hook that carries no `body` can never run once
        // stored here, whether its `handler` names a function or it has
        // neither field: a stored hook ships with no code package, so its
        // `body` is the only code it can run. Refused in draft and in publish
        // mode, after the schema (so `body` is absent or a declared body) and
        // before the authoring gate and every write. See
        // {@link runtimeHookWithoutBodyRefusal}.
        {
            const hookRefusal = runtimeHookWithoutBodyRefusal(singularType, request.item, request.name);
            if (hookRefusal) throw hookRefusal;
        }

        // One default record page per object per deployment (maintainer ruling
        // A on objectstack#23015): a page saved as the default record page of an
        // object another page already holds — a stored page, or a page a
        // package ships — is refused, naming both, in draft and in publish mode,
        // after the schema (the body is a page) and before the authoring gate
        // and every write. A save under the existing default's own name is an
        // overlay of that page, not a second default. See
        // {@link defaultRecordPageSaveRefusal}.
        {
            const defaultPageRefusal = await host.defaultRecordPageSaveRefusal(singularType, request.item, request.name);
            if (defaultPageRefusal) throw defaultPageRefusal;
        }

        // [ADR-0015 §4.2 · #25211] An `object` bound `external` to a datasource
        // this environment holds as managed, or a `datasource` saved as managed
        // while objects bind it with `external`, is refused, in draft and in
        // publish mode, after the schema (the body is the type it says, and the
        // parse has judged a binding on the primary datasource) and before the
        // authoring gate and every write. See {@link externalBindingSaveRefusal}.
        {
            const bindingRefusal = await host.externalBindingSaveRefusal(singularType, request.item, request.name, request.writeFace);
            if (bindingRefusal) throw bindingRefusal;
        }

        // [#26724] An `object` whose `datasource` names no datasource here is
        // refused, in draft and in publish mode, after the schema and before
        // the authoring gate and every write: stored, it never registers. A
        // draft may name a datasource that is itself still a draft. See
        // {@link unknownDatasourceSaveRefusal}.
        {
            const datasourceRefusal = await host.unknownDatasourceSaveRefusal(
                singularType, request.item, request.name, mode === 'draft' ? 'drafts' : undefined, request.writeFace,
            );
            if (datasourceRefusal) throw datasourceRefusal;
        }

        // [#28990] A `permission` set granting on an object that does not exist
        // here is refused, in draft and in publish mode, after the schema and
        // before the authoring gate and every write: stored, the grant applies
        // to nothing. A draft may grant on an object that is itself still a
        // draft. [#29279] A `migrate-stored` re-save rewrites a row the store
        // already holds and is not judged: a draft-only set has no active row
        // to hold its grants, so judging it refused the pass's own rewrite of
        // a draft whose object draft was gone; the draft is judged at its
        // publish. [#30255] Grants the item copies from a set that already
        // holds them (`inheritedGrantObjects`, the clone door's copy) are not
        // this save's either. See {@link unknownGrantObjectSaveRefusal}.
        if (writeSource !== 'migrate-stored') {
            const grantRefusal = await host.unknownGrantObjectSaveRefusal(
                singularType, request.item, request.name, mode === 'draft' ? 'drafts' : undefined, request.writeFace,
                undefined, request.inheritedGrantObjects,
            );
            if (grantRefusal) throw grantRefusal;
        }

        // [#29898] An `object` (or an `object_extension`) whose field is bound
        // to a picklist no loaded package declares is refused, in draft and in
        // publish mode, after the schema and before the authoring gate and
        // every write: stored, the field is served with no options and every
        // write that sets it is refused. A `migrate-stored` re-save rewrites a
        // row the store already holds and is not judged; a draft-only row is
        // judged at its publish. See {@link unknownPicklistBindingSaveRefusal}.
        if (writeSource !== 'migrate-stored') {
            const picklistRefusal = await host.unknownPicklistBindingSaveRefusal(
                singularType, request.item, request.name, request.writeFace,
            );
            if (picklistRefusal) throw picklistRefusal;
        }

        // [#28952] A keyed `seed` whose `externalId` names no field of its
        // object is refused, in draft and in publish mode, after the schema and
        // before the authoring gate and every write: every load of it would
        // insert each record again. A draft seed whose object is itself still a
        // draft is judged at its publish. A `migrate-stored` re-save rewrites an
        // existing row and is not judged. See {@link seedExternalIdSaveRefusal}.
        if (writeSource !== 'migrate-stored') {
            const seedKeyRefusal = await host.seedExternalIdSaveRefusal(
                singularType, request.item, request.name, mode === 'draft' ? 'drafts' : undefined, request.writeFace,
            );
            if (seedKeyRefusal) throw seedKeyRefusal;
        }

        // [#27762] A `datasource` body may name, in `external.credentialsRef`, only the reference its own stored row
        // holds: refused 400 before the authoring gate and every write. See {@link datasourceCredentialsRefSaveRefusal}.
        {
            const repo = host.getOverlayRepo();
            const credentialsRefRefusal = await datasourceCredentialsRefSaveRefusal({
                headAt: (...a) => repo.headAt(...a), type: singularType, name: request.name, item: request.item,
                mode, packageId: request.packageId, source: request.source,
            });
            if (credentialsRefRefusal) throw credentialsRefRefusal;
        }

        // [ADR-0138 D2b] A flow published with `runAs: 'system'` while an
        // anonymous endpoint of `type: 'flow'` names it is refused, in publish
        // mode only (a draft does not execute; its publish is judged at the
        // promotion), before the authoring gate and every write. A
        // `migrate-stored` re-save rewrites an existing row and is not judged.
        // See {@link anonymousElevatedFlowRefusal}.
        if (mode !== 'draft' && writeSource !== 'migrate-stored') {
            const elevatedRefusal = await host.anonymousElevatedFlowRefusal(singularType, request.item, request.name);
            if (elevatedRefusal) throw elevatedRefusal;
        }

        // The #4463 runtime authoring gate — the shared author-time rule
        // registry, on the write path. `active` saves only (D1): this is the
        // publish verb, and it is the same table `os build` gates on. Placed
        // immediately after the schema check because a rule reads a body the
        // schema already accepted — a Zod failure is the more basic verdict and
        // must be the one the author sees first.
        //
        // [#4717] The advisory half of D3 starts its journey here. `errors` is
        // thrown above as the 422; `advisories` never blocks anything, so it is
        // captured and rides the 2xx this write is about to earn. Held in a
        // local rather than on `this`: the gate is per-write and two concurrent
        // saves must not read each other's findings.
        const gatedItem: unknown = request.item;
        const runtimeAdvisories = await host.assertRuntimeAuthoringRules({
            type: request.type,
            name: request.name,
            state: mode === 'draft' ? 'draft' : 'active',
            // [#21982] The same verdict body as the schema gate above: a flow
            // on the canonicalizer's fallback is judged in its D2-converted
            // spelling (the lint's config judge refuses an undeclared key, so
            // the raw `filters` alias would be refused here and nowhere else).
            // Stored, and handed to the credential walk below, as written.
            body: flowGateVerdictBody ?? gatedItem,
            source: writeSource,
            // [#9612] Which package this write belongs to — the unit the gate
            // now judges it against. Same story as the line above: the request
            // has carried it all along, it just never reached the gate. Null
            // (a bare tenant overlay) narrows nothing.
            packageId: request.packageId ?? null,
            // [#20611] The redaction context. The read path withholds a
            // credential from every served definition (a flow's start-node
            // `config.secret`), so a body saved back after a read arrives
            // without it, and the carry-forward below restores it only AFTER
            // every gate — on purpose, so no gate handles a restored credential.
            // The gate is handed WHERE it will be restored instead, computed
            // from the same stored body the carry-forward reads: a rule then
            // reads a withheld-and-stored credential as present, and one that
            // is absent and not stored as missing. The body judged is unchanged.
            restoredCredentialPaths: () => host.restoredCredentialPathsFor({
                type: singularType,
                name: request.name,
                packageId: request.packageId ?? null,
                item: gatedItem,
            }),
        });

        // [#20312] ADR-0080 §5: `requires` is derived from the source, not
        // authored. With the deployment's manifest in hand, an html page is
        // stored with the `requires` its compiled source yields — on a draft
        // too, because the stamp is a derivation, not a gate (a draft whose
        // source does not compile, or whose hand-written `requires` disagrees,
        // is left as written for its publish to refuse; see
        // `stampHtmlPageRequires`). A host with no manifest stores the body
        // exactly as before.
        request.item = stampHtmlPageRequires(singularType, request.item, host.resolveSduiManifest());

        // Pre-persistence authoring gate (#3050): a domain plugin may veto the
        // body before it persists (throws propagate to the caller with their
        // status/code). Runs for BOTH draft and publish-mode saves, so a later
        // publishMetaItem promotes an already-gated body.
        //
        // [#7674] Keyed on the DECLARED authoring channel, exactly as #6710
        // re-keyed `assertRuntimeAuthoringRules` a few hundred lines up. This
        // line used to read `if (this.environmentId !== undefined)`, and its
        // own comment reaffirmed the reasoning #6710 had already retired:
        // "control-plane bootstrap writes (environmentId undefined) are the
        // package author's own channel". They are not the only such writes.
        // The CLI's lightweight host-config assembler (`serve.ts`'s
        // `config.objects && !hasObjectQL` branch → `new ObjectQLPlugin()`
        // with no options) leaves `environmentId` undefined too, and it serves
        // an END-USER `PUT /api/v1/meta/*` — `isHostConfig` →
        // `shouldBootWithLibrary === false` is the flagship showcase's own boot
        // shape. So plugin-security's ADR-0090 D11 object posture gate — R1
        // `owd_widening_forbidden` and R2 `owd_external_wider` — ran on NO
        // self-hosted deployment at all, while `AUTHORING_RULES` deliberately
        // withheld its own `validateSecurityPosture` from the runtime surface
        // on the stated grounds that this gate already covered it
        // (`packages/lint/src/authoring-rules.ts`, `surfaceReason`). Declared,
        // not enforced, on both tables at once.
        //
        // The direction is #6710's and matters more than the mechanism: the
        // DEFAULT is the gated one, so an assembly variant nobody has thought
        // of yet gets more enforcement, never less. Only a caller that claims
        // to BE the package author is treated as one.
        if (host.authoringChannel !== 'package-author') {
            await host.runAuthoringGate({
                type: request.type,
                name: request.name,
                state: mode === 'draft' ? 'draft' : 'active',
                body: request.item,
            });
        }

        // 1. Update the in-memory registry (runtime cache) ONLY for the
        //    `object` type — schema definitions feed engine.syncSchema and
        //    must be reflected immediately for CRUD to work. For all other
        //    metadata types (view, dashboard, ...) we deliberately do NOT
        //    mutate the artifact-loaded registry — sys_metadata is the
        //    authoritative overlay store and `getMetaItem` consults it
        //    first (ADR-0005). Mutating the registry here would create a
        //    "stale overlay" hazard: `deleteMetaItem` cannot restore the
        //    original artifact value because it was overwritten in-place.
        // 1. (deferred) — Object-type runtime-registry mutation used to happen
        //    here unconditionally. Moved to AFTER successful persistence
        //    (PR-10d.3 rubber-duck #3): a failed put() — DB error, optimistic
        //    conflict, validation — must not leave a stale object schema in
        //    the in-memory registry. See `applyObjectRegistryMutation` below.

        // 2. Persist to sys_metadata as a customization overlay row.
        //    ADR-0005 (revised 2026-05): isolation key is `organization_id`
        //    (each env = its own DB, so environment_id is redundant). Org-scoped
        //    rows belong to the active organization in the request; env-wide
        //    overlays are written with organization_id = NULL.
        await host.ensureOverlayIndex();

        // ADR-0008 — persistence has exactly ONE route: the repository write
        // path. Every mutation appends to the change log and emits a watch
        // event with a monotonic `seq` (which Studio / browser clients consume
        // for HMR).
        //
        // #5264 — the second route is gone. A legacy raw-engine branch used to
        // sit after this block (`engine.insert`/`engine.update` straight into
        // `sys_metadata`: no history row, no watch event, no `seq`) and ran
        // whenever `isOverlayAllowed(type) || isRuntimeCreateAllowed(type)`
        // was false. #5086 (PR #5263) made that condition unreachable HERE:
        // the code-only refusal earlier in this method throws on exactly that
        // predicate, on EVERY kernel (`environmentId` no longer keys it), read
        // off the same canonical type key — `canonicalizeMetaRequestType` folds
        // plural→singular at the top, and both flag readers fold again
        // internally, so the two evaluations cannot disagree. A type that
        // reaches this line always has a repository write path.
        // `OS_METADATA_WRITABLE` is not a hole either: unlocking a type there
        // makes `isOverlayAllowed` true, which routes it right back here — one
        // door, not a bypass. The delete side's symmetric-looking branch is
        // NOT dead and was deliberately left alone; see {@link deleteMetaItem}.
        //
        // PR-10d.6 removed the `useRepositoryWritePath` flag. The repository
        // path is no longer opt-out-able for any type that gets this far.
        //
        // Callers that omit `parentVersion` get backward-compatible
        // "last-write-wins" semantics: we read the current row's checksum
        // and use it as the parent, so the conflict check tautologically
        // passes (best-effort — racy under concurrent writes; explicit
        // optimistic-lock is opt-in via `parentVersion`).
        // Callers that pass an explicit `parentVersion` (e.g. Studio after
        // reading an item) get true optimistic-lock conflict detection
        // surfaced as a 409.
        // [ADR-0146 D2] The override write gate's undeclared-same-name
        // refusal (see the gate above): the last refusal before the store.
        //
        // A save naming no package was judged above as package-less (`not
        // concerned` for an undeclared item), but its address may have given
        // it a package since: the row it lands in, as the package-less address
        // resolved it (publish) or the draft address names it (draft). Judged
        // again here for THAT package, so a package-less save cannot write a
        // dependent's undeclared same-named row the same save naming the
        // dependent is refused. A declaration never reaches this re-judgement:
        // a package-less declaration was refused above.
        let lateOverrideVerdict = overrideVerdict;
        if (
            namedNoPackage
            && overrideVerdict.verdict === 'not_concerned'
            && request.source === undefined
            && request.writeFace !== 'package-duplicate'
        ) {
            const inheritedPackage = mode === 'draft'
                ? draftAddress && draftAddress.kind !== 'ambiguous' ? draftAddress.into : null
                : request.packageId ?? null;
            if (typeof inheritedPackage === 'string' && inheritedPackage.length > 0) {
                lateOverrideVerdict = host.overrideWriteVerdict({ ...request, packageId: inheritedPackage });
            }
        }
        if (lateOverrideVerdict.verdict === 'refuse') throw overrideWriteRefusalError(lateOverrideVerdict);
        const singularTypeForRepo = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        const artifactBacked = host.isArtifactBacked(singularTypeForRepo, request.name);
        // [ADR-0146 D2] An admitted declared override writes the pair's own
        // row; it edits no managed item, so the store judges a runtime write.
        const intent: 'override-artifact' | 'runtime-only' = artifactBacked && !declaredOverride
            ? 'override-artifact'
            : 'runtime-only';
        // D1 (ADR-0070) — a brand-new, DB-only ("runtime-only") metadata
        // item MUST resolve to a WRITABLE base. Binding it to a read-only
        // code/installed package makes it read back as "code-provided" and
        // lock read-only after publish (the #2252 bug). We used to silently
        // coerce such a binding to `null`, but that scattered orphans into a
        // package-less bucket with no container to delete; ADR-0070 replaces
        // the coercion with an actionable rejection so the authoring surface
        // (Studio / AI) redirects the user to pick or create a base first.
        //
        // Left untouched (the binding survives):
        //   • `override-artifact` writes — an org overlay OF a packaged item
        //     must keep pointing at the package it customizes (ADR-0005).
        //     [#28905, ADR-0146 D1] Of the five overlay types, an authoring
        //     write naming the READ-ONLY base that ships the item no longer
        //     reaches here: {@link namedBaseOverlayWriteRefusal} refused it
        //     above, naming the pair. What still arrives is a writable
        //     package's overlay, a server-stated rewrite, a body carrying
        //     `overrides` (the D2 gate's) and a close whose fix could not be
        //     taken.
        //   • a project-scoped base, or a bare ADR-0048 authoring-workspace
        //     id — both are writable; `isWritablePackage` returns true.
        // A `null` packageId is still accepted here (legacy org-overlay
        // destination); ADR-0070 D5 retires it once the surfaces always
        // resolve a base and the orphan migration has run.
        //
        // [#8361] THE SENTENCE IS THE REPOSITORY'S, the predicate is still
        // D1's. `SysMetadataRepository.readOnlyBaseCreateError` is CALLED, not
        // copied — the create-side mirror of what #8184 did four hundred lines
        // above on the override side.
        //
        // ⛔ NOTHING ABOUT THE ACCEPTANCE SET MOVES. The `if` is byte-for-byte
        // the predicate D1 has always used; only the error object it throws
        // changes. Every create D1 refused it still refuses, every create it
        // admitted it still admits — this card is about what the operator is
        // TOLD, not about what is refused.
        //
        // WHY DELEGATE RATHER THAN TEACH D1 ITS OWN `hatchOpen` CLAUSE — the
        // fork #8361 was filed on, and both of the reasons the one-emitter
        // default might NOT have applied were measured here and did not hold:
        //   • "D1 fires before the repository exists in the call." True of the
        //     INSTANCE (`getOverlayRepo` is below), irrelevant to the emitter:
        //     it is `static`, the class is imported at the top of this file,
        //     and the override-side call at the top of this same method has
        //     been calling a static sibling since #8184.
        //   • "D1 carries its own `docs` pointer." Measured identical — both
        //     sites set `docs/adr/0070-package-first-authoring.md`, because D1
        //     and this emitter implement the SAME decision. (That is what
        //     separates the create side from the override side, where the
        //     repository points at ADR-0010 and the fork was real.)
        // The one true difference was that D1's sentence names the ITEM and
        // the emitter's named only the type; the emitter took an optional
        // `name` rather than the sentence being forked.
        //
        // `hatchOpen` is COMPUTED here, and must be — unlike the override site,
        // which passes a literal `false` because reaching it proves the hatch
        // is shut. Both directions are live at D1: a type with
        // `allowRuntimeCreate` (e.g. `permission`) arrives with the hatch shut,
        // and a type with neither channel (e.g. `job`) arrives ONLY because
        // `OS_METADATA_WRITABLE` opened it — `isOverlayAllowed` folds the hatch
        // in, so an open hatch carries the write past the code-only refusal
        // straight to this gate. Read through this class's OWN memoised reader,
        // the one that admission decision used, so `hatchOpen` cannot disagree
        // with the limb that let the write through.
        if (
            intent === 'runtime-only' &&
            request.packageId != null &&
            !host.isWritablePackage(request.packageId)
        ) {
            const envWritable = host.envWritableTypes();
            const hatchOpen = envWritable.has(singularTypeForRepo) || envWritable.has(request.type);
            throw SysMetadataRepository.readOnlyBaseCreateError(
                singularTypeForRepo, request.packageId, hatchOpen, request.name,
            );
        }
        // [ADR-0131 D6] Environment-wide, always: an organization-scoped
        // request was refused at the top of this method.
        const repo = host.getOverlayRepo();
        const ref = {
            type: singularTypeForRepo,
            name: request.name,
            org: 'env',
        } as Parameters<typeof repo.put>[0];
        let parentVersion: string | null;
        // [#23495] The package a draft save naming no package writes into, as
        // the repository resolves it (#11087: the package of the item's active
        // rows), read off the same head read the parent comes from; the
        // receipt names it, as the direct save's names its package (#23165).
        let inheritedDraftPackageId: string | null = null;
        if (request.storedParentVersion !== undefined) {
            // [#21207] An in-process caller that read the stored hash itself.
            parentVersion = request.storedParentVersion;
        } else {
            // Parent is scoped to the lifecycle we're about to write:
            // a draft's parent is the current draft hash (or null
            // for the first draft); a publish's parent is the
            // current published hash. ADR-0048 — scope to the same
            // package the upsert targets so a collision's other-package
            // row is never read as this item's parent.
            // [#22114] The head the item read's `version` is the keyed form of
            // — one read for both halves (`repo.headAt`, the read
            // {@link storedHeadAt} makes for the item read). [#22128] The
            // row the repository's `put` resolves for this address and locks
            // against, the inherited draft binding included. [#23495] Read
            // whole here, since its `packageId` is the receipt's too.
            const writeHead = await repo.headAt(ref, {
                state: mode === 'draft' ? 'draft' : 'active',
                packageId: request.packageId ?? null,
                // [#22877] The write's bundle member, from the body it writes —
                // the member the repository's `put` keys this save by.
                member: itemDiscriminator(singularTypeForRepo, request.item),
            });
            const currentStored = writeHead.head?.hash ?? null;
            if (mode === 'draft' && request.packageId == null) inheritedDraftPackageId = writeHead.packageId;
            if (request.parentVersion === undefined) {
                parentVersion = currentStored;
            } else {
                // [#21207] A caller's version token names the stored head only
                // in keyed form; the repository's own lock then runs on the
                // stored value. A token naming no current head — the raw
                // stored hash included — is answered here, in this door's own
                // conflict envelope and with its own audit row.
                try {
                    parentVersion = await host.storedParentForToken(ref, request.parentVersion, currentStored);
                } catch (err: unknown) {
                    if (err instanceof ConflictError) throw await host.saveConflict(err, request, writeSource);
                    throw err;
                }
            }
        }
        // [#8154] THE WRITE-PATH INVERSE of the read exits' credential
        // redaction — the half without which this card's fix is a DATA-LOSS
        // bug rather than a security fix.
        //
        // Measured on `origin/main` before this change: `saveMetaItem` ACCEPTS
        // a redacted datasource body and persists the credential away. So the
        // read scrub alone converts today's loud `422` (the stored cleartext
        // `config.password` is refused by #8078's write gate) into SILENT
        // credential DELETION on the ordinary `/meta` GET → edit → PUT round
        // trip. `config.url` is what makes this unavoidable rather than a
        // masking choice: a URL-embedded password is schema-ACCEPTED, so
        // dropping it round-trips to deletion and masking it round-trips to
        // storing the mask as the literal password.
        //
        // The generic form of the carry-forward PR #8126 added to
        // `DatasourceAdminService.updateDatasource`, and placed for the same
        // reason that one is: AFTER every gate, immediately before the put.
        // The gates judge what the AUTHOR wrote, and #8078's refusal of an
        // inline credential is aimed at exactly that; this restores material
        // the author never saw, was never offered the chance to write, and is
        // not asking to change. Running the schema gate over it would refuse a
        // legacy row for the contents of its own stored config — i.e. keep
        // today's 422 — and make an ordinary label edit unreachable on exactly
        // the rows that need one.
        //
        // It also RESTORES the #4326 byte-identical round-trip invariant that
        // read-redaction alone would have broken: an untouched GET → PUT of a
        // legacy datasource now persists a body identical to the one at rest.
        //
        // ⛔ Preserves cleartext already at rest; creates none. Getting stored
        // cleartext OUT of the store is #8081 item 3's migration, deliberately
        // not attempted on a write door the author drove.
        //
        // [#20611] The runtime authoring gate above was told WHERE this graft
        // lands (`restoredCredentialPathsFor`, the same plan over the same
        // stored body), never what it restores — so a rule reads a withheld
        // credential as present without any gate handling it.
        //
        // [#28640 ②B] …except the positions the type's redactor marks withheld
        // AND not carried forward (a connector's undeclared `auth` keys, which
        // no door accepts and nothing reads): those are never re-grafted, so
        // this save drops them from the row at rest, and the answer names each
        // one on `advisories` (`droppedWithheldKeyNotices`) — loud, never silent.
        // [#29673] The author's own slots the `/meta` read translated (a field's
        // label through the catalog, the object's own label), put back to the
        // stored row's source text. After every refusal, so a refused save
        // costs no read; before the carry-forward and the put, so what is
        // stored is the source. See {@link restoreTranslatedObjectEchoes}.
        const echoes = await host.restoreTranslatedObjectEchoes(request, repo, ref, mode);
        request.item = echoes.item;
        const carried = await host.carryForwardRedactedCredentials({
            type: singularTypeForRepo,
            repo,
            ref,
            state: mode === 'draft' ? 'draft' : 'active',
            packageId: request.packageId ?? null,
            item: request.item,
            member: itemDiscriminator(singularTypeForRepo, request.item),
        });
        request.item = carried.item;
        const saveNotices = [
            ...runtimeAdvisories,
            ...droppedWithheldKeyNotices({ type: singularTypeForRepo, name: request.name, dropped: carried.dropped }),
            // [#29673] Each author slot this save put back to its source text.
            ...translatedEchoNotices(request.name, echoes.restored),
        ];
        // [#20790] …and then OUT of the body: a type with a write-only
        // credential channel (`flow`, registered by the automation plugin)
        // stores every explicit credential there and persists the body without
        // it — the bytes a read serves. Last, after the carry-forward, so a
        // credential the stored row still held (one written before the channel
        // existed) moves with this save instead of being dropped. A refusal
        // (no crypto provider) throws before the put: nothing is written.
        // ⚠️ The channel write precedes the put, so a put that then fails (a
        // version conflict) leaves the new credential in the channel.
        {
            const channel = host.credentialChannelFor(singularTypeForRepo);
            if (channel) {
                request.item = await channel.store({
                    name: request.name,
                    state: mode === 'draft' ? 'draft' : 'active',
                    body: request.item,
                });
            }
        }
        try {
            const result = await repo.put(ref, request.item, {
                parentVersion,
                // #4556 — `actor` lands in `sys_metadata_history.recorded_by`,
                // a lookup('sys_user'). No caller actor → NULL, never the
                // sentinel string 'system' (which resolves to no user row).
                actor: request.actor ?? null,
                source: writeSource,
                intent,
                state: mode === 'draft' ? 'draft' : 'active',
                ...(request.packageId !== undefined ? { packageId: request.packageId } : {}),
                // [#24395] An authoring draft save records which surface
                // changed which key path (`api` when it names none). A
                // server-stated rewrite — `migrate-stored`, the only caller
                // that states a `source` — is not authoring and records none.
                ...(mode === 'draft' && request.source === undefined
                    ? {
                        draftChangesBy: request.surface ?? 'api',
                        // [#27176] The client the MCP door verified, beside `mcp`.
                        ...(request.client !== undefined ? { draftChangesClient: authoringClientOf(request.client) } : {}),
                    }
                    : {}),
            });
            // Persistence succeeded — NOW it's safe to mutate the
            // in-memory registry. If put() had thrown, the registry
            // would still reflect the prior state. Drafts are NOT
            // live: don't propagate them into the runtime registry
            // (would defeat the staging buffer).
            // #4521 — write through for EVERY overlay type, not just
            // `object`: the runtime dispatch path reads this registry,
            // so an item that is already listable must be dispatchable
            // in the same breath. See {@link applyRegistryWriteThrough}.
            if (mode === 'publish') {
                await host.applyRegistryWriteThrough({
                    type: singularTypeForRepo,
                    name: request.name,
                    item: request.item,
                    packageId: request.packageId ?? null,
                    // [#6602] The SAME scope the row was just written with.
                    organizationId: null,
                });
                // [#30635] A refused storage sync is told to the caller too:
                // one `warning` on this answer's `advisories`, after the
                // gate's findings and the save's own notices. The save is not
                // failed (the row is written, registered and served).
                const storageRefused = await host.ensureObjectStorage(request.type, request.name);
                if (storageRefused) saveNotices.push(storageRefused);
            }
            // ADR-0010 — success audit (best-effort).
            await host.recordMetadataAudit({
                type: request.type,
                name: request.name,
                organizationId: null,
                operation: 'save',
                outcome: 'allowed',
                code: 'ok',
                ...(request.actor ? { actor: request.actor } : {}),
                source: writeSource,
                note: mode === 'draft' ? 'draft' : 'active',
            });
            // [ADR-0094] Awaited projection BEFORE the fire-and-forget
            // listeners: a derived read-model (e.g. the `datasource`
            // projector's) is already consistent when this save returns.
            const projectionApplied = await host.runMutationProjector({
                type: singularTypeForRepo,
                name: request.name,
                state: mode === 'draft' ? 'draft' : 'active',
                organizationId: null,
                body: request.item,
            });
            host.emitMetadataMutation({
                type: singularTypeForRepo,
                name: request.name,
                state: mode === 'draft' ? 'draft' : 'active',
                organizationId: null,
                // [#22877] The saved body's member — the row this save wrote.
                ...mutationEventMemberOfBody(singularTypeForRepo, request.item),
            });
            const receiptPackageId = typeof request.packageId === 'string' && request.packageId !== ''
                ? request.packageId
                : inheritedDraftPackageId;
            const receiptPackage = receiptPackageId ? `, package=${receiptPackageId}` : '';
            return {
                success: true,
                // [#21207] The version token: the keyed form of the stored
                // content hash, never the stored value (see `receiptVersion`).
                version: await host.receiptVersion(result.version),
                seq: result.seq,
                ...(projectionApplied ? { projectionApplied } : {}),
                // [#4717] #4463 D3's advisory half, finally on the response.
                //
                // CONDITIONAL on purpose, and the condition is the contract:
                // the key is omitted — never `[]` — when the gate had nothing
                // to say, so a clean save's response bytes are exactly what
                // they were before this field existed and no existing caller
                // sees a new key. `SaveMetaItemResponseSchema.advisories` is
                // declared optional for that reason, and the conformance suite
                // pins BOTH directions (present with findings, absent without),
                // because an optional key is precisely what a conformance gate
                // built on "nothing was stripped" cannot notice on its own.
                //
                // Save door only. The gate also runs on the draft→active
                // promotion (#4463 D1, so `?mode=draft` + publish is not a
                // bypass) and that door does NOT carry this field yet — its own
                // response contract only just landed as #7294. The asymmetry is
                // deliberate and stated in the changeset.
                //
                // [#28640 ②B] The save's own notices ride the same key: a stored
                // position the carry-forward dropped is named here, after the
                // gate's findings, and the key is still omitted when both are empty.
                ...(saveNotices.length > 0 ? { advisories: saveNotices } : {}),
                // #5745 — the literal union, not `string`. An object-literal
                // property widens a two-literal ternary to `string`, which made
                // this method fail to satisfy `MetadataProtocol.saveMetaItem`
                // once the spec declared `state` as the closed set it has always
                // emitted. Type-only: the value is unchanged.
                state: (mode === 'draft' ? 'draft' : 'active') as 'draft' | 'active',
                // #5265 — the receipt says only what this write path already
                // KNOWS. `artifactBacked` (computed above, and the same fact
                // `intent` is derived from) is exactly the difference between
                // the two things a save can be:
                //
                //   • override-artifact — a code-shipped artifact exists under
                //     this (type, name), so the row we just wrote customizes
                //     it. "customization overlay" is literally true; the
                //     sentence is unchanged, verbatim, on purpose.
                //   • runtime-only — nothing is being overlaid. The row IS the
                //     item. Seven registry types declare `supportsOverlay:
                //     false` yet are writable at runtime by design (`object`,
                //     `field`, `hook`, `seed`, `mapping`, `flow`, `action`),
                //     and every one of them used to be told it had "saved a
                //     customization overlay" of nothing.
                //
                // Deliberately NOT split further into created-vs-updated. The
                // available fact is `parentVersion === null`, and that is
                // scoped to (state, packageId): the first DRAFT of an item
                // that already has a live active row reads as "no parent", so
                // a `Created …` receipt derived from it would swap one false
                // claim for another. Distinguishing it honestly needs a read
                // this path does not already make, and a receipt is not worth
                // a query — so the verb stays the neutral, true "Saved".
                //
                // [#23165] …and it names the package whose row this save wrote,
                // when the save's address names one: the package the caller
                // named, or the one a direct save naming none resolved to
                // ({@link packagelessAddress}), or [#23495] the one a draft
                // save naming none inherits from the item's active rows
                // (#11087). A save into the package-unbound row reads exactly
                // as it did.
                message: artifactBacked
                    ? `Saved customization overlay (env-wide${receiptPackage}, state=${mode === 'draft' ? 'draft' : 'active'}) — type=${request.type}, name=${request.name} [seq=${result.seq}]`
                    : `Saved ${singularTypeForRepo} '${request.name}' (env-wide${receiptPackage}, state=${mode === 'draft' ? 'draft' : 'active'}) [seq=${result.seq}]`,
            };
        } catch (err: any) {
            if (err instanceof ConflictError) throw await host.saveConflict(err, request, writeSource);
            throw err;
        }
    }

    /** The body of `ObjectStackProtocolImplementation#migrateStoredMetadata`; the method's docblock there is its contract. */
    static async migrateStoredMetadata(host: Pick<ProtocolHost, 'convertStoredItemDetailed' | 'engine' | 'isOverlayAllowed' | 'isRuntimeCreateAllowed' | 'registeredTranslationBundle' | 'resolveFlowCanonicalizer' | 'saveMetaItem' | 'storedRowKnownDatasources'>, request: {
            /** Write. Omitted / false = preview: reports what it would do, writes nothing. */
            apply?: boolean;
            /** Restrict to these metadata types (singular or plural spelling). */
            types?: string[];
            /**
             * The id of the user running the pass — omit it when no user is
             * (a CLI run against the database, an `isSystem` caller). It becomes
             * each rewrite's `PutOptions.actor`, so it lands in
             * `sys_metadata_history.recorded_by` and the row's `updated_by`, both
             * `lookup('sys_user')`: omitted, they record `null`, #4556's
             * "system-initiated". ⛔ Never a label naming the door or the pass —
             * that is a reference to no user, and `source: 'migrate-stored'`
             * already says where the write came from (#23068).
             */
            actor?: string;
            /**
             * Canonicalize a stored `flow` body (#4454). **Optional override** —
             * when omitted, the automation engine is resolved from the live
             * services registry (#4498, {@link resolveFlowCanonicalizer}).
             *
             * `AutomationEngine.canonicalizeStoredFlow` is the implementation.
             * A flow canonicalizes at the engine, whose registration checks need
             * the live node registry. A caller running next to a live engine (an admin route, a
             * server task) needs to pass nothing; the CLI passes its own because
             * it boots an inert engine specifically to hold one, and an explicit
             * hook is also what makes the flow branch testable without an engine.
             *
             * When neither is available — a control-plane or metadata-only host —
             * flow rows are reported `skipped` with that reason rather than
             * quietly counted done.
             *
             * Must return the **storable** shape — conversions and the schema's
             * `condition` envelopes, without schema defaults. Throwing is a valid
             * answer for a row that cannot canonicalize; the row is reported
             * `failed` with the message.
             */
            canonicalizeFlow?: (name: string, body: unknown) => StoredFlowCanonicalization;
        } = {}): Promise<StoredMigrationReport> {
        const canonicalizeFlow = request.canonicalizeFlow ?? host.resolveFlowCanonicalizer();
        const apply = request.apply === true;
        // [#8957] Folded with the URL/registry map, exactly like the per-row
        // fold below — and the two MUST move together. An operator who reaches
        // for `--type fields` because that is the spelling the publish refusal
        // just quoted at them, and one who reaches for `--type field`, are
        // asking about the same rows. Folding only the row would have moved the
        // residue out of reach of the very spelling the operator was handed.
        const typeFilter = request.types && request.types.length > 0
            ? new Set(request.types.map((t) => canonicalMetaType(t)))
            : null;

        const report: StoredMigrationReport = {
            apply,
            protocol: PROTOCOL_VERSION,
            scanned: 0,
            canonical: 0,
            pending: 0,
            rewritten: 0,
            skipped: 0,
            failed: 0,
            rows: [],
            decisionModeReview: [],
        };

        // Two scoped queries rather than one unfiltered scan: `state` is an
        // equality column and these are the only two states that are SERVED
        // metadata. Archived bodies are never even read.
        const rows: any[] = [];
        for (const state of ['active', 'draft'] as const) {
            // [#21908, ADR-0096 D5] The explicit system opt-in: the migration
            // door already authorized an operator to scan the whole store.
            rows.push(...await host.engine.find('sys_metadata', { where: { state }, context: { isSystem: true } }));
        }
        // [ADR-0131 D6/D7] The family declares no organization column, so the
        // rows above never carry one. On a database the organization-ownership
        // ceremony has not migrated, the column is still on disk and a row with
        // a value in it is an organization's: told apart here, off the physical
        // column, so the arm below still skips it. `os serve` refuses such a
        // database; `os migrate meta --stored` does not, which is why this pass
        // reads the column itself. A read that cannot answer throws.
        const legacyOrganizations = await readLegacyOrganizationRows(
            (host.engine as { getDriverForObject?: (objectName: string) => unknown }).getDriverForObject?.('sys_metadata'),
        );

        for (const row of rows) {
            const rawType = String(row.type ?? '');
            // [#8957] The URL/registry map, not the manifest-collection map.
            //
            // `PLURAL_TO_SINGULAR` omits the types that are not stack
            // collections, so for a row stored under one of their plural
            // spellings the fold was a NO-OP: `singular` stayed `'fields'`,
            // `convertStoredItemDetailed('fields', …)` found no conversions
            // registered under that name, `changed` was false, and the row was
            // recorded `canonical` — "nothing to do" about a row this pass had
            // never actually looked at. {@link canonicalMetaType} reads
            // `META_URL_TO_SINGULAR`, which embeds every manifest spelling
            // verbatim under a module-load agreement assertion, so this swap
            // cannot change the answer for any spelling the old fold resolved:
            // measured on this tree, the set of spellings where the two folds
            // disagree is empty, and the set the new fold NEWLY resolves is
            // exactly {@link isNonCanonicalStoredType}'s six-member class,
            // which the guard below reports instead of converting.
            const singular = canonicalMetaType(rawType);
            if (typeFilter && !typeFilter.has(singular)) continue;
            report.scanned++;

            const state: 'active' | 'draft' = row.state === 'draft' ? 'draft' : 'active';
            const organizationId: string | null = legacyOrganizations.get(String(row.id ?? '')) ?? null;
            const packageId: string | null = row.package_id ?? null;
            const base = {
                id: String(row.id ?? ''),
                type: singular,
                name: String(row.name ?? ''),
                organizationId,
                packageId,
                state,
                notices: [] as StoredMigrationNotice[],
                todos: [] as StoredMigrationTodo[],
            };
            // An already-canonical row is counted, never itemised: on a healthy
            // deployment that is every row, and a report listing all of them
            // would bury the handful that actually need something.
            const record = (entry: StoredMigrationRow): void => {
                if (entry.outcome === 'canonical') {
                    report.canonical++;
                    return;
                }
                report[entry.outcome]++;
                report.rows.push(entry);
            };

            // [#8957] A row whose STORED `type` is non-canonical is reported,
            // not converted — and reported BEFORE its body is read, because the
            // verdict is about the row's identity and is decided without it.
            //
            // ⛔ The `continue` is load-bearing, not tidiness. With the
            // canonical fold above in place, falling through would hand
            // `convertStoredItemDetailed` the CANONICAL type for a row stored
            // under a different one, and an `apply` run would then re-save it
            // through `saveMetaItem({ type: singular })` — minting or
            // overwriting the canonical row from a body that lives under
            // another key. That is the identity move (#8908's option (b)):
            // a new `(org, type, name, package_id)` key, history and audit
            // continuity to decide, and a collision question when the canonical
            // row already exists. It is explicitly NOT ruled, and this pass
            // must not reach it by accident on the way to reporting honestly.
            //
            // `skipped` (not `failed`) because nothing was refused and nothing
            // is broken about this pass; the row is outside its reach, the same
            // shape as the two carve-outs below it. It therefore does not flip
            // {@link storedMigrationClean} — see that function's doc for why a
            // pass that CANNOT fix this must not fail forever over it.
            if (isNonCanonicalStoredType(rawType)) {
                record({
                    ...base,
                    outcome: 'skipped',
                    reason: `the row is stored under the non-canonical metadata type '${rawType}' `
                        + `('${rawType}/${base.name}'), and its canonical type is '${singular}'. This pass `
                        + `canonicalizes BODIES; rewriting a stored type spelling is an identity move `
                        + `(a new (org, type, name, package_id) key), not an edit, so it is out of its `
                        + `reach. Nothing on '${singular}' can see this row — no registry read and no `
                        + `compliance query — and the batch publish refuses it for that reason `
                        + `(STORED_TYPE_NOT_CANONICAL). Re-author the item under '${singular}' `
                        + `(PUT /meta/${singular}/${base.name}) and drop the '${rawType}' row.`,
                });
                continue;
            }

            // [ADR-0131 D6] An organization-scoped row is reported, never
            // re-saved: the protocol refuses every organization-scoped write,
            // and re-saving the body environment-wide would move it — the
            // promotion ceremony's job (ADR-0131 C7), not this pass's. `skipped`
            // for the same reason as the guard above: nothing is broken about
            // this pass, the row is outside its reach.
            if (organizationId !== null) {
                record({
                    ...base,
                    outcome: 'skipped',
                    reason: `the row is stored organization-scoped (organization '${organizationId}'), and `
                        + `environment metadata no longer has a per-organization layer (ADR-0131 D6), so this `
                        + `pass does not re-save it. The promotion ceremony (ADR-0131 C7) carries it to the `
                        + `environment layer; until then it stays in sys_metadata as stored.`,
                });
                continue;
            }

            let body: unknown;
            try {
                body = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            } catch (e: any) {
                record({
                    ...base,
                    outcome: 'failed',
                    reason: `the stored body is not valid JSON (${e?.message ?? String(e)})`,
                });
                continue;
            }

            // [#15429, ruling C] The decision review list — REPORT ONLY. A stored
            // decision with no `conditions` list, no `mode` and two or more
            // conditioned out-edges took every true branch before protocol 18
            // and takes the first one now; by ruling the row keeps that new
            // meaning (no pass rewrites it — nothing can say the row predates
            // the flip), and this names each such node so an operator can find
            // the one that MEANT every branch. Read off the stored body BEFORE
            // the canonicalizer and with no engine, so the list is the same
            // whether the row below converts, is skipped for want of an
            // engine, or fails; it touches no count, no outcome and no write.
            if (singular === 'flow') {
                for (const node of collectDecisionModeReview(body)) {
                    report.decisionModeReview.push({
                        id: base.id,
                        name: base.name,
                        organizationId,
                        packageId,
                        state,
                        ...node,
                    });
                }
            }

            // Flow rows need the automation engine's canonicalizer — its
            // registration preview judges plugin nodes against the live
            // registry — supplied by the caller (#4454) or resolved from the
            // services registry (#4498), and reported `skipped` when neither
            // can reach one.
            let flowResult: StoredFlowCanonicalization | undefined;
            if (singular === 'flow') {
                if (!canonicalizeFlow) {
                    record({
                        ...base,
                        outcome: 'skipped',
                        reason: 'flows canonicalize at AutomationEngine.registerFlow — its registration '
                            + 'checks need the live node registry, and no automation service '
                            + 'is reachable from this caller',
                    });
                    continue;
                }
                try {
                    flowResult = canonicalizeFlow(base.name, body);
                } catch (e: any) {
                    // `FlowSchema` is strict (#4001) and the region validator
                    // hard-fails, so this is a row that cannot register at all —
                    // already broken at runtime. Report it; never persist a guess.
                    record({
                        ...base,
                        outcome: 'failed',
                        reason: `the flow does not canonicalize: ${e?.message ?? String(e)}`,
                    });
                    continue;
                }
            }

            const overlayAllowed = host.isOverlayAllowed(singular);
            const runtimeCreateAllowed = host.isRuntimeCreateAllowed(singular);
            if (!overlayAllowed && !runtimeCreateAllowed) {
                record({
                    ...base,
                    outcome: 'skipped',
                    reason: `type '${singular}' has no repository write path (allowEnvironmentOverlay and `
                        + 'allowRuntimeCreate are both false), so a rewrite would record no history',
                });
                continue;
            }

            // A flow's canonical body was already computed above (it needs the
            // engine); everything else converts here.
            //
            // The change signal differs by type, and the difference is real.
            // For a non-flow item every rewrite comes from a conversion, and a
            // conversion always emits a notice (ADR-0087 D2 "loud"), so notices
            // are exact. A flow additionally gains the `{dialect, source}`
            // envelope the schema derives for edge conditions — that is a
            // schema transform, not a conversion, so it emits NO notice while
            // still changing the body. Both passes are copy-on-write, so
            // identity is the precise test there: `storable === body` exactly
            // when nothing was rewritten at all.
            //
            // [#23269] A flow's TODOs come back from the canonicalizer, which
            // runs the same chain with the same sink: until they did, a stored
            // flow carrying a `{…}` token at a value slot — a CRUD filter
            // operand among them — parsed, rewrote nothing and was counted
            // `canonical`, while `registerFlow` refused it at boot.
            //
            // [#25279] A stored object's `external` binding is judged against the
            // datasource the save door reads for it, so the listing names the
            // row exactly when that door refuses its next save.
            const { item, notices, todos } = flowResult
                ? { item: flowResult.storable, notices: flowResult.notices, todos: flowResult.todos ?? [] }
                : host.convertStoredItemDetailed(
                    singular, body, undefined, await host.storedRowKnownDatasources(singular, body),
                );
            // [#29673] …and, for an `object` row, the save door's translated-echo
            // restoration ({@link restoreTranslatedObjectEchoes}), asked of the
            // row against itself and the platform's injected columns: a row a
            // zh-CN Studio session stored before that door existed carries an
            // injected column's TRANSLATED label as an author's field (a `queue`
            // the registry refuses, so the object never registers and a restart
            // does not recover it). Each slot is a notice, and the re-save below
            // goes through the door that puts it back and strips the column.
            const echoNotices: StoredMigrationNotice[] = singular === 'object' && !flowResult
                ? restoreTranslatedEchoes(item, { source: item, bundle: host.registeredTranslationBundle() })
                    .restored.map((slot) => ({
                        conversionId: TRANSLATED_ECHO_NOTICE_ID,
                        surface: 'object.field.label',
                        from: slot.from,
                        to: slot.to ?? '',
                        path: slot.path,
                        message: 'the stored text is the /meta read\'s translation of its source, stored as the '
                            + 'document by an edit that echoed a translated read; the re-save stores the source '
                            + 'text, and an injected column that is the platform\'s own again comes off the row',
                    }))
                : [];
            const changed = flowResult ? item !== body : notices.length > 0 || echoNotices.length > 0;
            // [#17321] A site the chain left as stored — no lossless rewrite
            // exists for it (ADR-0087 D3: a structured TODO, never silence) —
            // rides on the row whatever its outcome, and is what keeps a row
            // with nothing to persist from being counted `canonical` below.
            const flattenedTodos: StoredMigrationTodo[] = todos.map((t) => ({
                conversionId: t.conversionId,
                surface: t.surface,
                from: t.from,
                path: t.path,
                reason: t.reason,
                message: t.message,
            }));
            if (!changed) {
                if (flattenedTodos.length === 0) {
                    record({ ...base, outcome: 'canonical' });
                    continue;
                }
                // Nothing to persist, and not on protocol either: every site the
                // chain recognised here is one it has no lossless rewrite for.
                // `skipped` — outside what a body-canonicalization pass can do,
                // BY RULING rather than by capability (the conversion must not
                // flatten a combinator) — so, like every skip class, it is
                // printed with each site and does not flip
                // `storedMigrationClean`: no run of this pass could ever clear it.
                record({
                    ...base,
                    todos: flattenedTodos,
                    outcome: 'skipped',
                    reason: `the conversion chain rewrites nothing here: it left ${flattenedTodos.length} `
                        + 'site(s) of this row as stored, because no lossless rewrite exists for them — '
                        + 'each TODO below names the site and why. The row is read as stored, unchanged, '
                        + 'and each TODO says what that leaves it doing; rewrite each site by hand.',
                });
                continue;
            }
            const flattened: StoredMigrationNotice[] = [
                ...notices.map((n) => ({
                    conversionId: n.conversionId,
                    surface: n.surface,
                    from: n.from,
                    to: n.to,
                    path: n.path,
                    message: n.message,
                })),
                ...echoNotices,
            ];

            if (!apply) {
                record({ ...base, notices: flattened, todos: flattenedTodos, outcome: 'pending' });
                continue;
            }

            try {
                await host.saveMetaItem({
                    type: singular,
                    name: base.name,
                    item,
                    mode: state === 'draft' ? 'draft' : 'publish',
                    // [#21207] The STORED hash this pass read itself — the
                    // in-process spelling, never compared in keyed form (the
                    // pass already holds the stored value; nothing to key).
                    storedParentVersion: row.checksum ?? null,
                    packageId,
                    force: true,
                    source: 'migrate-stored',
                    // [#23068] The user who ran the pass, or none — and none
                    // reaches `PutOptions.actor` as `null` (`saveMetaItem`'s
                    // #4556 default). The pass's name is on `source` above.
                    ...(request.actor ? { actor: request.actor } : {}),
                });
                record({ ...base, notices: flattened, todos: flattenedTodos, outcome: 'rewritten' });
            } catch (e: any) {
                // [#8333 · P13] `rows[].reason` is REPORT DATA — it rides on the
                // migration report, not on a thrown message — so no HTTP
                // boundary's 5xx withhold can reach it. Measured on
                // `origin/main`: a `sys_metadata` write failing under
                // `saveMetaItem` put `SQLITE_ERROR: no such table: sys_metadata`
                // straight onto this field.
                //
                // The authoring half is unaffected and that was checked before
                // this line changed, not assumed: every refusal this `try` can
                // receive declares 4xx — `saveMetaItem`'s spec rejection
                // (422 `INVALID_METADATA`), `SysMetadataRepository`'s
                // `ITEM_LOCKED` / `WRITABLE_PACKAGE_REQUIRED` (403 / 422) —
                // so each is still quoted verbatim and still names the fix.
                //
                // ⚠️ The old fallback was `String(e)`, which is itself a
                // disclosure (`String(err)` renders as `Error: SQLITE_ERROR:
                // …`). A stable sentence replaces it; the text goes to the log
                // below, whole.
                record({
                    ...base,
                    notices: flattened,
                    todos: flattenedTodos,
                    outcome: 'failed',
                    reason: clientFacingFailureText(
                        e,
                        'the metadata store rejected the rewrite; the reason is in the server log',
                    ),
                });
                console.warn(
                    `[protocol.migrateStoredMetadata] rewrite failed for ${base.type}/${base.name}: ${e?.message ?? e}`,
                );
            }
        }

        return report;
    }
}
