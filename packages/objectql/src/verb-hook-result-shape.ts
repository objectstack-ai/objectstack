// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16231] The other three `return hookContext.result` seams — `findOne`,
 * `update` and `delete` — closed on the same terms `find()`'s was, now that
 * each of them has a declaration worth guarding.
 *
 * ## Why this module could not have been written before
 *
 * `engine.ts` has FOUR `return hookContext.result` sites, one per hook-bearing
 * verb. #15823 closed the `find()` one, and its own module note recorded why it
 * could only close that one: `find()` declared `Promise<any[]>` — a concrete
 * container to violate — while `findOne`, `update` and `delete` all declared
 * `Promise<any>` and so carried nothing an `after*` handler could break.
 *
 * A guard cannot exist before a declaration worth guarding does. That is the
 * whole framing of #16231, and the maintainer ruled it (option A, 2026-09-07,
 * director seat summon #17, decision batch #2): the three declarations move off
 * `any` onto what the verbs actually answer, and each seam is then guarded
 * exactly as `find()`'s is. Options B (declare only, no enforcement) and C
 * (record `any` as intended) were refused.
 *
 * ## What each verb declares, and where the shape comes from
 *
 * Not invented here — read off the driver contract each engine exit delegates
 * to (`IDataDriver`, `packages/spec/src/contracts/data-driver.ts`) and off the
 * dispatch ladder that chooses between them
 * (`resolveEngineUpdateDispatch` / `resolveEngineDeleteDispatch`):
 *
 *   findOne  → `Record<string, any> | null`
 *              ONE exit: `driver.findOne`, declared
 *              `Promise<Record<string, unknown> | null>`. The engine's own
 *              docblock has said the same in prose since #4419 — "Read the ONE
 *              record the query selects, or `null`" — and callers already
 *              branch on `if (!row)`.
 *
 *   update   → `Record<string, any> | number | null`
 *              TWO exits. By-id (`driver.update`,
 *              `Promise<Record<string, unknown> | null>`) answers the
 *              post-write readback — or `null` when that readback leaves the
 *              caller's row scope. Predicate (`driver.updateMany`,
 *              `Promise<number>`) answers the affected-row COUNT and names no
 *              row (#4639); `engine.ts` says so at the publish branch it feeds.
 *
 *   delete   → `boolean | number`
 *              TWO exits, same fork. By-id (`driver.delete`,
 *              `Promise<boolean>`) answers whether the row was there —
 *              `metadata-protocol`'s `deleteData` already turns `false` into a
 *              404. Predicate (`driver.deleteMany`, `Promise<number>`) answers
 *              the affected count.
 *
 * ⚠️ The row's FIELD values stay erased (`Record<string, any>`, not
 * `Record<string, unknown>`), and that is the precedent being extended rather
 * than a softening of it. `find()` declares `Promise<any[]>`: the CONTAINER is
 * the contract and the rows inside it are `any`. Declaring the container is
 * what makes a normalizer limb dead by type; declaring every field's value
 * type is a different, much larger change that no ruling has asked for, and it
 * was measured on this card's census as breaking a materially larger consumer
 * set (every `new Date(row.some_column)` in the repo) for no gain the ruling
 * names. `Record<string, any> | null` is also the only spelling that can say
 * "record or null" at all — `any | null` collapses to `any`.
 *
 * ## One predicate per verb, on the CONTAINER, and nothing cleverer
 *
 * SHAPING STAYS LEGAL, exactly as #15823 holds for `find()`. An `afterFind`
 * handler may mutate the row in place, drop keys, or assign a DIFFERENT record
 * built from it; an `afterUpdate` handler may reshape the record it is handed.
 * So each check is on the shape of the container the verb declares and never on
 * identity — comparing against the value the engine put there, freezing it or
 * cloning it would each refuse a legitimate reshaping.
 *
 * What is refused is exactly one thing per verb: the answer stops being one of
 * the shapes the declaration admits.
 *
 * ## `undefined` is refused everywhere, and that is a decision, not an oversight
 *
 * Same call #15823 made for `find()`, for the same reason and with the same
 * cost. `undefined` is not one of the declared limbs on any of the three, and
 * admitting it would leave a second hole beside the one being closed, in the
 * same slot, indistinguishable from the outside. A read that answers no record
 * answers `null`; a handler that wants to REFUSE an operation throws from the
 * handler, which is how every other hook guard says no.
 *
 * ⚠️ For `delete` this is load-bearing in a way the others are not: `boolean |
 * number` admits `false` and `0`, so a guard written as a truthiness check
 * would refuse the two most ordinary answers there are ("the row was not
 * there", "no rows matched"). The predicates below are `typeof` tests for that
 * reason.
 *
 * ## Why `500`, and why REGISTERED ADR-0112 codes
 *
 * Both answers are `find-hook-result-shape.ts`'s, unchanged: the request was
 * well-formed and authorized and a hook this deployment installed broke the
 * engine's declared contract (a 5xx by definition, nothing for the caller to
 * retry), and the value of the refusal is that a host can RECOGNISE it to find
 * its own misbehaving handler — which an unregistered spelling cannot do,
 * because it is demoted off `error.code` at every door
 * (`resolveThrownHttpError`). A declared 5xx has its prose withheld at the HTTP
 * doors, so the wire carries the code and the message reaches the HOOK'S
 * AUTHOR in-process and in the server log, which is who it is addressed to.
 *
 * THREE codes rather than one shared code: the three declarations are three
 * different contracts, a host branching on one of them is branching on a
 * specific verb's answer shape, and ADR-0112's closed vocabulary is where that
 * distinction belongs. `observed` carries WHICH wrong shape it was, per D3/D4,
 * rather than growing the `code` vocabulary per shape.
 *
 * @see find-hook-result-shape.ts — the #15823 original this mirrors.
 */

import { describeFindHookResult } from './find-hook-result-shape.js';

/**
 * One word for what the handler left behind, shared with the `find()` refusal
 * so the three verbs and their elder sibling describe a shape identically.
 *
 * Re-exported under a verb-neutral name rather than re-implemented: a second
 * copy of `typeof`-with-special-cases is exactly the kind of near-duplicate
 * that drifts (one of them learns about `Date`, the other does not) and then
 * makes two refusals disagree about what they saw.
 */
export const describeHookResult = describeFindHookResult;

/** A record — an object that is neither `null` nor an array. */
function isRecordShape(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// findOne
// ---------------------------------------------------------------------------

/** The wire code, registered in the spec's `ERROR_CODE_LEDGER`. */
export const FIND_ONE_HOOK_RESULT_NOT_RECORD_CODE = 'FIND_ONE_HOOK_RESULT_NOT_RECORD' as const;

/** `500` — a server-side handler broke a server-side contract. */
export const FIND_ONE_HOOK_RESULT_NOT_RECORD_STATUS = 500 as const;

/** Does this value satisfy `findOne`'s declared `Record<string, any> | null`? */
export function isFindOneResultShape(value: unknown): boolean {
  return value === null || isRecordShape(value);
}

/**
 * The ADR-0112 envelope `findOne()` raises when its `afterFind` dispatch left
 * `hookContext.result` outside `Record<string, any> | null`.
 *
 * Thrown at the seam — immediately after `triggerHooks('afterFind', …)` and
 * BEFORE `maskSecretFields` / `stripSearchCompanionFromRead`, both of which
 * already assume a record or a nullish value — so the diagnosis names the
 * handler that did it rather than surfacing as a `TypeError` at a call site
 * that trusted the declaration.
 */
export class FindOneHookResultNotRecordError extends Error {
  override readonly name = 'FindOneHookResultNotRecordError';
  readonly code = FIND_ONE_HOOK_RESULT_NOT_RECORD_CODE;
  readonly status = FIND_ONE_HOOK_RESULT_NOT_RECORD_STATUS;
  /** The object being read. */
  readonly object: string;
  /** The hook event whose dispatch the replacement was observed after. */
  readonly event: string;
  /** What the handler left behind — {@link describeHookResult}. */
  readonly observed: string;
  /** The remedy half, addressed to the hook's author rather than to a user. */
  readonly developerMessage: string;

  constructor(info: { object: string; event: string; result: unknown }) {
    const observed = describeHookResult(info.result);
    super(refusalSentence(info.object, info.event, observed, 'findOne', 'a record or null'));
    this.object = info.object;
    this.event = info.event;
    this.observed = observed;
    this.developerMessage =
      `'findOne()' declares 'Promise<Record<string, any> | null>' — the ONE record the query ` +
      `selects, or 'null' — and its callers branch on 'if (!row)' rather than on a container ` +
      `check. TWO things can put another shape here: a '${info.event}' handler that assigned ` +
      `one, or a driver whose 'findOne' answered off its own contract ` +
      `('Promise<Record<string, unknown> | null>'). A '${info.event}' handler may SHAPE that ` +
      `record: mutate it in place, drop keys, ` +
      `or assign a different RECORD built from it. Replacing it with something that is neither ` +
      `a record nor 'null' is refused. To answer no record, assign 'null'. To REFUSE the read, ` +
      `throw from the handler — that is the supported way for a '${info.event}' guard to say no. ` +
      `To hand the caller a different structure, do it in the caller, not in the hook. Branch on ` +
      `\`code === '${FIND_ONE_HOOK_RESULT_NOT_RECORD_CODE}'\` (ADR-0112) to detect this.`;
  }
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

/** The wire code, registered in the spec's `ERROR_CODE_LEDGER`. */
export const UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE = 'UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE' as const;

/** `500` — a server-side handler broke a server-side contract. */
export const UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE_STATUS = 500 as const;

/**
 * Does this value satisfy `update`'s declared
 * `Record<string, any> | number | null`?
 *
 * `typeof value === 'number'` admits `0` deliberately — "the predicate matched
 * no rows" is an ordinary answer, not a failure.
 */
export function isUpdateResultShape(value: unknown): boolean {
  return value === null || typeof value === 'number' || isRecordShape(value);
}

/**
 * The ADR-0112 envelope `update()` raises when its `afterUpdate` dispatch left
 * `hookContext.result` outside `Record<string, any> | number | null`.
 *
 * Thrown at the seam — after the `afterUpdate` dispatch (including the per-row
 * fan-out) and BEFORE `stripSearchCompanion`, which already assumes it is
 * looking at either a record or a non-object it can skip.
 */
export class UpdateHookResultNotWriteShapeError extends Error {
  override readonly name = 'UpdateHookResultNotWriteShapeError';
  readonly code = UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE;
  readonly status = UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE_STATUS;
  /** The object being written. */
  readonly object: string;
  /** The hook event whose dispatch the replacement was observed after. */
  readonly event: string;
  /** What the handler left behind — {@link describeHookResult}. */
  readonly observed: string;
  /** The remedy half, addressed to the hook's author rather than to a user. */
  readonly developerMessage: string;

  constructor(info: { object: string; event: string; result: unknown }) {
    const observed = describeHookResult(info.result);
    super(refusalSentence(
      info.object, info.event, observed, 'update', 'a record, an affected-row count or null',
    ));
    this.object = info.object;
    this.event = info.event;
    this.observed = observed;
    this.developerMessage =
      `'update()' declares 'Promise<Record<string, any> | number | null>' — the two answers its ` +
      `two dispatch paths give. A BY-ID write resolves the post-write record (or 'null' when the ` +
      `readback leaves the caller's row scope); a PREDICATE write resolves the affected-row COUNT ` +
      // The predicate write's affected-count contract is stated in this module's
      // header; the tracker id stays OUT of the runtime string, which reaches
      // authors, operators and generated surfaces that cannot resolve one.
      `and names no row. TWO things can put another shape here: a '${info.event}' handler that ` +
      `assigned one, or a driver whose 'update' / 'updateMany' answered off its own contract ` +
      `('Promise<Record<string, unknown> | null>' and 'Promise<number>'). A '${info.event}' ` +
      `handler may SHAPE what it is handed — mutate ` +
      `the record in place, drop keys, assign a different RECORD — but replacing it with a shape ` +
      `outside that union is refused, because the declaration is the contract. To REFUSE the ` +
      `write, throw from the handler. Branch on ` +
      `\`code === '${UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE}'\` (ADR-0112) to detect this.`;
  }
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

/** The wire code, registered in the spec's `ERROR_CODE_LEDGER`. */
export const DELETE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE = 'DELETE_HOOK_RESULT_NOT_WRITE_SHAPE' as const;

/** `500` — a server-side handler broke a server-side contract. */
export const DELETE_HOOK_RESULT_NOT_WRITE_SHAPE_STATUS = 500 as const;

/**
 * Does this value satisfy `delete`'s declared `boolean | number`?
 *
 * ⚠️ `false` and `0` are the two most ORDINARY answers here — "the row was not
 * there" and "no rows matched" — so the predicate is a pair of `typeof` tests
 * and never a truthiness check. `metadata-protocol`'s `deleteData` turns the
 * `false` into its 404, and would lose that answer to a lenient guard.
 */
export function isDeleteResultShape(value: unknown): boolean {
  return typeof value === 'boolean' || typeof value === 'number';
}

/**
 * The ADR-0112 envelope `delete()` raises when its `afterDelete` dispatch left
 * `hookContext.result` outside `boolean | number`.
 */
export class DeleteHookResultNotWriteShapeError extends Error {
  override readonly name = 'DeleteHookResultNotWriteShapeError';
  readonly code = DELETE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE;
  readonly status = DELETE_HOOK_RESULT_NOT_WRITE_SHAPE_STATUS;
  /** The object being written. */
  readonly object: string;
  /** The hook event whose dispatch the replacement was observed after. */
  readonly event: string;
  /** What the handler left behind — {@link describeHookResult}. */
  readonly observed: string;
  /** The remedy half, addressed to the hook's author rather than to a user. */
  readonly developerMessage: string;

  constructor(info: { object: string; event: string; result: unknown }) {
    const observed = describeHookResult(info.result);
    super(refusalSentence(
      info.object, info.event, observed, 'delete', 'a boolean or an affected-row count',
    ));
    this.object = info.object;
    this.event = info.event;
    this.observed = observed;
    this.developerMessage =
      `'delete()' declares 'Promise<boolean | number>' — the two answers its two dispatch paths ` +
      `give. A BY-ID delete resolves whether the row was there ('false' is a real answer, and ` +
      // ⛔ The metadata protocol is named without its quoted package specifier
      // on purpose: `core-boundary.ratchet.test.ts` walks `core.ts`'s closure
      // and flags a QUOTED forbidden package name anywhere in a file's text,
      // import or not (ADR-0076 D2), and this module is inside that closure.
      `the metadata protocol layer turns it into a 404); a PREDICATE delete resolves the ` +
      `affected-row COUNT ('0' is a real answer). TWO things can put another shape here: an ` +
      `'${info.event}' handler that assigned one, or a driver whose 'delete' / 'deleteMany' ` +
      `answered off its own contract ('Promise<boolean>' and 'Promise<number>'). An ` +
      `'${info.event}' handler that wants to ` +
      `REFUSE a delete throws from the handler; a delete has no post-state to reshape, so ` +
      `replacing 'ctx.result' with a record or an envelope is refused. Branch on ` +
      `\`code === '${DELETE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE}'\` (ADR-0112) to detect this.`;
  }
}

// ---------------------------------------------------------------------------
// The shared user-facing sentence
// ---------------------------------------------------------------------------

/**
 * The user-facing sentence, one composer for all three refusals.
 *
 * ⚠️ It names the SEAM and never a culprit, and that is a correction to the
 * shape `find()`'s refusal could afford. On `find()` the value at the seam
 * comes from `driver.find`, which every driver answers with an array, so
 * "your handler replaced it" was true whenever the check fired. These three
 * verbs have exits that can answer off-contract themselves — a `driver.update`
 * double resolving `undefined` is the measured case, found by this very guard
 * on four doubles in this repository — so a sentence blaming the handler would
 * misattribute the fault on the most likely path. It states what is there
 * after the dispatch; {@link FindOneHookResultNotRecordError.developerMessage}
 * and its siblings name BOTH sources for the reader who has to go fix one.
 *
 * ⛔ It must not begin with a SQL verb — `@objectstack/rest`'s importer runs row
 * errors through `sanitizeRowError`, whose SQL backstop replaces any message
 * STARTING with `insert`/`update`/`delete` with generic text. That constraint
 * bites here harder than it did on `find()`: two of these three refusals are
 * ABOUT `update` and `delete`, so a sentence naming the verb first would be
 * silently rewritten on exactly the path a REST caller reads. `Refusing the …`
 * keeps the verb out of first position, the same shape
 * `FindHookResultNotArrayError`, `DuplicateRecordError` and
 * `MultiUpdateHookKeyDivergenceError` all record.
 */
function refusalSentence(
  object: string,
  event: string,
  observed: string,
  verb: string,
  declared: string,
): string {
  // `undefined` / `null` name themselves; everything else takes an article, and
  // `object` is the one that needs `an`.
  const what =
    observed === 'undefined' || observed === 'null'
      ? observed
      : `${'aeiou'.includes(observed[0]) ? 'an' : 'a'} ${observed}`;
  return (
    `Refusing the '${verb}' on '${object}': after the '${event}' dispatch 'ctx.result' is ` +
    `${what}, and '${verb}()' answers ${declared}. Shaping what it answers is supported; ` +
    `replacing it with another shape is not.`
  );
}
