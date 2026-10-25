/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ViewTypeSchema } from '@object-ui/types/zod';
import {
  normalizeListViewSchema,
  rowHeightToDensityMode,
  isListViewVisualization,
  DENSITY_MODE_TO_ROW_HEIGHT,
  ROW_HEIGHT_TO_DENSITY_MODE,
} from '../normalize-list-view.js';

describe('normalizeListViewSchema (#2890)', () => {
  describe('fields → columns', () => {
    it('folds the legacy `fields` into the spec-canonical `columns`', () => {
      const out = normalizeListViewSchema({ type: 'list-view', viewType: 'grid', fields: ['name', 'stage'] });
      expect(out).toEqual({ type: 'list-view', viewType: 'grid', columns: ['name', 'stage'] });
    });

    it('drops the legacy key so a missed read-site fails loudly instead of taking the legacy path', () => {
      const out = normalizeListViewSchema({ viewType: 'grid', fields: ['name'] }) as Record<string, unknown>;
      expect('fields' in out).toBe(false);
    });

    it('lets the canonical key win when a payload carries both', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        columns: ['canonical'],
        fields: ['legacy'],
      }) as Record<string, unknown>;
      expect(out.columns).toEqual(['canonical']);
      expect('fields' in out).toBe(false);
    });

    it('preserves ListColumn object entries, not just string columns', () => {
      const columns = [{ field: 'name', label: 'Name', width: 200 }];
      const out = normalizeListViewSchema({ viewType: 'grid', columns }) as Record<string, unknown>;
      expect(out.columns).toBe(columns);
    });

    it('folds an empty `fields` array (an explicitly empty column set is not "absent")', () => {
      const out = normalizeListViewSchema({ viewType: 'grid', fields: [] }) as Record<string, unknown>;
      expect(out.columns).toEqual([]);
    });

    it('ignores a non-array `fields` — malformed metadata must not become a column set', () => {
      const out = normalizeListViewSchema({ viewType: 'grid', fields: 'name' }) as Record<string, unknown>;
      expect(out.columns).toBeUndefined();
      expect(out.fields).toBe('name');
    });

    it('is idempotent', () => {
      const once = normalizeListViewSchema({ viewType: 'grid', fields: ['name'] });
      const twice = normalizeListViewSchema(once);
      expect(twice).toEqual(once);
      expect(twice).toBe(once); // nothing left to fold → same reference
    });
  });

  describe('densityMode → rowHeight', () => {
    it('folds the legacy `densityMode` into the spec-canonical `rowHeight`', () => {
      const out = normalizeListViewSchema({ viewType: 'grid', densityMode: 'spacious' }) as Record<string, unknown>;
      expect(out.rowHeight).toBe('tall');
      expect('densityMode' in out).toBe(false);
    });

    it('lets the canonical key win when a view carries both', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        rowHeight: 'extra_tall',
        densityMode: 'compact',
      }) as Record<string, unknown>;
      expect(out.rowHeight).toBe('extra_tall');
      expect('densityMode' in out).toBe(false);
    });

    it('leaves an unrecognized density value alone rather than inventing a row height', () => {
      const out = normalizeListViewSchema({ viewType: 'grid', densityMode: 'cozy' }) as Record<string, unknown>;
      expect(out.rowHeight).toBeUndefined();
      expect(out.densityMode).toBe('cozy');
    });

    // objectui#10868 — the fold's membership test is an OWN-key test, the same
    // trap `rowHeightToDensityMode` guards in the read direction: `in` walks the
    // prototype chain, so `'toString'` used to fold to `Object.prototype.toString`
    // (a FUNCTION in `rowHeight`) and the key was dropped. An inherited key is
    // an unrecognized density like `'cozy'`, and gets exactly its treatment.
    it.each(['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__'])(
      'does not read the inherited Object.prototype key %j as a density',
      (inherited) => {
        const out = normalizeListViewSchema({ densityMode: inherited }) as Record<string, unknown>;
        expect(out.rowHeight).toBeUndefined();
        expect(out.densityMode).toBe(inherited);
        // With a canonical `viewType` there is nothing else to fold, so the
        // input comes back by reference: the density fold did not fire.
        const canonical = { viewType: 'grid', densityMode: inherited };
        expect(normalizeListViewSchema(canonical)).toBe(canonical);
      },
    );

    it('keeps the unrecognized-density CONTROL and the recognized fold beside the inherited keys', () => {
      // `'cozy'` was already unfolded before the own-key test; `'compact'` is an
      // own key of the table and still folds. Both hold on either side of it.
      const cozy = normalizeListViewSchema({ densityMode: 'cozy' }) as Record<string, unknown>;
      expect(cozy.rowHeight).toBeUndefined();
      expect(cozy.densityMode).toBe('cozy');
      const compact = normalizeListViewSchema({ densityMode: 'compact' }) as Record<string, unknown>;
      expect(compact.rowHeight).toBe('compact');
      expect('densityMode' in compact).toBe(false);
    });

    it('round-trips every density through the widening and back', () => {
      // The fold widens 3 values onto 5 and the renderer narrows them back, so
      // a folded view must render the density the author picked.
      for (const mode of ['compact', 'comfortable', 'spacious'] as const) {
        expect(ROW_HEIGHT_TO_DENSITY_MODE[DENSITY_MODE_TO_ROW_HEIGHT[mode]]).toBe(mode);
      }
    });

    it('narrows every spec row height onto a density the toolbar can show', () => {
      for (const height of ['compact', 'short', 'medium', 'tall', 'extra_tall'] as const) {
        expect(['compact', 'comfortable', 'spacious']).toContain(ROW_HEIGHT_TO_DENSITY_MODE[height]);
      }
    });
  });

  describe('filters → filter', () => {
    it('folds the legacy `filters` into the spec-canonical `filter`', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        filters: [['stage', '=', 'won']],
      }) as Record<string, unknown>;
      expect(out.filter).toEqual([['stage', '=', 'won']]);
      expect('filters' in out).toBe(false);
    });

    it('lets the canonical key win when a view carries both', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        filter: [['stage', '=', 'won']],
        filters: [['stage', '=', 'lost']],
      }) as Record<string, unknown>;
      expect(out.filter).toEqual([['stage', '=', 'won']]);
      expect('filters' in out).toBe(false);
    });

    it('preserves the value verbatim — the fold renames the key, it does not convert the format', () => {
      // Both keys carry an ObjectQL FilterNode array in objectui, including the
      // compound `['and', …]` form. Rewriting it here would change what reaches
      // the data source.
      const filters = ['and', ['stage', '=', 'won'], ['amount', '>', 100]];
      const out = normalizeListViewSchema({ viewType: 'grid', filters }) as Record<string, unknown>;
      expect(out.filter).toBe(filters);
    });

    it('ignores a non-array `filters`', () => {
      const out = normalizeListViewSchema({ viewType: 'grid', filters: 'stage == "won"' }) as Record<string, unknown>;
      expect(out.filter).toBeUndefined();
      expect(out.filters).toBe('stage == "won"');
    });
  });

  describe('show* → userActions', () => {
    it('folds every legacy toolbar flag onto its userActions key', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        showSearch: false,
        showSort: false,
        showFilters: false,
        showDensity: false,
        showGroup: false,
        showHideFields: true,
        showColor: true,
      }) as Record<string, unknown>;
      expect(out.userActions).toEqual({
        search: false,
        sort: false,
        filter: false,
        rowHeight: false,
        group: false,
        hideFields: true,
        rowColor: true,
      });
      for (const flag of ['showSearch', 'showSort', 'showFilters', 'showDensity', 'showGroup', 'showHideFields', 'showColor']) {
        expect(flag in out).toBe(false);
      }
    });

    it('merges into an existing userActions instead of replacing it', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        userActions: { search: false, editInline: true },
        showGroup: false,
      }) as Record<string, unknown>;
      expect(out.userActions).toEqual({ search: false, editInline: true, group: false });
    });

    it('lets the canonical key win per-flag when both are present', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        userActions: { search: true },
        showSearch: false,
        showSort: false,
      }) as Record<string, unknown>;
      // `search` stays canonical-true; `sort` folds in from the legacy flag.
      expect(out.userActions).toEqual({ search: true, sort: false });
    });

    it('applies no defaults — an absent flag stays absent', () => {
      // The defaults are per-toggle and live in the renderer; baking them in
      // here would turn "unset" into "explicitly on" and defeat the merge above.
      const out = normalizeListViewSchema({ viewType: 'grid', showGroup: false }) as Record<string, unknown>;
      expect(out.userActions).toEqual({ group: false });
    });

    it('ignores a non-boolean flag', () => {
      const out = normalizeListViewSchema({ viewType: 'grid', showSearch: 'yes' }) as Record<string, unknown>;
      expect(out.userActions).toBeUndefined();
      expect(out.showSearch).toBe('yes');
    });

    it('folds `showDescription` into `appearance`', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        appearance: { allowedVisualizations: ['grid'] },
        showDescription: false,
      }) as Record<string, unknown>;
      expect(out.appearance).toEqual({ allowedVisualizations: ['grid'], showDescription: false });
      expect('showDescription' in out).toBe(false);
    });
  });

  describe('aria / sharing → the spec sub-shapes', () => {
    it('folds the legacy ARIA spellings onto the spec AriaProps keys', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        aria: { label: 'Accounts', describedBy: 'hint', live: 'polite' },
      }) as Record<string, unknown>;
      expect(out.aria).toEqual({ ariaLabel: 'Accounts', ariaDescribedBy: 'hint', live: 'polite' });
    });

    it('keeps `role` and lets the canonical spellings win', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        aria: { ariaLabel: 'canonical', label: 'legacy', role: 'grid' },
      }) as Record<string, unknown>;
      expect(out.aria).toEqual({ ariaLabel: 'canonical', role: 'grid' });
    });

    it('collapses the visibility audience onto the spec ownership type', () => {
      // Only `private` is personal; every wider audience is collaborative.
      for (const [visibility, type] of Object.entries({
        private: 'personal',
        team: 'collaborative',
        organization: 'collaborative',
        public: 'collaborative',
      })) {
        const out = normalizeListViewSchema({ viewType: 'grid', sharing: { visibility } }) as Record<string, unknown>;
        expect(out.sharing).toEqual({ type });
      }
    });

    it('maps a bare `enabled: true` to `personal` — the badge it used to render', () => {
      const out = normalizeListViewSchema({ viewType: 'grid', sharing: { enabled: true } }) as Record<string, unknown>;
      expect(out.sharing).toEqual({ type: 'personal' });
    });

    it('leaves `enabled: false` without a type, so the share badge stays hidden', () => {
      const out = normalizeListViewSchema({ viewType: 'grid', sharing: { enabled: false } }) as Record<string, unknown>;
      expect(out.sharing).toEqual({});
    });

    it('preserves `lockedBy` and lets an explicit `type` win over `visibility`', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        sharing: { type: 'collaborative', visibility: 'private', lockedBy: 'u1' },
      }) as Record<string, unknown>;
      expect(out.sharing).toEqual({ type: 'collaborative', lockedBy: 'u1' });
    });
  });

  describe('viewType defaulting', () => {
    it('defaults a missing view kind to the renderable `grid`', () => {
      expect(normalizeListViewSchema({ type: 'list-view' })).toEqual({ type: 'list-view', viewType: 'grid' });
    });

    it('maps the view CATEGORY `list` to `grid` (AI-authored metadata stores `list`)', () => {
      const out = normalizeListViewSchema({ viewType: 'list' }) as Record<string, unknown>;
      expect(out.viewType).toBe('grid');
    });

    it('leaves an explicit renderable kind alone', () => {
      const out = normalizeListViewSchema({ viewType: 'kanban' }) as Record<string, unknown>;
      expect(out.viewType).toBe('kanban');
    });
  });

  describe('per-view-type config aliases are NOT folded (objectui#6152 round 14)', () => {
    // #2890's phase-3 carry-over folded `kanban.groupField` / `cardFields`,
    // `gallery.imageField` and `timeline.dateField` onto their spec keys here,
    // and eleven cases pinned that fold. objectui#6152 round 14 retired it with
    // every renderer-side reader of the four: each list-view door refuses them
    // by name, so a stored block that still carries one passes through this
    // boundary untouched and binds nothing downstream. Re-judged then: the
    // cases whose subject was the fold were replaced by the two below; the
    // boundary cases that never depended on it stay.

    /** The nested per-view config off a normalized schema, as a plain bag. */
    const cfg = (out: unknown, key: string): Record<string, unknown> =>
      (out as Record<string, unknown>)[key] as Record<string, unknown>;

    it('passes each of the four aliases through untouched, beside the canonical key', () => {
      const kanban = { groupByField: 'canonical', groupField: 'legacy', columns: ['canonical'], cardFields: ['legacy'] };
      const gallery = { coverField: 'canonical', imageField: 'legacy' };
      const timeline = { startDateField: 'canonical', dateField: 'legacy' };
      const out = normalizeListViewSchema({ viewType: 'grid', kanban, gallery, timeline });
      expect(cfg(out, 'kanban')).toEqual(kanban);
      expect(cfg(out, 'gallery')).toEqual(gallery);
      expect(cfg(out, 'timeline')).toEqual(timeline);
    });

    it('returns a view whose ONLY legacy vocabulary is a nested alias by reference', () => {
      // The early return's per-view term retired with the fold: every top-level
      // key here is canonical, so there is nothing left to do.
      const schema = {
        type: 'list-view',
        viewType: 'kanban',
        columns: ['name'],
        kanban: { groupField: 'stage' },
        gallery: { imageField: 'logo' },
        timeline: { dateField: 'due' },
      };
      expect(normalizeListViewSchema(schema)).toBe(schema);
    });

    it('CONTROL: a fold that still runs leaves the nested blocks as written', () => {
      // `fields` → `columns` still folds, so this schema is copied rather than
      // returned by reference, and the per-view blocks ride the copy unchanged.
      const kanban = { groupField: 'stage', swimlaneField: 'owner' };
      const out = normalizeListViewSchema({ viewType: 'grid', fields: ['name'], kanban }) as Record<string, unknown>;
      expect(out.columns).toEqual(['name']);
      expect(cfg(out, 'kanban')).toEqual({ groupField: 'stage', swimlaneField: 'owner' });
    });

    it('leaves `calendar.defaultView` alone', () => {
      // Never folded: no spec counterpart on a list view's calendar block. Since
      // objectui#6152 round 11 the doors refuse it, and since round 14 no
      // renderer lifts it either.
      const out = normalizeListViewSchema({
        viewType: 'calendar',
        calendar: { startDateField: 'starts_at', defaultView: 'week' },
      });
      expect(cfg(out, 'calendar')).toEqual({ startDateField: 'starts_at', defaultView: 'week' });
    });

    it('does not reach into the legacy `options.*` twin', () => {
      // `options` is the stored bag, merged UNDER `schema.kanban` by ListView.
      // Stated as a test so the boundary is deliberate, not accidental.
      const out = normalizeListViewSchema({
        viewType: 'grid',
        options: { kanban: { groupField: 'stage' } },
      });
      expect(cfg(cfg(out, 'options'), 'kanban') as unknown).toEqual({ groupField: 'stage' });
    });

    it('returns the input by reference when every nested config is canonical', () => {
      const schema = {
        type: 'list-view',
        viewType: 'grid',
        columns: ['name'],
        kanban: { groupByField: 'stage', columns: ['name'] },
        gallery: { coverField: 'logo' },
        timeline: { startDateField: 'due' },
      };
      expect(normalizeListViewSchema(schema)).toBe(schema);
    });

    it('ignores a non-object per-view config', () => {
      const schema = { type: 'list-view', viewType: 'grid', columns: ['name'], kanban: 'nonsense' };
      expect(normalizeListViewSchema(schema)).toBe(schema);
    });
  });

  describe("data: { provider: 'object', object } \u2192 objectName (#7477)", () => {
    it('folds the object provider\'s `object` onto `objectName`', () => {
      const out = normalizeListViewSchema({
        type: 'list-view',
        viewType: 'grid',
        data: { provider: 'object', object: 'crm_task' },
      }) as Record<string, unknown>;
      expect(out.objectName).toBe('crm_task');
    });

    it('KEEPS `data` — unlike every other fold here, and deliberately', () => {
      // `data` is not a legacy alias with one meaning: it has more providers
      // than `object`, `value` is read live in ListView, and the whole block is
      // forwarded to child views whose own `getDataConfig` reads it BEFORE
      // `objectName`. Deleting it for one provider would rewrite what a child
      // resolves. See the note on `normalizeListViewSchema`.
      const data = { provider: 'object', object: 'crm_task' };
      const out = normalizeListViewSchema({ viewType: 'grid', data }) as Record<string, unknown>;
      expect(out.data).toEqual(data);
    });

    it('lets an existing `objectName` win — the fold only ever fills a gap', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        objectName: 'crm_task',
        data: { provider: 'object', object: 'crm_other' },
      }) as Record<string, unknown>;
      expect(out.objectName).toBe('crm_task');
    });

    it('treats an EMPTY `objectName` as absent', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        objectName: '',
        data: { provider: 'object', object: 'crm_task' },
      }) as Record<string, unknown>;
      expect(out.objectName).toBe('crm_task');
    });

    it.each(['api', 'value', 'schema'])('ignores the `%s` provider', (provider) => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        data: { provider, object: 'crm_task' },
      }) as Record<string, unknown>;
      expect(out.objectName).toBeUndefined();
    });

    it('invents no binding from an object provider that names no object', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        data: { provider: 'object' },
      }) as Record<string, unknown>;
      expect(out.objectName).toBeUndefined();
    });

    it.each<[unknown, string]>([['', 'empty string'], [42, 'number'], [null, 'null']])(
      'ignores an `object` that is not a non-empty string (%s — %s)',
      (object) => {
        const out = normalizeListViewSchema({
          viewType: 'grid',
          data: { provider: 'object', object },
        }) as Record<string, unknown>;
        expect(out.objectName).toBeUndefined();
      },
    );

    it('ignores a `data` that is an ARRAY (the inline-rows shorthand)', () => {
      const out = normalizeListViewSchema({
        viewType: 'grid',
        data: [{ id: '1' }],
      }) as Record<string, unknown>;
      expect(out.objectName).toBeUndefined();
    });

    it('is idempotent', () => {
      const once = normalizeListViewSchema({
        viewType: 'grid',
        data: { provider: 'object', object: 'crm_task' },
      });
      const twice = normalizeListViewSchema(once);
      expect(twice).toEqual(once);
      expect(twice).toBe(once); // objectName now present ⇒ nothing left to fold
    });
  });

  describe('the author\'s view kind — `specType`, then `type` (#7477)', () => {
    it('reads `specType`, where the react-page wrapper parks an author `type`', () => {
      // The card's criterion: `type="kanban"` with no `viewType` must not be
      // forced to `grid`.
      const out = normalizeListViewSchema({
        type: 'list-view',
        specType: 'kanban',
      }) as Record<string, unknown>;
      expect(out.viewType).toBe('kanban');
    });

    it("reads `specType` over the view CATEGORY `'list'` too", () => {
      const out = normalizeListViewSchema({ viewType: 'list', specType: 'calendar' }) as Record<string, unknown>;
      expect(out.viewType).toBe('calendar');
    });

    it('lets an explicit renderable `viewType` win', () => {
      const out = normalizeListViewSchema({ viewType: 'gallery', specType: 'kanban' }) as Record<string, unknown>;
      expect(out.viewType).toBe('gallery');
    });

    it('reads a bare `type` when it names a kind ListView draws', () => {
      // The spec spells the view kind `type`; on a SchemaNode that key is the
      // component discriminator, which is why `specType` exists at all. A
      // stored view handed straight to the block still carries the spec word.
      const out = normalizeListViewSchema({ type: 'timeline' }) as Record<string, unknown>;
      expect(out.viewType).toBe('timeline');
    });

    it('prefers `specType` to a bare `type`', () => {
      const out = normalizeListViewSchema({ type: 'gantt', specType: 'map' }) as Record<string, unknown>;
      expect(out.viewType).toBe('map');
    });

    it("does NOT read the component discriminator as a kind", () => {
      // The control that keeps the `type` leg above from swallowing the
      // envelope: `list-view` is a tag, never a visualization.
      const out = normalizeListViewSchema({ type: 'list-view' }) as Record<string, unknown>;
      expect(out.viewType).toBe('grid');
    });

    it('falls back to `grid` for a kind ListView does not draw', () => {
      // `detail` is a different renderer; `donut` is a chart family. Neither is
      // written through to `viewType` — the caller\'s default is the honest
      // answer, exactly as `normalizeChartSchema` treats a family it cannot draw.
      expect((normalizeListViewSchema({ specType: 'detail' }) as Record<string, unknown>).viewType).toBe('grid');
      expect((normalizeListViewSchema({ specType: 'donut' }) as Record<string, unknown>).viewType).toBe('grid');
    });

    it('does not read a prototype key as a view kind', () => {
      // `in` walks the prototype chain — the trap `rowHeightToDensityMode`
      // documents. `hasOwnProperty` is why these stay `grid`.
      expect((normalizeListViewSchema({ specType: 'toString' }) as Record<string, unknown>).viewType).toBe('grid');
      expect((normalizeListViewSchema({ specType: 'constructor' }) as Record<string, unknown>).viewType).toBe('grid');
    });

    it('KEEPS `specType` — the fold is a READ, not a rename', () => {
      // `specType` is the react tier\'s rescue slot for an author `type`, shared
      // with the other blocks that read it (`normalizeChartSchema`). It is not
      // an objectui alias being retired, so nothing deletes it.
      const out = normalizeListViewSchema({ specType: 'kanban' }) as Record<string, unknown>;
      expect(out.specType).toBe('kanban');
    });
  });

  describe('reference stability', () => {
    it('returns the input by reference when there is nothing to fold', () => {
      // Load-bearing: ListView memoizes on this identity, so allocating a fresh
      // object on every render would re-run every downstream useMemo.
      const schema = { type: 'list-view', viewType: 'grid', columns: ['name'] };
      expect(normalizeListViewSchema(schema)).toBe(schema);
    });

    it('does not mutate the input when it does fold', () => {
      const schema = { viewType: 'grid', fields: ['name'] };
      normalizeListViewSchema(schema);
      expect(schema).toEqual({ viewType: 'grid', fields: ['name'] });
    });

    it('tolerates non-object input', () => {
      expect(normalizeListViewSchema(null)).toBeNull();
      expect(normalizeListViewSchema(undefined)).toBeUndefined();
      expect(normalizeListViewSchema('list-view')).toBe('list-view');
    });
  });
});

describe('rowHeightToDensityMode (#4440)', () => {
  describe('the five spec row heights — the mapping itself, unchanged', () => {
    it.each([
      ['compact', 'compact'],
      ['short', 'compact'],
      ['medium', 'comfortable'],
      ['tall', 'spacious'],
      ['extra_tall', 'spacious'],
    ] as const)('maps the spec row height %s to %s', (rowHeight, density) => {
      expect(rowHeightToDensityMode(rowHeight)).toBe(density);
    });
  });

  describe('off-spec input — abstain, do not rehabilitate', () => {
    // The retired branch answered `'comfortable'` here, while
    // `@object-ui/react`'s spec bridge answered "no density at all" for the
    // same string after #4352 (PR #4439). One metadata-driven system, two
    // answers for one input, was #4440; this is the surviving answer.
    it.each([
      'comfortable', // the OUTPUT vocabulary, never a spec row height
      'spacious',
      'small',
      'large',
      'gargantuan', // a string in neither vocabulary
      '',
    ])('gives no density for the off-spec rowHeight %j', (rowHeight) => {
      expect(rowHeightToDensityMode(rowHeight)).toBeUndefined();
    });

    it('gives no density for non-string metadata', () => {
      // Stored view definitions reach this function from a database that
      // TypeScript never saw, so the runtime guard is load-bearing, not
      // decoration: `ListViewSchema.rowHeight` is statically `RowHeight`.
      for (const value of [undefined, null, 42, true, {}, ['medium']]) {
        expect(rowHeightToDensityMode(value)).toBeUndefined();
      }
    });

    it('does not answer for an inherited Object.prototype key', () => {
      expect(rowHeightToDensityMode('toString')).toBeUndefined();
      expect(rowHeightToDensityMode('constructor')).toBeUndefined();
    });
  });
});


/**
 * objectui#8127 — a spec-valid `type: 'page'` list view silently rendered as a
 * grid, because `ViewType` was a hand-written copy of the spec's list and every
 * structure keyed on it was total over the COPY.
 *
 * These pinned the two halves of the fix: the derived vocabulary ACCEPTED
 * `page`, and the renderer's drawable set refused it — loudly. Since
 * `@objectstack/spec` 17.5.0 retired `page` (objectui#11073), the derived
 * vocabulary follows the spec and refuses it too, and a stored `page` view
 * degrades like any kind outside the vocabulary.
 */
describe('the derived view-type vocabulary (objectui#8127)', () => {
  it('follows the spec: refuses the retired `page` list-view type, and a typo, and accepts a drawable kind', () => {
    // The published validator's answer is DERIVED from the spec. It accepted
    // `page` while the resolved spec published it; `@objectstack/spec` 17.5.0
    // retired the kind (objectui#11073), and the derivation dropped it with it.
    expect(ViewTypeSchema.safeParse('page').success).toBe(false);
    expect(ViewTypeSchema.safeParse('nonsense-control').success).toBe(false);
    // Control: the `false`s above are readings of a closed enum, not an enum
    // that refuses everything.
    expect(ViewTypeSchema.safeParse('kanban').success).toBe(true);
  });

  it('keeps the two objectui view CATEGORIES, which have no spec counterpart', () => {
    expect(ViewTypeSchema.safeParse('list').success).toBe(true);
    expect(ViewTypeSchema.safeParse('detail').success).toBe(true);
  });

  it('does not count `page` among the visualizations ListView draws', () => {
    // The spec models the two separately: `AppearanceConfig.allowedVisualizations`
    // is typed on `VisualizationType`, which has no `page`, because a
    // `type: 'page'` view mounts a published page through `pageName` rather
    // than drawing records.
    expect(isListViewVisualization('page')).toBe(false);
    for (const kind of ['grid', 'kanban', 'gallery', 'calendar', 'timeline', 'gantt', 'map', 'chart', 'tree']) {
      expect(isListViewVisualization(kind)).toBe(true);
    }
  });

  it('does not answer for an inherited Object.prototype key', () => {
    expect(isListViewVisualization('toString')).toBe(false);
    expect(isListViewVisualization('constructor')).toBe(false);
  });
});

describe('the undrawable-kind fallback is loud (objectui#8127)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('treats the retired `page` as a kind outside the vocabulary: a grid, and no undrawable-kind warning', () => {
    // Until objectui#11073 `page` was a kind the published validator ACCEPTED
    // and ListView could not draw, so the fallback said so once. The spec
    // retired it at 17.5.0 and both published faces refuse it now, so a stored
    // `page` view is a document outside the vocabulary, exactly like a typo:
    // the fallback is unchanged and the warning that it was a VALID kind is gone.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = normalizeListViewSchema({ type: 'list-view', objectName: 'account', specType: 'page' });
    expect((out as { viewType?: string }).viewType).toBe('grid');
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays silent for the objectui view categories and for a plain typo', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const kind of ['list', 'detail', 'nonsense-control']) {
      normalizeListViewSchema({ type: 'list-view', objectName: 'account', specType: kind });
    }
    // `list` folds to grid by design and `detail` is another renderer entirely;
    // a typo is the caller's own problem and already degrades honestly.
    expect(warn).not.toHaveBeenCalled();
  });
});
