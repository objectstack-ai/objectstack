// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28663 — an app navigation entry's `visible` is judged by the same
 * `visibility-predicate-syntax` verdict a page component's `visibleWhen` is.
 *
 * ## The state this closes
 *
 * `validateVisibilityPredicates` walked `views[]` form sections and `pages[]`
 * components only, and the family declared `runtimeTypes: ['view', 'page']`.
 * An app whose `navigation[].visible` (or `areas[].navigation[].visible`) did
 * not parse — `"'org_owner' in"` — saved, read `_diagnostics: { valid: true }`
 * as a draft, published, and passed `os validate`. The console reads a bare
 * string there as CEL (#27457), the parse faults, and the entry is withheld
 * from every viewer with nothing said to the author.
 *
 * ## What is judged on a nav entry, and what is not
 *
 * The front end's refusal only — syntax here, size since #28726 (below) —
 * the one judgment every predicate surface shares.
 * The family's other ids judge references against the roots a view or page
 * binds (`record`, `current_user`, `page`); a navigation entry binds a
 * different set (`current_user`, `user`, `ctx.user`, `os.user`, `features`,
 * and `data` beside a `dataSource`), so those verdicts would refuse
 * predicates the console evaluates. A bare string and a `{ dialect: 'cel' }`
 * envelope are CEL; an envelope of another dialect is the console's legacy
 * reading, not CEL, and is not judged.
 *
 * The protocol-level half (the real save, draft read and publish) is
 * `packages/metadata-protocol/src/protocol.draft-publish-verdict.test.ts` and
 * the #28663 block of `protocol.runtime-authoring-gate.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';

const SYNTAX = 'visibility-predicate-syntax';
const FAMILY = ['validateVisibilityPredicates', 'validatePredicatePathRefs'];
/** The card's shape: a membership test with no right-hand side. */
const BROKEN = "'org_owner' in";

const entry = (visible: unknown, extra: Record<string, unknown> = {}) => ({
  id: 'nav_admin_only',
  type: 'object',
  label: 'Admin Only Entry',
  objectName: 'qa_note',
  visible,
  ...extra,
});
const topLevelApp = (visible: unknown) => ({ name: 'qa_app', label: 'QA App', navigation: [entry(visible)] });
const areaApp = (visible: unknown) => ({
  name: 'qa_app',
  label: 'QA App',
  areas: [{ id: 'area_ops', label: 'Ops', navigation: [entry(visible)] }],
});
const nestedApp = (visible: unknown) => ({
  name: 'qa_app',
  label: 'QA App',
  navigation: [{ id: 'grp', type: 'group', label: 'Group', children: [entry(visible)] }],
});

const SITES = [
  { name: 'top-level', app: topLevelApp, path: 'apps[0].navigation[0].visible' },
  { name: 'inside an area', app: areaApp, path: 'apps[0].areas[0].navigation[0].visible' },
  { name: 'inside a group', app: nestedApp, path: 'apps[0].navigation[0].children[0].visible' },
] as const;

/** Shapes the console evaluates on a nav entry, so neither door may refuse them. */
const ACCEPTED = [
  "'org_owner' in current_user.positions",
  { dialect: 'cel', source: "'org_owner' in current_user.positions" },
  'features.cloudManaged != true',
  "current_user.can('crm_opportunity', 'read')",
  'user.isPlatformAdmin == true',
  // Another dialect is the console's legacy reading, not CEL: not this rule's verdict.
  { dialect: 'template', source: "'org_owner' in" },
  true,
] as const;

const gateApp = (item: unknown) => runRuntimeAuthoringRules({ type: 'app', item, context: { objects: [] } });
const syntax = <T extends { rule: string }>(fs: readonly T[]): T[] => fs.filter((f) => f.rule === SYNTAX);
const buildSyntax = (app: unknown) => {
  const stack = { apps: [app] };
  return syntax(runAuthoringRules('validate', { normalized: stack, parsed: stack }));
};
const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('#28663 — an app nav `visible` that does not parse is refused at every door', () => {
  it('the app door runs the visibility-predicate family', () => {
    expect(runtimeAuthoringRulesFor('app').map((r) => r.name)).toEqual(expect.arrayContaining(FAMILY));
  });

  for (const site of SITES) {
    it(`⭐ LIT — \`visible: ${JSON.stringify(BROKEN)}\` ${site.name} is refused at the app door, located at the key`, () => {
      const result = gateApp(site.app(BROKEN));

      const errs = syntax(result.errors);
      expect(errs, dump(result)).toHaveLength(1);
      expect(errs[0]).toMatchObject({ severity: 'error', path: site.path, where: 'app "qa_app" · nav "nav_admin_only"' });
      expect(errs[0]!.message).toContain('not valid CEL');
      // The nav consequence, not the page one: a faulting nav gate hides the entry.
      expect(errs[0]!.message).toContain('hidden from every viewer');
    });

    it(`⭐ LIT — the same app fails \`os validate\` with the door's finding (${site.name})`, () => {
      const atBuild = buildSyntax(site.app(BROKEN));
      const atDoor = syntax(gateApp(site.app(BROKEN)).errors);

      expect(atBuild, dump(atBuild)).toHaveLength(1);
      expect(atDoor).toEqual(atBuild);
    });
  }

  it('the `{ dialect: \'cel\' }` envelope of the same source is refused too', () => {
    const errs = syntax(gateApp(topLevelApp({ dialect: 'cel', source: BROKEN })).errors);
    expect(errs.map((f) => f.path)).toEqual(['apps[0].navigation[0].visible']);
  });

  for (const visible of ACCEPTED) {
    it(`⭐ CONTROL — \`visible: ${JSON.stringify(visible)}\` is admitted at the door and by \`os validate\``, () => {
      for (const site of SITES) {
        const result = gateApp(site.app(visible));
        expect(syntax(result.errors), dump(result)).toEqual([]);
        expect(buildSyntax(site.app(visible))).toEqual([]);
      }
    });
  }
});

/**
 * #28726 — an app nav `visible` that is valid CEL but overruns a
 * `DEFAULT_LIMITS` parse bound is refused as `visibility-predicate-over-budget`,
 * the id a page `visibleWhen` of the same size already gets.
 *
 * Measured before the change on a stock showcase boot: an app whose nav entry
 * held the card's 90-clause `||` chain saved, read draft `_diagnostics`
 * `{ valid: true }` and published; the console then withheld the entry
 * (`[bounds] Exceeded maxAstNodes (256)`, "withholding") while a one-clause
 * twin beside it rendered. The syntax arm #28663 added ran on the nav walker,
 * the bounds arm did not.
 */
describe('#28726 — an app nav `visible` over the CEL parse budget is refused at every door', () => {
  const OVER_BUDGET = 'visibility-predicate-over-budget';
  const CLAUSE = 'features.cloudManaged != true';
  const chain = (n: number) => Array.from({ length: n }, () => CLAUSE).join(' || ');
  /** The card's shape: 90 clauses, valid CEL, over `maxAstNodes` (256). */
  const OVER = chain(90);
  /** The largest chain of the same clause the front end admits (51; 52 overruns). */
  const UNDER = chain(51);
  const overBudget = <T extends { rule: string }>(fs: readonly T[]): T[] => fs.filter((f) => f.rule === OVER_BUDGET);
  const buildOverBudget = (app: unknown) => {
    const stack = { apps: [app] };
    return overBudget(runAuthoringRules('validate', { normalized: stack, parsed: stack }));
  };

  for (const site of SITES) {
    it(`⭐ LIT — a 90-clause \`||\` chain ${site.name} is refused at the app door as over-budget, located at the key`, () => {
      const result = gateApp(site.app(OVER));

      const errs = overBudget(result.errors);
      expect(errs, dump(result)).toHaveLength(1);
      expect(errs[0]).toMatchObject({ severity: 'error', path: site.path, where: 'app "qa_app" · nav "nav_admin_only"' });
      // The bound and its platform value are named, not the dialect.
      expect(errs[0]!.message).toContain('`maxAstNodes` budget (platform limit 256)');
      // The nav consequence, not the page one: a faulting nav gate hides the entry.
      expect(errs[0]!.message).toContain('hidden from every viewer');
      expect(errs[0]!.message).not.toContain('always renders');
      // A size fault is not a syntax fault: the syntax id stays silent.
      expect(syntax(result.errors), dump(result)).toEqual([]);
    });

    it(`⭐ LIT — the same app fails \`os validate\` with the door's finding (${site.name})`, () => {
      const atBuild = buildOverBudget(site.app(OVER));
      const atDoor = overBudget(gateApp(site.app(OVER)).errors);

      expect(atBuild, dump(atBuild)).toHaveLength(1);
      expect(atDoor).toEqual(atBuild);
    });

    it(`⭐ CONTROL — a 51-clause chain ${site.name} (inside the budget) is admitted at the door and by \`os validate\``, () => {
      const result = gateApp(site.app(UNDER));
      expect(overBudget(result.errors), dump(result)).toEqual([]);
      expect(syntax(result.errors), dump(result)).toEqual([]);
      expect(buildOverBudget(site.app(UNDER))).toEqual([]);
    });
  }

  it('the `{ dialect: \'cel\' }` envelope of the same source is refused too; another dialect is not judged', () => {
    expect(overBudget(gateApp(topLevelApp({ dialect: 'cel', source: OVER })).errors).map((f) => f.path))
      .toEqual(['apps[0].navigation[0].visible']);
    expect(overBudget(gateApp(topLevelApp({ dialect: 'template', source: OVER })).errors)).toEqual([]);
  });

  it('the remedy names a nav-shaped rewrite, not a `record` field or a formula on the object', () => {
    const [f] = overBudget(gateApp(topLevelApp(OVER)).errors);
    expect(f!.hint).toContain('current_user.positions.exists(');
    expect(f!.hint).not.toContain('record.');
  });

  it('a page `visibleWhen` of the same size keeps its own finding, unchanged (falls open, record-rooted remedy)', () => {
    const page = {
      name: 'qa_page',
      label: 'QA',
      type: 'app',
      regions: [{ name: 'main', components: [{ type: 'element:text', id: 'b1', visibleWhen: OVER, properties: { content: 'x' } }] }],
    };
    const errs = overBudget(runRuntimeAuthoringRules({ type: 'page', item: page, context: { objects: [] } }).errors);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toContain('always renders');
    expect(errs[0]!.hint).toContain('record.f in');
  });
});
