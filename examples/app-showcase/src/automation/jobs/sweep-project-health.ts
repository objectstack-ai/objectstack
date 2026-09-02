// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sweepProjectHealth` — the handler behind the nightly `showcase_health_sweep`
 * job (see `./index.ts`).
 *
 * ## Why this file exists
 *
 * The job declared `handler: 'sweepProjectHealth'` and nothing of that name was
 * ever defined, so every boot printed
 *
 * ```
 * WARN [AppPlugin] job handler not found in bundle.functions — skipping
 *      {"appId":"com.example.showcase","job":"showcase_health_sweep","handler":"sweepProjectHealth"}
 * ```
 *
 * and the "Nightly Project Health Sweep" never ran (#4774 / #4888). A scheduled
 * job is one of the capabilities the showcase exists to demonstrate end to end,
 * so the fix is a real implementation rather than deleting the declaration —
 * "never advertise a capability the runtime doesn't deliver" (AGENTS.md Prime
 * Directive #10) cuts both ways.
 *
 * ## Where the engine comes from — the ARGUMENT, never a module-scope handle
 *
 * A job handler is resolved through the SAME `defineStack({ functions })`
 * registry as a `script` flow node (`collectBundleFunctions` in
 * `@objectstack/runtime`), and a `script` node's context deliberately carries
 * no data engine: a flow function is PURE, returning a value a later
 * declarative node persists (#4343 / #4396).
 *
 * A JOB is the case that contract does not cover — it has no graph, so no node
 * before it reads and none after it persists. Since #14094 the AppPlugin
 * therefore invokes a job's `functions` entry with a `JobHandlerContext`:
 * `{ jobId, data, bundle }` widened with `ql` (the same engine handle
 * `defineStack({ onEnable })` receives) and `logger`. This handler takes both
 * from that argument, which is the only route that survives the shipped
 * deployment path.
 *
 * ⛔ The shape this file used to have — `onEnable` filling a module-scope
 * `let host` the handler read later — does NOT survive a built artifact, and
 * fails silently rather than loudly. `objectstack build` emits `functions` into
 * a sibling runtime module exporting only `{ functions, meta }`; the artifact
 * JSON carries no `onEnable`, and `mergeRuntimeModule`
 * (`packages/runtime/src/load-artifact-bundle.ts`) merges only `functions`. So
 * on an artifact-served boot the binding was never made, the handle stayed
 * `undefined`, and `showcase_health_sweep` fired on schedule, recomputed
 * nothing, and reported a clean run (#14257). The pin against a return is in
 * `test/inert-wirings.test.ts`, which reaches this handler through its
 * `functions` entry — the one thing an artifact carries — with no `onEnable`
 * anywhere in the test.
 *
 * The entry still DECLARES `effect: 'writes'` in the `functions` map (#4396),
 * and taking `ql` from the argument does not change that: the declaration was
 * never about where the handle came from. A job's writes are counted by no
 * caller — there is no downstream declarative node to count them — so
 * undeclared, a run reports having written nothing instead of "cannot say",
 * which is indistinguishable from the broken sweep #4354 exists to detect.
 *
 * ## What it computes
 *
 * Health is budget burn measured against delivered progress — the drift between
 * the money spent and the work finished:
 *
 *   burn  = spent / budget                       (0 when no budget is set)
 *   done  = mean(task.progress) / 100            (0 when the project has no tasks)
 *   drift = burn - done
 *
 *   red    — over budget (burn > 1), or drift >= 0.30
 *   yellow — drift >= 0.15
 *   green  — otherwise
 *
 * Only `active` / `on_hold` projects are swept: `planned` has nothing to burn
 * yet, and `completed` / `cancelled` are settled facts a nightly job must not
 * relitigate. Writes are limited to the projects whose health actually changed,
 * so a steady-state sweep performs zero updates.
 */

import type { JobHandlerContext } from '@objectstack/runtime';

/** Statuses whose health is still in play. */
const SWEPT_STATUSES = ['active', 'on_hold'] as const;

/** Drift at or above which a project turns red (spending far ahead of delivery). */
const RED_DRIFT = 0.3;
/** Drift at or above which a project turns yellow. */
const YELLOW_DRIFT = 0.15;

/** Bound on rows read per sweep — a demo dataset, read in one pass. */
const READ_LIMIT = 1000;

const SYS = { isSystem: true } as const;

type Health = 'green' | 'yellow' | 'red';

/** Normalize the engine's list shape (array, or `{ records }`). */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const records = (result as { records?: unknown })?.records;
  return Array.isArray(records) ? (records as Array<Record<string, unknown>>) : [];
}

/** Read a numeric column defensively — a currency/progress column may arrive as a string. */
function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * The health verdict for one project — exported so the rule is unit-testable
 * without an engine (see `test/inert-wirings.test.ts`).
 */
export function healthFor(input: {
  budget?: unknown;
  spent?: unknown;
  taskProgress: readonly number[];
}): Health {
  const budget = num(input.budget) ?? 0;
  const spent = num(input.spent) ?? 0;
  const burn = budget > 0 ? spent / budget : 0;
  if (burn > 1) return 'red';

  const done =
    input.taskProgress.length > 0
      ? input.taskProgress.reduce((sum, p) => sum + p, 0) / input.taskProgress.length / 100
      : 0;

  const drift = burn - done;
  if (drift >= RED_DRIFT) return 'red';
  if (drift >= YELLOW_DRIFT) return 'yellow';
  return 'green';
}

/**
 * Recompute `showcase_project.health` for every in-play project.
 *
 * Registered as `functions.sweepProjectHealth` with `effect: 'writes'` and
 * scheduled by `HealthSweepJob` (`0 1 * * *` UTC).
 *
 * `jobId`, `ql` and `logger` all come off the `JobHandlerContext` the AppPlugin
 * builds per run — there is no binding step, so there is no boot path on which
 * this handler can be reached without them.
 */
export async function sweepProjectHealth({ jobId, ql, logger }: JobHandlerContext): Promise<void> {
  const projects = rowsOf(
    await ql.find('showcase_project', {
      where: { status: { $in: [...SWEPT_STATUSES] } },
      fields: ['id', 'status', 'health', 'budget', 'spent'],
      limit: READ_LIMIT,
      context: SYS,
    }),
  );
  if (projects.length === 0) {
    logger.info('[showcase] project health sweep: no in-play projects', { job: jobId });
    return;
  }

  const projectIds = projects.map((p) => String(p.id));
  const tasks = rowsOf(
    await ql.find('showcase_task', {
      where: { project: { $in: projectIds } },
      fields: ['project', 'progress'],
      limit: READ_LIMIT,
      context: SYS,
    }),
  );

  const progressByProject = new Map<string, number[]>();
  for (const task of tasks) {
    const projectId = task.project == null ? '' : String(task.project);
    if (!projectId) continue;
    const progress = num(task.progress) ?? 0;
    const bucket = progressByProject.get(projectId);
    if (bucket) bucket.push(progress);
    else progressByProject.set(projectId, [progress]);
  }

  let updated = 0;
  for (const project of projects) {
    const id = String(project.id);
    const next = healthFor({
      budget: project.budget,
      spent: project.spent,
      taskProgress: progressByProject.get(id) ?? [],
    });
    if (next === project.health) continue;
    try {
      await ql.update('showcase_project', { id, health: next }, { context: SYS });
      updated += 1;
    } catch (err) {
      logger.warn('[showcase] project health update failed', {
        job: jobId,
        project: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('[showcase] project health sweep complete', {
    job: jobId,
    scanned: projects.length,
    updated,
  });
}
