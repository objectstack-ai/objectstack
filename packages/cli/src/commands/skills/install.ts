// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os skills install` — copy the published skills catalog
 * (`@objectstack/skills`) at one version into an agent's skills directory, in
 * a project or in an empty directory: no `package.json` is read or written.
 *
 * The version is `--version`, else the target environment's (`--target`, read
 * as `os validate --target` reads it), else this CLI's own; the output names
 * which. The catalog is the package tarball at exactly that version from the
 * npm registry this environment configures (`utils/skills-catalog.ts`). What
 * was written is recorded beside it (`utils/skills-install-state.ts`), so
 * `os skills update` and `os skills status` can tell the catalog's skills from
 * the user's own. A directory that already holds a recorded catalog is
 * refused, naming `os skills update`; same-named skill directories the record
 * does not name are refused unless `--force` replaces them.
 */

import { Command, Flags } from '@oclif/core';
import { isExitSignal, printError, printHeader, printSuccess } from '../../utils/format.js';
import { runSkillsWrite, skillsCommonFlags, skillsWriteLines } from '../../utils/skills-command.js';

export default class SkillsInstall extends Command {
  static override description =
    'Install the published ObjectStack skills catalog at the server\'s version into your agent\'s skills directory, with or without a project';

  static override examples = [
    '$ os skills install                                  # this CLI\'s version, into .claude/skills/',
    '$ os skills install --version 18.5.0                 # the version an MCP server names',
    '$ os skills install --target https://acme.example.com # the version a target environment runs',
    '$ os skills install --dir .agents/skills             # another agent\'s skills directory',
  ];

  static override flags = {
    ...skillsCommonFlags,
    force: Flags.boolean({
      description: 'Replace skill directories this command did not install that share a catalog skill\'s name',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillsInstall);
    if (!flags.json) printHeader('Skills install');
    try {
      const result = await runSkillsWrite({
        command: 'install',
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
      printSuccess(`Installed ${result.added.length + result.adopted.length} skills of @objectstack/skills ${result.version}.`);
    } catch (error) {
      if (isExitSignal(error)) throw error;
      if (flags.json) console.log(JSON.stringify({ ok: false, command: 'install', error: (error as Error).message }, null, 2));
      else printError((error as Error).message);
      this.exit(1);
    }
  }
}
