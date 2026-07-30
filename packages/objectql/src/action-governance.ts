// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0110] Action governance — the addressing vocabulary and the
 * declaration↔executable reconciliation, owned by the ENGINE package.
 *
 * These lived in `@objectstack/runtime`'s action-execution module first, and
 * the D5 boot inventory hung off `AppPlugin`. That placement failed in the
 * field: `AppPlugin` is registered CONDITIONALLY (`serve.ts` skips it when the
 * host already wraps itself, and the `os dev` fast path loads apps without it
 * at all), so on the platform's own dev loop the inventory never ran — the
 * one surface where an upgrade-blocking 404 most needs its checklist printed.
 * The registry being audited is `ObjectQL`'s own `actions` map, so the audit
 * belongs to the plugin that owns the map and is unconditionally present
 * wherever actions can execute.
 *
 * Dependency direction forces the same conclusion: runtime → objectql, never
 * the reverse, so shared logic that the engine plugin needs must live here.
 * Runtime re-exports these under their old names — dispatch and the MCP
 * bridge keep reading the SAME functions, which is the load-bearing property:
 * the inventory can never disagree with the router about what a declaration
 * can address.
 */

/**
 * The engine object key an object-LESS ("global") action registers under.
 *
 * Canonical since #3913, and it is `'global'` because that is what the two
 * writers have always written: `AppPlugin` (`action.object || 'global'`) and
 * `ObjectQLPlugin.actionObjectKey`. `engine.executeAction` is an exact-string
 * `Map` lookup with no wildcard semantics, so the READERS have to probe the
 * same literal — before this, the REST route and the MCP bridge both rotated
 * to `'*'`, which nothing ever registers, and every global action came back as
 * `Action '<name>' on object '*' not found`.
 */
export const GLOBAL_ACTION_OBJECT_KEY = 'global';

/**
 * True when the routed "object" is the object-less placeholder rather than a
 * real object — the canonical `'global'`, the legacy `'*'`, or nothing at all.
 */
export function isObjectLessActionKey(objectName: string | undefined | null): boolean {
    return !objectName || objectName === GLOBAL_ACTION_OBJECT_KEY || objectName === '*';
}

/**
 * The engine object keys to probe, in order, for a route's action handler.
 *
 * The routed object first, then the canonical object-less key (#3913), then
 * the legacy `'*'` — kept last so a handler that user code registered directly
 * against the wildcard still resolves. Deduped, so a request routed AT
 * `/actions/global/:action` probes `'global'` exactly once.
 */
export function actionHandlerObjectKeys(objectName: string): string[] {
    return [objectName, GLOBAL_ACTION_OBJECT_KEY, '*'].filter(
        (k, i, all) => all.indexOf(k) === i,
    );
}

/**
 * [ADR-0110 D2] Handler-key candidates for an action, most-specific first —
 * the *addressing* half of "resolve, then address".
 *
 * A registration key is NOT an action's identity. `AppPlugin` auto-registers
 * **body** actions under `name`, while user code registers a **target-bound**
 * script action under `target` (`engine.registerAction('todo_task',
 * 'completeTask', …)`). Identity is always the declarative `name` (D1); which
 * key the handler happens to live under is derived HERE, from the already-
 * resolved declaration, so no caller ever has to know it.
 *
 * `fallbackKey` (the routed URL segment) is the last candidate and exists for
 * the UNDECLARED case, where there is no declaration to derive anything from.
 * It is deduped away whenever the declaration already yields it, so it never
 * widens what a declared action can reach.
 */
export function resolveActionHandlerKeys(action: any, fallbackKey?: string): string[] {
    const primary = action ? (action.body ? action.name : (action.target || action.name)) : undefined;
    return [primary, action?.target, action?.name, fallbackKey].filter(
        (k: unknown, i: number, a: unknown[]): k is string =>
            typeof k === 'string' && k.length > 0 && a.indexOf(k) === i,
    );
}

/**
 * [ADR-0110 D5] Reconcile the two halves of the declaration↔executable
 * bijection and report the orphans on both sides.
 *
 * ADR-0078 outlaws a declaration nothing executes (silently *inert*); D3
 * outlaws an executable nothing declares (silently *ungoverned*). Together
 * they are one invariant — everything declared runs, everything that runs is
 * declared — and this is the mechanism that makes a violation visible at boot
 * instead of when a caller happens to hit the route.
 *
 * Two findings:
 *  - `undeclaredHandlers` — a registered key that reconciles to no
 *    declaration. Since D3 those are REFUSED at dispatch, so this list is the
 *    upgrade checklist: everything on it is an endpoint that stopped working
 *    and the exact `defineAction` that fixes it.
 *  - `unboundDeclarations` — a declared `script` action with no `body` and no
 *    handler under any candidate key: a button wired to nothing.
 */
export function reconcileActionRegistrations(
    registered: Array<{ objectName: string; actionName: string; package?: string }>,
    declarations: Array<{ action: any; objectName: string }>,
): {
    undeclaredHandlers: Array<{ objectName: string; actionName: string; package?: string }>;
    unboundDeclarations: Array<{ objectName: string; actionName: string }>;
} {
    // Every key any declaration can address, per owning object key.
    const addressable = new Map<string, Set<string>>();
    const addKey = (objectKey: string, handlerKey: string) => {
        let set = addressable.get(objectKey);
        if (!set) addressable.set(objectKey, (set = new Set<string>()));
        set.add(handlerKey);
    };
    for (const { action, objectName } of declarations) {
        for (const key of resolveActionHandlerKeys(action)) addKey(objectName, key);
    }

    const covers = (objectName: string, actionName: string): boolean => {
        if (addressable.get(objectName)?.has(actionName)) return true;
        // A handler registered under an object-less key is addressable by any
        // object-less declaration, mirroring `actionHandlerObjectKeys`.
        if (!isObjectLessActionKey(objectName)) return false;
        for (const [objectKey, keys] of addressable) {
            if (isObjectLessActionKey(objectKey) && keys.has(actionName)) return true;
        }
        return false;
    };

    const undeclaredHandlers = registered.filter((r) => !covers(r.objectName, r.actionName));

    const registeredKeys = new Set(registered.map((r) => `${r.objectName}:${r.actionName}`));
    const unboundDeclarations: Array<{ objectName: string; actionName: string }> = [];
    for (const { action, objectName } of declarations) {
        if ((action?.type ?? 'script') !== 'script') continue; // only script needs a handler
        if (action?.body) continue;                            // its handler is synthesized
        const bound = resolveActionHandlerKeys(action).some((key) =>
            actionHandlerObjectKeys(objectName).some((obj) => registeredKeys.has(`${obj}:${key}`)));
        if (!bound) unboundDeclarations.push({ objectName, actionName: action?.name });
    }

    return { undeclaredHandlers, unboundDeclarations };
}

/** Minimal logger surface the inventory needs — matches PluginContext.logger. */
export interface GovernanceLogger {
    warn(message: string, meta?: Record<string, unknown>): void;
    debug?(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Collect every action declaration this engine can dispatch against, as
 * `{ action, objectName }` rows: each registry object's embedded `actions[]`
 * (the same schemas `getSchema` serves to the router), then standalone
 * `action` items from the metadata service — deduped by `<object>:<name>`
 * with the object-embedded copy winning, mirroring the execution layer's
 * artifact-wins rule.
 */
export async function collectEngineActionDeclarations(
    objects: any[],
    loadStandaloneActions: (() => Promise<any[]>) | undefined,
): Promise<Array<{ action: any; objectName: string }>> {
    const out: Array<{ action: any; objectName: string }> = [];
    const seen = new Set<string>();
    for (const obj of objects ?? []) {
        const objectName: string | undefined = obj?.name;
        if (!objectName) continue;
        for (const action of Array.isArray(obj?.actions) ? obj.actions : []) {
            if (!action || typeof action.name !== 'string') continue;
            seen.add(`${objectName}:${action.name}`);
            out.push({ action, objectName });
        }
    }
    let standalone: any[] = [];
    try {
        standalone = (await loadStandaloneActions?.()) ?? [];
    } catch {
        standalone = []; // no standalone-item source on this kernel
    }
    for (const action of standalone) {
        if (!action || typeof action.name !== 'string') continue;
        const objectName =
            (typeof action.objectName === 'string' && action.objectName) ||
            (typeof action.object === 'string' && action.object) ||
            GLOBAL_ACTION_OBJECT_KEY;
        const key = `${objectName}:${action.name}`;
        if (seen.has(key)) continue; // object-embedded declaration wins
        seen.add(key);
        out.push({ action, objectName });
    }
    return out;
}

/** Stable fingerprint of a finding set, for duplicate-report suppression. */
function fingerprint(r: ReturnType<typeof reconcileActionRegistrations>): string {
    return [
        ...r.undeclaredHandlers.map((h) => `u:${h.objectName}:${h.actionName}`).sort(),
        ...r.unboundDeclarations.map((d) => `d:${d.objectName}:${d.actionName}`).sort(),
    ].join('|');
}

/**
 * [ADR-0110 D5] Run the governance inventory and report findings.
 *
 * Warn-only and exception-proof: a DIAGNOSTIC must never be the reason a
 * kernel fails to boot or a metadata reload fails. Returns the fingerprint of
 * what was reported so callers can suppress byte-identical repeats
 * (`metadata:reloaded` re-runs this; a re-sync that changed nothing should
 * not repeat the same warning).
 */
export async function runActionGovernanceInventory(args: {
    registered: Array<{ objectName: string; actionName: string; package?: string }>;
    objects: any[];
    loadStandaloneActions?: () => Promise<any[]>;
    logger: GovernanceLogger;
    /** Fingerprint returned by the previous run — identical findings are not re-logged. */
    lastFingerprint?: string;
}): Promise<string> {
    try {
        const declarations = await collectEngineActionDeclarations(args.objects, args.loadStandaloneActions);
        const findings = reconcileActionRegistrations(args.registered, declarations);
        const fp = fingerprint(findings);
        if (fp === (args.lastFingerprint ?? '')) return fp;
        if (findings.undeclaredHandlers.length > 0) {
            args.logger.warn(
                '[action-governance] registered handlers with NO declaration — these are REFUSED ' +
                'at dispatch (ADR-0110 D3) and there is no opt-out; declare each one with ' +
                '`defineAction`, or drop the registration if nothing should invoke it over HTTP',
                {
                    count: findings.undeclaredHandlers.length,
                    handlers: findings.undeclaredHandlers.map((h) => `${h.objectName}:${h.actionName}`),
                },
            );
        }
        if (findings.unboundDeclarations.length > 0) {
            args.logger.warn(
                '[action-governance] declared script actions with NO handler — a button wired to ' +
                'nothing (ADR-0078); add a `body`, or register a handler under the declared `target`',
                {
                    count: findings.unboundDeclarations.length,
                    actions: findings.unboundDeclarations.map((d) => `${d.objectName}:${d.actionName}`),
                },
            );
        }
        return fp;
    } catch (err: any) {
        args.logger.debug?.('[action-governance] inventory skipped', {
            error: err?.message ?? String(err),
        });
        return args.lastFingerprint ?? '';
    }
}
