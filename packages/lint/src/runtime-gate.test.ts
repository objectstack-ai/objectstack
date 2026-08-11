// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Behaviour of the runtime publish gate (#4463).
//
// The wiring guard (`authoring-rule-wiring.test.ts`) proves the gate READS the
// shared registry. This file proves it FINDS things — the distinction #4449
// was filed about, where a rule was registered, exported, unit-tested and
// produced output on no real stack.

import { describe, it, expect } from 'vitest';
import {
  runRuntimeAuthoringRules,
  runtimeAuthoringRulesFor,
  runtimeGatedTypes,
  stackKeyForType,
} from './runtime-gate.js';
import type { AuthoringFinding } from './authoring-rules.js';
import { validateVisibilityPredicates } from './validate-visibility-predicates.js';
import { validatePredicatePathRefs } from './validate-predicate-path-refs.js';

/** The issue's measured example: an approval flow whose expression approver is broken CEL. */
const brokenApprovalFlow = {
  name: 'leave_approval',
  label: 'Leave approval',
  trigger: { type: 'record_change', object: 'leave_request', events: ['create'] },
  nodes: [
    { id: 'start', type: 'start' },
    {
      id: 'approve',
      type: 'approval',
      config: { approvers: [{ type: 'expression', value: 'record.owner ==' }] },
    },
  ],
};

/** The same flow with an approver expression that parses and uses a legal root. */
const cleanApprovalFlow = {
  ...brokenApprovalFlow,
  nodes: [
    { id: 'start', type: 'start' },
    {
      id: 'approve',
      type: 'approval',
      config: {
        approvers: [{ type: 'expression', value: 'current.owner' }],
        emptyApproverPolicy: 'reject',
      },
    },
  ],
};

const objects = [
  { name: 'leave_request', fields: { owner: { type: 'text' }, status: { type: 'text' } } },
];

describe('runtime publish gate (#4463)', () => {
  it('rejects the issue\'s worked example with a located, fixable finding', () => {
    const result = runRuntimeAuthoringRules({
      type: 'flow',
      item: brokenApprovalFlow,
      context: { objects },
    });

    const finding = result.errors.find((f) => f.rule === 'approval-expression-invalid');
    expect(
      finding,
      `the broken CEL approver must be REFUSED at the runtime publish gate — this exact body is what ` +
        `#4409 taught the three CLI commands to reject, and what a Studio tenant could still save.`,
    ).toBeDefined();

    // D3: the four keys the 422 envelope carries. A gate that says "no" without
    // saying WHERE and HOW TO FIX is a gate an author routes around.
    expect(finding!.path).toBe('flows[0].nodes[1].config.approvers[0].value');
    expect(finding!.where).toContain('leave_approval');
    expect(finding!.message).toMatch(/does not parse as CEL/);
    expect(finding!.hint.length).toBeGreaterThan(10);
    expect(finding!.severity).toBe('error');
  });

  it('passes the same flow once the expression is valid', () => {
    const result = runRuntimeAuthoringRules({
      type: 'flow',
      item: cleanApprovalFlow,
      context: { objects },
    });
    expect(result.errors, `a valid flow must publish: ${JSON.stringify(result.errors)}`).toEqual([]);
    // The rules still RAN — "clean" and "nothing ran" must be distinguishable.
    expect(result.rulesRun.length).toBeGreaterThan(0);
  });

  it('runs the four rule families #4463 P1 wired, from the shared table', () => {
    const { rulesRun } = runRuntimeAuthoringRules({
      type: 'flow',
      item: cleanApprovalFlow,
      context: { objects },
    });
    expect(rulesRun).toEqual(runtimeAuthoringRulesFor('flow').map((r) => r.name));
    expect(rulesRun).toContain('validateStackExpressions'); // expression
    expect(rulesRun).toContain('validateApprovalApprovers'); // approval
    expect(rulesRun).toContain('validateFlowTriggerReadiness'); // flow
    expect(rulesRun).toContain('lintFlowPatterns'); // flow
    expect(rulesRun).toContain('validateReferenceIntegrity'); // reference
  });

  it('a rule that gates only `error` leaves warnings out of the blocking set', () => {
    // The empty-approver-policy advisory rides along on both flows above. It
    // must never be a reason to refuse a publish (P1 gates on `error`; P2 puts
    // advisories on the response).
    const result = runRuntimeAuthoringRules({
      type: 'flow',
      item: brokenApprovalFlow,
      context: { objects },
    });
    expect(result.advisories.every((f) => f.severity !== 'error')).toBe(true);
    expect(result.errors.every((f) => f.severity === 'error')).toBe(true);
  });

  // ── D4: only this write is judged ────────────────────────────────────

  it('does not blame a write for a PRE-EXISTING violation in the context', () => {
    // A tenant's stored object carries a validation rule with broken CEL —
    // written before the gate existed, and legal to keep reading (ADR-0087's
    // asymmetry). Publishing an unrelated flow must not 422 because of it.
    const brokenContext = [
      {
        name: 'leave_request',
        fields: { owner: { type: 'text' } },
        // Spelled with the two keys the spec declares (`validations` /
        // `condition`). Written as `validationRules` / `expression` — both
        // rejected aliases — the broken CEL was not reachable by the rule at
        // all, so this fixture proved the subtraction worked by having nothing
        // to subtract (#5017).
        validations: [{ type: 'script', name: 'bad', message: 'x', condition: 'record.owner ==' }],
      },
    ];

    const result = runRuntimeAuthoringRules({
      type: 'flow',
      item: cleanApprovalFlow,
      context: { objects: brokenContext },
    });

    expect(
      result.errors,
      `the gate blocks NEW writes only (#4463 D4). A stored row's pre-existing violation showing up ` +
        `as an error on somebody else's publish would make the tenant's metadata un-editable, which ` +
        `is a worse outcome than the hole this gate closes.`,
    ).toEqual([]);
  });

  it('still catches the write when the context is ALSO broken', () => {
    // The subtraction must not swallow a real finding just because the context
    // is noisy: the fingerprints differ, so the flow's own error survives.
    const brokenContext = [
      {
        name: 'leave_request',
        fields: { owner: { type: 'text' } },
        // Spelled with the two keys the spec declares (`validations` /
        // `condition`). Written as `validationRules` / `expression` — both
        // rejected aliases — the broken CEL was not reachable by the rule at
        // all, so this fixture proved the subtraction worked by having nothing
        // to subtract (#5017).
        validations: [{ type: 'script', name: 'bad', message: 'x', condition: 'record.owner ==' }],
      },
    ];
    const result = runRuntimeAuthoringRules({
      type: 'flow',
      item: brokenApprovalFlow,
      context: { objects: brokenContext },
    });
    expect(result.errors.map((f) => f.rule)).toContain('approval-expression-invalid');
  });

  // ── Dispatch ─────────────────────────────────────────────────────────

  it('runs nothing for a metadata type no rule gates', () => {
    const result = runRuntimeAuthoringRules({ type: 'translation', item: { name: 'x' } });
    expect(result.rulesRun).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('tolerates a body that is not an object', () => {
    for (const item of [null, undefined, 'a string', 42]) {
      expect(runRuntimeAuthoringRules({ type: 'flow', item }).errors).toEqual([]);
    }
  });

  it('works with no object context at all', () => {
    // A host without a registry (a metadata-only store, a test double) still
    // gets the rules that need no object universe, and must not throw.
    const result = runRuntimeAuthoringRules({ type: 'flow', item: brokenApprovalFlow });
    expect(result.errors.map((f) => f.rule)).toContain('approval-expression-invalid');
  });

  it('exposes its dispatch table as data', () => {
    expect(runtimeGatedTypes()).toContain('flow');
    expect(stackKeyForType('flow')).toBe('flows');
    expect(stackKeyForType('no_such_type')).toBeNull();
  });

  it('a rule that throws degrades to a warning instead of failing the write', () => {
    // A gate whose internal error blocks a publish is worse than the hole it
    // closes: the author gets a refusal they cannot act on. Proven through the
    // real dispatch path with a body shaped to break a walk.
    const cyclic: Record<string, unknown> = { name: 'loop', nodes: [] };
    cyclic.self = cyclic;
    expect(() =>
      runRuntimeAuthoringRules({ type: 'flow', item: cyclic, context: { objects } }),
    ).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// #7220 — the `views[]` visibility-predicate FAMILY at the runtime door
// ────────────────────────────────────────────────────────────────────────────
//
// The registry move is a two-word edit per entry, and a two-word edit that
// nobody drives is indistinguishable from a declaration nobody reads (#4449,
// and the reason `runtime-gate.test.ts` exists next to the wiring guard at all).
// These tests drive the REAL dispatch path — `runRuntimeAuthoringRules`, the
// same function `packages/metadata-protocol/src/runtime-authoring-gate.ts`
// calls — with `view` bodies a Studio / REST `/meta` / MCP author could save,
// and assert the door now answers.
//
// The card this closes is specifically about the FAMILY, so the last test here
// is the one that matters most: it pins that no input exists on which one member
// fires and another does not. That asymmetry — a `view` refused for an
// unresolvable predicate PATH while a predicate that does not parse at all walks
// through — is exactly what #7214's implementer built, measured and reverted.

/** A plain runtime view: `record` / `current_user` are the bound roots. */
const runtimeView = (visibleWhen: string) => ({
  name: 'account_form',
  label: 'Account',
  object: 'account',
  form: { sections: [{ label: 'Main', fields: [{ field: 'name', visibleWhen }] }] },
});

/**
 * A schema-bound metadata FORM published as a view — `data` is the bound root.
 * `validatePredicatePathRefs` judges only this shape (`#7010`: the `record.*`
 * layer's addressable path set is not closed), so the family's path half needs
 * it to be non-vacuous.
 */
const schemaBoundForm = (visibleWhen: string) => ({
  name: 'field_editor',
  label: 'Field editor',
  form: {
    data: { provider: 'schema', schemaId: 'field' },
    sections: [{ label: 'Main', fields: [{ field: 'name', visibleWhen }] }],
  },
});

/** A predicate that is flawless CEL and overruns `DEFAULT_LIMITS.maxAstNodes`. */
const overBudget = Array.from({ length: 120 }, (_, i) => `record.name == 'n${i}'`).join(' || ');

const gateView = (item: unknown) =>
  runRuntimeAuthoringRules({ type: 'view', item, context: { objects: [] } });

describe('the views[] visibility-predicate family at the runtime publish gate (#7220)', () => {
  it('dispatches `view` writes to both family rules, from the shared table', () => {
    expect(runtimeGatedTypes()).toContain('view');
    expect(stackKeyForType('view')).toBe('views');
    expect(runtimeAuthoringRulesFor('view').map((r) => r.name)).toEqual([
      'validateVisibilityPredicates',
      'validatePredicatePathRefs',
    ]);
  });

  // ── fires: the four defects the card names, at the door they bypassed ──

  it('REFUSES a predicate that does not parse as CEL', () => {
    const { errors } = gateView(runtimeView("record.status === 'open'"));
    const f = errors.find((e) => e.rule === 'visibility-predicate-syntax');
    expect(
      f,
      `\`===\` is not CEL. Before #7220 this exact body saved clean through Studio and then failed `
        + `OPEN in the console — the element renders unconditionally (#5149).`,
    ).toBeDefined();
    // The 422 envelope's four keys: the caller turns `errors` into
    // `err.issues` verbatim, so a finding without them is a refusal an author
    // cannot act on.
    expect(f!.severity).toBe('error');
    expect(f!.path).toBe('views[0].form.sections[0].fields[0]');
    expect(f!.where.length).toBeGreaterThan(0);
    expect(f!.message).toMatch(/not valid CEL/);
    expect(f!.hint).toMatch(/==/);
  });

  it('REFUSES a bare identifier no binding root resolves', () => {
    const { errors } = gateView(runtimeView("status == 'open'"));
    const f = errors.find((e) => e.rule === 'visibility-bare-identifier');
    expect(f, '`status` instead of `record.status` resolves nowhere on any layer').toBeDefined();
    expect(f!.severity).toBe('error');
    expect(f!.path).toBe('views[0].form.sections[0].fields[0]');
    expect(f!.hint).toMatch(/record\.status/);
  });

  it('REFUSES a predicate that overruns the CEL parse budget', () => {
    const { errors } = gateView(runtimeView(overBudget));
    const f = errors.find((e) => e.rule === 'visibility-predicate-over-budget');
    expect(f, 'same refusal as a syntax fault, different edit (#7217)').toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('REFUSES a predicate path the target schema does not declare', () => {
    const { errors } = gateView(schemaBoundForm("data.tpye == 'text'"));
    const f = errors.find((e) => e.rule === 'predicate-path-unresolved');
    expect(
      f,
      'this is the rule whose SOLO wiring #7214 reverted — it is here because its siblings are',
    ).toBeDefined();
    expect(f!.severity).toBe('error');
    expect(f!.path).toBe('views[0].form.sections[0].fields[0].visibleWhen');
    expect(f!.message).toMatch(/data\.tpye/);
  });

  it('REFUSES a schema key written without its binding root', () => {
    const { errors } = gateView(schemaBoundForm("type == 'text'"));
    expect(errors.map((e) => e.rule)).toContain('predicate-path-unrooted');
  });

  it('REFUSES a path on the RIGHT of `==` — which resolves cleanly and is broken anyway', () => {
    // #7659, and the measurement that justifies the id existing: `data.type` and
    // `data.label` are both keys of `FieldSchema`, so the rule directly above is
    // silent here BY CONSTRUCTION. The renderer resolves only the left side and
    // parses the right as a literal, so this compares against the string
    // "data.label" and is false on every row.
    const { errors } = gateView(schemaBoundForm('data.type == data.label'));
    const f = errors.find((e) => e.rule === 'predicate-rhs-path-shaped');
    expect(f, 'the right-hand position never evaluates a path').toBeDefined();
    expect(f!.severity).toBe('error');
    expect(
      errors.map((e) => e.rule),
      "#7214's check has nothing to say here — that silence is why this rule exists",
    ).not.toContain('predicate-path-unresolved');
  });

  it('sends a BARE unquoted word down the advisory channel, not the refusal one', () => {
    // The second severity the same id carries. `== active` is compared as the
    // literal string "active" today — very likely what the author meant — so
    // this rule does not refuse the write over metadata that renders correctly.
    //
    // The write IS refused, by `visibility-bare-identifier` from the sibling
    // file, which reads `active` as a dropped binding root. Both findings are
    // true about the token and they prescribe DIFFERENT fixes (`data.active` vs
    // `'active'`), so this pins the pair rather than asserting a clean `errors`
    // list that would go stale the moment either side moved.
    const result = gateView(schemaBoundForm('data.type == active'));
    const f = result.advisories.find((a) => a.rule === 'predicate-rhs-path-shaped');
    expect(f, 'the subset boundary must still reach the author').toBeDefined();
    expect(f!.severity).toBe('warning');
    expect(result.errors.map((e) => e.rule)).not.toContain('predicate-rhs-path-shaped');
    expect(result.errors.map((e) => e.rule)).toContain('visibility-bare-identifier');
  });

  it('reports a MISLAYERED root through the advisory channel, not a refusal', () => {
    // The one family member that is `warning` on every surface, so it must not
    // 422 — and must not be silent either. #4717's `advisories` channel (the
    // ruling's sequencing precondition) is what makes the second half true: it
    // rides back on the 2xx `saveMetaItem` response, so the Studio / MCP author
    // this gate exists for can actually read it. That channel landing is why
    // this move was allowed to happen at all rather than running rules and
    // discarding their verdicts (#4463's own shape, one notch quieter).
    const result = gateView(runtimeView("data.status == 'open'"));
    expect(result.errors).toEqual([]);
    const f = result.advisories.find((a) => a.rule === 'visibility-root-mislayered');
    expect(f, 'a wrong-layer paste must still reach the author').toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  // ── stays quiet ───────────────────────────────────────────────────────

  it('a valid view still publishes, with the rules having RUN', () => {
    const result = gateView(runtimeView("record.status == 'open'"));
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
    expect(result.advisories, JSON.stringify(result.advisories)).toEqual([]);
    // "clean" and "nothing ran" must stay distinguishable.
    expect(result.rulesRun).toEqual([
      'validateVisibilityPredicates',
      'validatePredicatePathRefs',
    ]);
  });

  it('does not blame a `view` write for a pre-existing violation elsewhere', () => {
    // The D4 subtraction, on the newly gated type: a stored object carrying a
    // broken predicate is not this write's to answer for.
    const result = runRuntimeAuthoringRules({
      type: 'view',
      item: runtimeView("record.status == 'open'"),
      context: {
        objects: [
          { name: 'account', fields: { name: { type: 'text', visibleWhen: 'broken ===' } } },
        ],
      },
    });
    expect(result.errors).toEqual([]);
  });

  // ── the family property the ruling is about ───────────────────────────

  it('the runtime door and `os build` reach the SAME verdict on every family input', () => {
    // The asymmetry #7220 exists to prevent, pinned as a property rather than a
    // count: for every input below, the finding set at the runtime gate is
    // IDENTICAL — id, severity and path — to the finding set the two rule
    // functions produce on the CLI. So there is no input on which one member of
    // the family fires at the door and another does not, and no input on which
    // the door and `os build` disagree about the same predicate.
    //
    // Asserted by set equality, not by "both are non-empty": a half-wired wall
    // is precisely the state where both sides are non-empty and disagree.
    const corpus = [
      runtimeView("record.status === 'open'"), // syntax
      runtimeView("status == 'open'"), // bare identifier
      runtimeView("data.status == 'open'"), // mislayered root
      runtimeView(overBudget), // over budget
      runtimeView("record.status == 'open'"), // clean
      schemaBoundForm("data.tpye == 'text'"), // unresolvable path
      schemaBoundForm("type == 'text'"), // unrooted schema key
      schemaBoundForm("data.type == 'text'"), // resolvable path
    ];

    const fingerprints = (fs: readonly AuthoringFinding[]) =>
      fs.map((f) => `${f.severity}:${f.rule}@${f.path}`).sort();

    let sawError = false;
    let sawAdvisory = false;

    for (const item of corpus) {
      const gate = gateView(item);
      sawError ||= gate.errors.length > 0;
      sawAdvisory ||= gate.advisories.length > 0;

      const stack = { views: [item] };
      const cli = [...validateVisibilityPredicates(stack), ...validatePredicatePathRefs(stack)];

      expect(
        fingerprints([...gate.errors, ...gate.advisories]),
        `the runtime gate and os build disagree about ${JSON.stringify(item)} — one family member `
          + `is enforced at a door the others are not, which is the partial-enforcement surface `
          + `#7220 was filed to prevent`,
      ).toEqual(fingerprints(cli));
    }

    // Non-vacuous: the corpus really does exercise both halves of the verdict.
    expect(sawError, 'the corpus must contain a refusal').toBe(true);
    expect(sawAdvisory, 'the corpus must contain an advisory').toBe(true);
  });
});
