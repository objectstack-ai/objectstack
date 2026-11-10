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
 * both under the owner `app:<appId>` ({@link appArtifactHandlerOwner}); a
 * multi-package artifact's actions go under each declaring package's
 * `app:<package id>` instead (see "Each package's actions under its own
 * package" below).
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
 * the old ones firing. For a multi-package artifact the action teardown
 * covers every owner the artifact's previous bind on that engine registered
 * under, and every owner the new bind registers under, so a package body the
 * new bundle no longer carries stops running too: when every action sat under
 * `app:<appId>`, the teardown of that one owner removed it.
 *
 * ## Each package's actions under its own package (ADR-0150 D4)
 *
 * A multi-package artifact (`packages[]`, `composeStacks(…, { manifest:
 * 'preserve' })`) carries each package's actions in that package's body, and
 * each body's action handlers are registered under THAT package
 * (`app:<package id>`, {@link actionBindingGroups}), as an install of each
 * package registers them, so a package-qualified call
 * (`/actions/NS/global/NAME`, `executeAction`'s `packageId`) reaches its own,
 * and two packages of two namespaces may each hold one object-less action of
 * a name. It binds what the reconciled artifact carries, nothing a
 * composition replaced; a key two bodies carry (outside that object-less
 * pair) stays one handler under the artifact's owner, and so does an action
 * the top level carries and no body declares. Hooks and functions stay under
 * the artifact's owner.
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
 * A job runs on a JSON door only through a `body` that binds, or a `pull`. Its
 * deprecated `handler` names a `defineStack({ functions })` entry, which is
 * code: it travels in the artifact's runtime module, which only `os start
 * --artifact` loads, so no JSON door can ever resolve it.
 * {@link collectJobsWithoutBody} names those jobs — and the ones whose `body`
 * the declaration refuses (`judgeJobBody`), and the ones whose `pull` does not
 * bind ({@link judgeJobPull}) — and the install-local install route refuses a
 * package that declares one enabled.
 *
 * ## The pull run form, and the organization a job runs as (#20281 stage ③)
 *
 * `JobSchema.pull` (ruling Q1-B) is the third run form, and the declarative
 * one: `{ mapping }` names a mapping whose `connectorSource` the job pulls on
 * its schedule. It carries no code, so it binds HERE, in this one binder —
 * {@link judgeJobPull} judges it, and each run calls the `automation` service's
 * contract method, `IAutomationService.pullConnectorSource`, resolved through
 * the service registry. A refused pull rejects the run (`failed`, retried per
 * `retryPolicy`); a pull whose rows the import runner refused resolves
 * `degraded` ({@link pullRunOutcomeOf}). It is data, like a `body`, so
 * {@link collectJobsWithoutBody} names it only when {@link judgeJobPull} does
 * not bind it — a job the binder would never schedule, which the install-local
 * install route refuses, as it refuses a `body` that does not bind.
 *
 * `JobSchema.organization` (ruling Q2-O1) is the organization a job runs as —
 * its `body`, its `handler` and its `pull` alike — judged here, at bind, by the
 * deployment-posture rule scheduled flows already use
 * (`resolveScheduledWorkPolicy`, `@objectstack/types`): required under
 * `isolated` (a job that declares none is NOT scheduled, at `error`), optional
 * under `group` (an undeclared job runs with no organization, said once at
 * `warn`), not required under `single`. Each run's execution context is
 * `{ isSystem: true, tenantId: <organization> }`, or `{ isSystem: true }` for a
 * job that declares none ({@link jobExecutionContext}) — except a `pull`, which
 * runs as the organization its writes would be stamped with where the engine
 * can derive one ({@link resolveJobPullOrganization}).
 *
 * A job's identity is its package coordinate — the package's id and the job's
 * name together, as the metadata registry keys it (`<packageId>:<name>`;
 * ADR-0150 D2/D4) — so two packages may each declare a job of the same name and
 * both run (#21602). The job service keys by one string, so a job is scheduled
 * under its authored name unless another package already holds that name on
 * the service, and then under the registry's package-scoped key
 * ({@link jobKeyFor}). A key the job catalogue already holds for that
 * coordinate stays the job's key across a restart, whatever order the boot
 * schedules packages in. A runtime where no two packages share a job name
 * schedules every job under its authored name, exactly as before.
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

import type { PluginContext, SystemWriteOrganizationDecision } from '@objectstack/core';
import type {
    ConnectorSourcePullResult,
    IAutomationService,
    IJobService,
    IObjectQLEngine,
    JobHandler,
    JobRunOutcome,
    Logger,
} from '@objectstack/spec/contracts';
import { JobSchema } from '@objectstack/spec/system';
import { ScheduleOrganizationSchema } from '@objectstack/spec/automation';
import {
    readScheduledWorkPolicy,
    resolveScheduledWorkEnabled,
    resolveScheduledWorkPolicy,
    SCHEDULED_WORK_DISABLED_REASON,
    scheduledWorkDisabledReason,
    type ScheduledWorkPolicy,
    type ScheduledWorkPolicySource,
} from '@objectstack/types';
import { SEMCONV } from '@objectstack/observability';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';
import type { HookRefusalI18nSource } from './sandbox/hook-refusal-catalogue.js';
import {
    hookBodyRunnerFactory,
    actionBodyRunnerFactory,
    jobBodyRunnerFactory,
    judgeJobBody,
    withInProcessHookTitle,
} from './sandbox/body-runner.js';
import { GLOBAL_ACTION_OBJECT_KEY } from './action-execution.js';
import {
    collectBundleActions,
    collectBundleFunctionEntries,
    collectBundleFunctions,
    collectBundleHooks,
    collectBundleJobs,
} from './app-plugin.js';
import { resolveArtifactCollections } from './artifact-collections.js';
import { artifactPackageId, resolveArtifactPackageOrder } from '@objectstack/core';
import { namespacedHoldersMeet } from '@objectstack/spec/kernel';
import { toBoundaryJobSchedule } from './job-schedule.js';
import type { JobHandlerContext } from './job-handler-context.js';
import { resolveMetrics } from './observability/observability-service-plugin.js';

/**
 * The engine owner key the handlers bound for the package `appId` are
 * registered under — the `package` of each `listRegisteredActions()` row and
 * the `packageId` of each hook. For an artifact it names the artifact's id;
 * for a multi-package artifact's action it names the declaring package's id
 * ({@link actionBindingGroups}). ObjectQLPlugin's runtime-authored re-sync reads the same owner as
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
    /**
     * [#26170] The `i18n` service a hook's declared refusal is translated
     * through, read at refusal time. Absent, a declared refusal is answered
     * with its declared message.
     */
    i18n?: HookRefusalI18nSource;
}

/** What one {@link bindAppArtifactHandlers} call bound. */
export interface AppArtifactHandlerBinding {
    /**
     * The artifact's owner key: the hooks, the functions, and every action
     * of a bundle with no `packages[]` were registered under it. A
     * multi-package bundle's actions go under each declaring package's owner
     * instead ({@link actionBindingGroups}).
     */
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

    // [ADR-0150 D4] Each package body's actions under its own package. Read
    // before the teardown, which removes every owner the groups name.
    let actionGroups: ActionBindingGroup[] = [];
    try {
        actionGroups = actionBindingGroups(bundle, owner);
    } catch (err: any) {
        logger.error(`${tag} Failed to read the declared actions`, err as Error, { appId });
    }

    // ── Tear down the owner's previous set ──────────────────────────────
    try {
        if (typeof ql.removeActionsByPackage === 'function') {
            // Every owner this artifact bound last time, and every owner it
            // binds now: a package body the new bundle no longer carries stops
            // running, as it did when every action sat under `owner`.
            const owners = new Set([owner, ...previousActionOwners(ql, owner), ...actionGroups.map((g) => g.owner)]);
            for (const each of owners) ql.removeActionsByPackage(each);
        }
        recordActionOwners(ql, owner, actionGroups.map((g) => g.owner));
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
                    bodyRunner: hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql, logger, appId, i18n: options.i18n }),
                    // [#24289] A handler that runs in-process, an inline function or
                    // the function a string `handler` names, is handed the
                    // `ctx.title(field?)` a `body` gets in the sandbox. The binder
                    // applies it after resolving the name, so both take this one wrap.
                    wrapHandler: (handler, hook) => withInProcessHookTitle(handler, ql, String(hook.name)),
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
        const total = actionGroups.reduce((sum, group) => sum + group.actions.length, 0);
        if (total > 0 && typeof ql.registerAction === 'function') {
            const actionBodyRunner = actionBodyRunnerFactory(new QuickJSScriptRunner(), { ql, logger, appId });
            for (const { owner: actionOwner, actions } of actionGroups) for (const action of actions) {
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
                    ql.registerAction(objectKey, action.name, handler, actionOwner);
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

/**
 * The owners each artifact's last bind registered actions under, per engine
 * (keyed by the artifact's `owner`), so a re-bind tears down a package body
 * the new bundle dropped ({@link bindAppArtifactHandlers}).
 */
const boundActionOwners = new WeakMap<object, Map<string, readonly string[]>>();

function previousActionOwners(ql: object, owner: string): readonly string[] {
    return boundActionOwners.get(ql)?.get(owner) ?? [];
}

function recordActionOwners(ql: object, owner: string, owners: readonly string[]): void {
    let byArtifact = boundActionOwners.get(ql);
    if (!byArtifact) boundActionOwners.set(ql, (byArtifact = new Map()));
    byArtifact.set(owner, [...new Set(owners)]);
}

/** One owner's share of an artifact's declared actions ({@link actionBindingGroups}). */
interface ActionBindingGroup {
    readonly owner: string;
    readonly actions: ReturnType<typeof collectBundleActions>;
}

/**
 * [ADR-0150 D4] An artifact's declared actions, grouped by the owner each is
 * registered under. A bundle with no `packages[]` is one group, under the
 * artifact's `owner`, exactly as before.
 *
 * A bundle carrying `packages[]` binds what the RECONCILED artifact carries
 * (`collectBundleActions(bundle)`, which reads `resolveArtifactCollections`:
 * the composed top level first, where the composition reconciled one object
 * two packages declare under `objectConflict: 'merge'` / `'override'`) and
 * nothing else, so a declaration the composition replaced is bound at no
 * address. Each declaration is then owned by the body that carries its key
 * (`OBJECT:NAME`, the object-less key under `'global'`), read in the boot's
 * package order (`resolveArtifactPackageOrder`):
 *
 *   - one body carries the key: under that body's package
 *     (`app:<package id>`), so a package-qualified call reaches it;
 *   - no body carries it (a top-level residual: an input with no manifest):
 *     under the artifact's `owner`;
 *   - two or more bodies carry it: the reconciled declarations, under the
 *     artifact's `owner`, as the binder bound every key before it read
 *     bodies: one coordinate, where a later registration replaces an earlier
 *     one, so a call that names no package keeps the answer it had. The one exception is the pair `composeStacks` admits
 *     under `manifest: 'preserve'` (#32245): an object-less key whose bodies
 *     are distinct packages no two of which meet under the install gate's
 *     namespace rule (`namespacedHoldersMeet`). Each of those bodies binds
 *     its OWN declaration under its own package, as two installs bind them,
 *     and a call that names no package is refused naming both.
 *
 * The bodies are read to choose each declaration's owner and, for that
 * pair, to bind each body's own declaration. The reconciled set may carry
 * one or both of the pair's declarations (package bodies do not claim
 * against each other in `resolveArtifactCollections`, only the top level
 * does), so the pair's key is split once (`split`), whichever it carries.
 */
function actionBindingGroups(bundle: unknown, owner: string): ActionBindingGroup[] {
    const reconciled = collectBundleActions(bundle);
    const declared = (bundle as { packages?: unknown } | null | undefined)?.packages;
    if (!Array.isArray(declared) || declared.length === 0) return [{ owner, actions: reconciled }];

    type Action = ReturnType<typeof collectBundleActions>[number];
    interface Holder { readonly packageId: string; readonly namespace: string | undefined; readonly actions: Action[] }
    const keyOf = (action: { name: string; object?: string }) =>
        `${typeof action.object === 'string' && action.object.length > 0 ? action.object : GLOBAL_ACTION_OBJECT_KEY}:${action.name}`;

    const holdersByKey = new Map<string, Holder[]>();
    for (const body of resolveArtifactPackageOrder(bundle) as unknown[]) {
        const packageId = artifactPackageId(body);
        if (typeof packageId !== 'string' || packageId === '') continue;
        const ns = (body as { namespace?: unknown } | null | undefined)?.namespace;
        const namespace = typeof ns === 'string' && ns !== '' ? ns : undefined;
        for (const action of collectBundleActions(body)) {
            const key = keyOf(action);
            const holders = holdersByKey.get(key) ?? [];
            let holder = holders.find((h) => h.packageId === packageId);
            if (!holder) {
                holder = { packageId, namespace, actions: [] };
                holders.push(holder);
                holdersByKey.set(key, holders);
            }
            holder.actions.push(action);
        }
    }

    const heldApart = (key: string, holders: readonly Holder[]) =>
        key.startsWith(`${GLOBAL_ACTION_OBJECT_KEY}:`)
        && holders.every((a, i) => holders.every((b, j) => i === j || !namespacedHoldersMeet(a.namespace, b.namespace)));

    const byOwner = new Map<string, Action[]>();
    const add = (to: string, ...actions: Action[]) => {
        const list = byOwner.get(to) ?? [];
        list.push(...actions);
        byOwner.set(to, list);
    };
    const split = new Set<string>();
    for (const action of reconciled) {
        const key = keyOf(action);
        const holders = holdersByKey.get(key) ?? [];
        if (holders.length === 1) add(appArtifactHandlerOwner(holders[0].packageId), action);
        else if (holders.length > 1 && heldApart(key, holders)) {
            if (split.has(key)) continue;
            split.add(key);
            for (const holder of holders) add(appArtifactHandlerOwner(holder.packageId), ...holder.actions);
        } else add(owner, action);
    }
    return [...byOwner].map(([groupOwner, actions]) => ({ owner: groupOwner, actions }));
}

// ─── The job half (#21489) ─────────────────────────────────────────────

/**
 * An enabled job a JSON door cannot run: it carries no `body` — or, since
 * #21585, a `body` that does not BIND (the declaration refuses it: an expression
 * body, or one carrying `body.timeoutMs`), which no door can run either — or a
 * `pull` that does not bind ({@link judgeJobPull}). "Without body" reads as
 * "without a run form that runs". Its `handler` (deprecated) names a
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
    /**
     * Set when the job declares `pull` and it does not bind: the refusal
     * {@link judgeJobPull} gives, the judgement the binder schedules by. Absent
     * for a job that declares no `pull`; a job carrying it carries no
     * `bodyRefusal`, since a `pull` is judged before any `body` beside it.
     */
    pullRefusal?: string;
}

/**
 * The enabled jobs of an artifact that no JSON door can schedule (#21489):
 * those with no `body`, (#21585) those whose `body` does not BIND — an
 * expression (L1) body, or one carrying `body.timeoutMs`, or any other shape
 * the declaration refuses — and those whose `pull` does not bind. The second
 * half is the judgement the binder's own {@link jobBodyRunnerFactory} makes
 * ({@link judgeJobBody}, a parse against `JobSchema.body`), and the third is
 * the binder's own {@link judgeJobPull}, so the door and the binder cannot
 * disagree; such a job is named with its `bodyRefusal` or its `pullRefusal`.
 * The install-local install route refuses a package that declares one; see the
 * module header.
 *
 * Reads the jobs the binder reads ({@link collectBundleJobs}), and calls a job
 * enabled exactly when the binder does: `enabled: false` is the one value that
 * disables it (the schema's default is `true`).
 *
 * A job declaring `pull` (#20281 stage ③) is judged as the binder judges it,
 * first and by the same function: {@link judgeJobPull} against this artifact. A
 * pull that binds is data, like a `body`, and binds on every door, so the job is
 * not named. A pull that does not bind — a mapping the artifact does not
 * declare, one with no `connectorSource`, code beside the `pull` — is a job the
 * binder never schedules, so it is named with its `pullRefusal` and never
 * with a missing `body`, which would send the author to write one beside the
 * `pull`, the shape the declaration refuses.
 */
export function collectJobsWithoutBody(bundle: unknown): JobWithoutBody[] {
    const out: JobWithoutBody[] = [];
    for (const job of collectBundleJobs(bundle)) {
        if (!job || typeof job !== 'object') continue;
        if (job.enabled === false) continue;
        let bodyRefusal: string | undefined;
        let pullRefusal: string | undefined;
        if (job.pull !== undefined) {
            const judged = judgeJobPull(job, bundle);
            if (judged.binds) continue;
            pullRefusal = judged.refusal;
        } else if (job.body) {
            const judged = judgeJobBody(job.body);
            if (judged.binds) continue;
            bodyRefusal = judged.refusal;
        }
        out.push({
            name: typeof job.name === 'string' ? job.name : String(job.name),
            ...(typeof job.handler === 'string' ? { handler: job.handler } : {}),
            ...(bodyRefusal !== undefined ? { bodyRefusal } : {}),
            ...(pullRefusal !== undefined ? { pullRefusal } : {}),
        });
    }
    return out;
}

// ─── The pull run form, and the organization a job runs as (#20281 stage ③) ─

/** What {@link judgeJobPull} answers for a job that declares `pull`. */
export type JobPullJudgement =
    | { binds: true; mapping: string }
    | { binds: false; refusal: string };

/**
 * The mappings an artifact declares — the resolved top-level `mappings`
 * (ADR-0130 D4: every package body's too), else the legacy `manifest.mappings`,
 * the same one-list-or-the-other read {@link collectBundleJobs} makes. A
 * collection in the record form (`{ <name>: mapping }`) is read by its keys.
 */
function collectBundleMappings(bundle: unknown): Array<Record<string, unknown>> {
    const stack = resolveArtifactCollections(bundle) as any;
    const raw = stack?.mappings !== undefined ? stack.mappings : (bundle as any)?.manifest?.mappings;
    if (Array.isArray(raw)) return raw.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object');
    if (raw && typeof raw === 'object') {
        return Object.entries(raw as Record<string, unknown>)
            .filter(([, m]) => !!m && typeof m === 'object')
            .map(([key, m]) => ({ name: key, ...(m as Record<string, unknown>) }));
    }
    return [];
}

/**
 * Does a job's `pull` bind on this artifact? The ONE judgement, read by the
 * binder ({@link scheduleAppArtifactJobs}) before it schedules a pull job, and
 * by {@link collectJobsWithoutBody}, whose answer the install-local install
 * route refuses by — so the door and the binder cannot disagree.
 *
 * It binds when the job declares no code beside it (the declaration refuses
 * `pull` + `body` / `handler`), `pull` parses against `JobSchema.pull`, and the
 * artifact declares the named mapping WITH a `connectorSource` — the reference
 * `defineStack` (and so `os validate`) checks against the stack's mappings. A
 * pull that does not bind is not scheduled: a run of it could only ever be
 * refused by the automation service (`mapping_not_found` /
 * `no_connector_source`), so the reason is said once, at bind, rather than on
 * every tick.
 *
 * `refusal` is the sentence the author acts on, prefixed with the key it names.
 */
export function judgeJobPull(
    job: { pull?: unknown; body?: unknown; handler?: unknown },
    bundle: unknown,
): JobPullJudgement {
    if (job.body !== undefined || job.handler !== undefined) {
        return {
            binds: false,
            refusal: 'pull: the job declares `body` or `handler` beside `pull`, which the declaration refuses — the platform '
                + 'binds the pull itself, so one of the two run forms would never run; keep `pull` or keep the code',
        };
    }
    const parsed = JobSchema.shape.pull.safeParse(job.pull);
    if (!parsed.success || parsed.data === undefined) {
        const first = parsed.success ? undefined : parsed.error.issues[0];
        const at = first && first.path.length > 0 ? `pull.${first.path.map(String).join('.')}: ` : 'pull: ';
        return { binds: false, refusal: `${at}${first ? first.message : 'expected `{ mapping: "<mapping name>" }`'}` };
    }
    const mapping = parsed.data.mapping;
    const declared = collectBundleMappings(bundle).find((m) => m.name === mapping);
    if (!declared) {
        return {
            binds: false,
            refusal: `pull.mapping: this artifact declares no mapping '${mapping}' — declare it (its targetObject, fieldMapping `
                + 'and a connectorSource naming the rest or openapi connector it pulls from) beside the job, or correct the name',
        };
    }
    if (declared.connectorSource === undefined) {
        return {
            binds: false,
            refusal: `pull.mapping: mapping '${mapping}' declares no connectorSource, so there is nothing to pull — add `
                + 'connectorSource: { connector, action } naming the rest or openapi connector it reads from',
        };
    }
    return { binds: true, mapping };
}

/**
 * The organization a job declares (`JobSchema.organization`), or `undefined`.
 * A present-but-unusable value (an empty string, a number) answers `undefined`
 * — the value shape is the scheduled flow's (`ScheduleOrganizationSchema`), and
 * so is the reading: reporting "declared" for a value nothing can act on is the
 * silent acceptance the key exists to end (`resolveScheduleOrganization`).
 */
export function resolveJobOrganization(job: { organization?: unknown }): string | undefined {
    const parsed = ScheduleOrganizationSchema.safeParse(job.organization);
    return parsed.success ? parsed.data : undefined;
}

/**
 * The execution context a job RUNS AS — its `body`'s `ctx.api`, its
 * `handler`'s `JobHandlerContext.executionContext` and its `pull`'s target read
 * and writes alike: system, carrying the job's organization as `tenantId` (the
 * field the tenancy guard reads) where it declares one. Fresh per run, never a
 * shared constant — an execution envelope is a value the engine may extend.
 */
export function jobExecutionContext(organization: string | undefined): { isSystem: true; tenantId?: string } {
    return organization !== undefined ? { isSystem: true, tenantId: organization } : { isSystem: true };
}

/**
 * The engine face {@link resolveJobPullOrganization} asks:
 * `ObjectQL#systemWriteOrganization`, the decision the engine's own
 * system-context insert makes (ADR-0131 D9).
 */
interface SystemWriteOrganizationSource {
    systemWriteOrganization(): Promise<SystemWriteOrganizationDecision>;
}

/**
 * The organization a job's `pull` runs as, resolved ONCE per run, before the
 * pull reads or writes anything.
 *
 * A job that declares an `organization` runs as it, unchanged. A job that
 * declares none runs its pull as the organization its writes would be stamped
 * with anyway: every write of that pull is a system-context insert or update
 * the engine resolves through `resolveSystemWriteOrganization` (ADR-0131 D9),
 * so the engine is asked that same decision up front
 * ({@link SystemWriteOrganizationSource}) — never a second derivation, never a
 * "first organization", never an env default. Only `derived` (the `single`
 * posture, exactly one organization) changes anything: the pull then carries
 * that organization, and the import runner's match lookup scopes by it — one
 * index probe per row instead of a scan of the target table.
 *
 * Every other decision keeps today's context, `{ isSystem: true }`: under a
 * wall, or with zero or several organizations, the WRITE stays the one that
 * refuses, with its own located message; `no-organization-object` has nothing
 * to carry. An engine that does not answer the question (an embedding's own
 * engine) keeps today's context too.
 *
 * Not a write and not a gate: a probe that throws is said once, at `warn`,
 * naming the job, and the run goes on with today's context — the writes then
 * meet the same probe and answer for it.
 */
async function resolveJobPullOrganization(
    ql: unknown,
    declared: string | undefined,
    onProbeFailure: (err: unknown) => void,
): Promise<string | undefined> {
    if (declared !== undefined) return declared;
    const source = ql as Partial<SystemWriteOrganizationSource> | null | undefined;
    if (typeof source?.systemWriteOrganization !== 'function') return undefined;
    let decision: SystemWriteOrganizationDecision;
    try {
        decision = await source.systemWriteOrganization();
    } catch (err) {
        onProbeFailure(err);
        return undefined;
    }
    return decision?.kind === 'derived' ? decision.organizationId : undefined;
}

/**
 * The run outcome of a pull that RESOLVED, mapped once here rather than left to
 * each author: rows the import runner refused make the run `degraded` — it ran
 * to completion and part (or all) of its work did not happen, and a retry
 * would refuse the same rows — with the counts as the reason; otherwise the
 * run `completed`, including a pull that carried no records. A pull that was
 * REFUSED never reaches here: the service rejected, which is the job's
 * `failed` (and the retry policy's trigger).
 */
export function pullRunOutcomeOf(result: ConnectorSourcePullResult): JobRunOutcome {
    const summary = result?.summary;
    const errors = Number(summary?.errors ?? 0);
    if (errors > 0) {
        return {
            outcome: 'degraded',
            reason: `mapping '${result.mapping}': ${errors} of ${result.pulled} pulled record(s) were refused by the import runner `
                + `(${Number(summary?.created ?? 0)} created, ${Number(summary?.updated ?? 0)} updated, ${Number(summary?.skipped ?? 0)} skipped)`,
        };
    }
    return { outcome: 'completed' };
}

/**
 * The sentence an `isolated` deployment's binder logs (at `error`) for a job
 * that declares no organization — the job's counterpart of the scheduled
 * flow's `describeMissingScheduleOrganization`: the same rule, said about a
 * job's key rather than a start node's.
 */
function describeMissingJobOrganization(jobName: string): string {
    return `job '${jobName}' declares no \`organization\`, and this deployment runs the 'isolated' tenancy posture `
        + 'with package-authored scheduled work switched on: a scheduled run has no session to inherit an organization '
        + 'from, so its tenant-scoped writes would all be refused — the job is NOT scheduled. Declare the organization it '
        + "runs in: `organization: '<sys_organization.id>'` on the job. Work wanted in several organizations is one job "
        + 'per organization — a job is never fanned out across them, and no organization is ever chosen for it.';
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
    /**
     * [#31382] THIS kernel's scheduled-work policy, as its host decided it — the
     * jobs half of #19834, the same source the automation engine and both
     * schedule triggers take. Present, it is read ONCE per call in place of
     * both zero-argument deployment reads: `enabled` gates the call, and
     * `requiresActingOrganization` / `runOwnership` are the per-job
     * organization rule. Off, nothing is scheduled, the app's previously
     * scheduled jobs are cancelled, and the info line carries
     * `scheduledWorkDisabledReason(policy)` — the host's own reason when it
     * gave one (#21110).
     *
     * Absent (the default), `resolveScheduledWorkEnabled()` and
     * `resolveScheduledWorkPolicy()` are read exactly as before:
     * `OS_AUTOMATION_SCHEDULED_WORK_ENABLED` keeps its meaning. Hand the
     * engine and the triggers of the same kernel the same policy.
     */
    scheduledWorkPolicy?: ScheduledWorkPolicySource;
}

/** What one {@link scheduleAppArtifactJobs} call scheduled. */
export interface AppArtifactJobScheduling {
    /**
     * Set when nothing was scheduled for a reason that holds for every job:
     * the deployment does not run package-authored scheduled work (#17396) —
     * or (#31382) the host's per-kernel policy turned it off — no job service
     * is registered, or (#20281 stage ③) the scheduled-work policy could not
     * be read — an unrecognized tenancy posture, or a host resolver that
     * threw, so whether a job must declare its organization is unknown.
     */
    withheld?: 'scheduled-work-disabled' | 'no-job-service' | 'scheduled-work-policy-unreadable';
    /** Jobs scheduled to run their sandboxed `body`. */
    bodies: string[];
    /** Jobs scheduled to run the `functions` entry their `handler` names. */
    handlers: string[];
    /** [#20281 stage ③] Jobs scheduled to pull the mapping their `pull` names. */
    pulls: string[];
    /** Enabled jobs with nothing this door could run (an unbindable body or pull, an unresolvable handler, no name). */
    notScheduled: string[];
    /**
     * [#20281 stage ③] Enabled jobs NOT scheduled because they declare no
     * `organization` on a deployment whose posture requires one (`isolated`,
     * with scheduled work switched on).
     */
    missingOrganization: string[];
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
 *   - (#20281 stage ③) no `organization` on a deployment whose scheduled-work
 *     policy requires one (`isolated`, switch on) → NOT scheduled, at `error`
 *     ({@link describeMissingJobOrganization}), whatever its run form;
 *   - a `pull` → the mapping pull, when {@link judgeJobPull} binds it and the
 *     `automation` service serves `pullConnectorSource`; each run calls that
 *     contract method through the service registry under the job's execution
 *     context, and maps the result with {@link pullRunOutcomeOf}. A pull that
 *     does not bind schedules nothing (warn) — install-local refuses that
 *     shape up front ({@link collectJobsWithoutBody}), so on that door this
 *     fires only on the rehydrate of an entry an earlier build installed;
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
 * Every form runs as {@link jobExecutionContext} of the job's organization —
 * the body's `ctx.api`, the handler's `executionContext`, the pull's
 * `context`. A pull of a job that declares none runs as the organization its
 * writes would be stamped with, where the engine derives one
 * ({@link resolveJobPullOrganization}); otherwise as none. Under `group`, the
 * jobs that declare none are named once at `warn`: they are armed, and a
 * tenant-scoped write they make is refused.
 *
 * The schedule is lowered to the boundary tier (`toBoundaryJobSchedule`), and
 * the job's `retryPolicy` / `timeoutMs` are threaded to the adapter. For a body
 * job the same `timeoutMs` also bounds the sandbox run — the one limit
 * `JobSchema.timeoutMs` states.
 *
 * Each job is scheduled under the key {@link jobKeyFor} gives its package
 * coordinate (#21602, ADR-0150 D4): its authored name, or — when another
 * package already holds that name on the job service, or the job catalogue
 * still holds this job under it — the registry's package-scoped
 * `<appId>:<name>`, so the two coexist rather than the later one replacing the
 * earlier, and neither key moves to the other package on a restart. The key is the job SERVICE's
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
    const out: AppArtifactJobScheduling = {
        bodies: [], handlers: [], pulls: [], notScheduled: [], missingOrganization: [], failed: [], cancelled: [],
    };

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
    //
    // [#31382] A host-handed policy is read here, ONCE, and answers both the
    // gate and the posture half below — a resolver that moves between two
    // reads must not pair one reading's verdict with another's rule. A
    // resolver that throws fails CLOSED, as the deployment read below does.
    let hostPolicy: ScheduledWorkPolicy | undefined;
    if (options.scheduledWorkPolicy !== undefined) {
        try {
            hostPolicy = readScheduledWorkPolicy(options.scheduledWorkPolicy);
        } catch (err: any) {
            logger.error(
                `${tag} declarative jobs NOT scheduled — the scheduled-work policy this kernel's host handed could not be `
                + 'read, so whether scheduled work runs here, and whether each job must declare its `organization`, is unknown.',
                err as Error,
                { appId, jobCount: jobs.length },
            );
            if (svc) out.cancelled = await retireAppJobs(svc, appId, new Set(), logger, tag);
            return { ...out, withheld: 'scheduled-work-policy-unreadable' };
        }
    }
    if (hostPolicy ? !hostPolicy.enabled : !resolveScheduledWorkEnabled()) {
        const reason = hostPolicy ? scheduledWorkDisabledReason(hostPolicy) : SCHEDULED_WORK_DISABLED_REASON;
        logger.info(`${tag} declarative jobs NOT scheduled — ${reason}`, {
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
    // [#20281 stage ③] The posture half of the scheduled-work policy — read
    // once per call, AFTER the switch: whether a job must declare its
    // organization is the rule scheduled flows bind by
    // (`requiresActingOrganization`, `runOwnership`), and it is only asked of
    // a deployment that runs scheduled work at all. An unrecognized tenancy
    // posture makes the resolver throw (a typo must not resolve to `single`
    // and drop the requirement with it), so this fails CLOSED: nothing is
    // scheduled, and the reason is said at `error`.
    let policy: ScheduledWorkPolicy;
    try {
        policy = hostPolicy ?? resolveScheduledWorkPolicy();
    } catch (err: any) {
        logger.error(
            `${tag} declarative jobs NOT scheduled — the deployment's scheduled-work policy could not be read, so whether `
            + 'each job must declare its `organization` is unknown. Correct the tenancy posture the error names, then restart.',
            err as Error,
            { appId, jobCount: jobs.length },
        );
        out.cancelled = await retireAppJobs(svc, appId, new Set(), logger, tag);
        return { ...out, withheld: 'scheduled-work-policy-unreadable' };
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
    // [#20281 stage ③] Jobs armed with NO organization on a posture whose
    // writes need one (`group`): legal, and refused at their first
    // tenant-scoped write — said once below, with the remedy.
    const armedWithoutOrganization: string[] = [];

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

        // [#20281 stage ③] The organization the job runs as, judged by the
        // scheduled flows' posture rule. ⛔ No limb picks one for a job that
        // declares none: under `isolated` it is not scheduled, and elsewhere
        // it runs with none — a wrong `organization_id` is worse than a
        // refusal, because it is silently authoritative to every reader.
        const organization = resolveJobOrganization(job);
        if (organization === undefined && policy.requiresActingOrganization) {
            logger.error(`${tag} NOT SCHEDULED — ${describeMissingJobOrganization(jobName)}`, undefined, {
                appId,
                job: jobName,
                posture: policy.posture,
            });
            out.missingOrganization.push(jobName);
            continue;
        }
        if (organization === undefined && policy.runOwnership === 'per-record') {
            armedWithoutOrganization.push(jobName);
        }

        let run: JobHandler;
        let form: 'body' | 'handler' | 'pull';
        if (job.pull !== undefined) {
            // The declarative run form. Judged against the artifact first: a
            // pull whose mapping is missing (or has no `connectorSource`)
            // could only ever be refused, so it is not scheduled.
            const judged = judgeJobPull(job, bundle);
            if (!judged.binds) {
                logger.warn(`${tag} job pull does not bind — the job is NOT scheduled: ${judged.refusal}`, {
                    appId,
                    job: jobName,
                });
                out.notScheduled.push(jobName);
                continue;
            }
            const mapping = judged.mapping;
            let automation: IAutomationService | undefined;
            try { automation = ctx.getService<IAutomationService>('automation'); } catch { /* not installed */ }
            if (typeof automation?.pullConnectorSource !== 'function') {
                logger.warn(
                    `${tag} job '${jobName}' pulls mapping '${mapping}', but no \`automation\` service serving `
                    + '`pullConnectorSource` is registered — the job is NOT scheduled. Compose AutomationServicePlugin '
                    + '(`@objectstack/service-automation`), which holds the connector registry a pull reads through.',
                    { appId, job: jobName, mapping },
                );
                out.notScheduled.push(jobName);
                continue;
            }
            // Resolved again on every run, through the registry — never the
            // instance read above, so a re-registered service is the one called.
            run = async () => {
                let service: IAutomationService | undefined;
                try { service = ctx.getService<IAutomationService>('automation'); } catch { /* reported below */ }
                if (typeof service?.pullConnectorSource !== 'function') {
                    throw new Error(
                        `job '${jobName}' pulls mapping '${mapping}', but the \`automation\` service no longer serves `
                        + '`pullConnectorSource` — nothing was pulled',
                    );
                }
                // [#31823] Resolved once per run, before the pull reads or writes:
                // a job with no organization pulls as the one its writes are
                // stamped with, where the engine derives one.
                const runAs = await resolveJobPullOrganization(ql, organization, (err) => logger.warn(
                    `${tag} job '${jobName}' declares no organization, and the organization its pull's writes would be `
                    + 'stamped with could not be resolved — the pull runs with none, and its match lookup reads by the key alone',
                    { appId, job: jobName, mapping, error: err instanceof Error ? err.message : String(err) },
                ));
                const result = await service.pullConnectorSource({ mapping, context: jobExecutionContext(runAs) });
                return pullRunOutcomeOf(result);
            };
            form = 'pull';
        } else if (job.body) {
            // The body wins over a `handler` beside it, as for hooks. When it
            // cannot be bound the factory has said why, and nothing runs.
            const bound = bodyRunner({ ...job, organization });
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
                    // [#20281 stage ③] The envelope this job runs as — the one
                    // its `body` or `pull` would carry. `ql` stays the raw engine.
                    executionContext: jobExecutionContext(organization),
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

        // [#21602, ADR-0150 D4] The job service's name for this job's package
        // coordinate: the authored name, or the package-scoped key when another
        // package already holds it or the job catalogue keeps this job under it.
        const { key, heldBy, catalogued } = await jobKeyFor(jobService, { packageId: appId, name: jobName }, logger, tag);
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
            (form === 'body' ? out.bodies : form === 'pull' ? out.pulls : out.handlers).push(jobName);
            claimJobKey(jobService, appId, jobName, key);
            if (heldBy !== undefined) {
                logger.info(
                    `${tag} job '${jobName}' is also declared by package '${heldBy}', which holds that name on the job service — `
                    + `scheduled under its package-scoped identity '${key}', the name it carries in the job catalogue and run history`,
                    { appId, job: jobName, scheduledAs: key, heldBy },
                );
            } else if (catalogued) {
                logger.info(
                    `${tag} job '${jobName}' keeps its package-scoped identity '${key}': the job catalogue holds it active under that name `
                    + 'from an earlier run of this package, so its catalogue row and run history stay where they are',
                    { appId, job: jobName, scheduledAs: key },
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

    out.cancelled = await retireAppJobs(
        jobService,
        appId,
        new Set([...out.bodies, ...out.handlers, ...out.pulls]),
        logger,
        tag,
    );

    // [#20281 stage ③] Said once, at `warn`, the way the scheduled flows'
    // bind line says it for a record-less flow under `group`: armed and legal,
    // and its first tenant-scoped write is refused — boot is where an operator
    // is reading, so the remedy is given here rather than only at that tick.
    const armed = new Set([...out.bodies, ...out.handlers, ...out.pulls]);
    const unscoped = armedWithoutOrganization.filter((name) => armed.has(name));
    if (unscoped.length > 0) {
        logger.warn(
            `${tag} ${unscoped.length} job(s) scheduled with NO acting organization (tenancy posture '${policy.posture}'): `
            + `${unscoped.join(', ')}. A job has no record to derive one from, so any tenant-scoped row it writes is REFUSED `
            + 'at the write. Declare `organization` on the job if it writes per-organization data.',
            { appId, jobs: unscoped, posture: policy.posture },
        );
    }

    const scheduled = out.bodies.length + out.handlers.length + out.pulls.length;
    logger.info(`${tag} Scheduled background jobs`, {
        appId,
        count: scheduled,
        bodies: out.bodies.length,
        handlers: out.handlers.length,
        pulls: out.pulls.length,
        notScheduled: out.notScheduled.length,
        missingOrganization: out.missingOrganization.length,
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
 * A job's identity under package addressing (ADR-0150 D2/D4): the package that
 * declares it and its authored name. The package is the app id the job is
 * scheduled under, which both doors derive the way the registry derives the
 * package id (`manifest.id`, else `manifest.name`; `artifactPackageId`).
 */
interface JobCoordinate {
    readonly packageId: string;
    readonly name: string;
}

/** The registry's package-scoped key for a coordinate, `<packageId>:<name>`. */
function packageScopedJobKey(coordinate: JobCoordinate): string {
    return `${coordinate.packageId}:${coordinate.name}`;
}

/**
 * The job catalogue reading `DbJobAdapter.readArming` gives — OPTIONAL and
 * adapter-local, NOT part of `IJobService` (the schedule trigger reads it the
 * same way). A job service without it keeps no catalogue across a restart, so
 * there is no stored key to keep.
 */
interface JobCatalogueReader {
    readArming?(name: string): Promise<{ readonly active: boolean } | null>;
}

/**
 * Does the job catalogue hold `coordinate` ACTIVE under its package-scoped key
 * — scheduled by an earlier run of this package and never cancelled? A
 * cancel (a replace that drops the job, the package's uninstall) clears
 * `active`; a runtime that stops does not. Only the package-scoped key is
 * read: it names its package, so the reading is about THIS job and no other.
 * The bare key names none, and is never read as anyone's.
 *
 * A read that fails is no reading: the job takes the in-process answer, as a
 * job service without a catalogue does, and that is said at `warn` — the job
 * still runs, and only its catalogue name may move.
 */
async function catalogueHoldsScopedKey(svc: IJobService, coordinate: JobCoordinate, logger: Logger, tag: string): Promise<boolean> {
    const reader = svc as IJobService & JobCatalogueReader;
    if (typeof reader.readArming !== 'function') return false;
    const key = packageScopedJobKey(coordinate);
    try {
        return (await reader.readArming(key))?.active === true;
    } catch (err) {
        logger.warn(
            `${tag} could not read the job catalogue for '${key}' — job '${coordinate.name}' is keyed by this run's scheduling order, `
            + 'so on a runtime where another package declares the same job name its catalogue row and run history may move to the other name',
            { appId: coordinate.packageId, job: coordinate.name, error: err instanceof Error ? err.message : String(err) },
        );
        return false;
    }
}

/**
 * The key `coordinate`'s job is scheduled under on `svc` (#21602, ADR-0150 D4).
 *
 * The job's identity is its package coordinate `(packageId, name)` — the
 * metadata registry keys a packaged item `<packageId>:<name>` — but the job
 * service keys by one string and REPLACES a job of the same name, so two
 * packages' same-named jobs need two strings. In order:
 *
 *   1. the key this package already holds the job under in this process — a
 *      reinstall replaces its own job and keeps its catalogue row and run
 *      history;
 *   2. else the package-scoped key, when the job catalogue holds it active
 *      ({@link catalogueHoldsScopedKey}) — an earlier run scheduled this job
 *      under it, so a restart that schedules the packages in another order
 *      never hands this job's name to another package's job, nor this job the
 *      name another package's catalogue row and run history carry;
 *   3. else the authored name, when no other package holds it — so a runtime
 *      in which no two packages share a job name schedules every job under its
 *      authored name, unchanged;
 *   4. else the registry's package-scoped key `<packageId>:<name>`, which no
 *      authored name can equal (`JobSchema.name` is snake_case, so it never
 *      carries the `:`) and no other package ever derives.
 *
 * `heldBy` names the package that holds the authored name when (4) applies:
 * the package that scheduled it first in this process. `catalogued` says (2)
 * applied.
 *
 * ⛔ Nothing here resolves a bare name to a package: a job is scheduled by its
 * own package, so its coordinate is known, and the bare key only ever goes to
 * a package that asks for its own job. The catalogue is read for the asking
 * package's own scoped key only, never to guess who holds a bare one.
 */
async function jobKeyFor(
    svc: IJobService,
    coordinate: JobCoordinate,
    logger: Logger,
    tag: string,
): Promise<{ key: string; heldBy?: string; catalogued?: true }> {
    const mine = scheduledByApp(svc).get(coordinate.packageId)?.get(coordinate.name);
    if (mine !== undefined) return { key: mine };
    // The catalogue read is awaited BEFORE the in-process holder is asked, so
    // the window between that answer and `claimJobKey` is no wider than before.
    const catalogued = await catalogueHoldsScopedKey(svc, coordinate, logger, tag);
    const heldBy = otherHolderOf(svc, coordinate.packageId, coordinate.name);
    if (catalogued) return { key: packageScopedJobKey(coordinate), ...(heldBy === undefined ? { catalogued } : { heldBy }) };
    return heldBy === undefined ? { key: coordinate.name } : { key: packageScopedJobKey(coordinate), heldBy };
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
