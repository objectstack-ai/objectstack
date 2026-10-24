/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `NavigationItemSchema` CHAINS the spec's target-exclusivity rule (objectui#8563).
 *
 * `packages/types/src/zod/app.zod.ts` writes this schema by hand rather than
 * deriving it from a spec `.shape`, so no mechanism carried the spec's own
 * checks across: an object nav entry declaring both `filters` and `recordId`
 * parsed clean HERE and was refused by `@objectstack/spec`, i.e. by the publish
 * door — the drift only surfaced where it was most expensive to find.
 *
 * The fix is to call the spec's exported `objectNavTargetExclusivity`, and the
 * distinction this file exists to police is CHAIN vs COPY. A hand-copy of the
 * rule body passes every accept/refuse case on the day it is written and starts
 * drifting the day the spec's own rule moves — which is the defect above,
 * re-created one layer down. So two of the assertions below are about identity
 * rather than behaviour:
 *
 *  - the door's issues are compared BYTE FOR BYTE against the same function
 *    driven directly, so a reworded local copy fails even when it refuses the
 *    same set;
 *  - the mirror's source is parsed, so a local re-declaration of the name fails
 *    even if it happened to produce identical bytes.
 *
 * ⚠️ The rule is deliberately NOT pairwise-exclusive over the target fields, and
 * the six negative controls are the half that keeps a "tighten it everywhere"
 * edit from passing: `recordId` + `viewName` is TOLERATED, and `runAction` is
 * refused with `recordId` ONLY — it composes with `viewName` or `filters`. Both
 * asymmetries are the spec's on purpose; they are re-derived here from the
 * installed rule, not from prose.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { z } from 'zod';
import { objectNavTargetExclusivity } from '@objectstack/spec/ui';
import { NavigationItemSchema } from '../zod/app.zod.js';

const MIRROR = join(dirname(fileURLToPath(import.meta.url)), '..', 'zod', 'app.zod.ts');
const RULE = 'objectNavTargetExclusivity';

/** A valid object entry; each case below adds ONLY the target fields it names. */
const BASE = { id: 'nav_tickets', type: 'object', label: 'Tickets', objectName: 'ticket' } as const;

const parse = (targets: Record<string, unknown>) => NavigationItemSchema.safeParse({ ...BASE, ...targets });

/** `{ code, path, message }` for each issue the DOOR raised, order preserved. */
const doorIssues = (targets: Record<string, unknown>): Array<Record<string, unknown>> => {
  const r = parse(targets);
  if (r.success) return [];
  return r.error.issues.map((i) => ({ code: i.code, path: [...i.path], message: i.message }));
};

/**
 * The rule's OWN declared parameter surface, read off the export rather than
 * restated: `{ filters?, recordId?, viewName?, runAction? }`, all `unknown`. It
 * is a weak type, so the full nav entry is widened into it deliberately — a
 * nav item is a superset of the four fields the rule reads.
 */
type RuleInput = Parameters<typeof objectNavTargetExclusivity>[0];

/** …and for each issue the SPEC's exported rule raises, driven directly. */
const specRuleIssues = (targets: Record<string, unknown>): Array<Record<string, unknown>> => {
  const issues: Array<Record<string, unknown>> = [];
  const ctx = { addIssue: (i: Record<string, unknown>) => issues.push(i) } as unknown as z.RefinementCtx;
  objectNavTargetExclusivity({ ...BASE, ...targets } as RuleInput, ctx);
  return issues.map((i) => ({ code: i.code, path: [...(i.path as unknown[])], message: i.message as string }));
};

describe('the object arm refuses the ambiguous landings (objectui#8563)', () => {
  it('refuses `filters` + `recordId` at `filters`, with code custom', () => {
    const issues = doorIssues({ filters: { status: 'open' }, recordId: 'rec_1' });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].path).toEqual(['filters']);
  });

  it('refuses `filters` + `viewName` at `filters`, with code custom', () => {
    const issues = doorIssues({ filters: { status: 'open' }, viewName: 'open_tickets' });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].path).toEqual(['filters']);
  });

  it('refuses `runAction` + `recordId` at `runAction`, with code custom', () => {
    const issues = doorIssues({ runAction: 'create_ticket', recordId: 'rec_1' });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].path).toEqual(['runAction']);
  });

  it('reaches the rule through a nested `children` entry too, not only at the root', () => {
    const r = NavigationItemSchema.safeParse({
      id: 'grp', type: 'group', label: 'Group',
      children: [{ ...BASE, filters: { status: 'open' }, recordId: 'rec_1' }],
    });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => [...i.path])).toContainEqual(['children', 0, 'filters']);
  });
});

describe('the neighbours the rule deliberately tolerates still parse', () => {
  // ⛔ Do not "simplify" this into pairwise exclusivity. Every row is a landing
  // the spec accepts on purpose; a row flipping to refused is a narrowing this
  // repo invented, not one it inherited.
  const CONTROLS: Array<readonly [string, Record<string, unknown>]> = [
    ['filters alone', { filters: { status: 'open' } }],
    ['recordId alone', { recordId: 'rec_1' }],
    ['viewName alone', { viewName: 'open_tickets' }],
    ['recordId + viewName (tolerated legacy pair)', { recordId: 'rec_1', viewName: 'open_tickets' }],
    ['runAction + filters', { runAction: 'create_ticket', filters: { status: 'open' } }],
    ['runAction + viewName', { runAction: 'create_ticket', viewName: 'open_tickets' }],
  ];

  it.each(CONTROLS)('accepts %s', (_label, targets) => {
    const r = parse(targets);
    expect(r.success ? [] : r.error.issues.map((i) => `${[...i.path].join('.')}: ${i.message}`)).toEqual([]);
    expect(r.success).toBe(true);
  });

  it('the controls are not vacuous — the rule itself raises nothing for any of them', () => {
    // Guards the comparison in the identity test below from being empty==empty.
    for (const [label, targets] of CONTROLS) {
      expect(specRuleIssues(targets), `the spec rule refused the control "${label}"`).toEqual([]);
    }
  });
});

describe('the rule is CHAINED, not copied', () => {
  it('the published export is a live two-argument function', () => {
    expect(typeof objectNavTargetExclusivity).toBe('function');
    expect(objectNavTargetExclusivity.name).toBe(RULE);
    expect(objectNavTargetExclusivity.length).toBe(2);
  });

  it("the door's issues are the spec rule's own bytes, not a restatement", () => {
    for (const targets of [
      { filters: { status: 'open' }, recordId: 'rec_1' },
      { filters: { status: 'open' }, viewName: 'open_tickets' },
      { runAction: 'create_ticket', recordId: 'rec_1' },
      { filters: { status: 'open' }, recordId: 'rec_1', runAction: 'create_ticket' },
    ]) {
      const fromRule = specRuleIssues(targets);
      expect(fromRule.length, 'the instrument saw no issue at all').toBeGreaterThan(0);
      expect(doorIssues(targets)).toEqual(fromRule);
    }
  });

  it('the mirror imports the rule from `@objectstack/spec/ui` and declares no local copy', () => {
    const text = readFileSync(MIRROR, 'utf8');
    const sf = ts.createSourceFile('app.zod.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    let importedFrom: string | null = null;
    const localDeclarations: string[] = [];
    let calls = 0;

    const visit = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
        const named = n.importClause?.namedBindings;
        if (named && ts.isNamedImports(named)) {
          for (const el of named.elements) {
            if ((el.propertyName ?? el.name).text === RULE) importedFrom = n.moduleSpecifier.text;
          }
        }
      }
      // A local re-declaration is the copy this test exists to refuse.
      if (ts.isFunctionDeclaration(n) && n.name?.text === RULE) localDeclarations.push('function');
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === RULE) localDeclarations.push('const');
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === RULE) calls += 1;
      ts.forEachChild(n, visit);
    };
    visit(sf);

    expect(importedFrom).toBe('@objectstack/spec/ui');
    expect(localDeclarations).toEqual([]);
    expect(calls, 'the mirror imports the rule but never calls it').toBeGreaterThan(0);
  });

  it('no `.describe()` in the mirror still teaches the precedence the rule refuses', () => {
    // The sentence "Precedence: recordId -> filters -> viewName" was copied from
    // a spec docblock the spec itself corrected: no precedence resolves these
    // combinations, they are refused. A describe that teaches one is a trap for
    // whoever authors against it.
    const text = readFileSync(MIRROR, 'utf8');
    expect(text).not.toMatch(/Precedence:\s*recordId/i);
    expect(text).toContain('Mutually exclusive with recordId/viewName.');
  });
});
