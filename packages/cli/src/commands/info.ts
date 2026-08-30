// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { normalizeStackInput } from '@objectstack/spec';
import { loadConfig } from '../utils/config.js';
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

      if (flags.json) {
        await emitJson({
          config: absolutePath,
          manifest: config.manifest || null,
          stats,
          objects: (config.objects || []).map((o: any) => ({
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
      if (config.objects && config.objects.length > 0) {
        console.log('');
        console.log(chalk.bold('  Objects:'));
        for (const obj of config.objects) {
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
      if (config.agents && config.agents.length > 0) {
        console.log('');
        console.log(chalk.bold('  Agents:'));
        for (const agent of config.agents) {
          console.log(
            `    ${chalk.magenta(agent.name || '?')}` +
            (agent.role ? chalk.dim(` — ${agent.role}`) : '')
          );
        }
      }

      // App details
      if (config.apps && config.apps.length > 0) {
        console.log('');
        console.log(chalk.bold('  Apps:'));
        for (const app of config.apps) {
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
      console.log('');
      printError(error.message || String(error));
      process.exit(1);
    }
  }
}
