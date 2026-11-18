// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Two object declarations that pass the schema and then work against their
 * author at run time — each a refusal at publish, with the fix named.
 *
 * 1. {@link FIELD_BOOLEAN_REQUIRED} — a `boolean` / `toggle` field marked
 *    `required`. `required` is a presence contract and a checkbox is never
 *    absent, so it guards nothing; the record form reads it as "must be
 *    checked" and refuses to save the box unchecked, so the app can only ever
 *    create records with the box ON.
 * 2. {@link STATE_MACHINE_NO_INITIAL_STATES} — a `state_machine` validation
 *    with no `initialStates`. `transitions` governs UPDATE only, so without an
 *    entry guard a record can be CREATED already in any state (born
 *    `approved`), walking straight past the process the machine declares.
 *
 * Both read the object's own body alone, so the runtime publish gate judges an
 * `object` write exactly as the CLI judges the stack.
 */

import { collectionEntries } from './collection-entries.js';
import { recordsOf } from './object-graph.js';

export const FIELD_BOOLEAN_REQUIRED = 'field-boolean-required';
export const STATE_MACHINE_NO_INITIAL_STATES = 'state-machine-no-initial-states';

export interface InertObjectDeclarationFinding {
  severity: 'error';
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

const CHECKBOX_TYPES = new Set(['boolean', 'toggle']);

/** Flag a required checkbox and an entry-unguarded state machine on every object. */
export function validateInertObjectDeclarations(stack: Record<string, unknown>): InertObjectDeclarationFinding[] {
  const findings: InertObjectDeclarationFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;
  for (const { rec: obj, path: objPath } of collectionEntries(stack.objects, 'objects')) {
    const objectName = typeof obj.name === 'string' ? obj.name : objPath;

    for (const { rec: field, path: fieldPath } of collectionEntries(obj.fields, `${objPath}.fields`)) {
      if (typeof field.type !== 'string' || !CHECKBOX_TYPES.has(field.type) || field.required !== true) continue;
      const fieldName = typeof field.name === 'string' ? field.name : fieldPath;
      const hasDefault = field.defaultValue !== undefined && field.defaultValue !== null;
      findings.push({
        severity: 'error',
        rule: FIELD_BOOLEAN_REQUIRED,
        where: `object "${objectName}" field "${fieldName}"`,
        path: `${fieldPath}.required`,
        message:
          `Field "${fieldName}" is a ${field.type} marked required. "false" is a legal value, not a missing one, ` +
          'so the flag guards nothing — and the record form reads it as "must be checked" and refuses to save ' +
          'the box unchecked.',
        hint:
          `Remove \`required\` from "${fieldName}"${hasDefault ? '' : ' and give it `defaultValue: false`'}. ` +
          'If the box really must be ticked, write a validation rule that says so.',
      });
    }

    const validations = recordsOf(obj.validations);
    const validationList: readonly unknown[] = Array.isArray(obj.validations) ? obj.validations : [];
    for (const rule of validations) {
      if (rule.type !== 'state_machine' || rule.initialStates !== undefined) continue;
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
          `State machine "${ruleName}" declares no \`initialStates\`. Its \`transitions\` govern updates only, so a ` +
          `record can be created with "${stateField}" already at any state and skip the process.`,
        hint:
          `Add \`initialStates\` listing the states a record may be created in` +
          `${first ? `, e.g. \`initialStates: ['${first}']\`` : ''}.`,
      });
    }
  }
  return findings;
}
