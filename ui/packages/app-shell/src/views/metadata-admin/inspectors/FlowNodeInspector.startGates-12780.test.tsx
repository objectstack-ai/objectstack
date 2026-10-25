// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12780 — what the author SEES of the start node's Object field.
 *
 * The engine reads `config.objectName` for a record-change trigger only. The
 * schedule binding never reads it, and a time-relative sweep reads
 * `config.timeRelative.object`. objectstack's `examples/app-todo` stores
 * `objectName: 'todo_task'` on the schedule start nodes of `task_reminder` and
 * `overdue_escalation`; the two start configs below are copied from it.
 *
 * 1. A schedule start node does not offer Object, and a stored one is kept with
 *    the "kept, not in effect" banner, with or without an explicit Schedule
 *    token. Opening the node writes nothing, so the stored key is not dropped.
 * 2. A time-relative start node does not offer Object; its sweep object is the
 *    Sweep object field.
 * 3. CONTROL: a record-change start node (app-todo's `task_completion`) offers
 *    Object live, with no banner.
 *
 * Banner wording is not pinned — only its presence, by test id. The table
 * half is `flow-node-config.startGates-12780.test.ts`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

// The Object and Sweep object fields list objects through the global `fetch`;
// answered as an empty registry, and any other URL fails the test.
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

/** A two-node flow of `type` whose start node carries `config`. */
function flow(name: string, type: string, config: Record<string, unknown>): Draft {
  return {
    name,
    label: name,
    type,
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
  };
}

/** app-todo `task_reminder`'s start config, verbatim. */
const TASK_REMINDER_START = { schedule: '0 8 * * *', objectName: 'todo_task' };
/** app-todo `task_completion`'s start config, verbatim. */
const TASK_COMPLETION_START = {
  objectName: 'todo_task',
  triggerType: 'record-after-update',
  condition: 'status == "completed" && previous.status != "completed"',
};

function mount(initial: Draft) {
  let current = initial;
  const patches: Draft[] = [];
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    return (
      <FlowNodeInspector
        type="flow"
        name={String(initial.name)}
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

const objectLabel = () => screen.queryByText('Object', { selector: 'label' });

/** The banner beside the field labelled `label`, or null — read from that field's own row. */
function bannerBeside(label: string): HTMLElement | null {
  const labelEl = screen.getByText(label, { selector: 'label' });
  let row: HTMLElement | null = labelEl.parentElement;
  while (row && row.parentElement && row.parentElement.querySelectorAll('label').length === row.querySelectorAll('label').length) {
    row = row.parentElement;
  }
  return row?.querySelector('[data-testid="inactive-retained"]') ?? null;
}

describe('a schedule start node keeps a stored Object as not in effect (objectui#12780)', () => {
  const shapes = [
    { name: 'app-todo task_reminder, no token', config: TASK_REMINDER_START },
    { name: 'the same node under an explicit Schedule token', config: { ...TASK_REMINDER_START, triggerType: 'schedule' } },
  ];

  for (const { name, config } of shapes) {
    it(`${name}: Object is shown with the not-in-effect banner, and opening writes nothing`, () => {
      const authored = flow('task_reminder', 'schedule', structuredClone(config));
      expect(resolveFlowTriggerKind(authored)).toBe('schedule');
      const before = JSON.stringify(authored);
      const { patches, latest, unmount } = mount(authored);
      expect(objectLabel()).toBeTruthy();
      expect(bannerBeside('Object')).not.toBeNull();
      unmount();
      expect(patches).toHaveLength(0);
      expect(JSON.stringify(latest())).toBe(before);
    });
  }

  it('a schedule start node that stores no Object does not offer one', () => {
    mount(flow('digest', 'schedule', { schedule: '0 8 * * *', triggerType: 'schedule' }));
    expect(objectLabel()).toBeNull();
  });
});

describe('a time-relative start node does not offer Object (objectui#12780)', () => {
  it('its sweep object is the Sweep object field', () => {
    const draft = flow('due_sweep', 'schedule', { timeRelative: { object: 'todo_task', dateField: 'due_date', withinDays: 1 } });
    expect(resolveFlowTriggerKind(draft)).toBe('time_relative');
    mount(draft);
    expect(objectLabel()).toBeNull();
    expect(screen.getByText('Sweep object', { selector: 'label' })).toBeTruthy();
  });
});

describe('CONTROL: a record-change start node offers Object live (objectui#12780)', () => {
  it('app-todo task_completion: Object shown, no banner', () => {
    const draft = flow('task_completion', 'record_change', structuredClone(TASK_COMPLETION_START));
    expect(resolveFlowTriggerKind(draft)).toBe('record_change');
    mount(draft);
    expect(objectLabel()).toBeTruthy();
    expect(bannerBeside('Object')).toBeNull();
    expect(bannerBeside('Entry condition')).toBeNull();
  });

  it('a fresh record-change start node offers Object empty', () => {
    mount(flow('fresh', 'record_change', { triggerType: 'record-after-create' }));
    expect(objectLabel()).toBeTruthy();
  });
});
