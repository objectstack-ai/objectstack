// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4632 — degradation log levels on the cold-boot re-arm path.
//
// This path is the second half of the #4420 story. #4460 made sure a durable
// store is never attached over a table that cannot exist; that guarantees the
// suspended runs REACH the disk. Getting them back off it is this function's
// job, and every way it can fail leaves a run persisted-but-unreachable: the
// rows are there, the process boots clean, and the approval nobody can find
// waits forever. The persisted state and the runtime disagree, and the runtime
// is the one that looks healthy — so those failures are `error`.
//
// The mirror-image failure is just as real, and this file pins it too: the
// `no job service` branch is a declared absence, not a broken promise, and
// escalating it would fire once per suspended run on every boot of every
// job-less host — teaching everyone to skim `error`, which is exactly what made
// the original #4420 `warn` unreadable.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import { registerWaitNode, rearmSuspendedWaitTimers } from './wait-node.js';
import type { IJobService } from '@objectstack/spec/contracts';

type Line = { level: 'info' | 'warn' | 'error'; msg: string; meta?: Record<string, unknown> };

/**
 * Captures the `Logger` contract's slots separately, because #5737 moved every
 * foreign cause on this path out of the MESSAGE and into the structured one:
 * `warn(message, meta?)` carries it second, `error(message, error?, meta?)`
 * third. The level assertions below are unchanged — what this file pins is
 * #4632, and a cause that moved slots is still a cause that was reported.
 */
function capturingLogger() {
  const lines: Line[] = [];
  const logger: any = {
    info: (msg: string) => void lines.push({ level: 'info', msg: String(msg) }),
    warn: (msg: string, meta?: Record<string, unknown>) => void lines.push({ level: 'warn', msg: String(msg), meta }),
    error: (msg: string, _error?: unknown, meta?: Record<string, unknown>) =>
      void lines.push({ level: 'error', msg: String(msg), meta }),
    debug() {},
  };
  logger.child = () => logger;
  return {
    logger,
    lines,
    text(level: Line['level']) {
      return lines.filter((l) => l.level === level).map((l) => l.msg).join('\n');
    },
    /** The `error` field of each record's meta at `level` — where the cause lives now. */
    causes(level: Line['level']) {
      return lines
        .filter((l) => l.level === level)
        .map((l) => String((l.meta as { error?: unknown } | undefined)?.error ?? ''))
        .join('\n');
    },
  };
}

const waitFlow = (config: Record<string, unknown>) =>
  ({
    name: 'wait_flow',
    label: 'wait_flow',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'pause', type: 'wait', label: 'Wait', config },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'pause' },
      { id: 'e2', source: 'pause', target: 'end' },
    ],
  }) as never;

function silent() {
  const l: any = { info() {}, warn() {}, error() {}, debug() {} };
  l.child = () => l;
  return l;
}

/** Boot one "process" against `store`, parked at a wait node. */
function bootEngine(store: InMemorySuspendedRunStore, config: Record<string, unknown>) {
  const engine = new AutomationEngine(silent());
  registerWaitNode(engine, { logger: silent(), getService() { throw new Error('no service'); } } as any);
  engine.setSuspendedRunStore(store);
  engine.registerFlow('wait_flow', waitFlow(config));
  return engine;
}

/** A store that persisted fine and then cannot be read back. */
function unreadableStore(message: string): any {
  return {
    async list() {
      throw new Error(message);
    },
    async save() {},
    async load() {
      return null;
    },
    async remove() {},
  };
}

describe('rearmSuspendedWaitTimers — durability degradations are errors (#4632)', () => {
  it('reports an unlistable store at error, naming the consequence and the fix', async () => {
    const cap = capturingLogger();
    const engine = new AutomationEngine(silent());

    const rearmed = await rearmSuspendedWaitTimers(
      engine,
      unreadableStore('SQLITE_ERROR: no such table: sys_automation_run'),
      undefined,
      cap.logger,
    );

    expect(rearmed).toBe(0);
    // CONSEQUENCE — nothing re-armed, everything hangs, but the runs survive.
    expect(cap.text('error')).toMatch(/NO timer was re-armed/);
    expect(cap.text('error')).toMatch(/hang indefinitely/);
    expect(cap.text('error')).toMatch(/still persisted/);
    // FIX — both the repair and the manual escape hatch.
    expect(cap.text('error')).toMatch(/restart to re-attempt/);
    expect(cap.text('error')).toMatch(/resume\(runId\)/);
    // CAUSE — reported, but in the record's meta since #5737, not spliced into
    // the message where a multi-line driver error would shred the record.
    expect(cap.causes('error')).toContain('no such table: sys_automation_run');
    expect(cap.text('error')).not.toContain('no such table: sys_automation_run');
    // The level is the point: this must not be discoverable only at warn.
    expect(cap.text('warn')).toBe('');
  });

  it('reports a failed re-schedule at error — the run waits with nothing to wake it', async () => {
    const store = new InMemorySuspendedRunStore();
    const config = { eventType: 'timer', timerDuration: 'PT2H' };
    const first = bootEngine(store, config);
    const paused = await first.execute('wait_flow');
    expect(paused.status).toBe('paused');

    const brokenJob: IJobService = {
      async schedule() {
        throw new Error('scheduler backend unreachable');
      },
    } as never;

    const cap = capturingLogger();
    const rearmed = await rearmSuspendedWaitTimers(bootEngine(store, config), store, brokenJob, cap.logger);

    expect(rearmed).toBe(0);
    expect(cap.text('error')).toMatch(/could NOT be re-scheduled/);
    expect(cap.text('error')).toMatch(/hang past that deadline/);
    expect(cap.text('error')).toMatch(/resume\('/);
    expect(cap.causes('error')).toContain('scheduler backend unreachable');
    expect(cap.text('error')).not.toContain('scheduler backend unreachable');
    // The run itself is untouched — persisted, and still resumable by hand.
    expect(await store.list()).toHaveLength(1);
  });

  it('reports an overdue run that could not be resumed at error', async () => {
    const store = new InMemorySuspendedRunStore();
    const config = { eventType: 'timer', timerDuration: '1' };
    const first = bootEngine(store, config);
    await first.execute('wait_flow');
    await new Promise((r) => setTimeout(r, 10)); // let the 1ms deadline lapse

    // `resume()` normally REPORTS machine-state problems in its result rather
    // than throwing, so the only thing that reaches this catch is a genuine
    // fault on the resume path (a driver blowing up, the store vanishing
    // mid-resume). Stand one in.
    const brokenEngine = {
      async resume() {
        throw new Error('datasource connection lost mid-resume');
      },
    } as never;

    const cap = capturingLogger();
    await rearmSuspendedWaitTimers(brokenEngine, store, undefined, cap.logger);

    expect(cap.text('error')).toMatch(/is OVERDUE and could not be resumed/);
    expect(cap.text('error')).toMatch(/nothing will\s+wake it again/);
    expect(cap.text('error')).toMatch(/resume\('/);
    expect(cap.causes('error')).toContain('datasource connection lost mid-resume');
    expect(cap.text('error')).not.toContain('datasource connection lost mid-resume');
  });
});

describe('rearmSuspendedWaitTimers — functional degradations stay at warn (#4632)', () => {
  it('keeps "no job service registered" at warn: a declared absence, not a broken promise', async () => {
    const store = new InMemorySuspendedRunStore();
    const config = { eventType: 'timer', timerDuration: 'PT2H' };
    const first = bootEngine(store, config);
    await first.execute('wait_flow');

    const cap = capturingLogger();
    const rearmed = await rearmSuspendedWaitTimers(bootEngine(store, config), store, undefined, cap.logger);

    expect(rearmed).toBe(0);
    // A host that never composed a job service never had auto-resume; nothing
    // was promised and then lost. It says so, at warn, with the remedy.
    expect(cap.text('warn')).toMatch(/no job service is registered/);
    expect(cap.text('warn')).toMatch(/resume it externally/);
    expect(cap.text('error')).toBe('');
    expect(await store.list()).toHaveLength(1);
  });

  it('says nothing at all when every timer re-arms cleanly', async () => {
    const store = new InMemorySuspendedRunStore();
    const config = { eventType: 'timer', timerDuration: 'PT2H' };
    const first = bootEngine(store, config);
    await first.execute('wait_flow');

    const okJob: IJobService = { async schedule() {}, async cancel() {} } as never;
    const cap = capturingLogger();
    const rearmed = await rearmSuspendedWaitTimers(bootEngine(store, config), store, okJob, cap.logger);

    expect(rearmed).toBe(1);
    expect(cap.text('error')).toBe('');
    expect(cap.text('warn')).toBe('');
  });
});
