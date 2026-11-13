// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';
import { applyInjectedSystemColumns } from '@objectstack/metadata-core';
import { describe, expect, it } from 'vitest';

import {
  AUTHORED_FORMULA_FIELD_NAME,
  AUTHORED_RULE_NAME,
  authoredExpressionHopTargets,
  judgeAuthoredSiteExpression,
  type AuthoredExpressionSite,
} from './authored-site-expression.js';
import { validateStackExpressions } from './validate-expressions.js';

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
 */

const GATE_SOURCE = readFileSync(new URL('./validate-expressions.ts', import.meta.url), 'utf8');

/** The gate's source between two markers, comments and string bodies blanked. */
function region(start: string, end: string): string {
  const from = GATE_SOURCE.indexOf(start);
  expect(from, `marker moved — update this pin: ${start}`).toBeGreaterThanOrEqual(0);
  const to = GATE_SOURCE.indexOf(end, from + start.length);
  expect(to, `marker moved — update this pin: ${end}`).toBeGreaterThan(from);
  return GATE_SOURCE.slice(from + start.length, to)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

/** The functions a region calls by bare name (a spread call counts; a member call does not). */
function bareCalls(code: string): string[] {
  const KEYWORDS = new Set(['if', 'for', 'while', 'return', 'switch', 'catch', 'function', 'typeof']);
  const names = [...code.matchAll(/(?<![\w$])(?<![^.]\.)([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]!);
  return [...new Set(names)].filter((n) => !KEYWORDS.has(n)).sort();
}

/** Where each site's calls are read: the rule loop and the `check` helper it calls; the field-formula pass and what follows the fields loop. */
const SITE_REGIONS: Record<AuthoredExpressionSite, Array<[string, string]>> = {
  validation: [
    ['  const check = (', '  const fieldRuleRootVerdict = ('],
    ['    for (const rule of recordsOf(validations)) {', '    // Field-level formulas'],
  ],
  formula: [
    ['  const judgeFieldFormula = (', '  // ── Object validation-rule'],
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

const SITE_CALLS: Record<AuthoredExpressionSite, Record<string, Classified>> = {
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
    storedExpressionInputIssues: {
      kind: 'pass-silent-here',
      why: 'judges a STORED field\'s `expression` (any type but `formula`); the tool\'s formula site is a `formula` field',
      fixture: { objects: [REQ, BAL], expression: 'record.balance.remaining > 1 ? now() : now()' },
    },
  },
};

/** The full gate's findings on the same rule or field, named as the entry names it. */
function gateOn(site: AuthoredExpressionSite, objects: Array<Record<string, unknown>>, expression: string) {
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

function entryOn(site: AuthoredExpressionSite, objects: Array<Record<string, unknown>>, expression: string) {
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
