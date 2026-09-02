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
  kanban: { groupByField: 'status', summarizeField: 'estimate', columns: ['title'] },
  calendar: {
    startDateField: 'due_at',
    endDateField: 'visible_from',
    titleField: 'title',
    colorField: 'status',
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
 */
describe('#14107 — the card\'s five measured positions', () => {
  const cases: Array<[string, AnyRec, string]> = [
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

  for (const [label, patch, path] of cases) {
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
 * Every remaining position, with the severity tier it earns. The table is the
 * readable half of the rule's own POSITIONS table: a position dropped from the
 * rule fails here, and a position added to the rule without a row here leaves
 * the count assertion below short.
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
    [{ calendar: { endDateField: BAD } }, 'views[0].list.calendar.endDateField', 'warning'],
    [{ calendar: { titleField: BAD } }, 'views[0].list.calendar.titleField', 'warning'],
    [{ calendar: { colorField: BAD } }, 'views[0].list.calendar.colorField', 'warning'],
    [{ calendar: { startDateField: BAD } }, 'views[0].list.calendar.startDateField', 'error'],
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

  // A floor, so a position quietly dropped from the rule's table cannot pass
  // by simply never being asserted.
  it('covers every position the rule walks', () => {
    expect(cases.length).toBeGreaterThanOrEqual(46);
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
 * compiles no joins and all three runtime doors refuse a dotted reference.
 * Both halves are pinned — the half that reports, and the half that stays
 * deliberately silent — so a later "improvement" that starts walking hops has
 * to delete a test that says why.
 */
describe('#14107 — dotted paths', () => {
  it('a dotted path whose HEAD resolves to nothing is reported', () => {
    const findings = validateListViewFieldRefs(stackWith(mutate({ columns: [{ field: 'ownr.name' }] })));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('"ownr"');
    // The author reads back what they typed, not only the segment judged.
    expect(findings[0].message).toContain('ownr.name');
    expect(findings[0].message).toContain('compiles');
  });

  it('a dotted path whose head resolves is left to the runtime doors', () => {
    const findings = validateListViewFieldRefs(stackWith(mutate({ columns: [{ field: 'owner.name' }] })));
    expect(findings).toEqual([]);
  });

  it('a dotted path through a non-relationship head is also left alone', () => {
    // `title` is a text field; `title.x` is refused at query time, not here.
    const findings = validateListViewFieldRefs(stackWith(mutate({ columns: [{ field: 'title.x' }] })));
    expect(findings).toEqual([]);
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
