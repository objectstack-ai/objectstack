// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7284] The `__` operation-private-key convention — one owner, on the
 * CONSUMER side.
 *
 * `assemble-execution-context.ts` next door is the single place an
 * `ExecutionContext` is BUILT at a transport entry point (#6216). This file is
 * its counterpart at the other end: the single place one is stripped back down
 * before being forwarded to a question it was not resolved for.
 *
 * ## What a `__` key is
 *
 * plugin-security's middleware STAMPS keys onto the operation context, resolved
 * for the object of the operation IN FLIGHT. They are middleware-private
 * vocabulary, not fields of `ExecutionContext`, and every one of them is read as
 * a WIDENING input by whoever consumes it:
 *
 *  - the ADR-0057 D1 access DEPTH the sharing owner-match expands to —
 *    `__readScope` / `__writeScope`, plus the ADR-0090 D10 delegator halves
 *    `__delegatorReadScope` / `__delegatorWriteScope`, stamped in place by
 *    `security-plugin.ts` (`sc.__readScope = …`);
 *  - the engine's internal privilege markers on the same channel —
 *    `__expandRead` waives the object-level CRUD check for a lookup expansion,
 *    `__referentialFieldClear` the referential-clear write.
 *
 * plugin-security is the PRODUCER of that vocabulary and would be the most
 * honest owner of the rule for consuming it, but none of the three consumers
 * depends on it and a string-prefix filter does not justify three new dependency
 * edges onto a plugin (the trade the filing card priced, #7284). `@objectstack/
 * spec` is fenced off by Prime Directive #2. `@objectstack/core` is the only
 * candidate every consumer already depends on, so the rule lives here and the
 * producer stays free of reverse edges.
 *
 * ## Why a consumer must drop them
 *
 * A caller's envelope carries a depth resolved for the object the middleware
 * last saw. A consumer that forwards that envelope to ask about a DIFFERENT
 * object applies one object's widening to another object's question — the exact
 * stale-scope leak `resolveWriteScopeForSharing` was extracted to prevent ("a
 * stale value can never leak in through a spread", `security-plugin.ts`).
 *
 * The leak is not hypothetical and does not require the consumer to be careless:
 * plugin-security only OVERWRITES `__readScope` when it actually resolves
 * permission sets for the new object (`if (permissionSets.length > 0)`), so a
 * stale depth SURVIVES into a question it was never resolved for whenever that
 * branch does not fire. A REST request that touched another object before
 * reaching, say, `/reports/:id/run` hands over an envelope the middleware has
 * already written into.
 *
 * Dropping is safe in the one direction that matters: the middleware re-stamps
 * the depth for THIS object when it resolves any set, so the only thing dropping
 * can do is leave the sharing owner-match at its narrowest (`own`) — the safe
 * direction.
 *
 * ## Why by PREFIX and never by a name list
 *
 * The `__` convention is what marks a key as belonging to the operation in
 * flight. A hand-maintained list of the six names above would go stale the day
 * the middleware stamps a seventh, and it would go stale SILENTLY — a forwarded
 * key nobody remembered to add reads exactly like a key that was meant to be
 * forwarded. The prefix is the contract; the names are its current membership.
 *
 * ⛔ The corollary, for whoever changes the middleware: a key that is
 * operation-private MUST carry the `__` prefix. Stamping one without it makes it
 * invisible to every consumer at once, and there is no compiler error.
 *
 * ## Known consumers
 *
 * `plugin-audit` (`comment-access-hooks.ts`, #7141), `service-storage`
 * (`attachment-access-hooks.ts`, #7145) and `plugin-reports`
 * (`report-service.ts`, #7204) — each forwarding a caller envelope to a gate or
 * a read that asks about a parent/target object rather than about the object the
 * middleware resolved for. Each of the three grew its own byte-equivalent copy
 * of this file by hand before #7284 gave the rule a home; `operation-private-
 * keys.pin.test.ts` is what now catches a fourth.
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';

/**
 * The prefix marking a key as private to the operation plugin-security has in
 * flight. See this module's header for why the convention is a prefix and not a
 * list of names.
 */
export const OPERATION_PRIVATE_KEY_PREFIX = '__';

/**
 * The caller's execution envelope, minus the operation-private keys.
 *
 * A FRESH object every time, and that is load-bearing in BOTH directions:
 *
 *  - outbound — a callee that stamps its own `__writeScope` onto what it
 *    receives (which is exactly what plugin-security does before it calls the
 *    sharing service) can never write back into the operation context the caller
 *    was handed;
 *  - inbound — the engine's middleware stamps a depth for the object it is about
 *    to read onto whatever it is handed, so forwarding a caller's envelope BY
 *    REFERENCE would write that depth back into the request context the route
 *    goes on using.
 *
 * ⛔ Never `return exec;` on the "nothing to strip" path. The copy is the point,
 * not an optimisation to skip when the envelope happens to be clean — the two
 * hazards above are about the callee's future writes, not about the current
 * contents.
 *
 * Note what this deliberately does NOT do: it strips, it never SYNTHESISES a
 * depth for the new object. Absent depth leaves the sharing owner-match at its
 * narrowest (`own`), which is the safe direction and byte-for-byte what the
 * five-field projections these call sites replaced produced.
 *
 * @param exec the caller's envelope, as a bare record
 * @returns a new envelope carrying only the non-operation-private keys
 */
export function withoutOperationPrivateKeys(exec: Record<string, unknown>): ExecutionContext {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(exec)) {
    if (key.startsWith(OPERATION_PRIVATE_KEY_PREFIX)) continue;
    out[key] = value;
  }
  return out as ExecutionContext;
}
