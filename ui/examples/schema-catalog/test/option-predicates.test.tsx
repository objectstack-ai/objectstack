/**
 * Catalog-wide guardrail for cascading `select` option predicates (#1583).
 *
 * Every shipped example is a reference authors copy-paste (and AI few-shot
 * retrieves), so a wrong option `visibleWhen` here silently teaches the mistake.
 * We walk every `fields` array in every example and run the canonical
 * `lintOptionPredicates` guardrail (`@object-ui/core`): a per-option predicate
 * that references an unknown sibling, compares against a literal outside the
 * controlling enum's value domain (`record.country == 'chna'`), or doesn't parse
 * as CEL fails the catalog. Fields without option predicates contribute nothing.
 */
import { describe, it, expect } from 'vitest';
import { lintOptionPredicates, type LintFieldLike, type OptionLintIssue } from '@object-ui/core';
import { allExamples } from '../src/index.js';

/** Collect every `fields: [...]` array anywhere in a schema tree. */
function collectFieldGroups(node: unknown, out: LintFieldLike[][] = []): LintFieldLike[][] {
  if (Array.isArray(node)) {
    for (const item of node) collectFieldGroups(item, out);
    return out;
  }
  if (node && typeof node === 'object') {
    const rec = node as Record<string, unknown>;
    if (Array.isArray(rec.fields)) out.push(rec.fields as LintFieldLike[]);
    for (const value of Object.values(rec)) collectFieldGroups(value, out);
  }
  return out;
}

function lintExample(schema: unknown): OptionLintIssue[] {
  return collectFieldGroups(schema).flatMap((fields) => lintOptionPredicates(fields));
}

describe('schema-catalog — option predicate guardrail (#1583)', () => {
  it.each(allExamples().map((e) => [e.id, e] as const))(
    '%s has no faulty option predicates',
    (_id, example) => {
      const issues = lintExample(example.schema);
      expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
    },
  );

  it('actually exercises the cascading-options example (guardrail is not vacuous)', () => {
    // The canonical cascade must be present AND clean — proves the linter runs on
    // real per-option `visibleWhen` content, not just field-less schemas.
    const cascade = allExamples().find((e) => e.id === 'fields-select/cascading-options');
    expect(cascade, 'fields-select/cascading-options example is missing').toBeTruthy();
    const groups = collectFieldGroups(cascade!.schema);
    const hasOptionPredicate = groups.some((fields) =>
      fields.some((f) => f.options?.some((o) => o?.visibleWhen != null)),
    );
    expect(hasOptionPredicate, 'expected the cascade example to carry option visibleWhen').toBe(true);
    expect(lintExample(cascade!.schema)).toEqual([]);
  });
});
