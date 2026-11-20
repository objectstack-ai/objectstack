// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27478, ruling B on #27055] The one "is this inbound relationship a body
 * table" predicate, as a verdict table over the FK keys that decide it, and the
 * refusal sentence `defineStack` and `@objectstack/lint` both write.
 *
 * The table is the record page's verdict as it stood before this predicate was
 * extracted (objectui `isMainContentList`), with one cell moved on purpose: a
 * `master_detail` FK that sets `inlineEdit` AND declares `relatedList: true` is
 * a side card, as `relatedList`'s own description says ("write true to keep it
 * a side card"); the page used to draw it as a body table.
 *
 * #35597 moved two more cells, the rule's own change: a `master_detail` FK with
 * no `relatedList` is a body table whatever `inlineEdit` says (absent or
 * `false` used to be a side card). Every `lookup` cell, every explicit
 * `relatedList` cell and every inline-edited cell keeps its verdict.
 *
 * #35889 moved those cells again: a `master_detail` FK with no `relatedList`
 * is a TAB by default, inline-edited or not, and a body table only when a
 * parent field group places it. The set a group may place
 * (`isGroupPlaceableRelationship`) is #35597's body-table set, unchanged, so
 * the refusal still answers the same names.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ObjectFieldGroupSchema } from './object.zod';
import {
  fieldGroupBodyTableRefusal,
  isBodyTableRelationship,
  isGroupPlaceableRelationship,
  type NamedInboundRelationship,
} from './related-list-body-table';

describe('isBodyTableRelationship — the verdict table', () => {
  it.each([
    // type, relatedList, inlineEdit → group may place? · body with no group? · body when a group places it?
    ['lookup', undefined, undefined, false, false, false],
    ['lookup', true, undefined, false, false, false],
    ['lookup', false, undefined, false, false, false],
    ['lookup', 'primary', undefined, true, true, true],
    ['lookup', undefined, 'grid', false, false, false],
    ['master_detail', undefined, undefined, true, false, true],
    ['master_detail', undefined, false, true, false, true],
    ['master_detail', undefined, true, true, false, true],
    ['master_detail', undefined, 'grid', true, false, true],
    ['master_detail', undefined, 'form', true, false, true],
    ['master_detail', 'primary', undefined, true, true, true],
    ['master_detail', true, undefined, false, false, false],
    ['master_detail', false, undefined, false, false, false],
    ['master_detail', true, 'grid', false, false, false],
    ['master_detail', false, 'grid', false, false, false],
    ['text', 'primary', undefined, false, false, false],
  ] as const)('%s · relatedList %s · inlineEdit %s → placeable %s · body %s · body when placed %s', (type, relatedList, inlineEdit, placeable, body, placedBody) => {
    const field: Record<string, unknown> = { type };
    if (relatedList !== undefined) field.relatedList = relatedList;
    if (inlineEdit !== undefined) field.inlineEdit = inlineEdit;
    expect(isGroupPlaceableRelationship(field)).toBe(placeable);
    expect(isBodyTableRelationship(field)).toBe(body);
    expect(isBodyTableRelationship(field, { placedByGroup: false })).toBe(body);
    expect(isBodyTableRelationship(field, { placedByGroup: true })).toBe(placedBody);
  });

  it('answers false for a missing field', () => {
    expect(isBodyTableRelationship(undefined)).toBe(false);
    expect(isBodyTableRelationship(null, { placedByGroup: true })).toBe(false);
    expect(isGroupPlaceableRelationship(undefined)).toBe(false);
  });
});

describe('fieldGroupBodyTableRefusal — the sentence both surfaces write', () => {
  const side: NamedInboundRelationship = { child: 'task', field: 'lead_id', def: { type: 'lookup' } };
  const hidden: NamedInboundRelationship = { child: 'note', field: 'lead_id', def: { type: 'lookup', relatedList: false } };
  const body: NamedInboundRelationship = { child: 'line', field: 'lead_id', def: { type: 'master_detail', inlineEdit: 'grid' } };
  // #35597 / #35889: a group may place a plain master_detail (no inlineEdit, no relatedList).
  const plainOwned: NamedInboundRelationship = { child: 'step', field: 'lead_id', def: { type: 'master_detail' } };

  it('is undefined when a group may place every named relationship, or none is named', () => {
    expect(fieldGroupBodyTableRefusal('lead', 0, 'line', [body])).toBeUndefined();
    expect(fieldGroupBodyTableRefusal('lead', 0, 'step', [plainOwned])).toBeUndefined();
    expect(fieldGroupBodyTableRefusal('lead', 0, 'nope', [])).toBeUndefined();
  });

  it('names the position, the entry, each FK that is not a body table, and the remedy', () => {
    expect(fieldGroupBodyTableRefusal('lead', 2, 'task', [side])).toBe(
      "Object 'lead' fieldGroups[2].relatedList 'task' names a related list that is not a body table: " +
        "'task.lead_id' is a side card. A field group's relatedList only places a body table (a FK declaring " +
        "relatedList: 'primary', or a master_detail FK that declares no relatedList, which the group makes one), so the " +
        "record page draws nothing at the group for any other list. Set relatedList: 'primary' on that FK, or " +
        "remove the group's relatedList.",
    );
    expect(fieldGroupBodyTableRefusal('lead', 0, 'note', [hidden])).toContain("'note.lead_id' is hidden (relatedList: false)");
  });

  it('points a mixed bare name at object.field for its body tables', () => {
    const msg = fieldGroupBodyTableRefusal('lead', 0, 'event', [
      { ...side, child: 'event', field: 'who_id' },
      { ...hidden, child: 'event', field: 'what_id' },
      { ...body, child: 'event', field: 'related_to' },
    ]);
    expect(msg).toContain("'event.who_id' is a side card, 'event.what_id' is hidden (relatedList: false).");
    expect(msg).toContain("Set relatedList: 'primary' on those FKs, name only the body table as object.field ('event.related_to'), or remove");
  });
});

describe('fieldGroups[i].relatedList describes the body-table rule it enforces', () => {
  const root = z.toJSONSchema(ObjectFieldGroupSchema as z.ZodType, { unrepresentable: 'any', io: 'input' }) as {
    properties?: Record<string, { description?: string }>;
  };
  const text = root.properties?.relatedList?.description ?? '';

  it('says it names a body table only, and that any other list is refused with the remedy', () => {
    expect(text).toContain("It names a body table only (a FK declaring relatedList: 'primary', or a master_detail FK that declares no relatedList, which is a tab unless a group places it; placed, it is drawn here and carried by the entry form at the same position)");
    expect(text).toContain('a group naming a side card or a list hidden by relatedList: false draws nothing, so it is refused');
    expect(text).toContain("set relatedList: 'primary' on it, name only the body table as object.field when a bare child name also names a side card, or remove the group's relatedList");
  });

  it('no longer says relatedList: false still hides a placed table', () => {
    expect(text).not.toContain('still hides the table');
  });
});
