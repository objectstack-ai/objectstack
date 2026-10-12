// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Walk a normalized stack definition and replace every inline `function`
 * value (Hook handlers, Action handlers, top-level `functions` map / array
 * entries) with **two** payloads:
 *
 *   1. A metadata-only `body: { language: 'js', source, capabilities }`
 *      carved out of the function source via `extractHookBody`. This is
 *      the cloud-deployable form — pure JSON, runs under the QuickJS
 *      sandbox in `@objectstack/runtime`.
 *   2. A back-compat `handler: '<ref>'` string that resolves against the
 *      sibling `objectstack-runtime.{hash}.mjs` bundle. Older runtimes
 *      that don't yet honour `body` keep working through this path.
 *
 * The collected `(ref → function)` map is later bundled by esbuild into
 * `dist/objectstack-runtime.{hash}.mjs`, while the lowered, JSON-safe
 * stack ships as `dist/objectstack.json`. When every hook & action has a
 * valid `body` the bundle becomes a pure compatibility shim — and once
 * the spec drops the `handler` field entirely (Phase 3) we can stop
 * emitting it.
 */

import {
  extractLoweredBody,
  HookBodyExtractionError,
  type HookBodyRefusalKind,
  type LoweringFace,
} from './extract-hook-body.js';

/**
 * One recorded extraction refusal.
 *
 * `origin` and `reason` are unchanged — `os build`'s warn-and-bundle line,
 * `--strict-body`'s diagnostic and the `--json` payload all read them.
 * `kind` (commit ada3834ad) is the classification the refusing rule already had and used
 * to throw away at the catch below; `freeIdentifiers` is the list
 * `detectFreeIdentifiers` had already computed. Both are ADDITIVE: nothing here
 * changes which callables are bundled, or the exit code.
 *
 * `kind` is `'unknown'` only for a throw that is not a
 * {@link HookBodyExtractionError} — i.e. a bug in the extractor rather than a
 * verdict about the author's handler. It is deliberately NOT folded into
 * `'unparseable'`: a consumer must be able to tell "the extractor refused this
 * handler" from "the extractor itself fell over", and silently filing the
 * second as the first is how an instrument failure gets read as an author
 * verdict.
 */
export interface BodyExtractionWarning {
  origin: string;
  reason: string;
  kind: HookBodyRefusalKind | 'unknown';
  freeIdentifiers: readonly string[];
}

/**
 * One registered callable the runtime module still has to carry, the unit
 * `objectstack build --strict-body` counts and lists. The row is the
 * extractor's refusal, verbatim, when some slot tried extraction and was
 * refused. Otherwise it says why extraction was never tried.
 */
export type BodylessCallable = BodyExtractionWarning | { origin: string; reason: string };

/** Is this row the extractor's refusal (as opposed to a slot that was never extracted)? */
export function isExtractionRefusal(row: BodylessCallable): row is BodyExtractionWarning {
  return 'kind' in row;
}

/**
 * How a slot that did not lower its callable leaves it. A callable bound at
 * several slots reports the row of its highest-ranked one, the first among
 * equals, so the row is the extractor's refusal whenever some slot refused it.
 *
 * A rank above 0 is a slot with no body at all, which runs the callable only
 * from the runtime module. Another slot lowering the same callable gives THAT
 * slot a body and leaves this one without, so it does not take the callable
 * off `bodylessCallables`. Only a slot that carries its own authored `body`
 * (rank 0) is taken off by a lowering elsewhere.
 */
type UnloweredSlot = 'refused' | 'functions-entry' | 'authored-body';
const UNLOWERED_SLOT_RANK: Record<UnloweredSlot, number> = { 'authored-body': 0, 'functions-entry': 1, refused: 2 };

/** Why a top-level `functions` entry is never lowered: it has no `body` slot. */
export const FUNCTIONS_ENTRY_NO_BODY_REASON =
  'a `functions` entry has no metadata body: it runs only from the bundled runtime module (objectstack-runtime.*.mjs)';

/** Why an inline function beside an authored `body` is never lowered: the slot already has one. */
export const AUTHORED_BODY_BESIDE_FUNCTION_REASON =
  'it carries its own `body`, so its inline function is not lowered and is bundled into the runtime module (objectstack-runtime.*.mjs) beside it';

export interface LoweringResult {
  /** A deep-cloned, JSON-safe copy of the stack with handlers replaced by strings. */
  lowered: Record<string, unknown>;
  /**
   * ref → the callable it names: the runtime module's `functions` export, entry
   * for entry. Empty when nothing needed lowering.
   *
   * This map is the ONE reading of which ref names which code. The runtime
   * module is generated from it (`buildRuntimeBundle` locates each callable by
   * identity, see `locateCallables`), never by re-deriving names from the
   * config, because the runtime resolves a hook's `handler`, an action's
   * `target` and a `functions` key against one merged namespace.
   *
   * An authored `functions` name (a map key, an array entry's `name`) is a ref
   * of its own: it ships under that name and names its own callable, even when
   * another slot binds the same function or wants the same name. A ref minted
   * for a hook or an action is internal, so it is the one that takes a numeric
   * suffix on a collision.
   */
  functions: Record<string, (...args: unknown[]) => unknown>;
  /**
   * Number of refs the runtime module serves (the keys of `functions`). Two
   * authored `functions` names bound to one function are two refs; slots that
   * only re-bind a callable already registered (a handler shared by two hooks,
   * the same callable in a `packages[i].manifest` body) add none.
   */
  count: number;
  /** Number of SLOTS that emitted a metadata-only `body` (one callable can fill several). */
  bodyExtracted: number;
  /** Per-slot extraction failures (still emit handler ref + bundle, but warn). */
  bodyExtractionWarnings: BodyExtractionWarning[];
  /**
   * Every registered callable (an entry of `functions`) the runtime module
   * still has to carry, each ONCE, in the order a slot first left it
   * unlowered, keyed by its ref. That is a callable bound at a slot with no
   * body at all (a `functions` entry, which has no body slot, or a slot whose
   * extraction was refused), whether or not another slot lowered it, and a
   * callable beside an authored `body` that no slot lowered. This is the list
   * `--strict-body` counts, the population `objectstack build` decides the
   * runtime module from, and (its refusal rows, {@link isExtractionRefusal})
   * the default build's warning.
   *
   * ⛔ Not derivable from the counters above. `count - bodyExtracted` is
   * this list's length only when every callable is walked once at one slot,
   * and the extraction warnings are a subset of it:
   *   - a `functions` entry, or an inline function beside an authored
   *     `body`, is never extracted, so it leaves no warning;
   *   - a stack carrying the same callable at the top level AND in a
   *     `packages[i].manifest` body (ADR-0130 D4) is walked twice. `count`
   *     dedups by identity, while extraction runs once per walk, so each
   *     refusal is recorded twice and each success is counted twice;
   *   - one function bound at two or more slots in one walk (a handler
   *     shared by two hooks) counts once in `count` and once per lowered slot
   *     in `bodyExtracted`, and a slot that lowered it says nothing about a
   *     `functions` entry or a refused slot bound to the same function.
   */
  bodylessCallables: BodylessCallable[];
  /**
   * [#16546] The `hooks[*].handler` ref strings whose `body` was minted HERE
   * — extracted from the author's inline `handler` function — as opposed to a
   * `body` the author wrote directly. A ref lands here if and only if this
   * call set `hook.body`, so the set is empty whenever every hook already
   * carried its own `body`.
   *
   * A ref, not a hook index: `register`'s `taken`/`refByFn` maps are shared
   * across the whole walk (top level AND every ADR-0130 D4 package body, see
   * `lowerBody`'s header), so a ref is unique for this whole call and
   * survives unchanged through a Zod parse (`handler` is an ordinary
   * string field) — an index would not: `authoringRuleUnionStack` folds
   * package hooks into a new top-level array with its OWN numbering, and a
   * hook index recorded against this call's `hooks[i]` would silently
   * address a different hook once folded.
   *
   * Consumed by `validateReadonlyHookWrites` / `validateHookBodyWrites`
   * (`@objectstack/lint`) via `AuthoringRuleContext.loweredHookRefs`, to
   * report `path: hooks[i].handler` — a key that exists in the author's
   * source — instead of `hooks[i].body.source`, a key this function minted
   * and the author never wrote.
   */
  loweredHookRefs: ReadonlySet<string>;
}

type AnyFn = (...args: unknown[]) => unknown;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Generate a unique reference name for an internal ref. Hook handlers reuse
 * the hook name verbatim and action targets `<owner>_<action>`, unless that
 * name is already taken; every authored `functions` name is taken before any
 * internal ref is minted. Collisions get a numeric suffix.
 */
function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}__${i}`)) i++;
  return `${base}__${i}`;
}

export function lowerCallables(input: Record<string, unknown>): LoweringResult {
  const functions: Record<string, AnyFn> = {};
  const taken = new Set<string>();
  const warnings: BodyExtractionWarning[] = [];
  const loweredHookRefs = new Set<string>();
  /**
   * ref → the row `bodylessCallables` reports for it, and that row's slot
   * rank ({@link UnloweredSlot}). A higher-ranked slot replaces the row in
   * place, so the list keeps the order slots first left a callable unlowered.
   */
  const unlowered = new Map<string, { row: BodylessCallable; rank: number }>();
  /** The refs some slot lowered into a `body`. */
  const loweredRefs = new Set<string>();
  let bodyExtracted = 0;

  function noteUnlowered(ref: string, row: BodylessCallable, slot: UnloweredSlot): void {
    const rank = UNLOWERED_SLOT_RANK[slot];
    const held = unlowered.get(ref);
    if (held === undefined || rank > held.rank) unlowered.set(ref, { row, rank });
  }

  // Try to extract a metadata-only body from a callable. Returns null if the
  // body source contains a forbidden token — the caller still bundles the fn.
  // Called only for a slot with no `body` of its own; `ref` is the callable's.
  // `face` is the wrapper the body will run in (#22837): a hook handler's one
  // parameter is rebound to the sandbox's `ctx`; an action target's is not.
  function tryExtractBody(fn: AnyFn, originLabel: string, ref: string, face: LoweringFace): {
    language: 'js';
    source: string;
    capabilities: string[];
  } | null {
    try {
      const ext = extractLoweredBody(fn, originLabel, face);
      bodyExtracted += 1;
      loweredRefs.add(ref);
      return { language: 'js', source: ext.source, capabilities: ext.capabilities };
    } catch (err: any) {
      // ⛔ The catch STAYS. Deleting it would make every refusal fatal and take
      // the LEGITIMATE fallback-to-bundling path down with the accidental one —
      // the two share this catch, which is exactly why the refusal now arrives
      // classified. Telling them apart is the consumer's job (`os lint`), not
      // this function's: lowering keeps bundling both, at exit 0, unchanged.
      const warning: BodyExtractionWarning = {
        origin: originLabel,
        reason: err?.message ?? String(err),
        kind: err instanceof HookBodyExtractionError ? err.kind : 'unknown',
        freeIdentifiers: err instanceof HookBodyExtractionError ? err.freeIdentifiers : [],
      };
      warnings.push(warning);
      noteUnlowered(ref, warning, 'refused');
      return null;
    }
  }

  /**
   * ref → the callable it names, keyed by function IDENTITY.
   *
   * [ADR-0130 D4] A multi-package artifact carries the SAME callable twice —
   * once in the composed stack's flattened collections and once in the package
   * body that owns it (`composeStacks(…, { manifest: 'preserve' })` assembles
   * from the same authored objects, so the two copies are the same function
   * OBJECT, not two functions that look alike). Registering it twice would
   * bundle one implementation under two refs and leave the artifact's two
   * copies pointing at different names for one handler. Identity dedup gives
   * both copies the ref the first pass minted.
   *
   * ⛔ Single-package artifacts are untouched by this: with no `packages` key
   * nothing is walked twice, so no callable is ever looked up here more than
   * once and the ref names are exactly the ones this function minted before.
   */
  const refByFn = new Map<AnyFn, string>();

  /**
   * Authored `functions` name → the callable its entry binds (`undefined` for
   * an entry that carries no callable, such as an already-lowered ref).
   *
   * Filled by {@link claimAuthoredNames} BEFORE any slot is walked, so the
   * names are taken before a hook or an action mints an internal ref. The walk
   * order (hooks, then actions, then `functions`) used to decide who kept a
   * contested name: a hook named like a `functions` key kept it, the key was
   * re-keyed to a `__2` ref the runtime module never served, and the hook's
   * ref then resolved to the `functions` entry's code. A function shared with
   * a hook lost its authored key outright, since the key was re-keyed to the
   * hook's ref.
   *
   * The first binding of a name wins it. A later entry binding the same name
   * to a DIFFERENT callable (a second `packages[i].manifest` body, or a
   * duplicated `name` in the array form) cannot share one flat runtime-module
   * namespace with it, so it keeps today's suffixed ref ({@link suffixedByName}).
   */
  const authoredFn = new Map<string, AnyFn | undefined>();
  /** (authored name, callable) → the suffixed ref a contested name was minted under, so every walk agrees. */
  const suffixedByName = new Map<string, Map<AnyFn, string>>();

  function claimAuthoredName(name: string, fn: AnyFn | undefined): void {
    if (authoredFn.has(name)) return;
    authoredFn.set(name, fn);
    taken.add(name);
    // A hook or action bound to this same function re-uses the authored name
    // rather than minting a second ref for it.
    if (fn !== undefined && !refByFn.has(fn)) refByFn.set(fn, name);
  }

  /** Take every authored `functions` name of one stack-shaped body (map keys, array `name`s). */
  function claimAuthoredNames(body: Record<string, unknown>): void {
    const fnsField = body.functions;
    if (Array.isArray(fnsField)) {
      for (const entry of fnsField) {
        if (!isPlainObject(entry) || typeof entry.name !== 'string' || entry.name.length === 0) continue;
        claimAuthoredName(entry.name, typeof entry.handler === 'function' ? (entry.handler as AnyFn) : undefined);
      }
    } else if (isPlainObject(fnsField)) {
      for (const [key, value] of Object.entries(fnsField)) {
        if (typeof value === 'function') claimAuthoredName(key, value as AnyFn);
        else if (isPlainObject(value) && typeof value.handler === 'function') claimAuthoredName(key, value.handler as AnyFn);
        else claimAuthoredName(key, undefined);
      }
    }
  }

  /** Make `ref` serve `fn` in the runtime module (first registration of the ref wins its place). */
  function serve(ref: string, fn: AnyFn): void {
    if (!Object.prototype.hasOwnProperty.call(functions, ref)) functions[ref] = fn;
  }

  /**
   * Register one callable bound at an INTERNAL slot (a hook, an action, a
   * nameless `functions` array entry) and answer its ref, reusing the ref the
   * callable already has: an authored `functions` name bound to it, or the ref
   * an earlier slot minted for it.
   */
  function register(fn: AnyFn, base: string): string {
    const seen = refByFn.get(fn);
    if (seen !== undefined) {
      serve(seen, fn);
      return seen;
    }
    const ref = uniqueName(base, taken);
    taken.add(ref);
    serve(ref, fn);
    refByFn.set(fn, ref);
    return ref;
  }

  /**
   * Register the callable of an authored `functions` entry and answer its ref:
   * the authored name itself, whatever other slot binds the same function.
   */
  function registerAuthored(fn: AnyFn, name: string): string {
    if (authoredFn.get(name) === fn) {
      serve(name, fn);
      return name;
    }
    let byFn = suffixedByName.get(name);
    if (byFn === undefined) suffixedByName.set(name, (byFn = new Map()));
    let ref = byFn.get(fn);
    if (ref === undefined) {
      ref = uniqueName(name, taken);
      taken.add(ref);
      byFn.set(fn, ref);
    }
    serve(ref, fn);
    if (!refByFn.has(fn)) refByFn.set(fn, ref);
    return ref;
  }

  /**
   * Lower ONE stack-shaped body: the composed stack itself, or one assembled
   * package body inside an ADR-0130 D4 artifact.
   *
   * The per-package walk is this same function called again — not a copy of it
   * — so a lowering rule added for the stack applies to package bodies on the
   * day it lands. Copying the walk is how the two would come to disagree, and
   * the disagreement would be silent in the worst way: an un-lowered handler is
   * a `function` value, and `JSON.stringify` drops it, shipping an artifact
   * whose package hooks simply never fire.
   */
  function lowerBody(input: Record<string, unknown>): Record<string, unknown> {
    // Shallow clone the top level — we only mutate the slots we touch.
    const lowered: Record<string, unknown> = { ...input };

    // 1. Lower `bundle.hooks[*].handler`
    if (Array.isArray(lowered.hooks)) {
      lowered.hooks = (lowered.hooks as unknown[]).map((raw) => {
        if (!isPlainObject(raw)) return raw;
        const hook = { ...raw };
        if (typeof hook.handler === 'function') {
          const name = typeof hook.name === 'string' && hook.name.length > 0
            ? hook.name
            : 'anon_hook';
          const ref = register(hook.handler as AnyFn, name);

          // Extract metadata body unless the user already provided one.
          if (!hook.body) {
            const body = tryExtractBody(hook.handler as AnyFn, `hook '${name}'`, ref, 'hook');
            if (body) {
              hook.body = body;
              // [#16546] This ref's `body` was minted here, not authored — the
              // marker the two hook write-set rules redirect their `path` on.
              loweredHookRefs.add(ref);
            }
          } else {
            noteUnlowered(ref, { origin: `hook '${name}'`, reason: AUTHORED_BODY_BESIDE_FUNCTION_REASON }, 'authored-body');
          }
          hook.handler = ref;
        }
        return hook;
      });
    }

    // 1b. Lower inline action handlers found inside `objects[*].actions[*]`
    //     and `actions[*]`. Only `target: fn` — the `execute` alias was removed
    //     in protocol 17 (#3855) and is left for the parse to reject by name.
    if (Array.isArray(lowered.objects)) {
      lowered.objects = (lowered.objects as unknown[]).map((rawObj) => {
        if (!isPlainObject(rawObj)) return rawObj;
        const obj = { ...rawObj };
        if (Array.isArray(obj.actions)) {
          obj.actions = (obj.actions as unknown[]).map((rawAct) =>
            lowerActionCallable(rawAct, register, tryExtractBody, noteUnlowered, `${String(obj.name ?? 'object')}`),
          );
        }
        return obj;
      });
    }
    if (Array.isArray((lowered as any).actions)) {
      (lowered as any).actions = ((lowered as any).actions as unknown[]).map((rawAct) =>
        lowerActionCallable(rawAct, register, tryExtractBody, noteUnlowered, 'global'),
      );
    }

    // 2. Lower top-level `functions` (map or array of records).
    //    The runtime already merges this map into the engine's resolver, so
    //    we keep the same shape after lowering — just replace fn refs with
    //    serialisable handler-name strings + register the originals.
    const fnsField = (lowered as { functions?: unknown }).functions;
    if (Array.isArray(fnsField)) {
      const arr = fnsField.map((entry) => {
        if (!isPlainObject(entry)) return entry;
        const next = { ...entry };
        if (typeof next.handler === 'function') {
          const authored = typeof next.name === 'string' && next.name.length > 0;
          const name = authored ? (next.name as string) : 'anon_fn';
          const ref = authored ? registerAuthored(next.handler as AnyFn, name) : register(next.handler as AnyFn, name);
          noteUnlowered(ref, { origin: `function '${name}'`, reason: FUNCTIONS_ENTRY_NO_BODY_REASON }, 'functions-entry');
          next.name = ref;
          next.handler = ref;
        }
        return next;
      });
      (lowered as Record<string, unknown>).functions = arr;
    } else if (isPlainObject(fnsField)) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fnsField)) {
        if (typeof value === 'function') {
          const ref = registerAuthored(value as AnyFn, key);
          noteUnlowered(ref, { origin: `function '${key}'`, reason: FUNCTIONS_ENTRY_NO_BODY_REASON }, 'functions-entry');
          out[ref] = ref;
        } else if (isPlainObject(value) && typeof value.handler === 'function') {
          // A DECLARED entry (`{ handler, effect: 'writes' }`, #4396). Lower the
          // callable exactly like the bare form and keep the declaration beside
          // it, so what the function said about itself survives into the
          // artifact — dropping it here would silently un-declare the function
          // on every built deployment while it kept working from source.
          const ref = registerAuthored(value.handler as AnyFn, key);
          noteUnlowered(ref, { origin: `function '${key}'`, reason: FUNCTIONS_ENTRY_NO_BODY_REASON }, 'functions-entry');
          out[ref] = { ...value, handler: ref };
        } else {
          // NOTHING ELSE IS THIS STEP'S TO JUDGE (#7318). Everything that is not
          // a callable to lower rides through under its own key, untouched, and
          // `FlowFunctionEntrySchema` decides whether it is legal.
          //
          // Two kinds of value arrive here, and passing both through is the same
          // decision, not a compromise between two:
          //
          //   ALREADY LOWERED — a bare ref (`'scoreLead'`, #4343) or a lowered
          //   declaration (`{ handler: 'scoreLead', effect: 'writes' }`, #4976).
          //   Both are shapes the schema accepts, so lowering a lowered stack
          //   must be a no-op: same key set, same declarations. Rebuilding the
          //   map around a fixed list of recognised shapes made that false — the
          //   lowered declaration matched none of them and was deleted, so a
          //   second pass (a re-lowered artifact, a fixture that lowers what it
          //   read back) silently un-declared the writer the FIRST pass had
          //   carefully kept.
          //
          //   MALFORMED — the headless husk `{ effect: 'writes' }` that a plain
          //   `JSON.stringify(stack)` leaves where a declaration was (as commit c39a911ae found).
          //   Deleting it here erased the evidence BEFORE the parse: the artifact
          //   came out `functions: {}` and validated green, so the build shipped
          //   an app missing the function instead of refusing. Handed on, it
          //   reaches `FlowFunctionEntrySchema`, which names it — `invalid_union`
          //   on this key — and `objectstack build` fails where it should.
          out[key] = value;
        }
      }
      (lowered as Record<string, unknown>).functions = out;
    }

    return lowered;
  }

  // 0. Take every authored `functions` name, in every body the walks below
  //    visit, before any hook or action mints an internal ref (see
  //    `authoredFn`). The bodies are the ones step 3 walks, in its order.
  claimAuthoredNames(input);
  if (Array.isArray(input.packages)) {
    for (const entry of input.packages as unknown[]) {
      if (isPlainObject(entry) && isPlainObject(entry.manifest)) claimAuthoredNames(entry.manifest);
    }
  }

  const lowered = lowerBody(input);

  // 3. [ADR-0130 D4] The artifact's own package bodies.
  //
  //    A `packages`-carrying artifact is registered THROUGH that list — the
  //    load path reads `packages` when present and the top level only when it
  //    is absent — so a callable that is lowered at the top level and left raw
  //    inside `packages[i].manifest` is a callable the runtime never gets. The
  //    failure is silent end to end: `JSON.stringify` drops a `function` value
  //    without a word, the artifact validates, the build exits 0, and the hook
  //    is simply not there at boot.
  //
  //    Entries that are not `{ manifest: <object> }` ride through untouched:
  //    the shape is `ArtifactPackageSchema`'s to judge, at the parse that runs
  //    after this step, and swallowing a malformed entry here would consume the
  //    evidence before the refusal that names it.
  if (Array.isArray(lowered.packages)) {
    lowered.packages = (lowered.packages as unknown[]).map((entry) => {
      if (!isPlainObject(entry) || !isPlainObject(entry.manifest)) return entry;
      return { ...entry, manifest: lowerBody(entry.manifest as Record<string, unknown>) };
    });
  }

  return {
    lowered,
    functions,
    count: Object.keys(functions).length,
    bodyExtracted,
    bodyExtractionWarnings: warnings,
    // A slot with no body (rank > 0) keeps its callable on the list whatever
    // another slot did: the hook that lowered a shared function does not run
    // the `functions` entry, or the refused slot, bound to that same function.
    bodylessCallables: [...unlowered]
      .filter(([ref, { rank }]) => rank > 0 || !loweredRefs.has(ref))
      .map(([, { row }]) => row),
    loweredHookRefs,
  };
}

/**
 * Lower a single action definition: detect a callable on `target`, register it,
 * and optionally extract a metadata body. Mutates a shallow clone, never the
 * input.
 *
 * `target` is the ONLY handler slot. The deprecated `execute` alias was removed
 * in protocol 17 (#3855) and this step must not keep it alive behind the
 * schema's back: lowering runs BEFORE the parse, so quietly binding a
 * function-valued `execute` here would consume the key and the tombstone would
 * never fire — the author would get the alias silently working in one authoring
 * style and rejected in every other. Leaving it untouched hands it to
 * `ActionSchema`, which rejects it with the rename prescription.
 */
function lowerActionCallable(
  raw: unknown,
  register: (fn: AnyFn, base: string) => string,
  tryExtract: (fn: AnyFn, label: string, ref: string, face: LoweringFace) => { language: 'js'; source: string; capabilities: string[] } | null,
  noteUnlowered: (ref: string, row: BodylessCallable, slot: UnloweredSlot) => void,
  ownerLabel: string,
): unknown {
  if (!isPlainObject(raw)) return raw;
  const action = { ...raw };
  const baseName = typeof action.name === 'string' && action.name.length > 0
    ? `${ownerLabel}_${action.name}`
    : `${ownerLabel}_anon_action`;
  // Only a callable `target` is lowered. A function on the removed `execute`
  // alias is deliberately left in place so the parse rejects it by name.
  if (typeof action.target !== 'function') return action;
  const fn = action.target as AnyFn;
  const ref = register(fn, baseName);
  if (!action.body) {
    const body = tryExtract(fn, `action '${baseName}'`, ref, 'action');
    if (body) action.body = body;
  } else {
    noteUnlowered(ref, { origin: `action '${baseName}'`, reason: AUTHORED_BODY_BESIDE_FUNCTION_REASON }, 'authored-body');
  }
  // Keep a string-named target so the legacy executor can still resolve it.
  action.target = ref;
  return action;
}
