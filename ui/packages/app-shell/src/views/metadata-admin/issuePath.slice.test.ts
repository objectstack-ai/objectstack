// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The slice key a server refusal is held against (objectui#8057), pinned on the
 * EXACT shape the card measured against a real 17.3.0 backend:
 *
 *   PUT /api/v1/meta/object/OBJECT_NAME?mode=draft   →   422
 *   fields.lookup.reference [custom]
 *
 * The host suite (`ResourceEditPage.serverRefusalGate.test.tsx`) drives the
 * gate through the page, but its fixture refuses a path whose value is
 * PRESENT. The measured refusal is the opposite and much commoner case — a
 * missing required key, where the value at the refused path is absent BY
 * DEFINITION, because that absence is why the server refused. That case is what
 * decides the design, so it is pinned here directly rather than left implied.
 */

import { describe, it, expect } from 'vitest';
import { issueSlicePath, issueSliceFingerprint } from './issuePath';

/** The measured document: a Lookup field added with its target left empty. */
const OBJECT_DRAFT = {
  name: 'maint_asset',
  label: 'Asset',
  fields: {
    title: { type: 'text', label: 'Title' },
    lookup: { type: 'lookup', label: 'Owner' },
  },
};

const REFUSED = 'fields.lookup.reference';

describe('issueSlicePath — the PARENT, and why it may not be the path itself', () => {
  it('takes the parent container of the refused path', () => {
    expect(issueSlicePath(REFUSED)).toBe('fields.lookup');
    expect(issueSlicePath('regions.0.components.1.visibleWhen')).toBe('regions.0.components.1');
  });

  it('degrades to the whole document for a root-level or empty path', () => {
    expect(issueSlicePath('label')).toBe('');
    expect(issueSlicePath('')).toBe('');
  });

  it('⭐ the refused path itself is ABSENT — keying on it could never release', () => {
    // This is the whole reason the slice is the parent. The value at
    // `fields.lookup.reference` is undefined before the author fixes anything…
    expect(issueSliceFingerprint(OBJECT_DRAFT, REFUSED)).toBeUndefined();
    // …and still undefined after an edit that does not fix it. Two `undefined`s
    // compare EQUAL, so a block keyed on the path would hold for ever, with no
    // edit able to clear it — a dead-bolt, which is the failure the advisory
    // ruling exists to prevent. The parent, by contrast, is present:
    expect(issueSliceFingerprint(OBJECT_DRAFT, issueSlicePath(REFUSED))).toBeDefined();
  });
});

describe('issueSliceFingerprint — what moves the slice and what does not', () => {
  const slice = issueSlicePath(REFUSED);
  const before = issueSliceFingerprint(OBJECT_DRAFT, slice);

  it('⭐ renaming an UNRELATED already-saved field does not move it', () => {
    // Step 2 of the measured reproduction, at the level that decides it. The
    // author renames `title`; the half-filled lookup is untouched, so the
    // refusal still stands and the document must not be PUT again.
    const renamed = {
      ...OBJECT_DRAFT,
      fields: { ...OBJECT_DRAFT.fields, title: { type: 'text', label: 'Headline' } },
    };
    expect(issueSliceFingerprint(renamed, slice)).toBe(before);
  });

  it('filling the missing target in moves it', () => {
    const fixed = {
      ...OBJECT_DRAFT,
      fields: {
        ...OBJECT_DRAFT.fields,
        lookup: { type: 'lookup', label: 'Owner', reference: 'account' },
      },
    };
    expect(issueSliceFingerprint(fixed, slice)).not.toBe(before);
  });

  it('deleting the offending field outright moves it too', () => {
    // The second real escape, and the one keying on the path itself would lose:
    // `fields.lookup.reference` is undefined before AND after this deletion.
    const { lookup: _dropped, ...rest } = OBJECT_DRAFT.fields;
    const deleted = { ...OBJECT_DRAFT, fields: rest };
    expect(issueSliceFingerprint(deleted, slice)).not.toBe(before);
    expect(issueSliceFingerprint(deleted, slice)).toBeUndefined();
  });

  it('changing the offending field TYPE moves it', () => {
    const retyped = {
      ...OBJECT_DRAFT,
      fields: { ...OBJECT_DRAFT.fields, lookup: { type: 'text', label: 'Owner' } },
    };
    expect(issueSliceFingerprint(retyped, slice)).not.toBe(before);
  });

  it('indexes arrays by numeric segment', () => {
    const doc = { regions: [{ components: [{ id: 'a' }, { id: 'b' }] }] };
    expect(issueSliceFingerprint(doc, 'regions.0.components.1')).toBe('{"id":"b"}');
    expect(issueSliceFingerprint(doc, 'regions.0.components.0')).toBe('{"id":"a"}');
  });

  it('⛔ an unlocatable path is undefined — the FAIL-OPEN signal', () => {
    // Callers must drop these rather than hold them. A sentinel string here
    // would make any two unlocatable paths compare equal, turning the release
    // condition into a block with no exit.
    expect(issueSliceFingerprint(OBJECT_DRAFT, 'nosuchkey.deeper')).toBeUndefined();
    expect(issueSliceFingerprint(OBJECT_DRAFT, 'fields.title.label.tooDeep')).toBeUndefined();
    expect(issueSliceFingerprint(undefined, 'fields.lookup')).toBeUndefined();
  });

  it('an empty slice path fingerprints the whole document', () => {
    expect(issueSliceFingerprint(OBJECT_DRAFT, '')).toBe(JSON.stringify(OBJECT_DRAFT));
  });
});
