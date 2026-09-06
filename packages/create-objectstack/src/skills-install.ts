// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The skills-bundle install command, in ONE place — because two callers have
// to agree about it: the scaffolder RUNS it, and the closing summary PRINTS
// the same command with a different agent name for the runtimes this run did
// not install for. A drifted pair would tell the user to run something other
// than what produced their project.
//
// ## Why this names ONE agent instead of `--all`
//
// `--all` is the skills CLI's shorthand for `--skill '*' --agent '*' -y`, and
// the `--agent '*'` half is the whole defect. Measured against `skills@1.5.23`
// with this catalog (11 skills), in an empty directory:
//
//   npx skills add <catalog> --all
//     .agents/   46 real files  604,102 B   (the "universal" runtime dir)
//     agent/     46 real files  602,682 B   (a second real copy, re-serialized
//                                            frontmatter — same bodies)
//     .claude/   11 symlinks -> ../../.agents/skills/<skill>
//
//   npx skills add <catalog> --skill '*' --agent claude-code -y
//     .claude/   46 real files  604,102 B   and NOTHING else
//
// The template's `.gitignore` excluded none of it, so a scaffolded project's
// first `git add -A` staged 22 `SKILL.md` paths — the bundle twice, plus 11
// symlinks — and that reached the initial commit of a real app before anyone
// noticed. With one agent named it stages 11, once.
//
// ## Why the fix is the COMMAND and not a `.gitignore` denylist
//
// Both denylist shapes were built and cloned, not reasoned about:
//
//   * ignore `.agents/` + `agent/`, commit `.claude/` — a fresh clone gets 11
//     DANGLING symlinks and zero readable `SKILL.md`. The links point into the
//     tree that was just excluded.
//   * ignore `agent/` only, commit `.agents/` (real) + `.claude/` (symlinks) —
//     works on POSIX, but the 11 committed symlinks come out of a
//     `core.symlinks=false` clone (git-for-Windows' default) as regular files
//     whose entire content is the string `../../.agents/skills/<skill>`.
//
// and `--all --copy`, the other way to make `.claude/` real, fans out to 56
// destination directories totalling 33.8 MB.
//
// A denylist is also the wrong SHAPE regardless of which paths it names: this
// package does not choose the destination set — the skills CLI does, and it
// moves with THAT package's releases (`created-summary.ts` documents the same
// property for the same reason). An ignore list has to chase it, silently, in
// the direction that re-commits duplicates. Naming our own destination is the
// composition this repo asks for: explicit over default magic.
//
// The cost is the multi-runtime default, and it is paid in the open — the
// closing summary prints the one-line command for any other runtime, and the
// bundle it installs is byte-identical whichever agent is named.

/**
 * The curated, customer-published catalog. The `/skills` subpath is a hard
 * boundary, not a convenience: discovery from the repo ROOT also walks
 * `.claude/skills/`, and `--skill '*'` includes `metadata.internal` entries —
 * a root-scoped install leaks repo-internal playbooks into customer projects.
 * `template-consistency.test.ts` holds every surface in this package to it.
 */
export const SKILLS_CATALOG = 'objectstack-ai/objectstack/skills';

/** The single agent runtime a scaffolded project gets its skills wired for. */
export const DEFAULT_SKILLS_AGENT = 'claude-code';

/** Where `DEFAULT_SKILLS_AGENT` lands them — real files, no symlinks. */
export const DEFAULT_SKILLS_DIR = '.claude/skills/';

/** An agent name to show as the example in the "other runtimes" hint. */
export const EXAMPLE_OTHER_AGENT = 'codex';

/**
 * The `skills add …` argument vector for one agent, as a shell string.
 *
 * `'*'` is quoted because this is handed to a shell: unquoted, the glob is
 * expanded against the project directory before the CLI ever sees it.
 */
export function skillsAddArgs(agent: string): string {
  return `skills add ${SKILLS_CATALOG} --skill '*' --agent ${agent} -y`;
}

/**
 * What the scaffolder RUNS. `npx -y` auto-installs the `skills` CLI itself;
 * the trailing `-y` is the CLI's own "skip confirmation prompts".
 */
export const SKILLS_INSTALL_COMMAND = `npx -y ${skillsAddArgs(DEFAULT_SKILLS_AGENT)}`;

/** What we PRINT for a user to run later, for `agent`. */
export function skillsInstallHint(agent: string): string {
  return `npx ${skillsAddArgs(agent)}`;
}
