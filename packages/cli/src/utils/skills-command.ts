// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The flags and the write path the three `os skills` commands share. Kept out
 * of `src/commands/skills/`, where every module is a command.
 */

import { isAbsolute, resolve } from 'node:path';
import { Flags } from '@oclif/core';

import { fetchSkillsCatalog, resolveSkillsVersion, type ResolvedSkillsVersion } from './skills-catalog.js';
import {
  DEFAULT_SKILLS_DIR,
  applySkillsWrite,
  inspectSkillsDir,
  planSkillsWrite,
  readSkillsManifest,
  describeModifiedSkill,
  type SkillsWritePlan,
} from './skills-install-state.js';

/** `--version`, `--target`, `--dir` and `--json`, as all three commands spell them. */
export const skillsCommonFlags = {
  version: Flags.string({
    description: 'Exact @objectstack/skills version to use (default: the target\'s, then this CLI\'s own version)',
    exclusive: ['target'],
  }),
  target: Flags.string({
    description:
      'Target environment whose skills version to use: its http(s) URL (its published restriction profile is read) '
      + 'or a restriction profile JSON file, the same forms as `os validate --target`',
    exclusive: ['version'],
  }),
  dir: Flags.string({
    description: `The agent's skills directory (default: ${DEFAULT_SKILLS_DIR} under the current directory)`,
  }),
  json: Flags.boolean({ description: 'Output one JSON document on stdout' }),
};

/** The skills directory `--dir` names, absolute. */
export function resolveSkillsDir(dir: string | undefined, cwd: string = process.cwd()): string {
  const chosen = dir ?? DEFAULT_SKILLS_DIR;
  return isAbsolute(chosen) ? chosen : resolve(cwd, chosen);
}

/** One write's outcome, for both faces. */
export interface SkillsWriteResult {
  ok: true;
  command: 'install' | 'update';
  dir: string;
  version: string;
  versionSource: ResolvedSkillsVersion['source'];
  versionFrom: string;
  previousVersion: string | null;
  added: string[];
  replaced: string[];
  removed: string[];
  /** Same-named directories the record did not name that `install --force` replaced. */
  adopted: string[];
  /** Skill directories left alone because the record does not name them. */
  untouched: string[];
}

/**
 * `install` or `update`: resolve the version, refuse what the command must not
 * do (see each command's description), fetch the catalog and write it. Throws
 * a plain `Error` whose message is the refusal; nothing is written before every
 * refusal has been judged.
 */
export async function runSkillsWrite(args: {
  command: 'install' | 'update';
  version?: string;
  target?: string;
  dir?: string;
  force: boolean;
  cliVersion: string;
  cwd?: string;
}): Promise<SkillsWriteResult> {
  const cwd = args.cwd ?? process.cwd();
  const dir = resolveSkillsDir(args.dir, cwd);
  const manifest = readSkillsManifest(dir);

  if (args.command === 'install' && manifest) {
    throw new Error(
      `${dir} already holds the catalog at ${manifest.version} (installed by \`os skills install\`). `
      + 'Run `os skills update` to move it to another version.',
    );
  }
  if (args.command === 'update' && !manifest) {
    throw new Error(
      `${dir} holds no catalog installed by \`os skills install\`, so there is nothing to update. `
      + 'Run `os skills install` first.',
    );
  }
  if (args.command === 'update' && manifest && !args.force) {
    const local = inspectSkillsDir(dir, manifest).modified;
    if (local.length > 0) {
      throw new Error(
        `Catalog skills in ${dir} were changed locally, and an update replaces them: `
        + `${local.map(describeModifiedSkill).join(' | ')}. Move your changes into a skill of your own, `
        + 'or pass --force to discard them.',
      );
    }
  }

  const resolved = await resolveSkillsVersion({ version: args.version, target: args.target, cliVersion: args.cliVersion, cwd });
  const catalog = await fetchSkillsCatalog(resolved.version, cwd);
  const plan: SkillsWritePlan = planSkillsWrite(dir, catalog, manifest);

  if (plan.conflicts.length > 0 && !(args.command === 'install' && args.force)) {
    const names = plan.conflicts.join(', ');
    throw new Error(
      args.command === 'install'
        ? `${dir} already has skill directories this command did not install, with the names of catalog skills: ${names}. `
          + 'Remove them, or pass --force to replace them with the catalog\'s (for example a copy an earlier '
          + '`skills experimental_sync` made). Nothing was written.'
        : `${resolved.version} adds catalog skills whose names a directory of yours already uses: ${names}. `
          + '`os skills update` never touches a skill it did not install: rename or remove yours, then update. Nothing was written.',
    );
  }

  const before = inspectSkillsDir(dir, manifest);
  applySkillsWrite(dir, catalog, plan);
  return {
    ok: true,
    command: args.command,
    dir,
    version: resolved.version,
    versionSource: resolved.source,
    versionFrom: resolved.from,
    previousVersion: manifest?.version ?? null,
    added: plan.added,
    replaced: plan.replaced,
    removed: plan.dropped,
    adopted: plan.conflicts,
    untouched: before.extra.filter((name) => !plan.conflicts.includes(name)),
  };
}

/** The text face of a write: what was written, from which version source, and what was left alone. */
export function skillsWriteLines(result: SkillsWriteResult): string[] {
  const lines = [
    `Version   ${result.version}, from ${result.versionFrom}`,
    `Directory ${result.dir}`,
  ];
  if (result.previousVersion !== null) lines.push(`Previous  ${result.previousVersion}`);
  const list = (label: string, names: string[]) => { if (names.length > 0) lines.push(`${label} ${names.join(', ')}`); };
  list('Added    ', result.added);
  list('Replaced ', result.replaced);
  list('Removed  ', result.removed);
  list('Adopted  ', result.adopted);
  list('Untouched', result.untouched);
  return lines;
}
