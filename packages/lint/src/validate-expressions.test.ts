import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
// #6713 — the residual-root table below is generated from the REAL baseline, not
// a copy of it: "a future `SCOPE_ROOTS` member is covered for free" is the whole
// argument for the allowlist, and a hand-copied list would go green on exactly
// the root the rule never saw.
import { SCOPE_ROOTS } from '@objectstack/formula';
import { ExpressionInputSchema, ObjectStackSchema } from '@objectstack/spec';
import { FieldSchema, ObjectSchema, SelectOptionSchema } from '@objectstack/spec/data';
import { SharingRuleSchema } from '@objectstack/spec/security';

import { validateStackExpressions } from './validate-expressions.js';
import type { ExprIssue } from './validate-expressions.js';

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
        { name: 'crm_lead', fields: { rating: {} }, validations: [{ name: 'r1', condition: '{record.rating} > 0' }] },
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
    // #7030 — house sentence (#6856 route D): names the TOOL's behaviour, never
    // the retired key's fate. This branch can DELETE the key outright
    // (`template`/`recipients`/`variables`/`script`), so "rewrite it" reads two
    // ways ("it" = the key vs. "it" = your sources) while "rewrite existing
    // sources" has one antecedent. Pinned here AND class-wide in
    // `retired-key-migrate-sentence.test.ts` (widened to `packages/lint/src`).
    expect(issues[0].message).toMatch(
      /Run `os migrate meta --from 16` to rewrite existing sources automatically\.$/,
    );
    expect(issues[0].message).not.toMatch(/rewrite it automatically/);
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
            expected_revenue: { type: 'formula', name: 'expected_revenue', expression: 'amount * probability / 100' },
          },
        }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].where).toContain("field 'expected_revenue' expression");
      expect(issues[0].message).toMatch(/bare reference `(amount|probability)`/);
    });

    it('flags a bare reference in a validation predicate', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_lead',
          fields: { lead_score: { type: 'number' } },
          validations: [{ name: 'lead_score_range', condition: 'lead_score != null && lead_score > 100' }],
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
            expected_revenue: { type: 'formula', name: 'expected_revenue', expression: 'record.amount * record.probability / 100' },
          },
          validations: [{ name: 'amt', condition: 'record.amount != null && record.amount >= 0' }],
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
              expression: 'record.start_date != null && record.end_date != null ? (record.end_date - record.start_date) + 1 : null',
            },
          },
        }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
      expect(issues[0].where).toContain("field 'days' expression");
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
              expression: 'record.start_date != null && record.end_date != null ? daysBetween(record.start_date, record.end_date) + 1 : null',
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
          validations: [{ name: 'r', condition: 'lead_score > 100' }],
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
            score: { type: 'formula', expression: 'record.company * 2' },
          },
        }],
      });
      const w = issues.filter(i => i.severity === 'warning');
      expect(w).toHaveLength(1);
      expect(w[0].where).toMatch(/expression/);
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
            expected: { type: 'formula', expression: 'record.amount * record.probability / 100' },
          },
          // The `!= null` guard is load-bearing since #4763: `close_date` is a
          // declared NULLABLE field, and an un-guarded `>=` over it faults at
          // runtime (`null >= timestamp` has no overload) — the null-guard gate
          // rejects that shape at authoring now. Soundness (this block's
          // subject) and null-guarding are separate verdicts; the predicate has
          // to satisfy both to produce zero issues.
          validations: [{ name: 'future', condition: 'record.close_date != null && record.close_date >= today()' }],
        }],
      });
      expect(issues).toHaveLength(0);
    });

    it('warns on a validation predicate ordering a text field against a number', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_lead',
          fields: { title: { type: 'text' } },
          validations: [{ name: 'r', condition: 'record.title > 5' }],
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

      // #4977 — this pin used to read "scoped to `readonlyWhen`, `requiredWhen`
      // verdicts unchanged" over a fixture declaring BOTH. It pinned exactly the
      // limb that issue removes, so it is replaced rather than re-spelled: the
      // `requiredWhen` half moved to its own cases below, and what survives here
      // is the genuinely-unchanged slot, `visibleWhen`, on a fixture that
      // declares only that.
      it('is still scoped OUT of `visibleWhen` — that verdict is unchanged', () => {
        expect(parentScopeIssues({
          name: 'orphan_line',
          fields: {
            qty: { type: 'number', visibleWhen: "parent.status == 'paid'" },
          },
        })).toHaveLength(0);
      });
    });

    // #4977 — the same gate, extended to the slot the same issue gave a server
    // `parent` binding. `requiredWhen` stays FAIL-OPEN at runtime, so this build
    // gate is the only thing that stops an unbindable declaration from shipping
    // and enforcing nothing forever — which is why the message must name that
    // consequence and not `readonlyWhen`'s opposite one.
    describe('parent-scoped `requiredWhen` needs a resolvable master (#4977)', () => {
      const parentScopeIssues = (obj: Record<string, unknown>) =>
        validateStackExpressions({ objects: [obj] }).filter((i) => /reads `parent`/.test(i.message));

      it('rejects it on an object that declares NO master_detail relationship', () => {
        const issues = parentScopeIssues({
          name: 'orphan_line',
          fields: {
            inv: { type: 'lookup', reference: 'inv' }, // a lookup is not a master
            description: { type: 'text', requiredWhen: "parent.status == 'sent'" },
          },
        });
        expect(issues).toHaveLength(1);
        expect(issues[0]!.severity).toBe('error');
        expect(issues[0]!.where).toMatch(/field 'description' requiredWhen/);
        expect(issues[0]!.message).toMatch(/declares no `master_detail` relationships/);
        // The CONSEQUENCE clause is what separates this from its `readonlyWhen`
        // twin: fail-open there, fail-closed here, opposite fixes.
        expect(issues[0]!.message).toMatch(/the requirement would never be enforced/);
        expect(issues[0]!.message).not.toMatch(/locked on every write/);
      });

      it('rejects it when TWO masters leave "the parent" unstated', () => {
        const issues = parentScopeIssues({
          name: 'junction',
          fields: {
            left: { type: 'master_detail', reference: 'a' },
            right: { type: 'master_detail', reference: 'b' },
            description: { type: 'text', requiredWhen: "parent.status == 'sent'" },
          },
        });
        expect(issues).toHaveLength(1);
        expect(issues[0]!.message).toMatch(/declares 2 `master_detail` relationships/);
      });

      it('ACCEPTS it on a real detail object — the showcase shape must stay lintable', () => {
        expect(parentScopeIssues({
          name: 'showcase_invoice_line',
          fields: {
            invoice: { type: 'master_detail', reference: 'showcase_invoice' },
            description: { type: 'text', requiredWhen: "parent.status == 'sent'" },
          },
        })).toHaveLength(0);
      });

      it('does not fire on a field named `parent_id` or a `parent` string literal', () => {
        expect(parentScopeIssues({
          name: 'node',
          fields: {
            parent_id: { type: 'text' },
            kind: { type: 'text' },
            a: { type: 'text', requiredWhen: "record.parent_id != ''" },
            b: { type: 'text', requiredWhen: "record.kind == 'parent'" },
          },
        })).toHaveLength(0);
      });

      it('reports BOTH slots when one field declares two unbindable predicates', () => {
        const issues = parentScopeIssues({
          name: 'orphan_line',
          fields: {
            qty: {
              type: 'number',
              readonlyWhen: "parent.status == 'paid'",
              requiredWhen: "parent.status == 'sent'",
            },
          },
        });
        expect(issues).toHaveLength(2);
        expect(issues.map((i) => i.where.replace(/.* field 'qty' /, '')).sort())
          .toEqual(['readonlyWhen', 'requiredWhen']);
      });
    });

    /**
     * ── `current_user` is a per-SURFACE verdict, not a missing root (#6290) ───
     *
     * `@objectstack/formula`'s `SCOPE_ROOTS` now declares `current_user`
     * (ADR-0068 D1's canonical spelling, which `buildScope` really mounts and
     * which `introspectScope` already advertised). That deliberately removes
     * the field-level rejection's OLD cause — an omission in a global baseline,
     * doing a per-surface job by accident, and prescribing
     * "Write `record.current_user`" while it did so: a shape that binds on no
     * layer, so an author who obeyed the message ended up worse off.
     *
     * The verdict itself is not removed. It moves to the surface that owns it,
     * with the prescriptions that exist — and the two surfaces now disagree on
     * purpose, because their evaluators disagree (#6146):
     *
     *   field level  → `evalFieldPredicate`: `record` + `previous` + `parent`.
     *                  `current_user` unbound ⇒ fault ⇒ fail-OPEN ⇒ rejected here.
     *   option level → `resolveCascadingOptions` against the host predicate
     *                  scope, which binds `current_user` ⇒ accepted.
     */
    describe('`current_user` at field level vs option level (#6290)', () => {
      const gated = "'admin' in current_user.positions";

      it('still REJECTS a field-level `visibleWhen` that reads `current_user`', () => {
        const issues = validateStackExpressions({
          objects: [{
            name: 'showcase_deal',
            fields: { amount: { type: 'number', visibleWhen: gated } },
          }],
        });
        const hit = issues.filter((i) => i.where.includes("field 'amount' visibleWhen"));
        expect(hit).toHaveLength(1);
        expect(hit[0]!.severity).toBe('error');
      });

      /**
       * The prescription is the half this issue was filed for. Asserted as a
       * NEGATIVE plus three positives, because "the message changed" is not the
       * property that matters — "the message names a shape that actually binds"
       * is. `record.current_user` is the shape that binds nowhere.
       */
      it('prescribes surfaces that exist — and never `record.current_user`', () => {
        const [issue] = validateStackExpressions({
          objects: [{
            name: 'showcase_deal',
            fields: { amount: { type: 'number', visibleWhen: gated } },
          }],
        }).filter((i) => i.where.includes('visibleWhen'));
        expect(issue!.message).not.toContain('record.current_user');
        // 1. what actually goes wrong, in the direction it goes wrong
        expect(issue!.message).toMatch(/falls back to VISIBLE/);
        // 2. the one `*When` surface that binds `current_user`
        expect(issue!.message).toMatch(/option's own `visibleWhen`/);
        // 3. the surface that hides a whole field by role — FLS on a permission
        //    set (`PermissionSetSchema.fields`, `permission.zod.ts:455`)
        expect(issue!.message).toMatch(/readable: false/);
      });

      it('rejects it on `readonlyWhen` / `requiredWhen` too — same evaluator, same unbound root', () => {
        const issues = validateStackExpressions({
          objects: [{
            name: 'showcase_deal',
            fields: {
              amount: { type: 'number', readonlyWhen: gated },
              note: { type: 'text', requiredWhen: gated },
            },
          }],
        });
        expect(issues.filter((i) => /current_user/.test(i.message)).map((i) => i.where.replace(/.*· /, '')).sort())
          .toEqual(["field 'amount' readonlyWhen", "field 'note' requiredWhen"]);
      });

      /**
       * The pin for the legal usage. Shape copied from
       * `examples/app-showcase/src/data/objects/cascading-select.object.ts:85`,
       * the role-gated option that has been shipping since ADR-0068 and had
       * never met this rule — because until #6290 nothing walked options at all.
       */
      it('ACCEPTS the showcase role-gated OPTION — per-option binds `current_user`', () => {
        const issues = validateStackExpressions({
          objects: [{
            name: 'showcase_cascading_select',
            fields: {
              tier: {
                type: 'select',
                options: [
                  { label: 'Standard', value: 'standard', default: true },
                  { label: 'Restricted (admin only)', value: 'restricted', visibleWhen: gated },
                ],
              },
            },
          }],
        });
        expect(issues).toHaveLength(0);
      });

      it('accepts the cascading (record-scoped) options from the same showcase field', () => {
        const issues = validateStackExpressions({
          objects: [{
            name: 'showcase_cascading_select',
            fields: {
              country: { type: 'select', options: [{ label: 'China', value: 'cn' }] },
              province: {
                type: 'select',
                dependsOn: ['country'],
                options: [
                  { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
                  { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
                ],
              },
            },
          }],
        });
        expect(issues).toHaveLength(0);
      });
    });

    /**
     * ── The ADR-0068 aliases get the SAME field-level verdict (#6585) ────────
     *
     * D1 makes `user` and `ctx.user` aliases of `current_user` — `buildScope`
     * hangs one `EvalUser` reference on all three spellings — so the semantic
     * error above is the same error under any of them. #6584's first cut
     * matched only the canonical spelling: `'admin' in user.positions` and
     * `'admin' in ctx.user.positions` sailed through in silence (both roots
     * have always been in `SCOPE_ROOTS`, so the bare-ref check never fired
     * either), and which spelling the author picked decided whether they got a
     * diagnostic. These tests close that fork and pin its edges.
     *
     * `ctx` is pinned WHOLE-ROOT deliberately: at field level `buildScope`
     * never creates `ctx` at all (it exists only when the evaluation carries a
     * user, which no field-level site passes), so `ctx.locale` faults exactly
     * like `ctx.user.id`. The other side of that decision is pinned too —
     * `ctx.user` on an ACTION `visible` (ActionEngine's surface, where `ctx`
     * genuinely binds — the platform's own `sys_user` actions ship it) must
     * stay accepted.
     */
    describe('`user` / `ctx.user` aliases at field level (#6585)', () => {
      const slots = ['visibleWhen', 'readonlyWhen', 'requiredWhen'] as const;

      it.each(slots)('rejects `user` on %s — same object as `current_user`, same unbound surface', (slot) => {
        const issues = validateStackExpressions({
          objects: [{
            name: 'showcase_deal',
            fields: { amount: { type: 'number', [slot]: "'admin' in user.positions" } },
          }],
        });
        const hit = issues.filter((i) => i.where === `object 'showcase_deal' · field 'amount' ${slot}`);
        expect(hit).toHaveLength(1);
        expect(hit[0]!.severity).toBe('error');
        // The message names the spelling the author WROTE — a diagnostic that
        // talks about `current_user` to an author who typed `user` sends them
        // hunting for text that is not in their file.
        expect(hit[0]!.message).toMatch(/`\w+` reads `user`/);
      });

      it.each(slots)('rejects `ctx.user` on %s', (slot) => {
        const issues = validateStackExpressions({
          objects: [{
            name: 'showcase_deal',
            fields: { amount: { type: 'number', [slot]: "'admin' in ctx.user.positions" } },
          }],
        });
        const hit = issues.filter((i) => i.where === `object 'showcase_deal' · field 'amount' ${slot}`);
        expect(hit).toHaveLength(1);
        expect(hit[0]!.severity).toBe('error');
        expect(hit[0]!.message).toMatch(/`\w+` reads `ctx`/);
      });

      /**
       * The whole-root half of the `ctx` decision: a `ctx` read that never
       * touches `.user` is just as unbound at field level — `buildScope` only
       * creates the root when a user is carried, and no field-level site
       * carries one — so it must not slip through a `.user`-form-only match.
       */
      it('rejects a bare-`ctx` NON-user read too — the root itself is unbound at field level', () => {
        const issues = validateStackExpressions({
          objects: [{
            name: 'showcase_deal',
            fields: { amount: { type: 'number', visibleWhen: "ctx.locale == 'en'" } },
          }],
        });
        const hit = issues.filter((i) => i.where.includes("field 'amount' visibleWhen"));
        expect(hit).toHaveLength(1);
        expect(hit[0]!.message).toMatch(/`visibleWhen` reads `ctx`/);
      });

      it.each(["'admin' in user.positions", "'admin' in ctx.user.positions"])(
        'gives %s the SAME prescriptions as the canonical spelling — no per-spelling fork',
        (predicate) => {
          const [issue] = validateStackExpressions({
            objects: [{
              name: 'showcase_deal',
              fields: { amount: { type: 'number', visibleWhen: predicate } },
            }],
          }).filter((i) => i.where.includes('visibleWhen'));
          // Same three prescriptions the #6290 message test pins for
          // `current_user`, plus the same direction-of-failure sentence.
          expect(issue!.message).toMatch(/falls back to VISIBLE/);
          expect(issue!.message).toMatch(/option's own `visibleWhen`/);
          expect(issue!.message).toMatch(/readable: false/);
          expect(issue!.message).not.toContain('record.current_user');
        },
      );

      /**
       * The whole-root widening makes root-vs-MEMBER discrimination newly
       * load-bearing: `record.user_id` and `record.ctx_key` name the very
       * strings this rule now rejects, but as MEMBERS of `record` — and
       * `collectCelRootIdentifiers` drops member names by design. A rule that
       * confused the two would reject the single most ordinary predicate an
       * author writes (an owner check), which is the failure mode that would
       * make this widening worse than the hole it closes.
       */
      it('does NOT trip on a `record` MEMBER merely spelled like one of the roots', () => {
        const issues = validateStackExpressions({
          objects: [{
            name: 'showcase_deal',
            fields: {
              user_id: { type: 'text' },
              ctx_key: { type: 'text' },
              amount: {
                type: 'number',
                visibleWhen: "record.user_id != '' && record.ctx_key == 'x'",
              },
            },
          }],
        });
        expect(issues).toHaveLength(0);
      });

      /**
       * The widening is FIELD-level only. Option-level `visibleWhen` resolves
       * against the host predicate scope, where `buildScope` mounts the SAME
       * user object under every ADR-0068 spelling — so an option predicate is
       * legal under the aliases exactly as it is under `current_user`.
       */
      it('still ACCEPTS an option-level `visibleWhen` spelling the `user` alias', () => {
        const issues = validateStackExpressions({
          objects: [{
            name: 'showcase_cascading_select',
            fields: {
              tier: {
                type: 'select',
                options: [
                  { label: 'Standard', value: 'standard', default: true },
                  { label: 'Restricted', value: 'restricted', visibleWhen: "'admin' in user.positions" },
                ],
              },
            },
          }],
        });
        expect(issues).toHaveLength(0);
      });

      /**
       * The blast-radius pin the #6585 measurement was for: `ctx` IS
       * ActionEngine's predicate root, and the platform's own metadata ships
       * `ctx.user` action predicates (`sys-user.object.ts` "visible:
       * record.id == ctx.user.id", `sys-invitation.object.ts`). The field-level
       * rejection must not leak onto the action surface.
       */
      it('still ACCEPTS `ctx.user` on an action `visible` — ActionEngine binds `ctx`', () => {
        const issues = validateStackExpressions({
          objects: [{
            name: 'sys_user',
            fields: { email: { type: 'text' } },
            actions: [{
              // The exact shape `packages/platform-objects/src/identity/
              // sys-user.object.ts:291` ships (`id` is a registry-injected
              // column, so the field-existence pass resolves it too).
              name: 'change_password',
              type: 'script',
              visible: 'record.id == ctx.user.id',
            }],
          }],
        });
        expect(issues).toHaveLength(0);
      });
    });

    /**
     * ── Denylist → ALLOWLIST, and the residual roots it uncovers (#6713) ─────
     *
     * #6584 matched one root, #6585 three. The truth is a three-item WHITELIST
     * — `record` / `previous` / `parent` — pinned by three independent anchors
     * (server `rule-validator.ts` binds, objectui's five field-level call sites,
     * objectui's authoring `FIELD_RULE_ROOTS`). Everything else in `SCOPE_ROOTS`
     * was equally unbound, equally faulting, and equally SILENT: a declared root
     * resolves in the strict env, so the bare-reference check never fired on it
     * either, and the denylist did not know it.
     *
     * These tests are written against the IMPORTED `SCOPE_ROOTS`, not a copy of
     * it, because "a future root is covered for free" is the whole argument for
     * the allowlist and a hand-copied list in the test would assert the opposite
     * of what it claims — it would go green on a root the rule never saw.
     */
    describe('field-level `*When` roots are an ALLOWLIST over SCOPE_ROOTS (#6713)', () => {
      /** The three the surface really binds. Everything else must be rejected. */
      const BOUND = ['record', 'previous', 'parent'] as const;
      const RESIDUAL = SCOPE_ROOTS.filter((r) => !(BOUND as readonly string[]).includes(r));

      const fieldIssues = (predicate: string, slot = 'visibleWhen') =>
        validateStackExpressions({
          objects: [{
            name: 'showcase_deal',
            fields: {
              amount: { type: 'number' },
              // Declared so the field-existence pass has no verdict of its own
              // on the comprehension-macro case below.
              tags: { type: 'text' },
              gate: { type: 'text', [slot]: predicate },
            },
          }],
        }).filter((i) => i.where === `object 'showcase_deal' · field 'gate' ${slot}`);

      it('the residual set is non-empty and much larger than the denylist it replaces', () => {
        // Guards the table below from going vacuous: if `SCOPE_ROOTS` ever
        // shrank to the three bound roots there would be nothing to reject and
        // every `it.each` case would silently disappear.
        expect(RESIDUAL.length).toBeGreaterThan(20);
        // The three the old denylist held — a small minority of what is unbound.
        expect(RESIDUAL).toEqual(expect.arrayContaining(['current_user', 'user', 'ctx']));
      });

      it.each(RESIDUAL)('rejects `%s` on a field-level `visibleWhen` — unbound at this surface', (root) => {
        const hit = fieldIssues(`${root}.some_key == 'x'`);
        expect(hit).toHaveLength(1);
        expect(hit[0]!.severity).toBe('error');
        expect(hit[0]!.message).toContain(`\`visibleWhen\` reads \`${root}\``);
      });

      it.each(BOUND)('ACCEPTS `%s` — the three roots the evaluators really bind', (root) => {
        // `visibleWhen` on purpose: `parent` on `readonlyWhen`/`requiredWhen`
        // meets the separate #4889/#4977 master-detail gate, which is a
        // different rule with a different verdict and would confuse this pin.
        expect(fieldIssues(`${root}.amount > 0`)).toHaveLength(0);
      });

      /**
       * The two named cases #6713 called out as credible author typos rather
       * than theoretical members of the residual set.
       */
      it('rejects `os.user.id` — ADR-0068 D1\'s FOURTH user spelling, the one #6585 left', () => {
        const hit = fieldIssues("os.user.id == '1'");
        expect(hit).toHaveLength(1);
        expect(hit[0]!.message).toContain('`visibleWhen` reads `os`');
      });

      it('rejects `data` — the LEGAL root of this same key on a METADATA form', () => {
        const hit = fieldIssues("data.type == 'select'");
        expect(hit).toHaveLength(1);
        expect(hit[0]!.message).toContain('`visibleWhen` reads `data`');
      });

      /**
       * The partition, both halves. The rule judges `SCOPE_ROOTS` membership,
       * NOT strict-env declaredness — and that is a measured distinction, not a
       * style choice: the strict env also declares CEL's TYPE names, so
       * `type(record.x) == string` reports `string` as a root that resolves.
       * A declaredness oracle would reject that legitimate predicate.
       */
      it('leaves a BARE field reference to the bare-reference check — one issue, not two', () => {
        const hit = validateStackExpressions({
          objects: [{
            name: 'showcase_deal',
            fields: { status: { type: 'text' }, gate: { type: 'text', visibleWhen: "status == 'x'" } },
          }],
        }).filter((i) => i.where.includes("field 'gate' visibleWhen"));
        expect(hit).toHaveLength(1);
        expect(hit[0]!.message).toMatch(/bare reference `status`/);
        // …and NOT the allowlist rule's wording, which prescribes the wrong fix
        // for a bare field.
        expect(hit[0]!.message).not.toContain('binds only `record`');
      });

      it('does NOT reject a CEL TYPE name used as a value — `type(record.x) == string`', () => {
        // `collectCelRootIdentifiers` reports `string` as a top-level id and the
        // strict env declares it, so a declaredness-based rule WOULD reject this
        // legal predicate. SCOPE_ROOTS membership is what separates the two.
        expect(fieldIssues('type(record.amount) == string')).toHaveLength(0);
      });

      it('does NOT reject a comprehension-macro variable', () => {
        expect(fieldIssues("record.tags.all(t, t != '')")).toHaveLength(0);
      });

      /**
       * Root-vs-MEMBER discrimination, re-pinned at allowlist width. #6585
       * pinned `record.user_id` / `record.ctx_key`; the allowlist rejects ~20
       * more names, so the number of ordinary field names that LOOK like a
       * rejected root grows with it. Confusing the two would reject the most
       * ordinary predicates an author writes.
       */
      it('does NOT trip on `record` MEMBERS merely spelled like residual roots', () => {
        const issues = validateStackExpressions({
          objects: [{
            name: 'showcase_deal',
            fields: {
              data_source: { type: 'text' },
              os_version: { type: 'text' },
              vars_count: { type: 'number' },
              trigger_key: { type: 'text' },
              gate: {
                type: 'text',
                visibleWhen:
                  "record.data_source != '' && record.os_version != '' && " +
                  "record.vars_count > 0 && record.trigger_key == 'x'",
              },
            },
          }],
        });
        expect(issues).toHaveLength(0);
      });

      it('reports ONE root per slot, preferring the canonical user spelling', () => {
        // Two rejected roots in one predicate. The tie-break is documented
        // (user roots first, canonical first) so the message is stable rather
        // than dependent on AST walk order.
        const hit = fieldIssues("data.type == 'select' && 'admin' in current_user.positions");
        expect(hit).toHaveLength(1);
        expect(hit[0]!.message).toContain('reads `current_user`');
      });
    });

    /**
     * ── The prescription tiers by ROOT (#6713 axis 2) ────────────────────────
     *
     * The pre-#6713 prescriptions are user-oriented because the pre-#6713
     * denylist held only user roots. Answering `data.type == 'select'` with
     * "move it to the option's `visibleWhen`" answers a question nobody asked.
     */
    describe('prescription tiers by root (#6713)', () => {
      const messageFor = (predicate: string, slot = 'visibleWhen') =>
        validateStackExpressions({
          objects: [{
            name: 'showcase_deal',
            fields: { amount: { type: 'number' }, gate: { type: 'text', [slot]: predicate } },
          }],
        }).filter((i) => i.where === `object 'showcase_deal' · field 'gate' ${slot}`)[0]!.message;

      it.each(['current_user', 'user', 'ctx', 'os'])(
        'user root `%s` keeps the two USER prescriptions plus the `record` rewrite',
        (root) => {
          const m = messageFor(`'admin' in ${root}.positions`);
          expect(m).toMatch(/option's own `visibleWhen`/);
          expect(m).toMatch(/readable: false/);
          expect(m).toMatch(/rewrite the predicate against `record`/);
        },
      );

      it('`data` gets the metadata-form explanation — and NOT the user prescriptions', () => {
        const m = messageFor("data.type == 'select'");
        expect(m).toMatch(/METADATA form/);
        expect(m).toMatch(/`record\.<field>`/);
        // The half this tier exists for: the user-oriented advice is absent,
        // because it answers a question this author did not ask.
        expect(m).not.toMatch(/option's own `visibleWhen`/);
        expect(m).not.toMatch(/readable: false/);
      });

      it.each(['vars', 'trigger', 'context', 'input'])(
        'general root `%s` gets the rewrite prescription, not the user one',
        (root) => {
          const m = messageFor(`${root}.step_one == 'done'`);
          expect(m).toMatch(/bound at OTHER evaluation sites/);
          expect(m).toMatch(/Rewrite the predicate against `record`/);
          expect(m).not.toMatch(/readable: false/);
          expect(m).not.toMatch(/METADATA form/);
        },
      );
    });

    /**
     * ── The causal sentence tiers by SLOT (#6716) ────────────────────────────
     *
     * One sentence used to serve all three slots: "the predicate faults and
     * falls back to VISIBLE, leaving the field the test was meant to hide
     * showing for everyone". It is precise for exactly one of them. All three
     * cells re-measured for this change, at BOTH ends of each slot:
     *
     *   visibleWhen  client `fallback: true` ⇒ VISIBLE; server never evaluates
     *                a FIELD-level `visibleWhen` at all (`hasFieldRules` gates
     *                on `requiredWhen || readonlyWhen || option visibility`).
     *                ⇒ the old sentence was RIGHT here.
     *   readonlyWhen server `isReadonlyWhenLocked` ⇒ LOCKED (#4889's carve-out,
     *                whose trigger IS the unbound-root case) and
     *                `stripReadonlyWhenFields` deletes the value from the
     *                payload; client `fallback: false` ⇒ editable. The two ends
     *                fault in OPPOSITE directions and ADR-0057 D10 gives it to
     *                the server. ⇒ the old sentence was BACKWARDS here.
     *   requiredWhen server logs the unbound root and `continue`s (#4977 did not
     *                copy the carve-out); client `fallback: false`. Both ends
     *                fail open and neither is about visibility. ⇒ the old
     *                sentence named the wrong PROPERTY here.
     *
     * Honest note on the reverse direction: reverting the per-slot map cannot
     * turn the `visibleWhen` assertions red, because the shared sentence WAS the
     * `visibleWhen` one. The load-bearing pins are therefore the two negative
     * assertions on `readonlyWhen` / `requiredWhen` — those are what a revert
     * fails.
     */
    describe('per-slot causal sentence (#6716)', () => {
      const messageFor = (slot: string) =>
        validateStackExpressions({
          objects: [{
            name: 'showcase_deal',
            fields: { gate: { type: 'text', [slot]: "'admin' in current_user.positions" } },
          }],
        }).filter((i) => i.where === `object 'showcase_deal' · field 'gate' ${slot}`)[0]!.message;

      it('`visibleWhen` — fail-OPEN to visible, the one slot the shared sentence fitted', () => {
        const m = messageFor('visibleWhen');
        expect(m).toMatch(/falls back to VISIBLE/);
        expect(m).toMatch(/showing for everyone/);
      });

      it('`readonlyWhen` — says LOCKED, and never says the field stays visible', () => {
        const m = messageFor('readonlyWhen');
        expect(m).toMatch(/LOCKED/);
        expect(m).toMatch(/#4889/);
        // The defect this card was filed for. The server treats the field as
        // locked and drops the write; telling the author it is "showing for
        // everyone" inverts both the urgency and the troubleshooting direction.
        expect(m).not.toMatch(/falls back to VISIBLE/);
        expect(m).not.toMatch(/showing for everyone/);
      });

      it('`readonlyWhen` — names the client/server disagreement, not just the server verdict', () => {
        // ADR-0057 D10: the form renders the field editable (`fallback: false`)
        // while the server locks it. An author who only reads "LOCKED" cannot
        // reconcile that with the editable input in front of them.
        const m = messageFor('readonlyWhen');
        expect(m).toMatch(/OPPOSITE directions/);
        expect(m).toMatch(/editable/);
      });

      it('`requiredWhen` — says the requirement is never enforced, not anything about visibility', () => {
        const m = messageFor('requiredWhen');
        expect(m).toMatch(/never enforced/);
        expect(m).toMatch(/saves with the field empty/);
        expect(m).not.toMatch(/VISIBLE/);
        expect(m).not.toMatch(/showing for everyone/);
      });

      it('no two slots share a causal sentence', () => {
        const clause = (slot: string) => messageFor(slot).split(' is unbound here, so ')[1]!;
        const clauses = ['visibleWhen', 'readonlyWhen', 'requiredWhen'].map(clause);
        expect(new Set(clauses).size).toBe(3);
      });

      /**
       * The per-slot axis is orthogonal to the per-root axis: a `data` typo on
       * `readonlyWhen` needs the metadata-form prescription AND the locked-field
       * consequence. A message-per-combination design would have dropped one.
       */
      it('the two axes compose — `data` on `readonlyWhen` carries both halves', () => {
        const m = validateStackExpressions({
          objects: [{
            name: 'showcase_deal',
            fields: { gate: { type: 'text', readonlyWhen: "data.type == 'select'" } },
          }],
        }).filter((i) => i.where.includes("field 'gate' readonlyWhen"))[0]!.message;
        expect(m).toMatch(/LOCKED/);            // slot axis
        expect(m).toMatch(/METADATA form/);      // root axis
      });
    });

    /**
     * ── The option-level traversal itself (#6290 half 3) ────────────────────
     *
     * Accepting `current_user` at the option level cannot be the only evidence
     * the walk runs — an absent walk accepts everything. These are the findings
     * the walk PRODUCES; delete the loop and every one of them disappears.
     */
    describe('per-option `visibleWhen` is walked at all (#6290)', () => {
      const optionIssues = (visibleWhen: unknown) => validateStackExpressions({
        objects: [{
          name: 'shop_item',
          fields: {
            country: { type: 'text' },
            tier: {
              type: 'select',
              options: [{ label: 'Restricted', value: 'restricted', visibleWhen }],
            },
          },
        }],
      });

      it('flags a BARE field reference in an option predicate', () => {
        const issues = optionIssues("country == 'cn'");
        expect(issues).toHaveLength(1);
        expect(issues[0]!.where).toBe("object 'shop_item' · field 'tier' option 'restricted' visibleWhen");
        expect(issues[0]!.message).toMatch(/bare reference `country`/);
      });

      it('flags a reference to a field the object does not declare', () => {
        const issues = optionIssues("record.no_such_field == 'cn'");
        expect(issues).toHaveLength(1);
        expect(issues[0]!.message).toMatch(/no_such_field/);
      });

      it('flags a syntactically broken option predicate', () => {
        const issues = optionIssues("record.country == 'cn'  &&&");
        expect(issues).toHaveLength(1);
        expect(issues[0]!.severity).toBe('error');
      });

      it('flags a template-dialect option predicate (wrong dialect for a bare-CEL slot)', () => {
        const issues = optionIssues('{{ record.country }}');
        expect(issues).toHaveLength(1);
      });

      /**
       * The finding is located by the option's `value`, not by its index, so an
       * author with eight options is told WHICH one to edit. The index fallback
       * exists for a valueless option (which the schema rejects, but the rule
       * runs on pre-parse stacks too and must not report `option 'undefined'`).
       */
      it('locates each finding by the offending option, one finding per option', () => {
        const issues = validateStackExpressions({
          objects: [{
            name: 'shop_item',
            fields: {
              tier: {
                type: 'select',
                options: [
                  { label: 'Ok', value: 'ok', visibleWhen: "record.kind == 'a'" },
                  { label: 'Bad', value: 'bad', visibleWhen: "kind == 'a'" },
                  { label: 'Worse', value: 'worse', visibleWhen: "other == 'b'" },
                ],
              },
              kind: { type: 'text' },
            },
          }],
        });
        expect(issues.map((i) => i.where.replace(/.*· field 'tier' /, ''))).toEqual([
          "option 'bad' visibleWhen",
          "option 'worse' visibleWhen",
        ]);
      });

      it('is silent on options that carry no predicate at all', () => {
        expect(validateStackExpressions({
          objects: [{
            name: 'shop_item',
            fields: {
              tier: { type: 'select', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b', default: true }] },
            },
          }],
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
    // record as `{ ...(inputData ?? {}), ...after }` (spelled `inputDoc` until
    // #5671 dropped that alias read) with no `materializeDeclaredFields`,
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

    it('leaves field `expression` alone for the NULL-GUARD verdict (blessed `guard ? value : null`, #3306)', () => {
      // Load-bearing since #5026: this pass now genuinely RUNS on `expression`
      // (it read the rejected `formula` spelling before, so the fixture was
      // silent for the wrong reason). Zero issues here therefore means the
      // null-guard gate really is excluded from this surface, not that the
      // surface is unreachable. `budget` / `spent` are both nullable and `-` is
      // applied to them unguarded — exactly the shape the gate rejects on
      // `requiredWhen`.
      expect(
        validateStackExpressions({
          objects: [{
            ...project,
            fields: {
              ...project.fields,
              remaining: { type: 'formula', expression: 'record.budget - record.spent' },
            },
          }],
        }),
      ).toHaveLength(0);
    });
  });
});

/**
 * ── The structural meta-guard (#4992 pattern, #5009/#5018 shape) — #5017 ─────
 *
 * This rule is registered `input: 'parsed'` (`authoring-rules.ts`), so on the
 * compile path it sees `ObjectStackSchema`'s output. #5017 found five `??`
 * alias chains here reaching for keys the spec does not declare. Four were the
 * familiar inert kind. The fifth was not:
 *
 *     rule.expression ?? rule.predicate ?? rule.condition ?? rule.formula
 *
 * — the canonical `condition` in THIRD position, behind two names
 * `validation.zod.ts` rejects. See the reverse-verification block below for
 * the behaviour that cost.
 *
 * Two guards pin the property that made all five removable:
 *
 * 1. **Declared-key guard** — every key read off a stack, object, field,
 *    validation rule, sharing rule, action, hook, flow, node or edge must
 *    appear in that surface's own Zod `.shape`. Scanning the SOURCE rather than
 *    the behaviour is deliberate: an unreachable branch has no behaviour to
 *    assert on, which is exactly the problem.
 *
 * 2. **Reachability guard** — every changed read must be reached by a fixture
 *    that passes `ObjectStackSchema.safeParse` outright.
 *
 * **Scope, stated rather than implied.** The declared-key guard covers every
 * receiver in the file except the flow-node CONFIG (`cfg` / `startCfg`), which
 * is excused for a reason that is itself a schema fact — see
 * `NOT_A_SINGLE_SHAPE` below. The reachability guard is scoped to the reads
 * #5017 changed plus the surfaces they sit on; this rule is 660 lines with
 * `issues.push` sites that carry no rule id or path template (its finding shape
 * predates `{ rule, path, hint }`), so the #5018-style push-site scan does not
 * transfer, and a full push-site inventory belongs to #5017's own suggestion 3
 * — one shared guard across every `input: 'parsed'` rule.
 */
const RULE_SOURCE = readFileSync(new URL('./validate-expressions.ts', import.meta.url), 'utf8');

/** The rule's CODE — comments stripped, since the guards scan reads, not prose. */
const RULE_CODE = RULE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function keysReadOff(receiver: string): string[] {
  const re = new RegExp(`\\b${receiver}\\??\\.([A-Za-z_$][\\w$]*)`, 'g');
  return [...new Set([...RULE_CODE.matchAll(re)].map((m) => m[1]))].sort();
}

/**
 * Declared keys of a schema, unwrapping optional / array / record / lazy /
 * union layers. A union answers the UNION of its members' keys: a validation
 * rule is exactly one of six variants, and a key any variant declares is one
 * some author may legitimately write.
 *
 * `lazySchema` proxies a FUNCTION target, so the `typeof` guard admits both —
 * miss that and every lazily-built schema answers "declares nothing", which
 * would silently make this guard vacuous.
 */
function shapeKeysOf(schema: unknown, depth = 0): string[] {
  const s = schema as { shape?: Record<string, unknown>; _def?: Record<string, unknown>; unwrap?: () => unknown };
  if (!s || (typeof s !== 'object' && typeof s !== 'function') || depth > 12) return [];
  if (s.shape) return Object.keys(s.shape);
  const d = (s._def ?? {}) as Record<string, unknown>;
  if (d.type === 'union' && Array.isArray(d.options)) {
    return [...new Set((d.options as unknown[]).flatMap((o) => shapeKeysOf(o, depth + 1)))];
  }
  const getter = d.getter as (() => unknown) | undefined;
  for (const next of [d.innerType, d.element, d.valueType, getter?.(), d.in, d.out]) {
    const r = shapeKeysOf(next, depth + 1);
    if (r.length) return r;
  }
  if (typeof s.unwrap === 'function') return shapeKeysOf(s.unwrap(), depth + 1);
  return [];
}

const flowShape = () => {
  const s = ObjectStackSchema.shape.flows as unknown as { _def?: Record<string, unknown> };
  // flows: optional(array(lazy(object))) — walk to the element's own shape.
  let cur: unknown = s;
  for (let i = 0; i < 12; i++) {
    const c = cur as { shape?: Record<string, unknown>; _def?: Record<string, unknown> };
    if (c?.shape) return c.shape;
    const d = (c?._def ?? {}) as Record<string, unknown>;
    cur = d.innerType ?? d.element ?? (d.getter as (() => unknown) | undefined)?.();
  }
  return {} as Record<string, unknown>;
};

/**
 * The one receiver this table does not cover, and why it is a schema fact
 * rather than an exemption of convenience.
 *
 * A flow node's `config` has no single `.shape`: it is discriminated on the
 * node's `type`, and the expression slots inside it are resolved through the
 * descriptor registry (`resolveFlowNodeExpressions`, #4027) rather than read by
 * name. The named reads that do remain — `cfg.function` / `cfg.functionName`
 * and the retired `actionType` / `template` / `recipients` / `variables` /
 * `script` — are NOT the #5017 defect: `functionName` is a key
 * `schemaless-node-config.zod.ts` DECLARES and the ADR-0087 D2 conversion
 * `flow-node-script-config-aliases` (#3796) rewrites at load, and the retired
 * five are deliberately detected on the pre-parse tier so `os lint` can hand
 * the author a named replacement instead of a bare "unrecognized key" (#4343).
 * Reading a key to REJECT it is the opposite of reading a key to honour it.
 */
const NOT_A_SINGLE_SHAPE = ['cfg', 'startCfg'];

const READ_SURFACES: Array<{ receiver: string; expected: string[]; declaredBy: string; keys: () => string[] }> = [
  {
    receiver: 'stack',
    expected: ['actions', 'flows', 'hooks', 'objects', 'sharingRules'],
    declaredBy: 'ObjectStackSchema',
    keys: () => Object.keys(ObjectStackSchema.shape),
  },
  {
    receiver: 'obj',
    // `validationRules` is absent — one of the five #5017 removed.
    expected: ['actions', 'fields', 'name', 'validations'],
    declaredBy: 'ObjectSchema',
    keys: () => Object.keys(ObjectSchema.shape),
  },
  {
    receiver: 'def',
    // `referenceTo` is absent — likewise.
    expected: ['defaultValue', 'options', 'reference', 'required', 'type'],
    declaredBy: 'FieldSchema',
    keys: () => Object.keys(FieldSchema.shape),
  },
  {
    receiver: 'rule',
    // `expression` / `predicate` / `formula` are absent — the chain that put
    // the canonical `condition` in third place (#5017).
    expected: ['condition', 'name', 'when'],
    declaredBy: 'the ObjectSchema.validations[] union',
    keys: () => shapeKeysOf(ObjectSchema.shape.validations),
  },
  {
    receiver: 'sharingRule',
    // `criteria` / `predicate` are absent — likewise.
    expected: ['condition', 'name', 'object'],
    declaredBy: 'SharingRuleSchema',
    keys: () => Object.keys(SharingRuleSchema.shape),
  },
  {
    receiver: 'action',
    // `object` is absent — the action schema's canonical key is `objectName`.
    expected: ['disabled', 'name', 'objectName', 'visible'],
    declaredBy: 'ObjectStackSchema.actions[]',
    keys: () => shapeKeysOf(ObjectStackSchema.shape.actions),
  },
  {
    receiver: 'hook',
    expected: ['condition', 'name', 'object'],
    declaredBy: 'ObjectStackSchema.hooks[]',
    keys: () => shapeKeysOf(ObjectStackSchema.shape.hooks),
  },
  {
    receiver: 'flow',
    expected: ['name', 'nodes'],
    declaredBy: 'ObjectStackSchema.flows[]',
    keys: () => shapeKeysOf(ObjectStackSchema.shape.flows),
  },
  { receiver: 'node', expected: ['config', 'id', 'type'], declaredBy: 'flows[].nodes[]', keys: () => shapeKeysOf(flowShape().nodes) },
  { receiver: 'startNode', expected: ['config'], declaredBy: 'flows[].nodes[]', keys: () => shapeKeysOf(flowShape().nodes) },
  {
    receiver: 'edge',
    expected: ['condition', 'id', 'source', 'target'],
    declaredBy: 'flows[].edges[]',
    keys: () => shapeKeysOf(flowShape().edges),
  },
  {
    receiver: 'rec',
    expected: ['dialect', 'source'],
    declaredBy: 'ExpressionInputSchema',
    keys: () => shapeKeysOf(ExpressionInputSchema),
  },
  {
    // [#6290] Per-option `visibleWhen` — the option surface had no traversal at
    // all until then, so it enters the guard with its first two reads. `value`
    // only locates the finding; `visibleWhen` is the predicate being checked.
    receiver: 'opt',
    expected: ['value', 'visibleWhen'],
    declaredBy: 'SelectOptionSchema',
    keys: () => Object.keys(SelectOptionSchema.shape),
  },
];

/**
 * Undeclared reads still tracked rather than fixed. **Empty since #5026** —
 * every key this rule reads is one `@objectstack/spec` declares.
 *
 * The last entry was `f.formula`: `FieldSchema` declares the computed slot as
 * `expression` and rejects `formula` by name ("Did you mean `formula` →
 * `expression`?"), so the field-formula pass had never run against a stack that
 * parses. #5026 converged it onto `expression`, which ACTIVATED the check
 * rather than deleting a dead branch — hence its own PR, with a sweep of every
 * real stack in the repo attached (8 field `expression` slots across
 * `app-showcase` / `app-crm` / `app-todo`; zero new findings).
 *
 * This list must shrink, never grow. It is at zero: any entry at all now means
 * someone treated it as a place to park an exception rather than a debt to pay
 * down, and the `expected: []` assertions below make that a deliberate act.
 */
const TRACKED_UNDECLARED_READS: Array<{ receiver: string; key: string; issue: number }> = [];

describe('validateStackExpressions — reads only keys the spec declares (meta-test, #5017)', () => {
  it.each(READ_SURFACES)('every key read off `$receiver` is declared by $declaredBy', (surface) => {
    const read = keysReadOff(surface.receiver);
    // Exact match, so ADDING a read (or renaming a loop variable, which would
    // silently disarm the scan) forces a deliberate visit to this table.
    expect(read).toEqual(surface.expected);
    const declared = surface.keys();
    expect(declared.length, `${surface.declaredBy} resolved to no keys — the guard would be vacuous`).toBeGreaterThan(0);
    expect(read.filter((k) => !declared.includes(k))).toEqual([]);
  });

  it('the field receiver reads only declared keys — the tracked debt is now empty (#5026)', () => {
    const read = keysReadOff('f');
    // `options` joined in #6290 — the per-option `visibleWhen` traversal. It is
    // a LITERAL `f.options` read on purpose, for the same reason the two
    // `*When` slots below are literal: an `(f as AnyRec).options` cast would
    // have hidden the new surface from this very scan.
    expect(read).toEqual(['expression', 'name', 'options', 'readonlyWhen', 'requiredWhen']);
    const declared = Object.keys(FieldSchema.shape);
    const tracked = TRACKED_UNDECLARED_READS.filter((t) => t.receiver === 'f').map((t) => t.key);
    expect(tracked).toEqual([]);
    expect(read.filter((k) => !declared.includes(k) && !tracked.includes(k))).toEqual([]);
    // The canonical key is the declared one, and the spelling this read used to
    // carry is genuinely absent — so a revert to `f.formula` fails here, loudly,
    // rather than quietly re-inerting the pass.
    expect(declared).toContain('expression');
    expect(declared).not.toContain('formula');
  });

  it('nothing is tracked as an undeclared read any more — the list shrinks, never grows', () => {
    expect(TRACKED_UNDECLARED_READS).toEqual([]);
  });

  it('the computed key lists are spelled from the declaring schema', () => {
    // `rule[branch]` and `(f as AnyRec)[key]` are COMPUTED reads the scan above
    // cannot see; the word lists they index with are checked here instead.
    const branches = /for \(const branch of \[([^\]]*)\] as const\)/.exec(RULE_CODE);
    expect(branches, 'the nested-rule branch loop moved — update this guard').not.toBeNull();
    const branchKeys = [...branches![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(branchKeys).toEqual(['then', 'otherwise']);
    expect(branchKeys.filter((k) => !shapeKeysOf(ObjectSchema.shape.validations).includes(k))).toEqual([]);

    const fieldKeys = /for \(const key of \[([^\]]*)\] as const\)/.exec(RULE_CODE);
    expect(fieldKeys, 'the field-predicate loop moved — update this guard').not.toBeNull();
    const slots = [...fieldKeys![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(slots).toEqual(['requiredWhen', 'readonlyWhen', 'conditionalRequired', 'visibleWhen']);
    expect(slots.filter((k) => !Object.keys(FieldSchema.shape).includes(k))).toEqual([]);
  });

  it('covers every receiver in the source that is not explicitly excused', () => {
    const receivers = [...new Set([...RULE_CODE.matchAll(/\b([a-z][\w$]*)\??\.[A-Za-z_$]/g)].map((m) => m[1]))];
    const tabled = new Set([...READ_SURFACES.map((s) => s.receiver), ...NOT_A_SINGLE_SHAPE, 'f']);
    // Locals whose "keys" are JS methods / this file's own plumbing.
    const PLUMBING = new Set([
      'issues', 'idx', 'out', 'kept', 'seen', 'seenActions', 'nullable', 'nullableFields', 'nullableIndex',
      'fieldIndex', 'fieldTypeIndex', 'fields', 'nodes', 'options', 'targets', 'retired', 'ref', 'roots',
      'res', 'graph', 'found', 'e', 'w', 'p', 'n', 'issue', 'guards', 'config',
      // [#8116] The unprovisioned-anchor pass: CEL AST walk locals (`celNode` /
      // `celRecv` / `pending` — named to stay clear of the `node` metadata
      // receiver above) and the provenance index (`unprovisionedIndex` /
      // `anchors`), whose keys are Map/Set methods, never metadata keys.
      'pending', 'celNode', 'celRecv', 'anchors', 'unprovisionedIndex',
    ]);
    expect(receivers.filter((r) => !tabled.has(r) && !PLUMBING.has(r))).toEqual([]);
  });
});

/**
 * ── The alias spellings this rule deliberately does NOT read (#5017) ─────────
 */
const MANIFEST = { id: 'expr_probe', name: 'expr_probe', version: '1.0.0', type: 'app' } as const;

/** A fixture is only a fixture if the spec accepts it. */
function specValid(stack: Record<string, unknown>): Record<string, unknown> {
  const result = ObjectStackSchema.safeParse({ manifest: MANIFEST, ...stack });
  if (!result.success) {
    throw new Error(
      `fixture is not spec-valid (#5017): ` +
        result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return result.data as unknown as Record<string, unknown>;
}

/**
 * The alias spellings, the canonical key each is rejected in favour of, and
 * what this rule says about a stack that uses one AFTER #5017.
 *
 * `lintAfter` is spelled per case rather than assumed uniform, because it is
 * not uniform, and the difference is the honest part. Six of the seven fall
 * silent — the read they fed is gone, so the author's only diagnostic comes
 * from the schema, by name. The seventh (`actions[].object`) keeps a
 * diagnostic: dropping the alias costs the rule the action's OBJECT, not the
 * predicate, so the object-INDEPENDENT half of the check (bare-reference scope)
 * still fires while the field-existence half no longer can.
 */
const REJECTED_ALIASES: Array<{ label: string; stack: Record<string, unknown>; refusal: RegExp; lintAfter: RegExp | null }> = [
  {
    label: 'objects[].validationRules → validations',
    stack: {
      objects: [{ name: 'crm_lead', label: 'Lead', sharingModel: 'private', fields: { lead_score: { type: 'number', label: 'S' } },
        validationRules: [{ type: 'script', name: 'r', message: 'm', condition: 'lead_score > 100' }] }],
    },
    refusal: /Unrecognized key\(s\) on this object: `validationRules`.*Did you mean `validationRules` → `validations`/s,
    lintAfter: null,
  },
  {
    label: 'validations[].expression → condition',
    stack: {
      objects: [{ name: 'crm_lead', label: 'Lead', sharingModel: 'private', fields: { lead_score: { type: 'number', label: 'S' } },
        validations: [{ type: 'script', name: 'r', message: 'm', expression: 'lead_score > 100' }] }],
    },
    refusal: /Did you mean `expression` → `condition`/,
    lintAfter: null,
  },
  {
    label: 'validations[].predicate → condition',
    stack: {
      objects: [{ name: 'crm_lead', label: 'Lead', sharingModel: 'private', fields: { lead_score: { type: 'number', label: 'S' } },
        validations: [{ type: 'script', name: 'r', message: 'm', predicate: 'lead_score > 100' }] }],
    },
    refusal: /Did you mean `predicate` → `condition`/,
    lintAfter: null,
  },
  {
    label: 'validations[].formula → condition',
    stack: {
      objects: [{ name: 'crm_lead', label: 'Lead', sharingModel: 'private', fields: { lead_score: { type: 'number', label: 'S' } },
        validations: [{ type: 'script', name: 'r', message: 'm', formula: 'lead_score > 100' }] }],
    },
    refusal: /Did you mean `formula` → `condition`/,
    lintAfter: null,
  },
  {
    label: 'sharingRules[].criteria → condition',
    stack: {
      sharingRules: [{ name: 'sr', type: 'criteria', object: 'crm_lead', sharedWith: { type: 'team', value: 't' }, criteria: 'lead_score > 1' }],
    },
    refusal: /Unrecognized key\(s\) on this sharing rule: `criteria`.*Did you mean `criteria` → `condition`/s,
    lintAfter: null,
  },
  {
    label: 'fields[].referenceTo → reference',
    stack: {
      objects: [{ name: 'child', label: 'C', sharingModel: 'controlled_by_parent',
        fields: { p: { type: 'master_detail', label: 'P', referenceTo: 'invoice' } } }],
    },
    refusal: /Unrecognized key\(s\) on this field: `referenceTo`.*Did you mean `referenceTo` → `reference`/s,
    lintAfter: null,
  },
  {
    // #5026. The newest member of this table, and the one that reads
    // differently from the rest: the other spellings were rejected AND unread,
    // while this one was rejected and READ — the only key the rule honoured.
    // Converging the read onto `expression` moved it here, where it belongs.
    label: 'objects[].fields[].formula → expression',
    stack: {
      objects: [{ name: 'crm_opportunity', label: 'Opp', sharingModel: 'private',
        fields: {
          amount: { type: 'currency', label: 'Amount' },
          // A defect the rule WOULD name if it still read this key: bare refs.
          expected_revenue: { type: 'formula', label: 'Expected', formula: 'amount * 2' },
        } }],
    },
    refusal: /Unrecognized key\(s\) on this field: `formula`.*Did you mean `formula` → `expression`/s,
    // Silent: the rule reads `expression` now, so an author who spells `formula`
    // hears it from the schema, by name, once — not twice in two vocabularies.
    lintAfter: null,
  },
  {
    label: 'actions[].object → objectName',
    stack: {
      actions: [{ name: 'mark_done', label: 'Mark', object: 'crm_lead', type: 'script', target: 'fn', visible: 'lead_score > 1' }],
    },
    refusal: /Unrecognized key\(s\) on this action: `object`.*Did you mean `object` → `objectName`/s,
    // Object-INDEPENDENT half survives; the field-existence half cannot.
    lintAfter: /bare reference `lead_score`/,
  },
];

describe('validateStackExpressions — undeclared keys are the schema’s job, not this rule’s (#5017)', () => {
  it.each(REJECTED_ALIASES)('$label: the schema refuses it BY NAME, so no consumer needs a fallback', ({ stack, refusal }) => {
    const result = ObjectStackSchema.safeParse({ manifest: MANIFEST, ...stack });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message).join(' ')).toMatch(refusal);
  });

  it.each(REJECTED_ALIASES)('$label: the lint defers to the schema', ({ stack, lintAfter }) => {
    // Reverse verification, canonical-first direction (#5018's lesson): before
    // #5017 each of these produced a lint diagnostic keyed on the ALIAS, for a
    // stack `os validate` refuses by name. Alias tolerance belongs at the
    // producer's refusal, not in a consumer (Prime Directive #12).
    const issues = validateStackExpressions(stack);
    if (lintAfter === null) {
      expect(issues).toEqual([]);
    } else {
      expect(issues.map((i) => i.message).join(' ')).toMatch(lintAfter);
    }
  });
});

/**
 * ── Where removing an alias limb ADDS a diagnostic rather than removing one ──
 *
 * #5018's reverse verification ran one way: canonical-first chains over-reached
 * on illegal spellings, and the fix handed those back to the schema. One of
 * #5017's chains feeds a COUNT rather than a predicate, so removing the alias
 * limb moves the count and can make a downstream gate fire that did not before.
 * Pinned here rather than left to be discovered, and it only ever applies to a
 * stack `os validate` already refuses by name.
 */
describe('validateStackExpressions — the alias limb that fed a count, not a predicate (#5017)', () => {
  const withRefKey = (key: string) => ({
    objects: [{
      name: 'line_item',
      fields: {
        invoice_ref: { type: 'master_detail', [key]: 'invoice' },
        locked: { type: 'text', readonlyWhen: 'parent.posted == true' },
      },
    }],
  });

  it('`reference`: one master ⇒ `parent` binds ⇒ silent, exactly as before', () => {
    expect(validateStackExpressions(withRefKey('reference'))).toEqual([]);
  });

  it('`referenceTo`: the master is no longer counted, so the parent-scope gate now fires', () => {
    // BEFORE #5017 the alias limb counted this field, the object looked like it
    // had exactly one master, and the gate stayed silent. Now the count is 0
    // and the author is told `parent` cannot bind. On a stack that PARSES the
    // two agree — a parsing stack cannot spell `referenceTo` at all (see the
    // rejected-alias block above) — so the difference exists only on the
    // pre-parse tier, where the stack is already refused by name for this very
    // key. An added diagnostic on an invalid stack, not a new verdict on a
    // valid one: acceptable, and pinned so it stays a decision rather than a
    // surprise.
    const issues = validateStackExpressions(withRefKey('referenceTo'));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/declares no `master_detail` relationship/);
  });
});

/**
 * ── Reverse verification for the one chain whose behaviour really changed ────
 *
 *     rule.expression ?? rule.predicate ?? rule.condition ?? rule.formula
 *
 * The other four chains put the canonical key FIRST, so their alias limbs were
 * simply unreachable. This one put it THIRD. For a rule carrying both spellings
 * the alias SHORT-CIRCUITED the canonical key away: the lint validated the
 * predicate the schema rejects and never looked at the one the author declared.
 * Producer and consumer gave two different accounts of the same metadata.
 *
 * The old chain is reconstructed here rather than described, so the difference
 * is demonstrated rather than asserted.
 */
const OLD_CHAIN = (rule: Record<string, unknown>): unknown =>
  rule.expression ?? rule.predicate ?? rule.condition ?? rule.formula;

describe('validateStackExpressions — the alias short-circuit that #5017 removed', () => {
  const ruleWithBoth = {
    type: 'script', name: 'r', message: 'm',
    condition: 'record.no_such_field > 0',   // the CANONICAL predicate — and it is broken
    expression: 'record.lead_score > 0',     // a REJECTED alias — and it is clean
  };
  const stackWithBoth = {
    objects: [{ name: 'crm_lead', fields: { lead_score: { type: 'number' } }, validations: [ruleWithBoth] }],
  };

  it('the old chain picked the rejected alias over the declared key', () => {
    expect(OLD_CHAIN(ruleWithBoth)).toBe('record.lead_score > 0');
    expect(OLD_CHAIN(ruleWithBoth)).not.toBe(ruleWithBoth.condition);
  });

  it('so the broken CANONICAL predicate went unreported — the rule read the alias instead', () => {
    // What the rule used to say about this stack: nothing about
    // `no_such_field`. Its verdict was entirely about the alias's source.
    const oldVerdict = validateStackExpressions({
      objects: [{ name: 'crm_lead', fields: { lead_score: { type: 'number' } },
        validations: [{ ...ruleWithBoth, condition: OLD_CHAIN(ruleWithBoth) }] }],
    });
    expect(oldVerdict.map((i) => i.message).join(' ')).not.toMatch(/no_such_field/);
  });

  it('now it reads the declared key, and the real defect surfaces', () => {
    const issues = validateStackExpressions(stackWithBoth);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/unknown field `no_such_field`/);
  });

  it('and either way the stack does not parse — the alias is refused by name', () => {
    const result = ObjectStackSchema.safeParse({
      manifest: MANIFEST,
      objects: [{ name: 'crm_lead', label: 'Lead', sharingModel: 'private',
        fields: { lead_score: { type: 'number', label: 'S' } }, validations: [ruleWithBoth] }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message).join(' ')).toMatch(/Did you mean `expression` → `condition`/);
  });

  it('on every stack that DOES parse the verdict is unchanged: the alias limbs were dead', () => {
    // The same defect, spelled the only way the spec accepts.
    const issues = validateStackExpressions(
      specValid({
        objects: [{ name: 'crm_lead', label: 'Lead', sharingModel: 'private',
          fields: { lead_score: { type: 'number', label: 'S' } },
          validations: [{ type: 'script', name: 'r', message: 'm', condition: 'record.no_such_field > 0' }] }],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/unknown field `no_such_field`/);
  });
});

/**
 * ── Reachability: every changed read fires from a stack that parses ──────────
 *
 * Removing a fallback is only safe if the canonical limb is genuinely live.
 * Each fixture below goes through `specValid` (a real `ObjectStackSchema.parse`)
 * and must still produce the finding the changed read feeds.
 */
describe('validateStackExpressions — every changed read is reachable from a spec-valid stack (meta-test, #5017)', () => {
  const LEAD = { name: 'crm_lead', label: 'Lead', sharingModel: 'private', fields: { lead_score: { type: 'number', label: 'S' } } };

  it('objects[].validations[].condition — the canonical predicate is read', () => {
    const issues = validateStackExpressions(
      specValid({ objects: [{ ...LEAD, validations: [{ type: 'script', name: 'r', message: 'm', condition: 'record.nope > 0' }] }] }),
    );
    expect(issues.map((i) => i.message).join(' ')).toMatch(/unknown field `nope`/);
    expect(issues[0].where).toContain("validation 'r'");
  });

  it('nested conditional `then` still reaches the null-guard gate through `condition`', () => {
    const issues = validateStackExpressions(
      specValid({
        objects: [{
          ...LEAD,
          validations: [{
            type: 'conditional', name: 'c', message: 'm', when: 'record.lead_score != null',
            then: { type: 'script', name: 'inner', message: 'm2', condition: 'record.lead_score > 0' },
          }],
        }],
      }),
    );
    // `lead_score` is nullable (no `required`, no default) and `>` is applied to
    // it inside the nested rule — the #4763 verdict, reached via `rule.condition`.
    expect(issues.map((i) => i.message).join(' ')).toMatch(/compares a value that is null/);
  });

  it('sharingRules[].condition — the canonical predicate is read', () => {
    const issues = validateStackExpressions(
      specValid({
        objects: [LEAD],
        sharingRules: [{ name: 'sr', type: 'criteria', object: 'crm_lead', sharedWith: { type: 'team', value: 't' }, condition: 'nope > 0' }],
      }),
    );
    expect(issues.map((i) => i.message).join(' ')).toMatch(/bare reference `nope`/);
    expect(issues[0].where).toContain("sharingRule 'sr'");
  });

  it('actions[].objectName — the canonical key still binds the action to its object', () => {
    const issues = validateStackExpressions(
      specValid({
        objects: [LEAD],
        actions: [{ name: 'mark_done', label: 'Mark', objectName: 'crm_lead', type: 'script', target: 'fn', visible: 'record.nope' }],
      }),
    );
    // The object binding is what makes `nope` reportable as an unknown FIELD
    // rather than merely unparsed — i.e. `objectName` really was read.
    expect(issues.map((i) => i.message).join(' ')).toMatch(/unknown field `nope`/);
  });

  it('fields[].reference — the master-detail count still sees the parent', () => {
    // Exactly one master ⇒ `parent` binds ⇒ NO finding. That verdict depends on
    // `masterDetailCount` reading `reference`; if the read were broken the count
    // would be 0 and this would fire.
    expect(
      validateStackExpressions(
        specValid({
          objects: [{
            name: 'line_item', label: 'Line', sharingModel: 'controlled_by_parent',
            fields: {
              invoice_ref: { type: 'master_detail', label: 'Invoice', reference: 'invoice' },
              locked: { type: 'text', label: 'Locked', readonlyWhen: 'parent.posted == true' },
            },
          }],
        }),
      ),
    ).toEqual([]);

    // Two masters ⇒ no single `parent` ⇒ the gate fires. Same read, other side.
    const issues = validateStackExpressions(
      specValid({
        objects: [{
          name: 'line_item', label: 'Line', sharingModel: 'controlled_by_parent',
          fields: {
            invoice_ref: { type: 'master_detail', label: 'Invoice', reference: 'invoice' },
            order_ref: { type: 'master_detail', label: 'Order', reference: 'sales_order' },
            locked: { type: 'text', label: 'Locked', readonlyWhen: 'parent.posted == true' },
          },
        }],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/declares 2 `master_detail` relationships/);
  });

  it('fields[].expression — the field-formula pass fires from a stack that PARSES (#5026)', () => {
    // The whole point of #5026. Before it, no spec-valid stack could reach this
    // branch at all: it was keyed on `formula`, which the schema refuses. This
    // fixture goes through a real `ObjectStackSchema.parse` and still produces
    // the finding — the first time that sentence has been true.
    const issues = validateStackExpressions(
      specValid({
        objects: [{
          name: 'crm_opportunity', label: 'Opp', sharingModel: 'private',
          fields: {
            amount: { type: 'currency', label: 'Amount' },
            probability: { type: 'percent', label: 'Probability' },
            expected_revenue: { type: 'formula', label: 'Expected', expression: 'amount * probability / 100' },
          },
        }],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].where).toBe("object 'crm_opportunity' · field 'expected_revenue' expression");
    expect(issues[0].message).toMatch(/bare reference `(amount|probability)`/);
  });
});

/**
 * ── Reverse verification for the ACTIVATION itself (#5026) ───────────────────
 *
 * #5017's five removals were behaviour-neutral on every parsing stack, so their
 * reverse verification only had to show the alias limbs were dead. This one is
 * the opposite shape: converging `f.formula` → `f.expression` turned a branch
 * that had NEVER run into one that runs on every compile. So the verification
 * owes four things, not one:
 *
 *   1. a broken `expression` on a spec-valid stack is now RED, and named;
 *   2. a correct one is GREEN (the gate is not simply on);
 *   3. the `formula:` spelling is handled by the SCHEMA, by name — this rule
 *      says nothing about it, so the author hears one diagnostic, not two;
 *   4. mutating the read back to `f.formula` is caught by the declared-key
 *      meta-guard above — i.e. this cannot silently re-inert.
 *
 * Point 4 is asserted against the same source scan the guard uses rather than
 * described, because "a guard that would have caught it" is exactly the claim
 * that is worth nothing unless executed.
 */
describe('validateStackExpressions — the field-formula check now actually runs (#5026)', () => {
  const OPP = (expression: string) => ({
    objects: [{
      name: 'crm_opportunity', label: 'Opp', sharingModel: 'private',
      fields: {
        amount: { type: 'currency', label: 'Amount' },
        probability: { type: 'percent', label: 'Probability' },
        expected_revenue: { type: 'formula', label: 'Expected', expression },
      },
    }],
  });

  it('1 — a broken `expression` is RED on a stack the spec accepts', () => {
    const issues = validateStackExpressions(specValid(OPP('record.no_such_field * 2')));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/unknown field `no_such_field`/);
    expect(issues[0].where).toContain("field 'expected_revenue' expression");
  });

  it('1b — and a syntactically broken one is RED too', () => {
    const issues = validateStackExpressions(specValid(OPP('record.amount *')));
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].where).toContain("field 'expected_revenue' expression");
  });

  it('2 — a correct `expression` is GREEN (the gate discriminates, it is not just on)', () => {
    // The shape every real app in this repo actually ships — verified against
    // all 8 field `expression` slots in `examples/app-{showcase,crm,todo}` when
    // the check was activated, all of which stayed green.
    expect(validateStackExpressions(specValid(OPP('record.amount * record.probability / 100')))).toEqual([]);
  });

  it('3 — the `formula:` spelling is the SCHEMA’s to refuse; this rule stays silent', () => {
    const badSpelling = {
      objects: [{
        name: 'crm_opportunity', label: 'Opp', sharingModel: 'private',
        fields: {
          amount: { type: 'currency', label: 'Amount' },
          expected_revenue: { type: 'formula', label: 'Expected', formula: 'amount * 2' },
        },
      }],
    };
    const parsed = ObjectStackSchema.safeParse({ manifest: MANIFEST, ...badSpelling });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((i) => i.message).join(' ')).toMatch(/Did you mean `formula` → `expression`/);
    // And the lint adds nothing of its own — no second vocabulary for one key.
    expect(validateStackExpressions(badSpelling)).toEqual([]);
  });

  it('4 — mutating the read back to `f.formula` is caught by the declared-key guard', () => {
    // The mutation, applied to the real source the guard scans.
    const mutated = RULE_CODE.replace(/\bf\.expression\b/g, 'f.formula');
    expect(mutated, 'the read moved — this mutation no longer reproduces #5026').not.toBe(RULE_CODE);

    const readAfterMutation = [
      ...new Set([...mutated.matchAll(/\bf\??\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1])),
    ].sort();
    const declared = Object.keys(FieldSchema.shape);
    const undeclared = readAfterMutation.filter(
      (k) => !declared.includes(k) && !TRACKED_UNDECLARED_READS.some((t) => t.receiver === 'f' && t.key === k),
    );
    // The guard's own assertion, run against the mutant: it fails, naming the key.
    expect(undeclared).toEqual(['formula']);
    // …and the un-mutated source passes the identical assertion.
    expect(keysReadOff('f').filter((k) => !declared.includes(k))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// [#5378] Registry-injected system columns resolve like any other field.
//
// The defect this pins: `buildFieldIndex` read the AUTHORED `fields` map only,
// so every column the registry injects was invisible and any predicate touching
// one was hard-rejected — the platform's linter denying the platform's own
// contract. Apps could only escape by re-declaring system columns (hotcrm#548
// added `owner_id` to all 12 business objects for exactly this).
//
// The counter-examples matter as much as the fix: injection is CONDITIONAL, so
// the pass must keep rejecting an injected column on an object the registry does
// NOT inject it on. The conditions come from the spec derivation the registry
// itself consumes (`resolveInjectedSystemColumns`), never a list copied here.
// ---------------------------------------------------------------------------
describe('validateStackExpressions — injected system columns (#5378)', () => {
  /** Injection-only: declares NO system column of its own. */
  const injectionOnly = (extra: Record<string, unknown> = {}) => ({
    name: 'crm_contact',
    fields: { name: { type: 'text' }, email: { type: 'email' } },
    ...extra,
  });

  const withCondition = (object: Record<string, unknown>, condition: string) =>
    validateStackExpressions({
      objects: [object],
      objectValidations: undefined,
      flows: [{
        name: 'contact_welcome',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: 'crm_contact', condition } },
        ],
        edges: [],
      }],
    });

  // The issue's acceptance criterion #1, verbatim.
  it('accepts has(record.owner_id) on an object that does not declare owner_id', () => {
    expect(withCondition(injectionOnly(), 'has(record.owner_id)')).toHaveLength(0);
  });

  it.each([
    'has(record.created_at)',
    'has(record.created_by)',
    'has(record.updated_at)',
    'has(record.updated_by)',
    'has(record.organization_id)',
    'has(record.owning_business_unit_id)',
    // Driver-provisioned primary key — the same class, and the commonest of all.
    'has(record.id)',
  ])('accepts %s on an injection-only object', (condition) => {
    expect(withCondition(injectionOnly(), condition)).toHaveLength(0);
  });

  // ── Counter-examples: the pass must NOT become a blanket allowance ──

  it("still rejects record.owner_id on ownership: 'none' (no owner column is injected)", () => {
    const issues = withCondition(injectionOnly({ ownership: 'none' }), 'has(record.owner_id)');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/unknown field `owner_id`/);
  });

  it("still rejects record.owner_id on ownership: 'org'", () => {
    const issues = withCondition(injectionOnly({ ownership: 'org' }), 'has(record.owner_id)');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/unknown field `owner_id`/);
  });

  it('still rejects record.organization_id when the object opts out of tenancy', () => {
    const issues = withCondition(
      injectionOnly({ tenancy: { enabled: false } }),
      'has(record.organization_id)',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/unknown field `organization_id`/);
  });

  it('still rejects an audit column when the object opts out of audit fields', () => {
    const issues = withCondition(
      injectionOnly({ systemFields: { audit: false } }),
      'has(record.created_at)',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/unknown field `created_at`/);
  });

  it('still rejects a genuinely unknown field on an injection-only object', () => {
    const issues = withCondition(injectionOnly(), 'has(record.no_such_field)');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/unknown field `no_such_field`/);
  });

  // The resolved names join the "did you mean?" candidates, so a typo'd system
  // column now gets the same help an authored field always got.
  it('suggests an injected column for a near-miss spelling', () => {
    const issues = withCondition(injectionOnly(), 'has(record.ownerid)');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/unknown field `ownerid`/);
    expect(issues[0].message).toMatch(/did you mean `owner_id`/);
  });

  // A DECLARED system column keeps working — re-declaration stays legal, which
  // is why an existing app that took the hotcrm#548 workaround sees no change.
  it('accepts a declared owner_id exactly as before (re-declaration stays legal)', () => {
    const declared = {
      name: 'crm_contact',
      fields: {
        name: { type: 'text' },
        owner_id: { type: 'lookup', reference: 'sys_user', system: true },
      },
    };
    expect(withCondition(declared, 'has(record.owner_id)')).toHaveLength(0);
  });

  // Reverse verification, in the direction that is actually available here: the
  // injected half is what carries the verdict, so removing it must turn the
  // acceptance criterion RED while leaving the counter-examples untouched. Pinned
  // by construction — an empty injected set is exactly pre-#5378 behaviour.
  it('the injected half is load-bearing: an object whose plan injects nothing rejects every system column', () => {
    // `systemFields: false` is the platform's own "inject nothing" switch, so it
    // reproduces the old blindness on purpose — minus `id`, which is the
    // driver's and survives the opt-out.
    const optedOut = injectionOnly({ systemFields: false });
    for (const condition of ['has(record.owner_id)', 'has(record.created_at)', 'has(record.organization_id)']) {
      const issues = withCondition(optedOut, condition);
      expect(issues, condition).toHaveLength(1);
      expect(issues[0].message).toMatch(/unknown field/);
    }
    expect(withCondition(optedOut, 'has(record.id)')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// [#8116] Unprovisioned injected anchors on external objects WARN.
//
// The gap this pins: #5378 made injected anchors resolve (existence), so a
// predicate over `record.owner_id` on an ADR-0015 `external` object linted
// clean — while the platform registers that anchor WITHOUT provisioning
// storage (#7865), and the query silently degrades at runtime (on SQLite:
// constant-false, HTTP 200, zero rows, no error). The provenance derivation
// moved into `@objectstack/spec/data` precisely so this package could ask it
// (maintainer ruling on #8116, option 1); these tests pin the author-time
// warning built on it.
// ---------------------------------------------------------------------------
describe('validateStackExpressions — unprovisioned injected anchors (#8116)', () => {
  const externalObject = (extra: Record<string, unknown> = {}) => ({
    name: 'ext_customer',
    external: { remoteName: 'customers' },
    fields: { email: { type: 'email' }, region: { type: 'text' } },
    ...extra,
  });

  const withValidation = (object: Record<string, unknown>, condition: string) =>
    validateStackExpressions({
      objects: [{ ...object, validations: [{ name: 'r1', type: 'script', condition }] }],
    });

  const warningsOf = (issues: readonly ExprIssue[]): ExprIssue[] =>
    issues.filter((i) => i.severity === 'warning');

  it('warns on record.<anchor> in a validation rule on an external object', () => {
    const issues = withValidation(externalObject(), 'record.owner_id != null');
    const warnings = warningsOf(issues);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('record.owner_id');
    expect(warnings[0].message).toContain('NO storage');
    expect(warnings[0].message).toContain('external');
    expect(warnings[0].message).toContain('constant-false');
    // Advisory, never build-breaking: the runtime degradation is non-fatal and
    // the security-critical member of the class is fenced at runtime
    // (#7859/#7858) — see the helper's doc for the #7219 criterion.
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('catches the has() guard form too — record.<anchor> inside a call argument', () => {
    const warnings = warningsOf(withValidation(externalObject(), 'has(record.organization_id)'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('organization_id');
  });

  it('warns in a flow condition (flattened scope) — the root is explicit, so no bare-identifier guessing', () => {
    const issues = validateStackExpressions({
      objects: [externalObject()],
      flows: [{
        name: 'ext_flow',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: 'ext_customer', condition: 'record.owner_id != null' } },
        ],
        edges: [],
      }],
    });
    expect(warningsOf(issues)).toHaveLength(1);
  });

  it('never judges a bare identifier — a flow variable named like an anchor stays silent', () => {
    const issues = validateStackExpressions({
      objects: [externalObject()],
      flows: [{
        name: 'ext_flow',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: 'ext_customer', condition: 'owner_id != null' } },
        ],
        edges: [],
      }],
    });
    expect(warningsOf(issues)).toHaveLength(0);
  });

  it('is silent on the local twin — provenance, not existence, carries the verdict', () => {
    const local = { name: 'ext_customer', fields: { email: { type: 'email' } } };
    expect(warningsOf(withValidation(local, 'record.owner_id != null'))).toHaveLength(0);
  });

  it("is silent on an author-DECLARED column of the same name (#7859's security direction)", () => {
    const declaredReal = externalObject({
      fields: {
        email: { type: 'email' },
        organization_id: { type: 'text', label: 'Remote Org Key' },
      },
    });
    expect(warningsOf(withValidation(declaredReal, 'record.organization_id != null'))).toHaveLength(0);
  });

  it('is silent for an anchor the injection plan withholds — the existence pass owns that (as an error)', () => {
    // `ownership: 'none'` ⇒ no owner_id anywhere ⇒ the reference is an unknown
    // field (error), not an unprovisioned anchor (warning). One defect, one
    // finding, the right one.
    const issues = withValidation(externalObject({ ownership: 'none' }), 'record.owner_id != null');
    expect(warningsOf(issues)).toHaveLength(0);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(1);
  });

  it('rides the field-level slots and formulas too', () => {
    const issues = validateStackExpressions({
      objects: [externalObject({
        fields: {
          email: { type: 'email' },
          vip: { type: 'boolean', readonlyWhen: 'record.owner_id == null' },
          owner_label: { type: 'text', expression: "record.owner_id + ''" },
        },
      })],
    });
    const warnings = warningsOf(issues).filter(
      (i) => i.message.includes('owner_id') && i.message.includes('NO storage'),
    );
    expect(warnings).toHaveLength(2);
    expect(warnings.some((i) => i.where.includes('readonlyWhen'))).toBe(true);
    expect(warnings.some((i) => i.where.includes('expression'))).toBe(true);
  });
});
