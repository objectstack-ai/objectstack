// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readdirSync, readFileSync } from 'node:fs';
import { applyInjectedSystemColumns } from '@objectstack/metadata-core';
import { describe, expect, it } from 'vitest';

// The repo's one code/prose separator, so a call spelled in a comment or a
// string is not read as a call the gate makes. The `.mjs` is the module, and
// `scripts/js-comment-mask.d.mts` beside it is the hand-written declaration
// that gives `maskCommentsAndLiterals` its type, so this test's typecheck
// verdict reads that file too.
import { maskComments, maskCommentsAndLiterals } from '../../../scripts/js-comment-mask.mjs';

import { resolveFlowTriggerKind } from '@objectstack/spec/automation';

import {
  AUTHORED_CONDITION_ID,
  AUTHORED_FLOW_NAME,
  AUTHORED_FORMULA_FIELD_NAME,
  AUTHORED_RULE_NAME,
  authoredExpressionHopTargets,
  authoredFlowProbe,
  judgeAuthoredSiteExpression,
  type AuthoredExpressionSite,
  type AuthoredFlowTrigger,
} from './authored-site-expression.js';
import { runStackExpressionPasses, validateStackExpressions } from './validate-expressions.js';

/** The two object-body sites; a flow condition has its own block below (#33147). */
type ObjectSite = Exclude<AuthoredExpressionSite, 'flow_condition'>;

/**
 * [#32872] `judgeAuthoredSiteExpression` is the publish gate's verdict on one
 * validation rule or formula field beyond the shared validator's — the half
 * of `validate_expression` the MCP tool did not run. Two halves here:
 *
 *  1. The ENUMERATION: every call the gate makes at each site, read off its
 *     source, is classified below as a pass (with a fixture that trips it),
 *     the shared validator the tool runs itself, or plumbing. A call added to
 *     either site fails here until it is classified, and a pass is classified
 *     only with a fixture this entry refuses as the gate does.
 *  2. Per pass: the entry's findings on the fixture are the gate's findings
 *     on the same rule or field, whole, and name the subject the pass judges.
 *     A CONTROL rule and field answer nothing.
 *
 * What the enumeration READS, and so what it reds on:
 *  - inside each site's regions (`SITE_REGIONS`): every call by bare name
 *    (`fn(`, `...fn(`), and every member call by its method name (`x.fn(`);
 *  - across the whole walk (`runStackExpressionPasses`): every pass that
 *    hands its findings to the walk as `issues.push(fn(` or
 *    `issues.push(...fn(`, member names included (`WALK_PUSHES`) — the
 *    shape of the walk's whole-stack passes at its tail.
 * What it does NOT see: a pass outside the regions that pushes its findings
 * by any other shape (an inline `issues.push({ … })`, a loop over a
 * helper's result, a helper that pushes into `issues` itself), and a pass
 * handed by reference (`.map(fn)`). Such a pass is still carried by
 * construction when it locates its finding on the judged rule's key path
 * (`objects[0].validations[0].`) or the judged field's `where`, since the
 * entry runs the whole walk and keeps exactly those; what no pin here
 * catches is a pass located elsewhere, or one needing an input the tool is
 * not handed. Read the gate when merging a change to the walk.
 */

const GATE_SOURCE = readFileSync(new URL('./validate-expressions.ts', import.meta.url), 'utf8');
/** The same source with comments and literal bodies blanked, at the same offsets. */
const GATE_CODE = maskCommentsAndLiterals(GATE_SOURCE);

/** The gate's code between two markers (found in the source), comments and literal bodies blanked. */
function region(start: string, end: string): string {
  const from = GATE_SOURCE.indexOf(start);
  expect(from, `marker moved — update this pin: ${start}`).toBeGreaterThanOrEqual(0);
  const to = GATE_SOURCE.indexOf(end, from + start.length);
  expect(to, `marker moved — update this pin: ${end}`).toBeGreaterThan(from);
  return GATE_CODE.slice(from + start.length, to);
}

/** The functions a region calls by bare name (a spread call counts; a member call does not). */
function bareCalls(code: string): string[] {
  const KEYWORDS = new Set(['if', 'for', 'while', 'return', 'switch', 'catch', 'function', 'typeof']);
  const names = [...code.matchAll(/(?<![\w$])(?<![^.]\.)([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]!);
  return [...new Set(names)].filter((n) => !KEYWORDS.has(n)).sort();
}

/** The method names a region calls on a receiver (`x.fn(`, `a.b.fn(`). */
function memberCalls(code: string): string[] {
  const names = [...code.matchAll(/(?<![\w$])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]!);
  return [...new Set(names)].sort();
}

/** The gate's whole walk, comments and literal bodies blanked. */
function walk(): string {
  return region('export function runStackExpressionPasses(', '\n}\n');
}

/** The passes the walk pushes whole into its findings: `issues.push(fn(` / `issues.push(...fn(`, member names whole. */
function walkPushes(code: string): string[] {
  const names = [...code.matchAll(/(?<![\w$])issues\.push\(\s*(?:\.\.\.)?\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)]
    .map((m) => m[1]!);
  return [...new Set(names)].sort();
}

/** The method names called on a receiver at each site, each plumbing: none of them judges an expression. */
const SITE_MEMBER_CALLS: Record<ObjectSite, Record<string, string>> = {
  validation: {
    get: 'a Map read (the object index, the field definitions)',
    push: "appends a finding to the walk's list",
  },
  formula: {
    get: 'a Map read (the object index, the field definitions)',
    push: "appends a finding to the walk's list",
  },
};

/**
 * The passes the walk hands its findings whole, outside both sites' regions,
 * and why none of them can judge the tool's rule or field. A new one reds
 * here until it is classified: one that judges a validation rule or a
 * formula field belongs in a site's regions or in this entry's filter.
 */
const WALK_PUSHES: Record<string, string> = {
  bulkConfirmTextIssues: "a list view's bulk `confirmText` template slots: no rule or field expression",
  actionCopyTemplateIssues: "an action's copy template slots: no rule or field expression",
};

/** The passes the walk pushes whole from INSIDE a site's regions: classified with that site's calls, in `SITE_CALLS`. */
const WALK_PUSHES_IN_REGION: Record<string, ObjectSite> = {
  formulaCycleIssues: 'formula',
};

/** An object whose own formulas read each other: a cycle the gate refuses on each of its members. */
const CYCLE = {
  name: 'obj',
  fields: {
    f_x: { type: 'formula', label: 'X', expression: 'record.f_y + 1' },
    f_y: { type: 'formula', label: 'Y', expression: 'record.f_x + 1' },
    days: { type: 'number', label: 'Days', required: true },
  },
};

/** Where each site's calls are read: the rule pass (`judgeValidationRule`) and the `check` helper it calls; the field-formula pass and what follows the fields loop. */
const SITE_REGIONS: Record<ObjectSite, Array<[string, string]>> = {
  validation: [
    ['  const check = (', '  const fieldRuleRootVerdict = ('],
    // [#33154] The rule pass, hoisted out of the object walk so the extension
    // walk judges an extension's rules by the same body; the object walk's
    // loop now calls it and nothing else.
    ['  const judgeValidationRule = (', '  // ── Object validation-rule'],
  ],
  formula: [
    ['  const judgeFieldFormula = (', '  const judgeValidationRule = ('],
    [
      '      judgeFieldFormula(fname, f, { objectName, optionFields: optionFieldNames, fieldDefs });\n    }',
      "    // [#26646] A field group's section predicate",
    ],
  ],
};

type Fixture = {
  /** The stack's objects; the judged object is the first, named `obj`. */
  objects: Array<Record<string, unknown>>;
  expression: string;
  severity: 'error' | 'warning';
  /** The subject the pass names in its finding (a field, a table, a root). */
  names: string;
};

type Classified =
  | { kind: 'pass'; fixture: Fixture }
  /** A pass the gate runs that has nothing to judge at the tool's site; judged anyway, through the entry, and pinned to answer nothing. */
  | { kind: 'pass-silent-here'; why: string; fixture: Omit<Fixture, 'severity' | 'names'> }
  | { kind: 'validator'; why: string }
  | { kind: 'plumbing'; why: string };

const REQ = {
  name: 'obj',
  fields: {
    days: { type: 'number', label: 'Days' },
    title: { type: 'text', label: 'Title', required: true },
    balance: { type: 'lookup', label: 'Balance', reference: 'bal' },
    meta: { type: 'lookup', label: 'Meta', reference: 'sys_metadata' },
    header: { type: 'master_detail', label: 'Header', reference: 'bal' },
  },
};
const BAL = { name: 'bal', fields: { remaining: { type: 'number', label: 'Remaining', required: true } } };
const EXT = {
  name: 'obj',
  external: { remoteName: 'customers' },
  fields: { email: { type: 'text', label: 'Email', required: true } },
};

const VALIDATOR = { kind: 'validator', why: 'the shared validator: the tool runs `validateExpression` itself' } as const;
const HOP_FIELD: Fixture = { objects: [REQ, BAL], expression: 'record.balance.nope > 1', severity: 'error', names: 'nope' };
const BODY_HOP: Fixture = { objects: [REQ, BAL], expression: "record.meta.name == 'x'", severity: 'error', names: 'sys_metadata' };
const ANCHOR: Fixture = { objects: [EXT], expression: "record.owner_id == 'u1'", severity: 'warning', names: 'owner_id' };
const asValue = (f: Fixture): Fixture => ({ ...f, expression: `${f.expression} ? 1 : 0` });

const SITE_CALLS: Record<ObjectSite, Record<string, Classified>> = {
  validation: {
    validateExpression: VALIDATOR,
    withAttachedBlocks: { kind: 'plumbing', why: 'the field list handed to the shared validator' },
    isBareReferenceToAny: { kind: 'plumbing', why: "filters the shared validator's findings on a field-rule slot" },
    refuseStoredMetadataBodyHop: { kind: 'pass', fixture: BODY_HOP },
    refuseUndeclaredHopField: { kind: 'pass', fixture: HOP_FIELD },
    warnUnprovisionedAnchors: { kind: 'pass', fixture: ANCHOR },
    atSlot: { kind: 'plumbing', why: "sets the judged slot's key path on the findings" },
    celSourceOf: { kind: 'plumbing', why: 'reads the CEL source off the slot' },
    rulePredicates: { kind: 'plumbing', why: "lists the rule's predicates" },
    faultOutcomeOf: { kind: 'plumbing', why: "the rule's fault outcome, from its severity" },
    check: { kind: 'plumbing', why: 'the helper whose calls are the first region of this site' },
    validationRuleParentIssue: {
      kind: 'pass',
      fixture: { objects: [REQ, BAL], expression: 'parent.remaining > 1', severity: 'error', names: 'parent' },
    },
    checkNullGuards: {
      kind: 'pass',
      fixture: { objects: [REQ, BAL], expression: 'record.days > 3', severity: 'error', names: 'days' },
    },
  },
  formula: {
    validateExpression: VALIDATOR,
    celSourceOf: { kind: 'plumbing', why: 'reads the CEL source off the field' },
    refuseStoredMetadataBodyHop: { kind: 'pass', fixture: asValue(BODY_HOP) },
    refuseUndeclaredHopField: { kind: 'pass', fixture: asValue(HOP_FIELD) },
    warnUnprovisionedAnchors: { kind: 'pass', fixture: asValue(ANCHOR) },
    // [#33100] The formula-cycle pass, after the fields loop. It locates each
    // finding on a cycle member's own `expression`; the probe is named
    // `__validate_expression__`, which no authored formula can read, so the
    // probe is never on a cycle and nothing is located on it, at the gate or
    // through the entry. [#33147] The cycle verdict on the formula being
    // authored needs that field's own name: given as `field`, the entry
    // judges it under that name (the `field` block below pins it).
    formulaCycleIssues: {
      kind: 'pass-silent-here',
      why: "locates each finding on a cycle member's own `expression`; the default probe is on no cycle (with `field`, see below)",
      fixture: { objects: [CYCLE], expression: 'record.f_x + record.days' },
    },
    storedExpressionInputIssues: {
      kind: 'pass-silent-here',
      why: 'judges a STORED field\'s `expression` (any type but `formula`); the default probe is a `formula` field (with `field` naming a stored one, see below)',
      fixture: { objects: [REQ, BAL], expression: 'record.balance.remaining > 1 ? now() : now()' },
    },
  },
};

/** The full gate's findings on the same rule or field, named as the entry names it. */
function gateOn(site: ObjectSite, objects: Array<Record<string, unknown>>, expression: string) {
  const [subject, ...others] = objects as [Record<string, any>, ...Array<Record<string, unknown>>];
  const judged = site === 'validation'
    ? { ...subject, validations: [{ name: AUTHORED_RULE_NAME, type: 'script', condition: expression, message: 'm' }] }
    : {
        ...subject,
        fields: { ...subject.fields, [AUTHORED_FORMULA_FIELD_NAME]: { type: 'formula', label: 'F', expression } },
      };
  const at = site === 'validation'
    ? (where: string) => where.includes(`'${AUTHORED_RULE_NAME}'`)
    : (where: string) => where.includes(`'${AUTHORED_FORMULA_FIELD_NAME}'`);
  return validateStackExpressions({ objects: [judged, ...others] })
    .filter((i) => at(i.where))
    .map((i) => [i.severity ?? 'error', i.message]);
}

function entryOn(site: ObjectSite, objects: Array<Record<string, unknown>>, expression: string) {
  return judgeAuthoredSiteExpression({ site, objectName: 'obj', expression, objects })
    .map((i) => [i.severity ?? 'error', i.message]);
}

describe('judgeAuthoredSiteExpression — every gate pass at each site is listed (#32872)', () => {
  for (const site of ['validation', 'formula'] as const) {
    it(`site ${site}: every call the gate makes there is classified`, () => {
      const calls = bareCalls(SITE_REGIONS[site].map(([start, end]) => region(start, end)).join('\n'));
      expect(calls.length, 'the scan read nothing — the regions are vacuous').toBeGreaterThan(3);
      expect(calls).toEqual(Object.keys(SITE_CALLS[site]).sort());
    });

    it(`site ${site}: every member call the gate makes there is classified`, () => {
      const calls = memberCalls(SITE_REGIONS[site].map(([start, end]) => region(start, end)).join('\n'));
      expect(calls).toEqual(Object.keys(SITE_MEMBER_CALLS[site]).sort());
    });

    for (const [name, classified] of Object.entries(SITE_CALLS[site])) {
      if (classified.kind === 'pass') {
        const { objects, expression, severity, names } = classified.fixture;
        it(`site ${site}: ${name} refuses through the entry as the gate does`, () => {
          const gate = gateOn(site, objects, expression);
          expect(gate.length, 'the fixture trips the gate').toBeGreaterThan(0);
          const entry = entryOn(site, objects, expression);
          expect(entry).toEqual(gate);
          expect(entry.map(([level]) => level)).toEqual(gate.map(() => severity));
          expect(entry.some(([, message]) => message!.includes(names))).toBe(true);
        });
      }
      if (classified.kind === 'pass-silent-here') {
        const { objects, expression } = classified.fixture;
        it(`site ${site}: ${name} has nothing to say at this site, at the gate and through the entry`, () => {
          expect(gateOn(site, objects, expression)).toEqual([]);
          expect(entryOn(site, objects, expression)).toEqual([]);
        });
      }
    }

    it(`site ${site}: CONTROL — a clean ${site === 'validation' ? 'rule' : 'formula'} answers nothing`, () => {
      const expression = site === 'validation'
        ? "record.title == 'x' && record.balance.remaining > 1"
        : "record.title == 'x' && record.balance.remaining > 1 ? 1 : 0";
      expect(gateOn(site, [REQ, BAL], expression)).toEqual([]);
      expect(entryOn(site, [REQ, BAL], expression)).toEqual([]);
    });
  }

  it('every pass the whole walk pushes as a whole is classified', () => {
    const pushes = walkPushes(walk());
    expect(pushes.length, 'the scan read nothing — the walk marker moved').toBeGreaterThan(0);
    expect(pushes).toEqual([...Object.keys(WALK_PUSHES), ...Object.keys(WALK_PUSHES_IN_REGION)].sort());
    for (const [name, site] of Object.entries(WALK_PUSHES_IN_REGION)) {
      expect(Object.keys(SITE_CALLS[site]), `${name} is classified with the ${site} site's calls`).toContain(name);
    }
  });

  it("formulaCycleIssues: the gate refuses the object's own cycle, and locates nothing on the probe", () => {
    // Non-vacuous: on this stack the pass speaks, on the cycle's members.
    const cycle = validateStackExpressions({ objects: [CYCLE] }).filter((i) => /f_x|f_y/.test(i.where));
    expect(cycle.length).toBeGreaterThan(0);
    // ...and neither the gate nor the entry puts a finding on the probe.
    expect(gateOn('formula', [CYCLE], 'record.f_x + record.days')).toEqual([]);
    expect(entryOn('formula', [CYCLE], 'record.f_x + record.days')).toEqual([]);
  });

  it("leaves the shared validator's findings to the caller", () => {
    // An unknown field is the validator's verdict: the gate gives it, the entry does not.
    expect(gateOn('validation', [REQ, BAL], 'record.nope > 1').length).toBeGreaterThan(0);
    expect(entryOn('validation', [REQ, BAL], 'record.nope > 1')).toEqual([]);
  });

  it("judges the caller's rule only, never the object's own rules or fields", () => {
    const withOwn = {
      ...REQ,
      validations: [{ name: 'own', type: 'script', condition: 'record.days > 3', message: 'm' }],
      fields: { ...REQ.fields, own_formula: { type: 'formula', label: 'Own', expression: 'record.balance.nope' } },
    };
    expect(entryOn('validation', [withOwn, BAL], "record.title == 'x'")).toEqual([]);
    expect(entryOn('formula', [withOwn, BAL], "record.title == 'x' ? 1 : 0")).toEqual([]);
  });

  // The registry serves each object with the system columns it injects as
  // declared fields; the gate judges the authored body. Served or authored,
  // the entry's verdict is the same.
  it('judges a served definition (injected columns declared) as the authored body', () => {
    const servedReq = applyInjectedSystemColumns(REQ);
    const servedExt = applyInjectedSystemColumns(EXT);
    expect(Object.keys(servedReq.fields)).toContain('created_at');
    // `created_at` is not a field the author declared nullable: no null-guard verdict.
    expect(entryOn('validation', [servedReq, BAL], "record.created_at > timestamp('2020-01-01T00:00:00Z')")).toEqual([]);
    expect(entryOn('validation', [servedReq, BAL], 'record.days > 3'))
      .toEqual(entryOn('validation', [REQ, BAL], 'record.days > 3'));
    // An external object's anchor is still the platform's, unprovisioned.
    expect(entryOn('validation', [servedExt], "record.owner_id == 'u1'"))
      .toEqual(entryOn('validation', [EXT], "record.owner_id == 'u1'"));
    expect(entryOn('validation', [servedExt], "record.owner_id == 'u1'").map(([level]) => level)).toEqual(['warning']);
  });

  it('answers nothing when the object is not among the definitions', () => {
    expect(judgeAuthoredSiteExpression({ site: 'validation', objectName: 'nope', expression: 'record.days > 3', objects: [REQ] }))
      .toEqual([]);
  });
});

// The gate's option that skips the shared validator must reach no gate run.
// `runStackExpressionPasses` and its options type are on none of the
// package's entries, so only this package's own source can pass it: read
// every source file of it (tests aside), comments and literals blanked, and
// hold the option's spellings to the declaration, the one read, and the one
// passer.
describe('sharedValidatorRunByCaller reaches no gate run (#32872)', () => {
  const SRC = new URL('./', import.meta.url);
  const sources = (dir: URL, rel = ''): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? sources(new URL(`${e.name}/`, dir), `${rel}${e.name}/`)
        : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [`${rel}${e.name}`] : [],
    );

  it('is spelled in code only where it is declared, read, and passed by this entry', () => {
    const spelled: Record<string, number> = {};
    for (const file of sources(SRC)) {
      const code = maskCommentsAndLiterals(readFileSync(new URL(file, SRC), 'utf8'));
      const n = code.match(/(?<![\w$])sharedValidatorRunByCaller(?![\w$])/g)?.length ?? 0;
      if (n > 0) spelled[file] = n;
    }
    expect(spelled).toEqual({
      // The option's declaration, and the walk's one read of it.
      'validate-expressions.ts': 2,
      // The one passer.
      'authored-site-expression.ts': 1,
    });
  });

  it('is on none of the package entries: the walk and its options type are not exported', () => {
    // Comments blanked, literals kept: a module specifier is a literal.
    const entries = Object.fromEntries(['index.ts', 'runtime.ts', 'rule-explanations.ts']
      .map((entry) => [entry, maskComments(readFileSync(new URL(entry, SRC), 'utf8'))]));
    // The scan reads what it means to: the root entry re-exports from the walk's module by name.
    expect(entries['index.ts']).toMatch(/export \{[^}]*validateStackExpressions[^}]*\} from '\.\/validate-expressions\.js'/);
    for (const [entry, code] of Object.entries(entries)) {
      expect(code, entry).not.toMatch(/(?<![\w$])(runStackExpressionPasses|StackExpressionOptions)(?![\w$])/);
      expect(code, entry).not.toMatch(/export\s*\*\s*from\s*['"]\.\/validate-expressions/);
    }
  });
});

describe('authoredExpressionHopTargets (#32872)', () => {
  it('names the target of each reference the expression reads through', () => {
    expect(authoredExpressionHopTargets(REQ, 'record.balance.remaining > 1 && record.meta.name == "x"'))
      .toEqual(['bal', 'sys_metadata']);
  });

  it('names nothing for a plain read, an unparsable source or a non-reference field', () => {
    expect(authoredExpressionHopTargets(REQ, 'record.balance != null && record.days > 1')).toEqual([]);
    expect(authoredExpressionHopTargets(REQ, 'record.days >')).toEqual([]);
    expect(authoredExpressionHopTargets(REQ, 'record.title.size() > 1')).toEqual([]);
  });
});

// ── [#33147] A flow condition ────────────────────────────────────────────
//
// The entry judges a flow condition as the runtime publish gate judges a flow
// write (`runtimeWriteType: 'flow'`): a one-flow probe whose start node
// carries the caller's trigger, with the condition on its one edge. The same
// two halves as above: every call the gate makes at a flow condition (the
// start node's trigger gate, a `decision` branch, an edge, and the helpers
// they hand the source to) is classified, and each pass refuses through the
// entry as the gate does on a hand-written flow.

/** Where a flow condition's calls are read: the three slots, and the two helpers they hand the source to. */
const FLOW_REGIONS: Array<[string, string]> = [
  ['  const check = (', '  const fieldRuleRootVerdict = ('],
  ['  const checkDeclaredPredicate = (', '  const checkDeclaredValue = ('],
  ['        const nodeCondWhere = ', '        // Descriptor-declared expression slots'],
  ["          if (found.entry.role !== 'predicate') continue;", '        // [#19939] The `{…}` template dialect'],
  ['      for (const edge of recordsOf(graph.edges)) {', "        // [#26858] A top-level edge's findings"],
];

const FLOW_MEMBER_CALLS: Record<string, string> = {
  get: 'a Map read (the object index, the field definitions)',
  push: "appends a finding to the walk's list",
  set: "records the judged slot's key for the node's key-path stamp",
};

/** A flow probe's slot, as the hand-written flows below place the condition. */
type FlowSlot = 'start' | 'decision' | 'edge';

type FlowFixture = {
  objects: Array<Record<string, unknown>>;
  expression: string;
  severity: 'error' | 'warning';
  names: string;
  /** [#33176] The flow's declared variables, handed to the entry as the caller hands them and declared on the hand-written flow. */
  variables?: Array<Record<string, unknown>>;
};

type FlowClassified =
  | { kind: 'pass'; fixture: FlowFixture }
  /**
   * A pass the gate runs at a flow condition that the runtime publish gate's
   * probe has nothing for. `buildDoor` is a fixture `os validate` does refuse
   * or warn on, so the silence is the door's (or the missing input's), not a
   * dead pass.
   */
  | { kind: 'pass-silent-here'; why: string; fixture: Omit<FlowFixture, 'severity' | 'names'>; buildDoor?: HandFlowOverrides }
  | { kind: 'validator'; why: string }
  | { kind: 'plumbing'; why: string };

type HandFlowOverrides = { variables?: Array<Record<string, unknown>> };

const FLOW_OBJ = { ...REQ, name: 'obj' };
const FLOW_EXT = { ...EXT };

const FLOW_CALLS: Record<string, FlowClassified> = {
  // The shared validator and the two envelope checks the tool runs itself
  // (it parses the slot with `EvaluatedExpressionInputSchema` before it asks
  // the gate, and a string is the only shape it is handed).
  validateExpression: VALIDATOR,
  checkStructuralCondition: {
    kind: 'validator',
    why: "the slot's envelope: the tool parses the same schema first and never asks the gate about a refused one",
  },
  predicateSlotRefusal: {
    kind: 'validator',
    why: "a declared predicate slot's shape: the tool is handed a string, which that check admits",
  },
  check: { kind: 'plumbing', why: 'the helper whose calls are the first region' },
  checkDeclaredPredicate: { kind: 'plumbing', why: "a `decision` branch's helper, the second region" },
  withAttachedBlocks: { kind: 'plumbing', why: 'the field list handed to the shared validator' },
  isBareReferenceToAny: { kind: 'plumbing', why: "filters the shared validator's findings on a field-rule slot" },
  checkFlowNullGuards: {
    kind: 'pass',
    fixture: { objects: [FLOW_OBJ], expression: 'record.days > 3', severity: 'error', names: 'record.days' },
  },
  warnUnprovisionedAnchors: {
    kind: 'pass',
    fixture: { objects: [FLOW_EXT], expression: "record.owner_id == 'u1'", severity: 'warning', names: 'owner_id' },
  },
  refuseUnboundRoots: {
    kind: 'pass-silent-here',
    why: "the runtime publish gate's root scope is never provable (its snapshot shows no entrance), so it judges no root; `os validate` does, over the flow's variables, node ids and entrances, which the tool is not handed",
    fixture: { objects: [FLOW_OBJ], expression: 'foo.bar == 1' },
    buildDoor: {},
  },
  // [#33176] The flow's declared variables, which the caller hands the entry
  // and the probe declares; without them it cannot fire (pinned below).
  warnShadowedFieldReads: {
    kind: 'pass',
    fixture: {
      objects: [FLOW_OBJ],
      expression: "title == 'x'",
      severity: 'warning',
      names: '`title`',
      variables: [{ name: 'title', type: 'text' }],
    },
  },
  refuseStoredMetadataBodyHop: {
    kind: 'pass-silent-here',
    why: 'runs only where a relationship hop is hydrated (a rule condition, a formula); nothing hydrates one at a flow condition',
    fixture: { objects: [FLOW_OBJ, BAL], expression: "record.meta.name == 'x'" },
  },
  refuseUndeclaredHopField: {
    kind: 'pass-silent-here',
    why: 'runs only where a relationship hop is hydrated (a rule condition, a formula); nothing hydrates one at a flow condition',
    fixture: { objects: [FLOW_OBJ, BAL], expression: 'record.balance.nope > 1' },
  },
};

/** The start node of a hand-written flow on `obj`, with the trigger `kind` names. */
function handStart(kind: AuthoredFlowTrigger, config: Record<string, unknown> = {}): Record<string, unknown> {
  const trigger: Record<AuthoredFlowTrigger, Record<string, unknown>> = {
    record_change: { triggerType: 'record-after-create' },
    time_relative: { timeRelative: { object: 'obj', dateField: 'due', withinDays: 7 } },
    schedule: { schedule: '*/5 * * * *' },
    api: { triggerType: 'api' },
    none: {},
  };
  return { id: 'begin', type: 'start', config: { objectName: 'obj', ...trigger[kind], ...config } };
}

/** The `where` the hand-written flow's judged slot carries, as each gate sentence spells it. */
const HAND_WHERE: Record<FlowSlot, string> = {
  start: "flow 'escalate' · node 'begin' (start) condition",
  decision: "flow 'escalate' · node 'triage' (decision) decision branch expression at config.conditions[0].expression",
  edge: "flow 'escalate' · edge 'e2' (triage→alert) condition",
};
const PROBE_WHERE = `flow '${AUTHORED_FLOW_NAME}' · edge '${AUTHORED_CONDITION_ID}' (start→end) condition`;

/**
 * A realistic flow the condition sits in at `slot`: a start node, a
 * `decision`, two ends, three edges, and `startCondition` on the start node
 * when the slot is downstream of it.
 */
function handFlow(
  slot: FlowSlot,
  expression: string,
  { kind = 'record_change', startCondition, variables }: { kind?: AuthoredFlowTrigger; startCondition?: string } & HandFlowOverrides = {},
): Record<string, unknown> {
  const startCond = slot === 'start' ? expression : startCondition;
  return {
    name: 'escalate',
    label: 'Escalate',
    type: kind === 'api' ? 'api' : 'autolaunched',
    ...(variables ? { variables } : {}),
    nodes: [
      handStart(kind, startCond !== undefined ? { condition: startCond } : {}),
      {
        id: 'triage',
        type: 'decision',
        config: { conditions: [{ label: 'Hot', expression: slot === 'decision' ? expression : 'true' }] },
      },
      { id: 'alert', type: 'end' },
      { id: 'calm', type: 'end' },
    ],
    edges: [
      { id: 'e1', source: 'begin', target: 'triage' },
      { id: 'e2', source: 'triage', target: 'alert', ...(slot === 'edge' ? { condition: expression } : {}) },
      { id: 'e3', source: 'triage', target: 'calm', isDefault: true },
    ],
  };
}

/**
 * The gate's findings on the judged slot of the hand-written flow, the shared
 * validator's left out (the tool answers those itself), with the slot's
 * locator spelled as the probe's so the two read alike.
 */
function flowGateOn(
  objects: Array<Record<string, unknown>>,
  expression: string,
  { slot = 'edge', door = 'runtime', ...rest }: { slot?: FlowSlot; door?: 'runtime' | 'build'; kind?: AuthoredFlowTrigger; startCondition?: string } & HandFlowOverrides = {},
) {
  const where = HAND_WHERE[slot];
  const issues = runStackExpressionPasses(
    { objects, flows: [handFlow(slot, expression, rest)] },
    door === 'runtime' ? { runtimeWriteType: 'flow', sharedValidatorRunByCaller: true } : { sharedValidatorRunByCaller: true },
  );
  return issues
    .filter((i) => i.where === where)
    .map((i) => [i.severity ?? 'error', i.message.split(where).join(PROBE_WHERE)]);
}

function flowEntryOn(
  objects: Array<Record<string, unknown>>,
  expression: string,
  opts: { triggerKind?: AuthoredFlowTrigger; startCondition?: string } & HandFlowOverrides = {},
) {
  return judgeAuthoredSiteExpression({ site: 'flow_condition', objectName: 'obj', expression, objects, ...opts })
    .map((i) => [i.severity ?? 'error', i.message]);
}

describe('judgeAuthoredSiteExpression at a flow condition — every gate pass is listed (#33147)', () => {
  it('every call the gate makes at a flow condition is classified', () => {
    const calls = bareCalls(FLOW_REGIONS.map(([start, end]) => region(start, end)).join('\n'));
    expect(calls.length, 'the scan read nothing — the regions are vacuous').toBeGreaterThan(5);
    expect(calls).toEqual(Object.keys(FLOW_CALLS).sort());
  });

  it('every member call the gate makes at a flow condition is classified', () => {
    const calls = memberCalls(FLOW_REGIONS.map(([start, end]) => region(start, end)).join('\n'));
    expect(calls).toEqual(Object.keys(FLOW_MEMBER_CALLS).sort());
  });

  for (const [name, classified] of Object.entries(FLOW_CALLS)) {
    if (classified.kind === 'pass') {
      const { objects, expression, severity, names, variables } = classified.fixture;
      const declared = variables ? { variables } : {};
      for (const slot of ['start', 'decision', 'edge'] as const) {
        it(`${name} refuses through the entry as the gate does at a flow's ${slot} condition`, () => {
          const gate = flowGateOn(objects, expression, { slot, ...declared });
          expect(gate.length, 'the fixture trips the gate').toBeGreaterThan(0);
          const entry = flowEntryOn(objects, expression, declared);
          expect(entry).toEqual(gate);
          expect(entry.map(([level]) => level)).toEqual(gate.map(() => severity));
          expect(entry.some(([, message]) => message!.includes(names))).toBe(true);
        });
      }
    }
    if (classified.kind === 'pass-silent-here') {
      const { objects, expression } = classified.fixture;
      it(`${name} has nothing to say through the entry, as at the runtime publish gate`, () => {
        expect(flowGateOn(objects, expression)).toEqual([]);
        expect(flowEntryOn(objects, expression)).toEqual([]);
        if (classified.buildDoor) {
          // Non-vacuous: `os validate` speaks on the same condition, given what it reads.
          expect(flowGateOn(objects, expression, { door: 'build', ...classified.buildDoor }).length).toBeGreaterThan(0);
        }
      });
    }
  }

  it("a bare name's null guard is `os validate`'s, not the runtime publish gate's, and not the entry's", () => {
    expect(flowGateOn([FLOW_OBJ], 'days > 3', { door: 'build' }).length).toBeGreaterThan(0);
    expect(flowGateOn([FLOW_OBJ], 'days > 3')).toEqual([]);
    expect(flowEntryOn([FLOW_OBJ], 'days > 3')).toEqual([]);
  });

  it('CONTROL — a clean condition answers nothing', () => {
    for (const expression of ["record.title == 'x'", 'record.days != null && record.days > 3']) {
      expect(flowGateOn([FLOW_OBJ], expression)).toEqual([]);
      expect(flowEntryOn([FLOW_OBJ], expression)).toEqual([]);
    }
  });

  it('a start probe and an edge probe answer alike when no start condition is given', () => {
    for (const expression of ['record.days > 3', "record.title == 'x'", 'days > 3']) {
      expect(flowGateOn([FLOW_OBJ], expression, { slot: 'start' })).toEqual(flowGateOn([FLOW_OBJ], expression, { slot: 'edge' }));
    }
  });

  it('presumes what the start condition proves, as the gate does downstream of it', () => {
    // Guarded at the start, the edge condition passes; unguarded, it is refused.
    const guarded = { startCondition: 'record.days != null' };
    expect(flowGateOn([FLOW_OBJ], 'record.days > 3', guarded)).toEqual([]);
    expect(flowEntryOn([FLOW_OBJ], 'record.days > 3', guarded)).toEqual([]);
    expect(flowGateOn([FLOW_OBJ], 'record.days > 3', { slot: 'decision', ...guarded })).toEqual([]);
    // A BARE start guard proves nothing at the runtime publish gate (its bound
    // set is not provable), so the edge is still refused there and here.
    const bare = { startCondition: 'days != null' };
    const refused = flowGateOn([FLOW_OBJ], 'record.days > 3', bare);
    expect(refused.length).toBeGreaterThan(0);
    expect(flowEntryOn([FLOW_OBJ], 'record.days > 3', bare)).toEqual(refused);
    // The start condition's own findings are not the judged condition's.
    expect(flowEntryOn([FLOW_OBJ], "record.title == 'x'", { startCondition: 'record.days > 3' })).toEqual([]);
  });

  it("the probe's trigger reads back as each kind, and each kind answers as the gate does", () => {
    for (const kind of ['record_change', 'time_relative', 'schedule', 'api', 'none'] as const) {
      const probe = authoredFlowProbe({ objectName: 'obj', expression: 'true', triggerKind: kind });
      expect(resolveFlowTriggerKind(probe) ?? 'none', kind).toBe(kind);
      expect(resolveFlowTriggerKind(handFlow('edge', 'true', { kind })) ?? 'none', kind).toBe(kind);
      for (const expression of ['record.days > 3', "record.owner_id == 'u1'"]) {
        const objects = expression.includes('owner_id') ? [{ ...FLOW_EXT }] : [FLOW_OBJ];
        expect(flowEntryOn(objects, expression, { triggerKind: kind }), `${kind}: ${expression}`)
          .toEqual(flowGateOn(objects, expression, { kind }));
      }
    }
    // The null guard is a record-triggered flow's alone: another kind is not refused.
    expect(flowEntryOn([FLOW_OBJ], 'record.days > 3', { triggerKind: 'schedule' })).toEqual([]);
  });

  it('judges a served definition (injected columns declared) as the authored body', () => {
    const served = applyInjectedSystemColumns(FLOW_OBJ);
    expect(flowEntryOn([served], "record.created_at > timestamp('2020-01-01T00:00:00Z')")).toEqual([]);
    expect(flowEntryOn([served], 'record.days > 3')).toEqual(flowEntryOn([FLOW_OBJ], 'record.days > 3'));
    expect(flowEntryOn([applyInjectedSystemColumns(FLOW_EXT)], "record.owner_id == 'u1'"))
      .toEqual(flowEntryOn([FLOW_EXT], "record.owner_id == 'u1'"));
  });

  it("judges the caller's condition only, never the object's own rules or fields", () => {
    const withOwn = {
      ...FLOW_OBJ,
      validations: [{ name: 'own', type: 'script', condition: 'record.days > 3', message: 'm' }],
      fields: { ...FLOW_OBJ.fields, own_formula: { type: 'formula', label: 'Own', expression: 'record.balance.nope' } },
    };
    expect(flowEntryOn([withOwn, BAL], "record.title == 'x'")).toEqual([]);
  });

  it('answers nothing when the object is not among the definitions', () => {
    expect(judgeAuthoredSiteExpression({ site: 'flow_condition', objectName: 'nope', expression: 'record.days > 3', objects: [FLOW_OBJ] }))
      .toEqual([]);
  });
});

// ── [#33176] The flow's declared variables, at a flow condition ───────────
//
// Handed the flow's `variables`, the probe declares them, and the gate's
// shadowed-read warning (`warnShadowedFieldReads`, a `pass` in the table
// above with those variables) comes back through the entry. Handed none, the
// probe is the flow it was before the key, and the warning cannot fire.

describe("judgeAuthoredSiteExpression with the flow's declared variables (#33176)", () => {
  const SHADOWING = [{ name: 'title', type: 'text' }];

  it('declares the variables it is handed, as handed, and no `variables` key without them', () => {
    const variables = [{ name: 'title', type: 'text', isInput: true }, { name: 'limit', type: 'number' }];
    expect(authoredFlowProbe({ objectName: 'obj', expression: 'true', variables }).variables).toEqual(variables);
    expect(Object.keys(authoredFlowProbe({ objectName: 'obj', expression: 'true' }))).not.toContain('variables');
  });

  it('CONTROL — without the variables the shadowed read answers nothing, at the gate and through the entry', () => {
    // A flow that declares no variable gets no warning at the runtime door…
    expect(flowGateOn([FLOW_OBJ], "title == 'x'")).toEqual([]);
    // …and the probe, handed none, is that flow.
    expect(flowEntryOn([FLOW_OBJ], "title == 'x'")).toEqual([]);
  });

  it('a variable named like no field of the object gets no warning', () => {
    const variables = [{ name: 'threshold', type: 'number' }];
    for (const expression of ['threshold > 3', "record.title == 'x' && threshold > 3"]) {
      expect(flowGateOn([FLOW_OBJ], expression, { variables }), expression).toEqual([]);
      expect(flowEntryOn([FLOW_OBJ], expression, { variables }), expression).toEqual([]);
    }
  });

  it('warns on the bare read alone: `record.FIELD` reads the field, whatever the variables', () => {
    expect(flowGateOn([FLOW_OBJ], "record.title == 'x'", { variables: SHADOWING })).toEqual([]);
    expect(flowEntryOn([FLOW_OBJ], "record.title == 'x'", { variables: SHADOWING })).toEqual([]);
    const both = flowGateOn([FLOW_OBJ], 'record.title == title', { variables: SHADOWING });
    expect(both.map(([level]) => level)).toEqual(['warning']);
    expect(flowEntryOn([FLOW_OBJ], 'record.title == title', { variables: SHADOWING })).toEqual(both);
  });

  it('answers as the gate on every trigger kind and after a start condition', () => {
    for (const kind of ['record_change', 'time_relative', 'schedule', 'api', 'none'] as const) {
      const gate = flowGateOn([FLOW_OBJ], "title == 'x'", { kind, variables: SHADOWING });
      expect(gate.map(([level]) => level), kind).toEqual(['warning']);
      expect(flowEntryOn([FLOW_OBJ], "title == 'x'", { triggerKind: kind, variables: SHADOWING }), kind).toEqual(gate);
    }
    const startCondition = 'record.days != null';
    const gate = flowGateOn([FLOW_OBJ], "title == 'x'", { startCondition, variables: SHADOWING });
    expect(gate.map(([level]) => level)).toEqual(['warning']);
    expect(flowEntryOn([FLOW_OBJ], "title == 'x'", { startCondition, variables: SHADOWING })).toEqual(gate);
  });
});

// ── [#33147] The field being authored, at the formula site ───────────────
//
// Named as `field`, a field the definition declares keeps its definition with
// the expression in place: a stored field (any type but `formula`) is judged
// as stored, and a formula is judged on the object's formula graph under its
// own name. Any other name is a new `formula` field of that name.

/** An object with a stored computed field (`stamp`) and a formula pair; `days` required. */
const STORED = {
  name: 'obj',
  fields: {
    ...REQ.fields,
    stamp: { type: 'number', label: 'Stamp', expression: 'record.days' },
    f_x: { type: 'formula', label: 'X', expression: 'record.f_y + 1' },
    f_y: { type: 'formula', label: 'Y', expression: 'record.title.size()' },
  },
};

/** The gate's findings on field `name` of `obj`, its expression replaced (the shared validator's left out). */
function fieldGateOn(objects: Array<Record<string, any>>, name: string, expression: string) {
  const [subject, ...others] = objects as [Record<string, any>, ...Array<Record<string, unknown>>];
  const fields = Array.isArray(subject.fields)
    ? subject.fields.map((f: Record<string, unknown>) => (f.name === name ? { ...f, expression } : f))
    : { ...subject.fields, [name]: { ...subject.fields[name], expression } };
  const where = `object 'obj' · field '${name}' expression`;
  return runStackExpressionPasses({ objects: [{ ...subject, fields }, ...others] }, { runtimeWriteType: 'object', sharedValidatorRunByCaller: true })
    .filter((i) => i.where === where)
    .map((i) => [i.severity ?? 'error', i.message]);
}

function fieldEntryOn(objects: Array<Record<string, unknown>>, expression: string, field?: string) {
  return judgeAuthoredSiteExpression({ site: 'formula', objectName: 'obj', expression, objects, ...(field ? { field } : {}) })
    .map((i) => [i.severity ?? 'error', i.message]);
}

describe('judgeAuthoredSiteExpression with the field being authored (#33147)', () => {
  it("a declared stored field gets the gate's stored-expression warnings", () => {
    for (const expression of ['record.balance.remaining + 1', 'record.days + (now() > now() ? 1 : 0)']) {
      const gate = fieldGateOn([STORED, BAL], 'stamp', expression);
      expect(gate.length, expression).toBeGreaterThan(0);
      expect(gate.every(([level]) => level === 'warning')).toBe(true);
      expect(fieldEntryOn([STORED, BAL], expression, 'stamp')).toEqual(gate);
      // Without the field, the probe is a formula: nothing stored to warn on.
      expect(fieldEntryOn([STORED, BAL], expression)).toEqual([]);
    }
  });

  it('a declared formula is judged on the formula graph under its own name: the cycle it would close is refused', () => {
    const gate = fieldGateOn([STORED], 'f_y', 'record.f_x + 1');
    expect(gate.length).toBeGreaterThan(0);
    expect(gate.every(([level]) => level === 'error')).toBe(true);
    expect(fieldEntryOn([STORED], 'record.f_x + 1', 'f_y')).toEqual(gate);
    // The same expression on a field no formula reads closes no cycle.
    expect(fieldEntryOn([STORED], 'record.f_x + 1', 'f_new')).toEqual([]);
    expect(fieldEntryOn([STORED], 'record.f_x + 1')).toEqual([]);
  });

  it('reads an array-form field list the same way', () => {
    const asArray = { ...STORED, fields: Object.entries(STORED.fields).map(([name, def]) => ({ name, ...def })) };
    expect(fieldEntryOn([asArray, BAL], 'record.balance.remaining + 1', 'stamp'))
      .toEqual(fieldEntryOn([STORED, BAL], 'record.balance.remaining + 1', 'stamp'));
    expect(fieldEntryOn([asArray], 'record.f_x + 1', 'f_y')).toEqual(fieldEntryOn([STORED], 'record.f_x + 1', 'f_y'));
  });

  it('a name the definition does not declare is judged as a new formula field, like no name at all', () => {
    // So a field the caller is not served (masked, or absent) reads as one the
    // object does not declare: the answer says nothing about whether it exists.
    for (const expression of ['record.balance.remaining + 1', 'record.f_x + 1', "record.owner_id == 'u1' ? 1 : 0"]) {
      expect(fieldEntryOn([STORED, BAL], expression, 'not_declared')).toEqual(fieldEntryOn([STORED, BAL], expression));
    }
  });
});
