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
 * - `aliases` — the curated answer for a semantic near-miss, a different *word*
 *   for the same intent. It is consulted BEFORE the distance fallback and wins
 *   outright (`aliases[aliasProbe(key)] ?? findClosestMatches(…)` in
 *   `suggestions.zod.ts`), which is what gives it **two** jobs, not one:
 *   - **filling a gap** — the near-miss distance cannot reach. The proving case
 *     is `visibleWhen → visible`: ADR-0089 made `visibleWhen` the correct
 *     spelling on view/page, so an author borrowing it on a different surface
 *     is not making a typo, and only a human-written entry can catch it.
 *   - **overruling a wrong hit** — the near-miss distance CAN reach, and
 *     answers with the wrong key. The proving case is `hosts → network` on the
 *     plugin `permissions` block (#16859): the budget is `max(2, len/3)` = 2
 *     for a five-character key and `hosts` is exactly 2 from the declared
 *     `hooks`, so without the entry the author is sent to lifecycle hooks on
 *     the one block that also grants network access.
 *
 *   ⚠️ Neither job is the rare one, and this bullet claimed only the first
 *   until #17361 measured it. Over every registered surface on 2026-09-11:
 *   1910 alias entries, 1658 of them unreachable by distance and **252
 *   reachable** — 211 where the fallback would have answered identically, and
 *   **41 where it answers a different key** the entry overrules. ⛔ So do not
 *   read this option as *only* for what distance cannot reach: that reading
 *   tells an adopter holding a confident wrong suggestion — the case the
 *   option is most needed for — that `aliases` is not their tool, which is
 *   this campaign's own finding-7 shape (see {@link acceptsNothing}).
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
   * Curated answers for semantic near-misses — a different *word* for the same
   * intent, usually correct on a neighbouring surface.
   *
   * Looked up BEFORE the edit-distance fallback and preferred over it, so an
   * entry is the right tool in **both** directions: the word distance cannot
   * reach (`visibleWhen → visible`), and the word distance *does* reach and
   * gets WRONG (`hosts → network`, where `hosts` is 2 edits from the declared
   * `hooks` against a budget of 2 — #16859). ⛔ Not "only for what distance
   * cannot reach": that was this line until #17361, and it sends an author
   * holding a confidently wrong suggestion away from the option that fixes it.
   * Plain case / underscore slips still need no entry — the fallback folds
   * those already, and a second spelling of a covered probe is a dead row.
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
 * [#19581] A {@link strictObjectError} map, plus the handle that BUILDS its
 * unknown-key half without invoking it.
 *
 * The map is deliberately deferred (see the comment inside `strictObjectError`),
 * and until zod 4.5 "deferred" and "built the moment a key is rejected" were the
 * same instant: `safeParse` finalized every issue through the schema's error map
 * before it returned. From 4.6 the failure result carries `error` as a lazy
 * getter (`failure()` in `v4/core/parse.js`) whose stated purpose is to stop the
 * result pinning the parsed value, so finalization — and with it this build —
 * slides to whenever some consumer first reads `.error`.
 *
 * ⛔ That is not a message change: the prescription an author reads is
 * byte-identical on both lines, measured. What moves is WHEN this module reaches
 * across the `field → strict-object → suggestions → field` import cycle, from
 * "inside the parse that refused the key" to "wherever the error object is first
 * read". The cycle is the whole reason the build is deferred at all, so the
 * moment it happens is a property worth keeping, not an implementation detail —
 * which is why {@link markUnknownKeyRefusalTerminal} primes it on the refusal
 * path and `strict-object.test.ts` pins that it has happened by then.
 */
type PrimableErrorMap = z.core.$ZodErrorMap & { prime: () => void };

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
  const buildMap = (): z.core.$ZodErrorMap =>
    // The table is recorded ONCE, below, with its `shape` — the strong record
    // the audit reads. Between #5483 and #5593 a second, transcription-shaped
    // registry existed for the 44 call sites that predated this helper, and
    // this build had to be run with that registry suppressed so a
    // `strictObject` surface would not be judged twice (the second time against
    // `knownKeys` rather than the shape). #5593 migrated the last of those call
    // sites and deleted the registry, so the suppression went with it.
    (build ??= strictUnknownKeyError({
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
    }));

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
    return buildMap()(issue);
  };

  // [#19581] The handle that settles WHEN the reach across the import cycle
  // happens — see `PrimableErrorMap`. Building is idempotent, so a caller may
  // prime as often as it likes; the map is still constructed once.
  (error as PrimableErrorMap).prime = () => {
    buildMap();
  };

  declarationStore().push({ options, shape });

  return error;
}

/**
 * [#19581] An unknown key is a TERMINAL refusal of the surface that raised it —
 * restored here because zod stopped treating it as one.
 *
 * ## What moved, measured on both lines
 *
 * From zod 4.5.0 the `unrecognized_keys` issue carries `continue: true`
 * (`v4/core/schemas.js`, both the shape-phase and the `handleCatchall` push;
 * absent on 4.4.3). The vendor states the intent in the line above it: the
 * issue *"describes the shape of the input, not the validity of the parsed
 * value, so it never aborts. The parse still fails; the schema's own checks
 * just get to run first, and an enclosing intersection can reconcile the key
 * against a sibling operand."*
 *
 * That is a reasonable general-purpose posture and it is not this repo's.
 * Here a closed shape is a contract (Prime Directive #12): a key the surface
 * does not declare is not shape information awaiting reconciliation, it is the
 * refusal. Two things follow from the flag, and both were measured on this
 * codebase with the same bodies and `packages/spec/node_modules/zod` repointed
 * per line, the swap proven on disk before either reading was believed:
 *
 * 1. **The surface's own checks now run after it.** `runChecks` reads
 *    `util.aborted(payload)` once, on entry, so a continuable unknown-key issue
 *    lets every `.refine()` / `.superRefine()` on the same object fire and add
 *    a SECOND, contradictory complaint about a body that was already refused.
 * 2. **Every union containing that surface loses its envelope.**
 *    `handleUnionResults` — byte-identical on 4.4.3, 4.5.0 and 4.6.1, so not
 *    itself the change — returns a single non-aborted member's issues
 *    UNWRAPPED instead of pushing `invalid_union`:
 *
 *    ```js
 *    const nonaborted = results.filter((r) => !util.aborted(r));
 *    if (nonaborted.length === 1) { final.value = nonaborted[0].value; return nonaborted[0]; }
 *    ```
 *
 *    A member whose only complaint is an unknown key is now that one member, so
 *    the union's message becomes THAT branch's prescription — chosen by zod's
 *    "which branch got furthest" heuristic rather than by the door's own branch
 *    rule. On `ViewMetadataSchema` the observable effect was a `viewKind` +
 *    `config` ViewItem body being answered with the CONTAINER branch's
 *    *"wrap it: `defineView({ list: … })`"*, and a retirement prescription that
 *    names the retired member never being reached at all.
 *
 * ## Why it is applied at `_zod.parse` and not as a check
 *
 * The flag has to be settled BEFORE `runChecks` computes `isAborted`, which
 * rules out a `.check()` — a check runs after the parse and cannot retroactively
 * gate its siblings. A check would also be worse in a second way: `util.extend`
 * refuses to overwrite a key on any object carrying checks, so adding one here
 * would break `.extend()` on every closed shape in the package.
 *
 * ⛔ **It cannot move the acceptance face.** It only rewrites a flag on an issue
 * that has already been raised; a body with no issues never reaches it, and no
 * issue is added, removed or re-coded. What changes is which competing
 * complaint an author reads, and whether the union keeps its envelope.
 *
 * ⚠️ **A hoisted `function` declaration, for the reason `declarationStore()`
 * above is one** — it runs from inside a constructor `strictObject` can reach
 * while this module is still initializing, so a `const` arrow would be in its
 * temporal dead zone exactly when it is first needed.
 *
 * It also primes the surface's unknown-key map, because from zod 4.6 a failed
 * `safeParse` finalizes its issues only when `.error` is read — see
 * {@link PrimableErrorMap}. Priming is confined to the refusal path: a clean
 * parse raises no `unrecognized_keys` issue, so a shape nobody has written a
 * bad key on still never reaches across the import cycle.
 */
function markUnknownKeyRefusalTerminal<P extends { issues: Array<{ code?: string }> }>(
  inst: { _zod: { def: { error?: unknown } } },
  payload: P,
): P {
  let refused = false;
  for (const issue of payload.issues) {
    if (issue.code === 'unrecognized_keys') {
      (issue as { continue?: boolean }).continue = false;
      refused = true;
    }
  }
  if (refused) {
    const prime = (inst._zod.def.error as Partial<PrimableErrorMap> | undefined)?.prime;
    if (typeof prime === 'function') prime();
  }
  return payload;
}

/**
 * [#19581] The `ZodObject` variant {@link closedObject} builds, owned by a
 * HOISTED function declaration.
 *
 * It is a constructor rather than an instance-level patch because
 * `util.clone()` rebuilds through `inst._zod.constr`: `.strict()`, `.strip()`,
 * `.extend()`, `.refine()` and `.omit()` all clone, so an instance-level wrap
 * would survive exactly until the first derived schema. Declaring it here makes
 * every descendant carry it by construction.
 *
 * `_zod.def` is untouched, so the emitted JSON Schema, the authorable surface
 * and `instanceof z.ZodObject` (trait-based) are all byte-identical.
 *
 * ⚠️ **Deliberately not a module-level `const` — the same load-bearing reason
 * {@link declarationStore} is not one, and it is not a hypothetical here.**
 * `strictObject` runs at MODULE SCOPE for schemas inside the
 * `field → strict-object → suggestions → field` cycle, and it now reaches this
 * constructor on every call. Held in a `const`, that call lands in the
 * constructor's temporal dead zone whenever the loader enters this module
 * second: under `OS_EAGER_SCHEMAS=1` — how `build-schemas.ts` runs — importing
 * the package root died with `ReferenceError: Cannot access 'ZodClosedObject'
 * before initialization`, raised from `data/field-value.zod.ts`'s own
 * module-scope `strictObject(…)` before a single schema was built. Built on
 * first use behind a hoisted function, it is reachable from the first
 * instruction of module evaluation instead.
 *
 * ⚠️ Nothing in an ordinary `vitest run` sees this: `lazySchema` defers every
 * schema body behind a Proxy, so no schema is constructed at import time and
 * the whole suite stays GREEN — the same instrument gap `declarationStore`
 * documents. The eager import is the instrument that answers it, and
 * `strict-object.test.ts` runs one in a subprocess.
 */
function closedObjectConstructor(): new (def: unknown) => unknown {
  const self = closedObjectConstructor as unknown as { ctor?: new (def: unknown) => unknown };
  return (self.ctor ??= z.core.$constructor<any, any>('ZodClosedObject', (inst: any, def: any) => {
    (z.ZodObject as unknown as { init: (i: unknown, d: unknown) => void }).init(inst, def);
    const parse = inst._zod.parse;
    inst._zod.parse = (payload: any, ctx: any) => {
      const done = parse(payload, ctx);
      return done instanceof Promise
        ? done.then((settled: any) => markUnknownKeyRefusalTerminal(inst, settled))
        : markUnknownKeyRefusalTerminal(inst, done);
    };
  }) as unknown as new (def: unknown) => unknown);
}

/**
 * [#19581] Re-declare a closed object schema so its unknown-key refusal is
 * terminal — see {@link markUnknownKeyRefusalTerminal}.
 *
 * Exported for the closed shapes that do NOT come through {@link strictObject}
 * — a bare `z.object(…).strict()` whose curated message is pinned as written
 * and must not be re-routed through the `strictObject` error map.
 */
export function closedObject<S extends z.ZodTypeAny>(schema: S): S {
  return new (closedObjectConstructor() as unknown as new (def: unknown) => S)(
    (schema as unknown as { _zod: { def: unknown } })._zod.def,
  );
}

/**
 * A `.strict()` object whose unknown-key error names the surface, echoes the
 * offending key, and suggests the closest declared key — with the candidate
 * list read from `shape` rather than transcribed alongside it.
 *
 * [#19581] Built as a {@link closedObject}, so the refusal is terminal for this
 * surface on every zod line.
 */
export function strictObject<T extends z.ZodRawShape>(options: StrictObjectOptions, shape: T) {
  return closedObject(z.object(shape, { error: strictObjectError(options, shape) }).strict());
}
