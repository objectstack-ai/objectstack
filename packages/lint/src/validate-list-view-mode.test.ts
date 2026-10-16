import { describe, it, expect } from 'vitest';
import { validateListViewMode, LIST_VIEW_FILTERS_IN_VIEWS_MODE } from './validate-list-view-mode.js';
import { explainRule } from './rule-explanations.js';

describe('validateListViewMode (ADR-0047 views-mode guardrail)', () => {
  it('passes a clean stack — object listViews without page-only filters', () => {
    const findings = validateListViewMode({
      objects: [
        { name: 'task', listViews: { my_pending: { label: 'My Pending', filter: [] } } },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it('allows a dropdown userFilters on an object built-in list view', () => {
    const findings = validateListViewMode({
      objects: [
        { name: 'task', listViews: { tabular: { label: 'Tabular', userFilters: { element: 'dropdown', fields: [{ field: 'status' }] } } } },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it('flags a tabs userFilters on an object built-in list view, with location + hint', () => {
    const findings = validateListViewMode({
      objects: [
        { name: 'task', listViews: { tabular: { label: 'Tabular', userFilters: { element: 'tabs' } } } },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: LIST_VIEW_FILTERS_IN_VIEWS_MODE,
      path: 'objects[0].listViews.tabular.userFilters',
    });
    expect(findings[0].where).toContain('task');
    expect(findings[0].message).toContain('views');
    expect(findings[0].hint).toContain('listViews');
  });

  it('flags a userFilters that carries a tabs array even without element: "tabs"', () => {
    const findings = validateListViewMode({
      objects: [
        { name: 'task', listViews: { t: { userFilters: { tabs: [{ label: 'Mine', filter: [] }] } } } },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].listViews.t.userFilters');
  });

  it('flags quickFilters too', () => {
    const findings = validateListViewMode({
      objects: [
        { name: 'task', listViews: { all: { label: 'All', quickFilters: [{ field: 'status' }] } } },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].listViews.all.quickFilters');
  });

  it('flags a tabs userFilters on a defineView default list but allows a dropdown named listView', () => {
    const findings = validateListViewMode({
      views: [
        {
          objectName: 'task',
          list: { userFilters: { element: 'tabs' } },
          listViews: { mine: { label: 'Mine', userFilters: { element: 'dropdown' } } },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('views[0].list.userFilters');
    expect(findings[0].where).toContain('task');
  });

  it('handles the name-keyed map form of objects', () => {
    const findings = validateListViewMode({
      objects: { task: { listViews: { t: { userFilters: { element: 'tabs' } } } } },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toContain('task');
  });

  it('stays silent on an empty stack', () => {
    expect(validateListViewMode({})).toHaveLength(0);
  });
});

// [#22161] Slice 19: each `fix:` line is one remedy line of at most 200
// characters; why each alternative fits and ADR-0047 are the explanation's.
describe('[#22161] one-line fix — list-view-filters-in-views-mode', () => {
  it('both arms print one remedy line, and `os explain` carries the rest', () => {
    const findings = validateListViewMode({
      objects: [{
        name: 'task',
        listViews: {
          a: { label: 'A', quickFilters: [{ field: 'status' }] },
          b: { label: 'B', userFilters: { element: 'tabs' } },
        },
      }],
    });
    expect(findings.map((f) => f.hint)).toEqual([
      'Move `quickFilters` to a page list (InterfaceListPage, "filters" mode), or remove it. See ADR-0047.',
      'Use `listViews` for named presets, `element: "dropdown"` for value chips, or move the `tabs` filter to a ' +
        'page list (InterfaceListPage).',
    ]);
    for (const f of findings) expect(f.hint.length).toBeLessThanOrEqual(200);
    const text = explainRule(LIST_VIEW_FILTERS_IN_VIEWS_MODE)!.paragraphs.join('\n');
    for (const fact of ['ViewTabBar', 'segmented', 'ADR-0047', '"filters" mode', '`element: "tabs"`']) expect(text, fact).toContain(fact);
  });
});
