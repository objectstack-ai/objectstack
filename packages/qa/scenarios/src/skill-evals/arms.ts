// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two arms one case runs under, as the directory a `claude -p` turn starts
 * in and the argv it is given. The arms differ in exactly one thing — whether
 * the case's bundle sits in the turn's project skills
 * (`.claude/skills/BUNDLE/`) — and share everything else:
 *
 * - a fresh temporary directory as the working directory, so nothing of this
 *   checkout is in reach (a read outside the working directory needs a
 *   permission no turn is granted, and `-p` denies it);
 * - `--setting-sources project`: the user's own settings, skills, plugins and
 *   hooks stay out (measured on Claude Code 2.1.326: a user skill under
 *   `~/.claude/skills/` is absent from the init line's `skills`, while a
 *   bundle under the directory's `.claude/skills/` is listed); the skills
 *   built into Claude Code stay in, in both arms alike;
 * - `--tools Read,Glob,Grep,Skill`: the bundle's `rules/` and `references/`
 *   files are readable, nothing runs a command, nothing fetches the web;
 * - `--allowedTools Skill`, so a skill launch needs no prompt;
 * - no MCP server: `--strict-mcp-config` over an empty `--mcp-config`;
 * - `--no-session-persistence`, so a round leaves no session behind.
 *
 * The bundle is copied WITHOUT its `evals/` directory: the cases' expected
 * outputs and assertions must not be readable by the turn being graded on them.
 */

import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

export const ARMS = ['with-skill', 'no-skill'] as const;
export type Arm = (typeof ARMS)[number];

/** The built-in tools both arms are given. */
export const ARM_TOOLS = ['Read', 'Glob', 'Grep', 'Skill'] as const;

/** The directory under the bundle never copied into a turn's project. */
export const WITHHELD_BUNDLE_DIR = 'evals';

export interface ArmTurnOptions {
  /** `--max-turns` for one case. */
  maxTurns: number;
  /** `--model`; absent ⇒ the login's default. */
  model?: string;
  /** `--effort`; absent ⇒ the CLI's default effort. */
  effort?: string;
}

/** The argv of one turn, prompt excluded (it travels on stdin). Pure over its inputs. */
export function armArgs(mcpConfigPath: string, opts: ArmTurnOptions): string[] {
  const a = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', String(opts.maxTurns),
    '--setting-sources', 'project',
    '--tools', ARM_TOOLS.join(','),
    '--allowedTools', 'Skill',
    '--mcp-config', mcpConfigPath,
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  if (opts.model) a.push('--model', opts.model);
  if (opts.effort) a.push('--effort', opts.effort);
  return a;
}

export interface ArmWorkdir {
  /** The turn's working directory (fresh, empty but for the arm's skill). */
  cwd: string;
  /** The empty MCP config the turn is pointed at, outside `cwd`. */
  mcpConfigPath: string;
  /** Remove everything this made. */
  root: string;
}

/**
 * Make one turn's directory: `ROOT/project` as the working directory, holding
 * `.claude/skills/BUNDLE/` (without `evals/`) on the with-skill arm and
 * nothing on the no-skill arm, and `ROOT/mcp.json` beside it.
 *
 * `ROOT` is always under the system temp directory, spelled at the call so the
 * dispatch-gates scratch scan reads it as outside the tree; a caller that
 * wants it gone removes `root` itself.
 */
export function prepareArmWorkdir(arm: Arm, bundle: string, skillsRoot: string): ArmWorkdir {
  const root = mkdtempSync(join(tmpdir(), 'skill-eval-'));
  const cwd = join(root, 'project');
  mkdirSync(cwd);
  const mcpConfigPath = join(root, 'mcp.json');
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }));
  if (arm === 'with-skill') {
    const from = join(skillsRoot, bundle);
    const withheld = join(from, WITHHELD_BUNDLE_DIR);
    cpSync(from, join(cwd, '.claude', 'skills', bundle), {
      recursive: true,
      // A link into this checkout would hand the turn a path outside its project: copy what it points at.
      dereference: true,
      filter: (src) => src !== withheld && !src.startsWith(withheld + sep),
    });
  }
  return { cwd, mcpConfigPath, root };
}
