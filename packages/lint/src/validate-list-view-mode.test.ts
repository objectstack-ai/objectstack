import { describe, it, expect } from 'vitest';
import { validateListViewMode, LIST_VIEW_FILTERS_IN_VIEWS_MODE } from './validate-list-view-mode.js';

describe('validateListViewMode (ADR-0053 views-mode guardrail)', () => {
  it('passes a clean stack — object listViews without page-only filters', () => {
    const findings = validateListViewMode({
      objects: [
        { name: 'task', listViews: { my_pending: { label: 'My Pending', filter: [] } } },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it('flags userFilters on an object built-in list view, with location + hint', () => {
    const findings = validateListViewMode({
      objects: [
        { name: 'task', listViews: { tabular: { label: 'Tabular', userFilters: { element: 'dropdown' } } } },
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
    expect(findings[0].hint).toContain('filters');
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

  it('flags userFilters on a defineView default list AND named listViews', () => {
    const findings = validateListViewMode({
      views: [
        {
          objectName: 'task',
          list: { userFilters: { element: 'tabs' } },
          listViews: { mine: { label: 'Mine', userFilters: { element: 'dropdown' } } },
        },
      ],
    });
    expect(findings).toHaveLength(2);
    const paths = findings.map((f) => f.path).sort();
    expect(paths).toEqual(['views[0].list.userFilters', 'views[0].listViews.mine.userFilters']);
    expect(findings.every((f) => f.where.includes('task'))).toBe(true);
  });

  it('handles the name-keyed map form of objects', () => {
    const findings = validateListViewMode({
      objects: { task: { listViews: { t: { userFilters: { element: 'dropdown' } } } } },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toContain('task');
  });

  it('stays silent on an empty stack', () => {
    expect(validateListViewMode({})).toHaveLength(0);
  });
});
