// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ScheduleSchema } from '../system/job.zod';

/**
 * Two start-node `config` shapes that parse and then do nothing (#31224 item
 * B, ruling B1 option (a)).
 *
 * A flow's start node `config` is an open record (`FlowNodeSchema.config`), so
 * the parse never judged these two keys, and the readers that do read them
 * skip what they cannot use without telling the author:
 *
 *  - **`config.filter` beside `config.timeRelative`.** A time-relative sweep
 *    reads its row filter from `timeRelative.filter` (`time-relative-trigger.ts`
 *    in `@objectstack/trigger-schedule`); nothing reads a `filter` on the start
 *    node's own `config`, so a sweep written that way launches the flow for
 *    every row in the date window. Refused with the move as the prescription.
 *
 *  - **A `config.schedule` the schedule readers cannot use.** Both readers
 *    (`ScheduleTrigger` for a schedule flow, `TimeRelativeTrigger` for a sweep's
 *    cadence) pass it through `normalizeSchedule` (`schedule-trigger.ts`). A
 *    descriptor it reads nothing from leaves a schedule flow unbound (one warn
 *    in the server log) and a sweep on its default daily 08:00 UTC cadence,
 *    either way not what was written. Three readings, one per form:
 *      - a bare cron STRING is not judged here (the reader takes it verbatim);
 *      - an object that carries `type` is judged against the published
 *        {@link ScheduleSchema} (the discriminant, a cron `timezone` that is a
 *        member of `iana_time_zone`, a positive integer `intervalMs`, an ISO
 *        `at`), and then, as an untyped one is, for being readable at all.
 *        By ruling, the typed aliases the reader happens to bind
 *        (`{ type: 'cron', cron }`, `{ type: 'interval', every }`) are refused
 *        too, because the published schema does not declare those keys; the
 *        refusal names the declared spelling (`expression`, `intervalMs`);
 *      - any other value is refused only when the reader reads nothing from it
 *        ({@link flowStartScheduleReadsNothing}). The untyped aliases the
 *        reader accepts (`{ cron }`, `{ expression }`, `{ every }`,
 *        `{ intervalMs }`, `{ at }`) run today and stay accepted.
 *
 * Top-level `start` nodes only: a start node is never a region member.
 */

export interface FlowStartConfigRefusal {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * `true` when the flow schedule readers read NOTHING from `raw`: the exact
 * complement of what `normalizeSchedule` (`@objectstack/trigger-schedule`)
 * turns into a job schedule, which pins the two together over a table of
 * shapes. `null` / `undefined` read as "not declared" and answer `false`: an
 * absent schedule is not a written one.
 */
export function flowStartScheduleReadsNothing(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw === 'string') return raw.trim().length === 0;
  if (typeof raw !== 'object') return true;
  const s = raw as Record<string, unknown>;
  const type = typeof s.type === 'string' ? s.type : undefined;
  // Each branch is `normalizeSchedule`'s, step for step (truthiness included):
  // the first candidate present decides, and a decided value that is not
  // usable reads nothing even when a later alias would have been.
  if (type === 'cron' || (!type && (typeof s.cron === 'string' || typeof s.expression === 'string'))) {
    const expression =
      (typeof s.expression === 'string' && s.expression) || (typeof s.cron === 'string' && s.cron) || undefined;
    return !expression;
  }
  if (type === 'interval' || (!type && (typeof s.intervalMs === 'number' || typeof s.every === 'number'))) {
    const intervalMs =
      (typeof s.intervalMs === 'number' && s.intervalMs) || (typeof s.every === 'number' && s.every) || undefined;
    return !intervalMs || intervalMs <= 0;
  }
  if (type === 'once' || (!type && typeof s.at === 'string')) {
    return !(typeof s.at === 'string' && s.at);
  }
  return true;
}

/**
 * The key a typed schedule spells another way. `normalizeSchedule` reads the
 * untyped aliases `cron` and `every` inside its typed branches too, but the
 * published {@link ScheduleSchema} declares only `expression` and
 * `intervalMs` on a typed object (ruling 6717636410 §2), so the refusal names
 * the declared spelling.
 */
function typedAliasHint(raw: Record<string, unknown>): string {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(raw, k);
  if (raw.type === 'cron' && has('cron') && !has('expression')) {
    return " A typed cron schedule names its cron in `expression`, not `cron`: write `{ type: 'cron', expression: '…' }`.";
  }
  if (raw.type === 'interval' && has('every') && !has('intervalMs')) {
    return " A typed interval schedule names its period in `intervalMs`, not `every`: write `{ type: 'interval', intervalMs: … }`.";
  }
  return '';
}

function scheduleRefusal(raw: unknown): string | undefined {
  if (raw == null || typeof raw === 'string') {
    return typeof raw === 'string' && flowStartScheduleReadsNothing(raw)
      ? 'The start node\'s `config.schedule` is an empty string, so no schedule is read from it: a schedule ' +
          'flow stays unbound and a time-relative sweep falls back to daily 08:00 UTC. Write a cron expression ' +
          "(e.g. '0 8 * * *') or remove the key."
      : undefined;
  }
  if (isRecord(raw) && Object.prototype.hasOwnProperty.call(raw, 'type')) {
    const parsed = ScheduleSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const at = issue && issue.path.length > 0 ? ` at \`schedule.${issue.path.join('.')}\`` : '';
      return (
        `The start node's \`config.schedule\` is not a schedule${at}: ${issue?.message ?? 'refused'}.` +
        typedAliasHint(raw) +
        ' The schedule ' +
        'readers cannot use it, so a schedule flow stays unbound and a time-relative sweep falls back to daily ' +
        "08:00 UTC. Write `{ type: 'cron', expression: '0 8 * * *', timezone: 'UTC' }`, " +
        "`{ type: 'interval', intervalMs: 60000 }` or `{ type: 'once', at: '<ISO datetime>' }`, or a bare cron string."
      );
    }
  }
  if (!flowStartScheduleReadsNothing(raw)) return undefined;
  return (
    'The start node\'s `config.schedule` names no schedule the readers can use (a cron `expression` as a ' +
    'string, a positive `intervalMs`, or an `at` datetime), so a schedule flow stays unbound and a ' +
    'time-relative sweep falls back to daily 08:00 UTC. Write a cron string such as \'0 8 * * *\', or ' +
    "`{ type: 'cron', expression: '0 8 * * *' }`, `{ type: 'interval', intervalMs: 60000 }` or " +
    "`{ type: 'once', at: '<ISO datetime>' }`."
  );
}

/** The refusals of every top-level start node's `config` in `flow`. */
export function flowStartConfigRefusals(flow: unknown): FlowStartConfigRefusal[] {
  if (!isRecord(flow) || !Array.isArray(flow.nodes)) return [];
  const out: FlowStartConfigRefusal[] = [];
  flow.nodes.forEach((node, index) => {
    if (!isRecord(node) || node.type !== 'start' || !isRecord(node.config)) return;
    const config = node.config;
    // A sweep is a start node whose `timeRelative` is a non-null object, the
    // exact test the trigger-kind resolver (`flow-trigger-kind.ts`) routes by,
    // so `timeRelative: null` is not judged as a sweep.
    const isSweep = config.timeRelative != null && typeof config.timeRelative === 'object';
    if (isSweep && Object.prototype.hasOwnProperty.call(config, 'filter')) {
      out.push({
        path: ['nodes', index, 'config', 'filter'],
        message:
          'The start node declares `config.filter` beside `config.timeRelative`, and nothing reads it: a ' +
          'time-relative sweep takes its row filter from `timeRelative.filter`, so as written the flow ' +
          'launches for every record in the date window. Move it into `config.timeRelative.filter`.',
      });
    }
    if (Object.prototype.hasOwnProperty.call(config, 'schedule')) {
      const message = scheduleRefusal(config.schedule);
      if (message) out.push({ path: ['nodes', index, 'config', 'schedule'], message });
    }
  });
  return out;
}
