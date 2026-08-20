// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { AutomationContext } from '@objectstack/spec/contracts';
import type { HookContext } from '@objectstack/spec/data';

/**
 * Structural mirror of the automation engine's `FlowTriggerBinding`
 * (service-automation/src/engine.ts). Declared locally so this trigger plugin
 * stays decoupled from the automation package — same pattern the connector /
 * messaging integrations use to avoid a hard build edge. The engine parses the
 * flow's start node and hands us one of these per activated flow.
 */
export interface FlowTriggerBinding {
    readonly flowName: string;
    readonly object?: string;
    readonly event?: string;
    readonly condition?: string | { dialect?: string; source?: string; ast?: unknown };
    readonly schedule?: unknown;
    readonly config?: Record<string, unknown>;
}

/**
 * Structural mirror of the engine's `FlowTrigger` extension point. The engine
 * calls {@link start} with a parsed binding + a callback that runs the flow,
 * and {@link stop} when the flow is unregistered/disabled.
 */
export interface FlowTrigger {
    readonly type: string;
    start(binding: FlowTriggerBinding, callback: (ctx: AutomationContext) => Promise<void>): void;
    stop(flowName: string): void;
}

/**
 * The slice of the ObjectQL data engine this trigger needs: subscribe to a
 * lifecycle hook, and (for teardown) drop all hooks owned by a packageId.
 * Typed structurally because `IDataEngine` (the public contract) doesn't model
 * the hook surface, but the concrete engine implements both.
 */
export interface RecordChangeDataEngine {
    registerHook(
        event: string,
        handler: (ctx: HookContext) => unknown | Promise<unknown>,
        options?: { object?: string | string[]; priority?: number; packageId?: string },
    ): void;
    unregisterHooksByPackage?(packageId: string): number;
    /**
     * Optional object-schema accessor (the ObjectQL engine's `getObject`,
     * `IObjectQLEngine.getObject` — confirmed WIRED on the concrete engine).
     * Three independent consumers:
     *
     *  1. {@link RecordChangeTrigger.start} probes existence to call out a
     *     flow whose `objectName` matches no registered object — a hook
     *     filtered to a name nobody writes never fires, with zero output at
     *     any layer (2026-07-17 third-party eval).
     *  2. {@link RecordChangeTrigger.buildContext} reads `.fields` off the
     *     result to make the seeded `record` / `previous` CEL roots TOTAL
     *     over the object's DECLARED fields (#4953 services half) — see
     *     {@link materializeDeclaredFields}.
     *  3. {@link RecordChangeTrigger.objectHasFormulaField} reads `.fields`
     *     off the result to SKIP {@link hydrateComputedFields}'s re-read for
     *     objects that declare no `formula` field — the only thing that
     *     re-read adds (#8482). This consumer used to gate on a separate
     *     `getObjectConfig` member the concrete engine never implemented, so
     *     the skip was unreachable in production; retired in favor of this
     *     already-wired accessor.
     *
     * Typed loosely (not `ServiceObject`) so this plugin keeps its zero
     * build-time dependency on objectql; a fixture that returns only what a
     * probe needs (e.g. `{ name }`) is still a valid implementation for
     * consumer (1) and simply contributes no fields to consumers (2)/(3).
     */
    getObject?(name: string): { fields?: Record<string, { type?: unknown } | undefined> } | undefined;
    /**
     * Optional record re-read (the ObjectQL engine's `findOne`). When present,
     * {@link RecordChangeTrigger} uses it to hydrate the seeded `record` with
     * the read-time computed fields the raw lifecycle-hook row never carries —
     * chiefly `formula` virtual fields, which are evaluated post-fetch on the
     * READ path, not stored on the row. Without this, a flow's start condition
     * and every `{record.<field>}` template that names a formula field resolve
     * empty (#3426). Signature mirrors `IDataEngine.findOne`; typed structurally
     * so this plugin keeps its zero build-time dependency on objectql.
     */
    findOne?(
        object: string,
        options: { where?: Record<string, unknown>; fields?: string[]; context?: unknown },
    ): Promise<Record<string, unknown> | null | undefined>;
}

/** Minimal logger surface (matches core's `ctx.logger`). */
export interface TriggerLogger {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    debug?(msg: string, ...args: unknown[]): void;
    /**
     * Execution failures log here when available (falling back to `warn`).
     * ERROR matters operationally: the CLI's boot-quiet window swallows
     * stdout (debug/info/warn) but stderr (error/fatal) always lands.
     */
    error?(msg: string, ...args: unknown[]): void;
}

/**
 * Make a record TOTAL over an object's DECLARED fields — a structural mirror
 * of `@objectstack/objectql`'s `materializeDeclaredFields`
 * (`packages/objectql/src/declared-fields.ts`), duplicated here for the same
 * reason {@link FlowTriggerBinding} / {@link FlowTrigger} above are: this
 * package stays free of a build-time dependency on objectql (`@objectstack/
 * objectql` is a devDependency only — tests wire the real engine, production
 * gets it structurally via {@link RecordChangeDataEngine}). SAME algorithm,
 * SAME contract as the canonical copy — this is not a second materialisation
 * pattern, it is the one #4953 (readonlyWhen, PR #6454) established, applied
 * at the one seam objectql itself cannot reach (a server package one hop
 * further out). See the canonical doc comment for the full rationale
 * (why `undefined` counts as absent, why scope is declared-fields-only, why
 * `has()` becomes uniformly true afterwards).
 *
 * Mutates `record` in place (matching the canonical copy's contract) and
 * returns it. Callers that must not mutate a shared object — this file's own
 * `ctx.previous`, observed by every OTHER binding sharing the same
 * HookContext — pass a shallow copy in.
 *
 * Exported (module-scope only — NOT re-exported from `index.ts`, so this
 * stays off the package's published API) so
 * `materialize-declared-fields-parity.test.ts` can run it head-to-head
 * against the canonical copy in `@objectstack/objectql`'s
 * `declared-fields.ts` and fail the moment the two disagree — a duplicated
 * algorithm with nothing checking it stays duplicated is exactly the
 * declared-vs-enforced gap this platform treats as a bug.
 */
export function materializeDeclaredFields(
    record: Record<string, unknown>,
    fields: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
    if (!fields || typeof fields !== 'object') return record;
    for (const name of Object.keys(fields)) {
        if (record[name] === undefined) record[name] = null;
    }
    return record;
}

const TRIGGER_PREFIX = 'com.objectstack.trigger.record-change';

/**
 * Map a flow start node's `triggerType` (e.g. `record-after-update`) to the
 * ObjectQL `HookEvent`(s) it binds. Returns a list because one token can bind
 * more than one lifecycle event:
 *
 * - Single ops (`create`/`insert`/`update`/`delete`) → one event, e.g.
 *   `record-after-update` → `['afterUpdate']`.
 * - `write` is the **create-OR-update union** (#3427) — the two mutations that
 *   persist field data (delete is deliberately excluded) — so
 *   `record-after-write` → `['afterInsert', 'afterUpdate']`. This is what lets a
 *   single flow react to "record created or updated" without duplicating the
 *   whole definition, mirroring Salesforce's "created or updated" record-trigger
 *   option and Rails' `after_save`.
 *
 * Returns `[]` for anything that isn't a
 * `record-(before|after)-(create|insert|update|delete|write)` token.
 */
export function triggerTypeToHookEvents(triggerType: string | undefined): string[] {
    if (!triggerType) return [];
    const m = /^record-(before|after)-(create|insert|update|delete|write)$/.exec(triggerType.trim());
    if (!m) return [];
    const phase = m[1]; // 'before' | 'after'
    const op = m[2]; // create|insert|update|delete|write
    if (op === 'write') return [`${phase}Insert`, `${phase}Update`]; // create OR update
    const verb = op === 'create' || op === 'insert' ? 'Insert' : op.charAt(0).toUpperCase() + op.slice(1);
    return [`${phase}${verb}`]; // e.g. 'afterUpdate', 'beforeDelete'
}

/**
 * Back-compat single-event mapper for a `triggerType` token. Returns the ONE
 * hook event a single-lifecycle token binds, or `null` for an unknown token OR a
 * multi-event token (`record-*-write` maps to two events — use
 * {@link triggerTypeToHookEvents}, which the trigger itself calls).
 */
export function triggerTypeToHookEvent(triggerType: string | undefined): string | null {
    const events = triggerTypeToHookEvents(triggerType);
    return events.length === 1 ? events[0] : null;
}

/**
 * RecordChangeTrigger
 *
 * Bridges the automation engine's {@link FlowTrigger} extension point to
 * ObjectQL lifecycle hooks. For each flow the engine activates, it subscribes
 * to the matching hook event (filtered to the flow's target object) and, when
 * the hook fires, builds an {@link AutomationContext} from the new/old record
 * and invokes the engine-supplied callback (which runs the flow — the engine
 * owns the start-node condition gate, so we don't re-evaluate it here).
 *
 * Each flow's hooks are registered under a per-flow packageId so {@link stop}
 * can tear exactly that flow's subscription down via
 * `unregisterHooksByPackage`, without touching other flows or audit hooks.
 */
export class RecordChangeTrigger implements FlowTrigger {
    readonly type = 'record_change';

    private readonly engine: RecordChangeDataEngine;
    private readonly logger: TriggerLogger;
    /** flowName → packageId used for its hook(s), so stop() can unregister it. */
    private readonly bound = new Map<string, string>();
    /**
     * Per-write re-read cache for computed-field hydration (#3426 follow-up).
     * The engine passes ONE HookContext reference to every binding's handler for
     * a single write, so keying on it lets N flows bound to the same written
     * record share a SINGLE re-read instead of issuing N. A WeakMap, so a context
     * GC'd after its write drops the entry automatically — no manual eviction,
     * no unbounded growth.
     */
    private readonly hydrationCache = new WeakMap<object, Map<string, Promise<Record<string, unknown> | undefined>>>();

    constructor(engine: RecordChangeDataEngine, logger: TriggerLogger) {
        this.engine = engine;
        this.logger = logger;
    }

    start(binding: FlowTriggerBinding, callback: (ctx: AutomationContext) => Promise<void>): void {
        // One token may bind more than one lifecycle event (`record-after-write`
        // → afterInsert + afterUpdate). Exactly one of a `write` flow's two hooks
        // fires per mutation (a write is an insert XOR an update), so this is not
        // a double-dispatch.
        const hookEvents = triggerTypeToHookEvents(binding.event);
        if (hookEvents.length === 0) {
            // Array-form triggerType (`['record-after-create', 'record-after-delete']`)
            // reaches here via the engine, which forwards the raw array in `config`
            // and a joined `event` string that maps to no hook. Multi-event arrays are
            // unsupported (#3457); give a targeted message steering to the supported
            // shapes rather than the generic unknown-token line (#3481).
            const rawTriggerType = (binding.config as { triggerType?: unknown } | undefined)?.triggerType;
            if (Array.isArray(rawTriggerType)) {
                this.logger.warn(
                    `[record-change] flow '${binding.flowName}' has an ARRAY trigger event ${JSON.stringify(rawTriggerType)} — ` +
                        `multi-event arrays are not supported, so the flow is NOT bound and will never fire. ` +
                        `For "created or updated" use a single 'record-after-write'; for any other combination author one flow per event (#3457).`,
                );
            } else {
                this.logger.warn(
                    `[record-change] flow '${binding.flowName}' has unsupported trigger event '${binding.event ?? '(none)'}' — not bound`,
                );
            }
            return;
        }

        // Idempotent: drop any prior subscription for this flow before re-binding
        // (covers disable→enable cycles and hot reload).
        this.stop(binding.flowName);

        // Silent-miss guard (2026-07-17 third-party eval): a hook filtered to an
        // object name nobody writes never fires — and nothing anywhere says so.
        // When the engine can be probed, call the mismatch out at bind time.
        // Still bind (the object may be registered later by a metadata reload);
        // this is a diagnosis, not a refusal.
        if (binding.object && typeof this.engine.getObject === 'function') {
            let known: unknown;
            try {
                known = this.engine.getObject(binding.object);
            } catch {
                known = undefined;
            }
            if (!known) {
                this.logger.warn(
                    `[record-change] flow '${binding.flowName}' targets unknown object '${binding.object}' — the trigger is bound but will never fire. ` +
                        `Object names match exactly; check the flow start node's config.objectName against the object's registered name.`,
                );
            }
        }

        const packageId = `${TRIGGER_PREFIX}:${binding.flowName}`;

        const handler = async (ctx: HookContext): Promise<void> => {
            try {
                // Seed/bulk suppression: writes made with `context.skipTriggers`
                // (notably package metadata SEED replay) must NOT fire
                // record-change automation — seed rows are pre-existing end-state
                // data, not user events. Firing "on create/update" flows for them
                // is semantically wrong and was the vector for the 2026-07-06
                // self-trigger loop that wedged first-boot. Lifecycle hooks still
                // ran (they are separate); only the flow dispatch is skipped here.
                if ((ctx.session as { skipTriggers?: boolean } | undefined)?.skipTriggers) {
                    return;
                }
                const automationCtx = await this.buildContext(binding, ctx);
                await callback(automationCtx);
            } catch (err) {
                // Error isolation: a flow failure must NEVER break the CRUD write
                // that triggered it. Log (loudly — ERROR reaches stderr, which
                // survives the CLI's boot-quiet stdout window) and swallow.
                const log = this.logger.error?.bind(this.logger) ?? this.logger.warn.bind(this.logger);
                log(
                    `[record-change] flow '${binding.flowName}' execution failed: ${(err as Error)?.message ?? String(err)}`,
                );
            }
        };

        // Bind every mapped hook event under the SAME packageId so stop()'s single
        // unregisterHooksByPackage tears all of them down together.
        for (const hookEvent of hookEvents) {
            this.engine.registerHook(hookEvent, handler, {
                object: binding.object,
                packageId,
            });
        }
        this.bound.set(binding.flowName, packageId);
        this.logger.info(
            `[record-change] bound flow '${binding.flowName}' → ${hookEvents.join(' + ')}${binding.object ? ` on '${binding.object}'` : ''}`,
        );
    }

    stop(flowName: string): void {
        const packageId = this.bound.get(flowName);
        if (!packageId) return;
        try {
            this.engine.unregisterHooksByPackage?.(packageId);
        } catch (err) {
            this.logger.warn(
                `[record-change] failed to unbind flow '${flowName}': ${(err as Error)?.message ?? String(err)}`,
            );
        }
        this.bound.delete(flowName);
        this.logger.debug?.(`[record-change] unbound flow '${flowName}'`);
    }

    /**
     * Build the flow execution context from an ObjectQL hook context. The new
     * record comes from `ctx.result` (after-hooks) or falls back to the
     * mutation input payload, layered over the prior row; the old record from
     * `ctx.previous`, which the engine binds ahead of every dispatch.
     *
     * Async because the seeded `record` is hydrated with read-time computed
     * fields (see {@link hydrateComputedFields}) via a data-engine re-read,
     * AND — since #4953 (services half) — made total over the object's
     * declared fields (see the `materializeDeclaredFields` call below).
     */
    private async buildContext(binding: FlowTriggerBinding, ctx: HookContext): Promise<AutomationContext> {
        // objectql lifecycle hooks carry the written row under `input.data` (insert /
        // update payload); `id` is on update. `data` is the ONLY spelling any engine
        // path produces — measured and pinned by objectql's
        // `hook-input-shape-contract.test.ts` ("insert carries `data` — never `doc`",
        // #5273). A `doc` alias limb used to sit below this read for a producer that
        // never existed; removed in #5671 rather than left as a second de-facto
        // contract (PD #12). before/afterDelete carry no payload at all and fall
        // through to `previous` below.
        const input = (ctx.input ?? {}) as { data?: Record<string, unknown>; id?: unknown };
        const after = ctx.result as Record<string, unknown> | undefined;
        // `ctx.previous` is the ONE key the pre-image arrives under, and the ENGINE
        // is its single producer: it binds `previous` before dispatching the hook on
        // every write shape — by-id update (`engine.ts:7010`, immediately ahead of
        // the `beforeUpdate` dispatch at `:7012`), by-id delete (`bindPreImage`,
        // `engine.ts:7869`, called at `:7897` ahead of the `beforeDelete` dispatch at
        // `:7899`), and each per-row context of a predicate write (`engine.ts:1746`
        // after-phase / `:1825` before-phase) — #5272 / #5574 / #5846.
        //
        // A `ctx.__previous` stash limb used to sit below this read, for the
        // side-channel `plugin-audit`'s `captureBefore` wrote. #6656 retired
        // `captureBefore`, which left the stash with ZERO producers, so the limb was
        // removed here (#6978) instead of being kept "for safety" — ADR-0049
        // enforce-or-remove, and PD #12: an undeclared side-channel key is exactly
        // the second de-facto contract a consumer-side `??` fossilizes. A future
        // producer of `__previous` is therefore ignored by design; the way to hand
        // this consumer a pre-image is to bind the declared `ctx.previous`.
        const previous = ctx.previous as Record<string, unknown> | undefined;
        const priorBase = previous && typeof previous === 'object' ? previous : undefined;

        const object = binding.object ?? ctx.object;

        const inputData = input.data && typeof input.data === 'object' ? input.data : undefined;
        // #4953 (services half) — the prior row is now the BASE layer, not just
        // the before-hook fallback: a field this write's payload/after-row
        // doesn't mention still needs its REAL persisted value (from `previous`)
        // rather than going missing, or #1871/#4649's `materializeDeclaredFields`
        // below would default it to `null` and FABRICATE a value that
        // contradicts the stored row (`declared-fields.ts`'s own warning) —
        // wrong for a field that simply was not touched by this write. `after`
        // (this write's own post-write echo) is trusted last / most, `previous`
        // least, matching `readonlyWhenBindings`' `{ ...previous, ...data }`
        // shape in `rule-validator.ts` (#6454).
        const record: Record<string, unknown> =
            after && typeof after === 'object'
                ? // #1872 — overlay the after-row on the input payload so fields the
                  // driver did not echo back (notably `multiple: true` lookups,
                  // stored as an array column) stay visible to the flow's start
                  // condition and `{record.<field>}` interpolation. The after-row
                  // wins for every field it DOES return (id, DB-computed values).
                  { ...(priorBase ?? {}), ...(inputData ?? {}), ...after }
                : { ...(priorBase ?? {}), ...(inputData ?? {}) };

        const session = (ctx.session ?? {}) as { userId?: string; organizationId?: string };

        // Hydrate read-time computed fields (formula virtuals) onto the seeded
        // record so the flow's start condition and every `{record.<field>}`
        // template resolve them — the raw hook row never carries them (#3426).
        // Runs BEFORE materialization below: hydration only fills keys `record`
        // LACKS (`{...full, ...record}`, record wins), so a field materialized
        // to `null` first would shadow the real value hydration's re-read could
        // have supplied.
        const hydrated = await this.hydrateComputedFields(object, ctx.event, record, ctx);

        // #4953 (services half) — make BOTH CEL roots (`record` AND `previous`)
        // TOTAL over the object's DECLARED fields, exactly as the server's other
        // materialised seams already are (`materializeDeclaredFields`,
        // `packages/objectql/src/declared-fields.ts`; `rule-validator.ts`
        // `readonlyWhenBindings`, PR #6454). Without this, `record.x != null` /
        // `previous.x != null` in a flow's start condition, edge condition, or a
        // `{record.x}` template fault with `No such key: x` whenever the driver
        // didn't echo `x` back — while `has(record.x)` silently answers `false`
        // for the exact same reason, which reads as "the field genuinely has no
        // value" when the truth is "this evaluation point never got told".
        //
        // Only once the record's persisted state is actually IN HAND — same
        // `groundTruth` gate `evaluateValidationRules` uses. On insert there is
        // nothing to know yet (absence genuinely means "no value"): every
        // insert-type event materializes unconditionally. On update/delete it is
        // knowable only once the prior row was fetched (`ctx.previous`, `#7867`
        // makes that unconditional for by-id writes) — defaulting a
        // still-missing field to `null` without that would not materialise an
        // absent value, it would FABRICATE one that contradicts the stored row,
        // so a write whose prior row genuinely could not be read is left as-is
        // and the rare unevaluable predicate fails closed (a fault), same policy
        // as the validation seam.
        const isInsertEvent = ctx.event === 'beforeInsert' || ctx.event === 'afterInsert';
        const groundTruth = isInsertEvent || priorBase !== undefined;
        const fields = groundTruth ? this.engine.getObject?.(object)?.fields : undefined;
        if (fields) materializeDeclaredFields(hydrated, fields);
        // COPIED before materialising, never mutated in place: `previous` here
        // is the engine's shared `ctx.previous` — the SAME HookContext reference
        // is handed to every OTHER flow binding on this write (see the class doc
        // on `hydrationCache`), so writing into it would leak materialised
        // `null`s into bindings that haven't run yet. Same rule
        // `readonlyWhenBindings` follows for the identical reason.
        const materializedPrevious =
            priorBase && fields ? materializeDeclaredFields({ ...priorBase }, fields) : previous;

        return {
            record: hydrated,
            previous: materializedPrevious,
            object,
            event: binding.event,
            userId: session.userId,
            // Forward the writer's identity so a `runAs:'user'` flow enforces RLS
            // exactly as the user who made the change (#1888). We forward the
            // `userId` (+ the active org as `tenantId`) ONLY: the ObjectQL hook
            // session does NOT carry the writer's positions / permission sets, so
            // the automation engine resolves the triggering user's FULL grants
            // from this `userId` at run setup (#3356). Forwarding a half-populated
            // `positions` here (empty in practice, and never `permissions`) was the
            // hollow-credential bug #3356 fixed — an incomplete, misleading
            // duplicate of what the engine now resolves authoritatively. The
            // engine elevates only for `runAs:'system'`. The hook session exposes
            // the active org as `organizationId` (the deprecated `session.tenantId`
            // alias was removed in v16, #3290); it feeds the automation context's
            // driver-layer `tenantId` field unchanged.
            ...(session.organizationId ? { tenantId: session.organizationId } : {}),
            // Expose the record as params too, so flows with named `isInput`
            // variables matching record fields get them seeded.
            params: hydrated,
        };
    }

    /**
     * Re-read the just-written record through the data engine so the seeded
     * `record` carries the SAME read-time computed fields the data API returns —
     * chiefly `formula` virtual fields, which lifecycle-hook rows never include
     * because they are evaluated on the READ path, not stored on the row
     * (#3426). Without this, `{record.full_name}` (a formula) in a notify
     * template, or a start condition referencing one, silently renders blank.
     *
     * Deliberately conservative:
     *  - Runs only for `afterInsert` / `afterUpdate`, where the row exists in
     *    its post-write state. `before*` rows are not yet persisted and
     *    `afterDelete` rows are gone; both keep the raw hook record untouched.
     *  - Reads as an elevated SYSTEM principal so it can only ADD computed
     *    fields, never let RLS/FLS on the re-read shrink the snapshot the flow
     *    was already going to see from the raw (unmasked) write-path row.
     *  - Raw hook fields WIN over the re-read on merge, preserving trigger-time
     *    scalar values and the #1872 multi-lookup input overlay; the re-read
     *    only fills in keys the raw row lacks (the formula virtuals).
     *  - Lookup TRAVERSAL (`{record.account.name}`) is intentionally NOT
     *    hydrated: a default data-API read does not expand relations either, and
     *    expanding would turn `record.account` from its scalar FK id into an
     *    object, breaking templates/conditions that use the bare id (e.g.
     *    #1872's `{record.target_channels.0}`). Tracked separately on #3426.
     *
     * Two guards keep the re-read off the hot path (#3426 follow-up):
     *  - Schema gate: skip entirely when the object declares no `formula` field —
     *    the only thing the re-read adds. Most objects have none. Uses the
     *    engine's `getObject` accessor (the same one {@link buildContext}'s
     *    materialization step uses, #8482); when unsure, re-reads (see
     *    {@link objectHasFormulaField}).
     *  - Per-write memoization: N flows bound to the same written record share
     *    one re-read, keyed on the shared HookContext (see {@link hydrationCache}
     *    and {@link readFullRecordOnce}).
     *
     * Any failure (no read surface, no id, a throw, an empty read) falls back to
     * the raw record — hydration must never break the flow it feeds.
     */
    private async hydrateComputedFields(
        object: string | undefined,
        hookEvent: string | undefined,
        record: Record<string, unknown>,
        hookCtx?: HookContext,
    ): Promise<Record<string, unknown>> {
        if (typeof this.engine.findOne !== 'function') return record;
        if (hookEvent !== 'afterInsert' && hookEvent !== 'afterUpdate') return record;
        if (!object) return record;
        const id = (record as { id?: unknown }).id;
        if (id == null || id === '') return record;

        // Schema gate: the re-read exists ONLY to add read-time `formula`
        // virtuals. When the object positively declares none it can add nothing
        // the raw hook row lacks, so skip the query. Most objects have no formula
        // field, so this removes the re-read from the common write path.
        if (!this.objectHasFormulaField(object)) return record;

        const full = await this.readFullRecordOnce(object, id, hookCtx);
        if (full) {
            // Raw hook fields win; the re-read only contributes keys the raw
            // row lacks (the formula virtuals + any other read-time field).
            return { ...full, ...record };
        }
        return record;
    }

    /**
     * True unless the engine can POSITIVELY confirm `object` declares no
     * read-time `formula` field — the only thing {@link hydrateComputedFields}'s
     * re-read adds. Uses the engine's synchronous optional `getObject` — the
     * SAME accessor {@link buildContext}'s materialization step already reads
     * (#8482; previously this gated on a separate `getObjectConfig` member the
     * concrete ObjectQL engine never implemented, so on the real engine this
     * always fell through to the `true` fallback below and the re-read ran
     * unconditionally on every afterInsert/afterUpdate dispatch). When
     * `getObject` is absent, returns nothing usable, or throws, returns `true`
     * so hydration still runs (correctness over the optimization). Not cached:
     * `getObject` is an in-memory lookup, and skipping a cache avoids a stale
     * answer if an object's schema is hot-registered with a formula field
     * after first use.
     */
    private objectHasFormulaField(object: string): boolean {
        const getObj = this.engine.getObject;
        if (typeof getObj !== 'function') return true;
        try {
            const cfg = getObj.call(this.engine, object);
            const fields = cfg?.fields;
            if (!fields || typeof fields !== 'object') return true;
            for (const f of Object.values(fields)) {
                if (f && typeof f === 'object' && (f as { type?: unknown }).type === 'formula') return true;
            }
            return false;
        } catch {
            return true;
        }
    }

    /**
     * Re-read the just-written record as an elevated system principal, memoized
     * per write. Keying the cache on the shared HookContext means N flow bindings
     * on the same written record issue ONE query, not N. Any failure resolves to
     * `undefined` (the caller falls back to the raw record) — hydration must
     * never break its flow. Without a HookContext key it reads directly.
     */
    private async readFullRecordOnce(
        object: string,
        id: unknown,
        hookCtx?: HookContext,
    ): Promise<Record<string, unknown> | undefined> {
        const run = async (): Promise<Record<string, unknown> | undefined> => {
            const findOne = this.engine.findOne;
            if (typeof findOne !== 'function') return undefined;
            try {
                const full = await findOne.call(this.engine, object, {
                    where: { id },
                    // Elevated read: adds computed fields without RLS/FLS masking
                    // the ones the raw row already carried.
                    context: { isSystem: true, positions: [], permissions: [] },
                });
                return full && typeof full === 'object' ? (full as Record<string, unknown>) : undefined;
            } catch (err) {
                this.logger.debug?.(
                    `[record-change] computed-field hydration skipped for '${object}': ${(err as Error)?.message ?? String(err)}`,
                );
                return undefined;
            }
        };

        if (!hookCtx) return run();
        const ctxKey = hookCtx as unknown as object;
        let perWrite = this.hydrationCache.get(ctxKey);
        if (!perWrite) {
            perWrite = new Map();
            this.hydrationCache.set(ctxKey, perWrite);
        }
        const cacheKey = `${object}:${String(id)}`;
        const existing = perWrite.get(cacheKey);
        if (existing) return existing;
        const pending = run();
        perWrite.set(cacheKey, pending);
        return pending;
    }
}
