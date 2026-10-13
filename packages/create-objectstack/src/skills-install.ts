// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The skills-catalog install command, in ONE place — because two callers have
// to agree about it: the scaffolder RUNS it, and the closing summary PRINTS
// the same command with a different agent name for the runtimes this run did
// not install for. A drifted pair would tell the user to run something other
// than what produced their project.
//
// ## Where the catalog comes from: the installed package, never GitHub
//
// The catalog ships as `@objectstack/skills`, in the Changesets `fixed` group,
// so its version is always the version of `@objectstack/spec` (ruling A on the
// skills-catalog binding, record 6096124407). The template depends on it, the
// scaffold-time range rewrite (`pkg-utils.ts`) gives it the same `^<version>`
// as every other `@objectstack/*` dependency, and `<pm> install` puts it in
// `node_modules`. The catalog a project gets is therefore the one written for
// the spec it runs — the repository's `main` branch, which already teaches the
// next major, is read by nothing here.
//
// The skills CLI's `experimental_sync` reads that package where it lies.
// Measured with `skills@1.7.2` against the PUBLISHED
// `@objectstack/skills@18.0.0-next.0` (10 skills under
// `dist/skills/<skill>/SKILL.md`), in a throwaway project, npm and pnpm
// layouts alike:
//
//   experimental_sync --agent claude-code -y
//     .agents/skills/<skill>  10 symlinks -> node_modules/@objectstack/skills/…
//     .claude/skills/<skill>  10 symlinks -> ../../.agents/skills/<skill>
//     0 real SKILL.md outside node_modules
//
//   experimental_sync --agent claude-code --copy -y
//     .claude/skills/         10 skills, 64 real files, 0 symlinks
//     skills-lock.json        every entry `source: @objectstack/skills`,
//                             `sourceType: node_modules`, the package version
//
// The linked shape is unusable for a project that commits its skills: every
// link points into `node_modules`, which the template's `.gitignore` excludes,
// so a fresh clone holds dangling links (and a `core.symlinks=false` clone,
// git-for-Windows' default, holds files whose whole content is the link
// target). `--copy` is the one-agent shape below, from a versioned source.
//
// `experimental_sync` scans the project's DIRECT dependencies (every
// dependency field of `package.json`) for `skills/` or `dist/skills/`. Measured
// over the template's direct dependency set at 18.0.0-next.0, `@objectstack/skills`
// is the only one that ships any, so the synced set is exactly its catalog.
// With no package to read it prints "Nothing to sync." and exits 0 — which is
// why the scaffolder checks both sides itself (`listSkills` below) instead of
// reading the exit code as "installed".
//
// The CLI is pinned to the version measured. `experimental_` is that package's
// own word for an interface it may change, and an unpinned `npx skills` would
// move the destination layout under every scaffold at the CLI's next release,
// silently. Re-measure before moving the pin.
//
// ## Why this names ONE agent instead of `--agent '*'`
//
// Measured on `skills add` with `skills@1.5.23` and this catalog (11 skills
// then), in an empty directory:
//
//   --all  (= --skill '*' --agent '*' -y)
//     .agents/   46 real files  604,102 B   (the "universal" runtime dir)
//     agent/     46 real files  602,682 B   (a second real copy)
//     .claude/   11 symlinks -> ../../.agents/skills/<skill>
//
//   --skill '*' --agent claude-code -y
//     .claude/   46 real files  604,102 B   and NOTHING else
//
// and the sync repeats it, measured as above (`skills@1.7.2`, the published
// 18.0.0-next.0 catalog): `experimental_sync --agent '*' --copy -y` writes the
// catalog into 54 agent directories, 540 `SKILL.md` copies, 48 MB.
//
// The template's `.gitignore` excluded none of it, so a scaffolded project's
// first `git add -A` staged the bundle twice plus the links. Both denylist
// shapes were built and cloned rather than reasoned about — ignoring the real
// trees leaves DANGLING links in a clone, committing the links breaks on
// `core.symlinks=false` — and a denylist chases a destination set this package
// does not choose. Naming our own destination is the composition this repo
// asks for: explicit over default magic.
//
// The cost is the multi-runtime default, and it is paid in the open — the
// closing summary prints the one-line command for any other runtime, and the
// catalog it installs is byte-identical whichever agent is named.

import fs from 'node:fs';
import path from 'node:path';

/** The published catalog package. Its version is `@objectstack/spec`'s (fixed group). */
export const SKILLS_PACKAGE = '@objectstack/skills';

/**
 * Where the package keeps its catalog, relative to the package root — the
 * layout `@objectstack/skills` publishes and `experimental_sync` reads.
 */
export const SKILLS_PACKAGE_CATALOG_DIR = 'dist/skills';

/** The skills CLI, pinned to the version the layout above was measured with. */
export const SKILLS_CLI = 'skills@1.7.2';

/** The single agent runtime a scaffolded project gets its skills wired for. */
export const DEFAULT_SKILLS_AGENT = 'claude-code';

/** Where `DEFAULT_SKILLS_AGENT` lands them — real files, no symlinks. */
export const DEFAULT_SKILLS_DIR = '.claude/skills/';

/** An agent name to show as the example in the "other runtimes" hint. */
export const EXAMPLE_OTHER_AGENT = 'codex';

/**
 * The `skills experimental_sync …` argument vector for one agent, as a shell
 * string: copy (never link) the catalog of every installed dependency that
 * ships one into `agent`'s own directory, without prompting.
 */
export function skillsSyncArgs(agent: string): string {
  return `${SKILLS_CLI} experimental_sync --agent ${agent} --copy -y`;
}

/**
 * What the scaffolder RUNS, after `<pm> install`. `npx -y` auto-installs the
 * pinned `skills` CLI itself; the trailing `-y` is the CLI's own "skip
 * confirmation prompts".
 */
export const SKILLS_INSTALL_COMMAND = `npx -y ${skillsSyncArgs(DEFAULT_SKILLS_AGENT)}`;

/** What we PRINT for a user to run later, for `agent`. */
export function skillsInstallHint(agent: string): string {
  return `npx ${skillsSyncArgs(agent)}`;
}

/** The installed package's root inside a project, whether or not it is there. */
export function skillsPackageDir(projectDir: string): string {
  return path.join(projectDir, 'node_modules', ...SKILLS_PACKAGE.split('/'));
}

/** The installed package's version, or `null` when `node_modules` does not hold it. */
export function installedSkillsVersion(projectDir: string): string | null {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(skillsPackageDir(projectDir), 'package.json'), 'utf8'),
    );
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * The skills under `dir` — the names of its immediate subdirectories that
 * hold a `SKILL.md` — sorted. Empty when `dir` does not exist. A symlinked
 * entry is not counted: the scaffolder installs real files, and a link into
 * `node_modules` is exactly what a clone of the project would not have. One
 * reading for both sides of the comparison the scaffolder makes after the
 * sync: the package's catalog and what landed in the agent's directory.
 */
export function listSkills(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();
}
