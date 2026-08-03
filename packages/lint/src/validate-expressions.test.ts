import { describe, it, expect } from 'vitest';
import { validateStackExpressions } from './validate-expressions.js';

describe('validateStackExpressions (ADR-0032 build-time)', () => {
  const objects = [
    { name: 'crm_lead', fields: { rating: { type: 'number' }, status: { type: 'text' } } },
  ];

  it('passes a clean stack', () => {
    const issues = validateStackExpressions({
      objects,
      flows: [{
        name: 'lead_flow',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: 'crm_lead' } },
          { id: 'check', type: 'decision', config: { condition: 'record.rating >= 4' } },
        ],
        edges: [{ id: 'e1', source: 'check', target: 'end', condition: 'record.rating < 4' }],
      }],
    });
    expect(issues).toHaveLength(0);
  });

  it('flags a brace-in-CEL condition with location + corrective message', () => {
    const issues = validateStackExpressions({
      objects,
      flows: [{
        name: 'lead_flow',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: 'crm_lead' } },
          { id: 'check', type: 'decision', config: { condition: '{record.rating} >= 4' } },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].where).toContain("flow 'lead_flow'");
    expect(issues[0].where).toContain("node 'check'");
    expect(issues[0].message).toMatch(/map literal|bare reference/);
    expect(issues[0].source).toBe('{record.rating} >= 4');
  });

  it('flags an unknown record field against the resolved schema (did-you-mean)', () => {
    const issues = validateStackExpressions({
      objects,
      flows: [{
        name: 'lead_flow',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: 'crm_lead' } },
          { id: 'check', type: 'decision', config: { condition: 'record.raitng >= 4' } },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/unknown field `raitng`/);
    expect(issues[0].message).toMatch(/did you mean `rating`/);
  });

  it('validates object validation-rule predicates too', () => {
    const issues = validateStackExpressions({
      objects: [
        { name: 'crm_lead', fields: { rating: {} }, validations: [{ name: 'r1', expression: '{record.rating} > 0' }] },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].where).toContain("validation 'r1'");
  });

  // #1870 — a `script` node that names no callable is a silent no-op.
  it('flags a script node that declares no function (#1870)', () => {
    const issues = validateStackExpressions({
      flows: [{
        name: 'helpdesk_flow',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'triage', type: 'script', config: {} },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].where).toContain("node 'triage' (script) callable");
    expect(issues[0].message).toMatch(/declares no .*function/);
  });

  it('accepts a script node that names a function (#1870)', () => {
    const issues = validateStackExpressions({
      flows: [{
        name: 'helpdesk_flow',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'triage', type: 'script', config: { function: 'helpdesk.aiTriageStub' } },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(0);
  });

  // #1870 DX — `functionName` is an accepted alias for `function`.
  it('accepts a script node that names a callable via the functionName alias', () => {
    const issues = validateStackExpressions({
      flows: [{
        name: 'helpdesk_flow',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'triage', type: 'script', config: { functionName: 'helpdesk.aiTriageStub' } },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(0);
  });

  // #4343 — the retired dispatch keys. Naming them beats the generic "no
  // callable": they are what the author actually wrote, and each branch has a
  // different replacement.
  it('flags a retired dispatch key and prescribes the replacement mechanism', () => {
    const issues = validateStackExpressions({
      flows: [{
        name: 'helpdesk_flow',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'mail', type: 'script', config: { actionType: 'email', template: 't', recipients: ['a'] } },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/#4343/);
    expect(issues[0].message).toMatch(/config\.actionType/);
    expect(issues[0].message).toMatch(/config\.template/);
    expect(issues[0].message).toMatch(/`notify` node/);
    expect(issues[0].message).toMatch(/os migrate meta --from 16/);
  });

  it('tells a shorthand actionType exactly where its name belongs', () => {
    const issues = validateStackExpressions({
      flows: [{
        name: 'helpdesk_flow',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'triage', type: 'script', config: { actionType: 'helpdesk.aiTriageStub' } },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/function: 'helpdesk\.aiTriageStub'/);
  });

  it('flags an inline script body — the runtime never executed it', () => {
    const issues = validateStackExpressions({
      flows: [{
        name: 'helpdesk_flow',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'inline', type: 'script', config: { script: 'variables.x = 1;' } },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/config\.script/);
  });

  // #1928 — bare field references are silently null in `record`-scoped sites
  // (field formulas + validation predicates) but correct in flattened flow
  // conditions. The validator wires the scope per site.
  describe('bare-reference detection by site scope (#1928)', () => {
    it('flags a bare reference in a field formula', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_opportunity',
          fields: {
            amount: { type: 'currency' },
            probability: { type: 'percent' },
            expected_revenue: { type: 'formula', name: 'expected_revenue', formula: 'amount * probability / 100' },
          },
        }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].where).toContain("field 'expected_revenue' formula");
      expect(issues[0].message).toMatch(/bare reference `(amount|probability)`/);
    });

    it('flags a bare reference in a validation predicate', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_lead',
          fields: { lead_score: { type: 'number' } },
          validations: [{ name: 'lead_score_range', expression: 'lead_score != null && lead_score > 100' }],
        }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].where).toContain("validation 'lead_score_range'");
      expect(issues[0].message).toMatch(/bare reference `lead_score`/);
    });

    it('accepts the record-qualified forms', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_opportunity',
          fields: {
            amount: { type: 'currency' },
            probability: { type: 'percent' },
            expected_revenue: { type: 'formula', name: 'expected_revenue', formula: 'record.amount * record.probability / 100' },
          },
          validations: [{ name: 'amt', expression: 'record.amount != null && record.amount >= 0' }],
        }],
      });
      expect(issues).toHaveLength(0);
    });

    // #3306 — a formula field doing date arithmetic type-checks clean (dyn operands)
    // but nulls at runtime. The stack gate must turn it RED with a corrective
    // message — this is the exact shape that shipped in the `hr` template.
    it('flags a formula field that does date arithmetic (the shipped time_off.days bug)', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'hr_time_off_request',
          fields: {
            start_date: { type: 'date' },
            end_date: { type: 'date' },
            days: {
              type: 'formula', name: 'days',
              formula: 'record.start_date != null && record.end_date != null ? (record.end_date - record.start_date) + 1 : null',
            },
          },
        }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
      expect(issues[0].where).toContain("field 'days' formula");
      expect(issues[0].message).toMatch(/date arithmetic/i);
      expect(issues[0].message).toMatch(/daysBetween/);
    });

    it('accepts the daysBetween rewrite of that formula', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'hr_time_off_request',
          fields: {
            start_date: { type: 'date' },
            end_date: { type: 'date' },
            days: {
              type: 'formula', name: 'days',
              formula: 'record.start_date != null && record.end_date != null ? daysBetween(record.start_date, record.end_date) + 1 : null',
            },
          },
        }],
      });
      expect(issues).toHaveLength(0);
    });

    it('does NOT flag bare references in a flow condition (flattened scope)', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'crm_opportunity', fields: { stage: { type: 'select' }, amount: { type: 'currency' } } }],
        flows: [{
          name: 'high_value_deal',
          nodes: [
            { id: 'start', type: 'start', config: { objectName: 'crm_opportunity', condition: 'amount > 100000 && previous.amount <= 100000' } },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'end', condition: 'stage != "closed_won"' }],
        }],
      });
      expect(issues).toHaveLength(0);
    });

    // #1928 tier 3 — a likely field typo in a flow condition is a non-blocking warning.
    it('warns (severity=warning) on a likely field typo in a flow condition', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'crm_opportunity', fields: { stage: { type: 'select' }, amount: { type: 'currency' } } }],
        flows: [{
          name: 'opp_won',
          nodes: [
            { id: 'start', type: 'start', config: { objectName: 'crm_opportunity', condition: 'stagee == "closed_won"' } },
          ],
          edges: [],
        }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].message).toMatch(/did you mean `stage`/);
    });

    it('does not warn when the bare ref is far from any field (likely a flow variable)', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'crm_opportunity', fields: { stage: { type: 'select' } } }],
        flows: [{
          name: 'renewal',
          nodes: [{ id: 'start', type: 'start', config: { objectName: 'crm_opportunity' } }],
          edges: [{ id: 'e1', source: 'start', target: 'end', condition: 'expiring_deals.length > 0' }],
        }],
      });
      expect(issues).toHaveLength(0);
    });

    it('tags record-scoped bare-ref issues as errors', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_lead',
          fields: { lead_score: { type: 'number' } },
          validations: [{ name: 'r', expression: 'lead_score > 100' }],
        }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
    });
  });

  // #1928 tier 4 — a text/boolean field used with an arithmetic/ordering
  // operator against a number is a silent-null bug; the lint surfaces it as a
  // non-blocking warning, threading each object's field types into the checker.
  describe('type-soundness warnings (#1928 tier 4)', () => {
    it('warns on a formula that does arithmetic on a text field', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_lead',
          fields: {
            company: { type: 'text' },
            score: { type: 'formula', formula: 'record.company * 2' },
          },
        }],
      });
      const w = issues.filter(i => i.severity === 'warning');
      expect(w).toHaveLength(1);
      expect(w[0].where).toMatch(/formula/);
      expect(w[0].message).toMatch(/type mismatch/i);
      expect(w[0].message).toMatch(/record\.company/);
    });

    it('does not flag number arithmetic or date comparison (runtime-sound)', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_opportunity',
          fields: {
            amount: { type: 'currency' },
            probability: { type: 'percent' },
            close_date: { type: 'date' },
            expected: { type: 'formula', formula: 'record.amount * record.probability / 100' },
          },
          // The `!= null` guard is load-bearing since #4763: `close_date` is a
          // declared NULLABLE field, and an un-guarded `>=` over it faults at
          // runtime (`null >= timestamp` has no overload) — the null-guard gate
          // rejects that shape at authoring now. Soundness (this block's
          // subject) and null-guarding are separate verdicts; the predicate has
          // to satisfy both to produce zero issues.
          validations: [{ name: 'future', expression: 'record.close_date != null && record.close_date >= today()' }],
        }],
      });
      expect(issues).toHaveLength(0);
    });

    it('warns on a validation predicate ordering a text field against a number', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_lead',
          fields: { title: { type: 'text' } },
          validations: [{ name: 'r', expression: 'record.title > 5' }],
        }],
      });
      const w = issues.filter(i => i.severity === 'warning');
      expect(w).toHaveLength(1);
      expect(w[0].message).toMatch(/record\.title/);
    });

    it('warns on a flattened flow condition doing arithmetic on a bare text field', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'crm_opportunity', fields: { title: { type: 'text' }, amount: { type: 'currency' } } }],
        flows: [{
          name: 'opp_flow',
          nodes: [{ id: 'start', type: 'start', config: { objectName: 'crm_opportunity', condition: 'title * 2 > 10' } }],
          edges: [],
        }],
      });
      const w = issues.filter(i => i.severity === 'warning');
      expect(w).toHaveLength(1);
      expect(w[0].message).toMatch(/type mismatch/i);
      expect(w[0].message).toMatch(/`title`/);
    });

    it('does not flag a numeric flow condition or a flow variable', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'crm_opportunity', fields: { amount: { type: 'currency' } } }],
        flows: [{
          name: 'opp_flow',
          nodes: [{ id: 'start', type: 'start', config: { objectName: 'crm_opportunity' } }],
          edges: [{ id: 'e1', source: 'start', target: 'end', condition: 'amount / 100 > 5 && expiring_count * 2 > 3' }],
        }],
      });
      expect(issues).toHaveLength(0);
    });
  });

  describe('action visible/disabled predicates (record-scoped) — #2183 class', () => {
    it('flags a bare-field `visible` on a stack action (the trap that hid Mark Done)', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'showcase_task', fields: { done: { type: 'boolean' }, status: { type: 'select' } } }],
        actions: [{ name: 'mark_done', objectName: 'showcase_task', type: 'script', locations: ['record_header'], visible: '!done' }],
      });
      const v = issues.filter(i => i.where.includes("action 'mark_done' visible"));
      expect(v).toHaveLength(1);
      expect(v[0].severity).toBe('error');
      expect(v[0].message).toMatch(/bare reference `done`/);
    });

    it('accepts the record-qualified form', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'showcase_task', fields: { done: { type: 'boolean' } } }],
        actions: [{ name: 'mark_done', objectName: 'showcase_task', type: 'script', visible: '!record.done' }],
      });
      expect(issues).toHaveLength(0);
    });

    it('accepts ambient globals (ctx / features / user) used by platform actions', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'sys_user', fields: { id: { type: 'text' }, email_verified: { type: 'boolean' } } }],
        actions: [{ name: 'verify_email', objectName: 'sys_user', visible: 'record.id == ctx.user.id && record.email_verified == false && features.x != true' }],
      });
      expect(issues).toHaveLength(0);
    });

    it('flags a bare-field `disabled` predicate but ignores a boolean `disabled`', () => {
      const bad = validateStackExpressions({
        objects: [{ name: 'crm_lead', fields: { status: { type: 'select' } } }],
        actions: [{ name: 'park', objectName: 'crm_lead', disabled: 'status == "converted"' }],
      });
      expect(bad.filter(i => i.where.includes("action 'park' disabled"))).toHaveLength(1);

      const ok = validateStackExpressions({
        objects: [{ name: 'crm_lead', fields: { status: { type: 'select' } } }],
        actions: [{ name: 'park', objectName: 'crm_lead', disabled: true }],
      });
      expect(ok).toHaveLength(0);
    });

    it('validates an action attached to an object (record scope = parent object)', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'showcase_task',
          fields: { done: { type: 'boolean' } },
          actions: [{ name: 'mark_done', type: 'script', visible: '!done' }],
        }],
      });
      expect(issues.filter(i => i.where.includes("action 'mark_done' visible"))).toHaveLength(1);
    });
  });

  describe('record-scoped coverage extensions (field rules / sharing / hooks / nested when)', () => {
    it('flags a bare-field `readonlyWhen`/`requiredWhen` on a field', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'showcase_task',
          fields: {
            done: { type: 'boolean', readonlyWhen: 'done == true' },
            title: { type: 'text', requiredWhen: 'status == "x"' },
          },
        }],
      });
      expect(issues.some(i => i.where.includes('readonlyWhen') && /bare reference `done`/.test(i.message))).toBe(true);
      expect(issues.some(i => i.where.includes('requiredWhen') && /bare reference `status`/.test(i.message))).toBe(true);
    });

    // `qty` carries `required` + `defaultValue` so it can never be null. That
    // is not decoration: it mirrors the real `showcase_invoice_line.quantity`,
    // and without it `record.qty >= 100` is a genuine #4811 finding — `>=` on a
    // nullable declared field, which faults at runtime and makes the
    // `requiredWhen` silently unenforced. This case is about bare-vs-qualified
    // references (#1928) and the `parent` namespace, so the fixture is pinned
    // to the non-null shape rather than the gate being loosened around it.
    it('accepts record-qualified field rules and the master-detail `parent` namespace', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'inv_line',
          fields: {
            // #4889 — `parent` is bound from THIS relationship at write time, so
            // the fixture declares it: a detail object without one has no header
            // for the server to read (see the gate's own cases below).
            inv: { type: 'master_detail', reference: 'inv' },
            qty: { type: 'number', required: true, defaultValue: 1, readonlyWhen: "parent.status == 'paid'" },
            note: { type: 'text', requiredWhen: 'record.qty >= 100' },
          },
        }],
      });
      expect(issues).toHaveLength(0);
    });

    // #4889 — `parent`-scoped `readonlyWhen` is enforced by the SERVER binding
    // the object's master-detail header. No single master ⇒ no binding ⇒ the
    // write path holds the field locked forever. The metadata says so at build
    // time, so the build says so.
    describe('parent-scoped `readonlyWhen` needs a resolvable master (#4889)', () => {
      const parentScopeIssues = (obj: Record<string, unknown>) =>
        validateStackExpressions({ objects: [obj] }).filter((i) => /reads `parent`/.test(i.message));

      it('rejects it on an object that declares NO master_detail relationship', () => {
        const issues = parentScopeIssues({
          name: 'orphan_line',
          fields: {
            inv: { type: 'lookup', reference: 'inv' }, // a lookup is not a master
            qty: { type: 'number', readonlyWhen: "parent.status == 'paid'" },
          },
        });
        expect(issues).toHaveLength(1);
        expect(issues[0]!.severity).toBe('error');
        expect(issues[0]!.message).toMatch(/declares no `master_detail` relationships/);
      });

      it('rejects it when TWO masters leave "the parent" unstated', () => {
        const issues = parentScopeIssues({
          name: 'junction',
          fields: {
            left: { type: 'master_detail', reference: 'a' },
            right: { type: 'master_detail', reference: 'b' },
            qty: { type: 'number', readonlyWhen: "parent.status == 'paid'" },
          },
        });
        expect(issues).toHaveLength(1);
        expect(issues[0]!.message).toMatch(/declares 2 `master_detail` relationships/);
      });

      it('does not fire on a field literally named `parent_id`, or a `parent` string literal', () => {
        expect(parentScopeIssues({
          name: 'node',
          fields: {
            parent_id: { type: 'text' },
            kind: { type: 'text' },
            a: { type: 'text', readonlyWhen: "record.parent_id != ''" },
            b: { type: 'text', readonlyWhen: "record.kind == 'parent'" },
          },
        })).toHaveLength(0);
      });

      it('is scoped to `readonlyWhen` — `requiredWhen`/`visibleWhen` verdicts are unchanged', () => {
        expect(parentScopeIssues({
          name: 'orphan_line',
          fields: {
            qty: { type: 'number', requiredWhen: "parent.status == 'paid'", visibleWhen: "parent.status == 'paid'" },
          },
        })).toHaveLength(0);
      });
    });

    it('flags a bare-field sharing-rule condition', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'crm_account', fields: { region: { type: 'text' } } }],
        sharingRules: [{ name: 'sales_region', object: 'crm_account', condition: 'region == "EMEA"' }],
      });
      expect(issues.some(i => i.where.includes("sharingRule 'sales_region'") && /bare reference `region`/.test(i.message))).toBe(true);
    });

    it('flags a bare-field hook condition', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'crm_lead', fields: { status: { type: 'select' } } }],
        hooks: [{ name: 'on_close', object: 'crm_lead', condition: 'status == "closed"' }],
      });
      expect(issues.some(i => i.where.includes("hook 'on_close'") && /bare reference `status`/.test(i.message))).toBe(true);
    });

    // Issue #3583 — an array-valued `object` previously dropped to `undefined`,
    // so a multi-target hook got NO field-awareness at all: a condition
    // filtering on a field that exists on neither target passed clean.
    it('flags an unknown field in a multi-target hook condition', () => {
      const issues = validateStackExpressions({
        objects: [
          { name: 'crm_lead', fields: { status: { type: 'select' } } },
          { name: 'crm_account', fields: { status: { type: 'select' } } },
        ],
        hooks: [
          { name: 'on_campaign', object: ['crm_lead', 'crm_account'], condition: 'record.campaign == "spring"' },
        ],
      });
      const hookIssues = issues.filter(i => i.where.includes("hook 'on_campaign'"));
      expect(hookIssues.length).toBeGreaterThan(0);
      expect(hookIssues.some(i => /campaign/.test(i.message))).toBe(true);
      // Both targets are named, so the author knows where it breaks.
      expect(hookIssues.some(i => i.where.includes('crm_lead'))).toBe(true);
      expect(hookIssues.some(i => i.where.includes('crm_account'))).toBe(true);
    });

    it('accepts a multi-target hook condition on a field both targets share', () => {
      const issues = validateStackExpressions({
        objects: [
          { name: 'crm_lead', fields: { status: { type: 'select' } } },
          { name: 'crm_account', fields: { status: { type: 'select' } } },
        ],
        hooks: [
          { name: 'ok', object: ['crm_lead', 'crm_account'], condition: 'record.status == "closed"' },
        ],
      });
      expect(issues.filter(i => i.where.includes("hook 'ok'"))).toEqual([]);
    });

    it('does not repeat one object-independent error per hook target', () => {
      const issues = validateStackExpressions({
        objects: [
          { name: 'crm_lead', fields: { status: { type: 'select' } } },
          { name: 'crm_account', fields: { status: { type: 'select' } } },
        ],
        hooks: [
          { name: 'broken', object: ['crm_lead', 'crm_account'], condition: '{record.status} == "x"' },
        ],
      });
      const messages = issues.filter(i => i.where.includes("hook 'broken'")).map(i => i.message);
      expect(messages.length).toBe(new Set(messages).size);
    });

    it('still checks a wildcard hook target for syntax', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'crm_lead', fields: { status: { type: 'select' } } }],
        hooks: [{ name: 'star', object: '*', condition: '{record.status} == "x"' }],
      });
      expect(issues.some(i => i.where.includes("hook 'star'"))).toBe(true);
    });

    it('flags a bare-field nested `when` on a conditional validation rule', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_account',
          fields: { tier: { type: 'select' } },
          validations: [{ name: 'cond', type: 'conditional', when: 'tier == "gold"', then: { type: 'required' } }],
        }],
      });
      expect(issues.some(i => i.where.includes('when') && /bare reference `tier`/.test(i.message))).toBe(true);
    });
  });

  // The ADR-0062 D7 `field.columnName`-on-external-objects lint was removed with
  // `field.columnName` itself (#2377): external column mapping is `external.columnMap`.

  /**
   * Descriptor-declared expression slots (#4027). Before this, the flow walk
   * hardcoded `config.condition` and assumed every other node string was a
   * template, so `screen.fields[].visibleWhen` — declared bare CEL since #3304 —
   * was validated by nobody and #3528 shipped the wrong dialect through
   * `objectstack validate` in silence.
   */
  describe('descriptor-declared expression slots (#4027)', () => {
    const screenFlow = (fields: unknown[]) => ({
      objects,
      flows: [{
        name: 'lead_conversion',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: 'crm_lead' } },
          { id: 'screen_1', type: 'screen', config: { fields } },
        ],
        edges: [],
      }],
    });

    it('flags a `{var}` template dialect in a screen field visibleWhen', () => {
      // The exact predicate HotCRM shipped (#3528).
      const issues = validateStackExpressions(screenFlow([
        { name: 'createOpportunity', type: 'boolean', required: true },
        { name: 'opportunityName', type: 'text', required: true, visibleWhen: '{createOpportunity} == true' },
      ]));
      const found = issues.filter(i => i.where.includes('visibleWhen'));
      expect(found).toHaveLength(1);
      expect(found[0].severity).toBe('error');
      expect(found[0].where).toContain("flow 'lead_conversion'");
      expect(found[0].where).toContain("node 'screen_1'");
      // Indexed into the repeater, so the author knows WHICH field.
      expect(found[0].where).toContain('config.fields[1].visibleWhen');
      expect(found[0].source).toBe('{createOpportunity} == true');
    });

    it('passes the corrected bare-CEL predicate', () => {
      const issues = validateStackExpressions(screenFlow([
        { name: 'createOpportunity', type: 'boolean', required: true, defaultValue: false },
        { name: 'opportunityName', type: 'text', required: true, visibleWhen: 'createOpportunity == true' },
      ]));
      expect(issues.filter(i => i.where.includes('visibleWhen'))).toHaveLength(0);
    });

    it('does not report the screen field names as unknown object fields', () => {
      // A screen's `visibleWhen` binds the screen's OWN collected values, not the
      // trigger record's fields — so no schema hint is passed. Were one passed,
      // `createOpportunity` would be flagged as an unknown `crm_lead` field and
      // every correct predicate would carry a spurious finding.
      const issues = validateStackExpressions(screenFlow([
        { name: 'createOpportunity', type: 'boolean' },
        { name: 'opportunityName', visibleWhen: 'createOpportunity == true' },
      ]));
      expect(issues).toHaveLength(0);
    });

    /**
     * #4439 — `decision.conditions[].expression` reaches the ledger through the
     * SCHEMALESS channel (`decision` publishes no descriptor `configSchema`, so
     * the marker rides `.meta({ xExpression })` on the Zod contract). Until then
     * the ratchet could only see descriptor-declared slots, so this predicate —
     * documented bare CEL, evaluated as bare CEL since #4414 — was checked by
     * nobody and a `{…}` spelling passed `objectstack validate`.
     */
    const decisionFlow = (expression: string) => ({
      objects,
      flows: [{
        name: 'convert_lead',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: 'crm_lead' } },
          { id: 'check', type: 'decision', config: { conditions: [{ label: 'Yes', expression }] } },
        ],
        edges: [],
      }],
    });

    it('flags a `{var}` template dialect in a decision branch expression (#4439)', () => {
      // The exact predicate app-crm shipped (#4414).
      const issues = validateStackExpressions(decisionFlow("{lead_record.status} == 'converted'"));
      const found = issues.filter(i => i.where.includes('conditions[0].expression'));
      expect(found).toHaveLength(1);
      expect(found[0].severity).toBe('error');
      expect(found[0].where).toContain("flow 'convert_lead'");
      expect(found[0].where).toContain("node 'check'");
      expect(found[0].where).toContain('decision branch expression');
      expect(found[0].source).toBe("{lead_record.status} == 'converted'");
    });

    it('passes the corrected bare-CEL decision predicate (#4439)', () => {
      const issues = validateStackExpressions(decisionFlow("lead_record.status == 'converted'"));
      expect(issues.filter(i => i.where.includes('conditions'))).toHaveLength(0);
    });

    it('leaves a correct single-brace loop collection alone', () => {
      // `loop.collection` is the single-brace `{var}` flow-interpolation dialect,
      // where braces are CORRECT. It is recorded in the ledger as `flow-template`
      // and deliberately not validated — checking it as a CEL predicate (or as an
      // ADR-0032 §3 double-brace template) would fail every valid flow.
      const issues = validateStackExpressions({
        objects,
        flows: [{
          name: 'loop_flow',
          nodes: [
            { id: 'start', type: 'start', config: { objectName: 'crm_lead' } },
            { id: 'loop_1', type: 'loop', config: { collection: '{tasks}', iteratorVariable: 'task' } },
          ],
          edges: [],
        }],
      });
      expect(issues).toHaveLength(0);
    });

    /**
     * #4347 — the walk used to stop at a container, so a predicate written in
     * the wrong dialect inside a `loop` body passed `objectstack validate` and
     * shipped, while the identical predicate one level out was a build error.
     */
    describe('structured regions', () => {
      const flowWith = (container: Record<string, unknown>) => ({
        objects,
        flows: [{
          name: 'sweep',
          nodes: [{ id: 'start', type: 'start', config: { objectName: 'crm_lead' } }, container],
          edges: [],
        }],
      });
      const badRegion = () => ({
        nodes: [
          { id: 'gate', type: 'decision', config: { condition: '{record.rating} >= 4' } },
          { id: 'act', type: 'update_record' },
        ],
        edges: [{ id: 'b1', source: 'gate', target: 'act', condition: '{record.status} == "open"' }],
      });

      it('flags a brace-in-CEL predicate inside a loop body, naming the region', () => {
        const issues = validateStackExpressions(flowWith({
          id: 'loop_1', type: 'loop', config: { collection: '{rows}', body: badRegion() },
        }));
        // Both the body node's `config.condition` and the body edge's condition.
        expect(issues).toHaveLength(2);
        for (const issue of issues) expect(issue.where).toContain("loop 'loop_1' body");
        expect(issues.map(i => i.source)).toEqual(['{record.rating} >= 4', '{record.status} == "open"']);
      });

      it('flags them in parallel branches and try_catch regions too', () => {
        expect(validateStackExpressions(flowWith({
          id: 'par', type: 'parallel', config: { branches: [badRegion(), badRegion()] },
        }))).toHaveLength(4);

        const tc = validateStackExpressions(flowWith({
          id: 'tc', type: 'try_catch', config: { try: badRegion(), catch: badRegion() },
        }));
        expect(tc).toHaveLength(4);
        expect(tc.filter(i => i.where.includes("try_catch 'tc' catch"))).toHaveLength(2);
      });

      it('reaches a container nested inside another region', () => {
        const issues = validateStackExpressions(flowWith({
          id: 'outer', type: 'loop',
          config: {
            collection: '{rows}',
            body: {
              nodes: [{ id: 'inner', type: 'loop', config: { collection: '{cols}', body: badRegion() } }],
              edges: [],
            },
          },
        }));
        expect(issues).toHaveLength(2);
        for (const issue of issues) expect(issue.where).toContain("loop 'outer' body → loop 'inner' body");
      });

      it('leaves a correct region alone', () => {
        expect(validateStackExpressions(flowWith({
          id: 'loop_1', type: 'loop',
          config: {
            collection: '{rows}',
            body: {
              nodes: [
                { id: 'gate', type: 'decision', config: { condition: 'record.rating >= 4' } },
                { id: 'act', type: 'update_record' },
              ],
              edges: [{ id: 'b1', source: 'gate', target: 'act', condition: 'record.status == "open"' }],
            },
          },
        }))).toHaveLength(0);
      });
    });

    it('tolerates a screen with no fields, a non-array fields, and no config', () => {
      expect(validateStackExpressions(screenFlow([]))).toHaveLength(0);
      expect(validateStackExpressions({
        objects,
        flows: [{
          name: 'f',
          nodes: [{ id: 's', type: 'screen', config: { fields: 'nope' } }, { id: 's2', type: 'screen' }],
          edges: [],
        }],
      })).toHaveLength(0);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────
// #4763 — `has(x)` reads as a null guard and is not one.
//
// Scope note (constraint of the issue, pinned here so it stays a decision):
// this gate walks the AUTHORED METADATA the stack carries — object validation
// rules and lifecycle-hook conditions. It never reads source files, so the
// deliberately-bad fixtures in `packages/objectql/src/validation/rule-*.test.ts`
// (which pin the runtime's fail-closed behaviour and MUST keep the bad shape)
// are structurally out of its reach.
// ───────────────────────────────────────────────────────────────────────
describe('null-guard gate (#4763)', () => {
  // Mirrors `showcase_project`: dates and money are declared but nullable;
  // `status` carries a default option and `name` is required, so neither can
  // be null and neither may ever be flagged.
  const project = {
    name: 'showcase_project',
    fields: {
      name: { type: 'text', required: true },
      status: { type: 'select', options: [{ value: 'planned', default: true }, { value: 'active' }] },
      start_date: { type: 'date' },
      end_date: { type: 'date' },
      budget: { type: 'currency' },
      spent: { type: 'currency', defaultValue: 0 },
    },
  };
  const withRule = (rule: Record<string, unknown>) =>
    validateStackExpressions({ objects: [{ ...project, validations: [rule] }] });

  it('REJECTS the `has(a) && has(b) && a < b` shape over nullable declared fields', () => {
    const issues = withRule({
      type: 'script',
      name: 'end_after_start',
      condition: 'has(record.start_date) && has(record.end_date) && record.end_date < record.start_date',
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => (i.severity ?? 'error') === 'error')).toBe(true);
    const joined = issues.map((i) => i.message).join('\n');
    // names the rule …
    expect(joined).toContain("validation rule 'end_after_start'");
    // … the operand …
    expect(joined).toContain('record.end_date');
    expect(joined).toContain('record.start_date');
    // … and the fix, in the runtime's own words.
    expect(joined).toContain("Guard it with '!= null'");
    expect(joined).toContain('has(x)');
    expect(issues[0].where).toContain("object 'showcase_project'");
  });

  it('ACCEPTS the `!= null` form (the fix #4761 landed in the examples)', () => {
    expect(
      withRule({
        type: 'script',
        name: 'end_after_start',
        condition:
          'record.start_date != null && record.end_date != null && record.end_date < record.start_date',
      }),
    ).toHaveLength(0);
  });

  it('ACCEPTS a guarded arithmetic predicate (showcase `spent_within_budget`)', () => {
    expect(
      withRule({
        type: 'script',
        name: 'spent_within_budget',
        condition: 'record.budget != null && record.spent != null && record.spent > record.budget * 1.2',
      }),
    ).toHaveLength(0);
  });

  it('never flags a required field or one with a default (`spent`, `status`, `name`)', () => {
    expect(
      withRule({ type: 'script', name: 'spend_positive', condition: 'record.spent > 0' }),
    ).toHaveLength(0);
  });

  it('reaches the predicates nested in a `conditional` rule’s then/otherwise', () => {
    const issues = withRule({
      type: 'conditional',
      name: 'budget_sanity',
      when: "record.status == 'active'",
      then: { type: 'script', name: 'over_budget', condition: 'has(record.budget) && record.budget > 1' },
    });
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain('record.budget');
    expect(issues[0].where).toContain("'budget_sanity' then → 'over_budget'");
  });

  // Negative-case pin: the real `showcase_account` rule pair. Both use `has()`
  // — legitimately, to tell "key absent from the PATCH" apart from "explicit
  // null" — and both compare with EQUALITY only. They must stay legal; a rule
  // that flags them is too broad.
  it('leaves `showcase_account.churn_reason_consistency` alone (legitimate `has()`)', () => {
    const issues = validateStackExpressions({
      objects: [{
        name: 'showcase_account',
        fields: { status: { type: 'select', options: [{ value: 'churned' }] }, churn_reason: { type: 'text' } },
        validations: [{
          type: 'conditional',
          name: 'churn_reason_consistency',
          when: "record.status == 'churned'",
          then: {
            type: 'script',
            name: 'churn_reason_present',
            condition: "!has(record.churn_reason) || record.churn_reason == null || record.churn_reason == ''",
          },
          otherwise: {
            type: 'script',
            name: 'churn_reason_absent',
            condition: "has(record.churn_reason) && record.churn_reason != null && record.churn_reason != ''",
          },
        }],
      }],
    });
    expect(issues).toHaveLength(0);
  });

  describe('hook conditions — the third instance the issue named', () => {
    const hookStack = (condition: string) => ({
      objects: [project],
      hooks: [{ name: 'project_budget_alert', object: 'showcase_project', condition }],
    });

    // Regression pin. `examples/app-showcase/src/data/hooks/index.ts` carried
    // `has(record.spent) && has(record.budget) && record.spent > record.budget`
    // until #4770/#4786 corrected it. This asserts the bad shape cannot come
    // back: it is red today, and would have been red before that fix.
    it('REJECTS the pre-#4786 showcase hook shape', () => {
      const issues = validateStackExpressions(
        hookStack('has(record.spent) && has(record.budget) && record.spent > record.budget'),
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].where).toContain("hook 'project_budget_alert'");
      expect(issues.map((i) => i.message).join('\n')).toContain('record.budget');
    });

    it('ACCEPTS the corrected shape now on `main`', () => {
      expect(
        validateStackExpressions(
          hookStack('record.spent != null && record.budget != null && record.spent > record.budget'),
        ),
      ).toHaveLength(0);
    });

    it('applies per target for a multi-object hook', () => {
      const issues = validateStackExpressions({
        objects: [project, { name: 'other_obj', fields: { budget: { type: 'currency', required: true } } }],
        hooks: [{ name: 'multi', object: ['showcase_project', 'other_obj'], condition: 'record.budget > 1' }],
      });
      // Only the object that declares `budget` nullable is flagged.
      expect(issues).toHaveLength(1);
      expect(issues[0].where).toContain('showcase_project');
    });
  });

  // #4811 — the one surface the coverage review found to MEET the gate's
  // totality criterion: `evaluateValidationRules` evaluates a field's
  // `requiredWhen` against the same `materializeDeclaredFields`-merged record
  // the object's validation rules see. It is also the quietest failure of the
  // three covered surfaces: a faulting `requiredWhen` is fail-OPEN (logged and
  // skipped), so the field is simply never required and the write sails through.
  describe('field `requiredWhen` — covered since #4811', () => {
    const withField = (requiredWhen: string) =>
      validateStackExpressions({
        objects: [{ ...project, fields: { ...project.fields, note: { type: 'text', requiredWhen } } }],
      });

    it('REJECTS the `has(a) && has(b) && a < b` shape on a requiredWhen predicate', () => {
      const issues = withField(
        'has(record.start_date) && has(record.end_date) && record.end_date < record.start_date',
      );
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((i) => (i.severity ?? 'error') === 'error')).toBe(true);
      const joined = issues.map((i) => i.message).join('\n');
      // names the slot …
      expect(joined).toContain("field 'note' requiredWhen");
      // … the operands …
      expect(joined).toContain('record.end_date');
      expect(joined).toContain('record.start_date');
      // … and the fix, in the runtime's own words (identical to every other
      // surface this gate covers — one voice, #4763).
      expect(joined).toContain("Guard it with '!= null'");
      expect(joined).toContain('has(x)');
      expect(issues[0].where).toContain("object 'showcase_project' · field 'note' requiredWhen");
    });

    it('names `has()` explicitly as a non-guard when that is all the author wrote', () => {
      const issues = withField('has(record.budget) && record.budget > 100');
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('`has(record.budget)` does not guard it');
    });

    // The consequence clause is per-surface, and getting it wrong sends the
    // author to the wrong place. `requiredWhen` is fail-OPEN — `rule-validator`
    // logs and skips — so it must NOT borrow the validation rules' "the write
    // is rejected fail-closed" wording.
    it('reports the fail-OPEN consequence, not the validation rules’ fail-closed one', () => {
      const [issue] = withField('has(record.budget) && record.budget > 100');
      expect(issue.message).toContain('SKIPPED fail-open');
      expect(issue.message).toContain('the field is never actually required');
      expect(issue.message).not.toContain('rejected fail-closed');
    });

    it('leaves the fail-closed wording on the surfaces that really fail closed', () => {
      const [issue] = validateStackExpressions({
        objects: [{ ...project, validations: [{ type: 'script', name: 'r', condition: 'record.budget > 1' }] }],
      });
      expect(issue.message).toContain('rejected fail-closed');
      expect(issue.message).not.toContain('SKIPPED fail-open');
    });

    it('ACCEPTS the `!= null` form', () => {
      expect(
        withField('record.start_date != null && record.end_date != null && record.end_date < record.start_date'),
      ).toHaveLength(0);
    });

    it('never flags a required field or one carrying a default', () => {
      expect(withField('record.spent > 0')).toHaveLength(0);
    });

    // `has()` over a key the object does not declare is the macro's LEGITIMATE
    // use ("was this key in the PATCH?") and must never draw a null-guard
    // verdict — a false positive here is worse than a miss. Asserted on the
    // null-guard verdict specifically: the independent #1928 field-existence
    // pass has its own (pre-existing, correct) opinion about an undeclared
    // name on a record-scoped slot, and that is not what this pins.
    it('leaves `has()` on an UNDECLARED key alone — its legitimate use', () => {
      const nullGuardIssues = withField('has(record.some_transient_key)')
        .filter((i) => i.message.includes("Guard it with '!= null'"));
      expect(nullGuardIssues).toHaveLength(0);
    });

    // Live-metadata pin: `showcase_invoice_line.description` really does carry
    // `requiredWhen: record.quantity >= 100`, and `quantity` is `required: true`
    // WITH `defaultValue: 1`, so it can never be null. This predicate must stay
    // green — flagging it would be the false positive that is worse than a miss.
    it('leaves the real `showcase_invoice_line` requiredWhen alone', () => {
      expect(
        validateStackExpressions({
          objects: [{
            name: 'showcase_invoice_line',
            fields: {
              quantity: { type: 'number', required: true, defaultValue: 1 },
              description: { type: 'text', requiredWhen: 'record.quantity >= 100' },
            },
          }],
        }),
      ).toHaveLength(0);
    });
  });

  describe('surfaces deliberately NOT covered', () => {
    it('leaves sharing-rule conditions alone (compiled to a SQL filter, never faults)', () => {
      expect(
        validateStackExpressions({
          objects: [project],
          sharingRules: [{
            name: 'big_budget',
            object: 'showcase_project',
            condition: "record.status == 'active' && record.budget > 100000",
          }],
        }),
      ).toHaveLength(0);
    });

    // #4811 re-measured the reason this one is excluded. It is NOT the
    // flattened scope (this gate never resolves a bare identifier — only
    // `record.<f>`/`previous.<f>`, and the engine binds both roots
    // unconditionally). It is that `record-change-trigger.ts` seeds the flow's
    // record as `{ ...inputDoc, ...after }` with no `materializeDeclaredFields`,
    // so a declared column the write never mentioned is an ABSENT key — and on
    // an absent key the `!= null` this gate prescribes faults exactly like the
    // comparison it was meant to guard.
    it('leaves flow conditions alone (trigger record is not total over declared fields)', () => {
      expect(
        validateStackExpressions({
          objects: [project],
          flows: [{
            name: 'escalate',
            nodes: [
              { id: 'start', type: 'start', config: { objectName: 'showcase_project' } },
              { id: 'd', type: 'decision', config: { condition: 'record.budget > 100000' } },
            ],
            edges: [{ id: 'e1', source: 'd', target: 'end', condition: 'record.spent > record.budget' }],
          }],
        }),
      ).toHaveLength(0);
    });

    // Action predicates reach real CEL and fail closed, so the trap bites here
    // too — but the record bound is whatever the client fetched (a list row
    // carries only the view's projected columns) and nothing materializes it,
    // so `!= null` would be the wrong prescription. Excluded until that binding
    // is made total; see the ledger in `validate-null-guards.ts`.
    it('leaves action `visible` / `disabled` alone (client record is not total)', () => {
      expect(
        validateStackExpressions({
          objects: [{
            ...project,
            actions: [{
              name: 'escalate',
              visible: 'has(record.budget) && has(record.spent) && record.spent > record.budget',
              disabled: 'record.budget < 1000',
            }],
          }],
        }),
      ).toHaveLength(0);
    });

    // Same field as the covered `requiredWhen`, opposite verdict — the split is
    // the point. `readonlyWhen` is evaluated by `stripReadonlyWhenFields`, which
    // merges `{ ...previous, ...data }` and never materializes.
    it('leaves field `readonlyWhen` alone (strip path merges without materializing)', () => {
      expect(
        validateStackExpressions({
          objects: [{
            ...project,
            fields: { ...project.fields, note: { type: 'text', readonlyWhen: 'record.budget > 100' } },
          }],
        }),
      ).toHaveLength(0);
    });

    it('leaves `Field.formula` expressions alone (blessed `guard ? value : null`, #3306)', () => {
      expect(
        validateStackExpressions({
          objects: [{
            ...project,
            fields: {
              ...project.fields,
              remaining: { type: 'formula', formula: 'record.budget - record.spent' },
            },
          }],
        }),
      ).toHaveLength(0);
    });
  });
});
