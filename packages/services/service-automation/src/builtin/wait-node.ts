// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { IJobService, JobRunOutcome } from '@objectstack/spec/contracts';
import type { AutomationEngine, SuspendedRunStore } from '../engine.js';
import { describeThrownForLog, type ThrownCauseMeta } from '../thrown-cause-diagnostics.js';

/**
 * The one-shot wake-up job's name for a timer `wait` pause — and, by
 * construction, the `correlation` that pause suspends with. One declaration, so
 * the three sites that must agree on it cannot drift: the arming path, the
 * cold-boot re-arm ({@link rearmSuspendedWaitTimers}), and the teardown when the
 * run leaves the node (#5512).
 */
function waitTimerJobName(runId: string, nodeId: string): string {
  return `flow-wait:${runId}:${nodeId}`;
}

/**
 * The `error` line {@link makeWaitTimerJobHandler} owes on the one outcome where
 * the wake-up fires and the pause survives it (#5529) — and the same level
 * {@link RearmLogger} requires for the re-arm path's degradations (#4632),
 * which is why that one extends this.
 *
 * The variadic tail is the `Logger` contract's own
 * (`packages/spec/src/contracts/logger.ts`): `error(message, error?, meta?)`.
 * A foreign cause therefore belongs in argument **three**, never two — the
 * second slot is the `Error` slot, and putting a raw error there ships its whole
 * stack on every record (#5575). #5737 moved all five of this file's causes out
 * of the message into that third slot; the spy cases in
 * `wait-node-log-cause.test.ts` are what hold the positions.
 */
interface WaitTimerLogger {
  error(msg: string, ...args: unknown[]): void;
}

/**
 * The one-shot wake-up job's handler. One declaration, shared by the arming path
 * and the cold-boot re-arm ({@link rearmSuspendedWaitTimers}) for the same
 * reason {@link waitTimerJobName} is one declaration: both sites schedule the
 * same job and must settle it the same way.
 *
 * The job disarms **itself** after its single shot — right for every outcome but
 * one. `engine.resume()` reports failure by RETURNING a code rather than
 * throwing (`AutomationResult.code`), so "this shot consumed the pause" and
 * "this shot missed" are indistinguishable unless the code is read. The bare
 * `finally` this replaces read nothing and cancelled both (#5529):
 *
 *  - **`STORE_UNAVAILABLE`** — the durable suspended-run store could not be
 *    READ, so the pause was **not** consumed: the run is still parked at its
 *    wait node and its row is still there. #4420 draws exactly this line — an
 *    unreachable store must never read as "no such run" — and cancelling here
 *    retires the only thing that was ever going to wake this run. So: keep the
 *    job, and say so at `error`. A run left parked while the process reports a
 *    healthy timer is the durability degradation AGENTS.md's log-level rule is
 *    about (#4632), and this path was previously silent — the result was
 *    discarded by the callback without so much as a `warn`.
 *
 *    Since #5548 this outcome is also RESOLVED as `{ outcome: 'degraded',
 *    reason: 'STORE_UNAVAILABLE' }`, so the job service records the run as
 *    `degraded` rather than `success` — the log line said the shot missed, the
 *    audit row said it succeeded. The `reason` is the short code only: the
 *    driver's own message can be multi-line and belongs in the log record's
 *    `meta` (#5737), not in an audit column.
 *  - **everything else** — cancel, exactly as before. Success consumed the
 *    pause; `RESUME_IN_PROGRESS` means a concurrent resume is consuming it (and
 *    #5512's `onSuspensionReleased` drops this job when it does); a machine-state
 *    failure (`RUN_NOT_FOUND`, a flow/node that no longer exists) means there is
 *    no pause left for this job to serve; and a *thrown* error is not a store
 *    outage, so it does not buy an exemption either.
 *
 * **Keeping the job armed is not self-healing** — measured, not assumed: a
 * `once` schedule is a single `setTimeout` in `IntervalJobAdapter` (which
 * `DbJobAdapter` delegates all timer mechanics to), so it never re-fires on its
 * own. What survival buys is the two things `cancel` destroys. `sys_job` keeps
 * an `active` row carrying the deadline — true here, the run really is still
 * waiting — instead of flipping to `active: false`, which would read as "this
 * wake-up is done" while the run hangs. And the registration stays in the
 * adapter, so `IJobService.trigger(jobName)` re-fires this very wake-up once the
 * store is back, with **no restart**; after a cancel, `trigger` throws "not
 * found" and the only remaining path is the next boot's overdue re-arm pass.
 * Both remedies are named in the log line for that reason.
 *
 * Reachability differs by site, and the honest note is that they are not equal.
 * `resumeInternal` reads the durable store only on a hot-cache miss, and a run
 * that paused in *this* process is cached for as long as the suspension lives —
 * so the **re-arm** callback (a fresh process, empty cache) is where
 * `STORE_UNAVAILABLE` is genuinely reachable today, while the arming callback's
 * branch is latent by construction. It is shared anyway rather than special-cased:
 * a second spelling of "settle the one-shot" is exactly the drift #5512 collapsed.
 */
function makeWaitTimerJobHandler(
  engine: Pick<AutomationEngine, 'resume'>,
  job: IJobService,
  runId: string,
  jobName: string,
  logger: WaitTimerLogger,
): () => Promise<void | JobRunOutcome> {
  return async () => {
    // Set only on the one outcome that must NOT disarm the job. A thrown
    // `resume` leaves it false, so the `finally` still cancels.
    let keepArmed = false;
    // #5548 — what this shot reports to the JOB service, as opposed to what it
    // logs. `STORE_UNAVAILABLE` is the specimen the ruling names: the handler
    // completes normally (deliberately — #5529 refused to make it throw,
    // because a throw is the retry signal third-party `IJobService`
    // implementations key on), so before the `JobRunOutcome` channel existed
    // the run was recorded as `success` on an audit surface whose whole job is
    // to say whether the work happened. Resolving `degraded` instead moves the
    // `sys_job_run` row and nothing else: still no throw, still no retry, and
    // the job still stays ARMED and `active` exactly as #5529 fixed it.
    let outcome: JobRunOutcome | undefined;
    try {
      const result = await engine.resume(runId);
      if (result?.code === 'STORE_UNAVAILABLE') {
        keepArmed = true;
        outcome = { outcome: 'degraded', reason: 'STORE_UNAVAILABLE' };
        // #5737 — the cause goes to `meta`, never into the message. This one is
        // NOT a thrown value and so does NOT go through `describeThrownForLog`:
        // `AutomationResult.error` is a STRING the engine already composed
        // (`spec/contracts/automation-service.ts`), and the helper duck-types
        // `.issues` / `.message` off a thrown object — on a string it has nothing
        // to read, and on `undefined` it would render the literal `"undefined"`
        // in place of the default below. The FIELD NAME is the helper's own
        // (`ThrownCauseMeta.error`), so every seam in this package still reports
        // a non-validation cause under exactly one key.
        //
        // Reachable as multi-line today: the engine builds this envelope by
        // interpolating the driver's own `message` into it (engine.ts, the
        // `STORE_UNAVAILABLE` return of `resumeInternal`).
        const cause: ThrownCauseMeta = { error: result.error ?? 'store unavailable' };
        logger.error(
          `[wait] timer wake-up '${jobName}' fired but could NOT resume run '${runId}': the durable suspended-run store was ` +
            `unreachable, so the pause was never consumed — the run is STILL parked at its wait node, now past its deadline, ` +
            `and this one-shot has already had its single shot, so nothing will wake it on its own. The job is left ARMED on ` +
            `purpose (its 'sys_job' row stays active) so the stuck run stays visible and the wake-up re-firable: once the ` +
            `store is reachable, re-fire it with the job service's trigger('${jobName}'), or resume the run directly via ` +
            `resume('${runId}') — a process restart also picks it up as overdue. The resume envelope's own reason is in ` +
            `this record's meta.`,
          undefined,
          cause,
        );
      }
    } finally {
      if (!keepArmed) {
        // One-shot: drop the job so it never re-fires. Kept alongside the
        // `onSuspensionReleased` teardown because the two answer different
        // questions: that one fires when the RUN leaves the node, this one when
        // the JOB has had its single shot *and* that shot settled the pause one
        // way or the other. Both are `cancel`, which is idempotent.
        try {
          await job.cancel?.(jobName);
        } catch {
          /* best-effort */
        }
      }
    }
    // Resolved, never thrown — the report rides the RETURN value precisely so
    // the failure semantics of `IJobService` stay untouched (#6617).
    return outcome;
  };
}

/**
 * `wait` built-in node — a durable pause (ADR-0019 suspend/resume), the timer /
 * signal sibling of the human-input `screen` and `approval` nodes.
 *
 * On entry the node *suspends* the run (the engine snapshots the continuation
 * and returns `{ status: 'paused', runId }`). How it resumes depends on
 * `waitEventConfig.eventType`:
 *
 *  - **timer** — schedule a one-shot job (`IJobService`, `{ type: 'once', at }`)
 *    that calls `engine.resume(runId)` when the duration elapses. With no job
 *    service the node still suspends, but resumption must come from an external
 *    `resume(runId)` (logged) — never silently no-ops or fails the flow,
 *    matching the platform's degrade-don't-crash convention.
 *  - **signal / webhook / manual / condition** — suspend with the signal name as
 *    the correlation key; an external producer resumes the run when the event
 *    arrives (`resume(runId)`), exactly like a decision-less approval.
 *
 * Whatever wakes the run, the one-shot job is dropped when the pause ends — see
 * `onSuspensionReleased` below (#5512). A timer wait cut short by an external
 * `resume` used to leave its wake-up armed for the full duration. The timer's own
 * callback settles its job separately and on a different question ("has this job
 * had its shot, and did that shot settle the pause?") — see
 * {@link makeWaitTimerJobHandler}, which keeps the job armed on the one outcome
 * that fires without consuming the pause (#5529).
 *
 * Reads its own run id from the `$runId` variable the engine injects at start
 * (same mechanism the approval node uses to map external state back to the run).
 */
export function registerWaitNode(engine: AutomationEngine, ctx: PluginContext): void {
  const getJobService = (): IJobService | undefined => {
    try {
      return ctx.getService<IJobService>('job');
    } catch {
      return undefined;
    }
  };

  engine.registerNodeExecutor({
    type: 'wait',
    descriptor: defineActionDescriptor({
      type: 'wait',
      version: '1.0.0',
      name: 'Wait',
      description: 'Pause the flow until a timer elapses or a named signal arrives.',
      icon: 'timer-reset',
      category: 'logic',
      source: 'builtin',
      // Durable pause — the run suspends and resumes later (timer/signal).
      supportsPause: true,  // (`isAsync` stood here — retired in #6748, ADR-0049: nothing read it)
      // An external producer is *meant* to resume a signal wait, so the generic
      // route is the door (#3801). Stated rather than inherited from a default:
      // #3823 is what inheriting it costs — ADR-0044 pointed a revise edge at a
      // generic `wait`, and the pause in that service-owned position took this
      // value without anyone choosing it (#5561).
      resumeAuthority: 'any',
    }),
    async execute(node, variables, _context) {
      // `waitEventConfig` is the whole contract (`FlowNodeSchema`, flow.zod.ts).
      // The loose `config.*` back door this used to also read — six keys, two of
      // them (`duration`, `signal`) spellings the spec never declared — graduated
      // into the ADR-0087 D2 conversion layer as
      // `flow-node-wait-event-config-lift` (#4045). It is rewritten at load,
      // including the `registerFlow` rehydration seam, so there is nothing left
      // to fall back to here (PD #12: no consumer-side fallbacks).
      //
      // The `?? 'timer'` below is NOT such a fallback: `waitEventConfig` is
      // itself optional, and a wait node without one is a valid timer wait.
      const wec = (node.waitEventConfig ?? {}) as Record<string, unknown>;
      const eventType = String(wec.eventType ?? 'timer');
      const runId = variables.get('$runId');

      if (eventType === 'timer') {
        // One source for the wait length. `timeoutMs` used to double as this
        // when `timerDuration` was absent — it was retired in protocol 17 (#4158)
        // precisely because that is not what it said it did, and the conversion
        // rewrites it to `timerDuration`, so there is one spelling left.
        const durationMs = parseIsoDuration(wec.timerDuration);

        // Persist the wake deadline as node output: the engine writes output
        // to variables (`<nodeId>.waitUntil`) *before* snapshotting the
        // suspended run, so a cold-booted kernel can re-arm the timer from the
        // durable store ({@link rearmSuspendedWaitTimers}).
        const at = durationMs && durationMs > 0 ? new Date(Date.now() + durationMs).toISOString() : undefined;
        const output = at ? { waitUntil: at } : undefined;

        const job = getJobService();
        if (job && runId != null && at) {
          const jobName = waitTimerJobName(String(runId), node.id);
          try {
            await job.schedule(
              jobName,
              { type: 'once', at },
              makeWaitTimerJobHandler(engine, job, String(runId), jobName, ctx.logger),
            );
            return { success: true, suspend: true, correlation: jobName, output };
          } catch (err) {
            // #5737 — `warn(message, meta?)`: the `Logger` contract has no
            // `Error` slot below `error`, so the job service's own failure goes
            // in argument TWO. Unlike the three `error` seams below this one is
            // not a durability degradation (the run still suspends; only
            // auto-resume is lost), which is why it stays `warn` — see the
            // #4632 note on the `no job service` branch in the re-arm pass.
            ctx.logger.warn(
              `[wait] node '${node.id}': failed to schedule timer resume — suspending without auto-resume ` +
                `(resume it via resume(runId)). The job service's own failure is in this record's meta.`,
              describeThrownForLog(err),
            );
          }
        } else if (!job) {
          ctx.logger.warn(
            `[wait] node '${node.id}': no job service registered — suspending without an auto-resume timer ` +
              `(resume it via resume(runId), or install the job service for durable timers)`,
          );
        }
        // Degrade: still suspend; resumption comes from an external resume()
        // (or a later boot's re-arm pass, when the deadline was persisted).
        return { success: true, suspend: true, correlation: `timer:${node.id}`, output };
      }

      // signal / webhook / manual / condition — suspend; an external producer
      // resumes the run when the named event arrives.
      const signal = String(wec.signalName ?? `wait:${node.id}`);
      return { success: true, suspend: true, correlation: signal };
    },

    /**
     * Disarm the one-shot wake-up when the run leaves this node by ANY route
     * (#5512). Until this existed only the timer's own callback dropped its job,
     * so a wait cut short — an external `resume` through the REST door (which
     * the #3801 gate deliberately allows for `wait`), a `cancelRun`, a subflow
     * ancestor failing — left the one-shot armed: it stayed `active` in
     * `sys_job` with tomorrow's `schedule_expression`, read to every operator
     * and test as "a run is still waiting to be woken", and eventually fired a
     * ghost `resume` at a run that had completed the day before.
     *
     * The pause is already consumed when this runs, so cancelling cannot strand
     * the run; and `cancel` on a name the job service no longer holds is a
     * no-op, so a race with the timer's own teardown is harmless.
     */
    async onSuspensionReleased({ runId, nodeId, correlation }) {
      // Only a pause that actually armed a job carries its name as the
      // correlation. The degraded timer (`timer:<nodeId>`) and every signal wait
      // (the author's own signal name) armed nothing, so there is nothing to
      // cancel — and reconstructing the name we mint, rather than prefix-testing
      // a string we may not own, keeps this from ever cancelling by coincidence.
      if (correlation !== waitTimerJobName(runId, nodeId)) return;
      const job = getJobService();
      if (!job?.cancel) return;
      // Errors propagate: the engine catches them and logs one line naming this
      // correlation — which is the job name an operator would cancel by hand.
      await job.cancel(correlation);
    },
  });

  ctx.logger.info('[Wait Node] 1 built-in node executor registered');
}

/**
 * Minimal logger surface for {@link rearmSuspendedWaitTimers}.
 *
 * `error` comes from {@link WaitTimerLogger} and is required, not optional
 * (#4632): every degradation on the re-arm path leaves a run
 * persisted-but-unreachable, which is a durability degradation and must be
 * reported at `error`; a logger that cannot carry that level could not satisfy
 * the contract this function owes its caller. The jobs this pass re-arms carry
 * the same obligation into their own callbacks (#5529), which is the other half
 * of why the shape is shared.
 */
interface RearmLogger extends WaitTimerLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

/**
 * Re-arm auto-resume timers for suspended timer-`wait` runs after a cold boot
 * (ADR-0019 follow-up). The one-shot job a `wait` node schedules lives in the
 * job service's process memory unless that service is itself durable — so a
 * restart loses the wake-up while the suspended run survives in
 * `sys_automation_run`. This pass walks the durable store and:
 *
 *  - **overdue** deadlines (`<nodeId>.waitUntil` in the past) → `resume()` now;
 *  - **future** deadlines → re-schedule the same `flow-wait:<runId>:<nodeId>`
 *    one-shot job (no job service → warn and leave it for an external resume);
 *  - runs without a persisted `waitUntil` (approval / screen / signal pauses,
 *    or pre-deadline-persistence rows) → skipped untouched.
 *
 * Double-fire safe: if the original job *did* survive (durable job store), the
 * second `resume(runId)` finds no suspended run — the engine's resume
 * idempotency absorbs it. Returns how many runs were resumed or re-armed.
 *
 * Called by `AutomationServicePlugin.start()` *after* the flow pull, because
 * `resume()` needs the flow definitions registered.
 */
export async function rearmSuspendedWaitTimers(
  engine: Pick<AutomationEngine, 'resume'>,
  store: SuspendedRunStore,
  job: IJobService | undefined,
  logger: RearmLogger,
): Promise<number> {
  let runs;
  try {
    runs = await store.list();
  } catch (err) {
    // #4632 — durability degradation, not a functional one: returning 0 here
    // re-arms NOTHING, so every run persisted before this restart stays paused
    // forever while the process reports a clean boot. The rows survived; the
    // promise that they would resume did not.
    // #5737 — third argument, per `error(message, error?, meta?)`. NOT the
    // second: a raw `Error` there ships its stack on the record (#5575). This is
    // the seam #5737 measured — a database driver's multi-line failure spliced
    // into this message split the loudest durability alarm in this file into
    // three physical lines, of which only the first carried `<ts> ERROR`.
    logger.error(
      `[wait] suspended wait-timer re-arm ABORTED — the suspended-run store could not be listed, so NO timer was re-armed: ` +
        `every wait/approval paused before this restart will hang indefinitely instead of resuming. The runs themselves are ` +
        `still persisted. Fix the store/datasource failure in this record's meta and restart to re-attempt the re-arm, or ` +
        `resume them via resume(runId).`,
      undefined,
      describeThrownForLog(err),
    );
    return 0;
  }

  let rearmed = 0;
  for (const run of runs) {
    const wakeAt = run.variables?.[`${run.nodeId}.waitUntil`];
    if (typeof wakeAt !== 'string' || !wakeAt) continue; // not a timer wait
    const atMs = Date.parse(wakeAt);
    if (Number.isNaN(atMs)) continue;

    if (atMs <= Date.now()) {
      // Deadline elapsed while the process was down — resume immediately.
      try {
        await engine.resume(run.runId);
        rearmed++;
      } catch (err) {
        // #4632 — this run's deadline already passed, so nothing else will ever
        // wake it: it is persisted, overdue, and now unreachable.
        // #5737 — cause to `meta`'s slot (third), message stays one line. The
        // text said "the cause below", which was only ever true of the spliced
        // rendering; it now names where the cause actually is.
        logger.error(
          `[wait] suspended run '${run.runId}' is OVERDUE and could not be resumed — it stays persisted but nothing will ` +
            `wake it again (its deadline has already passed, so no timer will be re-armed for it). Fix the cause in this ` +
            `record's meta and restart, or resume it directly via resume('${run.runId}').`,
          undefined,
          describeThrownForLog(err),
        );
      }
      continue;
    }

    if (!job) {
      // #4632 — deliberately stays `warn`. This is the FUNCTIONAL half of the
      // rule: a host with no job service never had auto-resume to begin with,
      // so nothing was promised and then broken — the capability is simply not
      // composed, and the line already names the remedy. Escalating a declared
      // absence like this to `error` is the mirror-image failure: it would fire
      // once per suspended run on every boot of every job-less host, and teach
      // everyone to skim `error` — which is what made the #4420 `warn`
      // unreadable in the first place.
      logger.warn(
        `[wait] timer re-arm: run '${run.runId}' waits until ${wakeAt} but no job service is registered — ` +
          `resume it externally via resume(runId)`,
      );
      continue;
    }

    const jobName = waitTimerJobName(run.runId, run.nodeId);
    try {
      await job.schedule(
        jobName,
        { type: 'once', at: wakeAt },
        // Same settle-the-one-shot rule as the arming path, and the site where
        // `STORE_UNAVAILABLE` is actually reachable: this process's hot cache is
        // empty, so the resume reads the durable store (#5529).
        makeWaitTimerJobHandler(engine, job, run.runId, jobName, logger),
      );
      rearmed++;
    } catch (err) {
      // #4632 — the run is persisted and waiting, but its wake-up job was never
      // scheduled: it will sit at its wait node past its deadline with nothing
      // to resume it.
      // #5737 — same as the two `error` seams above: third slot, one-line
      // message. `${wakeAt}` stays in the message on purpose — it is a deadline
      // THIS file persisted and re-read (`typeof === 'string'` + a non-NaN
      // `Date.parse` two branches up), not foreign text.
      logger.error(
        `[wait] suspended run '${run.runId}' could NOT be re-scheduled — it stays persisted with a deadline of ${wakeAt}, ` +
          `but no job was armed to wake it, so it will hang past that deadline instead of resuming. Fix the job-service ` +
          `failure in this record's meta and restart to re-attempt the re-arm, or resume it via resume('${run.runId}').`,
        undefined,
        describeThrownForLog(err),
      );
    }
  }
  return rearmed;
}

/**
 * Parse an ISO-8601 duration (the subset flows use — weeks/days + a time part
 * of hours/minutes/seconds, e.g. `PT1H`, `P3D`, `PT90M`, `P1DT12H`) into
 * milliseconds. A bare positive number is treated as milliseconds. Returns
 * `undefined` for anything unparseable / non-positive.
 */
export function parseIsoDuration(input: unknown): number | undefined {
  if (typeof input === 'number' && Number.isFinite(input)) return input > 0 ? input : undefined;
  if (typeof input !== 'string') return undefined;
  const s = input.trim();
  if (!s) return undefined;
  // Plain numeric string ⇒ milliseconds.
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 0 ? n : undefined;
  }
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s);
  if (!m) return undefined;
  const [, w, d, h, min, sec] = m;
  if (!w && !d && !h && !min && !sec) return undefined;
  const totalSec =
    Number(w ?? 0) * 7 * 86_400 +
    Number(d ?? 0) * 86_400 +
    Number(h ?? 0) * 3_600 +
    Number(min ?? 0) * 60 +
    Number(sec ?? 0);
  const ms = totalSec * 1000;
  return ms > 0 ? ms : undefined;
}
