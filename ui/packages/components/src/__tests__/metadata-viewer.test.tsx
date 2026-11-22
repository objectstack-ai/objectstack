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
import { createI18n, I18nProvider, LocalizationProvider, transformSpecTranslations } from '@object-ui/i18n';
import type { TranslationData } from '@objectstack/spec/system';
import { FLOW_TECHNICAL_NODE_TYPES } from '@objectstack/spec/automation';
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
 * the host loaded, through the resolution the Studio flow designer uses. A key
 * the bundle does not carry falls back to the authored text. (Every other
 * drawn step's `nodes.<node_id>.label` is pinned in the describe after this.)
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
    // The bundle carries no `nodes` key for start, decision, notify or end, so they keep their authored labels.
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

  it('names an approval step a decision branch leads to by its translated label too', async () => {
    const cel = (source: string) => ({ dialect: 'cel', source });
    const flow = {
      name: 'opportunity_approval',
      label: 'Large Deal Approval',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: 'crm_opportunity' } },
        { id: 'get_opportunity', type: 'get_record', label: 'Get Opportunity', config: { objectName: 'crm_opportunity', outputVariable: 'oppRecord' } },
        { id: 'check_high_value', type: 'decision', label: 'High Value?' },
        { id: 'director_signoff', type: 'approval', label: 'Sales Director Sign-off' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'get_opportunity' },
        { id: 'e2', source: 'get_opportunity', target: 'check_high_value' },
        { id: 'e3', source: 'check_high_value', target: 'director_signoff', type: 'conditional',
          condition: cel('vars.oppRecord.amount > 500000') },
        { id: 'e4', source: 'check_high_value', target: 'end', isDefault: true },
        { id: 'e5', source: 'director_signoff', target: 'end' },
      ],
    };
    const deal = { name: 'crm_opportunity', fields: { amount: { type: 'currency', label: 'Amount' } } };
    const getItem = vi.fn(async (type: string) => (type === 'object' ? deal : flow));
    const { container } = render(
      <I18nProvider
        instance={zhCN({ flows: { opportunity_approval: { approvals: { director_signoff: { label: '销售总监签批' } } } } })}
        persistLanguage={false}
      >
        <Viewer getItem={getItem} properties={{ type: 'flow', name: 'opportunity_approval' }} />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-flow-branches="check_high_value"] [data-branch-target="director_signoff"]')).toBeTruthy(),
    );
    const target = container.querySelector('[data-flow-branches="check_high_value"] [data-branch-target="director_signoff"]')!;
    expect(target.textContent).toContain('销售总监签批');
    expect(container.textContent).not.toContain('Sales Director Sign-off');
  });
});

/**
 * Ruling 7076440876 (objectstack#35979, option A): every step the business
 * view draws has a key. A start, decision, notify or end step is named by
 * `flows.<flow>.nodes.<node_id>.label`; an untitled screen by
 * `screens.<node_id>.title`; a titled screen by its heading, translated under
 * that same key, unless the heading holds a `{{ }}` hole a drawing cannot fill.
 * The steps folded away are the spec's `FLOW_TECHNICAL_NODE_TYPES`, the table
 * the i18n coverage check reads to ask for exactly these translations.
 */
describe('element:metadata_viewer flow embed: every drawn step by its key (flows.FLOW.nodes.NODE.label)', () => {
  function zhCN(data: TranslationData) {
    const instance = createI18n({ defaultLanguage: 'zh-CN', detectBrowserLanguage: false });
    instance.addResourceBundle('zh-CN', 'translation', transformSpecTranslations(data as Record<string, unknown>), true, true);
    return instance;
  }
  // Each render gets its own instance, so "no bundle" (`{}`) never sees an earlier test's resources.
  function renderIn(data: TranslationData, flow: any, getObject?: () => Promise<any>) {
    const getItem = vi.fn(async (type: string) => (type === 'object' && getObject ? getObject() : flow));
    return render(
      <I18nProvider instance={zhCN(data)} persistLanguage={false}>
        <Viewer getItem={getItem} properties={{ type: 'flow', name: flow.name }} />
      </I18nProvider>,
    );
  }

  const ONBOARDING = {
    name: 'onboarding',
    label: 'Onboarding',
    nodes: [
      { id: 'start', type: 'start', label: 'On Hire' },
      { id: 'pick_path', type: 'decision', label: 'Remote?' },
      { id: 'tell_it', type: 'notify', label: 'Tell IT' },
      { id: 'save', type: 'update_record', label: 'Save Hire' },
      { id: 'confirm', type: 'screen', label: 'Confirm' },
      { id: 'welcome', type: 'screen', label: 'Welcome screen', config: { title: 'Welcome aboard' } },
      { id: 'greet', type: 'screen', label: 'Greeting screen', config: { title: 'Hello {{vars.name}}' } },
      { id: 'end', type: 'end', label: 'Onboarded' },
    ],
  };
  const ZH: TranslationData = {
    flows: {
      onboarding: {
        nodes: { start: { label: '入职时' }, pick_path: { label: '远程？' }, tell_it: { label: '通知 IT' }, end: { label: '已入职' } },
        screens: { confirm: { title: '确认' }, welcome: { title: '欢迎加入' }, greet: { title: '你好 {{vars.name}}' } },
      },
    },
  };

  it('names start, decision, notify and end steps by their nodes key, and an untitled screen by its screens title', async () => {
    renderIn(ZH, ONBOARDING);
    await waitFor(() => expect(screen.getByText('入职时')).toBeTruthy());
    for (const zh of ['远程？', '通知 IT', '已入职', '确认']) expect(screen.getByText(zh)).toBeTruthy();
    for (const en of ['On Hire', 'Remote?', 'Tell IT', 'Onboarded', 'Confirm']) expect(screen.queryByText(en)).toBeNull();
    // The technical record write stays folded away, translated or not.
    expect(screen.queryByText('Save Hire')).toBeNull();
  });

  it('names a titled screen by its heading, translated where the bundle carries it, and keeps the label for a heading with a hole', async () => {
    renderIn(ZH, ONBOARDING);
    await waitFor(() => expect(screen.getByText('欢迎加入')).toBeTruthy());
    expect(screen.queryByText('Welcome screen')).toBeNull();
    // `Hello {{vars.name}}` cannot be filled in a drawing: the authored label, which has no key, stands.
    expect(screen.getByText('Greeting screen')).toBeTruthy();
    expect(screen.queryByText(/你好/)).toBeNull();
    cleanup();

    // No bundle: the heading itself, untranslated.
    renderIn({}, ONBOARDING);
    await waitFor(() => expect(screen.getByText('Welcome aboard')).toBeTruthy());
    expect(screen.getByText('On Hire')).toBeTruthy();
    expect(screen.getByText('Greeting screen')).toBeTruthy();
  });

  it('names the step a decision branch leads to by its nodes key too', async () => {
    const flow = {
      name: 'onboarding',
      label: 'Onboarding',
      nodes: [
        { id: 'start', type: 'start', label: 'On Hire', config: { objectName: 'hr_hire' } },
        { id: 'pick_path', type: 'decision', label: 'Remote?' },
        { id: 'tell_it', type: 'notify', label: 'Tell IT' },
        { id: 'end', type: 'end', label: 'Onboarded' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'pick_path' },
        { id: 'e2', source: 'pick_path', target: 'tell_it', type: 'conditional', condition: { dialect: 'cel', source: 'record.remote == true' } },
        { id: 'e3', source: 'pick_path', target: 'end', isDefault: true },
      ],
    };
    const hire = { name: 'hr_hire', fields: { remote: { type: 'boolean', label: 'Remote' } } };
    const { container } = renderIn(ZH, flow, async () => hire);
    await waitFor(() => expect(container.querySelector('[data-flow-branches="pick_path"] [data-branch-target="end"]')).toBeTruthy());
    expect(container.querySelector('[data-flow-branches="pick_path"] [data-branch-target="tell_it"]')!.textContent).toContain('通知 IT');
    expect(container.querySelector('[data-flow-branches="pick_path"] [data-branch-target="end"]')!.textContent).toContain('已入职');
  });

  it('folds away exactly the spec table at business altitude', async () => {
    const flow = {
      name: 'plumbing',
      label: 'Plumbing',
      nodes: [
        { id: 'start', type: 'start', label: 'Begin' },
        ...FLOW_TECHNICAL_NODE_TYPES.map((type) => ({ id: `n_${type}`, type, label: `step ${type}` })),
      ],
    };
    const { container } = renderIn({}, flow);
    await waitFor(() => expect(screen.getByText('Begin')).toBeTruthy());
    for (const type of FLOW_TECHNICAL_NODE_TYPES) expect(screen.queryByText(`step ${type}`)).toBeNull();
    expect(container.querySelectorAll('ol > li')).toHaveLength(1);
  });
});

// objectstack#36094 — the business view draws each decision's branches with
// its condition read from the LIVE definition: the served flow, the edges'
// `{ dialect: 'cel', source }` envelopes, and the label and currency of the
// field from the flow's object.
describe('element:metadata_viewer flow branches (objectstack#36094)', () => {
  const DEAL = {
    name: 'crm_opportunity',
    fields: {
      amount: { type: 'currency', label: 'Amount' },
      updated_by: { type: 'lookup', label: 'Updated By' },
    },
  };
  const cel = (source: string) => ({ dialect: 'cel', source });
  const approvalFlow = (threshold: number) => ({
    name: 'opportunity_approval',
    label: 'Large Deal Approval',
    nodes: [
      {
        id: 'start', type: 'start', label: 'Start',
        config: {
          objectName: 'crm_opportunity',
          condition: cel(`has(record.amount) && record.amount != null && record.amount >= 100000
            && (!has(record.approval_status) || record.approval_status == "not_required")
            && (!has(record.stage) || record.stage != "closed_won")`),
        },
      },
      { id: 'get_opportunity', type: 'get_record', label: 'Get Opportunity', config: { objectName: 'crm_opportunity', outputVariable: 'oppRecord' } },
      { id: 'check_high_value', type: 'decision', label: 'High Value?' },
      { id: 'director_signoff', type: 'approval', label: 'Sales Director Sign-off' },
      { id: 'mark_approved', type: 'update_record', label: 'Mark Approved' },
      { id: 'check_owner', type: 'decision', label: 'Owner Submitted?' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'get_opportunity' },
      { id: 'e2', source: 'get_opportunity', target: 'check_high_value' },
      { id: 'e5', source: 'check_high_value', target: 'director_signoff', type: 'conditional',
        condition: cel(`has(vars.oppRecord) && has(vars.oppRecord.amount)
          && vars.oppRecord.amount != null && vars.oppRecord.amount > ${threshold}`) },
      { id: 'e6', source: 'check_high_value', target: 'mark_approved', type: 'conditional',
        condition: cel(`!has(vars.oppRecord) || !has(vars.oppRecord.amount)
          || vars.oppRecord.amount == null || vars.oppRecord.amount <= ${threshold}`) },
      { id: 'e7', source: 'director_signoff', target: 'mark_approved' },
      { id: 'e9', source: 'mark_approved', target: 'check_owner' },
      { id: 'e13', source: 'check_owner', target: 'end', type: 'conditional',
        condition: cel('has(record.updated_by) && record.updated_by == vars.oppRecord.owner_id') },
      { id: 'e14', source: 'check_owner', target: 'end', isDefault: true },
    ],
  });
  const served = (flow: unknown) => vi.fn(async (type: string) => (type === 'object' ? DEAL : flow));
  const branch = (container: HTMLElement, decision: string, target: string) =>
    container.querySelector(`[data-flow-branches="${decision}"] [data-branch-target="${target}"]`);

  it('draws a decision’s branches with the amount condition, locale-formatted, beside each target', async () => {
    const getItem = served(approvalFlow(500000));
    const { container } = render(<Viewer getItem={getItem} properties={{ type: 'flow', name: 'opportunity_approval' }} />);
    await waitFor(() => expect(screen.getByText('Large Deal Approval')).toBeTruthy());

    expect(branch(container, 'check_high_value', 'director_signoff')?.textContent).toBe('Amount > 500,000Sales Director Sign-off');
    expect(branch(container, 'check_high_value', 'mark_approved')?.textContent).toBe('Amount ≤ 500,000Mark Approved');
    // One extra request, for the flow's object.
    expect(getItem).toHaveBeenCalledWith('object', 'crm_opportunity');
    // The entry condition, once, with its unread terms named rather than dropped.
    expect(container.querySelector('[data-flow-entry]')?.textContent).toBe('Runs when Amount ≥ 100,000 and other conditions');
  });

  it('draws the new amount when the served definition’s threshold changes', async () => {
    const { container } = render(<Viewer getItem={served(approvalFlow(750000))} properties={{ type: 'flow', name: 'opportunity_approval' }} />);
    await waitFor(() => expect(screen.getByText('Large Deal Approval')).toBeTruthy());
    expect(branch(container, 'check_high_value', 'director_signoff')?.textContent).toBe('Amount > 750,000Sales Director Sign-off');
    expect(container.textContent).not.toContain('500,000');
  });

  it('waits for the flow’s object before drawing a condition, so none is drawn unread first', async () => {
    let release!: (object: unknown) => void;
    const objectServed = new Promise((resolve) => {
      release = resolve;
    });
    const getItem = vi.fn((type: string) => (type === 'object' ? objectServed : Promise.resolve(approvalFlow(500000))));
    const { container } = render(<Viewer getItem={getItem} properties={{ type: 'flow', name: 'opportunity_approval' }} />);
    await waitFor(() => expect(getItem).toHaveBeenCalledWith('object', 'crm_opportunity'));
    expect(container.querySelector('[data-condition]')).toBeNull();
    expect(container.textContent).toContain('Loading');
    release(DEAL);
    await waitFor(() =>
      expect(branch(container, 'check_high_value', 'director_signoff')?.textContent).toBe('Amount > 500,000Sales Director Sign-off'),
    );
  });

  it('formats the amount in the tenant currency when one is configured', async () => {
    const { container } = render(
      <LocalizationProvider value={{ currency: 'USD', locale: 'en-US' }}>
        <Viewer getItem={served(approvalFlow(500000))} properties={{ type: 'flow', name: 'opportunity_approval' }} />
      </LocalizationProvider>,
    );
    await waitFor(() => expect(screen.getByText('Large Deal Approval')).toBeTruthy());
    expect(branch(container, 'check_high_value', 'director_signoff')?.textContent).toBe('Amount > $500,000Sales Director Sign-off');
  });

  it('shows a neutral marker for a condition too complex to read, never the raw CEL', async () => {
    const { container } = render(<Viewer getItem={served(approvalFlow(500000))} properties={{ type: 'flow', name: 'opportunity_approval' }} />);
    await waitFor(() => expect(screen.getByText('Large Deal Approval')).toBeTruthy());
    const opaque = branch(container, 'check_owner', 'end')!;
    expect(opaque.querySelector('[data-condition="opaque"]')?.textContent).toBe('condition');
    expect(container.querySelector('[data-condition="otherwise"]')?.textContent).toBe('otherwise');
    expect(container.textContent).not.toContain('updated_by');
    expect(container.textContent).not.toContain('has(');
  });

  it('keeps the technical view as it was: no branches, no entry condition, no object request', async () => {
    const getItem = served(approvalFlow(500000));
    const { container } = render(<Viewer getItem={getItem} properties={{ type: 'flow', name: 'opportunity_approval', detail: 'technical' }} />);
    await waitFor(() => expect(screen.getByText('Mark Approved')).toBeTruthy());
    expect(container.querySelector('[data-flow-branches]')).toBeNull();
    expect(container.querySelector('[data-flow-entry]')).toBeNull();
    expect(getItem).not.toHaveBeenCalledWith('object', expect.anything());
  });
});
