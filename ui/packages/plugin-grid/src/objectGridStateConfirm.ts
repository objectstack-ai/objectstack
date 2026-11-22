/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#35685 — the confirm step before a list cell moves a
 * state-machine field.
 *
 * A state-machine field is a field the object's `state_machine` validation
 * rule governs (ADR-0020), read the way the board, the record form and the
 * grid's own editor read it: an active rule naming the field whose events
 * cover an update. Its severity does not matter here: a move along a machine
 * is the change that related automation listens for, whether or not the rule
 * blocks a bad one. Which moves are legal stays the server's call.
 *
 * The confirm names the field and its old and new value and says saving may
 * trigger related automation, as the maintainer ruled (ruling record
 * 7039615827 on objectstack#35685). Under that sentence it names the flows the
 * move would start (objectstack#35928, ruling record 7073655354), read through
 * `@object-ui/plugin-detail`'s `useRecordUpdateStarts`, the reader the record
 * page's stage confirm shares; no answer leaves the sentence alone.
 */

import type { RecordUpdateStartsAsk } from '@object-ui/plugin-detail';

/** The spec's `events` default for a validation rule. */
const DEFAULT_EVENTS: readonly string[] = ['insert', 'update'];

/** Whether an active `state_machine` rule of `objectSchema` governs `field` on update. */
export function isStateMachineField(objectSchema: unknown, field: string): boolean {
  const rules = (objectSchema as { validations?: unknown } | null | undefined)?.validations;
  if (!Array.isArray(rules)) return false;
  return rules.some((rule) => {
    if (!rule || typeof rule !== 'object') return false;
    const r = rule as { type?: unknown; field?: unknown; active?: unknown; events?: unknown };
    if (r.type !== 'state_machine' || r.field !== field || r.active === false) return false;
    const events = Array.isArray(r.events) && r.events.length > 0 ? r.events : DEFAULT_EVENTS;
    return events.includes('update');
  });
}

/** What the confirm says about one move: the field, and the value it leaves and takes. */
export interface StateChangeConfirm {
  field: string;
  from: string;
  to: string;
  /** The move as the server is asked which flows it starts; absent for a row with no record id. */
  ask?: RecordUpdateStartsAsk;
}

type OptionLike = { value?: unknown; label?: unknown } | string | number;

/**
 * The words a stored state is shown in: the option's label (as the host
 * translates it), the stored code when no option declares it, and `empty`
 * for no value.
 */
export function stateLabelOf(
  options: unknown,
  value: unknown,
  translate: (optionValue: string, fallback: string) => string,
  empty: string,
): string {
  if (value === undefined || value === null || value === '') return empty;
  const code = String(value);
  const option = Array.isArray(options)
    ? (options as OptionLike[]).find((o) => String(typeof o === 'object' && o !== null ? o.value : o) === code)
    : undefined;
  const declared = typeof option === 'object' && option !== null && typeof option.label === 'string' && option.label.length > 0
    ? option.label
    : code;
  return translate(code, declared);
}
