/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Action Engine
 * 
 * Declarative action engine. Manages action registration, location-based
 * filtering, keyboard shortcuts, and bulk operation support.
 * 
 * Replaces callback-based patterns with a schema-driven pipeline:
 *   ActionSchema[] → ActionEngine → ActionRunner → ActionResult
 */

import { ActionRunner, type ActionDef, type ActionContext, type ActionResult } from './ActionRunner.js';
import { toPredicateInput } from '../evaluator/predicateInput.js';
import { hasDeclaredPredicate } from '../evaluator/declaredPredicate.js';

/**
 * Action location types — re-exported from `@objectstack/spec/ui` so the
 * platform has one source of truth (`ACTION_LOCATIONS`). Do NOT redeclare
 * this enum locally; add new values in
 * `framework/packages/spec/src/ui/action.zod.ts` and they propagate here
 * automatically.
 */
export type { ActionLocation } from '@object-ui/types';
export { ACTION_LOCATIONS } from '@object-ui/types';
import type { ActionLocation } from '@object-ui/types';

/** Registered action with metadata */
export interface RegisteredAction {
  action: ActionDef;
  locations: ActionLocation[];
  /** Keyboard shortcut (e.g., 'ctrl+s', 'meta+k') */
  shortcut?: string;
  /** Whether this action supports bulk operations */
  bulkEnabled?: boolean;
  /** Priority for ordering (lower = first) */
  priority?: number;
}

/** Keyboard shortcut handler */
export interface ShortcutBinding {
  /** Key combination (e.g., 'ctrl+s', 'meta+k', 'shift+n') */
  keys: string;
  /** Action name to trigger */
  actionName: string;
}

/** Normalize a shortcut string for comparison (lowercase, trimmed, sorted parts) */
function normalizeShortcut(keys: string): string {
  return keys.toLowerCase().split('+').map(k => k.trim()).sort().join('+');
}

/** De-dupe key set so a broken predicate warns once, not every re-render. */
const _warnedPredicates = new Set<string>();

/**
 * Surface an action whose `visible` predicate threw (and was therefore
 * fail-closed hidden). Almost always an authoring bug — typically a bare field
 * reference that should be `record.<field>`. Warned once per predicate.
 */
function warnHiddenPredicate(name: unknown, raw: unknown, err: unknown): void {
  const src = typeof raw === 'string'
    ? raw
    : (raw && typeof raw === 'object' && typeof (raw as any).source === 'string' ? (raw as any).source : String(raw));
  const key = `${String(name)}::${src}`;
  if (_warnedPredicates.has(key)) return;
  _warnedPredicates.add(key);
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(
    `[ActionEngine] action "${String(name)}" hidden: its \`visible\` predicate threw — ${msg}. ` +
    `Predicate: ${src}. Action predicates evaluate against { record, recordId, objectName, user, os.user, … }; ` +
    `use \`record.<field>\` (not a bare field).`,
  );
}

/**
 * Registration + filtering + execution for declared actions.
 *
 * Entry points are by NAME (`executeAction`), by LOCATION
 * (`getActionsForLocation`), by SHORTCUT (`handleShortcut`) and in BULK
 * (`executeBulk`). There is deliberately no entry point by arbitrary EVENT
 * name: this class used to carry a second, parallel one — `addMapping()`
 * registered `{ event, actionName, condition }` triples into a private
 * `mappings` array and `dispatch(event)` ran every triple matching an event
 * string. It was retired under enforce-or-remove (objectui#3368) because it
 * was a public export of `@object-ui/core` with zero production callers: in
 * its whole lifetime nothing ever registered a mapping, so `dispatch()` had
 * no reachable caller either, and its four call sites were all in this
 * class's own test file.
 *
 * Its condition gate had drifted three ways from the `visible` contract
 * `getActionsForLocation` below implements — it entered on a raw truthy check
 * (so `condition: false` dispatched anyway), typed `condition` as `string`
 * only (so a `{ dialect: 'cel', source }` envelope could not reach the
 * canonical engine), and evaluated without `throwOnError` (so a throwing
 * predicate failed OPEN, the opposite of `visible`'s fail-closed posture).
 * All three were retired WITH the path rather than fixed on it: aligning the
 * contract of an API nobody calls only widens behaviour nobody uses. If an
 * event-keyed entry point is ever genuinely needed, it must be built on the
 * shared predicate definitions (`hasDeclaredPredicate` + `toPredicateInput`)
 * that the surviving gate below already uses, not on a fourth spelling.
 */
export class ActionEngine {
  private actions = new Map<string, RegisteredAction>();
  private shortcuts: ShortcutBinding[] = [];
  private normalizedShortcutMap = new Map<string, string>();
  private runner: ActionRunner;

  /**
   * @param contextOrRunner Either an initial `ActionContext` (constructs a
   *  new local `ActionRunner`) or an existing `ActionRunner` to share.
   *  Sharing is how nested consumers (e.g. `record:quick_actions` inside
   *  an `<ActionProvider>`) inherit the provider's confirm/param/modal/
   *  toast/navigate handlers without redeclaring them — without this,
   *  any action declaring `params: [...]` or `confirmText` would silently
   *  no-op in the nested engine.
   */
  constructor(contextOrRunner: ActionContext | ActionRunner = {}) {
    this.runner =
      contextOrRunner instanceof ActionRunner
        ? contextOrRunner
        : new ActionRunner(contextOrRunner);
  }

  /** Get the underlying ActionRunner for handler configuration */
  getRunner(): ActionRunner {
    return this.runner;
  }

  /** Register a single action */
  registerAction(action: ActionDef, options?: {
    locations?: ActionLocation[];
    shortcut?: string;
    bulkEnabled?: boolean;
    priority?: number;
  }): void {
    const name = action.name || action.type || '';
    if (!name) throw new Error('Action must have a name or type');
    
    this.actions.set(name, {
      action,
      locations: options?.locations || [],
      shortcut: options?.shortcut,
      bulkEnabled: options?.bulkEnabled ?? false,
      priority: options?.priority ?? 100,
    });

    // Auto-register keyboard shortcut
    if (options?.shortcut) {
      this.shortcuts.push({ keys: options.shortcut, actionName: name });
      this.normalizedShortcutMap.set(normalizeShortcut(options.shortcut), name);
    }
  }

  /**
   * Register multiple actions from an ActionSchema array.
   *
   * Only `locations` is harvested from the metadata. `shortcut` and
   * `bulkEnabled` used to be read here too, but spec 17 retired both as
   * `retiredKey()` tombstones — a declaration carrying either one no longer
   * parses, so harvesting them read a key that cannot exist and made two dead
   * options look load-bearing. Both remain accepted on the single-action
   * `registerAction(action, options)` overload, where a HOST passes them
   * explicitly; they are simply no longer sourced from authored metadata.
   */
  registerActions(actions: ActionDef[]): void {
    for (const action of actions) {
      this.registerAction(action, {
        // No cast: `locations` is a declared `ActionDef` field as of
        // objectstack#4075 step 2. The `as any` it replaces existed only
        // because the key reached this reader through the index signature.
        locations: action.locations,
      });
    }
  }

  /** Unregister an action by name */
  unregisterAction(name: string): void {
    const registered = this.actions.get(name);
    if (registered?.shortcut) {
      this.normalizedShortcutMap.delete(normalizeShortcut(registered.shortcut));
    }
    this.actions.delete(name);
    this.shortcuts = this.shortcuts.filter(s => s.actionName !== name);
  }

  /**
   * Get actions available at a specific location, sorted by priority.
   *
   * Filtering applied (in order):
   *   1. `locations.includes(location)` — location/region match
   *   2. `action.visible` — evaluated against the runner's current context
   *      ({ record, recordId, objectName, user, … }) whenever a gate is
   *      DECLARED, which is asked through core's one definition
   *      `hasDeclaredPredicate` (objectui#3850's ruling, adopted here by
   *      objectui#3957). No gate — absent, `''`, blank predicate text in either
   *      spelling, or an envelope whose `source` is `''` — means visible. A
   *      value that is present but has no evaluable `source` (`0`, `{}`, an
   *      array, an `ast`-only envelope) is a declared gate that faults
   *      (objectui#11358), so it hides like any other. Evaluator errors hide the
   *      action (fail-closed) rather than throwing — this matches the contract
   *      used by every individual action renderer (`action-button`,
   *      `action-menu`, `action-bar`, …) so the same action behaves identically
   *      whether surfaced via the engine or consumed standalone, which is now
   *      true of the gate in front of the verdict as well as the verdict
   *      (objectui#3314: one value, one answer, whichever entry reads it).
   *
   *   Predicate normalization goes through the shared `toPredicateInput`
   *   (`@object-ui/core`'s canonical helper — semantically identical to
   *   `@object-ui/react`'s renderer-side twin, pinned by a parity test):
   *   raw strings (`'record.foo == true'`) are wrapped as `${...}` so they
   *   evaluate as expressions, not as truthy string literals, and a spec-style
   *   `{ dialect: 'cel', source }` envelope is passed through INTACT so
   *   `evaluateCondition` routes it to the canonical `@objectstack/formula`
   *   engine (#2661). Unwrapping the envelope here — as this method used to —
   *   dropped the dialect and silently demoted every CEL predicate to the
   *   legacy JS evaluator, so the same `visible:` reached a different verdict
   *   via the engine than via a renderer (#3314): CEL faults on `null < null`
   *   and fail-closed hides, JS quietly returns `false`.
   */
  getActionsForLocation(location: ActionLocation): ActionDef[] {
    const evaluator = this.runner.getEvaluator();
    return Array.from(this.actions.values())
      .filter(ra => ra.locations.includes(location))
      .filter(ra => {
        // [ADR-0066 D4] Capability gate (UI half — the server enforces the
        // source of truth). Hide an action whose `requiredPermissions` are not
        // ALL held by the caller's `systemPermissions`. Fail-OPEN when
        // systemPermissions is unknown (undefined): the server still 403s, and
        // hiding on missing data is a worse regression than showing a button
        // that errors clearly. Mirrors the App/nav requiredPermissions gate.
        const required = ra.action.requiredPermissions;
        if (!Array.isArray(required) || required.length === 0) return true;
        const held = (this.runner.getContext() as any)?.user?.systemPermissions as string[] | undefined;
        if (!Array.isArray(held)) return true;
        return required.every((p) => held.includes(p));
      })
      .filter(ra => {
        const raw = ra.action.visible;
        // Ask "is a `visible` gate DECLARED?" through the repo's ONE definition
        // (`evaluator/declaredPredicate.ts`, objectui#3850's ruling), which is
        // what the renderers, `SchemaRenderer` and `ActionRunner`'s execution
        // gates ask. This filter used to answer it with a range of its own —
        // three empty spellings folded by hand (`null` / `''` / an envelope with
        // an empty `source`) and everything else coerced with `Boolean(raw)` —
        // and it was the LAST consumer to do so, so the same value got two
        // answers depending on which entry read it: `visible: 0` / `NaN` hid the
        // action here and showed it on the renderer face, and `visible: '   '`
        // hid it here because the normalizer wraps a blank string into `'${   }'`
        // whose verdict is falsy. That is the shape objectui#3314's invariant
        // forbids, and it is fixed by deleting a range, not by adding one
        // (objectui#3957). A predicate that says nothing (blank) must not be
        // the reason an action is hidden from everyone. A value that is not a
        // predicate at all is no longer "nothing" (objectui#11358): it is a
        // declared gate the client cannot evaluate, the normalizer keeps it
        // as such, and the `throwOnError` evaluation below hides it and
        // reports it, as every action renderer's `visible` leg does.
        //
        // Booleans need no branch of their own: they are DECLARED (`visible:
        // false` is a verdict, objectui#3812) and `evaluateCondition`
        // short-circuits them.
        if (!hasDeclaredPredicate(raw)) return true;
        // #3314 — one shared normalization, not two. Hand-rolling the envelope
        // unwrap here is what dropped `dialect: 'cel'` and demoted the
        // predicate to the legacy JS engine; `toPredicateInput` keeps the
        // envelope so `evaluateCondition` can route it to `@objectstack/formula`
        // (the engine the server enforces with), exactly as the renderers do.
        // Declared ⇒ the normalizer left something (possibly the declared-but-
        // unevaluable `cel` envelope, which throws below), so there is no
        // `undefined` case left to handle here.
        const expr = toPredicateInput(raw);
        try {
          // `throwOnError: true` is required for fail-closed semantics: the
          // evaluator's default behavior swallows expression errors and
          // returns the raw template string, which `Boolean(string)` then
          // coerces to `true` — silently leaking actions whose preconditions
          // failed (e.g. `ctx` undefined). Surface the error so our catch
          // below can hide the action. It is equally load-bearing on the CEL
          // path, where the canonical helper fails SOFT to visible/enabled
          // unless the caller opts in.
          return evaluator.evaluateCondition(expr, { throwOnError: true });
        } catch (err) {
          // Fail-closed: hide the action. But a *thrown* predicate is almost
          // always an authoring bug, not a real precondition — most often a
          // BARE field reference (`done` instead of `record.done`), which is
          // an undeclared variable in the `{ record, recordId, objectName,
          // user }` eval scope. Silently hiding it makes that bug invisible
          // (the objectstack-ai/objectstack#2183 hunt). Warn once per predicate so it is diagnosable
          // without spamming re-renders.
          warnHiddenPredicate(ra.action.name, raw, err);
          return false;
        }
      })
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
      .map(ra => ra.action);
  }

  /** Get actions that support bulk operations */
  getBulkActions(): ActionDef[] {
    return Array.from(this.actions.values())
      .filter(ra => ra.bulkEnabled)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
      .map(ra => ra.action);
  }

  /** Get all registered keyboard shortcuts */
  getShortcuts(): ShortcutBinding[] {
    return [...this.shortcuts];
  }

  /** Get a registered action by name */
  getAction(name: string): ActionDef | undefined {
    return this.actions.get(name)?.action;
  }

  /** Execute an action by name */
  async executeAction(name: string, contextOverride?: Partial<ActionContext>): Promise<ActionResult> {
    const registered = this.actions.get(name);
    if (!registered) {
      return { success: false, error: `Action not found: ${name}` };
    }

    if (contextOverride) {
      this.runner.updateContext(contextOverride);
    }

    return this.runner.execute(registered.action);
  }

  /** Handle a keyboard shortcut event — returns true if handled */
  async handleShortcut(keys: string, contextOverride?: Partial<ActionContext>): Promise<ActionResult | null> {
    const actionName = this.normalizedShortcutMap.get(normalizeShortcut(keys));
    if (!actionName) return null;
    
    return this.executeAction(actionName, contextOverride);
  }

  /** Execute a bulk operation on multiple records */
  async executeBulk(
    actionName: string,
    records: Record<string, any>[],
    options?: { parallel?: boolean; continueOnError?: boolean }
  ): Promise<{ total: number; succeeded: number; failed: number; results: ActionResult[] }> {
    const registered = this.actions.get(actionName);
    if (!registered) {
      return { total: 0, succeeded: 0, failed: 0, results: [{ success: false, error: `Action not found: ${actionName}` }] };
    }
    if (!registered.bulkEnabled) {
      return { total: 0, succeeded: 0, failed: 0, results: [{ success: false, error: `Action ${actionName} does not support bulk operations` }] };
    }

    const results: ActionResult[] = [];
    let succeeded = 0;
    let failed = 0;

    if (options?.parallel) {
      const promises = records.map(record => {
        this.runner.updateContext({ record, selectedRecords: records });
        return this.runner.execute(registered.action);
      });
      const settled = await Promise.allSettled(promises);
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          results.push(r.value);
          if (r.value.success) succeeded++;
          else failed++;
        } else {
          results.push({ success: false, error: r.reason?.message || 'Unknown error' });
          failed++;
        }
      }
    } else {
      for (const record of records) {
        this.runner.updateContext({ record, selectedRecords: records });
        const result = await this.runner.execute(registered.action);
        results.push(result);
        if (result.success) succeeded++;
        else {
          failed++;
          if (!options?.continueOnError) break;
        }
      }
    }

    return { total: records.length, succeeded, failed, results };
  }

  /** Update the action context */
  updateContext(context: Partial<ActionContext>): void {
    this.runner.updateContext(context);
  }

  /** Clear all registered actions and shortcuts */
  clear(): void {
    this.actions.clear();
    this.shortcuts = [];
    this.normalizedShortcutMap.clear();
  }
}
