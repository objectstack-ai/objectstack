// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7521, found via cloud#1225] The authoring-time half of
// `reconcileManagedApiMethods` — a managed object may not advertise a generic
// write verb in `enable.apiMethods` that its own resolved affordances refuse.
//
// A pure `(stack) => Finding[]` rule (ADR-0019). All judgement lives in the
// SHARED predicate — `@objectstack/spec/data`'s
// `checkManagedApiMethodAffordances`, the same call objectql's registry makes
// when it strips the verb at registration — so this file is only the walk:
// where objects live in a stack, and how a predicate conflict becomes a lint
// finding with a location. If a verdict seems wrong, fix the predicate, never
// this walk. A second affordance table here would BE the declared≠enforced
// drift the rule exists to catch.
//
// ## Why an authoring-time rule when the registry already fixes it
//
// The registry's fix is real and fail-closed — it strips the verb, so nothing
// is ever exposed. What it cannot do is TELL anyone. `sys_environment` and
// `sys_package` declared `apiMethods: ['get','list','create','update']` against
// `userActions` that refused all three writes; the strip and its `console.warn`
// fired on every control-plane boot for the life of the divergence and nobody
// noticed. The split was found by hand-driving the HTTP seam while writing
// something else. A boot log is not an authoring surface: it is read after an
// incident, by an operator, in a repo whose author has long since moved on.
//
// This rule puts the same verdict where the author is standing, which is the
// #7521 ruling in one sentence. Boot behaviour is deliberately unchanged —
// still warn-and-strip, never fail-closed, so a metadata typo cannot kill a
// control-plane boot.
//
// Runs on the NORMALIZED (pre-parse) stack, like validate-functional-
// completeness: the finding must reach the author even when an unrelated schema
// error would stop the parse, and the predicate reads only authored keys
// (`managedBy`, `userActions`, `enable.apiMethods`) — no parse-time defaults.

import {
  checkManagedApiMethodAffordances,
  describeManagedApiMethodConflicts,
} from '@objectstack/spec/data';

/**
 * Stable diagnostic id. Named for the CONTRADICTION rather than for the strip,
 * because at authoring time nothing has been stripped yet — the declaration is
 * simply advertising something the object cannot honour.
 */
export const MANAGED_API_METHOD_UNAFFORDABLE = 'object/managed-api-method-unaffordable';

export interface ManagedApiMethodFinding {
  /**
   * Always `error`. The contradiction is decidable from the object's own
   * declaration — no call graph, no runtime state — and shipping it means the
   * metadata claims an API surface the registry will silently take away.
   */
  severity: 'error';
  rule: typeof MANAGED_API_METHOD_UNAFFORDABLE;
  /** Human-readable location, e.g. `object "sys_environment"`. */
  where: string;
  /** Config path, e.g. `objects[2].enable.apiMethods`. */
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Array-or-name-keyed-map collection → entries with a name and an index label. */
function entriesOf(v: unknown): Array<{ name: string; def: AnyRec; key: string }> {
  if (Array.isArray(v)) {
    return v.flatMap((def, i) =>
      isRec(def) ? [{ name: String(def.name ?? i), def, key: `[${i}]` }] : [],
    );
  }
  if (isRec(v)) {
    return Object.entries(v).flatMap(([name, def]) =>
      isRec(def) ? [{ name, def: { name, ...def }, key: `.${name}` }] : [],
    );
  }
  return [];
}

/**
 * Walk every object declaration in the stack through the shared
 * managed-affordance predicate.
 *
 * One finding per object, not per verb: an object declaring both `create` and
 * `update` against an all-locked bucket has ONE authoring mistake, and the fix
 * — open the affordances or drop the verbs — is a single edit.
 */
export function validateManagedApiMethods(stack: unknown): ManagedApiMethodFinding[] {
  const out: ManagedApiMethodFinding[] = [];
  if (!isRec(stack)) return out;

  for (const [oi, obj] of entriesOf(stack.objects).entries()) {
    const conflicts = checkManagedApiMethodAffordances(obj.def);
    if (conflicts.length === 0) continue;

    const verbs = conflicts.map((c) => c.verb).join(', ');
    const flags = [...new Set(conflicts.map((c) => c.needs))];
    out.push({
      severity: 'error',
      rule: MANAGED_API_METHOD_UNAFFORDABLE,
      where: `object "${obj.name}"`,
      path: `objects[${oi}].enable.apiMethods`,
      message:
        `\`managedBy: '${String(obj.def.managedBy)}'\` object "${obj.name}" ` +
        describeManagedApiMethodConflicts(conflicts) +
        ` The registry STRIPS [${verbs}] at registration, so this declaration and the API you ` +
        `actually get already disagree — today the only trace is a line in the boot log.`,
      hint:
        `Either add \`userActions: { ${flags.map((f) => `${f}: true`).join(', ')} }\` to the object ` +
        `— only if the write is genuinely one a user context may perform, and only once the guard ` +
        `enforcing it exists (ADR-0092 D4: affordance never ships ahead of the guard) — or remove ` +
        `[${verbs}] from \`enable.apiMethods\`, which is what the runtime does for you today.`,
    });
  }

  return out;
}
