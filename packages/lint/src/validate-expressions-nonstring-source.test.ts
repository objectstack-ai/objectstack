/**
 * #15663, downstream half — the caller's LOCATION survives to the author.
 *
 * The entry-side pin lives in `@objectstack/formula`
 * (`validate-nonstring-source.test.ts`) and says the refusal arrives on the
 * `errors[]` channel. That alone is not the acceptance test. What made this a
 * p2 rather than a cosmetic crash is that a raw `TypeError` escaping from
 * inside `validateExpression` bypassed the whole located-reporting contract:
 * this walk exists to attribute every finding to the hook / sharing rule /
 * action / field it came from, and an exception thrown out of the shared
 * validator took the entire run down instead, naming none of them.
 *
 * ## The population pinned here is the one the adjacent cards did NOT close
 *
 * #15572 refuses a non-string in the LEDGER-DECLARED predicate slots and #15662
 * refuses one in the STRUCTURAL condition slots (`config.condition`,
 * `edge.condition`), both before `validateExpression` is reached — so on those
 * slots the crash was already unreachable when this card was picked up
 * (measured, not assumed: the card's own driven `registerFlow` repro no longer
 * reproduces). Every OTHER slot this walk visits still arrives at the shared
 * entry with whatever the metadata holds, and had no guard at all. Hooks and
 * sharing rules are two of them, and they are what these pins drive.
 */
import { describe, it, expect } from 'vitest';

import { validateStackExpressions } from './validate-expressions';

const REFUSAL = 'an expression envelope carries its expression as a string `source`';

/** The card's own value, plus the rest of the non-string population. */
const NON_STRING_SOURCES: Array<[label: string, value: unknown]> = [
  ['a nested object', { source: { nested: 1 } }],
  ['a number', { source: 1 }],
  ['an array', { dialect: 'cel', source: ['a'] }],
  ['a boolean', { source: true }],
];

describe('#15663 — a non-string envelope `source` in a walked slot', () => {
  describe("a lifecycle hook's `condition`", () => {
    for (const [label, value] of NON_STRING_SOURCES) {
      it(`reports ${label} as a located finding instead of crashing the run`, () => {
        const issues = validateStackExpressions({
          hooks: [{ name: 'gate_hook', object: 'lead', condition: value }],
        });
        expect(issues).toHaveLength(1);
        expect(issues[0].message).toContain(REFUSAL);
        expect(issues[0].severity).toBe('error');
        // The whole point: the author is told WHERE.
        expect(issues[0].where).toBe("hook 'gate_hook' (lead) condition");
        expect(issues[0].message).not.toContain('is not a function');
      });
    }

    it('does not throw — a TypeError here took the whole walk down', () => {
      expect(() =>
        validateStackExpressions({
          hooks: [{ name: 'gate_hook', object: 'lead', condition: { source: { nested: 1 } } }],
        }),
      ).not.toThrow();
    });
  });

  describe("a sharing rule's `condition`", () => {
    it('reports a located finding naming the rule and its object', () => {
      const issues = validateStackExpressions({
        sharingRules: [{ name: 'wide_open', object: 'lead', condition: { source: 1 } }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain(REFUSAL);
      expect(issues[0].where).toBe("sharingRule 'wide_open' (lead) condition");
    });
  });

  describe("an action's `visible` predicate", () => {
    it('reports a located finding naming the object and the action', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'lead',
          actions: [{ name: 'promote', visible: { source: ['a'] } }],
        }],
      });
      expect(issues.length).toBeGreaterThanOrEqual(1);
      const refusals = issues.filter((i) => i.message.includes(REFUSAL));
      expect(refusals).toHaveLength(1);
      expect(refusals[0].where).toContain("action 'promote' visible");
    });
  });

  describe('the finding does not corrupt the report — `source` stays a string', () => {
    it('every issue carries a string `source`, so a renderer cannot be handed an object', () => {
      const issues = validateStackExpressions({
        hooks: [{ name: 'gate_hook', object: 'lead', condition: { source: { nested: 1 } } }],
      });
      for (const i of issues) expect(typeof i.source).toBe('string');
    });
  });

  describe('CONTROLS — the walk must be unchanged for everything that already returned', () => {
    it('a valid predicate on the same slot still reports nothing', () => {
      expect(
        validateStackExpressions({
          hooks: [{ name: 'gate_hook', object: 'lead', condition: 'record.rating >= 4' }],
        }),
      ).toHaveLength(0);
    });

    it('a well-formed ENVELOPE on the same slot still reports nothing', () => {
      expect(
        validateStackExpressions({
          hooks: [{ name: 'gate_hook', object: 'lead', condition: { dialect: 'cel', source: '1 == 1' } }],
        }),
      ).toHaveLength(0);
    });

    it('an absent / empty condition still reports nothing', () => {
      expect(validateStackExpressions({ hooks: [{ name: 'h', object: 'lead' }] })).toHaveLength(0);
      expect(
        validateStackExpressions({ hooks: [{ name: 'h', object: 'lead', condition: '   ' }] }),
      ).toHaveLength(0);
    });

    it('a malformed STRING still gets its OWN diagnostic — the brace trap, not the shape refusal', () => {
      const issues = validateStackExpressions({
        hooks: [{ name: 'gate_hook', object: 'lead', condition: '{record.rating} >= 4' }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].message).not.toContain(REFUSAL);
      expect(issues[0].message).toContain('template brace');
      expect(issues[0].source).toBe('{record.rating} >= 4');
    });
  });
});
