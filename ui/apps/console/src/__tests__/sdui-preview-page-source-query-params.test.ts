/**
 * The ADR-0080 browser preview harnesses, held to `no-unprefixed-query-params`
 * BY THAT RULE — the same `eslint-rules/no-unprefixed-query-params.js` that
 * `eslint.config.js` loads, run here over text ESLint itself cannot reach.
 *
 * WHY THIS FILE EXISTS (objectui#5944). The rule (objectui#5458) anchors on a
 * `CallExpression` whose callee is `.find`/`.findOne`. That anchor is
 * load-bearing, not incidental: every spelling on its list (`top`, `limit`,
 * `filter`, `sort`, `count`) is an ordinary English word, so outside a finder
 * call the name carries no signal — which is why a text scan over the same list
 * is NOT the answer here (it would match the rule's own docblock, the issue,
 * and the prose in `content/docs/guide/react-pages.md`).
 *
 * Three of that card's four live sites are real calls and the rule reported all
 * three. The fourth — `sdui-workbench-preview.tsx` — holds its page source in a
 * TEMPLATE LITERAL, which the parser sees as one `TemplateLiteral` token and
 * never as a `CallExpression`. No AST rule can reach inside it. It was fixed by
 * hand and nothing rejected the next one written there.
 *
 * The fix is not a different rule, it is a different SUBJECT: pull the page
 * source out of the harness, and the rule's own anchor works on it perfectly.
 * So this file extracts each page `source` (`helpers/preview-page-sources.ts` —
 * the same enumeration the styling test uses, so a NEW harness is covered
 * without anyone remembering to add it) and runs the REAL rule over it. Not a
 * re-implementation and not a second key list: a copy of a rule cannot disagree
 * with itself.
 *
 * NON-VACUITY IS PINNED HERE, NOT ARGUED. The tree is clean at that site, so a
 * green run proves nothing on its own. Two guards make the green mean
 * something: a control that the rule fires and falls silent on a synthetic
 * pair, and — the load-bearing one — a MUTATION over the real extracted source,
 * which strips the `$` off the canonical spellings taken from the rule's own
 * `QUERY_OPTION_SPELLINGS` and requires the gate to go red. That mutation runs
 * against whatever the harness says today, so it cannot rot into a tautology.
 */
import { describe, it, expect } from 'vitest';
import { Linter, type Rule } from 'eslint';
import rule, { QUERY_OPTION_SPELLINGS } from '../../../../eslint-rules/no-unprefixed-query-params.js';
import { pagesOf, previewHarnessFiles, readHarness } from './helpers/preview-page-sources';

const RULE_ID = 'object-ui/no-unprefixed-query-params';

const linter = new Linter();

/**
 * A flat config carrying just this rule.
 *
 * `files` and the `.jsx` filename below are both required, and their absence is
 * SILENT: `Linter#verify` called without a filename that matches the config
 * returns `[]` — indistinguishable from a clean source. The control test is
 * what keeps that from passing unnoticed.
 */
const config = {
  files: ['**/*.jsx'],
  plugins: {
    'object-ui': { rules: { 'no-unprefixed-query-params': rule as unknown as Rule.RuleModule } },
  },
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  rules: { 'object-ui/no-unprefixed-query-params': 'error' },
} as unknown as Linter.Config;

/**
 * Lint one extracted page source. Every message is returned, INCLUDING a fatal
 * parse error: a source the parser choked on is a source the rule never
 * visited, and "the rule found nothing" must never be spelled the same way as
 * "the rule never ran".
 */
function lint(source: string, where: string): Linter.LintMessage[] {
  return linter.verify(source, config, `${where}.jsx`);
}

/** Every page in every harness, resolved once so `it.each` can name them. */
const pages = previewHarnessFiles.flatMap((file) =>
  pagesOf(readHarness(file), file).map((page) => ({ file, name: page.name, kind: page.kind, source: page.source })),
);

/** The canonical `$`-prefixed spellings, from the rule's own map. */
const canonicalSpellings = [...new Set(Object.values(QUERY_OPTION_SPELLINGS))];

/** The defect this gate exists for: the same source with the `$` taken off. */
function stripQueryOptionPrefixes(source: string): string {
  let mutated = source;
  for (const canonical of canonicalSpellings) {
    mutated = mutated.split(canonical).join(canonical.slice(1));
  }
  return mutated;
}

const mutablePages = pages.filter((page) => stripQueryOptionPrefixes(page.source) !== page.source);

describe('ADR-0080 preview harnesses — page-source query params', () => {
  // ---- the instrument, before anything is asserted with it ----------------
  it('the rule fires on an unprefixed query option in an extracted source (control)', () => {
    const dirty = lint("const rows = await adapter.find('showcase_project', { top: 200 });", 'control');
    expect(dirty.map((m) => m.ruleId)).toEqual([RULE_ID]);
    expect(dirty[0].messageId).toBe('unprefixedQueryOption');
    expect(dirty[0].message).toContain('`top` is not a `QueryParams` key — write `$top`');

    // …and is silent on the same call spelled correctly, so a green result
    // below means "clean", not "rule inert".
    const clean = lint("const rows = await adapter.find('showcase_project', { $top: 200 });", 'control');
    expect(clean).toEqual([]);
  });

  // ---- the enumeration ----------------------------------------------------
  it('every preview harness in apps/console/src is enumerated', () => {
    expect(previewHarnessFiles).toEqual(
      expect.arrayContaining([
        'record-header-preview.tsx',
        'row-actions-preview.tsx',
        'sdui-jsx-preview.tsx',
        'sdui-tiers-preview.tsx',
        'sdui-workbench-preview.tsx',
      ]),
    );
    // A glob that silently matches nothing is the failure mode here.
    expect(previewHarnessFiles.length).toBeGreaterThanOrEqual(5);
  });

  it('the harnesses yield page sources to check', () => {
    expect(pages.length).toBeGreaterThanOrEqual(4);
    expect(pages.map((p) => `${p.file}:${p.name}:${p.kind}`)).toEqual(
      expect.arrayContaining([
        'sdui-jsx-preview.tsx:command_center:html',
        'sdui-tiers-preview.tsx:release_notes:html',
        'sdui-tiers-preview.tsx:pipeline_react:react',
        'sdui-workbench-preview.tsx:crm_workbench:react',
      ]),
    );
  });

  it('the objectui#5458 fourth site is inside the extracted text, as a real call', () => {
    // The one site the ESLint rule structurally cannot see. If this call ever
    // stops being in the extracted source, the mutation test below stops
    // meaning anything and this assertion is the notice.
    const workbench = pages.filter((p) => p.file === 'sdui-workbench-preview.tsx');
    expect(workbench.map((p) => p.name)).toEqual(['crm_workbench']);
    expect(workbench[0].source).toContain("adapter.find('showcase_project', { $top: 200 })");
  });

  // ---- the assertion ------------------------------------------------------
  it.each(pages)(
    '$file — $name ($kind): no unprefixed query option in a find/findOne params object',
    ({ file, name, source }) => {
      const messages = lint(source, `${file}.${name}`);
      expect(
        messages.map((m) => `${m.fatal ? 'PARSE ERROR' : m.ruleId} L${m.line}:${m.column} ${m.message}`),
      ).toEqual([]);
    },
  );

  // ---- non-vacuity, over the real sources ---------------------------------
  it('at least one enumerated page really uses a query option', () => {
    // Without this, every mutation below is a no-op and the suite is a
    // tautology that would survive the harness losing its finder call.
    expect(mutablePages.map((p) => `${p.file}:${p.name}`)).toContain(
      'sdui-workbench-preview.tsx:crm_workbench',
    );
  });

  it.each(mutablePages)(
    '$file — $name: stripping the `$` off its query options turns this gate RED',
    ({ file, name, source }) => {
      const messages = lint(stripQueryOptionPrefixes(source), `${file}.${name}`);
      expect(messages.every((m) => !m.fatal)).toBe(true);
      expect(messages.map((m) => m.ruleId)).not.toEqual([]);
      expect(new Set(messages.map((m) => m.ruleId))).toEqual(new Set([RULE_ID]));
    },
  );
});
