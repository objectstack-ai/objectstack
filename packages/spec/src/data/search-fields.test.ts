// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  resolveSearchFieldResolution,
  resolveSearchFields,
  SEARCH_AUTO_EXCLUDED_FIELDS,
} from './search-fields';

// ---------------------------------------------------------------------------
// [#4483] The auto-default's "lead" field ORDERS the set; it must not ADMIT one.
//
// `autoDefaultFields` filters every field through three exclusions, then used to
// prepend the display/name/title field on an EXISTENCE check alone — so the
// exclusions did not hold for whichever field happened to lead. The regression
// this pins is not hypothetical: ADR-0079 designates `nameField` at
// registration, and on a table whose only textual column is the primary key it
// designates `id`, turning `$search` into a substring scan over the PK.
// ---------------------------------------------------------------------------
describe('[#4483] $search auto field set — lead orders, never admits', () => {
  const pkOnly = {
    id: { type: 'text' },
    amount: { type: 'number' },
  };

  it('excludes `id` with no display field (the already-correct baseline)', () => {
    expect(resolveSearchFieldResolution({ fields: pkOnly })).toEqual({
      allowed: [],
      source: 'auto',
    });
  });

  it('a displayField on the exclusion list does NOT re-enter the set', () => {
    // Pre-#4483 this returned `{ allowed: ['id'] }`.
    expect(resolveSearchFieldResolution({ fields: pkOnly, displayField: 'id' })).toEqual({
      allowed: [],
      source: 'auto',
    });
  });

  it('every SEARCH_AUTO_EXCLUDED_FIELDS member stays out even as displayField', () => {
    for (const excluded of SEARCH_AUTO_EXCLUDED_FIELDS) {
      const { allowed } = resolveSearchFieldResolution({
        fields: { [excluded]: { type: 'text' }, title: { type: 'text' } },
        displayField: excluded,
      });
      expect(allowed, `'${excluded}' leaked into the auto set as displayField`).toEqual(['title']);
    }
  });

  it('a hidden display field does not lead and does not enter', () => {
    const { allowed } = resolveSearchFieldResolution({
      fields: { name: { type: 'text', hidden: true }, subject: { type: 'text' } },
      displayField: 'name',
    });
    expect(allowed).toEqual(['subject']);
  });

  it('a display field of an unsearchable TYPE does not enter', () => {
    const { allowed } = resolveSearchFieldResolution({
      fields: { avatar: { type: 'image' }, subject: { type: 'text' } },
      displayField: 'avatar',
    });
    expect(allowed).toEqual(['subject']);
  });

  it('the `name` / `title` bypasses are gated by the same predicate', () => {
    // Both exist but are unsearchable — neither may lead nor enter.
    const { allowed } = resolveSearchFieldResolution({
      fields: {
        name: { type: 'json' },
        title: { type: 'vector' },
        subject: { type: 'text' },
      },
    });
    expect(allowed).toEqual(['subject']);
  });

  it('an ELIGIBLE display field still leads — the ordering intent is intact', () => {
    const { allowed } = resolveSearchFieldResolution({
      fields: {
        code: { type: 'text' },
        subject: { type: 'text' },
        stage: { type: 'select' },
      },
      displayField: 'subject',
    });
    expect(allowed[0]).toBe('subject');
    expect(new Set(allowed)).toEqual(new Set(['subject', 'code', 'stage']));
  });

  it('falls back to `name`, then `title`, for the lead position', () => {
    expect(
      resolveSearchFieldResolution({
        fields: { code: { type: 'text' }, name: { type: 'text' } },
      }).allowed[0],
    ).toBe('name');
    expect(
      resolveSearchFieldResolution({
        fields: { code: { type: 'text' }, title: { type: 'text' } },
      }).allowed[0],
    ).toBe('title');
  });

  it('a declared `searchableFields` list is unaffected by the lead rule', () => {
    // `declared` is the author's explicit choice and bypasses the auto-default
    // entirely — including its exclusions. Pinned so the fix is not read as
    // narrowing the declared path too.
    expect(
      resolveSearchFieldResolution({ fields: pkOnly, searchableFields: ['id'], displayField: 'id' }),
    ).toEqual({ allowed: ['id'], source: 'declared' });
  });

  it('the #4254 ingress gate no longer admits `$searchFields=id`', () => {
    // `resolveSearchFields` intersects the override with `allowed`; with `id`
    // out of `allowed` the override matches nothing and cannot widen the scan.
    expect(resolveSearchFields({ fields: pkOnly, displayField: 'id', requestedFields: 'id' }))
      .toEqual([]);
  });
});
