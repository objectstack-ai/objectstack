// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin uninstall ID` — remove an installed plugin (ADR-0025 §3.5 M1).
 *
 * Marks the installation `uninstall-pending` under the installations lock and
 * removes nothing yet: a running `os serve` may have the plugin's code
 * imported from its directory. The next boot loads nothing of it, removes the
 * install directory — unless another project sharing this OS_HOME and
 * environment still records it, when the directory is kept for that project —
 * then drops the record and forgets any disable of the id. Installing the id
 * again before that boot replaces the mark. Writes no database row.
 */

import { Args, Command, Flags } from '@oclif/core';
import { PluginInstallationsLockedError, markPluginUninstall } from '@objectstack/runtime';
import { emitJson, printError, printHeader, printInfo, printKV, printSuccess } from '../../utils/format.js';
import { findPluginInstallation, pluginEnvironmentId } from '../../utils/plugin-install.js';

export default class PluginUninstall extends Command {
  static override description =
    'Remove an installed plugin: the next boot loads nothing of it and removes its directory (ADR-0025 §3.5)';

  static override examples = ['$ os plugin uninstall com.acme.stripe'];

  static override args = {
    id: Args.string({ description: 'The installed plugin id', required: true }),
  };

  static override flags = {
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginUninstall);
    const json = flags.json;
    if (!json) printHeader('Uninstall Plugin');
    const refuse = async (error: string, message: string): Promise<void> => {
      if (json) {
        await emitJson({ error, message }, 1, { compact: true });
        return;
      }
      printError(message);
      this.exit(1);
    };
    const environmentId = pluginEnvironmentId();
    const found = findPluginInstallation(environmentId, args.id, { pendingIsInstalled: true });
    if (!found.ok) {
      await refuse(found.error, found.message);
      return;
    }
    const changed = found.record.status !== 'uninstall-pending';
    let record = found.record;
    if (changed) {
      let marked: typeof record | undefined;
      try {
        marked = markPluginUninstall(environmentId, args.id);
      } catch (error) {
        await refuse(
          error instanceof PluginInstallationsLockedError ? 'installations_locked' : 'uninstall_failed',
          `${(error as Error).message} Nothing was changed.`,
        );
        return;
      }
      // Gone under the lock: another command removed it after it was found.
      if (!marked) {
        await refuse('plugin_not_installed', `${args.id} is not installed in the environment '${environmentId}' any more: it was removed while this command ran. Nothing was changed.`);
        return;
      }
      record = marked;
    }
    if (json) {
      await emitJson({ id: args.id, version: record.version, environmentId, status: record.status, dir: record.dir, changed }, 0, { compact: true });
      return;
    }
    if (changed) printSuccess(`Marked ${args.id}@${record.version} for removal`);
    else printInfo(`${args.id} is already marked for removal; nothing was written.`);
    printKV('  Directory', record.dir);
    printKV('  Environment', environmentId);
    printInfo('The next boot loads nothing of it and removes its directory, unless another project here still records it.');
  }
}
