// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os skills update` — move the catalog `os skills install` recorded to
 * another version: the target's, by the same order `install` uses.
 *
 * Only skills the record names are written: each is replaced at the new
 * version, and each the new version no longer ships is removed. ⛔ A skill
 * directory the record does not name is never written, replaced or removed —
 * a new catalog skill whose name one of them already uses is refused, naming
 * it. A recorded skill changed locally is refused too, naming the files,
 * unless `--force` discards the change.
 */

import { Command, Flags } from '@oclif/core';
import { isExitSignal, printError, printHeader, printSuccess } from '../../utils/format.js';
import { runSkillsWrite, skillsCommonFlags, skillsWriteLines } from '../../utils/skills-command.js';

export default class SkillsUpdate extends Command {
  static override description =
    'Update the skills catalog `os skills install` wrote to the server\'s version; your own skills are never touched';

  static override examples = [
    '$ os skills update                                  # this CLI\'s version',
    '$ os skills update --target https://acme.example.com # the version a target environment runs',
    '$ os skills update --version 18.6.0',
  ];

  static override flags = {
    ...skillsCommonFlags,
    force: Flags.boolean({
      description: 'Discard local changes to catalog skills instead of refusing',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillsUpdate);
    if (!flags.json) printHeader('Skills update');
    try {
      const result = await runSkillsWrite({
        command: 'update',
        version: flags.version,
        target: flags.target,
        dir: flags.dir,
        force: flags.force,
        cliVersion: this.config.version,
      });
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      for (const line of skillsWriteLines(result)) console.log(`  ${line}`);
      printSuccess(`Updated the catalog from ${result.previousVersion} to @objectstack/skills ${result.version}.`);
    } catch (error) {
      if (isExitSignal(error)) throw error;
      if (flags.json) console.log(JSON.stringify({ ok: false, command: 'update', error: (error as Error).message }, null, 2));
      else printError((error as Error).message);
      this.exit(1);
    }
  }
}
