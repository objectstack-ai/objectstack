// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33949 codemod] The "Object registration (ownership model)" section of
 * `SchemaRegistry`: the bodies of `objectRegistrationRefusal`,
 * `judgeRegistrationDoors`, `recordCurrencyFollowRefusalOf`,
 * `servedFoldWithLayer`, `followDoorSlotPriority`, `registerObject`,
 * `resolveObject`, `getStorageObject`, `getAllStorageObjects`,
 * `resolveStorageObject`, `withholdDisabledExtensions`,
 * `resolveObjectLeavingExtensionsOut`, `foldExtenders`,
 * `foldExtendersOntoDefinition`, `reportRedeclaredFields`,
 * `reportFieldPatchMisses`, `withoutExtensionQueueField`, `finishServedObject`,
 * `attachBoundActions`, `boundServedActions`, `boundCodeActions`,
 * `findUnboundActionTargets`, `tenantAuthoredScalars`,
 * `tenantPatchedDisplayKeys`, `tenantRuleSettings`, `withPackagedOwnerRules`,
 * `packagedRules`, `tenantRuleCopyRefusal`, `reportChangedRuleCopies`,
 * `foldObjectExtendersOnto`, `materializeBaseLayer`,
 * `materializeServedObjectOnto`, `declinedBaseLayerStamps`,
 * `provisionSearchCompanionOnto`, `stripProvisionedSearchCompanionFrom`,
 * `stripMaterializedStampsFrom` moved out of `registry.ts` whole by
 * the #33949 split codemod (PR #34285, kept in its branch history, not committed).
 *
 * A MOVE, not a redesign. {@link ObjectRegistrationFacet} is a stateless facet of `SchemaRegistry`
 * (ruling 6624345766): each static method of it is the body of the `SchemaRegistry`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SchemaRegistry`.
 *
 * The bodies reach the class through {@link ObjectRegistrationHost}: exactly
 * the `SchemaRegistry` members they read, private ones included. Every stub
 * hands its body, by a `.call`, the same host: `objectRegistrationHost` in
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

import { BASE_FIELD_DISPLAY_WHITELIST, isInjectedColumnDefinition, materializeTreeSelfReferences, provisionPrimary, resolveInjectedSystemColumns } from '@objectstack/spec/data';
import type { ObjectOwnership, ServiceObject } from '@objectstack/spec/data';
import { QUEUE_FIELD_DEF, applyAuditFieldGovernance, fieldPatchTargetMisses, isCodeArtifactBody, isTenantAuthored } from '@objectstack/metadata-core';
import type { FieldPatchTargetMiss } from '@objectstack/metadata-core';
import { scalarOverridesPackagedBase } from '@objectstack/spec/system';
import { SEARCH_COMPANION_FIELD, provisionSearchCompanion } from './search-companion.js';
import { applyExtensionPlacements, fieldGroupKeysOf, placementContributorsOf } from './registry-extension-placement.js';
import type { ExtensionPlacementNote } from './registry-extension-placement.js';
import { applyProtection } from '@objectstack/spec/shared';
import { isObjectLessActionKey, standaloneActionOwnerKey } from './action-governance.js';
import { recordCurrencyFollowRefusal, recordCurrencySummaryRefusal } from './record-currency-aggregate-door.js';
import { recordUnitSummaryRefusal } from './record-unit-aggregate-door.js';
import type { RecordCurrencyFollowRefusedError } from './record-currency-aggregate-door.js';
import {
  DEFAULT_EXTENDER_PRIORITY, DEFAULT_OVERLAY_PRIORITY, DEFAULT_OWNER_PRIORITY, NO_PACKAGE_REFERRER,
  OBJECT_FOLD_SCALAR_KEYS, QUEUE_FIELD, admittedFieldPatches, changedPackagedRuleKeys, computeFQN,
  displayKeyOverridesPackagedBase, fieldNamesOf, fieldPatchYieldKey, indexKeysOf, isLeftOutExtension,
  isPackagelessActionSlotKey, isPlainRecord, leavesExtensionsOut, mergeValidationsByName, optionByValue,
  ownFieldNamesOf, ownFieldsTarget, parseOverlaySlotKey, parsePackageObjectActions, picklistReferrerOf,
  reconcileManagedApiMethods, recordFieldOf, ruleNamesOf, sortActionsByOrder, stableStringify, storedRowPackageOf,
  tenantRuleSettingsOf, validationRuleName, warnFunctionalCompleteness, warnStrippedLegacyApiMethods,
  withTenantRuleSettings, withoutWithheldMembers,
} from './registry-top-level.js';
import type {
  BundleEntry, FoldedExtensionFields, FollowDoorLayer, ObjectContributor, ObjectExtensionBody,
  ObjectExtensionFoldOptions, ObjectFoldScalarKey, PicklistReferrer, ServedObjectLayer, TenantRuleSettings,
  UnboundActionTarget, WithheldExtensions,
} from './registry-top-level.js';
import {
  ObjectOwnershipConflictError, ValidationRuleCopyRefusedError, applySystemFields, extendContributionRefusal,
  mergeObjectDefinitions, objectFieldTypeRefusal, objectQueueColumnRefusal, provisionTenantScopeIndex,
} from './registry.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The `SchemaRegistry` members the bodies of {@link ObjectRegistrationFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface ObjectRegistrationHost {
  _objectRevision: SchemaRegistry['_objectRevision'];
  applyDeploymentTenancy: SchemaRegistry['applyDeploymentTenancy'];
  attachBoundActions: SchemaRegistry['attachBoundActions'];
  readonly bareNameHoldersAreSealed: SchemaRegistry['bareNameHoldersAreSealed'];
  boundCodeActions: SchemaRegistry['boundCodeActions'];
  boundServedActions: SchemaRegistry['boundServedActions'];
  debug: SchemaRegistry['debug'];
  declinedBaseLayerStamps: SchemaRegistry['declinedBaseLayerStamps'];
  readonly deploymentPlatformGlobalObjects: SchemaRegistry['deploymentPlatformGlobalObjects'];
  extensionTargetKey: SchemaRegistry['extensionTargetKey'];
  readonly extensionPlacementNotesWarned: SchemaRegistry['extensionPlacementNotesWarned'];
  readonly fieldPatchMissesWarned: SchemaRegistry['fieldPatchMissesWarned'];
  finishServedObject: SchemaRegistry['finishServedObject'];
  foldExtenders: SchemaRegistry['foldExtenders'];
  foldExtendersOntoDefinition: SchemaRegistry['foldExtendersOntoDefinition'];
  followDoorSlotPriority: SchemaRegistry['followDoorSlotPriority'];
  getAllObjects: SchemaRegistry['getAllObjects'];
  getObject: SchemaRegistry['getObject'];
  getObjectContributors: SchemaRegistry['getObjectContributors'];
  getObjectOwner: SchemaRegistry['getObjectOwner'];
  hasDisabledPackage: SchemaRegistry['hasDisabledPackage'];
  isActionWithheldByDisabledPackage: SchemaRegistry['isActionWithheldByDisabledPackage'];
  isPackageDisabled: SchemaRegistry['isPackageDisabled'];
  judgeRegistrationDoors: SchemaRegistry['judgeRegistrationDoors'];
  log: SchemaRegistry['log'];
  materializeBaseLayer: SchemaRegistry['materializeBaseLayer'];
  readonly mergedObjectCache: SchemaRegistry['mergedObjectCache'];
  readonly metadata: SchemaRegistry['metadata'];
  readonly multiTenant: SchemaRegistry['multiTenant'];
  noteObjectEntry: SchemaRegistry['noteObjectEntry'];
  readonly objectContributors: SchemaRegistry['objectContributors'];
  openObjectEntry: SchemaRegistry['openObjectEntry'];
  packagedRules: SchemaRegistry['packagedRules'];
  rankedForPackage: SchemaRegistry['rankedForPackage'];
  recordCurrencyFollowRefusalOf: SchemaRegistry['recordCurrencyFollowRefusalOf'];
  readonly redeclaredFieldsWarned: SchemaRegistry['redeclaredFieldsWarned'];
  refusePicklistItemArrival: SchemaRegistry['refusePicklistItemArrival'];
  registerNamespace: SchemaRegistry['registerNamespace'];
  reportChangedRuleCopies: SchemaRegistry['reportChangedRuleCopies'];
  reportExtensionPlacements: SchemaRegistry['reportExtensionPlacements'];
  reportFieldPatchMisses: SchemaRegistry['reportFieldPatchMisses'];
  reportRedeclaredFields: SchemaRegistry['reportRedeclaredFields'];
  readonly reportedRuleCopyChanges: SchemaRegistry['reportedRuleCopyChanges'];
  resolveObject: SchemaRegistry['resolveObject'];
  resolveObjectKey: SchemaRegistry['resolveObjectKey'];
  resolvePicklistFields: SchemaRegistry['resolvePicklistFields'];
  resolveStorageObject: SchemaRegistry['resolveStorageObject'];
  readonly restorePoint: SchemaRegistry['restorePoint'];
  readonly searchCompanion: SchemaRegistry['searchCompanion'];
  servedFoldWithLayer: SchemaRegistry['servedFoldWithLayer'];
  readonly shadowedExtensionQueueWarned: SchemaRegistry['shadowedExtensionQueueWarned'];
  stripDeploymentTenancyFrom: SchemaRegistry['stripDeploymentTenancyFrom'];
  stripProvisionedPrimaryFrom: SchemaRegistry['stripProvisionedPrimaryFrom'];
  stripProvisionedSearchCompanionFrom: SchemaRegistry['stripProvisionedSearchCompanionFrom'];
  stripProvisionedTenantIndexFrom: SchemaRegistry['stripProvisionedTenantIndexFrom'];
  subtractExtenderContributions: SchemaRegistry['subtractExtenderContributions'];
  tenantAuthoredScalars: SchemaRegistry['tenantAuthoredScalars'];
  tenantPatchedDisplayKeys: SchemaRegistry['tenantPatchedDisplayKeys'];
  tenantRuleSettings: SchemaRegistry['tenantRuleSettings'];
  withPackagedOwnerRules: SchemaRegistry['withPackagedOwnerRules'];
  withholdDisabledExtensions: SchemaRegistry['withholdDisabledExtensions'];
  withoutExtensionQueueField: SchemaRegistry['withoutExtensionQueueField'];
}

/** The bodies of the "Object registration (ownership model)" section of `SchemaRegistry`: a stateless facet, called by the class's stubs. */
export class ObjectRegistrationFacet {
  /** The body of `SchemaRegistry#objectRegistrationRefusal`; the method's docblock there is its contract. */
  static objectRegistrationRefusal(this: Pick<ObjectRegistrationHost, 'bareNameHoldersAreSealed' | 'judgeRegistrationDoors'>, schema: ServiceObject, packageId?: string, ownership: ObjectOwnership = 'own', options: {
      /**
       * [ADR-0144 D2 and D6, amended] The caller asks about a body whose unit
       * is whole, so nothing it registers with can still change the other end
       * of a pair, and it relays the refusal to its author. Two callers are:
       * a SINGLE save or publish that makes the body live in the same breath
       * (the producers are enumerated in `@objectstack/metadata-protocol`'s
       * `registry-question.ts`), and a batch writer — a package duplicate, an
       * unmanaged import, a package publish, the stored-metadata migration
       * pass — asking of each row once all its rows are registered
       * (`batch-object-registration.ts`, which answers a refused row in the
       * batch's own result). The doors that read the registry's other objects
       * are then asked too — D6's roll-up half and its follow door — once the
       * cold boot has sealed the registry. A refused save is answered with
       * the door's own envelope and stores nothing, instead of being stored
       * and refused, logged, at the write-through. ⛔ Not for a row asked
       * before its batch has registered: a later sibling can still complete
       * the pair (#29673).
       *
       * The follow door has two askers, and {@link registerObject} is neither
       * (seat ruling on the contract review of PR #32368): this option, and
       * the end of a registration run on a sealed registry
       * ({@link restoringOnRefusal}) — a running install or reload, which
       * registers a package's `objectExtensions` after its `objects` and the
       * packages of an artifact one after another, and hears the refusal as
       * a thrown error with the run put back. The cold boot, the stored-row
       * hydration and every other bare `registerObject` register the follow
       * pair exactly as before.
       */
      againstRegistry?: boolean;
    } = {}): Error | null {
    const againstRegistry = options.againstRegistry === true && this.bareNameHoldersAreSealed;
    const door = this.judgeRegistrationDoors(schema, packageId, ownership, { bodyOnly: !againstRegistry, againstRegistry });
    return 'refusal' in door ? door.refusal : null;
  }

  /**
   * [#29673] The registration doors of {@link registerObject}, moved here
   * whole so {@link objectRegistrationRefusal} asks exactly what the
   * registration throws: the refusal, or the body to register (an `extend`
   * body re-keyed to the object it extends). `bodyOnly` skips the doors
   * that read the registry's other objects, and `againstRegistry` (a sealed
   * registry asked about a body whose unit is whole) is the only way these
   * doors ask the follow door (see {@link objectRegistrationRefusal}); a
   * registration run asks it of every body it registered, at its end
   * ({@link restoringOnRefusal}).
   */
  static judgeRegistrationDoors(this: Pick<ObjectRegistrationHost, 'bareNameHoldersAreSealed' | 'extensionTargetKey' | 'getAllObjects' | 'getObject' | 'recordCurrencyFollowRefusalOf'>, schema: ServiceObject, packageId: string | undefined, ownership: ObjectOwnership, opts: { bodyOnly?: boolean; againstRegistry?: boolean } = {}): { refusal: Error } | { schema: ServiceObject } {
    // [#16319] ⭐ THE FIELD-`type` DOOR — first statement in the method, and
    // its position is the whole point.
    //
    // MAINTAINER RULING 2026-09-10 (director seat batch #111 item 2): 「一个没写
    // type(或拼错)的字段 应该禁止加载」. This registry is the ONE choke point every
    // metadata door passes — declared stacks, plugin/package manifests,
    // `saveMetaItem`, the `sys_metadata` boot rehydration and raw
    // `registerObject` calls — so one check here closes all of them at once,
    // which is why the ruling put it here rather than at the four downstream
    // guesses it also retires.
    //
    // ⛔ BEFORE `applySystemFields` and every other materialization below, so
    // the object and field the refusal names are the AUTHOR's own and never a
    // platform injection; and ⛔ before the contributor list is opened, so a
    // refused declaration leaves no half-registered entry behind.
    //
    // ⛔ The whole object is refused; the offending field is never dropped on
    // its own. See {@link ObjectFieldTypeRefusedError}.
    const fieldTypeRefusal = objectFieldTypeRefusal(schema);
    if (fieldTypeRefusal) return { refusal: fieldTypeRefusal };

    // [ADR-0142 D3] Beside it, for its reason: an eligible object's own
    // `queue` field is refused before the injection could be skipped for it —
    // see {@link ObjectQueueColumnRefusedError}. A base layer only: an `extend`
    // body is never planned on its own (#24314, below), so its `queue` is
    // governed in the fold instead ({@link withoutExtensionQueueField}),
    // whichever order the layers register in.
    if (ownership !== 'extend') {
      const queueRefusal = objectQueueColumnRefusal(schema);
      if (queueRefusal) return { refusal: queueRefusal };
    }

    // [ADR-0095 D1 note; ruling E′ item 4] An `extend` contribution never sets
    // the object's default row scope — see
    // {@link ExtensionDefaultRowScopeRefusedError}. Here, beside the field-`type`
    // door and for the same reason: before any materialization and before the
    // contributor list is opened, so a refused contribution leaves nothing behind.
    // [#25234 ruling A, refusal 10] Nor does it declare a membership key — see
    // {@link ExtensionMembershipKeysRefusedError}. The same door, for the same
    // reason, so a refused contribution leaves nothing behind. [#28574] Both
    // are asked through {@link extendContributionRefusal}, the one copy the
    // metadata save and publish doors also ask of an `object_extension` item.
    if (ownership === 'extend') {
      const extendRefusal = extendContributionRefusal(schema, packageId);
      if (extendRefusal) return { refusal: extendRefusal };
      // [#28858] …filed under the key the object it extends is registered
      // under — see {@link extensionTargetKey}. Every entry that registers an
      // extension reaches this line: the manifest `objectExtensions` loop and
      // a stored `object_extension` row ({@link registerObjectExtension}).
      const target = this.extensionTargetKey(String(schema.name ?? ''), packageId);
      if (target !== schema.name) schema = { ...schema, name: target };
    }
    // [#29673] The pre-flight question stops here: the door below reads the
    // registry's other objects, not the body alone.
    if (opts.bodyOnly) return { schema };
    // [ADR-0144 D6] A `summary` roll-up that reads a `record`-mode amount —
    // `sum` / `avg` / `min` / `max` of a child field whose rows each carry
    // their own currency — is refused here, the door every metadata path
    // passes, before any materialization: the pair is judged at whichever
    // registration completes it. See `record-currency-aggregate-door.ts`.
    const recordCurrencySummary = recordCurrencySummaryRefusal(
      schema,
      (name) => this.getObject(name),
      () => this.getAllObjects(),
    );
    if (recordCurrencySummary) return { refusal: recordCurrencySummary };
    // [ADR-0158 U7 R1, L3] Beside it, its twin over a `record`-mode quantity:
    // every such roll-up is refused in R1, whichever end registers second.
    // See `record-unit-aggregate-door.ts`.
    const recordUnitSummary = recordUnitSummaryRefusal(
      schema,
      (name) => this.getObject(name),
      () => this.getAllObjects(),
    );
    if (recordUnitSummary) return { refusal: recordUnitSummary };
    // [ADR-0144 D2 and D6, amended] Beside it, for the same reason: a
    // following amount whose parent holds no code field under that name, and a
    // `record` roll-up over a child amount that follows nothing — the halves
    // `defineStack` judges where a stack holds both objects, for the
    // single-object save that holds one. Asked here only of a caller whose
    // unit is whole and who relays the refusal (`againstRegistry`, which
    // {@link objectRegistrationRefusal} grants only once the cold boot has
    // sealed the registry): before the seal an `extend` contribution or the
    // other end can still register and contradict the verdict (AGENTS.md,
    // startup registry reads), and a multi-registration unit after it —
    // `registerApp`'s objects before its `objectExtensions`, the packages of
    // one artifact, a batch writer's rows in its own order — has the same
    // hazard at each of its registrations. So `registerObject` never asks
    // it. The unit does, once it is whole: a batch writer through this
    // option, a registration run at its end
    // ({@link recordCurrencyFollowRefusalOfRun}).
    if (opts.againstRegistry === true && this.bareNameHoldersAreSealed) {
      const recordCurrencyFollow = this.recordCurrencyFollowRefusalOf(schema, ownership, { packageId, before: null });
      if (recordCurrencyFollow) return { refusal: recordCurrencyFollow };
    }
    return { schema };
  }

  /**
   * [ADR-0144 D2 and D6, amended] The follow door's question of one layer, as
   * `ownership`, against the registry as it stands: the one copy a single
   * save ({@link judgeRegistrationDoors}) and a registration run
   * ({@link recordCurrencyFollowRefusalOfRun}) ask. `all` answers the
   * registered objects; a caller asking of several bodies reads them once.
   * `lookup` answers one of them by name, and is the served object unless the
   * caller reads an object another way ({@link followRefusalAsServed}).
   *
   * [#33593 ruling A, amended] The door judges the layer's object AS SERVED
   * with the layer in its slot ({@link servedFoldWithLayer}) — never the bare
   * body, so an `extend` contribution's following amount is judged as an own
   * body's is (R1), and an owner judges the amounts the extensions already
   * registered under it add (R3). An object no owner serves is no verdict
   * (R2). `layer.before` is what the slot held before: a pair already refused
   * with it in place is not this layer's to answer for (R7).
   */
  static recordCurrencyFollowRefusalOf(this: Pick<ObjectRegistrationHost, 'followDoorSlotPriority' | 'getAllObjects' | 'getObject' | 'getObjectContributors' | 'isPackageDisabled' | 'resolveObjectKey' | 'servedFoldWithLayer'>, schema: ServiceObject, ownership: ObjectOwnership, layer: FollowDoorLayer, all: () => readonly ServiceObject[] = () => this.getAllObjects(), lookup: (name: string) => ServiceObject | undefined = (name) => this.getObject(name)): RecordCurrencyFollowRefusedError | undefined {
    const fqn = String(schema.name ?? '');
    const served = this.servedFoldWithLayer(fqn, ownership, layer.packageId, {
      packageId: layer.packageId,
      namespace: '',
      ownership,
      priority: layer.priority ?? this.followDoorSlotPriority(fqn, ownership, layer.packageId),
      definition: { ...schema, name: fqn },
    });
    if (served === undefined) return undefined;
    const before = this.servedFoldWithLayer(fqn, ownership, layer.packageId, layer.before ?? undefined);
    return recordCurrencyFollowRefusal(served, {
      lookup,
      all,
      extensionPackageOf: (name, field) => {
        const key = this.resolveObjectKey(name);
        if (key === undefined) return undefined;
        // As the served fold reads the object ({@link resolveObject}): a
        // disabled package's extension is withheld; the last to add wins.
        const adders = this.getObjectContributors(key).filter((c) => c.ownership === 'extend'
          && !this.isPackageDisabled(c.packageId)
          && Object.prototype.hasOwnProperty.call((c.definition as { fields?: object }).fields ?? {}, field));
        return adders.length === 0 ? undefined : adders[adders.length - 1].packageId;
      },
    }, before);
  }

  /**
   * [#33593 ruling R1] The object `fqn` as {@link resolveObject} would serve
   * it with `layer` filling the slot `ownership` and `packageId` name (one
   * owner, one overlay, one extension per package — the replacement rules
   * {@link registerObject} applies), or with that slot empty when `layer` is
   * `undefined`. `undefined` when no owner would serve it. Uncached: it is a
   * question about a registry the caller has not written.
   */
  static servedFoldWithLayer(this: Pick<ObjectRegistrationHost, 'foldExtenders' | 'foldExtendersOntoDefinition' | 'objectContributors' | 'withholdDisabledExtensions'>, fqn: string, ownership: ObjectOwnership, packageId: string | undefined, layer: ObjectContributor | undefined): ServiceObject | undefined {
    const others = (this.objectContributors.get(fqn) ?? []).filter((c) => c.ownership !== ownership
      || (ownership === 'extend' && c.packageId !== packageId));
    const contributors = layer === undefined ? others : [...others, layer].sort((a, b) => a.priority - b.priority);
    const owner = contributors.find((c) => c.ownership === 'own');
    if (!owner) return undefined;
    const base = contributors.find((c) => c.ownership === 'overlay') ?? owner;
    const withheld = this.withholdDisabledExtensions(contributors);
    return withheld
      ? this.foldExtendersOntoDefinition(withheld.kept, withoutWithheldMembers(base.definition, withheld))
      : this.foldExtenders(contributors, base);
  }

  /** The priority a layer about to register in the slot would take: the sitting one's, else the kind's default. */
  static followDoorSlotPriority(this: Pick<ObjectRegistrationHost, 'objectContributors'>, fqn: string, ownership: ObjectOwnership, packageId: string | undefined): number {
    const sitting = (this.objectContributors.get(fqn) ?? []).find((c) => c.ownership === ownership
      && (ownership !== 'extend' || c.packageId === packageId));
    if (sitting) return sitting.priority;
    return ownership === 'own' ? DEFAULT_OWNER_PRIORITY : ownership === 'overlay' ? DEFAULT_OVERLAY_PRIORITY : DEFAULT_EXTENDER_PRIORITY;
  }

  /** The body of `SchemaRegistry#registerObject`; the method's docblock there is its contract. */
  static registerObject(this: Pick<ObjectRegistrationHost, '_objectRevision' | 'debug' | 'deploymentPlatformGlobalObjects' | 'judgeRegistrationDoors' | 'log' | 'materializeBaseLayer' | 'mergedObjectCache' | 'multiTenant' | 'noteObjectEntry' | 'openObjectEntry' | 'refusePicklistItemArrival' | 'registerNamespace' | 'restorePoint'>, schema: ServiceObject, packageId?: string, namespace?: string, ownership: ObjectOwnership = 'own', priority: number = ownership === 'own'
      ? DEFAULT_OWNER_PRIORITY
      : ownership === 'overlay'
        ? DEFAULT_OVERLAY_PRIORITY
        : DEFAULT_EXTENDER_PRIORITY): string {
    // [#29673] The registration DOORS — every refusal this method answers
    // before any materialization and before the contributor list is opened —
    // live in {@link judgeRegistrationDoors}, so the metadata doors that make
    // a body live can ask the same question BEFORE they promote it
    // ({@link objectRegistrationRefusal}) instead of meeting the throw after
    // the row is already active. Still the first statement here, and the
    // position is still the whole point (the comments inside say why).
    const door = this.judgeRegistrationDoors(schema, packageId, ownership);
    if ('refusal' in door) throw door.refusal;
    schema = door.schema;
    // The body as the doors judged it, before anything below materializes it:
    // what an open registration run is asked about at its end (below, where
    // the layer is stored).
    const judged = schema;

    // [ADR-0150 D3, #31700; epic seat ruling R2-A, 6812862622] After the
    // boot sealed the picklist vocabulary, a packaged body registered on its
    // own (outside an install judged as a whole: a plugin or the metadata
    // service registering through the registry directly, a reloaded object)
    // meets the one re-judge before its layer is stored: a field it writes
    // must not leave another package's field of the same name writing to a
    // different list ({@link refusePicklistItemArrival}). ⛔ Never an overlay
    // or a tenant-authored body: it fills no package's slot and writes no
    // package's reference, resolving as the environment's (`picklistReferrerOf`;
    // swept for seat ruling R3-A).
    if (packageId && (ownership === 'own' || ownership === 'extend') && !isTenantAuthored(schema)) {
      this.refusePicklistItemArrival(
        packageId,
        ownership === 'own'
          ? { objects: [schema] }
          : { objectExtensions: [{ extend: schema.name, fields: (schema as { fields?: unknown }).fields }] },
        `object '${schema.name}' of package '${packageId}'`,
      );
    }

    // [#25744] A code package's object keeps its own actions as their
    // `ActionSchema` parse — `requiresFeature` / `requiresMembershipReach`
    // lowered into `visible` — or is refused here, beside the doors above and
    // for their reason: before any materialization and before the contributor
    // list is opened, so a refused object leaves nothing behind and a refused
    // re-registration leaves the registered one in place
    // ({@link parsePackageObjectActions}). The test is `registerItem`'s action
    // parse's, asked of the body as `applyProtection` below will stamp it (a
    // package id it does not already carry, `'package'` provenance): ⛔ a
    // registration with no `packageId`, the `sys_metadata` sentinel, or a
    // tenant-authored body (`_provenance: 'org'` — the save door's write-through
    // and the boot rehydration) is never judged here.
    if (packageId && isCodeArtifactBody({
      _packageId: (schema as { _packageId?: unknown })._packageId ?? packageId,
      _provenance: (schema as { _provenance?: unknown })._provenance ?? 'package',
    })) {
      schema = parsePackageObjectActions(schema, packageId);
    }

    // [#23065] A `tree` field that names no `reference` references the object
    // that declares it, and this is where that is written down for every door
    // the parse does not cover: a metadata save stores the authored body
    // verbatim and the `sys_metadata` rehydration and a raw `registerObject`
    // never parse at all. `ObjectSchema`'s parse writes the same thing through
    // the same spec helper, so the two doors cannot disagree, and every reader
    // of the registered schema — the referential delete walk, the write-time
    // reference check, `expand`, nested relation conditions — sees an ordinary
    // self-reference. ⛔ No reader resolves it on its own. An extension
    // registers under the object it extends (`name: ext.extend`), which is the
    // object its trees reference.
    const treeFields = materializeTreeSelfReferences(schema.name, schema.fields);
    if (treeFields !== schema.fields) schema = { ...schema, fields: treeFields };

    // Apply system-field injection (multi-tenant org_id, future owner/audit)
    // BEFORE FQN computation and contributor storage so every consumer of
    // the registered schema (driver syncSchema, REST projector, hooks)
    // sees the same canonical shape. Author-declared fields win — see
    // applySystemFields().
    //
    // [#24314] A BASE layer only (`own` / `overlay`). An `extend` body is a
    // bag of fields for an object someone else declares, so it is never
    // planned on its own: it carries none of the declarations the plan reads
    // (`managedBy`, `systemFields`, `tenancy`, `ownership`), and planning it
    // as an ordinary object injected the full column set onto targets whose
    // own declaration withholds it. Measured on a walled boot: an extension of
    // `sys_organization` (`managedBy: 'better-auth'`) added `organization_id`,
    // NULL on every row, and the wall then hid the organisation from its own
    // members; the same on `sys_user`. The fold also let the injected
    // definition REPLACE a column the owner declares itself: plugin-auth's
    // own `sys_sso_provider` extension swapped the authored `organization_id`
    // for the platform's lookup. So the extended object's system columns are
    // exactly its base layer's plan, whichever order the layers register in.
    if (ownership !== 'extend') {
      schema = applySystemFields(schema, {
        multiTenant: this.multiTenant,
        platformGlobalObjects: this.deploymentPlatformGlobalObjects,
      });
    }

    // [ADR-0092 / #1591] Reconcile generic-write `apiMethods` against the CRUD
    // affordances a better-auth-managed object actually grants — strip verbs
    // the identity write guard would reject anyway, so the HTTP exposure gate
    // answers a clean 405 and the metadata can't contradict itself. No-op for
    // every non-`better-auth` object.
    schema = reconcileManagedApiMethods(schema);

    // [#3543] One-shot per-object diagnostic for retired LEGACY apiMethods
    // values (the derived 8) — ignored by the derivation resolver; this adds
    // the object-name context the parse-time strip warning lacks. Runs after
    // reconcile so we diagnose what actually ships.
    warnStrippedLegacyApiMethods(schema);

    // [ADR-0078 Phase 4] One-shot per-object functional-completeness
    // diagnostic — the registry is the choke point every metadata door goes
    // through, including the ones that skip Zod and lint (#3896, raw
    // registerObject). Same shared predicate and rule ids as `os lint`;
    // warn-never-throw (an inert FIELD must not kill the boot).
    warnFunctionalCompleteness(schema);

    // [ADR-0079] Object-materialization seam — DESIGNATE-ONLY primary-title
    // provisioning. Runs AFTER `applySystemFields` (so any designated field
    // co-exists with the injected system columns) and ONLY for owned objects
    // (extensions must not redesignate the owner's title). `synthesize: false`
    // means: when a title-eligible field already EXISTS, set `nameField` to it
    // (so `nameField` is reliably populated for normal/user/AI-built objects,
    // which always carry a text label); when NOTHING is title-eligible, the
    // object is left exactly as-is. We deliberately do NOT synthesize a `name`
    // column here — that would materialize a new DB column on title-less
    // system/append-only tables (sys_record_share, sys_member, …) via the
    // driver's `syncSchema`, a schema-migration-bearing change. Those keep
    // resolving their title on read via `resolveDisplayField` / `titleFormat`.
    //
    // [ADR-0029 D9, blast-radius row 2] The gate asks "is this a BASE LAYER",
    // not "is this the owner". An `overlay` REPLACES the base at resolution
    // time (D9.2), so the overlay body IS the resolved object — gating title
    // provisioning on `own` alone would silently change `nameField` on every
    // overlaid object, which is the same designation the packaged twin gets.
    // Extensions still never redesignate: they merge into a base that has
    // already been provisioned.
    if (ownership === 'own' || ownership === 'overlay') {
      schema = this.materializeBaseLayer(schema);
    }

    const shortName = schema.name;
    const fqn = computeFQN(namespace, shortName);

    // Ensure namespace is registered. [#12623] `packageId` is now optional
    // on this method, so a namespace passed without one has no owner to
    // record — skip rather than registering `undefined` as an owner (which
    // would also mean widening `registerNamespace`'s own required-string
    // contract, out of scope here).
    // [#28697] Recorded before the first write below (the namespace claim),
    // so a refusal raised after it — the ownership conflict — puts this
    // object's layers back exactly ({@link restoringOnRefusal}).
    this.noteObjectEntry(fqn);

    if (namespace && packageId) {
      this.registerNamespace(namespace, packageId);
    }

    // Get or create contributor list (#10945: the one creation choke point —
    // it keeps `objectKeysByShortName` in step with `objectContributors`)
    const contributors = this.openObjectEntry(fqn);

    // [#33593 ruling R7] What this layer's slot held, for the open run's end.
    let replaced: ObjectContributor | null = null;
    // Validate ownership rules
    if (ownership === 'own') {
      const existingOwner = contributors.find(c => c.ownership === 'own');
      if (existingOwner && isTenantAuthored(existingOwner.definition) && !isTenantAuthored(schema)) {
        // ── LATE INSTALL (ADR-0029 D9 §6.1) ──
        //
        // A code package registers an object a TENANT row already holds. That
        // happens whenever the hydration seams run before the package does —
        // a `sys_metadata` row written on a kernel where nothing shipped the
        // name, then a package that later ships it (install, upgrade, or a
        // boot whose order puts `loadMetaFromDb` first). Before D9 the tenant
        // row had taken the `own` slot by default, so this threw "already
        // owned by" under a foreign id, or SPLICED THE TENANT'S BODY AWAY
        // under the same id.
        //
        // D9's recommended default, and the only outcome that loses nothing:
        // the CODE layer becomes the owner and the tenant contribution is
        // re-classified as its overlay layer — exactly the two layers that
        // would exist had the package registered first. The resolved object
        // does not move (the tenant body is the base either way, D9.2); what
        // changes is that the packaged definition now survives underneath it,
        // so `isArtifactBacked` is honest from this moment on.
        //
        // Deliberately narrow: it fires ONLY when the sitting owner is
        // tenant-authored (`_provenance: 'org'`) and the incoming body is not.
        // Two code packages claiming one name is D3's cross-package refusal
        // and still throws below, whatever the ids.
        const staleOverlay = contributors.findIndex(c => c.ownership === 'overlay');
        if (staleOverlay !== -1) contributors.splice(staleOverlay, 1);
        existingOwner.ownership = 'overlay';
        existingOwner.priority = DEFAULT_OVERLAY_PRIORITY;
        this.log(
          `[Registry] Late install of "${fqn}": package "${packageId}" takes ownership; ` +
          `the tenant contribution (${existingOwner.packageId}) becomes its overlay layer.`
        );
      } else if (existingOwner && existingOwner.packageId !== packageId) {
        // [ADR-0029 D3] Two packages claiming one name — the cross-package
        // refusal, carried as an ADR-0112 envelope (`code` + `status: 422`)
        // with the message text unchanged. See {@link ObjectOwnershipConflictError}.
        throw new ObjectOwnershipConflictError(fqn, existingOwner.packageId, packageId);
      } else if (existingOwner) {
        // Remove existing owner contribution from same package (re-registration).
        // Normal path (metadata rebuild / HMR / multi-project seed replays the
        // same owned object), not an error — keep it at debug so a stock boot
        // stays warning-free (#3420).
        contributors.splice(contributors.indexOf(existingOwner), 1);
        replaced = existingOwner;
        this.debug(`[Registry] Re-registering owned object: ${fqn} from ${packageId}`);
      }
    } else if (ownership === 'overlay') {
      // [ADR-0029 D9.9] AT MOST ONE overlay layer per object name, replaced on
      // re-write — and keyed by KIND, never by package. The row's `package_id`
      // is provenance ON the layer, not a second identity for it: the
      // overlay-uniqueness index in `sys_metadata` keys on
      // `(type, name, organization_id, COALESCE(package_id, ''))` and can
      // legitimately hold two rows for one `(type, name)` bound to two
      // packages, which this registry could never represent because
      // `computeFQN` is identity. Keying the replacement by package would let
      // that unrepresentable shape in through the side door; the mis-bound row
      // is refused at the PRODUCER instead (`saveMetaItem`), and counted in
      // `loadMetaFromDb`'s per-record `errors` at boot.
      const idx = contributors.findIndex(c => c.ownership === 'overlay');
      if (idx !== -1) {
        replaced = contributors.splice(idx, 1)[0];
        this.debug(`[Registry] Replacing overlay layer of object: ${fqn} from ${packageId}`);
      }
    } else {
      // extend mode: remove existing extension from same package
      const idx = contributors.findIndex(c => c.packageId === packageId && c.ownership === 'extend');
      if (idx !== -1) {
        replaced = contributors.splice(idx, 1)[0];
      }
    }

    // ADR-0010 §3.7 — translate the author-facing `protection` block
    // into the private `_lock` envelope and stamp package provenance
    // on the schema before it lands in the contributor list. Mirrors
    // registerItem() so object schemas surface lock fields on GET — including
    // its note on the `_packageVersion` a manifest-holding caller stamps first.
    applyProtection(schema as any, { packageId });

    // Add new contributor
    const contributor: ObjectContributor = {
      packageId,
      namespace: namespace || '',
      ownership,
      priority,
      definition: { ...schema, name: fqn }, // Store with FQN as name
    };
    contributors.push(contributor);
    // [ADR-0144 D2 and D6, amended] …and told to the open registration run,
    // under the slot the layer just filled (the replacement rules above: one
    // owner, one overlay, one extension per package), so the run's end asks
    // the record-currency follow door of it with the whole run registered
    // ({@link restoringOnRefusal}). Outside a run nothing is recorded.
    this.restorePoint?.noteRegisteredObject(
      `${fqn}\u0000${ownership}${ownership === 'extend' ? `\u0000${packageId ?? ''}` : ''}`,
      { fqn, schema: judged, contributor, replaced },
    );

    // Sort by priority (ascending: lower priority applied first)
    contributors.sort((a, b) => a.priority - b.priority);

    // Invalidate merge cache
    this.mergedObjectCache.delete(fqn);
    // …and tell registry-derived caches (the engine's roll-up summary index)
    // that the object set moved, whichever path got here.
    this._objectRevision += 1;

    this.log(`[Registry] Registered object: ${fqn} (${ownership}, priority=${priority}) from ${packageId}`);
    return fqn;
  }

  /** The body of `SchemaRegistry#resolveObject`; the method's docblock there is its contract. */
  static resolveObject(this: Pick<ObjectRegistrationHost, 'foldExtenders' | 'foldExtendersOntoDefinition' | 'mergedObjectCache' | 'objectContributors' | 'withholdDisabledExtensions'>, fqn: string): ServiceObject | undefined {
    // Check cache first
    const cached = this.mergedObjectCache.get(fqn);
    if (cached) return cached;

    const contributors = this.objectContributors.get(fqn);
    if (!contributors || contributors.length === 0) {
      return undefined;
    }

    // Find owner (must exist for a valid object)
    const ownerContrib = contributors.find(c => c.ownership === 'own');
    if (!ownerContrib) {
      // [ADR-0029 D9.5] An ORPHAN OVERLAY lands here too, and says so: the
      // tenant can still see the row in `sys_metadata`, so "extenders" would
      // be the wrong noun to hand whoever reads this line.
      console.warn(
        contributors.some(c => c.ownership === 'overlay')
          ? `[Registry] Object "${fqn}" has an overlay layer but no owner. Skipping.`
          : `[Registry] Object "${fqn}" has extenders but no owner. Skipping.`
      );
      return undefined;
    }

    // [ADR-0029 D9.2] The BASE layer is the tenant overlay when one is
    // registered, and the owner otherwise — `overlay ?? own`. Selection asks
    // the KIND (D9.3), never the priority.
    //
    // This is deliberately BIT-FOR-BIT what the pre-D9 splice produced: the
    // overlay used to BE the owner, so the fold already ran over the overlay
    // body. The resolved schema — `_provenance: 'org'` included, which every
    // registry-direct consumer reads — does not move. Only what the registry
    // REMEMBERS changes: the packaged owner is still here, underneath.
    const baseContrib = contributors.find(c => c.ownership === 'overlay') ?? ownerContrib;
    // A disabled package's `extend` contributions are withheld from the served
    // fold ({@link withholdDisabledExtensions}); the cache is dropped by every
    // enable and disable ({@link invalidateAll}).
    const withheld = this.withholdDisabledExtensions(contributors);
    const merged = withheld
      ? this.foldExtendersOntoDefinition(withheld.kept, withoutWithheldMembers(baseContrib.definition, withheld))
      : this.foldExtenders(contributors, baseContrib);

    // Cache the result
    this.mergedObjectCache.set(fqn, merged);
    return merged;
  }

  /** The body of `SchemaRegistry#getStorageObject`; the method's docblock there is its contract. */
  static getStorageObject(this: Pick<ObjectRegistrationHost, 'resolveObjectKey' | 'resolveStorageObject'>, name: string): ServiceObject | undefined {
    const fqn = this.resolveObjectKey(name);
    return fqn === undefined ? undefined : this.resolveStorageObject(fqn);
  }

  /** The body of `SchemaRegistry#getAllStorageObjects`; the method's docblock there is its contract. */
  static getAllStorageObjects(this: Pick<ObjectRegistrationHost, 'getAllObjects' | 'getObjectOwner' | 'hasDisabledPackage' | 'objectContributors' | 'resolveStorageObject'>): ServiceObject[] {
    // Nothing disabled: the two layers are one answer, read through the one walk.
    if (!this.hasDisabledPackage()) return this.getAllObjects();
    const results: ServiceObject[] = [];
    for (const fqn of this.objectContributors.keys()) {
      const merged = this.resolveStorageObject(fqn);
      if (!merged) continue;
      (merged as any)._packageId = this.getObjectOwner(fqn)?.packageId;
      results.push(merged);
    }
    return results;
  }

  /** See {@link getStorageObject}. Uncached when it differs from the served fold, as {@link resolveOwnerLayer} is. */
  static resolveStorageObject(this: Pick<ObjectRegistrationHost, 'foldExtenders' | 'isPackageDisabled' | 'objectContributors' | 'resolveObject'>, fqn: string): ServiceObject | undefined {
    const contributors = this.objectContributors.get(fqn);
    if (!contributors || !contributors.some((c) => c.ownership === 'extend' && this.isPackageDisabled(c.packageId))) {
      return this.resolveObject(fqn);
    }
    const ownerContrib = contributors.find(c => c.ownership === 'own');
    if (!ownerContrib) return this.resolveObject(fqn);
    return this.foldExtenders(contributors, contributors.find(c => c.ownership === 'overlay') ?? ownerContrib);
  }

  /**
   * The `extend` contributions of a DISABLED package are withheld from every
   * served fold of the object they extend, as the package's own objects,
   * flows, navigation and actions are: "disabled" means hidden, refused on the
   * data plane, data kept. The served object loses the fields, rules and
   * indexes such an extension adds and the patches it makes, so the data
   * plane's field map (its default projection and its unknown-field refusal)
   * loses them too; the storage layer keeps them ({@link getStorageObject}).
   *
   * `withheldFields` / `withheldRules` / `withheldIndexes` are the members a
   * withheld extension adds that neither the owner's own declaration nor a
   * kept extension also declares (indexes compared structurally, as the fold's
   * own index subtraction compares them). A base body that already carries them (a tenant overlay saved
   * from a served read, a metadata-service copy seeded from a resolved body)
   * has them taken off ({@link withoutWithheldMembers}), so where the base
   * came from does not decide what a disable hides.
   *
   * `undefined` when no extension of the object is withheld, so the ordinary
   * fold runs unchanged.
   *
   * [#30756] `asEnabled` names a package whose contributions are kept although
   * it is disabled: the fold the enable of that package would leave
   * ({@link ObjectExtensionFoldOptions}).
   */
  static withholdDisabledExtensions(this: Pick<ObjectRegistrationHost, 'isPackageDisabled'>, contributors: readonly ObjectContributor[], asEnabled?: string): WithheldExtensions | undefined {
    const withheld = contributors.filter((c) => c.ownership === 'extend'
      && this.isPackageDisabled(c.packageId)
      && (asEnabled === undefined || c.packageId !== asEnabled));
    if (withheld.length === 0) return undefined;
    const kept = contributors.filter((c) => !withheld.includes(c));
    const owner = contributors.find((c) => c.ownership === 'own')?.definition;
    const keptFields = new Set<string>(ownFieldNamesOf(owner) ?? []);
    const keptRules = new Set<string>(ruleNamesOf(owner));
    const keptIndexes = new Set<string>(indexKeysOf(owner));
    for (const c of kept) {
      if (c.ownership !== 'extend') continue;
      for (const name of fieldNamesOf(c.definition)) keptFields.add(name);
      for (const name of ruleNamesOf(c.definition)) keptRules.add(name);
      for (const key of indexKeysOf(c.definition)) keptIndexes.add(key);
    }
    const withheldFields = new Set<string>();
    const withheldRules = new Set<string>();
    const withheldIndexes = new Set<string>();
    for (const c of withheld) {
      for (const name of fieldNamesOf(c.definition)) if (!keptFields.has(name)) withheldFields.add(name);
      for (const name of ruleNamesOf(c.definition)) if (!keptRules.has(name)) withheldRules.add(name);
      for (const key of indexKeysOf(c.definition)) if (!keptIndexes.has(key)) withheldIndexes.add(key);
    }
    return { kept, withheldFields, withheldRules, withheldIndexes };
  }

  /**
   * [#34901] The body of `SchemaRegistry#getWithheldExtensionFields`; the
   * method's docblock there is its contract. Read off
   * {@link withholdDisabledExtensions}, the one reading of what a disable
   * withholds, so this answer and the served fold cannot disagree.
   */
  static getWithheldExtensionFields(this: Pick<ObjectRegistrationHost, 'objectContributors' | 'resolveObjectKey' | 'withholdDisabledExtensions'>, name: string): Record<string, { packageId: string }> {
    const fqn = this.resolveObjectKey(name);
    const contributors = fqn === undefined ? undefined : this.objectContributors.get(fqn);
    if (!contributors || contributors.length === 0) return {};
    const withheld = this.withholdDisabledExtensions(contributors);
    if (!withheld || withheld.withheldFields.size === 0) return {};
    const out: Record<string, { packageId: string }> = {};
    // In fold order, so a field two disabled packages both add names the
    // first; any of them re-enabled serves it again.
    for (const c of contributors) {
      if (c.ownership !== 'extend' || withheld.kept.includes(c) || typeof c.packageId !== 'string') continue;
      for (const field of fieldNamesOf(c.definition)) {
        if (withheld.withheldFields.has(field) && !Object.prototype.hasOwnProperty.call(out, field)) {
          out[field] = { packageId: c.packageId };
        }
      }
    }
    return out;
  }

  /**
   * [#29903, #29872, ADR-0146 D8 item 3] An object as {@link resolveObject}
   * resolves it, but with the `extend` contributions `options` names left out
   * of the fold ({@link ObjectExtensionFoldOptions}), as if those packages had
   * never extended it: the same base layer (`overlay ?? own`), every other
   * extender folded in the same order, the same tail. With no such
   * contribution it IS {@link resolveObject}'s answer (the cached body).
   * Uncached otherwise, as {@link resolveOwnerLayer} is.
   *
   * The reader is the protocol's per-package layer, which serves a package's
   * objects to the package's own export as the package declares them: never
   * with an extension another package contributes (its `.custom` pair's, or
   * any other installed package's). That extension travels in its own
   * package's export, as its `objectExtensions` entry
   * ({@link getObjectExtensionsOf}); folded in here too, its field and field
   * patches travel twice, the second time as if the owner shipped them.
   */
  static resolveObjectLeavingExtensionsOut(this: Pick<ObjectRegistrationHost, 'foldExtenders' | 'foldExtendersOntoDefinition' | 'isPackageDisabled' | 'objectContributors' | 'resolveObject' | 'withholdDisabledExtensions'>, fqn: string, options: ObjectExtensionFoldOptions | undefined): ServiceObject | undefined {
    // [#30756] A disabled package folded in as if enabled; one that is not
    // disabled changes nothing, so it does not leave the cached fold.
    const asEnabled = options?.asEnabled !== undefined && this.isPackageDisabled(options.asEnabled)
      ? options.asEnabled
      : undefined;
    // [#34901] …and `includeDisabledExtensions` folds EVERY disabled package in.
    const includeDisabled = options?.includeDisabledExtensions === true;
    const contributors = leavesExtensionsOut(options) || asEnabled !== undefined || includeDisabled ? this.objectContributors.get(fqn) : undefined;
    if (!contributors || !contributors.some((c) => isLeftOutExtension(c, options!)
      || (asEnabled !== undefined && c.ownership === 'extend' && c.packageId === asEnabled)
      || (includeDisabled && c.ownership === 'extend' && this.isPackageDisabled(c.packageId)))) return this.resolveObject(fqn);
    const kept = contributors.filter((c) => !isLeftOutExtension(c, options!));
    const ownerContrib = kept.find(c => c.ownership === 'own');
    if (!ownerContrib) return undefined;
    const base = kept.find(c => c.ownership === 'overlay') ?? ownerContrib;
    // …and a disabled package's, as on every served fold ({@link withholdDisabledExtensions}),
    // except the one `asEnabled` names — and none at all under `includeDisabledExtensions`.
    const withheld = includeDisabled ? undefined : this.withholdDisabledExtensions(kept, asEnabled);
    return withheld
      ? this.foldExtendersOntoDefinition(withheld.kept, withoutWithheldMembers(base.definition, withheld))
      : this.foldExtenders(kept, base);
  }

  /**
   * Fold every `extend` contribution over a chosen base layer, in the list's
   * (priority-sorted) order. Extracted from {@link resolveObject} so the
   * code-layer resolution ({@link resolveOwnerLayer}) folds extenders exactly
   * the same way rather than growing a second, drifting copy.
   */
  static foldExtenders(this: Pick<ObjectRegistrationHost, 'foldExtendersOntoDefinition'>, contributors: ObjectContributor[], base: ObjectContributor, layer: ServedObjectLayer = 'served'): ServiceObject {
    return this.foldExtendersOntoDefinition(contributors, base.definition, layer);
  }

  /**
   * The fold itself, over a base DEFINITION rather than a base contributor, so
   * {@link foldObjectExtendersOnto} can apply it to a body that never came
   * from this registry without growing a second copy of the merge.
   */
  static foldExtendersOntoDefinition(this: Pick<ObjectRegistrationHost, 'finishServedObject' | 'getObjectOwner' | 'reportChangedRuleCopies' | 'reportExtensionPlacements' | 'reportFieldPatchMisses' | 'reportRedeclaredFields' | 'resolveObjectKey' | 'tenantAuthoredScalars' | 'tenantPatchedDisplayKeys' | 'tenantRuleSettings' | 'withPackagedOwnerRules' | 'withoutExtensionQueueField'>, contributors: ObjectContributor[], baseDefinition: ServiceObject, layer: ServedObjectLayer = 'served'): ServiceObject {
    // [ADR-0029 D9.2a] Computed ONCE, over the base the fold starts from — never
    // re-derived from the running `merged`, which would make an extender's own
    // scalar look "authored" to the next extender and silently invert
    // extender-vs-extender precedence (D9.3: declared numbers order peers).
    const tenantAuthored = this.tenantAuthoredScalars(contributors, baseDefinition);
    // [#24314] An `extend` body is not planned at registration, so an audit
    // field it declares is governed HERE, by the base layer's plan: where the
    // base carries the audit family, a `created_at` an extender declares cannot
    // replace the platform's read-only definition with a writable one (#4447).
    const governAudit = resolveInjectedSystemColumns(baseDefinition).audit;
    // [ADR-0142 D3] The ownership-queue column, for the same reason: the
    // registration door's refusal ({@link objectQueueColumnRefusal}) never sees
    // an `extend` body, so where the base plans `queue` an extender's own `queue`
    // field is dropped here and the platform's column stands. Letting it replace
    // the injected definition would read as `author` provenance and switch the
    // access path, the claim and the assignment seam off on this object, while
    // the gate kept judging the extender's business column.
    const governQueue = resolveInjectedSystemColumns(baseDefinition).queue;
    // [ADR-0029 D9.2a, 2026-10-30 note] A tenant base's rules are copies: each
    // one a code layer ships by name runs as the package declares it, with the
    // tenant's `message` and `active`. Computed once, over the base, as the
    // scalars above are.
    const tenantRules = this.tenantRuleSettings(contributors, baseDefinition);
    // [ADR-0146 D10, second rule; ADR-0029 D9.2a] The display keys the tenant
    // authored on the fields the extenders patch — computed once, over the
    // base, for the scalars' reason above.
    const tenantPatched = this.tenantPatchedDisplayKeys(contributors, baseDefinition);
    // [ADR-0146 D10, second rule] The fields a patch reaches: the owner's own.
    const owner = contributors.find((c) => c.ownership === 'own')?.definition;
    const ownFields = ownFieldNamesOf(owner);
    let merged = tenantRules
      ? this.withPackagedOwnerRules(contributors, baseDefinition, tenantRules)
      : { ...baseDefinition };
    // [#28835] Each extension's `fields` as the merge took them, in fold order.
    const folded: FoldedExtensionFields[] = [];
    for (const contrib of contributors) {
      if (contrib.ownership === 'extend') {
        let extension = governAudit ? applyAuditFieldGovernance(contrib.definition) : contrib.definition;
        if (governQueue) extension = this.withoutExtensionQueueField(extension, contrib.packageId);
        // [#28809] The judge, asked of the owner's fields as the OWNER declares
        // them (what the install door and `os validate` read), never as an
        // extension's `fields` redeclared them; the merge applies only what it
        // admits. A field counts as carried as the merge below will carry it:
        // in the running body's record spelling, or redeclared by this body.
        const patches = (extension as ObjectExtensionBody).fieldPatches;
        const running = merged;
        const misses = patches && owner && ownFields
          ? fieldPatchTargetMisses(
            String(baseDefinition.name ?? extension.name ?? ''),
            patches,
            ownFieldsTarget(owner, ownFields, (name) => !!(recordFieldOf(running, name) ?? recordFieldOf(extension, name))),
          )
          : [];
        const admitted = misses.length > 0
          ? { ...extension, fieldPatches: admittedFieldPatches(patches!, misses) } as ObjectExtensionBody
          : extension;
        merged = mergeObjectDefinitions(merged, admitted, tenantAuthored, tenantRules, tenantPatched, ownFields);
        // [#28809] …and the same judge once more, over the admitted patches
        // against the owner's fields as MERGED, which only names: an admitted
        // option an earlier layer left out (an extension's `fields`
        // redeclaration, a tenant overlay base) had nothing to relabel, so the
        // fold names it as it names any patch it skipped. Never drops, never
        // refuses; admission above stays the owner's.
        const admittedPatches = (admitted as ObjectExtensionBody).fieldPatches;
        const residual = admittedPatches && owner && ownFields
          ? fieldPatchTargetMisses(
            String(baseDefinition.name ?? extension.name ?? ''),
            admittedPatches,
            ownFieldsTarget(merged, ownFields, (name) => !!recordFieldOf(merged, name)),
          )
          : [];
        this.reportFieldPatchMisses([...misses, ...residual], contrib.packageId);
        folded.push({ packageId: contrib.packageId, fields: extension.fields });
      }
    }
    this.reportRedeclaredFields(String(merged.name ?? baseDefinition.name ?? ''), contributors, ownFields, folded);
    // [#35901] Where each extension's own fields, groups and child lists go:
    // applied once, here, after every contributor's fields are merged, so the
    // anchors an extension names are the object's as served.
    const placing = placementContributorsOf(contributors);
    if (placing.length > 0) {
      const placed = applyExtensionPlacements(merged, placing, {
        objectName: String(merged.name ?? baseDefinition.name ?? ''),
        ownerGroupKeys: fieldGroupKeysOf(owner),
        childPackageOf: (child) => {
          const fqn = this.resolveObjectKey(child);
          const childOwner = fqn === undefined ? undefined : this.getObjectOwner(fqn);
          if (childOwner === undefined) return undefined;
          return childOwner.packageId ?? null;
        },
      });
      merged = placed.object;
      this.reportExtensionPlacements(placed.notes);
    }
    if (tenantRules) this.reportChangedRuleCopies(contributors, baseDefinition);
    // A picklist-bound field is served with its list's options resolved onto
    // it — here, in the fold every object read and the write door share, so
    // the set a client is offered and the set a write is judged by are one.
    return this.finishServedObject(merged, layer, picklistReferrerOf(contributors));
  }

  /**
   * [#28835] Name, once, each field name of the object that more than one
   * contributor declares in `fields`: two extensions both adding it, or an
   * extension redeclaring a field the owner declares (one of `ownFields`). The
   * merge spreads `fields`, so the definition served is the last one the fold
   * applied: contributions fold in ascending `priority`, and at equal priority
   * in the order they registered, so the one registered last. The line names
   * the object, the field, every declaring package in that order, and the one
   * whose definition is served.
   *
   * Judged from the contributors' own declarations (`folded`, as the merge
   * took them), never from the running body, so a base that already carries
   * the extensions' fields (a folded body handed to
   * {@link foldObjectExtendersOnto}, a stored overlay row) is not read as a
   * redeclaration. `fieldPatches` is not a declaration and is not counted
   * ({@link reportFieldPatchMisses} names a patch that misses). A `.custom`
   * pair's `__c` field and a dependent's plain one never share a name.
   *
   * ⛔ Never a refusal, and the served definition is unchanged: the same
   * reasons as {@link reportFieldPatchMisses} (the fold runs on every read
   * while a boot is still registering packages). At `warn`: one package's
   * definition of the field is not served.
   */
  static reportRedeclaredFields(this: Pick<ObjectRegistrationHost, 'redeclaredFieldsWarned'>, object: string, contributors: readonly ObjectContributor[], ownFields: ReadonlySet<string> | undefined, folded: readonly FoldedExtensionFields[]): void {
    if (folded.length === 0) return;
    const owner = contributors.find((c) => c.ownership === 'own');
    const declarers = new Map<string, Array<{ packageId: string | undefined; owner: boolean }>>();
    for (const { packageId, fields } of folded) {
      if (!isPlainRecord(fields)) continue;
      for (const name of Object.keys(fields)) {
        let list = declarers.get(name);
        if (!list) {
          list = owner && ownFields?.has(name) ? [{ packageId: owner.packageId, owner: true }] : [];
          declarers.set(name, list);
        }
        list.push({ packageId, owner: false });
      }
    }
    const named = (packageId: string | undefined) => (packageId ? `"${packageId}"` : '(no package)');
    for (const [field, list] of declarers) {
      if (list.length < 2) continue;
      const key = `${object}|${field}|${list.map((d) => d.packageId ?? '').join(',')}`;
      if (this.redeclaredFieldsWarned.has(key)) continue;
      this.redeclaredFieldsWarned.add(key);
      const extenders = list.filter((d) => !d.owner).map((d) => named(d.packageId));
      const declaredBy = list[0]!.owner
        ? `the owner ${named(list[0]!.packageId)} and by extensions from ${extenders.join(', ')}`
        : `extensions from ${extenders.join(', ')}`;
      console.warn(
        `[Registry] Field "${field}" of object "${object}" is declared in \`fields\` by ${declaredBy}; ` +
          `the definition served is the one from ${named(list[list.length - 1]!.packageId)}, the last the fold applies ` +
          '(ascending `priority`; at equal priority, the one registered last). Rename the field in one extension, ' +
          'or patch an owner field\'s display properties instead of redeclaring it.',
      );
    }
  }

  /**
   * [ADR-0146 D10, second rule] Name, once, each patch the fold did not apply
   * because the judge missed it: a field that is not one of the owner's own
   * (absent, or added only by an extension), an option value the owner's field
   * does not declare (one an extension adds by redeclaring the field through
   * `fields` included, #28809), or an option of a picklist-bound field. The
   * verdict (`misses`) is the install door's and `os validate`'s own judge
   * (`fieldPatchTargetMisses`), asked by the fold of the owner's declaration
   * ({@link ownFieldsTarget}) as those doors ask it, so the boot names exactly
   * what they refuse — plus, asked again of the merged fields, an admitted
   * option an earlier layer left out, which had nothing to relabel. What the
   * fold names is what it skipped. With no owner registered there is nothing
   * to judge against, and nothing is named.
   *
   * ⛔ Never a refusal, and worded as the state it observes: the fold runs on
   * every read while a boot is still registering packages, and an owner that
   * registers again declaring the field (an upgrade) makes the patch apply on
   * the next read, with nothing recorded to undo (AGENTS.md *Startup registry
   * reads*). At `warn`: the object is visibly unpatched, and nothing durable
   * is lost.
   */
  static reportExtensionPlacements(this: Pick<ObjectRegistrationHost, 'extensionPlacementNotesWarned'>, notes: readonly ExtensionPlacementNote[]): void {
    for (const placementNote of notes) {
      if (this.extensionPlacementNotesWarned.has(placementNote.key)) continue;
      this.extensionPlacementNotesWarned.add(placementNote.key);
      console.warn(placementNote.message);
    }
  }

  static reportFieldPatchMisses(this: Pick<ObjectRegistrationHost, 'fieldPatchMissesWarned'>, misses: readonly FieldPatchTargetMiss[], packageId: string | undefined): void {
    for (const miss of misses) {
      const object = miss.object;
      const key = `${object}|${packageId ?? ''}|${miss.field}|${miss.option ?? ''}`;
      if (this.fieldPatchMissesWarned.has(key)) continue;
      this.fieldPatchMissesWarned.add(key);
      console.warn(
        `[Registry] An extension of object "${object}"${packageId ? ` from package "${packageId}"` : ''} ` +
          `carries a field patch that is not applied while the object has no such target: ${miss.message}`,
      );
    }
  }

  /**
   * [ADR-0142 D3] An extender's body without its own `queue` field, for a base
   * that plans the column; the body itself when it declares none or carries
   * the platform's own definition (a served document coming back). The first
   * drop per object and package is named once, with the remedy the
   * registration door's refusal prescribes.
   */
  static withoutExtensionQueueField(this: Pick<ObjectRegistrationHost, 'shadowedExtensionQueueWarned'>, extension: ServiceObject, packageId: string | undefined): ServiceObject {
    const fields = extension.fields as Record<string, unknown> | undefined;
    const declared = fields?.[QUEUE_FIELD];
    if (declared === undefined || isInjectedColumnDefinition(declared, QUEUE_FIELD_DEF)) return extension;
    const { [QUEUE_FIELD]: _dropped, ...rest } = fields!;
    const key = `${extension.name}|${packageId ?? ''}`;
    if (!this.shadowedExtensionQueueWarned.has(key)) {
      this.shadowedExtensionQueueWarned.add(key);
      console.warn(
        `[Registry] An extension of object "${extension.name}"${packageId ? ` from package "${packageId}"` : ''} ` +
          'declares a field named `queue`, which the platform reserves on an object whose records have a user ' +
          'owner: it holds the ownership queue a record without an owner sits in. The extension\'s `queue` is ' +
          'ignored and the platform\'s column stands. Rename the business field (for example `support_queue`).',
      );
    }
    return { ...extension, fields: rest } as ServiceObject;
  }

  /**
   * The tail every object read ends in — {@link resolveObject} (through
   * {@link foldExtendersOntoDefinition}), the code layer, and
   * {@link foldObjectExtendersOnto}, which the protocol's stored-row and
   * MetadataService layers run. A step added here reaches every one of them.
   *
   * 1. picklist-bound fields get their list's options resolved onto them;
   * 2. [#24400] the bound top-level actions are attached — the code
   *    packages' and, [#28356], the runtime-authored ones
   *    ({@link attachBoundActions}). The CODE layer
   *    ({@link resolveOwnerLayer}, `layer: 'code'`) attaches the code
   *    packages' alone: a tenant's action is not something a code package
   *    ships, and `getArtifactItem('object')` answers exactly that question.
   */
  static finishServedObject<T>(this: Pick<ObjectRegistrationHost, 'attachBoundActions' | 'resolvePicklistFields'>, body: T, layer: ServedObjectLayer = 'served', referrerOf: PicklistReferrer = NO_PACKAGE_REFERRER): T {
    return this.attachBoundActions(this.resolvePicklistFields(body, referrerOf), layer);
  }

  /**
   * [#24400] Attach to an object the top-level actions that code packages
   * bind to it by `objectName` — whichever package registered them, and in
   * either registration order.
   *
   * `defineStack()` merges a bound action into its target only when the target
   * is in the SAME stack (`mergeActionsIntoObjects`). An action bound to an
   * object another package owns — the route `ObjectExtensionSchema`'s
   * `guidance.actions` names, since an extension cannot carry `actions` — stays
   * at the stack's top level and registers here as a standalone `action` item.
   * The router already dispatched it (`resolveRouteActionDeclaration`, rung 2),
   * but no served object listed it, so no client rendered it. Attaching it
   * HERE, at read time, is what makes it order-independent: the object and
   * the action may register in either order, and the cached fold is dropped
   * when an action registers ({@link registerItem}) or leaves.
   *
   * What attaches: a standalone `action` item this registry serves
   * ({@link boundServedActions}) — one a code package shipped, or [#28356] one
   * a runtime author saved through the metadata door, which the save's
   * write-through and the boot's `sys_metadata` hydration register here —
   * whose owner key ({@link standaloneActionOwnerKey}, the router's own test)
   * is this object's name, and whose package is not disabled. Attached BY
   * REFERENCE, so the served entry is the very declaration rung 2 resolves:
   * its `requiredPermissions`, `requiresMembershipReach` and execution
   * identity travel with it unchanged, and nothing about the object's own
   * write policy moves.
   *
   * Deduplicated by NAME, which is also what makes the step idempotent over a
   * body that already carries the action — the same-stack merge's copy, a
   * MetadataService copy bridged from {@link getAllObjects}, or a stored row
   * written back from a served read. An action the object already declares
   * keeps the object's declaration, the precedence the router applies (rung 1
   * before rung 2); when the two declarations differ, the ObjectQL plugin
   * reports the pair at boot ({@link FIND_BOUND_ACTION_COLLISIONS}). A target no
   * package registers is refused at boot, not here — see
   * {@link findUnboundActionTargets}.
   *
   * The object's own `actions` keep their order exactly — re-sorting them by
   * `order` here would reorder an object no package bound anything to the
   * moment one did. The attached actions follow, stable-sorted among
   * themselves by `order`.
   *
   * Returns `body` by reference when nothing attaches.
   */
  static attachBoundActions<T>(this: Pick<ObjectRegistrationHost, 'boundCodeActions' | 'boundServedActions' | 'isActionWithheldByDisabledPackage' | 'metadata'>, body: T, layer: ServedObjectLayer = 'served'): T {
    if (body === null || typeof body !== 'object') return body;
    const objectName = (body as { name?: unknown }).name;
    if (typeof objectName !== 'string' || objectName === '') return body;
    const declared = (body as { actions?: unknown }).actions;
    const base: any[] = Array.isArray(declared) ? declared : [];
    // [#28877] On the SERVED layer the object's own actions that launch into a
    // disabled package are withheld too ({@link isActionWithheldByDisabledPackage}),
    // as an attached one is: the same-stack merge puts a bound action here, not
    // in the collection below. The code layer is the artifact as shipped and
    // keeps them. A withheld name still blocks an attached twin of that name,
    // so nothing stands in for it.
    const kept = layer === 'served' ? base.filter((action) => !this.isActionWithheldByDisabledPackage(action)) : base;
    const present = new Set<unknown>(base.map((action) => action?.name));
    const fresh: any[] = [];
    const collection = this.metadata.get('action');
    if (collection && collection.size > 0) {
      for (const action of layer === 'code' ? this.boundCodeActions() : this.boundServedActions()) {
        if (standaloneActionOwnerKey(action) !== objectName || present.has(action.name)) continue;
        present.add(action.name);
        fresh.push(action);
      }
    }
    if (fresh.length === 0 && kept.length === base.length) return body;
    // The object's own actions keep their served order, untouched; the
    // attached ones follow, ordered among themselves by `order`.
    return { ...body, actions: [...kept, ...sortActionsByOrder(fresh)] };
  }

  /**
   * [#28356] The standalone `action` items bound to an object that this
   * registry SERVES — the population {@link attachBoundActions} attaches.
   *
   * Every bound item in the collection, whoever authored it: a code package's
   * (under its `<packageId>:<name>` key) and a runtime author's, which the
   * save door's write-through and the boot's `sys_metadata` hydration register
   * (under the bare name, or a bound package's key with `_provenance: 'org'`).
   * Leaving the runtime rows out made a bound action saved through the
   * metadata door dispatchable (rung 2 reads {@link getItem}) yet listed by no
   * served object, so no client drew it.
   *
   * One item per name where {@link getItem} would pick one: a bare-key entry
   * (an ADR-0005 overlay) shadows the composite entries of its name, so a
   * customised bound action is attached as customised — the declaration rung 2
   * resolves — and never as the packaged default under it.
   *
   * The registry holds no org-scoped row (the protocol's hydration declines
   * one), so nothing here crosses an organization. A disabled package's items
   * are left out, as the rest of its items are withheld.
   *
   * ⛔ Not the boot audits' population: a runtime row naming an object no
   * package registers must not fail a boot, so {@link findUnboundActionTargets}
   * and {@link FIND_BOUND_ACTION_COLLISIONS} keep reading
   * {@link boundCodeActions}.
   */
  static boundServedActions(this: Pick<ObjectRegistrationHost, 'isActionWithheldByDisabledPackage' | 'metadata' | 'rankedForPackage'>): any[] {
    const collection = this.metadata.get('action');
    if (!collection) return [];
    // [#33127, ADR-0150 D4] A stored row in a package overlay slot shadows the
    // composite entry of the package it customizes (its envelope's), as the
    // bare slot shadows every composite of its name; of two rows customizing
    // one package, the one its read serves ({@link rankedForPackage}).
    const overlaysOf = new Map<string, BundleEntry[]>();
    for (const [key, item] of collection) {
      if (parseOverlaySlotKey(key) === undefined) continue;
      const holder = storedRowPackageOf({ key: '', item }) ?? parseOverlaySlotKey(key)!.packageId;
      const group = `${holder}:${String((item as any)?.name)}`;
      overlaysOf.set(group, [...(overlaysOf.get(group) ?? []), { key, item }]);
    }
    const servedOverlays = new Set<string>();
    for (const [group, entries] of overlaysOf) {
      servedOverlays.add(this.rankedForPackage(entries, group.slice(0, group.lastIndexOf(':')))[0].key);
    }
    const out: any[] = [];
    for (const [key, action] of collection) {
      if (!action || typeof action !== 'object' || typeof (action as any).name !== 'string') continue;
      const name: string = (action as any).name;
      // [ADR-0150 D4] A package-less action of another owner key than the
      // bare slot's is its own item, never shadowed by it.
      if (key !== name && !isPackagelessActionSlotKey(key) && collection.has(name)) continue;
      if (parseOverlaySlotKey(key) !== undefined ? !servedOverlays.has(key) : overlaysOf.has(key)) continue;
      if (isObjectLessActionKey(standaloneActionOwnerKey(action))) continue;
      // [#28877] …and so is an action that launches into a disabled package.
      if (this.isActionWithheldByDisabledPackage(action)) continue;
      out.push(action);
    }
    return out;
  }

  /**
   * [#24400] The standalone `action` items code packages ship that are bound
   * to an object — the population {@link findUnboundActionTargets} and
   * {@link FIND_BOUND_ACTION_COLLISIONS} audit. A disabled package's actions
   * are left out, as the rest of its items are withheld.
   */
  static boundCodeActions(this: Pick<ObjectRegistrationHost, 'isPackageDisabled' | 'metadata'>): any[] {
    const out: any[] = [];
    for (const action of this.metadata.get('action')?.values() ?? []) {
      if (!action || typeof action !== 'object' || typeof (action as any).name !== 'string') continue;
      if (!isCodeArtifactBody(action)) continue;
      if (isObjectLessActionKey(standaloneActionOwnerKey(action))) continue;
      if (this.isPackageDisabled((action as any)._packageId)) continue;
      out.push(action);
    }
    return out;
  }

  /** The body of `SchemaRegistry#findUnboundActionTargets`; the method's docblock there is its contract. */
  static findUnboundActionTargets(this: Pick<ObjectRegistrationHost, 'boundCodeActions' | 'resolveObjectKey'>): UnboundActionTarget[] {
    const out: UnboundActionTarget[] = [];
    for (const action of this.boundCodeActions()) {
      const objectName = standaloneActionOwnerKey(action);
      if (this.resolveObjectKey(objectName) !== undefined) continue;
      out.push({ action: action.name, objectName, packageId: action._packageId });
    }
    return out;
  }

  /**
   * [ADR-0029 D9.2a] Which of the three fold scalars the BASE layer carries a
   * TENANT-AUTHORED value for — i.e. one that no longer equals the packaged
   * owner's.
   *
   * Maintainer ruling, 2026-08-13 (option A, "tenant wins"): an extender's
   * scalar applies only while the fold's base still carries the packaged
   * owner's value; a diverged base has been authored by the tenant and the
   * extender yields. This **amends ADR-0029 D9.2**, whose fold was
   * unconditionally last-writer-wins on the scalars, and it is deliberately the
   * SAME comparison-based mechanism the #8284 fix applies one layer up — the
   * predicate is literally {@link scalarOverridesPackagedBase}, imported from
   * `@objectstack/spec`, not a second copy of the shape. One sentence at both
   * layers: *an explicit override beats a packaged default.*
   *
   * ⛔ No provenance flag is stamped on the document and no migration is
   * implied: the question is answered from two values, at fold time.
   *
   * The accepted cost is the point, not a regression — a package can no longer
   * relabel an object a tenant has deliberately renamed. There is no escape
   * hatch for it, by ruling.
   *
   * Conservative in the same three ways the predicate is (absent base, non-string
   * or empty value, exact equality), plus two of this layer's own:
   *
   *  - **no `own` contributor → no opinion.** An orphan overlay (D9.5) keeps
   *    today's fold exactly.
   *  - **base IS the packaged owner → no opinion, by reference.** That is
   *    {@link resolveObject} with no overlay registered and every
   *    {@link resolveOwnerLayer} call (D9.6), so the common shape pays one
   *    identity comparison and cannot change answer. It is an OPTIMISATION, not
   *    a correctness edge: comparing that base against itself answers "not
   *    diverged" for every key anyway. ⛔ So it must never be relaxed into
   *    something weaker than identity — a value-equality test here would start
   *    answering for bodies that merely LOOK like the owner.
   *
   * ⛔ The owner is read as the `own` CONTRIBUTOR, deliberately NOT through
   * {@link getPackagedObjectOwner} — whose extra `isCodeArtifactBody` test
   * (D9.8) would make this decline to protect a RUNTIME-authored object, i.e.
   * exactly the object whose owner row the tenant wrote by hand. The two agree
   * wherever a packaged owner exists, which is every shape the ADR-0029 D9.2a amendment records; they
   * differ only on a tenant-authored owner, and there the ruled sentence still
   * reads the same way — the tenant's own row is the explicit override and a
   * package's `objectExtensions` entry is the packaged default. The rejected
   * alternative is the trap commit 427344c26 named one layer up, in its own form:
   * comparing against a body that already has extenders folded onto it
   * ({@link resolveOwnerLayer}) would report every extender's scalar as
   * "unchanged" and yield nothing, ever.
   *
   * IDEMPOTENCE is preserved, which matters because
   * {@link foldObjectExtendersOnto} is documented as idempotent (#8027) and two
   * shipped call sites really do hand it an already-folded base. A base that
   * already carries an extender's scalar reads as "diverged", so every extender
   * yields and the value stays exactly what the first fold produced — the same
   * answer, reached by yielding instead of by re-applying.
   */
  static tenantAuthoredScalars(contributors: ObjectContributor[], baseDefinition: ServiceObject): ReadonlySet<ObjectFoldScalarKey> | undefined {
    const owner = contributors.find((c) => c.ownership === 'own')?.definition;
    if (!owner || owner === baseDefinition) return undefined;
    let authored: Set<ObjectFoldScalarKey> | undefined;
    for (const key of OBJECT_FOLD_SCALAR_KEYS) {
      if (scalarOverridesPackagedBase(owner, key, baseDefinition[key])) {
        (authored ??= new Set()).add(key);
      }
    }
    return authored;
  }

  /**
   * [ADR-0146 D10, second rule; ADR-0029 D9.2a] The display keys a fold's base
   * has authored away from the packaged owner's value, on the fields and
   * options the `extend` contributors patch — each a {@link fieldPatchYieldKey}.
   * A patch yields on those keys, as an extender's scalar yields on
   * {@link tenantAuthoredScalars}, and by the same comparison
   * ({@link displayKeyOverridesPackagedBase}).
   *
   * The same two "no opinion" edges as {@link tenantAuthoredScalars}, for its
   * reasons: no `own` contributor, or a base that IS the owner's body (by
   * reference). Idempotent over a folded base for its reason too: a base that
   * already carries a patch's text reads as authored, so the patch yields and
   * the value stays what the first fold produced.
   */
  static tenantPatchedDisplayKeys(contributors: ObjectContributor[], baseDefinition: ServiceObject): ReadonlySet<string> | undefined {
    const owner = contributors.find((c) => c.ownership === 'own')?.definition;
    if (!owner || owner === baseDefinition) return undefined;
    let authored: Set<string> | undefined;
    for (const contrib of contributors) {
      if (contrib.ownership !== 'extend') continue;
      const patches = (contrib.definition as ObjectExtensionBody).fieldPatches;
      if (!patches) continue;
      for (const [name, patch] of Object.entries(patches)) {
        const packagedField = recordFieldOf(owner, name);
        const baseField = recordFieldOf(baseDefinition, name);
        if (!patch || !packagedField || !baseField) continue;
        for (const key of BASE_FIELD_DISPLAY_WHITELIST.field) {
          if (displayKeyOverridesPackagedBase(packagedField, key, baseField[key])) {
            (authored ??= new Set()).add(fieldPatchYieldKey(name, key));
          }
        }
        for (const value of Object.keys(patch.options ?? {})) {
          const packagedOption = optionByValue(packagedField, value);
          const baseOption = optionByValue(baseField, value);
          if (!packagedOption || !baseOption) continue;
          for (const key of BASE_FIELD_DISPLAY_WHITELIST.option) {
            if (displayKeyOverridesPackagedBase(packagedOption, key, baseOption[key])) {
              (authored ??= new Set()).add(fieldPatchYieldKey(name, key, value));
            }
          }
        }
      }
    }
    return authored;
  }

  /**
   * [ADR-0029 D9.2a, 2026-10-30 note] The `message` / `active` a TENANT base
   * sets on its rules, by name — `undefined` when the fold's base is a code
   * layer, where a later layer's same-named rule replaces the earlier one
   * whole, as a field does.
   *
   * The base is the tenant's when it is not the `own` contributor's body (the
   * overlay layer, a stored row, a served copy — the identity test
   * {@link tenantAuthoredScalars} makes), or when the owner itself is
   * tenant-authored (a runtime-authored object). Idempotent over a folded body:
   * its copies already carry what the first fold produced.
   */
  static tenantRuleSettings(contributors: ObjectContributor[], baseDefinition: ServiceObject): ReadonlyMap<string, TenantRuleSettings> | undefined {
    const owner = contributors.find((c) => c.ownership === 'own')?.definition;
    if (!owner) return undefined;
    if (owner === baseDefinition && !isTenantAuthored(baseDefinition)) return undefined;
    return tenantRuleSettingsOf(baseDefinition.validations);
  }

  /**
   * [ADR-0029 D9.2a, 2026-10-30 note] A tenant base whose rules include copies
   * of the packaged OWNER's rules, with each copy replaced by the owner's rule
   * carrying the copy's `message` and `active` — so a package fix to the rule
   * reaches the tenant, and the copy's own condition never runs.
   *
   * Only names the base carries: a rule the overlay leaves out stays out, as
   * D9.2's replace has always meant. A second copy of one name (a row stored
   * while the fold still appended) is dropped. The base is returned as a fresh
   * spread either way, as the fold has always started from one.
   */
  static withPackagedOwnerRules(contributors: ObjectContributor[], baseDefinition: ServiceObject, tenantRules: ReadonlyMap<string, TenantRuleSettings>): ServiceObject {
    const merged = { ...baseDefinition };
    const owner = contributors.find((c) => c.ownership === 'own')?.definition;
    if (!owner || owner === baseDefinition || !isCodeArtifactBody(owner)) return merged;
    const ownerRules = new Map<string, unknown>();
    for (const rule of owner.validations ?? []) {
      const name = validationRuleName(rule);
      if (name !== undefined && !ownerRules.has(name)) ownerRules.set(name, rule);
    }
    const baseRules = baseDefinition.validations;
    if (ownerRules.size === 0 || !Array.isArray(baseRules) || baseRules.length === 0) return merged;
    const seen = new Set<string>();
    const rules: unknown[] = [];
    for (const rule of baseRules) {
      const name = validationRuleName(rule);
      const packaged = name === undefined ? undefined : ownerRules.get(name);
      if (packaged === undefined) {
        rules.push(rule);
      } else if (!seen.has(name!)) {
        seen.add(name!);
        rules.push(withTenantRuleSettings(packaged, tenantRules.get(name!)));
      }
    }
    merged.validations = rules as ServiceObject['validations'];
    return merged;
  }

  /**
   * [ADR-0029 D9.2a, 2026-10-30 note] Every rule a CODE layer of this object
   * ships, by name, in fold order — the packaged owner's (when the owner is a
   * code artifact), then each code `extend` contributor's, a later layer's
   * rule replacing an earlier one of its name. What a tenant's copy of a rule
   * is compared with ({@link tenantRuleCopyRefusal},
   * {@link reportChangedRuleCopies}) and what {@link getPackagedObjectBase}
   * serves as the packaged rule set.
   */
  static packagedRules(contributors: readonly ObjectContributor[]): unknown[] | undefined {
    let rules: unknown[] | undefined;
    const owner = contributors.find((c) => c.ownership === 'own');
    if (owner && isCodeArtifactBody(owner.definition) && Array.isArray(owner.definition.validations)) {
      rules = [...owner.definition.validations];
    }
    for (const contrib of contributors) {
      if (contrib.ownership !== 'extend' || !isCodeArtifactBody(contrib.definition)) continue;
      const list = contrib.definition.validations;
      if (!Array.isArray(list) || list.length === 0) continue;
      rules = mergeValidationsByName(rules, list, undefined);
    }
    return rules;
  }

  /** The body of `SchemaRegistry#tenantRuleCopyRefusal`; the method's docblock there is its contract. */
  static tenantRuleCopyRefusal(this: Pick<ObjectRegistrationHost, 'objectContributors' | 'packagedRules' | 'resolveObjectKey'>, name: string, body: unknown): Error | null {
    const fqn = this.resolveObjectKey(name);
    const contributors = fqn === undefined ? undefined : this.objectContributors.get(fqn);
    if (!contributors) return null;
    const packaged = new Map<string, unknown>();
    for (const rule of this.packagedRules(contributors) ?? []) {
      const ruleName = validationRuleName(rule);
      if (ruleName !== undefined) packaged.set(ruleName, rule);
    }
    if (packaged.size === 0) return null;
    const rules = (body as { validations?: unknown } | null | undefined)?.validations;
    if (!Array.isArray(rules)) return null;
    for (const rule of rules) {
      const ruleName = validationRuleName(rule);
      if (ruleName === undefined || !packaged.has(ruleName)) continue;
      const changed = changedPackagedRuleKeys(rule, packaged.get(ruleName));
      if (changed.length > 0) return new ValidationRuleCopyRefusedError(fqn!, ruleName, changed);
    }
    return null;
  }

  /**
   * [ADR-0029 D9.2a, 2026-10-30 note] Say, once, that a tenant base carries a
   * copy of a packaged rule that changes what the package owns. The fold has
   * already enforced the package's rule; the stored copy's condition is not
   * what runs, while the object serves normally, so this is an `error` with
   * its consequence and its fix. Reported, never refused, here: a stored copy
   * also differs after a package upgrade changes the rule, and refusing it
   * would drop the tenant's whole layer at boot.
   */
  static reportChangedRuleCopies(this: Pick<ObjectRegistrationHost, 'packagedRules' | 'reportedRuleCopyChanges'>, contributors: ObjectContributor[], baseDefinition: ServiceObject): void {
    const rules = baseDefinition.validations;
    if (!Array.isArray(rules) || rules.length === 0) return;
    const packaged = new Map<string, unknown>();
    for (const rule of this.packagedRules(contributors) ?? []) {
      const ruleName = validationRuleName(rule);
      if (ruleName !== undefined) packaged.set(ruleName, rule);
    }
    if (packaged.size === 0) return;
    const reported = new Set<string>();
    for (const rule of rules) {
      const ruleName = validationRuleName(rule);
      if (ruleName === undefined || reported.has(ruleName) || !packaged.has(ruleName)) continue;
      reported.add(ruleName);
      const changed = changedPackagedRuleKeys(rule, packaged.get(ruleName));
      if (changed.length === 0) continue;
      const key = `${baseDefinition.name}|${ruleName}|${stableStringify(rule)}|${stableStringify(packaged.get(ruleName))}`;
      if (this.reportedRuleCopyChanges.has(key)) continue;
      this.reportedRuleCopyChanges.add(key);
      const keys = changed.map((k) => `\`${k}\``).join(', ');
      console.error(
        `[Registry] [validation_rule_copy_changed] Object "${baseDefinition.name}": the tenant's copy of ` +
          `validation rule "${ruleName}" changes ${keys} from the packaged rule. Only a packaged rule's ` +
          '`message` and `active` follow the tenant, so the package\'s rule is enforced with the tenant\'s ' +
          `message and switch, and the copy's ${keys} does not run, while the object serves normally. ` +
          'To change the condition, add a rule under a new name, or change it in the package. To keep the ' +
          'packaged rule, save the object again from its served definition.',
      );
    }
  }

  /** The body of `SchemaRegistry#foldObjectExtendersOnto`; the method's docblock there is its contract. */
  static foldObjectExtendersOnto<T>(this: Pick<ObjectRegistrationHost, 'finishServedObject' | 'foldExtendersOntoDefinition' | 'objectContributors' | 'resolveObjectKey' | 'subtractExtenderContributions' | 'withholdDisabledExtensions'>, name: string, base: T, options?: ObjectExtensionFoldOptions): T {
    if (base === null || typeof base !== 'object') return base;
    const fqn = this.resolveObjectKey(name);
    // With nothing to fold, the body still gets its picklist-bound fields
    // resolved — the same step the fold below ends with — so a body this
    // registry never saw is served in the one shape every other read uses.
    // By reference when no field names a picklist.
    if (fqn === undefined) return this.finishServedObject(base);
    // [#29903, #29872] The contributions `options` names are left out, as on
    // {@link getAllObjects} ({@link ObjectExtensionFoldOptions}).
    const registered = this.objectContributors.get(fqn);
    const listed = leavesExtensionsOut(options) ? registered?.filter((c) => !isLeftOutExtension(c, options)) : registered;
    // A disabled package's `extend` contributions are withheld, and taken off
    // a base that already carries them, as on {@link resolveObject} — unless
    // [#34901] `includeDisabledExtensions` asks for the storage fold.
    const withheld = listed && options?.includeDisabledExtensions !== true ? this.withholdDisabledExtensions(listed) : undefined;
    const contributors = withheld?.kept ?? listed;
    const served = withheld ? withoutWithheldMembers(base as unknown as ServiceObject, withheld) : base as unknown as ServiceObject;
    if (!contributors || !contributors.some((c) => c.ownership === 'extend')) {
      return this.finishServedObject(served as unknown as T, 'served', picklistReferrerOf(contributors));
    }
    return this.foldExtendersOntoDefinition(
      contributors,
      this.subtractExtenderContributions(contributors, served),
    ) as unknown as T;
  }

  /**
   * [#8268] The ADR-0079 object-materialization block itself, as ONE function.
   *
   * Every stamp this registry puts on a base layer at registration time lives
   * HERE, and {@link registerObject} calls it rather than spelling the sequence
   * out — so {@link materializeServedObjectOnto}, which replays it onto a body
   * that never came through `registerObject`, is the SAME code and not a second
   * copy free to drift from it.
   *
   * That property is the whole point, and it is the lesson three cards taught
   * one at a time. Each of #6562 (injected system columns), #8038 (`__search`)
   * and #8268 (`nameField`) is the same shape: a stamp the registry applies at
   * this seam, absent from the copy a `/meta` read serves, found and filed
   * SEPARATELY because nothing tied the stamps together. A fourth stamp added
   * to this method is converged at the read exits the day it is added, with no
   * fourth card and no fourth patch — which is what "fix the class" means here.
   *
   * ⛔ Order is contractual, not incidental: `provisionPrimary` runs BEFORE
   * `provisionSearchCompanion` because the companion's source is resolved over
   * the post-designation document. Keep additions in the order the seam applies
   * them.
   *
   * @param opts.designatePrimary - `false` withholds ONLY the ADR-0079
   *   designation step. See {@link materializeServedObjectOnto} for the one
   *   caller that passes it and why the choice is not this method's to make.
   * @param opts.provisionCompanion - `false` withholds ONLY the `__search`
   *   step, for the same reason and from the same caller (#8376).
   */
  static materializeBaseLayer(this: Pick<ObjectRegistrationHost, 'applyDeploymentTenancy' | 'multiTenant' | 'searchCompanion'>, schema: ServiceObject, opts?: { designatePrimary?: boolean; provisionCompanion?: boolean }): ServiceObject {
    let out = schema;

    // [ADR-0131 D7] The deployment's platform-global declaration, recorded on
    // the base layer. FIRST, because every later stamp asks its question of the
    // object as this deployment provisions it — the tenant index below must
    // see a declared object as carrying no tenant column. See
    // {@link applyDeploymentTenancy}; its write-side inverse is the LAST strip
    // in {@link stripMaterializedStampsFrom}.
    out = this.applyDeploymentTenancy(out);

    // [ADR-0079] DESIGNATE-ONLY primary-title provisioning — `synthesize:
    // false` never adds a column, so this is safe against title-less
    // system/junction tables (see the call in `registerObject` for the full
    // reasoning on why synthesis is refused at this seam).
    if (opts?.designatePrimary !== false) {
      out = provisionPrimary(out, { synthesize: false });
    }

    // [#2486] Search-normalization companion column (`__search`). Runs AFTER
    // `provisionPrimary` so the just-designated `nameField` is visible, and
    // ONLY when the deployment enables pinyin search — the column is a real
    // additive migration (ADR-0045) that the driver's `syncSchema`
    // materializes, populated by plugin-pinyin-search's before-save hooks and
    // OR-ed into `$search` by the engine's `expandSearchToFilter`.
    if (this.searchCompanion && opts?.provisionCompanion !== false) {
      out = provisionSearchCompanion(out);
    }

    // [#8375] The tenant-scope index — the fourth stamp of this seam, and the
    // first one added AFTER #8268 generalised it. It needed no new method here,
    // no new method in the protocol and no new convergence at the read exits:
    // being a step of this block IS the convergence, which is the property
    // #8268 exists to provide. Runs LAST because it is the only stamp gated on
    // a DEPLOYMENT flag rather than on the document, so nothing it appends can
    // change the answer the two steps above reached over the fields map.
    out = provisionTenantScopeIndex(out, { multiTenant: this.multiTenant });

    return out;
  }

  /** The body of `SchemaRegistry#materializeServedObjectOnto`; the method's docblock there is its contract. */
  static materializeServedObjectOnto<T>(this: Pick<ObjectRegistrationHost, 'declinedBaseLayerStamps' | 'materializeBaseLayer'>, base: T): T {
    if (base === null || typeof base !== 'object') return base;
    const declined = this.declinedBaseLayerStamps(base);
    return this.materializeBaseLayer(base as never, {
      designatePrimary: !declined.primary,
      provisionCompanion: !declined.companion,
    }) as unknown as T;
  }

  /**
   * Which document-sensitive stamps did this registry resolve the object `base`
   * names and then DECLINE to apply to its base layer?
   * See {@link materializeServedObjectOnto} for why the question is asked at all.
   *
   * All-`false` — "no opinion" — for a body with no usable name and for a name
   * this registry does not know, which is the honest answer in both cases and is
   * also the safe one: an object that never reached `registerObject` has no
   * registry verdict to converge onto, and nothing could have folded such a body
   * either (the fold reads this same contributor list), so the body IS its own
   * base layer and the pure transform is exactly right for it.
   */
  static declinedBaseLayerStamps(this: Pick<ObjectRegistrationHost, 'getObject'>, base: unknown): { primary: boolean; companion: boolean } {
    const noOpinion = { primary: false, companion: false };
    const name = (base as { name?: unknown }).name;
    if (typeof name !== 'string' || name === '') return noOpinion;
    const resolved = this.getObject(name) as
      | { nameField?: unknown; fields?: unknown }
      | undefined;
    if (!resolved) return noOpinion;
    const fields = resolved.fields;
    const resolvedFields =
      fields && typeof fields === 'object' && !Array.isArray(fields)
        ? (fields as Record<string, unknown>)
        : undefined;
    return {
      primary: resolved.nameField === undefined,
      companion: resolvedFields?.[SEARCH_COMPANION_FIELD] === undefined,
    };
  }

  /** The body of `SchemaRegistry#provisionSearchCompanionOnto`; the method's docblock there is its contract. */
  static provisionSearchCompanionOnto<T>(this: Pick<ObjectRegistrationHost, 'searchCompanion'>, base: T): T {
    if (base === null || typeof base !== 'object') return base;
    if (!this.searchCompanion) return base;
    return provisionSearchCompanion(base as never) as unknown as T;
  }

  /** The body of `SchemaRegistry#stripProvisionedSearchCompanionFrom`; the method's docblock there is its contract. */
  static stripProvisionedSearchCompanionFrom<T>(base: T): T {
    if (base === null || typeof base !== 'object') return base;
    const fields = (base as { fields?: unknown }).fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return base;
    const present = (fields as Record<string, unknown>)[SEARCH_COMPANION_FIELD];
    if (present === undefined) return base;

    // Re-stamp a copy WITHOUT the column and compare: the canonical definition
    // comes from the provisioning function itself, and an object the seam would
    // not provision for yields no stamp and therefore no removal.
    const withoutCompanion = { ...(fields as Record<string, unknown>) };
    delete withoutCompanion[SEARCH_COMPANION_FIELD];
    const restamped = provisionSearchCompanion(
      { ...(base as Record<string, unknown>), fields: withoutCompanion } as never,
    ) as unknown as { fields?: Record<string, unknown> };
    const canonical = restamped.fields?.[SEARCH_COMPANION_FIELD];
    if (canonical === undefined) return base;
    if (stableStringify(present) !== stableStringify(canonical)) return base;

    return { ...(base as Record<string, unknown>), fields: withoutCompanion } as unknown as T;
  }

  /** The body of `SchemaRegistry#stripMaterializedStampsFrom`; the method's docblock there is its contract. */
  static stripMaterializedStampsFrom<T>(this: Pick<ObjectRegistrationHost, 'stripDeploymentTenancyFrom' | 'stripProvisionedPrimaryFrom' | 'stripProvisionedSearchCompanionFrom' | 'stripProvisionedTenantIndexFrom'>, base: T): T {
    if (base === null || typeof base !== 'object') return base;
    return this.stripDeploymentTenancyFrom(
      this.stripProvisionedPrimaryFrom(
        this.stripProvisionedSearchCompanionFrom(this.stripProvisionedTenantIndexFrom(base)),
      ),
    );
  }
}
