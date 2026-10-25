/**
 * element:metadata_viewer (ADR-0051) — read-only live metadata views.
 *
 * Renders the component through ComponentRegistry (the same path a
 * ```metadata doc fence and a page node both use) with a mocked metadata
 * context, and asserts each of the three view kinds plus graceful
 * degradation.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { MetadataCtx } from '@object-ui/react';
import '../renderers/basic/metadata-viewer';

function metaCtx(getItem: (type: string, name: string) => Promise<any>) {
  return {
    apps: [], objects: [], dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
    getItem, getItemsByType: () => [], getTypeStatus: () => 'ready' as const,
  };
}

function Viewer({ properties, getItem }: { properties: any; getItem: (t: string, n: string) => Promise<any> }) {
  const C = ComponentRegistry.get('element:metadata_viewer');
  if (!C) throw new Error('element:metadata_viewer not registered');
  return (
    <MetadataCtx.Provider value={metaCtx(getItem) as any}>
      {/* eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render */}
      <C schema={{ type: 'element:metadata_viewer', properties }} />
    </MetadataCtx.Provider>
  );
}

const TASK_OBJECT = {
  name: 'showcase_task',
  fields: {
    status: {
      type: 'select',
      options: [
        { value: 'backlog', label: 'Backlog', color: '#94A3B8', default: true },
        { value: 'todo', label: 'To Do', color: '#3B82F6' },
        { value: 'in_progress', label: 'In Progress', color: '#F59E0B' },
        { value: 'done', label: 'Done', color: '#10B981' },
      ],
    },
  },
  validations: [
    {
      type: 'state_machine',
      name: 'task_status_flow',
      label: 'Task Status Flow',
      field: 'status',
      transitions: {
        backlog: ['todo'],
        todo: ['in_progress', 'backlog'],
        in_progress: ['done'],
        done: [],
      },
    },
  ],
};

describe('element:metadata_viewer', () => {
  it('registers as a component', () => {
    expect(ComponentRegistry.get('element:metadata_viewer')).toBeTruthy();
  });

  describe('state_machine', () => {
    it('renders the transition graph with option labels, initial + final badges', async () => {
      const getItem = vi.fn(async (type: string) => (type === 'object' ? TASK_OBJECT : null));
      render(<Viewer getItem={getItem} properties={{ type: 'state_machine', object: 'showcase_task', name: 'task_status_flow' }} />);

      await waitFor(() => expect(screen.getByText('Task Status Flow')).toBeTruthy());
      // option label, not the raw value
      expect(screen.getAllByText('Backlog').length).toBeGreaterThan(0);
      expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
      // backlog is the default option → initial; done has no outgoing → final
      expect(screen.getByText(/initial/i)).toBeTruthy();
      expect(screen.getByText(/final/i)).toBeTruthy();
      expect(getItem).toHaveBeenCalledWith('object', 'showcase_task');
    });

    it('warns when the named rule is absent', async () => {
      const getItem = vi.fn(async () => ({ name: 'x', validations: [] }));
      render(<Viewer getItem={getItem} properties={{ type: 'state_machine', object: 'x', name: 'nope' }} />);
      await waitFor(() => expect(screen.getByText(/No state machine/i)).toBeTruthy());
    });
  });

  describe('flow', () => {
    const FLOW = {
      name: 'reassign',
      label: 'Reassign Task',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 's1', type: 'script', label: 'Do Plumbing' },
        { id: 'end', type: 'end', label: 'End' },
      ],
    };

    it('folds technical nodes at business altitude (default)', async () => {
      const getItem = vi.fn(async () => FLOW);
      render(<Viewer getItem={getItem} properties={{ type: 'flow', name: 'reassign' }} />);
      await waitFor(() => expect(screen.getByText('Reassign Task')).toBeTruthy());
      expect(screen.getByText('Start')).toBeTruthy();
      expect(screen.getByText('End')).toBeTruthy();
      expect(screen.queryByText('Do Plumbing')).toBeNull(); // script folded
      expect(screen.getByText(/technical step.*hidden/i)).toBeTruthy();
    });

    it('shows technical nodes when detail=technical', async () => {
      const getItem = vi.fn(async () => FLOW);
      render(<Viewer getItem={getItem} properties={{ type: 'flow', name: 'reassign', detail: 'technical' }} />);
      await waitFor(() => expect(screen.getByText('Do Plumbing')).toBeTruthy());
    });

    // objectui#12742 — `http` is the spec's HTTP node type (spec 18 reserves
    // `http_request`, `http_call` and `webhook`), so it is the one folded away.
    it('folds an `http` node at business altitude and shows it at technical', async () => {
      const HTTP_FLOW = {
        name: 'billing_handoff',
        label: 'Billing Hand-off',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'h', type: 'http', label: 'Enqueue Billing Hand-off' },
          { id: 'end', type: 'end', label: 'End' },
        ],
      };
      const getItem = vi.fn(async () => HTTP_FLOW);
      render(<Viewer getItem={getItem} properties={{ type: 'flow', name: 'billing_handoff' }} />);
      await waitFor(() => expect(screen.getByText('Billing Hand-off')).toBeTruthy());
      expect(screen.queryByText('Enqueue Billing Hand-off')).toBeNull();
      expect(screen.getByText(/technical step.*hidden/i)).toBeTruthy();
      cleanup();

      render(<Viewer getItem={getItem} properties={{ type: 'flow', name: 'billing_handoff', detail: 'technical' }} />);
      await waitFor(() => expect(screen.getByText('Enqueue Billing Hand-off')).toBeTruthy());
    });
  });

  describe('permission', () => {
    it('renders an object CRUD matrix', async () => {
      const getItem = vi.fn(async () => ({
        name: 'contributor',
        label: 'Contributor',
        objects: { showcase_task: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false } },
      }));
      render(<Viewer getItem={getItem} properties={{ type: 'permission', name: 'contributor' }} />);
      await waitFor(() => expect(screen.getByText('Contributor')).toBeTruthy());
      expect(screen.getByText('showcase_task')).toBeTruthy();
    });
  });

  it('degrades on an unknown view type', () => {
    render(<Viewer getItem={async () => null} properties={{ type: 'nonsense' }} />);
    expect(screen.getByText(/Unknown metadata view type/i)).toBeTruthy();
  });
});
