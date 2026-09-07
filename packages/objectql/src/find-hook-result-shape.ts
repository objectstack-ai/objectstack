// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15823] The refusal that closes `find()`'s one unguarded seam: an
 * `afterFind` handler that REPLACES the read's container instead of shaping
 * what is inside it.
 *
 * ## What used to happen
 *
 * `ObjectQL.find` declares `Promise<any[]>` and, on the hook path, ended with
 * `return hookContext.result` — with nothing between the `afterFind` dispatch
 * and that return re-checking the value against the declared array. A handler
 * assigning `ctx.result = { records: [ … ] }` therefore made a `find()` declared
 * to resolve to an array resolve to an envelope, silently: no throw, no
 * diagnostic, no log. Measured on a real engine over a real SQL driver —
 * `ARRAY(len=1)` with no hooks, `OBJECT{records}` with the handler.
 *
 * Of the four `return hookContext.result` sites in `engine.ts` this is the only
 * one with a concrete declared shape to violate; `findOne`, `update` and
 * `delete` all declare `Promise<any>` and carry no enforceable declaration at
 * all. That is a separate question about those declarations and is deliberately
 * NOT answered here.
 *
 * ## Why a refusal rather than a wider declaration
 *
 * The fork was real and pointed both ways — either the engine guarantees the
 * array, or `find()`'s declaration is wrong and the ~70 array-or-envelope
 * normalizer limbs the #15094 census counted are load-bearing rather than dead.
 * The maintainer ruled the first (2026-09-06): the protocol is the baseline and
 * the declaration IS the contract, so the seam that can break it is closed
 * rather than the contract widened. `packages/spec/src/data/hook.zod.ts` backs
 * it — a read is ONE event regardless of shape — as does ADR-0077 line 71, whose
 * "intercept or shape reads" means shaping rows INSIDE the array, not replacing
 * the array.
 *
 * The consequence the ruling records: every array-or-envelope normalizer limb
 * downstream of `find()` is now dead BY TYPE. A reviewer asked to delete one no
 * longer has to establish reachability — "reachable in principle" is answered
 * `no` by the engine.
 *
 * ## The predicate is `Array.isArray`, and nothing cleverer
 *
 * SHAPING STAYS LEGAL. A handler may mutate rows in place, drop keys, filter
 * rows away, or build a brand-new array — `ctx.result = ctx.result.map(…)` is
 * the ordinary spelling of "shape a read" and must keep working. So the check
 * is on the container SHAPE and never on identity: comparing the value against
 * the one the engine put there, freezing it, or cloning it would each refuse a
 * legitimate reshaping. What is refused is exactly one thing — the container
 * stops being an array.
 *
 * ## `undefined` / `null` are refused too — decided here, not by the ruling
 *
 * The ruling names the envelope case. A handler that assigns `undefined` (or
 * `null`) is not "replacing the container with an envelope", but it is equally
 * not an array, and it breaks `Promise<any[]>` exactly as much: the caller gets
 * a value its type says cannot occur, and the failure lands at a call site far
 * from the handler. Admitting it would leave a second hole beside the one being
 * closed, in the same slot, with no way to tell the two apart from the outside.
 * A read that should answer nothing answers `[]`; a handler that wants to REFUSE
 * a read throws from the handler, which is the supported spelling and already
 * how every other hook guard says no. So one predicate covers every non-array,
 * and {@link describeFindHookResult} is what makes the refusal say WHICH one it
 * saw.
 *
 * ## Why `500`, and what that costs
 *
 * The request was well-formed and authorized; a hook this deployment installed
 * broke the engine's declared contract. There is nothing the caller can change
 * and nothing to retry — the definition of a 5xx, and the reason this is not
 * `400` like its `MultiUpdateHookKeyDivergenceError` neighbour (whose remedy
 * genuinely belongs to the caller) nor `403` like `HookUnscopedDataAccessError`
 * (an authorization answer).
 *
 * ⚠️ Stated rather than discovered later: a DECLARED 5xx has its prose withheld
 * at the HTTP doors (`declaresServerFault` in `packages/types/src/error-leak.ts`;
 * `rest-server.ts` and `dispatcher-plugin.ts` both replace the message with
 * `INTERNAL_ERROR_MESSAGE`), so an HTTP caller reads "Internal server error"
 * plus this code. That is the right split rather than a loss: the code is the
 * machine-readable half and crosses intact because it is REGISTERED, while the
 * message below is addressed to the HOOK'S AUTHOR, who meets it in-process at
 * the `find()` call and in the server log — not to the client. The alternative,
 * declaring a 4xx to keep the prose on the wire, would tell the caller its
 * request was at fault, which is false.
 *
 * ## Why a REGISTERED ADR-0112 code, not an `ERR_`-prefixed operational one
 *
 * Same call, and for the same reason, as `MULTI_UPDATE_HOOK_KEY_DIVERGENCE_CODE`
 * one file over: the whole value of this refusal is that it is RECOGNISED. An
 * unregistered spelling is demoted off `error.code` at every door
 * (`resolveThrownHttpError`) and rides `declaredCode` instead, which is the
 * wrong channel for the one code a host has to branch on to find its own
 * misbehaving handler.
 */

/**
 * The wire code, registered in the spec's `ERROR_CODE_LEDGER` under
 * `@objectstack/objectql`. ONE code, ONE wording — every non-array shape
 * answers this, and which shape it was rides the message and
 * {@link FindHookResultNotArrayError.observed}, which is where ADR-0112 D3/D4
 * put detail rather than growing the closed `code` vocabulary.
 */
export const FIND_HOOK_RESULT_NOT_ARRAY_CODE = 'FIND_HOOK_RESULT_NOT_ARRAY' as const;

/** `500` — see the module note: a server-side handler broke a server-side contract. */
export const FIND_HOOK_RESULT_NOT_ARRAY_STATUS = 500 as const;

/**
 * A one-word name for what the handler left in `ctx.result`, used in the
 * message and exposed on the error.
 *
 * `'array'` is included so the function is total and the caller cannot hand a
 * legal value to the error by mistake; the engine never constructs the error on
 * that branch.
 */
export function describeFindHookResult(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return typeof value;
}

/**
 * The ADR-0112 envelope `find()` raises when its `afterFind` dispatch returned
 * with `hookContext.result` no longer an array.
 *
 * Thrown at the seam — immediately after `triggerHooks('afterFind', …)` and
 * BEFORE `maskSecretFields` / `stripSearchCompanionFromRead`, both of which
 * already assume the array — so the diagnosis names the handler that did it
 * instead of surfacing as a `TypeError` at one of the ~140 `find()` call sites
 * that trusted the declaration.
 */
export class FindHookResultNotArrayError extends Error {
  override readonly name = 'FindHookResultNotArrayError';
  readonly code = FIND_HOOK_RESULT_NOT_ARRAY_CODE;
  readonly status = FIND_HOOK_RESULT_NOT_ARRAY_STATUS;
  /** The object being read. */
  readonly object: string;
  /** The hook event whose dispatch the replacement was observed after. */
  readonly event: string;
  /** What the handler left behind — {@link describeFindHookResult}. */
  readonly observed: string;
  /** The remedy half, addressed to the hook's author rather than to a user. */
  readonly developerMessage: string;

  constructor(info: { object: string; event: string; result: unknown }) {
    const observed = describeFindHookResult(info.result);
    super(buildMessage(info.object, info.event, observed));
    this.object = info.object;
    this.event = info.event;
    this.observed = observed;
    this.developerMessage =
      `'find()' declares 'Promise<any[]>' and roughly 140 call sites in this repository read it as ` +
      `an array without checking. A '${info.event}' handler may SHAPE a read — mutate rows in place, ` +
      `drop keys, filter rows out, or assign a different ARRAY built from them — but replacing the ` +
      `container itself is refused, because the declaration is the contract (ADR-0077 line 71 means ` +
      `shaping rows inside the array, and 'hook.zod.ts' makes a read one event regardless of shape). ` +
      `To answer no rows, assign '[]'. To REFUSE the read, throw from the handler — that is the ` +
      `supported way for a '${info.event}' guard to say no. To hand the caller a different ` +
      `structure, do it in the caller, not in the hook. Branch on ` +
      `\`code === '${FIND_HOOK_RESULT_NOT_ARRAY_CODE}'\` (ADR-0112) to detect this.`;
  }
}

/**
 * The user-facing sentence.
 *
 * ⛔ It must not begin with a SQL verb — `@objectstack/rest`'s importer runs row
 * errors through `sanitizeRowError`, whose SQL backstop replaces any message
 * STARTING with `insert`/`update`/`delete` with generic text. The same
 * constraint `DuplicateRecordError` and `MultiUpdateHookKeyDivergenceError`
 * record, for the same reason.
 */
function buildMessage(object: string, event: string, observed: string): string {
  // `undefined` / `null` name themselves; everything else takes an article, and
  // `object` is the one that needs `an` — the shape this refusal exists for.
  const what =
    observed === 'undefined' || observed === 'null'
      ? observed
      : `${'aeiou'.includes(observed[0]) ? 'an' : 'a'} ${observed}`;
  return (
    `Refusing the read on '${object}': its '${event}' handler replaced 'ctx.result' with ${what}, ` +
    `and 'find()' guarantees an array. Shaping the rows is supported; replacing the container is not.`
  );
}
