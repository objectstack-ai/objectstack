// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22211 ruling A, #22386] `buildFieldIndex` and the shared validator read
 * `ObjectSchema.attachedOnRead`.
 *
 * A read attachment is a block a service sets on each row it serves, computed
 * per caller and never stored. Declared, its block name joins the names
 * `record.<x>` resolves to, and the second segment of `record.<block>.<leaf>`
 * is judged against the block's declared leaves — under the EXISTING
 * `unknown-field` refusal, with no new rule and nothing keyed on a block's
 * name. Undeclared, every verdict is what it was.
 *
 * Every fixture goes through `ObjectStackSchema.safeParse` first: this rule is
 * registered `input: 'parsed'`, so a fixture the spec refuses would pin a
 * branch no author can reach (the #5017 discipline).
 *
 * The probe object mirrors the shipped shape the ruling names — an action
 * `visible` predicate over `record.viewer.can_act` — without being the shipped
 * object: declaring `sys_approval_request`'s block is #22387's.
 */

import { describe, it, expect } from 'vitest';

import { ObjectStackSchema } from '@objectstack/spec';

import { validateStackExpressions } from './validate-expressions.js';

const MANIFEST = { id: 'com.example.attached-on-read', name: 'attached_on_read_probe', version: '1.0.0', type: 'app' } as const;

/** A fixture is only a fixture if the spec accepts it. */
function specValid(stack: Record<string, unknown>): Record<string, unknown> {
  const result = ObjectStackSchema.safeParse({ manifest: MANIFEST, ...stack });
  if (!result.success) {
    throw new Error(
      'fixture is not spec-valid: ' +
        result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return result.data as unknown as Record<string, unknown>;
}

const VIEWER = { can_act: 'boolean', can_override: 'boolean', is_submitter: 'boolean' } as const;

/** The probe object, with or without the declaration. */
const probe = (declared: boolean) => ({
  name: 'approval_probe',
  label: 'Approval probe',
  fields: {
    status: { type: 'text', label: 'Status' },
    amount: { type: 'number', label: 'Amount' },
  },
  ...(declared ? { attachedOnRead: { viewer: VIEWER } } : {}),
});

/** One action whose `visible` predicate is the expression under test. */
function issuesFor(visible: string, declared: boolean) {
  return validateStackExpressions(
    specValid({
      objects: [probe(declared)],
      actions: [{ name: 'approve_probe', label: 'Approve', objectName: 'approval_probe', type: 'script', target: 'fn', visible }],
    }),
  );
}

describe('attachedOnRead — record.<block>.<leaf> through the stack rule', () => {
  it('accepts a declared leaf', () => {
    expect(issuesFor("record.status == 'pending' && (record.viewer.can_act || record.viewer.can_override)", true)).toEqual([]);
    expect(issuesFor('record.viewer.is_submitter', true)).toEqual([]);
  });

  it('refuses a misspelt leaf, naming the leaves the block declares', () => {
    const issues = issuesFor('record.viewer.can_actt', true);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].where).toContain("action 'approve_probe'");
    // The named subject, the declared leaves as the remedy, and the nearest one.
    expect(issues[0].message).toContain('unknown field `viewer.can_actt` on `approval_probe`');
    expect(issues[0].message).toContain('`can_act`, `can_override`, `is_submitter`');
    expect(issues[0].message).toContain('did you mean `viewer.can_act`?');
  });

  it('refuses an undeclared block as today — the first segment', () => {
    const issues = issuesFor('record.viewr.can_act', true);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/^unknown field `viewr` on `approval_probe` — did you mean `viewer`\?$/);
  });

  it('an object without the key keeps today’s verdict (control)', () => {
    const issues = issuesFor('record.viewer.can_act', false);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe('unknown field `viewer` on `approval_probe`');
    // And a declared field's second segment stays unjudged with the key absent.
    expect(issuesFor('record.amount > 0', false)).toEqual([]);
  });

  it('reaches the field-formula pass too: the same index serves both call sites that pass the field index', () => {
    const formula = (expression: string) =>
      validateStackExpressions(
        specValid({
          objects: [{
            ...probe(true),
            fields: {
              ...probe(true).fields,
              flagged: { type: 'formula', label: 'Flagged', expression },
            },
          }],
        }),
      );
    // Only the refusal half is pinned here: whether a block a SERVED row carries
    // belongs in a stored formula at all is not this rule's question (the
    // ruling places it in the field-existence set, which every surface reads).
    const issues = formula('record.viewer.can_actt ? 1 : 0');
    expect(issues).toHaveLength(1);
    expect(issues[0].where).toBe("object 'approval_probe' · field 'flagged' expression");
    expect(issues[0].message).toContain('unknown field `viewer.can_actt`');
  });
});
