// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 7] Package install and update of `ObjectStackProtocolImplementation`
 * — the install primitive (`installPackage`), the manifest edit behind
 * `PATCH /packages/:id` (`updatePackage`), the `package` service's write half
 * both of them persist through (`packagePersistService`) and the undo a failed
 * install runs (`packageInstallUndo`) — moved out of `protocol.ts` whole. They
 * were the tail of the class.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same parses, writes and
 * undo, refusing exactly where they did with the same codes and messages. The
 * module-level declarations only these bodies read (`persistPackageManifest`,
 * `snapshotPackageRow`, `restorePackageRow`) moved with them, also unedited.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link PackageInstallHost} members that method reads, plus a
 * `.call`. A method is handed over as a closure that calls it on the protocol
 * at call time, so a test double or spy set on the instance is still the one
 * the body reaches, and the moved bodies that call one another
 * (`packagePersistService`, `packageInstallUndo`) do so through the protocol,
 * exactly as before.
 *
 * The fields the bodies read, `engine` and `getServicesRegistry`, go as
 * GETTERS, so each read happens when the body makes it: tests replace them on
 * a constructed protocol.
 *
 * The other module-level declarations the bodies read stay in `protocol.ts`,
 * where code that did not move reads them too, and are imported from there:
 * `packagePersistFailureError`, which the package delete also throws, and the
 * type `PackagePersistService`, which the class's own signatures name. The
 * module cycle is evaluation-safe because the one runtime import is read only
 * inside a function body, never while the two modules are first evaluated.
 * `index.ts` names what it publishes from `protocol.ts` one by one, so the
 * `export` they gained for this keeps them off the published surface, and
 * nothing re-exports this module, so the published surface does not move.
 */

import type { ObjectStackProtocolImplementation, PackagePersistService } from './protocol.js';
import { packagePersistFailureError } from './protocol.js';
import { assertDeclaredDependencies, assertProtocolCompat } from '@objectstack/metadata-core';
// [#24086] The install door's own manifest declaration — `ManifestSchema` with
// `scope` narrowed to `project` — judged whole at the top of `installPackage`.
import { PackageInstallManifestSchema } from '@objectstack/spec/api';
import type { InstallPackageRequest, InstallPackageResponse } from '@objectstack/spec/api';
import { ManifestSchema, deriveNamespaceFromPackageId, manifestIdRefusal } from '@objectstack/spec/kernel';

/**
 * [#21243] Write `manifest` to `sys_packages`, and say whether it failed.
 *
 * `undefined` means the write landed. Otherwise `cause` is what the failure
 * WAS — the thrown value, or the returned `{ success: false, … }` outcome —
 * wrapped so that a thrown `undefined` still reads as a failure.
 */
async function persistPackageManifest(
    svc: PackagePersistService,
    manifest: unknown,
): Promise<{ cause: unknown } | undefined> {
    let out: unknown;
    try {
        out = await svc.publish({ manifest, metadata: {} });
    } catch (cause) {
        return { cause };
    }
    if (typeof out === 'object' && out !== null && (out as { success?: unknown }).success === false) {
        return { cause: out };
    }
    return undefined;
}

/**
 * [#21243] A copy of a registry package row deep enough to undo
 * `updatePackageManifest`, which edits the row and its `manifest` in place.
 */
function snapshotPackageRow(row: unknown): Record<string, unknown> | undefined {
    if (typeof row !== 'object' || row === null) return undefined;
    const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
    const manifest = copy.manifest;
    if (typeof manifest === 'object' && manifest !== null) copy.manifest = { ...(manifest as Record<string, unknown>) };
    return copy;
}

/**
 * [#21243] Put `prior`'s content back into the registry's row object, IN
 * PLACE — the registry hands out and keeps that object, so replacing it would
 * restore nothing. The `manifest` is restored in place too when both sides
 * carry one, for the same reason.
 */
function restorePackageRow(target: Record<string, unknown>, prior: Record<string, unknown>): void {
    const assignInPlace = (into: Record<string, unknown>, from: Record<string, unknown>) => {
        for (const key of Object.keys(into)) if (!(key in from)) delete into[key];
        Object.assign(into, from);
    };
    const targetManifest = target.manifest;
    const priorManifest = prior.manifest;
    assignInPlace(target, prior);
    if (
        typeof targetManifest === 'object' && targetManifest !== null
        && typeof priorManifest === 'object' && priorManifest !== null
        && targetManifest !== priorManifest
    ) {
        assignInPlace(targetManifest as Record<string, unknown>, priorManifest as Record<string, unknown>);
        target.manifest = targetManifest;
    }
}

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for which members are getters.
 */
export interface PackageInstallHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
    packageInstallUndo: ObjectStackProtocolImplementation['packageInstallUndo'];
    packagePersistService: ObjectStackProtocolImplementation['packagePersistService'];
}

/** The body of `ObjectStackProtocolImplementation#installPackage`; the method's docblock there is its contract. */
export async function installPackage(
    this: Pick<PackageInstallHost, 'engine' | 'packageInstallUndo' | 'packagePersistService'>,
    request: InstallPackageRequest): Promise<InstallPackageResponse> {
    // [#19417] ⭐ THE PRIMITIVE PARSES THE `id` LEG — the declaration, by
    // reference, ahead of every write and every derivation below.
    //
    // `MANIFEST_ID_PATTERN` (`packages/spec/src/kernel/manifest.zod.ts`) is
    // the reverse-domain rule declared ONCE and referenced by BOTH faces of
    // this identity — `ManifestSchema.id`, what an author writes, and
    // `PackageSchema.manifestId`, what the registry stores and publishes by.
    // This primitive read `request.manifest` POSITIONALLY: it spread the
    // request into `any` and handed it to
    // `this.engine.registry.installPackage` with a second `as any`, so
    // `id: 'pkg-a'` — or `com.example.my_erp` — installed and PERSISTED,
    // while `defineStack()`, `os build`, `os validate` and the publish face
    // all refuse the same id. That is «declared ≠ enforced» on a PUBLISHED
    // contract, the shape Prime Directive #10 refuses outright and
    // 北极星 clause 4 names in as many words:
    // 「错的必须被**响亮拒绝**并给处方,**永不静默落库**」.
    //
    // ⭐ THE GATE IS ON THE PRIMITIVE, NOT ON ONE DOOR. #19473 landed the
    // same parse at `POST /packages`
    // (`packages/runtime/src/domains/packages.ts`), which is ONE caller of
    // this method — that door calls `protocol.installPackage` whenever the
    // protocol service resolves, and falls back to the bare registry write
    // when it does not. {@link duplicatePackage} below is a second caller,
    // and an embedder holding this object is a third. Gating a door alone
    // buys that door; the rule belongs where every caller passes.
    //
    // ⭐ THE SENTENCE IS THE DECLARATION'S, NOT THIS FILE'S — surfaced
    // rather than reworded, exactly as #19473 did it: `manifestIdRefusal`
    // names the key, echoes what the author wrote, lists the examples, and
    // offers a mechanical repair only after VERIFYING that candidate
    // against the pattern. A fourth sentence for one rule would drop the
    // repair.
    //
    // The throw carries `statusCode` so an HTTP boundary answers `400`
    // rather than the `500` an unannotated throw earns
    // (`resolveThrownHttpError`, `@objectstack/types`) — the same status
    // the HTTP door serves for this refusal, and the spelling this file
    // already uses for its `404`.
    //
    // ⛔ THE RAW VALUE IS PARSED, before the spread and before the version
    // and namespace defaults: an id the declaration refuses must never
    // reach `deriveNamespaceFromPackageId` below, which already ASSUMES the
    // reverse-domain shape it was never given a chance to enforce.
    //
    // The id leg keeps its own gate, ahead of the whole-manifest parse
    // below (#24086), so its sentence and its repair arm are not
    // displaced by a generic issue list.
    const rawId = (request.manifest as { id?: unknown } | undefined)?.id;
    const declaredId = ManifestSchema.shape.id.safeParse(rawId);
    if (!declaredId.success) {
        const [issue] = declaredId.error.issues;
        throw Object.assign(
            new Error(issue?.message || manifestIdRefusal('manifest.id', rawId)),
            { statusCode: 400 },
        );
    }

    // #2532 — runtime-created base packages routinely arrive versionless
    // ({id, name} from the builder / Setup). `sys_packages.version` is NOT
    // NULL, and the old guard here (`pkgSvc?.publish && manifest.version`)
    // silently SKIPPED persistence for exactly those packages — so they
    // lived only in the in-memory registry and vanished on restart, while
    // their metadata (objects, tables) survived. Default the version
    // instead of skipping: the registry and the durable row must agree.
    const manifest: any = { ...(request.manifest as any) };
    if (typeof manifest.version !== 'string' || !manifest.version) {
        manifest.version = '0.1.0';
    }

    // [#24086] ⭐ THE WHOLE MANIFEST IS JUDGED BY THE DOOR'S DECLARATION —
    // `PackageInstallManifestSchema`, the one `POST /api/v1/packages`
    // parses its body through, ⛔ not `ManifestSchema`, which still admits
    // the platform scopes (`cloud` / `system`) that declaration refuses
    // for an authored install. The id leg above was the only leg judged
    // here, so an in-process caller could store what the door answers
    // `400` for — an off-spec `type` such as `'application'`, an off-spec
    // `scope` such as `'environment'`, an unknown key — and the row was
    // read back on every boot.
    //
    // Placed AFTER the version default and BEFORE the namespace one, on
    // purpose: the declaration REQUIRES `version`, and the versionless
    // manifest this primitive has completed since #2532 keeps installing;
    // `namespace` is optional in the declaration, so its derivation needs
    // nothing from the parse. Nothing else is supplied — a manifest with
    // no `type` is refused, as the door refuses it.
    //
    // A GATE, not a normaliser, as at the door: the parse's defaults
    // (`scope`, `defaultDatasource`) are not copied onto the manifest that
    // is stored. Each issue is surfaced as the declaration words it, under
    // its `manifest.<key>` path — no sentence of this file's own for a rule.
    //
    // ⛔ Rows already in `sys_packages` are not judged by this: they are
    // data at rest, and the boot hydration (`PackageServicePlugin.start`,
    // `@objectstack/service-package`) replays them as stored — see the
    // tolerance stated there.
    const declaredManifest = PackageInstallManifestSchema.safeParse(manifest);
    if (!declaredManifest.success) {
        const located = declaredManifest.error.issues
            .map((issue) => `${['manifest', ...issue.path.map(String)].join('.')}: ${issue.message}`)
            .join('; ');
        throw Object.assign(
            new Error(`Invalid package manifest — ${located}`),
            { statusCode: 400 },
        );
    }

    // Studio-authored writable packages arrive WITHOUT a namespace. The
    // protocol mandates a package namespace whose prefix every object name
    // must carry (manifest.zod `namespace`); `defineStack` enforces it at
    // compile time, but runtime-created packages never take that path — so
    // the rule was silently inert for them. Derive a default namespace from
    // the package id (`com.example.leave` → `leave`) so the prefix can be
    // enforced at publish. An explicitly declared namespace always wins.
    // Set it on the single `manifest` object shared by the in-memory
    // registry and the durable `sys_packages` row below, so both agree.
    if (typeof manifest.namespace !== 'string' || !manifest.namespace) {
        const derived = deriveNamespaceFromPackageId(manifest.id);
        if (derived) manifest.namespace = derived;
    }

    // ADR-0087 D1 — protocol handshake. Refuse a package whose declared
    // `engines.protocol` range excludes this runtime's major BEFORE writing
    // it to the registry, with a structured diagnostic naming the migrate
    // command — instead of letting the mismatch surface later as a deep
    // schema/renderer crash. Packages with no range are grandfathered (warn
    // only); an unparsed range never causes a false rejection.
    assertProtocolCompat(manifest);

    // ADR-0141 D2 — the pre-install dependency check, beside the handshake and
    // as early: every `manifest.dependencies` entry must name a package
    // installed at a version inside its range (this primitive delivers one
    // package, so nothing else is co-delivered), or the install is refused
    // `422 DEPENDENCY_MISSING` naming every unmet entry, before the registry
    // write and the persist below. One predicate for every install door
    // (`@objectstack/metadata-core`); ⛔ it does not run at the manifest edit
    // (`updatePackage`) or at the boot rehydrate, which are not install acts.
    assertDeclaredDependencies({
        delivered: [manifest],
        getInstalled: (id) => this.engine.registry.getPackage?.(id),
    });

    // [#21243] What the registry holds for this id BEFORE the write, so a
    // failed persist below can put exactly that back. Read here because the
    // install REPLACES the row object (and may register the namespace).
    const undoInstall = this.packageInstallUndo(manifest);

    // [#23972] Every package this primitive installs is AUTHORED — a Studio
    // base, a duplicate, an HTTP install — persisted to `sys_packages` below.
    //
    // ADR-0087 D2 — this door is AUTHORING-side, so the registry judges the
    // manifest exactly as handed, and no forward conversion runs here (the
    // window the registration door, the `sys_packages` hydration and the
    // marketplace install open is for bodies at rest). Its callers hand it
    // a manifest being written now, and the declaration parse above
    // (#24086, the one `POST /api/v1/packages` also runs) has already
    // refused a metadata collection such as `pages` outright; `duplicatePackage`
    // copies the registry's own record, already judged; the unmanaged
    // install's base carries identity keys only; and AI Studio's blueprint
    // tools author in-process. A retired declaration there is the author's
    // to fix, refused loudly at the moment of writing. Once the body sits
    // in `sys_packages` it is data at rest, and the boot hydration
    // (`@objectstack/service-package`) converts it at every load.
    let pkg = this.engine.registry.installPackage(manifest as any, 'authored', request.settings);

    // [#19277] HONOUR `enableOnInstall` — the key THIS request contract
    // declares and this primitive read past. `InstallPackageRequestSchema`
    // (`packages/spec/src/kernel/package-registry.zod.ts`) has carried the
    // key since it was written, and the implementation here read
    // `request.manifest` and `request.settings` and nothing else: a caller
    // that switched the option off got an ENABLED install, with no refusal
    // and no warning. That is «declared but not enforced» on a published
    // option — what ADR-0049 (enforce-or-remove) and Prime Directive #10
    // refuse outright. Ruling batch #153 item 5 letter 1 (#18605) kept the
    // kernel declaration as a COPY of the HTTP request key with the SAME
    // meaning, so the disposition is ENFORCE, not retire.
    //
    // ⭐ The contract is 「缺省 = 保持，有旗 = 设置」 — maintainer ruling batch
    // #157 item 5 letter C, the same rule the HTTP door implements
    // (`packages/runtime/src/domains/packages.ts`). Three states, three
    // outcomes, through the SAME registry verbs `PATCH /packages/:id/enable`
    // and `PATCH /packages/:id/disable` use:
    //
    //   true    ⇒ enablePackage
    //   false   ⇒ disablePackage
    //   absent  ⇒ nothing at all; the row the registry returned stands
    //
    // ⚠️ The `true` arm is not decoration. `SchemaRegistry.installPackage`
    // has preserved an existing row's `enabled` / `status` /
    // `statusChangedAt` since #18877, so on a re-install nothing else will
    // clear a disable any more — dropping this arm would silently stop
    // honouring `true` on exactly the path an upgrade takes.
    //
    // ⚠️ `=== true` / `=== false`, never a truthiness test and never a `??`
    // default: the THREE states of this key are the contract, and
    // collapsing absent into either one is the defect. The declaration's own
    // `.default(true)` never reaches here — nothing parses an install
    // request through `InstallPackageRequestSchema` on this path — so
    // absence arrives intact and is read as absence.
    //
    // ⛔ What this seam does NOT write, recorded so it is not mistaken for
    // an oversight: the runtime's durable disabled-package file. That record
    // is keyed by ENVIRONMENT (`setPackageDisabled(environmentId, id,
    // disabled)`, `packages/runtime/src/package-state-store.ts`) and this
    // request carries no environment, so the key cannot even be formed here;
    // the module also lives in `@objectstack/runtime`, which depends on this
    // package and not the other way round. The HTTP door owns that half and
    // writes it from the row it returned. So `enableOnInstall` through this
    // primitive moves the registry row — what every in-process reader serves
    // from — for the life of the process, and a caller that needs the choice
    // to survive a restart goes through the door that owns the durable
    // record.
    const requestedEnabled = request.enableOnInstall;
    if (requestedEnabled === true) {
        const enabled = this.engine.registry.enablePackage(manifest.id);
        if (enabled) pkg = enabled;
    } else if (requestedEnabled === false) {
        const disabled = this.engine.registry.disablePackage(manifest.id);
        if (disabled) pkg = disabled;
    }

    // Durable persistence to `sys_packages`. Without the `package` service
    // the install stays visible for the process lifetime (the documented
    // degraded path above), never SILENTLY: a skipped persist is a
    // restart-loss, so it leaves a trace.
    //
    // [#21243] WITH the service, a failed persist is the install's failure.
    // Both halves, in this order: the registry write is undone FIRST, so
    // that by the time the caller reads the error nothing in this process
    // claims a package the store refused; then the failure is thrown. The
    // `catch` that used to sit here turned both a thrown and a returned
    // failure into a `console.warn` and an answer of success.
    const pkgSvc = this.packagePersistService();
    if (pkgSvc) {
        const failure = await persistPackageManifest(pkgSvc, manifest);
        if (failure) {
            undoInstall();
            throw packagePersistFailureError(failure.cause, manifest.id, 'install');
        }
    } else {
        console.warn(
            `[protocol.installPackage] no 'package' service — '${manifest?.id}' registered in-memory only (will not survive a restart)`,
        );
    }

    return { package: pkg as any, message: `Installed package: ${manifest?.id}` };
}

/** The body of `ObjectStackProtocolImplementation#updatePackage`; the method's docblock there is its contract. */
export async function updatePackage(
    this: Pick<PackageInstallHost, 'engine' | 'packagePersistService'>,
    request: {
    packageId: string;
    patch: { name?: string; description?: string; version?: string; dependencies?: Record<string, string> };
}): Promise<{ package: any; message: string }> {
    // [#21243] The row as it stood before the patch — copied, because
    // `updatePackageManifest` edits the row and its manifest IN PLACE.
    const prior = snapshotPackageRow(this.engine.registry.getPackage?.(request.packageId));
    const pkg = this.engine.registry.updatePackageManifest(request.packageId, request.patch);
    if (!pkg) {
        throw Object.assign(new Error(`Package '${request.packageId}' not found`), { statusCode: 404 });
    }
    const pkgSvc = this.packagePersistService();
    if (pkgSvc) {
        const failure = await persistPackageManifest(pkgSvc, (pkg as any).manifest);
        if (failure) {
            if (prior) restorePackageRow(pkg, prior);
            throw packagePersistFailureError(failure.cause, request.packageId, 'update');
        }
    } else {
        console.warn(
            `[protocol.updatePackage] no 'package' service — '${request.packageId}' edited in-memory only (will not survive a restart)`,
        );
    }
    return { package: pkg as any, message: `Updated package: ${request.packageId}` };
}

/** The body of `ObjectStackProtocolImplementation#packagePersistService`; the method's docblock there is its contract. */
export function packagePersistService(
    this: Pick<PackageInstallHost, 'getServicesRegistry'>,
    ): PackagePersistService | undefined {
    const svc = this.getServicesRegistry?.()?.get('package') as Partial<PackagePersistService> | undefined;
    return typeof svc?.publish === 'function' ? (svc as PackagePersistService) : undefined;
}

/** The body of `ObjectStackProtocolImplementation#packageInstallUndo`; the method's docblock there is its contract. */
export function packageInstallUndo(
    this: Pick<PackageInstallHost, 'engine'>,
    manifest: { id: string; namespace?: unknown }): () => void {
    const registry = this.engine.registry;
    const priorRow = registry.getPackage?.(manifest.id);
    const namespace = typeof manifest.namespace === 'string' && manifest.namespace !== ''
        ? manifest.namespace
        : undefined;
    const owners = namespace === undefined ? undefined : registry.getNamespaceOwners?.(namespace);
    // An owner list the registry cannot give is no evidence the id did not
    // own the namespace, and releasing one it did own would hand the
    // namespace to the next package that asks.
    const namespaceWasOwned = !Array.isArray(owners) || owners.includes(manifest.id);
    return () => {
        if (priorRow === undefined) {
            registry.unregisterItem('package', manifest.id);
        } else {
            const current = registry.getPackage(manifest.id);
            if (current !== undefined && current !== priorRow) restorePackageRow(current, priorRow);
        }
        if (namespace !== undefined && !namespaceWasOwned) {
            registry.unregisterNamespace(namespace, manifest.id);
        }
    };
}
