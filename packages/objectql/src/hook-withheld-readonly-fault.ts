// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17219] Name the withheld key when a `before*` hook faults reaching THROUGH
 * one — instead of letting the platform's own contract enforcement surface as
 * the author's crash.
 *
 * ## What was measured broken
 *
 * Since #16344 the update path HIDES a caller-supplied static `readonly` value
 * from `before*` hooks (`readonlyHiddenFromHooks`, engine.ts). The hook's view
 * of that key is a plain `undefined`, so a body reaching through it —
 * `ctx.input.locked_meta.who = 'hook'` — throws, and a `body` hook's default
 * `onError: abort` refuses the caller's whole write.
 *
 * ⛔ **The refusal is correct and this module does not touch it.** What it
 * replaced is a write that SUCCEEDED while persisting a value derived from the
 * caller's forgery, and #16344 exists to close exactly that laundering route.
 * The defect is the DIAGNOSTIC. Measured end to end on `origin/main`
 * `501959b72a`, both doors:
 *
 * ```
 * direct  SandboxError: hook 'guard_task_body' threw:
 *           TypeError: cannot set property 'who' of undefined
 * REST    500 {"error":"Internal server error","code":"INTERNAL_ERROR"}
 * ```
 *
 * The REST reading is the WORSE of the two the card allowed for, and it is the
 * door an author actually authors against: `error-response.ts`'s
 * `isScriptFaultMessage` correctly classifies a leading `TypeError:` as a crash
 * (#7543) and sanitises it, so the author is told nothing at all — not which
 * key, not why, not what to read instead. A control in the same measurement
 * fires: a body that throws an authored `Error` still answers 400 with its own
 * words.
 *
 * ## Why the fault has to be explained HERE
 *
 * The knowledge "this key was withheld BY THE PLATFORM because it is
 * `readonly`" exists only in the engine. Downstream nothing can reconstruct it:
 * the sandbox face is a plain JSON snapshot (`unwrapProxyToPlain`, then a JSON
 * marshal), so the key is simply absent, and *absent because the caller sent it
 * and the platform took it away* is indistinguishable there from *absent
 * because nobody sent it*. That distinction is precisely what the card requires
 * the message to state, so the explanation is composed where the hide pass is.
 *
 * ⛔ Not by marshalling `ctx.submitted` onto the sandbox face: that face is
 * assembled key by key, `dispatch.scope` is the standing precedent for the
 * assembly discipline, and the shape was measured and refused on its merits in
 * PR #17195. Nothing here adds a key to any authoring face or to any wire
 * payload.
 *
 * ## The classification this restores
 *
 * The repo already draws a REFUSAL / SCRIPT-FAULT line
 * (`rest-hook-refusal-classification.test.ts`,
 * `rest-hook-script-fault-envelope.test.ts`, `actions-fault-vs-rejection.test.ts`).
 * Mechanically this IS a crash, so the fault channel is not the wrong pipe —
 * what is wrong is the CAUSAL ATTRIBUTION: one of the platform's own contract
 * enforcements is reported to the author as a bug in their code. Naming the
 * withheld key turns an anonymous crash back into a named refusal, which is the
 * side of that line it belongs on.
 *
 * ## What this deliberately does NOT do
 *
 * ⛔ It registers no error code. A dedicated `ERROR_CODE_LEDGER` entry would be
 * a new PUBLISHED member and is a separate, declared decision; the 400 answered
 * here rides the existing "message verbatim, no `code`" channel that a body's
 * own `throw new Error(...)` already uses (measured, `mapDataError`). ⛔ And it
 * does not reuse `ERR_READONLY_FIELD_REJECTED`: that code names the
 * `strictReadonlyWrites` refusal and carries `drops` as part of its contract, so
 * borrowing it would make the error lie about which refusal happened.
 */

import { isNativeErrorName } from '@objectstack/types';

/**
 * Did the hook CRASH, as opposed to deliberately refusing?
 *
 * Two spellings, because a hook reaches this engine by two routes and they
 * carry the native name in different slots:
 *
 *  - a CODE hook throws the real thing, so `err.name` is `'TypeError'`;
 *  - a SANDBOXED body's throw is wrapped by `quickjs-runner.ts` into a
 *    `SandboxError` whose `name` is `'SandboxError'` and whose `innerMessage`
 *    keeps the `TypeError: …` prefix (`userFacingMessage` strips only a leading
 *    `Error: `).
 *
 * A hook that threw an authored `Error` — sandboxed or not — answers `false` on
 * both, which is what keeps this from overwriting a business message that
 * `mapDataError` would otherwise serve to the caller verbatim.
 *
 * ⭐ The NAME LIST behind both spellings is {@link isNativeErrorName}
 * (`@objectstack/types`, #17681) — the one reader `packages/rest`'s
 * `isScriptFaultMessage` and `packages/runtime`'s `sandboxRefusalMessage` also
 * call, with the same deliberate omission of a bare `Error:`. This module used
 * to keep its own copy because the rule lived in `@objectstack/rest` and this
 * package must not depend on rest for a regex; the shared home needs no such
 * edge — `@objectstack/types` was already a dependency. ⛔ Do not re-inline it.
 *
 * The two SLOTS above stay local: which slot carries the name is this engine's
 * own fact, and no other door has to ask both.
 */
function isScriptCrash(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; innerMessage?: unknown };
  if (typeof e.name === 'string' && isNativeErrorName(e.name)) return true;
  return typeof e.innerMessage === 'string' && isNativeErrorName(e.innerMessage.trim());
}

/** Read a message off anything a hook may have thrown, without assuming a shape. */
function messageOf(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown };
    if (typeof e.message === 'string' && e.message) return e.message;
  }
  return String(err);
}

/**
 * A `before*` hook faulted while the engine was withholding caller-supplied
 * read-only values from it.
 *
 * `status` is the whole envelope change and it is deliberate: without it
 * `mapDataError` answers `UNCLASSIFIED_FAULT` — `500 INTERNAL_ERROR`, the
 * sanitised body — and the message composed below never reaches the author at
 * the door they author against. Declaring 400 puts it on the same
 * message-verbatim channel a body's own authored refusal already rides
 * (measured), and 400 is the truthful status: the trigger is a value THE CALLER
 * supplied for a field they may not write.
 *
 * ⛔ No `code`. See the module header — that is a published member and a
 * separate decision.
 */
export class HookWithheldReadonlyFaultError extends Error {
  /** Served by `packages/rest`'s `declaredHttpStatus`. */
  readonly status = 400;
  /** The read-only keys the engine withheld from this hook, in payload order. */
  readonly withheldKeys: readonly string[];
  /**
   * The hook's original throw, whole.
   *
   * DECLARED on the class and assigned by hand rather than passed through the
   * constructor, for the reason `duplicate-record-error.ts` already writes down
   * one file over: this repo compiles against `lib: ES2020`, where `Error` has
   * neither a `cause` member nor an `ErrorOptions` overload to carry one — so
   * the two-argument `super()` does not compile, and an undeclared assignment
   * would be invisible to every TypeScript consumer of the field.
   */
  readonly cause: unknown;
  constructor(message: string, withheldKeys: readonly string[], options?: { cause?: unknown }) {
    super(message);
    this.name = 'HookWithheldReadonlyFaultError';
    this.withheldKeys = withheldKeys;
    this.cause = options?.cause;
  }
}

const fence = (k: string) => `\`${k}\``;

/**
 * Compose the replacement error, or answer `undefined` to leave the original
 * throw exactly as it is.
 *
 * Three conditions, all required, and each one is a way this could otherwise
 * repeat the card's own harm in the opposite direction — a confidently wrong
 * attribution:
 *
 *  1. the engine really did withhold something ON THIS OPERATION. An empty or
 *     absent map means no hide pass ran and there is nothing to explain;
 *  2. the hook CRASHED rather than refused, so an authored business message is
 *     never rewritten;
 *  3. there is at least one named key to report.
 *
 * ⚠️ What it deliberately does NOT claim is CAUSATION. Nothing at this seam can
 * prove the crash was the dereference of a withheld key rather than an
 * unrelated bug in the body, so the sentence is anchored on what IS known —
 * "faulted while these keys were withheld from it" — and the original fault text
 * is carried through verbatim rather than replaced. Asserting a cause we cannot
 * establish would relocate this card's defect instead of fixing it.
 */
export function withheldReadonlyHookFault(
  err: unknown,
  withheld: Record<string, unknown> | undefined,
  event: string,
): HookWithheldReadonlyFaultError | undefined {
  if (!withheld) return undefined;
  const keys = Object.keys(withheld);
  if (keys.length === 0) return undefined;
  if (!isScriptCrash(err)) return undefined;

  const one = keys.length === 1;
  const named = keys.map(fence).join(', ');
  const message =
    `A \`${event}\` hook faulted while ${named} ${one ? 'was' : 'were'} withheld from it. ` +
    `${one ? 'That field is' : 'Those fields are'} \`readonly: true\`, and the engine withholds a ` +
    `caller-supplied value for a read-only field from \`${event}\` hooks, so ` +
    `${keys.map((k) => `\`ctx.input.${k}\``).join(', ')} ` +
    `${one ? 'reads' : 'read'} \`undefined\` — withheld by the platform, not missing by accident. ` +
    `Read the stored ${one ? 'value' : 'values'} from ` +
    `${keys.map((k) => `\`ctx.previous.${k}\``).join(', ')} instead. ` +
    `Original fault: ${messageOf(err)}`;

  return new HookWithheldReadonlyFaultError(message, keys, { cause: err });
}

/**
 * Run a hook dispatch inside the hide window, replacing an anonymous crash with
 * the named refusal above.
 *
 * A thunk rather than a `try`/`catch` written out at each dispatch site: the
 * update path dispatches `before*` hooks from three places between the hide and
 * the hand-back (by-id, unscoped-multi, per-row), and one shared wrapper is what
 * keeps the three from drifting into three different answers — the divergence
 * "both call sites" is the standing shape for in this file's neighbours.
 *
 * ⛔ Rethrows the ORIGINAL error whenever {@link withheldReadonlyHookFault}
 * declines, so every path that does not meet all three conditions is
 * byte-identical to having no wrapper at all.
 */
export async function dispatchHooksExplainingWithheldReadonly<T>(
  withheld: Record<string, unknown> | undefined,
  event: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw withheldReadonlyHookFault(err, withheld, event) ?? err;
  }
}
