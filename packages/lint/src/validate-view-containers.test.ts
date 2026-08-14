import { describe, it, expect } from 'vitest';
import { validateViewContainers, VIEW_CONTAINER_SHAPE } from './validate-view-containers.js';

describe('validateViewContainers (defineView container shape guardrail)', () => {
  it('passes a proper container with a default list', () => {
    const findings = validateViewContainers({
      views: [
        { list: { type: 'grid', data: { provider: 'object', object: 'task' }, columns: ['title'] } },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it('passes a container with only named listViews / formViews', () => {
    const findings = validateViewContainers({
      views: [
        { listViews: { urgent: { type: 'grid', columns: ['title'] } } },
        { formViews: { edit: { type: 'simple', sections: [{ fields: ['title'] }] } } },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  // [#5320] Inverted from "passes an independent ViewItem": the loader's
  // as-is registration of ViewItems from `views:` was the undeclared wider
  // acceptance this card removed, and the pre-parse door now reaches the same
  // verdict the schema and the registration loop enforce.
  it('flags an independent ViewItem in `views:` with the wrap-it prescription (#5320)', () => {
    const findings = validateViewContainers({
      views: [
        {
          name: 'task.pipeline',
          object: 'task',
          viewKind: 'list',
          config: { type: 'kanban', columns: ['title'] },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: VIEW_CONTAINER_SHAPE,
      path: 'views[0]',
    });
    expect(findings[0].where).toContain('task.pipeline');
    expect(findings[0].message).toContain('containers only');
    expect(findings[0].hint).toContain('defineView');
    expect(findings[0].hint).toContain('metadata door');
  });

  it('flags a hand-authored `viewItems:` as machine-assembled-only (#5320)', () => {
    const findings = validateViewContainers({
      viewItems: [
        {
          name: 'task.pipeline',
          object: 'task',
          viewKind: 'list',
          config: { type: 'kanban', columns: ['title'] },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: VIEW_CONTAINER_SHAPE,
      path: 'viewItems',
    });
    expect(findings[0].message).toContain('machine-assembled');
    expect(findings[0].hint).toContain('metadata door');
  });

  it('flags a flat list-view object with the wrap-it hint', () => {
    const findings = validateViewContainers({
      views: [
        {
          name: 'all_tasks',
          label: 'All Tasks',
          type: 'grid',
          data: { provider: 'object', object: 'task' },
          columns: ['title', 'status'],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: VIEW_CONTAINER_SHAPE,
      path: 'views[0]',
    });
    expect(findings[0].where).toContain('all_tasks');
    expect(findings[0].message).toContain('Flat list-view object');
    expect(findings[0].hint).toContain('defineView');
  });

  it('flags a container whose slots are all empty', () => {
    const findings = validateViewContainers({
      views: [{ listViews: {}, formViews: {} }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('defines no views');
  });

  it('handles a name-keyed views map', () => {
    const findings = validateViewContainers({
      views: {
        task: { list: { type: 'grid', columns: ['title'] } },
        broken: { type: 'grid', columns: ['title'] },
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('views.broken');
  });

  it('ignores non-object entries and stacks without views', () => {
    expect(validateViewContainers({})).toHaveLength(0);
    expect(validateViewContainers({ views: [null, 42, 'x'] as unknown as [] })).toHaveLength(0);
  });
});
