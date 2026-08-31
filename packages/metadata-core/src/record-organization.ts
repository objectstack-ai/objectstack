// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8707 / #10101] The shared platform-row organization resolver — "which
 * column carries THIS object's own organization?", resolved from the object's
 * REGISTERED schema, never hard-coded to one spelling.
 *
 * Sunk here from `@objectstack/plugin-audit` (#10101) by the same criterion as
 * the engine dispatch predicates (#5619) and the metadata-plane FLS projection
 * (ADR-0106): the consumers live in three packages that share no other common
 * home (`plugin-audit`, `plugin-approvals`, `service-automation`), and
 * `@objectstack/metadata-core` depends on `{ @objectstack/spec, zod }` only,
 * so all three can import it with no new edge and no cycle. A per-writer copy
 * of this resolution is precisely the disease the promotion ruling exists to
 * end — two platform tables answering "whose row is this?" two ways.
 *
 * ## The ruling this promotion implements (maintainer, 2026-08-17, cloud#1395)
 *
 * > Ruled: Option A — extend the #8778 ruling: `resolveRecordOrganizationField`
 * > is promoted to a shared resolver used by all three platform-row writers
 * > (approvals, automation runs, audit). A platform row's organization is the
 * > SUBJECT record's organization; actor context is the fallback, never the
 * > primary.
 *
 * ⛔ The `tenancy.organizationField` key this resolver reads stays scope-pinned
 * (#8778, widened by name on cloud#1395 — the annotation beside the key in
 * `packages/spec/src/data/object.zod.ts` transcribes the ruling): exactly THREE
 * consumers are sanctioned — audit stamping, the approval-row writer, and the
 * automation-run recorder — and no others. A fourth consumer needs its own
 * maintainer ruling before reading the key, exactly as #8778 required. Sharing
 * the implementation here does not open the key: it closes the excuse for a
 * fourth copy.
 *
 * A platform row is stamped from the organization the record is ABOUT (#8287's
 * ruling). To do that the writer has to know which column holds it, and
 * `organization_id` is not universally the answer: `sys_api_key` carries
 * `active_organization_id` by deliberate design (#8287). Adding a second
 * literal name beside the first would make a writer correct for exactly two
 * objects and silently wrong for the third, so the question is asked of the
 * schema instead.
 */

import { isTenancyDisabled } from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';

/**
 * "Does this object's REGISTERED schema declare this field?", memoized per
 * object.
 *
 * Extracted to module scope (#8144), and sunk here from plugin-audit's
 * `audit-writers.ts` (#10101), so every consumer asks the question ONE way. The
 * audit CRUD writer and the auth-event writer stamp the same two conditional
 * columns on the same table, and a second hand-rolled probe would answer
 * differently on the day one of them is fixed.
 *
 * Why the probe exists at all — and what has changed under it. It was built
 * for a posture-conditional `organization_id`: the SchemaRegistry used to
 * auto-inject the column only in multi-tenant mode (`applySystemFields({
 * multiTenant })`), so on a single-tenant stack the `sys_audit_log` /
 * `sys_activity` tables had no such column. Unconditionally stamping it there
 * made every audit INSERT fail with "table sys_audit_log has no column named
 * organization_id" — and the error was swallowed, so audit logging was silently
 * non-functional.
 *
 * ⚠️ That premise no longer holds. The `organization_id` COLUMN is provisioned
 * UNCONDITIONALLY, subject only to the explicit opt-outs (`systemFields:
 * false`, `systemFields.tenant: false`, `managedBy: 'better-auth'`,
 * `tenancy.enabled: false`); the multi-tenant flag now governs only whether the
 * column is INDEXED, never whether it EXISTS. Three sources agree:
 * `applySystemFields` says so at the injection site
 * (`objectql/src/registry.ts`); the derivation it consumes
 * (`resolveInjectedSystemColumns`, `spec/src/data/injected-system-columns.ts`)
 * takes no `multiTenant` input to decide with; and
 * `objectql/src/registry-tenancy-posture.test.ts` pins it executably. Both
 * tables named above resolve the column on every posture.
 *
 * The stale sentence is corrected rather than dropped, because it is the stated
 * REASON for this probe and read literally it now invites two wrong moves:
 * ⛔ deleting the probe as dead once someone checks the column is always
 * provisioned, and ⛔ hand-rolling a fresh posture-conditional probe elsewhere
 * on the premise it used to carry. (`sql-driver.ts`'s `applyTenantScope`
 * docstring names the class: "which is exactly how a docstring becomes the last
 * place a wrong fact survives.")
 *
 * The probe never read the flag, and it still has work. What it answers is
 * PROVENANCE, not posture: the column is absent exactly where this process does
 * not provision it — an ADR-0015 `external` object, the explicit opt-outs
 * above, and (next paragraph) an engine with no `getSchema`. Resolve the field
 * set lazily from the engine schema and cache it; object schemas are static
 * after registration.
 *
 * Best-effort in both directions: an engine with no `getSchema` (an in-memory
 * test double) reports every field absent, which skips the stamp rather than
 * failing the write.
 */
export function createFieldPresenceProbe(
  engine: unknown,
): (objectName: string, field: string) => boolean {
  const fieldSetCache = new Map<string, Set<string> | null>();
  return (objectName: string, field: string): boolean => {
    let set = fieldSetCache.get(objectName);
    if (set === undefined) {
      set = null;
      try {
        const schema: any =
          typeof (engine as any)?.getSchema === 'function' ? (engine as any).getSchema(objectName) : null;
        const fields = schema?.fields;
        if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
          set = new Set<string>(Object.keys(fields));
        } else if (Array.isArray(fields)) {
          set = new Set<string>(fields.map((f: any) => f?.name).filter(Boolean));
        }
      } catch {
        /* ignore — best-effort; absence just means we skip the stamp */
      }
      fieldSetCache.set(objectName, set);
    }
    return set != null && set.has(field);
  };
}

/**
 * [#8707] "Which column carries THIS object's own organization?" — resolved
 * from the object's REGISTERED schema, never hard-coded to one spelling.
 *
 * ## Precedence — deliberately the platform's own, not a second opinion
 *
 * It mirrors `SqlDriver.computeTenantField` step for step, because that is the
 * platform's single existing answer to "which column is this object
 * tenant-scoped by", and a platform row's stamp must agree with the wall the
 * row will later be read through. Re-derived here rather than imported: that
 * method is `protected` on a DRIVER class, and this package takes no driver
 * dependency (its contract is `@objectstack/spec` + zod only). The two shared
 * inputs ARE imported — `isTenancyDisabled` (ADR-0066's single source of truth
 * for the opt-out) and `SystemFieldName.ORGANIZATION_ID` — so the parts that
 * could drift are one definition, and only the ordering is restated.
 *
 *  0. **Declared `tenancy.organizationField`, when the object really has that
 *     field.** The read-neutral, STAMP-ONLY declaration #8778's ruling added
 *     for exactly this consumer (option A; #8707's remaining half). It
 *     answers "which column says who this row is ABOUT" — a different
 *     question from "what is this object walled by", which is why it wins
 *     over every limb below, the ADR-0066 opt-out included: an author who
 *     declares it on an unwalled object (`sys_api_key`, `enabled: false` by
 *     necessity — the credential table must never be org-walled, #8287) is
 *     stating precisely that the trail should follow the record's own
 *     organization even though no wall does. Honoured only when the field is
 *     really present, same #5315 guard as limb 2. ⛔ Stamp-only cuts both
 *     ways: the key's consumers are pinned to the THREE platform-row writers
 *     the cloud#1395 ruling names (audit, approvals, automation runs) — a
 *     fourth consumer, or any read path, needs its own ruling first.
 *  1. **`tenancy.enabled === false` → `null`.** ADR-0066 platform-global
 *     objects (`sys_sso_provider` is the shipped example) keep an optional org
 *     FK while explicitly NOT being tenant-scoped. Stamping a platform row from
 *     that FK would scope a global object's trail into one organization
 *     and hide it from the platform admin who acted — strictly LESS visible
 *     than today. This limb is what keeps the precedence flip from trading one
 *     invisibility for another; it is not an optimisation.
 *  2. **Declared `tenancy.tenantField`, when the object really has that
 *     field.** The spec key already exists for "this object's tenant column
 *     genuinely is not the platform's" and the driver already honours it, so an
 *     object that declares one gets its platform rows stamped from the same
 *     column its rows are walled by. Honoured only when the field is really
 *     present — the same guard `computeTenantField` applies, for the same
 *     reason (#5315: a declared name pointing at a missing column must fall
 *     through, not resolve to nothing).
 *  3. **The canonical injected `organization_id`, when present.** What every
 *     multi-tenant object gets from `applySystemFields`.
 *  4. Otherwise `null` — the object has no organization of its own, and the
 *     caller falls back to the acting session's tenant exactly as before.
 *
 * ## What it deliberately does NOT do
 *
 * ⛔ It does not scan for "a lookup whose `reference` is `sys_organization`".
 * That derivation is FALSIFIED by a shipped object: `sys_organization` itself
 * declares no `organization_id` and exactly one such lookup —
 * `parent_organization_id` — so the scan would stamp every organization's audit
 * rows with its PARENT's id, hiding them from the very tenant they concern.
 * Worse, reading `parent_organization_id` for a visibility decision is an
 * ADR-0105 D6 red line that `validateOrgAxisRedLines` (@objectstack/lint) makes
 * a build error for RLS policies, sharing rules and scopes; a plugin reaching
 * the same conclusion through a heuristic is the same mistake with no gate on
 * it.
 *
 * `sys_api_key.active_organization_id` is reachable through limb 0 since
 * #8778 (it was the object that motivated the key). Its column is still not —
 * and must never become — the object's tenant-scope column:
 * `tenancy.tenantField` feeds `applyTenantScope` / `injectTenantOnInsert`, so
 * declaring it there would wall the credential table on an equality that
 * excludes NULL — every pre-#8287 key would vanish from its own owner's
 * list, which is the defect #8287 exists to have removed.
 *
 * @param objectDef the registered object definition (`engine.getSchema(name)`)
 * @param hasField the memoized field-presence probe for the SAME object — the
 *   platform asks "does the schema declare this field?" exactly one way
 *   ({@link createFieldPresenceProbe}), and a second hand-rolled shape check
 *   here would answer differently on the day one of them is fixed.
 */
export function resolveRecordOrganizationField(
  objectDef: unknown,
  hasField: (field: string) => boolean,
): string | null {
  if (!objectDef || typeof objectDef !== 'object') return null;
  const tenancy = (objectDef as { tenancy?: { organizationField?: unknown; tenantField?: unknown } }).tenancy;
  // Limb 0 — the explicit stamp-only declaration (#8778) wins over everything,
  // the ADR-0066 opt-out below included: see the precedence doc above.
  const stampField = tenancy?.organizationField;
  if (typeof stampField === 'string' && stampField.length > 0 && hasField(stampField)) return stampField;
  if (isTenancyDisabled(objectDef)) return null;
  const declared = tenancy?.tenantField;
  if (typeof declared === 'string' && declared.length > 0 && hasField(declared)) return declared;
  if (hasField(SystemFieldName.ORGANIZATION_ID)) return SystemFieldName.ORGANIZATION_ID;
  return null;
}

/**
 * The memoized, engine-bound face of {@link resolveRecordOrganizationField} —
 * what a platform-row WRITER actually holds. One instance per engine wraps the
 * column resolution (memoized per object; object schemas are static after
 * registration) and the value read, so the three sanctioned writers share the
 * glue as well as the precedence: a per-writer copy of "read the resolved
 * column off the record, treating empty as absent" is where the next drift
 * starts.
 *
 * `organizationOf` reads the resolved column off each candidate record in
 * order and returns the first non-empty string — the SUBJECT record's own
 * organization. It answers `null` when the object has no organization of its
 * own, when no candidate carries a value, or when the engine exposes no
 * `getSchema` (an in-memory test double): in every one of those cases the
 * caller falls back to the acting context, which is the ruled fallback — never
 * the primary.
 */
export interface RecordOrganizationResolver {
  /** Memoized column answer for one object; `null` = no organization of its own. */
  organizationFieldFor(objectName: string): string | null;
  /** First non-empty value of the resolved column across `records`, else `null`. */
  organizationOf(objectName: string, ...records: Array<unknown>): string | null;
}

/**
 * Build a {@link RecordOrganizationResolver} over an engine-like object. The
 * `engine` is probed structurally for `getSchema(objectName)` — the same
 * best-effort posture as {@link createFieldPresenceProbe}, and deliberately so:
 * a double without `getSchema` resolves nothing, so writers keep their acting-
 * context fallback instead of failing the write.
 */
export function createRecordOrganizationResolver(engine: unknown): RecordOrganizationResolver {
  const hasField = createFieldPresenceProbe(engine);
  const columnCache = new Map<string, string | null>();
  const organizationFieldFor = (objectName: string): string | null => {
    const hit = columnCache.get(objectName);
    if (hit !== undefined) return hit;
    let objectDef: unknown = null;
    try {
      objectDef =
        typeof (engine as any)?.getSchema === 'function' ? (engine as any).getSchema(objectName) : null;
    } catch {
      /* ignore — best-effort; absence just means the caller falls back */
    }
    const resolved = resolveRecordOrganizationField(objectDef, (field) => hasField(objectName, field));
    columnCache.set(objectName, resolved);
    return resolved;
  };
  const organizationOf = (objectName: string, ...records: Array<unknown>): string | null => {
    const column = organizationFieldFor(objectName);
    if (!column) return null;
    for (const record of records) {
      if (!record || typeof record !== 'object') continue;
      const value = (record as Record<string, unknown>)[column];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return null;
  };
  return { organizationFieldFor, organizationOf };
}
