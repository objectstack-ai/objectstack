// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ConversionNotice } from './conversions/types.js';

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
 * Only the readers are published — {@link hasStackProvenance} and, for the
 * record below, {@link stackConversionsOf}; stamping belongs to the two
 * producers in `stack.zod.ts` alone, so no third party can attest a judgement
 * it did not run.
 *
 * ## The record beside the mark: the ADR-0087 conversions the producer applied
 *
 * `defineStack` runs the ADR-0087 D2 conversion layer at load, in both modes,
 * so an old spelling is already canonical in what it returns. The one
 * exception is a non-strict call carrying the producer's internal
 * authored-input key (`AUTHORED_INPUT_OPTION` in `stack.zod.ts`), which only
 * `os migrate meta` makes because it replays the conversions itself: that
 * call converts nothing, so its record is its input's own. The doors that
 * report conversions (`os validate` / `os build`, the `--json` envelope's
 * `conversions` and `os validate --strict`) receive that returned value — and
 * a door re-running the conversion pass on it finds nothing left to convert.
 * The one party that knows what was converted is the producer, so it RECORDS
 * the notices it applied on the stack it returns, under a second symbol
 * stamped in the same act as the mark, and {@link stackConversionsOf} is the
 * one reader. A door folds that record into its own list; it never runs a
 * second conversion pass to reconstruct it (which would disagree with what
 * was loaded, or double-apply).
 *
 * The record shares the mark's properties and its failure direction: a
 * `ConversionNotice[]` exactly as the conversion layer emitted it (the
 * element the doors' `conversions` field already declares), frozen,
 * non-enumerable, non-writable and non-configurable, so neither the schema
 * nor the compiled artifact carries it; every copy that drops the mark drops
 * the record with it, and an unmarked value has no record ({@link
 * stackConversionsOf} answers `[]`).
 *
 * ## The same record on a refusal
 *
 * A producer that REFUSES returns no stack, yet the conversions it applied
 * before refusing are just as real — and a door that catches the refusal is
 * where the author reads both. So a producer stamps the record of what it
 * applied so far, under the same symbol key and with the same properties, on
 * the ADR-0112 refusal it throws (the `StackRefusalError` family in
 * `stack.zod.ts`), and {@link stackConversionsOf} reads it off the caught
 * error. It is the producer's own record at the throw, never a second
 * conversion pass, and never the stderr line (which is warn-once per process,
 * so a refusal whose notice an earlier stack already printed would lose it).
 * The refusal carries NO mark: an error is not a built stack, so
 * {@link hasStackProvenance} still answers `false` for it.
 */

/** The producers whose output is a judged stack. */
type StackProducer = 'defineStack' | 'composeStacks';

const STACK_PRODUCERS: ReadonlySet<unknown> = new Set<StackProducer>(['defineStack', 'composeStacks']);

/** The symbol key the mark lives under on a built stack definition. */
const STACK_PROVENANCE: symbol = Symbol.for('objectstack.stack.provenance');

/**
 * The symbol key the producer's conversion record lives under, beside
 * {@link STACK_PROVENANCE}. `Symbol.for` for the same reason: a CLI and the
 * config it loads may resolve two copies of this package.
 */
const STACK_CONVERSIONS: symbol = Symbol.for('objectstack.stack.conversions');

/** The record an unmarked value — or a marked one that applied nothing — answers. */
const NO_CONVERSIONS: readonly ConversionNotice[] = Object.freeze([]);

/**
 * Stamp the producer's mark on the stack it is about to return, together with
 * the record of the ADR-0087 conversions that producer applied, and return it.
 *
 * Non-enumerable, non-writable and non-configurable: invisible to every data
 * reader (see the module header) and not flippable by a later actor. A stack
 * already carrying a valid mark is returned unchanged, record included — the
 * producers never hand this an already-marked value of their own making
 * (`normalizeStackInput` and the composition both build a fresh object), so
 * that early return only ever keeps a record that is already complete. A
 * non-extensible object (frozen or sealed) cannot take the properties in
 * place, so it is shallow-copied first — the producer's own return value,
 * never the author's input.
 *
 * `conversions` is frozen together with each notice in it, so every reader of
 * one built stack reads the same entries and none of them can edit the record
 * for the next. Freezing a notice in place (rather than copying it) keeps its
 * identity, which is what lets `composeStacks` count one application once
 * when the same built stack reaches it twice.
 *
 * Internal to the two producers: NOT re-exported from the package entry.
 */
export function markStackProvenance<T>(
  stack: T,
  producer: StackProducer,
  conversions: readonly ConversionNotice[] = NO_CONVERSIONS,
): T {
  if (stack === null || typeof stack !== 'object') return stack;
  if (hasStackProvenance(stack)) return stack;
  const target = Object.isExtensible(stack) ? stack : ({ ...(stack as object) } as T);
  Object.defineProperty(target, STACK_PROVENANCE, {
    value: producer,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  stampConversionRecord(target as object, conversions);
  return target;
}

/**
 * Stamp the record of the ADR-0087 conversions a producer applied BEFORE it
 * refused on the refusal it is about to throw, and return that refusal — the
 * refusing half of {@link markStackProvenance}: same key, same properties,
 * same frozen `ConversionNotice[]`, and no mark (see the module header).
 *
 * `conversions` is the record as it stands at the throw — what was applied so
 * far — so a refusal whose source needed no conversion carries the empty
 * record, stamped, rather than none: every refusal a producer throws answers
 * the same question the same way.
 *
 * The first stamp wins. A refusal that already carries its own record is
 * returned unchanged: the innermost producer's record is the one that
 * describes what was applied to the source that refused, and the property is
 * non-configurable, so a second stamp could not replace it anyway. A
 * non-extensible error cannot take the property and is returned as-is.
 *
 * Internal to the two producers: NOT re-exported from the package entry.
 */
export function markRefusalConversions<E extends Error>(
  refusal: E,
  conversions: readonly ConversionNotice[],
): E {
  if (Object.prototype.hasOwnProperty.call(refusal, STACK_CONVERSIONS)) return refusal;
  if (!Object.isExtensible(refusal)) return refusal;
  stampConversionRecord(refusal, conversions);
  return refusal;
}

/**
 * The one writer of the record's property, shared by both stamps so the stack
 * and the refusal can never carry two shapes of it.
 */
function stampConversionRecord(target: object, conversions: readonly ConversionNotice[]): void {
  Object.defineProperty(target, STACK_CONVERSIONS, {
    value: conversions.length === 0 ? NO_CONVERSIONS : Object.freeze(conversions.map((notice) => Object.freeze(notice))),
    enumerable: false,
    writable: false,
    configurable: false,
  });
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

/**
 * The ADR-0087 D2 conversions the stack producers applied while building this
 * value, in the order they were applied — each a `ConversionNotice`, the same
 * element `os validate --json` / `os build --json` publish under
 * `conversions`.
 *
 * - **`defineStack`** (either mode) records every conversion its load-time
 *   pass applied to the source it was handed. Each is also printed once per
 *   process on stderr (`defineStack: <path>: …`); the record is not subject
 *   to that warn-once, so two stacks built from the same source each carry
 *   their own. A built stack handed straight back to `defineStack` keeps the
 *   record it arrived with.
 * - **`composeStacks`** records its inputs' records, concatenated in input
 *   order, one application once (the same built stack passed twice is counted
 *   once). A notice's `path` is relative to the `defineStack` call that
 *   applied it — the source the author wrote — not to the composed artifact.
 *   A single input is returned as-is, record included.
 * - **A refusal** — the ADR-0112 error a producer THROWS instead of returning
 *   a stack (`code` + `status: 422`) — carries the conversions that producer
 *   applied before it refused: the record the stack would have carried, as it
 *   stood at the throw. A door reads it off the error its catch-all caught,
 *   `stackConversionsOf(error)`. `defineStack` stamps every refusal it throws
 *   after its conversion pass, in both modes; `composeStacks` stamps every
 *   refusal it throws with its inputs' records, by the rule above. A refusal
 *   whose source needed no conversion answers `[]`.
 *
 * `[]` for a value no producer returned or threw (the doors refuse an
 * unbuilt stack anyway, with `STACK_PROVENANCE_MISSING`), and for a stack
 * whose source needed no conversion. Like the mark, the record does not
 * survive a spread or JSON copy — read it off the value the producer returned
 * or threw, BEFORE any merge or serialisation.
 *
 * ⚠️ What it cannot hold: a key merged onto the stack after the producer ran
 * (a config module's named export, say) was never seen by it, which is why a
 * door still runs its own pass over the merged stack and folds this record in
 * beside that pass's findings. And a throw that is NOT one of the producers'
 * ADR-0112 refusals carries no record, however many conversions were applied
 * before it: an error some other layer raised, a non-refusal error raised
 * inside a producer (`composeStacks`' own options parse throws a bare zod
 * error), or anything thrown while a config module loads outside a producer.
 * The stderr line is no substitute for any of these — it is warn-once per
 * process, so a notice an earlier stack already printed is not printed again.
 */
export function stackConversionsOf(value: unknown): readonly ConversionNotice[] {
  if (!hasStackProvenance(value) && !isStampedRefusal(value)) return NO_CONVERSIONS;
  const record = (value as Record<symbol, unknown>)[STACK_CONVERSIONS];
  return Array.isArray(record) ? (record as readonly ConversionNotice[]) : NO_CONVERSIONS;
}

/**
 * An error carrying the record as its OWN property — what
 * {@link markRefusalConversions} leaves on a producer's refusal. The record is
 * read off a value a producer stamped it on, and only two kinds exist: a
 * built stack (under the mark) and an error it threw. A plain object carrying
 * the key without the mark is neither, and is not read.
 *
 * `instanceof Error`, not the refusal class: a CLI and the config it loads may
 * resolve two copies of this package, so the refusal's class is not the
 * reader's — but both run in one realm, where `Error` is one constructor.
 */
function isStampedRefusal(value: unknown): boolean {
  return value instanceof Error && Object.prototype.hasOwnProperty.call(value, STACK_CONVERSIONS);
}
