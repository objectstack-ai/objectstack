/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - State-machine next values
 *
 * Which values a `state_machine`-governed field may move to from its persisted
 * value, read from the object's served `validations`. A choice control (the
 * grid's inline editor, the record form's select, the board's columns) offers
 * only these, so it does not stage a move the server is bound to refuse.
 * `stateMachineInitialValues` is the insert half: the values a NEW record may
 * be created in (`initialStates`), which a create form offers (#27763).
 *
 * This is a PRESENTATION read of the declared transition map, not a client-side
 * enforcement path: it never judges a write, and the server's rule validator
 * stays the one authority that refuses an invalid transition. The deprecated
 * object-level rule engine next door is a different thing and stays unwired
 * (#3110); this module neither imports nor mirrors it.
 *
 * It narrows exactly where the server would refuse, and nowhere else:
 *
 *  - only `severity: 'error'` rules (the spec default) — a `warning` / `info`
 *    machine never blocks the write, so every option stays offered;
 *  - only rules that are `active` (default `true`) and whose `events` cover
 *    the write (default `['insert', 'update']`) — a move is an update, a
 *    create is an insert;
 *  - a from-state the transition map does not declare is unconstrained, as
 *    the server is lenient there; so is an insert under a rule that declares
 *    no `initialStates` (the server's legacy no-op);
 *  - several applicable rules on one field all have to pass, so their allowed
 *    sets intersect.
 *
 * `active`, `events` and `severity` arrive ABSENT from `/meta` when the author
 * left them at the spec default, so an absent key reads as the default, never
 * as JavaScript falsiness.
 *
 * @module state-machine-next-values
 * @packageDocumentation
 */

/** The spec's `events` default for a validation rule. */
const DEFAULT_EVENTS: readonly string[] = ['insert', 'update'];

/** A `state_machine` rule on `fieldName` that refuses an invalid `event` write. */
function isBlockingMachine(rule: unknown, fieldName: string, event: 'insert' | 'update'): boolean {
  if (!rule || typeof rule !== 'object') return false;
  const r = rule as {
    type?: unknown;
    field?: unknown;
    active?: unknown;
    events?: unknown;
    severity?: unknown;
  };
  if (r.type !== 'state_machine' || r.field !== fieldName) return false;
  if (r.active === false) return false;
  if ((r.severity ?? 'error') !== 'error') return false;
  const events = Array.isArray(r.events) && r.events.length > 0 ? r.events : DEFAULT_EVENTS;
  return events.includes(event);
}

/** A `state_machine` rule that refuses an invalid move on update. */
function isBlockingUpdateMachine(
  rule: unknown,
  fieldName: string,
): rule is { transitions: Record<string, unknown> } {
  if (!isBlockingMachine(rule, fieldName, 'update')) return false;
  const transitions = (rule as { transitions?: unknown }).transitions;
  return !!transitions && typeof transitions === 'object';
}

/** A `state_machine` rule that refuses a create outside its `initialStates`. */
function isBlockingInsertMachine(
  rule: unknown,
  fieldName: string,
): rule is { initialStates: unknown[] } {
  if (!isBlockingMachine(rule, fieldName, 'insert')) return false;
  const initial = (rule as { initialStates?: unknown }).initialStates;
  return Array.isArray(initial) && initial.length > 0;
}

/** Several applicable rules on one field all have to pass. */
function intersect(sets: Set<string>[]): Set<string> | null {
  if (sets.length === 0) return null;
  return sets.reduce((acc, next) => new Set([...acc].filter((v) => next.has(v))));
}

/**
 * For a field governed by a blocking `state_machine` validation, the set of
 * values reachable from `currentValue` — the current value itself plus its
 * declared allowed transitions.
 *
 * `currentValue` is the PERSISTED value (the row as the server last stored
 * it), because that is the from-state the server judges a move against — never
 * a value the user has staged but not saved.
 *
 * Returns `null` (= "don't constrain the options") when:
 *  - the object has no applicable `state_machine` validation for the field
 *    (none at all, or only warning / inactive / insert-only ones), or
 *  - the current value is empty, or no applicable rule declares it as a
 *    from-state.
 */
export function stateMachineNextValues(
  objectSchema: unknown,
  fieldName: string,
  currentValue: unknown,
): Set<string> | null {
  const rules = (objectSchema as { validations?: unknown } | null | undefined)?.validations;
  if (!Array.isArray(rules)) return null;
  if (currentValue === undefined || currentValue === null) return null;
  const from = String(currentValue);

  const perRule: Set<string>[] = [];
  for (const rule of rules) {
    if (!isBlockingUpdateMachine(rule, fieldName)) continue;
    const allowed = rule.transitions[from];
    // An undeclared from-state is not policed by this rule.
    if (!Array.isArray(allowed)) continue;
    perRule.push(new Set<string>([from, ...allowed.map((s) => String(s))]));
  }
  return intersect(perRule);
}

/**
 * For a field governed by a blocking `state_machine` validation that declares
 * `initialStates`, the set of values a NEW record may be created in — the
 * machine's entry point, which the server enforces on insert.
 *
 * Returns `null` (= "don't constrain the options") when the object has no
 * applicable rule for the field: none at all, only warning / inactive /
 * update-only ones, or ones that declare no `initialStates` (the server does
 * not police an insert under such a rule).
 */
export function stateMachineInitialValues(
  objectSchema: unknown,
  fieldName: string,
): Set<string> | null {
  const rules = (objectSchema as { validations?: unknown } | null | undefined)?.validations;
  if (!Array.isArray(rules)) return null;

  const perRule: Set<string>[] = [];
  for (const rule of rules) {
    if (!isBlockingInsertMachine(rule, fieldName)) continue;
    perRule.push(new Set<string>(rule.initialStates.map((s) => String(s))));
  }
  return intersect(perRule);
}
