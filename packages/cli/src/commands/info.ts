// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { normalizeStackInput } from '@objectstack/spec';
import { loadConfig } from '../utils/config.js';
import { resolveStackCollection } from '../utils/stack-collections.js';
import {
  printHeader,
  printKV,
  printSuccess,
  printError,
  printStep,
  createTimer,
  collectMetadataStats,
  printMetadataStats,
  emitJson,
  errorCodeFields,
  isReportedError,
} from '../utils/format.js';

export default class Info extends Command {
  static override description = 'Display metadata summary of an ObjectStack configuration';

  static override args = {
    config: Args.string({ description: 'Configuration file path', required: false }),
  };

  static override flags = {
    json: Flags.boolean({ description: 'Output as JSON' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Info);
    const timer = createTimer();

    if (!flags.json) {
      printHeader('Info');
    }

    try {
      const { config: rawConfig, absolutePath, duration } = await loadConfig(args.config);
      const config: any = normalizeStackInput(rawConfig as Record<string, unknown>);
      const stats = collectMetadataStats(config);

      // [#17790] ADR-0130 D4 / option B — the detail reads below resolve a
      // package-owned collection through the ONE seam this package has for it
      // (`utils/stack-collections.ts`), instead of reading the top level
      // directly. On an option-B project (every definition inside `packages[]`,
      // none flattened up) the top-level read saw nothing while `stats` above
      // already counted the same definitions through the same seam, so ONE
      // `--json` payload asserted `stats.objects: 1` beside `objects: []` and
      // nothing in it distinguished "this project has no objects" from "this
      // reader could not see them".
      //
      // Strictly additive: `resolveStackCollection` answers the caller's
      // original expression FIRST and consults `packages[]` only when the top
      // level does not carry the key at all, so every stack the platform emits
      // today reports exactly what it reported before. It also cannot refuse a
      // stack this command already accepted — `collectMetadataStats` above
      // resolves the same package list through the same seam, so a malformed
      // `packages` has already thrown its ADR-0112 422 by this line.
      //
      // ⛔ What this deliberately does NOT decide: whether an option-B
      // project's detail listing should be this flat union or a per-package
      // grouping. Each entry keeps the shape and the key set it has always had
      // — no package attribution is added — so the grouping question stays
      // exactly as open as it was, for the card that answers it.
      const objects = resolveStackCollection(config, 'objects') as any[];

      if (flags.json) {
        await emitJson({
          config: absolutePath,
          manifest: config.manifest || null,
          stats,
          objects: objects.map((o: any) => ({
            name: o.name,
            label: o.label,
            fields: o.fields ? Object.keys(o.fields).length : 0,
          })),
          loadTime: duration,
        });
        return;
      }

      // Manifest
      if (config.manifest) {
        const m = config.manifest;
        console.log('');
        console.log(`  ${chalk.bold(m.name || m.id || 'Unnamed')} ${chalk.dim(`v${m.version || '0.0.0'}`)}`);
        if (m.id) console.log(chalk.dim(`  ${m.id}`));
        if (m.description) console.log(chalk.dim(`  ${m.description}`));
        if (m.namespace) printKV('  Namespace', m.namespace);
        if (m.type) printKV('  Type', m.type);
      }

      console.log('');
      printMetadataStats(stats);

      // Object details
      if (objects.length > 0) {
        console.log('');
        console.log(chalk.bold('  Objects:'));
        for (const obj of objects) {
          const fieldCount = obj.fields ? Object.keys(obj.fields).length : 0;
          // Record-ownership model (#3175); defaults to user-owned when unset.
          const ownership = obj.ownership || 'user';
          console.log(
            `    ${chalk.cyan(obj.name || '?')}` +
            chalk.dim(` (${fieldCount} fields, ${ownership})`) +
            (obj.label ? chalk.dim(` — ${obj.label}`) : '')
          );
        }
      }

      // Agent details
      const agents = resolveStackCollection(config, 'agents') as any[];
      if (agents.length > 0) {
        console.log('');
        console.log(chalk.bold('  Agents:'));
        for (const agent of agents) {
          console.log(
            `    ${chalk.magenta(agent.name || '?')}` +
            (agent.role ? chalk.dim(` — ${agent.role}`) : '')
          );
        }
      }

      // App details
      const apps = resolveStackCollection(config, 'apps') as any[];
      if (apps.length > 0) {
        console.log('');
        console.log(chalk.bold('  Apps:'));
        for (const app of apps) {
          console.log(
            `    ${chalk.green(app.name || '?')}` +
            (app.label ? chalk.dim(` — ${app.label}`) : '')
          );
        }
      }

      console.log('');
      console.log(chalk.dim(`  Loaded in ${duration}ms`));
      console.log('');

    } catch (error: any) {
      if (flags.json) {
        await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
        process.exit(1);
      }
      // [#15547] `resolveConfigPath()` already wrote its refusal and hint
      // lines to stderr before throwing; printing the sentence again here
      // would put a second copy on stdout.
      if (!isReportedError(error)) {
        console.log('');
        printError(error.message || String(error));
      }
      process.exit(1);
    }
  }
}
