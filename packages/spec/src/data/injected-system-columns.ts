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
 * WHICH columns exist; the registry owns WHAT each one looks like.** Here the
 * spec declares which ones exist *on a given object*; `applySystemFields`
 * consumes this plan and keeps sole ownership of the column shapes.
 *
 * ## Why it is a pure derivation, and total
 *
 * Every input is a key the object itself declares — `systemFields`, `managedBy`,
 * `ownership`, `tenancy.enabled`, `name`. Nothing here depends on runtime state:
 * measured against `applySystemFields`, the `multiTenant` option changes only
 * whether `organization_id` is INDEXED, never whether it exists. That is what
 * makes an author-time verdict trustworthy — the linter and the registry cannot
 * disagree about a column's existence, because there is nothing left for them
 * to disagree about.
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
 */
export function resolveInjectedSystemColumns(def: unknown): InjectedSystemColumnPlan {
  const obj: AnyRec = def && typeof def === 'object' && !Array.isArray(def) ? (def as AnyRec) : {};
  const systemFields = obj.systemFields;
  const managedBy = obj.managedBy;
  const name = typeof obj.name === 'string' ? obj.name : '';

  // The primary key is the driver's, not the injection pass's — it is present
  // even on the two "nothing is injected" rows below.
  const names = new Set<string>([PRIMARY_KEY_COLUMN]);
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

  const tenant = sf?.tenant !== false && !isTenancyDisabled(obj);
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
