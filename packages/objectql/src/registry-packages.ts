// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33949 codemod] The "Package management" section of `SchemaRegistry`: the
 * bodies of `installPackage`, `coOwnersOf`, `refuseCoOwnedObjectNameCollision`,
 * `refuseNamespaceNameConflicts`, `refuseNamespaceObjectNameClashes`,
 * `refuseResidualNamespaceNameConflicts`, `recordResidualNamespaceHolder`,
 * `refuseNamespaceHolderConflicts`, `uninstallPackage`, `getPackage`,
 * `recordResidualOwnerDependencies`, `residualOwnerDependenciesOf`,
 * `getAllPackages`, `enablePackage`, `disablePackage`, `updatePackageManifest`
 * moved out of `registry.ts` whole by
 * the #33949 split codemod (PR #34285, kept in its branch history, not committed).
 *
 * A MOVE, not a redesign. {@link PackagesFacet} is a stateless facet of `SchemaRegistry`
 * (ruling 6624345766): each static method of it is the body of the `SchemaRegistry`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SchemaRegistry`.
 *
 * The bodies reach the class through {@link PackagesHost}: exactly the
 * `SchemaRegistry` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `packagesHost` in
 * `registry-facet-hosts.ts`, built once per registry by the class's static
 * block. Methods go as closures that call them on the registry at call time, so
 * a subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * registry.
 *
 * Values that stayed in `registry.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import { isTenantAuthored } from '@objectstack/metadata-core';
import { InstalledPackageSourceSchema, findNamespaceObjectNameClashes, validateNamespaceNotAddressLiteral } from '@objectstack/spec/kernel';
import type { InstalledPackage, InstalledPackageSource, NamespaceHolder, ObjectNameHolder, ObjectStackManifest } from '@objectstack/spec/kernel';
import { artifactPackageId, declaredDependencyIds } from '@objectstack/core';
import { isNamespaceJudged, namespaceNameConflicts, namespacePackageOf } from './namespace-co-owner-names.js';
import type { NamespacePackage } from './namespace-co-owner-names.js';
import {
  computeFQN, declaredOwnedObjectNames, toRecordManifest, withDeclaredFunctionEntries,
} from './registry-top-level.js';
import type { ArtifactInstallScope, CoOwnershipSource } from './registry-top-level.js';
import {
  ArtifactObjectNameConflictError, NamespaceAddressLiteralError, NamespaceConflictError, NamespaceNameConflictError,
  NamespaceObjectNameConflictError, isShareableNamespace,
} from './registry.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The `SchemaRegistry` members the bodies of {@link PackagesFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface PackagesHost {
  announcePackageEnabled: SchemaRegistry['announcePackageEnabled'];
  announcePackageUninstalled: SchemaRegistry['announcePackageUninstalled'];
  readonly bareNameHoldersSealed: SchemaRegistry['bareNameHoldersSealed'];
  coOwnersOf: SchemaRegistry['coOwnersOf'];
  readonly collisionPolicy: SchemaRegistry['collisionPolicy'];
  debug: SchemaRegistry['debug'];
  forgetBareNameClaims: SchemaRegistry['forgetBareNameClaims'];
  forgetDefaultRecordPageClaims: SchemaRegistry['forgetDefaultRecordPageClaims'];
  forgetSecurityCatalogClaims: SchemaRegistry['forgetSecurityCatalogClaims'];
  getNamespaceOwners: SchemaRegistry['getNamespaceOwners'];
  getObjectOwner: SchemaRegistry['getObjectOwner'];
  getPackage: SchemaRegistry['getPackage'];
  readonly initialDisabledPackageIds: SchemaRegistry['initialDisabledPackageIds'];
  invalidateAll: SchemaRegistry['invalidateAll'];
  isPackageDisabled: SchemaRegistry['isPackageDisabled'];
  listItems: SchemaRegistry['listItems'];
  log: SchemaRegistry['log'];
  readonly metadata: SchemaRegistry['metadata'];
  readonly namespaceRegistry: SchemaRegistry['namespaceRegistry'];
  noteItem: SchemaRegistry['noteItem'];
  noteItemType: SchemaRegistry['noteItemType'];
  readonly objectContributors: SchemaRegistry['objectContributors'];
  readonly packageBodyItems: SchemaRegistry['packageBodyItems'];
  recordBareNameClaims: SchemaRegistry['recordBareNameClaims'];
  recordDefaultRecordPageClaims: SchemaRegistry['recordDefaultRecordPageClaims'];
  recordSecurityCatalogClaims: SchemaRegistry['recordSecurityCatalogClaims'];
  refuseBareNameConflicts: SchemaRegistry['refuseBareNameConflicts'];
  refuseCoOwnedObjectNameCollision: SchemaRegistry['refuseCoOwnedObjectNameCollision'];
  refuseDefaultRecordPageConflicts: SchemaRegistry['refuseDefaultRecordPageConflicts'];
  refuseNamespaceHolderConflicts: SchemaRegistry['refuseNamespaceHolderConflicts'];
  refuseNamespaceNameConflicts: SchemaRegistry['refuseNamespaceNameConflicts'];
  refuseNamespaceObjectNameClashes: SchemaRegistry['refuseNamespaceObjectNameClashes'];
  refuseSecurityCatalogNameConflicts: SchemaRegistry['refuseSecurityCatalogNameConflicts'];
  registerNamespace: SchemaRegistry['registerNamespace'];
  readonly residualNamespaceHolders: SchemaRegistry['residualNamespaceHolders'];
  readonly residualOwnerDependencies: SchemaRegistry['residualOwnerDependencies'];
  setPackageNavContributions: SchemaRegistry['setPackageNavContributions'];
  unregisterItemsByPackage: SchemaRegistry['unregisterItemsByPackage'];
  unregisterNamespace: SchemaRegistry['unregisterNamespace'];
  unregisterObjectsByPackage: SchemaRegistry['unregisterObjectsByPackage'];
  warnAddressLiteralNamespaceOnce: SchemaRegistry['warnAddressLiteralNamespaceOnce'];
}

/** The bodies of the "Package management" section of `SchemaRegistry`: a stateless facet, called by the class's stubs. */
export class PackagesFacet {
  /** The body of `SchemaRegistry#installPackage`; the method's docblock there is its contract. */
  static installPackage(this: Pick<PackagesHost, 'bareNameHoldersSealed' | 'coOwnersOf' | 'collisionPolicy' | 'debug' | 'getNamespaceOwners' | 'getPackage' | 'initialDisabledPackageIds' | 'invalidateAll' | 'isPackageDisabled' | 'log' | 'metadata' | 'noteItem' | 'noteItemType' | 'recordBareNameClaims' | 'recordDefaultRecordPageClaims' | 'recordSecurityCatalogClaims' | 'refuseBareNameConflicts' | 'refuseCoOwnedObjectNameCollision' | 'refuseDefaultRecordPageConflicts' | 'refuseNamespaceNameConflicts' | 'refuseNamespaceObjectNameClashes' | 'refuseSecurityCatalogNameConflicts' | 'registerNamespace' | 'warnAddressLiteralNamespaceOnce'>, manifest: ObjectStackManifest, source: InstalledPackageSource, settings?: Record<string, any>, scope?: ArtifactInstallScope): InstalledPackage {
    // [#23972] `source` is the CALLER's statement of where this package came
    // from — the door that registers it is the only party that knows
    // (`registerApp`: code or marketplace; `installPackage` in
    // `@objectstack/metadata-protocol`, the `POST /packages` fallback and the
    // `sys_packages` rehydrate: authored). The registry records it and never
    // infers it, so an untyped caller that omits it, or spells a value outside
    // the closed set, is refused here — ahead of every check and mutation
    // below, so a refused call leaves no row behind — rather than recording a
    // row the read door would serve without an origin.
    if (!InstalledPackageSourceSchema.safeParse(source).success) {
      throw new TypeError(
        `[Registry] installPackage('${String(manifest?.id)}') needs the package's source, one of `
        + `${InstalledPackageSourceSchema.options.map((v) => `'${v}'`).join(' | ')}; received `
        + `${source === undefined ? 'none' : JSON.stringify(source)}. The door that registers a package `
        + `states where it came from; the registry does not guess.`,
      );
    }
    // [ADR-0130 D1] The co-owners of this package — the OTHER packages the same
    // release artifact is delivering. Computed once and read by both halves of
    // the install-time pair below, so the relaxation and the refusal cannot
    // disagree about who counts as a co-owner.
    //
    // Everything inside one artifact is built, versioned, downloaded and
    // installed as one atomic act by one publisher, and D1 makes that joint
    // delivery the ownership proof itself — nothing else asserts it, and D8
    // deliberately adds no manifest field that could drift from it.
    //
    // The self-exclusion is by the SAME key the registry installs under
    // ({@link artifactPackageId}), not by `manifest.id` alone: a manifest
    // carrying only `name` is installed under that name, and a co-owner set
    // that still contained it would let the package "co-own" with itself.
    //
    // [ADR-0141 D5] …and, beside the artifact, the packages a declared
    // dependency makes co-owners of the namespace — see {@link coOwnersOf}.
    const selfId = artifactPackageId(manifest);
    const coOwners = this.coOwnersOf(manifest, selfId, scope);

    // ADR-0048 Phase 1 — install-time namespace gate. Refuse a package whose
    // namespace is already owned by an installed package that is not a co-owner
    // of it; this is the constraint the object/table layer enforces implicitly
    // (a duplicate `CREATE TABLE <ns>_<obj>` fails at the DB), made explicit and
    // early. Same-package reinstall/reload is excluded (owner === manifest.id),
    // shareable platform namespaces (base/system/sys) are exempt, and — since
    // ADR-0130 D1 — so is a co-owner delivered by the same artifact.
    //
    // ⛔ This relaxation may not exist without the object-name check below it.
    // Namespace exclusivity has been silently proxying for "no two packages
    // define the same object name" (ADR-0048 §3.2's own grounding), so dropping
    // the proxy alone is the one path in ADR-0130 that can damage customer data.
    // ADR-0130 D3 states the pair as a machine constraint for that reason, and
    // `registry-artifact-co-ownership.test.ts` asserts it as ONE proposition.
    if (manifest.namespace && !isShareableNamespace(manifest.namespace)) {
      const conflictOwner = this.getNamespaceOwners(manifest.namespace).find(
        (owner) => owner !== manifest.id && !coOwners.has(owner),
      );
      if (conflictOwner) {
        if (this.collisionPolicy === 'warn') {
          console.warn(
            `[Registry] Namespace conflict (downgraded to warning via ` +
              `OS_METADATA_COLLISION=warn): namespace "${manifest.namespace}" is ` +
              `already owned by "${conflictOwner}"; installing "${manifest.id}" ` +
              `anyway. See ADR-0048.`,
          );
        } else {
          throw new NamespaceConflictError(manifest.namespace, conflictOwner, manifest.id);
        }
      }
    }

    // [ADR-0130 D3] The other half of the pair: per-object-name uniqueness
    // across the co-owners of one artifact, install-time and ahead of any DDL.
    // Placed ahead of EVERY mutation this method makes, so a refused package
    // leaves no record, no namespace ownership and no half-applied install
    // behind — the same disposition the namespace gate above has.
    this.refuseCoOwnedObjectNameCollision(manifest, selfId, coOwners);

    // [ADR-0150 D2, child N] The object rule above, extended to the twelve
    // bucket 2/3 types phase 1 does not cover: inside one namespace, a
    // `(type, name)` has one package holder, so that NAMESPACE/NAME names one
    // item (`namespace-co-owner-names.ts`). Ahead of every mutation, like the
    // check above; at every install, boot included, like it; with no
    // `collisionPolicy` downgrade, like the bare-name rule below.
    this.refuseNamespaceNameConflicts(manifest);

    // [ADR-0150 D5, child G1] A namespace never spells a literal segment of
    // the REST address grammar: the router reads the literal first, so the
    // package's qualified addresses would reach another door. Ahead of every
    // mutation, with no `collisionPolicy` downgrade — at the running install
    // door only.
    //
    // A package the boot registers keeps booting: no release before this rule
    // refused one, and what the literal costs it is its qualified path alone,
    // which never existed before the rule did. Two readings name it, the
    // bare-name rule's (`refuseBareNameConflicts`): until the cold boot seals
    // the holders, every package registering is one the deployment holds
    // (installed, or shipped in its code); after it, a package already
    // registered under its own id AND the same namespace is a reload, a
    // re-install or an upgrade (the namespace gate's same-package reading
    // above). An upgrade that MOVES to a literal namespace is a new occupation
    // of it and is refused. A held package is warned once and installs; it is
    // read by `?package=`.
    {
      const literalRefusal = validateNamespaceNotAddressLiteral(manifest.namespace);
      if (literalRefusal) {
        const packageId = selfId ?? manifest.id;
        const alreadyHeld = !this.bareNameHoldersSealed
          || this.getPackage(packageId)?.manifest?.namespace === manifest.namespace;
        if (!alreadyHeld) {
          throw new NamespaceAddressLiteralError(manifest.namespace as string, literalRefusal, packageId);
        }
        this.warnAddressLiteralNamespaceOnce(packageId, literalRefusal);
      }
    }

    // [ADR-0150 D6, child K] A namespace never equals an object name, in
    // either direction, and no object is short-named `custom` — the spec's one
    // predicate, against what the environment already holds. Ahead of every
    // mutation, at every install, boot included, with no `collisionPolicy`
    // downgrade, like the check above.
    this.refuseNamespaceObjectNameClashes(manifest, selfId);

    // The security catalog's one-name-one-holder rule (ADR-0048 §3.4 narrowed
    // for positions, permission sets and capabilities; maintainer ruling Q4 = A
    // on #15196) — also ahead of every mutation, for the same reason. No
    // co-owner exemption: two packages of one artifact sharing a catalog name
    // are as ambiguous to a bare-name assignment as two strangers are, and no
    // `collisionPolicy` downgrade (`security-catalog-namespace.ts`).
    this.refuseSecurityCatalogNameConflicts(manifest, selfId);

    // One default record page per object per deployment (maintainer ruling A
    // on objectstack#23015; `default-record-page.ts`) — also ahead of every
    // mutation, for the same reason. No co-owner exemption and no
    // `collisionPolicy` downgrade: two packages of one artifact shipping a
    // default for one object leave the record view to registration order
    // exactly as two strangers do.
    this.refuseDefaultRecordPageConflicts(manifest, selfId);

    // One name, one package holder for the bare-name types — a picklist, a
    // mapping, a dataset, an API, an object-less action, a flow, a webhook, a
    // connector, an email template: the names their consumers resolve with no
    // package (ADR-0048 §3.4 narrowed; maintainer ruling C on #30798, phase 1;
    // `bare-name-one-holder.ts`). Also ahead of every mutation, with no
    // co-owner exemption and no `collisionPolicy` downgrade, for the security
    // catalog's reasons. Judged only once the cold boot has sealed the holders:
    // during a boot every package registers again, and a deployment that
    // already holds a clash is the cold boot's to report.
    this.refuseBareNameConflicts(manifest, selfId);

    const now = new Date().toISOString();

    // [#18877] 「缺省 = 保持，有旗 = 设置」 — an install that was not asked to move
    // the lifecycle state does not move it. The install verb carries no
    // lifecycle argument at all, so at THIS layer every install is
    // 「缺省」 and the whole rule is: an EXISTING row keeps its own
    // `enabled` / `status` / `statusChangedAt`, and the boot seed decides only
    // for an id that has no row yet. The door above is where 「有旗」 is spelled
    // (`enableOnInstall` ⇒ `enablePackage` / `disablePackage`,
    // `packages/runtime/src/domains/packages.ts`).
    //
    // ⚠️ The seed set is a BOOT HYDRATION input, not a standing verdict. It is
    // filled once, before any registration, from the durable disable file
    // (`AppPlugin.seedPersistedDisabledPackages`) and no lifecycle verb updates
    // it. Consulting it on every install is what made the most recent explicit
    // operator action revertible by an unrelated re-install: disable → restart
    // → `PATCH /packages/:id/enable` (200, registry true, disk cleared) →
    // flag-absent `install(m, { overwrite: true })` → the seed still listed the
    // id → the row landed disabled again, and since #18752 the disk follows the
    // row, so the enable was gone after the next restart with no error
    // anywhere. Reading the ROW first is what makes the seed's answer
    // unreachable once a row exists — and a row always exists by the time an
    // operator can have acted on it.
    const existing = this.getPackage(manifest.id);
    const seeded = this.initialDisabledPackageIds.has(manifest.id);
    const lifecycle: Pick<InstalledPackage, 'status' | 'enabled' | 'statusChangedAt'> = existing
      ? {
          status: existing.status,
          enabled: existing.enabled,
          // Carried, never restamped: `statusChangedAt` answers "when did an
          // operator last move this package", and a re-install is not such a
          // move. A row that never carried one still does not.
          ...(existing.statusChangedAt !== undefined
            ? { statusChangedAt: existing.statusChangedAt }
            : {}),
        }
      : {
          status: seeded ? 'disabled' : 'installed',
          enabled: !seeded,
          ...(seeded ? { statusChangedAt: now } : {}),
        };

    const pkg: InstalledPackage = {
      // The RECORD's manifest, not the caller's live object — see
      // {@link toRecordManifest}. Every other read below (`manifest.id`,
      // `manifest.namespace`) deliberately keeps reading the ARGUMENT: the
      // projection is what the registry hands out, never what it decides with.
      //
      // {@link withDeclaredFunctionEntries} runs FIRST and at this boundary
      // only: it makes the two authored `functions` spellings structurally
      // equal so the structural projection reports BOTH, without teaching the
      // projection a key name.
      manifest: toRecordManifest(withDeclaredFunctionEntries(manifest)),
      source,
      ...lifecycle,
      installedAt: now,
      updatedAt: now,
      settings,
    };
    
    // Register namespace if present
    if (manifest.namespace) {
      this.registerNamespace(manifest.namespace, manifest.id);
    }
    
    this.noteItemType('package');
    if (!this.metadata.has('package')) {
      this.metadata.set('package', new Map());
    }
    const collection = this.metadata.get('package')!;
    if (collection.has(manifest.id)) {
      // Re-install of an already-registered package manifest (rebuild / HMR) is
      // a normal path, not an error — keep it at debug (#3420).
      this.debug(`[Registry] Overwriting package: ${manifest.id}`);
    }
    this.noteItem('package', manifest.id);
    collection.set(manifest.id, pkg);
    // A row that lands disabled withholds the package's `extend` contributions
    // from every served fold ({@link withholdDisabledExtensions}), and a fold
    // cached before the row existed read it as enabled.
    if (this.isPackageDisabled(manifest.id)) this.invalidateAll();
    // The names this package now holds, recorded whether or not an item store
    // entry will carry them (see `securityCatalogClaims`).
    if (selfId !== undefined) this.recordSecurityCatalogClaims(selfId, manifest);
    // …and the default record pages it declares (see `defaultRecordPageClaims`).
    if (selfId !== undefined) this.recordDefaultRecordPageClaims(selfId, manifest);
    // …and its bare names of the covered types (see `bareNameClaims`).
    if (selfId !== undefined) this.recordBareNameClaims(selfId, manifest);
    this.log(`[Registry] Installed package: ${manifest.id} (${manifest.name})`);
    return pkg;
  }

  /**
   * The co-owners of the incoming package's namespace, each with the source
   * that makes it one. Both halves of the install-time pair read this one map,
   * so the namespace relaxation and the object-name refusal cannot disagree
   * about who counts.
   *
   * Two sources:
   *
   * - **`artifact`** (ADR-0130 D1) — the other packages the same release
   *   artifact is delivering, as the load path's scope names them.
   * - **a declared dependency** (ADR-0141 D5) — for a non-shareable namespace
   *   N the incoming package P uses:
   *   - `dependency`: P declares an installed X whose namespace is N; or a
   *     sitting owner of N declares P. The relation is declared by the
   *     dependent alone and read from either end, so the parent registering
   *     second — an upgrade, or a boot that hydrated the module first — meets
   *     its module as a co-owner instead of `NAMESPACE_CONFLICT`.
   *   - `sibling`: a sitting owner S of N and P each directly declare one
   *     installed package Q whose namespace is N — two modules under one
   *     declared parent, neither declaring the other.
   *
   * Direct declarations only, never the closure the save door walks. Q's
   * namespace is read from Q's installed record: ⛔ two packages that merely
   * declare one common package co-own nothing unless that package is installed
   * and holds N, or any two packages sharing a utility dependency could share a
   * namespace. Nothing is persisted: the relation is the declarations of the
   * packages the registry holds now.
   */
  static coOwnersOf(this: Pick<PackagesHost, 'getNamespaceOwners' | 'getPackage'>, manifest: ObjectStackManifest, selfId: string | undefined, scope: ArtifactInstallScope | undefined): Map<string, CoOwnershipSource> {
    const coOwners = new Map<string, CoOwnershipSource>();
    for (const id of scope?.packageIds ?? []) if (id !== selfId) coOwners.set(id, 'artifact');

    const namespace = manifest.namespace;
    if (!namespace || isShareableNamespace(namespace) || selfId === undefined) return coOwners;

    const holdsNamespace = (id: string) => this.getPackage(id)?.manifest?.namespace === namespace;
    // P's declared parents that hold N — the parent arm from P's side, and the
    // Q set the sibling arm matches against.
    const parents = new Set(declaredDependencyIds(manifest).filter((id) => id !== selfId && holdsNamespace(id)));
    for (const id of parents) if (!coOwners.has(id)) coOwners.set(id, 'dependency');

    for (const owner of this.getNamespaceOwners(namespace)) {
      if (owner === selfId || coOwners.has(owner)) continue;
      const declaredByOwner = declaredDependencyIds(this.getPackage(owner)?.manifest);
      if (declaredByOwner.includes(selfId)) coOwners.set(owner, 'dependency');
      else if (declaredByOwner.some((id) => parents.has(id))) coOwners.set(owner, 'sibling');
    }
    return coOwners;
  }

  /**
   * [ADR-0130 D3] Refuse an install in which a CO-OWNER of the incoming package
   * — a package delivered by the same release artifact — already owns an object
   * name the incoming package claims.
   *
   * ## Why the refusal is scoped to co-owners
   *
   * It is exactly the surface D1 opened. Before D1 the namespace gate refused
   * two packages sharing a namespace outright, and that refusal was doing this
   * job by proxy; a name claimed by a package from a DIFFERENT artifact is still
   * that gate's business and still refused there. So this check adds no refusal
   * the platform did not already make in some form — per #14122 §6.2 it can only
   * reject a configuration that would have failed at the DB anyway, earlier and
   * more legibly — while the co-owner case, which D1 has just admitted, is the
   * one that would otherwise reach the DB unchecked.
   *
   * ## One resolution, shared with the read path
   *
   * The name is resolved through {@link computeFQN} — the same call
   * `registerObject` makes on the very definitions this manifest is about to
   * register — rather than by a private spelling. A gate that resolved names its
   * own way could refuse an entry `registerObject` would have accepted under a
   * different key, or wave through the one it would have refused.
   *
   * ## The one carve-out
   *
   * A tenant-authored sitting owner is skipped, because `registerObject`'s
   * late-install path (ADR-0029 D9 §6.1) does not refuse that case either: a
   * code package that ships a name a `sys_metadata` row already holds TAKES
   * ownership and re-classifies the tenant contribution as its overlay. Refusing
   * here would break an install the very next call would have completed.
   *
   * @throws {ArtifactObjectNameConflictError} ADR-0112 envelope, naming both
   *   packages and the object.
   */
  static refuseCoOwnedObjectNameCollision(this: Pick<PackagesHost, 'getObjectOwner'>, manifest: ObjectStackManifest, selfId: string | undefined, coOwners: ReadonlyMap<string, CoOwnershipSource>): void {
    // No artifact scope, or an artifact carrying one package: nothing this
    // method can refuse. Stated as an early return rather than left to fall out
    // of the loop, because "the single-package path is untouched" (D7) is a
    // property of this code, not a coincidence of its inputs.
    if (coOwners.size === 0) return;

    for (const shortName of declaredOwnedObjectNames(manifest)) {
      const fqn = computeFQN(manifest.namespace, shortName);
      const owner = this.getObjectOwner(fqn);
      const ownerId = owner?.packageId;
      if (owner === undefined || ownerId === undefined || ownerId === selfId) continue;
      // Not a co-owner: a cross-artifact claim, which the namespace gate above
      // owns and refuses. ⛔ Not widened here — that would be a new refusal for
      // configurations D1 never admitted, outside this card and outside D3.
      if (!coOwners.has(ownerId)) continue;
      if (isTenantAuthored(owner.definition)) continue;
      throw new ArtifactObjectNameConflictError(fqn, ownerId, selfId ?? manifest.id, coOwners.get(ownerId));
    }
  }

  /**
   * [ADR-0150 D2, child N] Refuse an install whose package declares an item of
   * a covered type under a name another installed package of its namespace
   * already holds (`namespace-co-owner-names.ts`).
   *
   * The sitting holders are the installed package records — their manifests,
   * as {@link installPackage} recorded them — of the incoming package's
   * namespace: the record is the one place every door's install lands, so an
   * uninstall takes its names with it and nothing else is kept. The same
   * package's own record is never a second holder (a reload, a re-install or
   * an upgrade).
   *
   * @throws {NamespaceNameConflictError} ADR-0112 envelope, naming every holder.
   */
  static refuseNamespaceNameConflicts(this: Pick<PackagesHost, 'refuseNamespaceHolderConflicts'>, manifest: ObjectStackManifest): void {
    this.refuseNamespaceHolderConflicts(namespacePackageOf(manifest));
  }

  /**
   * [ADR-0150 D6, child K] Refuse an install whose namespace equals an object
   * name the environment holds or the package itself ships, whose object name
   * equals an installed namespace, or whose object is short-named `custom`
   * (`findNamespaceObjectNameClashes`, `@objectstack/spec/kernel`).
   *
   * The incoming side is the package's namespace and the objects it ships
   * (`manifest.objects` and each nested `plugins[]` entry's, the objects
   * `registerApp` registers under it). The installed side is every namespace
   * the namespace gate has recorded and every object the registry holds,
   * minus what this same package already holds (a reload, a re-install or an
   * upgrade is never its own clash). A clash already present between two
   * installed holders is not this install's to report.
   *
   * @throws {NamespaceObjectNameConflictError} ADR-0112 envelope, every clash named.
   */
  static refuseNamespaceObjectNameClashes(this: Pick<PackagesHost, 'getObjectOwner' | 'namespaceRegistry' | 'objectContributors'>, manifest: ObjectStackManifest, selfId: string | undefined): void {
    const incomingId = selfId ?? manifest.id;
    const isSelf = (packageId: string | undefined): boolean =>
      packageId !== undefined && (packageId === incomingId || packageId === manifest.id);
    const namespace = typeof manifest.namespace === 'string' && manifest.namespace !== '' ? manifest.namespace : undefined;

    const incomingObjects: ObjectNameHolder[] = [];
    const seen = new Set<string>();
    const shipped = (body: ObjectStackManifest): void => {
      for (const shortName of declaredOwnedObjectNames(body)) {
        const name = computeFQN(namespace, shortName);
        if (seen.has(name)) continue;
        seen.add(name);
        incomingObjects.push({ name, ...(namespace ? { namespace } : {}), ...(incomingId ? { packageId: incomingId } : {}) });
      }
    };
    shipped(manifest);
    const plugins = (manifest as { plugins?: unknown }).plugins;
    if (Array.isArray(plugins)) {
      for (const plugin of plugins) if (plugin && typeof plugin === 'object') shipped(plugin as ObjectStackManifest);
    }

    const installedNamespaces: NamespaceHolder[] = [];
    for (const [ns, owners] of this.namespaceRegistry) {
      for (const owner of owners) if (!isSelf(owner)) installedNamespaces.push({ namespace: ns, packageId: owner });
    }
    const installedObjects: ObjectNameHolder[] = [];
    for (const fqn of this.objectContributors.keys()) {
      const ownerId = this.getObjectOwner(fqn)?.packageId;
      if (isSelf(ownerId) || seen.has(fqn)) continue;
      installedObjects.push({ name: fqn, ...(ownerId ? { packageId: ownerId } : {}) });
    }

    const clashes = findNamespaceObjectNameClashes(
      { namespaces: namespace ? [{ namespace, ...(incomingId ? { packageId: incomingId } : {}) }] : [], objects: incomingObjects },
      { namespaces: installedNamespaces, objects: installedObjects },
    );
    if (clashes.length > 0) throw new NamespaceObjectNameConflictError(clashes, incomingId ?? '(unnamed package)');
  }

  /** The body of `SchemaRegistry#refuseResidualNamespaceNameConflicts`; the method's docblock there is its contract. */
  static refuseResidualNamespaceNameConflicts(this: Pick<PackagesHost, 'refuseNamespaceHolderConflicts'>, residual: NamespacePackage | undefined): void {
    this.refuseNamespaceHolderConflicts(residual);
  }

  /** The body of `SchemaRegistry#recordResidualNamespaceHolder`; the method's docblock there is its contract. */
  static recordResidualNamespaceHolder(this: Pick<PackagesHost, 'residualNamespaceHolders'>, residual: NamespacePackage | undefined): void {
    if (residual === undefined || !isNamespaceJudged(residual.namespace)) return;
    this.residualNamespaceHolders.set(residual.packageId, residual);
  }

  /**
   * The one walk both refusals above share: `incoming` against every installed
   * package record of its namespace and every recorded residual holder of it,
   * read through the same predicate, thrown in one envelope.
   */
  static refuseNamespaceHolderConflicts(this: Pick<PackagesHost, 'metadata' | 'residualNamespaceHolders'>, incoming: NamespacePackage | undefined): void {
    if (incoming === undefined || !isNamespaceJudged(incoming.namespace) || incoming.names.length === 0) return;
    const sitting: NamespacePackage[] = [];
    for (const record of this.metadata.get('package')?.values() ?? []) {
      const recorded = (record as InstalledPackage | undefined)?.manifest;
      if (recorded?.namespace !== incoming.namespace) continue;
      const holder = namespacePackageOf(recorded);
      if (holder !== undefined) sitting.push(holder);
    }
    for (const residual of this.residualNamespaceHolders.values()) {
      if (residual.namespace === incoming.namespace) sitting.push(residual);
    }
    const conflicts = namespaceNameConflicts(incoming, sitting);
    if (conflicts.length > 0) throw new NamespaceNameConflictError(conflicts);
  }

  /** The body of `SchemaRegistry#uninstallPackage`; the method's docblock there is its contract. */
  static uninstallPackage(this: Pick<PackagesHost, 'announcePackageUninstalled' | 'forgetBareNameClaims' | 'forgetDefaultRecordPageClaims' | 'forgetSecurityCatalogClaims' | 'getPackage' | 'initialDisabledPackageIds' | 'invalidateAll' | 'isPackageDisabled' | 'log' | 'metadata' | 'packageBodyItems' | 'residualNamespaceHolders' | 'setPackageNavContributions' | 'unregisterItemsByPackage' | 'unregisterNamespace' | 'unregisterObjectsByPackage'>, id: string, options?: { keepBootSeed?: boolean }): boolean {
    const pkg = this.getPackage(id);
    if (!pkg) {
      console.warn(`[Registry] Package not found for uninstall: ${id}`);
      return false;
    }

    // [#7970] Unregister objects FIRST — this is the one step that can REFUSE
    // (ADR-0029: the package owns an object another package `extend`s), so
    // every mutation below is downstream of the refusal point and a refused
    // uninstall removes nothing at all. The namespace release used to sit
    // ABOVE this line, which meant reaching the guard that exists to keep a
    // registry whole cost the namespace on the way in: the package stayed
    // installed with its objects and its record intact, while its namespace no
    // longer resolved, for the life of the process. Safe as the first step
    // because the verb reads `objectContributors` only — it depends on nothing
    // the steps below establish.
    this.unregisterObjectsByPackage(id);

    // Unregister namespace
    if (pkg.manifest.namespace) {
      this.unregisterNamespace(pkg.manifest.namespace, id);
    }

    // [#7221] …and everything else the package shipped. The object verb above
    // reaches `objectContributors` only, so without this an uninstall dropped
    // the package record while its `page`/`view`/`flow`/`app`/`api` entries
    // stayed resolvable through `getItem`/`listItems` for the life of the
    // process. Runs AFTER the object verb because that one can refuse
    // (ADR-0029 extenders): a refused uninstall must remove nothing at all.
    this.unregisterItemsByPackage(id);
    // …and the security catalog names it held, so an uninstalled package's
    // names are free for the next package to declare.
    this.forgetSecurityCatalogClaims(id);
    // …and the default record pages it declared, so the next package may
    // declare a default for those objects.
    this.forgetDefaultRecordPageClaims(id);
    // …and its bare names of the covered types.
    this.forgetBareNameClaims(id);
    // [#33050] …and the record of what its body shipped: a later install of
    // the id is a first registration, with nothing of its own to withdraw.
    this.packageBodyItems.delete(id);
    // [#31720] …and the namespace names a stack's residual holds under this
    // id: the residual's items are registered under their owner id, so
    // `unregisterItemsByPackage(id)` above has just withdrawn them (the
    // owner id is one of the stack's own bodies in the `preserve` shape).
    this.residualNamespaceHolders.delete(id);
    // [#30581] …and the navigation entries it put into other packages' apps:
    // with no row left, the fold's disabled check cannot withhold them.
    this.setPackageNavContributions(id, []);

    // [#18877] The boot seed forgets the id together with the row. A package
    // that no longer exists has no lifecycle state to preserve, so the next
    // install of this id must be a FRESH install — and without this line the
    // seed would outlive the row and re-disable it, which is exactly the
    // 「听不见的持久回退」 this card removed from the install path. Runs with the
    // record removal below rather than at the top: every mutation here is
    // downstream of `unregisterObjectsByPackage`, the one step that can REFUSE
    // (ADR-0029), so a refused uninstall still removes nothing at all.
    if (options?.keepBootSeed !== true) this.initialDisabledPackageIds.delete(id);

    // [#28877] A disabled package's objects and flows withheld other packages'
    // actions ({@link isActionWithheldByDisabledPackage}); with the record gone
    // nothing is disabled, so every cached fold is re-derived.
    if (this.isPackageDisabled(id)) this.invalidateAll();

    // Remove package record
    const collection = this.metadata.get('package');
    if (collection) {
      collection.delete(id);
      this.log(`[Registry] Uninstalled package: ${id}`);
      // …and, last, whoever keeps its own state keyed by this package's id
      // (the engine's manifest map) drops it, on every uninstall door at once.
      this.announcePackageUninstalled(id);
      return true;
    }
    return false;
  }

  /** The body of `SchemaRegistry#getPackage`; the method's docblock there is its contract. */
  static getPackage(this: Pick<PackagesHost, 'metadata'>, id: string): InstalledPackage | undefined {
    return this.metadata.get('package')?.get(id) as InstalledPackage | undefined;
  }

  /** The body of `SchemaRegistry#recordResidualOwnerDependencies`; the method's docblock there is its contract. */
  static recordResidualOwnerDependencies(this: Pick<PackagesHost, 'residualOwnerDependencies'>, ownerId: string, dependencies: readonly string[]): void {
    this.residualOwnerDependencies.set(ownerId, Object.freeze([...dependencies]));
  }

  /** The body of `SchemaRegistry#residualOwnerDependenciesOf`; the method's docblock there is its contract. */
  static residualOwnerDependenciesOf(this: Pick<PackagesHost, 'residualOwnerDependencies'>, id: string): readonly string[] | undefined {
    return this.residualOwnerDependencies.get(id);
  }

  /** The body of `SchemaRegistry#getAllPackages`; the method's docblock there is its contract. */
  static getAllPackages(this: Pick<PackagesHost, 'listItems'>): InstalledPackage[] {
    return this.listItems<InstalledPackage>('package');
  }

  /** The body of `SchemaRegistry#enablePackage`; the method's docblock there is its contract. */
  static enablePackage(this: Pick<PackagesHost, 'announcePackageEnabled' | 'getPackage' | 'invalidateAll' | 'isPackageDisabled' | 'log'>, id: string): InstalledPackage | undefined {
    const pkg = this.getPackage(id);
    if (pkg) {
      const wasDisabled = this.isPackageDisabled(id);
      pkg.enabled = true;
      pkg.status = 'installed';
      pkg.statusChangedAt = new Date().toISOString();
      pkg.updatedAt = new Date().toISOString();
      this.log(`[Registry] Enabled package: ${id}`);
      // [#24400] A disabled package's bound actions are not attached
      // ({@link boundCodeActions}), so every object's fold is re-derived.
      this.invalidateAll();
      if (wasDisabled) this.announcePackageEnabled(id);
    }
    return pkg;
  }

  /** The body of `SchemaRegistry#disablePackage`; the method's docblock there is its contract. */
  static disablePackage(this: Pick<PackagesHost, 'getPackage' | 'invalidateAll' | 'log'>, id: string): InstalledPackage | undefined {
    const pkg = this.getPackage(id);
    if (pkg) {
      pkg.enabled = false;
      pkg.status = 'disabled';
      pkg.statusChangedAt = new Date().toISOString();
      pkg.updatedAt = new Date().toISOString();
      this.log(`[Registry] Disabled package: ${id}`);
      // [#24400] A disabled package's bound actions are not attached
      // ({@link boundCodeActions}), so every object's fold is re-derived.
      this.invalidateAll();
    }
    return pkg;
  }

  /** The body of `SchemaRegistry#updatePackageManifest`; the method's docblock there is its contract. */
  static updatePackageManifest(this: Pick<PackagesHost, 'getPackage' | 'log'>, id: string, patch: { name?: string; description?: string; version?: string; dependencies?: Record<string, string> }): InstalledPackage | undefined {
    const pkg = this.getPackage(id);
    if (!pkg) return undefined;
    const manifest = pkg.manifest as Record<string, unknown>;
    if (patch.name !== undefined) manifest.name = patch.name;
    if (patch.description !== undefined) manifest.description = patch.description;
    if (patch.version !== undefined) manifest.version = patch.version;
    if (patch.dependencies !== undefined) manifest.dependencies = { ...patch.dependencies };
    pkg.updatedAt = new Date().toISOString();
    this.log(`[Registry] Updated package manifest: ${id}`);
    return pkg;
  }
}
