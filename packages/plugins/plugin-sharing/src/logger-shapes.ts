// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one `{ info?, warn? }` logger shape this package's fire-and-forget
 * projection modules share (#10692).
 *
 * ## Why this file exists
 *
 * `plugin-sharing` declared SEVEN module-local interfaces all named
 * `MinimalLogger`. Duplication was not the defect; DIVERGENCE under one name
 * was. When #10556 made `bulk-recompute.ts`'s `warn` non-optional, `tsc`
 * reported the two modules that forward into it with the unreadable form:
 *
 *     Type 'MinimalLogger' is not assignable to type 'MinimalLogger'.
 *       Two different types with this name exist, but they are unrelated.
 *
 * A shared declaration removes that seam for the modules that can share one,
 * and the DISTINCT NAME is deliberate: when a future forwarding edge is added
 * between this shape and a module that still declares its own, the diagnostic
 * names two different types instead of the same one twice.
 *
 * ## Why the members are spelled precisely, and must stay that way
 *
 * The members take a `string` message and an optional `Record` of string keys
 * to `any` values as structured metadata — NOT `(msg: any, ...rest: any[])`.
 *
 * This shape first shipped with that loose spelling, carried over from the two
 * byte-identical declarations it replaced. `sharing-rule-provenance.ts` was
 * left out of it precisely BECAUSE its own declaration was stricter, and
 * folding it onto the loose spelling would have deleted real checking. That
 * open question was ruled the other way (#10692): the shared contract takes the
 * PRECISE spelling and the third module joins it.
 *
 * ⛔ Do not loosen these members back to `any` to make some new caller fit.
 * `(msg: any, ...rest: any[])` documents nothing and catches nothing — the same
 * complaint this package's card levels at bare `Function`. All call sites on
 * this shape already pass exactly a message plus an optional metadata object;
 * a caller that does not fit is the thing to look at, not this declaration.
 *
 * ## ⛔ Why this shape declares no `error`, and must not grow one
 *
 * `check:optional-error-sink` (#9754) draws its population STRUCTURALLY: a sink
 * is in scope only if it DECLARES an `error` member. A shape with no `error` is
 * out of the population — there is no optional fallback for the rule to
 * guarantee. Adding `error?` here would enrol every module that uses this type
 * into that gate's scope at once, and that ledger is being paid DOWN
 * deliberately (#10556: 15 → 3 → 2, shrink-only). Enlarging it is a contract
 * decision for the #10556 family, never a side effect of de-duplication.
 *
 * ## ⛔ Why the other four modules do NOT use this type
 *
 * They are not the same contract, and collapsing them would change meaning:
 *
 * - `bulk-recompute.ts` — `{ info?, warn, error? }`. It IS the guaranteed sink;
 *   its `warn` is required and it declares `error?`, so it is in the gate's
 *   population by design.
 * - `rule-hooks.ts`, `record-share-cascade.ts` — `{ info?, warn }`. Their `warn`
 *   is required because they FORWARD into `bulk-recompute.ts`'s guaranteed sink;
 *   a `warn?` there re-opens the silence one module downstream of where #10556
 *   closed it.
 * - `record-orphan-cleanup.ts` — `{ info?, warn }`. Its `warn` is required
 *   because the sweep's every report lands there (#10692, ruled 2026-08-25);
 *   this type must stay optional-`warn` because its consumers are
 *   fire-and-forget projections whose reports are advisory. The bare-`Function`
 *   spelling it once carried could not tighten until the two producers feeding
 *   it — `SharingServiceOptions['logger']` and `ShareLinkServiceOptions
 *   ['logger']` — dropped bare `Function` (#10556 limb (c), PR #11856;
 *   `Function` is assignable to no concrete signature). Requiredness of every
 *   required `warn` in this package's public options types and in the sweep is
 *   pinned by `logger-required-warn.pin.ts`.
 */
export interface OptionalSharingLogger {
  info?: (msg: string, meta?: Record<string, any>) => void;
  warn?: (msg: string, meta?: Record<string, any>) => void;
}
