// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An undeclared field is refused at BOTH doors in every member spelling, at
 * every record-scoped slot an object carries — not only when it is written
 * with a dot.
 *
 * ## The state this closes
 *
 * `@objectstack/formula`'s field-existence pass read `record.<field>` /
 * `previous.<field>` with a dot-only regex. `record['zz_typo']`,
 * `previous['zz_typo']`, `record.?zz_typo` and `record[?'zz_typo']` named the
 * same column and reached the evaluator with no authoring verdict, so
 * `os build` and the object save door both published them clean. The pass now
 * reads members through the formula package's AST member reader — the one the
 * relationship-traversal analysis is folded from — so there is no lint-side
 * arm here: the slot walk is unchanged, and the build and the door give the
 * shared validator's verdict exactly as they give it for the dot.
 *
 * ## What is pinned
 *
 * Three slots (a select option's `visibleWhen`, a field's `requiredWhen`, a
 * validation rule's `condition`) × six spellings, at the build's rule table and
 * at the runtime gate the object write path runs. The control: every spelling
 * of a DECLARED field publishes clean at both doors.
 *
 * Each refusal asserts the named subject (`unknown field \`zz_typo\``), the
 * location the author edits, and the severity — not the prose around them.
 */
import { describe, expect, it } from 'vitest';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

type Slot = 'option visibleWhen' | 'requiredWhen' | 'validation condition';

/** The probe object with `expression` on one record-scoped slot. */
const fxObject = (slot: Slot, expression: string) => ({
  name: 'fx_probe',
  label: 'Probe',
  // Keeps `security-owd-unset` quiet, so a refusal is the expression rule's.
  sharingModel: 'private',
  fields: {
    name: {
      type: 'text',
      label: 'Name',
      ...(slot === 'requiredWhen' ? { requiredWhen: expression } : {}),
    },
    status: { type: 'text', label: 'Status' },
    tier: {
      type: 'select',
      label: 'Tier',
      options: [
        { label: 'Standard', value: 'standard' },
        { label: 'Gold', value: 'gold', ...(slot === 'option visibleWhen' ? { visibleWhen: expression } : {}) },
      ],
    },
  },
  ...(slot === 'validation condition'
    ? { validations: [{ name: 'probe_rule', type: 'script', condition: expression, message: 'Probe.', severity: 'error' }] }
    : {}),
});

const WHERE: Readonly<Record<Slot, string>> = {
  'option visibleWhen': "object 'fx_probe' · field 'tier' option 'gold' visibleWhen",
  requiredWhen: "object 'fx_probe' · field 'name' requiredWhen",
  'validation condition': "object 'fx_probe' · validation 'probe_rule'",
};

const SLOTS = Object.keys(WHERE) as Slot[];

/** Every member spelling that names `f`; the dot row is the one that was already refused. */
const spellings = (f: string): readonly string[] => [
  `record.${f} == 'a'`,
  `record['${f}'] == 'a'`,
  `previous['${f}'] == 'a'`,
  `record.?${f}.orValue('') == 'a'`,
  `record[?'${f}'].orValue('') == 'a'`,
  `has(record.${f})`,
];

const expressionFindings = <T extends { rule: string }>(fs: readonly T[]): T[] =>
  fs.filter((f) => f.rule === EXPRESSION_INVALID);

const atBuild = (item: unknown) => {
  const stack = { objects: [item] };
  return expressionFindings(runAuthoringRules('build', { normalized: stack, parsed: stack }));
};

const atDoor = (item: unknown) => runRuntimeAuthoringRules({ type: 'object', item, context: { objects: [] } });

const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('an undeclared field is refused in every member spelling, at both doors', () => {
  for (const slot of SLOTS) {
    for (const expression of spellings('zz_typo')) {
      it(`⭐ LIT — ${slot}: \`${expression}\` is refused by \`os build\` and by the object door`, () => {
        const build = atBuild(fxObject(slot, expression));
        expect(build, dump(build)).toHaveLength(1);
        expect(build[0]).toMatchObject({ severity: 'error', where: WHERE[slot] });
        expect(build[0]!.message).toContain('unknown field `zz_typo`');

        const door = atDoor(fxObject(slot, expression));
        expect(door.rulesRun).toContain('validateStackExpressions');
        const errs = expressionFindings(door.errors);
        expect(errs, dump(door)).toHaveLength(1);
        expect(errs[0]).toMatchObject({ severity: 'error', where: WHERE[slot], path: WHERE[slot] });
        expect(errs[0]!.message).toContain('unknown field `zz_typo`');
      });
    }

    for (const expression of spellings('status')) {
      it(`⭐ CONTROL — ${slot}: \`${expression}\` on a declared field publishes clean at both doors`, () => {
        expect(atBuild(fxObject(slot, expression))).toEqual([]);

        const door = atDoor(fxObject(slot, expression));
        expect(door.rulesRun).toContain('validateStackExpressions');
        expect(expressionFindings(door.errors), dump(door)).toEqual([]);
        expect(expressionFindings(door.advisories), dump(door)).toEqual([]);
      });
    }
  }
});
