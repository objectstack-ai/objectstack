// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MarketplaceInstallLocalPlugin
 *
 * Installs marketplace packages into THIS runtime's kernel as opposed to a
 * remote cloud environment. Conceptually different from cloud install in
 * three important ways:
 *
 *   1. Single target — the local kernel is the only install target; there
 *      is no `sys_environment` picker.
 *   2. Manifests are cached on disk — once installed, the package is
 *      runnable offline. Cloud is only needed during the install action
 *      itself (to fetch the manifest snapshot).
 *   3. Coexists with user-authored apps — the local runtime usually has
 *      its own `objectstack.config.ts` declared apps. Install refuses to
 *      overwrite a manifest_id that's already registered to avoid silently
 *      replacing user code.
 *
 * Endpoints (mounted by `start()` on the `kernel:ready` hook):
 *
 *   POST   /api/v1/marketplace/install-local
 *          body: { packageId: string, versionId?: string }   (default: "latest")
 *          → fetches manifest from cloud, caches to disk, registers via
 *            the kernel's `manifest` service. Returns the installed entry.
 *            The manifest's `id` is parsed through `ManifestSchema.shape.id`
 *            before anything else looks at it; an id the declaration refuses
 *            answers `PLUGIN_MANIFEST_INVALID` (400 for an inline manifest,
 *            502 for a cloud snapshot) and nothing is registered or written.
 *            A package declaring code this door cannot run answers
 *            `VALIDATION_ERROR` (422) the same way: an enabled job with no
 *            `body`, or one whose `body` the declaration refuses (#21585), and
 *            a hook with no `body` (#21585) — a function-name `handler` is code
 *            no JSON door carries. The package's job bodies are scheduled on
 *            install and on every rehydrate; on a rehydrate, a hook with no
 *            `body` that an older build installed is warned and NOT bound.
 *            A manifest whose `engines.protocol` excludes this runtime's major
 *            answers `OS_PROTOCOL_INCOMPATIBLE` (422) with the handshake's
 *            diagnostic in `error.details`, the answer `POST /api/v1/packages`
 *            gives (ADR-0087 D1, #21762), and nothing is registered or written.
 *            The answer's `hotLoaded` says whether the running kernel's
 *            `manifest.register` resolved (#22695). An inline manifest whose
 *            register throws is refused (`PLUGIN_REGISTER_FAILED`, 422); a
 *            cloud-fetched one is still installed (the lenient path) and answers
 *            `200` with `hotLoaded: false` and the register error's message as
 *            `hotLoadError` — in the ledger, loaded at the next restart —
 *            unless the register was refused because an environment-authored
 *            item already holds a position, permission set or capability name
 *            the package ships (#25366): no restart clears that, so both
 *            branches refuse it (`PLUGIN_REGISTER_FAILED`, 422) and nothing is
 *            registered or written.
 *
 *          `installMode: 'managed' | 'unmanaged'` (ADR-0131 D6; absent means
 *          `managed`, the key parsed against `InstallModeSchema`) chooses
 *          HOW the package is installed, on either source:
 *            - `managed`: everything above — registered as code, ledgered,
 *              upgradeable. Refused `409 RESOURCE_CONFLICT` when a WRITABLE
 *              base holds the package's namespace (an unmanaged copy of it),
 *              naming the base, before any write.
 *            - `unmanaged`: the package's metadata is copied ONCE into a new
 *              writable base in the environment ledger
 *              (`importUnmanagedPackage`): the environment's own metadata,
 *              which the next save edits, followed by no upgrade. The
 *              package's protection lock is not copied, in either spelling
 *              (`_lock`, or a `protection` block on a type that declares
 *              one): the answer's `strippedLocks` names each lock dropped,
 *              with the package's reason (ADR-0010 §3.3 and Phase 4.3; the
 *              ruling on the D6 lock fork, record 6119681934);
 *              nothing is registered, ledgered or rehydrated under the
 *              package's id, and its sample data is not loaded. Refused
 *              `409 UNMANAGED_INSTALL_WALLED_POSTURE` on a deployment whose
 *              REQUESTED tenancy posture walls organizations: after the
 *              payload check, step 1b (package id), the ADR-0131 D3
 *              walled-catalog refusal and step 1c (protocol handshake),
 *              none of which writes, and before any write.
 *          A mode the package's `installModes` does not permit answers
 *          `422 INSTALL_MODE_NOT_PERMITTED`, before any write.
 *
 *          [ADR-0126 §6 wall 3] A managed RE-install over an installed package
 *          asks the security plugin's access upgrade check
 *          (`security.accessUpgradeCheck`) what the upgrade would un-make: a
 *          switch-off a vendor rename re-enables, a switch, clone reference or
 *          sharing rule row whose name it no longer ships, a sharing rule name
 *          collision, a field deny a customer's set lacks. A finding answers
 *          `409 ACCESS_UPGRADE_CONFIRMATION_REQUIRED` with `details.findings`
 *          and the finding set's token, before any write; the same request
 *          with `confirmAccessUpgrade: <token>` installs, and records the
 *          confirmation in the ledger entry. A check that could not read
 *          answers `503 SERVICE_UNAVAILABLE`. Under a wall only the operator
 *          reaches this step (ADR-0131 D12 items 7–8).
 *
 *   GET   /api/v1/marketplace/install-local
 *          → lists currently installed marketplace packages. Requires an
 *            authenticated principal (anonymous → 401); `installedBy` and
 *            `storageDir` are served only to a `manage_metadata` holder
 *            (commit 01074e551). The four routes above require `manage_metadata`
 *            outright (#8976). Each entry's `withSampleData` says whether the
 *            caller's own scope — its active organization under a wall —
 *            holds any of the package's seed rows, read from the rows, never
 *            from the install-wide ledger record (#21775). An entry this boot's
 *            rehydrate refused to load is still listed, with a `notLoaded`
 *            marker in place of `withSampleData` carrying the refusal's code
 *            and the declared range, and no seed row is read for it (#21822).
 *
 *   DELETE /api/v1/marketplace/install-local/:manifestId
 *          → refused `409 RESOURCE_CONFLICT`, with the registry's own
 *            sentence and nothing removed, when the running registry would
 *            refuse the uninstall: the package's paired customization package
 *            (`<id>.custom`) is installed (ADR-0146 D3), or another package
 *            extends an object it owns (ADR-0029) (#28511). Otherwise
 *            removes the cached manifest, withdraws the package from the
 *            running kernel through the registry's `uninstallPackage` — the
 *            verb the protocol's own uninstall uses — so its objects answer
 *            404 at once (#21576), and the copies of its objects the install
 *            bridged into the `metadata` service, so the object reads stop
 *            serving them at once too (#24070), then runs the uninstall
 *            cleanups domain plugins registered with the protocol (#21490) —
 *            the package's permission sets and their grants go with it — and
 *            last announces the withdrawal as `metadata:reloaded`, so the
 *            automation engine withdraws the package's flows and unbinds their
 *            triggers at once (#27395); it reports each outcome as `cleanups`,
 *            a refused withdrawal or a re-sync that did not run included.
 *
 * Persistence layout:
 *   <cwd>/.objectstack/installed-packages/<safe-manifest-id>.json
 *   Each file: { packageId, versionId, manifestId, version, manifest, installedAt, installedBy }
 *
 * On `kernel:ready`, the plugin scans the directory and re-registers each
 * cached manifest so installs survive process restarts without further
 * cloud round-trips. An entry whose `engines.protocol` excludes this runtime's
 * major is not loaded: it is reported at `error`, naming the replay command,
 * and the boot continues (ADR-0087 D1, #21762). The GET listing marks it as
 * not loaded for as long as that ledger entry stands (#21822). The reseed and
 * purge doors run the handshake on the entry themselves and refuse such an
 * entry with the install route's `OS_PROTOCOL_INCOMPATIBLE` (422) before any
 * side effect; DELETE and a compatible re-install still act on it (#21834).
 */

import type { Plugin, PluginContext } from '@objectstack/core';
import {
    resolveAuthzContext,
    isAuthzStoreUnavailableError,
    // ADR-0069 — the authentication-policy gate's ONE decision, asked of the
    // posture `resolveInstallPrincipal`'s shared resolver decided (see
    // `refuseHeldSession`).
    evaluateAuthGate,
    type AuthGate,
    // [#23455] The auth service's per-user posture computation, bound for the
    // shared key-admission seam.
    userAuthGateSourceOf,
    // [#23367] The API-key lifecycle policy source, and its branded refusal.
    apiKeyLifecyclePolicySourceOf,
    isApiKeyLifecycleRefusalError,
    // [#16013] The ADMISSION seam's posture derivation, in ONE call — the same
    // symbol `packages/rest`'s seam now imports, for the same reason. It reads
    // the posture IN FORCE off the kernel's `tenancy` service and carries
    // decision-1-option-A's classification (#13906): never-registered is
    // branded and quiet, every other rejection is the outage it is.
    classifyAdmissionTenancyPosture,
    type TenancyPostureSource,
    // [ADR-0141 D5] The rehydrate's dependency order — the sorter, and the
    // readings of a package's id and its declared dependencies it sorts by.
    orderHydrationBatch,
    artifactPackageId,
    declaredDependencyIds,
} from '@objectstack/core';
import {
    resolveTenancyPosture,
    collectGlobalUniques,
    unconfirmedGlobalUniques,
    recordGlobalUniqueAttestation,
    buildGlobalUniqueStopMessage,
    describeGlobalUniqueFinding,
    postureGatesGlobalUniques,
    GLOBAL_UNIQUE_CONFIRMATION_REQUIRED,
    type GlobalUniqueFinding,
    // [#22258] The in-process session-read rule — both session reads below.
    inProcessSessionReadInput,
} from '@objectstack/types';
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import {
    ManifestSchema,
    manifestIdRefusal,
    InstallModeSchema,
    resolveInstallModes,
    deriveNamespaceFromPackageId,
    unmanagedInstallValueCarries,
    type InstallMode,
} from '@objectstack/spec/kernel';
// [#21762] ADR-0087 D1's protocol handshake, its brand predicate and the ONE
// answer both package-install doors give its refusal. Imported from the
// producer, never restated: `POST /api/v1/packages` answers through the same
// helper, so the two doors cannot drift apart on the wire. [#21834] The
// sample-data doors answer a refused ledger entry through it too.
import {
    assertProtocolCompat,
    checkProtocolCompat,
    // [ADR-0141 D2] The pre-install dependency check: the one predicate and
    // the one answer every package-install door gives its refusal.
    checkDeclaredDependencies,
    DependencyMissingError,
    dependencyMissingAnswer,
    isProtocolIncompatibleError,
    protocolIncompatibleAnswer,
    ProtocolIncompatibleError,
    type ProtocolIncompatibleDiagnostic,
    // [ADR-0131 D3 · D12 items 7–8] The walled refusal's one predicate: the
    // same sentence, the same rung, as every environment-metadata write door.
    walledCatalogWriteVerdict,
    // [ADR-0146 D10, second rule] The field-patch target check — the judge
    // `os validate` asks and the registry fold names its misses by.
    fieldPatchTargetRefusals,
    fieldPatchTargetRefusalMessage,
    type FieldPatchTargetRefusal,
} from '@objectstack/metadata-core';
import { resolveCloudUrl } from './cloud-url.js';
import { resolveMarketplacePublicBaseUrl } from './marketplace-public-url.js';
import { join } from 'node:path';

import {
    LocalManifestSource,
    type InstalledManifestEntry,
    type InstalledManifestListing,
    type SkippedManifestEntry,
} from './local-manifest-source.js';
import { ConnectionCredentialStore } from './connection-credential-store.js';
import { readJsonRequestBody } from './request-json-body.js';
import { MARKETPLACE_INSTALLED_UI_BUNDLE } from './marketplace-ui.js';
import { matchSeedRows, purgeSeedRows, type PurgeSeedDataset } from './marketplace-install-local-purge.js';
import type {
    AuthSessionApi, ConnectorCredentialRef, IAuthService, IAutomationService, IHttpServer, IMetadataService, IObjectQLEngine,
} from '@objectstack/spec/contracts';
import type {
    DeletePackageRequest,
    UninstallCleanupOutcome,
    UninstallDeclared,
    ObjectStackProtocolImplementation,
    PackageWritabilityEngine,
} from '@objectstack/metadata-protocol';
// [ADR-0131 D6] The `unmanaged` install mode's two shared judgements, imported
// from their producer rather than restated: the walled-posture refusal the
// import verb raises (answered here after the payload, id and handshake checks,
// before any write), the read-only-package rule (a namespace held by a WRITABLE base is
// this environment's own metadata), and the client-facing sentence rule.
import { unmanagedInstallPostureRefusal, isWritablePackage, clientFacingFailureText, captureUninstallDeclared } from '@objectstack/metadata-protocol';
// [ADR-0146 D2, #28410] The override write gate's one rule and its item walk,
// asked at the managed install exactly as the publish doors ask them.
import { judgeOverrideWrite, overrideWriteItemsOf, type OverrideWriteItem, type OverrideWriteRule } from '@objectstack/metadata-protocol';
import { resolveThrownHttpError } from '@objectstack/types';
// [#25366] The code the registry's security-catalog refusal carries, compared
// rather than `instanceof`-tested: the engine keeps the class unexported so a
// consumer holding the other build realm's copy cannot misread it.
import { NAMESPACE_CONFLICT_CODE } from '@objectstack/objectql';

/** What the auth service's in-process session read answers, as `AuthSessionApi` declares it. */
type SessionRead = Awaited<ReturnType<NonNullable<AuthSessionApi['getSession']>>>;

const ROUTE_BASE = '/api/v1/marketplace/install-local';

/**
 * [#25366] Whether a `manifest.register` failure is the registry's security
 * catalog refusal (`SecurityCatalogNameConflictError`, ADR-0048 §3.4 narrowed;
 * `security-catalog-namespace.ts` in `@objectstack/objectql`) naming an
 * environment-authored holder for at least one of the names the package ships.
 *
 * That refusal is the ONE pre-write check for the rule: the registry's package
 * door raises it ahead of every mutation it makes, for every door that installs
 * a package, so this door asks it rather than keeping a second reading of who
 * holds a name. The error is recognised by its code plus its `conflicts` list —
 * the namespace gate shares the code and carries no list.
 *
 * An environment holder is the one a restart never clears: the environment's
 * item is loaded from `sys_metadata` at every boot, and a load of the package
 * — the next install, or this ledger entry at the next rehydrate — meets it
 * again. A holder that is another package or a built-in is not judged here.
 */
function refusesEnvironmentHeldCatalogName(err: unknown): boolean {
    if ((err as { code?: unknown } | null)?.code !== NAMESPACE_CONFLICT_CODE) return false;
    const conflicts = (err as { conflicts?: unknown }).conflicts;
    return Array.isArray(conflicts)
        && conflicts.some((c) => (c as { existingHolder?: { kind?: unknown } } | null)?.existingHolder?.kind === 'environment');
}

/**
 * [#21490] The one `protocol` verb this plugin calls: the runner of the
 * uninstall cleanups domain plugins register through
 * `registerUninstallCleanup` — the same registry, through the same runner,
 * that the protocol's own uninstall (`deletePackage`) runs.
 *
 * The `protocol` slot is uncontracted (`ServiceSlotContracts` leaves it
 * unmapped), so this is a per-consumer narrowing, the shape
 * `PackagesDomainProtocol` gives `deletePackage` in
 * `packages/runtime/src/domains/packages.ts`: the verb's name is this file's,
 * its request and outcome types are the producer's own declared ones — never
 * a restatement here.
 *
 * Optional, and asked as a capability question at the call site: a protocol
 * from a build without the runner holds cleanups this door cannot run, and
 * the uninstall says so instead of answering as if they had run.
 */
type UninstallCleanupRunner = {
    runUninstallCleanups?(
        request: Pick<DeletePackageRequest, 'packageId' | 'actor'> & { declared?: UninstallDeclared },
    ): Promise<UninstallCleanupOutcome[]>;
};

/** The outcome name this door reports when the runner itself could not run. */
const UNINSTALL_CLEANUP_RUNNER = 'protocol.runUninstallCleanups';

/**
 * [#21576] The outcome name this door reports when the running kernel did not
 * withdraw the uninstalled package — named for the registry verb, as the one
 * above is named for the protocol's.
 */
const REGISTRY_WITHDRAWAL = 'registry.uninstallPackage';

/**
 * [#24070] The outcome name this door reports when the `metadata` service kept
 * a copy of one of the uninstalled package's objects — named for the service
 * verb that withdraws it, as the one above is named for the registry's.
 */
const OBJECT_COPY_WITHDRAWAL = 'metadata.unregister';

/**
 * [#27395] The outcome name this door reports when the running kernel was not
 * told of the withdrawal — named for the event it announces, the re-sync the
 * automation engine withdraws an uninstalled package's flows on.
 */
const KERNEL_RESYNC = 'metadata:reloaded';

/**
 * [#8976] The capability every MUTATING install-local route demands.
 *
 * `manage_metadata` is ADR-0066 D1's authoring capability and the SAME key the
 * platform's other metadata-write doors already require — `PUT`/`DELETE`
 * `/api/v1/meta/:type/:name`, `POST /meta/_migrate-stored`, and since commit b5378550e the
 * publish/rollback promotion verbs. These four routes are a metadata-write door
 * by every measure that matters: `POST` hot-registers an inline manifest's
 * objects into the shared registry and then runs `syncSchemas()` against the
 * shared database. Declaring them operator-grade while enforcing "anyone with a
 * login" is the declared-≠-enforced gap this closes.
 *
 * ⛔ Not a new install-specific capability. Inventing one would leave every
 * existing operator unable to install until an administrator granted a key that
 * did not exist yesterday, and would split "may author metadata" from "may
 * install metadata" — a product decision nobody has made. The shipped
 * `admin_full_access` set carries `manage_metadata`
 * (`PLATFORM_ADMIN_ONLY_CAPABILITIES`, plugin-security), so platform operators
 * pass unchanged; `organization_admin` deliberately does NOT carry it, which is
 * precisely the cross-tenant edge this closes on the walled multi-org shape.
 *
 * Service / operator tokens are exempt EXACTLY as elsewhere, with no special
 * case here: an API key resolves through `resolveAuthzContext`'s key path to its
 * owner's real grants, so a key whose owner holds `manage_metadata` passes this
 * gate and one whose owner does not is refused — the same answer the `/meta`
 * doors give the same credential.
 */
const INSTALL_LOCAL_CAPABILITY = 'manage_metadata';

/**
 * [#21489, #21585] The refusal of a package that declares code this door cannot
 * run — an enabled job with no `body`, with a `body` the declaration refuses or
 * with a `pull` that does not bind, a hook with no `body`: `VALIDATION_ERROR` /
 * 422.
 *
 * The code is the standard catalog's input-validation member. The condition is
 * that the install payload fails this door's acceptance rule — every enabled
 * job carries a `body` or a `pull` that binds, and every hook carries a `body`
 * — and the ledger's admission rule sends a generic validation condition to the
 * standard member rather than to a registered synonym (`error-code-ledger.zod.ts`,
 * "Registering a new code"). What the author does instead is the prescription
 * the message carries. `PLUGIN_MANIFEST_INVALID` is deliberately not it: that
 * code answers the manifest's identity at this door, and a handler-form job or
 * hook is a valid manifest — `os validate` passes it and `os start --artifact`
 * runs it. One acceptance rule answers one code, so the off-spec job `body` and
 * the unbindable `pull` (which `os validate` does refuse) are answered by the
 * same refusal as the rest of the rule rather than splitting it.
 *
 * The status is 422, not the 400 / 502 split this door uses for an invalid
 * manifest id: the package is well-formed JSON this door cannot process, which
 * holds whichever branch supplied it — a catalog package declaring a handler job
 * is no upstream fault. 422 derives `VALIDATION_ERROR`
 * (`standardErrorCodeForHttpStatus`), so code and status agree.
 */
const UNRUNNABLE_REFUSAL_CODE = 'VALIDATION_ERROR';
const UNRUNNABLE_REFUSAL_STATUS = 422;

/**
 * [ADR-0131 D6] The refusal of an install mode the package does not permit:
 * its manifest's `installModes` (read through `resolveInstallModes`, absent
 * meaning `['managed']`) does not list the requested mode. 422 — the request
 * is well formed and the package refuses that way of installing it; the
 * remedy is a permitted mode, named in the message and in
 * `details.permitted`. Its own code because a consumer's branch differs from
 * every other refusal here: retrying with another mode helps, rewriting the
 * package does not need to.
 */
const INSTALL_MODE_NOT_PERMITTED_CODE = 'INSTALL_MODE_NOT_PERMITTED';
const INSTALL_MODE_NOT_PERMITTED_STATUS = 422;

/**
 * [ADR-0126 §6 wall 3] The refusal of an upgrade that would un-make an access
 * choice made in this system — a switch-off a vendor rename re-enables, a
 * switch, clone or sharing rule row whose name the package no longer ships, a
 * declared sharing rule an organization's row already holds, a name a
 * customer's set or rule references and the upgrade drops, a field deny the
 * customer's sets lack. 409: the request is well formed and holds until the
 * caller answers, as the D5e gate's does. Its own code because the caller's
 * branch is its own: the same request with the finding set's token installs,
 * and neither the D5e answer (per-index unique confirmations) nor a conflict
 * (which no confirmation lifts) leads there.
 */
const ACCESS_UPGRADE_CONFIRMATION_REQUIRED = 'ACCESS_UPGRADE_CONFIRMATION_REQUIRED';
const ACCESS_UPGRADE_CONFIRMATION_STATUS = 409;

/**
 * [ADR-0126 §6 wall 3] The service plugin-security registers the access
 * upgrade check under — asked as a capability question, so this package takes
 * no dependency on plugin-security. Without it, a re-install is not checked
 * against the access choices it could un-make, and the door says so once per
 * upgrade.
 */
const ACCESS_UPGRADE_CHECK_SERVICE = 'security.accessUpgradeCheck';

/** A finding of the access upgrade check, as this door reads it (`access-upgrade-report.ts`). */
type AccessFinding = Record<string, any>;

/** The check's answer, as this door reads it (`access-upgrade-check.ts` declares it). */
type AccessUpgradeCheckAnswer =
    | { outcome: 'clean' }
    | {
        outcome: 'findings';
        findingSet: string;
        findings: {
            orphans: AccessFinding[];
            reEnablements: AccessFinding[];
            collisions: AccessFinding[];
            brokenReferences: AccessFinding[];
            uncoveredDenies: AccessFinding[];
        };
    }
    | { outcome: 'stopped'; stop?: string; reading: string; error?: string };

/** The service, narrowed per consumer: the one verb this door calls. */
type AccessUpgradeCheckService = {
    check?(request: { packageId: string; manifest: unknown; previousManifest?: unknown }): Promise<AccessUpgradeCheckAnswer>;
};

/** One finding per line, for the refusal's `details.findings`: what it is and what un-made it. */
function describeAccessFindings(report: Extract<AccessUpgradeCheckAnswer, { outcome: 'findings' }>['findings']): AccessFinding[] {
    const out: AccessFinding[] = [];
    const reEnabled = new Set(report.reEnablements.map((r) => `${r.type}:${r.name}`));
    for (const r of report.reEnablements) {
        const candidates = (r.candidates as Array<{ name: string; positions: string[] }>);
        const through = candidates.flatMap((c) => c.positions ?? []);
        out.push({
            kind: 're-enablement', type: r.type, name: r.name, packageId: r.packageId, candidates,
            describe: `${r.type} '${r.name}' is switched off in this system and the upgrade no longer ships it; `
                + `the package ships ${candidates.map((c) => `'${c.name}'`).join(', ')} with no switch, `
                + 'active by default — suspected to be its new name'
                + (through.length > 0 ? `, granted through position(s) ${[...new Set(through)].map((p) => `'${p}'`).join(', ')}` : '')
                + '.',
        });
    }
    for (const o of report.orphans) {
        if (reEnabled.has(`${o.type}:${o.name}`)) continue;
        out.push({
            kind: 'orphan', type: o.type, name: o.name, packageId: o.packageId, switchedOff: o.switchedOff,
            describe: `${o.type} '${o.name}' carries a ${o.switchedOff ? 'switch-off' : 'switch'} in this system, `
                + 'and the upgrade no longer ships it, so the switch would cover nothing.',
        });
    }
    for (const col of report.collisions) {
        out.push({
            kind: 'collision', type: 'sharing_rule', name: col.rule, rowId: col.rowId, organizationId: col.organizationId,
            describe: `the upgrade declares sharing rule '${col.rule}', whose name a sharing rule authored in this system `
                + 'holds, so the declared rule would be served nowhere in that scope.',
        });
    }
    for (const b of report.brokenReferences) {
        const missing = (b.missing as Array<{ kind: string; name: string }>);
        out.push({
            kind: 'broken-reference', type: b.type, name: b.name,
            ...(b.rowId !== undefined ? { rowId: b.rowId, organizationId: b.organizationId ?? null } : {}),
            missing,
            describe: `${b.type === 'permission' ? 'permission set' : 'sharing rule'} '${b.name}', authored in this system, `
                + `names ${missing.map((m) => `${m.kind} '${m.name}'`).join(', ')}, which the upgrade no longer ships.`,
        });
    }
    for (const u of report.uncoveredDenies) {
        const fields = (u.fields as Array<{ field: string; denies: string }>);
        out.push({
            kind: 'uncovered-deny', type: 'permission', name: u.customerSet, managedSet: u.managedSet, object: u.object, fields,
            describe: `the upgraded set '${u.managedSet}' denies ${fields.map((f) => `${f.denies} on '${f.field}'`).join(', ')}, `
                + `and permission set '${u.customerSet}', authored in this system and granting '${u.object}', has no entry `
                + 'for it, so the field stays open through it.',
        });
    }
    return out;
}

/**
 * [ADR-0131 D6] The one verb the `unmanaged` install mode calls: the
 * copy-once import. Typed from the producer's own method signature, the
 * shape `PackagesDomainProtocol` gives its verbs in
 * `packages/runtime/src/domains/packages.ts`, and asked as a capability
 * question at the call site — a protocol from a build without the verb cannot
 * install unmanaged, and the door says so instead of falling back.
 */
type UnmanagedImporter = {
    importUnmanagedPackage?: ObjectStackProtocolImplementation['importUnmanagedPackage'];
};

/**
 * [ADR-0131 D6] What the managed-after-unmanaged refusal reads off the
 * `objectql` slot: who holds a namespace, and — through ADR-0070's one
 * predicate, whose own structural contract this extends — whether a holder is
 * a writable base. A narrow per-consumer interface, so the lookup carries a
 * contract rather than erasing the slot.
 */
type NamespaceHoldingEngine = PackageWritabilityEngine & {
    registry?: PackageWritabilityEngine['registry'] & {
        getNamespaceOwners?(namespace: string): unknown;
    };
};

/**
 * [ADR-0146 D2, #28410] What the managed install's override gate reads: the
 * registry's package records (each package's declared `dependencies`) and the
 * protocol's per-package item listing (`getMetaItems`, code-registered and
 * authored items alike — a `<base>.custom` an administrator built in Studio
 * holds its items in the store, not the registry).
 */
type OverrideGateEngine = PackageWritabilityEngine & {
    registry?: PackageWritabilityEngine['registry'] & {
        getAllPackages?(): unknown;
    };
};
type OverrideGateLister = {
    getMetaItems?(request: { type: string; packageId?: string }): Promise<unknown> | unknown;
};

/** One item the managed install refuses under the override write gate. */
export interface OverrideInstallRefusal {
    type: string;
    name: string;
    /** The delivered package the item belongs to — on a multi-package artifact only. */
    packageId?: string;
    rule: OverrideWriteRule;
    message: string;
}

/**
 * One name an installed dependent already holds that this (re)install of its
 * base now ships, undeclared — listed on the answer, never refused: a base
 * upgrade is the vendor's, and the dependent's item is the one to rename (or,
 * in the base's paired `.custom`, to declare).
 */
export interface OverrideUpgradeCollision {
    type: string;
    name: string;
    /** The installed package holding the name. */
    packageId: string;
    rule: OverrideWriteRule;
    message: string;
}

function dependencyIdsOf(manifest: unknown): string[] {
    const declared = (manifest as { dependencies?: unknown } | null | undefined)?.dependencies;
    if (Array.isArray(declared)) return declared.filter((d): d is string => typeof d === 'string' && d !== '');
    return declared !== null && typeof declared === 'object' ? Object.keys(declared) : [];
}

/** A listing answer as an item array: `getMetaItems` answers `{ items }`, a double may answer the array. */
function listedItems(answer: unknown): Record<string, unknown>[] {
    const items = Array.isArray(answer) ? answer : (answer as { items?: unknown } | null | undefined)?.items;
    return Array.isArray(items)
        ? items.filter((i): i is Record<string, unknown> => i !== null && typeof i === 'object' && !Array.isArray(i))
        : [];
}

/** An item's registry identity — `overrideWriteItemsOf`'s: an action is `<objectName>:<name>`. */
function listedIdentity(type: string, item: Record<string, unknown>): string | undefined {
    const name = typeof item.name === 'string' && item.name !== '' ? item.name : undefined;
    if (name === undefined) return undefined;
    if (type === 'action' && typeof item.objectName === 'string' && item.objectName !== '' && !name.includes(':')) {
        return `${item.objectName}:${name}`;
    }
    return name;
}

/** A `{ … }` object — not an array, not null. */
function isPlainObject(value: unknown): value is Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * [ADR-0131 D6] The package manifest an install body DECLARES — where each of
 * the two single-package shapes this door accepts carries it: a compiled
 * artifact (`dist/objectstack.json`, what `os package install <file>` sends)
 * nests it under `manifest:` beside the collections (ADR-0130 D4), and a
 * flattened bundle carries its manifest fields at the top. Read for the keys
 * an install decides by — `installModes`, `namespace` — never a second guess
 * at either: each shape has exactly one place for them.
 */
function declaredPackageManifest(body: Record<string, any>): Record<string, any> {
    return isPlainObject(body.manifest) ? body.manifest : body;
}

/**
 * [ADR-0131 D6] ONE package body, flat — what the `unmanaged` import copies:
 * a compiled artifact's manifest fields beside its collections, the
 * collections winning a key both carry (the assembled stage's `permissions`
 * is the permission-set collection, its `objects` the definitions — the
 * flatten order `AssembledPackageBodySchema` records). A body already flat is
 * returned as it is.
 *
 * [#28604] Also how a LEDGER entry is read wherever a decision reads its
 * manifest keys — the `kernel:ready` rehydrate's handshake and dependency
 * order, and the sample-data doors' handshake: an install before #28535
 * ledgered the body `os package install <file>` sends unflattened (`id` and
 * `version` lifted beside the nested `manifest`), so its `engines` and
 * `dependencies` sit one level down. Total: a ledger value is not
 * shape-checked ({@link LocalManifestSource}), and anything that is not a
 * plain object is handed back as it is.
 */
function flattenPackageBody(body: Record<string, any>): Record<string, any> {
    if (!isPlainObject(body) || !isPlainObject(body.manifest)) return body;
    const { manifest: meta, ...sections } = body;
    return { ...meta, ...sections };
}

/** What this door cannot run in a package, as the runtime binder judges it. */
interface UnrunnableCode {
    jobs: ReadonlyArray<{ name: string; handler?: string; bodyRefusal?: string; pullRefusal?: string }>;
    hooks: ReadonlyArray<{ name: string; handler?: string }>;
}

/** `'name' (handler 'fn')` / `'name' (no handler)`, comma-joined. */
function describeNamedHandlers(items: ReadonlyArray<{ name: string; handler?: string }>): string {
    return items.map((i) => `'${i.name}' (${i.handler !== undefined ? `handler '${i.handler}'` : 'no handler'})`).join(', ');
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The refusal sentence: everything the door cannot run, why, and the remedies,
 * one clause per kind — a job with no `body`, a job whose `body` the
 * declaration refuses, a job whose `pull` does not bind, a hook with no `body`
 * — in one answer, so the author fixes them all in one pass. Each names the
 * item and the function its `handler` declares (or the refusal of its `body` or
 * its `pull`).
 */
function describeUnrunnable(manifestId: string, what: UnrunnableCode): string {
    const clauses: string[] = [];
    const jobsWithBadPull = what.jobs.filter((j) => j.pullRefusal !== undefined);
    const jobsWithoutBody = what.jobs.filter((j) => j.pullRefusal === undefined && j.bodyRefusal === undefined);
    const jobsWithBadBody = what.jobs.filter((j) => j.pullRefusal === undefined && j.bodyRefusal !== undefined);
    if (jobsWithoutBody.length > 0) {
        const one = jobsWithoutBody.length === 1;
        clauses.push(
            `${one ? 'its enabled job' : `${jobsWithoutBody.length} of its enabled jobs`} `
            + `${describeNamedHandlers(jobsWithoutBody)} ${one ? 'has' : 'have'} no \`body\`, so this install door cannot run ${one ? 'it' : 'them'}. `
            + "A job's `handler` names a `defineStack({ functions })` entry, which is code: it travels in the artifact's "
            + 'runtime module, never in the package JSON this door installs, so the job would be installed and never run. '
            + 'Give the job a `body` (sandboxed JS, the form hooks and actions use, which travels with the package and runs '
            + 'on every door), or boot the artifact with `os start --artifact`, which loads its runtime module.',
        );
    }
    if (jobsWithBadBody.length > 0) {
        const one = jobsWithBadBody.length === 1;
        const list = jobsWithBadBody.map((j) => `'${j.name}' (${j.bodyRefusal})`).join('; ');
        clauses.push(
            `${one ? 'its enabled job' : `${jobsWithBadBody.length} of its enabled jobs`} ${list} `
            + `${one ? 'has' : 'have'} a \`body\` the declaration refuses, so this install door cannot run ${one ? 'it' : 'them'}: `
            + 'the job would be installed and never scheduled. Correct the `body` to the declared shape (a sandboxed JS '
            + "body; the job's time limit is the job's own `timeoutMs`) — `os validate` reports the same refusal.",
        );
    }
    if (jobsWithBadPull.length > 0) {
        const one = jobsWithBadPull.length === 1;
        const list = jobsWithBadPull.map((j) => `'${j.name}' (${j.pullRefusal})`).join('; ');
        clauses.push(
            `${one ? 'its enabled job' : `${jobsWithBadPull.length} of its enabled jobs`} ${list} `
            + `${one ? 'has' : 'have'} a \`pull\` that does not bind, so this install door cannot run ${one ? 'it' : 'them'}: `
            + 'the job would be installed and never scheduled. Declare the mapping the `pull` names in the package, with '
            + 'a `connectorSource`, or correct the `pull` as the refusal says — `os validate` refuses the same `pull`.',
        );
    }
    if (what.hooks.length > 0) {
        const one = what.hooks.length === 1;
        clauses.push(
            `${one ? 'its hook' : `${what.hooks.length} of its hooks`} ${describeNamedHandlers(what.hooks)} `
            + `${one ? 'has' : 'have'} no \`body\`, so this install door cannot run ${one ? 'it' : 'them'}. `
            + "A hook's `handler` names a function, which is code: it travels in the artifact's runtime module, never in "
            + "the package JSON this door installs, so this door can never bind it to the package's own code. "
            + 'Give the hook a `body` (sandboxed JS, the form actions and jobs use, which travels with the package and '
            + 'runs on every door), or boot the artifact with `os start --artifact`, which loads its runtime module.',
        );
    }
    return `Package ${manifestId} was not installed: ${clauses.map((c, i) => (i === 0 ? c : capitalize(c))).join(' ')}`;
}

/**
 * A ledger read failure in the thrower's own words (#5413 / #5426).
 *
 * The `cause` travels from `LocalManifestSource` unwrapped precisely so it can
 * be quoted here rather than replaced by a summary. `.message` first because
 * that is the operational sentence (`EACCES: permission denied, open '…'`);
 * `.name` only when a thrower left the message empty, which is still better
 * than the empty string.
 */
function describeLedgerCause(cause: unknown): string {
    return cause instanceof Error ? (cause.message || cause.name) : String(cause);
}

/** Best-effort manifest id from a registry package entry (shape varies). */
function manifestIdOf(p: any): string | undefined {
    return p?.manifest?.id ?? p?.id ?? p?.manifest?.name ?? undefined;
}

/**
 * [#28039] The datasources a package body declares, as `AppPlugin` reads a
 * stack's: a list, or a map keyed by name.
 */
function declaredDatasources(body: unknown): any[] {
    const defs = isPlainObject(body) ? body.datasources : undefined;
    return Array.isArray(defs)
        ? defs
        : isPlainObject(defs)
            ? Object.entries(defs).map(([name, def]) => ({ name, ...(def as any) }))
            : [];
}

/**
 * [#28534] The artifact as this door hands it to the `manifest` service: every
 * `packages[]` entry that states a `source` other than `'marketplace'` states
 * `'marketplace'` instead; every other key, and every entry stating none or
 * `'marketplace'`, is handed through as received (by reference when nothing
 * changes).
 *
 * The `manifest` service stamps an entry's own `source` over the door's
 * (`ArtifactPackageSchema.source`: the producer that MERGED an artifact knows
 * each member's origin — a control plane folding installs into a boot
 * artifact), so a bundle installed here whose member said `'code'` registered
 * that member as the host's own code. Every package this door registers
 * reached the runtime through it, whatever its entry says about how it reached
 * the artifact, so the door's word is the origin; overridden rather than
 * refused because the entry's statement is about the artifact's assembly, not
 * wrong in itself, and because the rehydrate must register a ledger entry
 * written before this rule without refusing it. The rule lives at this door,
 * not in the `manifest` service, so a boot that registers a merged artifact
 * stating no source keeps every member's own statement.
 */
export function asMarketplaceRegistration<T>(artifact: T): T {
    if (!isPlainObject(artifact) || !Array.isArray(artifact.packages)) return artifact;
    const restated = (entry: unknown): boolean =>
        isPlainObject(entry) && entry.source !== undefined && entry.source !== 'marketplace';
    if (!artifact.packages.some(restated)) return artifact;
    return {
        ...artifact,
        packages: artifact.packages.map((entry: unknown) => (restated(entry) ? { ...(entry as object), source: 'marketplace' } : entry)),
    } as T;
}

/**
 * The seed datasets a cached manifest bundles: its `data[]` entries that name
 * an object and carry records. One reading for the two doors that match seed
 * rows — the purge, and the listing's `withSampleData` (#21775).
 */
function seedDatasetsOf(manifest: any): PurgeSeedDataset[] {
    return Array.isArray(manifest?.data)
        ? manifest.data.filter((d: any) => d && d.object && Array.isArray(d.records))
        : [];
}

/**
 * [#21822] The marker the GET listing puts on a ledger entry this boot's
 * `kernel:ready` rehydrate refused to load: the refusal's `code` and the range
 * the package declares.
 *
 * CLOSED: exactly these two members, named one by one from the handshake's own
 * diagnostic, the way `protocolIncompatibleAnswer` names its `details`. ⛔ Not a
 * spread of the diagnostic: a member added to it later does not reach the
 * listing without a decision here.
 */
interface NotLoadedMarker {
    code: ProtocolIncompatibleDiagnostic['code'];
    requiredRange: ProtocolIncompatibleDiagnostic['requiredRange'];
}

/**
 * [ADR-0093 D4/D5, ADR-0105 D1 / #5262] Is an organization wall actually IN
 * FORCE for this boot? Both seeding decisions in this plugin key off it.
 *
 * ⛔ Never `resolveMultiOrgEnabled()`. ADR-0105 D1 demoted that boolean to a
 * back-compat INPUT of `resolveTenancyPosture()`, so it reads `false` on a
 * deployment configured the documented way (`OS_TENANCY_POSTURE=isolated|group`,
 * legacy boolean unset) — and a marketplace install on such a deployment wrote
 * its sample rows with NO `organization_id` at all, landing them outside the
 * wall every subsequent read applies. Same shape as cloud#1020 and #5233.
 *
 * EFFECTIVE, not requested. Both call sites ask "is the per-org replay going to
 * own this seeding instead of me?", and that replay is the enterprise
 * `@objectstack/organizations` middleware on `sys_organization` insert. On a
 * DEGRADED boot that middleware is absent, so deferring to it would strand the
 * data permanently; the `tenancy` service reports the posture in force
 * (`single` there), which correctly hands the work back to the inline path.
 *
 * Falls back to the requested posture when no `tenancy` service is registered
 * (a lean embedding without plugin-auth). Read live — never cached.
 */
function organizationWallActive(ctx: PluginContext): boolean {
    try {
        const tenancy = ctx.getService?.('tenancy') as { posture?: TenancyPosture } | undefined;
        if (tenancy?.posture) return postureEnforcesWall(tenancy.posture);
    } catch {
        /* no `tenancy` service registered — fall through */
    }
    return postureEnforcesWall(resolveTenancyPosture());
}

/**
 * [ADR-0123 D2 / D4] The answer every sample-data door gives a walled session
 * with NO active organization: the standard catalog's `PERMISSION_DENIED` / 403,
 * and one sentence, built here, that names the missing active organization and
 * the remedy.
 *
 * ADR-0123 D1 declares "authenticated, with no active organization" a legal,
 * named state that every subsystem inherits instead of inventing a fourth
 * semantics for it. Sample rows on a walled deployment are tenant-scoped writes,
 * so D2 refuses them loudly, with the catalog code rather than a registered
 * synonym, and D4 requires the message to say what is missing, so the reader
 * does not go looking at permissions, which are fine.
 *
 * Three doors read it: the install's `seeded` report (`mode: 'refused'`, the
 * sentence in `reason`: the package itself is installed, its rows are not),
 * and the reseed and purge refusals (the code, the status and the sentence as
 * the error envelope). The platform's other D2 sentences, the security layer's
 * write wall and the sharing-rule service's, are built inline for one object
 * and one operation; this door's subject is a package's sample data across
 * several objects, so the sentence is this file's own, in the same words.
 */
const NO_ACTIVE_ORGANIZATION_CODE = 'PERMISSION_DENIED';
const NO_ACTIVE_ORGANIZATION_STATUS = 403;

/**
 * The caller one install-local admission resolved: identity and grants off the
 * shared resolver, plus the two postures the doors read.
 */
interface InstallPrincipal {
    userId: string;
    systemPermissions: string[];
    /** [#15204 W2] The ADR-0095 posture rung the resolver derived. */
    posture?: unknown;
    /** [#15204 W2] The EFFECTIVE tenancy posture this admission resolved. */
    tenancyPosture?: TenancyPosture;
    /**
     * ADR-0069: the authentication-policy posture of the principal this
     * admission resolved, present only for one the policy holds — a held
     * session, or (#23455, ruling C′ item 1) an API key whose owner holds an
     * `account`-scope posture. `refuseHeldSession` refuses on it.
     */
    authGate?: AuthGate;
}

/**
 * ADR-0069: the refusal every install-local door gives a principal the
 * authentication policy HOLDS (a session with an expired password, enforced
 * MFA not yet enrolled; an API key whose owner owes that enrolment), right
 * after the 401 and before the caller's capabilities are consulted or the
 * ledger is read. Such a principal is gated out of every protected resource
 * until it remediates, so it gets REST's answer: `403` with the gate's own
 * `code` and `message`, in this plugin's envelope. The consult itself happens
 * once, in `resolveInstallPrincipal`; this only answers on it, in one place,
 * so a door added later cannot copy a weaker answer. Nothing is written, so a
 * held key is served again the moment its owner remediates (ruling C′ item
 * 4). `null` when the principal is not held.
 */
/**
 * [#27237] One connector credential an installed package names, as the install
 * answer reports it. `status` is the automation service's (`set` / `missing` /
 * `rejected`), or `unknown` when it could not be read. Never a value.
 */
export interface InstalledCredentialRef {
    ref: string;
    connectors: string[];
    status: ConnectorCredentialRef['status'] | 'unknown';
    source: ConnectorCredentialRef['source'];
}

/**
 * [#27237] The install answer's sentence for the credentials not set yet.
 * `door: false` when the credential door cannot store any of them — the
 * automation service's listing says none is `writable`, as under the `group` /
 * `isolated` postures, where the door refuses — so the sentence does not send
 * an administrator to a route that will refuse.
 */
export function installedCredentialNote(refs: readonly string[], opts: { door?: boolean } = {}): string {
    const list = refs.map((r) => `'${r}'`).join(', ');
    return (
        `Connector credential${refs.length === 1 ? '' : 's'} ${list} ${refs.length === 1 ? 'needs' : 'need'} an `
        + "administrator — not set, refused by the upstream, or unreadable now (each entry's `status` says which). The "
        + 'connector instances naming them are installed degraded and materialize once each is set: '
        + (opts.door === false
            ? "as a server environment variable of the same name, or in the host's credential resolver. This environment "
                + 'does not store connector credentials through the credential door.'
            : 'PUT /api/v1/automation/connectors/credential-refs/:ref, or a server environment variable of the same name.')
    );
}

function refuseHeldSession(c: any, principal: InstallPrincipal): Response | null {
    if (!principal.authGate) return null;
    const { code, message } = principal.authGate;
    return c.json({ success: false, error: { code, message } }, 403);
}

/**
 * [#15204 W2] What an admitted mutating request carries past
 * `requireInstallCapability`: the acting user, plus the two inputs ADR-0131
 * D3's refusal needs, both off the admission's single authorization read.
 */
interface InstallAdmission {
    ok: true;
    userId: string;
    /** The caller's ADR-0095 posture rung. */
    callerPosture: unknown;
    /** The EFFECTIVE tenancy posture; `undefined` when no `tenancy` service is registered. */
    tenancyPosture: TenancyPosture | undefined;
}

/** The sample-data doors that seed or purge under the caller's active organization. */
type SampleDataDoor = 'install' | 'reseed' | 'purge';

function noActiveOrganizationRefusal(door: SampleDataDoor): string {
    const subject = door === 'purge' ? 'Purging sample data'
        : door === 'reseed' ? 'Reseeding sample data'
        : 'Seeding the sample data';
    const consequence = door === 'purge'
        ? 'there is no organization to remove its rows from'
        : 'there is no organization to place its rows in';
    const remedy = door === 'install'
        ? 'The package itself is installed. Join or select an active organization, then reseed the sample data.'
        : 'Join or select an active organization and retry.';
    return `${subject} was refused: sample data is scoped to an organization, and this session has no active `
        + `organization, so ${consequence}. ${remedy}`;
}

export interface MarketplaceInstallLocalPluginConfig {
    /** Cloud control-plane base URL. When unset, falls back to OS_CLOUD_URL
     *  and then to the public ObjectStack cloud so a fresh `objectstack dev`
     *  can install from the marketplace without configuration. Set
     *  OS_CLOUD_URL=off to disable (the install endpoint then returns 503). */
    controlPlaneUrl?: string;
    /** Override the on-disk cache directory. Defaults to
     *  `<cwd>/.objectstack/installed-packages`. */
    storageDir?: string;
}

// Desired-state entry shape — owned by the LocalManifestSource ledger
// (cloud ADR-0007 step ⑤: the ledger is the named local desired-state owner;
// this plugin is its HTTP mutation surface).
type InstalledEntry = InstalledManifestEntry;

export class MarketplaceInstallLocalPlugin implements Plugin {
    readonly name = 'com.objectstack.runtime.marketplace-install-local';
    readonly version = '1.0.0';

    private readonly cloudUrl: string;
    private readonly ledger: LocalManifestSource;
    private readonly storageDir: string;
    private readonly credentials: ConnectionCredentialStore;
    /**
     * Manifest ids already present in the engine registry at `kernel:ready`,
     * BEFORE this plugin rehydrates its own ledger. These are genuine
     * user/config-defined apps (AppPlugin from objectstack.config.ts). Used by
     * findConflict to tell real local code apart from an orphaned marketplace
     * install whose ledger entry went missing.
     */
    private readonly bootUserCodeIds = new Set<string>();
    /**
     * [#21822] What this boot's `kernel:ready` rehydrate refused to load under
     * ADR-0087 D1's handshake, keyed by manifest id: the refused entry's
     * `installedAt` and the marker the GET listing serves for it.
     *
     * The record of what the rehydrate DID, written by it alone, never a second
     * judgement of the ledger: the listing does not re-run the handshake.
     *
     * `installedAt` names WHICH entry was refused. Only the install door writes
     * a new entry for a manifest id, always with a fresh `installedAt`, and only
     * after the same handshake admitted it. So once a compatible version
     * replaces the refused entry, the record no longer matches the ledger and
     * the listing stops marking it — with no write to this record from the
     * install door or from DELETE.
     */
    private readonly refusedAtRehydrate = new Map<string, { installedAt: string; marker: NotLoadedMarker }>();

    constructor(config: MarketplaceInstallLocalPluginConfig = {}) {
        this.cloudUrl = resolveCloudUrl(config.controlPlaneUrl);
        this.ledger = new LocalManifestSource(config.storageDir);
        this.storageDir = this.ledger.dir;
        this.credentials = new ConnectionCredentialStore();
    }

    init = async (_ctx: PluginContext): Promise<void> => {
        // No services registered — pure HTTP wiring during start().
    };

    start = async (ctx: PluginContext): Promise<void> => {
        ctx.hook('kernel:ready', async () => {
            // Snapshot the manifest ids the engine already knows about BEFORE
            // we register anything or rehydrate the ledger — by now AppPlugin
            // has loaded objectstack.config.ts, so whatever is registered here
            // is genuine local/user code. findConflict uses this to avoid
            // misreading an orphaned marketplace install as user code.
            this.captureBootUserCodeIds(ctx);

            // Plugin-owned Setup nav (cloud ADR-0009): "Installed Apps"
            // ships WITH the local-install capability.
            try {
                const manifest = ctx.getService<{ register(m: any): void }>('manifest');
                manifest?.register?.(MARKETPLACE_INSTALLED_UI_BUNDLE);
            } catch { /* no manifest service */ }

            // 1. Rehydrate previously installed packages so they survive restart.
            await this.rehydrate(ctx);

            // 2. Mount HTTP endpoints.
            // [#4251] Read canonical-first with a REAL per-name fallback:
            // `getService` THROWS for an empty slot, so a single try around
            // `canonical ?? alias` never reaches the alias — the shape the old
            // alias-first read had too, meaning its fallback never once fired.
            const readServer = (name: string): IHttpServer | undefined => {
                try { return ctx.getService<IHttpServer>(name); } catch { return undefined; }
            };
            // Canonical first — see marketplace-proxy-plugin.
            const httpServer = readServer('http.server') ?? readServer('http-server');
            if (!httpServer) {
                ctx.logger?.warn?.('[MarketplaceInstallLocal] http-server not available — install endpoints not mounted');
                return;
            }
            if (typeof httpServer.getRawApp !== 'function') {
                ctx.logger?.warn?.('[MarketplaceInstallLocal] http-server missing getRawApp() — install endpoints not mounted');
                return;
            }
            const rawApp = httpServer.getRawApp();

            const postHandler = async (c: any) => this.handleInstall(c, ctx);
            const getHandler = async (c: any) => this.handleList(c, ctx);
            const deleteHandler = async (c: any) => this.handleUninstall(c, ctx);

            const reseedHandler = async (c: any) => this.handleReseed(c, ctx);
            const purgeHandler = async (c: any) => this.handlePurge(c, ctx);

            if (typeof rawApp.post === 'function') rawApp.post(ROUTE_BASE, postHandler);
            if (typeof rawApp.get === 'function') rawApp.get(ROUTE_BASE, getHandler);
            if (typeof rawApp.delete === 'function') rawApp.delete(`${ROUTE_BASE}/:manifestId`, deleteHandler);
            if (typeof rawApp.post === 'function') {
                rawApp.post(`${ROUTE_BASE}/:manifestId/reseed-sample-data`, reseedHandler);
                rawApp.post(`${ROUTE_BASE}/:manifestId/purge-sample-data`, purgeHandler);
            }

            ctx.logger?.info?.(`[MarketplaceInstallLocal] mounted at ${ROUTE_BASE} (storage: ${this.storageDir})`);
        });
    };

    /**
     * Re-register every cached manifest with the kernel's manifest service.
     * Safe to call on a kernel that already has the same manifest_id (the
     * underlying ObjectQL registry overwrites by id, but we still warn so
     * a developer can spot the dev-time clash between their config.ts and
     * a marketplace package).
     */
    private rehydrate = async (ctx: PluginContext): Promise<void> => {
        // [#21822] The record describes THIS rehydrate, and nothing older.
        this.refusedAtRehydrate.clear();
        const { entries, skipped } = this.readAll();

        // #5413 — BEFORE the early return, not after. A ledger whose entries
        // are ALL corrupt is the worst case of this bug, not an exempt one:
        // every installed app silently missing from the runtime, and an
        // `entries.length === 0` return above this loop would be the one path
        // that still said nothing at all.
        this.warnSkippedLedgerEntries(ctx, skipped, 'that installed app is NOT registered in this runtime');

        if (entries.length === 0) return;

        let manifestService: { register(m: any, options?: { source?: 'code' | 'marketplace' }): void | Promise<void> } | null = null;
        try {
            manifestService = ctx.getService('manifest') as any;
        } catch {
            ctx.logger?.warn?.('[MarketplaceInstallLocal] no `manifest` service — rehydrate skipped');
            return;
        }

        for (const entry of this.inDependencyOrder(ctx, entries)) {
            try {
                // [#21762] ADR-0087 D1: the handshake runs "before loading a
                // package's metadata", and a rehydrate IS a load. An entry whose
                // declared range excludes this runtime's major (installed before
                // the install door checked, or by a runtime of another protocol
                // sharing this ledger) is NOT loaded: nothing is registered,
                // synced, bound or seeded for it, and the boot continues with the
                // rest. Its ledger entry is kept, so DELETE can still remove it
                // and a compatible version can replace it.
                //
                // `checkProtocolCompat` is the handshake's own judge. Only a
                // positive incompatibility is acted on: an absent or
                // unrecognised range rehydrates exactly as it did before.
                // [#28604] Judged on the entry as the install door reads a body
                // ({@link flattenPackageBody}), so an entry ledgered in the
                // CLI's lifted shape before #28535 is judged by the range it
                // nests, exactly as a flat entry with that range is.
                const compat = checkProtocolCompat(flattenPackageBody(entry.manifest));
                if (compat.status === 'incompatible') {
                    // [#21822] Recorded where the GET listing reads it, so the
                    // entry is listed as not loaded rather than as installed.
                    this.refusedAtRehydrate.set(entry.manifestId, {
                        installedAt: entry.installedAt,
                        marker: { code: compat.diagnostic.code, requiredRange: compat.diagnostic.requiredRange },
                    });
                    this.reportProtocolIncompatibleEntry(ctx, entry, compat.diagnostic);
                    continue;
                }
                // ADR-0087 D2 — the ledger entry is data at rest: the body is
                // converted forward ONCE here ({@link convertPackageBodyForward}),
                // and that converted body is what registers, what the binder
                // binds, what the side effects replay and what the heal seeds.
                // The ledger keeps the body as installed, so it converts again
                // at every rehydrate.
                const converted = this.convertPackageBodyForward(ctx, entry.manifest);
                // Awaited: register also bridges the manifest's objects into
                // the metadata service (late-registration bridge in
                // ObjectQLPlugin) — wait for that so metadata consumers see
                // the package as soon as rehydrate reports success.
                // [#23972] Every ledger entry is a marketplace install, so its
                // registry row says so (`source: 'marketplace'`) after a restart
                // exactly as it did when it was installed — every member of a
                // `packages[]` bundle included, whatever its entry states
                // ([#28534], {@link asMarketplaceRegistration}), a ledger entry
                // written before that rule included.
                await manifestService!.register(asMarketplaceRegistration(converted), { source: 'marketplace' });
                // Sync schemas so the driver creates tables for the newly-
                // registered objects (idempotent — already-synced tables
                // are no-ops).
                try {
                    const ql: any = ctx.getService('objectql');
                    if (ql && typeof ql.syncSchemas === 'function') await ql.syncSchemas();
                } catch { /* non-fatal */ }
                // [#28039] Connect the package's declared datasources — the
                // boot artifact's were connected in `AppPlugin.start`, and this
                // package arrives after it.
                await this.connectDeclaredDatasources(ctx, converted, entry.manifestId, entry.version);
                // [#21321] Bind the package's script-action bodies and body
                // hooks — `register` above makes them declared, not runnable.
                await this.bindArtifactHandlers(ctx, converted, entry.manifestId);
                // Replay translations + register seed datasets, but don't
                // re-run seeding — existing rows are already in the DB from
                // the original install, and multi-tenant orgs will replay
                // via the security middleware on next sys_organization insert.
                await this.applySideEffects(ctx, converted, { seedNow: false });
                // …EXCEPT when the database no longer has them: the ledger is
                // anchored to <cwd> while the database can be swapped out from
                // under it (`os dev --fresh`, a deleted dev.db, a --database
                // switch). Config-declared apps re-seed on every single-tenant
                // boot via AppPlugin, but a rehydrated marketplace package
                // would stay empty forever — app visible, tables created,
                // zero rows. Heal that case.
                await this.maybeHealSampleData(ctx, entry, converted);
                ctx.logger?.info?.(`[MarketplaceInstallLocal] rehydrated ${entry.manifestId}@${entry.version}`);
            } catch (err: any) {
                ctx.logger?.error?.(`[MarketplaceInstallLocal] rehydrate failed for ${entry.manifestId}`, err instanceof Error ? err : new Error(String(err)));
            }
        }
    };

    /**
     * [ADR-0141 D5] The ledger's entries in `manifest.dependencies` order, not
     * the order the directory lists them in: a standalone module read before
     * the artifact carrying its parent met the namespace gate — and the
     * `kernel:ready` seals — with that parent absent. Each entry is one node
     * (an artifact may carry several packages), so a declared id resolves to
     * the entry that carries that package and an id declared between packages
     * of one entry is no edge. A cycle between entries keeps listed order for
     * its members and is reported by name; it never stops the rehydrate.
     */
    private inDependencyOrder(ctx: PluginContext, entries: InstalledManifestEntry[]): InstalledManifestEntry[] {
        const { ordered, cycles } = orderHydrationBatch(entries.map((entry) => {
            // [#28604] Read as the install door reads a body, so a lifted
            // entry's nested `dependencies` order it as a flat entry's do.
            const body = flattenPackageBody(entry.manifest);
            const bodies: unknown[] = Array.isArray(body?.packages)
                ? body.packages.map((p: { manifest?: unknown } | null) => p?.manifest)
                : [body];
            return {
                item: entry,
                label: entry.manifestId,
                packageIds: bodies.map((body) => artifactPackageId(body)).filter((id): id is string => id !== undefined),
                declaredIds: bodies.flatMap((body) => declaredDependencyIds(body)),
            };
        }));
        for (const members of cycles) {
            ctx.logger?.error?.(
                `[MarketplaceInstallLocal] installed apps ${members.map((m) => `'${m}'`).join(', ')} declare each other in a `
                + 'dependency cycle (manifest.dependencies), so no order puts each after the packages it declares. They '
                + 'rehydrate in listed order for this boot (ADR-0141 D5); a namespace they share may be refused. Remove the '
                + 'declaration that closes the cycle and reinstall.',
            );
        }
        return ordered;
    }

    /**
     * Rehydrate-time sample-data healing (the "installed app, empty database"
     * repair). Runs the bundled seed datasets iff:
     *
     *   • the cached manifest actually bundles seed datasets, AND
     *   • the user never explicitly purged them (`sampleDataPurged`), AND
     *   • single-tenant mode (multi-tenant seeding is owned by the per-org
     *     replay on sys_organization insert — the datasets were already merged
     *     into the kernel's `seed-datasets` service by applySideEffects), AND
     *   • EVERY seeded object is empty. One surviving row anywhere means the
     *     install-time rows (or the user's own data) are still present, and
     *     re-upserting would silently revert user edits on every boot.
     *
     * `converted` is the entry's manifest as rehydrate converted it — the one the
     * package registered — so the heal seeds what registered, not the raw
     * ledger bytes.
     *
     * Never throws — a failed heal logs and leaves the boot untouched.
     */
    private maybeHealSampleData = async (ctx: PluginContext, entry: InstalledEntry, converted: any): Promise<void> => {
        const datasets = Array.isArray(converted?.data)
            ? converted.data.filter((d: any) => d && d.object && Array.isArray(d.records))
            : [];
        if (datasets.length === 0) return;
        if (entry.sampleDataPurged === true) return;
        if (organizationWallActive(ctx)) {
            ctx.logger?.info?.(`[MarketplaceInstallLocal] organization wall active — sample-data heal for ${entry.manifestId} left to per-org replay`);
            return;
        }

        let ql: any;
        try { ql = ctx.getService('objectql'); } catch { return; }
        if (!ql || typeof ql.find !== 'function') return;

        // Emptiness probe: any row in any seeded object → nothing to heal.
        const objects = [...new Set(datasets.map((d: any) => String(d.object)))];
        for (const object of objects) {
            try {
                const rows = await ql.find(object, { limit: 1, context: { isSystem: true } } as any);
                const first = Array.isArray(rows) ? rows[0] : rows?.items?.[0];
                if (first !== undefined && first !== null) return;
            } catch { /* unknown/missing table reads as empty — keep probing */ }
        }

        try {
            const summary = await this.runInlineSeed(ctx, datasets);
            const landed = (summary.inserted ?? 0) + (summary.updated ?? 0);
            if (landed > 0) {
                entry.withSampleData = true;
                entry.sampleDataPurged = false;
                try { this.ledger.write(entry); } catch { /* non-fatal */ }
                ctx.logger?.info?.(`[MarketplaceInstallLocal] healed sample data for ${entry.manifestId}: inserted=${summary.inserted} updated=${summary.updated} errors=${summary.errors}`);
                // #3430: surface the fresh-DB self-heal in the boot banner — the
                // info line above is swallowed by the default warn level, so this
                // was previously only confirmable by querying the database.
                await this.recordSeedSummary(ctx, {
                    source: entry.manifestId,
                    marketplace: true,
                    inserted: summary.inserted ?? 0,
                    updated: summary.updated ?? 0,
                    skipped: summary.skipped ?? 0,
                    rejected: summary.errors ?? 0,
                    droppedRefs: summary.droppedRefs ?? 0,
                    healed: true,
                });
            } else {
                ctx.logger?.warn?.(`[MarketplaceInstallLocal] sample-data heal for ${entry.manifestId} landed no rows${summary.errorSample ? ` — first error: ${summary.errorSample}` : ''}`);
                // Installed package, seed datasets declared, yet 0 rows landed —
                // the "app in the switcher, every KPI 0" case. Escalate it in the
                // banner (emptyInstall ⇒ ⚠) rather than let it pass silently.
                await this.recordSeedSummary(ctx, {
                    source: entry.manifestId,
                    marketplace: true,
                    inserted: 0,
                    updated: 0,
                    skipped: 0,
                    rejected: summary.errors ?? 0,
                    emptyInstall: true,
                });
            }
        } catch (err: any) {
            ctx.logger?.warn?.(`[MarketplaceInstallLocal] sample-data heal failed for ${entry.manifestId}: ${err?.message ?? err}`);
            await this.recordSeedSummary(ctx, {
                source: entry.manifestId,
                marketplace: true,
                inserted: 0,
                updated: 0,
                skipped: 0,
                rejected: 0,
                emptyInstall: true,
            });
        }
    };

    /**
     * Append a per-source outcome onto the kernel's `seed-summary` service so
     * the CLI boot banner can print it (#3430). Resolved lazily through the
     * runtime's shared writer contract; guarded so a runtime that predates the
     * helper — or a test that mocks `@objectstack/runtime` without it — simply
     * skips the banner line instead of crashing the heal path.
     */
    private recordSeedSummary = async (
        ctx: PluginContext,
        outcome: {
            source: string;
            marketplace?: boolean;
            inserted: number;
            updated: number;
            skipped: number;
            rejected: number;
            droppedRefs?: number;
            healed?: boolean;
            emptyInstall?: boolean;
        },
    ): Promise<void> => {
        try {
            const mod: any = await import('@objectstack/runtime');
            if (typeof mod?.recordSeedOutcome === 'function') mod.recordSeedOutcome(ctx, outcome);
        } catch { /* banner summary is best-effort — never break the heal */ }
    };

    /**
     * Merge `datasets` onto the SHARED `seed-datasets` service via the runtime's
     * register-once-then-mutate helper (#3453), so THIS package's seeds accumulate
     * alongside every config app's and every other package's rather than clobbering
     * them — a per-org replayer replays the whole union on the next
     * `sys_organization` insert. Resolved lazily through `@objectstack/runtime` and
     * guarded exactly like {@link recordSeedSummary}: a runtime that predates the
     * helper — or a test that mocks the module without it — falls back to an
     * equivalent inline merge. Returns the post-merge total for the log line.
     *
     * ⚠️ [#9070] This merge is only half of the contract, and the missing half used
     * to be assumed rather than provided: the docblock said "the per-org replayer
     * (AppPlugin)" as if one always existed. It does not. `registerSeedReplayerOnce`
     * lives in AppPlugin's seeder path, so on a host runtime that declares no seed
     * data of its own — `objects: []`, no `data`, which is precisely the shape a
     * marketplace install targets — `seed-datasets` ends up populated and
     * `seed-replayer` absent. The middleware then finds datasets, finds no replayer,
     * logs `datasets present but no replayer registered`, and every organization
     * founded after the install boots EMPTY. The merge landed and the consumer never
     * did. {@link registerSeedReplayerIntoKernel} is that consumer; the two are
     * called together so the split cannot recur.
     */
    private mergeSeedDatasetsIntoKernel = async (ctx: PluginContext, datasets: any[]): Promise<number> => {
        try {
            const mod: any = await import('@objectstack/runtime');
            if (typeof mod?.mergeSeedDatasets === 'function') {
                const list = mod.mergeSeedDatasets(ctx, datasets);
                return Array.isArray(list) ? list.length : datasets.length;
            }
        } catch { /* fall through to the inline merge below */ }
        return this.mergeSeedDatasetsInline(ctx, datasets);
    };

    /**
     * Fallback for {@link mergeSeedDatasetsIntoKernel} when the runtime helper is
     * unavailable (older build / mocked module). Same register-once-then-mutate:
     * read the live list through the context's OWN resolver first — a standard
     * PluginContext has no `.kernel`, which is precisely why the old
     * `(ctx as any).kernel` read clobbered instead of accumulating — push in place,
     * and register only when the service does not yet exist so a second source
     * cannot trip the duplicate-register throw. Returns the post-merge total.
     */
    private mergeSeedDatasetsInline = (ctx: PluginContext, datasets: any[]): number => {
        const c = ctx as any;
        const current = this.readSharedSeedDatasets(ctx);
        const list: any[] = Array.isArray(current) ? current : [];
        list.push(...datasets);
        if (!Array.isArray(current)) {
            if (typeof c?.kernel?.registerService === 'function') c.kernel.registerService('seed-datasets', list);
            else if (typeof c?.registerService === 'function') c.registerService('seed-datasets', list);
        }
        return list.length;
    };

    /**
     * Read the LIVE shared `seed-datasets` array, or `undefined` when nothing has
     * registered one yet. Resolution order is load-bearing and mirrors the runtime
     * helper: the context's OWN resolver first — a standard `PluginContext` has no
     * `.kernel` handle at all, which is exactly why the old `(ctx as any).kernel`
     * read was always `undefined` (#3453) — with the raw-kernel handle second for
     * the rare embedding that passes a bare kernel as `ctx`. Both throw when the
     * service is unregistered; swallowed and reported as absent.
     */
    private readSharedSeedDatasets = (ctx: PluginContext): any[] | undefined => {
        const c = ctx as any;
        if (typeof c?.getService === 'function') {
            try { const v = c.getService('seed-datasets'); if (Array.isArray(v)) return v; } catch { /* absent */ }
        }
        if (typeof c?.kernel?.getService === 'function') {
            try { const v = c.kernel.getService('seed-datasets'); if (Array.isArray(v)) return v; } catch { /* absent */ }
        }
        return undefined;
    };

    /**
     * [#9070] Register the per-organization `seed-replayer` callable alongside the
     * dataset merge, through the runtime's `registerSeedReplayerOnce` helper.
     *
     * This is the consumer half of {@link mergeSeedDatasetsIntoKernel}. Without it a
     * walled deployment installs an app and then hands every organization founded
     * afterwards an EMPTY copy of it: the org-scoping middleware reads
     * `seed-datasets`, finds the union it needs, finds no `seed-replayer`, and does
     * nothing. The installer's own organization is the only one that ever gets rows,
     * and it gets them from the install-time inline seed rather than from the replay.
     *
     * Register-ONCE is the whole safety argument, and it belongs to the helper rather
     * than to a caller-side "is there one already?" test: a host that already has a
     * replayer (any `AppPlugin` app with seed data) keeps it, and the incumbent reads
     * the same live shared list, so it replays this package's datasets too. Nothing
     * is displaced and nothing is duplicated — which is why this can be called
     * unconditionally on both the install and the rehydrate path.
     *
     * Guarded exactly like {@link mergeSeedDatasetsIntoKernel}: an older runtime
     * build — or a test that mocks `@objectstack/runtime` without the helper, which
     * five sibling suites in this package do — falls back to the inline equivalent.
     * The fallback is not decoration: a silent no-op there would restore the very
     * defect this method exists to close, and it would be invisible.
     *
     * Returns `true` when it newly registered, `false` when a replayer was already
     * present, so the caller can log "reused" rather than "registered".
     */
    private registerSeedReplayerIntoKernel = async (ctx: PluginContext): Promise<boolean> => {
        const replayer = this.buildSeedReplayer(ctx);
        try {
            const mod: any = await import('@objectstack/runtime');
            if (typeof mod?.registerSeedReplayerOnce === 'function') {
                return mod.registerSeedReplayerOnce(ctx, replayer) === true;
            }
        } catch { /* fall through to the inline registration below */ }
        return this.registerSeedReplayerInline(ctx, replayer);
    };

    /**
     * Fallback for {@link registerSeedReplayerIntoKernel}, mirroring the runtime's
     * `registerSeedReplayerOnce` byte for byte in behaviour: probe first, register
     * only on absence, and treat a lost check→register race (the duplicate-register
     * throw) as "already present". Best-effort throughout — a replay concern must
     * never tear down an install.
     */
    private registerSeedReplayerInline = (ctx: PluginContext, replayer: unknown): boolean => {
        const c = ctx as any;
        const alreadyRegistered = (): boolean => {
            if (typeof c?.getService === 'function') {
                try { if (c.getService('seed-replayer') !== undefined) return true; } catch { /* absent */ }
            }
            if (typeof c?.kernel?.getService === 'function') {
                try { if (c.kernel.getService('seed-replayer') !== undefined) return true; } catch { /* absent */ }
            }
            return false;
        };
        if (alreadyRegistered()) return false;
        try {
            if (typeof c?.kernel?.registerService === 'function') { c.kernel.registerService('seed-replayer', replayer); return true; }
            if (typeof c?.registerService === 'function') { c.registerService('seed-replayer', replayer); return true; }
        } catch { /* concurrent register — treat as already present */ }
        return false;
    };

    /**
     * The `(organizationId) => Promise<summary>` callable registered above — the
     * narrow surface the org-scoping middleware invokes on a `sys_organization`
     * insert, so that package never has to import `@objectstack/runtime`.
     *
     * Two properties it must have, both learned from the AppPlugin replayer it
     * mirrors (`packages/runtime/src/app-plugin.ts`):
     *
     *   • It reads the LIVE shared list on every call, never a snapshot captured
     *     when the closure was built. An organization founded after a LATER
     *     marketplace install must still replay that install's seeds — the whole
     *     point of accumulating one union (#3453).
     *   • `errors` is the loader's ERROR ARRAY, not a count. The consumer reports
     *     `summary?.errors?.length` and samples `summary?.errors?.slice(0, 5)`;
     *     handing it a number makes both read as "0 error(s)" through optional
     *     chaining — a machine-readable summary that lies about a failed replay
     *     rather than one that reports it.
     *
     * Never throws: a composition gap (no objectql/metadata) answers the zero
     * summary and says so once, exactly like the AppPlugin replayer, leaving the
     * middleware's own fallbacks to decide what to do about it.
     */
    private buildSeedReplayer = (ctx: PluginContext) => {
        const empty = () => ({ inserted: 0, updated: 0, skipped: 0, errors: [] as any[] });
        return async (organizationId: string) => {
            if (!organizationId) return empty();
            const datasetsNow = this.readSharedSeedDatasets(ctx);
            if (!Array.isArray(datasetsNow) || datasetsNow.length === 0) return empty();
            // Both slots' declared contracts, not `any` (#4127/#4251): these
            // lookups are NEW code, so they carry the contract rather than
            // riding this file's grandfathered entry in
            // `scripts/slot-lookup-baseline.json` — the same spelling the
            // session-resolver below uses for `objectql`. Split declaration and
            // lookup is the FOURTH erasure shape, and an untyped `let` erases
            // the slot just as `const ql: any = …` does.
            let ql: IObjectQLEngine | undefined;
            let metadata: IMetadataService | undefined;
            try { ql = ctx.getService<IObjectQLEngine>('objectql'); } catch { /* no data engine */ }
            try { metadata = ctx.getService<IMetadataService>('metadata'); } catch { /* no metadata service */ }
            if (!ql || !metadata) {
                ctx.logger?.warn?.(`[MarketplaceInstallLocal] seed-replayer: objectql/metadata unavailable — org ${organizationId} not seeded`);
                return empty();
            }
            const s = await this.runInlineSeed(ctx, datasetsNow, organizationId);
            return { inserted: s.inserted, updated: s.updated, skipped: s.skipped, errors: s.errorList };
        };
    };

    private handleInstall = async (c: any, ctx: PluginContext): Promise<Response> => {
        // [#8976] The sharpest of the four: this door accepts an INLINE manifest
        // and turns it into `syncSchemas()` against the shared database.
        // `admission`, not `gate` — `gate` is taken further down by the ADR-0120
        // D5e global-unique CEREMONY, which is a data-shape question the caller
        // answers about their own manifest. Two different words for two
        // different gates: one decides who may knock, the other what they may
        // bring. Conflating them is how the ceremony came to look like an
        // authorization test in the first place.
        const admission = await this.requireInstallCapability(c, ctx, 'Installing a package');
        if (!admission.ok) return admission.response;
        const userId = admission.userId;

        // [#23914] A declared JSON body that does not parse is refused 400,
        // never read as no body (`./request-json-body.ts`).
        const read = await readJsonRequestBody(c);
        if (!read.ok) return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: read.message } }, 400);
        const body: any = read.body;

        // 0. [ADR-0131 D6] ⭐ THE REQUESTED INSTALL MODE, parsed against the
        //    manifest key's own enum (`InstallModeSchema`, by reference — never
        //    a copy of the two spellings). Absent means `managed`, the mode
        //    every install took before the key existed. Answered before the
        //    cloud round-trip: a request this door cannot read is refused
        //    without fetching anything.
        const requestedMode = body?.installMode === undefined
            ? { success: true as const, data: 'managed' as InstallMode }
            : InstallModeSchema.safeParse(body.installMode);
        if (!requestedMode.success) {
            return c.json({
                success: false,
                error: {
                    code: 'INVALID_REQUEST',
                    message: `\`installMode\` must be 'managed' or 'unmanaged', received ${JSON.stringify(body.installMode)}. `
                        + 'Omit it for a managed install.',
                },
            }, 400);
        }
        const installMode: InstallMode = requestedMode.data;

        // ── Offline path: an inline manifest was supplied (file import). ──
        // Bypass the cloud-fetch entirely; no OS_CLOUD_URL required.
        const inlineManifest = body?.manifest && typeof body.manifest === 'object' ? body.manifest : null;

        // A COMPILED stack bundle (`dist/objectstack.json`, what publish
        // uploads as the version payload) nests its meta under `.manifest`:
        //   { manifest: { id, namespace, version, … }, objects, views, … }
        // while ObjectQL's registerApp expects the FLAT app shape (top-level
        // id + sections). Flatten when detected — otherwise every install of
        // a published compiled bundle dies with "Invalid manifest payload".
        //
        // [#28535] ⭐ Detected by the nested `manifest` object ALONE, through
        // the one flatten this door already owns (`flattenPackageBody`). The
        // detection used to also require NO top-level `id`/`name`, and
        // `os package install <file>` (every published CLI) lifts `id` and
        // `version` to the top beside the nested `manifest` — so that body
        // was never flattened, and every key the checks below read at the
        // manifest top level (`engines` for the ADR-0087 handshake,
        // `dependencies` for the ADR-0141 check) stayed one level down: a
        // package built for another protocol installed with a "declares no
        // engines.protocol range" warning. The door reads the shape it
        // receives; it does not depend on which sender built it.
        const normalizeBundle = (m: unknown): any => (isPlainObject(m) ? flattenPackageBody(m) : m);

        let manifest: any;
        let resolvedVersionId: string;
        let version: string;
        let packageId: string;

        if (inlineManifest) {
            manifest = normalizeBundle(inlineManifest);
            // The package id on this branch IS the manifest's declared id, so
            // it is assigned below, once the id gate has parsed it — there is
            // no second, looser derivation of it here.
            packageId = '';
            version = String(manifest.version ?? 'unknown');
            resolvedVersionId = String(body?.versionId ?? version);
        } else {
            if (!this.cloudUrl) {
                return c.json({ success: false, error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'OS_CLOUD_URL not configured.' } }, 503);
            }
            packageId = String(body?.packageId ?? '').trim();
            const versionId = String(body?.versionId ?? 'latest').trim() || 'latest';
            if (!packageId) {
                return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'packageId is required.' } }, 400);
            }

            // 1. Fetch manifest snapshot — prefer public R2 fast-path so
            //    install works even when cloud is asleep or down. Fall back
            //    to cloud on miss/error.
            let payload: any;
            const publicBase = resolveMarketplacePublicBaseUrl();
            const fetchAttempts: { label: string; url: string }[] = [];
            if (publicBase) {
                fetchAttempts.push({
                    label: 'public-r2',
                    url: `${publicBase}/packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(versionId)}/manifest.json`,
                });
            }
            fetchAttempts.push({
                label: 'cloud',
                url: `${this.cloudUrl}/api/v1/marketplace/packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(versionId)}/manifest`,
            });

            // Credential for the CLOUD attempt: the env→cloud service key
            // (cloud-hosted) or the bound oscc_ bearer (self-hosted). With it
            // the catalog also serves the caller's OWN org/private packages —
            // anonymous fetches keep getting public/listed only. The public
            // R2 fast-path stays anonymous (it only ever holds public).
            const cloudCredential = (process.env.OS_CLOUD_API_KEY ?? '').trim()
                || this.credentials.read()?.runtimeToken
                || '';

            let lastErrStatus = 0;
            let lastErrText = '';
            for (const attempt of fetchAttempts) {
                try {
                    const headers: Record<string, string> = { Accept: 'application/json' };
                    if (attempt.label === 'cloud' && cloudCredential) headers.Authorization = `Bearer ${cloudCredential}`;
                    const resp = await fetch(attempt.url, { headers });
                    if (!resp.ok) {
                        lastErrStatus = resp.status;
                        lastErrText = (await resp.text().catch(() => '')).slice(0, 200);
                        // 404 from public R2 is not fatal — fall through to cloud.
                        if (attempt.label === 'public-r2' && resp.status === 404) {
                            ctx.logger?.info?.(`[MarketplaceInstallLocal] public-r2 miss for ${packageId}@${versionId}, falling back to cloud`);
                            continue;
                        }
                        if (attempt.label === 'public-r2' && resp.status >= 500) {
                            ctx.logger?.warn?.(`[MarketplaceInstallLocal] public-r2 ${resp.status}, falling back to cloud`);
                            continue;
                        }
                        break; // cloud non-ok → surface error
                    }
                    payload = await resp.json();
                    lastErrStatus = 0;
                    break;
                } catch (err: any) {
                    if (attempt.label === 'public-r2') {
                        ctx.logger?.warn?.(`[MarketplaceInstallLocal] public-r2 fetch error: ${err?.message ?? err}, falling back to cloud`);
                        continue;
                    }
                    return c.json({
                        success: false,
                        error: { code: 'CLOUD_FETCH_FAILED', message: err?.message ?? String(err) },
                    }, 502);
                }
            }
            if (!payload) {
                return c.json({
                    success: false,
                    error: { code: 'CLOUD_FETCH_FAILED', message: `Cloud returned ${lastErrStatus}: ${lastErrText}` },
                }, lastErrStatus === 404 ? 404 : 502);
            }

            const data = payload?.data ?? payload;
            manifest = normalizeBundle(data?.manifest);
            resolvedVersionId = String(data?.version_id ?? versionId);
            version = String(data?.version ?? 'unknown');
        }

        if (!manifest || typeof manifest !== 'object') {
            return c.json({ success: false, error: { code: 'PLUGIN_MANIFEST_INVALID', message: 'Invalid manifest payload.' } }, inlineManifest ? 400 : 502);
        }

        // 1b. [#19576] ⭐ THE DOOR PARSES THE PACKAGE ID — through its
        //     declaration, `ManifestSchema.shape.id`, by reference: never a
        //     copy of the grammar, so a future move of the reverse-domain rule
        //     reaches this door with no further edit.
        //
        //     Before this, the id was `String(manifest?.id ?? manifest?.name)`
        //     and nothing parsed it, so an id the declaration refuses
        //     (`late-app`, `com.example.my_erp`, a number, a manifest carrying
        //     only a `name`) installed cleanly and became the key for the
        //     ledger file and for every `:manifestId` route. The other two
        //     package-install doors — `POST /api/v1/packages`
        //     (`packages/runtime/src/domains/packages.ts`) and the protocol
        //     install primitive — already refuse those ids. This door never
        //     calls the primitive, so neither of their gates covered it.
        //
        //     ⛔ `manifest.name` is NOT an id. `ManifestSchema` declares `id`,
        //     and `name` is a display label with no pattern at all; falling
        //     back to it is exactly how a label became a ledger key.
        //
        //     ⭐ HERE, AND ONLY HERE: this is the one point where both branches
        //     — the inline manifest (after `normalizeBundle` has flattened a
        //     compiled bundle) and the cloud-fetched snapshot — have
        //     converged, and it sits ahead of the collision check, the posture
        //     gate, the hot-register and the ledger write, so none of them
        //     ever sees an unparsed id. Validity is answered BEFORE collision.
        //
        //     ⛔ Rehydrate and the three `:manifestId` routes (DELETE,
        //     reseed, purge) are deliberately NOT gated: they act on ledger
        //     entries that already exist, and gating them would strand an
        //     entry an older build installed under a now-refused id — it could
        //     no longer be healed or removed. Such an entry still rehydrates
        //     and can still be deleted; it cannot be RE-installed under that
        //     id.
        //
        //     The status follows the split this door already makes for an
        //     invalid manifest: caller input answers 400, an upstream snapshot
        //     502. The sentence is the declaration's own, surfaced rather than
        //     reworded. A non-string id fails the leg's type check first,
        //     whose generic sentence names neither the key nor the form, so
        //     that case is answered with `manifestIdRefusal` directly — the
        //     same helper the leg's own pattern refusal is built from.
        const rawId: unknown = manifest.id;
        const declaredId = ManifestSchema.shape.id.safeParse(rawId);
        if (!declaredId.success) {
            const [issue] = declaredId.error.issues;
            const message = typeof rawId === 'string' && issue?.message
                ? issue.message
                : manifestIdRefusal('manifest.id', rawId);
            return c.json({ success: false, error: { code: 'PLUGIN_MANIFEST_INVALID', message } }, inlineManifest ? 400 : 502);
        }
        const manifestId = declaredId.data;
        if (inlineManifest) packageId = manifestId;

        // [ADR-0131 D12 items 7–8] Under a wall, installing, upgrading or
        // replacing a package is the operator's. Asked before any later step
        // of this install reads or writes anything.
        {
            const walled = this.refuseWalledCatalogPackage(c, ctx, 'Installing', manifestId, admission);
            if (walled) return walled;
        }

        // 1c. [#21762] ⭐ ADR-0087 D1'S PROTOCOL HANDSHAKE, before anything is
        //     registered, written or synced: the same `assertProtocolCompat`
        //     the other package-install door (`POST /api/v1/packages`) and the
        //     protocol install primitive run. Before this, a manifest whose
        //     `engines.protocol` excludes this runtime's major answered 200 here:
        //     registered, its ledger entry written, its schemas synced, while
        //     the other door refused the same manifest with a 422.
        //
        //     The refusal is that door's answer, from the one shared helper:
        //     422 `OS_PROTOCOL_INCOMPATIBLE`, the error's own message, and the
        //     diagnostic's five fields in `error.details`. It is 422 on BOTH
        //     branches: a package built for another protocol is a body this
        //     runtime cannot load, not an upstream fault, whichever branch
        //     supplied it (the unrunnable-code refusal below reasons the same).
        //
        //     After the id gate, so the diagnostic names a parsed id. Ahead of
        //     the unrunnable-code judgement, which reads the package's jobs and
        //     hooks with THIS runtime's binder: ADR-0087 D1 checks "before
        //     loading a package's metadata". An absent or unrecognised range is
        //     admitted with a warning, as at every seam the handshake guards.
        try {
            assertProtocolCompat(manifest, undefined, (m) => ctx.logger?.warn?.(`[MarketplaceInstallLocal] ${m}`));
        } catch (err) {
            if (!isProtocolIncompatibleError(err)) throw err;
            const refusal = protocolIncompatibleAnswer(err);
            return c.json({
                success: false,
                error: { code: refusal.code, message: refusal.message, details: refusal.details },
            }, refusal.status);
        }

        // 1c'. [ADR-0141 D2] ⭐ THE PRE-INSTALL DEPENDENCY CHECK, beside the
        //     handshake and as early — before the manifest service sees the
        //     artifact, so a refused install registers, writes and syncs
        //     nothing. Every package this act delivers is judged on its OWN
        //     `manifest.dependencies`: the entries of `packages[]` for a
        //     multi-package artifact, the manifest itself otherwise. A
        //     dependency the same artifact delivers — one of those packages;
        //     never the wrapper's own id, which names no package unless one of
        //     them carries it — is judged for presence only; any other
        //     must be installed in this runtime's registry at a version inside
        //     its range. The refusal is the other install doors' answer, from
        //     the one shared helper, 422 on both branches: a dependency this
        //     environment lacks is the environment's state against a body as
        //     delivered, never an upstream fault.
        //
        //     ⛔ Not at the `kernel:ready` rehydrate, which re-registers what an
        //     install already admitted while the boot is still filling the
        //     registry (AGENTS.md, *Startup registry reads*).
        {
            const entries = Array.isArray(manifest.packages)
                ? manifest.packages
                    .map((entry: unknown) => (isPlainObject(entry) && isPlainObject(entry.manifest) ? entry.manifest : undefined))
                    .filter((m: unknown): m is Record<string, any> => m !== undefined)
                : [manifest];
            let registry: { getPackage?(id: string): any } | undefined;
            try { registry = ctx.getService<IObjectQLEngine>('objectql')?.registry; } catch { /* no data engine — nothing installed */ }
            const unmet = checkDeclaredDependencies({
                delivered: entries,
                getInstalled: (id) => registry?.getPackage?.(id),
            });
            if (unmet.length > 0) {
                const refusal = dependencyMissingAnswer(new DependencyMissingError(unmet));
                return c.json({
                    success: false,
                    error: { code: refusal.code, message: refusal.message, details: refusal.details },
                }, refusal.status);
            }
        }

        // 1e. [ADR-0131 D6] ⭐ THE INSTALL MODE — after the payload, id, D3
        //     walled-catalog and handshake checks and before every other
        //     judgement of the package and any write, because nothing an
        //     author changes in the package answers either refusal:
        //       - the package must PERMIT the requested mode: its manifest's
        //         `installModes`, parsed by reference
        //         (`ManifestSchema.shape.installModes`) and read through the one
        //         resolver, absent meaning `['managed']`;
        //       - `unmanaged` is refused on a deployment whose REQUESTED tenancy
        //         posture walls organizations (`group`, `isolated`, or an
        //         unrecognised value, read fail-closed). Requested, never in
        //         force (`classifyAdmissionTenancyPosture` answers `single` on a
        //         degraded walled boot and would admit an editable shared copy
        //         into a deployment its operator declared multi-tenant) — the
        //         posture the D5e gate below reads too. The refusal is the
        //         import verb's own, through the same function, so its code,
        //         status and sentence are one.
        //     Both on both branches, before any write.
        const modeRefusal = this.judgeInstallMode(manifest, manifestId, installMode, inlineManifest ? 400 : 502);
        if (modeRefusal) return c.json({ success: false, error: modeRefusal.error }, modeRefusal.status as any);

        // 1d. [#21489] ⭐ CODE THIS DOOR CANNOT RUN IS REFUSED, not installed.
        //     A job runs on a JSON door only through its sandboxed `body`; its
        //     deprecated `handler` names a `defineStack({ functions })` entry,
        //     which is code and travels only in the artifact's runtime module —
        //     never in the package this door receives. Before this, such a
        //     package installed with a 200 and its job was declared and never
        //     scheduled, hot or after a restart, with nothing anywhere saying so.
        //
        //     [#21585] The same rule, completed:
        //       - a job whose `body` the declaration refuses (an expression body,
        //         a `body.timeoutMs`) is judged by whether it BINDS, not by
        //         whether it is present — it used to install and never run;
        //       - a hook with no `body`: its function-name `handler` can never
        //         name the package's own code on this door, so it installed and
        //         either never fired or bound by name to code the package does
        //         not ship;
        //       - a job whose `pull` does not bind (a mapping the package does
        //         not declare, one with no `connectorSource`): judged by the
        //         binder's own `judgeJobPull` — it used to install and never be
        //         scheduled.
        //     The judgements are the runtime binder's own, so the door and the
        //     binder cannot disagree about what this door can run.
        //
        //     Answered here, beside the id gate and ahead of the collision check,
        //     the posture gate, the hot-register and the ledger write, so a
        //     refused install leaves the runtime exactly as it found it and the
        //     author can add the body and retry. Only an ENABLED job is judged:
        //     a disabled one is never scheduled on any door; every hook is
        //     judged, since a hook has no on/off switch. ⛔ Rehydrate is not
        //     gated, for the id gate's reason: an entry an older build installed
        //     still rehydrates — its unrunnable job is reported, not run (an
        //     unbindable `pull` is warned by the binder and NOT scheduled), and
        //     its hook with no `body` is warned and NOT bound
        //     ({@link bindArtifactHandlers}).
        const unrunnable = await this.unrunnableCode(ctx, manifest, manifestId);
        if (unrunnable.jobs.length > 0 || unrunnable.hooks.length > 0) {
            return c.json({
                success: false,
                error: {
                    code: UNRUNNABLE_REFUSAL_CODE,
                    message: describeUnrunnable(manifestId, unrunnable),
                },
            }, UNRUNNABLE_REFUSAL_STATUS);
        }

        // ── [ADR-0131 D6] The `unmanaged` install: a copy, not a registration.
        //    The package's metadata is copied ONCE into a new writable base in
        //    the environment ledger by the import verb, and the steps below —
        //    the conflict check, the D5e gate, `manifest.register`, the ledger
        //    entry, the schema sync, the binder, `applySideEffects` — are the
        //    MANAGED install's and never run for it: nothing is registered or
        //    recorded under the package's own id, so nothing upgrades it and no
        //    boot rehydrates it. Its items are the environment's own from here.
        if (installMode === 'unmanaged') {
            return this.installUnmanaged(c, ctx, {
                manifest,
                manifestId,
                version,
                versionId: resolvedVersionId,
                userId,
            });
        }

        // 1f. [ADR-0131 D6] ⭐ A MANAGED INSTALL NEVER TAKES OVER AN UNMANAGED
        //     COPY, on BOTH branches, before any write. A copy keeps the
        //     package's namespace under a writable base of its own, so a
        //     WRITABLE package holding this package's namespace is this
        //     environment's own metadata under the names the package ships.
        //     Registering the package over it would hand the namespace to code:
        //     on the inline branch the registry's namespace gate throws, but the
        //     cloud-fetched branch registers LENIENTLY (the ledger entry is
        //     written with `hotLoaded: false`), and at the next boot the
        //     package's definitions win and the copied, customer-edited items
        //     stop being served. So the door refuses first, naming the base.
        //     ⛔ Only a WRITABLE holder: a namespace held by another code
        //     package keeps the lenient branch's existing behaviour, whose fate
        //     is a separate decision.
        const copyBase = this.findEnvironmentBaseHoldingNamespace(ctx, manifest, manifestId);
        if (copyBase) {
            return c.json({
                success: false,
                error: {
                    code: 'RESOURCE_CONFLICT',
                    message: `Package '${manifestId}' cannot be installed managed: its namespace '${copyBase.namespace}' is held by `
                        + `the writable base '${copyBase.base}' — an unmanaged install of this package, or a base authored `
                        + 'in this system — whose items are this system\'s own metadata. A managed '
                        + 'install would hand that namespace to the package and stop serving them. Keep the copy (it follows '
                        + `no upgrade), or uninstall the base '${copyBase.base}' first; its items go with it.`,
                    details: { namespace: copyBase.namespace, base: copyBase.base },
                },
            }, 409);
        }

        // 2. Conflict check — refuse to overwrite user-authored apps
        const conflict = this.findConflict(ctx, manifestId);
        if (conflict === 'user-code') {
            return c.json({
                success: false,
                error: {
                    code: 'MANIFEST_CONFLICT',
                    message: `manifest_id "${manifestId}" is already defined by this runtime's local code. Refusing to overwrite. Uninstall the local definition first.`,
                },
            }, 409);
        }

        // 2a. [#28039] The package's datasources are registered as code and
        //     connected in step 4b′, so a name another holder already owns —
        //     the host's `default`, a datasource created in Setup or another
        //     package's — is refused here, before any write: connecting would
        //     hand the package's objects that holder's pool (the connect is
        //     idempotent on the name), and recording the name as code would
        //     make the holder's own datasource read-only to the admin door.
        //     [#28143] Judged by the runtime's ONE judge, which reads the data
        //     engine as well (a driver the legacy `onEnable` bridge registered
        //     has no metadata item), and a holder that cannot be read refuses
        //     `503`: a check that did not run is never taken for "no holder".
        const heldDatasource = await this.findHeldDatasourceName(ctx, manifest, manifestId);
        if (heldDatasource && 'reading' in heldDatasource) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] install of ${manifestId} refused: whether another holder owns its datasource `
                + `'${heldDatasource.name}' could not be judged — ${heldDatasource.reading} could not be read (${heldDatasource.error})`,
            );
            return c.json({
                success: false,
                error: {
                    code: 'SERVICE_UNAVAILABLE',
                    message: `Package '${manifestId}' cannot be installed now: it declares the datasource '${heldDatasource.name}', `
                        + `and whether another holder already owns that name could not be checked (${heldDatasource.reading} `
                        + 'could not be read). A check that did not run is never taken for "no holder". Nothing was installed '
                        + 'or written. Retry once that store answers.',
                    details: { datasource: heldDatasource.name, reading: heldDatasource.reading },
                },
            }, 503);
        }
        if (heldDatasource) {
            return c.json({
                success: false,
                error: {
                    code: 'RESOURCE_CONFLICT',
                    message: `Package '${manifestId}' cannot be installed: it declares the datasource '${heldDatasource.name}', `
                        + `and ${heldDatasource.holder} already holds that name in this system. Rename the package's datasource, `
                        + 'or remove the one holding the name first.',
                    details: { datasource: heldDatasource.name },
                },
            }, 409);
        }

        // 2b. [ADR-0120 D5e] `isolated`-posture gate on installation-wide
        //     uniques. Runs BEFORE hot-register and before anything is written
        //     to the ledger: a stopped install must leave the runtime exactly as
        //     it found it, so the installer can rewrite the metadata and retry
        //     without an uninstall in between.
        //
        //     #5426 — `.entry` alone, on purpose. A ledger file that will not
        //     parse is treated here exactly as "no previous attestation", so a
        //     corrupt entry makes the gate ASK AGAIN rather than skip: the
        //     fail-safe direction (worst case, a one-time ceremony is repeated;
        //     the case that must never happen — an installation-wide unique
        //     going unconfirmed because its record was unreadable — cannot).
        //     Conflating the two nulls is the right call at THIS call site; it
        //     is now made here, in the open, instead of by the ledger for
        //     everyone.
        const previousEntry = this.ledger.read(manifestId).entry;
        const gate = this.evaluateGlobalUniqueGate(manifest, previousEntry, body, userId);
        if (gate.blocked) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] install of ${manifestId} stopped by the ADR-0120 D5e posture gate ` +
                `(${gate.pending.length} unconfirmed installation-wide unique(s))`,
            );
            return c.json({
                success: false,
                error: {
                    code: GLOBAL_UNIQUE_CONFIRMATION_REQUIRED,
                    message: buildGlobalUniqueStopMessage(manifestId, gate.pending),
                    // Machine-readable so an AI installer can decide per index
                    // instead of re-parsing the prose it was handed.
                    details: {
                        posture: gate.posture,
                        findings: gate.pending.map((f) => ({
                            id: f.id,
                            object: f.object,
                            kind: f.kind,
                            ...(f.name ? { name: f.name } : {}),
                            columns: f.columns,
                            spelling: f.spelling,
                            describe: describeGlobalUniqueFinding(f),
                        })),
                        confirmWith: {
                            body: { confirmGlobalUniques: gate.pending.map((f) => f.id) },
                            cli: 'os package install … --confirm-global-uniques',
                        },
                    },
                },
            }, 409);
        }

        // ADR-0087 D2 — the fetched bundle is a published artifact, so it is
        // converted forward ONCE here ({@link convertPackageBodyForward}); the
        // converted body is what the access check compares (2c), what
        // registers (3), what the binder binds (4c) and what the side effects
        // replay (5). The ledger entry (4) keeps the body as installed, and
        // rehydrate converts it again at every boot.
        const converted = this.convertPackageBodyForward(ctx, manifest);

        // 2c. [ADR-0126 §6 wall 3] ⭐ AN UPGRADE NEVER UN-MAKES AN ACCESS
        //     CHOICE UNCONFIRMED. On a re-install over an installed package —
        //     a fresh install has no choice of the customer's to un-make — the
        //     security plugin's check compares the customer's switch-offs,
        //     clones and sharing rule rows against the registry as the incoming
        //     version would leave it, and answers what THIS upgrade would
        //     create. Any finding stops the install `409
        //     ACCESS_UPGRADE_CONFIRMATION_REQUIRED` until the same call carries
        //     the finding set's token; a check that could not read answers 503.
        //     Before any write, after the D5e gate, so a stopped install leaves
        //     the runtime as it found it. Who can reach this step is the door's
        //     admission's: under a wall, the operator alone (the D12 refusal
        //     above); under `single`, a `manage_metadata` holder.
        let accessUpgradeConfirmation: InstalledEntry['accessUpgradeConfirmation'];
        if (conflict === 'marketplace') {
            const access = await this.evaluateAccessUpgradeGate(ctx, manifestId, converted, previousEntry, body, userId);
            if (access.refusal) return c.json(access.refusal.body, access.refusal.status);
            accessUpgradeConfirmation = access.confirmation;
        }

        // 2d. [ADR-0146 D2, #28410] ⭐ THE OVERRIDE WRITE GATE. A managed
        //     install registers the package's items as code, past every publish
        //     door, so the gate those doors ask is asked here, on the converted
        //     body, before any write: only the base's paired `<base>.custom`
        //     declares an override, a dependent's item bearing a name its
        //     closure ships is refused (rename), and a declaration the gate does
        //     not admit is refused — `403 NOT_OVERRIDABLE`, the publish doors'
        //     code and status, one sentence per item in `details`. On a base
        //     (re)install, the names installed dependents already hold that
        //     this version now ships are listed on the answer
        //     (`overrideCollisions`), never refused.
        const overrideGate = await this.evaluateOverrideWriteGate(ctx, manifestId, converted);
        if (overrideGate.refusals.length > 0) {
            const n = overrideGate.refusals.length;
            return c.json({
                success: false,
                error: {
                    code: 'NOT_OVERRIDABLE',
                    message: `Package '${manifestId}' cannot be installed: ${n} of its item${n > 1 ? 's are' : ' is'} refused by `
                        + `the override write gate (ADR-0146 D2). ${overrideGate.refusals[0].message}`
                        + (n > 1 ? ` (${n - 1} more in \`details.refusals\`.)` : '')
                        + ' Nothing was installed or written.',
                    details: { refusals: overrideGate.refusals },
                },
            }, 403);
        }

        // 2e. [ADR-0146 D10, second rule] ⭐ THE FIELD-PATCH TARGET CHECK,
        //     beside the override gate and before any write: a patch naming a
        //     field its target does not have, or an option value its field does
        //     not have, would change nothing and say nothing. Refused `400
        //     VALIDATION_ERROR` on both branches, every refusal located in
        //     `details.refusals`. The target is the registry's resolved object
        //     (ADR-0141 D2 admitted the base first) or one this artifact
        //     delivers.
        const patchTargetRefusals = this.fieldPatchTargetRefusalsOf(ctx, converted);
        if (patchTargetRefusals.length > 0) {
            return c.json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: fieldPatchTargetRefusalMessage(manifestId, patchTargetRefusals),
                    details: { refusals: patchTargetRefusals },
                },
            }, 400);
        }

        // 3. Hot-register FIRST so a malformed inline manifest fails the
        //    install loudly rather than persisting a broken record that
        //    would also fail on every subsequent rehydrate.
        //
        //    [#22695] What this step did is RECORDED here and carried to the
        //    answer: `hotLoadError` stays `undefined` exactly when the
        //    register resolved, and the answer's `hotLoaded` is derived from
        //    it — never a literal. Before this, `hotLoaded: true` was written
        //    unconditionally, so the lenient path below answered that the
        //    running kernel held a package it did not, and the console read
        //    that answer as "the app should now appear".
        let hotLoadError: string | undefined;
        try {
            const manifestService = ctx.getService('manifest') as any;
            // Awaited: register also bridges the manifest's objects into the
            // metadata service — a caller that reads metadata right after a
            // 200 (AI describe_object, Studio object list) must see them.
            // [#23972] The registry row records where this package came
            // from: the marketplace (`source: 'marketplace'`) — for every
            // member of a `packages[]` bundle too, whatever its entry states
            // ([#28534], {@link asMarketplaceRegistration}).
            await manifestService.register(asMarketplaceRegistration(converted), { source: 'marketplace' });
        } catch (err: any) {
            const registerError = String(err?.message ?? err);
            // For offline file imports we treat a register failure as a hard
            // failure (don't persist). Cloud installs historically tolerated
            // this (the on-disk record survives a restart), so keep that path
            // lenient for backwards compatibility.
            if (inlineManifest) {
                return c.json({
                    success: false,
                    error: { code: 'PLUGIN_REGISTER_FAILED', message: `Failed to register imported manifest: ${registerError}` },
                }, 422);
            }
            // [#25366] …EXCEPT the security catalog's one-name-one-holder refusal
            // naming an ENVIRONMENT-authored item (a customer's clone of a vendor
            // permission set or position, under a name this version now ships).
            // No restart heals it: the next load of this ledger entry meets the
            // same environment item and is refused the same way (see
            // {@link refusesEnvironmentHeldCatalogName}), so the lenient answer
            // ("loads at the next restart") would be false. Measured on a real
            // restart: the boot runs, the rehydrate logs the refusal, and the
            // package is not loaded at all — its earlier version neither, since
            // the ledger entry that named it was overwritten. The registry's
            // package door refused before any of its own writes, and nothing of
            // this door's is written yet, so the cloud branch refuses exactly as
            // the inline branch does — `422 PLUGIN_REGISTER_FAILED`, the
            // registry's sentence naming each colliding name and its holder —
            // and the installer renames one of the two items and retries.
            if (refusesEnvironmentHeldCatalogName(err)) {
                return c.json({
                    success: false,
                    error: { code: 'PLUGIN_REGISTER_FAILED', message: `Package '${manifestId}' cannot be installed: ${registerError}` },
                }, 422);
            }
            // [#22695] The lenient path stays lenient — whether it should is a
            // separate decision, ⛔ not made here. What changes is that the
            // caller is TOLD: the answer carries `hotLoaded: false` and this
            // message, so a reader can say "installed, loads at the next
            // restart" instead of a false success.
            hotLoadError = registerError;
            ctx.logger?.warn?.(`[MarketplaceInstallLocal] hot-register failed for ${manifestId} (will load on next restart): ${registerError}`);
        }

        // 4. Persist on disk
        const entry: InstalledEntry = {
            packageId,
            versionId: resolvedVersionId,
            manifestId,
            version,
            manifest,
            installedAt: new Date().toISOString(),
            installedBy: userId,
            withSampleData: false,
            // [ADR-0120 D5e] Carry the attestation across the reinstall so the
            // ceremony is not re-run for constraints already answered for, and
            // fold in whatever this install confirmed.
            ...(gate.attestation ? { globalUniqueAttestation: gate.attestation } : {}),
            // [ADR-0126 §6 wall 3] The confirmation step 2c admitted, recorded.
            ...(accessUpgradeConfirmation ? { accessUpgradeConfirmation } : {}),
        };
        try {
            this.ledger.write(entry);
        } catch (err: any) {
            return c.json({
                success: false,
                error: { code: 'MARKETPLACE_STORAGE_FAILED', message: `Failed to persist manifest: ${err?.message ?? err}` },
            }, 500);
        }

        // 4b. Sync schemas to physical tables — registerApp only adds the
        //     object definitions to the in-memory registry; the driver
        //     must be asked to materialize tables/columns before any seed
        //     insert (or user write) succeeds.
        try {
            const ql: any = ctx.getService('objectql');
            if (ql && typeof ql.syncSchemas === 'function') {
                await ql.syncSchemas();
                ctx.logger?.info?.(`[MarketplaceInstallLocal] syncSchemas() ran after registering ${manifestId}`);
            }
        } catch (err: any) {
            ctx.logger?.warn?.(`[MarketplaceInstallLocal] syncSchemas failed for ${manifestId}: ${err?.message ?? err}`);
        }

        // 4b′. [#28039] Register, record and connect the package's declared
        //     datasources through the runtime's ONE path — the call
        //     `AppPlugin.start` makes for a boot artifact — after the schema
        //     sync, where the boot connects them too. Only for a package the
        //     running kernel holds: on the lenient path nothing of it is
        //     registered until the restart's rehydrate, which connects them.
        const datasources = hotLoadError === undefined
            ? await this.connectDeclaredDatasources(ctx, converted, manifestId, version)
            : undefined;

        // 4c. [#21321] Bind the package's script-action bodies and body hooks
        //     through the runtime's ONE binder — the call `AppPlugin.start`
        //     makes for a boot artifact. A reinstall replaces the previous
        //     version's set rather than adding to it.
        await this.bindArtifactHandlers(ctx, converted, manifestId);

        // 5. Replicate the AppPlugin start-time side-effects that the
        //    `manifest` service does NOT do on its own:
        //      • load translation bundles into the i18n service
        //      • stash seed datasets on the kernel + run them now so the
        //        installed app has demo data on first paint.
        const seededSummary = await this.applySideEffects(ctx, converted, { seedNow: true, c });
        // `skipped` counts too: an all-skip run means the rows are ALREADY in
        // the database (e.g. a reinstall/upgrade over live sample data) — the
        // install carries sample data either way. Leaving the flag false here
        // is what made older ledgers claim "no sample data" over a seeded DB.
        const seededRows = (seededSummary.seeded.inserted ?? 0) + (seededSummary.seeded.updated ?? 0) + (seededSummary.seeded.skipped ?? 0);
        if (seededSummary.seeded.mode === 'inline' && seededRows > 0) {
            entry.withSampleData = true;
            entry.sampleDataPurged = false;
            try {
                this.ledger.write(entry);
            } catch { /* non-fatal — entry already on disk */ }
        }

        // 6. [#21322] Re-run the boot's `kernel:ready` sweeps for a package that
        //    arrived after them — LAST, after the seed, because that is where
        //    the boot runs them: a record-change flow bound before the seed
        //    would fire on every seeded row, which no boot does.
        await this.announceHotInstall(ctx, manifestId);

        // 7. [#27237] Which connector credentials the package names, and which
        //    are not set yet — after the re-sync above, so the listing reads
        //    what the reconcile it triggered saw.
        const described = await this.describeInstalledCredentialRefs(ctx, converted);
        const credentialRefs = described?.entries;
        const unsetRefs = (credentialRefs ?? []).filter((r) => r.status !== 'set').map((r) => r.ref);
        // The door is named only when it can store one of them: a listing that
        // says none is writable (a walled posture) gets the other places.
        const door = described?.writable === undefined || unsetRefs.some((r) => described.writable!.has(r));

        return c.json({
            success: true,
            data: {
                manifestId,
                version,
                versionId: resolvedVersionId,
                installedAt: entry.installedAt,
                // [#22695] Whether step 3's register resolved — `false` only on
                // the lenient path, where the package is in the ledger and the
                // running kernel does not hold it until the next restart.
                hotLoaded: hotLoadError === undefined,
                // The register error's message, beside `hotLoaded: false` and
                // ONLY there: omitted, not nulled, on a hot-loaded install, so
                // the success answer's key set is unchanged.
                ...(hotLoadError !== undefined ? { hotLoadError } : {}),
                // [#27237] Omitted, not emptied, for a package whose connectors
                // name no credential, so that answer's key set is unchanged.
                ...(credentialRefs !== undefined ? { credentialRefs } : {}),
                // [#28039] Each declared datasource's connect verdict — `connected`,
                // or the connection service's named non-`ok` status (a credential
                // it cannot resolve is `failed-credentials`). Omitted for a package
                // that declares none, so that answer's key set is unchanged.
                ...(datasources !== undefined ? { datasources } : {}),
                ...(unsetRefs.length > 0 ? { credentialNote: installedCredentialNote(unsetRefs, { door }) } : {}),
                upgradedFrom: conflict === 'marketplace' ? 'previous-marketplace-version' : null,
                // [ADR-0146 D2, #28410] Names installed dependents already held,
                // undeclared, that this version now ships (step 2d). Omitted when
                // there are none, so that answer's key set is unchanged.
                ...(overrideGate.collisions.length > 0 ? { overrideCollisions: overrideGate.collisions } : {}),
                translationsLoaded: seededSummary.translationsLoaded,
                seeded: seededSummary.seeded,
                // #6721: the RESOLVED ledger directory on THIS host — the same
                // value the GET listing serves (`handleList`), from the same
                // field. It is here because the installer is remote: `os package
                // install` never touches this machine's disk, so without it the
                // CLI can only describe the directory by literal, and that
                // literal is wrong the moment a host configures `storageDir`.
                // Keep the two endpoints reading `this.storageDir` — a second
                // derivation is how they diverged in the first place.
                storageDir: this.storageDir,
                // [#22695] The note makes the same claim `hotLoaded` does, so it
                // follows the same record: it never says "now available" over a
                // kernel that does not hold the package.
                note: hotLoadError === undefined
                    ? 'App is now available in this runtime. Refresh the console to see it in the app switcher.'
                    : 'App installed and cached on this runtime, but the running kernel could not load it '
                        + '(`hotLoadError` says why). The runtime registers it again at its next restart.',
            },
        }, 200);
    };

    /**
     * `GET /…/installed` — the console's "Installed Apps" list.
     *
     * #5413: the WIRE SHAPE is deliberately unchanged. A corrupt ledger entry
     * is reported to the operator's log, not to the HTTP client — putting it in
     * the response body is a separate decision about this endpoint's schema and
     * is explicitly NOT made here. What the fix removes is the case where a
     * short list was served with `success: true` and nobody, anywhere, could
     * have known.
     *
     * ## [commit 01074e551] Authenticated floor + field narrowing — the posture, ruled
     *
     * #8976 gated the four MUTATING doors and left this read as the only
     * anonymous door on the surface: `handleList` opened on `this.readAll()`,
     * resolved no identity at all, and served the whole ledger with `200` to
     * anyone who could reach the port — including `installedBy` (a platform
     * user id, enumerated across every install) and `storageDir` (an absolute
     * filesystem path on the host). Maintainer ruling 2026-08-16, Option 3:
     *
     *   caller                                items  total  installedBy  storageDir
     *   anonymous                              ——     ——        ——           ——      → 401
     *   authenticated, no `manage_metadata`    ✔      ✔         ✘            ✘       → 200
     *   authenticated, `manage_metadata`       ✔      ✔         ✔            ✔       → 200
     *
     * **Why a floor and not the write doors' 403.** The console's Setup →
     * "Installed Apps" page is a real, signed-in consumer that ships to
     * non-operator users; demanding `manage_metadata` for the whole read would
     * have withdrawn a shipped page rather than closed a hole. What is genuinely
     * operator-grade is not "which packages are installed" — it is **who
     * installed them and where they live on this host**, so those two fields,
     * and only those two, follow the capability the write doors demand.
     *
     * **Omitted, not nulled.** A narrowed caller's entry simply has no
     * `installedBy` key. `null` would be a claim about the ledger (installed by
     * nobody) instead of a fact about the caller, and the console already
     * renders that line conditionally.
     *
     * ⛔ The mount stays unconditional — cloud#1287 moved it out of the
     * `marketplaceUrl` ternary precisely so air-gapped boxes stop 404ing. The
     * answer to an unauthorized read is a refusal, never an absent route.
     *
     * Identity comes from {@link resolveInstallPrincipal} — the SAME resolver
     * the four mutating doors use, not a second session read. Two auth
     * mechanisms in one file is how the next gap gets created, and this file has
     * already produced one.
     *
     * ## [#21775] `withSampleData` is the caller's own scope, read from its rows
     *
     * Each entry's `withSampleData` answers "does MY scope hold this package's
     * sample data?" — derived per request by {@link sampleDataInScope}, never
     * read from the ledger's install-wide record of the same name.
     *
     * ## [#21822] An entry the rehydrate refused is listed, marked not loaded
     *
     * The `kernel:ready` rehydrate keeps an entry whose declared protocol range
     * excludes this runtime in the ledger, and loads none of it. The listing
     * served it like any installed package, so the console's Installed Apps
     * said "installed" while only a boot log line said otherwise. It is listed
     * still — DELETE and a compatible re-install act on it, and omitting it
     * would leave the operator nothing to uninstall from — with a marker:
     *
     *   { …, "installedAt": "…", "notLoaded": { "code": "OS_PROTOCOL_INCOMPATIBLE", "requiredRange": "^16" } }
     *
     * read from what the rehydrate recorded ({@link refusedAtRehydrate}).
     * `notLoaded` stands in place of `withSampleData`: none of the package's
     * objects are registered, so no seed row is read for it and the listing
     * makes no claim about its rows — omitted, not `false`, for the reason
     * `installedBy` is omitted above. A loaded entry is served exactly as before,
     * with no `notLoaded` key. The marker is served to every authenticated
     * caller: it says what the runtime holds, not who installed it or where.
     */
    private handleList = async (c: any, ctx: PluginContext): Promise<Response> => {
        // Before the ledger is touched, exactly as the mutating doors refuse
        // before any work: a refused caller must not be able to learn what is
        // installed from timing or from a downstream storage error.
        const principal = await this.resolveInstallPrincipal(c, ctx);
        if (!principal) return this.refuseUnauthenticated(c);
        const held = refuseHeldSession(c, principal);
        if (held) return held;
        const operator = principal.systemPermissions.includes(INSTALL_LOCAL_CAPABILITY);

        const { entries, skipped } = this.readAll();
        this.warnSkippedLedgerEntries(ctx, skipped, 'it is MISSING from the installed-apps list served to the console');
        const notLoaded = new Map<string, NotLoadedMarker>();
        for (const e of entries) {
            const marker = this.notLoadedMarker(e);
            if (marker) notLoaded.set(e.manifestId, marker);
        }
        const withSampleData = await this.sampleDataInScope(c, ctx, entries.filter((e) => !notLoaded.has(e.manifestId)));
        return c.json({
            success: true,
            data: {
                items: entries.map(e => {
                    const marker = notLoaded.get(e.manifestId);
                    return {
                        packageId: e.packageId,
                        versionId: e.versionId,
                        manifestId: e.manifestId,
                        version: e.version,
                        installedAt: e.installedAt,
                        ...(marker ? { notLoaded: marker } : { withSampleData: withSampleData.has(e.manifestId) }),
                        ...(operator ? { installedBy: e.installedBy } : {}),
                    };
                }),
                total: entries.length,
                ...(operator ? { storageDir: this.storageDir } : {}),
            },
        }, 200);
    };

    /**
     * [#21822] The not-loaded marker for a listed ledger entry, or `undefined`
     * for one this boot loaded. Marked only when the rehydrate refused THIS
     * entry: same manifest id, same `installedAt` (see {@link refusedAtRehydrate}).
     */
    private notLoadedMarker = (entry: InstalledEntry): NotLoadedMarker | undefined => {
        const refused = this.refusedAtRehydrate.get(entry.manifestId);
        if (!refused || refused.installedAt !== entry.installedAt) return undefined;
        return { ...refused.marker };
    };

    /**
     * [#21775] The listed entries whose sample data is in the CALLER'S scope —
     * the set the listing answers each entry's `withSampleData` from.
     *
     * ## The rows are the authority, not the ledger
     *
     * The ledger's `withSampleData` / `sampleDataPurged` are install-time
     * records: one value per install, flipped by whichever organization seeded
     * or purged last. Under an organization wall sample data is per
     * organization — the install, the reseed and the purge each act in the
     * caller's active organization, and the per-organization replay seeds every
     * new one — so the listing that read the record told organization B "no
     * sample data" after a purge in organization A, while B held every one of
     * its seed rows. The ledger shape stays as it is; the listing stops reading
     * it.
     *
     * ## Present = at least one seed row, identified the purge's way
     *
     * An entry is in the set when {@link matchSeedRows} — the purge's own
     * identification (each dataset's `externalId`), read-only — finds at least
     * ONE of the package's seed rows in scope. Not "all", and not a count: the
     * console reads the flag to enable its purge item and to word its reseed
     * item ("Add sample data" / "Reseed again"), and the purge has work to do
     * exactly when one seed row is there. A seed record the purge could not
     * identify either (no key value, a key two rows carry) is not evidence of
     * presence; the purge reports those when it runs.
     *
     * ## Scope — the purge's
     *
     * Under a wall, the caller's active organization, from the same
     * `organizationWallActive` + `resolveActiveOrgId` pair the purge scopes
     * with. Without a wall the deployment is one logical tenant and the match is
     * table-wide, as the purge's is, so the derived answer is the one the
     * ledger records after an install that seeded, a purge and a reseed. Where
     * a door's write did not land whole — a purge the engine refused for some
     * rows, rows deleted by hand — the rows answer and the record does not.
     *
     * A walled session with NO active organization reads nothing: every entry
     * answers `false`, HTTP 200, and no row is read (ADR-0123 D2 — a
     * tenant-scoped read resolves to nothing, not an error). The doors that
     * would act on that answer, reseed and purge, refuse the same session with
     * D2's write refusal.
     *
     * ## When the rows cannot be read
     *
     * No metadata service, a dependency graph that does not build, an object
     * whose rows the engine will not return: the entry answers `false`, and why
     * is logged at `warn` — once per entry per request, the way this door
     * reports a corrupt ledger entry — to the operator, with the wire shape
     * unchanged.
     */
    private sampleDataInScope = async (c: any, ctx: PluginContext, entries: InstalledEntry[]): Promise<Set<string>> => {
        const present = new Set<string>();
        const seeded = entries
            .map((entry) => ({ entry, datasets: seedDatasetsOf(entry.manifest) }))
            .filter(({ datasets }) => datasets.length > 0);
        if (seeded.length === 0) return present;

        let organizationId: string | undefined;
        if (organizationWallActive(ctx)) {
            const resolved = await this.resolveActiveOrgId(c, ctx);
            // [ADR-0123 D2] No organization, so no organization's rows to read.
            if (!resolved) return present;
            organizationId = resolved;
        }

        const unread = (manifestId: string, why: string): void => {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] ${manifestId}: the installed-apps listing could not read this package's `
                + `seed rows (${why}), so it answers withSampleData: false for it`,
            );
        };
        let ql: IObjectQLEngine | undefined;
        let metadata: IMetadataService | undefined;
        try { ql = ctx.getService<IObjectQLEngine>('objectql'); } catch { /* no data engine */ }
        try { metadata = ctx.getService<IMetadataService>('metadata'); } catch { /* no metadata service */ }
        if (!ql || !metadata) {
            for (const { entry } of seeded) {
                unread(entry.manifestId, 'the data engine (objectql) or the metadata service is not available on this runtime');
            }
            return present;
        }

        for (const { entry, datasets } of seeded) {
            try {
                // The graph the purge reads its order and its reference keys
                // from: the loader's own, over the package's seeded objects.
                const { SeedLoaderService } = await import('@objectstack/runtime');
                const loader = new (SeedLoaderService as any)(ql, metadata, ctx.logger);
                const graph = await loader.buildDependencyGraph([...new Set(datasets.map((d) => String(d.object)))]);
                const failedReads: string[] = [];
                const match = await matchSeedRows({
                    engine: ql,
                    datasets,
                    graph,
                    organizationId,
                    firstOnly: true,
                    report: (problem) => {
                        if (problem.kind === 'read') failedReads.push(`${problem.object}: ${problem.detail}`);
                    },
                });
                if (match.rows.length > 0) present.add(entry.manifestId);
                else if (failedReads.length > 0) unread(entry.manifestId, failedReads.join('; '));
            } catch (err: any) {
                unread(entry.manifestId, String(err?.message ?? err));
            }
        }
        return present;
    };

    private handleUninstall = async (c: any, ctx: PluginContext): Promise<Response> => {
        const admission = await this.requireInstallCapability(c, ctx, 'Uninstalling a package');
        if (!admission.ok) return admission.response;
        const manifestId = String(c.req.param?.('manifestId') ?? c.req.params?.manifestId ?? '').trim();
        if (!manifestId) {
            return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'manifestId path param required.' } }, 400);
        }
        if (!this.ledger.has(manifestId)) {
            return c.json({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: `No marketplace install for ${manifestId}.` } }, 404);
        }
        // [ADR-0131 D12 items 7–8] Under a wall, uninstalling a package is the
        // operator's: it removes the package's metadata from every
        // organization. Asked before the ledger is touched.
        {
            const walled = this.refuseWalledCatalogPackage(c, ctx, 'Uninstalling', manifestId, admission);
            if (walled) return walled;
        }
        // [#28511, ADR-0146 D3] THE REGISTRY'S UNINSTALL REFUSAL, ASKED BEFORE
        // THE LEDGER WRITE. The withdrawal below asks the registry to
        // uninstall the package, and the registry refuses a base whose paired
        // customization package (`<base>.custom`) it holds, or a package
        // owning an object another package extends (ADR-0029). Met only
        // there, that refusal came after the ledger entry was gone: the door
        // answered 200 with a failed `registry.uninstallPackage` outcome, the
        // base stayed registered until the restart, and the restart then
        // dropped it from under its pair. So the same question is asked here,
        // of the same registry and the same id the withdrawal uninstalls,
        // through `assertPackageUninstallable` — the ONE predicate
        // `uninstallPackage` itself asks, which mutates nothing — and its
        // refusal is the request's: its own `409 RESOURCE_CONFLICT` and its
        // sentence, with nothing moved (the ledger entry, the registration and
        // the pair stay as they were).
        //
        // ⛔ A refusal check ahead of the ledger write, not a reversal of
        // #21576's ledger-then-withdraw order: an uninstall the registry would
        // let go still removes the ledger entry first. No `objectql` registry,
        // or one that does not carry the method (an engine double), is not
        // asked, and the door behaves as before: anything the withdrawal then
        // meets is reported on `cleanups`. A throw that is not the coded
        // refusal is left to the withdrawal the same way, never answered as a
        // conflict it is not.
        {
            let registry: { assertPackageUninstallable?(id: string): void } | undefined;
            try { registry = ctx.getService<IObjectQLEngine>('objectql')?.registry as typeof registry; } catch { /* no data engine — nothing registered */ }
            if (typeof registry?.assertPackageUninstallable === 'function') {
                try {
                    registry.assertPackageUninstallable(manifestId);
                } catch (err: any) {
                    if (err?.code === 'RESOURCE_CONFLICT' && err?.status === 409) {
                        return c.json({
                            success: false,
                            error: { code: 'RESOURCE_CONFLICT', message: String(err.message) },
                        }, 409);
                    }
                }
            }
        }
        try {
            this.ledger.remove(manifestId);
        } catch (err: any) {
            return c.json({ success: false, error: { code: 'MARKETPLACE_STORAGE_FAILED', message: err?.message ?? String(err) } }, 500);
        }
        // [#21576] Only now — the ledger entry is gone, so the package will not
        // come back at the next restart — withdraw it from the running kernel,
        // and then [#21490] revoke what its metadata granted. Never before: an
        // uninstall whose ledger write failed above leaves the package
        // installed, and it must stay registered and keep its grants.
        //
        // The withdrawal goes FIRST, with no `await` between it and the ledger
        // removal, for the same reason `deletePackage` withdraws before it runs
        // the cleanups: from the moment the uninstall is durable, nothing that
        // reads "registered packages" can see this one again. The cleanups
        // await the store row by row; were the package still registered while
        // they ran, another request's hot install announcing
        // `metadata:reloaded` in that window would re-project the very sets
        // they had just selected and removed. The cleanups lose nothing by
        // going second: `deletePackage` already runs every registered cleanup
        // after its withdrawal, and `security.package-permissions` reads no
        // registry: it selects by package id in the store, and by the names
        // handed to it. [ADR-0090 D5] Those names are captured just before the
        // withdrawal releases them — synchronously, so still no `await` before
        // it, at the same point and through the same helper as
        // `deletePackage` — and the cleanup revokes the grants naming them.
        //
        // [#24070] The registry is one of the two places the install put the
        // package's objects: its `manifest.register` also bridged a copy of
        // each into the `metadata` service, which the object reads serve. The
        // copies go right after the registry half and before the cleanups —
        // only once the registry withdrew, so a refused withdrawal leaves the
        // package whole, as loaded as it was.
        let registry: unknown;
        try { registry = ctx.getService<IObjectQLEngine>('objectql')?.registry; } catch { /* no data engine — nothing registered */ }
        const declared = captureUninstallDeclared(registry, manifestId);
        const withdrawal = this.withdrawFromRunningKernel(ctx, manifestId);
        const copies = withdrawal ? undefined : await this.withdrawObjectCopies(ctx, manifestId);
        // [#24182] …and the copies of OTHER packages' objects that this one's
        // extensions rewrote: the bridge that wrote them restores the owner's
        // definition (`manifest.restoreExtendedObjectCopies`, never rejects).
        if (!withdrawal) {
            let manifestService: { restoreExtendedObjectCopies?(id: string): Promise<void> } | undefined;
            try { manifestService = ctx.getService('manifest') as typeof manifestService; } catch { /* no engine — nothing bridged */ }
            await manifestService?.restoreExtendedObjectCopies?.(manifestId);
        }
        const cleanups = [
            ...(withdrawal ? [withdrawal] : []),
            ...(copies ? [copies] : []),
            ...await this.runUninstallCleanups(ctx, manifestId, admission.userId, declared),
        ];
        // [#27395] LAST — after the registry withdrawal and the cleanups, never
        // before, for the window described above — announce the withdrawal as
        // `metadata:reloaded`, the re-sync the install's hot load announces, so
        // the consumers that hold what they read from a package re-read it now
        // that it is gone. ⛔ Nothing here withdraws a flow or unbinds a trigger
        // itself: the uninstall drives the one teardown a reload drives. Not
        // when the registry refused: the package is still registered, so a
        // re-sync would only read it back.
        const resync = withdrawal ? undefined : await this.announceUninstall(ctx, manifestId);
        if (resync) cleanups.push(resync);
        const withdrawals = (withdrawal ? 1 : 0) + (copies ? 1 : 0) + (resync ? 1 : 0);
        ctx.logger?.info?.(
            `[MarketplaceInstallLocal] uninstalled ${manifestId} (cached manifest removed; `
            + (withdrawal
                ? 'the running kernel did NOT withdraw it, so it stays loaded until the next restart; '
                : copies || resync
                    ? 'withdrawn from the running kernel\'s registry, but '
                        + [
                            ...(copies ? ['the metadata service kept copies of its objects'] : []),
                            ...(resync ? ['the automation engine can still hold its flows'] : []),
                        ].join(' and ')
                        + ' until the next restart; '
                    : 'withdrawn from the running kernel; ')
            + `${cleanups.length - withdrawals} uninstall cleanup(s) ran)`,
        );
        return c.json({
            success: true,
            data: {
                manifestId,
                cleanups,
                note: withdrawal
                    ? 'Cached manifest removed, and the uninstall cleanups this runtime\'s plugins registered ran — each one\'s outcome is in `cleanups`. The running kernel did not withdraw the package, so it stays loaded until the next restart; that is the `registry.uninstallPackage` entry in `cleanups`.'
                    : copies || resync
                        ? 'Cached manifest removed, the package withdrawn from the running kernel\'s registry, and the uninstall cleanups this runtime\'s plugins registered ran — each one\'s outcome is in `cleanups`.'
                            + (copies
                                ? ' The metadata service kept copies of the package\'s objects, so the object listing and reads keep serving them until the next restart; that is the `metadata.unregister` entry in `cleanups`.'
                                : '')
                            + (resync
                                ? ' The running kernel\'s re-sync did not run, so the automation engine can still hold the package\'s flows — triggerable by name, their triggers armed — until the next restart; that is the `metadata:reloaded` entry in `cleanups`.'
                                : '')
                        : 'Cached manifest removed, the package withdrawn from the running kernel, and the uninstall cleanups this runtime\'s plugins registered ran — each one\'s outcome is in `cleanups`.',
            },
        }, 200);
    };

    /**
     * [#27395] Announce an uninstall this door just completed to the running
     * kernel as `metadata:reloaded` — the re-sync signal
     * {@link announceHotInstall} announces for an install, with the same
     * payload — so every consumer that holds what it read from a package
     * re-reads a kernel that no longer has it:
     *
     *   - `service-automation` re-syncs its flows from the protocol
     *     (`resyncFlowsFromProtocol`) and withdraws each flow it armed that the
     *     protocol's view no longer lists — the uninstalled package's, which
     *     the registry withdrawal took out of that view — and `withdrawFlow`
     *     unbinds each one's record or schedule trigger in the same step.
     *
     * Before this, the door withdrew the package from the registry and the
     * engine never heard of it: `GET /meta/flow/NAME` answered 404 while
     * `GET /automation/NAME` still answered `active`, and the trigger door, a
     * record write or a schedule still ran the uninstalled package's flow
     * until an unrelated reload — a view publish, another package's install —
     * cleared it. ⛔ No engine-side list of the package's flows is kept or
     * withdrawn here: a second teardown is how the two would drift.
     *
     * Never throws: the uninstall has already happened. Two answers:
     *   - `undefined` — announced, and every subscriber returned;
     *   - one failed outcome named {@link KERNEL_RESYNC}, when the context
     *     cannot announce or a subscriber threw. It rides on `cleanups`, the
     *     way a refused registry withdrawal does, and the operator log says
     *     what it costs and the remedy; the cause is logged, never put on the
     *     wire. A FUNCTIONAL degradation, so `warn` — the level the install's
     *     announce failure uses.
     */
    private announceUninstall = async (
        ctx: PluginContext,
        manifestId: string,
    ): Promise<UninstallCleanupOutcome | undefined> => {
        const failed: UninstallCleanupOutcome = {
            name: KERNEL_RESYNC,
            success: false,
            removed: 0,
            error: 'the running kernel did not re-sync — the automation engine can still hold the package\'s flows until the next restart',
        };
        const cost = 'its flows can stay registered in the automation engine — triggerable by name, their record and '
            + 'schedule triggers still armed — until the runtime restarts. The outcome is on the response (`cleanups`). '
            + 'Remedy: restart the runtime — the ledger entry is already gone, so the restart does not bring the package back.';
        if (typeof ctx.trigger !== 'function') {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] uninstalled ${manifestId}, but this kernel context cannot announce `
                + `metadata:reloaded — ${cost}`,
            );
            return failed;
        }
        try {
            await ctx.trigger('metadata:reloaded', { changed: [`app/${manifestId}`] });
            return undefined;
        } catch (err: any) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] uninstalled ${manifestId}, but the metadata:reloaded re-sync FAILED `
                + `(${err?.message ?? err}) — ${cost}`,
            );
            return failed;
        }
    };

    /**
     * [#21576] Withdraw a package this door just removed from its ledger from
     * the running kernel — through `SchemaRegistry.uninstallPackage`, the ONE
     * verb the protocol's own uninstall (`deletePackage`) withdraws a package
     * with, on the same registry: the `objectql` engine's, which is the engine
     * the protocol is assembled over and the registry this door's install
     * registers into (the `manifest` service's `registerApp`).
     *
     * Before this, the door left the package registered until the next
     * restart, and every reader of "registered packages" kept answering as if
     * it were installed. One of them re-created a ghost grant: another
     * package's hot install announces `metadata:reloaded`, `plugin-security`
     * re-runs its declared-permission seeding over every registered package,
     * and the uninstalled package's permission set came back as a fresh
     * `managed_by: package` row that outlived the restart as an orphan
     * (ADR-0090: "No ghost grants"). Withdrawing the registration — not
     * teaching that one reader to skip it — makes every such reader right.
     *
     * What the verb withdraws, all of it re-added by a later install of the
     * same id (`registerApp`): the package's object contributions (so its
     * objects answer 404 at once instead of after a restart), its namespace,
     * every metadata item it shipped, its boot disable seed, and its package
     * record. Its tables and rows are untouched. [#24070] The verb reaches the
     * registry only: the copies of the package's objects that the install's
     * register bridged into the `metadata` service are
     * {@link withdrawObjectCopies}'s, which the door runs right after this.
     *
     * Never throws: the uninstall has already happened. Two answers:
     *   - `undefined` — withdrawn, or nothing to withdraw: no `objectql`
     *     engine, or a registry that does not hold the package (a cloud
     *     install whose hot-register failed, a rehydrate that failed);
     *   - one failed outcome named {@link REGISTRY_WITHDRAWAL}, when the
     *     registry refused (ADR-0029: another package extends an object this
     *     one owns) or could not be asked. It rides on `cleanups`, the way a
     *     failed cleanup does, and the operator log says what it costs and
     *     the remedy; the cause is logged, never put on the wire.
     */
    private withdrawFromRunningKernel = (
        ctx: PluginContext,
        manifestId: string,
    ): UninstallCleanupOutcome | undefined => {
        let ql: IObjectQLEngine | undefined;
        try { ql = ctx.getService<IObjectQLEngine>('objectql'); } catch { /* no data engine — nothing registered */ }
        const registry = ql?.registry;
        if (!registry) return undefined;
        try {
            if (registry.getPackage(manifestId) === undefined) return undefined;
            registry.uninstallPackage(manifestId);
            return undefined;
        } catch (err: any) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] uninstalled ${manifestId}, but the running kernel did not withdraw it `
                + `(${err?.message ?? err}) — it stays registered until the next restart: its objects keep answering, `
                + 'and every reader of the registered packages still counts it, so a later hot install can re-project '
                + 'its permission sets. The outcome is on the response (`cleanups`). Remedy: remove what blocks the '
                + 'withdrawal (the cause in parentheses names it) and restart the runtime — the ledger entry is '
                + 'already gone, so the restart does not bring the package back.',
            );
            return {
                name: REGISTRY_WITHDRAWAL,
                success: false,
                removed: 0,
                error: 'the running kernel did not withdraw the package — it stays loaded until the next restart',
            };
        }
    };

    /**
     * [#24070] Withdraw the copies of an uninstalled package's objects from the
     * `metadata` service — the half of what the install put in the running
     * kernel that {@link withdrawFromRunningKernel}'s registry verb cannot
     * reach. The door runs it right after that verb has withdrawn.
     *
     * The install's `manifest.register` does two things: `registerApp` puts the
     * package in the registry and, on a started kernel, the ObjectQL plugin
     * bridges each of the package's objects into the `metadata` service, as a
     * copy stamped with the package's id (`_packageId`), so every reader of
     * that service sees them. Nothing took those copies out again. The metadata
     * protocol's `GET /meta/object` merges the service's listing into its
     * answer, and `GET /meta/object/NAME` reads the service before the
     * registry, so both kept serving every object of the uninstalled package
     * until a restart — while its data route already answered 404, and its
     * `app` and `permission` items, which nothing copies into the service,
     * were already gone.
     *
     * What is withdrawn is what the bridge itself counts as the package's own
     * copy, the predicate it re-registers by on a hot upgrade: an `object` whose
     * `_packageId` is this package's id. And only under the two conditions the
     * ObjectQL plugin's own copy-follow takes before it removes a copy, because
     * `unregister` also deletes through the service's writable `datasource:`
     * loaders: the registry no longer serves the name, and the removal is
     * silent to the service's watchers (`notify: false`), as the bridge's
     * register was. A same-name copy the package never bridged — an authored
     * one, or another package's — is not this uninstall's, and stays.
     *
     * Never throws: the uninstall has already happened. Two answers:
     *   - `undefined` — every such copy withdrawn, or nothing to withdraw: no
     *     `metadata` service, no `objectql` registry (so nothing was bridged),
     *     or no copy stamped with the package's id;
     *   - one failed outcome named {@link OBJECT_COPY_WITHDRAWAL}, when the
     *     service could not be listed or refused to remove a copy; `removed`
     *     counts the copies that did go. It rides on `cleanups`, the way a
     *     refused registry withdrawal does, and the operator log names the
     *     objects kept, what it costs and the remedy; the cause is logged,
     *     never put on the wire.
     */
    private withdrawObjectCopies = async (
        ctx: PluginContext,
        manifestId: string,
    ): Promise<UninstallCleanupOutcome | undefined> => {
        let metadata: IMetadataService | undefined;
        let registry: IObjectQLEngine['registry'] | undefined;
        try { metadata = ctx.getService<IMetadataService>('metadata'); } catch { /* no metadata service — nothing bridged */ }
        try { registry = ctx.getService<IObjectQLEngine>('objectql')?.registry; } catch { /* no data engine — nothing bridged */ }
        if (!metadata || !registry) return undefined;

        let removed = 0;
        const kept: string[] = [];
        let cause: unknown;
        try {
            for (const copy of await metadata.list('object')) {
                const name = (copy as { name?: unknown } | null)?.name;
                if (typeof name !== 'string' || (copy as { _packageId?: unknown })._packageId !== manifestId) continue;
                if (registry.getObject(name) !== undefined) continue;
                try {
                    await metadata.unregister('object', name, { notify: false });
                    removed++;
                } catch (err) {
                    kept.push(name);
                    cause ??= err;
                }
            }
        } catch (err) {
            cause = err;
        }
        if (cause === undefined) return undefined;

        const what = kept.length > 0
            ? `kept its copies of object(s) ${kept.map((n) => `'${n}'`).join(', ')}`
            : 'could not be listed, so its copies of the package\'s objects were not withdrawn';
        ctx.logger?.warn?.(
            `[MarketplaceInstallLocal] uninstalled ${manifestId} and withdrew it from the registry, but the metadata `
            + `service ${what} (${(cause as { message?: unknown })?.message ?? cause}) — GET /api/v1/meta/object and `
            + 'GET /api/v1/meta/object/NAME keep serving them until the next restart, while their data route already '
            + 'answers 404. The outcome is on the response (`cleanups`). Remedy: restart the runtime — the ledger entry '
            + 'is already gone, so the restart does not bring the package back.',
        );
        return {
            name: OBJECT_COPY_WITHDRAWAL,
            success: false,
            removed,
            error: 'the metadata service kept copies of the package\'s objects — the object reads serve them until the next restart',
        };
    };

    /**
     * [#21490] Run the protocol's registered uninstall cleanups for a package
     * this door just removed from its ledger — ADR-0086 D3's data-plane
     * revocation, which ADR-0090 states as "(removing its sets by `packageId`,
     * ADR-0086 D3) revokes it everywhere at once. No ghost grants."
     *
     * Before this, the door removed the ledger entry and nothing else: the
     * package's object answered 404 after a restart, while its `managed_by:
     * package` `sys_permission_set` row — and every grant of it — survived.
     * `plugin-security` registers exactly that revocation
     * (`security.package-permissions`); only the protocol's own uninstall ran it.
     *
     * ⛔ No second revocation path lives here. The cleanups are whatever domain
     * plugins registered with the protocol, run by the protocol's own runner —
     * this door knows no table, and a cleanup registered tomorrow fires here
     * with no edit to this file.
     *
     * The request:
     *   - `packageId` is the MANIFEST id, never the ledger's `packageId`. The
     *     registry, and so every row a domain plugin stamped for the package,
     *     knows the package by `manifest.id`; the ledger's `packageId` is the
     *     marketplace catalog's id on a cloud install and can differ from it.
     *   - no `organizationId`: an install-local package is installed for the
     *     whole runtime (the ledger is per runtime, and the rehydrate registers
     *     it for every tenant), so its revocation is too.
     *   - `actor` is the operator the admission resolved.
     *
     * What comes back is reported, never swallowed — on the response, as the
     * protocol's own uninstall reports it (`cleanups`). Never throws: the
     * uninstall has already happened, so a cleanup that could not run is an
     * outcome, not a failed request. Three answers:
     *   - no `protocol` service — no cleanup registry exists, so none is
     *     registered and none is owed: `[]`;
     *   - a protocol without the runner, or a runner that throws — one failed
     *     outcome named {@link UNINSTALL_CLEANUP_RUNNER}, so the caller can
     *     tell "nothing to revoke" from "the revocation never ran";
     *   - otherwise the runner's outcomes, verbatim.
     */
    private runUninstallCleanups = async (
        ctx: PluginContext,
        manifestId: string,
        actor: string,
        declared?: UninstallDeclared,
    ): Promise<UninstallCleanupOutcome[]> => {
        let protocol: UninstallCleanupRunner | undefined;
        try { protocol = ctx.getService<UninstallCleanupRunner>('protocol'); } catch { /* no protocol service */ }
        if (!protocol) return [];

        const notRun = (error: string): UninstallCleanupOutcome[] => [
            { name: UNINSTALL_CLEANUP_RUNNER, success: false, removed: 0, error },
        ];
        let outcomes: UninstallCleanupOutcome[];
        if (typeof protocol.runUninstallCleanups !== 'function') {
            outcomes = notRun(
                'this runtime\'s protocol cannot run uninstall cleanups — upgrade @objectstack/metadata-protocol '
                + 'alongside @objectstack/cloud-connection',
            );
        } else {
            try {
                outcomes = await protocol.runUninstallCleanups({ packageId: manifestId, actor, ...(declared ? { declared } : {}) });
            } catch (err: any) {
                ctx.logger?.warn?.(`[MarketplaceInstallLocal] the uninstall cleanups of ${manifestId} could not be run: ${err?.message ?? err}`);
                outcomes = notRun('the uninstall cleanups could not be run');
            }
        }

        const failed = outcomes.filter((o) => o.success !== true);
        if (failed.length > 0) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] uninstalled ${manifestId}, but ${failed.length} uninstall cleanup(s) did not `
                + `complete (${failed.map((o) => o.name).join(', ')}) — what they revoke, such as the package's `
                + 'permission sets and their grants, SURVIVES the uninstall. Each outcome is on the response '
                + '(`cleanups`). Remedy: once the cause is fixed, install the package again and uninstall it again — '
                + 'the cleanups re-select by package id, so a second pass removes whatever the first could not.',
            );
        }
        return outcomes;
    };

    /**
     * [ADR-0126 §6 wall 3] Step 2c of {@link handleInstall}: ask the security
     * plugin's access upgrade check what replacing the installed package with
     * `converted` would un-make, and decide.
     *
     * - **No check service** (no security plugin composed): the re-install is
     *   not checked against the access choices it could un-make. The upgrade
     *   proceeds, and one `warn` line says no check ran.
     * - **Stopped** (a store the comparison reads did not answer, or the check
     *   threw): `503 SERVICE_UNAVAILABLE`, nothing written. A comparison that
     *   did not run is never taken for "no finding".
     * - **Clean**: the upgrade proceeds unchanged.
     * - **Findings**: `409 ACCESS_UPGRADE_CONFIRMATION_REQUIRED`, naming each,
     *   unless `body.confirmAccessUpgrade` is the finding set's token. A token
     *   is the confirmation of the findings it names: one that no longer
     *   matches (the findings changed since it was issued) is refused again
     *   with the fresh set, and a bare `true` confirms nothing.
     */
    private evaluateAccessUpgradeGate = async (
        ctx: PluginContext,
        manifestId: string,
        converted: unknown,
        previousEntry: InstalledEntry | null | undefined,
        body: any,
        userId: string,
    ): Promise<{
        refusal?: { body: Record<string, unknown>; status: 409 | 503 };
        confirmation?: InstalledEntry['accessUpgradeConfirmation'];
    }> => {
        let checker: AccessUpgradeCheckService | undefined;
        try { checker = ctx.getService<AccessUpgradeCheckService>(ACCESS_UPGRADE_CHECK_SERVICE); } catch { /* not composed */ }
        if (typeof checker?.check !== 'function') {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] upgrade of ${manifestId}: no access upgrade check ran — this composition has no `
                + `'${ACCESS_UPGRADE_CHECK_SERVICE}' service (the security plugin), so this re-install is not checked `
                + 'against the access choices it could un-make. Compose the security plugin to have upgrades checked.',
            );
            return {};
        }
        let answer: AccessUpgradeCheckAnswer;
        try {
            answer = await checker.check({
                packageId: manifestId,
                manifest: converted,
                ...(previousEntry?.manifest ? { previousManifest: this.convertPackageBodyForward(ctx, previousEntry.manifest) } : {}),
            });
        } catch (err: any) {
            answer = { outcome: 'stopped', reading: 'the access upgrade check', error: String(err?.message ?? err) };
        }
        if (answer.outcome === 'clean') return {};
        if (answer.outcome === 'stopped') {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] upgrade of ${manifestId} refused: the access upgrade check could not read `
                + `${answer.reading}${answer.error ? ` (${answer.error})` : ''}`,
            );
            return {
                refusal: {
                    status: 503,
                    body: {
                        success: false,
                        error: {
                            code: 'SERVICE_UNAVAILABLE',
                            message: `Upgrading "${manifestId}" is refused: the check that compares this system's access `
                                + `choices with the upgrade could not read ${answer.reading}, and a comparison that did not `
                                + 'run is never taken for "no finding". Nothing was installed or written. Retry once that '
                                + 'store answers.',
                            details: { manifestId, reading: answer.reading, ...(answer.stop ? { stop: answer.stop } : {}) },
                        },
                    },
                },
            };
        }

        const findingSet = answer.findingSet;
        const token = body?.confirmAccessUpgrade;
        if (typeof token === 'string' && token === findingSet) {
            const confirmedAt = new Date().toISOString();
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] upgrade of ${manifestId} confirmed by ${userId} over its access findings `
                + `(${findingSet}); the boot report raises whatever still stands`,
            );
            return { confirmation: { findingSet, confirmedBy: userId, confirmedAt } };
        }
        const findings = describeAccessFindings(answer.findings);
        const stale = token !== undefined
            ? ' The confirmation sent does not confirm these findings: a confirmation is the finding set\'s token from '
                + 'this refusal, it no longer matches once the findings change, and `true` confirms nothing.'
            : '';
        ctx.logger?.warn?.(
            `[MarketplaceInstallLocal] upgrade of ${manifestId} stopped: ${findings.length} access finding(s) unconfirmed `
            + `(${findingSet})`,
        );
        return {
            refusal: {
                status: ACCESS_UPGRADE_CONFIRMATION_STATUS,
                body: {
                    success: false,
                    error: {
                        code: ACCESS_UPGRADE_CONFIRMATION_REQUIRED,
                        message: `Upgrading "${manifestId}" would change what access choices made in this system cover — `
                            + `${findings.length} finding(s): ${findings.map((f) => f.describe).join(' ')} `
                            + 'Nothing was installed or written. Review each finding; to upgrade anyway, send the same '
                            + `request with "confirmAccessUpgrade": "${findingSet}".${stale}`,
                        details: {
                            manifestId,
                            findingSet,
                            findings,
                            confirmWith: {
                                body: { confirmAccessUpgrade: findingSet },
                                cli: `os package install … --confirm-access-upgrade ${findingSet}`,
                            },
                        },
                    },
                },
            },
        };
    };

    /**
     * [ADR-0120 D5e] Decide whether this install must stop for the
     * `isolated`-posture confirmation, and what attestation the ledger entry
     * should carry afterwards.
     *
     * The three outcomes, in the order they are checked:
     *
     * 1. **Not `isolated`** — no findings are decision points at all. Under
     *    `single` there is one customer; under `group` the installation IS the
     *    customer company, which is exactly what `'global'` means there. The
     *    previous attestation (if any) is carried through untouched rather than
     *    dropped: a posture may flip back, and a confirmation already given is
     *    still a fact about the posture it was given under.
     * 2. **Every finding already answered for** — proceed silently. This is the
     *    "之后不复问" half of the decision, and it is why the record lives in the
     *    durable ledger rather than in memory.
     * 3. **Something unanswered** — stop, unless THIS request confirms it.
     *
     * Whatever this returns as `attestation` is written into the install
     * manifest in ADR-0104 attestation style — the fact affirmed, by whom, when,
     * and under which posture — so the ceremony is evidence, not a dismissed
     * prompt.
     *
     * `confirmGlobalUniques` accepts either `true` (confirm everything the gate
     * lists, the shape a CLI `--confirm-global-uniques` produces) or an explicit
     * array of finding ids. The array form is the per-index ceremony the ADR
     * asks for: confirming two of three constraints still stops on the third,
     * so an installer cannot blanket-approve a list it did not read by echoing
     * back one id.
     */
    private evaluateGlobalUniqueGate = (
        manifest: any,
        previous: InstalledEntry | null,
        body: any,
        installerId: string | null,
    ): {
        blocked: boolean;
        posture: string;
        pending: GlobalUniqueFinding[];
        attestation?: InstalledEntry['globalUniqueAttestation'];
    } => {
        const posture = resolveTenancyPosture();
        const carried = previous?.globalUniqueAttestation;
        if (!postureGatesGlobalUniques(posture)) {
            return { blocked: false, posture, pending: [], ...(carried ? { attestation: carried } : {}) };
        }

        const findings = collectGlobalUniques(manifest?.objects);
        const pending = unconfirmedGlobalUniques(findings, carried, posture);
        if (pending.length === 0) {
            return { blocked: false, posture, pending: [], ...(carried ? { attestation: carried } : {}) };
        }

        const raw = body?.confirmGlobalUniques;
        const confirmedIds =
            raw === true
                ? pending.map((f) => f.id)
                : Array.isArray(raw)
                  ? pending.filter((f) => raw.includes(f.id)).map((f) => f.id)
                  : [];
        const stillPending = pending.filter((f) => !confirmedIds.includes(f.id));
        if (stillPending.length > 0) {
            return { blocked: true, posture, pending: stillPending };
        }

        return {
            blocked: false,
            posture,
            pending: [],
            attestation: recordGlobalUniqueAttestation(carried, confirmedIds, posture, installerId),
        };
    };

    /**
     * [ADR-0131 D6] Judge the requested install mode against the package and
     * the deployment — step 1e of {@link handleInstall}. `null` admits it;
     * otherwise the refusal to answer with, before anything is written.
     *
     * 1. The package's `installModes`, parsed through its declaration by
     *    reference: a value the declaration refuses answers
     *    `PLUGIN_MANIFEST_INVALID` with the declaration's own sentence, at the
     *    status this door gives an invalid manifest (400 inline, 502 for a
     *    cloud snapshot) — the id gate's split.
     * 2. The requested mode must be one the package permits
     *    ({@link resolveInstallModes}; absent means `['managed']`):
     *    `INSTALL_MODE_NOT_PERMITTED` / 422, naming the permitted modes.
     * 3. `unmanaged` on a deployment whose REQUESTED tenancy posture walls
     *    organizations: the import verb's own refusal
     *    (`UNMANAGED_INSTALL_WALLED_POSTURE` / 409), from the same function.
     */
    private judgeInstallMode = (
        manifest: Record<string, any>,
        manifestId: string,
        installMode: InstallMode,
        invalidManifestStatus: 400 | 502,
    ): { status: number; error: { code: string; message: string; details?: Record<string, unknown> } } | null => {
        const declared = ManifestSchema.shape.installModes.safeParse(declaredPackageManifest(manifest).installModes);
        if (!declared.success) {
            const [issue] = declared.error.issues;
            return {
                status: invalidManifestStatus,
                error: {
                    code: 'PLUGIN_MANIFEST_INVALID',
                    message: `Package '${manifestId}' declares an invalid \`installModes\`: ${issue?.message ?? 'refused by its declaration'}`
                        + `${issue && issue.path.length > 0 ? ` (at \`installModes.${issue.path.join('.')}\`)` : ''}.`,
                },
            };
        }
        const permitted = resolveInstallModes({ installModes: declared.data });
        if (!permitted.includes(installMode)) {
            const others = permitted.map((m) => `'${m}'`).join(' or ');
            return {
                status: INSTALL_MODE_NOT_PERMITTED_STATUS,
                error: {
                    code: INSTALL_MODE_NOT_PERMITTED_CODE,
                    message: `Package '${manifestId}' cannot be installed ${installMode}: it permits only ${others} `
                        + `(its manifest's \`installModes\`${declared.data === undefined ? ', absent, which means [\'managed\']' : ''}). `
                        + `Install it ${permitted.length === 1 ? permitted[0] : `with \`installMode\` ${others}`} instead.`,
                    details: { installMode, permitted: [...permitted] },
                },
            };
        }
        if (installMode === 'unmanaged') {
            const walled = unmanagedInstallPostureRefusal(manifestId) as (Error & { code?: string; status?: number; details?: Record<string, unknown> }) | null;
            if (walled) {
                return {
                    status: walled.status ?? 409,
                    error: {
                        code: String(walled.code),
                        message: walled.message,
                        ...(walled.details ? { details: walled.details } : {}),
                    },
                };
            }
        }
        return null;
    };

    /**
     * [ADR-0146 D10, second rule] Step 2e of {@link handleInstall}: every
     * `objectExtensions[].fieldPatches` entry the converted body carries —
     * each `packages[]` entry's, or the body's own — judged against its target
     * by `@objectstack/metadata-core`'s `fieldPatchTargetRefusals`. A target
     * this artifact delivers is read off its body; any other is the registry's
     * resolved object. A target neither knows is not judged here: the
     * extension then registers against an owner that is not loaded, which the
     * registry already reports.
     */
    private fieldPatchTargetRefusalsOf = (ctx: PluginContext, converted: Record<string, any>): FieldPatchTargetRefusal[] => {
        const multi = Array.isArray(converted.packages);
        const bodies: Array<{ body: Record<string, any>; prefix: string }> = multi
            ? converted.packages.flatMap((entry: unknown, index: number) =>
                isPlainObject(entry) && isPlainObject(entry.manifest)
                    ? [{ body: entry.manifest as Record<string, any>, prefix: `packages[${index}].manifest.` }]
                    : [])
            : [{ body: flattenPackageBody(converted), prefix: '' }];
        if (!bodies.some(({ body }) => Array.isArray(body.objectExtensions))) return [];
        const delivered = new Map<string, unknown>();
        for (const { body } of bodies) {
            const objects = body.objects;
            const list = Array.isArray(objects) ? objects : isPlainObject(objects) ? Object.entries(objects).map(([name, o]) => (isPlainObject(o) ? { name, ...o } : o)) : [];
            for (const object of list) if (isPlainObject(object) && typeof object.name === 'string') delivered.set(object.name, object);
        }
        let registry: { getObject?(name: string): unknown } | undefined;
        try { registry = ctx.getService<IObjectQLEngine>('objectql')?.registry as typeof registry; } catch { /* no data engine — only delivered targets are known */ }
        const getTarget = (name: string): unknown => delivered.get(name) ?? registry?.getObject?.(name);
        return bodies.flatMap(({ body, prefix }) => fieldPatchTargetRefusals(body.objectExtensions, getTarget, prefix));
    };

    /**
     * [ADR-0146 D2, ruling A on #28390; #28410] THE OVERRIDE WRITE GATE at the
     * managed install — the door a package's items enter through as code
     * (`manifest.register`), so the publish doors never see them. The rule is
     * the publish doors' own (`judgeOverrideWrite`), over the walk `os
     * validate` takes (`overrideWriteItemsOf`):
     *
     *  - `refusals` — the incoming package's items the gate refuses: an
     *    undeclared same name a read-only package in its dependency closure
     *    ships, or an `overrides` declaration the gate does not admit (a
     *    dependent declaring, a base outside the closure, an excluded type,
     *    an object, a flow or action while their channel waits). A `.custom`
     *    package's admitted declarations install as at publish.
     *  - `collisions` — on a (re)install of a base, the names an installed
     *    dependent (a package whose closure holds this one) already holds,
     *    undeclared, that this version now ships. Listed on the answer, never
     *    refused (see {@link OverrideUpgradeCollision}).
     *
     * The card placed this gate point at `installPackage`; that door takes a
     * manifest and no items (`PackageInstallManifestSchema`), and the
     * unmanaged install copies through the save door (already gated), so the
     * managed install is where a package's items arrive unjudged.
     *
     * Reads nothing it cannot: with no `objectql` registry or no protocol
     * listing, the gate has no closure to judge and answers empty.
     */
    private evaluateOverrideWriteGate = async (
        ctx: PluginContext,
        manifestId: string,
        converted: Record<string, any>,
    ): Promise<{ refusals: OverrideInstallRefusal[]; collisions: OverrideUpgradeCollision[] }> => {
        const none = { refusals: [], collisions: [] };
        let ql: OverrideGateEngine | undefined;
        let lister: OverrideGateLister | undefined;
        try { ql = ctx.getService<OverrideGateEngine>('objectql'); } catch { return none; }
        try { lister = ctx.getService<OverrideGateLister>('protocol'); } catch { return none; }
        const registry = ql?.registry;
        if (!registry || typeof lister?.getMetaItems !== 'function') return none;
        const getMetaItems = lister.getMetaItems.bind(lister);
        // The packages this install delivers — each `packages[]` entry of a
        // multi-package artifact (ADR-0130 D4), or the body itself — judged
        // each under its own id. A delivered package is in no registry yet: its
        // dependencies and its items are read off the body, and it registers
        // read-only, so it is a base a sibling's closure can hold.
        const delivered = new Map<string, { dependencies: string[]; items: OverrideWriteItem[] }>();
        const entries: Record<string, any>[] = Array.isArray(converted.packages)
            ? converted.packages
                .map((entry: unknown) => (isPlainObject(entry) && isPlainObject(entry.manifest) ? entry.manifest : undefined))
                .filter((m: unknown): m is Record<string, any> => m !== undefined)
            : [flattenPackageBody(converted)];
        for (const body of entries) {
            const id = entries.length === 1 && !Array.isArray(converted.packages) ? manifestId : manifestIdOf(body);
            if (typeof id !== 'string' || id === '') continue;
            delivered.set(id, { dependencies: dependencyIdsOf(declaredPackageManifest(body)), items: overrideWriteItemsOf(body) });
        }
        const dependenciesOf = (id: string): string[] => delivered.get(id)?.dependencies
            ?? dependencyIdsOf((registry.getPackage?.(id) as { manifest?: unknown } | undefined)?.manifest);
        const closureOf = (id: string): string[] => {
            const seen = new Set<string>();
            const queue = [...dependenciesOf(id)];
            while (queue.length > 0) {
                const next = queue.shift()!;
                if (next === id || seen.has(next)) continue;
                seen.add(next);
                queue.push(...dependenciesOf(next));
            }
            return [...seen];
        };
        // One listing per (type, package), read once; a delivered package's
        // own items are read off its body.
        const held = new Map<string, Promise<Map<string, unknown>>>();
        const heldBy = (type: string, packageId: string): Promise<Map<string, unknown>> => {
            const key = `${type}\u0000${packageId}`;
            let read = held.get(key);
            if (!read) {
                const local = delivered.get(packageId);
                read = local
                    ? Promise.resolve(new Map(local.items.filter((i) => i.type === type).map((i) => [i.identity, i.item])))
                    : (async () => {
                        const byIdentity = new Map<string, unknown>();
                        let answer: unknown;
                        try { answer = await getMetaItems({ type, packageId }); } catch { return byIdentity; }
                        for (const item of listedItems(answer)) {
                            const owner = item._packageId;
                            if (typeof owner === 'string' && owner !== packageId) continue;
                            const identity = listedIdentity(type, item);
                            if (identity !== undefined) byIdentity.set(identity, item);
                        }
                        return byIdentity;
                    })();
                held.set(key, read);
            }
            return read;
        };
        const isBase = (id: string): boolean => delivered.has(id) || !isWritablePackage(ql, id);

        const refusals: OverrideInstallRefusal[] = [];
        for (const [packageId, pkg] of delivered) {
            const closure = closureOf(packageId);
            const bases = closure.filter(isBase);
            for (const item of pkg.items) {
                const shippers: string[] = [];
                for (const base of bases) if ((await heldBy(item.type, base)).has(item.identity)) shippers.push(base);
                const verdict = judgeOverrideWrite(
                    { type: item.type, name: item.name, packageId, item: item.item },
                    { dependencies: closure, shippers },
                );
                if (verdict.verdict === 'refuse') {
                    refusals.push({
                        type: item.type, name: item.name,
                        ...(delivered.size > 1 ? { packageId } : {}),
                        rule: verdict.rule, message: verdict.message,
                    });
                }
            }
        }

        const collisions: OverrideUpgradeCollision[] = [];
        const installed = registry.getAllPackages?.();
        const installedIds = (Array.isArray(installed) ? installed : [])
            .map((p) => manifestIdOf(p))
            .filter((id): id is string => typeof id === 'string' && !delivered.has(id));
        for (const [baseId, base] of delivered) {
            for (const dependent of installedIds) {
                const dependentClosure = closureOf(dependent);
                if (!dependentClosure.includes(baseId)) continue;
                for (const item of base.items) {
                    const holding = (await heldBy(item.type, dependent)).get(item.identity);
                    if (holding === undefined) continue;
                    const verdict = judgeOverrideWrite(
                        { type: item.type, name: item.name, packageId: dependent, item: holding },
                        { dependencies: dependentClosure, shippers: [baseId] },
                    );
                    if (verdict.verdict === 'refuse') {
                        collisions.push({ type: item.type, name: item.name, packageId: dependent, rule: verdict.rule, message: verdict.message });
                    }
                }
            }
        }
        return { refusals, collisions };
    };

    /**
     * [ADR-0131 D6] The WRITABLE package holding this package's namespace, if
     * any — step 1f of {@link handleInstall}, the managed-after-unmanaged
     * refusal. An `unmanaged` install keeps the package's namespace under a
     * new writable base, so a writable holder is environment metadata under
     * the names the package ships. Read-only, so it is asked before any write.
     *
     * The namespace is the one the package DECLARES ({@link declaredPackageManifest}),
     * or the one derived from its id when it declares none — the derivation
     * the copy took. A shareable platform namespace (`base`, `system`, `sys`)
     * is never one package's. "Writable" is ADR-0070's one predicate
     * ({@link isWritablePackage}), the rule the authoring path enforces.
     */
    private findEnvironmentBaseHoldingNamespace = (
        ctx: PluginContext,
        manifest: Record<string, any>,
        manifestId: string,
    ): { base: string; namespace: string } | null => {
        const declared = declaredPackageManifest(manifest).namespace;
        const namespace = typeof declared === 'string' && declared !== ''
            ? declared
            : deriveNamespaceFromPackageId(manifestId);
        if (!namespace || namespace === 'base' || namespace === 'system' || namespace === 'sys') return null;
        let ql: NamespaceHoldingEngine | undefined;
        try { ql = ctx.getService<NamespaceHoldingEngine>('objectql'); } catch { return null; /* no data engine — nothing is held */ }
        const owners: unknown = ql?.registry?.getNamespaceOwners?.(namespace);
        if (!Array.isArray(owners)) return null;
        for (const owner of owners) {
            if (typeof owner !== 'string' || owner === manifestId) continue;
            if (isWritablePackage(ql, owner)) return { base: owner, namespace };
        }
        return null;
    };

    /**
     * [ADR-0131 D6] The `unmanaged` install: the package's metadata copied
     * ONCE into a new writable base by the protocol's
     * `importUnmanagedPackage` — every item through the save door a Studio
     * edit takes, `organization_id` NULL, the environment's own metadata from
     * its first byte, and
     * all or nothing (a write failure deletes the base).
     *
     * What this door does around the verb, and why:
     *  - it hands the verb ONE flat package body ({@link flattenPackageBody});
     *  - the verb owns every refusal it can judge before the base exists
     *    (uncopyable content, collisions, an owned namespace, an existing
     *    target) and this door answers each with the verb's own code and
     *    status, the message when the verb declared it a refusal, and
     *    `details`; a 5xx's message is withheld and logged;
     *  - translation bundles are COPIED by the verb as `translation` items, so
     *    they reload at every boot with the environment's translations — this
     *    install writes no ledger entry for a rehydrate to replay;
     *  - seed data is NOT loaded: it is data, not metadata, and the
     *    reseed / purge doors act on ledger entries this install never
     *    writes, so seeded rows would be rows nothing here could clear. The
     *    answer says so (`seeded.mode: 'skipped'`) when the package declares any;
     *  - `installedFrom` — the source package id and version, for information
     *    only (ADR-0131 D6: "provenance recorded for information only") — is
     *    on the answer and on the operator log line, at `info`;
     *  - `strippedLocks` — every protection lock the package shipped, in
     *    either spelling, and the copy does not keep, with the package's
     *    reason — is the verb's own
     *    list, relayed as the verb states it, so the installer reads why the
     *    vendor locked an item before editing it.
     */
    private installUnmanaged = async (
        c: any,
        ctx: PluginContext,
        args: { manifest: Record<string, any>; manifestId: string; version: string; versionId: string; userId: string | null },
    ): Promise<Response> => {
        const { manifest, manifestId, version, versionId, userId } = args;
        let protocol: UnmanagedImporter | undefined;
        try { protocol = ctx.getService<UnmanagedImporter>('protocol'); } catch { /* no protocol service */ }
        if (!protocol || typeof protocol.importUnmanagedPackage !== 'function') {
            return c.json({
                success: false,
                error: {
                    code: 'SERVICE_UNAVAILABLE',
                    message: `Package '${manifestId}' cannot be installed unmanaged on this runtime: its metadata protocol `
                        + 'has no copy-once import. Install it managed, or upgrade @objectstack/metadata-protocol alongside '
                        + '@objectstack/cloud-connection.',
                },
            }, 503);
        }

        const packageBody = flattenPackageBody(manifest);
        let result: Awaited<ReturnType<NonNullable<UnmanagedImporter['importUnmanagedPackage']>>>;
        try {
            result = await protocol.importUnmanagedPackage({
                manifest: packageBody,
                ...(userId ? { actor: userId } : {}),
            } as Parameters<NonNullable<UnmanagedImporter['importUnmanagedPackage']>>[0]);
        } catch (err: any) {
            const resolved = resolveThrownHttpError(err, 500);
            if (resolved.status >= 500) {
                ctx.logger?.warn?.(
                    `[MarketplaceInstallLocal] the unmanaged install of ${manifestId} failed: ${err?.message ?? err}`,
                );
            }
            const details = isPlainObject(err?.details) ? err.details : undefined;
            return c.json({
                success: false,
                error: {
                    code: resolved.code,
                    message: clientFacingFailureText(
                        err,
                        `The unmanaged install of '${manifestId}' failed; the reason is in the server log.`,
                    ),
                    ...(details ? { details } : {}),
                },
            }, resolved.status as any);
        }

        const installedFrom = {
            packageId: result.sourcePackageId,
            ...(result.sourceVersion !== undefined ? { version: result.sourceVersion } : {}),
        };
        ctx.logger?.info?.(
            `[MarketplaceInstallLocal] installed ${manifestId} unmanaged: ${result.copiedCount} item(s) copied into the `
            + `environment base '${result.targetPackageId}' (namespace '${result.namespace}'), installed from `
            + `${installedFrom.packageId}${installedFrom.version ? `@${installedFrom.version}` : ''}`
            + `${userId ? ` by ${userId}` : ''}. Nothing is registered under '${manifestId}'; the copy follows no upgrade.`,
        );
        const declaresSeeds = unmanagedInstallValueCarries(packageBody.data);
        return c.json({
            success: true,
            data: {
                manifestId,
                version,
                versionId,
                installMode: 'unmanaged',
                installedAt: new Date().toISOString(),
                installedFrom,
                targetPackageId: result.targetPackageId,
                namespace: result.namespace,
                copiedCount: result.copiedCount,
                copied: result.copied,
                strippedLocks: result.strippedLocks,
                ...(declaresSeeds
                    ? {
                        seeded: {
                            mode: 'skipped',
                            reason: 'an unmanaged install copies metadata, not data: the package\'s sample data was not loaded',
                        },
                    }
                    : {}),
                note: `The package's metadata is now this system's own, in the base '${result.targetPackageId}', `
                    + 'and it follows no upgrade. Refresh the console to see it.',
            },
        }, 200);
    };

    /**
     * Detect whether `manifestId` is already known to the kernel and classify
     * the source so we can refuse vs upgrade gracefully.
     *
     *   'none'         — fresh install
     *   'marketplace'  — previously installed by this plugin (allow upgrade)
     *   'user-code'    — defined by AppPlugin from objectstack.config.ts
     *                    (refuse to avoid silently overwriting authored code)
     */
    private findConflict = (ctx: PluginContext, manifestId: string): 'none' | 'marketplace' | 'user-code' => {
        // 1. A live ledger entry is the authoritative "we installed this" record.
        if (this.ledger.has(manifestId)) {
            return 'marketplace';
        }
        // 2. Present in the engine registry AND captured at boot before we
        //    rehydrated — genuine user/config code. Refuse to overwrite.
        if (this.bootUserCodeIds.has(manifestId)) {
            return 'user-code';
        }
        // 3. Registered, but neither in the ledger nor in the boot snapshot.
        //    This is an ORPHANED marketplace install — its ledger entry was
        //    lost/renamed/corrupted (e.g. a half-finished upgrade left a
        //    `.bak`). It is NOT user code, so treat it as a marketplace package
        //    and let the upgrade overwrite it, rather than refusing with a
        //    misleading "defined by this runtime's local code" error.
        try {
            const ql: any = ctx.getService('objectql');
            const packages: any[] = ql?.registry?.getAllPackages?.() ?? [];
            if (packages.some((p: any) => manifestIdOf(p) === manifestId)) {
                return 'marketplace';
            }
        } catch { /* objectql not registered yet — treat as fresh */ }
        return 'none';
    };

    /**
     * Record the manifest ids the engine registry already holds, called once at
     * `kernel:ready` before rehydrate. Best-effort: a missing/empty registry
     * just yields an empty snapshot (every later install is treated as fresh).
     */
    private captureBootUserCodeIds = (ctx: PluginContext): void => {
        try {
            const ql: any = ctx.getService('objectql');
            const packages: any[] = ql?.registry?.getAllPackages?.() ?? [];
            for (const p of packages) {
                const id = manifestIdOf(p);
                if (id) this.bootUserCodeIds.add(id);
            }
        } catch { /* objectql not ready — leave snapshot empty */ }
    };

    /**
     * Pull a userId out of the request's better-auth session, if any.
     * Returns null when there is no signed-in user. v1 does not check
     * admin role — UI gating + the auth requirement is sufficient for
     * dev / single-tenant runtimes. Stricter checks can be layered on
     * via a middleware in cloud-hosted multi-tenant deployments.
     */
    /**
     * POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data
     *
     * Re-runs SeedLoaderService against the cached manifest's `data` arrays.
     * Idempotent (upsert by id). Useful when:
     *   • The user installed an app and skipped sample data
     *   • A purge was undone
     *   • The user wants a clean baseline back after editing demo rows
     *
     * A success answers the loader's four counts — `inserted`, `updated`,
     * `skipped`, `errors` — so the caller sees why nothing changed. A run over
     * an intact baseline (every declared record already present, so all of
     * them `skipped`) is a success with `inserted: 0`: being idempotent, the
     * reseed has reached the state it exists to reach. `422 RESEED_NO_ROWS` is
     * kept for a run that wrote nothing because records failed (`errors`), or
     * because the loader had no record to process for this runtime.
     *
     * Multi-tenant: requires an active organization on the session (same
     * rule as install seed path). A walled session with none is refused with
     * ADR-0123 D2 / D4's answer ({@link noActiveOrganizationRefusal}); the
     * reseed's other declines (no seed datasets, no data engine or metadata
     * service, a seed run that threw) stay `400 RESEED_SKIPPED`.
     *
     * [#21834] An entry whose declared protocol range excludes this runtime is
     * refused first, with the install route's `422 OS_PROTOCOL_INCOMPATIBLE`
     * ({@link refuseProtocolIncompatibleEntry}): ahead of the side effects,
     * because both of those answers are decided after them.
     *
     * [#24040] An entry the handshake admits is then converted forward once
     * (ADR-0087 D2, {@link convertPackageBodyForward}), as the install and the
     * rehydrate convert it, so the side effects reload the same translations
     * and seed the same datasets the other two loads of that body do. A body
     * with no declared range comes back unchanged.
     */
    private handleReseed = async (c: any, ctx: PluginContext): Promise<Response> => {
        const admission = await this.requireInstallCapability(c, ctx, 'Reseeding sample data');
        if (!admission.ok) return admission.response;
        const manifestId = String(c.req.param?.('manifestId') ?? c.req.params?.manifestId ?? '').trim();
        if (!manifestId) {
            return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'manifestId path param required.' } }, 400);
        }
        if (!this.ledger.has(manifestId)) {
            return c.json({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: `No marketplace install for ${manifestId}.` } }, 404);
        }
        // #5426 — `has()` above already answered "is it installed", so reaching
        // this with no entry means the file is THERE and unreadable. The reason
        // travels to the operator instead of dying in a `catch`.
        const { entry, failure } = this.ledger.read(manifestId);
        if (!entry) {
            return this.unreadableLedgerEntry(c, ctx, manifestId, failure, 'reseed sample data');
        }
        // [#21834] ADR-0087 D1: the entry is judged before `applySideEffects`
        // loads its translations and merges its seed datasets.
        const incompatible = this.refuseProtocolIncompatibleEntry(c, entry);
        if (incompatible) return incompatible;

        // [#24040] ADR-0087 D2 — a reseed is a load of the ledger body too: the
        // body is converted forward ONCE here ({@link convertPackageBodyForward}),
        // after the handshake above judged the entry as stored, exactly as the
        // install and the rehydrate convert it, and that converted body is what
        // the side effects reload (its translations) and seed (its datasets).
        // The ledger keeps the body as installed: `entry` is written back below
        // with its `manifest` untouched.
        const converted = this.convertPackageBodyForward(ctx, entry.manifest);
        const summary = await this.applySideEffects(ctx, converted, { seedNow: true, c, door: 'reseed' });
        // [ADR-0123 D2 / D4] A walled session with no active organization: the
        // reseed is a tenant-scoped write with no organization to write under.
        if (summary.seeded.mode === 'refused') {
            return c.json({
                success: false,
                error: { code: NO_ACTIVE_ORGANIZATION_CODE, message: summary.seeded.reason },
            }, NO_ACTIVE_ORGANIZATION_STATUS);
        }
        if (summary.seeded.mode === 'skipped') {
            return c.json({
                success: false,
                error: {
                    code: 'RESEED_SKIPPED',
                    message: `Reseed did not run: ${summary.seeded.reason ?? 'unknown reason'}`,
                },
            }, 400);
        }

        const inserted = summary.seeded.inserted ?? 0;
        const updated = summary.seeded.updated ?? 0;
        const skipped = summary.seeded.skipped ?? 0;
        const errors = summary.seeded.errors ?? 0;
        const wrote = inserted + updated > 0;
        // The loader reconciles `inserted + updated + skipped + errored`
        // against the records it processes for this runtime (`SeedLoadResult`
        // in `@objectstack/spec/data`), so a clean run with nothing written and
        // `skipped > 0` found every one of them already present: the intact
        // baseline, which is a success. With `skipped` at 0 as well, it
        // processed no record at all.
        const intactBaseline = !wrote && errors === 0 && skipped > 0;

        // HONEST RESULT: the loader runs row-by-row and counts write failures
        // (locked DB, missing table, validation reject) into `errors` rather
        // than throwing. Previously this handler returned success — and flipped
        // `withSampleData` to true — even when every row failed, so the UI said
        // "done" while the database stayed empty. Treat a run that landed no
        // rows as a failure and report why — unless every row it would have
        // written is already there.
        if (!wrote && !intactBaseline) {
            return c.json({
                success: false,
                error: {
                    code: 'RESEED_NO_ROWS',
                    message: errors > 0
                        ? `Reseed wrote no rows (${errors} error${errors === 1 ? '' : 's'}).${summary.seeded.errorSample ? ` First error: ${summary.seeded.errorSample}` : ''}`
                        : 'Reseed wrote no rows. The package declares no seedable records for this runtime.',
                    details: { inserted, updated, errors },
                },
            }, 422);
        }

        // Only mark the install as carrying sample data once its rows are
        // there: landed by this run, or found already present by it.
        try {
            entry.withSampleData = true;
            entry.sampleDataPurged = false;
            this.ledger.write(entry);
        } catch { /* non-fatal */ }

        return c.json({
            success: true,
            data: {
                manifestId,
                inserted,
                updated,
                skipped,
                errors,
                withSampleData: true,
            },
        }, 200);
    };

    /**
     * POST /api/v1/marketplace/install-local/:manifestId/purge-sample-data
     *
     * Deletes the rows the cached manifest's seed datasets put in the
     * database, THROUGH THE OBJECTQL ENGINE, so the deletes run every
     * lifecycle hook (audit, sharing, storage, the package's own) — the same
     * posture the seed was written with (`SEED_WRITE_EXECUTION_CONTEXT`).
     * {@link purgeSeedRows} carries the rules; this handler supplies the scope.
     *
     *   • A seed row is matched by the seed's own key — each dataset's
     *     `externalId`, the key the install's upsert and the reseed match on.
     *     A row whose key no seed record declares (user-authored data) is never
     *     touched; a key carried by more than one row in scope is not guessed.
     *   • Scope is the install's: under an organization wall, the caller's
     *     active organization (the same `organizationWallActive` +
     *     `resolveActiveOrgId` the install and reseed seed under), and a session
     *     with none is refused the way reseed refuses it: ADR-0123 D2 / D4's
     *     `403 PERMISSION_DENIED` naming the missing active organization
     *     ({@link noActiveOrganizationRefusal}). Without a wall the
     *     deployment is one logical tenant and the match is table-wide, as the
     *     loader's upsert match is.
     *   • Children are deleted before parents — the reverse of the loader's own
     *     dependency order.
     *
     * `skipped` counts seed records no row in scope carries (already deleted);
     * `errors` counts records that could not be purged — refused by the engine,
     * or not identifiable — each reason logged.
     *
     * [#21834] An entry whose declared protocol range excludes this runtime is
     * refused first, with the install route's `422 OS_PROTOCOL_INCOMPATIBLE`
     * ({@link refuseProtocolIncompatibleEntry}): no row is deleted and the
     * ledger's `withSampleData` / `sampleDataPurged` are not rewritten.
     */
    private handlePurge = async (c: any, ctx: PluginContext): Promise<Response> => {
        const admission = await this.requireInstallCapability(c, ctx, 'Purging sample data');
        if (!admission.ok) return admission.response;
        const manifestId = String(c.req.param?.('manifestId') ?? c.req.params?.manifestId ?? '').trim();
        if (!manifestId) {
            return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'manifestId path param required.' } }, 400);
        }
        if (!this.ledger.has(manifestId)) {
            return c.json({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: `No marketplace install for ${manifestId}.` } }, 404);
        }
        // #5426 — same shape as reseed: `has()` said the file is there, so a
        // missing entry here is an unreadable one, and the operator gets the
        // reason rather than a sentence that points at itself.
        const { entry, failure } = this.ledger.read(manifestId);
        if (!entry) {
            return this.unreadableLedgerEntry(c, ctx, manifestId, failure, 'purge sample data');
        }
        // [#21834] ADR-0087 D1: the entry is judged before any row is matched,
        // deleted, or the ledger is written.
        const incompatible = this.refuseProtocolIncompatibleEntry(c, entry);
        if (incompatible) return incompatible;

        const datasets = seedDatasetsOf(entry.manifest);

        if (datasets.length === 0) {
            return c.json({
                success: false,
                error: { code: 'NOTHING_TO_PURGE', message: 'This package declares no seed datasets.' },
            }, 400);
        }

        // The data engine the seed was written through, and the metadata its
        // dependency order is read from — the pair the seed run itself needs.
        let ql: IObjectQLEngine | undefined;
        let metadata: IMetadataService | undefined;
        try { ql = ctx.getService<IObjectQLEngine>('objectql'); } catch { /* no data engine */ }
        try { metadata = ctx.getService<IMetadataService>('metadata'); } catch { /* no metadata service */ }
        if (!ql || !metadata) {
            return c.json({
                success: false,
                error: {
                    code: 'DRIVER_UNAVAILABLE',
                    message: 'The data engine (objectql) or the metadata service is not available on this runtime — cannot purge sample data.',
                },
            }, 500);
        }

        // Scope: the one the install and the reseed seed under (applySideEffects).
        let organizationId: string | undefined;
        if (organizationWallActive(ctx)) {
            const resolved = await this.resolveActiveOrgId(c, ctx);
            if (!resolved) {
                return c.json({
                    success: false,
                    error: { code: NO_ACTIVE_ORGANIZATION_CODE, message: noActiveOrganizationRefusal('purge') },
                }, NO_ACTIVE_ORGANIZATION_STATUS);
            }
            organizationId = resolved;
        }

        const { SeedLoaderService } = await import('@objectstack/runtime');
        const loader = new (SeedLoaderService as any)(ql, metadata, ctx.logger);
        const graph = await loader.buildDependencyGraph([...new Set(datasets.map((d: any) => String(d.object)))]);
        const { deleted, skipped, errors } = await purgeSeedRows({
            engine: ql,
            datasets,
            graph,
            organizationId,
            warn: (message) => ctx.logger?.warn?.(`[MarketplaceInstallLocal] ${manifestId}: ${message}`),
        });

        // Flip flag so UI reflects the empty baseline. `sampleDataPurged`
        // additionally tells the rehydrate-time healer this emptiness is
        // deliberate — demo rows must not come back on the next restart.
        try {
            entry.withSampleData = false;
            entry.sampleDataPurged = true;
            this.ledger.write(entry);
        } catch { /* non-fatal */ }

        ctx.logger?.info?.(`[MarketplaceInstallLocal] purged ${manifestId}${organizationId ? ` (org=${organizationId})` : ''}: deleted=${deleted} skipped=${skipped} errors=${errors}`);
        return c.json({
            success: true,
            data: { manifestId, deleted, skipped, errors, withSampleData: false },
        }, 200);
    };

    /**
     * [#21834] ADR-0087 D1's handshake on the two sample-data doors: the answer
     * reseed and purge give a ledger entry whose declared protocol range
     * excludes this runtime, or `undefined` for an entry they may act on.
     *
     * The rehydrate does not load such an entry: nothing is registered, synced,
     * bound or seeded for it. The two doors used to act on it anyway. The reseed
     * loaded its translations into the i18n service and merged its seed datasets
     * into the shared `seed-datasets` list before its seed run failed on objects
     * nobody registered; the purge rewrote the ledger's `withSampleData` with no
     * row deleted.
     *
     * The answer is the install route's for the same manifest: `422
     * OS_PROTOCOL_INCOMPATIBLE`, the error's own message, and the diagnostic's
     * five fields in `error.details`, from the producer's one shaping helper
     * (`protocolIncompatibleAnswer`). Each door asks this right after it has
     * read the entry, before any side effect.
     *
     * Judged with `checkProtocolCompat` on the entry itself, read through
     * {@link flattenPackageBody} as the rehydrate judges it (#28604), and NOT
     * read from {@link refusedAtRehydrate}: an entry another
     * runtime wrote to a shared ledger after this boot was never rehydrated
     * here, and the doors refuse it all the same. Only a positive
     * incompatibility is refused. An absent or unrecognised range is admitted,
     * with no warning, so a loadable entry is answered exactly as before.
     * DELETE and a compatible re-install do not ask this: they are how an
     * operator gets out of the refused state.
     */
    private refuseProtocolIncompatibleEntry = (c: any, entry: InstalledEntry): Response | undefined => {
        const compat = checkProtocolCompat(flattenPackageBody(entry.manifest));
        if (compat.status !== 'incompatible') return undefined;
        const refusal = protocolIncompatibleAnswer(new ProtocolIncompatibleError(compat.diagnostic));
        return c.json({
            success: false,
            error: { code: refusal.code, message: refusal.message, details: refusal.details },
        }, refusal.status);
    };

    /**
     * ADR-0087 D2 for this plugin's three loads of a ledger body — the install,
     * the rehydrate and the reseed ({@link handleReseed}, #24040). The body is
     * data at rest (a published artifact), so it replays the versioned forward
     * conversion inside the window its own `engines.protocol` opens, through the
     * engine's ONE registration-door entry point
     * (`ObjectQL.convertPackageBodyForward`), reused here, never re-derived: a
     * body with no declared range comes back by reference, and the named warning
     * is the engine's own.
     *
     * Converted once per load and handed to EVERY reader of that load — on the
     * install and the rehydrate `manifest.register`, {@link bindArtifactHandlers},
     * {@link applySideEffects} and the rehydrate's sample-data heal; on the
     * reseed {@link applySideEffects} alone, since it neither registers nor
     * binds — so none of them reads the raw bytes while the registry holds the
     * converted copy. On the two loads that register, `register` meets the same
     * entry point again, which hands an already-converted body back by reference
     * with no second warning.
     *
     * An engine without that door (not ObjectQL) is handed the body as before.
     */
    private convertPackageBodyForward = (ctx: PluginContext, manifest: unknown): any => {
        let ql: { convertPackageBodyForward?: (body: unknown) => unknown } | undefined;
        try { ql = ctx.getService('objectql') as typeof ql; } catch { /* no data engine */ }
        return typeof ql?.convertPackageBodyForward === 'function' ? ql.convertPackageBodyForward(manifest) : manifest;
    };

    /**
     * [#28039] Register, record and connect the datasources `manifest`
     * declares, through `connectPackageDatasources` — the ONE path, which
     * `AppPlugin.start` takes for the artifact the host boots: each registered
     * in the metadata registry as `origin: 'code'` stamped with this package,
     * its name recorded in the host's code-datasource set, and connected
     * through the `datasource-connection` service (the D2 gate and the host's
     * connect policy apply as on a boot). A reinstall replaces the previous
     * version's datasources; the uninstall withdraws them through the
     * `runtime.package-datasources` uninstall cleanup.
     *
     * Before this, the door registered a package's objects and nothing of its
     * datasources: an object bound to one had no driver, and the admin door
     * did not serve the datasource as code-defined.
     *
     * ⛔ Where a declared credential comes from is not decided here (#27687):
     * a credential the connection service cannot resolve is its
     * `failed-credentials` verdict, which the datasource answers and a read of
     * a bound object names (`ERR_DATASOURCE_UNAVAILABLE`).
     *
     * Answers each declared datasource's verdict, or `undefined` when the
     * package declares none (or the runtime predates the path). Never throws:
     * the package is installed either way.
     */
    private connectDeclaredDatasources = async (
        ctx: PluginContext,
        manifest: unknown,
        manifestId: string,
        version: string | undefined,
    ): Promise<Array<{ name: string; status: string }> | undefined> => {
        const declared = declaredDatasources(manifest);
        let connect: typeof import('@objectstack/runtime')['connectPackageDatasources'] | undefined;
        try {
            const mod: any = await import('@objectstack/runtime');
            if (typeof mod?.connectPackageDatasources === 'function') connect = mod.connectPackageDatasources;
        } catch { /* reported below */ }
        if (!connect) {
            if (declared.length > 0) {
                ctx.logger?.warn?.(
                    `[MarketplaceInstallLocal] this runtime has no connectPackageDatasources — the datasources of ${manifestId} are NOT connected: `
                    + 'the objects bound to them have no driver. Upgrade @objectstack/runtime alongside @objectstack/cloud-connection.',
                );
            }
            return undefined;
        }
        const objects = isPlainObject(manifest) && Array.isArray(manifest.objects) ? manifest.objects : [];
        try {
            // Called with an empty list too: a reinstall whose new version
            // declares none withdraws what the previous version registered.
            const verdicts = await connect(ctx, {
                appId: manifestId,
                source: 'MarketplaceInstallLocal',
                datasources: declared,
                owned: declared.map((datasource) => ({
                    datasource,
                    owner: { packageId: manifestId, ...(typeof version === 'string' ? { packageVersion: version } : {}) },
                })),
                objects,
                installed: true,
            });
            return declared.length > 0 ? verdicts : undefined;
        } catch (err: any) {
            ctx.logger?.error?.(
                `[MarketplaceInstallLocal] the datasources of ${manifestId} could not be registered or connected: ${err?.message ?? err}`,
            );
            return declared.length > 0 ? [] : undefined;
        }
    };

    /**
     * [#28039] The first datasource `manifest` declares whose name another
     * holder already owns, with that holder — or [#28143] whose holder could
     * not be read, with what could not be. `undefined` when every name is free.
     *
     * The judge is the runtime's `datasourceNameHolder`, the one the
     * rehydrate's `connectPackageDatasources` leaves a held name alone on: the
     * host's `default`, a datasource item in the metadata registry not stamped
     * with this package (one created in Setup, another package's), a name in
     * the host's code-datasource set this package did not record, and a driver
     * registered on the data engine with no metadata item. This package's own
     * earlier registration is its own, so a reinstall passes.
     *
     * ⛔ Never `undefined` on a read fault: a holder that cannot be read is the
     * `reading` answer, which the door refuses `503`. A runtime without the
     * judge is that answer too.
     */
    private findHeldDatasourceName = async (
        ctx: PluginContext,
        manifest: unknown,
        manifestId: string,
    ): Promise<{ name: string; holder: string } | { name: string; reading: string; error: string } | undefined> => {
        const names = declaredDatasources(manifest)
            .map((ds) => ds?.name)
            .filter((name): name is string => typeof name === 'string' && name.length > 0);
        if (names.length === 0) return undefined;
        let judge: typeof import('@objectstack/runtime')['datasourceNameHolder'] | undefined;
        let loadError: unknown;
        try {
            const mod: any = await import('@objectstack/runtime');
            if (typeof mod?.datasourceNameHolder === 'function') judge = mod.datasourceNameHolder;
        } catch (err) {
            loadError = err;
        }
        if (!judge) {
            return {
                name: names[0],
                reading: "the runtime's datasource-name judge",
                error: loadError !== undefined
                    ? String((loadError as Error)?.message ?? loadError)
                    : '@objectstack/runtime has no datasourceNameHolder — upgrade it alongside @objectstack/cloud-connection',
            };
        }
        for (const name of names) {
            const holding = await judge(ctx, manifestId, name);
            if (holding.status === 'held') return { name, holder: holding.holder };
            if (holding.status === 'unreadable') {
                return { name, reading: holding.reading, error: String((holding.cause as Error)?.message ?? holding.cause) };
            }
        }
        return undefined;
    };

    /**
     * [#21321] Bind an installed package's executable handlers — its
     * `type: 'script'` action bodies and its body hooks — through
     * `bindAppArtifactHandlers`, the runtime's ONE binder and the call
     * `AppPlugin.start` makes for a boot artifact, under the same owner
     * (`app:<manifestId>`). Called on the install route and on the
     * `kernel:ready` rehydrate.
     *
     * [#21489] …and schedule its jobs through `scheduleAppArtifactJobs`, the
     * binder's job half and the call `AppPlugin` makes on `kernel:ready`: a job
     * `body` runs sandboxed on its schedule, hot and after a restart. A
     * handler-only job never reaches here on an install — the install route
     * refuses it ({@link unrunnableCode}) — and on a rehydrate of an entry an
     * older build installed it is reported at `warn` and not run.
     *
     * [#21585] This door carries no runtime module, and says so to the binder
     * (`withholdHooksWithoutBody`): a hook with no `body` is warned and NOT
     * bound, because its function-name `handler` can never name the package's
     * own code here. The install route refuses such a hook, so this fires only
     * on the rehydrate of an entry an older build installed — which before this
     * bound the hook by name to whatever function the engine held under it.
     *
     * Before this, `manifest.register` was the whole install: the package's
     * actions and hooks were DECLARED and never bound, so every door refused
     * its script actions ("No handler registered" over MCP, 404 over REST)
     * before and after a restart, and its body hooks never fired — while an
     * `os start --artifact` boot of the same file dispatched them.
     *
     * The binder replaces the owner's previous set, so a reinstall leaves each
     * action with exactly one handler and stops whatever the new version
     * dropped. ⛔ No second registration path lives here: a runtime without the
     * binder (an older build, or a suite that mocks `@objectstack/runtime`
     * without it) binds NOTHING and says so — the package's script actions then
     * stay unrunnable, and `list_actions` does not advertise them. The same
     * holds for the job half: no job is scheduled here by any other route.
     *
     * Resolved lazily through `@objectstack/runtime`, like every other runtime
     * helper this plugin calls. Never throws.
     */
    private bindArtifactHandlers = async (ctx: PluginContext, manifest: unknown, manifestId: string): Promise<void> => {
        let ql: IObjectQLEngine | undefined;
        try { ql = ctx.getService<IObjectQLEngine>('objectql'); } catch { /* no data engine */ }
        if (!ql) {
            ctx.logger?.warn?.(`[MarketplaceInstallLocal] no objectql engine — the script actions, body hooks and jobs of ${manifestId} are NOT bound`);
            return;
        }
        let bind: typeof import('@objectstack/runtime')['bindAppArtifactHandlers'] | undefined;
        let schedule: typeof import('@objectstack/runtime')['scheduleAppArtifactJobs'] | undefined;
        try {
            const mod: any = await import('@objectstack/runtime');
            if (typeof mod?.bindAppArtifactHandlers === 'function') bind = mod.bindAppArtifactHandlers;
            if (typeof mod?.scheduleAppArtifactJobs === 'function') schedule = mod.scheduleAppArtifactJobs;
        } catch { /* reported below */ }
        if (!bind) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] this runtime has no bindAppArtifactHandlers — the script actions and body hooks of ${manifestId} are NOT bound: `
                + 'every door refuses those actions and the hooks never fire. Upgrade @objectstack/runtime alongside @objectstack/cloud-connection.',
            );
        } else {
            const bound = bind(ql, manifest, {
                appId: manifestId,
                logger: ctx.logger,
                source: 'MarketplaceInstallLocal',
                withholdHooksWithoutBody: true,
            });
            // A runtime that predates the option binds a hook with no `body` by
            // name, as before — say so rather than answer as if it withheld it.
            if (!Array.isArray((bound as { withheldHooks?: unknown } | undefined)?.withheldHooks)) {
                ctx.logger?.warn?.(
                    `[MarketplaceInstallLocal] this runtime's binder predates withholdHooksWithoutBody — a hook of ${manifestId} with no \`body\` `
                    + 'is bound by its handler name, not withheld. Upgrade @objectstack/runtime alongside @objectstack/cloud-connection.',
                );
            }
        }
        if (!schedule) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] this runtime has no scheduleAppArtifactJobs — the jobs of ${manifestId} are NOT scheduled. `
                + 'Upgrade @objectstack/runtime alongside @objectstack/cloud-connection.',
            );
            return;
        }
        await schedule(ctx, manifest, { appId: manifestId, ql, source: 'MarketplaceInstallLocal' });
    };

    /**
     * [#21489, #21585] The code in `manifest` this door cannot run, which the
     * install route refuses:
     *
     *   - the enabled jobs with no `body`, with a `body` the declaration
     *     refuses, or with a `pull` that does not bind
     *     (`collectJobsWithoutBody`, which reads the jobs the binder schedules,
     *     judges a body by the parse the binder binds by and a pull by the
     *     binder's own `judgeJobPull`);
     *   - the hooks with no `body` (`collectHooksWithoutBody`, the judgement the
     *     binder withholds by on this door's rehydrate).
     *
     * Both judgements are the runtime binder's own, so the door and the binder
     * cannot disagree about what this door can run. A runtime that predates a
     * judgement judges nothing for it and says so: the install proceeds as it
     * did before that gate existed.
     */
    private unrunnableCode = async (
        ctx: PluginContext,
        manifest: unknown,
        manifestId: string,
    ): Promise<UnrunnableCode> => {
        let collectJobs: typeof import('@objectstack/runtime')['collectJobsWithoutBody'] | undefined;
        let collectHooks: typeof import('@objectstack/runtime')['collectHooksWithoutBody'] | undefined;
        try {
            const mod: any = await import('@objectstack/runtime');
            if (typeof mod?.collectJobsWithoutBody === 'function') collectJobs = mod.collectJobsWithoutBody;
            if (typeof mod?.collectHooksWithoutBody === 'function') collectHooks = mod.collectHooksWithoutBody;
        } catch { /* reported below */ }
        if (!collectJobs) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] this runtime has no collectJobsWithoutBody — the jobs of ${manifestId} are not judged, `
                + 'so a job with no runnable `body` or `pull` installs and is never run. Upgrade @objectstack/runtime alongside @objectstack/cloud-connection.',
            );
        }
        if (!collectHooks) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] this runtime has no collectHooksWithoutBody — the hooks of ${manifestId} are not judged, `
                + 'so a hook with no `body` installs. Upgrade @objectstack/runtime alongside @objectstack/cloud-connection.',
            );
        }
        return { jobs: collectJobs ? collectJobs(manifest) : [], hooks: collectHooks ? collectHooks(manifest) : [] };
    };

    /**
     * [#27237] The connector credentials an installed package's declarative
     * connectors name (`connectors[].auth.credentialRef`, ruling A on #27230),
     * each with its status and source as the automation service's credential
     * listing answers them — never a value. `undefined` when no connector of
     * the package names one.
     *
     * A reference that is not set does not refuse the install: the instance
     * naming it installs degraded and materializes when an administrator sets
     * it (`PUT /api/v1/automation/connectors/credential-refs/:ref`). With no
     * automation service, or one that cannot list, the status is `unknown`.
     * `writable` is the references the credential door can store, as the
     * listing says; `undefined` when there is no listing to say it.
     */
    private describeInstalledCredentialRefs = async (
        ctx: PluginContext,
        converted: unknown,
    ): Promise<{ entries: InstalledCredentialRef[]; writable?: ReadonlySet<string> } | undefined> => {
        const connectors = (converted as { connectors?: unknown } | null)?.connectors;
        const declared = new Map<string, string[]>();
        for (const raw of Array.isArray(connectors) ? connectors : []) {
            const entry = raw as { name?: unknown; provider?: unknown; auth?: { credentialRef?: unknown } } | null;
            if (typeof entry?.name !== 'string' || typeof entry.provider !== 'string') continue;
            const ref = entry.auth?.credentialRef;
            if (typeof ref !== 'string' || ref.length === 0) continue;
            declared.set(ref, [...(declared.get(ref) ?? []), entry.name]);
        }
        if (declared.size === 0) return undefined;
        let listing: Map<string, ConnectorCredentialRef> | undefined;
        try {
            const automation = ctx.getService<Pick<IAutomationService, 'listConnectorCredentialRefs'>>('automation');
            if (typeof automation?.listConnectorCredentialRefs === 'function') {
                listing = new Map((await automation.listConnectorCredentialRefs()).map((e) => [e.ref, e]));
            }
        } catch (err: any) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] the connector credential listing could not be read, so the install answer reports `
                + `each credential the package names as status 'unknown'. Cause: ${err?.message ?? err}`,
            );
        }
        const entries = [...declared.keys()].sort().map((ref): InstalledCredentialRef => {
            const known = listing?.get(ref);
            return {
                ref,
                connectors: declared.get(ref)!,
                status: listing === undefined ? 'unknown' : (known?.status ?? 'missing'),
                source: known?.source ?? null,
            };
        });
        const writable = listing === undefined
            ? undefined
            : new Set([...declared.keys()].filter((ref) => listing!.get(ref)?.writable !== false));
        return { entries, ...(writable ? { writable } : {}) };
    };

    /**
     * [#21322] Announce a HOT install to the running kernel as
     * `metadata:reloaded` — the platform's one post-boot re-sync signal, which
     * a Studio package publish, a per-item publish and an artifact reload
     * already announce — so the consumers that read a package only at
     * `kernel:ready` re-run that same read for this one:
     *
     *   - `service-automation` re-syncs its flows from the protocol
     *     (`resyncFlowsFromProtocol`, the `kernel:ready` bind's own
     *     `registerFlow`), so the package's record-change flows fire;
     *   - `plugin-security` re-ran its declared-permission seeding here until
     *     ADR-0131 C3 stage 6b-2 retired it. A package's permission sets are
     *     now served by the security catalog from the registry as soon as the
     *     install registers them, so nothing re-runs for them.
     *
     * Before this, a hot install left both until the next restart: the
     * restart's rehydrate registers the package ahead of those sweeps, a hot
     * install registers it after them, and nothing re-ran them. ⛔ Nothing here
     * binds a flow or writes a permission-set row itself — that would be the
     * install-only second path the boot never takes. The rehydrate does NOT
     * call this: it runs inside `kernel:ready`, ahead of the very sweeps this
     * re-runs, which is why a restart already reads correctly.
     *
     * `changed` names the app the install registered (`app/<manifestId>`, the
     * type and key `registerApp` files it under). Never throws: the package is
     * registered and persisted either way, so a failed re-sync is a FUNCTIONAL
     * degradation — said once at `warn`, with the restart that repairs it, the
     * level the publish door's announce failure uses.
     */
    private announceHotInstall = async (ctx: PluginContext, manifestId: string): Promise<void> => {
        if (typeof ctx.trigger !== 'function') {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] this kernel context cannot announce metadata:reloaded — the record-change flows `
                + `of ${manifestId} take effect only after a restart.`,
            );
            return;
        }
        try {
            await ctx.trigger('metadata:reloaded', { changed: [`app/${manifestId}`] });
        } catch (err: any) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] ${manifestId} is installed, but the metadata:reloaded re-sync FAILED — its `
                + 'record-change flows may not fire '
                + `until the runtime restarts (the restart re-reads every installed package). Cause: ${err?.message ?? err}`,
            );
        }
    };

    /**
     * Replicate the start-time side-effects that AppPlugin runs for
     * statically-declared apps but the `manifest` service does NOT:
     *
     *   1. Load `manifest.translations` (array of `Record<locale, data>`)
     *      into the i18n service — auto-creating an in-memory fallback if
     *      none is registered, matching AppPlugin's behaviour.
     *
     *   2. Merge `manifest.data` (an array of seed datasets) into the
     *      kernel's `seed-datasets` service so SecurityPlugin's per-org
     *      replay middleware picks them up on every future
     *      sys_organization insert.
     *
     *   3. When `seedNow=true`, also run the seed immediately so the user
     *      sees demo data without having to create a new org:
     *        • single-tenant: run SeedLoaderService inline (mirrors
     *          AppPlugin single-tenant branch)
     *        • multi-tenant: invoke `seed-replayer` for the caller's
     *          active org (resolved from the request session); a session
     *          with none reports `mode: 'refused'`, ADR-0123 D2 / D4's
     *          sentence for `opts.door` in `reason`, and seeds nothing
     *
     * Errors are logged but never thrown — install succeeds even if
     * post-register side-effects partially fail (the manifest itself is
     * already registered + cached). Returns a small summary for the
     * response envelope.
     */
    private applySideEffects = async (
        ctx: PluginContext,
        manifest: any,
        opts: { seedNow: boolean; c?: any; door?: Exclude<SampleDataDoor, 'purge'> },
    ): Promise<{ translationsLoaded: number; seeded: { mode: 'inline' | 'replayer' | 'skipped' | 'refused'; inserted?: number; updated?: number; skipped?: number; errors?: number; reason?: string; errorSample?: string } }> => {
        const appId = String(manifest?.id ?? 'unknown');
        let translationsLoaded = 0;
        let seedSummary: any = { mode: 'skipped', reason: 'no-datasets' };

        // ── 1. i18n bundles ─────────────────────────────────────────────
        try {
            const bundles: Array<Record<string, unknown>> = [];
            if (Array.isArray(manifest?.translations)) bundles.push(...manifest.translations);
            if (Array.isArray(manifest?.i18n)) bundles.push(...manifest.i18n);

            if (bundles.length > 0) {
                let i18nService: any;
                try { i18nService = ctx.getService('i18n'); } catch { /* not registered */ }
                if (!i18nService) {
                    try {
                        const mod = await import('@objectstack/core');
                        const createMemoryI18n = (mod as any).createMemoryI18n;
                        if (typeof createMemoryI18n === 'function') {
                            i18nService = createMemoryI18n();
                            (ctx as any).registerService?.('i18n', i18nService);
                            ctx.logger?.info?.(`[MarketplaceInstallLocal] auto-registered in-memory i18n fallback for "${appId}"`);
                        }
                    } catch { /* fallback unavailable */ }
                }
                if (i18nService?.loadTranslations) {
                    for (const bundle of bundles) {
                        for (const [locale, data] of Object.entries(bundle)) {
                            if (data && typeof data === 'object') {
                                try {
                                    i18nService.loadTranslations(locale, data as Record<string, unknown>);
                                    translationsLoaded++;
                                } catch (err: any) {
                                    ctx.logger?.warn?.(`[MarketplaceInstallLocal] failed to load ${appId} translations for ${locale}: ${err?.message ?? err}`);
                                }
                            }
                        }
                    }
                    ctx.logger?.info?.(`[MarketplaceInstallLocal] loaded ${translationsLoaded} locale bundle(s) for ${appId}`);
                }
            }
        } catch (err: any) {
            ctx.logger?.warn?.(`[MarketplaceInstallLocal] i18n side-effect failed for ${appId}: ${err?.message ?? err}`);
        }

        // ── 2. Seed datasets — merge into kernel service ─────────────────
        const datasets = Array.isArray(manifest?.data)
            ? manifest.data.filter((d: any) => d && d.object && Array.isArray(d.records))
            : [];

        if (datasets.length > 0) {
            try {
                const total = await this.mergeSeedDatasetsIntoKernel(ctx, datasets);
                ctx.logger?.info?.(`[MarketplaceInstallLocal] merged ${datasets.length} seed dataset(s) into kernel (total: ${total})`);
            } catch (err: any) {
                ctx.logger?.warn?.(`[MarketplaceInstallLocal] failed to merge seed-datasets: ${err?.message ?? err}`);
            }
            // [#9070] …and register the CONSUMER of that merge, right here, so the
            // two cannot land apart again. Merging seeds onto a kernel with no
            // `seed-replayer` is a no-op with a success log: every organization
            // founded after this install boots empty. Register-once means a host
            // that already has a replayer is untouched (that is what the helper is
            // for), and the incumbent replays this package's datasets anyway
            // because it re-reads the same shared list. Runs on the rehydrate path
            // too (`seedNow: false`), which is where a restarted runtime gets its
            // replayer back.
            try {
                const registered = await this.registerSeedReplayerIntoKernel(ctx);
                ctx.logger?.info?.(
                    registered
                        ? `[MarketplaceInstallLocal] registered per-org seed-replayer for ${appId}`
                        : `[MarketplaceInstallLocal] per-org seed-replayer already registered — reused for ${appId}`,
                );
            } catch (err: any) {
                ctx.logger?.warn?.(`[MarketplaceInstallLocal] failed to register seed-replayer: ${err?.message ?? err}`);
            }
        }

        // ── 3. Optional immediate seed ───────────────────────────────────
        // Always seed inline via SeedLoaderService — don't route the
        // install's OWN seed through the `seed-replayer` service, since
        // (a) whoever registered it may be a foreign source (AppPlugin,
        // or step 2's registration on an earlier install) and (b) its
        // closure may use stale datasets. Note the replayer is now
        // guaranteed to EXIST by step 2 (#9070) — that guarantee is
        // about future organizations, and does not make it the right
        // instrument for seeding the caller's own org right now. In
        // multi-tenant mode we pass `organizationId` so the loader
        // writes tenant-scoped rows the same way AppPlugin's
        // single-tenant branch + SecurityPlugin's per-org replay do.
        if (opts.seedNow && datasets.length > 0) {
            // See `organizationWallActive` — the wall in FORCE, not the demoted
            // boolean. This one is the write path: judged wrong, the install's
            // rows are inserted with no `organization_id` on a walled
            // deployment, i.e. behind the wall and unreadable by every caller
            // the wall applies to (#5262).
            const multiTenant = organizationWallActive(ctx);
            try {
                const ql: any = ctx.getService('objectql');
                let metadata: any;
                try { metadata = ctx.getService('metadata'); } catch { /* none */ }
                if (!ql || !metadata) {
                    seedSummary = { mode: 'skipped', reason: 'objectql-or-metadata-missing' };
                } else {
                    let organizationId: string | undefined;
                    if (multiTenant) {
                        const resolved = await this.resolveActiveOrgId(opts.c, ctx);
                        if (resolved) organizationId = resolved;
                        else {
                            // [ADR-0123 D2 / D4] Refused, not skipped: the rows are
                            // tenant-scoped writes and this session names no tenant.
                            const reason = noActiveOrganizationRefusal(opts.door ?? 'install');
                            seedSummary = { mode: 'refused', reason };
                            ctx.logger?.warn?.(`[MarketplaceInstallLocal] ${appId}: ${reason}`);
                        }
                    }
                    if (!multiTenant || organizationId) {
                        const s = await this.runInlineSeed(ctx, datasets, organizationId);
                        seedSummary = { mode: 'inline', ...s };
                        ctx.logger?.info?.(`[MarketplaceInstallLocal] inline seed for ${appId}${organizationId ? ` (org=${organizationId})` : ''}: inserted=${s.inserted} updated=${s.updated} skipped=${s.skipped} errors=${s.errors}`);
                    }
                }
            } catch (err: any) {
                seedSummary = { mode: 'skipped', reason: `seed-error: ${err?.message ?? err}` };
                ctx.logger?.warn?.(`[MarketplaceInstallLocal] seed run failed for ${appId}: ${err?.message ?? err}`);
            }
        }

        return { translationsLoaded, seeded: seedSummary };
    };

    /**
     * One SeedLoaderService run over `datasets` (upsert, multi-pass) — the
     * shared engine behind install-time seeding, the reseed endpoint and the
     * rehydrate-time healer. Throws when objectql/metadata are unavailable;
     * per-row write failures are counted into `errors`, not thrown.
     */
    private runInlineSeed = async (
        ctx: PluginContext,
        datasets: any[],
        organizationId?: string,
    ): Promise<{ inserted: number; updated: number; skipped: number; errors: number; errorList: any[]; droppedRefs: number; errorSample?: string }> => {
        const ql: any = ctx.getService('objectql');
        let metadata: any;
        try { metadata = ctx.getService('metadata'); } catch { /* none */ }
        if (!ql || !metadata) throw new Error('objectql-or-metadata-missing');

        const [{ SeedLoaderService }, { SeedLoaderRequestSchema }] = await Promise.all([
            import('@objectstack/runtime'),
            import('@objectstack/spec/data'),
        ]);
        const seedLoader = new (SeedLoaderService as any)(ql, metadata, ctx.logger);
        const request = (SeedLoaderRequestSchema as any).parse({
            // ADR-0036 / seed rename: the field is `seeds` (was `datasets`).
            seeds: datasets,
            config: {
                defaultMode: 'upsert',
                multiPass: true,
                ...(organizationId ? { organizationId } : {}),
            },
        });
        const result = await seedLoader.load(request);
        return {
            inserted: result.summary.totalInserted,
            updated: result.summary.totalUpdated,
            skipped: result.summary.totalSkipped ?? 0,
            errors: result.errors.length,
            // [#9070] The raw array beside the count. The per-org replayer's
            // consumer reports `errors.length` and samples `errors.slice(0, 5)`;
            // a count handed to it reads as "0 error(s)" through its optional
            // chaining. Every other caller here wants the count, so both ship.
            errorList: Array.isArray(result.errors) ? result.errors : [],
            // Reference fields dropped from rows that WERE written (#3932) —
            // invisible in every row count, so carried explicitly.
            droppedRefs: result.summary.totalReferencesDropped ?? 0,
            // Surface the first write/resolution failure so the caller can
            // report WHY nothing landed (e.g. a locked DB, a missing table,
            // a failed validation) instead of a bare "0 rows".
            errorSample: result.errors[0]?.message,
        };
    };

    /**
     * Best-effort active-org resolution. Reads the better-auth session directly
     * and returns `session.activeOrganizationId`, or `null` when it has none.
     *
     * [ADR-0123 D1] `null` is an answer, not a gap to fill: "authenticated, with
     * no active organization" is a declared state, and every caller of this read
     * refuses the tenant-scoped write it would scope ({@link noActiveOrganizationRefusal}).
     * ⛔ No membership fallback. Guessing from the user's memberships would be a
     * fourth semantics for that state, and for a user in several organizations it
     * would write into one the caller never chose. The fallback this once carried
     * read an object no package defines, so it threw, was swallowed, and never
     * answered once.
     *
     * ⚠️ [#8976] This is a SCOPING read, not an authorization one — which org's
     * rows a seed lands in, asked only after {@link requireInstallCapability}
     * has already admitted the caller. It deliberately does NOT go through
     * `resolveAuthzContext`: the tenant a request is acting in is a different
     * question from the grants it holds, and the resolver's `tenantId` is the
     * session's active org with no membership fallback. Never promote this into
     * an admission check — it answers `null` for perfectly authorized callers.
     */
    private resolveActiveOrgId = async (c: any, ctx: PluginContext): Promise<string | null> => {
        if (!c?.req?.raw?.headers) return null;
        try {
            const authService: any = ctx.getService('auth');
            let api: any = authService?.api;
            if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
            if (!api?.getSession) return null;
            // [#22258] A request carrying a session cookie reads without
            // renewal: this route's response never carries a renewed cookie.
            // [#24222] Typed as `AuthSessionApi` declares the answer, and read
            // where it declares the active organization. No top-level
            // `activeOrganizationId` operand: no in-process producer answers one.
            const session: SessionRead | null = await api.getSession(inProcessSessionReadInput(c.req.raw.headers));
            const direct = session?.session?.activeOrganizationId ?? null;
            if (direct) return String(direct);
        } catch { /* ignore */ }
        return null;
    };

    /**
     * [#8976] The ONE authorization decision every mutating install-local route
     * makes — identity AND capability, resolved together, in one place.
     *
     * ## What this replaced, and what was measured through it
     *
     * The predecessor (`requireAuthenticatedUser`) asked one question — "is
     * there a session?" — and answered `yes` to two principals it should not
     * have. Driven through the composed plugin to the point the state actually
     * changes, all three shapes below returned `200` and were INDISTINGUISHABLE:
     * `manifest.register()` ran, `objectql.syncSchemas()` ran against the shared
     * database, the ledger file landed on disk, and the seed loader wrote rows.
     *
     *   principal                              install  reseed  purge  uninstall
     *   bare `x-user-id` header, NO session      200      200    200      200
     *   authenticated, no capability             200      200    200      200
     *   authenticated, `manage_metadata`         200      200    200      200
     *
     * Nothing downstream refused any of it. That is the whole finding: these are
     * not routes whose gate is weak, they are routes with no authorization at
     * all beyond "you are somebody".
     *
     * ## Why `resolveAuthzContext`, not a second session read
     *
     * It is the platform's SINGLE source of truth for turning an inbound request
     * into an authorization envelope (`@objectstack/core`, guarded by
     * `check:single-authz-resolver`), and it resolves API key / session / OAuth
     * and the whole `sys_member` → `sys_user_position` → permission-set
     * aggregation that a hand-rolled `getSession` read cannot. Two sibling
     * raw-route surfaces already made exactly this move for exactly this bug —
     * `SettingsServicePlugin` and `SharingServicePlugin` both replaced spoofable
     * header identity with this call — so this is the third instance of a
     * settled pattern, not a new one. The `getSession` bridge below is the same
     * shape `SettingsServicePlugin` passes.
     *
     * ## The `x-user-id` fallback is GONE, deliberately
     *
     * The old tail was `const xUserId = c?.req?.header?.('x-user-id'); if
     * (xUserId) return String(xUserId);` — commented "for cases where auth is
     * disabled (e.g. test stubs)". Measured (first row of the table above): with
     * no session store consulted first, a caller who could reach the port sent
     * one header and completed a full schema-mutating install, with `installedBy`
     * recorded as whatever string they chose. A test-stub convenience that is
     * also a production admission path is not a dev-mode feature, and there is
     * no mode flag on it to gate. It was the LAST `x-user-id` trust left in
     * `packages/**` source; the two surfaces that carried the same line had it
     * removed rather than mode-gated (`plugin-sharing`, `service-settings`), and
     * the one first-party caller of these routes — `os package install` — signs
     * in for a real better-auth cookie and never sends the header.
     *
     * Fails CLOSED on every unresolvable input: no raw headers, no `objectql`,
     * a throwing resolver — all yield `null`, i.e. 401. An `objectql`-less
     * embedding could not have held a permission set to be judged on anyway, and
     * could not have run `syncSchemas()` either.
     */
    /**
     * [#15353] The ADMISSION seam's EFFECTIVE tenancy posture — derived here,
     * and ⛔ never borrowed from this file's install-time posture.
     *
     * ## What was open
     *
     * `resolveAuthzContext` gates BOTH posture-conditional API-key refusals on a
     * posture its CALLER supplies — `organization_required` inside
     * `resolveApiKeyAdmission`, and `organization_membership_ended` after the
     * grants are aggregated. This door supplied none, so neither guard ran, and
     * an API key's `tenantId` is `sys_api_key.active_organization_id` copied
     * verbatim: the caller's own stored claim, never vetted against current
     * membership. Under a wall-enforcing posture a key stamped with an
     * organization its owner has LEFT was admitted carrying that organization as
     * its tenant — through all five install-local doors, since they share
     * {@link resolveInstallPrincipal}.
     *
     * ## ⛔ Why the two postures already in this file are the WRONG value
     *
     * They are install-time seeding decisions, and both differ from what an
     * admission decision needs — measured, not assumed:
     *
     * - {@link organizationWallActive} answers a BOOLEAN ("will the per-org
     *   replay own this seeding?"), which cannot express the distinction the
     *   resolver keys on: `undefined` means "run no posture-conditional refusal
     *   at all", while `'single'` is a posture that is present and simply
     *   enforces no wall. It also ends in `postureEnforcesWall(resolveTenancyPosture())`
     *   — the REQUESTED posture, read from `OS_TENANCY_POSTURE`. Under ADR-0093
     *   D4/D5 a deployment that requests `isolated` without the enterprise
     *   organizations runtime is `single` in force, so the requested value would
     *   refuse legitimate automation over a wall that is not there.
     * - `evaluateGlobalUniqueGate` reads `resolveTenancyPosture()` outright, the
     *   same requested value.
     *
     * And its `catch` swallows EVERY failure into that requested fallback — the
     * permissive-on-failure shape #13906 exists to refuse, where a `tenancy`
     * service that was wired and BROKE reads as "this check does not apply".
     * ⛔ Do not wire either of them into this seam, and ⛔ do not add a
     * `catch { undefined }` here.
     *
     * ## The classification, decision 1 option A (#13906) — no longer here
     *
     * [#16013] `classifyAdmissionTenancyPosture` (`@objectstack/core`) owns the
     * branded/unbranded decision for every admission seam: never registered ⇒
     * quiet `undefined`; every other rejection ⇒ `AuthzStoreUnavailableError`
     * (ADR-0112 `SERVICE_UNAVAILABLE` / 503), because admission was never
     * DECIDED and must not be answered.
     *
     * ⚠️ What that means AT THIS DOOR is still this door's own: a lean
     * embedding with no `plugin-auth` is a SUPPORTED composition and behaviour
     * there is exactly what it was, and on the loud arm
     * {@link resolveInstallPrincipal}'s `catch` already re-raises this brand
     * rather than collapsing it to `null` (401).
     *
     * ⚠️ The brand exists only on the ASYNC resolution path: `PluginContext.getService`
     * throws two UNBRANDED plain `Error`s (`… not found` and `… is async - use
     * await`), so a synchronous read cannot tell the two facts apart and would
     * have to guess. Hence `getServiceAsync`, reached through `getKernel()`.
     *
     * ⚠️ The ASYNC ACCESSOR's presence is part of the wiring fact, exactly as
     * on the REST seam: a `KernelBase`-shaped host (`LiteKernel`) exposes
     * `getKernel()` but has no `getServiceAsync` at all, so dereferencing it
     * would raise an unbranded — therefore LOUD — `TypeError`, turning "this
     * host shape has no async registry" into an outage. Such a host has no
     * service factories either, so absence is the only fault it could report.
     * It keeps the quiet answer.
     */
    private resolveAdmissionTenancyPosture = async (
        ctx: PluginContext,
    ): Promise<TenancyPosture | undefined> => {
        const kernel = ctx.getKernel?.() as
            | { getServiceAsync?: <T>(name: string, scopeId?: string) => Promise<T> }
            | undefined;
        if (!kernel || typeof kernel.getServiceAsync !== 'function') return undefined;
        return classifyAdmissionTenancyPosture(() =>
            kernel.getServiceAsync!<TenancyPostureSource>('tenancy'),
        );
    };

    private resolveInstallPrincipal = async (
        c: any,
        ctx: PluginContext,
    ): Promise<InstallPrincipal | null> => {
        const headers = c?.req?.raw?.headers;
        if (!headers) return null;
        try {
            // The `objectql` slot's declared contract, not `any` (#4127/#4251):
            // this lookup is NEW code, so it carries the contract rather than
            // riding the file's grandfathered entry in
            // `scripts/slot-lookup-baseline.json`. Same spelling the two sibling
            // surfaces named above use for this slot (`plugin-sharing`,
            // `service-settings`) — the full engine seen whole, of which the
            // resolver reads only `find`.
            let ql: IObjectQLEngine | undefined;
            try { ql = ctx.getService<IObjectQLEngine>('objectql'); } catch { /* no data engine */ }

            // The better-auth session bridge — resolved lazily and defensively,
            // exactly as the previous implementation did, then handed to the
            // shared resolver instead of being trusted on its own.
            // [#24222] Answers as `AuthSessionApi` declares the read, not `any`.
            const getSession = async (h: any): Promise<SessionRead | null> => {
                try {
                    const authService: any = ctx.getService('auth');
                    let api: any = authService?.api;
                    if (!api && typeof authService?.getApi === 'function') {
                        api = await authService.getApi();
                    }
                    // [#22258] The in-process session-read rule, as in
                    // `resolveActiveOrgId` above.
                    return await api?.getSession?.(inProcessSessionReadInput(h));
                } catch {
                    return undefined;
                }
            };

            // [#15353] The posture is an authorization INPUT, resolved for
            // THIS door before the resolver runs. Omitting it is what left
            // both posture-conditional API-key refusals unreachable here.
            const tenancyPosture = await this.resolveAdmissionTenancyPosture(ctx);
            // [#23455 · ruling C′ item 3] The auth service's per-user posture
            // computation, for the shared key-admission seam: a key whose OWNER
            // holds an `account`-scope posture resolves as a held principal
            // carrying it (`authz.authGate`), exactly as it does on REST. Read
            // per request like the two above; a lookup that faults is a kernel
            // with no posture to ask.
            let authService: IAuthService | undefined;
            try {
                authService = ctx.getService<IAuthService>('auth');
            } catch {
                authService = undefined;
            }
            const authz = await resolveAuthzContext({
                ql,
                headers,
                getSession,
                tenancyPosture,
                userAuthGates: userAuthGateSourceOf(authService),
                // [#23367] The API-key lifecycle policy, from the same service.
                apiKeyLifecycle: apiKeyLifecyclePolicySourceOf(authService),
            });
            if (!authz.userId) return null;
            // ADR-0069: the ONE consult of the authentication-policy gate for
            // all five doors. [#23455] It asks the shared resolver's posture
            // (`authz.authGate`), decided for whichever credential admitted the
            // caller: a held session's own, or the account-scope posture of an
            // API key's owner. It used to ask the session user alone, so a key
            // never carried a posture here and a held owner's key was served.
            // A key whose owner holds only a `credential`-scope posture
            // (password expiry, a forced reset) carries none, and is served. No
            // request path is passed, so the allow-list can grant no exemption
            // (an empty path earns none, #7898); no install-local route is a
            // remediation or bootstrap route.
            const authGate = evaluateAuthGate(authz, '');
            return {
                userId: String(authz.userId),
                systemPermissions: Array.isArray(authz.systemPermissions) ? authz.systemPermissions : [],
                posture: authz.posture,
                tenancyPosture,
                ...(authGate ? { authGate } : {}),
            };
        } catch (err) {
            // [commit 6a180e42d] `null` here means "nobody is authenticated", which is
            // not what a permission-store outage established. Re-raised.
            if (isAuthzStoreUnavailableError(err)) throw err;
            // [#23367, ruling A] A key its own lifecycle refused (revoked,
            // expired, inactive) is re-raised too: the five doors mount on the
            // host's raw app, whose thrown-envelope render answers its declared
            // `403` and registered code with the located message.
            if (isApiKeyLifecycleRefusalError(err)) throw err;
            return null;
        }
    };

    /**
     * [commit 01074e551] The ONE `401` this plugin issues — every door, one literal.
     *
     * The five routes now share an authenticated floor but NOT a capability
     * requirement (the four writes demand `manage_metadata`; the read narrows
     * two fields instead), so the "nobody is authenticated" refusal is the one
     * answer they must give identically. Extracted rather than copied: a client
     * branching on `UNAUTHENTICATED` must not have to learn which door it
     * knocked on, and an envelope duplicated per handler is exactly how this
     * file's five routes drifted apart on authorization in the first place.
     */
    private refuseUnauthenticated = (c: any): Response => c.json({
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
    }, 401);

    /**
     * [#8976] The shared refusal for the four mutating routes: 401 when nobody
     * is authenticated, 403 when somebody is but holds no authoring capability,
     * otherwise the acting `userId`.
     *
     * One helper rather than four inline copies, on purpose. The four doors are
     * one class — install, uninstall, reseed, purge all mutate installed
     * metadata or its data — and the failure this fixes is precisely a route
     * family whose members drifted apart on authorization. A single seam means a
     * fifth route added here cannot get a WEAKER answer by copying the wrong
     * neighbour, and `install-local-capability-enumeration.test.ts` fails the
     * build if one arrives that does not call this at all.
     *
     * `action` names the verb in the 403 so the operator learns which grant they
     * need, not merely that they were refused. The refusal is issued BEFORE any
     * work — before the manifest is parsed, before the ledger is read — so a
     * refused caller cannot use timing or a downstream error to probe what is
     * installed.
     */
    private requireInstallCapability = async (
        c: any,
        ctx: PluginContext,
        action: string,
    ): Promise<InstallAdmission | { ok: false; response: Response }> => {
        const principal = await this.resolveInstallPrincipal(c, ctx);
        if (!principal) return { ok: false, response: this.refuseUnauthenticated(c) };
        const held = refuseHeldSession(c, principal);
        if (held) return { ok: false, response: held };
        if (!principal.systemPermissions.includes(INSTALL_LOCAL_CAPABILITY)) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] refused ${action} for ${principal.userId} — `
                + `missing the \`${INSTALL_LOCAL_CAPABILITY}\` capability`,
            );
            return {
                ok: false,
                response: c.json({
                    success: false,
                    error: {
                        code: 'FORBIDDEN',
                        message: `${action} requires the \`${INSTALL_LOCAL_CAPABILITY}\` capability.`,
                    },
                }, 403),
            };
        }
        return {
            ok: true,
            userId: principal.userId,
            callerPosture: principal.posture,
            tenancyPosture: principal.tenancyPosture,
        };
    };

    /**
     * [ADR-0131 D3 · D12 items 7–8 · #23231] The walled refusal at the package
     * door: under a wall every organization shares the environment's metadata,
     * and installing, upgrading or uninstalling a package registers or removes
     * that metadata for every organization, so it is the platform operator's.
     *
     * Measured before this refusal (ruling A on #23231, record 6145019463),
     * under `isolated` and `group`: an organization's `manage_metadata` holder
     * (rung `TENANT_ADMIN`) installed a package carrying an object, upgraded
     * an operator-installed one and uninstalled it, each `200`, and another
     * organization's member read the installed object
     * (`wall-environment-metadata-refusal.dogfood.test.ts`). W2 had refused
     * only a package that declares a position, a permission set or a
     * capability (ADR-0131 D3); that reading of the manifests is gone with the
     * special case.
     *
     * The decision is {@link walledCatalogWriteVerdict}'s, never restated:
     * admitted under `single`, with no `tenancy` service and for the
     * `PLATFORM_ADMIN` rung, so the door then behaves exactly as before;
     * refused for everyone else under a wall, before any later step reads or
     * writes anything. The answer is the sibling refusals' envelope,
     * `403 FORBIDDEN`.
     */
    private refuseWalledCatalogPackage = (
        c: any,
        ctx: PluginContext,
        action: string,
        manifestId: string,
        admission: InstallAdmission,
    ): Response | null => {
        const verdict = walledCatalogWriteVerdict({
            type: 'package',
            tenancyPosture: admission.tenancyPosture,
            callerPosture: admission.callerPosture,
        });
        if (verdict.allowed) return null;
        ctx.logger?.warn?.(
            `[MarketplaceInstallLocal] refused ${action} ${manifestId} for ${admission.userId}: `
            + `the environment's metadata is the platform operator's under the '${admission.tenancyPosture}' posture `
            + '(ADR-0131 D12 items 7–8)',
        );
        return c.json({
            success: false,
            error: {
                code: 'FORBIDDEN',
                message: `${action} "${manifestId}" is refused. ${verdict.message}`,
                details: { manifestId },
            },
        }, 403);
    };

    /**
     * Read the whole ledger — the entries it parsed AND the files it could not
     * (#5413).
     *
     * Returns the listing rather than unwrapping `.entries` here on purpose: an
     * unwrap at this seam would put the silence back one layer up, where it is
     * even harder to find. Both call sites below report `skipped` before they
     * do anything with `entries`.
     */
    private readAll = (): InstalledManifestListing => this.ledger.list();

    /**
     * One line per ledger file that could not be read (#5413).
     *
     * `warn`, deliberately, and the same tier as this plugin's existing
     * "no `manifest` service — rehydrate skipped": this is a FUNCTIONAL
     * degradation, not a durability one. Nothing that claimed to persist failed
     * to land — the ledger file is still on disk, exactly as written — the
     * runtime is simply, visibly smaller than the ledger says it should be, and
     * the next person to look for the missing app finds out. (See AGENTS.md,
     * "Degradation log levels".)
     *
     * The file name and the thrower's own words are both in the line, because
     * they are the two things that turn "an app is missing" into a fix:
     * `.objectstack/installed-packages/<file>` is the thing to repair or delete.
     */
    /**
     * [#21762] The one line a rehydrate prints for a ledger entry it refuses to
     * load under ADR-0087 D1's handshake.
     *
     * `error`, not `warn`: the ledger says the package is installed while the
     * running kernel holds none of it, so persisted and runtime state disagree.
     * The GET listing still serves the entry, marked not loaded (#21822), to
     * whoever reads it; this line is what the boot itself says. The line owes
     * the consequence and the fix, and carries the handshake's own message,
     * which names the remedy: the replay command (`objectstack migrate meta`),
     * or for a package ahead of this runtime, the runtime upgrade (#26480).
     */
    private reportProtocolIncompatibleEntry = (
        ctx: PluginContext,
        entry: InstalledEntry,
        diagnostic: ProtocolIncompatibleDiagnostic,
    ): void => {
        ctx.logger?.error?.(
            `[MarketplaceInstallLocal] ${diagnostic.code}: ${entry.manifestId}@${entry.version} is NOT loaded into `
            + `this runtime, though its ledger entry lists it as installed — none of its objects, data or handlers `
            + `are available: ${diagnostic.message}. Install a version of the package built for protocol `
            + `${diagnostic.protocolVersion} (POST ${ROUTE_BASE}), or remove it (DELETE ${ROUTE_BASE}/${entry.manifestId}).`,
        );
    };

    private warnSkippedLedgerEntries = (ctx: PluginContext, skipped: SkippedManifestEntry[], what: string): void => {
        for (const { file, cause } of skipped) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] unreadable ledger entry ${file} — ${what} `
                + `(repair or remove ${join(this.storageDir, file)}): ${describeLedgerCause(cause)}`,
            );
        }
    };

    /**
     * The 500 for "`has()` said the entry is there, `read()` could not turn it
     * into one" — with the reason attached (#5426).
     *
     * Shared by reseed and purge because they hit the identical wall, and both
     * used to answer `Failed to read manifest cache.`: a sentence whose only
     * content is that the thing it just did failed. The operator was left with
     * nothing to act on — not the file, not whether it was truncated, locked or
     * a directory — while the object that said all three had been dropped in an
     * un-bound `catch` one layer down.
     *
     * Deliberate choices here:
     * - **`code` is unchanged** (`MARKETPLACE_STORAGE_FAILED`). This is the same
     *   failure it always was; only its explanation is new. A client branching
     *   on the code keeps working — the fix must not cost a wire break.
     * - **The cause is quoted, not paraphrased** (#5390 house style). `EACCES`,
     *   `EISDIR` and `Unexpected end of JSON input` are three different repairs,
     *   and the thrower words each better than any sentence here could.
     * - **In the response body, not only the log.** These are operator-facing
     *   admin endpoints — the person who can fix the file is the person holding
     *   the failed response — and the server line is the durable copy for
     *   whoever reads the log later instead.
     */
    private unreadableLedgerEntry = (
        c: any,
        ctx: PluginContext,
        manifestId: string,
        failure: SkippedManifestEntry | undefined,
        attempted: string,
    ): Response => {
        // `failure === undefined` here means the file vanished (or was emptied)
        // between `has()` and `read()` — a real race, rare, and worth wording
        // honestly rather than blaming a cause we were never handed. Note it
        // names the DIRECTORY: with no failure there is no file name to quote,
        // and inventing one would be the same self-referential mistake at a
        // different address.
        const detail = failure
            ? `repair or remove ${join(this.storageDir, failure.file)}: ${describeLedgerCause(failure.cause)}`
            : `its ledger file under ${this.storageDir} no longer yields an entry `
              + `(removed or emptied between the existence check and the read)`;

        ctx.logger?.warn?.(
            `[MarketplaceInstallLocal] cannot ${attempted} for ${manifestId} — its ledger entry is unreadable (${detail})`,
        );

        return c.json({
            success: false,
            error: {
                code: 'MARKETPLACE_STORAGE_FAILED',
                message: `Failed to read the manifest cache entry for ${manifestId} (${detail})`,
            },
        }, 500);
    };
}
