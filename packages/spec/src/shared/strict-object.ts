// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `strictObject` — one call to close an authoring shape against unknown keys.
 *
 * ## Why this exists
 *
 * The #4001 campaign's standard wiring was four moving parts per schema: a
 * hand-transcribed `const X_KEYS = [...] as const` array, a
 * `strictUnknownKeyError({ surface, knownKeys: X_KEYS, history })` call, the
 * `{ error }` argument, and `.strict()`. Plus — because the transcribed array
 * can drift from the shape it describes — an "accepts every declared key" probe
 * test to catch the drift.
 *
 * That was ~34 key arrays and 16 drift-probe test files at the point this
 * helper was written, for a campaign with most of its authorable surface still
 * ahead of it. The cost is not the typing; it is that **the array is a second
 * copy of the truth**, so every schema edit is two edits, and the probe test
 * exists only to catch the case where someone made one of them.
 *
 * The array was never necessary. `knownKeys` feeds one thing — the
 * edit-distance "did you mean" fallback — and the shape object is right there
 * at the call site. Deriving the keys from the shape makes the two copies one,
 * which is also why **no drift probe is needed for a schema built this way**:
 * the key list cannot disagree with the shape it was read from.
 *
 * ## What it does not replace
 *
 * `aliases` and `guidance` stay hand-written, because they are the part that
 * carries judgement rather than transcription:
 *
 * - `aliases` — semantic near-misses edit distance cannot reach. The one that
 *   proves the category is `visibleWhen → visible`: ADR-0089 made `visibleWhen`
 *   the correct spelling on view/page, so an author borrowing it on a different
 *   surface is not making a typo, and only a human-written entry can catch it.
 * - `guidance` — tombstones for retired keys (the rejection must carry the
 *   upgrade) and wrong-layer pointers.
 *
 * Both are optional. A schema with neither still gets a named surface, the
 * offending key echoed back, and a distance-based suggestion — which is the
 * difference between a silent strip and a fixable error. Curation is an
 * upgrade, not a precondition, and treating it as a precondition is part of why
 * the ratchet moved as slowly as it did.
 *
 * @example
 * ```ts
 * export const WidgetSchema = lazySchema(() => strictObject(
 *   {
 *     surface: 'this widget',
 *     history: 'Until #4001 these were dropped silently — the widget still rendered.',
 *     aliases: { visibleWhen: 'visible' },
 *   },
 *   {
 *     name: z.string(),
 *     visible: z.boolean().optional(),
 *   },
 * ));
 * ```
 */

import { z } from 'zod';

import { strictUnknownKeyError, type KeySetGuidance } from './suggestions.zod';

/**
 * True when `schema` accepts no value at all — a `z.never()`, however wrapped.
 *
 * The case this exists for is {@link retiredKey}, which declares a removed key
 * as `z.never().optional()` so the removal is audible in both channels an
 * upgrading author hits: `tsc` (the input type is `never`) and the parse (the
 * value raises the upgrade prescription). That declaration is deliberate and
 * strictly stronger than a `guidance` entry — but it also puts the dead key in
 * `Object.keys(shape)`, and the suggester happily offered it.
 *
 * Which produced this, on `skill`, from the campaign's own helper:
 *
 *     Unrecognized key(s) on this skill: `triggerPhrase`. …
 *     Did you mean `triggerPhrase` → `triggerPhrases`?
 *
 * `triggerPhrases` was REMOVED. An author who took the advice landed on the
 * tombstone and got a second rejection telling them to delete what they had
 * just been told to write. Not silent — but it is the shape the ledger's
 * finding 7 already records twice: **this campaign's own fix signposting the
 * way into the failure mode it exists to kill.**
 *
 * The rule is narrower than "skip tombstones" and holds without knowing why a
 * key is unwritable: **never suggest a key the schema cannot accept.** A
 * structural check gets that for free, and keeps working if the tombstone
 * helper is ever reshaped.
 */
export function acceptsNothing(schema: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  const def = (schema as { _zod?: { def?: { type?: string; innerType?: unknown } } })._zod?.def;
  if (!def?.type) return false;
  if (def.type === 'never') return true;
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'nonoptional':
    case 'catch':
      return acceptsNothing(def.innerType, depth + 1);
    default:
      return false;
  }
}

/** Authoring-surface metadata for {@link strictObject}. */
export interface StrictObjectOptions {
  /** Prose name of the surface the key was written on (e.g. `'this widget'`). */
  surface: string;
  /** One sentence: what silently happened before this shape was closed. */
  history: string;
  /**
   * Semantic near-misses edit distance cannot reach — a different *word* for
   * the same intent, usually correct on a neighbouring surface.
   */
  aliases?: Readonly<Record<string, string>>;
  /**
   * Exact-key prescriptions appended as bullet lines: tombstones for retired
   * keys, wrong-layer pointers. An entry here suppresses the rename suggestion.
   */
  guidance?: Readonly<Record<string, string>>;
  /**
   * The same channel, keyed by a **named key set** instead of an exact key: one
   * prescription for a whole family, emitted once per message. Added at #6619
   * for the three prescriptions that were hand-written `$ZodErrorMap`s precisely
   * because this form did not exist — a set of eleven retired analytics keys
   * with one migration answer, and the ADR-0089 visibility family, which is a
   * pattern rather than a list.
   *
   * An exact {@link guidance} entry always wins over a set; among sets,
   * declaration order decides. See {@link KeySetGuidance}.
   */
  guidanceSets?: readonly KeySetGuidance[];
  /**
   * Extra candidates for the "did you mean" fallback beyond the shape's own
   * keys. For a base that gets `.extend()`ed elsewhere, naming the extension's
   * keys here keeps the suggestion useful on the extended surface.
   */
  extraKeys?: readonly string[];
  /**
   * Prescriptions for a retired **value form** of this slot — a scalar that
   * used to be legal where an object is now required. Keyed by the exact
   * authored value and dispatched on `issue.input`, so only the spelling that
   * really was legal gets the retirement text and every other wrong type keeps
   * zod's own message (the `HookBodyCapability` / `object.managedBy: 'system'`
   * precedent — telling the author of `previosPeriod` that their value "was
   * removed" would misinform).
   *
   * `guidance` cannot reach this case: it is consulted for
   * `unrecognized_keys`, which never fires when the input is not an object at
   * all. Without this hook a slot that converged from `'previousPeriod'` to
   * `{ kind: 'previousPeriod' }` rejects the old spelling with the bare
   * `Invalid input: expected object, received string` — loud, but carrying
   * none of the upgrade the author needs. Added for #5011.
   */
  retiredForms?: Readonly<Record<string, string>>;
}

/**
 * One built authoring shape, paired with the options it was declared with, so
 * the table can be judged against the schema it makes claims about (#5013).
 */
export interface StrictObjectDeclaration {
  /** The authoring metadata the shape was declared with. */
  readonly options: StrictObjectOptions;
  /**
   * The shape the options make claims about — the very object the error map
   * reads `knownKeys` from, so the audit judges exactly what the suggester
   * judges rather than a second view of it.
   */
  readonly shape: z.ZodRawShape;
}

/**
 * The registry array, owned by a HOISTED function declaration.
 *
 * ⚠️ **Deliberately not a module-level `const`, and this is load-bearing.**
 * `strictObject` is called at MODULE SCOPE by schemas that sit inside the
 * `field.zod` ↔ `suggestions.zod` ↔ this module import cycle, so under
 * `OS_EAGER_SCHEMAS=1` it can run while this module is still initializing. A
 * `const` is in its temporal dead zone until its own line executes, so the call
 * throws `ReferenceError: Cannot access 'DECLARATIONS' before initialization`
 * at IMPORT time — before a single test body runs. A hoisted `function`
 * declaration is fully initialized from the first instruction of module
 * evaluation, which is the same property `automation/flow.zod.ts`'s
 * `flowNodeObject()` relies on for its own cycle (#4415, and its docblock says
 * so out loud).
 *
 * Measured, not assumed. On `main` the cycle happened to be entered through
 * `field.zod` first, which resolves this module fully before anything calls
 * into it. #5593 moved `automation/`'s schemas from `strictUnknownKeyError` to
 * this helper, and that one edge reordered the entry: the `automation` barrel
 * now reaches THIS module first, then `suggestions.zod`, then `field.zod`,
 * whose own module-scope `strictObject(…)` call lands here mid-initialization.
 *
 * ⚠️ The failure mode is why this is written down rather than left to the
 * types. `lazySchema` defers construction behind a Proxy, so an ordinary
 * `vitest run` never evaluates a schema at import time and stays GREEN; the
 * eager subprocess dies before any test body runs, and vitest cannot even
 * format the stack, so the owning file reports *no result at all*. What caught
 * it was CI's `check-test-completeness` gate noticing that
 * `automation/flow-region-cycle.test.ts` was counted and never reported. Pinned
 * from this side too, in `strict-object.test.ts`.
 */
function declarationStore(): StrictObjectDeclaration[] {
  const self = declarationStore as unknown as { list?: StrictObjectDeclaration[] };
  return (self.list ??= []);
}

/**
 * Every authoring shape {@link strictObject} has built **so far in this
 * process** — the audit handle behind `alias-integrity.test.ts` (#5013).
 *
 * An `aliases` / `guidance` table is a **claim about the schema**, in two
 * halves: that the key it is filed under is one the shape *rejects* (an alias
 * runs only from the `unrecognized_keys` path, so a declared key can never
 * reach it), and that the key it prescribes is one the shape *accepts*. Nothing
 * checked either half until #5013, and both were false on `main` —
 * `ReportSchema` answered `filter` with *"Did you mean `filter` → `filters`?"*
 * and then rejected `filters` too, with no suggestion the second time.
 *
 * Recorded at construction rather than read back off the built schema, because
 * a marker on the instance does not survive the clone `.superRefine()` /
 * `.extend()` make — which silently un-audited most of the interesting schemas,
 * `ReportSchema` and `DatasetSchema` among them, when this was first written
 * that way. "So far in this process" is why the audit walks the schema graph to
 * force every `lazySchema` before reading this, and cross-checks the result
 * against an AST scan of the call sites: a table nothing constructs is a table
 * nothing judges, and that must fail loudly rather than pass quietly.
 */
export function strictObjectDeclarations(): readonly StrictObjectDeclaration[] {
  return declarationStore();
}

/**
 * Register an authoring surface and build its unknown-key error map, **without
 * closing the shape** — the half of {@link strictObject} that a schema whose
 * door is one level up needs on its own (#6619).
 *
 * The case it exists for is `view.zod.ts`'s `FormFieldBaseSchema`: a
 * module-private base with exactly ONE consumer, `FormFieldSchema =
 * base.extend({ fields }).strict()`. Both the error map and the strictness ride
 * the `.extend()`, so the base is not a door and #4001 批 18 deliberately left
 * it open — the ledger's `strip` row for that site is a measurement artifact,
 * not authorable surface. Folding its bespoke map in with `strictObject` would
 * have flipped that posture as a side effect of a TEXT change, which is exactly
 * the acceptance-surface edit this migration is not allowed to make.
 *
 * Everything else is identical to `strictObject`, because `strictObject` is
 * this function plus `z.object(shape, { error }).strict()`: same lazy build,
 * same tombstone-aware candidate list, same one registration the audit reads.
 */
export function strictObjectError<T extends z.ZodRawShape>(
  options: StrictObjectOptions,
  shape: T,
): z.core.$ZodErrorMap {
  const { surface, history, aliases, guidance, guidanceSets, extraKeys = [], retiredForms } = options;

  // The error map is built on FIRST USE, not at construction.
  //
  // `suggestions.zod` imports `FieldType` from `data/field.zod`, so the moment
  // `field.zod` started using this helper the import graph closed a loop:
  // field → strict-object → suggestions → field. Under `OS_EAGER_SCHEMAS=1`
  // (how `build-schemas.ts` runs) every `lazySchema` body executes at module
  // init, and whichever module the loader entered first saw a
  // half-initialized partner — `strictUnknownKeyError` undefined, and a
  // TypeError before a single schema was built.
  //
  // Worth noting HOW that surfaced: the whole test suite passed. Tests import
  // lazily, so the cycle never resolved in the order that breaks. Only the
  // eager build hit it — the same lesson this campaign keeps re-learning from
  // the other side, that a green check can simply be the wrong instrument.
  //
  // Deferring costs nothing (the map is needed only when a key is rejected)
  // and makes the helper cycle-proof for every schema after this one, rather
  // than making each of them prove it is not in a loop. Same shape as the
  // deferred map `data/object.zod.ts` already carries for its TDZ problem.
  let build: z.core.$ZodErrorMap | undefined;
  const error: z.core.$ZodErrorMap = (issue) => {
    // A retired VALUE FORM is rejected before the unknown-key map is even
    // consulted: `issue.code` here is `invalid_type` (the input is not an
    // object), so `strictUnknownKeyError` would return undefined and zod's
    // bare "expected object, received string" would be all the author sees.
    if (retiredForms && issue.code === 'invalid_type') {
      const prescription =
        typeof issue.input === 'string' ? retiredForms[issue.input] : undefined;
      if (prescription) return prescription;
    }
    // The table is recorded ONCE, below, with its `shape` — the strong record
    // the audit reads. Between #5483 and #5593 a second, transcription-shaped
    // registry existed for the 44 call sites that predated this helper, and
    // this build had to be run with that registry suppressed so a
    // `strictObject` surface would not be judged twice (the second time against
    // `knownKeys` rather than the shape). #5593 migrated the last of those call
    // sites and deleted the registry, so the suppression went with it.
    return (build ??= strictUnknownKeyError({
      surface,
      // Declared-but-unwritable keys (tombstones) are excluded — see
      // `acceptsNothing`. They stay in the SHAPE, so writing one still raises
      // its own prescription; they are only kept out of the candidate list a
      // typo gets pointed at.
      knownKeys: [
        ...Object.keys(shape).filter((k) => !acceptsNothing(shape[k])),
        ...extraKeys,
      ],
      history,
      aliases,
      guidance,
      guidanceSets,
    }))(issue);
  };

  declarationStore().push({ options, shape });

  return error;
}

/**
 * A `.strict()` object whose unknown-key error names the surface, echoes the
 * offending key, and suggests the closest declared key — with the candidate
 * list read from `shape` rather than transcribed alongside it.
 */
export function strictObject<T extends z.ZodRawShape>(options: StrictObjectOptions, shape: T) {
  return z.object(shape, { error: strictObjectError(options, shape) }).strict();
}
