// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25653, the #25251 principle for the whole family] The provenance mark an
 * app-authored automation's system elevation carries.
 *
 * ## Why a mark
 *
 * App-authored automation elevates by declaration: a flow by `runAs: 'system'`,
 * a hook by `runAs: 'system'`, and an action body always (it is trusted code,
 * #2849 / #3914). Each derives `{ ...caller's context, isSystem: true }`, and so
 * does platform code — the better-auth sync, the approval mirrors, the seeders
 * — through the same `sudo()`-shaped spread. The security middleware's
 * `isSystem` short-circuit cannot tell them apart, and the refusal that stops
 * automation from writing the identity-assignment objects
 * (`flow-system-identity-write-refusal.ts`, plugin-security) must. A flow run
 * is told apart by its `flowRunId`; a hook and an action body carry no run, so
 * their elevation carries this mark instead.
 *
 * ## Where it is set — and where it is never set
 *
 * Only where app-authored metadata's elevation is derived:
 *
 *  - `'hook'` — a hook's `runAs: 'system'` derivation (`ScopedContext.withRunAs`,
 *    objectql);
 *  - `'action'` — an action body's execution-context builder
 *    (`buildActionExecutionContext`, runtime).
 *
 * ⛔ Never on `sudo()` itself, nor on any other platform system context: the
 * platform's own writes to those objects stay unchanged. Once set, the mark
 * rides every spread of the context exactly as `flowRunId` does, so a write the
 * hook's or the body's own write sets off under the same context (a nested
 * hook, a cascade leg, a `sudo()` taken inside the body) is judged as theirs.
 *
 * ## Why a symbol, and why it is not an `ExecutionContext` field
 *
 * It is server-constructed by construction: no request body, query string or
 * stored row can spell a symbol, so no caller can claim or shed it. It is an
 * in-process provenance fact, never a principal and never an authorization
 * grant — its only reader narrows (it refuses; it admits nothing). `Symbol.for`
 * rather than a module-local `Symbol()`, because this package ships an ESM and
 * a CJS build and a process may load both: the mark must be the same key in
 * each.
 *
 * Being undeclared, the mark does not survive `ExecutionContextSchema.parse`,
 * which keeps declared keys only. A producer that parses a marked context
 * (`ObjectQL.createContext`) carries it across with
 * {@link carryAppAutomationElevation}.
 */

/** What derived the elevation: a hook's `runAs: 'system'`, or an action body. */
export type AppAutomationElevation = 'hook' | 'action';

/** The context key of the mark. See the module header. */
export const APP_AUTOMATION_ELEVATION: unique symbol = Symbol.for('objectstack.core.appAutomationElevation');

/**
 * `context` with the mark added — a fresh object; `context` is not changed.
 * Called only at the two derivation sites the module header names.
 */
export function markAppAutomationElevation<T extends object>(
  context: T,
  source: AppAutomationElevation,
): T & { [APP_AUTOMATION_ELEVATION]: AppAutomationElevation } {
  return { ...context, [APP_AUTOMATION_ELEVATION]: source };
}

/** The mark `context` carries, or `undefined` for every other context. */
export function appAutomationElevationOf(context: unknown): AppAutomationElevation | undefined {
  if (context === null || typeof context !== 'object') return undefined;
  const mark = (context as { [APP_AUTOMATION_ELEVATION]?: unknown })[APP_AUTOMATION_ELEVATION];
  return mark === 'hook' || mark === 'action' ? mark : undefined;
}

/**
 * `to` carrying the mark `from` carries: `to` itself when `from` has none, a
 * fresh copy of `to` with the mark otherwise. For a producer that rebuilds a
 * context (a schema parse) from one that may be marked.
 */
export function carryAppAutomationElevation<T extends object>(from: unknown, to: T): T {
  const mark = appAutomationElevationOf(from);
  return mark ? markAppAutomationElevation(to, mark) : to;
}
