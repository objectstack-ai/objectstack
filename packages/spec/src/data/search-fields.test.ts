// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  isVirtualSearchField,
  resolveSearchFieldResolution,
  resolveSearchFields,
  SEARCH_AUTO_EXCLUDED_FIELDS,
  SEARCH_AUTO_EXCLUDED_TYPES,
  SEARCH_VIRTUAL_TYPES,
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

// ---------------------------------------------------------------------------
// [#6674] A VIRTUAL field declared in `searchableFields` is not admitted.
//
// The fail-open shape #4254 closed on the unknown-name axis, surviving one axis
// over: a `formula` entry names a REAL field, so the existence filter passed it,
// the declared branch returned it verbatim, and every search against it matched
// nothing — measured 0 rows on driver-memory and 0 rows WITH NO ERROR on
// driver-sql/better-sqlite3, because no driver materializes a column for a value
// that is computed on read.
//
// What is pinned here is the DECIDING face: what a declaration is admitted to
// say. The loud half lives at the two enforcement faces (the #4254 REST ingress
// gate and the linter), which read `isVirtualSearchField` to word their refusal
// from this same judgment.
// ---------------------------------------------------------------------------
describe('[#6674] a virtual field declared in searchableFields', () => {
  const fields = {
    id: { type: 'text' },
    name: { type: 'text' },
    project_name: { type: 'text' },
    project_id: { type: 'lookup' },
    payload: { type: 'json' },
    project_name_formula: { type: 'formula' },
  };

  it('is dropped from the declared allowed set', () => {
    // Before #6674 this returned
    //   { allowed: ['name', 'project_name_formula'], source: 'declared' }
    // — the card's own transcript, admitted verbatim.
    expect(
      resolveSearchFieldResolution({
        fields,
        searchableFields: ['name', 'project_name_formula'],
      }),
    ).toEqual({ allowed: ['name'], source: 'declared' });
  });

  it('CONTROL — the declared branch still bypasses the auto-default exclusions', () => {
    // The dividing line is STORAGE, not search quality. `lookup` and `json` are
    // auto-EXCLUDED types, and declaring them is still the author's choice: the
    // engine runs a `$contains` over the stored foreign key / the stored JSON
    // text. Narrow and rarely useful, but a scan that CAN match — so it must not
    // be swept up by the virtual filter. This control is what keeps #6674 from
    // silently becoming "the declared branch is type-filtered after all", which
    // would reject metadata the runtime accepts (ADR-0072 D1, and the #4830
    // changeset's explicit carve-out).
    expect(
      resolveSearchFieldResolution({
        fields,
        searchableFields: ['project_id', 'payload'],
      }),
    ).toEqual({ allowed: ['project_id', 'payload'], source: 'declared' });
  });

  it('CONTROL — a declaration naming no virtual field is untouched', () => {
    expect(
      resolveSearchFieldResolution({ fields, searchableFields: ['name', 'project_name'] }),
    ).toEqual({ allowed: ['name', 'project_name'], source: 'declared' });
  });

  it('an ALL-virtual declaration falls through to the auto-default', () => {
    // The degenerate case, pinned rather than left to be discovered: the
    // declared list filters to empty and resolution falls through exactly as it
    // has for an all-STALE declaration since #4254. Direction is worth naming —
    // search widens, from "matched nothing, ever" to the auto-default set. It is
    // not left silent: the linter reports the declaration as a build error, and
    // the ingress gate refuses any echoed `$searchFields` naming the entry.
    expect(
      resolveSearchFieldResolution({ fields, searchableFields: ['project_name_formula'] }),
    ).toEqual({ allowed: ['name', 'project_name'], source: 'auto' });
  });

  it('the override intersection can no longer reach a virtual field', () => {
    expect(
      resolveSearchFields({
        fields,
        searchableFields: ['name', 'project_name_formula'],
        requestedFields: 'project_name_formula',
      }),
    ).toEqual(['name']); // empty intersection → the tolerant fallback, never the formula
  });

  it('the auto-default never admitted one (the already-correct baseline)', () => {
    expect(resolveSearchFieldResolution({ fields }).allowed).not.toContain('project_name_formula');
  });
});

describe('[#6674] SEARCH_VIRTUAL_TYPES is a storage fact', () => {
  it('is exactly the driver-virtual set', () => {
    // Mirrors `fieldHasColumn` (driver-sql/src/schema-drift.ts) and
    // driver-turso's "Virtual — no column" skips. A driver growing a second
    // virtual type must widen this deliberately — a silent divergence would put
    // the refusal and the storage rule back out of step, which is the drift
    // #4254 moved this resolution into the spec to prevent.
    expect([...SEARCH_VIRTUAL_TYPES].sort()).toEqual(['formula']);
  });

  it('is disjoint from all three search vocabularies', () => {
    // Same contradiction #6934 pins for the other pairs: a type both virtual and
    // searchable-textual would be admitted to the auto-default AND refused by
    // name, with the outcome decided by evaluation order rather than by a rule.
    const overlap = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
      [...a].filter((t) => b.has(t)).sort();
    expect(overlap(SEARCH_VIRTUAL_TYPES, SEARCHABLE_TEXTUAL_TYPES)).toEqual([]);
    expect(overlap(SEARCH_VIRTUAL_TYPES, SEARCHABLE_ENUM_TYPES)).toEqual([]);
    expect(overlap(SEARCH_VIRTUAL_TYPES, SEARCH_AUTO_EXCLUDED_TYPES)).toEqual([]);
  });

  it('an unreadable type is NOT virtual — unresolvable is not wrong', () => {
    // The lint mirror feeds stub metadata (`{}`) for registry-injected system
    // columns whose real type it cannot see. A stub must survive the filter, or
    // `searchableFields: ['name', 'created_at']` would lose its system entry at
    // resolution time and 400 at the gate (ADR-0072 D1).
    expect(isVirtualSearchField({})).toBe(false);
    expect(isVirtualSearchField(undefined)).toBe(false);
    expect(isVirtualSearchField(null)).toBe(false);
    expect(isVirtualSearchField({ type: 'text' })).toBe(false);
    expect(isVirtualSearchField({ type: 'formula' })).toBe(true);
  });

  it('a declared system column survives the filter via its stub meta', () => {
    expect(
      resolveSearchFieldResolution({
        fields: { name: { type: 'text' }, created_at: {} },
        searchableFields: ['name', 'created_at'],
      }),
    ).toEqual({ allowed: ['name', 'created_at'], source: 'declared' });
  });
});
