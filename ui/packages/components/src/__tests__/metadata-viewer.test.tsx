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
import { createI18n, I18nProvider, transformSpecTranslations } from '@object-ui/i18n';
import type { TranslationData } from '@objectstack/spec/system';
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

    it('paints a state dot from the theme grey when its option has no colour, and from the declared colour otherwise', async () => {
      const object = {
        name: 'ticket',
        fields: {
          stage: {
            type: 'select',
            options: [
              { value: 'open', label: 'Open', default: true },
              { value: 'closed', label: 'Closed', color: '#10B981' },
            ],
          },
        },
        validations: [
          { type: 'state_machine', name: 'stage_flow', label: 'Stage Flow', field: 'stage', transitions: { open: ['closed'], closed: [] } },
        ],
      };
      const getItem = vi.fn(async (type: string) => (type === 'object' ? object : null));
      const { container } = render(<Viewer getItem={getItem} properties={{ type: 'state_machine', object: 'ticket', name: 'stage_flow' }} />);
      await waitFor(() => expect(screen.getByText('Stage Flow')).toBeTruthy());

      const open = [...container.querySelectorAll<HTMLElement>('[data-state-dot="open"]')];
      expect(open.length).toBeGreaterThan(0);
      for (const dot of open) {
        // The muted grey is a utility, so the theme (light and .dark) decides it.
        expect(dot.className).toContain('bg-muted-foreground');
        expect(dot.getAttribute('style')).toBeNull();
      }

      const closed = [...container.querySelectorAll<HTMLElement>('[data-state-dot="closed"]')];
      expect(closed.length).toBeGreaterThan(0);
      for (const dot of closed) {
        expect(dot.className).toContain('bg-[color:var(--os-state-dot)]');
        expect(dot.style.getPropertyValue('--os-state-dot')).toBe('#10B981');
        expect(dot.style.backgroundColor).toBe('');
      }
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


/**
 * A `type: flow` embed names the flow and each step the spec lets a package
 * translate in the reader's language: `flows.<flow>.label` and an `approval`
 * node's `flows.<flow>.approvals.<node_id>.label`, read from the package bundle
 * the host loaded, through the resolution the Studio flow designer uses. A step
 * with no key (start, decision, notify, end) and a key the bundle does not
 * carry fall back to the authored text.
 */
describe('element:metadata_viewer flow embed: package label translations (flows.FLOW.label, approvals.STEP.label)', () => {
  const OPPORTUNITY_APPROVAL = {
    name: 'opportunity_approval',
    label: 'Large Deal Approval',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'get_opportunity', type: 'get_record', label: 'Get Opportunity' },
      { id: 'manager_review', type: 'approval', label: 'Sales Manager Review' },
      { id: 'check_high_value', type: 'decision', label: 'High Value (> $500K)?' },
      { id: 'director_signoff', type: 'approval', label: 'Sales Director Sign-off' },
      { id: 'notify_approved', type: 'notify', label: 'Email Owner — Approved' },
      { id: 'end', type: 'end', label: 'End' },
    ],
  };

  function zhCN(data: TranslationData) {
    const instance = createI18n({ defaultLanguage: 'zh-CN', detectBrowserLanguage: false });
    instance.addResourceBundle('zh-CN', 'translation', transformSpecTranslations(data as Record<string, unknown>), true, true);
    return instance;
  }

  function renderIn(data: TranslationData, flow = OPPORTUNITY_APPROVAL) {
    const getItem = vi.fn(async () => flow);
    return render(
      <I18nProvider instance={zhCN(data)} persistLanguage={false}>
        <Viewer getItem={getItem} properties={{ type: 'flow', name: flow.name }} />
      </I18nProvider>,
    );
  }

  it('draws the translated flow label and approval-step labels; a step with no key keeps its authored label', async () => {
    renderIn({
      flows: {
        opportunity_approval: {
          label: '大额商机审批',
          approvals: { manager_review: { label: '销售经理审核' }, director_signoff: { label: '销售总监签批' } },
        },
      },
    });
    await waitFor(() => expect(screen.getByText('大额商机审批')).toBeTruthy());
    expect(screen.queryByText('Large Deal Approval')).toBeNull();
    expect(screen.getByText('销售经理审核')).toBeTruthy();
    expect(screen.getByText('销售总监签批')).toBeTruthy();
    expect(screen.queryByText('Sales Manager Review')).toBeNull();
    expect(screen.queryByText('Sales Director Sign-off')).toBeNull();
    // start, decision, notify and end have no key in the spec's flows group.
    for (const authored of ['Start', 'High Value (> $500K)?', 'Email Owner — Approved', 'End']) {
      expect(screen.getByText(authored)).toBeTruthy();
    }
  });

  it('falls back to the authored text where the bundle carries no key', async () => {
    // The flow is in the bundle, but neither its label nor one approval step is.
    renderIn({ flows: { opportunity_approval: { approvals: { manager_review: { label: '销售经理审核' } } } } });
    await waitFor(() => expect(screen.getByText('Large Deal Approval')).toBeTruthy());
    expect(screen.getByText('销售经理审核')).toBeTruthy();
    expect(screen.getByText('Sales Director Sign-off')).toBeTruthy();
    cleanup();

    // The bundle translates another flow only: everything stays authored.
    renderIn({ flows: { other_flow: { label: '其他流程' } } });
    await waitFor(() => expect(screen.getByText('Large Deal Approval')).toBeTruthy());
    expect(screen.getByText('Sales Manager Review')).toBeTruthy();
  });
});
