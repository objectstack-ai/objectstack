// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28725 — a page's references to its own variables are resolved at every door.
 *
 * ## The state this closes
 *
 * #28663 judged the `variables` list itself (names, defaults). Two references
 * INTO it still published `valid: true` though neither can ever resolve:
 *
 * - a variable whose `source` names a component id the page does not hold —
 *   the console binds a writer by `definitions.find((d) => d.source ===
 *   schema.id)` (`usePageVariableBinding`), so no component ever writes it and
 *   the variable keeps its default for the page's whole life;
 * - a component `visibleWhen` reading `page.NAME` where `NAME` is not declared —
 *   `page` binds exactly the page's declared variables (`buildNodeEvaluationScope`
 *   → `PageVariablesProvider`, which seeds only the declarations and has no
 *   writer for any other name), so the read faults and the element renders
 *   unconditionally.
 *
 * Both are refused at `os validate` / `os build` / `os lint` and at the page
 * save door (draft `_diagnostics`, publish), located at the reference.
 */
import { describe, expect, it } from 'vitest';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

const SOURCE_UNKNOWN = 'page-variable-source-unknown';
const READ_UNDECLARED = 'visibility-page-variable-undeclared';
const IDS = new Set([SOURCE_UNKNOWN, READ_UNDECLARED]);

/** A page with one picker (`project_picker`) and one gated panel. */
const page = (variables: unknown[], visibleWhen: unknown = "page.selectedProjectId != ''") => ({
  name: 'vars_page',
  label: 'Vars',
  type: 'app',
  variables,
  regions: [
    {
      name: 'main',
      components: [
        { type: 'page:header', properties: { title: 'Vars' } },
        { id: 'project_picker', type: 'element:record_picker', properties: { object: 'project' } },
        { id: 'detail_panel', type: 'page:card', properties: { title: 'Detail' }, visibleWhen },
      ],
    },
  ],
});
const PANEL = 'pages[0].regions[0].components[2]';
const PICKED = { name: 'selectedProjectId', type: 'record_id', source: 'project_picker' };

const gatePage = (item: unknown) => runRuntimeAuthoringRules({ type: 'page', item, context: { objects: [] } });
const ours = <T extends { rule: string }>(fs: readonly T[]): T[] => fs.filter((f) => IDS.has(f.rule));
const buildFindings = (item: unknown) => {
  const stack = { pages: [item] };
  return ours(runAuthoringRules('validate', { normalized: stack, parsed: stack }));
};
const dump = (r: unknown) => JSON.stringify(r, null, 2);

const REFUSED = [
  {
    name: 'a `source` naming no component on the page (the card\'s shape)',
    item: page([{ ...PICKED, source: 'no_such_component' }]),
    rule: SOURCE_UNKNOWN,
    path: 'pages[0].variables[0].source',
    subject: '`no_such_component`',
  },
  {
    name: 'a `source` naming a component of another page\'s spelling (case differs)',
    item: page([{ ...PICKED, source: 'Project_Picker' }]),
    rule: SOURCE_UNKNOWN,
    path: 'pages[0].variables[0].source',
    subject: '`Project_Picker`',
  },
  {
    name: 'a `visibleWhen` reading an undeclared `page.nosuch` (the card\'s shape)',
    item: page([PICKED], "page.nosuch == 'x'"),
    rule: READ_UNDECLARED,
    path: PANEL,
    subject: '`page.nosuch`',
  },
  {
    name: 'a `{ dialect, source }` envelope reading an undeclared variable',
    item: page([PICKED], { dialect: 'cel', source: "page.selectedProjectID != ''" }),
    rule: READ_UNDECLARED,
    path: PANEL,
    subject: '`page.selectedProjectID`',
  },
  {
    name: 'an optional select `page.?nosuch`',
    item: page([PICKED], "page.?nosuch.orValue('') == 'x'"),
    rule: READ_UNDECLARED,
    path: PANEL,
    subject: '`page.nosuch`',
  },
  {
    name: 'a `page.X` read on a page that declares no variables at all',
    item: page([], "page.selectedProjectId != ''"),
    rule: READ_UNDECLARED,
    path: PANEL,
    subject: '`page.selectedProjectId`',
  },
] as const;

/** References that resolve, the showcase's own included. */
const ACCEPTED = [
  { name: 'the showcase picker: `source` names the picker, the panel reads the variable', item: page([PICKED]) },
  { name: 'a variable with no `source` (nothing writes it but its default)', item: page([{ name: 'tab', type: 'string', defaultValue: 'a' }], "page.tab == 'a'") },
  { name: 'a `has()` guard on a declared variable', item: page([PICKED], "has(page.selectedProjectId) && page.selectedProjectId != ''") },
  { name: 'a deeper read through a declared object variable', item: page([PICKED, { name: 'filters', type: 'object' }], "page.filters.status == 'open'") },
  { name: 'a comprehension binding `page` as its own loop variable', item: page([PICKED], "[1, 2].exists(page, page > 1)") },
  { name: 'no `page` read at all', item: page([PICKED], "record.status == 'open'") },
] as const;

describe('#28725 — references into a page\'s variables are resolved at every door', () => {
  for (const c of REFUSED) {
    it(`⭐ LIT — ${c.name} is refused at the page door, located at the reference`, () => {
      const result = gatePage(c.item);

      const errs = ours(result.errors);
      expect(errs, dump(result)).toHaveLength(1);
      expect(errs[0]).toMatchObject({ rule: c.rule, severity: 'error', path: c.path, where: 'page "vars_page"' });
      expect(errs[0]!.message).toContain(c.subject);
    });
  }

  it('⭐ PARITY — `os validate` refuses each with the door\'s own finding', () => {
    for (const c of REFUSED) {
      const atBuild = buildFindings(c.item);
      expect(atBuild, c.name).toHaveLength(1);
      expect(ours(gatePage(c.item).errors), c.name).toEqual(atBuild);
    }
  });

  for (const c of ACCEPTED) {
    it(`⭐ CONTROL — ${c.name} is admitted at the door and by \`os validate\``, () => {
      const result = gatePage(c.item);
      expect(ours(result.errors), dump(result)).toEqual([]);
      expect(ours(result.advisories), dump(result)).toEqual([]);
      expect(buildFindings(c.item)).toEqual([]);
    });
  }

  it('a `source` naming a component nested in a container\'s `children` resolves', () => {
    const item = page([{ ...PICKED, source: 'nested_picker' }]);
    (item.regions[0]!.components[2] as any).properties.children = [
      { id: 'nested_picker', type: 'element:record_picker', properties: { object: 'project' } },
    ];
    expect(ours(gatePage(item).errors)).toEqual([]);
  });

  it('a source-authored (`kind: \'react\'`) page is not judged on `source`: its components live in the source', () => {
    const item = { ...page([{ ...PICKED, source: 'jsx_picker' }]), kind: 'react', source: 'export default () => null' };
    expect(ours(gatePage(item).errors).filter((f) => f.rule === SOURCE_UNKNOWN)).toEqual([]);
  });

  it('two undeclared reads in one predicate are one finding naming the first', () => {
    const errs = ours(gatePage(page([PICKED], "page.a == 'x' && page.b == 'y'")).errors);
    expect(errs.map((f) => f.rule)).toEqual([READ_UNDECLARED]);
    expect(errs[0]!.message).toContain('`page.a`');
  });

  it('both faults on one page are two findings, each at its own reference', () => {
    const errs = ours(gatePage(page([{ ...PICKED, source: 'no_such_component' }], "page.nosuch == 'x'")).errors);
    expect(errs.map((f) => [f.rule, f.path]).sort()).toEqual([
      [SOURCE_UNKNOWN, 'pages[0].variables[0].source'],
      [READ_UNDECLARED, PANEL],
    ].sort());
  });
});
