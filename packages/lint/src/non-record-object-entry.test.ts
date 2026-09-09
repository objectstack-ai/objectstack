// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A non-record entry in a stack collection must not throw out of ANY authoring
 * rule — the family-level counterpart to `object-graph.test.ts`'s seam case
 * (#15494). `stack.objects` first (#15552); every other collection in the
 * parameterised sweep at the foot of this file (#15636).
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

/**
 * The same sweep, every OTHER stack collection (#15636).
 *
 * ## Why the sweep had to be parameterised rather than trusted
 *
 * #15552 closed the class for ONE collection. The reader it fixed was not
 * `stack.objects`'s reader, though — it was a hand-copied `asArray` that any
 * rule pasted in front of any collection, and 23 more copies of it stood in
 * front of `flows`, `pages`, `dashboards`, `datasets`, `apps`, `permissions`,
 * `capabilities`, `data`, `hooks`, `views`, `actions`, `translations` and the
 * per-object sub-collections. A `null` member of any of those reached the same
 * dereference for the same reason: these rules are pure `(stack) => Finding[]`
 * and run on the RAW `lint` path, so nothing upstream has judged an entry's
 * shape, and a YAML list item left empty deserialises to `null`.
 *
 * The count per collection was UNKNOWN rather than zero when this was written —
 * `lint-liveness-properties.test.ts` already pinned `translations: [null, …]`
 * and `agents: [null, …]`, so some call sites were guarded downstream and some
 * were not, and only a measurement could say which. This block is that
 * measurement, kept as the pin.
 *
 * ## Where the collection list comes from
 *
 * Read off the readers, not off memory: every `recordsOf(stack.X)` in the 22
 * modules #15636 re-pointed, plus the `TYPE_COLLECTIONS` table
 * `lintLivenessProperties` drives its dynamic `stack[key]` read from, plus
 * `positions` and `books`, which `validateSecurityPosture` reads. Adding a
 * collection to any of those readers and not to this list is the gap this
 * comment exists to make visible.
 *
 * ## What each case pins, and why the second one matters
 *
 * Not throwing is half the contract. A guard that dropped the whole collection
 * would satisfy it, and so would one that invented a finding about an entry no
 * author wrote — the shape `validateSecurityPosture` was actually caught in for
 * `objects`. So each case also pins the finding count against a control holding
 * the SAME collection without the junk member: dropping a non-record member
 * must be invisible to every rule, in both directions.
 */

/** A collection under sweep: how to build a stack holding exactly these members. */
interface SweptCollection {
  readonly label: string;
  readonly stack: (members: readonly unknown[]) => AnyRec;
  /** A member this collection accepts, so the control is not merely empty. */
  readonly valid?: AnyRec;
}

const topLevel = (key: string, valid?: AnyRec): SweptCollection => ({
  label: `stack.${key}`,
  stack: (members) => (key === 'objects' ? { [key]: members } : { objects: [VALID_OBJECT], [key]: members }),
  valid,
});

const VALID_FIELD: AnyRec = { name: 'amount', type: 'number', label: 'Amount' };

/** A stack whose single object carries `members` under one sub-collection key. */
const underObject = (key: string, valid?: AnyRec): SweptCollection => ({
  label: `objects[].${key}`,
  stack: (members) => ({ objects: [{ ...VALID_OBJECT, [key]: members }] }),
  valid,
});

/**
 * A judgeable flow node: the `start` node the flow readers resolve the
 * record-change target against, so a control built from it is not merely empty.
 */
const VALID_NODE: AnyRec = { id: 'start', type: 'start', config: { objectName: 'crm_account' } };

/**
 * A flow's own node list — `stack.flows[].nodes` (#15793).
 *
 * ## Why this needed a THIRD addressing mode rather than one more row
 *
 * The two above address a collection by NAME: a top-level stack key, or one
 * sub-collection key on an object. A flow's node list is neither. It is the
 * `nodes` of a member of `stack.flows`, and #15793's whole diagnosis was that
 * this sweep *could not express* it — which is why #15552, #15636 and #15742
 * closed this defect class three times without ever reaching the two casts
 * #15793 repaired. The blind spot was in the ADDRESSING, not in the rule table.
 *
 * The constructor is a three-line sibling of `underObject` because
 * `SweptCollection.stack` was already an arbitrary builder; what was missing
 * was only the will to write a second shape of one. That is worth saying
 * plainly: the gap looked structural and was not.
 */
const underFlow = (key: string, valid?: AnyRec): SweptCollection => ({
  label: `flows[].${key}`,
  stack: (members) => ({ objects: [VALID_OBJECT], flows: [{ name: 'crm_flow', edges: [], [key]: members }] }),
  valid,
});

/**
 * A NESTED region's node list — `flows[].nodes[].config.body.nodes` (#15793).
 *
 * The graph-shaped half proper, and a different reachability question from
 * `underFlow`. An ADR-0031 container keeps a whole sub-graph in its `config`,
 * and `collectFlowGraphs` turns each into its own `FlowGraph` after checking
 * only `Array.isArray` on the inner list — so a non-record member here is one
 * the PRODUCER picked up, not one a caller passed in, and no coercion at the
 * call site can reach it. That is what #16752 repaired, at the producer: the
 * walk now drops a non-record member from the graph it hands out, and this arm
 * carries no `RESIDUAL_THROWS` row. It stays in the sweep as the pin on that
 * repair — an unaddressable shape is exactly what let this class survive three
 * closures, so the addressing is the part worth keeping.
 */
const underNestedRegion = (valid?: AnyRec): SweptCollection => ({
  label: 'flows[].nodes[].config.body.nodes',
  stack: (members) => ({
    objects: [VALID_OBJECT],
    flows: [{
      name: 'crm_flow',
      edges: [],
      nodes: [VALID_NODE, { id: 'lp', type: 'loop', config: { collection: 'x', body: { nodes: members, edges: [] } } }],
    }],
  }),
  valid,
});

const SWEPT_COLLECTIONS: readonly SweptCollection[] = [
  // Top-level, read through `recordsOf(stack.X)` by the re-pointed readers.
  topLevel('objects', VALID_OBJECT),
  topLevel('flows'),
  topLevel('pages'),
  topLevel('dashboards'),
  topLevel('datasets'),
  topLevel('apps'),
  topLevel('permissions'),
  topLevel('capabilities'),
  topLevel('actions'),
  topLevel('views'),
  topLevel('hooks'),
  topLevel('data'),
  topLevel('translations'),
  // Top-level, reached by `lintLivenessProperties`'s dynamic `stack[key]` read.
  topLevel('agents'),
  topLevel('tools'),
  topLevel('skills'),
  topLevel('webhooks'),
  topLevel('datasources'),
  topLevel('books'),
  topLevel('jobs'),
  topLevel('emailTemplates'),
  topLevel('mappings'),
  // Top-level, read by `validateSecurityPosture` through `recordsOf`.
  topLevel('positions'),
  // A flow's inner graph — the shape no addressing mode could reach until
  // #15793 added one. `underFlow` is the flow's own list; `underNestedRegion`
  // is a container's sub-graph, which only the producer can hand out.
  underFlow('nodes', VALID_NODE),
  underNestedRegion(VALID_NODE),
  // Per-object sub-collections the same readers walk.
  underObject('fields', VALID_FIELD),
  underObject('actions'),
  underObject('views'),
  underObject('fieldGroups'),
  underObject('validations'),
];

/**
 * What is still broken, measured rather than assumed, keyed
 * `<collection> · <shape>`.
 *
 * These rows are not exceptions granted to the sweep — they are its FINDINGS,
 * and each one is a filed card. Writing them down is what lets the assertions
 * below be exact in BOTH directions: a rule that starts throwing on a
 * collection reds because it is not listed, and a residual that gets fixed reds
 * because its row is now a lie and has to go. A sweep that merely asserted
 * "nothing throws" would have had to be deleted or weakened on the day it was
 * written, and would then never have caught the next one.
 *
 * Five rows have come out since it was written, each because the sweep went
 * red demanding a throw that no longer happens — which is the both-directions
 * half earning its keep, since no removal started with anyone going looking:
 *
 *  - `stack.datasets` — `indexDatasets` in `validate-chart-bindings.ts`,
 *    re-pointed by #15741.
 *  - `objects[].fields` — `buildFieldIndex` in `validate-expressions.ts`, which
 *    cast each member inline instead of reading through a helper, so the
 *    `asArray` greps that produced #15552 and #15636 never saw it. It now reads
 *    the list through `recordsOf` (#15742), which drops a non-record member of
 *    the array shape whole and in silence, exactly as the file's two sibling
 *    field readers already did.
 *  - `flows[].nodes` / `validateStackExpressions` — the two casts #15793
 *    repaired, and the reason the two graph-shaped arms below exist at all.
 *  - `flows[].nodes[].config.body.nodes` / `validateStackExpressions` +
 *    `lintFlowPatterns` (#16752) — the throw was `collectFlowGraphs`'
 *    (`packages/spec`), which handed out a `FlowGraph` whose `nodes` held the
 *    junk member it had picked up out of a container's open `z.record` config.
 *    Both rules stopped throwing the moment the PRODUCER stopped handing it
 *    out, which is what #15793 predicted when it refused to widen the
 *    `packages/spec` contract and filed the fork instead. ⛔ Note what did NOT
 *    fix it: #16134 had already stopped that walk DEREFERENCING the member, and
 *    both rows survived it — a guard against reading junk is not a guard
 *    against passing it on.
 *
 *    ⭐ These two arms are now green for TWO independent reasons, and both were
 *    measured. #16751 landed alongside and re-pointed the two CONSUMER readers
 *    this shape reached — `lint-flow-patterns.ts`' own `graph.nodes` reader and
 *    `collectFlowVariableNames`' unguarded `graph.nodes` walk — and on the tree
 *    before either fix those were the frames the throws carried, one in each
 *    rule, neither inside `packages/spec`. So "neither rule's own reader was at
 *    fault" is the wrong reading of this pair in one direction only: the
 *    producer's declared `FlowNodeParsed[]` really did lie about what it
 *    returned, AND the consumers really did dereference without a guard.
 *    Neither repair makes the other unnecessary — remove the producer fix and
 *    the junk is handed out again to every other consumer; remove the consumer
 *    coercion and these two readers are back to trusting a declared element
 *    type. Read the pair as belt and braces, ⛔ not as one change that turned
 *    out to be redundant.
 *  - `flows[].nodes` / `lintFlowPatterns` (#16751) — the SAME two spellings one
 *    file over. `lint-flow-patterns.ts` inline-cast `flow.nodes` and then read
 *    `.type` off each member, and double-cast `graph.nodes` at two further
 *    readers; `flow-variable-scope.ts` walked `graph.nodes` with no member
 *    guard while guarding `flow.variables` seven lines up. All re-pointed at
 *    `recordsOf`, with the COERCED array — never `flow.nodes` raw — handed on
 *    to `collectFlowGraphs`, measured: hand the raw one on and the crash
 *    RELOCATES to the graph-node reader instead of going away. This is the
 *    shallow half, and the producer repair above never covered it: `flow.nodes`
 *    is a list the RULE reads itself, before any producer sees it.
 *
 * ## It holds no row today
 *
 * It went from empty to two the moment a flow's inner node list became
 * addressable, which is the point #15793 was filed to make: this class was
 * closed three times over collections while the same defect stood untouched one
 * addressing mode away. The graph-shaped pair went out when the producer
 * stopped handing a junk member out, the shallow one when the last flow-node
 * list reader stopped trusting `Array.isArray` about members, and the table is
 * empty again. Empty is this ratchet's resting state, not its retirement: it
 * stays exact in both directions, so a rule that starts throwing on any swept
 * collection reds here because it is not listed.
 */
const RESIDUAL_THROWS: Readonly<Record<string, readonly string[]>> = {};

/**
 * Where a junk member still draws a finding no author's file justifies — the
 * phantom half of the same defect, and the shape `validateSecurityPosture` was
 * caught in for `objects` (#15552).
 *
 * Empty since #15728. The one row it held was `stack.agents · an array`: the
 * agent readers filtered their array branch with `!!x && typeof x === 'object'`
 * and `[]` passes that test, so an empty list item survived as an agent with no
 * name and drew one reference-integrity finding at a position nobody wrote.
 * `recordsOf` filters with `isRec`, which excludes an array, and re-pointing
 * those readers closed it. The row came out because this assertion went red
 * demanding an invented finding that no longer happens — the both-directions
 * half earning its keep, the same way `stack.datasets` left `RESIDUAL_THROWS`.
 */
const RESIDUAL_INVENTED: Readonly<Record<string, number>> = {};

describe('a non-record entry in any other stack collection (#15636)', () => {
  describe.each(SWEPT_COLLECTIONS.map((c) => [c.label, c] as const))('%s', (_label, collection) => {
    const members = (junk: unknown): readonly unknown[] =>
      collection.valid ? [junk, collection.valid] : [junk];
    const control = (): AnyRec => collection.stack(collection.valid ? [collection.valid] : []);

    describe.each(NON_RECORD_ENTRIES)('with %s', (shape, junk) => {
      const key = `${collection.label} · ${shape}`;

      it('throws out of no rule but the ones still filed as broken', () => {
        const threw: string[] = [];
        const detail: string[] = [];
        for (const rule of AUTHORING_RULES) {
          try {
            rule.run(collection.stack(members(junk)), {});
          } catch (e) {
            threw.push(rule.name);
            detail.push(`${rule.name}: ${(e as Error).message}`);
          }
        }
        expect(threw.sort(), detail.join(' | ')).toEqual([...(RESIDUAL_THROWS[key] ?? [])].sort());
      });

      it('invents no finding about the entry no author wrote', () => {
        // A rule listed in `RESIDUAL_THROWS` is excluded from BOTH sides rather
        // than counted as zero: it returns nothing because it crashed, and
        // folding that into the population count would let a crash read as
        // "reported nothing", which is the confusion this file exists to end.
        const skip = RESIDUAL_THROWS[key] ?? [];
        const count = (stack: AnyRec): number =>
          AUTHORING_RULES.reduce((n, rule) => (skip.includes(rule.name) ? n : n + rule.run(stack, {}).length), 0);
        expect(count(collection.stack(members(junk))) - count(control())).toBe(RESIDUAL_INVENTED[key] ?? 0);
      });
    });
  });
});
