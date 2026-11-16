// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ---------------------------------------------------------------------------
// Re-attach an authored config's CODE to the app bundle serve booted from the
// compiled artifact (#4095).
//
// On `os serve <config>`, `createStandaloneStack()` reads
// `dist/objectstack.json` and returns a ready-made `AppPlugin` for the app.
// That satisfied serve's "does the host already wrap itself?" guard, so the
// `new AppPlugin(config)` built from the LOADED MODULE — the only one carrying
// the module's `onEnable` — was skipped. A JSON artifact cannot hold a
// function, so the app booted with all of its metadata and none of its code:
// `examples/app-todo` served eight `script` action declarations and zero
// handlers, and every one of its buttons answered
// `404 Action 'complete_task' on object 'todo_task' not found`.
//
// Neither side is a superset, which is why the answer is a graft rather than a
// swap. The artifact carries compile-time enrichment the config never has (ADR
// -0046 packaged docs — serve already grafts those the other way), and the
// module carries the code the artifact structurally cannot. So the artifact
// stays the metadata source of truth and the module contributes exactly the
// members the runtime EXECUTES.
//
// Deliberately narrow: only members `AppPlugin` actually reads are moved. The
// bundle's own value always wins — a host that wrapped itself on purpose is
// never overwritten — and a config whose code finds no bundle to land on is
// reported rather than dropped, which is the failure mode that made this
// invisible for so long.
//
// ── One evaluation of the module per boot ─────────────────────────────────
// An artifact that names a `runtimeModule` already carries callables when it
// reaches this graft: `loadArtifactBundle` imported the compiled
// `objectstack-runtime.*.mjs` and merged its `functions` (every hook, action,
// job and `functions` entry the build lowered to a ref). That module is an
// esbuild bundle of the same config source, so it is a SECOND evaluation of
// it, with module state of its own. Grafting the loaded module's `onEnable`
// beside those callables split one app's code across two evaluations: state
// `onEnable` binds at module scope was written into a copy no handler reads,
// and a job reading it failed on every run while `onEnable` reported success.
// `graftAuthoredRuntimeMembers` closes that split. When the module's `onEnable` is what
// the bundle runs, every callable the runtime module supplied is re-pointed at
// the module's own callable for the same ref — the ref → callable reading the
// build itself used (`lowerCallables`), so the two agree by construction —
// and a ref the module no longer serves (an artifact older than its source) is
// reported rather than silently left on the other evaluation.
// ---------------------------------------------------------------------------

import { normalizeStackInput, STACK_RUNTIME_MEMBERS } from '@objectstack/spec';

/**
 * Bundle members `AppPlugin` executes, and which therefore cannot survive a
 * trip through JSON:
 *
 *  - `onEnable` — invoked at `start()` with the host context (`ctx.ql`), which
 *    is where apps register action handlers and drivers.
 *  - `functions` — the name → handler map that string-named hook and job
 *    handlers (`Hook.handler: 'foo'`) resolve against.
 *
 * `onDisable` is deliberately absent: no kernel, runtime or service ever
 * calls it (`packages/spec` declared it until #4212 retired the uninvoked
 * lifecycle family), so grafting it would wire a hook nothing runs.
 *
 * **Derived, not restated** (framework#4167). The same list decides what the
 * undeclared-top-level-key lint stays quiet about: these members are not
 * declared by `ObjectStackDefinitionSchema`, but they are honoured off the
 * authored bundle, so reporting them as "dropped at load" would be false. Two
 * hand-written copies could disagree, and the disagreement would be silent in
 * exactly the direction that lint exists to catch — so the protocol owns the
 * list and this re-exports it.
 */
export const GRAFTABLE_RUNTIME_MEMBERS = STACK_RUNTIME_MEMBERS;

export type GraftableRuntimeMember = (typeof GRAFTABLE_RUNTIME_MEMBERS)[number];

export interface RuntimeGraftResult {
  /** Members moved onto the target bundle. */
  grafted: GraftableRuntimeMember[];
  /**
   * Members the authored config carries that found no bundle to land on — the
   * silent-drop case, which the caller must surface rather than swallow.
   */
  orphaned: GraftableRuntimeMember[];
  /** Why nothing was grafted, when that is the answer. */
  reason?: 'no-authored-members' | 'no-app-plugin' | 'ambiguous-app-plugin' | 'already-present';
  /** `manifest.id` of the bundle that received the graft. */
  appId?: string;
  /**
   * Set when it re-pointed the target bundle's
   * runtime-module callables at the module's own: the refs now served by the
   * module this boot evaluated.
   */
  rebound?: string[];
  /**
   * Refs the artifact's runtime module supplies that the module's lowering
   * does not serve, so they still run from that second evaluation — the split
   * the caller must announce.
   */
  unbound?: string[];
  /** The target bundle's `runtimeModule`, when the re-point read it. */
  runtimeModule?: string;
  /** Why the module's callables could not be read at all, when that is the answer. */
  rebindError?: string;
}

/**
 * serve's "is an app bundle already registered?" predicate.
 *
 * Kept here so the guard that decides to SKIP `new AppPlugin(config)` and the
 * graft that compensates for skipping it can never disagree about what counts
 * as an app plugin.
 */
export function isAppPluginLike(plugin: unknown): boolean {
  if (!plugin || typeof plugin !== 'object') return false;
  const p = plugin as { type?: unknown; name?: unknown; constructor?: { name?: string } };
  if (p.type === 'app') return true;
  if (p.constructor?.name === 'AppPlugin') return true;
  return typeof p.name === 'string' && p.name.startsWith('plugin.app.');
}

/** Whether `source` carries a usable value for `member`. */
function carries(source: unknown, member: GraftableRuntimeMember): boolean {
  if (!source || typeof source !== 'object') return false;
  const value = (source as Record<string, unknown>)[member];
  if (member === 'onEnable') return typeof value === 'function';
  // `functions` is a map or an array of `{ name, handler }` records.
  return typeof value === 'object' && value !== null;
}

function readManifestId(source: unknown): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const manifest = (source as { manifest?: unknown }).manifest;
  if (!manifest || typeof manifest !== 'object') return undefined;
  const id = (manifest as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/** The graft, plus the bundle it landed on, for {@link graftAuthoredRuntimeMembers}. */
function graftOntoTarget(
  plugins: readonly unknown[] | undefined,
  authored: unknown,
): { result: RuntimeGraftResult; bundle?: Record<string, unknown> } {
  const authoredMembers = GRAFTABLE_RUNTIME_MEMBERS.filter((m) => carries(authored, m));
  if (authoredMembers.length === 0) {
    return { result: { grafted: [], orphaned: [], reason: 'no-authored-members' } };
  }

  const candidates = (plugins ?? []).filter(isAppPluginLike) as Array<{ bundle?: unknown }>;
  if (candidates.length === 0) {
    return { result: { grafted: [], orphaned: authoredMembers, reason: 'no-app-plugin' } };
  }

  const authoredId = readManifestId(authored);
  let target: { bundle?: unknown } | undefined;
  if (authoredId) {
    // Identity match only. Falling back to "the only candidate" here would
    // graft app A's handlers onto app B whenever the ids disagree.
    target = candidates.find((p) => readManifestId(p.bundle) === authoredId);
    if (!target) return { result: { grafted: [], orphaned: authoredMembers, reason: 'no-app-plugin' } };
  } else if (candidates.length === 1) {
    target = candidates[0];
  } else {
    return { result: { grafted: [], orphaned: authoredMembers, reason: 'ambiguous-app-plugin' } };
  }

  const bundle = target.bundle;
  if (!bundle || typeof bundle !== 'object') {
    return { result: { grafted: [], orphaned: authoredMembers, reason: 'no-app-plugin' } };
  }

  const grafted: GraftableRuntimeMember[] = [];
  for (const member of authoredMembers) {
    // The bundle's own value always wins: a host that wrapped itself on
    // purpose already decided what should run.
    if (carries(bundle, member)) continue;
    (bundle as Record<string, unknown>)[member] = (authored as Record<string, unknown>)[member];
    grafted.push(member);
  }

  return {
    result: {
      grafted,
      orphaned: [],
      reason: grafted.length === 0 ? 'already-present' : undefined,
      appId: readManifestId(bundle) ?? authoredId,
    },
    bundle: bundle as Record<string, unknown>,
  };
}

type AnyFn = (...args: unknown[]) => unknown;

/** The refs whose `functions` entry holds a callable (`fn`, `{ handler: fn }`, `[{ name, handler: fn }]`). */
function callableRefs(functions: unknown): string[] {
  const refs: string[] = [];
  if (Array.isArray(functions)) {
    for (const entry of functions) {
      if (!entry || typeof entry !== 'object') continue;
      const { name, handler } = entry as { name?: unknown; handler?: unknown };
      if (typeof name === 'string' && typeof handler === 'function') refs.push(name);
    }
  } else if (functions && typeof functions === 'object') {
    for (const [ref, entry] of Object.entries(functions as Record<string, unknown>)) {
      if (typeof entry === 'function') refs.push(ref);
      else if (entry && typeof entry === 'object' && typeof (entry as { handler?: unknown }).handler === 'function') {
        refs.push(ref);
      }
    }
  }
  return refs;
}

/**
 * Put `fns[ref]` in place of every callable `functions` holds for a ref `fns`
 * serves, keeping each entry's declaration (`effect`, …) beside it. An entry
 * holding no callable is never given one: this re-points code, it adds none.
 */
function repointCallables(functions: unknown, fns: Readonly<Record<string, AnyFn>>): unknown {
  const serves = (ref: unknown): ref is string =>
    typeof ref === 'string' && Object.prototype.hasOwnProperty.call(fns, ref) && typeof fns[ref] === 'function';
  if (Array.isArray(functions)) {
    return functions.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const record = entry as { name?: unknown; handler?: unknown };
      return typeof record.handler === 'function' && serves(record.name)
        ? { ...record, handler: fns[record.name] }
        : entry;
    });
  }
  const out: Record<string, unknown> = { ...(functions as Record<string, unknown>) };
  for (const [ref, entry] of Object.entries(out)) {
    if (!serves(ref)) continue;
    if (typeof entry === 'function') out[ref] = fns[ref];
    else if (entry && typeof entry === 'object' && typeof (entry as { handler?: unknown }).handler === 'function') {
      out[ref] = { ...(entry as Record<string, unknown>), handler: fns[ref] };
    }
  }
  return out;
}

/**
 * Move the authored module's runtime members onto the already-registered app
 * bundle they belong to, and report anything that had nowhere to go.
 *
 * Target selection is by `manifest.id`, so a host composing several
 * `AppPlugin`s can never have one app's handlers attached to another. A config
 * with no manifest id at all falls back to the single app bundle present, and
 * refuses when there is more than one.
 *
 * Then one evaluation of the module for all of the bundle's code. The re-point
 * runs only where the split exists: the target bundle came from an artifact
 * whose `runtimeModule` supplied its callables, AND the bundle runs the
 * module's `onEnable`. A bundle with no runtime module carries no callable of
 * another evaluation; a bundle whose own `onEnable` won (a host that wrapped
 * itself) runs none of the module's code, so all of its code is already one
 * evaluation and is left exactly as it is.
 *
 * The module's ref → callable map is `lowerCallables` over the module's
 * normalized stack, the reading `os compile` wrote the runtime module from, so
 * on an artifact compiled from this source every ref resolves. The lowering is
 * loaded only when the split exists: it pulls in the TypeScript parser, which
 * no other boot pays for.
 */
export async function graftAuthoredRuntimeMembers(
  plugins: readonly unknown[] | undefined,
  authored: unknown,
): Promise<RuntimeGraftResult> {
  const { result, bundle } = graftOntoTarget(plugins, authored);
  if (!bundle) return result;
  const runtimeModule = bundle.runtimeModule;
  if (typeof runtimeModule !== 'string' || runtimeModule.length === 0) return result;
  const onEnable = (authored as { onEnable?: unknown }).onEnable;
  if (typeof onEnable !== 'function' || bundle.onEnable !== onEnable) return result;

  const supplied = callableRefs(bundle.functions);
  if (supplied.length === 0) return { ...result, rebound: [], unbound: [], runtimeModule };

  let moduleCallables: Readonly<Record<string, AnyFn>>;
  try {
    const { lowerCallables } = await import('./lower-callables.js');
    moduleCallables = lowerCallables(normalizeStackInput({ ...(authored as Record<string, unknown>) })).functions;
  } catch (error) {
    return {
      ...result,
      rebound: [],
      unbound: supplied,
      runtimeModule,
      rebindError: error instanceof Error ? error.message : String(error),
    };
  }
  const rebound = supplied.filter((ref) => typeof moduleCallables[ref] === 'function');
  const unbound = supplied.filter((ref) => typeof moduleCallables[ref] !== 'function');
  if (rebound.length > 0) bundle.functions = repointCallables(bundle.functions, moduleCallables);
  return { ...result, rebound, unbound, runtimeModule };
}
