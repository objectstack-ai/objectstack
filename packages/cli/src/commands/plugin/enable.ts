// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin enable ID` — undo `os plugin disable ID`: the next boot verifies
 * and loads the installed plugin again (ADR-0025 §3.5 M1). Writes no database
 * row.
 */

import { Args, Command, Flags } from '@oclif/core';
import { installedPluginDisabledIds, setInstalledPluginDisabled } from '@objectstack/runtime';
import { emitJson, printError, printHeader, printInfo, printKV, printSuccess } from '../../utils/format.js';
import { findPluginInstallation, pluginEnvironmentId } from '../../utils/plugin-install.js';

export default class PluginEnable extends Command {
  static override description = 'Load a disabled installed plugin again at the next boot (ADR-0025 §3.5)';

  static override examples = ['$ os plugin enable com.acme.stripe'];

  static override args = {
    id: Args.string({ description: 'The installed plugin id', required: true }),
  };

  static override flags = {
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginEnable);
    const json = flags.json;
    if (!json) printHeader('Enable Plugin');
    const environmentId = pluginEnvironmentId();
    const found = findPluginInstallation(environmentId, args.id);
    if (!found.ok) {
      if (json) {
        await emitJson({ error: found.error, message: found.message }, 1, { compact: true });
        return;
      }
      printError(found.message);
      this.exit(1);
      return;
    }
    const changed = installedPluginDisabledIds(environmentId).has(args.id);
    if (changed) setInstalledPluginDisabled(environmentId, args.id, false);
    if (json) {
      await emitJson({ id: args.id, version: found.record.version, environmentId, disabled: false, changed }, 0, { compact: true });
      return;
    }
    if (changed) printSuccess(`Enabled ${args.id}@${found.record.version}`);
    else printInfo(`${args.id} was not disabled; nothing was written.`);
    printKV('  Environment', environmentId);
    printInfo('The next boot re-verifies its kept artifact and loads it.');
  }
}
