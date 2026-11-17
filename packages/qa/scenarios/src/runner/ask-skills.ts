// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ask client's skills directory (`--ask-skills DIR`): an opt-in set of
 * Claude Code skills the question and operation turns are given.
 *
 * A question or operation turn runs in an empty temporary directory with the
 * app's MCP server and nothing else (`ClaudeCodeDriver.ask`). With this option
 * the runner also writes each skill into that directory's `.claude/skills/<name>/`
 * and allows the `Skill` tool, so the session discovers the skills the way a
 * customer project's own `.claude/skills/` is discovered. Off by default: a run
 * without the option sends exactly the turns it sent before, and its record
 * carries no key for it, so the records made before it stay comparable.
 *
 * The directory is read ONCE, when the run starts: every turn is given those
 * bytes, and the record states each skill's name and the sha256 of its files
 * (with the `version` its SKILL.md front matter declares, when it declares one),
 * so the version a turn had is the version on the record, whatever happens to
 * the directory during the run.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

/** One skill the ask client was given, as the record states it. */
export interface AskSkill {
  /** The skill's directory name, which is the name the session lists it under. */
  name: string;
  /** sha256 over the skill's files: each relative path, its byte length and its bytes, in path order. */
  sha256: string;
  /** The `version` the skill's SKILL.md front matter declares (top level, or under `metadata`); absent when it declares none. */
  version?: string;
}

/** What the record states about the ask client's skills (`DriverInfo.askSkills`). */
export interface AskSkillsInfo {
  /** The directory the run was given, resolved. */
  dir: string;
  skills: AskSkill[];
}

/** A skills directory read into memory: what the record states, and the bytes each turn is given. */
export interface AskSkillsBundle {
  info: AskSkillsInfo;
  /** Skill name → relative path (forward slashes) → bytes. */
  files: ReadonlyMap<string, ReadonlyMap<string, Buffer>>;
}

/** The tool a session needs to load a skill; added to the ask turn's `--allowedTools` when skills are given. */
export const SKILL_TOOL = 'Skill';

const SKILL_FILE = 'SKILL.md';

function filesUnder(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile()) out.set(relative(dir, p).split(sep).join('/'), readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

/** sha256 over `files` in path order, each framed by its path and byte length so no two layouts hash alike. */
export function skillHash(files: ReadonlyMap<string, Buffer>): string {
  const h = createHash('sha256');
  for (const rel of [...files.keys()].sort()) {
    const bytes = files.get(rel)!;
    h.update(`${rel}\n${bytes.length}\n`);
    h.update(bytes);
  }
  return h.digest('hex');
}

/**
 * The `version` a SKILL.md front matter declares, at the top level or one
 * level down (`metadata.version`); `undefined` when the file opens with no
 * front matter or the block names no version. Pure over its input.
 */
export function skillVersionOf(skillMd: string): string | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd);
  if (!block) return undefined;
  const m = /^(?:[ \t]*)version:[ \t]*["']?([^"'\r\n]+?)["']?[ \t]*$/m.exec(block[1]!);
  return m ? m[1]!.trim() : undefined;
}

/**
 * Read a skills directory: either one skill (a directory holding `SKILL.md`,
 * named after the directory) or a directory of skills (each subdirectory that
 * holds `SKILL.md`, the layout of a `.claude/skills/` directory). Refused, with
 * the reason, when the path is no directory or holds no skill: an option that
 * gave the client nothing must not run as if it had.
 */
export function readAskSkills(dirArg: string): AskSkillsBundle {
  const dir = resolve(dirArg);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`--ask-skills names \`${dirArg}\`, which is no directory`);
  const skillDirs: Array<[string, string]> = existsSync(join(dir, SKILL_FILE))
    ? [[basename(dir), dir]]
    : readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, SKILL_FILE)))
        .map((e) => [e.name, join(dir, e.name)] as [string, string])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (skillDirs.length === 0) {
    throw new Error(`--ask-skills names \`${dirArg}\`, which holds no skill: give a directory holding ${SKILL_FILE}, or a directory of skill directories that each hold one`);
  }
  const files = new Map<string, Map<string, Buffer>>();
  const skills: AskSkill[] = [];
  for (const [name, at] of skillDirs) {
    const f = filesUnder(at);
    files.set(name, f);
    const version = skillVersionOf(f.get(SKILL_FILE)!.toString('utf8'));
    skills.push({ name, sha256: skillHash(f), ...(version !== undefined ? { version } : {}) });
  }
  return { info: { dir, skills }, files };
}

/** Write every skill of `bundle` into `cwd/.claude/skills/<name>/`, the project skills directory a session discovers. */
export function placeAskSkills(bundle: AskSkillsBundle, cwd: string): void {
  for (const [name, files] of bundle.files) {
    const root = join(cwd, '.claude', 'skills', name);
    for (const [rel, bytes] of files) {
      const p = join(root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, bytes);
    }
  }
}

/** `ask-data@1.2.0 (sha256 3f2a…)`, one per skill, as the run's first line and the scorecard state them. */
export function askSkillsText(info: AskSkillsInfo): string {
  return info.skills.map((s) => `${s.name}${s.version !== undefined ? `@${s.version}` : ''} (sha256 ${s.sha256.slice(0, 12)})`).join(', ');
}
