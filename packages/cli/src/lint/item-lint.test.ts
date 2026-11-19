// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34777] `lintItem` — the classification `os lint --item` runs: a rule-table
 * entry that read only the item's own collection judges the item and its
 * findings are reported; one that read any other stack key is named, with the
 * keys it read, and its findings are dropped.
 *
 * Measured on two real table entries, chosen for what they read, not for a
 * hand-kept list: `validateTitleFormatRetired` reads `objects` and nothing else
 * (its body opens and closes on `recordsOf(stack.objects)`), and
 * `validateStackExpressions` walks every authored-expression collection. The
 * same object carries a finding for each, so one run shows both halves.
 */

import { describe, it, expect } from 'vitest';
import { authoringRulesFor } from '@objectstack/lint';
import { lintItem, resolveItemType, itemLintTypes } from './item-lint.js';

/** An object carrying a retired `titleFormat` and a formula that does not parse. */
const OBJECT = {
  name: 'invoice',
  label: 'Invoice',
  sharingModel: 'private',
  titleFormat: '{title}',
  fields: {
    title: { type: 'text', label: 'Title' },
    total: { type: 'formula', label: 'Total', expression: '1 +' },
  },
};

describe('[#34777] resolveItemType', () => {
  it('takes a singular type or its collection plural, and places it under the stack key', () => {
    expect(resolveItemType('view')).toEqual({ ok: true, type: 'view', stackKey: 'views' });
    expect(resolveItemType('views')).toEqual({ ok: true, type: 'view', stackKey: 'views' });
    expect(resolveItemType('email_template')).toEqual({ ok: true, type: 'email_template', stackKey: 'emailTemplates' });
  });

  it('refuses a type with no stack collection, naming every type it takes', () => {
    const refused = resolveItemType('widget');
    expect(refused.ok).toBe(false);
    const message = (refused as { message: string }).message;
    expect(message).toContain("'widget'");
    for (const type of itemLintTypes()) expect(message).toContain(type);
  });
});

describe('[#34777] lintItem — what a rule reads decides whether it judged the item', () => {
  it('reports the finding of an entry that read only `objects`, and names the entry that read more', () => {
    const result = lintItem(OBJECT, 'object', 'objects');

    expect(result.judged).toContain('validateTitleFormatRetired');
    expect(result.findings.map((f) => f.rule)).toContain('title-format-retired');

    const expressions = result.notJudged.find((n) => n.rule === 'validateStackExpressions');
    expect(expressions).toBeDefined();
    expect(expressions!.reads).toContain('objects');
    expect(expressions!.reads.some((key) => key !== 'objects')).toBe(true);
    // Its finding on this item is not reported: the verdict needs the rest.
    expect(result.findings.map((f) => f.rule)).not.toContain('expression-invalid');
  });

  it('POSITIVE CONTROL: the dropped entry does find the formula when run on the same stack', () => {
    const result = lintItem(OBJECT, 'object', 'objects');
    const entry = authoringRulesFor('lint').find((r) => r.name === 'validateStackExpressions')!;
    expect(entry.run(result.stack, {}).length).toBeGreaterThan(0);
  });

  it('classifies every entry at most once, in table order, and never an entry that did not read the item', () => {
    const result = lintItem(OBJECT, 'object', 'objects');
    const order = authoringRulesFor('lint').map((r) => r.name);
    const named = [...result.judged, ...result.notJudged.map((n) => n.rule)];
    expect(new Set(named).size).toBe(named.length);
    expect(result.judged).toEqual(order.filter((name) => result.judged.includes(name)));
    // A flow-only entry never reads `objects` on an object item.
    expect(named).not.toContain('validateFlowRegionShape');
  });

  it('names `os lint`\'s own families that judge the package or the stack', () => {
    expect(lintItem(OBJECT, 'object', 'objects').familiesNotRun.map((f) => f.family)).toEqual([
      'naming/namespace-prefix',
      'i18n coverage',
      'data-model best practices',
    ]);
    expect(lintItem({ name: 'v', label: 'V' }, 'view', 'views').familiesNotRun.map((f) => f.family)).toEqual([
      'naming/namespace-prefix',
      'i18n coverage',
    ]);
  });
});
