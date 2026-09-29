// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * STACK provenance — the spec-declared mark saying *this stack definition was
 * built by a stack producer*: `defineStack` (both modes) or `composeStacks`.
 *
 * ## The rule this mark carries: one authoring shape
 *
 * A project's `objectstack.config.ts` has exactly one legal default export —
 * what a producer returned. `defineStack` is not a typing no-op: it
 * normalises the input, merges every bound standalone action into its object,
 * and runs the cross-field refusals (capability vocabulary, cross-references,
 * namespace prefix, single app, hierarchy-scope and trigger capability) that
 * the schema parse alone cannot express. Its output is therefore an ARTIFACT,
 * and a plain object literal is a different, unjudged dialect of the same
 * data. Re-running those refusals on an artifact is not idempotent either — a
 * built stack carries each bound action twice (top-level `actions[]` and the
 * merged copy in `objects[].actions[]`), so "judge whatever was exported"
 * refuses every correct project that has a bound action.
 *
 * So the author-time doors check PROVENANCE, not content: `os validate` and
 * `os build` refuse an unmarked default export with a prescription to wrap it
 * in `defineStack(...)`, and `composeStacks` refuses an unmarked input the
 * same way (`STACK_PROVENANCE_MISSING`). The cross-field judgement stays in
 * the one producer that can run it correctly.
 *
 * ## ⚠️ The fail direction is CLOSED
 *
 * **Unmarked ⇒ refused**, and every way to lose the mark lands there:
 *
 *  - the mark lives under a SYMBOL key and is non-enumerable, so
 *    `JSON.stringify`, `{ ...spread }`, `Object.assign({}, …)`, structured
 *    clone and a JSON round-trip all DROP it — a copy of a built stack is not
 *    the built stack, and is refused with the same prescription;
 *  - {@link hasStackProvenance} answers `true` only for a value that is
 *    exactly one of the declared producer literals — a forged or corrupted
 *    mark is not a mark.
 *
 * The refusal names the fix that is right in every one of those cases (export
 * what the producer returned), which is why a lost mark is a correct
 * diagnosis rather than a false one.
 *
 * ## Why a symbol on the object, not a key in it
 *
 * The mark must be invisible to everything that reads the stack as DATA: the
 * strict `ObjectStackDefinitionSchema` (which walks own enumerable keys and
 * would refuse an undeclared one), the compiled `dist/objectstack.json`
 * (which must not carry authoring bookkeeping), and every `Object.keys` walk
 * in `composeStacks`. `Symbol.for` (the global registry) rather than a
 * module-local symbol, so a duplicated copy of this package — a CLI that
 * loads its own ESM build while the config it bundles resolves the CJS one —
 * reads the same key. Precedent: `data/filter-subtree-provenance.ts`.
 *
 * Only {@link hasStackProvenance} is published; stamping belongs to the two
 * producers in `stack.zod.ts` alone, so no third party can attest a judgement
 * it did not run.
 */

/** The producers whose output is a judged stack. */
type StackProducer = 'defineStack' | 'composeStacks';

const STACK_PRODUCERS: ReadonlySet<unknown> = new Set<StackProducer>(['defineStack', 'composeStacks']);

/** The symbol key the mark lives under on a built stack definition. */
const STACK_PROVENANCE: symbol = Symbol.for('objectstack.stack.provenance');

/**
 * Stamp the producer's mark on the stack it is about to return, and return it.
 *
 * Non-enumerable, non-writable and non-configurable: invisible to every data
 * reader (see the module header) and not flippable by a later actor. A stack
 * already carrying a valid mark is returned unchanged. A non-extensible
 * object (frozen or sealed) cannot take the property in place, so it is
 * shallow-copied first — the producer's own return value, never the author's
 * input.
 *
 * Internal to the two producers: NOT re-exported from the package entry.
 */
export function markStackProvenance<T>(stack: T, producer: StackProducer): T {
  if (stack === null || typeof stack !== 'object') return stack;
  if (hasStackProvenance(stack)) return stack;
  const target = Object.isExtensible(stack) ? stack : ({ ...(stack as object) } as T);
  Object.defineProperty(target, STACK_PROVENANCE, {
    value: producer,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return target;
}

/**
 * Did a stack producer (`defineStack`, in either mode, or `composeStacks`)
 * build this value?
 *
 * `true` only for an object carrying the mark with one of the declared
 * producer literals; `false` for everything else — a plain object literal, a
 * spread or JSON copy of a built stack, a module namespace, `null`, a
 * primitive. A door that answers `false` refuses with the prescription to
 * wrap the export in `defineStack(...)` (`STACK_PROVENANCE_MISSING`).
 *
 * Read it off the value the producer returned — BEFORE any spread or merge,
 * which drops the mark by design.
 */
export function hasStackProvenance(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  return STACK_PRODUCERS.has((value as Record<symbol, unknown>)[STACK_PROVENANCE]);
}
