// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read a CEL fault the way the AUTHOR needs to read it.
 *
 * Shared by the two surfaces that evaluate a CEL expression "against the
 * record" and reject the write when they cannot: object-level validation
 * predicates (`validation/rule-validator.ts`, #4649) and declarative hook
 * `condition`s (`hook-wrappers.ts`, #4775). Both were told to reuse ONE error
 * shape, and the only durable way to keep two messages worded alike is to stop
 * writing them twice — the same argument that put {@link
 * ./declared-fields.js#materializeDeclaredFields} in front of every server-side
 * evaluator: two when this module was written, THREE since #4953 added the
 * field `readonlyWhen` strips. That third seam is fail-open rather than
 * rejecting, so it reads only {@link unknownVariableOf} (the #4889
 * unbound-root branch) and never {@link describeCelFault}'s rejection
 * sentences.
 *
 * This module has no opinion about what a caller does with a fault. It answers
 * three questions and hands back a sentence:
 *
 *   1. What broke, in one line? (`summary`)
 *   2. Did the expression read a key the record does not carry, and which?
 *      (`missingKey` — after materialisation this can only mean an UNDECLARED
 *      key, i.e. an author typo or a retired field)
 *   3. Did it name a ROOT that is not in scope at all? (`unknownVariable` —
 *      the fault an unbound `previous` produces, which is a different
 *      diagnosis from a missing key on a bound root)
 *   4. Did it compare/order a `null`? (`nullOverload` — the other way a
 *      predicate over a TOTAL record still faults)
 */

/** The `{ kind, message }` failure `@objectstack/formula` resolves. */
export interface CelFault {
  kind: string;
  message: string;
}

/** `No such key: <key>` is cel-js's word for "the expression read something the
 *  record does not carry" — the single most useful fact to put in front of the
 *  author, since after materialisation it can only mean an UNDECLARED key. */
const NO_SUCH_KEY_RE = /No such key:\s*([A-Za-z_$][\w$]*)/;

/**
 * The OTHER way an expression written against a total record still faults: an
 * ordering comparison (`<`, `>`, `<=`, `>=`) or arithmetic over a value that is
 * `null`. CEL has no overload for it, so the whole expression aborts.
 *
 * This one deserves its own sentence because the obvious guard does not work:
 * `has(x)` is TRUE for a declared field holding `null` (CEL asks whether the key
 * is PRESENT, not whether it has a usable value), so `has(a) && has(b) && a < b`
 * still faults the moment either is null — on any driver that returns its NULL
 * columns, which is most of them. Such a rule never enforced anything on those
 * rows; #4649 is what makes that visible instead of silent.
 */
const NULL_OVERLOAD_RE = /no such overload/i;

/**
 * `Unknown variable: <name>` is what cel-js says when a ROOT identifier is not
 * in the scope at all — as opposed to `No such key`, which means the root
 * resolved and the key under it did not.
 *
 * Both evaluators bind exactly two roots, `record` and `previous`, and bind
 * `previous` only when the record's prior state is actually in hand. So this
 * fault has one meaning worth spelling out: the expression asked for a binding
 * that this operation does not have. Kept apart from {@link missingKeyOf}
 * because the two need OPPOSITE advice — a missing key says "you named a field
 * that isn't declared", an unknown variable says "the field is fine; the thing
 * you hung it off isn't available here".
 */
const UNKNOWN_VARIABLE_RE = /Unknown variable:\s*([A-Za-z_$][\w$]*)/;

/**
 * One-line summary of a CEL fault. The engine appends a source excerpt and a
 * caret line to `message`, which is right for a log and wrong for an API error,
 * so only the first line travels.
 */
export function faultSummary(error: CelFault): string {
  const first = String(error.message ?? '').split('\n')[0]!.trim();
  return `${error.kind}: ${first || 'unknown error'}`;
}

/** The key a `No such key: <key>` fault names, or `undefined`. */
export function missingKeyOf(error: CelFault): string | undefined {
  return NO_SUCH_KEY_RE.exec(String(error.message ?? ''))?.[1];
}

/** The root identifier an `Unknown variable: <name>` fault names, or `undefined`. */
export function unknownVariableOf(error: CelFault): string | undefined {
  return UNKNOWN_VARIABLE_RE.exec(String(error.message ?? ''))?.[1];
}

/** True when the fault is the null-comparison overload fault (and not a
 *  missing key, which is always the more specific diagnosis). */
export function isNullOverloadFault(error: CelFault): boolean {
  const raw = String(error.message ?? '');
  return !missingKeyOf(error) && NULL_OVERLOAD_RE.test(raw) && /null/.test(raw);
}

/** What the two surfaces call the thing that faulted, so one helper can write
 *  both sentences without either side inventing its own phrasing. */
export interface CelFaultSubject {
  /** How the expression is named in prose: `'predicate'`, `'condition'`, … */
  what: string;
  /** How to fix an undeclared key, e.g. `"fix the rule's condition, or declare the field"`. */
  undeclaredKeyFix: string;
}

export interface CelFaultDescription {
  /** `kind: first line` — safe to put in an API error. */
  summary: string;
  /** The undeclared key the expression read, when that is the fault. */
  missingKey?: string;
  /** The unbound ROOT the expression named, when that is the fault. */
  unknownVariable?: string;
  /** True when the fault is the `null` ordering/arithmetic overload. */
  nullOverload: boolean;
  /** A trailing sentence explaining the fault, or `''` when we have nothing
   *  more specific to say than {@link CelFaultDescription.summary}. Starts with
   *  a leading space so it appends directly onto a message. */
  detail: string;
}

/**
 * Turn a raw CEL fault into the facts + the sentence an author can act on.
 * The wording is deliberately identical across surfaces; only `what` and the
 * fix clause differ.
 */
export function describeCelFault(error: CelFault, subject: CelFaultSubject): CelFaultDescription {
  const summary = faultSummary(error);
  const missingKey = missingKeyOf(error);
  const unknownVariable = missingKey ? undefined : unknownVariableOf(error);
  const nullOverload = isNullOverloadFault(error);
  let detail = '';
  if (missingKey) {
    detail =
      ` The ${subject.what} reads '${missingKey}', which this object does not declare` +
      ` — ${subject.undeclaredKeyFix}.`;
  } else if (unknownVariable) {
    detail =
      ` The ${subject.what} reads '${unknownVariable}', which is not bound for this operation` +
      ` — the scope holds 'record', plus 'previous' only when the record's prior state is in hand.`;
  } else if (nullOverload) {
    detail =
      ` The ${subject.what} compares a value that is null. Guard it with '!= null'` +
      ` — 'has(x)' does NOT do that: a declared field holding null is still PRESENT, so has(x) is true.`;
  }
  return {
    summary,
    ...(missingKey ? { missingKey } : {}),
    ...(unknownVariable ? { unknownVariable } : {}),
    nullOverload,
    detail,
  };
}
