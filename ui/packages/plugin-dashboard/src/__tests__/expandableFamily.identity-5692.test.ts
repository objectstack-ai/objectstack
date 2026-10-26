/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5692 — this package's TWO private copies of the reference-bearing
 * field family converge onto `@object-ui/core`'s `EXPANDABLE_FIELD_TYPES`.
 *
 * The copies were `LOOKUP_TYPES` in `recordFields.tsx` and an inline
 * disjunction inside `computeLookupExpand` in `ObjectDataTable.tsx`. Neither
 * derived from nor pinned against the shared set, and objectui#5312 had recorded
 * `paramToField` as the LAST private copy — false by these two, which predate
 * that sweep.
 *
 * ## Why the load-bearing pin is IDENTITY, not membership
 *
 * Every membership assertion below is satisfied by a private
 * `new Set(['lookup', 'master_detail', 'tree', 'user'])` holding the same
 * strings — i.e. by a re-fork of exactly the kind this change removed. So the
 * pins that decide the convergence spy on the `has` of the object core exports:
 * a call is recorded only if the face under test consulted THAT object, so a
 * member-identical copy leaves the spy empty and fails here, where a value check
 * would pass ON the defect. Same shape as objectui#4770 / #4790 / #4815 / #5312.
 *
 * ## The two membership deltas, and how each was decided
 *
 * The private copies were not in a subset relation with the shared set in either
 * direction: they lacked `tree` and carried a fifth spelling, `reference`.
 *
 *  - `tree` GAINED (accepted): a member of the spec's closed `FieldType` that
 *    the form / grid road already expands.
 *  - `reference` DROPPED (measured, not preferred): it is not a declarable field
 *    type at all, so no producer can emit a field whose stored type is
 *    `reference`. `describe('the reference drop is a no-op...')` below carries
 *    that measurement — with live and dead controls — so the day the spec adds
 *    the spelling, this file goes RED and the membership question reopens
 *    instead of the drop staying silently correct-by-accident.
 *
 * Ablation direction, predicted before running: restore either private copy and
 * that face's identity pin goes RED (the spy records no call) while its `tree`
 * pin goes red too and its `reference` pin flips; the ordinary-relation
 * regression controls stay GREEN in both directions, which is what makes them
 * controls rather than duplicates of the pins.
 *
 * ## objectui#5876 — one predicate, and why NO behavioural test can pin it
 *
 * #5692 left the package with TWO byte-identical bodies: `isLookupType` here
 * and a local `isLookup` inside `computeLookupExpand`. Collapsing the second
 * into the first is observationally FREE — every boolean claim about `$expand`
 * (`tree` expands, `reference` does not, ordinary relations do) answers the
 * same before and after, so every assertion in the three describes above would
 * stay GREEN on a revert. They are controls for this change, not pins of it.
 * The `reportRetiredFieldType` count does not move either: its dedupe key is
 * the SPELLING, in one module-level Set inside `@object-ui/core`, which both
 * bodies already shared (`retired-field-types.ts` — "the dedupe is per
 * SPELLING, not per face").
 *
 * So the pin below is IDENTITY at the call level, in two halves that fail for
 * different reasons: `computeLookupExpand` must be observed CALLING
 * `isLookupType`, and `ObjectDataTable.tsx` must hold no second body for it to
 * call instead. Predicted ablation: restore the local `isLookup` and BOTH go
 * RED while everything above stays green.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { EXPANDABLE_FIELD_TYPES } from '@object-ui/core';
import { FieldType } from '@objectstack/spec/data';
import { enumOptions } from '@object-ui/test-support';
import { isLookupType } from '../recordFields';
import { computeLookupExpand } from '../ObjectDataTable';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

/**
 * The spec's own `FieldType` vocabulary.
 *
 * The wrapper walk is `@object-ui/test-support`'s shared reader (objectui#6924);
 * the THROW stays HERE, because the reader deliberately answers `[]` rather than
 * raising and this read is module-scope. What it replaces was a NON-OPTIONAL
 * cast of the enum node to an options-bearing shape, spread directly — which
 * failed LOUDLY the moment the cast stopped holding (spreading `undefined`
 * throws), so a bare `enumOptions` call here would have traded a loud failure
 * for a silently empty vocabulary: every assertion below would then pass over
 * nothing. That trade is the regression objectui#7025 exists to refuse. (The
 * retired spelling is deliberately NOT quoted here: the card's enumeration
 * instrument is a grep for it, and a comment carrying the literal text makes
 * every future re-derivation of this population read a false positive.)
 */
const readSpecFieldTypes = (): readonly string[] => {
  const options = enumOptions(FieldType);
  if (options.length === 0) {
    throw new Error('could not read FieldType.options from @objectstack/spec');
  }
  return options;
};

const SPEC_FIELD_TYPES: readonly string[] = readSpecFieldTypes();

/** The relations an ordinary dashboard table shows — the regression control. */
const ORDINARY_RELATIONS = ['lookup', 'master_detail', 'user'] as const;

const objectSchema = () => ({
  fields: {
    id: { type: 'text' },
    title: { type: 'text' },
    account: { type: 'lookup', reference: 'accounts' },
    parent_case: { type: 'master_detail', reference: 'cases' },
    assignee: { type: 'user' },
    // No `reference` — optional on a `tree`, and must name the declaring
    // object when present (objectstack#14892). This schema declares no
    // `name`, and every rule under test reads `type` (objectui#7839).
    parent_node: { type: 'tree' },
    legacy_ref: { type: 'reference', reference: 'accounts' },
  },
});

const ALL_COLUMNS = [
  'title',
  'account',
  'parent_case',
  'assignee',
  'parent_node',
  'legacy_ref',
];

describe("the dashboard's relation rule is core's object, not a copy (objectui#5692)", () => {
  it('`isLookupType` asks `@object-ui/core` EXPANDABLE_FIELD_TYPES', () => {
    const spy = vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has');
    try {
      expect(isLookupType('lookup')).toBe(true);
      expect(spy.mock.calls.map(([k]) => k)).toContain('lookup');
    } finally {
      spy.mockRestore();
    }
  });

  it('`computeLookupExpand` asks it too — in BOTH column modes', () => {
    // The explicit-whitelist mode and the auto-derive mode are two separate
    // code paths through the predicate, so a convergence that reconnected one
    // would leave the other forked. Each is spied separately.
    const modes: [string, () => unknown][] = [
      ['explicit whitelist', () =>
        computeLookupExpand({ columns: ALL_COLUMNS }, objectSchema())],
      ['auto-derive', () => computeLookupExpand({}, objectSchema())],
    ];
    for (const [label, exercise] of modes) {
      const spy = vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has');
      try {
        exercise();
        expect(
          spy.mock.calls.map(([k]) => k),
          `${label} never consulted the shared set`,
        ).toContain('lookup');
      } finally {
        spy.mockRestore();
      }
    }
  });
});

describe('one relation predicate, not two that agree by coincidence (objectui#5876)', () => {
  it('`computeLookupExpand` CALLS `isLookupType` — in BOTH column modes', () => {
    // Surgical by construction: `vi.doMock` is not hoisted, so it binds only
    // the dynamic import below and leaves every other test in this file on the
    // real module. The double delegates to the real implementation, so the
    // exercise still answers correctly — what is being read is WHO answered.
    return (async () => {
      const actual = await import('../recordFields');
      const double = vi.fn(actual.isLookupType);
      vi.resetModules();
      vi.doMock('../recordFields', () => ({ ...actual, isLookupType: double }));
      try {
        const { computeLookupExpand: subject } = await import('../ObjectDataTable');
        const modes: [string, () => string[]][] = [
          ['explicit whitelist', () => subject({ columns: ALL_COLUMNS }, objectSchema())],
          ['auto-derive', () => subject({}, objectSchema())],
        ];
        for (const [label, exercise] of modes) {
          double.mockClear();
          // Control: the mode still answers, so an assertion about WHO was
          // asked cannot pass on a subject that did nothing at all.
          expect(exercise(), `${label} expanded nothing`).toContain('account');
          expect(
            double.mock.calls.map(([t]) => t),
            `${label} answered the relation question without asking isLookupType`,
          ).toContain('lookup');
        }
      } finally {
        vi.doUnmock('../recordFields');
        vi.resetModules();
      }
    })();
  });

  it('`ObjectDataTable.tsx` holds no second predicate body', () => {
    // The call pin above can be satisfied while a dead copy still sits in the
    // file; this half is what makes "one predicate" true of the SOURCE. Read
    // with comments stripped, so the prose that NAMES these symbols in the
    // convergence note cannot fake a hit.
    const code = mask(
      readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ObjectDataTable.tsx'),
        'utf8',
      ),
    );

    // Controls — chosen to be INVARIANT under the ablation this pin guards
    // against, so that a mis-resolved path or an over-eager stripper fails
    // HERE, as a broken probe, while a genuine revert fails on the subject
    // lines below with an honest message. (Measured: an earlier draft used the
    // `isLookupType` call count as its control, and a real revert then reported
    // itself as "probe stripped the code away" — the two failures were
    // indistinguishable, which is the whole thing a control exists to prevent.)
    expect(code, 'probe read the wrong file').toContain('export function computeLookupExpand(');
    expect(code, 'probe stripped the code away').toContain('out.add(acc)');

    // Subject — each of these moves if the local copy comes back.
    expect(
      code.match(/isLookupType\(/g) ?? [],
      'computeLookupExpand stopped calling the shared predicate',
    ).toHaveLength(2);
    expect(code, 'a second family read lives here').not.toContain('EXPANDABLE_FIELD_TYPES');
    expect(code, 'a second retirement gate lives here').not.toContain('RetiredFieldType');
  });
});

describe('the ordinary relations are untouched — regression control', () => {
  // These must stay green through BOTH ablation legs. If they move, the
  // convergence took the whole whitelist with it and the pins above are
  // reporting on rubble rather than on a re-homed rule.
  it('`isLookupType` still answers true for every ordinary relation', () => {
    for (const type of ORDINARY_RELATIONS) {
      expect(isLookupType(type), type).toBe(true);
    }
    expect(isLookupType('text')).toBe(false);
  });

  it('`$expand` still carries the ordinary relation columns, in both modes', () => {
    const explicit = computeLookupExpand({ columns: ALL_COLUMNS }, objectSchema());
    const auto = computeLookupExpand({}, objectSchema());
    for (const expanded of [explicit, auto]) {
      expect(expanded).toEqual(
        expect.arrayContaining(['account', 'parent_case', 'assignee']),
      );
      expect(expanded).not.toContain('title');
      expect(expanded).not.toContain('id');
    }
  });
});

describe('`tree` gains expansion on the dashboard road — the accepted direction', () => {
  // A self-referencing hierarchy column is reference-bearing, so the form and
  // grid roads already `$expand` it. The dashboard's private copies did not,
  // which is the divergence this convergence closes; the column's cell shows
  // the parent record's display name instead of a bare id.
  it('is a member of the shared family', () => {
    expect(EXPANDABLE_FIELD_TYPES.has('tree')).toBe(true);
  });

  it('`isLookupType` now answers true for it', () => {
    expect(isLookupType('tree')).toBe(true);
  });

  it('a `tree` column is now requested for `$expand`, in both modes', () => {
    expect(
      computeLookupExpand({ columns: ALL_COLUMNS }, objectSchema()),
    ).toContain('parent_node');
    expect(computeLookupExpand({}, objectSchema())).toContain('parent_node');
  });
});

describe('the `reference` drop is a no-op on real data — the measured direction', () => {
  /**
   * The measurement, kept as an executable pin rather than as prose in a PR.
   * Controls run on the same read as the subject, so a probe that had lost hold
   * of the vocabulary (an empty list, the wrong export) fails as a broken probe
   * instead of reporting the subject absent.
   */
  it('every LIVE control IS a spec `FieldType`, and every DEAD one is not', () => {
    // Live controls: the four members of the shared family.
    for (const type of EXPANDABLE_FIELD_TYPES) {
      expect(SPEC_FIELD_TYPES, `'${type}' is not a spec FieldType`).toContain(type);
    }
    // Dead controls: a spelling this renderer retired, and pure nonsense.
    // If either turns up "present", the read is broken and the subject reading
    // below means nothing.
    expect(SPEC_FIELD_TYPES).not.toContain('owner');
    expect(SPEC_FIELD_TYPES).not.toContain('zzz_not_a_field_type');
  });

  it('SUBJECT — `reference` is not a declarable field type', () => {
    // The whole licence for dropping it. If the spec ever adds the spelling,
    // this goes red and the "should the shared family gain `reference`?"
    // question reopens — deliberately, rather than the drop remaining correct
    // only by accident.
    expect(SPEC_FIELD_TYPES).not.toContain('reference');
  });

  it('so the dashboard no longer answers for it', () => {
    expect(isLookupType('reference')).toBe(false);
    expect(
      computeLookupExpand({ columns: ALL_COLUMNS }, objectSchema()),
    ).not.toContain('legacy_ref');
    expect(computeLookupExpand({}, objectSchema())).not.toContain('legacy_ref');
  });
});
