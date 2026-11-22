// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mark a decided flow segment's data context carries naming the user the
 * run began for — its caller — or `null` when the run began for no caller (a
 * scheduled run, a record-change run fired by a write that carried no user).
 *
 * ## Why a mark
 *
 * An app-authored elevation is bounded by its caller's organization wall
 * (`app-automation-organization-wall.ts`,
 * plugin-security), so the wall judges a `runAs: 'system'` run by the user it
 * runs for. After a human decision the run's segment carries the decider as
 * its `userId`: the decider is the segment's attribution user (`runAs` in
 * `flow.zod.ts`), not the user the run runs for. This mark keeps the run's
 * caller beside it, so the wall goes on judging a run by the user it began
 * for, and leaves a run that began for no caller unjudged in every segment, as
 * the published `runAs` text promises: a system flow keeps its system
 * privileges after a decision.
 *
 * A segment no decision switched carries no mark: its `userId` is the caller.
 *
 * ## Where it is set
 *
 * By service-automation's system arm (`resolveRunDataContext`), on a segment a
 * decision switched to its decider. When the run began for no caller (`null`),
 * objectql's hook session of the segment's writes carries it too
 * (`buildSession`), and the record-change trigger reads it there, so a run
 * such a write starts begins for no caller as well. Read by plugin-security's
 * organization wall and that trigger, and nothing else. It grants nothing: it
 * names whose wall judges the run, or that none does.
 *
 * ## Why a symbol
 *
 * Server-constructed by construction: no request body, query or stored row can
 * spell a symbol, so no caller can claim it or shed it. It rides every spread
 * of the context (a hook the run's write fires, a cascade leg), as the
 * app-automation elevation mark does. `Symbol.for`, so an ESM and a CJS build
 * agree on it.
 *
 * Being undeclared, the mark does not survive `ExecutionContextSchema.parse`,
 * which keeps declared keys only, and `ObjectQL.createContext` carries only
 * the app-automation elevation mark across. No path parses a marked context
 * today; a producer that comes to parse one carries the mark across itself.
 */

/** The context key of the mark. See the module header. */
export const RUN_CALLER: unique symbol = Symbol.for('objectstack.core.runCaller');

/** `context` with the run's caller (`null`: none) marked on it — a fresh object; `context` is not changed. */
export function markRunCaller<T extends object>(context: T, caller: string | null): T & { [RUN_CALLER]: string | null } {
  return { ...context, [RUN_CALLER]: caller };
}

/**
 * The run's caller the context is marked with: a user id, `null` when the run
 * began for no caller, or `undefined` when the context carries no mark.
 */
export function runCallerOf(context: unknown): string | null | undefined {
  if (context === null || typeof context !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(context, RUN_CALLER)) return undefined;
  const caller = (context as { [RUN_CALLER]?: unknown })[RUN_CALLER];
  return typeof caller === 'string' && caller !== '' ? caller : null;
}
