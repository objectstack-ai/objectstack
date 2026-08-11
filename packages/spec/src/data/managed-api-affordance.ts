// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The managed-object `apiMethods` ⊆ affordances predicate — ONE table, read by
 * the boot-time strip and by the authoring-time gate (#7521).
 *
 * ## What it decides
 *
 * A `managedBy` object that advertises a generic **write** verb in
 * `enable.apiMethods` while its resolved affordances refuse that write is
 * internally contradictory: the metadata says the API offers a verb the object
 * itself does not permit. That is ADR-0049's `declared != enforced` class,
 * stated entirely within one object's own declaration — no call graph, no
 * runtime state, so it is fully decidable at authoring time.
 *
 * ## Why the predicate lives here rather than at either consumer
 *
 * It has exactly two consumers, and they sit on opposite sides of a package
 * boundary that cannot be crossed in either direction:
 *
 *   - `reconcileManagedApiMethods` (`@objectstack/objectql`'s `registry.ts`) —
 *     the registration-time backstop that STRIPS the offending verbs and warns
 *     (ADR-0092 / ADR-0103). Deliberately warn-and-strip, never throw: a
 *     metadata typo must not kill a control-plane boot.
 *   - `validateManagedApiMethods` (`@objectstack/lint`) — the authoring-time
 *     gate that reports the same contradiction as a finding, at the layer where
 *     the author is present.
 *
 * `@objectstack/lint` depends on `@objectstack/spec` and, by its own stated
 * contract, **never on a runtime** — so it cannot import objectql's table; and
 * objectql must not depend on the lint package. Housing the judgement in spec —
 * beside {@link resolveCrudAffordances}, the affordance authority both sides
 * already read — is the only arrangement in which the rule exists once. It is
 * the same shape, and the same reason, as `checkFieldCompleteness`
 * (`@objectstack/spec/kernel`), which serves the registry's functional-
 * completeness warning and `@objectstack/lint`'s `validate-functional-
 * completeness` gate from one predicate (ADR-0078).
 *
 * If a verdict here seems wrong, fix it HERE. A second copy at either consumer
 * reintroduces precisely the declared≠enforced drift this predicate detects.
 *
 * ## The window it closes (#7521, found via cloud#1225)
 *
 * `sys_environment` and `sys_package` (both `managedBy: 'platform'` with
 * `userActions` create/edit/delete all `false`) declared
 * `apiMethods: ['get','list','create','update']`. The registry stripped
 * `create`/`update` correctly on every control-plane boot — and the
 * `console.warn` announcing it went unread for the life of the divergence. The
 * strip itself is fail-closed, so nothing was ever exposed; what was lost was
 * the SIGNAL. A boot log is not an authoring surface, and the split was
 * eventually found by hand-driving the HTTP seam, not by any gate.
 */

import { resolveCrudAffordances, type ServiceObject } from './object.zod';

/**
 * Generic-write `apiMethods` verbs mapped to the {@link resolveCrudAffordances}
 * flag each one needs. Read verbs (`get`/`list`/`search`/`history`/…) are
 * always permitted, so they are absent here and are never reported.
 *
 * ⚠️ Two orthogonal axes — do NOT merge this with the API-tightening table.
 * This table (verb → *affordance*) is the UI-intent axis: what a managed bucket
 * *offers*. The verb → *primitive* derivation that decides what the automatic
 * API *admits* lives in `./api-derivation` (`API_METHOD_DERIVATION` /
 * `resolveEffectiveApiMethods`, #3391). The identical-shaped
 * `WRITE_OP_AFFORDANCE` in plugin-security's `system-write-guard.ts` is the
 * runtime enforcement of this same UI-intent axis. The enum shrink (#3543)
 * DELIBERATELY kept the three tables separate — merging would blur a
 * UX-affordance concern into a security concern (ADR-0103).
 *
 * The `upsert`/`purge` keys survive the shrink: raw (un-parsed) whitelists may
 * still carry legacy verbs, and this predicate must keep covering them.
 */
export const MANAGED_WRITE_VERB_AFFORDANCE: Readonly<Record<string, 'create' | 'edit' | 'delete'>> =
  Object.freeze({
    create: 'create',
    update: 'edit',
    upsert: 'edit',
    delete: 'delete',
    purge: 'delete',
  });

/** One declared write verb an object's own resolved affordances refuse. */
export interface ManagedApiMethodConflict {
  /** The offending verb, exactly as declared in `enable.apiMethods`. */
  verb: string;
  /** The {@link CrudAffordances} flag that verb needs and does not have. */
  needs: 'create' | 'edit' | 'delete';
  /** Index of the offending entry within the declared `enable.apiMethods` array. */
  index: number;
}

/**
 * Every generic write verb `enable.apiMethods` declares that this object's
 * resolved affordances — bucket default plus `userActions` overrides, exactly
 * as {@link resolveCrudAffordances} computes them for the UI — do not grant.
 *
 * An empty result means the declaration is coherent. Reads are never reported.
 *
 * Scope, matching the registration-time backstop one-for-one so the two can
 * never disagree:
 *
 *   - **unmanaged objects are out of scope** — no `managedBy` means no bucket
 *     default to contradict, so nothing is judged;
 *   - a missing, non-array or empty `apiMethods` is out of scope — `undefined`
 *     means "unrestricted" and `[]` means "deny-all" (see `./api-derivation`);
 *     neither advertises anything to contradict.
 *
 * Conflicts are returned in declaration order, **one entry per offending
 * occurrence** rather than per distinct verb, so a caller rebuilding the
 * whitelist can filter by index without collapsing a duplicated entry.
 */
export function checkManagedApiMethodAffordances(schema: unknown): ManagedApiMethodConflict[] {
  if (!schema || typeof schema !== 'object') return [];
  const obj = schema as { managedBy?: unknown; enable?: { apiMethods?: unknown } };
  if (obj.managedBy == null) return [];

  const methods = obj.enable?.apiMethods;
  if (!Array.isArray(methods) || methods.length === 0) return [];

  const affordances = resolveCrudAffordances(schema as ServiceObject);
  const out: ManagedApiMethodConflict[] = [];
  for (const [index, verb] of methods.entries()) {
    if (typeof verb !== 'string') continue;
    const needs = MANAGED_WRITE_VERB_AFFORDANCE[verb];
    if (needs && !affordances[needs]) out.push({ verb, needs, index });
  }
  return out;
}

/**
 * The one sentence both consumers say about a conflict, so an operator who
 * greps a stripped verb out of a boot log and an author reading the lint
 * finding are told the same thing in the same words.
 *
 * States the CONTRADICTION only. Each consumer appends its own remedy, because
 * the honest remedy differs by where you are standing: at registration the verb
 * has already been taken away and the operator's next move is to find the
 * author, while at authoring time both doors — open the affordance, or drop the
 * verb — are still open.
 */
export function describeManagedApiMethodConflicts(
  conflicts: readonly ManagedApiMethodConflict[],
): string {
  const verbs = conflicts.map((c) => c.verb).join(', ');
  const flags = [...new Set(conflicts.map((c) => c.needs))].join('/');
  return (
    `advertises generic write verb(s) [${verbs}] in enable.apiMethods that its resolved ` +
    `affordances do not permit (needs userActions ${flags}) — see ADR-0092 / ADR-0103.`
  );
}
