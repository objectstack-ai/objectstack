// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE binder of an app artifact's executable handlers (#21321).
 *
 * An artifact declares two kinds of server-side code as DATA: a `type: 'script'`
 * action carrying an inline `body`, and a hook carrying an inline `body` (plus
 * the `functions` a hook may name, when the bundle is code rather than JSON).
 * Registering the artifact's metadata (`manifest.register`) makes the action and
 * the hook DECLARED; only this function makes them RUN — it compiles each body
 * through the QuickJS sandbox and hands the handler to the engine:
 *
 *   - hook bodies (and bundle functions) through `ql.bindHooks(...)`,
 *   - action bodies through `ql.registerAction(object, name, handler, owner)`,
 *
 * both under ONE owner, `app:<appId>` ({@link appArtifactHandlerOwner}).
 *
 * ## Why this is a function and not a block inside `AppPlugin.start`
 *
 * It was that block, and `AppPlugin.start` was its only caller — so an app that
 * reached the runtime any other way was declared and never bound. The measured
 * case is `os package install <artifact>` (the install-local plugin in
 * `@objectstack/cloud-connection`): the installed package's objects, actions and
 * hooks all registered, every door refused its script actions (REST 404, MCP
 * `run_action` "No handler registered"), its body hooks never fired, and an
 * `os start --artifact` boot of the same file dispatched normally. Every path
 * that brings an artifact into a running engine calls this function — there is
 * no second registration path to drift from it:
 *
 *   - `AppPlugin.start` (the boot artifact, `defineStack` configs),
 *   - the install-local plugin's install route and its `kernel:ready` rehydrate.
 *
 * (Jobs: the same doors, through this module's job half — see the last section.)
 *
 * ## Re-binding replaces, it never accumulates
 *
 * Before binding, the owner's previous set is torn down: its action handlers
 * (`removeActionsByPackage`) and its hooks (`unregisterHooksByPackage`). On a
 * first bind that is a no-op; on a reinstall it is what keeps each action at
 * exactly one handler and each hook firing once, and what makes an action or a
 * hook the new version dropped stop running. The explicit hook teardown matters
 * because `bindHooksToEngine` only unregisters when it is handed a NON-empty
 * list — a reinstall whose new version declares no hooks would otherwise keep
 * the old ones firing.
 *
 * Functions are not torn down: they are code (ADR-0088 — never a metadata row),
 * so a JSON artifact cannot carry one, and `registerFunction` replaces by name.
 *
 * ## Failure posture (unchanged from the block it replaces)
 *
 * Never throws. A hook set or an action set that fails to bind is logged at
 * `error` with the app id and the other half still binds; a single action whose
 * registration throws is logged at `warn` and the rest still register.
 *
 * ## The job half (#21489)
 *
 * A job is the third kind of server-side code an artifact declares, and since
 * `JobSchema.body` it too can be DATA: a sandboxed body, the hook body shape.
 * {@link scheduleAppArtifactJobs} is this binder's job half — the ONE place a
 * declared job becomes a scheduled one — and every door above calls it:
 * `AppPlugin` on `kernel:ready`, the install-local plugin on its install route
 * and its rehydrate. It is a second entry point rather than a fourth block in
 * {@link bindAppArtifactHandlers} for one reason, timing: the boot binds hooks
 * and actions in `start()`, but schedules jobs only once the kernel is ready
 * (the job service and the engine have registered), while install-local's
 * doors are already past that point. One implementation, two moments.
 *
 * A job runs on a JSON door only through a `body` that binds. Its deprecated
 * `handler` names a `defineStack({ functions })` entry, which is code: it
 * travels in the artifact's runtime module, which only `os start --artifact`
 * loads, so no JSON door can ever resolve it. {@link collectJobsWithoutBody}
 * names those jobs — and the ones whose `body` the declaration refuses
 * (`judgeJobBody`) — and the install-local install route refuses a package that
 * declares one enabled.
 *
 * A job's identity is the package's and the job's name together, as the
 * metadata registry keys it (`<packageId>:<name>`), so two packages may each
 * declare a job of the same name and both run (#21602). The job service keys by
 * one string, so a job is scheduled under its authored name unless another
 * package already holds that name on the service, and then under the registry's
 * package-scoped key ({@link jobKeyFor}). A runtime where no two packages share
 * a job name schedules every job under its authored name, exactly as before.
 *
 * ## A hook with no `body`, on a door that carries no runtime module (#21585)
 *
 * The same holds for a hook in the deprecated function-name `handler` form, with
 * one difference that makes it worse than a job: the engine resolves a hook's
 * `handler` against the bundle's `functions` AND, failing that, against every
 * function already registered on the engine, by bare name (`HookSchema.handler`
 * declares that fallback). A door that carries no runtime module brings no
 * function of the package's own, so such a hook can never bind to the package's
 * code — only to a function some other app registered, or to nothing.
 *
 * So a door that carries no runtime module — install-local — says so with
 * {@link AppArtifactHandlerBindingOptions.withholdHooksWithoutBody}: every hook
 * {@link collectHooksWithoutBody} names is withheld from `bindHooks`, warned and
 * NOT bound. Its install route refuses a package that declares one, so this
 * fires only on the rehydrate of an entry an older build installed. A boot
 * (`AppPlugin`, `os start --artifact`, a `defineStack` config) carries its
 * runtime module and passes no such option: its handler hooks bind unchanged.
 */

import type { PluginContext } from '@objectstack/core';
import type { IJobService, IObjectQLEngine, JobHandler, Logger } from '@objectstack/spec/contracts';
import { resolveScheduledWorkEnabled, SCHEDULED_WORK_DISABLED_REASON } from '@objectstack/types';
import { SEMCONV } from '@objectstack/observability';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';
import { hookBodyRunnerFactory, actionBodyRunnerFactory, jobBodyRunnerFactory, judgeJobBody } from './sandbox/body-runner.js';
import { GLOBAL_ACTION_OBJECT_KEY } from './action-execution.js';
import {
    collectBundleActions,
    collectBundleFunctionEntries,
    collectBundleFunctions,
    collectBundleHooks,
    collectBundleJobs,
} from './app-plugin.js';
import { resolveArtifactCollections } from './artifact-collections.js';
import { toBoundaryJobSchedule } from './job-schedule.js';
import type { JobHandlerContext } from './job-handler-context.js';
import { resolveMetrics } from './observability/observability-service-plugin.js';

/**
 * The engine owner key every handler bound for `appId` is registered under —
 * the `package` of each `listRegisteredActions()` row and the `packageId` of
 * each hook. ObjectQLPlugin's runtime-authored re-sync reads the same owner as
 * "an installed code package's handler" (`isArtifactShippedAction`).
 */
export function appArtifactHandlerOwner(appId: string): string {
    return `app:${appId}`;
}

export interface AppArtifactHandlerBindingOptions {
    /** The app the handlers belong to: the artifact manifest's `id` (falling back to `name`). */
    appId: string;
    logger: Logger;
    /** Who is binding, for the log lines — `'AppPlugin'`, `'MarketplaceInstallLocal'`. */
    source?: string;
    /**
     * [#21585] Set by a door that carries NO runtime module (install-local): a
     * hook with no `body` ({@link collectHooksWithoutBody}) is withheld from
     * `bindHooks` — warned, NOT bound — because on such a door its `handler`
     * can never name the package's own code. A boot, which carries its runtime
     * module, leaves this unset and binds such hooks as it always did.
     */
    withholdHooksWithoutBody?: boolean;
}

/** What one {@link bindAppArtifactHandlers} call bound. */
export interface AppArtifactHandlerBinding {
    /** The owner key the handlers were registered under. */
    owner: string;
    /** Hook definitions handed to `bindHooks` (0 when none were declared or binding failed). */
    hooks: number;
    /** Bundle functions handed to `bindHooks` alongside them. */
    functions: number;
    /** Action handlers registered — one per bound declaration. */
    actions: number;
    /**
     * [#21585] Hooks withheld under `withholdHooksWithoutBody`, by name — empty
     * when the option is unset or every hook carries a `body`.
     */
    withheldHooks: string[];
}

/**
 * Bind every executable handler an app artifact declares onto `ql`, replacing
 * whatever the same app bound before. See the module header for the contract.
 *
 * @param ql      the engine the app's metadata is registered on
 * @param bundle  the artifact / stack definition — any shape the bundle
 *                collectors accept (flattened manifest, `{ manifest, … }`
 *                envelope, multi-package `packages[]`)
 */
export function bindAppArtifactHandlers(
    ql: IObjectQLEngine,
    bundle: unknown,
    options: AppArtifactHandlerBindingOptions,
): AppArtifactHandlerBinding {
    const { appId, logger } = options;
    const tag = `[${options.source ?? 'AppPlugin'}]`;
    const owner = appArtifactHandlerOwner(appId);
    const out: AppArtifactHandlerBinding = { owner, hooks: 0, functions: 0, actions: 0, withheldHooks: [] };

    // ── Tear down the owner's previous set ──────────────────────────────
    try {
        if (typeof ql.removeActionsByPackage === 'function') ql.removeActionsByPackage(owner);
        if (typeof ql.unregisterHooksByPackage === 'function') ql.unregisterHooksByPackage(owner);
    } catch (err: any) {
        logger.error(`${tag} Failed to tear down the previous handler set`, err as Error, { appId, owner });
    }

    // ── Hooks (and the functions a hook may name) ───────────────────────
    // Inline function handlers are resolved directly; string-named handlers
    // are looked up in `bundle.functions` (registered here too) or in any
    // function previously registered on the engine — which is why a door with
    // no runtime module withholds a hook that has no `body` (#21585).
    try {
        let hooks = collectBundleHooks(bundle);
        if (options.withholdHooksWithoutBody) {
            const withheld = hooksWithoutBodyOf(hooks);
            if (withheld.length > 0) {
                hooks = hooks.filter(hookCarriesBody);
                out.withheldHooks = withheld.map((h) => h.name);
                logger.warn(
                    `${tag} ${withheld.length} hook(s) with no \`body\` NOT bound: ${describeHooks(withheld)}. `
                    + 'This door carries no runtime module, so a hook\'s `handler` can never name the package\'s own code. '
                    + 'Give each hook a `body` (sandboxed JS) and install the package again.',
                    { appId, hooks: out.withheldHooks },
                );
            }
        }
        // Entries, not bare handlers: each function's declared `effect`
        // (#4396) rides along to the registry, where a `script` node reads
        // it to report what its run actually did.
        const functions = collectBundleFunctionEntries(bundle);
        for (const [name, fn] of Object.entries(functions)) {
            if (fn.unrecognizedEffect === undefined) continue;
            logger.warn(`${tag} unrecognized function effect — counted as an uncountable write`, {
                appId,
                name,
                effect: fn.unrecognizedEffect,
                expected: "'pure' | 'writes'",
            });
        }
        if (hooks.length > 0 || Object.keys(functions).length > 0) {
            if (typeof ql.bindHooks === 'function') {
                ql.bindHooks(hooks, {
                    packageId: owner,
                    functions,
                    bodyRunner: hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql, logger, appId }),
                });
                out.hooks = hooks.length;
                out.functions = Object.keys(functions).length;
                logger.info(`${tag} Bound declarative hooks`, {
                    appId,
                    hookCount: out.hooks,
                    functionCount: out.functions,
                });
            } else {
                logger.warn(`${tag} ql.bindHooks unavailable; declarative hooks ignored`, {
                    appId,
                    hookCount: hooks.length,
                });
            }
        }
    } catch (err: any) {
        logger.error(`${tag} Failed to bind declarative hooks`, err as Error, { appId });
    }

    // ── Action bodies ───────────────────────────────────────────────────
    // Actions with an inline `body` are wired to the engine so the REST
    // `/actions` door, MCP `run_action` and the Console button can invoke
    // them. Actions without one are left to imperative
    // `engine.registerAction(...)` registration in user code.
    try {
        const actions = collectBundleActions(bundle);
        if (actions.length > 0 && typeof ql.registerAction === 'function') {
            const actionBodyRunner = actionBodyRunnerFactory(new QuickJSScriptRunner(), { ql, logger, appId });
            for (const action of actions) {
                const handler = actionBodyRunner(action);
                if (!handler) continue;
                // Object-less actions register under the canonical `'global'`
                // key (#3913) — the literal every reader probes
                // (`actionHandlerObjectKeys`), since `executeAction` is an
                // exact-string Map lookup with no wildcard semantics.
                const objectKey =
                    typeof action.object === 'string' && action.object.length > 0
                        ? action.object
                        : GLOBAL_ACTION_OBJECT_KEY;
                try {
                    ql.registerAction(objectKey, action.name, handler, owner);
                    out.actions++;
                } catch (err: any) {
                    logger.warn(`${tag} Failed to register action body`, {
                        appId,
                        action: action.name,
                        object: objectKey,
                        error: err?.message ?? String(err),
                    });
                }
            }
        }
        if (out.actions > 0) {
            logger.info(`${tag} Bound declarative actions`, { appId, actionCount: out.actions });
        }
    } catch (err: any) {
        logger.error(`${tag} Failed to bind declarative actions`, err as Error, { appId });
    }

    return out;
}

// ─── The job half (#21489) ─────────────────────────────────────────────

/**
 * An enabled job a JSON door cannot run: it carries no `body` — or, since
 * #21585, a `body` that does not BIND (the declaration refuses it: an expression
 * body, or one carrying `body.timeoutMs`), which no door can run either. "Without
 * body" reads as "without a body that runs". Its `handler` (deprecated) names a
 * `defineStack({ functions })` entry — code, which a JSON artifact never
 * carries (ADR-0088) — or it names nothing at all.
 */
export interface JobWithoutBody {
    /** The job's `name`. */
    name: string;
    /** The function name the job's `handler` declares, when it declares one. */
    handler?: string;
    /**
     * [#21585] Set when the job HAS a `body` and it does not bind: the
     * declaration's refusal ({@link judgeJobBody}). Absent for a job with no
     * `body` at all.
     */
    bodyRefusal?: string;
}

/**
 * The enabled jobs of an artifact that no JSON door can schedule (#21489):
 * those with no `body`, and (#21585) those whose `body` does not BIND — an
 * expression (L1) body, or one carrying `body.timeoutMs`, or any other shape
 * the declaration refuses. That second half is the judgement the binder's own
 * {@link jobBodyRunnerFactory} makes ({@link judgeJobBody}, a parse against
 * `JobSchema.body`), so the door and the binder cannot disagree; such a job is
 * named with its `bodyRefusal`. The install-local install route refuses a
 * package that declares one; see the module header.
 *
 * Reads the jobs the binder reads ({@link collectBundleJobs}), and calls a job
 * enabled exactly when the binder does: `enabled: false` is the one value that
 * disables it (the schema's default is `true`).
 */
export function collectJobsWithoutBody(bundle: unknown): JobWithoutBody[] {
    const out: JobWithoutBody[] = [];
    for (const job of collectBundleJobs(bundle)) {
        if (!job || typeof job !== 'object') continue;
        if (job.enabled === false) continue;
        let bodyRefusal: string | undefined;
        if (job.body) {
            const judged = judgeJobBody(job.body);
            if (judged.binds) continue;
            bodyRefusal = judged.refusal;
        }
        out.push({
            name: typeof job.name === 'string' ? job.name : String(job.name),
            ...(typeof job.handler === 'string' ? { handler: job.handler } : {}),
            ...(bodyRefusal !== undefined ? { bodyRefusal } : {}),
        });
    }
    return out;
}

// ─── Hooks with no `body` (#21585) ─────────────────────────────────────

/**
 * A hook with no `body`: its code is only a `handler` (deprecated) — a
 * function name — or nothing at all. See the module header for why a door that
 * carries no runtime module neither installs nor binds one.
 */
export interface HookWithoutBody {
    /** The hook's `name`. */
    name: string;
    /** The function name the hook's `handler` declares, when it declares one. */
    handler?: string;
}

/**
 * Does `hook` carry a `body` the engine's binder reads as one? The binder's own
 * body-first test (`resolveHandler` in `@objectstack/objectql`'s hook binder):
 * a `body` object is bound through the body runner and its `handler` is never
 * consulted — whether or not the body then binds — while any other `body` value
 * falls through to the `handler`. So exactly the hooks this answers `false` for
 * are the ones whose `handler` the engine resolves by name.
 */
function hookCarriesBody(hook: any): boolean {
    return Boolean(hook?.body) && typeof hook.body === 'object';
}

function hooksWithoutBodyOf(hooks: readonly any[]): HookWithoutBody[] {
    return hooks.filter((h) => !hookCarriesBody(h)).map((h) => ({
        name: typeof h?.name === 'string' ? h.name : String(h?.name ?? h),
        ...(typeof h?.handler === 'string' ? { handler: h.handler } : {}),
    }));
}

/** `'name' (handler 'fn')`, comma-joined — the same rendering the door's refusal uses. */
function describeHooks(hooks: readonly HookWithoutBody[]): string {
    return hooks.map((h) => `'${h.name}' (${h.handler !== undefined ? `handler '${h.handler}'` : 'no handler'})`).join(', ');
}

/**
 * The hooks of an artifact that carry no `body` (#21585) — every one of them:
 * a hook has no on/off switch (`HookSchema` refuses `enabled` / `active`). The
 * install-local install route refuses a package that declares one, and
 * {@link bindAppArtifactHandlers} withholds them under
 * `withholdHooksWithoutBody`; both read this judgement, over the hooks the
 * binder reads ({@link collectBundleHooks}), so the door and the binder cannot
 * disagree. A hook carrying both a `body` and a `handler` binds its `body` and
 * is not named.
 */
export function collectHooksWithoutBody(bundle: unknown): HookWithoutBody[] {
    return hooksWithoutBodyOf(collectBundleHooks(bundle));
}

export interface AppArtifactJobSchedulingOptions {
    /** The app the jobs belong to: the artifact manifest's `id` (falling back to `name`). */
    appId: string;
    /**
     * The engine a job runs against: a body's `ctx.api` is served from it, and a
     * `handler` job's in-process context carries it as `ql`.
     */
    ql: IObjectQLEngine | undefined;
    /** Who is scheduling, for the log lines — `'AppPlugin'`, `'MarketplaceInstallLocal'`. */
    source?: string;
}

/** What one {@link scheduleAppArtifactJobs} call scheduled. */
export interface AppArtifactJobScheduling {
    /**
     * Set when nothing was scheduled for a reason that holds for every job:
     * the deployment does not run package-authored scheduled work (#17396), or
     * no job service is registered.
     */
    withheld?: 'scheduled-work-disabled' | 'no-job-service';
    /** Jobs scheduled to run their sandboxed `body`. */
    bodies: string[];
    /** Jobs scheduled to run the `functions` entry their `handler` names. */
    handlers: string[];
    /** Enabled jobs with nothing this door could run (an unbindable body, an unresolvable handler, no name). */
    notScheduled: string[];
    /** Jobs whose `IJobService.schedule` call threw. */
    failed: string[];
    /**
     * Jobs this app had scheduled on the job service before, which this call
     * did not schedule again and therefore CANCELLED (#21489): a job the new
     * version dropped, disabled or can no longer run. Re-scheduling replaces;
     * it never leaves the old set running beside the new one.
     */
    cancelled: string[];
}

/**
 * Schedule every job an app artifact declares onto the running job service —
 * the binder's job half (#21489), and the ONE place a declared job becomes a
 * scheduled one. Called by `AppPlugin` on `kernel:ready` and by the
 * install-local plugin on its install route and its rehydrate.
 *
 * Per job, in this order:
 *
 *   - `enabled: false` → skipped (debug);
 *   - a `body` → the sandboxed body (`jobBodyRunnerFactory`), and the `body`
 *     WINS when a `handler` is declared beside it. A body that cannot be bound
 *     (wrong shape, a `body.timeoutMs`) schedules nothing — never the handler
 *     beside it, which would run code the author replaced;
 *   - else a `handler` → the `functions` entry it names, invoked with the
 *     in-process `JobHandlerContext` (#14094). A JSON artifact carries no
 *     functions, so on install-local this resolves nothing — which is why that
 *     door refuses the shape up front ({@link collectJobsWithoutBody});
 *   - else → not scheduled (warn).
 *
 * The schedule is lowered to the boundary tier (`toBoundaryJobSchedule`), and
 * the job's `retryPolicy` / `timeoutMs` are threaded to the adapter. For a body
 * job the same `timeoutMs` also bounds the sandbox run — the one limit
 * `JobSchema.timeoutMs` states.
 *
 * Each job is scheduled under the key {@link jobKeyFor} gives it (#21602): its
 * authored name, or — when another package already holds that name on the job
 * service — the registry's package-scoped `<appId>:<name>`, so the two coexist
 * rather than the later one replacing the earlier. The key is the job SERVICE's
 * name for the job (the `sys_job` / `sys_job_run` name an operator reads); the
 * job's own code and every count this function returns keep the authored name.
 *
 * Re-scheduling replaces, it never accumulates (#21489), as the hook and
 * action halves do: a reinstall schedules each job under the key it already
 * holds, which `IJobService.schedule` replaces, and every job this app
 * scheduled on the job service before and does not schedule now — dropped by
 * the new version, disabled, or no longer runnable — is CANCELLED
 * ({@link retireAppJobs}). A call with no jobs at all cancels everything the
 * app scheduled. The package's uninstall cancels the rest, through the
 * uninstall cleanup this function registers ({@link ensureJobUninstallCleanup}).
 *
 * Never throws: a job that fails to schedule is logged at `error` with its own
 * counter (a silent outage otherwise — the app looks healthy and the work never
 * runs), and the rest still schedule.
 */
export async function scheduleAppArtifactJobs(
    ctx: PluginContext,
    bundle: unknown,
    options: AppArtifactJobSchedulingOptions,
): Promise<AppArtifactJobScheduling> {
    const { appId, ql } = options;
    const logger: Logger = ctx.logger;
    const tag = `[${options.source ?? 'AppPlugin'}]`;
    const out: AppArtifactJobScheduling = { bodies: [], handlers: [], notScheduled: [], failed: [], cancelled: [] };

    const jobs = collectBundleJobs(bundle);
    let svc: IJobService | undefined;
    try { svc = ctx.getService<IJobService>('job'); } catch { /* not installed */ }
    if (svc && typeof svc.schedule !== 'function') svc = undefined;

    // Nothing to schedule: whatever this app scheduled before stops — a
    // reinstall whose new version declares no jobs.
    if (jobs.length === 0) {
        if (svc) out.cancelled = await retireAppJobs(svc, appId, new Set(), logger, tag);
        return out;
    }

    // [#17396] The DEPLOYMENT gate, ahead of the job service probe. Every job
    // reaching this function is PACKAGE-AUTHORED — it arrived through
    // `defineStack({ jobs })` or a package bundle — which is exactly the
    // boundary the switch draws. ⛔ Platform-internal scheduled work is NOT
    // gated and does not pass through here: approvals escalation, the lifecycle
    // Reaper, the messaging dispatch loop and membership backfill each schedule
    // themselves from their own service plugin, because they are part of the
    // runtime a deployment asked for rather than arbitrary load a package put on
    // its clock.
    //
    // `info`, not `warn`: this is the default state of every deployment and the
    // deployment declared it, so nothing is wrong and nothing looks
    // normal-but-broken. Said once per app with the job count, rather than once
    // per job — the remedy is one variable, and repeating it N times is how a
    // line stops being read.
    if (!resolveScheduledWorkEnabled()) {
        logger.info(`${tag} declarative jobs NOT scheduled — ${SCHEDULED_WORK_DISABLED_REASON}`, {
            appId,
            jobCount: jobs.length,
        });
        if (svc) out.cancelled = await retireAppJobs(svc, appId, new Set(), logger, tag);
        return { ...out, withheld: 'scheduled-work-disabled' };
    }
    if (!svc) {
        logger.warn(`${tag} job service not registered — skipping declarative jobs`, { appId, jobCount: jobs.length });
        return { ...out, withheld: 'no-job-service' };
    }
    const jobService: IJobService = svc;
    ensureJobUninstallCleanup(ctx, jobService);

    const fnMap = collectBundleFunctions(bundle);
    // The RESOLVED view a `handler` job is handed as `ctx.bundle`, not the raw
    // bundle: a handler reading `ctx.bundle.objects` on a multi-package option-B
    // artifact would otherwise read `undefined` with nothing thrown (ADR-0130
    // D4, #15005). Identical reference on every bundle that carries no
    // `packages[]`.
    const collections = resolveArtifactCollections(bundle);
    const bodyRunner = jobBodyRunnerFactory(new QuickJSScriptRunner(), { ql, logger, appId });
    const metrics = resolveMetrics(ctx);

    for (const job of jobs) {
        const jobName: string = job?.name;
        if (!jobName) {
            logger.warn(`${tag} skipping job without name`, { appId, job });
            out.notScheduled.push(String(jobName));
            continue;
        }
        if (job.enabled === false) {
            logger.debug(`${tag} job disabled — skipping`, { appId, job: jobName });
            continue;
        }

        let run: JobHandler;
        let form: 'body' | 'handler';
        if (job.body) {
            // The body wins over a `handler` beside it, as for hooks. When it
            // cannot be bound the factory has said why, and nothing runs.
            const bound = bodyRunner(job);
            if (!bound) {
                out.notScheduled.push(jobName);
                continue;
            }
            run = bound;
            form = 'body';
        } else {
            const handler = typeof job.handler === 'string' ? fnMap[job.handler] : undefined;
            if (typeof handler !== 'function') {
                logger.warn(
                    `${tag} job handler not found in bundle.functions — skipping. A job's \`handler\` names a `
                    + '`defineStack({ functions })` entry, which only a boot that loads the artifact\'s runtime module '
                    + '(`os start --artifact`) carries; give the job a `body` to run it on every door.',
                    { appId, job: jobName, handler: job.handler },
                );
                out.notScheduled.push(jobName);
                continue;
            }
            // #14094: the handler is given DATA REACH. A job has no graph — no
            // node before it, none after — so unlike a flow `script` node it
            // cannot be a pure value-returner whose I/O the surrounding graph
            // performs. `ql` is the same engine handle `defineStack({ onEnable })`
            // gets, and it is the only route that survives the ARTIFACT path: an
            // artifact carries no `onEnable` and `mergeRuntimeModule` merges only
            // `functions`, so the module-scope-global escape is never bound on an
            // artifact-served boot. Additive — see `JobHandlerContext`.
            run = async (jobCtx: any) => {
                const jobContext: JobHandlerContext = {
                    ...jobCtx,
                    jobId: jobName,
                    bundle: collections,
                    ql: ql as IObjectQLEngine,
                    logger,
                };
                // #14256: RETURN the handler's resolved value. `JobHandler` is
                // `(context) => Promise<void | JobRunOutcome>` and all three
                // shipped adapters map a resolved `{ outcome: 'degraded', reason }`
                // onto a `sys_job_run.status` distinct from `success`
                // (#6617/#5548). A handler that resolves `undefined` — every
                // handler written before #6617 — is the `success` branch.
                return await handler(jobContext);
            };
            form = 'handler';
        }

        // [#21602] The job service's name for this job: the authored name, or
        // the package-scoped key when another package already holds it.
        const { key, heldBy } = jobKeyFor(jobService, appId, jobName);
        try {
            await jobService.schedule(
                key,
                // #4567: authoring tier → boundary tier. `job.schedule` is the
                // PARSED `Schedule`, whose cron `expression` is the ADR
                // expression envelope `{dialect,source}`; `IJobService.schedule`
                // (and croner behind it) take a bare cron string.
                toBoundaryJobSchedule(job.schedule, jobName),
                run,
                // #3494: thread the authored retryPolicy/timeoutMs to the adapter.
                (job.retryPolicy || job.timeoutMs)
                    ? { retryPolicy: job.retryPolicy, timeoutMs: job.timeoutMs }
                    : undefined,
            );
            (form === 'body' ? out.bodies : out.handlers).push(jobName);
            claimJobKey(jobService, appId, jobName, key);
            if (heldBy !== undefined) {
                logger.info(
                    `${tag} job '${jobName}' is also declared by package '${heldBy}', which holds that name on the job service — `
                    + `scheduled under its package-scoped identity '${key}', the name it carries in the job catalogue and run history`,
                    { appId, job: jobName, scheduledAs: key, heldBy },
                );
            }
        } catch (err: any) {
            out.failed.push(jobName);
            // #4567: a job that fails to schedule is a SILENT OUTAGE — the app
            // builds and boots green while the work never runs. It gets error
            // level plus its own counter, and deliberately NOT the `warn` that
            // "handler not found" / "job disabled" use: those describe a job
            // that was never going to run, this one describes a job the author
            // is owed.
            logger.error(
                `${tag} Background job FAILED TO SCHEDULE — it will never run`,
                err as Error,
                { appId, job: jobName, schedule: job.schedule },
            );
            metrics.counter(SEMCONV.jobScheduleFailuresTotal, { app: appId, job: jobName });
        }
    }

    out.cancelled = await retireAppJobs(jobService, appId, new Set([...out.bodies, ...out.handlers]), logger, tag);

    const scheduled = out.bodies.length + out.handlers.length;
    logger.info(`${tag} Scheduled background jobs`, {
        appId,
        count: scheduled,
        bodies: out.bodies.length,
        handlers: out.handlers.length,
        failed: out.failed.length,
        cancelled: out.cancelled.length,
    });
    if (out.failed.length > 0) {
        logger.error(
            `${tag} Some background jobs are declared but NOT scheduled`,
            undefined,
            { appId, scheduled, failed: out.failed.length },
        );
    }
    return out;
}

// ─── Cancelling a package's jobs: replace, and uninstall (#21489) ───────

/**
 * Which jobs each app's scheduling put on a job service — per app, each
 * authored job name and the KEY it is scheduled under ({@link jobKeyFor}) —
 * keyed by the job service instance: one per kernel, so two kernels in one
 * process never share a record, and a record goes with its kernel.
 *
 * A key is held by one app at a time, so cancelling one app's jobs — a replace
 * or its uninstall — never stops a job another app scheduled (#21602).
 */
const SCHEDULED_BY_APP = new WeakMap<object, Map<string, Map<string, string>>>();

function scheduledByApp(svc: IJobService): Map<string, Map<string, string>> {
    let record = SCHEDULED_BY_APP.get(svc);
    if (!record) {
        record = new Map();
        SCHEDULED_BY_APP.set(svc, record);
    }
    return record;
}

/** The app whose record holds `key` on `svc`, other than `appId` — or `undefined`. */
function otherHolderOf(svc: IJobService, appId: string, key: string): string | undefined {
    for (const [owner, jobs] of scheduledByApp(svc)) {
        if (owner === appId) continue;
        for (const held of jobs.values()) if (held === key) return owner;
    }
    return undefined;
}

/**
 * The key `appId`'s job `jobName` is scheduled under on `svc` (#21602).
 *
 * The job's identity is `(appId, jobName)` — the metadata registry keys a
 * packaged item `<packageId>:<name>` — but the job service keys by one string
 * and REPLACES a job of the same name, so two packages' same-named jobs need two
 * strings. In order:
 *
 *   1. the key this app already holds the job under — a reinstall replaces its
 *      own job and keeps its catalogue row and run history;
 *   2. else the authored name, when no other package holds it — so a runtime
 *      in which no two packages share a job name schedules every job under its
 *      authored name, unchanged;
 *   3. else the registry's package-scoped key `<appId>:<jobName>`, which no
 *      authored name can equal (`JobSchema.name` is snake_case, so it never
 *      carries the `:`) and no other app ever derives.
 *
 * `heldBy` names the package that holds the authored name when (3) applies:
 * the package that scheduled it first in this process — on a restart, the
 * first package the boot schedules.
 */
function jobKeyFor(svc: IJobService, appId: string, jobName: string): { key: string; heldBy?: string } {
    const mine = scheduledByApp(svc).get(appId)?.get(jobName);
    if (mine !== undefined) return { key: mine };
    const heldBy = otherHolderOf(svc, appId, jobName);
    return heldBy === undefined ? { key: jobName } : { key: `${appId}:${jobName}`, heldBy };
}

/**
 * `appId` now holds `jobName` on `svc` under `key`. No other app's record still
 * claims that key — so another app's replace or uninstall can never cancel it.
 */
function claimJobKey(svc: IJobService, appId: string, jobName: string, key: string): void {
    const record = scheduledByApp(svc);
    for (const [owner, jobs] of record) {
        if (owner === appId) continue;
        for (const [name, held] of jobs) if (held === key) jobs.delete(name);
    }
    const mine = record.get(appId) ?? new Map<string, string>();
    mine.set(jobName, key);
    record.set(appId, mine);
}

/** `name`, or `name (scheduled as key)` when the job service knows the job by its package-scoped key. */
function describeScheduledJob(name: string, key: string): string {
    return key === name ? name : `${name} (scheduled as ${key})`;
}

/**
 * Cancel every job `appId` scheduled on `svc` whose authored name is not in
 * `keep`, through `IJobService.cancel` on the key it was scheduled under — the
 * verb every adapter implements (the cron adapter stops its timer, the DB
 * adapter also marks the `sys_job` row inactive). Returns the authored names
 * cancelled.
 *
 * A cancel that throws leaves its job RUNNING for a package that no longer
 * declares it — code that should have stopped keeps executing while the
 * install answered success — so it is logged at `error`, and the job stays on
 * the record for the next replace or the uninstall to retry.
 */
async function retireAppJobs(
    svc: IJobService,
    appId: string,
    keep: ReadonlySet<string>,
    logger: Logger,
    tag: string,
): Promise<string[]> {
    const record = scheduledByApp(svc);
    const previous = record.get(appId);
    const cancelled: string[] = [];
    const remaining = new Map<string, string>();
    for (const [name, key] of previous ?? []) {
        if (keep.has(name)) {
            remaining.set(name, key);
            continue;
        }
        try {
            await svc.cancel(key);
            cancelled.push(name);
        } catch (err: any) {
            remaining.set(name, key);
            logger.error(
                `${tag} a job its package no longer schedules could NOT be cancelled — it keeps running until the runtime restarts`,
                err as Error,
                { appId, job: name, scheduledAs: key },
            );
        }
    }
    if (remaining.size > 0) record.set(appId, remaining);
    else record.delete(appId);
    if (cancelled.length > 0) {
        logger.info(`${tag} Cancelled background jobs the package no longer schedules`, { appId, jobs: cancelled });
    }
    return cancelled;
}

/** The uninstall cleanup's name on the protocol's registry (#21490). */
export const PACKAGE_JOBS_UNINSTALL_CLEANUP = 'runtime.package-jobs';

/** The protocols this process registered the job cleanup on — once each. */
const JOB_CLEANUP_REGISTERED = new WeakSet<object>();

/**
 * Register, once per kernel, the uninstall cleanup that cancels a package's
 * scheduled jobs (#21489): `runtime.package-jobs`, on the protocol's
 * uninstall-cleanup registry (`registerUninstallCleanup`, #21490).
 *
 * Through the registry rather than a door's own uninstall step, because the
 * registry is the ONE place an uninstall's data-plane revocation runs from:
 * the protocol's `deletePackage` and install-local's `DELETE` both run every
 * registered cleanup with the package id, so both now stop the package's jobs
 * with no per-door copy. Before this, an install-local `DELETE` answered 200
 * and the uninstalled package's job body kept executing, with a system-scoped
 * `ctx.api`, until the runtime restarted.
 *
 * Registered from here, the moment a package's jobs are first scheduled on a
 * kernel, because scheduling is what creates something to cancel; the record
 * the cleanup reads is the one {@link claimJobKey} keeps, so it cancels each
 * job under the key it was scheduled under and never another package's job of
 * the same name (#21602). The package id the
 * cleanup receives is the app id the jobs were scheduled under: install-local
 * passes the manifest id, which is what it schedules under. A protocol without
 * the registry registers nothing, and says nothing here: the uninstall door
 * that runs cleanups is the one that reports a missing runner.
 *
 * The cleanup never throws: a job it could not cancel is an outcome
 * (`success: false`, the names in `error`), which both doors report on their
 * uninstall response.
 */
function ensureJobUninstallCleanup(ctx: PluginContext, svc: IJobService): void {
    let protocol: { registerUninstallCleanup?: (name: string, cleanup: (args: { packageId: string }) => Promise<{ success: boolean; removed: number; error?: string }>) => void } | undefined;
    try { protocol = ctx.getService<any>('protocol'); } catch { return; }
    if (!protocol || typeof protocol.registerUninstallCleanup !== 'function') return;
    if (JOB_CLEANUP_REGISTERED.has(protocol)) return;
    JOB_CLEANUP_REGISTERED.add(protocol);
    const logger = ctx.logger;
    protocol.registerUninstallCleanup(PACKAGE_JOBS_UNINSTALL_CLEANUP, async ({ packageId }) => {
        const before = [...(scheduledByApp(svc).get(packageId) ?? [])];
        if (before.length === 0) return { success: true, removed: 0 };
        const cancelled = await retireAppJobs(svc, packageId, new Set(), logger, '[uninstall]');
        const left = before.filter(([name]) => !cancelled.includes(name));
        return left.length === 0
            ? { success: true, removed: cancelled.length }
            : {
                success: false,
                removed: cancelled.length,
                error: `${left.length} job(s) of the uninstalled package could not be cancelled and keep running until the runtime restarts: `
                    + left.map(([name, key]) => describeScheduledJob(name, key)).join(', '),
            };
    });
}
