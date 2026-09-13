// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17681] The one reader for "does this text name a NATIVE JavaScript error
 * constructor?" — the shared half of the crash-vs-refusal classification every
 * door that runs authored code has to make.
 *
 * ## Why one reader, and why HERE
 *
 * The rule decides whether a sandboxed body's `throw` is a business REFUSAL
 * (4xx, the author's words relayed to the caller) or a CRASH (5xx, the words
 * withheld). It had three copies, each with a written reason for being one:
 *
 *  - `@objectstack/rest`'s `isScriptFaultMessage` (`error-response.ts`, #7543)
 *    — the original;
 *  - `@objectstack/objectql`'s `isScriptCrash`
 *    (`hook-withheld-readonly-fault.ts`) — that package must not take a
 *    dependency on `@objectstack/rest` for a regex;
 *  - `@objectstack/runtime`'s `sandboxRefusalMessage`
 *    (`sandbox/quickjs-runner.ts`, #17265) — `@objectstack/runtime` DOES depend
 *    on `@objectstack/rest`, but that package declares exactly one export
 *    subpath and re-exports nothing from `error-response`.
 *
 * Every one of those reasons is a statement about reaching `@objectstack/rest`,
 * and none of them survives moving the rule here: all three packages already
 * depend on `@objectstack/types`, so this home adds **no dependency edge at
 * all**, and this package depends on none of them, so it cannot cycle.
 *
 * ⚠️ A divergence between copies was never a style problem. One copy learning a
 * new native error name and the others not means the same throw is a refusal at
 * one door and a crash at another — i.e. a crash message LEAKED at one boundary
 * and WITHHELD at the next, which is the door-disagreement shape #7525/#8016
 * keeps producing. #16013's argument for extracting exactly this class applies
 * verbatim: the classification is the part nobody may get wrong, so one tested
 * helper is worth more than N correct copies that must each stay correct
 * forever.
 *
 * ## What this deliberately does NOT own
 *
 * ⛔ The three doors' WRAPPERS. They are not the same shape and folding them
 * would change per-door behaviour, which is the one thing this consolidation
 * may not do: rest asks a trimmed message and answers a boolean; objectql asks
 * TWO slots (`err.name` OR `err.innerMessage`) because a code hook and a
 * sandboxed body carry the native name in different places; runtime asks the
 * trimmed inner message and answers the MESSAGE rather than a boolean. What the
 * three share is this predicate — so this is what moved, and each door keeps
 * its own wrapper where its own reasons are recorded.
 *
 * ⛔ And it is not {@link looksLikeInternalErrorLeak} (`error-leak.ts`), the
 * other message predicate both HTTP doors read. That one asks "is this a driver
 * dump?"; this one asks "did the JS runtime raise this?". Never conflate them.
 */

/**
 * The seven ECMA-262 native error constructors, plus SpiderMonkey's
 * `InternalError` — which QuickJS also raises, for stack exhaustion.
 *
 * **Matched by constructor name, not by phrasing.** A sandbox stringifies a
 * thrown error as `<name>: <message>`, so the name is structural evidence
 * rather than a keyword heuristic over prose. Both limbs are load-bearing: `^`
 * refuses prose that merely quotes `TypeError: …` mid-sentence, and `(?::|$)`
 * refuses a longer identifier that merely starts with a native name.
 *
 * ⛔ `Error:` is deliberately ABSENT, and that omission is what every door
 * depends on: a plain `Error` is the documented way to AUTHOR a refusal, so it
 * is never a crash and its words are never rewritten.
 */
const NATIVE_ERROR_NAME_RE = /^(?:Type|Reference|Range|Syntax|URI|Eval|Internal|Aggregate)Error(?::|$)/;

/**
 * Does `text` name a native JavaScript error constructor?
 *
 * Answers for both slots the callers hold it against: a bare `name`
 * (`'TypeError'` — what a CODE hook's thrown error carries) and the flattened
 * `<name>: <message>` form (`'TypeError: not a function'` — what the sandbox
 * puts in `innerMessage`).
 *
 * ⛔ It does NOT trim, and that is a contract rather than an oversight: the
 * callers disagree about trimming for reasons of their own (a `.name` slot is
 * never padded; a flattened message may be), so the choice stays at the call
 * site and this answers about exactly the text it was given.
 */
export function isNativeErrorName(text: string | undefined | null): boolean {
  if (!text) return false;
  return NATIVE_ERROR_NAME_RE.test(text);
}
