// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { FlowSchema } from './flow.zod';
import { flowStartConfigRefusals, flowStartScheduleReadsNothing } from './flow-start-config-refusals';

const flowWith = (config: Record<string, unknown>) => ({
  name: 'start_config_probe',
  label: 'Start Config Probe',
  type: 'schedule',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/** The parse's issues anchored on the start node's config. */
const startIssues = (config: Record<string, unknown>) => {
  const parsed = FlowSchema.safeParse(flowWith(config));
  if (parsed.success) return [];
  return parsed.error.issues
    .filter((i) => i.path[0] === 'nodes' && i.path[1] === 0 && i.path[2] === 'config')
    .map((i) => ({ path: i.path.join('.'), message: i.message }));
};

const TIME_RELATIVE = {
  object: 'contract',
  dateField: 'end_date',
  offsetDays: -30,
};

describe('flow start config — `filter` beside `timeRelative` (#31224 B1)', () => {
  it('refuses it at the parse, naming where the filter belongs', () => {
    const issues = startIssues({ triggerType: 'time_relative', timeRelative: TIME_RELATIVE, filter: { status: 'active' } });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe('nodes.0.config.filter');
    expect(issues[0]!.message).toMatch(/nothing reads it/);
    expect(issues[0]!.message).toMatch(/launches for every record in the date window/);
    expect(issues[0]!.message).toMatch(/Move it into `config\.timeRelative\.filter`/);
  });

  it('accepts the filter inside `timeRelative`, and a `filter` on a start node with no `timeRelative`', () => {
    expect(flowStartConfigRefusals(flowWith({ timeRelative: { ...TIME_RELATIVE, filter: { status: 'active' } } }))).toEqual([]);
    expect(flowStartConfigRefusals(flowWith({ triggerType: 'schedule', schedule: '0 8 * * *', filter: { a: 1 } }))).toEqual([]);
  });
});

describe('flow start config — `schedule` (#31224 B1, ruling option (a))', () => {
  it('accepts the bare cron string, the three typed forms, and the untyped aliases the reader takes', () => {
    for (const schedule of [
      '0 8 * * *',
      { type: 'cron', expression: '0 8 * * *' },
      { type: 'cron', expression: '0 8 * * *', timezone: 'America/New_York' },
      { type: 'interval', intervalMs: 60000 },
      { type: 'once', at: '2027-01-01T08:00:00Z' },
      { cron: '0 8 * * *' },
      { expression: '0 8 * * *' },
      { every: 60000 },
      { intervalMs: 60000 },
      { at: '2027-01-01T08:00:00Z' },
    ]) {
      expect(flowStartConfigRefusals(flowWith({ triggerType: 'schedule', schedule })), JSON.stringify(schedule)).toEqual([]);
    }
  });

  it('refuses a typed cron whose timezone is not an IANA zone, at the parse', () => {
    const issues = startIssues({ triggerType: 'schedule', schedule: { type: 'cron', expression: '0 8 * * *', timezone: 'UTC+8' } });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe('nodes.0.config.schedule');
    expect(issues[0]!.message).toMatch(/is not a schedule at `schedule\.timezone`/);
    expect(issues[0]!.message).toMatch(/a schedule flow stays unbound/);
  });

  it('refuses a typed form the published ScheduleSchema refuses (unknown type, non-positive interval, no expression)', () => {
    for (const schedule of [
      { type: 'hourly' },
      { type: 'interval', intervalMs: 0 },
      { type: 'cron' },
      { type: 'once', at: 'tomorrow' },
    ]) {
      const found = flowStartConfigRefusals(flowWith({ triggerType: 'schedule', schedule }));
      expect(found.map((f) => f.path.join('.')), JSON.stringify(schedule)).toEqual(['nodes.0.config.schedule']);
    }
  });

  it('refuses an untyped value the reader reads nothing from, and an empty string', () => {
    for (const schedule of [{ cadence: 'daily' }, {}, [], 42, true, '   ', { every: -5 }]) {
      const found = flowStartConfigRefusals(flowWith({ triggerType: 'schedule', schedule }));
      expect(found, JSON.stringify(schedule)).toHaveLength(1);
      expect(found[0]!.message).toMatch(/schedule flow stays unbound and a time-relative sweep falls back to daily 08:00 UTC/);
    }
  });

  it('refuses a typed cron whose expression is an envelope: it passes the schema, and the reader reads nothing', () => {
    const found = flowStartConfigRefusals(flowWith({
      triggerType: 'schedule',
      schedule: { type: 'cron', expression: { dialect: 'cron', source: '0 8 * * *' } },
    }));
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toMatch(/names no schedule the readers can use/);
  });

  it('judges no absent or null schedule', () => {
    expect(flowStartConfigRefusals(flowWith({ triggerType: 'schedule', schedule: null }))).toEqual([]);
    expect(flowStartConfigRefusals(flowWith({ triggerType: 'manual' }))).toEqual([]);
  });

  it('reads only top-level start nodes', () => {
    const flow = flowWith({ triggerType: 'manual' }) as any;
    flow.nodes.splice(1, 0, { id: 'mid', type: 'assignment', label: 'Mid', config: { schedule: {} } });
    expect(flowStartConfigRefusals(flow)).toEqual([]);
  });
});

describe('flowStartScheduleReadsNothing — the reader\'s precedence', () => {
  it('the first candidate present decides, as `normalizeSchedule` does', () => {
    // `intervalMs` is present and unusable, so the reader never reaches `every`.
    expect(flowStartScheduleReadsNothing({ intervalMs: -1, every: 60000 })).toBe(true);
    expect(flowStartScheduleReadsNothing({ expression: '', cron: '0 8 * * *' })).toBe(false);
    expect(flowStartScheduleReadsNothing(undefined)).toBe(false);
  });
});
