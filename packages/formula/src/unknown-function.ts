// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The **function-existence** verdict, isolated from every other thing
 * `check()` has an opinion about (#13594).
 *
 * `celEngine.compile` already answers "does this source call something that
 * resolves?" — it reads cel-js's `check()` and reports `kind: 'type'` when the
 * answer is no (#1877). That verdict is what `validateExpression` refuses on,
 * and it is the ONE part of the type checker a gate may adopt without adopting
 * the rest: an unresolvable call is a fact about the source, decidable at
 * authoring time, while everything else `check()` complains about on this
 * platform's surfaces is a fact about a `dyn` value it cannot see yet.
 *
 * ## Why a consumer needs this instead of calling `compile` itself
 *
 * cel-js emits ONE message shape for two different faults:
 *
 * ```text
 * totallyBogusFn(1,2)   ->  found no matching overload for 'totallyBogusFn(int, int)'
 * upper(1, 2)           ->  found no matching overload for 'upper(int, int)'
 * ```
 *
 * The first names something the environment does not have. The second names
 * `upper`, which it does have — the call is merely wrong about the argument
 * types, which under `unlistedVariablesAreDyn` is usually a fact about a row
 * rather than about the source. A consumer that refused both would be running
 * the type checker, which is exactly what the ruling below does NOT authorise.
 * Separating them needs the environment's own registration set, and that
 * environment is package-internal (`buildEnv`), so the separation belongs here
 * rather than in every consumer.
 *
 * ## The oracle is the environment, never `CEL_STDLIB_FUNCTIONS`
 *
 * Maintainer ruling on #13594 (director batch #21, 2026-08-31), refinement 1:
 *
 * > 「oracle = 引擎实际注册集(cel-js `check()` 裁定),⛔ 不是 `CEL_STDLIB_FUNCTIONS` 常量。」
 *
 * The exported catalog advertises 35 bare-callable names for authoring; the
 * environment registers **72** (measured — `cel-stdlib-drift.test.ts` re-measures
 * the decomposition on every run). A gate keyed on the catalog would refuse 37
 * names that parse, type-check and evaluate today (`type`, `map`, `filter`,
 * `split`, `getFullYear`, `json`, …). Existence is the environment's answer to
 * give, and it is given here through the same `buildEnv` seam `compile` builds
 * its checker with, so the two can never drift.
 *
 * Both call forms are covered by the one verdict, because cel-js phrases them
 * with one template family: a bare call (`'totallyBogusFn(int, int)'`) and a
 * receiver call (`'dyn.nosuchmethod(string)'`). {@link NO_OVERLOAD_RE} takes the
 * segment immediately before the argument list, after any receiver-type prefix.
 *
 * ## What this deliberately does NOT report
 *
 * Refinement 3 of the same ruling: 「只拒未知函数裁定,⛔ 不搬运 `check()` 的其他抱怨。」
 *
 * - **A registered name called wrongly.** `upper(1, 2)`, and every arity or
 *   argument-type fault on a name the environment has. Registered is registered.
 * - **A registered name called in the wrong POSITION.** `split('a,b')` faults —
 *   `split` is registered receiver-only — but the name exists, so this is a
 *   call-form fault, not an existence one. The membership set is therefore
 *   every registered name, bare-callable and receiver-only alike; narrowing it
 *   to the bare-callable 39 would turn `record.name.split(',')`-shaped authoring
 *   mistakes into existence claims that are false.
 * - **Everything phrased any other way.** `type == 'grid'` is refused as
 *   `no such overload: type == string` and `1 + 'a'` as `no such overload:
 *   int + string`; neither matches the call template, so neither is reported.
 *   That is the CEL-type blind spot staying blind, which is the property
 *   refinement 3 protects.
 *
 * ## Why refusing an unregistered call is not a false positive
 *
 * The validation environment and the runtime environment are the same builder —
 * `celEngine.compile` and `celEngine.evaluate` both call {@link buildEnv}, and
 * the census on #13594 probed 53 names across both with **0 divergent verdicts**
 * (and found **0** host-registered extra functions in the reachable corpus). So
 * a call this refuses is a call that WILL fault at evaluation time; refusing it
 * moves the fault from an invisible runtime moment to the publish gate.
 */

import { buildEnv, celEngine } from './cel-engine';

/**
 * cel-js's unknown-call vocabulary, both of its spellings — a bare call
 * (`` `found no matching overload for 'totallyBogusFn(int, int)'` ``) and a
 * receiver call (`` `…for 'dyn.nosuchmethod(string)'` ``). Both are emitted from
 * one template family in `cel-js/lib/operators.js`, and the name we want is the
 * segment immediately before the argument list, after any receiver-type prefix.
 *
 * Anchored on the closing `)'` so the greedy receiver prefix cannot run past the
 * call into the source excerpt cel-js appends on the following lines.
 *
 * Lives here rather than in `validate.ts` — which reads the same message for its
 * unknown-name hint — so the two readers cannot drift into two answers about
 * which token cel-js was talking about.
 */
const NO_OVERLOAD_RE = /found no matching overload for '(?:.*[.])?([A-Za-z_$][\w$]*)\(.*?\)'/;

/**
 * The called name inside a cel-js `found no matching overload for '…'` message,
 * or `undefined` when the message is not that shape.
 *
 * Says nothing about whether the name exists — that is
 * {@link firstUnknownFunctionCall}'s question, and `validate.ts` asks its own
 * (is the name ADVERTISED?) for a different purpose. This only extracts.
 */
export function callNameFromNoOverload(message: string): string | undefined {
  return NO_OVERLOAD_RE.exec(message)?.[1];
}

/**
 * Every function name the canonical evaluation environment registers — bare
 * callables (`upper(x)`) and receiver-only methods (`s.split(',')`) alike.
 *
 * Read through `getDefinitions()` off {@link buildEnv}, the same constructor
 * `celEngine.compile` and `celEngine.evaluate` use, for the reason
 * `cel-stdlib-drift.test.ts` states about itself: a set rebuilt from a lookalike
 * environment keeps answering after the real one changes underneath it.
 *
 * Memoised because the answer cannot vary — the two arguments `buildEnv` takes
 * (a `now()` closure and a timezone) change what `now()` RETURNS, never which
 * names exist. The clock passed here is the same fixed instant `compile` uses
 * for its own parse-time environment, and is never called.
 */
let registeredNames: ReadonlySet<string> | undefined;

function registeredFunctionNames(): ReadonlySet<string> {
  if (!registeredNames) {
    const env = buildEnv(() => new Date(0)) as unknown as {
      getDefinitions(): { functions: Array<{ name: string }> };
    };
    registeredNames = new Set(env.getDefinitions().functions.map((fn) => fn.name));
  }
  return registeredNames;
}

/** A call to a name the evaluation environment does not register. */
export interface UnknownFunctionCall {
  /** The called name, e.g. `totallyBogusFn` — for a receiver call, the METHOD name. */
  name: string;
  /**
   * The engine's own one-line verdict, quoted rather than paraphrased
   * (`found no matching overload for 'totallyBogusFn(int, int)'`). Consumers
   * report this verbatim so the publish-time wording and the runtime fault read
   * as one system.
   */
  detail: string;
}

/**
 * The first call in `source` naming a function the evaluation environment does
 * not register, or `null` when there is none.
 *
 * `null` is the answer for every other outcome as well — a source that parses
 * and type-checks, one the front end refuses for syntax or size, and one
 * `check()` rejects for any reason that is not an unresolvable call. A caller
 * gets an existence verdict or nothing; it never has to grade a fault itself.
 *
 * Deliberately offers **no suggestion**. Ruling refinement 2:
 * 「不给 `nearestName` 建议。」 — `nearestName('can', <the function set>)`
 * answers `'min'`, a confident jump from a permission verb to a numeric
 * function, and an author who takes it (an LLM author above all, following the
 * last sentence it was handed) is further from working than before it asked.
 */
export function firstUnknownFunctionCall(source: string): UnknownFunctionCall | null {
  if (!source.trim()) return null;
  const compiled = celEngine.compile(source);
  // Parses and type-checks, or was refused for something that is not a call:
  // `parse` (not CEL), `bounds` (too big), `runtime` (never reachable from
  // `compile`). Only the `type` arm can carry the verdict this asks for.
  if (compiled.ok || compiled.error.kind !== 'type') return null;
  const name = callNameFromNoOverload(compiled.error.message);
  // A `type` fault phrased any other way — an operator or ternary mismatch
  // (`no such overload: int + string`). Not an existence question.
  if (!name) return null;
  // Registered, so the fault is about the ARGUMENTS or the call position, not
  // about whether the name exists. Blind spot, deliberately (refinement 3).
  if (registeredFunctionNames().has(name)) return null;
  return { name, detail: compiled.error.message.split('\n')[0].trim() };
}
