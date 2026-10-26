/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11630 — a field group's `visibleWhen` reaches `record:details`
 * through the spec's own `{ group }` reference, never as a key on an
 * enumerated section.
 *
 * `@objectstack/spec`'s `RecordDetailsProps.sections[]` is strict: it declares
 * `group` (which inherits the group's members and presentation, `visibleWhen`
 * included) and `fields` as bare names, and it refuses `visibleWhen` on parse.
 * So the synthesizer writes a page in that vocabulary, and the predicate
 * travels to the renderer beside the resolved section
 * (`deriveFieldGroupDetailEntries`), not on it. The renderer's evaluation is
 * pinned beside it (`renderers/__tests__/record-details.groupVisibleWhen-11630.test.tsx`);
 * this file pins the published shape and its legality.
 *
 * ## The legality pin is a two-control reading
 *
 * "The synthesized node parses" is only a reading if the same parser refuses
 * the shapes route B replaced. So the parse leg runs the installed
 * `RecordDetailsProps` over the synthesized node AND over the two retired
 * shapes — an enumerated section carrying `visibleWhen`, and an enumerated
 * section carrying rich field descriptors — and expects exactly those two to be
 * refused, at the key that makes them illegal.
 */

import { describe, it, expect } from 'vitest';
import { RecordDetailsProps } from '@objectstack/spec/ui';
import {
  buildDefaultDetails,
  buildDefaultPageSchema,
  deriveFieldGroupDetailEntries,
  deriveFieldGroupDetailSections,
  resolveDetailSections,
  type ObjectDefLike,
} from '../buildDefaultPageSchema';

const ENVELOPE = { dialect: 'cel', source: "record.kind == 'pro'" };
const BARE = "record.kind == 'pro'";

const defWith = (visibleWhen: unknown): ObjectDefLike => ({
  name: 'qa_group_gate4',
  fields: {
    kind: { name: 'kind', label: 'Kind', type: 'text' },
    tier: { name: 'tier', label: 'Tier', type: 'select', options: [{ value: 'gold', label: 'Gold' }] },
    pro_a: { name: 'pro_a', label: 'Pro A', type: 'text', group: 'pro' },
    notes: { name: 'notes', label: 'Notes', type: 'text', group: 'general' },
  },
  fieldGroups: [
    { key: 'general', label: 'General' },
    // Cast: `ObjectDefLike.fieldGroups` is the spec's typed group, and this
    // fixture feeds both the bare-string and the envelope spelling through it.
    { key: 'pro', label: 'Pro details', ...(visibleWhen !== undefined ? { visibleWhen } : {}) } as never,
  ],
});

/** The parse issues, one readable line each — the failure output IS the refusal. */
function issuesOf(value: unknown): string[] {
  const r = RecordDetailsProps.safeParse(value);
  if (r.success) return [];
  return r.error.issues.map(
    (i) => `${i.code} @ ${i.path.join('.')}${'keys' in i ? ` [${(i as { keys: string[] }).keys.join(',')}]` : ''}`,
  );
}

describe('the synthesized record:details body references groups (objectui#11630)', () => {
  it('each declared group is a `{ group, columns }` reference; the ungrouped bucket lists bare names', () => {
    const sections = resolveDetailSections(defWith(ENVELOPE))!;
    const columns = sections[0].columns;
    expect(sections).toEqual([
      { group: 'general', columns },
      { group: 'pro', columns },
      { columns, fields: ['kind', 'tier'] },
    ]);
  });

  it('no section the page writes carries `visibleWhen` or a field object, on either spelling', () => {
    for (const visibleWhen of [ENVELOPE, BARE]) {
      const node = buildDefaultDetails(defWith(visibleWhen));
      for (const section of node.properties.sections) {
        expect('visibleWhen' in section).toBe(false);
        for (const field of section.fields ?? []) expect(typeof field).toBe('string');
      }
    }
  });

  it('the synthesized node parses as RecordDetailsProps — and the same parser refuses the two retired shapes', () => {
    const node = buildDefaultDetails(defWith(ENVELOPE));
    expect(issuesOf(node.properties)).toEqual([]);
    // The same page carried by `buildDefaultPageSchema`, as Studio's page-create
    // seeds it, is that node.
    const page = buildDefaultPageSchema(defWith(ENVELOPE));
    const tabs = page.regions[0].components.find((c: any) => c.type === 'page:tabs');
    const details = tabs.properties.items[0].children[0];
    expect(details.type).toBe('record:details');
    expect(issuesOf(details.properties)).toEqual([]);

    // Controls: the instrument CAN refuse, and refuses for the reason named.
    expect(issuesOf({ sections: [{ name: 'pro', label: 'Pro details', fields: ['pro_a'], visibleWhen: BARE }] }))
      .toEqual(['unrecognized_keys @ sections.0 [visibleWhen]']);
    expect(issuesOf({ sections: [{ name: 'pro', label: 'Pro details', fields: [{ name: 'pro_a', label: 'Pro A' }] }] }))
      .toEqual(['invalid_type @ sections.0.fields.0']);
  });
});

describe('the group predicate travels beside the resolved section, not on it (objectui#11630)', () => {
  it('deriveFieldGroupDetailEntries carries both spellings verbatim, beside the section', () => {
    const byKey = (visibleWhen: unknown) =>
      new Map(deriveFieldGroupDetailEntries(defWith(visibleWhen))!.map((e) => [e.key, e]));
    expect(byKey(ENVELOPE).get('pro')!.visibleWhen).toEqual(ENVELOPE);
    expect(byKey(BARE).get('pro')!.visibleWhen).toBe(BARE);
    expect('visibleWhen' in byKey(ENVELOPE).get('pro')!.section).toBe(false);
  });

  it('an ungated group and the ungrouped bucket carry no predicate', () => {
    const entries = deriveFieldGroupDetailEntries(defWith(ENVELOPE))!;
    expect('visibleWhen' in entries.find((e) => e.key === 'general')!).toBe(false);
    const bucket = entries.find((e) => e.key === undefined)!;
    expect('visibleWhen' in bucket).toBe(false);
  });

  it('the public deriveFieldGroupDetailSections is the resolved sections, with no predicate on any of them', () => {
    const sections = deriveFieldGroupDetailSections(defWith(ENVELOPE))!;
    expect(sections).toEqual(deriveFieldGroupDetailEntries(defWith(ENVELOPE))!.map((e) => e.section));
    expect(sections.some((s) => 'visibleWhen' in s)).toBe(false);
  });
});
