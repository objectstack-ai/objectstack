// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Injected-system-column derivation — the ONE answer to *"which columns does
 * the platform provision on THIS object without the author declaring them?"*
 * (#5378).
 *
 * ## Why this lives in the spec, next to the name registry
 *
 * `SystemFieldName` (`@objectstack/spec/system`) already carries an explicit
 * warning that it is a NAME registry and **not** the injected-column set: the
 * same name is a system column on one object and an ordinary business field on
 * another, so a consumer asking "does this object have `owner_id`?" must not
 * test membership in it. That warning names `applySystemFields()`
 * (`@objectstack/objectql`) as the per-object authority — and it is, for the
 * column *definitions*. But the authority was reachable **only** by running the
 * runtime registry, which author-time consumers (`@objectstack/lint`, whose
 * package contract is "depends on @objectstack/spec; never on a runtime")
 * cannot do. So they answered the question themselves, or not at all:
 *
 * - `packages/lint/src/system-fields.ts` answers it with a deliberately
 *   generous UNCONDITIONAL union of every system name — right for the rules
 *   that only need "never flag this name", wrong as a per-object answer;
 * - `buildFieldIndex` (`validate-expressions.ts`) and the `highlightFields`
 *   existence check did not answer it at all, so an expression referencing an
 *   injected-only column was rejected as an unknown field and a
 *   `highlightFields: ['owner_id']` entry warned — the platform's own linter
 *   telling an author that the platform's own column does not exist (#5378).
 *
 * This module is that answer, in the one place both a runtime and an
 * author-time tool can read. It is the same split #3786 established for the
 * audit family and the `AUDIT_FIELD_DEFS` table records: **the spec declares
 * WHICH columns exist; the registry owns the injection.** Here the spec
 * declares which ones exist *on a given object*; `applySystemFields` consumes
 * this plan when it injects. (The column DEFINITIONS — WHAT each one looks
 * like — and the #7865 provenance marker over them moved into the sibling
 * `injected-system-column-provenance.ts` by #8116, the WHAT-half move #3786
 * anticipated, so author-time tools can ask the storage question too.)
 *
 * ## Why it is a pure derivation, and where it is not author-time-total
 *
 * Every OBJECT input is a key the object itself declares — `systemFields`,
 * `managedBy`, `ownership`, `tenancy.enabled`, `name`. Measured against
 * `applySystemFields`, the `multiTenant` option changes only whether
 * `organization_id` is INDEXED, never whether it exists.
 *
 * There is exactly ONE deployment input, and it is explicit: the objects a
 * deployment declares platform-global (the second argument, the validated
 * reading of the mounted `org-scoping` service's
 * `OrgScopingEntitlement.platformGlobalObjects`). ADR-0131 D7: "an object a
 * deployment declares platform-global gets no organization column on that
 * deployment (the injected-columns plan reads the declaration), so Layer 0 and
 * the driver agree by having nothing to scope". The runtime registry passes it;
 * an author-time caller (the linter, the import mapper, the tenancy census)
 * has no deployment and passes nothing, so it reads the AUTHORED plan — the
 * one every deployment that declares nothing provisions. On the declaring
 * deployment alone, an author-time
 * verdict can therefore name an `organization_id` that deployment does not
 * have; the runtime refuses it there as an unknown field. Absent, empty or
 * refused (junk is refused at the reading seam, never coerced), the input
 * changes nothing: the plan is byte-identical to the one-argument call.
 *
 * Tolerant of bare / un-parsed metadata records (same contract as
 * {@link deriveFieldGroupLayout} / {@link deriveRecordSurface}) so every
 * consumer can call it, including on input that has not been through Zod.
 */

import { AUDIT_PROVENANCE_FIELDS } from './field-group-layout';
import { isTenancyDisabled } from './object.zod';

type AnyRec = Record<string, unknown>;

/**
 * The primary key. Provisioned by the DRIVER on every physical table
 * (`table.string('id').primary()`), not by the registry's system-field pass —
 * so it survives even `systemFields: false`, and is reported unconditionally by
 * {@link resolveInjectedSystemColumns}.
 */
const PRIMARY_KEY_COLUMN = 'id';

/** The reassignable record-owner column (a person). */
const OWNER_COLUMN = 'owner_id';
/** [ADR-0117 D1] The record-level owning-business-unit column. */
const OWNING_BUSINESS_UNIT_COLUMN = 'owning_business_unit_id';
/** THE tenant isolation key. */
const TENANT_SCOPE_COLUMN = 'organization_id';

/** Does the deployment's declaration name the object `name` platform-global? */
function deploymentDeclaresPlatformGlobal(
  declared: ReadonlySet<string> | readonly string[] | undefined,
  name: string,
): boolean {
  if (declared === undefined) return false;
  return declared instanceof Set ? declared.has(name) : (declared as readonly string[]).includes(name);
}

/**
 * Every name {@link resolveInjectedSystemColumns} can put in a plan's `names`,
 * on ANY object: the upper bound of the per-object answer, read off the same
 * constants the function adds. A compile-time consumer that cannot evaluate
 * the plan for a given object (the `defineSeed` record type) admits these
 * names, and leaves the per-object verdict to the plan at call time.
 *
 * The sync is the compiler's: the function builds `names` as a
 * `Set<InjectedSystemColumnName>`, so a column it starts adding without
 * widening this union is a compile error, not a second list that drifts.
 */
export type InjectedSystemColumnName =
  | typeof PRIMARY_KEY_COLUMN
  | typeof TENANT_SCOPE_COLUMN
  | (typeof AUDIT_PROVENANCE_FIELDS)[number]
  | typeof OWNER_COLUMN
  | typeof OWNING_BUSINESS_UNIT_COLUMN;

/**
 * Which system columns an object carries, as the four independent decisions the
 * injection pass makes plus the resolved name set.
 *
 * The flags exist because the registry needs them SEPARATELY (each governs a
 * different column definition, and the audit family additionally governs
 * platform-owned overrides on a *declared* audit field); `names` exists because
 * every author-time consumer wants exactly the set.
 */
export interface InjectedSystemColumnPlan {
  /** `organization_id` — the tenant scope anchor. */
  tenant: boolean;
  /** The {@link AUDIT_PROVENANCE_FIELDS} family. */
  audit: boolean;
  /** `owner_id` — a per-record human owner. */
  owner: boolean;
  /** `owning_business_unit_id` — [ADR-0117 D1] the org-unit ownership tier. */
  owningBusinessUnit: boolean;
  /**
   * Every column addressable on this object without being authored — the
   * columns the flags above select, plus the driver-provisioned primary key.
   *
   * Deliberately independent of what the object DOES declare: a declared
   * `owner_id` is the author's field and the registry lets it win, but the
   * column exists either way, so a consumer asking "is this name addressable"
   * gets the same answer. Consumers that need "authored vs injected" compare
   * against the object's own `fields`.
   */
  names: ReadonlySet<string>;
}

/**
 * Resolve the injected-system-column plan for one object definition.
 *
 * Mirrors — and is the single source consumed by — `applySystemFields`:
 *
 * | object declares                        | injected                                    |
 * |----------------------------------------|---------------------------------------------|
 * | `systemFields: false`                  | nothing (hard opt-out; seed/migration tables) |
 * | `managedBy: 'better-auth'`             | nothing (better-auth owns the columns)      |
 * | `systemFields.tenant: false` / `tenancy.enabled: false` | no `organization_id`        |
 * | its `name` in the deployment's `platformGlobalObjects` (2nd argument) | no `organization_id` |
 * | `systemFields.audit: false`            | no audit family                             |
 * | `managedBy: <any>` or a `sys_*` name   | no ownership anchors (either tier)          |
 * | `ownership: 'org' \| 'none'`           | no ownership anchors (either tier)          |
 * | `ownership: 'business_unit'`           | `owning_business_unit_id` but NOT `owner_id` |
 * | `ownership: 'user'` / omitted          | both ownership anchors                      |
 *
 * The ownership rows are a POSITIVE list, not a deny-list, for the reason
 * ADR-0117 D1 / #5677 record at the injection site: under a deny-list a NEW
 * ownership tier inherits `owner_id` by accident, which for a unit-owned tier
 * is the exact inverse of what it means.
 *
 * The `ownership: 'business_unit'` row was implemented here AHEAD of the
 * acceptance surface (#5677 before #5678), so that the tier's first appearance
 * would be judged by D1's table rather than by a deny-list default. #5678 has
 * since landed the enum member, so the row is now reachable from authored
 * metadata: `ObjectSchema`'s `ownership` enum reads
 * `'user' | 'business_unit' | 'org' | 'none'`. The `ownership` read below stays
 * typed on `string` rather than the enum — this function accepts any bare record
 * shaped like an object definition (`def: unknown`), including pre-parse input,
 * so it must not presume a Zod-narrowed value.
 *
 * @param def An object definition, or any bare record shaped like one.
 * @param deployment [ADR-0131 D7] The deployment's own input, when the caller
 *   has a deployment. `platformGlobalObjects` is the VALIDATED reading of the
 *   mounted `org-scoping` service's `OrgScopingEntitlement.platformGlobalObjects`
 *   (exact object machine names; a junk declaration is refused at the reading
 *   seam and arrives here as nothing). The registry is its one runtime caller;
 *   an author-time caller has no deployment and omits the whole argument.
 */
export function resolveInjectedSystemColumns(
  def: unknown,
  deployment?: { readonly platformGlobalObjects?: ReadonlySet<string> | readonly string[] },
): InjectedSystemColumnPlan {
  const obj: AnyRec = def && typeof def === 'object' && !Array.isArray(def) ? (def as AnyRec) : {};
  const systemFields = obj.systemFields;
  const managedBy = obj.managedBy;
  const name = typeof obj.name === 'string' ? obj.name : '';

  // The primary key is the driver's, not the injection pass's — it is present
  // even on the two "nothing is injected" rows below.
  const names = new Set<InjectedSystemColumnName>([PRIMARY_KEY_COLUMN]);
  const nothing: InjectedSystemColumnPlan = {
    tenant: false, audit: false, owner: false, owningBusinessUnit: false, names,
  };

  // 1. Hard opt-out at object level (e.g. seed/migration tables).
  if (systemFields === false) return nothing;
  // 2. better-auth managed tables: their column layout is driven by
  //    better-auth's own migrations, and extra columns would collide.
  if (managedBy === 'better-auth') return nothing;

  const sf =
    typeof systemFields === 'object' && systemFields !== null
      ? (systemFields as { tenant?: boolean; audit?: boolean })
      : undefined;

  // [ADR-0131 D7] The deployment's platform-global declaration withholds the
  // tenant column exactly where the object's own two opt-outs do: an object
  // THIS deployment declares platform-global has no organization column here.
  const tenant =
    sf?.tenant !== false &&
    !isTenancyDisabled(obj) &&
    !(name !== '' && deploymentDeclaresPlatformGlobal(deployment?.platformGlobalObjects, name));
  const audit = sf?.audit !== false;

  // Platform-managed tables and the `sys_*` namespace never carry a per-record
  // ownership anchor, whichever tier is declared.
  const ownershipEligible = !managedBy && !name.startsWith('sys_');
  // Widened to `string` on purpose (ADR-0117 D1 / #5677): this function takes
  // `unknown` and is called on pre-parse input as well as on parsed schemas, so
  // it reads the value rather than a Zod-narrowed enum. (It was ALSO how the
  // `business_unit` tier could be honoured before #5678 made it authorable.)
  const ownership: string | undefined =
    typeof obj.ownership === 'string' ? obj.ownership : undefined;

  const owner = ownershipEligible && (ownership === undefined || ownership === 'user');
  const owningBusinessUnit = owner || (ownershipEligible && ownership === 'business_unit');

  if (tenant) names.add(TENANT_SCOPE_COLUMN);
  if (audit) for (const f of AUDIT_PROVENANCE_FIELDS) names.add(f);
  if (owner) names.add(OWNER_COLUMN);
  if (owningBusinessUnit) names.add(OWNING_BUSINESS_UNIT_COLUMN);

  return { tenant, audit, owner, owningBusinessUnit, names };
}
