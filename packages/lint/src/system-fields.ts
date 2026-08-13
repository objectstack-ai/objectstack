// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE answer to "which columns does the registry inject on (almost) every
 * object without them appearing in authored `fields`?" (#4330).
 *
 * Every field-resolving rule in this package needs that answer: a reference to
 * `created_at` or `owner_id` is authored against a real, addressable column
 * even though no object declares it, so flagging it would be the false finding
 * that makes authors stop trusting the linter (ADR-0072 D1). Before this
 * module, five rules each carried their own hand-copied list and had already
 * drifted from one another — the exact shape #3786 removed from the
 * audit-provenance family, rebuilt one package over.
 *
 * DERIVED from the spec's two declarations, so it cannot drift from them:
 *
 * - {@link FIELD_GROUP_SYSTEM_FIELDS} (`@objectstack/spec/data`) — audit
 *   provenance plus `organization_id` / `tenant_id` / `is_deleted` /
 *   `deleted_at`;
 * - {@link SystemFieldName} (`@objectstack/spec/system`) — the protocol-level
 *   ids: `id`, `owner_id`, `user_id` and the timestamp/tenant columns.
 *
 * The union is deliberately generous, because the cost asymmetry is the same
 * in every consumer: over-inclusion costs at worst a missed finding on a
 * `systemFields: false` object (rare); under-inclusion costs a false one.
 *
 * What does NOT belong here: names that are ordinary AUTHORED fields on most
 * objects (`name`, `owner`, `record_type`) or legacy physical spellings
 * (`_id`, `space`). A rule that deliberately exempts those keeps them in a
 * rule-local extension next to its reason — adding them here would silently
 * stop every other rule from catching a reference to a field the object
 * genuinely does not have.
 */

import {
  FIELD_GROUP_SYSTEM_FIELDS,
  resolveInjectedSystemColumns,
  unprovisionedInjectedColumns,
} from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';

/**
 * Registry-injected columns addressable at runtime without being authored in
 * `fields` — the union of the spec's two system-field declarations.
 *
 * OBJECT-INDEPENDENT by construction: it answers "could this name be a system
 * column anywhere", which is the right question for a rule that only ever needs
 * to NOT flag the name. A rule that must decide whether the column exists **on
 * one particular object** — because it resolves a reference, rather than
 * skipping one — wants {@link injectedColumnsFor} instead.
 */
export const SYSTEM_FIELDS: ReadonlySet<string> = new Set<string>([
  ...FIELD_GROUP_SYSTEM_FIELDS,
  ...Object.values(SystemFieldName),
]);

/**
 * The system columns addressable on ONE object without being authored (#5378).
 *
 * Delegates to the spec's `resolveInjectedSystemColumns` — the same derivation
 * the registry's `applySystemFields` consumes to decide what it injects — so an
 * author-time verdict about a column's existence cannot disagree with the
 * runtime that provisions it. ⛔ Never hand-copy the conditions here: a second
 * copy of "does `ownership: 'none'` get `owner_id`?" is the drift this indirection
 * exists to prevent, and it drifts silently (the wrong answer is a FALSE
 * diagnostic on valid metadata, or silence on a genuinely missing column).
 *
 * Use this — not {@link SYSTEM_FIELDS} — wherever the rule RESOLVES a field
 * reference. The two differ exactly where it matters: on `ownership: 'none'`
 * the platform injects no `owner_id`, so `record.owner_id` there is a real
 * defect that must still be reported.
 */
export function injectedColumnsFor(objectDef: unknown): ReadonlySet<string> {
  return resolveInjectedSystemColumns(objectDef).names;
}

/**
 * The injected columns THIS object registers with NO storage behind them
 * (#8116) — the #7865 provenance marker, in the per-object set shape lint
 * rules consume.
 *
 * Non-empty only for an ADR-0015 `external` object: the remote database owns
 * its schema, so the platform's injected anchors (`owner_id`,
 * `organization_id`, the audit family, …) exist in the registered schema and
 * nowhere else. A reference to one is still ADDRESSABLE — it resolves, so
 * {@link injectedColumnsFor} rightly includes it and the existence rules stay
 * silent — but a predicate or pointer over it can never produce a real value:
 * on SQLite the query silently degrades to constant-false (HTTP 200, zero
 * rows, no error). Existence and provenance are different questions; rules
 * that RESOLVE a reference ask the first, and should ALSO ask this one to warn.
 *
 * Delegates to the spec's `unprovisionedInjectedColumns` — the same derivation
 * the runtime guards converge on (#7833 / #7859 / #7858) — so the author-time
 * warning and the runtime's storage verdict cannot disagree. ⛔ Never hand-copy
 * the `external` predicate or the anchor identity check here; the drift is the
 * exact shape #8116 moved the derivation into the spec to prevent. An
 * author-DECLARED column of the same name is the author's (it maps a remote
 * column they vouch for — #7859's security direction) and is never in the set.
 */
export function unprovisionedInjectedColumnsFor(objectDef: unknown): ReadonlySet<string> {
  return new Set(unprovisionedInjectedColumns(objectDef));
}

/** Coerce an array-or-name-keyed-map collection to an array (name injected). */
function objectDefsOf(stack: unknown): Record<string, unknown>[] {
  if (!stack || typeof stack !== 'object') return [];
  const objects = (stack as { objects?: unknown }).objects;
  if (Array.isArray(objects)) return objects.filter((o): o is Record<string, unknown> => !!o && typeof o === 'object');
  if (objects && typeof objects === 'object') {
    return Object.entries(objects as Record<string, unknown>)
      .filter(([, def]) => !!def && typeof def === 'object')
      .map(([name, def]) => ({ name, ...(def as Record<string, unknown>) }));
  }
  return [];
}

/**
 * `objectName -> its unprovisioned injected anchors`, over a whole stack
 * (#8340) — the shape a rule that resolves references PER STACK consumes.
 *
 * Only non-empty entries are stored, so `get(name)` is `undefined` for every
 * ordinary (platform-provisioned) object and the lookup doubles as the
 * "nothing to say here" fast path — the same shape `validate-expressions.ts`
 * built inline for #8116.
 *
 * ⛔ Not a replacement for {@link SYSTEM_FIELDS} at the call sites that consume
 * it. The blanket union answers "could this name be a system column anywhere",
 * which is the right question for a rule deciding whether to FLAG a name; this
 * index answers "does this object's registered anchor have storage", which is a
 * question about a name the first one already decided NOT to flag. The four
 * filter/binding rules ask both: membership still governs the existence
 * error, and this governs an additional warning on the path where the existence
 * check stays silent.
 */
export function indexUnprovisionedAnchors(stack: unknown): ReadonlyMap<string, ReadonlySet<string>> {
  const index = new Map<string, ReadonlySet<string>>();
  for (const obj of objectDefsOf(stack)) {
    const name = typeof obj.name === 'string' && obj.name.length > 0 ? obj.name : undefined;
    if (!name) continue;
    const anchors = unprovisionedInjectedColumnsFor(obj);
    if (anchors.size > 0) index.set(name, anchors);
  }
  return index;
}

/**
 * The CAUSE clause every unprovisioned-anchor diagnostic in this package
 * states — one sentence, one wording, across the four filter/binding rules
 * #8340 wired (`validate-widget-bindings`, `validate-react-page-props`,
 * `validate-page-field-bindings`, `validate-flow-template-paths`).
 *
 * Shared rather than re-typed because the sentence is the finding's whole
 * evidentiary content: it names the column, the object, WHY the platform
 * registered an anchor it did not provision (ADR-0015 federation), and it is
 * the part an author checks against their remote schema. A rule that re-words
 * it drifts from the others and, worse, from the runtime guards
 * (#7833 / #7859 / #7858) whose verdict it reports. Each call site supplies its
 * own POSITION prefix and its own CONSEQUENCE clause — those genuinely differ
 * per surface (a filter degrades to constant-false, a display binding renders
 * blank, an interpolated flow token drops the condition outright).
 *
 * #8116's two originals (`warnUnprovisionedAnchors` in `validate-expressions.ts`
 * and `unprovisionedPointer` in `validate-semantic-roles.ts`) still carry their
 * own copies of this sentence; they are the convergence target when either is
 * next touched, and were left alone here because #8340's file surface stops at
 * the filter/binding rules.
 */
export function unprovisionedAnchorCause(objectName: string, field: string): string {
  return (
    `'${field}' is an injected system column with NO storage behind it: '${objectName}' is an ` +
    `external object (ADR-0015), so the remote database owns its schema and the platform ` +
    `registers this anchor without provisioning a column`
  );
}

/**
 * The FIX clause paired with {@link unprovisionedAnchorCause} — the two ways
 * out, in the order an author should consider them: vouch for the remote column
 * by declaring it, or stop referencing an anchor this object does not have.
 */
export function unprovisionedAnchorHint(objectName: string, field: string): string {
  return (
    `If the remote table really carries '${field}', declare it in ${objectName}'s own fields ` +
    `(mapped through the external binding's columnMap) so the reference resolves to a column ` +
    `you vouch for; otherwise drop the reference, or opt the object out of the injection ` +
    `(\`ownership: 'none'\` for the ownership anchors, \`systemFields: { audit: false }\` for ` +
    `the audit family).`
  );
}
