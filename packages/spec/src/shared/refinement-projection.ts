// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The CLOSED list of refinements that reach the published JSON Schema (#18670
 * item 2) — declared here, beside the rule, so the generator never has to guess
 * what a `.refine()` means.
 *
 * ## The gap this closes, and the only direction it may move
 *
 * `z.toJSONSchema()` has no arm for a `custom` check: a plain record, the same
 * record with a `.refine()`, and the same record with an ABORTING `.refine()`
 * project byte-identically (measured on zod 4.4.3, the version this package
 * resolves). So every rule written as a refinement is enforced by the runtime
 * and absent from `packages/spec/json-schema/**` — the tree that ships in the
 * `@objectstack/spec` tarball, that `content/docs/references/**` renders from,
 * and that an author or an AI validates a document against. The published file
 * is therefore WIDER than the contract, which is the silent direction: the
 * validator says yes right up to the moment the platform says no.
 *
 * Each arm below makes the published file state one of those rules. It is a
 * correction of the machine-readable declaration and ⛔ NOT a behaviour change:
 * every arm's emitted keywords accept EXACTLY the JSON documents its runtime
 * rule accepts, so no document the runtime accepts becomes refused. An arm that
 * can only approximate its rule does not belong here — it stays dropped and
 * annotated as `x-dropped-refinements`, which is what the ledger
 * (`dropped-refinements.baseline.json`) holds closed.
 *
 * ## Why the PREDICATE is built from the DECLARATION, and not the other way
 *
 * The rule the runtime enforces and the keywords the file publishes have to be
 * the same rule, and the ways they can drift are silent in both directions: a
 * predicate edited without its declaration publishes a stale contract, a
 * declaration edited without its predicate publishes a contract nothing
 * enforces. Reading the declaration back OUT of the predicate is not available
 * — `.superRefine()` and `.check()` carry no readable function at all (measured:
 * their check def holds only `{ check: 'custom' }`, where `.refine()`'s holds
 * `{ type, check, fn }`), and a projection that turned on `fn.toString()` would
 * be a source-text parser.
 *
 * So each arm here is a FACTORY: it takes the declaration and returns the
 * predicate built from it. {@link requiredOneOf} is the exact case — the keys it
 * publishes are the keys its predicate reads, one array, read twice. Where an
 * arm cannot derive its predicate (a regex and a `.trim()` are two spellings of
 * one set, not one spelling used twice) the equivalence is a PIN rather than a
 * comment: `refinement-projection.test.ts` asserts the two agree on every
 * ECMA-262 whitespace code point plus a corpus, so a future edit to either side
 * fails rather than drifts.
 *
 * ## What lives here and what does not
 *
 * This module is declaration only — the vocabulary, the factories, and the
 * constants a reader of the emitted file would see. Turning a declaration into
 * JSON Schema keywords is the generator's job and lives in
 * `scripts/lib/refinement-projection.ts`; nothing in `src/` emits a keyword.
 */

/**
 * One member of the closed list, as declared at the refinement's own call site.
 *
 * ⛔ Growing this union is a public-contract decision, not a refactor: every arm
 * narrows a published artifact. A new arm owes the same three things the two
 * below have — a factory or a pinned equivalence, an exact-equality argument in
 * its own docblock, and the generator-side keywords that emit it.
 */
export type ProjectableRefinement =
  /**
   * "at least one of these keys is present" — published as `anyOf` of one
   * `required` per key.
   *
   * Exact in the JSON domain: a key absent from a JSON object is the only way
   * for its value to read `undefined`, so `required` and `!== undefined` name
   * the same set of documents. A key present with any JSON value — `null`
   * included — satisfies both.
   */
  | { readonly pattern: 'required-one-of'; readonly keys: readonly string[] }
  /**
   * "a string with at least one non-whitespace character" — published as
   * `minLength: 1` plus {@link NON_BLANK_PATTERN}.
   *
   * Exact: `String.prototype.trim` removes exactly ECMA-262 WhiteSpace ∪
   * LineTerminator, and `\S` is the complement of that same set, so
   * `s.trim().length > 0` and a `\S` search agree on every string. `minLength`
   * is redundant beside the pattern and is emitted anyway, because it is the
   * keyword a form generator and a reference table read.
   */
  | { readonly pattern: 'non-blank-string' }
  /**
   * "whenever this key is present, those keys must be present too" — published
   * as JSON Schema's own `dependentRequired`, which is that sentence and
   * nothing else.
   *
   * Exact in the JSON domain, by the same equality {@link requiredOneOf} rests
   * on read from the other end: a key absent from a JSON object is the only way
   * for its value to read `undefined`, so "present" and "not undefined" name
   * one fact. `dependentRequired` triggers on PRESENCE, so a key present with
   * any JSON value — `null` included — arms its dependency exactly as the
   * predicate's `!== undefined` does.
   *
   * ⛔ It is presence, never VALUE. A rule of the shape "`sslConfig` is
   * required when `ssl` is **true**" is `if`/`then`, is not this arm, and stays
   * dropped and annotated — `data/SQLDriverConfig`'s own refinement is that
   * shape and keeps its ledger row.
   */
  | {
      readonly pattern: 'dependent-required';
      /** Key ⇒ the keys its presence requires. Read once here, and by the predicate. */
      readonly dependencies: Readonly<Record<string, readonly string[]>>;
    };

/** Every arm's `pattern` tag, for a reader that needs the list itself. */
export const PROJECTABLE_REFINEMENT_PATTERNS = [
  'required-one-of',
  'non-blank-string',
  'dependent-required',
] as const;

/**
 * The ECMA-262 pattern accepting exactly the strings {@link NON_BLANK_STRING}
 * accepts. Unanchored on purpose: a JSON Schema `pattern` is a SEARCH, so this
 * reads "somewhere in the string there is a non-whitespace character".
 */
export const NON_BLANK_PATTERN = '\\S';

/**
 * Declared rule per predicate. Keyed on the function the call site hands to
 * `.refine()`, which is the one object that survives everything between the
 * declaration and the projection: `clone()` rebuilds a node's constraint bag
 * from the same check objects, and a `lazySchema()` Proxy delegates to the real
 * internals, so both reach this same function.
 */
const DECLARED = new WeakMap<object, ProjectableRefinement>();

/** Register `rule` as the predicate for `declared`, and hand `rule` back. */
function declare<F extends (value: never) => boolean>(rule: F, declared: ProjectableRefinement): F {
  DECLARED.set(rule, Object.freeze(declared));
  return rule;
}

/**
 * What `rule` was declared to mean, or `undefined` for a rule nobody declared —
 * which is every refinement outside the closed list, and is the reading that
 * keeps it dropped and annotated.
 */
export function projectableRefinementOf(rule: unknown): ProjectableRefinement | undefined {
  return typeof rule === 'function' ? DECLARED.get(rule as object) : undefined;
}

/**
 * "at least one of `keys` is present", as a `.refine()` predicate that also
 * declares itself.
 *
 * The keys are read once into the declaration and the predicate reads them from
 * there, so the published `anyOf` and the enforced rule cannot name different
 * keys. Spell the slot's own keys at the call site:
 *
 * ```ts
 * z.object({ source: …, ast: … }).refine(requiredOneOf(['source', 'ast']), {
 *   message: 'Expression requires at least one of `source` or `ast`',
 * })
 * ```
 */
export function requiredOneOf<K extends string>(
  keys: readonly [K, ...K[]],
): (value: Readonly<Partial<Record<K, unknown>>>) => boolean {
  const declared: ProjectableRefinement = { pattern: 'required-one-of', keys: Object.freeze([...keys]) };
  const rule = (value: Readonly<Partial<Record<K, unknown>>>): boolean =>
    (declared as { keys: readonly string[] }).keys.some(
      (key) => (value as Record<string, unknown>)[key] !== undefined,
    );
  return declare(rule, declared);
}

/**
 * "non-blank after trimming", as a `.refine()` predicate that declares itself —
 * the notion of blank the engines' own helpers apply (`source.trim()`), not a
 * second one.
 *
 * One shared function rather than a factory: there is nothing per-call-site to
 * declare, and one predicate means one registry entry covering every slot that
 * composes it.
 */
export const NON_BLANK_STRING: (source: string) => boolean = declare(
  (source: string): boolean => source.trim().length > 0,
  { pattern: 'non-blank-string' },
);

/**
 * "whenever a key is present, the keys it depends on are present too", as a
 * `.refine()` predicate that also declares itself.
 *
 * The dependency map is read once into the declaration and the predicate reads
 * it from there, so the published `dependentRequired` and the enforced rule
 * cannot name different keys — the same construction {@link requiredOneOf}
 * uses, and the reason neither arm needs a drift pin.
 *
 * A MUTUAL requirement ("both or neither") is spelled as the two one-way
 * entries it is, which is also exactly how `dependentRequired` spells it:
 *
 * ```ts
 * z.object({ cert: …, key: … }).refine(dependentRequired({ cert: ['key'], key: ['cert'] }), {
 *   message: 'Client certificate (cert) and private key (key) must be provided together',
 * })
 * ```
 */
export function dependentRequired<K extends string, D extends string>(
  dependencies: Readonly<Record<K, readonly [D, ...D[]]>>,
): (value: Readonly<Partial<Record<K | D, unknown>>>) => boolean {
  const declared: ProjectableRefinement = {
    pattern: 'dependent-required',
    dependencies: Object.freeze(
      Object.fromEntries(
        Object.entries(dependencies as Readonly<Record<string, readonly string[]>>).map(
          ([key, required]) => [key, Object.freeze([...required])] as const,
        ),
      ),
    ),
  };
  const rule = (value: Readonly<Partial<Record<K | D, unknown>>>): boolean => {
    const record = value as Record<string, unknown>;
    return Object.entries((declared as { dependencies: Readonly<Record<string, readonly string[]>> }).dependencies)
      .every(([key, required]) =>
        record[key] === undefined || required.every((dependency) => record[dependency] !== undefined),
      );
  };
  return declare(rule, declared);
}
