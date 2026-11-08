// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31271] The `/api/v1/actions` door's answer to a value an action threw: ONE
 * reader, beside {@link mapDataError} (the `/api/v1/data` door's), so every
 * face that runs an action answers a throw as that door does instead of
 * re-deriving it.
 *
 * The door (`handleActionsRequest` in `@objectstack/runtime`) used to compose
 * this answer inline in its catch, and the MCP `run_action` / `resume_run`
 * tools (`@objectstack/mcp`), which run the same actions, could not reach it:
 * they answered a sandboxed body's undeclared abort with the runner's
 * `KIND 'NAME' threw: …` wrapper naming the body, where the door answers
 * `400 HOOK_ABORTED` with the inner sentence. Both now read this function, so
 * the two cannot drift apart on a throw.
 *
 * The arms, in the order the door has always asked them. Each arm below
 * carries the reasons and history it carried in the door's catch, moved here
 * with it ("this door" in them is `/actions`):
 *
 *  1. The client sentence is {@link sandboxBusinessMessage}'s read, the ONE
 *     read `/data` makes; the full wrapper becomes an operator line.
 *  2. A sandboxed body that CRASHED (its `innerMessage` is native error text)
 *     is a fault: `500`, {@link INTERNAL_ERROR_MESSAGE}, whatever it declared.
 *  3. A throw that names its own `status` / `statusCode` is served with it,
 *     through {@link resolveThrownHttpError} at a `500` fallback.
 *  4. A driver's NOT NULL refusal answers {@link driverNotNullRefusalAnswer}'s
 *     arm, the one `/data` answers.
 *  5. An unexpected fault (a non-`Error` name, no sandbox mark, no code, no
 *     fields, not a validation failure) is the sanitised `500`.
 *  6. [#31317] A status-less throw whose `.code` is not a closed ADR-0112 code
 *     (a driver's `SQLITE_BUSY`, `ECONNREFUSED`) answers the `/data` door's
 *     fault when that door reads it as one ({@link mapDataError}).
 *  7. Everything else is a rejection: {@link resolveThrownHttpError} at a `400`
 *     fallback, so an undeclared sandboxed abort is `HOOK_ABORTED` and a bare
 *     `Error` is `VALIDATION_ERROR` with its own sentence.
 *
 * Arms 3 and 7 answer the way the runtime dispatcher answers a thrown value
 * (`HttpDispatcher.errorFromThrown`), through the one composition both read,
 * {@link thrownAnswerOf} (#31319): the resolver's closed `code`, the
 * engine's unique-constraint class at its wire spelling with the REST arm's
 * context ({@link structuredCodeAnswer}), the demoted spelling as
 * `declaredCode` ({@link demotedDeclaredCode}), a declared `userMessage`, and a
 * leaky 5xx sentence withheld ({@link looksLikeInternalErrorLeak}).
 *
 * ⛔ The one side effect is the door's own, moved here unchanged: when the
 * client sentence differs from `.message`, `.message` is rewritten to it
 * (ignored on a frozen error), because every arm below reads `.message` and
 * the door has always handed them the client-safe text.
 */

import { standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import { driverNotNullRefusalAnswer, isEngineDuplicateRecordEnvelope, mapDataError, structuredCodeAnswer } from './data-error-classification.js';
import { INTERNAL_ERROR_MESSAGE, looksLikeInternalErrorLeak } from './error-leak.js';
import { isNativeErrorName } from './native-error-name.js';
import { isServerFault } from './server-fault-log.js';
import { sandboxBusinessMessage } from './sandbox-business-message.js';
import { demotedDeclaredCode, resolveThrownHttpError } from './thrown-http-error.js';
import { validationFailureDetails } from './validation-failure.js';

/** What the `/actions` door answers a thrown value with. See {@link actionsDoorAnswerOf}. */
export interface ActionsDoorAnswer {
  /** The HTTP status. */
  status: number;
  /** The closed ADR-0112 code the door serves as `error.code`. */
  code: string;
  /** The client-addressed sentence: never the sandbox wrapper, never a leaky 5xx text. */
  message: string;
  /** A producer's unregistered code, demoted off `code` (`ApiErrorSchema.declaredCode`). */
  declaredCode?: string;
  /** The user-facing text the throw declared (`ApiErrorSchema.userMessage`). */
  userMessage?: string;
  /** Structured context: `fields`, `issues`, a non-string driver `code`, the unique arm's context. */
  details?: Record<string, unknown>;
  /**
   * The lines the door prints for the operator, in order, without the door's
   * own prefix: the full sandbox wrapper when the client sentence dropped it,
   * and the fault line when the answer is a fault. Empty when nothing is
   * logged.
   */
  operatorLines: readonly string[];
}

/**
 * [#31319] The runtime dispatcher's answer to a thrown value at a fallback
 * status: {@link actionsDoorAnswerOf}'s arms 3 and 7, and every other
 * dispatcher domain's exit (`HttpDispatcher.errorFromThrown` in
 * `@objectstack/runtime`, through `deps.errorFromThrown`). See
 * {@link thrownAnswerOf}.
 */
export type ThrownAnswer = Omit<ActionsDoorAnswer, 'operatorLines'>;

/**
 * The `/api/v1/actions` door's answer to `err`, thrown while running an action
 * on `objectName` (when the caller named one). See the module note for the arms.
 */
export function actionsDoorAnswerOf(err: unknown, objectName?: string): ActionsDoorAnswer {
  const e = err as any;
  const full: string = e?.message ?? String(err);
  const inner: unknown = e?.innerMessage;
  // The sandbox wraps a user throw as `<kind> '<name>' threw: <msg>` for
  // server logs; surface only the business `<msg>` to the client so an
  // action's error toast reads as plain text instead of leaking the debug
  // prefix. Keep the full wrapper in the log for debugging.
  //
  // [#22588] Read through `sandboxBusinessMessage` — the ONE read `/data`,
  // the bulk doors and `/analytics/dataset/query` make — rather than a
  // local `innerMessage` read. The local copy differed in one case only:
  // a CRASH, whose native-error text it rewrote onto `err.message` before
  // the crash terminal below answered the sanitised 500 anyway; the shared
  // read declines a crash, so the wire answer is unchanged and the log
  // keeps the full wrapper. `inner` stays the raw field: the crash and
  // unexpected-fault predicates below ask about its presence, not its
  // classification.
  const clientMsg = sandboxBusinessMessage(e) ?? full;
  const operatorLines: string[] = [];
  if (clientMsg !== full) {
    operatorLines.push(full);
    // Every exit below reads `.message`; hand it the client-safe text so
    // the debug wrapper stays in the log and off the wire.
    try { e.message = clientMsg; } catch { /* frozen error */ }
  }

  // Arm 2: a sandboxed body that crashed.
  //
  // [#17273] A sandboxed body that CRASHED is a fault before it is
  // anything else — asked FIRST, above every branch that reads a
  // producer declaration as intent.
  //
  // Two of those branches used to answer a crash, and neither was
  // reading a statement the author made about a failure they handled:
  //
  //   - the declared-status branch below serves `err.status`, which the
  //     sandbox lifts off whatever error crossed out of the VM (#7867,
  //     `SandboxError.status`), so a crash could be served at a 4xx;
  //   - `unexpectedFault` further down requires `!inner`, i.e. it reads
  //     the PRESENCE of `innerMessage` as "user code threw this
  //     deliberately". For a crash the runner sets `innerMessage` to the
  //     native error text (`sandbox/quickjs-runner.ts`), so the mark that
  //     means "deliberate" is set by the very case that is not — and the
  //     crash fell to the 400 terminal at the bottom carrying
  //     `TypeError: …` as its client-facing message, `err.message`
  //     having been rewritten to the inner text above.
  //
  // That answer contradicted this route's own published catalog row
  // (`content/docs/api/error-catalog.mdx`, Action Errors: a `TypeError` /
  // `ReferenceError` / a driver's own class "is a crash (500)") and the
  // header of the door's own file (`@objectstack/runtime`'s
  // `domains/actions.ts`: `did it reject or crash? … crash → 500`).
  //
  // The rule is commit cf6e0a193's, ruled on the `/data` door and quoted there
  // rather than restated: *"A declared code is the author's statement
  // about the failure mode they **handled**. A crash … is not that mode,
  // so it is classified as a fault"*. This is the same terminal at the
  // door `mapDataError` does not decide, which is what #17273 is.
  //
  // The wire answer is the sanitised one, not `errorFromThrown`: that
  // helper relays `err.message`, and `looksLikeInternalErrorLeak` reads
  // FALSE for `TypeError: x is not a function` (it recognises driver
  // dumps, not stack-shaped prose), so routing a crash through it would
  // have moved the status and left the leak. The full wrapper still
  // reaches the operator through the operator line below — the same "the client does
  // not read it, the log keeps it" split #5437 draws in `rest`.
  //
  // ⛔ The predicate is a READ of the field the sandbox populated plus
  // the shared name list, never a pattern-strip of the wrapper off
  // `.message`.
  if (typeof inner === 'string' && inner.length > 0 && isNativeErrorName(inner.trim())) {
    operatorLines.push(`sandboxed body crashed: ${full}`);
    return faultAnswer(operatorLines);
  }

  // Arm 3: a throw that names its own status.
  //
  // An error that NAMES its own HTTP status is asking to be served with
  // it — a plugin's `FORBIDDEN` (status 403), a domain error from the
  // protocol layer. Honour that first: burying an explicit 403 in a 200
  // payload discards the one thing the thrower was unambiguous about.
  // Safe against #3937's cases by construction — a record
  // `ValidationError` deliberately carries no `.status` (see
  // `validation-failure.ts`), so it never reaches this branch.
  if (typeof e?.status === 'number' || typeof e?.statusCode === 'number') {
    return thrownAnswer(err, 500, operatorLines);
  }

  // Arm 4: a driver's NOT NULL refusal.
  //
  // [#26031] A driver's NOT NULL refusal that the engine let out (a
  // column no field declares, i.e. drift) is the caller's write refused,
  // and `RestServer` answers it `400 VALIDATION_FAILED` with the column's
  // `required` entry and the drift hint. This door relayed it through the
  // terminal below instead: the driver's text as the message (the
  // physical table and column), the status-derived `VALIDATION_ERROR`,
  // and the driver's code as `declaredCode`. The body is now the
  // classification's own NOT NULL arm (`driverNotNullRefusalAnswer`),
  // the one the dispatcher's `/data` exit answers too, in this
  // transport's envelope; nothing here reads the driver's text. Asked
  // before the fault predicate so a driver class with no string `code`
  // is still the refusal it is, never the sanitised 500.
  const notNull = driverNotNullRefusalAnswer(err, objectName);
  if (notNull) {
    const { error: sentence, code, ...rest } = notNull.body;
    const promoted = code === undefined || (typeof code === 'string' && code !== '');
    const details = promoted ? rest : { ...rest, code };
    return {
      status: notNull.status,
      code: promoted && typeof code === 'string' ? code : standardErrorCodeForHttpStatus(notNull.status),
      message: String(sentence),
      ...(Object.keys(details).length > 0 ? { details } : {}),
      operatorLines,
    };
  }

  // Arm 5: an unexpected fault.
  //
  // [#3913 follow-up] …and it does not cover an UNEXPECTED FAULT either.
  // "A failed action is a normal outcome" is a statement about the action
  // REJECTING — a business rule saying no. A `TypeError` in a handler, a
  // driver that blew up: those are not outcomes the action chose to
  // report, they are the server failing to produce one. Reporting them as
  // 200 makes them invisible to every layer that exists to catch server
  // faults — gateway error rates, retry/circuit-breaker policy, APM
  // auto-capture, alerting — so "customer action bodies are throwing" has
  // no signal short of body-parsing at every hop.
  //
  // Told apart by the error's NAME, the same signal `@objectstack/rest`
  // uses on this exact distinction. [#7543] That citation used to quote
  // rest's comment for the EVIDENCE while the two exits drew opposite
  // conclusions from it: rest read a non-default name as "a genuine script
  // bug" and then shipped it to the client as a 400 anyway. It no longer
  // does — `mapDataError`'s `isScriptFaultMessage` now answers the
  // sanitised `500 INTERNAL_ERROR` this branch has answered since #3913,
  // so the two exits agree on the reading as well as the signal:
  //
  //   name === 'Error'        a deliberate `throw new Error(msg)` — the
  //                           shape a registered handler uses to reject.
  //   innerMessage present    the sandbox's mark for "user code threw
  //                           this deliberately" (SandboxError). [#17273]
  //                           True only of a REFUSAL now: a crash sets
  //                           the same mark and is taken by the terminal
  //                           above before this predicate is reached.
  //   code / fields present   a structured domain failure — the
  //                           ValidationError shape #3937 carries out.
  //   a ValidationError       matched by `validationFailureDetails`, the
  //                           same predicate the dispatcher's error exits
  //                           use, so one whose `fields` were stripped in
  //                           transit is still recognised by NAME alone.
  //   name absent             an unrecognisable throw; treated as a
  //                           rejection (the caller-fault reading), not
  //                           a server fault.
  //   any other name          TypeError / ReferenceError / SqliteError /
  //                           a driver's own class ⇒ a fault.
  //
  // `errorFromThrown` is the same exit every other domain catch has used
  // since #3925, and an error carrying its own `.status` still wins there
  // so a hand-thrown 4xx keeps it.
  const name: unknown = e?.name;
  const code: unknown = e?.code;
  const unexpectedFault =
    typeof name === 'string'
    && name !== 'Error'
    && !(typeof inner === 'string' && inner)
    && !(typeof code === 'string' && code)
    && !Array.isArray(e?.fields)
    && !validationFailureDetails(err);
  if (unexpectedFault) {
    operatorLines.push(`unexpected fault (${name}): ${full}`);
    // [#18540] This branch is this door's UNCLASSIFIED-FAULT TERMINAL, so
    // it answers the terminal's envelope — `INTERNAL_ERROR_MESSAGE`, the
    // same sentence `/data` answers — instead of relaying `err.message`.
    //
    // The status was already right; what leaked was the SENTENCE. A
    // non-sandboxed crash — a plain `TypeError` from an in-process
    // registered handler — reached the wire as `500 INTERNAL_ERROR`
    // carrying `Cannot read properties of undefined (reading 'id')`
    // verbatim, while the IDENTICAL throw through the `/data` door
    // answered `Internal server error`.
    //
    // Why neither existing guard caught it, both measured on this tree:
    //
    //   - #17273's crash terminal above is keyed on the SANDBOX
    //     (`isNativeErrorName` over the `innerMessage` the QuickJS runner
    //     fills). This face never crosses a VM boundary, so nothing sets
    //     `innerMessage` and that terminal never fires. A predicate that
    //     classifies by HOW a crash arrived is structurally blind to
    //     crashes that did not arrive that way — while looking exhaustive.
    //   - `errorFromThrown` relays `err.message` through the dispatcher's
    //     5xx withhold, which is gated on `looksLikeInternalErrorLeak` —
    //     a DRIVER-DUMP heuristic that reads FALSE for stack-shaped prose
    //     (#17273's changeset records the same reading). So that relay is
    //     DEFAULT-ALLOW: prose ships unless the heuristic recognises it.
    //
    // `/data` is default-DENY by construction: `classifyDataError` ends
    // in an unconditional `UNCLASSIFIED_FAULT()`, and its
    // `looksLikeInternalErrorLeak` limb only chooses `DATABASE_ERROR`
    // over `INTERNAL_ERROR` — that limb is not what sanitises. Aligning
    // therefore means answering the terminal here too, ⛔ never teaching
    // the heuristic a new phrasing: re-pointing `looksLikeInternalErrorLeak`
    // at stack-shaped prose would change what every OTHER boundary
    // withholds, and it guards a different question.
    //
    // Nothing about the ANSWER moves but the sentence. Reaching here
    // already proves `.status`/`.statusCode` are absent (the branch above
    // serves them) and that this is not a `ValidationError`, so
    // `resolveThrownHttpError` had no declared status either: its `status`
    // was the 500 fallback and its `code` was
    // `standardErrorCodeForHttpStatus(500)` — `INTERNAL_ERROR`, the code
    // this exit emits. Same status, same code, same envelope shape.
    //
    // ⛔ Deliberately the SAME fault answer #17273's terminal gives
    // ({@link faultAnswer}), never a widened one: a fault's `userMessage` and its non-string
    // `details.code` (a driver errno — the backend-naming disclosure
    // `demotedDeclaredCode` already withholds on an undeclared 5xx) do not
    // ride this exit, exactly as they do not ride `/data`'s.
    //
    // The words are not lost: the operator line above keeps the full
    // text — the same "the client does not read it, the log keeps it"
    // split #5437 draws in `rest`.
    return faultAnswer(operatorLines);
  }

  // Arm 6: a driver's own string code.
  //
  // [#31317] Arm 5 reads a string `code` as "a structured domain failure",
  // and so did the rejection below: a driver error carrying its errno
  // (`SQLITE_BUSY`, `ECONNREFUSED`, `57P01`) answered `400 VALIDATION_ERROR`
  // with the errno in `declaredCode`, a client refusal naming the backend,
  // where `/data` answers the same throw `500 DATABASE_ERROR`. Since #31271
  // the MCP `run_action` / `resume_run` tools answered it so too.
  //
  // Which throws: `demotedDeclaredCode` at the rejection's `400` reading,
  // the read that put the errno on this door's wire. It is present exactly
  // when the throw spelled a code that is not a closed ADR-0112 code, and
  // arm 3 above has already taken every throw that declared a status. A
  // closed code (`RECORD_LOCKED`, `PERMISSION_DENIED`) is not demoted, so
  // it stays the rejection it was: the author's refusal, in the vocabulary.
  //
  // What answers: the `/data` door's own classifier, `mapDataError`, never
  // a copy of its reading. A driver errno and an app's own spelling both
  // arrive on `.code` as a plain string, and nothing here looks at the
  // string (the #12509 ruling: the discriminator is the status channel). So
  // an unregistered code with no status moves exactly when `/data` answers
  // it as a server fault, and a sandboxed body's coded refusal, which
  // `/data` answers `400`, keeps the rejection below. The cost is the
  // ruling's own, stated there: a producer that spells an unregistered code
  // and declares no status loses the code on a fault; it keeps it by
  // declaring the status it means.
  //
  // The answer is that door's status, code and sentence (`Internal data
  // error`, `Internal server error`), with nothing the throw carried: no
  // `declaredCode` (withheld on an undeclared 5xx, `demotedDeclaredCode`'s
  // own rule), no `details`. The full text reaches the operator.
  if (demotedDeclaredCode(resolveThrownHttpError(err, 400)) !== undefined) {
    const door = mapDataError(err, objectName);
    if (isServerFault(door.status)) {
      operatorLines.push(`driver fault (${String(code)}): ${full}`);
      return {
        status: door.status,
        code: typeof door.body.code === 'string' ? door.body.code : standardErrorCodeForHttpStatus(door.status),
        message: typeof door.body.error === 'string' ? door.body.error : INTERNAL_ERROR_MESSAGE,
        operatorLines,
      };
    }
  }

  // Arm 7: a rejection.
  //
  // [#3962] A deliberate REJECTION is a 400. The 200-with-inner-envelope
  // wire this used to emit was never a designed contract — no ADR or doc
  // specified it, it was the catch block reusing `deps.success()`, and
  // /actions was the only route of 12 that double-wrapped. The platform
  // decision in #3962 classifies it as a bug: failures speak HTTP, same
  // as /data has always done. `errorFromThrown` carries the structured
  // payload #3937 fought for — `VALIDATION_FAILED` + `fields[]` land in
  // `details`, the exact shape @objectstack/client normalizes to
  // `err.code` / `err.fields` (#3927).
  return thrownAnswer(err, 400, operatorLines);
}

function faultAnswer(operatorLines: string[]): ActionsDoorAnswer {
  return { status: 500, code: standardErrorCodeForHttpStatus(500), message: INTERNAL_ERROR_MESSAGE, operatorLines };
}

/** Arms 3 and 7: {@link thrownAnswerOf}, with the door's operator lines. */
function thrownAnswer(err: unknown, fallbackStatus: number, operatorLines: string[]): ActionsDoorAnswer {
  return { ...thrownAnswerOf(err, fallbackStatus), operatorLines };
}

/**
 * [#31319] The ONE composition of the dispatcher's answer to a thrown value at
 * `fallbackStatus`: the status, the closed `code`, the sentence, and the
 * declared siblings, read off {@link resolveThrownHttpError}.
 *
 * Two exits used to compose it term by term: this file's arms 3 and 7 (since
 * #31271), and `HttpDispatcher.errorFromThrown` (`@objectstack/runtime`),
 * which every other dispatcher domain answers a throw through. They agreed,
 * and nothing tied them, so a change to one would have left the other behind.
 * The dispatcher now builds its envelope from this function, so one
 * composition serves every door that answers a thrown value this way.
 *
 *  - `code`: the resolver's closed code, except the engine's unique-constraint
 *    class ({@link isEngineDuplicateRecordEnvelope}: the registered code AND
 *    the class name, never message text), which crosses HTTP as the one ruled
 *    wire spelling read off `RestServer`'s arm ({@link structuredCodeAnswer},
 *    #23686, #23714). A producer that merely speaks `DUPLICATE_RECORD` keeps
 *    its own code.
 *  - `details`: the resolver's (`issues`, `fields`, a non-string `code`), plus
 *    that arm's context (`developerMessage`, `object`, `field`) when the arm
 *    agrees with the envelope's status and code. Disagreeing, it adds nothing.
 *  - `message`: the thrown one, withheld as {@link INTERNAL_ERROR_MESSAGE} on a
 *    5xx that {@link looksLikeInternalErrorLeak} recognises (#3867).
 *  - `declaredCode`: {@link demotedDeclaredCode} (#9106, #12509).
 *  - `userMessage`: the resolver's (`declaredUserMessage`'s rule).
 */
export function thrownAnswerOf(err: unknown, fallbackStatus: number): ThrownAnswer {
  const thrown = resolveThrownHttpError(err, fallbackStatus);
  // The engine's unique-constraint class crosses HTTP as the REST arm's wire
  // spelling, with that arm's context beside it when the arm agrees with the
  // envelope (its status and code), never in place of it.
  const engineDuplicate = isEngineDuplicateRecordEnvelope(err);
  const arm = engineDuplicate ? structuredCodeAnswer(err) : undefined;
  const code = typeof arm?.body.code === 'string' ? arm.body.code : thrown.code;
  const armContext = arm !== undefined && arm.status === thrown.status && arm.body.code === code
    ? Object.fromEntries(Object.entries(arm.body).filter(([key]) => key !== 'error' && key !== 'code'))
    : undefined;
  const details = armContext !== undefined && Object.keys(armContext).length > 0
    ? { ...thrown.details, ...armContext }
    : thrown.details;
  const declaredCode = demotedDeclaredCode(thrown);
  return {
    status: thrown.status,
    code,
    message: thrown.status >= 500 && looksLikeInternalErrorLeak(thrown.message) ? INTERNAL_ERROR_MESSAGE : thrown.message,
    ...(declaredCode !== undefined ? { declaredCode } : {}),
    ...(thrown.userMessage !== undefined ? { userMessage: thrown.userMessage } : {}),
    ...(details !== undefined ? { details } : {}),
  };
}
