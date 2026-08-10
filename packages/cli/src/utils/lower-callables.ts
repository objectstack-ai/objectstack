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

import { extractHookBody } from './extract-hook-body.js';

export interface LoweringResult {
  /** A deep-cloned, JSON-safe copy of the stack with handlers replaced by strings. */
  lowered: Record<string, unknown>;
  /** name → original handler function. Empty when nothing needed lowering. */
  functions: Record<string, (...args: unknown[]) => unknown>;
  /** Number of inline function handlers replaced. */
  count: number;
  /** Number of handlers that successfully emitted a metadata-only `body`. */
  bodyExtracted: number;
  /** Per-extraction failures (still emit handler ref + bundle, but warn). */
  bodyExtractionWarnings: Array<{ origin: string; reason: string }>;
}

type AnyFn = (...args: unknown[]) => unknown;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Generate a unique reference name. Hook handlers reuse the hook name
 * verbatim (callers should ensure hook names are unique anyway).
 * Anonymous registrations (e.g. `functions: { foo: fn }`) use the map key.
 * Collisions get a numeric suffix.
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
  const warnings: Array<{ origin: string; reason: string }> = [];
  let bodyExtracted = 0;

  // Try to extract a metadata-only body from a callable. Returns null if the
  // body source contains a forbidden token — the caller still bundles the fn.
  function tryExtractBody(fn: AnyFn, originLabel: string): {
    language: 'js';
    source: string;
    capabilities: string[];
  } | null {
    try {
      const ext = extractHookBody(fn, originLabel);
      bodyExtracted += 1;
      return { language: 'js', source: ext.source, capabilities: ext.capabilities };
    } catch (err: any) {
      warnings.push({ origin: originLabel, reason: err?.message ?? String(err) });
      return null;
    }
  }

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
        const ref = uniqueName(name, taken);
        taken.add(ref);
        functions[ref] = hook.handler as AnyFn;

        // Extract metadata body unless the user already provided one.
        if (!hook.body) {
          const body = tryExtractBody(hook.handler as AnyFn, `hook '${name}'`);
          if (body) hook.body = body;
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
          lowerActionCallable(rawAct, taken, functions, tryExtractBody, `${String(obj.name ?? 'object')}`),
        );
      }
      return obj;
    });
  }
  if (Array.isArray((lowered as any).actions)) {
    (lowered as any).actions = ((lowered as any).actions as unknown[]).map((rawAct) =>
      lowerActionCallable(rawAct, taken, functions, tryExtractBody, 'global'),
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
        const name = typeof next.name === 'string' && next.name.length > 0
          ? next.name
          : 'anon_fn';
        const ref = uniqueName(name, taken);
        taken.add(ref);
        functions[ref] = next.handler as AnyFn;
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
        const ref = uniqueName(key, taken);
        taken.add(ref);
        functions[ref] = value as AnyFn;
        out[ref] = ref;
      } else if (isPlainObject(value) && typeof value.handler === 'function') {
        // A DECLARED entry (`{ handler, effect: 'writes' }`, #4396). Lower the
        // callable exactly like the bare form and keep the declaration beside
        // it, so what the function said about itself survives into the
        // artifact — dropping it here would silently un-declare the function
        // on every built deployment while it kept working from source.
        const ref = uniqueName(key, taken);
        taken.add(ref);
        functions[ref] = value.handler as AnyFn;
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
        //   `JSON.stringify(stack)` leaves where a declaration was (#6293).
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

  return {
    lowered,
    functions,
    count: Object.keys(functions).length,
    bodyExtracted,
    bodyExtractionWarnings: warnings,
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
  taken: Set<string>,
  functions: Record<string, AnyFn>,
  tryExtract: (fn: AnyFn, label: string) => { language: 'js'; source: string; capabilities: string[] } | null,
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
  const ref = uniqueName(baseName, taken);
  taken.add(ref);
  functions[ref] = fn;
  if (!action.body) {
    const body = tryExtract(fn, `action '${baseName}'`);
    if (body) action.body = body;
  }
  // Keep a string-named target so the legacy executor can still resolve it.
  action.target = ref;
  return action;
}
