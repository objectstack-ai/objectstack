// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#14107] A list view's field references, resolved against the bound object.
//
// The fixture below is deliberately ONE list view carrying every position the
// rule walks, so a "clean" assertion is a real statement about the whole
// surface rather than about the two keys a test happened to write. Each
// mutation case names exactly one position and asserts the finding's PATH, not
// only its rule id: a rule that reports the right miss at the wrong path is
// unusable as an edit target (`os lint --json`, Studio's finding renderer).

import { describe, expect, it } from 'vitest';
import { runAuthoringRules, splitBySeverity } from './authoring-rules.js';
import { validateReferenceIntegrity } from './reference-integrity-suite.js';
import {
  validateListViewFieldRefs,
  LIST_VIEW_FIELD_UNKNOWN,
  LIST_VIEW_FIELD_DOTTED,
  listViewWalkedPositions,
  type ListViewFieldRefFinding,
} from './validate-list-view-field-refs.js';
import { SORT_FIELD_UNKNOWN } from './validate-sortable-fields.js';
import { SEARCHABLE_FIELD_UNKNOWN } from './validate-searchable-fields.js';

type AnyRec = Record<string, unknown>;

const OBJECTS = [
  {
    name: 'duly_task',
    label: 'Task',
    fields: [
      { name: 'title', type: 'text', label: 'Title' },
      { name: 'status', type: 'select', label: 'Status' },
      { name: 'period_key', type: 'text', label: 'Period' },
      { name: 'visible_from', type: 'date', label: 'Visible from' },
      { name: 'due_at', type: 'date', label: 'Due' },
      { name: 'business_unit', type: 'text', label: 'BU' },
      { name: 'estimate', type: 'number', label: 'Estimate' },
      { name: 'lat', type: 'number', label: 'Lat' },
      { name: 'lng', type: 'number', label: 'Lng' },
      { name: 'cover', type: 'image', label: 'Cover' },
      { name: 'parent', type: 'lookup', reference: 'duly_task', label: 'Parent' },
      { name: 'owner', type: 'lookup', reference: 'duly_person', label: 'Owner' },
      // [#14282] The three head shapes the FILTER door treats differently.
      // `payload` is the ruled carve-out (`STRUCTURED_JSON_TYPES`, live on
      // memory and mongodb); `score` is virtual; `tags` is array-valued.
      { name: 'payload', type: 'json', label: 'Payload' },
      { name: 'score', type: 'formula', label: 'Score' },
      { name: 'tags', type: 'text', multiple: true, label: 'Tags' },
      // [#18835] The targets for the four field-naming keys that had no
      // position row, each declared at the type its own `.describe()` names —
      // `allDayField` / `lockField` say "boolean field", `objectField` carries
      // an object api name and `borderColorField` a colour string.
      { name: 'is_all_day', type: 'boolean', label: 'All day' },
      { name: 'is_locked', type: 'boolean', label: 'Locked' },
      { name: 'alert_color', type: 'text', label: 'Alert colour' },
      { name: 'row_object', type: 'text', label: 'Row object' },
    ],
  },
  {
    name: 'duly_person',
    label: 'Person',
    fields: [{ name: 'name', type: 'text', label: 'Name' }],
  },
];

/** Every field-naming position this rule walks, all bound to real fields. */
const FULL_LIST_VIEW: AnyRec = {
  name: 'all',
  type: 'grid',
  data: { provider: 'object', object: 'duly_task' },
  columns: [
    'title',
    { field: 'period_key', summary: { field: 'estimate' }, prefix: { field: 'status' } },
  ],
  filter: [{ field: 'visible_from', operator: 'equals', value: '2026-01-01' }],
  filterableFields: ['status'],
  hiddenFields: ['business_unit'],
  fieldOrder: ['title', 'status'],
  grouping: { fields: [{ field: 'business_unit' }] },
  rowColor: { field: 'status' },
  userFilters: {
    fields: [{ field: 'status' }],
    tabs: [{ name: 'open', filter: [{ field: 'status', operator: 'equals', value: 'open' }] }],
  },
  tabs: [{ name: 'mine', filter: [{ field: 'business_unit', operator: 'equals', value: 'x' }] }],
  kanban: { groupByField: 'status', summarizeField: 'estimate', columns: ['title'], titleField: 'title' },
  calendar: {
    startDateField: 'due_at',
    endDateField: 'visible_from',
    titleField: 'title',
    colorField: 'status',
    allDayField: 'is_all_day',
  },
  gantt: {
    startDateField: 'visible_from',
    endDateField: 'due_at',
    titleField: 'title',
    progressField: 'estimate',
    dependenciesField: 'parent',
    colorField: 'status',
    parentField: 'parent',
    typeField: 'status',
    baselineStartField: 'visible_from',
    baselineEndField: 'due_at',
    groupByField: 'business_unit',
    assigneeField: 'owner',
    effortField: 'estimate',
    tooltipFields: ['status', { field: 'business_unit' }],
    quickFilters: [{ field: 'status' }],
    borderColorField: 'alert_color',
    lockField: 'is_locked',
    objectField: 'row_object',
  },
  timeline: {
    startDateField: 'visible_from',
    titleField: 'title',
    endDateField: 'due_at',
    groupByField: 'business_unit',
    colorField: 'status',
  },
  gallery: { coverField: 'cover', titleField: 'title', visibleFields: ['status'] },
  map: {
    latitudeField: 'lat',
    longitudeField: 'lng',
    locationField: 'business_unit',
    titleField: 'title',
    descriptionField: 'status',
  },
  tree: { parentField: 'parent', labelField: 'title', fields: ['status'] },
};

/** Deep-merge one mutation into the full list view. */
function mutate(patch: AnyRec): AnyRec {
  const next: AnyRec = { ...FULL_LIST_VIEW };
  for (const [k, v] of Object.entries(patch)) {
    const base = next[k];
    next[k] = v && typeof v === 'object' && !Array.isArray(v)
      && base && typeof base === 'object' && !Array.isArray(base)
      ? { ...(base as AnyRec), ...(v as AnyRec) }
      : v;
  }
  return next;
}

/** A `defineView` aggregate whose default `list` is the list view given. */
function stackWith(listView: AnyRec, objects: unknown = OBJECTS): AnyRec {
  return {
    name: 'probe',
    objects,
    views: [{ name: 'duly_task', object: 'duly_task', list: listView }],
  };
}

const idsOf = (fs: ListViewFieldRefFinding[]) => fs.map((f) => f.path);

describe('#14107 — the clean surface reports nothing', () => {
  it('every walked position bound to a real field is silent', () => {
    expect(validateListViewFieldRefs(stackWith(FULL_LIST_VIEW))).toEqual([]);
  });

  it('a stack with no views at all is silent', () => {
    expect(validateListViewFieldRefs({ name: 'x', objects: OBJECTS })).toEqual([]);
  });

  it('a non-object input is silent rather than throwing', () => {
    expect(validateListViewFieldRefs(undefined as never)).toEqual([]);
    expect(validateListViewFieldRefs('nope' as never)).toEqual([]);
  });
});

/**
 * The card's own measured table. Each of these five passed `os validate`
 * (`valid: true, warnings: []`) and `os build` (exit 0, `✓ Build complete`) on
 * `@objectstack/cli` 17.2.0 — the reason this card exists.
 *
 * [#18836] At module scope because it is the other half of the coverage the
 * completeness assertion below judges: three positions (`grouping.fields`,
 * `kanban.groupByField`, `gantt.startDateField`) are asserted HERE and nowhere
 * else, so a criterion that read only the sibling table would have to carry a
 * hand-written exemption for them — the kind of constant that rots into the
 * very lie this card is about.
 */
const MEASURED_CASES: Array<[string, AnyRec, string]> = [
  ['columns[].field', { columns: [{ field: 'B2_no_such_field' }] }, 'views[0].list.columns[0].field'],
  [
    'filter[].field',
    { filter: [{ field: 'A8_no_such_field', operator: 'equals', value: 'x' }] },
    'views[0].list.filter[0].field',
  ],
  [
    'grouping.fields[].field',
    { grouping: { fields: [{ field: 'A7_no_such_field' }] } },
    'views[0].list.grouping.fields[0].field',
  ],
  ['kanban.groupByField', { kanban: { groupByField: 'A9_no_such_field' } }, 'views[0].list.kanban.groupByField'],
  ['gantt.startDateField', { gantt: { startDateField: 'B1_no_such_field' } }, 'views[0].list.gantt.startDateField'],
];

describe('#14107 — the card\'s five measured positions', () => {
  for (const [label, patch, path] of MEASURED_CASES) {
    it(`${label} is an error, at a path an author can look up`, () => {
      const findings = validateListViewFieldRefs(stackWith(mutate(patch)));
      expect(idsOf(findings)).toEqual([path]);
      expect(findings[0].rule).toBe(LIST_VIEW_FIELD_UNKNOWN);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain('is not a field on object "duly_task"');
      expect(findings[0].hint).toContain('Fields on "duly_task"');
    });
  }
});

/**
 * [#18836] A case's asserted finding path, with the fixture's own `views[0].list`
 * prefix and every array index dropped, so it can be compared with a position id.
 */
function casePath(path: string): string {
  return path.replace(/^views\[\d+\]\.list\./, '').replace(/\[\d+\]/g, '');
}

/**
 * [#18836] The `POSITIONS` position a case's asserted finding path names, or
 * `undefined` when the path belongs to one of the rule's hard-coded filter
 * walks — which no table declares, so {@link listViewWalkedPositions} has
 * nothing to derive them from. Those are declared and asserted separately, in
 * {@link HARD_CODED_FILTER_WALKS}.
 *
 * Two arms, because an `entries` position reports at two different paths: at
 * the entry itself when the author wrote a bare field name
 * (`gantt.tooltipFields[0]`) and at its `field` key when they wrote a record
 * (`gantt.tooltipFields[0].field`). The whole path is tried FIRST, so a
 * position whose own key is `field` (`rowColor.field`, and both
 * `columns[].summary.field` / `columns[].prefix.field`) matches itself instead
 * of being truncated to its block.
 */
function positionAsserted(path: string, walked: ReadonlySet<string>): string | undefined {
  const at = casePath(path);
  if (walked.has(at)) return at;
  const entry = at.replace(/\.field$/, '');
  return walked.has(entry) ? entry : undefined;
}

/**
 * [#18836] The rule's three hard-coded filter walks, spelled as
 * {@link casePath} normalises the paths they report at.
 *
 * They are open code, not table rows — `checkListView` calls `checkFilter` on
 * `listView.filter`, on `tabs[]` and on `userFilters.tabs[]` — so the position
 * set derived from the rule cannot reach them, and the completeness assertion
 * below would let their rows be deleted in silence. That is precisely the hole
 * the floor this card replaced DID cover, by counting rows.
 *
 * So they are declared here and asserted EXACTLY: delete one of their rows and
 * the list comes up short; give a fourth hard-coded walk a row without adding
 * it here and the list comes up long. Together with the derived assertion, every
 * row in both tables is then accounted for by one criterion or the other.
 */
const HARD_CODED_FILTER_WALKS = [
  'filter.field',
  'tabs.filter.field',
  'userFilters.tabs.filter.field',
];

/**
 * Every remaining position, with the severity tier it earns. The table is the
 * readable half of the rule's own POSITIONS table: a position dropped from the
 * rule fails here, and a position added to the rule without a row in either
 * table fails the completeness assertion below — which derives the set of
 * positions from the rule's own tables instead of counting this one's rows.
 */
describe('#14107 — every other walked position', () => {
  const BAD = 'nope_field';
  const cases: Array<[AnyRec, string, 'error' | 'warning']> = [
    [{ columns: [BAD, ...(FULL_LIST_VIEW.columns as unknown[]).slice(1)] }, 'views[0].list.columns[0]', 'error'],
    [
      { columns: [{ field: 'title', summary: { field: BAD } }] },
      'views[0].list.columns[0].summary.field',
      'error',
    ],
    [
      { columns: [{ field: 'title', prefix: { field: BAD } }] },
      'views[0].list.columns[0].prefix.field',
      'warning',
    ],
    [{ filterableFields: [BAD] }, 'views[0].list.filterableFields[0]', 'error'],
    [{ hiddenFields: [BAD] }, 'views[0].list.hiddenFields[0]', 'warning'],
    [{ fieldOrder: [BAD] }, 'views[0].list.fieldOrder[0]', 'warning'],
    [{ rowColor: { field: BAD } }, 'views[0].list.rowColor.field', 'warning'],
    [{ userFilters: { fields: [{ field: BAD }] } }, 'views[0].list.userFilters.fields[0].field', 'error'],
    [
      { userFilters: { tabs: [{ name: 'a', filter: [{ field: BAD, operator: 'equals', value: 1 }] }] } },
      'views[0].list.userFilters.tabs[0].filter[0].field',
      'error',
    ],
    [
      { tabs: [{ name: 'a', filter: [{ field: BAD, operator: 'equals', value: 1 }] }] },
      'views[0].list.tabs[0].filter[0].field',
      'error',
    ],
    [{ kanban: { summarizeField: BAD } }, 'views[0].list.kanban.summarizeField', 'warning'],
    [{ kanban: { columns: [BAD] } }, 'views[0].list.kanban.columns[0]', 'warning'],
    // [#18565] Calendar's level, not the required siblings' — see the row's
    // own note in the rule. The board renders every card; only the title is
    // not the one the author named.
    [{ kanban: { titleField: BAD } }, 'views[0].list.kanban.titleField', 'warning'],
    [{ calendar: { endDateField: BAD } }, 'views[0].list.calendar.endDateField', 'warning'],
    [{ calendar: { titleField: BAD } }, 'views[0].list.calendar.titleField', 'warning'],
    [{ calendar: { colorField: BAD } }, 'views[0].list.calendar.colorField', 'warning'],
    [{ calendar: { startDateField: BAD } }, 'views[0].list.calendar.startDateField', 'error'],
    // [#18835] A declared `allDayField` is absolute — it switches the
    // renderer's own all-day inference off — so a miss un-bands every event.
    // They all still render, at their start time: one decoration.
    [{ calendar: { allDayField: BAD } }, 'views[0].list.calendar.allDayField', 'warning'],
    [{ gantt: { endDateField: BAD } }, 'views[0].list.gantt.endDateField', 'error'],
    [{ gantt: { titleField: BAD } }, 'views[0].list.gantt.titleField', 'error'],
    [{ gantt: { progressField: BAD } }, 'views[0].list.gantt.progressField', 'warning'],
    [{ gantt: { dependenciesField: BAD } }, 'views[0].list.gantt.dependenciesField', 'warning'],
    [{ gantt: { colorField: BAD } }, 'views[0].list.gantt.colorField', 'warning'],
    [{ gantt: { parentField: BAD } }, 'views[0].list.gantt.parentField', 'warning'],
    [{ gantt: { typeField: BAD } }, 'views[0].list.gantt.typeField', 'warning'],
    [{ gantt: { baselineStartField: BAD } }, 'views[0].list.gantt.baselineStartField', 'warning'],
    [{ gantt: { baselineEndField: BAD } }, 'views[0].list.gantt.baselineEndField', 'warning'],
    [{ gantt: { groupByField: BAD } }, 'views[0].list.gantt.groupByField', 'warning'],
    [{ gantt: { assigneeField: BAD } }, 'views[0].list.gantt.assigneeField', 'warning'],
    [{ gantt: { effortField: BAD } }, 'views[0].list.gantt.effortField', 'warning'],
    // [#18835] The three objectui-lifted field bindings, on three different
    // levels — see each row's note in the rule. The stroke is a decoration;
    // the lock is a write guard that fails open; `objectField` makes every row
    // answer the synthetic-row test, so nothing in the chart opens.
    [{ gantt: { borderColorField: BAD } }, 'views[0].list.gantt.borderColorField', 'warning'],
    [{ gantt: { lockField: BAD } }, 'views[0].list.gantt.lockField', 'error'],
    [{ gantt: { objectField: BAD } }, 'views[0].list.gantt.objectField', 'error'],
    [{ gantt: { tooltipFields: [BAD] } }, 'views[0].list.gantt.tooltipFields[0]', 'warning'],
    [
      { gantt: { tooltipFields: [{ field: BAD }] } },
      'views[0].list.gantt.tooltipFields[0].field',
      'warning',
    ],
    [{ gantt: { quickFilters: [{ field: BAD }] } }, 'views[0].list.gantt.quickFilters[0].field', 'error'],
    [{ timeline: { startDateField: BAD } }, 'views[0].list.timeline.startDateField', 'error'],
    [{ timeline: { titleField: BAD } }, 'views[0].list.timeline.titleField', 'error'],
    [{ timeline: { endDateField: BAD } }, 'views[0].list.timeline.endDateField', 'warning'],
    [{ timeline: { groupByField: BAD } }, 'views[0].list.timeline.groupByField', 'warning'],
    [{ timeline: { colorField: BAD } }, 'views[0].list.timeline.colorField', 'warning'],
    [{ gallery: { coverField: BAD } }, 'views[0].list.gallery.coverField', 'warning'],
    [{ gallery: { titleField: BAD } }, 'views[0].list.gallery.titleField', 'warning'],
    [{ gallery: { visibleFields: [BAD] } }, 'views[0].list.gallery.visibleFields[0]', 'warning'],
    [{ map: { latitudeField: BAD } }, 'views[0].list.map.latitudeField', 'error'],
    [{ map: { longitudeField: BAD } }, 'views[0].list.map.longitudeField', 'error'],
    [{ map: { locationField: BAD } }, 'views[0].list.map.locationField', 'error'],
    [{ map: { titleField: BAD } }, 'views[0].list.map.titleField', 'warning'],
    [{ map: { descriptionField: BAD } }, 'views[0].list.map.descriptionField', 'warning'],
    [{ tree: { parentField: BAD } }, 'views[0].list.tree.parentField', 'error'],
    [{ tree: { labelField: BAD } }, 'views[0].list.tree.labelField', 'warning'],
    [{ tree: { fields: [BAD] } }, 'views[0].list.tree.fields[0]', 'warning'],
  ];

  for (const [patch, path, severity] of cases) {
    it(`${path} reports at \`${severity}\``, () => {
      const findings = validateListViewFieldRefs(stackWith(mutate(patch)));
      const mine = findings.filter((f) => f.path === path);
      expect(mine).toHaveLength(1);
      expect(mine[0].severity).toBe(severity);
      expect(mine[0].rule).toBe(LIST_VIEW_FIELD_UNKNOWN);
    });
  }

  // [#18836] The completeness criterion, DERIVED from the rule's own tables.
  //
  // It replaces a `toBeGreaterThanOrEqual` floor over `cases.length`. That
  // floor counted the rows of THIS table, which a position added to the rule
  // never moves — so the second direction the docblock above claimed, "a
  // position added to the rule without a row here", reported nothing at all.
  // That is the direction #18565 came in through: `kanban.titleField` was
  // declared by the schema from #16894 and walked by no position row, and this
  // file stayed green.
  //
  // What it asserts, exactly: every position the rule walks is asserted by a
  // row in one of this file's two tables. A position added to the rule with no
  // row in either is MISSING from the covered set, and the diff names it.
  //
  // ⛔ THIS assertion does not carry the opposite direction on its own.
  // `positionAsserted` answers only with positions the rule CURRENTLY walks, so
  // a row left behind for a position the rule has DROPPED contributes to
  // neither side here and this one stays green. Two other things catch it, both
  // measured: that row's own per-case assertion above stops seeing a finding,
  // which is the first half of the docblock; and the sibling assertion below,
  // where the stale row matches nothing and comes up as an extra.
  //
  // The floor's OWN job — a row silently deleted from a table — is taken over
  // by this assertion and its sibling TOGETHER. The residue is stated here per
  // kind of row rather than left to be discovered, because a criterion that
  // claims a direction it does not cover is the exact defect this card is
  // about. Each one measured on this branch:
  //
  //  - a row for a position no other row covers: deleting it drops the position
  //    from the covered set ⇒ RED here.
  //  - a row for one of the rule's three hard-coded filter walks: outside this
  //    assertion by construction, because those walks are open code and nothing
  //    derives them ⇒ RED in the sibling assertion below, which is why that one
  //    exists.
  //  - one of the two positions asserted TWICE on purpose (`columns` and
  //    `gantt.tooltipFields`: once as a bare name, once as a record with a
  //    `field` key): the surviving row still covers the position, so deleting
  //    either one is ⛔ SILENT — measured, deleting both leaves this file green.
  //    That seam is disclosed, not closed. Closing it means deriving each
  //    `entries` position's two legal forms and demanding a row for both, which
  //    is three rows these tables do not have today.
  const assertedPaths = (): string[] => [
    ...MEASURED_CASES.map(([, , path]) => path),
    ...cases.map(([, path]) => path),
  ];

  it('covers every position the rule walks', () => {
    const walked = listViewWalkedPositions();
    const walkedSet = new Set(walked);
    const covered = assertedPaths()
      .map((path) => positionAsserted(path, walkedSet))
      .filter((position): position is string => position !== undefined);
    expect([...new Set(covered)].sort()).toEqual([...walked].sort());
  });

  // [#18836] The other half of the same account, and the half the derived
  // assertion above structurally cannot reach: every path the two tables assert
  // names either a position the rule walks or one of its declared hard-coded
  // filter walks — nothing else. A set, compared in both directions, which
  // holds three things the completeness assertion does not:
  //
  //  - SHORT ⇒ RED. Delete a filter-walk row and the set loses a member. All
  //    three rows measured, one by one. That is exactly the coverage the
  //    row-counting floor had and the derived assertion cannot reach.
  //  - LONG ⇒ RED, measured two ways. Remove one of the three declarations
  //    below and the rows outnumber them. Leave a row behind for a position the
  //    rule has DROPPED and it matches neither side, so it arrives here as an
  //    extra — red here as well as in that row's own per-case assertion, which
  //    is how this assertion ends up carrying the direction its sibling above
  //    cannot. A fourth hard-coded walk given a row without being declared
  //    below lands in the same place by the same comparison.
  it('accounts for every asserted path, as a walked position or a declared filter walk', () => {
    const walkedSet = new Set(listViewWalkedPositions());
    const unaccounted = assertedPaths()
      .filter((path) => positionAsserted(path, walkedSet) === undefined)
      .map(casePath);
    expect([...new Set(unaccounted)].sort()).toEqual([...HARD_CODED_FILTER_WALKS].sort());
  });
});

/**
 * [#18835] The four declared, authorable field-naming keys that had no row in
 * `POSITIONS` at all: `calendar.allDayField` and the three objectui-lifted
 * `gantt` bindings (`borderColorField`, `lockField`, `objectField`). Each was
 * admitted by the schema, walked by nothing, and dropped by the runtime.
 *
 * All four are `.optional()`, and that is deliberately NOT what tiers them —
 * the tier is the consequence, read per key off its own `.describe()` and its
 * renderer (objectui `dda8f3815`). Two land in each tier, and the block below
 * asserts the tiers where they are felt: `validate` / `build`.
 *
 * Each key is pinned SEPARATELY, in both directions. One key proven does not
 * generalise to the other three: they are four different renderer behaviours
 * that happen to share a schema shape.
 */
describe('#18835 — the four keys with no position row', () => {
  const KEYS: Array<[string, (bad: string) => AnyRec, string, 'error' | 'warning', string]> = [
    [
      'calendar.allDayField',
      (v) => ({ calendar: { allDayField: v } }),
      'views[0].list.calendar.allDayField',
      'warning',
      'is_all_day',
    ],
    [
      'gantt.borderColorField',
      (v) => ({ gantt: { borderColorField: v } }),
      'views[0].list.gantt.borderColorField',
      'warning',
      'alert_color',
    ],
    [
      'gantt.lockField',
      (v) => ({ gantt: { lockField: v } }),
      'views[0].list.gantt.lockField',
      'error',
      'is_locked',
    ],
    [
      'gantt.objectField',
      (v) => ({ gantt: { objectField: v } }),
      'views[0].list.gantt.objectField',
      'error',
      'row_object',
    ],
  ];

  for (const [label, patch, path, severity, realField] of KEYS) {
    it(`${label} naming a field that does not exist reports at \`${severity}\``, () => {
      const findings = validateListViewFieldRefs(stackWith(mutate(patch('zz_no_such_field'))));
      expect(idsOf(findings)).toEqual([path]);
      expect(findings[0].rule).toBe(LIST_VIEW_FIELD_UNKNOWN);
      expect(findings[0].severity).toBe(severity);
      expect(findings[0].message).toContain('is not a field on object "duly_task"');
      expect(findings[0].hint).toContain('Fields on "duly_task"');
    });

    // The dark half, per key: a real field is silent, so the rows report the
    // MISS and not the key's presence.
    it(`${label} naming a real field ("${realField}") stays silent`, () => {
      expect(validateListViewFieldRefs(stackWith(mutate(patch(realField))))).toEqual([]);
    });

    const arm = severity === 'error' ? 'gates' : 'advises';
    it(`${label} ${arm} \`build\``, () => {
      const normalized = stackWith(mutate(patch('zz_no_such_field')));
      const { errors, advisories } = splitBySeverity(runAuthoringRules('build', { normalized }));
      const gated = errors.some((f) => f.path === path);
      const advised = advisories.some((f) => f.path === path);
      expect([gated, advised]).toEqual(severity === 'error' ? [true, false] : [false, true]);
    });
  }

  it('the reference-integrity suite carries all four', () => {
    // One stack, all four missed at once: the suite reports four findings and
    // not one, so no key rides on a neighbour's row.
    const stack = stackWith(
      mutate({
        calendar: { allDayField: 'zz_a' },
        gantt: { borderColorField: 'zz_b', lockField: 'zz_c', objectField: 'zz_d' },
      }),
    );
    const mine = validateReferenceIntegrity(stack).filter((f) => f.rule === LIST_VIEW_FIELD_UNKNOWN);
    expect(mine.map((f) => f.path).sort()).toEqual([
      'views[0].list.calendar.allDayField',
      'views[0].list.gantt.borderColorField',
      'views[0].list.gantt.lockField',
      'views[0].list.gantt.objectField',
    ]);
  });
});

describe('#14107 — the "did you mean" comes from the shared seam', () => {
  it('a near-miss names the nearest declared field', () => {
    const findings = validateListViewFieldRefs(stackWith(mutate({ kanban: { groupByField: 'statuss' } })));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Did you mean "status"?');
  });

  it('a name close to nothing carries no suggestion', () => {
    const findings = validateListViewFieldRefs(
      stackWith(mutate({ kanban: { groupByField: 'zzzzzzzzzzzzzzzz' } })),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).not.toContain('Did you mean');
  });
});

/**
 * The recorded dotted-path decision (see the rule's module docblock): the HEAD
 * segment is judged and relationship hops are NOT walked, because a list view
 * compiles no joins and the runtime doors refuse a dotted reference.
 *
 * ⚠️ This block used to pin BOTH halves — the half that reports, and a half
 * that stayed deliberately silent (`owner.name` and `title.x` in `columns`
 * passing clean). #14282 is the card that half was recorded for, and it ruled
 * the other way: those two now report, as {@link LIST_VIEW_FIELD_DOTTED}. The
 * cases were rewritten rather than deleted, so the pair still reads as one
 * decision — what changed is which class each lands in, not whether the rule
 * has an opinion. The `#14282` block below carries the new half in full.
 */
describe('#14107 — dotted paths, HEAD-segment resolution', () => {
  it('a dotted path whose HEAD resolves to nothing is reported', () => {
    const findings = validateListViewFieldRefs(stackWith(mutate({ columns: [{ field: 'ownr.name' }] })));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(LIST_VIEW_FIELD_UNKNOWN);
    expect(findings[0].message).toContain('"ownr"');
    // The author reads back what they typed, not only the segment judged.
    expect(findings[0].message).toContain('ownr.name');
    expect(findings[0].message).toContain('compiles');
  });

  it('hops are still NOT walked — a bad LEAF under a good head is not judged as a leaf', () => {
    // `owner` resolves, `duly_person` has no `nope`. Were hops walked, this
    // would be a `field-unknown` on `duly_person`. It is not: the finding is
    // the #14282 dotted class, which never mentions the leaf at all.
    const findings = validateListViewFieldRefs(stackWith(mutate({ columns: [{ field: 'owner.nope' }] })));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(LIST_VIEW_FIELD_DOTTED);
    expect(findings[0].message).not.toContain('duly_person');
  });
});

/**
 * [#14282] The SECOND finding class: a dotted reference at a position whose
 * name reaches a query door, where that door refuses it by name.
 *
 * The scoping is by DOOR, not by position — see the rule's module note. So
 * this block pins three things and not one: which positions report, which
 * deliberately do not (the measured client-side ones, `gantt.quickFilters`
 * first among them), and that the FILTER positions ask the same
 * `classifyDottedFilterHead` the runtime door asks, rather than refusing what
 * the door serves.
 */
describe('#14282 — a dotted reference the PROJECTION door refuses', () => {
  it('a dotted `columns[].field` whose head resolves is now reported', () => {
    const findings = validateListViewFieldRefs(stackWith(mutate({ columns: [{ field: 'owner.name' }] })));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(LIST_VIEW_FIELD_DOTTED);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('views[0].list.columns[0].field');
    expect(findings[0].message).toContain('owner.name');
    expect(findings[0].message).toContain('assertProjectionHasNoDottedPaths');
    expect(findings[0].hint).toContain('"owner"');
  });

  it('the bare-string `columns[]` spelling is judged too', () => {
    const findings = validateListViewFieldRefs(stackWith(mutate({ columns: ['owner.name'] })));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(LIST_VIEW_FIELD_DOTTED);
    expect(findings[0].path).toBe('views[0].list.columns[0]');
  });

  it('the projection door has NO head carve-out, so a scalar head reports too', () => {
    // `title` is a text field. `assertProjectionHasNoDottedPaths` filters on
    // `f.includes('.')` alone — the head's type never enters that door.
    const findings = validateListViewFieldRefs(stackWith(mutate({ columns: [{ field: 'title.x' }] })));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(LIST_VIEW_FIELD_DOTTED);
  });

  it('a structured/JSON head is reported at a COLUMN even though the filter door serves it', () => {
    // The #8371 carve-out is the FILTER door's, not the projection door's.
    // Getting this wrong in either direction is the whole point of scoping the
    // class by door rather than by "a list view compiles no joins".
    const findings = validateListViewFieldRefs(stackWith(mutate({ columns: [{ field: 'payload.theme' }] })));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(LIST_VIEW_FIELD_DOTTED);
  });

  it('an undotted column is untouched by the new class', () => {
    expect(validateListViewFieldRefs(stackWith(FULL_LIST_VIEW))).toEqual([]);
  });
});

describe('#14282 — a dotted key the FILTER door refuses, and the ones it serves', () => {
  const filterOn = (field: string): AnyRec => ({
    filter: [{ field, operator: 'equals', value: 'x' }],
  });

  it('a relation head is refused — it stores an id, not an embedded document', () => {
    const findings = validateListViewFieldRefs(stackWith(mutate(filterOn('owner.name'))));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(LIST_VIEW_FIELD_DOTTED);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('views[0].list.filter[0].field');
    expect(findings[0].message).toContain('lookup');
    expect(findings[0].message).toContain('can only match zero records');
  });

  it('a virtual head is refused — nothing materialises a column to reach into', () => {
    const findings = validateListViewFieldRefs(stackWith(mutate(filterOn('score.x'))));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('computed');
  });

  it('a plain scalar head is refused — there is nothing beneath it', () => {
    const findings = validateListViewFieldRefs(stackWith(mutate(filterOn('title.x'))));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('single scalar value');
  });

  it('⛔ a structured/JSON head is NOT refused — the #8371 ruling\'s carve-out', () => {
    // Live on driver-memory and driver-mongodb (2 rows in the #8371
    // measurement table). Refusing it at author time would delete a working
    // capability on two of three backends — the exact fail-closed drift the
    // shared classifier exists to prevent.
    expect(validateListViewFieldRefs(stackWith(mutate(filterOn('payload.theme'))))).toEqual([]);
  });

  it('⛔ an array-valued head is NOT refused — a numeric-index path reaches it', () => {
    expect(validateListViewFieldRefs(stackWith(mutate(filterOn('tags.0'))))).toEqual([]);
  });

  // [#16340] A registry-injected head IS judged now: the graph carries the
  // registry's own definition for it, so the classifier reads the same
  // `datetime` the DOOR reads. `assertFilterIsMaterializable` has always
  // refused `created_at.x` with `400 INVALID_FIELD` — the linter was silent
  // only because the type was missing here, which is the miss #16340 closed.
  it('a registry-injected scalar head is refused at a filter, as the door refuses it', () => {
    const findings = validateListViewFieldRefs(stackWith(mutate(filterOn('created_at.x'))));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(LIST_VIEW_FIELD_DOTTED);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('`datetime` field');
    expect(findings[0].message).toContain('single scalar value');
  });

  it('an injected RELATION head is refused on the same axis as an authored one', () => {
    const findings = validateListViewFieldRefs(stackWith(mutate(filterOn('owner_id.name'))));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('`lookup` field');
    expect(findings[0].message).toContain("stores the related record's id");
  });

  it('⛔ the primary key is NOT refused — the driver provisions it and no table types it', () => {
    // The one injected column with no definition behind it. An unreadable head
    // is what `classifyDottedFilterHead` answers `null` for, and the door
    // serves it, so the linter must not invent a refusal here.
    expect(validateListViewFieldRefs(stackWith(mutate(filterOn('id.x'))))).toEqual([]);
  });

  it('the tab and user-filter tab presets are judged on the same axis', () => {
    const findings = validateListViewFieldRefs(
      stackWith(
        mutate({
          tabs: [{ name: 'mine', filter: [{ field: 'owner.name', operator: 'equals', value: 'x' }] }],
          userFilters: {
            fields: [{ field: 'status' }],
            tabs: [{ name: 'open', filter: [{ field: 'parent.title', operator: 'equals', value: 'x' }] }],
          },
        }),
      ),
    );
    expect(idsOf(findings).sort()).toEqual([
      'views[0].list.tabs[0].filter[0].field',
      'views[0].list.userFilters.tabs[0].filter[0].field',
    ]);
    expect(findings.every((f) => f.rule === LIST_VIEW_FIELD_DOTTED)).toBe(true);
  });

  it('the two positions that DECLARE end-user filterable names are judged', () => {
    // objectui folds the resulting conditions into the fetched query
    // (`buildEffectiveFilter`), so these names become filter keys.
    const findings = validateListViewFieldRefs(
      stackWith(
        mutate({
          filterableFields: ['owner.name'],
          userFilters: { fields: [{ field: 'parent.title' }] },
        }),
      ),
    );
    expect(idsOf(findings).sort()).toEqual([
      'views[0].list.filterableFields[0]',
      'views[0].list.userFilters.fields[0].field',
    ]);
    expect(findings.every((f) => f.rule === LIST_VIEW_FIELD_DOTTED)).toBe(true);
  });
});

describe('#14282 — the measured exclusions: positions read CLIENT-SIDE', () => {
  it('⛔ `gantt.quickFilters[].field` accepts a dot-path — the card\'s named exception', () => {
    // Measured, and it went the other way round from the rest of the card.
    // The spec describes the position as "Record field / dot-path", and
    // objectui's `ObjectGantt.tsx` applies these filters IN MEMORY over the
    // already-fetched rows, resolving each through a walker that splits on `.`
    // and steps through the record object (`resolveFilterKey`). No query door
    // is involved, so nothing refuses it.
    const findings = validateListViewFieldRefs(
      stackWith(mutate({ gantt: { quickFilters: [{ field: 'owner.name' }] } })),
    );
    expect(findings).toEqual([]);
  });

  it('the head of a gantt quick filter is STILL judged for existence (#14107 is untouched)', () => {
    const findings = validateListViewFieldRefs(
      stackWith(mutate({ gantt: { quickFilters: [{ field: 'ownr.name' }] } })),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(LIST_VIEW_FIELD_UNKNOWN);
  });

  it('⛔ `gantt.tooltipFields[]` accepts a dot-path — read through `resolvePath`', () => {
    const findings = validateListViewFieldRefs(
      stackWith(mutate({ gantt: { tooltipFields: ['owner.name', { field: 'parent.title' }] } })),
    );
    expect(findings).toEqual([]);
  });

  it('⛔ renderer bindings reach no door this card measured, so they stay unjudged', () => {
    // Very likely still wrong (the gantt scalars read `record[field]` flat),
    // but "likely wrong" is not a verdict a gate may invent — and the failure
    // would be the SILENT class, not this loud one. Recorded as a follow-up.
    const findings = validateListViewFieldRefs(
      stackWith(
        mutate({
          rowColor: { field: 'owner.name' },
          kanban: { groupByField: 'owner.name' },
          calendar: { titleField: 'owner.name', allDayField: 'owner.name' },
          gallery: { coverField: 'owner.name' },
          // [#18835] The four positions this card adds are in POSITIONS and
          // deliberately NOT in DOTTED_AXIS, which is what "a position added to
          // the surface map does not silently acquire a dotted verdict nobody
          // measured" means in practice. Pinned here so the default is a
          // decision rather than an omission.
          gantt: {
            borderColorField: 'owner.name',
            lockField: 'owner.name',
            objectField: 'owner.name',
          },
          tree: { parentField: 'owner.name' },
          grouping: { fields: [{ field: 'owner.name' }] },
          hiddenFields: ['owner.name'],
          fieldOrder: ['owner.name'],
        }),
      ),
    );
    expect(findings).toEqual([]);
  });

  it('a `columns[]` entry\'s nested summary/prefix are unjudged for dotted paths too', () => {
    const findings = validateListViewFieldRefs(
      stackWith(
        mutate({
          columns: [{ field: 'title', summary: { field: 'owner.name' }, prefix: { field: 'parent.title' } }],
        }),
      ),
    );
    expect(findings).toEqual([]);
  });
});

describe('#14282 — the class does not disturb its neighbours', () => {
  it('the skips still win over the dotted verdict', () => {
    // An object this stack does not define: no graph, no verdict of any kind.
    const stack = stackWith(
      mutate({ data: { provider: 'object', object: 'sys_elsewhere' }, columns: [{ field: 'owner.name' }] }),
    );
    expect(validateListViewFieldRefs(stack)).toEqual([]);
  });

  it('`sort[]` keeps its owner — no dotted finding is minted for it here', () => {
    const findings = validateListViewFieldRefs(
      stackWith(mutate({ sort: [{ field: 'owner.name', order: 'asc' }] })),
    );
    expect(findings.filter((f) => f.rule === LIST_VIEW_FIELD_DOTTED)).toEqual([]);
  });

  it('the two classes carry DIFFERENT rule ids, so one can be suppressed alone', () => {
    const findings = validateListViewFieldRefs(
      stackWith(mutate({ columns: [{ field: 'ownr.name' }, { field: 'owner.name' }] })),
    );
    expect(findings.map((f) => f.rule)).toEqual([LIST_VIEW_FIELD_UNKNOWN, LIST_VIEW_FIELD_DOTTED]);
  });

  it('the dotted class gates `validate` and `build`, like the rest of the error tier', () => {
    const stack = stackWith(mutate({ columns: [{ field: 'owner.name' }] }));
    for (const command of ['validate', 'build'] as const) {
      const { errors } = splitBySeverity(runAuthoringRules(command, { normalized: stack }));
      expect(errors.map((e) => e.rule)).toContain(LIST_VIEW_FIELD_DOTTED);
    }
  });

  it('the reference-integrity suite carries the new class too', () => {
    const stack = stackWith(mutate({ columns: [{ field: 'owner.name' }] }));
    const findings = validateReferenceIntegrity(stack);
    expect(findings.some((f) => f.rule === LIST_VIEW_FIELD_DOTTED)).toBe(true);
  });
});

describe('#14107 — the skips', () => {
  it('skips a list view bound to an object this stack does not define', () => {
    const stack = stackWith(mutate({ data: { provider: 'object', object: 'sys_elsewhere' } }));
    expect(validateListViewFieldRefs(stack)).toEqual([]);
  });

  it('skips an object that declares no readable field map', () => {
    const external = [{ name: 'duly_task', label: 'Task', external: true }];
    expect(validateListViewFieldRefs(stackWith(mutate({ columns: ['nope'] }), external))).toEqual([]);
  });

  it('skips a registry-injected system column', () => {
    const findings = validateListViewFieldRefs(stackWith(mutate({ columns: ['created_at'] })));
    expect(findings).toEqual([]);
  });

  it('skips a list view whose provider is not `object`', () => {
    const stack = stackWith(mutate({ data: { provider: 'api', endpoint: '/x' }, columns: ['nope'] }));
    expect(validateListViewFieldRefs(stack)).toEqual([]);
  });

  it('one bad object yields ZERO findings here, not one per position', () => {
    // `validate-object-references` owns the object name; this rule must not
    // repeat the same typo once per field position.
    const stack = stackWith(mutate({ data: { provider: 'object', object: 'duly_taskk' } }));
    expect(validateListViewFieldRefs(stack)).toEqual([]);
  });
});

describe('#14107 — every list-view rung the sort/search twins walk', () => {
  const bad = { columns: [{ field: 'nope' }] };

  it('objects[].listViews.<key>', () => {
    const stack = {
      name: 'p',
      objects: [{ ...OBJECTS[0], listViews: { all: mutate(bad) } }, OBJECTS[1]],
    };
    expect(idsOf(validateListViewFieldRefs(stack))).toEqual([
      'objects[0].listViews.all.columns[0].field',
    ]);
  });

  it('views[].list', () => {
    expect(idsOf(validateListViewFieldRefs(stackWith(mutate(bad))))).toEqual([
      'views[0].list.columns[0].field',
    ]);
  });

  it('views[].listViews.<key>', () => {
    const stack = {
      name: 'p',
      objects: OBJECTS,
      views: [{ name: 'duly_task', object: 'duly_task', listViews: { open: mutate(bad) } }],
    };
    expect(idsOf(validateListViewFieldRefs(stack))).toEqual([
      'views[0].listViews.open.columns[0].field',
    ]);
  });

  it('views[] flattened list overlay (#9313)', () => {
    const stack = {
      name: 'p',
      objects: OBJECTS,
      views: [{ ...mutate(bad), name: 'all', object: 'duly_task', viewKind: 'list' }],
    };
    expect(idsOf(validateListViewFieldRefs(stack))).toEqual(['views[0].columns[0].field']);
  });

  it('views[].config ViewItem record (#10001)', () => {
    const stack = {
      name: 'p',
      objects: OBJECTS,
      views: [{ name: 'all', object: 'duly_task', viewKind: 'list', config: mutate(bad) }],
    };
    expect(idsOf(validateListViewFieldRefs(stack))).toEqual(['views[0].config.columns[0].field']);
  });
});

describe('#14107 — no double-reporting with the two axes that already have owners', () => {
  it('`sort` stays with validate-sortable-fields', () => {
    const stack = stackWith(mutate({ sort: [{ field: 'nope', order: 'asc' }] }));
    expect(validateListViewFieldRefs(stack)).toEqual([]);
    expect(validateReferenceIntegrity(stack).map((f) => f.rule)).toContain(SORT_FIELD_UNKNOWN);
  });

  it('`searchableFields` stays with validate-searchable-fields', () => {
    const stack = stackWith(mutate({ searchableFields: ['nope'] }));
    expect(validateListViewFieldRefs(stack)).toEqual([]);
    expect(validateReferenceIntegrity(stack).map((f) => f.rule)).toContain(SEARCHABLE_FIELD_UNKNOWN);
  });
});

describe('#14107 — wired into the reference-integrity suite', () => {
  it('the suite reports the finding on a whole-stack run', () => {
    const stack = stackWith(mutate({ kanban: { groupByField: 'A9_no_such_field' } }));
    expect(validateReferenceIntegrity(stack).map((f) => f.rule)).toContain(LIST_VIEW_FIELD_UNKNOWN);
  });

  it('and on a `view` per-write publish snapshot (#9313 axis)', () => {
    const stack = {
      objects: OBJECTS,
      views: [{ ...mutate({ kanban: { groupByField: 'A9_no_such_field' } }), name: 'all', object: 'duly_task', viewKind: 'list' }],
    };
    const findings = validateReferenceIntegrity(stack, { runtimeWriteType: 'view' });
    expect(findings.map((f) => f.rule)).toContain(LIST_VIEW_FIELD_UNKNOWN);
  });
});

/**
 * The card's binding acceptance criterion, pinned end-to-end rather than
 * inferred from the registry entry (the #14148 precedent): the measured
 * positions must fail `validate` AND `build`. `build` is the publish gate and
 * is where these currently ship, so a validate-only fix was not acceptable —
 * and nothing else in this file would notice if the suite entry's `commands`
 * were narrowed later.
 */
describe('#14107 acceptance — the measured positions gate `validate` AND `build`', () => {
  const limbs: Array<[string, AnyRec]> = [
    ['columns[].field', { columns: [{ field: 'B2_no_such_field' }] }],
    ['filter[].field', { filter: [{ field: 'A8_no_such_field', operator: 'equals', value: 'x' }] }],
    ['grouping.fields[].field', { grouping: { fields: [{ field: 'A7_no_such_field' }] } }],
    ['kanban.groupByField', { kanban: { groupByField: 'A9_no_such_field' } }],
    ['gantt.startDateField', { gantt: { startDateField: 'B1_no_such_field' } }],
  ];

  for (const command of ['validate', 'build'] as const) {
    for (const [label, patch] of limbs) {
      it(`${label} fails \`${command}\``, () => {
        const normalized = stackWith(mutate(patch));
        const { errors } = splitBySeverity(runAuthoringRules(command, { normalized }));
        expect(errors.map((f) => f.rule)).toContain(LIST_VIEW_FIELD_UNKNOWN);
      });
    }

    it(`the clean list view passes \`${command}\``, () => {
      const { errors, advisories } = splitBySeverity(
        runAuthoringRules(command, { normalized: stackWith(FULL_LIST_VIEW) }),
      );
      expect([...errors, ...advisories].filter((f) => f.rule === LIST_VIEW_FIELD_UNKNOWN)).toEqual([]);
    });
  }

  it('a warning-tier position advises rather than gates', () => {
    const normalized = stackWith(mutate({ hiddenFields: ['nope'] }));
    const { errors, advisories } = splitBySeverity(runAuthoringRules('build', { normalized }));
    expect(errors.map((f) => f.rule)).not.toContain(LIST_VIEW_FIELD_UNKNOWN);
    expect(advisories.map((f) => f.rule)).toContain(LIST_VIEW_FIELD_UNKNOWN);
  });
});
