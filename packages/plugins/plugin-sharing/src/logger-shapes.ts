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
 * - `record-orphan-cleanup.ts` — `{ info?: Function, warn?: Function }`. Bare
 *   `Function` documents nothing, but it cannot be tightened to this shape:
 *   `Function` is NOT assignable to a concrete signature ("Type 'Function'
 *   provides no match for the signature"), and the two loggers handed to it —
 *   `SharingServiceOptions['logger']` and `ShareLinkServiceOptions['logger']` —
 *   are themselves spelled with bare `Function`. Tightening it requires
 *   tightening those producers first, which is a gate-population change, not a
 *   refactor. Recorded on #10692 rather than done quietly here.
 * - `sharing-rule-provenance.ts` — `{ info?, warn? }` by OPTIONALITY but with a
 *   stricter member signature, `(msg: string, meta?: Record<string, any>)`.
 *   Folding it onto the `(msg: any, ...rest: any[])` spelling below would DELETE
 *   real checking at its call sites; folding the others onto ITS spelling would
 *   tighten two modules. Either direction changes meaning, so neither is a
 *   de-duplication — see #10692 for the open contract question.
 */
export interface OptionalSharingLogger {
  info?: (msg: any, ...rest: any[]) => void;
  warn?: (msg: any, ...rest: any[]) => void;
}
