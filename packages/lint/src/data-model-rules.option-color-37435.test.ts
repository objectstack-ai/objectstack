// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `field/option-color-renders-neutral`: a select option `color` the option
// badge does not paint (outside the nine palette families and the `#rgb` /
// `#rrggbb` hex) is warned at author time and at the save door, instead of
// rendering neutral grey with no signal. A declared family name and a hex are
// not warned. Advisory only: nothing is refused.

import { describe, expect, it } from 'vitest';

import { authoringRulesFor } from './authoring-rules.js';
import {
  FIELD_OPTION_COLOR_RENDERS_NEUTRAL,
  OPTION_COLOR_FAMILIES,
  isBadgePaintableOptionColor,
  lintOptionColors,
} from './data-model-rules.js';
import * as indexBarrel from './index.js';
import { explainRule } from './rule-explanations.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';

const stageField = (colors: readonly (string | undefined)[]) => ({
  type: 'select',
  options: colors.map((color, i) => ({ label: `S${i}`, value: `s${i}`, ...(color === undefined ? {} : { color }) })),
});

const objectWith = (colors: readonly (string | undefined)[]) => [
  { name: 'acme_deal', fields: { stage: stageField(colors) } },
];

const hits = (colors: readonly (string | undefined)[]) =>
  lintOptionColors(objectWith(colors)).filter((i) => i.rule === FIELD_OPTION_COLOR_RENDERS_NEUTRAL);

describe('field/option-color-renders-neutral', () => {
  it('is published from the root barrel under its constant, with an `os explain` entry', () => {
    expect(FIELD_OPTION_COLOR_RENDERS_NEUTRAL).toBe('field/option-color-renders-neutral');
    expect(indexBarrel.FIELD_OPTION_COLOR_RENDERS_NEUTRAL).toBe(FIELD_OPTION_COLOR_RENDERS_NEUTRAL);
    expect(explainRule(FIELD_OPTION_COLOR_RENDERS_NEUTRAL)?.rule).toBe(FIELD_OPTION_COLOR_RENDERS_NEUTRAL);
  });

  it('an out-of-family colour name is warned, located at the option, and the fix names the families', () => {
    const found = hits(['teal']);
    expect(found).toHaveLength(1);
    const [issue] = found;
    expect(issue).toMatchObject({
      severity: 'warning',
      rule: FIELD_OPTION_COLOR_RENDERS_NEUTRAL,
      path: 'objects[0].fields.stage.options[0].color',
      where: `object "acme_deal" · field 'stage' · option 's0'`,
    });
    expect(issue!.message).toContain("color: 'teal'");
    for (const family of OPTION_COLOR_FAMILIES) expect(issue!.fix).toContain(family);
  });

  it('a declared family name is not warned, nor is a #rgb / #rrggbb hex', () => {
    expect(OPTION_COLOR_FAMILIES).toHaveLength(9);
    expect(hits([...OPTION_COLOR_FAMILIES])).toEqual([]);
    expect(hits(['#14b8a6', '#ABC', '#14B8A6'])).toEqual([]);
  });

  it('an option with no colour, or an empty one, declares nothing and is not judged', () => {
    expect(hits([undefined, '', '  '])).toEqual([]);
  });

  it('every spelling the badge renders neutral is warned, each with the fix its value points at', () => {
    const fixOf = (color: string) => hits([color])[0]?.fix;
    expect(fixOf('Red')).toBe("Write the family in lowercase: color: 'red'.");
    expect(fixOf('14b8a6')).toBe("Write the hex with a leading #: color: '#14b8a6'.");
    expect(fixOf('#14b8a6cc')).toContain("color: '#14b8a6'");
    for (const color of ['amber', 'rgb(20, 184, 166)', 'hsl(173 80% 40%)', ' #14b8a6', '#14b8a']) {
      expect(isBadgePaintableOptionColor(color), color).toBe(false);
      expect(hits([color]), color).toHaveLength(1);
    }
  });

  it('judges object-extension fields and picklists where they are written', () => {
    const issues = lintOptionColors(
      [],
      [{ target: 'acme_deal', path: 'objectExtensions[0]', fields: [{ name: 'tier', ...stageField(['amber']) }] }],
      [{ name: 'deal_stage', path: 'picklists[0]', where: 'picklist "deal_stage"', options: [{ label: 'A', value: 'a', color: 'teal' }, { label: 'B', value: 'b', color: 'blue' }] }],
    );
    expect(issues.map((i) => i.path)).toEqual([
      'objectExtensions[0].fields.tier.options[0].color',
      'picklists[0].options[0].color',
    ]);
  });

  it('runs on all three commands, picklists included, from the registry', () => {
    for (const command of ['validate', 'build', 'lint'] as const) {
      expect(authoringRulesFor(command).map((r) => r.name), command).toContain('lintOptionColors');
    }
    const entry = authoringRulesFor('validate').find((r) => r.name === 'lintOptionColors')!;
    const findings = entry.run(
      {
        objects: objectWith(['teal']),
        picklists: [{ name: 'deal_stage', label: 'Stage', options: [{ label: 'A', value: 'a', color: 'amber' }] }],
        picklistExtensions: [{ extend: 'deal_stage', options: [{ label: 'C', value: 'c', color: 'Red' }] }],
      },
      {},
    );
    expect(findings.map((f) => [f.severity, f.path])).toEqual([
      ['warning', 'objects[0].fields.stage.options[0].color'],
      ['warning', 'picklists[0].options[0].color'],
      ['warning', 'picklistExtensions[0].options[0].color'],
    ]);
  });

  describe('at the save door (object writes)', () => {
    const write = (color: string) => ({
      name: 'acme_deal',
      label: 'Deal',
      sharingModel: 'private',
      fields: { stage: stageField([color]) },
    });

    it('an out-of-family colour name rides back as an advisory and refuses nothing', () => {
      expect(runtimeAuthoringRulesFor('object').map((r) => r.name)).toContain('lintOptionColors');
      const result = runRuntimeAuthoringRules({ type: 'object', item: write('teal'), context: { objects: [] } });
      expect(result.errors).toEqual([]);
      const advisories = result.advisories.filter((f) => f.rule === FIELD_OPTION_COLOR_RENDERS_NEUTRAL);
      expect(advisories).toHaveLength(1);
      expect(advisories[0]).toMatchObject({ severity: 'warning' });
      expect(advisories[0]!.hint.length).toBeGreaterThan(0);
    });

    it('a declared family name and a hex ride back with no advisory', () => {
      for (const color of ['red', '#14b8a6']) {
        const result = runRuntimeAuthoringRules({ type: 'object', item: write(color), context: { objects: [] } });
        expect(result.advisories.filter((f) => f.rule === FIELD_OPTION_COLOR_RENDERS_NEUTRAL), color).toEqual([]);
      }
    });
  });
});
