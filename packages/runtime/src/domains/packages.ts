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
// (`packages/rest/src/package-envelope.conformance.test.ts`), so it names
// `OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES` — same value it read before,
// no re-ruling of the package cohort as a side effect of #7020.
import { OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES } from '@objectstack/metadata-core';
// [#7560] ADR-0070's read-only-package rule — the SAME predicate the metadata
// authoring path asks before refusing a write INTO a platform package
// (`saveMetaItem` → `WRITABLE_PACKAGE_REQUIRED`). Imported, never re-spelled:
// this defect existed precisely because the lifecycle routes had no copy of it,
// and a second copy would be the next place it drifts.
import { isWritablePackage } from '@objectstack/metadata-protocol';
// [#9960] The uninstall seam's DECLARED shapes, from the same producer and for
// the same reason as the predicate above: this door reached `deletePackage`
// through `protocol` and routinely sent two keys — `organizationId`
// and `keepData` — that the sibling REST door's own option type could not even
// express. One statement of the contract, imported by both doors.
import type { DeletePackageRequest, DeletePackageResponse } from '@objectstack/metadata-protocol';
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
// [#8805] Moved to `metadata-core` so the REST `/meta` write doors decide this
// the same way rather than through a second copy. Behaviour unchanged.
import { organizationIdForMetaWrite } from '@objectstack/metadata-core';
// [#15591] The DECLARED removal of our OWN read-time annotations, imported
// from the list that defines them (`METADATA_READ_DECORATIONS`) rather than
// re-spelled here. `applyPublishedSeeds` below re-parses a SERVED document, and
// `spec/kernel/metadata-read-decorations.ts` states the rule this door was
// missing: "a served body is NOT a valid input to the schema that produced it
// until these are removed". Same helper, same reason, as the three consumers
// that already call it — the dataset query in `rest-server.ts`, the cold-boot
// flow bind in `service-automation`, and `saveMetaItem`'s verbatim persist.
import { stripReadDecorations } from '@objectstack/spec/kernel';
import { setPackageDisabled } from '../package-state-store.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

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
 * downstream of it an unchecked call target: the #11006 series' end state —
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
        /** ⚠️ Undeclared request shapes — see "Where the ledger honestly ends". */
        publishPackageDrafts?(request: any): Promise<any>;
        discardPackageDrafts?(request: any): Promise<any>;
        listCommits?(request: any): Promise<any>;
        revertCommit?(request: any): Promise<any>;
        rollbackToPackageCommit?(request: any): Promise<any>;
        reassignOrphanedMetadata?(request: any): Promise<any>;
        duplicatePackage?(request: any): Promise<any>;
        updatePackage?(request: any): Promise<any>;
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
 * ADR-0106 D4 READ gate for the `/packages` domain (#7033 / #7023).
 *
 * Package reads disclose authored metadata — the `GET /packages` id
 * ENUMERATION face (the first step of the survey's attack chain), the
 * `GET /packages/:id` detail, the `GET /packages/:id/commits` history and the
 * `GET /packages/:id/export` whole-package export (27 metadata types) — so each
 * requires one of the two "builder" capabilities the object-schema mask exempts
 * read-only ({@link OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES} =
 * `studio.access` / `setup.access`), or `isSystem`. The read cohort is not the
 * write cohort: an `organization_admin` holding `setup.access` (but not
 * `manage_metadata`) may inspect a package yet not publish or delete it, and a
 * write-only caller holding `manage_metadata` alone is refused these reads —
 * pinned in `packages/rest/src/package-envelope.conformance.test.ts`. (#7020
 * unified the object-schema MASK exemption with the write gate; it did not
 * re-rule this cohort, which is why this site names the read-only half.)
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
 * `<OS_HOME>/package-state/<env>.json`, which the registry re-reads at boot, so
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
 * [#14451] The remedy it names is ADR-0005 org overlay, and it used to name
 * `POST /packages/:id/duplicate` instead. That sentence sent a caller holding a
 * read-only package at a route which — for exactly the packages this refusal
 * fires on — cannot help: duplicate clones a base's `sys_metadata` rows, a code
 * package owns none, and until {@link requireDuplicableSource} the trip ended
 * in a 200 reporting `copiedCount: 0` (the #14451 measurement). A refusal that
 * prescribes a dead end is worse than one that prescribes nothing, so the two
 * doors now agree: overlay is how a code package is customised.
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
            + `the deployment, not over this API — ${action} a package you own, or customise what `
            + `this one provides in place, with an ADR-0005 org overlay.`,
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
 * That is the #11063 ruling, one route over and pointed at a WRITE:
 * `packages/rest/src/package-routes.ts` states it verbatim — **"a read that
 * could not happen must not be reported as a read that found nothing."**
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
 * *Leaning: keep overlay for surgical tweaks*"). ADR-0005 overlay is the built,
 * shipped answer for customising what a code package provides, so the honest
 * behaviour of an unbuilt gesture is to say so.
 *
 * ## Shape
 *
 * Same PREDICATE as every other writability verdict in this file
 * ({@link isWritablePackage}, ADR-0070 D2 — #8146's "one answer to 'is this
 * package writable?'"), a DIFFERENT code. `WRITABLE_PACKAGE_REQUIRED` would be
 * a lie by implicature here: nothing is being written to the source, and its
 * remedy ("use a writable package") reads as *make the source writable*, which
 * is neither possible nor the point. `DUPLICATE_SOURCE_NOT_A_BASE` names the
 * one thing the caller can act on — pick a base, or overlay instead.
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
            + `Duplicate a base you own, or customise what this package provides in place, with an `
            + `ADR-0005 org overlay.`,
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
            let packages = registry.getAllPackages();
            // Apply optional filters
            if (query?.status) {
                packages = packages.filter((p: any) => p.status === query.status);
            }
            if (query?.type) {
                packages = packages.filter((p: any) => p.manifest?.type === query.type);
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
            const rows = packages.map(
                (p: any) => withWritableVerdict(qlService, toPackageResponse(p) as any),
            );
            return { handled: true, response: deps.success({ packages: rows, total: rows.length }) };
        }

        // POST /packages → install package.
        // Route through the canonical `protocol.installPackage` primitive so
        // the install lands in BOTH the in-memory registry (what this list/detail
        // reads) AND the durable `sys_packages` table. Fall back to the bare
        // registry write only when the protocol service/method is unavailable.
        if (parts.length === 0 && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const manifest = body.manifest || body;
            const pkgId = typeof manifest?.id === 'string' ? manifest.id.trim() : '';
            // A package id is mandatory — without one the install cannot be keyed.
            if (!pkgId) {
                return { handled: true, response: deps.error('Package id is required', 400) };
            }
            // Duplicate-detection: POST /packages CREATES a package. If one with
            // this id already exists, silently overwriting it destroys the existing
            // manifest (name/version/…) with no warning — a data-loss footgun
            // surfaced in Studio package-create dogfooding. Reject with 409 Conflict
            // instead. Intentional upgrade / re-install flows opt back in with
            // `overwrite: true` (body) or `?overwrite=true`.
            const overwrite =
                body?.overwrite === true || query?.overwrite === 'true' || query?.overwrite === true;
            if (!overwrite && registry.getPackage(pkgId)) {
                return {
                    handled: true,
                    response: deps.error(`Package '${pkgId}' already exists`, 409),
                };
            }
            let pkg: any;
            const protocolSvc = await resolveProtocol(deps, _context).catch(() => null);
            if (protocolSvc && typeof protocolSvc.installPackage === 'function') {
                const out = await protocolSvc.installPackage({ manifest, settings: body.settings });
                pkg = out?.package ?? out;
            } else {
                pkg = registry.installPackage(manifest, body.settings);
            }
            const res = deps.success(pkg);
            res.status = 201;
            return { handled: true, response: res };
        }

        // PATCH /packages/:id/enable
        if (parts.length === 2 && parts[1] === 'enable' && m === 'PATCH') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
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
            // [#7560] ADR-0070: a platform package is not the operator's to
            // switch off. BEFORE `disablePackage`, and before
            // `setPackageDisabled` writes the choice to disk — a disable that
            // lands is not undone by a restart, it is REPLAYED by one.
            const readOnly = requireWritablePackage(deps, qlService, id, 'disable'); if (readOnly) return readOnly;
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
            const protocol = await resolveProtocol(deps, _context);
            if (protocol && typeof protocol.publishPackageDrafts === 'function') {
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    const result = await protocol.publishPackageDrafts({
                        packageId: id,
                        ...(organizationId ? { organizationId } : {}),
                        ...(body?.actor ? { actor: body.actor } : {}),
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
                                    organizationId,
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
                    // [#7018 / the #6190 ruling, Option A] `app` declares
                    // `allowOrgOverride: false`, so this flip does NOT carry the
                    // session's active organization — it lands env-wide, on the
                    // very row boot hydrates and the App Switcher reads. An
                    // org-scoped flip was a phantom: the app looked published for
                    // the life of the process and went back to `_unpublished:
                    // true` on the next restart, because the env-wide row it left
                    // untouched is the only one cold boot loads. The
                    // `getMetaItems` read below is env-wide for the same
                    // reason, and since #14683 it is so by construction: that
                    // method applies `organizationIdForMetaRead` to
                    // `request.type` itself, and the predicate answers
                    // `undefined` for every type the registry declares
                    // non-overridable — `app` among them, rolled back to
                    // `allowOrgOverride: false` in #6483. The `organizationId`
                    // this route still hands that call is dropped at the gate.
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
                    const flipOrganizationId = organizationIdForMetaWrite('app', organizationId);
                    try {
                        if (
                            typeof protocol.getMetaItems === 'function' &&
                            typeof protocol.saveMetaItem === 'function'
                        ) {
                            const appsRes = await protocol.getMetaItems({
                                type: 'app',
                                packageId: id,
                                ...(organizationId ? { organizationId } : {}),
                            });
                            const apps: any[] = Array.isArray(appsRes)
                                ? appsRes
                                : Array.isArray((appsRes as any)?.items) ? (appsRes as any).items : [];
                            for (const app of apps) {
                                if (app && typeof app === 'object' && app._unpublished === true && typeof app.name === 'string') {
                                    await protocol.saveMetaItem({
                                        type: 'app',
                                        name: app.name,
                                        // `false`, not a delete: ADR-0045 §3 makes
                                        // publish/unpublish symmetric ("unpublish =
                                        // re-hide"), so the gate stays a two-state
                                        // flag rather than a key whose absence has
                                        // to be re-derived. Whatever `hidden` the
                                        // app carries is copied through untouched.
                                        item: { ...app, _unpublished: false },
                                        packageId: id,
                                        ...(flipOrganizationId ? { organizationId: flipOrganizationId } : {}),
                                        ...(body?.actor ? { actor: body.actor } : {}),
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
        // path (no metadata-service dependency, unlike /revert below).
        if (parts.length === 2 && parts[1] === 'discard-drafts' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const protocol = await resolveProtocol(deps, _context);
            if (protocol && typeof protocol.discardPackageDrafts === 'function') {
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    const result = await protocol.discardPackageDrafts({
                        packageId: id,
                        ...(organizationId ? { organizationId } : {}),
                        ...(body?.actor ? { actor: body.actor } : {}),
                    });
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
            const denied = requireReadCapability(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const protocol = await resolveProtocol(deps, _context);
            if (protocol && typeof protocol.listCommits === 'function') {
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    const commits = await protocol.listCommits({
                        packageId: id,
                        ...(organizationId ? { organizationId } : {}),
                    });
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
            const protocol = await resolveProtocol(deps, _context);
            if (protocol && typeof protocol.revertCommit === 'function') {
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    const result = await protocol.revertCommit({
                        commitId,
                        ...(organizationId ? { organizationId } : {}),
                        ...(body?.actor ? { actor: body.actor } : {}),
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
            const protocol = await resolveProtocol(deps, _context);
            if (protocol && typeof protocol.rollbackToPackageCommit === 'function') {
                if (!body?.commitId) {
                    return { handled: true, response: deps.error('Body { commitId } is required', 400) };
                }
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    const result = await protocol.rollbackToPackageCommit({
                        commitId: String(body.commitId),
                        ...(organizationId ? { organizationId } : {}),
                        ...(body?.actor ? { actor: body.actor } : {}),
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

        // POST /packages/:id/adopt-orphans → bulk-rebind package-less (legacy
        // null / 'sys_metadata') metadata INTO this base (ADR-0070 D5 migration;
        // lets the env retire the "Local / Custom" scope once it has no orphans).
        if (parts.length === 2 && parts[1] === 'adopt-orphans' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const protocol = await resolveProtocol(deps, _context);
            if (!protocol || typeof protocol.reassignOrphanedMetadata !== 'function') {
                return { handled: true, response: deps.error('Orphan adoption not supported', 501) };
            }
            try {
                const organizationId = await deps.resolveActiveOrganizationId(_context);
                const result = await protocol.reassignOrphanedMetadata({
                    targetPackageId: id,
                    ...(organizationId ? { organizationId } : {}),
                    ...(body?.actor ? { actor: body.actor } : {}),
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
                const organizationId = await deps.resolveActiveOrganizationId(_context);
                const result = await protocol.duplicatePackage({
                    sourcePackageId: id,
                    targetPackageId,
                    ...(typeof body?.targetName === 'string' ? { targetName: body.targetName } : {}),
                    ...(typeof body?.targetNamespace === 'string' ? { targetNamespace: body.targetNamespace } : {}),
                    ...(organizationId ? { organizationId } : {}),
                    ...(body?.actor ? { actor: body.actor } : {}),
                });
                return { handled: true, response: deps.success(result) };
            } catch (e: any) {
                return { handled: true, response: deps.errorFromThrown(e, 500) };
            }
        }

        // GET /packages/:id → get package
        if (parts.length === 1 && m === 'GET') {
            const denied = requireReadCapability(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const pkg = registry.getPackage(id);
            if (!pkg) return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            // [#14375] Same verdict, same predicate as the list door — and
            // [#14309] the same project-then-stamp order, for the same reason.
            return {
                handled: true,
                response: deps.success(withWritableVerdict(qlService, toPackageResponse(pkg) as any)),
            };
        }

        // PATCH /packages/:id → edit the manifest (name / description /
        // version). A partial patch: only the fields present are changed;
        // lifecycle state (enabled / status / installedAt) is preserved.
        // `id` / `scope` / `type` are identity/structure and are NOT editable
        // here. Body accepts the fields flat or under a `manifest` wrapper.
        if (parts.length === 1 && m === 'PATCH') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const src = (body?.manifest && typeof body.manifest === 'object' ? body.manifest : body) ?? {};
            const patch: { name?: string; description?: string; version?: string } = {};
            if (typeof src.name === 'string') patch.name = src.name.trim();
            if (typeof src.description === 'string') patch.description = src.description;
            if (typeof src.version === 'string') patch.version = src.version.trim();

            if (patch.name !== undefined && patch.name === '') {
                return { handled: true, response: deps.error('name must not be empty', 400) };
            }
            if (patch.version !== undefined && !/^\d+\.\d+\.\d+$/.test(patch.version)) {
                return { handled: true, response: deps.error('version must be semantic (e.g. 1.0.0)', 400) };
            }
            if (patch.name === undefined && patch.description === undefined && patch.version === undefined) {
                return { handled: true, response: deps.error('Body { name?, description?, version? } — nothing to update', 400) };
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
            // [#7560] ADR-0070: refuse BEFORE `uninstallPackage`, which is the
            // call that removed a platform package from the running registry
            // listing (and with it every object the package registers) until
            // the next restart.
            const readOnly = requireWritablePackage(deps, qlService, id, 'delete'); if (readOnly) return readOnly;
            const registryRemoved = registry.uninstallPackage(id);

            // Persisted removal (AI/runtime packages live in sys_metadata, not
            // just the in-memory registry — the registry uninstall alone would
            // leave the rows and tables behind).
            let persisted: DeletePackageResponse | undefined = undefined;
            // [#9960] `protocol` is an UNCONTRACTED service slot — `ServiceSlotContracts`
            // leaves it unmapped on purpose ("no written contract … rather than being
            // given a shape nothing checks") — so `resolveService` hands this door an
            // `any`. That `any` is what let the call below send keys no declared shape
            // named: `organizationId` (the key that decides an uninstall's blast radius)
            // and `keepData` are exactly the two the sibling REST door's option type
            // could not express, and nothing compared the two doors' requests. Narrowed
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
            const protocol = await resolveProtocol(deps, _context);
            if (protocol && typeof protocol.deletePackage === 'function') {
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    const keepData = query?.keepData === 'true' || query?.keepData === '1';
                    persisted = await protocol.deletePackage({
                        packageId: id,
                        ...(organizationId ? { organizationId } : {}),
                        ...(keepData ? { keepData: true } : {}),
                    });
                } catch (e: any) {
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
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
            // The failure rule is the one the REST twin of this route already
            // uses (`packages/rest/src/package-routes.ts`), stated the same way
            // on purpose — DELETE /packages/:id has TWO doors (this dispatcher
            // and the direct-mount REST registrar, which shadows it only when a
            // `package` service is registered), and two doors answering one
            // request differently is how this divergence arrived. Zero metadata
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
            if (!registryRemoved && deletedCount === 0) {
                return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            }
            return { handled: true, response: deps.success({ success: true, registryRemoved, persisted }) };
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
async function assemblePackageManifest(
deps: DomainHandlerDeps,
packageId: string,
registry: any,
context: HttpProtocolContext,
): Promise<Record<string, any> | null> {
    const protocol = await resolveProtocol(deps, context);
    if (!protocol || typeof protocol.getMetaItems !== 'function') return null;

    const organizationId = await deps.resolveActiveOrganizationId(context);

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
            const res = await protocol.getMetaItems({ type: singular, packageId, organizationId });
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
 * runs the {@link SeedLoaderService} for the active org. Best-effort and
 * idempotent (upsert) — callers must never let this fail the publish.
 *
 * Lives at the runtime layer (not in the objectql publish primitive)
 * because the seed loader needs the data engine + metadata service, which
 * objectql cannot depend on without a layering cycle.
 */
async function applyPublishedSeeds(
deps: DomainHandlerDeps,
names: string[],
organizationId: string | undefined,
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
        // Read the just-published seed body. THE REGISTRY DECIDES THE SCOPE,
        // not this call site: `seed` declares `allowOrgOverride: false`, and
        // since #14908 `getMetaItem` opens by resolving
        // `organizationIdForMetaRead(request.type, request.organizationId)`
        // and spends THAT binding — never the raw argument — on every read
        // beneath it. The predicate answers `undefined` for every type the
        // registry declares non-overridable, so this read is env-wide by
        // construction: `organization_id IS NULL`, the partition a workspace
        // seed is stored in and the only one cold boot hydrates.
        //
        // [#15068] This used to be a two-attempt org-then-env ladder, written
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
    const loader = new SeedLoaderService(ql, metadata, deps.logger ?? console);
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
            ...(organizationId ? { organizationId } : {}),
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
