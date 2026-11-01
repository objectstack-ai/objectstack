// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/packages` domain — extracted dispatcher body (ADR-0076 D11 step ③,
 * PR-5). Package management: list/install/enable/disable, ADR-0033 draft
 * publish/discard, ADR-0067 commit history & rollback, ADR-0070 export /
 * orphan adoption / duplicate, and delete. Since D11 step ② (#3142) the
 * whole family flows through `dispatch()` (single pipeline), which this
 * extraction preserves — only the body's home changes.
 */

import { CoreServiceName } from '@objectstack/spec/system';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { FIELD_FILE_SERVICE, type IFieldFileService } from '@objectstack/spec/contracts';
// [#5320] A's mechanical half of the fork ruling: on export, view artifacts
// are PARTITIONED — containers travel in `views:`, expanded items a travelling
// container re-derives exactly are folded away (the import side's own
// expansion recreates them), and everything else (tenant-authored standalone
// ViewItems, flattened overlays, edited expanded items) travels under the
// declared `viewItems:` channel the registration loop ingests.
import { ASSEMBLED_VIEW_ITEMS_KEY, partitionAssembledViewArtifacts } from '@objectstack/spec/ui';
import {
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
// [#7033 / #7023] The read gate reuses the SAME "builder" capability set the
// object-schema mask exempts (ADR-0106 D4) — REFERENCED, never re-spelled, so
// the package-read cohort cannot drift from the metadata mask's exemption.
// [#7020] That constant became the DERIVED union (write gate ∪ read-only
// exemptions) when the maintainer ruled the two sets must not be hand-kept
// separately. This gate wants the read-only half specifically: its cohort was
// ruled on its own terms (#7033 / #7023) and pinned WRITE-only callers OUT
// (`packages-capability-gate.test.ts`, beside this file), so it names
// `OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES` — same value it read before,
// no re-ruling of the package cohort as a side effect of #7020.
import { OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES } from '@objectstack/metadata-core';
// [#28411, ADR-0146 D8 item 4] The per-package customization read's three
// sources, each read from its owner: the pair's id and a pair's base
// (`@objectstack/spec/kernel`, the one spelling of the suffix), and the
// activation ledger's one reader (`@objectstack/core`).
import { customizationBasePackageId, customizationPackageId } from '@objectstack/spec/kernel';
import { listPackageMetadataActivations, METADATA_ACTIVATION_TABLE } from '@objectstack/core';
import type { GetPackageCustomizationsResponse } from '@objectstack/spec/api';
// [ADR-0131 D3 · D12 items 7–8] The walled refusal's one predicate, asked by
// every package write door below, never restated here.
import { walledCatalogWriteVerdict } from '@objectstack/metadata-core';
import { readEffectiveTenancyPosture } from './activation-gate.js';
// [#21727] ADR-0087 D1's protocol handshake and the brand predicate for its
// refusal. The install branch asks the predicate ahead of its generic catch,
// and its no-protocol fallback runs the same handshake.
// [#21762] The refusal's answer is the shared one, which the install-local door
// (`@objectstack/cloud-connection`) gives too: imported, never restated.
import {
    assertDeclaredDependencies,
    assertProtocolCompat,
    dependencyMissingAnswer,
    isDependencyMissingError,
    isProtocolIncompatibleError,
    protocolIncompatibleAnswer,
    type InstalledDependencyRecord,
} from '@objectstack/metadata-core';
// [#7560] ADR-0070's read-only-package rule — the SAME predicate the metadata
// authoring path asks before refusing a write INTO a platform package
// (`saveMetaItem` → `WRITABLE_PACKAGE_REQUIRED`). Imported, never re-spelled:
// this defect existed precisely because the lifecycle routes had no copy of it,
// and a second copy would be the next place it drifts.
import { isWritablePackage, READ_ONLY_PACKAGE_SCOPES } from '@objectstack/metadata-protocol';
// [ADR-0146 D3] The pair-shaped-id predicate the install primitive asks — asked
// at `POST /packages` too, ahead of both its install limbs.
import { customizationPairManifestRefusal } from '@objectstack/metadata-protocol';
// [#28117] The one reader of a manifest's declared dependency ids (ADR-0141),
// shared with the registry's co-owner gate.
import { declaredDependencyIds } from '@objectstack/core';
// [#9960] The uninstall seam's DECLARED shapes, from the same producer and for
// the same reason as the predicate above: this door reached `deletePackage`
// through `protocol` and routinely sent two keys — `organizationId`
// and `keepData` — that the since-removed REST twin's own option type (#14503)
// could not even
// express. One statement of the contract, imported by both doors.
import type { DeletePackageRequest, DeletePackageResponse } from '@objectstack/metadata-protocol';
// [#22090] The stored-member half of `POST /packages/:id/revert`, typed from
// the producer's method — see `revertStoredPackage` on the handle below.
import type { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// [#13598] The DECLARED protocol contracts this domain's request literals are
// compiled against. Imported, never restated: a second hand-written
// `saveMetaItem(…)` signature here would silently drift from the one the spec
// declares and `ObjectStackProtocolImplementation` states it `implements` —
// which is the whole reason `PackagesDomainProtocol` below is `Pick`ed rather
// than written out. Same move `domains/mcp.ts` makes for its merged-read seam.
import type { MetadataProtocol, PackageProtocol } from '@objectstack/spec/api';
// [#8443] ADR-0112's disclosure rule (#8086 / #8136 / #8333), and the DECLARED
// 422 that keeps the one quotable population quotable. Both imported from the
// producer for the reason the line above is: this door's seed-apply fallback is
// a second copy of `metadata-protocol`'s `applySeedBodies`, and a second
// private restatement of "when may a caught sentence be quoted" is where the
// two copies start answering differently.
import { clientFacingFailureText, seedRequestValidationError } from '@objectstack/metadata-protocol';
// [#15591] The DECLARED removal of our OWN read-time annotations, imported
// from the list that defines them (`METADATA_READ_DECORATIONS`) rather than
// re-spelled here. `applyPublishedSeeds` below re-parses a SERVED document, and
// `spec/kernel/metadata-read-decorations.ts` states the rule this door was
// missing: "a served body is NOT a valid input to the schema that produced it
// until these are removed". Same helper, same reason, as the three consumers
// that already call it — the dataset query in `rest-server.ts`, the cold-boot
// flow bind in `service-automation`, and `saveMetaItem`'s verbatim persist.
import { stripReadDecorations } from '@objectstack/spec/kernel';
// [#19120 / #19417] The DECLARED grammar of TWO manifest keys, asked BY
// REFERENCE at the install door below. `ManifestSchema.shape.version` and
// `ManifestSchema.shape.id` are the very field schemas
// `PackageInstallRequestSchema` binds through `manifest: ManifestSchema` — not
// copies of them. ⛔ A hand-written semver regex here would be a SECOND grammar
// for the version key on this one surface: the `PATCH /packages/:id` door
// further down judges the same key and keeps no copy of its own either — it
// references `SEMVER_2_0_0_VERSION_PATTERN`, the same constant
// `ManifestSchema`'s own `version` field references (`@objectstack/spec`
// `kernel/version-grammar.ts`). Both doors therefore read ONE declaration, and
// a change to that declaration reaches both of them with no edit to this file.
// The same holds for the id — `MANIFEST_ID_PATTERN` is declared ONCE in
// `kernel/manifest.zod.ts` and shared with `PackageSchema.manifestId`, so ⛔ no
// reverse-domain regex is spelled here either.
//
// `manifestIdRefusal` is imported for exactly one limb: the fallback when a
// failed parse somehow carries no issue. Even that limb then prints the
// DECLARATION's own sentence rather than a second one invented here.
import { ManifestSchema, SEMVER_2_0_0_VERSION_PATTERN, manifestIdRefusal } from '@objectstack/spec/kernel';
// [#17672] The repo's ONE message for a single-valued query parameter supplied
// more than once, from the module whose header is the authority on the rule
// (`packages/rest/src/query-multiplicity.ts`). Imported, never restated: this
// door carried its own sentence for the identical condition, which is the drift
// that module's header forbids — and what stopped #17668 from importing it was
// reachability alone, which this card closes.
// ⛔ The gate beside it (`refuseRepeatedQueryParams`) is NOT what a dispatcher
// domain calls: it writes the bare `{ error: { code, message } }` body onto a
// `res`, and every error body on this surface is `deps.error`'s. See the
// `@objectstack/rest` barrel entry that publishes the pair.
// [#26713] …and its recognition sibling, the one sentence for a query
// parameter a door does not read (`packages/rest/src/query-allowlist.ts`),
// asked by every write door (`refusePackageWriteDoorQuery`, #26857).
import { repeatedQueryParamMessage, unknownQueryParamRefusalMessage } from '@objectstack/rest';
// [commit 0862063ba] The repo's ONE coercion for a query parameter its schema declares
// `z.boolean()`, from the module whose header is the authority on the rule
// (`packages/runtime/src/query-param.ts`). Imported, never restated: the list
// door's `enabled` is declared `z.boolean().optional()` — character for
// character the shape `ListNotificationsRequestSchema.read` carries — and that
// door reads it with this same parser. A hand-written `=== 'true'` here would
// be a second dialect for one declared type, which is precisely the `?read=1`
// defect (#6928) this module exists to stop anyone writing again.
import { parseBooleanParam } from '../query-param.js';
import { setPackageDisabled } from '../package-state-store.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';
import { readDispatchedBody } from '../deferred-request-body.js';
// [#19328] The install door's DECLARED body contract, asked whole at
// `POST /api/v1/packages` — the union of the wrapped request and a bare
// manifest — plus each branch by name, which the refusal re-reads to locate a
// failure on the form the caller wrote. All three are the declarations
// `@objectstack/spec` publishes for this door; nothing here restates them.
// Its own line on purpose: the `@objectstack/spec/kernel` import above carries
// the id/version legs' names and is not this import's to share.
import {
    PackageInstallBodySchema,
    PackageInstallManifestSchema,
    PackageInstallRequestSchema,
    PublishPackageDraftsRequestSchema,
} from '@objectstack/spec/api';

/**
 * [#13598] The `protocol` service slot **as this domain reaches it** — one
 * statement of the handle, `Pick`ed from the DECLARED contracts, replacing
 * twelve independent `protocol` seams in this file.
 *
 * ## What was wrong with the seam
 *
 * `deps.resolveService(context, 'protocol')` answers `any`. That is not an
 * oversight — {@link DomainHandlerDeps.resolveService} types its return from
 * `ServiceSlotContracts`, and `protocol` is deliberately left unmapped there
 * ("real services with no written contract, so they keep today's `any` rather
 * than being given a shape here that nothing verifies"). The `any` is honest
 * about the SLOT. What it also did, silently, was hand every request literal
 * downstream of it an unchecked call target: the end state of commit cccbe51bf's ruled pattern —
 * "an undeclared key in a request literal is a compile error" — stopped one
 * seam short here, so a misspelt or undeclared key in these literals compiled.
 *
 * ## Why the type is here and not on the slot
 *
 * Mapping `'protocol'` in `ServiceSlotContracts` would type every consumer at
 * once, but it is a `packages/spec` change that would have to answer for the
 * whole slot — including the seven verbs below that no contract declares at
 * all — and it would state that a filled slot IS a `MetadataProtocol`, whose
 * members are mostly REQUIRED. That is the shape the guards exist to deny (see
 * next paragraph). So the narrowing happens at the consumer, once, exactly as
 * `domains/mcp.ts` narrows the same slot to `Pick<MetadataProtocol,
 * 'getMetaItems'>` for its merged read.
 *
 * ## ⛔ Every member is OPTIONAL, and the runtime guards STAY
 *
 * A host may occupy this slot with a partial object — that is the documented
 * reason the `typeof protocol.<verb> === 'function'` probes exist, and every
 * one of them survives this change unchanged in meaning. `Partial<…>` is what
 * makes the type agree with them instead of contradicting them: tightening the
 * type and then deleting a probe would trade a compile-time improvement for a
 * runtime crash. The type answers "is this key declared?"; the probe answers
 * "did THIS host bring the verb?". Two different questions, both still asked.
 *
 * ## Where the ledger honestly ends
 *
 * The first two groups name shapes someone DECLARES: the spec's
 * `MetadataProtocol` / `PackageProtocol`, and — for `deletePackage` — the
 * producer's own exported request type, already imported here since #9960 for
 * exactly this reason. The last group has no declared request shape anywhere:
 * `@objectstack/metadata-protocol` types those seven verbs inline on the
 * implementation class and exports nothing for them. Writing a structural type
 * for them HERE would be a private restatement that nothing verifies — the
 * thing #9846 retired one file over. So their request keeps `any` and the gap
 * stays visible and greppable: declaring them is producer-side work, not this
 * consumer's to invent. What the entries still buy is the verb name itself —
 * `protocol.rollbackToPackageCommmit` is now a compile error where the `any`
 * handle took any spelling at all.
 */
export type PackagesDomainProtocol =
    Partial<Pick<MetadataProtocol, 'getMetaItem' | 'getMetaItems' | 'saveMetaItem'>>
    & Partial<Pick<PackageProtocol, 'installPackage'>>
    & {
        /** Declared by the producer (`@objectstack/metadata-protocol`), #9960. */
        deletePackage?(request: DeletePackageRequest): Promise<DeletePackageResponse>;
        /**
         * [#22090] Typed from the producer's own method signature rather than
         * restated here, so a key this door sends that the producer does not
         * declare is a compile error.
         */
        revertStoredPackage?: ObjectStackProtocolImplementation['revertStoredPackage'];
        /**
         * [ADR-0146 D3] The ensure door of a base's paired `.custom` package,
         * typed from the producer's method signature — its request and answer
         * are the published `EnsureCustomizationPackage*Schema` pair.
         */
        ensureCustomizationPackage?: ObjectStackProtocolImplementation['ensureCustomizationPackage'];
        /**
         * [#28409] The per-package layer the export reads, typed from the
         * producer's own signature as above.
         */
        getMetaItemsPerPackage?: ObjectStackProtocolImplementation['getMetaItemsPerPackage'];
        /** ⚠️ Undeclared request shapes — see "Where the ledger honestly ends". */
        publishPackageDrafts?(request: any): Promise<any>;
        discardPackageDrafts?(request: any): Promise<any>;
        listCommits?(request: any): Promise<any>;
        revertCommit?(request: any): Promise<any>;
        rollbackToPackageCommit?(request: any): Promise<any>;
        reassignOrphanedMetadata?(request: any): Promise<any>;
        duplicatePackage?(request: any): Promise<any>;
        updatePackage?(request: any): Promise<any>;
        /**
         * [#28411] The served overrides of a base's items, typed from the
         * producer's own signature.
         */
        listServedOverrides?: ObjectStackProtocolImplementation['listServedOverrides'];
    };

/**
 * [#13598] Resolve the `protocol` slot as {@link PackagesDomainProtocol}.
 *
 * THE one narrowing point for this file. `resolveService` answers `any` for
 * this name, so the widening happens here and nowhere else — every call site
 * downstream holds a typed handle, and a thirteenth call site added next month
 * gets the type by construction rather than by remembering to write one.
 *
 * ⛔ Not a guard and not a replacement for one: it neither probes for verbs nor
 * rejects a partial host. `undefined` still means "no protocol service", and
 * each caller still asks its own `typeof …=== 'function'` capability question.
 */
async function resolveProtocol(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
): Promise<PackagesDomainProtocol | undefined> {
    return await deps.resolveService(context, 'protocol');
}

export function createPackagesDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/packages',
        handler: (req, context) =>
            handlePackagesRequest(deps, req.path.substring(9), req.method, req.body, req.query, context),
    };
}

/**
 * ADR-0066 D1 WRITE gate for the `/packages` domain (#7033 / #7023).
 *
 * Every state-changing package route — install, enable/disable, publish,
 * publish-drafts, discard-drafts, the ADR-0067 commit revert / rollback /
 * revert family, adopt-orphans, duplicate, manifest PATCH and DELETE — demands
 * the same `manage_metadata` capability the sibling `/meta` writes carry:
 * #6603 gated the REST `PUT /meta/:type/:name` and #7019 its dispatcher
 * transport, and `POST /meta/_migrate-stored` gates on the same key. Promoting
 * a whole package's drafts to active, discarding them, deleting the package or
 * rolling it back are metadata-authoring writes of the same class, so they
 * carry the same capability. (The reason `manage_metadata` and not the D4 read
 * set: this is ADR-0066 D1's authoring capability; the maintainer's 2026-08-09
 * ruling — "whoever can write schema is who may manage packages" — mirrors
 * #6603's judgement verbatim. #7020 tracks whether the two sets should align.)
 *
 * Returns a 403 result to short-circuit on, or `null` to proceed. Engine
 * self-invocation (`isSystem`, never settable from the wire) bypasses, exactly
 * as the migrate-stored gate does. Callers MUST run this BEFORE resolving the
 * protocol/metadata service AND before mutating the registry, so (a) an
 * unauthorized caller cannot use the 501-vs-200 answer to fingerprint which
 * primitives the deployment supports, and (b) nothing is written or deleted
 * before the refusal — "delete first, refuse second" is the worst shape here.
 */
/**
 * The fields an installed-package RECORD is declared to carry
 * (`InstalledPackageSchema`, `@objectstack/spec/kernel` — that schema is the
 * authority; this list mirrors it and is deliberately not derived from it, so
 * adding a field to the schema is a decision to publish it here, not an
 * automatic one).
 */
const INSTALLED_PACKAGE_RESPONSE_FIELDS = [
    'manifest',
    // [#23972] The origin the registering door stamped on the row — read off
    // the record as-is, ⛔ never derived here from `writable` or a second list.
    'source',
    'status',
    'enabled',
    'installedAt',
    'updatedAt',
    'installedVersion',
    'previousVersion',
    'statusChangedAt',
    'errorMessage',
    'settings',
    'upgradeHistory',
    'registeredNamespaces',
] as const;

/**
 * Project a registry item onto the declared record fields before it goes on the
 * wire — the second half of the `500 Converting circular structure to JSON`
 * repair, and defence in depth rather than the fix.
 *
 * The fix is at the PRODUCER: `SchemaRegistry.installPackage` now stores a
 * serializable projection of the manifest, so this door has nothing
 * unserializable to hand out. What this adds is the failure MODE for the next
 * time: an undeclared member appearing on the registry item — a live handle, a
 * back-reference — degrades to a field this response never mentions, instead of
 * failing the whole read with a 500. `{ ...pkg }` had the opposite property:
 * ONE bad member on ONE package took out the entire list for every caller,
 * which is exactly how a stock showcase boot answered 500 on `GET /packages`
 * while Studio asked for it three times per open.
 *
 * Undefined fields are omitted rather than serialised as explicit `undefined`,
 * so the response bytes are unchanged for every record that was already fine.
 */
function toPackageResponse(pkg: unknown): unknown {
    if (pkg === null || typeof pkg !== 'object') return pkg;
    const src = pkg as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const field of INSTALLED_PACKAGE_RESPONSE_FIELDS) {
        if (src[field] !== undefined) out[field] = src[field];
    }
    return out;
}

function requireManageMetadata(deps: DomainHandlerDeps, context: HttpProtocolContext): HttpDispatcherResult | null {
    const ec: any = context?.executionContext;
    if (!ec?.isSystem && !new Set<string>(ec?.systemPermissions ?? []).has('manage_metadata')) {
        return {
            handled: true,
            response: deps.error('Managing packages requires the `manage_metadata` capability.', 403),
        };
    }
    return null;
}

/**
 * The actor a package write door records (ADR-0146 D1): the user id of the
 * execution context this request was authorized as — the same context
 * {@link requireManageMetadata} judged a few lines earlier — or `undefined`
 * when the caller carries none, so the protocol's no-actor default (a `NULL`
 * `recorded_by`) applies and a machine write is never stamped with a person.
 *
 * Never the request body: a body `actor` let any caller holding
 * `manage_metadata` record any name as the one who changed a package. This is
 * the rule `RestServer.resolveMetaWriteActor` holds for the `/meta` write
 * doors, so attribution cannot drift from authorization. [#28414] Every
 * package door that stamps history or a commit reads it: `publish-drafts`
 * (and its app re-save), `discard-drafts`, `commits/:commitId/revert`,
 * `rollback`, `adopt-orphans` and `duplicate`. A body `actor` is ignored, not
 * refused, so a client still sending one keeps working and is recorded as
 * itself. No caller acts on behalf of another identity through these doors
 * (measured: the console and the SDK send none, the CLI calls none); one that
 * must is served server-side by calling the protocol with its own `actor`.
 */
function resolvePackageWriteActor(context: HttpProtocolContext | undefined): string | undefined {
    const userId: unknown = (context?.executionContext as { userId?: unknown } | undefined)?.userId;
    return typeof userId === 'string' && userId ? userId : undefined;
}

/**
 * ADR-0106 D4 READ gate for the `/packages` domain (#7033 / #7023).
 *
 * Package reads disclose authored metadata — the `GET /packages` id
 * ENUMERATION face (the first step of the survey's attack chain), the
 * `GET /packages/:id` detail and the `GET /packages/:id/export` whole-package
 * export (27 metadata types) — so each requires one of the two "builder"
 * capabilities the object-schema mask exempts
 * read-only ({@link OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES} =
 * `studio.access` / `setup.access`), or `isSystem`. The read cohort is not the
 * write cohort: an `organization_admin` holding `setup.access` (but not
 * `manage_metadata`) may inspect a package yet not publish or delete it, and a
 * write-only caller holding `manage_metadata` alone is refused these reads —
 * pinned in `packages-capability-gate.test.ts`, beside this file. (#7020
 * unified the object-schema MASK exemption with the write gate; it did not
 * re-rule this cohort, which is why this site names the read-only half.)
 * [#23546] `GET /packages/:id/commits` left this cohort: the commit trail has
 * its own gate, {@link requireCommitTrailReadCapability}.
 *
 * Returns a 403 result to short-circuit on, or `null` to proceed. Callers MUST
 * run this BEFORE reading, so the answer never leaks the package inventory to a
 * caller outside the cohort.
 */
function requireReadCapability(deps: DomainHandlerDeps, context: HttpProtocolContext): HttpDispatcherResult | null {
    const ec: any = context?.executionContext;
    const held = new Set<string>(ec?.systemPermissions ?? []);
    if (!ec?.isSystem && !OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES.some((c) => held.has(c))) {
        return {
            handled: true,
            response: deps.error('Reading packages requires the `studio.access` or `setup.access` capability.', 403),
        };
    }
    return null;
}

/**
 * [#23546] The READ gate of `GET /packages/:id/commits` alone — a package's
 * commit trail (ADR-0067), read from `sys_metadata_commit`.
 *
 * It admits `studio.access` or `isSystem`. That is the data door's rule on the
 * same table (`requiredPermissions: ['studio.access']`, ADR-0131 D7), and the
 * `/meta` trail doors' rule (`GET /meta/:type/:name/history`, `/audit` and
 * `/diff` in `RestServer`).
 *
 * `setup.access` is left out on purpose. Organization administrators hold it,
 * and under a wall it handed each organization's administrator every
 * package's commit trail: who published what, and when. No organization
 * authors that trail (ADR-0131 C5).
 *
 * `manage_metadata` is not admitted either. This door's read cohort never
 * admitted it, and narrowing a door does not widen it. The other three reads
 * (`GET /packages`, `/packages/:id` and `/export`) keep
 * {@link requireReadCapability}. Pinned in `packages-capability-gate.test.ts`,
 * beside this file.
 *
 * Returns a 403 result to short-circuit on, or `null` to proceed. It runs
 * BEFORE the protocol is resolved, as the read gate does.
 */
function requireCommitTrailReadCapability(deps: DomainHandlerDeps, context: HttpProtocolContext): HttpDispatcherResult | null {
    const ec: any = context?.executionContext;
    const held = new Set<string>(ec?.systemPermissions ?? []);
    if (!ec?.isSystem && !held.has('studio.access')) {
        return {
            handled: true,
            response: deps.error(
                'Reading a package\'s commit history requires the `studio.access` capability; '
                + '`setup.access`, which organization administrators hold, does not admit it.',
                403,
            ),
        };
    }
    return null;
}

/**
 * ADR-0070 READ-ONLY gate for the destructive `/packages` LIFECYCLE routes
 * (#7560).
 *
 * This is a **second, independent** check from the two gates above, on a
 * different axis, and collapsing the two is what produced the defect. #7033 /
 * PR #7083 decided *who may call* these routes — writes need `manage_metadata`,
 * reads the ADR-0106 D4 set, plus a domain-wide anonymous floor. This decides
 * *what the route may do once the caller is allowed*: an authorized admin could
 * still `PATCH /packages/<platform pkg>/disable` → 200 and
 * `DELETE /packages/<platform pkg>` → 200, and the package really left the
 * running registry listing. One API call took platform functionality out of a
 * live deployment; `DELETE` came back on restart (the packages are code-loaded),
 * `disable` did NOT — {@link setPackageDisabled} persists the disable to
 * `<OS_HOME>/package-state/<env>.<project>.json`, which the registry re-reads at boot, so
 * a disabled platform package stays disabled across restarts.
 *
 * The predicate is {@link isWritablePackage} from `@objectstack/metadata-protocol`
 * — the ADR-0070 rule the authoring path already enforces, referenced rather
 * than re-spelled. The refusal is that path's refusal too: `422` /
 * `WRITABLE_PACKAGE_REQUIRED`, the code registered for exactly this condition
 * ("the package is read-only — provided by code or an installed app"). No new
 * vocabulary is invented here; the sentence is lifecycle-specific because the
 * authoring one ("switch to a writable package in the package selector") names
 * a remedy that makes no sense for a delete.
 *
 * [#22113] `POST /packages/:id/publish` and `POST /packages/:id/revert` ask it
 * too, with the same predicate and refusal: publishing or reverting a code
 * package's shipped items is an authoring write into a read-only package
 * (ADR-0070 D2). Revert asks it only after the protocol's stored-row answer, so
 * a `sys_metadata` row bound to the package keeps its own answer.
 *
 * [#14451] It used to name `POST /packages/:id/duplicate` as the remedy. That
 * sentence sent a caller holding a read-only package at a route which — for
 * exactly the packages this refusal fires on — cannot help: duplicate clones a
 * base's `sys_metadata` rows, a code package owns none, and until {@link
 * requireDuplicableSource} the trip ended in a 200 reporting `copiedCount: 0`
 * (the #14451 measurement). A refusal that prescribes a dead end is worse than
 * one that prescribes nothing.
 *
 * [ADR-0131 D6] For the same reason it no longer names the ADR-0005
 * organization overlay, its remedy after that: the per-organization overlay
 * axis is retired, and a write naming an organization answers `403
 * NOT_OVERRIDABLE`. What a managed package provides is customised BESIDE it,
 * as environment-level state, and the two doors name that remedy in one
 * clause ({@link CUSTOMISE_BESIDE_REMEDY}).
 *
 * ⛔ Deliberately NOT caller-sensitive — there is no `isSystem` bypass, unlike
 * {@link requireManageMetadata}. Read-only is a property of the PACKAGE. Engine
 * self-invocation has no business uninstalling a code package over HTTP, and
 * internal teardown calls `registry.uninstallPackage` directly without passing
 * through any of these gates.
 *
 * Callers MUST run this BEFORE mutating — the same "delete first, refuse
 * second is the worst shape here" ordering the write gate records. Returns a
 * refusal result to short-circuit on, or `null` to proceed.
 *
 * A package id that resolves to nothing is treated as WRITABLE, so an unknown
 * id still falls through to the route's own 404 rather than being re-labelled
 * 422 (and so this gate never becomes an existence oracle of its own).
 */
/**
 * [ADR-0131 D3 · D12 items 7–8 · #23231] The walled refusal at the `/packages`
 * write doors: under a wall every organization shares the environment's
 * metadata, and a package is that metadata's unit of authoring, so every
 * package write is the platform operator's.
 *
 * Measured before this refusal (ruling A on #23231, record 6145019463), under
 * `isolated` and `group`: an organization's `manage_metadata` holder (rung
 * `TENANT_ADMIN`) answered `2xx` at all thirteen write doors — create, the
 * manifest `PATCH`, enable, disable, publish, publish-drafts, discard-drafts,
 * revert, rollback, `commits/:commitId/revert`, duplicate, adopt-orphans and
 * delete — on packages carrying no catalog item, and another organization's
 * member read each change (`wall-environment-metadata-refusal.dogfood.test.ts`).
 * W2 and W3 had refused these doors only when the items a verb acted on
 * included a position, a permission set or a capability (ADR-0131 D3); that
 * reading of the items is gone with the special case.
 *
 * Every write door asks this right after {@link requireManageMetadata} and
 * before anything else is read or written. The decision is
 * {@link walledCatalogWriteVerdict}'s, never restated: admitted under `single`,
 * with no `tenancy` service, for `isSystem` and for the `PLATFORM_ADMIN` rung,
 * so the door then behaves exactly as before; refused for everyone else under a
 * wall, with this domain's `403` (`PERMISSION_DENIED`).
 */
async function refuseWalledCatalogPackageWrite(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    /** The refused write, as the message names it, e.g. `Deleting package "x"`. */
    action: string,
): Promise<HttpDispatcherResult | null> {
    const ec: any = context?.executionContext;
    const verdict = walledCatalogWriteVerdict({
        type: 'package',
        tenancyPosture: await readEffectiveTenancyPosture(deps, context),
        isSystem: ec?.isSystem === true,
        callerPosture: ec?.posture,
    });
    if (verdict.allowed) return null;
    return { handled: true, response: deps.error(`${action} is refused. ${verdict.message}`, 403) };
}

/**
 * Whether `registry` can be asked about `id` and answers that it holds no such
 * package — the same `getPackage` lookup `GET /packages/:id`, enable and
 * disable answer their `404` from, so the draft doors cannot disagree with
 * them about which packages exist. An authored package is installed into this
 * registry too (`POST /packages`, and `service-package` at boot), so a Studio
 * app is never "unknown" here.
 *
 * Read by `discard-drafts` and `GET /:id/commits` only AFTER the protocol has
 * answered, and only when that answer is empty: drafts or commits the
 * protocol does hold for an id the registry lacks are still discarded or
 * listed exactly as before. What changes is the one answer that lied — `200`
 * "nothing discarded" / "no commits" for a package that is not there, which an
 * SDK or AI caller cannot tell apart from a real, empty package.
 *
 * [#26708] `publish-drafts` reads it FIRST, before anything is published, and
 * refuses an unknown id whatever drafts are stored under it. Such drafts are
 * bound to a package that does not exist (saved before the save door's
 * named-base rule covered every type), and publishing them served them live,
 * owned by nothing: no manifest, so no namespace and no uninstall or export.
 * They are not migrated or deleted; `discard-drafts` on the same id still
 * removes them.
 *
 * A registry without `getPackage` cannot be asked, so this answers `false`
 * ("no evidence of absence") rather than invent a 404.
 */
function packageIsUnknown(registry: unknown, id: string): boolean {
    const reg = registry as { getPackage?: (id: string) => unknown } | null | undefined;
    if (typeof reg?.getPackage !== 'function') return false;
    return !reg.getPackage(id);
}

/**
 * [ADR-0131 D6] The customisation remedy both read-only refusals below name
 * ({@link requireWritablePackage}, {@link requireDuplicableSource}), in one
 * spelling. A managed package's items are sealed, and what a customer changes
 * lives beside them as environment-level state: a save under an item's own
 * name is an environment overlay on a type whose registry entry takes one
 * (`allowEnvironmentOverlay`) unless the package's lock refuses it — that save
 * is refused `ITEM_LOCKED`, naming the lock and its reason (ADR-0010 §3.3) —
 * and on every other type the save door's own refusal names the route that
 * type has: a flow's clone and switch, an action's switch, a permission set's
 * clone, else the source. The sentence names that door rather than a list of
 * types, so it cannot drift from the regime table the door reads.
 */
const CUSTOMISE_BESIDE_REMEDY =
    'customise what this package provides beside it, as environment-level state (ADR-0131 D6): save an item '
    + 'under its own name — that overlays it where the item\'s type takes an environment overlay and the package\'s '
    + 'lock does not refuse it, and is otherwise refused naming the route that type has, or the lock.';

function requireWritablePackage(
    deps: DomainHandlerDeps,
    engine: unknown,
    id: string,
    /** Verb for the message, e.g. `'disable'` / `'delete'`. */
    action: string,
): HttpDispatcherResult | null {
    if (isWritablePackage(engine, id)) return null;
    return {
        handled: true,
        response: deps.error(
            `[writable_package_required] Cannot ${action} package '${id}': it is read-only `
            + `(provided by code or an installed app). Packages the deployment ships are managed by `
            + `the deployment, not over this API — ${action} a package you own, or `
            + CUSTOMISE_BESIDE_REMEDY,
            422,
            {
                code: 'WRITABLE_PACKAGE_REQUIRED',
                packageId: id,
                docs: 'docs/adr/0070-package-first-authoring.md',
            },
        ),
    };
}

/**
 * [#28117] Whether `id` is a **module of an installed app** — the one kind of
 * read-only package an admin may DISABLE (and only disable) on this server.
 *
 * ## The ruling
 *
 * A suite ships one artifact: its `type: 'app'` package and several
 * `type: 'module'` packages (ADR-0019 D3, ADR-0130 D2/D6). The maintainer
 * ruled plan A for "enable modules in settings": the customer's own admin
 * switches a module off, per environment, and "disabled" has exactly ONE
 * meaning — hidden, refused on the data plane, data kept. Every package of a
 * booted or installed artifact is read-only to {@link isWritablePackage}, so
 * without this reading the disable door refused every suite module.
 *
 * ## The tie
 *
 * Read off the registry ROW, because the row is what both install paths leave
 * behind: a code boot (`AppPlugin` → `manifest.register`) and a marketplace
 * install (`manifest.register(…, { source: 'marketplace' })`) both record the
 * module's `manifest.type` and `manifest.dependencies`, and neither keeps the
 * artifact's own package list past the registration call. So a package is a
 * module of an installed app when:
 *
 *   • its `manifest.type` is `'module'`;
 *   • it DIRECTLY declares (`manifest.dependencies`, ADR-0141 D1) a package
 *     that is installed here and whose `manifest.type` is `'app'`;
 *   • its own `manifest.scope` is not a platform scope
 *     ({@link READ_ONLY_PACKAGE_SCOPES}): a module the platform delivers stays
 *     the platform's, as every platform package does.
 *
 * Everything else answers as before: the app itself, a plugin, a driver, a
 * module that declares no app, or one whose app is not installed.
 *
 * ⛔ A reading at the disable door, never a change to {@link isWritablePackage}:
 * `writable` keeps meaning "may author into", and stays `false` for a module,
 * so edit, publish, revert, delete and overwrite still refuse it
 * (`WRITABLE_PACKAGE_REQUIRED`, ADR-0070 D2). The door asks it through
 * {@link isDisableablePackage}, which the read doors serve as `disableable`.
 */
function isDisableableAppModule(engine: unknown, id: string): boolean {
    const registry = (engine as PackageRowRegistryHost | null | undefined)?.registry;
    if (typeof registry?.getPackage !== 'function') return false;
    const manifest = registry.getPackage(id)?.manifest;
    if (manifest?.type !== 'module') return false;
    if (typeof manifest.scope === 'string' && READ_ONLY_PACKAGE_SCOPES.includes(manifest.scope)) return false;
    return declaredDependencyIds(manifest).some(
        (dependency) => dependency !== id && registry.getPackage!(dependency)?.manifest?.type === 'app',
    );
}

/** The registry slice {@link isDisableableAppModule} reads: one row, by id. */
interface PackageRowRegistryHost {
    registry?: {
        getPackage?(id: string): { manifest?: { type?: unknown; scope?: unknown; dependencies?: unknown } } | undefined;
    };
}

/**
 * [#28318] The disable door's verdict on `id`: `PATCH /packages/:id/disable`
 * accepts the package (as far as the PACKAGE goes) exactly when this answers
 * `true` — a writable base ({@link isWritablePackage}) or a module of an
 * installed app ({@link isDisableableAppModule}).
 *
 * ONE predicate, asked by both readers: the door, before it switches the
 * package off, and {@link withDisableableVerdict}, which serves the same answer
 * as the row's `disableable` so a client offers Disable only where the door
 * will accept it (#8146: one answer, served by the server). ⛔ Never re-spell
 * the rule at either site. The caller's own permission and a catalog wall are
 * not package facts: the door still asks them, and the verdict does not.
 */
function isDisableablePackage(engine: unknown, id: string | undefined): boolean {
    return (id !== undefined && isDisableableAppModule(engine, id)) || isWritablePackage(engine, id);
}

/**
 * [#14451] `POST /packages/:id/duplicate` — the SOURCE must be a BASE.
 *
 * ## The measurement
 *
 * `POST /api/v1/packages/com.example.todo/duplicate` against a RUNNING code
 * package (`examples/app-todo`, one object + four flows + views + dashboards +
 * reports) answered **HTTP 200**:
 *
 *     {"success":true,"data":{"success":false,"copiedCount":0,"failedCount":0,
 *      "targetPackageId":"com.acme.dupbase","copied":[],"failed":[]}}
 *
 * …and left a real, empty package record behind: `com.acme.dupbase` appeared in
 * `GET /packages` (scope-less, so `writable: true`), its detail door answered
 * 200, and its manifest embedded a copy of the SOURCE bundle
 * (`manifest.manifest.id === 'com.example.todo'`). Reproduced independently
 * twice, on two separate `os dev` processes.
 *
 * ## Why `copiedCount: 0` is BY CONSTRUCTION, not a copy that failed
 *
 * {@link ObjectStackProtocolImplementation.duplicatePackage} clones the rows
 * `sys_metadata` holds for the source (`{ package_id: source, state: 'active' }`).
 * A code package's metadata is CODE — it is registered from an artifact at boot
 * and has no `sys_metadata` rows at all — so the scan is not a copy that came
 * back empty, it is a copy that could never have found anything. The scan
 * cannot fail either, which is what made the old answer unfalsifiable: a
 * `copied: []` that means "this gesture does not apply here" was byte-identical
 * to one meaning "the base really is empty".
 *
 * That is the #11063 ruling, one route over and pointed at a WRITE — **"a read
 * that could not happen must not be reported as a read that found nothing."**
 *
 * ## Why the refusal, rather than teaching duplicate to clone code items
 *
 * ADR-0070 D4 is DECLARED AND NOT BUILT — the ADR's own status line says
 * "D4–D6 remaining", and D4's text names its object precisely: *"Duplicate:
 * clone a **base** into a new writable package (the Airtable 'duplicate base'
 * gesture)."* A base is a writable DB package (D-TL;DR 2). So this route is not
 * a broken implementation of D4; it is a route shipped AHEAD of it, and the
 * "duplicate base" prose around it describes an aspiration rather than a
 * contract the code is failing to meet.
 *
 * Making it clone a code package's items would extend D4 from bases to code
 * packages — a NEW decision, and one the ADR itself still lists as open
 * ("should customising a code item also fork it into a writable base?
 * *Leaning: keep overlay for surgical tweaks*"). Two built answers exist
 * instead (ADR-0131 D6): customising BESIDE the package, as environment-level
 * state ({@link CUSTOMISE_BESIDE_REMEDY}), and, for an editable copy of the
 * whole package, its `unmanaged` install, which the install door judges (the
 * package must permit it, and the copy cannot sit beside a managed install of
 * the same package). So the honest behaviour of an unbuilt gesture is to say
 * so and name both.
 *
 * ## Shape
 *
 * Same PREDICATE as every other writability verdict in this file
 * ({@link isWritablePackage}, ADR-0070 D2 — #8146's "one answer to 'is this
 * package writable?'"), a DIFFERENT code. `WRITABLE_PACKAGE_REQUIRED` would be
 * a lie by implicature here: nothing is being written to the source, and its
 * remedy ("use a writable package") reads as *make the source writable*, which
 * is neither possible nor the point. `DUPLICATE_SOURCE_NOT_A_BASE` names the
 * one thing the caller can act on — pick a base, customise beside the package,
 * or install it unmanaged where it permits that.
 *
 * ⛔ Deliberately NOT a check on emptiness. A WRITABLE base holding no active
 * rows still duplicates to `copiedCount: 0`, and that answer stays exactly as
 * it is: that read HAPPENED and found nothing, which is the legitimate arm of
 * the same ruling. The axis is whether the gesture applies, not whether it
 * found anything.
 *
 * Runs BEFORE the protocol call, which is what makes it observable: the shell
 * package is minted INSIDE `duplicatePackage` (its `installPackage` call
 * precedes the copy loop), so a refusal that ran afterwards would still leave
 * the empty `com.acme.dupbase` the report is about. Same "refuse before you
 * mutate" ordering as {@link requireWritablePackage}, for the same reason.
 *
 * An id that resolves to nothing is treated as writable, exactly as
 * {@link requireWritablePackage} treats it — an unknown source falls through to
 * the protocol rather than being re-labelled 422, so this gate never becomes an
 * existence oracle.
 *
 * Returns a refusal result to short-circuit on, or `null` to proceed.
 */
function requireDuplicableSource(
    deps: DomainHandlerDeps,
    engine: unknown,
    id: string,
): HttpDispatcherResult | null {
    if (isWritablePackage(engine, id)) return null;
    return {
        handled: true,
        response: deps.error(
            `[duplicate_source_not_a_base] Cannot duplicate package '${id}': it is read-only `
            + `(provided by code or an installed app), and duplicate clones a writable base's `
            + `stored metadata rows. A code package's metadata is delivered as code, so there are `
            + `no rows to clone and the copy would be empty (ADR-0070 D4 duplicates a BASE). `
            + `Duplicate a base you own, or ${CUSTOMISE_BESIDE_REMEDY} `
            + `For an editable copy of the whole package, install it unmanaged instead `
            + `(installMode 'unmanaged'), where its manifest's installModes permits that.`,
            422,
            {
                code: 'DUPLICATE_SOURCE_NOT_A_BASE',
                packageId: id,
                docs: 'docs/adr/0070-package-first-authoring.md',
            },
        ),
    };
}

/**
 * Handles Package Management requests
 *
 * REST Endpoints:
 * - GET    /packages          → list all installed packages
 * - GET    /packages/:id      → get a specific package
 * - POST   /packages          → install a new package
 * - DELETE  /packages/:id      → uninstall a package
 * - PATCH  /packages/:id/enable  → enable a package
 * - PATCH  /packages/:id/disable → disable a package
 * - POST   /packages/:id/publish → publish a package (metadata snapshot)
 * - POST   /packages/:id/revert  → revert a package to last published state
 * 
 * Uses ObjectQL SchemaRegistry directly (via the 'objectql' service).
 *
 * **Error handling.** Every `catch` here goes through `deps.errorFromThrown(e,
 * 500)` — never `deps.error(e.message, …)`. Each of these routes calls into the
 * protocol service, whose errors carry their own HTTP status as `status` (the
 * codebase convention: `OBJECT_NOT_FOUND`, `RECORD_NOT_FOUND`, `CLONE_DISABLED`,
 * …), and can be a record `ValidationError` carrying `fields[]`. Hand-rolling
 * `e.statusCode || 500` saw neither — #3867 fixed exactly that read in
 * `errorResponseBase` and #3918 taught `errorFromThrown` the validation shape,
 * but these call sites bypassed both, so a deliberate 404 still rendered as a
 * 500 and `fields[]` was still dropped. Route new handlers through the shared
 * helper rather than re-deriving the status here.
 *
 * [#21727] ONE recognised carrier answers ahead of that helper: the install
 * branch's `ProtocolIncompatibleError`, through `protocolIncompatibleAnswer`
 * (`@objectstack/metadata-core`, shared with the install-local door, #21762).
 * It still answers the status the error declares. What it adds is the
 * structured diagnostic, which the shared resolver's closed `details` list
 * drops by design.
 */
/**
 * [#14375 / ADR-0130 Consequences row 6] Decorate one registry row with the
 * server's OWN writability verdict.
 *
 * Studio's package switcher used to derive "writable" client-side from
 * `manifest.scope` alone (`scope !== 'project'`). That is not the rule this
 * server enforces: {@link isWritablePackage} (ADR-0070 D2) reads
 * `engine.manifests` FIRST — a package booted from an artifact through
 * `registerApp` is read-only whatever its scope says, and a scope-less BOOTED
 * package lands there too. ⛔ That scope-less row is NOT a module carried by a
 * multi-package artifact: `defineStack` parses every `packages[]` entry through
 * `ManifestSchema` (`spec/src/stack.zod.ts`, `ArtifactPackageEntrySchema`),
 * whose `scope` is `.default('project')`, so no package of a compiled artifact
 * is ever scope-less. A row reaches the registry scope-less only WITHOUT that
 * parse: a marketplace install / offline file import
 * (`manifestService.register(rawBody)` → `ql.registerApp` — booted, hence
 * read-only), or a Studio-created base through `POST /api/v1/packages`
 * (`body.manifest || body` → `installPackage`, which stores a key-by-key copy
 * and applies no defaults — hence writable). The client cannot see
 * `engine.manifests`, so it cannot tell those two apart; only the
 * server can, so the server says it — with the SAME predicate the authoring
 * and lifecycle gates use, which is #8146's ruling ("one answer to 'is this
 * package writable?'") applied to the read door.
 *
 * A spread COPY: the registry's own record is never mutated and the verdict is
 * never stored — it is a property of the running engine, recomputed per read.
 * The row is keyed the way the registry keys it (`manifest.id`, falling back
 * to a bare `id`), so the verdict is asked about the same package the row is.
 */
function withWritableVerdict<T extends { manifest?: { id?: unknown }; id?: unknown }>(
    engine: unknown,
    row: T,
): T & { writable: boolean } {
    const manifestId = row?.manifest?.id;
    const id = typeof manifestId === 'string' ? manifestId : (typeof row?.id === 'string' ? row.id : undefined);
    return { ...row, writable: isWritablePackage(engine, id) };
}

/**
 * [#28318] Decorate one registry row with the disable door's verdict,
 * `disableable` ({@link isDisableablePackage}). A separate key, never folded
 * into `writable`: a module of an installed app is `disableable` and not
 * `writable` — it may be switched off, never authored into — and the Console
 * offers Disable / Enable from this key alone. Same shape as
 * {@link withWritableVerdict}: a spread copy, keyed the way the registry keys
 * the row, recomputed per read and never stored.
 */
function withDisableableVerdict<T extends { manifest?: { id?: unknown }; id?: unknown }>(
    engine: unknown,
    row: T,
): T & { disableable: boolean } {
    const manifestId = row?.manifest?.id;
    const id = typeof manifestId === 'string' ? manifestId : (typeof row?.id === 'string' ? row.id : undefined);
    return { ...row, disableable: isDisableablePackage(engine, id) };
}

/**
 * What `?version=` on `GET /packages/:id` asked for (#17416).
 *
 * ## The defect this exists to close
 *
 * The route ACCEPTED `?version=` and no surface serving it ever read the
 * parameter. `ScopedEnvironmentClient.packages.get(id, version)`
 * (`packages/client/src/index.ts`) declares `version?: string` and appends it,
 * so the caller was answered `200` with the INSTALLED row and nothing in the
 * status, headers or body told it apart from a version-scoped read that
 * actually happened. The handler that honoured it — the REST registrar's twin
 * of this route — went with the duplicate response shape in #14503 / #16628,
 * and this dispatcher domain never had that read to inherit.
 *
 * Maintainer ruling on #17416: honour the parameter, or refuse it so the caller
 * knows. ⛔ Silently ignoring is not a third option. This is the honouring
 * half, and it is a request-side change only: the response shape is untouched
 * (that surface is #12034's, bound separately), so one route still answers with
 * exactly one body shape.
 *
 * ## `latest` and "absent" are the SAME request, deliberately
 *
 * The deleted handler read `requested.value || 'latest'` and its store treated
 * `latest` as `ORDER BY created_at DESC LIMIT 1` — so "no version" and
 * "`?version=latest`" named one request there. They name one request here too:
 * the registry holds exactly one row per package id and it is the installed,
 * newest one. ⛔ Not a new sentinel invented at this door — continuity with the
 * contract the deleted door published.
 *
 * ## Why a repeated parameter is NOT resolved here
 *
 * `IHttpRequest.query` is `Record<string, string | string[]>` and the array arm
 * is live on every adapter this repo ships, so `?version=a&version=b` reaches
 * this door as `['a','b']` — a well-formed request carrying two conflicting
 * intents. Picking one silently is a wrong answer delivered as a success, which
 * is the defect class #17416 is about, so it is not done.
 *
 * ## What it answers instead, and where that answer comes from (#17672)
 *
 * `400` with {@link repeatedQueryParamMessage} — the repo's ONE message for
 * this condition, imported from `packages/rest/src/query-multiplicity.ts`,
 * whose header is the authority on the rule. The status is the same one commit 293476148
 * chose for this same condition on this same route, and the code is
 * `VALIDATION_ERROR`: `deps.error(msg, 400)` derives it from
 * `standardErrorCodeForHttpStatus(400)`, the standard catalog's member for 400,
 * so nothing in `packages/spec` moves for it.
 *
 * ⚠️ #17668 shipped this refusal as a `404` carrying a SECOND sentence written
 * here, because that module was reachable from nowhere outside its package.
 * That made a request-shape error indistinguishable from the two genuine
 * not-founds this same door answers — "you asked for a version I do not have"
 * and "no such id" — which is precisely what #17672 filed. The fix was
 * reachability, not judgement: `@objectstack/rest`'s barrel now publishes the
 * message and this door calls it, so the sentence a caller is told for a
 * repeated parameter is the same one on every door that has the rule.
 *
 * ⛔ The gate beside it (`refuseRepeatedQueryParams`) is deliberately NOT
 * called: it writes the bare ADR-0112 body onto a `res`, and this surface's
 * envelope is `deps.error`'s, which adds the `success` / `httpStatus` siblings
 * (measured — the gate's body fails `BaseResponseSchema` here). ⛔ And a copy
 * of the rule in this package is never the answer: one rule, one message.
 *
 * ## Ordering — the id refusal still wins (#17416, unchanged)
 *
 * The multiplicity check stays where #17416 put the version scope: AFTER the id
 * lookup. An id this registry does not hold is still answered
 * `Package '<id>' not found`, whether or not a repeated `?version=` rode along
 * — this card moved the status of a refusal, ⛔ not the order of two refusals.
 *
 * A one-element array is one occurrence encoded differently by an adapter and
 * is unwrapped, per that same rule's stated semantics.
 */
type RequestedVersion =
    | { readonly kind: 'unscoped' }
    | { readonly kind: 'exact'; readonly value: string }
    | { readonly kind: 'repeated'; readonly count: number };

function readRequestedVersion(raw: unknown): RequestedVersion {
    if (Array.isArray(raw)) {
        if (raw.length > 1) return { kind: 'repeated', count: raw.length };
        return readRequestedVersion(raw[0]);
    }
    if (typeof raw !== 'string') return { kind: 'unscoped' };
    // `latest` is the installed row — see this type's header.
    if (raw === 'latest') return { kind: 'unscoped' };
    return { kind: 'exact', value: raw };
}

/** One zod issue, as far as {@link installBodyRefusal} reads it. */
interface InstallBodyIssue {
    readonly code: string;
    readonly path: ReadonlyArray<PropertyKey>;
    readonly message: string;
    readonly keys?: ReadonlyArray<string>;
}

/**
 * [#19328] The sentence `POST /api/v1/packages` answers when the body parses
 * through NEITHER declared form of `PackageInstallBodySchema`.
 *
 * ## Which form the caller wrote — the declaration's own discriminator
 *
 * The union's two branches are disjoint BY CONSTRUCTION, and the spec
 * docblock says why: `ManifestSchema` is a strict close with no `manifest`
 * key, and the wrapped request REQUIRES one. So "does the body carry a
 * `manifest` key" is not a heuristic this door invented — it is the fact that
 * makes the union unambiguous. A body with the key can only ever pass the
 * wrapped branch; a body without it, only the bare one.
 *
 * The verdict is the UNION's, taken by the caller before this runs. What this
 * adds is WHERE: zod reports a failed union as one `invalid_union` carrying
 * both branches' complaints, and the branch the caller did not write explains
 * nothing — a wrapped body read as a bare manifest "lacks `id`" and has an
 * "unrecognised key `manifest`". So the form the caller wrote is re-parsed
 * alone and ITS issues are the ones located. ⛔ The shared union-branch
 * ranking (`zodIssuesToFields`) is not used for this: measured, it picks the
 * bare branch for `{ manifest: null, … }` and reports both branches for a bare
 * body missing `type`, because it ranks by issue shape and cannot know that
 * one key decides the form.
 *
 * ## The one prescription it adds — install options spelled on the bare form
 *
 * `settings`, `enableOnInstall`, `overwrite` and the wrapped request's other
 * option keys are not manifest keys, and `ManifestSchema`'s strict close
 * refuses them by name. The declaration states the remedy in as many words —
 * «a caller that needs an option sends the wrapped form» — so the refusal
 * says so, naming the keys it found. The option set is read OFF the wrapped
 * declaration (`PackageInstallRequestSchema.shape`), ⛔ never listed here: a
 * key the declaration gains is prescribed for with no edit to this file.
 * `overwrite` alone also rides the query string, which a bare body may use.
 *
 * Each issue's own `message` is surfaced verbatim, as the id leg surfaces
 * `manifestIdRefusal`: the strict close's unknown-key sentence is the
 * declaration's, and rewording it here would be a second sentence for one
 * rule.
 */
function installBodyRefusal(body: unknown, unionIssues: ReadonlyArray<InstallBodyIssue>): string {
    const wrapped = body !== null && typeof body === 'object' && 'manifest' in body;
    // The bare branch is the union's own, `PackageInstallManifestSchema` — ⛔ not
    // `ManifestSchema`, which admits the platform scopes this door refuses, so a
    // re-parse through it passed and the bare-form refusal lost its sentence.
    const branch = (wrapped ? PackageInstallRequestSchema : PackageInstallManifestSchema).safeParse(body);
    // By the disjointness above the branch cannot pass where the union failed;
    // if a future union ever made it, the union's own issues still say what
    // was refused rather than an empty sentence.
    const issues: ReadonlyArray<InstallBodyIssue> = branch.success ? unionIssues : branch.error.issues;
    const located = issues
        .map((issue) => `${issue.path.map(String).join('.') || '(body)'}: ${issue.message}`)
        .join('; ');
    const form = wrapped
        ? 'the WRAPPED form, { manifest, …install options }'
        : 'the BARE form, a manifest as the whole body';
    let text = `Invalid package install body (read as ${form}) — ${located}`;
    if (!wrapped) {
        const optionKeys = new Set(
            Object.keys(PackageInstallRequestSchema.shape).filter((key) => key !== 'manifest'),
        );
        const misplaced = issues
            .filter((issue) => issue.code === 'unrecognized_keys' && issue.path.length === 0)
            .flatMap((issue) => issue.keys ?? [])
            .filter((key) => optionKeys.has(key));
        if (misplaced.length > 0) {
            const named = misplaced.map((key) => `\`${key}\``).join(', ');
            const fields = misplaced.map((key) => `"${key}": …`).join(', ');
            text += ` — ${named} ${misplaced.length === 1 ? 'is an install option' : 'are install options'}, `
                + `never a manifest key: send the wrapped form { "manifest": { … }, ${fields} }`
                + (misplaced.includes('overwrite') ? ', or `?overwrite=true` on the query string' : '');
        }
    }
    return text;
}

/**
 * The version the registry's row for a package IS (#17416).
 *
 * `manifest.version` is read FIRST because it is the field the producer
 * actually writes: `SchemaRegistry.installPackage` stores a projection of the
 * manifest, and nothing in the registry populates `installedVersion` — which
 * `packages/spec/src/kernel/package-registry.zod.ts` declares `.optional()` and
 * documents as a mirror («Mirrors manifest.version for quick access»). So the
 * mirror is a fallback for a row some other producer filled in, ⛔ never a
 * tolerated alias for an off-spec spelling: both keys are declared, and a row
 * where they disagree is a producer defect this door cannot repair.
 *
 * Comparison is exact string equality — the same predicate the durable store
 * uses (`AND version = ?` in `@objectstack/service-package`), so the two
 * answers about "is this package at version v" cannot drift into semver range
 * semantics at one of them.
 */
function installedVersionOf(pkg: unknown): string | undefined {
    const src = pkg as { manifest?: { version?: unknown }; installedVersion?: unknown } | null;
    const fromManifest = src?.manifest?.version;
    if (typeof fromManifest === 'string' && fromManifest !== '') return fromManifest;
    const mirror = src?.installedVersion;
    return typeof mirror === 'string' && mirror !== '' ? mirror : undefined;
}

/**
 * The `?enabled=` filter of `GET /api/v1/packages`, read the way the schema
 * that publishes it declares it (commit 0862063ba — ruling item 2 of #17667).
 *
 * ⭐ THE DECLARATION IS THE AUTHORITY, and it is quoted here so the next reader
 * does not have to reconstruct it from this function's behaviour.
 * `ListInstalledPackagesRequestSchema` (`packages/spec/src/api/package-api.zod.ts`)
 * declares — a key commit ada701220 kept rather than retired:
 *
 * ```ts
 *   enabled: z.boolean().optional()
 *     .describe('Filter by enabled state'),
 * ```
 *
 * Four properties are read off that one line, and every one of them is a
 * decision this door would otherwise have had to invent:
 *
 * - **the name** — `enabled`, not `disabled` and not `status`;
 * - **the type** — `z.boolean()`: TWO spellings on the wire and no third. That
 *   is why the coercion is {@link parseBooleanParam} rather than a local
 *   `=== 'true'`: the same declared type on `ListNotificationsRequestSchema.read`
 *   is read by that parser one domain over;
 * - **the default when absent** — there is NONE. `.optional()` with no
 *   `.default()` means an absent key is an absent key, so it has to stay
 *   reachable as `undefined` and must never collapse into `false`;
 * - **absent ≠ an explicit value** — and the difference is load-bearing in the
 *   direction that is easy to get backwards. Absent means NO FILTER (every
 *   row, enabled and disabled alike, which is what this door served before
 *   this card). `enabled=false` is a FILTER and selects the disabled rows
 *   only. The first-party SDK already spells exactly that distinction —
 *   `if (filters?.enabled !== undefined) params.set('enabled', String(filters.enabled))`
 *   in `packages/client/src/index.ts` — so `?enabled=false` is a request this
 *   door receives from a shipped producer, ⛔ not a hypothetical.
 *
 * ⛔ The ruling's own words for this item are 「one filter line, same shape as
 * `status`」. The shape is NOT transferable and this is the one place to say
 * so: `status` is declared `z.enum([…])` and read as `if (query?.status)` plus
 * a string comparison. Applied to a declared BOOLEAN, that truthiness guard
 * and that comparison are wrong twice — the string `'false'` is truthy so the
 * guard admits it, and `p.enabled === 'false'` matches no row at all, so the
 * caller who asked for the disabled half would be handed an empty list with a
 * `200`. The filter is one line; its READ cannot be a copy of `status`'s.
 *
 * ## Multiplicity is answered before the type, by this door's own rule
 *
 * `?enabled=true&enabled=false` is a well-formed request carrying two
 * conflicting intents, and `IHttpRequest.query` declares that array arm. This
 * door already answers that condition for `?version=` with
 * {@link repeatedQueryParamMessage} (#17672), so `enabled` answers it with the
 * same sentence rather than a second one. A ONE-element array is one
 * occurrence encoded differently by an adapter and is unwrapped, and an empty
 * array is no occurrence — both per that rule's own header, which is why this
 * cannot simply hand the raw value to {@link parseBooleanParam} (it refuses
 * every array, `['true']` included).
 *
 * @returns `repeated` for the refusal the caller renders, or `value` carrying
 *          the tri-state filter: `undefined` (no filter), `true`, `false`.
 *          Throws {@link parseBooleanParam}'s declared validation failure —
 *          `400` / `VALIDATION_FAILED` with a `details.fields[]` entry naming
 *          `enabled` — for a spelling the declared type does not admit.
 */
function readEnabledFilter(raw: unknown): { kind: 'repeated'; count: number } | { kind: 'value'; value: boolean | undefined } {
    if (Array.isArray(raw) && raw.length > 1) return { kind: 'repeated', count: raw.length };
    return { kind: 'value', value: parseBooleanParam('enabled', Array.isArray(raw) ? raw[0] : raw) };
}

/**
 * [#23214] The package WRITE doors' single-valued query flags — `?keepData=`
 * on `DELETE /packages/:id`, `?overwrite=` on `POST /packages` — answered the
 * way `enabled` and `version` already are: a name supplied more than once is
 * refused `400` with {@link repeatedQueryParamMessage}, the one sentence this
 * door uses for the condition.
 *
 * Both were read as `query?.<name> === 'true'`, so a repeat — an array, on
 * every adapter that keeps repeats (`plugin-hono-server`'s `readQuery`, and
 * `@objectstack/hono`'s catch-all since this card) — compared unequal and was
 * read as ABSENT. For `keepData` that is the destructive default: the protocol
 * drops object storage unless `keepData === true`, so a caller who asked twice
 * to keep the tables had them dropped, answered `200`. For `overwrite` it
 * turned an overwrite into a `409` whose sentence misnames the cause.
 *
 * A ONE-element array is one occurrence and is unwrapped in place, and an
 * empty one is none (the `status`/`type` rule above). Asked before the
 * registry or the protocol is touched.
 *
 * @returns the refusal to answer, or `null` with `query[name]` left as one value.
 */
function refuseRepeatedWriteFlag(
    deps: DomainHandlerDeps,
    query: any,
    name: 'keepData' | 'overwrite',
): HttpDispatcherResult | null {
    const raw = query?.[name];
    if (!Array.isArray(raw)) return null;
    if (raw.length > 1) {
        return {
            handled: true,
            response: deps.error(repeatedQueryParamMessage(name, raw.length), 400),
        };
    }
    query[name] = raw[0];
    return null;
}

/**
 * [#26857] The closed query set of `POST /packages` (install). **Measured**:
 * `overwrite` alone, the query spelling of the wrapped body's own option;
 * every other install option rides the body (`PackageInstallBodySchema`).
 */
const PACKAGE_INSTALL_QUERY_PARAMS: readonly string[] = Object.freeze(['overwrite']);

/**
 * [#26857] The closed query set of `DELETE /packages/:id` (uninstall).
 * **Measured**: `keepData` alone, the flag that keeps the object tables.
 */
const PACKAGE_DELETE_QUERY_PARAMS: readonly string[] = Object.freeze(['keepData']);

/**
 * [#26713 · #26857] The closed query set of every other package write door —
 * `PATCH /packages/:id`, `…/enable`, `…/disable`, `POST …/publish`,
 * `…/publish-drafts`, `…/discard-drafts`, `…/revert`, `…/rollback`,
 * `…/commits/:commitId/revert`, `…/adopt-orphans` and `…/duplicate`.
 * **Measured**: EMPTY. Each reads the path, the session and the body (an
 * `actor`, a `commitId`, a target id, a manifest patch); none reads a query
 * parameter, and neither does any helper they call.
 */
const PACKAGE_WRITE_NO_QUERY_PARAMS: readonly string[] = Object.freeze([]);

/**
 * [#26713 · #26857] AGENTS.md route rule 5 at the package write doors: a query
 * parameter outside the door's `declared` set is refused `400
 * VALIDATION_ERROR` with the recognition sentence every closed-query door
 * answers ({@link unknownQueryParamRefusalMessage}), in this domain's
 * envelope, as the `/meta` doors write it (#23072). Each door asks it after
 * the capability and wall gates and before the registry or the protocol is
 * read or called, so a refused call deletes, installs or changes nothing.
 * Recognition runs before the arity rule ({@link refuseRepeatedWriteFlag}),
 * which keeps its place on the two doors that declare a flag.
 *
 * Every door ignored the names it does not read. On the draft doors,
 * `publish-drafts?dryRun=true` published the drafts for real (#26713). On
 * uninstall, `?keepdata=true` or `?keep_data=true` was not `keepData`, so
 * the protocol dropped the object tables the caller asked to keep and the
 * door answered `200` (#26857).
 *
 * @returns the refusal to answer, or `null` when the query names nothing outside `declared`.
 */
function refusePackageWriteDoorQuery(
    deps: DomainHandlerDeps,
    query: unknown,
    declared: readonly string[],
): HttpDispatcherResult | null {
    const message = unknownQueryParamRefusalMessage(query, declared);
    if (message === undefined) return null;
    return { handled: true, response: deps.error(message, 400, { code: 'VALIDATION_ERROR' }) };
}

/**
 * Whether a registry row counts as enabled, for {@link readEnabledFilter}'s
 * comparison (commit 0862063ba).
 *
 * `InstalledPackageSchema` (`packages/spec/src/kernel/package-registry.zod.ts`)
 * declares the record's own key `enabled: z.boolean().default(true)`, so a row
 * that carries no `enabled` at all IS enabled by declaration — which is the
 * same read this file already makes at the install door's post-enable
 * reconciliation (`pkg?.enabled === false`). Spelled as that one-sided
 * comparison rather than `p.enabled === want` so the two halves PARTITION the
 * registry: every row answers exactly one of `?enabled=true` / `?enabled=false`
 * and the two results sum to the unfiltered list. `=== want` would drop a row
 * whose `enabled` is absent out of BOTH halves — silently, on a 200.
 */
function packageCountsAsEnabled(pkg: unknown): boolean {
    return (pkg as { enabled?: unknown } | null)?.enabled !== false;
}

export async function handlePackagesRequest(deps: DomainHandlerDeps, path: string, method: string, body: any, query: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
    const m = method.toUpperCase();

    // [#7033 / #7023] Anonymous-deny floor for the WHOLE /packages domain.
    // The same ADR-0056 D2 baseline (#3963) its five sibling dispatcher domains
    // — /meta, /actions, /automation, /ai, /security — already carry and this
    // one lacked: a survey drove a credential-less caller (identity resolved to
    // `principalKind: 'guest'`) straight to a 200 on the destructive
    // discard-drafts and the whole-package export. FIRST statement, ahead of
    // the ObjectQL registry probe below, so an anonymous caller is answered 401
    // before the 503 "Package service not available" and cannot use the
    // 401-vs-503 difference to fingerprint whether the package service is
    // mounted (the same ordering rationale the /automation gate records).
    // `isSystem` (never settable from the wire) and CORS `OPTIONS` preflights
    // pass. Gating the DOMAIN rather than each route is what keeps a newly added
    // package route from arriving ungated.
    {
        const ec: any = _context?.executionContext;
        if (shouldDenyAnonymous({ userId: ec?.userId, isSystem: ec?.isSystem, method: m })) {
            return {
                handled: true,
                response: deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
            };
        }
    }
    // [#24151] The body is read once the floor above has admitted the caller,
    // never ahead of it (`../deferred-request-body.ts`).
    body = readDispatchedBody(body);

    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

    // Try to get SchemaRegistry from the ObjectQL service
    const qlService = await deps.getObjectQL(_context);
    const registry = qlService?.registry;

    // If no registry available, return 503
    if (!registry) {
        return { handled: true, response: deps.error('Package service not available', 503) };
    }

    try {
        // GET /packages → list packages
        if (parts.length === 0 && m === 'GET') {
            const denied = requireReadCapability(deps, _context); if (denied) return denied;
            // [commit 0862063ba] ⭐ THE DOOR READS `enabled` — ruling item 2 of #17667.
            //
            // Read BEFORE the registry, deliberately: a request-shape refusal
            // must not depend on server state (the same ordering argument the
            // `version` gate at the install door records). Placed after the
            // capability gate so an unauthorized caller still cannot use a
            // 400-vs-403 difference to learn anything.
            //
            // `ListInstalledPackagesRequestSchema` has declared this key all
            // along and this door never read it, so a caller filtering an
            // installed-package list by `enabled` was handed the UNFILTERED
            // list with no refusal and no warning — «declared ≠ enforced» in
            // the silent direction (Prime Directive #10), which is the one
            // shape no status, header or field on the answer distinguishes
            // from a request served as asked. {@link readEnabledFilter} is
            // where the declaration is quoted and every semantic read off it
            // is argued; ⛔ do not re-derive them here.
            const enabled = readEnabledFilter(query?.enabled);
            if (enabled.kind === 'repeated') {
                return {
                    handled: true,
                    response: deps.error(repeatedQueryParamMessage('enabled', enabled.count), 400),
                };
            }
            // [#23214] `status` and `type` are each compared with `===` against
            // ONE value below, so a repeat matched no package and the door
            // answered an empty 200, the plausible-looking wrong answer
            // `enabled` above is refused to prevent. Refused the same way, with
            // the same sentence; a one-element array is one occurrence.
            for (const name of ['status', 'type'] as const) {
                const raw = query?.[name];
                if (!Array.isArray(raw)) continue;
                if (raw.length > 1) {
                    return {
                        handled: true,
                        response: deps.error(repeatedQueryParamMessage(name, raw.length), 400),
                    };
                }
                query[name] = raw[0];
            }
            let packages = registry.getAllPackages();
            // Apply optional filters
            if (query?.status) {
                packages = packages.filter((p: any) => p.status === query.status);
            }
            if (query?.type) {
                packages = packages.filter((p: any) => p.manifest?.type === query.type);
            }
            // Absent is absent: `undefined` means NO filter and every row
            // stays, which is what this door served before this card and what
            // `.optional()` with no `.default()` declares.
            if (enabled.value !== undefined) {
                packages = packages.filter((p: any) => packageCountsAsEnabled(p) === enabled.value);
            }
            // [#14375] Every row carries the server's own writability verdict
            // (see `withWritableVerdict`) — copies, so the registry records the
            // filters above selected stay untouched.
            //
            // [#14309] ORDER IS LOAD-BEARING: project FIRST, stamp the verdict
            // onto the projection SECOND. `toPackageResponse` is an allowlist of
            // the DECLARED record fields, and `writable` is not one of them — it
            // is this door's own computed answer. Stamped first, the projection
            // would delete it, and the deletion would be silent: a 200 with the
            // field simply absent. `withWritableVerdict` reads only
            // `manifest.id`, which the projection keeps, so it is indifferent to
            // running second. Pinned in `packages-serializable-response.test.ts`
            // so a future reorder is a red test rather than a missing field.
            // [#28318] `disableable` (see `withDisableableVerdict`) is stamped
            // the same way, after the projection, for the same reason.
            const rows = packages.map(
                (p: any) => withDisableableVerdict(qlService, withWritableVerdict(qlService, toPackageResponse(p) as any)),
            );
            // [#16781] `hasMore` is REQUIRED by
            // `ListInstalledPackagesResponseSchema` and this door did not send
            // it, so the payload it served could not parse through its own
            // declared contract. Reconciled toward the SPEC (protocol is the
            // baseline), additively — nothing that was on this wire left it.
            //
            // The value is a constant `false` because it is TRUE, not because
            // it is convenient: this door applies the `status` / `type` /
            // `enabled` filters and then returns every remaining row. It reads no
            // `limit` and no `cursor`, so there is never a next page to
            // announce and `nextCursor` (optional) stays absent. If this route
            // ever starts paginating, `hasMore` is the key that has to start
            // telling the truth — which is exactly why it is declared.
            return { handled: true, response: deps.success({ packages: rows, total: rows.length, hasMore: false }) };
        }

        // POST /packages → install package.
        // Route through the canonical `protocol.installPackage` primitive so
        // the install lands in BOTH the in-memory registry (what this list/detail
        // reads) AND the durable `sys_packages` table. Fall back to the bare
        // registry write only when the protocol service/method is unavailable.
        if (parts.length === 0 && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, 'Installing a package');
            if (walled) return walled;
            // [#26857] Recognition first, over the measured closed set, ahead of
            // the body parse and the registry read.
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_INSTALL_QUERY_PARAMS); if (queryRefused) return queryRefused;
            // [#19328] ⭐ THE DOOR PARSES THE WHOLE BODY — once, here, through
            // the union `@objectstack/spec` declares for it
            // (`PackageInstallBodySchema`: the wrapped request, or a bare
            // manifest as the whole body).
            //
            // Until this line the door parsed two legs of the manifest (`id`,
            // `version`) and read everything else positionally off the raw
            // body, so four classes the declaration refuses still answered
            // `201`: a manifest with no `type`; an unknown key inside the
            // manifest or on a bare body (stored with the package); a
            // string-typed `enableOnInstall` / `overwrite` (`'false'` matched
            // neither `=== true` nor `=== false` and installed a fresh id
            // ENABLED — the caller's intent inverted, not merely dropped); and
            // install options spelled on the bare form, which the handler
            // honoured or ignored key by key (`overwrite` and `settings`
            // honoured, `enableOnInstall` ignored, all three stored as
            // manifest keys). The two legs' own comments named the one call
            // that closes all four; this is it.
            //
            // The ruling is 基本裁决原则 —「声明而未兑现是实现缺口,补实现或退役,
            // ⛔ 不在消费端收窄」— and making a door parse what its schema
            // ALREADY declares is 拉回已声明契约, ⛔ not 扩大接受集. ⛔ Nothing in
            // `packages/spec` moves, and neither branch is relaxed: the
            // declaration's own docblock forbids it («a caller that needs an
            // option sends the wrapped form»).
            //
            // ⭐ The TOP LEVEL of the wrapped form is closed too — by the
            // declaration, not by this door. `PackageInstallRequestSchema` is a
            // `strictObject` (ruling record `5856869656`, decision batch #227
            // item 3, letter A), so an unknown top-level key such as
            // `{ manifest, enabledOnInstall: false }` fails the union by name,
            // and this door answers `400` / `VALIDATION_ERROR` and installs
            // nothing — with no line of its own for it: reading only parsed
            // keys, it does exactly what the declaration says. ⛔ Never refuse or
            // admit a key here that the declaration decides the other way: the
            // published contract and this door would then answer differently,
            // and which keys the body may carry is the declaration's decision.
            //
            // The verdict is answered after the `id` and `version` legs below,
            // which keep their own published sentences; every later read (the
            // form, `overwrite`, `settings`, `enableOnInstall`) goes through
            // the parsed value, never the raw body.
            const declaredBody = PackageInstallBodySchema.safeParse(body);
            const manifest = body.manifest || body;
            const pkgId = typeof manifest?.id === 'string' ? manifest.id.trim() : '';
            // A package id is mandatory — without one the install cannot be keyed.
            if (!pkgId) {
                return { handled: true, response: deps.error('Package id is required', 400) };
            }
            // [#19417] ⭐ THE DOOR PARSES THE `id` LEG — the declaration, by
            // reference, exactly as the `version` leg below is parsed.
            //
            // `MANIFEST_ID_PATTERN` (`packages/spec/src/kernel/manifest.zod.ts`)
            // is the reverse-domain rule declared ONCE and referenced by BOTH
            // faces of this identity — `ManifestSchema.id`, what an author
            // writes, and `PackageSchema.manifestId`, what the registry stores
            // and publishes by. This door read `manifest.id` POSITIONALLY and
            // parsed nothing, so `id: 'pkg-a'` installed and answered `201`
            // while `defineStack()`, `os build`, `os validate` and the publish
            // face all refused the same id. The author got a package that could
            // never be rebuilt or published — «declared ≠ enforced» on a
            // PUBLISHED API contract, the shape Prime Directive #10 refuses
            // outright, and the failure 北极星 clause 4 names in as many words:
            // 「错的必须被**响亮拒绝**并给处方,**永不静默落库**」.
            //
            // The authorising ruling is 基本裁决原则 —「声明而未兑现是实现缺口,
            // 补实现或退役,⛔ 不在消费端收窄」— and by the mechanical boundary
            // test, making a door parse what its schema ALREADY declares is
            // 拉回已声明契约, ⛔ not 扩大接受集. Nothing in `packages/spec` moves
            // for this; the declaration was already right.
            //
            // ⭐ THE SENTENCE IS THE DECLARATION'S, NOT THIS FILE'S. The issue
            // message is SURFACED rather than reworded: `manifestIdRefusal`
            // names the key, echoes the value the author wrote, lists the
            // examples, and carries a suggestion arm that VERIFIES its candidate
            // against the pattern before offering it. Rewording it here would
            // have produced a fourth sentence for one rule and dropped the
            // repair.
            //
            // SCOPE — THE `id` LEG, with its own sentence. The rest of the body
            // (a missing `type`, unknown keys, a string-typed
            // `enableOnInstall`/`overwrite`, install options spelled on the
            // bare form) is judged by the whole-body parse below, which runs
            // after this leg and the `version` one so that neither published
            // sentence is displaced by a less specific one (#19328).
            //
            // ⭐ ORDERED AFTER THE `!pkgId` GATE, DELIBERATELY — and that is a
            // decision, because `''` fails the pattern too. Left of this gate,
            // an absent id would stop printing `Package id is required` and
            // start printing `Invalid package id ''`, which is the ONE input
            // where the refusal's suggestion arm has nothing to offer: a
            // PUBLISHED message replaced by a weaker one, for a body this door
            // already refused. The gate below therefore narrows the ACCEPT SET
            // only. `packages-install-manifest-version.test.ts` pins the same
            // precedence for the version leg («no id means no sentence this gate
            // could print»), and the artifact path's DOOR-1 precedent is not
            // this door: there the schema parse is the FIRST door, with no
            // published `required` sentence ahead of it to displace.
            //
            // ⭐ ORDERED BEFORE THE `version` GATE, for that same reason read
            // one key over: the version refusal's sentence NAMES the id
            // («add it to the manifest for '<id>'»). Prescribing a repair for a
            // package id that can never be legal sends the author round twice.
            //
            // ⛔ THE RAW VALUE IS PARSED, not `pkgId`. The trim above keys the
            // package; it must not also launder the id past its own rule, or
            // `'  com.acme.crm  '` would keep installing a manifest whose stored
            // `id` the declaration refuses. Downstream this makes the trim a
            // no-op by construction — the pattern admits no whitespace — so
            // every accepted path now has `pkgId === manifest.id`.
            //
            // ⛔ HTTP-DOOR-ONLY BY CONSTRUCTION, as the version leg is:
            // boot-time and in-process installs reach
            // `SchemaRegistry.installPackage` / `registerApp` directly and never
            // pass through this branch.
            const rawId = (manifest as any)?.id;
            const declaredId = ManifestSchema.shape.id.safeParse(rawId);
            if (!declaredId.success) {
                const [issue] = declaredId.error.issues;
                return {
                    handled: true,
                    response: deps.error(
                        issue?.message || manifestIdRefusal('manifest.id', rawId),
                        400,
                    ),
                };
            }
            // [#19120] ⭐ THE DOOR PARSES THE `version` LEG — the declaration,
            // by reference.
            //
            // `PackageInstallRequestSchema` binds `manifest: ManifestSchema`,
            // and `ManifestSchema` declares `version` REQUIRED with a semantic
            // grammar. This door parsed nothing at all: a manifest with no
            // `version` installed and answered `201`. That is «declared ≠
            // enforced» on a PUBLISHED API contract — the shape Prime Directive
            // #10 refuses outright — and it is the failure 北极星 clause 4 names
            // in as many words: 「错的必须被**响亮拒绝**并给处方,**永不静默落库**」.
            // So the refusal is loud and carries the prescription.
            //
            // The ruling that authorises it is 基本裁决原则 —
            // 「声明而未兑现是实现缺口,补实现或退役,⛔ 不在消费端收窄」 — and by
            // the mechanical boundary test, making a door parse what its schema
            // ALREADY declares is 拉回已声明契约, ⛔ not 扩大接受集. Nothing in
            // `packages/spec` moves for this; the declaration was already right.
            //
            // SCOPE — THE `version` LEG, with its own sentence. It keeps its
            // prescription («add it to the manifest for '<id>'») ahead of the
            // whole-body parse below, which judges everything else (#19328).
            //
            // ⛔ HTTP-DOOR-ONLY BY CONSTRUCTION. Boot-time and in-process
            // installs reach `SchemaRegistry.installPackage` / `registerApp`
            // directly and never pass through this branch, so what tightens is
            // the published wire contract and nothing else.
            //
            // ⭐ ORDERED BEFORE THE 409, DELIBERATELY. A request-shape refusal
            // must not depend on server state: placed after the duplicate check,
            // one and the same under-specified body would answer `400` or `409`
            // according to whether that id happened to be installed already —
            // two different answers to one authoring mistake. The id gate above
            // still wins, because without an id there is nothing to name in the
            // sentence this gate prints.
            const declaredVersion = ManifestSchema.shape.version.safeParse((manifest as any)?.version);
            if (!declaredVersion.success) {
                return {
                    handled: true,
                    response: deps.error(
                        `manifest.version is required and must be semantic (major.minor.patch, e.g. "1.0.0") — `
                        + `add it to the manifest for '${pkgId}' and retry`,
                        400,
                    ),
                };
            }
            // [#19328] The whole-body verdict, parsed at the top of this branch,
            // answered here: after the two legs whose sentences it must not
            // displace, and — like them — ahead of the 409, so a request-shape
            // refusal never depends on whether the id happens to be installed.
            // Same envelope as those two legs: `400`, whose standard member is
            // `VALIDATION_ERROR`; ⛔ no code is minted for it.
            if (!declaredBody.success) {
                return {
                    handled: true,
                    response: deps.error(installBodyRefusal(body, declaredBody.error.issues), 400),
                };
            }
            // Every option below is read off the PARSED request, and only when
            // the body arrived in the wrapped form — the one form that declares
            // options. The bare branch has none to read: it refused them above.
            const request = 'manifest' in declaredBody.data ? declaredBody.data : undefined;
            // Duplicate-detection: POST /packages CREATES a package. If one with
            // this id already exists, silently overwriting it destroys the existing
            // manifest (name/version/…) with no warning — a data-loss footgun
            // surfaced in Studio package-create dogfooding. Reject with 409 Conflict
            // instead. Intentional upgrade / re-install flows opt back in with
            // `overwrite: true` (wrapped body) or `?overwrite=true` (either form).
            // [#23214] A repeated `?overwrite=` is refused here, ahead of the
            // 409 and the registry read (`refuseRepeatedWriteFlag`).
            const repeatedOverwrite = refuseRepeatedWriteFlag(deps, query, 'overwrite');
            if (repeatedOverwrite) return repeatedOverwrite;
            const overwrite =
                request?.overwrite === true || query?.overwrite === 'true' || query?.overwrite === true;
            if (!overwrite && registry.getPackage(pkgId)) {
                return {
                    handled: true,
                    response: deps.error(`Package '${pkgId}' already exists`, 409),
                };
            }
            // [#24030] ADR-0070 D2 — the READ-ONLY gate, asked for the manifest's
            // id before either install limb below writes. `overwrite` only ever
            // bypassed the 409 above; nothing asked whether the id is a package
            // the deployment ships, so an overwrite over a code-booted or
            // marketplace-installed id answered 201, replaced its registry row
            // with an authored one (and, on the protocol limb, wrote its
            // `sys_packages` row) while `engine.manifests` kept judging it
            // read-only. Disable, publish, revert and delete refuse that id with
            // this same answer; ⛔ the rule is not re-derived here — it is
            // {@link requireWritablePackage}, i.e. {@link isWritablePackage}.
            //
            // Placed AFTER the 409, so an install that does not ask to overwrite
            // keeps its 409 answer for any existing id. An id nothing installed
            // is writable by the predicate's own rule, so a fresh install —
            // `overwrite` set or not — answers as before.
            const readOnly = requireWritablePackage(deps, qlService, pkgId, overwrite ? 'overwrite' : 'install');
            if (readOnly) return readOnly;
            // [ADR-0146 D3] A paired customization package id (`<base>.custom`)
            // installs only with what its ensure door writes — the base's pair
            // namespace, explicit, and the dependency on the base — or it is
            // refused `400` naming that door. Asked here, ahead of BOTH limbs,
            // because the no-protocol fallback never reaches the primitive,
            // which asks the same predicate; ⛔ never a second copy of the rule.
            // An exported pair declaring both installs, and ADR-0141 D2 judges
            // its range below.
            const pairRefusal = customizationPairManifestRefusal(manifest, (id) => registry.getPackage(id));
            if (pairRefusal !== undefined) {
                return { handled: true, response: deps.error(pairRefusal, 400) };
            }
            // ⚠️ The MANIFEST handed on is the one the caller sent, ⛔ not the
            // parsed copy. `ManifestSchema` applies defaults at parse time
            // (`scope`, `defaultDatasource`), and this door has always stored
            // what it was sent — a key-by-key copy, no defaults, which is what
            // `withWritableVerdict`'s header records about a Studio-created
            // base. The parse is a GATE here, not a normaliser: once it passed,
            // the sent manifest carries no top-level key the manifest's strict
            // close refuses. (A nested shape the declaration leaves in strip
            // mode is stored as sent — unchanged by this gate, and not a class
            // this door answers for.)
            const settings = request?.settings;
            let pkg: any;
            const protocolSvc = await resolveProtocol(deps, _context).catch(() => null);
            try {
                if (protocolSvc && typeof protocolSvc.installPackage === 'function') {
                    const out = await protocolSvc.installPackage({ manifest, settings });
                    pkg = out?.package ?? out;
                } else {
                    // [#21727] The no-protocol fallback runs the SAME ADR-0087
                    // D1 handshake the protocol primitive runs before its
                    // registry write (`installPackage` in
                    // `@objectstack/metadata-protocol`). Without it, a
                    // composition with no `protocol` service installed a
                    // package whose declared range excludes this runtime, which
                    // the composed door refuses. The default warn hook matches
                    // the primitive's, so no-range and unparsed ranges warn the
                    // same way on both arms.
                    assertProtocolCompat(manifest);
                    // ADR-0141 D2 — and the SAME pre-install dependency check,
                    // through the one predicate, before the registry write:
                    // this arm is an install act exactly as the primitive is.
                    assertDeclaredDependencies({
                        delivered: [manifest],
                        getInstalled: (id) => registry.getPackage(id) as InstalledDependencyRecord | undefined,
                    });
                    // [#23972] The same origin the protocol primitive stamps:
                    // a package installed through this door is authored.
                    pkg = registry.installPackage(manifest, 'authored', settings);
                }
            } catch (err) {
                // [#21727] The protocol refusal's typed carrier, recognised
                // BEFORE the generic catch: the #9585 `FlowActionRefusal`
                // idiom (`domains/actions.ts`), ruled for this card by triage.
                // The shared `resolveThrownHttpError` builds `details` from a
                // closed list that drops a thrown `.diagnostic` (#8016, #9106,
                // #9585), so this branch carries ADR-0087 D1's structured
                // diagnostic itself. Every other throw rethrows to the generic
                // catch unchanged.
                if (isProtocolIncompatibleError(err)) {
                    // [#21762] The shared answer, in this door's envelope:
                    // `code` rides `details` into the promotion slot, so it
                    // lands in `error.code` (ADR-0112 D5) and `error.details`
                    // carries the answer's five members and nothing else.
                    const refusal = protocolIncompatibleAnswer(err);
                    return {
                        handled: true,
                        response: deps.error(refusal.message, refusal.status, { code: refusal.code, ...refusal.details }),
                    };
                }
                // ADR-0141 D2's refusal, recognised the same way and for the
                // same reason: the shared resolver would pass its `issues`
                // through but drop the per-entry facts (`unmet`) a Console
                // renders its text from. Both arms above reach it — the
                // primitive throws it, and the fallback runs the same check.
                if (isDependencyMissingError(err)) {
                    const refusal = dependencyMissingAnswer(err);
                    return {
                        handled: true,
                        response: deps.error(refusal.message, refusal.status, { code: refusal.code, ...refusal.details }),
                    };
                }
                throw err;
            }
            // [#18058 → #18877] HONOUR `enableOnInstall`, which this door declared
            // and ignored. `PackageInstallRequestSchema` has carried
            // `enableOnInstall` since it was written, the first-party SDK SENDS
            // it (`client.packages.install(m, { enableOnInstall: false })`,
            // pinned in `client.test.ts`), and NO server-side handler read the
            // key — an author switched it off and the runtime installed the
            // package enabled anyway, silently. That is «declared ≠ enforced» on
            // a published option, the exact shape Prime Directive #10 refuses.
            //
            // ⭐ [#18877] 「缺省 = 保持，有旗 = 设置」 — the install contract, ruled
            // in maintainer batch #157 item 5 letter C. BOTH arms of the flag
            // now move the registry, through the SAME calls
            // `PATCH /packages/:id/enable` and `PATCH /packages/:id/disable`
            // use, and an ABSENT flag makes NO lifecycle call at all:
            //
            //   true    ⇒ enablePackage    (the flag is the author's request,
            //                               and on an existing row nothing else
            //                               will enable it any more —
            //                               `installPackage` preserves the row's
            //                               state since #18877)
            //   false   ⇒ disablePackage
            //   absent  ⇒ nothing; the row the registry returned stands
            //
            // ⚠️ The `true` arm is not decoration. Before #18877 it needed no
            // flip because `installPackage` restamped every row `enabled` on
            // overwrite; now that the row's own lifecycle state is carried over,
            // dropping this arm would silently stop honouring `true` on exactly
            // the path an upgrade takes — the same «declared ≠ enforced» defect
            // #18058 closed, pointing the other way.
            //
            // ⚠️ Read from the PARSED WRAPPED request alone (#19328). In the
            // BARE form the key would be a manifest key, which `ManifestSchema`'s
            // strict close refuses by name — so a bare body carrying the key
            // never reaches this line, and every bare body that does reach it
            // is 「缺省」: it preserves.
            //
            // ⭐ The parse is what makes the three states exact. Read off the
            // raw body, `enableOnInstall: 'false'` was a string that matched
            // neither arm below and fell through to 「缺省」 — a fresh id
            // installed ENABLED against the caller's spelled intent. The
            // declaration types the key `z.boolean().optional()`, so that body
            // is refused above and every value that reaches here is `true`,
            // `false`, or absent.
            //
            // ⚠️ `=== true` / `=== false`, never a truthiness test and never a
            // `??` default: the THREE states of this key are the contract, and
            // collapsing absent into either one is the defect #18877 fixed. The
            // declaration carries no `.default()` for the key, so absence
            // survives the parse and is read as absence.
            const requestedEnabled = request?.enableOnInstall;
            if (requestedEnabled === true) {
                const enabled = registry.enablePackage(pkgId);
                if (enabled) pkg = enabled;
            } else if (requestedEnabled === false) {
                const disabled = registry.disablePackage(pkgId);
                if (disabled) pkg = disabled;
            }
            // ⭐ The DURABLE half, and it follows THE ROW THIS DOOR RETURNED —
            // never the request's intent. Written unconditionally rather than
            // only on the overwrite path: "was this id installed a moment ago"
            // is not the question — "does the durable record agree with the row
            // this door just returned" is, and that is one call either way.
            //
            // Both directions of that disagreement are silent durability
            // defects of the kind Prime Directive #10 and the degradation-log
            // rules name — correct on the wire, wrong after a restart — and
            // persisting the REQUEST closes only the first:
            //
            //   ① answered `enabled: true`, disk still says disabled. `POST
            //     /packages` is a CREATE an already-installed id reaches
            //     through `overwrite`, so the id may already be listed from an
            //     earlier install. The next boot re-installs it DISABLED.
            //     (`DELETE /packages/:id` did not clear this record either,
            //     until #18877's item 3 below made the delete arm do it.)
            //   ② answered `enabled: false`, disk cleared. A flag-absent install
            //     of a package an operator disabled before a restart returned
            //     `enabled: false` while the request's presumed intent erased
            //     the disable from disk. The next boot brought it back ENABLED.
            //
            // `pkg.enabled` is the one value that cannot be out of step with
            // either, because it IS the row being served. It is read AFTER the
            // flag arms above, and on both install arms it is the registry's own
            // `InstalledPackage` (the protocol service returns `{ package }`
            // straight out of `registry.installPackage`), so `=== false` is
            // `!pkg.enabled` on every reachable row — the spelling only keeps a
            // degenerate rowless return from writing a disable nobody asked for.
            //
            // ⭐ [#18877] This is also why the 「缺省 = 保持」 rule needs no second
            // durable rule. The row now carries the preserved state, and the
            // disk follows the row, so 「保持」 reaches disk for free — a
            // flag-absent overwrite re-writes the same value the operator's last
            // explicit action left there. #18058's «每一次 install 都持久化它返回
            // 的状态» is unchanged; what changed is which state that is.
            //
            // Same best-effort try/catch as `PATCH /packages/:id/enable` below:
            // the in-memory install already succeeded, so a state-file failure
            // must not turn a 201 into a 500.
            const rowDisabled = pkg?.enabled === false;
            try {
                setPackageDisabled(_context?.environmentId, pkgId, rowDisabled);
            } catch (err) {
                console.warn('[handlePackages] failed to persist enableOnInstall', { id: pkgId, disabled: rowDisabled, error: (err as Error)?.message });
            }
            const res = deps.success(pkg);
            res.status = 201;
            return { handled: true, response: res };
        }

        // PATCH /packages/:id/enable
        if (parts.length === 2 && parts[1] === 'enable' && m === 'PATCH') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, `Enabling package "${id}"`);
            if (walled) return walled;
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_WRITE_NO_QUERY_PARAMS); if (queryRefused) return queryRefused;
            const pkg = registry.enablePackage(id);
            if (!pkg) return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            try {
                setPackageDisabled(_context?.environmentId, id, false);
            } catch (err) {
                console.warn('[handlePackages] failed to persist enable state', { id, error: (err as Error)?.message });
            }
            return { handled: true, response: deps.success(pkg) };
        }

        // PATCH /packages/:id/disable
        if (parts.length === 2 && parts[1] === 'disable' && m === 'PATCH') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, `Disabling package "${id}"`);
            if (walled) return walled;
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_WRITE_NO_QUERY_PARAMS); if (queryRefused) return queryRefused;
            // [#7560] ADR-0070: a platform package is not the operator's to
            // switch off. BEFORE `disablePackage`, and before
            // `setPackageDisabled` writes the choice to disk — a disable that
            // lands is not undone by a restart, it is REPLAYED by one.
            // [#28117] One exemption, for THIS verb only: a module of an
            // installed app is the customer admin's to switch off
            // ({@link isDisableableAppModule}). Every other door below still
            // asks `requireWritablePackage` alone, so the module stays
            // read-only for authoring. [#28318] Asked through
            // `isDisableablePackage`, the predicate the read doors serve as
            // `disableable`, so the row's verdict and this door cannot differ.
            const readOnly = isDisableablePackage(qlService, id)
                ? null
                : requireWritablePackage(deps, qlService, id, 'disable');
            if (readOnly) return readOnly;
            const pkg = registry.disablePackage(id);
            if (!pkg) return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            try {
                setPackageDisabled(_context?.environmentId, id, true);
            } catch (err) {
                console.warn('[handlePackages] failed to persist disable state', { id, error: (err as Error)?.message });
            }
            return { handled: true, response: deps.success(pkg) };
        }

        // POST /packages/:id/publish → publish package metadata
        if (parts.length === 2 && parts[1] === 'publish' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, `Publishing package "${id}"`);
            if (walled) return walled;
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_WRITE_NO_QUERY_PARAMS); if (queryRefused) return queryRefused;
            // [#22113] ADR-0070 D2: a code or installed package is read-only, so
            // this door refuses it BEFORE `publishPackage`, which would otherwise
            // snapshot and re-register the package's items as published (measured:
            // a platform package's objects, and the showcase's capabilities, at
            // 200). The metadata service has no package-kind concept to refuse
            // with; the door's one predicate does. An organization overlay draft
            // on a code package is not published here: it is a `sys_metadata` row
            // the protocol publishes through `publish-drafts` and the per-item
            // publish door, neither of which passes this branch.
            const readOnly = requireWritablePackage(deps, qlService, id, 'publish'); if (readOnly) return readOnly;
            const metadataService = await deps.getService(_context, CoreServiceName.enum.metadata);
            if (metadataService && typeof (metadataService as any).publishPackage === 'function') {
                const result = await (metadataService as any).publishPackage(id, body || {});
                return { handled: true, response: deps.success(result) };
            }
            return { handled: true, response: deps.error('Metadata service not available', 503) };
        }

        // POST /packages/:id/publish-drafts → promote every pending DRAFT
        // bound to the package to active in one shot ("publish whole app",
        // ADR-0033). Routes through protocol.publishPackageDrafts (which
        // reuses the per-item publish primitive) — no metadata service
        // dependency, unlike /publish above.
        if (parts.length === 2 && parts[1] === 'publish-drafts' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, `Publishing the drafts of package "${id}"`);
            if (walled) return walled;
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_WRITE_NO_QUERY_PARAMS); if (queryRefused) return queryRefused;
            const protocol = await resolveProtocol(deps, _context);
            if (protocol && typeof protocol.publishPackageDrafts === 'function') {
                // [#26708] An id no installed package has is refused BEFORE
                // anything is published — see `packageIsUnknown`. After the
                // capability probe, as its siblings: a host that cannot
                // publish answers 501 whatever id it is asked about.
                if (packageIsUnknown(registry, id)) {
                    return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
                }
                // [#28452] The note is parsed with the declaration's own
                // member, `PublishPackageDraftsRequestSchema.shape.message`,
                // and a note it refuses (a number, an object, an array,
                // `null`) is refused here `400` (`VALIDATION_ERROR`, derived
                // from the status as the install door's legs derive it) before
                // anything is published. It used to be dropped, so the publish
                // went ahead and every history row recorded the default note,
                // and the caller never learnt its note was ignored.
                //
                // ⛔ Only `message` is judged here. `backfill` keeps its one
                // refusal, the protocol's shape judgement below (same status,
                // code and `issues[]` as before); parsing it here too would be a
                // second judge with a second sentence. Unknown keys are not
                // read at all, so a body `actor` (the SDK's deprecated
                // `opts.actor`) still publishes. Placed beside that backfill
                // judgement, after the 404, so both body-member refusals sit at
                // one point of the door's order.
                const declaredMessage = PublishPackageDraftsRequestSchema.shape.message.safeParse(body?.message);
                if (!declaredMessage.success) {
                    const located = declaredMessage.error.issues
                        .map((issue) => `message: ${issue.message}`)
                        .join('; ');
                    return {
                        handled: true,
                        response: deps.error(
                            `Invalid publish-drafts body — ${located}. Nothing was published: \`message\` is the `
                            + 'change note every history row of this publish records; send it as a string, or leave '
                            + 'it out to record the sentence naming the package.',
                            400,
                        ),
                    };
                }
                try {
                    // [ADR-0146 D1] Who published: the identity this request
                    // was authorized as, never a name the body supplies — see
                    // `resolvePackageWriteActor`. A body `actor` is ignored.
                    const actor = resolvePackageWriteActor(_context);
                    const result = await protocol.publishPackageDrafts({
                        packageId: id,
                        ...(actor !== undefined ? { actor } : {}),
                        // [ADR-0146 D1] The author's change note: the package
                        // commit and every item history row this publish writes
                        // carry it. The parsed value: a string, or absent.
                        ...(declaredMessage.data !== undefined ? { message: declaredMessage.data } : {}),
                        // [#24253] Passed through as sent: the protocol judges
                        // its shape and what it names, and refuses the whole
                        // request before anything is published.
                        ...(body?.backfill !== undefined ? { backfill: body.backfill } : {}),
                        // THIS caller's execution context, never a system one:
                        // the backfill writes run as it, and [#25484] so do the
                        // build probes' dashboard-widget reads — the renderer's
                        // path, so a widget the caller can read is not reported
                        // broken and one the caller cannot read still is.
                        ...(_context?.executionContext !== undefined
                            ? { context: _context.executionContext }
                            : {}),
                    });
                    // Publishing a `seed` draft is what actually loads its
                    // rows. The objectql protocol now batch-applies seeds
                    // inside `publishPackageDrafts` itself (so EVERY publish
                    // path — incl. the per-ref REST publish — materializes
                    // data) and reports under `seedApplied`. Only fall back
                    // to the route-level apply for custom protocols that
                    // don't self-apply — never run both, or an externalId-less
                    // seed would double-insert.
                    if ((result as any)?.seedApplied === undefined) {
                        try {
                            const seedNames = ((result as any)?.published ?? [])
                                .filter((p: any) => p?.type === 'seed')
                                .map((p: any) => p.name as string);
                            if (seedNames.length > 0) {
                                (result as any).seedApplied = await applyPublishedSeeds(deps, 
                                    seedNames,
                                    _context,
                                );
                            }
                        } catch (e: any) {
                            // [#8443] ADR-0112: `seedApplied.error` rides on a
                            // **200** publish response as DATA, so no HTTP
                            // boundary's 5xx message withhold can reach it —
                            // the same argument #8333's P9 makes about this
                            // door's twin inside `metadata-protocol`, which
                            // this fallback is a second copy of. Measured on
                            // `origin/main` before the change: the loader's
                            // dependency-graph read (`metadata.getObject`) is
                            // unguarded, so a `sys_metadata` outage escaped
                            // `applyPublishedSeeds` and this catch answered
                            // `"error": "SQLITE_ERROR: no such table:
                            // sys_metadata"` on a 200.
                            //
                            // The rule is IMPORTED, never re-spelled: quote the
                            // caught sentence only when the error declared
                            // itself a 4xx client refusal. The other population
                            // this catch receives — a malformed seed body —
                            // declares itself 422 at the `safeParse` inside
                            // `applyPublishedSeeds`, so the author still gets
                            // the curated issue summary.
                            (deps.logger ?? console).warn(
                                `[handlePackages] seed apply failed: ${e?.message ?? e}`,
                            );
                            (result as any).seedApplied = {
                                success: false,
                                error: clientFacingFailureText(e, 'seed apply failed'),
                                // [#10524] The declared 422's structured
                                // findings ride beside the headline `error` —
                                // `seedRequestValidationError`'s message is a
                                // one-sentence headline now, and `issues` is
                                // where the per-key prose reaches the author.
                                // `issues` is structured authoring feedback
                                // only the declared refusal attaches; no
                                // driver error carries it (the #8441
                                // measurement), so this routes nothing
                                // undeclared around the withhold above.
                                ...(Array.isArray((e as any)?.issues)
                                    ? { issues: (e as any).issues }
                                    : {}),
                            };
                        }
                    }
                    // ADR-0045 §3: "Publish" makes the package live AND visible.
                    // A materialized (additive) build has no drafts left to
                    // promote — its app sits at `_unpublished: true` awaiting the
                    // visibility flip. Clear the gate on every unpublished app
                    // bound to this package so ONE publish verb serves both
                    // regimes (the caller never needs to know how the package was
                    // built). Best-effort: a custom protocol without the meta
                    // primitives keeps plain draft-publish semantics.
                    //
                    // ⛔ #4829 — the gate is `_unpublished`, the MACHINE-managed
                    // key, and this is the point that clears it. It used to be
                    // `hidden`, which also means "keep out of the App Switcher"
                    // to every author — so publishing a package silently rewrote
                    // a presentation choice, and the REST gate reading the same
                    // flag 404'd the built-in `account` app for every non-builder.
                    // `hidden` is now never read or written here.
                    //
                    // #5242 — `flipped` and its result assignment live OUTSIDE
                    // this try. A name is pushed only AFTER its `saveMetaItem`
                    // resolved, so at any moment the list is exactly "what is
                    // already flipped on disk". When app k of N throws, the k-1
                    // that DID persist are a fact the caller must be told about:
                    // accumulating inside the try and assigning after the loop
                    // discarded them with the stack, so the response claimed
                    // nothing happened for apps that had already changed state,
                    // and the 'metadata:reloaded' announce below — which reads
                    // `unhiddenApps` — skipped them too, leaving boot-cached
                    // consumers stale until the next restart.
                    //
                    // The RESPONSE field keeps its `unhiddenApps` / `unhideError`
                    // spelling deliberately and PERMANENTLY: it is a wire contract
                    // read by the objectui Publish button, and renaming it here —
                    // in a repo that cannot verify or update that consumer — would
                    // be a silent break of the exact kind #4829 is about. A
                    // lockstep rename was once planned to ride the objectui
                    // follow-up card, together; #6955 measured that "together" out
                    // rather than in — the server still emits these names and
                    // objectui reads neither field anywhere (zero grep hits
                    // repo-wide) — so the PM ratified "not at all" as option A:
                    // renaming a zero-reader diagnostic payload buys no capability
                    // (startup-scope discipline). If the vocabulary is ever worth
                    // tidying on its own merits, that is a standalone
                    // producer-side rename card (option B), not a rider on this
                    // one.
                    //
                    // [#7018 / the #6190 ruling, Option A] this flip carries
                    // no organization — every metadata write lands env-wide
                    // (ADR-0131 D6), on the
                    // very row boot hydrates and the App Switcher reads. An
                    // org-scoped flip was a phantom: the app looked published for
                    // the life of the process and went back to `_unpublished:
                    // true` on the next restart, because the env-wide row it left
                    // untouched is the only one cold boot loads. The
                    // `getMetaItems` read below is env-wide for the same
                    // reason, and by construction: [ADR-0131 D6] every
                    // metadata read is environment → code, and this route
                    // hands it no organization at all.
                    //
                    // ⛔ Dropping it is the REPAIR, not an oversight to undo.
                    // An org-scoped `app` row is an unhydratable phantom —
                    // `loadMetaFromDb` walks past it, and
                    // `reportUnhydratableOrgScopedRows` exists to say so — so
                    // an org-aware read here would resurrect rows that vanish
                    // at the next restart and flip `_unpublished` on them
                    // instead of on the row cold boot hydrates. Read scope and
                    // write scope now answer one question through one registry
                    // flag; ⛔ never "restore" the organization to this read.
                    const flipped: string[] = [];
                    try {
                        if (
                            typeof protocol.getMetaItems === 'function' &&
                            typeof protocol.saveMetaItem === 'function'
                        ) {
                            const appsRes = await protocol.getMetaItems({
                                type: 'app',
                                packageId: id,
                            });
                            const apps: any[] = Array.isArray(appsRes)
                                ? appsRes
                                : Array.isArray((appsRes as any)?.items) ? (appsRes as any).items : [];
                            for (const app of apps) {
                                if (app && typeof app === 'object' && app._unpublished === true && typeof app.name === 'string') {
                                    // `false`, not a delete: ADR-0045 §3 makes
                                    // publish/unpublish symmetric ("unpublish =
                                    // re-hide"), so the gate stays a two-state
                                    // flag rather than a key whose absence has
                                    // to be re-derived. Whatever `hidden` the
                                    // app carries is copied through untouched.
                                    const item: Record<string, unknown> = { ...app, _unpublished: false };
                                    // [#23120, ADR-0010 §3.5] …but not a
                                    // `protection` block. This body is the
                                    // server's, built from the stored row, and
                                    // a row stored before the metadata save door
                                    // refused the block can still carry one: the
                                    // save would be refused with
                                    // `400 VALIDATION_ERROR` and the app left
                                    // `_unpublished`. Only the package loader
                                    // translates the block into a lock, so it
                                    // never bound and dropping it changes no
                                    // verdict. Dropped from this copy only — the
                                    // row the read returned is not mutated.
                                    delete item.protection;
                                    await protocol.saveMetaItem({
                                        type: 'app',
                                        name: app.name,
                                        item,
                                        packageId: id,
                                        ...(actor !== undefined ? { actor } : {}),
                                    });
                                    flipped.push(app.name);
                                }
                            }
                        }
                    } catch (e: any) {
                        // #4754 — ADR-0045's visibility flip is a metadata WRITE
                        // riding on someone else's success. The drafts are already
                        // promoted, so this route answers 200 either way, and
                        // `unhideError` lands in a response body no operator reads.
                        // That is the #4669 shape exactly: the write did not land,
                        // the runtime looks completely healthy, and the loss only
                        // surfaces later as "I published it but the app isn't
                        // there". So it is reported at `error` (AGENTS.md →
                        // "Degradation log levels"), not swallowed.
                        const logger = deps.logger ?? console;
                        // #5242 — a mid-loop failure leaves the package SPLIT: the
                        // apps already saved are visible, the rest are not. Name
                        // BOTH halves. The old wording asserted "every hidden app
                        // is still stored hidden", which is plainly false once any
                        // flip persisted, and it left the operator to infer
                        // "nothing changed" from a bare failure line.
                        const stillUnpublished = flipped.length > 0
                            ? `the flip stopped PARTWAY — ${flipped.length} app(s) DID flip and are stored published ` +
                              `(${flipped.join(', ')}; they are reported under \`unhiddenApps\` and were announced for ` +
                              `re-sync), while every REMAINING unpublished app bound to it`
                            : `every unpublished app bound to it`;
                        logger.error(
                            `[Packages] publish-drafts: the ADR-0045 visibility flip FAILED for package '${id}' — its drafts ARE ` +
                            `published and live, but ${stillUnpublished} is still STORED with \`_unpublished: true\`, so those ` +
                            `apps stay externally unobservable while the publish reports success. Nothing retries this flip. ` +
                            `Re-run POST /packages/${id}/publish-drafts once the cause below is resolved (it is idempotent), or ` +
                            `publish one app directly via PUT /meta/app/<name> with \`{"_unpublished": false}\`. Cause: ` +
                            `${e?.message ?? String(e)}`,
                        );
                        // [#8516] ADR-0112, the PAYLOAD half — the `logger.error`
                        // above is the other half and is left exactly as it is.
                        // `unhideError` rides the same **200** publish body as
                        // `seedApplied` (#8443), as DATA, so no HTTP boundary's
                        // 5xx message withhold can reach it: the disclosure has
                        // to be closed here, at the producer.
                        //
                        // Measured on `origin/main` before the change, through
                        // this door with a `sys_metadata` outage under
                        // `getMetaItems`: `"unhideError": "SQLITE_ERROR: no such
                        // table: sys_metadata"` on a 200. Same text from a
                        // mid-loop `saveMetaItem` failure, there alongside the
                        // `unhiddenApps: ["crm"]` half-flip report.
                        //
                        // The rule is IMPORTED, never re-spelled: quote the
                        // caught sentence only when the error declared itself a
                        // 4xx client refusal. The authored population this catch
                        // receives is NOT blanked by that — `saveMetaItem`'s
                        // refusals all declare 4xx (`NOT_OVERRIDABLE`/403,
                        // `ITEM_LOCKED`/403, `OBJECT_OVERLAY_PACKAGE_MISMATCH`/422,
                        // the org and destructive-change refusals), so a locked
                        // or non-overridable app still tells its publisher which
                        // app and why, verbatim. That was measured too, not
                        // assumed.
                        (result as any).unhideError = clientFacingFailureText(e, 'visibility flip failed');
                    }
                    // Assigned on BOTH paths — clean completion and mid-loop
                    // failure alike. On the failure path it rides ALONGSIDE
                    // `unhideError`: together they say what did flip and that
                    // something did not, which is the honest report. It must
                    // stay ABOVE the announce block, which reads this field.
                    if (flipped.length > 0) (result as any).unhiddenApps = flipped;
                    // A publish promoted drafts to active (or published an additive
                    // app) at RUNTIME — but boot-cached consumers still hold the
                    // pre-publish view. The load-bearing one is the automation
                    // engine: a record-triggered flow authored + published in the
                    // Studio does NOT bind its trigger (record-change automations
                    // never fire) until the next restart. Announce
                    // 'metadata:reloaded' — the same signal a dev artifact reload
                    // fires (MetadataPlugin._reloadAndAnnounce) — so subscribers
                    // re-sync WITHOUT a restart. #2560 covers the cold-boot bind;
                    // this covers publish-while-running. `this.kernel.context` is
                    // the same handle the service resolver uses above. Best-effort:
                    // a subscriber failure must never fail the publish (the drafts
                    // are already live), so it rides the response instead.
                    try {
                        const changed = [
                            ...(((result as any)?.published ?? []) as Array<{ type: string; name: string }>)
                                .map((p) => `${p.type}/${p.name}`),
                            ...(((result as any)?.unhiddenApps ?? []) as string[]).map((n) => `app/${n}`),
                        ];
                        if (changed.length > 0) {
                            await deps.announceKernelEvent(_context, 'metadata:reloaded', { changed });
                        }
                    } catch (e: any) {
                        // [#8516] The same ADR-0112 rule as the visibility flip
                        // above, on the same 200 body — but this site owed BOTH
                        // halves, because it had no log at all. Withholding the
                        // text without adding one would have converted an
                        // over-disclosure into a silent failure: strictly worse.
                        //
                        // `context.trigger` dispatch is PROPAGATING (#5170 /
                        // #5282) — "reporting a propagated failure is the
                        // caller's job" — so whatever a subscriber throws
                        // arrives here unwrapped, and every subscriber of this
                        // event is PLATFORM code doing internal re-sync work
                        // (`resyncFlowsFromProtocol`, `resyncAuthoredHooks` /
                        // `…Actions`, `ingestReloadedObjects`, the authored
                        // translation sync). Measured on `origin/main` before the
                        // change: `"rebindError": "TypeError: Cannot read
                        // properties of undefined (reading 'triggers') at
                        // AutomationPlugin.rebind (/srv/objectstack/packages/
                        // services/service-automation/dist/index.js:412:31)"` on
                        // a 200 — an internal stack frame and a server
                        // filesystem path, quoted to whoever pressed Publish.
                        // Nothing an author can act on, so nothing that is worth
                        // the disclosure; a subscriber that DOES declare a 4xx
                        // refusal still reaches them, by the same positive list.
                        //
                        // `warn`, not `error`, and deliberately: nothing here
                        // claimed to persist and did not — the drafts are
                        // published, the flip is stored. What is lost is an
                        // in-memory re-sync, which is AGENTS.md's own worked
                        // example of a FUNCTIONAL degradation ("a trigger is not
                        // armed"), and the sibling announce of this very event
                        // (`MetadataPlugin._reloadAndAnnounce`) already logs it
                        // at `warn`. Escalating it would be the over-application
                        // that trains everyone to skim `error`.
                        (deps.logger ?? console).warn(
                            `[Packages] publish-drafts: the 'metadata:reloaded' announce FAILED for package '${id}' — the drafts ARE ` +
                            `published and stored, but boot-cached consumers keep the PRE-publish view until this process restarts: a ` +
                            `newly published record-triggered flow does not bind its trigger (it will not fire), an edited ` +
                            `schedule-triggered flow keeps running its old definition, newly declared connectors stay undispatchable, ` +
                            `and authored hooks, actions and translations are not re-synced. Nothing retries this announce. Re-run ` +
                            `POST /packages/${id}/publish-drafts once the cause below is resolved (it is idempotent), or restart the ` +
                            `process to rebuild every subscriber from storage. Cause: ${e?.message ?? String(e)}`,
                        );
                        (result as any).rebindError = clientFacingFailureText(e, 'metadata:reloaded announce failed');
                    }
                    return { handled: true, response: deps.success(result) };
                } catch (e: any) {
                    // Carry spec-validation `issues` (and the real 422 status —
                    // the protocol sets `.status`, not `.statusCode`) through to
                    // the publish surface so failures are field-anchored.
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }
            return { handled: true, response: deps.error('Draft publishing not supported', 501) };
        }

        // POST /packages/:id/discard-drafts → drop every pending DRAFT bound
        // to the package, reverting it to its last published baseline
        // ("abandon all my changes"). NON-destructive: active metadata and
        // physical tables are untouched. Routes through the sys_metadata
        // path (no metadata-service dependency; /revert below shares its
        // per-draft step and asks the metadata service only for a package
        // with no stored row).
        if (parts.length === 2 && parts[1] === 'discard-drafts' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, `Discarding the drafts of package "${id}"`);
            if (walled) return walled;
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_WRITE_NO_QUERY_PARAMS); if (queryRefused) return queryRefused;
            const protocol = await resolveProtocol(deps, _context);
            if (protocol && typeof protocol.discardPackageDrafts === 'function') {
                try {
                    const actor = resolvePackageWriteActor(_context);
                    const result = await protocol.discardPackageDrafts({
                        packageId: id,
                        ...(actor !== undefined ? { actor } : {}),
                    });
                    // The twin of `publish-drafts`' 404: an empty discard is the
                    // answer for a package that exists — see `packageIsUnknown`.
                    if (
                        (result as any)?.discardedCount === 0
                        && (result as any)?.failedCount === 0
                        && packageIsUnknown(registry, id)
                    ) {
                        return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
                    }
                    return { handled: true, response: deps.success(result) };
                } catch (e: any) {
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }
            return { handled: true, response: deps.error('Draft discarding not supported', 501) };
        }

        // ── ADR-0067: package-scoped commit history & rollback ──────────

        // GET /packages/:id/commits → the commit timeline (newest-first).
        if (parts.length === 2 && parts[1] === 'commits' && m === 'GET') {
            // [#23546] The commit trail's own gate: `studio.access`, not the
            // package read cohort's `setup.access`.
            const denied = requireCommitTrailReadCapability(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const protocol = await resolveProtocol(deps, _context);
            if (protocol && typeof protocol.listCommits === 'function') {
                try {
                    const commits = await protocol.listCommits({
                        packageId: id,
                    });
                    // An empty trail is the answer for a package that exists —
                    // see `packageIsUnknown`. A trail that outlived its
                    // package's registry entry is still served.
                    if (Array.isArray(commits) && commits.length === 0 && packageIsUnknown(registry, id)) {
                        return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
                    }
                    return { handled: true, response: deps.success({ commits }) };
                } catch (e: any) {
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }
            return { handled: true, response: deps.error('Commit history not supported', 501) };
        }

        // POST /packages/:id/commits/:commitId/revert → revert ONE commit
        // (ADR-0067). Created artifacts are soft-removed, edited ones are
        // restored to their pre-commit version; the revert is itself a commit.
        if (parts.length === 4 && parts[1] === 'commits' && parts[3] === 'revert' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const commitId = decodeURIComponent(parts[2]);
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, `Reverting commit "${commitId}"`);
            if (walled) return walled;
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_WRITE_NO_QUERY_PARAMS); if (queryRefused) return queryRefused;
            const protocol = await resolveProtocol(deps, _context);
            if (protocol && typeof protocol.revertCommit === 'function') {
                try {
                    const actor = resolvePackageWriteActor(_context);
                    const result = await protocol.revertCommit({
                        commitId,
                        ...(actor !== undefined ? { actor } : {}),
                    });
                    return { handled: true, response: deps.success(result) };
                } catch (e: any) {
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }
            return { handled: true, response: deps.error('Commit revert not supported', 501) };
        }

        // POST /packages/:id/rollback  body { commitId } → roll the package
        // back THROUGH every commit newer than `commitId` (ADR-0067).
        if (parts.length === 2 && parts[1] === 'rollback' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, `Rolling back package "${decodeURIComponent(parts[0])}"`);
            if (walled) return walled;
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_WRITE_NO_QUERY_PARAMS); if (queryRefused) return queryRefused;
            const protocol = await resolveProtocol(deps, _context);
            if (protocol && typeof protocol.rollbackToPackageCommit === 'function') {
                if (!body?.commitId) {
                    return { handled: true, response: deps.error('Body { commitId } is required', 400) };
                }
                try {
                    const actor = resolvePackageWriteActor(_context);
                    const result = await protocol.rollbackToPackageCommit({
                        commitId: String(body.commitId),
                        ...(actor !== undefined ? { actor } : {}),
                    });
                    return { handled: true, response: deps.success(result) };
                } catch (e: any) {
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }
            return { handled: true, response: deps.error('Commit rollback not supported', 501) };
        }

        // POST /packages/:id/revert → revert package to last published state
        if (parts.length === 2 && parts[1] === 'revert' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, `Reverting package "${id}"`);
            if (walled) return walled;
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_WRITE_NO_QUERY_PARAMS); if (queryRefused) return queryRefused;
            // [#22090] A package's members live in one of two places, and each
            // is reverted by the service that holds it. A Studio-authored
            // package is `sys_metadata` rows bound by `package_id` — the rows
            // discard-drafts reads — which the metadata service's in-memory
            // registry never holds, so asking only that service answered 404
            // "No metadata items found" for a package with published items and
            // a pending draft. The protocol is asked FIRST: it reverts the
            // stored members (or refuses a never-published package with the
            // declared 409), and answers `stored: false` when the package has no
            // stored row, leaving the metadata service's revert below to answer
            // exactly as it always has — a code-shipped package, an unknown id.
            const protocol = await resolveProtocol(deps, _context);
            if (protocol && typeof protocol.revertStoredPackage === 'function') {
                try {
                    const stored = await protocol.revertStoredPackage({
                        packageId: id,
                    });
                    if (stored.stored) return { handled: true, response: deps.success({ success: true }) };
                } catch (e: any) {
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }
            // [#22113] ADR-0070 D2: a code or installed package has nothing of its
            // own to revert, so it is refused here, AFTER the protocol's stored-row
            // answer above. A stored row bound to it (an organization overlay
            // draft) is still answered by the protocol, exactly as before; only the
            // metadata service's revert of the package's shipped items is refused.
            // "Has never been published" would point the caller at publishing,
            // which the publish door above refuses for the same package.
            const readOnly = requireWritablePackage(deps, qlService, id, 'revert'); if (readOnly) return readOnly;
            const metadataService = await deps.getService(_context, CoreServiceName.enum.metadata);
            if (metadataService && typeof (metadataService as any).revertPackage === 'function') {
                await (metadataService as any).revertPackage(id);
                return { handled: true, response: deps.success({ success: true }) };
            }
            return { handled: true, response: deps.error('Metadata service not available', 503) };
        }

        // GET /packages/:id/export → assemble a portable manifest from
        // sys_metadata overlay rows bound to this package (offline export).
        if (parts.length === 2 && parts[1] === 'export' && m === 'GET') {
            const denied = requireReadCapability(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const manifest = await assemblePackageManifest(deps, id, registry, _context);
            if (!manifest) {
                return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            }
            return { handled: true, response: deps.success(manifest) };
        }

        // GET /packages/:id/customizations → [#28411, ADR-0146 D8 item 4] what
        // this deployment changed on an installed base: its `.custom` pair's
        // served overrides, the members the pair adds to the base's objects,
        // and the base's items switched off in the activation ledger. See
        // {@link readPackageCustomizations}.
        if (parts.length === 2 && parts[1] === 'customizations' && m === 'GET') {
            // The read authority of `GET /packages/:id`, the same gate, asked
            // first. ⛔ No second authority check.
            const denied = requireReadCapability(deps, _context); if (denied) return denied;
            // Closed query set: the door reads none, so a parameter is a
            // request it would otherwise answer as if it had been honoured.
            const unknownQuery = unknownQueryParamRefusalMessage(query, []);
            if (unknownQuery !== undefined) {
                return { handled: true, response: deps.error(unknownQuery, 400, { code: 'VALIDATION_ERROR' }) };
            }
            const id = decodeURIComponent(parts[0]);
            // A `.custom` id is refused naming its base, whether or not the
            // pair is installed: the question is about the id's shape, and the
            // base's read answers it.
            const baseOfPair = customizationBasePackageId(id);
            if (baseOfPair !== null) {
                return {
                    handled: true,
                    response: deps.error(
                        `Package '${id}' is the customization package of '${baseOfPair}'. Customizations are read for the base: `
                        + `GET /packages/${encodeURIComponent(baseOfPair)}/customizations.`,
                        400,
                        { code: 'VALIDATION_ERROR' },
                    ),
                };
            }
            // The id lookup of `GET /packages/:id`, with its 404 wording.
            if (!registry.getPackage(id)) return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            const protocol = await resolveProtocol(deps, _context);
            if (!protocol || typeof protocol.listServedOverrides !== 'function') {
                return { handled: true, response: deps.error('Metadata service not available', 503) };
            }
            try {
                return {
                    handled: true,
                    response: deps.success(await readPackageCustomizations(id, protocol.listServedOverrides.bind(protocol), qlService)),
                };
            } catch (e: any) {
                return { handled: true, response: deps.errorFromThrown(e, 500) };
            }
        }

        // POST /packages/:id/adopt-orphans → bulk-rebind package-less (legacy
        // null / 'sys_metadata') metadata INTO this base (ADR-0070 D5 migration;
        // lets the env retire the "Local / Custom" scope once it has no orphans).
        if (parts.length === 2 && parts[1] === 'adopt-orphans' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, `Adopting orphaned metadata into package "${id}"`);
            if (walled) return walled;
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_WRITE_NO_QUERY_PARAMS); if (queryRefused) return queryRefused;
            // [#24813] ADR-0070 D2: a package the deployment ships is not a
            // base, so nothing is adopted into it. `reassignOrphanedMetadata`
            // asks no writability question and rebinds every package-less row
            // to whatever id it is handed, so this door refuses with the answer
            // install-overwrite, disable, publish, revert, the manifest PATCH
            // and delete give. Asked BEFORE the protocol is resolved, so a
            // read-only id answers 422 whether or not this deployment can
            // adopt. An id nothing installed is writable by the predicate's own
            // rule, so it still reaches the protocol.
            const readOnly = requireWritablePackage(deps, qlService, id, 'adopt items into'); if (readOnly) return readOnly;
            const protocol = await resolveProtocol(deps, _context);
            if (!protocol || typeof protocol.reassignOrphanedMetadata !== 'function') {
                return { handled: true, response: deps.error('Orphan adoption not supported', 501) };
            }
            try {
                const actor = resolvePackageWriteActor(_context);
                const result = await protocol.reassignOrphanedMetadata({
                    targetPackageId: id,
                    ...(actor !== undefined ? { actor } : {}),
                });
                return { handled: true, response: deps.success(result) };
            } catch (e: any) {
                return { handled: true, response: deps.errorFromThrown(e, 500) };
            }
        }

        // POST /packages/:id/duplicate → clone a writable BASE into a NEW
        // writable package, re-namespacing objects + rewriting references.
        // Body { targetPackageId, targetName?, targetNamespace? }.
        //
        // [#14451] The source must BE a base — {@link requireDuplicableSource},
        // which carries the measurement and the reasoning. ADR-0070 D4 is
        // declared-and-not-built ("D4–D6 remaining"), and its object is a *base*
        // ("clone a base into a new writable package"): what this route clones
        // is the source's `sys_metadata` rows, which a code package does not
        // have. ⛔ Do not read the sentence above as "any package can be
        // duplicated into an editable copy" — that is the aspiration the card
        // measured against, and the route does not implement it.
        if (parts.length === 2 && parts[1] === 'duplicate' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, `Duplicating package "${id}"`);
            if (walled) return walled;
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_WRITE_NO_QUERY_PARAMS); if (queryRefused) return queryRefused;
            const protocol = await resolveProtocol(deps, _context);
            if (!protocol || typeof protocol.duplicatePackage !== 'function') {
                return { handled: true, response: deps.error('Package duplication not supported', 501) };
            }
            const targetPackageId = typeof body?.targetPackageId === 'string' ? body.targetPackageId.trim() : '';
            if (!targetPackageId) {
                return { handled: true, response: deps.error('Body { targetPackageId } is required', 400) };
            }
            // [#14451] Refuse BEFORE the protocol call: `duplicatePackage` mints
            // the target package record (`installPackage`) ahead of its copy
            // loop, so a refusal any later still leaves the empty shell behind.
            const notABase = requireDuplicableSource(deps, qlService, id); if (notABase) return notABase;
            try {
                const actor = resolvePackageWriteActor(_context);
                const result = await protocol.duplicatePackage({
                    sourcePackageId: id,
                    targetPackageId,
                    ...(typeof body?.targetName === 'string' ? { targetName: body.targetName } : {}),
                    ...(typeof body?.targetNamespace === 'string' ? { targetNamespace: body.targetNamespace } : {}),
                    ...(actor !== undefined ? { actor } : {}),
                });
                return { handled: true, response: deps.success(result) };
            } catch (e: any) {
                return { handled: true, response: deps.errorFromThrown(e, 500) };
            }
        }

        // POST /packages/:id/ensure-customization → ensure the base's paired
        // customization package `<id>.custom` (ADR-0146 D3): answer it, creating
        // it when absent — `201` when this call created it, `200` when it was
        // already there. The body is the protocol's
        // (`ensureCustomizationPackage`, `@objectstack/metadata-protocol`),
        // which judges the packages; this door judges the caller, exactly as
        // the install door does — `manage_metadata` under `single`, the
        // platform operator alone under a wall (a tenant administrator is
        // refused `403`) — and the request shape, all before the protocol runs.
        if (parts.length === 2 && parts[1] === 'ensure-customization' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, `Ensuring the customization package of "${id}"`);
            if (walled) return walled;
            // AGENTS.md route rule 5: the measured closed query set is EMPTY —
            // the door reads the path and the session, no query parameter.
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_WRITE_NO_QUERY_PARAMS); if (queryRefused) return queryRefused;
            // The door reads NO body: the base is the path's `:id`, and the
            // pair's id, namespace and dependency are derived from it, never
            // requested. A body carrying keys is refused rather than ignored,
            // so a caller who meant to name a namespace or a range learns that
            // nothing was read.
            if (body !== undefined && body !== null
                && (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0)) {
                return {
                    handled: true,
                    response: deps.error(
                        'The ensure-customization door reads no body: the base is the path\'s package id, and the '
                        + 'pair\'s id, namespace and dependency range are derived from it (ADR-0146 D3). Send no '
                        + 'body, or an empty object.',
                        400,
                    ),
                };
            }
            const protocol = await resolveProtocol(deps, _context);
            if (!protocol || typeof protocol.ensureCustomizationPackage !== 'function') {
                return { handled: true, response: deps.error('Customization package ensure not supported', 501) };
            }
            try {
                const result = await protocol.ensureCustomizationPackage({ basePackageId: id });
                const res = deps.success(result);
                if (result.created) res.status = 201;
                return { handled: true, response: res };
            } catch (err) {
                // ADR-0141 D2's refusal of the pair's own install (a base at a
                // prerelease version, which the dependency check does not
                // admit) keeps its per-entry facts, as at the install door.
                if (isDependencyMissingError(err)) {
                    const answer = dependencyMissingAnswer(err);
                    return {
                        handled: true,
                        response: deps.error(answer.message, answer.status, { code: answer.code, ...answer.details }),
                    };
                }
                return { handled: true, response: deps.errorFromThrown(err, 500) };
            }
        }

        // GET /packages/:id[?version=] → get package, scoped to a version when
        // one is asked for (#17416 — see `readRequestedVersion`).
        if (parts.length === 1 && m === 'GET') {
            const denied = requireReadCapability(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const pkg = registry.getPackage(id);
            if (!pkg) return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            // [#17416] The version scope is applied AFTER the id lookup, so an
            // id this registry does not hold keeps answering the wording
            // `packages-single-door.test.ts` pins — `Package '<id>' not found`,
            // whether or not `?version=` rode along. Only a package that IS
            // here can be at the wrong version.
            const requested = readRequestedVersion(query?.version);
            if (requested.kind === 'repeated') {
                // [#17672] A request-shape error, answered `400` in the shared
                // rule's own words — ⛔ never a `404`, which says "not found"
                // about a package that is right here. `deps.error` derives
                // `VALIDATION_ERROR` from the status; see `readRequestedVersion`.
                return {
                    handled: true,
                    response: deps.error(repeatedQueryParamMessage('version', requested.count), 400),
                };
            }
            if (requested.kind === 'exact') {
                const present = installedVersionOf(pkg);
                if (present !== requested.value) {
                    return {
                        handled: true,
                        response: deps.error(
                            `Package '${id}' version '${requested.value}' not found`
                            + (present ? ` — installed version is '${present}'` : ''),
                            404,
                        ),
                    };
                }
            }
            // [#14375] Same verdict, same predicate as the list door — and
            // [#14309] the same project-then-stamp order, for the same reason.
            // [#28318] `disableable` likewise, beside `writable`.
            return {
                handled: true,
                response: deps.success(withDisableableVerdict(qlService, withWritableVerdict(qlService, toPackageResponse(pkg) as any))),
            };
        }

        // PATCH /packages/:id → edit the manifest (name / description /
        // version / dependencies). A partial patch: only the fields present
        // are changed; lifecycle state (enabled / status / installedAt) is
        // preserved. `id` / `scope` / `type` are identity/structure and are
        // NOT editable here. Body accepts the fields flat or under a
        // `manifest` wrapper.
        if (parts.length === 1 && m === 'PATCH') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, `Updating package "${id}"`);
            if (walled) return walled;
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_WRITE_NO_QUERY_PARAMS); if (queryRefused) return queryRefused;
            // [#24705] ADR-0070 D2: the manifest of a package the deployment
            // ships is the deployment's, so this door refuses it with the
            // answer install-overwrite, disable, publish, revert and delete
            // give. Asked BEFORE the body is read, so the answer is the same
            // whatever keys the body carries, and before `updatePackage`
            // re-persists the edited manifest to `sys_packages`. An id nothing
            // installed is writable by the predicate's own rule, so it still
            // reaches the 404 below.
            const readOnly = requireWritablePackage(deps, qlService, id, 'edit'); if (readOnly) return readOnly;
            const wrapped = Boolean(body?.manifest && typeof body.manifest === 'object');
            const src = (wrapped ? body.manifest : body) ?? {};
            const patch: {
                name?: string;
                description?: string;
                version?: string;
                dependencies?: Record<string, string>;
            } = {};
            if (typeof src.name === 'string') patch.name = src.name.trim();
            if (typeof src.description === 'string') patch.description = src.description;
            if (typeof src.version === 'string') patch.version = src.version.trim();

            if (patch.name !== undefined && patch.name === '') {
                return { handled: true, response: deps.error('name must not be empty', 400) };
            }
            if (patch.version !== undefined && !SEMVER_2_0_0_VERSION_PATTERN.test(patch.version)) {
                return { handled: true, response: deps.error('version must be a SemVer 2.0.0 string (e.g. 1.0.0, 2.0.0-beta.1)', 400) };
            }
            // [#24670] `dependencies` — the declaration the save door's closure
            // verdict reads (ruling #9612), and the key its refusal tells the
            // author to edit («declare a dependency … in the `dependencies` of
            // P's manifest»). It could be set at create and never again, so for
            // a package that already existed that remedy had no door.
            //
            // ⭐ THE ROW IS JUDGED BY THE DECLARATION, by reference:
            // `ManifestSchema.shape.dependencies`, the row `POST /packages`
            // parses the same key with at create — never a shape restated
            // here. A malformed row is refused `400` (`VALIDATION_ERROR`, the
            // envelope the create door answers for it) BEFORE the protocol or
            // the registry is reached, so a refusal writes nothing, not even a
            // valid key sent beside it.
            //
            // The parsed row REPLACES the stored one whole — removing an entry
            // is the same write, with the entry left out, and `{}` clears the
            // declaration. ⛔ No in-use check is made here: an edit that takes
            // an object some stored item binds to out of the closure is
            // applied as given (the stored item is judged at its next save).
            if (src.dependencies !== undefined) {
                const declared = ManifestSchema.shape.dependencies.safeParse(src.dependencies);
                if (!declared.success) {
                    const key = wrapped ? 'manifest.dependencies' : 'dependencies';
                    const located = declared.error.issues
                        .map((issue) => `${[key, ...issue.path.map(String)].join('.')}: ${issue.message}`)
                        .join('; ');
                    return {
                        handled: true,
                        response: deps.error(
                            `Invalid package dependencies — ${located}. \`dependencies\` maps package ids to `
                            + `version requirements, e.g. { "com.acme.core": "^1.0.0" }`,
                            400,
                        ),
                    };
                }
                patch.dependencies = declared.data;
            }
            if (
                patch.name === undefined && patch.description === undefined
                && patch.version === undefined && patch.dependencies === undefined
            ) {
                return { handled: true, response: deps.error('Body { name?, description?, version?, dependencies? } — nothing to update', 400) };
            }

            const protocol = await resolveProtocol(deps, _context);
            if (protocol && typeof protocol.updatePackage === 'function') {
                try {
                    const updated = await protocol.updatePackage({ packageId: id, patch });
                    return { handled: true, response: deps.success((updated as any)?.package ?? updated) };
                } catch (e: any) {
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }
            // Fallback: no protocol service — in-memory registry only.
            const pkg = registry.updatePackageManifest(id, patch);
            if (!pkg) return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            return { handled: true, response: deps.success(pkg) };
        }

        // DELETE /packages/:id → delete the package. Unregisters it from the
        // in-memory registry AND removes its persisted sys_metadata rows
        // (active + draft), tearing down each object's physical table by
        // default. `?keepData=true` preserves object tables (metadata-only
        // delete). Use case: "I don't want this package anymore."
        if (parts.length === 1 && m === 'DELETE') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            // [ADR-0131 D12 items 7–8] Under a wall, the platform operator's.
            const walled = await refuseWalledCatalogPackageWrite(deps, _context, `Deleting package "${id}"`);
            if (walled) return walled;
            // [#26857] `?keepdata=true` is not `keepData`: refused here, before
            // anything is deleted, rather than read as absent (drop the tables).
            const queryRefused = refusePackageWriteDoorQuery(deps, query, PACKAGE_DELETE_QUERY_PARAMS); if (queryRefused) return queryRefused;
            // [#23214] A repeated `?keepData=` is refused before the registry or
            // the protocol is touched: read as absent, it dropped the tables
            // the caller asked to keep (`refuseRepeatedWriteFlag`).
            const repeatedKeepData = refuseRepeatedWriteFlag(deps, query, 'keepData');
            if (repeatedKeepData) return repeatedKeepData;
            // [#7560] ADR-0070: refuse BEFORE `uninstallPackage`, which is the
            // call that removed a platform package from the running registry
            // listing (and with it every object the package registers) until
            // the next restart.
            const readOnly = requireWritablePackage(deps, qlService, id, 'delete'); if (readOnly) return readOnly;
            const protocol = await resolveProtocol(deps, _context);
            const persists = Boolean(protocol && typeof protocol.deletePackage === 'function');

            // [#21276] Existence is READ here, never acted on. This line used to
            // be `registry.uninstallPackage(id)`, and the disable-record clear
            // below sat right after it — both BEFORE `deletePackage`. So when the
            // store then refused the `sys_packages` delete, the door answered the
            // failure while the running process had already dropped the package
            // (`GET` 404 until a restart brought it back) and the disable record
            // was already gone (a disabled package came back enabled). Measured
            // at this door on SQLite with a trigger refusing the delete.
            //
            // Triage's ruling for #21276 — refuse before withdrawing, not undo:
            // `deletePackage` deletes the stored row FIRST and refuses before it
            // removes anything else, so the door asks it first and touches the
            // running registry and the disable record only once it has answered.
            const existed = registry.getPackage(id) !== undefined;

            // Persisted removal (AI/runtime packages live in sys_metadata, not
            // just the in-memory registry — the registry uninstall alone would
            // leave the rows and tables behind).
            let persisted: DeletePackageResponse | undefined = undefined;
            // [#9960] `protocol` is an UNCONTRACTED service slot — `ServiceSlotContracts`
            // leaves it unmapped on purpose ("no written contract … rather than being
            // given a shape nothing checks") — so `resolveService` hands this door an
            // `any`. That `any` is what let the call below send keys no declared shape
            // named: `organizationId` (the key that decides an uninstall's blast radius)
            // and `keepData` are exactly the two the since-removed REST twin's option
            // type (#14503) could not express, and nothing compared the two doors'
            // requests. Narrowed
            // to the producer's declared verb, so what this door sends is checked
            // against the contract the implementation states.
            //
            // [#13598] That narrowing used to be written INLINE right here, as this
            // door's own one-off `{ deletePackage?(…) }` annotation, because it was the
            // only typed seam in a file of eleven untyped ones. It is now the
            // `deletePackage` member of {@link PackagesDomainProtocol} — the same
            // producer-declared request type, stated once for the whole file instead of
            // once at the one door that happened to need it first. The rule is
            // unchanged; only its address is.
            //
            // The `typeof … === 'function'` probe STAYS and the member stays optional:
            // the verb is absent from the spec's `PackageProtocol` (every member of
            // which is optional anyway), the slot takes whatever a host registers under
            // the name, and registrants carrying no `deletePackage` are real in-tree.
            // A capability question, asked as a capability probe — not a cast.
            //
            // [#20492] `protocol` is the one resolved above, before the registry
            // was touched.
            if (protocol && typeof protocol.deletePackage === 'function') {
                try {
                    const keepData = query?.keepData === 'true' || query?.keepData === '1';
                    persisted = await protocol.deletePackage({
                        packageId: id,
                        ...(keepData ? { keepData: true } : {}),
                    });
                } catch (e: any) {
                    // [#21276] Nothing was touched on this path: the registry
                    // still holds the package and its disable record is intact.
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }

            // [#21276] Only now — the persisted delete has answered, or this host
            // has none — is the package withdrawn from the running registry.
            // `deletePackage` withdraws it itself on the same registry (its own
            // step after the stored rows), so this is usually a no-op and is
            // skipped when the package is already gone. A host with no
            // persisted half keeps exactly its old behaviour: the withdrawal is
            // the uninstall, and its refusal (another package extends an object
            // this one owns, ADR-0029) is the request's refusal.
            //
            // With a persisted half, that refusal does not arrive here:
            // `deletePackage` asks it (`SchemaRegistry.assertPackageUninstallable`)
            // before its store delete and throws it with nothing removed, which
            // the `catch` above answers — `500`, nothing changed. This `try`
            // stays as a safety net for a registry without that method, or a
            // throw nothing asked ahead of time. The stored rows are already
            // gone by then, so it is reported as `registryRemoved: false`
            // rather than as a failure the store does not bear out, and the
            // package leaves the running process at the next restart.
            if (registry.getPackage(id) !== undefined) {
                if (persists) {
                    try {
                        registry.uninstallPackage(id);
                    } catch (err) {
                        console.warn(
                            `[handlePackages] '${id}' was deleted from storage but the running registry refused to `
                            + `withdraw it, so this process keeps serving it until it restarts: ${(err as Error)?.message}`,
                        );
                    }
                } else {
                    registry.uninstallPackage(id);
                }
            }
            const registryRemoved = existed && registry.getPackage(id) === undefined;

            // ⭐ [#18877 ruling item 3] A package that no longer exists has no
            // lifecycle state — so the DURABLE disable record goes with the row,
            // and the next install of this id is a FRESH install that lands at
            // the declared default. The registry half of the same sentence is
            // inside `uninstallPackage`, which forgets the id from the boot seed
            // set; this is the half that outlives the process.
            //
            // Without it the record was immortal: `DELETE` removed the row and
            // left the id listed on disk, the next boot seeded it back, and a
            // reinstalled package came up disabled with nothing anywhere saying
            // why — a disable the operator could no longer even see to undo,
            // since the package it named was gone. Written only for a package
            // this request found, so a 404 changes no state; and [#21276] only
            // once the persisted delete has answered — with a persisted half,
            // whenever its stored row is gone, even if the running registry
            // refused the withdrawal above.
            //
            // Same best-effort try/catch as the install and PATCH arms above:
            // the uninstall itself already happened, so a state-file failure
            // must not turn it into a 500.
            if (persists ? existed : registryRemoved) {
                try {
                    setPackageDisabled(_context?.environmentId, id, false);
                } catch (err) {
                    console.warn('[handlePackages] failed to clear persisted disable state on delete', { id, error: (err as Error)?.message });
                }
            }

            const deletedCount = persisted?.deletedCount ?? 0;
            const failedCount = persisted?.failedCount ?? 0;

            // [#7557] A failed persistence used to ride inside a 200: this
            // handler stated `success: true` unconditionally and forwarded the
            // protocol's own `{ success: false, deletedCount: 0 }` underneath
            // it, so the status line and the payload disagreed and every caller
            // that checks the status (which is every caller that does not go
            // digging into `persisted`) recorded an uninstall that had not
            // happened.
            //
            // The failure rule is the one the REST twin of this route stated
            // (`packages/rest/src/package-routes.ts`, until #14503 removed that
            // twin), kept in the same words on purpose — DELETE /packages/:id
            // had TWO doors (this dispatcher and the direct-mount REST
            // registrar), and two doors answering one request differently is
            // how this divergence arrived. Since #14503 this domain is the
            // single implementation of the route; the rule stays because it is
            // right, not because a twin still needs matching. Zero metadata
            // rows is still a successful uninstall — a runtime-registered
            // package that never published metadata has nothing in
            // `sys_metadata` — so only PER-ITEM failures make it a failure.
            //
            // Checked BEFORE the not-found test below, which asks
            // `deletedCount === 0`: an uninstall where every row failed to
            // delete also has `deletedCount === 0`, and answering "not found"
            // for a package whose rows are demonstrably present and demonstrably
            // stuck is the same lie one layer over.
            if (failedCount > 0) {
                return {
                    handled: true,
                    response: deps.error(
                        `Deleting ${id} left ${failedCount} item(s) behind.`,
                        400,
                        {
                            code: 'PACKAGE_DELETE_PARTIAL',
                            registryRemoved,
                            failed: persisted?.failed,
                            cleanups: persisted?.cleanups,
                        },
                    ),
                };
            }
            // [#21276] `existed`, not `registryRemoved`: a package this request
            // found whose withdrawal the registry refused after its stored row
            // was deleted is not "not found".
            if (!existed && deletedCount === 0) {
                return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            }
            // [#16781] `packageId` is REQUIRED by
            // `UninstallPackageApiResponseSchema` and this door did not send
            // it. Added, additively — `registryRemoved` and `persisted` stay
            // on the wire exactly as they were. They are keys the declared
            // schema does not carry, so a declared parse STRIPS them; that
            // residue is pinned by name in
            // `packages-read-delete-response-conformance.test.ts` rather than
            // fixed by deleting live keys from a published payload, which is
            // not this card's to do.
            return { handled: true, response: deps.success({ packageId: id, success: true, registryRemoved, persisted }) };
        }
    } catch (e: any) {
        return { handled: true, response: deps.errorFromThrown(e, 500) };
    }

    return { handled: false };
}

/**
 * Assemble a portable, offline-installable package manifest from the
 * `sys_metadata` overlay rows bound to `packageId`.
 *
 * The resulting shape mirrors what `marketplace-install-local` →
 * `manifestService.register()` → `engine.registerApp()` consumes:
 *   `{ id, name, version, objects:[…], views:[…], flows:[…], … }`
 * where each category key is the PLURAL manifest name and its value is
 * an array of clean metadata bodies (provenance decorations stripped).
 *
 * Only the metadata categories that `registerApp` can actually consume
 * are exported. `datasources` and `emailTemplates` are intentionally
 * excluded (not registered by the import path). `tools` / `skills` ARE
 * round-tripped: they are registered by `registerApp` on import and
 * surfaced by `getMetaItems('tool' | 'skill')` on export.
 *
 * @returns the manifest object, or `null` if the package id is unknown
 *          AND has no overlay-authored metadata.
 */
/**
 * [#28411, ADR-0146 D8 item 4, D3] The answer of `GET /packages/:id/customizations`
 * for the installed base `baseId`: three lists, each read from the one owner
 * of its fact, and their lengths. Served rows and ledger rows only; ⛔ no diff
 * against the base and no `basedOn` verdict (ADR-0146 D2, D6).
 *
 *  - **overrides** — the protocol's {@link ObjectStackProtocolImplementation.listServedOverrides}:
 *    the pair's ACTIVE rows the served-override predicate admits, the one the
 *    effective read serves by (N-10). ⛔ Never re-derived here.
 *  - **extensions** — the object registry's `extend` contributors bound to the
 *    pair, on every object the base OWNS (`getObjectOwner`). Each contributor's
 *    `definition` is the extension body as declared (`registerObject` stores it
 *    and folds nothing into an `extend` body), so its `fields`, `validations`
 *    and `indexes` ARE the members it adds: no diff against the base's
 *    definition is needed, and none is made.
 *  - **switchedOff** — the activation ledger's rows recording the base as their
 *    package with `active: false`, through the ledger's one reader
 *    ({@link listPackageMetadataActivations}). A composition with no ledger
 *    object has switched nothing off, which is the ledger's own reading of
 *    absence (ADR-0126 §4: no row means active).
 *
 * No per-organization axis (ADR-0131 D6): every source is environment-level,
 * so every caller the read gate admits gets the same answer. A base with no
 * pair package answers empty overrides and extensions, and nothing here
 * creates the pair.
 */
async function readPackageCustomizations(
    baseId: string,
    listServedOverrides: NonNullable<PackagesDomainProtocol['listServedOverrides']>,
    ql: any,
): Promise<GetPackageCustomizationsResponse> {
    const overrides = await listServedOverrides({ packageId: baseId });

    const pair = customizationPackageId(baseId);
    const registry = ql?.registry;
    type Extension = GetPackageCustomizationsResponse['extensions'][number];
    const extensions: Extension[] = [];
    if (pair.ok && typeof registry?.getAllObjects === 'function') {
        for (const object of registry.getAllObjects(pair.value) as Array<{ name?: unknown }>) {
            const name = object?.name;
            if (typeof name !== 'string' || registry.getObjectOwner(name)?.packageId !== baseId) continue;
            for (const contributor of registry.getObjectContributors(name) as Array<{ packageId?: unknown; ownership?: unknown; definition?: any }>) {
                if (contributor.packageId !== pair.value || contributor.ownership !== 'extend') continue;
                const body = contributor.definition ?? {};
                for (const field of Object.keys(body.fields ?? {})) extensions.push({ object: name, kind: 'field', name: field });
                for (const rule of Array.isArray(body.validations) ? body.validations : []) {
                    if (typeof rule?.name === 'string') extensions.push({ object: name, kind: 'validation', name: rule.name });
                }
                for (const index of Array.isArray(body.indexes) ? body.indexes : []) {
                    extensions.push({
                        object: name,
                        kind: 'index',
                        ...(typeof index?.name === 'string' && index.name !== '' ? { name: index.name } : {}),
                        fields: Array.isArray(index?.fields) ? index.fields.filter((f: unknown): f is string => typeof f === 'string') : [],
                    });
                }
            }
        }
    }
    const kindOrder = { field: 0, validation: 1, index: 2 } as const;
    extensions.sort((a, b) => a.object.localeCompare(b.object)
        || kindOrder[a.kind] - kindOrder[b.kind]
        || (a.name ?? '').localeCompare(b.name ?? ''));

    let ledgerRegistered = true;
    try {
        ledgerRegistered = typeof registry?.getObject !== 'function' || !!registry.getObject(METADATA_ACTIVATION_TABLE);
    } catch {
        // A registry that cannot answer is not an answer: read, and let the read decide.
    }
    const switchedOff = (ledgerRegistered && typeof ql?.find === 'function'
        ? await listPackageMetadataActivations(ql, baseId)
        : [])
        .filter((row) => row.active === false)
        .map((row) => ({ type: row.metadataType, name: row.name }))
        .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

    return {
        packageId: baseId,
        overrides,
        extensions,
        switchedOff,
        counts: { overrides: overrides.length, extensions: extensions.length, switchedOff: switchedOff.length },
    };
}

async function assemblePackageManifest(
deps: DomainHandlerDeps,
packageId: string,
registry: any,
context: HttpProtocolContext,
): Promise<Record<string, any> | null> {
    const protocol = await resolveProtocol(deps, context);
    if (!protocol || typeof protocol.getMetaItems !== 'function') return null;

    // [ADR-0131 D6] No organization: a package's manifest is its environment
    // rows (and its code), the same answer for every caller.

    // Provenance / overlay-bookkeeping keys that must never leak into a
    // portable manifest. Stripped at top level only — nested field bodies
    // are left untouched.
    const PROVENANCE_KEYS = new Set([
        '_packageId', '_packageVersionId', '_provenance', '_state',
        '_version', '_organizationId', '_source', '_id', '_rowId',
    ]);
    const clean = (item: any) => {
        if (!item || typeof item !== 'object') return item;
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(item)) {
            if (k.startsWith('_') || PROVENANCE_KEYS.has(k)) continue;
            out[k] = v;
        }
        return out;
    };

    // Categories the local-install register path understands. Excludes
    // datasources / emailTemplates (not consumed by registerApp).
    const exportPluralKeys = Object.keys(PLURAL_TO_SINGULAR).filter(
        (k) => k !== 'datasources' && k !== 'emailTemplates',
    );

    const manifest: Record<string, any> = {};
    let total = 0;
    for (const plural of exportPluralKeys) {
        const singular = PLURAL_TO_SINGULAR[plural];
        let items: any[] = [];
        try {
            // getMetaItems applies the packageId filter at the
            // registry/overlay query level, so the returned items are
            // already scoped to this package — no client-side re-filter.
            // [#28409, ADR-0146 D8 item 3] A package exports its OWN items:
            // the per-package layer, where the protocol serves one, never the
            // effective read that serves a base's name with its pair's
            // declared override. So the base's export carries the base
            // unchanged, and its `.custom` pair's export carries the
            // overriding item with its `overrides` block.
            const res = typeof protocol.getMetaItemsPerPackage === 'function'
                ? await protocol.getMetaItemsPerPackage({ type: singular, packageId })
                : await protocol.getMetaItems({ type: singular, packageId });
            items = Array.isArray(res?.items) ? res.items : [];
        } catch {
            // Unknown/unsupported type for this runtime — skip.
            continue;
        }
        if (items.length === 0) continue;
        // [#5320] `views` is partitioned rather than dumped: the registry's
        // ADR-0017 dual-read returns the container AND its expanded per-view
        // items, and the stack `views:` vocabulary (container-only) refuses the
        // expanded ones. Containers go to `views:`; expanded items the
        // container re-derives exactly are dropped (`folded` — the importing
        // loop's own expansion recreates them); the rest — standalone
        // ViewItems, overlays, edited expansions — go to `viewItems:`.
        if (plural === 'views') {
            const { views, viewItems } = partitionAssembledViewArtifacts(items.map(clean));
            if (views.length > 0) manifest[plural] = views;
            if (viewItems.length > 0) manifest[ASSEMBLED_VIEW_ITEMS_KEY] = viewItems;
            total += views.length + viewItems.length;
            continue;
        }
        manifest[plural] = items.map(clean);
        total += items.length;
    }

    const pkg = (() => {
        try { return registry?.getPackage?.(packageId); } catch { return undefined; }
    })();

    if (total === 0 && !pkg) return null;

    manifest.id = packageId;
    manifest.name = pkg?.manifest?.name ?? pkg?.name ?? packageId;
    manifest.version = pkg?.manifest?.version ?? pkg?.version ?? '1.0.0';
    if (pkg?.manifest?.label ?? pkg?.label) {
        manifest.label = pkg?.manifest?.label ?? pkg?.label;
    }
    return manifest;
}

/**
 * Apply just-published `seed` metadata: load each seed's rows into its
 * target object so publishing a seed draft makes the data live (the runtime
 * counterpart to staging it). Reads each seed body via the protocol, then
 * runs the {@link SeedLoaderService} — with no caller organization: a seed
 * dataset names the organization it populates (ADR-0131 D9, §12). Best-effort and
 * idempotent (upsert) — callers must never let this fail the publish.
 *
 * Lives at the runtime layer (not in the objectql publish primitive)
 * because the seed loader needs the data engine + metadata service, which
 * objectql cannot depend on without a layering cycle.
 */
async function applyPublishedSeeds(
deps: DomainHandlerDeps,
names: string[],
_context: HttpProtocolContext,
): Promise<{ success: boolean; inserted?: number; updated?: number; errors?: unknown[]; error?: string }> {
    // [#4127] `protocol` keeps its `any` — no written contract, so this is where
    // the ledger honestly ends. `metadata` and `ql` are both evidenced now,
    // `objectql` as of batch 3: it is the same instance the `data` slot holds.
    const protocol = await resolveProtocol(deps, _context);
    const metadata = await deps.getService(_context, CoreServiceName.enum.metadata);
    const ql = await deps.resolveService(_context, 'objectql');
    if (!protocol || typeof protocol.getMetaItem !== 'function' || !ql || !metadata) {
        return { success: false, error: 'seed apply: required services unavailable' };
    }
    const datasets: any[] = [];
    const readErrors: string[] = [];
    for (const name of names) {
        // Read the just-published seed body. The protocol decides the scope,
        // not this call site: [ADR-0131 D6] every metadata read is
        // environment → code, so this read is env-wide by construction:
        // `sys_metadata` carries no organization column (ADR-0131 D6/D7), so
        // the environment's rows are the only partition there is — the one a
        // workspace seed is stored in and cold boot hydrates.
        //
        // [commit 8744de9e9] This used to be a two-attempt org-then-env ladder, written
        // when resolving the wrong scope here is what silently produced "0
        // rows loaded". The gate is that fix now, and it made the org-first
        // rung a byte-identical repeat: both attempts resolved the same
        // partition and served the same answer, so the only thing the second
        // one could still do was report an identical failed read twice on a
        // client-facing `seedApplied.errors[]`.
        //
        // ⛔ Do NOT restore an org-first attempt. An org-scoped `seed` row is
        // the unhydratable phantom `reportUnhydratableOrgScopedRows` exists to
        // warn about — reading it back would serve a body that vanishes at the
        // next restart. Dropping the organization is the REPAIR, exactly as on
        // the `app` flip above.
        let item: any;
        try {
            item = await protocol.getMetaItem({ type: 'seed', name });
        } catch (e) {
            // [#8443] The SAME rule as the catch at the door, applied to the
            // sibling key of the same field: `readErrors` becomes
            // `seedApplied.errors[]` on that 200 response, so it is a
            // client-facing payload too. Measured before the change: with
            // `sys_metadata` unreachable this read fails FIRST — before the
            // loader is ever constructed — and answered `"errors": ["read
            // project_seed: SQLITE_ERROR: no such table: sys_metadata"]`, so
            // fixing only the door's catch would have left the commonest
            // outage shape disclosing exactly as before. A DECLARED 4xx
            // refusal (`[item_locked]`, `[writable_package_required]`, …)
            // still reaches the author verbatim — that is the point of the
            // positive list.
            (deps.logger ?? console).warn(
                `[applyPublishedSeeds] seed body read failed for "${name}": ${(e as Error)?.message ?? String(e)}`,
            );
            readErrors.push(`read ${name}: ${clientFacingFailureText(e, 'the reason is in the server log')}`);
        }
        // protocol.getMetaItem returns a WRAPPER: `{ type, name, item, lock,
        // editable, … }` — the seed body (object/records) lives under
        // `.item`. ([#5563] The HTTP endpoint answers that same envelope now;
        // it used to unwrap on its default path, which is what the parenthetical
        // here used to say.) Tolerate the wrapper (`.item`) plus the
        // body-direct and `.metadata`/`.body` shapes other protocols may return.
        const seed = item?.object && Array.isArray(item?.records)
            ? item
            : (item?.item ?? item?.metadata ?? item?.body);
        if (seed?.object && Array.isArray(seed?.records)) {
            // [#15591] Strip the READ-TIME decorations before the closed parse
            // below. `getMetaItem` exits through `decorateMetadataItem`, which
            // stamps `_diagnostics` on every body whose type has a registered
            // schema — `seed` has one — so the document this door reads back is
            // the platform's own output and `SeedSchema` (closed since #4001)
            // refused it by name: `unrecognized_keys: ["_diagnostics"]`, minted
            // as a 422 by the `safeParse` below, delivered on a **200** as
            // `seedApplied.error`. Zero rows loaded, and the author told their
            // seed body failed spec validation when nothing about it is wrong.
            //
            // ⛔ NOT a blanket `startsWith('_')` strip, and deliberately not the
            // one `assemblePackageManifest` runs 300 lines up: the two paths
            // have opposite obligations, and the spec states both.
            // `METADATA_READ_DECORATIONS` is `['_diagnostics', '_draft']` and
            // its module says the ADR-0010 envelope (`_packageId`,
            // `_provenance`, …) is "deliberately NOT" a member — "the closed
            // metadata schemas allowlist them precisely so a served document
            // keeps its provenance on re-parse". `SeedSchema` is one of those:
            // it spreads `MetadataProtectionFields` on purpose. Measured on the
            // real producer, the served body carries BOTH keys and the schema
            // refuses exactly one — `_packageId` alone parses clean. So the
            // export path's blanket strip would drop provenance this schema
            // accepts, which is why the DECLARED list is the one to use here.
            //
            // ⛔ And NOT a widened schema: nothing about the request contract
            // changes. This removes an annotation the READ path added, which is
            // the only reason the round trip was not already closed.
            datasets.push(stripReadDecorations(seed));
        } else {
            readErrors.push(`seed "${name}" body unreadable (keys: ${item ? Object.keys(item).join(',') : 'none'})`);
        }
    }
    // Seeds were published but none could be read back → surface it (do NOT
    // report success with 0 rows, which hides the failure).
    if (datasets.length === 0) {
        return { success: false, inserted: 0, updated: 0, error: 'seed apply: no readable seed bodies', errors: readErrors };
    }

    const { SeedLoaderService } = await import('../seed-loader.js');
    const { SeedLoaderRequestSchema } = await import('@objectstack/spec/data');
    // [#25779] The service a seed file is stored through; absent, a row naming
    // one is refused by the loader, by name.
    const fieldFiles = await Promise.resolve()
        .then(() => deps.resolveService(_context, FIELD_FILE_SERVICE))
        .catch(() => undefined) as IFieldFileService | undefined;
    const loader = new SeedLoaderService(ql, metadata, deps.logger ?? console, { getFieldFiles: () => fieldFiles });
    // [#8443] `safeParse`, not `parse` — the same producer-side declaration
    // #8333's P9 made next door, for the same reason. This catch's caller now
    // withholds anything undeclared, and a raw `ZodError` declares nothing, so
    // a malformed seed body would have been blanked to `seed apply failed`
    // (measured before the change, it arrived as a multi-line dump of zod
    // internals — authoring feedback, and the one population that must
    // survive). Declaring it 422 at its own producer is what keeps BOTH true:
    // the driver text is withheld and the author still learns which seed and
    // which key. The envelope is minted by `metadata-protocol`'s own helper, so
    // one authoring mistake cannot get two different envelopes depending on
    // which protocol served the publish.
    const parsedRequest = SeedLoaderRequestSchema.safeParse({
        seeds: datasets,
        config: {
            defaultMode: 'upsert',
            multiPass: true,
        },
    });
    if (!parsedRequest.success) throw seedRequestValidationError(parsedRequest.error.issues);
    const r = await loader.load(parsedRequest.data);
    return {
        success: r.success,
        inserted: r.summary.totalInserted,
        updated: r.summary.totalUpdated,
        errors: [...readErrors, ...(r.errors ?? [])],
    };
}
