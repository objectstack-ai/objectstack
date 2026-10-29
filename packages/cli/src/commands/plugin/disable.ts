// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin disable ID` — keep an installed plugin from loading at the next
 * boot, without removing it (ADR-0025 §3.5 M1).
 *
 * The disable is kept in the package disable-state store under OS_HOME, keyed
 * by this project and the plugin environment id, and the boot-time loader
 * skips a disabled id before it reads anything of it. `os plugin enable ID`
 * undoes it; `os plugin uninstall ID` removes the install. Writes no database
 * row.
 */

import { Args, Command, Flags } from '@oclif/core';
import { installedPluginDisabledIds, setInstalledPluginDisabled } from '@objectstack/runtime';
import { emitJson, printError, printHeader, printInfo, printKV, printSuccess } from '../../utils/format.js';
import { findPluginInstallation, pluginEnvironmentId } from '../../utils/plugin-install.js';

export default class PluginDisable extends Command {
  static override description =
    'Keep an installed plugin from loading at the next boot, without removing it (ADR-0025 §3.5)';

  static override examples = ['$ os plugin disable com.acme.stripe'];

  static override args = {
    id: Args.string({ description: 'The installed plugin id', required: true }),
  };

  static override flags = {
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginDisable);
    const json = flags.json;
    if (!json) printHeader('Disable Plugin');
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
    let changed: boolean;
    try {
      changed = !installedPluginDisabledIds(environmentId).has(args.id);
      if (changed) setInstalledPluginDisabled(environmentId, args.id, true);
    } catch (error) {
      const message = `${(error as Error).message}. Nothing was changed.`;
      if (json) {
        await emitJson({ error: 'disable_state_failed', message }, 1, { compact: true });
        return;
      }
      printError(message);
      this.exit(1);
      return;
    }
    if (json) {
      await emitJson({ id: args.id, version: found.record.version, environmentId, disabled: true, changed }, 0, { compact: true });
      return;
    }
    if (changed) printSuccess(`Disabled ${args.id}@${found.record.version}`);
    else printInfo(`${args.id} was already disabled; nothing was written.`);
    printKV('  Environment', environmentId);
    printInfo('The next boot does not load it. `os plugin enable` loads it again.');
  }
}
