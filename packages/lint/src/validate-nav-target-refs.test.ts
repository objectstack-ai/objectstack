// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tests for the non-object nav-target rule (ADR-0072).
 *
 * Two of these are the load-bearing ones:
 *
 * 1. The **empty-collection** case. That is the whole reason this rule exists:
 *    `defineStack`'s own check is gated on `pageNames.size > 0`, so a stack with
 *    no `pages` has its page-nav validation switched off. If someone "optimises"
 *    this rule by skipping stacks with no pages, that test goes red.
 * 2. The **deliberate NON-members** (`component`, `action`). Each was verified,
 *    not assumed — `component` renders a named "Component not registered"
 *    diagnostic rather than failing silently, and `action` is already owned by
 *    `validate-action-name-refs`. Flagging either would be a false prescription
 *    or a duplicate report, and these tests are where that attempt fails first.
 */

import { describe, expect, it } from 'vitest';

import {
  validateNavTargetRefs as validateNavTargetRefsUnrecorded,
  NAV_TARGET_UNRESOLVED,
} from './validate-nav-target-refs.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is `os explain nav-target-unresolved`. Every direct call below records
// what it fired, and the last cases in this file hold each recorded verdict to
// one line of at most 200 characters — every firing variant this suite
// exercises, not a chosen few. Run the whole file: those cases read what the
// cases above fired.
const fired: Array<{ rule: string; message: string }> = [];
const validateNavTargetRefs: typeof validateNavTargetRefsUnrecorded = (...args) => {
  const findings = validateNavTargetRefsUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

const app = (items: unknown[]) => ({ apps: [{ name: 'ops', navigation: items }] });

describe('validateNavTargetRefs — the gap defineStack leaves', () => {
  it('flags a page target when the stack declares NO pages (the size>0 hole)', () => {
    const [f] = validateNavTargetRefs(app([{ id: 'n1', type: 'page', pageName: 'missing_page' }]));
    expect(f.rule).toBe(NAV_TARGET_UNRESOLVED);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe('apps[0].navigation[0].pageName');
    expect(f.where).toBe('app "ops" · nav "n1"');
    // The message must say WHY nothing else caught it, or the author has no
    // way to know this rule is the only thing speaking. [#22161] The guard it
    // names (`pageNames.size > 0`) is `os explain nav-target-unresolved`'s.
    expect(f.message).toContain('NO pages at all');
    expect(f.message).toContain('`defineStack` skipped the entry');
    expect(explainRule(NAV_TARGET_UNRESOLVED)!.paragraphs.join('\n')).toContain('`pageNames.size > 0`');
  });

  it('flags a page target when pages exist but the name is wrong', () => {
    const findings = validateNavTargetRefs({
      ...app([{ id: 'n1', type: 'page', pageName: 'typo' }]),
      pages: [{ name: 'real_page' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).not.toContain('NO pages at all');
  });

  it('is silent when the target resolves', () => {
    expect(validateNavTargetRefs({
      ...app([{ id: 'n1', type: 'page', pageName: 'real_page' }]),
      pages: [{ name: 'real_page' }],
    })).toEqual([]);
  });

  it.each([
    ['report', 'reportName', 'reports'],
    ['dashboard', 'dashboardName', 'dashboards'],
  ])('covers %s targets too', (type, prop, collection) => {
    expect(validateNavTargetRefs(app([{ id: 'x', type, [prop]: 'nope' }]))).toHaveLength(1);
    expect(validateNavTargetRefs({
      ...app([{ id: 'x', type, [prop]: 'ok' }]),
      [collection]: [{ name: 'ok' }],
    })).toEqual([]);
  });

  it('walks nested children — an `object` item carries them too, not just a group', () => {
    const findings = validateNavTargetRefs(app([
      { id: 'grp', type: 'object', objectName: 'task', children: [
        { id: 'deep', type: 'page', pageName: 'missing' },
      ] },
    ]));
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('apps[0].navigation[0].children[0].pageName');
  });

  it('walks the `areas[]` container, not just `navigation`', () => {
    const findings = validateNavTargetRefs({
      apps: [{ name: 'ops', areas: [{ name: 'a', items: [{ id: 'n', type: 'page', pageName: 'missing' }] }] }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('apps[0].areas[0].items[0].pageName');
  });

  it('skips interpolated targets — they resolve at render time (ADR-0072 D1)', () => {
    expect(validateNavTargetRefs(app([
      { id: 'n', type: 'page', pageName: '${ctx.page}' },
      { id: 'm', type: 'page', pageName: '{dynamic}' },
    ]))).toEqual([]);
  });
});

describe('the deliberate NON-members — each verified, not assumed', () => {
  it('does NOT flag `component` — an unregistered ref is reported loudly at runtime', () => {
    // ComponentNavView renders "Component not registered … Ensure the plugin
    // that provides this surface is installed and has called
    // registerAppComponent()". The registry exists so plugin surfaces MAY be
    // absent; flagging this would break valid plugin nav and duplicate a
    // better runtime message.
    expect(validateNavTargetRefs(app([
      { id: 'n', type: 'component', componentRef: 'nobody:nothing' },
    ]))).toEqual([]);
  });

  it('does NOT flag `action` — validate-action-name-refs already walks app nav', () => {
    expect(validateNavTargetRefs(app([
      { id: 'n', type: 'action', actionDef: { actionName: 'ghost_action' } },
    ]))).toEqual([]);
  });

  it('does NOT flag `url` — external by definition', () => {
    expect(validateNavTargetRefs(app([
      { id: 'n', type: 'url', url: 'https://example.com' },
    ]))).toEqual([]);
  });
});

describe('robustness', () => {
  it('never throws on junk or partial stacks', () => {
    for (const junk of [
      undefined, null, 42, 'x', [], {},
      { apps: 'nope' }, { apps: [null, 7] },
      { apps: [{ name: 'a', navigation: 'nope' }] },
      { apps: [{ navigation: [null, 3, { type: 'page' }] }] },
      { apps: [{ name: 'a', areas: 'nope' }] },
      app([{ type: 'page' }]), // no pageName at all
    ]) {
      expect(() => validateNavTargetRefs(junk)).not.toThrow();
    }
  });

  it('emits nothing for a stack with no apps', () => {
    expect(validateNavTargetRefs({ pages: [{ name: 'p' }] })).toEqual([]);
  });

  it('every finding carries a usable hint', () => {
    for (const f of validateNavTargetRefs(app([{ id: 'n', type: 'page', pageName: 'x' }]))) {
      expect(f.hint.length).toBeGreaterThan(20);
    }
  });
});

describe('[#22161] one-line verdicts — nav-target-unresolved', () => {
  it('reads as one sentence per arm', () => {
    const empty = validateNavTargetRefs(app([{ id: 'n1', type: 'dashboard', dashboardName: 'nope' }]));
    const declared = validateNavTargetRefs({
      ...app([{ id: 'n1', type: 'page', pageName: 'typo' }]),
      pages: [{ name: 'real_page' }],
    });
    expect([...empty, ...declared].map((f) => f.message)).toEqual([
      "Navigation targets dashboard 'nope', which `dashboards` does not declare (there are NO dashboards at all, "
        + 'so `defineStack` skipped the entry), so the entry resolves to nothing when clicked',
      "Navigation targets page 'typo', which `pages` does not declare, so the entry resolves to nothing when "
        + 'clicked',
    ]);
  });

  it('`os explain` carries what the verdict no longer says', () => {
    const entry = explainRule(NAV_TARGET_UNRESOLVED);
    expect(entry, 'no `os explain nav-target-unresolved` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    for (const fact of [
      '`pageNames.size > 0`, `reportNames.size > 0`, `dashboardNames.size > 0`',
      'refuses the name first',
      'no such registry exists for pages, reports or dashboards',
      'If another package provides the target',
      'interpolated target',
      '`action-name-undefined` owns it',
      'named diagnostic',
      'external by definition',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });

  it('the entry types and collections the explanation names are the ones the rule resolves', () => {
    // The explanation module imports nothing, so its list is held to the rule
    // by running the rule on each type it names.
    const text = explainRule(NAV_TARGET_UNRESOLVED)!.paragraphs.join('\n');
    for (const [type, prop, collection] of [
      ['page', 'pageName', 'pages'],
      ['report', 'reportName', 'reports'],
      ['dashboard', 'dashboardName', 'dashboards'],
    ]) {
      for (const named of [type, prop, collection]) expect(text, named).toContain(`\`${named}\``);
      expect(validateNavTargetRefsUnrecorded(app([{ id: 'x', type, [prop]: 'nope' }])), type)
        .toHaveLength(1);
    }
  });

  it('every verdict the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === NAV_TARGET_UNRESOLVED);
    // The coverage control first: all three target types fired, with and
    // without the empty-collection clause.
    for (const noun of ['page', 'report', 'dashboard']) {
      expect(converted.some((f) => f.message.startsWith(`Navigation targets ${noun} `)), noun).toBe(true);
    }
    expect(converted.some((f) => f.message.includes('at all'))).toBe(true);
    expect(converted.some((f) => !f.message.includes('at all'))).toBe(true);
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });
});
