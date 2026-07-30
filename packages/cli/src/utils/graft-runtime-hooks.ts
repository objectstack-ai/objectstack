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
// ---------------------------------------------------------------------------

import { STACK_RUNTIME_MEMBERS } from '@objectstack/spec';

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

/**
 * Move the authored module's runtime members onto the already-registered app
 * bundle they belong to, and report anything that had nowhere to go.
 *
 * Target selection is by `manifest.id`, so a host composing several
 * `AppPlugin`s can never have one app's handlers attached to another. A config
 * with no manifest id at all falls back to the single app bundle present, and
 * refuses when there is more than one.
 */
export function graftAuthoredRuntimeMembers(
  plugins: readonly unknown[] | undefined,
  authored: unknown,
): RuntimeGraftResult {
  const authoredMembers = GRAFTABLE_RUNTIME_MEMBERS.filter((m) => carries(authored, m));
  if (authoredMembers.length === 0) {
    return { grafted: [], orphaned: [], reason: 'no-authored-members' };
  }

  const candidates = (plugins ?? []).filter(isAppPluginLike) as Array<{ bundle?: unknown }>;
  if (candidates.length === 0) {
    return { grafted: [], orphaned: authoredMembers, reason: 'no-app-plugin' };
  }

  const authoredId = readManifestId(authored);
  let target: { bundle?: unknown } | undefined;
  if (authoredId) {
    // Identity match only. Falling back to "the only candidate" here would
    // graft app A's handlers onto app B whenever the ids disagree.
    target = candidates.find((p) => readManifestId(p.bundle) === authoredId);
    if (!target) return { grafted: [], orphaned: authoredMembers, reason: 'no-app-plugin' };
  } else if (candidates.length === 1) {
    target = candidates[0];
  } else {
    return { grafted: [], orphaned: authoredMembers, reason: 'ambiguous-app-plugin' };
  }

  const bundle = target.bundle;
  if (!bundle || typeof bundle !== 'object') {
    return { grafted: [], orphaned: authoredMembers, reason: 'no-app-plugin' };
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
    grafted,
    orphaned: [],
    reason: grafted.length === 0 ? 'already-present' : undefined,
    appId: readManifestId(bundle) ?? authoredId,
  };
}
