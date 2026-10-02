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
 */

import type { IObjectQLEngine, Logger } from '@objectstack/spec/contracts';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';
import { hookBodyRunnerFactory, actionBodyRunnerFactory } from './sandbox/body-runner.js';
import { GLOBAL_ACTION_OBJECT_KEY } from './action-execution.js';
import { collectBundleActions, collectBundleFunctionEntries, collectBundleHooks } from './app-plugin.js';

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
    const out: AppArtifactHandlerBinding = { owner, hooks: 0, functions: 0, actions: 0 };

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
    // function previously registered on the engine.
    try {
        const hooks = collectBundleHooks(bundle);
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
