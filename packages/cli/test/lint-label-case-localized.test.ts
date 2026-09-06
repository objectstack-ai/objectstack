// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `convention/label-case` must not crash `os lint` on a localized label.
 *
 * ## What this file pins, and how each half can fail
 *
 * The rule indexed its argument (`label[0].toUpperCase()`) on a parameter
 * annotated `string` that every call site reaches through `any`-typed config
 * walking. `I18nLabelSchema` is `z.union([z.string(), InlineLocaleMapSchema])`,
 * so on the map form `label[0]` is `undefined` and the rule threw — out of
 * `lintConfig`, into the command's catch-all, exit 1 on every face with a
 * message naming no rule, no path and no remedy.
 *
 * Two independent properties, and neither one covers the other:
 *
 *  1. **NO MOVE** — the check on a plain string label is unchanged. This is
 *     the property that makes a guard the uncontroversial floor, so it is
 *     pinned per carrier rather than asserted in prose. Falsified by any guard
 *     that also swallows strings (a `typeof` typo, an early return placed
 *     above the string branch, a `label != null` guard that changes the
 *     empty-string case): every lowercase row below stops reporting.
 *  2. **NO CRASH** — a localized label is walked without throwing, on every
 *     carrier whose schema accepts the map. Falsified by removing the guard:
 *     each of those rows throws a `TypeError` instead of returning issues.
 *
 * ## Why the carriers are enumerated rather than sampled
 *
 * The filed mutation sweep hit exactly two paths (`apps.0.label`,
 * `views.0.list.label`) because the fixture it swept had exactly those two.
 * The class is the set of call sites, not the set of sweep hits:
 * `lintConfig` calls this rule from four places, and the schema decides which
 * of them can carry a map —
 *
 *   | call site                       | governing schema                        | map?  |
 *   | `objects[].label`               | `ObjectSchema.label` — `z.string()`     | no    |
 *   | `objects[].fields.*.label`      | field base — `z.string()`               | no    |
 *   | `views[].list{,Views.*}.label`  | `ListViewShapeSchema` — `I18nLabelSchema` | yes |
 *   | `apps[].label`                  | `AppSchema.label` — `I18nLabelSchema`   | yes   |
 *
 * — which is why `views[].listViews.*.label` is pinned below even though no
 * sweep ever reached it: it is the same primitive behind a second path, and
 * `getViewLabel` only falls through to it when `list.label` is absent.
 *
 * ## What the rule now SAYS about a localized label: nothing
 *
 * Deliberately. Case is a property of a literal; deciding which locale entry a
 * case verdict is taken against is a product call this card does not make. So
 * the localized rows assert the ABSENCE of a `convention/label-case` issue —
 * if someone later widens the rule to resolve the map, these are the
 * assertions that must be rewritten on purpose rather than silently satisfied.
 */

import { describe, expect, it } from 'vitest';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import { lintConfig } from '../src/commands/lint';
import { scoreMetadata } from '../src/lint/score';

const MANIFEST = {
  id: 'todo',
  namespace: 'todo',
  version: '1.0.0',
  name: 'Todo',
  type: 'app' as const,
};

/** The card's own fixture value, plus the sweep's literal hit value. */
const LOCALIZED = { en: 'Todos', 'zh-CN': '待办' };
const EMPTY_MAP = {};

const caseIssues = (issues: { rule: string }[]) =>
  issues.filter((i) => i.rule === 'convention/label-case');

/** `objects[]` needs fields to avoid drowning the label rows in structure issues. */
const objectWith = (label: unknown) => ({
  name: 'invoice',
  label,
  fields: { name: { type: 'text', label: 'Invoice Number' } },
});

const objectWithFieldLabel = (label: unknown) => ({
  name: 'invoice',
  label: 'Invoice',
  fields: { name: { type: 'text', label } },
});

const stackWithApp = (label: unknown) => ({
  manifest: MANIFEST,
  apps: [{ name: 'todo_app', label }],
});

const stackWithListLabel = (label: unknown) => ({
  manifest: MANIFEST,
  views: [{ name: 'invoice_views', object: 'invoice', list: { label, type: 'grid', columns: ['name'] } }],
});

const stackWithNamedListLabel = (label: unknown) => ({
  manifest: MANIFEST,
  views: [{
    name: 'invoice_views',
    object: 'invoice',
    listViews: { all: { label, type: 'grid', columns: ['name'] } },
  }],
});

describe('convention/label-case — the plain-string check does not move', () => {
  // Falsification for every row: a guard that swallows strings as well as
  // maps makes the lowercase rows report nothing and this whole block red.
  const rows: [string, unknown, string][] = [
    ['objects[].label', { objects: [objectWith('invoice')] }, 'objects[0].label'],
    ['objects[].fields.*.label', { objects: [objectWithFieldLabel('invoice number')] }, 'objects[0].fields.name.label'],
    ['views[].list.label', stackWithListLabel('accounts'), 'views[0].list.label'],
    ['views[].listViews.*.label', stackWithNamedListLabel('all accounts'), 'views[0].listViews.all.label'],
    ['apps[].label', stackWithApp('todos'), 'apps[0].label'],
  ];

  for (const [carrier, config, path] of rows) {
    it(`still warns on a lowercase string at ${carrier}`, () => {
      const issues = caseIssues(lintConfig(config as any));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual({
        severity: 'warning',
        rule: 'convention/label-case',
        message: expect.stringContaining('should start with an uppercase letter'),
        path,
        fix: expect.any(String),
      });
    });
  }

  it('carries the label verbatim in the message and the capitalized value in `fix`', () => {
    // The message/fix wording is what an author reads, so it is pinned whole
    // on one row rather than left to `stringContaining` everywhere.
    const [issue] = caseIssues(lintConfig(stackWithApp('todos') as any));
    expect(issue).toMatchObject({
      message: 'Label "todos" should start with an uppercase letter',
      fix: 'Todos',
    });
  });

  it('stays silent on an already-uppercase string', () => {
    expect(caseIssues(lintConfig(stackWithApp('Todos') as any))).toEqual([]);
  });

  it('stays silent on a label whose first character has no case (unchanged)', () => {
    // `'1st quarter'[0].toUpperCase()` === `'1'`, so the rule never fired here
    // and must still not. A guard written as `label.length && ...` would keep
    // this green; one written as "warn unless the first char is uppercase"
    // would flip it. That is the distinction this row protects.
    expect(caseIssues(lintConfig(stackWithApp('1st quarter') as any))).toEqual([]);
  });
});

describe('convention/label-case — a localized label is walked, not indexed', () => {
  // Falsification for every row: drop the `typeof label !== 'string'` guard
  // and each of these throws `TypeError: Cannot read properties of undefined
  // (reading 'toUpperCase')` instead of returning.
  const rows: [string, (label: unknown) => unknown][] = [
    ['apps[].label', stackWithApp],
    ['views[].list.label', stackWithListLabel],
    ['views[].listViews.*.label', stackWithNamedListLabel],
  ];

  for (const [carrier, build] of rows) {
    it(`does not throw on an inline locale map at ${carrier}`, () => {
      expect(() => lintConfig(build(LOCALIZED) as any)).not.toThrow();
    });

    it(`does not throw on an EMPTY locale map at ${carrier}`, () => {
      // `{}` is the value the filed sweep actually mutated in, and it is a
      // valid `InlineLocaleMapSchema` (a `z.record` with no entries).
      expect(() => lintConfig(build(EMPTY_MAP) as any)).not.toThrow();
    });

    it(`reports no case verdict for the localized label at ${carrier}`, () => {
      expect(caseIssues(lintConfig(build(LOCALIZED) as any))).toEqual([]);
    });

    it(`does not report the localized label as MISSING at ${carrier}`, () => {
      // The other failure mode a careless guard produces: treat a non-string
      // as absent and emit `required/label`, which would be a NEW error on a
      // schema-valid config — the opposite of leaving behaviour where it was.
      const issues = lintConfig(build(LOCALIZED) as any) as { rule: string }[];
      expect(issues.filter((i) => i.rule === 'required/label')).toEqual([]);
    });
  }

  it('does not throw on a non-string, non-map label either', () => {
    // Schema-INVALID input (no label carrier accepts a number), so this is
    // not the defect's class — but the guard is written on the type, not on
    // the map shape, and a linter that dies on bad input still cannot report
    // the bad input. Falsified by a guard spelled `if (isLocaleMap(label))`.
    expect(() => lintConfig(stackWithApp(42) as any)).not.toThrow();
    expect(caseIssues(lintConfig(stackWithApp(42) as any))).toEqual([]);
  });
});

describe('the localized fixtures are schema-VALID — this is not bad input', () => {
  // Falsification: if any of these stopped parsing, the crash rows above
  // would be pinning a diagnostic degrading on bad input (acceptable) rather
  // than a tool that cannot walk a supported authoring shape (the defect).
  const stacks: [string, unknown][] = [
    ['apps[].label', stackWithApp(LOCALIZED)],
    ['views[].list.label', stackWithListLabel(LOCALIZED)],
    ['views[].listViews.*.label', stackWithNamedListLabel(LOCALIZED)],
    ['apps[].label, empty map', stackWithApp(EMPTY_MAP)],
  ];

  for (const [carrier, stack] of stacks) {
    it(`${carrier} parses clean`, () => {
      const parsed = ObjectStackDefinitionSchema.safeParse(normalizeStackInput(stack as any));
      expect(parsed.success).toBe(true);
    });
  }

  it('CONTROL: a number label does NOT parse, so the parse check discriminates', () => {
    const parsed = ObjectStackDefinitionSchema.safeParse(normalizeStackInput(stackWithApp(42) as any));
    expect(parsed.success).toBe(false);
  });
});

describe('the scorer reaches a verdict on a localized stack', () => {
  // The join with the swallowed-crash repair one module over: that repair
  // makes `scoreMetadata` REFUSE when a rule throws. With the guard there is
  // no throw, so the refusal must not fire here. Falsification: drop the
  // guard and `lintError` is set, `valid` is false, `grade` is 'F'.
  it('scores it without a lint crash', () => {
    const r = scoreMetadata(stackWithApp(LOCALIZED));
    expect(r.lintError).toBeUndefined();
    expect(r.valid).toBe(true);
    expect(r.counts.schemaErrors).toBe(0);
    expect(r.grade).not.toBe('F');
  });
});
