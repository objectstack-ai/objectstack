// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # CLI Extension Protocol
 * 
 * Defines the contract for plugins that extend the ObjectStack CLI with
 * custom commands. This enables third-party packages (e.g., marketplace,
 * cloud deployment tools) to register new CLI commands via oclif's
 * built-in plugin system.
 * 
 * ## How It Works (oclif Plugin Model)
 * 
 * 1. **Declare** — Plugin's `package.json` includes an `oclif` config section
 *    declaring its commands directory and any topics.
 * 2. **Discover** — The main CLI (`@objectstack/cli`) lists the plugin in its
 *    `oclif.plugins` array, or users install it via `os plugins install <pkg>`.
 * 3. **Load** — oclif automatically discovers and registers all Command classes
 *    exported from the plugin's commands directory.
 * 
 * ## Plugin Package Contract
 * 
 * The plugin must be a valid oclif plugin:
 * 
 * ```json
 * // package.json of the plugin
 * {
 *   "name": "@acme/plugin-marketplace",
 *   "oclif": {
 *     "commands": {
 *       "strategy": "pattern",
 *       "target": "./dist/commands",
 *       "glob": "**\/*.js"
 *     }
 *   }
 * }
 * ```
 * 
 * Commands are standard oclif Command classes:
 * 
 * ```typescript
 * // src/commands/marketplace/search.ts
 * import { Args, Command, Flags } from '@oclif/core';
 * 
 * export default class MarketplaceSearch extends Command {
 *   static override description = 'Search marketplace apps';
 *   static override args = {
 *     query: Args.string({ description: 'Search query', required: true }),
 *   };
 *   async run() {
 *     const { args } = await this.parse(MarketplaceSearch);
 *     // ...
 *   }
 * }
 * ```
 * 
 * ## Migration from Commander.js
 * 
 * The previous plugin model required `contributes.commands` in the manifest
 * and exported Commander.js `Command` instances. The new model uses oclif's
 * native plugin system for automatic command discovery and registration.
 * The `objectstack.config.ts` plugins array no longer determines CLI commands.
 */

// ─── [#12007] `CLICommandContributionSchema` / `CLICommandContribution` are
// RETIRED (ADR-0049 enforce-or-remove) ───────────────────────────────────────
//
// The pair described a "CLI Command Contribution declaration in the manifest"
// and claimed to be "retained for backward compatibility and for describing
// command metadata in plugin manifests" — but after #10724 tombstoned
// `manifest.contributes.commands` (see `manifest.zod.ts`), no manifest surface
// could legally carry these entries: the exported schema advertised a shape
// whose only declared carrier rejects it. It was never referenced by
// `manifest.zod.ts` either — the manifest's inline `commands` item schema was
// an independent duplicate (now the tombstone). Zero consumers outside spec's
// own test and generated artifacts, measured with positive controls in
// objectstack, objectui (at the pinned sha) and cloud — the exported
// orphan-value-schema class (#3950: an exported schema with no consumer reads
// as a capability).
//
// Route 3: no carrier key, no authored document for a D2 conversion to
// rewrite, so no tombstone and no conversion — `RETIRED_DEFS_BY_MAJOR[18]`
// (`kernel/CLICommandContribution`) plus the D3 semantic entry
// `cli-command-contribution-retired` ARE the declaration. What ACTUALLY
// registers a CLI command is oclif's native plugin discovery: the plugin
// declares an `oclif` section in its own `package.json` —
// `OclifPluginConfigSchema` below describes that live surface and survives.
// The Commander.js migration record in the module docblock above is
// load-bearing (the `contributes.commands` tombstone cites it) and stays.
import { lazySchema } from '../shared/lazy-schema';

/**
 * Schema for oclif plugin configuration in package.json.
 * Validates the shape of the `oclif` section in a plugin's package.json.
 */
export const OclifPluginConfigSchema = lazySchema(() => z.object({
  /** Command discovery configuration */
  commands: z.object({
    /** Discovery strategy — typically "pattern" for file-based discovery */
    strategy: z.enum(['pattern', 'explicit', 'single']).optional()
      .describe('Command discovery strategy'),
    /** Directory path containing compiled command files */
    target: z.string().optional()
      .describe('Target directory for command files'),
    /** Glob pattern for matching command files */
    glob: z.string().optional()
      .describe('Glob pattern for command file matching'),
  }).optional().describe('Command discovery configuration'),

  /** Topic separator character (default: space) */
  topicSeparator: z.string().optional()
    .describe('Character separating topic and command names'),
}).describe('oclif plugin configuration section'));

// ─── Types ───────────────────────────────────────────────────────────

// [#12007] `CLICommandContribution` left with its schema — see the retirement
// block above.
export type OclifPluginConfig = z.input<typeof OclifPluginConfigSchema>;
