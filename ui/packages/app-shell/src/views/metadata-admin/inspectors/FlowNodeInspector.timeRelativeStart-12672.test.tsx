// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12672 — what the author SEES on a start node whose trigger kind the
 * spec resolves from a DESCRIPTOR rather than from `config.triggerType`.
 *
 * `resolveFlowTriggerKind` (`@objectstack/spec/automation`) is the one reader
 * of a flow's trigger kind, and the engine binds through it: a start node
 * carrying `config.timeRelative` is a time-relative sweep, and one carrying
 * `config.schedule` (or a flow-level `type: 'schedule'`) is a schedule flow,
 * with no `triggerType` stored. The canonical shape stores none — the stock
 * showcase flow `showcase_task_due_reminder` below is copied from
 * objectstack's `examples/app-showcase`.
 *
 * 1. The sweep fields and the cron field of such a node are IN EFFECT: no
 *    "kept, not in effect" banner beside any of them.
 * 2. The Trigger select reads the resolved kind, as a reading (the muted
 *    placeholder slot), never as a stored selection.
 * 3. Opening the node writes nothing, and an edit elsewhere on it adds no
 *    `triggerType`; an author's explicit pick still writes as it always did.
 * 4. A node that DOES store a `triggerType` keeps its stored value in the
 *    select, and its banners follow the spec's answer for the whole node — a
 *    `record-*` trigger outranks a leftover descriptor, a `schedule` / `manual`
 *    / `api` token does not.
 *
 * Banner wording is not pinned — only its presence, by test id.
 *
 * The table half (the gates and the select's reading, over a matrix the spec
 * answers) is pinned in `flow-node-config.timeRelativeStart-12672.test.ts`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resolveFlowTriggerKind } from '@objectstack/spec/automation';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import type { MetadataSelection } from '../preview-registry';

/* ── The `meta/object` double ─────────────────────────────────────────
 * The sweep's `Sweep object` and a record trigger's `Object` are reference
 * fields, which list objects via `GET /api/v1/meta/object` through the GLOBAL
 * `fetch`. Answered as an empty registry by a RECORDING double — the shape
 * `FlowNodeInspector.inactiveRetained.test.tsx` documents in full — and any
 * URL outside that route fails the test in `afterEach` instead of vanishing
 * into the hook's `.catch`.
 * ──────────────────────────────────────────────────────────── */

const META_OBJECT_ROUTE = '/api/v1/meta/object';
let metaCalls: string[] = [];
const routeOf = (url: string) => url.split('?')[0];

beforeEach(() => {
  metaCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      metaCalls.push(url);
      if (routeOf(url) !== META_OBJECT_ROUTE) {
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ type: 'object', items: [] }) };
    }),
  );
});

afterEach(() => {
  expect(metaCalls.filter((url) => routeOf(url) !== META_OBJECT_ROUTE)).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

type Draft = Record<string, unknown>;

/** The showcase sweep descriptor, verbatim. */
const SWEEP = {
  object: 'showcase_task',
  dateField: 'due_date',
  offsetDays: [3, 1],
  filter: { status: { $ne: 'done' } },
};

/** The four sweep fields the showcase node stores a value in, by label. */
const STORED_SWEEP_LABELS = ['Sweep object', 'Date field', 'Offset days', 'Extra filter'];

/**
 * `showcase_task_due_reminder` as objectstack's `examples/app-showcase`
 * authors it: `type: 'schedule'`, and a start node carrying the
 * `timeRelative` descriptor and no `triggerType`.
 */
function showcaseFlow(startConfig: Record<string, unknown> = { timeRelative: structuredClone(SWEEP) }, type = 'schedule'): Draft {
  return {
    name: 'showcase_task_due_reminder',
    label: 'Task Due Reminder',
    description: 'Daily sweep: remind the owner 3 and 1 days before an open task is due (#1874 time-relative).',
    type,
    status: 'active',
    runAs: 'system',
    nodes: [
      { id: 'start', type: 'start', label: 'Daily Sweep', config: startConfig },
      {
        id: 'remind_owner',
        type: 'notify',
        label: 'Remind Owner',
        config: {
          topic: 'task.due_soon',
          recipients: [{ dialect: 'cel', source: 'has(record.assignee) ? record.assignee : null' }],
          channels: ['inbox'],
          severity: 'warning',
          title: 'Task due soon: {{ record.title }}',
          message: 'Your task "{{ record.title }}" is due on {{ record.due_date }}.',
          actionUrl: '/showcase_task',
        },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'remind_owner' },
      { id: 'e2', source: 'remind_owner', target: 'end' },
    ],
  };
}

const startConfig = (draft: Draft) =>
  ((draft.nodes as Array<Record<string, unknown>>)[0].config ?? {}) as Record<string, unknown>;

/**
 * The editor loop: every patch is applied to the draft the inspector renders
 * next, as the host does. `latest()` is the draft a save would send.
 */
function mount(initial: Draft) {
  let current = initial;
  const patches: Draft[] = [];
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    return (
      <FlowNodeInspector
        type="flow"
        name="showcase_task_due_reminder"
        draft={draft}
        selection={{ kind: 'node', id: 'start' } as MetadataSelection}
        onPatch={(patch) => {
          patches.push(patch);
          setDraft((d) => {
            current = { ...d, ...patch };
            return current;
          });
        }}
        onClearSelection={vi.fn()}
        readOnly={false}
        locale="en-US"
      />
    );
  }
  const utils = render(<Host />);
  return { ...utils, patches, latest: () => current };
}

const banners = () => screen.queryAllByTestId('inactive-retained');
const triggerSelect = () => screen.getByRole('combobox', { name: 'Trigger' });

/** The banner beside the field labelled `label`, or null — read from that field's own row. */
function bannerBeside(label: string): HTMLElement | null {
  const labelEl = screen.getByText(label, { selector: 'label' });
  let row: HTMLElement | null = labelEl.parentElement;
  // Climb to the row that holds this field's control AND its banner slot, and
  // no other field's label.
  while (row && row.parentElement && row.parentElement.querySelectorAll('label').length === row.querySelectorAll('label').length) {
    row = row.parentElement;
  }
  return row?.querySelector('[data-testid="inactive-retained"]') ?? null;
}

describe('a time-relative start node that stores no triggerType (objectui#12672)', () => {
  it('the spec resolves the showcase node as a time-relative sweep (the premise every case below reads)', () => {
    expect(resolveFlowTriggerKind(showcaseFlow())).toBe('time_relative');
  });

  it('flags none of its sweep fields as "kept, not in effect"', () => {
    mount(showcaseFlow());
    for (const label of STORED_SWEEP_LABELS) {
      expect(screen.getByText(label, { selector: 'label' }), label).toBeTruthy();
      expect(bannerBeside(label), label).toBeNull();
    }
    expect(banners()).toHaveLength(0);
  });

  it('offers the sweep fields it leaves empty, as a sweep the spec binds', () => {
    mount(showcaseFlow());
    expect(screen.getByText('Within days', { selector: 'label' })).toBeTruthy();
    expect(screen.getByText('Max records / run', { selector: 'label' })).toBeTruthy();
  });

  it('the Trigger select reads the time-relative option, as a reading rather than a selection', () => {
    mount(showcaseFlow());
    const trigger = triggerSelect();
    expect(trigger.textContent).toBe('Time-relative (date sweep)');
    expect(trigger.hasAttribute('data-placeholder')).toBe(true);
  });
});

describe('opening the node writes nothing (objectui#12672)', () => {
  it('a mount and unmount sends no patch, and the stored flow stays as authored', () => {
    const authored = showcaseFlow();
    const before = JSON.stringify(authored);
    const { patches, latest, unmount } = mount(authored);
    unmount();
    expect(patches).toHaveLength(0);
    expect(JSON.stringify(latest())).toBe(before);
  });

  it('an edit elsewhere on the node adds no triggerType', () => {
    const { patches, latest } = mount(showcaseFlow());
    fireEvent.change(screen.getByDisplayValue('Daily Sweep'), { target: { value: 'Morning Sweep' } });
    expect(patches.length).toBeGreaterThan(0);
    const config = startConfig(latest());
    expect('triggerType' in config).toBe(false);
    expect(config.timeRelative).toEqual(SWEEP);
  });

  it("an author's explicit pick writes the option, as it always did", async () => {
    const { latest } = mount(showcaseFlow());
    await userEvent.click(triggerSelect());
    await userEvent.click(await screen.findByRole('option', { name: 'Time-relative (date sweep)' }));
    expect(startConfig(latest()).triggerType).toBe('time_relative');
    // Now a stored selection, not a reading.
    expect(triggerSelect().hasAttribute('data-placeholder')).toBe(false);
  });
});

describe('a node that stores a triggerType beside a timeRelative block agrees with the spec (objectui#12672)', () => {
  const cases: Array<{ triggerType: string; flowType: string; label: string; extra?: Record<string, unknown> }> = [
    { triggerType: 'record-after-update', flowType: 'record_change', label: 'Record updated', extra: { objectName: 'showcase_task' } },
    { triggerType: 'schedule', flowType: 'schedule', label: 'Schedule' },
    { triggerType: 'manual', flowType: 'autolaunched', label: 'Manual / autolaunched' },
    { triggerType: 'api', flowType: 'api', label: 'Webhook / API', extra: { secret: 'value-already-on-the-node' } },
  ];

  for (const c of cases) {
    it(`triggerType ${c.triggerType}: the sweep fields are flagged exactly when the spec binds no sweep`, () => {
      const draft = showcaseFlow({ triggerType: c.triggerType, ...c.extra, timeRelative: structuredClone(SWEEP) }, c.flowType);
      const kind = resolveFlowTriggerKind(draft);
      mount(draft);
      // The stored value stays the select's selection (today's behaviour).
      expect(triggerSelect().textContent).toBe(c.label);
      expect(triggerSelect().hasAttribute('data-placeholder')).toBe(false);
      for (const label of STORED_SWEEP_LABELS) {
        if (kind === 'time_relative') expect(bannerBeside(label), `${c.triggerType} ${label}`).toBeNull();
        else expect(bannerBeside(label), `${c.triggerType} ${label}`).not.toBeNull();
      }
    });
  }

  it('the spec answers record_change for the record trigger and time_relative for the other three (the split above is real)', () => {
    const kinds = cases.map((c) =>
      resolveFlowTriggerKind(showcaseFlow({ triggerType: c.triggerType, ...c.extra, timeRelative: SWEEP }, c.flowType)),
    );
    expect(kinds).toEqual(['record_change', 'time_relative', 'time_relative', 'time_relative']);
  });
});

describe('the entry condition follows the trigger the spec resolves (objectui#12672)', () => {
  it("a sweep's stored entry condition is in effect: the engine evaluates it for every trigger", () => {
    mount(showcaseFlow({ timeRelative: structuredClone(SWEEP), condition: 'status != "done"' }));
    expect(screen.getByDisplayValue('status != "done"')).toBeTruthy();
    expect(bannerBeside('Entry condition')).toBeNull();
    expect(banners()).toHaveLength(0);
  });
});

describe('the resolved kind belongs to the start node it is resolved from (objectui#12672)', () => {
  it('a second start node, which the spec parse admits and nothing binds, reads no kind and offers no sweep', () => {
    const draft = showcaseFlow();
    const nodes = draft.nodes as Array<Record<string, unknown>>;
    draft.nodes = [nodes[0], { id: 'start_2', type: 'start', label: 'Second Start', config: {} }, ...nodes.slice(1)];
    // The kind the spec resolves is the FIRST start node's.
    expect(resolveFlowTriggerKind(draft)).toBe('time_relative');
    render(
      <FlowNodeInspector
        type="flow"
        name="showcase_task_due_reminder"
        draft={draft}
        selection={{ kind: 'node', id: 'start_2' } as MetadataSelection}
        onPatch={vi.fn()}
        onClearSelection={vi.fn()}
        readOnly={false}
        locale="en-US"
      />,
    );
    expect(triggerSelect().textContent).toBe('—');
    expect(screen.queryByText('Sweep object', { selector: 'label' })).toBeNull();
  });
});

describe('the cron field reads the resolved kind (objectui#12672)', () => {
  const CRON = { type: 'cron', expression: '0 7 * * *' };

  it('a schedule flow whose start node stores no triggerType: the cron is in effect and the select reads Schedule', () => {
    const draft = showcaseFlow({ schedule: { ...CRON } }, 'schedule');
    expect(resolveFlowTriggerKind(draft)).toBe('schedule');
    mount(draft);
    expect(screen.getByDisplayValue('0 7 * * *')).toBeTruthy();
    expect(bannerBeside('Cron schedule')).toBeNull();
    expect(triggerSelect().textContent).toBe('Schedule');
    expect(triggerSelect().hasAttribute('data-placeholder')).toBe(true);
  });

  // objectui#12845 — the schedule kind binds cron, interval and once cadences
  // (objectui#12779), so the select names the kind, not one cadence: an
  // interval flow reads the same label a cron flow does, and never "cron".
  it('an interval schedule flow reads Schedule in the select, the same label a cron flow reads, never cron', () => {
    const draft = showcaseFlow({ schedule: { type: 'interval', intervalMs: 60000 } }, 'schedule');
    expect(resolveFlowTriggerKind(draft)).toBe('schedule');
    mount(draft);
    expect(triggerSelect().textContent).toBe('Schedule');
    expect(triggerSelect().textContent).not.toMatch(/cron/i);
    expect(triggerSelect().hasAttribute('data-placeholder')).toBe(true);
    // The Trigger help names every cadence the schedule kind binds, not only cron.
    const help = screen.getByText(/^When this flow starts\./).textContent ?? '';
    expect(help).not.toMatch(/fire on a cron\./);
    expect(help).toMatch(/interval/);
  });

  it("a sweep's cadence is in effect beside its descriptor", () => {
    mount(showcaseFlow({ timeRelative: structuredClone(SWEEP), schedule: { ...CRON } }));
    expect(bannerBeside('Cron schedule')).toBeNull();
    expect(banners()).toHaveLength(0);
  });

  it('a record trigger outranks a leftover cadence, so the cron stays flagged', () => {
    const draft = showcaseFlow({ triggerType: 'record-after-update', objectName: 'showcase_task', schedule: { ...CRON } }, 'record_change');
    expect(resolveFlowTriggerKind(draft)).toBe('record_change');
    mount(draft);
    expect(bannerBeside('Cron schedule')).not.toBeNull();
  });
});
