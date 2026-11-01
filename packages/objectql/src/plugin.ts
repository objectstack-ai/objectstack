// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
  ObjectQL,
  SECURITY_SERVICE_SOURCE_SLOT,
  collectionItemOwnerStampRefusal,
  permissionSetOwnerRegistrationRefusal,
  viewsEntryNotContainerRefusal,
  type UnservableControlledByParentMaster,
} from './engine.js';
import { OWNERSHIP_QUEUE_SOURCE_SLOT, describeMissingOwnershipQueueService } from './assignment-rules.js';
import { OWNERSHIP_QUEUE_SERVICE } from '@objectstack/spec/contracts';
import { assembleMetadataProtocol } from '@objectstack/metadata-protocol';
import { isTenantAuthored, readLegacyOrganizationRows } from '@objectstack/metadata-core';
import type { MetadataAuthoringChannel } from '@objectstack/metadata-protocol';
import { Plugin, PluginContext } from '@objectstack/core';
import { resolveArtifactPackageEntries, artifactPackageId, readDeploymentOrgScopingEntitlement } from '@objectstack/core';
// [ADR-0130 D4] The residual rule's decision half — which top-level items of a
// multi-package stack no body declares, and the id they take. See
// `unclaimedTopLevelObjects` below.
import { unclaimedTopLevel, type UnclaimedTopLevel } from '@objectstack/metadata';
// [ADR-0130 D4] The residual-picklist refusal: which lists, and the words —
// one judgement with `os validate` / `os build`. See `unreferencedResidualPicklistRefusal`.
import { unreferencedResidualPicklists } from '@objectstack/metadata/picklist-references';
import { applyConversionsToStoredItem, expandViewContainer, isAggregatedViewContainer, isViewContainerShaped } from '@objectstack/spec';
// [ADR-0017] The one object derivation of a view container and the one
// divergent-`name` judge, called by the residual's view registration as by a
// body's (see `registerUnclaimedTopLevelItems`).
import { deriveViewContainerObject } from '@objectstack/metadata/view-container';
import { viewContainerNameRefusal } from './view-container-name-refusal.js';
import { StorageNameMapping } from '@objectstack/spec/system';
import { applyProtection } from '@objectstack/spec/shared';
// [#21777] The ONE "is this schema the remote's?" predicate, shared with `ObjectQL.syncSchemas`.
import { isFederatedObject } from './federated-object.js';
// [#22070] The builtin audit stamps are wrapped like a bound hook but registered in code.
import { wrapDeclarativeHook } from './hook-wrappers.js';
import { LifecycleService } from './lifecycle/lifecycle-service.js';
import { lifecycleSettingsManifest } from './lifecycle/lifecycle-settings.js';
import type { DanglingReferenceAuditOptions } from './integrity/dangling-reference-audit.js';
import {
  GLOBAL_ACTION_OBJECT_KEY,
  runActionGovernanceInventory,
  standaloneActionOwnerKey,
} from './action-governance.js';
// [ADR-0126 §8] The packaged-action activation ledger's durable store. The
// engine holds the projection; this plugin is what attaches the store and
// hydrates it once the deployment has finished registering objects.
import {
  ObjectStoreActionActivationStore,
  ACTION_ACTIVATION_TABLE,
  type ActionActivationStoreEngine,
} from './action-activation.js';
import type { IMetadataService } from '@objectstack/spec/contracts';
import type { ServiceObject } from '@objectstack/spec/data';
import {
  collectManifestPicklistExtensions,
  collectManifestPicklistNames,
  collectManifestPicklistReferences,
  describeUnresolvedPicklistReferences,
  picklistMetadataError,
  type PicklistMetadataError,
} from './picklist-resolution.js';
// [ADR-0048 N.3] The security catalog's one-holder envelope, raised here by the
// cold-boot check (see `refuseEnvironmentHeldSecurityCatalogNames`).
import { SecurityCatalogNameConflictError, findEnvironmentHeldSecurityCatalogNames } from './registry.js';
// [ADR-0029 D3] The registry's own refusal of a second owner — read, never
// re-derived, when a residual object's name is already owned.
import { ObjectOwnershipConflictError, collectManifestBoundActions, collectManifestObjectNames, describeBoundActionCollision, describeUnboundActionTargets, FIND_BOUND_ACTION_COLLISIONS, type BoundActionCollision } from './registry.js';

export type { Plugin, PluginContext };

/**
 * Protocol extension for DB-based metadata hydration.
 * `loadMetaFromDb` is implemented by ObjectStackProtocolImplementation but
 * is NOT (yet) part of the canonical ObjectStackProtocol wire-contract in
 * `@objectstack/spec`, since it is a server-side bootstrap concern only.
 */
interface ProtocolWithDbRestore {
  loadMetaFromDb(): Promise<{
    loaded: number;
    errors: number;
    invalid?: number;
    /**
     * [#5897, ADR-0110 D3] True when the `sys_metadata` read itself failed for
     * a reason that is NOT "the table has not been provisioned yet" — i.e. the
     * row set never arrived, so `loaded: 0` is an outage rather than an empty
     * store. `restoreMetadataFromDb` branches on it to tell the two apart.
     *
     * Optional, like `invalid` above and for the same reason: this interface is
     * structural, matched by {@link hasLoadMetaFromDb} against whatever object
     * happens to be registered as `protocol`. A shim that predates the field
     * keeps type-checking and is simply read as "not an outage" — the same
     * verdict it could express before.
     */
    storeUnavailable?: boolean;
  }>;
}

/** Type guard — checks whether the service exposes `loadMetaFromDb`. */
/**
 * [ADR-0139 D5.2 / D5.3 · ADR-0049] The boot refusal for every
 * `controlled_by_parent` detail whose master the engine composes no
 * `ReadableIds` leaf over (`ObjectQL#findUnservableControlledByParentMasters`),
 * or `undefined` when there is none. Names each detail, its master field, the
 * master and the class, and the three remedies — an error, never a warning:
 * such a detail's access derives from a master the read path refuses by name.
 */
export function describeUnservableControlledByParentMasters(
  found: readonly UnservableControlledByParentMaster[],
): (Error & { code: string; status: number; httpStatus: number }) | undefined {
  if (found.length === 0) return undefined;
  const lines = found.map((u) => {
    const head = `'${u.detail}' (master field '${u.field}') over master '${u.master}'`;
    return u.class === 'object-scoped-read-middleware'
      ? `${head}, whose rows an object-scoped read middleware narrows (ADR-0139 D5.2)`
      : `${head}, which is bound to datasource '${String(u.parentDatasource)}' while '${u.detail}' is bound to `
        + `'${String(u.objectDatasource)}' (ADR-0139 D5.3)`;
  });
  const err = new Error(
    `${lines.length === 1 ? 'A controlled_by_parent detail derives its' : `${lines.length} controlled_by_parent details derive their`} `
    + `access from a master the engine cannot compose a read over: ${lines.join('; ')}. The detail's rows are `
    + 'readable through its master\'s readable ids, and the engine composes no such read over a master an '
    + 'object-scoped read middleware narrows (that WHERE is built at read time and is no part of the master\'s '
    + 'read scope) or over a master on another datasource (no driver evaluates a subquery across two), so every '
    + 'read of the detail would fail. Bind the detail and its master to one datasource; or choose a master without '
    + 'an object-scoped read middleware; or declare the detail without `controlled_by_parent`.',
  ) as Error & { code: string; status: number; httpStatus: number };
  err.code = 'INVALID_METADATA';
  err.status = 422;
  err.httpStatus = 422;
  return err;
}

function hasLoadMetaFromDb(service: unknown): service is ProtocolWithDbRestore {
  return (
    typeof service === 'object' &&
    service !== null &&
    typeof (service as Record<string, unknown>)['loadMetaFromDb'] === 'function'
  );
}

/**
 * The OBJECTS of a multi-package stack's residual, and the id they are owned
 * by — the residual rule's own answer (ADR-0130 D4), read through
 * `unclaimedTopLevel` (`@objectstack/metadata`), the one copy both boot doors
 * and `os validate` read. ⛔ Never re-derived here: which top-level items are
 * residual and which id they take is that function's decision, and a second
 * derivation would let this door and the metadata door disagree about it.
 *
 * Why the engine needs them: the `manifest` service registers the BODIES of a
 * stack that carries `packages[]` and never its top level, while the metadata
 * door registers the residual under the stack's `manifest.id` and the boot
 * says every door reports that id as their owner. Without this, a residual
 * object was listed by `GET /meta/object` and answered `404` on
 * `/data/<name>`, through both boot doors.
 *
 * @param residual - The stack's residual, as `unclaimedTopLevel` answers it,
 *   read once per registration and shared with {@link unclaimedTopLevelItems}.
 * @returns `undefined` when the stack has no residual object — every stack
 *   without `packages[]`, and every normally composed one.
 */
function unclaimedTopLevelObjects(
  residual: UnclaimedTopLevel | undefined,
): { ownerId: string | undefined; ownerVersion: string | undefined; objects: ServiceObject[] } | undefined {
  if (!residual) return undefined;
  const objects = residual.items
    .filter((entry) => entry.type === 'object')
    .map((entry) => entry.item as ServiceObject);
  return objects.length > 0
    ? { ownerId: residual.ownerId, ownerVersion: residual.ownerVersion, objects }
    : undefined;
}

/**
 * The residual types the engine does NOT register through
 * {@link unclaimedTopLevelItems}, each because it has a path of its own:
 *
 *  - `object`: {@link unclaimedTopLevelObjects}, through the registry's object
 *    verb, with the two classes it lists and does not serve;
 *  - `picklist`: kept as metadata only. A field naming a picklist only the
 *    residual declares is what the objects rule lists and does not serve, and
 *    a body's field naming one fails the boot's picklist audit — both loud,
 *    and both judged on that premise, so registering the residual's lists here
 *    would change which objects the data door serves. A residual list no
 *    object field names is refused instead
 *    ({@link unreferencedResidualPicklistRefusal});
 *  - `object_extension`: an extension has no slot of its own (it is keyed by
 *    `extend`, and its `name` spelling is a retired alias the schema refuses),
 *    so the residual rule never lists one.
 */
const RESIDUAL_TYPES_WITH_OWN_PATH: ReadonlySet<string> = new Set(['object', 'picklist', 'object_extension']);

/**
 * Every OTHER item of a multi-package stack's residual, and the id they are
 * owned by — the residual rule's answer read the way
 * {@link unclaimedTopLevelObjects} reads it, for every type a package body's
 * collections take into the registry (`registerApp`'s metadata collections).
 *
 * Why the engine needs them: a reader that asks the registry and not the
 * metadata service sees a residual item only if this registers it. Measured:
 * the engine registered a residual's objects, connectors (ADR-0015 D7: the
 * connector credential lender and the ADR-0097 reconcile) and flows (the
 * automation plugin's boot pull) and no other type, so every other residual
 * item was registered by the metadata door alone. Among the readers that then
 * answered "not declared": the metadata save door's managed-content seal
 * (`isArtifactBacked`, ADR-0131 D6), which asks the registry whether a code
 * package ships an item — so a residual security rule was not sealed the way
 * the same rule declared in a package body is.
 *
 * @returns `undefined` when the stack has no such residual item.
 */
function unclaimedTopLevelItems(
  residual: UnclaimedTopLevel | undefined,
): { ownerId: string | undefined; ownerVersion: string | undefined; items: Array<{ type: string; item: Record<string, unknown> }> } | undefined {
  if (!residual) return undefined;
  const items = residual.items
    .filter((entry) => !RESIDUAL_TYPES_WITH_OWN_PATH.has(entry.type))
    .map((entry) => ({ type: entry.type, item: entry.item as Record<string, unknown> }));
  return items.length > 0
    ? { ownerId: residual.ownerId, ownerVersion: residual.ownerVersion, items }
    : undefined;
}

/**
 * [ADR-0130 D4] The refusal for a residual PICKLIST that no object field of
 * the stack names — `undefined` when there is none.
 *
 * A residual picklist is kept as metadata only (see
 * {@link RESIDUAL_TYPES_WITH_OWN_PATH}), so the engine never registers it.
 * One that a field names is loud already: a residual object's field makes
 * that object listed and not served, and a body's field fails the boot's
 * picklist audit. One that no field names would go missing from the engine
 * with nothing said, so it is refused here, before anything of the artifact
 * registers, naming each list and the stack.
 *
 * Which lists, judged off which fields, and the words are ONE judgement,
 * `unreferencedResidualPicklists` (`@objectstack/metadata/picklist-references`,
 * whose header says which fields count): `os validate` and `os build` refuse
 * the same lists from it as `picklist-residual-unreferenced`, one finding per
 * list. This seam only throws its one sentence in the picklist envelope.
 * ⛔ Never compose the text here.
 */
function unreferencedResidualPicklistRefusal(
  residual: UnclaimedTopLevel | undefined,
  bodies: readonly unknown[],
): PicklistMetadataError | undefined {
  const unreferenced = unreferencedResidualPicklists(residual, bodies);
  return unreferenced ? picklistMetadataError(unreferenced.wording.text) : undefined;
}

/**
 * Options for ObjectQLPlugin.
 *
 * `environmentId` declares that this kernel serves ONE environment. It is a
 * topology declaration, not a row filter. ADR-0005 (revised 2026-05) gave every
 * environment its own physical database, so `protocol.saveMetaItem` stamps no
 * `environment_id` column on new sys_metadata rows and `protocol.loadMetaFromDb`
 * constrains on none — the isolation key that survived is `organization_id`.
 * The column is deprecated on the metadata tables and new writes leave it NULL;
 * `SysMetadataObject.environment_id` and `DatabaseLoaderOptions.environmentId`
 * both carry that note, and `DatabaseLoader`'s own pin test asserts the write
 * does not set it.
 *
 * What setting it still decides is topology: this kernel skips the boot-time
 * `sys_metadata` hydration unless `hydrateMetadataFromDb` opts back in, skips
 * bridging the process-wide SchemaRegistry into the metadata service (that
 * registry is shared, so the bridge would leak sibling environments' objects),
 * and does not provision the metadata-storage platform objects locally. Leave
 * undefined in single-kernel / self-hosted mode.
 */
export interface ObjectQLPluginOptions {
  /** Optional pre-built engine. When absent, one is lazily created in init. */
  ql?: ObjectQL;
  /** Passed to `new ObjectQL(...)` when `ql` is not supplied. */
  hostContext?: Record<string, any>;
  /**
   * Declare that this kernel serves one environment. Topology only — it does
   * not scope sys_metadata rows by an `environment_id` column. See the
   * interface docblock above.
   */
  environmentId?: string;
  /**
   * [#6710] Which authoring channel this kernel's metadata writes arrive on —
   * the explicit expression of ADR-0005's "package author's own bootstrap
   * channel".
   *
   * **Leave unset on every kernel that serves `PUT /api/v1/meta/*` to end
   * users.** The default `'environment'` runs the #4463 runtime authoring
   * rules (the shared `AUTHORING_RULES` that `os validate` / `os lint`
   * run), which for a Studio tenant or an MCP/AI author is the ONLY
   * author-time gate — there is no `os lint` for a `sys_metadata` overlay row.
   *
   * Set `'package-author'` ONLY on the genuine control-plane assembly. Before
   * #6710 this was inferred from `environmentId === undefined`, which is a row
   * -scoping key and not a topology signal: the CLI's host-config assembler
   * leaves it undefined too, so the flagship showcase's own boot shape ran the
   * gate on nothing. Omitting this option now means MORE enforcement, never
   * less — which is the whole point of declaring it rather than deducing it.
   */
  authoringChannel?: MetadataAuthoringChannel;
  /**
   * [#9380] Does this boot arm the `kernel:ready` platform-table repair
   * migrations (#5839 / #8629 / #8686)?
   *
   * Same lesson as `authoringChannel` right above: the gate used to be deduced
   * from `environmentId === undefined`, which is a row-scoping key and not a
   * topology signal — the standalone stack stamps `'env_local'`, so the three
   * migrations never armed on a self-hosted boot at all. Forwarded verbatim to
   * `assembleMetadataProtocol`; see
   * `AssembleMetadataProtocolOptions.runPlatformMigrations` for the two facts
   * that make it false. Omitted ⇒ the historical deduction, unchanged.
   */
  runPlatformMigrations?: boolean;
  /**
   * Override the kernel's default plugin-start timeout for this plugin.
   * Defaults to 120000 (120s). Schema sync to a remote SQL backend
   * (Neon/Postgres/Turso) is latency-bound — the SQL driver currently
   * does NOT support `batchSchemaSync`, so it issues one round-trip per
   * registered object × twice (Phase 1 + Phase 3 in `start()`). On a
   * cold remote DB with N tables this can blow past the kernel's
   * default 30s easily, even though everything is healthy.
   */
  startupTimeout?: number;
  /**
   * Skip both `syncRegisteredSchemas()` calls inside `start()` and
   * assume DDL is managed out-of-band (e.g. an `apps/cloud/scripts/migrate.ts`
   * run before deploy that connects directly to the database and creates
   * all `sys_*` + custom tables once — that script lives in the separate
   * `objectstack-ai/cloud` repo and is NOT a path in this one).
   *
   * Use this on cold-start-sensitive runtimes (Cloudflare Containers,
   * Lambda) where the platform's inbound-request budget is shorter than
   * a fresh remote-DB schema sync. The plugin still hydrates the
   * SchemaRegistry from `sys_metadata` (Phase 2), so custom user
   * objects come up — they just aren't re-DDL'd on every cold boot.
   *
   * Falls back to `process.env.OS_SKIP_SCHEMA_SYNC === '1'` when the
   * option is unset, so containers can flip it via their env without a
   * code change.
   *
   * The resolved value also governs the other boot-time DDL in the kernel:
   * plugins that provision their own system tables at `kernel:ready`
   * (`plugin-audit`, `service-messaging`) read it from the engine and skip
   * that provisioning too. A runtime publish's `syncObjectSchema` is not
   * gated: the flag's scope is the boot.
   */
  skipSchemaSync?: boolean;
  /**
   * Hydrate the SchemaRegistry from this kernel's local `sys_metadata`
   * even when `environmentId` is set.
   *
   * By default Phase-2 hydration in `start()` is gated on
   * `environmentId === undefined`, because the original multi-environment
   * model assumed project kernels source metadata from a remote artifact /
   * control-plane proxy and have NO local `sys_metadata` to read. That is
   * NOT true for an isolated, proxy-free project kernel that persists its
   * OWN `sys_metadata` locally (e.g. the cloud single-env tenant runtime on
   * Turso): objects CREATED AT RUNTIME there — not present in the boot
   * artifact manifest — would otherwise never re-enter the registry after a
   * restart, so `registry.getObject(name)` returns nothing for them and any
   * registry consumer (the unknown-`$select` guard, hooks, relationships)
   * silently degrades.
   *
   * Set this ONLY when the kernel's registry is per-instance isolated AND
   * `sys_metadata` lives on the kernel's own local driver (no control-plane
   * proxy) — hydrating a proxied kernel would read the wrong database.
   * Safe to leave unset: hydration tolerates a missing table.
   */
  hydrateMetadataFromDb?: boolean;
  /**
   * ADR-0076 Step 2 (#2462): when `false`, this plugin SKIPS its built-in
   * protocol assembly (the `protocol` service, the metadata-storage platform
   * objects, and the lightweight `analytics` fallback) — mount
   * `createMetadataProtocolPlugin()` from `@objectstack/metadata-protocol`
   * alongside to own them instead. Protocol CONSUMERS stay here either way
   * (DB hydration + authored hook/action rebind resolve `protocol` lazily).
   * Defaults to `true` (built-in assembly, fully backward compatible).
   */
  registerProtocol?: boolean;
  /**
   * ADR-0057 LifecycleService tuning. Lifecycle enforcement is a platform
   * primitive and defaults ON — objects without a `lifecycle` declaration are
   * never touched, so a kernel with no declarations sees zero deletes. Set
   * `enabled: false` (or env `OS_LIFECYCLE_DISABLED=1`) to disable the
   * periodic sweep entirely; the `lifecycle` service stays registered so
   * tooling can still run `sweep()` explicitly.
   *
   * `referenceAudit` tunes the #4551 read-only dangling-reference audit that
   * rides this same clock. It writes nothing; `enabled: false` drops the leg.
   */
  lifecycle?: {
    enabled?: boolean;
    sweepIntervalMs?: number;
    initialDelayMs?: number;
    referenceAudit?: Omit<DanglingReferenceAuditOptions, 'signal'> & { enabled?: boolean };
  };
}

/**
 * [#22984] The engine-instance property under which {@link ObjectQLPlugin}
 * publishes the `skipSchemaSync` value it resolved (the option, else
 * `OS_SKIP_SCHEMA_SYNC === '1'`).
 *
 * This plugin's boot sync is not the only boot-time DDL in a composed kernel:
 * `plugin-audit` and `service-messaging` provision their system tables from a
 * `kernel:ready` hook through `syncObjectSchema`. They read this value so a
 * deployment that declared its DDL managed out-of-band gets no table created
 * behind its back, and they read the value resolved HERE rather than the
 * environment a second time, so the option and the env var cannot disagree
 * between the engine's boot and theirs.
 *
 * `syncObjectSchema` itself does not consult it: that method is also how a
 * runtime publish gives a new object its table, and the flag's declared scope
 * is the boot.
 *
 * Deliberately an undeclared own property of the engine instance, not a member
 * of `ObjectQL` or of the `IDataEngine` contract, so it adds no name to any
 * declared surface. Readers probe it (`=== true`); an engine nothing published
 * it on reads as "not set". Both readers pin it against this producer by
 * booting the real plugin in their own plugin tests.
 */
const SKIP_SCHEMA_SYNC_ENGINE_KEY = 'skipSchemaSync';

/**
 * [#23649] The kernel-bus event {@link ObjectQLPlugin.start} triggers once per
 * boot, with the live engine as its one argument, at the last moment a routing
 * decision can still be made for free: every boot-registered driver has been
 * adopted (`driver.*` services) and connected (`ObjectQL.init()`), and nothing
 * has been schema-synced, hydrated from `sys_metadata`, read or written yet.
 *
 * It exists for the stack's `datasourceMapping` (ADR-0062 D2 (d), #4462). A
 * mapping rule is routing, not a hint: from the moment it is installed, every
 * object it matches resolves to the named datasource and never falls back to
 * the default store. Installed any later than this (it used to be installed in
 * `AppPlugin.start()`, after this plugin's schema sync and after the auth
 * plugin wrote the Default Organization), the rules re-route platform objects
 * whose tables and rows already sit in the default store, and the boot reports
 * ready over two stores. The app plugin subscribes in its `init()`: it installs
 * the rules and connects every datasource they route a registered object to,
 * so the first DDL and every boot write land where the mapping routes them.
 *
 * After driver adoption on purpose, never in Phase 1: the engine makes its
 * first registered driver the default, so a datasource connected before a
 * stack plugin's `driver.*` service is adopted would take the default slot
 * from it and move every unbound object with it. A handler's throw propagates
 * and fails the boot (a mapped datasource that cannot connect has no fallback).
 *
 * Not in `IPluginLifecycleEvents`: the bus is open to custom names, and this
 * one has one emitter (here) and one subscriber (`AppPlugin`).
 */
export const OBJECTQL_DRIVERS_READY_HOOK = 'objectql:drivers-ready';

export class ObjectQLPlugin implements Plugin {
  name = 'com.objectstack.engine.objectql';
  type = 'objectql' as const;
  version = '1.0.0';
  /**
   * Services init() UNCONDITIONALLY registers (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one of them before it
   * initializes. `protocol`/`objects`/`analytics` are deliberately absent:
   * they are option-gated (`registerProtocol`) and may be owned by
   * MetadataProtocolPlugin instead.
   */
  providesServices = ['objectql', 'data', 'manifest', 'lifecycle'];
  /**
   * Schema sync to remote SQL DBs is latency-bound (one round-trip per
   * table × 2 phases). Default to 120s instead of the kernel's 30s so
   * cold Neon/Turso starts don't get killed mid-sync.
   */
  startupTimeout = 120_000;

  private ql: ObjectQL | undefined;
  private hostContext?: Record<string, any>;
  private environmentId?: string;
  /**
   * [#6710] Declared authoring channel, forwarded to the ONE protocol
   * assembly. `undefined` here is not "unknown" — `assembleMetadataProtocol`
   * resolves it to `'environment'`, the gated channel.
   */
  private authoringChannel?: MetadataAuthoringChannel;
  /**
   * [#9380] Declared arming of the `kernel:ready` platform-table repair
   * migrations, forwarded to the ONE protocol assembly. `undefined` here is
   * not "off" — it means "not declared", and the assembly resolves it to the
   * historical `environmentId === undefined` deduction. The legacy positional
   * `(ObjectQL, hostContext)` constructor returns before any option is read,
   * so it lands here undefined and keeps that deduction too.
   */
  private runPlatformMigrations?: boolean;
  private skipSchemaSync = false;
  /** Serializes reload-time schema syncs so overlapping reloads can't race DDL. */
  private reloadSchemaSync: Promise<void> = Promise.resolve();
  private hydrateMetadataFromDb = false;
  private registerProtocol = true;
  /**
   * Armed at the end of `start()` (AFTER the one-shot
   * {@link bridgeObjectsToMetadataService}, where that runs). From that
   * point on, every manifest registered through the `manifest` service
   * bridges its own objects into the metadata service incrementally — the
   * one-shot bridge never runs again, so late registrations (marketplace
   * install / rehydrate on `kernel:ready`) would otherwise stay invisible
   * to every IMetadataService consumer. Armed on ALL kernels, including
   * project-scoped ones (`environmentId` set — `os dev` boots as
   * 'env_local'): unlike the one-shot registry-wide bridge, a per-manifest
   * bridge cannot leak sibling-project objects, and gating it would turn
   * the fix off in marketplace install-local's primary home.
   */
  private bridgeLateManifests = false;

  /**
   * [#24182] For each package the late bridge bridged as an EXTENDER, the
   * names of the objects whose copy it rewrote: copies stamped with another
   * package's id (the owner's), re-registered with the merged body that
   * carries this package's extension. Read and cleared by
   * {@link restoreExtendedObjectCopies} when the package is withdrawn, the one
   * moment the registry no longer says which objects it extended.
   */
  private readonly extendedObjectCopies = new Map<string, Set<string>>();

  /**
   * Set at `kernel:ready`, once the boot audit has found every picklist a
   * field names: from then on an artifact registered through the `manifest`
   * service is judged before it registers (AGENTS.md, startup registry reads:
   * seal the vocabulary, then judge).
   */
  private picklistVocabularySealed = false;
  /**
   * [#24400] Set at `kernel:ready` beside {@link picklistVocabularySealed},
   * once the boot audit has found the target object of every bound top-level
   * action: from then on a late artifact's bound actions are judged before it
   * registers.
   */
  private boundActionTargetsSealed = false;
  /** Unsubscribe handles for metadata-event subscriptions (ADR-0008 PR-7). */
  private metadataUnsubscribes: Array<() => void> = [];
  /** ADR-0057 lifecycle enforcement (Reaper/Rotator/Archiver). */
  private lifecycleService: LifecycleService | undefined;
  private lifecycleOptions: ObjectQLPluginOptions['lifecycle'];

  constructor(qlOrOptions?: ObjectQL | ObjectQLPluginOptions, hostContext?: Record<string, any>) {
    // Back-compat: legacy callers passed `(ObjectQL, hostContext)` positionally.
    if (qlOrOptions instanceof ObjectQL) {
      this.ql = qlOrOptions;
      this.hostContext = hostContext;
      return;
    }
    // New signature: options bag.
    const opts = (qlOrOptions as ObjectQLPluginOptions | undefined) ?? {};
    if (opts.ql) {
      this.ql = opts.ql;
    }
    this.hostContext = opts.hostContext ?? hostContext;
    this.environmentId = opts.environmentId;
    this.authoringChannel = opts.authoringChannel;
    this.runPlatformMigrations = opts.runPlatformMigrations;
    if (typeof opts.startupTimeout === 'number' && opts.startupTimeout > 0) {
      this.startupTimeout = opts.startupTimeout;
    }
    this.skipSchemaSync =
      typeof opts.skipSchemaSync === 'boolean'
        ? opts.skipSchemaSync
        : process.env.OS_SKIP_SCHEMA_SYNC === '1';
    this.hydrateMetadataFromDb = opts.hydrateMetadataFromDb === true;
    this.registerProtocol = opts.registerProtocol !== false;
    this.lifecycleOptions = opts.lifecycle;
  }

  /**
   * [ADR-0131 D7] The objects the deployment declares platform-global, as this
   * plugin installed them at `start()` — compared at `kernel:ready` by
   * {@link assertDeploymentPlatformGlobalObjectsUnchanged}.
   */
  private installedPlatformGlobalObjects: ReadonlySet<string> = new Set<string>();

  /**
   * [ADR-0131 D7 — the #12699 declaration made total] Read the deployment's
   * `OrgScopingEntitlement.platformGlobalObjects` off the mounted `org-scoping`
   * service and install it as the injected-columns plan's input: every object
   * it names gets NO organization column on this deployment, so Layer 0 and
   * the driver agree by having nothing to scope.
   *
   * ## Why here, at the top of `start()` (ADR-0116)
   *
   * Every `init()` has completed by now — the Phase 1/2 split — and the
   * provider declares `org-scoping` in `providesServices`, i.e. registers it
   * unconditionally in its `init()`. So the declaration read here is final for
   * this boot, and no table exists yet: the first schema sync is below. The
   * plan is ALSO computed at registration, inside each registrant's `init()`,
   * and the provider cannot be ordered ahead of those (it hard-depends on this
   * plugin), so the registry re-plans every object already registered
   * (`SchemaRegistry.setDeploymentPlatformGlobalObjects`).
   *
   * Fail closed, through the one reader (`readDeploymentOrgScopingEntitlement`,
   * `@objectstack/core`): no service or an absent key installs nothing and
   * every plan is byte-identical; a junk key is refused loudly and installs
   * nothing, so no object loses its column.
   */
  private installDeploymentPlatformGlobalObjects(ctx: PluginContext): void {
    if (!this.ql) return;
    const reading = this.readDeploymentPlatformGlobalObjects(ctx);
    this.installedPlatformGlobalObjects = reading;
    if (reading.size === 0) return;
    const { replanned, keptAuthoredColumn } =
      this.ql.registry.setDeploymentPlatformGlobalObjects(reading);
    const objects = [...reading].sort();
    ctx.logger.info(
      `[ObjectQLPlugin] deployment declares ${objects.length} platform-global object(s) — no ` +
        'organization column on THIS deployment (ADR-0131 D7); each is governed by object permission, ' +
        'not by the organization wall',
      { objects, replannedAtStart: replanned },
    );
    if (keptAuthoredColumn.length > 0) {
      ctx.logger.warn(
        `[ObjectQLPlugin] deployment declares ${keptAuthoredColumn.join(', ')} platform-global, but the ` +
          'object DECLARES its own organization_id: that column is the author\'s, not the platform\'s, so it ' +
          'stays and the organization wall keeps scoping it. Remove the authored organization_id field to ' +
          'make the declaration take effect, or drop the object from the declaration.',
        { objects: keptAuthoredColumn },
      );
    }
  }

  /** The validated `platformGlobalObjects` reading; warns for a refused key. */
  private readDeploymentPlatformGlobalObjects(ctx: PluginContext): ReadonlySet<string> {
    let service: unknown;
    try {
      service = ctx.getService('org-scoping');
    } catch {
      service = undefined;
    }
    const reading = readDeploymentOrgScopingEntitlement(service);
    for (const refusal of reading.refused) {
      if (refusal.key !== 'platformGlobalObjects') continue;
      ctx.logger.warn(
        `[ObjectQLPlugin] org-scoping entitlement key 'platformGlobalObjects' REFUSED — ${refusal.problem}`,
        { key: refusal.key, declared: refusal.value },
      );
    }
    return reading.platformGlobalObjects;
  }

  /**
   * [ADR-0131 D7] At `kernel:ready`, refuse the boot when the `org-scoping`
   * service now declares a different platform-global set than the one the
   * columns were planned from at `start()`. That only happens when a provider
   * registers `org-scoping` outside its `init()` (or swaps it), which ADR-0116
   * gives no ordering for: the objects it names were provisioned WITH the
   * column, and serving on would advertise a declaration the deployment does
   * not honour. Reads the service without warning — a junk key was warned
   * about at `start()` and reads as the same empty set.
   */
  /** [ADR-0142 D1] See the `kernel:ready` call site. */
  private assertOwnershipQueueServicePresent(ctx: PluginContext): void {
    const registry = this.ql?.registry;
    if (!registry) return;
    let registered = false;
    try {
      registered = Boolean(ctx.getService(OWNERSHIP_QUEUE_SERVICE));
    } catch {
      registered = false;
    }
    const refusal = describeMissingOwnershipQueueService(
      { queues: registry.listItems('queue'), assignmentRules: registry.listItems('assignment_rule') },
      registered,
    );
    if (refusal) throw refusal;
  }

  private assertDeploymentPlatformGlobalObjectsUnchanged(ctx: PluginContext): void {
    let service: unknown;
    try {
      service = ctx.getService('org-scoping');
    } catch {
      service = undefined;
    }
    const now = readDeploymentOrgScopingEntitlement(service).platformGlobalObjects;
    const before = this.installedPlatformGlobalObjects;
    const same = now.size === before.size && [...now].every((name) => before.has(name));
    if (same) return;
    throw new Error(
      '[ObjectQLPlugin] the org-scoping service\'s platformGlobalObjects declaration changed after the engine ' +
        `planned the columns at start() (planned: [${[...before].sort().join(', ')}]; now: ` +
        `[${[...now].sort().join(', ')}]). The objects it names were provisioned with an organization column. ` +
        "Register 'org-scoping' in the provider's init() and declare it in its providesServices (ADR-0116), " +
        'so every plugin start() — this engine\'s schema sync included — reads the final declaration.',
    );
  }

  /**
   * Arm the protocol-driven rebinds. Shared by both assembly modes: called with
   * the in-house shim when `registerProtocol` is on, and lazily from `start()`
   * against whatever registered `protocol` (MetadataProtocolPlugin) otherwise.
   *
   * Two independent subscriptions, each guarded on its own — a protocol
   * implementation that offers one seam and not the other must still get the
   * one it has:
   *
   *  1. `onMetadataMutation` (#2588, #2605) — this plugin's OWN authored
   *     hook/action rebind.
   *  2. `onMetaItemPublished` (#10219) — the kernel-wide `metadata:reloaded`
   *     announce for the per-item publish door. See
   *     {@link announcePerItemPublish}.
   */
  private subscribeMetadataRebind(ctx: PluginContext, protocol: unknown): void {
    if (typeof (protocol as any)?.onMetadataMutation === 'function') {
      const unsubscribe = (protocol as any).onMetadataMutation(
        (evt: { type: string; name: string; state: string }) => {
          if (evt?.state === 'draft') return;
          // The metadata service's copy of a runtime-authored object follows
          // the registry the moment the authoring door lands. See
          // {@link followRuntimeObjectCopy}.
          if (evt?.type === 'object') this.followRuntimeObjectCopy(ctx, evt);
          if (evt?.type === 'hook') {
            void this.resyncAuthoredHooks(ctx).catch((e: any) => {
              ctx.logger.warn('[ObjectQLPlugin] authored-hook rebind after mutation failed', {
                hook: evt.name,
                error: e?.message,
              });
            });
          } else if (evt?.type === 'action' || evt?.type === 'object') {
            // `object` rows carry embedded `actions[]`, so an object edit can
            // add/remove an authored action too — re-sync on both.
            void this.resyncAuthoredActions(ctx).catch((e: any) => {
              ctx.logger.warn('[ObjectQLPlugin] authored-action rebind after mutation failed', {
                item: evt.name,
                error: e?.message,
              });
            });
          }
        },
      );
      this.metadataUnsubscribes.push(unsubscribe);
    }
    if (typeof (protocol as any)?.onMetaItemPublished === 'function') {
      const unsubscribe = (protocol as any).onMetaItemPublished(
        (evt: { type: string; name: string }) => this.announcePerItemPublish(ctx, evt),
      );
      this.metadataUnsubscribes.push(unsubscribe);
    }
  }

  /**
   * [#10219] Announce `metadata:reloaded` after a PER-ITEM publish
   * (`POST /api/v1/meta/:type/:name/publish`), so every boot-cached consumer
   * re-syncs without a restart.
   *
   * This is the missing third announcer of an event that had two: the metadata
   * plugin's dev-artifact watcher, and the runtime dispatcher after
   * `POST /packages/:id/publish-drafts` (#2576). Publishing one item at a time
   * — what an AI author and the item-level Studio doors do — fired neither, so
   * the load-bearing subscriber never ran: `service-automation`'s
   * `resyncFlowsFromProtocol` binds record- and schedule-triggered flows off
   * this event, and a flow published per item stayed `state='active'` and
   * completely inert until the kernel was rebuilt. Same silence for authored
   * hooks/actions of other packages, declared connectors and translations.
   *
   * The plugin is where the announce belongs because the protocol holds no
   * kernel: it notifies, and this — holding `ctx` — triggers. That is the same
   * division the dispatcher's `announceKernelEvent` makes for the batch door.
   *
   * `changed` uses the `'{type}/{name}'` spelling the batch announce emits, so
   * a subscriber reading the payload cannot tell the two doors apart.
   *
   * Best-effort and never rethrown: the item is already published and durable,
   * so a subscriber failure must not turn a landed publish into an error. It is
   * reported at `warn` — the loss is an in-memory re-sync, AGENTS.md's own
   * worked example of a FUNCTIONAL degradation, and the sibling announcers log
   * it at exactly this level.
   */
  private async announcePerItemPublish(
    ctx: PluginContext,
    evt: { type: string; name: string },
  ): Promise<void> {
    try {
      await ctx.trigger('metadata:reloaded', { changed: [`${evt.type}/${evt.name}`] });
    } catch (e: any) {
      ctx.logger.warn(
        '[ObjectQLPlugin] the post-publish `metadata:reloaded` announce failed — the item IS published, but '
        + 'boot-cached consumers keep the pre-publish view until this process restarts (a newly published '
        + 'record-triggered flow does not bind its trigger and will not fire). Nothing retries this announce; '
        + 're-publishing the item is idempotent.',
        { item: `${evt.type}/${evt.name}`, error: e?.message ?? String(e) },
      );
    }
  }

  init = async (ctx: PluginContext) => {
    if (!this.ql) {
        // Pass kernel logger to engine to avoid creating a separate logger instance
        const hostCtx = { ...this.hostContext, logger: ctx.logger };
        this.ql = new ObjectQL(hostCtx);
    }

    // [#22984] Publish the resolved opt-out where boot-time provisioning
    // plugins read it — see SKIP_SCHEMA_SYNC_ENGINE_KEY.
    (this.ql as unknown as Record<string, unknown>)[SKIP_SCHEMA_SYNC_ENGINE_KEY] = this.skipSchemaSync;

    // [ADR-0139 D2] The engine composes a `ReadableIds` leaf from the
    // registered `security` service. Handed over as a SOURCE in the engine's
    // slot (`SECURITY_SERVICE_SOURCE_SLOT`, not public surface), read at use and
    // never here: at this plugin's init the service is not registered yet on
    // any composition that ships it (plugin-security registers it in its own
    // start()), so a lookup here would record a verdict the same boot
    // contradicts. The engine answers every state but a usable service
    // `$in: []` (fail closed); a throw — the in-repo kernels' answer for a
    // name nothing registered — is one of them.
    (this.ql as unknown as Record<symbol, unknown>)[SECURITY_SERVICE_SOURCE_SLOT] = () => ctx.getService('security');
    // [ADR-0142 D5] The assignment seam reads the ownership-queue service the
    // same way: a source, resolved at use. ⛔ `ownership-queue`, never the job
    // queue's `queue`.
    (this.ql as unknown as Record<symbol, unknown>)[OWNERSHIP_QUEUE_SOURCE_SLOT] = () => ctx.getService(OWNERSHIP_QUEUE_SERVICE);

    // Register as provider for Core Kernel Services
    ctx.registerService('objectql', this.ql);

    ctx.registerService('data', this.ql); // ObjectQL implements IDataEngine

    // Register manifest service for direct app/package registration.
    // Plugins call ctx.getService('manifest').register(manifestData)
    // instead of the legacy ctx.registerService('app.<id>', manifestData) convention.
    const ql = this.ql;
    ctx.registerService('manifest', {
      // [ADR-0130 D4/D5] The load path reads BOTH artifact shapes and registers
      // the packages inside one artifact in dependency-TOPOLOGICAL order.
      //
      // `resolveArtifactPackageEntries` is the whole of that decision: it reads
      // `packages` when present and falls back to the caller's own object as a
      // single-element list when absent (D4), and it orders through
      // `resolvePluginOrder` — the platform's ONE topological sorter (ADR-0116).
      // ⛔ Nothing here may re-derive either the entry shape or the ordering; a
      // second copy of either is the drift both records exist about.
      //
      // Registration of ALL packages completes before ANY bridging begins. The
      // bridge resolves objects out of the registry, and an artifact's later
      // packages contribute extensions onto the earlier ones' objects — so a
      // register/bridge interleave would bridge a body that the very next
      // package is about to change. For the single-package artifact this is the
      // same one register followed by the same one bridge as before (D7).
      //
      // [#23972] `options.source` is where every package in this artifact came
      // from, stamped on each registry row (`InstalledPackageSchema.source`).
      // Absent means `'code'`, the deployment's own code (`registerApp`'s
      // default); the marketplace install-local plugin states `'marketplace'`.
      //
      // One merged artifact may carry packages of different origins, so an
      // entry may state its own (`ArtifactPackageSchema.source`): the producer
      // that merged it is the one that knows. A package's own statement is the
      // more specific one and is stamped as written; a package that states none
      // takes the door's, as above.
      register: (registeredArtifact: any, options?: { source?: 'code' | 'marketplace' }) => {
        // ADR-0087 D2 at the registration door, for an artifact that carries
        // `packages[]`: its bodies are strictly parsed by the ordering below
        // BEFORE `registerApp` could convert each one, so a bundle handed here
        // as authored (a marketplace install, a hosted kernel's own loader)
        // converts once as a whole first — the window is the artifact's, read
        // off its own declared range, and every body replays under it. A
        // single-body payload converts at `registerApp` (the body door) and is
        // handed through untouched here; a bundle an artifact door already
        // converted comes back by reference. See `ObjectQL.convertPackageBodyForward`.
        const artifact = Array.isArray(registeredArtifact?.packages)
          ? ql.convertPackageBodyForward(registeredArtifact)
          : registeredArtifact;
        const entries = resolveArtifactPackageEntries(artifact);
        const ordered = entries.map((entry) => entry.manifest) as any[];
        // [ADR-0130 D4] The stack's RESIDUAL — top-level items no package body
        // declares — as the residual rule answers it, read once: its objects
        // (see {@link unclaimedTopLevelObjects})…
        const residualAnswer = unclaimedTopLevel(artifact);
        const residual = unclaimedTopLevelObjects(residualAnswer);
        // …and every other item a body's collections take into the registry,
        // which readers of the registry alone see only through this. See
        // {@link unclaimedTopLevelItems}.
        const residualItems = unclaimedTopLevelItems(residualAnswer);
        // …and its picklists, which neither of those registers: one that no
        // object field names is refused here, before anything registers. See
        // {@link unreferencedResidualPicklistRefusal}.
        const unreferencedPicklists = unreferencedResidualPicklistRefusal(residualAnswer, ordered);
        if (unreferencedPicklists) throw unreferencedPicklists;

        if (ordered.length === 0 && residual === undefined && residualItems === undefined) {
          // An artifact that declared `packages: []` registers nothing. Said out
          // loud rather than returning quietly: "the install did nothing" is not
          // a state anyone should have to infer from an absence.
          ctx.logger.warn(
            'Artifact declared an empty `packages: []` — nothing was registered. A '
            + 'single-package artifact omits the key entirely and carries `manifest` '
            + '(ADR-0130 D4).',
          );
          return Promise.resolve();
        }

        // [ADR-0130 D1] The artifact's own package list, handed to every
        // install in it. This is the whole of how the install gate learns
        // "same artifact": co-ownership is proven by joint delivery, and this
        // load path is the only place that holds the delivery. ⛔ No owner field
        // on the manifest (D8) and nothing persisted — the claim cannot outlive,
        // or drift from, the artifact that IS the claim.
        //
        // A single-`manifest` artifact yields a one-element list whose only
        // member is the installing package itself, which the gate excludes
        // anyway: that path stays bit-identical (D7).
        const scope = {
          packageIds: ordered
            .map((m) => artifactPackageId(m))
            .filter((id): id is string => id !== undefined),
        };

        // Once the boot has sealed the picklist vocabulary (`kernel:ready`,
        // below), an artifact arriving later is judged BEFORE anything of it
        // registers: every field it brings that names a picklist must resolve
        // against the registry or against a list the artifact itself declares.
        // A refused install registers nothing.
        if (this.picklistVocabularySealed) {
          const declared = new Set<string>();
          for (const manifest of ordered) for (const name of collectManifestPicklistNames(manifest)) declared.add(name);
          const known = (name: string) => declared.has(name) || ql.registry.resolvePicklistOptions(name) !== undefined;
          const unresolved = ordered
            .flatMap((manifest) => collectManifestPicklistReferences(manifest, artifactPackageId(manifest)))
            .filter((ref) => !known(ref.picklist));
          const orphans = ordered
            .flatMap((manifest) => collectManifestPicklistExtensions(manifest, artifactPackageId(manifest)))
            .filter((ext) => !known(ext.picklist));
          const refusal = describeUnresolvedPicklistReferences(unresolved, orphans);
          if (refusal) throw refusal;
        }
        // [#24400] The same seal for bound top-level actions: once the boot has
        // judged every target (`kernel:ready`, below), an artifact arriving
        // later must bind its actions to an object the registry holds or one
        // the artifact itself declares. A refused install registers nothing.
        if (this.boundActionTargetsSealed) {
          const declared = new Set<string>(residual?.objects.map((o) => o.name) ?? []);
          for (const manifest of ordered) for (const name of collectManifestObjectNames(manifest)) declared.add(name);
          // The residual's own actions are judged with the bodies': they
          // register below, under the residual rule's id.
          const residualActions = residualItems?.items.filter((entry) => entry.type === 'action').map((entry) => entry.item) ?? [];
          const unbound = ordered
            .flatMap((manifest) => collectManifestBoundActions(manifest, artifactPackageId(manifest)))
            .concat(collectManifestBoundActions({ actions: residualActions }, residualItems?.ownerId))
            .filter((bound) => !declared.has(bound.objectName) && ql.registry.getObject(bound.objectName) === undefined);
          const refusal = describeUnboundActionTargets(unbound);
          if (refusal) throw refusal;
        }

        for (const { manifest, source } of entries as Array<{ manifest: any; source?: 'code' | 'marketplace' }>) {
          ql.registerApp(manifest, scope, source ?? options?.source);
          ctx.logger.debug('Manifest registered via manifest service', {
            id: manifest.id || manifest.name
          });
        }
        // [ADR-0130 D4] The residual's objects, AFTER every body — the order
        // the metadata door registers the same stack in — under the id the
        // residual rule names, through the registry verb a body's own objects
        // take (`registerApp` step 2). There is no package record for that id:
        // the residual is not a package, and when the id names one of the
        // bodies (a composed stack keeps one member's manifest) that body's
        // record must not be replaced.
        // [#28534] …and the door's statement of where that owner came from,
        // recorded before anything of it registers: no package row answers the
        // id, and a reader of an item's origin must tell the host's own
        // residual from an installed bundle's (`ObjectQL.recordResidualOwner`).
        // The residual is not an artifact entry, so it states no source of its
        // own; the door's word, `code` when it states none, is its origin.
        const residualOwnerId = residual?.ownerId ?? residualItems?.ownerId;
        if (residualOwnerId !== undefined) ql.recordResidualOwner(residualOwnerId, options?.source ?? 'code');
        if (residual) this.registerUnclaimedTopLevelObjects(ctx, residual, ordered);
        // [ADR-0015 D7, ADR-0130 D4] Every other residual item, the same way
        // and in the same place: after every body, under the residual rule's
        // id, through the registration a body's own item of that type takes.
        // See {@link registerUnclaimedTopLevelItems}.
        if (residualItems) this.registerUnclaimedTopLevelItems(ctx, residualItems);
        // [#24472] The boot reported every same-name pair it found
        // (`kernel:ready`, below); an artifact arriving later is judged once it
        // has registered, for the pairs naming one of its packages on either
        // side. Reported, never refused — nothing above is undone.
        if (this.boundActionTargetsSealed) {
          const arrived = new Set(scope.packageIds);
          const residualOwner = residual?.ownerId ?? residualItems?.ownerId;
          if (residualOwner !== undefined) arrived.add(residualOwner);
          this.reportBoundActionCollisions(ctx, ql.registry[FIND_BOUND_ACTION_COLLISIONS](arrived));
        }
        // Manifests registered AFTER start() (marketplace install / ledger
        // rehydrate arrive on `kernel:ready` or an HTTP request) land in the
        // SchemaRegistry only — the one-shot startup bridge already ran — so
        // bridge every registered package's objects into the metadata service now.
        // No-op until start() arms it, so boot-time registrations keep the
        // single startup bridge. The promise never rejects; async callers
        // (marketplace install) await it so metadata reads right after
        // install are deterministic, sync callers may ignore it. The residual's
        // owner is bridged with them, so a late artifact's residual objects
        // reach the metadata door as well as the data door.
        const bridged = residual?.ownerId !== undefined && !scope.packageIds.includes(residual.ownerId)
          ? [...ordered, { id: residual.ownerId }]
          : ordered;
        return this.bridgeArtifactObjectsToMetadataService(ctx, bridged);
      },
      // [#24182] The withdrawal counterpart of the bridge's extender rewrite:
      // a door that withdrew a package from the registry calls this so the
      // copies of OTHER packages' objects that the package's extensions
      // rewrote serve the registry's definition again. Never rejects. See
      // {@link restoreExtendedObjectCopies}.
      restoreExtendedObjectCopies: (packageId: string): Promise<void> =>
        this.restoreExtendedObjectCopies(ctx, packageId),
    });

    ctx.logger.info('ObjectQL engine registered', {
        services: ['objectql', 'data', 'manifest'],
    });

    if (this.registerProtocol) {
      // ADR-0076 Step 2 PR-C: the ONE assembly lives in
      // @objectstack/metadata-protocol — this built-in mode is the
      // single-kernel convenience mount of the same code path the
      // MetadataProtocolPlugin uses (identical objects/protocol/analytics).
      // [#6710] `authoringChannel` rides the same seam as `environmentId`, and
      // an undefined one resolves to `'environment'` (gated) inside the
      // assembly — including on the legacy positional `(ObjectQL, hostContext)`
      // constructor path, which returns before any option is read.
      const protocolShim = assembleMetadataProtocol(ctx, this.ql, this.environmentId, {
        authoringChannel: this.authoringChannel,
        // [#9380] Rides the same seam, for the same reason: an undeclared value
        // resolves to the historical `environmentId === undefined` deduction
        // inside the assembly, so this mount and the delegated
        // MetadataProtocolPlugin cannot disagree about when the migrations arm.
        runPlatformMigrations: this.runPlatformMigrations,
      });
      this.subscribeMetadataRebind(ctx, protocolShim);
    } else {
      ctx.logger.info('registerProtocol=false — protocol assembly delegated to MetadataProtocolPlugin (ADR-0076 Step 2)');
    }

    // ADR-0057: the platform-owned LifecycleService. Registered from the
    // engine plugin (not an opt-in capability) so every kernel that has data
    // also has lifecycle enforcement — a declared retention that drives no
    // sweeper is dead surface (ADR-0049).
    this.lifecycleService = new LifecycleService({
      getEngine: () => this.ql,
      logger: ctx.logger,
      // P4 governance: overrides/quotas resolve from the 'lifecycle'
      // settings namespace when a SettingsService is present. Lazy per
      // sweep — plugin registration order doesn't matter.
      getSettings: () => {
        try {
          return ctx.getService('settings') as never;
        } catch {
          return undefined;
        }
      },
      ...this.lifecycleOptions,
    });
    ctx.registerService('lifecycle', this.lifecycleService);
  }

  start = async (ctx: PluginContext) => {
    ctx.logger.info('ObjectQL engine starting...');

    // [ADR-0131 D7] FIRST: the deployment's platform-global declaration is the
    // injected-columns plan's input, so it is installed before anything below
    // registers another object or creates a table.
    this.installDeploymentPlatformGlobalObjects(ctx);

    // Delegated-assembly mode (ADR-0076 Step 2): the protocol was registered
    // by MetadataProtocolPlugin during init — arm the authored hook/action
    // rebind against it now that all inits ran. Graceful when absent.
    if (!this.registerProtocol) {
      try {
        this.subscribeMetadataRebind(ctx, ctx.getService('protocol'));
      } catch { /* no protocol registered — rebind not armed */ }
    }

    // Sync from external metadata service (e.g. MetadataPlugin) if available
    try {
        const metadataService = ctx.getService<IMetadataService>('metadata');
        if (metadataService && typeof metadataService.loadMany === 'function' && this.ql) {
            await this.loadMetadataFromService(metadataService, ctx);
        }
        // ── ADR-0008 PR-7: subscribe to object metadata events so the
        //    SchemaRegistry cache is invalidated on edits (Studio HMR).
        //    The metadata service bubbles repo events through its own
        //    `subscribe(type, cb)` API (PR-6 bridge), so we don't talk
        //    to the repo directly here — this keeps ObjectQL decoupled
        //    from the storage backend.
        if (metadataService && typeof metadataService.subscribe === 'function' && this.ql) {
            this.subscribeToMetadataEvents(metadataService, ctx);
        }
    } catch (e: any) {
        ctx.logger.debug('No external metadata service to sync from');
    }

    // ── Runtime-authored hook bind (#2588) ───────────────────────────────
    // Hooks authored in the Studio live as `sys_metadata` rows, which the
    // metadata service's loadMany() above does NOT surface on env-scoped
    // kernels (no DatabaseLoader there) — so the boot bind never sees them
    // and their bodies never run, even after a restart. Re-bind from the
    // rows themselves:
    //   • at `kernel:ready` — cold-boot coverage, once every plugin has
    //     registered its packages (so the artifact filter can classify);
    //   • on `metadata:reloaded` — publish-while-running coverage (the
    //     runtime dispatcher announces after publishPackageDrafts, #2576),
    //     mirroring service-automation's flow re-sync.
    // Idempotent: the bind fully replaces the 'metadata-service' package
    // set, so edited hooks re-bind and deleted hooks tear down.
    ctx.hook('kernel:ready', async () => {
        // [ADR-0131 D7] The declaration the columns were planned from must still
        // be the deployment's: a provider that registered `org-scoping` after
        // this plugin's start() was never read, so its objects were provisioned
        // WITH the column. Refused here, by name, rather than served.
        this.assertDeploymentPlatformGlobalObjectsUnchanged(ctx);
        // [ADR-0142 D1] A stack that declares `queues` or `assignmentRules`
        // needs the service that serves them. Judged here, where every plugin
        // has registered its services and its packages, by the service NAME
        // `ownership-queue` — a composition that loads only the job queue
        // (`queue`) would otherwise pass with nothing behind its declarations.
        this.assertOwnershipQueueServicePresent(ctx);
        // A field naming a picklist no package declares fails the boot, naming
        // the field and the package — never served as a select with nothing to
        // choose — and so does an extension of such a list, whose values would
        // otherwise go nowhere. Judged HERE because every package has registered by now, so
        // "not declared" is final; a list a later package declares would
        // otherwise read as missing (AGENTS.md, startup registry reads). From
        // here on the vocabulary is sealed and each late artifact is judged as
        // it arrives (the `manifest` service above).
        const unresolvedPicklists = describeUnresolvedPicklistReferences(
            this.ql?.registry.findUnresolvedPicklistReferences() ?? [],
            this.ql?.registry.findOrphanPicklistExtensions() ?? [],
        );
        if (unresolvedPicklists) throw unresolvedPicklists;
        this.picklistVocabularySealed = true;
        // [#24400] A top-level action bound by `objectName` to an object no
        // package registers fails the boot, naming the action, its package and
        // the object — never registered and listed nowhere. Judged here for the
        // picklist reason: every package has registered, so "no such object"
        // is final, and either registration order has had its turn. From here
        // on each late artifact is judged as it arrives (the `manifest` service).
        const unboundActions = describeUnboundActionTargets(this.ql?.registry.findUnboundActionTargets() ?? []);
        if (unboundActions) throw unboundActions;
        this.boundActionTargetsSealed = true;
        // [#24472] A bound action named like one its target already lists, with
        // a different declaration, is warned once per pair, naming the object,
        // the action and both packages — judged here for the same reason, and
        // reported, never refused: the object keeps serving its own (rung 1)
        // and the boot goes on. Each late artifact is judged as it arrives.
        this.reportBoundActionCollisions(ctx, this.ql?.registry[FIND_BOUND_ACTION_COLLISIONS]() ?? []);
        // #7737 — FIRST, before anything that might read data: bind every
        // declared federated object to its remote table now that every
        // plugin's `start()` (including the declared-datasource auto-connect
        // in `AppPlugin.start()`) has run. See
        // {@link reconcileFederatedBindings}.
        await this.reconcileFederatedBindings(ctx);
        await this.resyncAuthoredHooks(ctx);
        await this.resyncAuthoredActions(ctx);
        // [ADR-0126 §8] Apply the packaged-ACTION activation ledger to the
        // registry that re-sync just finalized.
        //
        // Ordering is load-bearing, and for the same reason the inventory below
        // runs here: after `resyncAuthoredActions` the set of dispatchable
        // actions is final for this boot, so the audit line names the actions
        // this process will actually refuse. Running at `kernel:ready` (not in
        // `start()`) is what lets the ledger's own object — registered by
        // whichever composition uses it, and schema-synced by its own start —
        // exist before the table is read.
        await this.hydrateActionActivations(ctx);
        // [ADR-0110 D5] Governance inventory — AFTER the authored-action
        // re-sync, so the registry it audits is final for this boot. It lived
        // in AppPlugin first, which is registered conditionally; on the `os
        // dev` path it never ran, so the checklist that justifies D3's hard
        // refusal was never printed where an upgrade most needs it. The
        // engine owns the map being audited; the engine plugin reports on it.
        await this.runGovernanceInventory(ctx);
        // ADR-0057 P4: surface the lifecycle governance namespace in Settings
        // (overrides / quotas / growth alerts) when a SettingsService exists.
        try {
            const settings = ctx.getService('settings') as { registerManifest?: (m: unknown) => void };
            settings?.registerManifest?.(lifecycleSettingsManifest);
        } catch {
            // No settings service — governance stays at declared defaults.
        }
    });
    // ADR-0104 / #3438: name the value-shape gates still open on THIS
    // deployment, and the command that closes each. Deliberately on
    // `kernel:bootstrapped` rather than `kernel:ready`: the answer depends on
    // the storage service's OWN ready handler, which registers `sys_migration`
    // and may attest a store it just created. Racing it inside `kernel:ready`
    // would tell a brand-new deployment its gates are open moments after they
    // were closed.
    ctx.hook('kernel:bootstrapped', async () => {
        // [ADR-0139 D5.2 / D5.3] A `controlled_by_parent` detail over a master
        // the engine composes no read over fails the boot, naming both and the
        // remedy. Judged HERE, not at `kernel:ready`: the object-scoped read
        // middlewares are registered by their plugins' own `kernel:ready`
        // handlers (mailbox, audit, attachment), which run after this plugin's,
        // so only now are both facts — every binding and every registration —
        // final. Still a boot refusal: `kernel:listening` has not opened the
        // socket, so no request is served by a deployment this rejects.
        const unservable = describeUnservableControlledByParentMasters(
            this.ql?.findUnservableControlledByParentMasters() ?? [],
        );
        if (unservable) throw unservable;
        await this.ql?.announceOpenMigrationGates();
    });
    ctx.hook('metadata:reloaded', async (payload?: unknown) => {
        await this.resyncAuthoredHooks(ctx);
        await this.resyncAuthoredActions(ctx);
        // [ADR-0126 §8] Re-attempt the ledger attach — a no-op once attached.
        // A reload is exactly when an object that was not registered at
        // `kernel:ready` becomes visible, so this is what keeps that earlier
        // "not there" from hardening into a recorded verdict nothing revisits
        // (AGENTS.md, startup registry reads).
        await this.hydrateActionActivations(ctx);
        // 15.1 third-party eval: an object added while `os dev` runs was
        // invisible until a manual restart. Two gaps compounded:
        //   1. MetadataPlugin's artifact reload ingests through
        //      `manager.register(…, { notify: false })` — one announcement per
        //      artifact, not per item (#3112) — so the bridge in
        //      `subscribeToMetadataEvents` never sees the new object and the
        //      SchemaRegistry never learns it ("Object … is not registered").
        //      This hook IS that announcement: ingest the reloaded object
        //      definitions straight off the `metadata:reloaded` payload
        //      (mirroring the subscribe handler's registerObject call,
        //      provenance included).
        //   2. Tables were only ever created by the boot-time sync — re-run
        //      the idempotent schema sync after each reload so new objects
        //      get their DDL immediately. Honors the same opt-out as boot
        //      (`skipSchemaSync` / OS_SKIP_SCHEMA_SYNC) for deployments that
        //      manage DDL out-of-band, and serializes through
        //      `reloadSchemaSync` so overlapping reload events can't race DDL.
        //   3. Every OTHER item the boot registered through the `manifest`
        //      service kept its boot copy in the registry, which the list read
        //      and its execution face lay over the metadata service: an edited
        //      email template sent its old wording, an edited flow re-bound its
        //      old body, while the by-name read served the edit. See
        //      {@link refreshReloadedPackages}.
        this.refreshReloadedPackages(ctx, payload);
        this.ingestReloadedObjects(ctx, payload);
        if (this.skipSchemaSync) {
            // DDL is managed out-of-band here, but the objects this reload just
            // ingested still have to be TOLD to the driver, or every JSON /
            // datetime / boolean value written to them is encoded by the
            // client's per-type defaults. No DDL, no round-trip, nothing to
            // serialize against — see `registerSchemasWithoutDdl`.
            await this.registerSchemasWithoutDdl(ctx);
        }
        if (!this.skipSchemaSync) {
            this.reloadSchemaSync = this.reloadSchemaSync.then(async () => {
                try {
                    await this.syncRegisteredSchemas(ctx);
                } catch (e: any) {
                    // #4632 — durability degradation, not a functional one. A
                    // Studio edit that adds a field lands in metadata (the UI
                    // shows it, the API accepts it, the author sees a saved
                    // record) while the column it needs was never created. The
                    // author is told the value was saved and it was not.
                    // `Logger.error` is `(message, error?, meta?)` — the second
                    // slot is the Error, NOT the context bag `warn` takes there.
                    ctx.logger.error(
                        '[ObjectQLPlugin] reload-time schema sync FAILED — objects changed by this metadata reload are live in the ' +
                            'registry, UI and API, but their new/altered columns were NOT created: writes against them are accepted and ' +
                            'then silently lost or rejected. Fix the driver error below and reload again (or restart) to re-run DDL.',
                        e instanceof Error ? e : new Error(String(e?.message ?? e)),
                    );
                }
            });
            await this.reloadSchemaSync;
        }
        // [ADR-0110 D5] Re-run the inventory after a live metadata reload —
        // a Studio edit can orphan a handler (declaration deleted) or bind
        // one (declaration added), and a boot-only snapshot goes stale the
        // moment either happens. Fingerprint-suppressed: a reload that
        // changed nothing action-related logs nothing.
        await this.runGovernanceInventory(ctx);
    });

    // Discover features from Kernel Services
    if (ctx.getServices && this.ql) {
        const services = ctx.getServices();
        for (const [name, service] of services.entries()) {
            if (name.startsWith('driver.')) {
                 // Register Driver.
                 //
                 // For the standalone `default` this is the SECOND leg of a
                 // round trip, not a new registration (#4773):
                 // `DefaultDatasourcePlugin.init()` already registered the
                 // driver through `DatasourceConnectionService`, then
                 // republished that same instance as this `driver.<name>`
                 // service for `os migrate` / serve storage detection. Handing
                 // it back is a deliberate no-op — see `registerDriver`, which
                 // distinguishes this identical re-entry (quiet) from a real
                 // name collision between two different instances (loud).
                 this.ql.registerDriver(service);
                 ctx.logger.debug('Discovered and registered driver service', { serviceName: name });
            }
            if (name.startsWith('app.')) {
                // Legacy fallback: discover app.* services (DEPRECATED)
                ctx.logger.warn(
                    `[DEPRECATED] Service "${name}" uses legacy app.* convention. ` +
                    `Migrate to ctx.getService('manifest').register(data).`
                );
                this.ql.registerApp(service); // service is Manifest
                ctx.logger.debug('Discovered and registered app service (legacy)', { serviceName: name });
            }
        }

        // Bridge realtime service from kernel service registry to ObjectQL.
        // RealtimeServicePlugin registers as 'realtime' service during init().
        // This enables ObjectQL to publish data change events.
        try {
            const realtimeService = ctx.getService('realtime');
            if (realtimeService && typeof realtimeService === 'object' && 'publish' in realtimeService) {
                ctx.logger.info('[ObjectQLPlugin] Bridging realtime service to ObjectQL for event publishing');
                this.ql.setRealtimeService(realtimeService as any);
            }
        } catch (e: any) {
            ctx.logger.debug('[ObjectQLPlugin] No realtime service found — data events will not be published', {
                error: e.message,
            });
        }

        // Bridge the i18n service so a rejected write reports in the caller's
        // language (#3957): it supplies both the `validation.field.*` message
        // overrides and the field's TRANSLATED label. Absent service is fine —
        // the built-in catalog in `@objectstack/spec/system` still localizes the
        // message against the field's declared label.
        try {
            const i18nService = ctx.getService('i18n');
            if (i18nService && typeof (i18nService as any).t === 'function') {
                ctx.logger.info('[ObjectQLPlugin] Bridging i18n service to ObjectQL for validation messages');
                this.ql.setI18nService(i18nService as any);
            }
        } catch (e: any) {
            ctx.logger.debug('[ObjectQLPlugin] No i18n service found — validation messages use the built-in catalog', {
                error: e.message,
            });
        }

        // [ADR-0144 D4, Open item 4] The localization the write-time home
        // projection reads: the organization's `localization.currency` (the
        // home currency it converts into) and `localization.timezone` (the
        // zone a `datetime` document date is dated in; ruling 6539345871,
        // letter B), in one grouped `getMany` read. The settings service is
        // resolved when a write asks, not here, so plugin order cannot leave
        // the projection without it. No settings service, or a `localization`
        // namespace or key not registered, is an unset setting — an unset home
        // currency is refused, never defaulted, and an unset timezone reads
        // UTC; a read that FAILS is the write's failure, not an unset setting.
        const isUnregisteredSetting = (e: any) => e?.code === 'SETTINGS_UNKNOWN_NAMESPACE' || e?.code === 'SETTINGS_UNKNOWN_KEY';
        const settingText = (resolved: { value?: unknown } | undefined) => (typeof resolved?.value === 'string' ? resolved.value : undefined);
        this.ql.setHomeLocalizationResolver(async (organizationId) => {
            let settings: {
                get?: (ns: string, key: string, c?: Record<string, unknown>) => Promise<{ value?: unknown } | undefined>;
                getMany?: (ns: string, keys: string[], c?: Record<string, unknown>) => Promise<Record<string, { value?: unknown } | undefined>>;
            } | undefined;
            try {
                settings = ctx.getService('settings') as typeof settings;
            } catch {
                return undefined;
            }
            if (!settings || typeof settings.get !== 'function') return undefined;
            const scope = organizationId !== undefined ? { tenantId: organizationId } : {};
            if (typeof settings.getMany === 'function') {
                try {
                    const many = await settings.getMany('localization', ['currency', 'timezone'], scope);
                    return { currency: settingText(many?.currency), timezone: settingText(many?.timezone) };
                } catch (e: any) {
                    // `getMany` is all-or-nothing: one unregistered key refuses
                    // both, so each is asked on its own below.
                    if (!isUnregisteredSetting(e)) throw e;
                }
            }
            const one = async (key: string) => {
                try {
                    return settingText(await settings!.get!('localization', key, scope));
                } catch (e: any) {
                    if (isUnregisteredSetting(e)) return undefined;
                    throw e;
                }
            };
            return { currency: await one('currency'), timezone: await one('timezone') };
        });
    }

    // Initialize drivers (calls driver.connect() which sets up persistence)
    await this.ql?.init();

    // [#23649] The drivers are live and nothing has been synced, hydrated, read
    // or written: the moment a subscriber can still decide WHERE objects live
    // (the stack's `datasourceMapping`). See {@link OBJECTQL_DRIVERS_READY_HOOK}.
    // Spelled as the literal here, not the constant: the settings bind-window
    // guard derives the hooks fired before the settings bind from their call
    // sites and can only read a literal name. The constant is the subscribers'
    // spelling; the runtime pin `datasource-mapping-before-schema-sync.test.ts`
    // subscribes through it and goes red if the two ever differ.
    if (this.ql) await ctx.trigger('objectql:drivers-ready', this.ql);

    // Phase 1: Sync built-in schemas so sys_metadata table exists before reading it.
    //
    // Cold-start-sensitive runtimes (Cloudflare Containers, Lambda) can
    // opt out via `skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1`. In that
    // mode an out-of-band migration must have already created every
    // table; we only assume the DDL is in place and skip straight to
    // hydration. This avoids one round-trip per table × N objects on
    // every cold boot.
    await this.installRegisteredSchemas(ctx);

    // Phase 2: Hydrate SchemaRegistry from sys_metadata (loads custom/template objects).
    // Project kernels (environmentId set) USUALLY source metadata from the
    // artifact (MetadataPlugin) or a control-plane proxy and have no local
    // sys_metadata, so hydration is skipped to avoid querying a table that
    // does not exist (or, worse, a proxied remote one). EXCEPTION: an
    // isolated, proxy-free project kernel that persists its OWN sys_metadata
    // locally (the cloud single-env tenant runtime) opts in via
    // `hydrateMetadataFromDb` so objects CREATED AT RUNTIME there re-enter the
    // registry after a restart — otherwise registry.getObject() returns
    // nothing for them and every registry consumer (the unknown-$select
    // guard, hooks, relationships) silently degrades. Safe because each engine
    // owns its registry (no cross-kernel leakage) and hydration tolerates a
    // missing table.
    if (this.environmentId === undefined || this.hydrateMetadataFromDb) {
        await this.restoreMetadataFromDb(ctx);
    } else {
        ctx.logger.info('Project kernel — skipping sys_metadata hydration (metadata sourced from artifact)');
    }

    // [ADR-0048 N.3, ruling letter A on #22307] The environment catalog is in
    // the registry now, and every package registered before it: a package-held
    // position or permission-set name the environment already holds refuses the
    // boot here, before any other plugin starts. See
    // {@link refuseEnvironmentHeldSecurityCatalogNames}.
    this.refuseEnvironmentHeldSecurityCatalogNames();

    // Phase 3: Sync any new schemas that were just hydrated from the DB
    // (e.g. CRM objects seeded via template — they must have tables before use).
    await this.installRegisteredSchemas(ctx);

    // Bridge all SchemaRegistry objects to metadata service.
    //
    // `SchemaRegistry` is a process-wide singleton, so project kernels in a
    // multi-environment server would otherwise inherit every object ever
    // registered by any sibling project. When this plugin was constructed
    // with a `environmentId`, the kernel is project-scoped — its
    // metadata comes from the artifact (MetadataPlugin) or the
    // control-plane proxy, not from local sys_metadata. The bridge would
    // only pollute its metadata service with cross-project leakage, so
    // skip it in that case.
    if (this.environmentId === undefined) {
        await this.bridgeObjectsToMetadataService(ctx);
    } else if (this.hydrateMetadataFromDb) {
        // The runtime-authored objects the hydration above just put in this
        // kernel's own registry. See {@link bridgeRuntimeObjectsToMetadataService}.
        await this.bridgeRuntimeObjectsToMetadataService(ctx);
    }
    // Arm the incremental per-manifest bridge for everything after start() —
    // marketplace install / rehydrate register through the `manifest`
    // service on `kernel:ready`, long after this line, and without the
    // incremental bridge their objects never reach the metadata service
    // (AI describe_object, Studio object lists, metadata.listObjects all
    // miss them; only the seed loader has an engine fallback, #3422).
    //
    // Deliberately NOT inside the `environmentId === undefined` gate above:
    // that gate exists because the one-shot bridge copies the ENTIRE
    // process-wide SchemaRegistry (cross-project leakage on multi-env
    // servers), whereas the per-manifest bridge only copies the objects of
    // the one package THIS kernel just registered — nothing to leak. And
    // `os dev` boots project-scoped (environmentId 'env_local'), which is
    // marketplace install-local's primary home: gating on environmentId
    // would switch the fix off exactly where it matters (caught by
    // browser-dogfooding the install flow).
    this.bridgeLateManifests = true;

    // Register built-in audit hooks
    this.registerAuditHooks(ctx);

    // Tenant isolation is now handled by `@objectstack/plugin-security`
    // via the `member_default` permission set's RLS rule
    // (`organization_id = current_user.organization_id`, with
    // field-existence guards). The legacy hard-coded `tenant_id` filter
    // middleware was removed because it (a) collided with the
    // SecurityPlugin RLS pipeline and (b) blindly filtered tables that
    // don't have a `tenant_id` column (e.g. `sys_organization`),
    // returning 0 rows instead of all rows.

    ctx.logger.info('ObjectQL engine started', {
        driversRegistered: this.ql?.['drivers']?.size || 0,
        objectsRegistered: this.ql?.registry?.getAllObjects?.()?.length || 0
    });

    // ADR-0057: arm the periodic lifecycle sweep once the engine is live.
    this.lifecycleService?.start();
  }

  /**
   * Kernel teardown.
   *
   * **This used to be `stop()`, which the kernel never calls** (#4747). The
   * Plugin contract is `init` / `start` / `destroy` — `packages/core/src/
   * types.ts`, and `DefaultDatasourcePlugin.destroy` says so in as many words
   * ("`stop()` exists nowhere in the Plugin contract and is never called").
   * So the one line that disarmed the ADR-0057 sweep never ran, on any host:
   * the timers outlived the engine, and 60s after a one-shot `os migrate`
   * boot the sweep woke up and queried a datasource its own host had already
   * disconnected — an `ERROR Find operation failed` on a SUCCESSFUL command,
   * and two objects filed as `unreadableObjects` by the #4551 audit on every
   * healthy run. A hook nobody calls is not defence in depth; it is the
   * absence of defence, spelled like its presence.
   */
  destroy = async () => {
    // ADR-0057: disarm the sweep timers AND call off a sweep in flight, before
    // the datasource plugin (destroyed after us — reverse registration order)
    // closes the pool underneath it.
    this.lifecycleService?.stop();
    // ADR-0008 PR-7: tear down metadata subscriptions on teardown so tests
    // don't leak watchers and reloaded plugins don't double-subscribe.
    for (const unsub of this.metadataUnsubscribes) {
      try { unsub(); } catch { /* teardown is best-effort — the kernel is going away */ }
    }
    this.metadataUnsubscribes = [];
  }

  /**
   * Re-register every object definition carried on a `metadata:reloaded`
   * payload into the SchemaRegistry. The artifact reload path registers
   * items via `MetadataManager.register()`, which does not fire
   * `subscribe()` watchers — without this ingest, an object added while the
   * server runs never reaches the registry (and therefore can never get a
   * table or answer a query). Mirrors `subscribeToMetadataEvents`'s
   * registerObject call: provenance comes from the `_packageId` the
   * MetadataPlugin stamped during registration (falling back to
   * 'metadata-service'), so package attribution stays reload-stable.
   * Removed objects are left registered until restart — same lifecycle as
   * their tables, which managed drift deliberately never drops.
   */
  /**
   * [ADR-0029 D9.8] Which contributor KIND a metadata-service body registers
   * as. The SAME discriminator the two `sys_metadata` hydration seams ask, owed
   * to these two ingest paths because they also register a reloaded body — left
   * as an unconditional `'own'` they re-open the splice through a third door,
   * and it is easy to miss precisely because they are about metadata-service
   * reloads rather than about tenant overlays.
   *
   * Narrower than the `sys_metadata` seams' rule, and deliberately so: a row
   * from `sys_metadata` is tenant-authored by definition, while THIS body can
   * be either layer. A reload of the OWNER's own definition (HMR, a package
   * re-registering its own object) must stay an `own` re-registration; it is a
   * body that arrives under a different id, or one that says it is
   * tenant-authored, that is a layer over the code definition.
   */
  private objectContributionKind(name: string, packageId: string, body: unknown): 'own' | 'overlay' {
    const registry: any = this.ql?.registry;
    if (typeof registry?.getPackagedObjectOwner !== 'function') return 'own';
    const owner = registry.getPackagedObjectOwner(name);
    if (!owner) return 'own';
    const tenantAuthored = (body as { _provenance?: unknown } | null | undefined)?._provenance === 'org';
    return owner.packageId === packageId && !tenantAuthored ? 'own' : 'overlay';
  }

  /**
   * Re-register each package body carried on a `metadata:reloaded` payload
   * through `registerApp`, the body door the boot registered it through (the
   * `manifest` service), so every collection that door decomposes into the
   * SchemaRegistry (`METADATA_ARRAY_KEYS`: email templates, flows, views,
   * dashboards, pages, actions, …) holds the reloaded item, not the boot copy.
   *
   * A REFRESH, never an install: only a package the registry already holds
   * from code or the marketplace is re-registered, under the source it was
   * installed with, and `installPackage` keeps its lifecycle (a disabled
   * package stays disabled). A body the boot never registered — the artifact
   * door alone serves it, so nothing in the registry is stale — is left to
   * that door, as before. Ordering is `resolveArtifactPackageEntries`', the
   * same call the `manifest` service makes on the same artifact.
   *
   * Items removed from the artifact stay registered until restart, the
   * lifecycle {@link ingestReloadedObjects} keeps for objects. A body that
   * fails to register is named and skipped: the reload goes on, and that
   * package keeps serving what it served before.
   */
  private refreshReloadedPackages(ctx: PluginContext, payload: unknown): void {
    if (!this.ql) return;
    const metadata = (payload as { metadata?: unknown } | undefined)?.metadata as Record<string, any> | undefined;
    if (!metadata || typeof metadata !== 'object') return;
    // The shape `AppPlugin` hands the `manifest` service: the manifest's
    // fields with the collections spread over them.
    const artifact = metadata.manifest && typeof metadata.manifest === 'object'
      ? { ...metadata.manifest, ...metadata }
      : metadata;
    let entries: ReturnType<typeof resolveArtifactPackageEntries>;
    try {
      entries = resolveArtifactPackageEntries(
        Array.isArray(artifact.packages) ? this.ql.convertPackageBodyForward(artifact) : artifact,
      );
    } catch (e: any) {
      ctx.logger.warn('[ObjectQLPlugin] reload could not read the artifact\'s packages — registry entries keep their previous definitions', {
        error: e?.message,
      });
      return;
    }
    const scope = {
      packageIds: entries
        .map((entry) => artifactPackageId(entry.manifest))
        .filter((id): id is string => id !== undefined),
    };
    const refreshed: string[] = [];
    for (const { manifest } of entries as Array<{ manifest: any }>) {
      const id = artifactPackageId(manifest);
      const installed = id === undefined ? undefined : this.ql.registry.getPackage(id);
      if (!installed || (installed.source !== 'code' && installed.source !== 'marketplace')) continue;
      try {
        this.ql.registerApp(manifest, scope, installed.source);
        refreshed.push(id!);
      } catch (e: any) {
        ctx.logger.warn('[ObjectQLPlugin] reload could not re-register a package — its registry entries keep their previous definitions', {
          packageId: id,
          error: e?.message,
        });
      }
    }
    if (refreshed.length > 0) {
      ctx.logger.info('[ObjectQLPlugin] reload refreshed the registry entries of its packages', { packageIds: refreshed });
    }
  }

  private ingestReloadedObjects(ctx: PluginContext, payload: unknown): void {
    if (!this.ql) return;
    const objects = (payload as any)?.metadata?.objects;
    if (!Array.isArray(objects) || objects.length === 0) return;
    let ingested = 0;
    for (const obj of objects) {
      const name = (obj as any)?.name;
      if (typeof name !== 'string' || name.length === 0) continue;
      try {
        this.ql.registry.invalidate(name);
        const reloadPackageId = (obj as any)._packageId ?? 'metadata-service';
        this.ql.registry.registerObject(
          obj as any,
          reloadPackageId,
          (obj as any).namespace,
          // [ADR-0029 D9.8] See {@link objectContributionKind}.
          this.objectContributionKind(name, reloadPackageId, obj),
        );
        ingested++;
      } catch (e: any) {
        ctx.logger.warn('[ObjectQLPlugin] reload object ingest failed', {
          name,
          error: e?.message,
        });
      }
    }
    if (ingested > 0) {
      ctx.logger.info('[ObjectQLPlugin] reload ingested object definitions into the registry', {
        count: ingested,
      });
    }
  }

  /**
   * Subscribe to `object` metadata events from the metadata service and
   * invalidate the SchemaRegistry merge cache on each event (ADR-0008
   * PR-7). For create/update we also re-load the affected object from
   * the metadata service so subsequent reads see the new definition;
   * for delete we unregister it from every contributing package.
   *
   * Events are filtered to the canonical `object` type — view/dashboard
   * /flow edits go through their own consumers (Studio SSE, REST cache).
   *
   * Stored unsubscribe handle is invoked from {@link stop}.
   */
  private subscribeToMetadataEvents(metadataService: any, ctx: PluginContext) {
    const handler = async (evt: any) => {
      if (!this.ql) return;
      const name: string = evt?.name ?? '';
      if (!name) return;
      const eventType: 'added' | 'changed' | 'deleted' =
        evt?.type === 'added' || evt?.type === 'changed' || evt?.type === 'deleted'
          ? evt.type
          : 'changed';

      try {
        // Drop the merged-schema cache entry first so any in-flight
        // resolveObject() races recompute against the new state.
        this.ql.registry.invalidate(name);

        if (eventType === 'deleted') {
          ctx.logger.info('[ObjectQLPlugin] object metadata deleted — registry invalidated', { name });
          return;
        }

        // Re-fetch the canonical definition from the metadata service.
        // The metadata service goes through its loader chain (FS, DB,
        // attached repository), so this picks up edits from any source.
        //
        // [#5840, ADR-0110 D3] Through `getDiagnosed` when the service offers
        // it: the loader chain named above is exactly what can be DOWN, and
        // `get()` reported an unreachable metadata database as the same
        // `undefined` a deleted object produces. The `else` branch below then
        // said, in the log, that the service "has no fresh body" — an
        // assertion about what is declared, made from a read that never
        // happened. A service that predates `getDiagnosed` reports nothing
        // degraded, which is precisely what it could express before.
        const read = typeof metadataService.getDiagnosed === 'function'
          ? await metadataService.getDiagnosed('object', name)
          : typeof metadataService.get === 'function'
            ? { data: await metadataService.get('object', name), degraded: false, errors: [] }
            : { data: undefined, degraded: false, errors: [] };
        const fresh = read?.data;
        if (fresh && typeof fresh === 'object') {
          // Re-register with the original contributor metadata. We use
          // 'metadata-service' as packageId to match how the initial
          // load enrolls these objects (see `loadMetadataFromService`).
          const packageId = (fresh as any)._packageId ?? 'metadata-service';
          const namespace = (fresh as any).namespace;
          this.ql.registry.registerObject(
            fresh as any,
            packageId,
            namespace,
            // [ADR-0029 D9.8] See {@link objectContributionKind}.
            this.objectContributionKind(name, packageId, fresh),
          );
          ctx.logger.info('[ObjectQLPlugin] object metadata updated — registry refreshed', {
            name,
            packageId,
          });
        } else if (read?.degraded) {
          // #5840 — `warn`, not `error`, and the choice is made with the
          // AGENTS.md "Degradation log levels" question rather than by
          // analogy to `restoreMetadataFromDb`'s `error` below. Ask it
          // honestly: does something this code CLAIMS IS PERSISTED fail to
          // land, while the system looks normal? No — the write already
          // landed in the metadata store; what failed is a re-READ, and the
          // registry keeps serving the definition it already holds. That is a
          // functional degradation (this kernel's copy is behind), not a
          // durability one. Escalating it would be the mirror-image failure
          // that rule warns about, and it would fire once per event during an
          // outage rather than once per boot.
          //
          // What it still owes the reader is the consequence and the fix,
          // which the `debug` line it replaces gave neither of.
          ctx.logger.warn(
            '[ObjectQLPlugin] object metadata changed but the metadata service could not be read — ' +
              'the registry keeps the PREVIOUS definition for this object and nothing retries: reads serve the stale ' +
              'schema until a later event for it succeeds or the process restarts. ' +
              'Fix: check the loaders behind the metadata service (datasource connection, credentials, table).',
            { name, errors: read.errors },
          );
        } else {
          // A read that HAPPENED and found nothing — the object really is gone
          // from every loader (deleted between the event and this re-read).
          ctx.logger.debug('[ObjectQLPlugin] object event received but metadata service has no fresh body', { name });
        }
      } catch (e: any) {
        ctx.logger.warn('[ObjectQLPlugin] metadata event handler failed', {
          name,
          error: e?.message,
        });
      }
    };

    const unsub = metadataService.subscribe('object', handler);
    if (typeof unsub === 'function') {
      this.metadataUnsubscribes.push(unsub);
    } else if (unsub && typeof unsub.unsubscribe === 'function') {
      // Support `MetadataWatchHandle` style return shape.
      this.metadataUnsubscribes.push(() => unsub.unsubscribe());
    }
    ctx.logger.info('[ObjectQLPlugin] subscribed to object metadata events (ADR-0008 PR-7)');
  }

  /**
   * Register the built-in audit stamps (`created_by` / `updated_by` /
   * `created_at` / `updated_at` / `tenant_id`). They are written in the
   * canonical `Hook` shape and wrapped by the same declarative wrapper the
   * binder uses, but registered IN CODE, with no metadata binding: audit is
   * platform behaviour, and `ExecutionContext.skipAutomations`, which skips
   * every hook bound from metadata, must never bypass it (#22070).
   */
  private registerAuditHooks(ctx: PluginContext) {
    if (!this.ql) return;

    const stamp = () => new Date().toISOString();

    /**
     * Returns true when the resolved object schema declares a field with the
     * given name. Audit fields (`created_by`, `updated_by`, `tenant_id`) are
     * NOT auto-injected by the SQL driver, so we must only stamp values for
     * fields the user has explicitly declared on the object — otherwise the
     * driver will issue an INSERT against a column that does not exist in
     * the physical table (e.g. `table lead has no column named created_by`).
     *
     * `created_at`/`updated_at` are unconditional because driver-sql creates
     * them as built-in columns on every table.
     */
    const hasField = (objectName: string, field: string): boolean => {
      try {
        const schema: any = this.ql?.getSchema?.(objectName);
        if (!schema || typeof schema !== 'object') return false;
        const fields = schema.fields;
        if (!fields || typeof fields !== 'object') return false;
        return Object.prototype.hasOwnProperty.call(fields, field);
      } catch {
        return false;
      }
    };

    const applyToRecord = (
      record: Record<string, any>,
      objectName: string,
      session: any,
      isInsert: boolean,
      seedReplay: boolean,
    ) => {
      const now = stamp();
      // A "historical" import (#3493) reinstates the ORIGINAL timeline, so a
      // client-supplied created_at/created_by/updated_at/updated_by is
      // CLIENT-PREFERRED under `preserveAudit` — instead of being overwritten
      // with the import instant. Opt-in and server-set only; a normal write
      // leaves `preserveAudit` unset and still stamps now.
      //
      // [#15964] `created_at` takes the SAME SHAPE as `updated_at`, on the
      // maintainer ruling of 2026-09-06 (decision batch #54, option A). It was
      // `record.created_at ?? now` on EVERY insert — client-preferred with no
      // flag at all — and since #15395 the static-`readonly` strip runs INSIDE
      // `engine.insert`, AFTER this hook, where #14259's guard reads a key a
      // `beforeInsert` hook ASSIGNED as the hook's write rather than a caller
      // forgery (`rowHookWrittenKeys`). The `??` therefore LAUNDERED the
      // caller's bytes past that strip: an ordinary authenticated POST kept a
      // forged `created_at` on an object declaring it `readonly: true`, while
      // `id`, `updated_at` and every other author-declared readonly datetime in
      // the same payload were taken. Under `preserveAudit` the preservation is
      // DECLARED, so the same keep is the ruled historical-import channel and
      // stays — which is why the fix is this ternary and not a bare `= now`.
      //
      // [#21646] A SEED write keeps an authored `created_at` on insert too —
      // the same `?? now` — because a seed is a snapshot of established facts
      // (`ExecutionContext.seedReplay`), and the replay of the same row on a
      // later boot already writes that value through the update path, which
      // never touches `created_at`. Keyed on `seedReplay` alone: ⛔ not on
      // `isSystem` (a system clone could carry its source row's `created_at`),
      // and ⛔ the seed context gains no `preserveAudit` (the 2026-08-08 ruling
      // keeps that flag's readonly exemption UPDATE-only). Every other caller
      // — REST included — still stamps now.
      const preserveAudit = session?.preserveAudit === true;
      if (isInsert) {
        record.created_at = preserveAudit || seedReplay ? (record.created_at ?? now) : now;
      }
      record.updated_at = preserveAudit ? (record.updated_at ?? now) : now;
      // [#16311] `created_by` takes the SAME SHAPE as `updated_by`, one field
      // over — the identical laundering, measured on the same rig and closed
      // the same way, because two fields fixed two ways inside one function is
      // how this second card came to exist at all. It was
      // `record.created_by ?? session.userId`: client-preferred with no flag,
      // so an ordinary authenticated POST stored `created_by: 'forged_user'`
      // while `updated_by` in the SAME payload was correctly overwritten with
      // the session user — the control proving the strip ran on that row and
      // took the sibling audit field.
      //
      // Both audit-user assignments stay INSIDE `if (session?.userId)`, and
      // that guard is load-bearing rather than incidental. `created_by` is not
      // symmetric with `created_at`: with no session the hook must assign
      // NOTHING, so the engine strip takes a caller's forgery and the key is
      // absent. Assigning `session.userId` unconditionally would write
      // `undefined` into the key, making it one the hook "wrote"; #14259's
      // guard would then spare it and a branch that is correct today would
      // become a NEW hole. Pinned as row1 of
      // `plugin-audit-created-by-create-side.test.ts`.
      if (session?.userId) {
        if (isInsert && hasField(objectName, 'created_by')) {
          record.created_by = preserveAudit ? (record.created_by ?? session.userId) : session.userId;
        }
        if (hasField(objectName, 'updated_by')) {
          record.updated_by = preserveAudit ? (record.updated_by ?? session.userId) : session.userId;
        }
      }
      // Stamp the driver-layer `tenant_id` column from the caller's active org.
      // The hook session exposes it as `organizationId` (the `session.tenantId`
      // alias was removed in v16, #3290); the column name is a separate axis.
      if (isInsert && session?.organizationId && hasField(objectName, 'tenant_id')) {
        record.tenant_id = record.tenant_id ?? session.organizationId;
      }
    };

    const stampData = (
      data: unknown,
      objectName: string,
      session: any,
      isInsert: boolean,
      seedReplay: boolean,
    ) => {
      if (Array.isArray(data)) {
        for (const row of data) {
          if (row && typeof row === 'object') {
            applyToRecord(row as Record<string, any>, objectName, session, isInsert, seedReplay);
          }
        }
      } else if (data && typeof data === 'object') {
        applyToRecord(data as Record<string, any>, objectName, session, isInsert, seedReplay);
      }
    };

    /**
     * [#21646] Whether this `beforeInsert` is a SEED write
     * (`ExecutionContext.seedReplay`, set through `SEED_WRITE_EXECUTION_CONTEXT`
     * by every seeder). Read from `input.options.context`, not `session`: the
     * engine's `buildSession` copies `isSystem`, the skip flags and
     * `preserveAudit` onto the hook session, never `seedReplay`, while a
     * `before*` envelope's `input.options` IS the caller's own options bag
     * (HookContext `input` PHASE contract), so its `context` is the write's
     * ExecutionContext as the seeder built it. Server-constructed, like
     * `isSystem`: no transport entry point assembles it from a request.
     */
    const isSeedReplay = (hookCtx: any): boolean =>
      hookCtx?.input?.options?.context?.seedReplay === true;

    const builtinHooks: any[] = [
      {
        name: 'sys_stamp_audit_insert',
        object: '*',
        events: ['beforeInsert'],
        priority: 10,
        description: 'Auto-stamp created_by / updated_by / created_at / updated_at / tenant_id on insert (only when the field exists on the object schema)',
        handler: async (hookCtx: any) => {
          if (hookCtx.input?.data) {
            stampData(hookCtx.input.data, hookCtx.object, hookCtx.session, true, isSeedReplay(hookCtx));
          }
        },
      },
      {
        name: 'sys_stamp_audit_update',
        object: '*',
        events: ['beforeUpdate'],
        priority: 10,
        description: 'Auto-stamp updated_by / updated_at on update (only when the field exists on the object schema)',
        handler: async (hookCtx: any) => {
          if (hookCtx.input?.data) {
            // `seedReplay` is moot here: the update stamp never writes `created_at`.
            stampData(hookCtx.input.data, hookCtx.object, hookCtx.session, false, false);
          }
        },
      },
      // ⛔ RETIRED — `sys_fetch_previous_update` (#5846 (a), delivered with
      // #5574's engine half). Do not reintroduce it.
      //
      // It was registered here on `object: '*'` at priority 5, and on every
      // by-id update it issued its own `ql.findOne` to bind
      // `hookCtx.previous`, behind the guard `if (input.id && !ctx.previous)`.
      // That guard is now PERMANENTLY FALSE: `update()` reads the prior row and
      // binds `hookContext.previous` BEFORE dispatching `beforeUpdate` (the
      // shape `delete()` has had since #5272), because ADR-0058 Addendum II
      // makes the before phase a real reader of that row. A hook whose only
      // statement is a guard that can no longer be true is not a safety net,
      // it is a second read waiting to be rediscovered — so it goes, rather
      // than being left in place "just in case".
      //
      // What it cost while it stood, measured on #5846: a single by-id update
      // on a kernel with plugin-audit read the same row THREE times — this
      // builtin, plugin-audit's `captureBefore`, and the engine's own gated
      // read. Two of the three were engine reads through the full read pipeline
      // (middleware, RLS, field masking) and neither consulted any demand gate.
      // This change removes one and makes the engine's the single producer;
      // `captureBefore`'s now-redundant read followed it out in #6656, which
      // leaves the engine's gated read as the only producer on this path.
      //
      // ⛔ RETIRED — `sys_fetch_previous_delete` (#5929, ADR-0049
      // enforce-or-remove). Do not reintroduce it.
      //
      // #5846 left the measurement here rather than the hook, precisely so this
      // retirement would not have to rediscover it. Quoted from the block above
      // as it stood then, because it IS the argument:
      //
      //   `delete()` reads its pre-image when `wantsPreImage` is true, and that
      //   gate is `hasHooksFor('beforeDelete', object) || hasHooksFor(
      //   'afterDelete', object) || summaries`. The builtin is itself a
      //   `beforeDelete` hook on `'*'`, so it makes the FIRST term true for
      //   every object — and then the engine's read binds `previous` before the
      //   builtin runs, so the builtin's own `!ctx.previous` guard is false and
      //   it issues no `findOne`. It is circular: the builtin's only remaining
      //   effect is to hold open the gate that makes it redundant.
      //
      // Verified on this branch before removing anything, because a measurement
      // recorded on one PR is a hypothesis on the next: the engine binds
      // `previous` ahead of `beforeDelete` on BOTH delete shapes — by-id since
      // #5272, per matched row since #6697 — so the guard is unreachable in
      // production, and removing the hook changes no `previous` binding
      // anywhere. The residual shape, `!hookCtx.previous` because the engine's
      // own read found nothing, is one where this handler's read finds nothing
      // either (same row, same transaction, same tenant scope): it binds
      // nothing, and `bindPreImage` deliberately leaves `previous` UNBOUND
      // rather than fabricating `{}` (#4649/#4775).
      //
      // What retiring it buys, and what it does NOT buy — both worth stating so
      // the next reader does not over-read the result:
      //   * it makes `hasHooksFor('beforeDelete', object)` an honest question on
      //     an objectql-only kernel, so an object with no delete-side hook and
      //     no roll-up summary finally pays NO prior-row read on a by-id
      //     `delete()`. That skip could never happen while this hook stood.
      //   * it does not, on its own, make the gate false on a kernel that also
      //     loads plugin-auth / plugin-sharing / plugin-audit: each of those
      //     registers a delete-phase hook with no `object` (i.e. global), and
      //     they hold the same gate open for their own reasons. Those are real
      //     consumers with real handlers, not circular ones — the gate answering
      //     "yes" for them is the gate working. The enumeration lives in
      //     `engine.ts` beside `wantsPreImage`.
      //
      // The retired hook's own shape is replayed as an authored hook in
      // `engine-delete-prior-read-scope.test.ts`, which measures that its guard
      // short-circuits and it issues zero reads — so "the guard can no longer be
      // true" stays a measurement instead of rotting into a claim.
    ];

    // [#22070] Registered IN CODE — `registerHook`, with NO `meta` — and never
    // through the hook binder. `meta` is the metadata binding the engine's
    // `skipAutomations` opt-out keys on (`triggerHooks`): every hook the binder
    // binds is skippable by it, and `ExecutionContext.skipAutomations` says
    // audit never is. Bound through the binder, these stamps were skipped with
    // the app's hooks, so a data import with "run automations & triggers"
    // unchecked stored rows with no `created_by` / `updated_by`, no declared
    // `tenant_id`, and no timestamps on a driver that does not stamp its own.
    // Every entry of `builtinHooks` takes this path, so a builtin added to the
    // list later cannot reach the opt-out either.
    //
    // What the binder gave them is kept, deliberately, so the opt-out is the
    // ONLY thing that changes for a builtin:
    //  - the same wrapper (`wrapDeclarativeHook`) with the engine's metrics
    //    recorder, read now exactly as `bindHooks` reads it at bind time — the
    //    Server-Timing `hooks` span AppPlugin installs in its `init`, ahead of
    //    this `start`, keeps counting them;
    //  - the unregister-by-package first, which keeps a second ObjectQLPlugin
    //    on a SHARED engine (the constructor accepts an existing `ql`) from
    //    registering every stamp twice.
    this.ql.unregisterHooksByPackage('sys:audit');
    const metrics = this.ql.getHookMetricsRecorder();
    for (const h of builtinHooks) {
      const wrapped = wrapDeclarativeHook(h, h.handler, { logger: ctx.logger, metrics });
      for (const event of h.events) {
        this.ql.registerHook(event, wrapped, {
          object: h.object,
          priority: h.priority,
          packageId: 'sys:audit',
        });
      }
    }

    // `previousData` used to be listed here as a third thing these builtins
    // did. It is not one any more: both fetch-previous hooks are retired
    // (#5846 update-side, #5929 delete-side) and `previous` is bound by the
    // ENGINE on both write paths. A log line naming a producer that no longer
    // exists is the cheapest way to send the next reader looking for it.
    ctx.logger.debug('Audit hooks registered in code (created_by/updated_by/created_at/updated_at/tenant_id stamping)');
  }

  /**
   * Tenant isolation moved to `@objectstack/plugin-security`'s
   * `member_default` permission set RLS
   * (`organization_id = current_user.organization_id`, with
   * field-existence guards). The legacy `registerTenantMiddleware`
   * method was removed because it (a) collided with SecurityPlugin's
   * RLS pipeline and (b) blindly filtered tables that don't have a
   * `tenant_id` column (e.g. `sys_organization`), returning 0 rows
   * instead of all rows.
   */

  /**
   * Read every registered object — or FAIL. The ONE registry read the three
   * seams below share, and it exists so that none of them can answer a read
   * that could not run with an invented *"the registry holds nothing"*.
   *
   * [#9285] All three used to spell the read
   * `this.ql.registry?.getAllObjects?.() ?? []`, which folds three different
   * facts into one value:
   *
   *   1. the registry answered, and holds no objects;
   *   2. the engine exposes no `registry` at all;
   *   3. the registry exposes no `getAllObjects` — a STRUCTURAL omission that
   *      never throws, so it is invisible precisely when it is wrong.
   *
   * Only (1) is truthfully "no objects". #8895 ruled this family
   * *discriminate or propagate*; #9002 and #9154 applied it to the two
   * delete-cascade seams and the roll-up summary index. There is no benign
   * failure class to discriminate here either, so (2) and (3) become a thrown
   * error that names the consequence, and a registry that THROWS propagates
   * its own error verbatim — this helper adds no `catch` of its own.
   *
   * What each caller DOES with that failure is the caller's decision, taken at
   * the seam and justified there: {@link syncRegisteredSchemas} lets it
   * propagate (a boot that could not read the registry must not report a clean
   * start against a store whose DDL never ran), while the two diagnostic
   * passes report it once, loudly, and degrade — an audit that did not run
   * must never be spelled the same way as an audit that found nothing.
   *
   * ⚠️ A STRUCTURAL close, not a live defect — re-derived on this tree:
   * `SchemaRegistry.getAllObjects()` is a walk over in-memory `Map`s calling
   * `resolveObject()`, which returns `undefined` on every failure branch it
   * models and never throws, and `ObjectQL.registry` is a getter over a
   * field-initialized `SchemaRegistry`, so for a real engine neither optional
   * link can short-circuit. The only reach is a duck-typed `ql` — which is
   * exactly the incomplete test double #9154 measured.
   *
   * @param seam - the calling method, named in the thrown message.
   */
  private readRegisteredObjects(seam: string): ServiceObject[] {
    const registry: any = (this.ql as any)?.registry;
    const read: unknown = registry?.getAllObjects;
    if (registry == null || typeof read !== 'function') {
      throw new Error(
        `[ObjectQLPlugin] ${seam}: the object registry could not be read — ` +
          (registry == null
            ? 'the engine exposes no `registry`.'
            : '`registry.getAllObjects` is not a function.') +
          ' This is NOT "no objects are registered": that answer was never obtained, and the two have opposite ' +
          'consequences (nothing to sync vs. nothing synced). Give the engine a registry that implements ' +
          '`getAllObjects()` — a duck-typed engine or an incomplete test double is the only way to reach this line.',
      );
    }
    return (read as () => ServiceObject[]).call(registry);
  }

  /**
   * Bind every declared FEDERATED (external) object to its remote table —
   * once, at `kernel:ready`, when the boot has finished moving (#7737).
   *
   * ## What the binding is, and why it has to happen twice
   *
   * `driver.registerExternalObject(obj)` is what installs an external
   * object's read metadata: the object -> remote-table mapping
   * (`external.remoteName` / `remoteSchema`), the `external.columnMap`
   * translation, and the type-coercion maps. Nothing else installs it. An
   * external object without it resolves to a table named after the OBJECT
   * rather than the remote table it declares, so every read against it either
   * fails with "no such table" or silently answers from the wrong table.
   *
   * {@link syncRegisteredSchemas} already calls it — but it runs inside THIS
   * plugin's `start()`, and the declared datasource that owns the remote
   * database is auto-connected in `AppPlugin.start()` (ADR-0062 D1), a later
   * `start()`. So at boot schema-sync time `getDriverForObject()` legitimately
   * answers `undefined` for a federated object on a healthy boot, and that
   * call is skipped. Whether the object ends up bound then depends on some
   * OTHER component re-driving it afterwards — today
   * `DatasourceConnectionService` does, but only for objects the datasource
   * knew to name (an explicit `object.datasource`), never for objects a
   * `datasourceMapping` rule routes to it, and not at all when
   * `OS_SKIP_SCHEMA_SYNC` is set (that flag is about DDL, and this binding is
   * DDL-free).
   *
   * This pass removes that dependence on boot ORDER: it runs after every
   * `start()` has completed, re-drives the binding for every registered
   * external object (idempotent — `registerExternalObject` is pure metadata
   * assignment), and is therefore correct no matter which plugin connected
   * the datasource, in which slot, or whether DDL was skipped.
   *
   * ## …and it REPORTS what it could not bind
   *
   * A federated object that reaches the end of boot with no driver is
   * declared-but-unreadable while the object stays registered, keeps its REST
   * routes and keeps rendering in the UI. That is the shape #7737 was filed
   * for, and the reason its ruling is that the skip must stop being silent:
   * `debug` at the skip site was the whole diagnosis of a broken federation.
   * Reported at `error` per the AGENTS.md degradation-log-level rule — from
   * the outside the deployment looks healthy while declared data is simply
   * not reachable — naming the objects, their datasources, the consequence
   * and the fix. A boot with nothing to report says nothing.
   *
   * One class is reported apart, at `info` (#25079): an object whose datasource
   * the connect policy denied (`listUnavailableDatasources()` kind `blocked`).
   * Its reads refuse loudly, and the denial was deliberate.
   */
  private async reconcileFederatedBindings(ctx: PluginContext): Promise<void> {
    if (!this.ql) return;

    // [#9285] The read no longer invents an empty registry. This pass exists
    // to NAME what it could not bind — "a boot with nothing to report says
    // nothing" (above) — so a read that could not RUN must not be spelled as a
    // boot with nothing to report; that is precisely the silence the pass was
    // written to prevent. It is reported and the pass degrades rather than
    // throwing: this is a post-hoc reconciliation, deliberately run after every
    // `start()` has completed so that a late-connecting datasource is not a
    // boot failure, and propagating here would turn a diagnostic into the hard
    // stop it was written not to be. (By then {@link syncRegisteredSchemas} has
    // already read the same registry successfully on every boot that does not
    // set `skipSchemaSync`, so a failure at THIS line is a registry that became
    // unreadable mid-boot, not the boot-wide condition seam 2 catches.)
    // `error`, not `warn`, per the AGENTS.md degradation-log-level rule and for
    // the same reason the report below it is: from the outside the deployment
    // looks healthy while declared data is simply not reachable.
    let allObjects: ServiceObject[];
    try {
      allObjects = this.readRegisteredObjects('reconcileFederatedBindings');
    } catch (e: unknown) {
      ctx.logger.error(
        'Federated (external) object reconciliation did NOT run — the object registry could not be read, so this boot ' +
          'never determined which declared external objects are bound to their remote tables, and never re-drove the ' +
          'bindings this pass exists to install. Any object left unbound stays registered and served: it keeps its REST ' +
          'routes and keeps rendering in the UI, while every read against it resolves to a table named after the OBJECT ' +
          'instead of the remote table it declares — so those reads fail with "no such table", or answer from the wrong ' +
          'table. This is NOT "no federated objects to bind": that answer was never obtained. Fix the registry error ' +
          'below and restart (or trigger a metadata reload) to re-run this binding.',
        e instanceof Error ? e : new Error(String(e)),
      );
      return;
    }
    const federated = allObjects.filter((o: any) => isFederatedObject(o));
    if (federated.length === 0) return;

    let bound = 0;
    const unbound: string[] = [];
    const denied: string[] = [];
    const unsupported: string[] = [];
    const failed: string[] = [];
    const datasourceOf = (name: string): string =>
      this.ql?.resolveEffectiveDatasource?.(name) ?? '(default)';
    // [#25079] The datasource layer's recorded verdict, read back through the
    // engine: `blocked` is a connect the host policy REFUSED on purpose
    // (`os migrate`'s managed-only policy refuses every `schemaMode:
    // 'external'` datasource), as opposed to `failed`. Judged on the verdict
    // alone, on every composition.
    const blocked = new Set(
      this.ql.listUnavailableDatasources().filter((d) => d.kind === 'blocked').map((d) => d.name),
    );

    for (const obj of federated) {
      const driver: any = this.ql.getDriverForObject(obj.name);
      if (!driver) {
        const datasource = datasourceOf(obj.name);
        (blocked.has(datasource) ? denied : unbound).push(`${obj.name} -> datasource '${datasource}'`);
        continue;
      }
      if (typeof driver.registerExternalObject !== 'function') {
        unsupported.push(`${obj.name} -> driver '${driver.name}'`);
        continue;
      }
      try {
        await driver.registerExternalObject(obj);
        bound++;
      } catch (e: unknown) {
        failed.push(`${obj.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // [#25079] A policy denial is a decision, not a durability loss: every read
    // against such an object refuses with `DatasourceUnavailableError`, so
    // nothing looks normal while it is not — functional, hence `info` per the
    // AGENTS.md degradation-log-level rule, and named rather than silent
    // (#7737). It stays out of the ERROR below, whose consequence ("resolves
    // to a table named after the OBJECT") is false for it.
    if (denied.length) {
      ctx.logger.info(
        `${denied.length} federated (external) object(s) left unbound because the connect policy denied their ` +
          `datasource: ${denied.join(', ')}. Every read against them is refused (DatasourceUnavailableError) until ` +
          `the policy allows that datasource; see its "connect denied by policy" line earlier in this boot.`,
        { denied: denied.length },
      );
    }

    if (unbound.length === 0 && unsupported.length === 0 && failed.length === 0) {
      ctx.logger.debug('Federated objects bound to their remote tables', { bound });
      return;
    }

    ctx.logger.error(
      `${unbound.length + unsupported.length + failed.length} federated (external) object(s) are NOT bound to their remote ` +
        `table, yet stay registered and served: they keep their REST routes and keep rendering in the UI, while every read ` +
        `against them resolves to a table named after the OBJECT instead of the remote table it declares — so those reads ` +
        `fail with "no such table", or answer from the wrong table. ` +
        (unbound.length
          ? `No driver for the declared datasource (never declared, or its connection was refused/failed — see that ` +
            `datasource's own connect verdict earlier in this boot): ${unbound.join(', ')}. `
          : '') +
        (unsupported.length
          ? `Driver does not implement external-object registration (ADR-0015 federation): ${unsupported.join(', ')}. `
          : '') +
        (failed.length ? `Registration threw: ${failed.join(', ')}. ` : '') +
        `Fix the datasource/driver named above and restart (or trigger a metadata reload) to re-run this binding.`,
      undefined,
      { bound, unbound: unbound.length, unsupported: unsupported.length, failed: failed.length },
    );
  }

  /**
   * Install every registered object's schema with its driver — the ONE seam
   * `start()` uses for that, on both the syncing and the DDL-free path.
   *
   * `skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1` opts a deployment out of **DDL**,
   * not out of telling the driver what its objects look like. Those were the
   * same thing until now: {@link syncRegisteredSchemas} is the only caller of
   * `syncSchema()`, and a SQL driver builds its per-object coercion registries
   * (JSON, boolean, numeric, date/datetime/time, auto_number, and the
   * tenant-isolation column) as the first step of that DDL call. So a boot that
   * skipped it came up with those registries EMPTY and every value written
   * afterwards encoded by whatever the underlying client does with a bare JS
   * value.
   *
   * On Postgres that is a live data-correctness defect, not a slow path: an
   * array value on a `json` field reaches node-postgres, which renders it as a
   * Postgres ARRAY LITERAL — `22P02 invalid input syntax for type json`, a 500
   * on every write — **except `[]`, whose literal `{}` is valid JSON**, so an
   * empty array is accepted and silently stored as an empty OBJECT. A bare
   * string 500s for the same reason (`x` is not JSON text; `"x"` is). SQLite
   * hides all of it behind a dialect-local bind-safety net, which is why the
   * SQLite/Turso suites never saw it.
   *
   * The split is the same ruling #7737 made for federated objects (commit 199ec4712) —
   * that flag is about DDL, and a binding that is DDL-free must not ride on it
   * — applied to the managed ones.
   */
  private async installRegisteredSchemas(ctx: PluginContext): Promise<void> {
    if (!this.skipSchemaSync) {
      await this.syncRegisteredSchemas(ctx);
      return;
    }
    await this.registerSchemasWithoutDdl(ctx);
  }

  /**
   * Tell every driver about its objects **without running any DDL** — what a
   * `skipSchemaSync` boot does instead of {@link syncRegisteredSchemas}.
   *
   * Pure in-memory metadata assignment on the driver side
   * (`registerObjectMetadata`, the managed sibling of
   * `registerExternalObject`): no `CREATE TABLE`, no `ALTER TABLE`, no
   * existence probe, no round-trip. That matters, because the reason
   * `skipSchemaSync` exists is a cold-start budget shorter than "one round-trip
   * per table × N objects" — this pass costs one pass over the object list and
   * keeps the promise the flag actually makes.
   *
   * Federated (external) objects are skipped here on purpose: their DDL-free
   * binding is `registerExternalObject`, driven by {@link syncRegisteredSchemas}
   * on a syncing boot and unconditionally by {@link reconcileFederatedBindings}
   * at `kernel:ready` — i.e. they were already correct under this flag, and
   * managed objects were the half with nothing.
   *
   * Idempotent, so it is safe to re-drive after every metadata reload.
   */
  private async registerSchemasWithoutDdl(ctx: PluginContext): Promise<void> {
    if (!this.ql) return;

    // [#9285] Same propagation contract as the sync pass: "the registry holds
    // nothing" and "the registry could not be read" have opposite consequences
    // and only the first is a truthful reason to register nothing.
    const allObjects = this.readRegisteredObjects('registerSchemasWithoutDdl');
    if (allObjects.length === 0) return;

    const groups = new Map<any, ServiceObject[]>();
    let federated = 0;
    let unsupported = 0;
    let unbound = 0;

    for (const obj of allObjects) {
      if (isFederatedObject(obj)) {
        federated++;
        continue;
      }
      const driver: any = this.ql.getDriverForObject(obj.name);
      if (!driver) {
        unbound++;
        continue;
      }
      if (typeof driver.registerObjectMetadata !== 'function') {
        unsupported++;
        continue;
      }
      let group = groups.get(driver);
      if (!group) {
        group = [];
        groups.set(driver, group);
      }
      group.push(obj);
    }

    let registered = 0;
    for (const [driver, objects] of groups) {
      try {
        await driver.registerObjectMetadata(objects);
        registered += objects.length;
      } catch (e: unknown) {
        // Reported at `error` per the AGENTS.md degradation-log-level rule: the
        // deployment looks healthy — the tables exist, the objects are served —
        // while the values written to them are encoded by the client's
        // per-type defaults rather than by their declared field types.
        ctx.logger.error(
          `[ObjectQLPlugin] DDL-free schema registration FAILED for driver '${driver?.name}' — its objects stay registered and ` +
            `served, but the driver was never told their field types, so values written to them are encoded by the database ` +
            `client's per-type defaults instead: on Postgres an array on a JSON field is rejected as a malformed array literal ` +
            `and an empty array is silently stored as an empty object. Fix the driver error below and restart.`,
          e instanceof Error ? e : new Error(String(e)),
          { driver: driver?.name, objects: objects.length },
        );
      }
    }

    ctx.logger.info(
      'Skipping schema sync (OS_SKIP_SCHEMA_SYNC=1) — assuming DDL is managed out-of-band; ' +
        `registered ${registered} object schema(s) with their drivers WITHOUT DDL`,
      { registered, federated, unsupported, unbound, total: allObjects.length },
    );
  }

  /**
   * Synchronize all registered object schemas to the database.
   *
   * Groups objects by their responsible driver, then:
   * - If the driver advertises `supports.batchSchemaSync` and implements
   *   `syncSchemasBatch()`, submits all schemas in a single call (reducing
   *   network round-trips for remote drivers like Turso).
   * - Otherwise falls back to sequential `syncSchema()` per object.
   *
   * This is idempotent — drivers must tolerate repeated calls without
   * duplicating tables or erroring out.
   *
   * Drivers that do not implement `syncSchema` are silently skipped.
   */
  private async syncRegisteredSchemas(ctx: PluginContext) {
    if (!this.ql) return;

    // [#9285] The read PROPAGATES — no `?.`, no `?? []`. The next line turns
    // "no objects" into an early return, i.e. NO registered object's schema is
    // synced to any driver: no table created, no column added, silently, at
    // boot, with the plugin reporting a clean start. "The registry holds
    // nothing" and "the registry could not be read" have opposite consequences
    // here and only the first is a truthful reason to skip, so a read that
    // could not run fails the boot instead — more truthful than starting
    // against a store whose DDL was never run. On the `metadata:reloaded` path
    // the caller already catches this and reports it at `error` (#4632), so
    // propagation there is a loud durability report, not a dead kernel.
    const allObjects = this.readRegisteredObjects('syncRegisteredSchemas');
    if (allObjects.length === 0) return;

    let synced = 0;
    let skipped = 0;
    let failed = 0;

    /**
     * #4632 — a failed schema sync is a DURABILITY degradation, not a
     * functional one, so it is reported at `error`.
     *
     * The object stays in the registry, keeps its REST routes, keeps rendering
     * in the UI — the system looks completely healthy — while its table or its
     * newly-declared columns were never created. Writes then fail, or (on
     * drivers that accept unknown attributes) succeed while silently dropping
     * the un-created column: the thing the system claims it persisted is not
     * on disk. That is exactly the #4420 shape one layer up from the durable
     * suspended-run store #4460 fixed, so it carries the same obligation —
     * name the CONSEQUENCE and the FIX at the first failure.
     */
    const reportSyncFailure = (
      obj: any,
      tableName: string,
      driverName: string,
      err: unknown,
    ): void => {
      failed++;
      // NB `Logger.error` is `(message, error?, meta?)` — the Error goes in the
      // SECOND slot, unlike `warn`'s `(message, meta?)`. This call was written
      // as a mechanical warn→error swap and the mismatch only surfaced in the
      // DTS build, never in a test run.
      ctx.logger.error(
        `Schema sync FAILED for object '${obj?.name}' — its table/columns were NOT created or altered, but the object stays ` +
          `registered and served: writes to it will fail, or silently drop the columns that were never created. ` +
          `Nothing that claims to be persisted for this object is guaranteed to be on disk. ` +
          `Fix the driver/datasource error below and restart (or trigger a metadata reload) to re-run DDL; ` +
          `if this deployment manages DDL out-of-band, set \`skipSchemaSync\` / OS_SKIP_SCHEMA_SYNC so the omission is deliberate.`,
        err instanceof Error ? err : new Error(String(err)),
        { object: obj?.name, tableName, driver: driverName },
      );
    };

    // Group objects by driver for potential batch optimization
    const driverGroups = new Map<any, Array<{ obj: any; tableName: string }>>();

    for (const obj of allObjects) {
      const driver = this.ql.getDriverForObject(obj.name);
      if (!driver) {
        // #7737 — for a FEDERATED object this skip is not a schema-sync
        // detail. `registerExternalObject` (just below) is the ONLY thing
        // that installs the object -> remote-table mapping, and it lives past
        // this guard: skip it and every read of that object resolves against
        // a table named after the object instead of the remote table it
        // declares.
        //
        // It is also NOT, by itself, a defect. Boot schema-sync runs inside
        // this plugin's `start()`, while a declared datasource is
        // auto-connected in `AppPlugin.start()` — a later `start()` on every
        // composition that has one — so on a perfectly healthy boot the
        // driver genuinely does not exist yet at this line.
        //
        // Hence the split: quiet HERE, because the deferral is expected, and
        // reconciled + REPORTED at `kernel:ready` by
        // {@link reconcileFederatedBindings}, after every `start()` has run.
        // That is the point at which "still no driver" is final and is a real
        // defect, and it is reported as one — this skip is no longer the last
        // word on a declared external object.
        if (isFederatedObject(obj)) {
          ctx.logger.debug(
            'No driver yet for federated object — deferring its remote-table binding to the kernel:ready reconciliation',
            { object: obj.name, datasource: this.ql.resolveEffectiveDatasource?.(obj.name) },
          );
          skipped++;
          continue;
        }
        ctx.logger.debug('No driver available for object, skipping schema sync', {
          object: obj.name,
        });
        skipped++;
        continue;
      }

      // Federated (external) objects (ADR-0015): their schema is owned by the
      // remote database, so DDL (syncSchema/initObjects) is forbidden and would
      // throw. Register read metadata (physical remote table + coercion maps)
      // without DDL so the query path resolves to the remote table, then skip
      // the DDL grouping below. `ObjectQL.syncSchemas` (the runtime sync) routes
      // by this SAME predicate and gives the same treatment, so the two passes
      // cannot disagree about which objects are DDL targets (#21777).
      if (isFederatedObject(obj)) {
        if (typeof driver.registerExternalObject === 'function') {
          try {
            await driver.registerExternalObject(obj);
            synced++;
          } catch (e: unknown) {
            ctx.logger.warn('Failed to register external object metadata', {
              object: obj.name,
              driver: driver.name,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        } else {
          ctx.logger.debug('Driver does not support registerExternalObject, skipping external object', {
            object: obj.name,
            driver: driver.name,
          });
          skipped++;
        }
        continue;
      }

      if (typeof driver.syncSchema !== 'function') {
        ctx.logger.debug('Driver does not support syncSchema, skipping', {
          object: obj.name,
          driver: driver.name,
        });
        skipped++;
        continue;
      }

      const tableName = StorageNameMapping.resolveTableName(obj);

      let group = driverGroups.get(driver);
      if (!group) {
        group = [];
        driverGroups.set(driver, group);
      }
      group.push({ obj, tableName });
    }

    // Process each driver group
    for (const [driver, entries] of driverGroups) {
      // Batch path: driver supports batch schema sync
      if (
        driver.supports?.batchSchemaSync &&
        typeof driver.syncSchemasBatch === 'function'
      ) {
        const batchPayload = entries.map((e) => ({
          object: e.tableName,
          schema: e.obj,
        }));
        try {
          await driver.syncSchemasBatch(batchPayload);
          synced += entries.length;
          ctx.logger.debug('Batch schema sync succeeded', {
            driver: driver.name,
            count: entries.length,
          });
        } catch (e: unknown) {
          ctx.logger.warn('Batch schema sync failed, falling back to sequential', {
            driver: driver.name,
            error: e instanceof Error ? e.message : String(e),
          });
          // Fallback: sequential sync for this driver's objects. The batch
          // warn above is correct at `warn` — it RECOVERS here; only a
          // sequential failure actually loses the DDL.
          for (const { obj, tableName } of entries) {
            try {
              await driver.syncSchema(tableName, obj);
              synced++;
            } catch (seqErr: unknown) {
              reportSyncFailure(obj, tableName, driver.name, seqErr);
            }
          }
        }
      } else {
        // Sequential path: no batch support
        for (const { obj, tableName } of entries) {
          try {
            await driver.syncSchema(tableName, obj);
            synced++;
          } catch (e: unknown) {
            reportSyncFailure(obj, tableName, driver.name, e);
          }
        }
      }
    }

    // #4632 — never claim "complete" over a pass that lost DDL. The old line
    // logged `info: Schema sync complete` after any number of failures, which
    // is the "looks normal" half of the accident: the only honest summary of a
    // pass with failures is an error.
    if (failed > 0) {
      ctx.logger.error(
        `Schema sync finished with ${failed} FAILED object(s) — those objects are registered and served but their storage was ` +
          `never created or altered; writes to them are not durable. See the per-object errors above for the driver failure and the fix.`,
        undefined,
        { synced, skipped, failed, total: allObjects.length },
      );
    } else if (synced > 0 || skipped > 0) {
      ctx.logger.info('Schema sync complete', { synced, skipped, total: allObjects.length });
    }
  }

  /**
   * The storage fixes for a deployment where nothing serves `sys_metadata`,
   * worded exactly as the CLI's boot-time `⚠ No storage:` line names them
   * (`packages/cli` `serve.ts`, `noStorageRemedies`): the operator meets the
   * same three remedies from either line, never two vocabularies. ⛔ Not a
   * place to add a fourth — a remedy the CLI line does not name belongs there
   * first.
   */
  private static readonly NO_STORAGE_REMEDIES = [
    'set OS_DATABASE_URL (e.g. file:./data/app.db, or a postgres:// or mysql:// URL)',
    "mount a storage driver in the stack's plugins (e.g. new DriverPlugin(driver) from @objectstack/runtime)",
    'run with --dev (an in-memory SQLite store, for development)',
  ] as const;

  /**
   * Is `sys_metadata` unreadable because NO STORAGE exists — no datasource
   * declared, no driver registered — rather than because a datasource that
   * exists failed to answer?
   *
   * Read off the engine's own routing, the facts `getDriver` throws on, and
   * never off the text of the error the read produced (that string is the
   * driver's and the engine's to reword):
   *
   * - a driver serves it ⇒ the read itself failed: a datasource problem;
   * - it is bound to a named datasource (explicit, mapping, lifecycle or
   *   package binding) whose driver is missing ⇒ that datasource is declared:
   *   a datasource problem;
   * - the datasource layer recorded a declared datasource it could not use
   *   (policy-refused, or a connect failure the operator waved through) ⇒ a
   *   datasource problem.
   *
   * Only when all three are empty does nothing at all stand behind the
   * object, which is the case the datasource remedy cannot help with.
   *
   * Asked ONLY once the read has already failed, so a healthy boot pays
   * nothing, and answered as of this moment of the boot — which is the same
   * moment, against the same registries, that the failed read was judged at.
   * A start() that registers a driver later does not undo the verdict the
   * line already states for this process.
   */
  private sysMetadataHasNoStorage(): boolean {
    const ql = this.ql;
    if (!ql) return false;
    if (ql.getDriverForObject('sys_metadata')) return false;
    if (ql.resolveEffectiveDatasource('sys_metadata') !== undefined) return false;
    return ql.listUnavailableDatasources().length === 0;
  }

  /**
   * Restore persisted metadata from the database (sys_metadata) on startup.
   *
   * Calls `protocol.loadMetaFromDb()` to bulk-load all active metadata
   * records (objects, views, apps, etc.) into the in-memory SchemaRegistry.
   * This closes the persistence loop so that user-created schemas survive
   * kernel cold starts and redeployments.
   *
   * Gracefully degrades when:
   * - The protocol service is unavailable (e.g., in-memory-only mode).
   * - `loadMetaFromDb` is not implemented by the protocol shim.
   * - The underlying driver/table does not exist yet (first-run scenario).
   *
   * [#5897, ADR-0110 D3] Degrading is not the same as being fine, and this
   * method used to be unable to say which one happened: `loadMetaFromDb`
   * answered an unreachable database and an empty one with the same
   * `loaded: 0`, so a boot that restored nothing because it could not read
   * `sys_metadata` logged `debug` "No persisted metadata found in database"
   * and the kernel reported ready. `storeUnavailable` now carries that
   * distinction, and the outage branch logs at `error` per AGENTS.md
   * "Degradation log levels" — runtime state silently disagreeing with
   * persisted state, while the system keeps looking healthy, is exactly the
   * class that rule reserves `error` for. Control flow is unchanged: boot
   * still continues in the degraded state (refusing to boot on an unreadable
   * overlay store would turn a transient outage into an outright outage),
   * it just no longer claims that state is health.
   *
   * The outage line names the fix that matches its cause
   * ({@link sysMetadataHasNoStorage}): the storage remedies when no datasource
   * is declared and no driver is registered, the datasource remedy when one is.
   */
  private async restoreMetadataFromDb(ctx: PluginContext): Promise<void> {
    // Phase 1: Resolve protocol service (separate from DB I/O for clearer diagnostics)
    let protocol: ProtocolWithDbRestore;
    try {
      const service = ctx.getService('protocol');
      if (!service || !hasLoadMetaFromDb(service)) {
        ctx.logger.debug('Protocol service does not support loadMetaFromDb, skipping DB restore');
        return;
      }
      protocol = service;
    } catch (e: unknown) {
      ctx.logger.debug('Protocol service unavailable, skipping DB restore', {
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    // Phase 2: DB hydration (loads into SchemaRegistry)
    try {
      const { loaded, errors, invalid = 0, storeUnavailable = false } = await protocol.loadMetaFromDb();

      if (storeUnavailable) {
        // #5897 — FIRST branch on purpose: "we could not read the store" out-
        // ranks any count taken from a read that did not happen. The line owes
        // the two things AGENTS.md requires of a durability `error` — the
        // concrete consequence, and the fix.
        //
        // The fix depends on WHY the read did not happen, and the engine knows:
        // a deployment that declared no datasource and registered no driver has
        // no connection or credentials to check, so the datasource remedy would
        // send the operator hunting for a store nobody configured. Level and
        // consequence are the same in both arms; only the cause and the fix
        // differ.
        const noStorage = this.sysMetadataHasNoStorage();
        ctx.logger.error(
          'sys_metadata could NOT be read at boot — ' +
            (noStorage
              ? 'no storage is configured: no datasource is declared and no driver is registered, so nothing serves sys_metadata. Persisted metadata was NOT restored, '
              : 'persisted metadata was NOT restored, ') +
            'and this kernel will keep reporting healthy. ' +
            'Every overlay object, view, app, permission and hook stored in the database is absent from the SchemaRegistry for the life of this process: ' +
            'registry lookups answer "not declared" rather than "unavailable", so unknown-column query guards, hooks and relationships silently degrade, ' +
            'and overlay objects get neither a synced table nor a metadata bridge. Authoring against this kernel writes on top of state it never loaded. ' +
            (noStorage
              ? `Fix: ${ObjectQLPlugin.NO_STORAGE_REMEDIES[0]}; ${ObjectQLPlugin.NO_STORAGE_REMEDIES[1]}; or ${ObjectQLPlugin.NO_STORAGE_REMEDIES[2]} — then restart. `
              : 'Fix: check the datasource behind sys_metadata — connection, credentials, and that the table exists — then restart. ') +
            'A store that merely has not been provisioned yet is NOT this case; that first-boot path stays quiet.',
          // `Logger.error(message, error?: Error, meta?)` — the error slot is
          // genuinely empty here: `loadMetaFromDb` swallows the driver error
          // and returns only the verdict, having already printed the driver's
          // own text at `warn` (`[Protocol] DB hydration skipped: …`). Passing
          // the counts in the declared meta slot rather than the error slot,
          // per the contract in `@objectstack/spec/contracts`.
          undefined,
          { loaded, errors, invalid },
        );
      } else if (loaded > 0 || errors > 0) {
        // `invalid` (#3903): rows registered despite failing the current spec
        // schema AFTER the stored conversion chain — each already warned with
        // `[metadata_spec_invalid]` and carries `_diagnostics` on read.
        ctx.logger.info('Metadata restored from database to SchemaRegistry', { loaded, errors, invalid });
      } else {
        // Reachable store, nothing in it — the ordinary empty/first-boot case.
        ctx.logger.debug('No persisted metadata found in database');
      }
    } catch (e: unknown) {
      // Non-fatal: first-run or in-memory driver may not have sys_metadata yet
      ctx.logger.debug('DB metadata restore failed (non-fatal)', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * [ADR-0048 N.3 — maintainer ruling letter A on #22307, record 6063176077]
   * The cold boot refuses a package-held position or permission-set name the
   * environment catalog already holds, as a hot install does.
   *
   * At a cold boot every package registers in the kernel's first phase, through
   * the package door, BEFORE `sys_metadata` hydrates into the registry's bare
   * slot ({@link restoreMetadataFromDb}, just above in `start()`), so the door
   * could not see the environment's names. The hydration write itself stays
   * unjudged; this judges each package's claim against what it wrote, with the
   * door's envelope (`SecurityCatalogNameConflictError`: `422`
   * `NAMESPACE_CONFLICT`, every conflict listed, both holders named).
   *
   * Placed right after hydration and before Phase 3's schema sync, which is
   * before `kernel:ready` and before every plugin that depends on the engine
   * starts. A registration made after this point meets the environment's items
   * at the registry's own package door or item seam, so between them every
   * package registration of the boot is judged. Called whether or not this
   * kernel hydrated: without hydration the bare slot holds only what a
   * package-less registration put there, judged the same way, and usually
   * nothing.
   *
   * The reading is the registry's, kept off the public surface
   * ({@link findEnvironmentHeldSecurityCatalogNames}: which items are the
   * environment's, and the built-in carve-out).
   *
   * @throws {SecurityCatalogNameConflictError} with `door: 'cold-boot'`, which
   *   fails `start()` and with it the boot.
   */
  private refuseEnvironmentHeldSecurityCatalogNames(): void {
    const registry = this.ql?.registry;
    if (!registry) return;
    const conflicts = findEnvironmentHeldSecurityCatalogNames(registry);
    if (conflicts.length === 0) return;
    throw new SecurityCatalogNameConflictError(conflicts, { door: 'cold-boot' });
  }

  /**
   * Bridge all SchemaRegistry objects to the metadata service.
   *
   * This ensures objects registered by plugins and loaded from sys_metadata
   * are visible to AI tools and other consumers that query IMetadataService.
   *
   * Runs after both restoreMetadataFromDb() and syncRegisteredSchemas() to
   * catch all objects in the SchemaRegistry regardless of their source.
   *
   * Registers with `{ notify: false }`: this bridge copies objects OUT of the
   * SchemaRegistry, so announcing would feed our own `subscribe('object')`
   * handler right back into the registry the definitions came from. That is
   * not merely redundant — the handler re-registers under
   * `_packageId ?? 'metadata-service'`, so every bridged object whose body
   * carries no `_packageId` would have its true package provenance
   * overwritten with 'metadata-service'. Nothing is stale either: the
   * registry is the source here, and it already holds what we just copied.
   *
   * One-shot: what the registry holds AFTER this pass reaches the service
   * through {@link followRuntimeObjectCopy} (a runtime-authored object saved or
   * deleted through an authoring door) and
   * {@link bridgeManifestObjectsToMetadataService} (a package registered late).
   */
  private async bridgeObjectsToMetadataService(ctx: PluginContext): Promise<void> {
    try {
      const metadataService = ctx.getService<IMetadataService>('metadata');
      if (!metadataService || typeof metadataService.register !== 'function') {
        ctx.logger.debug('Metadata service unavailable for bridging, skipping');
        return;
      }

      if (!this.ql?.registry) {
        ctx.logger.debug('SchemaRegistry unavailable for bridging, skipping');
        return;
      }

      const objects = this.ql.registry.getAllObjects();
      let bridged = 0;

      for (const obj of objects) {
        try {
          // Check if object is already in metadata service to avoid duplicates
          const existing = await metadataService.getObject(obj.name);
          if (!existing) {
            // Register object that exists in SchemaRegistry but not in metadata service
            await metadataService.register('object', obj.name, obj, { notify: false });
            bridged++;
          }
        } catch (e: unknown) {
          ctx.logger.debug('Failed to bridge object to metadata service', {
            object: obj.name,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (bridged > 0) {
        ctx.logger.info('Bridged objects from SchemaRegistry to metadata service', {
          count: bridged,
          total: objects.length
        });
      } else {
        ctx.logger.debug('No objects needed bridging (all already in metadata service)');
      }
    } catch (e: unknown) {
      ctx.logger.debug('Failed to bridge objects to metadata service', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * The boot half of {@link followRuntimeObjectCopy} on a kernel with an
   * `environmentId` that hydrates its own `sys_metadata`
   * (`hydrateMetadataFromDb`: `os dev`, `os serve`, `os start` and the cloud
   * single-environment runtime): copy each RUNTIME-AUTHORED object the
   * hydration put in the registry into the `metadata` service.
   *
   * The full {@link bridgeObjectsToMetadataService} stays off on this shape
   * (cross-project leakage, and the code packages' objects come from the
   * artifact). But nothing else gives a hydrated runtime object a copy, and no
   * mutation fires for it after boot: an object saved with `apiEnabled: false`
   * and then restarted was served by both exposure gates, which read an absent
   * copy as "no declaration". `hydrateMetadataFromDb` is set only on a kernel
   * whose registry is its own, so every object this pass copies is one this
   * environment authored. Same write as the follow: tenant-authored owner rows
   * only, through `registerInMemory` (no persistence, no announce).
   */
  private async bridgeRuntimeObjectsToMetadataService(ctx: PluginContext): Promise<void> {
    if (!this.ql?.registry) return;
    let metadataService: IMetadataService | undefined;
    try {
      metadataService = ctx.getService<IMetadataService>('metadata');
    } catch {
      return; // no metadata service on this kernel — there is no copy to keep
    }
    if (!metadataService) return;
    const failed: string[] = [];
    let copied = 0;
    for (const obj of this.ql.registry.getAllObjects()) {
      try {
        if (await this.mirrorRuntimeObject(metadataService, obj.name)) copied++;
      } catch {
        failed.push(obj.name);
      }
    }
    if (copied > 0) {
      ctx.logger.debug('Copied runtime-authored objects into the metadata service', { count: copied });
    }
    if (failed.length > 0) {
      ctx.logger.error(
        `[ObjectQLPlugin] the metadata service holds no copy of runtime-authored object(s) ${failed.map((n) => `'${n}'`).join(', ')}: `
        + 'the registry, the data door and REST serve them, but the MCP exposure gates read an absent copy as "no '
        + 'declaration" and serve them even when their API exposure is off, and MCP does not list them. Fix: restart '
        + 'this process; if it recurs, check that the metadata service accepts in-memory registration.',
        undefined,
        { objects: failed },
      );
    }
  }

  /**
   * Keep the metadata service's copy of a RUNTIME-AUTHORED object current after
   * boot, and take it out when the object is deleted.
   *
   * {@link bridgeObjectsToMetadataService} copies each registry object into the
   * `metadata` service once, at boot, and no authoring door writes to that
   * service. So on a kernel where the bridge ran, the service's answer for a
   * runtime-authored object was whatever the boot saw: an object created
   * afterwards had NO copy, a re-saved one kept its boot body, a deleted one
   * kept answering. The readers of `IMetadataService.getObject` / `listObjects`
   * inherit that, and one of them decides exposure: the MCP stdio door gates
   * every data verb on the copy's `enable.apiEnabled`, and an absent copy reads
   * as "no declaration" (its gate falls open by design, parity with the HTTP
   * gate), so an object whose API exposure was switched off after boot was
   * still served, and a deleted one was still listed and described.
   *
   * The landing point is the copy's producer, on the seam every authoring door
   * already funnels through (`onMetadataMutation`, which also replays on a
   * cluster peer once its registry has converged), not the readers: the HTTP
   * gate (`refuseUnexposedDataAction`), the AI tools and the MCP resources read
   * the same service. A copy is refreshed IN PLACE, never dropped on save: an
   * absent copy is the state that falls open.
   *
   * What it touches, and what it never does:
   *
   *  - Only a copy of a RUNTIME-AUTHORED object: the registry's owner row for
   *    the name is tenant-authored (`isTenantAuthored`), or the copy already in
   *    the service says it is. A code package's copy is the code layer the
   *    protocol restores baselines from; it is sealed against runtime edits and
   *    kept by {@link bridgeManifestObjectsToMetadataService}, so it is left
   *    exactly as it is.
   *  - A refresh goes through `registerInMemory` (synchronous, no persistence,
   *    no announce), so it has landed before the authoring call returns and
   *    never writes a row through a writable loader. A service without it gets
   *    the bridge's own `register(..., { notify: false })`.
   *  - The one removal the service has, `unregister`, also deletes through its
   *    writable `datasource:` loaders, so it is called only when the mutation
   *    says `deleted` (the stored row is already gone) AND the registry no
   *    longer serves the name AND the copy is the runtime-authored one.
   *    Afterwards the registry is asked again: a re-creation that landed while
   *    the removal was awaiting its loaders has its copy put back.
   *
   * Armed on every kernel shape. On a kernel with an `environmentId` (`os dev`
   * as `env_local`, the cloud single-environment runtime) the service is
   * sourced from the artifact and the boot bridge does not run, so a
   * runtime-authored object had no copy there at all: both exposure gates read
   * that absence as "no declaration" and served an object saved with
   * `apiEnabled: false`. The copy written here is the object THIS kernel's
   * authoring door just saved, so the cross-project leakage the full bridge is
   * gated against does not arise. Its boot half on that shape is
   * {@link bridgeRuntimeObjectsToMetadataService}.
   */
  private followRuntimeObjectCopy(ctx: PluginContext, evt: { name: string; state: string }): void {
    if (typeof evt?.name !== 'string' || evt.name === '') return;
    // An async function runs synchronously up to its first `await`: the
    // refresh of a served runtime object is done before this call returns.
    void this.settleRuntimeObjectCopy(ctx, evt.name, evt.state).catch((e: unknown) => {
      // Registry and service now disagree about an object while everything
      // looks normal, and the exposure an author set is what the disagreement
      // is about: an `error`, with the consequence and the way out.
      ctx.logger.error(
        `[ObjectQLPlugin] the metadata service's copy of object '${evt.name}' could not be brought up to date after it was `
        + 'saved or deleted: the registry, the data door and REST already serve the new definition, but readers of the '
        + 'metadata service (the MCP stdio door\'s exposure gate and object listing among them) keep the previous one, '
        + 'and nothing retries. Fix: restart this process (the boot bridge re-copies every object); if it recurs, '
        + 'check that the metadata service accepts in-memory registration.',
        e instanceof Error ? e : new Error(String(e)),
        { object: evt.name },
      );
    });
  }

  /** @see followRuntimeObjectCopy */
  private async settleRuntimeObjectCopy(ctx: PluginContext, name: string, state: string): Promise<void> {
    if (!this.ql?.registry) return;
    let metadataService: IMetadataService | undefined;
    try {
      metadataService = ctx.getService<IMetadataService>('metadata');
    } catch {
      return; // no metadata service on this kernel — there is no copy to keep
    }
    if (!metadataService) return;

    // The registry serves a runtime-authored object under this name: the copy
    // IS its current definition.
    if (await this.mirrorRuntimeObject(metadataService, name)) return;

    // It does not. Only a runtime-authored copy is this method's to change.
    const existing = await metadataService.getObject(name);
    if (!isTenantAuthored(existing)) return;
    const served = this.currentObjectCopyBody(name);
    if (served) {
      // The registry now serves something else under the name (a code
      // package's definition, once a runtime layer over it was removed): the
      // copy follows what is served.
      await this.putObjectCopy(metadataService, name, served);
      return;
    }
    if (state !== 'deleted') return;
    await metadataService.unregister('object', name, { notify: false });
    await this.mirrorRuntimeObject(metadataService, name);
  }

  /**
   * Put the registry's current definition of `name` into the service when the
   * registry's owner row for it is tenant-authored. `false` = it is not (or the
   * name is not registered), nothing was written.
   */
  private async mirrorRuntimeObject(metadataService: IMetadataService, name: string): Promise<boolean> {
    const owner = this.ql?.registry.getObjectOwner(name);
    if (!owner || !isTenantAuthored(owner.definition)) return false;
    const body = this.currentObjectCopyBody(name);
    if (!body) return false;
    await this.putObjectCopy(metadataService, name, body);
    return true;
  }

  /**
   * The definition the registry serves for `name`, shaped as the boot bridge
   * copies it: the merged object, tagged with its owner's package the way
   * `SchemaRegistry.getAllObjects` tags it.
   */
  private currentObjectCopyBody(name: string): ServiceObject | undefined {
    const registry = this.ql?.registry;
    const current = registry?.getObject(name);
    if (!registry || !current) return undefined;
    const packageId = registry.getObjectOwner(name)?.packageId;
    return { ...current, ...(packageId !== undefined ? { _packageId: packageId } : {}) } as ServiceObject;
  }

  private putObjectCopy(metadataService: IMetadataService, name: string, body: ServiceObject): void | Promise<void> {
    if (typeof metadataService.registerInMemory === 'function') {
      metadataService.registerInMemory('object', name, body);
      return;
    }
    return metadataService.register('object', name, body, { notify: false });
  }

  /**
   * [ADR-0130 D4] Register the objects of a stack's residual in the engine —
   * the half the metadata door cannot reach — so the data door serves what
   * `GET /meta/object` lists, under the same owner.
   *
   * Two classes are NOT registered, because registering them would refuse a
   * boot the residual rule accepts (both measured on a kernel):
   *
   *  - an object whose name another package already owns: the registry's
   *    ADR-0029 D3 refusal (`ObjectOwnershipConflictError`) would fail the
   *    boot, and the data door keeps serving that package's object;
   *  - an object whose field names a picklist none of the stack's package
   *    bodies declares: the boot's picklist audit at `kernel:ready` would fail
   *    it, because the residual's own picklists are registered as metadata
   *    only. Judged off the stack's bodies, never off the registry, which is
   *    still filling while this runs.
   *
   * Each such object is LISTED (the metadata door registered it) and NOT
   * served, and the boot says so once, naming each object and why. Any other
   * refusal the registry raises — a field with no valid `type` — propagates,
   * as a body's does.
   */
  private registerUnclaimedTopLevelObjects(
    ctx: PluginContext,
    residual: { ownerId: string | undefined; ownerVersion: string | undefined; objects: ServiceObject[] },
    bodies: unknown[],
  ): void {
    const ql = this.ql;
    if (!ql) return;
    const bodyPicklists = new Set<string>();
    for (const body of bodies) for (const name of collectManifestPicklistNames(body)) bodyPicklists.add(name);
    const unserved: string[] = [];
    for (const object of residual.objects) {
      const dangling = collectManifestPicklistReferences({ objects: [object] }, residual.ownerId)
        .find((ref) => !bodyPicklists.has(ref.picklist));
      if (dangling) {
        unserved.push(
          `'${object.name}' (field '${dangling.field}' names picklist '${dangling.picklist}', which no package body declares)`,
        );
        continue;
      }
      try {
        // The metadata door stamps the residual with `(ownerId, ownerVersion)`. The
        // registry's own stamp knows the id only and keeps a key already set, so
        // the version is stamped here first — on a shallow copy, leaving the
        // artifact's own object as the registry leaves it.
        const stamped = residual.ownerVersion === undefined
          ? object
          : applyProtection({ ...object } as any, { packageId: residual.ownerId, packageVersion: residual.ownerVersion }) as ServiceObject;
        ql.registry.registerObject(stamped, residual.ownerId, undefined, 'own');
      } catch (e) {
        if (!(e instanceof ObjectOwnershipConflictError)) throw e;
        unserved.push(`'${object.name}' (package '${e.existingPackageId}' already owns that name)`);
      }
    }
    if (unserved.length === 0) return;
    const owner = residual.ownerId ?? '<none>';
    ctx.logger.warn(
      `[ObjectQLPlugin] ${unserved.length} top-level object(s) of stack '${owner}' that no package body `
      + `declares are listed by the metadata door under that id but NOT served by the data door: `
      + `${unserved.join(', ')}. Declare each one inside the \`packages[]\` entry of the package that owns it, `
      + 'together with every picklist its fields name; to add fields to an object another package owns, '
      + 'use `objectExtensions` instead of declaring it again.',
    );
  }

  /**
   * [ADR-0015 D7, ADR-0130 D4] Register every residual item that is not an
   * object ({@link unclaimedTopLevelItems}) in the engine, the way
   * `registerApp`'s metadata collections register a package body's item of
   * that type: under the residual rule's id, with the stack's version stamped
   * beside it, after the judges that seam runs first. A residual item and a
   * body's then answer every reader of the registry alike, and refuse alike.
   *
   *  - A `view` container is filed under the object it binds to and expanded
   *    into its views (ADR-0017), once the one divergent-`name` judge
   *    (`viewContainerNameRefusal`) has passed it — the expansion and the
   *    object derivation are `@objectstack/spec`'s and `@objectstack/metadata`'s,
   *    the copies the body seam and the metadata door call.
   *  - A permission set whose body `packageId` disagrees with the residual's id
   *    is refused by the one owner-binding judge (ADR-0086 D3,
   *    `judgePermissionSetOwnerBinding`), in the body seam's own envelope
   *    (`permissionSetOwnerRegistrationRefusal`, `engine.ts`).
   *  - Any other `view` entry takes the body seam's two lines: one with no
   *    `name` is filed under its slot, and one that is not container-shaped
   *    (`isViewContainerShaped`) is refused 422 `INVALID_METADATA` by the
   *    seam's own refusal (`viewsEntryNotContainerRefusal`, `engine.ts`).
   *  - Every other item is one `registerItem` under its name.
   *
   * No body declares one of these names — that is what makes it residual — so
   * none of them shadows a body's entry. Each is stamped on a shallow copy,
   * leaving the artifact's own entry as it arrived. What judges a body's item
   * AFTER it registers judges the residual's too: the ownership-queue service
   * check and the bound-action target audit at `kernel:ready`.
   */
  private registerUnclaimedTopLevelItems(
    ctx: PluginContext,
    residual: { ownerId: string | undefined; ownerVersion: string | undefined; items: Array<{ type: string; item: Record<string, unknown> }> },
  ): void {
    const ql = this.ql;
    if (!ql) return;
    const { ownerId, ownerVersion } = residual;
    const stamp = (item: Record<string, unknown>): Record<string, unknown> => ownerVersion === undefined
      ? { ...item }
      : applyProtection({ ...item } as any, { packageId: ownerId, packageVersion: ownerVersion });
    // [#28534] The body seam's owner-stamp refusal, in its envelope and at its
    // place in the order (after the name and permission-set judges): a residual
    // item wearing a `_packageId` other than the residual's id kept it through
    // `stamp` and `registerItem` alike, which stamp only an unset key
    // ({@link collectionItemOwnerStampRefusal}, `engine.ts`).
    const refuseOwnerStamp = (item: Record<string, unknown>, type: string, name: string | undefined): void => {
      const refusal = collectionItemOwnerStampRefusal(item, type, name ?? '(unnamed)', ownerId);
      if (refusal) throw refusal;
    };
    for (const { type, item } of residual.items) {
      if (type === 'view' && isAggregatedViewContainer(item)) {
        const nameRefusal = viewContainerNameRefusal(item, 'manifest', ownerId);
        if (nameRefusal) throw nameRefusal;
        const object = deriveViewContainerObject(item);
        if (!object) continue;
        refuseOwnerStamp(item, type, object);
        const container = stamp({ ...item, name: object });
        ql.registry.registerItem('view', container, 'name' as any, ownerId);
        for (const view of expandViewContainer(object, container)) {
          for (const w of view._diagnostics?.warnings ?? []) {
            ctx.logger.warn(`View expansion warning for '${view.name}': ${w.message}`, { from: ownerId });
          }
          ql.registry.registerItem('view', stamp(view as unknown as Record<string, unknown>), 'name' as any, ownerId);
        }
        continue;
      }
      if (type === 'permission') {
        const refusal = permissionSetOwnerRegistrationRefusal(item, String(item.name), ownerId);
        if (refusal) throw refusal;
      }
      // The body seam's two `views:` lines, in its words: a non-container entry
      // with no `name` is filed under the slot the residual rule gave it, and an
      // entry that is not container-shaped (`viewKind`/`config`/flattened
      // overlay keys) is refused — `views:` carries containers only (#5320).
      const name = (item.name as string | undefined) || (type === 'view' ? deriveViewContainerObject(item) : undefined);
      refuseOwnerStamp(item, type, name);
      const toRegister = item.name === name ? item : { ...item, name };
      if (type === 'view' && !isViewContainerShaped(toRegister)) {
        throw viewsEntryNotContainerRefusal(name, 'manifest', ownerId);
      }
      ql.registry.registerItem(type, stamp(toRegister), 'name' as any, ownerId);
    }
  }

  /**
   * [ADR-0130 D5] Bridge each package of one artifact, in the SAME
   * dependency-topological order they registered in.
   *
   * Sequential, not `Promise.all`: {@link bridgeManifestObjectsToMetadataService}
   * reads an object out of the metadata service and decides whether the copy
   * sitting there is its own before overwriting it, so two packages
   * contributing to one object must not interleave that read-then-write. For an
   * artifact carrying one package this awaits exactly the one bridge the
   * pre-ADR-0130 path returned (D7).
   */
  private async bridgeArtifactObjectsToMetadataService(
    ctx: PluginContext,
    manifests: any[],
  ): Promise<void> {
    for (const manifest of manifests) {
      await this.bridgeManifestObjectsToMetadataService(ctx, manifest);
    }
  }

  /**
   * Bridge ONE manifest's objects into the metadata service — the
   * late-registration companion to {@link bridgeObjectsToMetadataService}.
   *
   * The one-shot startup bridge runs exactly once during `start()`, but
   * manifests keep arriving after that: marketplace install and ledger
   * rehydrate register through the `manifest` service on `kernel:ready` (or
   * an HTTP request), so their objects landed in the SchemaRegistry only and
   * every IMetadataService consumer (AI describe_object, Studio object
   * lists, `metadata.listObjects`) missed them. This bridges exactly the
   * objects the given manifest contributes, resolved through the registry so
   * both `objects` forms (array / name-keyed map) and extension merges come
   * out canonical, with `_packageId` stamped.
   *
   * The metadata service is resolved at CALL time, never captured at init:
   * when this plugin inits, MetadataPlugin may not have registered it yet.
   *
   * Existing same-name entries are left alone UNLESS they carry the same
   * `_packageId` — i.e. they are this bridge's own copy from a previous
   * version of the same package. That keeps a hot marketplace upgrade fresh
   * while never clobbering an authored / artifact-parsed definition.
   *
   * Registers `{ notify: false }` for the same reason as the startup bridge
   * (#3112 notify contract): these definitions come OUT of the
   * SchemaRegistry, so announcing would feed our own `subscribe('object')`
   * handler right back into the registry and overwrite the objects' true
   * package provenance with 'metadata-service'.
   *
   * Never throws — a bridge failure must not fail the install that
   * triggered it.
   */
  private async bridgeManifestObjectsToMetadataService(
    ctx: PluginContext,
    manifest: any,
  ): Promise<void> {
    if (!this.bridgeLateManifests) return;
    const packageId = manifest?.id || manifest?.name;
    if (!packageId || !this.ql?.registry) return;

    try {
      let metadataService: IMetadataService | undefined;
      try {
        metadataService = ctx.getService<IMetadataService>('metadata');
      } catch {
        return; // no metadata service on this kernel — nothing to bridge into
      }
      if (!metadataService || typeof metadataService.register !== 'function') return;

      const objects = this.ql.registry.getAllObjects(packageId);
      let bridged = 0;

      for (const obj of objects) {
        try {
          const existing = await metadataService.getObject(obj.name);
          const ownPreviousCopy =
            existing != null &&
            (obj as any)._packageId !== undefined &&
            (existing as any)._packageId === (obj as any)._packageId;
          if (!existing || ownPreviousCopy) {
            await metadataService.register('object', obj.name, obj, { notify: false });
            bridged++;
            // [#24182] Another package owns this object: the copy just written
            // carries this package's extension. Remembered, so its withdrawal
            // can put the owner's definition back.
            if ((obj as any)._packageId !== packageId) {
              let names = this.extendedObjectCopies.get(packageId);
              if (!names) this.extendedObjectCopies.set(packageId, names = new Set());
              names.add(obj.name);
            }
          }
        } catch (e: unknown) {
          ctx.logger.debug('Failed to bridge manifest object to metadata service', {
            package: packageId,
            object: obj.name,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (bridged > 0) {
        ctx.logger.info('Bridged late-registered manifest objects to metadata service', {
          package: packageId,
          count: bridged,
        });
      }
    } catch (e: unknown) {
      ctx.logger.debug('Failed to bridge manifest objects to metadata service', {
        package: packageId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * [#24472] One author-visible warning per same-name pair
   * (the registry's audit under {@link FIND_BOUND_ACTION_COLLISIONS}): the object, the action
   * and both packages. `warn`, by the degradation-level question — the object
   * visibly serves one declaration and nothing claimed persisted is lost.
   */
  private reportBoundActionCollisions(ctx: PluginContext, collisions: readonly BoundActionCollision[]): void {
    for (const collision of collisions) {
      ctx.logger.warn(`[ObjectQLPlugin] ${describeBoundActionCollision(collision)}`, { ...collision });
    }
  }

  /**
   * [#24182] The withdrawal counterpart of {@link bridgeManifestObjectsToMetadataService}
   * for a package that EXTENDS objects other packages own: put the registry's
   * current definition back into each owner's copy the package's bridge rewrote.
   *
   * When an extender is bridged, the objects it contributes to resolve to the
   * merged body stamped with the OWNER's id, and the bridge re-registers the
   * owner's copy with it (its own-previous-copy rule is keyed on that stamp).
   * Withdrawing the extender (`SchemaRegistry.uninstallPackage`) drops its
   * contribution from the registry, so the object listing and the data door
   * stop serving the extension's fields; but the copy keeps them, and
   * `GET /meta/object/NAME` reads the copy before the registry, so it kept
   * serving them until a restart. A withdrawal of the package's OWN copies
   * never touches these: they are stamped with another package's id.
   *
   * The names come from {@link extendedObjectCopies}, recorded when the bridge
   * wrote each copy. Only a copy the bridge itself would overwrite is written
   * (its stamp is the registry owner's), through the bridge's own verb, so an
   * authored copy stays as it is; a name the registry no longer serves is left
   * to the owner's own withdrawal. A package the registry still holds is not
   * withdrawn, and nothing is done.
   *
   * Never rejects: the withdrawal has already happened. A copy that could not
   * be written disagrees with what the registry serves while everything looks
   * normal, so that is said once at `error`, with the remedy.
   */
  private async restoreExtendedObjectCopies(ctx: PluginContext, packageId: string): Promise<void> {
    const names = this.extendedObjectCopies.get(packageId);
    const registry = this.ql?.registry;
    if (!names || !registry || registry.getPackage(packageId) !== undefined) return;
    this.extendedObjectCopies.delete(packageId);
    let metadataService: IMetadataService | undefined;
    try {
      metadataService = ctx.getService<IMetadataService>('metadata');
    } catch {
      return; // no metadata service on this kernel — there is no copy to restore
    }
    if (!metadataService || typeof metadataService.register !== 'function') return;

    const failed: string[] = [];
    for (const name of names) {
      try {
        const served = this.currentObjectCopyBody(name);
        const owner = (served as any)?._packageId;
        if (!served || owner === undefined) continue;
        const existing = await metadataService.getObject(name);
        if (existing == null || (existing as any)._packageId !== owner) continue;
        await metadataService.register('object', name, served, { notify: false });
      } catch {
        failed.push(name);
      }
    }
    if (failed.length > 0) {
      ctx.logger.error(
        `[ObjectQLPlugin] package '${packageId}' was withdrawn, but the metadata service's copy of the object(s) it extended `
        + `${failed.map((n) => `'${n}'`).join(', ')} could not be restored: the object listing and the data door already `
        + 'serve them without its fields, while GET /api/v1/meta/object/NAME keeps serving those fields until a restart. '
        + 'Fix: restart this process (the boot bridge re-copies every object); if it recurs, check that the metadata '
        + 'service accepts registration.',
        undefined,
        { package: packageId, objects: failed },
      );
    }
  }

  /**
   * True when a hook of this name is shipped by an installed CODE package —
   * i.e. the SchemaRegistry holds a composite (`<packageId>:<name>`) artifact
   * entry for it (registered by `registerApp` / the artifact loader). Those
   * hooks are bound by AppPlugin under `app:<appId>` with an explicit
   * bodyRunner + functions map, so every OTHER bind path must skip them or
   * they execute twice per event.
   *
   * Runtime-authored hooks — including ones published INTO a runtime-created
   * package (their sys_metadata row carries a `package_id`) — have no
   * artifact entry and are NOT matched. `getArtifactItem` is immune to
   * plain-key overlay shadows, so an authored customization of a packaged
   * hook classifies as artifact-shipped (the packaged version stays the one
   * that runs — same artifact-wins rule as ADR-0010 lock resolution).
   */
  private isArtifactShippedHook(name: unknown): boolean {
    if (typeof name !== 'string' || name.length === 0) return false;
    const registry: any = this.ql?.registry;
    if (!registry || typeof registry.getArtifactItem !== 'function') return false;
    return registry.getArtifactItem('hook', name) !== undefined;
  }

  /**
   * Once-per-process dedupe for stored-row conversion notices — resyncs are
   * event-driven, so a legacy row would otherwise re-warn on every publish.
   */
  private storedConversionWarned = new Set<string>();

  /**
   * Canonicalize a `sys_metadata` body read directly by this plugin (#3903).
   *
   * The authored-hook/-action re-syncs read the table themselves (they must —
   * env-scoped kernels surface these rows nowhere else), which makes them
   * stored-metadata rehydration seams: the full ADR-0087 chain replays here,
   * exactly like `protocol.loadMetaFromDb` / `getMetaItems`, so the engine's
   * runner and dispatch only ever see canonical shapes (e.g. a pre-17 action
   * row's `execute` reads as `target`).
   */
  private convertStoredRow(ctx: PluginContext, type: string, data: any): any {
    return applyConversionsToStoredItem(type, data, {
      onNotice: (n) => {
        const key = `${n.conversionId}|${type}|${String(data?.name ?? '')}`;
        if (this.storedConversionWarned.has(key)) return;
        this.storedConversionWarned.add(key);
        ctx.logger.warn(
          `[ObjectQLPlugin] stored ${type}/${String(data?.name ?? '<unnamed>')} carries a pre-protocol shape; ${n.message}`,
        );
      },
    });
  }

  /**
   * [ADR-0131 D6/D7] The ids of a legacy organization's `sys_metadata` rows,
   * read off the physical column through the table's driver — empty on a
   * migrated or fresh database. Throws when the read cannot answer.
   */
  private async legacyOrganizationRowIds(): Promise<ReadonlySet<string>> {
    const driver = (this.ql as { getDriverForObject?: (objectName: string) => unknown } | undefined)
      ?.getDriverForObject?.('sys_metadata');
    return new Set((await readLegacyOrganizationRows(driver)).keys());
  }

  /**
   * Read the ACTIVE runtime-authored hook rows from `sys_metadata`.
   *
   * Reads the table directly (like `protocol.getMetaItems` does) instead of
   * going through the metadata service, because env-scoped kernels have no
   * DatabaseLoader so the service never surfaces these rows.
   *
   * [ADR-0131 D6/D7] The environment's rows only: a legacy
   * organization-scoped hook row is not bound, and the v18 migration ceremony
   * carries it. The family declares no organization column, so the engine row
   * never carries one; on a database the ceremony has not migrated (which
   * `os serve` refuses, but an `os migrate` boot binds on) the legacy rows are
   * told apart by the physical column ({@link legacyOrganizationRowIds}). A
   * read of it that cannot answer is a failed read (`null`) like any other.
   *
   * Returns `null` when the read failed (e.g. no sys_metadata table on this
   * kernel) — callers must treat that as "couldn't read", NOT "zero hooks",
   * so a failed read never tears down live bindings.
   */
  private async readAuthoredHookRows(ctx: PluginContext): Promise<any[] | null> {
    if (!this.ql) return null;
    try {
      // No environment filter: per ADR-0005 (revised 2026-05) each
      // environment has its own physical DB, so this kernel's sys_metadata
      // only ever holds its own rows (saveMetaItem no longer stamps
      // environment_id). [ADR-0131 D6] The environment's rows only — see
      // the TSDoc.
      //
      // [#21911, ADR-0096] The explicit system opt-in: a boot / resync read
      // of the platform store with no caller behind it, never a principal-less
      // engine context.
      let rows: any[] = (await this.ql.find('sys_metadata', {
        where: { type: 'hook', state: 'active' },
        context: { isSystem: true },
      })) ?? [];
      if (rows.length === 0) {
        // Legacy plural rows — mirrors getMetaItems' singular/plural fallback.
        rows = (await this.ql.find('sys_metadata', {
          where: { type: 'hooks', state: 'active' },
          context: { isSystem: true },
        })) ?? [];
      }
      const legacy = await this.legacyOrganizationRowIds();
      const hooks: any[] = [];
      for (const row of rows) {
        // [ADR-0131 D6/D7] The environment's rows only — see the TSDoc.
        if (legacy.has(String(row.id))) continue;
        try {
          const data = this.convertStoredRow(
            ctx,
            'hook',
            typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
          );
          if (!data || typeof data !== 'object' || typeof data.name !== 'string') continue;
          // Surface the persisted package binding (parity with getMetaItems)
          // so provenance-aware consumers of the bound hook can read it.
          const recPkg = row.package_id ?? undefined;
          if (recPkg && data._packageId === undefined) data._packageId = recPkg;
          hooks.push(data);
        } catch {
          // Malformed row — skip it, keep the rest.
        }
      }
      return hooks;
    } catch (e: any) {
      ctx.logger.debug('[ObjectQLPlugin] authored-hook read from sys_metadata failed', {
        error: e?.message,
      });
      return null;
    }
  }

  /**
   * Serializes {@link resyncAuthoredHooks} runs. Mutation events, publishes,
   * and the boot sync can overlap; two interleaved read→bind sequences could
   * otherwise finish out of order and leave the OLDER snapshot bound.
   */
  private authoredHookResyncChain: Promise<void> = Promise.resolve();

  /**
   * (Re-)bind runtime-authored hooks into the execution pipeline (#2588).
   *
   * Serialized: overlapping calls queue behind each other so the last
   * completed bind always reflects the newest read.
   *
   * Sources, unioned by hook name (fresher DB row wins):
   *   1. `metadataService.loadMany('hook')` — the same view the boot bind in
   *      {@link loadMetadataFromService} consumed (covers FS-scanned hooks
   *      and, on platform kernels, the DatabaseLoader), re-read so the set
   *      reflects post-boot changes;
   *   2. active `sys_metadata` hook rows read directly — the ONLY source
   *      that surfaces Studio-authored hooks on env-scoped kernels.
   *
   * Package-artifact hooks are filtered out (bound by AppPlugin — see
   * {@link isArtifactShippedHook}). The result replaces the whole
   * `'metadata-service'` package set (`bindHooksToEngine` unregisters it
   * first), so this is idempotent: edited hooks re-bind with their new
   * definition and hooks whose rows were deleted tear down. Bodies execute
   * through the engine's default bodyRunner installed at boot by the
   * runtime's AppPlugin; when that runner is absent (e.g.
   * `OS_DISABLE_AUTHORED_HOOKS=1`) the binder skips bodies with a warning,
   * exactly as before.
   *
   * Best-effort: when BOTH sources are unavailable the resync is a no-op —
   * it never tears down live hooks on a failed read.
   */
  private resyncAuthoredHooks(ctx: PluginContext): Promise<void> {
    const run = this.authoredHookResyncChain.then(() => this.resyncAuthoredHooksNow(ctx));
    // The chain itself must never hold a rejection (it would poison every
    // later resync); callers still see the failure through `run`.
    this.authoredHookResyncChain = run.catch(() => undefined);
    return run;
  }

  private async resyncAuthoredHooksNow(ctx: PluginContext): Promise<void> {
    const ql: any = this.ql;
    if (!ql || typeof ql.bindHooks !== 'function') return;

    let serviceHooks: any[] | null = null;
    try {
      const metadataService = ctx.getService<IMetadataService>('metadata');
      if (metadataService && typeof metadataService.loadMany === 'function') {
        serviceHooks = (await metadataService.loadMany('hook')) ?? [];
      }
    } catch {
      serviceHooks = null; // no metadata service on this kernel
    }

    const authoredHooks = await this.readAuthoredHookRows(ctx);
    if (serviceHooks === null && authoredHooks === null) return; // nothing readable — keep current bindings

    const byName = new Map<string, any>();
    for (const h of serviceHooks ?? []) {
      if (h && typeof h.name === 'string') byName.set(h.name, h);
    }
    for (const h of authoredHooks ?? []) {
      if (h && typeof h.name === 'string') byName.set(h.name, h);
    }

    const bindable = Array.from(byName.values()).filter(
      (h) => !this.isArtifactShippedHook(h.name),
    );
    if (bindable.length === 0) {
      // bindHooksToEngine early-returns on an empty list BEFORE its
      // unregister step, so deleting the last authored hook would leave the
      // stale binding firing forever. Tear the package set down explicitly.
      if (typeof ql.unregisterHooksByPackage === 'function') {
        ql.unregisterHooksByPackage('metadata-service');
      }
    } else {
      ql.bindHooks(bindable, { packageId: 'metadata-service' });
    }
    ctx.logger.info('[ObjectQLPlugin] re-synced runtime-authored hooks', {
      bound: bindable.length,
      authoredRows: authoredHooks?.length ?? 0,
      artifactSkipped: byName.size - bindable.length,
    });
  }

  /**
   * True when an action of this name is shipped by an installed CODE
   * package — either as a standalone `action` artifact, or embedded in a
   * packaged object's `actions[]` array (the common `defineStack` shape).
   * Those handlers are registered by AppPlugin under `app:<appId>` with its
   * own runner, and `engine.registerAction` REPLACES by `<object>:<name>`
   * key — so re-registering here would clobber the packaged handler with a
   * metadata copy. Artifact-wins, same rule as {@link isArtifactShippedHook}.
   */
  private isArtifactShippedAction(action: any): boolean {
    const name = action?.name;
    if (typeof name !== 'string' || name.length === 0) return false;
    const registry: any = this.ql?.registry;
    if (!registry || typeof registry.getArtifactItem !== 'function') return false;
    if (registry.getArtifactItem('action', name) !== undefined) return true;
    const objectKey = standaloneActionOwnerKey(action);
    if (objectKey !== GLOBAL_ACTION_OBJECT_KEY) {
      const artifactObject: any = registry.getArtifactItem('object', objectKey);
      if (Array.isArray(artifactObject?.actions)
          && artifactObject.actions.some((a: any) => a?.name === name)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Read the ACTIVE runtime-authored action definitions from `sys_metadata`.
   *
   * Two authoring shapes both land here (and both are dead without this
   * re-sync — #2605 item 1):
   *   1. standalone `action` rows (the Studio's Action editor / PUT
   *      `/meta/action/:name`), plus legacy plural `actions` rows;
   *   2. actions EMBEDDED in authored `object` rows' `actions[]` — the
   *      object-editor path. The object schema itself is read live, but the
   *      handler still needs registering.
   *
   * Same read discipline as {@link readAuthoredHookRows}: direct table read
   * (env-scoped kernels surface authored rows nowhere else), the
   * environment's rows only (ADR-0131 D6), `null` on a failed read so callers
   * never tear down live registrations on an error.
   */
  private async readAuthoredActionRows(ctx: PluginContext): Promise<any[] | null> {
    if (!this.ql) return null;
    const parseRow = (row: any, type: string): any | undefined => {
      try {
        const data = this.convertStoredRow(
          ctx,
          type,
          typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
        );
        if (!data || typeof data !== 'object') return undefined;
        const recPkg = row.package_id ?? undefined;
        if (recPkg && data._packageId === undefined) data._packageId = recPkg;
        return data;
      } catch {
        return undefined; // malformed row — skip it, keep the rest
      }
    };
    try {
      // [#21911, ADR-0096] The explicit system opt-in on all three reads — see
      // readAuthoredHookRows.
      let rows: any[] = (await this.ql.find('sys_metadata', {
        where: { type: 'action', state: 'active' },
        context: { isSystem: true },
      })) ?? [];
      if (rows.length === 0) {
        rows = (await this.ql.find('sys_metadata', {
          where: { type: 'actions', state: 'active' },
          context: { isSystem: true },
        })) ?? [];
      }
      // [ADR-0131 D6/D7] The environment's rows only — see readAuthoredHookRows.
      const legacy = await this.legacyOrganizationRowIds();
      const actions: any[] = [];
      for (const row of rows) {
        if (legacy.has(String(row.id))) continue;
        const data = parseRow(row, 'action');
        if (data && typeof data.name === 'string') actions.push(data);
      }

      // Embedded shape: authored object rows may carry their own actions.
      // Converting the OBJECT row canonicalizes the embedded actions too —
      // the chain's action walker covers `objects[].actions[]`.
      const objectRows: any[] = (await this.ql.find('sys_metadata', {
        where: { type: 'object', state: 'active' },
        context: { isSystem: true },
      })) ?? [];
      for (const row of objectRows) {
        if (legacy.has(String(row.id))) continue; // [ADR-0131 D6/D7]
        const obj = parseRow(row, 'object');
        if (!obj || typeof obj.name !== 'string' || !Array.isArray(obj.actions)) continue;
        for (const action of obj.actions) {
          if (!action || typeof action !== 'object' || typeof action.name !== 'string') continue;
          const copy = { ...action };
          if (typeof copy.object !== 'string' && typeof copy.objectName !== 'string') {
            copy.object = obj.name;
          }
          if (obj._packageId && copy._packageId === undefined) copy._packageId = obj._packageId;
          actions.push(copy);
        }
      }
      return actions;
    } catch (e: any) {
      ctx.logger.debug('[ObjectQLPlugin] authored-action read from sys_metadata failed', {
        error: e?.message,
      });
      return null;
    }
  }

  /**
   * Serializes {@link resyncAuthoredActions} runs — same rationale as
   * {@link authoredHookResyncChain}: overlapping read→register sequences
   * must not finish out of order and leave the older snapshot registered.
   */
  private authoredActionResyncChain: Promise<void> = Promise.resolve();

  /**
   * [ADR-0110 D5] Fingerprint of the last governance report, so a
   * `metadata:reloaded` that changed nothing action-related does not repeat
   * the same warning verbatim.
   */
  private lastGovernanceFingerprint = '';

  /**
   * [ADR-0126 §8] Whether the packaged-action activation ledger is attached to
   * the engine yet. `false` is NOT a verdict — it means "not yet", and the
   * attempt is repeated on every `metadata:reloaded`, which is when an object
   * registered after `kernel:ready` becomes visible.
   */
  private actionActivationAttached = false;

  /**
   * [ADR-0126 §8 item 2] Attach the packaged-action activation ledger and load
   * it into the engine's projection.
   *
   * ## The two failure modes are DIFFERENT facts and are logged differently
   *
   * 1. **The ledger table cannot be read at all** (`probe()` throws). The store
   *    is NOT attached, so nothing can claim a durable flip: the write door
   *    refuses loudly (503) at the moment an administrator tries one, instead
   *    of reporting a switch that silently reverts on restart. That is a
   *    FUNCTIONAL degradation — a capability this deployment does not have —
   *    so it is `warn` per the AGENTS.md degradation-log-level rule. It is
   *    deliberately not `error`: `sys_metadata_activation` is registered by
   *    `PlatformObjectsPlugin` (#12359 ruling, 2026-08-26 — registration
   *    follows the declaration), which a lean or translations-only kernel is
   *    free not to compose, so an ObjectQL host without it is a legitimate
   *    deployment, and an `error` on every one of them is exactly the
   *    over-application that trains operators to skim `error`.
   *
   * 2. **The table reads, but the hydrate read fails.** Now rows may exist and
   *    the projection is empty, so every action is ARMED — including any an
   *    administrator switched off. Persisted state and runtime state disagree
   *    while everything looks healthy, which is the durability arm of the same
   *    rule: `error`, naming the consequence. The flow twin logs its identical
   *    case identically.
   *
   * Never fatal either way: a boot that cannot read the ledger still serves,
   * and says what it lost.
   */
  private async hydrateActionActivations(ctx: PluginContext): Promise<void> {
    const ql: any = this.ql;
    if (!ql || typeof ql.hydrateActionActivations !== 'function') return;
    // Idempotent: once a ledger is attached, the projection IS the ledger and a
    // later reload has nothing to redo.
    if (this.actionActivationAttached) return;

    // ── Is the ledger even part of this composition? ────────────────────────
    // Asked of the object registry BEFORE any read, for two reasons:
    //
    //   1. `find` on a table that does not exist is a driver FAULT, and the
    //      engine logs it at `error` on its way out. A composition that simply
    //      does not register `sys_metadata_activation` (no
    //      `PlatformObjectsPlugin` — the object's single registrant since the
    //      #12359 ruling) would print that error on every single boot, for a
    //      capability it never asked for. An unregistered object is a fact this
    //      can read without touching the datasource at all.
    //   2. It splits the two cases the log levels below distinguish: absent
    //      from this composition (ordinary, `debug`) versus registered but
    //      unreadable (a real misconfiguration, `warn`).
    //
    // ⚠️ The absence is NOT recorded as a verdict (AGENTS.md "startup registry
    // reads"): nothing is cached, and `metadata:reloaded` calls this again, so
    // a ledger object registered later in the process is picked up then rather
    // than being permanently written off by a read taken too early.
    let registered = false;
    try {
      registered = Boolean(ql.registry?.getObject?.(ACTION_ACTIVATION_TABLE));
    } catch {
      registered = false; // a registry that cannot answer is not an answer
    }
    if (!registered) {
      ctx.logger.debug?.(
        `[ObjectQLPlugin] no ${ACTION_ACTIVATION_TABLE} object in this composition — packaged-action enable/disable ` +
          'is not available here (ADR-0126 §8). Nothing was read; this is re-checked on the next metadata reload.',
      );
      return;
    }

    const store = new ObjectStoreActionActivationStore(ql as ActionActivationStoreEngine);
    try {
      await store.probe();
      ql.setActionActivationStore(store);
      this.actionActivationAttached = true;
    } catch (e: unknown) {
      ctx.logger.warn(
        `[ObjectQLPlugin] ${ACTION_ACTIVATION_TABLE} is registered but could not be read — packaged-ACTION ` +
          'enable/disable is UNAVAILABLE on this deployment (ADR-0126 §8): no action can be switched off, and an ' +
          'attempt to flip one is refused rather than kept in process. Check that schema sync ran for its datasource; ' +
          "the driver's own failure is in this record's meta.",
        { error: e instanceof Error ? e.message : String(e) },
      );
      return;
    }

    try {
      const off = await ql.hydrateActionActivations();
      if (Array.isArray(off) && off.length > 0) {
        ctx.logger.info(
          `[ObjectQLPlugin] Activation ledger: ${off.length} packaged action(s) are switched off for this ` +
            `installation and will be refused at dispatch — ${off.map((n: string) => `'${n}'`).join(', ')}.`,
        );
      }
    } catch (e: unknown) {
      ctx.logger.error(
        '[ObjectQLPlugin] the packaged-action activation ledger could not be read — every declared action is ARMED, ' +
          'including any an administrator switched off, and dispatch will look completely normal. The ledger read ' +
          "failure is in this record's meta.",
        undefined,
        { error: e instanceof Error ? e.message : String(e) },
      );
    }
  }

  /**
   * [#15252] The metadata plane {@link runGovernanceInventory} audits against,
   * resolved the way a REQUEST resolves it.
   *
   * The audit used to take it from `ctx.getService('metadata')` alone. That
   * accessor reads two synchronous maps — the kernel's own `services` and
   * `PluginLoader.getServiceInstance` (which reads `serviceInstances`) — and
   * NEITHER of them holds a scoped instance: `PluginLoader` mints those into
   * `scopedServices`, keyed by scope id. So against a composition that
   * registers `metadata` with `ServiceLifecycle.SCOPED` the call threw
   * `Service 'metadata' is async - use await` BEFORE any read method ran, the
   * wiring below swallowed the throw into "no metadata plane at all", and the
   * audit reported that scope's declarations as absent — silently, because an
   * empty declaration set is indistinguishable from a plane holding nothing.
   *
   * The router never had that problem: `HttpDispatcher.resolveService` asks
   * `defaultKernel.getServiceAsync(name, scopeId)` FIRST, with the request's
   * environment id, and only then falls back to the synchronous accessors. So
   * this mirrors that order, with the one scope id a boot-time caller can
   * legitimately name — `environmentId`, which declares that this kernel
   * serves ONE environment. `ctx.getServiceScoped` and the dispatcher's
   * `getServiceAsync(name, scopeId)` both land on `PluginLoader.getService`,
   * so for a scoped registration this resolves the SAME cached instance the
   * router resolves through. That identity is the point: an audit reading a
   * different instance than the router dispatches from cannot say anything
   * true about what the router will refuse.
   *
   * Unchanged for every shipped composition, and checked rather than assumed:
   * `ObjectKernel.registerService` writes the kernel map AND
   * `PluginLoader.serviceInstances`, so a statically registered plane
   * (`packages/metadata/src/plugin.ts`) comes back from the scoped attempt as
   * the very same object the synchronous lookup returns. The fallback covers
   * every other shape — a host with no scoped accessor at all
   * (`KernelBase`/`LiteKernel` throws "not supported"), a test double whose
   * context implements `getService` only, and a kernel declaring no
   * `environmentId`.
   *
   * ⚠️ The boundary that REMAINS, stated so it is not re-discovered as a bug:
   * a kernel serving several environments at once has no single scope for a
   * boot-time audit to name, so there is nothing to ask for and the
   * synchronous lookup stands. Auditing per environment is a different
   * inventory with a different lifecycle, not a scope id this method can
   * invent.
   */
  private async resolveGovernanceMetadataService(
    ctx: PluginContext,
  ): Promise<IMetadataService | undefined> {
    const scopeId = this.environmentId;
    if (scopeId && typeof ctx.getServiceScoped === 'function') {
      try {
        const scoped = await ctx.getServiceScoped<IMetadataService>('metadata', scopeId);
        if (scoped != null) return scoped;
      } catch {
        // Not resolvable under a scope on this host — nothing registered under
        // the name, or a host with no scoped accessor. Fall through to the
        // synchronous lookup, which is what every non-scoped shape answers
        // from; a plane that is genuinely absent ends up `undefined` either
        // way and the audit degrades exactly as it did before.
      }
    }
    try {
      return ctx.getService<IMetadataService>('metadata');
    } catch {
      return undefined;
    }
  }

  /**
   * [ADR-0110 D5] Audit the engine's action-handler registry against the
   * declarations it can dispatch for, and warn about the orphans on both
   * sides. Runs at `kernel:ready` (after {@link resyncAuthoredActions}, so
   * the registry is final for the boot) and again on `metadata:reloaded`.
   *
   * This is the checklist that makes D3's hard refusal a migration step
   * instead of a mystery — but only while it reads what the router reads, so
   * every source `resolveRouteActionDeclaration` resolves through is wired in
   * below, the registry rung included. A handler listed here is one no source
   * declares; the message says so in those terms and stops short of claiming
   * a dispatch this audit never performed. It lives on the ENGINE plugin
   * deliberately — AppPlugin hosted it first and is registered conditionally,
   * so the platform's own `os dev` path never printed it.
   *
   * Warn-only, exception-proof (the runner swallows its own failures): a
   * diagnostic must never be the reason a kernel fails to boot.
   */
  private async runGovernanceInventory(ctx: PluginContext): Promise<void> {
    const ql: any = this.ql;
    if (!ql || typeof ql.listRegisteredActions !== 'function') return;
    let loadStandaloneActions: (() => Promise<any[]>) | undefined;
    let loadStandaloneActionsKeyed: (() => Promise<Array<{ name: string; data: any }>>) | undefined;
    let lookupMetadataAction: ((actionName: string) => unknown) | undefined;
    try {
      // [#15252] Resolved the way a request resolves it — scoped first, with
      // this kernel's declared environment id. See the method's docblock.
      const meta = await this.resolveGovernanceMetadataService(ctx);
      const loadMany = meta?.loadMany;
      if (meta && typeof loadMany === 'function') {
        loadStandaloneActions = () => loadMany.call(meta, 'action');
      }
      // [commit a56baa2bd] The KEYED plural read, preferred over `loadMany` — see
      // `collectEngineActionDeclarations`. A plane that predates it (or a test
      // double) simply does not offer it and the unkeyed read above stands.
      const loadManyKeyed = meta?.loadManyKeyed;
      if (meta && typeof loadManyKeyed === 'function') {
        loadStandaloneActionsKeyed = () => loadManyKeyed.call(meta, 'action');
      }
      // [commit a56baa2bd] The router's THIRD rung, injected the same way its second one
      // is. `resolveRouteActionDeclaration` prefers `loadDiagnosed` and falls
      // back to `load`; this mirrors that branch and unwraps, so the audit
      // receives a declaration-or-nothing exactly like `lookupRegistryAction`.
      // A degraded read answers `data: null` here and therefore CLEARS
      // nothing — the audit's conservative direction, unchanged.
      const loadDiagnosed = meta?.loadDiagnosed;
      const load = meta?.load;
      if (meta && typeof loadDiagnosed === 'function') {
        lookupMetadataAction = async (actionName: string) =>
          (await loadDiagnosed.call(meta, 'action', actionName))?.data;
      } else if (meta && typeof load === 'function') {
        lookupMetadataAction = (actionName: string) => load.call(meta, 'action', actionName);
      }
    } catch { /* no metadata service — registry objects still audit */ }
    // [#9285] BOTH swallows are gone. The old spelling —
    // `(() => { try { return ql.registry?.getAllObjects?.() ?? []; } catch { return []; } })()`
    // — carried two independent inventions on one expression (`?.()` for a
    // registry that does not implement the method, `catch` for one that
    // throws), and handed the result to an audit that then ran against an
    // invented empty object set. That is worse than silence: with no objects
    // every handler declared ON an object reconciles as an "undeclared handler
    // … REFUSED at dispatch", so an unreadable registry produced a page of
    // false accusations against a healthy deployment. This inventory is
    // warn-only and exception-proof BY CONTRACT (above: a diagnostic must never
    // be the reason a kernel fails to boot), so it does not propagate — it
    // reports once and skips, leaving `lastGovernanceFingerprint` untouched so
    // the next successful run reports in full rather than being suppressed as
    // "unchanged". `warn`, not `error`, per the AGENTS.md degradation-log-level
    // rule: an audit that did not run is a FUNCTIONAL degradation — nothing
    // here claims to have been persisted.
    let objects: ServiceObject[];
    try {
      objects = this.readRegisteredObjects('runGovernanceInventory');
    } catch (e: unknown) {
      ctx.logger.warn(
        '[action-governance] inventory SKIPPED — the object registry could not be read, so this run audited nothing: ' +
          'registered handlers with no declaration (REFUSED at dispatch, ADR-0110 D3) and declared actions with no ' +
          'handler are neither found nor named. Deliberately NOT audited against an empty object set — that would ' +
          'report every object-declared action as an undeclared handler. The audit re-runs at the next boot or on the ' +
          'next `metadata:reloaded`; fix the registry error named here.',
        { error: e instanceof Error ? e.message : String(e) },
      );
      return;
    }
    this.lastGovernanceFingerprint = await runActionGovernanceInventory({
      registered: ql.listRegisteredActions(),
      objects,
      loadStandaloneActions,
      loadStandaloneActionsKeyed,
      lookupMetadataAction,
      // The router's SECOND rung, handed over from here because objectql
      // cannot import the router (runtime -> objectql, never the reverse).
      // `resolveRouteActionDeclaration` resolves a declaration through
      // object-embedded `actions[]` -> THIS lookup -> the metadata plane, and
      // the inventory had the first and the last: every object-less
      // `defineAction` that lives in the registry alone (the in-process boot,
      // where the plane holds no `action` rows) was reported as a handler
      // with no declaration while the router was dispatching it. This call
      // site is the only place with `ql` in hand, so it is where the rung
      // joins the audit; the ownership test that judges the answer lives with
      // the rest of the addressing vocabulary in `action-governance.ts`.
      lookupRegistryAction: (actionName: string) => ql.registry?.getItem?.('action', actionName),
      logger: ctx.logger,
      lastFingerprint: this.lastGovernanceFingerprint,
    });
  }

  /**
   * (Re-)register runtime-authored actions on the engine (#2605 item 1 —
   * the action-path parallel of {@link resyncAuthoredHooks}).
   *
   * Both action dispatch surfaces (`POST /api/v1/actions/:object/:action`
   * and the MCP `run_action` bridge) resolve handlers through
   * `engine.executeAction`, whose map was only ever populated from the app
   * bundle at boot — a published `action` row was stored + listed but never
   * executable, before OR after a restart.
   *
   * Sources, unioned by `<object>:<name>` (fresher DB row wins):
   *   1. `metadataService.loadMany('action')` — FS-scanned action items;
   *   2. authored `sys_metadata` rows (standalone AND object-embedded) via
   *      {@link readAuthoredActionRows}.
   *
   * Package-artifact actions are filtered out (AppPlugin registers those
   * under `app:<appId>`; registerAction replaces by key, so re-registering
   * would clobber them). Handlers are built through the engine's default
   * action runner installed at boot by the runtime's AppPlugin; when that
   * runner is absent (e.g. `OS_DISABLE_AUTHORED_ACTIONS=1`, or a bare
   * engine without the runtime) bodies are skipped with a warning. Bodyless
   * actions (target-bound script / flow / url) register nothing here —
   * their dispatch is either code (registered by the app) or the flow
   * runner, not a metadata body.
   *
   * Idempotent: the whole `'metadata-service'` action set is torn down and
   * re-registered, so edits re-register and deleted rows unregister.
   * Best-effort: when BOTH sources are unreadable the resync is a no-op.
   */
  private resyncAuthoredActions(ctx: PluginContext): Promise<void> {
    const run = this.authoredActionResyncChain.then(() => this.resyncAuthoredActionsNow(ctx));
    // The chain must never hold a rejection (it would poison every later
    // resync); callers still see the failure through `run`.
    this.authoredActionResyncChain = run.catch(() => undefined);
    return run;
  }

  private async resyncAuthoredActionsNow(ctx: PluginContext): Promise<void> {
    const ql: any = this.ql;
    if (!ql
        || typeof ql.registerAction !== 'function'
        || typeof ql.removeActionsByPackage !== 'function') {
      return;
    }

    let serviceActions: any[] | null = null;
    try {
      const metadataService = ctx.getService<IMetadataService>('metadata');
      if (metadataService && typeof metadataService.loadMany === 'function') {
        serviceActions = (await metadataService.loadMany('action')) ?? [];
      }
    } catch {
      serviceActions = null; // no metadata service on this kernel
    }

    const authoredActions = await this.readAuthoredActionRows(ctx);
    if (serviceActions === null && authoredActions === null) return; // nothing readable — keep current registrations

    const byKey = new Map<string, any>();
    for (const a of serviceActions ?? []) {
      if (a && typeof a.name === 'string') byKey.set(`${standaloneActionOwnerKey(a)}:${a.name}`, a);
    }
    for (const a of authoredActions ?? []) {
      if (a && typeof a.name === 'string') byKey.set(`${standaloneActionOwnerKey(a)}:${a.name}`, a);
    }

    const bindable = Array.from(byKey.values()).filter(
      (a) => !this.isArtifactShippedAction(a),
    );

    // Full replace: tear down the package set, then re-register survivors —
    // deleting the last authored action must unregister it.
    ql.removeActionsByPackage('metadata-service');

    // [#4251] The public accessor — this read used to reach the private
    // `_defaultActionRunner` field directly. Probed because `ql` can be a
    // test double that predates the accessor.
    const runner: any = typeof ql.getDefaultActionRunner === 'function'
      ? ql.getDefaultActionRunner()
      : undefined;
    let registered = 0;
    let skippedNoHandler = 0;
    for (const action of bindable) {
      if (typeof runner !== 'function') {
        skippedNoHandler++;
        continue;
      }
      let handler: any;
      try {
        handler = runner(action);
      } catch (e: any) {
        ctx.logger.warn('[ObjectQLPlugin] default action runner rejected an authored action', {
          action: action.name,
          error: e?.message,
        });
        continue;
      }
      if (typeof handler !== 'function') {
        skippedNoHandler++; // no body (target/flow/url action) or invalid body shape
        continue;
      }
      ql.registerAction(standaloneActionOwnerKey(action), action.name, handler, 'metadata-service');
      registered++;
    }
    if (typeof runner !== 'function' && bindable.length > 0) {
      ctx.logger.warn(
        '[ObjectQLPlugin] authored actions present but no default action runner is installed '
        + '— their bodies will not execute (is the runtime AppPlugin booted, '
        + 'or is OS_DISABLE_AUTHORED_ACTIONS=1 set?)',
        { actions: bindable.slice(0, 5).map((a: any) => a.name) },
      );
    }
    ctx.logger.info('[ObjectQLPlugin] re-synced runtime-authored actions', {
      registered,
      authoredRows: authoredActions?.length ?? 0,
      artifactSkipped: byKey.size - bindable.length,
      skippedNoHandler,
    });
  }

  /**
   * Load metadata from external metadata service into ObjectQL registry
   * This enables ObjectQL to use file-based or remote metadata
   */
  private async loadMetadataFromService(metadataService: any, ctx: PluginContext) {
    ctx.logger.info('Syncing metadata from external service into ObjectQL registry...');
    
    // Metadata types to sync (ADR-0020: no `workflow` type — record state
    // machines are a `state_machine` validation rule on the object;
    // ADR-0088: no `function` kind — QL functions come from
    // `defineStack({ functions })` / plugin contributions, never metadata rows)
    const metadataTypes = ['object', 'view', 'app', 'flow', 'hook'];
    let totalLoaded = 0;
    
    for (const type of metadataTypes) {
        try {
            // Check if service has loadMany method
            if (typeof metadataService.loadMany === 'function') {
                const items = await metadataService.loadMany(type);

                if (items && items.length > 0) {
                    items.forEach((item: any) => {
                        // Determine key field (usually 'name' or 'id')
                        const keyField = item.id ? 'id' : 'name';
                        
                        // For objects, use the ownership-aware registration
                        if (type === 'object' && this.ql) {
                            // Objects are registered differently (ownership model)
                            // Skip for now - handled by app registration
                            return;
                        }
                        
                        // Register other types in the registry. Pass through
                        // the item's own source package id (stamped by the
                        // metadata plugin's artifact loader) so registerItem's
                        // applyProtection re-stamps _packageId/_provenance and
                        // GET /meta consumers can tell package-shipped items
                        // from user-authored ones. Items without _packageId
                        // (FS project files, runtime-authored rows) must stay
                        // unstamped — a synthetic id like 'metadata-service'
                        // would flip isArtifactBacked() and the two-tier write
                        // authorization for genuinely runtime-authored items.
                        if (this.ql?.registry?.registerItem) {
                            this.ql.registry.registerItem(type, item, keyField, item._packageId);
                        }
                    });

                    // Hooks need to be wired into the execution pipeline,
                    // not just stored in the registry. Funnel through the
                    // canonical binder so declarative semantics (condition,
                    // retry, timeout, async, onError, priority, packageId)
                    // are honoured uniformly with the AppPlugin path.
                    //
                    // Package-artifact hooks are EXCLUDED: AppPlugin already
                    // binds the same hooks (from the bundle) under
                    // `app:<appId>` WITH an explicit bodyRunner + functions
                    // map. Binding them here too used to be harmless only
                    // because this path had no bodyRunner (bodies were
                    // silently skipped); now that the engine carries a
                    // default runner (#2588) a second bind would execute
                    // every artifact hook twice per event.
                    if (type === 'hook' && this.ql && typeof (this.ql as any).bindHooks === 'function') {
                        const bindable = items.filter((h: any) => !this.isArtifactShippedHook(h?.name));
                        (this.ql as any).bindHooks(bindable, {
                            packageId: 'metadata-service',
                        });
                    }

                    totalLoaded += items.length;
                    ctx.logger.info(`Synced ${items.length} ${type}(s) from metadata service`);
                }
            }
        } catch (e: any) {
            // Type might not exist in metadata service - that's ok
            ctx.logger.debug(`No ${type} metadata found or error loading`, { 
                error: e.message 
            });
        }
    }
    
    if (totalLoaded > 0) {
        ctx.logger.info(`Metadata sync complete: ${totalLoaded} items loaded into ObjectQL registry`);
    }
  }
}
