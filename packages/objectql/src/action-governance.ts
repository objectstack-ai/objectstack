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
 * Runtime re-exports these under their old names, so dispatch and the MCP
 * bridge keep reading the SAME functions.
 *
 * That sharing bought LESS than this docblock used to claim, and the claim is
 * corrected here rather than merely repaired below. It read: "the inventory
 * can never disagree with the router about what a declaration can address."
 * True of ADDRESSING — which handler keys a declaration reaches, derived by
 * {@link resolveActionHandlerKeys} / {@link actionHandlerObjectKeys} on both
 * sides. Never true of EXISTENCE, which the two sides answered from different
 * sources: `resolveRouteActionDeclaration` resolves a declaration in three
 * rungs — the object's embedded `actions[]`, then the engine registry's
 * standalone `action` items (`registry.getItem('action', name)`, accepted
 * when the item owns the route), then the metadata service's `action` rows —
 * while this inventory built its declaration set from the first and the last
 * only. Measured consequence: on the in-process boot, where the metadata
 * plane carries no `action` rows, an object-LESS `defineAction` living in the
 * registry alone was reported as a "registered handler with NO declaration …
 * REFUSED at dispatch" in the same boot in which the router resolved it at
 * rung 2 and dispatched it.
 *
 * Both halves are shared now. The addressing vocabulary lives here, and so
 * does the ownership test that decides whether a registry item covers a route
 * ({@link standaloneActionOwnerKey}). The registry rung itself arrives as the
 * caller-injected `lookupRegistryAction`, because objectql cannot import the
 * router — the one caller that holds `ql` hands the rung over. The invariant
 * this file may claim, and no more: the inventory reports a handler as
 * undeclared only when EVERY source the router resolves through answered
 * nothing for it.
 *
 * [#14423] EXISTENCE is settled now too, on both halves of the D5 bijection
 * and in both of the ways the two sides could disagree:
 *
 *  - IDENTITY — the metadata plane is read KEYED
 *    (`MetadataManager.loadManyKeyed`), so a declaration is identified by the
 *    key its store holds it under (#14205) rather than by `body.name`. A body
 *    is not required to name itself, and both shipped loaders can hold one
 *    that does not; keying by the body dropped exactly those, in an audit
 *    whose whole job is to say what exists.
 *  - AVAILABILITY — the handler half also asks the metadata plane BY NAME,
 *    the router's third rung, so a loader fault that a plural read swallows
 *    can no longer turn a dispatchable handler into an accusation. Its
 *    counterpart in the manager is `listNames` gaining `loadMany`'s
 *    per-loader fault parity, which is where that asymmetry was born.
 */

/**
 * The engine object key an object-LESS ("global") action registers under.
 *
 * Canonical since #3913, and it is `'global'` because that is what the two
 * writers have always written: `AppPlugin` (`action.object || 'global'`) and
 * the ObjectQL plugin (now via {@link standaloneActionOwnerKey}, which is
 * why that writer no longer spells the literal itself). `engine.executeAction`
 * is an exact-string `Map` lookup with no wildcard semantics, so the READERS
 * have to probe the same literal — before this, the REST route and the MCP
 * bridge both rotated to `'*'`, which nothing ever registers, and every global
 * action came back as `Action '<name>' on object '*' not found`.
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
 * The engine object key a STANDALONE action declaration owns.
 *
 * Standalone `action` metadata declares `objectName` (spec `ActionSchema`);
 * bundle collectors attach `object`; an object-less action owns the canonical
 * `'global'` key. Three other writers spelled this same three-line ladder —
 * the runtime's `standaloneActionObjectName`, a private owner-key method on the
 * ObjectQL plugin, and an inline copy inside
 * {@link collectEngineActionDeclarations}. All of them resolve HERE now: the
 * plugin calls this function directly (same package) and
 * `@objectstack/runtime` re-exports it, keeping `standaloneActionObjectName`
 * as a delegating alias for its own callers.
 *
 * ⛔ Do not re-inline it. What this replaced was a set of docblocks promising
 * lockstep, which is documentation standing in for a check — and the plugin's
 * copy had already drifted in the way only a copy can: it terminated on a bare
 * `'global'` literal rather than {@link GLOBAL_ACTION_OBJECT_KEY}, equal in
 * value and invisible to every test, so the day the constant moved they would
 * have parted in silence.
 */
export function standaloneActionOwnerKey(action: any): string {
    if (typeof action?.objectName === 'string' && action.objectName.length > 0) return action.objectName;
    if (typeof action?.object === 'string' && action.object.length > 0) return action.object;
    return GLOBAL_ACTION_OBJECT_KEY;
}

/**
 * The router's rung-2 acceptance test: does this standalone declaration own
 * the route a handler is registered on?
 *
 * Byte-for-byte the `ownsRoute` predicate inside
 * `resolveRouteActionDeclaration` — `owner === objectName ||
 * isObjectLessActionKey(owner)`. Note the asymmetry, which is deliberate and
 * must be mirrored rather than tidied: an object-LESS declaration owns ANY
 * route, while an object-bound one owns only its own object.
 */
export function standaloneActionOwnsRoute(action: any, objectName: string): boolean {
    const owner = standaloneActionOwnerKey(action);
    return owner === objectName || isObjectLessActionKey(owner);
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
 *    declaration IN THE SET IT WAS GIVEN. Read the scope literally: this
 *    function is pure set reconciliation and knows nothing about the sources
 *    that set came from, so its answer is the upgrade checklist only once the
 *    caller has consulted every source the router resolves through.
 *    {@link runActionGovernanceInventory} is what does that, and it passes
 *    this list through the router's registry rung before reporting a word of
 *    it. A caller that skips that step is asserting a dispatch outcome from
 *    two of the router's three sources.
 *  - `unboundDeclarations` — a declared `script` action with no `body` and no
 *    handler under any candidate key: a button wired to nothing. [#15444] The
 *    declarative `operation: 'update'` action is excluded: it is bound to
 *    nothing by construction and correct, because the platform action route
 *    performs its write. `operation` is read before `type` here for the same
 *    reason the runtime doors read it first.
 */
export function reconcileActionRegistrations(
    registered: Array<{ objectName: string; actionName: string; package?: string }>,
    declarations: Array<ActionDeclarationRow>,
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
    for (const { action, objectName, storeKey } of declarations) {
        for (const key of resolveActionHandlerKeys(action, storeKey)) addKey(objectName, key);
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
    for (const { action, objectName, storeKey } of declarations) {
        // [#15444] `operation` before `type` — the precedence the runtime doors
        // read (`isDeclarativeUpdateAction`, #15079; ruling #14092). The
        // declarative single-record field write carries NO handler BY
        // CONSTRUCTION: `ActionSchema` refuses `target` and `body` beside
        // `operation: 'update'`, because the platform action route is where the
        // write is performed. So it is the one declared `script` action that is
        // bound to nothing and entirely correct, and the `type`-keyed test below
        // would give the right answer to the wrong question — naming it in the
        // ADR-0110 D5 surface an operator reads to find REAL dead buttons, with
        // a prescription ("add a `body`, or register a handler under the
        // declared `target`") that parse REFUSES. A false population that grows
        // with every declarative update action an app author writes is how a
        // diagnostic stops being read.
        //
        // A bare equality on the declared key, with no `type` clause, is the
        // ruled spelling: an action carrying `operation: 'update'` IS the
        // declarative write, whatever `type` says. Data at rest that never went
        // through `ActionSchema` (a Studio row, a `strict: false` bundle) is
        // exactly the population where the two keys can contradict.
        if (action?.operation === 'update') continue;
        if ((action?.type ?? 'script') !== 'script') continue; // only script needs a handler
        if (action?.body) continue;                            // its handler is synthesized
        // A row with neither an own `name` nor a store key cannot be addressed
        // by anything and cannot be NAMED in a finding either — the old
        // spelling reported it as `actionName: undefined`, which reads as a
        // parse failure in the warning. `collectEngineActionDeclarations`
        // already refuses to admit one; this is the same refusal for a caller
        // that assembles rows itself.
        const identity = declarationIdentity(action, storeKey);
        if (!identity) continue;
        const bound = resolveActionHandlerKeys(action, storeKey).some((key) =>
            actionHandlerObjectKeys(objectName).some((obj) => registeredKeys.has(`${obj}:${key}`)));
        if (!bound) unboundDeclarations.push({ objectName, actionName: identity });
    }

    return { undeclaredHandlers, unboundDeclarations };
}

/**
 * One declaration the engine can dispatch against.
 *
 * ## [#14423] `storeKey` — the identity a body is not required to carry
 *
 * `action` is the declaration BODY, exactly as its source hands it over.
 * `storeKey` is the key the metadata plane holds that body under, present
 * only for rows that came from a keyed plural read
 * (`MetadataManager.loadManyKeyed`), and it is carried BESIDE the body rather
 * than folded into it — the #14205 rule, for the same reason: a body that
 * deliberately has no `name` must stay byte-identical to what was stored.
 *
 * It is optional because the object-embedded source has no store at all: an
 * `actions[]` entry inside an object definition is identified by its own
 * `name` and nothing else holds it.
 *
 * Every read of the identity goes through {@link declarationIdentity} or
 * through `resolveActionHandlerKeys(action, storeKey)`, so the precedence
 * (`action.name` first, the store key second) is stated once.
 */
export interface ActionDeclarationRow {
    action: any;
    objectName: string;
    /** The metadata plane's key for `action`, when it came from a keyed read. */
    storeKey?: string;
}

/**
 * A declaration's identity: its own `name` when the body carries one, else the
 * key its store holds it under.
 *
 * The order is the router's. `resolveRouteActionDeclaration` resolves a
 * declaration BY the name in the route and then derives handler keys from what
 * came back, so a body with no `name` is addressed under the key it was
 * resolved by — which is the store key, and is exactly what
 * `resolveActionHandlerKeys(action, storeKey)` produces via its `fallbackKey`.
 */
function declarationIdentity(action: any, storeKey?: string): string | undefined {
    if (typeof action?.name === 'string' && action.name.length > 0) return action.name;
    return storeKey;
}

/** Minimal logger surface the inventory needs — matches PluginContext.logger. */
export interface GovernanceLogger {
    warn(message: string, meta?: Record<string, unknown>): void;
    debug?(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Collect every action declaration this engine can dispatch against, as
 * {@link ActionDeclarationRow}s: each registry object's embedded `actions[]`
 * (the same schemas `getSchema` serves to the router), then standalone
 * `action` items from the metadata service — deduped by `<object>:<name>`
 * with the object-embedded copy winning, mirroring the execution layer's
 * artifact-wins rule.
 *
 * ## [#14423] Two spellings for the metadata source, and why the keyed one wins
 *
 * `loadStandaloneActionsKeyed` reads the plane under the identity the STORE
 * holds each row by (`MetadataManager.loadManyKeyed`); `loadStandaloneActions`
 * is the older unkeyed read (`loadMany`), which returns bodies and leaves
 * every consumer to guess the identity from `body.name`.
 *
 * That guess is the defect this card closes. A body is not required to name
 * itself — `register(type, name, data)` takes the key as its ARGUMENT — so the
 * `typeof action.name === 'string'` gate below DROPPED every nameless row,
 * while the router, which resolves by name through `loadDiagnosed`, served the
 * very same row. Measured on both shipped loaders: a `sys_metadata` row keyed
 * by its `name` COLUMN, and a `FilesystemLoader` file whose identity is its
 * path. The audit then reported a live, dispatchable handler as "registered
 * handler with NO declaration".
 *
 * So when the keyed source is present it REPLACES the unkeyed one — they read
 * the same population, and reading both would only re-admit the guess. The
 * unkeyed parameter stays for callers that have no keyed read to offer; it is
 * the pre-#14423 behaviour verbatim, nameless rows dropped and all.
 */
export async function collectEngineActionDeclarations(
    objects: any[],
    loadStandaloneActions: (() => Promise<any[]>) | undefined,
    loadStandaloneActionsKeyed?: (() => Promise<Array<{ name: string; data: any }>>) | undefined,
): Promise<Array<ActionDeclarationRow>> {
    const out: Array<ActionDeclarationRow> = [];
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

    const admit = (action: any, storeKey?: string): void => {
        const identity = declarationIdentity(action, storeKey);
        if (!action || !identity) return;
        const objectName = standaloneActionOwnerKey(action);
        const key = `${objectName}:${identity}`;
        if (seen.has(key)) return; // object-embedded declaration wins
        seen.add(key);
        out.push({ action, objectName, storeKey });
    };

    if (loadStandaloneActionsKeyed) {
        let keyed: Array<{ name: string; data: any }> = [];
        try {
            keyed = (await loadStandaloneActionsKeyed()) ?? [];
        } catch {
            keyed = []; // the plane could not be enumerated on this kernel
        }
        for (const entry of keyed) {
            if (!entry || typeof entry.name !== 'string' || entry.name === '') continue;
            admit(entry.data, entry.name);
        }
        return out;
    }

    let standalone: any[] = [];
    try {
        standalone = (await loadStandaloneActions?.()) ?? [];
    } catch {
        standalone = []; // no standalone-item source on this kernel
    }
    for (const action of standalone) {
        if (!action || typeof action.name !== 'string') continue;
        admit(action);
    }
    return out;
}

/**
 * The router's BY-NAME rungs, applied to the handlers the declaration set did
 * not cover — `registry.getItem('action', <key>)` (rung 2) and, since #14423,
 * `meta.loadDiagnosed('action', <key>)` / `meta.load(…)` (rung 3) — each
 * accepted on the router's own ownership test.
 *
 * ## Why by-NAME probes and not more enumeration
 *
 * The router never enumerates either source: it asks for ONE name. Mirroring
 * it means asking for one name. And enumeration is not a substitute here even
 * where it exists — a plural read and a by-name read of the same plane can
 * disagree, which is the whole subject of #14423: one loader fault is
 * swallowed by the plural read and served by the by-name read, so a handler
 * whose declaration lives on the faulted loader reads "undeclared" from the
 * enumeration alone. The keyed enumeration closes the IDENTITY half of that
 * (a nameless row is now nameable); this probe closes the AVAILABILITY half.
 * Both halves of the D5 bijection therefore mirror the router: the
 * declaration half enumerates keyed, the handler half asks by name.
 *
 * A handler registered under key `K` on object `O` is dispatchable at
 * `/actions/O/K` precisely when the router resolves a declaration for the
 * name `K` that owns `O` (its `fallbackKey` then addresses `K` back). So this
 * probe is not an approximation of dispatch — for the direct route it is the
 * same question, asked of the same sources.
 *
 * Conservative in exactly one direction, on purpose: a lookup that throws, or
 * answers something that is not an object, leaves the handler ON the list —
 * and one probe's failure never suppresses the next probe's answer. The audit
 * can therefore over-report a broken source; it cannot clear a handler on the
 * strength of an answer it could not read.
 *
 * ## Cost
 *
 * Bounded by the handlers still unaccounted for after set reconciliation, not
 * by the registry or the plane: on a healthy composition that list is empty
 * and no probe runs at all. Each surviving handler costs one lookup per
 * source — on `DatabaseLoader` that is one `findOne` each, the N+1 the census
 * measured, over N = the accusation list rather than N = the population.
 */
async function dropHandlersDeclaredByName(
    handlers: Array<{ objectName: string; actionName: string; package?: string }>,
    lookups: Array<((actionName: string) => unknown) | undefined>,
): Promise<Array<{ objectName: string; actionName: string; package?: string }>> {
    const probes = lookups.filter((l): l is (actionName: string) => unknown => typeof l === 'function');
    if (probes.length === 0 || handlers.length === 0) return handlers;
    const kept: Array<{ objectName: string; actionName: string; package?: string }> = [];
    for (const handler of handlers) {
        let declared = false;
        for (const probe of probes) {
            let item: unknown;
            try {
                item = await probe(handler.actionName);
            } catch {
                continue; // this source could not answer — see above
            }
            if (item && typeof item === 'object' && standaloneActionOwnsRoute(item, handler.objectName)) {
                declared = true;
                break;
            }
        }
        if (!declared) kept.push(handler);
    }
    return kept;
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
 *
 * ## [#14423] Both halves of the bijection read what the router reads
 *
 * The two findings used to stand on different sources, which is how the audit
 * could contradict the router about whether a declaration exists:
 *
 *  - `undeclaredHandlers` now passes through EVERY by-name rung the router
 *    resolves through — the engine registry, then the metadata plane — before
 *    a word of it is reported;
 *  - `unboundDeclarations` now reads the metadata plane KEYED, under the
 *    identity the store holds each row by (#14205), so a row whose body
 *    carries no `name` is a declaration here exactly as it is to the router.
 *
 * ## ⚠️ The boundary this audit does NOT cross, stated so nobody re-discovers it
 *
 * This runs at boot, OUTSIDE any request scope, so it reads the metadata
 * service its host can hand it — `ctx.getService('metadata')`. If a
 * composition ever registers `metadata` with a SCOPED lifecycle, that
 * accessor cannot reach the per-scope instance at all (it throws before any
 * read method runs), the audit falls back to the sources it does have, and it
 * may then report a handler the router serves from a scoped plane. That is a
 * BOUNDARY of a boot-time audit, not a defect in these reads, and it is not
 * reachable today: no shipped composition registers `metadata` as SCOPED
 * (`packages/metadata/src/plugin.ts` registers a static instance). Making a
 * boot-time audit reach a request-scoped service is a separate product
 * change, tracked on its own card — ⛔ do not "fix" it by loosening what the
 * reads below claim.
 */
export async function runActionGovernanceInventory(args: {
    registered: Array<{ objectName: string; actionName: string; package?: string }>;
    objects: any[];
    /**
     * The metadata plane's `action` rows, UNKEYED (`meta.loadMany('action')`).
     * Superseded by {@link loadStandaloneActionsKeyed} and ignored when that
     * is present — see {@link collectEngineActionDeclarations}.
     */
    loadStandaloneActions?: () => Promise<any[]>;
    /**
     * [#14423] The metadata plane's `action` rows KEYED by the store's own key
     * (`meta.loadManyKeyed('action')`). This is the source the declaration
     * half of the bijection is defined on, so that the audit and the router
     * share ONE identity — the store key (#14205) — instead of the audit
     * keying by `body.name` and dropping every row that has none.
     */
    loadStandaloneActionsKeyed?: () => Promise<Array<{ name: string; data: any }>>;
    /**
     * The router's rung 2, injected: `registry.getItem('action', name)` from
     * the caller that holds the engine. Omitting it is not a neutral default
     * — the inventory then reads two of the three sources the router reads,
     * which is the state that reported a live object-less action as refused
     * at dispatch. Callers with an engine in hand pass it.
     */
    lookupRegistryAction?: (actionName: string) => unknown;
    /**
     * [#14423] The router's rung 3, injected the same way:
     * `meta.loadDiagnosed('action', name)?.data`, falling back to
     * `meta.load('action', name)` — the caller unwraps, so this returns the
     * declaration or nothing, exactly like {@link lookupRegistryAction}.
     *
     * Omitting it is not neutral either: the handler half then rests on the
     * plural read alone, and a loader fault the plural read swallows makes a
     * handler the router dispatches read as undeclared.
     */
    lookupMetadataAction?: (actionName: string) => unknown;
    logger: GovernanceLogger;
    /** Fingerprint returned by the previous run — identical findings are not re-logged. */
    lastFingerprint?: string;
}): Promise<string> {
    try {
        const declarations = await collectEngineActionDeclarations(
            args.objects, args.loadStandaloneActions, args.loadStandaloneActionsKeyed);
        const reconciled = reconcileActionRegistrations(args.registered, declarations);
        const findings = {
            ...reconciled,
            undeclaredHandlers: await dropHandlersDeclaredByName(
                reconciled.undeclaredHandlers, [args.lookupRegistryAction, args.lookupMetadataAction]),
        };
        const fp = fingerprint(findings);
        if (fp === (args.lastFingerprint ?? '')) return fp;
        if (findings.undeclaredHandlers.length > 0) {
            args.logger.warn(
                '[action-governance] registered handlers with NO declaration in any source the ' +
                'router resolves through (object-embedded `actions[]`, the engine registry ' +
                'standalone `action` items, the metadata service `action` rows). ADR-0110 D3 ' +
                'refuses a handler whose declaration the router cannot resolve, so each of these ' +
                'is expected to answer 404 — expected, not measured: this audit read the sources, ' +
                'it did not dispatch. Declare each one with `defineAction`; if you believe it IS ' +
                'declared, then its declaration is not reaching this engine, and that is the bug ' +
                'to report rather than dropping a registration that may still be serving traffic',
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
