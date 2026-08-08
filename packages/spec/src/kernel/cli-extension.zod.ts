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

/**
 * Schema for a CLI Command Contribution declaration in the manifest.
 * 
 * This declarative metadata describes CLI commands contributed by a plugin.
 * With the oclif migration, commands are auto-discovered from the plugin's
 * commands directory. This schema is retained for backward compatibility
 * and for describing command metadata in plugin manifests.
 */
import { lazySchema } from '../shared/lazy-schema';
export const CLICommandContributionSchema = lazySchema(() => z.object({
  /** 
   * CLI command name. Must be a valid identifier: lowercase alphanumeric with hyphens.
   * This becomes a top-level subcommand of the `os` CLI.
   * 
   * @example "marketplace"
   * @example "deploy"
   * @example "cloud-sync"
   */
  name: z.string()
    .regex(/^[a-z][a-z0-9-]*$/, 'Command name must be lowercase alphanumeric with hyphens')
    .describe('CLI command name'),

  /** Brief description shown in `os --help` output. */
  description: z.string().optional().describe('Command description for help text'),

  /** 
   * Module path that exports the oclif Command class(es).
   * Relative to the plugin package root. With oclif, this is typically
   * auto-discovered from the `commands` directory, but can be specified
   * for documentation or manifest purposes.
   * 
   * @example "./dist/commands/marketplace.js"
   * @example "./dist/commands"
   */
  module: z.string().optional().describe('Module path exporting oclif Command classes'),
}));

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

export type CLICommandContribution = z.input<typeof CLICommandContributionSchema>;
export type OclifPluginConfig = z.input<typeof OclifPluginConfigSchema>;
