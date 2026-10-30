// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ErrorCode, type FlowInnerRefusal } from '@objectstack/spec/api';
import type { AutomationResult } from '@objectstack/spec/contracts';
import {
    declaredUserMessage,
    isEngineDuplicateRecordEnvelope,
    resolveThrownHttpError,
    structuredCodeAnswer,
} from '@objectstack/types';

/**
 * The refusal a flow node's data call met, carried STRUCTURALLY from the node
 * to the run's result (ruling B′ on #24914, the maintainer's 「同意」, decision
 * batch #379 item 5; the contract half is #24996).
 *
 * ## The defect this closes
 *
 * A record save the platform refuses — a duplicate, a validation rule, a
 * permission, an app hook's refusal — reaches a record form as a structured
 * envelope: `code`, `message`, and the producer-marked `userMessage`. The same
 * refusal met by a flow's data node was flattened into ONE string at three
 * hops: the node's catch kept the message alone (`create_record(OBJECT)
 * failed: …`), the engine prefixed the node id (`Node 'ID' failed: …`), and
 * each flow door served that string as the `FLOW_FAILED` message. A flow
 * runner had nothing structured left to render, so an end user read developer
 * prose naming a node id and an object API name.
 *
 * Both members are DECLARED on `AutomationResult` (`userMessage`,
 * `innerRefusal`) and on every door's `FLOW_FAILED` details
 * (`FlowFailureDetailsSchema`, `@objectstack/spec/api`); this module is the
 * producer side of that declaration, and nothing here moves the diagnostic
 * text: the node's `error`, the engine's prefix, the stored run and every
 * door's `message` keep their wording byte for byte.
 */
export interface CarriedRefusal {
    /**
     * The producer-marked END-USER text, verbatim — present exactly when the
     * thrown value declared one, read through `declaredUserMessage`
     * (`@objectstack/types`), the one read every boundary applies. Absent for
     * everything unmarked, so a runner keeps its own substitution there.
     */
    userMessage?: string;
    /**
     * `{ code, message }` — `code` in its WIRE spelling, the ADR-0112 member a
     * record save of the same write answers in `error.code`; `message` the
     * refusal's own text, without the node and operation prefixes. Present only
     * when the thrown value is a REFUSAL (see {@link refusalCarriedBy}).
     */
    innerRefusal?: FlowInnerRefusal;
}

/**
 * Read what a CAUGHT data-call error carries for the run's caller — the one
 * call each data node's catch arm makes (`builtin/crud-nodes.ts`), so the four
 * arms cannot drift on what counts as a refusal or how its code is spelled.
 *
 * ## What counts as a refusal
 *
 * The rule `resolveThrownHttpError` (`@objectstack/types`) already states for
 * every HTTP door: a throw that DECLARES its own HTTP answer is a refusal, a
 * throw that declares none is a fault. `declaredStatus` is that declaration
 * (`.status`, `.statusCode`, or the 400 the validation shape declares), and
 * only a 4xx one counts here: the caller asked for a write the platform will
 * not do (`DuplicateRecordError` 409, `ValidationError` 400,
 * `PermissionDeniedError` 403, an app hook's declared refusal). An undeclared
 * throw (a driver crash, an unreachable store) and a declared 5xx (a service
 * reporting itself unavailable) carry no `innerRefusal`: the spec says the
 * member is absent on every failure that met no refusal, and ⛔ it is never
 * synthesised from message text.
 *
 * ## Which code
 *
 * The code the data door's `errorFromThrown` (`runtime/src/http-dispatcher.ts`)
 * answers for the same throw, decided the same way: the resolver's code (a
 * registered `.code`, `VALIDATION_FAILED` for the validation shape, else the
 * standard member the status derives — so an app hook's unregistered spelling
 * becomes the member its status names, as `error.code` does on that door),
 * except the engine's unique-constraint envelope, which crosses every boundary
 * as the one ruled wire spelling (the 2026-09-03 ruling, commit 65846bc46).
 * That spelling is read off the shared classification's arm
 * (`structuredCodeAnswer`), never written here, and the in-flow `$error.code`
 * keeps the engine's in-process `DUPLICATE_RECORD` (the `create_record` arm's
 * own `code`, untouched).
 */
export function refusalCarriedBy(err: unknown): CarriedRefusal {
    const userMessage = declaredUserMessage(err);
    const thrown = resolveThrownHttpError(err);
    const declared = thrown.declaredStatus;
    const isRefusal = declared !== undefined && declared >= 400 && declared < 500;
    let innerRefusal: FlowInnerRefusal | undefined;
    if (isRefusal) {
        const armCode = isEngineDuplicateRecordEnvelope(err) ? structuredCodeAnswer(err)?.body.code : undefined;
        const wireCode = typeof armCode === 'string' && ErrorCode.safeParse(armCode).success
            ? (armCode as ErrorCode)
            : thrown.code;
        innerRefusal = { code: wireCode, message: thrown.message };
    }
    return {
        ...(userMessage !== undefined ? { userMessage } : {}),
        ...(innerRefusal !== undefined ? { innerRefusal } : {}),
    };
}

/**
 * The "this thrown node failure carries a structured refusal" brand — the
 * engine's half of the carriage, between a node's returned failure and the
 * run's terminal exit.
 *
 * The engine turns a node's returned failure into a THROW
 * (`Node 'ID' failed: …`) that unwinds through every enclosing frame to
 * `execute()`, `resumeInternal()` or `executeWithoutRetry()`. The structured
 * members ride that throw as a non-enumerable symbol-keyed brand — the idiom
 * `partial-steps.ts` and `guard-refusal.ts` already use on the same throw
 * path — so nothing about the error changes: same identity, same `message`,
 * same `instanceof`. A `loop` or `parallel` frame the failure travels out
 * through rethrows the SAME object, so the brand reaches the terminal exit
 * unchanged.
 *
 * A container that runs a CHILD flow and re-words its failure into a NEW
 * returned failure of its own — `subflow`, and `map` for its failing item —
 * carries the child run's members onto that returned failure
 * (`carriedRefusalOfResult(child)`), so the engine brands its throw like any
 * data node's and the refusal reaches the top run however deep it was met.
 * The child's result is the only source: a child that met no refusal spreads
 * `{}`, and a `map` stops at its first failing item, so it carries that
 * item's.
 *
 * The other carriers (#27743), each measured at `execute` / `resume`:
 *
 *  - A `try_catch` with NO catch region re-words its try region's failure into
 *    a new returned failure too, and carries the members its LAST failed
 *    attempt's throw carried (`readCarriedRefusal`), so a retry ladder reports
 *    the last attempt's refusal and never an earlier one's.
 *  - A `subflow` child that PAUSED and then fails on resume, resumed at the
 *    parent's run id (the delegated leg in `run-resume.ts`): the parent's
 *    re-worded failure carries the child's result's members
 *    (`carriedRefusalOfResult(childRes)`), through every delegated frame.
 *  - Resumed at the CHILD's run id instead (the up-bubble leg, and the only
 *    leg a `map` item takes), the caller already holds the child's own
 *    terminal result, which carries the members; the ancestors that leg fails
 *    record no member, and no caller reads their result.
 *
 * Not a carrier: a `try_catch` whose CATCH region itself fails builds its
 * failure from the handler's error and carries no member; the run's result
 * then carries none, which the spec's "present only when a refusal was met"
 * allows and which never invents one.
 */
export const CARRIED_REFUSAL: unique symbol = Symbol.for(
    'objectstack.automation.carriedRefusal',
) as never;

/**
 * Brand `err` with the members a node's returned failure carried. A failure
 * that carried neither leaves `err` unbranded, so a reader cannot tell it from
 * any other throw — which is the honest answer.
 */
export function attachCarriedRefusal<E extends object>(err: E, carried: CarriedRefusal): E {
    const value = pickCarried(carried);
    if (value.userMessage === undefined && value.innerRefusal === undefined) return err;
    Object.defineProperty(err, CARRIED_REFUSAL, {
        value,
        enumerable: false,
        configurable: true,
        writable: true,
    });
    return err;
}

/**
 * The members a thrown failure carries, ready to spread onto an
 * `AutomationResult` — `{}` when it carries none, so a terminal exit spreads
 * nothing for every throw that met no refusal.
 */
export function readCarriedRefusal(err: unknown): CarriedRefusal {
    if (!err || typeof err !== 'object') return {};
    const value = (err as Record<PropertyKey, unknown>)[CARRIED_REFUSAL];
    return value && typeof value === 'object' ? pickCarried(value as CarriedRefusal) : {};
}

/**
 * The members an attempt's RESULT carries — for `retryExecution`, whose
 * exhausted exit reports the last attempt's failure and must report that
 * attempt's refusal beside it, never an earlier attempt's — for the
 * `subflow` / `map` failure arms, which carry their child run's refusal onto
 * the failure they return, and for the delegated resume leg, which carries a
 * paused-then-failed child's refusal onto the parent's.
 */
export function carriedRefusalOfResult(result: AutomationResult): CarriedRefusal {
    return pickCarried(result);
}

function pickCarried(source: CarriedRefusal): CarriedRefusal {
    return {
        ...(typeof source.userMessage === 'string' ? { userMessage: source.userMessage } : {}),
        ...(source.innerRefusal !== undefined ? { innerRefusal: source.innerRefusal } : {}),
    };
}
