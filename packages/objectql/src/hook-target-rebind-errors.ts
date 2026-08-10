// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5574 / #5846] The refusal that replaced a silent retarget: a `before*` hook
 * rebinding — or clearing — `ctx.input.id` after the engine has already
 * resolved which row(s) this write is about.
 *
 * ## What used to happen, and why it had to stop
 *
 * `update()` and `delete()` dispatched `beforeUpdate` / `beforeDelete` FIRST
 * and only then read `hookContext.input.id` to choose the driver call. So the
 * id slot doubled as a control lever: a handler that assigned `ctx.input.id =
 * undefined` on a by-id call converted the write into a PREDICATE write over
 * the caller's `where`, and a handler that assigned some OTHER id moved the
 * write to a different row.
 *
 * ADR-0058 Addendum II (#5574 ruling B) reorders that seam. The per-row
 * `before*` contract needs the matched row set in hand BEFORE the before phase
 * — the row set is what the per-row contexts are BUILT from — so the dispatch
 * ladder is resolved first, and #5846's (a) direction moves the by-id path's
 * prior-row read ahead of the dispatch too, so `previous` is bound for the
 * before phase. Both consequences point the same way: by the time a handler
 * runs, the target is settled. `previous`, the `readonlyWhen` strip and every
 * validation rule have already been computed against the row the ladder chose.
 *
 * That leaves the lever with exactly two possible meanings, and both are bad:
 *
 *  - **Ignore it.** The handler's assignment retargets nothing and says
 *    nothing. A silent no-op is the failure shape this whole family exists to
 *    abolish (#4649 / #4775 / #5038) — and here the no-op is not even the worst
 *    of it, because the write still lands on the ORIGINAL row.
 *  - **Honour it by re-resolving.** The write would then land on a row whose
 *    pre-image was never read, whose `readonlyWhen` locks were never evaluated
 *    and whose validation rules were checked against a different record.
 *    Silently weaker enforcement, aimed by a hook.
 *
 * So the ruling picked the third option: REFUSE, loudly, naming the capability
 * that was retired. Nothing is written; the handler learns its assignment was
 * meaningful and is no longer honoured, instead of learning nothing.
 *
 * D4 states the predicate half of the same rule — a per-row context arrives
 * with `id` ALREADY bound to its row, and rebinding it retargets nothing — so
 * one error serves both paths.
 *
 * ## What this error does NOT cover: `delete()`'s by-id REPOINT
 *
 * The two verbs answer a rebind differently on the by-id path, and the
 * asymmetry is a scope decision rather than an oversight — read it before
 * "fixing" it either way.
 *
 * `delete()` has had a working RE-RESOLUTION for a repointed target since
 * #5272: when a `beforeDelete` handler moves `input.id`, the engine re-reads
 * that row's pre-image and rebinds `previous`, so nothing stale reaches
 * `afterDelete` or the summary recompute. The second bullet above simply is not
 * true there. `update()` has no such mechanism, and building one would be the
 * "silently pick re-resolution instead" the ruling forbids — so `update()`
 * refuses a rebind and `delete()` keeps honouring one, until the repoint itself
 * is ruled on as its own question (#6752).
 *
 * A CLEARED id is a different question and both verbs answer it the same way,
 * because the ladder reorder leaves it no answer of its own: clearing used to
 * convert the write into a PREDICATE write over the caller's `where`, and the
 * ladder is now resolved before any handler runs. That is the capability the
 * ruling names, and it is what this error is for on the `delete()` path.
 *
 * ## Why `code` is an `ERR_`-prefixed operational code, not a wire code
 *
 * Same reasoning as {@link BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE} next door:
 * ADR-0112 makes `error.code` a CLOSED vocabulary (`StandardErrorCode` ∪
 * `ERROR_CODE_LEDGER`) that `rest-server.ts` promotes onto the response
 * envelope, so minting a member of it by side effect is the exact
 * `declared ≠ enforced` shape that vocabulary exists to prevent. This code
 * travels on the thrown error's own property bag; putting it on the wire is a
 * ledger decision, not a property that happens to be named `code`.
 */
export const HOOK_TARGET_REBIND_ERROR_CODE = 'ERR_HOOK_TARGET_REBIND';

/** Which lifecycle seam observed the rebinding. */
export type HookTargetRebindPath =
  /** A by-id `update()` / `delete()` whose `before*` handler moved or cleared the id. */
  | 'by-id'
  /** A per-row `before*` context on a predicate write (D4). */
  | 'per-row';

export class HookTargetRebindError extends Error {
  override readonly name = 'HookTargetRebindError';
  readonly code = HOOK_TARGET_REBIND_ERROR_CODE;
  /** The object being written. */
  readonly object: string;
  /** The event whose dispatch the rebinding was observed after. */
  readonly event: string;
  /** Which seam this is — see {@link HookTargetRebindPath}. */
  readonly path: HookTargetRebindPath;
  /** The id the engine resolved and computed the write against. */
  readonly expectedId: unknown;
  /** What `ctx.input.id` held when the dispatch returned. */
  readonly observedId: unknown;

  constructor(info: {
    object: string;
    event: string;
    path: HookTargetRebindPath;
    expectedId: unknown;
    observedId: unknown;
  }) {
    super(buildMessage(info));
    this.object = info.object;
    this.event = info.event;
    this.path = info.path;
    this.expectedId = info.expectedId;
    this.observedId = info.observedId;
  }
}

const show = (v: unknown): string =>
  v === undefined ? 'undefined' : v === null ? 'null' : JSON.stringify(v) ?? String(v);

function buildMessage(info: {
  object: string;
  event: string;
  path: HookTargetRebindPath;
  expectedId: unknown;
  observedId: unknown;
}): string {
  const { object, event, path, expectedId, observedId } = info;
  const cleared = observedId === undefined || observedId === null || observedId === '';
  const head =
    `Refusing the write on '${object}': a '${event}' handler ${cleared ? 'CLEARED' : 'REBOUND'} ` +
    `'ctx.input.id' (${show(expectedId)} → ${show(observedId)}) after the engine had already resolved ` +
    `the target. Nothing was written.`;

  // The capability being retired, named — the whole point of the refusal is
  // that the author learns what stopped working rather than watching a write
  // land somewhere unexpected.
  const retired =
    path === 'by-id'
      ? cleared
        ? ` The capability this used to have is RETIRED: clearing 'input.id' in a '${event}' handler ` +
          `converted a by-id write into a PREDICATE write over the caller's 'where'. Since ADR-0058 ` +
          `Addendum II (#5574 / #5846) the dispatch ladder is resolved BEFORE the before phase — the ` +
          `predicate path has to read its matched rows first, to build one context per row — so there ` +
          `is no ladder left to re-enter.`
        : ` The capability this used to have is RETIRED: rebinding 'input.id' in a '${event}' handler ` +
          `moved the write to another row. The engine now reads that row's pre-image, evaluates its ` +
          `'readonlyWhen' locks and runs its validation rules BEFORE dispatching, so honouring a ` +
          `rebind would write a row that none of those checks ever saw.`
      : ` On a predicate write a '${event}' context arrives with 'id' ALREADY bound to its row and the ` +
        `dispatch decided, so rebinding it retargets nothing (ADR-0058 Addendum II, D4). It is refused ` +
        `rather than ignored, because a silent no-op is the failure this contract exists to abolish.`;

  const routes =
    ` To write a DIFFERENT row, call 'ctx.api' / 'ctx.ql' for that row explicitly. To write MANY rows, ` +
    `have the caller pass '{ multi: true, where: … }'. To stop this write, throw from the handler — ` +
    `that is the supported way for a '${event}' guard to refuse.`;

  return head + retired + routes;
}
