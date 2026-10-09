// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#22161] The long-form rule explanations `os explain <rule-id>` prints. The
// module is published as its own entry and imports nothing (see its header),
// so the two facts it spells as literals — which rule each entry explains and
// the scan roots `field-no-consumers` reads — are held to the rules here.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { FUNCTIONAL_COMPLETENESS_RULES } from '@objectstack/spec/kernel';

import * as indexBarrel from './index.js';
import { RULE_EXPLANATIONS, explainRule } from './rule-explanations.js';
import { CARRIER_ROOTS, CONSUMER_ROOTS, FIELD_NO_CONSUMERS } from './validate-field-consumers.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Every rule id constant the root barrel exports, by value, plus the ids of the
 * functional-completeness predicate: those rules live in `@objectstack/spec/kernel`
 * and `validate-functional-completeness.ts` forwards their findings unchanged.
 */
function exportedRuleIds(): Set<string> {
  const ids = new Set<string>(FUNCTIONAL_COMPLETENESS_RULES);
  for (const [name, value] of Object.entries(indexBarrel)) {
    if (/^[A-Z][A-Z0-9_]*$/.test(name) && typeof value === 'string') ids.add(value);
  }
  return ids;
}

describe('rule explanations (#22161)', () => {
  it('every entry explains a rule id a rule file exports, under its own key', () => {
    const ids = exportedRuleIds();
    expect(Object.keys(RULE_EXPLANATIONS).length).toBeGreaterThan(0);
    for (const [key, entry] of Object.entries(RULE_EXPLANATIONS)) {
      expect(entry.rule, `entry under "${key}"`).toBe(key);
      expect(ids.has(key), `"${key}" is not an exported rule id constant`).toBe(true);
    }
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
