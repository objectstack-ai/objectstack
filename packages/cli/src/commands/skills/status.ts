// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os skills status` — the catalog `os skills install` recorded, against the
 * version it should be: `--version`, else the target environment's
 * (`--target`), else this CLI's own — the order `install` uses.
 *
 * Reported: the installed and the expected version; `missing` — recorded
 * skills whose directory is gone; `modified` — recorded skills with a file
 * changed, removed or added; `extra` — skill directories the record does not
 * name, the user's own, listed and never judged.
 *
 * A mismatch is: no recorded catalog, another version, or any missing or
 * modified skill. The command exits 0 either way unless `--check` is given,
 * when a mismatch exits 1. The registry is not read: the comparison is the
 * record against the disk and the expected version.
 */

import { Command, Flags } from '@oclif/core';
import { isExitSignal, printError, printHeader, printSuccess, printWarning } from '../../utils/format.js';
import { resolveSkillsVersion, type SkillsVersionSource } from '../../utils/skills-catalog.js';
import { resolveSkillsDir, skillsCommonFlags } from '../../utils/skills-command.js';
import {
  describeModifiedSkill,
  inspectSkillsDir,
  readSkillsManifest,
  type ModifiedSkill,
} from '../../utils/skills-install-state.js';

/** The status report, both faces. */
export interface SkillsStatusReport {
  ok: true;
  command: 'status';
  dir: string;
  /** The recorded version, or `null` when `os skills install` has not run here. */
  installedVersion: string | null;
  expectedVersion: string;
  expectedSource: SkillsVersionSource;
  expectedFrom: string;
  versionMatches: boolean;
  missing: string[];
  modified: ModifiedSkill[];
  extra: string[];
  mismatch: boolean;
}

export default class SkillsStatus extends Command {
  static override description =
    'Report the installed skills catalog against the server\'s version: missing, modified and extra skills; --check exits 1 on a mismatch';

  static override examples = [
    '$ os skills status',
    '$ os skills status --target https://acme.example.com --check # exit 1 when the catalog is not the target\'s',
    '$ os skills status --json',
  ];

  static override flags = {
    ...skillsCommonFlags,
    check: Flags.boolean({
      description: 'Exit 1 when the catalog is missing, at another version, or has missing or modified skills',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillsStatus);
    if (!flags.json) printHeader('Skills status');
    let report: SkillsStatusReport;
    try {
      const dir = resolveSkillsDir(flags.dir);
      const manifest = readSkillsManifest(dir);
      const expected = await resolveSkillsVersion({
        version: flags.version,
        target: flags.target,
        cliVersion: this.config.version,
      });
      const { missing, modified, extra } = inspectSkillsDir(dir, manifest);
      const installedVersion = manifest?.version ?? null;
      const versionMatches = installedVersion === expected.version;
      report = {
        ok: true,
        command: 'status',
        dir,
        installedVersion,
        expectedVersion: expected.version,
        expectedSource: expected.source,
        expectedFrom: expected.from,
        versionMatches,
        missing,
        modified,
        extra,
        mismatch: !versionMatches || missing.length > 0 || modified.length > 0,
      };
    } catch (error) {
      if (isExitSignal(error)) throw error;
      if (flags.json) console.log(JSON.stringify({ ok: false, command: 'status', error: (error as Error).message }, null, 2));
      else printError((error as Error).message);
      this.exit(1);
      return;
    }

    if (flags.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`  Directory ${report.dir}`);
      console.log(`  Installed ${report.installedVersion ?? 'none (os skills install has not run here)'}`);
      console.log(`  Expected  ${report.expectedVersion}, from ${report.expectedFrom}`);
      if (report.missing.length > 0) console.log(`  Missing   ${report.missing.join(', ')}`);
      for (const m of report.modified) console.log(`  Modified  ${describeModifiedSkill(m)}`);
      if (report.extra.length > 0) console.log(`  Extra     ${report.extra.join(', ')} (not the catalog's; left alone)`);
      if (!report.mismatch) {
        printSuccess(`The catalog is @objectstack/skills ${report.expectedVersion}, unmodified.`);
      } else if (report.installedVersion === null) {
        printWarning(`No catalog is installed here. Run \`os skills install\` to install ${report.expectedVersion}.`);
      } else if (!report.versionMatches) {
        printWarning(
          `The catalog is ${report.installedVersion}, not ${report.expectedVersion}. `
          + 'Run `os skills update` with the same --version or --target to move it.',
        );
      } else {
        printWarning('Catalog skills are missing or changed. `os skills update` restores them (with --force when files were changed).');
      }
    }
    if (flags.check && report.mismatch) this.exit(1);
  }
}
