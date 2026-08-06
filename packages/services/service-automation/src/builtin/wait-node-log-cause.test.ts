// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression: #5737 — the FIVE seams of `builtin/wait-node.ts` that interpolated
// a FOREIGN cause into the log MESSAGE.
//
// The fifth instalment of the family #5048 (flow binding, PR #5572), #5575
// (`reconcileDeclaredConnectors`'s `fail()`, PR #5639), #5636
// (`degradeConnectorInstance`, PR #5662) and #5661 (`plugin.ts`'s three startup
// seams) closed. This file was outside every one of those scopes: #5661 fixed
// the plugin's own `catch` around `rearmSuspendedWaitTimers`, and these records
// are written INSIDE the function that catch wraps.
//
//   1. the wake-up handler's `STORE_UNAVAILABLE` line — `error`, cause from
//      `engine.resume()`'s result ENVELOPE (`AutomationResult.error`);
//   2. the arming path's schedule failure — `warn`, cause from the job service;
//   3. the re-arm's unlistable store — `error`, cause from the DATASOURCE DRIVER;
//   4. an overdue run that will not resume — `error`, cause from the resume path;
//   5. a re-arm that could not re-schedule — `error`, cause from the job service.
//
// ## Why 3, 4 and 5 are the worst records in this package to shred
//
// They are `error` because #4632 put them there, and their own text says why:
// "every wait/approval paused before this restart will hang indefinitely".
// `ObjectLogger.write()` emits one `<ts> <LEVEL> <message>` record per call, so
// a message carrying newlines becomes several physical lines of which only the
// first has a level head — a file sink stores the rest as their own records and
// `grep ERROR` returns the one line holding no facts. `pretty`/`text` is the
// default format of `os dev` and `os serve`, so that is the shape an operator
// actually reads. cloud#971 survived a whole rc.1 line behind this.
//
// Seam 3 is the one measured on a real cold boot in #5737's issue text, so it
// gets the fullest treatment; seam 1 is worth naming separately because its
// cause is not a thrown value at all — the engine BUILDS that envelope string by
// interpolating the driver's own `message` into it, so a multi-line driver
// reaches this record through a second hop.
//
// ## The fix, and where each cause goes
//
// Identical to the four prior instalments, zero new vocabulary: a static,
// newline-free message plus the cause in the logger's structured slot, whose
// POSITION is set by the `Logger` contract
// (`packages/spec/src/contracts/logger.ts`): `warn(message, meta?)` takes it
// SECOND, `error(message, error?, meta?)` takes it THIRD — the second slot is
// the `Error` slot and would ship a stack on every record (#5575).
//
// Seam 1 does NOT go through `describeThrownForLog`: `AutomationResult.error` is
// a string the engine already composed, and the helper duck-types `.issues` /
// `.message` off a *thrown* object. It hands `{ error }` directly — the helper's
// own field name, so all five records still report a non-validation cause under
// exactly one key.
//
// Assertions read REAL BYTES off a REAL `ObjectLogger` wherever the question is
// "what would a line-oriented consumer see", per the #5662/#5661 precedent: a
// spy proves what the seam *called*, not what the downstream splitter *sees*,
// and it was the latter that cost cloud#971 a release line. Spies appear only
// where the argument SLOT is itself the fact under test.

import { describe, it, expect, vi } from 'vitest';
import { ObjectLogger } from '@objectstack/core';
import { AutomationEngine } from '../engine.js';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import { registerWaitNode, rearmSuspendedWaitTimers } from './wait-node.js';
import type { IJobService } from '@objectstack/spec/contracts';

// ── fixtures ───────────────────────────────────────────────────────────────

/**
 * What a database driver's failure looks like when it is not one line. Postgres
 * (`error: … \n  detail: … \n  hint: …`) and better-sqlite3 wrappers both do
 * this; the in-repo drivers happen to be single-line today, which is why #5737
 * is a `finding` and not an outage report. Byte-identical to the fixture
 * `plugin-startup-log-cause.test.ts` uses, because it is the same accident.
 */
const MULTILINE_DRIVER = [
  'SQLITE_ERROR: no such table: sys_automation_run',
  '  at Database.prepare (better-sqlite3/lib/methods/wrappers.js:5:21)',
  '  hint: run `os migrate` for this datasource, or set OS_SKIP_SCHEMA_SYNC=0',
].join('\n');

/** A job/scheduler failure with an embedded stack-shaped tail. */
const MULTILINE_JOB = [
  "job service refused to schedule 'flow-wait:run_1:pause'",
  '  cause: queue backend unreachable (ECONNREFUSED 127.0.0.1:6379)',
  '  hint: is the queue running?',
].join('\n');

function silent(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {} };
  l.child = () => l;
  return l;
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

/**
 * Boot one "process" against `store`, parked at a wait node. `logger` is the
 * plugin-context logger the node executor and its wake-up handler write to; the
 * ENGINE keeps a silent one, so a capture holds the seam under test and nothing
 * else.
 */
function bootEngine(store: InMemorySuspendedRunStore, config: Record<string, unknown>, ctx?: { logger?: unknown; job?: IJobService }) {
  const engine = new AutomationEngine(silent());
  registerWaitNode(engine, {
    logger: ctx?.logger ?? silent(),
    getService(id: string) {
      if (id === 'job' && ctx?.job) return ctx.job;
      throw new Error('no service');
    },
  } as any);
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

/** Capture everything written to one std stream while `fn` runs, split to lines. */
async function captureStream(which: 'stdout' | 'stderr', fn: () => Promise<void>): Promise<string[]> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process[which], 'write').mockImplementation(((c: string | Uint8Array) => {
    chunks.push(String(c));
    return true;
  }) as never);
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join('').split('\n').filter((l) => l.length > 0);
}

/**
 * `ObjectLogger`'s `pretty`/`text` record head — the same predicate
 * `classifyBootLogLine` applies in `packages/cli/src/utils/boot-log-capture.ts`.
 * Re-stated rather than imported: this package must not depend on
 * `@objectstack/cli`, and the predicate is the general one every line-based
 * consumer keys off.
 */
const RECORD_HEAD = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?: \|)? (DEBUG|INFO|WARN|ERROR|FATAL)\b/;

/**
 * Does this physical line carry a level head at all?
 *
 * The ANSI introducer below is spelled as a lowercase-u escape sequence, never
 * as the control byte itself — AGENTS.md byte discipline, whose harms
 * `scripts/check-nul-bytes.mjs` argues. This exact line materialized a raw one
 * on first draft, which is the accident that rule exists for.
 */
function classifies(raw: string): boolean {
  const line = raw.replace(/\u001B\[[0-9;]*m/g, '').trim();
  if (!line) return false;
  if (line.startsWith('{')) {
    try {
      const rec = JSON.parse(line) as { level?: unknown; time?: unknown };
      return typeof rec.time === 'string' && typeof rec.level === 'string';
    } catch {
      return false;
    }
  }
  return RECORD_HEAD.test(line);
}

type Record_ = { level: string; msg: string; error?: string; issues?: unknown };

/** The single JSON record on `lines`, parsed. */
function soleRecord(lines: string[]): Record_ {
  expect(lines, 'one call, one physical line').toHaveLength(1);
  return JSON.parse(lines[0]) as Record_;
}

// ── seam 3: the re-arm's unlistable store (the measured one) ────────────────

describe('#5737 — the re-arm ABORTED durability alarm is ONE stderr record', () => {
  it("the driver's multi-line failure never reaches the log message", async () => {
    const log = new ObjectLogger({ level: 'error', format: 'json' });
    const lines = await captureStream('stderr', async () => {
      const rearmed = await rearmSuspendedWaitTimers(
        new AutomationEngine(silent()),
        unreadableStore(MULTILINE_DRIVER),
        undefined,
        log,
      );
      expect(rearmed).toBe(0);
    });

    const record = soleRecord(lines);
    expect(record.level).toBe('error');
    expect(record.msg).not.toContain('\n');
    // #4632 demands the consequence and the fix in the record's own line, and
    // moving the cause out must not cost either.
    expect(record.msg, 'the consequence').toContain('will hang indefinitely instead of resuming');
    expect(record.msg, 'the runs survived').toContain('still persisted');
    expect(record.msg, 'the fix').toContain('restart to re-attempt the re-arm');
    expect(record.msg, 'the escape hatch').toContain('resume(runId)');
    // Not a validation rejection → `error`, and the WHOLE driver text survives,
    // its newlines escaped by the logger's JSON.stringify.
    expect(record.issues).toBeUndefined();
    expect(record.error).toBe(MULTILINE_DRIVER);
    expect(record.msg).not.toContain('no such table');
  });

  it('stays one physical line in `pretty`, the format `os dev` / `os serve` default to', async () => {
    // The JSON case above cannot fail the way #5737 reports, because
    // JSON.stringify escapes the newlines either way. This is the format the
    // measurement was taken in.
    const log = new ObjectLogger({ level: 'error', format: 'pretty' });
    const lines = await captureStream('stderr', async () => {
      await rearmSuspendedWaitTimers(new AutomationEngine(silent()), unreadableStore(MULTILINE_DRIVER), undefined, log);
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(RECORD_HEAD);
    // Every fact is on the one line that a `grep ERROR` returns.
    expect(lines[0]).toContain('will hang indefinitely');
    expect(lines[0]).toContain('better-sqlite3');
    expect(lines[0]).toContain('run `os migrate` for this datasource');
  });

  it("calls error(message, undefined, meta) — the contract's third slot", async () => {
    const error = vi.spyOn(ObjectLogger.prototype, 'error');
    const log = new ObjectLogger({ level: 'error', format: 'json' });
    await captureStream('stderr', async () => {
      await rearmSuspendedWaitTimers(new AutomationEngine(silent()), unreadableStore(MULTILINE_DRIVER), undefined, log);
    });

    const call = error.mock.calls.find((c) => String(c[0]).includes('re-arm ABORTED'));
    expect(call, 'the seam logged at error level').toBeDefined();
    const [message, errorSlot, meta] = call as [string, unknown, Record<string, unknown>];
    expect(message).not.toContain('\n');
    // The second slot stays empty on purpose: a raw `Error` there ships its
    // stack into the record (#5575).
    expect(errorSlot).toBeUndefined();
    expect(meta.error).toBe(MULTILINE_DRIVER);
    error.mockRestore();
  });
});

// ── seam 4: an overdue run that could not be resumed ────────────────────────

describe('#5737 — the OVERDUE run error is ONE stderr record', () => {
  it('keeps the consequence in the message and the resume failure in meta', async () => {
    const store = new InMemorySuspendedRunStore();
    const first = bootEngine(store, { eventType: 'timer', timerDuration: '1' });
    await first.execute('wait_flow');
    await new Promise((r) => setTimeout(r, 10)); // let the 1ms deadline lapse

    // `resume()` REPORTS machine-state problems in its result rather than
    // throwing, so only a genuine fault on the resume path reaches this catch.
    const brokenEngine = {
      async resume() {
        throw new Error(MULTILINE_DRIVER);
      },
    } as never;

    const log = new ObjectLogger({ level: 'error', format: 'json' });
    const lines = await captureStream('stderr', async () => {
      await rearmSuspendedWaitTimers(brokenEngine, store, undefined, log);
    });

    const record = soleRecord(lines);
    expect(record.level).toBe('error');
    expect(record.msg).not.toContain('\n');
    expect(record.msg, 'the consequence').toContain('is OVERDUE and could not be resumed');
    expect(record.msg, 'nothing else will wake it').toContain('nothing will');
    // The old text said "Fix the cause below", which was only true of the
    // spliced rendering; it now points at where the cause really is.
    expect(record.msg).toContain("record's meta");
    expect(record.msg).not.toContain('below');
    expect(record.error).toBe(MULTILINE_DRIVER);
  });
});

// ── seam 5: a re-arm that could not re-schedule ─────────────────────────────

describe('#5737 — the failed re-schedule error is ONE stderr record', () => {
  it("keeps the job service's multi-line failure out of the message", async () => {
    const store = new InMemorySuspendedRunStore();
    const config = { eventType: 'timer', timerDuration: 'PT2H' };
    const first = bootEngine(store, config);
    expect((await first.execute('wait_flow')).status).toBe('paused');

    const brokenJob: IJobService = {
      async schedule() {
        throw new Error(MULTILINE_JOB);
      },
    } as never;

    const log = new ObjectLogger({ level: 'error', format: 'json' });
    const lines = await captureStream('stderr', async () => {
      const rearmed = await rearmSuspendedWaitTimers(bootEngine(store, config), store, brokenJob, log);
      expect(rearmed).toBe(0);
    });

    const record = soleRecord(lines);
    expect(record.level).toBe('error');
    expect(record.msg).not.toContain('\n');
    expect(record.msg, 'the consequence').toContain('hang past that deadline');
    expect(record.msg, 'the fix').toContain('restart to re-attempt the re-arm');
    // The persisted deadline STAYS in the message: it is a value this file wrote
    // and re-read behind a `Date.parse` guard, not foreign text.
    expect(record.msg).toMatch(/deadline of \d{4}-\d{2}-\d{2}T/);
    expect(record.error).toBe(MULTILINE_JOB);
    expect(record.msg).not.toContain('ECONNREFUSED');
  });
});

// ── seam 1: the wake-up handler's STORE_UNAVAILABLE line ────────────────────

describe('#5737 — the timer wake-up STORE_UNAVAILABLE error is ONE stderr record', () => {
  /**
   * The engine composes this cause as an envelope FIELD, by interpolating the
   * driver's own `message` into a sentence (`resumeInternal`'s
   * `STORE_UNAVAILABLE` return). So the multi-line text arrives here through a
   * second hop, and the fixture is shaped exactly like the real envelope.
   */
  const ENVELOPE = `Durable suspended-run store unreachable for run 'run_1' — retry once the store is available: ${MULTILINE_DRIVER}`;

  async function fireWakeUpInto(log: ObjectLogger, envelope: { error?: string }) {
    const scheduled: Array<{ handler: () => Promise<void> }> = [];
    const job: IJobService = {
      async schedule(_name: string, _sched: unknown, handler: any) {
        scheduled.push({ handler });
      },
      async cancel() {},
      async trigger() {},
    } as never;

    const store = new InMemorySuspendedRunStore();
    const engine = bootEngine(store, { eventType: 'timer', timerDuration: 'PT2H' }, { logger: log, job });
    expect((await engine.execute('wait_flow')).status).toBe('paused');
    expect(scheduled).toHaveLength(1);

    // The wake-up fires into an unreachable store — the branch that must keep
    // the job armed (#5529) and report at `error` (#4632).
    engine.resume = async () => ({ success: false, code: 'STORE_UNAVAILABLE', ...envelope }) as never;
    await scheduled[0].handler();
  }

  it("routes the resume envelope's reason to meta, not into the message", async () => {
    const log = new ObjectLogger({ level: 'error', format: 'json' });
    const lines = await captureStream('stderr', () => fireWakeUpInto(log, { error: ENVELOPE }));

    const record = soleRecord(lines);
    expect(record.level).toBe('error');
    expect(record.msg).not.toContain('\n');
    expect(record.msg, 'why the job was kept').toContain('left ARMED on purpose');
    expect(record.msg, 'both remedies').toMatch(/trigger\('flow-wait:/);
    expect(record.msg).toMatch(/resume\('/);
    expect(record.error).toBe(ENVELOPE);
    expect(record.msg).not.toContain('better-sqlite3');
  });

  it('falls back to a named default when the envelope carries no reason', async () => {
    // `AutomationResult.error` is optional. `describeThrownForLog` is NOT used
    // here precisely because it would render the literal string `"undefined"`
    // into the record for this case.
    const log = new ObjectLogger({ level: 'error', format: 'json' });
    const lines = await captureStream('stderr', () => fireWakeUpInto(log, {}));

    const record = soleRecord(lines);
    expect(record.error).toBe('store unavailable');
  });

  it("calls error(message, undefined, meta) — the contract's third slot", async () => {
    const error = vi.spyOn(ObjectLogger.prototype, 'error');
    const log = new ObjectLogger({ level: 'error', format: 'json' });
    await captureStream('stderr', () => fireWakeUpInto(log, { error: ENVELOPE }));

    const call = error.mock.calls.find((c) => String(c[0]).includes('timer wake-up'));
    expect(call, 'the seam logged at error level').toBeDefined();
    const [message, errorSlot, meta] = call as [string, unknown, Record<string, unknown>];
    expect(message).not.toContain('\n');
    expect(errorSlot).toBeUndefined();
    expect(meta.error).toBe(ENVELOPE);
    error.mockRestore();
  });
});

// ── seam 2: the arming path's schedule failure (`warn` → stdout) ────────────

describe('#5737 — the arming-path schedule warning is ONE stdout record', () => {
  async function armAgainstBrokenJob(log: ObjectLogger): Promise<void> {
    const brokenJob: IJobService = {
      async schedule() {
        throw new Error(MULTILINE_JOB);
      },
      async cancel() {},
    } as never;
    const store = new InMemorySuspendedRunStore();
    const engine = bootEngine(store, { eventType: 'timer', timerDuration: 'PT2H' }, { logger: log, job: brokenJob });
    // Degrade-don't-crash: the run still suspends, only auto-resume is lost.
    expect((await engine.execute('wait_flow')).status).toBe('paused');
  }

  it('the job failure goes to meta and the record survives the boot buffer', async () => {
    // `warn` goes to STDOUT — the stream `serve`'s boot-quiet window wraps, where
    // a head-less continuation line is DROPPED outright rather than merely
    // mis-read. Measured in `pretty`, that window's own format.
    const log = new ObjectLogger({ level: 'warn', format: 'pretty' });
    const lines = await captureStream('stdout', () => armAgainstBrokenJob(log));

    expect(lines, 'one call, one physical line').toHaveLength(1);
    expect(classifies(lines[0]), 'the boot buffer keeps it').toBe(true);
    expect(lines[0]).toContain('failed to schedule timer resume');
    expect(lines[0]).toContain('resume it via resume(runId)');
    expect(lines[0]).toContain('is the queue running?');
  });

  it('calls warn(message, meta) — `warn` has no Error slot', async () => {
    // Verified against the contract rather than assumed: `Logger.warn` is
    // `warn(message, meta?)`, so the cause belongs in argument TWO here even
    // though every `error` seam in this file must use argument THREE.
    const warn = vi.spyOn(ObjectLogger.prototype, 'warn');
    const log = new ObjectLogger({ level: 'warn', format: 'json' });
    await captureStream('stdout', () => armAgainstBrokenJob(log));

    const call = warn.mock.calls.find((c) => String(c[0]).includes('failed to schedule timer resume'));
    expect(call, 'the seam logged at warn level').toBeDefined();
    expect(call).toHaveLength(2);
    const [message, meta] = call as [string, Record<string, unknown>];
    expect(message).not.toContain('\n');
    expect(meta.error).toBe(MULTILINE_JOB);
    warn.mockRestore();
  });
});

// ── the no-cause direction ─────────────────────────────────────────────────

describe('#5737 — a healthy path gains no bytes', () => {
  it('a clean re-arm writes nothing at either level', async () => {
    const store = new InMemorySuspendedRunStore();
    const config = { eventType: 'timer', timerDuration: 'PT2H' };
    await bootEngine(store, config).execute('wait_flow');

    const okJob: IJobService = { async schedule() {}, async cancel() {} } as never;
    const log = new ObjectLogger({ level: 'warn', format: 'json' });

    const err = await captureStream('stderr', async () => {
      const out = await captureStream('stdout', async () => {
        expect(await rearmSuspendedWaitTimers(bootEngine(store, config), store, okJob, log)).toBe(1);
      });
      expect(out).toEqual([]);
    });
    expect(err).toEqual([]);
  });
});

// ── reverse verification, direction predicted before running ───────────────

describe('#5737 — what the interpolated rendering cost, measured', () => {
  it('the pre-fix `error` shape splits one durability alarm into three fragments', async () => {
    // Predicted BEFORE running, and it is the plain red direction: rendering the
    // OLD shape — the cause spliced into the message — must produce SEVERAL
    // physical lines of which exactly ONE carries a level head, so `grep ERROR`
    // returns the line that holds none of the facts. `error` goes to stderr,
    // which nothing buffers, so the record is not dropped — it is MIS-READ, and
    // a file sink stores the continuation lines as records of their own.
    expect(MULTILINE_DRIVER.split('\n'), 'fixture must be multi-line').toHaveLength(3);
    const log = new ObjectLogger({ level: 'error', format: 'pretty' });

    const before = await captureStream('stderr', async () => {
      log.error(
        `[wait] suspended wait-timer re-arm ABORTED — the suspended-run store could not be listed, so NO timer was ` +
          `re-armed. Cause: ${MULTILINE_DRIVER}`,
      );
    });
    expect(before, 'three physical lines from one call').toHaveLength(3);
    expect(before.filter(classifies), 'only the first classifies').toHaveLength(1);
    expect(before[0]).not.toContain('better-sqlite3');
    expect(before[1]).toContain('better-sqlite3');
    expect(before[1]).not.toMatch(RECORD_HEAD);

    // …and the shape this PR ships, through the REAL seam rather than a
    // hand-written call: one line, head intact, every fact on it.
    const after = await captureStream('stderr', async () => {
      await rearmSuspendedWaitTimers(new AutomationEngine(silent()), unreadableStore(MULTILINE_DRIVER), undefined, log);
    });
    expect(after).toHaveLength(1);
    expect(after.filter(classifies)).toHaveLength(1);
    expect(after[0]).toContain('better-sqlite3');
  });

  it('the pre-fix `warn` shape loses its facts to the boot buffer entirely', async () => {
    // Same prediction on the stdout side, where the harm is strictly worse:
    // `BootLogCapture.offer()` RETAINS a physical line only when it classifies,
    // so the continuation lines are not merely unattributed — they are gone.
    const log = new ObjectLogger({ level: 'warn', format: 'pretty' });

    const before = await captureStream('stdout', async () => {
      log.warn(`[wait] node 'pause': failed to schedule timer resume (${MULTILINE_JOB}); suspending without auto-resume`);
    });
    expect(before.length, 'one call, many physical lines').toBeGreaterThan(1);
    const kept = before.filter(classifies);
    expect(kept, 'exactly one line survives the buffer').toHaveLength(1);
    expect(kept[0]).not.toContain('ECONNREFUSED');
    expect(before.length - kept.length, 'lines the buffer drops').toBeGreaterThan(0);
  });
});
