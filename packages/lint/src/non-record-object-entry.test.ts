// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A non-record entry in `stack.objects` must not throw out of ANY authoring
 * rule (#15552) — the family-level counterpart to `object-graph.test.ts`'s
 * seam case (#15494).
 *
 * ## Why this is a family sweep and not thirteen per-rule cases
 *
 * The defect is not a rule's, it is a READER's, and readers are shared: one
 * hand-copied `asArray` sat in front of several rules at once, and two more
 * sat inside the reference-integrity suite where the first throwing member
 * hides every member behind it. A per-rule test therefore cannot see the
 * population it is protecting — the first repair (#15494) fixed the seam every
 * field-path rule opens with and still left 13 of 42 rules throwing on the
 * identical input, through eleven more reader sites plus the two indexers the
 * suite reaches. So the assertion is written over the TABLE: every rule the
 * three authoring commands and the runtime publish gate run, driven over each
 * non-record shape, must return rather than throw.
 *
 * ## Why the shapes are three, and why only one of them ever threw
 *
 * `null` is what a YAML list item left empty deserialises to, and it is the one
 * that crashed: `null.name` throws where `({}).name` and `'x'.name` are merely
 * `undefined`. `{}` and `'x'` are kept in the sweep as the boundary — they pin
 * that "reads a property off a non-record" stays harmless in BOTH directions,
 * so a future reader that starts asserting on the entry's shape fails here
 * rather than on a tenant's stack. `{}` is itself a record and is deliberately
 * NOT dropped: the guard drops what cannot be read, not what is empty.
 *
 * ## Why the population pin is here
 *
 * A guard that skips a junk entry could just as easily skip everything and
 * still pass a "no throw" assertion. The valid object standing beside the junk
 * one must still be JUDGED, so each shape also asserts the rule table emits the
 * same number of findings as it does for the valid object alone. Its path index
 * is allowed to differ: a rule that indexes `objects` raw (with a per-object
 * guard of its own, as `validateSecurityPosture` does) honestly reports
 * `objects[1]` because that is where the author wrote it, while a rule reading
 * through `recordsOf` reports `objects[0]`. That is a difference in the path,
 * never in whether the object was judged.
 */

import { describe, expect, it } from 'vitest';

import { AUTHORING_RULES } from './authoring-rules.js';
import { recordsOf } from './object-graph.js';
import { indexObjectFieldGroups } from './object-field-groups.js';
import { walkAuthoredFilters } from './filter-walk.js';
import { lintAutonumberFormats } from './lint-autonumber-formats.js';
import { lintViewRefs } from './lint-view-refs.js';
import { validateFormLayout } from './validate-form-layout.js';
import { validateListViewMode } from './validate-list-view-mode.js';
import { validateObjectReferences } from './validate-object-references.js';
import { validateOrgAxisRedLines } from './validate-org-axis-red-lines.js';
import { indexObjectFields } from './validate-page-field-bindings.js';
import { validateRecordTitle } from './validate-record-title.js';
import { indexObjectSearchTargets } from './validate-searchable-fields.js';
import { validateSecurityPosture } from './validate-security-posture.js';
import { validateSharingRuleEnforceability } from './validate-sharing-rule-enforceability.js';
import { validateStackExpressions } from './validate-expressions.js';
import { validateWidgetBindings } from './validate-widget-bindings.js';

type AnyRec = Record<string, unknown>;

/**
 * A judgeable object: named, with a readable field map, a field group and NO
 * `sharingModel` — the last one on purpose, so the table emits at least one
 * finding (`security-owd-unset`) and the population pin below has something to
 * count.
 */
const VALID_OBJECT: AnyRec = {
  name: 'crm_account',
  label: 'Account',
  fields: [{ name: 'name', type: 'text', label: 'Name' }],
  fieldGroups: [{ key: 'general', label: 'General' }],
};

/** The three shapes a raw `objects` list can hold that are not a record. */
const NON_RECORD_ENTRIES: readonly (readonly [string, unknown])[] = [
  ['null', null],
  ['undefined', undefined],
  ['a string', 'x'],
  ['a number', 42],
  ['an array', []],
];

const stackWith = (junk: unknown): AnyRec => ({ objects: [junk, VALID_OBJECT] });
const validOnly: AnyRec = { objects: [VALID_OBJECT] };

const findingCount = (stack: AnyRec): number =>
  AUTHORING_RULES.reduce((n, rule) => n + rule.run(stack, {}).length, 0);

describe('a non-record entry in `stack.objects` (#15552)', () => {
  /**
   * The floor first: every assertion below sweeps `AUTHORING_RULES`, so a table
   * that shrank (or failed to load) would pass the sweep vacuously. 42 is what
   * this repair was measured against; the pin is a floor, not an equality, so
   * registering a rule never edits this file.
   */
  it('sweeps the whole authoring-rule table, and the table is not empty', () => {
    expect(AUTHORING_RULES.length).toBeGreaterThanOrEqual(42);
  });

  describe.each(NON_RECORD_ENTRIES)('with %s beside a valid object', (_label, junk) => {
    it('no authoring rule throws', () => {
      const threw: string[] = [];
      for (const rule of AUTHORING_RULES) {
        try {
          rule.run(stackWith(junk), {});
        } catch (e) {
          threw.push(`${rule.name}: ${(e as Error).message}`);
        }
      }
      expect(threw).toEqual([]);
    });

    it('still judges the valid object standing beside it', () => {
      const baseline = findingCount(validOnly);
      expect(baseline).toBeGreaterThan(0);
      expect(findingCount(stackWith(junk))).toBe(baseline);
    });
  });

  it('keeps an empty record — the guard drops what it cannot read, not what is empty', () => {
    expect(recordsOf([{}, VALID_OBJECT])).toEqual([{}, VALID_OBJECT]);
    const threw: string[] = [];
    for (const rule of AUTHORING_RULES) {
      try {
        rule.run({ objects: [{}, VALID_OBJECT] }, {});
      } catch (e) {
        threw.push(`${rule.name}: ${(e as Error).message}`);
      }
    }
    expect(threw).toEqual([]);
  });
});

/**
 * One case per READER seam re-pointed onto `recordsOf`, so a seam that forks
 * its own copy again fails here by name rather than only inside the sweep.
 * Each drives the seam directly with the junk entry in front of the valid one
 * and asserts the valid object still reaches the other side.
 */
describe('each `stack.objects` reader seam skips a non-record entry (#15552)', () => {
  const junked = stackWith(null);

  it('recordsOf — the shared reader itself', () => {
    expect(recordsOf([null, undefined, 'x', 42, [], VALID_OBJECT])).toEqual([VALID_OBJECT]);
    // The map shape keeps the author's key even when its body is unreadable.
    expect(recordsOf({ a: null, b: { x: 1 } })).toEqual([{ name: 'a' }, { name: 'b', x: 1 }]);
  });

  it('validate-expressions — buildFieldIndex', () => {
    expect(() => validateStackExpressions(junked)).not.toThrow();
  });

  it('validate-list-view-mode', () => {
    expect(() => validateListViewMode(junked)).not.toThrow();
  });

  it('validate-widget-bindings — the aggregate-coherence pass ahead of the graph seam', () => {
    expect(() => validateWidgetBindings(junked)).not.toThrow();
  });

  it('filter-walk — walkAuthoredFilters over any collection', () => {
    const seen: string[] = [];
    expect(() =>
      walkAuthoredFilters(
        { objects: [null, { ...VALID_OBJECT, filter: "name = 'acme'" }] },
        [{ key: 'objects', kind: 'object' }],
        (f) => seen.push(f.where),
      ),
    ).not.toThrow();
    expect(seen).toEqual(['object "crm_account"']);
  });

  it('validate-object-references — the reference-integrity suite member that threw first', () => {
    expect(() => validateObjectReferences(junked)).not.toThrow();
  });

  it('validate-record-title', () => {
    expect(() => validateRecordTitle(junked)).not.toThrow();
  });

  it('validate-form-layout', () => {
    expect(() => validateFormLayout(junked)).not.toThrow();
  });

  it('lint-autonumber-formats', () => {
    expect(() => lintAutonumberFormats(junked)).not.toThrow();
  });

  it('lint-view-refs', () => {
    expect(() => lintViewRefs(junked)).not.toThrow();
  });

  it('validate-org-axis-red-lines', () => {
    expect(() => validateOrgAxisRedLines(junked)).not.toThrow();
  });

  it('validate-security-posture — reported the junk entry rather than skipping it', () => {
    // The one seam the re-measure added that did not CRASH: an `[]` member
    // survived its `typeof v === 'object'` read and drew a second
    // `security-owd-unset` at `object "(object 0)"` — a phantom `error` about
    // an entry no author wrote, on the same publish door. Same class, same
    // verdict: skip it.
    const posture = validateSecurityPosture({ objects: [[], VALID_OBJECT] });
    expect(posture.map((f) => f.where)).toEqual(['object "crm_account"']);
  });

  it('validate-sharing-rule-enforceability', () => {
    expect(() => validateSharingRuleEnforceability(junked)).not.toThrow();
  });

  it('validate-searchable-fields — indexObjectSearchTargets', () => {
    expect(() => indexObjectSearchTargets(junked)).not.toThrow();
    expect(indexObjectSearchTargets(junked).has('crm_account')).toBe(true);
  });

  it('validate-page-field-bindings — indexObjectFields', () => {
    expect(() => indexObjectFields(junked)).not.toThrow();
    expect(indexObjectFields(junked).get('crm_account')).toEqual(new Set(['name']));
  });

  it('object-field-groups — indexObjectFieldGroups', () => {
    expect(() => indexObjectFieldGroups(junked)).not.toThrow();
    expect(indexObjectFieldGroups(junked).get('crm_account')).toEqual(new Set(['general']));
  });
});
