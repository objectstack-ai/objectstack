// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A formula whose `label()` names a field that declares no options is refused
 * by every face of the `expression-invalid` gate (#28659).
 *
 * ## The state this closes
 *
 * `label(record.<field>)` (#26608) answers on a field whose definition carries
 * an `options` list; the engine builds its label map from exactly those fields
 * (`declaresOptions`, `@objectstack/formula`). Pointed at any other field the
 * evaluator faults on every row, so the formula reads null forever and a WARN
 * line is the only trace. The object save door refused `label(record.nope)`
 * (unknown field) and `sqrt(4)` (unregistered function), but admitted
 * `label(record.first)` on a text field with a 200. The formula pass now hands
 * the shared validator the object's option-bearing fields, so `os validate`,
 * `os build`, `os lint` and the runtime gate the object write path runs (the
 * save door, and the draft publish verdict through the same evaluation) give
 * the same refusal, in the evaluator's own words.
 *
 * ## What is pinned
 *
 * The card's body and its compound variant are refused at every command and
 * at the door, located at the formula field's `expression`. Controls: `label()`
 * on a select and on a radio that declare options, and on a select bound to a
 * shared `picklist` (authored with no `options`), publishes clean, and the
 * unknown-field and unregistered-function refusals are unchanged. Each
 * refusal asserts the rule, the location and the named field, not the prose.
 */
import { describe, expect, it } from 'vitest';
import { AUTHORING_COMMANDS, EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

/** The card's object, with `pf`'s expression swapped in. */
const p4 = (expression: string) => ({
  name: 'qaformula_p4',
  label: 'P4',
  // Keeps `security-owd-unset` quiet, so a refusal is the expression rule's.
  sharingModel: 'private',
  fields: {
    first: { type: 'text', label: 'First' },
    kind: { type: 'select', label: 'Kind', options: [{ value: 'clean', label: 'Clean' }] },
    stage: { type: 'radio', label: 'Stage', options: [{ value: 'draft', label: 'Draft' }] },
    // Bound to a shared picklist: authored with no `options`, served with the
    // list's options written on (objectql's picklist resolution).
    tier: { type: 'select', label: 'Tier', picklist: 'qa_tiers' },
    pf: { type: 'formula', label: 'PF', expression },
  },
});

const WHERE = "object 'qaformula_p4' · field 'pf' expression";

const expressionFindings = <T extends { rule: string }>(fs: readonly T[]): T[] =>
  fs.filter((f) => f.rule === EXPRESSION_INVALID);

/** The shared list `tier` names, so the stack is the one an author would build. */
const QA_TIERS = { name: 'qa_tiers', label: 'Tiers', options: [{ value: 'gold', label: 'Gold' }] };

const atCommand = (command: (typeof AUTHORING_COMMANDS)[number], item: unknown) => {
  const stack = { objects: [item], picklists: [QA_TIERS] };
  return expressionFindings(runAuthoringRules(command, { normalized: stack, parsed: stack }));
};

const atDoor = (item: unknown) => runRuntimeAuthoringRules({ type: 'object', item, context: { objects: [] } });

const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('label() on a field that declares no options is refused at every face of the gate (#28659)', () => {
  for (const expression of ['label(record.first)', 'label(record.kind) + label(record.first)']) {
    for (const command of AUTHORING_COMMANDS) {
      it(`⭐ LIT — \`os ${command}\` refuses \`${expression}\`, naming \`first\``, () => {
        const found = atCommand(command, p4(expression));
        expect(found, dump(found)).toHaveLength(1);
        expect(found[0]).toMatchObject({ severity: 'error', where: WHERE });
        expect(found[0]!.message).toContain('label(record.first): `first` declares no options');
      });
    }

    it(`⭐ LIT — the object door refuses \`${expression}\`, naming \`first\``, () => {
      const door = atDoor(p4(expression));
      expect(door.rulesRun).toContain('validateStackExpressions');
      const errs = expressionFindings(door.errors);
      expect(errs, dump(door)).toHaveLength(1);
      expect(errs[0]).toMatchObject({ severity: 'error', where: WHERE });
      expect(errs[0]!.message).toContain('label(record.first): `first` declares no options');
    });
  }

  for (const expression of [
    'label(record.kind)',
    "label(record.kind) + ' · ' + label(record.stage)",
    "record.first + label(record.kind)",
    // A picklist-bound select names its list instead of declaring `options`.
    'label(record.tier)',
    "label(record.tier) + ' / ' + label(record.kind)",
  ]) {
    it(`CONTROL — \`${expression}\` (option-bearing fields) publishes clean at every command and at the door`, () => {
      for (const command of AUTHORING_COMMANDS) expect(atCommand(command, p4(expression))).toEqual([]);
      const door = atDoor(p4(expression));
      expect(door.rulesRun).toContain('validateStackExpressions');
      expect(expressionFindings(door.errors), dump(door)).toEqual([]);
      expect(expressionFindings(door.advisories), dump(door)).toEqual([]);
    });
  }

  it('CONTROL — an unknown field and an unregistered function keep their refusals, and nothing else', () => {
    for (const [expression, subject] of [
      ['label(record.nope)', 'unknown field `nope`'],
      ['sqrt(4)', 'sqrt'],
    ] as const) {
      const door = atDoor(p4(expression));
      const errs = expressionFindings(door.errors);
      expect(errs, dump(door)).toHaveLength(1);
      expect(errs[0]!.message).toContain(subject);
      expect(errs[0]!.message).not.toContain('declares no options');
    }
  });
});
