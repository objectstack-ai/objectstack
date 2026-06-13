// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ServiceObject, ObjectSchema, ObjectOwnership } from '@objectstack/spec/data';
import { readEnvWithDeprecation } from '@objectstack/types';
import { ObjectStackManifest, ManifestSchema, InstalledPackage, InstalledPackageSchema } from '@objectstack/spec/kernel';
import { AppSchema } from '@objectstack/spec/ui';
import { applyProtection } from '@objectstack/spec/shared';

/**
 * Reserved namespaces that do not get FQN prefix applied.
 * Objects in these namespaces keep their short names (e.g., "user" — short name IS the canonical key).
 */
export const RESERVED_NAMESPACES = new Set(['base', 'system']);

/**
 * Default priorities for ownership types.
 */
export const DEFAULT_OWNER_PRIORITY = 100;
export const DEFAULT_EXTENDER_PRIORITY = 200;

/**
 * Contributor Record
 * Tracks how a package contributes to an object (own or extend).
 */
export interface ObjectContributor {
  packageId: string;
  namespace: string;
  ownership: ObjectOwnership;
  priority: number;
  definition: ServiceObject;
}

/**
 * Compute canonical registry key for an object.
 *
 * Under the current naming convention, object names are canonical identifiers
 * and are used as-is (no namespace__ prefix). The namespace parameter is
 * retained for backward compatibility but no longer affects the returned key.
 *
 * @param namespace - The package namespace (unused, kept for API compatibility)
 * @param shortName - The object's name (already the canonical identifier)
 * @returns The object name unchanged
 *
 * @example
 * computeFQN('crm', 'account')  // => 'account'
 * computeFQN(undefined, 'task') // => 'task'
 */
export function computeFQN(_namespace: string | undefined, shortName: string): string {
  return shortName;
}

/**
 * Parse FQN back to namespace and short name.
 * 
 * @param fqn - Object name (e.g., "account" or legacy "crm__account" for backward compat)
 * @returns { namespace, shortName } - namespace is undefined for unprefixed names
 */
export function parseFQN(fqn: string): { namespace: string | undefined; shortName: string } {
  const idx = fqn.indexOf('__');
  if (idx === -1) {
    return { namespace: undefined, shortName: fqn };
  }
  return {
    namespace: fqn.slice(0, idx),
    shortName: fqn.slice(idx + 2),
  };
}

/**
 * Deep merge two ServiceObject definitions.
 * Fields are merged additively. Other props: later value wins.
 */
function mergeObjectDefinitions(base: ServiceObject, extension: Partial<ServiceObject>): ServiceObject {
  const merged = { ...base };

  // Merge fields additively
  if (extension.fields) {
    merged.fields = { ...base.fields, ...extension.fields };
  }

  // Merge validations additively
  if (extension.validations) {
    merged.validations = [...(base.validations || []), ...extension.validations];
  }

  // Merge indexes additively
  if (extension.indexes) {
    merged.indexes = [...(base.indexes || []), ...extension.indexes];
  }

  // Override scalar props (last writer wins)
  if (extension.label !== undefined) merged.label = extension.label;
  if (extension.pluralLabel !== undefined) merged.pluralLabel = extension.pluralLabel;
  if (extension.description !== undefined) merged.description = extension.description;

  return merged;
}

/**
 * Global Schema Registry
 * Unified storage for all metadata types (Objects, Apps, Flows, Layouts, etc.)
 * 
 * ## Namespace & Ownership Model
 * 
 * Objects use a namespace-based FQN system:
 * - `namespace`: Short identifier from package manifest (e.g., "crm", "todo")
 * - `name`: canonical object name (e.g., "account", "sys_user")
 * - Reserved namespaces (`base`, `system`) don't get prefixed
 * 
 * Ownership modes:
 * - `own`: One package owns the object (creates the table, defines base schema)
 * - `extend`: Multiple packages can extend an object (add fields, merge by priority)
 * 
 * ## Package vs App Distinction
 * - **Package**: The unit of installation, stored under type 'package'.
 *   Each InstalledPackage wraps a ManifestSchema with lifecycle state.
 * - **App**: A UI navigation shell (AppSchema), registered under type 'apps'.
 *   Apps are extracted from packages during registration.
 * - A package may contain 0, 1, or many apps.
 */
export type RegistryLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Construction options for {@link SchemaRegistry}.
 */
export interface SchemaRegistryOptions {
  /**
   * Whether the host kernel runs in multi-tenant mode. The `organization_id`
   * column itself is auto-injected regardless of this flag (lookup →
   * sys_organization, on every registered object that doesn't already declare
   * it, isn't `managedBy` an external subsystem, and hasn't opted out via
   * `systemFields`/`tenancy.enabled:false`). When `true` the injected column
   * is additionally INDEXED — single-tenant stacks skip the index since
   * nothing ever filters by organization.
   *
   * Sourced from the `OS_MULTI_TENANT` env var when not explicitly set —
   * matches how the SecurityPlugin and CLI startup banner pick the mode.
   * Default is `false` (single-tenant) so local `dev`/`start` runs seed
   * demo data inline at boot; set `OS_MULTI_TENANT=true` for cloud /
   * production multi-org deployments. Pass an explicit boolean to override
   * (useful in tests).
   */
  multiTenant?: boolean;

  /**
   * Policy for the install-time namespace gate (ADR-0048 Phase 1) — installing
   * a package whose `manifest.namespace` is already owned by a *different*
   * installed package.
   *
   * - `'error'` (default): throw {@link NamespaceConflictError} at install time,
   *   naming both packages. Makes the namespace land-grab a loud, early failure
   *   instead of a mid-install `CREATE TABLE` blow-up.
   * - `'warn'`: log a warning and let the install proceed. For deliberate
   *   migrations where the conflict is temporarily expected.
   *
   * Sourced from `OS_METADATA_COLLISION` (`warn` to downgrade) when not set
   * explicitly. Same-package reinstall and shareable platform namespaces
   * (`base`/`system`/`sys`) are never treated as conflicts. (The per-item
   * cross-package collision throw was retired in ADR-0048 §3.4 — distinct
   * package ids are always disambiguable by package-scoped resolution.)
   */
  collisionPolicy?: 'error' | 'warn';
}

/**
 * Augment a registered object with implicit system fields.
 *
 * Returns a *new* schema object when fields are added; returns the input
 * unchanged when nothing applies (the cheap path for system tables).
 *
 * Author-declared fields always win — we splice the system fields at the
 * front of the field map, so any same-named author field overwrites them
 * via the natural `{ ...sys, ...authored }` merge.
 *
 * Currently injects:
 *   - `organization_id` — always provisioned (unless the object opts out via
 *     `systemFields`/`tenancy.enabled:false` or is `better-auth` managed) so
 *     the column never depends on the global multi-tenant flag. Required-false;
 *     org-scoping populates it on insert in multi-tenant mode, and it stays
 *     NULL on single-tenant stacks. Only the column's INDEX is gated on
 *     `multiTenant` (no per-tenant filtering exists single-tenant).
 *   - `created_at` / `created_by` / `updated_at` / `updated_by` — audit
 *     fields. Marked `system: true, readonly: true` so detail views can
 *     surface them in a dedicated "System Information" section while
 *     edit forms / drawers filter them out. The driver populates the
 *     timestamps; the `*_by` lookups are filled by the runtime when an
 *     authenticated session is present (NULL otherwise — e.g. seeded
 *     rows).
 */
export function applySystemFields(
  schema: ServiceObject,
  opts: { multiTenant: boolean }
): ServiceObject {
  // 1. Hard opt-out at object level (e.g. seed/migration tables).
  if ((schema as any).systemFields === false) return schema;

  // 2. Skip only `better-auth` managed tables. Their column layout is
  //    driven by better-auth's own migrations (sys_user, sys_session,
  //    sys_organization, …) and injecting extra columns here would
  //    collide with what better-auth expects. Other `managedBy` buckets
  //    (`platform`, `config`, `system`, `append-only`) all need the
  //    tenant + audit columns for multi-tenant isolation and time-travel
  //    history — withholding them silently broke RLS reads on
  //    sys_audit_log / sys_activity (the SecurityPlugin's
  //    field-existence safety net dropped `organization_id =
  //    current_user.organization_id` as "field missing", producing
  //    RLS_DENY_FILTER → 0 rows for every non-admin caller).
  if (schema.managedBy === 'better-auth') return schema;

  const sf =
    typeof (schema as any).systemFields === 'object' && (schema as any).systemFields !== null
      ? ((schema as any).systemFields as { tenant?: boolean; audit?: boolean })
      : undefined;

  // Honor explicit opt-out via either `systemFields.tenant === false`
  // OR `tenancy.enabled === false`. The latter is the schema-level
  // declaration that the table is a shared/global catalog (e.g.
  // sys_package — the Marketplace registry). Without this, the
  // registry would still inject `organization_id`, and the
  // SecurityPlugin's RLS layer would filter every cross-org read down
  // to 0 rows even though the schema explicitly disabled multi-tenancy.
  const tenancyDisabled = (schema as any).tenancy?.enabled === false;
  // The `organization_id` COLUMN is provisioned unconditionally (subject only
  // to the explicit opt-outs above) — its existence no longer depends on the
  // global multi-tenant flag. Decoupling "does the column exist" from "is
  // tenancy enabled" is what stops sudo writers (audit / messaging / inbox /
  // outbox …) from failing with "no column named organization_id" on
  // single-tenant stacks: they can always stamp the column, it just stays NULL
  // when no tenant context exists. The multi-tenant flag now governs only
  // whether the column is INDEXED — on a single-tenant DB nothing ever filters
  // by organization, so the index would be dead weight.
  const wantTenant = sf?.tenant !== false && !tenancyDisabled;
  const wantAudit = sf?.audit !== false;

  const additions: Record<string, any> = {};

  if (wantTenant && !schema.fields?.organization_id) {
    additions.organization_id = {
      type: 'lookup',
      reference: 'sys_organization',
      label: 'Organization',
      required: false,
      indexed: opts.multiTenant,
      hidden: true,
      readonly: true,
      system: true,
      description:
        'Tenant scope (auto-populated by org-scoping on insert; NULL on single-tenant stacks).',
    };
  }

  if (wantAudit) {
    if (!schema.fields?.created_at) {
      additions.created_at = {
        type: 'datetime',
        label: 'Created At',
        required: false,
        readonly: true,
        system: true,
        description: 'Timestamp when the record was created (auto-populated by the driver).',
      };
    }
    if (!schema.fields?.created_by) {
      additions.created_by = {
        type: 'lookup',
        reference: 'sys_user',
        label: 'Created By',
        required: false,
        readonly: true,
        system: true,
        description: 'User who created the record (populated when an authenticated session is present).',
      };
    }
    if (!schema.fields?.updated_at) {
      additions.updated_at = {
        type: 'datetime',
        label: 'Last Modified At',
        required: false,
        readonly: true,
        system: true,
        description: 'Timestamp of the most recent modification (auto-populated by the driver).',
      };
    }
    if (!schema.fields?.updated_by) {
      additions.updated_by = {
        type: 'lookup',
        reference: 'sys_user',
        label: 'Last Modified By',
        required: false,
        readonly: true,
        system: true,
        description: 'User who last modified the record (populated when an authenticated session is present).',
      };
    }
  }

  if (Object.keys(additions).length === 0) return schema;

  return {
    ...schema,
    fields: { ...additions, ...(schema.fields ?? {}) },
  };
}

/**
 * Platform namespaces that multiple packages may legitimately share, so the
 * install-time namespace-uniqueness gate (ADR-0048 Phase 1) must never fire on
 * them: the FQN-exempt reserved namespaces (`base`, `system`) plus `sys`
 * (system objects such as `sys_metadata` are contributed by many packages — see
 * {@link SchemaRegistry.registerNamespace}, which is intentionally many-to-one).
 */
function isShareableNamespace(ns: string): boolean {
  return RESERVED_NAMESPACES.has(ns) || ns === 'sys';
}

/**
 * Raised when a package is installed whose `manifest.namespace` is already owned
 * by a **different** installed package in this installation (ADR-0048 Phase 1).
 *
 * The namespace is the mandatory object-name prefix (`${namespace}_${shortName}`)
 * and — once installed — the container that scopes a package's UI/automation
 * metadata. Two packages sharing a namespace would collide at the object/table
 * layer (a duplicate `CREATE TABLE crm_account` already fails loudly at the DB)
 * and would make container-scoped resolution ambiguous. This gate refuses the
 * install up front with an actionable error, instead of letting a half-applied
 * install blow up later at table creation. Shareable platform namespaces
 * (`base`/`system`/`sys`) are exempt.
 */
export class NamespaceConflictError extends Error {
  readonly namespace: string;
  readonly existingPackageId: string;
  readonly incomingPackageId: string;

  constructor(namespace: string, existingPackageId: string, incomingPackageId: string) {
    super(
      `Namespace conflict: namespace "${namespace}" is already owned by ` +
        `package "${existingPackageId}", so package "${incomingPackageId}" ` +
        `cannot be installed alongside it. A namespace is the mandatory prefix ` +
        `of every object name (e.g. "${namespace}_account") and the container ` +
        `that scopes a package's UI metadata, so it must be unique per ` +
        `installation. Choose a different namespace for "${incomingPackageId}", ` +
        `or uninstall "${existingPackageId}" first. If this is a deliberate ` +
        `migration, set OS_METADATA_COLLISION=warn to downgrade to a warning. ` +
        `See ADR-0048.`,
    );
    this.name = 'NamespaceConflictError';
    this.namespace = namespace;
    this.existingPackageId = existingPackageId;
    this.incomingPackageId = incomingPackageId;
  }
}

export class SchemaRegistry {
  // ==========================================
  // Logging control
  // ==========================================

  /** Controls verbosity of registry console messages. Default: 'info'. */
  private _logLevel: RegistryLogLevel = 'info';

  /** Whether to auto-inject multi-tenant system fields. */
  private readonly multiTenant: boolean;

  /** Cross-package base-layer collision policy (ADR-0048). */
  private readonly collisionPolicy: 'error' | 'warn';

  constructor(options: SchemaRegistryOptions = {}) {
    if (options.multiTenant !== undefined) {
      this.multiTenant = options.multiTenant;
    } else {
      // Mirror the SecurityPlugin / CLI banner default (env-driven, off by default).
      this.multiTenant =
        String(readEnvWithDeprecation('OS_MULTI_ORG_ENABLED', 'OS_MULTI_TENANT') ?? 'false').toLowerCase() !== 'false';
    }

    // ADR-0048 — default to a loud error on cross-package collision; allow an
    // env opt-out for deliberate migrations.
    this.collisionPolicy =
      options.collisionPolicy ??
      ((process.env.OS_METADATA_COLLISION ?? '').toLowerCase() === 'warn' ? 'warn' : 'error');
  }

  get logLevel(): RegistryLogLevel { return this._logLevel; }
  set logLevel(level: RegistryLogLevel) { this._logLevel = level; }

  private log(msg: string): void {
    if (this._logLevel === 'silent' || this._logLevel === 'error' || this._logLevel === 'warn') return;
    console.log(msg);
  }

  // ==========================================
  // Object-specific storage (Ownership Model)
  // ==========================================

  /** FQN → Contributor[] (all packages that own/extend this object) */
  private objectContributors = new Map<string, ObjectContributor[]>();

  /** FQN → Merged ServiceObject (cached, invalidated on changes) */
  private mergedObjectCache = new Map<string, ServiceObject>();

  /** Namespace → Set<PackageId> (multiple packages can share a namespace) */
  private namespaceRegistry = new Map<string, Set<string>>();

  // ==========================================
  // Generic metadata storage (non-object types)
  // ==========================================

  /** Type → Name/ID → MetadataItem */
  private metadata = new Map<string, Map<string, any>>();

  /**
   * App name → navigation contributions (ADR-0029 D7).
   *
   * Lets packages inject nav items into apps they do not own (the UI analog
   * of object extenders). Merged into the owning app's `navigation` tree on
   * read in {@link getApp} / {@link getAllApps} by group id + priority.
   */
  private appNavContributions = new Map<string, Array<{ packageId?: string; group?: string; priority: number; items: any[] }>>();

  /**
   * Package ids that must be installed in a DISABLED state. Seeded once at
   * boot (from persisted state) BEFORE any package registration so that every
   * registration path — boot artifact, marketplace rehydrate, local import —
   * honors persisted disable state uniformly without a fragile post-boot
   * re-application hook. See {@link setInitialDisabledPackageIds} and
   * {@link installPackage}.
   */
  private initialDisabledPackageIds = new Set<string>();

  /**
   * Seed the set of package ids that should be installed disabled. Call this
   * before package registration begins; later `installPackage` calls for these
   * ids land in the `disabled` state. Replaces any previously seeded set.
   */
  setInitialDisabledPackageIds(ids: Iterable<string>): void {
    this.initialDisabledPackageIds = new Set(ids);
  }

  // ==========================================
  // Namespace Management
  // ==========================================

  /**
   * Register a namespace for a package.
   * Multiple packages can share the same namespace (e.g. 'sys').
   */
  registerNamespace(namespace: string, packageId: string): void {
    if (!namespace) return;

    let owners = this.namespaceRegistry.get(namespace);
    if (!owners) {
      owners = new Set();
      this.namespaceRegistry.set(namespace, owners);
    }
    owners.add(packageId);
    this.log(`[Registry] Registered namespace: ${namespace} → ${packageId}`);
  }

  /**
   * Unregister a namespace when a package is uninstalled.
   */
  unregisterNamespace(namespace: string, packageId: string): void {
    const owners = this.namespaceRegistry.get(namespace);
    if (owners) {
      owners.delete(packageId);
      if (owners.size === 0) {
        this.namespaceRegistry.delete(namespace);
      }
      this.log(`[Registry] Unregistered namespace: ${namespace} ← ${packageId}`);
    }
  }

  /**
   * Get the packages that use a namespace.
   */
  getNamespaceOwner(namespace: string): string | undefined {
    const owners = this.namespaceRegistry.get(namespace);
    if (!owners || owners.size === 0) return undefined;
    // Return the first registered package for backwards compatibility
    return owners.values().next().value;
  }

  /**
   * Get all packages that share a namespace.
   */
  getNamespaceOwners(namespace: string): string[] {
    const owners = this.namespaceRegistry.get(namespace);
    return owners ? Array.from(owners) : [];
  }

  // ==========================================
  // Object Registration (Ownership Model)
  // ==========================================

  /**
   * Register an object with ownership semantics.
   * 
   * @param schema - The object definition
   * @param packageId - The owning package ID
   * @param namespace - The package namespace (for FQN computation)
   * @param ownership - 'own' (single owner) or 'extend' (additive merge)
   * @param priority - Merge priority (lower applied first, higher wins on conflict)
   * 
   * @throws Error if trying to 'own' an object that already has an owner
   */
  registerObject(
    schema: ServiceObject,
    packageId: string,
    namespace?: string,
    ownership: ObjectOwnership = 'own',
    priority: number = ownership === 'own' ? DEFAULT_OWNER_PRIORITY : DEFAULT_EXTENDER_PRIORITY
  ): string {
    // Apply system-field injection (multi-tenant org_id, future owner/audit)
    // BEFORE FQN computation and contributor storage so every consumer of
    // the registered schema (driver syncSchema, REST projector, hooks)
    // sees the same canonical shape. Author-declared fields win — see
    // applySystemFields().
    schema = applySystemFields(schema, { multiTenant: this.multiTenant });

    const shortName = schema.name;
    const fqn = computeFQN(namespace, shortName);

    // Ensure namespace is registered
    if (namespace) {
      this.registerNamespace(namespace, packageId);
    }

    // Get or create contributor list
    let contributors = this.objectContributors.get(fqn);
    if (!contributors) {
      contributors = [];
      this.objectContributors.set(fqn, contributors);
    }

    // Validate ownership rules
    if (ownership === 'own') {
      const existingOwner = contributors.find(c => c.ownership === 'own');
      if (existingOwner && existingOwner.packageId !== packageId) {
        throw new Error(
          `Object "${fqn}" is already owned by package "${existingOwner.packageId}". ` +
          `Package "${packageId}" cannot claim ownership. Use 'extend' to add fields.`
        );
      }
      // Remove existing owner contribution from same package (re-registration)
      const idx = contributors.findIndex(c => c.packageId === packageId && c.ownership === 'own');
      if (idx !== -1) {
        contributors.splice(idx, 1);
        console.warn(`[Registry] Re-registering owned object: ${fqn} from ${packageId}`);
      }
    } else {
      // extend mode: remove existing extension from same package
      const idx = contributors.findIndex(c => c.packageId === packageId && c.ownership === 'extend');
      if (idx !== -1) {
        contributors.splice(idx, 1);
      }
    }

    // ADR-0010 §3.7 — translate the author-facing `protection` block
    // into the private `_lock` envelope and stamp package provenance
    // on the schema before it lands in the contributor list. Mirrors
    // registerItem() so object schemas surface lock fields on GET.
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

    // Sort by priority (ascending: lower priority applied first)
    contributors.sort((a, b) => a.priority - b.priority);

    // Invalidate merge cache
    this.mergedObjectCache.delete(fqn);

    this.log(`[Registry] Registered object: ${fqn} (${ownership}, priority=${priority}) from ${packageId}`);
    return fqn;
  }

  /**
   * Resolve an object by FQN, merging all contributions.
   * Returns the merged object or undefined if not found.
   */
  resolveObject(fqn: string): ServiceObject | undefined {
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
      console.warn(`[Registry] Object "${fqn}" has extenders but no owner. Skipping.`);
      return undefined;
    }

    // Start with owner's definition
    let merged = { ...ownerContrib.definition };

    // Apply extensions in priority order (already sorted)
    for (const contrib of contributors) {
      if (contrib.ownership === 'extend') {
        merged = mergeObjectDefinitions(merged, contrib.definition);
      }
    }

    // Cache the result
    this.mergedObjectCache.set(fqn, merged);
    return merged;
  }

  /**
   * Get object by name (short name canonical, FQN supported for disambiguation).
   *
   * Short names are canonical for user code, AI generation, and most lookups.
   * FQN is accepted as an explicit fallback for cross-package disambiguation
   * when two packages contribute objects with the same short name.
   *
   * Resolution order:
   * 1. Exact name match — the name IS the canonical key.
   *    If multiple packages contribute the same short name, a warning is logged
   *    and the first match wins — disambiguate by passing the FQN explicitly.
   * 2. Legacy FQN match (e.g., 'crm__account') — backward compat.
   */
  getObject(name: string): ServiceObject | undefined {
    // Canonical: short name lookup
    const matches: string[] = [];
    for (const fqn of this.objectContributors.keys()) {
      const { shortName } = parseFQN(fqn);
      if (shortName === name) {
        matches.push(fqn);
      }
    }
    if (matches.length > 0) {
      if (matches.length > 1) {
        console.warn(
          `[SchemaRegistry] Ambiguous short name "${name}" matches: ${matches.join(', ')}. ` +
          `Returning first match. Use FQN to disambiguate.`
        );
      }
      return this.resolveObject(matches[0]);
    }

    // Fallback: explicit FQN
    return this.resolveObject(name);
  }

  /**
   * Get all registered objects (merged).
   * 
   * @param packageId - Optional filter: only objects contributed by this package
   */
  getAllObjects(packageId?: string): ServiceObject[] {
    const results: ServiceObject[] = [];

    for (const fqn of this.objectContributors.keys()) {
      // If filtering by package, check if this package contributes
      if (packageId) {
        const contributors = this.objectContributors.get(fqn);
        const hasContribution = contributors?.some(c => c.packageId === packageId);
        if (!hasContribution) continue;
      }

      const merged = this.resolveObject(fqn);
      if (merged) {
        // Tag with contributor info for UI
        (merged as any)._packageId = this.getObjectOwner(fqn)?.packageId;
        results.push(merged);
      }
    }

    return results;
  }

  /**
   * Get all contributors for an object.
   */
  getObjectContributors(fqn: string): ObjectContributor[] {
    return this.objectContributors.get(fqn) || [];
  }

  /**
   * Get the owner contributor for an object.
   */
  getObjectOwner(fqn: string): ObjectContributor | undefined {
    const contributors = this.objectContributors.get(fqn);
    return contributors?.find(c => c.ownership === 'own');
  }

  /**
   * ADR-0029 K0 — assert every registered object resolves to exactly one
   * owner.
   *
   * A second `own` from a different package is already rejected eagerly in
   * {@link registerObject} (it throws). This is the install-time backstop
   * called once all packages are registered (kernel bootstrap complete),
   * and it additionally catches the case `registerObject` cannot: an object
   * that has only `extend` contributions and **no owner** — which would
   * otherwise resolve to nothing. Surfacing it here turns a silent
   * "extend a non-existent object" into a clear bootstrap error.
   *
   * This is the invariant the kernel-decomposition (ADR-0029) relies on:
   * the `sys` namespace is shared across many first-party plugins, but each
   * object name has exactly one owner.
   *
   * @throws Error listing every object whose owner count is not exactly 1.
   */
  assertSingleOwnerPerObject(): void {
    const violations: string[] = [];
    for (const [fqn, contributors] of this.objectContributors.entries()) {
      const owners = contributors.filter(c => c.ownership === 'own');
      if (owners.length === 0) {
        const extenders = contributors.map(c => c.packageId).join(', ') || '(none)';
        violations.push(
          `Object "${fqn}" has no owner — only extend contributions from [${extenders}]. ` +
          `Exactly one package must register it with ownership 'own'.`
        );
      } else if (owners.length > 1) {
        const names = owners.map(c => c.packageId).join(', ');
        violations.push(
          `Object "${fqn}" has ${owners.length} owners [${names}] — exactly one is allowed.`
        );
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `[Registry] single-owner-per-object check failed (ADR-0029):\n  ` +
        violations.join('\n  ')
      );
    }
  }

  /**
   * Unregister all objects contributed by a package.
   * 
   * @throws Error if trying to uninstall an owner that has extenders
   */
  unregisterObjectsByPackage(packageId: string, force: boolean = false): void {
    for (const [fqn, contributors] of this.objectContributors.entries()) {
      // Find this package's contributions
      const packageContribs = contributors.filter(c => c.packageId === packageId);
      
      for (const contrib of packageContribs) {
        if (contrib.ownership === 'own' && !force) {
          // Check if there are extenders from other packages
          const otherExtenders = contributors.filter(
            c => c.packageId !== packageId && c.ownership === 'extend'
          );
          if (otherExtenders.length > 0) {
            throw new Error(
              `Cannot uninstall package "${packageId}": object "${fqn}" is extended by ` +
              `${otherExtenders.map(c => c.packageId).join(', ')}. Uninstall extenders first.`
            );
          }
        }

        // Remove contribution
        const idx = contributors.indexOf(contrib);
        if (idx !== -1) {
          contributors.splice(idx, 1);
          this.log(`[Registry] Removed ${contrib.ownership} contribution to ${fqn} from ${packageId}`);
        }
      }

      // Clean up empty contributor lists
      if (contributors.length === 0) {
        this.objectContributors.delete(fqn);
      }

      // Invalidate cache
      this.mergedObjectCache.delete(fqn);
    }
  }

  // ==========================================
  // Generic Metadata (Non-Object Types)
  // ==========================================

  /**
   * Universal Register Method for non-object metadata.
   */
  registerItem<T>(type: string, item: T, keyField: keyof T = 'name' as keyof T, packageId?: string) {
    if (!this.metadata.has(type)) {
      this.metadata.set(type, new Map());
    }
    const collection = this.metadata.get(type)!;
    const baseName = String(item[keyField]);

    // ADR-0010 §3.7 — translate the author-facing `protection` block
    // into the private `_lock` envelope and stamp package provenance.
    // Centralised with the artifact loader path in metadata/plugin.ts
    // so both load paths produce identical lock state.
    applyProtection(item as any, { packageId });

    // Validation Hook
    try {
      this.validate(type, item);
    } catch (e: any) {
      console.error(`[Registry] Validation failed for ${type} ${baseName}: ${e.message}`);
    }

    // Use composite key (packageId:name) when packageId is provided
    const storageKey = packageId ? `${packageId}:${baseName}` : baseName;

    if (collection.has(storageKey)) {
      this.log(`[Registry] Overwriting ${type}: ${storageKey}`);
    }

    // ADR-0048 — cross-package base-layer collision. When a code package
    // registers a bare-named generic item, refuse it loudly if a DIFFERENT
    // code package already owns the same (type, name). Without this guard the
    // two items live under distinct composite keys but bare-name resolution
    // (`getItem`) returns whichever the Map iterates first, silently shadowing
    // the loser — last-write-wins with no diagnostic.
    //
    // What is deliberately NOT a collision (these must pass through):
    //   - Same package re-registering the same name (idempotent reload):
    //     `conflictOwner` excludes `packageId` itself.
    //   - Runtime/DB overlay rows registered under the bare key with no real
    //     package provenance (or the `sys_metadata` sentinel): that is the
    //     legitimate ADR-0005 overlay path, already surfaced by the
    //     artifact-vs-DB warning below.
    // ADR-0048 §3.4 — the per-item CROSS-package throw is retired. Package ids
    // are globally unique, so package-scoped resolution (see getItem) always
    // disambiguates two different packages: two installed packages shipping the
    // same bare name (e.g. `page/home`) legitimately COEXIST under distinct
    // composite keys and each caller resolves to its own. What the original
    // guard flagged as a collision is now the supported marketplace case.
    //
    // Same-package re-registration still overwrites (idempotent reload), and a
    // runtime/DB overlay over a packaged item is the sanctioned ADR-0005 path,
    // surfaced by the artifact-vs-DB warning below.

    // Artifact-vs-DB collision warning. When a code package ships an item
    // whose name already exists as a DB-only entry (registered earlier
    // without a packageId — typically rehydrated from sys_metadata by
    // loadMetaFromDb / getMetaItems), the runtime overlay layer makes
    // the DB row silently shadow the new artifact value. That is correct
    // ADR-0005 behavior, but the silent shadowing can surprise package
    // authors and operators. Log a single warning so the situation is
    // discoverable in startup logs.
    if (packageId && collection.has(baseName)) {
      const dbOnly = collection.get(baseName) as any;
      if (dbOnly && !dbOnly._packageId) {
        console.warn(
          `[Registry] Collision: ${type}/${baseName} ships from package ` +
          `"${packageId}" but a runtime-authored row with the same name already ` +
          `exists in sys_metadata. The runtime row will shadow the package value ` +
          `(ADR-0005 overlay precedence). Rename one, or delete the sys_metadata ` +
          `row if the package value should win.`,
        );
      }
    }

    collection.set(storageKey, item);
    this.log(`[Registry] Registered ${type}: ${storageKey}`);
  }

  /**
   * Validate Metadata against Spec Zod Schemas
   */
  validate(type: string, item: any): unknown {
    if (type === 'object') {
      return ObjectSchema.parse(item);
    }
    if (type === 'app') {
      return AppSchema.parse(item);
    }
    if (type === 'package') {
      return InstalledPackageSchema.parse(item);
    }
    if (type === 'plugin') {
      return ManifestSchema.parse(item);
    }
    return true;
  }

  /**
   * Universal Unregister Method
   */
  unregisterItem(type: string, name: string) {
    const collection = this.metadata.get(type);
    if (!collection) {
      console.warn(`[Registry] Attempted to unregister non-existent ${type}: ${name}`);
      return;
    }
    if (collection.has(name)) {
      collection.delete(name);
      this.log(`[Registry] Unregistered ${type}: ${name}`);
      return;
    }
    // Scan composite keys
    for (const key of collection.keys()) {
      if (key.endsWith(`:${name}`)) {
        collection.delete(key);
        this.log(`[Registry] Unregistered ${type}: ${key}`);
        return;
      }
    }
    console.warn(`[Registry] Attempted to unregister non-existent ${type}: ${name}`);
  }

  /**
   * Universal Get Method.
   *
   * ADR-0048 §3.3 — *package-scoped* resolution. When `currentPackageId` is
   * given (the package the caller is resolving within — known from the route /
   * `activeApp._packageId`), a bare name resolves to *that package's* item
   * before any cross-package fallback, so two packages shipping e.g.
   * `page/home` no longer resolve by registration order (first-match-wins).
   * Because package ids are globally unique this is unambiguous. Omitting
   * `currentPackageId` preserves the legacy resolution exactly (backward
   * compatible) and is best-effort: it returns the first match.
   *
   * Precedence (highest first):
   *   1. bare-key runtime/DB overlay (ADR-0005 sanctioned override) — unchanged
   *   2. the `currentPackageId` composite entry (prefer-local)
   *   3. first composite match (legacy first-registered-wins fallback)
   */
  getItem<T>(type: string, name: string, currentPackageId?: string): T | undefined {
    // Special handling for 'object' and 'objects' types - use objectContributors
    if (type === 'object' || type === 'objects') {
      return this.getObject(name) as unknown as T | undefined;
    }

    const collection = this.metadata.get(type);
    if (!collection) return undefined;
    // A bare-key entry (a runtime/DB overlay rehydrated by restoreMetadataFromDb)
    // intentionally shadows the packaged composite item — ADR-0005 overlay
    // precedence (a customization wins over its package default). This is
    // checked before prefer-local so that precedence holds; note an env-wide
    // (package-less) overlay of a name that collides across packages is
    // inherently ambiguous by schema (sys_metadata is unique on type+name+org,
    // not package) and resolves to the single overlay row.
    const direct = collection.get(name);
    if (direct) return direct as T;

    // Prefer-local: resolve within the caller's package first.
    if (currentPackageId) {
      const local = collection.get(`${currentPackageId}:${name}`);
      if (local) return local as T;
    }

    // Fallback: first composite key matching the bare name (legacy behaviour).
    for (const [key, item] of collection) {
      if (key.endsWith(`:${name}`)) {
        return item as T;
      }
    }
    return undefined;
  }

  /**
   * Artifact-only lookup (ADR-0010 §3.3). Unlike {@link getItem} — which
   * returns the plain-key entry first, so a runtime/DB-rehydrated row
   * registered under the bare name SHADOWS the packaged artifact — this
   * scans the composite (`<packageId>:<name>`) entries first and only
   * returns an item whose `_packageId` marks a genuine code package
   * (truthy and not the `'sys_metadata'` rehydration sentinel).
   *
   * This is what the protocol's lock/provenance resolution must use:
   * the artifact's `_lock` envelope always wins over an overlay, and an
   * overlay row hydrated into the plain key must never be able to mask
   * it (that masking is exactly the "registry pollution" bug where a
   * locked app's `_lock` read back as undefined after a PUT+GET).
   */
  getArtifactItem<T>(type: string, name: string, currentPackageId?: string): T | undefined {
    if (type === 'object' || type === 'objects') {
      const obj = this.getObject(name) as any;
      return obj && obj._packageId && obj._packageId !== 'sys_metadata'
        ? (obj as T)
        : undefined;
    }
    const collection = this.metadata.get(type);
    if (!collection) return undefined;
    // ADR-0048 prefer-local: when the caller resolves within a package, the
    // artifact owned by that package wins over a first-match composite scan,
    // so two installed packages shipping the same name don't resolve by Map
    // iteration order.
    if (currentPackageId) {
      const local = collection.get(`${currentPackageId}:${name}`) as any;
      if (local && local._packageId && local._packageId !== 'sys_metadata') return local as T;
    }
    for (const [key, item] of collection) {
      if (key !== name && key.endsWith(`:${name}`)) {
        const it = item as any;
        if (it && it._packageId && it._packageId !== 'sys_metadata') return item as T;
      }
    }
    const direct = collection.get(name) as any;
    if (direct && direct._packageId && direct._packageId !== 'sys_metadata') {
      return direct as T;
    }
    return undefined;
  }

  /**
   * Remove a plain-key runtime shadow so the packaged artifact registered
   * under a composite key becomes the visible value again. Used by the
   * metadata reset path (`deleteMetaItem`): deleting the `sys_metadata`
   * overlay row must also heal the in-memory registry, otherwise the
   * stale overlay copy keeps shadowing the artifact until restart.
   *
   * Deliberately conservative: the plain-key entry is only deleted when a
   * packaged artifact still exists under a composite key, so the name
   * stays resolvable afterwards. A runtime-only item (no artifact
   * backing) is left untouched. Note the plain entry's own `_packageId`
   * is NOT consulted — the hydration path grafts the artifact envelope
   * onto the shadow (ADR-0010 §3.3), so a stamped `_packageId` does not
   * mean the plain entry IS the artifact registration; artifact loaders
   * always register under a composite key.
   */
  removeRuntimeShadow(type: string, name: string): boolean {
    const collection = this.metadata.get(type);
    if (!collection || !collection.has(name)) return false;
    for (const [key, item] of collection) {
      if (key !== name && key.endsWith(`:${name}`)) {
        const it = item as any;
        if (it && it._packageId && it._packageId !== 'sys_metadata') {
          collection.delete(name);
          this.log(`[Registry] Removed runtime shadow ${type}: ${name} (artifact ${it._packageId} restored)`);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Universal List Method
   */
  listItems<T>(type: string, packageId?: string): T[] {
    // Special handling for 'object' and 'objects' types - use objectContributors
    if (type === 'object' || type === 'objects') {
      return this.getAllObjects(packageId) as unknown as T[];
    }

    const items = Array.from(this.metadata.get(type)?.values() || []) as T[];
    let result = items;
    if (packageId) {
      result = result.filter((item: any) => item._packageId === packageId);
    }
    // Hide metadata owned by a disabled package so the console (app switcher,
    // view lists, dashboards, …) stops surfacing it after a disable. The
    // `package` type itself is never filtered — the Packages page must still
    // list disabled packages so they can be re-enabled. Disable is reversible:
    // items remain registered and reappear on enable.
    if (type !== 'package') {
      result = result.filter((item: any) => !this.isPackageDisabled((item as any)?._packageId));
    }
    return result;
  }

  /**
   * Whether a package has been explicitly disabled. Unknown packages and
   * items with no owning package are treated as enabled.
   */
  isPackageDisabled(packageId?: string): boolean {
    if (!packageId) return false;
    const pkg = this.getPackage(packageId);
    return pkg?.enabled === false || pkg?.status === 'disabled';
  }

  /**
   * Get all registered metadata types (Kinds)
   */
  getRegisteredTypes(): string[] {
    const types = Array.from(this.metadata.keys());
    // Always include 'object' even if stored separately
    if (!types.includes('object') && this.objectContributors.size > 0) {
      types.push('object');
    }
    return types;
  }

  // ==========================================
  // Package Management
  // ==========================================

  installPackage(manifest: ObjectStackManifest, settings?: Record<string, any>): InstalledPackage {
    // ADR-0048 Phase 1 — install-time namespace gate. Refuse a package whose
    // namespace is already owned by a *different* installed package; this is
    // the constraint the object/table layer enforces implicitly (a duplicate
    // `CREATE TABLE <ns>_<obj>` fails at the DB), made explicit and early.
    // Same-package reinstall/reload is excluded (owner === manifest.id), and
    // shareable platform namespaces (base/system/sys) are exempt.
    if (manifest.namespace && !isShareableNamespace(manifest.namespace)) {
      const conflictOwner = this.getNamespaceOwners(manifest.namespace).find(
        (owner) => owner !== manifest.id,
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

    const now = new Date().toISOString();
    const disabled = this.initialDisabledPackageIds.has(manifest.id);
    const pkg: InstalledPackage = {
      manifest,
      status: disabled ? 'disabled' : 'installed',
      enabled: !disabled,
      installedAt: now,
      updatedAt: now,
      ...(disabled ? { statusChangedAt: now } : {}),
      settings,
    };
    
    // Register namespace if present
    if (manifest.namespace) {
      this.registerNamespace(manifest.namespace, manifest.id);
    }
    
    if (!this.metadata.has('package')) {
      this.metadata.set('package', new Map());
    }
    const collection = this.metadata.get('package')!;
    if (collection.has(manifest.id)) {
      console.warn(`[Registry] Overwriting package: ${manifest.id}`);
    }
    collection.set(manifest.id, pkg);
    this.log(`[Registry] Installed package: ${manifest.id} (${manifest.name})`);
    return pkg;
  }

  uninstallPackage(id: string): boolean {
    const pkg = this.getPackage(id);
    if (!pkg) {
      console.warn(`[Registry] Package not found for uninstall: ${id}`);
      return false;
    }

    // Unregister namespace
    if (pkg.manifest.namespace) {
      this.unregisterNamespace(pkg.manifest.namespace, id);
    }

    // Unregister objects (will throw if extenders exist)
    this.unregisterObjectsByPackage(id);

    // Remove package record
    const collection = this.metadata.get('package');
    if (collection) {
      collection.delete(id);
      this.log(`[Registry] Uninstalled package: ${id}`);
      return true;
    }
    return false;
  }

  getPackage(id: string): InstalledPackage | undefined {
    return this.metadata.get('package')?.get(id) as InstalledPackage | undefined;
  }

  getAllPackages(): InstalledPackage[] {
    return this.listItems<InstalledPackage>('package');
  }

  enablePackage(id: string): InstalledPackage | undefined {
    const pkg = this.getPackage(id);
    if (pkg) {
      pkg.enabled = true;
      pkg.status = 'installed';
      pkg.statusChangedAt = new Date().toISOString();
      pkg.updatedAt = new Date().toISOString();
      this.log(`[Registry] Enabled package: ${id}`);
    }
    return pkg;
  }

  disablePackage(id: string): InstalledPackage | undefined {
    const pkg = this.getPackage(id);
    if (pkg) {
      pkg.enabled = false;
      pkg.status = 'disabled';
      pkg.statusChangedAt = new Date().toISOString();
      pkg.updatedAt = new Date().toISOString();
      this.log(`[Registry] Disabled package: ${id}`);
    }
    return pkg;
  }

  // ==========================================
  // App Helpers
  // ==========================================

  registerApp(app: any, packageId?: string) {
    this.registerItem('app', app, 'name', packageId);
  }

  getApp(name: string, currentPackageId?: string): any {
    // ADR-0048 §3.1 — apps are addressed by package id (one app per package).
    // When the caller knows it (route segment / `_packageId`), resolve
    // prefer-local; otherwise this is a best-effort by-name lookup.
    const app = this.getItem('app', name, currentPackageId);
    if (!app) return app;
    return this.applyNavContributions(app);
  }

  getAllApps(): any[] {
    return this.listItems('app').map((app: any) => this.applyNavContributions(app));
  }

  // ==========================================
  // App navigation contributions (ADR-0029 D7)
  // ==========================================

  /**
   * Register a navigation contribution — a package injecting nav items into
   * an app it does not own (the UI-layer analog of object `extend`).
   *
   * Contributions are merged into the target app's `navigation` tree lazily
   * on read ({@link getApp} / {@link getAllApps}) by group id + priority, so
   * registration order does not matter and the owning app can be registered
   * before or after its contributors.
   */
  registerAppNavContribution(
    contribution: { app: string; group?: string; priority?: number; items?: any[] },
    packageId?: string,
  ): void {
    if (!contribution || !contribution.app) return;
    const list = this.appNavContributions.get(contribution.app) ?? [];
    list.push({
      packageId,
      group: contribution.group,
      priority: contribution.priority ?? 200,
      items: Array.isArray(contribution.items) ? contribution.items : [],
    });
    this.appNavContributions.set(contribution.app, list);
    this.log(
      `[Registry] Navigation contribution: ${packageId ?? '(unknown)'} -> ${contribution.app}` +
        (contribution.group ? `/${contribution.group}` : '') +
        ` (${list[list.length - 1].items.length} items)`,
    );
  }

  /** Contributions registered for an app (empty array when none). */
  getAppNavContributions(appName: string): Array<{ packageId?: string; group?: string; priority: number; items: any[] }> {
    return this.appNavContributions.get(appName) ?? [];
  }

  /**
   * Return a copy of `app` with all registered navigation contributions
   * merged into its `navigation` tree. The stored app is never mutated, so
   * repeated reads stay idempotent.
   *
   * Public so the protocol serving path (`getMetaItems` / `getMetaItem` for
   * `app`) can merge contributions the same way `getApp` / `getAllApps` do —
   * the REST app endpoints read through the protocol, not these helpers, so
   * the merge must be reachable from there too (ADR-0029 D7).
   */
  applyNavContributions(app: any): any {
    const contributions = this.appNavContributions.get(app?.name);
    if (!contributions || contributions.length === 0) return app;

    const cloned = structuredClone(app);
    const nav: any[] = Array.isArray(cloned.navigation) ? cloned.navigation : (cloned.navigation = []);

    // Lower priority applied first — mirrors object extender ordering.
    const sorted = [...contributions].sort((a, b) => a.priority - b.priority);
    for (const c of sorted) {
      if (!c.items.length) continue;
      if (c.group) {
        const group = this.findNavGroup(nav, c.group);
        if (group) {
          if (!Array.isArray(group.children)) group.children = [];
          group.children.push(...c.items);
        } else {
          this.log(
            `[Registry] Navigation contribution from "${c.packageId ?? '(unknown)'}" targets ` +
              `missing group "${c.group}" in app "${app.name}" — appending at top level.`,
          );
          nav.push(...c.items);
        }
      } else {
        nav.push(...c.items);
      }
    }
    return cloned;
  }

  /** Depth-first search for a `type: 'group'` nav item by id. */
  private findNavGroup(items: any[], groupId: string): any | undefined {
    for (const item of items) {
      if (item && item.id === groupId && item.type === 'group') return item;
      if (item && Array.isArray(item.children)) {
        const found = this.findNavGroup(item.children, groupId);
        if (found) return found;
      }
    }
    return undefined;
  }

  // ==========================================
  // Plugin Helpers
  // ==========================================

  registerPlugin(manifest: ObjectStackManifest) {
    this.registerItem('plugin', manifest, 'id');
  }

  getAllPlugins(): ObjectStackManifest[] {
    return this.listItems<ObjectStackManifest>('plugin');
  }

  // ==========================================
  // Kind Helpers
  // ==========================================

  registerKind(kind: { id: string, globs: string[] }) {
    this.registerItem('kind', kind, 'id');
  }
  
  getAllKinds(): { id: string, globs: string[] }[] {
    return this.listItems('kind');
  }

  // ==========================================
  // Reset (for testing)
  // ==========================================

  /**
   * Invalidate the merged-schema cache for a single FQN (or short name).
   *
   * Call this from event-driven consumers (ADR-0008 M0 PR-7) when an
   * upstream metadata change makes the cached merged definition stale.
   * The contributor list is preserved — only the cached merge result is
   * dropped, so the next `resolveObject(fqn)` recomputes from scratch.
   *
   * Accepts either an FQN (`acme__contact`) or a bare short name
   * (`contact`); for the latter, all entries whose suffix matches the
   * name are invalidated.
   */
  invalidate(fqnOrName: string): void {
    if (this.mergedObjectCache.has(fqnOrName)) {
      this.mergedObjectCache.delete(fqnOrName);
      return;
    }
    // Short-name path: drop any cached merge whose FQN ends with `__<name>` or equals `<name>`.
    const suffix = `__${fqnOrName}`;
    for (const fqn of Array.from(this.mergedObjectCache.keys())) {
      if (fqn === fqnOrName || fqn.endsWith(suffix)) {
        this.mergedObjectCache.delete(fqn);
      }
    }
  }

  /** Drop every entry from the merged-schema cache. */
  invalidateAll(): void {
    this.mergedObjectCache.clear();
  }

  /**
   * Clear all registry state. Use only for testing.
   */
  reset(): void {
    this.objectContributors.clear();
    this.mergedObjectCache.clear();
    this.namespaceRegistry.clear();
    this.metadata.clear();
    this.appNavContributions.clear();
    this.log('[Registry] Reset complete');
  }
}
