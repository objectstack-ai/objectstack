/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5874 — this package's TWO private copies of the reference-bearing
 * field family converge onto `@object-ui/core`'s `EXPANDABLE_FIELD_TYPES`.
 *
 * The copies were both inline disjunctions:
 *
 *  - `RecordDetailDrawer.tsx` — `isLookup`, which forces a field READONLY
 *    because the drawer wires no relation picker into its inline editor, so a
 *    plain text input would let the user overwrite the relation with a
 *    free-form string;
 *  - `HeaderHighlight.tsx` — the reference-bearing part of the wider `isWide`
 *    disjunction, which gives a chip the wide layout basis because its inline
 *    editor is a record picker.
 *
 * Neither derived from nor pinned against the shared set.
 *
 * ## Why the load-bearing pin is IDENTITY, not membership
 *
 * Every membership assertion below is satisfied by a private
 * `new Set(['lookup', 'master_detail', 'tree', 'user'])` holding the same
 * strings — i.e. by a re-fork of exactly the kind this change removed. So the
 * pins that decide the convergence spy on the `has` of the object core
 * exports: a call is recorded only if the face under test consulted THAT
 * object, so a member-identical private copy leaves the spy empty and fails
 * here, where a value check would pass ON the defect. Same shape as
 * objectui#4770 / #4790 / #4815 / #5312 / #5692.
 *
 * ## The membership deltas, and how each was decided
 *
 *  - `user` / `tree` GAINED (restoration, not widening — decided per face on
 *    the read site): both carry the same foreign-key storage as `lookup`, so
 *    the reason each face states for special-casing `lookup` applies to them
 *    verbatim. The drawer's own reason is "no relation picker, so a text input
 *    would let the user overwrite the relation"; the strip's is "the picker
 *    needs more room than a KPI number", and the strip's `dataSource` prop doc
 *    already names `lookup` / `user` together as the reference editors.
 *  - `reference` DROPPED (measured, not preferred): it is not a declarable
 *    field type, and on the strip it is not an authorable display type either
 *    (`HighlightField['type']` is a closed union without it), so neither source
 *    of these faces' input can produce it.
 *
 * ## `isWide` is a disjunction of TWO rules and only one of them moved
 *
 * The long-text DISPLAY types (`email` / `url` / `textarea`) are this surface's
 * own list and are deliberately NOT part of the shared family. They are pinned
 * below so a future convergence cannot quietly absorb them.
 *
 * Ablation direction, predicted before running: restore either private copy and
 * that face's identity pin goes RED (the spy records no call) while a
 * member-set assertion over `EXPANDABLE_FIELD_TYPES` stays GREEN — that
 * contrast is the whole reason the pins are on identity. The restoration probes
 * go red too; the ordinary-relation and non-relation controls stay green in
 * both directions, which is what makes them controls rather than duplicates of
 * the pins.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { EXPANDABLE_FIELD_TYPES } from '@object-ui/core';
import { FieldType } from '@objectstack/spec/data';
import { enumOptions } from '@object-ui/test-support';
import { HeaderHighlight } from '../HeaderHighlight';
import { RecordDetailDrawer } from '../RecordDetailDrawer';

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

/**
 * The drawer hands its derived field list to `DetailView` as `schema.fields`.
 * Standing in for `DetailView` captures that list without rendering the whole
 * detail tree — the readonly flag under test is a property of the list, not of
 * how DetailView paints it.
 */
const capturedFields: { current: any[] } = { current: [] };
vi.mock('../DetailView', () => ({
  DetailView: ({ schema }: any) => {
    capturedFields.current = schema?.fields ?? [];
    return <div data-testid="detail-view-stub" />;
  },
}));

const objectSchema = {
  name: 'deal',
  fields: {
    title: { type: 'text', label: 'Title' },
    account: { type: 'lookup', label: 'Account', reference: 'accounts' },
    parent_deal: { type: 'master_detail', label: 'Parent', reference: 'deals' },
    assignee: { type: 'user', label: 'Assignee' },
    // No target key. It carried the retired snake_case one, which
    // `FieldSchema` refuses BY NAME — so the line asserted nothing, and
    // renaming it would have turned a refused key into an accepted
    // self-annotation this fixture never made. On a `tree` the key is
    // optional and must be the declaring object when present
    // (objectstack#14892); the readonly rule reads `type` (objectui#7839).
    parent_node: { type: 'tree', label: 'Parent node' },
    stage: { type: 'select', label: 'Stage' },
    notes: { type: 'textarea', label: 'Notes' },
  },
};

const record = {
  id: 'r1',
  title: 'Acme renewal',
  account: 'acc-1',
  parent_deal: 'deal-0',
  assignee: 'usr-1',
  parent_node: 'deal-0',
  stage: 'won',
  notes: 'some notes',
};

function renderDrawer() {
  capturedFields.current = [];
  render(
    <RecordDetailDrawer
      open
      onClose={() => {}}
      title="Acme renewal"
      record={record}
      recordId="r1"
      objectName="deal"
      objectSchema={objectSchema}
      onFieldSave={async () => {}}
    />,
  );
  return capturedFields.current;
}

const drawerField = (name: string) =>
  renderDrawer().find((f: any) => f.name === name);

/** The layout basis the strip gives a wide chip vs a narrow one. */
const WIDE_BASIS = 'basis-[16rem]';
const NARROW_BASIS = 'basis-[9rem]';

function renderHighlight(type: string) {
  const { container } = render(
    <HeaderHighlight
      fields={[{ name: 'probe', label: 'Probe', type: type as any }]}
      data={{ probe: 'v' }}
      objectName="deal"
    />,
  );
  const chip = container.querySelector(`.${CSS.escape(WIDE_BASIS)}, .${CSS.escape(NARROW_BASIS)}`);
  return chip?.className.includes(WIDE_BASIS) ? 'wide' : chip ? 'narrow' : 'missing';
}

afterEach(() => {
  // The pins install a spy on the Set object EXPORTED by core — a shared,
  // module-level object. A leaked spy would follow every later file in the
  // worker, so restoring is not optional here.
  vi.restoreAllMocks();
});

describe("the drawer's readonly rule is core's object, not a copy (objectui#5874)", () => {
  it('`RecordDetailDrawer` asks `@object-ui/core` EXPANDABLE_FIELD_TYPES', () => {
    // The spy is installed on the Set exported by core and records a call only
    // if THIS face consulted THAT object. A member-identical private copy
    // leaves it empty, so this fails where a value check would pass.
    const spy = vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has');
    try {
      renderDrawer();
      expect(spy.mock.calls.map(([k]) => k)).toContain('lookup');
    } finally {
      spy.mockRestore();
    }
  });

  it('reaches that object on the person path too, not just the lookup path', () => {
    const spy = vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has');
    try {
      renderDrawer();
      expect(spy.mock.calls.map(([k]) => k)).toContain('user');
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the strip's wide rule is core's object, not a copy (objectui#5874)", () => {
  it('`HeaderHighlight` asks `@object-ui/core` EXPANDABLE_FIELD_TYPES', () => {
    const spy = vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has');
    try {
      renderHighlight('lookup');
      expect(spy.mock.calls.map(([k]) => k)).toContain('lookup');
    } finally {
      spy.mockRestore();
    }
  });

  it('reaches that object on the person path too', () => {
    const spy = vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has');
    try {
      renderHighlight('user');
      expect(spy.mock.calls.map(([k]) => k)).toContain('user');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('a member-identical private copy would NOT satisfy the pins — the contrast', () => {
  it('the member set alone cannot tell a converged face from a re-forked one', () => {
    // Documents, executably, why the four pins above are not membership checks:
    // this assertion is true of the shared object AND of any private set
    // holding the same strings. The spies above can tell them apart.
    const memberIdenticalCopy = new Set(['lookup', 'master_detail', 'tree', 'user']);
    expect([...EXPANDABLE_FIELD_TYPES].sort()).toEqual([...memberIdenticalCopy].sort());
    expect(EXPANDABLE_FIELD_TYPES).not.toBe(memberIdenticalCopy);
  });
});

describe('the restoration half — members these faces were missing (objectui#5874)', () => {
  // Each must be able to FAIL: before the convergence a `user` / `tree` field
  // was inline-editable as free text in the drawer, and got the narrow basis in
  // the strip.
  it.each(['assignee', 'parent_node'])(
    'the drawer now marks %s readonly, like a lookup',
    (name) => {
      expect(drawerField(name)?.readonly).toBe(true);
    },
  );

  it.each(['user', 'tree'])('the strip now gives a %s chip the wide basis', (type) => {
    expect(renderHighlight(type)).toBe('wide');
  });
});

describe('the ordinary relations are untouched — regression control', () => {
  // These must stay green through BOTH ablation legs. If they move, the
  // convergence took the whole rule with it and the pins above are reporting on
  // rubble rather than on a re-homed rule.
  it.each(['account', 'parent_deal'])('the drawer still marks %s readonly', (name) => {
    expect(drawerField(name)?.readonly).toBe(true);
  });

  it.each(['lookup', 'master_detail'])('the strip still widens a %s chip', (type) => {
    expect(renderHighlight(type)).toBe('wide');
  });
});

describe('a type outside the family is still NOT reference-bearing — the control', () => {
  // Without this, "converge" would be satisfiable by treating every field as a
  // relation.
  it.each(['title', 'stage'])('the drawer leaves %s editable', (name) => {
    expect(drawerField(name)?.readonly).toBe(false);
  });

  it('the strip leaves a `select` chip narrow', () => {
    expect(renderHighlight('select')).toBe('narrow');
  });
});

describe("`isWide`'s OTHER rule — the long-text display types — did not move", () => {
  // `email` / `url` / `textarea` widen for a different reason (the value does
  // not fit a 9rem column), are this surface's own list, and are deliberately
  // NOT members of the shared family. Pinned so a later sweep cannot absorb
  // them into it without turning this red.
  it.each(['email', 'url', 'textarea'])('a %s chip is still wide', (type) => {
    expect(renderHighlight(type)).toBe('wide');
  });

  it.each(['email', 'url', 'textarea'])('but %s is NOT a family member', (type) => {
    expect(EXPANDABLE_FIELD_TYPES.has(type)).toBe(false);
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
    for (const type of EXPANDABLE_FIELD_TYPES) {
      expect(SPEC_FIELD_TYPES, `'${type}' is not a spec FieldType`).toContain(type);
    }
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

  it('so neither face answers for it any more', () => {
    expect(renderHighlight('reference')).toBe('narrow');
    const drawer = render(
      <RecordDetailDrawer
        open
        onClose={() => {}}
        title="x"
        record={{ id: 'r1', legacy_ref: 'acc-1' }}
        recordId="r1"
        objectName="deal"
        objectSchema={{ fields: { legacy_ref: { type: 'reference', label: 'Legacy' } } }}
        onFieldSave={async () => {}}
      />,
    );
    void drawer;
    expect(
      capturedFields.current.find((f: any) => f.name === 'legacy_ref')?.readonly,
    ).toBe(false);
  });
});
