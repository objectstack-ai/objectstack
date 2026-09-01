// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The context a DECLARATIVE background job's handler is invoked with (#14094).
 *
 * ## Why this type exists at all — a job has no graph
 *
 * A `defineStack({ functions })` entry reached from a flow `script` node is
 * handed `FlowFunctionContext`, which carries no engine handle. That emptiness
 * is COHERENT for a flow function: the flow graph does the I/O around it — a
 * `get_record` node before, a `create_record` node after — so the function
 * stays a pure value-returner and #4354's per-run write metrics can count what
 * the graph persisted. ⛔ Nothing here reopens that contract.
 *
 * A JOB has no graph. `defineJob` is the platform's ONLY metadata shape for
 * scheduled work, its handler resolves out of the same `functions` map, and
 * there is no node before it and none after. Until #14094 the context it
 * received was `{ jobId, data, bundle }` — no engine, no logger, nothing to
 * write with — so the one thing scheduled work exists to do (write records on a
 * timer: a nightly sweep, a dispatcher, a reconciliation) had no supported
 * route. The job registered, appeared in the admin UI, was scheduled, ran on
 * time, and did nothing; `objectstack validate` passed and no author-time gate
 * said otherwise.
 *
 * ## Why not "close over a client at module scope"
 *
 * That escape is real for a flow function and does NOT survive the shipped
 * deployment path for a job. The only place an application is handed `ctx.ql`
 * is `defineStack({ onEnable })`, so the escape is really "have `onEnable`
 * assign a module-scope global the handler reads later" — and `objectstack
 * build` emits `functions` into a sibling runtime module exporting only
 * `{ functions, meta }`. The artifact JSON carries no `onEnable` and
 * `mergeRuntimeModule` merges only `functions`, so on an artifact-served boot
 * the binding is never made and the slot stays empty — silently.
 * `app-plugin.job-data-reach.test.ts` pins both boot paths for exactly that
 * reason.
 *
 * ## Additivity
 *
 * This is a WIDENING of the object passed to the handler, in the same shape
 * #6617's `JobRunOutcome` widening took. `IJobService`'s
 * `JobHandler = (context: { jobId: string; data?: unknown }) => …` is untouched
 * — the function `AppPlugin` hands to `IJobService.schedule` is a wrapper that
 * satisfies it exactly, and the members below are added INSIDE that wrapper.
 * An existing handler that destructures `{ jobId }` or `{ jobId, data }` is
 * unchanged byte for byte; no `IJobService` implementation grows a member.
 */

import type { IObjectQLEngine, Logger } from '@objectstack/spec/contracts';

/**
 * What `AppPlugin` invokes a declarative job's `functions` entry with.
 *
 * ```ts
 * // objectstack.config.ts
 * defineStack({
 *   jobs: [defineJob({ name: 'nightly_sweep', schedule: { type: 'cron', expression: '0 1 * * *' }, handler: 'sweep' })],
 *   functions: { sweep: { handler: sweep, effect: 'writes' } },
 * });
 *
 * // the handler — no module-scope global, no onEnable binding seam
 * async function sweep({ jobId, ql, logger }: JobHandlerContext) {
 *   const stale = await ql.find('task', { where: { status: 'open' } });
 *   for (const t of stale) await ql.update('task', { id: t.id, status: 'expired' });
 *   logger.info('swept', { job: jobId, count: stale.length });
 * }
 * ```
 */
export interface JobHandlerContext {
    /** The job's `name` — its identity everywhere (#4667). */
    jobId: string;
    /** Payload of a manual `IJobService.trigger(name, data)` run; absent on a scheduled run. */
    data?: unknown;
    /**
     * The application's metadata bundle, as `AppPlugin` holds it. Present since
     * before #14094 and unchanged — declarations, not a data handle.
     */
    bundle: unknown;
    /**
     * The live ObjectQL engine — the SAME handle `defineStack({ onEnable })`
     * receives as `ctx.ql`. This is the member #14094 added: the supported way
     * for scheduled work to read and write records.
     *
     * A job's writes are not counted by any caller, so its `functions` entry
     * should still declare `effect: 'writes'` (#4396) — that declaration makes
     * the run report "cannot say" instead of silently claiming it wrote nothing.
     */
    ql: IObjectQLEngine;
    /**
     * The plugin logger — the SAME `Logger` `onEnable` receives — so a job's own
     * diagnostics land in the platform's log stream instead of `console`.
     */
    logger: Logger;
}
