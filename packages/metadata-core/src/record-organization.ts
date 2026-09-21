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
 * ⛔ The stamp-only divergence this resolver reads stays scope-pinned (#8778,
 * widened by name on cloud#1395): exactly THREE consumers are sanctioned —
 * audit stamping, the approval-row writer, and the automation-run recorder —
 * and no others. A fourth consumer needs its own maintainer ruling, exactly as
 * #8778 required. Sharing the implementation here does not open it: it closes
 * the excuse for a fourth copy.
 *
 * ⭐ [#19054] The divergence is no longer AUTHORABLE. It used to be declared by
 * the `tenancy.organizationField` spec key, which every application could write
 * and which the whole repository declared exactly once — on `sys_api_key`, a
 * table this platform ships. Protocol 18 retires the key (ADR-0049
 * enforce-or-remove) and moves the fact into
 * {@link PLATFORM_STAMP_ORGANIZATION_COLUMNS} below. Nothing about the three
 * writers' behaviour changes; what changes is that no application can put a
 * fourth spelling of "who is this row about" into the platform's mouth.
 *
 * ⭐ [#18378] This module answers TWO questions, and only the first consults
 * that table. {@link resolveRecordOrganizationField} is the STAMP answer ("who
 * is this row about"), consumers still the three above;
 * {@link resolveRecordWallOrganizationField} is the WALL answer ("what is this
 * row scoped by", and so which organization work launched from it acts as),
 * which skips limb 0 entirely. A caller of the second is not a fourth consumer
 * — it never reads the table — and the split is what keeps the scope-pin from
 * being widened by callers who only ever wanted the wall.
 *
 * A platform row is stamped from the organization the record is ABOUT (#8287's
 * ruling). To do that the writer has to know which column holds it, and
 * `organization_id` is not universally the answer: `sys_api_key` carries
 * `active_organization_id` by deliberate design (#8287). Hard-coding a second
 * literal name inside each writer would make every one of them correct for
 * exactly two objects and silently wrong for the third, so the question is
 * asked ONCE here — of the platform table for limb 0, and of the object's own
 * registered schema for limbs 1 to 4.
 */

import { isTenancyDisabled } from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';

/**
 * [#19054] Limb 0's whole population — the platform tables whose rows are ABOUT
 * an organization carried under a column that is deliberately NOT the tenant
 * column, keyed by the object's registered name.
 *
 * It replaces the authorable `tenancy.organizationField` key, retired from
 * `packages/spec` in protocol 18 (ADR-0049 enforce-or-remove; maintainer ruling
 * 2026-09-18, verbatim and untranslated: 「organizationField 撤出可授权面
 * 同意你的建议」). The key was authorable by every application and declared, in
 * the entire repository, exactly once — here. The spec's own docblock said why
 * it could never be more than that: on an ordinary object the stamp column and
 * the tenant column are the same column, so a declaration either restated the
 * default or asked for a divergence outside the three sanctioned writers. A
 * fact about one table we ship belongs in a table we ship.
 *
 * ⛔ Adding a row is a PROTOCOL decision, not a convenience. Each row is an
 * object whose platform rows are stamped from somewhere other than its wall,
 * which is exactly the divergence the #8778 / cloud#1395 rulings scope-pinned;
 * a new one needs its own ruling, the same bar a fourth consumer of the old key
 * needed. ⛔ And it is never a substitute for `tenancy.tenantField`: an object
 * whose tenant column genuinely is not `organization_id` declares that key,
 * which both walls it and stamps its platform rows (limb 2 below).
 *
 * `sys_api_key` is the one row and the reason the mechanism exists: it is
 * `managedBy: 'better-auth'`, so `resolveInjectedSystemColumns` bails before
 * tenancy is consulted and no `organization_id` is ever injected; the column it
 * really has is better-auth's `active_organization_id`. ⛔ Renaming that column
 * to `organization_id` is NOT the simplification it looks like — in this
 * platform "has an `organization_id` column" IS the wall, so the rename would
 * wall the credential table on an equality that excludes NULL and every
 * pre-#8287 key would vanish from its own owner's key list. That is the defect
 * #8287 exists to have removed.
 */
const PLATFORM_STAMP_ORGANIZATION_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  sys_api_key: 'active_organization_id',
});

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
 *  0. **A {@link PLATFORM_STAMP_ORGANIZATION_COLUMNS} row for this object,
 *     when the object really has that column.** The stamp-only divergence
 *     #8778's ruling introduced (option A; #8707's remaining half), carried
 *     since protocol 18 by the platform-internal table above instead of the
 *     retired authorable `tenancy.organizationField` key. It answers "which
 *     column says who this row is ABOUT" — a different question from "what is
 *     this object walled by", which is why it wins over every limb below, the
 *     ADR-0066 opt-out included: `sys_api_key` is `enabled: false` by
 *     necessity (the credential table must never be org-walled, #8287) and its
 *     trail must still follow the record's own organization even though no
 *     wall does. Honoured only when the column is really present, same #5315
 *     guard as limb 2. ⛔ Stamp-only cuts both ways: this limb is read by the
 *     THREE platform-row writers the cloud#1395 ruling names (audit,
 *     approvals, automation runs) — a fourth consumer, or any read path, needs
 *     its own ruling first.
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
 * #8778 (it was the object that motivated the divergence). Its column is still
 * not — and must never become — the object's tenant-scope column:
 * `tenancy.tenantField` feeds `applyTenantScope` / `injectTenantOnInsert`, so
 * declaring it there would wall the credential table on an equality that
 * excludes NULL — every pre-#8287 key would vanish from its own owner's
 * list, which is the defect #8287 exists to have removed.
 *
 * ⚠️ Limb 0 is keyed by the object's NAME since protocol 18, so this two-argument
 * face reads it off `objectDef.name` — a definition that carries no `name`
 * resolves limbs 1 to 4 only. That is not a degradation to design around: the
 * engine-bound face below ({@link createRecordOrganizationResolver}), which is
 * what all three sanctioned writers actually hold, passes the registered name it
 * was asked about and never depends on the definition carrying one.
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
  return resolveOrganizationField(objectDef, hasField, {
    objectName: objectNameOf(objectDef),
    readStampColumn: true,
  });
}

/**
 * [#18378] The WALL-side sibling: "which column is this object tenant-scoped
 * by?" — limbs 1 to 4 of the precedence above, with limb 0 deliberately NOT
 * consulted.
 *
 * ⭐ Same limbs from the same source, because the two questions differ in
 * exactly one place. "Which column says who this row is ABOUT" (stamping) and
 * "which column is this row WALLED by" (scope, and therefore the organization
 * work launched from the row acts as) coincide on every ordinary object, and
 * come apart only on a {@link PLATFORM_STAMP_ORGANIZATION_COLUMNS} row — which
 * is ONE shipped object, `sys_api_key`, whose whole point is that it is not
 * walled (#8287).
 *
 * ⛔ It does not read that table, and that is the contract rather than an
 * omission. The divergence stays pinned to the THREE platform-row writers the
 * cloud#1395 ruling names; a caller asking the WALL question is not a fourth
 * consumer of the stamp column, it is a caller of a different question. Reading
 * limb 0 here would take a row meaning "the audit trail should follow this
 * row's own organization even though nothing walls it" and turn it into an
 * ACTING IDENTITY — a sweep over `sys_api_key` would then launch runs acting as
 * an organization derived from an annotation that never meant "act as this".
 * These limbs resolve `null` there instead, and the caller takes the existing
 * `walled-posture` refusal at its first tenant-scoped write (ADR-0112), loudly
 * and by name.
 *
 * ⚠️ The twin of `@objectstack/objectql`'s `resolveTenantFieldName`, which says
 * the same of `SqlDriver.computeTenantField` — three spellings of one rule is
 * one too many, and this is the sinkable one (this package is `spec` + zod,
 * which is why the stamp resolver was sunk here at all). Converging them is its
 * own change with its own blast radius: #18378 adds no FOURTH spelling — it
 * shares limbs 1 to 4 with the stamp face below, pinned in this package's own
 * suite ("the two faces agree everywhere limb 0 is absent") — and leaves the
 * existing two where they are.
 *
 * ⛔ No cross-package parity pin is added here, deliberately and not by
 * oversight: `@objectstack/objectql` is registered in `check:test-source-alias`
 * as still resolving `@objectstack/metadata-core` through `dist/`, so a pin
 * living there would be a verdict about build state rather than about either
 * checkout — the passing-test failure that gate exists to catch. The
 * convergence, and the alias it needs, belong to the card that does it.
 */
export function resolveRecordWallOrganizationField(
  objectDef: unknown,
  hasField: (field: string) => boolean,
): string | null {
  return resolveOrganizationField(objectDef, hasField, {
    objectName: objectNameOf(objectDef),
    readStampColumn: false,
  });
}

/** The registered name a definition carries, when it carries one. */
function objectNameOf(objectDef: unknown): string | undefined {
  if (!objectDef || typeof objectDef !== 'object') return undefined;
  const name = (objectDef as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/**
 * The limbs themselves, in ONE place — `readStampColumn` selects limb 0 alone.
 *
 * A parameter rather than two bodies because limbs 1 to 4 are shared BY
 * CONTRACT: the precedence doc above states at length that a platform row's
 * stamp must agree with the wall the row is later read through. Two bodies
 * would let them answer differently on the day one of them is fixed, which is
 * the exact failure the promotion ruling was written against.
 */
function resolveOrganizationField(
  objectDef: unknown,
  hasField: (field: string) => boolean,
  { objectName, readStampColumn }: { objectName: string | undefined; readStampColumn: boolean },
): string | null {
  if (!objectDef || typeof objectDef !== 'object') return null;
  // Limb 0 — the platform's own stamp-only divergence (#8778, carried by
  // `PLATFORM_STAMP_ORGANIZATION_COLUMNS` since #19054) wins over everything,
  // the ADR-0066 opt-out below included: see the precedence doc above. Reached
  // by the three sanctioned platform-row writers and by nobody else.
  if (readStampColumn && objectName !== undefined) {
    const stampColumn = PLATFORM_STAMP_ORGANIZATION_COLUMNS[objectName];
    if (stampColumn !== undefined && hasField(stampColumn)) return stampColumn;
  }
  if (isTenancyDisabled(objectDef)) return null;
  const declared = (objectDef as { tenancy?: { tenantField?: unknown } }).tenancy?.tenantField;
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
  return createResolver(engine, true);
}

/**
 * [#18378] The WALL-side face, over the same glue — what a caller asking "which
 * organization does this record BELONG to, and therefore which one does work
 * launched from it act as" holds.
 *
 * Same memoization, same value reading, same best-effort posture as the stamp
 * face above; the one difference is which precedence it binds
 * ({@link resolveRecordWallOrganizationField}, i.e. limb 0 skipped). Built over
 * a shared builder rather than copied, for the reason the interface docblock
 * already gives: a per-caller copy of "read the resolved column off the record,
 * treating empty as absent" is where the next drift starts.
 */
export function createRecordWallOrganizationResolver(engine: unknown): RecordOrganizationResolver {
  return createResolver(engine, false);
}

/**
 * ⚠️ It passes the name it was ASKED about into limb 0, never
 * `objectDef.name`. The registered name is the thing the caller holds and the
 * thing the platform table is keyed by; a definition is free not to repeat it
 * (several engine doubles in this monorepo do not), and reading limb 0 off the
 * definition would make the stamp column depend on whether a schema echoes its
 * own name — a difference no caller can see and no test would state.
 */
function createResolver(
  engine: unknown,
  readStampColumn: boolean,
): RecordOrganizationResolver {
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
    const resolved = resolveOrganizationField(objectDef, (field) => hasField(objectName, field), {
      objectName,
      readStampColumn,
    });
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
