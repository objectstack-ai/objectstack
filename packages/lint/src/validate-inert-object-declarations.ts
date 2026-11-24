// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An object declaration that passes the schema and then works against its
 * author at run time — a refusal at publish, with the fix named.
 *
 * {@link STATE_MACHINE_NO_INITIAL_STATES} — an active `state_machine`
 * validation with no `initialStates`, or an empty list. `transitions` governs
 * UPDATE only, and the engine treats an absent or empty `initialStates` as
 * "no entry contract" (`checkStateMachine`), so a record can be CREATED
 * already in any state (born `approved`), walking straight past the process
 * the machine declares. A rule with `active: false` is skipped, as the engine
 * skips it, and so is a machine whose `events` leave out `insert`: the
 * engine runs a rule only on the write contexts its `events` list
 * (`r.events ?? ['insert', 'update']`, `rule-validator.ts`), so on an
 * update-only machine `initialStates` is never read and adding it would be
 * metadata the runtime ignores.
 *
 * It reads the object's own body alone, so the runtime publish gate judges an
 * `object` write exactly as the CLI judges the stack.
 */

import { collectionEntries } from './collection-entries.js';
import { recordsOf } from './object-graph.js';

export const STATE_MACHINE_NO_INITIAL_STATES = 'state-machine-no-initial-states';

export interface InertObjectDeclarationFinding {
  severity: 'error';
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

/**
 * Whether the engine runs a rule on insert. An absent `events` takes the
 * schema default `['insert', 'update']`; an explicit list runs on exactly the
 * contexts it names, so `[]` and `['update']` never run on create.
 */
function runsOnInsert(events: unknown): boolean {
  if (events === undefined || events === null) return true;
  return Array.isArray(events) && events.includes('insert');
}

/** Flag an entry-unguarded state machine on every object. */
export function validateInertObjectDeclarations(stack: Record<string, unknown>): InertObjectDeclarationFinding[] {
  const findings: InertObjectDeclarationFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;
  for (const { rec: obj, path: objPath } of collectionEntries(stack.objects, 'objects')) {
    const objectName = typeof obj.name === 'string' ? obj.name : objPath;

    const validations = recordsOf(obj.validations);
    const validationList: readonly unknown[] = Array.isArray(obj.validations) ? obj.validations : [];
    for (const rule of validations) {
      if (rule.type !== 'state_machine' || rule.active === false) continue;
      if (!runsOnInsert(rule.events)) continue;
      // Absent and empty are the same to the engine: no entry contract.
      if (Array.isArray(rule.initialStates) && rule.initialStates.length > 0) continue;
      const ruleName = typeof rule.name === 'string' ? rule.name : 'state_machine';
      const stateField = typeof rule.field === 'string' ? rule.field : 'its state field';
      const transitions = rule.transitions && typeof rule.transitions === 'object' ? Object.keys(rule.transitions) : [];
      const first = transitions[0];
      findings.push({
        severity: 'error',
        rule: STATE_MACHINE_NO_INITIAL_STATES,
        where: `object "${objectName}" validation "${ruleName}"`,
        path: `${objPath}.validations[${validationList.indexOf(rule)}]`,
        message:
          `State machine "${ruleName}" declares no \`initialStates\` (an empty list counts as none). Its \`transitions\` govern updates only, so a ` +
          `record can be created with "${stateField}" already at any state and skip the process.`,
        hint:
          `Add \`initialStates\` listing the states a record may be created in` +
          `${first ? `, e.g. \`initialStates: ['${first}']\`` : ''}.`,
      });
    }
  }
  return findings;
}
