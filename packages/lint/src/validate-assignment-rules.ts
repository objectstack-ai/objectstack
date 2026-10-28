// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0142 D5] Authoring-time checks on the stack's `assignmentRules`.
//
// A pure `(stack) => Finding[]` rule (ADR-0019). The engine routes an inserted
// row through these declarations at runtime and never refuses the insert on
// their account — an unstaffed queue parks the row, an unresolved target leaves
// it ownerless, each logged once — so what a linter can add is the two shapes
// visible in the declaration itself:
//
// | rule                              | severity | shape                                                        |
// |-----------------------------------|----------|--------------------------------------------------------------|
// | assignment-rule-user-target       | warning  | `assignTo: { type: 'user' }` — a user id in package metadata |
// | assignment-rule-queue-unstaffed   | info     | the target is a queue this stack declares with no member     |
//
// The second is the `approval-approvers-may-resolve-empty` shape: a declared
// queue's members are positions, and one that names none is staffed only by an
// organization's own `sys_queue_member` rows — runtime data this rule cannot
// read, so it reports the shape and asserts no runtime fact. A target this
// stack does not declare may be an organization's own queue and is not judged.

import { recordsOf } from './object-graph.js';

export type AssignmentRuleSeverity = 'warning' | 'info';

export interface AssignmentRuleFinding {
  severity: AssignmentRuleSeverity;
  rule: string;
  /** Human-readable location, e.g. `assignment rule "case_intake" · entry "default"`. */
  where: string;
  /** Config path, e.g. `assignmentRules[0].entries[1].assignTo`. */
  path: string;
  message: string;
  hint: string;
}

// Rule ids (registry entries).
export const ASSIGNMENT_RULE_USER_TARGET = 'assignment-rule-user-target';
export const ASSIGNMENT_RULE_QUEUE_UNSTAFFED = 'assignment-rule-queue-unstaffed';

type AnyRec = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Report the user-id targets and the unstaffed declared-queue targets of every
 * assignment rule entry. Reads `stack.assignmentRules` and `stack.queues`; safe
 * on any shape — a stack with neither yields no findings.
 */
export function validateAssignmentRules(stack: AnyRec): AssignmentRuleFinding[] {
  const out: AssignmentRuleFinding[] = [];
  const declaredQueues = new Map<string, AnyRec>();
  for (const q of recordsOf(stack.queues)) {
    const name = str(q.name);
    if (name) declaredQueues.set(name, q);
  }

  const rules = Array.isArray(stack.assignmentRules) ? (stack.assignmentRules as unknown[]) : [];
  rules.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const rule = raw as AnyRec;
    const ruleName = str(rule.name) || `assignmentRules[${i}]`;
    const entries = Array.isArray(rule.entries) ? (rule.entries as unknown[]) : [];
    entries.forEach((rawEntry, j) => {
      if (!rawEntry || typeof rawEntry !== 'object') return;
      const entry = rawEntry as AnyRec;
      const target = entry.assignTo as AnyRec | undefined;
      if (!target || typeof target !== 'object') return;
      const value = str(target.value);
      if (!value) return;
      const where = `assignment rule "${ruleName}" · entry "${str(entry.name) || j}"`;
      const path = `assignmentRules[${i}].entries[${j}].assignTo`;

      if (target.type === 'user') {
        out.push({
          severity: 'warning',
          rule: ASSIGNMENT_RULE_USER_TARGET,
          where,
          path,
          // [#22161] One verdict sentence; why a user id is organization data
          // (ADR-0086 D1) is `os explain assignment-rule-user-target`.
          message:
            `\`assignTo\` names the user id '${value}', which is one organization's data written into ` +
            `package metadata, so the rule routes to nobody wherever that id does not exist`,
          hint:
            "Route to a queue instead ({ type: 'queue', value: '<queue name>' }) whose members are " +
            'positions, so each organization staffs it',
        });
        return;
      }

      if (target.type === 'queue') {
        const declared = declaredQueues.get(value);
        if (!declared) return;
        if (recordsOf(declared.members).length > 0) return;
        out.push({
          severity: 'info',
          rule: ASSIGNMENT_RULE_QUEUE_UNSTAFFED,
          where,
          path,
          message:
            `queue '${value}' is declared with no position member, so every row this entry matches ` +
            `parks unowned unless an organization adds members to it`,
          hint: `Declare at least one member on queue '${value}' ({ type: 'position', value: '<position name>' })`,
        });
      }
    });
  });

  return out;
}
