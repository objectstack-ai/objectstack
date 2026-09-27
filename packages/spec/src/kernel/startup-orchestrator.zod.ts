// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';

/**
 * Plugin Startup Result Protocol
 *
 * One schema, describing the one startup datum the kernel actually produces.
 *
 * `ObjectKernel.startPluginWithTimeout()` (`packages/core/src/kernel.ts`)
 * races a plugin's `start()` against its `startupTimeout` and returns exactly
 * this record for every plugin it starts — on the success path, on the failure
 * path, and for a plugin that declares no `start()` at all. The kernel's boot
 * loop is its only caller and its only reader: a `success: false` result is
 * logged, and with `rollbackOnFailure` set the already-started plugins are
 * destroyed and the original `error` is rethrown as the new error's `cause`.
 *
 * What each member means, and when it is present:
 *
 * - `pluginName` — always. The plugin's registered name; the result carries the
 *   NAME, never a plugin object.
 * - `success` — always. `false` means `start()` threw or the timeout fired.
 * - `durationMs` — `Date.now()` elapsed across the `start()` race, on BOTH the
 *   success and the failure path. Absent for a plugin with no `start()`, which
 *   returns `{ success: true, pluginName }` without racing anything.
 * - `error` — the failure path only: the value `start()` threw. Declared here
 *   as the serializable projection every consumer of this record can carry
 *   (`name` / `message` / `stack` / `code`), which a thrown `Error` satisfies —
 *   the kernel hands the live instance through, so `instanceof Error` still
 *   narrows at the read site and the original cause survives the rethrow.
 * - `timedOut` — the failure path only, and only when the failure was the
 *   TIMEOUT rather than a throw from inside `start()`: the kernel sets it from
 *   the raced rejection's message. Absent on the success path; absent, not
 *   `false`, when a plugin's own `start()` threw.
 *
 * The deprecated `startTime` alias the kernel used to set beside `durationMs`
 * ends here: it never held an instant, and a member whose name promises one
 * while carrying an elapsed duration is the confusion the duration-unit rule
 * exists to stop. It is a tombstone on this schema and the kernel no longer
 * populates it.
 *
 * ── [#16059] What this module used to declare, and why it no longer does ────
 *
 * Until this major it also declared a whole startup-ORCHESTRATION vocabulary —
 * `StartupOptionsSchema` (with `timeoutMs`, `rollbackOnFailure`, `healthCheck`,
 * `parallel`, `context`), `HealthStatusSchema`, `StartupOrchestrationResultSchema`
 * — beside the `IStartupOrchestrator` contract interface in
 * `contracts/startup-orchestrator.ts` that tied them together
 * (`orchestrateStartup` / `rollback` / `checkHealth` / `startWithTimeout`).
 *
 * Maintainer ruling on #16059 (director seat, decision batch #60, 2026-09-06):
 * the spec KEEPS a startup-result contract and it describes what the kernel
 * actually produces. Neither enforcing the never-landed design nor dropping the
 * contract was adopted. So the orchestrator vocabulary is retired under ADR-0049
 * enforce-or-remove and this result schema is re-declared against the shipped
 * shape, with `@objectstack/core` importing the type from here rather than
 * declaring a twin — the drift that made the two disagree cannot recur.
 *
 * Nothing implemented `IStartupOrchestrator` and nothing parsed the three
 * schemas: measured across this repository and the pinned `objectui` checkout
 * with lit same-corpus controls, every reference outside this module's own
 * tests was a generated artifact or a released `CHANGELOG.md`. `healthCheck`
 * and `HealthStatus` in particular named a probe system that does not exist —
 * the kernel never checks a plugin's health at startup — which is the #3950
 * shape: a published vocabulary an author (ADR-0033) reads as proof of a
 * capability, that parses clean and is received by nobody.
 *
 * Route 3 of the retirement playbook: with no authored document carrying the
 * defs there is no seam for a D2 conversion and nobody to hand a tombstone to,
 * so `RETIRED_DEFS_BY_MAJOR[18]` plus the D3 semantic entry
 * `startup-orchestrator-retired` ARE the declaration. Two keys of THIS
 * surviving schema are tombstoned rather than dropped, because this def keeps
 * emitting and its type is imported by `@objectstack/core`: a construction site
 * still writing them gets the prescription through `tsc`.
 *
 * Following ObjectStack "Zod First" principle — all data structures have Zod
 * schemas for runtime validation and JSON Schema generation.
 */

// ============================================================================
// Plugin Startup Result Schema
// ============================================================================

/**
 * Plugin Startup Result Schema
 * The per-plugin outcome the kernel returns for every plugin it starts
 *
 * @example
 * {
 *   "pluginName": "crm-plugin",
 *   "success": true,
 *   "durationMs": 1250
 * }
 *
 * @example
 * {
 *   "pluginName": "slow-plugin",
 *   "success": false,
 *   "durationMs": 30000,
 *   "error": { "name": "Error", "message": "Plugin slow-plugin start timeout after 30000ms" },
 *   "timedOut": true
 * }
 */
export const PluginStartupResultSchema = lazySchema(() => z.object({
  /**
   * Name of the plugin that was started
   */
  pluginName: z.string().describe('Name of the plugin that was started'),

  /**
   * Whether startup was successful
   */
  success: z.boolean().describe('Whether the plugin started successfully'),

  /**
   * Time taken to start (milliseconds)
   *
   * Optional because a plugin that declares no `start()` is resolved without
   * racing anything, and there is no elapsed time to report.
   */
  // Renamed from `duration` (#15678, #14478 ruling B): the unit lived only in the
  // describe prose.
  durationMs: z.number().min(0).optional()
    .describe('Time taken to start the plugin in milliseconds; absent when the plugin declares no start()'),

  /**
   * Error if startup failed
   */
  error: z.object({
    name: z.string().describe('Error class name'),
    message: z.string().describe('Error message'),
    stack: z.string().optional().describe('Stack trace'),
    code: z.string().optional().describe('Error code'),
  }).optional().describe('Serializable error representation if startup failed'),

  /**
   * Whether the failure was the startup TIMEOUT rather than a throw from
   * inside the plugin's own `start()`
   */
  timedOut: z.boolean().optional()
    .describe('Whether startup failed because the startup timeout fired, rather than start() throwing'),

  /**
   * Tombstone for the deprecated `startTime` alias core carried (#16059).
   *
   * Mirroring it was the other candidate and the tree refuses it: the member
   * holds elapsed milliseconds under a name that carries no unit, which is
   * exactly what `check:duration-unit-keys` (ruling B on #14478) fails, and
   * neither of that rule's two schema-declared exemptions applies — it is not
   * an `EpochMs` instant and it mirrors no external standard. Renaming it to
   * `startTimeMs` would mint a spelling nothing has ever produced, for a member
   * already slated for removal. So the L1 alias ends here, audibly.
   */
  startTime: retiredKey(
    '`PluginStartupResult.startTime` was removed in @objectstack/spec 17 (ADR-0049) — '
    + 'it never held an instant: the kernel filled it with the SAME elapsed milliseconds as '
    + '`durationMs`, so a reader who took the name at its word and computed '
    + '`Date.now() - startTime` got an age near the epoch instead of a wait. Delete the key '
    + 'and read `durationMs`, which has always carried the same value.',
  ),

  /** Tombstone for the `duration` → `durationMs` rename (#15678, ruling B on #14478). */
  duration: retiredKey(
    '`PluginStartupResult.duration` was renamed to `durationMs` in @objectstack/spec 17 — '
    + 'the unit of a duration-shaped number lives in the key name, not only '
    + 'in the describe prose. Rename the key to `durationMs`; the value (milliseconds) is unchanged.',
  ),

  /** Tombstone for the `plugin` → `pluginName` re-declaration (#16059). */
  plugin: retiredKey(
    '`PluginStartupResult.plugin` was removed in @objectstack/spec 17 (ADR-0049) — '
    + 'the kernel has never put a plugin OBJECT in this result, so the nested '
    + '`{ name, version }` shape described a value nothing ever built. Replace the key '
    + 'with `pluginName` and carry the plugin name string.',
  ),

  /** Tombstone for the health member, retired with `HealthStatus` itself (#16059). */
  health: retiredKey(
    '`PluginStartupResult.health` was removed in @objectstack/spec 17 (ADR-0049) — '
    + 'it carried a `HealthStatus`, and that vocabulary is retired with the startup '
    + 'orchestrator that declared it: no probe system ever ran a health check at '
    + 'startup, so nothing ever filled the key. Delete the key; a plugin that reports '
    + 'health does it through a service it registers, not through this result.',
  ),
}));

export type PluginStartupResult = z.input<typeof PluginStartupResultSchema>;
