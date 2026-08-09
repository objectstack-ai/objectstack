// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  resolveSearchFieldResolution,
  resolveSearchFields,
  SEARCH_AUTO_EXCLUDED_FIELDS,
  SEARCH_AUTO_EXCLUDED_TYPES,
  SEARCHABLE_ENUM_TYPES,
  SEARCHABLE_TEXTUAL_TYPES,
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

// ---------------------------------------------------------------------------
// [#6934] The three search type vocabularies stay PAIRWISE DISJOINT.
//
// `autoDefaultFields` tests `SEARCH_AUTO_EXCLUDED_TYPES` immediately before the
// positive `SEARCHABLE_TEXTUAL_TYPES` / `SEARCHABLE_ENUM_TYPES` allow-list. With
// the sets disjoint that guard cannot change an outcome — measured over the full
// field-type domain, deleting it moves not one resolution. It is kept as the
// fail-closed tiebreak (reasons at its site); these tests are what make the
// disjointness a CHECKED fact instead of a coincidence.
//
// Why both halves are here. A type declared in the excluded set AND in a
// positive list is a contradiction that resolves SILENTLY in either shape:
// dropped from the scan with the guard, admitted to the scan — and to the #4254
// ingress allow-list — without it. Neither is a diagnostic the author ever sees.
// These assertions are. The set assertions name the contradiction directly; the
// two resolution assertions below go red on an overlap independently of them,
// and in opposite directions, so no single relaxation can make this pin vacuous.
// ---------------------------------------------------------------------------
describe('[#6934] search type vocabularies are pairwise disjoint', () => {
  const overlap = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
    [...a].filter((t) => b.has(t)).sort();

  it('no type is both auto-excluded and on a positive allow-list', () => {
    expect(
      overlap(SEARCH_AUTO_EXCLUDED_TYPES, SEARCHABLE_TEXTUAL_TYPES),
      'a type cannot be both auto-excluded and searchable-textual',
    ).toEqual([]);
    expect(
      overlap(SEARCH_AUTO_EXCLUDED_TYPES, SEARCHABLE_ENUM_TYPES),
      'a type cannot be both auto-excluded and searchable-enum',
    ).toEqual([]);
  });

  it('the two positive allow-lists share no type either', () => {
    // Not cosmetic: the ENGINE branches on `SEARCHABLE_ENUM_TYPES` FIRST
    // (`fieldClausesForTerm`, objectql `search-filter.ts`), so a type in both
    // would be searched by option-label mapping and never as raw `$contains`.
    expect(
      overlap(SEARCHABLE_TEXTUAL_TYPES, SEARCHABLE_ENUM_TYPES),
      'an enum type is searched by label mapping, a textual one by $contains',
    ).toEqual([]);
  });

  it('every auto-excluded type is REJECTED by the auto-default', () => {
    // Goes red if an overlap resolves the positive way (i.e. if the guard is
    // dropped while the sets intersect).
    for (const t of SEARCH_AUTO_EXCLUDED_TYPES) {
      expect(
        resolveSearchFieldResolution({ fields: { probe: { type: t } } }),
        `'${t}' is auto-excluded but the auto-default admitted it`,
      ).toEqual({ allowed: [], source: 'auto' });
    }
  });

  it('every searchable type is ADMITTED by the auto-default', () => {
    // Goes red if an overlap resolves the negative way (the guard silently
    // dropping a type an author has just declared searchable).
    for (const t of [...SEARCHABLE_TEXTUAL_TYPES, ...SEARCHABLE_ENUM_TYPES]) {
      expect(
        resolveSearchFieldResolution({ fields: { probe: { type: t } } }),
        `'${t}' is declared searchable but the auto-default rejected it`,
      ).toEqual({ allowed: ['probe'], source: 'auto' });
    }
  });
});
