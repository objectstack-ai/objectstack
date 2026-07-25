// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time guardrail for seed values that fall outside an object's declared
// state machine (framework#3433 follow-up).
//
// #3433 made seed writes EXEMPT from the `state_machine` validation rule — a
// curated seed is an established fact, so it may be born mid-lifecycle
// (a `completed` project, a `closed_won` opportunity) without the FSM entry
// guard rejecting it. That exemption is deliberate, but it is also a SILENT
// back door: the state machine's "is this value even a state I know about?"
// check no longer runs for seed rows. A field-level `select` still rejects a
// value outside its `options` at write time, so a plain typo is caught there —
// but a `state_machine` on a free-text field, or a value that is a valid option
// yet not a declared FSM state, now sails straight through.
//
// This author-time rule re-adds that safety net WITHOUT re-imposing the FSM: a
// seeded value need not be an initial state (that is the whole point of the
// exemption), but it must be a state the machine DECLARES — the union of
// `initialStates`, the transition-map keys, and the transition targets.
// Anything else is almost certainly a typo or an FSM that forgot to declare the
// state; either way the author should see it before boot.
//
// Advisory (warning): a curated value the FSM does not know about is suspicious
// but not necessarily wrong. Located fix-it, not a hard `os compile` gate —
// symmetric with the replay-safety rule (framework#3434).

export type SeedStateMachineSeverity = 'warning';

export interface SeedStateMachineFinding {
  severity: SeedStateMachineSeverity;
  rule: string;
  /** Human-readable location, e.g. `seed "showcase_project" ("Legacy Sunset")`. */
  where: string;
  /** Config path, e.g. `data[4].records[3].status`. */
  path: string;
  message: string;
  hint: string;
}

// Rule id (registry entry).
export const SEED_VALUE_OUTSIDE_STATE_MACHINE = 'seed-value-outside-state-machine';

type AnyRec = Record<string, unknown>;

interface FsmRule {
  field: string;
  /** Every state the machine declares: initialStates ∪ transition keys ∪ targets. */
  states: Set<string>;
}

/**
 * Collect the `state_machine` rules (field + full declared-state set) for every
 * object, keyed by object name. An object with no such rule contributes nothing.
 * The declared-state set is derived from the rule alone so the check does not
 * depend on the field's `options` shape (and so it covers free-text state
 * fields the enum validator never sees).
 */
function fsmRulesByObject(objects: AnyRec[]): Map<string, FsmRule[]> {
  const map = new Map<string, FsmRule[]>();
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name) continue;
    const validations = Array.isArray(obj.validations) ? (obj.validations as AnyRec[]) : [];
    const rules: FsmRule[] = [];
    for (const v of validations) {
      if (!v || typeof v !== 'object' || v.type !== 'state_machine') continue;
      const field = typeof v.field === 'string' ? v.field : undefined;
      if (!field) continue;
      const transitions =
        v.transitions && typeof v.transitions === 'object' ? (v.transitions as Record<string, unknown>) : {};
      const states = new Set<string>();
      for (const s of Array.isArray(v.initialStates) ? v.initialStates : []) states.add(String(s));
      for (const from of Object.keys(transitions)) {
        states.add(String(from));
        const targets = transitions[from];
        for (const to of Array.isArray(targets) ? targets : []) states.add(String(to));
      }
      // A state_machine with neither transitions nor initialStates declares no
      // states — nothing to check against, so skip it (never flag every value).
      if (states.size > 0) rules.push({ field, states });
    }
    if (rules.length > 0) map.set(name, rules);
  }
  return map;
}

/** Best-effort label for a seed record — its externalId value(s), else its index. */
function recordLabel(record: AnyRec, externalId: unknown, index: number): string {
  const keys = Array.isArray(externalId)
    ? (externalId as unknown[]).map(String)
    : typeof externalId === 'string'
      ? [externalId]
      : ['name'];
  const parts = keys.map((k) => record[k]).filter((v) => v != null && v !== '');
  return parts.length > 0 ? parts.map(String).join(' · ') : `#${index}`;
}

/**
 * Flag every seed record whose `state_machine`-governed field carries a value
 * the machine does not declare (framework#3433 follow-up). Returns the findings
 * (empty = clean). The caller decides how to surface them; the CLI folds them in
 * as advisory warnings.
 *
 * Reads `stack.objects` (for the state-machine rules) and `stack.data` (the
 * `SeedSchema[]` fixtures). Safe on any shape — a stack with no objects or no
 * `data` array yields no findings. A value that is not a plain string (an
 * unresolved `cel` Expression envelope, a number) is skipped: it cannot be
 * statically compared to the declared-state set.
 */
export function validateSeedStateMachine(stack: AnyRec): SeedStateMachineFinding[] {
  const out: SeedStateMachineFinding[] = [];
  const objects = Array.isArray(stack.objects) ? (stack.objects as AnyRec[]) : [];
  const seeds = Array.isArray(stack.data) ? (stack.data as AnyRec[]) : [];
  if (objects.length === 0 || seeds.length === 0) return out;

  const rulesByObject = fsmRulesByObject(objects);
  if (rulesByObject.size === 0) return out;

  seeds.forEach((seed, i) => {
    if (!seed || typeof seed !== 'object') return;
    const objectName = typeof seed.object === 'string' ? seed.object : undefined;
    if (!objectName) return;
    const rules = rulesByObject.get(objectName);
    if (!rules) return;
    const records = Array.isArray(seed.records) ? (seed.records as AnyRec[]) : [];

    records.forEach((record, j) => {
      if (!record || typeof record !== 'object') return;
      for (const rule of rules) {
        const value = record[rule.field];
        // Absent / cleared → nothing to check. A non-string (Expression
        // envelope, number) can't be compared statically → skip.
        if (value == null || value === '') continue;
        if (typeof value !== 'string') continue;
        if (rule.states.has(value)) continue;

        out.push({
          severity: 'warning',
          rule: SEED_VALUE_OUTSIDE_STATE_MACHINE,
          where: `seed "${objectName}" (${recordLabel(record, seed.externalId, j)})`,
          path: `data[${i}].records[${j}].${rule.field}`,
          message:
            `seeds '${rule.field}=${value}', which the '${objectName}' state machine does not declare ` +
            `(known states: ${[...rule.states].sort().join(', ')}). Seed writes are exempt from the ` +
            'state_machine rule (#3433), so this is NOT rejected at write time — a typo lands silently.',
          hint:
            `If '${value}' is a real state, add it to the state machine (as an initial state or a ` +
            `transition endpoint). If it is a typo, correct it to a declared state. The exemption lets ` +
            'a seed be born mid-lifecycle; it is not a licence to write an unknown state.',
        });
      }
    });
  });

  return out;
}
