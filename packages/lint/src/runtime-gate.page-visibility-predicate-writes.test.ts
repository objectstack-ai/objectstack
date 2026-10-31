// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24491 — the PAGE write door runs the visibility-predicate family.
 *
 * ## The state this closes
 *
 * `validateVisibilityPredicates` and `validatePredicatePathRefs` (the #7220
 * family) declared `runtimeTypes: ['view']`, so `runtimeAuthoringRulesFor('page')`
 * left them out. A page component `visibleWhen` calling a function the CEL
 * environment does not register (`totallyBogusFn(1)`) was refused by
 * `os validate`, `os build` and `os lint`, and saved clean through Studio,
 * REST `/meta/page` and MCP. At render the predicate faults, the visibility
 * fallback is `true`, and the component renders unconditionally.
 *
 * ## The crossing
 *
 * Ruling of record 6161173492 on #23388 (letter B) moved the two page component
 * rules to this door on one principle: a page with a finding is fixed, then
 * saved. The family follows it, so both entries declare `['view', 'page']`.
 * No gate change: `page` already maps to `pages`, and the page snapshot holds
 * the item as `pages: [item]`.
 *
 * ## What the path half does on a page
 *
 * Nothing, at either door. `validatePredicatePathRefs` walks `stack.views`
 * only, because its oracle is a schema-bound form's `schemaId`, which a page
 * component does not declare. On a page, a wrong reference is the visibility
 * rule's verdict: a bare identifier is refused (`visibility-bare-identifier`),
 * and a `data.`-rooted path draws the advisory `visibility-root-mislayered`.
 * Both doors agree on it. The pin below says so, so that the inert half reads
 * as measured and not as coverage.
 *
 * The protocol-level half (the same verdict through the real `saveMetaItem`
 * and `publishMetaItem`, and a stored page that keeps serving until its next
 * save) is the #24491 block of
 * `packages/metadata-protocol/src/protocol.runtime-authoring-gate.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { runAuthoringRules, type AuthoringFinding } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';
import {
  VISIBILITY_BARE_IDENTIFIER,
  VISIBILITY_PREDICATE_OVER_BUDGET,
  VISIBILITY_PREDICATE_SYNTAX,
  VISIBILITY_PREDICATE_HAS_ARGUMENT,
  VISIBILITY_PREDICATE_UNKNOWN_FUNCTION,
  VISIBILITY_ROOT_MISLAYERED,
} from './validate-visibility-predicates.js';
import {
  PREDICATE_PATH_UNRESOLVED,
  PREDICATE_PATH_UNROOTED,
  PREDICATE_RHS_PATH_SHAPED,
} from './validate-predicate-path-refs.js';

const FAMILY = ['validateVisibilityPredicates', 'validatePredicatePathRefs'];

/** Every rule id the two family entries emit; the page door also runs the component rules. */
const FAMILY_IDS = new Set<string>([
  VISIBILITY_BARE_IDENTIFIER,
  VISIBILITY_PREDICATE_OVER_BUDGET,
  VISIBILITY_PREDICATE_SYNTAX,
  VISIBILITY_PREDICATE_HAS_ARGUMENT,
  VISIBILITY_PREDICATE_UNKNOWN_FUNCTION,
  VISIBILITY_ROOT_MISLAYERED,
  PREDICATE_PATH_UNRESOLVED,
  PREDICATE_PATH_UNROOTED,
  PREDICATE_RHS_PATH_SHAPED,
]);

/** One `page:header` whose props are declared, so a finding is the predicate's. */
const page = (visibleWhen: unknown) => ({
  name: 'pipeline_home',
  label: 'Pipeline',
  type: 'app',
  regions: [
    { name: 'main', components: [{ type: 'page:header', properties: { title: 'Pipeline' }, visibleWhen }] },
  ],
});
const AT = 'pages[0].regions[0].components[0]';
const WHERE = 'page "pipeline_home"';

/**
 * One refused body per finding kind, each refused by `os build` at `error`.
 * The first is the card's shape; the second is the `{ dialect, source }`
 * envelope the platform's own pages author through `P`.
 */
const REFUSED = [
  { body: 'totallyBogusFn(1)', rule: VISIBILITY_PREDICATE_UNKNOWN_FUNCTION, subject: '`totallyBogusFn`' },
  { body: { dialect: 'cel', source: 'totallyBogusFn(1)' }, rule: VISIBILITY_PREDICATE_UNKNOWN_FUNCTION, subject: '`totallyBogusFn`' },
  { body: "current_user.canApprove(record, 'approve')", rule: VISIBILITY_PREDICATE_UNKNOWN_FUNCTION, subject: '`canApprove`' },
  // A wrong reference: no binding root resolves `status`.
  { body: "status == 'open'", rule: VISIBILITY_BARE_IDENTIFIER, subject: '`status`' },
  { body: 'record.status ==', rule: VISIBILITY_PREDICATE_SYNTAX, subject: 'not valid CEL' },
  // [#25281] A `has()` argument the engine refuses: a bare name, an index as the last step.
  { body: 'has(status)', rule: VISIBILITY_PREDICATE_HAS_ARGUMENT, subject: '`status`' },
  { body: 'has(record.items[0])', rule: VISIBILITY_PREDICATE_HAS_ARGUMENT, subject: '`record.items[0]`' },
] as const;

/**
 * Bodies the build accepts on a page component, and so must the door: the
 * shapes the platform and the examples ship (`has()`-guarded record reads, a
 * page variable, the acting user, the `P` envelope) and registered functions.
 */
const ACCEPTED = [
  "has(record.status) && record.status == 'in_review'",
  { dialect: 'cel', source: 'has(record.id) && has(record.email_verified) && record.email_verified == false' },
  "page.selectedProjectId != ''",
  "current_user.email == 'admin@objectos.ai'",
  'size(record.name) > 0',
  "upper(record.name) == 'X'",
] as const;

const gatePage = (item: unknown) =>
  runRuntimeAuthoringRules({ type: 'page', item, context: { objects: [] } });

const family = <T extends { rule: string }>(fs: readonly T[]): T[] => fs.filter((f) => FAMILY_IDS.has(f.rule));

/** The build's family findings for one page, through the build's own entry. */
const buildFindings = (item: unknown): AuthoringFinding[] => {
  const stack = { pages: [item] };
  return family(runAuthoringRules('build', { normalized: stack, parsed: stack }));
};

const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('#24491 — the page door gives the build\'s visibility-predicate verdict', () => {
  it('dispatches `page` writes to both family rules, after the component rules', () => {
    expect(runtimeAuthoringRulesFor('page').map((r) => r.name)).toEqual([
      // #24814 — the expression rule's one page pass, the action copy template
      // slots (warnings only); first because it is the registry's first rule.
      'validateStackExpressions',
      'validatePresetComparands',
      'validateComponentProps',
      'validateComponentTypes',
      'validatePrintPageBlocks',
      // #28005 — an object-form's thank-you panel naming a field the engine
      // does not generate.
      'validateThankYouRecordFields',
      ...FAMILY,
      // #24953 / #25002 — the props-bag CEL slots' bounds refusal, after the family.
      'validatePagePredicateBounds',
    ]);
  });

  for (const refused of REFUSED) {
    const { body, rule, subject } = refused;
    it(`⭐ LIT — a component \`visibleWhen: ${JSON.stringify(body)}\` is REFUSED at the component`, () => {
      const result = gatePage(page(body));

      expect(result.rulesRun).toEqual(expect.arrayContaining(FAMILY));
      const errs = family(result.errors);
      expect(errs, dump(result)).toHaveLength(1);
      expect(errs[0]).toMatchObject({ rule, severity: 'error', where: WHERE, path: AT });
      expect(errs[0]!.message).toContain(subject);
    });
  }

  for (const body of ACCEPTED) {
    it(`⭐ CONTROL — a component \`visibleWhen: ${JSON.stringify(body)}\` publishes clean, and the build agrees`, () => {
      const result = gatePage(page(body));

      expect(result.rulesRun).toEqual(expect.arrayContaining(FAMILY));
      expect(family(result.errors), dump(result)).toEqual([]);
      expect(family(result.advisories), dump(result)).toEqual([]);
      expect(buildFindings(page(body))).toEqual([]);
    });
  }

  it('⭐ PARITY — for each refused page body the door findings ARE the build findings', () => {
    for (const { body } of REFUSED) {
      const atBuild = buildFindings(page(body));
      const atDoor = family(gatePage(page(body)).errors);

      // Non-vacuous: the build refuses each of them.
      expect(atBuild.filter((f) => f.severity === 'error'), JSON.stringify(body)).toHaveLength(1);
      // Rule, location, message and hint: the whole finding, compared as one.
      expect(atDoor, JSON.stringify(body)).toEqual(atBuild);
    }
  });

  it('the path half judges nothing on a page: a `data.` path draws the same advisory at both doors, and no refusal', () => {
    const body = page("data.tpye == 'formula'");
    const result = gatePage(body);

    expect(result.rulesRun).toContain('validatePredicatePathRefs');
    expect(family(result.errors), dump(result)).toEqual([]);
    expect(family(result.advisories).map((f) => f.rule), dump(result)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
    expect(family(result.advisories)).toEqual(buildFindings(body));
  });

  it('the `view` control: a view write is judged exactly as before', () => {
    // `validateStackExpressions` joined for its bulk `confirmText` pass alone
    // (#24798) — no visibility predicate is judged by it on a view write.
    expect(runtimeAuthoringRulesFor('view').map((r) => r.name)).toEqual([
      'validateStackExpressions',
      'validatePresetComparands',
      'validateReferenceIntegrity',
      'validatePublicFormFileFields',
      'validateThankYouRecordFields',
      ...FAMILY,
    ]);
    const view = (visibleWhen: string, data?: unknown) => ({
      name: 'field_editor',
      label: 'Field editor',
      form: {
        ...(data ? { data } : {}),
        sections: [{ label: 'Main', fields: [{ field: 'name', visibleWhen }] }],
      },
    });
    const gateView = (item: unknown) => runRuntimeAuthoringRules({ type: 'view', item, context: { objects: [] } });

    const fn = family(gateView(view('totallyBogusFn(1)')).errors);
    expect(fn.map((f) => [f.rule, f.path])).toEqual([
      [VISIBILITY_PREDICATE_UNKNOWN_FUNCTION, 'views[0].form.sections[0].fields[0]'],
    ]);
    // [#25281] The `has()` argument arm reaches the view door the same way.
    expect(family(gateView(view('has(status)')).errors).map((f) => [f.rule, f.path])).toEqual([
      [VISIBILITY_PREDICATE_HAS_ARGUMENT, 'views[0].form.sections[0].fields[0]'],
    ]);
    // The path half is live on the view surface it was built for.
    const path = family(gateView(view("data.tpye == 'text'", { provider: 'schema', schemaId: 'field' })).errors);
    expect(path.map((f) => f.rule)).toContain(PREDICATE_PATH_UNRESOLVED);
  });
});
