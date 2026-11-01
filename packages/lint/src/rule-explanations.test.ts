// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#22161] The long-form rule explanations `os explain <rule-id>` prints. The
// module is published as its own entry and imports nothing (see its header),
// so the two facts it spells as literals — which rule each entry explains and
// the scan roots `field-no-consumers` reads — are held to the rules here.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { UNCONSUMED_WIDGET_OPTION } from '@objectstack/sdui-parser';
import {
  CUSTOMIZATION_NAMESPACE_SUFFIX,
  FUNCTIONAL_COMPLETENESS_RULES,
  MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH,
} from '@objectstack/spec/kernel';

import * as indexBarrel from './index.js';
import { RULE_EXPLANATIONS, explainRule } from './rule-explanations.js';
import { CARRIER_ROOTS, CONSUMER_ROOTS, FIELD_NO_CONSUMERS } from './validate-field-consumers.js';
import { NAMESPACE_NO_CUSTOMIZATION_PAIR } from './validate-customization-namespace.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Every rule id constant the root barrel exports, by value, plus the ids of the
 * functional-completeness predicate: those rules live in `@objectstack/spec/kernel`
 * and `validate-functional-completeness.ts` forwards their findings unchanged.
 * The same holds for `@objectstack/sdui-parser`'s widget-option check, whose
 * code `validate-dashboard-widget-options.ts` forwards unchanged.
 */
function exportedRuleIds(): Set<string> {
  const ids = new Set<string>([...FUNCTIONAL_COMPLETENESS_RULES, UNCONSUMED_WIDGET_OPTION]);
  for (const [name, value] of Object.entries(indexBarrel)) {
    if (/^[A-Z][A-Z0-9_]*$/.test(name) && typeof value === 'string') ids.add(value);
  }
  return ids;
}

/**
 * The rule ids `@objectstack/cli` produces that this table explains. The CLI
 * depends on this package, so their constants cannot be imported here; the
 * CLI's `test/explain-rule-id.test.ts` fires each one from its producer and
 * holds it to its entry. Exact: a key that is neither one of these nor an
 * exported rule id fails below, and so does a listed id with no entry.
 */
const CLI_PRODUCED_RULE_IDS: readonly string[] = [
  'hook-body/not-lowerable',
  'hook-body/bundled-fallback',
  'hook-body/unparseable',
  'hook-body/extraction-failed',
  'docs/uncollected-directory',
  'docs/duplicate-name',
  'docs/nav-target',
  'docs/frontmatter-tags',
  'picklist-reference-unverified',
];

describe('rule explanations (#22161)', () => {
  it('every entry explains a rule id a rule file exports, under its own key', () => {
    const ids = exportedRuleIds();
    expect(Object.keys(RULE_EXPLANATIONS).length).toBeGreaterThan(0);
    for (const [key, entry] of Object.entries(RULE_EXPLANATIONS)) {
      expect(entry.rule, `entry under "${key}"`).toBe(key);
      if (CLI_PRODUCED_RULE_IDS.includes(key)) continue;
      expect(ids.has(key), `"${key}" is not an exported rule id constant`).toBe(true);
    }
  });

  it('the entries for CLI-produced ids are exactly the declared list, and none is a rule id here', () => {
    const ids = exportedRuleIds();
    const outside = Object.keys(RULE_EXPLANATIONS).filter((key) => !ids.has(key));
    expect([...outside].sort()).toEqual([...CLI_PRODUCED_RULE_IDS].sort());
    expect(CLI_PRODUCED_RULE_IDS.filter((id) => ids.has(id))).toEqual([]);
  });

  it('each entry completes the rule-line pointer and carries real text', () => {
    for (const entry of Object.values(RULE_EXPLANATIONS)) {
      // `covers` finishes "`os explain <id>` for …" on one terminal line.
      expect(entry.covers.length).toBeGreaterThan(0);
      expect(entry.covers.length).toBeLessThanOrEqual(60);
      expect(entry.covers).not.toMatch(/[.\n]/);
      expect(entry.paragraphs.length).toBeGreaterThan(0);
      for (const p of entry.paragraphs) {
        expect(p.trim().length).toBeGreaterThan(0);
        expect(p).not.toContain('\n');
        // An author is shown this text: the lesson goes in, a tracker number does not.
        expect(p).not.toMatch(/#\d+/);
      }
    }
  });

  it('the field-no-consumers roots paragraph lists exactly the roots the rule scans', () => {
    const text = explainRule(FIELD_NO_CONSUMERS)!.paragraphs.join('\n');
    expect(text).toContain(
      `Roots scanned: ${CONSUMER_ROOTS.join(', ')} (consumers) · ${CARRIER_ROOTS.join(', ')} (carriers).`,
    );
  });

  // [#28473] The module imports nothing, so the pairing rule's numbers and
  // suffix are written out in the text; held here to the spec constants.
  it('the namespace-no-customization-pair text states the pairing rule\'s own limit and suffix', () => {
    const text = explainRule(NAMESPACE_NO_CUSTOMIZATION_PAIR)!.paragraphs.join('\n');
    const suffix = CUSTOMIZATION_NAMESPACE_SUFFIX;
    const max = MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH;
    expect(text).toContain(
      `A manifest namespace is at most ${max + suffix.length} characters and \`${suffix}\` takes ${suffix.length}, ` +
        `so a namespace of ${max + 1} characters or more has no pair namespace`,
    );
    expect(text).toContain(`to ${max} characters or fewer`);
  });

  it('explainRule is an exact-id lookup: no prefix, case or prototype match', () => {
    expect(explainRule(FIELD_NO_CONSUMERS)?.rule).toBe(FIELD_NO_CONSUMERS);
    expect(explainRule('field-no-consumer')).toBeUndefined();
    expect(explainRule('FIELD-NO-CONSUMERS')).toBeUndefined();
    expect(explainRule('toString')).toBeUndefined();
    expect(explainRule('__proto__')).toBeUndefined();
  });

  it('the root barrel re-exports the same table', () => {
    expect(indexBarrel.RULE_EXPLANATIONS).toBe(RULE_EXPLANATIONS);
    expect(indexBarrel.explainRule).toBe(explainRule);
  });

  it('the module imports nothing, so its published entry stays free of the rule engine', () => {
    const source = readFileSync(join(HERE, 'rule-explanations.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/^\s*export\s[^\n]*\sfrom\s/m);
  });
});
