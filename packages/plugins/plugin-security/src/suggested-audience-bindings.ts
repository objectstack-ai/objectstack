// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Suggested audience bindings (ADR-0090 D5/D9) — the queryable surface and
 * the deployment-level accept/dismiss flow for a package's `isDefault: true`
 * install-time suggestion ("give this set to every signed-in member —
 * accept?").
 *
 * ## What an acceptance does (#22801 → A)
 *
 * A package's `isDefault: true` permission set reaches every signed-in user
 * only through ONE explicit, deployment-level acceptance by a caller holding
 * `manage_metadata` — under a wall, only the platform operator — and that
 * acceptance takes effect: the security plugin derives the `everyone`
 * anchor's definition as the deployment's baseline plus the accepted package
 * defaults ({@link readAcceptedEveryoneSets}), and derives it again on every
 * accept, revoke, uninstall and package publish.
 *
 * The anchor stays sealed (2c): no caller writes `everyone`'s definition. An
 * acceptance changes the derivation's INPUT — one row here — and the plugin,
 * the definition's only declarer, re-declares it. Packages suggest, admins
 * confirm, nothing is auto-bound (ADR-0090 D5, unchanged).
 *
 *  - `syncAudienceBindingSuggestions` is CONVERGENT and idempotent: it reads
 *    every `isDefault` set the security catalog serves with an owning package
 *    and reconciles the table against the `everyone` DEFINITION: a set the
 *    definition already names (the deployment's baseline) is `confirmed`
 *    (observed); an unanswered one is `pending`; a pending row whose
 *    declaration is gone is pruned. It runs at boot, after a package-door
 *    `permission` publish, and on every list call.
 *  - `confirmAudienceBindingSuggestion` is the acceptance. It refuses a set
 *    carrying a bit the `everyone` anchor forbids (ADR-0090 D7's high-risk
 *    gate, on the definition side), records the decision, and re-derives
 *    `everyone`.
 *  - `dismissAudienceBindingSuggestion` records the "no" — on a pending row —
 *    or REVOKES an acceptance, which re-derives `everyone` without the set.
 *
 * ## The record is the DEPLOYMENT's, owned by the Default Organization
 *
 * `sys_audience_binding_suggestion` is tenant-scoped storage, and ADR-0131
 * owns a deployment-level row by the Default Organization (D3/D5). So every
 * read and write here carries `{ isSystem: true, tenantId: <Default
 * Organization> }` ({@link resolveDefaultOrganizationId}), and a row any
 * other organization owns — or none — is not this surface's.
 *
 * ## Rows written before the acceptance was deployment-level
 *
 * Until #22801 a TENANT administrator confirmed per organization, and that
 * confirm granted nothing. ⛔ Such a decision is never promoted into a
 * deployment-wide grant: only a `manage_metadata` holder's act widens
 * `everyone`. A row carries `deployment_decision: true` only when that act
 * resolved it, so:
 *
 *  - a Default-Organization row resolved without it is RE-OPENED (`pending`)
 *    by the sync, unless the `everyone` definition already names its set —
 *    the decision passes to a holder of the authority;
 *  - a row owned by any other organization, or by none, is not read; the
 *    boot reconciliation reports how many there are, once
 *    ({@link reconcileAudienceBindingSuggestions}). They grant nothing, as
 *    they never did.
 */

import {
  createSeedWriteRefusals,
  type SeedWriteRefusals,
} from './write-refusals.js';
import type { TenancyPosture } from '@objectstack/spec/security';
import { describeAnchorForbiddenBits, postureEnforcesWall } from '@objectstack/spec/security';
import { EVERYONE_POSITION } from '@objectstack/spec';
import { securityCatalogReaderOf } from '@objectstack/core';
import { METADATA_AUTHORING_CAPABILITY } from '@objectstack/metadata-core';
import { PermissionDeniedError } from './errors.js';
import { readDeclaredCapabilityContext } from './declared-capability-context.js';

/** The execution context every read and write of the record carries. */
function scopedSystemCtx(organizationId?: string): { isSystem: true; tenantId?: string } {
  return organizationId ? { isSystem: true, tenantId: organizationId } : { isSystem: true };
}

const SUGGESTION_OBJECT = 'sys_audience_binding_suggestion';
const ORGANIZATION_OBJECT = 'sys_organization';

/**
 * The refusal when the deployment has no Default Organization to own the
 * record — a walled deployment with several organizations and none with
 * `slug='default'`.
 */
const NO_RECORD_OWNER_MESSAGE =
  'The audience-binding acceptance is recorded once per deployment and owned by the Default Organization ' +
  "(ADR-0131 D3/D5), and this deployment has none: no organization has slug 'default' and there is more " +
  "than one organization. Remedy: create the Default Organization (slug 'default') — the organizations " +
  "plugin's bootstrap creates it for the platform administrator.";

/** Thrown when the referenced suggestion row does not exist → HTTP 404. */
export class SuggestionNotFoundError extends Error {
  readonly code = 'SUGGESTION_NOT_FOUND';
  readonly statusCode = 404;
  constructor(id: string) {
    super(`Audience-binding suggestion '${id}' not found`);
    this.name = 'SuggestionNotFoundError';
  }
}

/** Thrown when a confirm/dismiss hits a row in the wrong state or an
 *  unresolvable precondition (set not served, no record owner) → HTTP 409. */
export class SuggestionStateError extends Error {
  readonly code = 'SUGGESTION_STATE';
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'SuggestionStateError';
  }
}

export interface SuggestionDeps {
  /** ObjectQL engine handle. */
  ql: any;
  /** Metadata service (the declared-capability read of the high-risk gate). */
  metadata?: any;
  /**
   * [ADR-0105 D1] The deployment's tenancy posture, read at call time. Under a
   * wall the acceptance is the platform operator's alone (ADR-0126 §5's rule
   * for every install-wide row).
   */
  posture: () => TenancyPosture | undefined;
  /**
   * Re-derive the `everyone` anchor's definition from the baseline and the
   * accepted package defaults. The security plugin owns the definition, so it
   * owns this; an accept or a revoke calls it once the record is written.
   */
  rederiveEveryone: () => Promise<void>;
  logger?: { info?: (m: string, meta?: any) => void; warn?: (m: string, meta?: any) => void };
}

export interface SuggestionSyncOutcome {
  created: number;
  confirmedObserved: number;
  pruned: number;
  /**
   * Rows resolved before the acceptance was deployment-level, sent back to
   * `pending` so a `manage_metadata` holder decides them (module doc).
   */
  reopened: number;
  /**
   * [#12981] Suggestion-row writes the store REFUSED this pass, EXCLUDING the
   * documented benign race (see below).
   *
   * ⚠️ Not the complement of the three counters above — those count writes that
   * LANDED. Without this one, the reconciliation reported `{ created: 0,
   * confirmedObserved: 0, pruned: 0 }` both when the declarations were already
   * in sync (the steady-state boot, which is the common case) and when every
   * single write was refused, and the summary line is suppressed on that same
   * zero, so the second case printed nothing at all.
   *
   * ⛔ A refusal classified as a `unique-violation` is NOT counted here. On
   * this object that class is the concurrent-sync race the insert site has
   * always documented as benign: two passes raced, the other one created the
   * row, and the end state is the row this pass wanted. Counting it would
   * report a degradation that did not happen — the over-application AGENTS.md
   * warns about, and the reason the shared accumulator classifies at all
   * rather than counting raw failures.
   */
  refused: number;
}

/** What one boot or publish reconciliation did. */
export interface SuggestionReconcileOutcome extends SuggestionSyncOutcome {
  /**
   * Rows some OTHER organization (or none) owns — written while a tenant
   * administrator confirmed per organization. Not read, never promoted;
   * counted and reported once per reconciliation.
   */
  unread: number;
}

export interface SuggestionListFilter {
  status?: 'pending' | 'confirmed' | 'dismissed';
  packageId?: string;
}

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rand}`;
}

// Engine signatures: `find(object, query)` and `delete(object, options)` read
// `context` from their SECOND argument — a trailing `{ context }` arg is
// silently ignored and the operation runs principal-less.
async function tryFind(
  ql: any,
  object: string,
  where: any,
  limit = 500,
  organizationId?: string,
): Promise<any[]> {
  try {
    const rows = await ql.find(object, { where, limit, context: scopedSystemCtx(organizationId) });
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

/** A declared `isDefault` permission set together with its owning package. */
interface DeclaredSuggestion {
  packageId: string;
  set: any;
  anchor: string;
}

function suggestionKey(packageId: string, setName: string, anchor: string): string {
  return `${packageId}\u0000${setName}\u0000${anchor}`;
}

/**
 * One installed package whose `manifest.permissions` this reader could not read
 * as permission sets, and which ADR-0025 form it turned out to be carrying:
 * the structured block `ManifestPermissionsSchema` declares, or the flat
 * string list that schema RETIRED (`adr-0025-legacy-strings`) — refused at
 * parse since, but still able to sit on a registry row installed from a
 * bundle that never passed that parse.
 *
 * `entries` counts the ARRAY members that were dropped, and is `0` for the
 * structured arm, which is one object dropped whole.
 */
interface DroppedManifestPermissions {
  packageId: string;
  arm: 'adr-0025-structured' | 'adr-0025-legacy-strings';
  entries: number;
}

/**
 * Which packages one engine has already been told about, so the report below
 * is made ONCE per engine per package+arm rather than once per pass.
 *
 * The frequency is the whole reason this is not a bare `warn` at the drop
 * site: `syncAudienceBindingSuggestions` runs at boot, after every
 * package-door `permission` publish AND on every `listAudienceBindingSuggestions`
 * call, while a manifest's shape is fixed for as long as that package is
 * installed — so an undeduplicated line would repeat on every console page
 * load and be skimmed past, which is the same silence with extra steps.
 *
 * Keyed on the ENGINE rather than held in a module-level `Set`, so a process
 * hosting several tenant kernels reports once per kernel, and so a test gets a
 * fresh ledger from its own stub with nothing to reset.
 */
const reportedManifestPermissionDrops = new WeakMap<object, Set<string>>();

/**
 * Classify a manifest's `permissions` value against what THIS reader needs.
 *
 * `null` = readable as permission sets, or simply absent. A partially readable
 * array is reported with only its unreadable members counted.
 */
function classifyManifestPermissions(
  permissions: unknown,
): Omit<DroppedManifestPermissions, 'packageId'> | null {
  if (permissions === undefined || permissions === null) return null;
  if (!Array.isArray(permissions)) {
    // The ADR-0025 §3.2 structured block — `{ services, hooks, network, fs }`.
    // An object, so `Array.isArray` is false and the whole value is dropped.
    return typeof permissions === 'object' ? { arm: 'adr-0025-structured', entries: 0 } : null;
  }
  // The retired legacy flat list is `string[]`; a permission set is an object
  // with a `name`. Count what `consider` refuses on SHAPE — never what it refuses on
  // `isDefault` or on missing provenance, which are decisions, not drops.
  const entries = permissions.filter((e) => !e || typeof e !== 'object' || !(e as { name?: unknown }).name).length;
  return entries > 0 ? { arm: 'adr-0025-legacy-strings', entries } : null;
}

/**
 * Report — once per engine per package+arm — that a package's
 * `manifest.permissions` carried the ADR-0025 reading and therefore
 * contributed no audience-binding suggestion.
 *
 * ## Why this exists: one key, two incompatible readings, one registry slot
 *
 * `permissions` means different things at the two manifest stages, and the
 * registry stores both under the same key:
 *
 *  - AUTHORING stage — `ManifestSchema.permissions` is `ManifestPermissionsSchema`
 *    (`kernel/manifest.zod.ts`): the capability grant a plugin REQUESTS, the
 *    structured `{ services, hooks, network, fs }` block (ADR-0025 §3.2). Its
 *    legacy flat `string[]` form is retired and refused at parse, so a list
 *    here is a row whose bundle never passed that parse;
 *  - ASSEMBLED stage — the collection wins and the key is `PermissionSet[]`
 *    (`AssembledPackageBodySchema` in `stack.zod.ts`, ADR-0130 D4), whose own
 *    table states that precedence key by key.
 *
 * This reader wants the assembled reading. Handed the authoring one it used to
 * return an empty list and say nothing: the structured arm fell out of
 * `Array.isArray`, and every member of a (now retired) flat list fell out of
 * `consider`'s first line. A package declaring the other reading produced no suggestion, no
 * row and no log — AGENTS.md "Route & surface ownership" §3: absence must be
 * loud.
 *
 * ## Why `warn` and not `error`
 *
 * Same reasoning as {@link reportSuggestionWriteRefusals}, one step weaker:
 * nothing here claims to have persisted anything, so this is a FUNCTIONAL
 * degradation — a prompt that is not offered — which AGENTS.md "Degradation
 * log levels" puts at `warn`. The sink is the same `SuggestionDeps['logger']`,
 * which declares no `error`.
 */
function reportDroppedManifestPermissions(
  ql: unknown,
  logger: SuggestionDeps['logger'] | undefined,
  dropped: DroppedManifestPermissions[],
): void {
  if (dropped.length === 0 || !logger?.warn) return;
  let ledger: Set<string> | undefined;
  if (typeof ql === 'object' && ql !== null) {
    ledger = reportedManifestPermissionDrops.get(ql);
    if (ledger === undefined) {
      ledger = new Set<string>();
      reportedManifestPermissionDrops.set(ql, ledger);
    }
  }
  const fresh = ledger ? dropped.filter((d) => !ledger.has(`${d.packageId}|${d.arm}`)) : dropped;
  if (fresh.length === 0) return;
  for (const d of fresh) ledger?.add(`${d.packageId}|${d.arm}`);
  logger.warn(
    `[security] ${fresh.length} installed package(s) declare \`manifest.permissions\` in the ADR-0025 ` +
      `plugin-GRANT reading, not the ADR-0090 permission-SET collection this reconciler reads — those ` +
      `declarations contribute NO audience-binding suggestion, and until now they said nothing at all. ` +
      `One key carries two incompatible readings and the registry stores both in the same slot: at the ` +
      `AUTHORING stage \`ManifestSchema.permissions\` is the capability grant a plugin requests (the ` +
      `structured \`{ services, hooks, network, fs }\` block, ADR-0025 §3.2 — its legacy flat \`string[]\` ` +
      `form is retired and refused at parse, so a list here is a row that never passed that parse); at ` +
      `the ASSEMBLED stage the collection wins and the key is \`PermissionSet[]\` ` +
      `(\`AssembledPackageBodySchema\`, ADR-0130 D4). This pass reads the ASSEMBLED one, so the authoring ` +
      `one is skipped whole — the structured block is an object and never enters the loop, and every ` +
      `member of a retired flat list is a bare string with no \`name\`. CONSEQUENCE: if any of these packages meant to ` +
      `ship a permission set with \`isDefault: true\`, no \`sys_audience_binding_suggestion\` row exists ` +
      `for it and no admin is ever prompted to bind it — the console shows one fewer suggestion and the ` +
      `deployment goes on looking healthy. If they meant the ADR-0025 grant, nothing is lost and this line ` +
      `is informational; it prints either way because this reader cannot tell the two intents apart. ` +
      `REMEDY: declare permission sets in the package's OWN stack collection — ` +
      `\`defineStack({ permissions: [ … ] })\` — which is what the assembled body carries and what this ` +
      `pass reads, and leave the manifest-stage \`permissions\` to ADR-0025. Reported once per engine per ` +
      `package and arm, so a shape that does not change does not repeat on every list call.`,
    { packages: fresh },
  );
}

/**
 * Collect every currently-declared audience-binding suggestion: each
 * `isDefault: true` permission set the security catalog serves
 * (`securityCatalogReaderOf`, ADR-0131 D3 — the engine registry, then the
 * metadata service) with an owning package: its binding (`_packageId`,
 * ADR-0010), read by {@link declaredOwnerOf}. The catalog is what the authorization resolver
 * reads a set's body from, so a set it does not serve could grant nothing
 * once accepted, and is not offered.
 *
 * Today the only declarable suggestion is `isDefault: true` → `everyone`
 * (ADR-0090 D5).
 *
 * `logger` is optional and carries ONE report: an installed package record's
 * `manifest.permissions` read at the authoring stage contributes nothing
 * here — see {@link reportDroppedManifestPermissions}. Passing no logger is
 * silent, which is why every in-repo caller passes one.
 */
export async function collectDeclaredSuggestions(
  ql: any,
  logger?: SuggestionDeps['logger'],
): Promise<DeclaredSuggestion[]> {
  const out = new Map<string, DeclaredSuggestion>();

  const consider = (ps: any, packageId: string | undefined) => {
    if (!ps || typeof ps !== 'object' || !ps.name) return;
    if (ps.isDefault !== true) return;
    if (!packageId) return; // unowned suggestion = unowned binding — refuse (ADR-0086 D3)
    const anchor: string = EVERYONE_POSITION;
    const key = suggestionKey(packageId, ps.name, anchor);
    if (!out.has(key)) out.set(key, { packageId, set: ps, anchor });
  };

  const reader = securityCatalogReaderOf(ql);
  for (const entry of reader ? await reader.list('permission') : []) {
    consider(entry.definition, declaredOwnerOf(entry));
  }

  // The installed package records, asked one question only: does a manifest
  // carry `permissions` in the ADR-0025 reading, which no catalog entry comes
  // from? Reported, never read as a declaration.
  const dropped: DroppedManifestPermissions[] = [];
  try {
    const packages: any[] = ql?.registry?.getAllPackages?.() ?? [];
    for (const pkg of packages) {
      if (pkg?.enabled === false) continue;
      const manifest = pkg?.manifest;
      const drop = classifyManifestPermissions(manifest?.permissions);
      if (drop) dropped.push({ packageId: manifest?.id ?? manifest?.name ?? '(unidentified package)', ...drop });
    }
  } catch { /* registry shape optional (test stubs) */ }
  reportDroppedManifestPermissions(ql, logger, dropped);

  return [...out.values()];
}

/**
 * The package a catalog entry's set is declared by: its binding, the
 * `_packageId` the catalog serves as `entry.packageId`, and nothing else
 * (ADR-0086 D3, "absent ⇒ env-authored").
 *
 * ⛔ The body's own `packageId` is NOT read, not even when the entry names no
 * binding. It used to be, as a fallback, and that let a set the binding calls
 * environment-authored be suggested, accepted and derived into `everyone` as
 * a package's. The metadata save and publish doors now refuse a body
 * `packageId` that disagrees with the binding, an unbound one included, so a
 * body that agrees adds nothing the binding does not say, and one that
 * disagrees never reaches `active` through them. A stored row written before
 * that refusal keeps its bytes and is read by its binding, here as everywhere.
 */
function declaredOwnerOf(entry: { packageId?: string }): string | undefined {
  return entry.packageId;
}

/**
 * The deployment's Default Organization — the owner of every row of this
 * record (ADR-0131 D3/D5). The one with `slug='default'`, else the only
 * organization there is; `undefined` when neither exists.
 *
 * The same derivation as plugin-auth's Default Organization boot invariant
 * (`default-organization-invariant.ts`), read-only: this module never creates
 * one.
 */
export async function resolveDefaultOrganizationId(ql: any): Promise<string | undefined> {
  const read = async (where: Record<string, unknown>, limit: number): Promise<any[]> => {
    const rows = await ql.find(ORGANIZATION_OBJECT, { where, fields: ['id'], limit, context: scopedSystemCtx() });
    return Array.isArray(rows) ? rows : [];
  };
  const bySlug = await read({ slug: 'default' }, 1);
  if (typeof bySlug[0]?.id === 'string' && bySlug[0].id !== '') return bySlug[0].id;
  const all = await read({}, 2);
  return all.length === 1 && typeof all[0]?.id === 'string' && all[0].id !== '' ? all[0].id : undefined;
}

/** Is `row` this record's — owned by the Default Organization? (module doc) */
function ownedBy(row: any, organizationId: string): boolean {
  return row?.organization_id === organizationId;
}

/** Was `row` resolved by the deployment-level decision (module doc)? */
function isDeploymentDecision(row: any): boolean {
  return row?.deployment_decision === true || row?.deployment_decision === 1;
}

/**
 * The permission-set names the `everyone` anchor's definition names now — the
 * definition the authorization resolver reads. "Reconciliation reads the
 * definition": the sync's observed check and the confirm's `bindingCreated`
 * both ask this, never a binding row.
 */
async function everyoneDefinitionSets(ql: any): Promise<Set<string>> {
  const entry = await securityCatalogReaderOf(ql)?.resolve('position', EVERYONE_POSITION);
  const sets = entry?.definition.permissionSets;
  return new Set(Array.isArray(sets) ? sets.filter((n): n is string => typeof n === 'string') : []);
}

/** The Default Organization's suggestion rows, matching `where`. */
async function recordRows(ql: any, organizationId: string, where: Record<string, unknown>): Promise<any[]> {
  return (await tryFind(ql, SUGGESTION_OBJECT, where, 1000, organizationId)).filter((r) => ownedBy(r, organizationId));
}

/** One accepted set the derivation leaves out, and why. */
export interface WithheldAcceptance {
  set: string;
  packageId: string;
  reason: string;
  /** The set carries a bit the `everyone` anchor forbids (ADR-0090 D7). */
  forbidden: boolean;
}

/**
 * The derivation's input: the permission sets a `manage_metadata` holder
 * ACCEPTED for `everyone`, as the security catalog serves them now.
 *
 * An accepted row grants only while its set is served by the catalog under
 * the accepting package, still declares `isDefault: true`, and passes the
 * `everyone` anchor's high-risk gate (ADR-0090 D7, `describeAnchorForbiddenBits`
 * — the gate the acceptance itself ran, asked again of the definition as it
 * stands). A set failing any of these is WITHHELD and returned with its
 * reason, never dropped in silence: the caller reports it.
 *
 * Read errors propagate. An unreadable record is not an empty one, and the
 * caller decides what a derivation it could not complete leaves in force.
 */
export async function readAcceptedEveryoneSets(
  ql: any,
  metadata?: any,
): Promise<{ accepted: string[]; withheld: WithheldAcceptance[] }> {
  const out = { accepted: [] as string[], withheld: [] as WithheldAcceptance[] };
  const organizationId = await resolveDefaultOrganizationId(ql);
  if (!organizationId) return out;
  const rows = await ql.find(SUGGESTION_OBJECT, {
    where: { status: 'confirmed', anchor: EVERYONE_POSITION },
    limit: 1000,
    context: scopedSystemCtx(organizationId),
  });
  const accepted = (Array.isArray(rows) ? rows : []).filter((r) => ownedBy(r, organizationId) && isDeploymentDecision(r));
  if (accepted.length === 0) return out;
  const reader = securityCatalogReaderOf(ql);
  const capabilities = await readDeclaredCapabilityContext(ql, metadata);
  for (const row of accepted) {
    const set = String(row.permission_set_name);
    const packageId = String(row.package_id);
    const withhold = (reason: string, forbidden = false) => out.withheld.push({ set, packageId, reason, forbidden });
    const entry = await reader?.resolve('permission', set);
    if (!entry) { withhold('the security catalog serves no set of that name (package uninstalled or disabled)'); continue; }
    if (declaredOwnerOf(entry) !== packageId) { withhold(`the set is declared by '${declaredOwnerOf(entry) ?? 'no package'}' now`); continue; }
    if (entry.definition.isDefault !== true) { withhold('the set no longer declares isDefault: true'); continue; }
    const offending = describeAnchorForbiddenBits(entry.definition, EVERYONE_POSITION, capabilities);
    if (offending) { withhold(`it carries ${offending}, which the everyone anchor forbids (ADR-0090 D7)`, true); continue; }
    if (!out.accepted.includes(set)) out.accepted.push(set);
  }
  return out;
}

/**
 * [#12981] Report, ONCE per pass, the suggestion-row writes the store refused
 * — and answer how many of them were real.
 *
 * ## The classification is the point, not a detail
 *
 * Returns the `other`-class total and NOT `refusals.total`. On
 * `sys_audience_binding_suggestion` a `unique-violation` is the concurrent-sync
 * race the insert site has always documented as benign: the object's key is
 * (package_id, permission_set_name, anchor) scoped to the organization, so a
 * collision means another pass created the very row this one wanted and the end
 * state is correct. Reporting that as a degradation would be the
 * over-application AGENTS.md warns against, and it would fire on healthy
 * deployments that simply reconcile from two entry points at once (boot and a
 * package-door publish). The update and delete sites cannot produce that class
 * at all — both address a row by id and neither touches a keyed column — so
 * every refusal they contribute lands in `other` and is reported.
 *
 * ## Why `warn` and not `error`
 *
 * ⚠️ A decision, not an oversight, and the same one the `plugin-sharing`
 * repair recorded in this card's batch 1. AGENTS.md "Degradation log levels"
 * puts a report of this shape at `error`. The sink here is
 * `SuggestionDeps['logger']`, which is EXPORTED from this package's
 * `index.ts` and declares `warn` as optional. Adding `error?` to it would
 * enrol the type into `scripts/check-optional-error-sink-contract.mjs`'
 * population, which requires a NON-optional `warn` of any sink declaring
 * `error` — and making `warn` required on a published type is a contract call
 * above this repair. What this change fixes is the SILENCE, which needed no
 * contract; the LEVEL is recorded on #12981 for a `CONTRACT_REVIEW_TIER` seat.
 *
 * ⚠️ `check:durability-log-level` does not vouch for either choice: `ql.insert`
 * / `ql.update` / `ql.delete` are not in its `DURABILITY_CRITICAL_CALLEES`
 * vocabulary, so its green over this file means NOT MEASURED, never approval
 * (#12981's standing premise).
 */
function reportSuggestionWriteRefusals(
  logger: SuggestionDeps['logger'],
  refusals: SeedWriteRefusals,
  organizationId?: string,
): number {
  const entries = refusals.report();
  const real = entries.filter((e) => e.class !== 'unique-violation');
  const refused = real.reduce((n, e) => n + e.count, 0);
  if (refused === 0) return 0;
  const scope = organizationId ? { organization: organizationId } : {};
  const consequence =
    "those suggestion rows do NOT reflect the declarations. A refused CREATE leaves a declared " +
      "isDefault set with no suggestion at all, so no admin is ever prompted to accept it; a refused " +
      'OBSERVATION leaves a pending prompt over a set the everyone definition already names, so the ' +
      'console nags for a decision already made; a refused RE-OPEN leaves a decision a tenant ' +
      'administrator recorded standing where a manage_metadata holder should decide; a refused PRUNE ' +
      'leaves a pending prompt for a declaration that is GONE';
  logger?.warn?.(
    `[security] ${refused} sys_audience_binding_suggestion write(s) were REFUSED during the ` +
      `suggestion reconciliation — ${consequence}. ` +
      `THE DEPLOYMENT WILL GO ON LOOKING HEALTHY: this pass is convergent, so it reports what it ` +
      `wrote and nothing else fails. Refusals that were unique-constraint violations are EXCLUDED ` +
      `from this count on purpose — on this object that is the benign race with a concurrent ` +
      `reconciliation, which ends with the row present either way. What the store actually said is ` +
      `in the query engine's operation-failed entries logged just before this one, which keep the ` +
      `driver's own identifier with the bound statement and its values cut. Remedy: none by hand — ` +
      `the reconciliation is idempotent and re-runs at every boot, after each package-door ` +
      `permission publish and on every list, so a store that accepts writes again converges on the ` +
      `next pass. If this line repeats across boots the store is not accepting these writes at all, ` +
      `and that is a deployment defect to chase in those engine entries.`,
    { ...scope, refused, refusals: real },
  );
  return refused;
}


/**
 * Reconcile the deployment's `sys_audience_binding_suggestion` rows against
 * the current declarations and the `everyone` DEFINITION. Idempotent;
 * system-context, scoped to the Default Organization (module doc).
 *
 * Per declared set:
 *  - no row → `confirmed` (observed) when the definition already names the
 *    set — the deployment's baseline — else `pending`;
 *  - a row the deployment-level decision resolved → left as it is;
 *  - any other row → `confirmed` (observed) when the definition names the
 *    set, else `pending`: a pending row stays, and a row resolved before the
 *    acceptance was deployment-level is RE-OPENED.
 *
 * A pending row whose declaration is gone (uninstall, flag dropped) is
 * pruned; a decided one stays as audit history and grants nothing without
 * its declaration ({@link readAcceptedEveryoneSets}).
 *
 * Throws {@link SuggestionStateError} when something is declared and the
 * deployment has no Default Organization to own the rows.
 */
export async function syncAudienceBindingSuggestions(
  ql: any,
  logger?: SuggestionDeps['logger'],
): Promise<SuggestionSyncOutcome> {
  const out: SuggestionSyncOutcome = { created: 0, confirmedObserved: 0, pruned: 0, reopened: 0, refused: 0 };
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') return out;

  const declared = await collectDeclaredSuggestions(ql, logger);
  const organizationId = await resolveDefaultOrganizationId(ql);
  if (!organizationId) {
    if (declared.length === 0) return out;
    throw new SuggestionStateError(NO_RECORD_OWNER_MESSAGE);
  }

  // [#12981] ONE refusal log for the whole pass, reported once at the end.
  const refusals = createSeedWriteRefusals();
  const now = () => new Date().toISOString();
  const update = async (data: Record<string, unknown>, counter: 'confirmedObserved' | 'reopened') => {
    try {
      await ql.update(SUGGESTION_OBJECT, data, { context: scopedSystemCtx(organizationId) });
      out[counter] += 1;
    } catch (e) {
      refusals.record(SUGGESTION_OBJECT, e);
    }
  };

  const declaredKeys = new Set(declared.map((d) => suggestionKey(d.packageId, d.set.name, d.anchor)));
  const everyone = await everyoneDefinitionSets(ql);
  const existing = await recordRows(ql, organizationId, {});
  const byKey = new Map<string, any>(
    existing.map((row) => [suggestionKey(row.package_id, row.permission_set_name, row.anchor), row]),
  );

  for (const d of declared) {
    const row = byKey.get(suggestionKey(d.packageId, d.set.name, d.anchor));
    const observed = everyone.has(d.set.name);

    if (!row) {
      // [#7677] A declaration the definition already satisfies is recorded as
      // `confirmed` (observed) — `resolved_by` empty — rather than skipped,
      // so the stock baseline is surfaced and never offered as a prompt.
      try {
        await ql.insert(SUGGESTION_OBJECT, {
          id: genId('sug'),
          package_id: d.packageId,
          permission_set_name: d.set.name,
          anchor: d.anchor,
          status: observed ? 'confirmed' : 'pending',
          deployment_decision: false,
          ...(observed ? { resolved_at: now() } : {}),
        }, { context: scopedSystemCtx(organizationId) });
        out.created += 1;
      } catch (e) {
        // [#12981] The benign unique-index race with a concurrent sync is
        // classified (and excluded) by the accumulator; every other cause is
        // counted and reported.
        refusals.record(SUGGESTION_OBJECT, e);
      }
      continue;
    }

    if (isDeploymentDecision(row)) continue;
    if (observed) {
      if (row.status !== 'confirmed') {
        await update({ id: row.id, status: 'confirmed', resolved_by: null, resolved_at: now() }, 'confirmedObserved');
      }
    } else if (row.status !== 'pending') {
      await update({ id: row.id, status: 'pending', resolved_by: null, resolved_at: null }, 'reopened');
    }
  }

  // Prune PENDING rows whose declaration is gone (package uninstalled or the
  // flag dropped on upgrade). Decided rows stay as audit history.
  for (const row of existing) {
    if (row.status !== 'pending') continue;
    if (declaredKeys.has(suggestionKey(row.package_id, row.permission_set_name, row.anchor))) continue;
    try {
      await ql.delete(SUGGESTION_OBJECT, { where: { id: row.id }, context: scopedSystemCtx(organizationId) });
      out.pruned += 1;
    } catch (e) {
      refusals.record(SUGGESTION_OBJECT, e);
    }
  }

  out.refused = reportSuggestionWriteRefusals(logger, refusals, organizationId);
  if (out.created + out.confirmedObserved + out.pruned + out.reopened > 0 || out.refused > 0) {
    logger?.info?.('[security] audience-binding suggestions reconciled (ADR-0090 D5/D9)', {
      ...out, organization: organizationId,
    });
  }
  return out;
}

/**
 * The boot and package-publish entry point: one deployment-level
 * {@link syncAudienceBindingSuggestions}, plus a count of the rows it does not
 * read — owned by another organization, or by none, because a tenant
 * administrator confirmed per organization before the acceptance was
 * deployment-level. Those rows grant nothing (they never did), are never
 * promoted and are not deleted; the count is reported once per call so an
 * operator knows the decisions they hold were not carried over.
 */
export async function reconcileAudienceBindingSuggestions(
  ql: any,
  logger?: SuggestionDeps['logger'],
): Promise<SuggestionReconcileOutcome> {
  const out: SuggestionReconcileOutcome = {
    created: 0, confirmedObserved: 0, pruned: 0, reopened: 0, refused: 0, unread: 0,
  };
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') return out;
  Object.assign(out, await syncAudienceBindingSuggestions(ql, logger));

  const organizationId = await resolveDefaultOrganizationId(ql);
  // A bare system context is deliberate: it is the only scope that reads every
  // organization's rows, and this read only counts them.
  const unread = (await tryFind(ql, SUGGESTION_OBJECT, {}, 1000)).filter((r) => !ownedBy(r, organizationId ?? ''));
  out.unread = unread.length;
  if (unread.length > 0) {
    logger?.warn?.(
      `[security] ${unread.length} audience-binding suggestion row(s) are owned by an organization other than ` +
        'the Default Organization, or by none. They were confirmed or dismissed per organization by a tenant ' +
        'administrator, granted nothing then and grant nothing now, and are not read: the acceptance is ' +
        'deployment-level and only a manage_metadata holder makes it (ADR-0090 D5). Remedy: a manage_metadata ' +
        'holder — the platform operator under a wall — decides each suggestion once, in Setup.',
      { unread: unread.length, organizations: [...new Set(unread.map((r) => r?.organization_id ?? null))] },
    );
  }
  return out;
}

/**
 * The authority the whole surface requires: `manage_metadata` (#22621 → A —
 * definitions belong to metadata authors, and an acceptance changes what the
 * `everyone` definition derives to), and under a walled posture the platform
 * operator, read as the ADR-0095 posture rung (ADR-0126 §5's rule for an
 * install-wide row; never a position name). A tenant administrator is
 * refused. System self-invocation passes.
 */
function assertDeploymentAuthority(deps: SuggestionDeps, callerCtx: any, action: string): void {
  if (callerCtx?.isSystem) return;
  if (!callerCtx?.userId) {
    throw new PermissionDeniedError(
      `[Security] Access denied: ${action} requires an authenticated caller holding \`manage_metadata\` (ADR-0090 D5).`,
    );
  }
  const systemPermissions = callerCtx.systemPermissions;
  if (!Array.isArray(systemPermissions) || !systemPermissions.includes(METADATA_AUTHORING_CAPABILITY)) {
    throw new PermissionDeniedError(
      `[Security] Access denied: ${action} requires the \`manage_metadata\` capability. The acceptance is made ` +
        `once for the whole deployment, so a tenant administrator cannot make it (ADR-0090 D5).`,
      { userId: callerCtx.userId },
    );
  }
  const posture = deps.posture();
  if (posture && postureEnforcesWall(posture) && callerCtx.posture !== 'PLATFORM_ADMIN') {
    throw new PermissionDeniedError(
      `[Security] Access denied: ${action} decides what every signed-in member of every organization holds, and ` +
        `this deployment runs the '${posture}' tenancy posture, so it requires the platform operator (ADR-0126 §5).`,
      { userId: callerCtx.userId },
    );
  }
}

/** The Default Organization, or the loud refusal when there is none. */
async function requireRecordOwner(ql: any): Promise<string> {
  const organizationId = await resolveDefaultOrganizationId(ql);
  if (!organizationId) throw new SuggestionStateError(NO_RECORD_OWNER_MESSAGE);
  return organizationId;
}

/** One row of the record by id, or {@link SuggestionNotFoundError}. */
async function recordRow(ql: any, organizationId: string, id: string): Promise<any> {
  const row = (await recordRows(ql, organizationId, { id }))[0];
  if (!row) throw new SuggestionNotFoundError(id);
  return row;
}

/** List suggestions, reconciling first so a package installed a moment ago is
 *  already visible. Requires the deployment authority. */
export async function listAudienceBindingSuggestions(
  deps: SuggestionDeps,
  callerCtx: any,
  filter: SuggestionListFilter = {},
): Promise<{ suggestions: any[]; synced: SuggestionSyncOutcome }> {
  assertDeploymentAuthority(deps, callerCtx, 'listing audience-binding suggestions');
  const synced = await syncAudienceBindingSuggestions(deps.ql, deps.logger);
  const organizationId = await resolveDefaultOrganizationId(deps.ql);
  if (!organizationId) return { suggestions: [], synced };
  const where: Record<string, unknown> = {};
  if (filter.status) where.status = filter.status;
  if (filter.packageId) where.package_id = filter.packageId;
  return { suggestions: await recordRows(deps.ql, organizationId, where), synced };
}

/**
 * Accept a pending suggestion for the whole deployment: the set joins the
 * `everyone` anchor's derived definition (module doc).
 *
 * Refuses, before anything is written: a caller without the deployment
 * authority (403); a `guest`-anchor row (409 — the `guest` anchor's sets are
 * not derived from acceptances, so recording one would grant nothing); a set
 * the security catalog does not serve under the suggesting package, or that
 * no longer declares `isDefault` (409); a set carrying a bit the `everyone`
 * anchor forbids (403 — ADR-0090 D7's high-risk gate, on the definition).
 *
 * `bindingCreated` answers whether the `everyone` definition names the set
 * now and did not before — `false` when the baseline already named it.
 */
export async function confirmAudienceBindingSuggestion(
  deps: SuggestionDeps,
  callerCtx: any,
  id: string,
): Promise<{ suggestion: any; bindingCreated: boolean }> {
  const { ql } = deps;
  assertDeploymentAuthority(deps, callerCtx, 'accepting an audience-binding suggestion');
  const organizationId = await requireRecordOwner(ql);

  const row = await recordRow(ql, organizationId, id);
  if (row.status !== 'pending') {
    throw new SuggestionStateError(
      `Audience-binding suggestion '${id}' is already ${row.status} — only pending suggestions can be accepted.`,
    );
  }
  if (row.anchor !== EVERYONE_POSITION) {
    throw new SuggestionStateError(
      `Audience-binding suggestion '${id}' targets the '${row.anchor}' anchor, and only an 'everyone' suggestion ` +
        `can be accepted: the '${row.anchor}' anchor's sets are not derived from acceptances, so accepting it ` +
        `would record a grant that never takes effect.`,
    );
  }

  const entry = await securityCatalogReaderOf(ql)?.resolve('permission', row.permission_set_name);
  if (!entry) {
    throw new SuggestionStateError(
      `Permission set '${row.permission_set_name}' is not served by the security catalog — is package ` +
        `'${row.package_id}' still installed and enabled?`,
    );
  }
  const owner = declaredOwnerOf(entry);
  if (owner !== row.package_id) {
    throw new SuggestionStateError(
      `Permission set '${row.permission_set_name}' is declared by '${owner ?? 'no package'}', not the suggesting ` +
        `package '${row.package_id}' — refusing to accept it (ADR-0086 D4).`,
    );
  }
  if (entry.definition.isDefault !== true) {
    throw new SuggestionStateError(
      `Permission set '${row.permission_set_name}' no longer declares isDefault: true — nothing is suggested.`,
    );
  }
  // [ADR-0090 D7] The definition-side high-risk gate — the same predicate, and
  // the same declared-capability context, the derivation asks again on every
  // re-derive (`readAcceptedEveryoneSets`), so an accepted set cannot carry a
  // bit the derivation would then withhold.
  const offending = describeAnchorForbiddenBits(
    entry.definition,
    EVERYONE_POSITION,
    await readDeclaredCapabilityContext(ql, deps.metadata),
  );
  if (offending) {
    throw new PermissionDeniedError(
      `[Security] Access denied: permission set '${row.permission_set_name}' cannot be given to the ` +
        `'${EVERYONE_POSITION}' audience anchor — it carries ${offending} (ADR-0090 D5/D7).`,
      { suggestion: id, anchor: EVERYONE_POSITION },
    );
  }

  const before = await everyoneDefinitionSets(ql);
  await ql.update(SUGGESTION_OBJECT, {
    id: row.id,
    status: 'confirmed',
    deployment_decision: true,
    resolved_by: callerCtx?.userId ?? null,
    resolved_at: new Date().toISOString(),
  }, { context: scopedSystemCtx(organizationId) });
  await deps.rederiveEveryone();
  const bindingCreated = !before.has(row.permission_set_name)
    && (await everyoneDefinitionSets(ql)).has(row.permission_set_name);

  deps.logger?.info?.('[security] audience-binding suggestion accepted for the deployment (ADR-0090 D5)', {
    id: row.id, package: row.package_id, set: row.permission_set_name, anchor: row.anchor,
    by: callerCtx?.userId, bindingCreated,
  });
  return { suggestion: await recordRow(ql, organizationId, row.id), bindingCreated };
}

/**
 * Dismiss a pending suggestion, or REVOKE an accepted one — the set leaves the
 * `everyone` anchor's derived definition. Refuses a row the definition names
 * only through the baseline (`confirmed`, observed): this surface does not
 * decide the baseline. Requires the deployment authority.
 */
export async function dismissAudienceBindingSuggestion(
  deps: SuggestionDeps,
  callerCtx: any,
  id: string,
): Promise<{ suggestion: any }> {
  const { ql } = deps;
  assertDeploymentAuthority(deps, callerCtx, 'dismissing an audience-binding suggestion');
  const organizationId = await requireRecordOwner(ql);

  const row = await recordRow(ql, organizationId, id);
  const revoke = row.status === 'confirmed' && isDeploymentDecision(row);
  if (row.status !== 'pending' && !revoke) {
    throw new SuggestionStateError(
      row.status === 'confirmed'
        ? `Audience-binding suggestion '${id}' is observed, not accepted: the deployment's baseline gives the set ` +
          `to everyone, and this surface does not decide the baseline.`
        : `Audience-binding suggestion '${id}' is already ${row.status} — only a pending or accepted suggestion can be dismissed.`,
    );
  }

  await ql.update(SUGGESTION_OBJECT, {
    id: row.id,
    status: 'dismissed',
    deployment_decision: true,
    resolved_by: callerCtx?.userId ?? null,
    resolved_at: new Date().toISOString(),
  }, { context: scopedSystemCtx(organizationId) });
  if (revoke) await deps.rederiveEveryone();

  deps.logger?.info?.(`[security] audience-binding suggestion ${revoke ? 'revoked' : 'dismissed'} (ADR-0090 D5)`, {
    id: row.id, package: row.package_id, set: row.permission_set_name, by: callerCtx?.userId,
  });
  return { suggestion: await recordRow(ql, organizationId, row.id) };
}
