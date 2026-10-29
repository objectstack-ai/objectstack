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
 */
import { describe, it, expect } from 'vitest';
import {
  fieldGroupBodyTableRefusal,
  isBodyTableRelationship,
  type NamedInboundRelationship,
} from './related-list-body-table';

describe('isBodyTableRelationship — the verdict table', () => {
  it.each([
    // type, relatedList, inlineEdit → body?
    ['lookup', undefined, undefined, false],
    ['lookup', true, undefined, false],
    ['lookup', false, undefined, false],
    ['lookup', 'primary', undefined, true],
    ['lookup', undefined, 'grid', false],
    ['master_detail', undefined, undefined, false],
    ['master_detail', undefined, false, false],
    ['master_detail', undefined, true, true],
    ['master_detail', undefined, 'grid', true],
    ['master_detail', undefined, 'form', true],
    ['master_detail', 'primary', undefined, true],
    ['master_detail', true, 'grid', false],
    ['master_detail', false, 'grid', false],
    ['text', 'primary', undefined, false],
  ] as const)('%s · relatedList %s · inlineEdit %s → %s', (type, relatedList, inlineEdit, body) => {
    const field: Record<string, unknown> = { type };
    if (relatedList !== undefined) field.relatedList = relatedList;
    if (inlineEdit !== undefined) field.inlineEdit = inlineEdit;
    expect(isBodyTableRelationship(field)).toBe(body);
  });

  it('answers false for a missing field', () => {
    expect(isBodyTableRelationship(undefined)).toBe(false);
    expect(isBodyTableRelationship(null)).toBe(false);
  });
});

describe('fieldGroupBodyTableRefusal — the sentence both surfaces write', () => {
  const side: NamedInboundRelationship = { child: 'task', field: 'lead_id', def: { type: 'lookup' } };
  const hidden: NamedInboundRelationship = { child: 'note', field: 'lead_id', def: { type: 'lookup', relatedList: false } };
  const body: NamedInboundRelationship = { child: 'line', field: 'lead_id', def: { type: 'master_detail', inlineEdit: 'grid' } };

  it('is undefined when every named relationship is a body table, or none is named', () => {
    expect(fieldGroupBodyTableRefusal('lead', 0, 'line', [body])).toBeUndefined();
    expect(fieldGroupBodyTableRefusal('lead', 0, 'nope', [])).toBeUndefined();
  });

  it('names the position, the entry, each FK that is not a body table, and the remedy', () => {
    expect(fieldGroupBodyTableRefusal('lead', 2, 'task', [side])).toBe(
      "Object 'lead' fieldGroups[2].relatedList 'task' names a related list that is not a body table: " +
        "'task.lead_id' is a side card. A field group's relatedList only positions a body table (a FK declaring " +
        "relatedList: 'primary', or a master_detail FK that sets inlineEdit and declares no relatedList), so the " +
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
