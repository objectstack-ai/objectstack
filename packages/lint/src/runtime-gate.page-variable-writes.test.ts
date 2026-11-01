// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28663 — a page's `variables` declarations are judged at every door.
 *
 * ## The state this closes
 *
 * `PageVariableSchema` types each entry on its own (`name: string`, `type`
 * from a closed enum, `defaultValue: unknown`) and nothing judged the list. So
 * a page published with `valid: true` while it declared:
 *
 * - the same name twice — the console's variable store keeps the LAST, so the
 *   first declaration's type and default are silently gone;
 * - an empty name — no `page.<name>` read can reach it;
 * - a `number` variable with `defaultValue: "abc"` — every `page.count > 0`
 *   compares a string, and the declared type is a lie the author never hears.
 *
 * The rule refuses each at `os validate` / `os build` / `os lint` and at the
 * page save door (draft `_diagnostics`, publish), located at the entry.
 */
import { describe, expect, it } from 'vitest';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';

const DUPLICATE = 'page-variable-name-duplicate';
const EMPTY = 'page-variable-name-empty';
const DEFAULT_TYPE = 'page-variable-default-type';
const IDS = new Set([DUPLICATE, EMPTY, DEFAULT_TYPE]);

const page = (variables: unknown[]) => ({
  name: 'vars_page',
  label: 'Vars',
  type: 'app',
  variables,
  regions: [{ name: 'main', components: [{ type: 'page:header', properties: { title: 'Vars' } }] }],
});

const REFUSED = [
  {
    name: 'a duplicate name',
    variables: [{ name: 'count', type: 'number' }, { name: 'count', type: 'string' }],
    rule: DUPLICATE,
    path: 'pages[0].variables[1].name',
    subject: '`count`',
  },
  {
    name: 'an empty name',
    variables: [{ name: '', type: 'string' }],
    rule: EMPTY,
    path: 'pages[0].variables[0].name',
    subject: 'no name',
  },
  {
    name: 'a blank name',
    variables: [{ name: '   ', type: 'string' }],
    rule: EMPTY,
    path: 'pages[0].variables[0].name',
    subject: 'no name',
  },
  {
    name: 'a `number` with `defaultValue: "abc"` (the card\'s shape)',
    variables: [{ name: 'count', type: 'number', defaultValue: 'abc' }],
    rule: DEFAULT_TYPE,
    path: 'pages[0].variables[0].defaultValue',
    subject: '`count`',
  },
  {
    name: 'a `boolean` with a string default',
    variables: [{ name: 'flag', type: 'boolean', defaultValue: 'true' }],
    rule: DEFAULT_TYPE,
    path: 'pages[0].variables[0].defaultValue',
    subject: '`flag`',
  },
  {
    name: 'an `array` with an object default',
    variables: [{ name: 'items', type: 'array', defaultValue: { a: 1 } }],
    rule: DEFAULT_TYPE,
    path: 'pages[0].variables[0].defaultValue',
    subject: '`items`',
  },
  {
    name: 'an `object` with an array default',
    variables: [{ name: 'filters', type: 'object', defaultValue: ['a'] }],
    rule: DEFAULT_TYPE,
    path: 'pages[0].variables[0].defaultValue',
    subject: '`filters`',
  },
  {
    name: 'a `record_id` with a number default',
    variables: [{ name: 'picked', type: 'record_id', defaultValue: 7 }],
    rule: DEFAULT_TYPE,
    path: 'pages[0].variables[0].defaultValue',
    subject: '`picked`',
  },
  {
    name: 'an undeclared type (the parse default `string`) with a number default',
    variables: [{ name: 'label', defaultValue: 3 }],
    rule: DEFAULT_TYPE,
    path: 'pages[0].variables[0].defaultValue',
    subject: '`label`',
  },
] as const;

/** Declarations the console initialises as declared — the showcase's own included. */
const ACCEPTED = [
  [{ name: 'selectedProjectId', type: 'record_id', source: 'project_picker' }],
  [
    { name: 'inquiryName', type: 'string', source: 'field_name' },
    { name: 'inquiryEmail', type: 'string', source: 'field_email' },
  ],
  [
    { name: 'count', type: 'number', defaultValue: 0 },
    { name: 'flag', type: 'boolean', defaultValue: false },
    { name: 'items', type: 'array', defaultValue: ['a'] },
    { name: 'filters', type: 'object', defaultValue: { status: 'open' } },
    { name: 'picked', type: 'record_id', defaultValue: '' },
    { name: 'label', defaultValue: 'x' },
    // `null` is "no value yet", not a value of another type.
    { name: 'none', type: 'number', defaultValue: null },
  ],
  [],
] as const;

const gatePage = (item: unknown) => runRuntimeAuthoringRules({ type: 'page', item, context: { objects: [] } });
const ours = <T extends { rule: string }>(fs: readonly T[]): T[] => fs.filter((f) => IDS.has(f.rule));
const buildFindings = (item: unknown) => {
  const stack = { pages: [item] };
  return ours(runAuthoringRules('validate', { normalized: stack, parsed: stack }));
};
const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('#28663 — page variable declarations are judged at every door', () => {
  it('the page door runs the page-variable rule', () => {
    expect(runtimeAuthoringRulesFor('page').map((r) => r.name)).toContain('validatePageVariables');
  });

  for (const c of REFUSED) {
    it(`⭐ LIT — ${c.name} is refused at the page door, located at the entry`, () => {
      const result = gatePage(page([...c.variables]));

      const errs = ours(result.errors);
      expect(errs, dump(result)).toHaveLength(1);
      expect(errs[0]).toMatchObject({ rule: c.rule, severity: 'error', path: c.path, where: 'page "vars_page"' });
      expect(errs[0]!.message).toContain(c.subject);
    });
  }

  it('⭐ PARITY — `os validate` refuses each with the door\'s own finding', () => {
    for (const c of REFUSED) {
      const atBuild = buildFindings(page([...c.variables]));
      expect(atBuild, c.name).toHaveLength(1);
      expect(ours(gatePage(page([...c.variables])).errors), c.name).toEqual(atBuild);
    }
  });

  for (const [i, variables] of ACCEPTED.entries()) {
    it(`⭐ CONTROL — declaration set #${i} is admitted at the door and by \`os validate\``, () => {
      const result = gatePage(page([...variables]));
      expect(ours(result.errors), dump(result)).toEqual([]);
      expect(buildFindings(page([...variables]))).toEqual([]);
    });
  }

  it('three faults on one page are three findings, each at its own entry', () => {
    const errs = ours(
      gatePage(page([
        { name: 'count', type: 'number', defaultValue: 'abc' },
        { name: '', type: 'string' },
        { name: 'count', type: 'number' },
      ])).errors,
    );
    expect(errs.map((f) => [f.rule, f.path])).toEqual([
      [DEFAULT_TYPE, 'pages[0].variables[0].defaultValue'],
      [EMPTY, 'pages[0].variables[1].name'],
      [DUPLICATE, 'pages[0].variables[2].name'],
    ]);
  });
});
