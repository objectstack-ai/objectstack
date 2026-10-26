// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12779 — what the author SEES and STORES through a schedule start
 * node's Cron schedule field, over every cadence form the engine runs.
 *
 * 1. A bare cron string (app-todo's `task_reminder`) and a `{ cron }` cadence,
 *    typed or untyped, read as their cron in the text box.
 * 2. An interval or once cadence (the showcase's `showcase_scheduled_digest`)
 *    draws read-only as what it is, with the line saying the designer edits
 *    cron cadences only. No cron edit is offered over it, and opening it
 *    writes nothing (the seat's ruling on the card's open choice).
 * 3. A cron typed over a bare string or over `{ cron }` stores a descriptor
 *    the engine resolves to that cron.
 * 4. CONTROLS: a typed cron with a timezone, the flat `config.cron`
 *    migrate-on-edit and a time-relative sweep's cadence behave as before.
 *
 * Fixtures are copied from objectstack `examples/app-showcase` and
 * `examples/app-todo`. Wording is not pinned beyond the reading itself: the
 * interval and once readings are the value the author reads in place of an
 * empty cron, so they are asserted as drawn.
 *
 * The table half (the engine's forms, the reads and the writes) is pinned in
 * `flow-node-config.scheduleCadence-12779.test.ts`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { resolveFlowTriggerKind } from '@objectstack/spec/automation';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { normalizeScheduleCadence } from './flow-node-config';
import type { MetadataSelection } from '../preview-registry';

/* ── The `meta/object` double ─────────────────────────────────────────
 * The sweep's `Sweep object` is a reference field, which lists objects via
 * `GET /api/v1/meta/object` through the GLOBAL `fetch`. Answered as an empty
 * registry by a recording double (the shape
 * `FlowNodeInspector.inactiveRetained.test.tsx` documents); any other URL
 * fails the test in `afterEach`.
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

/** A schedule flow whose start node stores `config`, shaped as the showcase's digest. */
function scheduleFlow(config: Record<string, unknown>, label = 'Every 60s (demo)'): Draft {
  return {
    name: 'showcase_scheduled_digest',
    label: 'Scheduled Project Digest (interval)',
    type: 'schedule',
    status: 'active',
    nodes: [
      { id: 'start', type: 'start', label, config },
      {
        id: 'digest',
        type: 'notify',
        label: 'Post Digest to Inbox',
        config: {
          topic: 'project.digest',
          recipients: ['admin@objectos.ai'],
          channels: ['inbox'],
          severity: 'info',
          title: 'Scheduled project digest',
          message: 'Your periodic project digest is ready — open Projects for the latest health.',
          actionUrl: '/showcase_project',
        },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'digest' },
      { id: 'e2', source: 'digest', target: 'end' },
    ],
  };
}

/** `showcase_scheduled_digest`'s start config, verbatim. */
const SHOWCASE_INTERVAL = { schedule: { type: 'interval', intervalMs: 60000 } };
/** app-todo `task_reminder`'s start config, verbatim. */
const TODO_BARE_STRING = { schedule: '0 8 * * *', objectName: 'todo_task' };

const startConfig = (draft: Draft) =>
  ((draft.nodes as Array<Record<string, unknown>>)[0].config ?? {}) as Record<string, unknown>;

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

/** The text control under the field labelled `label`. */
function controlOf(label: string): HTMLInputElement {
  const labelEl = screen.getByText(label, { selector: 'label' });
  const input = labelEl.parentElement?.querySelector('input');
  if (!input) throw new Error(`no input under ${label}`);
  return input as HTMLInputElement;
}

describe('a cron cadence in any form reads as its cron (objectui#12779)', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["app-todo's bare string", TODO_BARE_STRING, '0 8 * * *'],
    ['a typed { cron }', { schedule: { type: 'cron', cron: '0 5 * * *' } }, '0 5 * * *'],
    ['an untyped { cron }', { schedule: { cron: '0 4 * * *' } }, '0 4 * * *'],
  ];
  for (const [name, config, cron] of cases) {
    it(`${name} shows its cron in an editable Cron schedule box`, () => {
      mount(scheduleFlow(config));
      const box = controlOf('Cron schedule');
      expect(box.value).toBe(cron);
      expect(box.disabled).toBe(false);
    });
  }
});

describe('an interval or once cadence draws read-only as what it is (objectui#12779)', () => {
  it("the showcase's interval reads as every minute, with no cron edit offered", () => {
    const draft = scheduleFlow(structuredClone(SHOWCASE_INTERVAL));
    expect(resolveFlowTriggerKind(draft)).toBe('schedule');
    mount(draft);
    expect(screen.queryByText('Cron schedule', { selector: 'label' })).toBeNull();
    const box = controlOf('Schedule');
    expect(box.value).toBe('Every 1 min');
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/The designer edits cron schedules only/)).toBeTruthy();
  });

  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['an untyped every', { schedule: { every: 5000 } }, 'Every 5 s'],
    ['an interval of 90 s', { schedule: { intervalMs: 90000 } }, 'Every 90 s'],
    ['an interval of two hours', { schedule: { type: 'interval', intervalMs: 7_200_000 } }, 'Every 2 h'],
    ['an interval in ms', { schedule: { type: 'interval', intervalMs: 1500 } }, 'Every 1500 ms'],
    ['a typed once', { schedule: { type: 'once', at: '2026-12-01T08:00:00Z' } }, 'Once, at 2026-12-01T08:00:00Z'],
    ['an untyped once', { schedule: { at: '2026-12-01T08:00:00Z' } }, 'Once, at 2026-12-01T08:00:00Z'],
  ];
  for (const [name, config, reading] of cases) {
    it(`${name} reads "${reading}", read-only`, () => {
      mount(scheduleFlow(config));
      const box = controlOf('Schedule');
      expect(box.value).toBe(reading);
      expect(box.disabled).toBe(true);
    });
  }

  it('opening the showcase node writes nothing, and an edit elsewhere keeps the interval as stored', () => {
    const authored = scheduleFlow(structuredClone(SHOWCASE_INTERVAL));
    const before = JSON.stringify(authored);
    const { patches, latest, unmount } = mount(authored);
    expect(patches).toHaveLength(0);
    fireEvent.change(screen.getByDisplayValue('Every 60s (demo)'), { target: { value: 'Every minute' } });
    expect(patches.length).toBeGreaterThan(0);
    expect(startConfig(latest()).schedule).toEqual(SHOWCASE_INTERVAL.schedule);
    unmount();
    expect(JSON.stringify(authored)).toBe(before);
  });
});

describe('a typed cron stores a descriptor the engine resolves to it (objectui#12779)', () => {
  it("over app-todo's bare string, the string is replaced by the typed cron", () => {
    const { latest } = mount(scheduleFlow(structuredClone(TODO_BARE_STRING)));
    fireEvent.change(controlOf('Cron schedule'), { target: { value: '0 9 * * *' } });
    const config = startConfig(latest());
    expect(config.schedule).toBe('0 9 * * *');
    expect(normalizeScheduleCadence(config.schedule)).toEqual({ type: 'cron', expression: '0 9 * * *' });
    expect(config.objectName).toBe('todo_task');
    expect(controlOf('Cron schedule').value).toBe('0 9 * * *');
  });

  it('over a typed { cron }, the typed cron replaces the stale one', () => {
    const { latest } = mount(scheduleFlow({ schedule: { type: 'cron', cron: '0 5 * * *' } }));
    fireEvent.change(controlOf('Cron schedule'), { target: { value: '0 9 * * *' } });
    const schedule = startConfig(latest()).schedule;
    expect(schedule).toEqual({ type: 'cron', expression: '0 9 * * *' });
    expect(normalizeScheduleCadence(schedule)).toEqual({ type: 'cron', expression: '0 9 * * *' });
  });

  it('over an untyped { cron }, the typed cron replaces the stale one', () => {
    const { latest } = mount(scheduleFlow({ schedule: { cron: '0 4 * * *' } }));
    fireEvent.change(controlOf('Cron schedule'), { target: { value: '0 9 * * *' } });
    expect(startConfig(latest()).schedule).toEqual({ expression: '0 9 * * *' });
  });
});

describe('CONTROLS: the forms the field already read behave as before (objectui#12779)', () => {
  it('a typed cron with a timezone reads and writes with its type and timezone kept', () => {
    const { latest } = mount(scheduleFlow({ schedule: { type: 'cron', expression: '0 7 * * *', timezone: 'Asia/Shanghai' } }));
    expect(controlOf('Cron schedule').value).toBe('0 7 * * *');
    fireEvent.change(controlOf('Cron schedule'), { target: { value: '0 9 * * *' } });
    expect(startConfig(latest()).schedule).toEqual({ type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' });
  });

  it('a legacy flat config.cron reads, and moves into config.schedule on edit', () => {
    const { latest } = mount(scheduleFlow({ triggerType: 'schedule', cron: '0 7 * * *' }));
    expect(controlOf('Cron schedule').value).toBe('0 7 * * *');
    fireEvent.change(controlOf('Cron schedule'), { target: { value: '0 9 * * *' } });
    const config = startConfig(latest());
    expect(config.schedule).toEqual({ expression: '0 9 * * *' });
    expect('cron' in config).toBe(false);
  });

  it("a time-relative sweep's cadence reads as its cron, and opening it writes nothing", () => {
    const sweep = {
      timeRelative: { object: 'showcase_task', dateField: 'due_date', offsetDays: [3, 1] },
      schedule: { type: 'cron', expression: '0 8 * * *' },
    };
    const draft = scheduleFlow(structuredClone(sweep), 'Daily Sweep');
    expect(resolveFlowTriggerKind(draft)).toBe('time_relative');
    const { patches, latest } = mount(draft);
    expect(controlOf('Cron schedule').value).toBe('0 8 * * *');
    expect(patches).toHaveLength(0);
    fireEvent.change(controlOf('Cron schedule'), { target: { value: '0 6 * * *' } });
    expect(startConfig(latest()).schedule).toEqual({ type: 'cron', expression: '0 6 * * *' });
    expect(startConfig(latest()).timeRelative).toEqual(sweep.timeRelative);
  });
});
