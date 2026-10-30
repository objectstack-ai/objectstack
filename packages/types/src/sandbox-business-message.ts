// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27672] The sandbox's REFUSAL-vs-CRASH read, in a module of its own so
 * `resolveThrownHttpError` (`thrown-http-error.ts`) can ask it.
 *
 * Moved here verbatim from `data-error-classification.ts`, which imports
 * `thrown-http-error.ts`: the resolver could not import the read back from
 * there without a cycle. `data-error-classification.ts` re-exports
 * {@link sandboxBusinessMessage}, so the package's public names are unchanged,
 * and {@link isScriptFaultMessage} stays off the package entry as before.
 */

import { isNativeErrorName } from './native-error-name.js';

/**
 * [#7543] Does an unwrapped sandbox message name a JS RUNTIME fault rather than
 * a business refusal the hook body deliberately reported?
 *
 * The two sandbox-unwrap branches in `data-error-classification.ts` exist for ONE shape: a hook or action
 * body that runs `throw new Error('删除被阻断：仍有未结清的发票')`, i.e. an
 * author writing a business rule whose message IS the remedy. They answer 400
 * with that message verbatim and deliberately no `code` (see each branch).
 *
 * A body that instead CRASHES — `ctx.input.title.trim()` where `title` is the
 * number `12345` — also arrives as a thrown error, so it entered the same
 * branch and its raw `TypeError: not a function` went out as the client-facing
 * message of a 400 with no `code`. That is two contract breaks at once: an
 * internal runtime fault echoed verbatim, and a body outside the ledgered
 * envelope (a client keying on `code` gets nothing).
 *
 * The classification this restores is NOT new policy — it is the ruling
 * {@link UNCLASSIFIED_FAULT} already records one door down, which names this
 * exact case ("or a plain handler bug (`TypeError: x is not a function`) …
 * server faults that a caller cannot fix and a caller SHOULD retry"). The
 * sandbox unwraps simply sit ABOVE that branch and were intercepting the crash
 * before it could reach the answer the file had already settled on. Same
 * separation `quickjs-runner`'s own `sandboxFault` path draws (#4431/#3951):
 * the sandbox REFUSING is a fault, and so is the body FAULTING — only the
 * body's deliberate `throw` is an answer addressed to the caller.
 *
 * **Matched by constructor name, not by phrasing**, and since #17681 by the ONE
 * reader — {@link isNativeErrorName} in `@objectstack/types`, which owns the
 * name list, the `^` anchor and the deliberate absence of a bare `Error:`. This
 * file held the original copy; `@objectstack/objectql` and
 * `@objectstack/runtime` each kept their own because the rule lived HERE and
 * neither could reach it, and all three now read the one helper. ⛔ Do not
 * re-inline the pattern: a name learned at one door and not the others is the
 * same throw answered as a refusal at one boundary and a crash at the next.
 *
 * What stays local is the TRIM — `userFacingMessage` strips a leading `Error: `
 * upstream, so what arrives here may still be padded, and the helper
 * deliberately does not trim for its callers.
 *
 * **Deliberate, accepted cost:** a body that expresses a business rule as
 * `throw new RangeError('数量超出范围')` now gets the sanitised 500 instead of
 * its own words. That authoring style is not the documented one, and erring
 * toward "a native error name means a crash" is the fail-safe direction — the
 * opposite default is what shipped `TypeError: not a function` to a client.
 *
 * The words are not lost: 500 is outside `isExpectedDataStatus`, so
 * `handleRouteError` prints `[REST] Unhandled error` with the whole error, and
 * `sendThrownError`'s `logWithheldServerFault` (#5437) covers the routes that bypass
 * it — the same operator path {@link UNCLASSIFIED_FAULT} relies on.
 */
export function isScriptFaultMessage(message: string): boolean {
    return isNativeErrorName(message.trim());
}

/**
 * [#11588] The caller-addressed BUSINESS text a sandboxed hook/action body
 * threw, or `undefined` when this error is not a sandbox refusal.
 *
 * QuickJS bodies throw a `SandboxError` whose `.message` is the
 * `<kind> '<name>' threw: <msg>` debug wrapper and whose `.innerMessage` is the
 * text the author addressed to the end user (see
 * `runtime/src/sandbox/quickjs-runner.ts`). The wrapper "belongs in server
 * logs" — {@link classifyDataError}'s unwrap door exists precisely to keep it
 * off the wire. This is that door's read, named once so the door ABOVE it in
 * {@link resolveErrorResponse} can ask the same question instead of shipping
 * `error.message` raw.
 *
 * Both conditions are the door's, in the door's order:
 *
 *  - a non-empty string `.innerMessage`, which is what makes this a sandbox
 *    error at all;
 *  - NOT {@link isScriptFaultMessage}. A body that CRASHED arrives with the
 *    same shape, and its `TypeError: not a function` is an internal fault
 *    rather than a business message (#7543). This answers `undefined` there,
 *    so a crash is never mistaken for authored text.
 *
 * ⛔ It is deliberately a READ of a field the sandbox populated, never a
 * pattern-strip of the wrapper off `.message`. Stripping prose by regex would
 * also rewrite a plain error whose own text happens to contain `threw:`, and
 * the caller's message is the remedy on a 4xx (#5423) — the one thing this
 * boundary must not paraphrase. `rest-hook-refusal-message-parity.test.ts` §5
 * is the control that keeps it a read.
 *
 * Exported for the SECOND boundary that has to ask the same question:
 * `/analytics/dataset/query` builds its own `{ code, message }` envelope inline
 * in `rest-server.ts` and shares no branch with either door here. It reads this
 * rather than re-deriving the unwrap, so the analytics face and the `/data`
 * face cannot drift into two answers for one refusal — the door-disagreement
 * shape #7525/#8016 keeps producing when a boundary open-codes the read.
 */
export function sandboxBusinessMessage(error: any): string | undefined {
    if (typeof error?.innerMessage !== 'string' || !error.innerMessage) return undefined;
    if (isScriptFaultMessage(error.innerMessage)) return undefined;
    return error.innerMessage;
}
