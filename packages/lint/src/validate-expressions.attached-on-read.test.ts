// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ObjectSchema.attachedOnRead`, read by `buildAttachedOnReadIndex` and the
 * shared validator — and only at the sites whose `record` is a served row.
 *
 * A read attachment is a block a service sets on each row it serves, computed
 * per caller and never stored. At a served-row site (`SERVED_ROW_SITES`: an
 * action's `visible` and `disabled`), its block name joins the names
 * `record.<x>` resolves to, and the second segment of `record.<block>.<leaf>`
 * is judged against the block's declared leaves — under the EXISTING
 * `unknown-field` refusal, with no new rule and nothing keyed on a block's
 * name. Every other site binds the stored row, which never carries a block,
 * so there `record.<block>` is refused as the unknown field it is at run time.
 * Undeclared, every verdict is what it was.
 *
 * Every fixture goes through `ObjectStackSchema.safeParse` first: this rule is
 * registered `input: 'parsed'`, so a fixture the spec refuses would pin a
 * branch no author can reach.
 *
 * The probe object mirrors the shipped shape — an action `visible` predicate
 * over `record.viewer.can_act` — without being the shipped object, which
 * plugin-approvals judges in its own test.
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

/** One action whose `disabled` predicate is the expression under test. */
function disabledIssuesFor(disabled: string) {
  return validateStackExpressions(
    specValid({
      objects: [probe(true)],
      actions: [{ name: 'approve_probe', label: 'Approve', objectName: 'approval_probe', type: 'script', target: 'fn', disabled }],
    }),
  );
}

/** A record-change flow on the probe object, its start gate and its one edge carrying the given conditions. */
const flowOn = (gate: { start?: string; edge?: string }) => ({
  name: 'probe_flow',
  label: 'Probe flow',
  type: 'record_change',
  status: 'active',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Start',
      config: {
        objectName: 'approval_probe',
        triggerType: 'record-after-update',
        ...(gate.start ? { condition: gate.start } : {}),
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end', ...(gate.edge ? { condition: gate.edge } : {}) }],
});

/** The declared probe object with extra fields or validations merged in. */
const declaredWith = (extra: { fields?: Record<string, unknown>; validations?: unknown[] }) => ({
  ...probe(true),
  fields: { ...probe(true).fields, ...(extra.fields ?? {}) },
  ...(extra.validations ? { validations: extra.validations } : {}),
});

const READ = 'record.viewer.can_act == true';

/**
 * Every site that binds the STORED row, each carrying one read of the block on
 * an object that declares it: the stack, and where the site's finding is
 * located.
 */
const STORED_ROW_SITES: ReadonlyArray<readonly [string, () => Record<string, unknown>, string]> = [
  [
    'a flow start condition',
    () => ({ objects: [probe(true)], flows: [flowOn({ start: READ })] }),
    "flow 'probe_flow' · node 'start' (start) condition",
  ],
  [
    'a flow edge condition',
    () => ({ objects: [probe(true)], flows: [flowOn({ edge: READ })] }),
    "flow 'probe_flow' · edge 'e1' (start→end) condition",
  ],
  [
    'a validation rule',
    () => ({ objects: [declaredWith({ validations: [{ type: 'script', name: 'probe_rule', message: 'm', condition: READ }] })] }),
    "object 'approval_probe' · validation 'probe_rule'",
  ],
  [
    "a field's requiredWhen",
    () => ({ objects: [declaredWith({ fields: { note: { type: 'text', label: 'Note', requiredWhen: READ } } })] }),
    "object 'approval_probe' · field 'note' requiredWhen",
  ],
  [
    "a field's visibleWhen",
    () => ({ objects: [declaredWith({ fields: { note: { type: 'text', label: 'Note', visibleWhen: READ } } })] }),
    "object 'approval_probe' · field 'note' visibleWhen",
  ],
  [
    "an option's visibleWhen",
    () => ({
      objects: [declaredWith({
        fields: {
          stage: { type: 'select', label: 'Stage', options: [{ label: 'Open', value: 'open', visibleWhen: READ }] },
        },
      })],
    }),
    "object 'approval_probe' · field 'stage' option 'open' visibleWhen",
  ],
  [
    'a field formula',
    () => ({
      objects: [declaredWith({ fields: { flagged: { type: 'formula', label: 'Flagged', expression: 'record.viewer.can_act ? 1 : 0' } } })],
    }),
    "object 'approval_probe' · field 'flagged' expression",
  ],
  [
    'a sharing-rule condition',
    () => ({
      objects: [probe(true)],
      sharingRules: [{ name: 'probe_share', type: 'criteria', object: 'approval_probe', sharedWith: { type: 'team', value: 't' }, condition: READ }],
    }),
    "sharingRule 'probe_share' (approval_probe) condition",
  ],
  [
    'a hook condition',
    () => ({
      objects: [probe(true)],
      hooks: [{ name: 'probe_hook', object: 'approval_probe', events: ['afterUpdate'], handler: 'probe_fn', condition: READ }],
    }),
    "hook 'probe_hook' (approval_probe) condition",
  ],
];

describe('attachedOnRead — record.<block>.<leaf> at a served-row site', () => {
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

  it('an action `disabled` predicate is a served-row site too', () => {
    expect(disabledIssuesFor('record.viewer.can_act == false')).toEqual([]);
    const issues = disabledIssuesFor('record.viewer.can_actt == false');
    expect(issues).toHaveLength(1);
    expect(issues[0].where).toBe("stack · action 'approve_probe' disabled");
    expect(issues[0].message).toContain('unknown field `viewer.can_actt` on `approval_probe`');
  });

  it('an object without the key keeps today’s verdict (control)', () => {
    const issues = issuesFor('record.viewer.can_act', false);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe('unknown field `viewer` on `approval_probe`');
    // And a declared field's second segment stays unjudged with the key absent.
    expect(issuesFor('record.amount > 0', false)).toEqual([]);
  });
});

describe('attachedOnRead — a stored-row site resolves the object’s columns alone', () => {
  it.each(STORED_ROW_SITES)('%s: the block is an unknown field, as on an object that declares none', (_site, stack, where) => {
    const issues = validateStackExpressions(specValid(stack()));
    expect(issues, JSON.stringify(issues, null, 2)).toHaveLength(1);
    expect(issues[0].where).toBe(where);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toBe('unknown field `viewer` on `approval_probe`');
  });

  it('the block is no "did you mean?" candidate there either', () => {
    const issues = validateStackExpressions(specValid({ objects: [probe(true)], flows: [flowOn({ start: 'record.viewr.can_act == true' })] }));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/^unknown field `viewr` on `approval_probe`/);
    expect(issues[0].message).not.toContain('viewer');
  });

  it('one object, two sites: its action predicate reads the block, its flow condition may not', () => {
    const issues = validateStackExpressions(
      specValid({
        objects: [probe(true)],
        actions: [{ name: 'approve_probe', label: 'Approve', objectName: 'approval_probe', type: 'script', target: 'fn', visible: READ }],
        flows: [flowOn({ start: READ })],
      }),
    );
    expect(issues.map((i) => [i.where, i.message])).toEqual([
      ["flow 'probe_flow' · node 'start' (start) condition", 'unknown field `viewer` on `approval_probe`'],
    ]);
  });
});
